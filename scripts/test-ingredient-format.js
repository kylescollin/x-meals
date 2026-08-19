#!/usr/bin/env node
/* test-ingredient-format.js — unit tests for the ingredient markup parser.
 *
 * Run: node scripts/test-ingredient-format.js
 *
 * The parser is small but it sits in front of every recipe on the site and in
 * front of the grocery generator, so the cases that matter most are the ones
 * where it must do *nothing*: "2 (14.5 oz) cans" and "1/16 tsp" have to come
 * out exactly as they went in, and a legacy "Slaw:" must not be mistaken for
 * a header now that headers are explicit.
 */

const fs = require('fs');
const path = require('path');
const IF = require('../ingredient-format.js');

let failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log('  ✓ ' + label); return; }
  failed++;
  console.log('  ✗ ' + label + '\n      expected ' + e + '\n      got      ' + a);
}

// ── 1. Fractions ─────────────────────────────────────────────────────────
console.log('\nprettyFractions');
check('1/2 → ½', IF.prettyFractions('1/2 tsp salt'), '½ tsp salt');
check('mixed number', IF.prettyFractions('1 1/2 lb tilapia'), '1 ½ lb tilapia');
check('every mapped pair',
  IF.prettyFractions('1/2 1/3 2/3 1/4 3/4 1/8 3/8 5/8 7/8'),
  '½ ⅓ ⅔ ¼ ¾ ⅛ ⅜ ⅝ ⅞');
check('start of string', IF.prettyFractions('3/4 cup'), '¾ cup');
check('several in one line', IF.prettyFractions('1/2 cup rice, 1/4 cup water'), '½ cup rice, ¼ cup water');
check('hyphenated', IF.prettyFractions('cut into 1/2-inch cubes'), 'cut into ½-inch cubes');

console.log('\nprettyFractions leaves alone');
check('unmapped denominator', IF.prettyFractions('1/16 tsp'), '1/16 tsp');
check('two-digit numerator', IF.prettyFractions('11/2 cups'), '11/2 cups');
check('a date', IF.prettyFractions('2/3/26'), '2/3/26');
check('a decimal ratio', IF.prettyFractions('9.5/10'), '9.5/10');
check('pan dimensions', IF.prettyFractions('9x13 pan'), '9x13 pan');
check('a URL', IF.prettyFractions('https://a.com/1/2/x'), 'https://a.com/1/2/x');
check('empty stays empty', IF.prettyFractions(''), '');

// ── 2. Sections ──────────────────────────────────────────────────────────
console.log('\nsections');
check('# with a space', IF.isSection('# For the fish'), true);
check('# with no space', IF.isSection('#For the fish'), true);
check('leading whitespace', IF.isSection('  # Slaw'), true);
check('legacy bare label is NOT a section', IF.isSection('Slaw:'), false);
check('an ordinary ingredient', IF.isSection('1 tsp salt'), false);
check('# mid-line is not a section', IF.isSection('2 eggs # large'), false);
check('title strips the marker', IF.sectionTitle('#  For the Slaw '), 'For the Slaw');
check('stripSections drops headers',
  IF.stripSections(['# For the fish', '1 lb cod', '# Slaw', '2 cups cabbage']),
  ['1 lb cod', '2 cups cabbage']);
check('stripSections on a plain list',
  IF.stripSections(['1 lb cod', '2 cups cabbage']),
  ['1 lb cod', '2 cups cabbage']);
check('stripSections tolerates nothing', IF.stripSections(undefined), []);

// ── 3. Trailing notes ────────────────────────────────────────────────────
console.log('\ntrailing notes');
check('single parens drop',
  IF.splitTrailingNote('1 tsp cayenne (more or less for spiciness)'),
  { body: '1 tsp cayenne', note: 'more or less for spiciness' });
check('double parens keep one set',
  IF.splitTrailingNote('1 ½ lb tilapia, ((mahi mahi, cod, etc.))'),
  { body: '1 ½ lb tilapia,', note: '(mahi mahi, cod, etc.)' });
check('one-word note', IF.splitTrailingNote('½ tsp sugar (optional)'),
  { body: '½ tsp sugar', note: 'optional' });
check('trailing whitespace after the note',
  IF.splitTrailingNote('2 eggs (room temp)   '),
  { body: '2 eggs', note: 'room temp' });

console.log('\ntrailing notes leave alone');
check('mid-line parens',
  IF.splitTrailingNote('2 (14.5 oz) cans diced tomatoes'),
  { body: '2 (14.5 oz) cans diced tomatoes', note: null });
check('parens then more words',
  IF.splitTrailingNote('1 (15 oz) can chickpeas, drained'),
  { body: '1 (15 oz) can chickpeas, drained', note: null });
check('unbalanced open', IF.splitTrailingNote('2 eggs (room temp'),
  { body: '2 eggs (room temp', note: null });
check('unbalanced close', IF.splitTrailingNote('2 eggs room temp)'),
  { body: '2 eggs room temp)', note: null });
check('the whole line is parenthesised', IF.splitTrailingNote('(see note below)'),
  { body: '(see note below)', note: null });
check('empty parens', IF.splitTrailingNote('2 eggs ()'),
  { body: '2 eggs ()', note: null });
check('no parens at all', IF.splitTrailingNote('1 tsp chili powder'),
  { body: '1 tsp chili powder', note: null });

// ── 4. parseIngredient, the call renderers make ──────────────────────────
console.log('\nparseIngredient');
check('a header', IF.parseIngredient('# For the Slaw'),
  { type: 'section', text: 'For the Slaw' });
check('quantity + item', IF.parseIngredient('1 tsp chili powder'),
  { type: 'item', qty: '1 tsp', name: 'chili powder', note: null });
check('quantity + item + note', IF.parseIngredient('¼ tsp cayenne (or more)'),
  { type: 'item', qty: '¼ tsp', name: 'cayenne', note: 'or more' });
check('minted glyph parses as a quantity', IF.parseIngredient('⅞ cup flour'),
  { type: 'item', qty: '⅞ cup', name: 'flour', note: null });
check('no measurement falls back to the em dash', IF.parseIngredient('Salt and pepper'),
  { type: 'item', qty: '—', name: 'Salt and pepper', note: null });
check('mid-line parens stay in the name', IF.parseIngredient('2 (14.5 oz) cans diced tomatoes'),
  { type: 'item', qty: '2', name: '(14.5 oz) cans diced tomatoes', note: null });
check('empty line', IF.parseIngredient(''),
  { type: 'item', qty: '—', name: '', note: null });

// ── 5. Parity with the splitter this replaced ────────────────────────────
// parseQty was lifted verbatim out of recipe-card.js (only the fraction glyph
// set grew). Every real ingredient in the collection must split the same way.
console.log('\nparseQty parity with the old recipe-card.js splitter');
function legacyParseIng(s) {
  const m = s.match(/^((?:[\d½⅓⅔¼¾\s/]+)\s*(?:cup|cups|tbsp|tsp|lb|lbs|oz|g|kg|ml|l|clove|cloves|medium|large|small|head|can|bunch|pinch|dash)?s?\.?)\s+([\s\S]+)/i);
  return m ? { qty: m[1].trim(), name: m[2].trim() } : { qty: '—', name: s };
}
const recipes = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data/recipes.json'), 'utf8')
).recipes || [];
const allIngs = recipes.reduce((a, r) => a.concat(r.ingredients || r.ings || []), []);
const drift = allIngs.filter(
  s => JSON.stringify(IF.parseQty(s)) !== JSON.stringify(legacyParseIng(s))
);
check(`all ${allIngs.length} stored ingredients split identically`, drift, []);

console.log(failed ? `\n✗ ${failed} failing\n` : '\n✓ all passing\n');
process.exit(failed ? 1 : 0);

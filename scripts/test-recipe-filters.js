#!/usr/bin/env node
/* test-recipe-filters.js — the filter engine the Recipes and Explore tabs share.
 *
 * Run: node scripts/test-recipe-filters.js
 *
 * Two things matter most here. The parsers read free text out of `meta`, and
 * blog recipes often have no time ("Oven · Serves 12"), so the method must be
 * found wherever it sits. And the Explore tab opens with "Dinners" picked, so
 * a group sitting on its defaults has to count as no filter at all.
 */
const RF = require('../recipe-filters.js');

// recipe-card.js isn't loaded under Node; stand in for its tag families.
const FAMILY = { Pasta: 'dish', Soup: 'dish', Italian: 'cuisine', Asian: 'cuisine', Explore: 'origin' };
RF.familyOf = (t) => FAMILY[t] || 'custom';

let failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log('  ✓ ' + label); return; }
  failed++;
  console.log('  ✗ ' + label + '\n      expected ' + e + '\n      got      ' + a);
}

// ── 1. Minutes ───────────────────────────────────────────────────────────
console.log('\nparseMinutes');
check('30 min', RF.parseMinutes('30 min · Stovetop · Serves 4'), 30);
check('~1 hour', RF.parseMinutes('~1 hour · Oven · Serves 6'), 60);
check('a range takes the upper bound', RF.parseMinutes('2–3 hrs · Slow cooker'), 180);
check('hours and minutes add', RF.parseMinutes('6 hrs 15 min · Slow cooker'), 375);
check('a note in parens is ignored', RF.parseMinutes('~45 min (marinate tonight!) · Grill'), 45);
check('no time → null', RF.parseMinutes('Oven · Serves 12'), null);
check('empty → null', RF.parseMinutes(''), null);

// ── 2. Methods ───────────────────────────────────────────────────────────
console.log('\nparseMethods');
check('second segment after a time', RF.parseMethods('30 min · Oven · Serves 4'), ['Oven']);
check('method first when there is no time', RF.parseMethods('Oven · Serves 12'), ['Oven']);
check('sheet pan first', RF.parseMethods('Sheet pan · Serves 12'), ['Sheet pan']);
check('"or" counts as both', RF.parseMethods('30 min · Oven or Air Fryer · Serves 4'), ['Oven', 'Air fryer']);
check('servings alone is not a method', RF.parseMethods('Serves 4'), []);
check('time then servings — no method', RF.parseMethods('30 min · Serves 4'), []);
check('an unfamiliar word after a time is kept', RF.parseMethods('40 min · Wok · Serves 2'), ['Wok']);
check('an unfamiliar first word is not guessed to be a method', RF.parseMethods('Weeknight · Serves 2'), []);
check('casing is normalised', RF.parseMethods('25 min · slow cooker'), ['Slow cooker']);
check('empty → []', RF.parseMethods(''), []);

// ── 3. Proteins ──────────────────────────────────────────────────────────
console.log('\nparseProteins');
check('chicken from the name', RF.parseProteins('Chicken Parm', ['1 lb pasta']), ['Chicken']);
check('broth is not chicken', RF.parseProteins('Tomato Soup', ['4 cups chicken broth', '1 can tomatoes']), ['Meatless']);
check('fish sauce is not seafood', RF.parseProteins('Pad Thai', ['2 tbsp fish sauce', '8 oz tofu']), ['Meatless']);
check('two proteins both show', RF.parseProteins('Surf and turf', ['1 lb steak', '1 lb shrimp']), ['Beef', 'Seafood']);
check('generic ground meat is unknown, not meatless', RF.parseProteins('Meatballs', ['1 lb ground meat']), []);
check('ham is pork', RF.parseProteins('Quiche', ['1 cup diced ham']), ['Pork & sausage']);

// ── 4. Facets ────────────────────────────────────────────────────────────
console.log('\nfacetFor');
{
  const r = { id: 'x', name: 'Chicken Soup', meta: '45 min · Stovetop · Serves 6', tags: ['Soup', 'Asian'],
    ings: ['# For the pot', '1 lb chicken thighs', '4 cups broth'] };
  const f = RF.facetFor(r);
  check('id, tags, minutes, methods, proteins', [f.id, f.tags, f.minutes, f.methods, f.proteins],
    ['x', ['Soup', 'Asian'], 45, ['Stovetop'], ['Chicken']]);
  check('tags and id can be supplied', (() => { const g = RF.facetFor(r, ['Pasta'], 'y'); return [g.id, g.tags]; })(), ['y', ['Pasta']]);
  check('`ingredients` works as well as `ings`', RF.facetFor({ name: 'Cod', ingredients: ['1 lb cod'] }).proteins, ['Seafood']);
  check('dish group reads the family', RF.groups.dish.values(f), ['Soup']);
  check('cuisine group reads the family', RF.groups.cuisine.values(f), ['Asian']);
  check('time bucket', RF.groups.time.values(f), ['30–60 min']);
  check('no time → no bucket', RF.groups.time.values(RF.facetFor({ meta: 'Oven' })), []);
}

// ── 5. Selection and matching ────────────────────────────────────────────
console.log('\nmatches / activeCount');
{
  const COURSE = { dinner: 'Dinners', dessert: 'Desserts', side: 'Sides' };
  const course = { key: 'course', title: 'Course', fixed: ['Dinners', 'Desserts', 'Sides'], defaults: ['Dinners'],
    values: (f) => [COURSE[f.course || 'dinner']] };
  const gs = [course, RF.groups.dish, RF.groups.cuisine];
  const pasta  = { tags: ['Pasta', 'Italian'], course: 'dinner' };
  const soup   = { tags: ['Soup', 'Asian'] };               // no course → a dinner
  const cake   = { tags: [], course: 'dessert' };

  let sel = RF.emptySelection(gs);
  check('defaults are pre-picked', Object.keys(sel.course), ['Dinners']);
  check('a group on its defaults is not an active filter', RF.activeCount(gs, sel), 0);
  check('default hides desserts', RF.matches(gs, sel, cake), false);
  check('no course counts as a dinner', RF.matches(gs, sel, soup), true);

  sel.course = { Desserts: true };
  check('one pick off the defaults counts once', RF.activeCount(gs, sel), 1);
  check('desserts only', [RF.matches(gs, sel, cake), RF.matches(gs, sel, pasta)], [true, false]);

  sel.course = { Dinners: true, Desserts: true };
  check('within a group picks are OR', [RF.matches(gs, sel, cake), RF.matches(gs, sel, pasta)], [true, true]);
  check('two picks count as two', RF.activeCount(gs, sel), 2);

  sel.course = {};
  check('nothing picked in a defaulted group still counts as one (it is not the usual view)', RF.activeCount(gs, sel), 1);
  check('nothing picked shows everything', [RF.matches(gs, sel, cake), RF.matches(gs, sel, pasta)], [true, true]);

  sel = RF.emptySelection(gs);
  sel.dish = { Pasta: true };
  sel.cuisine = { Asian: true };
  check('across groups is AND', RF.matches(gs, sel, pasta), false);
  check('skipGroup ignores that group', RF.matches(gs, sel, pasta, 'cuisine'), true);
  check('plain groups count every pick', RF.activeCount(gs, sel), 2);

  check('no facet passes only when nothing is on', [RF.matches(gs, RF.emptySelection(gs), undefined), RF.matches(gs, sel, undefined)], [true, false]);
}

console.log(failed ? `\n${failed} failing` : '\nAll recipe-filters tests passed.');
process.exit(failed ? 1 : 0);

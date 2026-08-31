#!/usr/bin/env node
/* Tests for the model-output JSON extractor. Run: node scripts/test-model-json.js
 *
 * The case that matters most is #3: a reply that begins with prose before the
 * JSON — that exact shape took down a real CI run and stranded a week's
 * grocery list.
 */
const { extractJson } = require('./lib/model-json.js');

let failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log('  ✓ ' + label); return; }
  failed++;
  console.log('  ✗ ' + label + '\n      expected ' + e + '\n      got      ' + a);
}
function checkThrows(label, fn) {
  try { fn(); } catch (_) { console.log('  ✓ ' + label); return; }
  failed++;
  console.log('  ✗ ' + label + '\n      expected a throw, got a value');
}

const ops = [{ op: 'add', section: 'Produce', name: '2 zucchini', from: ['stir-fry'] }];

// ── 1. Clean JSON, as the prompt asks for ────────────────────────────────
check('bare array', extractJson(JSON.stringify(ops)), ops);
check('bare object', extractJson('{"a":1}'), { a: 1 });
check('surrounding whitespace', extractJson('\n  [] \n'), []);

// ── 2. Code fences ───────────────────────────────────────────────────────
check('```json fence', extractJson('```json\n' + JSON.stringify(ops) + '\n```'), ops);
check('plain ``` fence', extractJson('```\n' + JSON.stringify(ops) + '\n```'), ops);

// ── 3. THE ONE THAT MATTERS: prose before the JSON ───────────────────────
check('leading prose (the real CI failure)',
  extractJson("I'll work through the meals that joined the week.\n\n" + JSON.stringify(ops)), ops);

// ── 4. Prose after, and on both sides ────────────────────────────────────
check('trailing prose', extractJson(JSON.stringify(ops) + '\n\nLet me know if that helps!'), ops);
check('prose on both sides',
  extractJson('Here are the operations:\n' + JSON.stringify(ops) + '\nThat covers everything.'), ops);

// ── 5. Brackets and quotes inside strings must not confuse the matcher ───
{
  const tricky = [{ name: '2 (14.5 oz) cans "fire-roasted" [diced]', detail: 'stirred in · with } and ]' }];
  check('brackets, quotes and · inside strings survive',
    extractJson('Sure:\n' + JSON.stringify(tricky)), tricky);
}

// ── 6. A stray { in the prose before the real payload ────────────────────
check('stray { in prose is skipped',
  extractJson('The shape is { op, name }:\n' + JSON.stringify(ops)), ops);

// ── 7. The actual groceries shape — nested arrays of objects ─────────────
{
  const sections = [{ icon: '🥦', label: 'Produce', items: [{ name: '1 lime', from: ['curry'] }] }];
  check('nested groceries shape', extractJson('Okay.\n' + JSON.stringify(sections)), sections);
}

// ── 8. Garbage stays garbage ─────────────────────────────────────────────
checkThrows('no JSON at all throws', () => extractJson('I could not produce a list this time.'));
checkThrows('truncated JSON throws', () => extractJson('[{"name": "2 on'));
checkThrows('empty input throws', () => extractJson(''));

console.log(failed ? `\n${failed} test(s) failed.` : '\nAll model-json tests passed.');
process.exit(failed ? 1 : 0);

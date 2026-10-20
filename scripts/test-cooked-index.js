#!/usr/bin/env node
/* Tests for the "last cooked" index. Run: node scripts/test-cooked-index.js
 *
 * The case that matters is the non-Sunday key: a week stored under a Monday
 * must still place its meals by the canonical Sunday, or every date on the
 * card would be a day off from the week page.
 */
const { cookedIndex, nightOf } = require('./lib/cooked-index.js');

let failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log('  ✓ ' + label); return; }
  failed++;
  console.log('  ✗ ' + label + '\n      expected ' + e + '\n      got      ' + a);
}

const meal = (id, day) => ({ id, day, name: id });

console.log('nightOf');
check('Monday in a Sunday-keyed week', nightOf('2026-10-18', 'Monday'), '2026-10-19');
check('Saturday in a Sunday-keyed week', nightOf('2026-10-18', 'Saturday'), '2026-10-24');
check('a Monday-keyed week still counts from its Sunday', nightOf('2026-03-23', 'Tuesday'), '2026-03-24');
check('a Thursday-keyed week: Sunday is the week start, before the key', nightOf('2026-03-19', 'Sunday'), '2026-03-15');
check('no day → the week start', nightOf('2026-10-18', undefined), '2026-10-18');
check('unknown day → the week start', nightOf('2026-10-18', 'Someday'), '2026-10-18');
check('bad key → nothing', nightOf('not-a-date', 'Monday'), '');

console.log('cookedIndex');
{
  const idx = cookedIndex([
    { weekOf: '2026-10-18', meals: [meal('tacos', 'Monday'), meal('curry', 'Wednesday'),
                                    { id: 'custom-pizza-night-x1', custom: true, name: 'Pizza night', day: 'Friday' }] },
    { weekOf: '2026-10-11', meals: [meal('tacos', 'Thursday')] },
    { weekOf: '2026-03-23', meals: [meal('tacos', 'Tuesday'), meal('tacos', 'Tuesday')] },
    { meals: [meal('orphan', 'Monday')] },
    null
  ]);
  check('one entry per recipe, placeholders left out', Object.keys(idx), ['curry', 'tacos']);
  check('dates newest first, deduped', idx.tacos, ['2026-10-19', '2026-10-15', '2026-03-24']);
  check('a single night', idx.curry, ['2026-10-21']);
  check('ids are Firebase-safe', Object.keys(cookedIndex([{ weekOf: '2026-10-18', meals: [meal('a.b#c', 'Monday')] }])), ['a_b_c']);
  check('empty input', cookedIndex([]), {});
}

if (failed) { console.log('\n' + failed + ' failed'); process.exit(1); }
console.log('\nAll cooked-index tests passed.');

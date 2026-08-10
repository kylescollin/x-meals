#!/usr/bin/env node
/* Tests for the grocery reconcile. Run: node scripts/test-week-merge.js
 *
 * The case that matters most is #3: an item you have already ticked off must
 * keep its exact name, because that name IS its checkbox key.
 */
const { isCovered, mergeGroceries, groceryKey, norm } = require('./lib/week-merge.js');

let failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log('  ✓ ' + label); return; }
  failed++;
  console.log('  ✗ ' + label + '\n      expected ' + e + '\n      got      ' + a);
}

const produce = (items) => [{ icon: '🥦', label: 'Produce', items }];
const item = (name, from, tag) => ({ name, detail: '', tag: tag || 'Meal A', amazon: 'x', from });

// ── 1. Legacy week (no provenance) gains a meal ──────────────────────────
{
  const old = produce([{ name: '2 yellow onions', tag: 'Meal A', amazon: 'yellow onion' }]);
  const fresh = produce([item('3 yellow onions', ['chili', 'curry'], 'Meals A+B'), item('1 lime', ['curry'], 'Meal B')]);
  const out = mergeGroceries(old, fresh, ['chili', 'curry'], []);
  check('legacy: nothing checked, so the fresh name and tag win',
    out[0].items.map(i => i.name + '|' + i.tag), ['3 yellow onions|Meals A+B', '1 lime|Meal B']);
}

// ── 2. A meal is removed ─────────────────────────────────────────────────
{
  const old = produce([item('3 yellow onions', ['chili', 'curry'], 'Meals A+B'), item('1 lime', ['curry'], 'Meal B')]);
  const fresh = produce([item('2 yellow onions', ['chili'], 'Meal A')]);
  const out = mergeGroceries(old, fresh, ['chili'], []);
  check("removed meal's exclusive item disappears, shared item stays with a corrected tag",
    out[0].items.map(i => i.name + '|' + i.tag), ['2 yellow onions|Meal A']);
}

// ── 3. THE ONE THAT MATTERS: a checked item must not be renamed ──────────
{
  const old = produce([item('3 medium yellow onions', ['chili'], 'Meal A')]);
  const fresh = produce([item('2 yellow onions', ['chili', 'curry'], 'Meals A+B')]);
  const out = mergeGroceries(old, fresh, ['chili', 'curry'], [groceryKey('3 medium yellow onions')]);
  check('checked item keeps its exact name', out[0].items[0].name, '3 medium yellow onions');
  check('...but still picks up the new tag', out[0].items[0].tag, 'Meals A+B');
  check('...and its checkbox key is unchanged',
    groceryKey(out[0].items[0].name), groceryKey('3 medium yellow onions'));
}

// ── 4. Unchecked item is free to be renamed ──────────────────────────────
{
  const old = produce([item('3 medium yellow onions', ['chili'], 'Meal A')]);
  const fresh = produce([item('2 yellow onions', ['chili'], 'Meal A')]);
  const out = mergeGroceries(old, fresh, ['chili'], []);
  check('unchecked item takes the fresh name', out[0].items[0].name, '2 yellow onions');
}

// ── 5. Hand-added items always survive ───────────────────────────────────
{
  const old = produce([item('2 onions', ['chili'], 'Meal A'), { name: 'birthday candles', tag: 'Meal A' }]);
  const fresh = produce([item('2 onions', ['chili'], 'Meal A')]);
  const out = mergeGroceries(old, fresh, ['chili'], []);
  check('hand-added item survives regeneration',
    out[0].items.map(i => i.name), ['2 onions', 'birthday candles']);
}

// ── 6. Idempotence — a covered week regenerates nothing ──────────────────
{
  const list = produce([item('2 onions', ['chili', 'curry'], 'Meals A+B')]);
  check('covered week needs no work', isCovered(list, ['chili', 'curry']), true);
  check('new meal makes it uncovered', isCovered(list, ['chili', 'curry', 'tacos']), false);
  check('departed meal makes it uncovered', isCovered(list, ['chili']), false);
  check('legacy list counts as covered', isCovered(produce([{ name: 'onions' }]), ['chili']), true);
  check('empty list is never covered', isCovered([], ['chili']), false);
}

// ── 7. Name normalisation ────────────────────────────────────────────────
{
  check('quantity and unit are stripped for matching',
    norm('3 medium yellow onions') === norm('2 yellow onion'), true);
  check('different ingredients stay different',
    norm('2 yellow onions') === norm('2 red onions'), false);
  check('parenthetical is ignored',
    norm('1 lb ground beef (85/15)') === norm('2 lbs ground beef'), true);
}

// ── 8. Section order is canonical regardless of input order ──────────────
{
  const fresh = [
    { icon: '🌿', label: 'Spices', note: 'Check pantry first', items: [{ name: 'cumin', from: ['chili'] }] },
    { icon: '🥦', label: 'Produce', items: [{ name: '2 onions', from: ['chili'] }] }
  ];
  const out = mergeGroceries([], fresh, ['chili'], []);
  check('sections come out in shopping order', out.map(s => s.label), ['Produce', 'Spices']);
  check('the spices note survives', out[1].note, 'Check pantry first');
}

console.log(failed ? `\n✗ ${failed} failing\n` : '\n✓ all passing\n');
process.exit(failed ? 1 : 0);

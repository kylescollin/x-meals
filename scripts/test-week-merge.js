#!/usr/bin/env node
/* Tests for the grocery reconcile. Run: node scripts/test-week-merge.js
 *
 * The case that matters most is #3: an item you have already ticked off must
 * keep its exact name, because that name IS its checkbox key.
 */
const {
  mergeGroceries, groceryKey, norm,
  weekDelta, pruneRemoved, applyRevisions, relabelGroceries
} = require('./lib/week-merge.js');

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

// ── 6. Name normalisation ────────────────────────────────────────────────
{
  check('quantity and unit are stripped for matching',
    norm('3 medium yellow onions') === norm('2 yellow onion'), true);
  check('different ingredients stay different',
    norm('2 yellow onions') === norm('2 red onions'), false);
  check('parenthetical is ignored',
    norm('1 lb ground beef (85/15)') === norm('2 lbs ground beef'), true);
}

// ── 7. Section order is canonical regardless of input order ──────────────
{
  const fresh = [
    { icon: '🌿', label: 'Spices', note: 'Check pantry first', items: [{ name: 'cumin', from: ['chili'] }] },
    { icon: '🥦', label: 'Produce', items: [{ name: '2 onions', from: ['chili'] }] }
  ];
  const out = mergeGroceries([], fresh, ['chili'], []);
  check('sections come out in shopping order', out.map(s => s.label), ['Produce', 'Spices']);
  check('the spices note survives', out[1].note, 'Check pantry first');
}

// ═════════════════════════════════════════════════════════════════════════
// The delta path — what runs on every ordinary edit.
// ═════════════════════════════════════════════════════════════════════════

const MEALS = [
  { id: 'chili', label: 'Meal A' },
  { id: 'curry', label: 'Meal B' },
  { id: 'tacos', label: 'Meal C' }
];

// ── 8. weekDelta: what actually changed ──────────────────────────────────
{
  const list = produce([item('2 onions', ['chili', 'curry'], 'Meals A+B')]);
  const week = (groceriesFor) => ({ groceries: list, groceriesFor });

  check('rearranged week has no delta',
    weekDelta(week(['chili', 'curry']), ['curry', 'chili']), { added: [], removed: [], legacy: false });
  check('a meal joined',
    weekDelta(week(['chili', 'curry']), ['chili', 'curry', 'tacos']),
    { added: ['tacos'], removed: [], legacy: false });
  check('a meal left',
    weekDelta(week(['chili', 'curry']), ['chili']), { added: [], removed: ['curry'], legacy: false });
  check('swapped one meal for another',
    weekDelta(week(['chili', 'curry']), ['chili', 'tacos']),
    { added: ['tacos'], removed: ['curry'], legacy: false });
  check('no groceriesFor yet — falls back to the union of `from`',
    weekDelta({ groceries: list }, ['chili']), { added: [], removed: ['curry'], legacy: false });
  check('a meal covered by nothing but consolidated lines still counts as covered',
    weekDelta({ groceries: produce([item('2 onions', ['chili'], 'Meal A')]), groceriesFor: ['chili', 'curry'] },
      ['chili', 'curry']), { added: [], removed: [], legacy: false });
  check('no provenance anywhere is legacy — leave it alone',
    weekDelta({ groceries: produce([{ name: 'onions' }]) }, ['chili']).legacy, true);
  check('no list at all means every meal is new',
    weekDelta({ groceries: [] }, ['chili']), { added: ['chili'], removed: [], legacy: false });
}

// ── 9. pruneRemoved: taking a meal out, with no model involved ──────────
{
  const sections = produce([
    item('3 yellow onions', ['chili', 'curry'], 'Meals A+B'),
    item('1 lime', ['curry'], 'Meal B'),
    { name: 'birthday candles' }
  ]);
  const out = pruneRemoved(sections, ['curry'], [MEALS[0]]);

  check("the departed meal's exclusive item goes",
    out.sections[0].items.map(i => i.name), ['3 yellow onions', 'birthday candles']);
  check('the shared item keeps only surviving ids', out.sections[0].items[0].from, ['chili']);
  check('...and its tag is corrected', out.sections[0].items[0].tag, 'Meal A');
  check('...with the matching colour', out.sections[0].items[0].tagClass, 'tag-chili');
  check('only the shared item needs its quantity revised',
    out.shared.map(i => i.name), ['3 yellow onions']);
  check('the original list was not mutated',
    sections[0].items[0].from, ['chili', 'curry']);
}

// ── 10. applyRevisions: the model proposes, we decide ────────────────────
{
  const base = () => [
    { icon: '🥦', label: 'Produce', items: [item('2 yellow onions', ['chili'], 'Meal A')] }
  ];

  const added = applyRevisions(base(), [
    { op: 'add', section: 'Protein', name: '1 lb ground turkey', detail: 'for the curry', amazon: 'ground turkey', from: ['curry'] }
  ], MEALS, []);
  check('an add lands in its own section, in shopping order',
    added.map(s => s.label), ['Produce', 'Protein']);
  check('...tagged from its ids, not from the model', added[1].items[0].tag, 'Meal B');

  const bumped = applyRevisions(base(), [
    { op: 'update', match: '2 yellow onions', name: '4 yellow onions', detail: '2 for chili · 2 for curry', from: ['chili', 'curry'] }
  ], MEALS, []);
  check('an unticked item takes the new quantity', bumped[0].items[0].name, '4 yellow onions');
  check('...and the new tag', bumped[0].items[0].tag, 'Meals A+B');

  const frozen = applyRevisions(base(), [
    { op: 'update', match: '2 yellow onions', name: '4 yellow onions', detail: '2 for chili · 2 for curry', from: ['chili', 'curry'] }
  ], MEALS, [groceryKey('2 yellow onions')]);
  check('A TICKED ITEM KEEPS ITS EXACT NAME', frozen[0].items[0].name, '2 yellow onions');
  check('...so its checkbox key is unchanged',
    groceryKey(frozen[0].items[0].name), groceryKey('2 yellow onions'));
  check('...but still takes the new detail and tag',
    frozen[0].items[0].detail + '|' + frozen[0].items[0].tag, '2 for chili · 2 for curry|Meals A+B');

  const bogus = applyRevisions(base(), [
    { op: 'update', match: 'something that is not on the list', name: 'nonsense' },
    { op: 'add', section: 'Produce', name: '2 yellow onions', detail: 'dupe', from: ['curry'] },
    { op: 'add', section: 'Spices', name: 'cumin', amazon: 'ground cumin', from: ['nope', 'curry'] }
  ], MEALS, []);
  check('an update naming an item that is not there is discarded',
    bogus[0].items.map(i => i.name), ['2 yellow onions']);
  check('an add that duplicates an existing line is discarded',
    bogus[0].items.length, 1);
  check('a spices item gets no Amazon button', bogus[1].items[0].amazon, undefined);
  check('invented meal ids are dropped from `from`', bogus[1].items[0].from, ['curry']);

  const noFrom = [{ op: 'add', section: 'Produce', name: '1 leek', detail: '' }];
  check('an add with no usable `from` falls back to the meals that joined',
    applyRevisions(base(), noFrom, MEALS, [], ['tacos'])[0].items[1].from, ['tacos']);
  check('...and is skipped entirely when there is no fallback either',
    applyRevisions(base(), noFrom, MEALS, [])[0].items.length, 1);

  const twice = applyRevisions(base(), [
    { op: 'update', match: '2 yellow onions', name: '4 yellow onions', from: ['chili', 'curry'] },
    { op: 'update', match: '2 yellow onions', detail: 'second thoughts', name: '5 yellow onions', from: ['chili', 'curry'] }
  ], MEALS, []);
  check('a second op naming the old name still edits the live item, not an orphan',
    twice[0].items.map(i => i.name), ['5 yellow onions']);
}

// ── 11. Rearranging the week — free, and letters follow the meals ────────
{
  const list = produce([item('2 onions', ['curry'], 'Meal A'), { name: 'birthday candles' }]);
  // The curry moved to Thursday, so it is Meal C now.
  const out = relabelGroceries(list, [{ id: 'chili', label: 'Meal A' }, { id: 'curry', label: 'Meal C' }]);
  check('the tag follows the meal to its new letter', out[0].items[0].tag, 'Meal C');
  check('...and so does the colour', out[0].items[0].tagClass, 'tag-pasta');
  check('a hand-added item is left alone', out[0].items[1], { name: 'birthday candles' });
  check('relabelling twice changes nothing',
    JSON.stringify(relabelGroceries(out, [{ id: 'chili', label: 'Meal A' }, { id: 'curry', label: 'Meal C' }])),
    JSON.stringify(out));
}

// ── 12. Idempotence — CI re-fires on its own commit, so a second pass
//        MUST find nothing to do, or the workflow loops forever ──────────
{
  const settled = [{
    icon: '🥦', label: 'Produce',
    items: [{ name: '2 onions', detail: '', tag: 'Meals A+B', tagClass: 'tag-shared', amazon: 'x', from: ['chili', 'curry'] }]
  }];
  const week = { groceries: settled, groceriesFor: ['chili', 'curry'] };
  const d = weekDelta(week, ['curry', 'chili']);
  check('second pass sees no delta', d.added.length + d.removed.length, 0);
  check('...and relabelling is a no-op',
    JSON.stringify(relabelGroceries(settled, MEALS)), JSON.stringify(settled));
  check('...and applying no revisions changes nothing',
    JSON.stringify(applyRevisions(settled, [], MEALS, [])), JSON.stringify(settled));
}

console.log(failed ? `\n✗ ${failed} failing\n` : '\n✓ all passing\n');
process.exit(failed ? 1 : 0);

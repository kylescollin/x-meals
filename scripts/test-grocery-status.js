#!/usr/bin/env node
/* Tests for grocery-status.js. Run: node scripts/test-grocery-status.js
 *
 * The cases that matter most are the groceryPlan ones: they are the only
 * thing standing between "Kyle saved a half-planned week" and a model call.
 */
const GS = require('../grocery-status.js');
const { weekDelta } = require('./lib/week-merge.js');

let failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log('  ✓ ' + label); return; }
  failed++;
  console.log('  ✗ ' + label + '\n      expected ' + e + '\n      got      ' + a);
}

const meal = (id, ings) => ({ id, name: id, ings });
const produce = (items) => [{ icon: '🥦', label: 'Produce', items }];
const item = (name, from) => ({ name, detail: '', tag: 'Meal A', from });

// ── 1. Fingerprints ──────────────────────────────────────────────────────
{
  const ings = ['2 yellow onions', '1 lb ground beef'];
  check('same ings, same fingerprint', GS.ingsFingerprint(ings), GS.ingsFingerprint(ings.slice()));
  check('different ings, different fingerprint',
    GS.ingsFingerprint(ings) === GS.ingsFingerprint(['3 yellow onions', '1 lb ground beef']), false);
  check('fingerprint carries its version', /^1:[0-9a-z]+$/.test(GS.ingsFingerprint(ings)), true);
  check('a fresh fingerprint is known', GS.knownFingerprint(GS.ingsFingerprint(ings)), true);
  check('an old SHA-1 fingerprint is unknown', GS.knownFingerprint('3f2a9c01bd7e'), false);
  check('a missing fingerprint is unknown', GS.knownFingerprint(undefined), false);
  check('empty list has a fingerprint', typeof GS.ingsFingerprint(undefined), 'string');
}

// ── 2. Cookable meals ────────────────────────────────────────────────────
{
  const meals = [
    meal('chili', ['# For the pot', '2 onions', '# Toppings', 'sour cream']),
    { id: 'custom-pizza-night-x1', custom: true, name: 'Pizza night', ings: [] },
    meal('curry', ['1 can coconut milk'])
  ];
  const cook = GS.cookableMeals(meals);
  check('placeholders are dropped', cook.map(m => m.id), ['chili', 'curry']);
  check('section headers are stripped', cook[0].ings, ['2 onions', 'sour cream']);
  check('the original is untouched', meals[0].ings.length, 4);
  check('fingerprintsFor keys by id', Object.keys(GS.fingerprintsFor(cook)), ['chili', 'curry']);
  check('a header-only edit changes nothing',
    GS.ingsFingerprint(GS.cookableMeals([meal('a', ['# Sauce', '1 lime'])])[0].ings),
    GS.ingsFingerprint(GS.cookableMeals([meal('a', ['1 lime'])])[0].ings));
}

// ── 3. Owed ──────────────────────────────────────────────────────────────
{
  check('no stamps — not owed', GS.isOwed({}), false);
  check('requested, never served — owed', GS.isOwed({ groceriesRequested: '2026-10-24T18:00:00Z' }), true);
  check('served the same request — not owed',
    GS.isOwed({ groceriesRequested: 'r1', groceriesServed: 'r1' }), false);
  check('a newer request after an old serve — owed',
    GS.isOwed({ groceriesRequested: 'r2', groceriesServed: 'r1' }), true);
  check('null week — not owed', GS.isOwed(null), false);
}

// ── 4. Behind ────────────────────────────────────────────────────────────
{
  const chili = meal('chili', ['2 onions']), curry = meal('curry', ['1 lime']);
  const fp = GS.fingerprintsFor([chili, curry]);
  const upToDate = { groceries: produce([item('2 onions', ['chili'])]), groceriesFor: ['chili', 'curry'], groceriesIngs: fp };
  check('no cookable meals — never behind', GS.listBehind(upToDate, []), false);
  check('list built for these meals — not behind', GS.listBehind(upToDate, [chili, curry]), false);
  check('order of ids does not matter', GS.listBehind(upToDate, [curry, chili]), false);
  check('a meal joined — behind', GS.listBehind(upToDate, [chili, curry, meal('tacos', ['x'])]), true);
  check('a meal left — behind', GS.listBehind(upToDate, [chili]), true);
  check('a recipe was edited — behind',
    GS.listBehind(upToDate, [meal('chili', ['3 onions']), curry]), true);
  check('an unknown stored fingerprint is not a change',
    GS.listBehind({ groceries: upToDate.groceries, groceriesFor: ['chili', 'curry'],
      groceriesIngs: { chili: '3f2a9c01bd7e', curry: fp.curry } }, [chili, curry]), false);
  check('no list at all with meals — behind', GS.listBehind({ groceries: [] }, [chili]), true);
  check('no groceriesFor but items carry from — judged by from',
    GS.listBehind({ groceries: produce([item('2 onions', ['chili'])]) }, [chili]), false);
  check('legacy list (no from anywhere) — cannot tell, so not behind',
    GS.listBehind({ groceries: produce([{ name: '2 onions', tag: 'Meal A' }]) }, [chili]), false);
  check('hasList sees items', GS.hasList(upToDate), true);
  check('hasList ignores empty sections', GS.hasList({ groceries: [{ label: 'Produce', items: [] }] }), false);
}

// ── 5. The plan — what CI does with a week ───────────────────────────────
{
  const none = { added: [], removed: [], changed: [], legacy: false };
  const joined = { added: ['tacos'], removed: [], changed: [], legacy: false };
  const edited = { added: [], removed: [], changed: ['chili'], legacy: false };
  const legacy = { added: [], removed: [], changed: [], legacy: true };
  const plan = (o) => GS.groceryPlan(o).action;

  // Not owed: the only work allowed is free.
  check('not owed, nothing changed → relabel', plan({ owed: false, hasList: true, hasCookable: true, delta: none }), 'relabel');
  check('not owed, a meal joined → skip', plan({ owed: false, hasList: true, hasCookable: true, delta: joined }), 'skip');
  check('not owed, a recipe edited → skip', plan({ owed: false, hasList: true, hasCookable: true, delta: edited }), 'skip');
  check('not owed, no list yet → skip', plan({ owed: false, hasList: false, hasCookable: true, delta: joined }), 'skip');
  check('not owed, legacy list → skip', plan({ owed: false, hasList: true, hasCookable: true, delta: legacy }), 'skip');
  check('not owed, nothing cookable → skip', plan({ owed: false, hasList: false, hasCookable: false, delta: none }), 'skip');
  check('the skip reason says why',
    GS.groceryPlan({ owed: false, hasList: true, hasCookable: true, delta: joined }).reason,
    'list is behind (+1) — waiting for a request');

  // Owed: do whatever the week needs, then consume the request.
  check('owed, no list yet → build', plan({ owed: true, hasList: false, hasCookable: true, delta: joined }), 'build');
  check('owed, a meal joined → revise', plan({ owed: true, hasList: true, hasCookable: true, delta: joined }), 'revise');
  check('owed, a recipe edited → revise', plan({ owed: true, hasList: true, hasCookable: true, delta: edited }), 'revise');
  check('owed, nothing changed → serve (no model call)', plan({ owed: true, hasList: true, hasCookable: true, delta: none }), 'serve');
  check('owed, legacy list → build', plan({ owed: true, hasList: true, hasCookable: true, delta: legacy }), 'build');
  check('owed, nothing cookable → serve', plan({ owed: true, hasList: false, hasCookable: false, delta: none }), 'serve');

  // Force is the manual escape hatch and wins over everything but "nothing to shop for".
  check('force → build', plan({ owed: false, force: true, hasList: true, hasCookable: true, delta: none }), 'build');
  check('force with nothing cookable → skip', plan({ owed: false, force: true, hasList: false, hasCookable: false, delta: none }), 'skip');
}

// ── 6. weekDelta and the new fingerprints agree ──────────────────────────
{
  const chili = meal('chili', ['2 onions']);
  const fp = GS.fingerprintsFor([chili]);
  const week = { groceries: produce([item('2 onions', ['chili'])]), groceriesFor: ['chili'], groceriesIngs: fp };
  check('same fingerprint — nothing changed', weekDelta(week, ['chili'], fp).changed, []);
  check('new fingerprint — changed',
    weekDelta(week, ['chili'], GS.fingerprintsFor([meal('chili', ['3 onions'])])).changed, ['chili']);
  check('old SHA-1 fingerprint on file — not changed (backfilled for free instead)',
    weekDelta({ ...week, groceriesIngs: { chili: '3f2a9c01bd7e' } }, ['chili'], fp).changed, []);
}

console.log(failed ? `\n${failed} failing` : '\nAll grocery-status tests passed.');
process.exit(failed ? 1 : 0);

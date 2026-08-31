#!/usr/bin/env node
/* Tests for the meal-snapshot refresh. Run: node scripts/test-refresh-meals.js
 *
 * The case that matters most is idempotence: CI re-fires on its own commits,
 * so a second pass over refreshed data MUST change nothing.
 */
const { refreshWeekMeals } = require('./lib/refresh-meals.js');
const { same } = require('./lib/stable.js');

let failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log('  ✓ ' + label); return; }
  failed++;
  console.log('  ✗ ' + label + '\n      expected ' + e + '\n      got      ' + a);
}

const meal = (over) => Object.assign({
  id: 'turkey-burgers', label: 'Meal A', day: 'Tuesday', date: '9/1', icon: '🍔',
  name: 'Turkey Burgers', meta: '30 min · Stovetop · Serves 4',
  ings: ['1 lb ground turkey', '4 burger buns'], steps: ['Form patties.', 'Grill.']
}, over || {});

const recipe = (over) => Object.assign({
  id: 'turkey-burgers', icon: '🍔', name: 'Turkey Burgers',
  meta: '30 min · Stovetop · Serves 4',
  ingredients: ['1 lb ground turkey', '4 burger buns'],
  steps: ['Form patties.', 'Grill.']
}, over || {});

const byId = (r) => { const m = {}; (Array.isArray(r) ? r : [r]).forEach(x => { m[x.id] = x; }); return m; };

// ── 1. THE SCENARIO: an edited recipe reaches the week ───────────────────
{
  const week = { weekOf: '2026-08-30', meals: [meal()] };
  const edited = recipe({ ingredients: ['1 lb ground turkey', '4 burger buns', 'Sliced tomatoes', 'Cheddar Cheese slice'] });
  check('edited ingredients propagate', refreshWeekMeals(week, byId(edited)), true);
  check('...the snapshot now matches the recipe', week.meals[0].ings, edited.ingredients);
}

// ── 2. Name, meta, icon and steps propagate too ──────────────────────────
{
  const week = { meals: [meal()] };
  refreshWeekMeals(week, byId(recipe({
    name: 'Smash Turkey Burgers', meta: '25 min · Stovetop · Serves 4', icon: '🍳',
    steps: ['Smash patties.', 'Sear hard.']
  })));
  check('name follows the recipe', week.meals[0].name, 'Smash Turkey Burgers');
  check('meta follows the recipe', week.meals[0].meta, '25 min · Stovetop · Serves 4');
  check('icon follows the recipe', week.meals[0].icon, '🍳');
  check('steps follow the recipe', week.meals[0].steps, ['Smash patties.', 'Sear hard.']);
}

// ── 3 & 4. Already in sync — and idempotence ─────────────────────────────
{
  const week = { meals: [meal()] };
  const before = JSON.parse(JSON.stringify(week));
  check('in-sync week reports no change', refreshWeekMeals(week, byId(recipe())), false);
  check('...and is untouched', same(week, before), true);

  const drifted = { meals: [meal({ ings: ['old list'] })] };
  check('first pass changes it', refreshWeekMeals(drifted, byId(recipe())), true);
  check('SECOND PASS IS A NO-OP', refreshWeekMeals(drifted, byId(recipe())), false);
}

// ── 5 & 6. Meals the refresh must never touch ────────────────────────────
{
  const placeholder = { id: 'custom-pizza-night-m9x2k1', custom: true, icon: '🍽', name: 'Pizza night', meta: '', ings: [], steps: [], day: 'Tuesday' };
  const week = { meals: [Object.assign({}, placeholder)] };
  // Even a recipe whose id somehow collides must not touch a placeholder.
  check('placeholder meal untouched', refreshWeekMeals(week, byId(recipe({ id: 'custom-pizza-night-m9x2k1' }))), false);
  check('...still exactly itself', week.meals[0], placeholder);

  const unknown = { meals: [meal({ id: 'not-in-the-collection' })] };
  check('meal with no recipe entry untouched', refreshWeekMeals(unknown, byId(recipe())), false);
}

// ── 7. An empty recipe list never wipes a populated snapshot ─────────────
{
  const week = { meals: [meal()] };
  check('empty recipe ingredients change nothing',
    refreshWeekMeals(week, byId(recipe({ ingredients: [], steps: [] }))), false);
  check('...the snapshot keeps its ings', week.meals[0].ings, ['1 lb ground turkey', '4 burger buns']);
}

// ── 8. Notes: a week-specific tip survives; a missing note is gap-filled ─
{
  const tipped = { meals: [meal({ note: '💡 Josephine likes these extra crispy' })] };
  refreshWeekMeals(tipped, byId(recipe({ note: '💡 Generic recipe tip' })));
  check('a meal note is never overwritten', tipped.meals[0].note, '💡 Josephine likes these extra crispy');

  const bare = { meals: [meal()] };
  refreshWeekMeals(bare, byId(recipe({ note: '💡 Generic recipe tip' })));
  check('a missing note is gap-filled from the recipe', bare.meals[0].note, '💡 Generic recipe tip');
}

// ── 9. Week-specific fields are never the recipe's business ──────────────
{
  const week = { meals: [meal({ ings: ['old'] })] };
  refreshWeekMeals(week, byId(recipe({ label: 'Meal Z', day: 'Friday', date: '12/25' })));
  check('label/day/date stay the week\'s own',
    [week.meals[0].label, week.meals[0].day, week.meals[0].date], ['Meal A', 'Tuesday', '9/1']);
}

console.log(failed ? `\n✗ ${failed} failing\n` : '\n✓ all passing\n');
process.exit(failed ? 1 : 0);

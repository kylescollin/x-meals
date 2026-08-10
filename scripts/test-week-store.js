#!/usr/bin/env node
/* Tests for week-store.js against the real week files.
 *
 * week-store.js is browser code, so this stands up just enough of a window —
 * a fetch that serves data/weeks/ the way Firebase would, and a token stub —
 * and then exercises the parts that would be expensive to get wrong: the
 * start → key index, the guard against minting a duplicate key for a week
 * that already exists, hydration of old weeks, and grocery progress.
 *
 * Run: node scripts/test-week-store.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const weeksDir = path.join(root, 'data/weeks');

const weekFiles = {};
fs.readdirSync(weeksDir).filter(f => f.endsWith('.json')).forEach(f => {
  weekFiles[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(weeksDir, f), 'utf8'));
});

// Stand in for Firebase: shallow reads return keys, deep reads return the doc.
const flagStore = {};
function fakeFetch(url) {
  const clean = url.split('?')[0];
  const shallow = /shallow=true/.test(url);
  let body = null;
  if (clean.endsWith('/meals/weeks.json')) {
    body = shallow
      ? Object.fromEntries(Object.keys(weekFiles).map(k => [k, true]))
      : weekFiles;
  } else {
    let m = clean.match(/\/meals\/weeks\/(.+)\.json$/);
    if (m) body = weekFiles[m[1]] || null;
    m = clean.match(/\/groceries\/(.+)\.json$/);
    if (m) body = flagStore[m[1]] || null;
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

const sandbox = {
  fetch: fakeFetch,
  getToken: () => Promise.resolve('stub-token'),
  console
};
sandbox.window = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'week-utils.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'week-store.js'), 'utf8'), sandbox);

const { Week, WeekStore } = sandbox;

let failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log('  ✓ ' + label); return; }
  failed++;
  console.log('  ✗ ' + label + '\n      expected ' + e + '\n      got      ' + a);
}

(async function () {
  await WeekStore.loadIndex();
  const starts = WeekStore.starts();

  check('every week file is indexed', starts.length, Object.keys(weekFiles).length);
  check('index is sorted oldest first', starts.slice().sort(), starts);

  // The one that would have bitten on day one: the live week is stored under a
  // Monday, so asking for its Sunday must return the Monday, not mint a new
  // document that orphans the grocery list and every note on that week.
  for (const key of Object.keys(weekFiles)) {
    const start = Week.startOf(key);
    if (WeekStore.keyOrMint(start) !== key) {
      failed++;
      console.log(`  ✗ keyOrMint(${start}) returned ${WeekStore.keyOrMint(start)}, not the existing ${key}`);
    }
  }
  console.log('  ✓ keyOrMint returns the existing key for all ' + starts.length + ' weeks');

  // A week nobody has planned gets its own Sunday, and no existing week
  // may already occupy that bucket.
  const empty = Week.add(Week.todayStart(), 3);
  check('an unplanned week mints its Sunday', WeekStore.keyOrMint(empty), empty);
  check('...and it really is unplanned', WeekStore.keyFor(empty), null);

  // Day/date agreement through the store's own view of a week.
  let dateChecks = 0, dateBad = 0;
  for (const key of Object.keys(weekFiles)) {
    const week = await WeekStore.get(key);
    for (const meal of week.meals || []) {
      if (!meal.day || !meal.date) continue;
      dateChecks++;
      if (Week.dateForDay(Week.startOf(key), meal.day) !== meal.date) dateBad++;
    }
  }
  check(`${dateChecks} meal dates agree with their day names`, dateBad, 0);

  // Hydration: a meal with no ingredients gets them from the collection.
  const recipes = JSON.parse(fs.readFileSync(path.join(root, 'data/recipes.json'), 'utf8')).recipes;
  WeekStore.setRecipes(recipes);
  const target = recipes.find(r => (r.ingredients || r.ings || []).length);
  const hollow = WeekStore.hydrate({
    weekOf: '2020-01-05',
    meals: [{ id: target.id, name: target.name, ings: [], steps: [] },
            { id: 'custom-pizza-night-abc', custom: true, name: 'Pizza night', ings: [], steps: [] }]
  });
  check('an empty archived meal gets its ingredients back', hollow.meals[0].ings.length > 0, true);
  check('a placeholder meal is left alone', hollow.meals[1].ings, []);

  const kept = { id: target.id, name: target.name, ings: ['mine'], steps: ['mine'] };
  WeekStore.hydrate({ weekOf: '2020-01-05', meals: [kept] });
  check('a meal that already has ingredients is not overwritten', kept.ings, ['mine']);

  // Grocery progress counts only what's on the list, plus hand-added items.
  const sections = [{ label: 'Produce', items: [{ name: '2 yellow onions' }, { name: '1 lime' }] }];
  const flags = {
    [WeekStore.groceryKey('2 yellow onions')]: true,
    [WeekStore.groceryKey('something removed long ago')]: true,
    _custom: { 'x-1': { name: 'birthday candles' } }
  };
  check('progress counts the list plus custom items, ignoring stale flags',
    WeekStore.progress(sections, flags), { checked: 1, total: 3 });
  check('progress on an empty list', WeekStore.progress([], {}), { checked: 0, total: 0 });

  // The grocery key must match groceries.html byte for byte.
  const inline = (name) => String(name || '').trim().replace(/[^a-z0-9]/gi, '_').substring(0, 60);
  const samples = ['2 yellow onions', 'Crème fraîche (1 tbsp)', 'a'.repeat(80), '½ cup rice'];
  check('groceryKey matches the inline implementation',
    samples.map(WeekStore.groceryKey), samples.map(inline));

  console.log(failed ? `\n✗ ${failed} failing\n` : '\n✓ all passing\n');
  process.exit(failed ? 1 : 0);
})();

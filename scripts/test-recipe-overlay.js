#!/usr/bin/env node
/* Tests for the recipe overlay reconcile. Run: node scripts/test-recipe-overlay.js
 *
 * The case that matters most is the last one: CI re-fires on its own commit,
 * so a second pass over the first pass's output MUST produce no writes.
 */
const { toCore, isPending, reconcileRecipes } = require('./lib/recipe-overlay.js');
const { same } = require('./lib/stable.js');

let failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log('  ✓ ' + label); return; }
  failed++;
  console.log('  ✗ ' + label + '\n      expected ' + e + '\n      got      ' + a);
}

const NOW = 1700000000000;
const core = (over) => Object.assign({
  id: 'one-pan-coconut-curry-salmon', icon: '🥥', name: 'One-Pan Coconut Curry Salmon',
  meta: '30 min · One Pan · Serves 4', tags: ['Curry', 'Asian'],
  ingredients: ['4 salmon fillets', '1 (13.5 oz) can coconut milk'],
  steps: ['Sear.', 'Simmer.']
}, over || {});
const overlay = (over) => Object.assign(toCore(core()), over || {});

// ── 1. THE SCENARIO: a phone edit whose commit never landed wins ─────────
{
  const o = overlay({ ingredients: ['4 salmon fillets', '2 (13.5 oz) cans coconut milk'], editedAt: 100 });
  const r = reconcileRecipes([core()], { 'one-pan-coconut-curry-salmon': o }, NOW);
  check('pending overlay is upserted into the collection', r.coreChanged, true);
  check('...with its ingredients', r.recipes[0].ingredients, ['4 salmon fillets', '2 (13.5 oz) cans coconut milk']);
  check('...and is stamped committed at its own editedAt',
    r.overlayWrites, { 'one-pan-coconut-curry-salmon/committedAt': 100 });
}

// ── 2. A pending overlay with no tags keeps the collection's ────────────
{
  const o = overlay({ tags: [], ingredients: ['new list'], editedAt: 100 });
  delete o.tags;
  const r = reconcileRecipes([core({ source: 'https://example.com/salmon' })], { k: o }, NOW);
  check('tags gap-filled from the collection', r.recipes[0].tags, ['Curry', 'Asian']);
  check('source gap-filled from the collection', r.recipes[0].source, 'https://example.com/salmon');
}

// ── 3. A pending overlay for a recipe not yet in the collection is added ─
{
  const o = overlay({ id: 'brand-new', name: 'Brand New', editedAt: 5 });
  const r = reconcileRecipes([core()], { 'brand-new': o }, NOW);
  check('new recipe appended', r.recipes.map(x => x.id), ['one-pan-coconut-curry-salmon', 'brand-new']);
  check('...and stamped', r.overlayWrites, { 'brand-new/committedAt': 5 });
}

// ── 4. Committed overlay, collection edited in git since: collection wins ─
{
  const o = overlay({ ingredients: ['old list'], editedAt: 100, committedAt: 100 });
  const r = reconcileRecipes([core()], { k: o }, NOW);
  check('collection untouched', r.coreChanged, false);
  const w = r.overlayWrites.k;
  check('overlay mirrored from the collection', w && w.ingredients, core().ingredients);
  check('...with fresh, equal stamps', [w.editedAt, w.committedAt], [NOW, NOW]);
  check('...and no week-only fields', Object.keys(w).sort(),
    ['committedAt', 'editedAt', 'icon', 'id', 'ingredients', 'meta', 'name', 'steps', 'tags']);
}

// ── 5. Committed and identical: nothing at all ───────────────────────────
{
  const o = overlay({ editedAt: 100, committedAt: 100 });
  const r = reconcileRecipes([core()], { k: o }, NOW);
  check('no collection change', r.coreChanged, false);
  check('no overlay writes', r.overlayWrites, {});
  check('nothing skipped', r.skipped, []);
}

// ── 6. Legacy overlay (no stamps): collection wins, and it gets stamped ──
{
  const stale = overlay({ ingredients: ['pre-stamp edit'], label: 'Meal B', day: 'Wednesday', date: '6/3' });
  const r = reconcileRecipes([core()], { k: stale }, NOW);
  check('legacy overlay never rewrites the collection', r.coreChanged, false);
  check('legacy overlay replaced by a stamped mirror', r.overlayWrites.k && r.overlayWrites.k.ingredients, core().ingredients);

  const identical = overlay();   // same content, just never stamped
  const r2 = reconcileRecipes([core()], { k: identical }, NOW);
  check('identical legacy overlay only gains stamps', r2.overlayWrites, { 'k/editedAt': NOW, 'k/committedAt': NOW });
}

// ── 7. A committed overlay whose recipe left the collection is left alone ─
{
  const o = overlay({ id: 'gone', editedAt: 1, committedAt: 1 });
  const r = reconcileRecipes([core()], { gone: o }, NOW);
  check('skipped, not written', [r.skipped, r.overlayWrites], [['gone'], {}]);
}

// ── 8. isPending / toCore edge cases ─────────────────────────────────────
{
  check('missing committedAt is pending', isPending({ editedAt: 1 }), true);
  check('older committedAt is pending', isPending({ editedAt: 2, committedAt: 1 }), true);
  check('equal stamps are not pending', isPending({ editedAt: 2, committedAt: 2 }), false);
  check('no editedAt is never pending', isPending({ committedAt: 2 }), false);
  check('toCore reads ings when ingredients is absent', toCore({ id: 'x', ings: ['a'] }).ingredients, ['a']);
  check('toCore drops stamps and week fields',
    Object.keys(toCore({ id: 'x', editedAt: 1, committedAt: 1, label: 'Meal A', day: 'Mon' })).sort(),
    ['icon', 'id', 'ingredients', 'meta', 'name', 'steps', 'tags']);
  check('toCore keeps an empty note out', 'note' in toCore({ id: 'x', note: '' }), false);
}

// ── 9. SECOND PASS IS A NO-OP ────────────────────────────────────────────
{
  const overlays = {
    pending:   overlay({ id: 'p', name: 'P', ingredients: ['edited'], editedAt: 50 }),
    stale:     overlay({ id: 's', name: 'S', ingredients: ['old'], editedAt: 1, committedAt: 1 }),
    legacy:    overlay({ id: 'l', name: 'L', ingredients: ['legacy'] }),
    fine:      overlay({ id: 'f', name: 'F', editedAt: 9, committedAt: 9 })
  };
  const collection = [
    core({ id: 'p', name: 'P', ingredients: ['original'] }),
    core({ id: 's', name: 'S', ingredients: ['git edit'] }),
    core({ id: 'l', name: 'L', ingredients: ['hand reconciled'] }),
    core({ id: 'f', name: 'F' })
  ];
  const first = reconcileRecipes(collection, overlays, NOW);
  check('first pass changes the collection', first.coreChanged, true);
  check('first pass writes three overlays', Object.keys(first.overlayWrites).sort(), ['legacy', 'pending/committedAt', 'stale']);

  // Apply the writes the way Firebase's multi-path update would.
  const after = JSON.parse(JSON.stringify(overlays));
  Object.keys(first.overlayWrites).forEach(path => {
    const [key, field] = path.split('/');
    if (field) after[key][field] = first.overlayWrites[path];
    else after[key] = first.overlayWrites[path];
  });
  const second = reconcileRecipes(first.recipes, after, NOW + 1);
  check('SECOND PASS changes nothing in the collection', second.coreChanged, false);
  check('SECOND PASS writes no overlays', second.overlayWrites, {});
  check('SECOND PASS returns the same collection', same(second.recipes, first.recipes), true);
}

console.log(failed ? `\n✗ ${failed} failing\n` : '\n✓ all passing\n');
process.exit(failed ? 1 : 0);

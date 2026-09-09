/* Fox & Bear Kitchen — keeping the two copies of every recipe in step.
 *
 * A recipe lives twice. data/recipes.json is what CI reads when it refreshes a
 * week's meal snapshots and builds the grocery list. The Firebase overlay at
 * /recipe-edits/<key> is what the site shows the moment an edit is saved on a
 * phone. The phone writes both — but a commit can fail, and an edit made in
 * git (Agent X, a Claude session) never touches the overlay at all. Either
 * way the two drift, and the week gets shopped for a recipe nobody cooks.
 *
 * The overlay carries two stamps that say which copy is newer:
 *   editedAt    — when the phone saved this edit
 *   committedAt — set once the same edit is in data/recipes.json
 * committedAt < editedAt (or missing) means the commit never landed: the
 * overlay is "pending" and wins. Equal stamps but different content means
 * recipes.json moved since: the collection wins and is mirrored back. Same
 * content either way: nothing to do — which is what makes a second pass over
 * this function's own output a no-op, and CI re-fires on its own commits.
 *
 * Pure: (recipes, overlays, now) → what to write. No I/O here.
 */
'use strict';
const { same } = require('./stable.js');

// The data/recipes.json shape. Must match toCoreRecipe in recipe-card.js —
// both sides compare through this, so any field one keeps and the other
// drops would read as a change on every run.
function toCore(r) {
  const core = {
    id:          r.id,
    icon:        r.icon,
    name:        r.name,
    meta:        r.meta,
    tags:        (r.tags || []).slice(),
    ingredients: (r.ingredients || r.ings || []).slice(),
    steps:       (r.steps || []).slice()
  };
  if (r.note)   core.note   = r.note;
  if (r.source) core.source = r.source;
  return core;
}

function isPending(o) {
  return !!(o && o.editedAt && (!o.committedAt || o.committedAt < o.editedAt));
}

/**
 * @param coreRecipes  the `recipes` array of data/recipes.json
 * @param overlays     the /recipe-edits node: key → overlay
 * @param now          ms timestamp for stamps written this run
 * @returns {recipes, coreChanged, overlayWrites, skipped}
 *   recipes        — the reconciled collection (new array; entries replaced wholesale)
 *   coreChanged    — whether data/recipes.json needs writing
 *   overlayWrites  — a multi-path update for /recipe-edits: "<key>/committedAt"
 *                    stamps for pending edits now in the collection, "<key>"
 *                    whole-overlay mirrors where the collection won
 *   skipped        — overlay keys left alone (a committed overlay whose recipe
 *                    is no longer in the collection)
 */
function reconcileRecipes(coreRecipes, overlays, now) {
  const recipes = (coreRecipes || []).slice();
  const index = {};
  recipes.forEach((r, i) => { if (r && r.id) index[r.id] = i; });

  const overlayWrites = {};
  const skipped = [];
  let coreChanged = false;

  Object.keys(overlays || {}).forEach(key => {
    const o = overlays[key];
    if (!o || !o.id) return;
    const idx  = index[o.id];
    const core = idx === undefined ? null : recipes[idx];

    if (isPending(o)) {
      // The phone's edit never reached the collection. It wins — but the
      // overlay was saved from a form that has no tags or source field of its
      // own for older entries, so those are gap-filled from what we have.
      const next = toCore(o);
      if (core) {
        if (!next.tags.length && core.tags && core.tags.length) next.tags = core.tags.slice();
        if (!next.source && core.source) next.source = core.source;
      }
      if (!core) {
        recipes.push(next);
        index[o.id] = recipes.length - 1;
        coreChanged = true;
      } else if (!same(toCore(core), next)) {
        recipes[idx] = next;
        coreChanged = true;
      }
      overlayWrites[key + '/committedAt'] = o.editedAt;
      return;
    }

    if (!core) { skipped.push(key); return; }

    // Committed and identical: nothing to do. Committed but different: the
    // collection moved since (a git-side edit) and the overlay is stale, so
    // mirror the collection back with fresh stamps. Overlays written before
    // the stamps existed (no editedAt) take this path too: every one of them
    // was folded into recipes.json by hand on 2026-09-08, so the collection
    // is the newer copy, and this is what finally stamps them.
    if (!same(toCore(core), toCore(o))) {
      const mirror = toCore(core);
      mirror.editedAt = now;
      mirror.committedAt = now;
      overlayWrites[key] = mirror;
    } else if (!o.editedAt) {
      overlayWrites[key + '/editedAt'] = now;
      overlayWrites[key + '/committedAt'] = now;
    }
  });

  return { recipes, coreChanged, overlayWrites, skipped };
}

module.exports = { toCore, isPending, reconcileRecipes };

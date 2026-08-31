/* Fox & Bear Kitchen — bringing a week's meal snapshots in line with the
 * recipe collection.
 *
 * A week file embeds a copy of each meal's ingredients and steps, taken the
 * moment the meal was added. Editing the recipe afterwards used to change
 * nothing: the week kept its snapshot forever, and the grocery delta — which
 * compares meal ids, not ingredients — never noticed. This is the missing
 * half: refresh the snapshot from data/recipes.json, and the fingerprint in
 * generate-groceries.js does the rest.
 *
 * Pure and idempotent by construction: the output is a function of only
 * (week, recipesById), so a second pass over its own output changes nothing —
 * which is what CI needs, since it re-fires on its own commits.
 */
'use strict';
const { same } = require('./stable.js');

/**
 * Mutates `week` so each meal snapshot matches its canonical recipe.
 * Returns true if anything changed.
 *
 *  - placeholder meals (custom) and ids not in recipesById are untouched
 *  - recipes.json spells the field `ingredients`; week meals use `ings`
 *  - ings/steps only overwrite when the recipe actually has them — an entry
 *    with an empty list must never wipe a populated snapshot
 *  - `note` is gap-fill only (same rule as WeekStore.hydrate): a meal note can
 *    be a week-specific tip Agent X wrote, so it is never overwritten
 *  - label/day/date are week-specific and never touched
 */
function refreshWeekMeals(week, recipesById) {
  let changed = false;
  ((week && week.meals) || []).forEach(meal => {
    if (!meal || meal.custom === true || /^custom-/.test(meal.id || '')) return;
    const r = recipesById[meal.id];
    if (!r) return;

    const next = {};
    if (r.icon) next.icon = r.icon;
    if (r.name) next.name = r.name;
    if (r.meta !== undefined && r.meta !== null) next.meta = r.meta;
    const rIngs = r.ingredients || r.ings || [];
    const rSteps = r.steps || [];
    if (rIngs.length) next.ings = rIngs.slice();
    if (rSteps.length) next.steps = rSteps.slice();

    Object.keys(next).forEach(k => {
      if (!same(meal[k], next[k])) { meal[k] = next[k]; changed = true; }
    });
    if (!meal.note && r.note) { meal.note = r.note; changed = true; }
  });
  return changed;
}

module.exports = { refreshWeekMeals };

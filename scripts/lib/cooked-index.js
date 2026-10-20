/* Fox & Bear Kitchen — which recipes were cooked when.
 *
 * Builds { <safe recipe id>: ["YYYY-MM-DD", …] } from every week file: one
 * date per night a recipe was planned, newest first. sync-firebase.js writes
 * it to /meals/cooked so a card can say "Last cooked Sep 14" without fetching
 * every week.
 *
 * Future nights are included on purpose. The browser keeps only dates before
 * today, so a planned meal turns into a cooked one as the days pass — no CI
 * run needed for time to move.
 *
 * The date of a night is Week.startOf(weekOf) + the day's offset, never the
 * raw key: the keys we inherited land on Mondays and Thursdays, and the only
 * thing that agrees with the labels on the site is the canonical Sunday. A
 * meal with no (or an unknown) day falls back to that Sunday.
 */
'use strict';

const Week = require('../../week-utils.js');

// Same substitution the browser's fbSafeKey makes, so a lookup by recipe id
// lands on the same node.
function safeKey(id) {
  return String(id).replace(/[.#$[\]]/g, '_');
}

function nightOf(weekOf, day) {
  const start = Week.startOf(weekOf);
  if (!start) return '';
  const i = Week.DAYS.indexOf(day);
  if (i <= 0) return start;
  const d = Week.parse(start);
  d.setDate(d.getDate() + i);
  return Week.iso(d);
}

function cookedIndex(weeks) {
  const seen = {};
  (weeks || []).forEach(week => {
    if (!week || !week.weekOf) return;
    (week.meals || []).forEach(m => {
      if (!m || !m.id || m.custom) return;
      const date = nightOf(week.weekOf, m.day);
      if (!date) return;
      const k = safeKey(m.id);
      (seen[k] = seen[k] || {})[date] = true;
    });
  });
  const out = {};
  Object.keys(seen).sort().forEach(k => {
    out[k] = Object.keys(seen[k]).sort().reverse();
  });
  return out;
}

module.exports = { cookedIndex, nightOf, safeKey };

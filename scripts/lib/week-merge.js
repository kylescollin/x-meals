/* Fox & Bear Kitchen — reconciling a regenerated grocery list with the one
 * already on the fridge.
 *
 * The problem this solves is narrower and sharper than "don't overwrite the
 * list". Grocery check state is stored per item under a key derived from the
 * item's RENDERED NAME (see groceryKey below, and grocery-sheet.js). So if a
 * regeneration renames "3 medium yellow onions" to "2 yellow onions", the key
 * changes and an item you already ticked off comes back unchecked — while you
 * are standing in the shop.
 *
 * So: regenerate the whole week (the model's real strength is consolidating
 * one onion line across three meals, which it can only do if it sees every
 * meal), then reconcile the result against the existing list, preserving the
 * exact name of anything currently checked.
 *
 * Each generated item carries `from: [mealId, ...]` — which meals it exists
 * for. That is what lets us tell "you added this by hand" from "this belonged
 * to a meal that has since been removed".
 */
'use strict';

// MUST stay byte-identical to groceryKey() in week-store.js, which is what the
// browser writes checkboxes with. If these two ever disagree, every checkbox on
// the site silently detaches from its item.
function groceryKey(name) {
  return String(name || '').trim().replace(/[^a-z0-9]/gi, '_').substring(0, 60);
}

// Leading quantities vary between generations ("3 medium yellow onions" vs
// "2 yellow onions"), so they can't be part of identity. Strip the quantity,
// the unit, punctuation and a trailing plural, and compare what's left.
const UNIT = '(?:cups?|cup|tbsps?|tbsp|tablespoons?|tsps?|tsp|teaspoons?|lbs?|pounds?|ozs?|oz|ounces?|g|kg|ml|l|liters?|cloves?|heads?|cans?|jars?|bunch(?:es)?|pinch(?:es)?|dash(?:es)?|bags?|boxes|packages?|pkgs?|sprigs?|slices?|sticks?|medium|large|small|whole)';
const LEAD = new RegExp('^[\\d½⅓⅔¼¾⅛\\s/.,–-]+\\s*' + UNIT + '?\\.?\\s*', 'i');

function norm(name) {
  return String(name || '')
    .toLowerCase()
    .replace(LEAD, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/s$/, '');
}

function sectionKey(label) {
  const l = String(label || '').toLowerCase();
  if (l.includes('produce')) return 'produce';
  if (l.includes('protein')) return 'protein';
  if (l.includes('dairy') || l.includes('refrigerat')) return 'dairy';
  if (l.includes('spice')) return 'spices';
  return 'pantry';
}

function eachItem(sections) {
  const out = [];
  (sections || []).forEach(sec => {
    (sec.items || []).forEach(item => out.push({ item, sec, key: sectionKey(sec.label) }));
  });
  return out;
}

/**
 * Is regeneration needed at all?
 *
 * This is what makes the CI step idempotent: a second run over an unchanged
 * tree does nothing, writes nothing, and produces no commit. That guarantee
 * doesn't depend on GitHub's push-trigger rules.
 *
 * A week is covered when every cookable meal already has items attributed to
 * it and no item still points at a meal that has left the week.
 */
function isCovered(sections, mealIds) {
  const items = eachItem(sections).map(e => e.item);
  if (!items.length) return false;

  // A list with no provenance anywhere is a legacy list. We can't tell what
  // covers what, so treat it as covered — an old list is never touched until
  // something actually changes about the week.
  const withFrom = items.filter(i => Array.isArray(i.from) && i.from.length);
  if (!withFrom.length) return true;

  const covered = new Set();
  let stale = false;
  withFrom.forEach(i => i.from.forEach(id => {
    if (mealIds.includes(id)) covered.add(id); else stale = true;
  }));

  return !stale && mealIds.every(id => covered.has(id));
}

/**
 * Reconcile freshly generated sections against the existing list.
 *
 * @param {Array}  oldSections  what's on the list now
 * @param {Array}  newSections  what the model just generated for the whole week
 * @param {Array}  mealIds      cookable meal ids currently in the week
 * @param {Set}    checkedKeys  grocery keys currently ticked off
 * @returns {Array} the merged sections
 */
function mergeGroceries(oldSections, newSections, mealIds, checkedKeys) {
  const checked = checkedKeys instanceof Set ? checkedKeys : new Set(checkedKeys || []);
  const ids = new Set(mealIds || []);

  const old = eachItem(oldSections);
  const hasProvenance = old.some(e => Array.isArray(e.item.from) && e.item.from.length);

  // Items with no `from` are either hand-added or from before provenance
  // existed. Either way we didn't create them, so we never delete or rename
  // them. On a legacy list that's everything.
  const pinned = old.filter(e => !Array.isArray(e.item.from) || !e.item.from.length);
  const live = old.filter(e =>
    Array.isArray(e.item.from) && e.item.from.length && e.item.from.some(id => ids.has(id))
  );

  // Index the survivors so a new item can find its predecessor.
  const byName = new Map();
  [...live, ...pinned].forEach(e => {
    const n = norm(e.item.name);
    if (n && !byName.has(n)) byName.set(n, e);
  });

  const usedOld = new Set();
  const merged = new Map();   // sectionKey → {icon, label, note, items:[]}

  function bucket(sec) {
    const k = sectionKey(sec.label);
    if (!merged.has(k)) {
      merged.set(k, { icon: sec.icon, label: sec.label, note: sec.note, items: [] });
    }
    const b = merged.get(k);
    if (sec.note && !b.note) b.note = sec.note;
    return b;
  }

  for (const { item: fresh, sec } of eachItem(newSections)) {
    const prior = byName.get(norm(fresh.name));
    const out = Object.assign({}, fresh);

    if (prior && !usedOld.has(prior.item)) {
      usedOld.add(prior.item);
      // The whole point: if it's ticked off, the name is frozen. Everything
      // else about the item — which meals it's for, the quantity note, the
      // Amazon term — is still allowed to update.
      if (checked.has(groceryKey(prior.item.name))) out.name = prior.item.name;
    }
    bucket(sec).items.push(out);
  }

  // Hand-added and legacy items always survive, at the end of their section.
  for (const e of pinned) {
    if (usedOld.has(e.item)) continue;
    bucket(e.sec).items.push(e.item);
  }

  // On a legacy list (no provenance at all), keep every old item too — we
  // can't prove any of them belonged to a meal, so dropping one would be a
  // guess, and a wrong guess loses something you meant to buy.
  if (!hasProvenance) {
    for (const e of old) {
      if (usedOld.has(e.item) || pinned.includes(e)) continue;
      bucket(e.sec).items.push(e.item);
    }
  }

  const ORDER = ['produce', 'protein', 'dairy', 'pantry', 'spices'];
  return ORDER
    .filter(k => merged.has(k) && merged.get(k).items.length)
    .map(k => {
      const b = merged.get(k);
      const sec = { icon: b.icon, label: b.label, items: b.items };
      if (b.note) sec.note = b.note;
      return sec;
    });
}

module.exports = { groceryKey, norm, sectionKey, isCovered, mergeGroceries };

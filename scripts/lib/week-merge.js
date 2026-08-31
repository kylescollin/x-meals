/* Fox & Bear Kitchen — keeping a week's grocery list in step with its meals.
 *
 * Two jobs live here.
 *
 * The first is the DELTA: what actually changed about a week. Rearranging the
 * nights, or dropping in a "Pizza night" placeholder, changes nothing about
 * what you have to buy, so it must cost nothing — no model call, no rewrite of
 * lines somebody may already have ticked off. Adding one recipe should add one
 * recipe's worth of items; removing one should remove one's. weekDelta,
 * pruneRemoved, applyRevisions and relabelGroceries are that machinery, and
 * all of them are pure.
 *
 * The second is the MERGE, which is only used now for a list being built from
 * scratch:
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

// This file only ever runs under node (the browser keeps its own copy of
// groceryKey in week-store.js for exactly that reason), so crypto is fine.
const crypto = require('crypto');
const { stable } = require('./stable.js');

// MUST stay byte-identical to groceryKey() in week-store.js, which is what the
// browser writes checkboxes with. If these two ever disagree, every checkbox on
// the site silently detaches from its item.
function groceryKey(name) {
  return String(name || '').trim().replace(/[^a-z0-9]/gi, '_').substring(0, 60);
}

/**
 * Stable 12-hex fingerprint of a meal's ingredient list, stored per meal as
 * `groceriesIngs` next to `groceriesFor`. Same ings, same hash — which is what
 * lets the second CI pass prove nothing changed. Callers hash the
 * SECTION-STRIPPED ings (what cookableMeals produces), so editing only a
 * "# For the sauce" header never looks like a shopping change.
 */
function ingsFingerprint(ings) {
  return crypto.createHash('sha1').update(stable(ings || [])).digest('hex').slice(0, 12);
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

// The five sections, in shopping order. A list always comes back in this
// order with empty sections dropped, however it was assembled.
const SECTION = {
  produce: { icon: '🥦', label: 'Produce' },
  protein: { icon: '🥩', label: 'Protein' },
  dairy:   { icon: '🧈', label: 'Dairy & Refrigerated' },
  pantry:  { icon: '🫙', label: 'Pantry & Canned' },
  spices:  { icon: '🌿', label: 'Spices', note: 'Check pantry before ordering — you likely have most of these.' }
};

const ORDER = ['produce', 'protein', 'dairy', 'pantry', 'spices'];

function orderSections(sections) {
  return ORDER
    .map(k => (sections || []).find(s => sectionKey(s.label) === k))
    .filter(s => s && s.items && s.items.length);
}

// ── Tags ──────────────────────────────────────────────────────────────────
// A tag ("Meal A", "Meals A+C", "All meals") is display only — it is derived
// from `from` plus whatever letters the meals currently carry, never trusted
// from the model and never stored as the source of truth. That's what lets a
// reorder be fixed for free: the ids didn't move, only the letters did.

// A/B/C keep their original names for backward-compat with existing data and
// history; D–G are newer.
const LETTER_CLASS = {
  A: 'tag-chili', B: 'tag-cauliflower', C: 'tag-pasta',
  D: 'tag-d', E: 'tag-e', F: 'tag-f', G: 'tag-g'
};

function getTagClass(tag) {
  if (tag === 'All meals') return 'tag-all';
  const single = /^Meal ([A-G])$/.exec(tag);
  if (single) return LETTER_CLASS[single[1]] || 'tag-shared';
  return 'tag-shared';                                   // "Meals A+C"
}

// meals → { id: 'A' }, from each meal's current label.
function letterMap(meals) {
  const out = {};
  (meals || []).forEach(m => {
    const l = /^Meal ([A-G])$/.exec(m && m.label || '');
    if (l) out[m.id] = l[1];
  });
  return out;
}

// The ids an item is for → the tag to print for it.
function tagFor(from, meals) {
  const letters = letterMap(meals);
  const mine = (from || []).map(id => letters[id]).filter(Boolean).sort();
  const total = Object.keys(letters).length;
  if (!mine.length) return 'Meal A';
  if (total > 1 && mine.length === total) return 'All meals';
  if (mine.length === 1) return 'Meal ' + mine[0];
  return 'Meals ' + mine.join('+');
}

// Stamp tag + tagClass on an item from its `from`. Mutates and returns it.
function retag(item, meals) {
  item.tag = tagFor(item.from, meals);
  item.tagClass = getTagClass(item.tag);
  return item;
}

// ── Subtitles ─────────────────────────────────────────────────────────────
// The tag pill already says which meal a line is for, so the subtitle has no
// business saying it again. Older lists read "Fish tacos · slaw base"; this
// leaves just "slaw base".
const DETAIL_STOP = new Set(['with', 'and', 'the', 'a', 'in', 'of', 'for', 'on']);

function words(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !DETAIL_STOP.has(w));
}

/**
 * Drop any "·"-separated segment of a detail that is just a meal's name.
 *
 * Deliberately cautious — this rewrites text people are reading off a phone in
 * a shop. A segment goes only if EVERY word in it appears in some meal's name
 * AND it has two or more words: that floor is what stops a real usage note like
 * "burrata" being eaten by a meal called "Creamy Tomato Gnocchi with Burrata".
 * If nothing would survive, the detail is left exactly as it was.
 *
 * Idempotent: once the meal-name segments are gone, a second pass matches
 * nothing. That's what keeps CI from looping on its own commit.
 */
function stripMealNames(detail, meals) {
  const text = String(detail || '');
  if (!text) return text;

  const names = (meals || []).map(m => new Set(words(m && m.name)));
  if (!names.length) return text;

  const segments = text.split('·').map(s => s.trim());
  const kept = segments.filter(seg => {
    const w = words(seg);
    if (w.length < 2) return true;
    return !names.some(name => name.size && w.every(x => name.has(x)));
  });

  if (!kept.length || kept.length === segments.length) return text;
  return kept.join(' · ');
}

// "Meals A+C" → the ids of the meals labelled Meal A and Meal C. Only used to
// repair a generated item whose `from` the model left out or invented.
function fromTag(tag, meals) {
  const ids = (meals || []).map(m => m.id);
  if (tag === 'All meals') return ids;
  const letters = String(tag || '').match(/[A-G]/g) || [];
  const picked = letters
    .map(l => (meals || []).find(m => m.label === 'Meal ' + l))
    .filter(Boolean).map(m => m.id);
  return picked.length ? picked : ids;
}

// ── What changed about this week ──────────────────────────────────────────
/**
 * The one question the pipeline asks before doing anything: which meals joined
 * this week's list, and which left?
 *
 * `week.groceriesFor` — the cookable ids the list was last built for — is the
 * authority. Deriving the answer from item `from` alone isn't safe: a meal
 * whose every ingredient consolidated into another meal's line would look
 * uncovered forever, and since CI re-fires on its own commit, that loops.
 * groceriesFor makes the second run provably a no-op.
 *
 * Weeks written before groceriesFor existed fall back to the union of `from`,
 * and weeks with neither are `legacy` — we can't tell what covers what, so we
 * leave them alone unless explicitly asked to rebuild.
 *
 * `ingsById` — current fingerprint per meal id (see ingsFingerprint) — is
 * optional. When given, a meal that stayed on the plan but whose stored
 * `groceriesIngs` fingerprint no longer matches comes back in `changed`: its
 * recipe was edited. A meal with no stored fingerprint (a list from before
 * fingerprints existed) reports nothing — we can't tell, and the write path
 * backfills the baseline.
 *
 * @returns {{added: string[], removed: string[], changed: string[], legacy: boolean}}
 */
function weekDelta(week, mealIds, ingsById) {
  const ids = mealIds || [];
  const items = eachItem((week || {}).groceries).map(e => e.item);

  let covers = null;
  if (Array.isArray(week && week.groceriesFor)) {
    covers = week.groceriesFor;
  } else if (items.length) {
    const union = new Set();
    items.forEach(i => (Array.isArray(i.from) ? i.from : []).forEach(id => union.add(id)));
    if (union.size) covers = [...union];
  } else {
    covers = [];                       // no list at all — everything is new
  }

  if (!covers) return { added: [], removed: [], changed: [], legacy: true };

  const have = new Set(covers);
  const want = new Set(ids);
  // Only a meal in BOTH sets can be "changed" — one that joined or left gets
  // the full add/remove treatment already.
  const prev = (week && week.groceriesIngs) || null;
  const changed = (!prev || !ingsById) ? [] :
    ids.filter(id => have.has(id) && prev[id] && ingsById[id] && prev[id] !== ingsById[id]);

  return {
    added: ids.filter(id => !have.has(id)),
    removed: covers.filter(id => !want.has(id)),
    changed,
    legacy: false
  };
}

// ── Removing a meal ───────────────────────────────────────────────────────
/**
 * Take the departed meals out of the list, with no model involved.
 *
 * An item only that meal needed goes. An item shared with a meal that's still
 * on the plan stays, with the departed id stripped and its tag corrected — but
 * its quantity is now too high, so it comes back in `shared` for the caller to
 * have the model shrink. Hand-added items (no `from`) are never touched.
 *
 * @returns {{sections: Array, shared: Array}}
 */
function pruneRemoved(sections, removedIds, meals) {
  const gone = new Set(removedIds || []);
  const shared = [];

  const kept = (sections || []).map(sec => {
    const items = [];
    (sec.items || []).forEach(item => {
      const from = Array.isArray(item.from) ? item.from : null;
      if (!from || !from.length) { items.push(item); return; }   // hand-added / legacy
      const survivors = from.filter(id => !gone.has(id));
      if (!survivors.length) return;                             // nothing left needs it
      if (survivors.length === from.length) { items.push(item); return; }
      const next = retag(Object.assign({}, item, { from: survivors }), meals);
      items.push(next);
      shared.push(next);                                         // quantity is now too high
    });
    return Object.assign({}, sec, { items });
  }).filter(sec => sec.items.length);

  return { sections: orderSections(kept), shared };
}

// ── Applying the model's revisions ────────────────────────────────────────
/**
 * Apply a scoped set of operations to the list. The model proposes; every
 * decision that could detach a checkbox is made here.
 *
 *   { op: 'add',    section, name, detail, amazon, from }
 *   { op: 'update', match: '<exact existing name>', name, detail, from }
 *   { op: 'remove', match: '<exact existing name>' }
 *
 * Guards, all deterministic:
 *  - a `remove` only lands on an unticked, CI-owned line needed exclusively by
 *    meals in `removableIds` (the recipe-changed meals). Hand-added lines
 *    (no `from`), ticked lines, and lines shared with an unchanged meal are
 *    untouchable; with `removableIds` omitted, removes are disabled outright
 *  - an `update` whose `match` isn't on the list is ignored
 *  - an `update` on a TICKED item keeps the old name (its checkbox key) and
 *    takes only detail/from — the same rule mergeGroceries has always applied
 *  - `from` is filtered to real meal ids; an `add` that ends up with none falls
 *    back to `fallbackFrom` (the meals that joined) rather than being dropped —
 *    an item with no provenance would be unprunable forever, and a lost
 *    ingredient is worse than a mislabelled one
 *  - tag and tagClass are always recomputed here, never taken from the model
 */
function applyRevisions(sections, revisions, meals, checkedKeys, fallbackFrom, removableIds) {
  const checked = checkedKeys instanceof Set ? checkedKeys : new Set(checkedKeys || []);
  const ids = new Set((meals || []).map(m => m.id));
  const removable = new Set(removableIds || []);

  const out = (sections || []).map(sec => Object.assign({}, sec, { items: (sec.items || []).slice() }));
  const byName = new Map();
  eachItem(out).forEach(e => { if (!byName.has(e.item.name)) byName.set(e.item.name, e); });

  function bucketFor(label) {
    const k = sectionKey(label);
    let sec = out.find(s => sectionKey(s.label) === k);
    if (!sec) { sec = Object.assign({}, SECTION[k], { items: [] }); out.push(sec); }
    return sec;
  }

  for (const rev of revisions || []) {
    if (!rev) continue;

    if (rev.op === 'remove') {
      const entry = byName.get(rev.match);
      if (!entry) continue;                                   // unknown line — ignore
      const from = entry.item.from;
      if (!Array.isArray(from) || !from.length) continue;     // hand-added / legacy — never
      if (checked.has(groceryKey(entry.item.name))) continue; // ticked — someone is holding it
      if (!from.every(id => removable.has(id))) continue;     // shared with an unchanged meal — survives
      entry.sec.items.splice(entry.sec.items.indexOf(entry.item), 1);
      byName.delete(rev.match);
      continue;
    }

    if (!rev.name) continue;

    if (rev.op === 'update') {
      const entry = byName.get(rev.match);
      if (!entry) continue;                              // unknown line — ignore
      const item = entry.item;
      const from = (rev.from || item.from || []).filter(id => ids.has(id));
      const next = Object.assign({}, item, {
        detail: rev.detail || item.detail,
        from: from.length ? from : (item.from || [])
      });
      // Ticked off means somebody is holding it. The name is its key; freeze it.
      if (!checked.has(groceryKey(item.name))) next.name = rev.name;
      retag(next, meals);
      entry.sec.items[entry.sec.items.indexOf(item)] = next;
      // Both names now resolve to the live item, so a later op naming either
      // one edits what's actually on the list rather than an orphan.
      const live = { item: next, sec: entry.sec };
      byName.set(item.name, live);
      byName.set(next.name, live);
      continue;
    }

    if (rev.op !== 'add') continue;
    if (byName.has(rev.name)) continue;                  // already on the list
    let from = (rev.from || []).filter(id => ids.has(id));
    if (!from.length) from = (fallbackFrom || []).filter(id => ids.has(id));
    if (!from.length) continue;                          // can't place it — skip
    const item = { name: rev.name, detail: rev.detail || '', from };
    if (rev.amazon && sectionKey(rev.section) !== 'spices') item.amazon = rev.amazon;
    retag(item, meals);
    const sec = bucketFor(rev.section);
    sec.items.push(item);
    byName.set(item.name, { item, sec });
  }

  return orderSections(out);
}

// ── Reordering the week ───────────────────────────────────────────────────
/**
 * Nothing to buy changed; the letters did. Moving Tuesday's dinner to Thursday
 * makes it "Meal C" instead of "Meal A", so every tag pill pointing at it is
 * showing the wrong letter and the wrong colour. Free to fix — the ids never
 * moved.
 *
 * Every path ends here, so it's also where subtitles get their meal names
 * stripped — display-only text, safe to rewrite, and never the name a checkbox
 * is keyed by.
 */
function relabelGroceries(sections, meals) {
  return (sections || []).map(sec => Object.assign({}, sec, {
    items: (sec.items || []).map(item => {
      if (!Array.isArray(item.from) || !item.from.length) return item;   // hand-added
      const next = retag(Object.assign({}, item), meals);
      if (next.detail) next.detail = stripMealNames(next.detail, meals);
      return next;
    })
  }));
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

  return ORDER
    .filter(k => merged.has(k) && merged.get(k).items.length)
    .map(k => {
      const b = merged.get(k);
      const sec = { icon: b.icon, label: b.label, items: b.items };
      if (b.note) sec.note = b.note;
      return sec;
    });
}

module.exports = {
  groceryKey, norm, sectionKey, mergeGroceries, ingsFingerprint,
  weekDelta, pruneRemoved, applyRevisions, relabelGroceries,
  tagFor, getTagClass, fromTag, retag, stripMealNames, orderSections, SECTION
};

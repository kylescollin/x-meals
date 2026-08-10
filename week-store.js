/* Fox & Bear Kitchen — reading and writing weeks.
 *
 * Every week is a document at /meals/weeks/{key}. There is no privileged
 * "current week" any more: navigating to next week is the same operation as
 * navigating to a week last March.
 *
 * ── key vs start ──────────────────────────────────────────────────────────
 * See week-utils.js. Short version: `start` is the canonical Sunday and drives
 * everything the user sees; `key` is the stored weekOf and is what Firebase,
 * git, the grocery list and every note stamp are keyed by.
 *
 * The keys we inherited don't all land on Sundays — there are Mondays, a
 * Tuesday and a Thursday in there. So the page keeps an index of
 * start → key, and ALWAYS asks it before writing. Minting a Sunday key blindly
 * would create a second document for a week that already exists, orphaning its
 * grocery check state and its notes. That is what keyOrMint exists to prevent.
 *
 * Requires: week-utils.js, and window.getToken (set by each page from auth.js).
 */
(function (global) {
  'use strict';

  var FB_BASE = 'https://fox-bear-hub-default-rtdb.firebaseio.com';
  var Week = global.Week;

  var index = null;      // { startISO: key }
  var cache = {};        // key → week document
  var recipeIndex = {};  // recipe id → recipe, for hydrating old weeks

  function authed(url, options) {
    return global.getToken().then(function (token) {
      return fetch(url + (url.indexOf('?') === -1 ? '?' : '&') + 'auth=' + token, options);
    });
  }

  // ── Index ────────────────────────────────────────────────────────────────

  /**
   * Shallow read of the week keys — just the names, none of the contents.
   * This is what replaces the Journal's single unbounded read of every week.
   */
  function loadIndex(force) {
    if (index && !force) return Promise.resolve(index);
    return authed(FB_BASE + '/meals/weeks.json?shallow=true')
      .then(function (r) { return r.json(); })
      .then(function (keys) {
        index = {};
        Object.keys(keys || {}).forEach(function (key) {
          var start = Week.startOf(key);
          // Two keys in one week shouldn't happen — check-weeks.js fails CI if
          // it ever does — but if it did, keep the first and don't pretend.
          if (start && !index[start]) index[start] = key;
        });
        return index;
      })
      .catch(function () { index = index || {}; return index; });
  }

  function starts() {
    return Object.keys(index || {}).sort();
  }

  /** The stored key for a week, or null if that week has never been planned. */
  function keyFor(startISO) {
    return (index && index[startISO]) || null;
  }

  /**
   * The key to write to for a week. Returns the existing key when the week
   * already exists under a non-Sunday name, so we never end up with two
   * documents for one week. Only a genuinely new week gets its Sunday.
   */
  function keyOrMint(startISO) {
    return keyFor(startISO) || startISO;
  }

  /** How far back the history goes, and how far forward we let you wander. */
  function bounds() {
    var all = starts();
    var today = Week.todayStart();
    return {
      earliest: all.length ? (all[0] < today ? all[0] : today) : today,
      latest: Week.add(today, 8)
    };
  }

  // ── Recipes, for filling in old weeks ────────────────────────────────────

  function setRecipes(recipes) {
    (recipes || []).forEach(function (r) { if (r && r.id) recipeIndex[r.id] = r; });
  }

  /**
   * Weeks archived before the site stored full recipe bodies have empty
   * ings/steps, so opening one used to show a blank sheet. Fill them from the
   * recipe collection at render time.
   *
   * Only ever fills gaps, never overwrites. Nothing is written back on its own;
   * if you later edit that week, the filled-in recipe is saved with it, which
   * is an improvement on the empty arrays it had before.
   */
  function hydrate(week) {
    if (!week || !week.meals) return week;
    week.meals.forEach(function (meal) {
      if (!meal || meal.custom === true) return;
      if ((meal.ings || []).length || (meal.steps || []).length) return;
      var r = recipeIndex[meal.id];
      if (!r) return;
      meal.ings = r.ings || r.ingredients || [];
      meal.steps = r.steps || [];
      if (!meal.icon && r.icon) meal.icon = r.icon;
      if (!meal.meta && r.meta) meal.meta = r.meta;
      if (!meal.note && r.note) meal.note = r.note;
    });
    return week;
  }

  // ── Documents ────────────────────────────────────────────────────────────

  function get(key, force) {
    if (!key) return Promise.resolve(null);
    if (cache[key] && !force) return Promise.resolve(cache[key]);
    return authed(FB_BASE + '/meals/weeks/' + key + '.json')
      .then(function (r) { return r.json(); })
      .then(function (week) {
        if (!week) return null;
        cache[key] = hydrate(week);
        return cache[key];
      })
      .catch(function () { return null; });
  }

  /** An empty shell for a week nobody has planned yet. */
  function blank(key) {
    return { weekOf: key, title: Week.titleFor(Week.startOf(key)), meals: [], groceries: [] };
  }

  function peek(key) { return cache[key] || null; }

  /**
   * Write a week. Refuses rather than clobbers: if Firebase has moved on since
   * `snapshotAt`, the other person edited this week while you had it open, and
   * silently overwriting them is worse than making you reload.
   */
  function put(key, week, snapshotAt) {
    week.weekOf = key;
    return authed(FB_BASE + '/meals/weeks/' + key + '.json')
      .then(function (r) { return r.json(); })
      .then(function (remote) {
        if (remote && snapshotAt !== undefined && (remote.updatedAt || 0) > (snapshotAt || 0)) {
          var e = new Error('conflict');
          e.code = 'conflict';
          throw e;
        }
        week.updatedAt = Date.now();
        return authed(FB_BASE + '/meals/weeks/' + key + '.json', {
          method: 'PUT', body: JSON.stringify(week)
        });
      })
      .then(function (r) {
        if (!r.ok) throw new Error('write failed');
        cache[key] = week;
        if (index && !index[Week.startOf(key)]) index[Week.startOf(key)] = key;
        // Keep the old node in step so anything still reading it — a phone
        // with a cached page — doesn't show a stale week.
        if (Week.startOf(key) === Week.todayStart()) {
          authed(FB_BASE + '/meals/current.json', { method: 'PUT', body: JSON.stringify(week) })
            .catch(function () {});
        }
        return week;
      });
  }

  // ── Groceries ────────────────────────────────────────────────────────────

  // The browser's copy of the grocery check-state key. Must stay byte-identical
  // to groceryKey() in scripts/lib/week-merge.js, which CI uses to decide which
  // item names it's allowed to change. If these two ever disagree, every
  // checkbox detaches from its item. grocery-sheet.js calls this one rather
  // than keeping a third copy.
  function groceryKey(name) {
    return String(name || '').trim().replace(/[^a-z0-9]/gi, '_').substring(0, 60);
  }

  function itemsOf(sections) {
    var out = [];
    (sections || []).forEach(function (s) { (s.items || []).forEach(function (i) { out.push(i); }); });
    return out;
  }

  /** Check state for a week: a flat map of groceryKey → true. */
  function flags(key) {
    return authed(FB_BASE + '/groceries/' + key + '.json')
      .then(function (r) { return r.json(); })
      .then(function (d) { return d || {}; })
      .catch(function () { return {}; });
  }

  /**
   * How much of a week's shopping is done. Counts only items actually on the
   * list — stale flags from removed items would otherwise push the checked
   * count past the total.
   */
  function progress(sections, flagMap) {
    var items = itemsOf(sections);
    var custom = (flagMap && flagMap._custom) || {};
    Object.keys(custom).forEach(function (id) {
      if (custom[id] && custom[id].name) items.push({ name: custom[id].name });
    });
    var checked = 0;
    items.forEach(function (i) { if (flagMap && flagMap[groceryKey(i.name)] === true) checked++; });
    return { checked: checked, total: items.length };
  }

  global.WeekStore = {
    loadIndex: loadIndex, starts: starts, keyFor: keyFor, keyOrMint: keyOrMint,
    bounds: bounds, get: get, peek: peek, put: put, blank: blank,
    setRecipes: setRecipes, hydrate: hydrate,
    groceryKey: groceryKey, flags: flags, progress: progress,
    FB_BASE: FB_BASE
  };
})(window);

/* grocery-status.js — what the browser and CI must agree on about a week's
 * grocery list.
 *
 * A grocery list is built ON REQUEST, never as a side effect of saving meals.
 * Two stamps on the week file carry that:
 *
 *   groceriesRequested   written by the phone (the Build / Update button) or by
 *                        Agent X at publish time. An ISO timestamp.
 *   groceriesServed      written only by CI, as a copy of the request it has
 *                        fulfilled.
 *
 * A list is OWED while the two differ. CI spends a model call only on an owed
 * week; the dock shows progress only for an owed week; and "done" is nothing
 * more than the two stamps agreeing again. Both sides read the same document,
 * so neither phone needs to remember anything.
 *
 * Everything here is pure. Loaded as a plain <script> (window.GroceryStatus)
 * and require()d by scripts/*.js — one copy, one set of tests
 * (scripts/test-grocery-status.js). Needs ingredient-format.js first.
 */
(function (root) {
  'use strict';

  var IngFormat = root.IngFormat ||
    (typeof require === 'function' ? require('./ingredient-format.js') : null);

  // ── Fingerprints ──────────────────────────────────────────────────────────
  // A meal's ingredient list, boiled down to a short string stored per meal as
  // `groceriesIngs`. Same ings, same fingerprint — which is how a recipe edit
  // registers as a shopping change even though the set of meal ids never moved.
  //
  // Versioned ("1:…") so a fingerprint written by an older algorithm (the
  // 12-hex SHA-1 CI used to write) reads as UNKNOWN rather than as "changed".
  // Unknown fingerprints are backfilled for free on CI's next pass.
  var FP_VERSION = '1:';

  // cyrb53 — small, fast, good enough spread for "did this list change". Not
  // cryptographic, deliberately: it has to run synchronously in both places.
  function hash53(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57, ch;
    for (var i = 0; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }

  function ingsFingerprint(ings) {
    return FP_VERSION + hash53(JSON.stringify(ings || [])).toString(36);
  }

  function knownFingerprint(fp) {
    return typeof fp === 'string' && fp.indexOf(FP_VERSION) === 0;
  }

  // ── Meals ─────────────────────────────────────────────────────────────────
  function isPlaceholder(m) {
    return !m || m.custom === true || /^custom-/.test(m.id || '');
  }

  // The meals a list is built from: no placeholders, no "# For the sauce"
  // headers. Returns copies — the week is written back to disk with its
  // ingredients exactly as typed.
  function cookableMeals(meals) {
    return (meals || []).filter(function (m) { return !isPlaceholder(m); })
      .map(function (m) {
        var copy = {};
        for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k)) copy[k] = m[k];
        copy.ings = IngFormat ? IngFormat.stripSections(m.ings || []) : (m.ings || []).slice();
        return copy;
      });
  }

  function fingerprintsFor(cookable) {
    var out = {};
    (cookable || []).forEach(function (m) { out[m.id] = ingsFingerprint(m.ings); });
    return out;
  }

  // ── Owed? ─────────────────────────────────────────────────────────────────
  function isOwed(week) {
    if (!week || !week.groceriesRequested) return false;
    return week.groceriesRequested !== (week.groceriesServed || '');
  }

  // ── Is the list behind the meals? ─────────────────────────────────────────
  // Which meal ids the stored list covers, or null for a list written before
  // provenance existed (nothing to compare against). Mirrors weekDelta.
  function coveredBy(week) {
    var w = week || {};
    if (Array.isArray(w.groceriesFor)) return w.groceriesFor.slice();
    var items = [];
    (w.groceries || []).forEach(function (s) { items = items.concat(s.items || []); });
    if (!items.length) return [];
    var union = {};
    items.forEach(function (i) { (Array.isArray(i.from) ? i.from : []).forEach(function (id) { union[id] = true; }); });
    var ids = Object.keys(union);
    return ids.length ? ids : null;
  }

  function hasList(week) {
    return ((week || {}).groceries || []).some(function (s) { return (s.items || []).length; });
  }

  // True when there is something to shop for and the stored list wasn't built
  // for exactly these meals with exactly these ingredients. A week with no
  // cookable meals is never behind; a legacy list can't be judged, so it isn't.
  function listBehind(week, cookable) {
    var meals = cookable || [];
    if (!meals.length) return false;
    var covers = coveredBy(week);
    if (covers === null) return false;
    var want = meals.map(function (m) { return m.id; }).sort();
    if (JSON.stringify(covers.slice().sort()) !== JSON.stringify(want)) return true;
    var prev = (week && week.groceriesIngs) || {};
    return meals.some(function (m) {
      return knownFingerprint(prev[m.id]) && prev[m.id] !== ingsFingerprint(m.ings);
    });
  }

  // ── What CI should do with a week ─────────────────────────────────────────
  // The one decision that decides whether a model call happens. Takes the
  // delta weekDelta() worked out (scripts/lib/week-merge.js) and answers with
  // one of:
  //   build    the whole list, from scratch                 (model call)
  //   revise   one scoped call for what joined/left/changed (model call)
  //   serve    nothing to ask; just consume the request     (free)
  //   relabel  only the Meal A…G letters may have moved     (free)
  //   skip     leave the file byte-for-byte alone           (free)
  function groceryPlan(o) {
    var owed = !!o.owed, d = o.delta || {};
    var dirty = (d.added || []).length || (d.removed || []).length || (d.changed || []).length;
    var what = [
      (d.added || []).length ? '+' + d.added.length : '',
      (d.removed || []).length ? '−' + d.removed.length : '',
      (d.changed || []).length ? '~' + d.changed.length + ' edited' : ''
    ].filter(Boolean).join(', ');

    if (!o.hasCookable) {
      return owed ? { action: 'serve', reason: 'nothing to shop for' }
                  : { action: 'skip', reason: 'nothing to shop for' };
    }
    if (o.force) return { action: 'build', reason: '--force' };
    if (d.legacy) {
      return owed ? { action: 'build', reason: 'legacy list, rebuilt on request' }
                  : { action: 'skip', reason: 'legacy list (no provenance) — rebuilt only on request' };
    }
    if (!o.hasList) {
      return owed ? { action: 'build', reason: 'no list yet' }
                  : { action: 'skip', reason: 'no list yet — waiting for a request' };
    }
    if (!dirty) {
      return owed ? { action: 'serve', reason: 'list already matches the meals' }
                  : { action: 'relabel', reason: 'nothing changed' };
    }
    return owed ? { action: 'revise', reason: what }
                : { action: 'skip', reason: 'list is behind (' + what + ') — waiting for a request' };
  }

  var API = {
    FP_VERSION: FP_VERSION,
    ingsFingerprint: ingsFingerprint,
    knownFingerprint: knownFingerprint,
    isPlaceholder: isPlaceholder,
    cookableMeals: cookableMeals,
    fingerprintsFor: fingerprintsFor,
    isOwed: isOwed,
    hasList: hasList,
    coveredBy: coveredBy,
    listBehind: listBehind,
    groceryPlan: groceryPlan
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.GroceryStatus = API;
})(typeof self !== 'undefined' ? self : this);

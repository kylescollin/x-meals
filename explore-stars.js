/* explore-stars.js — "the recipes starred in Explore", for the pages that
 * aren't Explore.
 *
 * The Explore tab stars a recipe by writing /explore/starred/<key> = <ms> and
 * nothing else (see explore.js). Two other places list those recipes: the
 * "From Explore" screen of Add recipe (recipe-card.js, on recipes.html) and
 * the "From Explore…" mode of the week page's Add a meal sheet (index.html).
 * Both need the same join — starred keys from Firebase with the feed items in
 * data/explore/ — so it lives here once.
 *
 *   ExploreStars.load()             → Promise<[{ item, starredAt, savedId }]>
 *                                     most recently starred first. Rejects when
 *                                     Firebase can't be read (so the caller can
 *                                     say so instead of showing "nothing starred").
 *   ExploreStars.markSaved(key, id) → writes /explore/saved/<key> = "<recipe id>"
 *                                     once a starred recipe is in the collection
 *
 * `item` is the feed item untouched (key, name, site, image, url, icon, tags,
 * meta, ingredients, steps, note…). `savedId` is the collection recipe it
 * already is — an /explore/saved entry, or a recipe in data/recipes.json whose
 * `source` is the same page — or ''. A recipe marked "Not for us" is left out
 * even if it was starred first.
 *
 * Read-only apart from markSaved, and never outside /explore. pick() is pure
 * and require()-able; scripts/test-explore-feed.js covers it. Needs
 * window.getToken (every page sets it from auth.js).
 */
(function (root) {
  'use strict';

  var FB_EXPLORE = 'https://fox-bear-hub-default-rtdb.firebaseio.com/explore';

  function canonical(url) {
    try { var u = new URL(url); u.search = ''; u.hash = ''; return u.href; }
    catch (e) { return url || ''; }
  }

  function obj(x) { return x && typeof x === 'object' ? x : {}; }

  /* The join. `state` is the /explore node ({starred, hidden, saved}), `items`
   * every feed item on hand, `recipes` the collection (for the source match). */
  function pick(state, items, recipes) {
    var starred = obj(state && state.starred);
    var hidden  = obj(state && state.hidden);
    var saved   = obj(state && state.saved);
    var bySource = {};
    (recipes || []).forEach(function (r) {
      if (r && r.source) bySource[canonical(r.source)] = r.id;
    });
    var seen = {};
    return (items || []).filter(function (it) {
      if (!it || !it.recipe || !starred[it.key] || hidden[it.key] || seen[it.key]) return false;
      seen[it.key] = true;
      return true;
    }).map(function (it) {
      return { item: it, starredAt: Number(starred[it.key]) || 0, savedId: saved[it.key] || bySource[it.url] || '' };
    }).sort(function (a, b) { return b.starredAt - a.starredAt; });
  }

  // ── Browser side ──────────────────────────────────────────────────────────
  function fb(path, options) {
    var getToken = root.getToken;
    var go = function (token) {
      return fetch(FB_EXPLORE + path + '.json' + (token ? '?auth=' + encodeURIComponent(token) : ''), options);
    };
    return getToken ? getToken().then(go) : go('');
  }

  function json(url, options) {
    return fetch(url, options).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  function load() {
    return fb('').then(function (r) {
      if (!r.ok) throw new Error('explore ' + r.status);
      return r.json();
    }).then(function (state) {
      state = obj(state);
      var wanted = Object.keys(obj(state.starred)).filter(function (k) { return !obj(state.hidden)[k]; });
      if (!wanted.length) return [];
      return Promise.all([
        json('data/explore/manifest.json', { cache: 'no-cache' }),
        json('data/recipes.json')
      ]).then(function (res) {
        var months = (res[0] && res[0].months) || [];
        var recipes = (res[1] && res[1].recipes) || [];
        var items = [];
        var missing = {};
        wanted.forEach(function (k) { missing[k] = true; });
        // Newest month first, stopping as soon as every star is accounted for —
        // usually the first file or two.
        function next(i) {
          if (i >= months.length || !Object.keys(missing).length) return pick(state, items, recipes);
          return json('data/explore/' + months[i] + '.json', { cache: 'no-cache' }).then(function (data) {
            ((data && data.items) || []).forEach(function (it) {
              if (missing[it.key]) { delete missing[it.key]; items.push(it); }
            });
            return next(i + 1);
          });
        }
        return next(0);
      });
    });
  }

  function markSaved(key, id) {
    return fb('/saved/' + key, { method: 'PUT', body: JSON.stringify(id) }).catch(function () {});
  }

  var API = { pick: pick, canonical: canonical, load: load, markSaved: markSaved };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.ExploreStars = API;
})(typeof self !== 'undefined' ? self : this);

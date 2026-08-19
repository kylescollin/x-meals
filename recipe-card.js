/**
 * Fox & Bear Kitchen — Shared Recipe Card Component
 * Provides: meal card rendering, recipe detail overlay, cooking mode, save/unsave, edit
 * Used by: index.html (week view and timeline view), recipes.html
 */

(function (global) {
  'use strict';

  // The ingredient markup parser — '#' headers, trailing (notes), fractions.
  // ingredient-format.js must load before this file.
  var IngFormat = global.IngFormat;

  // ── Firebase ────────────────────────────────────────────────────────────
  var FB_BASE  = 'https://fox-bear-hub-default-rtdb.firebaseio.com';
  var REPO     = 'kylescollin/x-meals';   // for committing new recipes to git
  var FB_FLAGS = FB_BASE + '/saved-recipes.json';
  var FB_DATA  = FB_BASE + '/saved-recipe-data.json';
  var FB_EDITS    = FB_BASE + '/recipe-edits';
  var FB_COMMENTS = FB_BASE + '/recipe-comments';
  var FB_PHOTOS   = FB_BASE + '/recipe-photos';

  var AUTHOR_MAP = { 'kscollin@gmail.com': 'Kyle', 'missjosephinefox@gmail.com': 'Josephine' };

  // Curated food emojis for the recipe emoji picker (shared by Add + Edit).
  var FOOD_EMOJIS = [
    '🍽️', '🌮', '🌯', '🍝', '🍕', '🥘', '🍲', '🥣', '🥗', '🍜',
    '🍛', '🌶️', '🍗', '🍖', '🥩', '🥓', '🐟', '🍤', '🦐', '🦪',
    '🥦', '🥕', '🌽', '🥔', '🍠', '🍅', '🥑', '🍆', '🍄', '🧄',
    '🥚', '🍳', '🧀', '🥛', '🍚', '🍙', '🥙', '🥪', '🌭', '🍔',
    '🥞', '🧇', '🍞', '🥖', '🥐', '🥯', '🫓', '🥟', '🍣', '🍱',
    '🥧', '🍰', '🧁', '🍪', '🍩', '🍫', '🍎', '🍋', '🥭', '🍇'
  ];

  // ── Recipe tags ─────────────────────────────────────────────────────────
  // Recipes are categorised by an ordered `tags` array: dish type first, then
  // cuisine, then any custom tags. Cards show the first two ("PASTA · ITALIAN").
  // Cook time is not a tag — it stays in `meta`, at the bottom of the card.
  var TAG_FAMILIES = [
    { key: 'dish', title: 'Type of dish', tags: [
      'Pasta', 'Noodles', 'Soup', 'Chili', 'Stew', 'Curry', 'Tacos', 'Handheld',
      'Bowl', 'Rice', 'Salad', 'Stir Fry', 'Bake', 'Roast Dinner',
      'Skillet Dinner', 'Sandwich', 'Sauce', 'Eggs'
    ] },
    { key: 'cuisine', title: 'Cuisine', tags: [
      'Italian', 'Mexican', 'American', 'Asian', 'Indian', 'Mediterranean',
      'Middle Eastern', 'Cajun', 'French'
    ] }
  ];

  // tag → family key, for anything in the vocabulary; 'custom' otherwise.
  var TAG_FAMILY = {};
  TAG_FAMILIES.forEach(function (fam) {
    fam.tags.forEach(function (t) { TAG_FAMILY[t] = fam.key; });
  });
  function familyOf(tag) { return TAG_FAMILY[tag] || 'custom'; }

  // A tag typed into either dropdown in the edit form joins the vocabulary.
  // Which family it belongs to is the one thing the tag itself can't tell us,
  // so it's kept at /config/tagVocab/<family> — a map rather than a list, so
  // adding one is a single-key PATCH. Merged in at init, which is what puts a
  // new tag in the right dropdown next time and under the right heading in the
  // Recipes filter panel instead of in "Your tags".
  function mergeTagVocab(famKey, tags) {
    var fam = TAG_FAMILIES.filter(function (f) { return f.key === famKey; })[0];
    if (!fam) return;
    tags.forEach(function (t) {
      if (!t || fam.tags.indexOf(t) !== -1) return;
      fam.tags.push(t);
      TAG_FAMILY[t] = famKey;
    });
  }

  function loadTagVocab(done) {
    authedFetch(FB_BASE + '/config/tagVocab.json')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || typeof data !== 'object' || data.error) return;
        Object.keys(data).forEach(function (famKey) {
          var m = data[famKey];
          if (!m || typeof m !== 'object') return;
          mergeTagVocab(famKey, Object.keys(m).map(function (k) { return m[k]; }));
        });
      })
      .catch(function () { /* the built-in vocabulary still works */ })
      .then(function () { if (done) done(); });
  }

  // Failing to record a new tag costs nothing that matters: it still saves on
  // the recipe, it just isn't offered next time. So this never interrupts.
  function rememberTag(famKey, tag) {
    mergeTagVocab(famKey, [tag]);
    var body = {};
    body[tag.replace(/[.#$/[\]]/g, '_')] = tag;
    authedFetch(FB_BASE + '/config/tagVocab/' + famKey + '.json', {
      method: 'PATCH', body: JSON.stringify(body)
    }).catch(function () { /* ignore */ });
  }

  // Sort into dish → cuisine → custom, each family in vocabulary order, so the
  // two tags a card shows are always the two most useful ones.
  function sortTags(tags) {
    var rank = {};
    var n = 0;
    TAG_FAMILIES.forEach(function (fam) {
      fam.tags.forEach(function (t) { rank[t] = n++; });
    });
    return (tags || []).slice().sort(function (a, b) {
      var ra = rank.hasOwnProperty(a) ? rank[a] : Infinity;
      var rb = rank.hasOwnProperty(b) ? rank[b] : Infinity;
      if (ra !== rb) return ra - rb;
      return String(a).localeCompare(String(b));
    });
  }

  var tagIndex = {};   // id → tags, from data/recipes.json (for weekly meals)

  // A recipe's tags: its own, else the core recipe's by id, else a single tag
  // recovered from a legacy "Category · time" label — which is also what keeps
  // weekly "Meal A" labels from ever reading as a category again.
  function tagsFor(recipe) {
    if (!recipe) return [];
    if (recipe.tags && recipe.tags.length) return sortTags(recipe.tags);
    var byId = tagIndex[idOf(recipe)];
    if (byId && byId.length) return byId;
    var legacy = ((recipe.label || '').split('·')[0] || '').trim();
    return TAG_FAMILY[legacy] ? [legacy] : [];
  }

  var savedIds         = {};    // id → true/false
  var coreIds          = {};    // id → true (already in recipes.html RECIPES array)
  var recipeEdits      = {};    // safeId → edited recipe object
  var _onSaveChange    = null;  // optional callback(id, isSaved)
  var currentUserEmail = null;  // set in init() via options.userEmail
  var currentRecipeId  = null;  // safe key of the open recipe, for comment ops

  // You can only delete what you wrote. Notes and photos both stamp who made
  // them — a note as `email`, a photo as `by`. Anything written before those
  // fields existed carries only the display name, so fall back to matching that.
  function isMine(entry) {
    if (!entry) return false;
    var email = entry.email || entry.by || '';
    if (email) return !!currentUserEmail && email === currentUserEmail;
    var me = AUTHOR_MAP[currentUserEmail || ''] || '';
    return !!me && !!entry.author && entry.author === me;
  }

  // ── Week context ────────────────────────────────────────────────────────
  // A note or photo is stamped with the week it was logged against, which is how
  // the Journal knows what to show under each week. Pages set a default via
  // init({weekOf}); a card can override it with data-week-of (the Journal does
  // this so a note added months later still lands under the right week).
  // Recipes page passes no week at all — those notes live on the recipe only.
  var defaultWeekOf = '';
  var currentWeekOf = '';       // week of the recipe currently open

  // safeId → [note], newest first. One GET of the whole (text-only) comment tree
  // during init; the image bytes live under /recipe-photos so this stays small.
  var activityIndex = {};

  function fbSafeKey(id) {
    return id.replace(/[.#$[\]]/g, '_');
  }

  function escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }

  // Canonical recipe id: explicit id, else a slug of the name. Shared so every
  // page derives the same id (the site matches recipes by id for save state).
  function idOf(r) {
    return r.id || (r.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  // A placeholder meal — eating out, leftovers, something cooked off-plan. It's
  // just a name on the week, so its card is inert: no detail view, no cooking
  // mode, no groceries. The id prefix is a fallback for anything written before
  // the flag existed.
  function isCustom(r) {
    return !!(r && (r.custom === true || /^custom-/.test(r.id || '')));
  }

  // ── Photo thumbnails ────────────────────────────────────────────────────
  // Cards show a small photo thumbnail (the cover, from /recipe-photos/<safeId>/src)
  // with the recipe emoji as the fallback. Fetched lazily as each thumb scrolls
  // into view (covers can be large data URLs) and cached in-memory per page load.
  //
  // Always read the `src` CHILD, never the whole /recipe-photos/<safeId> node —
  // that node also holds `gallery`, which is megabytes of cook-log photos.
  var photoCache = {};   // safeId → cover src (string) or null (checked, none)

  var thumbObserver = (typeof IntersectionObserver !== 'undefined')
    ? new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          obs.unobserve(e.target);
          resolveThumb(e.target);
        });
      }, { rootMargin: '200px' })
    : null;

  function applyThumbPhoto(thumb, src) {
    if (!src || thumb.classList.contains('has-photo')) return;
    var img = document.createElement('img');
    img.alt = '';
    img.src = src;
    thumb.appendChild(img);
    thumb.classList.add('has-photo');
  }

  // Fetch (or reuse cached) cover photo for a thumb and swap it in. Falls back to
  // the newest cook-log photo when no cover has been chosen, so a recipe you've
  // photographed never shows a bare emoji.
  function resolveThumb(thumb) {
    var safeId = thumb.getAttribute('data-photo-id');
    if (!safeId) return;
    if (photoCache.hasOwnProperty(safeId)) { applyThumbPhoto(thumb, photoCache[safeId]); return; }
    authedFetch(FB_PHOTOS + '/' + safeId + '/src.json')
      .then(function (r) { return r.json(); })
      .then(function (src) {
        if (src) {
          photoCache[safeId] = src;
          applyThumbPhoto(thumb, src);
          return null;
        }
        return newestGalleryThumb(safeId).then(function (fallback) {
          photoCache[safeId] = fallback;
          applyThumbPhoto(thumb, fallback);
        });
      })
      .catch(function () { /* leave emoji fallback */ });
  }

  // ── Cook-log photos (the gallery) ───────────────────────────────────────
  // Every photo taken while cooking is kept at
  //   /recipe-photos/<safeId>/gallery/<photoKey>
  //     = { thumb, full, by, author, at, weekOf, commentKey }
  // It lives under /recipe-photos deliberately: that node's security rule already
  // covers every descendant, so shipping the gallery needed no rules deploy.
  //
  // `thumb` (~360px, ~20 KB) is what every list renders. `full` (~1600px, ~350 KB)
  // is fetched only when the viewer actually displays that photo. Nothing ever
  // reads the gallery node whole.
  var galleryKeys   = {};   // safeId → [photoKey], newest first
  var galleryThumbs = {};   // safeId + '/' + photoKey → thumb data URL

  // The cover photo lives at /recipe-photos/<safeId>/src — a *sibling* of
  // `gallery`, not a member of it. The viewer still shows it, always as the
  // first slide, under this sentinel key. `coverKey` records the gallery photo
  // a cover was promoted from, so a promoted photo moves to the front instead
  // of appearing twice.
  var COVER_KEY  = '__cover';
  var coverCache = {};      // safeId → cover src or null (absent = not read yet)
  var coverKeys  = {};      // safeId → the gallery key it was promoted from, or null
  var coverPend  = {};      // in-flight reads, so the hero and the count pill share one

  // The cover is the biggest single value we read, so never fetch it twice.
  // loadPhoto drops the cache entry when a recipe opens, which is the one place
  // it needs to be re-read from Firebase.
  function loadCover(safeId) {
    if (coverCache.hasOwnProperty(safeId)) return Promise.resolve(coverCache[safeId]);
    if (coverPend[safeId]) return coverPend[safeId];
    coverPend[safeId] = authedFetch(FB_PHOTOS + '/' + safeId + '/src.json')
      .then(function (r) { return r.json(); })
      .then(function (src) { coverCache[safeId] = src || null; return coverCache[safeId]; })
      .catch(function () { return null; })
      .then(function (src) { delete coverPend[safeId]; return src; });
    return coverPend[safeId];
  }

  function loadCoverKey(safeId) {
    if (coverKeys.hasOwnProperty(safeId)) return Promise.resolve(coverKeys[safeId]);
    return authedFetch(FB_PHOTOS + '/' + safeId + '/coverKey.json')
      .then(function (r) { return r.json(); })
      .then(function (k) { coverKeys[safeId] = k || null; return coverKeys[safeId]; })
      .catch(function () { return null; });
  }

  // The gallery as the viewer sees it: the cover first, then every cook-log
  // photo newest first. `force` re-reads the cook-log keys only — the cover is
  // refreshed when the recipe opens, and photos coming and going don't touch it.
  function galleryKeysWithCover(safeId, force) {
    return Promise.all([
      loadGalleryKeys(safeId, force), loadCover(safeId), loadCoverKey(safeId)
    ]).then(function (v) {
      var keys = v[0].slice(), src = v[1], promoted = v[2];
      if (!src) return keys;
      var at = promoted ? keys.indexOf(promoted) : -1;
      if (at > 0) { keys.splice(at, 1); keys.unshift(promoted); }
      else if (at === -1) keys.unshift(COVER_KEY);
      return keys;
    });
  }

  function galleryUrl(safeId, photoKey, child) {
    return FB_PHOTOS + '/' + safeId + '/gallery' +
           (photoKey ? '/' + photoKey : '') +
           (child ? '/' + child : '') + '.json';
  }

  // Photo keys for a recipe, newest first. Shallow read — keys only, no bytes.
  // Keys are `<ms timestamp>-<random>`, so a plain string sort is a time sort.
  function loadGalleryKeys(safeId, force) {
    if (!force && galleryKeys[safeId]) return Promise.resolve(galleryKeys[safeId]);
    return authedFetch(galleryUrl(safeId) + '?shallow=true')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var keys = (data && typeof data === 'object' && !data.error) ? Object.keys(data) : [];
        keys.sort().reverse();
        galleryKeys[safeId] = keys;
        return keys;
      })
      .catch(function () { galleryKeys[safeId] = []; return []; });
  }

  // The Journal can hold years of photos, so its thumbnails only load as they
  // scroll near the viewport — same approach as the card thumbnails above.
  var galThumbObserver = (typeof IntersectionObserver !== 'undefined')
    ? new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          obs.unobserve(e.target);
          fillGalleryCell(e.target);
        });
      }, { rootMargin: '300px' })
    : null;

  function fillGalleryCell(cell) {
    var safeId   = cell.getAttribute('data-gal-id');
    var photoKey = cell.getAttribute('data-gal-key');
    if (!safeId || !photoKey) return;
    loadGalleryThumb(safeId, photoKey).then(function (src) {
      if (src) cell.innerHTML = '<img src="' + escAttr(src) + '" alt="">';
    });
  }

  function lazyGalleryCell(cell, safeId, photoKey) {
    cell.setAttribute('data-gal-id', safeId);
    cell.setAttribute('data-gal-key', photoKey);
    if (galThumbObserver) galThumbObserver.observe(cell);
    else fillGalleryCell(cell);
  }

  // The three readers below all answer for COVER_KEY too, so the viewer can
  // treat the cover as just another slide. There is only one stored copy of the
  // cover, so its thumb and its full size are the same image.
  function loadGalleryThumb(safeId, photoKey) {
    if (photoKey === COVER_KEY) return loadCover(safeId);
    var ck = safeId + '/' + photoKey;
    if (galleryThumbs.hasOwnProperty(ck)) return Promise.resolve(galleryThumbs[ck]);
    return authedFetch(galleryUrl(safeId, photoKey, 'thumb'))
      .then(function (r) { return r.json(); })
      .then(function (src) { galleryThumbs[ck] = src || null; return galleryThumbs[ck]; })
      .catch(function () { return null; });
  }

  function loadGalleryFull(safeId, photoKey) {
    if (photoKey === COVER_KEY) return loadCover(safeId);
    return authedFetch(galleryUrl(safeId, photoKey, 'full'))
      .then(function (r) { return r.json(); })
      .then(function (src) { return src || null; })
      .catch(function () { return null; });
  }

  // Metadata for one photo, without the two image blobs.
  function loadGalleryMeta(safeId, photoKey) {
    if (photoKey === COVER_KEY) {
      return Promise.all([
        authedFetch(FB_PHOTOS + '/' + safeId + '/by.json').then(function (r) { return r.json(); }),
        authedFetch(FB_PHOTOS + '/' + safeId + '/at.json').then(function (r) { return r.json(); })
      ]).then(function (v) {
        return { author: AUTHOR_MAP[v[0] || ''] || '', at: v[1] || 0, weekOf: '' };
      }).catch(function () { return { author: '', at: 0, weekOf: '' }; });
    }
    return Promise.all([
      authedFetch(galleryUrl(safeId, photoKey, 'author')).then(function (r) { return r.json(); }),
      authedFetch(galleryUrl(safeId, photoKey, 'at')).then(function (r) { return r.json(); }),
      authedFetch(galleryUrl(safeId, photoKey, 'weekOf')).then(function (r) { return r.json(); })
    ]).then(function (v) {
      return { author: v[0] || '', at: v[1] || 0, weekOf: v[2] || '' };
    }).catch(function () { return { author: '', at: 0, weekOf: '' }; });
  }

  // Cover fallback: the newest cook-log photo, used when no cover was ever set.
  function newestGalleryThumb(safeId) {
    return loadGalleryKeys(safeId).then(function (keys) {
      if (!keys.length) return null;
      return loadGalleryThumb(safeId, keys[0]);
    });
  }

  function savePhotoToGallery(safeId, photo) {
    var photoKey = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 6);
    return authedFetch(galleryUrl(safeId, photoKey), {
      method: 'PUT',
      body: JSON.stringify(photo)
    }).then(function (r) {
      if (!r.ok) throw new Error('photo write failed');
      galleryThumbs[safeId + '/' + photoKey] = photo.thumb;
      if (galleryKeys[safeId]) galleryKeys[safeId].unshift(photoKey);
      return photoKey;
    });
  }

  function deletePhotoFromGallery(safeId, photoKey) {
    return authedFetch(galleryUrl(safeId, photoKey), { method: 'DELETE' })
      .then(function (r) {
        if (!r.ok) throw new Error('photo delete failed');
        delete galleryThumbs[safeId + '/' + photoKey];
        if (galleryKeys[safeId]) {
          galleryKeys[safeId] = galleryKeys[safeId].filter(function (k) { return k !== photoKey; });
        }
      });
  }

  // Build a thumbnail node: emoji fallback now, photo lazily when visible.
  function makeThumb(recipe, sizeClass) {
    var thumb = document.createElement('div');
    thumb.className = 'rc-thumb' + (sizeClass ? ' ' + sizeClass : '');
    thumb.setAttribute('data-photo-id', fbSafeKey(idOf(recipe)));
    var emoji = document.createElement('span');
    emoji.className = 'rc-thumb-emoji';
    emoji.textContent = recipe.icon || '🍽';
    thumb.appendChild(emoji);
    if (thumbObserver) thumbObserver.observe(thumb);
    else resolveThumb(thumb);   // no IO support: fetch immediately
    return thumb;
  }

  function authedFetch(url, options) {
    var getToken = window.getToken;
    if (!getToken) return fetch(url, options);
    return getToken().then(function(token) {
      // Some calls carry their own query string (e.g. ?shallow=true), so pick
      // the right separator rather than always using '?'.
      var sep = url.indexOf('?') === -1 ? '?' : '&';
      return fetch(url + sep + 'auth=' + token, options);
    });
  }

  // Load saved flags from Firebase; call callback when ready
  function loadSavedState(callback) {
    authedFetch(FB_FLAGS)
      .then(function (r) { return r.json(); })
      .then(function (d) { savedIds = d || {}; if (callback) callback(); })
      .catch(function () { if (callback) callback(); });
  }

  // ── Activity index (notes + which photos hang off them) ─────────────────
  // Normalise one raw Firebase comment into the shape the UI uses everywhere.
  function normaliseNote(key, raw) {
    return {
      key:    key,
      text:   raw.text || '',
      author: raw.author || 'Unknown',
      email:  raw.email || '',
      ts:     raw.ts || 0,
      weekOf: raw.weekOf || '',
      photos: Array.isArray(raw.photos) ? raw.photos.slice() : []
    };
  }

  function sortNotes(notes) {
    return notes.sort(function (a, b) { return b.ts - a.ts; });
  }

  function notesFromObject(data) {
    if (!data || typeof data !== 'object' || data.error) return [];
    return sortNotes(Object.keys(data).map(function (k) { return normaliseNote(k, data[k] || {}); }));
  }

  // Pull every note in one request so cards can show counts and the Journal can
  // group by week without a fetch per recipe.
  function loadActivityIndex(callback) {
    authedFetch(FB_COMMENTS + '.json')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        activityIndex = {};
        if (data && typeof data === 'object' && !data.error) {
          Object.keys(data).forEach(function (safeId) {
            activityIndex[safeId] = notesFromObject(data[safeId]);
          });
        }
        if (callback) callback();
      })
      .catch(function () { if (callback) callback(); });
  }

  function notesFor(safeId, weekOf) {
    var all = activityIndex[safeId] || [];
    if (!weekOf) return all;
    return all.filter(function (n) { return n.weekOf === weekOf; });
  }

  // Keep the in-memory index in step with a write, so counts and the Journal
  // update without a reload.
  function indexNote(safeId, note) {
    if (!activityIndex[safeId]) activityIndex[safeId] = [];
    activityIndex[safeId].unshift(note);
    sortNotes(activityIndex[safeId]);
  }

  function unindexNote(safeId, key) {
    if (!activityIndex[safeId]) return;
    activityIndex[safeId] = activityIndex[safeId].filter(function (n) { return n.key !== key; });
  }

  function findNote(safeId, key) {
    return (activityIndex[safeId] || []).filter(function (n) { return n.key === key; })[0] || null;
  }

  // Load recipe edits from Firebase; call callback when ready
  function loadRecipeEdits(callback) {
    authedFetch(FB_EDITS + '.json')
      .then(function (r) { return r.json(); })
      .then(function (d) { recipeEdits = d || {}; applyEditsToCards(); if (callback) callback(); })
      .catch(function () { if (callback) callback(); });
  }

  // Update any rendered card names/meta to reflect saved edits.
  // querySelectorAll, not querySelector: the same recipe can be on screen once
  // per week it was cooked, and every one of those cards needs the edit.
  function applyEditsToCards() {
    Object.keys(recipeEdits).forEach(function (safeId) {
      var edit = recipeEdits[safeId];
      if (!edit || !edit.id) return;
      document.querySelectorAll('.rc-card[data-recipe-id="' + escAttr(edit.id) + '"]').forEach(function (card) {
        var nameEl  = card.querySelector('.rc-card-name');
        var metaEl  = card.querySelector('.rc-card-meta');
        var iconEl  = card.querySelector('.rc-thumb-emoji');
        var labelEl = card.querySelector('.rc-card-label');
        if (nameEl && edit.name) nameEl.textContent = edit.name;
        if (metaEl && edit.meta !== undefined) {
          // Week/journal cards prefix the meta with the day — keep it.
          var prefix = card.getAttribute('data-meta-prefix') || '';
          metaEl.textContent = prefix + edit.meta;
        }
        if (iconEl && edit.icon) iconEl.textContent = edit.icon;
        // Only cards showing tags (not a "Meal A · Tuesday" override) repaint here.
        if (labelEl && edit.tags && !card.hasAttribute('data-label-fixed')) {
          labelEl.textContent = sortTags(edit.tags).slice(0, 2).join(' · ');
        }
      });
    });
  }

  function isSaved(id) { return savedIds[id] === true; }
  function isCore(id)  { return coreIds[id]  === true; }

  function toggleSave(id, recipeObj) {
    var nowSaving = !isSaved(id);
    savedIds[id] = nowSaving;

    // Persist flag
    authedFetch(FB_FLAGS, { method: 'PUT', body: JSON.stringify(savedIds) }).catch(function () {});

    // Persist or delete full recipe data
    var dataUrl = FB_BASE + '/saved-recipe-data/' + fbSafeKey(id) + '.json';
    if (nowSaving) {
      authedFetch(dataUrl, { method: 'PUT', body: JSON.stringify(recipeObj) }).catch(function () {});
    } else {
      authedFetch(dataUrl, { method: 'DELETE' }).catch(function () {});
    }

    refreshSaveUI(id);

    // Update any saved badges in the card list
    document.querySelectorAll('.rc-saved-badge[data-id="' + id + '"]').forEach(function (b) {
      b.classList.toggle('visible', nowSaving);
    });

    if (_onSaveChange) _onSaveChange(id, nowSaving, recipeObj);
  }

  // ── Ingredient rendering ────────────────────────────────────────────────
  // The parsing lives in ingredient-format.js; these two turn its output into
  // the markup each surface wants. A '#' line becomes a header rather than a
  // bulleted ingredient, and a trailing (note) becomes quiet italic text.

  // The recipe detail overlay: bulleted list, bold quantity, grey italic note.
  function ingListHTML(ings) {
    return (ings || []).map(function (line) {
      var p = IngFormat.parseIngredient(line);
      if (p.type === 'section') {
        return '<li class="rc-rd-ing-head">' + escHtml(p.text) + '</li>';
      }
      // '—' means no measurement was found — render the line as plain text
      // rather than bolding a dash nobody typed.
      var html = p.qty === '—' ? escHtml(p.name) :
        '<strong class="rc-rd-ing-qty">' + escHtml(p.qty) + '</strong> ' + escHtml(p.name);
      if (p.note) html += ' <em class="rc-rd-ing-detail">' + escHtml(p.note) + '</em>';
      return '<li>' + html + '</li>';
    }).join('');
  }

  // Cooking mode: right-aligned quantity column, big item name, dark theme.
  function ingRowsHTML(ings) {
    return (ings || []).map(function (line) {
      var p = IngFormat.parseIngredient(line);
      if (p.type === 'section') {
        return '<li class="rc-ck-ing-head">' + escHtml(p.text) + '</li>';
      }
      var note = p.note ? ' <em class="rc-ck-ing-detail">' + escHtml(p.note) + '</em>' : '';
      return '<li class="rc-ck-ing-row"><span class="rc-ck-qty">' + escHtml(p.qty) + '</span>' +
             '<span class="rc-ck-item-name">' + escHtml(p.name) + note + '</span></li>';
    }).join('');
  }

  // ── Inject shared HTML + CSS ────────────────────────────────────────────
  function injectSharedUI() {
    // CSS
    var style = document.createElement('style');
    style.textContent = [
      // Meal cards
      '.rc-card{background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;cursor:pointer;transition:border-color .15s,box-shadow .15s;-webkit-tap-highlight-color:transparent;}',
      '.rc-card:hover{border-color:#bbb;box-shadow:0 2px 8px rgba(0,0,0,.06);}',
      // Placeholder meal: nothing to open, so nothing should invite a tap.
      '.rc-card-plain{cursor:default;}',
      '.rc-card-plain:hover{border-color:var(--border);box-shadow:none;}',
      '.rc-card-inner{display:flex;align-items:center;gap:14px;padding:14px 16px;user-select:none;}',
      // Photo thumbnail (shared by cards + edit mode). Photo when set, else emoji fallback.
      '.rc-thumb{position:relative;width:52px;height:52px;flex-shrink:0;border-radius:8px;overflow:hidden;background:#f0ece5;display:flex;align-items:center;justify-content:center;font-size:24px;line-height:1;}',
      '.rc-thumb.rc-thumb-sm{width:40px;height:40px;border-radius:7px;font-size:20px;}',
      '.rc-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;}',
      '.rc-thumb.has-photo .rc-thumb-emoji{display:none;}',
      '.rc-card-body{flex:1;min-width:0;}',
      '.rc-card-label{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);font-weight:500;margin-bottom:2px;}',
      '.rc-card-name{font-family:"Playfair Display",serif;font-size:15px;font-weight:500;line-height:1.3;}',
      '.rc-card-meta{font-size:11px;color:var(--muted);margin-top:2px;font-weight:300;}',
      '.rc-card-right{display:flex;align-items:center;gap:8px;flex-shrink:0;}',
      '.rc-saved-badge{display:none;align-items:center;gap:4px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);background:var(--accent-light);padding:3px 8px;border-radius:99px;flex-shrink:0;}',
      '.rc-saved-badge.visible{display:flex;}',
      '.rc-saved-badge svg{width:10px;height:10px;fill:var(--accent);}',
      '.rc-chevron{font-size:20px;color:var(--border);}',

      // Detail overlay
      '#rc-rd-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:999;opacity:0;pointer-events:none;transition:opacity .38s ease;}',
      '#rc-rd-backdrop.open{opacity:1;pointer-events:auto;}',
      '#rc-rd-overlay{position:fixed;left:0;right:0;bottom:0;top:calc(env(safe-area-inset-top,0px) + 12px);background:var(--cream);z-index:1000;display:flex;flex-direction:column;transform:translateY(100%);transition:transform .38s cubic-bezier(.4,0,.2,1);overflow:hidden;border-radius:24px 24px 0 0;}',
      '#rc-rd-overlay.open{transform:translateY(0);}',
      // Floating top buttons (back + more), pinned over the scrolling body
      // No safe-area inset here: #rc-rd-overlay above already sits below it.
      '.rc-rd-topbtns{position:absolute;top:0;left:0;right:0;z-index:6;display:flex;justify-content:space-between;align-items:flex-start;padding:12px 14px 0;pointer-events:none;}',
      '.rc-rd-topbtns > *{pointer-events:auto;}',
      '.rc-rd-iconbtn{width:38px;height:38px;border-radius:50%;background:rgba(20,19,17,.5);color:#fff;border:none;font-size:19px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);transition:background .15s,transform .12s;}',
      '.rc-rd-iconbtn:active{transform:scale(.92);background:rgba(20,19,17,.72);}',
      '.rc-rd-more-wrap{position:relative;}',
      '.rc-rd-more-menu{position:absolute;top:46px;right:0;min-width:196px;background:#fff;border:1px solid var(--border);border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.22);overflow:hidden;display:none;flex-direction:column;}',
      '.rc-rd-more-menu.open{display:flex;}',
      '.rc-rd-more-opt{background:#fff;border:none;text-align:left;padding:13px 16px;font-family:"DM Sans",sans-serif;font-size:14px;color:var(--ink);cursor:pointer;-webkit-tap-highlight-color:transparent;display:flex;align-items:center;gap:11px;transition:background .12s;}',
      '.rc-rd-more-opt:not(:last-child){border-bottom:1px solid var(--border);}',
      '.rc-rd-more-opt:active{background:#f0ece5;}',
      '.rc-rd-more-opt svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0;}',
      // Floating Cook pill
      '.rc-rd-cook-fab{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(20px + env(safe-area-inset-bottom,0px));z-index:5;display:inline-flex;align-items:center;gap:9px;background:var(--ink);color:var(--cream);border:none;border-radius:100px;font-family:"DM Sans",sans-serif;font-size:15px;font-weight:600;letter-spacing:.02em;padding:15px 34px;cursor:pointer;-webkit-tap-highlight-color:transparent;box-shadow:0 8px 24px rgba(20,19,17,.35);transition:transform .12s,background .15s;}',
      '.rc-rd-cook-fab:active{transform:translateX(-50%) scale(.96);background:#333;}',
      '.rc-rd-cook-fab svg{width:14px;height:14px;fill:currentColor;}',
      '.rc-rd-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 20px calc(104px + env(safe-area-inset-bottom,0px));}',
      '.rc-rd-inner{max-width:640px;margin:0 auto;}',
      '.rc-rd-note{margin-bottom:20px;padding:11px 14px;background:var(--accent-light);border-radius:8px;font-size:13px;color:#7a4520;line-height:1.5;}',
      '.rc-rd-cols{display:grid;grid-template-columns:1fr 1.4fr;gap:28px;}',
      '@media(max-width:520px){.rc-rd-cols{grid-template-columns:1fr;}}',
      '.rc-rd-section-title{font-size:10px;letter-spacing:2px;text-transform:uppercase;font-weight:500;color:var(--accent);margin-bottom:12px;}',
      '.rc-rd-ing-list{list-style:none;display:flex;flex-direction:column;gap:5px;}',
      '.rc-rd-ing-list li{font-size:13px;color:var(--ink);line-height:1.45;padding-left:12px;position:relative;}',
      '.rc-rd-ing-list li::before{content:"·";position:absolute;left:0;color:var(--muted);}',
      // A '#' line: a label for the group below it, so it drops the bullet and
      // the indent the ingredients keep.
      '.rc-rd-ing-list li.rc-rd-ing-head{padding-left:0;font-weight:600;margin-top:14px;}',
      '.rc-rd-ing-list li.rc-rd-ing-head::before{content:none;}',
      '.rc-rd-ing-list li.rc-rd-ing-head:first-child{margin-top:0;}',
      '.rc-rd-ing-qty{font-weight:600;}',
      '.rc-rd-ing-detail{color:var(--muted);font-style:italic;}',
      '.rc-rd-step-list{list-style:none;display:flex;flex-direction:column;gap:10px;}',
      '.rc-rd-step-list li{font-size:13px;color:var(--ink);line-height:1.55;display:flex;gap:10px;}',
      '.rc-rd-step-num{font-family:"Playfair Display",serif;font-size:14px;font-weight:700;color:var(--accent);flex-shrink:0;min-width:16px;padding-top:1px;}',
      // Tag pills, between Directions and Notes
      '.rc-rd-tags{margin-top:30px;}',
      '.rc-rd-tag-row{display:flex;flex-wrap:wrap;gap:8px;}',
      '.rc-rd-tag{background:var(--accent-light);color:var(--accent);border-radius:100px;padding:5px 13px;font-size:12px;font-weight:500;letter-spacing:.02em;}',

      // Hero photo (headline overlaid on the image)
      '.rc-rd-hero{position:relative;margin:0 -20px 24px;height:clamp(240px,52vw,340px);background:#efe9e0;cursor:pointer;overflow:hidden;-webkit-tap-highlight-color:transparent;}',
      '.rc-rd-hero-media{position:absolute;inset:0;}',
      '.rc-rd-hero-media img{width:100%;height:100%;object-fit:cover;display:block;}',
      '.rc-rd-hero.empty .rc-rd-hero-media{background:linear-gradient(150deg,#c8622a 0%,#8a4a2a 55%,#3f2a1c 100%);}',
      '.rc-rd-hero-scrim{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.74) 0%,rgba(0,0,0,.28) 34%,rgba(0,0,0,0) 62%);pointer-events:none;}',
      '.rc-rd-hero-title{position:absolute;left:0;right:0;bottom:0;padding:20px 60px 20px 22px;z-index:2;pointer-events:none;}',
      '.rc-rd-name{font-family:"Playfair Display",serif;font-size:clamp(26px,7vw,40px);font-weight:700;color:#fff;line-height:1.08;letter-spacing:-.01em;text-shadow:0 1px 12px rgba(0,0,0,.45);}',
      '.rc-rd-meta{margin-top:7px;font-family:"DM Sans",sans-serif;font-size:12.5px;font-weight:400;color:rgba(255,255,255,.9);text-shadow:0 1px 8px rgba(0,0,0,.5);}',
      '.rc-rd-hero-cta{position:absolute;top:0;left:0;right:0;bottom:52px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;color:#fff;z-index:1;pointer-events:none;}',
      '.rc-rd-hero.has-photo .rc-rd-hero-cta{display:none;}',
      '.rc-rd-hero-cta svg{width:30px;height:30px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;opacity:.92;}',
      '.rc-rd-hero-cta span{font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:500;opacity:.92;}',
      '.rc-rd-hero-edit{position:absolute;right:14px;bottom:16px;z-index:3;width:38px;height:38px;border-radius:50%;display:none;align-items:center;justify-content:center;background:rgba(20,19,17,.5);color:#fff;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);transition:transform .12s;}',
      '.rc-rd-hero.has-photo .rc-rd-hero-edit{display:flex;}',
      '.rc-rd-hero-edit svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;}',
      '.rc-rd-hero-edit:active{transform:scale(.92);}',
      '.rc-rd-hero.busy{opacity:.6;pointer-events:none;}',
      // Count pill — the only hint that the hero is tappable when photos exist
      '.rc-rd-hero-count{position:absolute;right:14px;bottom:62px;z-index:3;display:none;align-items:center;gap:5px;background:rgba(20,19,17,.52);color:#fff;border-radius:100px;padding:5px 11px 5px 9px;font-size:11.5px;font-weight:500;letter-spacing:.02em;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);pointer-events:none;}',
      '.rc-rd-hero-count.on{display:flex;}',
      '.rc-rd-hero-count svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;}',

      // Photo action sheet
      '.rc-photo-menu{position:fixed;inset:0;z-index:1100;display:none;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.4);padding:16px;padding-bottom:calc(16px + env(safe-area-inset-bottom,0px));}',
      '.rc-photo-menu.open{display:flex;}',
      '.rc-photo-sheet{width:100%;max-width:420px;display:flex;flex-direction:column;gap:1px;background:var(--border);border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.25);}',
      '.rc-photo-opt{background:white;border:none;padding:16px;font-family:"DM Sans",sans-serif;font-size:15px;color:var(--ink);cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background .12s;}',
      '.rc-photo-opt:active{background:#f0ece5;}',
      '.rc-photo-remove{color:#c0392b;}',
      '.rc-photo-cancel{font-weight:600;margin-top:8px;border-radius:12px;}',

      // Find a photo (Pexels search)
      '.rc-find{position:fixed;inset:0;background:var(--cream);z-index:1200;display:none;flex-direction:column;}',
      '.rc-find.open{display:flex;}',
      '.rc-find-bar{display:flex;align-items:center;gap:8px;padding:calc(16px + env(safe-area-inset-top,0px)) 14px 12px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--cream);}',
      '.rc-find-back{flex-shrink:0;width:36px;height:36px;border-radius:50%;background:white;border:1px solid var(--border);color:var(--ink);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;}',
      '.rc-find-back:active{background:#eee;}',
      // Text fields stay at 16px minimum, or iOS zooms the page in on focus.
      '.rc-find-input{flex:1;min-width:0;border:1px solid var(--border);border-radius:100px;padding:10px 16px;font-family:"DM Sans",sans-serif;font-size:16px;color:var(--ink);background:white;-webkit-appearance:none;appearance:none;outline:none;transition:border-color .15s;}',
      '.rc-find-input:focus{border-color:var(--accent);}',
      '.rc-find-go{flex-shrink:0;background:var(--accent);color:#fff;border:none;border-radius:100px;padding:10px 16px;font-family:"DM Sans",sans-serif;font-size:13px;font-weight:500;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s,background .15s;}',
      '.rc-find-go:active{transform:scale(.95);background:#b3581f;}',
      '.rc-find-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px calc(16px + env(safe-area-inset-right,0px)) calc(24px + env(safe-area-inset-bottom,0px)) calc(16px + env(safe-area-inset-left,0px));}',
      '.rc-find-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;}',
      '@media(min-width:560px){.rc-find-grid{grid-template-columns:repeat(3,1fr);}}',
      '.rc-find-thumb{position:relative;border-radius:10px;overflow:hidden;cursor:pointer;background:#eee;aspect-ratio:4/3;-webkit-tap-highlight-color:transparent;transition:transform .1s;}',
      '.rc-find-thumb img{width:100%;height:100%;object-fit:cover;display:block;}',
      '.rc-find-thumb:active{transform:scale(.97);}',
      '.rc-find-thumb.saving{opacity:.45;pointer-events:none;}',
      '.rc-find-status{padding:48px 20px;text-align:center;color:var(--muted);font-size:14px;line-height:1.5;}',

      // Photo gallery viewer — full-screen, above every other overlay
      '.rc-gal{position:fixed;inset:0;z-index:1300;background:#0b0a09;display:none;flex-direction:column;}',
      '.rc-gal.open{display:flex;}',
      '.rc-gal-bar{display:flex;align-items:center;gap:10px;padding:calc(12px + env(safe-area-inset-top,0px)) 14px 10px;flex-shrink:0;position:relative;z-index:2;}',
      '.rc-gal-iconbtn{width:36px;height:36px;border-radius:50%;flex-shrink:0;background:rgba(255,255,255,.12);color:#fff;border:none;font-size:17px;display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s,background .15s;}',
      '.rc-gal-iconbtn:active{transform:scale(.92);background:rgba(255,255,255,.22);}',
      '.rc-gal-pos{flex:1;text-align:center;font-size:12.5px;color:rgba(255,255,255,.62);letter-spacing:.04em;}',
      '.rc-gal-vp{flex:1;position:relative;overflow:hidden;touch-action:pan-y;min-height:0;}',
      '.rc-gal-slide{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .22s ease;pointer-events:none;}',
      '.rc-gal-slide.active{opacity:1;pointer-events:auto;}',
      '.rc-gal-slide img{max-width:100%;max-height:100%;object-fit:contain;display:block;}',
      // The thumb stands in, blurred, until the full-size copy arrives
      '.rc-gal-slide img.placeholder{filter:blur(12px);transform:scale(1.02);}',
      '.rc-gal-dots{display:flex;justify-content:center;gap:6px;padding:12px 20px 0;flex-shrink:0;flex-wrap:wrap;}',
      '.rc-gal-dot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.26);transition:background .2s,transform .2s;}',
      '.rc-gal-dot.on{background:#fff;transform:scale(1.25);}',
      '.rc-gal-cap{flex-shrink:0;padding:14px 22px calc(20px + env(safe-area-inset-bottom,0px));color:rgba(255,255,255,.9);}',
      '.rc-gal-cap-who{font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:rgba(255,255,255,.5);margin-bottom:7px;}',
      '.rc-gal-cap-text{font-size:14px;line-height:1.55;white-space:pre-wrap;font-weight:300;}',
      '.rc-gal-empty{flex:1;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.5);font-size:14px;}',
      // Gallery action sheet (Use as cover / Delete)
      '.rc-gal-menu{position:fixed;inset:0;z-index:1350;display:none;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.5);padding:16px;padding-bottom:calc(16px + env(safe-area-inset-bottom,0px));}',
      '.rc-gal-menu.open{display:flex;}',

      // Edit mode
      // Inside #rc-rd-overlay, which is already offset by the safe-area inset.
      '.rc-rd-edit-bar{display:flex;align-items:center;justify-content:space-between;padding:16px 16px 14px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--cream);}',
      '.rc-rd-edit-bar-title{font-family:"DM Sans",sans-serif;font-size:14px;font-weight:500;color:var(--muted);}',
      '.rc-rd-cancel-btn{background:none;border:none;color:var(--muted);font-family:"DM Sans",sans-serif;font-size:14px;font-weight:400;padding:8px 4px;cursor:pointer;-webkit-tap-highlight-color:transparent;}',
      '.rc-rd-cancel-btn:active{opacity:.6;}',
      '.rc-rd-save-edit-btn{background:var(--accent);color:white;border:none;border-radius:100px;font-family:"DM Sans",sans-serif;font-size:13px;font-weight:500;padding:9px 18px;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s,background .15s;}',
      '.rc-rd-save-edit-btn:active{transform:scale(.94);background:#b3581f;}',
      '.rc-rd-edit-form{padding:24px 20px calc(60px + env(safe-area-inset-bottom,0px));max-width:640px;margin:0 auto;display:flex;flex-direction:column;gap:20px;}',
      '.rc-rd-field{display:flex;flex-direction:column;gap:6px;}',
      '.rc-rd-field-label{font-size:10px;letter-spacing:2px;text-transform:uppercase;font-weight:500;color:var(--accent);}',
      '.rc-rd-input{width:100%;border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-family:"DM Sans",sans-serif;font-size:16px;font-weight:300;color:var(--ink);background:white;-webkit-appearance:none;appearance:none;outline:none;transition:border-color .15s;}',
      '.rc-rd-input:focus{border-color:var(--accent);}',
      '.rc-rd-field-hint{font-size:11px;color:var(--muted);line-height:1.5;}',
      '.rc-rd-field-hint b{font-weight:600;color:var(--ink);}',
      'textarea.rc-rd-input{resize:vertical;line-height:1.6;}',
      // Import-from-a-link panel (add form only)
      '.rc-rd-import{display:flex;flex-direction:column;gap:9px;padding:14px;border:1px solid var(--border);border-radius:10px;background:#fff;}',
      '.rc-rd-import-row{display:flex;gap:8px;align-items:stretch;}',
      '.rc-rd-import-row .rc-rd-input{flex:1 1 auto;min-width:0;}',
      '.rc-rd-import-go{flex:none;border:none;border-radius:8px;background:var(--accent);color:#fff;font-family:"DM Sans",sans-serif;font-size:14px;font-weight:500;padding:0 18px;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:opacity .15s,transform .1s;}',
      '.rc-rd-import-go:active{transform:scale(.96);}',
      '.rc-rd-import-go[disabled]{opacity:.45;}',
      '.rc-rd-import-status{font-size:13px;line-height:1.5;color:var(--muted);}',
      '.rc-rd-import-status.is-error{color:#a8401c;}',
      '.rc-rd-import-status.is-ok{color:#3f7350;}',
      '.rc-rd-import-link{align-self:flex-start;background:none;border:none;padding:0;color:var(--accent);font-family:"DM Sans",sans-serif;font-size:13px;text-decoration:underline;cursor:pointer;-webkit-tap-highlight-color:transparent;}',
      '.rc-rd-import-thumb{width:100%;height:130px;object-fit:cover;border-radius:8px;display:block;}',
      '.rc-rd-import-or{display:flex;align-items:center;gap:12px;color:var(--muted);font-size:10px;letter-spacing:2px;text-transform:uppercase;}',
      '.rc-rd-import-or::before,.rc-rd-import-or::after{content:"";flex:1 1 auto;height:1px;background:var(--border);}',
      '.rc-rd-source{margin-top:18px;font-size:12px;color:var(--muted);}',
      '.rc-rd-source a{color:var(--accent);}',
      // Emoji: a square button on the end of the name row, opening a popover.
      // Anchored right:0 so it can't spill past the scrolling body's edge.
      '.rc-rd-namerow{display:flex;gap:8px;align-items:stretch;}',
      '.rc-rd-namerow .rc-rd-input{flex:1 1 auto;min-width:0;}',
      '.rc-rd-emoji-wrap{position:relative;flex:none;}',
      '.rc-rd-emoji-btn{width:46px;height:100%;min-height:44px;border:1px solid var(--border);border-radius:8px;background:#fff;font-size:22px;line-height:1;cursor:pointer;-webkit-tap-highlight-color:transparent;display:flex;align-items:center;justify-content:center;transition:border-color .15s,transform .1s;}',
      '.rc-rd-emoji-btn:active{transform:scale(.94);}',
      '.rc-rd-emoji-pop{position:absolute;top:calc(100% + 6px);right:0;z-index:8;width:min(300px,calc(100vw - 72px));max-height:230px;overflow-y:auto;-webkit-overflow-scrolling:touch;background:#fff;border:1px solid var(--border);border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.22);padding:10px;display:none;}',
      '.rc-rd-emoji-pop.open{display:block;}',
      '.rc-rd-emoji-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(44px,1fr));gap:8px;}',
      '.rc-rd-emoji-tile{font-size:22px;line-height:1;height:44px;border:1px solid var(--border);border-radius:8px;background:white;cursor:pointer;-webkit-tap-highlight-color:transparent;display:flex;align-items:center;justify-content:center;transition:border-color .12s,background .12s,transform .1s;}',
      '.rc-rd-emoji-tile:active{transform:scale(.92);}',
      '.rc-rd-emoji-tile.selected{border-color:var(--accent);background:var(--accent-light);}',
      // Tag picker (add + edit forms): one dropdown per family, side by side.
      '.rc-rd-tagrow{display:flex;gap:10px;align-items:flex-start;}',
      '.rc-rd-tagcol{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:6px;}',
      '.rc-rd-tagfam-label{font-size:11px;color:var(--muted);font-weight:400;}',
      // .rc-rd-input clears the native appearance, so bring our own chevron.
      '.rc-rd-select{padding-right:30px;cursor:pointer;background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%238a8378\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpath d=\'M6 9l6 6 6-6\'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 9px center;background-size:15px 15px;}',
      '.rc-rd-tagnew[hidden]{display:none;}',

      // Comments
      '.rc-cm-section{margin-top:36px;border-top:1px solid var(--border);padding-top:24px;}',
      '.rc-cm-heading{font-size:10px;letter-spacing:2px;text-transform:uppercase;font-weight:500;color:var(--accent);margin-bottom:14px;}',
      '.rc-cm-list{display:flex;flex-direction:column;gap:12px;margin-bottom:20px;}',
      '.rc-cm-empty{font-size:13px;color:var(--muted);font-style:italic;}',
      '.rc-cm-item{background:white;border:1px solid var(--border);border-radius:8px;padding:11px 13px;display:flex;flex-direction:column;gap:5px;}',
      '.rc-cm-item-header{display:flex;align-items:center;gap:8px;}',
      '.rc-cm-author{font-size:12px;font-weight:600;color:var(--ink);}',
      '.rc-cm-ts{font-size:11px;color:var(--muted);flex:1;}',
      '.rc-cm-del{background:none;border:none;padding:4px;cursor:pointer;color:var(--muted);display:flex;align-items:center;justify-content:center;border-radius:4px;transition:color .15s,background .15s;-webkit-tap-highlight-color:transparent;}',
      '.rc-cm-del:hover{color:#c0392b;background:#fef0ee;}',
      '.rc-cm-del:active{transform:scale(.9);}',
      '.rc-cm-del svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}',
      '.rc-cm-text{font-size:13px;color:var(--ink);line-height:1.5;white-space:pre-wrap;}',
      '.rc-cm-compose{display:flex;flex-direction:column;gap:8px;}',
      '.rc-cm-textarea{width:100%;border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-family:"DM Sans",sans-serif;font-size:16px;font-weight:300;color:var(--ink);background:white;resize:vertical;line-height:1.6;-webkit-appearance:none;appearance:none;outline:none;transition:border-color .15s;box-sizing:border-box;}',
      '.rc-cm-textarea:focus{border-color:var(--accent);}',
      '.rc-cm-compose-footer{display:flex;align-items:center;gap:10px;}',
      '.rc-cm-post-btn{background:var(--accent);color:white;border:none;border-radius:100px;font-family:"DM Sans",sans-serif;font-size:13px;font-weight:500;padding:9px 20px;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s,background .15s;}',
      '.rc-cm-post-btn:active{transform:scale(.94);background:#b3581f;}',
      '.rc-cm-post-btn:disabled{opacity:.45;cursor:default;transform:none;}',
      // Camera button + pending-photo tray in the composer
      '.rc-cm-camera{flex-shrink:0;width:38px;height:38px;border-radius:50%;border:1px solid var(--border);background:white;color:var(--ink);display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s,border-color .15s,color .15s;}',
      '.rc-cm-camera:active{transform:scale(.92);}',
      '.rc-cm-camera:hover{border-color:var(--accent);color:var(--accent);}',
      '.rc-cm-camera svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;}',
      '.rc-cm-camera:disabled{opacity:.45;cursor:default;transform:none;}',
      '.rc-cm-status{flex:1;font-size:12px;color:var(--muted);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.rc-cm-tray{display:none;flex-wrap:wrap;gap:8px;}',
      '.rc-cm-tray.on{display:flex;}',
      '.rc-cm-tray-item{position:relative;width:62px;height:62px;border-radius:8px;overflow:hidden;background:#efe9e0;}',
      '.rc-cm-tray-item img{width:100%;height:100%;object-fit:cover;display:block;}',
      '.rc-cm-tray-x{position:absolute;top:3px;right:3px;width:19px;height:19px;border-radius:50%;border:none;background:rgba(20,19,17,.62);color:#fff;font-size:12px;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent;padding:0;}',
      '.rc-cm-tray-item.busy{opacity:.5;}',
      // Photos attached to a posted note. A lone photo fills the width of the
      // card as a landscape crop; two or more sit two-per-row as squares.
      '.rc-cm-photos{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;}',
      '.rc-cm-photos.one{grid-template-columns:1fr;}',
      '.rc-cm-photo{aspect-ratio:1/1;border-radius:8px;overflow:hidden;background:#efe9e0;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s;}',
      '.rc-cm-photos.one .rc-cm-photo{aspect-ratio:3/2;}',
      '.rc-cm-photo:active{transform:scale(.98);}',
      '.rc-cm-photo img{width:100%;height:100%;object-fit:cover;display:block;}',

      // Journal: the expanded half of a card — that week\'s notes, each with its
      // own photos. Read-only; notes are written from the recipe detail view.
      '.rc-act-block{margin:-4px 0 4px;padding:0 4px 0 16px;border-left:2px solid var(--border);display:flex;flex-direction:column;gap:10px;}',
      '.rc-act-body{display:none;flex-direction:column;gap:14px;}',
      '.rc-act-body.on{display:flex;}',
      '.rc-act-note{display:flex;flex-direction:column;}',
      '.rc-act-note-who{font-size:11px;color:var(--muted);margin-bottom:3px;}',
      '.rc-act-note-text{font-size:13px;color:var(--ink);line-height:1.55;white-space:pre-wrap;font-weight:300;}',

      // Cooking mode
      '#rc-ck-overlay{position:fixed;inset:0;background:var(--ck-bg);z-index:9999;display:flex;flex-direction:column;transform:translateY(100%);transition:transform .38s cubic-bezier(.4,0,.2,1);overflow:hidden;padding-bottom:env(safe-area-inset-bottom,0px);}',
      '#rc-ck-overlay.open{transform:translateY(0);}',
      '.rc-ck-bar{display:flex;align-items:center;gap:12px;padding:calc(16px + env(safe-area-inset-top,0px)) 18px 14px;border-bottom:1px solid var(--ck-border);flex-shrink:0;}',
      '.rc-ck-title{flex:1;font-size:13px;color:var(--ck-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.rc-ck-pips{display:flex;gap:5px;flex-shrink:0;}',
      '.rc-ck-pip{width:22px;height:3px;border-radius:2px;background:var(--ck-border);transition:background .3s;}',
      '.rc-ck-pip.on{background:var(--ck-accent);}',
      '.rc-ck-x{flex-shrink:0;width:32px;height:32px;border-radius:50%;background:var(--ck-dim);border:1px solid var(--ck-border);color:var(--ck-text);font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;transition:background .15s;}',
      '.rc-ck-x:active{background:#38372f;}',
      '.rc-ck-panels-wrap{flex:1;overflow:hidden;position:relative;}',
      '.rc-ck-track{display:flex;width:200%;height:100%;transition:transform .35s cubic-bezier(.4,0,.2,1);}',
      '.rc-ck-track.flipped{transform:translateX(-50%);}',
      '.rc-ck-panel{flex:0 0 50%;height:100%;display:flex;flex-direction:column;overflow:hidden;}',
      '.rc-ck-ing-scroll{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:36px 28px 100px;}',
      '.rc-ck-panel-tag{font-size:11px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--ck-accent);display:block;margin-bottom:20px;}',
      '.rc-ck-ing-headline{font-family:"Playfair Display",serif;font-size:clamp(24px,7vw,44px);font-weight:700;color:var(--ck-text);line-height:1.1;margin-bottom:32px;}',
      '.rc-ck-ings{list-style:none;}',
      '.rc-ck-ing-row{display:flex;align-items:baseline;gap:16px;padding:16px 0;border-bottom:1px solid var(--ck-border);}',
      '.rc-ck-ing-row:last-child{border-bottom:none;}',
      '.rc-ck-qty{font-family:"Playfair Display",serif;font-size:16px;font-weight:600;color:var(--ck-accent);min-width:54px;text-align:right;flex-shrink:0;}',
      '.rc-ck-item-name{font-size:clamp(16px,4vw,20px);color:var(--ck-text);font-weight:300;line-height:1.35;}',
      '.rc-ck-ing-detail{color:var(--ck-muted);font-style:italic;font-size:.85em;}',
      // Section header: spans the whole row, no quantity column, no rule under
      // it — the gap above is what separates one group from the last.
      '.rc-ck-ing-head{padding:26px 0 6px;font-size:11px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--ck-accent);}',
      '.rc-ck-ings li.rc-ck-ing-head:first-child{padding-top:0;}',
      '.rc-ck-swipe-hint-ing{position:absolute;bottom:24px;left:0;right:50%;display:flex;align-items:center;justify-content:center;gap:7px;color:var(--ck-muted);font-size:12px;pointer-events:none;transition:opacity .5s;}',
      '.rc-ck-swipe-hint-ing.gone{opacity:0;}',
      '.rc-ck-step-vp{flex:1;position:relative;overflow:hidden;touch-action:none;}',
      '.rc-ck-slide{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:28px 32px 16px;gap:10px;opacity:0;transform:translateY(48px);transition:opacity .28s ease,transform .28s ease;pointer-events:none;}',
      '.rc-ck-slide.active{opacity:1;transform:none;pointer-events:all;}',
      '.rc-ck-slide.exit-up{opacity:0;transform:translateY(-48px);pointer-events:none;}',
      '.rc-ck-slide.exit-down{opacity:0;transform:translateY(48px);pointer-events:none;}',
      '.rc-ck-step-big{font-family:"Playfair Display",serif;font-size:clamp(64px,20vw,100px);font-weight:700;color:var(--ck-accent);line-height:1;letter-spacing:-.03em;}',
      '.rc-ck-step-of{font-size:13px;color:var(--ck-muted);margin-top:-6px;}',
      '.rc-ck-step-body{font-size:clamp(17px,4.2vw,21px);color:var(--ck-text);line-height:1.62;font-weight:300;margin-top:8px;}',
      '.rc-ck-swipe-hint-steps{position:absolute;bottom:16px;left:0;right:0;display:flex;align-items:center;justify-content:center;gap:7px;color:var(--ck-muted);font-size:12px;pointer-events:none;transition:opacity .5s;}',
      '.rc-ck-swipe-hint-steps.gone{opacity:0;}',
      '.rc-ck-footer{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:14px 22px 18px;border-top:1px solid var(--ck-border);}',
      '.rc-ck-nav{width:46px;height:46px;border-radius:50%;background:var(--ck-dim);border:1px solid var(--ck-border);color:var(--ck-text);font-size:20px;display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background .15s,opacity .2s;flex-shrink:0;}',
      '.rc-ck-nav:active:not(:disabled){background:#38372f;}',
      '.rc-ck-nav:disabled{opacity:.2;cursor:default;}',
      '.rc-ck-dots{display:flex;gap:7px;align-items:center;flex-wrap:wrap;justify-content:center;flex:1;padding:0 12px;}',
      '.rc-ck-dot{width:7px;height:7px;border-radius:50%;background:var(--ck-border);transition:background .3s,transform .3s;flex-shrink:0;}',
      '.rc-ck-dot.on{background:var(--ck-accent);transform:scale(1.5);}',
      '.rc-ck-dot.done{background:var(--ck-done);}',
      '.rc-hintsvg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;}'
    ].join('');
    document.head.appendChild(style);

    // HTML — detail overlay + cooking mode overlay
    var wrap = document.createElement('div');
    wrap.innerHTML = [
      // ── Detail overlay
      '<div id="rc-rd-backdrop"></div>',
      '<div id="rc-rd-overlay" aria-hidden="true">',
        // Floating top buttons (view mode) — back + more menu
        '<div class="rc-rd-topbtns" id="rc-rd-topbtns">',
          '<button class="rc-rd-iconbtn rc-rd-back" id="rc-rd-back" aria-label="Close">←</button>',
          '<div class="rc-rd-more-wrap">',
            '<button class="rc-rd-iconbtn" id="rc-rd-more" aria-label="More options">⋯</button>',
            '<div class="rc-rd-more-menu" id="rc-rd-more-menu">',
              '<button class="rc-rd-more-opt" id="rc-rd-menu-edit"><svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>Edit recipe</button>',
              '<button class="rc-rd-more-opt" id="rc-rd-menu-save"><svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg><span id="rc-rd-menu-save-label">Save to recipes</span></button>',
            '</div>',
          '</div>',
        '</div>',
        // Edit mode header
        '<div class="rc-rd-edit-bar" id="rc-rd-edit-bar" style="display:none">',
          '<button class="rc-rd-cancel-btn" id="rc-rd-cancel">Cancel</button>',
          '<span class="rc-rd-edit-bar-title">Editing</span>',
          '<button class="rc-rd-save-edit-btn" id="rc-rd-save-edit">Save</button>',
        '</div>',
        '<div class="rc-rd-body">',
          '<div class="rc-rd-inner" id="rc-rd-inner">',
            '<div class="rc-rd-hero empty" id="rc-rd-hero">',
              '<div class="rc-rd-hero-media" id="rc-rd-hero-media"></div>',
              '<div class="rc-rd-hero-scrim"></div>',
              '<div class="rc-rd-hero-cta">',
                '<svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
                '<span>Add a photo</span>',
              '</div>',
              '<button class="rc-rd-hero-edit" id="rc-rd-hero-edit" type="button" aria-label="Change cover photo">',
                '<svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
              '</button>',
              '<div class="rc-rd-hero-count" id="rc-rd-hero-count">',
                '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
                '<span id="rc-rd-hero-count-n"></span>',
              '</div>',
              '<div class="rc-rd-hero-title">',
                '<div class="rc-rd-name" id="rc-rd-name"></div>',
                '<div class="rc-rd-meta" id="rc-rd-meta"></div>',
              '</div>',
            '</div>',
            '<div class="rc-rd-note" id="rc-rd-note" style="display:none"></div>',
            '<div class="rc-rd-cols">',
              '<div><div class="rc-rd-section-title">Ingredients</div><ul class="rc-rd-ing-list" id="rc-rd-ings"></ul></div>',
              '<div><div class="rc-rd-section-title">Directions</div><ol class="rc-rd-step-list" id="rc-rd-steps"></ol></div>',
            '</div>',
            '<div class="rc-rd-tags" id="rc-rd-tags" style="display:none">',
              '<div class="rc-rd-section-title">Tags</div>',
              '<div class="rc-rd-tag-row" id="rc-rd-tag-row"></div>',
            '</div>',
            '<div class="rc-rd-source" id="rc-rd-source" style="display:none"></div>',
            '<div class="rc-cm-section">',
              '<div class="rc-cm-heading">Notes</div>',
              '<div class="rc-cm-list" id="rc-cm-list">',
                '<div class="rc-cm-empty" id="rc-cm-empty">No notes yet</div>',
              '</div>',
              '<div class="rc-cm-compose">',
                '<textarea class="rc-cm-textarea" id="rc-cm-textarea" placeholder="Add a note…" rows="3"></textarea>',
                '<div class="rc-cm-tray" id="rc-cm-tray"></div>',
                '<div class="rc-cm-compose-footer">',
                  '<button class="rc-cm-camera" id="rc-cm-camera" type="button" aria-label="Add a photo">',
                    CAMERA_ICON,
                  '</button>',
                  '<span class="rc-cm-status" id="rc-cm-status"></span>',
                  '<button class="rc-cm-post-btn" id="rc-cm-post">Post</button>',
                '</div>',
              '</div>',
            '</div>',
          '</div>',
        '</div>',
        '<button class="rc-rd-cook-fab" id="rc-rd-cook"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>Cook</button>',
      '</div>',

      // ── Photo action sheet + hidden file inputs
      '<input type="file" id="rc-photo-file" accept="image/*" style="display:none">',
      // No `capture` attribute on purpose — without it iOS offers "Take Photo /
      // Photo Library / Choose File", which is exactly the choice we want here.
      '<input type="file" id="rc-cm-file" accept="image/*" multiple style="display:none">',
      '<div id="rc-photo-menu" class="rc-photo-menu" aria-hidden="true">',
        '<div class="rc-photo-sheet">',
          '<button class="rc-photo-opt" id="rc-photo-find">Find a photo</button>',
          '<button class="rc-photo-opt" id="rc-photo-upload">Upload a photo</button>',
          '<button class="rc-photo-opt" id="rc-photo-url">Paste image URL</button>',
          '<button class="rc-photo-opt rc-photo-remove" id="rc-photo-remove">Remove photo</button>',
          '<button class="rc-photo-opt rc-photo-cancel" id="rc-photo-cancel">Cancel</button>',
        '</div>',
      '</div>',

      // ── Find-a-photo overlay (Pexels search)
      '<div id="rc-find" class="rc-find" aria-hidden="true">',
        '<div class="rc-find-bar">',
          '<button class="rc-find-back" id="rc-find-back">←</button>',
          '<input class="rc-find-input" id="rc-find-input" placeholder="Search food photos…" enterkeyhint="search">',
          '<button class="rc-find-go" id="rc-find-go">Search</button>',
        '</div>',
        '<div class="rc-find-body" id="rc-find-body"></div>',
      '</div>',

      // ── Photo gallery viewer (every cook-log photo for one recipe)
      '<div id="rc-gal" class="rc-gal" aria-hidden="true">',
        '<div class="rc-gal-bar">',
          '<button class="rc-gal-iconbtn" id="rc-gal-back" type="button" aria-label="Close">←</button>',
          '<span class="rc-gal-pos" id="rc-gal-pos"></span>',
          '<button class="rc-gal-iconbtn" id="rc-gal-more" type="button" aria-label="Photo options">⋯</button>',
        '</div>',
        '<div class="rc-gal-vp" id="rc-gal-vp"></div>',
        '<div class="rc-gal-dots" id="rc-gal-dots"></div>',
        '<div class="rc-gal-cap">',
          '<div class="rc-gal-cap-who" id="rc-gal-cap-who"></div>',
          '<div class="rc-gal-cap-text" id="rc-gal-cap-text"></div>',
        '</div>',
      '</div>',
      '<div id="rc-gal-menu" class="rc-gal-menu" aria-hidden="true">',
        '<div class="rc-photo-sheet">',
          '<button class="rc-photo-opt" id="rc-gal-cover">Use as cover photo</button>',
          '<button class="rc-photo-opt rc-photo-remove" id="rc-gal-delete">Delete photo</button>',
          '<button class="rc-photo-opt rc-photo-cancel" id="rc-gal-cancel">Cancel</button>',
        '</div>',
      '</div>',

      // ── Cooking mode overlay
      '<div id="rc-ck-overlay" aria-hidden="true">',
        '<div class="rc-ck-bar">',
          '<span class="rc-ck-title" id="rc-ck-title"></span>',
          '<div class="rc-ck-pips">',
            '<div class="rc-ck-pip on" id="rc-ck-pip0"></div>',
            '<div class="rc-ck-pip" id="rc-ck-pip1"></div>',
          '</div>',
          '<button class="rc-ck-x" id="rc-ck-x">✕</button>',
        '</div>',
        '<div class="rc-ck-panels-wrap">',
          '<div class="rc-ck-track" id="rc-ck-track">',
            '<div class="rc-ck-panel">',
              '<div class="rc-ck-ing-scroll" id="rc-ck-ing-scroll">',
                '<span class="rc-ck-panel-tag">Ingredients</span>',
                '<h2 class="rc-ck-ing-headline" id="rc-ck-ing-headline"></h2>',
                '<ul class="rc-ck-ings" id="rc-ck-ings"></ul>',
              '</div>',
              '<div class="rc-ck-swipe-hint-ing" id="rc-ck-hint-ing">',
                '<svg class="rc-hintsvg" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>Swipe right for steps',
              '</div>',
            '</div>',
            '<div class="rc-ck-panel">',
              '<div class="rc-ck-step-vp" id="rc-ck-step-vp">',
                '<div class="rc-ck-swipe-hint-steps" id="rc-ck-hint-steps">',
                  '<svg class="rc-hintsvg" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>Swipe left for ingredients',
                '</div>',
              '</div>',
              '<div class="rc-ck-footer">',
                '<button class="rc-ck-nav" id="rc-ck-prev">↑</button>',
                '<div class="rc-ck-dots" id="rc-ck-dots"></div>',
                '<button class="rc-ck-nav" id="rc-ck-next">↓</button>',
              '</div>',
            '</div>',
          '</div>',
        '</div>',
      '</div>'
    ].join('');

    // Append overlays to body
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
  }

  // ── Detail overlay logic ────────────────────────────────────────────────
  var curR      = null;
  var rdEl      = null;
  var inEditMode = false;
  var inAddMode  = false;

  function refreshSaveUI(id) {
    // Save/Remove now lives in the ⋯ menu. Core recipes are already in the
    // collection, so the item is hidden for them.
    var saveOpt = document.getElementById('rc-rd-menu-save');
    var labelEl = document.getElementById('rc-rd-menu-save-label');
    if (!saveOpt || !labelEl) return;
    if (isCore(id)) {
      saveOpt.style.display = 'none';
    } else {
      saveOpt.style.display = '';
      labelEl.textContent = isSaved(id) ? 'Remove from recipes' : 'Save to recipes';
    }
  }

  // Show/hide the view-mode chrome (top buttons + Cook pill); also closes the
  // ⋯ menu. Called when entering/leaving edit & add modes.
  function setViewChrome(visible) {
    var tb  = document.getElementById('rc-rd-topbtns');
    var fab = document.getElementById('rc-rd-cook');
    if (tb)  tb.style.display  = visible ? '' : 'none';
    if (fab) fab.style.display = visible ? '' : 'none';
    if (!visible) closeMoreMenu();
  }

  function openMoreMenu()  { var m = document.getElementById('rc-rd-more-menu'); if (m) m.classList.add('open'); }
  function closeMoreMenu() { var m = document.getElementById('rc-rd-more-menu'); if (m) m.classList.remove('open'); }

  function renderDetailBody(recipe) {
    document.getElementById('rc-rd-name').textContent = recipe.name;
    var metaEl = document.getElementById('rc-rd-meta');
    if (metaEl) { metaEl.textContent = recipe.meta || ''; metaEl.style.display = recipe.meta ? '' : 'none'; }
    document.getElementById('rc-rd-ings').innerHTML  = ingListHTML(recipe.ings || recipe.ingredients || []);
    document.getElementById('rc-rd-steps').innerHTML = (recipe.steps || []).map(function (s, n) {
      return '<li><span class="rc-rd-step-num">' + (n + 1) + '</span><span>' + escHtml(s) + '</span></li>';
    }).join('');
    var tags = tagsFor(recipe);
    document.getElementById('rc-rd-tags').style.display = tags.length ? '' : 'none';
    document.getElementById('rc-rd-tag-row').innerHTML = tags.map(function (t) {
      return '<span class="rc-rd-tag">' + escHtml(t) + '</span>';
    }).join('');
    var noteEl = document.getElementById('rc-rd-note');
    if (recipe.note) { noteEl.textContent = recipe.note; noteEl.style.display = ''; }
    else             { noteEl.style.display = 'none'; }

    // Imported recipes keep a link back to where they came from — useful when
    // the scrape missed a detail and you want to see the original.
    var srcEl = document.getElementById('rc-rd-source');
    if (srcEl) {
      var url = /^https?:\/\//i.test(recipe.source || '') ? recipe.source : '';
      if (url) {
        srcEl.innerHTML = 'From <a href="' + escAttr(url) + '" target="_blank" rel="noopener noreferrer">' +
                          escHtml(sourceHost(url)) + '</a>';
        srcEl.style.display = '';
      } else {
        srcEl.style.display = 'none';
      }
    }
  }

  function sourceHost(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch (e) { return 'the original recipe'; }
  }

  function openDetail(r, weekOf) {
    var id     = idOf(r);
    var edit   = recipeEdits[fbSafeKey(id)];
    curR = edit ? Object.assign({}, r, edit) : r;

    renderDetailBody(curR);
    document.querySelector('.rc-rd-body').scrollTop = 0;

    currentRecipeId = fbSafeKey(id);
    // Notes posted from here are stamped with the week this card belongs to.
    currentWeekOf = weekOf || defaultWeekOf;
    loadPhoto(currentRecipeId);
    loadComments(currentRecipeId);
    refreshHeroCount(currentRecipeId);
    var cmTa = document.getElementById('rc-cm-textarea');
    if (cmTa) cmTa.value = '';
    clearComposerPhotos();
    composerStatus('');
    syncPostButton();

    // Wire the ⋯-menu Save item to this recipe
    var saveOpt = document.getElementById('rc-rd-menu-save');
    if (saveOpt) saveOpt.onclick = function () { toggleSave(id, curR); closeMoreMenu(); };
    refreshSaveUI(id);

    setViewChrome(true);
    closeMoreMenu();
    document.getElementById('rc-rd-backdrop').classList.add('open');
    rdEl.classList.add('open');
    rdEl.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeDetail() {
    if (inEditMode) exitEditMode();
    if (inAddMode) exitAddMode();
    closeMoreMenu();
    document.getElementById('rc-rd-backdrop').classList.remove('open');
    rdEl.classList.remove('open');
    rdEl.setAttribute('aria-hidden', 'true');
    var ckEl = document.getElementById('rc-ck-overlay');
    if (!ckEl || !ckEl.classList.contains('open')) document.body.style.overflow = '';
  }

  // ── Hero photo ──────────────────────────────────────────────────────────
  // Photos are stored per-recipe in Firebase at /recipe-photos/<safeId> as
  // { src, by, at }. src is either a resized JPEG data URL (uploads) or a
  // pasted image URL. Fetched lazily when a recipe opens; never bulk-loaded.
  var CAMERA_ICON =
    '<svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';

  // Swap only the hero's background media; the title / scrim / CTA / change
  // button are persistent siblings and must survive photo changes.
  function renderHero(src) {
    var hero  = document.getElementById('rc-rd-hero');
    var media = document.getElementById('rc-rd-hero-media');
    if (!hero || !media) return;
    hero.classList.remove('busy');
    if (src) {
      hero.classList.remove('empty');
      hero.classList.add('has-photo');
      media.innerHTML = '<img src="' + escAttr(src) + '" alt="">';
    } else {
      hero.classList.remove('has-photo');
      hero.classList.add('empty');
      media.innerHTML = '';
    }
  }

  // Load the cover for a recipe. safeId is captured so a slow response for a
  // previously-open recipe can't overwrite the current one.
  //
  // The cover is deliberately sticky: taking new cook-log photos never changes it.
  // The only fallback is when no cover was ever chosen, in which case the newest
  // cook-log photo stands in so the hero isn't a bare gradient.
  function loadPhoto(safeId) {
    renderHero(null);
    // Opening a recipe is also when the gallery's cover slide gets its facts
    // straight, in case the other person changed the cover since page load.
    delete coverCache[safeId];
    delete coverKeys[safeId];
    loadCover(safeId)
      .then(function (src) {
        if (safeId !== currentRecipeId) return;      // recipe changed meanwhile
        if (src) { renderHero(src); return null; }
        return newestGalleryThumb(safeId).then(function (fallback) {
          if (safeId !== currentRecipeId) return;
          renderHero(fallback);
        });
      })
      .catch(function () { /* leave empty state */ });
  }

  // PATCH, not PUT: /recipe-photos/<safeId> also holds `gallery`, and a PUT of
  // {src, by, at} would delete every cook-log photo for the recipe.
  // `fromGalleryKey` is set only when the cover was promoted from a cook-log
  // photo, so the viewer can move that photo to the front rather than show the
  // same image twice. Passing nothing clears it (null deletes the child).
  function savePhoto(src, safeIdOverride, fromGalleryKey) {
    var safeId = safeIdOverride || currentRecipeId;
    if (!safeId || !src) return Promise.resolve();
    if (safeId === currentRecipeId) renderHero(src);   // optimistic
    photoCache[safeId] = src;
    coverCache[safeId] = src;
    coverKeys[safeId]  = fromGalleryKey || null;
    applyCoverToCards(safeId, src);
    var body = JSON.stringify({
      src: src, by: currentUserEmail || '', at: Date.now(),
      coverKey: fromGalleryKey || null
    });
    refreshHeroCount(safeId);   // the cover is a slide now, so it's in the count
    return authedFetch(FB_PHOTOS + '/' + safeId + '.json', { method: 'PATCH', body: body })
      .then(function (r) { if (!r.ok) throw new Error('save failed'); })
      .catch(function () { alert('Could not save the photo. Please try again.'); });
  }

  // Clear only the cover — the cook-log gallery is a separate child and stays.
  // PATCH with nulls rather than DELETE so `coverKey` goes with it.
  function removePhoto() {
    var safeId = currentRecipeId;
    if (!safeId) return;
    delete photoCache[safeId];
    coverCache[safeId] = null;
    coverKeys[safeId]  = null;
    authedFetch(FB_PHOTOS + '/' + safeId + '.json', {
      method: 'PATCH',
      body: JSON.stringify({ src: null, coverKey: null })
    })
      .catch(function () { /* it'll reconcile on next open */ })
      .then(function () {
        if (safeId !== currentRecipeId) return;
        loadPhoto(safeId);
        refreshHeroCount(safeId);
      });
  }

  // Repaint any already-rendered card thumbnails after the cover changes.
  function applyCoverToCards(safeId, src) {
    if (!src) return;
    document.querySelectorAll('.rc-thumb[data-photo-id="' + escAttr(safeId) + '"]')
      .forEach(function (thumb) {
        var img = thumb.querySelector('img');
        if (img) img.src = src;
        else applyThumbPhoto(thumb, src);
      });
  }

  // Decode a picked file once, then scale it as many times as needed. Phone
  // photos are 3–5 MB, so decoding twice for a thumb + a full would be slow.
  function decodeImageFile(file, cb) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload  = function () { cb(img); };
      img.onerror = function () { cb(null); };
      img.src = e.target.result;
    };
    reader.onerror = function () { cb(null); };
    reader.readAsDataURL(file);
  }

  // Downscale a decoded image to a JPEG data URL, longest edge capped at maxDim.
  function scaleImage(img, maxDim, quality) {
    var w = img.width, h = img.height;
    var longest = Math.max(w, h);
    if (longest > maxDim) { var s = maxDim / longest; w = Math.round(w * s); h = Math.round(h * s); }
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    try { return canvas.toDataURL('image/jpeg', quality); }
    catch (err) { return null; }
  }

  // Downscale + JPEG-compress a chosen file to keep stored photos small.
  function resizeImageFile(file, maxDim, quality, cb) {
    decodeImageFile(file, function (img) {
      cb(img ? scaleImage(img, maxDim, quality) : null);
    });
  }

  // Cook-log sizing: a small thumb for every list, one bigger copy for the viewer.
  var PHOTO_FULL_DIM  = 1600, PHOTO_FULL_Q  = 0.80;
  var PHOTO_THUMB_DIM = 360,  PHOTO_THUMB_Q = 0.70;

  // One decode → { thumb, full }. Resolves null if the file isn't a usable image.
  function prepareCookPhoto(file) {
    return new Promise(function (resolve) {
      decodeImageFile(file, function (img) {
        if (!img) { resolve(null); return; }
        var full  = scaleImage(img, PHOTO_FULL_DIM,  PHOTO_FULL_Q);
        var thumb = scaleImage(img, PHOTO_THUMB_DIM, PHOTO_THUMB_Q);
        resolve(full && thumb ? { full: full, thumb: thumb } : null);
      });
    });
  }

  function openPhotoMenu() {
    var menu = document.getElementById('rc-photo-menu');
    var hero = document.getElementById('rc-rd-hero');
    if (!menu || !currentRecipeId) return;
    var hasPhoto = hero && hero.classList.contains('has-photo');
    document.getElementById('rc-photo-remove').style.display = hasPhoto ? '' : 'none';
    menu.classList.add('open');
    menu.setAttribute('aria-hidden', 'false');
  }

  function closePhotoMenu() {
    var menu = document.getElementById('rc-photo-menu');
    if (!menu) return;
    menu.classList.remove('open');
    menu.setAttribute('aria-hidden', 'true');
  }

  // ── Find a photo (Pexels search) ────────────────────────────────────────
  var _pexelsKey = null;   // cached after first fetch from /config/pexelsKey

  function getPexelsKey() {
    if (_pexelsKey) return Promise.resolve(_pexelsKey);
    return authedFetch(FB_BASE + '/config/pexelsKey.json')
      .then(function (r) { return r.json(); })
      .then(function (k) { _pexelsKey = k; return k; });
  }

  // Turn a recipe name into a good search query (drop filler words).
  function cleanQuery(name) {
    var stop = { easy:1, weeknight:1, best:1, quick:1, simple:1, homemade:1, the:1, with:1, and:1 };
    return String(name || '').toLowerCase().split(',')[0]
      .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
      .filter(function (w) { return w.length > 2 && !stop[w]; }).join(' ');
  }

  function findStatus(msg) {
    document.getElementById('rc-find-body').innerHTML =
      '<div class="rc-find-status">' + escHtml(msg) + '</div>';
  }

  function runFind(query) {
    query = (query || '').trim();
    if (!query) return;
    findStatus('Searching…');
    getPexelsKey().then(function (key) {
      if (!key) { findStatus('Photo search isn’t set up yet.'); return; }
      return fetch('https://api.pexels.com/v1/search?query=' + encodeURIComponent(query) +
                   '&per_page=24&orientation=landscape', { headers: { Authorization: key } })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var photos = (j && j.photos) || [];
          if (!photos.length) { findStatus('No photos found. Try different words.'); return; }
          var grid = document.createElement('div');
          grid.className = 'rc-find-grid';
          photos.forEach(function (p) {
            var t = document.createElement('div');
            t.className = 'rc-find-thumb';
            t.innerHTML = '<img src="' + escAttr(p.src.medium) + '" alt="" loading="lazy">';
            t.addEventListener('click', function () { pickFound(p, t); });
            grid.appendChild(t);
          });
          var body = document.getElementById('rc-find-body');
          body.innerHTML = '';
          body.appendChild(grid);
        });
    }).catch(function () { findStatus('Something went wrong. Please try again.'); });
  }

  // Save a chosen search result. Download + embed it (durable) so it can't
  // break later; fall back to the remote URL if the download is blocked.
  function pickFound(photo, tileEl) {
    if (tileEl) tileEl.classList.add('saving');
    fetch(photo.src.landscape)
      .then(function (r) { return r.blob(); })
      .then(function (blob) {
        var reader = new FileReader();
        reader.onload  = function (e) { savePhoto(e.target.result); closeFind(); };
        reader.onerror = function ()  { savePhoto(photo.src.landscape); closeFind(); };
        reader.readAsDataURL(blob);
      })
      .catch(function () { savePhoto(photo.src.landscape); closeFind(); });
  }

  function openFindPhoto() {
    if (!currentRecipeId) return;
    var input = document.getElementById('rc-find-input');
    input.value = cleanQuery(curR && curR.name);
    var el = document.getElementById('rc-find');
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    runFind(input.value);
  }

  function closeFind() {
    var el = document.getElementById('rc-find');
    if (!el) return;
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
  }

  // ── Photo gallery viewer ────────────────────────────────────────────────
  // Every cook-log photo for one recipe, newest first, swipeable. Slides render
  // the cached thumb (blurred) immediately and swap in the full-size copy as it
  // arrives, so opening the gallery never shows a blank screen.
  var galSafeId = null, galRecipe = null, galKeys = [], galIdx = 0;
  var galSlides = [], galDots = [], galFullLoaded = {};

  function galOpen() {
    var el = document.getElementById('rc-gal');
    return !!(el && el.classList.contains('open'));
  }

  // Look up the note a photo belongs to, for the caption.
  function noteForPhoto(safeId, photoKey) {
    var all = activityIndex[safeId] || [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].photos.indexOf(photoKey) !== -1) return all[i];
    }
    return null;
  }

  function weekLabel(weekOf) {
    if (!weekOf) return '';
    var parts = String(weekOf).split('-');
    if (parts.length !== 3) return weekOf;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(d.getTime())) return weekOf;
    return 'Week of ' + d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  }

  function renderGalCaption() {
    var whoEl  = document.getElementById('rc-gal-cap-who');
    var textEl = document.getElementById('rc-gal-cap-text');
    var posEl  = document.getElementById('rc-gal-pos');
    if (!whoEl || !textEl) return;
    var key  = galKeys[galIdx];
    var note = key ? noteForPhoto(galSafeId, key) : null;
    if (posEl) posEl.textContent = galKeys.length ? (galIdx + 1) + ' of ' + galKeys.length : '';

    // The cover isn't a cook-log photo, so there's nothing the ⋯ menu can do to
    // it — changing the cover is the camera button on the hero.
    var moreBtn = document.getElementById('rc-gal-more');
    if (moreBtn) moreBtn.style.visibility = (key === COVER_KEY) ? 'hidden' : '';

    if (key === COVER_KEY) {
      textEl.textContent = 'Cover photo';
      whoEl.textContent  = '';
      loadGalleryMeta(galSafeId, key).then(function (meta) {
        if (galKeys[galIdx] !== key) return;
        var who = [];
        if (meta.author) who.push('Set by ' + meta.author);
        if (meta.at) who.push(new Date(meta.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
        whoEl.textContent = who.join(' · ');
      });
      return;
    }

    if (note) {
      var bits = [note.author, new Date(note.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })];
      var wk = weekLabel(note.weekOf);
      if (wk) bits.push(wk);
      whoEl.textContent  = bits.join(' · ');
      textEl.textContent = note.text || '';
      return;
    }
    // No note in the index (e.g. opened straight from a card): fall back to the
    // photo's own stamped metadata.
    whoEl.textContent  = '';
    textEl.textContent = '';
    if (!key) return;
    loadGalleryMeta(galSafeId, key).then(function (meta) {
      if (galKeys[galIdx] !== key) return;
      var bits = [];
      if (meta.author) bits.push(meta.author);
      if (meta.at) bits.push(new Date(meta.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
      var wk2 = weekLabel(meta.weekOf);
      if (wk2) bits.push(wk2);
      whoEl.textContent = bits.join(' · ');
    });
  }

  // Fetch the full-size copy for a slide, once.
  function hydrateGalSlide(i) {
    var key = galKeys[i];
    if (!key || galFullLoaded[key]) return;
    galFullLoaded[key] = true;
    loadGalleryFull(galSafeId, key).then(function (src) {
      if (!src) return;
      var slide = galSlides[i];
      if (!slide || galKeys[i] !== key) return;
      var img = slide.querySelector('img');
      if (img) { img.src = src; img.classList.remove('placeholder'); }
    });
  }

  function goGal(n) {
    if (n < 0 || n >= galKeys.length || n === galIdx) return;
    if (galSlides[galIdx]) galSlides[galIdx].classList.remove('active');
    if (galDots[galIdx])   galDots[galIdx].classList.remove('on');
    galIdx = n;
    if (galSlides[galIdx]) galSlides[galIdx].classList.add('active');
    if (galDots[galIdx])   galDots[galIdx].classList.add('on');
    renderGalCaption();
    hydrateGalSlide(galIdx);
    hydrateGalSlide(galIdx + 1);        // preload neighbours so a swipe is instant
    hydrateGalSlide(galIdx - 1);
  }

  function buildGalSlides() {
    var vp   = document.getElementById('rc-gal-vp');
    var dots = document.getElementById('rc-gal-dots');
    if (!vp || !dots) return;
    vp.innerHTML = '';
    dots.innerHTML = '';
    galSlides = [];
    galDots = [];
    galFullLoaded = {};

    if (!galKeys.length) {
      vp.innerHTML = '<div class="rc-gal-empty">No photos yet</div>';
      renderGalCaption();
      return;
    }

    galKeys.forEach(function (key, i) {
      var slide = document.createElement('div');
      slide.className = 'rc-gal-slide' + (i === galIdx ? ' active' : '');
      slide.innerHTML = '<img class="placeholder" alt="">';
      vp.appendChild(slide);
      galSlides.push(slide);

      var dot = document.createElement('div');
      dot.className = 'rc-gal-dot' + (i === galIdx ? ' on' : '');
      dots.appendChild(dot);
      galDots.push(dot);

      loadGalleryThumb(galSafeId, key).then(function (src) {
        if (!src || galKeys[i] !== key) return;
        var img = slide.querySelector('img');
        if (img && img.classList.contains('placeholder')) img.src = src;
      });
    });

    renderGalCaption();
    hydrateGalSlide(galIdx);
    hydrateGalSlide(galIdx + 1);
    hydrateGalSlide(galIdx - 1);
  }

  // opts: { safeId, startKey, weekOf }. weekOf narrows the gallery to one week's
  // photos — the Journal uses it so tapping a March photo doesn't scroll through
  // every other time you cooked the dish.
  function openGallery(recipe, opts) {
    opts = opts || {};
    var el = document.getElementById('rc-gal');
    if (!el) return;
    galSafeId = opts.safeId || (recipe ? fbSafeKey(idOf(recipe)) : currentRecipeId);
    galRecipe = recipe || curR;
    if (!galSafeId) return;

    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    galleryKeysWithCover(galSafeId).then(function (keys) {
      galKeys = keys.slice();
      if (opts.weekOf) {
        var wanted = {};
        (activityIndex[galSafeId] || []).forEach(function (n) {
          if (n.weekOf === opts.weekOf) n.photos.forEach(function (p) { wanted[p] = true; });
        });
        // Only narrow if the index actually knows about this week's photos —
        // otherwise show everything rather than an empty gallery.
        if (Object.keys(wanted).length) {
          galKeys = galKeys.filter(function (k) { return wanted[k]; });
        }
      }
      var start = opts.startKey ? galKeys.indexOf(opts.startKey) : 0;
      galIdx = start === -1 ? 0 : start;
      buildGalSlides();
    });
  }

  function closeGallery() {
    var el = document.getElementById('rc-gal');
    if (!el) return;
    closeGalMenu();
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
    // The recipe sheet underneath keeps the page locked; only release if it's gone.
    var rd = document.getElementById('rc-rd-overlay');
    var ck = document.getElementById('rc-ck-overlay');
    if ((!rd || !rd.classList.contains('open')) && (!ck || !ck.classList.contains('open'))) {
      document.body.style.overflow = '';
    }
  }

  function openGalMenu() {
    var m = document.getElementById('rc-gal-menu');
    if (!m || !galKeys.length) return;
    if (galKeys[galIdx] === COVER_KEY) return;   // nothing here applies to the cover
    // Only the person who took a photo can delete it. Ownership comes from the
    // note the photo hangs off — the same in-memory lookup the caption uses, so
    // this costs no fetch. A photo with no note left (orphaned by a failed write)
    // stays deletable, otherwise nobody could ever clear it.
    var owner = noteForPhoto(galSafeId, galKeys[galIdx]);
    var delBtn = document.getElementById('rc-gal-delete');
    if (delBtn) delBtn.style.display = (owner && !isMine(owner)) ? 'none' : '';
    m.classList.add('open');
    m.setAttribute('aria-hidden', 'false');
  }

  function closeGalMenu() {
    var m = document.getElementById('rc-gal-menu');
    if (!m) return;
    m.classList.remove('open');
    m.setAttribute('aria-hidden', 'true');
  }

  // Promote the photo on screen to the recipe's cover. This is the only way a
  // cook-log photo ever becomes the cover — taking photos never does it.
  function useGalPhotoAsCover() {
    var key = galKeys[galIdx];
    if (!key || key === COVER_KEY || !galSafeId) return;
    closeGalMenu();
    loadGalleryFull(galSafeId, key).then(function (src) {
      if (!src) return loadGalleryThumb(galSafeId, key);
      return src;
    }).then(function (src) {
      // Passing the key stops the promoted photo showing twice in the viewer.
      if (src) savePhoto(src, galSafeId, key);
    });
  }

  function deleteGalPhoto() {
    var key = galKeys[galIdx];
    if (!key || key === COVER_KEY || !galSafeId) return;
    var owner = noteForPhoto(galSafeId, key);
    if (owner && !isMine(owner)) return;   // not yours to delete
    closeGalMenu();
    if (!confirm('Delete this photo? This can’t be undone.')) return;
    var safeId = galSafeId;

    deletePhotoFromGallery(safeId, key).then(function () {
      // Drop the reference from its note so the note doesn't show a dead thumb.
      var note = noteForPhoto(safeId, key);
      if (note) {
        note.photos = note.photos.filter(function (p) { return p !== key; });
        authedFetch(FB_COMMENTS + '/' + safeId + '/' + note.key + '/photos.json', {
          method: 'PUT',
          body: JSON.stringify(note.photos.length ? note.photos : null)
        }).catch(function () {});
        // Repaint the note's thumbnail row from the updated note.
        document.querySelectorAll('.rc-cm-item[data-key="' + escAttr(note.key) + '"]')
          .forEach(function (item) {
            var row = item.querySelector('.rc-cm-photos');
            if (row) row.remove();
            var fresh = renderNotePhotos(safeId, note, galRecipe);
            if (fresh) item.appendChild(fresh);
          });
      }
      galKeys = galKeys.filter(function (k) { return k !== key; });
      if (galIdx >= galKeys.length) galIdx = Math.max(0, galKeys.length - 1);
      refreshActivityCounts(safeId);
      refreshHeroCount(safeId);
      if (!galKeys.length) { closeGallery(); return; }
      buildGalSlides();
    }).catch(function () {
      alert('Could not delete that photo. Please try again.');
    });
  }

  // Wire the gallery once, at init. Gesture constants match cooking mode so
  // swiping feels the same everywhere in the app.
  function initGallery() {
    var el = document.getElementById('rc-gal');
    var vp = document.getElementById('rc-gal-vp');
    if (!el || !vp) return;

    document.getElementById('rc-gal-back').addEventListener('click', closeGallery);
    document.getElementById('rc-gal-more').addEventListener('click', openGalMenu);
    document.getElementById('rc-gal-cover').addEventListener('click', useGalPhotoAsCover);
    document.getElementById('rc-gal-delete').addEventListener('click', deleteGalPhoto);
    document.getElementById('rc-gal-cancel').addEventListener('click', closeGalMenu);
    document.getElementById('rc-gal-menu').addEventListener('click', function (e) {
      if (e.target === this) closeGalMenu();
    });

    var t0 = null;
    vp.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      t0 = { x: t.clientX, y: t.clientY, ms: Date.now() };
    }, { passive: true });
    vp.addEventListener('touchend', function (e) {
      if (!t0) return;
      var t = e.changedTouches[0], dx = t.clientX - t0.x, dy = t.clientY - t0.y, ms = Date.now() - t0.ms;
      t0 = null;
      var D = 44;
      if (Math.abs(dx) < D || ms > 700) return;
      if (Math.abs(dx) < Math.abs(dy)) return;      // vertical wins: not a page turn
      goGal(dx < 0 ? galIdx + 1 : galIdx - 1);
    }, { passive: true });

    document.addEventListener('keydown', function (e) {
      if (!galOpen()) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); goGal(galIdx + 1); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); goGal(galIdx - 1); }
    });
  }

  // Photo-count pill on the hero — the cue that the image is tappable.
  function refreshHeroCount(safeId) {
    var pill = document.getElementById('rc-rd-hero-count');
    var nEl  = document.getElementById('rc-rd-hero-count-n');
    if (!pill || !nEl) return;
    if (safeId && safeId !== currentRecipeId) return;
    // Counts what the viewer will actually show, cover included, so the pill
    // and the "3 of 5" in the gallery bar can never disagree.
    galleryKeysWithCover(currentRecipeId, true).then(function (keys) {
      if (!currentRecipeId) return;
      nEl.textContent = keys.length;
      pill.classList.toggle('on', keys.length > 0);
    });
  }

  // Wire the hero + action sheet once, at init.
  function initHeroPhoto() {
    var hero = document.getElementById('rc-rd-hero');
    var fileInput = document.getElementById('rc-photo-file');
    if (!hero || !fileInput) return;

    // Tapping the image browses your photos; changing the cover is the small
    // camera button. With no photos yet, the whole hero is the "add" target.
    hero.addEventListener('click', function (e) {
      if (e.target.closest('#rc-rd-hero-edit')) return;   // handled below
      galleryKeysWithCover(currentRecipeId).then(function (keys) {
        if (keys.length) openGallery(curR, { safeId: currentRecipeId });
        else openPhotoMenu();
      });
    });
    document.getElementById('rc-rd-hero-edit').addEventListener('click', function (e) {
      e.stopPropagation();
      openPhotoMenu();
    });

    document.getElementById('rc-photo-find').addEventListener('click', function () {
      closePhotoMenu();
      openFindPhoto();
    });
    document.getElementById('rc-find-back').addEventListener('click', closeFind);
    document.getElementById('rc-find-go').addEventListener('click', function () {
      runFind(document.getElementById('rc-find-input').value);
    });
    document.getElementById('rc-find-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); runFind(this.value); this.blur(); }
    });

    document.getElementById('rc-photo-upload').addEventListener('click', function () {
      closePhotoMenu();
      fileInput.value = '';        // allow re-picking the same file
      fileInput.click();
    });
    document.getElementById('rc-photo-url').addEventListener('click', function () {
      closePhotoMenu();
      var url = prompt('Paste the image URL:');
      if (!url) return;
      url = url.trim();
      if (!/^https?:\/\//i.test(url)) { alert('That doesn’t look like an image link. It should start with http:// or https://'); return; }
      savePhoto(url);
    });
    document.getElementById('rc-photo-remove').addEventListener('click', function () {
      closePhotoMenu();
      removePhoto();
    });
    document.getElementById('rc-photo-cancel').addEventListener('click', closePhotoMenu);
    document.getElementById('rc-photo-menu').addEventListener('click', function (e) {
      if (e.target === this) closePhotoMenu();       // tap backdrop to dismiss
    });

    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      hero.classList.add('busy');
      resizeImageFile(file, 1200, 0.82, function (dataUrl) {
        if (!dataUrl) { hero.classList.remove('busy'); alert('Sorry, that image couldn’t be processed.'); return; }
        savePhoto(dataUrl);
      });
    });
  }

  // Tag picker: one dropdown per family, side by side. A recipe carries one
  // dish type and one cuisine, and those two are what its card shows.
  // The sentinel option below opens a box for a tag that isn't in the list yet.
  // Underscored so it can never collide with something Kyle would actually type.
  var TAG_NEW = '__new__';

  // Split a recipe's tags into one per family. A tag in neither family — which
  // nothing in data/recipes.json currently has — fills the first empty slot so
  // editing a recipe can never silently drop it.
  function tagsByFamily(tags) {
    var picked = {}, spare = [];
    (tags || []).forEach(function (t) {
      var fam = familyOf(t);
      if (fam === 'custom') { spare.push(t); return; }
      if (!picked[fam]) picked[fam] = t;
    });
    TAG_FAMILIES.forEach(function (fam) {
      if (!picked[fam.key] && spare.length) picked[fam.key] = spare.shift();
    });
    return picked;
  }

  function buildTagPickerHTML(tags) {
    var picked = tagsByFamily(tags);
    var cols = TAG_FAMILIES.map(function (fam) {
      var cur = picked[fam.key] || '';
      // A tag already on this recipe but not in the vocabulary still needs an
      // option to sit in, or the dropdown would quietly reset it to nothing.
      var list = (cur && fam.tags.indexOf(cur) === -1) ? [cur].concat(fam.tags) : fam.tags;
      var opts = '<option value="">—</option>' + list.map(function (t) {
        return '<option value="' + escAttr(t) + '"' + (t === cur ? ' selected' : '') + '>' +
               escHtml(t) + '</option>';
      }).join('') +
      '<option value="' + escAttr(TAG_NEW) + '">＋ Add new…</option>';
      return '<div class="rc-rd-tagcol">' +
               '<div class="rc-rd-tagfam-label">' + escHtml(fam.title) + '</div>' +
               '<select class="rc-rd-input rc-rd-select" data-fam="' + escAttr(fam.key) + '">' +
                 opts +
               '</select>' +
               '<input class="rc-rd-input rc-rd-tagnew" type="text" hidden autocomplete="off" ' +
                 'data-newfor="' + escAttr(fam.key) + '" placeholder="New ' +
                 escAttr(fam.title.toLowerCase()) + '">' +
             '</div>';
    }).join('');
    return '<div class="rc-rd-field">' +
             '<label class="rc-rd-field-label">Tags</label>' +
             '<div class="rc-rd-tagrow" id="rc-rd-ef-tags">' + cols + '</div>' +
           '</div>';
  }

  // Build the recipe form markup. Shared by edit mode and add mode.
  // `includeIcon` puts the emoji button on the end of the Recipe Name row.
  // `includeTags` adds the tag picker that feeds the card eyebrow.
  function buildRecipeFormHTML(values, includeIcon, includeTags) {
    var ings  = (values.ings || values.ingredients || []).join('\n');
    var steps = (values.steps || []).join('\n');
    var currentIcon = values.icon || '🍽️';
    // Ensure the current icon is always offered as a tile, even if it's not in
    // the curated list (e.g. an existing recipe with a one-off emoji).
    var emojiList = FOOD_EMOJIS.indexOf(currentIcon) === -1 ?
      [currentIcon].concat(FOOD_EMOJIS) : FOOD_EMOJIS;
    var tiles = emojiList.map(function (e) {
      var sel = e === currentIcon ? ' selected' : '';
      return '<button type="button" class="rc-rd-emoji-tile' + sel + '" data-emoji="' + escAttr(e) + '">' + escHtml(e) + '</button>';
    }).join('');
    // A square button beside the name rather than a 60-tile grid above it —
    // the grid pushed every field that matters off the bottom of the phone.
    var iconField = includeIcon ?
      '<input type="hidden" id="rc-rd-ef-icon" value="' + escAttr(currentIcon) + '">' +
      '<div class="rc-rd-emoji-wrap">' +
        '<button type="button" class="rc-rd-emoji-btn" id="rc-rd-ef-emoji-btn" ' +
          'aria-label="Choose an emoji">' + escHtml(currentIcon) + '</button>' +
        '<div class="rc-rd-emoji-pop" id="rc-rd-ef-emoji-pop">' +
          '<div class="rc-rd-emoji-grid">' + tiles + '</div>' +
        '</div>' +
      '</div>' : '';
    var tagsField = includeTags ? buildTagPickerHTML(values.tags || []) : '';
    // Every field says autocomplete="off", and the title field is "title" rather
    // than "name" all the way down — id, label and all. Left to guess, iOS reads
    // a bare text field labelled "Name" as a person and offers to autofill Kyle.
    return '<div class="rc-rd-field">' +
        '<label class="rc-rd-field-label" for="rc-rd-ef-title">Recipe Title</label>' +
        '<div class="rc-rd-namerow">' +
          '<input class="rc-rd-input" id="rc-rd-ef-title" type="text" autocomplete="off" ' +
            'autocapitalize="words" value="' + escAttr(values.name || '') + '">' +
          iconField +
        '</div>' +
      '</div>' +
      tagsField +
      '<div class="rc-rd-field">' +
        '<label class="rc-rd-field-label" for="rc-rd-ef-meta">Details</label>' +
        '<input class="rc-rd-input" id="rc-rd-ef-meta" type="text" autocomplete="off" value="' + escAttr(values.meta || '') + '" placeholder="30 min · One pan · Serves 4">' +
      '</div>' +
      '<div class="rc-rd-field">' +
        '<label class="rc-rd-field-label" for="rc-rd-ef-ings">Ingredients &mdash; one per line</label>' +
        '<textarea class="rc-rd-input" id="rc-rd-ef-ings" rows="8" autocomplete="off" placeholder="# For the fish&#10;1 1/2 lb tilapia&#10;1 tsp cayenne (or more)">' + escHtml(ings) + '</textarea>' +
        '<div class="rc-rd-field-hint">Start a line with <b>#</b> for a section heading. Put an aside in <b>(parentheses)</b> and it turns grey. <b>1/2</b> becomes &frac12;.</div>' +
      '</div>' +
      '<div class="rc-rd-field">' +
        '<label class="rc-rd-field-label" for="rc-rd-ef-steps">Steps &mdash; one per line</label>' +
        '<textarea class="rc-rd-input" id="rc-rd-ef-steps" rows="10" autocomplete="off" placeholder="Preheat oven to 375°F.&#10;Mix dry ingredients.&#10;...">' + escHtml(steps) + '</textarea>' +
      '</div>' +
      '<div class="rc-rd-field">' +
        '<label class="rc-rd-field-label" for="rc-rd-ef-note">Tip (optional)</label>' +
        '<input class="rc-rd-input" id="rc-rd-ef-note" type="text" autocomplete="off" value="' + escAttr(values.note || '') + '" placeholder="💡 Optional tip for cooks">' +
      '</div>';
  }

  // Wire the emoji picker inside a just-injected form: the square button opens
  // a popover of tiles, and picking one updates the button face and the hidden
  // #rc-rd-ef-icon input that readRecipeForm reads.
  function wireEmojiPicker(container) {
    var grid = container.querySelector('.rc-rd-emoji-grid');
    var btn  = container.querySelector('#rc-rd-ef-emoji-btn');
    var pop  = container.querySelector('#rc-rd-ef-emoji-pop');
    if (!grid || !btn || !pop) return;
    var hidden = container.querySelector('#rc-rd-ef-icon');

    function close() { pop.classList.remove('open'); }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      pop.classList.toggle('open');
      var sel = grid.querySelector('.rc-rd-emoji-tile.selected');
      if (sel && pop.classList.contains('open')) pop.scrollTop = Math.max(0, sel.offsetTop - 60);
    });
    grid.addEventListener('click', function (e) {
      var tile = e.target.closest('.rc-rd-emoji-tile');
      if (!tile) return;
      var emoji = tile.getAttribute('data-emoji');
      if (hidden) hidden.value = emoji;
      btn.textContent = emoji;
      grid.querySelectorAll('.rc-rd-emoji-tile.selected').forEach(function (t) {
        t.classList.remove('selected');
      });
      tile.classList.add('selected');
      close();
    });
    // The form is torn down and rebuilt each time it's opened, so both
    // document-level listeners retire themselves once their popover is gone.
    function onDocClick(e) {
      if (!document.body.contains(pop)) { document.removeEventListener('click', onDocClick); return; }
      if (!pop.classList.contains('open')) return;
      if (!e.target.closest('.rc-rd-emoji-wrap')) close();
    }
    document.addEventListener('click', onDocClick);
    // Capture, so Escape closes the popover without also leaving edit mode.
    function onDocKey(e) {
      if (!document.body.contains(pop)) { document.removeEventListener('keydown', onDocKey, true); return; }
      if (e.key === 'Escape' && pop.classList.contains('open')) { e.stopPropagation(); close(); }
    }
    document.addEventListener('keydown', onDocKey, true);
  }

  // One dropdown per family. Choosing "＋ Add new…" swaps in a text box; what
  // gets typed there becomes a real option, selected, and is remembered for
  // next time (see rememberTag).
  function wireTagPicker(container) {
    var row = container.querySelector('.rc-rd-tagrow');
    if (!row) return;

    row.querySelectorAll('select[data-fam]').forEach(function (sel) {
      var fam  = sel.getAttribute('data-fam');
      var box  = row.querySelector('.rc-rd-tagnew[data-newfor="' + fam + '"]');
      var last = sel.value;

      function hideBox() { box.hidden = true; box.value = ''; }

      // Turn what's in the box into a selected option, or fall back to whatever
      // was chosen before "Add new…" was picked.
      function commit() {
        var tag = box.value.trim();
        hideBox();
        if (!tag) { sel.value = last; return; }
        var existing = Array.prototype.filter.call(sel.options, function (o) {
          return o.value.toLowerCase() === tag.toLowerCase();
        })[0];
        if (existing) { sel.value = existing.value; last = sel.value; return; }
        var opt = new Option(tag, tag, false, true);
        sel.add(opt, sel.options[sel.options.length - 1]);   // above "＋ Add new…"
        last = tag;
        rememberTag(fam, tag);
      }

      sel.addEventListener('change', function () {
        if (sel.value !== TAG_NEW) { last = sel.value; hideBox(); return; }
        box.hidden = false;
        box.focus();
      });
      box.addEventListener('keydown', function (e) {
        if (e.key === 'Enter')  { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.stopPropagation(); box.value = ''; commit(); }
      });
      box.addEventListener('blur', commit);
    });
  }

  // ── Import from a link ──────────────────────────────────────────────────
  // Only ever fills the form in. Nothing is saved until Kyle taps Save, so a
  // scrape that comes back a bit wrong is a thing to tidy up, not a thing to
  // undo. See recipe-import.js for the parsing.

  var pendingCover  = '';   // photo scraped from the page, applied on save
  var pendingSource = '';   // the page it came from, kept on the recipe

  function importPanelHTML(prefill) {
    return '<div class="rc-rd-import" id="rc-rd-import">' +
        '<label class="rc-rd-field-label" for="rc-rd-import-url">Import from a link</label>' +
        '<div class="rc-rd-import-row">' +
          '<input class="rc-rd-input" id="rc-rd-import-url" type="url" inputmode="url" ' +
            'autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" ' +
            'placeholder="https://…" value="' + escAttr(prefill || '') + '">' +
          '<button type="button" class="rc-rd-import-go" id="rc-rd-import-go">Import</button>' +
        '</div>' +
        '<div class="rc-rd-import-status" id="rc-rd-import-status"></div>' +
      '</div>' +
      '<div class="rc-rd-import-or"><span>or fill it in below</span></div>';
  }

  function importStatus(message, kind, extraHTML) {
    var el = document.getElementById('rc-rd-import-status');
    if (!el) return;
    el.className = 'rc-rd-import-status' + (kind ? ' is-' + kind : '');
    el.innerHTML = escHtml(message) + (extraHTML || '');
  }

  function importBusy(busy) {
    var btn = document.getElementById('rc-rd-import-go');
    var input = document.getElementById('rc-rd-import-url');
    if (btn)   { btn.disabled = busy; btn.textContent = busy ? 'Reading…' : 'Import'; }
    if (input) input.disabled = busy;
  }

  // Swap the fields out from under the import panel, leaving the panel itself
  // (and whatever it's saying) in place.
  function refillFormFields(values) {
    var fields = document.getElementById('rc-rd-form-fields');
    if (!fields) return;
    fields.innerHTML = buildRecipeFormHTML(values, true, true);
    wireEmojiPicker(fields);
    wireTagPicker(fields);
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch (e) { return 'that page'; }
  }

  function applyImported(recipe, url) {
    refillFormFields(recipe);
    pendingCover  = recipe.image || '';
    pendingSource = recipe.source || url || '';

    var thumb = pendingCover
      ? '<img class="rc-rd-import-thumb" alt="" style="margin-top:9px" src="' + escAttr(pendingCover) + '" ' +
        'onerror="this.remove()">'
      : '';
    importStatus('Filled in from ' + hostOf(url) + '. Check it over, then tap Save.', 'ok', thumb);
  }

  // The fallback when a page can't be read: paste the recipe in as text.
  function showPasteFallback() {
    var panel = document.getElementById('rc-rd-import');
    if (!panel || document.getElementById('rc-rd-import-text')) return;

    var wrap = document.createElement('div');
    wrap.className = 'rc-rd-field';
    wrap.innerHTML =
      '<label class="rc-rd-field-label" for="rc-rd-import-text">Paste the recipe text</label>' +
      '<textarea class="rc-rd-input" id="rc-rd-import-text" rows="8" autocomplete="off" ' +
        'placeholder="Copy the whole recipe from the page and paste it here — ingredients and steps together is fine."></textarea>' +
      '<button type="button" class="rc-rd-import-go" id="rc-rd-import-text-go" style="margin-top:9px;height:40px">Use this text</button>';
    panel.appendChild(wrap);
    document.getElementById('rc-rd-import-text').focus();

    document.getElementById('rc-rd-import-text-go').addEventListener('click', function () {
      var text = document.getElementById('rc-rd-import-text').value;
      var result = window.RecipeImport.fromText(text);
      if (!result.ok) { importStatus(result.reason + '. Try including the ingredient list.', 'error'); return; }
      wrap.remove();
      refillFormFields(result.recipe);
      pendingCover = '';
      pendingSource = document.getElementById('rc-rd-import-url').value.trim();
      importStatus('Filled in from what you pasted. Check it over, then tap Save.', 'ok');
    });
  }

  function runImport() {
    var input = document.getElementById('rc-rd-import-url');
    if (!input) return;
    var url = input.value.trim();
    if (!url) { input.focus(); return; }
    if (!window.RecipeImport) { importStatus('Import isn’t available right now.', 'error'); return; }

    importBusy(true);
    importStatus('Reading the page…');

    window.RecipeImport.fromUrl(url).then(function (result) {
      importBusy(false);
      if (result.ok) { applyImported(result.recipe, url); return; }
      importStatus('Couldn’t read that page — ' + result.reason + '.', 'error',
        '<br><button type="button" class="rc-rd-import-link" id="rc-rd-import-paste">' +
        'Paste the recipe text instead</button>');
      var paste = document.getElementById('rc-rd-import-paste');
      if (paste) paste.addEventListener('click', showPasteFallback);
    }).catch(function () {
      importBusy(false);
      importStatus('Something went wrong reading that page.', 'error',
        '<br><button type="button" class="rc-rd-import-link" id="rc-rd-import-paste">' +
        'Paste the recipe text instead</button>');
      var paste2 = document.getElementById('rc-rd-import-paste');
      if (paste2) paste2.addEventListener('click', showPasteFallback);
    });
  }

  // Turn "1/2" into "½" the moment the second digit lands, the way Mela does.
  // Bound once to the form rather than to the textareas, because importing a
  // recipe rebuilds every field underneath it (see refillFormFields) — `input`
  // bubbles, so one delegated listener survives that.
  var FRACTION_FIELDS = { 'rc-rd-ef-ings': 1, 'rc-rd-ef-steps': 1 };

  function autoFraction(e) {
    var el = e.target;
    if (!el || !FRACTION_FIELDS[el.id]) return;
    // Mid-word in a dictation or IME composition, nothing is settled yet.
    if (e.isComposing) return;
    if (e.inputType && e.inputType.indexOf('delete') === 0) return;

    var pos = el.selectionStart;
    if (pos == null || pos !== el.selectionEnd) return;      // a selection, not a cursor
    var after = el.value.charAt(pos);
    if (/[\d/.]/.test(after)) return;                        // typing inside a longer number

    var m = /(^|[^\d/.])(\d)\/(\d)$/.exec(el.value.slice(0, pos));
    if (!m) return;
    var glyph = IngFormat.FRACTIONS[m[2] + '/' + m[3]];
    if (!glyph) return;

    // execCommand is the only replacement iOS Safari keeps on the undo stack,
    // so an unwanted ½ is always one ⌘Z away. setRangeText is the fallback.
    var start = pos - 3;
    el.setSelectionRange(start, pos);
    var done = false;
    try { done = document.execCommand('insertText', false, glyph); } catch (err) { done = false; }
    if (!done) {
      el.setRangeText(glyph, start, pos, 'end');
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function wireImportPanel(form) {
    var btn = form.querySelector('#rc-rd-import-go');
    if (btn) btn.addEventListener('click', runImport);
    var input = form.querySelector('#rc-rd-import-url');
    if (input) input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); this.blur(); runImport(); }
    });
  }

  // Build + inject the recipe form (with emoji + tags) into the detail body
  // and wire the emoji + tag pickers. Shared by Add and Edit — `importUrl` is
  // add-only (pass a string, even an empty one, to get the import panel).
  function mountRecipeForm(values, importUrl) {
    var existing = document.getElementById('rc-rd-edit-form');
    if (existing) existing.remove();

    var form = document.createElement('div');
    form.id = 'rc-rd-edit-form';
    form.className = 'rc-rd-edit-form';
    form.innerHTML =
      (typeof importUrl === 'string' ? importPanelHTML(importUrl) : '') +
      '<div id="rc-rd-form-fields" class="rc-rd-edit-form" style="padding:0;gap:20px">' +
        buildRecipeFormHTML(values, true, true) +
      '</div>';

    var body = document.querySelector('.rc-rd-body');
    body.appendChild(form);
    body.scrollTop = 0;
    wireEmojiPicker(form);
    wireTagPicker(form);
    form.addEventListener('input', autoFraction);
    if (typeof importUrl === 'string') wireImportPanel(form);
    return form;
  }

  // One tag per dropdown, in card order. A new tag still sitting in its text
  // box (Save tapped without leaving the field first) counts too.
  function readTagPicker() {
    var pick = document.getElementById('rc-rd-ef-tags');
    if (!pick) return [];
    var tags = [];
    pick.querySelectorAll('select[data-fam]').forEach(function (sel) {
      var fam = sel.getAttribute('data-fam');
      var t   = sel.value;
      if (t === TAG_NEW) {
        var box = pick.querySelector('.rc-rd-tagnew[data-newfor="' + fam + '"]');
        t = box ? box.value.trim() : '';
        if (t) rememberTag(fam, t);
      }
      if (t && tags.indexOf(t) === -1) tags.push(t);
    });
    return sortTags(tags);
  }

  // Read all fields from the mounted recipe form.
  function readRecipeForm() {
    var iconEl = document.getElementById('rc-rd-ef-icon');
    return {
      icon:     iconEl ? iconEl.value.trim() : '',
      name:     document.getElementById('rc-rd-ef-title').value.trim(),
      tags:     readTagPicker(),
      meta:     document.getElementById('rc-rd-ef-meta').value.trim(),
      ings:     document.getElementById('rc-rd-ef-ings').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean),
      steps:    document.getElementById('rc-rd-ef-steps').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean),
      note:     document.getElementById('rc-rd-ef-note').value.trim()
    };
  }

  function enterEditMode() {
    if (!curR) return;
    inEditMode = true;

    var editBar = document.getElementById('rc-rd-edit-bar');
    setViewChrome(false);
    editBar.style.display = '';
    editBar.querySelector('.rc-rd-edit-bar-title').textContent = 'Editing';
    document.getElementById('rc-rd-inner').style.display = 'none';

    mountRecipeForm(Object.assign({}, curR, { tags: tagsFor(curR) }));
  }

  // ── Add new recipe ──────────────────────────────────────────────────────
  // `prefillUrl` comes from a shared link (see recipes.html): the URL is filled
  // in and imported straight away, so a share lands on a finished form.
  function openAddForm(prefillUrl) {
    inAddMode = true;
    curR = null;
    currentRecipeId = null;
    pendingCover = '';
    pendingSource = '';

    setViewChrome(false);
    document.getElementById('rc-rd-inner').style.display = 'none';
    var editBar = document.getElementById('rc-rd-edit-bar');
    editBar.style.display = '';
    editBar.querySelector('.rc-rd-edit-bar-title').textContent = 'New Recipe';

    mountRecipeForm({}, prefillUrl || '');

    document.getElementById('rc-rd-backdrop').classList.add('open');
    rdEl.classList.add('open');
    rdEl.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    // Nothing gets focused here. Focusing a field in the same tick as .open
    // asks the browser to scroll to an element that is still translated a whole
    // screen below the viewport, and it obliges — the sheet arrived already
    // scrolled halfway down the form. Kyle taps the field he wants.
    if (prefillUrl) runImport();
  }

  function exitAddMode() {
    inAddMode = false;
    pendingCover = '';
    pendingSource = '';
    setViewChrome(true);
    document.getElementById('rc-rd-inner').style.display = '';
    document.getElementById('rc-rd-edit-bar').style.display = 'none';
    var form = document.getElementById('rc-rd-edit-form');
    if (form) form.remove();
  }

  // Commit a new recipe into data/recipes.json so it becomes a permanent
  // recipe that Agent X can see and suggest. Reuses the same GitHub token +
  // Contents API flow that in-app meal editing uses (index.html). Best-effort:
  // the recipe is already saved to Firebase before this runs, so a failure
  // here only means it isn't yet in the permanent collection.
  function utf8ToBase64(str) { return btoa(unescape(encodeURIComponent(str))); }
  function base64ToUtf8(b64) { return decodeURIComponent(escape(atob(b64.replace(/\n/g, '')))); }

  function getGhToken() {
    var getToken = window.getToken;
    if (!getToken) return Promise.resolve(null);
    return getToken()
      .then(function (tk) { return fetch(FB_BASE + '/config/githubToken.json?auth=' + tk); })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) { return (typeof v === 'string' && v) ? v : null; })
      .catch(function () { return null; });
  }

  function commitRecipeToCore(coreRecipe) {
    return getGhToken().then(function (gh) {
      if (!gh) throw new Error('no token');
      var url = 'https://api.github.com/repos/' + REPO + '/contents/data/recipes.json';
      var headers = {
        'Authorization': 'Bearer ' + gh,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      };
      return fetch(url + '?ref=main', { headers: headers, cache: 'no-store' })
        .then(function (getR) { if (!getR.ok) throw new Error('get failed'); return getR.json(); })
        .then(function (meta) {
          var json = JSON.parse(base64ToUtf8(meta.content));
          json.recipes = json.recipes || [];
          // Upsert by id: replace an existing recipe (edit) or append (add).
          var idx = json.recipes.findIndex(function (r) { return r.id === coreRecipe.id; });
          var verb;
          if (idx === -1) { json.recipes.push(coreRecipe); verb = 'Add'; }
          else            { json.recipes[idx] = coreRecipe; verb = 'Update'; }
          var content = utf8ToBase64(JSON.stringify(json, null, 2) + '\n');
          return fetch(url, {
            method: 'PUT', headers: headers,
            body: JSON.stringify({
              message: verb + ' recipe: ' + coreRecipe.name + ' (in-app)',
              content: content, sha: meta.sha, branch: 'main'
            })
          }).then(function (putR) { if (!putR.ok) throw new Error('put failed'); return true; });
        });
    });
  }

  // Shape a recipe object as a data/recipes.json entry.
  function toCoreRecipe(r) {
    var core = {
      id:          r.id,
      icon:        r.icon,
      name:        r.name,
      meta:        r.meta,
      tags:        r.tags || [],
      ingredients: r.ingredients || r.ings || [],
      steps:       r.steps || []
    };
    if (r.note) core.note = r.note;
    if (r.source) core.source = r.source;   // the page an imported recipe came from
    return core;
  }

  function saveNewRecipe() {
    var f = readRecipeForm();
    if (!f.name) {
      // Bring the field into view before focusing it — the sheet is settled by
      // now, so this scroll is the honest one, not the browser guessing.
      var titleEl = document.getElementById('rc-rd-ef-title');
      titleEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      titleEl.focus({ preventScroll: true });
      return;
    }

    // Unique id: slug of the name, with a numeric suffix on collision.
    var baseId = idOf({ name: f.name });
    var id = baseId, n = 2;
    while (isCore(id) || isSaved(id)) { id = baseId + '-' + n; n++; }

    var recipe = {
      id:          id,
      icon:        f.icon || '🍽️',
      name:        f.name,
      meta:        f.meta,
      tags:        f.tags,
      ingredients: f.ings,
      ings:        f.ings,
      steps:       f.steps
    };
    if (f.note) recipe.note = f.note;
    if (pendingSource) recipe.source = pendingSource;

    // Persist to Firebase + insert the card via the existing save flow.
    // (Instant, syncs between accounts, and is the safe fallback if the
    // git commit below fails.)
    toggleSave(id, recipe);

    // The photo scraped from the imported page becomes the cover, through the
    // same path as pasting an image URL by hand. Best-effort — a recipe with no
    // cover is just a recipe waiting for its first cook-log photo.
    if (pendingCover) savePhoto(pendingCover, fbSafeKey(id));

    exitAddMode();
    closeDetail();

    // Also commit into data/recipes.json so it becomes a permanent recipe
    // that Agent X can see. Lands ~1 min later (after GitHub Pages rebuilds).
    commitRecipeToCore(toCoreRecipe(recipe)).catch(function (err) {
      console.warn('Recipe saved to Firebase but not committed to recipes.json:', err);
      alert('"' + recipe.name + '" was saved and synced, but couldn’t be added to your permanent recipe list just now. It will still show up for you and Josephine. You can try adding it again later to make it permanent.');
    });
  }

  function exitEditMode() {
    inEditMode = false;

    setViewChrome(true);
    document.getElementById('rc-rd-edit-bar').style.display = 'none';
    document.getElementById('rc-rd-inner').style.display = '';

    var form = document.getElementById('rc-rd-edit-form');
    if (form) form.remove();
  }

  function saveRecipeEdit() {
    if (!curR) return;
    var id = idOf(curR);
    var f = readRecipeForm();

    var updated = Object.assign({}, curR, {
      icon:        f.icon || curR.icon || '🍽️',
      name:        f.name || curR.name,
      tags:        f.tags,
      meta:        f.meta,
      ingredients: f.ings,
      ings:        f.ings,
      steps:       f.steps
    });
    if (f.note) { updated.note = f.note; } else { delete updated.note; }

    // Update state
    curR = updated;
    recipeEdits[fbSafeKey(id)] = updated;

    // Persist to Firebase overlay (instant, syncs between accounts).
    authedFetch(FB_EDITS + '/' + fbSafeKey(id) + '.json', {
      method: 'PUT',
      body: JSON.stringify(updated)
    }).catch(function () {});

    // For permanent recipes, also commit the change into data/recipes.json so
    // Agent X's copy stays in sync. Best-effort; the Firebase overlay above is
    // the instant, always-applied source of truth for the site.
    if (isCore(id)) {
      commitRecipeToCore(toCoreRecipe(updated)).catch(function (err) {
        console.warn('Edit saved to Firebase but not committed to recipes.json:', err);
      });
    }

    applyEditsToCards();
    exitEditMode();
    renderDetailBody(curR);
    document.querySelector('.rc-rd-body').scrollTop = 0;
    refreshSaveUI(id);
  }

  // ── Comments ────────────────────────────────────────────────────────────

  function relativeTime(ts) {
    var diff = Date.now() - ts;
    var m = Math.floor(diff / 60000);
    if (m < 1)  return 'just now';
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    var d = Math.floor(h / 24);
    if (d < 7)  return d + 'd ago';
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // The photos belonging to one note. A lone photo fills the width; two or more
  // sit two-per-row. Tapping one opens the gallery viewer on that photo.
  // opts.weekOf scopes the gallery to a week (the Journal passes each week's own
  // key); opts.lazy defers the thumb fetch until the cell scrolls into view,
  // which is what keeps a long Journal from fetching every photo at once.
  function renderNotePhotos(safeId, note, recipe, opts) {
    if (!note.photos.length) return null;
    opts = opts || {};
    var row = document.createElement('div');
    row.className = 'rc-cm-photos' + (note.photos.length === 1 ? ' one' : '');
    note.photos.forEach(function (photoKey) {
      var cell = document.createElement('div');
      cell.className = 'rc-cm-photo';
      row.appendChild(cell);
      if (opts.lazy) {
        lazyGalleryCell(cell, safeId, photoKey);
      } else {
        loadGalleryThumb(safeId, photoKey).then(function (src) {
          if (src) cell.innerHTML = '<img src="' + escAttr(src) + '" alt="">';
        });
      }
      cell.addEventListener('click', function (e) {
        e.stopPropagation();
        openGallery(recipe || curR, {
          safeId: safeId, startKey: photoKey, weekOf: opts.weekOf
        });
      });
    });
    return row;
  }

  function renderComment(note, safeId, recipe) {
    var item = document.createElement('div');
    item.className = 'rc-cm-item';
    item.dataset.key = note.key;
    var trashSvg = '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>';
    // Only the person who wrote a note gets the trash icon on it.
    var mine = isMine(note);
    item.innerHTML =
      '<div class="rc-cm-item-header">' +
        '<span class="rc-cm-author">' + escHtml(note.author || 'Unknown') + '</span>' +
        '<span class="rc-cm-ts">' + relativeTime(note.ts) + '</span>' +
        (mine ? '<button class="rc-cm-del" aria-label="Delete note">' + trashSvg + '</button>' : '') +
      '</div>' +
      (note.text ? '<div class="rc-cm-text">' + escHtml(note.text) + '</div>' : '');
    var photos = renderNotePhotos(safeId, note, recipe);
    if (photos) item.appendChild(photos);
    if (mine) {
      item.querySelector('.rc-cm-del').addEventListener('click', function () {
        deleteComment(safeId, note.key, item);
      });
    }
    return item;
  }

  function loadComments(safeId) {
    var listEl  = document.getElementById('rc-cm-list');
    var emptyEl = document.getElementById('rc-cm-empty');
    if (!listEl) return;
    Array.from(listEl.querySelectorAll('.rc-cm-item')).forEach(function (el) { el.remove(); });
    emptyEl.style.display = '';
    authedFetch(FB_COMMENTS + '/' + safeId + '.json')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (safeId !== currentRecipeId) return;      // recipe changed meanwhile
        var notes = notesFromObject(data);
        activityIndex[safeId] = notes;               // freshest copy wins
        if (!notes.length) return;
        emptyEl.style.display = 'none';
        notes.forEach(function (n) { listEl.appendChild(renderComment(n, safeId)); });
      })
      .catch(function () {});
  }

  // ── Posting a note (text, photos, or both) ──────────────────────────────
  // Photos are written first so the note can reference them by key. If the note
  // write then fails, the orphaned photos are unreachable but harmless — better
  // than a note pointing at photos that were never stored.
  function postNote(safeId, opts) {
    var text    = (opts.text || '').trim();
    var pending = opts.photos || [];         // [{thumb, full}]
    var weekOf  = opts.weekOf || '';
    if (!text && !pending.length) return Promise.reject(new Error('empty'));

    var email  = currentUserEmail || '';
    var author = AUTHOR_MAP[email] || 'Unknown';
    var ts     = Date.now();
    // Random suffix: two people posting in the same millisecond used to
    // silently overwrite each other when the key was just the timestamp.
    var key    = String(ts) + '-' + Math.random().toString(36).slice(2, 6);

    var writes = pending.map(function (p) {
      return savePhotoToGallery(safeId, {
        thumb: p.thumb, full: p.full,
        by: email, author: author, at: ts,
        weekOf: weekOf, commentKey: key
      });
    });

    return Promise.all(writes).then(function (photoKeys) {
      var note = { text: text, author: author, email: email, ts: ts };
      if (weekOf) note.weekOf = weekOf;
      if (photoKeys.length) note.photos = photoKeys;
      return authedFetch(FB_COMMENTS + '/' + safeId + '/' + key + '.json', {
        method: 'PUT',
        body: JSON.stringify(note)
      }).then(function (r) {
        if (!r.ok) throw new Error('write failed');
        var stored = normaliseNote(key, note);
        indexNote(safeId, stored);
        refreshActivityCounts(safeId);
        return stored;
      });
    });
  }

  function submitComment(safeId) {
    var textarea = document.getElementById('rc-cm-textarea');
    var postBtn  = document.getElementById('rc-cm-post');
    var camBtn   = document.getElementById('rc-cm-camera');
    if (!textarea || !postBtn) return;
    if (!textarea.value.trim() && !composerPhotos.length) return;

    postBtn.disabled  = true;
    textarea.disabled = true;
    if (camBtn) camBtn.disabled = true;
    composerStatus(composerPhotos.length ? 'Saving photos…' : 'Posting…');

    postNote(safeId, {
      text: textarea.value,
      photos: composerPhotos,
      weekOf: currentWeekOf
    })
      .then(function (note) {
        textarea.value = '';
        clearComposerPhotos();
        composerStatus('');
        var listEl  = document.getElementById('rc-cm-list');
        var emptyEl = document.getElementById('rc-cm-empty');
        if (listEl) {
          emptyEl.style.display = 'none';
          listEl.insertBefore(renderComment(note, safeId), listEl.firstChild);
        }
        refreshHeroCount(safeId);
      })
      .catch(function () {
        composerStatus('');
        postBtn.textContent = 'Failed — try again';
        setTimeout(function () { postBtn.textContent = 'Post'; }, 3000);
      })
      .finally(function () {
        postBtn.disabled  = false;
        textarea.disabled = false;
        if (camBtn) camBtn.disabled = false;
        syncPostButton();
      });
  }

  // Deleting a note takes its photos with it — they only exist as part of it.
  function deleteComment(safeId, key, itemEl) {
    var note = findNote(safeId, key);
    if (note && !isMine(note)) return;   // not yours to delete
    var photoCount = note ? note.photos.length : 0;
    if (photoCount && !confirm(
      'Delete this note and its ' + photoCount + ' photo' + (photoCount === 1 ? '' : 's') + '?')) return;

    itemEl.style.opacity = '0.4';
    itemEl.style.pointerEvents = 'none';
    authedFetch(FB_COMMENTS + '/' + safeId + '/' + key + '.json', { method: 'DELETE' })
      .then(function (r) {
        if (!r.ok) throw new Error('delete failed');
        unindexNote(safeId, key);
        refreshActivityCounts(safeId);
        var listEl  = document.getElementById('rc-cm-list');
        var emptyEl = document.getElementById('rc-cm-empty');
        itemEl.remove();
        if (listEl && emptyEl && listEl.querySelectorAll('.rc-cm-item').length === 0) {
          emptyEl.style.display = '';
        }
        // Best-effort: an orphaned photo is invisible, so failures don't matter.
        (note ? note.photos : []).forEach(function (pk) {
          deletePhotoFromGallery(safeId, pk).catch(function () {});
        });
        refreshHeroCount(safeId);
      })
      .catch(function () {
        itemEl.style.opacity = '';
        itemEl.style.pointerEvents = '';
      });
  }

  // ── Composer photo tray ─────────────────────────────────────────────────
  var composerPhotos = [];   // [{thumb, full}] staged but not yet posted

  function composerStatus(msg) {
    var el = document.getElementById('rc-cm-status');
    if (el) el.textContent = msg || '';
  }

  function syncPostButton() {
    var textarea = document.getElementById('rc-cm-textarea');
    var postBtn  = document.getElementById('rc-cm-post');
    if (!textarea || !postBtn) return;
    postBtn.disabled = !textarea.value.trim() && !composerPhotos.length;
  }

  function clearComposerPhotos() {
    composerPhotos = [];
    renderComposerTray();
  }

  function renderComposerTray() {
    var tray = document.getElementById('rc-cm-tray');
    if (!tray) return;
    tray.innerHTML = '';
    tray.classList.toggle('on', composerPhotos.length > 0);
    composerPhotos.forEach(function (p, i) {
      var cell = document.createElement('div');
      cell.className = 'rc-cm-tray-item';
      cell.innerHTML = '<img src="' + escAttr(p.thumb) + '" alt="">' +
                       '<button class="rc-cm-tray-x" type="button" aria-label="Remove photo">✕</button>';
      cell.querySelector('.rc-cm-tray-x').addEventListener('click', function () {
        composerPhotos.splice(i, 1);
        renderComposerTray();
        syncPostButton();
      });
      tray.appendChild(cell);
    });
    syncPostButton();
  }

  // Compress every picked file, then stage it. Phone photos are 3–5 MB each, so
  // this can take a moment — hence the status line.
  function stagePickedFiles(files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return Promise.resolve();
    composerStatus('Preparing ' + list.length + ' photo' + (list.length === 1 ? '' : 's') + '…');
    return list.reduce(function (chain, file) {
      return chain.then(function () {
        return prepareCookPhoto(file).then(function (photo) {
          if (photo) composerPhotos.push(photo);
        });
      });
    }, Promise.resolve()).then(function () {
      composerStatus('');
      renderComposerTray();
    });
  }

  // ── Activity on cards ───────────────────────────────────────────────────
  // Cards themselves carry no photo/note counters — the row is narrow and the
  // recipe name needs the room. The counts still show where there's space for
  // them: inside the recipe, and in the timeline's activity block below a card.

  // Called whenever a recipe's notes or photos change, so any Journal block for
  // the same recipe repaints — the Journal has no composer of its own any more,
  // so a note posted from the detail view on top of it has to land in the block
  // underneath.
  function refreshActivityCounts(safeId) {
    document.querySelectorAll('.rc-act-block[data-act-block-id="' + escAttr(safeId) + '"]')
      .forEach(function (el) { if (typeof el._repaint === 'function') el._repaint(); });
  }

  // Cards are rendered synchronously right after init(), but the activity index
  // arrives a moment later — so every block keeps a repaint hook we call once
  // the data lands.
  function refreshAllActivityBlocks() {
    document.querySelectorAll('.rc-act-block').forEach(function (el) {
      if (typeof el._repaint === 'function') el._repaint();
    });
  }

  // ── Journal activity block ──────────────────────────────────────────────
  // The expanded half of a Journal card: that week's notes for one meal, each
  // with its own photos. Read-only — notes are written from the recipe detail
  // view, which stamps them with this card's week.
  function makeActivity(recipe, weekOf) {
    var safeId = fbSafeKey(idOf(recipe));
    var wrap = document.createElement('div');
    wrap.className = 'rc-act-block';
    wrap.setAttribute('data-act-block-id', safeId);
    if (weekOf) wrap.setAttribute('data-act-week', weekOf);

    var body = document.createElement('div');
    body.className = 'rc-act-body';
    wrap.appendChild(body);

    function paintBody() {
      var notes = notesFor(safeId, weekOf);
      body.innerHTML = '';
      body.classList.toggle('on', notes.length > 0);
      // The block is nothing but a left border when it's empty, so hide it
      // whole rather than leaving a stray rule beside a meal nobody logged.
      wrap.style.display = notes.length ? '' : 'none';
      if (!notes.length) return;

      // Each note reads as who and when, what they wrote, then their photos.
      notes.forEach(function (n) {
        var row = document.createElement('div');
        row.className = 'rc-act-note';
        row.innerHTML =
          '<div class="rc-act-note-who">' + escHtml(n.author) + ' · ' +
            escHtml(new Date(n.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })) + '</div>' +
          (n.text ? '<div class="rc-act-note-text">' + escHtml(n.text) + '</div>' : '');
        var photos = renderNotePhotos(safeId, n, recipe, { weekOf: weekOf, lazy: true });
        if (photos) row.appendChild(photos);
        body.appendChild(row);
      });
    }

    wrap._repaint = paintBody;
    paintBody();
    return wrap;
  }

  // ── Cooking mode logic ──────────────────────────────────────────────────
  function initCookingMode() {
    var ck        = document.getElementById('rc-ck-overlay');
    var track     = document.getElementById('rc-ck-track');
    var ingScroll = document.getElementById('rc-ck-ing-scroll');
    var ingHead   = document.getElementById('rc-ck-ing-headline');
    var ingsList  = document.getElementById('rc-ck-ings');
    var stepVp    = document.getElementById('rc-ck-step-vp');
    var dotsEl    = document.getElementById('rc-ck-dots');
    var prevBtn   = document.getElementById('rc-ck-prev');
    var nextBtn   = document.getElementById('rc-ck-next');
    var closeX    = document.getElementById('rc-ck-x');
    var titleEl   = document.getElementById('rc-ck-title');
    var pip0      = document.getElementById('rc-ck-pip0');
    var pip1      = document.getElementById('rc-ck-pip1');
    var hintIng   = document.getElementById('rc-ck-hint-ing');
    var hintSteps = document.getElementById('rc-ck-hint-steps');

    var recipe = null, stepIdx = 0, isSteps = false;
    var slides = [], dots = [], wakeLock = null;
    var ingHid = false, stpHid = false;

    function lockOn() {
      if ('wakeLock' in navigator) {
        navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }).catch(function () {});
      }
    }
    function lockOff() {
      if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
    }
    document.addEventListener('visibilitychange', function () {
      if (ck.classList.contains('open') && document.visibilityState === 'visible') lockOn();
    });

    function buildIngs(r) {
      ingHead.textContent = r.name;
      titleEl.textContent = r.name;
      ingsList.innerHTML  = ingRowsHTML(r.ings || r.ingredients || []);
      ingScroll.scrollTop = 0;
    }

    function buildSteps(r) {
      slides.forEach(function (s) { s.remove(); });
      slides = []; dots = []; dotsEl.innerHTML = '';
      stepVp.removeChild(hintSteps);
      (r.steps || []).forEach(function (text, i) {
        var sl = document.createElement('div');
        sl.className = 'rc-ck-slide' + (i === 0 ? ' active' : '');
        sl.innerHTML = '<div class="rc-ck-step-big">' + String(i + 1).padStart(2, '0') + '</div>' +
                       '<div class="rc-ck-step-of">of ' + r.steps.length + '</div>' +
                       '<div class="rc-ck-step-body">' + escHtml(text) + '</div>';
        stepVp.appendChild(sl);
        slides.push(sl);
        var d = document.createElement('div');
        d.className = 'rc-ck-dot' + (i === 0 ? ' on' : '');
        dotsEl.appendChild(d);
        dots.push(d);
      });
      stepVp.appendChild(hintSteps);
      stepIdx = 0;
      refreshNav();
    }

    function goStep(n) {
      if (!recipe || n < 0 || n >= recipe.steps.length || n === stepIdx) return;
      var fwd  = n > stepIdx;
      var from = slides[stepIdx];
      var to   = slides[n];
      from.classList.remove('active');
      from.classList.add(fwd ? 'exit-up' : 'exit-down');
      to.style.transition = 'none'; to.style.opacity = '0';
      to.style.transform  = fwd ? 'translateY(48px)' : 'translateY(-48px)';
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          to.style.transition = ''; to.style.opacity = ''; to.style.transform = '';
          to.classList.add('active');
        });
      });
      setTimeout(function () { from.classList.remove('exit-up', 'exit-down'); }, 320);
      dots[stepIdx].classList.remove('on');
      dots[stepIdx].classList.toggle('done', fwd);
      dots[n].classList.remove('done');
      dots[n].classList.add('on');
      stepIdx = n;
      refreshNav();
      hideStepHint();
    }

    function refreshNav() {
      prevBtn.disabled = stepIdx === 0;
      nextBtn.disabled = !recipe || stepIdx === recipe.steps.length - 1;
    }

    function showPanel(p) {
      isSteps = p === 'steps';
      track.classList.toggle('flipped', isSteps);
      pip0.classList.toggle('on', !isSteps);
      pip1.classList.toggle('on',  isSteps);
      if (isSteps) hideIngHint();
    }

    function hideIngHint()  { if (!ingHid)  { ingHid  = true; hintIng.classList.add('gone'); } }
    function hideStepHint() { if (!stpHid)  { stpHid  = true; hintSteps.classList.add('gone'); } }

    // Touch swipe
    var t0 = null;
    ck.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      t0 = { x: t.clientX, y: t.clientY, ms: Date.now() };
    }, { passive: true });
    ck.addEventListener('touchend', function (e) {
      if (!t0) return;
      var t = e.changedTouches[0], dx = t.clientX - t0.x, dy = t.clientY - t0.y, ms = Date.now() - t0.ms;
      t0 = null;
      var D = 44;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < D || ms > 700) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        if (dx < -D && !isSteps) showPanel('steps');
        if (dx >  D &&  isSteps) showPanel('ingredients');
      } else if (isSteps) {
        if (dy < -D) goStep(stepIdx + 1);
        if (dy >  D) goStep(stepIdx - 1);
      }
    }, { passive: true });

    // Keyboard
    document.addEventListener('keydown', function (e) {
      if (!ck.classList.contains('open')) return;
      if (isSteps) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') goStep(stepIdx + 1);
        if (e.key === 'ArrowUp'   || e.key === 'ArrowLeft')  goStep(stepIdx - 1);
      } else {
        if (e.key === 'ArrowRight') showPanel('steps');
      }
    });

    // Public openMode / closeMode
    global.RecipeCard.openMode = function (r) {
      recipe = r;
      buildIngs(r); buildSteps(r);
      showPanel('ingredients');
      ingHid = stpHid = false;
      hintIng.classList.remove('gone');
      hintSteps.classList.remove('gone');
      ck.classList.add('open');
      ck.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      lockOn();
    };

    global.RecipeCard.closeMode = function () {
      ck.classList.remove('open');
      ck.setAttribute('aria-hidden', 'true');
      lockOff();
      if (!rdEl || !rdEl.classList.contains('open')) document.body.style.overflow = '';
    };

    closeX.addEventListener('click', global.RecipeCard.closeMode);
    prevBtn.addEventListener('click', function () { goStep(stepIdx - 1); });
    nextBtn.addEventListener('click', function () { goStep(stepIdx + 1); });
    document.getElementById('rc-rd-cook').addEventListener('click', function () {
      if (curR) global.RecipeCard.openMode(curR);
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────
  global.RecipeCard = {
    /**
     * init(options)
     * options.coreIds      — object of id→true for recipes already in the collection
     * options.onSaveChange — fn(id, isSaved, recipeObj) called after save toggle
     * options.onReady      — fn() called after saved state + edits loaded from Firebase
     * options.weekOf       — default week to stamp notes and photos with. Pages
     *                        showing a specific week pass it; the Recipes page
     *                        omits it, so notes there stay off the Journal.
     */
    init: function (options) {
      options = options || {};
      coreIds          = options.coreIds      || {};
      _onSaveChange    = options.onSaveChange || null;
      currentUserEmail = options.userEmail    || null;
      defaultWeekOf    = options.weekOf       || '';

      injectSharedUI();
      rdEl = document.getElementById('rc-rd-overlay');

      // Wire static buttons
      document.getElementById('rc-rd-back').addEventListener('click', closeDetail);
      document.getElementById('rc-rd-backdrop').addEventListener('click', closeDetail);
      document.getElementById('rc-rd-more').addEventListener('click', function (e) {
        e.stopPropagation();
        var m = document.getElementById('rc-rd-more-menu');
        if (m.classList.contains('open')) closeMoreMenu(); else openMoreMenu();
      });
      document.getElementById('rc-rd-menu-edit').addEventListener('click', function () {
        closeMoreMenu(); enterEditMode();
      });
      // Tap anywhere else closes the ⋯ menu
      document.addEventListener('click', function (e) {
        var menu = document.getElementById('rc-rd-more-menu');
        if (menu && menu.classList.contains('open') && !e.target.closest('.rc-rd-more-wrap')) closeMoreMenu();
      });
      document.getElementById('rc-rd-cancel').addEventListener('click', function () {
        if (inAddMode) closeDetail(); else exitEditMode();
      });
      document.getElementById('rc-rd-save-edit').addEventListener('click', function () {
        if (inAddMode) saveNewRecipe(); else saveRecipeEdit();
      });
      document.getElementById('rc-cm-post').addEventListener('click', function () {
        if (currentRecipeId) submitComment(currentRecipeId);
      });
      document.getElementById('rc-cm-textarea').addEventListener('keydown', function (e) {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          if (currentRecipeId) submitComment(currentRecipeId);
        }
      });
      document.getElementById('rc-cm-textarea').addEventListener('input', syncPostButton);

      // Composer camera → native "Take Photo / Photo Library" sheet on iOS
      var cmFile = document.getElementById('rc-cm-file');
      document.getElementById('rc-cm-camera').addEventListener('click', function () {
        cmFile.value = '';                    // allow re-picking the same shot
        cmFile.click();
      });
      cmFile.addEventListener('change', function () {
        stagePickedFiles(cmFile.files);
      });

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          var ck = document.getElementById('rc-ck-overlay');
          var find = document.getElementById('rc-find');
          var menu = document.getElementById('rc-photo-menu');
          var galMenu = document.getElementById('rc-gal-menu');
          if (galMenu && galMenu.classList.contains('open')) { closeGalMenu(); }
          else if (galOpen()) { closeGallery(); }
          else if (find && find.classList.contains('open')) { closeFind(); }
          else if (menu && menu.classList.contains('open')) { closePhotoMenu(); }
          else if (ck && ck.classList.contains('open')) { global.RecipeCard.closeMode && global.RecipeCard.closeMode(); }
          else if (inEditMode) { exitEditMode(); }
          else if (rdEl && rdEl.classList.contains('open')) { closeDetail(); }
        }
      });

      initCookingMode();
      initHeroPhoto();
      initGallery();
      syncPostButton();

      var pending = 4;
      function onLoaded() { if (--pending === 0 && options.onReady) options.onReady(); }
      loadSavedState(onLoaded);
      loadRecipeEdits(onLoaded);
      // Any tag Kyle added by hand, so it lands in the right family everywhere
      // before onReady builds the Recipes filter panel.
      loadTagVocab(onLoaded);
      // One request for every note on the site: cheap, because the image bytes
      // live under /recipe-photos, not here.
      loadActivityIndex(function () {
        refreshAllActivityBlocks();
        onLoaded();
      });
    },

    /**
     * makeCard(recipe, labelOverride, metaOverride, weekOf)
     * Returns a DOM element for a meal card. Click opens detail overlay.
     * The eyebrow shows the recipe's first two tags unless `labelOverride` is
     * given. `metaOverride` replaces the bottom line (used to prefix the day).
     * `weekOf` stamps notes added from this card to a specific week — the
     * Journal passes each week's own value so a note added months later still
     * files under the right week. Omit it to use the page default.
     * A placeholder meal (see isCustom) renders inert: no chevron, no click.
     */
    makeCard: function (r, labelOverride, metaOverride, weekOf) {
      var id     = idOf(r);
      var safeId = fbSafeKey(id);
      var plain  = isCustom(r);
      var fixed  = labelOverride !== undefined && labelOverride !== null;
      var lbl    = fixed ? labelOverride : (plain ? 'One-off' : tagsFor(r).slice(0, 2).join(' · '));
      var meta   = metaOverride !== undefined && metaOverride !== null ? metaOverride : (r.meta || '');
      var div = document.createElement('div');
      div.className = 'rc-card' + (plain ? ' rc-card-plain' : '');
      div.setAttribute('data-recipe-id', id);
      if (fixed) div.setAttribute('data-label-fixed', '');
      if (weekOf) div.setAttribute('data-week-of', weekOf);
      div.innerHTML =
        '<div class="rc-card-inner">' +
          '<div class="rc-card-body">' +
            '<div class="rc-card-label">' + escHtml(lbl) + '</div>' +
            '<div class="rc-card-name">' + escHtml(r.name) + '</div>' +
            '<div class="rc-card-meta">' + escHtml(meta) + '</div>' +
          '</div>' +
          '<div class="rc-card-right">' +
            (plain ? '' :
              '<span class="rc-saved-badge" data-id="' + escAttr(id) + '">' +
                '<svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>' +
                'Saved' +
              '</span>' +
              '<span class="rc-chevron">›</span>') +
          '</div>' +
        '</div>';
      var inner = div.querySelector('.rc-card-inner');
      inner.insertBefore(makeThumb(r), inner.firstChild);
      // There's nothing to open on a placeholder — leave it unclickable.
      if (!plain) div.addEventListener('click', function () { openDetail(r, weekOf); });
      return div;
    },

    /**
     * makeActivity(recipe, weekOf)
     * The Journal's expanded card half: that week's notes for one meal, each
     * with its own photos. Read-only, and hidden entirely when there are no
     * notes. Returns a DOM element.
     */
    makeActivity: makeActivity,

    /** Open the photo gallery for a recipe. opts: {safeId, startKey, weekOf} */
    openGallery: openGallery,

    /** Apply saved badges to all rc-saved-badge elements in the DOM */
    applyBadges: function () {
      document.querySelectorAll('.rc-saved-badge').forEach(function (b) {
        var id = b.dataset.id;
        b.classList.toggle('visible', !isCore(id) && isSaved(id));
      });
    },

    /** Load saved recipe data from Firebase (for "From Your Journal" section in recipes.html) */
    loadSavedRecipes: function (callback) {
      authedFetch(FB_DATA)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data) { callback([]); return; }
          var saved = Object.values(data).filter(function (r) { return r && r.name; });
          callback(saved);
        })
        .catch(function () { callback([]); });
    },

    /**
     * Register the core recipes so weekly meals (which carry no tags of their
     * own) can resolve theirs by recipe id. Call before rendering cards.
     */
    setTagIndex: function (recipes) {
      (recipes || []).forEach(function (r) {
        if (r && r.tags && r.tags.length) tagIndex[idOf(r)] = sortTags(r.tags);
      });
    },

    /**
     * Retarget the week that notes and photos get stamped with when the detail
     * sheet is opened without an explicit weekOf. init() sets this once, but a
     * page that navigates between weeks has to move it.
     * Pass the STORED week key, never the canonical Sunday.
     */
    setWeekOf: function (weekOf) { defaultWeekOf = weekOf || ''; },

    /**
     * Repaint everything that init() otherwise only paints once: saved badges,
     * recipe edits, activity counts and activity blocks. Call after appending
     * cards that weren't in the DOM when the shared data loaded — which is
     * every lazily-loaded week in the timeline.
     */
    refresh: function () {
      document.querySelectorAll('.rc-saved-badge').forEach(function (b) {
        var id = b.dataset.id;
        b.classList.toggle('visible', !isCore(id) && isSaved(id));
      });
      applyEditsToCards();
      refreshAllActivityBlocks();
    },

    /** Notes for a recipe, optionally narrowed to one week. Read-only. */
    notesFor: notesFor,

    openDetail: openDetail,
    closeDetail: closeDetail,
    openAddForm: openAddForm,
    idOf: idOf,
    isCustom: isCustom,
    makeThumb: makeThumb,
    isSaved: isSaved,
    isCore: isCore,
    tagsFor: tagsFor,
    sortTags: sortTags,
    familyOf: familyOf,
    TAG_FAMILIES: TAG_FAMILIES
  };

})(window);

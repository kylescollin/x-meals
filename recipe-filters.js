/* recipe-filters.js — the filter sheet shared by the Recipes and Explore tabs.
 *
 * One engine, two pages. A page hands it an ordered list of GROUPS and a way
 * to look up each recipe's FACET; the sheet draws itself (markup and styles
 * are injected here, like grocery-sheet.js), keeps the selection, paints the
 * "how many would this give me" count on every chip, and tells the page when
 * something changed so it can re-render.
 *
 *   facet   { id, tags, minutes, methods, proteins, ...anything the page adds }
 *           facetFor(recipe, tags, id) builds the common part from a recipe's
 *           `tags`, its free-text `meta` ("40 min · Stovetop · Serves 4") and
 *           its ingredients. Pure.
 *   group   { key, title, values(facet) → [labels], fixed?: [labels],
 *             defaults?: [labels] }
 *           fixed    the chips to show even when nothing has that value
 *           defaults the chips picked when the page opens and after Clear all.
 *                    A group sitting on its defaults counts as no filter, so
 *                    Explore's "Dinners" doesn't light the button up.
 *
 * Within a group picks are OR; across groups AND; and the page's own search
 * box is AND-ed on top through textMatch(). Selections are not persisted — a
 * filter that silently survives a reload is confusing on a phone.
 *
 * The parsing and matching are pure and require()-able from scripts/, so
 * scripts/test-recipe-filters.js covers them. Must load after recipe-card.js
 * (for familyOf) and ingredient-format.js.
 */
(function (root) {
  'use strict';

  var IngFormat = root.IngFormat ||
    (typeof require === 'function' ? require('./ingredient-format.js') : null);

  // ── Facet parsing ──────────────────────────────────────────────────────────
  // Dish type and cuisine come from each recipe's `tags`. Time and equipment
  // are still free text ("40 min · Stovetop · Serves 4"), so those are read
  // out of the string, and the protein out of the ingredients — no second
  // place to maintain. Anything unparseable just drops out of that group.

  function segments(str) {
    return (str || '').split('·').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  // "6 hrs 15 min" → 375 · "~1 hour" → 60 · "2–3 hrs" → 180 (upper bound, so
  // "30 min or less" never over-promises) · "~45 min (marinate tonight!)" → 45
  function parseMinutes(str) {
    var s = segments(str)[0] || '';
    s = s.replace(/\(.*?\)/g, '').replace(/~/g, '').trim().toLowerCase();
    if (!s) return null;
    var range = s.match(/(\d+)\s*[–—-]\s*(\d+)\s*(hrs?|hours?|min)/);
    if (range) {
      var n = parseInt(range[2], 10);
      return range[3].indexOf('h') === 0 ? n * 60 : n;
    }
    var total = 0, found = false;
    var h = s.match(/(\d+)\s*(hrs?|hours?)/);
    if (h) { total += parseInt(h[1], 10) * 60; found = true; }
    var m = s.match(/(\d+)\s*min/);
    if (m) { total += parseInt(m[1], 10); found = true; }
    return found ? total : null;
  }

  var METHOD_NAMES = {
    'stovetop': 'Stovetop', 'oven': 'Oven', 'sheet pan': 'Sheet pan', 'one pan': 'One pan',
    'slow cooker': 'Slow cooker', 'air fryer': 'Air fryer', 'instant pot': 'Instant Pot', 'grill': 'Grill'
  };
  function isServes(seg) { return /^serves/i.test(seg || ''); }
  function methodParts(seg) {
    // "Oven or Air Fryer" counts as both
    return seg.split(/\s+or\s+/i).map(function (p) { return p.trim(); }).filter(Boolean);
  }

  // The method is normally the second segment ("30 min · Oven · Serves 4").
  // A card with no time puts it first ("Oven · Serves 12" — common on blog
  // recipes), so when the first segment isn't a time and every part of it
  // names a known method, that's the one. An unfamiliar word after a time is
  // still kept as a method, as it always was.
  function parseMethods(meta) {
    var segs = segments(meta);
    if (!segs.length) return [];
    var seg;
    if (parseMinutes(meta) !== null) {
      seg = segs[1];
      if (!seg || isServes(seg)) return [];
      return methodParts(seg).map(function (p) { return METHOD_NAMES[p.toLowerCase()] || p; });
    }
    seg = segs[0];
    if (isServes(seg)) return [];
    var parts = methodParts(seg);
    var known = parts.map(function (p) { return METHOD_NAMES[p.toLowerCase()]; });
    return known.every(Boolean) ? known : [];
  }

  // Broth and sauces would otherwise make every soup read as chicken or fish.
  var PROTEIN_NOISE = /broth|stock|bouillon|fish sauce|worcestershire|better than/i;
  var PROTEIN_RULES = [
    ['Chicken',        /chicken|rotisserie/],
    ['Beef',           /\bbeef|steak|sirloin|ground chuck|chuck roast/],
    ['Pork & sausage', /\bpork|bacon|sausage|chorizo|prosciutto|pancetta|\bham\b/],
    ['Seafood',        /shrimp|salmon|\bcod\b|tuna|scallop|tilapia|halibut|crab|\bfish\b/],
    ['Turkey',         /turkey/]
  ];
  function parseProteins(name, ings) {
    var text = (ings || []).filter(function (line) { return !PROTEIN_NOISE.test(line); })
      .concat([name || '']).join(' ').toLowerCase();
    var found = PROTEIN_RULES.filter(function (rule) { return rule[1].test(text); })
      .map(function (rule) { return rule[0]; });
    if (found.length) return found;
    // A generic "1 lb ground meat" line means we don't know — but it isn't meatless.
    return /\bmeat\b|\bmeatballs?\b/.test(text) ? [] : ['Meatless'];
  }

  // The common facet. `tags` lets the Recipes page pass RecipeCard.tagsFor(r),
  // which knows the tags of a journal copy; `id` likewise defaults to r.id.
  function facetFor(r, tags, id) {
    // Section headers are labels, not ingredients — they shouldn't count as
    // evidence of a protein.
    var raw = r.ings || r.ingredients || [];
    var ings = IngFormat ? IngFormat.stripSections(raw) : raw;
    return {
      id:       id || r.id,
      tags:     tags || r.tags || [],
      minutes:  parseMinutes(r.meta),
      methods:  parseMethods(r.meta),
      proteins: parseProteins(r.name, ings)
    };
  }

  // ── Stock groups ───────────────────────────────────────────────────────────
  // tag → family comes from recipe-card.js (which also knows the tags Kyle
  // has typed in). Under Node, a test sets RecipeFilters.familyOf.
  function famOf(tag) {
    var f = (root.RecipeCard && root.RecipeCard.familyOf) || API.familyOf;
    return f ? f(tag) : 'custom';
  }
  function tagsInFamily(facet, family) {
    return (facet.tags || []).filter(function (t) { return famOf(t) === family; });
  }

  // 30 min is by far the most common time in the collection, so it anchors
  // the first bucket rather than splitting it.
  var TIME_BUCKETS = [
    { label: '30 min or less', test: function (m) { return m <= 30; } },
    { label: '30–60 min',      test: function (m) { return m > 30 && m <= 60; } },
    { label: 'Over 1 hour',    test: function (m) { return m > 60; } }
  ];
  // Nights cooked in the last six months. Buckets rather than a free count so
  // the chips stay few. The Recipes page builds its group from these.
  var COOKED_BUCKETS = [
    { label: 'Never',    test: function (n) { return n === 0; } },
    { label: 'Once',     test: function (n) { return n === 1; } },
    { label: 'Twice',    test: function (n) { return n === 2; } },
    { label: '3 times',  test: function (n) { return n === 3; } },
    { label: '4+ times', test: function (n) { return n >= 4; } }
  ];
  function bucketLabels(buckets, n) {
    return buckets.filter(function (b) { return b.test(n); }).map(function (b) { return b.label; });
  }

  var groups = {
    dish:    { key: 'dish',    title: 'Type of dish', values: function (f) { return tagsInFamily(f, 'dish'); } },
    cuisine: { key: 'cuisine', title: 'Cuisine',      values: function (f) { return tagsInFamily(f, 'cuisine'); } },
    origin:  { key: 'origin',  title: 'Found via',    values: function (f) { return tagsInFamily(f, 'origin'); } },
    custom:  { key: 'custom',  title: 'Your tags',    values: function (f) { return tagsInFamily(f, 'custom'); } },
    time:    { key: 'time',    title: 'Total time',
      fixed: TIME_BUCKETS.map(function (b) { return b.label; }),
      values: function (f) {
        if (f.minutes === null || f.minutes === undefined) return [];
        return bucketLabels(TIME_BUCKETS, f.minutes);
      } },
    method:  { key: 'method',  title: 'How it cooks', values: function (f) { return f.methods || []; } },
    protein: { key: 'protein', title: 'Main protein', values: function (f) { return f.proteins || []; } }
  };

  // ── Selection + matching (pure) ────────────────────────────────────────────
  function emptySelection(gs) {
    var s = {};
    gs.forEach(function (g) {
      s[g.key] = {};
      (g.defaults || []).forEach(function (d) { s[g.key][d] = true; });
    });
    return s;
  }
  function picks(selected, key) { return Object.keys(selected[key] || {}); }

  function atDefaults(g, selected) {
    var p = picks(selected, g.key).slice().sort();
    var d = (g.defaults || []).slice().sort();
    return JSON.stringify(p) === JSON.stringify(d);
  }

  // How many filters are "on": picks, except a group sitting on its defaults.
  // A group moved OFF its defaults with nothing picked (Dinners un-ticked to
  // see everything) still counts as one, so the button shows the view isn't
  // the usual one.
  function activeCount(gs, selected) {
    return gs.reduce(function (n, g) {
      if (!g.defaults) return n + picks(selected, g.key).length;
      if (atDefaults(g, selected)) return n;
      return n + Math.max(1, picks(selected, g.key).length);
    }, 0);
  }

  // Does this facet pass? `skipGroup` lets a chip's count show what that
  // option would yield without counting its own group twice.
  function matches(gs, selected, facet, skipGroup) {
    if (!facet) return activeCount(gs, selected) === 0;
    return gs.every(function (g) {
      if (g.key === skipGroup) return true;
      var p = picks(selected, g.key);
      if (!p.length) return true;
      var vals = g.values(facet) || [];
      return p.some(function (x) { return vals.indexOf(x) !== -1; });
    });
  }

  // ── The sheet ──────────────────────────────────────────────────────────────
  var CSS =
    '.filt-btn{position:relative;flex-shrink:0;width:46px;height:46px;display:flex;align-items:center;justify-content:center;background:#fff;border:1.5px solid var(--border);border-radius:10px;color:var(--ink);cursor:pointer;-webkit-tap-highlight-color:transparent;transition:border-color .15s,background .15s,transform .12s;}' +
    '.filt-btn:hover{border-color:#bbb;}' +
    '.filt-btn:active{transform:scale(.94);}' +
    '.filt-btn svg{width:19px;height:19px;stroke:currentColor;stroke-width:1.9;fill:none;stroke-linecap:round;}' +
    '.filt-btn.active{background:var(--accent);border-color:var(--accent);color:#fff;}' +
    '.filt-count{position:absolute;top:-6px;right:-6px;min-width:19px;height:19px;padding:0 5px;border-radius:99px;background:var(--accent);color:#fff;font-size:11px;font-weight:600;line-height:19px;text-align:center;border:2px solid var(--cream);}' +
    '.filt-btn:not(.active) .filt-count{display:none;}' +
    '.filt-btn.active .filt-count{background:var(--ink);}' +
    /* The sheet itself mirrors the bottom sheets on index.html. */
    '.filt-ov{position:fixed;inset:0;z-index:1200;background:rgba(20,18,15,.4);opacity:0;visibility:hidden;transition:opacity .25s;}' +
    '.filt-ov.open{opacity:1;visibility:visible;}' +
    '.filt-sheet{position:absolute;left:0;right:0;bottom:0;background:var(--cream);border-radius:18px 18px 0 0;max-height:85vh;display:flex;flex-direction:column;transform:translateY(100%);transition:transform .32s cubic-bezier(.4,0,.2,1);padding-bottom:env(safe-area-inset-bottom,0px);}' +
    '.filt-ov.open .filt-sheet{transform:translateY(0);}' +
    '.filt-grab{width:38px;height:4px;border-radius:2px;background:var(--border);margin:10px auto 4px;}' +
    '.filt-head{display:flex;align-items:center;justify-content:space-between;padding:8px 18px 12px;border-bottom:1px solid var(--border);}' +
    '.filt-title{font-family:"Playfair Display",serif;font-size:18px;font-weight:600;}' +
    '.filt-close{width:32px;height:32px;border-radius:50%;background:#fff;border:1px solid var(--border);color:var(--ink);font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;}' +
    '.filt-close:active{background:#eee;}' +
    '.filt-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:18px 18px 22px;}' +
    '.filt-group{margin-bottom:22px;}' +
    '.filt-group:last-child{margin-bottom:0;}' +
    '.filt-group-label{font-size:10px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:10px;}' +
    '.filt-chips{display:flex;flex-wrap:wrap;gap:8px;}' +
    '.filt-chip{background:#fff;border:1.5px solid var(--border);border-radius:100px;color:var(--ink);font-family:"DM Sans",sans-serif;font-size:13px;font-weight:400;padding:8px 14px;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:border-color .15s,background .15s,transform .12s;}' +
    '.filt-chip:active{transform:scale(.95);}' +
    '.filt-chip .filt-n{color:var(--muted);font-size:11px;margin-left:5px;}' +
    '.filt-chip.selected{border-color:var(--accent);background:var(--accent-light);font-weight:500;}' +
    '.filt-chip.selected .filt-n{color:var(--accent);}' +
    '.filt-chip.empty{opacity:.4;}' +
    '.filt-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 18px;border-top:1px solid var(--border);background:var(--cream);}' +
    '.filt-clear{background:none;border:none;color:var(--muted);font-family:"DM Sans",sans-serif;font-size:13px;font-weight:400;padding:8px 4px;cursor:pointer;-webkit-tap-highlight-color:transparent;}' +
    '.filt-clear:active{color:var(--ink);}' +
    '.filt-apply{background:var(--accent);color:#fff;border:none;border-radius:100px;font-family:"DM Sans",sans-serif;font-size:14px;font-weight:500;padding:11px 22px;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s,background .15s;}' +
    '.filt-apply:active{transform:scale(.96);background:#b3581f;}';

  var BUTTON_HTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18M6 12h12M10 19h4"/></svg>' +
    '<span class="filt-count">0</span>';

  function injectStyles() {
    if (document.getElementById('rf-style')) return;
    var st = document.createElement('style');
    st.id = 'rf-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* attach(opts) — wire the sheet to a page.
   *   button     the .filt-btn element (its icon and badge are filled in here)
   *   title      "Filter recipes"
   *   groups     ordered group list
   *   ids()      every id currently on the page
   *   facet(id)  that id's facet (undefined → shown only when no filter is on)
   *   textMatch(id)  the page's search-box test, so counts respect it
   *   noun       ['recipe', 'recipes'] for the apply button
   *   onChange() the selection moved — re-render
   *   onOpen()   optional, may return a promise; runs before the sheet opens
   *              (Explore loads every month here so the counts are complete)
   */
  function attach(opts) {
    var gs = opts.groups.slice();
    var selected = emptySelection(gs);
    var noun = opts.noun || ['recipe', 'recipes'];
    var textMatch = opts.textMatch || function () { return true; };

    injectStyles();
    var btn = opts.button;
    if (btn && !btn.innerHTML.trim()) btn.innerHTML = BUTTON_HTML;
    var badge = btn ? btn.querySelector('.filt-count') : null;

    var ov = document.createElement('div');
    ov.className = 'filt-ov';
    ov.innerHTML =
      '<div class="filt-sheet">' +
        '<div class="filt-grab"></div>' +
        '<div class="filt-head"><div class="filt-title">' + escHtml(opts.title || 'Filter recipes') + '</div>' +
          '<button type="button" class="filt-close" aria-label="Close">✕</button></div>' +
        '<div class="filt-body"></div>' +
        '<div class="filt-foot"><button type="button" class="filt-clear">Clear all</button>' +
          '<button type="button" class="filt-apply">Show recipes</button></div>' +
      '</div>';
    document.body.appendChild(ov);
    var body  = ov.querySelector('.filt-body');
    var apply = ov.querySelector('.filt-apply');

    function groupOf(key) { return gs.filter(function (g) { return g.key === key; })[0]; }
    function matchId(id, skipGroup) { return matches(gs, selected, opts.facet(id), skipGroup); }
    function count() { return activeCount(gs, selected); }

    // Build the sheet from whatever is loaded, so new options show up on their own.
    function rebuild() {
      var ids = opts.ids();
      body.innerHTML = '';
      gs.forEach(function (g) {
        var options = g.fixed ? g.fixed.slice() : [];
        if (!g.fixed) {
          ids.forEach(function (id) {
            var f = opts.facet(id);
            if (!f) return;
            (g.values(f) || []).forEach(function (v) {
              if (v && options.indexOf(v) === -1) options.push(v);
            });
          });
          options.sort();
        }
        // Drop stale picks for options that no longer exist
        picks(selected, g.key).forEach(function (p) {
          if (options.indexOf(p) === -1) delete selected[g.key][p];
        });
        if (!options.length) return;

        var wrap = document.createElement('div');
        wrap.className = 'filt-group';
        wrap.innerHTML = '<div class="filt-group-label"></div><div class="filt-chips"></div>';
        wrap.querySelector('.filt-group-label').textContent = g.title;
        var chips = wrap.querySelector('.filt-chips');
        options.forEach(function (opt) {
          var chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'filt-chip';
          chip.setAttribute('data-group', g.key);
          chip.setAttribute('data-value', opt);
          chip.innerHTML = '<span class="filt-chip-t"></span><span class="filt-n"></span>';
          chip.querySelector('.filt-chip-t').textContent = opt;
          chip.addEventListener('click', function () {
            if (selected[g.key][opt]) delete selected[g.key][opt];
            else selected[g.key][opt] = true;
            changed();
          });
          chips.appendChild(chip);
        });
        body.appendChild(wrap);
      });
      refresh();
    }

    // Selected states, the per-chip counts, the badge and the apply label.
    function refresh() {
      var ids = opts.ids();
      var visible = ids.filter(function (id) { return textMatch(id) && matchId(id); }).length;
      body.querySelectorAll('.filt-chip[data-group]').forEach(function (chip) {
        var key = chip.getAttribute('data-group');
        var value = chip.getAttribute('data-value');
        var isOn = !!selected[key][value];
        var g = groupOf(key);
        var n = ids.filter(function (id) {
          var f = opts.facet(id);
          return f && textMatch(id) && matchId(id, key) && (g.values(f) || []).indexOf(value) !== -1;
        }).length;
        chip.classList.toggle('selected', isOn);
        chip.classList.toggle('empty', n === 0 && !isOn);
        chip.querySelector('.filt-n').textContent = n;
      });
      var n = count();
      if (btn) btn.classList.toggle('active', n > 0);
      if (badge) badge.textContent = n;
      apply.textContent = 'Show ' + visible + ' ' + (visible === 1 ? noun[0] : noun[1]);
    }

    function changed() {
      if (opts.onChange) opts.onChange();
      refresh();
    }

    function open() {
      Promise.resolve(opts.onOpen ? opts.onOpen() : null).then(function () {
        rebuild();
        ov.classList.add('open');
      });
    }
    function close() { ov.classList.remove('open'); }
    function clear() {
      selected = emptySelection(gs);
      changed();
    }

    if (btn) btn.addEventListener('click', open);
    ov.querySelector('.filt-close').addEventListener('click', close);
    apply.addEventListener('click', close);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('.filt-clear').addEventListener('click', clear);

    return {
      matches: matchId,
      activeCount: count,
      rebuild: rebuild,
      refresh: refresh,
      open: open,
      close: close,
      clear: clear,
      get selected() { return selected; }
    };
  }

  var API = {
    parseMinutes: parseMinutes,
    parseMethods: parseMethods,
    parseProteins: parseProteins,
    facetFor: facetFor,
    TIME_BUCKETS: TIME_BUCKETS,
    COOKED_BUCKETS: COOKED_BUCKETS,
    bucketLabels: bucketLabels,
    groups: groups,
    emptySelection: emptySelection,
    activeCount: activeCount,
    matches: matches,
    attach: attach,
    familyOf: null   // set under Node when RecipeCard isn't loaded
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.RecipeFilters = API;
})(typeof self !== 'undefined' ? self : this);

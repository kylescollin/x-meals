/* Fox & Bear Kitchen — the grocery list, as a sheet.

   This used to be groceries.html, a page you navigated to. It's now a card that
   slides up over whatever week you're looking at, so checking the list never
   costs you your place. The engine underneath is the same one that page ran:
   the same section rendering, the same Firebase check-state sync, the same
   hand-added items.

   Self-contained in the recipe-card.js style — it injects its own styles and
   its own markup, so a page only has to load it and point it at a week:

     GrocerySheet.setWeek(weekKey, weekData)   // which week's list is this?
     GrocerySheet.open() / .close()
     GrocerySheet.onProgress(fn)               // {checked,total} on every change

   Two things that must not drift:
   - Check state is keyed by WeekStore.groceryKey(<rendered item name>), which
     is deliberately shared with scripts/lib/week-merge.js. Never reimplement it
     here — renaming an item's key silently un-ticks something already in the
     trolley.
   - The week it reads and writes is the STORED weekOf, not the canonical
     Sunday. Callers pass the key; this file never does week math.
*/
(function (global) {
  'use strict';

  var FB_BASE = 'https://fox-bear-hub-default-rtdb.firebaseio.com';
  var POLL_INTERVAL = 8000;

  var fbUrl = null;          // /groceries/<weekKey>
  var weekKey = null;
  var sections = [];         // the generated list for this week
  var hasMeals = false;
  var lastKnownState = {};   // whole Firebase node: flags + _custom
  var pollTimer = null;
  var progressFn = null;
  var root = null, ovEl = null, sectionsEl = null, emptyEl = null;

  function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  // Everything is scoped under #gs-sheet: this now lives on a page that has its
  // own .section and .item elements, and neither should touch the other.
  // The sheet's own chrome (.sheet-ov, .sheet, .sheet-head, .sheet-close) comes
  // from index.html, so this card slides up exactly like the recipe picker.
  var CSS = [
    '#gs-sheet .gs-progress{padding:12px 18px 14px;border-bottom:1px solid var(--border);}',
    '#gs-sheet .gs-track{background:var(--border);border-radius:99px;height:6px;overflow:hidden;margin-bottom:6px;}',
    '#gs-sheet .gs-fill{height:100%;background:var(--check);border-radius:99px;width:0;transition:width .3s ease;}',
    '#gs-sheet .gs-label{font-size:12px;color:var(--muted);}',
    '#gs-sheet .gs-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px 18px calc(24px + env(safe-area-inset-bottom,0px));}',
    '#gs-sheet .gs-reset{background:transparent;border:1px solid var(--border);color:var(--muted);font-family:\'DM Sans\',sans-serif;font-size:12px;font-weight:500;border-radius:100px;padding:6px 14px;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:border-color .15s,color .15s;}',
    '#gs-sheet .gs-reset:hover{border-color:#bbb;color:var(--ink);}',
    '#gs-sheet .gs-head-right{display:flex;align-items:center;gap:8px;}',
    '#gs-sheet .empty-note{text-align:center;padding:34px 18px;color:var(--muted);font-size:13px;border:1.5px dashed var(--border);border-radius:14px;}',
    /* ── list (moved verbatim from groceries.html) ── */
    '#gs-sheet .section{margin-bottom:20px;}',
    '#gs-sheet .section-header{display:flex;align-items:center;gap:8px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border);}',
    '#gs-sheet .section-label{font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);}',
    '#gs-sheet .item{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid var(--border);border-radius:8px;padding:11px 14px;margin-bottom:6px;cursor:pointer;transition:background .12s,border-color .12s;}',
    '#gs-sheet .item:hover{border-color:#ccc;}',
    '#gs-sheet .item.checked{background:var(--check-light);border-color:#b8dfc9;}',
    '#gs-sheet .cb{width:20px;height:20px;border-radius:5px;border:2px solid var(--border);background:#fff;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .15s;}',
    '#gs-sheet .item.checked .cb{background:var(--check);border-color:var(--check);}',
    '#gs-sheet .cb-check{display:none;color:#fff;font-size:12px;font-weight:700;}',
    '#gs-sheet .item.checked .cb-check{display:block;}',
    '#gs-sheet .item-body{flex:1;min-width:0;}',
    '#gs-sheet .item-name{font-size:14px;font-weight:500;}',
    '#gs-sheet .item.checked .item-name{text-decoration:line-through;color:var(--muted);}',
    '#gs-sheet .item-detail{font-size:12px;color:var(--muted);margin-top:1px;}',
    '#gs-sheet .item.checked .item-detail{color:#b0a898;}',
    '#gs-sheet .item-right{display:flex;align-items:center;gap:6px;flex-shrink:0;}',
    '#gs-sheet .tag{font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;white-space:nowrap;}',
    '#gs-sheet .tag-chili{background:#fdecea;color:#9b2a2a;}',
    '#gs-sheet .tag-cauliflower{background:#e8f5e9;color:#2e7d32;}',
    '#gs-sheet .tag-pasta{background:#f3e8fb;color:#6b2a9e;}',
    '#gs-sheet .tag-d{background:#fff1e0;color:#9a5a00;}',
    '#gs-sheet .tag-e{background:#e0f2f1;color:#00695c;}',
    '#gs-sheet .tag-f{background:#fce4ec;color:#ad1457;}',
    '#gs-sheet .tag-g{background:#ede7f6;color:#4527a0;}',
    '#gs-sheet .tag-shared{background:#e8f2fe;color:#2563a8;}',
    '#gs-sheet .tag-all{background:#f0ecd8;color:#7a6020;}',
    '#gs-sheet .amz-btn{font-size:11px;font-weight:600;color:#fff;background:#FF9900;border:none;border-radius:5px;padding:3px 8px;cursor:pointer;white-space:nowrap;text-decoration:none;display:inline-block;}',
    '#gs-sheet .amz-btn:hover{background:#e88b00;}',
    '#gs-sheet .rm-btn{font-size:15px;line-height:1;font-weight:500;color:var(--muted);background:transparent;border:none;border-radius:5px;width:24px;height:24px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .12s,color .12s;}',
    '#gs-sheet .rm-btn:hover{background:#f3e3df;color:var(--accent);}',
    '#gs-sheet .add-bar{display:flex;gap:8px;margin-bottom:22px;}',
    /* 16px minimum — anything smaller makes iOS zoom the page in on focus. */
    '#gs-sheet .add-input{flex:1;min-width:0;font-family:\'DM Sans\',sans-serif;font-size:16px;color:var(--ink);background:#fff;border:1px solid var(--border);border-radius:8px;padding:11px 14px;outline:none;transition:border-color .12s;}',
    '#gs-sheet .add-input:focus{border-color:var(--accent);}',
    '#gs-sheet .add-input::placeholder{color:#b0a898;}',
    '#gs-sheet .add-btn{font-family:\'DM Sans\',sans-serif;font-size:14px;font-weight:600;color:#fff;background:var(--accent);border:none;border-radius:8px;padding:0 18px;cursor:pointer;white-space:nowrap;transition:background .12s;}',
    '#gs-sheet .add-btn:hover{background:#b0531f;}',
    '#gs-sheet .note-box{background:var(--accent-light);border-left:3px solid var(--accent);border-radius:0 6px 6px 0;padding:10px 14px;font-size:13px;color:#7a4820;margin-bottom:18px;}'
  ].join('');

  var MARKUP =
    '<div class="sheet" id="gs-sheet">' +
      '<div class="sheet-grab"></div>' +
      '<div class="sheet-head">' +
        '<span class="sheet-title">Grocery List</span>' +
        '<div class="gs-head-right">' +
          '<button type="button" class="gs-reset" id="gs-reset">Reset all</button>' +
          '<button type="button" class="sheet-close" id="gs-close" aria-label="Close">&#10005;</button>' +
        '</div>' +
      '</div>' +
      '<div class="gs-progress">' +
        '<div class="gs-track"><div class="gs-fill" id="gs-fill"></div></div>' +
        '<div class="gs-label" id="gs-label">0 of 0 items checked</div>' +
      '</div>' +
      '<div class="gs-body">' +
        '<div class="add-bar">' +
          '<input class="add-input" id="gs-add-input" type="text" placeholder="Add an item…" ' +
                 'autocomplete="off" enterkeyhint="done">' +
          '<button type="button" class="add-btn" id="gs-add-btn">Add</button>' +
        '</div>' +
        '<div id="gs-sections"></div>' +
        '<div class="empty-note" id="gs-empty" style="display:none"></div>' +
      '</div>' +
    '</div>';

  // ── Firebase ──────────────────────────────────────────────────────────────
  // The rendered name IS the key. See WeekStore.groceryKey.
  function keyOf(el) {
    return global.WeekStore.groceryKey(el.querySelector('.item-name').textContent);
  }

  async function syncToFB(k, v) {
    if (!fbUrl) return;
    var token = await global.getToken();
    fetch(fbUrl + '/' + k + '.json?auth=' + token, {
      method: 'PUT', body: JSON.stringify(v)
    }).catch(function () {});
  }

  async function readFB() {
    if (!fbUrl) return null;
    var token = await global.getToken();
    try {
      var r = await fetch(fbUrl + '.json?auth=' + token);
      return await r.json();
    } catch (_) { return null; }
  }

  // ── Progress ──────────────────────────────────────────────────────────────
  function counts() {
    if (!root) return { checked: 0, total: 0 };
    return {
      checked: root.querySelectorAll('.item.checked').length,
      total: root.querySelectorAll('.item').length
    };
  }

  function updateProgress() {
    var c = counts();
    document.getElementById('gs-fill').style.width = c.total ? (c.checked / c.total * 100) + '%' : '0%';
    document.getElementById('gs-label').textContent = c.checked + ' of ' + c.total + ' items checked';
    if (progressFn) progressFn(c);
  }

  function applyState(d) {
    if (!d || !root) return;
    root.querySelectorAll('.item').forEach(function (el) {
      var on = d[keyOf(el)] === true;
      el.classList.toggle('checked', on);
    });
    updateProgress();
  }

  function toggle(el) {
    el.classList.toggle('checked');
    var k = keyOf(el), on = el.classList.contains('checked');
    lastKnownState[k] = on;
    syncToFB(k, on);
    updateProgress();
  }

  function resetAll() {
    root.querySelectorAll('.item.checked').forEach(function (el) {
      el.classList.remove('checked');
      var k = keyOf(el);
      lastKnownState[k] = false;
      syncToFB(k, false);
    });
    updateProgress();
  }

  // ── Rendering the generated list ──────────────────────────────────────────
  function amzBtn(term) {
    return '<a class="amz-btn" href="https://www.amazon.com/s?k=' +
      encodeURIComponent(term).replace(/%20/g, '+') +
      '&amp;i=amazonfresh" target="_blank" rel="noopener">Fresh</a>';
  }

  function renderItem(item) {
    return '<div class="item"><div class="cb"><span class="cb-check">&#x2713;</span></div>' +
      '<div class="item-body"><div class="item-name">' + esc(item.name) + '</div>' +
      (item.detail ? '<div class="item-detail">' + esc(item.detail) + '</div>' : '') + '</div>' +
      '<div class="item-right"><span class="tag ' + esc(item.tagClass) + '">' + esc(item.tag) + '</span>' +
      (item.amazon ? amzBtn(item.amazon) : '') + '</div></div>';
  }

  function renderSection(sec) {
    var html = '<div class="section" data-section="' + esc(keyForLabel(sec.label)) + '">' +
      '<div class="section-header"><span>' + sec.icon + '</span>' +
      '<span class="section-label">' + esc(sec.label) + '</span></div>';
    if (sec.note) html += '<div class="note-box">' + esc(sec.note) + '</div>';
    (sec.items || []).forEach(function (item) { html += renderItem(item); });
    return html + '</div>';
  }

  // ── Custom (user-added) grocery items ─────────────────────────────────────
  // Canonical sections, in display order. Matches CLAUDE.md.
  var SECTIONS = [
    { key: 'produce', icon: '🥦', label: 'Produce' },
    { key: 'protein', icon: '🥩', label: 'Protein' },
    { key: 'dairy',   icon: '🧈', label: 'Dairy & Refrigerated' },
    { key: 'pantry',  icon: '🫙', label: 'Pantry & Canned' },
    { key: 'spices',  icon: '🌿', label: 'Spices' }
  ];

  function keyForLabel(label) {
    var l = (label || '').toLowerCase();
    if (l.indexOf('produce') > -1) return 'produce';
    if (l.indexOf('protein') > -1) return 'protein';
    if (l.indexOf('dairy') > -1 || l.indexOf('refrigerat') > -1) return 'dairy';
    if (l.indexOf('spice') > -1) return 'spices';
    return 'pantry';
  }

  // Keyword → section. Order matters: earlier, more specific phrases win.
  var CLASSIFY = [
    ['spices', ['black pepper','peppercorn','ground pepper','white pepper','cayenne','chili powder','chilli powder','garlic powder','onion powder','cumin','paprika','cinnamon','oregano','thyme','rosemary','turmeric','coriander','nutmeg','bay leaf','seasoning','spice','salt']],
    ['protein',['chicken','beef','pork','turkey','salmon','tuna','shrimp','prawn','tofu','tempeh','bacon','sausage','steak','ground ','mince','lamb','cod','tilapia','meatball','hot dog','deli','ham ','meat']],
    ['dairy',  ['milk','cheese','yogurt','yoghurt','butter','heavy cream','sour cream','half-and-half','half and half','cream cheese','kefir','egg']],
    ['produce',['bell pepper','jalapeno','jalapeño','lettuce','spinach','kale','arugula','cucumber','tomato','onion','garlic','shallot','scallion','green onion','carrot','celery','broccoli','cauliflower','potato','sweet potato','avocado','lemon','lime','orange','apple','banana','grape','berry','berries','strawberr','blueberr','mushroom','zucchini','squash','cilantro','parsley','basil','mint','ginger','cabbage','corn','pepper','fruit','vegetable','veggie','greens','herb']],
    ['pantry', ['rice','pasta','noodle','bean','lentil','chickpea','canned','can of','sauce','olive oil','oil','vinegar','flour','sugar','broth','stock','soy sauce','bread','tortilla','cereal','oat','peanut butter','almond butter','honey','maple','chip','cracker','coconut milk','tomato paste','salsa','ketchup','mustard','mayo','jam','jelly','snack','water','coffee','tea','wine','soda','paper towel','napkin','foil','wrap','bag','soap','detergent']]
  ];

  function classify(name) {
    var n = ' ' + (name || '').toLowerCase() + ' ';
    for (var i = 0; i < CLASSIFY.length; i++) {
      var sect = CLASSIFY[i][0], words = CLASSIFY[i][1];
      for (var j = 0; j < words.length; j++) { if (n.indexOf(words[j]) > -1) return sect; }
    }
    return 'pantry';
  }

  function getOrCreateSection(key) {
    var existing = sectionsEl.querySelector('.section[data-section="' + key + '"]');
    if (existing) return existing;
    var meta = null;
    for (var i = 0; i < SECTIONS.length; i++) { if (SECTIONS[i].key === key) { meta = SECTIONS[i]; break; } }
    if (!meta) meta = SECTIONS[3];
    var sec = document.createElement('div');
    sec.className = 'section';
    sec.setAttribute('data-section', key);
    sec.setAttribute('data-custom-section', '1');
    sec.innerHTML = '<div class="section-header"><span>' + meta.icon + '</span>' +
      '<span class="section-label">' + esc(meta.label) + '</span></div>';
    // Insert in canonical order relative to other sections already on the page.
    var order = SECTIONS.map(function (s) { return s.key; });
    var myIdx = order.indexOf(key);
    var secs = sectionsEl.querySelectorAll('.section');
    var before = null;
    for (var k = 0; k < secs.length; k++) {
      if (order.indexOf(secs[k].getAttribute('data-section')) > myIdx) { before = secs[k]; break; }
    }
    sectionsEl.insertBefore(sec, before);
    return sec;
  }

  function renderCustom(map) {
    map = map || {};
    sectionsEl.querySelectorAll('.item.custom').forEach(function (el) { el.remove(); });
    // Render in insertion order (ids are timestamp-prefixed, so sort keeps them stable).
    Object.keys(map).sort().forEach(function (id) {
      var it = map[id];
      if (!it || !it.name) return;
      var sec = getOrCreateSection(it.section || 'pantry');
      var row = document.createElement('div');
      row.className = 'item custom';
      row.setAttribute('data-id', id);
      row.innerHTML = '<div class="cb"><span class="cb-check">&#x2713;</span></div>' +
        '<div class="item-body"><div class="item-name">' + esc(it.name) + '</div></div>' +
        '<div class="item-right">' + amzBtn(it.name) +
        '<button type="button" class="rm-btn" title="Remove">&times;</button></div>';
      sec.appendChild(row);
    });
    // Remove any dynamically-created sections left empty after a removal.
    sectionsEl.querySelectorAll('.section[data-custom-section]').forEach(function (sec) {
      if (!sec.querySelector('.item')) sec.remove();
    });
    syncEmptyNote();
    applyState(lastKnownState);
  }

  function newId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function addCustom() {
    var input = document.getElementById('gs-add-input');
    var name = (input.value || '').trim();
    if (!name) return;
    var id = newId();
    if (!lastKnownState._custom) lastKnownState._custom = {};
    lastKnownState._custom[id] = { name: name, section: classify(name) };
    input.value = '';
    renderCustom(lastKnownState._custom);
    syncToFB('_custom/' + id, lastKnownState._custom[id]);
    input.focus();
  }

  function removeCustom(id) {
    var it = lastKnownState._custom && lastKnownState._custom[id];
    if (it) {
      var k = global.WeekStore.groceryKey(it.name);
      delete lastKnownState._custom[id];
      delete lastKnownState[k];
      syncToFB('_custom/' + id, null);
      syncToFB(k, null);
    }
    renderCustom(lastKnownState._custom || {});
  }

  // ── Which week ────────────────────────────────────────────────────────────
  function syncEmptyNote() {
    // Only speak up when there is genuinely nothing to look at — a week with a
    // couple of hand-added items isn't empty.
    var any = sectionsEl.querySelector('.item');
    emptyEl.style.display = any ? 'none' : '';
    if (!any) {
      emptyEl.textContent = hasMeals
        ? 'No list for this week yet — it builds itself a minute or so after the meals are saved.'
        : 'Nothing planned for this week yet. Add anything you need below.';
    }
  }

  function setWeek(key, weekData) {
    weekKey = key;
    fbUrl = FB_BASE + '/groceries/' + key;
    sections = (weekData && weekData.groceries) || [];
    hasMeals = !!(weekData && (weekData.meals || []).length);
    lastKnownState = {};

    var html = '';
    sections.forEach(function (sec) { html += renderSection(sec); });
    sectionsEl.innerHTML = html;
    renderCustom({});
    updateProgress();

    // One read now, so the dock has a real count without the sheet ever being
    // opened. The 8s poll only runs while the sheet is up — see open().
    var forKey = key;
    readFB().then(function (d) {
      if (forKey !== weekKey) return;     // navigated away mid-flight
      lastKnownState = d || {};
      renderCustom(lastKnownState._custom || {});
    });
  }

  function poll() {
    var forKey = weekKey;
    readFB().then(function (d) {
      if (!d || forKey !== weekKey) return;
      if (JSON.stringify(d) === JSON.stringify(lastKnownState)) return;
      lastKnownState = d;
      renderCustom(d._custom || {});
    });
  }

  // ── Open / close ──────────────────────────────────────────────────────────
  function isOpen() { return ovEl.classList.contains('open'); }

  function open() {
    if (isOpen()) return;
    ovEl.classList.add('open');
    ovEl.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    poll();
    pollTimer = setInterval(poll, POLL_INTERVAL);
  }

  function close() {
    if (!isOpen()) return;
    ovEl.classList.remove('open');
    ovEl.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    clearInterval(pollTimer);
    pollTimer = null;
  }

  // ── Mount ─────────────────────────────────────────────────────────────────
  function mount() {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    ovEl = document.createElement('div');
    ovEl.className = 'sheet-ov';
    ovEl.id = 'grocery-overlay';
    ovEl.setAttribute('aria-hidden', 'true');
    ovEl.innerHTML = MARKUP;
    document.body.appendChild(ovEl);

    root = document.getElementById('gs-sheet');
    sectionsEl = document.getElementById('gs-sections');
    emptyEl = document.getElementById('gs-empty');

    document.getElementById('gs-close').addEventListener('click', close);
    document.getElementById('gs-reset').addEventListener('click', resetAll);
    document.getElementById('gs-add-btn').addEventListener('click', addCustom);
    document.getElementById('gs-add-input').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); addCustom(); }
    });
    ovEl.addEventListener('click', function (ev) { if (ev.target === ovEl) close(); });

    // One delegated handler rather than inline onclick= on every row: the rows
    // are rebuilt on every poll, and this page has its own module scope.
    sectionsEl.addEventListener('click', function (ev) {
      var rm = ev.target.closest('.rm-btn');
      if (rm) {
        ev.stopPropagation();
        var row = rm.closest('.item.custom');
        if (row) removeCustom(row.getAttribute('data-id'));
        return;
      }
      if (ev.target.closest('.amz-btn')) return;   // let the link through
      var item = ev.target.closest('.item');
      if (item) toggle(item);
    });

    // recipe-card.js has its own Escape cascade on document, registered first.
    // Nothing of its can be open over this sheet, so it no-ops and we close.
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && isOpen()) close();
    });
  }

  // Mounted straight away, like recipe-card.js — the script tag sits at the end
  // of <body>, so the document is there to append to and the page can call
  // setWeek() the moment it has a week.
  mount();

  global.GrocerySheet = {
    setWeek: setWeek,
    open: open,
    close: close,
    isOpen: isOpen,
    progress: counts,
    onProgress: function (fn) { progressFn = fn; }
  };
})(window);

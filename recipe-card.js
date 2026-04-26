/**
 * Fox & Bear Kitchen — Shared Recipe Card Component
 * Provides: meal card rendering, recipe detail overlay, cooking mode, save/unsave
 * Used by: index.html, recipes.html, journal.html
 */

(function (global) {
  'use strict';

  // ── Firebase ────────────────────────────────────────────────────────────
  var FB_BASE = 'https://fox-bear-hub-default-rtdb.firebaseio.com';
  var FB_FLAGS = FB_BASE + '/saved-recipes.json';
  var FB_DATA  = FB_BASE + '/saved-recipe-data.json';

  var savedIds = {};    // id → true/false
  var coreIds  = {};    // id → true (already in recipes.html RECIPES array)
  var _onSaveChange = null; // optional callback(id, isSaved)

  function fbSafeKey(id) {
    return id.replace(/[.#$[\]]/g, '_');
  }

  function authedFetch(url, options) {
    var getToken = window.getToken;
    if (!getToken) return fetch(url, options);
    return getToken().then(function(token) {
      return fetch(url + '?auth=' + token, options);
    });
  }

  // Load saved flags from Firebase; call callback when ready
  function loadSavedState(callback) {
    authedFetch(FB_FLAGS)
      .then(function (r) { return r.json(); })
      .then(function (d) { savedIds = d || {}; if (callback) callback(); })
      .catch(function () { if (callback) callback(); });
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

  // ── Ingredient parser (shared) ──────────────────────────────────────────
  function parseIng(s) {
    var m = s.match(/^((?:[\d\u00bd\u2153\u2154\u00bc\u00be\s\/]+)\s*(?:cup|cups|tbsp|tsp|lb|lbs|oz|g|kg|ml|l|clove|cloves|medium|large|small|head|can|bunch|pinch|dash)?s?\.?)\s+([\s\S]+)/i);
    return m ? { qty: m[1].trim(), name: m[2].trim() } : { qty: '\u2014', name: s };
  }

  // ── Inject shared HTML + CSS ────────────────────────────────────────────
  function injectSharedUI() {
    // CSS
    var style = document.createElement('style');
    style.textContent = [
      // Meal cards
      '.rc-card{background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;cursor:pointer;transition:border-color .15s,box-shadow .15s;-webkit-tap-highlight-color:transparent;}',
      '.rc-card:hover{border-color:#bbb;box-shadow:0 2px 8px rgba(0,0,0,.06);}',
      '.rc-card-inner{display:flex;align-items:center;gap:14px;padding:14px 16px;user-select:none;}',
      '.rc-card-icon{font-size:26px;flex-shrink:0;}',
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
      '#rc-rd-overlay{position:fixed;inset:0;background:var(--cream);z-index:1000;display:flex;flex-direction:column;transform:translateY(100%);transition:transform .38s cubic-bezier(.4,0,.2,1);overflow:hidden;}',
      '#rc-rd-overlay.open{transform:translateY(0);}',
      '.rc-rd-bar{display:flex;align-items:center;gap:10px;padding:calc(16px + env(safe-area-inset-top,0px)) 16px 14px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--cream);}',
      '.rc-rd-back{flex-shrink:0;width:36px;height:36px;border-radius:50%;background:white;border:1px solid var(--border);color:var(--ink);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;transition:background .15s;}',
      '.rc-rd-back:active{background:#eee;}',
      '.rc-rd-name{flex:1;font-family:"Playfair Display",serif;font-size:17px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.rc-rd-save-btn{flex-shrink:0;display:inline-flex;align-items:center;gap:6px;background:white;color:var(--muted);border:1px solid var(--border);border-radius:100px;font-family:"DM Sans",sans-serif;font-size:12px;font-weight:500;padding:8px 14px;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:all .15s;}',
      '.rc-rd-save-btn svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2;transition:all .15s;}',
      '.rc-rd-save-btn.saved{background:var(--accent-light);color:var(--accent);border-color:#e0bfad;}',
      '.rc-rd-save-btn.saved svg{fill:var(--accent);stroke:var(--accent);}',
      '.rc-rd-save-btn:active{transform:scale(.94);}',
      '.rc-rd-in-recipes{flex-shrink:0;display:none;align-items:center;gap:5px;font-size:11px;font-weight:500;color:var(--muted);padding:8px 12px;}',
      '.rc-rd-in-recipes.visible{display:inline-flex;}',
      '.rc-rd-in-recipes svg{width:11px;height:11px;fill:var(--muted);flex-shrink:0;}',
      '.rc-rd-cook-btn{flex-shrink:0;display:inline-flex;align-items:center;gap:6px;background:var(--ink);color:var(--cream);border:none;border-radius:100px;font-family:"DM Sans",sans-serif;font-size:12px;font-weight:500;padding:9px 16px;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s,background .15s;}',
      '.rc-rd-cook-btn:active{transform:scale(.94);background:#333;}',
      '.rc-rd-cook-btn svg{width:11px;height:11px;fill:currentColor;}',
      '.rc-rd-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:28px 20px calc(48px + env(safe-area-inset-bottom,0px));}',
      '.rc-rd-inner{max-width:640px;margin:0 auto;}',
      '.rc-rd-note{margin-bottom:20px;padding:11px 14px;background:var(--accent-light);border-radius:8px;font-size:13px;color:#7a4520;line-height:1.5;}',
      '.rc-rd-cols{display:grid;grid-template-columns:1fr 1.4fr;gap:28px;}',
      '@media(max-width:520px){.rc-rd-cols{grid-template-columns:1fr;}}',
      '.rc-rd-section-title{font-size:10px;letter-spacing:2px;text-transform:uppercase;font-weight:500;color:var(--accent);margin-bottom:12px;}',
      '.rc-rd-ing-list{list-style:none;display:flex;flex-direction:column;gap:5px;}',
      '.rc-rd-ing-list li{font-size:13px;color:var(--ink);line-height:1.45;padding-left:12px;position:relative;}',
      '.rc-rd-ing-list li::before{content:"·";position:absolute;left:0;color:var(--muted);}',
      '.rc-rd-step-list{list-style:none;display:flex;flex-direction:column;gap:10px;}',
      '.rc-rd-step-list li{font-size:13px;color:var(--ink);line-height:1.55;display:flex;gap:10px;}',
      '.rc-rd-step-num{font-family:"Playfair Display",serif;font-size:14px;font-weight:700;color:var(--accent);flex-shrink:0;min-width:16px;padding-top:1px;}',

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
      '<div id="rc-rd-overlay" aria-hidden="true">',
        '<div class="rc-rd-bar">',
          '<button class="rc-rd-back" id="rc-rd-back">\u2190</button>',
          '<span class="rc-rd-name" id="rc-rd-name"></span>',
          '<button class="rc-rd-save-btn" id="rc-rd-save" aria-label="Save to recipes">',
            '<svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
            '<span id="rc-rd-save-label">Save</span>',
          '</button>',
          '<span class="rc-rd-in-recipes" id="rc-rd-in-recipes">',
            '<svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
            'In your recipes',
          '</span>',
          '<button class="rc-rd-cook-btn" id="rc-rd-cook">',
            '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>Cook',
          '</button>',
        '</div>',
        '<div class="rc-rd-body">',
          '<div class="rc-rd-inner">',
            '<div class="rc-rd-note" id="rc-rd-note" style="display:none"></div>',
            '<div class="rc-rd-cols">',
              '<div><div class="rc-rd-section-title">Ingredients</div><ul class="rc-rd-ing-list" id="rc-rd-ings"></ul></div>',
              '<div><div class="rc-rd-section-title">Directions</div><ol class="rc-rd-step-list" id="rc-rd-steps"></ol></div>',
            '</div>',
          '</div>',
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
          '<button class="rc-ck-x" id="rc-ck-x">\u2715</button>',
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
                '<button class="rc-ck-nav" id="rc-ck-prev">\u2191</button>',
                '<div class="rc-ck-dots" id="rc-ck-dots"></div>',
                '<button class="rc-ck-nav" id="rc-ck-next">\u2193</button>',
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
  var curR  = null;
  var rdEl  = null;

  function refreshSaveUI(id) {
    var saveBtn      = document.getElementById('rc-rd-save');
    var inRecipesEl  = document.getElementById('rc-rd-in-recipes');
    var labelEl      = document.getElementById('rc-rd-save-label');
    if (!saveBtn || !inRecipesEl || !labelEl) return;
    if (isCore(id)) {
      saveBtn.style.display = 'none';
      inRecipesEl.classList.add('visible');
    } else {
      saveBtn.style.display = '';
      inRecipesEl.classList.remove('visible');
      var saved = isSaved(id);
      saveBtn.classList.toggle('saved', saved);
      labelEl.textContent = saved ? 'Saved' : 'Save';
      saveBtn.setAttribute('aria-label', saved ? 'Remove from recipes' : 'Save to recipes');
    }
  }

  function openDetail(r) {
    curR = r;
    var id = r.id || r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    document.getElementById('rc-rd-name').textContent = r.name;
    document.getElementById('rc-rd-ings').innerHTML  = (r.ings  || []).map(function (i) { return '<li>' + i + '</li>'; }).join('');
    document.getElementById('rc-rd-steps').innerHTML = (r.steps || []).map(function (s, n) {
      return '<li><span class="rc-rd-step-num">' + (n + 1) + '</span><span>' + s + '</span></li>';
    }).join('');
    var noteEl = document.getElementById('rc-rd-note');
    if (r.note) { noteEl.textContent = r.note; noteEl.style.display = ''; }
    else         { noteEl.style.display = 'none'; }
    document.querySelector('.rc-rd-body').scrollTop = 0;

    // Wire save button to this recipe
    var saveBtn = document.getElementById('rc-rd-save');
    saveBtn.onclick = function () { toggleSave(id, r); };
    refreshSaveUI(id);

    rdEl.classList.add('open');
    rdEl.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeDetail() {
    rdEl.classList.remove('open');
    rdEl.setAttribute('aria-hidden', 'true');
    var ckEl = document.getElementById('rc-ck-overlay');
    if (!ckEl || !ckEl.classList.contains('open')) document.body.style.overflow = '';
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
      ingsList.innerHTML  = (r.ings || []).map(function (i) {
        var p = parseIng(i);
        return '<li class="rc-ck-ing-row"><span class="rc-ck-qty">' + p.qty + '</span><span class="rc-ck-item-name">' + p.name + '</span></li>';
      }).join('');
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
                       '<div class="rc-ck-step-body">' + text + '</div>';
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
     * options.onReady      — fn() called after saved state loaded from Firebase
     */
    init: function (options) {
      options = options || {};
      coreIds        = options.coreIds      || {};
      _onSaveChange  = options.onSaveChange || null;

      injectSharedUI();
      rdEl = document.getElementById('rc-rd-overlay');

      // Wire static buttons
      document.getElementById('rc-rd-back').addEventListener('click', closeDetail);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          var ck = document.getElementById('rc-ck-overlay');
          if (ck && ck.classList.contains('open')) { global.RecipeCard.closeMode && global.RecipeCard.closeMode(); }
          else if (rdEl && rdEl.classList.contains('open')) { closeDetail(); }
        }
      });

      initCookingMode();
      loadSavedState(function () {
        if (options.onReady) options.onReady();
      });
    },

    /**
     * makeCard(recipe, labelOverride)
     * Returns a DOM element for a meal card. Click opens detail overlay.
     */
    makeCard: function (r, labelOverride) {
      var id  = r.id || r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      var lbl = labelOverride !== undefined ? labelOverride : (r.label || '');
      var div = document.createElement('div');
      div.className = 'rc-card';
      div.innerHTML =
        '<div class="rc-card-inner">' +
          '<div class="rc-card-icon">' + (r.icon || '\ud83c\udf7d') + '</div>' +
          '<div class="rc-card-body">' +
            '<div class="rc-card-label">' + lbl + '</div>' +
            '<div class="rc-card-name">' + r.name + '</div>' +
            '<div class="rc-card-meta">' + (r.meta || '') + '</div>' +
          '</div>' +
          '<div class="rc-card-right">' +
            '<span class="rc-saved-badge" data-id="' + id + '">' +
              '<svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>' +
              'Saved' +
            '</span>' +
            '<span class="rc-chevron">\u203a</span>' +
          '</div>' +
        '</div>';
      div.addEventListener('click', function () { openDetail(r); });
      return div;
    },

    /** Apply saved badges to all rc-saved-badge elements in the DOM */
    applyBadges: function () {
      document.querySelectorAll('.rc-saved-badge').forEach(function (b) {
        var id = b.dataset.id;
        b.classList.toggle('visible', !isCore(id) && isSaved(id));
      });
    },

    /** Load saved recipe data from Firebase (for "From Your Journal" section in recipes.html) */
    loadSavedRecipes: function (callback) {
      fetch(FB_DATA)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data) { callback([]); return; }
          var saved = Object.values(data).filter(function (r) { return r && r.name; });
          callback(saved);
        })
        .catch(function () { callback([]); });
    },

    openDetail: openDetail,
    closeDetail: closeDetail,
    isSaved: isSaved,
    isCore: isCore
  };

})(window);

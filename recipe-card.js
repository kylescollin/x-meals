/**
 * Fox & Bear Kitchen — Shared Recipe Card Component
 * Provides: meal card rendering, recipe detail overlay, cooking mode, save/unsave, edit
 * Used by: index.html, recipes.html, journal.html
 */

(function (global) {
  'use strict';

  // ── Firebase ────────────────────────────────────────────────────────────
  var FB_BASE  = 'https://fox-bear-hub-default-rtdb.firebaseio.com';
  var REPO     = 'kylescollin/x-meals';   // for committing new recipes to git
  var FB_FLAGS = FB_BASE + '/saved-recipes.json';
  var FB_DATA  = FB_BASE + '/saved-recipe-data.json';
  var FB_EDITS    = FB_BASE + '/recipe-edits';
  var FB_COMMENTS = FB_BASE + '/recipe-comments';

  var AUTHOR_MAP = { 'kscollin@gmail.com': 'Kyle', 'missjosephinefox@gmail.com': 'Josephine' };

  var savedIds         = {};    // id → true/false
  var coreIds          = {};    // id → true (already in recipes.html RECIPES array)
  var recipeEdits      = {};    // safeId → edited recipe object
  var _onSaveChange    = null;  // optional callback(id, isSaved)
  var currentUserEmail = null;  // set in init() via options.userEmail
  var currentRecipeId  = null;  // safe key of the open recipe, for comment ops

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

  // Load recipe edits from Firebase; call callback when ready
  function loadRecipeEdits(callback) {
    authedFetch(FB_EDITS + '.json')
      .then(function (r) { return r.json(); })
      .then(function (d) { recipeEdits = d || {}; applyEditsToCards(); if (callback) callback(); })
      .catch(function () { if (callback) callback(); });
  }

  // Update any rendered card names/meta to reflect saved edits
  function applyEditsToCards() {
    Object.keys(recipeEdits).forEach(function (safeId) {
      var edit = recipeEdits[safeId];
      if (!edit || !edit.id) return;
      var card = document.querySelector('.rc-card[data-recipe-id="' + edit.id + '"]');
      if (!card) return;
      var nameEl = card.querySelector('.rc-card-name');
      var metaEl = card.querySelector('.rc-card-meta');
      if (nameEl && edit.name) nameEl.textContent = edit.name;
      if (metaEl && edit.meta !== undefined) metaEl.textContent = edit.meta;
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

  // ── Ingredient parser (shared) ──────────────────────────────────────────
  function parseIng(s) {
    var m = s.match(/^((?:[\d½⅓⅔¼¾\s\/]+)\s*(?:cup|cups|tbsp|tsp|lb|lbs|oz|g|kg|ml|l|clove|cloves|medium|large|small|head|can|bunch|pinch|dash)?s?\.?)\s+([\s\S]+)/i);
    return m ? { qty: m[1].trim(), name: m[2].trim() } : { qty: '—', name: s };
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
      '.rc-rd-edit-btn{flex-shrink:0;display:inline-flex;align-items:center;gap:5px;background:white;color:var(--muted);border:1px solid var(--border);border-radius:100px;font-family:"DM Sans",sans-serif;font-size:12px;font-weight:500;padding:8px 14px;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:all .15s;}',
      '.rc-rd-edit-btn:active{transform:scale(.94);}',
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

      // Edit mode
      '.rc-rd-edit-bar{display:flex;align-items:center;justify-content:space-between;padding:calc(16px + env(safe-area-inset-top,0px)) 16px 14px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--cream);}',
      '.rc-rd-edit-bar-title{font-family:"DM Sans",sans-serif;font-size:14px;font-weight:500;color:var(--muted);}',
      '.rc-rd-cancel-btn{background:none;border:none;color:var(--muted);font-family:"DM Sans",sans-serif;font-size:14px;font-weight:400;padding:8px 4px;cursor:pointer;-webkit-tap-highlight-color:transparent;}',
      '.rc-rd-cancel-btn:active{opacity:.6;}',
      '.rc-rd-save-edit-btn{background:var(--accent);color:white;border:none;border-radius:100px;font-family:"DM Sans",sans-serif;font-size:13px;font-weight:500;padding:9px 18px;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s,background .15s;}',
      '.rc-rd-save-edit-btn:active{transform:scale(.94);background:#b3581f;}',
      '.rc-rd-edit-form{padding:24px 20px calc(60px + env(safe-area-inset-bottom,0px));max-width:640px;margin:0 auto;display:flex;flex-direction:column;gap:20px;}',
      '.rc-rd-field{display:flex;flex-direction:column;gap:6px;}',
      '.rc-rd-field-label{font-size:10px;letter-spacing:2px;text-transform:uppercase;font-weight:500;color:var(--accent);}',
      '.rc-rd-input{width:100%;border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-family:"DM Sans",sans-serif;font-size:14px;font-weight:300;color:var(--ink);background:white;-webkit-appearance:none;appearance:none;outline:none;transition:border-color .15s;}',
      '.rc-rd-input:focus{border-color:var(--accent);}',
      'textarea.rc-rd-input{resize:vertical;line-height:1.6;}',

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
      '.rc-cm-textarea{width:100%;border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-family:"DM Sans",sans-serif;font-size:13px;font-weight:300;color:var(--ink);background:white;resize:vertical;line-height:1.6;-webkit-appearance:none;appearance:none;outline:none;transition:border-color .15s;box-sizing:border-box;}',
      '.rc-cm-textarea:focus{border-color:var(--accent);}',
      '.rc-cm-compose-footer{display:flex;justify-content:flex-end;}',
      '.rc-cm-post-btn{background:var(--accent);color:white;border:none;border-radius:100px;font-family:"DM Sans",sans-serif;font-size:13px;font-weight:500;padding:9px 20px;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s,background .15s;}',
      '.rc-cm-post-btn:active{transform:scale(.94);background:#b3581f;}',
      '.rc-cm-post-btn:disabled{opacity:.45;cursor:default;transform:none;}',

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
        // View mode header
        '<div class="rc-rd-bar" id="rc-rd-view-bar">',
          '<button class="rc-rd-back" id="rc-rd-back">←</button>',
          '<span class="rc-rd-name" id="rc-rd-name"></span>',
          '<button class="rc-rd-save-btn" id="rc-rd-save" aria-label="Save to recipes">',
            '<svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
            '<span id="rc-rd-save-label">Save</span>',
          '</button>',
          '<span class="rc-rd-in-recipes" id="rc-rd-in-recipes">',
            '<svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
            'In your recipes',
          '</span>',
          '<button class="rc-rd-edit-btn" id="rc-rd-edit">Edit</button>',
          '<button class="rc-rd-cook-btn" id="rc-rd-cook">',
            '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>Cook',
          '</button>',
        '</div>',
        // Edit mode header
        '<div class="rc-rd-edit-bar" id="rc-rd-edit-bar" style="display:none">',
          '<button class="rc-rd-cancel-btn" id="rc-rd-cancel">Cancel</button>',
          '<span class="rc-rd-edit-bar-title">Editing</span>',
          '<button class="rc-rd-save-edit-btn" id="rc-rd-save-edit">Save</button>',
        '</div>',
        '<div class="rc-rd-body">',
          '<div class="rc-rd-inner" id="rc-rd-inner">',
            '<div class="rc-rd-note" id="rc-rd-note" style="display:none"></div>',
            '<div class="rc-rd-cols">',
              '<div><div class="rc-rd-section-title">Ingredients</div><ul class="rc-rd-ing-list" id="rc-rd-ings"></ul></div>',
              '<div><div class="rc-rd-section-title">Directions</div><ol class="rc-rd-step-list" id="rc-rd-steps"></ol></div>',
            '</div>',
            '<div class="rc-cm-section">',
              '<div class="rc-cm-heading">Notes</div>',
              '<div class="rc-cm-list" id="rc-cm-list">',
                '<div class="rc-cm-empty" id="rc-cm-empty">No notes yet</div>',
              '</div>',
              '<div class="rc-cm-compose">',
                '<textarea class="rc-cm-textarea" id="rc-cm-textarea" placeholder="Add a note…" rows="3"></textarea>',
                '<div class="rc-cm-compose-footer">',
                  '<button class="rc-cm-post-btn" id="rc-cm-post">Post</button>',
                '</div>',
              '</div>',
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

  function renderDetailBody(recipe) {
    document.getElementById('rc-rd-name').textContent = recipe.name;
    document.getElementById('rc-rd-ings').innerHTML  = (recipe.ings || recipe.ingredients || []).map(function (i) { return '<li>' + escHtml(i) + '</li>'; }).join('');
    document.getElementById('rc-rd-steps').innerHTML = (recipe.steps || []).map(function (s, n) {
      return '<li><span class="rc-rd-step-num">' + (n + 1) + '</span><span>' + escHtml(s) + '</span></li>';
    }).join('');
    var noteEl = document.getElementById('rc-rd-note');
    if (recipe.note) { noteEl.textContent = recipe.note; noteEl.style.display = ''; }
    else             { noteEl.style.display = 'none'; }
  }

  function openDetail(r) {
    var id     = idOf(r);
    var edit   = recipeEdits[fbSafeKey(id)];
    curR = edit ? Object.assign({}, r, edit) : r;

    renderDetailBody(curR);
    document.querySelector('.rc-rd-body').scrollTop = 0;

    currentRecipeId = fbSafeKey(id);
    loadComments(currentRecipeId);
    var cmTa = document.getElementById('rc-cm-textarea');
    if (cmTa) cmTa.value = '';

    // Wire save button to this recipe
    var saveBtn = document.getElementById('rc-rd-save');
    saveBtn.onclick = function () { toggleSave(id, curR); };
    refreshSaveUI(id);

    rdEl.classList.add('open');
    rdEl.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeDetail() {
    if (inEditMode) exitEditMode();
    if (inAddMode) exitAddMode();
    rdEl.classList.remove('open');
    rdEl.setAttribute('aria-hidden', 'true');
    var ckEl = document.getElementById('rc-ck-overlay');
    if (!ckEl || !ckEl.classList.contains('open')) document.body.style.overflow = '';
  }

  // Build the recipe form markup. Shared by edit mode and add mode.
  // `includeIcon` adds an emoji field at the top (used only when adding).
  // `includeCategory` adds a category field that feeds the card eyebrow label
  // (used only when adding — edits leave the existing label untouched).
  function buildRecipeFormHTML(values, includeIcon, includeCategory) {
    var ings  = (values.ings || values.ingredients || []).join('\n');
    var steps = (values.steps || []).join('\n');
    var iconField = includeIcon ?
      '<div class="rc-rd-field">' +
        '<label class="rc-rd-field-label">Emoji</label>' +
        '<input class="rc-rd-input" id="rc-rd-ef-icon" type="text" value="' + escAttr(values.icon || '') + '" placeholder="🍽️" maxlength="4">' +
      '</div>' : '';
    var categoryField = includeCategory ?
      '<div class="rc-rd-field">' +
        '<label class="rc-rd-field-label">Category</label>' +
        '<input class="rc-rd-input" id="rc-rd-ef-category" type="text" value="' + escAttr(values.category || '') + '" placeholder="Pasta, Soup, Tacos…">' +
      '</div>' : '';
    return iconField +
      '<div class="rc-rd-field">' +
        '<label class="rc-rd-field-label">Recipe Name</label>' +
        '<input class="rc-rd-input" id="rc-rd-ef-name" type="text" value="' + escAttr(values.name || '') + '">' +
      '</div>' +
      categoryField +
      '<div class="rc-rd-field">' +
        '<label class="rc-rd-field-label">Details</label>' +
        '<input class="rc-rd-input" id="rc-rd-ef-meta" type="text" value="' + escAttr(values.meta || '') + '" placeholder="30 min · One pan · Serves 4">' +
      '</div>' +
      '<div class="rc-rd-field">' +
        '<label class="rc-rd-field-label">Ingredients &mdash; one per line</label>' +
        '<textarea class="rc-rd-input" id="rc-rd-ef-ings" rows="8" placeholder="1 cup flour&#10;2 eggs&#10;...">' + escHtml(ings) + '</textarea>' +
      '</div>' +
      '<div class="rc-rd-field">' +
        '<label class="rc-rd-field-label">Steps &mdash; one per line</label>' +
        '<textarea class="rc-rd-input" id="rc-rd-ef-steps" rows="10" placeholder="Preheat oven to 375°F.&#10;Mix dry ingredients.&#10;...">' + escHtml(steps) + '</textarea>' +
      '</div>' +
      '<div class="rc-rd-field">' +
        '<label class="rc-rd-field-label">Tip (optional)</label>' +
        '<input class="rc-rd-input" id="rc-rd-ef-note" type="text" value="' + escAttr(values.note || '') + '" placeholder="💡 Optional tip for cooks">' +
      '</div>';
  }

  function enterEditMode() {
    if (!curR) return;
    inEditMode = true;

    var editBar = document.getElementById('rc-rd-edit-bar');
    document.getElementById('rc-rd-view-bar').style.display = 'none';
    editBar.style.display = '';
    editBar.querySelector('.rc-rd-edit-bar-title').textContent = 'Editing';
    document.getElementById('rc-rd-inner').style.display = 'none';

    var form = document.createElement('div');
    form.id = 'rc-rd-edit-form';
    form.className = 'rc-rd-edit-form';
    form.innerHTML = buildRecipeFormHTML(curR, false);

    document.querySelector('.rc-rd-body').appendChild(form);
    document.querySelector('.rc-rd-body').scrollTop = 0;
  }

  // ── Add new recipe ──────────────────────────────────────────────────────
  function openAddForm() {
    inAddMode = true;
    curR = null;
    currentRecipeId = null;

    document.getElementById('rc-rd-view-bar').style.display = 'none';
    document.getElementById('rc-rd-inner').style.display = 'none';
    var editBar = document.getElementById('rc-rd-edit-bar');
    editBar.style.display = '';
    editBar.querySelector('.rc-rd-edit-bar-title').textContent = 'New Recipe';

    var existing = document.getElementById('rc-rd-edit-form');
    if (existing) existing.remove();

    var form = document.createElement('div');
    form.id = 'rc-rd-edit-form';
    form.className = 'rc-rd-edit-form';
    form.innerHTML = buildRecipeFormHTML({}, true, true);

    document.querySelector('.rc-rd-body').appendChild(form);
    document.querySelector('.rc-rd-body').scrollTop = 0;

    rdEl.classList.add('open');
    rdEl.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    var nameInput = document.getElementById('rc-rd-ef-name');
    if (nameInput) nameInput.focus();
  }

  function exitAddMode() {
    inAddMode = false;
    document.getElementById('rc-rd-view-bar').style.display = '';
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
          // Skip if this id somehow already exists (avoid duplicates)
          if (json.recipes.some(function (r) { return r.id === coreRecipe.id; })) return true;
          json.recipes.push(coreRecipe);
          var content = utf8ToBase64(JSON.stringify(json, null, 2) + '\n');
          return fetch(url, {
            method: 'PUT', headers: headers,
            body: JSON.stringify({
              message: 'Add recipe: ' + coreRecipe.name + ' (in-app)',
              content: content, sha: meta.sha, branch: 'main'
            })
          }).then(function (putR) { if (!putR.ok) throw new Error('put failed'); return true; });
        });
    });
  }

  function saveNewRecipe() {
    var iconVal  = document.getElementById('rc-rd-ef-icon').value.trim() || '🍽️';
    var nameVal  = document.getElementById('rc-rd-ef-name').value.trim();
    var catVal   = document.getElementById('rc-rd-ef-category').value.trim();
    var metaVal  = document.getElementById('rc-rd-ef-meta').value.trim();
    var ingsRaw  = document.getElementById('rc-rd-ef-ings').value;
    var stepsRaw = document.getElementById('rc-rd-ef-steps').value;
    var noteVal  = document.getElementById('rc-rd-ef-note').value.trim();

    if (!nameVal) {
      document.getElementById('rc-rd-ef-name').focus();
      return;
    }

    var ings  = ingsRaw.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    var steps = stepsRaw.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);

    // Card eyebrow label: "Category · time". Category defaults to "Dinner";
    // time is the first segment of meta (e.g. "~30 min · One pan" → "30 min").
    var category = catVal || 'Dinner';
    var timePart = (metaVal.split('·')[0] || '').replace(/^~/, '').trim();
    var labelVal = timePart ? (category + ' · ' + timePart) : category;

    // Unique id: slug of the name, with a numeric suffix on collision.
    var baseId = idOf({ name: nameVal });
    var id = baseId, n = 2;
    while (isCore(id) || isSaved(id)) { id = baseId + '-' + n; n++; }

    var recipe = {
      id:          id,
      icon:        iconVal,
      label:       labelVal,
      name:        nameVal,
      meta:        metaVal,
      ingredients: ings,
      ings:        ings,
      steps:       steps
    };
    if (noteVal) recipe.note = noteVal;

    // Persist to Firebase + insert the card via the existing save flow.
    // (Instant, syncs between accounts, and is the safe fallback if the
    // git commit below fails.)
    toggleSave(id, recipe);

    exitAddMode();
    closeDetail();

    // Also commit into data/recipes.json so it becomes a permanent recipe
    // that Agent X can see. Lands ~1 min later (after GitHub Pages rebuilds).
    var coreRecipe = {
      id:          recipe.id,
      icon:        recipe.icon,
      label:       recipe.label || '',
      name:        recipe.name,
      meta:        recipe.meta,
      tags:        [],
      ingredients: recipe.ingredients,
      steps:       recipe.steps
    };
    if (recipe.note) coreRecipe.note = recipe.note;
    commitRecipeToCore(coreRecipe).catch(function (err) {
      console.warn('Recipe saved to Firebase but not committed to recipes.json:', err);
      alert('"' + recipe.name + '" was saved and synced, but couldn’t be added to your permanent recipe list just now. It will still show up for you and Josephine. You can try adding it again later to make it permanent.');
    });
  }

  function exitEditMode() {
    inEditMode = false;

    document.getElementById('rc-rd-view-bar').style.display = '';
    document.getElementById('rc-rd-edit-bar').style.display = 'none';
    document.getElementById('rc-rd-inner').style.display = '';

    var form = document.getElementById('rc-rd-edit-form');
    if (form) form.remove();
  }

  function saveRecipeEdit() {
    if (!curR) return;
    var id = idOf(curR);

    var nameVal  = document.getElementById('rc-rd-ef-name').value.trim();
    var metaVal  = document.getElementById('rc-rd-ef-meta').value.trim();
    var ingsRaw  = document.getElementById('rc-rd-ef-ings').value;
    var stepsRaw = document.getElementById('rc-rd-ef-steps').value;
    var noteVal  = document.getElementById('rc-rd-ef-note').value.trim();

    var ings  = ingsRaw.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    var steps = stepsRaw.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);

    var updated = Object.assign({}, curR, {
      name:        nameVal  || curR.name,
      meta:        metaVal,
      ingredients: ings,
      ings:        ings,
      steps:       steps
    });
    if (noteVal) { updated.note = noteVal; } else { delete updated.note; }

    // Update state
    curR = updated;
    recipeEdits[fbSafeKey(id)] = updated;

    // Persist to Firebase
    authedFetch(FB_EDITS + '/' + fbSafeKey(id) + '.json', {
      method: 'PUT',
      body: JSON.stringify(updated)
    }).catch(function () {});

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

  function renderComment(c, safeId) {
    var item = document.createElement('div');
    item.className = 'rc-cm-item';
    item.dataset.key = c._key;
    var trashSvg = '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>';
    item.innerHTML =
      '<div class="rc-cm-item-header">' +
        '<span class="rc-cm-author">' + escHtml(c.author || 'Unknown') + '</span>' +
        '<span class="rc-cm-ts">' + relativeTime(c.ts) + '</span>' +
        '<button class="rc-cm-del" aria-label="Delete note">' + trashSvg + '</button>' +
      '</div>' +
      '<div class="rc-cm-text">' + escHtml(c.text) + '</div>';
    item.querySelector('.rc-cm-del').addEventListener('click', function () {
      deleteComment(safeId, c._key, item);
    });
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
        if (!data || typeof data !== 'object' || data.error || !Object.keys(data).length) return;
        var entries = Object.keys(data)
          .map(function (k) { return Object.assign({ _key: k }, data[k]); })
          .sort(function (a, b) { return b.ts - a.ts; });
        emptyEl.style.display = 'none';
        entries.forEach(function (c) { listEl.appendChild(renderComment(c, safeId)); });
      })
      .catch(function () {});
  }

  function submitComment(safeId) {
    var textarea = document.getElementById('rc-cm-textarea');
    var postBtn  = document.getElementById('rc-cm-post');
    if (!textarea || !postBtn) return;
    var text = textarea.value.trim();
    if (!text) return;
    var email  = currentUserEmail || '';
    var author = AUTHOR_MAP[email] || 'Unknown';
    var ts     = Date.now();
    var key    = String(ts);
    var comment = { text: text, author: author, email: email, ts: ts };
    postBtn.disabled  = true;
    textarea.disabled = true;
    authedFetch(FB_COMMENTS + '/' + safeId + '/' + key + '.json', {
      method: 'PUT',
      body: JSON.stringify(comment)
    })
      .then(function (r) {
        if (!r.ok) throw new Error('write failed');
        textarea.value = '';
        var listEl  = document.getElementById('rc-cm-list');
        var emptyEl = document.getElementById('rc-cm-empty');
        if (listEl) {
          emptyEl.style.display = 'none';
          listEl.insertBefore(renderComment(Object.assign({ _key: key }, comment), safeId), listEl.firstChild);
        }
      })
      .catch(function () {
        postBtn.textContent = 'Failed — try again';
        setTimeout(function () { postBtn.textContent = 'Post'; }, 3000);
      })
      .finally(function () {
        postBtn.disabled  = false;
        textarea.disabled = false;
        textarea.focus();
      });
  }

  function deleteComment(safeId, key, itemEl) {
    itemEl.style.opacity = '0.4';
    itemEl.style.pointerEvents = 'none';
    authedFetch(FB_COMMENTS + '/' + safeId + '/' + key + '.json', { method: 'DELETE' })
      .then(function (r) {
        if (!r.ok) throw new Error('delete failed');
        var listEl  = document.getElementById('rc-cm-list');
        var emptyEl = document.getElementById('rc-cm-empty');
        itemEl.remove();
        if (listEl && listEl.querySelectorAll('.rc-cm-item').length === 0) {
          emptyEl.style.display = '';
        }
      })
      .catch(function () {
        itemEl.style.opacity = '';
        itemEl.style.pointerEvents = '';
      });
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
      ingsList.innerHTML  = (r.ings || r.ingredients || []).map(function (i) {
        var p = parseIng(i);
        return '<li class="rc-ck-ing-row"><span class="rc-ck-qty">' + escHtml(p.qty) + '</span><span class="rc-ck-item-name">' + escHtml(p.name) + '</span></li>';
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
     */
    init: function (options) {
      options = options || {};
      coreIds          = options.coreIds      || {};
      _onSaveChange    = options.onSaveChange || null;
      currentUserEmail = options.userEmail    || null;

      injectSharedUI();
      rdEl = document.getElementById('rc-rd-overlay');

      // Wire static buttons
      document.getElementById('rc-rd-back').addEventListener('click', closeDetail);
      document.getElementById('rc-rd-edit').addEventListener('click', enterEditMode);
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
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          var ck = document.getElementById('rc-ck-overlay');
          if (ck && ck.classList.contains('open')) { global.RecipeCard.closeMode && global.RecipeCard.closeMode(); }
          else if (inEditMode) { exitEditMode(); }
          else if (rdEl && rdEl.classList.contains('open')) { closeDetail(); }
        }
      });

      initCookingMode();

      var pending = 2;
      function onLoaded() { if (--pending === 0 && options.onReady) options.onReady(); }
      loadSavedState(onLoaded);
      loadRecipeEdits(onLoaded);
    },

    /**
     * makeCard(recipe, labelOverride)
     * Returns a DOM element for a meal card. Click opens detail overlay.
     */
    makeCard: function (r, labelOverride) {
      var id  = idOf(r);
      var lbl = labelOverride !== undefined ? labelOverride : (r.label || '');
      var div = document.createElement('div');
      div.className = 'rc-card';
      div.setAttribute('data-recipe-id', id);
      div.innerHTML =
        '<div class="rc-card-inner">' +
          '<div class="rc-card-icon">' + escHtml(r.icon || '🍽') + '</div>' +
          '<div class="rc-card-body">' +
            '<div class="rc-card-label">' + escHtml(lbl) + '</div>' +
            '<div class="rc-card-name">' + escHtml(r.name) + '</div>' +
            '<div class="rc-card-meta">' + escHtml(r.meta || '') + '</div>' +
          '</div>' +
          '<div class="rc-card-right">' +
            '<span class="rc-saved-badge" data-id="' + escAttr(id) + '">' +
              '<svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>' +
              'Saved' +
            '</span>' +
            '<span class="rc-chevron">›</span>' +
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
      authedFetch(FB_DATA)
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
    openAddForm: openAddForm,
    idOf: idOf,
    isSaved: isSaved,
    isCore: isCore
  };

})(window);

/* explore.js — the Explore tab: a grid of recipes pulled in from food blogs.
 *
 * The feed itself is static JSON written by scripts/fetch-explore.js in CI
 * (data/explore/manifest.json + one file per month), read straight from
 * GitHub Pages. Firebase holds only what the two of you do with it:
 *
 *   /explore/hidden/<key> = <ms>          "Not for us" — never shown again
 *   /explore/saved/<key>  = "<recipe id>" saved into the collection
 *
 * Filtering is the same sheet the Recipes tab uses (recipe-filters.js), with
 * three groups of its own: Course (Dinners picked by default — the feed is
 * for dinners, and everything else the blogs post waits behind that chip
 * rather than being thrown away), Saved, and Blog.
 *
 * Tapping a tile opens the normal recipe view in its "external" mode (see
 * openDetail in recipe-card.js), whose Save bar calls back here. Saving goes
 * through RecipeCard.saveRecipe — the same path as the add form, so the
 * recipe lands in Firebase at once and in data/recipes.json a minute later —
 * with an extra "Explore" tag so the Recipes filter panel can group them.
 */
import { requireAuth, getAuthToken, signOut } from './auth.js';
window.getToken  = getAuthToken;
window.doSignOut = signOut;
const user = await requireAuth();
if (window.setNavUser) window.setNavUser(user);

const FB_EXPLORE = 'https://fox-bear-hub-default-rtdb.firebaseio.com/explore';

async function fb(path, options) {
  const token = await getAuthToken();
  return fetch(FB_EXPLORE + path + '.json?auth=' + encodeURIComponent(token), options);
}
async function fbGet(path) {
  try { const r = await fb(path); return r.ok ? await r.json() : null; }
  catch (e) { return null; }
}
function fbPut(path, value) {
  return fb(path, { method: 'PUT', body: JSON.stringify(value) }).catch(() => {});
}
function fbDelete(path) {
  return fb(path, { method: 'DELETE' }).catch(() => {});
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function canonical(url) {
  try { const u = new URL(url); u.search = ''; u.hash = ''; return u.href; }
  catch (e) { return url || ''; }
}

// ── Load everything the page needs, in parallel ─────────────────────────
const [recipesData, sources, manifest, hiddenMap, savedMap] = await Promise.all([
  fetch('data/recipes.json').then((r) => r.json()).catch(() => ({ recipes: [] })),
  fetch('data/explore/sources.json').then((r) => r.ok ? r.json() : []).catch(() => []),
  fetch('data/explore/manifest.json', { cache: 'no-cache' }).then((r) => r.ok ? r.json() : null).catch(() => null),
  fbGet('/hidden'),
  fbGet('/saved')
]);

const RECIPES  = recipesData.recipes || [];
const CORE_IDS = {};
const coreBySource = {};     // canonical source url → recipe id, for the Saved pill
RECIPES.forEach((r) => {
  CORE_IDS[r.id] = true;
  if (r.source) coreBySource[canonical(r.source)] = r.id;
});
const hidden = hiddenMap && typeof hiddenMap === 'object' ? hiddenMap : {};
const saved  = savedMap  && typeof savedMap  === 'object' ? savedMap  : {};

const months = (manifest && manifest.months) || [];
const items  = [];           // every loaded item, newest first
const byKey  = {};
const byUrl  = {};
let nextMonth = 0;
let loading = false;
let query = '';

const els = {
  hm:      document.getElementById('hm'),
  srch:    document.getElementById('srch'),
  srchX:   document.getElementById('srch-x'),
  filtBtn: document.getElementById('filt-btn'),
  empty:   document.getElementById('empty'),
  grid:    document.getElementById('grid'),
  cols:    [document.getElementById('col-a'), document.getElementById('col-b')],
  more:    document.getElementById('more'),
  foot:    document.getElementById('foot'),
  toast:   document.getElementById('toast')
};

// ── Recipe view + saving ────────────────────────────────────────────────
await new Promise((resolve) => {
  RecipeCard.init({
    coreIds: CORE_IDS,
    userEmail: user.email,
    // Fires the moment saveRecipe writes to Firebase, with the minted id —
    // which is how the tile gets its pill and /explore/saved its entry
    // before the git commit has even started.
    onSaveChange(id, saving, obj) {
      if (!saving || !obj || !obj.source) return;
      const it = byUrl[canonical(obj.source)];
      if (it) markSaved(it, id);
    },
    onReady: resolve
  });
});

function savedId(it) { return saved[it.key] || coreBySource[it.url] || ''; }

function markSaved(it, id) {
  if (saved[it.key] === id) return;
  saved[it.key] = id;
  const tile = tileFor(it.key);
  if (tile) tile.classList.add('saved');
  fbPut('/saved/' + it.key, id);
  // With "Not saved yet" picked, the tile has just stopped belonging here.
  if (Object.keys(filters.selected.saved || {}).length) render(true);
}

function open(it) {
  RecipeCard.openDetail(it, null, {
    external: true,
    saved: !!savedId(it),
    onSave: () => save(it),
    onHide: () => hide(it)
  });
}

async function save(it) {
  RecipeCard.closeDetail();
  if (savedId(it)) { toast('Already in your recipes'); return; }
  toast('Saved to your recipes');
  try {
    await RecipeCard.saveRecipe({
      icon: it.icon, name: it.name, meta: it.meta,
      tags: (it.tags || []).concat(['Explore']),
      ingredients: it.ingredients, steps: it.steps, note: it.note || '',
      source: it.url, image: it.image
    });
  } catch (err) {
    console.warn('Saved to Firebase but not committed to recipes.json:', err);
    alert('"' + it.name + '" was saved and synced, but couldn’t be added to your permanent recipe list just now. It will still show up for you and Josephine.');
  }
}

function hide(it) {
  RecipeCard.closeDetail();
  hidden[it.key] = Date.now();
  const tile = tileFor(it.key);
  if (tile) tile.remove();
  fbPut('/hidden/' + it.key, hidden[it.key]);
  refreshEmpty();
  refreshCount();
  toast('Hidden', {
    label: 'Undo',
    onClick() {
      delete hidden[it.key];
      fbDelete('/hidden/' + it.key);
      render(true);
    }
  });
}

// ── Loading months ──────────────────────────────────────────────────────
async function loadMonth(i) {
  const m = months[i];
  let data = null;
  try {
    const r = await fetch('data/explore/' + m + '.json', { cache: 'no-cache' });
    data = r.ok ? await r.json() : null;
  } catch (e) { data = null; }
  ((data && data.items) || []).forEach((it) => {
    if (byKey[it.key]) return;
    byKey[it.key] = it;
    byUrl[it.url] = it;
    items.push(it);
  });
}

async function loadNext() {
  if (loading || nextMonth >= months.length) return false;
  loading = true;
  await loadMonth(nextMonth++);
  loading = false;
  return true;
}

// Search and the filters look across everything, so they pull in every
// month first. A handful of files for a long while yet.
async function loadAll() {
  while (nextMonth < months.length) await loadNext();
}

// ── Filters ─────────────────────────────────────────────────────────────
// The sheet is recipe-filters.js, shared with the Recipes tab. The common
// facet (dish, cuisine, time, method, protein) comes from the item's tags,
// meta and ingredients; Explore adds the course, the blog, and whether it has
// been saved. Items that can be shown at all — readable and not hidden — are
// the pool every count is taken over.
const COURSE_LABEL = { dinner: 'Dinners', breakfast: 'Breakfast', dessert: 'Desserts', side: 'Sides', drink: 'Drinks', other: 'Other' };
const COURSES = ['Dinners', 'Breakfast', 'Desserts', 'Sides', 'Drinks', 'Other'];
const sourceName = {};
sources.forEach((s) => { sourceName[s.id] = s.name; });

// An item labelled before courses existed counts as a dinner.
function courseLabel(f) { return COURSE_LABEL[f.course] || 'Dinners'; }

function facetOf(it) {
  if (!it._facet) {
    it._facet = RecipeFilters.facetFor(it, it.tags, it.key);
    it._facet.course = it.course;
    it._facet.sourceId = it.sourceId;
  }
  it._facet.saved = !!savedId(it);     // live — saving a tile changes it
  return it._facet;
}

function pool() { return items.filter((it) => it.recipe && !hidden[it.key]); }
function textOK(it) { return !query || haystack(it).indexOf(query) !== -1; }

const G = RecipeFilters.groups;
const FILTER_GROUPS = [
  { key: 'course', title: 'Course', fixed: COURSES, defaults: ['Dinners'],
    values: (f) => [courseLabel(f)] },
  { key: 'saved',  title: 'Saved', fixed: ['Not saved yet', 'Saved'],
    values: (f) => [f.saved ? 'Saved' : 'Not saved yet'] },
  { key: 'blog',   title: 'Blog', fixed: sources.map((s) => s.name),
    values: (f) => sourceName[f.sourceId] ? [sourceName[f.sourceId]] : [] },
  G.dish, G.cuisine, G.time, G.method, G.protein
];

const filters = RecipeFilters.attach({
  button:    els.filtBtn,
  title:     'Filter new recipes',
  groups:    FILTER_GROUPS,
  ids:       () => pool().map((it) => it.key),
  facet:     (id) => byKey[id] ? facetOf(byKey[id]) : undefined,
  textMatch: (id) => !!byKey[id] && textOK(byKey[id]),
  // Every month is loaded before the sheet opens, so the counts are complete.
  onOpen:    loadAll,
  onChange:  async () => {
    if (filters.activeCount()) await loadAll();
    render(true);
    filters.refresh();
  }
});

// ── Rendering ───────────────────────────────────────────────────────────
let renderedUpTo = 0;

function visible(it) {
  if (!it.recipe || hidden[it.key]) return false;
  return filters.matches(it.key) && textOK(it);
}

function haystack(it) {
  if (!it._hay) {
    const ings = IngFormat.stripSections(it.ingredients || []);
    it._hay = [it.name, it.site, (it.tags || []).join(' '), it.meta, ings.join(' ')].join(' ').toLowerCase();
  }
  return it._hay;
}

function subline(it) {
  const time = ((it.meta || '').split('·')[0] || '').trim();
  return it.site + (time ? ' · ' + time : '');
}

function tile(it) {
  const el = document.createElement('div');
  el.className = 'xt' + (savedId(it) ? ' saved' : '');
  el.setAttribute('data-key', it.key);
  // referrerpolicy: the photos are links to each blog's CDN, and some refuse
  // a foreign referrer. loading=lazy keeps a long grid cheap.
  const img = it.image
    ? '<img loading="lazy" referrerpolicy="no-referrer" alt="" src="' + escHtml(it.image) + '">'
    : '';
  el.innerHTML =
    '<div class="xt-img' + (it.image ? '' : ' no-img') + '">' + img +
      '<span class="xt-emoji">' + escHtml(it.icon || '🍽') + '</span></div>' +
    '<div class="xt-body"><div class="xt-name">' + escHtml(it.name) + '</div>' +
      '<div class="xt-sub">' + escHtml(subline(it)) + '</div></div>' +
    '<span class="xt-saved">Saved</span>';
  const im = el.querySelector('img');
  if (im) {
    // Let the photo take its own shape, within reason: a panorama or a
    // skyscraper would wreck the column.
    im.addEventListener('load', () => {
      if (im.naturalWidth && im.naturalHeight) {
        const ar = im.naturalWidth / im.naturalHeight;
        im.style.aspectRatio = String(Math.min(1.35, Math.max(0.72, ar)));
      }
    });
    im.addEventListener('error', () => {
      el.querySelector('.xt-img').classList.add('no-img');
      im.remove();
    });
  }
  el.addEventListener('click', () => open(it));
  return el;
}

function tileFor(key) {
  return els.grid.querySelector('.xt[data-key="' + key + '"]');
}

function shorterCol() {
  return els.cols[0].offsetHeight <= els.cols[1].offsetHeight ? els.cols[0] : els.cols[1];
}

/** Append whatever is new; `reset` rebuilds from scratch (after a filter). */
function render(reset) {
  if (reset) {
    els.cols.forEach((c) => { c.innerHTML = ''; });
    renderedUpTo = 0;
  }
  for (; renderedUpTo < items.length; renderedUpTo++) {
    const it = items[renderedUpTo];
    if (visible(it)) shorterCol().appendChild(tile(it));
  }
  refreshEmpty();
  refreshFoot();
  refreshCount();
}

function refreshEmpty() {
  const shown = els.grid.querySelectorAll('.xt').length;
  if (shown) { els.empty.style.display = 'none'; return; }
  const allLoaded = nextMonth >= months.length;
  if (!months.length) {
    els.empty.innerHTML = '<strong>Nothing here yet</strong>The first batch of recipes arrives tomorrow morning.';
  } else if (allLoaded && (query || filters.activeCount())) {
    // The match may be sitting under another course.
    const others = pool().filter((it) => textOK(it) && filters.matches(it.key, 'course')).length;
    els.empty.innerHTML = '<strong>No matches</strong>' +
      (others
        ? others + (others === 1 ? ' is' : ' are') + ' under another course — change the Course filter to see ' + (others === 1 ? 'it' : 'them') + '.'
        : 'Try another word, or loosen the filters.');
  } else if (allLoaded) {
    els.empty.innerHTML = '<strong>All caught up</strong>You’ve seen or hidden everything so far. New recipes arrive each morning.';
  } else {
    els.empty.style.display = 'none';
    return;
  }
  els.empty.style.display = '';
}

function refreshFoot() {
  const allLoaded = nextMonth >= months.length;
  const shown = els.grid.querySelectorAll('.xt').length;
  els.foot.textContent = allLoaded && shown ? 'That’s everything so far. New recipes arrive each morning.' : '';
}

function refreshCount() {
  if (!manifest) { els.hm.textContent = 'Nothing pulled in yet'; return; }
  if (query || filters.activeCount()) {
    const all = pool();
    const shown = all.filter(visible).length;
    els.hm.textContent = shown + ' of ' + all.length + ' recipes match';
    return;
  }
  const sum = (map) => Object.keys(map || {}).reduce((n, m) => n + (map[m] || 0), 0);
  // A manifest from before courses existed has no dinners map: everything counts.
  const dinners = manifest.dinners ? sum(manifest.dinners) : sum(manifest.counts);
  const blogs = manifest.sources || sources.length;
  els.hm.textContent = dinners + (dinners === 1 ? ' dinner' : ' dinners') + ' from ' + blogs + ' blogs · updated ' + whenText(manifest.updatedAt);
}

function whenText(iso) {
  const t = Date.parse(iso || '');
  if (isNaN(t)) return 'recently';
  const d = new Date(t), now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff < 7) return diff + ' days ago';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Search ──────────────────────────────────────────────────────────────
els.srch.addEventListener('input', async () => {
  query = els.srch.value.trim().toLowerCase();
  els.srchX.style.display = query ? 'block' : 'none';
  if (query) await loadAll();
  render(true);
});
els.srchX.addEventListener('click', () => {
  els.srch.value = '';
  els.srch.dispatchEvent(new Event('input'));
  els.srch.focus();
});

// ── Infinite scroll ─────────────────────────────────────────────────────
const sentinel = new IntersectionObserver(async (entries) => {
  if (!entries.some((en) => en.isIntersecting)) return;
  if (await loadNext()) render(false);
}, { rootMargin: '600px' });

// ── Toast ───────────────────────────────────────────────────────────────
let toastTimer = null;
function toast(text, action) {
  els.toast.innerHTML = escHtml(text) + (action ? '<button type="button">' + escHtml(action.label) + '</button>' : '');
  if (action) {
    els.toast.querySelector('button').addEventListener('click', () => {
      clearToast();
      action.onClick();
    });
  }
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(clearToast, action ? 6000 : 2600);
}
function clearToast() {
  clearTimeout(toastTimer);
  els.toast.classList.remove('show');
}

// ── Go ──────────────────────────────────────────────────────────────────
await loadNext();
render(true);
sentinel.observe(els.more);

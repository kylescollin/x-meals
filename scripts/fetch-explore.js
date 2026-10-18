#!/usr/bin/env node
/* fetch-explore.js — pulls the blogs in data/explore/sources.json and turns
 * each new post into a recipe for the Explore tab.
 *
 *   node scripts/fetch-explore.js                 every source
 *   node scripts/fetch-explore.js --source id     one source (debugging)
 *   node scripts/fetch-explore.js --dry-run       parse but write nothing
 *
 * Runs daily from .github/workflows/explore-feed.yml. No secrets: the feeds
 * are public and the output is plain JSON the site reads from GitHub Pages.
 *
 * What it writes
 *   data/explore/YYYY-MM.json   one file per month (by the post's publish
 *                               date), items newest first
 *   data/explore/manifest.json  which months exist and how many readable
 *                               recipes each holds — the page reads this first
 *
 * How a post becomes a recipe
 *   The same parser the in-app import button uses (recipe-import.js), run
 *   under Node with linkedom standing in for the browser's DOMParser. Four
 *   attempts, in order, stopping at the first that yields ingredients AND
 *   steps:
 *     1. the feed body itself — half the blogs embed their whole recipe card
 *        in the feed, so the page is never fetched (and can't block us)
 *     2. the page, fetched directly
 *     3. the page, through the recipe-fetcher deployment
 *     4. give up: the item is recorded with recipe:false and the site never
 *        shows it. It gets two more tries on later runs (a blog can have a
 *        bad day), then it's left alone for good — most of these are
 *        roundups and meal plans, which were never recipes.
 *
 * Idempotent: a URL seen once is never re-read once it's settled, and a run
 * that finds nothing new changes no file. That's what lets CI commit whatever
 * it wrote without a second thought.
 */
'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');

// recipe-import.js does `new DOMParser()` unguarded; this is the only global
// it needs. Deliberately not `window` or `document` — without them the
// importer's regex entity decoder runs, which is also what its tests cover.
if (typeof global.DOMParser === 'undefined') {
  global.DOMParser = require('linkedom').DOMParser;
}
const RI = require('../recipe-import.js');

const ROOT     = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'explore');
const FETCHER  = 'https://recipe-fetcher-seven.vercel.app/api/fetch';
const UA       = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
                 '(KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const TIMEOUT_MS = 20000;
const PAGE_PAUSE_MS = 1000;      // between page fetches: be a polite guest
const MAX_TRIES = 3;             // reads of an unreadable post before giving up

// ── Feed reading ─────────────────────────────────────────────────────────

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  cdataPropName: '__cdata',
  htmlEntities: true,
  isArray: (name) => ['item', 'entry', 'link', 'enclosure', 'media:content', 'media:thumbnail'].includes(name)
});

// A node may be a string, {#text}, {__cdata}, {@_attr, #text} or an array.
function text(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v !== 'object') return String(v).trim();
  return text(v.__cdata != null ? v.__cdata : v['#text']);
}
function attr(node, name) {
  const n = Array.isArray(node) ? node[0] : node;
  return n && n['@_' + name] ? String(n['@_' + name]) : '';
}
function atomLink(links, rel) {
  const hit = [].concat(links || []).find((l) => l && (l['@_rel'] || 'alternate') === rel);
  return hit ? String(hit['@_href'] || '') : '';
}
function firstImg(html) {
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html || '');
  return m ? m[1] : '';
}

/** Every post in a feed, RSS 2.0 or Atom, as {link, title, published, content, image}. */
function feedItems(feedXml) {
  const doc = xml.parse(feedXml);
  if (doc.rss) {
    const channel = [].concat(doc.rss.channel || [])[0] || {};
    return (channel.item || []).map((it) => {
      const content = text(it['content:encoded']) || text(it.description);
      return {
        link:      text(it.link) || text(it.guid),
        title:     text(it.title),
        published: text(it.pubDate) || text(it['dc:date']),
        content,
        image:     attr(it['media:content'], 'url') || attr(it['media:thumbnail'], 'url') ||
                   attr(it.enclosure, 'url') || firstImg(content)
      };
    });
  }
  const feed = doc.feed || {};
  return (feed.entry || []).map((e) => {
    const content = text(e.content) || text(e.summary);
    return {
      link:      atomLink(e.link, 'alternate'),
      title:     text(e.title),
      published: text(e.published) || text(e.updated),
      content,
      image:     attr(e['media:content'], 'url') || attr(e['media:thumbnail'], 'url') ||
                 atomLink(e.link, 'enclosure') || firstImg(content)
    };
  });
}

// ── Identity ─────────────────────────────────────────────────────────────

/** The URL without query or hash — the identity a post keeps across tracking params. */
function canonical(url) {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.href;
  } catch (e) { return ''; }
}

/** Short, Firebase-safe key for a canonical URL. */
function keyFor(url) {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 12);
}

function toIso(dateText, fallback) {
  const t = Date.parse(dateText || '');
  return isNaN(t) ? fallback : new Date(t).toISOString();
}

function monthOf(iso) { return iso.slice(0, 7); }

// ── One post → one item ──────────────────────────────────────────────────

/** `recipe` is the parser's output or null; the item shape matches data/recipes.json. */
function buildItem(post, source, recipe, fetchedIso) {
  const url = canonical(post.link);
  const published = toIso(post.published, fetchedIso);
  const base = {
    key: keyFor(url),
    id: 'explore-' + keyFor(url),
    url,
    site: source.name,
    sourceId: source.id,
    published,
    fetched: fetchedIso,
    name: (recipe && recipe.name) || post.title || url,
    image: (recipe && recipe.image) || post.image || ''
  };
  if (!recipe) return Object.assign(base, { recipe: false, tries: 1 });
  return Object.assign(base, {
    icon: recipe.icon || '🍽',
    tags: recipe.tags || [],
    meta: recipe.meta || '',
    ingredients: recipe.ings || [],
    steps: recipe.steps || [],
    note: '',
    source: url,
    recipe: true
  });
}

function parsed(html, url) {
  if (!html || html.length < 200) return null;
  let r = null;
  try { r = RI._parse(html, url); } catch (e) { r = null; }
  if (!r || !(r.ings || []).length || !(r.steps || []).length) return null;
  return r;
}

/**
 * Try the four ways of reading a post. `net` is injectable so the test can run
 * offline: {fetchText(url) → html|null, fetchJson(url) → object|null, pause()}.
 * Returns {recipe, via} where via names the attempt that worked.
 */
async function readPost(post, net) {
  const url = canonical(post.link);
  let r = parsed(post.content, url);
  if (r) return { recipe: r, via: 'feed' };

  await net.pause();
  r = parsed(await net.fetchText(url), url);
  if (r) return { recipe: r, via: 'page' };

  const viaFetcher = await net.fetchJson(FETCHER + '?url=' + encodeURIComponent(url));
  r = parsed(viaFetcher && viaFetcher.html, url);
  if (r) return { recipe: r, via: 'fetcher' };

  return { recipe: null, via: 'none' };
}

// ── The store on disk ────────────────────────────────────────────────────

const MONTH_FILE = /^(\d{4}-\d{2})\.json$/;

function loadStore(dir) {
  const months = {};
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).forEach((f) => {
      const m = MONTH_FILE.exec(f);
      if (!m) return;
      try { months[m[1]] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).items || []; }
      catch (e) { months[m[1]] = []; }
    });
  }
  return months;
}

function knownItems(months) {
  const map = new Map();
  Object.keys(months).forEach((m) => months[m].forEach((it) => map.set(it.url, it)));
  return map;
}

function settled(it) {
  return !!it.recipe || (it.tries || 1) >= MAX_TRIES;
}

function sortItems(items) {
  return items.slice().sort((a, b) => (a.published < b.published ? 1 : a.published > b.published ? -1 : 0));
}

function manifestFor(months, sourceCount, nowIso) {
  const keys = Object.keys(months).sort().reverse();
  const counts = {};
  keys.forEach((m) => { counts[m] = months[m].filter((it) => it.recipe).length; });
  return { months: keys, counts, sources: sourceCount, updatedAt: nowIso };
}

function stable(obj) { return JSON.stringify(obj, null, 2) + '\n'; }

/** Write only files whose content changed. Returns the names written. */
function writeStore(dir, months, touched, manifest) {
  const written = [];
  fs.mkdirSync(dir, { recursive: true });
  Object.keys(touched).forEach((m) => {
    const file = path.join(dir, m + '.json');
    const next = stable({ month: m, items: sortItems(months[m]) });
    const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (prev !== next) { fs.writeFileSync(file, next); written.push(m + '.json'); }
  });
  const mf = path.join(dir, 'manifest.json');
  // updatedAt alone must not produce a commit every day, so compare without it.
  let prevManifest = null;
  try { prevManifest = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (e) { prevManifest = null; }
  const same = prevManifest &&
    JSON.stringify(prevManifest.months) === JSON.stringify(manifest.months) &&
    JSON.stringify(prevManifest.counts) === JSON.stringify(manifest.counts) &&
    prevManifest.sources === manifest.sources;
  if (!same) { fs.writeFileSync(mf, stable(manifest)); written.push('manifest.json'); }
  return written;
}

// ── Network (the real one) ───────────────────────────────────────────────

async function fetchWithTimeout(url, accept) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, 'Accept': accept, 'Accept-Language': 'en-US,en;q=0.9' }
    });
  } finally { clearTimeout(timer); }
}

const realNet = {
  async fetchText(url) {
    try {
      const res = await fetchWithTimeout(url, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
      if (!res.ok) return null;
      return await res.text();
    } catch (e) { return null; }
  },
  async fetchJson(url) {
    try {
      const res = await fetchWithTimeout(url, 'application/json');
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  },
  pause() { return new Promise((r) => setTimeout(r, PAGE_PAUSE_MS)); }
};

// ── The run ──────────────────────────────────────────────────────────────

/**
 * Pull every source and fold new posts into the store.
 * opts: {dir, sources, net, now, only, dryRun, log}
 * Returns {added, readable, written, perSource}.
 */
async function run(opts) {
  const dir     = opts.dir || DATA_DIR;
  const net     = opts.net || realNet;
  const nowIso  = (opts.now || new Date()).toISOString();
  const log     = opts.log || (() => {});
  const sources = (opts.sources || JSON.parse(fs.readFileSync(path.join(dir, 'sources.json'), 'utf8')))
    .filter((s) => !opts.only || s.id === opts.only);

  const months  = loadStore(dir);
  const known   = knownItems(months);
  const touched = {};
  const perSource = {};
  let added = 0, readable = 0, retried = 0;

  for (const source of sources) {
    const stat = { inFeed: 0, fresh: 0, retried: 0, readable: 0, via: {} };
    perSource[source.id] = stat;
    const feedXml = await net.fetchText(source.feed);
    if (!feedXml) { log(`${source.name}: feed unavailable`); stat.error = 'feed unavailable'; continue; }
    let posts;
    try { posts = feedItems(feedXml); }
    catch (e) { log(`${source.name}: feed unreadable (${e.message})`); stat.error = 'feed unreadable'; continue; }
    stat.inFeed = posts.length;

    for (const post of posts) {
      const url = canonical(post.link);
      if (!url) continue;
      const prior = known.get(url);
      if (prior && settled(prior)) continue;

      const { recipe, via } = await readPost(post, net);
      stat.via[via] = (stat.via[via] || 0) + 1;

      if (prior) {
        // Another go at one that wouldn't read last time.
        stat.retried++; retried++;
        const m = monthOf(prior.published);
        touched[m] = true;
        if (recipe) {
          const fixed = buildItem(post, source, recipe, nowIso);
          fixed.published = prior.published;      // keep its place in the month
          months[m][months[m].indexOf(prior)] = fixed;
          known.set(url, fixed);
          readable++; stat.readable++;
        } else {
          prior.tries = (prior.tries || 1) + 1;
        }
        continue;
      }

      stat.fresh++;
      const item = buildItem(post, source, recipe, nowIso);
      known.set(url, item);
      const m = monthOf(item.published);
      (months[m] = months[m] || []).push(item);
      touched[m] = true;
      added++;
      if (recipe) { readable++; stat.readable++; }
    }
    const how = Object.keys(stat.via).map((k) => `${k} ${stat.via[k]}`).join(', ');
    const again = stat.retried ? `, ${stat.retried} retried` : '';
    log(`${source.name}: ${stat.inFeed} in feed, ${stat.fresh} new${again}, ${stat.readable} readable${how ? ' (' + how + ')' : ''}`);
  }

  const manifest = manifestFor(months, sources.length === 1 && opts.only ? manifestSourceCount(dir, sources) : sources.length, nowIso);
  const written = opts.dryRun ? [] : writeStore(dir, months, touched, manifest);
  log(`${added} new post${added === 1 ? '' : 's'}${retried ? ', ' + retried + ' retried' : ''}, ${readable} readable; wrote ${written.length ? written.join(', ') : 'nothing'}`);
  return { added, retried, readable, written, perSource };
}

// A --source run shouldn't record "1 source" in the manifest.
function manifestSourceCount(dir, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'sources.json'), 'utf8')).length; }
  catch (e) { return fallback.length; }
}

module.exports = { feedItems, canonical, keyFor, monthOf, buildItem, readPost, run, loadStore, writeStore, manifestFor, FETCHER, MAX_TRIES };

if (require.main === module) {
  const args = process.argv.slice(2);
  const onlyIx = args.indexOf('--source');
  run({
    only: onlyIx !== -1 ? args[onlyIx + 1] : '',
    dryRun: args.includes('--dry-run'),
    log: (s) => console.log(s)
  }).then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
}

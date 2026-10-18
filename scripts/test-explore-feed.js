#!/usr/bin/env node
/* Tests for the Explore feed. Run: node scripts/test-explore-feed.js
 *
 * Everything here is offline: the network is a stub that hands back fixtures,
 * and the store is a temp directory. The cases that matter most are the
 * "second run" ones — CI commits whatever this script writes, so a run that
 * finds nothing new has to leave every byte alone.
 */
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const X    = require('./fetch-explore.js');

let failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log('  ✓ ' + label); return; }
  failed++;
  console.log('  ✗ ' + label + '\n      expected ' + e + '\n      got      ' + a);
}

// ── Fixtures ─────────────────────────────────────────────────────────────

// A WP Recipe Maker card, the way Budget Bytes and RecipeTin ship it in the feed.
const WPRM_CARD =
  '<div class="wprm-recipe-container"><h2 class="wprm-recipe-name">One Pot Lemon Orzo</h2>' +
  '<span class="wprm-recipe-servings">4</span>' +
  '<span class="wprm-recipe-total_time-hours">1<span class="sr-only"> hour</span></span> ' +
  '<span class="wprm-recipe-total_time-minutes">30<span class="sr-only"> minutes</span></span>' +
  '<ul><li class="wprm-recipe-ingredient">1 lb chicken thighs ($3.50)</li>' +
  '<li class="wprm-recipe-ingredient"><span>1 1/2</span> <span>cups</span> <span>orzo</span> <span class="wprm-recipe-ingredient-notes">$0.42</span></li>' +
  '<li class="wprm-recipe-ingredient">1 lemon</li></ul>' +
  '<div class="wprm-recipe-instruction-text">Brown the chicken in a large skillet.</div>' +
  '<div class="wprm-recipe-instruction-text">Add orzo and stock, simmer 12 minutes.</div></div>';

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">
<channel><title>Test Kitchen</title>
<item>
  <title><![CDATA[One Pot Lemon Orzo]]></title>
  <link>https://example.com/lemon-orzo/?utm_source=feed#recipe</link>
  <pubDate>Fri, 16 Oct 2026 13:30:00 +0000</pubDate>
  <media:content url="https://example.com/img/orzo.jpg" medium="image"/>
  <content:encoded><![CDATA[<p>Intro text.</p><img src="https://example.com/img/orzo-inline.jpg">${WPRM_CARD}]]></content:encoded>
</item>
<item>
  <title>Weeknight Chili</title>
  <link>https://example.com/chili/</link>
  <pubDate>Wed, 30 Sep 2026 09:00:00 +0000</pubDate>
  <description><![CDATA[<img src="https://example.com/img/chili.jpg"><p>Just a summary.</p>]]></description>
</item>
<item>
  <title>A Newsletter Post</title>
  <link>https://example.com/newsletter/</link>
  <pubDate>Thu, 01 Oct 2026 09:00:00 +0000</pubDate>
  <description>Nothing to cook here.</description>
</item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<entry>
  <title>Atom Soup</title>
  <link rel="alternate" href="https://atom.example.org/soup"/>
  <link rel="enclosure" href="https://atom.example.org/soup.jpg" type="image/jpeg"/>
  <published>2026-10-02T10:00:00Z</published>
  <content type="html">&lt;p&gt;hello&lt;/p&gt;</content>
</entry>
</feed>`;

const JSONLD_PAGE = `<!doctype html><html><head><title>Weeknight Chili - Test Kitchen</title>
<meta property="og:image" content="https://example.com/img/chili-og.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Recipe","name":"Weeknight Chili",
"recipeIngredient":["1 lb ground beef","1 can kidney beans","2 tbsp chili powder"],
"recipeInstructions":[{"@type":"HowToStep","text":"Brown the beef."},{"@type":"HowToStep","text":"Add beans and simmer."}],
"totalTime":"PT40M","recipeYield":"6 servings","recipeCuisine":"American"}</script></head><body></body></html>`;

// Smitten Kitchen's Jetpack block: microdata for the ingredients and time, the
// steps only as paragraphs inside one div (the first one even unopened).
const JETPACK_PAGE = `<!doctype html><html><head><title>Celery Chicken Salad - smitten kitchen</title></head><body>
<div class="jetpack-recipe" itemscope itemtype="https://schema.org/Recipe"><h3 class="jetpack-recipe-title" itemprop="name">Celery Chicken Salad</h3>
<ul class="jetpack-recipe-meta"><li class="jetpack-recipe-servings"><strong>Servings: </strong><span itemprop="recipeYield">4</span></li>
<li class="jetpack-recipe-time"><time itemprop="totalTime" datetime="PT50M">50 minutes</time></li></ul>
<div class="jetpack-recipe-content"><ul class="jetpack-recipe-ingredients">
<li class="jetpack-recipe-ingredient" itemprop="recipeIngredient">2 chicken breasts</li>
<li class="jetpack-recipe-ingredient" itemprop="recipeIngredient">4 celery stalks</li></ul>
<div class="jetpack-recipe-directions e-instructions">Roast the chicken and let it cool.</p><p>Dice the celery finely.</p><p>Fold everything together.</p></div></div></div></body></html>`;

const SOURCE = { id: 'test', name: 'Test Kitchen', feed: 'https://example.com/feed/' };

function stubNet(pages, json) {
  const calls = [];
  return {
    calls,
    async fetchText(url) { calls.push(url); return pages[url] === undefined ? null : pages[url]; },
    async fetchJson(url) { calls.push(url); return json && json[url] !== undefined ? json[url] : null; },
    async pause() {}
  };
}

function freshDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explore-'));
  fs.writeFileSync(path.join(dir, 'sources.json'), JSON.stringify([SOURCE]));
  return dir;
}

(async function main() {
  // ── Feed reading ───────────────────────────────────────────────────────
  console.log('feedItems');
  const posts = X.feedItems(RSS);
  check('every item is read', posts.length, 3);
  check('CDATA title', posts[0].title, 'One Pot Lemon Orzo');
  check('link keeps its tracking junk here (canonical strips it later)', posts[0].link, 'https://example.com/lemon-orzo/?utm_source=feed#recipe');
  check('media:content wins over an inline img', posts[0].image, 'https://example.com/img/orzo.jpg');
  check('content:encoded is the body', posts[0].content.indexOf('wprm-recipe-name') !== -1, true);
  check('description stands in when there is no content:encoded', posts[1].content.indexOf('Just a summary') !== -1, true);
  check('first img in the body when there is no media tag', posts[1].image, 'https://example.com/img/chili.jpg');
  check('an item with no image gets an empty string, not undefined', posts[2].image, '');

  const atom = X.feedItems(ATOM);
  check('Atom: alternate link', atom[0].link, 'https://atom.example.org/soup');
  check('Atom: enclosure link is the image', atom[0].image, 'https://atom.example.org/soup.jpg');
  check('Atom: published', atom[0].published, '2026-10-02T10:00:00Z');
  check('Atom: html content is decoded', atom[0].content, '<p>hello</p>');

  // ── Identity ───────────────────────────────────────────────────────────
  console.log('identity');
  check('canonical drops query and hash', X.canonical('https://example.com/lemon-orzo/?utm_source=feed#recipe'), 'https://example.com/lemon-orzo/');
  check('canonical of junk is empty', X.canonical('not a url'), '');
  check('key is 12 hex chars', /^[0-9a-f]{12}$/.test(X.keyFor('https://example.com/a')), true);
  check('key is stable', X.keyFor('https://example.com/a'), X.keyFor('https://example.com/a'));
  check('month from iso', X.monthOf('2026-10-16T13:30:00.000Z'), '2026-10');

  // ── Reading a post: the four attempts ──────────────────────────────────
  console.log('readPost');
  const NOW = new Date('2026-10-18T13:00:00Z');

  let net = stubNet({});
  let r = await X.readPost(posts[0], net);
  check('in-feed card parses without touching the network', net.calls, []);
  check('…and reports which attempt worked', r.via, 'feed');
  check('ingredients come from the card, prices stripped, fractions prettified',
    r.recipe.ings, ['1 lb chicken thighs', '1 ½ cups orzo', '1 lemon']);
  check('steps come from the card', r.recipe.steps.length, 2);
  let item = X.buildItem(posts[0], SOURCE, r.recipe, NOW.toISOString());
  check('item url is canonical', item.url, 'https://example.com/lemon-orzo/');
  check('item id is prefixed so it can never be a real recipe id', item.id, 'explore-' + item.key);
  check('item uses recipes.json field names', Object.keys(item).sort(),
    ['fetched', 'icon', 'id', 'image', 'ingredients', 'key', 'meta', 'name', 'note', 'published', 'recipe', 'site', 'source', 'sourceId', 'steps', 'tags', 'url']);
  check('parser name beats the feed title when present', item.name, 'One Pot Lemon Orzo');
  check('feed image fills in when the card has none', item.image, 'https://example.com/img/orzo.jpg');
  check('published is ISO', item.published, '2026-10-16T13:30:00.000Z');
  check('meta carries time (hours + minutes spans) and servings', item.meta, '1 hr 30 min · Stovetop · Serves 4');
  check('readable', item.recipe, true);

  net = stubNet({ 'https://example.com/chili/': JSONLD_PAGE });
  r = await X.readPost(posts[1], net);
  check('summary-only feed falls through to the page', r.via, 'page');
  check('page was fetched by its canonical url', net.calls, ['https://example.com/chili/']);
  item = X.buildItem(posts[1], SOURCE, r.recipe, NOW.toISOString());
  check('JSON-LD ingredients', item.ingredients, ['1 lb ground beef', '1 can kidney beans', '2 tbsp chili powder']);
  check('tags guessed from the name', item.tags, ['Chili', 'American']);
  check('og:image beats the feed image', item.image, 'https://example.com/img/chili-og.jpg');

  net = stubNet({ 'https://example.com/newsletter/': JETPACK_PAGE });
  r = await X.readPost(posts[2], net);
  check('Jetpack: ingredients from the microdata', r.recipe && r.recipe.ings, ['2 chicken breasts', '4 celery stalks']);
  check('Jetpack: steps split on the paragraph breaks', r.recipe && r.recipe.steps,
    ['Roast the chicken and let it cool.', 'Dice the celery finely.', 'Fold everything together.']);
  check('Jetpack: time and servings survive the merge', r.recipe && r.recipe.meta, '50 min · Oven · Serves 4');

  net = stubNet({ 'https://example.com/chili/': null }, { [X.FETCHER + '?url=' + encodeURIComponent('https://example.com/chili/')]: { html: JSONLD_PAGE } });
  r = await X.readPost(posts[1], net);
  check('a blocked page falls through to the fetcher', r.via, 'fetcher');

  net = stubNet({});
  r = await X.readPost(posts[2], net);
  check('nothing anywhere → no recipe', r.recipe, null);
  item = X.buildItem(posts[2], SOURCE, null, NOW.toISOString());
  check('unreadable items are recorded small', Object.keys(item).sort(),
    ['fetched', 'id', 'image', 'key', 'name', 'published', 'recipe', 'site', 'sourceId', 'tries', 'url']);
  check('…with one try on the clock', item.tries, 1);
  check('…flagged recipe:false', item.recipe, false);
  check('…named from the feed', item.name, 'A Newsletter Post');

  // ── A whole run, twice ─────────────────────────────────────────────────
  console.log('run');
  const dir = freshDir();
  const pages = { 'https://example.com/feed/': RSS, 'https://example.com/chili/': JSONLD_PAGE };
  const first = await X.run({ dir, net: stubNet(pages), now: NOW });
  check('first run adds every post', first.added, 3);
  check('…two of them readable', first.readable, 2);
  check('…writing a month file per publish month plus the manifest',
    first.written.sort(), ['2026-09.json', '2026-10.json', 'manifest.json']);
  const oct = JSON.parse(fs.readFileSync(path.join(dir, '2026-10.json'), 'utf8'));
  check('month file is newest first', oct.items.map((i) => i.name), ['One Pot Lemon Orzo', 'A Newsletter Post']);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  check('manifest lists months newest first', manifest.months, ['2026-10', '2026-09']);
  check('manifest counts only readable recipes', manifest.counts, { '2026-10': 1, '2026-09': 1 });
  check('manifest knows the source count', manifest.sources, 1);

  const again = stubNet(pages);
  const second = await X.run({ dir, net: again, now: new Date('2026-10-19T13:00:00Z') });
  check('second run adds nothing', second.added, 0);
  check('…re-reads only the unreadable post', second.retried, 1);
  check('…never a readable page again', again.calls.filter((u) => u.indexOf('chili') !== -1), []);
  check('…and rewrites only the month holding the retried post', second.written, ['2026-10.json']);
  let newsletter = JSON.parse(fs.readFileSync(path.join(dir, '2026-10.json'), 'utf8')).items.find((i) => i.name === 'A Newsletter Post');
  check('…which now has two tries on the clock', newsletter.tries, 2);

  const settledRun = await X.run({ dir, net: stubNet(pages), now: new Date('2026-10-20T13:00:00Z') });
  check('third run is its last try', settledRun.retried, 1);
  const quiet = stubNet(pages);
  const fourth = await X.run({ dir, net: quiet, now: new Date('2026-10-21T13:00:00Z') });
  check('after MAX_TRIES it is left alone', fourth.retried, 0);
  check('…fetching only the feed', quiet.calls, ['https://example.com/feed/']);
  check('…and writing nothing, not even the manifest', fourth.written, []);

  // A post that wouldn't read on a bad day reads fine the next.
  const flaky = freshDir();
  await X.run({ dir: flaky, net: stubNet({ 'https://example.com/feed/': RSS }), now: NOW });
  let chili = JSON.parse(fs.readFileSync(path.join(flaky, '2026-09.json'), 'utf8')).items[0];
  check('a page that was down is recorded unreadable', chili.recipe, false);
  const recovered = await X.run({ dir: flaky, net: stubNet(pages), now: new Date('2026-10-19T13:00:00Z') });
  check('…and becomes a recipe when the page is back', recovered.readable, 1);
  chili = JSON.parse(fs.readFileSync(path.join(flaky, '2026-09.json'), 'utf8')).items[0];
  check('…in place, keeping its date', [chili.recipe, chili.published, chili.ingredients.length], [true, '2026-09-30T09:00:00.000Z', 3]);
  check('…and the manifest counts it', JSON.parse(fs.readFileSync(path.join(flaky, 'manifest.json'), 'utf8')).counts['2026-09'], 1);
  fs.rmSync(flaky, { recursive: true, force: true });

  // A new post next day lands in its month without disturbing the others.
  const RSS2 = RSS.replace('</channel>',
    '<item><title>New Tacos</title><link>https://example.com/tacos/</link>' +
    '<pubDate>Mon, 19 Oct 2026 09:00:00 +0000</pubDate>' +
    '<content:encoded><![CDATA[' + WPRM_CARD.replace('One Pot Lemon Orzo', 'New Tacos') + ']]></content:encoded></item></channel>');
  const third = await X.run({ dir, net: stubNet(Object.assign({}, pages, { 'https://example.com/feed/': RSS2 })), now: new Date('2026-10-22T13:00:00Z') });
  check('a new post is added', third.added, 1);
  check('…touching only its month and the manifest', third.written.sort(), ['2026-10.json', 'manifest.json']);
  const oct2 = JSON.parse(fs.readFileSync(path.join(dir, '2026-10.json'), 'utf8'));
  check('…and it sorts to the top', oct2.items[0].name, 'New Tacos');

  // A feed that fails leaves the store alone.
  const broken = await X.run({ dir, net: stubNet({}), now: new Date('2026-10-20T13:00:00Z') });
  check('an unavailable feed adds nothing', broken.added, 0);
  check('…and writes nothing', broken.written, []);
  check('…but says so', broken.perSource.test.error, 'feed unavailable');

  fs.rmSync(dir, { recursive: true, force: true });

  if (failed) { console.log('\n' + failed + ' failed'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(1); });

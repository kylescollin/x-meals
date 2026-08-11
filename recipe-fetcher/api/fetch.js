/* Fox & Bear Kitchen — recipe page fetcher.

   Why this exists: the Kitchen is a static site on GitHub Pages, and a browser
   is not allowed to fetch another site's HTML directly. Public CORS relays can
   do it, but the big recipe sites (Allrecipes, Serious Eats, NYT Cooking)
   refuse them outright, so imports failed on exactly the pages worth importing.

   This is the whole workaround: fetch the page like a browser would and hand
   the HTML back with a CORS header on it. It does NOT understand recipes —
   all the recipe parsing lives in recipe-import.js on the client, so there is
   only ever one parser to reason about. The only thing done here is stripping
   the page down (styles, scripts, SVG, comments) so a 700 KB article becomes a
   ~50 KB payload over a phone connection.

   Deployed separately from the Kitchen. If it is ever down, the client falls
   back to public relays and then to pasting the recipe text by hand — an
   import gets slower, nothing breaks.
*/

// Only the Kitchen may use this — it is not an open proxy for the internet.
const ALLOWED_ORIGINS = [
  'https://kylescollin.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000'
];

const MAX_BYTES = 3 * 1024 * 1024;   // stop reading a page after 3 MB
const TIMEOUT_MS = 15000;

// Pretend to be Safari. Plenty of recipe sites serve a bare error page to
// anything that looks automated, and the recipe data we want is in the normal
// page a person would see.
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
                '(KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

// Block anything pointed at a private network. This server can reach hosts a
// stranger can't, so a URL is not automatically safe just because it parses.
function isPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') ||
      h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
    if (a === 169 && b === 254) return true;          // cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

// Drop everything that isn't text or structured data. The one exception is
// ld+json — that's the block holding the recipe — so scripts are filtered on
// their attributes rather than removed wholesale, and ld+json is left exactly
// where it sits. Note the attribute may be unquoted (`type=application/ld+json`)
// on minified pages, which is why this doesn't insist on quotes.
function shrink(html) {
  return html
    .replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi,
             (tag, attrs) => (/ld\+json/i.test(attrs) ? tag : ''))
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowed = ALLOWED_ORIGINS.includes(origin);
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'public, max-age=600');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // A browser request carries an Origin; a stranger with curl generally
  // doesn't. Not airtight, but enough to keep this from becoming a free proxy.
  if (origin && !allowed) return res.status(403).json({ error: 'origin not allowed' });

  const raw = req.query && req.query.url;
  if (!raw) return res.status(400).json({ error: 'missing url' });

  let target;
  try {
    target = new URL(Array.isArray(raw) ? raw[0] : raw);
  } catch {
    return res.status(400).json({ error: 'not a valid link' });
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return res.status(400).json({ error: 'only http and https links' });
  }
  if (isPrivateHost(target.hostname)) {
    return res.status(400).json({ error: 'that address is not reachable' });
  }

  const stop = AbortSignal.timeout(TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(target.href, {
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      signal: stop
    });
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return res.status(504).json({ error: timedOut ? 'the page took too long' : 'could not reach the page' });
  }

  if (!upstream.ok) {
    return res.status(502).json({ error: 'the site returned ' + upstream.status, status: upstream.status });
  }

  const type = upstream.headers.get('content-type') || '';
  if (type && !/text\/html|application\/xhtml|text\/plain|application\/json/i.test(type)) {
    return res.status(415).json({ error: 'that link is not a web page' });
  }

  const buf = await upstream.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) {
    return res.status(413).json({ error: 'that page is too large to read' });
  }
  const html = new TextDecoder('utf-8').decode(buf);

  return res.status(200).json({
    ok: true,
    finalUrl: upstream.url || target.href,
    html: shrink(html)
  });
}

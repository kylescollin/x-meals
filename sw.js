/* Fox & Bear Kitchen — service worker.

   Purpose: make the site work as a real standalone app on the iPhone home
   screen, including a graceful offline fallback. It is deliberately small and
   conservative.

   Caching strategy:
   - HTML, CSS, JS, JSON  → network-first (cache is only a fallback).
   - Images / icons       → cache-first (they never change without a new name).
   - Anything cross-origin (Firebase, Google Fonts, Pexels) → not touched at
     all; those always go straight to the network.

   Why network-first for CSS/JS instead of cache-first: this project has no
   build step, so filenames never change when their contents do. Serving JS
   from cache first would mean a fresh index.html could load a stale
   recipe-card.js. Network-first keeps everything in lockstep and still works
   offline. These files are small, and the site already fetched them on every
   load before the service worker existed, so nothing got slower.

   IMPORTANT: bump CACHE_VERSION whenever you want to guarantee every device
   throws away its old copies. Normal pushes do NOT require it — network-first
   already picks up changes immediately.
*/

const CACHE_VERSION = 'fbk-v7';
const CACHE_NAME = 'fox-bear-kitchen-' + CACHE_VERSION;

// The app shell: everything needed to render a page with no network.
const SHELL = [
  './',
  './index.html',
  './groceries.html',
  './recipes.html',
  './journal.html',
  './login.html',
  './theme.css',
  './nav.js',
  './icons.js',
  './ingredient-format.js',
  './week-utils.js',
  './week-store.js',
  './recipe-card.js',
  './recipe-import.js',
  './grocery-sheet.js',
  './auth.js',
  './pwa.js',
  './manifest.json',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png'
];

const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|ico|avif)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // addAll() fails the whole install if any single file 404s, so add them
    // individually and tolerate misses.
    await Promise.all(SHELL.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
    ));
    // Don't sit in "waiting" — take over as soon as we're ready.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith('fox-bear-kitchen-') && k !== CACHE_NAME)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// Lets the page tell a waiting worker to activate immediately (see pwa.js).
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Pages are now reached with a ?week= or ?view= query string, but the HTML is
// identical whichever week you asked for — the week is fetched at runtime. So
// cache navigations under the bare path, or every week you visit would store
// its own copy of the same document.
function cacheKeyFor(request) {
  if (request.mode !== 'navigate') return request;
  const url = new URL(request.url);
  return new Request(url.origin + url.pathname, { method: 'GET' });
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const key = cacheKeyFor(request);
  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type === 'basic') {
      cache.put(key, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(key);
    if (cached) return cached;
    // Offline and never seen this page: fall back to the shell entry point.
    if (request.mode === 'navigate') {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.status === 200 && response.type === 'basic') {
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only ever handle plain same-origin GETs. Everything else — Firebase auth,
  // the Realtime Database, Google Fonts, Pexels, and every POST/PUT — is left
  // completely alone.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (IMAGE_EXT.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(request));
  }
});

// ═══════════════════════════════════════════════════════════
//  sw.js — App-shell caching for offline install
//
//  Strategy:
//   · Same-origin app files (html/css/js) → cache-first, so the
//     app still opens with no signal (e.g. basement/back office).
//   · Everything else (Firebase, CDN libraries, API calls) →
//     network only, untouched. Real-time data always needs a
//     live connection; db.js already falls back to localStorage
//     when Firebase is unreachable, so we don't duplicate that
//     here.
//
//  Bump CACHE_NAME whenever you ship changed app files so old
//  clients pick up the new version instead of a stale cache.
// ═══════════════════════════════════════════════════════════

const CACHE_NAME = 'ibis-ops-shell-v1';

const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './db.js',
  './state.js',
  './utils.js',
  './natguess.js',
  './departures.js',
  './arrivals-purpose.js',
  './shifts.js',
  './checklist.js',
  './reports.js',
  './arr-dep-xref.js',
  './tourism-tax.js',
  './arrivals-proc.js',
  './noshow.js',
  './guest-memory.js',
  './auth.js',
  './global-search.js',
  './handover.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_FILES))
      .catch(err => console.warn('[SW] shell cache failed:', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin GET requests for the app shell.
  // Firebase, Google APIs, CDN scripts, and anything cross-origin
  // pass straight through to the network untouched.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req)
        .then(res => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      // Cache-first for instant offline loads; refresh cache in background.
      return cached || network;
    })
  );
});

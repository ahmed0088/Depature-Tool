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

const CACHE_NAME = 'ibis-ops-shell-v178';

const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './firebase-config.js',
  './hotel-settings.js',
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
  './inhouse-tally.js',
  './package-audit.js',
  './trends.js',
  './td-audit.js',
  './dtcm-core.js',
  './dtcm-recon.js',
  './dtcm-longstay.js',
  './dtcm.js',
  './guest-memory.js',
  './neorcha-scraper.js',
  './auth.js',
  './global-search.js',
  './handover.js',
  './accor-standards.js',
  './guest-pipeline.js',
  './home.js',
  './month-end.js',
  './file-router.js',
  './whats-new.js',
  './history.js',
  './install-prompt.js',
  './brain.js',
  './brain-live.js',
  './brain-agent.js',
  './brain-smart.js',
  './nat-extra.js',
  './brain-goto.js',
  './learn.js',
  './roster.js',
  './roster-ocr.js',
  './roster-image.js',
  './roster-build.js',
  './roster-team.js',
  './brain-complete.js',
  './smart-fill.js',
  './brain-online.js',
  './wakeup.js',
  './brain-expert.js',
  './brand.js',
  './settings.js',
  './tenant.js',
  './pro.css',
  './themes.css',
  './scripts/neorcha-extractor.js',
  './scripts/all-enroll.js',
  './skip-clean.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_FILES.map(u => new Request(u, { cache: 'reload' }))))   // fresh from the server, never the browser's old copy
      // no catch: if a file can't be fetched the update waits for next time, and the old version keeps working offline
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

  // "?panel=roster", "?v=…" open the app page itself; "sw.js?x=…" checks are never kept
  const nav = req.mode === 'navigate', keep = !url.search;
  event.respondWith(
    caches.match(req, { ignoreSearch: nav }).then(cached => {
      const network = fetch(req)
        .then(res => {
          if (res && res.ok && keep) {
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

// A "new roster" notification: tap opens HotelOps on the Roster page
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const panel = (event.notification.data && event.notification.data.panel) || '';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list.find(w => 'focus' in w);
    if (c) { c.postMessage({ panel }); return c.focus(); }
    return self.clients.openWindow('./' + (panel ? '?panel=' + panel : ''));
  }));
});

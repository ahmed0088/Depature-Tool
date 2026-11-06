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

const CACHE_NAME = 'ibis-ops-shell-v548';

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
  './hotel-setup.js',
  './face-login.js',
  './wa-guard.js',
  './wa-helper.js',
  './shift-alerts.js',
  './notify-hub.js',
  './words-page.js',
  './opera-folder.js',
  './guest-messages.js',
  './voice.js',
  './guest-autofill.js',
  './report-center.js',
  './style-sounds.js',
  './db.js',
  './state.js',
  './utils.js',
  './natguess.js',
  './departures.js',
  './arrivals-purpose.js',
  './shifts.js',
  './shift-links.js',
  './monthly-reports.js',
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
  './role-rules.js',
  './global-search.js',
  './handover.js',
  './morning-brief.js',
  './roster-asks.js',
  './roster-fair.js',
  './ops-logs.js',
  './security.js',
  './enter-save.js',
  './my-upsells.js',
  './undo.js',
  './wa-bridge.js',
  './wa-brain.js',
  './handover-book.js',
  './tools/hotelops-whatsapp.console.js',
  './tools/hotelops-opera.console.js',
  './opera-bridge.js',
  './motion.js',
  './qr-maker.js',
  './gym.js',
  './inhouse.js',
  './room-card.js',
  './room-health.js',
  './nav-order.js',
  './standards-quiz.js',
  './accor-standards.js',
  './guest-pipeline.js',
  './found-web.js',
  './stratum-fx.js',
  './run-dock.js',
  './start-day.js',
  './nav-finder.js',
  './shift-report.js',
  './page-settings.js',
  './team-chat.js',
  './home.js',
  './month-end.js',
  './file-router.js',
  './whats-new.js',
  './whats-new-archive.js',
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
  './roster-health.js',
  './roster-holidays.js',
  './roster-events.js',
  './team-log.js',
  './roster-vacation.js',
  './roster-rules.js',
  './roster-live.js',
  './roster-game.js',
  './roster-worker.js',
  './rates.js',
  './brain-complete.js',
  './brain-understand.js',
  './smart-fill.js',
  './brain-online.js',
  './wakeup.js',
  './roster-swap.js',
  './brain-expert.js',
  './brand.js',
  './i18n.js',
  './settings.js',
  './tenant.js',
  './pro.css',
  './themes.css',
  './login.css',
  './forms.css',
  './themes-pro.css',
  './scripts/neorcha-extractor.js',
  './scripts/all-enroll.js',
  './skip-clean.js',
  './dtcm-fill.js',
  './neorcha.js',
];

const SHELL_URLS = new Set(SHELL_FILES.map(u => new URL(u, self.location.href).href));

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // fresh from the server, never an old copy: "?sw=<version>" also gets past GitHub Pages' own cache (it can hand out a
      // file from before the update for ~10 minutes — the new page with an old script then broke a button). Kept under the plain name.
      .then(cache => Promise.all(SHELL_FILES.map(u => {
        const bust = u + (u.includes('?') ? '&' : '?') + 'sw=' + CACHE_NAME;
        return fetch(new Request(bust, { cache: 'reload' })).then(res => { if (!res || !res.ok) throw new Error('could not fetch ' + u); return cache.put(u, res); });
      })))
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
  // The Firebase SDK files (fixed version in the URL) are kept too, so the app can open with no signal
  if (req.method === 'GET' && url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) { const c = res.clone(); caches.open(CACHE_NAME).then(x => x.put(req, c)); }
      return res;
    })));
    return;
  }
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // "?panel=roster", "?v=…" open the app page itself; "sw.js?x=…" checks are never kept
  const nav = req.mode === 'navigate', keep = !url.search;
  // A file of this version's app (precached at install): it only changes with a new version, which installs
  // fresh copies of all of them. So it comes from the cache with no download at all — before, each open fetched
  // ~115 files again in the background (slow hotel wifi, phone data).
  if (!nav && keep && SHELL_URLS.has(url.href)) {
    // not in the cache (cleared): ask the server, never the browser's own copy (GitHub lets it keep files 10 minutes — an old stylesheet came back)
    event.respondWith(caches.match(req).then(hit => hit || fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
      if (res && res.ok) { const c = res.clone(); caches.open(CACHE_NAME).then(x => x.put(req, c)); }
      return res;
    })));
    return;
  }
  event.respondWith(
    caches.match(req, { ignoreSearch: nav }).then(cached => {
      const network = (nav ? fetch(req) : fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }))
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

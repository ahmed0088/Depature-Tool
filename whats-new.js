// ═══════════════════════════════════════════════════════════
//  whats-new.js — "What's new" after an update
//  The first time the app opens on a new version it shows, in plain
//  words, what changed since the version this browser last saw. Shown
//  once per version; the ✨ button opens it again any time.
//
//  When you ship: add one entry at the TOP of WHATS_NEW for the new
//  version (same number as APP_VERSION). Small fixes can share a line.
// ═══════════════════════════════════════════════════════════

const WHATS_NEW = [
  { v: 120, items: [
    '🏨 The name is written as one word: HotelOps.',
  ] },
  { v: 119, items: [
    '🏨 The app is now called HotelOps, with its own logo and app icon. Your hotel\'s name shows under it; tap it to change.',
    '✨ New look: cleaner fonts, line icons in the menus, a search box in the top bar (Ctrl K), sharper cards, buttons and numbers, and a new sign-in screen. The three themes are still there.',
    '📲 On phones, add it to the home screen again to get the new icon.',
  ] },
  { v: 118, items: [
    '🤖 Ops Brain is now your agent: tell it what to do in 🧠, e.g. "fix everything", "brief me", "check out 512", "512 late", "who owes", "late checkouts", "guess nationalities", "remove duplicates", "copy arrivals to purpose", "set TD rate to 15", "month end report", "history 512". Type "what can you do" for the full list.',
    '🌍 The Nationality report fixes itself: a country spelling it doesn\'t know (Phillipines, Kazakstan…) is mapped to the right row and the report runs again. If it isn\'t sure, it asks with the 3 closest rows and remembers your answer for the team. Türkiye, KSA, Holland, UK and other modern names are known now.',
    '🤖 Autopilot (switch at the top of 🧠): it fixes safe things by itself (duplicates, nationality guesses, country names, copying arrivals to Purpose) and tells you, with Undo.',
  ] },
  { v: 117, items: [
    '🧠 Ops Brain is awake: it watches the app all the time and speaks up in a bubble next to 🧠, with a button that does the job (guess nationalities, remove duplicate arrivals, copy arrivals to Purpose, update the app…). Then it tells you what it did.',
    '📚 It learns from your corrections: type a nationality once and it guesses that surname right next time, for the whole team.',
    '🙊 "Don\'t suggest this" turns an idea off; ideas you use come first.',
    '🩹 Self-healing: if a page breaks, it rebuilds the page straight away and keeps the details ready to send to the developer.',
  ] },
  { v: 116, items: [
    '🧠 Ops Brain (bottom-right button, Ctrl+J): suggests what to do next from what is loaded and from your own routine, answers questions (room 512, how do I post TD…), and learns. 👍 / 👎 an answer, or teach it a new one for the whole team.',
    '🩺 Health check inside Ops Brain: finds a waiting update, damaged saved data and page errors, and repairs them with one tap.',
    '🛠 Fix requests: write what is wrong or what you want changed (or type "fix: …"). Send it on GitHub and the developer fixes the code.',
    '📱 Phone: Purpose of Stay and Arrivals are a compact list, one line per guest showing what is missing. Tap the B / L / F button to change purpose, tap the line to edit.',
  ] },
  { v: 115, items: [
    '📱 Phone: Arrivals shows one card per guest (big fields, one-tap Business / Leisure / Flight). Empty email or nationality is outlined.',
    '📱 Phone: the DTCM gap summary fits the screen. The explanation sits under each line.',
    '📲 Add to home screen: phones get a one-time prompt to install the app (iPhone shows the two taps). It is also under More → Install app.',
  ] },
  { v: 114, items: [
    '✨ This window: after every update the app tells you what changed.',
    '🕘 History page: who did what and when, for the whole team. Search by name, room or page.',
  ] },
  { v: 113, items: [
    '📥 Drop any report anywhere: drag a DTCM XML, Opera journal, nationality or rent report, or a PDF onto the app. It opens the right page and loads the file. If it can\'t tell, it asks.',
  ] },
  { v: 112, items: [
    '🗂 DTCM month-end report: totals, every correction and where to make it, with signature lines. Print or save as PDF.',
    '💰 Package commission report per seller (PDF or Excel), with pinned decisions and the deny list.',
  ] },
  { v: 111, items: [
    '🏠 Home page: one screen with what is still open on every page. Tap a tile to go there.',
  ] },
  { v: 110, items: [
    '🧪 Automatic checks: every update is tested against real (anonymised) DTCM and Opera reports before it goes live.',
  ] },
  { v: 109, items: [
    '🎁 Package Audit: a package billed night by night shows as one line per confirmation. Tap it to see the nights.',
    '✍️ Manual sale pin for packages added by hand in IN-Gauge (e.g. 6 pm late checkout).',
    '📌 Pin a package to its real seller, or skip it. Saved for the whole team.',
  ] },
  { v: 104, items: [
    '⚙️ Hotel TD settings: set your Opera TD code, the rate (7 / 10 / 15 / 20 AED), night cap and audit time.',
    '📱 Phone: faster menu, page search in More, cards instead of wide tables.',
  ] },
];

const WN_KEY = 'whats_new_seen_v1';
const _wnNum = v => parseInt(String(v || '').replace(/\D/g, ''), 10) || 0;

function wnEntriesSince(seen) {
  return WHATS_NEW.filter(e => e.v > seen);
}

function wnOpen(all) {
  let seen = 0;
  try { seen = _wnNum(localStorage.getItem(WN_KEY)); } catch (_) {}
  const list = all ? WHATS_NEW : wnEntriesSince(seen);
  if (!list.length) return false;
  document.getElementById('wnModal')?.remove();
  const m = document.createElement('div');
  m.id = 'wnModal';
  m.className = 'fr-overlay';
  m.innerHTML = `
    <div class="fr-sheet wn-sheet" role="dialog" aria-label="What's new">
      <div class="fr-h">✨ What's new</div>
      <div class="fr-file">You are on ${escapeHtml(APP_VERSION)}</div>
      ${list.map(e => `<div class="wn-ver">v${e.v}</div><ul class="wn-list">${e.items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`).join('')}
      ${all ? '' : '<button class="btn ghost wn-all" style="width:100%;margin-bottom:6px;">Show older updates</button>'}
      <button class="btn gold fr-cancel">Got it</button>
    </div>`;
  m.addEventListener('click', e => {
    if (e.target.closest('.wn-all')) { wnOpen(true); return; }
    if (e.target === m || e.target.closest('.fr-cancel')) m.remove();
  });
  document.body.appendChild(m);
  try { localStorage.setItem(WN_KEY, APP_VERSION); } catch (_) {}
  return true;
}

document.addEventListener('DOMContentLoaded', () => {
  let seen = null;
  try { seen = localStorage.getItem(WN_KEY); } catch (_) {}
  if (seen === null) {
    // never seen this window: someone already using the app gets the recent
    // updates once; a brand-new browser just starts counting from now
    let used = false;
    try { used = localStorage.length > 3; } catch (_) {}
    seen = used ? 'v110' : APP_VERSION;
    try { localStorage.setItem(WN_KEY, seen); } catch (_) {}
  }
  if (_wnNum(seen) >= _wnNum(APP_VERSION)) return;
  // wait until the person is signed in and the app is on screen
  const t = setInterval(() => {
    const app = document.getElementById('appWrapper');
    if (app && app.style.display !== 'none') { clearInterval(t); setTimeout(() => wnOpen(false), 1500); }
  }, 1000);
});

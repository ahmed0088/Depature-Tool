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
  { v: 139, items: [
    '🎨 Design check of every page on phone and desktop: Guest Memory now has the same header as the other pages; "Choose file" buttons match the app instead of the browser\'s grey ones; History filters are readable (no more "Ev" / "La"); Shift Tasks give the task name more room; the button row under each page title scrolls edge to edge instead of sticking out; search boxes and upload rows stay inside their cards, even with Extra large text.',
  ] },
  { v: 138, items: [
    '📱 Settings on the phone: choice buttons such as "Sign out when idle" and "Text size" now fit inside the card and wrap to a second line when needed, even with large text.',
  ] },
  { v: 137, items: [
    '🧠 Ops Brain works with you like a colleague: "plan my shift" (your jobs in order with live status, and it greets each new shift once with the plan), "remind me at 03:00 to call 512" or "in 20 min", "wake up 512 at 6:30" (everyone on shift is alerted), "note 512 wants a late check-out at 2pm" (shared notes) and "write the handover" (drafted from the shift, notes and what is still open).',
    '🎓 It knows the front office: check-in and check-out, pre-authorisations, OTA virtual cards, declined cards, wrong charges, no-shows, walking a guest, complaints, VIPs, privacy, keys, lost and found, emergencies, Opera tips and night audit. Ask in plain words; your hotel\'s SOP always wins.',
    '🙊 A suggestion you have acted on rests for 30 minutes instead of popping up again.',
  ] },
  { v: 136, items: [
    '📱 Tables on the phone: when you swipe sideways, the pinned room column stays solid, so room numbers no longer float over the guest names. On Purpose of Stay the Room column is the one that stays pinned (not the day), and the header lines up too. Fixed on every table that pins a column.',
  ] },
  { v: 135, items: [
    '🎯 Ops Brain takes you to the exact line: tapping a suggestion, a bubble\'s Show me, a search hit or a line in a data answer opens the page, clears filters that would hide it, scrolls to the row or card and highlights it (and puts the cursor in the empty box). When several lines have the problem, a bar at the bottom steps through them: 1 of 3 ▲ ▼.',
  ] },
  { v: 134, items: [
    '🌍 Nationality report: the sheet always keeps its 240 rows. A country Opera spells differently goes into one of those rows: the closest rows are offered first with their row number, or pick from all 240, or count it as unknown nationality. Your choice is remembered for the team. Adding new rows is gone, and any rows added before were removed.',
  ] },
  { v: 133, items: [
    '🌍 Nationality report: a country you add now goes to its place in the sheet, alphabetically like the government sheet, not at the bottom. It shows the exact Excel row to insert (e.g. "row 211, under South Sudan, above Spain"), and you can move it under another country if your sheet differs. Copy for Excel pastes straight in, and the row counts update to match.',
  ] },
  { v: 132, items: [
    '🎓 Learn HotelOps: a guide for anyone new (menu → System → Learn HotelOps, or the card on Home). Start here (6 basics), your shift step by step (morning, afternoon, night), and a short lesson for every page: what it is for, which Opera report it needs, the steps and tips.',
    '👉 "Show me" opens the page and points at the exact place. Tick "I\'ve learned this" to track your progress; owners and managers see the whole team\'s progress. 🖨 Print guide makes a handout for a new colleague. Ops Brain answers from the guide too.',
  ] },
  { v: 131, items: [
    '🌍 Nationality report: a country Opera sends that your Excel has no row for is fixed in one tap. ➕ Add as new row puts it at the bottom of the report and tells you which Excel row to type it in (once). Or put it into an existing row: the closest matches are first, and there is a list of every row. Both are remembered for your hotel, so next month it is placed by itself.',
  ] },
  { v: 130, items: [
    '🧠 Guest Memory saves by itself: whatever you load, import or edit on Arrivals and Purpose of Stay goes into Guest Memory 2 minutes after your last change. Clearing a page always saves its guests first, so the daily clear never loses anyone.',
    '⏰ Shift tasks start fresh by themselves: each new morning (07:00), afternoon (15:00) and night (23:00) shift begins with nothing ticked, once for the whole team. The shift that just ended keeps its ticks for handover. Turn it off in ⚙️ Settings → Helpers.',
  ] },
  { v: 129, items: [
    '📧 After Import Emails, the guests go into Guest Memory by themselves: HotelOps waits 2 minutes so you can fix a wrong email, then saves. Tap 🧠 Save to Memory to save right away. Leaving the page or the app before then saves straight away, so nothing is lost.',
  ] },
  { v: 128, items: [
    '🧠 Guest Memory is now shared by all hotels: a returning guest seen at any of your hotels has their nationality, email and purpose filled in at the others. Each hotel\'s existing memory was merged in, nothing lost. Everything else stays separate per hotel, and each hotel keeps its own Guest Memory password.',
    '🔒 Clearing all of Guest Memory now empties it for every hotel, so only an owner can do it, after typing CLEAR.',
  ] },
  { v: 127, items: [
    '🧠 Ops Brain reads your data: ask "how many arrivals from France", "who has no email", "french guests", "guests staying more than 5 nights", "nationality breakdown", "arrivals by source", "average nights", "rooms that owe money", "who checked out". Each answer has the list and a Copy for Excel button.',
    '🧠 It understands typos ("arivals without natonality"), remembers the room you just asked about ("room 513" then "check it out" or "what about 512?"), and does several jobs in one line ("guess nationalities then remove duplicates and brief me").',
    '🧠 It notices more: Booking/Expedia relay emails, emails that can\'t be right, a nationality that doesn\'t fit the name, the same guest in two rooms, stays longer than the TD cap, and checked-out rooms that still owe money.',
    '🏨 Ops Brain\'s memory (habits, 👍/👎, turned-off suggestions) now stays with each hotel, so hotels never mix.',
  ] },
  { v: 126, items: [
    '🏨 More than one hotel: each hotel has its own separate space. People you add in Team management work in your hotel, and the app opens their hotel when they sign in.',
    '➕ Owners can add a new hotel in ⚙️ Settings → Hotel: its name, TD code and rate, and its owner\'s login. That owner then adds their own team. Nothing is shared between the hotels.',
    '📱 Phone: upload boxes stack instead of squeezing side by side (Package Audit, TD Audit), checklist notes use the full width, and page descriptions no longer run off the screen.',
  ] },
  { v: 125, items: [
    '📱 Phone polish: the top bar fits the screen (your role icon only, version moved to Settings), header buttons show their names in one swipeable row, Clear is a quiet outline button instead of a red box, and cards have inner spacing so buttons no longer touch the edges.',
  ] },
  { v: 124, items: [
    '⚙️ Settings, now complete:',
    '• Appearance: accent colour (gold, blue, green, teal, rose, purple), corners (rounded, soft, sharp), font, high contrast.',
    '• Top bar: show or hide the clock, connection, version, theme dots and your name. Date & time: 24 or 12-hour clock, seconds, greeting by name.',
    '• Alerts: late check-out alerts, a chime and desktop notifications for urgent things, phone vibration.',
    '• Departures: default card size. Privacy: a privacy screen that blurs guest names and emails until you point at them, and sign out after 15 min to 4 h without activity.',
    '• Sync: your settings follow you to every device you sign in on. Export or import settings as a file, storage meter, technical details and error log.',
  ] },
  { v: 123, items: [
    '📋 Purpose of Stay and Arrivals are a table again on every screen, restyled: the header stays on top while you scroll, rows are shaded in turns, the room number stands out, and boxes only show a border when you touch them. On a phone, swipe the table sideways.',
  ] },
  { v: 122, items: [
    '📋 Phone: Purpose of Stay and Arrivals are a plain list again. One thin line per guest under a Room · Guest · Missing · Purpose header, with small icons for a missing email, nationality or origin. Tap B / L / F to change purpose, or tap the line to edit.',
  ] },
  { v: 121, items: [
    '⚙️ Settings page (gear in the top bar, or More → Settings): theme, text size, compact mode, icons-only menu, animations; show or hide any page; choose the page HotelOps opens on; pick the Home tiles; switch Ops Brain, its bubbles and autopilot on or off; turn helpers off; hotel name and Tourism Dirham settings; backup, restore, health check and reset. Search settings by typing.',
  ] },
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
  if (typeof hoPref === 'function' && !hoPref('whatsNew')) { try { localStorage.setItem(WN_KEY, APP_VERSION); } catch (_) {} return; }
  // wait until the person is signed in and the app is on screen
  const t = setInterval(() => {
    const app = document.getElementById('appWrapper');
    if (app && app.style.display !== 'none') { clearInterval(t); setTimeout(() => wnOpen(false), 1500); }
  }, 1000);
});

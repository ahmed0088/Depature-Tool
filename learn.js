// ═══════════════════════════════════════════════════════════
//  learn.js — Learn HotelOps
//  A guide that teaches anyone the app: the basics, a typical shift
//  step by step, and one short lesson per page (what it's for, which
//  Opera report it needs, the steps, good to know). "Show me" opens the
//  page and points at the exact place. Each person ticks off what they
//  have learned; owners and managers see the team's progress.
// ═══════════════════════════════════════════════════════════

const LEARN_GROUPS = [
  { id: 'desk', name: 'Front desk, every day', icon: 'arrivals' },
  { id: 'night', name: 'Night audit', icon: 'audit' },
  { id: 'td', name: 'Tourism Dirham', icon: 'dtcm' },
  { id: 'money', name: 'Packages, reports & money', icon: 'package-audit' },
  { id: 'guests', name: 'Guests & loyalty', icon: 'pipeline' },
  { id: 'team', name: 'Team & the app', icon: 'settings' },
];

const LEARN_LESSONS = [
  // ── Start here ──
  { id: 'start-signin', start: true, icon: 'home', title: 'Sign in and find your way', show: '.sidenav, #mobNav',
    why: 'HotelOps is your hotel\'s front office in one place. Everything you load or tick is shared live with everyone on shift.',
    steps: ['Sign in with the email and password your manager gave you. Tick "Stay signed in" only on your own phone.', 'Home opens first: one tile per job, showing what is still open. Tap a tile to go there.', 'On a computer the menu is on the left. On a phone use the bar at the bottom, and More for every other page.'],
    tips: ['The green dot in the top bar means you are connected. Offline? Keep working: it saves on the device and sends when you are back.'] },
  { id: 'start-search', start: true, icon: 'search', title: 'Search everything', show: '#hoSearch, .topbar .icon-round[title^="Search"], #mobNav',
    why: 'One box finds a room, a guest, a checklist step or a page.',
    steps: ['Click the search box at the top, or press Ctrl K.', 'Type a room number (512), a guest name or a word like "passport".', 'Pick a result to jump straight there.'] },
  { id: 'start-drop', start: true, page: 'home', icon: 'open', title: 'Drop a report anywhere', show: '.home-drop, #homeTiles',
    why: 'You don\'t need to find the right page first.',
    steps: ['Download the report from Opera, DTCM or Vicas.', 'Drag the file onto HotelOps, on any page.', 'It recognises the report, opens the right page and loads it. If it can\'t tell, it asks.'] },
  { id: 'start-brain', start: true, icon: 'sparkle', title: 'Ops Brain, your assistant', show: '#brFab',
    why: 'It watches the app, tells you what needs doing and does the routine work when you tap.',
    steps: ['Tap 🧠 (bottom right) or press Ctrl J.', 'Read "What I\'d do next" and tap a line to go there.', 'Type what you want: "brief me", "who has no email", "check out 512", "fix everything". Type "what can you do" for the full list.', 'When a bubble appears next to 🧠, its button does the job, and every change it makes has Undo.'],
    tips: ['If an answer is wrong, tap 👎 and teach it the right one. The whole team gets it.'] },
  { id: 'start-settings', start: true, icon: 'settings', title: 'Make it yours', show: '.topbar .icon-round[title="Settings"]',
    why: 'Theme, text size, which pages you see, alerts and more.',
    steps: ['Open ⚙️ Settings from the top bar (More → Settings on a phone).', 'Pick a theme and text size that are easy on your eyes.', 'In Menu & pages, untick pages you never use. They can still be found with search.'],
    tips: ['Your look and menu are saved per device. Hotel settings (name, Tourism Dirham) are shared with the team.'] },
  { id: 'start-phone', start: true, icon: 'arrivals', title: 'Use it on your phone',
    why: 'The same app works on your phone, with the same data.',
    steps: ['Open HotelOps in your phone\'s browser and sign in.', 'Android: More → 📲 Install app. iPhone (Safari): Share ⬆︎ → Add to Home Screen.', 'It then opens full-screen like an app.'] },

  // ── Front desk ──
  { id: 'departures', group: 'desk', page: 'departures', icon: 'departures', title: 'Departures', show: '#depUploadCard',
    why: 'Follow every departing room until it is out, with late check-outs and balances in view.',
    need: 'Opera → Front Desk → Departures → Download as Delimited Data (departure_all_….txt)',
    steps: ['Paste the file\'s text or drop the file, then press ⚡ Load Report.', 'Each room becomes a card. Use its buttons for Out, Late check-out (with the time), No answer, DND or Extended.', 'Rooms that owe money and late check-outs past their time are flagged.'],
    tips: ['Ops Brain can do it for you: "check out 512", "512 late", "who owes".', 'The board saves by itself and colleagues see every change live.'] },
  { id: 'arrivals', group: 'desk', page: 'arrivals', icon: 'arrivals', title: 'Arrivals', show: '#panel-arrivals .card',
    why: 'Today\'s arrivals with nationality, email, purpose and source, ready for Purpose of Stay and ALL.',
    need: 'The Opera arrivals report (Excel or CSV), pasted or uploaded',
    steps: ['Paste the report and press ⚡ Load Pasted, or press 📂 Upload File.', 'Press ✦ Nationality to fill missing nationalities from the names (always check the passport).', 'Fill emails as guests check in; ⬇ Export when you need the list.'],
    tips: ['Guests go into Guest Memory by themselves, so returning guests are filled in next time, at any of your hotels.', 'Clear only after you\'re done: clearing saves everyone to Guest Memory first.'] },
  { id: 'xref', group: 'desk', page: 'xref', icon: 'xref', title: 'Arrivals vs Departures', show: '#panel-xref .card',
    why: 'A guest who is on both today\'s arrivals and departures has extended. This finds them.',
    need: 'The Departures board loaded first, plus the Opera arrivals report',
    steps: ['Load the Departures board.', 'Upload today\'s arrivals report here.', 'Press 🔗 Load & Check Extensions: each guest on both lists is shown.'] },
  { id: 'purpose', group: 'desk', page: 'purpose', icon: 'purpose', title: 'Purpose of Stay', show: '#panel-purpose .tbl-wrap',
    why: 'Business, leisure or flight crew, plus nationality, email and origin of travel for every guest, for the authorities and the hotel.',
    need: 'Arrivals loaded (copy them over), and the Vicas origin XML if you have it',
    steps: ['Press the copy-from-Arrivals button (or ask Ops Brain "copy arrivals to purpose").', 'Load the origin XML to fill origin of travel.', 'Set Business / Leisure / Flight for each guest. Use 📧 Import Emails to fill emails from the Neorcha list.'],
    tips: ['On a phone the table scrolls sideways.', 'After Import Emails, the guests go into Guest Memory by themselves after 2 minutes.'] },
  { id: 'shifts', group: 'desk', page: 'shifts', icon: 'shifts', title: 'Shift Tasks', show: '#panel-shifts',
    why: 'The fixed list of things every morning, afternoon and night shift must do.',
    steps: ['Open your shift\'s tab.', 'Tick each task when it is done.', 'Each new shift starts with nothing ticked, by itself. The shift that just ended keeps its ticks for handover.'] },
  { id: 'roster', group: 'team', page: 'roster', icon: 'roster', title: 'Roster', show: '#roMine',
    why: 'The team\'s shifts in one place, so nobody has to ask or open the roster file every week.',
    steps: ['Supervisors, managers and owners: press Add roster and choose the roster picture management sent (or drop it, or paste it). The AI reads it in about half a minute. Check the table against the picture, fix any cell marked in red, say what any unknown word means, and press Save roster. (From Excel: open "Or paste it from Excel".)', 'Everyone: the first time, choose your name under My shifts. From then on you see your next shift and the next 7 days, on Home too.', 'Today shows everyone\'s hours on a timeline, with a red line at the time now and a green dot for who is on shift. Use ‹ › for other weeks and 📷 Original picture to see what management sent.'],
    tips: ['Reading pictures needs AI reading set up once on the phone or PC that posts the roster (an Anthropic API key; a few cents per roster). Without it you can still post the picture for everyone to open.', 'When a roster is posted everyone sees NEW on Roster and gets a message; turn on 🔔 Alerts to get a phone or desktop notification too (while HotelOps is open or in the background).', 'Codes like M, A, N, OFF, AL, SL, PH and hours like 07-15 are understood by themselves. Add your hotel\'s own codes under Shift codes and times.', 'Something changed? Press Edit and type the new code in that day. Edit → Copy last week starts a new week from the last one.', 'Ask Ops Brain "my shifts" or "who is on tonight".'] },
  { id: 'handover', group: 'desk', icon: 'handover', title: 'Shift handover', show: '.topbar .icon-round[title="Shift Handover"], #mobNav',
    why: 'A ready-made note of what happened and what is still open, for the next shift.',
    steps: ['Press 📋 in the top bar (Shift Handover).', 'Pick the period and read the note.', 'Copy it into your handover message.'] },

  // ── Night ──
  { id: 'checklist', group: 'night', page: 'checklist', icon: 'checklist', title: 'Night Checklist', show: '#panel-checklist',
    why: 'Every night-audit step in order, so nothing is missed.',
    steps: ['Work from the top. Tick each step when done, and add a note where needed.', 'Skip a step that doesn\'t apply tonight.', 'Press ↺ New Night to start the next night\'s list.'] },
  { id: 'audit', group: 'night', page: 'audit', icon: 'audit', title: 'Night Audit · PM Rooms', show: '#panel-audit .card',
    why: 'Compares Opera\'s PM rooms with the management Excel and lists every difference.',
    need: 'Opera gipmbyroom (Delimited Data) and the management Excel',
    steps: ['Paste the Opera report in the first box and the Excel in the second.', 'Press 🔍 Compare.', 'Fix each listed room, then use Copy All Fixed Rows.'] },
  { id: 'immig', group: 'night', page: 'immig', icon: 'immig', title: 'Immigration Check', show: '#panel-immig .card',
    why: 'Finds guests missing what immigration needs (nationality, gender, passport, first name, email) and rooms with an unregistered guest.',
    need: 'The guest XML from Vicas',
    steps: ['Paste or upload the XML.', 'Press 🔍 Analyse.', 'Fix each guest in the group that tells you what is missing.'] },
  { id: 'inhouse', group: 'night', page: 'inhouse-tally', icon: 'inhouse-tally', title: 'Inhouse Tally', show: '#panel-inhouse-tally .card',
    why: 'Checks Opera and Vicas agree on who is in the hotel.',
    need: 'Opera Guest In-House By Room (gibyroom, tab-delimited) and the full Vicas in-house XML',
    steps: ['Load both files.', 'Press 🔍 Reconcile.', 'Only the rooms where the systems disagree are listed. Fix them.'],
    tips: ['Use the full in-house roster from Vicas, not "today\'s check-ins", or every long-stay room shows as missing.'] },
  { id: 'noshow', group: 'night', page: 'noshow', icon: 'noshow', title: 'No-Show Tracker', show: '#nsDropZone',
    why: 'Turns the NA40 no-show PDF into a list you paste into Excel.',
    need: 'Opera → Night Audit → Reports → NA40 No Shows → PDF',
    steps: ['Drop the PDF on the box (or click to pick it).', 'Check the list.', 'Press 📋 Copy for Excel and paste into your sheet.'] },

  // ── Tourism Dirham ──
  { id: 'dtcm', group: 'td', page: 'dtcm', icon: 'dtcm', title: 'DTCM Recon', show: '#dtcDrop',
    why: 'Makes DTCM and Opera agree on Tourism Dirham, item by item, so the month-end totals tally.',
    need: 'DTCM HotelTransactionReport_Dynamic.xml and Opera finjrnlbytrans_….txt (finjrnlbytax_….txt optional, for long stays)',
    steps: ['Drop the files (names are recognised by themselves) and press Analyze.', 'Read "How to close the gap": Step A explains the difference, Step B lists each item in order with the side to fix it on.', 'Add / Reverse = in Opera · Verify = check the reservation · DTCM = fix in the TD portal. Tick each item in To Do when done (ticks are shared).', 'At month end: 🗂 Month-end report (PDF), with signature lines.'],
    tips: ['A real day use is charged one night of TD in DTCM; post it by hand in Opera the same day.', 'Set your hotel\'s TD code and rate in ⚙️ Hotel TD settings (or Settings → Hotel).'] },
  { id: 'tourism', group: 'td', page: 'tourism', icon: 'tourism', title: 'Tourism Tax · TD Portal', show: '#panel-tourism .upload-zone, #panel-tourism textarea, #panel-tourism .page-hd',
    why: 'Finds rooms whose dates need correcting in the TD portal.',
    need: 'The Opera arrivals report (tab-delimited)',
    steps: ['Paste the report and press ⚡ Parse Report.', 'Rooms needing a date fix are listed.', 'Press 📋 Copy List and fix them in the portal.'] },
  { id: 'tdaudit', group: 'td', page: 'td-audit', icon: 'td-audit', title: 'TD 30-Day Audit', show: '#panel-td-audit .card',
    why: 'Finds guests still charged Tourism Dirham after the 30-night limit.',
    need: 'Opera Financial Transactions by Tax Type (finjrnlbytax), 60–90 days back, and the DTCM XML',
    steps: ['Load both files and press 🔍 Run Audit.', '🔴 Over-charged = real money charged after the cap: credit these.', '⚪ Zero-value postings need no credit.'],
    tips: ['Matching is by room number only.'] },

  // ── Money ──
  { id: 'packages', group: 'money', page: 'package-audit', icon: 'package-audit', title: 'Package Audit', show: '#panel-package-audit .card',
    why: 'Checks every upsell in IN-Gauge against Opera: what to credit, what to remove, and who really sold it.',
    need: 'IN-Gauge product list (Excel) + Opera Changes Log PDFs (Update Reservation and New Reservation) + optional Reservation Detail',
    steps: ['Upload the files and run the audit.', 'Work the lines: credit, deny or review.', 'Use the 📌 Pin column to give a package to the right seller, skip it, or mark a ✍️ Manual sale (e.g. a 6 pm late check-out added by hand). Pins are remembered for the team.', 'Month end: 💰 Commission report per seller (PDF or Excel).'] },
  { id: 'nationality', group: 'money', page: 'nationality', icon: 'nationality', title: 'Nationality Report', show: '#natInput',
    why: 'Fills your monthly Excel with guests per country.',
    need: 'Opera stat_countrybymon (Delimited Data, Nationality radio selected)',
    steps: ['Paste or drop the file and press ⚡ Process.', 'If Opera spells a country in a way the sheet doesn\'t know, pick which of the 240 rows it belongs in (closest first), or count it as unknown. Your choice is remembered.', 'Copy All Rows and paste into your sheet.'] },
  { id: 'rent', group: 'money', page: 'rent', icon: 'rent', title: 'Rented Rooms & Beds', show: '#panel-rent .card',
    why: 'Rooms and beds sold per day.',
    need: 'Opera history_forecast and statroomtype (Delimited Data)',
    steps: ['Put one file in each box.', 'Press ⚡ Process.'] },
  { id: 'arrproc', group: 'money', page: 'arrivals-proc', icon: 'arrivals-proc', title: 'Arrivals Processor', show: '#panel-arrivals-proc',
    why: 'Turns the Opera Cloud arrivals report into a day-by-day package breakdown.',
    steps: ['Import the report and press ⚡ Process.', 'Check the package codes, then ⬇ Export Excel.', '💾 Save Profile keeps your code settings.'] },
  { id: 'adagio', group: 'money', page: 'adagio', icon: 'adagio', title: 'Adagio Pro (long stays)', show: '#panel-adagio',
    why: 'Long-stay collections: balances, cheques and departure risk.',
    need: 'Your long-stay tracking sheet (.xlsx / .xls / .csv)',
    steps: ['Upload the sheet; columns are recognised by name.', 'Click a coloured card to see those guests.', '🔴 Danger needs action today. 🖨 PDF Report prints what is on screen.'] },
  { id: 'trends', group: 'money', page: 'trends', icon: 'trends', title: 'Trends', show: '#panel-trends',
    why: 'How the month is going, built from the reports you already run. Nothing to upload.' ,
    steps: ['Open it any time. Each day appears once its page has been run.'] },

  // ── Guests ──
  { id: 'pipeline', group: 'guests', page: 'pipeline', icon: 'pipeline', title: 'Guest Pipeline & ALL', show: '#panel-pipeline .card',
    why: 'The daily guest-email routine: Neorcha list → clean → Purpose of Stay and ALL enrollment.',
    steps: ['Copy the Neorcha Extractor script and run it on Neorcha (F12 → Console → paste → Enter).', 'Paste its list into the workbench: duplicates, OTA relay emails and typos are cleaned.', 'One button fills the emails into Purpose of Stay.', 'For ALL: tick Agreed only for guests who said yes, pick Mr/Ms, copy the list for the ALL Enroll script, then log the result.'] },
  { id: 'guestmem', group: 'guests', page: 'guestmem', icon: 'guestmem', title: 'Guest Memory', show: '#panel-guestmem',
    why: 'Remembers nationality, email and purpose of returning guests, at all your hotels.',
    steps: ['It fills itself from Arrivals and Purpose of Stay.', 'Open it to search, correct or delete a guest (it has its own password).'],
    tips: ['Only an owner can clear all of it, because it is shared by every hotel.'] },
  { id: 'standards', group: 'guests', page: 'standards', icon: 'standards', title: 'Accor Standards', show: '#stdSearchBox',
    why: 'Look things up on shift: ALL loyalty, ibis Styles brand, service culture, Tourism Dirham and guest registration.',
    steps: ['Type a word (upgrade, passport, gold…) in the search box.'] },

  // ── Team ──
  { id: 'history', group: 'team', page: 'history', icon: 'history', title: 'History', show: '#histSearch',
    why: 'Who did what and when, for the whole team.',
    steps: ['Search a name, room or confirmation.', 'Filter by person, page and period.', 'Copy for Excel if you need it.'] },
  { id: 'team', group: 'team', icon: 'team', title: 'Team management (owners & managers)', show: '#adminPanelBtn, #mobNav',
    why: 'Add colleagues and choose what each can open.',
    steps: ['Open 👥 Team Management in the top bar.', 'Create an account: name, email, a starting password and a role (Owner, Manager, Supervisor, Agent, Read only).', 'Everyone you add works in your hotel. Disable or delete an account when someone leaves.'] },
  { id: 'hotels', group: 'team', page: 'settings', icon: 'adagio', title: 'More than one hotel (owners)', show: '#hs-hotel',
    why: 'Each hotel has its own separate space; Guest Memory is shared between them.',
    steps: ['Settings → Hotel → Add a hotel: its name, TD code and rate, and its owner\'s login.', 'That owner signs in and adds their own team.'] },
  { id: 'fix', group: 'team', icon: 'feedback', title: 'Something wrong? Ask for a fix', show: '#brFab',
    why: 'Problems and ideas go straight to the developer.',
    steps: ['Open 🧠 → 🛠 Fix requests, or type "fix: what is wrong" in Ops Brain.', 'Save it, then Send on GitHub. Fixes arrive in ✨ What\'s new.', 'If a page looks broken, 🧠 → 🩺 Health repairs most problems in one tap.'] },
];

// A typical shift, in order (each step opens its lesson)
const LEARN_SHIFTS = [
  { key: 'morning', name: 'Morning', hours: '07:00 – 15:00', steps: [['shifts', 'Open your shift tasks'], ['departures', 'Load today\'s departures and follow each room out'], ['arrivals', 'Load today\'s arrivals'], ['xref', 'Check who extended'], ['handover', 'Handover to the afternoon']] },
  { key: 'afternoon', name: 'Afternoon', hours: '15:00 – 23:00', steps: [['shifts', 'Open your shift tasks'], ['arrivals', 'Check guests in: nationality and email'], ['purpose', 'Purpose of Stay for today\'s guests'], ['pipeline', 'Guest emails and ALL enrollment'], ['handover', 'Handover to the night']] },
  { key: 'night', name: 'Night', hours: '23:00 – 07:00', steps: [['checklist', 'Work the Night Checklist'], ['audit', 'PM rooms vs the management Excel'], ['immig', 'Immigration check'], ['inhouse', 'Opera vs Vicas in-house tally'], ['noshow', 'No-shows from NA40'], ['dtcm', 'DTCM vs Opera Tourism Dirham'], ['packages', 'Package Audit'], ['handover', 'Handover to the morning']] },
];

const LEARN_KEY = 'learn_done_v1';
let learnDone = (() => { try { return new Set(JSON.parse(localStorage.getItem(LEARN_KEY) || '[]')); } catch (_) { return new Set(); } })();
let learnQ = '';

function _lnSave() {
  try { localStorage.setItem(LEARN_KEY, JSON.stringify([...learnDone])); } catch (_) {}
  if (typeof fbSet === 'function' && typeof currentUser !== 'undefined' && currentUser) {
    fbSet('learn/' + currentUser.uid, { name: (currentProfile && currentProfile.name) || currentUser.email || '', done: [...learnDone], total: LEARN_LESSONS.length, at: new Date().toISOString() });
  }
}
function learnToggle(id, on) {
  if (on) learnDone.add(id); else learnDone.delete(id);
  _lnSave();
  learnRender();
}
const _lnIc = n => (typeof hoIcon === 'function' && hoIcon(n)) || '';
const _lnL = id => LEARN_LESSONS.find(l => l.id === id);

function _lnLesson(l) {
  const done = learnDone.has(l.id);
  return `<details class="ln-lesson ${done ? 'done' : ''}" id="ln-${l.id}" data-s="${escapeHtml((l.title + ' ' + l.why + ' ' + (l.need || '') + ' ' + (l.steps || []).join(' ') + ' ' + (l.tips || []).join(' ')).toLowerCase())}">
    <summary><span class="ln-ic">${_lnIc(l.icon)}</span><span class="ln-t"><b>${escapeHtml(l.title)}</b><small>${escapeHtml(l.why)}</small></span><span class="ln-check">${done ? '✓' : ''}</span></summary>
    <div class="ln-body">
      ${l.need ? `<div class="ln-need"><b>You need</b>${escapeHtml(l.need)}</div>` : ''}
      <ol class="ln-steps">${(l.steps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
      ${l.tips && l.tips.length ? `<div class="ln-tips">${l.tips.map(t => `<div>💡 ${escapeHtml(t)}</div>`).join('')}</div>` : ''}
      <div class="ln-acts">
        ${l.show || l.page ? `<button class="btn sm gold" onclick="learnShow('${l.id}')">👉 Show me</button>` : ''}
        <label class="ln-done"><input type="checkbox" ${done ? 'checked' : ''} onchange="learnToggle('${l.id}', this.checked)"> I've learned this</label>
      </div>
    </div>
  </details>`;
}

function learnRender() {
  const box = document.getElementById('learnBody');
  if (!box) return;
  const total = LEARN_LESSONS.length, n = LEARN_LESSONS.filter(l => learnDone.has(l.id)).length;
  const pb = document.getElementById('learnProgress');
  if (pb) pb.innerHTML = `<div class="ln-pbar"><i style="width:${Math.round(n / total * 100)}%"></i></div><span>${n} of ${total} lessons learned${n === total ? ' 🎉' : ''}</span>`;
  const h = new Date().getHours(), cur = h >= 23 || h < 7 ? 'night' : h < 15 ? 'morning' : 'afternoon';
  box.innerHTML = `
    <section class="ln-sec" id="ln-start"><h2>1 · Start here</h2><p>Six short lessons: everything else builds on these.</p>${LEARN_LESSONS.filter(l => l.start).map(_lnLesson).join('')}</section>
    <section class="ln-sec" id="ln-shift"><h2>2 · Your shift, step by step</h2><p>A typical shift in order. Tap a step to open its lesson. Your hotel's own order may differ: follow your Shift Tasks.</p>
      <div class="ln-shifts">${LEARN_SHIFTS.map(s => `<div class="ln-shiftcard ${s.key === cur ? 'now' : ''}"><div class="ln-sh-h"><b>${s.name}</b><small>${s.hours}${s.key === cur ? ' · now' : ''}</small></div>
        <ol>${s.steps.map(([id, t]) => `<li><a href="#" onclick="learnOpen('${id}');return false;">${escapeHtml(t)}</a>${learnDone.has(id) ? ' <span class="ln-mini">✓</span>' : ''}</li>`).join('')}</ol></div>`).join('')}</div></section>
    <section class="ln-sec" id="ln-pages"><h2>3 · Every page</h2><p>What each page is for, the report it needs and the steps.</p>
      ${LEARN_GROUPS.map(g => { const ls = LEARN_LESSONS.filter(l => l.group === g.id); return ls.length ? `<h3><span class="ln-ic">${_lnIc(g.icon)}</span>${escapeHtml(g.name)}</h3>${ls.map(_lnLesson).join('')}` : ''; }).join('')}
    </section>
    <section class="ln-sec" id="ln-teamprog"></section>`;
  learnFilter(learnQ);
  learnTeam();
}

function learnFilter(q) {
  learnQ = String(q || '').trim().toLowerCase();
  document.querySelectorAll('#learnBody .ln-lesson').forEach(d => {
    const on = !learnQ || d.dataset.s.includes(learnQ);
    d.style.display = on ? '' : 'none';
    if (learnQ && on) d.open = true;
  });
}

function learnOpen(id) {
  const d = document.getElementById('ln-' + id);
  if (!d) return;
  d.open = true;
  d.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── "Show me": open the page and point at the place ──────
function learnShow(id) {
  const l = _lnL(id);
  if (!l) return;
  if (l.page) showPanel(l.page);
  if (typeof closeMobMore === 'function') try { closeMobMore(); } catch (_) {}
  setTimeout(() => {
    const el = (l.show || '').split(',').map(s => s.trim()).filter(Boolean).map(s => { try { return [...document.querySelectorAll(s)].find(e => e.offsetParent || e.getClientRects().length); } catch (_) { return null; } }).find(Boolean)
      || document.querySelector('.panel.active .card') || document.querySelector('.panel.active');
    learnSpot(el, l);
  }, l.page ? 450 : 50);
}

function learnSpot(el, l) {
  document.getElementById('lnSpot')?.remove();
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => {
    const r = el.getBoundingClientRect(), pad = 8;
    const w = document.createElement('div');
    w.id = 'lnSpot';
    w.className = 'ln-spot-wrap';
    const top = Math.max(8, r.top - pad), left = Math.max(8, r.left - pad);
    const below = r.bottom + 180 < innerHeight;
    w.innerHTML = `<div class="ln-spot" style="top:${top}px;left:${left}px;width:${Math.min(innerWidth - 16, r.width + pad * 2)}px;height:${Math.min(innerHeight - 16, r.height + pad * 2)}px"></div>
      <div class="ln-tip" style="${below ? `top:${Math.min(innerHeight - 170, r.bottom + 16)}px` : `top:${Math.max(70, r.top - 176)}px`};left:${Math.max(12, Math.min(innerWidth - 332, r.left))}px">
        <b>${escapeHtml(l.title)}</b><span>${escapeHtml((l.steps || [l.why])[0])}</span>
        <div><button class="btn sm gold" onclick="document.getElementById('lnSpot').remove()">Got it</button>
        <button class="btn sm ghost" onclick="document.getElementById('lnSpot').remove();showPanel('learn');setTimeout(()=>learnOpen('${l.id}'),300)">Back to the lesson</button></div>
      </div>`;
    w.addEventListener('click', e => { if (e.target === w) w.remove(); });
    document.body.appendChild(w);
  }, 350);
}

// ── Team progress (owners & managers) ────────────────────
async function learnTeam() {
  const box = document.getElementById('ln-teamprog');
  if (!box) return;
  const role = typeof currentProfile !== 'undefined' && currentProfile && currentProfile.role;
  if (!['owner', 'manager', 'supervisor'].includes(role) || typeof fbGet !== 'function') { box.innerHTML = ''; return; }
  const all = (await fbGet('learn')) || {};
  const rows = Object.values(all).filter(r => r && r.name).sort((a, b) => (b.done || []).length - (a.done || []).length);
  box.innerHTML = rows.length ? `<h2>Team progress</h2><p>Who has worked through the guide (visible to owners, managers and supervisors).</p>
    <div class="ln-team">${rows.map(r => { const n = (r.done || []).length, t = r.total || LEARN_LESSONS.length; return `<div><span>${escapeHtml(r.name)}</span><div class="ln-pbar"><i style="width:${Math.round(n / t * 100)}%"></i></div><small>${n}/${t}</small></div>`; }).join('')}</div>` : '';
}

// ── Print for a new colleague ────────────────────────────
function learnPrint() {
  const sec = (title, body) => `<h2>${title}</h2>${body}`;
  const les = l => `<div class="l"><h3>${escapeHtml(l.title)}</h3><p><i>${escapeHtml(l.why)}</i></p>${l.need ? `<p><b>You need:</b> ${escapeHtml(l.need)}</p>` : ''}<ol>${(l.steps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>${(l.tips || []).map(t => `<p class="t">💡 ${escapeHtml(t)}</p>`).join('')}</div>`;
  const hotel = document.getElementById('hotelName')?.textContent || '';
  const w = window.open('', '_blank');
  if (!w) { showToast('Allow pop-ups to print the guide', 'err'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Learn HotelOps</title><style>
    body{font:14px/1.5 -apple-system,Segoe UI,Inter,sans-serif;color:#111;max-width:760px;margin:30px auto;padding:0 20px}
    h1{font-size:28px;margin:0}h2{font-size:19px;margin:28px 0 8px;border-bottom:2px solid #e3ad3f;padding-bottom:4px}
    h3{font-size:15px;margin:0 0 4px}.l{break-inside:avoid;border:1px solid #ddd;border-radius:8px;padding:10px 14px;margin:8px 0}
    .t{color:#555;font-size:13px;margin:4px 0}ol{margin:4px 0 4px 18px;padding:0}.sub{color:#666}
    .sh{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.sh div{border:1px solid #ddd;border-radius:8px;padding:8px 12px}
    @media print{button{display:none}}</style></head><body>
    <button onclick="print()" style="float:right;padding:8px 14px">Print / save as PDF</button>
    <h1>Learn HotelOps</h1><div class="sub">${escapeHtml(hotel)} · front office operations · ${new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</div>
    ${sec('1 · Start here', LEARN_LESSONS.filter(l => l.start).map(les).join(''))}
    ${sec('2 · Your shift, step by step', `<div class="sh">${LEARN_SHIFTS.map(s => `<div><b>${s.name}</b> <small>${s.hours}</small><ol>${s.steps.map(([, t]) => `<li>${escapeHtml(t)}</li>`).join('')}</ol></div>`).join('')}</div>`)}
    ${sec('3 · Every page', LEARN_GROUPS.map(g => `<h3 style="margin-top:16px">${escapeHtml(g.name)}</h3>` + LEARN_LESSONS.filter(l => l.group === g.id).map(les).join('')).join(''))}
    </body></html>`);
  w.document.close();
}

document.addEventListener('DOMContentLoaded', () => {
  // add the lessons to Ops Brain's answers
  if (typeof BR_FAQ !== 'undefined') LEARN_LESSONS.forEach(l => BR_FAQ.push({ q: (l.title + ' ' + (l.need || '') + ' learn how').toLowerCase(), t: l.title, a: `${escapeHtml(l.why)}<ol>${(l.steps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>`, go: 'learn' }));
});

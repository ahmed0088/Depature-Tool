// ═══════════════════════════════════════════════════════════
//  brain.js — Ops Brain 🧠
//  A helper that lives inside the app. No outside AI and no internet
//  needed: it reads everything the app already knows and learns from
//  how you use it.
//
//   • Thinks with you — looks at what is loaded right now (arrivals
//     without email, DTCM not tallying, late check-outs, month end…)
//     and at your own habits (what you open at this hour, what you open
//     after this page) and suggests the next step.
//   • Answers questions — searches the page guides, Accor Standards,
//     every room and guest loaded, and answers the team taught it.
//     👍 / 👎 on an answer teaches it which answer was right.
//   • Learns from you — "remember: question = answer" (or the Teach
//     button) saves an answer for the whole team.
//   • Fixes itself where it can — health check (new version waiting,
//     broken saved data, errors on a page) with one-tap repairs. What
//     needs a code change goes to the developer as a fix request.
// ═══════════════════════════════════════════════════════════

const BR_USAGE_KEY = 'brain_usage_v1';      // this person's habits (this browser)
const BR_ERR_KEY = 'brain_errors_v1';       // last errors seen in this browser
const BR_VOTES_KEY = 'brain_votes_v1';      // 👍/👎 per question → answer
const BR_REPO = 'ahmed0088/Depature-Tool';

let brTaught = {};      // team answers  (Firebase brain/taught)
let brFixes = {};       // fix requests  (Firebase brain/fixes)
let brTab = 'think';
let brLastPanel = null;
let brLastAnswers = [];
let brCurrentQ = '';

const _brLS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
};
const _brMe = () => (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || 'Someone';
const _brPanelName = id => {
  const n = document.getElementById('nav-' + id);
  return n ? n.textContent.replace(/\s*[\d—✓]+\s*$/, '').replace(/^\W+/, '').trim() : id;
};

// ── 1. Learning how you use the app ───────────────────────
function brTrackPanel(panel) {
  if (!panel) return;
  const u = _brLS.get(BR_USAGE_KEY, { hours: {}, next: {}, total: {} });
  const h = new Date().getHours();
  u.hours[panel] = u.hours[panel] || {};
  u.hours[panel][h] = (u.hours[panel][h] || 0) + 1;
  u.total[panel] = (u.total[panel] || 0) + 1;
  if (brLastPanel && brLastPanel !== panel) {
    u.next[brLastPanel] = u.next[brLastPanel] || {};
    u.next[brLastPanel][panel] = (u.next[brLastPanel][panel] || 0) + 1;
  }
  brLastPanel = panel;
  _brLS.set(BR_USAGE_KEY, u);
}

function brHabits() {
  const u = _brLS.get(BR_USAGE_KEY, { hours: {}, next: {}, total: {} });
  const h = new Date().getHours();
  const near = p => [h - 1, h, h + 1].reduce((s, x) => s + ((u.hours[p] || {})[(x + 24) % 24] || 0), 0);
  const atHour = Object.keys(u.hours).map(p => [p, near(p)]).filter(x => x[1] >= 3 && x[0] !== 'home').sort((a, b) => b[1] - a[1]);
  const cur = document.querySelector('.panel.active')?.id.slice(6);
  const nx = Object.entries(u.next[cur] || {}).filter(x => x[1] >= 2 && x[0] !== 'home').sort((a, b) => b[1] - a[1]);
  return { atHour, next: nx, cur, total: u.total };
}

// ── 2. Thinking with you: suggestions ─────────────────────
function brSuggestions() {
  const out = [];
  const add = (icon, text, go, why, tone = 'warn') => out.push({ icon, text, go, why, tone });
  const safe = f => { try { f(); } catch (_) {} };
  const now = new Date(), h = now.getHours();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  safe(() => {
    const errs = _brLS.get(BR_ERR_KEY, []).filter(e => Date.now() - e.t < 864e5);
    if (errs.length) add('🩺', `${errs.length} error${errs.length > 1 ? 's' : ''} in the app today (${[...new Set(errs.map(e => e.page))].join(', ')})`, 'tab:health', 'Open the health check to repair or report it', 'bad');
  });
  safe(() => {
    if (typeof depRooms === 'undefined' || !depRooms.length) return;
    const late = depRooms.filter(r => typeof isLcoOverdue === 'function' && isLcoOverdue(r)).length;
    if (late) add('🚪', `${late} late check-out${late > 1 ? 's' : ''} past their time`, 'departures', 'Call the room or extend in Opera', 'bad');
    const owe = depRooms.filter(r => r.balance > 0 && r.status !== 'out' && r.status !== 'extended').length;
    if (owe) add('💳', `${owe} departing room${owe > 1 ? 's' : ''} still owe a balance`, 'departures', 'Settle before check-out');
  });
  safe(() => {
    if (typeof arrGuests === 'undefined' || !arrGuests.length) return;
    const e = arrGuests.filter(g => !g.email || !String(g.email).includes('@')).length;
    const n = arrGuests.filter(g => !g.nat).length;
    if (n) add('🌍', `${n} arrival${n > 1 ? 's' : ''} without nationality`, 'arrivals', 'Tap ✦ Nationality to guess them from the names');
    if (e) add('✉️', `${e} arrival${e > 1 ? 's' : ''} without email`, 'arrivals', 'Ask at check-in, needed for ALL enrollment');
  });
  safe(() => {
    if (typeof purposeGuests === 'undefined' || !purposeGuests.length) return;
    const o = purposeGuests.filter(g => !g.originOfTravel).length;
    if (o) add('🧭', `${o} guest${o > 1 ? 's' : ''} without origin of travel`, 'purpose', 'Load the origin XML or fill it in');
  });
  safe(() => {
    if (typeof dtcRecon === 'undefined' || !dtcRecon) return;
    const n = (dtcRecon.actions || []).length - (typeof dtcDone !== 'undefined' ? dtcDone.size || [...dtcDone].length : 0);
    const me = dtcRecon.gap && dtcRecon.gap.monthEnd;
    if (me && !me.equal) add('🏦', `DTCM month-end does not tally (${me.dtcm} vs ${me.opera})`, 'dtcm', 'Work through Step B on DTCM Recon', 'bad');
    else if (n > 0) add('🏦', `${n} DTCM item${n > 1 ? 's' : ''} not ticked yet`, 'dtcm', 'Tick each one when it is fixed in Opera or the TD portal');
  });
  safe(() => {
    if (typeof pkgResults === 'undefined' || !pkgResults.length) return;
    const n = pkgResults.filter(r => !r.pinSkip && (r.verdict === 'deny' || r.verdict === 'review')).length;
    if (n) add('🎁', `${n} package line${n > 1 ? 's' : ''} to deny or review`, 'package-audit', 'Pin the seller or skip if you know better');
  });
  safe(() => {
    if (typeof CL_STEPS === 'undefined' || typeof clState === 'undefined') return;
    if (!(h >= 23 || h < 7)) return;
    const act = CL_STEPS.filter(s => !clState.skipped.has(s.id));
    const left = act.filter(s => !clState.done.has(s.id)).length;
    if (left && h >= 3 && h < 7) add('✅', `${left} night checklist step${left > 1 ? 's' : ''} left before morning`, 'checklist', 'Finish them before handover');
  });
  if (now.getDate() >= lastDay - 2) add('🗂', `Month end in ${lastDay - now.getDate() || 'less than 1'} day${lastDay - now.getDate() === 1 ? '' : 's'}`, 'dtcm', 'Print the DTCM month-end report and the package commission report', 'idle');

  // habits
  const hb = brHabits();
  const have = new Set(out.map(o => o.go));
  hb.atHour.slice(0, 2).forEach(([p, n]) => {
    if (p !== hb.cur && !have.has(p)) { add('🕘', `Around this time you usually open ${_brPanelName(p)}`, p, `You did it ${n} times at this hour`, 'idle'); have.add(p); }
  });
  if (hb.next[0] && !have.has(hb.next[0][0])) add('➡️', `After ${_brPanelName(hb.cur)} you usually go to ${_brPanelName(hb.next[0][0])}`, hb.next[0][0], `${hb.next[0][1]} times so far`, 'idle');
  return out;
}

// ── 3. Answering questions ────────────────────────────────
const BR_STOP = new Set('a an the is are was were be to of in on for and or i we you it this that how what why when where which do does did can should my me with from at by as if not no yes please there need want get about'.split(' '));
const BR_SYN = { td: 'tourism dirham', dtcm: 'dtcm tourism', co: 'checkout', ci: 'checkin', lco: 'late checkout', eci: 'early checkin', nat: 'nationality', pax: 'guest', ota: 'booking expedia', all: 'loyalty accor', pkg: 'package', ns: 'noshow', recon: 'reconcile reconciliation' };
function brTokens(s) {
  const t = String(s || '').toLowerCase().replace(/check[\s-]?out/g, 'checkout').replace(/check[\s-]?in/g, 'checkin').replace(/no[\s-]?show/g, 'noshow')
    .replace(/<[^>]+>/g, ' ').split(/[^a-z0-9@.]+/).filter(w => w && !BR_STOP.has(w));
  const out = [];
  t.forEach(w => { out.push(w.replace(/(ing|ed|es|s)$/, '') || w); if (BR_SYN[w]) BR_SYN[w].split(' ').forEach(x => out.push(x)); });
  return out;
}
function _brScore(q, text, title) {
  const toks = brTokens(text), d = new Set(toks), t = new Set(brTokens(title));
  let s = 0, hit = 0;
  q.forEach(w => {
    if (d.has(w)) { s += w.length > 3 ? 2 : 1; hit++; } else if (w.length > 4 && [...d].some(x => x.startsWith(w.slice(0, 5)))) s += 1;
    if (t.has(w)) s += 3;                       // the title says it: strongest sign
  });
  if (!hit && !s) return 0;
  // long texts match many words by chance: a short, focused answer wins
  return s / (1 + Math.max(0, Math.log10(toks.length / 40))) * (hit / Math.max(1, q.length) + 0.5);
}

// Built-in answers about the app itself
const BR_FAQ = [
  { q: 'change TD rate code cap 7510 15 20 AED hotel settings tourism dirham other hotel', t: 'Change the Tourism Dirham code, rate or night cap', a: 'DTCM Recon → <b>⚙️ Hotel TD settings</b>: set the Opera code(s) (e.g. 7510), the rate per night (7 / 10 / 15 / 20 AED by star rating), the night cap (30) and the night-audit time. Saved for the whole team. Run Analyze again after changing it.', go: 'dtcm' },
  { q: 'day use post TD tourism dirham same day checkin checkout 0 night', t: 'Day use and Tourism Dirham', a: 'A real day use is charged one night of TD in DTCM. The night audit never posts it in Opera, so post one night of TD by hand in Opera on the same day. A check-in made by mistake (same guest, checked out and in again) is not a day use: cancel it in DTCM.', go: 'dtcm' },
  { q: 'month end tally dtcm opera equal close report pdf print', t: 'Month-end: DTCM and Opera must be equal', a: 'Run DTCM Recon on the whole month. Step B lists every item with the side to fix it on; Step C shows where both totals end. Tick each item when done, then <b>🗂 Month-end report (PDF)</b> prints the totals, corrections and signature lines.', go: 'dtcm' },
  { q: 'pin seller package wrong person give manisha hassan skip ingauge', t: 'Give a package to the right seller, or skip it', a: 'Package Audit → the <b>📌 Pin</b> column on each line: choose the real seller, <b>Skip</b> to leave it out, or <b>Manual sale</b>. Pins are saved for the team and applied every time the files are loaded.', go: 'package-audit' },
  { q: 'manual sale late checkout 6pm added by hand ingauge not in opera', t: 'A package I added by hand in IN-Gauge', a: 'Pin it as <b>✍️ Manual sale</b> (with the seller) on Package Audit. It is kept and credited and never flagged for removal again.', go: 'package-audit' },
  { q: 'commission report seller package month excel', t: 'Package commission per seller', a: 'Package Audit → <b>💰 Commission report (PDF)</b> or <b>📋 Commission to Excel</b>: packages, nights and AED per seller, with pinned decisions and the deny list.', go: 'package-audit' },
  { q: 'drop file drag upload report where which page', t: 'Where do I upload a report?', a: 'Drag the file onto the app on any page: it reads the name and first lines, opens the right page and loads it. If it can\'t tell, it asks you which page.', go: 'home' },
  { q: 'who did what history log changed deleted ticked', t: 'See who did what', a: 'The <b>🕘 History</b> page lists every action with the person and time. Search by name, room, confirmation or page.', go: 'history' },
  { q: 'enroll all accor loyalty member invitation pipeline neorcha email', t: 'Enroll guests in ALL', a: 'Guest Pipeline: run the Neorcha Extractor, clean the list (duplicates, OTA emails, typos), set civility, then use the ALL Enroll script. Sent invitations are tracked for the team so nobody is enrolled twice.', go: 'pipeline' },
  { q: 'install app phone home screen', t: 'Put the app on your phone\'s home screen', a: 'Android: More → <b>📲 Install app</b>. iPhone (Safari): Share ⬆︎ → <b>Add to Home Screen</b>.', go: 'home' },
  { q: 'old version bug update refresh not working cache', t: 'The app looks old or something broke', a: 'Open 🧠 → <b>Health</b>: it checks for a newer version and damaged saved data and repairs them. Or tap the version label (e.g. v116) in the top bar to force an update.', go: '' },
  { q: 'fix change request developer code improve feature', t: 'Ask for a fix or a new feature', a: 'Open 🧠 → <b>Fix requests</b> (or type <code>fix: what is wrong</code> in the ask box). Save it, then <b>Send on GitHub</b> — the developer (Claude) fixes the code and the change shows up in ✨ What\'s new.', go: '' },
  { q: 'teach remember learn answer brain', t: 'Teach Ops Brain something', a: 'Ask the question; if the answer is missing or wrong, use <b>✍️ Teach</b> under the answers. Or type <code>remember: question = answer</code>. The whole team gets it.', go: '' },
];

// Everything the brain can read, rebuilt on each question (data changes all the time)
function brKnowledge() {
  const K = [];
  BR_FAQ.forEach((f, i) => K.push({ id: 'faq:' + i, kind: '💡 How the app works', title: f.t, body: f.a, text: f.t + ' ' + f.q + ' ' + f.q, go: f.go, boost: 1 }));
  Object.entries(brTaught).forEach(([id, t]) => K.push({ id: 'taught:' + id, kind: '👥 Team answer', title: t.q, body: escapeHtml(t.a) + `<div class="br-by">taught by ${escapeHtml(t.by || '?')}</div>`, text: t.q + ' ' + t.q + ' ' + t.a, boost: 3 }));
  document.querySelectorAll('.panel').forEach(p => {
    const id = p.id.slice(6), h1 = p.querySelector('h1')?.textContent || id, sub = p.querySelector('.page-hd p')?.textContent || '';
    p.querySelectorAll('details.howto').forEach((d, i) => K.push({ id: 'howto:' + id + i, kind: '❔ Page guide', title: `${h1} — how to use it`, body: d.querySelector('ol,ul,div')?.outerHTML || escapeHtml(d.textContent), text: h1 + ' ' + h1 + ' ' + sub + ' ' + d.textContent, go: id }));
    if (sub) K.push({ id: 'page:' + id, kind: '📄 Page', title: h1, body: escapeHtml(sub), text: h1 + ' ' + h1 + ' ' + sub, go: id });
  });
  (typeof STD_ITEMS !== 'undefined' ? STD_ITEMS : []).forEach((it, i) => K.push({ id: 'std:' + i, kind: '📘 Accor Standards', title: it.title, body: '<ul>' + (it.points || []).map(x => `<li>${x}</li>`).join('') + '</ul>', text: it.title + ' ' + it.title + ' ' + (it.tags || '') + ' ' + (it.points || []).join(' '), go: 'standards' }));
  return K;
}

// "room 512", "512", a guest name → everything the app holds about it
function brLookup(q) {
  const m = q.match(/^\s*(?:room\s*)?(\d{3,4})\s*$/i);
  const term = m ? m[1] : q.trim().toLowerCase();
  if (!m && term.length < 4) return [];
  const hits = [];
  const hit = (v) => m ? String(v || '').trim() === term : String(v || '').toLowerCase().includes(term);
  try { (typeof depRooms !== 'undefined' ? depRooms : []).forEach(r => { if (hit(m ? r.roomStr : r.name)) hits.push(['departures', '🚪', `Departure · room ${r.roomStr} · ${r.name} · ${r.status}${r.balance > 0 ? ' · owes AED ' + r.balance : ''}`]); }); } catch (_) {}
  try { (typeof arrGuests !== 'undefined' ? arrGuests : []).forEach(x => { if (hit(m ? x.room : x.name)) hits.push(['arrivals', '🛎️', `Arrival · room ${x.room} · ${x.name} · ${x.purpose || ''} · ${x.nat || 'no nationality'} · ${x.email || 'no email'}`]); }); } catch (_) {}
  try { (typeof purposeGuests !== 'undefined' ? purposeGuests : []).forEach(x => { if (hit(m ? x.room : x.name)) hits.push(['purpose', '📋', `Purpose · room ${x.room} · ${x.name} · ${x.purpose || ''} · origin ${x.originOfTravel || '—'}`]); }); } catch (_) {}
  try { (typeof dtcRecon !== 'undefined' && dtcRecon ? dtcRecon.fixPlan || [] : []).forEach(p => { if (m && String(p.room) === term) hits.push(['dtcm', '🏦', `DTCM · room ${p.room} · ${p.title || p.kind}`]); }); } catch (_) {}
  try { (typeof pkgResults !== 'undefined' ? pkgResults : []).forEach(r => { if (m ? String(r.room) === term : hit(r.guest || r.name)) hits.push(['package-audit', '🎁', `Package · room ${r.room} · ${r.family || r.code} · ${r.verdict}${r.pin ? ' · 📌 pinned' : ''}`]); }); } catch (_) {}
  return hits.slice(0, 12);
}

function brAsk(raw) {
  const q = String(raw || '').trim();
  const box = document.getElementById('brAnswers');
  if (!box || !q) return;
  // commands
  let m;
  if ((m = q.match(/^(?:fix|bug|broken|change)\s*[:\-]\s*(.+)$/i))) { brTabShow('fix'); document.getElementById('brFixText').value = m[1]; return; }
  if ((m = q.match(/^(?:remember|teach)\s*[:\-]?\s*(.+?)\s*(?:=|->|→)\s*(.+)$/i))) { brTeach(m[1], m[2]); return; }
  const page = [...document.querySelectorAll('.nav-item[data-panel]')].find(n => new RegExp('^(?:open|go to|show)\\s+' + n.textContent.replace(/[\d—✓]+\s*$/, '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i').test(q));
  if (page) { brClose(); showPanel(page.dataset.panel); return; }

  const qt = brTokens(q);
  const votes = _brLS.get(BR_VOTES_KEY, {});
  const vkey = qt.slice().sort().join(' ');
  const ranked = brKnowledge().map(k => ({ k, s: _brScore(qt, k.text, k.title) * (k.boost ? 1.5 : 1) + ((votes[vkey] || {})[k.id] || 0) * 6 }))
    .filter(x => x.s > 0 && ((votes[vkey] || {})[x.k.id] || 0) > -1).sort((a, b) => b.s - a.s).slice(0, 4);
  const look = brLookup(q);
  brLastAnswers = ranked.map(x => x.k);
  if (typeof logActivity === 'function') try { logActivity('brain_ask', q.slice(0, 120)); } catch (_) {}

  let html = '';
  if (look.length) html += `<div class="br-card"><div class="br-kind">🔎 In the app right now</div>${look.map(([p, i, t]) => `<button class="br-hit" onclick="brClose();showPanel('${p}')">${i} ${escapeHtml(t)}</button>`).join('')}</div>`;
  html += ranked.map((x, i) => `
    <div class="br-card">
      <div class="br-kind">${x.k.kind}</div>
      <div class="br-title">${escapeHtml(x.k.title)}</div>
      <div class="br-body">${x.k.body}</div>
      <div class="br-acts">
        ${x.k.go ? `<button class="btn" onclick="brClose();showPanel('${x.k.go}')">Open page</button>` : ''}
        <button class="br-vote" title="This answered it" onclick="brVote(${i},1,this)">👍</button>
        <button class="br-vote" title="Wrong answer" onclick="brVote(${i},-1,this)">👎</button>
      </div>
    </div>`).join('');
  if (!ranked.length && !look.length) html += `<div class="br-card"><div class="br-title">I don't know this yet.</div><div class="br-body">Teach me and I'll know it next time, for the whole team.</div></div>`;
  html += `<details class="br-teach"${!ranked.length && !look.length ? ' open' : ''}><summary>✍️ Teach the answer to "${escapeHtml(q)}"</summary>
    <textarea id="brTeachA" class="tt-textarea" placeholder="Write the answer the way you'd explain it to a new colleague…"></textarea>
    <button class="btn gold" onclick="brTeach(brCurrentQ, document.getElementById('brTeachA').value)">Save for the team</button></details>`;
  brCurrentQ = q;
  box.innerHTML = html;
  box.dataset.q = vkey;
}

function brVote(i, v, btn) {
  const k = brLastAnswers[i];
  const key = document.getElementById('brAnswers')?.dataset.q;
  if (!k || !key) return;
  const votes = _brLS.get(BR_VOTES_KEY, {});
  votes[key] = votes[key] || {};
  votes[key][k.id] = Math.max(-2, Math.min(3, (votes[key][k.id] || 0) + v));
  _brLS.set(BR_VOTES_KEY, votes);
  btn.closest('.br-acts').innerHTML = v > 0 ? '<span class="br-thanks">Got it — this comes first next time.</span>' : '<span class="br-thanks">Noted — I\'ll stop showing this for that question. Teach me the right answer below.</span>';
  if (v < 0) document.querySelector('.br-teach')?.setAttribute('open', '');
}

function brTeach(q, a) {
  q = String(q || '').trim(); a = String(a || '').trim();
  if (!q || !a) { showToast('Write the answer first', 'err'); return; }
  const id = 't' + Date.now().toString(36);
  brTaught[id] = { q, a, by: _brMe(), at: new Date().toISOString() };
  if (typeof fbSet === 'function') fbSet('brain/taught/' + id, brTaught[id]);
  _brLS.set('brain_taught_cache', brTaught);
  if (typeof logActivity === 'function') try { logActivity('brain_taught', q.slice(0, 120)); } catch (_) {}
  showToast('Learned — the whole team gets this answer now', 'ok');
  brAsk(q);
}

function brForget(id) {
  if (!confirm('Forget this answer for everyone?')) return;
  delete brTaught[id];
  if (typeof fbSet === 'function') fbSet('brain/taught/' + id, null);
  _brLS.set('brain_taught_cache', brTaught);
  brRenderLearned();
}

// ── 4. Fixing itself ──────────────────────────────────────
function _brNoteError(msg, src) {
  const errs = _brLS.get(BR_ERR_KEY, []);
  const page = document.querySelector('.panel.active')?.id.slice(6) || '?';
  const m = String(msg || '').slice(0, 200);
  if (errs.length && errs[errs.length - 1].m === m && Date.now() - errs[errs.length - 1].t < 5000) return;
  errs.push({ t: Date.now(), m, src: String(src || '').split('/').pop().slice(0, 60), page, v: typeof APP_VERSION !== 'undefined' ? APP_VERSION : '' });
  _brLS.set(BR_ERR_KEY, errs.slice(-30));
  const b = document.getElementById('brFab');
  if (b) b.classList.add('alert');
}
window.addEventListener('error', e => _brNoteError(e.message, e.filename + ':' + e.lineno));
window.addEventListener('unhandledrejection', e => _brNoteError('Promise: ' + (e.reason && (e.reason.message || e.reason)), ''));

async function brHealth() {
  const box = document.getElementById('brHealth');
  if (!box) return;
  box.innerHTML = '<div class="br-card">Checking…</div>';
  const rows = [];
  const row = (ok, title, detail, fix) => rows.push({ ok, title, detail, fix });

  // newest version on the server?
  try {
    const t = await (await fetch('sw.js?x=' + Date.now(), { cache: 'no-store' })).text();
    const live = (t.match(/ibis-ops-shell-v(\d+)/) || [])[1];
    const mine = String(APP_VERSION).replace(/\D/g, '');
    if (live && +live > +mine) row(false, `A newer version is ready (v${live}, you have ${APP_VERSION})`, 'Old copies can show bugs that are already fixed.', ['Update now', 'appForceUpdate()']);
    else row(true, `Up to date (${APP_VERSION})`, '');
  } catch (_) { row(null, 'Could not check for a new version', 'No connection right now.'); }

  // connection
  const live = /Live/.test(document.getElementById('fbLabel')?.textContent || '');
  row(navigator.onLine && live, navigator.onLine ? (live ? 'Connected and sharing with the team' : 'Online, but not connected to the shared database') : 'No internet', navigator.onLine && !live ? 'Changes are kept on this device and sent when the connection is back.' : '', navigator.onLine && !live ? ['Reload', 'location.reload()'] : null);

  // saved data that can't be read
  const broken = [];
  let bytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i), v = localStorage.getItem(k) || '';
      bytes += k.length + v.length;
      if (/^[\[{]/.test(v)) { try { JSON.parse(v); } catch (_) { broken.push(k); } }
    }
  } catch (_) {}
  if (broken.length) row(false, `${broken.length} saved item${broken.length > 1 ? 's are' : ' is'} damaged on this device`, broken.join(', '), ['Repair', `brRepair(${JSON.stringify(broken).replace(/"/g, '&quot;')})`]);
  else row(true, 'Saved data on this device reads fine', `${Math.round(bytes * 2 / 1024)} KB used`);
  if (bytes * 2 > 4.5e6) row(false, 'This device\'s storage is almost full', 'Old local copies can be cleared; the team data stays in Firebase.', ['Free space', 'brFreeSpace()']);

  // errors
  const errs = _brLS.get(BR_ERR_KEY, []);
  const recent = errs.filter(e => Date.now() - e.t < 7 * 864e5);
  if (recent.length) row(false, `${recent.length} error${recent.length > 1 ? 's' : ''} in the last 7 days`,
    recent.slice(-5).reverse().map(e => `${new Date(e.t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${e.page} · ${e.m}`).join('<br>'),
    ['Report to developer', "brTabShow('fix');brPrefillFromErrors()"]);
  else row(true, 'No errors in the last 7 days', '');

  box.innerHTML = rows.map(r => `<div class="br-card br-h ${r.ok === true ? 'ok' : r.ok === false ? 'bad' : ''}">
    <div class="br-title">${r.ok === true ? '✅' : r.ok === false ? '⚠️' : 'ℹ️'} ${escapeHtml(r.title)}</div>
    ${r.detail ? `<div class="br-body">${r.detail.includes('<br>') ? r.detail.split('<br>').map(escapeHtml).join('<br>') : escapeHtml(r.detail)}</div>` : ''}
    ${r.fix ? `<div class="br-acts"><button class="btn gold" onclick="${r.fix[1]}">${escapeHtml(r.fix[0])}</button></div>` : ''}</div>`).join('')
    + (errs.length ? '<button class="btn ghost" style="width:100%" onclick="brClearErrors()">Clear the error list</button>' : '');
}

function brRepair(keys) {
  keys.forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
  showToast('Repaired — the damaged copies were removed; the app reloads them from the team data', 'ok');
  if (typeof logActivity === 'function') try { logActivity('brain_repair', keys.join(', ')); } catch (_) {}
  setTimeout(() => location.reload(), 1200);
}
function brFreeSpace() {
  // local copies of shared data (ibis_*) come back from Firebase; personal settings are kept
  let n = 0;
  try { Object.keys(localStorage).filter(k => /^ibis_/.test(k)).forEach(k => { localStorage.removeItem(k); n++; }); } catch (_) {}
  showToast(`Cleared ${n} local copies — reloading`, 'ok');
  setTimeout(() => location.reload(), 1200);
}
function brClearErrors() { _brLS.set(BR_ERR_KEY, []); document.getElementById('brFab')?.classList.remove('alert'); brHealth(); }

function brPrefillFromErrors() {
  const errs = _brLS.get(BR_ERR_KEY, []).slice(-3);
  const t = document.getElementById('brFixText');
  if (t && errs.length) t.value = `The app showed an error on ${errs[errs.length - 1].page}. What I was doing: `;
}

function brSaveFix() {
  const text = (document.getElementById('brFixText')?.value || '').trim();
  if (!text) { showToast('Describe what is wrong or what you want changed', 'err'); return; }
  const page = document.getElementById('brFixPage')?.value || '';
  const id = 'f' + Date.now().toString(36);
  const errs = _brLS.get(BR_ERR_KEY, []).slice(-3).map(e => `${e.page} · ${e.src} · ${e.m}`);
  brFixes[id] = { text, page, by: _brMe(), at: new Date().toISOString(), v: APP_VERSION, errors: errs, status: 'open' };
  if (typeof fbSet === 'function') fbSet('brain/fixes/' + id, brFixes[id]);
  if (typeof logActivity === 'function') try { logActivity('brain_fix_request', text.slice(0, 120)); } catch (_) {}
  document.getElementById('brFixText').value = '';
  showToast('Saved — send it to the developer with the GitHub button', 'ok');
  brRenderFixes();
}

function brGithub(id) {
  const f = brFixes[id];
  if (!f) return;
  const title = `[App] ${f.page ? _brPanelName(f.page) + ': ' : ''}${f.text.split('\n')[0].slice(0, 70)}`;
  const body = `${f.text}\n\n— Page: ${f.page ? _brPanelName(f.page) : 'any'}\n— Version: ${f.v}\n— Asked by: ${f.by}, ${f.at.slice(0, 10)}${f.errors && f.errors.length ? '\n— Errors seen:\n' + f.errors.map(e => '    ' + e).join('\n') : ''}\n\n(Sent from Ops Brain inside the app. Do not paste guest names here — this repository is public.)`;
  window.open(`https://github.com/${BR_REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`, '_blank', 'noopener');
  brFixes[id].status = 'sent';
  if (typeof fbSet === 'function') fbSet('brain/fixes/' + id + '/status', 'sent');
  brRenderFixes();
}
function brFixDone(id) {
  if (!brFixes[id]) return;
  brFixes[id].status = 'done';
  if (typeof fbSet === 'function') fbSet('brain/fixes/' + id + '/status', 'done');
  brRenderFixes();
}

function brRenderFixes() {
  const box = document.getElementById('brFixList');
  if (!box) return;
  const list = Object.entries(brFixes).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at)));
  box.innerHTML = list.length ? list.map(([id, f]) => `<div class="br-card br-fix ${f.status}">
    <div class="br-kind">${f.status === 'done' ? '✅ Done' : f.status === 'sent' ? '📨 Sent to developer' : '📝 Not sent yet'} · ${escapeHtml(f.by || '')} · ${escapeHtml((f.at || '').slice(0, 10))}${f.page ? ' · ' + escapeHtml(_brPanelName(f.page)) : ''}</div>
    <div class="br-body">${escapeHtml(f.text)}</div>
    <div class="br-acts">${f.status !== 'done' ? `<button class="btn gold" onclick="brGithub('${id}')">Send on GitHub</button><button class="btn ghost" onclick="brFixDone('${id}')">Mark done</button>` : ''}</div></div>`).join('')
    : '<div class="br-empty">No fix requests yet.</div>';
}

// ── What it learned ───────────────────────────────────────
function brRenderLearned() {
  const box = document.getElementById('brLearned');
  if (!box) return;
  const hb = brHabits();
  const top = Object.entries(hb.total).filter(x => x[0] !== 'home').sort((a, b) => b[1] - a[1]).slice(0, 6);
  const u = _brLS.get(BR_USAGE_KEY, { hours: {} });
  const peak = p => { const hs = Object.entries(u.hours[p] || {}).sort((a, b) => b[1] - a[1]); return hs[0] ? `${String(hs[0][0]).padStart(2, '0')}:00` : '—'; };
  const taught = Object.entries(brTaught).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at)));
  box.innerHTML = `
    <div class="br-card"><div class="br-title">How you use the app (this device)</div>
      ${top.length ? `<div class="br-body">${top.map(([p, n]) => `<div class="br-habit"><span>${escapeHtml(_brPanelName(p))}</span><span>${n}× · mostly around ${peak(p)}</span></div>`).join('')}</div>` : '<div class="br-body">Nothing yet — use the app and I\'ll learn your routine.</div>'}
      <div class="br-acts"><button class="btn ghost" onclick="if(confirm('Forget your habits on this device?')){localStorage.removeItem('${BR_USAGE_KEY}');localStorage.removeItem('${BR_VOTES_KEY}');brRenderLearned();}">Forget my habits</button></div></div>
    <div class="br-card"><div class="br-title">Answers the team taught me (${taught.length})</div>
      ${taught.length ? taught.map(([id, t]) => `<div class="br-taught"><b>${escapeHtml(t.q)}</b><div>${escapeHtml(t.a)}</div><small>${escapeHtml(t.by || '')} · ${escapeHtml((t.at || '').slice(0, 10))} · <a href="#" onclick="brForget('${id}');return false;">forget</a></small></div>`).join('') : '<div class="br-body">None yet. Ask me something; if I don\'t know, teach me. Or type <code>remember: question = answer</code>.</div>'}
    </div>`;
}

// ── UI ────────────────────────────────────────────────────
function brRenderThink() {
  const box = document.getElementById('brThink');
  if (!box) return;
  const s = brSuggestions();
  box.innerHTML = s.length ? s.map(x => `<button class="br-sug ${x.tone}" onclick="${x.go.startsWith('tab:') ? `brTabShow('${x.go.slice(4)}')` : `brClose();showPanel('${x.go}')`}">
      <span class="br-sug-i">${x.icon}</span><span class="br-sug-t"><b>${escapeHtml(x.text)}</b><small>${escapeHtml(x.why || '')}</small></span><span class="br-sug-go">›</span></button>`).join('')
    : '<div class="br-empty">Nothing needs you right now. 👌 Load today\'s reports and I\'ll keep an eye on them.</div>';
}

function brTabShow(t) {
  brTab = t;
  document.querySelectorAll('.br-tab').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  document.querySelectorAll('.br-pane').forEach(p => p.style.display = p.dataset.t === t ? '' : 'none');
  if (t === 'think') brRenderThink();
  if (t === 'health') brHealth();
  if (t === 'fix') { brRenderFixes(); const s = document.getElementById('brFixPage'); if (s && !s.value) s.value = document.querySelector('.panel.active')?.id.slice(6) || ''; }
  if (t === 'learned') brRenderLearned();
}

function brOpen(tab) {
  if (!document.getElementById('brSheet')) brBuild();
  document.getElementById('brSheet').classList.add('open');
  brTabShow(tab || 'think');
  if (!tab || tab === 'think') setTimeout(() => document.getElementById('brQ')?.focus({ preventScroll: true }), 60);
}
function brClose() { document.getElementById('brSheet')?.classList.remove('open'); }

function brBuild() {
  const pages = [...document.querySelectorAll('.nav-item[data-panel]')].map(n => `<option value="${n.dataset.panel}">${escapeHtml(n.textContent.replace(/[\d—✓]+\s*$/, '').trim())}</option>`).join('');
  const el = document.createElement('div');
  el.id = 'brSheet';
  el.className = 'br-overlay';
  el.innerHTML = `
    <div class="br-sheet" role="dialog" aria-label="Ops Brain">
      <div class="br-head"><span class="br-logo">🧠</span><div><b>Ops Brain</b><small>Thinks with you · learns how you work</small></div><button class="br-x" onclick="brClose()">✕</button></div>
      <form class="br-ask" onsubmit="event.preventDefault();brTabShow('think');brAsk(document.getElementById('brQ').value)">
        <input id="brQ" type="search" autocomplete="off" placeholder="Ask anything… room 512 · how do I post TD · fix: …"/>
        <button class="btn gold" type="submit">Ask</button>
      </form>
      <div class="br-tabs">
        <button class="br-tab" data-t="think" onclick="brTabShow('think')">💡 Now</button>
        <button class="br-tab" data-t="health" onclick="brTabShow('health')">🩺 Health</button>
        <button class="br-tab" data-t="fix" onclick="brTabShow('fix')">🛠 Fix requests</button>
        <button class="br-tab" data-t="learned" onclick="brTabShow('learned')">🧠 Learned</button>
      </div>
      <div class="br-scroll">
        <div class="br-pane" data-t="think"><div id="brAnswers"></div><div class="br-sec">What I'd do next</div><div id="brThink"></div></div>
        <div class="br-pane" data-t="health"><div id="brHealth"></div></div>
        <div class="br-pane" data-t="fix">
          <div class="br-card">
            <div class="br-title">Something wrong, or a change you want?</div>
            <div class="br-body">Write it like you'd tell a colleague. It's saved for the team; <b>Send on GitHub</b> passes it to the developer (Claude), who fixes the code and pushes an update. You see it in ✨ What's new. Don't write guest names — GitHub is public.</div>
            <select id="brFixPage"><option value="">Which page? (any)</option>${pages}</select>
            <textarea id="brFixText" class="tt-textarea" placeholder="e.g. On Package Audit the late checkout at 6 pm still shows as deny…"></textarea>
            <button class="btn gold" onclick="brSaveFix()">Save request</button>
          </div>
          <div id="brFixList"></div>
        </div>
        <div class="br-pane" data-t="learned"><div id="brLearned"></div></div>
      </div>
    </div>`;
  el.addEventListener('click', e => { if (e.target === el) brClose(); });
  document.body.appendChild(el);
}

// Home: top suggestions under the tiles
function brHomeStrip() {
  const box = document.getElementById('homeBrain');
  if (!box) return;
  if (typeof hoPref === 'function' && (!hoPref('brainOn') || !hoPref('brainHome'))) { box.innerHTML = ''; return; }
  const s = brSuggestions().slice(0, 3);
  box.innerHTML = s.length ? `<div class="home-brain-h">🧠 Ops Brain suggests</div>` + s.map(x => `<button class="br-sug ${x.tone}" onclick="${x.go.startsWith('tab:') ? `brOpen('${x.go.slice(4)}')` : `showPanel('${x.go}')`}"><span class="br-sug-i">${x.icon}</span><span class="br-sug-t"><b>${escapeHtml(x.text)}</b><small>${escapeHtml(x.why || '')}</small></span><span class="br-sug-go">›</span></button>`).join('') : '';
}

document.addEventListener('DOMContentLoaded', () => {
  brTaught = _brLS.get('brain_taught_cache', {}) || {};
  const fab = document.createElement('button');
  fab.id = 'brFab';
  fab.className = 'br-fab';
  fab.title = 'Ops Brain — ask, suggestions, health check (Ctrl+J)';
  fab.innerHTML = '🧠';
  fab.onclick = () => brOpen();
  document.body.appendChild(fab);
  if (_brLS.get(BR_ERR_KEY, []).some(e => Date.now() - e.t < 864e5)) fab.classList.add('alert');
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); brOpen(); } if (e.key === 'Escape') brClose(); });
  setTimeout(() => {
    if (typeof fbListen === 'function') {
      fbListen('brain/taught', v => { brTaught = v || {}; _brLS.set('brain_taught_cache', brTaught); if (brTab === 'learned') brRenderLearned(); });
      fbListen('brain/fixes', v => { brFixes = v || {}; if (brTab === 'fix') brRenderFixes(); });
    }
    brTrackPanel(document.querySelector('.panel.active')?.id.slice(6));
  }, 1500);
});

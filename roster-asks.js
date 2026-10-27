// ═══════════════════════════════════════════════════════════
//  roster-asks.js — day-off requests from the phone, one-tap approval
//
//  Staff: Roster → My shifts → 🙋 Ask for a day off (or askOpen()):
//    a day off, annual leave, or a shift preference (e.g. mornings only)
//    for one day or a few, with a note. They see their requests and the
//    answer under My shifts, and Ops Brain tells them once it's decided.
//  Managers (whoever may edit the roster, roCanEdit()): the waiting list
//  on the Roster builder page and the Roster page, ✓ Approve / ✕ Decline.
//    • a week not posted yet → the request goes into the builder's
//      requests for that week (split per week), so Build keeps it;
//    • a week already posted → nothing changes by itself: the manager is
//      told, and can put OFF / AL on those days in one tap
//      (rtMarkAbsent, the same as 🤒 Sick / leave) or open the week.
//  Swaps are roster-swap.js: the dialog links there.
//  📲 Phone (notify-hub.js): managers when a request comes in, the asker
//  when it's answered.
//
//  Firebase: roster/asks/{id} = { key, name, type: off | leave | band,
//    from, to, code, note, at, status: waiting | yes | no, by,
//    decidedAt, why, done: { week: 'builder' | 'posted' | 'roster' } }
// ═══════════════════════════════════════════════════════════

let askAll = {};
const ASK_MAX_DAYS = 31;
const ASK_SEEN_KEY = 'roster_asks_seen_v1';
const _askQ = s => JSON.stringify(String(s)).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const _askMe = () => (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || ((roStaff[roMeKey] || {}).name) || 'Someone';
const _askName = k => (roStaff[k] || {}).name || k;
const _askFirst = k => String(_askName(k)).split(' ')[0];
const _askEd = () => typeof roCanEdit === 'function' && roCanEdit();
const _askOk = id => /^[\w-]{1,40}$/.test(String(id));

function _askDays(from, to) {
  const out = []; if (!from) return out;
  to = to && to >= from ? to : from;
  for (let d = from, n = 0; d <= to && n < 400; d = roAdd(d, 1), n++) out.push(d);
  return out;
}
function _askBands() { return typeof RB_BANDS !== 'undefined' ? RB_BANDS : { morning: { label: 'Morning' }, day: { label: 'Day (morning + 12:00)' }, evening: { label: 'Evening' }, night: { label: 'Night' } }; }
function askTypeLbl(a) {
  if (!a) return '';
  if (a.type === 'leave') return a.code && a.code !== 'AL' ? `Leave (${a.code})` : 'Annual leave';
  if (a.type === 'band') return `${(_askBands()[a.code] || {}).label || a.code || 'A'} shifts only`;
  return 'Day off';
}
function askWhen(a) {
  const to = a.to || a.from, n = _askDays(a.from, to).length;
  return a.from === to ? roDayLbl(a.from, true) : `${roDayLbl(a.from)} → ${roDayLbl(to)} ${roDate(to).toLocaleDateString('en-GB', { month: 'short' })} · ${n} days`;
}
function _askPosted(w) {
  if (typeof rtIsPublished === 'function') return rtIsPublished(w);
  return [0, 1, 2, 3, 4, 5, 6].some(d => Object.keys(roDays[roAdd(w, d)] || {}).length);
}
/** The days of a request, cut per Monday–Sunday week (the way the builder keeps its requests). */
function askWeeks(from, to) {
  const out = [];
  _askDays(from, to).forEach(d => { const w = roMonday(roDate(d)), last = out[out.length - 1]; if (last && last.week === w) last.to = d; else out.push({ week: w, from: d, to: d }); });
  return out;
}

// ── Checks ────────────────────────────────────────────────
/** Mistakes that stop a request being sent. */
function askErrors(r) {
  const e = [];
  if (!r.from) { e.push('Choose the first day'); return e; }
  const to = r.to || r.from;
  if (to < r.from) e.push('The last day is before the first day');
  if (r.from < roToday()) e.push('The first day is in the past');
  else if (_askDays(r.from, to).length > ASK_MAX_DAYS) e.push(`That is more than ${ASK_MAX_DAYS} days: ask for a shorter time`);
  if (r.type === 'band' && !r.code) e.push('Choose the shift you prefer');
  return e;
}
/** Things the asker and the manager should know: already off, a public holiday, someone else asked the same days. */
function askClashes(r, skipId) {
  const out = []; if (!r || !r.from || !r.key) return out;
  const to = r.to && r.to >= r.from ? r.to : r.from, days = _askDays(r.from, to);
  if (days.length > 62) return out;
  const fn = r.key === roMeKey ? 'You are' : `${_askFirst(r.key)} is`;
  if (r.type !== 'band') {
    const off = days.filter(d => { const i = roInfo(roCode(r.key, d)); return i && (i.type === 'off' || i.type === 'leave'); });
    if (off.length) out.push(`${fn} already off on ${off.slice(0, 4).map(d => roDayLbl(d)).join(', ')}${off.length > 4 ? '…' : ''}`);
  }
  try {
    const hol = typeof rbHolidays === 'function' ? rbHolidays() : {};
    const ph = days.filter(d => d in hol);
    if (ph.length) out.push(`Public holiday on ${ph.map(d => roDayLbl(d) + (hol[d] ? ` (${hol[d]})` : '')).join(', ')}: a busy day`);
  } catch (_) {}
  const g = (roStaff[r.key] || {}).group || '', overlap = x => x && x.from && x.from <= to && (x.to || x.from) >= r.from;
  const mine = [], others = new Set();
  Object.entries(askAll || {}).forEach(([id, x]) => {
    if (id === skipId || !x || x.status === 'no' || !overlap(x)) return;
    if (x.key === r.key) mine.push(x); else if (x.type !== 'band' && r.type !== 'band' && ((roStaff[x.key] || {}).group || '') === g) others.add(_askFirst(x.key));
  });
  if (typeof rbReqs !== 'undefined' && r.type !== 'band') Object.values(rbReqs || {}).forEach(wk => Object.values(wk || {}).forEach(x => {
    if (x && x.key !== r.key && (x.type === 'off' || x.type === 'leave' || x.type === 'ph') && overlap(x) && ((roStaff[x.key] || {}).group || '') === g) others.add(_askFirst(x.key));
  }));
  if (mine.length) out.push(`${r.key === roMeKey ? 'You' : _askFirst(r.key)} already asked for some of these days`);
  if (others.size) out.push(`${[...others].slice(0, 3).join(', ')}${others.size > 3 ? ` and ${others.size - 3} more` : ''} also asked for time off then`);
  return out;
}

// ── Asking (staff) ────────────────────────────────────────
function askOpen(type) {
  if (typeof roMeKey === 'undefined' || !roMeKey) {
    showToast('Choose your name in My shifts first', 'warn');
    if (typeof showPanel === 'function') showPanel('roster');
    return;
  }
  const t1 = roAdd(roToday(), 1), B = _askBands();
  document.getElementById('askDlg')?.remove();
  const d = document.createElement('div');
  d.id = 'askDlg'; d.className = 'ri-viewer';
  d.innerHTML = `<div class="card rs-dlg ask-dlg" role="dialog" aria-label="Ask for a day off">
    <div class="ro-card-hd"><b>🙋 Ask for a day off</b><button class="ro-x" onclick="document.getElementById('askDlg').remove()" aria-label="Close">✕</button></div>
    <div class="ask-types" role="radiogroup">
      ${[['off', '🛌 Day off'], ['leave', '🌴 Annual leave'], ['band', '⏰ Shift wish']].map(([v, l]) => `<button type="button" class="fchip${(type || 'off') === v ? ' on' : ''}" data-t="${v}" onclick="askPickType('${v}')">${l}</button>`).join('')}
    </div>
    <div class="rs-form">
      <label>From<input type="date" id="askFrom" min="${roToday()}" value="${t1}" onchange="askFromChanged()"></label>
      <label>To<input type="date" id="askTo" min="${roToday()}" value="${t1}" oninput="askPreview()" onchange="askPreview()"></label>
      <label class="rs-wide" id="askBandL" hidden>Shift I prefer<select id="askBand" onchange="askPreview()">${Object.keys(B).map(k => `<option value="${k}">${escapeHtml(B[k].label)} only</option>`).join('')}</select></label>
      <label class="rs-wide">Note <small>(optional)</small><input id="askNote" maxlength="140" placeholder="e.g. family visit, doctor, exam"></label>
    </div>
    <div id="askPrev" class="rs-prev"></div>
    <div class="ro-acts ask-acts"><button class="btn gold" id="askSendBtn" onclick="askSend()">Send the request</button>
      ${typeof rsAskOpen === 'function' ? `<button class="btn ghost sm" onclick="document.getElementById('askDlg').remove();rsAskOpen()">🔁 Want to swap instead?</button>` : ''}</div>
    <small class="ask-foot">Your manager approves it on their phone. You see the answer here under My shifts.</small>
  </div>`;
  d.addEventListener('click', e => { if (e.target === d) d.remove(); });
  document.body.appendChild(d);
  d.dataset.t = type || 'off';
  askPickType(type || 'off');
}
function askPickType(t) {
  const d = document.getElementById('askDlg'); if (!d) return;
  d.dataset.t = t;
  d.querySelectorAll('.ask-types .fchip').forEach(b => { b.classList.toggle('on', b.dataset.t === t); b.setAttribute('aria-checked', b.dataset.t === t); });
  document.getElementById('askBandL').hidden = t !== 'band';
  askPreview();
}
function askFromChanged() {
  const f = document.getElementById('askFrom'), t = document.getElementById('askTo');
  if (f.value) { t.min = f.value; if (!t.value || t.value < f.value) t.value = f.value; }
  askPreview();
}
function _askForm() {
  const d = document.getElementById('askDlg'), t = (d && d.dataset.t) || 'off';
  const from = document.getElementById('askFrom').value, to = document.getElementById('askTo').value || from;
  return { key: roMeKey, type: t, from, to, code: t === 'band' ? document.getElementById('askBand').value : t === 'leave' ? 'AL' : '', note: document.getElementById('askNote').value.trim() };
}
function askPreview() {
  const box = document.getElementById('askPrev'); if (!box) return;
  const r = _askForm(), err = askErrors(r), btn = document.getElementById('askSendBtn');
  btn.disabled = !!err.length;
  if (err.length) { box.innerHTML = `<div class="ask-err">✕ ${err.map(escapeHtml).join(' · ')}</div>`; return; }
  const days = _askDays(r.from, r.to), warn = askClashes(r);
  const cells = days.slice(0, 14).map(d => { const c = roCode(roMeKey, d), i = roInfo(c); return `<span class="ask-day"><small>${escapeHtml(roDayLbl(d))}</small>${_askCell(c)}</span>`; }).join('');
  const posted = askWeeks(r.from, r.to).some(s => _askPosted(s.week));
  box.innerHTML = `<div class="ask-sum"><b>${escapeHtml(askTypeLbl(r))}</b> · ${escapeHtml(askWhen(r))}</div>
    <div class="ask-days">${cells}${days.length > 14 ? `<span class="ask-more">+${days.length - 14} more</span>` : ''}</div>
    ${posted ? '<div class="ask-info">ℹ The roster for some of these days is already out: if approved, your manager changes it.</div>' : ''}
    ${warn.length ? `<div class="rs-warn">⚠ ${warn.map(escapeHtml).join(' · ')}. You can still ask.</div>` : '<div class="rs-ok">✓ No clash found.</div>'}`;
}
function _askCell(code) {
  const i = roInfo(code);
  return `<span class="rs-cell ro-t-${i ? i.type : 'none'}">${escapeHtml(i ? (roCellTxt(i) || i.label) : '—')}</span>`;
}
function askSend() {
  const r = _askForm(), err = askErrors(r);
  if (err.length) { showToast(err[0], 'warn'); return; }
  const id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const rec = { key: r.key, name: _askName(r.key), type: r.type, from: r.from, to: r.to || r.from, code: r.code || '', note: r.note.slice(0, 140), at: Date.now(), status: 'waiting', askedBy: _askMe() };
  askAll[id] = rec;
  if (typeof fbSet === 'function') fbSet('roster/asks/' + id, rec);
  if (typeof logActivity === 'function') try { logActivity('dayoff_asked', `${rec.name} · ${askTypeLbl(rec)} · ${rec.from}${rec.to !== rec.from ? ' → ' + rec.to : ''}`); } catch (_) {}
  document.getElementById('askDlg')?.remove();
  showToast('🙋 Request sent. You\'ll see the answer under My shifts.', 'ok');
  askRenderAll();
}
function askWithdraw(id) {
  const a = askAll[id]; if (!a || a.key !== roMeKey || a.status !== 'waiting') return;
  if (!confirm('Take back this request?')) return;
  delete askAll[id];
  if (typeof fbSet === 'function') fbSet('roster/asks/' + id, null);
  showToast('Request taken back', 'ok');
  askRenderAll();
}

// ── Seen (so a decision is told once) ─────────────────────
function _askSeen() { try { return JSON.parse(localStorage.getItem(ASK_SEEN_KEY) || '{}') || {}; } catch (_) { return {}; } }
function askMarkSeen(id, st) {
  try { const s = _askSeen(); s[id + ':' + st] = Date.now(); Object.keys(s).forEach(k => { if (s[k] < Date.now() - 90 * 864e5) delete s[k]; }); localStorage.setItem(ASK_SEEN_KEY, JSON.stringify(s)); } catch (_) {}
}
const _askIsSeen = (id, st) => !!_askSeen()[id + ':' + st];

// ── Staff: my requests, under My shifts ───────────────────
function _askMine() {
  if (!roMeKey) return [];
  const old = roAdd(roToday(), -14);
  return Object.entries(askAll || {}).map(([id, a]) => Object.assign({ id }, a))
    .filter(a => a && a.key === roMeKey && _askOk(a.id) && ((a.to || a.from) >= roToday() || (a.decidedAt || a.at || 0) > Date.now() - 7 * 864e5) && (a.to || a.from) >= old)
    .sort((a, b) => (a.status === 'waiting') === (b.status === 'waiting') ? a.from.localeCompare(b.from) : a.status === 'waiting' ? -1 : 1).slice(0, 6);
}
function _askStatus(a) {
  if (a.status === 'yes') return `<span class="ask-st yes">✓ Approved</span>`;
  if (a.status === 'no') return `<span class="ask-st no">✕ Declined</span>`;
  return `<span class="ask-st wait">⏳ Waiting</span>`;
}
function askMineHtml() {
  const list = _askMine();
  const row = a => `<div class="ask-row ask-${a.status}">
      <div class="ask-main"><b>${escapeHtml(askTypeLbl(a))}</b><span>${escapeHtml(askWhen(a))}</span>
        ${a.note ? `<small>“${escapeHtml(a.note)}”</small>` : ''}
        ${a.status === 'no' && a.why ? `<small class="ask-why-t">Reason: ${escapeHtml(a.why)}</small>` : ''}
        ${a.status !== 'waiting' && a.by ? `<small>by ${escapeHtml(String(a.by).split(' ')[0])}</small>` : ''}</div>
      <div class="ask-side">${_askStatus(a)}${a.status === 'waiting' ? `<button class="btn sm ghost" onclick="askWithdraw(${_askQ(a.id)})">Take back</button>` : ''}</div>
    </div>`;
  return `<div class="ask-mine" id="askMine">
    <div class="ask-mine-hd"><button class="btn sm gold" onclick="askOpen()">🙋 Ask for a day off</button>${list.length ? `<small>${list.filter(a => a.status === 'waiting').length ? 'Waiting for your manager' : 'Your requests'}</small>` : '<small>Day off, annual leave or a shift wish</small>'}</div>
    ${list.map(row).join('')}
  </div>`;
}
function askRenderMine() {
  const me = document.getElementById('roMine'); if (!me) return;
  me.querySelector('#askMine')?.remove();
  if (!roMeKey) return;
  me.insertAdjacentHTML('beforeend', askMineHtml());
  // seen on the Roster page = told
  if (document.getElementById('panel-roster')?.classList.contains('active') && document.visibilityState !== 'hidden') _askMine().forEach(a => { if (a.status !== 'waiting' && !_askIsSeen(a.id, a.status)) askMarkSeen(a.id, a.status); });
}

// ── Managers: the waiting list ────────────────────────────
function askWaiting() {
  return Object.entries(askAll || {}).map(([id, a]) => Object.assign({ id }, a))
    .filter(a => a && a.status === 'waiting' && a.key && a.from && _askOk(a.id) && (a.to || a.from) >= roToday())
    .sort((a, b) => a.from.localeCompare(b.from) || (a.at || 0) - (b.at || 0));
}
function askMgrHtml() {
  const list = askWaiting();
  const recent = Object.entries(askAll || {}).map(([id, a]) => Object.assign({ id }, a)).filter(a => a && a.status !== 'waiting' && _askOk(a.id) && (a.decidedAt || 0) > Date.now() - 3 * 864e5).sort((a, b) => b.decidedAt - a.decidedAt).slice(0, 5);
  if (!list.length && !recent.length) return '';
  const row = a => {
    const warn = a.status === 'waiting' ? askClashes(a, a.id) : [], segs = askWeeks(a.from, a.to || a.from), posted = segs.some(s => _askPosted(s.week));
    const g = (roStaff[a.key] || {}).group;
    const cur = a.type !== 'band' ? _askDays(a.from, a.to).slice(0, 7).map(d => roCode(a.key, d)).filter(Boolean) : [];
    return `<div class="ask-row ask-m ask-${a.status}" data-id="${escapeHtml(a.id)}">
      <div class="ask-main"><b>${escapeHtml(_askName(a.key))}${g ? ` <i>· ${escapeHtml(g)}</i>` : ''}</b>
        <span>${escapeHtml(askTypeLbl(a))} · ${escapeHtml(askWhen(a))}</span>
        ${a.note ? `<small>“${escapeHtml(a.note)}”</small>` : ''}
        ${a.status === 'waiting' && posted ? `<small class="ask-pt">📌 ${segs.every(s => _askPosted(s.week)) ? 'Week already posted' : 'Part of it is in a posted week'}${cur.length ? `: now ${cur.map(c => escapeHtml(roCellTxt(roInfo(c)) || c)).join(', ')}` : ''}</small>` : ''}
        ${warn.length ? `<small class="rs-w">⚠ ${warn.map(escapeHtml).join(' · ')}</small>` : ''}
        ${a.status === 'no' && a.why ? `<small>Reason: ${escapeHtml(a.why)}</small>` : ''}
        ${a.status !== 'waiting' && a.by ? `<small>${a.status === 'yes' ? 'Approved' : 'Declined'} by ${escapeHtml(String(a.by).split(' ')[0])}</small>` : ''}
      </div>
      <div class="ask-side">${a.status === 'waiting' ? `<button class="btn sm gold" onclick="askApprove(${_askQ(a.id)})">✓ Approve</button><button class="btn sm" onclick="askDeclineAsk(${_askQ(a.id)},this)">✕ Decline</button>` : _askStatus(a)}</div>
      ${a.status === 'waiting' ? `<div class="ask-decl" hidden><input maxlength="120" placeholder="Reason (optional), e.g. two people already off" onkeydown="if(event.key==='Enter')askDecline(${_askQ(a.id)},this.value)"><button class="btn sm" onclick="askDecline(${_askQ(a.id)},this.previousElementSibling.value)">Decline</button></div>` : ''}
    </div>`;
  };
  return `<div class="ro-card-hd"><b>🙋 Day-off requests</b><span>${list.length ? `<i class="ask-count">${list.length}</i> waiting` : 'all answered'}</span></div>
    ${list.length ? list.map(row).join('') : '<div class="ro-empty">Nothing waiting.</div>'}
    ${recent.length ? `<details class="rs-recent"><summary>Answered lately</summary>${recent.map(row).join('')}</details>` : ''}`;
}
function askRenderMgr() {
  const ed = _askEd(), html = ed ? askMgrHtml() : '';
  // the Roster builder page: under the week bar
  const root = document.getElementById('rbRoot');
  if (root) {
    let box = document.getElementById('askMgrRb');
    if (!html) box?.remove();
    else {
      if (!box) { box = document.createElement('div'); box.id = 'askMgrRb'; box.className = 'card ask-card'; const bar = root.querySelector('.rb-bar'); if (bar) bar.after(box); else if (root.querySelector('.page-hd')) root.querySelector('.page-hd').after(box); else box = null; }
      if (box && !box.contains(document.activeElement)) box.innerHTML = html;
    }
  }
  // the Roster page: next to the swaps
  const sw = document.getElementById('roSwaps');
  if (sw) {
    let box = document.getElementById('askMgrRo');
    if (!html) box?.remove();
    else {
      if (!box) { box = document.createElement('div'); box.id = 'askMgrRo'; box.className = 'card ask-card'; sw.after(box); }
      if (!box.contains(document.activeElement)) box.innerHTML = html;
    }
  }
  askBadge();
}
function askBadge() {
  const n = _askEd() ? askWaiting().length : 0;
  [['roBuildBtn', 'askPillB'], ['nav-roster', 'askPillN']].forEach(([host, id]) => {
    const h = document.getElementById(host); if (!h) return;
    let p = document.getElementById(id);
    if (!n) { p?.remove(); return; }
    if (!p) { p = document.createElement('i'); p.id = id; p.className = 'ask-pill'; h.appendChild(p); }
    p.textContent = n; p.title = `${n} day-off request${n === 1 ? '' : 's'} waiting`;
  });
}
function askRenderAll() { askRenderMine(); askRenderMgr(); }

function askDeclineAsk(id, btn) {
  const row = btn.closest('.ask-row'), box = row && row.querySelector('.ask-decl');
  if (!box) { askDecline(id, ''); return; }
  box.hidden = !box.hidden;
  if (!box.hidden) box.querySelector('input').focus();
}
function _askSet(id, patch) {
  const a = askAll[id]; if (!a) return;
  Object.assign(a, patch);
  if (typeof fbUpdate === 'function') fbUpdate('roster/asks/' + id, patch); else fbSet('roster/asks/' + id, a);
}
function askDecline(id, why) {
  const a = askAll[id]; if (!a || a.status !== 'waiting') return;
  if (!_askEd()) { showToast('A supervisor or manager answers requests', 'err'); return; }
  _askSet(id, { status: 'no', by: _askMe(), decidedAt: Date.now(), why: String(why || '').trim().slice(0, 120) });
  if (typeof logActivity === 'function') try { logActivity('dayoff_declined', `${_askName(a.key)} · ${a.from}`); } catch (_) {}
  showToast(`Declined. ${_askFirst(a.key)} sees it on their phone.`, 'ok');
  askRenderAll();
}
/** ✓ Approve: weeks still to build get a builder request; posted weeks are never changed silently. */
function askApprove(id) {
  const a = askAll[id]; if (!a || a.status !== 'waiting') return;
  if (!_askEd()) { showToast('A supervisor or manager answers requests', 'err'); return; }
  const today = roToday(), from = a.from < today ? today : a.from, to = a.to && a.to >= a.from ? a.to : a.from;
  if (to < today) { showToast('These days are already past', 'warn'); return; }
  const segs = askWeeks(from, to), done = {}, posted = [];
  segs.forEach((s, i) => {
    if (_askPosted(s.week)) { posted.push(s); done[s.week] = 'posted'; return; }
    const rid = 'q' + Date.now().toString(36) + i + 'a', r = { key: a.key, type: a.type === 'band' ? 'band' : a.type === 'leave' ? 'leave' : 'off', from: s.from, to: s.to, code: a.type === 'off' ? '' : (a.code || (a.type === 'leave' ? 'AL' : '')), ask: id };
    if (typeof rbReqs !== 'undefined') (rbReqs[s.week] = rbReqs[s.week] || {})[rid] = r;
    if (typeof fbSet === 'function') fbSet(`roster/builder/requests/${s.week}/${rid}`, r);
    done[s.week] = 'builder';
  });
  _askSet(id, { status: 'yes', by: _askMe(), decidedAt: Date.now(), why: null, done });
  if (typeof logActivity === 'function') try { logActivity('dayoff_approved', `${_askName(a.key)} · ${askTypeLbl(a)} · ${a.from}${to !== a.from ? ' → ' + to : ''}`); } catch (_) {}
  askRenderAll();
  if (typeof rbRender === 'function' && document.getElementById('panel-roster-build')?.classList.contains('active')) rbRender();
  if (posted.length) askPostedDlg(id, posted);
  else showToast(`✓ Approved. It's in the builder's requests for ${segs.length > 1 ? segs.length + ' weeks' : 'that week'}; ${_askFirst(a.key)} is told.`, 'ok');
}
/** The week is out already: say so, and offer the safe ways to change it. */
function askPostedDlg(id, segs) {
  const a = askAll[id]; if (!a) return;
  const band = a.type === 'band', code = a.type === 'leave' ? (a.code || 'AL') : 'OFF';
  const days = [].concat(...segs.map(s => _askDays(s.from, s.to)));
  const working = days.filter(d => { const i = roInfo(roCode(a.key, d)); return !(i && (i.type === 'off' || i.type === 'leave')); });
  document.getElementById('askDlg')?.remove();
  const d = document.createElement('div');
  d.id = 'askDlg'; d.className = 'ri-viewer';
  d.innerHTML = `<div class="card rs-dlg ask-dlg" role="dialog">
    <div class="ro-card-hd"><b>✓ Approved · the week is already posted</b><button class="ro-x" onclick="document.getElementById('askDlg').remove()" aria-label="Close">✕</button></div>
    <p class="ask-p">The roster for these days is already out, so nothing changed by itself. ${band ? `Change ${escapeHtml(_askFirst(a.key))}'s shifts to <b>${escapeHtml(((_askBands()[a.code] || {}).label || a.code).toLowerCase())}</b> on the roster.` : `Change it on the roster: <b>${escapeHtml(code)}</b> on those days.`}</p>
    <div class="ask-days">${days.slice(0, 14).map(dt => `<span class="ask-day"><small>${escapeHtml(roDayLbl(dt))}</small>${_askCell(roCode(a.key, dt))}</span>`).join('')}</div>
    ${!band && !working.length ? `<div class="rs-ok">✓ ${escapeHtml(_askFirst(a.key))} is already off on all of these days: nothing to change.</div>` : ''}
    <div class="ro-acts ask-acts">
      ${!band && working.length && typeof rtMarkAbsent === 'function' ? `<button class="btn gold" onclick="askPutOnRoster(${_askQ(id)})">Put ${escapeHtml(code)} on ${working.length === 1 ? 'that day' : `those ${working.length} days`} now</button>` : ''}
      ${typeof rtOfferCover === 'function' ? `<button class="btn${band || !working.length ? ' gold' : ''}" onclick="document.getElementById('askDlg').remove();rtOfferCover(${_askQ(segs[0].week)})">✏️ Open the roster to change it</button>` : `<button class="btn" onclick="document.getElementById('askDlg').remove();roWeek=${_askQ(segs[0].week)};showPanel('roster')">Open the roster</button>`}
      <button class="btn ghost" onclick="document.getElementById('askDlg').remove()">Later</button>
    </div>
    ${!band && working.length ? `<small class="ask-foot">“Put ${escapeHtml(code)}” changes only their working days, tells the people concerned (like 🤒 Sick / leave) and shows any gap under Cover to fix.</small>` : ''}
  </div>`;
  d.addEventListener('click', e => { if (e.target === d) d.remove(); });
  document.body.appendChild(d);
}
function askPutOnRoster(id) {
  const a = askAll[id]; if (!a || !_askEd() || typeof rtMarkAbsent !== 'function') return;
  const code = a.type === 'leave' ? (a.code || 'AL') : 'OFF', today = roToday();
  const segs = askWeeks(a.from < today ? today : a.from, a.to || a.from).filter(s => _askPosted(s.week));
  if (!segs.length) return;
  const touched = rtMarkAbsent(a.key, segs[0].from, segs[segs.length - 1].to, code, true) || [];
  const done = Object.assign({}, a.done); segs.forEach(s => { done[s.week] = 'roster'; });
  _askSet(id, { done });
  document.getElementById('askDlg')?.remove();
  const n = (touched.changed || []).length;
  showToast(n ? `${_askFirst(a.key)}: ${code} on ${n} day${n === 1 ? '' : 's'} of the posted roster. Check Cover to fix for any gap.` : `Nothing to change: ${_askFirst(a.key)} was already off`, 'ok');
  askRenderAll();
}

// ── 📲 The phone (notify-hub.js) ──────────────────────────
// Managers: a new request waiting. The asker: theirs approved or declined. Once each, from one of your
// devices, and only what happened after the app opened (what was waiting before is in Ops Brain).
function askPhone() {
  const H = window.hoNotify;
  if (!H || typeof H.send !== 'function') return;
  const ed = _askEd(), me = typeof roMeKey !== 'undefined' ? roMeKey : '';
  Object.entries(askAll || {}).forEach(([id, a]) => {
    try {
      if (!a || !a.key || !a.from || !_askOk(id)) return;
      if (ed && a.status === 'waiting' && a.key !== me && H.fresh(a.at)) H.send({ cat: 'roster', prio: 3, at: a.at, url: 'roster', key: `ask_${id}_new`,
        title: `🙋 ${_askFirst(a.key)} asks for ${askTypeLbl(a).toLowerCase()}`, body: `${askWhen(a)}${a.note ? ' · “' + a.note + '”' : ''} — approve or decline on the Roster page.` });
      if (me && a.key === me && (a.status === 'yes' || a.status === 'no') && H.fresh(a.decidedAt)) H.send({ cat: 'roster', prio: 4, at: a.decidedAt, url: 'roster', key: `ask_${id}_${a.status}`,
        title: a.status === 'yes' ? `✅ Your ${askTypeLbl(a).toLowerCase()} was approved` : `✕ Your ${askTypeLbl(a).toLowerCase()} was declined`,
        body: `${askWhen(a)}${a.by ? ' · by ' + String(a.by).split(' ')[0] : ''}${a.status === 'no' && a.why ? ' · Reason: ' + a.why : ''}` });
    } catch (_) {}
  });
}

// ── Style ─────────────────────────────────────────────────
function askStyle() {
  if (document.getElementById('askStyle')) return;
  const s = document.createElement('style'); s.id = 'askStyle';
  s.textContent = `
.ask-mine { grid-column: 1 / -1; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); min-width: 0; }
.ask-mine-hd { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.ask-mine-hd small { font-size:.74rem; color:var(--text3); }
.ask-row { display:grid; grid-template-columns: minmax(0,1fr) auto; gap:6px 12px; align-items:center; padding:10px 0; border-top:1px solid var(--border); min-width:0; }
.ask-mine .ask-row:first-of-type { margin-top:10px; }
.ask-card > .ask-row:first-of-type { border-top:0; }
.ask-main { display:flex; flex-direction:column; gap:2px; min-width:0; }
.ask-main b { font-size:.86rem; color:var(--text); } .ask-main b i { font-style:normal; font-weight:500; color:var(--text3); font-size:.76rem; }
.ask-main span { font-size:.8rem; color:var(--text2); }
.ask-main small { font-size:.72rem; color:var(--text3); overflow-wrap:anywhere; }
.ask-main .rs-w, .ask-main .ask-pt { color: var(--amber, var(--gold)); }
.ask-main .ask-why-t { color: var(--red); }
.ask-side { display:flex; gap:6px; align-items:center; flex-wrap:wrap; justify-content:flex-end; }
.ask-st { font-size:.72rem; font-weight:650; padding:3px 9px; border-radius:99px; border:1px solid var(--border); background:var(--card2); white-space:nowrap; }
.ask-st.wait { color: var(--amber, var(--gold)); } .ask-st.yes { color: var(--green); } .ask-st.no { color: var(--red); }
.ask-row.ask-no, .ask-row.ask-yes { opacity:.85; }
.ask-decl { grid-column: 1 / -1; display:flex; gap:8px; }
.ask-decl[hidden] { display:none; }
.ask-decl input { flex:1; min-width:0; font:inherit; font-size:.85rem; color:var(--text); background:var(--bg2, var(--card2)); border:1px solid var(--border2, var(--border)); border-radius:10px; padding:8px 10px; }
.ask-card { margin-bottom: 14px; padding: 18px 20px 10px; }
@media (max-width: 600px) { .ask-card { padding: 14px 14px 6px; } }
.ask-count, .ask-pill { display:inline-block; font-style:normal; font:700 .7rem var(--mono); min-width:18px; text-align:center; padding:1px 6px; border-radius:99px; background: var(--gold, var(--accent)); color:#111; }
#nav-roster .ask-pill { margin-left:auto; } #roBuildBtn .ask-pill { margin-left:6px; }
.ask-types { display:flex; gap:6px; flex-wrap:wrap; margin: 2px 0 10px; }
.ask-types .fchip { min-height:38px; }
.ask-sum { font-size:.84rem; color:var(--text2); margin-bottom:8px; } .ask-sum b { color:var(--text); }
.ask-days { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px; }
.ask-day { display:flex; flex-direction:column; align-items:flex-start; gap:2px; } .ask-day small { font-size:.66rem; color:var(--text3); }
.ask-more { align-self:flex-end; font-size:.72rem; color:var(--text3); }
.ask-err { font-size:.8rem; color: var(--red); }
.ask-info { margin-top:6px; font-size:.76rem; color: var(--text2); }
.ask-acts { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
.ask-foot { display:block; margin-top:10px; font-size:.72rem; color:var(--text3); }
.ask-p { font-size:.86rem; color:var(--text2); margin: 0 0 10px; line-height:1.45; } .ask-p b { color:var(--text); }
.ask-dlg { max-height: calc(100vh - 32px); overflow:auto; }
@media (max-width: 600px) {
  .ask-row { grid-template-columns: 1fr; } .ask-side { justify-content:flex-start; }
  .ask-dlg .rs-form { grid-template-columns: 1fr 1fr; } .ask-dlg .rs-form .rs-wide { grid-column: 1 / -1; }
  .ask-dlg .rs-form input[type=date] { min-width:0; width:100%; }
  .ask-acts .btn { flex: 1 1 auto; }
}`;
  document.head.appendChild(s);
}

// ── Start ─────────────────────────────────────────────────
function askStart() {
  if (askStart.on) return; askStart.on = true;
  askStyle();
  setTimeout(() => {
    if (typeof fbListen !== 'function') return;
    fbListen('roster/asks', v => {
      const before = askAll; askAll = v && typeof v === 'object' ? v : {};
      // decided while the app is open: tell the asker straight away (once)
      if (typeof roMeKey !== 'undefined' && roMeKey) Object.entries(askAll).forEach(([id, a]) => {
        const b = before && before[id];
        if (a && b && a.key === roMeKey && b.status === 'waiting' && a.status !== 'waiting' && !_askIsSeen(id, a.status)) {
          showToast(a.status === 'yes' ? `✓ Your ${askTypeLbl(a).toLowerCase()} for ${roDayLbl(a.from)} was approved` : `✕ Your request for ${roDayLbl(a.from)} was declined${a.why ? ': ' + a.why : ''}`, a.status === 'yes' ? 'ok' : 'warn');
          askMarkSeen(id, a.status);
        }
      });
      askRenderAll();
      if (typeof blSoon === 'function') try { blSoon(); } catch (_) {}
      try { askPhone(); } catch (_) {}
    });
  }, 1800);
  // My shifts and the swaps list are drawn by roRenderSide; the builder by rbRender
  if (typeof roRenderSide === 'function') {
    const orig = roRenderSide;
    window.roRenderSide = roRenderSide = function () { orig.apply(this, arguments); try { askRenderAll(); } catch (e) { console.warn('[asks]', e); } };
  }
  if (typeof rbRender === 'function') {
    const origB = rbRender;
    window.rbRender = rbRender = function () { const r = origB.apply(this, arguments); try { askRenderMgr(); } catch (e) { console.warn('[asks]', e); } return r; };
  }
  if (typeof BR_FAQ !== 'undefined') {
    BR_FAQ.push({ q: 'day off request ask leave holiday vacation annual leave time off approve', t: 'Ask for a day off', a: 'Roster → My shifts → <b>🙋 Ask for a day off</b>: a day off, annual leave or a shift wish (e.g. mornings only), with a note. Your manager taps <b>Approve</b> or <b>Decline</b> on their phone and you see the answer under My shifts.', go: 'roster', kind: '💡 How the app works' });
  }
  (window.BL_THINKERS = window.BL_THINKERS || []).push(add => {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    // the asker: your request was answered (shown until you tap OK or see it on the Roster page)
    if (roMeKey) Object.entries(askAll || {}).forEach(([id, a]) => {
      if (!a || a.key !== roMeKey || (a.status !== 'yes' && a.status !== 'no') || !a.decidedAt || a.decidedAt < Date.now() - 7 * 864e5 || _askIsSeen(id, a.status)) return;
      const yes = a.status === 'yes';
      add({ id: `ask:${id}:${a.status}`, type: 'dayoffAnswer', icon: yes ? '✅' : '🙋', tone: yes ? 'idle' : 'warn',
        text: yes ? `Your ${askTypeLbl(a).toLowerCase()} (${askWhen(a)}) was approved${a.by ? ' by ' + String(a.by).split(' ')[0] : ''}.` : `Your ${askTypeLbl(a).toLowerCase()} (${askWhen(a)}) was declined${a.by ? ' by ' + String(a.by).split(' ')[0] : ''}.`,
        why: yes ? 'It goes on the roster when it is built or changed.' : (a.why ? 'Reason: ' + a.why : 'Talk to your manager, or ask a colleague to swap.'),
        acts: [['OK', () => askMarkSeen(id, a.status)], ['Open', () => { askMarkSeen(id, a.status); showPanel('roster'); }]] });
    });
    // managers: requests waiting
    if (_askEd()) {
      const w = askWaiting(); if (!w.length) return;
      add({ id: 'askWait:' + w.map(a => a.id).join(','), type: 'dayoffWait', icon: '🙋', tone: 'warn',
        text: w.length === 1 ? `${_askFirst(w[0].key)} asks for ${askTypeLbl(w[0]).toLowerCase()}: ${askWhen(w[0])}.` : `${w.length} day-off requests are waiting for you.`,
        why: w.length === 1 ? (w[0].note || 'Approve or decline in one tap.') : w.slice(0, 3).map(a => `${_askFirst(a.key)} ${roDayLbl(a.from)}`).join(', ') + (w.length > 3 ? '…' : ''),
        acts: [...(w.length === 1 ? [['✓ Approve', () => askApprove(w[0].id)]] : []), ['Open', () => { showPanel('roster'); setTimeout(() => document.getElementById('askMgrRo')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300); }]] });
    }
  });
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', askStart); else askStart();
}

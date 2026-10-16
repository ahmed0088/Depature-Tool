// ═══════════════════════════════════════════════════════════
//  morning-brief.js — ☀️ Morning brief
//  A manager's one-screen summary of the day: who is on, guests,
//  wake-up calls, shift tasks, monthly reports and open items.
//  It only reads data the other pages already hold; nothing is saved
//  except "already shown today" on this device.
//
//  mbOpen()     open the brief (also the ☀️ Brief button on Home)
//  mbText()     the same brief as plain text (Copy / WhatsApp)
//  Auto-open: owners and managers, once a day per device, 06:00–11:59,
//  a few seconds after the data has arrived. Off with hoSetPref('mbAuto', false).
//  Needs nothing in index.html but <script src="morning-brief.js"></script>.
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';

const SHOWN_KEY = 'mb_shown_v1';
const safe = (fn, fb) => { try { return fn(); } catch (_) { return fb; } };
const has = n => typeof window[n] === 'function';
const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
const todayIso = () => (has('hoLocalISO') ? hoLocalISO() : (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })());
const plural = (n, w, p) => `${n} ${n === 1 ? w : (p || w + 's')}`;
const first = s => String(s || '').trim().split(/\s+/)[0] || '';

function mbIsManager() {
  const r = typeof currentProfile !== 'undefined' && currentProfile ? currentProfile.role : '';
  return r === 'owner' || r === 'manager';
}
function mbHotel() {
  const el = document.getElementById('hotelName');
  const t = el && el.textContent.trim();
  if (t) return t;
  return safe(() => (JSON.parse(localStorage.getItem('ibis_settings') || '{}') || {}).hotelName, '') || '';
}

// ── Gathering the day ─────────────────────────────────────
// Each section: { id, icon, title, panel, rows: [{ t, tone, sub }], stat? }
// tone: 'ok' | 'warn' | 'bad' | '' ; a section with no rows is skipped.

function _team() {
  if (!has('roPeople') || typeof roStaff === 'undefined' || !Object.keys(roStaff || {}).length) return null;
  const t = roToday(), ppl = roPeople(t);
  if (!ppl.length) return { id: 'team', icon: '👥', title: 'Team today', panel: 'roster', rows: [{ t: 'Nobody is on the roster for today.', tone: 'warn' }] };
  const name = x => first(x.name);
  const hrs = x => x.info.from ? ` (${has('roShort') ? roShort(x.info) : x.info.from + '–' + x.info.to})` : '';
  const rows = [];
  const shifts = [['morning', '🌅 Morning'], ['afternoon', '🌇 Afternoon'], ['night', '🌙 Night']];
  shifts.forEach(([k, lbl]) => {
    const L = ppl.filter(x => x.info.type === k);
    rows.push(L.length ? { k: lbl, t: L.map(x => name(x) + hrs(x)).join(', ') } : { k: lbl, t: 'Nobody on this shift', tone: 'bad' });
  });
  const other = ppl.filter(x => x.info.type === 'other');
  if (other.length) rows.push({ k: '📌 Other', t: other.map(x => `${name(x)} (${x.info.label})`).join(', ') });
  const sick = ppl.filter(x => x.info.type === 'leave' && /\bsick\b|^SL\b/i.test(x.info.label + ' ' + x.info.code));
  const leave = ppl.filter(x => x.info.type === 'leave' && !sick.includes(x));
  const off = ppl.filter(x => x.info.type === 'off');
  if (sick.length) rows.push({ k: '🤒 Sick', t: sick.map(name).join(', '), tone: 'warn' });
  if (leave.length) rows.push({ k: '🏖️ Leave', t: leave.map(x => `${name(x)} (${String(x.info.code).toUpperCase() === 'PH' ? 'PH' : x.info.label})`).join(', ') });
  if (off.length) rows.push({ k: '🛌 Off', t: off.map(name).join(', ') });
  const working = ppl.filter(x => x.info.from).length;
  return { id: 'team', icon: '👥', title: 'Team today', panel: 'roster', rows, stat: `${working} working` };
}

function _dayNotes() {
  const rows = [], t = has('roToday') ? roToday() : todayIso();
  safe(() => {   // public holiday today
    const listed = (typeof rbSettings !== 'undefined' && rbSettings.holidays || []).filter(h => h && h.date === t);
    if (listed.length) rows.push({ t: `🎉 Public holiday today: ${listed[0].name || 'PH'}` });
    else if (has('hdList')) { const h = hdList().find(x => x.dates.includes(t) && (!has('hdDecided') || hdDecided(x.id) !== 'no')); if (h) rows.push({ t: `🎉 ${h.name} today${h.expected ? ' (expected date)' : ''}` }); }
    if (has('hdPending')) hdPending().slice(0, 2).forEach(h => rows.push({ t: `🎉 ${h.name} is coming (${has('hdWhen') ? hdWhen(h) : h.dates[0]}): add the PH?`, tone: 'warn', panel: 'roster-build' }));
  });
  safe(() => {   // meetings and training today
    if (!has('evList') || !has('evDays')) return;
    evList().filter(e => evDays(e).includes(t)).forEach(e => rows.push({ t: `📅 ${has('evTime') ? evTime(e) : (e.from || 'all day')}: ${e.title || 'Meeting'}${has('evWho') ? ' · ' + evWho(e) : ''}${e.where ? ' · ' + e.where : ''}` }));
  });
  return rows.length ? { id: 'day', icon: '📅', title: 'Today in the hotel', panel: 'roster', rows } : null;
}

function _guests() {
  const rows = [], stats = [];
  safe(() => {
    if (typeof depRooms === 'undefined' || !depRooms.length) return;
    const c = has('depCounts') ? depCounts() : {};
    const out = depRooms.filter(r => r.status === 'out').length, ext = depRooms.filter(r => r.status === 'extended').length;
    const left = (c.due || 0) + (c.late || 0) + (c.na || 0) + (c.dnd || 0);
    const lco = depRooms.filter(r => { const m = safe(() => _parseLcoTime(r.depTime), null); return m != null && m > 12 * 60 && r.status !== 'out'; }).length;
    const vip = depRooms.filter(r => r.isVip && r.status !== 'out').length;
    const old = window._depDate && window._depDate !== todayIso();
    stats.push({ k: 'Departures', v: `${out}/${depRooms.length}`, s: 'out' });
    rows.push({ k: '🚪 Departures', t: `${depRooms.length} today · ${out} out${ext ? ` · ${ext} extended` : ''} · ${left} to go${old ? ' (list is not today\'s)' : ''}`, tone: old ? 'warn' : left ? '' : 'ok', panel: 'departures' });
    if (c.late) rows.push({ k: '⏱️ Overdue', t: `${plural(c.late, 'room')} past check-out time`, tone: 'bad', panel: 'departures' });
    if (lco) rows.push({ k: '🕑 Late check-out', t: plural(lco, 'room'), panel: 'departures' });
    if (vip) rows.push({ k: '⭐ VIP leaving', t: plural(vip, 'room'), panel: 'departures' });
    if (c.balance) rows.push({ k: '💳 Balance open', t: `${plural(c.balance, 'room')} still to pay`, tone: 'warn', panel: 'departures' });
  });
  safe(() => {
    if (typeof arrGuests === 'undefined' || !arrGuests.length) return;
    const old = window._arrDate && window._arrDate !== todayIso();
    const notes = arrGuests.filter(g => String(g.remarks || '').trim()).length;
    const long = arrGuests.filter(g => +g.nights >= 7).length;
    stats.push({ k: 'Arrivals', v: arrGuests.length, s: 'today' });
    const bits = [plural(arrGuests.length, 'guest')];
    if (notes) bits.push(`${notes} with notes`);
    if (long) bits.push(`${long} staying 7+ nights`);
    rows.push({ k: '🛎️ Arrivals', t: bits.join(' · ') + (old ? ' (list is not today\'s)' : ''), tone: old ? 'warn' : '', panel: 'arrivals' });
    const vip = arrGuests.filter(g => g.isVip || /\bvip\b/i.test(g.remarks || '')).length;
    if (vip) rows.push({ k: '⭐ VIP arriving', t: plural(vip, 'guest'), panel: 'arrivals' });
  });
  safe(() => {
    if (typeof itGibyRooms === 'undefined') return;
    const R = Object.values(itGibyRooms || {}); if (!R.length) return;
    const pax = R.reduce((a, r) => a + (+r.pax || 0), 0);
    stats.push({ k: 'In-house', v: R.length, s: 'rooms' });
    rows.push({ k: '🏨 In-house', t: `${plural(R.length, 'room')}${pax ? ' · ' + plural(pax, 'guest') : ''} (last tally)`, panel: 'inhouse-tally' });
  });
  return rows.length ? { id: 'guests', icon: '🛏️', title: 'Guests', rows, stats } : null;
}

function _wakes() {
  if (typeof bxWakes === 'undefined') return null;
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const L = Object.values(bxWakes || {}).filter(w => w && w.at >= day.getTime() && w.at < day.getTime() + 864e5).sort((a, b) => a.at - b.at);
  if (!L.length) return null;
  const now = Date.now(), open = L.filter(w => !w.done), late = open.filter(w => w.at < now);
  const rows = [{ t: `${plural(L.length, 'call')} today · ${L.length - open.length} done${open.length ? ` · next ${open.find(w => w.at >= now)?.time || open[0].time}` : ''}`, tone: late.length ? 'warn' : open.length ? '' : 'ok' }];
  if (late.length) rows.push({ t: `${late.length} not called yet: room ${late.map(w => w.room).join(', ')}`, tone: 'bad' });
  return { id: 'wake', icon: '⏰', title: 'Wake-up calls', panel: 'wakeups', rows, stat: `${L.length - open.length}/${L.length}` };
}

function _tasks() {
  if (typeof SHIFTS === 'undefined') return null;
  const rows = [];
  Object.keys(SHIFTS).forEach(k => {
    const sh = SHIFTS[k]; if (!sh) return;
    const c = has('stCount') ? stCount(k) : { done: (sh.done || []).length, total: (sh.tasks || []).length };
    if (!c.total) return;
    const pct = Math.round(c.done / c.total * 100);
    rows.push({ k: (sh.label || k).replace(/ Shift$/i, ''), t: `${c.done} of ${c.total} done`, pct, tone: pct === 100 ? 'ok' : '' });
  });
  safe(() => {
    if (!has('mrOpen') || !has('mrPeriod')) return;
    const p = mrPeriod(), open = mrOpen(); if (!open.length) return;
    const due = p.late ? `late: they were due by the ${p.by}th` : p.left === 0 ? 'due today' : `due in ${plural(p.left, 'day')}`;
    rows.push({ k: '🗂️ Monthly reports', t: `${open.length} open, ${due}: ${open.slice(0, 4).map(r => r.name).join(', ')}${open.length > 4 ? '…' : ''}`, tone: p.late ? 'bad' : p.left <= 1 ? 'warn' : '' });
  });
  return rows.length ? { id: 'tasks', icon: '✅', title: 'Shift tasks', panel: 'shifts', rows } : null;
}

function _open() {
  const rows = [];
  safe(() => {
    if (typeof dtcRecon === 'undefined' || !dtcRecon) return;
    const n = (dtcRecon.actions || []).length, done = typeof dtcDone !== 'undefined' ? [...dtcDone].length : 0, left = typeof dtcOpenCount === 'function' ? dtcOpenCount() : Math.max(0, n - done);
    if (left) rows.push({ k: '🏦 DTCM', t: `${plural(left, 'correction')} to make`, tone: 'warn', panel: 'dtcm' });
  });
  safe(() => {
    if (typeof pkgResults === 'undefined' || !pkgResults.length) return;
    const n = pkgResults.filter(r => !r.pinSkip && (r.verdict === 'deny' || r.verdict === 'review' || (r.verdict === 'credit' && !r.alreadyComplete))).length;
    if (n) rows.push({ k: '🎁 Package Audit', t: `${plural(n, 'line')} to fix`, tone: 'warn', panel: 'package-audit' });
  });
  safe(() => {
    if (typeof nsGuests === 'undefined' || !nsGuests.length) return;
    const left = nsGuests.filter(g => !String(g.newConf || '').trim()).length;
    rows.push({ k: '🚫 No-shows', t: `${plural(nsGuests.length, 'guest')}${typeof nsReportDate !== 'undefined' && nsReportDate ? ' (' + nsReportDate + ')' : ''}${left ? ` · ${left} not rebooked` : ''}`, tone: left ? 'warn' : '', panel: 'noshow' });
  });
  return rows.length ? { id: 'open', icon: '📌', title: 'Open items', rows } : null;
}

function mbSections() {
  return [_team(), _dayNotes(), _guests(), _wakes(), _tasks(), _open()].filter(s => s && s.rows && s.rows.length);
}
function _dateLong() { return new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }

// ── Plain text (Copy / WhatsApp) ──────────────────────────
function mbText() {
  const S = mbSections(), hotel = mbHotel(), out = [];
  out.push(`☀️ *Morning brief*${hotel ? ' · ' + hotel : ''}`, _dateLong());
  S.forEach(s => {
    out.push('', `${s.icon} *${s.title}*`);
    s.rows.forEach(r => out.push(`${r.tone === 'bad' ? '⚠️ ' : '• '}${r.k ? r.k + ': ' : ''}${r.t}`));
  });
  if (!S.length) out.push('', 'Nothing loaded yet for today.');
  return out.join('\n');
}

// ── The sheet ─────────────────────────────────────────────
function _rowHtml(r) {
  const go = r.panel ? ` data-go="${esc(r.panel)}"` : '';
  return `<div class="mb-row ${r.tone ? 'mb-' + r.tone : ''}${r.panel ? ' mb-link' : ''}"${go}>
    ${r.k ? `<span class="mb-k">${esc(r.k)}</span>` : ''}<span class="mb-v">${esc(r.t)}</span>
    ${r.pct != null ? `<span class="mb-bar"><i style="width:${r.pct}%"></i></span>` : ''}
  </div>`;
}
function _html() {
  const S = mbSections(), hotel = mbHotel();
  const g = S.find(s => s.id === 'guests');
  const stats = (g && g.stats || []).slice();
  const w = S.find(s => s.id === 'wake'); if (w) stats.push({ k: 'Wake-ups', v: w.stat, s: 'done' });
  const team = S.find(s => s.id === 'team'); if (team && team.stat) stats.unshift({ k: 'Team', v: team.stat.split(' ')[0], s: 'working' });
  const warn = S.reduce((a, s) => a + s.rows.filter(r => r.tone === 'bad').length, 0);
  const autoOn = !(has('hoPref') && hoPref('mbAuto') === false);
  return `<div class="mb-sheet" role="dialog" aria-modal="true" aria-label="Morning brief">
    <div class="mb-hd">
      <div><div class="mb-title">☀️ Morning brief</div><div class="mb-sub">${esc(hotel ? hotel + ' · ' : '')}${esc(_dateLong())}</div></div>
      <button class="mb-x" onclick="mbClose()" aria-label="Close">✕</button>
    </div>
    <div class="mb-body">
      ${warn ? `<div class="mb-alert">⚠️ ${plural(warn, 'thing needs', 'things need')} you now</div>` : ''}
      ${stats.length ? `<div class="mb-stats">${stats.map(x => `<div class="mb-stat"><b>${esc(x.v)}</b><small>${esc(x.k)}</small></div>`).join('')}</div>` : ''}
      ${S.map(s => `<section class="mb-sec">
        <div class="mb-sec-hd${s.panel ? ' mb-link' : ''}"${s.panel ? ` data-go="${esc(s.panel)}"` : ''}><span>${s.icon} ${esc(s.title)}</span>${s.panel ? '<i>Open ›</i>' : ''}</div>
        ${s.rows.map(_rowHtml).join('')}
      </section>`).join('') || '<div class="mb-empty">Nothing is loaded for today yet. Load departures, arrivals and the roster, then open the brief again.</div>'}
    </div>
    <div class="mb-ft">
      <label class="mb-auto"><input type="checkbox" ${autoOn ? 'checked' : ''} onchange="mbSetAuto(this.checked)"> Open by itself each morning</label>
      <span class="mb-btns"><button class="btn sm" onclick="mbCopy()">📋 Copy</button><button class="btn sm mb-wa" onclick="mbWhatsApp()">💬 WhatsApp</button></span>
    </div>
  </div>`;
}

function mbOpen() {
  mount();
  let ov = document.getElementById('mbOverlay');
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'mbOverlay'; ov.className = 'mb-ov';
    ov.addEventListener('click', e => {
      if (e.target === ov) return mbClose();
      const go = e.target.closest('[data-go]');
      if (go && typeof showPanel === 'function') { mbClose(); showPanel(go.dataset.go); }
    });
    document.body.appendChild(ov);
  }
  ov.innerHTML = _html();
  ov.classList.add('open');
  try { localStorage.setItem(SHOWN_KEY, todayIso()); } catch (_) {}
  if (typeof logActivity === 'function') safe(() => logActivity('morning_brief_opened', ''));
}
function mbClose() { const ov = document.getElementById('mbOverlay'); if (ov) { ov.classList.remove('open'); ov.innerHTML = ''; } }
function mbCopy() {
  const t = mbText();
  const ok = () => typeof showToast === 'function' && showToast('Brief copied', 'ok');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, () => _copyOld(t, ok));
  else _copyOld(t, ok);
}
function _copyOld(t, ok) {
  const a = document.createElement('textarea'); a.value = t; a.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(a); a.select();
  try { document.execCommand('copy'); ok(); } catch (_) {} a.remove();
}
function mbWhatsApp() {
  const t = mbText();
  if (navigator.share && /Mobi|Android|iPhone/i.test(navigator.userAgent)) { navigator.share({ text: t }).catch(() => {}); return; }
  window.open('https://wa.me/?text=' + encodeURIComponent(t), '_blank', 'noopener');
}
function mbSetAuto(on) {
  if (has('hoSetPref')) hoSetPref('mbAuto', !!on);
  if (typeof showToast === 'function') showToast(on ? 'The brief opens by itself each morning' : 'The brief will not open by itself', 'ok');
}

// ── Auto-open: managers, once a day, 06:00–11:59 ──────────
function _morning(d) { const h = (d || new Date()).getHours(); return h >= 6 && h < 12; }
function _shownToday() { return safe(() => localStorage.getItem(SHOWN_KEY), '') === todayIso(); }
function _appReady() { const a = document.getElementById('appWrapper'); return !!(a && a.style.display !== 'none' && typeof currentProfile !== 'undefined' && currentProfile); }
function _busy() { return !!document.querySelector('.modal-bg.open, .fr-overlay, #mbOverlay.open'); }
function _hasData() {
  return safe(() => Object.keys(roStaff || {}).length, 0) || safe(() => depRooms.length, 0) || safe(() => arrGuests.length, 0);
}
let _readyAt = 0;
function mbAutoTick() {
  if (_shownToday() || !_morning() || !_appReady() || !mbIsManager()) return;
  if (has('hoPref') && hoPref('mbAuto') === false) return;
  if (!_readyAt) { _readyAt = Date.now(); return; }
  const waited = Date.now() - _readyAt;
  if (waited < 4000 || (!_hasData() && waited < 20000) || _busy()) return;
  mbOpen();
}

// ── Home button + Ops Brain ───────────────────────────────
function _homeBtn() {
  const box = document.querySelector('#panel-home .page-hd-actions');
  if (!box || document.getElementById('mbHomeBtn')) return;
  const b = document.createElement('button');
  b.id = 'mbHomeBtn'; b.className = 'btn'; b.textContent = '☀️ Brief'; b.title = 'Morning brief: the day on one screen';
  b.onclick = mbOpen;
  box.insertBefore(b, box.firstChild);
}
(window.BL_THINKERS = window.BL_THINKERS || []).push(add => {
  if (!mbIsManager() || !_morning()) return;
  add({ id: 'mbrief:' + todayIso(), type: 'mbrief', icon: '☀️', tone: 'idle',
    text: 'Your morning brief is ready', why: 'Who is on, guests, tasks and open items on one screen. Copy it or send it on WhatsApp.',
    acts: [['Open the brief', mbOpen]] });
});

const CSS = `
.mb-ov{position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;padding:16px;}
.mb-ov.open{display:flex;}
.mb-sheet{background:var(--card);color:var(--text);border:1px solid var(--border2);border-radius:var(--r,14px);width:640px;max-width:100%;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.4);overflow:hidden;}
.mb-hd{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:18px 20px 12px;border-bottom:1px solid var(--border);}
.mb-title{font-size:1.15rem;font-weight:700;}
.mb-sub{font-size:.78rem;color:var(--text2);margin-top:3px;}
.mb-x{background:none;border:0;color:var(--text2);font-size:1.1rem;cursor:pointer;padding:4px 6px;border-radius:8px;}
.mb-x:hover{background:var(--bg2);color:var(--text);}
.mb-body{overflow-y:auto;padding:14px 20px 8px;-webkit-overflow-scrolling:touch;}
.mb-alert{background:color-mix(in srgb,var(--red) 14%,transparent);color:var(--red);border:1px solid color-mix(in srgb,var(--red) 35%,transparent);border-radius:10px;padding:8px 12px;font-size:.82rem;font-weight:600;margin-bottom:12px;}
.mb-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px;margin-bottom:14px;}
.mb-stat{background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:8px 10px;min-width:0;}
.mb-stat b{display:block;font-size:1.15rem;font-family:var(--mono);color:var(--gold);}
.mb-stat small{font-size:.68rem;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;}
.mb-sec{margin-bottom:14px;}
.mb-sec-hd{display:flex;justify-content:space-between;align-items:center;font-size:.8rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;padding:4px 0 6px;border-bottom:1px solid var(--border);margin-bottom:4px;}
.mb-sec-hd i{font-style:normal;font-weight:500;text-transform:none;letter-spacing:0;color:var(--gold);font-size:.75rem;}
.mb-row{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 10px;padding:6px 6px;border-radius:8px;font-size:.86rem;line-height:1.4;}
.mb-link{cursor:pointer;}
.mb-row.mb-link:hover,.mb-sec-hd.mb-link:hover{background:var(--bg2);}
.mb-k{flex:0 0 132px;color:var(--text3);font-size:.78rem;}
.mb-v{flex:1 1 200px;min-width:0;overflow-wrap:anywhere;}
.mb-bad .mb-v{color:var(--red);font-weight:600;}
.mb-warn .mb-v{color:var(--gold);}
.mb-ok .mb-v{color:var(--green);}
.mb-bar{flex:1 1 100%;height:4px;background:var(--bg2);border-radius:3px;overflow:hidden;margin-top:2px;}
.mb-bar i{display:block;height:100%;background:var(--green);border-radius:3px;}
.mb-empty{color:var(--text2);font-size:.86rem;padding:18px 4px;}
.mb-ft{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;padding:12px 20px;border-top:1px solid var(--border);background:var(--card2);}
.mb-auto{font-size:.75rem;color:var(--text2);display:flex;align-items:center;gap:6px;cursor:pointer;}
.mb-btns{display:flex;gap:8px;margin-left:auto;}
@media (max-width:600px){
  .mb-ov{align-items:flex-end;padding:0;}
  .mb-sheet{width:100%;max-height:92vh;border-radius:16px 16px 0 0;border-bottom:0;}
  .mb-hd,.mb-body,.mb-ft{padding-left:16px;padding-right:16px;}
  .mb-k{flex-basis:92px;}
  .mb-v{flex-basis:160px;}
  .mb-stats{grid-template-columns:repeat(auto-fit,minmax(72px,1fr));gap:6px;}
  .mb-stat{padding:6px 8px;}
  .mb-stat b{font-size:1rem;}
  .mb-stat small{font-size:.6rem;}
  .mb-row{padding:5px 4px;}
  .mb-btns{margin-left:0;width:100%;}
  .mb-btns .btn{flex:1;}
}`;

function mount() {
  if (!document.getElementById('mbStyle')) { const s = document.createElement('style'); s.id = 'mbStyle'; s.textContent = CSS; document.head.appendChild(s); }
  _homeBtn();
}
function start() {
  mount();
  setTimeout(_homeBtn, 1500);
  setInterval(mbAutoTick, 2000);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('mbOverlay')?.classList.contains('open')) mbClose(); });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

Object.assign(window, { mbOpen, mbClose, mbCopy, mbWhatsApp, mbText, mbSections, mbSetAuto, mbAutoTick });
})();

// ═══════════════════════════════════════════════════════════
//  shift-alerts.js — 🔔 Shift alerts + 📋 end-of-shift summary
//
//  Smart nudges to your phone while you are on shift, through the same
//  Telegram bot (and ntfy) you connected for the WhatsApp Away guard
//  (wa-guard.js: hoWaGuard.notify). Each one has its own switch:
//   • ⏰ Rooms past check-out time and still not out — one message with the
//     list ("+N more"), again at most every 30 min while it stays true.
//   • ⭐ VIP arrivals today — once per guest per day.
//   • 🩺 Room problems not followed up (room-health.js) — once per problem.
//   • 📒 Handover Book items still open 30 min before your shift ends.
//   • 📋 End-of-shift summary ~10 min before the end (and "Send summary now"):
//     to Telegram, plus one-tap Copy / Send to the WhatsApp handover group.
//     Nothing is ever posted to WhatsApp without a tap.
//
//  Only while you're on shift by the roster (your name in Roster → My shifts;
//  with no name chosen the hotel's shift hours are used), unless "Alert me even
//  off shift" is on. Quiet hours mute every automatic message.
//
//  Two devices open never both send: what was sent is saved at
//  shiftAlerts/{uid}/sent/{key} = {at, by} (plus this device's copy). Before
//  sending, a device waits a random moment, reads the key, claims it, waits,
//  and reads again: only the device whose claim stuck sends.
//  Settings: shiftAlerts/{uid}/cfg. Everything else is only read.
//
//  window.hoShiftAlerts = { summary(), sendSummary(), check(), state, open() … }
//  Load after wa-guard.js (anywhere after it works; it reads the other pages
//  lazily): <script src="shift-alerts.js"></script>
// ═══════════════════════════════════════════════════════════
(function (W) {
'use strict';
const D = document;
const safe = (fn, fb) => { try { const v = fn(); return v === undefined ? fb : v; } catch (_) { return fb; } };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const dayOf = d => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const hhmm = d => { d = new Date(d); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const toMin = t => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
// one alert failing never stops the others
const guard = async f => { try { await f(); } catch (_) {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plural = (n, w, p) => `${n} ${n === 1 ? w : (p || w + 's')}`;
const fn = n => typeof W[n] === 'function';
// Firebase keys can't hold . # $ [ ] /
const fbKey = k => String(k == null ? '' : k).replace(/[.#$\[\]\/\x00-\x1f\x7f]/g, '_').slice(0, 120) || '_';
const uid = () => safe(() => (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || '', '');
const P = sub => 'shiftAlerts/' + uid() + (sub ? '/' + sub : '');
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
const toast = (m, t) => safe(() => { if (fn('showToast')) showToast(m, t || 'ok'); });

const MIN = 60e3;
const GAP = { od: 30 * MIN, vip: 24 * 60 * MIN, rh: 30 * 24 * 60 * MIN, ho: 24 * 60 * MIN, sum: 24 * 60 * MIN };
const DEF = { overdue: true, vip: true, health: true, handover: true, summary: true, offShift: false, quiet: false, qFrom: '23:00', qTo: '07:00' };
const LS_CFG = 'ho_sa_cfg_v1', LS_SENT = 'ho_sa_sent_v1', LS_HIST = 'ho_sa_hist_v1';
// this device, so a claim can tell "mine" from "the other phone's"
const DEV = (() => { let d = lsGet('ho_sa_dev_v1', ''); if (!/^d[a-z0-9]{6,}$/.test(d)) { d = 'd' + Math.random().toString(36).slice(2, 10); lsSet('ho_sa_dev_v1', d); } return d; })();

let CFG = Object.assign({}, DEF, lsGet(LS_CFG, {}));
let SENT = {};                       // shiftAlerts/{uid}/sent as last heard
let LOCAL = lsGet(LS_SENT, {}) || {};   // key → at, sent from this device
let TG = null, NTFY = null;          // read from waGuard/{uid}: only to know a way to the phone is set up
let started = false, busy = false, lastRun = 0, pill = null;

// ══ Where to send ═══════════════════════════════════════════
function connected() { return !!((TG && TG.chat) || NTFY); }
function notify(title, msg, prio, tags) {
  try {
    const G = W.hoWaGuard;
    if (!G || typeof G.notify !== 'function') return Promise.resolve(false);
    return Promise.resolve(G.notify(title, msg, prio || 4, tags || ['bell'])).then(Boolean, () => false);
  } catch (_) { return Promise.resolve(false); }
}

// ══ My shift ════════════════════════════════════════════════
const _endCache = {};
/** the end of the hotel shift that started at `start` (the next time hoShiftNow names another shift) */
function hoursEnd(sh) {
  const k = sh.start.getTime();
  if (_endCache[k]) return _endCache[k];
  let end = k + 8 * 60 * MIN;
  for (let m = 5; m <= 18 * 60; m += 5) {
    const s = safe(() => hoShiftNow(new Date(k + m * MIN)), null);
    if (s && (s.key !== sh.key || s.start.getTime() !== k)) { end = k + m * MIN; break; }
  }
  return (_endCache[k] = end);
}
/** { state: on|off|soon|ended, src: roster|hours, start, end, key, label, why }
 *  roster first (hoMyDuty: your own hours); no name on the roster → the hotel's shift hours */
function shiftInfo(now) {
  now = now || new Date();
  const t = now.getTime();
  const key = safe(() => hoShiftNow(now).key, '') || (now.getHours() >= 23 || now.getHours() < 7 ? 'night' : now.getHours() < 15 ? 'morning' : 'afternoon');
  const duty = fn('hoMyDuty') ? safe(() => hoMyDuty(now), { state: 'unknown' }) : { state: 'unknown' };
  if (duty.state === 'on' && duty.code && duty.date && fn('rbParse') && fn('roDate')) {
    const p = safe(() => rbParse(duty.code), null), base = safe(() => roDate(duty.date).getTime(), 0);
    if (p && base) {
      const start = base + p.s * MIN, end = base + p.e * MIN;
      // hoMyDuty counts 1 h before and 30 min after as "on"; alerts only inside the real hours
      return { state: t < start ? 'soon' : t > end ? 'ended' : 'on', src: 'roster', start, end, key, label: `${p.from}–${p.to}` };
    }
  }
  if (duty.state === 'off') return { state: 'off', src: 'roster', key, why: duty.why || 'not on shift by the roster' };
  if (!fn('hoShiftNow')) return { state: 'on', src: 'hours', key, start: 0, end: 0, label: '' };
  const sh = safe(() => hoShiftNow(now), null);
  if (!sh) return { state: 'on', src: 'hours', key, start: 0, end: 0, label: '' };
  const start = sh.start.getTime(), end = hoursEnd(sh);
  return { state: 'on', src: 'hours', key: sh.key, start, end, label: `${hhmm(start)}–${hhmm(end)}` };
}
const shiftId = si => (si && si.start ? dayOf(si.start) + '_' + hhmm(si.start).replace(':', '') : dayOf(Date.now()) + '_' + (si && si.key || 'x'));
const shiftName = k => ({ morning: 'Morning', afternoon: 'Afternoon', night: 'Night', mid: 'Mid' }[k] || 'Shift');
function inQuiet(now) {
  if (!CFG.quiet) return false;
  const a = toMin(CFG.qFrom), b = toMin(CFG.qTo); if (a == null || b == null || a === b) return false;
  const m = now.getHours() * 60 + now.getMinutes();
  return a < b ? m >= a && m < b : m >= a || m < b;
}

// ══ What the pages hold (read only) ═════════════════════════
const today = () => (fn('hoLocalISO') ? hoLocalISO() : dayOf(Date.now()));
const deps = () => safe(() => (typeof depRooms !== 'undefined' && Array.isArray(depRooms) ? depRooms : []), []);
const esOf = r => safe(() => (fn('effectiveStatus') ? effectiveStatus(r) : r.status), r && r.status);
const todaysDep = r => safe(() => (fn('_depDayRel') ? _depDayRel(r) === 0 : true), true);   // an old list never rings
const lcoTxt = t => { const m = toMin(t); return m == null ? '' : (Math.floor(m / 60) % 12 || 12) + ':' + pad(m % 60) + (m >= 720 ? ' PM' : ' AM'); };
/** rooms past their check-out time and still in: [{room, tag}] */
function overdueRooms(now) {
  now = now || new Date();
  const nowM = now.getHours() * 60 + now.getMinutes(), co = safe(() => (fn('hoCheckoutMin') ? hoCheckoutMin() : 720), 720);
  const out = [];
  deps().forEach(r => safe(() => {
    if (!r || !todaysDep(r)) return;
    const es = esOf(r);
    if (es === 'out' || es === 'extended' || r.intent === 'finance_hold') return;   // gone, or left and waiting for Finance
    let tag = null;
    if (r.intent === 'extending') { if (fn('_depIsOverdue') && _depIsOverdue(r)) tag = 'not extended yet'; }
    else if (fn('isLcoOverdue') && isLcoOverdue(r)) tag = r.status === 'late' && r.lateTime ? 'LCO ' + lcoTxt(r.lateTime) : 'past ' + (lcoTxt(r.depTime) || lcoTxt(pad(Math.floor(co / 60)) + ':' + pad(co % 60)));
    else if (es === 'due' || es === 'na' || es === 'dnd') {
      // no Opera departure time (or a call made): the hotel's check-out time from Hotel setup
      const lim = r.depTime ? toMin(r.depTime) : co;
      if (lim != null && nowM > lim) tag = 'past ' + lcoTxt(pad(Math.floor(lim / 60)) + ':' + pad(lim % 60));
    }
    if (tag == null) return;
    if (es === 'na') tag += ' · no answer'; else if (es === 'dnd') tag += ' · DND';
    out.push({ room: String(r.roomStr || r.room || '?'), tag });
  }));
  return out;
}
function inHouse() { return safe(() => (W.hoInHouse && typeof W.hoInHouse.rooms === 'function' ? W.hoInHouse.rooms() || [] : []), []); }
const rkey = r => { const m = String(r == null ? '' : r).match(/\d{3,4}/); return m ? String(parseInt(m[0], 10)) : ''; };
function arrivalsToday() { return safe(() => (typeof arrGuests !== 'undefined' && Array.isArray(arrGuests) && (!W._arrDate || W._arrDate === today()) ? arrGuests : []), []); }
/** today's VIP arrivals: [{id, room, vip, nights, arrived}] — the arrivals list and the in-house report together */
function vipArrivals() {
  const t = today(), IH = inHouse(), byRoom = new Map();
  IH.forEach(r => { if (r && rkey(r.room)) byRoom.set(rkey(r.room), r); });
  const out = [], seen = new Set();
  arrivalsToday().forEach(g => safe(() => {
    const ih = byRoom.get(rkey(g.room));
    const ihVip = ih && ih.vip && String(ih.arrival || '').slice(0, 10) === t;
    const vip = g.isVip || /\bvip\b/i.test(g.remarks || '') || ihVip;
    if (!vip) return;
    const id = rkey(g.room) || 'c' + fbKey(g.conf || g.name || '').slice(0, 30);
    if (seen.has(id)) return; seen.add(id);
    out.push({ id, room: g.room || '', vip: (ih && ih.vip && ih.vip.length <= 6 ? ih.vip : '') || (typeof g.isVip === 'string' ? g.isVip : ''), nights: +g.nights || 0, arrived: !!ihVip });
  }));
  IH.forEach(r => safe(() => {   // VIPs who already arrived today (not on the arrivals list)
    if (!r.vip || String(r.arrival || '').slice(0, 10) !== t || r.status === 'out') return;
    const id = rkey(r.room); if (!id || seen.has(id)) return; seen.add(id);
    out.push({ id, room: r.room, vip: r.vip.length <= 6 ? r.vip : '', nights: +r.nights || 0, arrived: true });
  }));
  return out;
}
/** room problems that need a nudge: chased once and still no fix, an arrival into a problem room nobody sent, a high one never sent */
function healthToChase(now) {
  const t = (now || new Date()).getTime();
  const recs = safe(() => (W.hoRoomHealth && typeof W.hoRoomHealth.recs === 'function' ? W.hoRoomHealth.recs() || [] : []), []);
  return recs.filter(r => r && r.id && r.type !== 'check' && (r.follow || (!r.sent && r.arrival) || (!r.sent && r.sev === 'high' && t - (r.first || t) > 2 * 60 * MIN)))
    .map(r => ({ id: r.id, room: r.room, say: r.say || r.kind || 'problem',
      why: r.follow ? `sent ${r.sent && r.sent.at ? hhmm(r.sent.at) : 'earlier'}, no fix reply` : r.arrival ? 'arrival today, not sent to anyone yet' : 'high, not sent to anyone yet' }));
}
/** handover items still open for this shift (today's book, and yesterday's when the shift started yesterday) */
function openHandover(si) {
  const H = W.hoHandoverBook; if (!H || typeof H.items !== 'function') return [];
  const days = [today()]; if (si && si.start && dayOf(si.start) !== days[0]) days.unshift(dayOf(si.start));
  const seen = new Set(), out = [];
  days.forEach(d => safe(() => (H.items(d) || []).forEach(i => {
    if (!i || i.del || i.chat || i.status !== 'open') return;
    const k = i.key || i.id || (i.text || i.orig || '');
    if (seen.has(k)) return; seen.add(k); out.push(i);
  })));
  return out;
}
const WA_NOACT = new Set(['skip', 'none', 'notlist', 'ignore', 'log', 'preview', 'ask', 'deleted', 'wait', 'ho']);
/** what WhatsApp messages changed on the board since the shift started (wa-bridge log of today, this device) */
function waActions(since) {
  const L = safe(() => (W.hoWaBridge && typeof W.hoWaBridge.log === 'function' ? W.hoWaBridge.log() || [] : null), null);
  if (!L) return null;
  let n = 0;
  L.forEach(e => { if (!e || e.undone || (since && (e.at || 0) < since)) return; (e.res || []).forEach(r => { if (r && !WA_NOACT.has(r.st)) n++; }); });
  return n;
}

// ══ 📋 The end-of-shift summary ═════════════════════════════
function summaryData(si) {
  si = si || shiftInfo();
  const S = { shift: shiftName(si.key), label: si.label || '', day: si.start ? new Date(si.start) : new Date() };
  safe(() => {
    const L = deps().filter(todaysDep); if (!L.length) return;
    const out = L.filter(r => r.status === 'out').length, ext = L.filter(r => r.status === 'extended').length;
    S.dep = { total: L.length, out, ext, done: out + ext, late: L.filter(r => r.status === 'late').length };   // agreed late check-outs (rooms simply past their time are under Overdue)
  });
  S.overdue = overdueRooms();
  safe(() => {
    const A = arrivalsToday(), IH = inHouse(), t = today();
    const arrived = IH.filter(r => String(r.arrival || '').slice(0, 10) === t).length;
    if (A.length || arrived) S.arr = { expected: A.length, arrived, ih: IH.length > 0, fresh: safe(() => String(W.hoInHouse.date || '').slice(0, 10) === t, false) };
    if (IH.length) S.inHouse = IH.filter(r => r.status !== 'out').length;
  });
  safe(() => { if (W.hoHandoverBook) S.ho = openHandover(si).length; });
  safe(() => {
    const H = W.hoRoomHealth; if (!H || typeof H.cases !== 'function') return;
    const C = H.cases() || [], since = si.start || Date.now() - 8 * 60 * MIN;
    S.rh = { open: C.filter(c => c && c.status === 'open').length, fixed: C.filter(c => c && c.status === 'fixed' && (c.fixedAt || 0) >= since).length };
  });
  S.wa = waActions(si.start || 0);
  safe(() => {
    if (!fn('stCount') || typeof SHIFTS === 'undefined' || !SHIFTS[si.key]) return;
    const c = stCount(si.key); if (c && c.total) S.tasks = c;
  });
  return S;
}
function summaryText(S) {
  S = S || summaryData();
  const d = S.day, when = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const L = [`📋 End of shift · ${S.shift}${S.label ? ' ' + S.label : ''} · ${when}`];
  if (S.dep) L.push(`🚪 Departures: ${S.dep.done}/${S.dep.total} done (${S.dep.out} out${S.dep.ext ? ', ' + S.dep.ext + ' extended' : ''})`);
  else L.push('🚪 Departures: list not loaded');
  if (S.overdue.length) L.push(`⏰ Overdue: ${S.overdue.length} (${S.overdue.slice(0, 6).map(r => r.room).join(', ')}${S.overdue.length > 6 ? ' +' + (S.overdue.length - 6) : ''})`);
  else if (S.dep) L.push('⏰ Overdue: none');
  if (S.dep) L.push(`🕐 Late check-outs: ${S.dep.late} · ↪ Extensions: ${S.dep.ext}`);
  if (S.arr) L.push(`🛎️ Arrivals: ${S.arr.expected} expected · ${S.arr.ih ? S.arr.arrived + ' arrived' + (S.arr.fresh ? '' : ' (last in-house report)') : 'arrived: no in-house report loaded'}`);
  if (S.inHouse != null) L.push(`🏨 In-house: ${plural(S.inHouse, 'room')}`);
  if (S.ho != null) L.push(`📒 Handover: ${S.ho ? S.ho + ' open' : 'nothing open'}`);
  if (S.rh) L.push(`🩺 Room problems: ${S.rh.open} open · ${S.rh.fixed} fixed this shift`);
  if (S.wa != null) L.push(`💬 WhatsApp: ${plural(S.wa, 'action')}`);
  if (S.tasks) L.push(`✅ Shift tasks: ${S.tasks.done}/${S.tasks.total} done`);
  return L.join('\n') + '\n— HotelOps';
}
function summary() { return safe(() => summaryText(summaryData()), '📋 End of shift — could not build the summary'); }

// ══ Sending once, across devices ════════════════════════════
const readKey = k => (typeof fbGet === 'function' ? Promise.resolve(fbGet(P('sent/' + k))).catch(() => null) : Promise.resolve(null));
/** true when this device should send `key` now (nobody sent it within `gap`) */
async function claim(key, gap, quick) {
  key = fbKey(key);
  const fresh = at => !!at && Date.now() - at < gap;
  if (fresh(LOCAL[key]) || fresh(SENT[key] && SENT[key].at)) return false;
  if (!uid() || typeof fbSet !== 'function') { LOCAL[key] = Date.now(); lsSet(LS_SENT, LOCAL); return true; }
  // two devices ticking the same minute: start apart, look, claim, look again
  if (!quick) await sleep(300 + Math.random() * 2200);
  let v = await readKey(key);
  if (v && fresh(v.at)) { SENT[key] = v; return false; }
  const mine = { at: Date.now(), by: DEV };
  try { await fbSet(P('sent/' + key), mine); } catch (_) {}
  await sleep(quick ? 300 : 1500);
  v = await readKey(key);
  if (v && v.by && v.by !== DEV && fresh(v.at)) { SENT[key] = v; return false; }   // the other device's claim stuck
  SENT[key] = mine; LOCAL[key] = mine.at; lsSet(LS_SENT, LOCAL);
  return true;
}
/** mark a key as sent (manual sends), so the automatic one doesn't repeat it */
function mark(key) {
  key = fbKey(key); const v = { at: Date.now(), by: DEV };
  SENT[key] = v; LOCAL[key] = v.at; lsSet(LS_SENT, LOCAL);
  safe(() => { if (uid() && typeof fbSet === 'function') fbSet(P('sent/' + key), v); });
}
/** a send that failed: try again in 5 minutes rather than at the next full gap */
function retrySoon(key, gap) {
  key = fbKey(key); const v = { at: Date.now() - gap + 5 * MIN, by: DEV, failed: true };
  SENT[key] = v; LOCAL[key] = v.at; lsSet(LS_SENT, LOCAL);
  safe(() => { if (uid() && typeof fbSet === 'function') fbSet(P('sent/' + key), v); });
}
function hist(title) {
  const h = lsGet(LS_HIST, []); const L = Array.isArray(h) ? h : [];
  L.unshift({ at: Date.now(), t: String(title).slice(0, 90) }); lsSet(LS_HIST, L.slice(0, 12));
}
async function send(keys, gap, title, msg, prio, tags) {
  const ok = await notify(title, msg, prio, tags);
  if (ok) hist(title); else keys.forEach(k => retrySoon(k, gap));
  return ok;
}
/** old keys out of the way (only our own shiftAlerts/{uid}/sent) */
function prune() {
  safe(() => {
    const now = Date.now();
    Object.keys(SENT || {}).forEach(k => {
      const at = SENT[k] && SENT[k].at || 0, keep = /^rh_/.test(k) ? GAP.rh : 3 * 24 * 60 * MIN;
      if (now - at > keep && typeof fbSet === 'function') fbSet(P('sent/' + k), null);
    });
    Object.keys(LOCAL).forEach(k => { if (now - LOCAL[k] > (/^rh_/.test(k) ? GAP.rh : 3 * 24 * 60 * MIN)) delete LOCAL[k]; });
    lsSet(LS_SENT, LOCAL);
  });
}

// ══ The check, every minute ═════════════════════════════════
/** opt: { manual: ignore shift / quiet hours (still never twice), at: a Date (tests) } → what was sent */
async function check(opt) {
  opt = opt || {};
  if (busy) return [];
  busy = true; lastRun = Date.now();
  const sentNow = [];
  try {
    if (!connected() && !opt.force) return sentNow;
    const now = opt.at instanceof Date ? opt.at : new Date(), si = shiftInfo(now), sid = shiftId(si), day = dayOf(now);
    const onShift = si.state === 'on' || CFG.offShift;
    if (!opt.manual && inQuiet(now)) return sentNow;
    const t = now.getTime();

    if (opt.manual || onShift) {
      // ⏰ rooms past check-out
      if (CFG.overdue) await guard(async () => {
        const L = overdueRooms(now); if (!L.length) return;
        const k = 'od_' + day;
        if (!(await claim(k, GAP.od, opt.manual))) return;
        const shown = L.slice(0, 8).map(r => `${r.room} (${r.tag})`);
        if (await send([k], GAP.od, `⏰ ${plural(L.length, 'room')} past check-out`, shown.join('\n') + (L.length > 8 ? `\n+${L.length - 8} more` : '') + '\nStill not out — call or knock.', 4, ['alarm_clock'])) sentNow.push('overdue');
      });
      // ⭐ VIP arrivals: new ones in one message
      if (CFG.vip) await guard(async () => {
        const L = vipArrivals(), got = [];
        for (const g of L) { if (await claim(`vip_${day}_${g.id}`, GAP.vip, true)) got.push(g); }
        if (!got.length) return;
        const line = g => `${g.room ? 'Room ' + g.room : 'No room yet'}${g.vip ? ' · VIP ' + g.vip : ' · VIP'}${g.nights ? ' · ' + plural(g.nights, 'night') : ''}${g.arrived ? ' · ✓ arrived' : ''}`;
        if (await send(got.map(g => `vip_${day}_${g.id}`), GAP.vip, `⭐ ${plural(got.length, 'VIP arrival')} today`, got.slice(0, 8).map(line).join('\n') + (got.length > 8 ? `\n+${got.length - 8} more` : ''), 4, ['star'])) sentNow.push('vip');
      });
      // 🩺 room problems nobody followed up
      if (CFG.health) await guard(async () => {
        const L = healthToChase(now), got = [];
        for (const r of L) { if (await claim('rh_' + r.id, GAP.rh, true)) got.push(r); }
        if (!got.length) return;
        if (await send(got.map(r => 'rh_' + r.id), GAP.rh, `🩺 ${plural(got.length, 'room problem')} to follow up`, got.slice(0, 6).map(r => `${r.room} · ${r.say} — ${r.why}`).join('\n') + (got.length > 6 ? `\n+${got.length - 6} more` : ''), 4, ['wrench'])) sentNow.push('health');
      });
    }
    // 📒 handover items open 30 min before the end
    if (CFG.handover && si.end && (onShift || opt.manual) && t >= si.end - 30 * MIN && t < si.end) await guard(async () => {
      const L = openHandover(si); if (!L.length) return;
      const k = 'ho_' + sid;
      if (!(await claim(k, GAP.ho, opt.manual))) return;
      const txt = i => String(i.text || i.orig || '').replace(/\s+/g, ' ').slice(0, 80);
      if (await send([k], GAP.ho, `📒 ${plural(L.length, 'handover item')} still open`, L.slice(0, 5).map(i => '• ' + txt(i)).join('\n') + (L.length > 5 ? `\n+${L.length - 5} more` : '') + `\nYour shift ends at ${hhmm(si.end)}.`, 4, ['ledger'])) sentNow.push('handover');
    });
    // 📋 summary ~10 min before the end (still sent if the app opens up to 20 min after)
    if (CFG.summary && si.end && (si.state !== 'off' || CFG.offShift) && t >= si.end - 10 * MIN && t <= si.end + 20 * MIN) await guard(async () => {
      const k = 'sum_' + sid;
      if (!(await claim(k, GAP.sum, opt.manual))) return;
      const text = summaryText(summaryData(si));
      if (await send([k], GAP.sum, '📋 End-of-shift summary', text.split('\n').slice(1).join('\n'), 3, ['clipboard'])) { sentNow.push('summary'); showPill(text); }
    });
  } catch (_) {}
  finally { busy = false; renderSection(); }
  return sentNow;
}

/** "Send summary now": Telegram straight away, and the sheet for Copy / WhatsApp */
async function sendSummary() {
  try {
    const si = shiftInfo(), text = summary();
    if (!connected()) { open(text); toast('Telegram isn\'t connected — copy it or send it to WhatsApp from here', 'warn'); return false; }
    mark('sum_' + shiftId(si));
    const ok = await notify('📋 End-of-shift summary', text.split('\n').slice(1).join('\n'), 3, ['clipboard']);
    if (ok) hist('📋 End-of-shift summary (sent by hand)');
    toast(ok ? '📋 Summary sent to Telegram' : 'Could not send to Telegram — check the internet', ok ? 'ok' : 'err');
    open(text);
    return ok;
  } catch (_) { return false; }
}

// ══ The summary sheet: Copy · Send to WhatsApp (always a tap) ═══
function hoGroups() {
  const B = W.hoWaBridge; if (!B) return [];
  const names = [];
  safe(() => ((B.link && B.link() || {}).groups || []).forEach(g => { const n = g && (g.name || g); if (n && !names.includes(n)) names.push(String(n)); }));
  safe(() => (B.log ? B.log() : []).forEach(l => { if (l && l.group && !names.includes(l.group)) names.push(l.group); }));
  return names.filter(n => safe(() => (typeof B.isHandoverGroup === 'function' ? !!B.isHandoverGroup(n) : /\bHO\b|hand\s*-?\s*over/i.test(n)), false));
}
const waLinked = () => safe(() => !!(W.hoWaBridge && W.hoWaBridge.linked && W.hoWaBridge.linked()), false);
let SHEET_TEXT = '';
function open(text) {
  try {
    hidePill();
    SHEET_TEXT = text || summary();
    let ov = D.getElementById('saOv');
    if (!ov) {
      ov = D.createElement('div'); ov.id = 'saOv'; ov.className = 'sa-ov';
      ov.addEventListener('click', e => { if (e.target === ov) close(); });
      D.body.appendChild(ov);
    }
    const G = hoGroups(), linked = waLinked();
    const wa = linked && typeof (W.hoWaBridge || {}).send === 'function'
      ? (G.length ? `<div class="sa-wa">${G.length > 1 ? `<select id="saGrp" class="input" aria-label="Handover group">${G.map(g => `<option>${esc(g)}</option>`).join('')}</select>` : ''}
          <button class="sa-btn wa" onclick="hoShiftAlerts.toWa()">💬 Send to ${G.length > 1 ? 'the group' : esc(G[0])}</button></div>`
        : `<button class="sa-btn wa" onclick="hoShiftAlerts.toWa()">💬 Send to the open WhatsApp chat</button><small class="sa-fine">No handover group found (a group with "HO" or "handover" in its name, or switched to Handover in the WhatsApp window).</small>`)
      : `<a class="sa-btn wa" href="https://wa.me/?text=${encodeURIComponent(SHEET_TEXT)}" target="_blank" rel="noopener">💬 Share in WhatsApp</a><small class="sa-fine">Link WhatsApp Web (WhatsApp window) to send it straight to the handover group.</small>`;
    ov.innerHTML = `<div class="sa-sheet" role="dialog" aria-label="End-of-shift summary">
      <div class="sa-hd"><b>📋 End-of-shift summary</b><button class="sa-x" onclick="hoShiftAlerts.close()" aria-label="Close">✕</button></div>
      <pre class="sa-pre">${esc(SHEET_TEXT)}</pre>
      <div class="sa-acts"><button class="sa-btn" onclick="hoShiftAlerts.copy()">📋 Copy</button>${connected() ? '<button class="sa-btn" onclick="hoShiftAlerts.toTg()">📲 Telegram</button>' : ''}<button class="sa-btn ghost" onclick="hoShiftAlerts.open()">↻ Refresh</button></div>
      ${wa}
      <small class="sa-fine">Nothing goes to WhatsApp until you tap.</small></div>`;
    ov.hidden = false;
  } catch (_) {}
}
function close() { const ov = D.getElementById('saOv'); if (ov) ov.hidden = true; }
function copy() {
  const t = SHEET_TEXT || summary();
  try {
    const fall = () => { if (fn('copyToClipboard')) { copyToClipboard(t, null, ''); toast('📋 Summary copied'); } else prompt('Copy this', t); };
    if (!navigator.clipboard) return fall();
    navigator.clipboard.writeText(t).then(() => toast('📋 Summary copied'), fall);
  } catch (_) { try { prompt('Copy this', t); } catch (__) {} }
}
function toWa() {
  try {
    const B = W.hoWaBridge; if (!B || typeof B.send !== 'function') return;
    const sel = D.getElementById('saGrp'), G = hoGroups();
    const g = sel ? sel.value : G[0] || '';
    const it = B.send(SHEET_TEXT || summary(), g || undefined);
    if (it) { toast('💬 Sending to ' + (g || 'WhatsApp') + '…'); close(); }
  } catch (_) { toast('Could not send to WhatsApp', 'err'); }
}
function toTg() { notify('📋 End-of-shift summary', (SHEET_TEXT || summary()).split('\n').slice(1).join('\n'), 3, ['clipboard']).then(ok => toast(ok ? '📲 Sent to Telegram' : 'Could not send to Telegram', ok ? 'ok' : 'err')); }
/** after the automatic summary: a small card, so Copy / WhatsApp is one tap away (never posts by itself) */
function showPill(text) {
  try {
    SHEET_TEXT = text;
    if (!pill) { pill = D.createElement('div'); pill.className = 'sa-pill'; D.body.appendChild(pill); }
    pill.innerHTML = `<button class="sa-pill-go" onclick="hoShiftAlerts.open(hoShiftAlerts.state.lastText)">📋 Shift summary sent to Telegram · <b>Copy / WhatsApp</b></button><button class="sa-pill-x" onclick="hoShiftAlerts.hidePill()" aria-label="Dismiss">✕</button>`;
    pill.hidden = false;
  } catch (_) {}
}
function hidePill() { if (pill) pill.hidden = true; }

// ══ Settings → 🔔 Shift alerts (our own section, added after settings.js draws) ══
function setCfg(k, v) {
  if (!(k in DEF)) return;
  CFG = Object.assign({}, CFG, { [k]: v });
  lsSet(LS_CFG, CFG);
  safe(() => { if (uid() && typeof fbSet === 'function') fbSet(P('cfg'), CFG); });
  renderSection();
}
function statusLine() {
  const si = shiftInfo(), q = inQuiet(new Date());
  if (si.state === 'off') return CFG.offShift ? `Off shift by the roster (${esc(si.why)}) — alerting anyway` : `Paused: ${esc(si.why)}. Turn on "Alert me even off shift" to get them anyway.`;
  const end = si.end ? ` · ends ${hhmm(si.end)}` : '';
  const src = si.src === 'roster' ? 'from your roster' : 'hotel shift hours — pick your name in Roster → My shifts to use your own hours';
  const st = si.state === 'soon' ? `Your shift ${si.label} starts at ${hhmm(si.start)}` : si.state === 'ended' ? `Your shift ${si.label} has ended` : `On shift now: ${shiftName(si.key)} ${si.label}${end}`;
  return `${st} (${src})${q ? ' · 🌙 quiet hours now' : ''}`;
}
const row = (k, label, desc, words) => `<label class="hs-row" data-s="${esc((label + ' ' + desc + ' ' + (words || '') + ' shift alerts telegram').toLowerCase())}">
    <span class="hs-txt"><b>${label}</b><small>${desc}</small></span>
    <span class="hs-switch"><input type="checkbox" ${CFG[k] ? 'checked' : ''} onchange="hoShiftAlerts.setCfg('${k}', this.checked)"><i></i></span></label>`;
function sectionHtml() {
  const ic = safe(() => (fn('hoIcon') && hoIcon('feedback')) || '', '') || '🔔';
  const way = TG && TG.chat ? `Telegram @${esc(TG.bot || 'bot')}${NTFY ? ' + ntfy' : ''}` : NTFY ? 'ntfy' : '';
  const H = lsGet(LS_HIST, []), recent = (Array.isArray(H) ? H : []).slice(0, 4);
  const head = connected()
    ? `<div class="hs-row" data-s="shift alerts telegram status on shift roster"><span class="hs-txt"><b>📲 Sending to ${way}</b><small>${statusLine()}</small></span><button class="btn sm ghost" onclick="hoShiftAlerts.check({manual:true}).then(function(r){hoShiftAlerts.said(r)})">Check now</button></div>`
    : `<div class="hs-row sa-need" data-s="connect telegram first shift alerts away guard"><span class="hs-txt"><b>Connect Telegram first in WhatsApp → 🛡 Away</b><small>Shift alerts go to the same Telegram bot (or ntfy) as the WhatsApp Away guard.</small></span><button class="btn" onclick="hoShiftAlerts.connect()">🛡 Set up Telegram</button></div>`;
  return `<div class="hs-sec-hd"><span class="hs-sec-ic">${ic}</span><div><h2>Shift alerts</h2><p>Nudges on your phone during your shift, and an end-of-shift summary</p></div></div>
    <div class="hs-card">${head}
      ${row('overdue', '⏰ Rooms past check-out', 'Rooms still in after their check-out or late check-out time — one list, again at most every 30 min while it lasts', 'overdue late departures')}
      ${row('vip', '⭐ VIP arrivals today', 'Once per guest per day', 'vip arrivals')}
      ${row('health', '🩺 Room problems not followed up', 'Sent to a department with no fix reply, or an arrival into a problem room nobody sent — once per problem', 'room health engineering maintenance')}
      ${row('handover', '📒 Handover items still open', '30 min before your shift ends', 'handover book open items')}
      ${row('summary', '📋 End-of-shift summary', '~10 min before your shift ends: departures, arrivals, in-house, handover, room problems, WhatsApp, shift tasks', 'summary end of shift report')}
      ${row('offShift', 'Alert me even off shift', 'Normally nothing is sent on your day off or outside your shift on the roster', 'off shift roster day off')}
      <div class="hs-row" data-s="quiet hours night mute shift alerts"><span class="hs-txt"><b>🌙 Quiet hours</b><small>No automatic alerts between these times</small></span>
        <span class="hs-inline sa-q"><input type="time" value="${esc(CFG.qFrom)}" aria-label="Quiet from" onchange="hoShiftAlerts.setCfg('qFrom', this.value)"><span>–</span><input type="time" value="${esc(CFG.qTo)}" aria-label="Quiet until" onchange="hoShiftAlerts.setCfg('qTo', this.value)">
        <label class="hs-switch"><input type="checkbox" ${CFG.quiet ? 'checked' : ''} onchange="hoShiftAlerts.setCfg('quiet', this.checked)" aria-label="Quiet hours on"><i></i></label></span></div>
      <div class="hs-row" data-s="end of shift summary send now copy whatsapp handover"><span class="hs-txt"><b>📋 Summary now</b><small>Telegram, plus one-tap Copy / Send to the WhatsApp handover group</small></span>
        <span class="hs-inline"><button class="btn sm ghost" onclick="hoShiftAlerts.open()">Preview</button><button class="btn sm" onclick="hoShiftAlerts.sendSummary()">Send summary now</button></span></div>
      ${recent.length ? `<div class="hs-row hs-mini" data-s="recent alerts sent shift"><span class="hs-txt"><small>Recent: ${recent.map(h => `${esc(hhmm(h.at))} ${esc(h.t)}`).join(' · ')}</small></span></div>` : ''}
    </div>`;
}
function renderSection() {
  try {
    const sec = D.getElementById('hs-shiftalerts'); if (!sec) return;
    if (sec.contains(D.activeElement) && D.activeElement.type === 'time') return;   // don't redraw under a time picker
    sec.innerHTML = sectionHtml();
  } catch (_) {}
}
function mountSection() {
  try {
    const box = D.getElementById('hsBody'); if (!box || !box.querySelector('.hs-sec') || D.getElementById('hs-shiftalerts')) return;
    const sec = D.createElement('section'); sec.className = 'hs-sec'; sec.id = 'hs-shiftalerts';
    sec.innerHTML = sectionHtml();
    const after = D.getElementById('hs-alerts');
    if (after && after.parentNode === box) after.after(sec); else box.appendChild(sec);
    const q = D.getElementById('hsSearch');
    if (q && q.value && fn('hoSettingsFilter')) hoSettingsFilter(q.value);
  } catch (_) {}
}
let obs = null;
function watchSettings() {
  const box = D.getElementById('hsBody');
  if (!box || obs) return !!obs;
  obs = new MutationObserver(mountSection);   // settings.js redraws #hsBody with innerHTML: put the section back
  obs.observe(box, { childList: true });
  mountSection();
  return true;
}
function said(r) {
  r = r || [];
  toast(r.length ? '🔔 Sent: ' + r.join(', ') : 'Nothing new to send right now (or already sent)', 'ok');
}

// ══ Start ═══════════════════════════════════════════════════
function start() {
  if (started || !uid() || typeof fbListen !== 'function') return;
  started = true;
  safe(() => fbListen(P('cfg'), v => { if (v && typeof v === 'object') { CFG = Object.assign({}, DEF, v); lsSet(LS_CFG, CFG); renderSection(); } }));
  safe(() => fbListen(P('sent'), v => { SENT = v && typeof v === 'object' ? v : {}; }));
  // only to know a way to the phone exists; wa-guard.js owns these
  safe(() => fbListen('waGuard/' + uid() + '/tg', v => { TG = v && v.token && v.chat ? { bot: v.bot || '', chat: v.chat } : null; renderSection(); }));
  safe(() => fbListen('waGuard/' + uid() + '/ntfy', v => { NTFY = v && v.topic ? { topic: v.topic } : null; renderSection(); }));
  setTimeout(prune, 30e3);
  setTimeout(() => check(), 20e3);   // the pages' data has arrived by then
}
const boot = setInterval(() => { safe(() => { watchSettings(); if (uid()) start(); if (started && obs) clearInterval(boot); }); }, 1500);
setInterval(() => { if (started && Date.now() - lastRun > 50e3) check(); }, 60e3);

// Ops Brain: "end of shift summary", "handover summary", "how did my shift go"
(W.BR_EXTRA = W.BR_EXTRA || []).push(() => {
  const t = summary();
  return [{ id: 'shiftalerts:summary', kind: '📋 End-of-shift summary', title: 'End-of-shift summary — departures, arrivals, handover, tasks',
    body: `<pre class="sa-pre">${esc(t)}</pre><div class="br-acts"><button class="btn gold" onclick="brClose();hoShiftAlerts.open()">📋 Copy / WhatsApp</button>${connected() ? '<button class="btn" onclick="hoShiftAlerts.sendSummary()">📲 Send to Telegram</button>' : ''}</div>`,
    text: 'end of shift summary handover summary shift report how did my shift go summary for handover group send summary telegram whatsapp shift summary', boost: 2 }];
});

const css = D.createElement('style');
css.textContent = `
.sa-ov{position:fixed;inset:0;z-index:9995;background:rgba(0,0,0,.5);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom));backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
.sa-ov[hidden]{display:none}
.sa-sheet{width:min(520px,100%);box-sizing:border-box;background:var(--bg);border:1px solid var(--border2);border-radius:20px;padding:16px;box-shadow:0 30px 80px rgba(0,0,0,.45);display:flex;flex-direction:column;gap:10px}
.sa-hd{display:flex;align-items:center;justify-content:space-between;gap:10px}.sa-hd b{font-size:16px}
.sa-x{width:38px;height:38px;border-radius:12px;border:1px solid var(--border2);background:transparent;color:var(--text2);font-size:15px;cursor:pointer}
.sa-pre{margin:0;padding:12px;border-radius:12px;background:var(--bg2);border:1px solid var(--border);font:500 13px/1.55 var(--font);color:var(--text);white-space:pre-wrap;overflow-wrap:anywhere}
.sa-acts{display:flex;gap:8px;flex-wrap:wrap}.sa-acts .sa-btn{flex:1 1 auto}
.sa-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:42px;padding:0 14px;border-radius:12px;border:1px solid var(--border2);background:var(--card);color:var(--text);font:700 14px var(--font);cursor:pointer;text-decoration:none;box-sizing:border-box}
.sa-btn.ghost{background:transparent;color:var(--text2)}.sa-btn.wa{width:100%;border:0;background:#25d366;color:#05361a !important}
.sa-wa{display:flex;flex-direction:column;gap:8px}.sa-wa select{width:100%}
.sa-fine{color:var(--text3);font-size:12px;line-height:1.45}
.sa-need{background:color-mix(in srgb,var(--amber,#d97706) 10%,transparent)}
.sa-q input[type=time]{min-width:0;width:110px}
.sa-pill{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(84px + env(safe-area-inset-bottom));z-index:9990;display:flex;align-items:center;gap:4px;max-width:calc(100vw - 32px);padding:4px;border-radius:99px;background:var(--card);border:1px solid var(--border2);box-shadow:0 12px 30px rgba(0,0,0,.3)}
.sa-pill[hidden]{display:none}
.sa-pill-go{border:0;background:transparent;color:var(--text);font:600 13px var(--font);padding:8px 12px;cursor:pointer;text-align:left}.sa-pill-go b{color:var(--accent)}
.sa-pill-x{width:32px;height:32px;flex:none;border:0;border-radius:50%;background:var(--bg2);color:var(--text3);cursor:pointer}`;
D.head.appendChild(css);
D.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

W.hoShiftAlerts = {
  summary, sendSummary, check, open, close, copy, toWa, toTg, setCfg, connect: () => safe(() => W.hoWaGuard.open()), said, hidePill,
  summaryData: () => safe(() => summaryData(), null), shiftInfo: () => safe(() => shiftInfo(), null), overdueRooms: () => safe(() => overdueRooms(), []),
  vipArrivals: () => safe(() => vipArrivals(), []), healthToChase: () => safe(() => healthToChase(), []), openHandover: () => safe(() => openHandover(shiftInfo()), []),
  get state() { return { cfg: Object.assign({}, CFG), connected: connected(), started, lastRun, sent: Object.assign({}, SENT), local: Object.assign({}, LOCAL), device: DEV, lastText: SHEET_TEXT }; },
};
})(window);

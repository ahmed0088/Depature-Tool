// ═══════════════════════════════════════════════════════════
//  opera-bridge.js — 📡 Opera reader → HotelOps
//
//  The Opera reader (tools/hotelops-opera.console.js — run by the HotelOps
//  helper extension on Opera Cloud, or pasted in Opera's console) reads the
//  screens you open in Opera Cloud and sends what it saw here:
//      {source:'ho-op', h, snap:{kind, date, title, total, rows:[…]}}
//  (kind: arrivals | departures | inhouse | search | details | list).
//  We answer {source:'ho-op-ack', h, text} so its pill shows what we did.
//  Accepted from this window (the helper's relay) or an Oracle host
//  (*.oraclecloud.com, *.oracleindustry.com, *.oraclehospitality.com).
//
//  "Adjust by itself" (Settings → 📡 Opera reader, on by default) then fixes
//  the app's own lists — never wiping what people typed:
//   • Departures: a room Opera shows checked out → out (as the card's Check
//     out button); a departure Opera moved to a later day → extended; today's
//     rooms missing from the board are added; balance / nights / rate code /
//     VIP filled; no board for today yet → made from Opera (the same parser a
//     pasted report goes through).
//   • Arrivals + Purpose of Stay: new arrivals for today added (Purpose skips
//     PM rooms 9000+); room, conf., email filled when empty; nationality only
//     when empty (like the Neorcha scraper: Vicas XML, a hand-typed value or
//     any value already there stays; the Vicas XML is laid on again after).
//   • In-House Guests: today's list gets new rooms and fresher values; when
//     there is none yet, the In House screen makes it.
//  Each change set: a toast with Undo, a line in the log below the switches,
//  the activity log, and (when worth it) a phone alert via hoNotify.
//  "Review before applying" holds the changes until you press Apply.
//  Only one HotelOps tab on this PC applies (a lock), readonly roles never.
//  Ops Brain: window.BR_EXTRA answers "opera", room numbers and names from
//  the last read; window.hoOpera.{last, rows, find, fresh} for other modules.
//  Pure helpers: window.hoOperaPure (tests/run-tests.js "Opera reader").
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';
const W = typeof window !== 'undefined' ? window : globalThis;
const doc = typeof document !== 'undefined' && document && document.createElement ? document : null;

// ══ Pure helpers ════════════════════════════════════════════
const pad = n => String(n).padStart(2, '0');
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const isIso = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
/** "28-OCT-26" (the Departures board), "2026-10-28" → "2026-10-28" */
function toIso(s) {
  s = String(s || '').trim(); if (!s) return '';
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = s.match(/^(\d{1,2})[-\/ ]([A-Za-z]{3})[A-Za-z]*[-\/ ](\d{2,4})$/))) { const mo = MON.indexOf(m[2].toUpperCase()); if (mo < 0) return ''; const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return `${y}-${pad(mo + 1)}-${pad(m[1])}`; }
  return '';
}
/** "2026-10-28" → "28-OCT-26", the way Opera's departures report writes it (and the board keeps it) */
const operaDay = iso => (isIso(iso) ? `${iso.slice(8, 10)}-${MON[+iso.slice(5, 7) - 1]}-${iso.slice(2, 4)}` : '');
const roomKey = r => { const s = String(r == null ? '' : r).trim().toUpperCase().replace(/\s+/g, ''); const m = s.match(/^([A-Z]?)0*(\d+)([A-Z]?)$/); return m ? m[1] + (m[2] || '0') + m[3] : s; };
const realRoom = r => /\d/.test(String(r || '')) && /^[A-Za-z]?\d{1,5}[A-Za-z]?$/.test(String(r || '').trim());
const isPm = room => parseInt(String(room || '').replace(/\D/g, ''), 10) >= 9000;
const normConf = s => String(s || '').trim().replace(/[^a-z0-9]/gi, '').toUpperCase();
function nameKey(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\b(MR|MRS|MS|MISS|DR|MSTR|MASTER|PROF|SIR|MME|SHEIKH|SHEIKHA)\b\.?/g, ' ')
    .replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(w => w.length > 1).sort().join(' ');
}
/** the same guest? (Opera "Doe, Test" and the board's "Test Doe"; one name missing counts as the same) */
function sameGuest(a, b) {
  const A = nameKey(a), B = nameKey(b);
  if (!A || !B || A === B) return true;
  const bs = new Set(B.split(' ').filter(w => w.length >= 3));
  return A.split(' ').some(w => w.length >= 3 && bs.has(w));
}
const OTA = /(^|@|\.)(guest\.)?(trip\.com|booking\.com|expedia(partnercentral)?\.com|airbnb\.com|hotels\.com|agoda\.com|agoda-messaging\.com)$/i;
const isOtaEmail = e => { const at = String(e || '').split('@')[1]; return !!at && OTA.test('@' + at.toLowerCase()); };
const goodEmail = e => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(e || '')) && !/^no@email\.com$/i.test(e) && !isOtaEmail(e);
let _dn = null;
/** Opera's nationality ("AE", "GB", "India") → what the lists write ("UAE", "United Kingdom", "India") */
function natName(v) {
  let s = String(v || '').trim(); if (!s) return '';
  if (/^[A-Za-z]{2}$/.test(s)) {
    try { _dn = _dn || new Intl.DisplayNames(['en'], { type: 'region' }); const n = _dn.of(s.toUpperCase()); if (n && n.toUpperCase() !== s.toUpperCase()) s = n; } catch (_) {}
  }
  if (/^(u\.?a\.?e\.?|united arab emirates)$/i.test(s)) return 'UAE';
  return s;
}
/** Opera "Doe, Test Mr." → "Test Doe" (in-house list style) */
function firstLast(raw) {
  raw = String(raw || '').trim().replace(/[,\s]+(?:MR|MRS|MS|MISS|DR|MSTR|PROF)\.?\s*$/i, '');
  if (!raw.includes(',')) return raw;
  const t = /^(MR|MRS|MS|MISS|DR|MSTR|MASTER|PROF|SIR|MME|M)\.?$/i;
  const p = raw.split(',').map(x => x.trim()).filter(x => x && !t.test(x));
  return p.slice(0, 2).reverse().join(' ').trim() || raw;
}
// the app's own cleaners (utils.js) when loaded; small copies for the tests
const FX = {
  cleanName: raw => (typeof cleanName === 'function' ? cleanName(raw) : (() => { raw = String(raw || '').replace(/,?\s*(Mr\.|Mrs\.|Ms\.|Miss|MR|MRS|DR\.?)\.?\s*$/i, '').trim(); const p = raw.split(',').map(x => x.trim()).filter(Boolean); return (p.length >= 2 ? p[1] + ' ' + p[0] : raw).toUpperCase(); })()),
  parseName: raw => (typeof parseName === 'function' ? parseName(raw) : firstLast(raw) || '—'),
  cleanSource: (a, c, s) => (typeof cleanSource === 'function' ? cleanSource(a, c, s) : (a || c || s || 'ALL App')),
};
const BAD = new Set(['cancelled', 'no_show', 'waitlist']);
const STR = ['room', 'name', 'conf', 'arrival', 'departure', 'status', 'statusText', 'roomType', 'roomStatus', 'company', 'agent', 'source', 'group', 'rateCode', 'market', 'member', 'payment', 'eta', 'etd', 'nat', 'email', 'vip', 'notes'];
const NUM = ['nights', 'adults', 'children', 'balance', 'rate'];
const KINDS = ['arrivals', 'departures', 'inhouse', 'search', 'details', 'list'];
/** what came from another tab, made safe: known fields only, short strings, real numbers, at most 1500 lines */
function sanitize(snap) {
  if (!snap || typeof snap !== 'object' || !Array.isArray(snap.rows)) return null;
  const kind = KINDS.includes(snap.kind) ? snap.kind : 'list';
  const rows = snap.rows.slice(0, 1500).map(r => {
    if (!r || typeof r !== 'object') return null;
    const o = {};
    STR.forEach(k => { if (r[k] != null && r[k] !== '') o[k] = String(r[k]).replace(/[\u0000-\u001f]+/g, ' ').slice(0, k === 'notes' ? 300 : 90).trim(); });
    NUM.forEach(k => { const n = +r[k]; if (r[k] != null && r[k] !== '' && isFinite(n)) o[k] = n; });
    if (o.arrival && !isIso(o.arrival)) delete o.arrival;
    if (o.departure && !isIso(o.departure)) delete o.departure;
    return o.room || o.conf || o.name ? o : null;
  }).filter(Boolean);
  return { kind, date: isIso(snap.date) ? snap.date : '', title: String(snap.title || '').slice(0, 90), total: Math.max(0, +snap.total || 0), frame: String(snap.frame || '').slice(0, 12), rows };
}

/** What Opera's screen means for the app's lists — nothing is changed here.
 *  inp: { snap, today, board: {rooms, day}, arr, pur, ih: {date, rows}|null } → the changes, with counts */
function plan(inp) {
  const s = inp.snap, t = inp.today, kind = s.kind, date = s.date;
  const rows = (s.rows || []).filter(r => !BAD.has(r.status));
  const P = { kind, date, read: (s.rows || []).length, dep: { create: null, out: [], ext: [], add: [], fill: [] }, arr: { add: [], fill: [] }, pur: { add: [], fill: [] }, ih: { mode: '', add: [], upd: [] }, notes: [], n: 0 };
  const cancelled = (s.rows || []).filter(r => BAD.has(r.status));
  if (cancelled.length) P.notes.push(`${cancelled.length} cancelled / no-show in Opera (left as they are here)`);
  const screenToday = !date || date === t;

  // ── Departures ──
  const board = inp.board || { rooms: [], day: '' }, B = board.rooms || [];
  const bday = board.day || '';
  const depRows = rows.filter(r => realRoom(r.room) && (r.departure === t || (kind === 'departures' && !r.departure && screenToday)) && r.status !== 'due_in');
  const findB = r => B.find(b => roomKey(b.roomStr != null ? b.roomStr : b.room) === roomKey(r.room));
  if ((!B.length || (bday && bday < t)) && (kind === 'departures' || kind === 'inhouse') && depRows.length) {
    P.dep.create = depRows.slice();
  } else if (B.length && (!bday || bday === t)) {
    depRows.forEach(r => {
      const b = findB(r);
      if (!b) { P.dep.add.push({ row: r, out: r.status === 'checked_out' }); return; }
      if (!sameGuest(b.name, r.name)) { P.notes.push(`Room ${b.roomStr}: Opera shows ${r.name || 'another guest'}, the board ${b.name} — not changed`); return; }
      if (r.status === 'checked_out' && b.status !== 'out' && b.status !== 'extended') P.dep.out.push({ room: b.roomStr, row: r });
      const set = {};
      if (r.balance != null && r.balance !== b.balance) set.balance = r.balance;
      if (r.nights && r.nights !== b.nights) set.nights = r.nights;
      if (r.rateCode && !b.rateCode) set.rateCode = r.rateCode;
      if (r.company && !b.company) set.company = r.company;
      if (r.vip && !b.isVip) set.isVip = true;
      if (r.etd && !b.depTime && /^\d{1,2}:\d{2}/.test(r.etd)) set.depTime = r.etd.slice(0, 5);
      if (r.arrival && !b.arrival) set.arrival = operaDay(r.arrival);
      if (Object.keys(set).length) P.dep.fill.push({ room: b.roomStr, set });
    });
    // the departure moved to a later day in Opera: the stay was extended there
    rows.forEach(r => {
      if (!realRoom(r.room) || !r.departure || r.departure <= t || r.status === 'checked_out' || (r.arrival && r.arrival > t)) return;
      const b = findB(r);
      if (!b || !sameGuest(b.name, r.name) || !['due', 'late', 'na', 'dnd'].includes(b.status)) return;
      if (P.dep.ext.some(e => e.room === b.roomStr)) return;
      P.dep.ext.push({ room: b.roomStr, nights: dayDiff(t, r.departure), to: r.departure, row: r });
    });
  } else if (B.length && bday > t && depRows.length) P.notes.push('the Departures board is for a later day — not changed');

  // ── Arrivals + Purpose of Stay ──
  const arrRows = rows.filter(r => (r.arrival === t || (kind === 'arrivals' && !r.arrival && screenToday)) && r.status !== 'checked_out');
  if (kind === 'arrivals' && !arrRows.length && rows.length && date && date !== t) P.notes.push(`arrivals for ${date} — not today, nothing changed`);
  const noRoom = arrRows.filter(r => !realRoom(r.room)).length;
  const planList = (list, out, purpose) => {
    list = list || [];
    const taken = new Set();
    arrRows.forEach(r => {
      if (purpose && realRoom(r.room) && isPm(r.room)) return;
      const c = normConf(r.conf);
      let g = c ? list.find(x => normConf(x.conf) === c) : null;
      if (!g && realRoom(r.room)) g = list.find(x => roomKey(x.room) === roomKey(r.room) && sameGuest(x.name, r.name) && (!x.conf || !c));
      if (!g && r.name) g = list.find(x => !realRoom(x.room) && nameKey(x.name) === nameKey(FX.cleanName(r.name)));
      if (g) {
        if (taken.has(g)) return; taken.add(g);
        const set = {};
        if (realRoom(r.room) && !realRoom(g.room)) set.room = r.room;
        if (r.conf && !g.conf) set.conf = r.conf;
        if (goodEmail(r.email) && (!g.email || /^no@email\.com$/i.test(g.email))) set.email = r.email;
        const nat = natName(r.nat);
        // nationality: like the Neorcha scraper (v430), only into an empty one — Vicas XML, a hand-typed value or anything already there stays
        if (nat && !String(g.nat || '').trim() && !g._natFromXML && !g._natUserEdited) set.nat = nat;
        if (Object.keys(set).length) out.fill.push({ g, set });
        return;
      }
      if (!realRoom(r.room) || !r.name) return;   // like a pasted report: a guest without a room waits until Opera gives one
      const nat = natName(r.nat);
      const ng = { room: r.room, conf: r.conf || '', name: FX.cleanName(r.name), purpose: 'Business', nights: r.nights || 1, nat: nat || '',
        email: goodEmail(r.email) ? r.email : 'No@email.com', source: FX.cleanSource(r.agent || '', r.company || '', r.source || ''), remarks: '', _fromOpera: true };
      if (purpose) ng.originOfTravel = '';
      if (nat) ng._natFromOpera = true;
      out.add.push(ng);
    });
  };
  if (arrRows.length) { planList(inp.arr, P.arr, false); planList(inp.pur, P.pur, true); }
  if (noRoom && (P.arr.add.length || kind === 'arrivals')) P.notes.push(`${noRoom} arrival${noRoom === 1 ? '' : 's'} without a room yet — added once Opera gives a room`);

  // ── In-House Guests ──
  const ihRows = rows.filter(r => realRoom(r.room) && (r.status === 'in_house' || r.status === 'due_out' || (kind === 'inhouse' && !r.status)));
  const ih = inp.ih && inp.ih.date === t ? inp.ih : null;
  const toIh = r => {
    const g = { room: r.room, rk: roomKey(r.room), name: firstLast(r.name) || '—', arrival: r.arrival || '', departure: r.departure || '', nights: r.nights || (r.arrival && r.departure ? Math.max(0, dayDiff(r.arrival, r.departure)) : 0),
      adults: r.adults || 0, children: r.children || 0, balance: r.balance || 0, src: 'opera' };
    [['rateCode'], ['company'], ['agent'], ['source'], ['conf'], ['nat'], ['vip'], ['roomType'], ['market'], ['notes'], ['statusText', 'status'], ['etd', 'depTime'], ['member']].forEach(([a, b]) => { if (r[a]) g[b || a] = r[a]; });
    if (r.rate != null) g.rate = r.rate;
    return g;
  };
  if (ihRows.length && (ih || kind === 'inhouse')) {
    if (!ih) { P.ih.mode = 'create'; P.ih.add = ihRows.map(toIh); }
    else {
      P.ih.mode = 'merge';
      const L = ih.rows || [];
      ihRows.forEach(r => {
        const c = normConf(r.conf);
        const old = (c && L.find(x => normConf(x.conf) === c)) || L.find(x => roomKey(x.room) === roomKey(r.room) && sameGuest(x.name, r.name) && !(c && x.conf));
        const n = toIh(r);
        if (!old) { P.ih.add.push(n); return; }
        const set = {};
        ['arrival', 'departure', 'nights', 'adults', 'children', 'balance', 'rate', 'rateCode', 'company', 'agent', 'source', 'conf', 'nat', 'vip', 'roomType', 'market', 'depTime'].forEach(k => {
          const v = n[k]; if (v === undefined || v === '' || (v === 0 && k !== 'balance')) return;
          if (k === 'balance' && r.balance == null) return;
          if (old[k] !== v) set[k] = v;
        });
        if (Object.keys(set).length) P.ih.upd.push({ r: old, set });
      });
    }
  }
  P.n = (P.dep.create ? P.dep.create.length : 0) + P.dep.out.length + P.dep.ext.length + P.dep.add.length + P.dep.fill.length + P.arr.add.length + P.arr.fill.length
    + P.pur.add.length + P.pur.fill.length + P.ih.add.length + P.ih.upd.length;
  return P;
}
const pl = (n, w, ws) => `${n} ${n === 1 ? w : (ws || w + 's')}`;
/** "3 rooms checked out, 2 new arrivals added" (the big news first) */
function summaryText(P) {
  const L = [];
  if (P.dep.create) L.push(`today's departures made (${pl(P.dep.create.length, 'room')})`);
  if (P.dep.out.length) L.push(`${pl(P.dep.out.length, 'room')} checked out`);
  if (P.dep.ext.length) L.push(`${pl(P.dep.ext.length, 'room')} extended`);
  if (P.dep.add.length) L.push(`${pl(P.dep.add.length, 'departure')} added`);
  const newArr = Math.max(P.arr.add.length, P.pur.add.length);
  if (newArr) L.push(`${pl(newArr, 'new arrival')} added`);
  const filled = P.arr.fill.length + P.pur.fill.length;
  if (filled) L.push(`${pl(filled, 'arrival')} filled in`);
  if (P.dep.fill.length) L.push(`${pl(P.dep.fill.length, 'departure')} updated`);
  if (P.ih.mode === 'create') L.push(`in-house list made (${pl(P.ih.add.length, 'guest')})`);
  else if (P.ih.add.length || P.ih.upd.length) L.push(`in-house list +${P.ih.add.length} ~${P.ih.upd.length}`);
  return L.join(', ');
}
/** worth a phone alert: guests left, stayed on, arrived or a list was made */
const worthAlert = P => !!(P.dep.create || P.dep.out.length || P.dep.ext.length || P.arr.add.length || P.pur.add.length);
function hashOf(v) { const s = typeof v === 'string' ? v : JSON.stringify(v); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
/** the departures report text (Opera's delimited columns) for rows: the board is made by the same parser a pasted report uses */
function depReport(rows) {
  const H = ['ROOM', 'GUEST_NAME', 'ARRIVAL', 'DEPARTURE', 'NIGHTS', 'BALANCE', 'TRAVEL_AGENT_NAME', 'COMPANY_NAME', 'SOURCE_NAME', 'RATE_CODE', 'VIP', 'DEPARTURE_TIME', 'CONFIRMATION_NO', 'NATIONALITY', 'ADULTS', 'CHILDREN'];
  const cl = v => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ');
  return [H.join('\t')].concat(rows.map(r => [r.room, r.name || '', operaDay(r.arrival), operaDay(r.departure), r.nights || 0, r.balance || 0, r.agent || '', r.company || '', r.source || '', r.rateCode || '', r.vip || '',
    /^\d{1,2}:\d{2}/.test(r.etd || '') ? r.etd.slice(0, 5) : '', r.conf || '', r.nat || '', r.adults || '', r.children || ''].map(cl).join('\t'))).join('\n') + '\n';
}
W.hoOperaPure = { toIso, operaDay, roomKey, nameKey, sameGuest, isOtaEmail, goodEmail, natName, firstLast, sanitize, plan, summaryText, worthAlert, depReport, hashOf, isPm };
if (!doc) return;

// ══ State ═══════════════════════════════════════════════════
const ORIGIN_OK = /^https:\/\/([a-z0-9-]+\.)+(oraclecloud|oracleindustry|oraclehospitality)\.com$/i;
const LS_CFG = 'ho_op_cfg_v1', LS_LOG = 'ho_op_log_v1', LS_LAST = 'ho_op_last_v1', LS_LOCK = 'ho_op_lock';
const TAB = Math.random().toString(36).slice(2, 9), T0 = Date.now();
const safe = (f, d) => { try { return f(); } catch (e) { try { console.warn('[opera-bridge]', e); } catch (_) {} return d; } };
const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
const today = () => (typeof hoLocalISO === 'function' ? hoLocalISO() : new Date().toISOString().slice(0, 10));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hhmm = t => (t ? new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—');
const toast = (m, k) => safe(() => { if (typeof showToast === 'function') showToast(m, k || 'ok'); });
const quiet = fn => (W.hoUndo && typeof W.hoUndo.quietly === 'function') ? W.hoUndo.quietly(fn) : fn();
let CFG = Object.assign({ auto: true, review: false }, LS.get(LS_CFG, {}));
let LOG = (() => { const v = LS.get(LS_LOG, null); return v && v.date === today() && Array.isArray(v.items) ? v.items : []; })();
let LAST = (() => { const v = LS.get(LS_LAST, null); return v && v.date === today() && v.kinds && typeof v.kinds === 'object' ? v.kinds : {}; })();
const LS_PEND = 'ho_op_pending_v1';
let LINK = null, WAIT = null, PENDING = LS.get(LS_PEND, {}) || {};
const savePending = () => LS.set(LS_PEND, PENDING);
const WAITING = 'waiting for HotelOps to load';
const SEEN = new Map();   // hash → what we answered (a snapshot sent twice is done once)

const signedIn = () => typeof currentProfile !== 'undefined' && !!currentProfile;
/** this person may change the lists (readonly never; same rule as loading a report) */
const canWrite = () => signedIn() && currentProfile.role !== 'readonly';
/** the lists have arrived from the database (a read before that must not make a board over the real one) */
function ready() {
  if (!signedIn() || typeof depRooms === 'undefined') return false;
  if (typeof depIsTyping === 'function' && safe(() => depIsTyping(), false)) return false;
  return Date.now() - T0 > 10000;
}
/** only one HotelOps tab on this PC applies what Opera shows (the others just keep the read) */
function haveLock() {
  const l = LS.get(LS_LOCK, null), now = Date.now();
  if (l && l.tab !== TAB && now - l.at < 30000) return false;
  LS.set(LS_LOCK, { tab: TAB, at: now });
  return true;
}
function saveLog() { if (LOG.length > 80) LOG = LOG.slice(0, 80); LS.set(LS_LOG, { date: today(), items: LOG }); }
function saveLast() { LS.set(LS_LAST, { date: today(), kinds: LAST }); }
function addLog(e) { LOG.unshift(Object.assign({ at: Date.now() }, e)); saveLog(); paint(); }
// another HotelOps tab on this PC may be the one applying: its log is this tab's log too
function readLog() { const v = LS.get(LS_LOG, null); if (v && v.date === today() && Array.isArray(v.items)) LOG = v.items; return LOG; }
// the switches and the changes waiting for an OK are shared too: Apply works in whichever tab you're in
W.addEventListener('storage', e => {
  if (e.key === LS_LOG) readLog();
  else if (e.key === LS_CFG) CFG = Object.assign({ auto: true, review: false }, LS.get(LS_CFG, {}));
  else if (e.key === LS_PEND) PENDING = LS.get(LS_PEND, {}) || {};
  else return;
  safe(paint);
});

function boardNow() {
  const rooms = typeof depRooms !== 'undefined' ? depRooms : [];
  let day = '';
  safe(() => { const d = typeof _depBoardDate === 'function' ? _depBoardDate() : null; if (d && !isNaN(d)) day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; });
  if (!day) { const r = rooms.find(x => x.departure && !x.manual) || rooms.find(x => x.departure); day = r ? toIso(r.departure) : ''; }
  return { rooms, day };
}
const ihNow = () => safe(() => { const s = W.hoInHouse && W.hoInHouse.state ? W.hoInHouse.state().snap : null; return s && Array.isArray(s.rows) ? s : null; }, null);
function planNow(snap) {
  return plan({ snap, today: today(), board: boardNow(), arr: typeof arrGuests !== 'undefined' ? arrGuests : [], pur: typeof purposeGuests !== 'undefined' ? purposeGuests : [], ih: ihNow() });
}

// ══ Applying ════════════════════════════════════════════════
const J = o => JSON.stringify(o === undefined ? null : o);
function paintDeps() { safe(() => depRender()); safe(() => updateDepBadge()); }
function apply(snap, how) {
  const P = planNow(snap);
  if (!P.n) return { P, text: '' };
  const t = today(), at = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const before = { dep: J(typeof depRooms !== 'undefined' ? depRooms : []), log: J(typeof depLog !== 'undefined' ? depLog : []), arr: J(typeof arrGuests !== 'undefined' ? arrGuests : []), pur: J(typeof purposeGuests !== 'undefined' ? purposeGuests : []), ih: J(ihNow()) };
  let depTouched = false;
  // Departures
  if (P.dep.create && P.dep.create.length && doc.getElementById('depInput') && typeof processDep === 'function') {
    const inp = doc.getElementById('depInput'), keep = inp.value;
    inp.value = depReport(P.dep.create);
    safe(() => quiet(() => processDep()));
    if (inp.value) inp.value = keep;
    P.dep.create.filter(r => r.status === 'checked_out').forEach(r => P.dep.out.push({ room: r.room, row: r }));
    depTouched = true;
  }
  P.dep.add.forEach(({ row, out }) => {
    if (typeof depAddManualRoom !== 'function') return;
    const ok = safe(() => quiet(() => depAddManualRoom(row.room, FX.parseName(row.name || ''))), false);
    const b = ok && depRooms.find(x => roomKey(x.roomStr) === roomKey(row.room));
    if (!b) return;
    delete b.manual; b.opera = true;
    if (row.name) b.name = FX.parseName(row.name);
    if (row.arrival) b.arrival = operaDay(row.arrival);
    b.departure = operaDay(row.departure || t) || b.departure;
    if (row.nights) b.nights = row.nights;
    if (row.balance != null) b.balance = row.balance;
    b.source = FX.cleanSource(row.agent || '', row.company || '', row.source || ''); b.company = row.company || ''; b.rateCode = row.rateCode || ''; b.isVip = !!row.vip;
    b.note = (b.note ? b.note + '\n' : '') + `[${at}] Added from Opera`;
    if (out) P.dep.out.push({ room: b.roomStr, row });
    depTouched = true;
  });
  P.dep.out.forEach(({ room }) => {
    const i = depRooms.findIndex(x => roomKey(x.roomStr) === roomKey(room)); if (i < 0) return;
    const r = depRooms[i]; if (r.status === 'out') return;
    r.note = (r.note ? r.note + '\n' : '') + `[${at}] Checked out in Opera`;
    safe(() => quiet(() => depAction(i, 'out')));
    depTouched = true;
  });
  P.dep.ext.forEach(({ room, nights, to }) => {
    const i = depRooms.findIndex(x => roomKey(x.roomStr) === roomKey(room)); if (i < 0) return;
    const r = depRooms[i];
    safe(() => quiet(() => depAction(i, 'extended', nights)));
    r.extConfirmed = true;   // already done in Opera: nothing left to put in Opera
    r.note = (r.note ? r.note + '\n' : '') + `[${at}] Extended in Opera to ${to} (${pl(nights, 'night')})`;
    safe(() => { if (typeof depSyncExtToLog === 'function') depSyncExtToLog(i); });
    depTouched = true;
  });
  P.dep.fill.forEach(({ room, set }) => { const r = depRooms.find(x => roomKey(x.roomStr) === roomKey(room)); if (r) { Object.assign(r, set); depTouched = true; } });
  if (depTouched) { paintDeps(); safe(() => saveDeps()); }
  // Arrivals + Purpose of Stay (Vicas XML laid on again after: it always wins)
  const doList = (list, part, render, saveFn, logFn, label) => {
    if (typeof list === 'undefined' || (!part.add.length && !part.fill.length)) return false;
    part.fill.forEach(({ g, set }) => {
      Object.assign(g, set);
      if (set.nat) { g._natFromOpera = true; g._natFromAI = false; g._fromMemory = false; g._natSuspect = false; }
      if (set.email && typeof gmOnEdit === 'function') safe(() => gmOnEdit(g.name, 'email', set.email));
    });
    part.add.forEach(g => list.push(g));
    if (part.add.length) safe(() => { if (typeof gmAutoFill === 'function') gmAutoFill(part.add, true); });
    safe(() => render()); safe(() => saveFn(list));
    if (typeof logFn === 'function') safe(() => logFn('Opera', `${part.add.length ? part.add.length + ' added' : ''}${part.add.length && part.fill.length ? ', ' : ''}${part.fill.length ? part.fill.length + ' filled in' : ''} from the Opera ${label} screen`));
    return true;
  };
  const a1 = doList(typeof arrGuests !== 'undefined' ? arrGuests : undefined, P.arr, () => arrRender(), l => saveArrivals(l), typeof addArrLog === 'function' ? addArrLog : null, P.kind);
  const a2 = doList(typeof purposeGuests !== 'undefined' ? purposeGuests : undefined, P.pur, () => purposeRender(), l => savePurpose(l), typeof addPurposeLog === 'function' ? addPurposeLog : null, P.kind);
  if ((a1 || a2) && typeof _applyOriginToPurpose === 'function') safe(() => _applyOriginToPurpose());
  // In-House Guests
  if (P.ih.mode && W.hoInHouse && W.hoInHousePure) safe(() => {
    const IP = W.hoInHousePure, cur = ihNow();
    const snapIh = P.ih.mode === 'create' || !cur ? { date: t, at: new Date().toISOString(), by: 'Opera reader', file: 'Opera Cloud screen', cols: [], extraCols: [], rows: [] } : JSON.parse(JSON.stringify(cur));
    P.ih.upd.forEach(({ r, set }) => { const x = snapIh.rows.find(y => y.rk === r.rk && y.name === r.name && (y.conf || '') === (r.conf || '')); if (x) Object.assign(x, set); });
    P.ih.add.forEach(g => snapIh.rows.push(g));
    snapIh.at = new Date().toISOString();
    const S = IP.summary(IP.groupRooms(snapIh.rows), t);
    W.hoInHouse.setSnapshot(snapIh);
    if (typeof fbSet === 'function') { fbSet('inhouse/' + t, snapIh).then(() => fbSet('inhouseMeta/latest', { date: t, at: snapIh.at, by: snapIh.by || 'Opera reader', rooms: S.rooms, guests: S.guests })).catch(() => {}); }
    if (W.hoInHouse.render) W.hoInHouse.render();
  });
  const text = summaryText(P);
  const after = { dep: J(typeof depRooms !== 'undefined' ? depRooms : []), arr: J(typeof arrGuests !== 'undefined' ? arrGuests : []), pur: J(typeof purposeGuests !== 'undefined' ? purposeGuests : []), ih: J(ihNow()) };
  // Undo: everything back as it was, when nobody changed those lists since
  const undo = () => {
    let ok = false;
    const back = (now, list, prev, done) => { if (J(list) !== now || now === prev) return; const old = JSON.parse(prev) || []; list.splice(0, list.length, ...old); done(); ok = true; };
    if (typeof depRooms !== 'undefined') back(after.dep, depRooms, before.dep, () => { const L = JSON.parse(before.log) || []; depLog.splice(0, depLog.length, ...L); paintDeps(); safe(() => saveDepartures(depRooms, depLog)); safe(() => depSetBase(depRooms, depLog)); });
    if (typeof arrGuests !== 'undefined') back(after.arr, arrGuests, before.arr, () => { safe(() => arrRender()); safe(() => saveArrivals(arrGuests)); });
    if (typeof purposeGuests !== 'undefined') back(after.pur, purposeGuests, before.pur, () => { safe(() => purposeRender()); safe(() => savePurpose(purposeGuests)); });
    if (after.ih !== before.ih && J(ihNow()) === after.ih) safe(() => {
      const old = JSON.parse(before.ih);
      W.hoInHouse.setSnapshot(old); if (typeof fbSet === 'function') fbSet('inhouse/' + t, old || null); if (W.hoInHouse.render) W.hoInHouse.render(); ok = true;
    });
    if (!ok) toast('Opera changes: the lists changed since — not undone', 'warn');
    else addLog({ kind: P.kind, text: 'Undone: ' + text, undo: true });
    return ok;
  };
  const detail = []
    .concat(P.dep.out.map(o => `🚪 ${o.room} checked out`), P.dep.ext.map(e => `↪ ${e.room} extended to ${e.to}`), P.dep.add.map(a => `➕ ${a.row.room} added to departures`),
      P.arr.add.map(g => `🛎️ ${g.room} ${g.name}`), P.notes);
  addLog({ kind: P.kind, text, detail: detail.slice(0, 30), how: how || 'auto' });
  const msg = '📡 Opera: ' + text;
  if (typeof showUndoToast === 'function') showUndoToast(msg, undo, 10000); else toast(msg);
  safe(() => { if (typeof logActivity === 'function') logActivity('opera_reader', text); });
  if (worthAlert(P) && W.hoNotify && typeof W.hoNotify.send === 'function') safe(() => W.hoNotify.send({ cat: 'departures', prio: 2, toast: false, url: P.arr.add.length && !P.dep.out.length ? 'arrivals' : 'departures',
    title: msg, body: detail.slice(0, 12).join('\n'), key: 'op_' + t + '_' + hashOf(detail.join('|') + text) }));
  return { P, text };
}

// ══ Receiving ═══════════════════════════════════════════════
const KIND_LABEL = { arrivals: 'Arrivals', departures: 'Departures', inhouse: 'In House', search: 'Reservation search', details: 'Reservation details', list: 'a reservation list' };
function receive(raw, h, reply) {
  const snap = sanitize(raw);
  if (!snap) return 'nothing readable';
  h = String(h || hashOf([snap.kind, snap.date, snap.rows]));
  if (SEEN.has(h) && SEEN.get(h) !== WAITING) return SEEN.get(h);
  LAST[snap.kind] = { kind: snap.kind, date: snap.date, title: snap.title, total: snap.total, n: snap.rows.length, at: Date.now(), h, rows: snap.rows.slice(0, 600) };
  saveLast();
  const res = handle(snap, h, reply);
  SEEN.set(h, res); if (SEEN.size > 200) SEEN.delete(SEEN.keys().next().value);
  LAST[snap.kind].res = res; saveLast(); paint();
  return res;
}
function handle(snap, h, reply) {
  if (!ready()) { WAIT = { snap, h, reply }; clearTimeout(handle._t); handle._t = setTimeout(retryWait, 4000); return WAITING; }
  if (!canWrite()) return 'read · your role can\'t change lists';
  if (!CFG.auto) return 'read · "adjust by itself" is off';
  if (!haveLock()) return 'read · another HotelOps tab applies it';
  const P = planNow(snap);
  if (!P.n) return P.notes.length ? 'nothing to change · ' + P.notes[0] : 'up to date';
  if (CFG.review) {
    PENDING[snap.kind] = { snap, at: Date.now(), text: summaryText(P), n: P.n }; savePending();
    toast(`📡 Opera: ${summaryText(P)} — waiting for you (Settings → Opera reader)`, 'info');
    paint();
    return 'waiting for your OK: ' + summaryText(P);
  }
  return safe(() => apply(snap, 'auto').text, '') || 'up to date';
}
function retryWait() {
  if (!WAIT) return;
  if (!ready()) { handle._t = setTimeout(retryWait, 4000); return; }
  const s = WAIT.snap, h = WAIT.h, reply = WAIT.reply; WAIT = null;
  const r = handle(s, h, reply); SEEN.set(h, r);
  if (typeof reply === 'function') reply({ source: 'ho-op-ack', h, text: r });   // the reader's pill said "waiting": now what was done
  if (LAST[s.kind]) { LAST[s.kind].res = r; saveLast(); }
  paint();
}
function applyPending(kind) {
  if (!canWrite()) { toast('Your role can\'t change lists', 'err'); return; }
  PENDING = LS.get(LS_PEND, PENDING) || PENDING;
  const ks = kind ? [kind] : Object.keys(PENDING);
  let any = '';
  ks.forEach(k => { const p = PENDING[k]; delete PENDING[k]; savePending(); if (p) { const r = safe(() => apply(p.snap, 'reviewed'), null); if (r && r.text) any = r.text; } });
  if (!any) toast('Nothing left to change — the lists already match Opera', 'info');
  paint();
}
function discardPending() { PENDING = {}; savePending(); paint(); }

W.addEventListener('message', e => {
  const d = e.data;
  if (!d || typeof d !== 'object' || d.source !== 'ho-op') return;
  const same = e.source === W && e.origin === location.origin;
  if (!same && !ORIGIN_OK.test(e.origin)) return;
  const reply = o => { try { if (same) W.postMessage(o, location.origin); else if (e.source) e.source.postMessage(o, e.origin); } catch (_) {} };
  const was = LINK && Date.now() - LINK.at < 60000;
  LINK = { at: Date.now(), ext: same, v: String(d.v || '').slice(0, 12) };
  if (d.ping) {
    reply({ source: 'ho-op-ack', pong: 1, frame: String(d.frame || ''), again: !!(d.h && !SEEN.has(String(d.h))), auto: CFG.auto });
    if (!was) paint();
    return;
  }
  if (d.snap) { const res = receive(d.snap, d.h, reply); reply({ source: 'ho-op-ack', h: String(d.h || ''), text: res }); }
});
if (/opera-reader/.test(location.hash)) safe(() => history.replaceState(null, '', location.pathname + location.search));   // opened by the console reader
setInterval(() => {
  if (LOG.length && LS.get(LS_LOG, {}).date !== today()) { LOG = []; LAST = {}; saveLog(); saveLast(); }   // a new day
  if (LINK && LS.get(LS_LOCK, {}).tab === TAB) LS.set(LS_LOCK, { tab: TAB, at: Date.now() });
  if (doc.getElementById('hs-opera')) paint();
}, 20000);

// ══ Settings → 📡 Opera reader ══════════════════════════════
const linkedNow = () => !!LINK && Date.now() - LINK.at < 60000;
function setCfg(k, v) { CFG = Object.assign({}, CFG, { [k]: !!v }); LS.set(LS_CFG, CFG); if (k === 'review' && !v && Object.keys(PENDING).length) applyPending(); paint(); }
async function copyReader() {
  try {
    if (!W.hoWaHelper || !W.hoWaHelper.opReader) throw new Error('no helper');
    const code = await W.hoWaHelper.opReader();
    await navigator.clipboard.writeText(code);
    toast('Opera reader copied — in the Opera Cloud tab press F12 → Console, paste, Enter, then "Connect"', 'ok');
  } catch (_) { toast('Could not copy the reader (offline?) — try again', 'err'); }
}
function row(s, label, desc, right) { return `<div class="hs-row" data-s="${esc(s)}"><span class="hs-txt"><b>${label}</b><small>${desc}</small></span>${right ? `<span class="hs-inline">${right}</span>` : ''}</div>`; }
function sw(k, label, desc, on) {
  return `<label class="hs-row" data-s="${esc('opera reader ' + label + ' ' + desc).toLowerCase()}"><span class="hs-txt"><b>${label}</b><small>${desc}</small></span>
    <span class="hs-switch"><input type="checkbox" data-op="${k}" ${on ? 'checked' : ''}><i></i></span></label>`;
}
function cardHtml() {
  const D = doc.documentElement.dataset, helper = !!D.hoOpHelper, anyHelper = !!D.hoWaHelper;
  const kinds = Object.values(LAST).sort((a, b) => b.at - a.at);
  const last = kinds[0];
  const st = linkedNow() ? `🟢 Linked${LINK.ext ? ' through the helper' : ' (console reader)'}` : last ? '⚪ Not linked right now' : '⚪ Not linked yet';
  const lastTxt = last ? ` · last read ${hhmm(last.at)}: ${last.n}${last.total > last.n ? ' of ' + last.total : ''} on ${esc(KIND_LABEL[last.kind] || last.kind)}${last.date && last.date !== today() ? ' (' + esc(last.date) + ')' : ''}` : '';
  const get = helper ? '<span class="op-ok">✓ The helper has the Opera reader</span>'
    : `<button class="btn sm gold" data-op="dl">⬇ ${anyHelper ? 'Get the helper again (once)' : 'Get the helper'}</button>`;
  const pend = Object.values(PENDING);
  const ro = !canWrite() && signedIn();
  return row('opera reader linked status last read', '📡 Opera Cloud reader', `${st}${lastTxt}${ro ? '<br>Your role only sees what Opera shows — the lists are changed by colleagues who can edit.' : ''}`,
      `${get}<button class="btn sm ghost" data-op="copy" title="For a PC without the helper: paste it in Opera's console">Copy console reader</button>`)
    + (!helper ? row('opera reader how to add helper', 'How to turn it on', `${anyHelper ? 'Your helper is from before the Opera reader: download it once more, then in <code>chrome://extensions</code> press ↻ on the HotelOps helper (or remove it and <b>Load unpacked</b> the new folder).' : 'Download the helper, unzip it, open <code>chrome://extensions</code>, turn on Developer mode, <b>Load unpacked</b> the folder, and turn on <b>Allow User Scripts</b> in its Details.'} Then open Opera Cloud: a small 📡 HotelOps pill shows bottom right. It only reads; it never clicks or types in Opera.`) : '')
    + sw('auto', 'Adjust by itself', 'Check out rooms Opera shows checked out, mark extensions, add new arrivals and fill empty details. Never changes what someone typed.', CFG.auto)
    + sw('review', 'Review before applying', 'Hold the changes here until you press Apply', CFG.review)
    + (pend.length ? `<div class="hs-row hs-col" data-s="opera reader waiting review apply"><span class="hs-txt"><b>Waiting for your OK</b><small>${pend.map(p => `${esc(KIND_LABEL[p.snap.kind] || p.snap.kind)} (${hhmm(p.at)}): ${esc(p.text)}`).join('<br>')}</small></span>
        <span class="hs-inline"><button class="btn sm gold" data-op="apply">Apply</button><button class="btn sm ghost" data-op="discard">Discard</button></span></div>` : '')
    + (kinds.length ? `<div class="hs-row hs-col" data-s="opera reader screens read today"><span class="hs-txt"><b>Read today</b><small>The newest read of each screen</small></span><div class="op-list">${kinds.map(k =>
        `<div class="op-item"><span>${esc(KIND_LABEL[k.kind] || k.kind)}</span><span>${k.n}${k.total > k.n ? ' of ' + k.total : ''} · ${hhmm(k.at)}</span><small>${esc(k.res || '')}</small></div>`).join('')}</div></div>` : '')
    + `<div class="hs-row hs-col" data-s="opera reader what changed log"><span class="hs-txt"><b>What it changed</b><small>${LOG.length ? 'Today, newest first · each change also had an Undo' : 'Nothing yet today'}</small></span>${LOG.length ? `<div class="op-list">${LOG.slice(0, 10).map(l =>
        `<div class="op-item"><span>${hhmm(l.at)}</span><span>${esc(l.text)}</span>${l.detail && l.detail.length ? `<small>${esc(l.detail.slice(0, 6).join(' · '))}${l.detail.length > 6 ? ' …' : ''}</small>` : ''}</div>`).join('')}</div>` : ''}</div>`;
}
function sectionHtml() {
  return `<section class="hs-sec" id="hs-opera"><div class="hs-sec-hd"><span class="hs-sec-ic">📡</span><div><h2>Opera reader</h2><p>HotelOps reads Opera Cloud while you use it and keeps its lists up to date by itself</p></div></div>
    <div class="hs-card">${cardHtml()}</div></section>`;
}
function paint() {
  const c = doc.querySelector('#hs-opera .hs-card'); if (!c) return;
  c.innerHTML = cardHtml();
}
function inject() {
  const box = doc.getElementById('hsBody');
  if (!box || !box.querySelector('.hs-sec') || doc.getElementById('hs-opera')) return;
  const after = doc.getElementById('hs-folder') || doc.getElementById('hs-data');
  if (after) after.insertAdjacentHTML('afterend', sectionHtml()); else box.insertAdjacentHTML('beforeend', sectionHtml());
  const toc = doc.querySelector('.hs-toc a[href="#hs-folder"]') || doc.querySelector('.hs-toc a[href="#hs-data"]');
  if (toc && !doc.querySelector('.hs-toc a[href="#hs-opera"]')) toc.insertAdjacentHTML('afterend', '<a href="#hs-opera">Opera reader</a>');
}
function wire() {
  const box = doc.getElementById('hsBody'); if (!box) return false;
  safe(() => new MutationObserver(inject).observe(box, { childList: true }));
  inject();
  box.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('#hs-opera [data-op]'); if (!t || t.tagName === 'INPUT') return;
    const a = t.dataset.op;
    if (a === 'dl') { if (W.hoWaHelper) W.hoWaHelper.download(); } else if (a === 'copy') copyReader();
    else if (a === 'apply') applyPending(); else if (a === 'discard') discardPending();
  });
  box.addEventListener('change', e => { const t = e.target.closest && e.target.closest('#hs-opera input[data-op]'); if (t) setCfg(t.dataset.op, t.checked); });
  return true;
}
function css() {
  const s = doc.createElement('style'); s.id = 'opCss';
  s.textContent = `#hs-opera .op-list{display:grid;gap:6px;margin-top:10px}
#hs-opera .op-item{display:grid;grid-template-columns:minmax(0,150px) minmax(0,1fr);gap:4px 10px;font-size:12.5px;padding:6px 10px;border:1px solid var(--border,#333);border-radius:var(--r,6px)}
#hs-opera .op-item span:first-child{font-weight:600;color:var(--text,#eee)}#hs-opera .op-item span+span{color:var(--text2,#bbb)}
#hs-opera .op-item small{grid-column:1/-1;color:var(--text3,#999)}#hs-opera .op-ok{font-size:12.5px;color:var(--green,#16a34a);font-weight:600;align-self:center}
@media (max-width:560px){#hs-opera .op-item{grid-template-columns:1fr}}`;
  (doc.head || doc.documentElement).appendChild(s);
}
css();
if (!wire()) { const iv = setInterval(() => { if (wire()) clearInterval(iv); }, 2000); setTimeout(() => clearInterval(iv), 120000); }
new MutationObserver(() => paint()).observe(doc.documentElement, { attributes: true, attributeFilter: ['data-ho-op-helper', 'data-ho-wa-helper'] });

// ══ Ops Brain: knows the last read (BR_EXTRA, read by brain.js) — it never pops up for this ══
(W.BR_EXTRA = W.BR_EXTRA || []).push(() => {
  const kinds = Object.values(LAST).sort((a, b) => b.at - a.at);
  const out = [];
  const age = k => Math.round((Date.now() - k.at) / 60000);
  out.push({ id: 'op:status', kind: '📡 Opera reader', title: kinds.length ? `Opera read ${age(kinds[0])} min ago — ${kinds.map(k => `${k.n} ${KIND_LABEL[k.kind] || k.kind}`).join(', ')}` : 'Opera reader: nothing read yet today',
    body: (kinds.length ? `<ul>${kinds.map(k => `<li><b>${esc(KIND_LABEL[k.kind] || k.kind)}</b>: ${k.n} line${k.n === 1 ? '' : 's'} at ${hhmm(k.at)} (${age(k)} min ago)${k.res ? ' · ' + esc(k.res) : ''}</li>`).join('')}</ul>` : '<div>Open Opera Cloud with the HotelOps helper and the lists fill themselves.</div>')
      + (LOG.length ? `<div>Changed today:</div><ul>${LOG.slice(0, 6).map(l => `<li>${hhmm(l.at)} · ${esc(l.text)}</li>`).join('')}</ul>` : '')
      + `<div class="br-acts"><button class="btn" onclick="brClose();showPanel('settings');setTimeout(()=>{const e=document.getElementById('hs-opera');if(e)e.scrollIntoView({block:'start'})},300)">Opera reader settings</button></div>`,
    text: 'opera reader scraper scan live read fresh linked opera cloud auto arrivals departures in house what did opera change checked out', go: 'settings', boost: 1 });
  // each guest of the newest reads: "512", "room 512", a name or a confirmation finds what Opera showed
  const seen = new Set();
  kinds.forEach(k => (k.rows || []).forEach(r => {
    const key = (r.conf || '') + '|' + (r.room || '') + '|' + (r.name || ''); if (seen.has(key) || out.length > 400) return; seen.add(key);
    const st = { due_in: 'arriving', in_house: 'in house', due_out: 'due out', checked_out: 'checked out', cancelled: 'cancelled', no_show: 'no show' }[r.status] || r.statusText || '';
    out.push({ id: 'op:r:' + key, kind: `📡 Opera · ${KIND_LABEL[k.kind] || k.kind} at ${hhmm(k.at)}`, title: `${r.room ? 'Room ' + r.room + ' · ' : ''}${r.name || ''}${st ? ' · ' + st : ''}`,
      body: esc([r.arrival && 'arrives ' + r.arrival, r.departure && 'leaves ' + r.departure, r.nights && r.nights + ' nights', r.conf && 'conf. ' + r.conf, r.nat, r.email, r.agent || r.company || r.source, r.rateCode, r.vip && 'VIP ' + r.vip, r.balance && 'balance ' + r.balance].filter(Boolean).join(' · ')),
      text: ['room', r.room, r.room, r.name, r.conf, 'opera', st].filter(Boolean).join(' '), go: k.kind === 'arrivals' ? 'arrivals' : k.kind === 'inhouse' ? 'inhouse' : 'departures' });
  }));
  return out;
});

// ══ For other modules ═══════════════════════════════════════
W.hoOpera = {
  /** the newest read of a screen kind (arrivals | departures | inhouse | search | details | list), or of any */
  last: kind => { const L = kind ? LAST[kind] : Object.values(LAST).sort((a, b) => b.at - a.at)[0]; return L ? JSON.parse(JSON.stringify(L)) : null; },
  /** read from Opera less than `min` minutes ago? */
  fresh: (kind, min) => { const L = kind ? LAST[kind] : Object.values(LAST).sort((a, b) => b.at - a.at)[0]; return !!L && Date.now() - L.at < (min || 30) * 60000; },
  rows: () => Object.values(LAST).reduce((a, k) => a.concat(k.rows || []), []),
  find: room => { const k = roomKey(room); for (const L of Object.values(LAST).sort((a, b) => b.at - a.at)) { const r = (L.rows || []).find(x => roomKey(x.room) === k); if (r) return Object.assign({ seenOn: L.kind, at: L.at }, r); } return null; },
  log: () => readLog().slice(), linked: linkedNow, cfg: () => Object.assign({}, CFG), setCfg, pending: () => Object.keys(PENDING), applyPending, discardPending,
  receive, plan: planNow, render: paint,
};
})();

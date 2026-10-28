// ═══════════════════════════════════════════════════════════
//  opera-bridge.js — 📡 Opera reader → HotelOps
//
//  The Opera reader (tools/hotelops-opera.console.js — run by the HotelOps
//  helper extension on Opera Cloud, or pasted in Opera's console) reads the
//  screens you open in Opera Cloud and sends what it saw here:
//      {source:'ho-op', h, snap:{kind, date, title, total, rows:[…]}}
//  (kind: arrivals | departures | inhouse | search | details | list | billing |
//  rooms | profile | traces | rates | group | audit | other; billing brings
//  snap.folio, traces snap.traces, other screens snap.tables).
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
//   • Billing / Folio: the folio's balance goes onto today's departure
//     and the in-house list each time a bill is read (Undo like the rest);
//     0.00 shows as Settled. Departures cards get "💳 balance open" (Opera's
//     folio still open on a due room), the room's Opera status (🧹 Dirty,
//     ✔ Inspected…) and, when you usually open the bill before a check-out,
//     "🧠 open its bill in Opera first". Near check-out time one gentle phone
//     alert per room and day for a due room whose folio is still open
//     (hoNotify, departures, prio 3, batched).
//   • Profiles: an EMPTY VIP / membership of the same guest is filled (in-house
//     list, Departures VIP) — never one already there.
//   • Room card (room-card.js → hoOpera.cardHtml): folio, room status, traces
//     and profile Opera showed today.
//  Learning from you ("watch me", Settings → Learn from me in Opera, on by
//  default): the reader sends the screens you open and the labels of what you
//  click (never typing, never a line of a list). Kept per user on this PC
//  (localStorage ho_op_learn_v1:{uid}, 21 days) and, as a short summary of
//  screens and button labels, under operaLearn/{uid}. It finds your routines,
//  their usual hours and time, what comes before a check-out and the time per
//  screen; the reader's pill gets a quiet "Usually next: Settle".
//  Ops Brain: window.BR_EXTRA answers "opera", room numbers and names from
//  the last read, folios, room status, traces, profiles, other screens' tables
//  and "my Opera routine" / "what do I usually do before a check-out";
//  window.hoOpera.{last, rows, find, fresh, folio, roomStatus, traces, profile,
//  learned} for other modules.
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
const STR = ['room', 'name', 'conf', 'arrival', 'departure', 'status', 'statusText', 'roomType', 'roomStatus', 'hkStatus', 'foStatus', 'disc', 'rs', 'company', 'agent', 'source', 'group', 'rateCode', 'market', 'member', 'memberLevel',
  'payment', 'eta', 'etd', 'nat', 'email', 'vip', 'notes', 'prefs', 'alerts', 'language'];
const NUM = ['nights', 'adults', 'children', 'balance', 'rate'];
const KINDS = ['arrivals', 'departures', 'inhouse', 'search', 'details', 'list', 'billing', 'rooms', 'profile', 'traces', 'rates', 'group', 'audit', 'other'];
const RS = ['clean', 'dirty', 'inspected', 'pickup', 'ooo', 'oos'];
// ── privacy, the app's own net (the reader already did this): no card number, no card / password field ──
/** any run of 12–19 digits (spaces / dashes allowed), or a half-hidden card, → "•••• 1234" */
function maskCards(s) {
  s = String(s == null ? '' : s);
  if (s.length < 12) return s;
  return s.replace(/(?<!\d)\d(?:[ \-]?\d){11,}(?!\d)/g, m => '•••• ' + m.replace(/\D/g, '').slice(-4))
    .replace(/(?<!\d)\d{0,6}[Xx*•]{4,}[ \-]?(?:[Xx*•]{4}[ \-]?){0,3}(\d{4})(?!\d)/g, (m, l4) => '•••• ' + l4);
}
/** a label that names card data or a secret (card, CC, PAN, CVV, expiry, auth code, password, PIN, passport…) */
function secretLabel(h) {
  const n = String(h || '').toUpperCase().replace(/#/g, ' NO ').replace(/[^A-Z0-9]+/g, ' ').trim(); if (!n) return false;
  if (/^(?:(?:CREDIT |PAYMENT )?CARD TYPE|PAYMENT TYPE|PAYMENT METHOD|METHOD OF PAYMENT)$/.test(n)) return false;
  if (/^(?:EXP|EXP DATE|EXPIRY|EXPIRES|EXPIRATION|EXPIRATION DATE|EXPIRY DATE|VALID THRU|VALID UNTIL|PIN|PAN|CC|CC NO|AUTH|AUTH NO|CID|CVV2|CVC2|CV2)$/.test(n)) return true;
  return /\b(?:CARD|CARDS|CARDHOLDER|CREDIT CARD|CC NUMBER|CVV|CVC|SECURITY CODE|PASSWORD|PASSWORDS|PASSCODE|PWD|PIN CODE|PIN NO|AUTH CODE|AUTHORI[SZ]ATION(?: CODE| NO)?|APPROVAL CODE|IBAN|SWIFT|PASSPORT|ID NO|ID NUMBER|DOCUMENT NO|DOCUMENT NUMBER)\b/.test(n);
}
const cut = (v, n) => maskCards(String(v == null ? '' : v).replace(/[\u0000-\u001f]+/g, ' ')).slice(0, n).trim();
const num = v => (v != null && v !== '' && isFinite(+v) ? Math.round(+v * 100) / 100 : null);
function cleanFolio(F) {
  if (!F || typeof F !== 'object') return null;
  const o = { room: cut(F.room, 8), name: cut(F.name, 80), conf: cut(F.conf, 20), balance: num(F.balance), zero: !!F.zero, settled: !!F.settled, status: ['checked_out', 'in_house', 'due_out', 'due_in'].includes(F.status) ? F.status : '' };
  o.windows = (Array.isArray(F.windows) ? F.windows : []).slice(0, 8).map(w => (w && +w.n >= 1 && +w.n <= 8 ? { n: +w.n, balance: num(w.balance) } : null)).filter(Boolean);
  o.pays = (Array.isArray(F.pays) ? F.pays : []).slice(0, 6).map(x => cut(x, 20)).filter(x => x && !/\d/.test(x));
  o.postings = (Array.isArray(F.postings) ? F.postings : []).slice(0, 200).map(p => {
    if (!p || typeof p !== 'object' || num(p.amount) == null) return null;
    const x = { code: cut(p.code, 20), desc: cut(p.desc, 60), amount: num(p.amount) };
    if (isIso(p.date)) x.date = p.date;
    if (+p.window >= 1 && +p.window <= 8) x.window = +p.window;
    if (p.pay) { x.pay = cut(p.pay, 20).replace(/[\d•]+/g, '').trim() || 'Payment'; x.desc = x.pay + ' payment'; }   // a payment: its type, nothing else
    else if (p.ref) x.ref = cut(p.ref, 40);
    if (+p.qty > 1) x.qty = Math.min(999, Math.round(+p.qty));
    return x;
  }).filter(Boolean);
  return o.room || o.conf || o.name || o.balance != null || o.postings.length ? o : null;
}
/** what came from another tab, made safe: known fields only, short strings, real numbers, at most 1500 lines */
function sanitize(snap) {
  if (!snap || typeof snap !== 'object' || !Array.isArray(snap.rows)) return null;
  const kind = KINDS.includes(snap.kind) ? snap.kind : 'list';
  const rows = snap.rows.slice(0, 1500).map(r => {
    if (!r || typeof r !== 'object') return null;
    const o = {};
    STR.forEach(k => { if (r[k] != null && r[k] !== '') o[k] = cut(r[k], k === 'notes' ? 300 : k === 'prefs' || k === 'alerts' ? 200 : 90); });
    NUM.forEach(k => { const n = +r[k]; if (r[k] != null && r[k] !== '' && isFinite(n)) o[k] = n; });
    if (o.arrival && !isIso(o.arrival)) delete o.arrival;
    if (o.departure && !isIso(o.departure)) delete o.departure;
    if (o.rs && !RS.includes(o.rs)) delete o.rs;
    if (o.payment && /\d/.test(o.payment)) delete o.payment;   // the payment type only, never a number
    if (Array.isArray(r.extra)) { const ex = r.extra.slice(0, 60).filter(p => Array.isArray(p) && !secretLabel(p[0])).map(p => [cut(p[0], 40), cut(p[1], 120)]).filter(p => p[0] && p[1]); if (ex.length) o.extra = ex; }
    return o.room || o.conf || o.name ? o : null;
  }).filter(Boolean);
  const out = { kind, date: isIso(snap.date) ? snap.date : '', title: cut(snap.title, 90), total: Math.max(0, +snap.total || 0), frame: String(snap.frame || '').slice(0, 12), rows };
  const F = cleanFolio(snap.folio); if (F) out.folio = F;
  if (Array.isArray(snap.traces)) out.traces = snap.traces.slice(0, 150).map(t => {
    if (!t || typeof t !== 'object' || !t.text) return null;
    const x = { text: cut(t.text, 200) };
    if (isIso(t.date)) x.date = t.date; if (/^\d{1,2}:\d{2}$/.test(t.time || '')) x.time = t.time;
    ['dept', 'room', 'name', 'conf'].forEach(k => { if (t[k]) x[k] = cut(t[k], k === 'name' ? 80 : k === 'room' ? 8 : 30); });
    if (t.done != null) x.done = !!t.done;
    return x;
  }).filter(Boolean);
  if (Array.isArray(snap.tables)) out.tables = snap.tables.slice(0, 4).map(tb => {
    if (!tb || !Array.isArray(tb.heads) || !Array.isArray(tb.rows)) return null;
    const keep = tb.heads.slice(0, 30).map((h, i) => (secretLabel(h) ? -1 : i)).filter(i => i >= 0);
    const rws = tb.rows.slice(0, 300).map(r => (Array.isArray(r) ? keep.map(i => cut(r[i], 80)) : null)).filter(r => r && r.some(Boolean));
    return keep.length && rws.length ? { title: cut(tb.title, 60), heads: keep.map(i => cut(tb.heads[i], 40)), rows: rws } : null;
  }).filter(Boolean);
  if (snap.audit && ['failed', 'running', 'done', ''].includes(snap.audit.state)) out.audit = { state: snap.audit.state };
  return out;
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
  // ── Billing: the folio's balance onto today's departure and the in-house list (live, every time the folio is read) ──
  const F = s.folio;
  if (F && F.balance != null) {
    if (B.length && (!bday || bday === t) && realRoom(F.room)) {
      const b = findB(F);
      if (b && sameGuest(b.name, F.name) && b.balance !== F.balance) {
        const ex = P.dep.fill.find(f => f.room === b.roomStr);
        if (ex) ex.set.balance = F.balance; else P.dep.fill.push({ room: b.roomStr, set: { balance: F.balance }, folio: true });
      }
    }
    if (ih) {
      const L = ih.rows || [], c = normConf(F.conf);
      const old = (c && L.find(x => normConf(x.conf) === c)) || (realRoom(F.room) && L.find(x => roomKey(x.room) === roomKey(F.room) && sameGuest(x.name, F.name))) || null;
      if (old && old.balance !== F.balance) { const u = P.ih.upd.find(x => x.r === old); if (u) u.set.balance = F.balance; else { P.ih.mode = P.ih.mode || 'merge'; P.ih.upd.push({ r: old, set: { balance: F.balance } }); } }
    }
  }
  // ── Profiles: an empty VIP / membership filled (never one already there), only when it is surely the same guest ──
  if (kind === 'profile' || kind === 'details') rows.forEach(r => {
    const vip = r.vip, mem = r.memberLevel || r.member;
    if (!vip && !mem) return;
    const nk = nameKey(r.name), c = normConf(r.conf);
    const same = (name, conf, room) => (c && normConf(conf) === c) || (!!nk && nameKey(firstLast(name)) === nk && (!r.room || !room || roomKey(room) === roomKey(r.room)));
    if (ih) {
      const hits = (ih.rows || []).filter(x => same(x.name, x.conf, x.room));
      if (hits.length === 1) {
        const x = hits[0], set = {};
        if (vip && !String(x.vip || '').trim()) set.vip = vip;
        if (mem && !String(x.member || '').trim()) set.member = mem;
        if (Object.keys(set).length) { const u = P.ih.upd.find(y => y.r === x); if (u) Object.keys(set).forEach(k => { if (u.set[k] == null) u.set[k] = set[k]; }); else { P.ih.mode = P.ih.mode || 'merge'; P.ih.upd.push({ r: x, set }); } }
      }
    }
    if (vip && B.length && (!bday || bday === t)) {
      const hits = B.filter(b => same(b.name, b.conf, b.roomStr != null ? b.roomStr : b.room));
      if (hits.length === 1 && !hits[0].isVip) { const ex = P.dep.fill.find(f => f.room === hits[0].roomStr); if (ex) ex.set.isVip = true; else P.dep.fill.push({ room: hits[0].roomStr, set: { isVip: true } }); }
    }
  });
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
  const fol = P.dep.fill.filter(f => f.folio), oth = P.dep.fill.length - fol.length;
  fol.forEach(f => L.push(`room ${f.room} balance ${Math.abs(f.set.balance) < 0.005 ? 'settled (0.00)' : 'AED ' + f.set.balance.toFixed(2)} from its Opera folio`));
  if (oth) L.push(`${pl(oth, 'departure')} updated`);
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
// ══ Learning from you in Opera ("watch me") — pure ══════════════
// The reader sends the screens opened and the labels of what was clicked: [{t, k:'s', s:kind, l:title} | {t, k:'c', l:label} | {t, k:'r'}].
// Kept: screen kinds and button labels only — never a guest name, a room, an amount or anything typed.
const LEARN_KINDS = { arrivals: 'Arrivals', departures: 'Departures', inhouse: 'In House', search: 'Reservation search', details: 'Reservation', list: 'Reservation list', billing: 'Billing',
  rooms: 'Room status', profile: 'Profile', traces: 'Traces', rates: 'Rates', group: 'Group / Block', audit: 'Night audit', other: 'Other screen' };
/** a button label as it may be kept (the same rule as the reader): short words, no 3+ digit numbers, amounts, emails or commas */
function cleanLabel(s) {
  let t = String(s == null ? '' : s).replace(/[\u00a0\u202f\u2007]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 60 || /\d{3,}|@|,|\d[.,]\d|•/.test(t)) return '';
  t = t.replace(/[^\p{L}\p{N}&\/+.'\- ]/gu, ' ').replace(/\s+/g, ' ').replace(/^[\s.\-]+|[\s.\-]+$/g, '').trim();
  if (!t || !/\p{L}{2,}/u.test(t) || t.split(' ').length > 6) return '';
  return t.slice(0, 40).trim();
}
/** all the words of a label are words of a guest's name → it is the guest, not a button */
function guesty(l, words) { if (!words || !words.size) return false; const ws = nameKey(l).split(' ').filter(w => w.length >= 3); return ws.length > 0 && ws.every(w => words.has(w)); }
/** what the reader saw → safe events [{t, k, v, l}] (k: s screen, c click, r a line of a list) */
function learnClean(list, words) {
  const out = [];
  (Array.isArray(list) ? list : []).slice(0, 300).forEach(e => {
    if (!e || typeof e !== 'object') return;
    const t = Math.round(+e.t); if (!(t > 1e12 && t < 4e12)) return;
    if (e.k === 's') {
      const kind = LEARN_KINDS[e.s] ? e.s : 'other';
      if (kind !== 'other') { out.push({ t, k: 's', v: kind, l: LEARN_KINDS[kind] }); return; }
      const l = cleanLabel(e.l); const ok = l && !guesty(l, words);
      out.push({ t, k: 's', v: ok ? 'other:' + l.toLowerCase() : 'other', l: ok ? l : 'Other screen' });
    } else if (e.k === 'r') out.push({ t, k: 'r', v: 'line', l: 'a line of a list' });
    else if (e.k === 'c') { const l = cleanLabel(e.l); if (l && !guesty(l, words)) out.push({ t, k: 'c', v: l.toLowerCase(), l }); }
  });
  return out;
}
const GAP = 10 * 60e3;   // a pause this long ends a task
const tokOf = e => e.k + ':' + e.v;
const isCO = k => /^c:(?:complete |confirm |express |)check ?-?out\b/.test(k);
const sameWords = (a, b) => String(a || '').toLowerCase().replace(/[^a-z]/g, '') === String(b || '').toLowerCase().replace(/[^a-z]/g, '');
/** events → tasks: [[{k, t, end}]]. A step repeated right after itself counts once; the menu click that opens a screen of the
 *  same name is that screen (one step); a check-out ends a task. */
function sessionsOf(ev) {
  const S = []; let cur = null, last = 0, endNext = false;
  const E = (ev || []).slice().sort((a, b) => a.t - b.t);
  E.forEach((e, i) => {
    const n = E[i + 1];
    if (e.k === 'c' && n && n.k === 's' && n.t - e.t < 8000 && (sameWords(e.l, n.l) || sameWords(e.v, n.v))) return;
    const k = tokOf(e);
    if (!cur || e.t - last > GAP || endNext) { cur = []; S.push(cur); endNext = false; }
    last = e.t;
    if (cur.length && cur[cur.length - 1].k === k) { cur[cur.length - 1].end = e.t; return; }
    cur.push({ k, t: e.t, end: e.t });
    if (isCO(k)) endNext = true;
  });
  return S;
}
/** the hours most of it happens: "10:00–12:00" ('' when spread over the day) */
function hoursText(hours) {
  if (!hours.length) return '';
  const c = new Array(24).fill(0); hours.forEach(h => { c[h]++; });
  let best = 0, bh = 0; for (let h = 0; h < 24; h++) { const v = c[h] + c[(h + 1) % 24]; if (v > best || (v === best && c[h] > c[bh])) { best = v; bh = h; } }
  return best / hours.length >= 0.5 ? `${pad(bh)}:00–${pad((bh + 2) % 24)}:00` : 'at different times';
}
/** events → what was learned: routines (common sequences, their usual hours and time), what comes before a check-out, time per screen, next-step counts */
function learnModel(ev, minN) {
  minN = minN || 3;
  const label = {}; (ev || []).forEach(e => { label[tokOf(e)] = e.l; });
  const S = sessionsOf(ev), grams = {}, next = {};
  S.forEach(T => {
    for (let n = 3; n <= 6; n++) for (let i = 0; i + n <= T.length; i++) {
      const seq = T.slice(i, i + n), toks = seq.map(x => x.k);
      if (new Set(toks).size < 2) continue;
      const key = toks.join('>'), g = grams[key] || (grams[key] = { toks, n: 0, hours: [], durs: [] });
      g.n++; g.hours.push(new Date(seq[0].t).getHours());
      const d = seq[n - 1].end - seq[0].t; if (d >= 0 && d < 30 * 60e3) g.durs.push(d);
    }
    for (let i = 1; i < T.length; i++) for (let n = 1; n <= 3 && i - n >= 0; n++) {
      const key = T.slice(i - n, i).map(x => x.k).join('>'), m = next[key] || (next[key] = {});
      m[T[i].k] = (m[T[i].k] || 0) + 1;
    }
  });
  let cand = Object.values(grams).filter(g => g.n >= minN);
  const inside = (a, b) => b.length > a.length && b.join('>').includes(a.join('>'));
  cand = cand.filter(g => !cand.some(h => inside(g.toks, h.toks) && h.n >= g.n * 0.8));
  cand.sort((a, b) => b.n * b.toks.length - a.n * a.toks.length || b.n - a.n);
  // the same habit seen shifted by a step is one routine, not two
  const overlap = (a, b) => { const m = Math.min(a.length, b.length) - 1; for (let i = 0; i + m <= a.length; i++) if (b.join('>').includes(a.slice(i, i + m).join('>'))) return true; return false; };
  const picked = []; cand.forEach(g => { if (picked.length < 6 && !picked.some(p => overlap(g.toks, p.toks))) picked.push(g); });
  const routines = picked.map(g => ({ steps: g.toks.map(k => label[k] || k), toks: g.toks, n: g.n, hours: hoursText(g.hours), avgSec: g.durs.length ? Math.round(g.durs.reduce((a, b) => a + b, 0) / g.durs.length / 1000) : 0 }));
  // what comes before a check-out (the 5 steps before it, in the same task)
  const bc = {}; let coN = 0;
  S.forEach(T => T.forEach((x, i) => {
    if (!isCO(x.k)) return; coN++;
    new Set(T.slice(Math.max(0, i - 5), i).map(y => y.k).filter(k => !isCO(k))).forEach(k => { bc[k] = (bc[k] || 0) + 1; });
  }));
  const before = Object.keys(bc).map(k => ({ tok: k, l: label[k] || k, n: bc[k], share: coN ? bc[k] / coN : 0 })).sort((a, b) => b.n - a.n).slice(0, 5);
  // time on each screen (until the next screen of the same task)
  const dw = {};
  S.forEach(T => T.forEach((x, i) => {
    if (x.k.indexOf('s:') !== 0) return;
    let j = i + 1; while (j < T.length && T[j].k.indexOf('s:') !== 0) j++;
    const end = j < T.length ? T[j].t : T[T.length - 1].end, d = end - x.t;
    if (d > 0 && d < 30 * 60e3) { const o = dw[x.k] || (dw[x.k] = { n: 0, ms: 0 }); o.n++; o.ms += d; }
  }));
  const dwell = Object.keys(dw).map(k => ({ tok: k, l: label[k] || k, n: dw[k].n, avgSec: Math.round(dw[k].ms / dw[k].n / 1000) })).sort((a, b) => b.n - a.n).slice(0, 6);
  const all = (ev || []).map(e => new Date(e.t).getHours());
  return { events: (ev || []).length, tasks: S.length, routines, before, beforeN: coN, billBeforeCO: coN >= 3 && (bc['s:billing'] || 0) / coN >= 0.6, dwell, busy: hoursText(all), next, label };
}
/** the last steps of the task going on now (newest last) */
function learnRecent(ev, now) {
  const S = sessionsOf(ev), T = S[S.length - 1] || [];
  if (!T.length || (now || Date.now()) - T[T.length - 1].end > GAP) return [];
  return T.slice(-3).map(x => x.k);
}
/** what usually comes next after the steps just done → its label ('' when nothing is clear: seen 3+ times and at least half the time) */
function learnNext(M, recent) {
  if (!M || !recent || !recent.length) return '';
  for (let n = Math.min(3, recent.length); n >= 1; n--) {
    const m = M.next[recent.slice(-n).join('>')]; if (!m) continue;
    const tot = Object.values(m).reduce((a, b) => a + b, 0), best = Object.keys(m).sort((a, b) => m[b] - m[a])[0];
    if (m[best] >= 3 && m[best] / tot >= 0.5 && best !== 'r:line') return M.label[best] || '';
  }
  return '';
}
/** the small summary that may be kept in the database (screens and button labels only) */
function learnSummary(M) {
  return { events: M.events, routines: M.routines.map(r => ({ steps: r.steps, n: r.n, hours: r.hours, avgSec: r.avgSec })), before: M.before.map(b => ({ l: b.l, n: b.n })), beforeN: M.beforeN, billBeforeCO: M.billBeforeCO,
    dwell: M.dwell.map(d => ({ l: d.l, avgSec: d.avgSec, n: d.n })), busy: M.busy };
}
const secTxt = s => (s >= 90 ? Math.round(s / 60) + ' min' : s + ' s');

W.hoOperaPure = { maskCards, secretLabel, cleanFolio, cleanLabel, learnClean, learnModel, learnRecent, learnNext, learnSummary, sessionsOf, toIso, operaDay, roomKey, nameKey, sameGuest, isOtaEmail, goodEmail, natName, firstLast, sanitize, plan, summaryText, worthAlert, depReport, hashOf, isPm };
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
// what Opera showed today, kept on this PC: folio balances, room statuses, traces, profiles (guest data stays on this PC / in the lists)
const LS_FOLIO = 'ho_op_folio_v1', LS_RST = 'ho_op_rooms_v1', LS_TRC = 'ho_op_traces_v1', LS_PRF = 'ho_op_profiles_v1', LS_BALAL = 'ho_op_balalert_v1', LS_LEARN = 'ho_op_learn_v1';
const dayStore = (k, empty) => { const v = LS.get(k, null); return v && v.date === today() ? v : Object.assign({ date: today() }, empty()); };
let FOL = dayStore(LS_FOLIO, () => ({ rooms: {} })), RST = dayStore(LS_RST, () => ({ rooms: {} })), TRC = dayStore(LS_TRC, () => ({ list: [] })), PRF = dayStore(LS_PRF, () => ({ by: {} }));

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
const KIND_LABEL = { arrivals: 'Arrivals', departures: 'Departures', inhouse: 'In House', search: 'Reservation search', details: 'Reservation details', list: 'a reservation list',
  billing: 'Billing / Folio', rooms: 'Room status', profile: 'Profile', traces: 'Traces / Alerts', rates: 'Rates', group: 'Group / Block', audit: 'Night audit', other: 'Other screen' };
function receive(raw, h, reply) {
  const snap = sanitize(raw);
  if (!snap) return 'nothing readable';
  h = String(h || hashOf([snap.kind, snap.date, snap.rows]));
  if (SEEN.has(h) && SEEN.get(h) !== WAITING && LAST[snap.kind] && LAST[snap.kind].h === h) return SEEN.get(h);   // the same screen again: done (a folio back to an earlier state is read again)
  const n = snap.rows.length || (snap.folio ? snap.folio.postings.length : 0) || (snap.traces || []).length || (snap.tables || []).reduce((a, tb) => a + tb.rows.length, 0);
  LAST[snap.kind] = { kind: snap.kind, date: snap.date, title: snap.title, total: snap.total, n, at: Date.now(), h, rows: snap.rows.slice(0, 600) };
  ['folio', 'traces', 'tables', 'audit'].forEach(k => { if (snap[k]) LAST[snap.kind][k] = snap[k]; });
  saveLast();
  safe(() => remember(snap));
  safe(paintDepChips);
  const res = handle(snap, h, reply);
  SEEN.set(h, res); if (SEEN.size > 200) SEEN.delete(SEEN.keys().next().value);
  LAST[snap.kind].res = res; saveLast(); paint();
  return res;
}
/** today's folio balances, room statuses, traces and profiles from a read (for the Departures chips, the room card, the Brain) */
function remember(snap) {
  const at = Date.now(), t = today();
  if (FOL.date !== t) FOL = { date: t, rooms: {} };
  if (RST.date !== t) RST = { date: t, rooms: {} };
  if (TRC.date !== t) TRC = { date: t, list: [] };
  if (PRF.date !== t) PRF = { date: t, by: {} };
  let f = 0, r = 0, tr = 0, pf = 0;
  const F = snap.folio;
  if (F && (realRoom(F.room) || F.conf)) {
    const k = realRoom(F.room) ? roomKey(F.room) : 'c:' + normConf(F.conf);
    FOL.rooms[k] = { room: F.room, name: F.name, conf: F.conf, balance: F.balance, zero: F.zero, settled: F.settled, windows: F.windows, pays: F.pays, n: F.postings.length, status: F.status, at, src: 'folio' };
    f++;
  }
  if (['departures', 'inhouse', 'details'].includes(snap.kind)) snap.rows.forEach(x => {
    if (x.balance == null || !realRoom(x.room) || BAD.has(x.status)) return;
    const k = roomKey(x.room), o = FOL.rooms[k];
    if (o && o.src === 'folio' && at - o.at < 120000 && o.balance !== x.balance) return;   // the folio just read is the finer one
    FOL.rooms[k] = { room: x.room, name: x.name || '', conf: x.conf || '', balance: x.balance, zero: Math.abs(x.balance) < 0.005, settled: x.status === 'checked_out' && Math.abs(x.balance) < 0.005, status: x.status || '', at, src: snap.kind };
    f++;
  });
  snap.rows.forEach(x => {
    if (!realRoom(x.room) || !(x.rs || x.roomStatus || x.hkStatus || x.foStatus || x.disc)) return;
    RST.rooms[roomKey(x.room)] = { room: x.room, rs: x.rs || '', text: x.roomStatus || x.hkStatus || '', fo: x.foStatus || '', hk: x.hkStatus || '', disc: x.disc || '', at, on: snap.kind };
    r++;
  });
  (snap.traces || []).forEach(x => {
    const key = [roomKey(x.room), normConf(x.conf), x.date || '', x.text.slice(0, 60)].join('|');
    const i = TRC.list.findIndex(y => y.key === key), v = Object.assign({ key, at }, x);
    if (i >= 0) TRC.list[i] = v; else TRC.list.push(v);
    tr++;
  });
  if (TRC.list.length > 300) TRC.list = TRC.list.slice(-300);
  if (snap.kind === 'profile' || snap.kind === 'details') snap.rows.forEach(x => {
    const nk = nameKey(x.name); if (!nk || !(x.vip || x.member || x.memberLevel || x.prefs || x.nat || x.language)) return;
    PRF.by[nk] = Object.assign(PRF.by[nk] || {}, { name: x.name, at }, ...['vip', 'member', 'memberLevel', 'prefs', 'nat', 'language', 'conf', 'room'].filter(k => x[k]).map(k => ({ [k]: x[k] })));
    pf++;
  });
  const ks = Object.keys(PRF.by); if (ks.length > 300) ks.sort((a, b) => PRF.by[a].at - PRF.by[b].at).slice(0, ks.length - 300).forEach(k => delete PRF.by[k]);
  if (f) LS.set(LS_FOLIO, FOL); if (r) LS.set(LS_RST, RST); if (tr) LS.set(LS_TRC, TRC); if (pf) LS.set(LS_PRF, PRF);
}
/** Opera's folio for a room read today (newest), or null */
const folioFor = room => { const k = roomKey(room); const v = FOL.date === today() ? FOL.rooms[k] : null; return v || null; };
const statusFor = room => (RST.date === today() ? RST.rooms[roomKey(room)] || null : null);
const RS_LABEL = { clean: '🧽 Clean', dirty: '🧹 Dirty', inspected: '✔ Inspected', pickup: '🧺 Pickup', ooo: '⛔ Out of order', oos: '⚠ Out of service' };
const money2 = v => Number(v).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const balOk = r => safe(() => (typeof depBalOk === 'function' ? depBalOk(r) : false), false);
const ACTIVE = ['due', 'late', 'na', 'dnd'];

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
  if (Array.isArray(d.learn)) { const hint = safe(() => learnAdd(d.learn), ''); reply({ source: 'ho-op-ack', hint: hint || '', learn: learnOn() }); return; }
  if (d.ping) {
    reply({ source: 'ho-op-ack', pong: 1, frame: String(d.frame || ''), again: !!(d.h && !SEEN.has(String(d.h))), auto: CFG.auto, learn: learnOn() });
    if (!was) paint();
    return;
  }
  if (d.snap) { const res = receive(d.snap, d.h, reply); reply({ source: 'ho-op-ack', h: String(d.h || ''), text: res }); }
});
if (/opera-reader/.test(location.hash)) safe(() => history.replaceState(null, '', location.pathname + location.search));   // opened by the console reader
setInterval(() => {
  if (LOG.length && LS.get(LS_LOG, {}).date !== today()) { LOG = []; LAST = {}; saveLog(); saveLast(); }   // a new day
  if (FOL.date !== today()) { FOL = { date: today(), rooms: {} }; RST = { date: today(), rooms: {} }; TRC = { date: today(), list: [] }; PRF = { date: today(), by: {} }; }
  safe(balanceAlerts);
  if (LINK && LS.get(LS_LOCK, {}).tab === TAB) LS.set(LS_LOCK, { tab: TAB, at: Date.now() });
  if (doc.getElementById('hs-opera')) paint();
}, 20000);

// ══ Learning from you in Opera — stored per user on this PC ══
const uidNow = () => safe(() => (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || '', '');
let LRN = null, LRN_KEY = '', LRN_M = null, LRN_HINT = '', LRN_SYNC = { h: '', at: 0 }, GW = { at: 0, set: null }, SHOW_SEEN = false;
function learnStore() {
  const k = LS_LEARN + ':' + (uidNow() || 'anon');
  if (k !== LRN_KEY) { LRN_KEY = k; LRN = Object.assign({ on: true, ev: [] }, LS.get(k, {}) || {}); if (!Array.isArray(LRN.ev)) LRN.ev = []; LRN_M = null; }
  return LRN;
}
const learnOn = () => learnStore().on !== false;
function learnSave() { const L = learnStore(), cut0 = Date.now() - 21 * 864e5; L.ev = L.ev.filter(e => e && e.t >= cut0).slice(-4000); LS.set(LRN_KEY, L); LRN_M = null; }
function learnModelNow() { if (!LRN_M) LRN_M = learnModel(learnStore().ev); return LRN_M; }
/** the words of today's guests' names (a "button" that is only a guest's name is not kept) */
function guestWords() {
  if (GW.set && Date.now() - GW.at < 60000) return GW.set;
  const set = new Set(), add = n => nameKey(n).split(' ').forEach(w => { if (w.length >= 3) set.add(w); });
  safe(() => { (typeof depRooms !== 'undefined' ? depRooms : []).forEach(r => add(r.name)); });
  safe(() => { (typeof arrGuests !== 'undefined' ? arrGuests : []).forEach(g => add(g.name)); (typeof purposeGuests !== 'undefined' ? purposeGuests : []).forEach(g => add(g.name)); });
  safe(() => { const ih = ihNow(); (ih ? ih.rows : []).forEach(g => add(g.name)); });
  Object.values(LAST).forEach(k => (k.rows || []).forEach(r => add(r.name)));
  Object.values(PRF.by || {}).forEach(p => add(p.name));
  GW = { at: Date.now(), set };
  return set;
}
/** what the reader saw you do → kept (cleaned), and the quiet hint for its pill */
function learnAdd(list) {
  if (!uidNow() || !learnOn()) return '';
  const ev = learnClean(list, guestWords());
  if (ev.length) { const L = learnStore(); L.ev = L.ev.concat(ev); learnSave(); }
  const h = learnNext(learnModelNow(), learnRecent(learnStore().ev));
  LRN_HINT = h ? 'Usually next: ' + h : '';
  learnSync(false);
  if (doc.getElementById('hs-opera')) paint();
  return LRN_HINT;
}
/** a small summary under your own user in the database (screens and button labels only; at most every 10 min) */
function learnSync(force) {
  const uid = uidNow(); if (!uid || typeof fbSet !== 'function' || !learnOn()) return;
  const S = learnSummary(learnModelNow()), h = hashOf(S);
  if (h === LRN_SYNC.h || (!force && Date.now() - LRN_SYNC.at < 10 * 60e3)) return;
  LRN_SYNC = { h, at: Date.now() };
  safe(() => fbSet('operaLearn/' + uid, Object.assign({ at: Date.now() }, S)));
}
function setLearn(on) {
  const L = learnStore(); L.on = !!on; learnSave();
  if (!on) LRN_HINT = '';
  toast(on ? '🧠 Learning from you in Opera again' : '🧠 Not learning from you in Opera any more', 'info');
  paint();
}
function forgetLearn() {
  if (typeof confirm === 'function' && !confirm('Clear everything HotelOps learned from you in Opera?')) return;
  const L = learnStore(); L.ev = []; learnSave(); LRN_HINT = '';
  const uid = uidNow(); if (uid && typeof fbSet === 'function') safe(() => fbSet('operaLearn/' + uid, null));
  LRN_SYNC = { h: '', at: 0 };
  toast('Cleared what it learned from you in Opera', 'ok'); paint();
}
const routineTxt = r => `${r.steps.join(' → ')}`;
/** "What it saw today": the screens and buttons, newest first */
function seenToday() {
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  return learnStore().ev.filter(e => e.t >= t0.getTime()).slice(-60).reverse();
}

// ══ Departures: 💳 balance open · 🧠 open its bill in Opera first · room status ══
function paintDepChips() {
  safe(() => {
    const grid = doc.getElementById('depGrid'); if (!grid || typeof depRooms === 'undefined') return;
    const habit = learnOn() && learnModelNow().billBeforeCO;
    grid.querySelectorAll('.dep-card[data-room]').forEach(card => {
      const tags = card.querySelector('.dp-tags'); if (!tags) return;
      const k = roomKey(card.dataset.room), r = depRooms.find(x => roomKey(x.roomStr) === k);
      const f = folioFor(k), st = statusFor(k), active = !!r && ACTIVE.includes(r.status);
      const chips = [];
      const open = active && f && f.balance > 0 && !balOk(r);
      if (open) chips.push(`<span class="dp-chip op-chip op-bal" title="Opera's folio: AED ${esc(money2(f.balance))} open (read ${esc(hhmm(f.at))}${f.src === 'folio' ? ' on its bill' : ''})">💳 balance open</span>`);
      if (active && habit && (open || safe(() => typeof depOwes === 'function' && depOwes(r), false))) chips.push(`<span class="dp-chip op-chip op-hint" title="Learned from you: you usually open the bill in Opera before a check-out">🧠 open its bill in Opera first</span>`);
      if (st && st.rs) chips.push(`<span class="dp-chip op-chip op-rs op-rs-${esc(st.rs)}" title="Room status in Opera${st.text ? ': ' + esc(st.text) : ''}${st.fo ? ' · FO ' + esc(st.fo) : ''}${st.disc ? ' · ' + esc(st.disc) : ''} (read ${esc(hhmm(st.at))})">${esc(RS_LABEL[st.rs] || st.rs)}</span>`);
      let box = card.querySelector('.op-chips');
      if (!chips.length) { if (box) box.remove(); return; }
      if (!box) { box = doc.createElement('span'); box.className = 'op-chips'; tags.appendChild(box); }
      const html = chips.join('');
      if (box.innerHTML !== html) box.innerHTML = html;
    });
  });
}
function wrapDepRender() {
  const r = W.depRender;
  if (typeof r !== 'function' || r.__op) return typeof r === 'function';
  const f = function () { const out = r.apply(this, arguments); paintDepChips(); return out; };
  f.__op = true; Object.keys(r).forEach(k => { try { f[k] = r[k]; } catch (_) {} });
  W.depRender = f;
  return true;
}
/** one gentle phone alert per room and day: due out, Opera's folio still open, close to check-out time */
function balanceAlerts() {
  if (!W.hoNotify || typeof W.hoNotify.send !== 'function' || typeof depRooms === 'undefined' || !signedIn() || !haveLock()) return;
  const t = today(), bd = boardNow().day; if (bd && bd !== t) return;
  const co = safe(() => (typeof _depCoMin === 'function' ? _depCoMin() : 720), 720), d = new Date(), m = d.getHours() * 60 + d.getMinutes();
  if (m < co - 45 || m > co + 180) return;
  let S = LS.get(LS_BALAL, null); if (!S || S.date !== t) S = { date: t, rooms: {} };
  const habit = learnOn() && learnModelNow().billBeforeCO;
  let any = false;
  depRooms.forEach(r => {
    if (!ACTIVE.includes(r.status)) return;
    const k = roomKey(r.roomStr), f = folioFor(k);
    if (S.rooms[k] || !f || !(f.balance > 0) || balOk(r)) return;
    S.rooms[k] = Date.now(); any = true;
    safe(() => W.hoNotify.send({ cat: 'departures', prio: 3, toast: false, url: 'departures', key: `op_bal_${t}_${k}`,
      title: `💳 Room ${r.roomStr}: balance open in Opera (AED ${money2(f.balance)})`,
      body: `Due out today. Settle the folio before check-out.${habit ? ' You usually open its bill in Opera first.' : ''}` }));
  });
  if (any) LS.set(LS_BALAL, S);
}

// ══ Room card: what Opera shows for a room (room-card.js calls window.hoOpera.cardHtml) ══
function roomCardHtml(room) {
  const k = roomKey(room); if (!k) return '';
  const L = [], f = folioFor(k), st = statusFor(k);
  if (f) L.push(`<div class="rc-line"><span><b>Folio</b> · ${f.balance == null ? '—' : f.zero ? 'settled (0.00)' : 'AED ' + esc(money2(f.balance)) + (f.balance > 0 ? ' open' : ' credit')}${(f.windows || []).length > 1 ? ' · ' + f.windows.map(w => `W${w.n} ${w.balance == null ? '—' : esc(money2(w.balance))}`).join(' · ') : ''}${(f.pays || []).length ? ' · paid by ' + esc(f.pays.join(', ')) : ''} <span class="dim">· ${esc(hhmm(f.at))}</span></span></div>`);
  if (st) L.push(`<div class="rc-line"><span><b>Room status</b> · ${esc(RS_LABEL[st.rs] || st.text || '—')}${st.fo ? ' · FO ' + esc(st.fo) : ''}${st.disc ? ' · ⚠ ' + esc(st.disc) : ''} <span class="dim">· ${esc(hhmm(st.at))}</span></span></div>`);
  const ih = safe(() => (W.hoInHouse && W.hoInHouse.find ? W.hoInHouse.find(room) : null), null);
  const d = typeof depRooms !== 'undefined' ? depRooms.find(x => roomKey(x.roomStr) === k) : null;
  const confs = new Set([f && f.conf, ih && ih.conf, d && d.conf].filter(Boolean).map(normConf));
  const names = [].concat(ih && ih.names ? ih.names : [], d ? [d.name] : []).filter(Boolean);
  TRC.list.filter(x => roomKey(x.room) === k || (x.conf && confs.has(normConf(x.conf)))).slice(-6).forEach(x =>
    L.push(`<div class="rc-line"><span>📌 ${x.dept ? `<b>${esc(x.dept)}</b> · ` : ''}${esc(x.text)}${x.date ? ` <span class="dim">· ${esc(x.date.slice(5))}${x.time ? ' ' + esc(x.time) : ''}</span>` : ''}${x.done ? ' <span class="dim">✓ done</span>' : ''}</span></div>`));
  [...new Set(names.map(nameKey))].forEach(nk => { const p = PRF.by[nk]; if (p) L.push(`<div class="rc-line"><span><b>Profile</b> · ${esc(firstLast(p.name))}${p.vip ? ' · ⭐ VIP ' + esc(p.vip) : ''}${p.memberLevel || p.member ? ' · ' + esc(p.memberLevel || p.member) : ''}${p.prefs ? ' · ' + esc(p.prefs) : ''}</span></div>`); });
  if (!L.length) return '';
  return `<section class="rc-sec" aria-label="Opera"><div class="rc-h">📡 Opera <em>read today</em></div><div class="rc-box">${L.join('')}</div></section>`;
}

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
        `<div class="op-item"><span>${hhmm(l.at)}</span><span>${esc(l.text)}</span>${l.detail && l.detail.length ? `<small>${esc(l.detail.slice(0, 6).join(' · '))}${l.detail.length > 6 ? ' …' : ''}</small>` : ''}</div>`).join('')}</div>` : ''}</div>`
    + learnCardHtml();
}
function learnCardHtml() {
  const on = learnOn(), M = learnModelNow();
  const lines = [];
  M.routines.forEach(r => lines.push(`<div class="op-item"><span>${r.n}×</span><span>${esc(routineTxt(r))}</span><small>${[r.hours && (r.hours === 'at different times' ? r.hours : 'mostly ' + r.hours), r.avgSec ? 'about ' + secTxt(r.avgSec) : ''].filter(Boolean).map(esc).join(' · ')}</small></div>`));
  if (M.beforeN) lines.push(`<div class="op-item"><span>Before a check-out</span><span>${esc(M.before.slice(0, 4).map(b => `${b.l} (${b.n} of ${M.beforeN})`).join(', ') || '—')}</span>${M.billBeforeCO ? '<small>So Departures shows “🧠 open its bill in Opera first” on a due room with a balance</small>' : ''}</div>`);
  if (M.dwell.length) lines.push(`<div class="op-item"><span>Time per screen</span><span>${esc(M.dwell.slice(0, 4).map(d => `${d.l} ~${secTxt(d.avgSec)}`).join(' · '))}</span>${M.busy ? `<small>Busiest in Opera: ${esc(M.busy)}</small>` : ''}</div>`);
  const seen = SHOW_SEEN ? seenToday() : [];
  return sw('learn', 'Learn from me in Opera', 'Notes which Opera screens you open and the buttons you press — never what you type and never guest data — to learn your routines. Only on this PC (and a short summary under your own user).', on)
    + `<div class="hs-row hs-col" data-s="opera reader learned from you routine habits watch me what it saw today clear"><span class="hs-txt"><b>🧠 Learned from you in Opera</b><small>${!on ? 'Off.' : M.events ? `From ${M.events} step${M.events === 1 ? '' : 's'} in ${M.tasks} task${M.tasks === 1 ? '' : 's'}${M.routines.length ? '' : ' — no routine seen 3 times yet'}` : 'Nothing yet: use Opera as usual, it learns quietly.'}${LRN_HINT ? ' · now: ' + esc(LRN_HINT) : ''}</small></span>
      ${lines.length ? `<div class="op-list">${lines.join('')}</div>` : ''}
      <span class="hs-inline" style="margin-top:8px"><button class="btn sm ghost" data-op="seen">${SHOW_SEEN ? 'Hide' : 'What it saw today'}</button><button class="btn sm ghost" data-op="forget">Clear what it learned</button></span>
      ${SHOW_SEEN ? `<div class="op-list">${seen.length ? seen.map(e => `<div class="op-item"><span>${hhmm(e.t)}</span><span>${e.k === 's' ? '📺 ' + esc(e.l) : e.k === 'r' ? '👆 a line of a list' : '👆 “' + esc(e.l) + '”'}</span></div>`).join('') : '<div class="op-item"><span>—</span><span>Nothing seen today</span></div>'}</div>` : ''}</div>`;
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
    else if (a === 'seen') { SHOW_SEEN = !SHOW_SEEN; paint(); } else if (a === 'forget') forgetLearn();
  });
  box.addEventListener('change', e => { const t = e.target.closest && e.target.closest('#hs-opera input[data-op]'); if (!t) return; if (t.dataset.op === 'learn') setLearn(t.checked); else setCfg(t.dataset.op, t.checked); });
  return true;
}
function css() {
  const s = doc.createElement('style'); s.id = 'opCss';
  s.textContent = `#hs-opera .op-list{display:grid;gap:6px;margin-top:10px}
#hs-opera .op-item{display:grid;grid-template-columns:minmax(0,150px) minmax(0,1fr);gap:4px 10px;font-size:12.5px;padding:6px 10px;border:1px solid var(--border,#333);border-radius:var(--r,6px)}
#hs-opera .op-item span:first-child{font-weight:600;color:var(--text,#eee)}#hs-opera .op-item span+span{color:var(--text2,#bbb)}
#hs-opera .op-item small{grid-column:1/-1;color:var(--text3,#999)}#hs-opera .op-ok{font-size:12.5px;color:var(--green,#16a34a);font-weight:600;align-self:center}
@media (max-width:560px){#hs-opera .op-item{grid-template-columns:1fr}}
.op-chips{display:contents}.dp-chip.op-bal{color:var(--red,#dc2626);border-color:color-mix(in srgb,var(--red,#dc2626) 45%,transparent)}
.dp-chip.op-hint{color:var(--text2,#bbb);font-weight:500}.dp-chip.op-rs-dirty,.dp-chip.op-rs-ooo,.dp-chip.op-rs-oos{color:var(--amber,#d97706)}.dp-chip.op-rs-inspected,.dp-chip.op-rs-clean{color:var(--green,#16a34a)}`;
  (doc.head || doc.documentElement).appendChild(s);
}
css();
if (!wire()) { const iv = setInterval(() => { if (wire()) clearInterval(iv); }, 2000); setTimeout(() => clearInterval(iv), 120000); }
new MutationObserver(() => paint()).observe(doc.documentElement, { attributes: true, attributeFilter: ['data-ho-op-helper', 'data-ho-wa-helper'] });
if (!wrapDepRender()) { const iv2 = setInterval(() => { if (wrapDepRender()) { clearInterval(iv2); paintDepChips(); } }, 2000); setTimeout(() => clearInterval(iv2), 120000); } else setTimeout(paintDepChips, 0);

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
      body: esc([r.arrival && 'arrives ' + r.arrival, r.departure && 'leaves ' + r.departure, r.nights && r.nights + ' nights', r.conf && 'conf. ' + r.conf, r.nat, r.email, r.agent || r.company || r.source, r.rateCode, r.vip && 'VIP ' + r.vip,
        (r.memberLevel || r.member) && 'member ' + (r.memberLevel || r.member), r.balance && 'balance ' + r.balance, r.rs && 'room ' + r.rs, r.prefs && 'prefers ' + r.prefs].filter(Boolean).join(' · '))
        + (r.extra && r.extra.length ? `<div class="dim">${esc(r.extra.slice(0, 16).map(p => p[0] + ': ' + p[1]).join(' · '))}</div>` : ''),
      text: ['room', r.room, r.room, r.name, r.conf, 'opera', st, r.extra ? r.extra.map(p => p.join(' ')).join(' ').slice(0, 600) : ''].filter(Boolean).join(' '), go: k.kind === 'arrivals' ? 'arrivals' : k.kind === 'inhouse' ? 'inhouse' : 'departures' });
  }));
  // folios: "folio 512", "bill 512", "balance 512", "who still owes", "is 512 settled"
  const fol = Object.values(FOL.date === today() ? FOL.rooms : {});
  const owing = fol.filter(f => f.balance > 0);
  if (fol.length) out.push({ id: 'op:folios', kind: '📡 Opera · Billing', title: owing.length ? `Opera folios open: ${owing.slice(0, 8).map(f => `${f.room || f.conf} AED ${money2(f.balance)}`).join(', ')}` : 'Opera folios read today: all settled',
    body: `<ul>${fol.slice(0, 40).map(f => `<li><b>${esc(f.room || f.conf)}</b> ${esc(f.name || '')} · ${f.zero ? 'settled (0.00)' : 'AED ' + esc(money2(f.balance))}${(f.pays || []).length ? ' · ' + esc(f.pays.join(', ')) : ''} <span class="dim">${esc(hhmm(f.at))}</span></li>`).join('')}</ul>`,
    text: 'opera folio folios bill bills billing balance balances open owing owes settled settle who still owes unpaid payment', go: 'departures' });
  fol.slice(0, 200).forEach(f => out.push({ id: 'op:fo:' + (f.room || f.conf), kind: `📡 Opera · Billing at ${hhmm(f.at)}`, title: `Room ${f.room || '?'} folio: ${f.zero ? 'settled (0.00)' : f.balance == null ? '—' : 'AED ' + money2(f.balance) + (f.balance > 0 ? ' open' : ' credit')}`,
    body: esc([f.name, (f.windows || []).length > 1 && f.windows.map(w => `window ${w.n}: ${w.balance == null ? '—' : money2(w.balance)}`).join(', '), (f.pays || []).length && 'paid by ' + f.pays.join(', '), f.n && f.n + ' postings'].filter(Boolean).join(' · ')),
    text: ['folio bill billing balance settled room', f.room, f.room, f.name, f.conf].filter(Boolean).join(' '), go: 'departures' }));
  const bl = LAST.billing && LAST.billing.folio;
  if (bl && bl.postings && bl.postings.length) out.push({ id: 'op:postings', kind: `📡 Opera · Billing at ${hhmm(LAST.billing.at)}`, title: `Last folio read: room ${bl.room || '?'} · ${bl.postings.length} posting${bl.postings.length === 1 ? '' : 's'}`,
    body: `<ul>${bl.postings.slice(0, 25).map(p => `<li>${esc(p.date || '')} ${esc(p.code)} ${esc(p.desc)} · ${esc(money2(p.amount))}${p.ref ? ' · ' + esc(p.ref) : ''}${p.window ? ' · W' + p.window : ''}</li>`).join('')}</ul>`,
    text: 'postings posted charges folio lines transactions last bill ' + (bl.room || '') + ' ' + bl.postings.map(p => p.desc + ' ' + p.code).join(' ').slice(0, 800), go: 'departures' });
  // room status: "dirty rooms", "room 512 status", "out of order"
  const rst = Object.values(RST.date === today() ? RST.rooms : {});
  if (rst.length) {
    const by = {}; rst.forEach(x => { if (x.rs) (by[x.rs] = by[x.rs] || []).push(x.room); });
    out.push({ id: 'op:rooms', kind: '📡 Opera · Room status', title: `Room status in Opera: ${Object.keys(by).map(k => `${by[k].length} ${(RS_LABEL[k] || k).replace(/^\S+\s/, '').toLowerCase()}`).join(', ') || rst.length + ' rooms'}`,
      body: `<ul>${Object.keys(by).map(k => `<li><b>${esc(RS_LABEL[k] || k)}</b>: ${esc(by[k].slice(0, 60).join(', '))}</li>`).join('')}</ul>`, text: 'room status rooms dirty clean inspected pickup out of order ooo oos housekeeping hk vacant discrepancies', go: 'departures' });
    rst.slice(0, 250).forEach(x => out.push({ id: 'op:rs:' + roomKey(x.room), kind: `📡 Opera · Room status at ${hhmm(x.at)}`, title: `Room ${x.room}: ${RS_LABEL[x.rs] || x.text || '—'}${x.disc ? ' · ⚠ ' + x.disc : ''}`, body: esc([x.text, x.fo && 'FO ' + x.fo, x.hk && 'HK ' + x.hk, x.disc].filter(Boolean).join(' · ')),
      text: ['room status housekeeping', x.room, x.room, x.rs, x.text].filter(Boolean).join(' ') }));
  }
  // traces / alerts
  const trc = TRC.date === today() ? TRC.list : [];
  if (trc.length) {
    const open = trc.filter(x => !x.done);
    out.push({ id: 'op:traces', kind: '📡 Opera · Traces / Alerts', title: `Opera traces: ${open.length} open of ${trc.length}`, body: `<ul>${trc.slice(-30).reverse().map(x => `<li>${x.room ? '<b>' + esc(x.room) + '</b> ' : ''}${x.dept ? esc(x.dept) + ': ' : ''}${esc(x.text)}${x.done ? ' ✓' : ''}</li>`).join('')}</ul>`,
      text: 'traces trace alerts alert messages open traces today opera reminders departments', go: 'inhouse' });
    trc.slice(-150).forEach((x, i) => out.push({ id: 'op:tr:' + i, kind: '📡 Opera · Trace', title: `${x.room ? 'Room ' + x.room + ' · ' : ''}${x.dept ? x.dept + ': ' : ''}${x.text}${x.done ? ' ✓' : ''}`, body: esc([x.name, x.date, x.time, x.conf && 'conf. ' + x.conf].filter(Boolean).join(' · ')),
      text: ['trace alert', x.room, x.room, x.name, x.dept, x.text, x.conf].filter(Boolean).join(' ') }));
  }
  // profiles
  Object.values(PRF.by || {}).slice(0, 150).forEach(p => out.push({ id: 'op:pf:' + nameKey(p.name), kind: '📡 Opera · Profile', title: `${firstLast(p.name)}${p.vip ? ' · VIP ' + p.vip : ''}${p.memberLevel || p.member ? ' · ' + (p.memberLevel || p.member) : ''}`,
    body: esc([p.nat, p.language, p.prefs && 'prefers ' + p.prefs, p.room && 'room ' + p.room].filter(Boolean).join(' · ')), text: ['profile vip member membership preferences', p.name, p.vip, p.memberLevel, p.member, p.prefs].filter(Boolean).join(' ') }));
  // other screens kept as tables (rates, night audit, anything with a grid)
  Object.values(LAST).forEach(k => (k.tables || []).forEach((tb, i) => out.push({ id: 'op:tb:' + k.kind + i, kind: `📡 Opera · ${KIND_LABEL[k.kind] || k.kind} at ${hhmm(k.at)}`, title: `${tb.title || KIND_LABEL[k.kind] || 'Opera table'} (${tb.rows.length} line${tb.rows.length === 1 ? '' : 's'})${k.audit && k.audit.state ? ' · night audit ' + k.audit.state : ''}`,
    body: `<div class="dim">${esc(tb.heads.join(' · '))}</div><ul>${tb.rows.slice(0, 20).map(r => `<li>${esc(r.filter(Boolean).join(' · '))}</li>`).join('')}</ul>${tb.rows.length > 20 ? `<div class="dim">… ${tb.rows.length - 20} more</div>` : ''}`,
    text: [k.kind, KIND_LABEL[k.kind], tb.title, tb.heads.join(' '), tb.rows.map(r => r.join(' ')).join(' ').slice(0, 3000), k.kind === 'audit' ? 'night audit end of day eod' : ''].join(' ') })));
  // learned from you
  if (learnOn()) {
    const M = learnModelNow();
    if (M.events) out.push({ id: 'op:learn', kind: '🧠 Learned from you in Opera', title: M.routines.length ? `Your Opera routine: ${routineTxt(M.routines[0])}` : 'Opera: still learning your routine',
      body: (M.routines.length ? `<ul>${M.routines.map(r => `<li>${esc(routineTxt(r))} · ${r.n}×${r.hours ? ' · ' + esc(r.hours) : ''}${r.avgSec ? ' · about ' + esc(secTxt(r.avgSec)) : ''}</li>`).join('')}</ul>` : '<div>Not one routine seen 3 times yet.</div>')
        + (M.beforeN ? `<div>Before a check-out you usually: ${esc(M.before.slice(0, 4).map(b => b.l).join(', '))}</div>` : '') + (M.busy ? `<div class="dim">Busiest in Opera: ${esc(M.busy)}</div>` : ''),
      text: 'my opera routine routines habit habits what do i usually do in opera learned from me watch me steps usual workflow', go: 'settings', boost: 1 });
    if (M.beforeN) out.push({ id: 'op:learn:co', kind: '🧠 Learned from you in Opera', title: `Before a check-out you usually: ${M.before.slice(0, 3).map(b => b.l).join(', ')}`,
      body: `<ul>${M.before.map(b => `<li>${esc(b.l)} — ${b.n} of ${M.beforeN} check-outs</li>`).join('')}</ul>${M.billBeforeCO ? '<div>So Departures reminds you: “🧠 open its bill in Opera first” on a due room with a balance.</div>' : ''}`,
      text: 'what do i usually do before a check out check-out checkout before checking out a guest opera routine habit', go: 'departures', boost: 1 });
  }
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
  /** Opera's folio for a room read today: {balance, zero, settled, windows, pays, at, src} or null */
  folio: room => { const f = folioFor(room); return f ? JSON.parse(JSON.stringify(f)) : null; },
  /** Opera's room status read today: {rs: clean|dirty|inspected|pickup|ooo|oos, text, fo, hk, disc, at} or null */
  roomStatus: room => { const v = statusFor(room); return v ? Object.assign({}, v) : null; },
  traces: room => (TRC.date === today() ? TRC.list : []).filter(x => !room || roomKey(x.room) === roomKey(room)).map(x => Object.assign({}, x)),
  profile: name => { const p = PRF.by[nameKey(name)]; return p ? Object.assign({}, p) : null; },
  /** what it learned from you: routines, what comes before a check-out, time per screen */
  learned: () => { const M = learnModelNow(); return Object.assign(learnSummary(M), { on: learnOn(), hint: LRN_HINT }); },
  seen: seenToday, setLearn, forgetLearn,
  cardHtml: roomCardHtml, chips: paintDepChips, alerts: balanceAlerts,
};
})();

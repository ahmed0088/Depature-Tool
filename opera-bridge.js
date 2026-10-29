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
//  🟢 Open Opera (the 📡 Opera page, Settings and a small strip on Departures /
//  Arrivals, desk PCs only): opens the hotel's Opera Cloud in one reused window
//  ("hotelops-opera"). The address is learned from the reader (its entry page)
//  or pasted once; operaUrl per hotel (owners / managers write it).
//  🛟 Screens it couldn't read: the reader's layout-only reports (and HotelOps'
//  own: "nothing readable", a plan error, departures that match no room two days
//  running), 20 kept here and under operaStuck/{hash}; "📋 Copy for Claude".
//  One quiet toast an hour at most (never on a day off). The Brain asks about
//  columns / screens it couldn't map (quiet Now items); the answers are taught
//  to the reader (operaTeach/, operaScreens/). It also suggests: a room checked
//  out in Opera still due here, open balances before check-out, Opera unread
//  for 2 h, an old reader.
//  The 📡 Opera page (menu → Front Desk): Open Opera, live read, changes with
//  Undo, bills, learned routines, 🛟 reports, settings.
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
  const P = { kind, date, read: (s.rows || []).length, dep: { create: null, out: [], ext: [], add: [], fill: [], rows: 0, matched: 0 }, arr: { add: [], fill: [] }, pur: { add: [], fill: [] }, ih: { mode: '', add: [], upd: [] }, notes: [], n: 0 };
  const cancelled = (s.rows || []).filter(r => BAD.has(r.status));
  if (cancelled.length) P.notes.push(`${cancelled.length} cancelled / no-show in Opera (left as they are here)`);
  const screenToday = !date || date === t;

  // ── Departures ──
  const board = inp.board || { rooms: [], day: '' }, B = board.rooms || [];
  const bday = board.day || '';
  const depRows = rows.filter(r => realRoom(r.room) && (r.departure === t || (kind === 'departures' && !r.departure && screenToday)) && r.status !== 'due_in');
  const findB = r => B.find(b => roomKey(b.roomStr != null ? b.roomStr : b.room) === roomKey(r.room));
  P.dep.rows = depRows.length;
  if ((!B.length || (bday && bday < t)) && (kind === 'departures' || kind === 'inhouse') && depRows.length) {
    P.dep.create = depRows.slice();
  } else if (B.length && (!bday || bday === t)) {
    depRows.forEach(r => {
      const b = findB(r);
      if (!b) { P.dep.add.push({ row: r, out: r.status === 'checked_out' }); return; }
      P.dep.matched++;
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

// ══ Screens the reader couldn't read ("stuck" reports) — pure ══
// The reader sends the LAYOUT of a screen it could not read (headers, how each was mapped, value shapes like "Aaaa 99", DOM hints),
// never a value. The three functions below are the reader's own, word for word (tests/run-tests.js checks they stay the same).
const sp = function (s) { return String(s == null ? '' : s).replace(/[   ]/g, ' ').replace(/[​-‏⁦-⁩﻿]/g, ''); };
var EMAIL_RX = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/;
function shapeOf(v) {
  var s = sp(v).replace(/\s+/g, ' ').trim(); if (!s) return '';
  s = s.replace(/\p{L}/gu, function (c) { return c.toLowerCase() !== c ? 'A' : 'a'; }).replace(/\p{N}/gu, '9').replace(/@/g, '＠').replace(/9{7,}/g, '999999+');
  return s.length > 24 ? s.slice(0, 23) + '…' : s;
}function reportLeaks(text) {
  var t = String(text || '');
  if (EMAIL_RX.test(t)) return 'an email';
  if (/\d{7,}/.test(t)) return 'a long number';
  var m = t.match(/(?<!\p{L})\p{Lu}\p{Ll}+,[ \t]*\p{Lu}\p{Ll}+/gu) || [];
  for (var i = 0; i < m.length; i++) if (m[i].replace(/[Aa,\s]/g, '')) return 'a name';
  return '';
}function reportText(R, x) {
  x = x || {};
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var two = function (n) { return (n < 10 ? '0' : '') + n; }, d = new Date(R.at || 0);
  var L = ['HotelOps Opera reader report — please teach the reader this screen:'];
  L.push('reader v' + (R.v || '?') + ' · ' + d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) + (x.n > 1 ? ' · seen ' + x.n + ' times' : ''));
  L.push('screen: kind guess "' + (R.kind || 'unknown') + '"' + (R.hint ? ' (its words say "' + R.hint + '")' : ' (its words name no screen it knows)') + ' · title "' + (R.title || '') + '" · path ' + (R.path || '—') + ' · screen date ' + R.date);
  if ((R.heads || []).length) L.push('headings: ' + R.heads.join(' | '));
  L.push('why:');
  (R.why || []).forEach(function (w) { L.push('- ' + w.c + ': ' + w.t); });
  if (R.concl) L.push('reader concluded: ' + R.concl);
  if (R.err) L.push('error: ' + R.err);
  if (x.app) L.push('HotelOps answered: ' + x.app);
  (R.grids || []).forEach(function (g, i) {
    L.push('grid ' + (i + 1) + (g.stuck ? ' (NOT READ)' : '') + ' — ' + g.sel + ' · ' + g.n + ' rows · header cells: ' + (g.cells || 'none'));
    L.push('  headers → fields: ' + (g.head.length ? g.head.map(function (h) { return '"' + h[0] + '" → ' + h[1]; }).join(' | ') : 'no header line'));
    if (g.aria.length) L.push('  header aria-labels: ' + g.aria.join(' | '));
    if (g.anc.length) L.push('  dom (grid, then up): ' + g.anc.map(function (a) { return a.t + (a.r ? '[role=' + a.r + ']' : '') + a.c.map(function (c) { return '.' + c; }).join(''); }).join(' < '));
    g.shapes.forEach(function (r, j) { L.push('  row ' + (j + 1) + ' shape: ' + r.join(' | ')); });
  });
  if ((R.pairs || []).length) L.push('label → value shape: ' + R.pairs.map(function (p) { return p[0] + ' = ' + p[1]; }).join(' | '));
  L.push('--- fake page (letters → a/A, digits → 9) ---');
  if ((R.heads || [])[0]) L.push('<h1>' + esc(R.heads[0]) + '</h1>');
  (R.grids || []).forEach(function (g) {
    var a1 = g.anc[1], open = a1 && a1.c.length ? '<div class="' + esc(a1.c.join(' ')) + '">' : '<div>';
    if (/^table/.test(g.sel)) L.push(open + '<table>' + (g.head.length ? '<tr>' + g.head.map(function (h) { return '<th>' + esc(h[0]) + '</th>'; }).join('') + '</tr>' : '') + g.shapes.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></div>');
    else L.push(open + '<div role="grid">' + (g.head.length ? '<div role="row">' + g.head.map(function (h, k) { return '<div role="columnheader" aria-colindex="' + (k + 1) + '">' + esc(h[0]) + '</div>'; }).join('') + '</div>' : '') + g.shapes.map(function (r) { return '<div role="row">' + r.map(function (c, k) { return '<div role="gridcell" aria-colindex="' + (k + 1) + '">' + esc(c) + '</div>'; }).join('') + '</div>'; }).join('') + '</div></div>');
  });
  (R.pairs || []).forEach(function (p, i) { L.push('<label for="f' + i + '">' + esc(p[0]) + '</label><input id="f' + i + '" readonly value="' + esc(p[1]) + '">'); });
  L.push('--- end ---');
  return L.join('\n');
}const stuckText = reportText, stuckLeaks = reportLeaks;
/** a report from the reader (or the database), made safe: known fields only, short strings, values re-shaped (a shape stays a shape) */
function stuckClean(r) {
  if (!r || typeof r !== 'object' || !Array.isArray(r.why)) return null;
  const arr = (a, n) => (Array.isArray(a) ? a.slice(0, n) : (a && typeof a === 'object' ? Object.values(a).slice(0, n) : []));
  const o = { v: cut(r.v, 12), at: +r.at > 1e12 && +r.at < 4e12 ? Math.round(+r.at) : Date.now(), kind: cut(r.kind, 20).replace(/[^a-z]/g, ''), hint: cut(r.hint, 20).replace(/[^a-z]/g, ''), date: r.date === 'found' ? 'found' : 'none',
    title: cut(r.title, 80), path: cut(r.path, 120), heads: arr(r.heads, 6).map(x => cut(x, 60)).filter(Boolean),
    why: arr(r.why, 6).map(w => (w && typeof w === 'object' ? { c: cut(w.c, 20).replace(/[^a-z\-]/g, ''), t: cut(w.t, 200) } : null)).filter(w => w && w.c),
    grids: arr(r.grids, 4).map(g => (g && typeof g === 'object' ? { sel: cut(g.sel, 60), cells: cut(g.cells, 60), n: Math.max(0, Math.round(+g.n || 0)), stuck: !!g.stuck,
      head: arr(g.head, 30).map(h => (Array.isArray(h) ? [cut(h[0], 40), cut(h[1], 24)] : null)).filter(Boolean),
      aria: arr(g.aria, 30).map(x => cut(x, 40)).filter(Boolean),
      anc: arr(g.anc, 4).map(a => (a && typeof a === 'object' ? { t: (cut(a.t, 20).toLowerCase().match(/^[a-z][a-z0-9\-]*/) || [''])[0], r: cut(a.r, 20).replace(/[^a-z\-]/g, ''), c: arr(a.c, 5).map(x => cut(x, 40).replace(/[^A-Za-z_\-]/g, '')).filter(Boolean) } : null)).filter(Boolean),
      shapes: arr(g.shapes, 3).map(row => arr(row, 16).map(x => shapeOf(x))) } : null)).filter(Boolean),
    pairs: arr(r.pairs, 30).map(p => (Array.isArray(p) ? [cut(p[0], 40), shapeOf(p[1])] : null)).filter(p => p && p[0]),
    concl: cut(r.concl, 240), err: cut(r.err, 160) };
  return o.why.length ? o : null;
}
// ══ The Opera Cloud address ("🟢 Open Opera") — pure ══
const OP_HOST = /(^|\.)(oraclecloud|oracleindustry|oraclehospitality)\.com$/i;
/** an Opera Cloud address as pasted → the same address, checked: https, an Oracle host (…oraclecloud.com, …oracleindustry.com,
 *  …oraclehospitality.com), no login in it; only the query and the hash are dropped (the path is kept: it is Opera's entry page). '' when it isn't one. */
function operaHome(u) {
  let s = String(u == null ? '' : u).trim(); if (!s || s.length > 600) return '';
  if (!/^[a-z][a-z0-9+.\-]*:/i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  let x; try { x = new URL(s); } catch (_) { return ''; }
  if (x.protocol !== 'https:' || !OP_HOST.test(x.hostname) || x.username || x.password || x.port) return '';
  return x.origin + x.pathname;
}
/** the address the reader was on (any screen) → Opera's entry page: "…/<TENANT>/operacloud/faces/opera-cloud-index/OperaCloud"
 *  when it is an Opera Cloud screen; else the address as it is (query and hash dropped) */
function operaEntry(u) {
  const h = operaHome(u); if (!h) return '';
  const x = new URL(h), m = x.pathname.match(/^(.*?\/operacloud)(?:\/|$)/i);
  return m ? x.origin + m[1] + '/faces/opera-cloud-index/OperaCloud' : h;
}
/** the "Open Opera" card: helper missing / user scripts off / on, linked or not → {btn, state, b, s} */
function openState(o) {
  const btn = o.linked ? '✓ Linked · open Opera' : '🟢 Open Opera';
  if (!o.helper) return { btn, state: 'nohelper', b: 'Link with one click', s: 'Get the helper' };
  if (!o.us) return { btn, state: 'noscripts', b: '⚡ Reader on · reads by itself', s: 'Automatic updates: in chrome://extensions click Details on the HotelOps helper and turn on Allow User Scripts, then reload this page.' };
  return { btn, state: 'on', b: '⚡ Reader on · reads by itself · updates by itself', s: o.linked ? 'Linked to Opera now' : 'Links by itself when Opera opens' };
}

// ── the Brain's questions and suggestions about Opera (pure) ──
const teachKey = h => String(h || '').toUpperCase().replace(/#/g, ' NO ').replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ').trim().slice(0, 48);
const screenKey = t => String(t || '').replace(/\d+/g, '#').toLowerCase().replace(/[^a-z0-9#()]+/g, ' ').trim().slice(0, 60);
const TEACH_FIELDS = { room: 'Room', name: 'Guest name', last: 'Last name', first: 'First name', conf: 'Conf. number', arrival: 'Arrival date', departure: 'Departure date', status: 'Status', balance: 'Balance', nights: 'Nights', nat: 'Nationality', email: 'Email', company: 'Company', agent: 'Travel agent', rateCode: 'Rate code', vip: 'VIP', roomType: 'Room type', roomStatus: 'Room status', '-': 'Something else' };
const TEACH_KINDS = [['arrivals', 'Arrivals'], ['departures', 'Departures'], ['inhouse', 'In House'], ['billing', 'Billing'], ['rooms', 'Room status'], ['profile', 'Profile'], ['other', 'Other']];
/** the choices for a column, from the shape of its values: a date → departure / arrival, a short number → room, a long one → conf., "Aaaa, Aaaa" → a name */
function teachChoices(shape) {
  const s = String(shape || '');
  let f;
  if (/^9{1,2}[\/.\- ](?:9{1,2}|Aaa|AAA)[\/.\- ]9{2,4}$|^9{4}-99-99$|^Aaa 9{1,2},? 9{4}$/.test(s)) f = ['departure', 'arrival'];
  else if (/^A?9{1,5}A?$/.test(s)) f = ['room', 'conf', 'nights'];
  else if (/^9{6}|^999999\+$/.test(s)) f = ['conf'];
  else if (/^A[a]+,\s*A[a]+/.test(s) || /^A[a]+ A[a]+$/.test(s)) f = ['name', 'company'];
  else if (/^-?9[9,]*\.99$/.test(s)) f = ['balance'];
  else f = ['status', 'name', 'room'];
  return f.map(k => [TEACH_FIELDS[k], k]).concat([['Something else', '-'], ['Ignore', 'x']]);
}
/** what the Brain could ask or suggest about Opera now (pure). I: {stuck, asked, taught, dayOff, cfg, board: {rooms, day}, last (LAST), folios, now, today, coMin, readerV, appV, linkAt}
 *  → [{id, type, icon, tone, text, why, opts: [[label, action]]}] (action: 'teach:<field>' / 'screen:<kind>' / 'ask:x' / 'markout' / 'deps' / 'open' / 'page') */
function operaThoughts(I) {
  const T = []; if (I.dayOff) return T;   // a day off: it asks nothing
  const asked = I.asked || {}, taught = I.taught || { h: {}, s: {} };
  // 1) columns it couldn't map, and screens it didn't know (newest report first; two questions at a time)
  let q = 0;
  (I.stuck || []).forEach(e => {
    const r = e.rep || {}; if (q >= 2) return;
    const where = (r.heads && r.heads[0]) || r.title || 'an Opera';
    (r.grids || []).filter(g => g.stuck).forEach(g => g.head.forEach((h, i) => {
      const k = teachKey(h[0]); if (q >= 2 || !k || h[1] !== '?' || asked['col:' + k] || taught.h[k] != null) return;
      if (T.some(t => t.id === 'opq:col:' + k)) return;
      q++;
      T.push({ id: 'opq:col:' + k, type: 'opQ', icon: '🧠', tone: 'warn', text: `In Opera's "${where}" list there's a column "${h[0]}" — is it:`, why: `So the reader reads it next time. Its values look like "${(g.shapes[0] || [])[i] || '…'}" (the shape only).`,
        opts: teachChoices((g.shapes[0] || [])[i]).map(([l, f]) => [l, f === 'x' ? 'ask:x' : 'teach:' + f]) });
    }));
    if (q < 2 && (r.why || []).some(w => w.c === 'unknown-screen')) {
      const name = (r.heads && r.heads[0]) || r.title, k = screenKey(name);
      if (k && !asked['scr:' + k] && !taught.s[k] && !T.some(t => t.id === 'opq:scr:' + k)) { q++; T.push({ id: 'opq:scr:' + k, type: 'opQ', icon: '🧠', tone: 'warn', text: `What is this Opera screen: "${name}"?`, why: 'So the reader knows what it is reading there.', opts: TEACH_KINDS.map(([v, l]) => [l, 'screen:' + v]) }); }
    }
  });
  // 2) suggestions from what Opera shows
  const day = I.today, B = (I.board && I.board.rooms) || [], deps = I.last && I.last.departures;
  if ((!I.cfg.auto || I.cfg.review) && deps && B.length && (!I.board.day || I.board.day === day)) {
    const outs = (deps.rows || []).filter(r => r.status === 'checked_out' && B.some(b => roomKey(b.roomStr) === roomKey(r.room) && ['due', 'late', 'na', 'dnd'].includes(b.status) && sameGuest(b.name, r.name)));
    if (outs.length) T.push({ id: 'ops:co:' + day + ':' + outs.map(r => roomKey(r.room)).join(','), type: 'opCo', icon: '🚪', tone: 'warn',
      text: outs.length === 1 ? `Room ${outs[0].room} is checked out in Opera but still "due" here — mark it out?` : `${outs.length} rooms are checked out in Opera but still "due" here (${outs.slice(0, 5).map(r => r.room).join(', ')}) — mark them out?`,
      why: '"Adjust by itself" is off or held for review, so nothing was changed.', opts: [[outs.length === 1 ? 'Mark out' : 'Mark them out', 'markout'], ['Show Departures', 'deps']] });
  }
  if (I.coMin != null) {
    const m = new Date(I.now).getHours() * 60 + new Date(I.now).getMinutes();
    const open = (I.folios || []).filter(f => f.balance > 0 && B.some(b => roomKey(b.roomStr) === roomKey(f.room) && ['due', 'late', 'na', 'dnd'].includes(b.status)));
    if (open.length && m >= I.coMin - 30 && m < I.coMin) T.push({ id: 'ops:bal:' + day, type: 'opBal', icon: '💳', tone: 'warn', text: `${open.length} room${open.length === 1 ? ' has an open balance' : 's have open balances'} 30 min before check-out (${open.slice(0, 5).map(f => f.room).join(', ')})`,
      why: 'Opera\'s folios as read today.', opts: [['Show Departures', 'deps']] });
  }
  const reads = Object.values(I.last || {}), newest = reads.reduce((a, k) => Math.max(a, k.at || 0), 0);
  const hr = new Date(I.now).getHours();
  if (newest && I.now - newest > 2 * 3600e3 && hr >= 7 && hr < 23 && new Date(newest).toDateString() === new Date(I.now).toDateString()) T.push({ id: 'ops:stale:' + day + ':' + Math.floor(I.now / (2 * 3600e3)), type: 'opStale', icon: '📡', tone: 'idle',
    text: `Opera hasn't been read for ${Math.floor((I.now - newest) / 3600e3)} h — open Opera?`, why: 'The lists follow Opera only while it is open with the reader.', opts: [['Open Opera', 'open']] });
  const rv = parseFloat(String(I.readerV || '').replace(/[^\d.]/g, '')), av = parseFloat(String(I.appV || '').replace(/[^\d.]/g, ''));
  if (rv >= 100 && av >= 100 && rv < av && I.linkAt && I.now - I.linkAt < 120000) T.push({ id: 'ops:old:' + rv + ':' + av, type: 'opOld', icon: '✨', tone: 'warn', text: `The Opera reader is v${rv}, HotelOps is v${av}: reload the Opera tab (and HotelOps if it was just updated)`,
    why: 'The helper hands Opera the new reader; it starts the next time Opera loads.', opts: [['Open the Opera page', 'page']] });
  return T;
}
W.hoOperaPure = { teachKey, teachChoices, operaThoughts, operaEntry, shapeOf, reportText, reportLeaks, stuckText, stuckLeaks, stuckClean, operaHome, openState, maskCards, secretLabel, cleanFolio, cleanLabel, learnClean, learnModel, learnRecent, learnNext, learnSummary, sessionsOf, toIso, operaDay, roomKey, nameKey, sameGuest, isOtaEmail, goodEmail, natName, firstLast, sanitize, plan, summaryText, worthAlert, depReport, hashOf, isPm };
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

// ══ 🛟 Screens the reader couldn't read: kept here (20, newest first) and under operaStuck/{hash} for the managers' PCs ══
const LS_STUCK = 'ho_op_stuck_v1', LS_STUCK_X = 'ho_op_stuck_x_v1', LS_STUCK_T = 'ho_op_stuck_toast', LS_UNPL = 'ho_op_unplaced_v1';
const stuckLoad = () => { const v = LS.get(LS_STUCK, []); return Array.isArray(v) ? v.filter(e => e && e.h && e.rep) : []; };
let STUCK = stuckLoad();
const stuckSave = () => { STUCK = STUCK.sort((a, b) => b.last - a.last).slice(0, 20); LS.set(LS_STUCK, STUCK); };
const fbOk = () => typeof fbSet === 'function';
/** ONE quiet toast for a new screen it couldn't read: at most once an hour, never on a day off or with the Brain's hints off, never on the phone */
function stuckToast() {
  if (W.hoNotify && W.hoNotify.dayOffOn) return;
  if (safe(() => (typeof blMode === 'function' ? blMode() : ''), '') === 'off') return;
  const last = +LS.get(LS_STUCK_T, 0) || 0; if (Date.now() - last < 3600e3) return;
  LS.set(LS_STUCK_T, Date.now());
  toast('📡 Opera: one screen I couldn\'t read — Settings → Opera reader → Copy for Claude', 'info');
}
/** a report (from the reader, or made here) → kept; the same screen again counts up. false when refused (it still looks like guest data). */
function stuckAdd(raw, h, src) {
  const rep = stuckClean(raw); if (!rep) return false;
  h = String(h || '').replace(/[^a-z0-9]/gi, '').slice(0, 24) || hashOf([rep.kind, rep.title, rep.path, rep.why.map(w => w.c), rep.grids.map(g => g.head.map(x => x[0]))]);
  const L = LAST[rep.kind], app = src === 'reader' && L && Date.now() - L.at < 10 * 60e3 && L.res ? String(L.res).slice(0, 140) : '';
  if (stuckLeaks(stuckText(rep, { app }))) return false;
  STUCK = stuckLoad();
  const i = STUCK.findIndex(x => x.h === h), now = Date.now(), isNew = i < 0;
  const e = isNew ? { h, first: now, n: 0 } : STUCK.splice(i, 1)[0];
  Object.assign(e, { last: now, n: (e.n || 0) + 1, src: src === 'app' ? 'app' : 'reader', rep, app: app || e.app || '' });
  STUCK.unshift(e); stuckSave();
  const X = LS.get(LS_STUCK_X, {}) || {}; if (X[h]) { delete X[h]; LS.set(LS_STUCK_X, X); }
  if (canWrite() && fbOk()) safe(() => fbSet('operaStuck/' + h, { h, first: e.first, last: e.last, n: e.n, src: e.src, rep, app: e.app }));
  if (isNew) stuckToast();
  paint();
  return true;
}
/** HotelOps' own side: a snapshot it couldn't use, or departures that match nothing on the board → a report (structure only: kind, field names, counts) */
function stuckApp(s, code, text) {
  const rows = s && Array.isArray(s.rows) ? s.rows : [];
  const fields = [...new Set(rows.slice(0, 50).flatMap(r => (r && typeof r === 'object' ? Object.keys(r) : [])))].filter(k => /^[a-zA-Z]{1,20}$/.test(k)).slice(0, 30);
  const title = cleanLabel(String((s && s.title) || '').split(/\s[-–—|:]\s|[,(|:]/)[0]);
  const kind = s && KINDS.includes(s.kind) ? s.kind : '';
  return stuckAdd({ v: LINK ? LINK.v : '', at: Date.now(), kind, hint: '', date: s && isIso(s.date) ? 'found' : 'none', title, path: '', heads: [], why: [{ c: code, t: text }], grids: [], pairs: [],
    concl: `${rows.length} row${rows.length === 1 ? '' : 's'} came · fields: ${fields.join(' · ') || 'none'}`, err: '' }, hashOf(['app', kind, code, title]), 'app');
}
/** departures from Opera that match no room on today's board, two days (or more) → a report: the room column is probably read wrong */
function unplacedCheck(snap, P) {
  if (snap.kind !== 'departures' || P.dep.create || !(boardNow().rooms || []).length) return;
  if (P.dep.matched) { LS.set(LS_UNPL, { days: [] }); return; }
  if (P.dep.rows < 3) return;
  const S = LS.get(LS_UNPL, null) || { days: [] }, t = today();
  if (!Array.isArray(S.days)) S.days = [];
  if (!S.days.includes(t)) { S.days = S.days.concat(t).slice(-5); LS.set(LS_UNPL, S); }
  if (S.days.length >= 2) stuckApp(snap, 'not-placed', `${P.dep.rows} departures from Opera matched no room on the Departures board (${S.days.length} days running)`);
}
function stuckDismiss(h) {
  STUCK = stuckLoad().filter(e => e.h !== h); stuckSave();
  const X = LS.get(LS_STUCK_X, {}) || {}; X[h] = Date.now(); const ks = Object.keys(X); if (ks.length > 100) ks.sort((a, b) => X[a] - X[b]).slice(0, ks.length - 100).forEach(k => delete X[k]); LS.set(LS_STUCK_X, X);
  if (canWrite() && fbOk()) safe(() => fbSet('operaStuck/' + h, null));
  paint();
}
function stuckClear() {
  if (typeof confirm === 'function' && STUCK.length > 1 && !confirm('Clear all the screens the Opera reader couldn\'t read?')) return;
  stuckLoad().forEach(e => stuckDismiss(e.h));
}
/** the plain text for Claude ('' when it would carry guest data) */
function stuckCopyText(h) {
  const e = stuckLoad().find(x => x.h === h); if (!e) return '';
  const rep = stuckClean(e.rep); if (!rep) return '';
  const t = stuckText(rep, { n: e.n, app: e.app });
  return stuckLeaks(t) ? '' : t;
}
async function stuckCopy(h) {
  const t = stuckCopyText(h);
  if (!t) { toast('This report looks like it holds guest data: not copied', 'err'); return; }
  try { await navigator.clipboard.writeText(t); toast('Copied — paste it to Claude so the reader learns this screen', 'ok'); }
  catch (_) { if (typeof fbCopy === 'function') fbCopy(t, ok => toast(ok ? 'Copied — paste it to Claude' : 'Could not copy', ok ? 'ok' : 'err')); else toast('Could not copy', 'err'); }
}
/** another PC's reports (the database) merged in: newer counts win; one dismissed here stays away until it is seen again */
function stuckMerge(v) {
  if (!v || typeof v !== 'object') return;
  const X = LS.get(LS_STUCK_X, {}) || {};
  let L = stuckLoad(), ch = false;
  Object.values(v).forEach(r => {
    if (!r || typeof r !== 'object') return;
    const h = String(r.h || '').replace(/[^a-z0-9]/gi, '').slice(0, 24), last = +r.last || 0, rep = stuckClean(r.rep);
    if (!h || !rep || (X[h] && X[h] >= last) || stuckLeaks(stuckText(rep, { app: cut(r.app, 140) }))) return;
    const e = L.find(x => x.h === h);
    if (e) { if (last > e.last || (+r.n || 0) > e.n) { e.last = Math.max(e.last, last); e.n = Math.max(e.n, +r.n || 0); ch = true; } return; }
    L.push({ h, first: +r.first || last, last, n: +r.n || 1, src: r.src === 'app' ? 'app' : 'reader', rep, app: cut(r.app, 140) }); ch = true;
  });
  if (ch) { STUCK = L; stuckSave(); paint(); }
}

// ══ 🟢 Open Opera: the Opera Cloud address, remembered from the reader (or pasted once); operaUrl in the database, set by owners / managers ══
const LS_URL = 'ho_op_url_v1';
let OPURL = (() => { const v = LS.get(LS_URL, null); return v && operaHome(v.url) ? v : null; })();
const operaUrl = () => (OPURL ? OPURL.url : '');
const canAdmin = () => signedIn() && ['owner', 'manager'].includes(currentProfile.role);
function setOperaUrl(u, src, fromDb) {
  u = operaHome(u); if (!u) return false;
  if (OPURL && OPURL.url === u) return true;
  OPURL = { url: u, at: Date.now(), src: src || '' }; LS.set(LS_URL, OPURL);
  if (!fromDb && canAdmin() && fbOk()) safe(() => fbSet('operaUrl', { url: u, at: OPURL.at, src: OPURL.src }));
  paint();
  return true;
}
/** the first time Opera links, its address is remembered (the reader's ping carries it; a snapshot's url too) */
function rememberHome(u) { if (!u || operaUrl()) return; const e = operaEntry(u); if (e) setOperaUrl(e, 'reader'); }
function askOperaUrl() {
  const v = typeof prompt === 'function' ? prompt('Paste your Opera Cloud address (copy it from the address bar while Opera Cloud is open):', operaUrl() || 'https://') : null;
  if (v == null || !String(v).trim() || String(v).trim() === 'https://') return '';
  if (!setOperaUrl(v, 'typed')) { toast('That isn\'t an Opera Cloud address: it starts with https:// and ends in oraclecloud.com, oracleindustry.com or oraclehospitality.com', 'err'); return ''; }
  toast('Opera Cloud address saved' + (canAdmin() ? ' for the hotel' : ' on this PC'), 'ok');
  return operaUrl();
}
function openOpera() {
  const url = operaUrl() || askOperaUrl(); if (!url) return;
  const w = W.open(url, 'hotelops-opera');
  if (!w) toast('Allow pop-ups for HotelOps, or open Opera Cloud yourself', 'warn');
  else if (!doc.documentElement.dataset.hoOpHelper) toast('Opera opened — add the HotelOps helper (Settings → Opera reader) so it links by itself', 'info');
}
const opLinked45 = () => !!LINK && Date.now() - LINK.at < 45000;
const openNow = () => { const D = doc.documentElement.dataset; return openState({ helper: !!D.hoOpHelper, us: D.hoWaUs === '1', linked: opLinked45() }); };
// the database: the hotel's Opera address and the screens it couldn't read (a manager on another PC sees them too); started once someone is signed in
let DB_ON = false;
function dbStart() {
  if (DB_ON || typeof fbListen !== 'function' || !signedIn() || typeof _ref === 'undefined' || !_ref) return;
  DB_ON = true;
  safe(() => fbListen('operaUrl', v => { if (v && v.url) setOperaUrl(v.url, v.src || 'hotel', true); }));
  safe(() => fbListen('operaStuck', v => safe(() => stuckMerge(v))));
  const taughtFrom = kind => v => safe(() => { const box = {}; Object.values(v || {}).forEach(x => { if (x && x.k && x.v) box[String(x.k).slice(0, 60)] = String(x.v).slice(0, 20); }); if (kind === 's') TEACH.s = Object.assign({}, box); else TEACH.h = Object.assign({}, box); LS.set(LS_TEACH, TEACH); });
  safe(() => fbListen('operaTeach', taughtFrom('h')));
  safe(() => fbListen('operaScreens', taughtFrom('s')));
}

// ══ 🧠 The Brain asks what the reader couldn't understand, and suggests fixes (quiet items in its Now list) ══
// Answers teach the reader: header words → field (operaTeach/{header}), screen title → kind (operaScreens/{title}); per hotel, and on this PC.
const LS_TEACH = 'ho_op_teach_v1', LS_ASKED = 'ho_op_asked_v1';
let TEACH = (() => { const v = LS.get(LS_TEACH, null); return v && typeof v === 'object' ? { h: v.h || {}, s: v.s || {} } : { h: {}, s: {} }; })();
const teachNow = () => ({ h: Object.assign({}, TEACH.h), s: Object.assign({}, TEACH.s) });
function teachSet(kind, key, val, fromDb) {
  if (!key) return;
  const box = kind === 's' ? TEACH.s : TEACH.h;
  if (val == null || val === '') delete box[key]; else box[key] = val;
  LS.set(LS_TEACH, TEACH);
  if (!fromDb && canWrite() && fbOk()) safe(() => fbSet((kind === 's' ? 'operaScreens/' : 'operaTeach/') + key.replace(/[.#$\[\]\/]/g, '_').replace(/ /g, '_'), val == null ? null : { k: key, v: val, at: Date.now() }));
  // the reader gets it with its next answer (the ping's), and reads the screen again with it
  safe(() => W.postMessage({ source: 'ho-op-ack', teach: teachNow() }, location.origin));
}
/** a Brain answer → taught (or just "asked", so it isn't asked again) */
function opAnswer(id, act) {
  const A = LS.get(LS_ASKED, {}) || {}, key = id.replace(/^opq:/, '');
  A[key] = { a: act, at: Date.now() }; LS.set(LS_ASKED, A);
  const k = key.replace(/^(?:col|scr):/, '');
  if (act.indexOf('teach:') === 0) teachSet('h', k, act.slice(6));
  else if (act.indexOf('screen:') === 0) teachSet('s', k, act.slice(7));
  toast(act === 'ask:x' ? 'OK — I won\'t ask about it again' : '🧠 Thanks — the reader reads it that way from now on', 'ok');
  paint();
}
function opAct(act, t) {
  if (act === 'markout') {
    const deps = LAST.departures; if (!deps || typeof depRooms === 'undefined') return;
    let n = 0;
    (deps.rows || []).filter(r => r.status === 'checked_out').forEach(r => { const i = depRooms.findIndex(b => roomKey(b.roomStr) === roomKey(r.room) && ['due', 'late', 'na', 'dnd'].includes(b.status) && sameGuest(b.name, r.name)); if (i >= 0) { depRooms[i].note = (depRooms[i].note ? depRooms[i].note + '\n' : '') + `[${hhmm(Date.now())}] Checked out in Opera`; safe(() => depAction(i, 'out')); n++; } });
    if (n) { paintDeps(); safe(() => saveDeps()); addLog({ kind: 'departures', text: `${pl(n, 'room')} checked out (asked by the Brain)` }); }
  } else if (act === 'deps') { if (typeof showPanel === 'function') showPanel('departures'); }
  else if (act === 'open') openOpera();
  else if (act === 'page') openPage();
}
(W.BL_THINKERS = W.BL_THINKERS || []).push(add => {
  const T = operaThoughts({ stuck: stuckLoad(), asked: Object.fromEntries(Object.keys(LS.get(LS_ASKED, {}) || {}).map(k => [k, 1])), taught: TEACH, dayOff: !!(W.hoNotify && W.hoNotify.dayOffOn), cfg: CFG,
    board: boardNow(), last: LAST, folios: Object.values(FOL.date === today() ? FOL.rooms : {}), now: Date.now(), today: today(), coMin: safe(() => (typeof _depCoMin === 'function' ? _depCoMin() : null), null),
    readerV: LINK ? LINK.v : '', appV: typeof APP_VERSION !== 'undefined' ? APP_VERSION : '', linkAt: LINK ? LINK.at : 0 });
  T.forEach(t => add({ id: t.id, type: t.type, icon: t.icon, tone: t.tone, text: t.text, why: t.why, silent: true,   // quiet: it waits in the Brain's Now list (the 🧠 number), never a pop-up
    acts: t.opts.map(([l, a]) => [l, () => (t.type === 'opQ' ? opAnswer(t.id, a) : opAct(a, t))]) }));
});

// ══ The Opera address of each hotel you can see (the 📡 Opera page): owners edit any of theirs, managers their own ══
let HOTELS = null, HOTELS_AT = 0;
const myRole = () => (signedIn() ? currentProfile.role : '');
async function loadHotels(force) {
  if (!force && HOTELS && Date.now() - HOTELS_AT < 60000) return HOTELS;
  HOTELS_AT = Date.now();
  const hid = typeof HOTEL_ID !== 'undefined' ? HOTEL_ID : 'this';
  const cur = { id: hid, name: ((doc.getElementById('hotelName') || {}).textContent || hid).trim(), url: operaUrl(), cur: true, edit: canAdmin() };
  const out = [cur];
  if (myRole() === 'owner' && typeof firebase !== 'undefined' && firebase.database) {
    try {
      const all = (await firebase.database().ref('hotelsIndex').once('value')).val() || {};
      for (const [id, h] of Object.entries(all).slice(0, 12)) {
        if (id === hid) continue;
        try {   // only a hotel this person can read is listed (the database says who); an owner there can write it too
          const v = (await Promise.race([firebase.database().ref(`hotels/${id}/operaUrl`).once('value'), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 5000))])).val();
          out.push({ id, name: (h && h.name) || id, url: v && operaHome(v.url) ? operaHome(v.url) : '', edit: true });
        } catch (_) {}
      }
    } catch (_) {}
  }
  HOTELS = out; paint();
  return out;
}
async function editHotelUrl(id) {
  const H = (HOTELS || []).find(h => h.id === id); if (!H || !H.edit) { toast('Only an owner (or this hotel\'s manager) can change it', 'err'); return; }
  const v = typeof prompt === 'function' ? prompt(`Opera Cloud address for ${H.name} (copy it from the address bar while Opera Cloud is open):`, H.url || 'https://') : null;
  if (v == null || !String(v).trim() || String(v).trim() === 'https://') return;
  const u = operaHome(v);
  if (!u) { toast('That isn\'t an Opera Cloud address: it starts with https:// and is on oraclecloud.com, oracleindustry.com or oraclehospitality.com', 'err'); return; }
  if (H.cur) { OPURL = null; setOperaUrl(u, 'typed'); H.url = u; toast(`Opera address saved for ${H.name}`, 'ok'); paint(); return; }
  try { await firebase.database().ref(`hotels/${id}/operaUrl`).set({ url: u, at: Date.now(), src: 'typed' }); H.url = u; toast(`Opera address saved for ${H.name}`, 'ok'); }
  catch (_) { toast(`No access to change ${H.name}'s address`, 'err'); }
  paint();
}
function openHotelUrl(id) {
  const H = (HOTELS || []).find(h => h.id === id); if (!H || !H.url) return;
  const w = W.open(H.url, 'hotelops-opera'); if (!w) toast('Allow pop-ups for HotelOps, or open Opera Cloud yourself', 'warn');
}
function hotelsHtml() {
  const L = HOTELS || [{ id: 'this', name: ((doc.getElementById('hotelName') || {}).textContent || 'This hotel').trim(), url: operaUrl(), cur: true, edit: canAdmin() }];
  const short = u => { try { const x = new URL(u); return x.hostname.split('.')[0] + ' · ' + x.pathname.split('/').filter(Boolean)[0]; } catch (_) { return ''; } };
  return `<div class="hs-row hs-col"><span class="hs-txt"><b>Each hotel's Opera Cloud</b><small>🟢 Open Opera opens this hotel's address. ${myRole() === 'owner' ? 'You can change it for every hotel you own.' : myRole() === 'manager' ? 'You can change this hotel\'s.' : 'An owner or manager can change it.'}</small></span>
    <div class="op-list">${L.map(h => `<div class="op-item op-hotel"><span>${esc(h.name)}${h.cur ? ' · this hotel' : ''}</span><span title="${esc(h.url)}">${h.url ? esc(short(h.url)) : 'not set yet'}</span>
      <span class="hs-inline op-stuck-b">${h.url ? `<button type="button" class="btn sm ghost" data-op="hopen" data-hid="${esc(h.id)}">Open</button>` : ''}${h.edit ? `<button type="button" class="btn sm ghost" data-op="hedit" data-hid="${esc(h.id)}">Edit</button>` : ''}</span></div>`).join('')}</div></div>`;
}

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
  LAST_UNDO = { at: Date.now(), text, fn: undo, used: false };
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
  if (!snap) { safe(() => stuckApp(raw && typeof raw === 'object' ? raw : {}, 'not-applied', 'HotelOps answered "nothing readable": the snapshot had no list of rows it could use')); return 'nothing readable'; }
  if (raw && raw.url) safe(() => rememberHome(raw.url));
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
  let P;
  try { P = planNow(snap); }
  catch (e) { const m = String(e && e.message || e).replace(/\d+/g, '#').slice(0, 100); safe(() => stuckApp(snap, 'plan-error', 'HotelOps could not work out the changes: ' + m)); return 'could not apply · ' + m.slice(0, 60); }
  safe(() => unplacedCheck(snap, P));
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
  if (!was) safe(paintOpen);
  if (d.stuck && typeof d.stuck === 'object') { const ok = safe(() => stuckAdd(d.stuck, d.h, 'reader'), false); reply({ source: 'ho-op-ack', stuck: String(d.h || '').slice(0, 24), ok: !!ok }); return; }
  if (Array.isArray(d.learn)) { const hint = safe(() => learnAdd(d.learn), ''); reply({ source: 'ho-op-ack', hint: hint || '', learn: learnOn() }); return; }
  if (d.ping) {
    // answered at once, signed in or not (only applying waits): the reader shows "linked" as soon as this tab has loaded
    reply({ source: 'ho-op-ack', pong: 1, frame: String(d.frame || ''), again: !!(d.h && !SEEN.has(String(d.h))), auto: CFG.auto, learn: learnOn(), app: typeof APP_VERSION !== 'undefined' ? APP_VERSION : '', teach: teachNow() });
    if (d.home) safe(() => rememberHome(d.home));
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
  safe(dbStart); safe(paintOpen);
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
// the parts the Settings card and the 📡 Opera page share
function helperRows() {
  const D = doc.documentElement.dataset, helper = !!D.hoOpHelper, anyHelper = !!D.hoWaHelper;
  // the helper can always be downloaded again; one from before v436 links badly (stuck on "linking…") and must be
  const hv = parseFloat(D.hoWaHelper || '0') || 0, old = anyHelper && hv < 436;
  const get = helper && !old
    ? '<span class="op-ok">✓ The helper has the Opera reader</span><button class="btn sm ghost" data-op="dl">⬇ Download again</button>'
    : `<button class="btn sm gold" data-op="dl">⬇ ${anyHelper ? 'Get the new helper (once)' : 'Get the helper'}</button>`;
  return row('opera reader helper console reader', 'The helper', helper ? 'Starts the reader on Opera Cloud by itself and links it here. No helper on a PC? Copy the console reader and paste it in Opera\'s console (F12).' : 'Without it: copy the console reader, paste it in Opera\'s console (F12) and press Connect in its window.',
      `${get}<button class="btn sm ghost" data-op="copy" title="For a PC without the helper: paste it in Opera's console">Copy console reader</button>`)
    + (!helper ? row('opera reader how to add helper', 'How to turn it on', `${anyHelper ? 'Your helper is from before the Opera reader: download it once more, then in <code>chrome://extensions</code> press ↻ on the HotelOps helper (or remove it and <b>Load unpacked</b> the new folder).' : 'Download the helper, unzip it, open <code>chrome://extensions</code>, turn on Developer mode, <b>Load unpacked</b> the folder, and turn on <b>Allow User Scripts</b> in its Details.'} Then press 🟢 Open Opera: the HotelOps window shows bottom right in Opera. It only reads; it never clicks or types in Opera.`) : '');
}
function pendingHtml() {
  const pend = Object.values(PENDING);
  return pend.length ? `<div class="hs-row hs-col op-pend" data-s="opera reader waiting review apply"><span class="hs-txt"><b>Waiting for your OK</b><small>${pend.map(p => `${esc(KIND_LABEL[p.snap.kind] || p.snap.kind)} (${hhmm(p.at)}): ${esc(p.text)}`).join('<br>')}</small></span>
        <span class="hs-inline"><button class="btn sm gold" data-op="apply">Apply</button><button class="btn sm ghost" data-op="discard">Discard</button></span></div>` : '';
}
function statusLine() {
  const kinds = Object.values(LAST).sort((a, b) => b.at - a.at), last = kinds[0];
  const st = linkedNow() ? `🟢 Linked${LINK.ext ? ' through the helper' : ' (console reader)'}` : last ? '⚪ Not linked right now' : '⚪ Not linked yet';
  return `${st}${last ? ` · last read ${hhmm(last.at)}: ${last.n}${last.total > last.n ? ' of ' + last.total : ''} on ${esc(KIND_LABEL[last.kind] || last.kind)}${last.date && last.date !== today() ? ' (' + esc(last.date) + ')' : ''}` : ''}`;
}
/** Settings → 📡 Opera reader: the button, a short summary, what waits for an OK, the screens it couldn't read; the rest is on the 📡 Opera page */
function cardHtml() {
  const ro = !canWrite() && signedIn();
  return openCardHtml()
    + row('opera reader linked status last read page switches', '📡 Opera reader', `${statusLine()}${LOG.length ? ` · ${pl(LOG.length, 'change')} today` : ''}${ro ? '<br>Your role only sees what Opera shows — the lists are changed by colleagues who can edit.' : ''}<br>Switches, what it changed, bills, what it learned and the helper: on the 📡 Opera page.`,
      '<button class="btn sm gold" data-op="page">Open the Opera page →</button>')
    + pendingHtml() + stuckHtml();
}
const ST_LABEL = { due_in: 'arriving', in_house: 'in house', due_out: 'due out', checked_out: 'checked out', cancelled: 'cancelled', no_show: 'no show', waitlist: 'waitlist' };
/** the 📡 Opera page */
function pageHtml() {
  const linked = opLinked45(), kinds = Object.values(LAST).sort((a, b) => b.at - a.at), last = kinds[0];
  const sec = (id, title, sub, body) => `<section class="op-sec" id="op-${id}"><div class="op-sec-hd"><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><div class="hs-card op-card">${body}</div></section>`;
  const S = openNow();
  const check = linked ? '' : `<div class="hs-row hs-col op-check"><span class="hs-txt"><b>Not linked to Opera right now</b><small>Opera links by itself when it is open with the helper. If it doesn't:</small></span><ol>
      <li>Press <b>🟢 Open Opera</b> above: it opens Opera Cloud in this same browser.</li>
      <li>In Opera, the HotelOps window (bottom right) says what is missing: it checks this tab, the helper and its link.</li>
      <li>Still “linking…”? Reload this HotelOps tab, then in <code>chrome://extensions</code> press ↻ on the HotelOps helper.</li>
      ${S.state === 'nohelper' ? '<li>No helper on this PC: <b>Copy console reader</b> (Settings below), paste it in Opera\'s console (F12) and press <b>Connect</b> in its window.</li>' : ''}</ol></div>`;
  const lr = last ? (last.rows || []) : [];
  const live = last ? `<div class="hs-row hs-col"><span class="hs-txt"><b>${esc(KIND_LABEL[last.kind] || last.kind)}${last.title && String(last.title).toLowerCase().indexOf(String(KIND_LABEL[last.kind] || last.kind).toLowerCase()) < 0 ? ' · ' + esc(last.title) : ''}</b><small>${pl(last.n, 'line')}${last.total > last.n ? ' of ' + last.total : ''} read at ${hhmm(last.at)}${linked ? ' · live' : ''}${last.res ? ' · HotelOps: ' + esc(last.res) : ''}</small></span>
      ${lr.length ? `<div class="op-tbl-wrap"><table class="op-tbl"><thead><tr><th>Room</th><th>Name</th><th>Status</th><th class="num">Balance</th></tr></thead><tbody>${lr.slice(0, 8).map(r => `<tr><td>${esc(r.room || '—')}</td><td>${esc(r.name || '')}</td><td>${esc(ST_LABEL[r.status] || r.statusText || r.rs || '')}</td><td class="num">${r.balance == null ? '' : esc(money2(r.balance))}</td></tr>`).join('')}</tbody></table>${lr.length > 8 ? `<small class="op-more">… ${lr.length - 8} more</small>` : ''}</div>` : ''}</div>`
      + (kinds.length > 1 ? `<div class="hs-row hs-col"><span class="hs-txt"><b>Also read today</b></span><div class="op-list">${kinds.slice(1).map(k => `<div class="op-item"><span>${esc(KIND_LABEL[k.kind] || k.kind)}</span><span>${k.n}${k.total > k.n ? ' of ' + k.total : ''} · ${hhmm(k.at)}</span>${k.res ? `<small>${esc(k.res)}</small>` : ''}</div>`).join('')}</div></div>` : '')
    : '<div class="hs-row"><span class="hs-txt"><b>Nothing read yet today</b><small>Open Opera with the button above: what it shows appears here.</small></span></div>';
  const undo = LAST_UNDO && !LAST_UNDO.used && Date.now() - LAST_UNDO.at < 3 * 3600e3 ? `<div class="hs-row"><span class="hs-txt"><b>Last change · ${hhmm(LAST_UNDO.at)}</b><small>${esc(LAST_UNDO.text)}</small></span><span class="hs-inline"><button class="btn sm ghost" data-op="undo">↩ Undo</button></span></div>` : '';
  const changes = pendingHtml() + undo + `<div class="hs-row hs-col"><span class="hs-txt"><b>${LOG.length ? pl(LOG.length, 'change') + ' today' : 'Nothing changed yet today'}</b><small>${LOG.length ? 'Newest first. Each change set had an Undo in its toast; the newest one also above.' : 'When Opera shows a check-out, an extension or a new arrival, the lists change by themselves and it shows here.'}</small></span>${LOG.length ? `<div class="op-list">${LOG.slice(0, 15).map(l =>
      `<div class="op-item"><span>${hhmm(l.at)}</span><span>${esc(l.text)}</span>${l.detail && l.detail.length ? `<small>${esc(l.detail.slice(0, 6).join(' · '))}${l.detail.length > 6 ? ' …' : ''}</small>` : ''}</div>`).join('')}</div>` : ''}</div>`;
  const fol = Object.values(FOL.date === today() ? FOL.rooms : {}), owe = fol.filter(f => f.balance > 0).sort((a, b) => b.balance - a.balance);
  const bills = owe.length ? `<div class="hs-row hs-col"><div class="op-list" style="margin-top:0">${owe.slice(0, 40).map(f => `<div class="op-item"><span>${esc(f.room || f.conf || '—')}</span><span>AED ${esc(money2(f.balance))} open${(f.pays || []).length ? ' · ' + esc(f.pays.join(', ')) : ''}</span><small>${esc(firstLast(f.name || ''))} · read ${esc(hhmm(f.at))}${f.src === 'folio' ? ' on its bill' : ' on ' + esc(KIND_LABEL[f.src] || f.src || '')}</small></div>`).join('')}</div></div>`
    : `<div class="hs-row"><span class="hs-txt"><b>${fol.length ? 'Every bill read today is settled' : 'No bill read yet today'}</b><small>Open a bill (Billing / Folio) or Departures in Opera: open balances show here and on the Departures cards.</small></span></div>`;
  const ro = !canWrite() && signedIn();
  const settings = sw('auto', 'Adjust by itself', 'Check out rooms Opera shows checked out, mark extensions, add new arrivals and fill empty details. Never changes what someone typed.', CFG.auto)
    + sw('review', 'Review before applying', 'Hold the changes here until you press Apply', CFG.review)
    + helperRows()
    + row('opera reader clear today', 'Clear today', 'Forget today\'s reads, bills and room statuses on this PC (the lists keep what was changed).', '<button class="btn sm ghost" data-op="clearday">Clear</button>');
  return `<div class="page-hd"><div class="page-hd-left"><h1>📡 Opera</h1><p>Reads Opera Cloud while you work and keeps Departures, Arrivals and In-House up to date${ro ? ' · your role sees what Opera shows; colleagues who can edit apply it' : ''}</p></div></div>
    <div class="op-wrap">
      <div class="hs-card op-card op-top">${openCardHtml()}${check}</div>
      ${sec('address', 'Opera address', 'Per hotel', hotelsHtml())}
      ${sec('live', 'Live now', linked ? 'What Opera shows, as it is read' : 'The newest read', live)}
      ${sec('changes', 'What it changed today', '', changes)}
      ${sec('bills', 'Bills', 'Rooms with an open balance in Opera today', bills)}
      ${sec('learn', '🧠 Learned from you', '', learnCardHtml())}
      ${sec('stuck', '🛟 Screens it couldn\'t read', '', stuckHtml())}
      ${sec('settings', 'Settings', '', settings)}
    </div>`;
}
let LAST_UNDO = null;   // the newest change set's Undo (this tab, while the lists are as it left them)
/** the big "🟢 Open Opera" button and the helper's state (like WhatsApp's card) */
function openCardHtml() {
  const S = openNow(), url = operaUrl();
  let host = ''; try { host = url ? new URL(url).hostname : ''; } catch (_) {}
  return `<div class="hs-row hs-col op-open" data-s="opera reader open opera cloud linked helper address"><div class="op-open-row">
      <button type="button" class="op-go" data-op="open">${esc(S.btn)}</button>
      <div class="op-open-st"><b class="${S.state === 'on' ? 'op-ok' : S.state === 'noscripts' ? 'op-warn' : ''}">${esc(S.b)}</b>${S.state === 'nohelper' ? '<button type="button" class="op-lnk" data-op="dl">⬇ Get the helper</button>' : `<span>${esc(S.s)}</span>`}
        ${S.state !== 'nohelper' && (parseFloat(doc.documentElement.dataset.hoWaHelper || '0') || 0) < 436 ? '<span class="op-old">Your helper is older than v436 (old window, can get stuck on “linking…”): <button type="button" class="op-lnk" data-op="dl">⬇ Get the new helper (once)</button> → unzip over the same folder → ↻ in chrome://extensions</span>' : ''}
        <span class="op-url">${url ? `Opera: ${esc(host)} · <button type="button" class="op-lnk" data-op="url">change</button>` : 'Opera address: not known yet · <button type="button" class="op-lnk" data-op="url">set it</button> (or open Opera once: it is remembered)'}</span></div></div></div>`;
}
/** 🛟 Screens it couldn't read */
function stuckHtml() {
  const L = stuckLoad(), t0 = today();
  const when = t => { const d = new Date(t), iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; return (iso === t0 ? '' : iso.slice(5) + ' ') + hhmm(t); };
  return `<div class="hs-row hs-col" data-s="opera reader screens it couldn't read stuck problems report copy for claude teach not read right"><span class="hs-txt"><b>🛟 Screens it couldn't read (${L.length})</b><small>${L.length
      ? 'Press “📋 Copy for Claude” and paste it in the chat: the reader then learns that screen. It holds the screen’s layout only (headers and shapes like “Aaaa 99”), never guest data.'
      : 'None — every screen it saw was read. If one isn’t read right, press 🛟 in the Opera window.'}</small></span>${L.length ? `<div class="op-list">${L.map(e => {
        const r = e.rep || {}, why = (r.why || []).map(w => w.t).join(' · ');
        return `<div class="op-item op-stuck"><span>${esc(when(e.last))}</span><span>${esc(r.title || KIND_LABEL[r.kind] || 'An Opera screen')}${r.kind ? ' · ' + esc(KIND_LABEL[r.kind] || r.kind) : ''}${e.n > 1 ? ` · seen ${e.n}×` : ''}${e.src === 'app' ? ' · HotelOps side' : ''}</span><small>${esc(why)}</small>
          <span class="hs-inline op-stuck-b"><button type="button" class="btn sm gold" data-op="scopy" data-h="${esc(e.h)}">📋 Copy for Claude</button><button type="button" class="btn sm ghost" data-op="sdismiss" data-h="${esc(e.h)}">Dismiss</button></span></div>`;
      }).join('')}</div><span class="hs-inline" style="margin-top:8px"><button type="button" class="btn sm ghost" data-op="sclear">Clear all</button></span>` : ''}</div>`;
}
/** the small strip at the top of Departures and Arrivals (desk PC only: hidden on phones and touch screens) */
function stripHtml() {
  const S = openNow();
  const st = S.state === 'nohelper' ? 'Get the helper in Settings → Opera reader to link with one click' : S.btn.charAt(0) === '✓' ? 'Reads Opera by itself · this list stays up to date' : S.state === 'noscripts' ? '⚡ Reader on · reads by itself' : '⚡ Reader on · links by itself when Opera opens';
  return `<button type="button" class="op-go sm" data-opx="open">${esc(S.btn)}</button><span class="op-strip-st">${esc(st)}</span>`;
}
function paintOpen() {
  ['departures', 'arrivals'].forEach(k => {
    const pnl = doc.getElementById('panel-' + k); if (!pnl) return;
    let e = pnl.querySelector(':scope > .op-strip');
    if (!e) { const hd = pnl.querySelector(':scope > .page-hd'); if (!hd) return; e = doc.createElement('div'); e.className = 'op-strip'; e.id = 'opStrip-' + k; hd.insertAdjacentElement('afterend', e); }
    const h = stripHtml(); if (e.innerHTML !== h) e.innerHTML = h;
  });
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
  safe(paintOpen);
  safe(paintPage);
  const c = doc.querySelector('#hs-opera .hs-card'); if (!c) return;
  c.innerHTML = cardHtml();
}
// ══ The 📡 Opera page (its own place in the menu, like WhatsApp) ══
const PANEL = 'opera';
const pageOn = () => { const p = doc.getElementById('panel-' + PANEL); return !!p && p.classList.contains('active'); };
function paintPage() {
  if (!pageOn()) return;
  if (!HOTELS || Date.now() - HOTELS_AT > 60000) safe(() => loadHotels());
  const r = doc.getElementById('opRoot'); if (!r) return;
  const h = pageHtml(); if (r.__h !== h) { r.innerHTML = h; r.__h = h; }
}
function clearDay() {
  if (typeof confirm === 'function' && !confirm('Forget today\'s Opera reads, bills and room statuses on this PC?')) return;
  LOG = []; LAST = {}; saveLog(); saveLast();
  FOL = { date: today(), rooms: {} }; RST = { date: today(), rooms: {} }; TRC = { date: today(), list: [] }; PRF = { date: today(), by: {} };
  [LS_FOLIO, LS_RST, LS_TRC, LS_PRF].forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
  safe(paintDepChips); paint();
}
const NAV_IC = '<svg class="ho-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.9 19.1a10 10 0 0 1 0-14.2"/><path d="M19.1 4.9a10 10 0 0 1 0 14.2"/><path d="M7.8 16.2a6 6 0 0 1 0-8.4"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4"/><circle cx="12" cy="12" r="2"/></svg>';
function mountPage() {
  if (doc.getElementById('panel-' + PANEL)) return true;
  const main = doc.querySelector('#appWrapper .main') || doc.querySelector('.main') || doc.querySelector('main');
  const nav = doc.querySelector('.sidenav'); if (!main || !nav) return false;
  const panel = doc.createElement('div'); panel.className = 'panel'; panel.id = 'panel-' + PANEL;
  const root = doc.createElement('div'); root.id = 'opRoot'; panel.appendChild(root); main.appendChild(panel);
  panel.addEventListener('click', e => { const t = e.target.closest && e.target.closest('#opRoot [data-op]'); if (t && t.tagName !== 'INPUT') onAct(t); });
  panel.addEventListener('change', e => { const t = e.target.closest && e.target.closest('#opRoot input[data-op]'); if (t) onSwitch(t); });
  const item = doc.createElement('div'); item.className = 'nav-item'; item.id = 'nav-' + PANEL; item.dataset.panel = PANEL;
  item.setAttribute('onclick', "showPanel('" + PANEL + "')");
  item.innerHTML = '<div class="nav-icon" data-ho-ic="1" data-emoji="📡">' + NAV_IC + '</div>Opera';
  nav.appendChild(item);
  const grid = doc.querySelector('.mob-more-grid');
  if (grid) {
    const b = doc.createElement('button'); b.className = 'mob-more-item'; b.dataset.panel = PANEL; b.type = 'button';
    b.setAttribute('onclick', "showPanel('" + PANEL + "');(typeof closeMobMore==='function'?closeMobMore:function(){})()");
    b.innerHTML = '<span class="mob-item-icon" data-ho-ic="1" data-emoji="📡">' + NAV_IC + '</span>Opera'; grid.appendChild(b);
  }
  safe(() => {
    if (typeof ROLES !== 'undefined') ['owner', 'manager', 'supervisor', 'agent', 'readonly'].forEach(r => { const p = ROLES[r] && ROLES[r].panels; if (p && !p.includes(PANEL)) p.push(PANEL); });
    if (typeof currentProfile !== 'undefined' && currentProfile && typeof applyRole === 'function') applyRole(currentProfile.role);
  });
  safe(() => { if (typeof W.hoNavOrder === 'function') W.hoNavOrder(); });
  let was = false;
  new MutationObserver(() => { const on = pageOn(); if (on && !was) { root.__h = ''; paintPage(); } was = on; }).observe(panel, { attributes: true, attributeFilter: ['class'] });
  return true;
}
function openPage(sec) {
  if (typeof showPanel === 'function') showPanel(PANEL);
  paintPage();
  if (sec) setTimeout(() => { const e = doc.getElementById('op-' + sec); if (e && e.scrollIntoView) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80);
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
    onAct(t);
  });
  box.addEventListener('change', e => { const t = e.target.closest && e.target.closest('#hs-opera input[data-op]'); if (t) onSwitch(t); });
  return true;
}
function onSwitch(t) { if (t.dataset.op === 'learn') setLearn(t.checked); else setCfg(t.dataset.op, t.checked); }
function onAct(t) {
  {
    const a = t.dataset.op;
    if (a === 'dl') { if (W.hoWaHelper) W.hoWaHelper.download(); } else if (a === 'copy') copyReader();
    else if (a === 'apply') applyPending(); else if (a === 'discard') discardPending();
    else if (a === 'seen') { SHOW_SEEN = !SHOW_SEEN; paint(); } else if (a === 'forget') forgetLearn();
    else if (a === 'open') openOpera(); else if (a === 'url') askOperaUrl();
    else if (a === 'scopy') stuckCopy(t.dataset.h); else if (a === 'sdismiss') stuckDismiss(t.dataset.h); else if (a === 'sclear') stuckClear();
    else if (a === 'page') openPage(); else if (a === 'clearday') clearDay();
    else if (a === 'hedit') editHotelUrl(t.dataset.hid); else if (a === 'hopen') openHotelUrl(t.dataset.hid);
    else if (a === 'undo' && LAST_UNDO && !LAST_UNDO.used) { LAST_UNDO.used = true; safe(() => LAST_UNDO.fn()); paint(); }
  }
}
function css() {
  const s = doc.createElement('style'); s.id = 'opCss';
  s.textContent = `:is(#hs-opera,#opRoot) .op-list{display:grid;gap:6px;margin-top:10px}
:is(#hs-opera,#opRoot) .op-item{display:grid;grid-template-columns:minmax(0,150px) minmax(0,1fr);gap:4px 10px;font-size:12.5px;padding:6px 10px;border:1px solid var(--border,#333);border-radius:var(--r,6px)}
:is(#hs-opera,#opRoot) .op-item span:first-child{font-weight:600;color:var(--text,#eee)}:is(#hs-opera,#opRoot) .op-item span+span{color:var(--text2,#bbb)}
:is(#hs-opera,#opRoot) .op-item small{grid-column:1/-1;color:var(--text3,#999)}:is(#hs-opera,#opRoot) .op-ok{font-size:12.5px;color:var(--green,#16a34a);font-weight:600;align-self:center}
@media (max-width:560px){:is(#hs-opera,#opRoot) .op-item{grid-template-columns:1fr}}
#hs-opera .op-open,#opRoot .op-open{padding:12px 14px !important;border-radius:16px;background:linear-gradient(135deg,color-mix(in srgb,#c9a14a 16%,var(--card,#1a1a1a)),var(--card,#1a1a1a));border:1px solid color-mix(in srgb,#c9a14a 42%,transparent)}
.op-open-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;min-width:0}
.op-go{flex:0 0 auto;padding:11px 16px;border-radius:12px;border:0;background:linear-gradient(135deg,#22c55e,#15803d);color:#fff;font:700 14px var(--font,system-ui);cursor:pointer;box-shadow:0 8px 20px -10px #15803d;white-space:nowrap}
.op-go:active{transform:scale(.97)}.op-go.sm{padding:7px 12px;border-radius:10px;font-size:13px;box-shadow:none}
.op-open-st{display:flex;flex-direction:column;gap:2px;font-size:12.5px;color:var(--text2,#bbb);min-width:0;flex:1 1 220px}.op-open-st b{color:var(--text,#eee);font-size:13.5px}
.op-old{color:var(--amber,#d97706);font-size:12.5px}.op-old .op-lnk{font-weight:700}
.op-open-st b.op-ok{color:var(--green,#16a34a)}.op-open-st b.op-warn{color:var(--amber,#d97706)}.op-url{color:var(--text3,#999);font-size:12px}
.op-lnk{align-self:flex-start;padding:0;border:0;background:none;color:var(--accent,#c9a14a);font:600 12.5px var(--font,system-ui);cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.op-url .op-lnk{display:inline;font-size:12px}
:is(#hs-opera,#opRoot) .op-stuck .op-stuck-b{grid-column:1/-1;display:flex;gap:6px;flex-wrap:wrap}
#opRoot{max-width:980px;margin:0 auto;min-width:0}#opRoot .op-wrap{display:flex;flex-direction:column;gap:18px;min-width:0}
#opRoot .op-card{padding:0;overflow:hidden;min-width:0}#opRoot .op-top .op-open{border-radius:0 !important;border:0;border-bottom:1px solid var(--border,#333)}
#opRoot .op-sec-hd{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin:0 2px 8px}#opRoot .op-sec-hd h2{margin:0;font-size:1rem;font-weight:700;color:var(--text,#eee)}#opRoot .op-sec-hd p{margin:0;font-size:12.5px;color:var(--text3,#999)}
#opRoot .hs-row,#opRoot .hs-txt{min-width:0}#opRoot .hs-row.hs-col{flex-wrap:nowrap}#opRoot .hs-row.hs-col>*{max-width:100%}#opRoot .hs-txt small{overflow-wrap:anywhere;white-space:normal}
#opRoot .op-check ol{margin:8px 0 2px;padding-left:20px;display:flex;flex-direction:column;gap:5px;font-size:13px;color:var(--text2,#bbb)}#opRoot .op-check code{background:var(--bg2,#222);padding:1px 5px;border-radius:5px}
#opRoot .op-tbl-wrap{margin-top:10px;min-width:0}#opRoot .op-tbl{width:100%;min-width:0;table-layout:fixed;border-collapse:collapse;font-size:12.5px}
#opRoot .op-tbl th{text-align:left;font-weight:600;color:var(--text3,#999);font-size:11px;text-transform:uppercase;letter-spacing:.05em;padding:4px 6px;border-bottom:1px solid var(--border,#333)}
#opRoot .op-tbl td{padding:6px;border-bottom:1px solid color-mix(in srgb,var(--border,#333) 60%,transparent);color:var(--text,#eee);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#opRoot .op-tbl th:first-child,#opRoot .op-tbl td:first-child{width:62px;font-weight:600}#opRoot .op-tbl th:nth-child(3),#opRoot .op-tbl td:nth-child(3){width:96px}#opRoot .op-tbl .num{width:82px;text-align:right;font-variant-numeric:tabular-nums}
#opRoot .op-more{display:block;margin-top:6px;color:var(--text3,#999)}
@media (max-width:560px){#opRoot .op-tbl th:nth-child(3),#opRoot .op-tbl td:nth-child(3){width:74px}#opRoot .op-tbl .num{width:64px}#opRoot .hs-row:not(.hs-col){flex-wrap:wrap}#opRoot .hs-inline{flex-wrap:wrap}}
.op-strip{display:flex;align-items:center;gap:10px;margin:-8px 0 14px;padding:7px 10px;border-radius:12px;border:1px solid var(--border,#333);background:var(--card,transparent);min-width:0;max-width:100%;box-sizing:border-box}
.op-strip-st{font-size:12.5px;color:var(--text2,#bbb);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (hover:none),(pointer:coarse),(max-width:760px){.op-strip{display:none !important}}
.op-chips{display:contents}.dp-chip.op-bal{color:var(--red,#dc2626);border-color:color-mix(in srgb,var(--red,#dc2626) 45%,transparent)}
.dp-chip.op-hint{color:var(--text2,#bbb);font-weight:500}.dp-chip.op-rs-dirty,.dp-chip.op-rs-ooo,.dp-chip.op-rs-oos{color:var(--amber,#d97706)}.dp-chip.op-rs-inspected,.dp-chip.op-rs-clean{color:var(--green,#16a34a)}`;
  (doc.head || doc.documentElement).appendChild(s);
}
css();
safe(paintOpen); setTimeout(() => { safe(dbStart); safe(paintOpen); }, 4000);
if (!mountPage()) { const ivp = setInterval(() => { if (mountPage()) clearInterval(ivp); }, 1500); setTimeout(() => clearInterval(ivp), 120000); }
doc.addEventListener('click', e => { const t = e.target.closest && e.target.closest('.op-strip [data-opx="open"]'); if (t) openOpera(); });
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
      + `<div class="br-acts"><button class="btn" onclick="brClose();hoOpera.openPage()">Open the Opera page</button></div>`,
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
  // 🛟 the screens it couldn't read: "opera problems", "what couldn't the reader read"
  const SK = stuckLoad();
  out.push({ id: 'op:stuck', kind: '🛟 Opera reader', title: SK.length ? `Opera reader: ${pl(SK.length, 'screen')} it couldn't read — ${SK.slice(0, 3).map(e => (e.rep && (e.rep.title || KIND_LABEL[e.rep.kind])) || 'a screen').join(', ')}` : 'Opera reader: every screen it saw was read',
    body: (SK.length ? `<ul>${SK.slice(0, 8).map(e => `<li><b>${esc((e.rep && (e.rep.title || KIND_LABEL[e.rep.kind])) || 'An Opera screen')}</b> · ${esc(hhmm(e.last))}${e.n > 1 ? ' · ' + e.n + '×' : ''}: ${esc(((e.rep && e.rep.why) || []).map(w => w.t).join(' · '))}</li>`).join('')}</ul><div>Press “📋 Copy for Claude” on it and paste it in the chat: the reader then learns that screen (layout only, never guest data).</div>`
      : '<div>No problems: every Opera screen it saw was read. If one isn’t read right, press 🛟 in the HotelOps window in Opera.</div>')
      + `<div class="br-acts"><button class="btn" onclick="brClose();hoOpera.openPage('stuck')">Open the Opera page</button></div>`,
    text: 'opera problems problem issues errors reader stuck could not read couldn\'t read cannot read what couldn\'t the reader read not read right unread screens fix teach report claude copy for claude', go: 'opera', boost: SK.length ? 2 : 0 });
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
  /** the newest read of every kind: {kind: {kind, date, title, total, n, at, h, rows, res, folio?, traces?, tables?, audit?}} */
  reads: () => JSON.parse(JSON.stringify(LAST)),
  /** what waits for an OK (review mode): [{kind, at, text, n}] */
  pendingList: () => Object.values(PENDING).map(p => ({ kind: p.snap.kind, at: p.at, text: p.text, n: p.n })),
  /** today's reads and changes, newest first: [{at, kind: 'read'|'change', screen, text}] */
  timeline: () => Object.values(LAST).map(k => ({ at: k.at, kind: 'read', screen: k.kind, text: `${k.n}${k.total > k.n ? ' of ' + k.total : ''} on ${KIND_LABEL[k.kind] || k.kind}${k.res ? ' · ' + k.res : ''}` }))
    .concat(readLog().map(l => ({ at: l.at, kind: 'change', screen: l.kind || '', text: l.text }))).sort((a, b) => b.at - a.at),
  /** every folio read today [{room, name, conf, balance, zero, settled, windows, pays, at, src}] and the open ones (balance > 0, biggest first) */
  folios: () => JSON.parse(JSON.stringify(Object.values(FOL.date === today() ? FOL.rooms : {}))),
  openBalances: () => JSON.parse(JSON.stringify(Object.values(FOL.date === today() ? FOL.rooms : {}).filter(f => f.balance > 0).sort((a, b) => b.balance - a.balance))),
  /** the newest change set's Undo: {at, text} or null; undoLast() runs it (false when the lists changed since) */
  lastUndo: () => (LAST_UNDO && !LAST_UNDO.used ? { at: LAST_UNDO.at, text: LAST_UNDO.text } : null),
  undoLast: () => { if (!LAST_UNDO || LAST_UNDO.used) return false; LAST_UNDO.used = true; const ok = safe(() => LAST_UNDO.fn(), false); paint(); return ok; },
  /** 🛟 screens it couldn't read: [{h, first, last, n, src, app, rep}] newest first; the text for Claude; copy / dismiss / clear */
  stuck: () => JSON.parse(JSON.stringify(stuckLoad())), stuckText: stuckCopyText, stuckCopy, stuckDismiss, stuckClear,
  /** 🟢 Open Opera: opens Opera Cloud (asks for its address once); the card's state and HTML; the address */
  openOpera, openState: openNow, openCardHtml, operaUrl, setOperaUrl: u => setOperaUrl(u, 'typed'), askOperaUrl,
  /** the 📡 Opera page */
  openPage, pageHtml,
};
})();

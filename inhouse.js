// ═══════════════════════════════════════════════════════════
//  inhouse.js — 🛏️ In-House Guests
//
//  Who is staying in the hotel, from the Opera Cloud in-house report
//  ("Delimited Data": tab, comma, pipe or semicolon separated, with a
//  header row). Not the Inhouse Tally page (inhouse-tally.js), which
//  checks Opera's head count against the immigration XML.
//
//   • Load: Browse / drop a .txt .csv .tsv (or .xlsx when the Excel reader
//     is loaded) / paste. Columns are found by their header names, in any
//     order and spelling (Room, Room No, Guest Name, Last/First, Arr, Dep,
//     Nights, Adults, Children, Pax, Rate Code, Rate, Company, Travel Agent,
//     Source, Market, Balance, VIP, Membership / ALL, Confirmation, …).
//     Columns the page does not know are kept and shown in the guest's
//     window ("Other columns").
//   • Saved per hotel, one list per day: inhouse/{YYYY-MM-DD}, and a small
//     pointer inhouseMeta/latest { date, at, by, rooms, guests } that every
//     device listens to. db.js keeps a copy on this device (offline).
//     Loading the same day again shows what changed first (+ new rooms,
//     − rooms gone, changed) and replaces the list only on "Save".
//   • Other modules: window.hoInHouse = { rooms(), find(room), date, … }.
//     wa-bridge.js looks a WhatsApp room up here first, so "421 early
//     depart" for a room not on today's departures still finds the guest.
//   • Export: styled Excel (ExcelJS, loaded when exporting; plain SheetJS
//     when it cannot load) or a PDF print page; needs "Export files".
//
//  index.html only needs <script src="inhouse.js"></script>: the module
//  adds its own panel, menu items and styles. Pure helpers:
//  window.hoInHousePure (tested in tests/run-tests.js).
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';
const W = typeof window !== 'undefined' ? window : globalThis;
const doc = typeof document !== 'undefined' && document && document.createElement ? document : null;

// ══ Pure helpers ════════════════════════════════════════════
const pad = n => String(n).padStart(2, '0');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_OF = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12,
  JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, JUNE: 6, JULY: 7, AUGUST: 8, SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12 };
const isIso = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const utc = s => Date.parse(s + 'T00:00:00Z');
const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const addDays = (s, n) => { const d = new Date(utc(s) + n * 864e5); return isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); };
const diffDays = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
/** "2026-10-03" → "3 Oct 2026" ("3 Oct" with short) */
const fmtD = (s, short) => { if (!isIso(s)) return String(s || ''); const [y, m, d] = s.split('-'); return +d + ' ' + MON[+m - 1] + (short ? '' : ' ' + y); };
const dDot = s => (isIso(s) ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) : String(s || ''));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => (Math.round((+n || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const xlSerial = s => (isIso(s) ? Math.round(utc(s) / 864e5) + 25569 : '');

/** a date as Opera / Excel / a person writes it → "YYYY-MM-DD" ('' when it is not a date).
 *  20-OCT-26, 20-Oct-2026, 2026-10-20, 20/10/2026, 20.10.26, Oct 20 2026, 20261020, Excel day numbers; a time after it is ignored.
 *  dd/mm first (Dubai); mm/dd only when the second number cannot be a month. */
function parseDate(v) {
  let s = String(v == null ? '' : v).trim().replace(/^"|"$/g, '');
  if (!s) return '';
  const ok = (y, m, d) => { y = +y; m = +m; d = +d; if (y < 100) y += 2000; if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100)) return ''; const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCDate() === d ? isoOf(y, m, d) : ''; };
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/))) return ok(m[1], m[2], m[3]);
  if ((m = s.match(/^(\d{1,2})[-\/. ]([A-Za-z]{3,9})\.?[-\/. ,]+(\d{2,4})(?:$|[\s,T])/))) { const mo = MONTH_OF[m[2].toUpperCase()]; return mo ? ok(m[3], mo, m[1]) : ''; }
  if ((m = s.match(/^([A-Za-z]{3,9})\.?[-\/. ]+(\d{1,2})(?:st|nd|rd|th)?,?[-\/. ]+(\d{2,4})(?:$|[\s,T])/))) { const mo = MONTH_OF[m[1].toUpperCase()]; return mo ? ok(m[3], mo, m[2]) : ''; }
  if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(?:$|[\s,T])/))) { let d = +m[1], mo = +m[2]; if (mo > 12 && d <= 12) { const x = d; d = mo; mo = x; } return ok(m[3], mo, d); }
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return ok(m[1], m[2], m[3]);
  if (/^\d{5}(\.\d+)?$/.test(s) && +s > 32874 && +s < 73051) { const d = new Date(Math.round((+s - 25569) * 864e5)); return isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  return '';
}
/** "AED 1,234.50", "(120.00)", "-35", "1 234" → a number */
function parseMoney(v) {
  const s = String(v == null ? '' : v).trim(); if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || /^-|-$|\bCR\b/i.test(s.replace(/[A-Z]{3}\s*/i, ''));
  const n = parseFloat(s.replace(/[^\d.]/g, '')) || 0;
  return Math.round((neg ? -n : n) * 100) / 100;
}
const parseIntSafe = v => { const n = parseInt(String(v == null ? '' : v).replace(/[^\d-]/g, ''), 10); return isNaN(n) ? 0 : n; };
/** "0113" → "113", "113a" → "113A" (rooms are matched by this) */
const roomKey = r => { const s = String(r == null ? '' : r).trim().toUpperCase().replace(/\s+/g, ''); const m = s.match(/^([A-Z]?)0*(\d+)([A-Z]?)$/); return m ? m[1] + (m[2] || '0') + m[3] : s; };
const isRoom = s => /^[A-Za-z]?\d{1,5}[A-Za-z]?$/.test(String(s || '').trim());
const normH = h => String(h == null ? '' : h).replace(/^﻿/, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
/** a database key can't hold . # $ [ ] / */
const safeKey = k => String(k || '').replace(/[.#$\[\]\/\u0000-\u001f\u007f]/g, '_').slice(0, 120) || '_';

// The fields the page knows. exact: whole header names (after normH); loose: these words inside a longer header.
const FIELDS = {
  room:       { label: 'Room', exact: ['ROOM', 'ROOM_NO', 'ROOM_NUMBER', 'RM', 'RM_NO', 'RM_NUMBER', 'ROOM_NBR', 'ROOMNO', 'ROOM_NUM', 'RMNO'], loose: ['ROOM_NO', 'ROOM_NUMBER'] },
  name:       { label: 'Guest name', exact: ['GUEST_NAME', 'FULL_NAME', 'NAME', 'GUEST', 'GUESTNAME', 'GUEST_FULL_NAME', 'PRIMARY_GUEST', 'DISPLAY_NAME', 'GUEST_NAMES'], loose: ['GUEST_NAME', 'FULL_NAME'] },
  last:       { label: 'Last name', exact: ['LAST_NAME', 'LAST', 'SURNAME', 'FAMILY_NAME', 'LASTNAME'], loose: ['LAST_NAME', 'SURNAME'] },
  first:      { label: 'First name', exact: ['FIRST_NAME', 'FIRST', 'GIVEN_NAME', 'FIRSTNAME'], loose: ['FIRST_NAME'] },
  title:      { label: 'Title', exact: ['TITLE', 'SALUTATION'] },
  arrival:    { label: 'Arrival', exact: ['ARRIVAL', 'ARRIVAL_DATE', 'ARR', 'ARR_DATE', 'ARRIVAL_DT', 'CHECK_IN', 'CHECKIN', 'CHECK_IN_DATE', 'CHECKIN_DATE', 'BEGIN_DATE'], loose: ['ARRIVAL'], not: ['TIME'] },
  departure:  { label: 'Departure', exact: ['DEPARTURE', 'DEPARTURE_DATE', 'DEP', 'DEP_DATE', 'DEPARTURE_DT', 'CHECK_OUT', 'CHECKOUT', 'CHECK_OUT_DATE', 'CHECKOUT_DATE', 'END_DATE'], loose: ['DEPARTURE'], not: ['TIME'] },
  depTime:    { label: 'Departure time', exact: ['DEPARTURE_TIME', 'DEP_TIME', 'ETD', 'CHECKOUT_TIME'] },
  nights:     { label: 'Nights', exact: ['NIGHTS', 'NO_OF_NIGHTS', 'NUMBER_OF_NIGHTS', 'NTS', 'LOS', 'NUM_NIGHTS', 'LENGTH_OF_STAY'], loose: ['NIGHTS'] },
  adults:     { label: 'Adults', exact: ['ADULTS', 'ADULT', 'ADU', 'ADLT', 'ADL', 'NO_OF_ADULTS', 'NUMBER_OF_ADULTS'], loose: ['ADULTS'] },
  children:   { label: 'Children', exact: ['CHILDREN', 'CHILD', 'CHD', 'CHI', 'CHILDS', 'KIDS', 'NO_OF_CHILDREN', 'NUMBER_OF_CHILDREN'], loose: ['CHILDREN'] },
  pax:        { label: 'Pax', exact: ['PAX', 'PERSONS', 'NO_OF_GUESTS', 'NO_OF_PERSONS', 'NUMBER_OF_GUESTS', 'GUESTS', 'PAX_A_C', 'A_C', 'ADULTS_CHILDREN', 'PERSONS_A_C', 'OCCUPANCY'], loose: ['PAX'] },
  roomType:   { label: 'Room type', exact: ['ROOM_TYPE', 'ROOM_CATEGORY', 'RTYPE', 'RM_TYPE', 'ROOM_CLASS', 'ROOMTYPE'], loose: ['ROOM_TYPE'] },
  rateCode:   { label: 'Rate code', exact: ['RATE_CODE', 'RATECODE', 'RATE_PLAN', 'RATE_PLAN_CODE', 'RTC', 'RATE_CD'], loose: ['RATE_CODE'] },
  rate:       { label: 'Rate', exact: ['RATE', 'RATE_AMOUNT', 'ROOM_RATE', 'AMOUNT', 'DAILY_RATE', 'AVG_RATE', 'AVERAGE_RATE', 'EFFECTIVE_RATE', 'SHARE_AMOUNT', 'RATE_AMT', 'NIGHTLY_RATE'], loose: ['RATE_AMOUNT'] },
  company:    { label: 'Company', exact: ['COMPANY', 'COMPANY_NAME', 'CORPORATE', 'ACCOUNT_NAME'], loose: ['COMPANY'] },
  agent:      { label: 'Travel agent', exact: ['TRAVEL_AGENT', 'TRAVEL_AGENT_NAME', 'AGENT', 'TA', 'TA_NAME', 'TRAVEL_AGENCY'], loose: ['TRAVEL_AGENT'] },
  source:     { label: 'Source', exact: ['SOURCE', 'SOURCE_NAME', 'BUSINESS_SOURCE', 'CHANNEL'] },
  market:     { label: 'Market', exact: ['MARKET', 'MARKET_CODE', 'MKT', 'MKT_CODE', 'MARKET_SEGMENT', 'SEGMENT'], loose: ['MARKET'] },
  sourceCode: { label: 'Source code', exact: ['SOURCE_CODE', 'SRC', 'SRC_CODE', 'ORIGIN', 'ORIGIN_CODE'] },
  balance:    { label: 'Balance', exact: ['BALANCE', 'BAL', 'BALANCE_AMOUNT', 'OPEN_BALANCE', 'FOLIO_BALANCE', 'CURRENT_BALANCE', 'GUEST_BALANCE', 'ACCOUNT_BALANCE'], loose: ['BALANCE'] },
  vip:        { label: 'VIP', exact: ['VIP', 'VIP_CODE', 'VIP_STATUS', 'VIP_LEVEL', 'VIP_TYPE'], loose: ['VIP'] },
  member:     { label: 'Membership', exact: ['MEMBERSHIP', 'MEMBERSHIP_NO', 'MEMBERSHIP_NUMBER', 'MEMBERSHIP_TYPE', 'MEMBERSHIP_LEVEL', 'MEMBERSHIP_CARD', 'ALL', 'ALL_NO', 'ALL_NUMBER', 'ALL_MEMBER', 'ALL_CARD', 'ALL_LEVEL', 'LOYALTY', 'LOYALTY_NO', 'LOYALTY_NUMBER', 'MEMBER', 'MEMBER_NO', 'MEMBER_NUMBER', 'FREQUENT_GUEST'], loose: ['MEMBERSHIP', 'LOYALTY'] },
  conf:       { label: 'Confirmation', exact: ['CONFIRMATION_NO', 'CONFIRMATION', 'CONFIRMATION_NUMBER', 'CONF', 'CONF_NO', 'CONF_NUMBER', 'RESERVATION_NO', 'RESERVATION_NUMBER', 'RESERVATION', 'RESV_NO', 'RES_NO', 'RESV_NAME_ID', 'BOOKING_NO', 'BOOKING_REF', 'BOOKING_NUMBER', 'RES_ID', 'RESERVATION_ID'], loose: ['CONFIRMATION'] },
  nat:        { label: 'Nationality', exact: ['NATIONALITY', 'NAT', 'COUNTRY', 'NATIONALITY_DESC', 'COUNTRY_DESC', 'NATIONALITY_CODE', 'COUNTRY_CODE'], loose: ['NATIONALITY'] },
  pay:        { label: 'Payment', exact: ['PAYMENT_METHOD', 'PAYMENT', 'PAYMENT_TYPE', 'PAY_METHOD', 'METHOD_OF_PAYMENT', 'PMT', 'PAYMENT_CODE', 'PAY_TYPE'], loose: ['PAYMENT'] },
  status:     { label: 'Status', exact: ['STATUS', 'RES_STATUS', 'RESV_STATUS', 'RESERVATION_STATUS', 'RESV_STATUS_DESC', 'GUEST_STATUS'] },
  notes:      { label: 'Notes', exact: ['NOTES', 'NOTE', 'COMMENTS', 'COMMENT', 'REMARKS', 'REMARK', 'SPECIALS', 'SPECIAL_REQUESTS', 'SPECIAL_REQUEST', 'RES_COMMENTS', 'RESERVATION_COMMENTS', 'GUEST_COMMENTS'], loose: ['COMMENTS', 'COMMENT', 'REMARKS', 'NOTES'] },
};
const FIELD_KEYS = Object.keys(FIELDS);

/** header cells → { map: {field: column}, extra: [columns not known] } */
function mapHeader(cells) {
  const H = (cells || []).map(normH), map = {}, taken = new Set();
  FIELD_KEYS.forEach(f => {
    for (const a of FIELDS[f].exact) { const i = H.findIndex((h, j) => h === a && !taken.has(j)); if (i >= 0) { map[f] = i; taken.add(i); return; } }
  });
  const has = (h, a) => ('_' + h + '_').includes('_' + a + '_');
  FIELD_KEYS.forEach(f => {
    if (map[f] !== undefined || !FIELDS[f].loose) return;
    for (const a of FIELDS[f].loose) {
      const i = H.findIndex((h, j) => h && !taken.has(j) && has(h, a) && !(FIELDS[f].not || []).some(x => has(h, x)));
      if (i >= 0) { map[f] = i; taken.add(i); return; }
    }
  });
  const extra = H.map((h, i) => i).filter(i => !taken.has(i) && String(cells[i] == null ? '' : cells[i]).trim());
  return { map, extra };
}
const usable = m => m.map.room !== undefined && ['name', 'last', 'arrival', 'departure'].some(f => m.map[f] !== undefined);

/** text → rows of cells. Quotes ("a, b" and "" inside) are read for every separator, also over a line break;
 *  a quote that is never closed is just a character. */
function splitRows(text, d) {
  text = String(text || '').replace(/^﻿/, '');
  const rows = [], n = text.length;
  let row = [], f = '', i = 0;
  const endField = () => { row.push(f.trim()); f = ''; };
  const closesAt = from => { for (let k = from; k < n; k++) { if (text[k] !== '"') continue; if (text[k + 1] === '"') { k++; continue; } const nx = text[k + 1]; if (nx === undefined || nx === d || nx === '\n' || nx === '\r') return k; } return -1; };
  while (i < n) {
    const c = text[i];
    if (c === '"' && !f.trim()) {
      const end = closesAt(i + 1);
      if (end > 0) { f = text.slice(i + 1, end).replace(/""/g, '"').replace(/\r?\n/g, ' '); i = end + 1; continue; }
    }
    if (c === d) { endField(); i++; continue; }
    if (c === '\r' || c === '\n') { endField(); rows.push(row); row = []; i += c === '\r' && text[i + 1] === '\n' ? 2 : 1; continue; }
    f += c; i++;
  }
  if (f || row.length) { endField(); rows.push(row); }
  return rows.filter(r => r.some(x => x));
}

/** which separator and which line is the header → { delim, rows, header, hi, m } or null */
function detect(text) {
  const head = String(text || '').split(/\r?\n/).slice(0, 40).join('\n');
  let best = null;
  ['\t', '|', ';', ','].forEach((d, di) => {
    if (!head.includes(d)) return;
    const rows = splitRows(head, d);
    for (let i = 0; i < Math.min(rows.length, 25); i++) {
      const m = mapHeader(rows[i]);
      if (!usable(m)) continue;
      const score = Object.keys(m.map).length * 10 - di;
      if (!best || score > best.score) best = { delim: d, hi: i, m, score };
      break;
    }
  });
  return best;
}

const NO = /^(|-|–|—|0|N|NO|NONE|FALSE|NULL|N\/A|NA)$/i;
/** "Doe, Test, Mr" → "Test Doe"; LAST / FIRST columns → "First Last" */
function guestName(raw, first, last) {
  const t = /^(MR|MRS|MS|MISS|DR|MSTR|MASTER|PROF|SIR|MME|M)\.?$/i;
  if (last || first) return [first, last].map(x => String(x || '').trim()).filter(Boolean).join(' ');
  raw = String(raw || '').trim();
  if (raw.includes(',')) { const p = raw.split(',').map(x => x.trim()).filter(x => x && !t.test(x)); return p.slice(0, 2).reverse().join(' ').trim() || raw; }
  return raw;
}

/** One Opera in-house export → { rows, cols, extraCols, delim, skipped, stitched, errors }.
 *  rows: one per reservation line (sharers in a room are separate rows). */
function parseReport(text) {
  const out = { rows: [], cols: [], extraCols: [], delim: '', skipped: 0, stitched: 0, errors: [] };
  if (!String(text || '').trim()) { out.errors.push('The report is empty.'); return out; }
  const D = detect(text);
  if (!D) {
    const first = String(text).split(/\r?\n/).find(l => l.trim()) || '';
    out.errors.push('No header row with a Room column and a name or date column was found in the first lines.');
    if (first) out.errors.push('First line: ' + first.slice(0, 160));
    return out;
  }
  out.delim = { '\t': 'tab', '|': 'pipe', ';': 'semicolon', ',': 'comma' }[D.delim];
  const all = splitRows(text, D.delim), hdr = all[D.hi], M = D.m.map, width = hdr.length;
  out.cols = FIELD_KEYS.filter(f => M[f] !== undefined).map(f => ({ f, h: String(hdr[M[f]]).trim(), label: FIELDS[f].label }));
  out.extraCols = D.m.extra.map(i => String(hdr[i]).trim());
  const body = all.slice(D.hi + 1);
  // a value with a line break in it (not quoted) splits one row in two short ones: put them back together
  const rows = [];
  for (let k = 0; k < body.length; k++) {
    let r = body[k];
    while (width > 5 && r.length < width && k + 1 < body.length && body[k + 1].length < width && r.length + body[k + 1].length - 1 <= width && !isRoom(body[k + 1][M.room])) {
      const nx = body[++k]; r = r.slice(0, -1).concat([(r[r.length - 1] + ' ' + nx[0]).trim()], nx.slice(1)); out.stitched++;
    }
    rows.push(r);
  }
  const cell = (r, f) => (M[f] === undefined ? '' : String(r[M[f]] == null ? '' : r[M[f]]).trim());
  rows.forEach(r => {
    if (r.map(normH).join('|') === hdr.map(normH).join('|')) return;   // the header again (a report of several pages)
    const room = cell(r, 'room').replace(/\s+/g, '');
    if (!isRoom(room)) { if (r.some(x => x)) out.skipped++; return; }
    const g = { room, rk: roomKey(room) };
    g.name = guestName(cell(r, 'name'), cell(r, 'first'), cell(r, 'last')) || '—';
    ['title', 'depTime', 'roomType', 'rateCode', 'company', 'agent', 'source', 'market', 'sourceCode', 'conf', 'nat', 'pay', 'status', 'notes'].forEach(f => { const v = cell(r, f); if (v) g[f] = v; });
    g.arrival = parseDate(cell(r, 'arrival'));
    g.departure = parseDate(cell(r, 'departure'));
    if (!g.arrival && cell(r, 'arrival')) g.arrRaw = cell(r, 'arrival');
    if (!g.departure && cell(r, 'departure')) g.depRaw = cell(r, 'departure');
    g.nights = parseIntSafe(cell(r, 'nights'));
    if (!g.nights && g.arrival && g.departure) g.nights = Math.max(0, diffDays(g.arrival, g.departure));
    g.adults = parseIntSafe(cell(r, 'adults')); g.children = parseIntSafe(cell(r, 'children'));
    const px = cell(r, 'pax');
    if (px) { const pm = px.match(/^(\d+)\s*[\/+]\s*(\d+)$/); if (pm) { if (M.adults === undefined) g.adults = +pm[1]; if (M.children === undefined) g.children = +pm[2]; } else if (M.adults === undefined) g.adults = parseIntSafe(px); }
    if (M.rate !== undefined && cell(r, 'rate')) g.rate = parseMoney(cell(r, 'rate'));
    g.balance = parseMoney(cell(r, 'balance'));
    const vip = cell(r, 'vip'); if (!NO.test(vip)) g.vip = vip;
    const mem = cell(r, 'member'); if (!NO.test(mem)) g.member = mem;
    const ex = {}; D.m.extra.forEach(i => { const v = String(r[i] == null ? '' : r[i]).trim(); if (v) ex[safeKey(hdr[i])] = v.slice(0, 500); });
    if (Object.keys(ex).length) g.extra = ex;
    out.rows.push(g);
  });
  if (!out.rows.length) out.errors.push(`The header was found (${out.cols.map(c => c.h).join(', ')}), but no line under it has a room number.`);
  return out;
}

const firstOf = (L, k) => { for (const x of L) if (x[k]) return x[k]; return ''; };
/** reservation rows → one entry per room (sharers together) */
function groupRooms(rows) {
  const by = new Map();
  (rows || []).forEach(g => { const k = g.rk || roomKey(g.room); if (!by.has(k)) by.set(k, []); by.get(k).push(g); });
  return [...by.entries()].map(([k, L]) => {
    const p = L[0], deps = L.map(x => x.departure).filter(Boolean).sort(), arrs = L.map(x => x.arrival).filter(Boolean).sort();
    return {
      room: p.room, rk: k, name: p.name, names: L.map(x => x.name), guests: L,
      arrival: arrs[0] || '', departure: deps[deps.length - 1] || '', departures: [...new Set(deps)], arrivals: [...new Set(arrs)],
      nights: Math.max(0, ...L.map(x => x.nights || 0)),
      adults: L.reduce((s, x) => s + (x.adults || 0), 0), children: L.reduce((s, x) => s + (x.children || 0), 0),
      balance: Math.round(L.reduce((s, x) => s + (x.balance || 0), 0) * 100) / 100,
      vip: firstOf(L, 'vip'), member: firstOf(L, 'member'), company: firstOf(L, 'company'), agent: firstOf(L, 'agent'), source: firstOf(L, 'source'),
      market: firstOf(L, 'market'), rateCode: firstOf(L, 'rateCode'), rate: p.rate, roomType: firstOf(L, 'roomType'), conf: firstOf(L, 'conf'),
      nat: firstOf(L, 'nat'), pay: firstOf(L, 'pay'), status: firstOf(L, 'status'), notes: L.map(x => x.notes).filter(Boolean).join(' · '), depTime: firstOf(L, 'depTime'),
    };
  });
}

const LONG = 7;
const FILTERS = [['all', 'All'], ['today', 'Departing today'], ['tomorrow', 'Tomorrow'], ['arriving', 'Arrived today'], ['long', 'Long stay'], ['vip', 'VIP'], ['balance', 'Balance owing'], ['company', 'Company']];
/** does a room pass a filter (today = "YYYY-MM-DD") */
function matches(r, f, today) {
  const tm = addDays(today, 1);
  switch (f) {
    case 'today': return r.departures.includes(today);
    case 'tomorrow': return r.departures.includes(tm);
    case 'arriving': return r.arrivals.includes(today);
    case 'long': return r.nights >= LONG;
    case 'vip': return !!r.vip;
    case 'balance': return r.balance > 0;
    case 'company': return !!r.company;
    default: return true;
  }
}
function searchHit(r, q) {
  q = String(q || '').trim().toLowerCase(); if (!q) return true;
  const rk = roomKey(q);
  // a short number is a room ("113" finds 0113, not confirmation 111334)
  if (/^\d{1,4}[a-z]?$/.test(q)) return r.rk === rk || r.rk.startsWith(rk) || String(r.room).toLowerCase().startsWith(q) || r.guests.some(g => g.conf === q);
  const hay = [r.room, ...r.names, r.company, r.agent, r.source, ...r.guests.map(g => g.conf), r.rateCode, r.nat, r.member].join(' \u0001 ').toLowerCase();
  return q.split(/\s+/).every(w => hay.includes(w));
}
const roomCmp = (a, b) => (parseInt(a.rk, 10) || 0) - (parseInt(b.rk, 10) || 0) || String(a.rk).localeCompare(String(b.rk));
function sortRooms(L, by) {
  const c = by === 'departure' ? (a, b) => String(a.departure || '9').localeCompare(String(b.departure || '9')) || roomCmp(a, b)
    : by === 'name' ? (a, b) => String(a.name).localeCompare(String(b.name)) || roomCmp(a, b)
    : by === 'balance' ? (a, b) => b.balance - a.balance || roomCmp(a, b)
    : roomCmp;
  return L.slice().sort(c);
}
/** the numbers on top of the page */
function summary(rooms, today) {
  const S = { rooms: rooms.length, guests: 0, adults: 0, children: 0, depToday: 0, depTomorrow: 0, arrToday: 0, long: 0, vip: 0, balance: 0, balanceRooms: 0, company: 0, members: 0, firstArr: '', lastDep: '' };
  rooms.forEach(r => {
    const pax = r.adults + r.children;
    S.adults += r.adults; S.children += r.children; S.guests += pax || r.guests.length;
    if (matches(r, 'today', today)) S.depToday++;
    if (matches(r, 'tomorrow', today)) S.depTomorrow++;
    if (matches(r, 'arriving', today)) S.arrToday++;
    if (matches(r, 'long', today)) S.long++;
    if (r.vip) S.vip++;
    if (r.company) S.company++;
    if (r.member) S.members++;
    if (r.balance > 0) { S.balance += r.balance; S.balanceRooms++; }
    if (r.arrival && (!S.firstArr || r.arrival < S.firstArr)) S.firstArr = r.arrival;
    if (r.departure && r.departure > S.lastDep) S.lastDep = r.departure;
  });
  S.balance = Math.round(S.balance * 100) / 100;
  return S;
}
/** what changed between two loads of the same day: rooms new, gone and changed */
function diff(oldRows, newRows) {
  const A = new Map(groupRooms(oldRows).map(r => [r.rk, r])), B = new Map(groupRooms(newRows).map(r => [r.rk, r]));
  const added = [], gone = [], changed = [];
  B.forEach((r, k) => { if (!A.has(k)) added.push({ room: r.room, name: r.name }); });
  A.forEach((r, k) => { if (!B.has(k)) gone.push({ room: r.room, name: r.name }); });
  B.forEach((r, k) => {
    const o = A.get(k); if (!o) return;
    const w = [];
    if (o.name !== r.name) w.push(`guest ${o.name} → ${r.name}`);
    if (o.departure !== r.departure) w.push(`departure ${fmtD(o.departure, true) || '—'} → ${fmtD(r.departure, true) || '—'}`);
    if (o.adults + o.children !== r.adults + r.children) w.push(`pax ${o.adults + o.children} → ${r.adults + r.children}`);
    if (Math.abs(o.balance - r.balance) >= 0.01) w.push(`balance ${money(o.balance)} → ${money(r.balance)}`);
    if (o.rateCode !== r.rateCode) w.push(`rate code ${o.rateCode || '—'} → ${r.rateCode || '—'}`);
    if (w.length) changed.push({ room: r.room, name: r.name, what: w });
  });
  const by = (a, b) => roomCmp({ rk: roomKey(a.room) }, { rk: roomKey(b.room) });
  return { added: added.sort(by), gone: gone.sort(by), changed: changed.sort(by) };
}
/** the public shape of one room for other modules */
function publicRoom(r) {
  if (!r) return null;
  return { room: r.room, rk: r.rk, name: r.name, names: r.names.slice(), arrival: r.arrival, departure: r.departure, nights: r.nights, adults: r.adults, children: r.children,
    balance: r.balance, vip: r.vip || '', member: r.member || '', company: r.company || '', agent: r.agent || '', rateCode: r.rateCode || '', conf: r.conf || '', nat: r.nat || '', roomType: r.roomType || '' };
}
/** "Departing tomorrow (22 Oct) · 3 rooms" + one line per room, for WhatsApp / email */
function tomorrowText(rooms, today, hotel) {
  const tm = addDays(today, 1), L = sortRooms(rooms.filter(r => matches(r, 'tomorrow', today)), 'room');
  return [`🧳 Departing tomorrow ${fmtD(tm, true)}${hotel ? ' · ' + hotel : ''} · ${L.length} room${L.length === 1 ? '' : 's'}`]
    .concat(L.map(r => `${r.room} · ${r.name}${r.adults + r.children ? ' · ' + r.adults + (r.children ? '+' + r.children : '') + ' pax' : ''}${r.balance > 0 ? ' · bal ' + money(r.balance) : ''}${r.vip ? ' · VIP' : ''}`)).join('\n');
}
/** rows for the Excel / PDF report: [head, rows] with only the columns the file had */
const REPORT_COLS = [
  ['room', 'Room', 8, r => r.room], ['name', 'Guest', 26, r => r.names.join(' / ')], ['arrival', 'Arrival', 11, r => r.arrival], ['departure', 'Departure', 11, r => r.departure],
  ['nights', 'Nights', 8, r => r.nights || ''], ['adults', 'Adults', 8, r => r.adults], ['children', 'Children', 9, r => r.children],
  ['roomType', 'Room type', 10, r => r.roomType], ['rateCode', 'Rate code', 11, r => r.rateCode], ['rate', 'Rate', 11, r => (r.rate == null ? '' : r.rate)],
  ['company', 'Company / agent', 24, r => [r.company, r.agent].filter(Boolean).join(' · ') || r.source || ''], ['market', 'Market', 9, r => r.market],
  ['vip', 'VIP', 7, r => r.vip], ['member', 'ALL member', 14, r => r.member], ['balance', 'Balance', 12, r => r.balance],
  ['conf', 'Conf. no.', 13, r => r.conf], ['nat', 'Nationality', 12, r => r.nat], ['pay', 'Payment', 11, r => r.pay], ['status', 'Status', 11, r => r.status], ['notes', 'Notes', 30, r => r.notes],
];
function reportModel(rooms, all, today, opt) {
  opt = opt || {};
  const have = f => all.some(r => { const v = r[f]; return v !== undefined && v !== '' && v !== 0 && v !== null; });
  const cols = REPORT_COLS.filter(c => ['room', 'name', 'arrival', 'departure', 'nights', 'balance'].includes(c[0]) || have(c[0]) || (c[0] === 'company' && (have('agent') || have('source'))));
  const S = summary(rooms, today);
  const L = sortRooms(rooms, opt.by || 'room');
  return {
    title: 'In-House Guests', hotel: opt.hotel || '', by: opt.user || '', date: today, report: opt.reportDate || today, scope: opt.scopeLabel || 'All rooms',
    cols: cols.map(c => c[0]), head: cols.map(c => c[1]), widths: cols.map(c => c[2]), rows: L.map(r => cols.map(c => c[3](r))),
    flags: L.map(r => (r.departures.includes(today) ? 'today' : r.departures.includes(addDays(today, 1)) ? 'tomorrow' : '')),
    kpis: [['Rooms', S.rooms, 'ink'], ['Guests', `${S.guests}${S.children ? ` (${S.adults}+${S.children})` : ''}`, 'ink'], ['Departing today', S.depToday, 'warn'], ['Departing tomorrow', S.depTomorrow, 'ink'], [`Long stays (${LONG}+ n)`, S.long, 'ok'], ['Open balances', 'AED ' + money(S.balance), S.balance > 0 ? 'bad' : 'ok']],
    total: S.balance, S,
  };
}
function fileName(hotel, day, ext) { return ('In-House Guests ' + (hotel ? hotel + ' ' : '') + fmtD(day)).replace(/[\\/:*?"<>|&]+/g, '-').replace(/\s+/g, ' ').trim() + '.' + (ext || 'xlsx'); }

const RPT_CSS = `<style>.ihr .band{display:flex;justify-content:space-between;gap:16px;align-items:flex-end;background:#1e293b;color:#fff;border-radius:12px;padding:14px 18px;border-bottom:4px solid #c9a227;margin-bottom:12px}
.ihr .band h1{margin:2px 0;font-size:21px}.ihr .h{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#f5d97a;font-weight:700}.ihr .s{color:#cbd5e1;font-size:11.5px}.ihr .m{text-align:right;color:#cbd5e1;font-size:11px}
.ihr .k{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:0 0 10px}.ihr .k div{border-radius:9px;padding:8px 10px;background:#dbeafe;color:#1e40af}.ihr .k small{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.06em;font-weight:700}.ihr .k b{font-size:18px}
.ihr .k .warn{background:#fef3c7;color:#92400e}.ihr .k .bad{background:#fee2e2;color:#991b1b}.ihr .k .ok{background:#dcfce7;color:#166534}
.ihr td,.ihr th{font-size:9.5px;padding:3px 5px}.ihr th{font-size:8.5px}.ihr tr.today td{background:#fff7e6}.ihr tr.tomorrow td{background:#eef4ff}.ihr .owe{color:#b91c1c;font-weight:700}</style>`;
const PDF_COLS = ['room', 'name', 'arrival', 'departure', 'nights', 'adults', 'children', 'rateCode', 'company', 'vip', 'member', 'balance', 'conf', 'notes'];
function reportHtml(M, tomorrowM) {
  const dateCols = ['arrival', 'departure'], numCols = ['rate', 'balance'];
  // the page is A4 landscape: the columns that matter at the desk (Excel has all of them)
  const slim = X => { const keep = X.cols.map((c, i) => (PDF_COLS.includes(c) ? i : -1)).filter(i => i >= 0); return Object.assign({}, X, { cols: keep.map(i => X.cols[i]), head: keep.map(i => X.head[i]), rows: X.rows.map(r => keep.map(i => r[i])) }); };
  M = slim(M); if (tomorrowM) tomorrowM = slim(tomorrowM);
  const table = X => `<div class="tw"><table><thead><tr>${X.head.map((h, i) => `<th${numCols.includes(X.cols[i]) ? ' class="r"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>
    ${X.rows.map((r, k) => `<tr class="${X.flags[k]}">${r.map((v, i) => { const f = X.cols[i]; if (dateCols.includes(f)) return `<td class="nw">${esc(dDot(v))}</td>`; if (numCols.includes(f)) return `<td class="r${f === 'balance' && v > 0 ? ' owe' : ''}">${v === '' ? '' : esc(money(v))}</td>`; return `<td${f === 'room' ? ' class="nw"' : ''}>${f === 'room' ? '<b>' + esc(v) + '</b>' : esc(v)}</td>`; }).join('')}</tr>`).join('') || `<tr><td colspan="${X.head.length}" class="muted">No rooms.</td></tr>`}
    </tbody></table></div>`;
  return `${RPT_CSS}<div class="ihr"><div class="band"><div><div class="h">${esc(M.hotel || 'HotelOps')}</div><h1>${esc(M.title)}</h1><div class="s">Report of ${esc(fmtD(M.report))} · ${esc(M.scope)} · printed ${esc(fmtD(M.date))}</div></div><div class="m">${M.by ? 'Prepared by<br><b>' + esc(M.by) + '</b>' : ''}</div></div>
  <div class="k">${M.kpis.map(k => `<div class="${k[2]}"><small>${esc(k[0])}</small><b>${esc(k[1])}</b></div>`).join('')}</div>
  <h2>Rooms · ${M.rows.length}</h2>${table(M)}
  ${tomorrowM && tomorrowM.rows.length ? `<h2>Departing tomorrow · ${tomorrowM.rows.length}</h2>${table(tomorrowM)}` : ''}</div>`;
}

W.hoInHousePure = { parseDate, parseMoney, roomKey, normH, mapHeader, splitRows, detect, parseReport, groupRooms, matches, searchHit, sortRooms, summary, diff, publicRoom, tomorrowText, reportModel, reportHtml, fileName, guestName, addDays, FIELDS, FILTERS, LONG };

// ══ State + public API (works without a page too: tests, other modules) ══
const I = { snap: null, rooms: [], idx: new Map(), f: 'all', q: '', by: 'room', open: '', loaded: false, err: null, lastLoad: null };
function setSnapshot(snap) {
  I.snap = snap && Array.isArray(snap.rows) ? snap : (snap && snap.rows && typeof snap.rows === 'object' ? Object.assign({}, snap, { rows: Object.values(snap.rows) }) : null);
  I.rooms = I.snap ? groupRooms(I.snap.rows) : [];
  I.idx = new Map(I.rooms.map(r => [r.rk, r]));
}
W.hoInHouse = {
  /** every room in the hotel from the last loaded report */
  rooms: () => I.rooms.map(publicRoom),
  /** one room ("0113" and "113" are the same) → { room, name, arrival, departure, … } or null */
  find: room => publicRoom(I.idx.get(roomKey(room)) || null),
  get date() { return I.snap ? I.snap.date || '' : ''; },
  get loadedAt() { return I.snap ? I.snap.at || '' : ''; },
  get by() { return I.snap ? I.snap.by || '' : ''; },
  setSnapshot,
};

if (!doc) return;

// ══ The page ════════════════════════════════════════════════
const PANEL = 'inhouse';
const ROOT = 'inhouse';
const META = 'inhouseMeta/latest';
const safe = (f, d) => { try { return f(); } catch (e) { try { console.warn('[inhouse]', e); } catch (_) {} return d; } };
const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
const today = () => (typeof hoLocalISO === 'function' ? hoLocalISO() : new Date().toISOString().slice(0, 10));
const me = () => (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || 'Front Desk';
const toast = (m, k) => safe(() => { if (typeof showToast === 'function') showToast(m, k || 'ok'); });
const act = (a, d) => safe(() => { if (typeof logActivity === 'function') logActivity(a, d); });
const can = cap => safe(() => (W.hoRoleRules && typeof W.hoRoleRules.can === 'function' ? W.hoRoleRules.can(cap) : true), true);
const canLoad = () => safe(() => !(typeof currentProfile !== 'undefined' && currentProfile && currentProfile.role === 'readonly'), true);
const deny = what => toast(what + ' is not available for your role', 'err');
const hotel = () => safe(() => { const el = doc.getElementById('hotelName'); const t = el && el.textContent.trim(); if (t) return t; const s = JSON.parse(localStorage.getItem('ibis_settings') || '{}'); return (s && s.hotelName) || ''; }, '') || '';
const dbRef = () => (typeof _ref !== 'undefined' && _ref) ? _ref : null;
const onDeps = rk => safe(() => (typeof depRooms !== 'undefined' ? depRooms : []).find(r => roomKey(r.roomStr) === rk), null);
const timeOf = iso => safe(() => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), '');
safe(() => { const v = LS.get('ih_view_v1', {}); ['f', 'by'].forEach(k => { if (typeof v[k] === 'string') I[k] = v[k]; }); });
const saveView = () => LS.set('ih_view_v1', { f: I.f, by: I.by });

const CSS = `
#ihRoot,.ih-modal,.ih-drawer{--ih-acc:var(--gold,var(--accent,#0a84ff));--ih-ok:var(--green,#16a34a);--ih-warn:var(--amber,#d97706);--ih-bad:var(--red,#dc2626);--ih-blue:var(--blue,#2563eb);
  --ih-r:16px;--ih-hair:color-mix(in srgb,var(--text) 10%,transparent);--ih-soft:color-mix(in srgb,var(--text) 4.5%,var(--card));--ih-fill:color-mix(in srgb,var(--text) 6%,transparent)}
#ihRoot{display:grid;gap:14px;min-width:0;max-width:1180px;margin:0 auto;color:var(--text)}
#ihRoot *,.ih-modal *,.ih-drawer *{box-sizing:border-box}
#ihRoot button,.ih-modal button,.ih-drawer button{font-family:inherit}
#ihRoot .page-hd{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;margin-bottom:0!important}
#ihRoot .page-hd-left{min-width:0;flex:1 1 300px}
.ih-acts{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.ih-btn{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px 14px;border-radius:999px;font:600 13.5px/1.2 var(--font,inherit);color:var(--text);background:var(--ih-fill);border:1px solid var(--ih-hair);white-space:nowrap;transition:transform .15s,filter .15s}
.ih-btn:hover{filter:brightness(1.05)}.ih-btn:active{transform:scale(.97)}
.ih-btn.pri{background:var(--ih-acc);color:var(--bg,#fff);border-color:transparent;box-shadow:0 4px 14px -6px color-mix(in srgb,var(--ih-acc) 70%,transparent)}
.ih-btn.sm{padding:6px 11px;font-size:12.5px}
.ih-btn:focus-visible,.ih-chip:focus-visible,.ih-rm:focus-visible,.ih-row:focus-visible,.ih-kpi:focus-visible{outline:2px solid var(--ih-acc);outline-offset:2px}
.ih-meta{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;font-size:12.5px;color:var(--text2)}
.ih-meta b{color:var(--text);font-weight:650}
.ih-stale{display:flex;gap:10px;align-items:flex-start;background:color-mix(in srgb,var(--ih-warn) 10%,var(--card));border:1px solid color-mix(in srgb,var(--ih-warn) 35%,transparent);border-radius:var(--ih-r);padding:11px 14px;font-size:13.5px;line-height:1.45}
.ih-err{background:color-mix(in srgb,var(--ih-bad) 9%,var(--card));border:1px solid color-mix(in srgb,var(--ih-bad) 35%,transparent);border-radius:var(--ih-r);padding:12px 14px;font-size:13.5px;line-height:1.5;overflow-wrap:anywhere}
.ih-err b{color:var(--ih-bad)}.ih-err ul{margin:6px 0 0;padding-left:18px}.ih-err code{font-family:var(--mono,ui-monospace,monospace);font-size:12px}
.ih-kpis{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px}
.ih-kpi{all:unset;box-sizing:border-box;cursor:pointer;background:var(--card);border:1px solid var(--ih-hair);border-radius:var(--ih-r);padding:10px 12px;min-width:0;box-shadow:0 1px 2px rgba(0,0,0,.04);transition:border-color .15s}
.ih-kpi:hover,.ih-kpi.on{border-color:color-mix(in srgb,var(--ih-acc) 55%,transparent)}
.ih-kpi{display:flex;flex-direction:column;justify-content:space-between}
.ih-kpi small{display:block;font:600 10.5px/1.25 var(--font,inherit);letter-spacing:.04em;text-transform:uppercase;color:var(--text3);overflow-wrap:anywhere}
.ih-kpi b{display:block;font:700 22px/1.15 var(--font,inherit);margin-top:3px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ih-kpi i{display:block;font-style:normal;font-size:11.5px;color:var(--text2);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ih-kpi.warn b{color:var(--ih-warn)}.ih-kpi.bad b{color:var(--ih-bad)}.ih-kpi.ok b{color:var(--ih-ok)}.ih-kpi.blue b{color:var(--ih-blue)}
.ih-tb{display:flex;flex-wrap:wrap;gap:8px;align-items:center;min-width:0}
.ih-search{flex:1 1 240px;min-width:0}
.ih-in,.ih-sel,.ih-ta{width:100%;background:var(--ih-soft);color:var(--text);border:1px solid var(--ih-hair);border-radius:11px;padding:9px 12px;font:14px var(--font,inherit);margin:0;min-width:0;color-scheme:light dark}
.ih-in:focus,.ih-sel:focus,.ih-ta:focus{outline:none;border-color:var(--ih-acc);box-shadow:0 0 0 3px color-mix(in srgb,var(--ih-acc) 22%,transparent)}
.ih-tb .ih-sel{width:auto;flex:0 1 auto;padding:8px 10px;font-size:13px}
.ih-ta{min-height:180px;font:12px/1.45 var(--mono,ui-monospace,monospace);resize:vertical;white-space:pre;overflow:auto}
.ih-seg{display:flex;gap:4px;padding:3px;background:var(--ih-fill);border-radius:12px;overflow-x:auto;scrollbar-width:none;max-width:100%}
.ih-seg::-webkit-scrollbar{display:none}
.ih-chip{all:unset;cursor:pointer;padding:6px 11px;border-radius:9px;font:600 12.5px var(--font,inherit);color:var(--text2);white-space:nowrap}
.ih-chip.on{background:var(--card);color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.ih-chip i{font-style:normal;opacity:.6;margin-left:4px;font-variant-numeric:tabular-nums}
.ih-tmr{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;background:color-mix(in srgb,var(--ih-blue) 8%,var(--card));border:1px solid color-mix(in srgb,var(--ih-blue) 28%,transparent);border-radius:var(--ih-r);padding:10px 14px;font-size:13.5px}
.ih-table{background:var(--card);border:1px solid var(--ih-hair);border-radius:var(--ih-r);overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.ih-row,.ih-th{display:grid;grid-template-columns:78px minmax(0,2.3fr) minmax(0,1.5fr) minmax(0,1.6fr) 118px;gap:12px;align-items:center;padding:10px 14px;min-width:0}
.ih-th{font:600 10.5px/1.2 var(--font,inherit);letter-spacing:.05em;text-transform:uppercase;color:var(--text3);background:var(--ih-soft);border-bottom:1px solid var(--ih-hair);padding-top:9px;padding-bottom:9px}
.ih-th .r,.ih-row .ih-bal{text-align:right}
.ih-row{border-bottom:1px solid var(--ih-hair);cursor:pointer;transition:background .12s}
.ih-row:last-child{border-bottom:0}
.ih-row:hover{background:var(--ih-soft)}
.ih-row.dep-today{box-shadow:inset 3px 0 0 var(--ih-warn)}.ih-row.dep-tomorrow{box-shadow:inset 3px 0 0 var(--ih-blue)}
.ih-rm{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:4px;min-width:58px;padding:6px 8px;border-radius:10px;font:700 15px/1 var(--mono,ui-monospace,monospace);background:var(--ih-fill);color:var(--text);font-variant-numeric:tabular-nums}
.ih-rm.dep{background:color-mix(in srgb,var(--ih-acc) 16%,transparent);color:var(--text)}
.ih-rm.dep::after{content:"🧳";font-size:11px}
.ih-c{min-width:0;display:grid;gap:2px}
.ih-nm{font:650 14.5px/1.3 var(--font,inherit);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ih-sub{font-size:12.5px;color:var(--text2);line-height:1.4;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ih-sub.dim{color:var(--text3)}
.ih-tags{display:flex;gap:4px;flex-wrap:wrap;min-width:0}
.ih-tag{display:inline-flex;align-items:center;padding:1px 7px;border-radius:999px;font:700 10.5px/1.6 var(--font,inherit);white-space:nowrap;background:var(--ih-fill);color:var(--text2)}
.ih-tag.vip{background:color-mix(in srgb,var(--ih-acc) 18%,transparent);color:var(--text)}
.ih-tag.all{background:color-mix(in srgb,var(--ih-ok) 14%,transparent);color:var(--ih-ok)}
.ih-tag.long{background:color-mix(in srgb,var(--ih-blue) 13%,transparent);color:var(--ih-blue)}
.ih-tag.today{background:color-mix(in srgb,var(--ih-warn) 16%,transparent);color:var(--ih-warn)}
.ih-tag.tmr{background:color-mix(in srgb,var(--ih-blue) 13%,transparent);color:var(--ih-blue)}
.ih-bal{font:650 13.5px/1.2 var(--font,inherit);font-variant-numeric:tabular-nums;white-space:nowrap}
.ih-bal.owe{color:var(--ih-bad)}.ih-bal.zero{color:var(--text3);font-weight:500}
.ih-bal small{display:block;font:500 11px var(--font,inherit);color:var(--text3)}
.ih-empty{text-align:center;color:var(--text2);padding:34px 16px;background:var(--card);border:1px dashed var(--ih-hair);border-radius:var(--ih-r);line-height:1.6}
.ih-empty b{display:block;font-size:16px;color:var(--text);margin-bottom:4px}
.ih-drop{border:2px dashed color-mix(in srgb,var(--ih-acc) 55%,transparent);border-radius:var(--ih-r);padding:26px 16px;text-align:center;background:color-mix(in srgb,var(--ih-acc) 6%,var(--card));line-height:1.6;color:var(--text2)}
.ih-drop b{display:block;color:var(--text);font-size:16px}
#panel-inhouse.ih-dragging #ihRoot{outline:3px dashed var(--ih-acc);outline-offset:6px;border-radius:12px}
.ih-modal{position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:18px;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.ih-sheet{background:var(--card,#fff);color:var(--text);border:1px solid var(--ih-hair);border-radius:20px;width:100%;max-width:680px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 30px 80px -20px rgba(0,0,0,.45);min-width:0}
.ih-sh-hd{display:flex;align-items:center;gap:10px;padding:16px 18px 12px;border-bottom:1px solid var(--ih-hair)}
.ih-sh-hd b{flex:1;font:700 17px var(--font,inherit);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ih-x{all:unset;cursor:pointer;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--ih-fill);color:var(--text2);flex:0 0 auto}
.ih-sh-bd{padding:14px 18px;overflow-y:auto;overflow-x:hidden;display:grid;gap:12px;min-width:0;font-size:13.5px;line-height:1.5}
.ih-sh-ft{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;padding:12px 18px 16px;border-top:1px solid var(--ih-hair)}
.ih-sum{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.ih-sum div{background:var(--ih-soft);border-radius:12px;padding:9px 11px;min-width:0}.ih-sum small{display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);font-weight:600}.ih-sum b{font-size:19px;font-variant-numeric:tabular-nums}
.ih-cols{display:flex;flex-wrap:wrap;gap:5px}.ih-cols span{font-size:11.5px;padding:2px 8px;border-radius:999px;background:var(--ih-fill);color:var(--text2);overflow-wrap:anywhere}.ih-cols span b{color:var(--text);font-weight:650}
.ih-diff{display:grid;gap:8px}.ih-diff h4{margin:0;font:700 13px var(--font,inherit)}.ih-diff ul{margin:0;padding-left:18px;max-height:180px;overflow:auto}
.ih-diff .add{color:var(--ih-ok)}.ih-diff .gone{color:var(--ih-bad)}.ih-diff .chg{color:var(--ih-warn)}
.ih-note{font-size:12.5px;color:var(--text2)}
.ih-radios{display:grid;gap:6px}.ih-radios label{display:flex;gap:8px;align-items:center;padding:8px 10px;border-radius:10px;background:var(--ih-soft);cursor:pointer}
.ih-drawer{position:fixed;top:0;right:0;bottom:0;z-index:10040;width:min(460px,100vw);background:var(--card,#fff);color:var(--text);border-left:1px solid var(--ih-hair);box-shadow:-30px 0 80px -30px rgba(0,0,0,.45);display:flex;flex-direction:column;animation:ihIn .22s ease}
@keyframes ihIn{from{transform:translateX(30px);opacity:0}to{transform:none;opacity:1}}
.ih-dr-bd{padding:14px 18px 22px;overflow-y:auto;display:grid;gap:14px;min-width:0}
.ih-hero{display:flex;gap:12px;align-items:center;min-width:0}
.ih-hero .ih-rm{font-size:19px;padding:10px 12px;min-width:74px}
.ih-hero h3{margin:0;font:700 18px/1.25 var(--font,inherit);overflow-wrap:anywhere}
.ih-dl{display:grid;grid-template-columns:minmax(96px,38%) minmax(0,1fr);gap:0;border:1px solid var(--ih-hair);border-radius:12px;overflow:hidden}
.ih-dl dt,.ih-dl dd{margin:0;padding:7px 11px;border-bottom:1px solid var(--ih-hair);font-size:13px;min-width:0;overflow-wrap:anywhere}
.ih-dl dt{color:var(--text3);background:var(--ih-soft);font-weight:600}
.ih-dl dt:nth-last-of-type(1),.ih-dl dd:last-of-type{border-bottom:0}
.ih-sec{font:700 12px var(--font,inherit);text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin:2px 0 -6px}
.ih-dr-acts{display:flex;gap:8px;flex-wrap:wrap}
@media (max-width:1100px){.ih-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media (max-width:760px){
  .ih-kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .ih-kpi:last-child:nth-child(odd){grid-column:span 2}
  .ih-kpi b{font-size:20px}
  .ih-th{display:none}
  .ih-row{grid-template-columns:66px minmax(0,1fr) auto;grid-template-areas:"rm nm bal" "rm st bal" "rm co co";gap:3px 10px;padding:11px 12px;align-items:start}
  .ih-row>.ih-rmc{grid-area:rm}.ih-row>.c1{grid-area:nm}.ih-row>.c2{grid-area:st}.ih-row>.c3{grid-area:co}.ih-row>.ih-bal{grid-area:bal}
  .ih-rm{min-width:56px;font-size:14px}
  .ih-sum{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ih-modal{align-items:flex-end;padding:0}
  .ih-sheet{border-radius:20px 20px 0 0;max-height:92vh}
  .ih-drawer{top:auto;left:0;width:100vw;max-height:90vh;border-left:0;border-top:1px solid var(--ih-hair);border-radius:20px 20px 0 0;animation:ihUp .22s ease}
  #ihRoot .page-hd h1{font-size:22px}
}
@keyframes ihUp{from{transform:translateY(30px);opacity:0}to{transform:none;opacity:1}}
`;

// ── drawing ──
function depTag(r, t) {
  if (r.departures.includes(t)) return '<span class="ih-tag today">Departs today</span>';
  if (r.departures.includes(addDays(t, 1))) return '<span class="ih-tag tmr">Departs tomorrow</span>';
  return '';
}
function rowHtml(r, t) {
  const d = onDeps(r.rk), pax = r.adults + r.children;
  const cls = r.departures.includes(t) ? ' dep-today' : r.departures.includes(addDays(t, 1)) ? ' dep-tomorrow' : '';
  const left = r.departure ? diffDays(t, r.departure) : null;
  const leftTxt = left == null ? '' : left < 0 ? 'past departure' : left === 0 ? 'leaves today' : left === 1 ? '1 night left' : left + ' nights left';
  const tags = [r.vip ? `<span class="ih-tag vip">VIP ${esc(r.vip.length <= 4 ? r.vip : '')}</span>` : '', r.member ? '<span class="ih-tag all">ALL</span>' : '', r.nights >= LONG ? `<span class="ih-tag long">${r.nights} n</span>` : '', depTag(r, t), r.guests.length > 1 ? `<span class="ih-tag">+${r.guests.length - 1} sharer${r.guests.length > 2 ? 's' : ''}</span>` : ''].join('');
  return `<div class="ih-row${cls}" role="button" tabindex="0" data-ih="open" data-rk="${esc(r.rk)}">
    <div class="ih-rmc"><button type="button" class="ih-rm${d ? ' dep' : ''}" data-ih="${d ? 'dep' : 'open'}" data-rk="${esc(r.rk)}" title="${d ? 'Open room ' + esc(r.room) + ' on Departures' : 'Room ' + esc(r.room)}" aria-label="${d ? 'Open room ' + esc(r.room) + ' on Departures' : 'Room ' + esc(r.room)}">${esc(r.room)}</button></div>
    <div class="ih-c c1"><div class="ih-nm">${esc(r.name)}</div>${tags ? `<div class="ih-tags">${tags}</div>` : ''}</div>
    <div class="ih-c c2"><div class="ih-sub">${esc(fmtD(r.arrival, true) || r.guests[0].arrRaw || '—')} → <b>${esc(fmtD(r.departure, true) || r.guests[0].depRaw || '—')}</b>${r.nights ? ` · ${r.nights} n` : ''}</div><div class="ih-sub dim">${esc(leftTxt)}${pax ? ` · ${r.adults}${r.children ? '+' + r.children : ''} pax` : ''}${r.roomType ? ' · ' + esc(r.roomType) : ''}</div></div>
    <div class="ih-c c3"><div class="ih-sub">${esc(r.company || r.agent || r.source || '—')}</div><div class="ih-sub dim">${esc([r.rateCode, r.market, r.conf ? '#' + r.conf : ''].filter(Boolean).join(' · '))}</div></div>
    <div class="ih-bal${r.balance > 0 ? ' owe' : r.balance === 0 ? ' zero' : ''}">${r.balance ? 'AED ' + esc(money(r.balance)) : '—'}${r.balance < 0 ? '<small>credit</small>' : r.balance > 0 ? '<small>balance</small>' : ''}</div>
  </div>`;
}
function render() {
  const root = doc.getElementById('ihRoot'); if (!root) return;
  const t = today(), S = summary(I.rooms, t);
  const shown = sortRooms(I.rooms.filter(r => matches(r, I.f, t) && searchHit(r, I.q)), I.by);
  const cnt = f => I.rooms.filter(r => matches(r, f, t)).length;
  const focus = doc.activeElement && doc.activeElement.id === 'ihQ' ? [doc.activeElement.selectionStart, doc.activeElement.selectionEnd] : null;
  const snap = I.snap, stale = snap && snap.date && snap.date < t;
  const loadBtns = canLoad() ? `<button type="button" class="ih-btn pri" data-ih="browse" id="ihLoadBtn">⬆ Load in-house report</button><button type="button" class="ih-btn" data-ih="paste">📋 Paste</button>` : '';
  const kpi = (f, cls, label, val, sub) => `<button type="button" class="ih-kpi ${cls}${I.f === f && f !== 'all' ? ' on' : ''}" data-ih="f" data-f="${f}"><small>${label}</small><b>${val}</b><i>${sub}</i></button>`;
  root.innerHTML = `
  <div class="page-hd"><div class="page-hd-left"><h1>🛏️ In-House Guests</h1><p>Who is staying tonight, from the Opera Cloud in-house report (Delimited Data). Shared with the team, one list per day.</p></div>
    <div class="ih-acts">${loadBtns}${can('canExport') && snap ? '<button type="button" class="ih-btn" data-ih="export" id="ihExport">⬇ Export</button>' : ''}</div></div>
  <input type="file" id="ihFileInput" accept=".txt,.csv,.tsv,.xls,.xlsx,text/plain,text/csv" hidden>
  ${I.err ? errHtml(I.err) : ''}
  ${snap ? `<div class="ih-meta"><span>Report of <b>${esc(fmtD(snap.date))}</b></span><span>loaded ${esc(timeOf(snap.at))}${snap.by ? ' by <b>' + esc(snap.by) + '</b>' : ''}</span>${snap.file ? `<span>${esc(snap.file)}</span>` : ''}<span>${S.firstArr ? `arrivals ${esc(fmtD(S.firstArr, true))} – departures ${esc(fmtD(S.lastDep, true))}` : ''}</span></div>` : ''}
  ${stale ? `<div class="ih-stale" role="status"><span aria-hidden="true">⏳</span><div>This list is from <b>${esc(fmtD(snap.date))}</b>. Load today's in-house report so departures and balances are up to date.</div></div>` : ''}
  ${snap ? `<div class="ih-kpis" id="ihKpis">
    ${kpi('all', '', 'Rooms occupied', S.rooms, `${S.guests} guest${S.guests === 1 ? '' : 's'}`)}
    ${kpi('all', '', 'Guests', S.guests, S.adults || S.children ? `${S.adults} adult${S.adults === 1 ? '' : 's'} · ${S.children} child${S.children === 1 ? '' : 'ren'}` : 'from the rows')}
    ${kpi('today', S.depToday ? 'warn' : '', 'Departing today', S.depToday, fmtD(t, true))}
    ${kpi('tomorrow', S.depTomorrow ? 'blue' : '', 'Departing tomorrow', S.depTomorrow, fmtD(addDays(t, 1), true))}
    ${kpi('long', S.long ? 'ok' : '', 'Long stays', S.long, `${LONG}+ nights`)}
    ${kpi('vip', '', 'VIP', S.vip, S.members ? `${S.members} ALL member${S.members === 1 ? '' : 's'}` : 'rooms')}
    ${kpi('balance', S.balance > 0 ? 'bad' : '', 'Open balances', esc(Math.round(S.balance).toLocaleString('en-US')), `AED · ${S.balanceRooms} room${S.balanceRooms === 1 ? '' : 's'}`)}
  </div>
  <div class="ih-tb">
    <div class="ih-search"><input id="ihQ" class="ih-in" type="search" placeholder="Search room, name, company, confirmation…" value="${esc(I.q)}" autocomplete="off" aria-label="Search in-house guests"></div>
    <select id="ihBy" class="ih-sel" aria-label="Sort">${[['room', 'Sort: room'], ['departure', 'Sort: departure'], ['name', 'Sort: name'], ['balance', 'Sort: balance']].map(([k, l]) => `<option value="${k}"${I.by === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
  </div>
  <div class="ih-seg" role="tablist" aria-label="Show">${FILTERS.map(([k, l]) => `<button type="button" role="tab" class="ih-chip${I.f === k ? ' on' : ''}" aria-selected="${I.f === k}" data-ih="f" data-f="${k}">${l}<i>${cnt(k)}</i></button>`).join('')}</div>
  ${I.f === 'tomorrow' && cnt('tomorrow') ? `<div class="ih-tmr"><span>🧳 <b>${cnt('tomorrow')}</b> room${cnt('tomorrow') === 1 ? '' : 's'} depart tomorrow, ${esc(fmtD(addDays(t, 1)))}.</span><span class="ih-acts"><button type="button" class="ih-btn sm" data-ih="copyTmr">Copy list</button>${can('canExport') ? '<button type="button" class="ih-btn sm" data-ih="xlTmr">⬇ Excel</button>' : ''}</span></div>` : ''}
  <div class="ih-table" id="ihList">${shown.length ? `<div class="ih-th" aria-hidden="true"><span>Room</span><span>Guest</span><span>Stay</span><span>Company · rate</span><span class="r">Balance</span></div>${shown.map(r => rowHtml(r, t)).join('')}`
    : `<div class="ih-empty"><b>No room matches</b>Change the search or the filter.</div>`}</div>`
  : `<div class="ih-drop" id="ihDrop"><b>No in-house list yet</b>In Opera Cloud run the in-house guests report and choose <b style="display:inline;font-size:inherit">Delimited Data</b> (or CSV), then load the file here, drop it on this page, or paste it.${canLoad() ? '<div style="margin-top:12px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button type="button" class="ih-btn pri" data-ih="browse">⬆ Load in-house report</button><button type="button" class="ih-btn" data-ih="paste">📋 Paste</button></div>' : ''}</div>`}`;
  if (focus) { const q = doc.getElementById('ihQ'); if (q) { q.focus(); try { q.setSelectionRange(focus[0], focus[1]); } catch (_) {} } }
  badge();
}
function errHtml(e) {
  return `<div class="ih-err" role="alert"><b>No rooms found${e.file ? ' in ' + esc(e.file) : ''}.</b><ul>${e.errors.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    <div class="ih-note" style="margin-top:6px">The report needs a header row with a <code>Room</code> column and a guest name or the dates (Arrival / Departure). Export it from Opera Cloud as <b>Delimited Data</b> or CSV. <button type="button" class="ih-btn sm" data-ih="errx">Dismiss</button></div></div>`;
}
let softT = 0;
function soon() {
  clearTimeout(softT);
  softT = setTimeout(() => safe(() => {
    badge();
    const p = doc.getElementById('panel-' + PANEL); if (!p || !p.classList.contains('active')) return;
    const a = doc.activeElement; if (a && a.id !== 'ihQ' && p.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) { softT = setTimeout(soon, 1500); return; }
    render();
    if (I.open && doc.getElementById('ih-drawer')) openRoom(I.open);
  }), 120);
}
function badge() {
  const n = I.rooms.filter(r => matches(r, 'today', today())).length;
  [doc.getElementById('badge-' + PANEL), doc.getElementById('mob-badge-' + PANEL)].forEach(b => { if (!b) return; b.textContent = n ? String(n) : ''; b.style.display = n ? '' : 'none'; b.title = n ? n + ' departing today' : ''; });
}

// ── modal + drawer ──
function closeModal() { const m = doc.getElementById('ih-modal'); if (m) m.remove(); }
function openModal(title, body, foot, onClick) {
  closeModal();
  const m = doc.createElement('div'); m.className = 'ih-modal'; m.id = 'ih-modal';
  m.innerHTML = `<div class="ih-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="ih-sh-hd"><b>${esc(title)}</b><button type="button" class="ih-x" data-m="close" aria-label="Close">✕</button></div><div class="ih-sh-bd">${body}</div>${foot ? `<div class="ih-sh-ft">${foot}</div>` : ''}</div>`;
  m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-m="close"]')) { closeModal(); return; } if (onClick) safe(() => onClick(e, m)); });
  doc.body.appendChild(m);
  return m;
}
function closeDrawer() { const d = doc.getElementById('ih-drawer'); if (d) d.remove(); I.open = ''; }
function openRoom(rk) {
  const r = I.idx.get(rk); if (!r) { closeDrawer(); return; }
  I.open = rk;
  const t = today(), d = onDeps(rk);
  const row = (k, v) => (v === '' || v == null ? '' : `<dt>${esc(k)}</dt><dd>${v}</dd>`);
  const guestDl = g => `<dl class="ih-dl">${[
    row('Guest', esc([g.title, g.name].filter(Boolean).join(' '))),
    row('Arrival', esc(g.arrival ? fmtD(g.arrival) : g.arrRaw || '')), row('Departure', esc(g.departure ? fmtD(g.departure) : g.depRaw || '') + (g.depTime ? ' · ' + esc(g.depTime) : '')),
    row('Nights', g.nights || ''), row('Adults / children', g.adults || g.children ? `${g.adults} / ${g.children}` : ''),
    row('Room type', esc(g.roomType || '')), row('Rate code', esc(g.rateCode || '')), row('Rate', g.rate != null ? 'AED ' + esc(money(g.rate)) : ''),
    row('Company', esc(g.company || '')), row('Travel agent', esc(g.agent || '')), row('Source', esc(g.source || '')), row('Market', esc(g.market || '')), row('Source code', esc(g.sourceCode || '')),
    row('Balance', g.balance ? `<b style="color:${g.balance > 0 ? 'var(--ih-bad)' : 'inherit'}">AED ${esc(money(g.balance))}</b>` : ''),
    row('VIP', esc(g.vip || '')), row('Membership (ALL)', esc(g.member || '')), row('Confirmation', esc(g.conf || '')), row('Nationality', esc(g.nat || '')),
    row('Payment', esc(g.pay || '')), row('Status', esc(g.status || '')), row('Notes', esc(g.notes || '')),
  ].join('')}</dl>${g.extra ? `<div class="ih-sec">Other columns</div><dl class="ih-dl">${Object.keys(g.extra).map(k => row(k.replace(/_/g, ' '), esc(g.extra[k]))).join('')}</dl>` : ''}`;
  let dr = doc.getElementById('ih-drawer');
  if (!dr) { dr = doc.createElement('div'); dr.className = 'ih-drawer'; dr.id = 'ih-drawer'; dr.setAttribute('role', 'dialog'); dr.setAttribute('aria-modal', 'false'); doc.body.appendChild(dr); dr.addEventListener('click', drawerClick); }
  dr.setAttribute('aria-label', 'Room ' + r.room);
  dr.innerHTML = `<div class="ih-sh-hd"><b>Room ${esc(r.room)}</b><button type="button" class="ih-x" data-d="close" aria-label="Close">✕</button></div>
  <div class="ih-dr-bd">
    <div class="ih-hero"><span class="ih-rm${d ? ' dep' : ''}">${esc(r.room)}</span><div style="min-width:0"><h3>${esc(r.names.join(' · '))}</h3><div class="ih-tags" style="margin-top:4px">${depTag(r, t)}${r.vip ? '<span class="ih-tag vip">VIP</span>' : ''}${r.member ? '<span class="ih-tag all">ALL member</span>' : ''}${r.nights >= LONG ? `<span class="ih-tag long">Long stay · ${r.nights} n</span>` : ''}</div></div></div>
    <div class="ih-dr-acts">${d ? `<button type="button" class="ih-btn sm pri" data-d="dep">🧳 Open on Departures</button>` : (canLoad() && typeof depAddManualRoom === 'function' ? '<button type="button" class="ih-btn sm" data-d="add">+ Add to today\'s departures</button>' : '')}<button type="button" class="ih-btn sm" data-d="copy">Copy</button></div>
    ${r.guests.map((g, i) => (r.guests.length > 1 ? `<div class="ih-sec">${i ? 'Sharer ' + i : 'Main guest'}</div>` : '') + guestDl(g)).join('')}
    <div class="ih-note">From the in-house report of ${esc(fmtD(I.snap && I.snap.date))}.</div>
  </div>`;
}
function drawerClick(e) {
  safe(() => {
    const b = e.target.closest('[data-d]'); if (!b) return;
    const r = I.idx.get(I.open);
    if (b.dataset.d === 'close') closeDrawer();
    else if (b.dataset.d === 'dep' && r) { closeDrawer(); goDeparture(r.rk); }
    else if (b.dataset.d === 'add' && r) { if (depAddManualRoom(r.room, r.name)) { toast(`Room ${r.room} added to today's departures`); act('inhouse_to_departures', `Room ${r.room}`); openRoom(r.rk); render(); } }
    else if (b.dataset.d === 'copy' && r) copyText(`Room ${r.room} · ${r.names.join(' / ')} · ${fmtD(r.arrival, true)} → ${fmtD(r.departure, true)}${r.nights ? ' (' + r.nights + ' n)' : ''}${r.balance ? ' · balance AED ' + money(r.balance) : ''}${r.company ? ' · ' + r.company : ''}${r.conf ? ' · #' + r.conf : ''}`);
  });
}
function goDeparture(rk) {
  const d = onDeps(rk); if (!d) return;
  if (typeof showPanel === 'function') showPanel('departures');
  setTimeout(() => safe(() => { if (typeof depJumpTo === 'function') depJumpTo(d.roomStr, 'all', String(d.roomStr)); }), 120);
}
function copyText(s) {
  const done = () => toast('Copied ✓');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(done, () => fallback());
  else fallback();
  function fallback() { const ta = doc.createElement('textarea'); ta.value = s; ta.style.cssText = 'position:fixed;opacity:0'; doc.body.appendChild(ta); ta.select(); try { doc.execCommand('copy'); done(); } catch (_) { toast('Could not copy', 'err'); } ta.remove(); }
}

// ── loading a report ──
async function fileText(file) {
  const name = file.name || '';
  if (/\.pdf$/i.test(name)) throw new Error('A PDF can’t be read here. In Opera Cloud export the in-house report as Delimited Data (.txt) or CSV.');
  if (/\.(xlsx|xls)$/i.test(name)) {
    if (typeof XLSX === 'undefined' || !XLSX.read) throw new Error('The Excel reader is still loading. Try again in a moment, or export as Delimited Data.');
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
    let best = '';
    wb.SheetNames.forEach(n => { const csv = XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: '\t' }); if (parseReport(csv).rows.length > parseReport(best).rows.length) best = csv; });
    return best;
  }
  return file.text();
}
async function loadFile(file) {
  if (!file) return;
  if (!canLoad()) return deny('Loading the in-house list');
  let text = '';
  try { text = await fileText(file); } catch (e) { I.err = { file: file.name, errors: [e.message || 'Could not read the file.'] }; render(); toast(e.message || 'Could not read the file', 'err'); return; }
  loadText(text, file.name);
}
function loadText(text, src) {
  const P = parseReport(text);
  if (!P.rows.length) {
    I.err = { file: src || '', errors: P.errors.length ? P.errors : ['No rooms found.'] };
    render(); toast(`No in-house rooms found${src ? ' in ' + src : ''}`, 'err');
    return null;
  }
  I.err = null;
  preview(P, src || 'pasted text');
  return P;
}
function preview(P, src) {
  const t = today(), rooms = groupRooms(P.rows), S = summary(rooms, t);
  const same = I.snap && I.snap.date === t ? I.snap : null;
  const D = same ? diff(same.rows, P.rows) : null;
  const li = (L, cls, f) => L.length ? `<ul class="${cls}">${L.slice(0, 60).map(f).join('')}${L.length > 60 ? `<li>… and ${L.length - 60} more</li>` : ''}</ul>` : '';
  const body = `<div class="ih-sum"><div><small>Rooms</small><b>${S.rooms}</b></div><div><small>Guests</small><b>${S.guests}</b></div><div><small>Departing today</small><b>${S.depToday}</b></div><div><small>Open balances</small><b style="font-size:15px">AED ${esc(money(S.balance))}</b></div></div>
    <div class="ih-note">${esc(src)} · ${P.rows.length} line${P.rows.length === 1 ? '' : 's'} (${P.delim} separated)${S.firstArr ? ` · arrivals from ${esc(fmtD(S.firstArr))}, departures until ${esc(fmtD(S.lastDep))}` : ''}${P.skipped ? ` · ${P.skipped} line${P.skipped === 1 ? '' : 's'} without a room skipped (totals, titles)` : ''}${P.stitched ? ` · ${P.stitched} broken line${P.stitched === 1 ? '' : 's'} joined` : ''}.</div>
    ${D ? `<div class="ih-diff"><h4>Compared with the list loaded at ${esc(timeOf(same.at))}${same.by ? ' by ' + esc(same.by) : ''}</h4>
      ${!D.added.length && !D.gone.length && !D.changed.length ? '<div class="ih-note">Nothing changed.</div>' : ''}
      ${D.added.length ? `<div class="add"><b>+ ${D.added.length} new room${D.added.length === 1 ? '' : 's'}</b></div>${li(D.added, '', x => `<li>${esc(x.room)} · ${esc(x.name)}</li>`)}` : ''}
      ${D.gone.length ? `<div class="gone"><b>− ${D.gone.length} room${D.gone.length === 1 ? '' : 's'} gone</b></div>${li(D.gone, '', x => `<li>${esc(x.room)} · ${esc(x.name)}</li>`)}` : ''}
      ${D.changed.length ? `<div class="chg"><b>${D.changed.length} changed</b></div>${li(D.changed, '', x => `<li>${esc(x.room)} · ${esc(x.what.join(', '))}</li>`)}` : ''}</div>` : ''}
    <div><div class="ih-sec" style="margin-bottom:6px">Columns read</div><div class="ih-cols">${P.cols.map(c => `<span><b>${esc(c.label)}</b> ← ${esc(c.h)}</span>`).join('')}</div>
    ${P.extraCols.length ? `<div class="ih-note" style="margin-top:6px">Also kept (shown in each guest's window): ${esc(P.extraCols.join(', '))}</div>` : ''}</div>
    <div class="ih-note">Saved for the whole team as the in-house list of <b>${esc(fmtD(t))}</b>${same ? ', replacing the one loaded earlier today' : ''}.</div>`;
  const m = openModal(same ? 'Load again: what changed' : 'In-house report', body,
    `<button type="button" class="ih-btn" data-m="close">Cancel</button><button type="button" class="ih-btn pri" data-p="save">${same ? 'Replace list' : 'Save list'}</button>`,
    e => { if (e.target.closest('[data-p="save"]')) { closeModal(); save(P, src, D); } });
  const b = m.querySelector('[data-p="save"]'); if (b) setTimeout(() => safe(() => b.focus()), 30);
}
function save(P, src, D) {
  const t = today(), at = new Date().toISOString();
  const rows = JSON.parse(JSON.stringify(P.rows));
  const snap = { date: t, at, by: me(), file: String(src || '').slice(0, 120), cols: P.cols.map(c => ({ f: c.f, h: c.h })), extraCols: P.extraCols.slice(0, 80), rows };
  const rooms = groupRooms(rows), S = summary(rooms, t);
  const meta = { date: t, at, by: snap.by, rooms: S.rooms, guests: S.guests };
  setSnapshot(snap); I.loaded = true; I.err = null;
  if (typeof fbSet === 'function') {
    safe(() => Promise.resolve(fbSet(ROOT + '/' + t, snap)).then(() => fbSet(META, meta)).catch(() => toast('Could not save – check the connection', 'err')));
  } else LS.set('ih_snap_local', snap);
  render();
  toast(`✓ In-house list saved · ${S.rooms} rooms · ${S.guests} guests${D ? ` · +${D.added.length} −${D.gone.length} ~${D.changed.length}` : ''}`);
  act('inhouse_loaded', `${S.rooms} rooms, ${S.guests} guests${D ? ' (replaced)' : ''}`);
}
function pasteDialog() {
  if (!canLoad()) return deny('Loading the in-house list');
  const m = openModal('Paste the in-house report', `<div class="ih-note">In Opera Cloud open the in-house report as <b>Delimited Data</b> (or CSV), select all, copy, and paste it here with the header line.</div><textarea id="ihPaste" class="ih-ta" spellcheck="false" placeholder="ROOM	GUEST_NAME	ARRIVAL	DEPARTURE	ADULTS	…"></textarea>`,
    `<button type="button" class="ih-btn" data-m="close">Cancel</button><button type="button" class="ih-btn pri" data-p="read">Read</button>`,
    (e, m2) => { if (!e.target.closest('[data-p="read"]')) return; const v = m2.querySelector('#ihPaste').value; if (!v.trim()) { toast('Paste the report first', 'warn'); return; } closeModal(); loadText(v, 'pasted text'); });
  setTimeout(() => safe(() => m.querySelector('#ihPaste').focus()), 30);
}

// ── export ──
const SCOPES = { view: 'What is on screen', all: 'All rooms', today: 'Departing today', tomorrow: 'Departing tomorrow', balance: 'Balance owing', long: 'Long stays' };
function scoped(scope) {
  const t = today();
  if (scope === 'view') return I.rooms.filter(r => matches(r, I.f, t) && searchHit(r, I.q));
  if (scope === 'all') return I.rooms.slice();
  return I.rooms.filter(r => matches(r, scope, t));
}
const modelFor = scope => {
  const t = today();
  const label = scope === 'view' ? ((FILTERS.find(f => f[0] === I.f) || [, 'All'])[1] + (I.q ? ` · “${I.q}”` : '')) : SCOPES[scope];
  return reportModel(scoped(scope), I.rooms, t, { hotel: hotel(), user: me(), reportDate: I.snap && I.snap.date, scopeLabel: label, by: scope === 'view' ? I.by : 'room' });
};
function exportDialog() {
  if (!can('canExport')) return deny('Downloading files');
  if (!I.snap) { toast('Load the in-house report first', 'warn'); return; }
  const n = k => scoped(k).length;
  openModal('Export · In-house guests', `<div class="ih-radios">${Object.keys(SCOPES).map((k, i) => `<label><input type="radio" name="ihScope" value="${k}"${i === 0 ? ' checked' : ''}> ${esc(SCOPES[k])} <span class="ih-note">(${n(k)})</span></label>`).join('')}</div>
    <div class="ih-note">Excel has the rooms with every column the report had, the totals on top and the rooms departing tomorrow on a second sheet. The PDF is the same report, ready to print.</div>`,
  `<button type="button" class="ih-btn" data-m="close">Cancel</button><button type="button" class="ih-btn" data-x="pdf">📄 PDF</button><button type="button" class="ih-btn pri" data-x="xl">⬇ Excel</button>`,
  (e, m) => { const b = e.target.closest('[data-x]'); if (!b) return; const s = (m.querySelector('input[name="ihScope"]:checked') || {}).value || 'view'; closeModal(); if (b.dataset.x === 'xl') exportExcel(s); else exportPdf(s); });
}
const EXCELJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
let exLoading = null;
function loadExcelJS() {
  if (W.ExcelJS && W.ExcelJS.Workbook) return Promise.resolve(W.ExcelJS);
  if (exLoading) return exLoading;
  exLoading = new Promise((ok, no) => {
    const sc = doc.createElement('script'); sc.src = EXCELJS_URL; sc.async = true; sc.crossOrigin = 'anonymous';
    const tm = setTimeout(() => no(new Error('timeout')), 12000);
    sc.onload = () => { clearTimeout(tm); W.ExcelJS && W.ExcelJS.Workbook ? ok(W.ExcelJS) : no(new Error('no ExcelJS')); };
    sc.onerror = () => { clearTimeout(tm); no(new Error('not loaded')); };
    doc.head.appendChild(sc);
  }).catch(e => { exLoading = null; throw e; });
  return exLoading;
}
const XC = { band: 'FF1E293B', gold: 'FFC9A227', head: 'FF1E293B', zebra: 'FFF8FAFC', line: 'FFE2E8F0', ink: 'FF0F172A', sub: 'FF64748B', white: 'FFFFFFFF',
  ok: ['FFDCFCE7', 'FF166534'], warn: ['FFFEF3C7', 'FF92400E'], bad: ['FFFEE2E2', 'FF991B1B'], blue: ['FFDBEAFE', 'FF1E40AF'], today: 'FFFFF7E6', tmr: 'FFEEF4FF' };
async function proWorkbook(M, T) {
  const EJ = await loadExcelJS();
  const wb = new EJ.Workbook(); wb.creator = 'HotelOps'; wb.created = new Date(); wb.title = M.title;
  const thin = { style: 'thin', color: { argb: XC.line } }, box = { top: thin, left: thin, bottom: thin, right: thin };
  const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const font = o => Object.assign({ name: 'Calibri', size: 11, color: { argb: XC.ink } }, o);
  const KC = { ok: XC.ok, warn: XC.warn, bad: XC.bad, ink: XC.blue };
  function sheet(name, X, sub, tab) {
    const n = Math.max(X.head.length, 6);
    const ws = wb.addWorksheet(name, { properties: { tabColor: { argb: tab } }, views: [{ showGridLines: false }] });
    ws.columns = X.widths.map(w => ({ width: w })).concat(Array(Math.max(0, n - X.widths.length)).fill({ width: 10 }));
    ws.mergeCells(1, 1, 1, n); const h = ws.getCell(1, 1); h.value = (M.hotel || 'HotelOps').toUpperCase(); h.font = font({ size: 9.5, bold: true, color: { argb: 'FFF5D97A' } }); h.alignment = { vertical: 'bottom', indent: 1 };
    ws.mergeCells(2, 1, 2, n); const tt = ws.getCell(2, 1); tt.value = M.title + (sub ? ' · ' + sub : ''); tt.font = font({ size: 20, bold: true, color: { argb: XC.white } }); tt.alignment = { vertical: 'middle', indent: 1 };
    ws.mergeCells(3, 1, 3, n); const s = ws.getCell(3, 1); s.value = `Report of ${fmtD(M.report)} · ${X.scope}${M.by ? ' · Prepared by ' + M.by : ''}`; s.font = font({ size: 10.5, color: { argb: 'FFCBD5E1' } }); s.alignment = { vertical: 'top', indent: 1 };
    for (let r = 1; r <= 3; r++) for (let c = 1; c <= n; c++) ws.getCell(r, c).fill = fill(XC.band);
    for (let c = 1; c <= n; c++) ws.getCell(3, c).border = { bottom: { style: 'thick', color: { argb: XC.gold } } };
    ws.getRow(1).height = 18; ws.getRow(2).height = 32; ws.getRow(3).height = 20; ws.getRow(4).height = 8;
    const K = X.kpis, per = Math.max(1, Math.floor(n / K.length));
    K.forEach(([label, v, k], i) => {
      const c1 = i * per + 1; if (c1 > n) return; const c2 = i === K.length - 1 ? n : Math.min(n, c1 + per - 1), col = KC[k] || XC.blue;
      if (c2 > c1) { ws.mergeCells(5, c1, 5, c2); ws.mergeCells(6, c1, 6, c2); }
      const vc = ws.getCell(5, c1), lc = ws.getCell(6, c1);
      vc.value = v; vc.font = font({ size: 17, bold: true, color: { argb: col[1] } }); vc.alignment = { horizontal: 'center', vertical: 'middle' };
      lc.value = String(label).toUpperCase(); lc.font = font({ size: 8.5, bold: true, color: { argb: col[1] } }); lc.alignment = { horizontal: 'center', vertical: 'top' };
      for (let c = c1; c <= c2; c++) [5, 6].forEach(r => { ws.getCell(r, c).fill = fill(col[0]); });
    });
    ws.getRow(5).height = 30; ws.getRow(6).height = 16; ws.getRow(7).height = 10;
    const H = 8, hr = ws.getRow(H); hr.values = X.head; hr.height = 24;
    X.head.forEach((_, i) => { const c = hr.getCell(i + 1); c.font = font({ bold: true, color: { argb: XC.white } }); c.fill = fill(XC.head); c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
    X.rows.forEach((cells, k) => {
      const row = ws.getRow(H + 1 + k);
      row.values = cells.map((v, i) => (['arrival', 'departure'].includes(X.cols[i]) && isIso(v) ? xlSerial(v) : v));
      row.height = 19;
      const tint = X.flags[k] === 'today' ? XC.today : X.flags[k] === 'tomorrow' ? XC.tmr : (k % 2 ? XC.zebra : null);
      cells.forEach((_, i) => {
        const c = row.getCell(i + 1), f = X.cols[i];
        c.border = box; c.font = font({ size: 10.5 }); if (tint) c.fill = fill(tint);
        c.alignment = { vertical: 'middle', horizontal: ['arrival', 'departure', 'nights', 'adults', 'children', 'vip', 'room'].includes(f) ? 'center' : ['rate', 'balance'].includes(f) ? 'right' : 'left', wrapText: f === 'notes' };
        if (['arrival', 'departure'].includes(f)) c.numFmt = 'dd.mm.yyyy';
        if (['rate', 'balance'].includes(f)) c.numFmt = '#,##0.00;-#,##0.00;"–"';
        if (f === 'balance' && cells[i] > 0) c.font = font({ size: 10.5, bold: true, color: { argb: XC.bad[1] } });
        if (f === 'room') c.font = font({ size: 10.5, bold: true });
      });
    });
    let last = H + X.rows.length;
    if (!X.rows.length) { ws.mergeCells(H + 1, 1, H + 1, n); const c = ws.getCell(H + 1, 1); c.value = 'No rooms.'; c.font = font({ italic: true, color: { argb: XC.sub } }); last++; }
    const bi = X.cols.indexOf('balance');
    if (X.rows.length && bi >= 0) {
      const r = ws.getRow(last + 1); r.height = 22; r.getCell(1).value = 'Total'; const col = String.fromCharCode(65 + bi);
      r.getCell(bi + 1).value = { formula: `SUM(${col}${H + 1}:${col}${H + X.rows.length})`, result: X.rows.reduce((s, x) => s + (+x[bi] || 0), 0) };
      r.getCell(bi + 1).numFmt = '"AED" #,##0.00';
      for (let c = 1; c <= X.head.length; c++) { const x = r.getCell(c); x.fill = fill('FFFEF9E7'); x.font = font({ bold: true }); x.border = { top: { style: 'medium', color: { argb: XC.head } }, bottom: { style: 'medium', color: { argb: XC.head } } }; }
    }
    ws.autoFilter = { from: { row: H, column: 1 }, to: { row: Math.max(H, H + X.rows.length), column: X.head.length } };
    ws.views = [{ state: 'frozen', ySplit: H, xSplit: 1, topLeftCell: `B${H + 1}`, activeCell: `A${H + 1}`, showGridLines: false }];
    const footer = `&L&8${(M.title + (M.hotel ? ' · ' + M.hotel : '') + ' · ' + fmtD(M.report)).replace(/&/g, '&&')}&R&8Page &P of &N`;
    ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.45, bottom: 0.55, header: 0.2, footer: 0.25 }, printTitlesRow: `${H}:${H}` };
    ws.headerFooter = { oddFooter: footer, evenFooter: footer };
  }
  sheet('In-House', M, '', XC.gold);
  if (T) sheet('Departing tomorrow', T, 'departing tomorrow', 'FF2563EB');
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
function plainWorkbook(M, T) {
  if (typeof XLSX === 'undefined' || !XLSX.utils) return null;
  const wb = XLSX.utils.book_new();
  const sheet = X => {
    const aoa = [[M.title + (M.hotel ? ' · ' + M.hotel : '')], [`Report of ${fmtD(M.report)} · ${X.scope}${M.by ? ' · Prepared by ' + M.by : ''}`], X.kpis.map(k => k[0] + ': ' + k[1]), [], X.head]
      .concat(X.rows.map(r => r.map((v, i) => (['arrival', 'departure'].includes(X.cols[i]) && isIso(v) ? xlSerial(v) : v))));
    const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = X.widths.map(w => ({ wch: w }));
    X.rows.forEach((r, k) => X.cols.forEach((f, c) => { const a = XLSX.utils.encode_cell({ r: 5 + k, c }); if (!ws[a]) return; if (['arrival', 'departure'].includes(f) && ws[a].t === 'n') ws[a].z = 'dd.mm.yyyy'; if (['rate', 'balance'].includes(f) && ws[a].t === 'n') ws[a].z = '#,##0.00'; }));
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 4, c: 0 }, e: { r: 4 + X.rows.length, c: X.head.length - 1 } }) };
    return ws;
  };
  XLSX.utils.book_append_sheet(wb, sheet(M), 'In-House');
  if (T) XLSX.utils.book_append_sheet(wb, sheet(T), 'Departing tomorrow');
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
}
async function exportExcel(scope) {
  if (!can('canExport')) return deny('Downloading files');
  if (!I.snap) { toast('Load the in-house report first', 'warn'); return null; }
  const M = modelFor(scope || 'view'), T = !scope || scope === 'all' || scope === 'view' ? modelFor('tomorrow') : null;
  const name = fileName(hotel(), I.snap.date || today()).replace(/\.xlsx$/, (scope && scope !== 'all' && scope !== 'view' ? ' - ' + SCOPES[scope] : '') + '.xlsx');
  let bytes = null, pro = false;
  try { bytes = await proWorkbook(M, T); pro = true; } catch (e) { safe(() => console.warn('[inhouse] styled Excel not available, plain file instead:', e && e.message)); }
  if (!bytes) bytes = safe(() => plainWorkbook(M, T), null);
  if (!bytes) { toast('Excel is not loaded (offline?) — try again in a moment', 'warn'); return null; }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = doc.createElement('a'); a.href = url; a.download = name; doc.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast(`⬇ ${name} · ${M.rows.length} room${M.rows.length === 1 ? '' : 's'}${pro ? '' : ' (simple layout — offline)'}`);
  act('inhouse_export', `Excel · ${M.scope} (${M.rows.length})`);
  return { name, pro, bytes };
}
function exportPdf(scope) {
  if (!can('canExport')) return deny('Downloading files');
  if (typeof mePrintPage !== 'function') { toast('The PDF helper did not load. Reload the page.', 'warn'); return null; }
  if (!I.snap) { toast('Load the in-house report first', 'warn'); return null; }
  const M = modelFor(scope || 'view'), T = !scope || scope === 'all' || scope === 'view' ? modelFor('tomorrow') : null;
  const w = mePrintPage(fileName(hotel(), I.snap.date || today(), 'pdf').replace(/\.pdf$/, ''), reportHtml(M, T), { landscape: true });
  if (w) { toast('📄 PDF page opened: press "Print / Save as PDF"'); safe(() => setTimeout(() => { try { w.print(); } catch (_) {} }, 700)); }
  act('inhouse_export', `PDF · ${M.scope} (${M.rows.length})`);
  return w;
}

// ── taps ──
function onClick(e) {
  safe(() => {
    const b = e.target.closest('[data-ih]'); if (!b) return;
    const a = b.dataset.ih;
    if (a === 'browse') { const inp = doc.getElementById('ihFileInput'); if (inp) { inp.value = ''; inp.click(); } }
    else if (a === 'paste') pasteDialog();
    else if (a === 'export') exportDialog();
    else if (a === 'errx') { I.err = null; render(); }
    else if (a === 'f') { I.f = b.dataset.f || 'all'; saveView(); render(); }
    else if (a === 'copyTmr') copyText(tomorrowText(I.rooms, today(), hotel()));
    else if (a === 'xlTmr') exportExcel('tomorrow');
    else if (a === 'dep') { e.stopPropagation(); goDeparture(b.dataset.rk); }
    else if (a === 'open') openRoom(b.dataset.rk);
  });
}

// ── live data ──
function applyMeta(meta) {
  const t = today();
  const want = meta && meta.date ? meta.date : t;
  if (I.snap && meta && I.snap.date === meta.date && I.snap.at === meta.at) return;
  Promise.resolve(typeof fbGet === 'function' ? fbGet(ROOT + '/' + want) : null).then(v => {
    if (v && v.rows) setSnapshot(v);
    I.loaded = true; soon();
  }).catch(() => {});
}
function startSync() {
  let tries = 0;
  const go = () => {
    if (typeof fbListen !== 'function') { const v = LS.get('ih_snap_local', null); if (v) setSnapshot(v); I.loaded = true; render(); return; }
    if (!dbRef() && ++tries <= 40) { setTimeout(go, 500); return; }
    fbListen(META, v => safe(() => applyMeta(v)));
  };
  go();
}

function initDrop(panel) {
  let depth = 0;
  const hasFiles = e => [...((e.dataTransfer && e.dataTransfer.types) || [])].includes('Files');
  panel.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; panel.classList.add('ih-dragging'); });
  panel.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
  panel.addEventListener('dragleave', e => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) panel.classList.remove('ih-dragging'); });
  panel.addEventListener('drop', e => { if (!hasFiles(e)) return; e.preventDefault(); depth = 0; panel.classList.remove('ih-dragging'); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) loadFile(f); });
}

function mount() {
  if (doc.getElementById('panel-' + PANEL)) return;
  const main = doc.querySelector('main.main') || doc.querySelector('main');
  const nav = doc.querySelector('nav.sidenav') || doc.querySelector('nav');
  if (!main || !nav) { console.warn('[inhouse] app layout not found; panel not added'); return; }
  const st = doc.createElement('style'); st.id = 'ih-style'; st.textContent = CSS; doc.head.appendChild(st);
  const panel = doc.createElement('div'); panel.className = 'panel'; panel.id = 'panel-' + PANEL; panel.innerHTML = '<div id="ihRoot"></div>';
  main.appendChild(panel);
  panel.addEventListener('click', onClick);
  panel.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('ih-row')) { e.preventDefault(); openRoom(e.target.dataset.rk); } });
  panel.addEventListener('input', e => { if (e.target.id === 'ihQ') { I.q = e.target.value; clearTimeout(I.qt); I.qt = setTimeout(render, 120); } });
  panel.addEventListener('change', e => safe(() => {
    const t = e.target;
    if (t.id === 'ihBy') { I.by = t.value; saveView(); render(); }
    else if (t.id === 'ihFileInput') { const f = t.files && t.files[0]; if (f) loadFile(f); }
  }));
  initDrop(panel);

  const item = doc.createElement('div');
  item.className = 'nav-item'; item.id = 'nav-' + PANEL; item.dataset.panel = PANEL;
  item.setAttribute('onclick', "showPanel('" + PANEL + "')");
  item.innerHTML = '<div class="nav-icon">🛏️</div>In-House Guests<span class="nav-badge" id="badge-' + PANEL + '" style="display:none"></span>';
  const anchor = doc.getElementById('nav-arrivals');
  if (anchor && anchor.parentNode === nav) anchor.after(item); else nav.appendChild(item);
  const grid = doc.querySelector('.mob-more-grid');
  if (grid) {
    const b = doc.createElement('button'); b.className = 'mob-more-item'; b.dataset.panel = PANEL; b.type = 'button';
    b.setAttribute('onclick', "showPanel('" + PANEL + "');(typeof closeMobMore==='function'?closeMobMore:typeof toggleMobMore==='function'?toggleMobMore:function(){})()");
    b.innerHTML = '<span class="mob-item-icon">🛏️</span><span class="mob-more-badge" id="mob-badge-' + PANEL + '"></span>In-House';
    const before = grid.querySelector('.mob-more-item[data-panel="purpose"]');
    if (before) before.before(b); else grid.appendChild(b);
  }
  if (typeof hoApplyIcons === 'function') safe(() => hoApplyIcons());
  safe(() => {
    if (typeof ROLES !== 'undefined') ['owner', 'manager', 'supervisor', 'agent', 'readonly'].forEach(r => { const p = ROLES[r] && ROLES[r].panels; if (p && !p.includes(PANEL)) p.push(PANEL); });
    if (typeof currentProfile !== 'undefined' && currentProfile && typeof applyRole === 'function') applyRole(currentProfile.role);
  });
  let wasOn = false;
  new MutationObserver(() => { const on = panel.classList.contains('active'); if (on && !wasOn) render(); if (!on && wasOn) closeDrawer(); wasOn = on; }).observe(panel, { attributes: true, attributeFilter: ['class'] });
  setInterval(() => safe(() => { badge(); if (panel.classList.contains('active') && !doc.getElementById('ih-modal') && !(doc.activeElement && panel.contains(doc.activeElement) && /INPUT|SELECT|TEXTAREA/.test(doc.activeElement.tagName))) render(); }), 5 * 60e3);
  doc.addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (doc.getElementById('ih-modal')) closeModal(); else if (doc.getElementById('ih-drawer')) closeDrawer(); });
  render(); startSync();
}

Object.assign(W.hoInHouse, { open: rk => { if (typeof showPanel === 'function') showPanel(PANEL); setTimeout(() => openRoom(roomKey(rk)), 80); }, loadText, loadFile, exportExcel, exportPdf, proBytes: scope => proWorkbook(modelFor(scope || 'all'), modelFor('tomorrow')), plainBytes: scope => plainWorkbook(modelFor(scope || 'all'), modelFor('tomorrow')), state: () => I, render: () => render() });
if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount); else mount();
})();

/* HotelOps · Opera Cloud reader
 *
 * Reads what Opera Cloud shows on screen and hands it to HotelOps, the same way the WhatsApp reader
 * does for WhatsApp Web. It ONLY reads: it never clicks, types or changes anything in Opera, and it
 * sends to nobody but the HotelOps tab.
 *
 * Two ways to run it:
 *  · The HotelOps helper (the browser extension HotelOps builds, Settings → Opera reader): starts by
 *    itself on Opera Cloud and links through the helper. Nothing to paste.
 *  · Console paste (fallback): HotelOps → Settings → Opera reader → "Copy the console reader", then
 *    in the Opera Cloud tab F12 → Console → paste → Enter, and press "Connect" on the small pill.
 *
 * What it reads (any screen, kept generic on purpose — we read headers, not Opera's internals):
 *  · data grids (table, role=grid / row / gridcell, Oracle JET oj-table / oj-data-grid): the column
 *    headers are matched by their words (Room, Name, Conf #, Arrival, Departure, Nights, Status,
 *    Nationality, Email, Company, Travel Agent, Source, Rate Code, VIP, Adults/Children, Balance…);
 *  · label → value pairs of a reservation's details;
 *  · what the screen is (Arrivals, Departures, In House, a reservation search or a reservation's
 *    details) from its title and headings, and the date shown on it.
 * Opera loads long lists while you scroll: rows are collected as they come into view and merged by
 * confirmation number (or room + name). A snapshot goes to HotelOps only when something changed.
 *
 * Also read:
 *  · Billing / Folio / Cashiering (Billing, Folio, Post Charges, Settlement, Check Out, Cashier, Advance
 *    Folio, Folio History): room, guest, conf., the folio windows 1–8 with their balance, the total, the
 *    postings (date, code, description, amount, supplement / reference), the payment TYPE only ("Visa",
 *    "Cash", "City Ledger") and whether the folio is settled / at zero;
 *  · Room Management / Housekeeping / Room Status / Room Diary (room, room / FO / HK status, discrepancy),
 *    Profiles (nationality, VIP, membership, preferences), Traces / Alerts / Messages, Rate query, Group /
 *    Block rooming lists, End of Day / Night Audit;
 *  · any other grid as a plain table (title, headers, up to 300 rows), and every label → value pair of a
 *    reservation (as `extra`).
 * Privacy, before anything leaves this tab: any run of 12–19 digits (spaces / dashes allowed) becomes
 * "•••• 1234"; columns and labels named card / CC / PAN / CVV / CVC / expiry / auth code / password / PIN
 * are dropped; password inputs are never read.
 *
 * Learning from you ("watch me", can be turned off in HotelOps): which screens you open and the visible
 * label of the buttons, links, tabs and menu items you click (40 characters at most). Never what you type,
 * never a key, never a line of a list (guest data). HotelOps turns that into your routines and may answer
 * with a quiet "Usually next: Settle" on the pill.
 *
 * A small pill sits bottom right ("📡 HotelOps · read 42 departures"); click – to make it a dot.
 * Built with DOM calls and inline styles only (no innerHTML, no <style>), so Opera's page rules don't
 * block it. Pure helpers are exported for the Node tests (tests/run-tests.js).
 */
(function () {
  'use strict';
  var APP_URL = '__HO_APP_URL__';
  var VERSION = '1';

  // ── pure helpers (tested in Node) ────────────────────────
  var sp = function (s) { return String(s == null ? '' : s).replace(/[   ]/g, ' ').replace(/[​-‏⁦-⁩﻿]/g, ''); };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12,
    JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, JUNE: 6, JULY: 7, AUGUST: 8, SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12 };

  /** a header as words: "Conf. #" → "CONF NO", "E-mail" → "E MAIL" → "EMAIL" (sort hints and icons dropped) */
  function normH(h) {
    var s = sp(h).split('\n')[0].toUpperCase();
    s = s.replace(/\b(?:SORT(?:ED)?|ASCENDING|DESCENDING|CLICK TO SORT.*|SORTABLE)\b/g, ' ');
    s = s.replace(/#/g, ' NO ').replace(/&/g, ' AND ').replace(/\bE[\s-]+MAIL\b/g, 'EMAIL').replace(/\bNUMBER\b|\bNBR\b|\bNUM\b/g, 'NO').replace(/[^A-Z0-9]+/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
  }
  // field → header words (after normH). Exact names first; then the longest phrase found inside a longer header.
  var FIELDS = [
    ['room', ['ROOM', 'RM', 'ROOM NO', 'RM NO', 'ROOM NUMBER', 'ROOMS']],
    ['roomType', ['ROOM TYPE', 'RM TYPE', 'RTC', 'ROOM CLASS', 'ROOM CATEGORY']],
    ['roomStatus', ['ROOM STATUS', 'RM STATUS', 'ROOM CONDITION', 'CONDITION', 'HOUSEKEEPING ROOM STATUS', 'CURRENT ROOM STATUS']],
    ['hkStatus', ['HK STATUS', 'HOUSEKEEPING STATUS', 'HSK STATUS', 'HK']],
    ['foStatus', ['FO STATUS', 'FRONT OFFICE STATUS', 'FRONT DESK STATUS', 'FO', 'OCCUPANCY STATUS']],
    ['disc', ['DISCREPANCY', 'DISCREPANCIES', 'DISC', 'ROOM DISCREPANCY', 'SKIP SLEEP']],
    ['name', ['NAME', 'GUEST', 'GUEST NAME', 'GUEST NAMES', 'FULL NAME', 'PRIMARY GUEST', 'GUEST FULL NAME', 'DISPLAY NAME']],
    ['last', ['LAST NAME', 'SURNAME', 'FAMILY NAME']],
    ['first', ['FIRST NAME', 'GIVEN NAME']],
    ['conf', ['CONF', 'CONF NO', 'CONFIRMATION', 'CONFIRMATION NO', 'RESERVATION NO', 'RESV NO', 'RES NO', 'BOOKING NO', 'BOOKING REF', 'BOOKING REFERENCE', 'RESERVATION ID']],
    ['arrival', ['ARRIVAL', 'ARR', 'ARRIVAL DATE', 'ARR DATE', 'CHECK IN', 'CHECK IN DATE', 'CHECKIN', 'ARRIVING']],
    ['departure', ['DEPARTURE', 'DEP', 'DEPARTURE DATE', 'DEP DATE', 'CHECK OUT', 'CHECK OUT DATE', 'CHECKOUT', 'DEPARTING']],
    ['eta', ['ETA', 'ARRIVAL TIME', 'ARR TIME', 'EXPECTED ARRIVAL TIME']],
    ['etd', ['ETD', 'DEPARTURE TIME', 'DEP TIME', 'EXPECTED DEPARTURE TIME', 'CHECKOUT TIME']],
    ['nights', ['NIGHTS', 'NTS', 'NO OF NIGHTS', 'LOS', 'LENGTH OF STAY', 'NIGHT']],
    ['status', ['STATUS', 'RESERVATION STATUS', 'RES STATUS', 'RESV STATUS', 'GUEST STATUS', 'STAY STATUS']],
    ['nat', ['NATIONALITY', 'NAT', 'COUNTRY', 'NATIONALITY CODE', 'COUNTRY CODE', 'CITIZENSHIP']],
    ['email', ['EMAIL', 'EMAIL ADDRESS', 'MAIL']],
    ['company', ['COMPANY', 'COMPANY NAME', 'CORPORATE', 'ACCOUNT', 'ACCOUNT NAME']],
    ['agent', ['TRAVEL AGENT', 'TRAVEL AGENT NAME', 'AGENT', 'TA', 'TRAVEL AGENCY']],
    ['source', ['SOURCE', 'SOURCE NAME', 'BUSINESS SOURCE', 'SOURCE CODE', 'CHANNEL', 'ORIGIN']],
    ['group', ['GROUP', 'GROUP NAME', 'BLOCK', 'BLOCK NAME', 'BLOCK CODE']],
    ['rateCode', ['RATE CODE', 'RATE PLAN', 'RATE PLAN CODE', 'RATECODE']],
    ['rate', ['RATE', 'RATE AMOUNT', 'AMOUNT', 'DAILY RATE', 'AVG RATE', 'AVERAGE RATE', 'ROOM RATE']],
    ['market', ['MARKET', 'MARKET CODE', 'MARKET SEGMENT', 'SEGMENT']],
    ['vip', ['VIP', 'VIP CODE', 'VIP STATUS', 'VIP LEVEL', 'VIP GUEST']],
    ['member', ['MEMBERSHIP', 'MEMBERSHIP NO', 'MEMBERSHIP TYPE', 'LOYALTY', 'LOYALTY NO', 'MEMBERSHIPS', 'LOYALTY PROGRAM']],
    ['memberLevel', ['MEMBERSHIP LEVEL', 'MEMBER LEVEL', 'LOYALTY LEVEL', 'TIER', 'MEMBERSHIP TIER', 'LOYALTY TIER']],
    ['prefs', ['PREFERENCES', 'PREFERENCE', 'GUEST PREFERENCES', 'ROOM PREFERENCES', 'FEATURES']],
    ['language', ['LANGUAGE', 'PREFERRED LANGUAGE']],
    ['adults', ['ADULTS', 'ADULT', 'ADL', 'ADLT', 'NO OF ADULTS']],
    ['children', ['CHILDREN', 'CHILD', 'CHD', 'CHILDS', 'KIDS', 'NO OF CHILDREN']],
    ['pax', ['PERSONS', 'PAX', 'ADULTS CHILDREN', 'A C', 'GUESTS', 'OCCUPANCY', 'NO OF GUESTS', 'GUEST COUNT', 'NO OF PERSONS']],
    ['balance', ['BALANCE', 'BAL', 'OPEN BALANCE', 'FOLIO BALANCE', 'CURRENT BALANCE', 'ACCOUNT BALANCE']],
    ['payment', ['PAYMENT', 'PAYMENT METHOD', 'METHOD OF PAYMENT', 'PAYMENT TYPE']],
    ['notes', ['NOTES', 'NOTE', 'COMMENTS', 'COMMENT', 'REMARKS', 'SPECIALS', 'SPECIAL REQUESTS']],
    ['alerts', ['ALERTS', 'ALERT', 'TRACES', 'GUEST ALERTS']],
  ];
  // a folio's postings (Billing / Folio / Cashiering)
  var POST_FIELDS = [
    ['date', ['DATE', 'POSTING DATE', 'TRANSACTION DATE', 'TRX DATE', 'TRN DATE', 'BUSINESS DATE', 'POSTED', 'POSTED ON', 'POST DATE', 'DATE POSTED']],
    ['code', ['CODE', 'TRX CODE', 'TRN CODE', 'TRANS CODE', 'TRANSACTION CODE', 'TC', 'TRX', 'ARTICLE CODE']],
    ['desc', ['DESCRIPTION', 'DESC', 'TRANSACTION DESCRIPTION', 'TRANSACTION', 'ITEM', 'DETAILS', 'TEXT', 'CHARGE DESCRIPTION', 'ARTICLE', 'TRANSACTION TEXT']],
    ['amount', ['AMOUNT', 'TOTAL', 'TOTAL AMOUNT', 'NET AMOUNT', 'GROSS AMOUNT', 'PRICE', 'VALUE', 'POSTED AMOUNT']],
    ['debit', ['DEBIT', 'DEBITS', 'CHARGES', 'CHARGE', 'DR', 'CHARGE AMOUNT']],
    ['credit', ['CREDIT', 'CREDITS', 'PAYMENTS', 'PAYMENT', 'CR', 'PAYMENT AMOUNT']],
    ['ref', ['SUPPLEMENT', 'REFERENCE', 'REF', 'SUPPLEMENT REFERENCE', 'REFERENCE NO', 'SUPPLEMENT TEXT', 'CHECK NO', 'REMARK', 'REMARKS']],
    ['window', ['WINDOW', 'WIN', 'FOLIO WINDOW', 'WINDOW NO', 'FOLIO']],
    ['qty', ['QTY', 'QUANTITY']],
  ];
  // traces / alerts / messages
  var TRACE_FIELDS = [
    ['date', ['DATE', 'TRACE DATE', 'FROM DATE', 'BEGIN DATE', 'START DATE', 'CREATED', 'CREATED ON', 'ALERT DATE', 'MESSAGE DATE', 'DUE DATE']],
    ['time', ['TIME', 'TRACE TIME', 'DUE TIME']],
    ['dept', ['DEPARTMENT', 'DEPT', 'DEPARTMENT CODE', 'DEPARTMENTS', 'AREA', 'ALERT CODE', 'TYPE', 'ALERT AREA', 'CODE']],
    ['text', ['TRACE TEXT', 'TRACE', 'TEXT', 'DESCRIPTION', 'MESSAGE', 'MESSAGE TEXT', 'ALERT', 'ALERT TEXT', 'ALERT DESCRIPTION', 'DETAILS', 'NOTE', 'NOTES', 'COMMENT', 'COMMENTS']],
    ['done', ['RESOLVED', 'RESOLVED ON', 'RESOLVED BY', 'STATUS', 'COMPLETED', 'DONE', 'RECEIVED', 'RESOLVED DATE']],
    ['room', ['ROOM', 'RM', 'ROOM NO']],
    ['name', ['NAME', 'GUEST', 'GUEST NAME']],
    ['conf', ['CONF', 'CONF NO', 'CONFIRMATION', 'CONFIRMATION NO', 'RESERVATION NO']],
  ];
  /** a field table → fieldOf for it: exact names first; then the longest phrase found inside a longer header (asked once per text) */
  function mapper(table) {
    var of = {}, keys; table.forEach(function (f) { f[1].forEach(function (w) { of[w] = f[0]; }); }); keys = Object.keys(of);
    var memo = {}, memoN = 0;
    function one(h) {
      var n = normH(h); if (!n || n.length > 48 || secretLabel(h)) return '';   // a card / password column is never a field
      if (of[n]) return of[n];
      var best = '', len = 0, w = ' ' + n + ' ';
      keys.forEach(function (k) { if (k.length > len && k.length >= 3 && w.indexOf(' ' + k + ' ') >= 0) { best = of[k]; len = k.length; } });
      return best;
    }
    return function (h) {
      h = String(h == null ? '' : h); if (h.length > 120) return '';
      if (Object.prototype.hasOwnProperty.call(memo, h)) return memo[h];   // the same header text is asked about on every read: answer it once
      if (++memoN > 5000) { memo = {}; memoN = 1; }
      return (memo[h] = one(h));
    };
  }
  /** one header / label → the field it names, or '' */
  var fieldOf = mapper(FIELDS), postFieldOf = mapper(POST_FIELDS), traceFieldOf = mapper(TRACE_FIELDS);
  /** header cells → {map: {field: column}, n: fields found} (each field once, the first column that names it) */
  function mapHeaders(cells, of) {
    var map = {}, n = 0; of = of || fieldOf;
    (cells || []).forEach(function (c, i) { var f = of(c); if (f && map[f] === undefined) { map[f] = i; n++; } });
    return { map: map, n: n };
  }
  /** a folio's postings: what was charged or paid (a code or a description, and an amount) */
  function usablePost(m) { return !!m && (m.map.code !== undefined || m.map.desc !== undefined) && (m.map.amount !== undefined || m.map.debit !== undefined || m.map.credit !== undefined); }
  /** traces / alerts: a text and when / which department / done */
  function usableTrace(m) { return !!m && m.map.text !== undefined && (m.map.dept !== undefined || m.map.date !== undefined || m.map.done !== undefined); }

  // ── privacy: card numbers, card columns and passwords never leave the reader ──
  /** any run of 12–19 digits (spaces or dashes between them allowed), or a card Opera shows half-hidden
   *  ("4111XXXXXXXX1111"), → "•••• 1234" (the last 4 only) */
  function maskCards(s) {
    s = String(s == null ? '' : s);
    if (s.length < 12) return s;
    return s.replace(/(?<!\d)\d(?:[ \-]?\d){11,}(?!\d)/g, function (m) { return '•••• ' + m.replace(/\D/g, '').slice(-4); })
      .replace(/(?<!\d)\d{0,6}[Xx*•]{4,}[ \-]?(?:[Xx*•]{4}[ \-]?){0,3}(\d{4})(?!\d)/g, function (m, l4) { return '•••• ' + l4; });
  }
  /** a column or label that holds card data or a secret (dropped, never read) */
  function secretLabel(h) {
    var n = normH(h); if (!n) return false;
    if (/^(?:(?:CREDIT |PAYMENT )?CARD TYPE|PAYMENT TYPE|PAYMENT METHOD|METHOD OF PAYMENT)$/.test(n)) return false;
    if (/^(?:EXP|EXP DATE|EXPIRY|EXPIRES|EXPIRATION|EXPIRATION DATE|EXPIRY DATE|VALID THRU|VALID UNTIL|PIN|PAN|CC|CC NO|AUTH|AUTH NO|CID|CVV2|CVC2|CV2)$/.test(n)) return true;
    return /\b(?:CARD|CARDS|CARDHOLDER|CREDIT CARD|CC NUMBER|CVV|CVC|SECURITY CODE|PASSWORD|PASSWORDS|PASSCODE|PWD|PIN CODE|PIN NO|AUTH CODE|AUTHORI[SZ]ATION(?: CODE| NO)?|APPROVAL CODE|IBAN|SWIFT|PASSPORT|ID NO|ID NUMBER|DOCUMENT NO|DOCUMENT NUMBER)\b/.test(n);
  }
  /** an input that must never be read: a password, a PIN, a card field */
  function secretInput(el) {
    if (!el || !el.getAttribute) return false;
    var t = String(el.getAttribute('type') || '').toLowerCase(), ac = String(el.getAttribute('autocomplete') || '').toLowerCase();
    if (t === 'password' || /^cc-|password|one-time-code/.test(ac)) return true;
    return /pass(?:word|code)?|pwd|\bpin\b|cvv|cvc|card|^cc[-_]|[-_]cc$/i.test(String(el.getAttribute('name') || '') + ' ' + String(el.id || ''));
  }
  /** every string inside a value made safe (the last net before anything is sent) */
  function scrub(v, d) {
    d = d || 0; if (d > 8) return null;
    if (typeof v === 'string') return maskCards(v);
    if (Array.isArray(v)) return v.map(function (x) { return scrub(x, d + 1); });
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { if (!secretKey(k)) o[k] = scrub(v[k], d + 1); }); return o; }
    return v;
  }
  var KEY_MEMO = {};
  function secretKey(k) { return KEY_MEMO[k] != null ? KEY_MEMO[k] : (KEY_MEMO[k] = secretLabel(String(k).replace(/([a-z])([A-Z])/g, '$1 $2'))); }
  // the TYPE of a payment, never its number
  var PAY_TYPES = [['Visa', /\bvisa\b|^va\b/i], ['Mastercard', /master\s*card|^mc\b|\bmc\s*card/i], ['Amex', /\bamex\b|american\s*express|^ax\b/i], ['Diners', /\bdiners\b|^dc\b/i],
    ['JCB', /\bjcb\b/i], ['UnionPay', /union\s*pay|^cup\b/i], ['Discover', /\bdiscover\b/i], ['City Ledger', /city\s*ledger|direct\s*bill|^cl\b|\bar\s*transfer/i], ['Cash', /\bcash\b|^ca\b/i],
    ['Bank Transfer', /\bbank\b|\btransfer\b|\bwire\b/i], ['Cheque', /\bcheque\b|\bcheck\b(?!\s*-?\s*(?:out|in))/i], ['Debit card', /\bdebit\b/i], ['Voucher', /\bvoucher\b/i], ['Deposit', /\bdeposit\b/i],
    ['Card', /\bcard\b|credit\s*card/i]];
  /** "VA 4111 •••• 1111", "Visa xxxx1111" → "Visa"; "Cash AED" → "Cash"; '' when it says no type */
  function payType(v) { var s = sp(v).trim(); if (!s) return ''; for (var i = 0; i < PAY_TYPES.length; i++) if (PAY_TYPES[i][1].test(s)) return PAY_TYPES[i][0]; return ''; }
  /** a grid worth reading: it names a room, a confirmation or a guest, and one more thing */
  function usable(m) { return !!m && m.n >= 2 && (m.map.room !== undefined || m.map.conf !== undefined || m.map.name !== undefined || m.map.last !== undefined); }

  /** the numbers of a numeric date "28/10/2026" → [28, 10, 2026] (or null) */
  function numParts(s) { var m = sp(s).trim().match(/^(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{1,4})(?:$|[\sT,])/); return m ? [+m[1], +m[2], +m[3]] : null; }
  function isoOf(y, m, d) {
    y = +y; m = +m; d = +d; if (y < 100) y += 2000;
    if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
    var t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCDate() === d ? y + '-' + pad(m) + '-' + pad(d) : '';
  }
  /** a date as Opera Cloud shows it → "YYYY-MM-DD" ('' when not a date).
   *  2026-10-28 · 28-OCT-26 · 28-Oct-2026 · 28 Oct 2026 · Oct 28, 2026 · Wed, 28 Oct 2026 · Wednesday, October 28, 2026 ·
   *  28/10/2026 (en-GB) or 10/28/2026 (US): order 'dmy' | 'mdy' decides when both could be right (default day first). */
  function parseDate(v, order) {
    var s = sp(v).trim().replace(/^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i, '');   // a weekday in front
    if (!s) return '';
    var m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/))) return isoOf(m[1], m[2], m[3]);
    if ((m = s.match(/^(\d{1,2})[-\/. ]([A-Za-z]{3,9})\.?[-\/. ,]+(\d{2,4})(?:$|[\s,T])/))) return MON[m[2].toUpperCase()] ? isoOf(m[3], MON[m[2].toUpperCase()], m[1]) : '';
    if ((m = s.match(/^([A-Za-z]{3,9})\.?[-\/. ]+(\d{1,2})(?:st|nd|rd|th)?,?[-\/. ]+(\d{2,4})(?:$|[\s,T])/))) return MON[m[1].toUpperCase()] ? isoOf(m[3], MON[m[1].toUpperCase()], m[2]) : '';
    var p = numParts(s);
    if (p) {
      if (p[0] > 31) return isoOf(p[0], p[1], p[2]);
      if (p[0] > 12) return isoOf(p[2], p[1], p[0]);
      if (p[1] > 12) return isoOf(p[2], p[0], p[1]);
      return order === 'mdy' ? isoOf(p[2], p[0], p[1]) : isoOf(p[2], p[1], p[0]);
    }
    if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return isoOf(m[1], m[2], m[3]);
    return '';
  }
  var dayDiff = function (a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); };
  /** which way round are the numeric dates of a list? 'dmy' | 'mdy' | '' (can't tell). Pairs [arrival, departure, nights] help:
   *  "10/11/2026 → 10/12/2026, 1 night" is 11 → 12 Oct the US way, a month the other way. */
  function dateOrder(values, stays) {
    var d = 0, u = 0;
    (values || []).forEach(function (v) { var p = numParts(v); if (!p || p[0] > 31) return; if (p[0] > 12 && p[1] <= 12) d++; else if (p[1] > 12 && p[0] <= 12) u++; });
    (stays || []).forEach(function (s) {
      var n = parseInt(s[2], 10); if (!(n > 0) || !numParts(s[0]) || !numParts(s[1])) return;
      var dd = dayDiff(parseDate(s[0], 'dmy'), parseDate(s[1], 'dmy')), uu = dayDiff(parseDate(s[0], 'mdy'), parseDate(s[1], 'mdy'));
      if (dd === n && uu !== n) d++; else if (uu === n && dd !== n) u++;
    });
    return d > u ? 'dmy' : u > d ? 'mdy' : '';
  }
  /** the first date found in a line of text ("Business Date 28-Oct-2026", "Arrivals for Wed, 28 Oct 2026") → ISO or '' */
  function findDate(text, order) {
    var t = sp(text);
    var rx = /(\d{4}-\d{1,2}-\d{1,2})|(\d{1,2}[-\/. ][A-Za-z]{3,9}\.?[-\/. ,]+\d{2,4})|([A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})|(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/g, m;
    while ((m = rx.exec(t))) { var iso = parseDate(m[0], order); if (iso) return iso; }
    return '';
  }

  /** what Opera's status words mean → 'due_in' | 'in_house' | 'due_out' | 'checked_out' | 'cancelled' | 'no_show' | 'waitlist' | '' */
  function normStatus(s) {
    var t = sp(s).toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    if (/cancel/.test(t)) return 'cancelled';
    if (/no ?show/.test(t)) return 'no_show';
    if (/wait ?list/.test(t)) return 'waitlist';
    if (/checked ?out|check ?out complete|departed|^co$|^out$/.test(t)) return 'checked_out';
    if (/due ?out|expected departure|departing|due to depart/.test(t)) return 'due_out';
    if (/checked ?in|in ?house|arrived|staying|^ci$|^ih$|stay ?over/.test(t)) return 'in_house';
    if (/due ?in|expected arrival|arriving|reserved|confirmed|guaranteed|^new$|pre ?arrival|^res$/.test(t)) return 'due_in';
    return '';
  }
  var NO = /^(|-|–|—|0|n|no|none|false|null|n\/a|na)$/i;
  /** a room's housekeeping state → 'clean' | 'dirty' | 'inspected' | 'pickup' | 'ooo' | 'oos' | '' (VC / VD / OC / OD too) */
  function normRoomStatus(s) {
    if (!s) return '';
    var t = sp(s).toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim(); if (!t) return '';
    if (/out of order|^ooo\b/.test(t)) return 'ooo';
    if (/out of service|^oos\b/.test(t)) return 'oos';
    if (/inspect|^ip$|^i$/.test(t)) return 'inspected';
    if (/pick ?up|^pu$/.test(t)) return 'pickup';
    if (/dirty|^di$|^d$|^vd$|^od$/.test(t)) return 'dirty';
    if (/clean|^cl$|^c$|^vc$|^oc$/.test(t)) return 'clean';
    return '';
  }
  /** "AED 1,234.50", "(120.00)", "-35" → a number */
  function money(v) {
    var s = sp(v).trim(); if (!s) return null;
    if (!/\d/.test(s)) return null;
    var neg = /^\(.*\)$/.test(s) || /^-|-$|\bCR\b/i.test(s.replace(/[A-Z]{3}\s*/i, ''));
    var n = parseFloat(s.replace(/[^\d.]/g, '')); if (isNaN(n)) return null;
    return Math.round((neg ? -n : n) * 100) / 100;
  }
  var int = function (v) { var m = sp(v).match(/-?\d+/); return m ? parseInt(m[0], 10) : null; };
  /** "0113 QKNG" → "0113", "Rm 512" → "512", "Assign room" → '' */
  function roomOf(v) { var m = sp(v).replace(/^\s*(?:room|rm)\.?\s*/i, '').match(/^\s*([A-Za-z]?\d{1,5}[A-Za-z]?)\b/); return m ? m[1].toUpperCase() : ''; }
  /** rooms match without leading zeros: "0113" = "113" */
  function roomKey(r) { var s = sp(r).trim().toUpperCase().replace(/\s+/g, ''); var m = s.match(/^([A-Z]?)0*(\d+)([A-Z]?)$/); return m ? m[1] + (m[2] || '0') + m[3] : s; }
  /** a guest's name as a bag of words (order, titles and accents don't matter) */
  function nameKey(s) {
    return sp(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\b(MR|MRS|MS|MISS|DR|MSTR|MASTER|PROF|SIR|MME|SHEIKH|SHEIKHA)\b\.?/g, ' ')
      .replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 1; }).sort().join(' ');
  }
  function confOf(v) { var s = sp(v).trim().split(/\s|\n/)[0].replace(/[^A-Za-z0-9\-]/g, ''); return /\d{3,}/.test(s) ? s.toUpperCase() : ''; }
  function emailOf(v) { var m = sp(v).match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/); return m ? m[0] : ''; }
  var clip = function (v, n) { return sp(v).replace(/\s*\n\s*/g, ' · ').replace(/\s+/g, ' ').trim().slice(0, n || 120); };

  /** the cells of one grid line (strings, by column) → one guest line {room, name, conf, arrival, …} (raw dates kept for the order check) */
  function rowFrom(cells, map) {
    var c = function (f) { return map[f] === undefined ? '' : sp(cells[map[f]] == null ? '' : cells[map[f]]).trim(); };
    var r = {};
    var room = roomOf(c('room')); if (room) r.room = room;
    var name = c('name').split('\n')[0].trim();
    if (!name && (c('last') || c('first'))) name = c('last') + (c('first') ? ', ' + c('first') : '');
    if (name && !/^(name|guest)$/i.test(name)) r.name = clip(name, 80);
    var conf = confOf(c('conf')); if (conf) r.conf = conf;
    if (c('arrival')) r._arr = c('arrival');
    if (c('departure')) r._dep = c('departure');
    var nt = int(c('nights')); if (nt != null && nt >= 0 && nt < 400) r.nights = nt;
    var st = c('status'); if (st) { r.statusText = clip(st, 40); r.status = normStatus(st); }
    ['roomType', 'roomStatus', 'hkStatus', 'foStatus', 'disc', 'company', 'agent', 'source', 'group', 'rateCode', 'market', 'member', 'memberLevel', 'language', 'eta', 'etd'].forEach(function (f) { var v = c(f); if (v && !NO.test(v)) r[f] = clip(v, 80); });
    var pm = c('payment'); if (pm && !NO.test(pm)) { var pt = payType(pm) || (/\d/.test(pm) ? '' : clip(pm, 30)); if (pt) r.payment = pt; }   // the type only, never a number
    var rs = normRoomStatus(r.roomStatus) || normRoomStatus(r.hkStatus); if (rs) r.rs = rs;
    var pf = c('prefs'); if (pf && !NO.test(pf)) r.prefs = clip(pf, 200);
    var al = c('alerts'); if (al && !NO.test(al)) r.alerts = clip(al, 200);
    var nat = c('nat'); if (nat && !NO.test(nat)) r.nat = clip(nat, 40);
    var em = emailOf(c('email')); if (em) r.email = em;
    var vip = c('vip'); if (vip && !NO.test(vip)) r.vip = clip(vip, 20);
    var a = int(c('adults')), k = int(c('children'));
    var px = c('pax').match(/^\s*(\d+)\s*[\/+]\s*(\d+)/);
    if (px) { if (a == null) a = +px[1]; if (k == null) k = +px[2]; } else if (a == null && int(c('pax')) != null) a = int(c('pax'));
    if (a != null) r.adults = a; if (k != null) r.children = k;
    var bal = money(c('balance')); if (bal != null) r.balance = bal;
    var rt = money(c('rate')); if (rt != null) r.rate = rt;
    var nn = c('notes'); if (nn) r.notes = clip(nn, 300);
    return r;
  }
  /** grid lines → finished guest lines: dates read the same way round for the whole list, nights from the dates */
  function finishRows(raw, order) {
    var vals = [], stays = [];
    raw.forEach(function (r) { if (r._arr) vals.push(r._arr); if (r._dep) vals.push(r._dep); if (r._arr && r._dep && r.nights != null) stays.push([r._arr, r._dep, r.nights]); });
    var o = dateOrder(vals, stays) || order || 'dmy';
    return raw.map(function (r) {
      var x = {}; Object.keys(r).forEach(function (k) { if (k.charAt(0) !== '_') x[k] = r[k]; });
      if (r._arr) { var a = parseDate(r._arr, o); if (a) x.arrival = a; }
      if (r._dep) { var d = parseDate(r._dep, o); if (d) x.departure = d; }
      if (x.nights == null && x.arrival && x.departure) x.nights = Math.max(0, dayDiff(x.arrival, x.departure));
      return x;
    }).filter(function (x) { return x.room || x.conf || x.name; });
  }
  /** the key two reads of the same reservation share: its confirmation, else room + name */
  function rowKey(r) {
    if (!r) return '';
    if (r.conf) return 'c:' + r.conf;
    var n = nameKey(r.name);
    if (r.room && n) return 'r:' + roomKey(r.room) + '|' + n;
    if (n && (r.arrival || r.departure)) return 'n:' + n + '|' + (r.arrival || '') + '|' + (r.departure || '');
    if (r.room) return 'r:' + roomKey(r.room) + '|';
    return '';
  }
  /** rows seen before + rows seen now → one list (a fresh value replaces an older one; nothing seen is dropped) */
  function mergeRows(old, add) {
    var by = {}, out = [];
    (old || []).concat(add || []).forEach(function (r) {
      var k = rowKey(r); if (!k) return;
      // a line first seen without its confirmation, then with it: the same guest
      if (!by[k] && r.conf && r.room && r.name) { var k2 = 'r:' + roomKey(r.room) + '|' + nameKey(r.name); if (by[k2]) { by[k] = by[k2]; delete by[k2]; } }
      if (!by[k]) { by[k] = {}; out.push(by[k]); }
      Object.keys(r).forEach(function (f) { if (r[f] !== '' && r[f] != null) by[k][f] = r[f]; });
    });
    return out;
  }
  /** label → value pairs of a reservation's details → one guest line (or null when it isn't a reservation).
   *  loose: a profile or a folio — a name, a room or a conf. and one more thing is enough */
  function pairsToRow(pairs, order, loose) {
    var cells = [], map = {}, n = 0;
    (pairs || []).forEach(function (p) {
      var f = fieldOf(p[0]); if (!f || map[f] !== undefined || !sp(p[1]).trim()) return;
      map[f] = cells.length; cells.push(String(p[1])); n++;
    });
    var who = map.conf !== undefined || map.room !== undefined || map.name !== undefined || map.last !== undefined;
    if (loose ? !(n >= 2 && who) : (n < 3 || !(map.conf !== undefined || (map.room !== undefined && (map.name !== undefined || map.last !== undefined))))) return null;
    var rows = finishRows([rowFrom(cells, map)], order);
    return rows[0] || null;
  }
  // what a screen is, from its title, headings and address (most specific first)
  var KINDS = [
    ['billing', /\bbilling\b|\bfolios?\b|post(?:ing)?\s*charges?|\bsettlement\b|\bsettle\b|\bcashier(?:ing)?\b|advance\s*(?:bill|folio)|\binvoices?\b/],
    ['rooms', /room\s*(?:management|status|diary|maintenance|conditions?|rack|plan)|\bhousekeeping\b|\bhk\s*board\b|\bdiscrepanc(?:y|ies)\b|out\s*of\s*order|\btask\s*sheets?\b/],
    ['audit', /end\s*of\s*day|night\s*audit|\beod\b|end-of-day|\bclose\s*(?:the\s*)?day\b/],
    ['inhouse', /\bin[\s\-]?house\b|\bstay\s*overs?\b/],
    ['departures', /\bdepartures?\b|\bdue\s*outs?\b|\bcheck[\s\-]?outs?\b/],
    ['arrivals', /\barrivals?\b|\bdue\s*ins?\b|\bcheck[\s\-]?ins?\b/],
    ['traces', /\btraces?\b|\balerts?\b|\bmessages?\b|\blocators?\b/],
    ['profile', /\bprofiles?\b|guest\s*(?:details|information|info)\b|\bclient\s*details\b/],
    ['rates', /rate\s*(?:query|info(?:rmation)?|availability|grid|calendar|codes?|plans?|overview)|look\s*to\s*book|\bavailability\b|\brates\b/],
    ['group', /rooming\s*lists?|\bblocks?\b|\bgroups?\b|\ballotments?\b|\bbusiness\s*blocks?\b/],
    ['details', /reservation\s*(?:details?|overview|presentation|summary|info)|stay\s*details|manage\s*reservation|edit\s*reservation/],
    ['search', /look\s*up\s*reservations?|lookup\s*reservations?|reservation\s*search|search\s*reservations?|find\s*reservations?|\breservations?\b/],
  ];
  function kindOfText(t) {
    t = sp(t).toLowerCase(); if (!t) return '';
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i][1].test(t)) return KINDS[i][0];
    return '';
  }
  /** parts: [title, ...headings, url] (most trusted first) and the rows read → the kind of screen */
  function pageKind(parts, rows) {
    for (var i = 0; i < (parts || []).length; i++) { var k = kindOfText(String(parts[i] || '').replace(/[\/_#?=&]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')); if (k) return k; }
    var c = {}; (rows || []).forEach(function (r) { if (r.status) c[r.status] = (c[r.status] || 0) + 1; });
    var top = Object.keys(c).sort(function (a, b) { return c[b] - c[a]; })[0];
    return top === 'due_in' ? 'arrivals' : top === 'due_out' || top === 'checked_out' ? 'departures' : top === 'in_house' ? 'inhouse' : rows && rows.length ? 'list' : '';
  }
  /** a short id of a value (snapshots are sent only when this changes) */
  function hash(v) { var s = typeof v === 'string' ? v : JSON.stringify(v); var h = 5381, g = 7; for (var i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) | 0; g = (g * 31 + s.charCodeAt(i)) | 0; } return (h >>> 0).toString(36) + (g >>> 0).toString(36); }
  var KIND_WORD = { arrivals: 'arrivals', departures: 'departures', inhouse: 'in-house', search: 'reservations', details: 'reservation', list: 'reservations',
    billing: 'folio lines', rooms: 'rooms', profile: 'profile', traces: 'traces', rates: 'rate lines', group: 'rooming list lines', audit: 'night audit lines', other: 'table lines' };
  /** "read 42 departures" / "read 1 reservation" */
  function summary(kind, n, total) {
    var w = KIND_WORD[kind] || 'lines';
    if (kind === 'billing') return 'read the folio' + (n ? ' (' + n + ' line' + (n === 1 ? '' : 's') + ')' : '');
    if (kind === 'profile') return 'read ' + (n === 1 ? 'a profile' : n + ' profiles');
    if (n === 1 && /s$/.test(w) && / /.test(w)) w = w.replace(/s$/, '');
    if (n === 1 && kind === 'rooms') w = 'room';
    if (n === 1 && kind === 'traces') w = 'trace';
    if (n === 1 && /s$/.test(w)) w = kind === 'arrivals' ? 'arrival' : kind === 'departures' ? 'departure' : kind === 'inhouse' ? 'in-house guest' : 'reservation';
    return 'read ' + n + (total && total > n ? ' of ' + total : '') + ' ' + w;
  }
  /** "1-25 of 42", "Total: 42", "42 records" next to a list → 42 */
  function totalOf(text) {
    var t = sp(text), m = t.match(/\bof\s+(\d{1,5})\b/i) || t.match(/\btotal\s*(?:records|results|reservations|rows)?\s*[:=]?\s*(\d{1,5})\b/i) || t.match(/\b(\d{1,5})\s+(?:records|results|reservations|rows|items)\b/i);
    return m ? +m[1] : 0;
  }

  /** the lines of a postings grid → [{date, code, desc, amount, ref, window, pay}] (payments: the type only, no reference) */
  function postingsFrom(rows, map, order, win) {
    var out = [];
    (rows || []).forEach(function (cells) {
      var c = function (f) { return map[f] === undefined ? '' : sp(cells[map[f]] == null ? '' : cells[map[f]]).trim(); };
      var code = clip(c('code'), 20), desc = clip(maskCards(c('desc')), 60);
      if (!code && !desc) return;
      var amt = money(c('amount')), dr = money(c('debit')), cr = money(c('credit'));
      if (amt == null && dr == null && cr == null) return;
      if (amt == null) amt = Math.round(((dr || 0) - (cr || 0)) * 100) / 100;
      var pt = payType(desc) || payType(code);
      var isPay = (cr != null && cr > 0) || (amt < 0 && (!!pt || /pay|paid|settle|refund|deposit/i.test(desc))) || (!!pt && /pay|paid|settle/i.test(desc + ' ' + code));
      var p = { code: code, amount: amt };
      var d = parseDate(c('date'), order); if (d) p.date = d;
      if (isPay) { p.pay = pt || 'Payment'; p.desc = pt ? pt + ' payment' : 'Payment'; }   // never the card, the auth code or the reference of a payment
      else { p.desc = desc; var ref = clip(maskCards(c('ref')), 40); if (ref && !NO.test(ref)) p.ref = ref; }
      var w = int(c('window')); if (w >= 1 && w <= 8) p.window = w; else if (win) p.window = win;
      var q = int(c('qty')); if (q != null && q > 1 && q < 1000) p.qty = q;
      out.push(p);
    });
    return out.slice(0, 200);
  }
  /** windows read on screen + postings + label pairs → the folio {windows, balance, pays, settled, zero} */
  function folioFrom(wins, posts, pairs) {
    var W = {}, total = null, settledWord = false, status = '';
    (wins || []).forEach(function (w) { if (w && w.n >= 1 && w.n <= 8) { W[w.n] = W[w.n] || { n: w.n }; if (w.balance != null && W[w.n].balance == null) W[w.n].balance = w.balance; } });
    (pairs || []).forEach(function (p) {
      var l = sp(p[0]), v = sp(p[1]), m = l.match(/\bwindow\s*#?\s*([1-8])\b/i);
      if (m) { var n = +m[1], b = money(v); W[n] = W[n] || { n: n }; if (b != null && W[n].balance == null) W[n].balance = b; return; }
      var f = fieldOf(l);
      if (f === 'balance' && total == null) total = money(v);
      else if (/^total\b|\btotal\s*(?:due|balance|amount)\b/i.test(l) && total == null) total = money(v);
      if (/\bsettled\b|zero\s*balance|paid\s*in\s*full|\bclosed\b/i.test(v) && /status|folio|balance|state/i.test(l)) settledWord = true;
      if (f === 'status' && !status) status = normStatus(v);
    });
    var windows = Object.keys(W).map(function (k) { return W[k]; }).sort(function (a, b) { return a.n - b.n; });
    posts = posts || [];
    if (total == null && windows.length && windows.every(function (w) { return w.balance != null; })) total = Math.round(windows.reduce(function (a, w) { return a + w.balance; }, 0) * 100) / 100;
    if (total == null && posts.length) total = Math.round(posts.reduce(function (a, p) { return a + (p.amount || 0); }, 0) * 100) / 100;
    if (windows.length === 1 && windows[0].balance == null && total != null) windows[0].balance = total;
    var pays = []; posts.forEach(function (p) { if (p.pay && pays.indexOf(p.pay) < 0) pays.push(p.pay); });
    var F = { windows: windows, postings: posts, pays: pays };
    if (total != null) { F.balance = total; F.zero = Math.abs(total) < 0.005; }
    F.settled = settledWord || (!!F.zero && (posts.length > 0 || windows.length > 0));
    if (status) F.status = status;
    return F;
  }
  /** the lines of a traces / alerts grid → [{date, time, dept, text, done, room, name, conf}] */
  function tracesFrom(rows, map, order) {
    var out = [];
    (rows || []).forEach(function (cells) {
      var c = function (f) { return map[f] === undefined ? '' : sp(cells[map[f]] == null ? '' : cells[map[f]]).trim(); };
      var text = clip(maskCards(c('text')), 200); if (!text) return;
      var t = { text: text };
      var d = parseDate(c('date'), order); if (d) t.date = d;
      var tm = c('time').match(/\b(\d{1,2}:\d{2})/) || c('date').match(/\b(\d{1,2}:\d{2})/); if (tm) t.time = tm[1];
      var dp = clip(c('dept'), 30); if (dp && !NO.test(dp)) t.dept = dp;
      var dn = c('done'); if (dn) t.done = !NO.test(dn) && !/^(?:open|new|pending|unresolved|not resolved|active)$/i.test(dn);
      var rm = roomOf(c('room')); if (rm) t.room = rm;
      var nm = clip(c('name').split('\n')[0], 80); if (nm) t.name = nm;
      var cf = confOf(c('conf')); if (cf) t.conf = cf;
      out.push(t);
    });
    return out.slice(0, 150);
  }
  /** any other grid → a plain table {title, heads, rows} (card / password columns dropped, 300 lines, 80 characters a cell) */
  function tableFrom(head, rows, title) {
    var keep = [];
    (head || []).forEach(function (h, i) { if (sp(h).trim() && !secretLabel(h)) keep.push(i); });
    if (!keep.length) return null;
    var out = [];
    for (var i = 0; i < (rows || []).length && out.length < 300; i++) {
      var line = keep.map(function (k) { return clip(maskCards(rows[i][k] == null ? '' : rows[i][k]), 80); });
      if (line.some(Boolean)) out.push(line);
    }
    if (!out.length) return null;
    return { title: clip(title || '', 60), heads: keep.map(function (k) { return clip(head[k], 40); }), rows: out };
  }
  /** label → value pairs kept as they are (a reservation's every detail): no card / password / ID labels, 60 at most */
  function pairsExtra(pairs) {
    var out = [], seen = {};
    (pairs || []).forEach(function (p) {
      var l = clip(p[0], 40), v = clip(maskCards(p[1]), 120);
      if (!l || !v || secretLabel(l) || seen[l] || out.length >= 60) return;
      seen[l] = 1; out.push([l, v]);
    });
    return out;
  }
  /** night audit state from what its screen says → 'failed' | 'running' | 'done' | '' */
  function auditState(texts) {
    var t = (texts || []).join(' \n ').toLowerCase(); if (!t) return '';
    if (/\bfail(?:ed|ure)?\b|\berror\b|\baborted\b/.test(t)) return 'failed';
    if (/in\s*progress|\brunning\b|\bprocessing\b|\bstarted\b|\bpending\b/.test(t)) return 'running';
    if (/\bcomplete(?:d)?\b|\bfinished\b|\bsuccess(?:ful)?\b|\bdone\b/.test(t)) return 'done';
    return '';
  }
  // ── learning from you: the label of what you clicked, never guest data ──
  /** a button / link label as it may be kept: short words only — no numbers of 3+ digits, amounts, emails, commas ("Doe, John") */
  function cleanLabel(s) {
    var t = sp(s).replace(/\s+/g, ' ').trim();
    if (!t || t.length > 60 || /\d{3,}|@|,|\d[.,]\d|•/.test(t)) return '';
    t = t.replace(/[^\p{L}\p{N}&\/+.'\- ]/gu, ' ').replace(/\s+/g, ' ').replace(/^[\s.\-]+|[\s.\-]+$/g, '').trim();
    if (!t || /\d{3,}|@|,|\d[.,]\d|•/.test(t) || !/\p{L}{2,}/u.test(t) || t.split(' ').length > 6) return '';
    return t.slice(0, 40).trim();
  }
  /** a screen's title as it may be kept: the part before " - ", "|", ":", "(" or a comma, cleaned like a label */
  function safeTitle(s) { return cleanLabel(sp(s).split(/\s[-–—|:]\s|[,(|:]/)[0]); }

  var H = { maskCards: maskCards, secretLabel: secretLabel, scrub: scrub, payType: payType, normRoomStatus: normRoomStatus, postFieldOf: postFieldOf, traceFieldOf: traceFieldOf, usablePost: usablePost, usableTrace: usableTrace,
    postingsFrom: postingsFrom, folioFrom: folioFrom, tracesFrom: tracesFrom, tableFrom: tableFrom, pairsExtra: pairsExtra, auditState: auditState, cleanLabel: cleanLabel, safeTitle: safeTitle,
    normH: normH, fieldOf: fieldOf, mapHeaders: mapHeaders, usable: usable, parseDate: parseDate, dateOrder: dateOrder, findDate: findDate, normStatus: normStatus, money: money,
    roomOf: roomOf, roomKey: roomKey, nameKey: nameKey, confOf: confOf, emailOf: emailOf, rowFrom: rowFrom, finishRows: finishRows, rowKey: rowKey, mergeRows: mergeRows, pairsToRow: pairsToRow,
    kindOfText: kindOfText, pageKind: pageKind, hash: hash, summary: summary, totalOf: totalOf, FIELDS: FIELDS, VERSION: VERSION };
  if (typeof module !== 'undefined' && module.exports) { module.exports = H; return; }
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // ── where it runs ─────────────────────────────────────────
  var EXT = window.__hoOpExt || null;
  var OPERA_HOST = /(^|\.)(oraclecloud|oracleindustry|oraclehospitality)\.com$/i;
  if (!OPERA_HOST.test(location.hostname) && !window.__hoOpTest) { if (!EXT) alert('HotelOps: paste this in the Opera Cloud tab, not here.'); return; }
  if (!EXT && /__HO_APP_URL__/.test(APP_URL)) { alert('HotelOps: copy this from HotelOps (Settings → Opera reader), so it knows where to send what it reads.'); return; }
  if (window.__hoOp && window.__hoOp.stop) window.__hoOp.stop(true);
  var APP_ORIGIN = ''; try { APP_ORIGIN = new URL(APP_URL).origin; } catch (_) {}
  var TOP = (function () { try { return window.top === window; } catch (_) { return false; } })();
  var FRAME = Math.random().toString(36).slice(2, 8);
  var LS = { get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } }, set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
  var stopped = false, win = null, linked = 0, lastAck = null, deb = 0, iv = 0, obs = null, pillHost = null;
  var view = { key: '', kind: '', date: '', rows: [], title: '', total: 0 }, sentHash = '', sentAt = 0, sentN = 0, lastErr = '';
  var frames = {};   // other frames of this tab that read something (the pill in the top frame shows all)

  // ── reading the screen ────────────────────────────────────
  var GRID_SEL = 'table, [role="grid"], [role="table"], [role="treegrid"]';
  var ROW_SEL = 'tr, [role="row"]';
  var CELL_SEL = 'th, td, [role="columnheader"], [role="gridcell"], [role="cell"], [role="rowheader"]';
  var mine = function (el) { return pillHost && (el === pillHost || pillHost.contains(el)); };
  function txt(el) {
    if (!el) return '';
    var t = sp(el.textContent).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();   // textContent: reading it never makes Opera lay the page out again
    if (!t && el.querySelector) {
      var a = el.getAttribute && (el.getAttribute('title') || el.getAttribute('aria-label'));
      var b = el.querySelector('[title],[aria-label]'), inp = el.querySelector('input:not([type=checkbox]):not([type=radio]):not([type=password]), textarea, select');
      t = a || (inp && !secretInput(inp) && inp.value) || (b && (b.getAttribute('title') || b.getAttribute('aria-label'))) || '';
    }
    t = sp(t).trim();
    return t.length >= 12 && /\d[\d \-]{10,}\d|[Xx*•]{4}/.test(t) ? maskCards(t) : t;   // a card number never leaves as it is
  }
  /** an input's value, unless it is a password / PIN / card field */
  function valOf(e) { return e && !secretInput(e) && e.value != null ? String(e.value) : ''; }
  function cellsOf(row) {
    if (row.tagName === 'TR' && row.cells) return Array.prototype.slice.call(row.cells);   // a plain table row: its cells, no search
    var out = [];
    row.querySelectorAll(CELL_SEL).forEach(function (c) { if (c.closest(ROW_SEL) === row) out.push(c); });
    return out;
  }
  function colOf(cell, i) { var n = parseInt(cell.getAttribute('aria-colindex'), 10); return n > 0 ? n - 1 : i; }
  function isHead(c) { return c.tagName === 'TH' || c.getAttribute('role') === 'columnheader'; }
  function gridOf(el) { var p = el.parentElement; return p ? p.closest(GRID_SEL) : null; }
  /** one grid → {head: [texts by column], rows: [[texts by column]], el} */
  function readGrid(g) {
    var head = null, rows = [];
    g.querySelectorAll(ROW_SEL).forEach(function (r) {
      if (r.closest(GRID_SEL) !== g || mine(r)) return;
      var cs = cellsOf(r); if (!cs.length) return;
      var h = cs.filter(isHead).length;
      if ((h && h >= cs.length / 2) || (!head && r.parentElement && r.parentElement.tagName === 'THEAD')) {   // a header line (the last one with the most columns wins: grouped headers)
        var line = []; cs.forEach(function (c, i) { line[colOf(c, i)] = txt(c) || c.getAttribute('aria-label') || ''; });
        if (!head || line.filter(Boolean).length >= head.filter(Boolean).length) head = line;
        return;
      }
      var line2 = []; cs.forEach(function (c, i) { line2[colOf(c, i)] = txt(c); });
      if (line2.some(Boolean)) rows.push(line2);
    });
    return { el: g, head: head, rows: rows };
  }
  function depthTo(a, b) { var n = 0; for (var e = a; e && n < 8; e = e.parentElement, n++) if (e.contains(b)) return n; return 99; }
  /** every grid on screen → guest lines (header-only grids are paired with the body grid next to them: split headers).
   *  The grids that aren't guest lists come back too: a folio's postings, traces, and anything else as a plain table. */
  function readGrids(doc, hint) {
    var gs = [];
    doc.querySelectorAll(GRID_SEL).forEach(function (g) { if (!mine(g)) gs.push(readGrid(g)); });
    var kindOfHead = function (h) {
      if (!h) return '';
      var mg = mapHeaders(h), mt = mapHeaders(h, traceFieldOf);
      if (hint === 'traces' && usableTrace(mt)) return 'trace';
      if (usable(mg)) return 'guest';
      if (usablePost(mapHeaders(h, postFieldOf))) return 'post';
      if (usableTrace(mt)) return 'trace';
      return h.filter(Boolean).length >= 2 ? 'other' : '';
    };
    var heads = gs.filter(function (g) { return g.head && !g.rows.length && (g.hk = kindOfHead(g.head)); });
    var out = [], total = 0, post = [], trace = [], other = [];
    gs.forEach(function (g) {
      if (!g.rows.length) return;
      var head = g.head, k = head ? kindOfHead(head) : '';
      if (!k || (k === 'other' && heads.length)) {
        var w = Math.max.apply(null, g.rows.map(function (r) { return r.length; })), best = null, bd = 99;
        heads.forEach(function (h) {
          if (h.el.compareDocumentPosition(g.el) & 4 && Math.abs(h.head.length - w) <= 1) { var d = depthTo(h.el, g.el); if (d < bd) { bd = d; best = h; } }
        });
        if (best && bd <= 6) { head = best.head; k = best.hk; }
      }
      if (!k) return;
      var hk = head.map(normH).join('|'), h0 = normH(head[0] || '');
      var body = g.rows.filter(function (cells) { return !(normH(cells[0] || '') === h0 && cells.map(normH).join('|') === hk); });   // the header repeated as a line (checked fully only when it could be)
      if (k === 'post') { post.push({ head: head, rows: body, map: mapHeaders(head, postFieldOf).map, el: g.el }); return; }
      if (k === 'trace') { trace.push({ head: head, rows: body, map: mapHeaders(head, traceFieldOf).map }); return; }
      if (k === 'other') { if (other.length < 4) other.push({ head: head, rows: body }); return; }
      var m = mapHeaders(head);
      body.forEach(function (cells) { var r = rowFrom(cells, m.map); if (r.room || r.conf || r.name) out.push(r); });
      // "1–25 of 42" near the grid
      var box = g.el.parentElement; for (var i = 0; i < 3 && box && box.parentElement; i++) box = box.parentElement;
      if (box) box.querySelectorAll('[class*="pag" i], [class*="count" i], [class*="total" i], [role="status"]').forEach(function (e) { if (!mine(e) && !total) total = totalOf(txt(e).slice(0, 80)); });
    });
    return { raw: out, total: total, post: post, trace: trace, other: other };
  }
  /** label → value pairs on screen (reservation details), outside the grids. Never a password, PIN or card field. */
  function readPairs(doc) {
    var pairs = [], seen = new Set();
    var add = function (l, v, el) { l = sp(l).replace(/[:*]\s*$/, '').trim(); v = sp(v).trim(); if (!l || !v || l.length > 40 || v.length > 200 || seen.has(l + '|' + v) || secretLabel(l)) return; if (el && (el.closest(GRID_SEL) || mine(el))) return; seen.add(l + '|' + v); pairs.push([l, maskCards(v)]); };
    var field = function (n) { return n && n.querySelector ? n.querySelector('input,textarea,select') : null; };
    doc.querySelectorAll('label').forEach(function (l) {
      var id = l.getAttribute('for'), t = id ? doc.getElementById(id) : null, v = '';
      if (t) { if (secretInput(t)) return; v = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) ? valOf(t) : txt(t); }
      else { var n = l.nextElementSibling; if (n) { var f = field(n); if (f && secretInput(f)) return; v = f ? valOf(f) : txt(n); } }
      add(txt(l), v, l);
    });
    doc.querySelectorAll('dt').forEach(function (d) { var n = d.nextElementSibling; if (n && n.tagName === 'DD') add(txt(d), txt(n), d); });
    doc.querySelectorAll('[label-hint]').forEach(function (e) { if (secretInput(e)) return; add(e.getAttribute('label-hint'), e.value != null && e.value !== '' ? String(e.value) : (e.getAttribute('value') || txt(e)), e); });
    doc.querySelectorAll('[class*="label" i]:not(label)').forEach(function (e) {
      if (e.children.length > 2) return;
      var n = e.nextElementSibling; if (!n) return;
      var f = field(n); if (f && secretInput(f)) return;
      add(txt(e), f ? valOf(f) : txt(n), e);
    });
    return pairs.slice(0, 200);
  }
  /** the folio windows shown (tabs "Window 1 · 120.00", "Window 2"…) → [{n, balance}] and the one open */
  function readWindows(doc) {
    var out = [], cur = 0;
    doc.querySelectorAll('[role="tab"], [class*="window" i], [id*="window" i], [class*="folio" i]').forEach(function (e) {
      if (mine(e) || e.closest(GRID_SEL)) return;
      var t = txt(e); if (!t || t.length > 120) return;
      var all = t.match(/\bwindow\b/gi); if (!all || all.length !== 1) return;   // a box holding all the windows: its tabs are read one by one
      var m = t.match(/\bwindow\s*#?\s*([1-8])\b/i); if (!m) return;
      var rest = t.slice(m.index + m[0].length), mm = rest.match(/\(?-?\s*(?:[A-Z]{3}\s*)?-?[\d,]+\.\d{2}\)?(?:\s*CR\b)?/);
      out.push({ n: +m[1], balance: mm ? money(mm[0]) : null });
      if (e.getAttribute('aria-selected') === 'true' || /\b(?:selected|active|current)\b/i.test(e.getAttribute('class') || '')) cur = +m[1];
    });
    return { wins: out, cur: cur };
  }
  function headings(doc) {
    var out = [];
    doc.querySelectorAll('h1, h2, [role="heading"][aria-level="1"], [role="heading"][aria-level="2"], [class*="page-title" i], [class*="pageTitle"], [class*="oj-flex-bar-middle"] h1, [aria-current="page"]').forEach(function (h) { if (!mine(h)) { var t = txt(h); if (t && t.length < 90) out.push(t); } });
    return out.slice(0, 8);
  }
  function screenDate(doc, order) {
    var cand = [];
    doc.querySelectorAll('h1, h2, h3, [role="heading"], [class*="date" i], [id*="date" i], [aria-label*="date" i]').forEach(function (e) {
      if (mine(e) || e.closest(GRID_SEL)) return;
      var t = (e.tagName === 'INPUT' ? e.value : txt(e)) || e.getAttribute('aria-label') || '';
      if (t && t.length < 80) cand.push((/business\s*date/i.test(t) ? '0' : '1') + t);
    });
    cand.sort();
    for (var i = 0; i < cand.length; i++) { var d = findDate(cand[i].slice(1), order); if (d) return d; }
    return '';
  }

  // Never in Opera's way: no reading while you type or click (it waits until you pause), only when the
  // browser is idle, and a screen that takes long to read is read less often.
  var lastUse = 0, cost = 0;
  ['keydown', 'pointerdown', 'input', 'compositionupdate'].forEach(function (t) { window.addEventListener(t, function () { lastUse = Date.now(); }, { capture: true, passive: true }); });
  var SPECIAL = { billing: 1, rooms: 1, audit: 1, traces: 1, profile: 1, rates: 1, group: 1 };
  var REPLACE = { details: 1, billing: 1, profile: 1, traces: 1 };   // one thing on screen: the newest read replaces the last one
  function scan() {
    if (stopped) return;
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    try {
      var order = (navigator.language || '').toLowerCase() === 'en-us' ? 'mdy' : '';
      var heads = headings(document);
      var parts = [document.title].concat(heads, [location.pathname + ' ' + location.hash]);
      var hint = pageKind(parts, []);   // what the words on screen say it is
      var g = readGrids(document, hint);
      var rows = finishRows(g.raw, order);
      // label → value pairs only where they matter (a long list with nothing else is read without them: fast)
      var pairs = !rows.length || hint === 'billing' || hint === 'profile' || hint === 'details' || hint === 'traces' || g.post.length ? readPairs(document) : [];
      var det = null;
      if (!rows.length && pairs.length) det = pairsToRow(pairs, order) || (hint === 'billing' || hint === 'profile' || hint === 'traces' || g.post.length ? pairsToRow(pairs, order, true) : null);
      if (det) rows = [det];
      var kind = pageKind(parts, rows);
      if (g.post.length) kind = 'billing';   // a folio's postings: Billing / Check Out / Cashiering, whatever the title says
      else if (g.trace.length && (!g.raw.length || hint === 'traces')) kind = 'traces';
      else if (det && kind !== 'details' && !g.raw.length && !SPECIAL[kind]) kind = 'details';
      if (!kind && g.other.length) kind = 'other';
      var folio = null, traces = [], tables = [], audit = null;
      if (kind === 'billing') {
        var w = readWindows(document), posts = [];
        g.post.forEach(function (p) { posts = posts.concat(postingsFrom(p.rows, p.map, order, w.cur)); });
        folio = folioFrom(w.wins, posts.slice(0, 200), pairs);
        var who = det || {}, hm = !who.room && heads.join(' ').match(/\broom\s*(?:no\.?|#)?\s*:?\s*([A-Z]?\d{1,5}[A-Z]?)\b/i);
        if (hm) who = { room: roomOf(hm[1]), name: who.name, conf: who.conf, status: who.status };
        ['room', 'name', 'conf'].forEach(function (f) { if (who[f]) folio[f] = who[f]; });
        if (who.status && !folio.status) folio.status = who.status;
        rows = [];
        if (who.room || who.conf || who.name) { var fr = { balance: folio.balance }; ['room', 'name', 'conf', 'status', 'statusText', 'arrival', 'departure'].forEach(function (f) { if (who[f]) fr[f] = who[f]; }); if (fr.balance == null) delete fr.balance; rows = [fr]; }
      }
      g.trace.forEach(function (t) { traces = traces.concat(tracesFrom(t.rows, t.map, order)); });
      if (det) traces.forEach(function (t) { ['room', 'name', 'conf'].forEach(function (f) { if (!t[f] && det[f]) t[f] = det[f]; }); });
      if (det && (kind === 'details' || kind === 'profile' || kind === 'traces')) det.extra = pairsExtra(pairs);
      if (kind === 'rooms') rows.forEach(function (r) { if (!r.rs && r.statusText) { var x = normRoomStatus(r.statusText); if (x) { r.rs = x; r.roomStatus = r.statusText; delete r.status; } } });
      g.other.forEach(function (o) { var tb = tableFrom(o.head, o.rows, heads[0] || document.title); if (tb) tables.push(tb); });
      if (kind === 'audit') { var tx = heads.slice(); tables.forEach(function (tb) { tb.rows.forEach(function (r) { tx.push(r.join(' ')); }); }); pairs.forEach(function (p) { tx.push(p[0] + ' ' + p[1]); }); audit = { state: auditState(tx) }; }
      var date = screenDate(document, order);
      var key = kind + '|' + date + '|' + (heads[0] || document.title || '').replace(/\d+/g, '#').slice(0, 60);   // "Arrivals (42)" while it loads is the same screen
      if (key !== view.key) { view = { key: key, kind: kind, date: date, rows: [], title: (heads[0] || document.title || '').slice(0, 90), total: 0 }; noteScreen(kind, view.title); }
      view.rows = REPLACE[kind] ? rows : mergeRows(view.rows, rows);
      if (view.rows.length > 1500) view.rows = view.rows.slice(-1500);
      if (g.total) view.total = g.total;
      view.folio = folio; view.traces = traces; view.tables = tables; view.audit = audit;
      send();
      render();
    } catch (e) { lastErr = String(e && e.message || e).slice(0, 120); }
    var took = ((window.performance && performance.now) ? performance.now() : Date.now()) - t0;
    cost = cost ? cost * 0.7 + took * 0.3 : took;
  }
  var lastScan = 0;
  var idle = window.requestIdleCallback ? function (f) { window.requestIdleCallback(f, { timeout: 3000 }); } : function (f) { setTimeout(f, 0); };
  function laterScan(ms) {
    if (deb || stopped) return;
    // at most every 2 s (10 s in the background); a heavy screen waits 40× what one read takes (a 50 ms read → every 2 s, 100 ms → 4 s)
    var gap = Math.max(document.hidden ? 10000 : 2000, cost * 40);
    ms = Math.max(ms, lastScan + gap - Date.now());
    deb = setTimeout(function run() {
      if (Date.now() - lastUse < 1200) { deb = setTimeout(run, 1200 - (Date.now() - lastUse) + 50); return; }   // you're typing or clicking: wait for the pause
      idle(function () { deb = 0; lastScan = Date.now(); scan(); });
    }, ms);
  }

  // ── learning from you ("watch me"): the screens you open and the label of what you click ──
  // One passive listener that only notes a label: nothing typed, no keys, no input values, never the words of a
  // list's line (that is guest data — it is noted as "a line of the list"). Cleaned before it is sent.
  var LEARN = LS.get('ho_op_learn', true) !== false, steps = [], flushT = 0, lastScreen = '', hintNow = null;
  var CLICK_SEL = 'button, a, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="tab"], [role="link"], [role="option"], [role="treeitem"], summary';
  function onClickLearn(e) {
    if (!LEARN || stopped) return;
    var t = e.target; if (t && t.nodeType !== 1) t = t.parentElement;
    var b = t && t.closest ? t.closest(CLICK_SEL) : null; if (!b || mine(b)) return;
    if (b.closest(GRID_SEL)) steps.push({ t: Date.now(), k: 'r' });
    else { var l = b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || ''; if (l.length > 120) return; steps.push({ t: Date.now(), k: 'c', l: l }); }
    if (steps.length > 200) steps.splice(0, steps.length - 200);
    if (!flushT) flushT = setTimeout(flushLearn, 1500);
  }
  function noteScreen(kind, title) {
    if (!LEARN) return;
    var s = kind || 'other', ti = safeTitle(title), k = s + '|' + ti;
    if (k === lastScreen) return; lastScreen = k;
    steps.push({ t: Date.now(), k: 's', s: s, l: ti });
    if (!flushT) flushT = setTimeout(flushLearn, 1500);
  }
  function flushLearn() {
    flushT = 0; if (!steps.length || stopped) return;
    var out = [];
    steps.forEach(function (x) { if (x.k === 'c') { var l = cleanLabel(x.l); if (l) out.push({ t: x.t, k: 'c', l: l }); } else out.push(x); });
    if (!out.length || post({ source: 'ho-op', v: VERSION, learn: out, frame: FRAME })) steps = [];
  }
  window.addEventListener('click', onClickLearn, { capture: true, passive: true });

  // ── talking to HotelOps ───────────────────────────────────
  function post(o) {
    try {
      if (EXT && typeof EXT.post === 'function') { EXT.post(o); return true; }
      if (win && !win.closed) { win.postMessage(o, APP_ORIGIN); return true; }
    } catch (_) {}
    return false;
  }
  function send(force) {
    var more = view.folio || (view.traces && view.traces.length) || (view.tables && view.tables.length);
    if ((!view.rows.length && !more) || !view.kind) return;
    var snap = { id: view.key, kind: view.kind, date: view.date, title: view.title, total: view.total || 0, rows: view.rows, frame: FRAME, url: location.hostname + location.pathname };
    if (view.folio) snap.folio = view.folio;
    if (view.traces && view.traces.length) snap.traces = view.traces;
    if (view.tables && view.tables.length) snap.tables = view.tables;
    if (view.audit) snap.audit = view.audit;
    var h = more ? hash([snap.kind, snap.date, snap.rows, snap.folio || 0, snap.traces || 0, snap.tables || 0, snap.audit || 0]) : hash([snap.kind, snap.date, snap.rows]);
    if (!force && h === sentHash) return;
    if (!force && Date.now() - sentAt < 2500) { laterScan(2600); return; }   // a list still loading: at most one snapshot every few seconds
    if (post({ source: 'ho-op', v: VERSION, h: h, snap: scrub(snap), at: Date.now() })) { sentHash = h; sentAt = Date.now(); sentN = snap.rows.length || (snap.folio ? snap.folio.postings.length : 0) || (snap.traces || snap.tables || []).length; }
    if (!TOP) try { window.top.postMessage({ __hoOpFrame: 1, id: FRAME, kind: view.kind, n: view.rows.length, total: view.total || 0 }, '*'); } catch (_) {}
  }
  function onMsg(d) {
    if (!d || typeof d !== 'object') return;
    if (d.source !== 'ho-op-ack') return;
    linked = Date.now();
    if (d.h && d.text) lastAck = { text: String(d.text).slice(0, 140), at: Date.now() };
    if (typeof d.learn === 'boolean' && d.learn !== LEARN) { LEARN = d.learn; LS.set('ho_op_learn', LEARN); if (!LEARN) steps = []; }   // "Learn from me in Opera" (HotelOps → Settings)
    if (typeof d.hint === 'string') hintNow = d.hint ? { text: d.hint.slice(0, 60), at: Date.now() } : null;
    if (d.again && (!d.frame || d.frame === FRAME)) { sentHash = ''; send(true); }   // HotelOps (re)opened and hasn't got what is on screen
    render();
  }
  if (EXT && typeof EXT.on === 'function') EXT.on(onMsg);
  function onWinMsg(e) {
    if (e.data && e.data.__hoOpFrame && TOP) { frames[e.data.id] = { kind: String(e.data.kind || ''), n: +e.data.n || 0, total: +e.data.total || 0, at: Date.now() }; render(); return; }
    if (!EXT && e.origin === APP_ORIGIN) onMsg(e.data);
  }
  window.addEventListener('message', onWinMsg);
  function connect() {
    if (EXT) return;
    if (!win || win.closed) win = window.open(APP_URL + '#opera-reader', 'hotelops-op');
    sentHash = ''; setTimeout(function () { tick(); send(true); }, 1500);
  }
  function tick() {
    if (steps.length) flushLearn();
    post({ source: 'ho-op', ping: 1, t: Date.now(), v: VERSION, frame: FRAME, h: view.rows.length ? sentHash : '' });
    Object.keys(frames).forEach(function (k) { if (Date.now() - frames[k].at > 120000) delete frames[k]; });
    render();
  }

  // ── the pill (top frame only; another frame's reads show here too) ──
  var pill, dot, line, sub, btn, minB, isMin = LS.get('ho_op_min', false);
  function el(tag, css, text) { var e = document.createElement(tag); if (css) Object.assign(e.style, css); if (text != null) e.textContent = text; return e; }
  function build() {
    if (!TOP || !document.body) return;
    pillHost = el('div', { position: 'fixed', right: '14px', bottom: '14px', zIndex: '2147483646', font: '600 12px system-ui,-apple-system,Segoe UI,sans-serif', pointerEvents: 'auto' });
    pillHost.setAttribute('data-hotelops', 'opera-reader');
    var root = pillHost.attachShadow ? pillHost.attachShadow({ mode: 'open' }) : pillHost;
    pill = el('div', { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px 6px 11px', borderRadius: '999px', background: 'rgba(17,24,39,.92)', color: '#e5edf7', boxShadow: '0 6px 20px rgba(0,0,0,.28)', border: '1px solid rgba(255,255,255,.12)', maxWidth: '360px' });
    var txtBox = el('div', { display: 'flex', flexDirection: 'column', minWidth: '0', lineHeight: '1.25' });
    line = el('span', { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
    sub = el('span', { font: '500 11px system-ui,sans-serif', color: '#9fb0c4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
    txtBox.appendChild(line); txtBox.appendChild(sub);
    btn = el('button', { border: '0', borderRadius: '999px', padding: '5px 10px', background: '#c9a14a', color: '#111', font: '700 11.5px system-ui,sans-serif', cursor: 'pointer', display: 'none' }, 'Connect');
    btn.addEventListener('click', connect);
    minB = el('button', { border: '0', background: 'transparent', color: '#9fb0c4', font: '700 14px system-ui,sans-serif', cursor: 'pointer', padding: '0 4px' }, '–');
    minB.title = 'Make it small'; minB.addEventListener('click', function () { setMin(true); });
    pill.appendChild(txtBox); pill.appendChild(btn); pill.appendChild(minB);
    dot = el('button', { width: '30px', height: '30px', borderRadius: '50%', border: '1px solid rgba(255,255,255,.15)', background: 'rgba(17,24,39,.85)', color: '#fff', cursor: 'pointer', fontSize: '14px', display: 'none', boxShadow: '0 4px 14px rgba(0,0,0,.25)' }, '📡');
    dot.addEventListener('click', function () { setMin(false); });
    root.appendChild(pill); root.appendChild(dot);
    document.body.appendChild(pillHost);
    setMin(isMin, true);
  }
  function setMin(on, quiet) { isMin = !!on; if (!quiet) LS.set('ho_op_min', isMin); if (pill) pill.style.display = isMin ? 'none' : 'flex'; if (dot) dot.style.display = isMin ? 'block' : 'none'; render(); }
  function render() {
    if (!TOP || !pillHost) return;
    var isLinked = Date.now() - linked < 45000;
    var n = view.rows.length, kind = view.kind, total = view.total;
    Object.keys(frames).forEach(function (k) { if (frames[k].n > n) { n = frames[k].n; kind = frames[k].kind; total = frames[k].total; } });
    var what = n ? summary(kind, n, total) : 'watching Opera';
    line.textContent = '📡 HotelOps · ' + what;
    sub.textContent = !isLinked ? (EXT ? 'linking to HotelOps… (keep HotelOps open)' : 'not linked — press Connect (HotelOps opens)')
      : hintNow && Date.now() - hintNow.at < 120000 ? '🧠 ' + hintNow.text
      : lastAck && Date.now() - lastAck.at < 600000 ? 'HotelOps: ' + lastAck.text : 'linked · only reads, never changes Opera';
    btn.style.display = !EXT && !isLinked ? 'inline-block' : 'none';
    dot.title = line.textContent + ' — ' + sub.textContent;
    dot.style.borderColor = isLinked ? 'rgba(52,211,153,.8)' : 'rgba(251,191,36,.8)';
  }

  function stop(silent) {
    stopped = true;
    try { if (obs) obs.disconnect(); } catch (_) {}
    clearInterval(iv); clearTimeout(deb);
    window.removeEventListener('message', onWinMsg);
    window.removeEventListener('click', onClickLearn, { capture: true });
    clearTimeout(flushT);
    try { if (pillHost) pillHost.remove(); } catch (_) {}
    window.__hoOp = null;
    if (!silent) try { console.log('HotelOps Opera reader stopped.'); } catch (_) {}
  }

  // ── start ─────────────────────────────────────────────────
  build();
  obs = new MutationObserver(function (recs) {
    if (deb) return;   // a read is already planned: nothing to do
    for (var i = 0; i < recs.length; i++) { var t = recs[i].target; if (t && !mine(t.nodeType === 1 ? t : t.parentElement)) { laterScan(800); return; } }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.addEventListener('scroll', function () { if (!deb) laterScan(700); }, { capture: true, passive: true });
  window.addEventListener('hashchange', function () { laterScan(300); });
  iv = setInterval(tick, 15000);
  window.__hoOp = { stop: stop, scan: scan, connect: connect, min: setMin, v: VERSION,
    state: function () { return { kind: view.kind, date: view.date, title: view.title, total: view.total, rows: view.rows.slice(), folio: view.folio || null, traces: (view.traces || []).slice(), tables: (view.tables || []).slice(), audit: view.audit || null,
      sent: sentN, sentAt: sentAt, linked: Date.now() - linked < 45000, ack: lastAck, err: lastErr, ext: !!EXT, frame: FRAME, learn: LEARN, steps: steps.length, hint: hintNow, cost: Math.round(cost * 10) / 10 }; } };
  if (TOP && !EXT) try { console.log('%c 📡 HotelOps Opera reader is running ✓ %c Press "Connect" on the pill (bottom right). It only reads; it never changes anything in Opera.', 'background:#111827;color:#fbbf24;font:700 13px system-ui;padding:4px 8px;border-radius:6px', 'color:#9aa3b2;font:12px system-ui'); } catch (_) {}
  setTimeout(scan, 600);
  setTimeout(tick, 1200);
})();

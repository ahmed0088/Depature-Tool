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
 * A small HotelOps window sits bottom right (a Shadow DOM, so Opera's styles can't touch it): drag it by its top bar,
 * – makes it a round 📡 badge (place and size kept per host; the first time it turns into the badge after a minute).
 * Tabs: Now (the screen, rows read, what HotelOps did, Undo hint, "Usually next"), Today (a timeline, kept in memory only)
 * and 🛟 Help ("Not read right?", "Copy screen layout", how it links). Not linked after 10 s: a checklist that says which
 * it is when it can tell (no HotelOps tab, HotelOps silent, the helper not answering), with 🔁 Retry link / Open HotelOps.
 *
 * When it can't read a screen (a grid whose headers it can't match, a screen it doesn't know, rows without a room / conf. /
 * name, no date on Arrivals / Departures, the same error twice) it sends HotelOps a report of the screen's LAYOUT: headers,
 * how each was mapped, value shapes ("Aaaa, Aaaa", "99/99/9999"), DOM hints. Never a value; refused when anything in it
 * still looks like guest data. Once per screen and day, built inside the idle read. HotelOps → Settings → Opera reader →
 * "📋 Copy for Claude". What the hotel taught it there (a column, a screen) is checked before its own words.
 * 🛡 Away guard: while you're away (HotelOps: the same Away as the WhatsApp guard, "🔒 Lock Opera now", or N idle minutes here),
 * an opaque lock screen covers Opera in every frame it runs in, and the mouse, touch and keys are kept from Opera (stopped in the
 * capture phase; nothing in Opera is clicked, typed or changed). It unlocks with your PIN (checked against a salted SHA-256 HotelOps
 * sends, never the PIN; 3 wrong → 1 minute wait) or from HotelOps. Touches, PIN tries and anyone removing the screen go to HotelOps,
 * which alerts your phone. Kept per tab in sessionStorage (a reload stays locked).
 * The lock screen is shared with the WhatsApp reader (the <ho-lock> block, the same in both). With the helper, a new Opera tab
 * asks the helper's relay whether you're away (it remembers it, even with HotelOps closed) and locks at once; a PIN typed
 * here unlocks the other locked tabs through the relay too.
 * Built with DOM calls and inline styles only (no innerHTML, no <style>), so Opera's page rules don't
 * block it. Pure helpers are exported for the Node tests (tests/run-tests.js).
 */
(function () {
  'use strict';
  var APP_URL = '__HO_APP_URL__';
  var VERSION = '1';
  var READER_REV = 2;   // the reader's own revision: stuck reports from before r2 (Opera's menus and layout tables taken for grids) are cleared by HotelOps

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
  // what the hotel taught it (HotelOps → the Brain asked "this column 'Leaving On' — is it…?"): header words → field, screen title → kind.
  // Checked before its own words. "-" = a column it should leave alone.
  var TAUGHT = { h: {}, s: {} }, taughtGen = 0;
  var GUEST_FIELDS = {}; 
  /** set the taught mappings (from HotelOps); clears what the mappers remembered */
  function setTaught(t) {
    var o = { h: {}, s: {} };
    if (t && typeof t === 'object') {
      Object.keys(t.h || {}).slice(0, 300).forEach(function (k) { var f = String(t.h[k] || ''); if (f === '-' || GUEST_FIELDS[f]) o.h[normH(k)] = f; });
      Object.keys(t.s || {}).slice(0, 100).forEach(function (k) { var v = String(t.s[k] || ''); if (/^(?:arrivals|departures|inhouse|queue|checkin|billing|rooms|profile|traces|search|details|other)$/.test(v)) o.s[screenKey(k)] = v; });
    }
    TAUGHT = o; taughtGen++;
    return o;
  }
  /** a screen title / heading as the key a taught kind is kept under ("Front Desk Workspace (3)" → "front desk workspace (#)") */
  function screenKey(t) { return sp(t).replace(/\d+/g, '#').toLowerCase().replace(/[^a-z0-9#()]+/g, ' ').trim().slice(0, 60); }
  /** a field table → fieldOf for it: exact names first; then the longest phrase found inside a longer header (asked once per text) */
  // Opera Cloud columns that are not what their words suggest ("Last Room" is not the room, "Reservation Type" is no trace's
  // department): never a field, in any table
  var SKIP_H = {}; ['LAST ROOM', 'PREVIOUS ROOM', 'RESERVATION TYPE', 'RES TYPE', 'QUEUE PRIORITY', 'I WANT TO', 'DISPLAY COLOR', 'DISPLAY COLOUR', 'SELECT ALL',
    'PROPERTY', 'EXTERNAL REFERENCE', 'FLOOR', 'LAST STAY', 'VACANT DAYS', 'CONNECTING', 'INTERNAL NAME', 'REPORT GROUP', 'MULTI PROPERTY REPORT',
    'ROOM TYPE TO CHARGE', 'EFFECTIVE RATE', 'LOYALTY QUALIFIED', 'CALCULATION RULE', 'RHYTHM', 'ALLOWANCE', 'PLAYER RANKING', 'PAYEE', 'ROUTING DATES',
    'ROUTING TRANSACTION CODES'].forEach(function (w) { SKIP_H[w] = 1; });
  function mapper(table, taught) {
    var of = {}, keys; table.forEach(function (f) { f[1].forEach(function (w) { of[w] = f[0]; }); }); keys = Object.keys(of);
    var memo = {}, memoN = 0, gen = taughtGen;
    function one(h) {
      var n = normH(h); if (!n || n.length > 48 || secretLabel(h)) return '';   // a card / password column is never a field
      if (taught && TAUGHT.h[n]) return TAUGHT.h[n] === '-' ? '' : TAUGHT.h[n];
      if (SKIP_H[n]) return '';
      if (of[n]) return of[n];
      var best = '', len = 0, w = ' ' + n + ' ';
      keys.forEach(function (k) { if (k.length > len && k.length >= 3 && w.indexOf(' ' + k + ' ') >= 0) { best = of[k]; len = k.length; } });
      return best;
    }
    return function (h) {
      h = String(h == null ? '' : h); if (h.length > 120) return '';
      if (gen !== taughtGen) { memo = {}; memoN = 0; gen = taughtGen; }
      if (Object.prototype.hasOwnProperty.call(memo, h)) return memo[h];   // the same header text is asked about on every read: answer it once
      if (++memoN > 5000) { memo = {}; memoN = 1; }
      return (memo[h] = one(h));
    };
  }
  /** one header / label → the field it names, or '' */
  FIELDS.forEach(function (f) { GUEST_FIELDS[f[0]] = 1; });
  var fieldOf = mapper(FIELDS, true), postFieldOf = mapper(POST_FIELDS), traceFieldOf = mapper(TRACE_FIELDS);
  // a form label (Oracle ADF lays a reservation / profile out as label → value, with no <label for>): its WHOLE text must be a field's name
  var EXACT = {}; FIELDS.forEach(function (f) { f[1].forEach(function (w) { EXACT[w] = f[0]; }); });
  var FORM_SKIP = { notes: 1, alerts: 1, prefs: 1, status: 0 };   // section titles on Opera's screens ("Notes", "Preferences"), not one value
  /** the text of an element on its own → the field it labels ('' when it isn't a label: "Loading Complete", "Assign Room", "Notes") */
  function formLabel(t) {
    t = sp(t).replace(/\s+/g, ' ').replace(/\s*[:*]+\s*$/, '').trim(); if (t.length < 2 || t.length > 40) return '';
    var n = normH(t); if (!n || secretLabel(t)) return '';
    if (TAUGHT.h[n]) return TAUGHT.h[n] === '-' ? '' : TAUGHT.h[n];
    var f = EXACT[n] || ''; return FORM_SKIP[f] ? '' : f;
  }
  /** a grid that holds data, not layout: 2+ lines, 3+ columns, digits in 30% of the lines (rooms, dates, conf. numbers) */
  function dataLook(rows, w) {
    rows = rows || []; if (rows.length < 2) return false;
    if (w == null) w = rows.reduce(function (a, r) { return Math.max(a, (r || []).filter(function (c) { return c != null; }).length); }, 0);
    if (w < 3) return false;
    var d = 0; rows.forEach(function (r) { if (/\d/.test((r || []).join(' '))) d++; });
    return d >= rows.length * 0.3;
  }
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
  function roomOf(v) {
    var t = sp(v).replace(/^\s*(?:room|rm)\.?\s*/i, ''), m = t.match(/^\s*([A-Za-z]?\d{1,5}[A-Za-z]?)\b/);
    if (!m) m = t.match(/^\s*(\d{3,5})(?=[A-Z][A-Za-z])/);   // Opera's room cell runs the room's features on: "0412KING…" → 0412
    return m ? m[1].toUpperCase() : '';
  }
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
    ['traces', /\btraces?\b/],   // only "Traces" (a reservation shows Notes / Alerts / Messages sections: not a traces screen)
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
  // Opera Cloud (Oracle ADF) never changes its address: a screen is known by the SET of its headings. These win over single words.
  // t: every heading, lower case, joined with " | ".
  var SIGS = [
    ['details', function (t) { return /stay\s*details/.test(t) && /packages?\s*(?:and|&)\s*items|payment\s*instructions/.test(t); }],   // a reservation
    ['profile', function (t) { return /\bidentification\b/.test(t) && /\bpreferences?\b/.test(t); }],
    ['rates', function (t) { return /rate\s*availability|minimum\s*stay\s*availability|rate\s*query/.test(t); }],
    ['checkin', function (t) { return /verify\s*payment|select\s*guests?|report\s*destination/.test(t); }],   // the check-in dialogs: read like a reservation, no list changes
    ['rooms', function (t) { return /available\s+rooms?\s+search|room\s+search\b|assign\s+room/.test(t); }],   // room availability / assign room: rooms and their status
    ['search', function (t) { return /manage\s+reservations?|reservation\s+search|look\s*up\s+reservations?/.test(t) && !/stay\s*details/.test(t); }],   // the reservation search form (its labels are empty filters)
    ['queue', function (t) { return /(?:^|\|)\s*(?:manage\s+)?queue(?:\s*rooms?)?\s*(?:\(#\))?\s*(?:\||$)/.test(t); }],   // arrivals waiting for their room
    ['inhouse', function (t) { return /(?:^|\|)\s*(?:manage\s+)?in[\s\-]?house(?:\s*guests?)?\s*(?:\(#\))?\s*(?:\||$)/.test(t); }],
    ['arrivals', function (t) { return /(?:^|\|)\s*(?:manage\s+)?arrivals?\s*(?:\(#\))?\s*(?:\||$)/.test(t); }],
    ['departures', function (t) { return /(?:^|\|)\s*(?:manage\s+)?departures?\s*(?:\(#\))?\s*(?:\||$)/.test(t); }],
  ];
  /** headings → the kind their combination names ('' when none does) */
  function sigKind(parts) {
    var t = (parts || []).map(function (p) { return sp(p).replace(/\s+/g, ' ').replace(/\d+/g, '#').trim().toLowerCase(); }).filter(Boolean).join(' | ');
    if (!t) return '';
    for (var i = 0; i < SIGS.length; i++) if (SIGS[i][1](t)) return SIGS[i][0];
    return '';
  }
  /** parts: [title, ...headings, url] (most trusted first) and the rows read → the kind of screen */
  function pageKind(parts, rows) {
    for (var j = 0; j < (parts || []).length; j++) { var tk = TAUGHT.s[screenKey(structText(parts[j], 80))] || TAUGHT.s[screenKey(parts[j])]; if (tk) return tk; }   // what the hotel taught first
    var sk = sigKind(parts); if (sk) return sk;   // then the headings Opera shows together
    for (var i = 0; i < (parts || []).length; i++) { var k = kindOfText(String(parts[i] || '').replace(/[\/_#?=&]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')); if (k) return k; }
    var c = {}; (rows || []).forEach(function (r) { if (r.status) c[r.status] = (c[r.status] || 0) + 1; });
    var top = Object.keys(c).sort(function (a, b) { return c[b] - c[a]; })[0];
    return top === 'due_in' ? 'arrivals' : top === 'due_out' || top === 'checked_out' ? 'departures' : top === 'in_house' ? 'inhouse' : rows && rows.length ? 'list' : '';
  }
  /** a short id of a value (snapshots are sent only when this changes) */
  function hash(v) { var s = typeof v === 'string' ? v : JSON.stringify(v); var h = 5381, g = 7; for (var i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) | 0; g = (g * 31 + s.charCodeAt(i)) | 0; } return (h >>> 0).toString(36) + (g >>> 0).toString(36); }
  var KIND_WORD = { arrivals: 'arrivals', departures: 'departures', inhouse: 'in-house', search: 'reservations', details: 'reservation', list: 'reservations', queue: 'queued arrivals', checkin: 'check-in guests',
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

  /** a short line that is only a list's count: "1-15 of 15", "Results: 15", "Total 15", "15 records", "Rows (15)" → 15 (0 when it isn't one) */
  function totalLine(text) {
    var t = sp(text).replace(/\s+/g, ' ').trim(); if (!t || t.length > 40) return 0;
    var m = t.match(/^(?:\d{1,5}\s*[-–]\s*\d{1,5}|showing \d{1,5}\s*[-–]\s*\d{1,5}|page \d{1,4})\s+of\s+(\d{1,5})(?:\s+(?:records|results|rows|items|reservations))?$/i)
      || t.match(/^(?:total|results|records|rows|count|total (?:records|results|rows|reservations))\s*[:=(]?\s*(\d{1,5})\)?$/i)
      || t.match(/^(\d{1,5})\s+(?:records?|results?|rows?|items?|reservations?|departures?|arrivals?|guests?)(?:\s+found)?$/i);
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
      if (fieldOf(l) === 'payment') v = payType(v) || (/\d|•/.test(v) ? '' : clip(v, 30));   // a payment method: its type only
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

  // ── "stuck" reports: a screen it could not read → its STRUCTURE for the developer, never its values ──
  /** a value's shape: letters → a / A (case kept), digits → 9, a long number → "999999+", 24 characters at most.
   *  "Testperson, Alpha" → "Aaaaaaaaaa, Aaaaa", "28/10/2026" → "99/99/9999". Shaping a shape changes nothing. */
  function shapeOf(v) {
    var s = sp(v).replace(/\s+/g, ' ').trim(); if (!s) return '';
    s = s.replace(/\p{L}/gu, function (c) { return c.toLowerCase() !== c ? 'A' : 'a'; }).replace(/\p{N}/gu, '9').replace(/@/g, '＠').replace(/9{7,}/g, '999999+');
    return s.length > 24 ? s.slice(0, 23) + '…' : s;
  }
  /** a header as shown (one line, 40 characters; number runs of 3+ → #, no email, no "Doe, John" comma) */
  function headText(v) { return sp(v).split('\n')[0].replace(/\s+/g, ' ').trim().replace(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, '').replace(/\d{3,}/g, '#').replace(/,\s*/g, ' / ').slice(0, 40); }
  /** a title / heading / label: the part before " - ", a comma or "(" (where a guest's name would be); number runs → # */
  function structText(v, n) { return sp(v).replace(/\s+/g, ' ').trim().split(/\s[-–—|:]\s|[,(|]/)[0].replace(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, '').replace(/\d+/g, '#').trim().slice(0, n || 60); }
  /** the address without query or IDs: digit runs → #, ID-like parts → :id, a hash only when it is words ("#departures") */
  function pathShape(p, h) {
    var out = String(p || '').split('/').map(function (x) { return x.length > 40 || (x.length >= 12 && /\d/.test(x) && /[A-Za-z]/.test(x)) ? ':id' : x.replace(/\d+/g, '#'); }).join('/').slice(0, 100);
    var hh = String(h || '').replace(/\d+/g, '#');
    return out + (/^#[A-Za-z#\/_\-]{1,40}$/.test(hh) ? ' ' + hh : '');
  }
  /** class names without digits (5 at most) */
  function classShape(c) { var out = []; String(c || '').split(/\s+/).forEach(function (k) { k = k.replace(/\d+/g, '').replace(/[^A-Za-z_\-]/g, '').replace(/^-+|-+$/g, ''); if (k && k.length <= 40 && out.indexOf(k) < 0 && out.length < 5) out.push(k); }); return out; }
  /** what a header maps to: a guest field, a folio posting field, a trace field, or "?" */
  function mapName(h) { var f = fieldOf(h); if (f) return f; f = postFieldOf(h); if (f) return 'post.' + f; f = traceFieldOf(h); return f ? 'trace.' + f : '?'; }
  var EMAIL_RX = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/;
  /** guest data left in a report's text? an email, a 7+ digit number or "Lastname, Firstname" → what it is ('' when clean) */
  function reportLeaks(text) {
    var t = String(text || '');
    if (EMAIL_RX.test(t)) return 'an email';
    if (/\d{7,}/.test(t)) return 'a long number';
    var m = t.match(/(?<!\p{L})\p{Lu}\p{Ll}+,[ \t]*\p{Lu}\p{Ll}+/gu) || [];
    for (var i = 0; i < m.length; i++) if (m[i].replace(/[Aa,\s]/g, '')) return 'a name';
    return '';
  }
  /** what the reader saw on a stuck screen (raw, from the page) → the report: structure and shapes only, or null when anything in it
   *  still looks like guest data. I: {v, at, kind, hint, date, title, path, hash, heads, why:[{c,t}], grids:[{sel, cells, head, aria, anc, n, rows, stuck}], pairs, concl, err} */
  function makeReport(I) {
    var rw = {}, ok = {};
    var words = function (set, v) { String(v == null ? '' : v).replace(/\p{L}{4,}/gu, function (w) { set[w.toLowerCase()] = 1; return w; }); };
    (I.grids || []).forEach(function (g) { (g.head || []).forEach(function (h) { words(ok, h); }); (g.rows || []).forEach(function (r) { (r || []).forEach(function (c) { words(rw, c); }); }); });
    (I.pairs || []).forEach(function (p) { words(ok, p[0]); words(rw, p[1]); });
    (I.form || []).forEach(function (f) { words(rw, f.v); });
    Object.keys(ok).forEach(function (w) { delete rw[w]; });
    var leaky = function (s) { var bad = false; String(s || '').replace(/\p{L}{4,}/gu, function (w) { if (rw[w.toLowerCase()]) bad = true; return w; }); return bad; };
    var free = function (s) { return s && !leaky(s) && !reportLeaks(s) ? s : ''; };   // text from the page that could hold a guest's name: dropped when it does
    var dom = function (v, n) { return String(v == null ? '' : v).replace(/[^A-Za-z0-9_\-\[\]=:{}<>,.·|() ]/g, '').replace(/\d{3,}/g, '#').slice(0, n || 80); };   // tags, roles, attribute NAMES only
    var R = { v: String(I.v || ''), rr: READER_REV, at: I.at || Date.now(), kind: I.kind || '', hint: I.hint || '', date: I.date ? 'found' : 'none',
      title: free(structText(I.title, 80)), path: free(pathShape(I.path, I.hash)),
      heads: (I.heads || []).map(function (h) { return free(structText(h, 60)); }).filter(Boolean).slice(0, 6),
      why: (I.why || []).slice(0, 6).map(function (w) { return { c: String(w.c), t: clip(w.t, 200) }; }),
      grids: (I.grids || []).slice(0, 4).map(function (g) {
        return { sel: g.sel || '', cells: g.cells || '', n: g.n || 0, stuck: !!g.stuck, hc: (g.hc || []).slice(0, 16).map(function (x) { return dom(x, 60); }).filter(Boolean), rc: dom(g.rc, 200),
          head: (g.head || []).slice(0, 30).map(function (h) { return [headText(h), mapName(h)]; }),
          aria: (g.aria || []).map(function (a) { return free(headText(a)); }).filter(Boolean).slice(0, 30),
          anc: (g.anc || []).slice(0, 4).map(function (a) { return { t: (String(a.t || '').toLowerCase().match(/^[a-z][a-z0-9\-]*/) || [''])[0], r: String(a.r || '').replace(/[^a-z\-]/g, ''), c: classShape((a.c || []).join(' ')) }; }),
          shapes: (g.rows || []).slice(0, 3).map(function (r) { return (r || []).slice(0, 16).map(shapeOf); }) };
      }),
      pairs: (I.pairs || []).map(function (p) { var l = free(cleanLabel(p[0])); return l ? [l, shapeOf(p[1])] : null; }).filter(Boolean).slice(0, 30),
      form: (I.form || []).map(function (f) { var l = free(cleanLabel(f.l)); return l ? { l: l, f: String(f.f || '').replace(/[^a-zA-Z]/g, '').slice(0, 20) || '?', how: dom(f.how, 30), path: dom(f.path, 120), shape: shapeOf(f.v) } : null; }).filter(Boolean).slice(0, 25),
      concl: clip(I.concl || '', 240), err: free(clip(String(I.err || '').replace(/\d+/g, '#'), 160)) };
    R = scrub(R);   // the existing masking, over everything
    var txt = reportText(R);
    if (reportLeaks(txt) || leaky(R.title + ' ' + R.path + ' ' + R.heads.join(' ') + ' ' + R.err + ' ' + R.pairs.map(function (p) { return p[0]; }).join(' ') + ' ' + R.form.map(function (f) { return f.l; }).join(' ') + ' ' + R.grids.map(function (g) { return g.aria.join(' '); }).join(' '))) return null;
    return R;
  }
  /** the report as plain text for the developer, with a fake page made from the shapes to test the reader on.
   *  x: {n: times seen, app: what HotelOps answered}. (opera-bridge.js holds the same function: tests/run-tests.js keeps them equal.) */
  function reportText(R, x) {
    x = x || {};
    var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
    var two = function (n) { return (n < 10 ? '0' : '') + n; }, d = new Date(R.at || 0);
    var L = ['HotelOps Opera reader report — please teach the reader this screen:'];
    L.push('reader v' + (R.v || '?') + (R.rr ? ' r' + R.rr : '') + ' · ' + d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) + (x.n > 1 ? ' · seen ' + x.n + ' times' : ''));
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
      if ((g.hc || []).length) L.push('  header cells: ' + g.hc.join(' '));
      if (g.rc) L.push('  first data row: ' + g.rc);
      g.shapes.forEach(function (r, j) { L.push('  row ' + (j + 1) + ' shape: ' + r.join(' | ')); });
    });
    if ((R.pairs || []).length) L.push('label → value shape: ' + R.pairs.map(function (p) { return p[0] + ' = ' + p[1]; }).join(' | '));
    if ((R.form || []).length) {
      L.push('form labels (label → field = value shape · where the value was · dom of the label, then up):');
      R.form.forEach(function (f) { L.push('  "' + f.l + '" → ' + f.f + ' = ' + (f.shape || '(none)') + ' · ' + (f.how || '—') + ' · ' + (f.path || '—')); });
    }
    L.push('--- fake page (letters → a/A, digits → 9) ---');
    if ((R.heads || [])[0]) L.push('<h1>' + esc(R.heads[0]) + '</h1>');
    (R.grids || []).forEach(function (g) {
      var a1 = g.anc[1], open = a1 && a1.c.length ? '<div class="' + esc(a1.c.join(' ')) + '">' : '<div>';
      if (/^table/.test(g.sel)) L.push(open + '<table>' + (g.head.length ? '<tr>' + g.head.map(function (h) { return '<th>' + esc(h[0]) + '</th>'; }).join('') + '</tr>' : '') + g.shapes.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></div>');
      else L.push(open + '<div role="grid">' + (g.head.length ? '<div role="row">' + g.head.map(function (h, k) { return '<div role="columnheader" aria-colindex="' + (k + 1) + '">' + esc(h[0]) + '</div>'; }).join('') + '</div>' : '') + g.shapes.map(function (r) { return '<div role="row">' + r.map(function (c, k) { return '<div role="gridcell" aria-colindex="' + (k + 1) + '">' + esc(c) + '</div>'; }).join('') + '</div>'; }).join('') + '</div></div>');
    });
    (R.pairs || []).forEach(function (p, i) { L.push('<label for="f' + i + '">' + esc(p[0]) + '</label><input id="f' + i + '" readonly value="' + esc(p[1]) + '">'); });
    (R.form || []).forEach(function (f) { L.push('<div><span>' + esc(f.l) + '</span><span>' + esc(f.shape) + '</span></div>'); });
    L.push('--- end ---');
    return L.join('\n');
  }
  /** why it isn't linked, in plain words (the "linking…" checklist). s: {ext, linked, since, relay: {apps, age}|null, relayEver, anyIn (ms, -1 = never), extErr} */
  function linkDiag(s) {
    if (s.linked) return { code: 'linked', text: 'Linked to HotelOps' };
    if (!s.ext) return { code: 'console', text: 'Not linked: press Connect (HotelOps opens in a tab and links)' };
    if (s.extErr) return { code: 'ext-error', text: 'The helper can\'t open its link here (' + String(s.extErr).slice(0, 60) + '): press ↻ on the HotelOps helper in chrome://extensions, then reload Opera' };
    if (s.since < 10000) return { code: 'linking', text: 'Linking to HotelOps…' };
    if (s.relay && s.relay.age < 40000) return s.relay.apps ? { code: 'app-silent', text: 'HotelOps is open but doesn\'t answer: reload the HotelOps tab (it may be an older version, or still loading)' }
      : { code: 'no-app', text: 'HotelOps tab not found: open HotelOps in this same browser (the same Chrome / Edge profile)' };
    if (s.relayEver) return { code: 'no-relay', text: 'The helper stopped answering: press ↻ on the HotelOps helper in chrome://extensions' };
    return { code: 'no-answer', text: 'No answer yet: is HotelOps open in this same browser? Reload it; still nothing: press ↻ on the HotelOps helper in chrome://extensions' };
  }

  // ══ <ho-lock> the Away lock screen (shared) ═════════════════
  // This block is the SAME in tools/hotelops-opera.console.js and tools/hotelops-whatsapp.console.js (tests/run-tests.js checks it;
  // the helper bakes the Opera reader's copy into the WhatsApp one). While you're away an opaque screen (a closed Shadow DOM on
  // <html>, the highest z-index) covers the page, and every mouse, touch and key outside it is stopped in the capture phase before
  // the site sees it. Nothing on the site is clicked, typed or changed: input is only kept away from it. It unlocks with your PIN
  // (only a salted SHA-256 of it comes here, never the PIN; 3 wrong → a 60 s wait) or from HotelOps. Kept per tab in sessionStorage
  // (a reload stays locked). What someone does at the lock screen goes to HotelOps, which tells your phone. Built with DOM calls and
  // inline styles only.
  var PIN_RE = /^\d{4,6}$/, LOCK_TRIES = 3, LOCK_MS = 60000;
  function hexOf(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16); return s; }
  /** sha-256(salt + ':' + pin) as hex (a Promise) */
  function pinHash(pin, salt) {
    var C = typeof crypto !== 'undefined' && crypto && crypto.subtle ? crypto : null;
    if (!C) return Promise.reject(new Error('no crypto.subtle'));
    return C.subtle.digest('SHA-256', new TextEncoder().encode(String(salt) + ':' + String(pin))).then(hexOf);
  }
  /** is this the PIN? pin0 = {h, s} (a Promise of true / false) */
  function pinVerify(pin, pin0) {
    pin = String(pin == null ? '' : pin).trim();
    if (!PIN_RE.test(pin) || !pin0 || !pin0.h || !pin0.s) return Promise.resolve(false);
    return pinHash(pin, pin0.s).then(function (h) { return h === pin0.h; }, function () { return false; });
  }
  /** one PIN try → the new counts: {fails (in a row), wrong (since locked), until (cool-down end), ok, lockout, blocked} */
  function pinStep(st, ok, now) {
    st = st || {};
    var o = { fails: +st.fails || 0, wrong: +st.wrong || 0, until: +st.until || 0 };
    if (now < o.until) { o.blocked = true; return o; }   // still cooling down: not even checked
    if (ok) { o.fails = 0; o.until = 0; o.ok = true; return o; }
    o.fails++; o.wrong++;
    if (o.fails >= LOCK_TRIES) { o.fails = 0; o.until = now + LOCK_MS; o.lockout = true; }
    return o;
  }
  /** a guard message (from HotelOps, or the helper's relay) → this tab's new guard state (the config is always taken; armed /
   *  disarmed only when it is newer than what this tab did itself, e.g. unlocked with the PIN a moment before HotelOps heard of it).
   *  null = not a message */
  function guardTake(cur, m) {
    if (!m || typeof m !== 'object') return null;
    cur = cur || {};
    var n = {}; Object.keys(cur).forEach(function (k) { n[k] = cur[k]; });
    n.pin = m.pin && /^[0-9a-f]{64}$/.test(String(m.pin.h || '')) && /^[0-9a-f]{8,64}$/.test(String(m.pin.s || '')) ? { h: String(m.pin.h), s: String(m.pin.s) } : null;
    n.auto = m.auto == null ? Math.max(0, Math.min(240, Math.round(+cur.auto || 0))) : Math.max(0, Math.min(240, Math.round(+m.auto || 0)));   // the relay's message has no minutes: kept
    var rev = +m.rev || 0, armed = !!m.armed;
    if (rev && rev < (+cur.rev || 0)) return n;   // older than this tab's own lock / unlock
    if (armed === !!cur.armed) { n.rev = Math.max(rev, +cur.rev || 0); if (armed && m.by) n.by = String(m.by).slice(0, 12); return n; }
    n.armed = armed; n.rev = rev || Date.now(); n.since = armed ? (+m.since || Date.now()) : 0; n.by = armed ? String(m.by || '').slice(0, 12) : '';
    n.fails = 0; n.wrong = 0; n.until = 0;
    return n;
  }
  /** the lock screen of one tab. o = { what: 'Opera' | 'WhatsApp', from: 'opera' | 'wa', attr: its data-hotelops name, ss: its
   *  sessionStorage key, top: the top frame (the PIN box is there), auto: idle auto-lock here, send(payload): to HotelOps,
   *  relay(msg): to the helper's relay (null in a console paste), tl(icon, text), render(), hint, hintNoPin }.
   *  payload: {events} · {unlocked, at} · {arm: 'auto', since, idle} */
  function hoLock(o) {
    o = o || {};
    var what = o.what || 'This page', SANS = 'system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
    var C = { txt: '#eef2f8', txt2: '#b9c3d2', txt3: '#8e9bb0', bad: '#f87171' };
    var send = typeof o.send === 'function' ? o.send : function () {};
    var relay = function (m) { try { if (typeof o.relay === 'function') o.relay(m); } catch (_) {} };
    var tl = function (i, t) { try { if (typeof o.tl === 'function') o.tl(i, t); } catch (_) {} };
    var redraw = function () { try { if (typeof o.render === 'function') o.render(); } catch (_) {} };
    var pad2 = function (n) { return String(n).padStart(2, '0'); };
    var hhmm = function (t) { var d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
    var RM = false; try { RM = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) {}
    var SS = { get: function (k, d) { try { var v = sessionStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } }, set: function (k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
    var G0 = SS.get(o.ss, null) || {};
    var G = guardTake({}, { pin: G0.pin, auto: G0.auto, armed: !!G0.armed, rev: +G0.rev || 0, since: G0.since, by: G0.by }) || {};
    G.fails = +G0.fails || 0; G.wrong = +G0.wrong || 0; G.until = +G0.until || 0;
    var GRACE = 15000, css = '', host = null, root = null, ui = {}, mo = null, iv = 0, Q = [], last = {}, human = Date.now(), humanSent = 0, busy = false, msg = '', msgAt = 0, sig = '', stopped = false;
    var save = function () { SS.set(o.ss, G); };
    var HOST_CSS = ['all:initial', 'position:fixed', 'inset:0', 'top:0', 'left:0', 'width:100vw', 'height:100vh', 'z-index:2147483647', 'display:block', 'margin:0', 'padding:0', 'border:0',
      'background:#070a12', 'opacity:1', 'visibility:visible', 'pointer-events:auto', 'transform:none', 'filter:none', 'clip-path:none', 'overflow:hidden'].map(function (d) { return d + ' !important'; }).join(';');
    function el(tag, cssText, text, parent) { var e = document.createElement(tag); if (cssText) e.style.cssText = cssText; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; }
    var lgN = 0;
    function logo(px) {   // the HotelOps logo: a white H on a glowing indigo tile
      var NS = 'http://www.w3.org/2000/svg', id = 'holkG' + Math.random().toString(36).slice(2, 7) + (++lgN);
      var mk = function (tag, at, parent) { var e = document.createElementNS(NS, tag); Object.keys(at).forEach(function (k) { e.setAttribute(k, at[k]); }); if (parent) parent.appendChild(e); return e; };
      var svg = mk('svg', { viewBox: '0 0 64 64', width: px, height: px, 'aria-hidden': 'true', style: 'display:block' }), defs = mk('defs', {}, svg);
      var rg = mk('radialGradient', { id: id, cx: '.3', cy: '.25', r: '.9' }, defs);
      [['0', '#7c8cff'], ['.55', '#4f46e5'], ['1', '#1e1b4b']].forEach(function (s) { mk('stop', { offset: s[0], 'stop-color': s[1] }, rg); });
      var lg = mk('linearGradient', { id: id + 'h', x1: '0', y1: '0', x2: '0', y2: '1' }, defs);
      mk('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '.22' }, lg); mk('stop', { offset: '.5', 'stop-color': '#fff', 'stop-opacity': '0' }, lg);
      mk('rect', { width: 64, height: 64, rx: 14.5, fill: 'url(#' + id + ')' }, svg); mk('rect', { width: 64, height: 64, rx: 14.5, fill: 'url(#' + id + 'h)' }, svg);
      var g = mk('g', { fill: '#fff' }, svg);
      mk('rect', { x: 18, y: 16, width: 8.5, height: 32, rx: 4.25 }, g); mk('rect', { x: 37.5, y: 16, width: 8.5, height: 32, rx: 4.25 }, g); mk('rect', { x: 22, y: 28.5, width: 20, height: 7, rx: 3.5 }, g);
      mk('circle', { cx: 47, cy: 14, r: 3.2, fill: '#c7d2fe' }, svg);
      return svg;
    }
    /** something happened at the lock screen → HotelOps (then your phone). A tap / a key once per 5 s, none in the first 15 s (you
     *  walking away). Those soft ones wait 5 s: the owner coming back and typing the right PIN at once is not "someone at your desk".
     *  A wrong PIN, the wait, tampering go at once (and take the waiting ones with them). */
    var soft = [], softT = 0, SOFT = { touch: 1, key: 1, try: 1 };
    function ev(kind, detail, n) {
      var t = Date.now();
      if (SOFT[kind]) { if (t - (G.since || 0) < GRACE || (last[kind] && t - last[kind] < 5000)) return; last[kind] = t; }
      var e = { id: 'o' + t.toString(36) + Math.random().toString(36).slice(2, 6), at: t, kind: kind, detail: String(detail || '').slice(0, 120), n: n || 0 };
      tl(kind === 'unlock' ? '🔓' : '🛡', String(detail || kind).slice(0, 100));
      if (SOFT[kind]) { soft.push(e); if (!softT) softT = setTimeout(softGo, 5000); return; }
      if (kind === 'unlock') { clearTimeout(softT); softT = 0; soft = []; } else softGo(true);
      Q.push(e); if (Q.length > 40) Q = Q.slice(-40);
      flush();
    }
    function softGo(noFlush) { clearTimeout(softT); softT = 0; if (!soft.length) return; Q = Q.concat(soft).slice(-40); soft = []; if (noFlush !== true) flush(); }
    function flush() { if (Q.length) send({ events: Q.slice(0, 20) }); }
    function say(t) { msg = t; msgAt = Date.now(); paint(); }
    function input() {   // a fresh, empty PIN box (the reader never sets a value, not even its own)
      if (!ui.row) return null;
      var old = ui.inp, inp = el('input', 'all:unset;box-sizing:border-box;flex:1;min-width:0;height:46px;padding:0 14px;border-radius:12px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.18);color:#fff;font:600 20px/46px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.35em;text-align:center;caret-color:#f1d184');
      inp.type = 'password'; inp.inputMode = 'numeric'; inp.maxLength = 6; inp.autocomplete = 'off'; inp.placeholder = '••••';
      inp.setAttribute('aria-label', 'PIN'); inp.setAttribute('data-ho', 'pin'); inp.spellcheck = false;
      if (old && old.parentNode) ui.row.replaceChild(inp, old); else ui.row.insertBefore(inp, ui.row.firstChild);
      ui.inp = inp;
      return inp;
    }
    function focus() { try { if (ui.inp && !ui.inp.disabled) ui.inp.focus({ preventScroll: true }); else if (ui.card) ui.card.focus({ preventScroll: true }); } catch (_) {} }
    function build() {
      if (host) return;
      host = document.createElement('div');
      host.setAttribute('data-hotelops', o.attr || 'ho-lock');
      host.style.cssText = HOST_CSS; css = host.getAttribute('style');   // as the browser writes it back
      root = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host;
      var bg = el('div', 'all:initial;position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;overflow:auto;cursor:default;user-select:none;-webkit-user-select:none;'
        + 'background:radial-gradient(900px 600px at 50% 30%,rgba(79,70,229,.22),transparent 70%),radial-gradient(700px 500px at 80% 90%,rgba(201,161,74,.10),transparent 70%),#070a12;'
        + 'font:14px/1.5 ' + SANS + ';color:' + C.txt + ';-webkit-font-smoothing:antialiased', null, root);
      var card = el('div', 'box-sizing:border-box;width:min(420px,100%);padding:28px 24px 22px;border-radius:22px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;outline:none;'
        + 'background:linear-gradient(180deg,rgba(24,30,43,.96),rgba(14,18,27,.98));border:1px solid rgba(255,255,255,.12);box-shadow:0 40px 90px -30px rgba(0,0,0,.8),0 0 0 1px rgba(0,0,0,.4)', null, bg);
      card.tabIndex = -1; card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-label', what + ' is locked');
      el('div', 'width:72px;height:72px;border-radius:19px;overflow:hidden;box-shadow:0 14px 36px -10px rgba(79,70,229,.75)', null, card).appendChild(logo(72));
      el('div', 'margin-top:6px;font:700 20px/1.25 ' + SANS + ';color:#fff;letter-spacing:-.015em', '🔒 ' + what + ' is locked — the owner is away', card);
      ui.sub = el('div', 'color:' + C.txt2 + ';font-size:13px', '', card);
      ui.row = el('div', 'display:flex;gap:8px;width:100%;margin-top:8px', null, card);
      ui.btn = el('button', 'all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;height:46px;padding:0 18px;border-radius:12px;font:600 14.5px/1.2 ' + SANS + ';'
        + 'color:#1a1408;background:linear-gradient(135deg,#f1d184,#c9a14a 60%,#a8842f);box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 6px 14px -8px rgba(201,161,74,.9)', 'Unlock', ui.row);
      ui.btn.type = 'button'; ui.btn.setAttribute('data-ho', 'unlock'); ui.btn.setAttribute('data-act', 'unlock');
      input();
      ui.msg = el('div', 'min-height:20px;font:600 13px/1.4 ' + SANS + ';color:' + C.bad, '', card);
      ui.hint = el('div', 'box-sizing:border-box;width:100%;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:' + C.txt2 + ';font-size:12.5px', '', card);
      el('div', 'margin-top:4px;color:' + C.txt3 + ';font-size:11.5px', 'What happens here is sent to the owner\'s phone.', card);
      ui.card = card;
      if (!o.top) { ui.row.style.display = 'none'; }   // a frame inside the page: the top frame's screen has the PIN box
      // inside the lock screen: nothing leaves it (the site never sees a key or a click), and the PIN box / Unlock button work
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'wheel', 'touchstart', 'touchmove', 'touchend', 'keydown', 'keyup', 'keypress',
        'beforeinput', 'input', 'paste', 'cut', 'copy', 'drop', 'dragstart', 'dragover', 'focusin', 'focusout', 'select', 'submit', 'pointermove', 'mousemove'].forEach(function (t) { root.addEventListener(t, inside, { capture: false, passive: false }); });
      document.documentElement.appendChild(host);
      mo = new MutationObserver(function () { keep(true); });
      mo.observe(document.documentElement, { childList: true });
      mo.observe(host, { attributes: true });
      paint(true);
    }
    /** keep the screen there, on top and untouched; someone took it away or hid it → back at once, and HotelOps is told */
    function keep(fromObs) {
      if (!G.armed || !host || stopped) return;
      var de = document.documentElement, gone = !host.isConnected || host.parentNode !== de, hid = host.getAttribute('style') !== css;
      if (gone || hid || host.attributes.length > 2 || (!fromObs && de.lastElementChild !== host)) {
        if (hid) host.setAttribute('style', css);
        if (host.attributes.length > 2) { for (var i = host.attributes.length - 1; i >= 0; i--) { var a = host.attributes[i].name; if (a !== 'style' && a !== 'data-hotelops') host.removeAttribute(a); } hid = true; }
        de.appendChild(host);
        if (gone || hid) ev('tamper', gone ? 'removed the lock screen (it came back)' : 'tried to hide the lock screen (it came back)');
        focus();
      }
    }
    var KEEP_KEYS = /^(?:[0-9]|Backspace|Delete|ArrowLeft|ArrowRight|Home|End|Enter|Tab|Shift)$/;
    function inside(e) {
      if (!G.armed) return;
      e.stopPropagation();   // never out to the site
      var t = e.target, onInp = t === ui.inp, onBtn = t === ui.btn || (ui.btn && ui.btn.contains && ui.btn.contains(t));
      var ty = e.type;
      if (ty === 'pointerdown' || ty === 'mousedown' || ty === 'touchstart') {
        if (!onInp && !onBtn && e.cancelable) e.preventDefault();   // the focus stays in the PIN box
        if (ty === 'pointerdown' && e.isTrusted) ev('touch', 'touched the locked screen');
        if (!onInp) setTimeout(focus, 0);
        return;
      }
      if (ty === 'wheel' || ty === 'touchmove' || ty === 'contextmenu' || ty === 'dragstart' || ty === 'drop' || ty === 'dragover') { if (e.cancelable) e.preventDefault(); return; }
      if (ty === 'click') { if (onBtn) tryPin(); return; }
      if (ty === 'keydown') {
        if (e.key === 'Enter') { if (e.cancelable) e.preventDefault(); tryPin(); return; }
        if (e.key === 'Tab') { if (e.cancelable) e.preventDefault(); focus(); return; }
        if (!onInp || e.ctrlKey || e.metaKey || e.altKey || !KEEP_KEYS.test(e.key)) { if (e.cancelable) e.preventDefault(); if (e.isTrusted) ev('key', 'pressed keys on the locked screen'); return; }
        if (/^[0-9]$/.test(e.key) && e.isTrusted) ev('try', 'is typing a PIN');
        return;
      }
      if ((ty === 'paste' || ty === 'drop' || ty === 'cut' || ty === 'copy') && e.cancelable) e.preventDefault();
    }
    /** outside the lock screen (a key with the focus somewhere on the site, a click that got past it): stopped before the site sees it */
    var EVS = ['pointerdown', 'pointerup', 'pointermove', 'pointerover', 'mousedown', 'mouseup', 'mousemove', 'mouseover', 'click', 'dblclick', 'auxclick', 'contextmenu',
      'keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'paste', 'cut', 'copy', 'drop', 'dragstart', 'dragover', 'submit', 'focusin'];
    function outside(e) {
      if (!G.armed || !host) return;
      var p = e.composedPath ? e.composedPath() : [];
      if (p.indexOf(host) >= 0 || e.target === host) return;   // ours: handled inside
      if (e.type === 'focusin') { setTimeout(focus, 0); return; }
      e.stopImmediatePropagation();
      if (e.cancelable) e.preventDefault();
      if (e.isTrusted && e.type === 'keydown') { ev('key', 'pressed keys on the locked screen'); setTimeout(focus, 0); }
      else if (e.isTrusted && e.type === 'pointerdown') ev('touch', 'touched the locked screen');
    }
    /** a real hand on this tab (auto-lock counts from the last one); a frame tells the top frame */
    function humanNow() {
      human = Date.now();
      if (!o.top && human - humanSent > 10000) { humanSent = human; try { window.top.postMessage({ __hoLockHuman: 1 }, '*'); } catch (_) {} }
    }
    // the clicks and keys are watched all the time (they do nothing while not armed); wheel and touch only while locked, so the
    // site's scrolling never waits for this; a real hand on the page (passive) is what auto-lock counts from
    var SCROLL = ['wheel', 'touchstart', 'touchmove', 'touchend'];
    EVS.forEach(function (t) { window.addEventListener(t, outside, { capture: true, passive: false }); document.addEventListener(t, outside, { capture: true, passive: false }); });
    function scroll(on) { SCROLL.forEach(function (t) { [window, document].forEach(function (w) { if (on) w.addEventListener(t, outside, { capture: true, passive: false }); else w.removeEventListener(t, outside, { capture: true }); }); }); }
    function hand(e) { if (e.isTrusted && (e.type !== 'pointermove' || Date.now() - human > 2000)) humanNow(); }
    var HANDS = ['pointerdown', 'keydown', 'wheel', 'pointermove', 'touchstart'];
    HANDS.forEach(function (t) { window.addEventListener(t, hand, { capture: true, passive: true }); });
    function onBlur() { if (G.armed) setTimeout(focus, 0); }
    window.addEventListener('blur', onBlur);
    function tryPin() {
      if (!o.top || !ui.inp || busy || !G.armed) return;
      var pin = String(ui.inp.value || '').trim();
      input(); focus();
      if (Date.now() < (G.until || 0)) { paint(); return; }
      if (!G.pin) { say('No PIN is set: unlock it from HotelOps.'); return; }
      if (!PIN_RE.test(pin)) { say('The PIN is 4 to 6 digits.'); return; }
      busy = true;
      pinVerify(pin, G.pin).then(function (ok) {
        busy = false;
        if (!G.armed) return;
        var st = pinStep(G, ok, Date.now());
        G.fails = st.fails; G.wrong = st.wrong; G.until = st.until; save();
        if (st.blocked) { paint(); return; }
        if (ok) {
          G.armed = false; G.rev = Date.now(); G.wrong = 0; G.fails = 0; G.until = 0; save();
          send({ unlocked: true, at: G.rev });
          relay({ source: 'ho-away-off', rev: G.rev, at: G.rev, from: o.from || '' });   // the helper unlocks the other tabs, even with HotelOps closed
          ev('unlock', 'unlocked with the PIN');
          unlock();
          return;
        }
        if (st.lockout) { ev('lockout', LOCK_TRIES + ' wrong PINs: locked for ' + Math.round(LOCK_MS / 1000) + ' s', st.wrong); say(''); }
        else { ev('fail', 'tried to unlock (wrong PIN ×' + st.wrong + ')', st.wrong); say('Wrong PIN' + (LOCK_TRIES - st.fails > 0 ? ' · ' + (LOCK_TRIES - st.fails) + ' more tr' + (LOCK_TRIES - st.fails === 1 ? 'y' : 'ies') + ' before a 1-minute wait' : '')); }
        if (!RM && ui.card && ui.card.animate) try { ui.card.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(0)' }], { duration: 320 }); } catch (_) {}
      });
    }
    function paint(force) {
      if (!host) return;
      var now = Date.now(), wait = Math.max(0, Math.ceil(((G.until || 0) - now) / 1000)), byTxt = G.by === 'auto' ? 'nobody used it for ' + (G.auto || '') + ' min' : G.by === 'now' ? 'locked from HotelOps' : 'the owner is away';
      var m = wait ? 'Too many wrong PINs — wait ' + wait + ' s' : msg && now - msgAt < 8000 ? msg : '';
      var s = [wait, m, !!G.pin, G.since, G.by].join('|'); if (!force && s === sig) return; sig = s;
      ui.sub.textContent = 'Locked at ' + hhmm(G.since || now) + ' · ' + byTxt;
      ui.msg.textContent = m;
      if (o.top) {
        ui.row.style.display = G.pin ? 'flex' : 'none';
        if (ui.inp) ui.inp.disabled = !!wait; ui.btn.style.opacity = wait ? '.45' : '1';
        ui.hint.textContent = G.pin ? (o.hint || 'Type your PIN and press Enter. Or unlock from HotelOps: “I\'m back” in the 🛡 Away guard.')
          : (o.hintNoPin || 'No PIN set: unlock from HotelOps (“I\'m back” in the 🛡 Away guard).');
        if (!wait && ui.inp && document.activeElement !== host) focus();
      } else ui.hint.textContent = 'Unlock from HotelOps.';
    }
    function lock() {
      build(); scroll(true); keep(); paint(true); focus();
      try { if (document.activeElement && document.activeElement !== host && document.activeElement.blur) document.activeElement.blur(); } catch (_) {}
      focus();
      tl('🔒', what + ' locked: ' + (G.by === 'auto' ? 'nobody used it for ' + G.auto + ' min' : 'you are away'));
      redraw();
    }
    function unlock() {
      var h = host; host = null; root = null; ui = {}; sig = ''; scroll(false);
      try { if (mo) mo.disconnect(); } catch (_) {} mo = null;
      try { if (h) h.remove(); } catch (_) {}
      human = Date.now();
      tl('🔓', what + ' unlocked');
      redraw();
    }
    /** HotelOps (or the helper's relay) says armed / disarmed (and the PIN's hash, the auto-lock minutes) */
    function take(m) {
      if (stopped) return;
      var n = guardTake(G, m); if (!n) return;
      var was = !!G.armed; G = n; save();
      if (G.armed && !was) lock();
      else if (!G.armed && was) unlock();
      else if (G.armed && document.documentElement) { build(); paint(true); }
    }
    /** every second while armed: on top, the cool-down count; while not: lock by itself after N idle minutes (needs a PIN) */
    iv = setInterval(function () {
      if (stopped) return;
      if (G.armed) {
        if (!document.documentElement) return;
        if (!host) lock();
        keep(); paint();
        if (o.top && ui.inp && !ui.inp.disabled && document.activeElement !== host) { try { if (document.hasFocus()) focus(); } catch (_) {} }
        if (Q.length && Date.now() % 10000 < 1000) flush();   // HotelOps hasn't said it got them yet: again every 10 s
        return;
      }
      if (o.auto && o.top && G.auto > 0 && G.pin && Date.now() - human > G.auto * 60e3) {
        var now = Date.now();
        G.armed = true; G.rev = now; G.since = now; G.by = 'auto'; G.fails = 0; G.wrong = 0; G.until = 0; save();
        send({ arm: 'auto', since: now, idle: now - human });
        lock();
      }
    }, 1000);
    function stop(silent) {
      if (stopped) return;
      if (G.armed && !silent) { try { ev('tamper', 'stopped the ' + what + ' reader (the lock screen went with it)'); } catch (_) {} }
      clearTimeout(softT);
      try { clearInterval(iv); if (mo) mo.disconnect(); if (host) host.remove(); } catch (_) {}
      EVS.forEach(function (t) { window.removeEventListener(t, outside, { capture: true }); document.removeEventListener(t, outside, { capture: true }); });
      scroll(false); HANDS.forEach(function (t) { window.removeEventListener(t, hand, { capture: true }); });
      window.removeEventListener('blur', onBlur);
      stopped = true;
    }
    if (G.armed && document.documentElement) lock();   // reloaded while locked: locked again at once
    return {
      take: take, stop: stop, flush: flush, lock: function () { if (G.armed && !host) lock(); },
      /** HotelOps got these events (they are not sent again) */
      ack: function (ids) { if (Array.isArray(ids)) Q = Q.filter(function (q) { return ids.indexOf(q.id) < 0; }); },
      /** ask the helper's relay whether you're away (a tab opened while HotelOps is closed locks at once) */
      ask: function () { relay({ source: 'ho-away-ask', from: o.from || '' }); },
      sink: function (f) { if (typeof f === 'function') send = f; },
      human: humanNow, idle: function (ms) { human -= Math.max(0, +ms || 0); },
      armed: function () { return !!G.armed; }, host: function () { return host; },
      state: function () { return { armed: !!G.armed, since: G.since || 0, by: G.by || '', pin: !!G.pin, auto: G.auto || 0, fails: G.fails || 0, wrong: G.wrong || 0, until: G.until || 0, queued: Q.length, shown: !!host && host.isConnected, top: !!host && document.documentElement.lastElementChild === host }; }
    };
  }
  // ══ </ho-lock> ═══════════════════════════════════════════════

  /** headers of Opera tables that are known and hold no departures / guests to read: the report list, Folio History (past invoices) */
  var KNOWN_HEAD = / REPORT GROUP | INTERNAL NAME | MULTI PROPERTY REPORT | INVOICE NO(?:UMBER)? | ASSOC FOLIOS | POST IT NO(?:UMBER)? /;
  /** Opera's report screens (Report Parameters, report list): settings for a report, not guests → never "unknown". */
  function isReportForm(c) {
    return (c.pairs || []).some(function (p) { return /^(?:report name|report group|file format|sort order|from date|to date|include internal notes|primary only)$/i.test(String(p[0] || '').replace(/\s+/g, ' ').trim()); })
      || (c.heads || []).some(function (h) { return /report\s+parameters|^\s*reports?\s*$/i.test(h); });
  }
  var H = { pinHash: pinHash, pinVerify: pinVerify, pinStep: pinStep, guardTake: guardTake, PIN_RE: PIN_RE, LOCK_TRIES: LOCK_TRIES, LOCK_MS: LOCK_MS,
    setTaught: setTaught, screenKey: screenKey, shapeOf: shapeOf, headText: headText, structText: structText, pathShape: pathShape, classShape: classShape, mapName: mapName, reportLeaks: reportLeaks, makeReport: makeReport, reportText: reportText, linkDiag: linkDiag,
    maskCards: maskCards, secretLabel: secretLabel, scrub: scrub, payType: payType, normRoomStatus: normRoomStatus, postFieldOf: postFieldOf, traceFieldOf: traceFieldOf, usablePost: usablePost, usableTrace: usableTrace,
    postingsFrom: postingsFrom, folioFrom: folioFrom, tracesFrom: tracesFrom, tableFrom: tableFrom, pairsExtra: pairsExtra, auditState: auditState, cleanLabel: cleanLabel, safeTitle: safeTitle,
    normH: normH, fieldOf: fieldOf, mapHeaders: mapHeaders, usable: usable, parseDate: parseDate, dateOrder: dateOrder, findDate: findDate, normStatus: normStatus, money: money,
    roomOf: roomOf, roomKey: roomKey, nameKey: nameKey, confOf: confOf, emailOf: emailOf, rowFrom: rowFrom, finishRows: finishRows, rowKey: rowKey, mergeRows: mergeRows, pairsToRow: pairsToRow,
    kindOfText: kindOfText, pageKind: pageKind, sigKind: sigKind, formLabel: formLabel, dataLook: dataLook, isReportForm: isReportForm, KNOWN_HEAD: KNOWN_HEAD, hash: hash, summary: summary, totalOf: totalOf, totalLine: totalLine, FIELDS: FIELDS, VERSION: VERSION, READER_REV: READER_REV };
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
  var taughtH = ''; (function () { var t = LS.get('ho_op_teach', null); if (t) { setTaught(t); taughtH = hash(t); } })();
  var frames = {};   // other frames of this tab that read something (the pill in the top frame shows all)

  // ── reading the screen ────────────────────────────────────
  var GRID_SEL = 'table, [role="grid"], [role="table"], [role="treegrid"]';
  var ROW_SEL = 'tr, [role="row"]';
  var CELL_SEL = 'th, td, [role="columnheader"], [role="gridcell"], [role="cell"], [role="rowheader"]';
  var mine = function (el) { return !!el && ((pillHost && (el === pillHost || pillHost.contains(el))) || (typeof LOCK !== 'undefined' && LOCK && el === LOCK.host())); };
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
  // Opera Cloud is Oracle ADF: hundreds of layout tables (role=presentation), menus built of tables (role=menubar / menu,
  // .odec-dropmenu-…), and the real lists split in two tables (the column headers in one, the lines in another, often inside
  // an outer role=grid, lines marked _afrrk). Each table is sorted first, so only the lists are read.
  var MENU_SEL = 'nav, [role="menubar"], [role="menu"], [role="navigation"], [role="toolbar"], [role="tablist"], [class*="dropmenu"]';
  var DATA_CELL = 'th, tr[_afrrk] > td, [role="row"] > td, [role="gridcell"], [role="cell"], [role="columnheader"], [role="rowheader"]';
  var CLS = null;   // what each table is, for one read
  function roleOf(e) { return String(e.getAttribute('role') || '').toLowerCase(); }
  function ownRows(t) { return t.rows || []; }   // a table's own lines (not those of a table inside it)
  function headRow(t) {
    if (t.tHead && t.tHead.rows.length && t.tHead.rows[0].cells.length >= 2) return true;
    var rs = ownRows(t);
    for (var i = 0; i < rs.length && i < 3; i++) { var h = 0, cs = rs[i].cells; for (var j = 0; j < cs.length; j++) if (isHead(cs[j]) && sp(cs[j].textContent).trim()) h++; if (h >= 2) return true; }
    return false;
  }
  /** a table / grid on screen → 'grid' (read it) · 'part' (a table inside a role=grid: its lines belong to that grid) ·
   *  'maybe' (looks like layout: read only as the lines under a header table next to it) · 'skip' (menus, layout, a table inside a cell) */
  function cls0(e) {
    if (mine(e)) return 'skip';
    var r = roleOf(e);
    if (/^(?:menu|menubar|navigation|toolbar|tablist)$/.test(r) || e.closest(MENU_SEL)) return 'skip';
    if (r === 'grid' || r === 'treegrid' || r === 'table') return 'grid';
    if (e.tagName !== 'TABLE') return 'skip';
    var up = e.parentElement, a = up && up.closest('[role="grid"], [role="treegrid"]');
    if (a) { var cell = up.closest(DATA_CELL); return cell && a.contains(cell) ? 'skip' : 'part'; }
    if (up && up.closest('tr[_afrrk], [role="row"]')) return 'skip';   // a cell's own layout inside a list line
    var rs = ownRows(e);
    for (var i = 0; i < rs.length && i < 5; i++) if (rs[i].hasAttribute('_afrrk') || roleOf(rs[i]) === 'row') return 'grid';
    if (headRow(e)) return 'grid';
    if (r === 'presentation' || r === 'none' || e.querySelector('table')) return 'maybe';   // layout, or tables inside its cells
    return 'grid';
  }
  function clsOf(e) { var c = CLS && CLS.get(e); if (c) return c; c = cls0(e); if (CLS) CLS.set(e, c); return c; }
  /** the grid a line belongs to (a table that is only part of an outer role=grid hands its lines to that grid) */
  function ownerOf(r) {
    var e = r.parentElement ? r.parentElement.closest(GRID_SEL) : null;
    while (e && clsOf(e) === 'part') e = e.parentElement ? e.parentElement.closest(GRID_SEL) : null;
    return e;
  }
  /** inside a list that is read (not a layout table): a date there is a guest's, not the screen's */
  function inData(e) {
    if (e.closest('tr[_afrrk], [role="row"]')) return true;
    for (var g = e.closest(GRID_SEL), n = 0; g && n < 6; g = g.parentElement ? g.parentElement.closest(GRID_SEL) : null, n++) { var c = clsOf(g); if (c === 'grid' || c === 'part') return true; }
    return false;
  }
  /** one grid → {head: [texts by column], rows: [[texts by column]], el, r0: its first line} */
  function readGrid(g) {
    var head = null, hs = [], rows = [], byKey = null, joined = 0, first = null;
    g.querySelectorAll(ROW_SEL).forEach(function (r) {
      if (ownerOf(r) !== g || mine(r)) return;
      var cs = cellsOf(r); if (!cs.length) return;
      if (r.querySelector('tr, [role="row"]') && Array.prototype.some.call(r.querySelectorAll('tr, [role="row"]'), function (x) { return ownerOf(x) === g; })) return;   // a line holding this grid's lines: layout inside the grid
      var h = 0; for (var i = 0; i < cs.length; i++) if (isHead(cs[i])) h++;
      if ((h && h >= cs.length / 2) || (!head && r.parentElement && r.parentElement.tagName === 'THEAD')) {   // a header line (the last one with the most columns wins: grouped headers)
        var line = []; cs.forEach(function (c, i) { line[colOf(c, i)] = txt(c) || c.getAttribute('aria-label') || ''; });
        hs.push({ line: line, t: r.parentElement });
        if (!head || line.filter(Boolean).length >= head.filter(Boolean).length) head = line;
        return;
      }
      var line2 = [], ci = false; cs.forEach(function (c, i) { if (c.hasAttribute('aria-colindex')) ci = true; line2[colOf(c, i)] = txt(c); });
      if (!line2.some(Boolean)) return;
      // one line split over two tables (ADF frozen columns): the same row key → one line
      var k = r.getAttribute('_afrrk');
      if (k) {
        byKey = byKey || {};
        var prev = byKey[k];
        if (prev && prev.t !== r.parentElement) {
          if (ci) line2.forEach(function (v, i) { if (v != null && prev.line[i] == null) prev.line[i] = v; }); else Array.prototype.push.apply(prev.line, line2);
          joined++; return;
        }
        byKey[k] = { line: line2, t: r.parentElement };
      }
      if (!first) first = r;
      rows.push(line2);
    });
    // headers split the same way (one header table per part, side by side): joined in order
    if (joined && hs.length >= 2 && hs.every(function (x, i) { return !i || x.t !== hs[i - 1].t; })) head = hs.reduce(function (a, x) { return a.concat(x.line); }, []);
    return { el: g, head: head, rows: rows, r0: first };
  }
  function depthTo(a, b) { var n = 0; for (var e = a; e && n < 8; e = e.parentElement, n++) if (e.contains(b)) return n; return 99; }
  /** every grid on screen → guest lines (header-only grids are paired with the body grid next to them: split headers).
   *  The grids that aren't guest lists come back too: a folio's postings, traces, and anything else as a plain table.
   *  Menus and layout tables are never read (skipped: how many). */
  function readGrids(doc, hint) {
    CLS = new Map();
    var gs = [], maybe = [], skipped = 0;
    doc.querySelectorAll(GRID_SEL).forEach(function (e) { var c = clsOf(e); if (c === 'grid') gs.push(readGrid(e)); else if (c === 'maybe') maybe.push(e); else if (c === 'skip' && !mine(e)) skipped++; });
    // a one-line table without a header or a digit: layout too
    gs = gs.filter(function (g) { if (g.head) return true; if (!g.rows.length) return false; if (g.rows.length === 1 && !/\d/.test(g.rows[0].join(''))) { skipped++; return false; } return true; });
    var kindOfHead = function (h) {
      if (!h) return '';
      var mg = mapHeaders(h), mt = mapHeaders(h, traceFieldOf);
      if (hint === 'traces' && usableTrace(mt)) return 'trace';
      var hs = ' ' + h.map(normH).join(' | ') + ' ';
      if (/ CARD NUMBER | CARD HOLDER | EXPIRATION /.test(hs)) return 'card';   // payment instructions / memberships: a card column — never read, never kept
      if (/ CALCULATION RULE | RHYTHM | ALLOWANCE /.test(hs) || (/ DATE /.test(hs) && / EFFECTIVE RATE | LOYALTY QUALIFIED | ROOM TYPE TO CHARGE /.test(hs))
        || KNOWN_HEAD.test(hs)) return 'known';   // packages, daily rate details, the report list, folio history: a known table, not guests
      // a room list (Opera's assign-room panel, room status): a room and its statuses, no guest → kept as a plain table, never "nothing useful"
      if (mg.map.room !== undefined && mg.map.name === undefined && mg.map.conf === undefined && mg.map.last === undefined && mg.map.first === undefined
        && (mg.map.foStatus !== undefined || mg.map.roomStatus !== undefined || mg.map.hkStatus !== undefined)) return hint === 'rooms' ? 'guest' : 'known';
      if (usable(mg)) return 'guest';
      if (usablePost(mapHeaders(h, postFieldOf))) return 'post';
      if (usableTrace(mt)) return 'trace';
      return h.filter(Boolean).length >= 2 ? 'other' : '';
    };
    var heads = gs.filter(function (g) { return g.head && !g.rows.length && (g.hk = kindOfHead(g.head)); });
    // a layout-looking table right under a header table with as many columns: the lines of a split list (ADF)
    maybe.forEach(function (e) {
      var rs = ownRows(e), w = 0; for (var i = 0; i < rs.length && i < 8; i++) w = Math.max(w, rs[i].cells.length);
      var ok = w >= 2 && heads.some(function (h) { return (h.el.compareDocumentPosition(e) & 4) && Math.abs(h.head.length - w) <= 1 && depthTo(h.el, e) <= 6; });
      if (!ok) { skipped++; return; }
      var g = readGrid(e); if (g.rows.length) gs.push(g);
    });
    var out = [], total = 0, post = [], trace = [], other = [], seen = [];
    gs.forEach(function (g) {
      if (!g.rows.length) return;
      var head = g.head, k = head ? kindOfHead(head) : '', hel = null;
      var w = Math.max(g.rows[0].length, g.rows.length > 1 ? g.rows[1].length : 0);
      if (!k || (k === 'other' && heads.length)) {
        var best = null, bd = 99; w = Math.max.apply(null, g.rows.map(function (r) { return r.length; }));
        heads.forEach(function (h) {
          if (h.el.compareDocumentPosition(g.el) & 4 && Math.abs(h.head.length - w) <= 1) { var d = depthTo(h.el, g.el); if (d < bd) { bd = d; best = h; } }
        });
        if (best && bd <= 6) { head = best.head; k = best.hk; hel = best.el; }
      }
      var s = { el: g.el, hel: hel, head: head, k: k, n: g.rows.length, w: w, out: 0, rows: g.rows, r0: g.r0 };   // what was seen, for the stuck check (references only: no extra work)
      seen.push(s);
      if (!k) return;
      var hk = head.map(normH).join('|'), h0 = normH(head[0] || '');
      var body = g.rows.filter(function (cells) { return !(normH(cells[0] || '') === h0 && cells.map(normH).join('|') === hk); });   // the header repeated as a line (checked fully only when it could be)
      s.n = body.length; s.rows = body;
      if (k === 'post') { post.push({ head: head, rows: body, map: mapHeaders(head, postFieldOf).map, el: g.el }); return; }
      if (k === 'trace') { trace.push({ head: head, rows: body, map: mapHeaders(head, traceFieldOf).map }); return; }
      if (k === 'card') { s.n = 0; s.rows = []; return; }   // nothing of it is kept
      if (k === 'known') k = 'other';
      if (k === 'other') { if (other.length < 4 && (body.length > 1 || /\d/.test((body[0] || []).join(' ')))) other.push({ head: head, rows: body }); return; }   // a lone line without a number ("Hello, …") is not a table
      var m = mapHeaders(head), n0 = out.length;
      body.forEach(function (cells) { var r = rowFrom(cells, m.map); if (r.room || r.conf || r.name) out.push(r); });
      s.out = out.length - n0;
      // "1–25 of 42" near the grid
      var box = g.el.parentElement; for (var i = 0; i < 3 && box && box.parentElement; i++) box = box.parentElement;
      if (box) box.querySelectorAll('[class*="pag" i], [class*="count" i], [class*="total" i], [role="status"]').forEach(function (e) { if (!mine(e) && !total) total = totalOf(txt(e).slice(0, 80)); });
      // ADF names nothing "pag" or "total": a short text near the list that is only its count ("Results: 15", "1-15 of 15")
      for (var up = g.el, j = 0; !total && up && j < 6; up = up.parentElement, j++) {
        if (!up.parentElement || up.parentElement === doc.body) break;
        var tw = doc.createTreeWalker(up.parentElement, 4), tn, c = 0;
        while (!total && (tn = tw.nextNode()) && ++c < 400) { var v = tn.nodeValue; if (v && v.length < 40 && /\d/.test(v) && !g.el.contains(tn) && !inData(tn.parentElement || g.el)) total = totalLine(v); }
      }
    });
    return { raw: out, total: total, post: post, trace: trace, other: other, seen: seen, skipped: skipped };
  }
  // ── Oracle ADF forms (a reservation, a profile): a short text that names a field, and the value shown next to it ──
  var LABEL_TAGS = { SPAN: 1, LABEL: 1, DIV: 1, TD: 1, TH: 1, DT: 1 };
  var NOT_LABEL = 'button, a, select, option, textarea, h1, h2, h3, h4, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="columnheader"], [role="heading"], [role="link"], tr[_afrrk], [role="row"], ' + MENU_SEL;
  var INPUTS = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=image]), textarea, select';
  /** a field's value (null: a password / PIN / card field, never read) */
  function fieldVal(f) {
    if (secretInput(f)) return null;
    if (f.tagName === 'SELECT') { var o = f.options && f.options[f.selectedIndex]; return o ? o.text : ''; }
    return f.value == null ? '' : String(f.value);
  }
  /** what an element shows as a value ('' when it holds a label, or is too big to be one value) */
  function valFrom(e, lbls) {
    if (!e || mine(e)) return '';
    if (/^(?:INPUT|TEXTAREA|SELECT)$/.test(e.tagName)) return e.matches(INPUTS) ? fieldVal(e) : '';
    if (e.childElementCount > 12) return '';
    for (var i = 0; i < lbls.length; i++) if (e.contains(lbls[i])) return '';
    var f = e.querySelector(INPUTS); if (f) return fieldVal(f);
    return txt(e);
  }
  var tagRole = function (e) { var r = roleOf(e); return e.tagName.toLowerCase() + (r ? '[role=' + r + ']' : ''); };
  /** the label, then up: "span < td < tr < table[role=presentation]" (tags and roles only) */
  function pathOf(e) { var out = []; for (var i = 0; e && i < 4 && e !== document.body; e = e.parentElement, i++) out.push(tagRole(e)); return out.join(' < '); }
  /** the value next to a label element: (a) its next sibling · (b) its parent's (or grandparent's) next sibling · (c) an input in its row ·
   *  (d) an element aria-labelledby it. → [value, how, value element] · null (a secret field) · [] (none) */
  function valueFor(el, lt, lbls, doc) {
    var others = lbls.filter(function (x) { return x !== el; });
    var ok = function (x) {
      if (x == null) return null;
      x = sp(x).replace(/\s+/g, ' ').trim();
      return !x || x.length > 80 || x === lt || !/[\p{L}\p{N}]/u.test(x) || formLabel(x) || /^loading complete$/i.test(x) ? '' : x;
    };
    var only = function (box) { for (var i = 0; i < others.length; i++) if (box.contains(others[i])) return false; return true; };
    var e = el.nextElementSibling, v;
    if (e) { v = ok(valFrom(e, lbls)); if (v === null) return null; if (v) return [v, 'next-sibling', e]; }
    for (var p = el.parentElement, k = 0; p && k < 2 && p !== doc.body && only(p); p = p.parentElement, k++) {
      e = p.nextElementSibling; if (!e) continue;
      v = ok(valFrom(e, lbls)); if (v === null) return null; if (v) return [v, k ? 'grandparent-next' : 'parent-next', e];
    }
    var row = el.closest('tr') || (el.parentElement && el.parentElement.parentElement);
    if (row && row !== doc.body && only(row)) { var f = row.querySelector(INPUTS); if (f) { v = ok(fieldVal(f)); if (v === null) return null; if (v) return [v, 'row-input', f]; } }
    var ids = [el].concat(Array.prototype.slice.call(el.querySelectorAll('[id]'), 0, 3));
    for (var j = 0; j < ids.length; j++) {
      if (!ids[j].id) continue;
      try { e = doc.querySelector('[aria-labelledby~="' + (window.CSS && CSS.escape ? CSS.escape(ids[j].id) : ids[j].id) + '"]'); } catch (_) { e = null; }
      if (e) { v = ok(valFrom(e, [])); if (v === null) return null; if (v) return [v, 'aria-labelledby', e]; }
    }
    return [];
  }
  /** the label elements on screen: [{l, f, el}] (f '' for a label-like text that names no field: reports only) */
  function formLabels(doc, loose) {
    var root = doc.body, out = []; if (!root || !doc.createTreeWalker) return out;
    var tw = doc.createTreeWalker(root, 4), t, n = 0, seen = new Set();
    while ((t = tw.nextNode()) && ++n < 60000) {
      var s = t.nodeValue; if (!s || s.length < 2 || s.length > 60) continue;
      var f = formLabel(s), lt = sp(s).replace(/\s+/g, ' ').replace(/\s*[:*]+\s*$/, '').trim();
      if (!f && !(loose && lt.length <= 30 && /^\p{Lu}[\p{L} .\/&'\-]*$/u.test(lt) && lt.split(' ').length <= 4 && (/:\s*$/.test(s) || (t.parentElement && t.parentElement.tagName === 'LABEL')))) continue;
      var el = t.parentElement; if (!el || mine(el) || /^loading complete$/i.test(lt)) continue;
      for (var k = 0, up; k < 3 && (up = el.parentElement) && up !== root && LABEL_TAGS[up.tagName] && up.childElementCount <= 1 && sp(up.textContent).replace(/\s+/g, ' ').replace(/\s*[:*]+\s*$/, '').trim() === lt; k++) el = up;   // <td><label><span>Arrival</span></label></td> → the td
      if (!LABEL_TAGS[el.tagName] || seen.has(el) || el.closest(NOT_LABEL)) continue;
      if (el.tagName === 'TH' && el.parentElement && el.parentElement.querySelectorAll(':scope > th').length >= 2) continue;   // a column header
      seen.add(el); out.push({ l: lt, f: f, el: el });
      if (out.length >= (loose ? 400 : 200)) break;
    }
    return out;
  }
  /** the fields of an ADF form → [{l, v, f, el, how, vel}] (only labels that name a field; never a secret field) */
  function readForm(doc) {
    var L = formLabels(doc, false), els = L.map(function (x) { return x.el; }), out = [];
    L.forEach(function (x) {
      var r = valueFor(x.el, x.l, els, doc); if (!r || !r[0]) return;
      out.push({ l: x.l, v: maskCards(r[0]), f: x.f, el: x.el, how: r[1], vel: r[2] });
    });
    return out;
  }
  /** a list shown as cards (each reservation a box of label → value): one guest line per box. [] when it isn't one. */
  function recordsOf(hits, order) {
    var cnt = {}; (hits || []).forEach(function (h) { cnt[h.f] = (cnt[h.f] || 0) + 1; });
    var a = ['conf', 'room', 'name', 'last'].filter(function (f) { return cnt[f] >= 2; })[0]; if (!a) return [];
    var an = hits.filter(function (h) { return h.f === a; }).slice(0, 150);
    var roots = an.map(function (h) {
      var r = h.el;
      while (r.parentElement && r.parentElement !== document.body) {
        var p = r.parentElement, c = 0;
        for (var i = 0; i < an.length && c < 2; i++) if (p.contains(an[i].el)) c++;
        if (c > 1) break; r = p;
      }
      return r;
    });
    var groups = roots.map(function () { return []; });
    hits.forEach(function (h) { for (var i = 0; i < roots.length; i++) if (roots[i].contains(h.el)) { groups[i].push([h.l, h.v]); return; } });
    var raw = []; groups.forEach(function (g) { var r = pairsToRow(g, order, true); if (r) raw.push(r); });
    return raw.length >= 2 ? raw : [];
  }
  /** label → value pairs on screen (reservation details), outside the lists. Never a password, PIN or card field.
   *  pairs.form: the ADF form fields found by their place (for the card lists and the reports). */
  function readPairs(doc) {
    var pairs = [], seen = new Set();
    var add = function (l, v, el) { l = sp(l).replace(/[:*]\s*$/, '').trim(); v = sp(v).trim(); if (!l || !v || l.length > 40 || v.length > 200 || seen.has(l + '|' + v) || secretLabel(l) || /^loading complete$/i.test(l)) return; if (el && (mine(el) || inData(el))) return; seen.add(l + '|' + v); pairs.push([l, maskCards(v)]); };
    var field = function (n) { return n && n.querySelector ? n.querySelector('input,textarea,select') : null; };
    doc.querySelectorAll('label').forEach(function (l) {
      var id = l.getAttribute('for'), t = id ? doc.getElementById(id) : null, v = '';
      if (t) { if (secretInput(t)) return; v = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) ? (t.tagName === 'SELECT' ? fieldVal(t) || '' : valOf(t)) : txt(t); }
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
    var form = []; try { form = readForm(doc); } catch (_) {}
    form.forEach(function (h) { add(h.l, h.v, null); });
    pairs = pairs.slice(0, 200); pairs.form = form;
    return pairs;
  }
  /** the folio windows shown (tabs "Window 1 · 120.00", "Window 2"…) → [{n, balance}] and the one open */
  function readWindows(doc) {
    var out = [], cur = 0;
    doc.querySelectorAll('[role="tab"], [class*="window" i], [id*="window" i], [class*="folio" i]').forEach(function (e) {
      if (mine(e) || inData(e)) return;
      var t = txt(e); if (!t || t.length > 120) return;
      var all = t.match(/\bwindow\b/gi); if (!all || all.length !== 1) return;   // a box holding all the windows: its tabs are read one by one
      var m = t.match(/\bwindow\s*#?\s*([1-8])\b/i); if (!m) return;
      var rest = t.slice(m.index + m[0].length), mm = rest.match(/\(?-?\s*(?:[A-Z]{3}\s*)?-?[\d,]+\.\d{2}\)?(?:\s*CR\b)?/);
      out.push({ n: +m[1], balance: mm ? money(mm[0]) : null });
      if (e.getAttribute('aria-selected') === 'true' || /\b(?:selected|active|current)\b/i.test(e.getAttribute('class') || '')) cur = +m[1];
    });
    return { wins: out, cur: cur };
  }
  /** the screen's headings (and the open tab last): Opera Cloud's address never changes, so these say which screen it is */
  function headings(doc) {
    var out = [];
    doc.querySelectorAll('h1, h2, [role="heading"][aria-level="1"], [role="heading"][aria-level="2"], [class*="page-title" i], [class*="pageTitle"], [class*="oj-flex-bar-middle"] h1, [aria-current="page"]').forEach(function (h) { if (!mine(h) && !h.closest(MENU_SEL)) { var t = txt(h); if (t && t.length < 90 && out.indexOf(t) < 0) out.push(t); } });
    doc.querySelectorAll('[role="tab"][aria-selected="true"]').forEach(function (h) { if (!mine(h)) { var t = txt(h); if (t && t.length < 40 && out.indexOf(t) < 0) out.push(t); } });
    return out.slice(0, 16);
  }
  function screenDate(doc, order) {
    var cand = [];
    doc.querySelectorAll('h1, h2, h3, [role="heading"], [class*="date" i], [id*="date" i], [aria-label*="date" i]').forEach(function (e) {
      if (mine(e) || inData(e)) return;
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
  var SPECIAL = { billing: 1, rooms: 1, audit: 1, traces: 1, profile: 1, rates: 1, group: 1, checkin: 1, queue: 1 };
  var REPLACE = { details: 1, billing: 1, profile: 1, traces: 1, checkin: 1 };   // one thing on screen: the newest read replaces the last one
  var LOOSE = { billing: 1, profile: 1, traces: 1, checkin: 1, details: 1 };   // a name, a room or a conf. and one more thing is a guest there
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
      var readP = !rows.length || REPLACE[hint] || g.post.length;
      var pairs = readP ? readPairs(document) : [];
      var det = null;
      // a list shown as cards (In House / Queue in Opera's list view): one line per card
      if (!rows.length && pairs.form && !REPLACE[hint]) { var recs = recordsOf(pairs.form, order); if (recs.length) rows = recs; }
      if (!rows.length && pairs.length) det = pairsToRow(pairs, order) || (LOOSE[hint] || g.post.length ? pairsToRow(pairs, order, true) : null);
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
      if (det && (kind === 'details' || kind === 'profile' || kind === 'traces' || kind === 'checkin')) det.extra = pairsExtra(pairs);
      if (kind === 'rooms') rows.forEach(function (r) { if (!r.rs && r.statusText) { var x = normRoomStatus(r.statusText); if (x) { r.rs = x; r.roomStatus = r.statusText; delete r.status; } } });
      g.other.forEach(function (o) { var tb = tableFrom(o.head, o.rows, heads[0] || document.title); if (tb) tables.push(tb); });
      if (kind === 'audit') { var tx = heads.slice(); tables.forEach(function (tb) { tb.rows.forEach(function (r) { tx.push(r.join(' ')); }); }); pairs.forEach(function (p) { tx.push(p[0] + ' ' + p[1]); }); audit = { state: auditState(tx) }; }
      var date = screenDate(document, order);
      var key = kind + '|' + date + '|' + (heads[0] || document.title || '').replace(/\d+/g, '#').slice(0, 60);   // "Arrivals (42)" while it loads is the same screen
      if (key !== view.key) { view = { key: key, kind: kind, date: date, rows: [], title: (heads[0] || document.title || '').slice(0, 90), total: 0 }; noteScreen(kind, view.title); if (kind) tl('📺', (KLABEL[kind] || 'A screen') + ' on screen'); }
      view.rows = REPLACE[kind] ? rows : mergeRows(view.rows, rows);
      if (view.rows.length > 1500) view.rows = view.rows.slice(-1500);
      if (g.total) view.total = g.total;
      else if (rows.length && !REPLACE[kind]) { var hn = (heads[0] || '').match(/\((\d{1,5})\)\s*$/); if (hn) view.total = +hn[1]; }   // "Departures (15)"
      view.folio = folio; view.traces = traces; view.tables = tables; view.audit = audit;
      lastCtx = { kind: kind, hint: hint, heads: heads, date: date, g: g, pairs: readP ? pairs : null, rowsN: rows.length, tables: tables.length };
      checkStuck(lastCtx);
      send();
      render();
    } catch (e) { lastErr = String(e && e.message || e).slice(0, 120); lastErrAt = Date.now(); stuckErr(lastErr); render(); }
    CLS = null;
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

  // ── when it can't read a screen: a report of the screen's layout (never its values) for the developer ──
  // Checked on every read (cheap: what readGrids already saw). A report is built only when the same stuck screen shows on two reads
  // in a row (not while it loads), once per screen and day, inside this idle read; it goes to HotelOps (Settings → Opera reader).
  var GUEST_K = { arrivals: 1, departures: 1, inhouse: 1, search: 1, list: 1, details: 1 };
  var lastCtx = null, stuckLast = '', stuckRun = 0, stuckQ = [], stuckAt = 0, errRun = {}, errN = 0;
  var dayNow = function () { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var stuckDone = LS.get('ho_op_stuck', null);
  function doneToday() { if (!stuckDone || stuckDone.d !== dayNow() || !Array.isArray(stuckDone.h)) stuckDone = { d: dayNow(), h: [] }; return stuckDone.h; }
  /** what is wrong on screen → [{c, t}] (the grids behind it get .bad). Only lists that hold data count (2+ lines, 3+ columns,
   *  digits in 30% of the lines): Opera's menus and layout tables never make a report. */
  var FORM_K = { details: 1, profile: 1, checkin: 1 };
  function stuckWhy(c) {
    var why = [], g = c.g || { seen: [], raw: [] }, anyGuest = (g.raw || []).length > 0, dataN = 0;
    g.seen.forEach(function (s) {
      s.bad = false; s.data = dataLook(s.rows, s.w);
      if (s.data) dataN++;
      if (!s.k) {
        if (s.data) { s.bad = true; why.push({ c: 'unread-grid', t: 'a list with ' + s.n + ' rows and ' + s.w + ' columns has no header line it could read' }); }
      } else if (s.k === 'card' || s.k === 'known' || FORM_K[c.hint]) {
        // a known side table, or a table on a reservation / profile screen (the form above it carries the guest): nothing to report
      } else if (s.k === 'other' && !anyGuest && GUEST_K[c.hint] && s.data) {
        s.bad = true; why.push({ c: 'unread-grid', t: 'a grid with ' + s.n + ' rows on a "' + c.hint + '" screen: its headers could not be matched (' + (s.head || []).filter(Boolean).map(headText).join(' · ') + ')' });
      } else if (s.k === 'guest' && s.n > 0 && !s.out) { s.bad = true; why.push({ c: 'nothing-useful', t: s.n + ' rows read, but none has a room, a conf. number or a name' }); }
    });
    var pn = c.pairs ? c.pairs.length : 0, unread = g.seen.some(function (s) { return s.bad; });
    var reportsForm = isReportForm(c);
    if (!c.hint && !reportsForm && ((!c.kind || c.kind === 'other') && (dataN || pn >= 6) || (c.kind === 'list' && unread))) {
      why.push({ c: 'unknown-screen', t: 'the screen kind is ' + (c.kind ? 'only "' + c.kind + '"' : 'unknown') + ': its title and headings name no screen it knows, yet it shows ' + (dataN ? dataN + ' data list' + (dataN === 1 ? '' : 's') : pn + ' label/value pairs') });
    }
    var filters = (c.pairs || []).some(function (p) { return /^(?:arrival|departure)\s+(?:from|to)$/i.test(sp(p[0]).trim()); });   // "Arrival From / To": a search form, not a reservation
    if ((c.kind === 'details' || c.kind === 'profile') && !c.rowsN && c.pairs && !filters) why.push({ c: 'unread-form', t: 'a ' + (c.kind === 'profile' ? 'profile' : 'reservation') + ' screen, but its fields could not be read (' + pn + ' label/value pair' + (pn === 1 ? '' : 's') + ' found)' });
    if ((c.kind === 'arrivals' || c.kind === 'departures') && !c.date && (c.rowsN || g.seen.length)) why.push({ c: 'no-date', t: 'a ' + c.kind + ' screen, but no date found on it (it needs one to know the day)' });
    return why.slice(0, 6);
  }
  function stuckHash(c, why) {
    return hash(['stuck', c.kind, c.hint, structText(document.title), pathShape(location.pathname, location.hash), why.map(function (w) { return w.c; }),
      (c.g ? c.g.seen : []).filter(function (s) { return s.bad; }).map(function (s) { return (s.head || []).map(normH).join('|'); })]);
  }
  function checkStuck(c) {
    var why = stuckWhy(c);
    if (!why.length) { stuckLast = ''; stuckRun = 0; return; }
    var h = stuckHash(c, why);
    if (h !== stuckLast) { stuckLast = h; stuckRun = 0; }
    if (++stuckRun < 2 || doneToday().indexOf(h) >= 0 || stuckQ.some(function (q) { return q.h === h; })) return;
    var rep = buildReport(c, why);
    if (!rep) { doneToday().push(h); LS.set('ho_op_stuck', stuckDone); return; }   // it still looked like guest data: not sent, not built again today
    stuckQ.push({ h: h, rep: rep }); flushStuck();
  }
  function flushStuck() {
    while (stuckQ.length) {
      var q = stuckQ[0];
      if (!post({ source: 'ho-op', v: VERSION, stuck: q.rep, h: q.h, frame: FRAME })) return;
      stuckQ.shift(); var d = doneToday(); d.push(q.h); if (d.length > 300) d.splice(0, d.length - 300); LS.set('ho_op_stuck', stuckDone);
      stuckAt = Date.now(); tl('🛟', 'Couldn\'t read this screen: its layout went to HotelOps');
    }
  }
  /** the same error on the same screen twice → a report */
  function stuckErr(msg) {
    var k = hash([structText(document.title), location.pathname, msg]);
    if (++errN > 200) { errRun = {}; errN = 1; }
    errRun[k] = (errRun[k] || 0) + 1; if (errRun[k] !== 2) return;
    tl('⚠', 'Reader error: ' + msg.slice(0, 80));
    var c = { kind: '', hint: '', heads: [], date: '', g: { seen: [], raw: [] }, pairs: [], rowsN: 0, tables: 0, err: msg };
    try { c.heads = headings(document); c.g = readGrids(document, ''); } catch (_) {}
    var h = hash(['err', k]); if (doneToday().indexOf(h) >= 0) return;
    var rep = buildReport(c, [{ c: 'error', t: 'the reader failed twice on this screen' }]);
    if (rep) { stuckQ.push({ h: h, rep: rep }); flushStuck(); }
  }
  /** an element's attribute NAMES ("_afrrk,class,role"): how ADF marks its lines and cells, never a value */
  function attrNames(e) { var out = []; for (var i = 0; e && e.attributes && i < e.attributes.length && out.length < 8; i++) { var n = e.attributes[i].name; if (/^[a-z_:\-]{1,30}$/i.test(n)) out.push(n); } return out.join(','); }
  /** the page's side of a report: the biggest data lists first (header cells, the first line's cells, ancestors), and the form's
   *  labels with where each value sits; then makeReport keeps only shapes */
  function buildReport(c, why) {
    try {
      var g = c.g || { seen: [] }, pairs = c.pairs || readPairs(document);
      var size = function (s) { return (s.bad ? 1e7 : 0) + (s.data ? 1e6 : 0) + s.n * Math.max(1, s.w || 1); };
      var grids = g.seen.slice().sort(function (a, b) { return size(b) - size(a); }).slice(0, 4).map(function (s, gi) {
        var el = s.el, hel = s.hel || el, t = el.tagName.toLowerCase(), r = el.getAttribute('role');
        var sel = t + (r ? '[role=' + r + ']' : '');
        var oj = el.closest('oj-table, oj-data-grid, [class*="oj-table"], [class*="oj-datagrid"], [class*="oj-data-grid"]');
        if (oj) sel += ' in ' + (oj.tagName.indexOf('-') > 0 ? oj.tagName.toLowerCase() : 'oj-table');
        var hc = []; hel.querySelectorAll('th, [role="columnheader"]').forEach(function (x) { var row = x.closest(ROW_SEL); if (hc.length < 30 && row && ownerOf(row) === hel) hc.push(x); });
        var cells = hc.length ? (hc[0].tagName === 'TH' ? 'th' : 'role=columnheader') + (hel !== el ? ' (in a separate header grid)' : '') : s.head ? 'first row in thead' : 'none';
        var anc = []; for (var e = el, i = 0; e && i < 4 && e !== document.body && e !== document.documentElement; e = e.parentElement, i++) anc.push({ t: e.tagName.toLowerCase(), r: e.getAttribute('role') || '', c: classShape(e.getAttribute('class')) });
        var o = { sel: sel, cells: cells, head: s.head || [], aria: hc.map(function (x) { return x.getAttribute('aria-label') || x.getAttribute('title') || ''; }).filter(Boolean), anc: anc, n: s.n, rows: s.rows, stuck: !!s.bad };
        if (gi < 2) {   // the two biggest: how ADF marks the header cells and a line
          o.hc = hc.slice(0, 12).map(function (x) { var n = x.getAttribute('aria-colindex'); return tagRole(x) + (n ? '[aria-colindex=' + n + ']' : ''); });
          var r0 = s.r0;
          if (r0) o.rc = tagRole(r0) + ' {' + attrNames(r0) + '} in ' + tagRole(r0.parentElement && r0.parentElement.closest('table, [role="grid"], [role="treegrid"]') || r0) + ' · cells: ' + cellsOf(r0).slice(0, 6).map(function (x) { return tagRole(x) + ' {' + attrNames(x) + '}'; }).join(' ');
        }
        return o;
      });
      // the form: the labels found (fields first, then other label-like texts) and the shape of the value next to each
      var form = [];
      var wantForm = /^(?:details|profile|checkin)$/.test(c.kind || '') || /^(?:details|profile|checkin)$/.test(c.hint || '') || why.some(function (w) { return /^(?:unread-form|manual|layout|unknown-screen)$/.test(w.c); });
      if (wantForm) {
        var L = formLabels(document, true), els = L.map(function (x) { return x.el; });
        L.sort(function (a, b) { return (b.f ? 1 : 0) - (a.f ? 1 : 0); });
        for (var i = 0; i < L.length && form.length < 25; i++) {
          var x = L[i], vr = valueFor(x.el, x.l, els, document); if (vr === null) continue;
          form.push({ l: x.l, f: x.f || '', how: vr[1] || 'no value found', path: pathOf(x.el) + (vr[2] ? ' · value ' + pathOf(vr[2]).split(' < ').slice(0, 2).join(' < ') : ''), v: vr[0] || '' });
        }
      }
      var ff = (pairs.form || []).length;
      var concl = 'kind ' + (c.kind || 'none') + ' · ' + (c.rowsN || 0) + ' guest line' + (c.rowsN === 1 ? '' : 's') + ' · ' + (c.tables || 0) + ' plain table' + (c.tables === 1 ? '' : 's') + ' · ' + g.seen.length + ' grid' + (g.seen.length === 1 ? '' : 's') + ' with rows (' + g.seen.filter(function (s) { return s.data; }).length + ' look like data) · ' + (g.skipped || 0) + ' menu / layout tables skipped · ' + pairs.length + ' label/value pairs (' + ff + ' from the form layout) · date ' + (c.date ? 'found' : 'not found');
      return makeReport({ v: VERSION, at: Date.now(), kind: c.kind, hint: c.hint, date: c.date, title: document.title, path: location.pathname, hash: location.hash, heads: c.heads, why: why, grids: grids, pairs: pairs, form: form, concl: concl, err: c.err });
    } catch (_) { return null; }
  }
  /** the 🛟 buttons: "Not read right?" sends a report of this screen to HotelOps; "Copy screen layout" copies it here */
  function manualReport(copy) {
    var c = lastCtx;
    if (!c) { try { c = { kind: '', hint: '', heads: headings(document), date: '', g: readGrids(document, ''), pairs: null, rowsN: 0, tables: 0 }; } catch (_) { helpSay('Could not look at this screen'); return; } }
    var why = stuckWhy(c);
    why.unshift(copy ? { c: 'layout', t: 'the screen layout, asked for from the Opera window' } : { c: 'manual', t: 'you pressed "Not read right?" in the Opera window' });
    var rep = buildReport(c, why);
    if (!rep) { helpSay('This screen\'s titles look like guest data, so nothing was made. Send a screenshot instead.'); return; }
    if (copy) {
      var p = null; try { p = navigator.clipboard.writeText(reportText(rep)); } catch (_) {}
      if (p && p.then) p.then(function () { helpSay('Copied ✓ Paste it to Claude (layout only, no guest data).'); }, function () { helpSay('This browser blocked copying here: press "Not read right?", then HotelOps → Settings → Opera reader → Copy for Claude.'); });
      else helpSay('This browser blocked copying here: press "Not read right?", then HotelOps → Settings → Opera reader → Copy for Claude.');
      return;
    }
    var ok = post({ source: 'ho-op', v: VERSION, stuck: rep, h: hash(['manual', c.kind, structText(document.title), pathShape(location.pathname, location.hash)]), frame: FRAME });
    helpSay(ok ? 'Sent ✓ In HotelOps: Settings → 📡 Opera reader → 🛟 → Copy for Claude.' : 'Not linked to HotelOps yet: use "Copy screen layout" instead.');
    if (ok) tl('🛟', 'You reported this screen to HotelOps');
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
    if (b.closest('tr[_afrrk], [role="row"]') || (b.closest(GRID_SEL) && !b.closest(MENU_SEL) && inData(b))) steps.push({ t: Date.now(), k: 'r' });   // a line of a list (Opera's menus are tables too: those are labels)
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
    if (post({ source: 'ho-op', v: VERSION, h: h, snap: scrub(snap), at: Date.now() })) {
      sentHash = h; sentAt = Date.now(); sentN = snap.rows.length || (snap.folio ? snap.folio.postings.length : 0) || (snap.traces || snap.tables || []).length;
      tl('📡', cap(summary(view.kind, sentN, view.total)) + ' → HotelOps');
    }
    if (!TOP) try { window.top.postMessage({ __hoOpFrame: 1, id: FRAME, kind: view.kind, n: view.rows.length, total: view.total || 0 }, '*'); } catch (_) {}
  }
  function onMsg(d) {
    if (!d || typeof d !== 'object') return;
    extIn = Date.now();   // the helper's link is alive
    if (d.source === 'ho-op-relay') { relay = { apps: +d.apps || 0, v: String(d.v || '').slice(0, 12), at: Date.now() }; relayEver = true; render(); return; }   // the helper's relay (from v436): is a HotelOps tab there?
    if (d.source === 'ho-op-guard') { guardMsg(d); return; }   // 🛡 armed / disarmed by HotelOps
    if (d.source === 'ho-away') { if (d.away && typeof d.away === 'object') guardMsg(d.away); return; }   // 🛡 the helper's relay: you're away (or a PIN unlocked another tab)
    if (d.source !== 'ho-op-ack') return;
    if (d.guard && typeof d.guard === 'object') guardMsg(d.guard);   // the same inside an answer (an older helper carries only these)
    if (Array.isArray(d.gack)) { LOCK.ack(d.gack); if (!d.h && !d.pong && !d.text) return; }
    if (Date.now() - linked > 45000) tl('🔗', 'Linked to HotelOps');
    linked = Date.now();
    if (d.app) appV = String(d.app).slice(0, 12);
    if (d.teach && typeof d.teach === 'object') { var th = hash(d.teach); if (th !== taughtH) { taughtH = th; setTaught(d.teach); LS.set('ho_op_teach', d.teach); stuckLast = ''; lastCtx = null; laterScan(300); } }   // what the hotel taught: read the screen again with it
    if (d.h && d.text) { var nt = String(d.text).slice(0, 140); if (!lastAck || lastAck.text !== nt || Date.now() - lastAck.at > 60000) tl('✓', 'HotelOps: ' + nt); lastAck = { text: nt, at: Date.now() }; }
    if (typeof d.learn === 'boolean' && d.learn !== LEARN) { LEARN = d.learn; LS.set('ho_op_learn', LEARN); if (!LEARN) steps = []; }   // "Learn from me in Opera" (HotelOps → Settings)
    if (typeof d.hint === 'string') hintNow = d.hint ? { text: d.hint.slice(0, 60), at: Date.now() } : null;
    if (d.again && (!d.frame || d.frame === FRAME)) { sentHash = ''; send(true); }   // HotelOps (re)opened and hasn't got what is on screen
    render();
  }
  if (EXT && typeof EXT.on === 'function') EXT.on(onMsg);
  function onWinMsg(e) {
    if (e.data && e.data.__hoLockHuman && TOP) { LOCK.human(); return; }   // someone is working in a frame of this tab (auto-lock waits)
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
    if (stuckQ.length) flushStuck();
    // the Opera Cloud address (origin + path, no query or hash): HotelOps' "Open Opera" button opens it
    post({ source: 'ho-op', ping: 1, t: Date.now(), v: VERSION, frame: FRAME, h: view.rows.length ? sentHash : '', home: TOP ? location.origin + location.pathname : '' });
    Object.keys(frames).forEach(function (k) { if (Date.now() - frames[k].at > 120000) delete frames[k]; });
    render();
  }

  // ── the window in Opera (top frame only; another frame's reads show here too) ──
  // A Shadow DOM (Opera's CSS can't reach it), built with DOM calls and inline styles only (Opera's page rules may block <style>).
  // It redraws only when what it shows changes; it reads no layout while Opera's screen is read.
  var RM = false; try { RM = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) {}
  var SANS = 'system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
  var COL = { txt: '#eef2f8', txt2: '#b9c3d2', txt3: '#8e9bb0', ok: '#34d399', warn: '#fbbf24', bad: '#f87171' };
  var KLABEL = { arrivals: 'Arrivals', departures: 'Departures', inhouse: 'In House', search: 'Reservation search', details: 'Reservation', list: 'Reservation list', billing: 'Billing / Folio',
    rooms: 'Room status', profile: 'Profile', traces: 'Traces / Alerts', rates: 'Rates', group: 'Group / Block', audit: 'Night audit', other: 'Other screen' };
  var cap = function (t) { t = String(t || ''); return t.charAt(0).toUpperCase() + t.slice(1); };
  var UIK = 'ho_op_ui:' + location.host, UI = LS.get(UIK, null) || {};   // per host: {min, r, b, tab}
  var saveUI = function () { LS.set(UIK, UI); };
  var linkT0 = Date.now(), relay = null, relayEver = false, extIn = 0, appV = '', lastErrAt = 0, touched = false, helpTxt = '', helpAt = 0, lastSig = '', pulse = null;
  var TL = [];   // this tab's timeline today (kept in memory only: it can name rooms)
  function tl(icon, text) { TL.unshift({ at: Date.now(), i: icon, t: String(text).slice(0, 140) }); if (TL.length > 40) TL.length = 40; }
  var host, winEl, badge, bDot, bNum, hDot, hTxt, tabB = {}, panes = {}, E = {};
  // the HotelOps logo (the same as in the app: a white H on a glowing indigo tile)
  var logoN = 0;
  function logo(px) {
    var NS = 'http://www.w3.org/2000/svg', id = 'hoopG' + (++logoN);
    var mk = function (tag, at, parent) { var e = document.createElementNS(NS, tag); Object.keys(at).forEach(function (k) { e.setAttribute(k, at[k]); }); if (parent) parent.appendChild(e); return e; };
    var svg = mk('svg', { viewBox: '0 0 64 64', width: px, height: px, 'aria-hidden': 'true', style: 'display:block' }), defs = mk('defs', {}, svg);
    var rg = mk('radialGradient', { id: id, cx: '.3', cy: '.25', r: '.9' }, defs);
    [['0', '#7c8cff'], ['.55', '#4f46e5'], ['1', '#1e1b4b']].forEach(function (s) { mk('stop', { offset: s[0], 'stop-color': s[1] }, rg); });
    var lg = mk('linearGradient', { id: id + 'h', x1: '0', y1: '0', x2: '0', y2: '1' }, defs);
    mk('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '.22' }, lg); mk('stop', { offset: '.5', 'stop-color': '#fff', 'stop-opacity': '0' }, lg);
    mk('rect', { width: 64, height: 64, rx: 14.5, fill: 'url(#' + id + ')' }, svg); mk('rect', { width: 64, height: 64, rx: 14.5, fill: 'url(#' + id + 'h)' }, svg);
    var g = mk('g', { fill: '#fff' }, svg);
    mk('rect', { x: 18, y: 16, width: 8.5, height: 32, rx: 4.25 }, g); mk('rect', { x: 37.5, y: 16, width: 8.5, height: 32, rx: 4.25 }, g); mk('rect', { x: 22, y: 28.5, width: 20, height: 7, rx: 3.5 }, g);
    mk('circle', { cx: 47, cy: 14, r: 3.2, fill: '#c7d2fe' }, svg);
    return svg;
  }
  var curTab = /^(?:now|today|help)$/.test(UI.tab || '') ? UI.tab : 'now';
  function el(tag, css, text, parent) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; }
  var BTN = 'all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:10px;font:600 13px/1.2 ' + SANS + ';padding:8px 12px;white-space:nowrap;transition:filter .15s,background .15s,transform .1s;';
  var BTN_GO = BTN + 'color:#1a1408;background:linear-gradient(135deg,#f1d184,#c9a14a 60%,#a8842f);box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 6px 14px -8px rgba(201,161,74,.9);';
  var BTN_2 = BTN + 'color:' + COL.txt + ';background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);';
  var CARD = 'box-sizing:border-box;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);';
  var LABEL = 'font:700 10.5px/1.2 ' + SANS + ';letter-spacing:.08em;text-transform:uppercase;color:' + COL.txt3 + ';';
  function btn(label, css, parent, act, fn) {
    var b = el('button', css, label, parent); b.type = 'button'; if (act) b.setAttribute('data-act', act);
    b.addEventListener('mouseenter', function () { b.style.filter = 'brightness(1.12)'; }, { passive: true });
    b.addEventListener('mouseleave', function () { b.style.filter = 'none'; }, { passive: true });
    b.addEventListener('focus', function () { var v = false; try { v = b.matches(':focus-visible'); } catch (_) {} if (v) { b.style.outline = '2px solid #f1d184'; b.style.outlineOffset = '2px'; } }, { passive: true });
    b.addEventListener('blur', function () { b.style.outline = 'none'; }, { passive: true });
    if (fn) b.addEventListener('click', function (e) { touched = true; fn(e); }, { passive: true });
    return b;
  }
  function anim(e, frames, opt) { if (RM || !e || !e.animate) return null; try { return e.animate(frames, opt); } catch (_) { return null; } }
  function helpSay(t) { helpTxt = t; helpAt = Date.now(); render(); }
  function build() {
    if (!TOP || !document.body) return;
    host = el('div', 'position:fixed;right:16px;bottom:16px;z-index:2147483646;');
    host.setAttribute('data-hotelops', 'opera-reader');
    pillHost = host;
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var wrap = el('div', 'all:initial;display:flex;flex-direction:column;align-items:flex-end;gap:8px;font:13px/1.45 ' + SANS + ';color:' + COL.txt + ';-webkit-font-smoothing:antialiased', null, root);
    // the window: dark glass with a clear edge, so it reads on Opera's white screens too
    winEl = el('div', 'box-sizing:border-box;width:344px;max-width:calc(100vw - 24px);border-radius:16px;overflow:hidden;color:' + COL.txt + ';background:linear-gradient(180deg,rgba(24,30,43,.96),rgba(14,18,27,.97));-webkit-backdrop-filter:blur(16px) saturate(1.4);backdrop-filter:blur(16px) saturate(1.4);border:1px solid rgba(255,255,255,.13);box-shadow:0 24px 60px -18px rgba(0,0,0,.6),0 3px 10px rgba(0,0,0,.22),0 0 0 1px rgba(0,0,0,.3)', null, wrap);
    winEl.setAttribute('role', 'dialog'); winEl.setAttribute('aria-label', 'HotelOps Opera reader');
    var head = el('div', 'display:flex;align-items:center;gap:10px;padding:11px 8px 10px 12px;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;border-bottom:1px solid rgba(255,255,255,.07);background:linear-gradient(180deg,rgba(255,255,255,.04),transparent)', null, winEl);
    head.title = 'Drag to move · double-click to put it back';
    el('div', 'flex:none;width:32px;height:32px;border-radius:9px;overflow:hidden;box-shadow:0 4px 12px -4px rgba(79,70,229,.6)', null, head).appendChild(logo(32));
    var tb = el('div', 'flex:1;min-width:0', null, head);
    el('div', 'font:700 14px/1.2 ' + SANS + ';color:#fff;letter-spacing:-.01em', 'Opera reader', tb);
    var st = el('div', 'display:flex;align-items:center;gap:6px;margin-top:3px;min-width:0', null, tb);
    hDot = el('span', 'flex:none;width:8px;height:8px;border-radius:50%;background:' + COL.warn + ';box-shadow:0 0 0 3px rgba(251,191,36,.15)', null, st);
    hTxt = el('span', 'font:500 12px/1.2 ' + SANS + ';color:' + COL.txt2 + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0', '', st);
    var ICON = 'all:unset;box-sizing:border-box;cursor:pointer;flex:none;width:30px;height:30px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;color:' + COL.txt2 + ';font:600 16px/1 ' + SANS + ';';
    var minB = btn('–', ICON, head, 'min', function () { setMin(true); }); minB.title = 'Make it small'; minB.setAttribute('aria-label', 'Minimise');
    // tabs
    var bar = el('div', 'display:flex;gap:4px;margin:10px 12px 0;padding:3px;border-radius:11px;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.06)', null, winEl);
    bar.setAttribute('role', 'tablist');
    [['now', 'Now'], ['today', 'Today'], ['help', '🛟 Help']].forEach(function (t) {
      tabB[t[0]] = btn(t[1], 'all:unset;box-sizing:border-box;cursor:pointer;flex:1;text-align:center;padding:6px 4px;border-radius:8px;font:600 12.5px/1.2 ' + SANS + ';color:' + COL.txt3 + ';transition:background .2s,color .2s', bar, 'tab-' + t[0], function () { setTab(t[0]); });
      tabB[t[0]].setAttribute('role', 'tab');
    });
    var body = el('div', 'padding:10px 12px 12px;max-height:min(380px,62vh);overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) transparent', null, winEl);
    ['now', 'today', 'help'].forEach(function (k) { panes[k] = el('div', 'display:none;flex-direction:column;gap:8px', null, body); });
    // Now
    var P = panes.now;
    E.link = el('div', CARD + 'display:none;border-color:rgba(251,191,36,.38);background:rgba(251,191,36,.09)', null, P);
    E.linkT = el('div', 'font-weight:700;color:#fde68a', '', E.link);
    E.linkD = el('div', 'margin-top:3px;color:' + COL.txt + ';font-size:12.5px', '', E.link);
    E.linkL = el('ol', 'display:none;margin:8px 0 0;padding-left:18px;color:' + COL.txt2 + ';font-size:12.5px;flex-direction:column;gap:3px', null, E.link);
    ['Is HotelOps open in this same browser (the same Chrome / Edge profile)?', 'Reload the HotelOps tab: an older HotelOps can\'t link.', 'Still nothing: chrome://extensions → ↻ on the HotelOps helper.'].forEach(function (t) { el('li', '', t, E.linkL); });
    var lb = el('div', 'display:flex;gap:6px;flex-wrap:wrap;margin-top:9px', null, E.link);
    E.retry = btn('🔁 Retry link', BTN_GO, lb, 'retry', retryLink);
    E.conn = btn('Connect', BTN_GO, lb, 'connect', connect);
    E.openApp = btn('Open HotelOps', BTN_2, lb, 'open-app', function () { try { window.open(APP_URL, '_blank'); } catch (_) {} });
    var sc = el('div', CARD, null, P);
    el('div', LABEL, 'On screen', sc);
    E.scr = el('div', 'margin-top:3px;font:700 15px/1.25 ' + SANS + ';color:#fff', '', sc);
    E.scr2 = el('div', 'margin-top:2px;color:' + COL.txt2 + ';font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', '', sc);
    var dc = el('div', CARD, null, P);
    el('div', LABEL, 'HotelOps did', dc);
    E.did = el('div', 'margin-top:3px;color:' + COL.txt + ';font-size:13px', '', dc);
    E.undo = el('div', 'display:none;margin-top:6px;color:' + COL.txt3 + ';font-size:12px', '↩ Not right? Undo it in HotelOps: the toast there, or Settings → 📡 Opera reader.', dc);
    E.next = el('div', CARD + 'display:none;color:#dfe3ff;border-color:rgba(129,140,248,.35);background:rgba(129,140,248,.12)', '', P);
    E.stuck = el('div', CARD + 'display:none;color:#ffe1e1;border-color:rgba(248,113,113,.35);background:rgba(248,113,113,.10)', '', P);
    el('div', 'color:' + COL.txt3 + ';font-size:11.5px;padding:0 2px', 'Only reads Opera: it never clicks or types here.', P);
    // Today
    E.today = el('div', 'display:flex;flex-direction:column;gap:2px', null, panes.today);
    // Help
    var Hp = panes.help;
    el('div', 'color:' + COL.txt2 + ';font-size:12.5px', 'Screen not read right? Tell the developer: only the screen\'s layout goes (headers and shapes like "Aaaa 99"), never guest data.', Hp);
    var hb = el('div', 'display:flex;gap:6px;flex-wrap:wrap', null, Hp);
    btn('🛟 Not read right?', BTN_GO, hb, 'report', function () { manualReport(false); });
    btn('📋 Copy screen layout', BTN_2, hb, 'copy-layout', function () { manualReport(true); });
    E.help = el('div', CARD + 'display:none;color:#e9f7ef;border-color:rgba(52,211,153,.35);background:rgba(52,211,153,.10);font-size:12.5px', '', Hp);
    var how = el('div', CARD, null, Hp);
    el('div', LABEL, 'How it links', how);
    el('div', 'margin-top:3px;color:' + COL.txt2 + ';font-size:12.5px', EXT ? 'The HotelOps helper links this tab to HotelOps by itself: keep HotelOps open in this same browser. HotelOps → Settings → 📡 Opera reader → "Open Opera" opens Opera already linked.'
      : 'Press Connect: HotelOps opens in a tab and this window sends it what Opera shows. Keep that tab open. With the HotelOps helper it links by itself.', how);
    E.diag = el('div', 'margin-top:6px;color:' + COL.txt3 + ';font:500 11.5px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace', '', how);
    btn('⤢ Put it back in the corner', BTN_2, Hp, 'reset', function () { UI.r = UI.b = null; saveUI(); place(16, 16); });
    // the badge when small
    badge = btn('', 'all:unset;box-sizing:border-box;position:relative;display:none;align-items:center;justify-content:center;width:38px;height:38px;border-radius:9px;cursor:grab;touch-action:none;background:transparent;box-shadow:0 6px 16px -6px rgba(30,27,75,.55)', wrap, 'badge');
    badge.setAttribute('aria-label', 'Open the HotelOps Opera reader');
    el('span', 'pointer-events:none;display:block;width:38px;height:38px', null, badge).appendChild(logo(38));
    bDot = el('span', 'position:absolute;right:-3px;bottom:-3px;width:11px;height:11px;border-radius:50%;box-sizing:border-box;border:2px solid #fff;background:' + COL.warn, null, badge);
    bNum = el('span', 'position:absolute;top:-6px;right:-8px;display:none;min-width:18px;height:17px;padding:0 5px;box-sizing:border-box;border-radius:99px;background:#1f2937;color:#fff;border:1.5px solid #fff;font:600 10px/14px ' + SANS + ';text-align:center', '', badge);
    badge.addEventListener('click', function () { if (badge.dragged) { badge.dragged = false; return; } touched = true; setMin(false); }, { passive: true });
    dragger(head); dragger(badge);
    head.addEventListener('dblclick', function (e) { if (e.target.closest && e.target.closest('button')) return; UI.r = UI.b = null; saveUI(); place(16, 16); }, { passive: true });
    document.body.appendChild(host);
    if (UI.r != null && UI.b != null) place(UI.r, UI.b);
    setTab(curTab, true);
    // the first time: open for a minute, then a small badge in the corner (it never covers Opera's buttons for long)
    if (typeof UI.min === 'boolean') setMin(UI.min, true);
    else { setMin(false, true); setTimeout(function () { if (!touched && typeof UI.min !== 'boolean' && !stopped) setMin(true); }, 60000); }
  }
  function place(r, b) {
    r = Math.max(4, Math.min(window.innerWidth - 56, r)); b = Math.max(4, Math.min(window.innerHeight - 56, b));
    host.style.right = r + 'px'; host.style.bottom = b + 'px';
  }
  function dragger(handle) {
    var d = null;
    handle.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || (handle !== badge && e.target.closest && e.target.closest('button'))) return;
      d = { x: e.clientX, y: e.clientY, r: parseFloat(host.style.right) || 16, b: parseFloat(host.style.bottom) || 16, moved: false };
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    }, { passive: true });
    handle.addEventListener('pointermove', function (e) {
      if (!d) return;
      var dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      d.moved = true; handle.style.cursor = 'grabbing';
      place(d.r - dx, d.b - dy);
    }, { passive: true });
    var end = function () {
      if (!d) return; var moved = d.moved; d = null; handle.style.cursor = 'grab';
      if (moved) { UI.r = parseFloat(host.style.right); UI.b = parseFloat(host.style.bottom); saveUI(); touched = true; if (handle === badge) badge.dragged = true; }
    };
    handle.addEventListener('pointerup', end, { passive: true });
    handle.addEventListener('pointercancel', function () { d = null; handle.style.cursor = 'grab'; }, { passive: true });
  }
  function setTab(k, quick) {
    curTab = k; UI.tab = k; if (!quick) saveUI();
    Object.keys(panes).forEach(function (t) {
      var on = t === k; panes[t].style.display = on ? 'flex' : 'none';
      tabB[t].style.background = on ? 'linear-gradient(180deg,rgba(201,161,74,.30),rgba(201,161,74,.14))' : 'transparent';
      tabB[t].style.color = on ? '#fff' : COL.txt3; tabB[t].setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (!quick) anim(panes[k], [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' });
    lastSig = ''; render();
  }
  function setMin(on, quick) {
    if (!winEl) return;
    UI.min = !!on; isMin = UI.min; if (!quick) saveUI();
    winEl.style.display = on ? 'none' : 'block'; badge.style.display = on ? 'inline-flex' : 'none';
    if (!quick) anim(on ? badge : winEl, [{ opacity: 0, transform: 'translateY(6px) scale(' + (on ? '.85' : '.96') + ')' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,.9,.3,1.1)' });
    lastSig = ''; render();
  }
  /** "🔁 Retry link": the helper's link opened afresh (a helper from v436 has retry), then a ping */
  function retryLink() {
    linkT0 = Date.now(); relay = null;
    try { if (EXT && typeof EXT.retry === 'function') EXT.retry(); } catch (_) {}
    if (!EXT) connect(); else setTimeout(tick, 300);
    render();
  }
  var isMin = false;
  function linkNow() {
    return linkDiag({ ext: !!EXT, linked: Date.now() - linked < 45000, since: Date.now() - linkT0, relay: relay ? { apps: relay.apps, age: Date.now() - relay.at } : null, relayEver: relayEver,
      anyIn: extIn ? Date.now() - extIn : -1, extErr: EXT && EXT.err ? String(EXT.err) : '' });
  }
  var hhmm = function (t) { var d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  function render() {
    if (!TOP || !host) return;
    var now = Date.now(), L = linkNow();
    var n = view.rows.length, kind = view.kind, total = view.total;
    Object.keys(frames).forEach(function (k) { if (frames[k].n > n) { n = frames[k].n; kind = frames[k].kind; total = frames[k].total; } });
    if (!n && sentN && view.kind) n = sentN;
    var errOn = !!lastErr && now - lastErrAt < 60000, tone = errOn ? 'bad' : L.code === 'linked' ? 'ok' : 'warn';
    var did = lastAck && now - lastAck.at < 600000 ? lastAck : null, hint = hintNow && now - hintNow.at < 120000 ? hintNow.text : '';
    var stuckOn = stuckAt && now - stuckAt < 600000, helpOn = helpTxt && now - helpAt < 120000;
    var sig = [tone, L.code, L.text, n, kind, total, view.title, did ? did.text + Math.floor((now - did.at) / 60000) : '', hint, stuckOn, TL.length, TL[0] ? TL[0].at : 0, curTab, isMin, helpOn ? helpTxt : '',
      relay ? relay.apps : '-', appV, errOn ? lastErr : ''].join('|');
    if (sig === lastSig) return;
    lastSig = sig;
    var col = COL[tone];
    hDot.style.background = col; hDot.style.boxShadow = '0 0 0 3px ' + (tone === 'ok' ? 'rgba(52,211,153,.18)' : tone === 'bad' ? 'rgba(248,113,113,.2)' : 'rgba(251,191,36,.18)');
    bDot.style.background = col;
    if (tone === 'warn' && !pulse) pulse = anim(hDot, [{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }], { duration: 1600, iterations: Infinity });
    else if (tone !== 'warn' && pulse) { try { pulse.cancel(); } catch (_) {} pulse = null; }
    hTxt.textContent = errOn ? 'reader error: ' + lastErr.slice(0, 50) : L.code === 'linked' ? 'Linked to HotelOps' + (appV ? ' ' + appV : '') : L.code === 'console' ? 'Not linked' : L.code === 'linking' ? 'Linking to HotelOps…' : 'Not linked yet';
    hTxt.style.color = tone === 'bad' ? '#fecaca' : COL.txt2;
    // linking: after 10 s a checklist that says what it is when it can tell
    var showLink = L.code !== 'linked';
    E.link.style.display = showLink ? 'block' : 'none';
    if (showLink) {
      E.linkT.textContent = L.code === 'linking' ? 'Linking to HotelOps…' : L.code === 'console' ? 'Not linked to HotelOps' : 'Not linked to HotelOps yet';
      E.linkD.textContent = L.text;
      E.linkL.style.display = L.code === 'linking' || L.code === 'console' ? 'none' : 'flex';
      E.retry.style.display = EXT && L.code !== 'linking' ? 'inline-flex' : 'none';
      E.conn.style.display = EXT ? 'none' : 'inline-flex';
      E.openApp.style.display = EXT && L.code !== 'linking' ? 'inline-flex' : 'none';
    }
    E.scr.textContent = kind ? (KLABEL[kind] || cap(kind)) : 'Watching Opera';
    E.scr2.textContent = n ? cap(summary(kind, n, total)) + (view.title && view.title.toLowerCase().indexOf(String(KLABEL[kind] || kind).toLowerCase()) < 0 ? ' · ' + view.title : '') : kind ? 'Nothing to read on it yet' : 'Open a screen in Opera: it reads it by itself';
    E.did.textContent = did ? did.text + ' · ' + hhmm(did.at) : L.code === 'linked' ? 'Nothing to change yet' : 'Waiting for HotelOps';
    E.undo.style.display = did && !/^(?:up to date|nothing|read ·|waiting)/i.test(did.text) ? 'block' : 'none';
    E.next.style.display = hint ? 'block' : 'none'; E.next.textContent = '🧠 ' + hint;
    E.stuck.style.display = stuckOn ? 'block' : 'none'; E.stuck.textContent = '🛟 Something on this screen couldn\'t be read: its layout (no guest data) went to HotelOps → Settings → Opera reader.';
    E.help.style.display = helpOn ? 'block' : 'none'; E.help.textContent = helpTxt;
    E.diag.textContent = 'reader ' + VERSION + (EXT ? ' · helper ' + (EXT.v || '?') + (EXT.us ? ' (self-updated)' : '') : ' · console') + ' · link: ' + L.code + (relay ? ' · relay sees ' + relay.apps + ' HotelOps tab' + (relay.apps === 1 ? '' : 's') : '') + (appV ? ' · HotelOps ' + appV : '');
    // Today
    while (E.today.firstChild) E.today.removeChild(E.today.firstChild);
    if (!TL.length) el('div', 'color:' + COL.txt3 + ';font-size:12.5px;padding:6px 2px', 'Nothing yet: reads and what HotelOps did show here.', E.today);
    TL.slice(0, 30).forEach(function (x) {
      var r = el('div', 'display:flex;gap:8px;align-items:baseline;padding:5px 2px;border-bottom:1px solid rgba(255,255,255,.05);font-size:12.5px;min-width:0', null, E.today);
      el('span', 'flex:none;font:600 11.5px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:' + COL.txt3, hhmm(x.at), r);
      el('span', 'flex:none;width:18px;text-align:center', x.i, r);
      el('span', 'min-width:0;color:' + COL.txt + ';overflow-wrap:anywhere', x.t, r);
    });
    bNum.style.display = n ? 'block' : 'none'; bNum.textContent = n > 999 ? '999+' : String(n);
    badge.title = 'HotelOps · ' + (n ? summary(kind, n, total) : 'watching Opera') + ' · ' + hTxt.textContent;
  }

  // ── 🔒 the Away guard: a lock screen over Opera while you're away ──
  // HotelOps arms it ({source:'ho-op-guard', armed, rev, since, by, pin:{h, s}, auto}; also inside its acks, so an older helper carries
  // it). The lock screen itself is the shared one above (hoLock): the same as WhatsApp Web's. A new Opera tab asks the helper's relay
  // whether you're away (it may know when HotelOps is closed) and locks at once.
  var LOCK = hoLock({ what: 'Opera', from: 'opera', attr: 'opera-guard', ss: 'ho_op_guard', top: TOP, auto: true,
    send: function (g) { post({ source: 'ho-op', v: VERSION, frame: FRAME, guard: g }); },
    relay: EXT && typeof EXT.post === 'function' ? function (m) { EXT.post(m); } : null,
    tl: tl, render: function () { render(); },
    hint: 'Type your PIN and press Enter. Or unlock from HotelOps: 📡 Opera → 🛡 Away guard → Unlock, or “I\'m back”.',
    hintNoPin: 'No PIN set: unlock from HotelOps (📡 Opera → 🛡 Away guard → Unlock, or “I\'m back” in the WhatsApp Away guard).' });
  var guardMsg = LOCK.take;

  function stop(silent) {
    LOCK.stop(silent);   // armed and not silent: "stopped the Opera reader" goes to HotelOps first
    stopped = true;
    try { if (obs) obs.disconnect(); } catch (_) {}
    clearInterval(iv); clearInterval(uiIv); clearTimeout(deb);
    window.removeEventListener('message', onWinMsg);
    window.removeEventListener('click', onClickLearn, { capture: true });
    clearTimeout(flushT);
    try { if (pillHost) pillHost.remove(); } catch (_) {}
    window.__hoOp = null;
    if (!silent) try { console.log('HotelOps Opera reader stopped.'); } catch (_) {}
  }

  // ── start ─────────────────────────────────────────────────
  build();
  LOCK.ask();   // the helper's relay may know you're away (HotelOps closed): this tab locks at once
  obs = new MutationObserver(function (recs) {
    if (deb) return;   // a read is already planned: nothing to do
    for (var i = 0; i < recs.length; i++) { var t = recs[i].target; if (t && !mine(t.nodeType === 1 ? t : t.parentElement)) { laterScan(800); return; } }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.addEventListener('scroll', function () { if (!deb) laterScan(700); }, { capture: true, passive: true });
  window.addEventListener('hashchange', function () { laterScan(300); });
  iv = setInterval(tick, 15000);
  var uiIv = setInterval(function () { if (Date.now() - linked > 40000 || lastErr) render(); }, 2500);   // the linking checklist after 10 s (render returns at once when nothing changed)
  window.__hoOp = { guard: { idle: LOCK.idle, state: LOCK.state },
    stop: stop, scan: scan, connect: connect, min: setMin, tab: function (k) { setTab(k); }, report: manualReport, v: VERSION,
    state: function () { return { kind: view.kind, date: view.date, title: view.title, total: view.total, rows: view.rows.slice(), folio: view.folio || null, traces: (view.traces || []).slice(), tables: (view.tables || []).slice(), audit: view.audit || null,
      sent: sentN, sentAt: sentAt, linked: Date.now() - linked < 45000, ack: lastAck, err: lastErr, ext: !!EXT, frame: FRAME, learn: LEARN, steps: steps.length, hint: hintNow, cost: Math.round(cost * 10) / 10,
      link: linkNow(), relay: relay, stuckSent: doneToday().slice(), stuckQ: stuckQ.length, timeline: TL.slice() }; } };
  if (TOP && !EXT) try { console.log('%c 📡 HotelOps Opera reader is running ✓ %c Press "Connect" in the HotelOps window (bottom right). It only reads; it never changes anything in Opera.', 'background:#111827;color:#fbbf24;font:700 13px system-ui;padding:4px 8px;border-radius:6px', 'color:#9aa3b2;font:12px system-ui'); } catch (_) {}
  setTimeout(scan, 600);
  setTimeout(tick, 1200);
})();

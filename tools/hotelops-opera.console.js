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
    ['roomStatus', ['ROOM STATUS', 'HK STATUS', 'HOUSEKEEPING STATUS', 'FO STATUS']],
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
    ['member', ['MEMBERSHIP', 'MEMBERSHIP NO', 'MEMBERSHIP LEVEL', 'MEMBERSHIP TYPE', 'LOYALTY', 'LOYALTY NO']],
    ['adults', ['ADULTS', 'ADULT', 'ADL', 'ADLT', 'NO OF ADULTS']],
    ['children', ['CHILDREN', 'CHILD', 'CHD', 'CHILDS', 'KIDS', 'NO OF CHILDREN']],
    ['pax', ['PERSONS', 'PAX', 'ADULTS CHILDREN', 'A C', 'GUESTS', 'OCCUPANCY', 'NO OF GUESTS', 'GUEST COUNT', 'NO OF PERSONS']],
    ['balance', ['BALANCE', 'BAL', 'OPEN BALANCE', 'FOLIO BALANCE', 'CURRENT BALANCE', 'ACCOUNT BALANCE']],
    ['payment', ['PAYMENT', 'PAYMENT METHOD', 'METHOD OF PAYMENT', 'PAYMENT TYPE']],
    ['notes', ['NOTES', 'NOTE', 'COMMENTS', 'COMMENT', 'REMARKS', 'SPECIALS', 'SPECIAL REQUESTS', 'PREFERENCES', 'ALERTS']],
  ];
  var FIELD_OF = {}; FIELDS.forEach(function (f) { f[1].forEach(function (w) { FIELD_OF[w] = f[0]; }); });
  /** one header / label → the field it names, or '' */
  var FIELD_MEMO = {}, FIELD_MEMO_N = 0;   // the same header text is asked about on every read: answer it once
  function fieldOf(h) {
    h = String(h == null ? '' : h); if (h.length > 120) return '';
    if (Object.prototype.hasOwnProperty.call(FIELD_MEMO, h)) return FIELD_MEMO[h];
    if (++FIELD_MEMO_N > 5000) { FIELD_MEMO = {}; FIELD_MEMO_N = 1; }
    return (FIELD_MEMO[h] = fieldOf1(h));
  }
  function fieldOf1(h) {
    var n = normH(h); if (!n || n.length > 48) return '';
    if (FIELD_OF[n]) return FIELD_OF[n];
    var best = '', len = 0, w = ' ' + n + ' ';
    Object.keys(FIELD_OF).forEach(function (k) { if (k.length > len && k.length >= 3 && w.indexOf(' ' + k + ' ') >= 0) { best = FIELD_OF[k]; len = k.length; } });
    // "Arrival Time" is a time, not the date; a "… Date" header for a time field is still the date
    return best;
  }
  /** header cells → {map: {field: column}, n: fields found} (each field once, the first column that names it) */
  function mapHeaders(cells) {
    var map = {}, n = 0;
    (cells || []).forEach(function (c, i) { var f = fieldOf(c); if (f && map[f] === undefined) { map[f] = i; n++; } });
    return { map: map, n: n };
  }
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
    ['roomType', 'roomStatus', 'company', 'agent', 'source', 'group', 'rateCode', 'market', 'member', 'payment', 'eta', 'etd'].forEach(function (f) { var v = c(f); if (v && !NO.test(v)) r[f] = clip(v, 80); });
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
  /** label → value pairs of a reservation's details → one guest line (or null when it isn't a reservation) */
  function pairsToRow(pairs, order) {
    var cells = [], map = {}, n = 0;
    (pairs || []).forEach(function (p) {
      var f = fieldOf(p[0]); if (!f || map[f] !== undefined || !sp(p[1]).trim()) return;
      map[f] = cells.length; cells.push(String(p[1])); n++;
    });
    if (n < 3 || !(map.conf !== undefined || (map.room !== undefined && (map.name !== undefined || map.last !== undefined)))) return null;
    var rows = finishRows([rowFrom(cells, map)], order);
    return rows[0] || null;
  }
  // what a screen is, from its title, headings and address (most specific first)
  var KINDS = [
    ['inhouse', /\bin[\s\-]?house\b|\bstay\s*overs?\b/],
    ['departures', /\bdepartures?\b|\bdue\s*outs?\b|\bcheck[\s\-]?outs?\b/],
    ['arrivals', /\barrivals?\b|\bdue\s*ins?\b|\bcheck[\s\-]?ins?\b/],
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
  var KIND_WORD = { arrivals: 'arrivals', departures: 'departures', inhouse: 'in-house', search: 'reservations', details: 'reservation', list: 'reservations' };
  /** "read 42 departures" / "read 1 reservation" */
  function summary(kind, n, total) {
    var w = KIND_WORD[kind] || 'lines';
    if (n === 1 && /s$/.test(w)) w = kind === 'arrivals' ? 'arrival' : kind === 'departures' ? 'departure' : kind === 'inhouse' ? 'in-house guest' : 'reservation';
    return 'read ' + n + (total && total > n ? ' of ' + total : '') + ' ' + w;
  }
  /** "1-25 of 42", "Total: 42", "42 records" next to a list → 42 */
  function totalOf(text) {
    var t = sp(text), m = t.match(/\bof\s+(\d{1,5})\b/i) || t.match(/\btotal\s*(?:records|results|reservations|rows)?\s*[:=]?\s*(\d{1,5})\b/i) || t.match(/\b(\d{1,5})\s+(?:records|results|reservations|rows|items)\b/i);
    return m ? +m[1] : 0;
  }

  var H = { normH: normH, fieldOf: fieldOf, mapHeaders: mapHeaders, usable: usable, parseDate: parseDate, dateOrder: dateOrder, findDate: findDate, normStatus: normStatus, money: money,
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
      var b = el.querySelector('[title],[aria-label]'), inp = el.querySelector('input:not([type=checkbox]):not([type=radio]), textarea, select');
      t = a || (inp && inp.value) || (b && (b.getAttribute('title') || b.getAttribute('aria-label'))) || '';
    }
    return sp(t).trim();
  }
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
  /** every grid on screen → guest lines (header-only grids are paired with the body grid next to them: split headers) */
  function readGrids(doc) {
    var gs = [];
    doc.querySelectorAll(GRID_SEL).forEach(function (g) { if (!mine(g)) gs.push(readGrid(g)); });
    var heads = gs.filter(function (g) { return g.head && !g.rows.length && usable(mapHeaders(g.head)); });
    var out = [], total = 0;
    gs.forEach(function (g) {
      if (!g.rows.length) return;
      var head = g.head;
      if (!head || !usable(mapHeaders(head))) {
        var w = Math.max.apply(null, g.rows.map(function (r) { return r.length; })), best = null, bd = 99;
        heads.forEach(function (h) {
          if (h.el.compareDocumentPosition(g.el) & 4 && Math.abs(h.head.length - w) <= 1) { var d = depthTo(h.el, g.el); if (d < bd) { bd = d; best = h; } }
        });
        if (!best || bd > 6) return;
        head = best.head;
      }
      var m = mapHeaders(head); if (!usable(m)) return;
      var hk = head.map(normH).join('|'), h0 = normH(head[0] || '');
      g.rows.forEach(function (cells) {
        if (normH(cells[0] || '') === h0 && cells.map(normH).join('|') === hk) return;   // the header repeated as a line (checked fully only when it could be)
        var r = rowFrom(cells, m.map); if (r.room || r.conf || r.name) out.push(r);
      });
      // "1–25 of 42" near the grid
      var box = g.el.parentElement; for (var i = 0; i < 3 && box && box.parentElement; i++) box = box.parentElement;
      if (box) box.querySelectorAll('[class*="pag" i], [class*="count" i], [class*="total" i], [role="status"]').forEach(function (e) { if (!mine(e) && !total) total = totalOf(txt(e).slice(0, 80)); });
    });
    return { raw: out, total: total };
  }
  /** label → value pairs on screen (reservation details), outside the grids */
  function readPairs(doc) {
    var pairs = [], seen = new Set();
    var add = function (l, v, el) { l = sp(l).replace(/[:*]\s*$/, '').trim(); v = sp(v).trim(); if (!l || !v || l.length > 40 || v.length > 200 || seen.has(l + '|' + v)) return; if (el && (el.closest(GRID_SEL) || mine(el))) return; seen.add(l + '|' + v); pairs.push([l, v]); };
    doc.querySelectorAll('label').forEach(function (l) {
      var id = l.getAttribute('for'), t = id ? doc.getElementById(id) : null, v = '';
      if (t) v = ('value' in t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) ? t.value : txt(t);
      else { var n = l.nextElementSibling; if (n) v = n.querySelector && n.querySelector('input,textarea,select') ? n.querySelector('input,textarea,select').value : txt(n); }
      add(txt(l), v, l);
    });
    doc.querySelectorAll('dt').forEach(function (d) { var n = d.nextElementSibling; if (n && n.tagName === 'DD') add(txt(d), txt(n), d); });
    doc.querySelectorAll('[label-hint]').forEach(function (e) { add(e.getAttribute('label-hint'), e.value != null && e.value !== '' ? String(e.value) : (e.getAttribute('value') || txt(e)), e); });
    doc.querySelectorAll('[class*="label" i]:not(label)').forEach(function (e) {
      if (e.children.length > 2) return;
      var n = e.nextElementSibling; if (!n) return;
      add(txt(e), n.querySelector && n.querySelector('input,textarea') ? n.querySelector('input,textarea').value : txt(n), e);
    });
    return pairs.slice(0, 200);
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
  function scan() {
    if (stopped) return;
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    try {
      var g = readGrids(document);
      var order = (navigator.language || '').toLowerCase() === 'en-us' ? 'mdy' : '';
      var rows = finishRows(g.raw, order);
      var heads = headings(document);
      var det = rows.length ? null : pairsToRow(readPairs(document), order);
      if (det) rows = [det];
      var kind = pageKind([document.title].concat(heads, [location.pathname + ' ' + location.hash]), rows);
      if (det && kind !== 'details' && !g.raw.length) kind = 'details';
      var date = screenDate(document, order);
      var key = kind + '|' + date + '|' + (heads[0] || document.title || '').replace(/\d+/g, '#').slice(0, 60);   // "Arrivals (42)" while it loads is the same screen
      if (key !== view.key) view = { key: key, kind: kind, date: date, rows: [], title: (heads[0] || document.title || '').slice(0, 90), total: 0 };
      view.rows = kind === 'details' ? rows : mergeRows(view.rows, rows);
      if (view.rows.length > 1500) view.rows = view.rows.slice(-1500);
      if (g.total) view.total = g.total;
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

  // ── talking to HotelOps ───────────────────────────────────
  function post(o) {
    try {
      if (EXT && typeof EXT.post === 'function') { EXT.post(o); return true; }
      if (win && !win.closed) { win.postMessage(o, APP_ORIGIN); return true; }
    } catch (_) {}
    return false;
  }
  function send(force) {
    if (!view.rows.length || !view.kind) return;
    var snap = { id: view.key, kind: view.kind, date: view.date, title: view.title, total: view.total || 0, rows: view.rows, frame: FRAME, url: location.hostname + location.pathname };
    var h = hash([snap.kind, snap.date, snap.rows]);
    if (!force && h === sentHash) return;
    if (!force && Date.now() - sentAt < 2500) { laterScan(2600); return; }   // a list still loading: at most one snapshot every few seconds
    if (post({ source: 'ho-op', v: VERSION, h: h, snap: snap, at: Date.now() })) { sentHash = h; sentAt = Date.now(); sentN = snap.rows.length; }
    if (!TOP) try { window.top.postMessage({ __hoOpFrame: 1, id: FRAME, kind: view.kind, n: view.rows.length, total: view.total || 0 }, '*'); } catch (_) {}
  }
  function onMsg(d) {
    if (!d || typeof d !== 'object') return;
    if (d.source !== 'ho-op-ack') return;
    linked = Date.now();
    if (d.h && d.text) lastAck = { text: String(d.text).slice(0, 140), at: Date.now() };
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
    state: function () { return { kind: view.kind, date: view.date, title: view.title, total: view.total, rows: view.rows.slice(), sent: sentN, sentAt: sentAt, linked: Date.now() - linked < 45000, ack: lastAck, err: lastErr, ext: !!EXT, frame: FRAME }; } };
  if (TOP && !EXT) try { console.log('%c 📡 HotelOps Opera reader is running ✓ %c Press "Connect" on the pill (bottom right). It only reads; it never changes anything in Opera.', 'background:#111827;color:#fbbf24;font:700 13px system-ui;padding:4px 8px;border-radius:6px', 'color:#9aa3b2;font:12px system-ui'); } catch (_) {}
  setTimeout(scan, 600);
  setTimeout(tick, 1200);
})();

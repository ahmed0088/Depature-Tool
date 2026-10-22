// ═══════════════════════════════════════════════════════════
//  package-audit.js — Package/Upsell Audit
//
//  IN-Gauge (the upsell tracking system) sometimes can't recognise
//  the Opera rate/product code behind a charge (logs it as "Unknown
//  Product"), and separately often has no seller recorded (Employee
//  column shows "-") even when the product itself is known — e.g. a
//  correctly-labelled "Early Check In" row with nobody credited for
//  the sale. This panel flags BOTH kinds of gaps and resolves them by
//  cross-referencing Opera's own Changes Log — the report shows
//  exactly which product code was added, its price, its date range,
//  and which staff member added it (Opera → Dashboard → Miscellaneous
//  → Changes Log, Group=Reservation, Description="product",
//  exported to PDF). Leave Action Type unfiltered: a package sold at
//  booking time is logged under New Reservation, not Update Reservation,
//  and filtering to Update alone hides it from this panel entirely.
//
//  Matching key: Confirmation No. (present in both reports), then
//  disambiguated by price when a reservation has more than one
//  product event — a reservation's Unknown charge amount only ever
//  matches ONE of its logged product-ADDED events.
// ═══════════════════════════════════════════════════════════

let pkgUnknowns = [];   // from the IN-Gauge export: rows with Product = "Unknown Product"
let pkgDeleted  = {};   // conf No. -> [{code, ts}]: packages taken off a booking (only My upsells' estimate uses it)
let pkgEvents   = {};   // conf No. -> [{code, price, from, to, user}], from the Opera Changes Log
let pkgResults  = [];   // joined output after pkgRun()
let pkgFilter_  = 'action';
let pkgSearch_  = '';
let pkgPdfFiles = [];   // names of the Changes Log exports merged so far
let pkgLogRange = { min: 0, max: 0 };  // YYYYMMDD span the loaded logs actually cover
let pkgGuests   = {};   // confirmation no. -> { name, norm, room, arr, dep } from the guest list

// A guest who extends gets a fresh confirmation number, so credit would
// otherwise pass to whoever keyed the new booking — which is also the
// opening for moving a colleague's sale onto yourself by rebooking it.
// Reservations for the same guest inside this many days are treated as
// one stay, and the sale stays with whoever made it first.
const PKG_EXTENSION_GAP = 0;

// ── Rules: every real decision point of the audit, with a switch ──────────
// Shared with the team at packageAudit/rules/<key> (only the keys that differ
// from the default are stored). The defaults are the audit's normal behaviour:
// with nothing stored, every result is exactly what it always was.
const PKG_RULE_DEFAULTS = {
  firstPerson: true,     // the first person who put the package on gets it (off: the entry matching the price)
  familyMatch: true,     // an upgrade on the same kind (UPS30BB -> UPS60BB) is still the same package
  chain: true,           // back-to-back bookings of the same guest are one stay
  chainSameRoom: false,  // ...only when they are in the same room
  chainGap: PKG_EXTENSION_GAP,   // days allowed between the two bookings (0 or 1)
  sameKind: true,        // only the same kind of package carries over an extension
  exactCode: false,      // ...on: each package code is its own package (UPS30BB is not UPS60BB); off: all …BB is breakfast
  systemNoSeller: true,  // online / TARS / system bookings have no desk seller
  oneTime: true,         // early check-in / late check-out are counted once per stay
  denyNoOpera: true,     // remove a charge when Opera shows no such package on the booking
  splitFlag: true,       // one package credited to two people is flagged
  reviewedStops: true,   // a REVIEWED row in IN-Gauge stops being work
  memory: true,          // a package remembered from an earlier month (same booking or the guest's earlier booking) keeps its seller
};
let pkgRules = Object.assign({}, PKG_RULE_DEFAULTS);
try { Object.assign(pkgRules, JSON.parse(localStorage.getItem('pkg_rules_v1') || '{}') || {}); } catch (_) {}
function _pkgRule(k) { return pkgRules[k] == null ? PKG_RULE_DEFAULTS[k] : pkgRules[k]; }

// ── IN-Gauge export upload (.xlsx) ──────────────────────────
function pkgLoadExcel(input) {
  const file = input?.files?.[0];
  if (!file) return;
  pkgReportAt = file.lastModified || Date.now();   // when this IN-Gauge export was saved
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      busyStart('Reading the IN-Gauge export', 'opening the spreadsheet…');
      await busyPaint();
      const wb  = XLSX.read(e.target.result, { type: 'array' });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      _pkgLastRows.ig = rows;   // kept, so Settings → Report columns can read it again with a new mapping
      busyDetail(`sorting ${Math.max(rows.length - 1, 0)} charges…`);
      await busyPaint();
      pkgUnknowns = _pkgParseExcelUnknowns(rows);
      const needsCount = pkgUnknowns.filter(u => u.needsProduct || u.needsEmployee).length;
      const lbl = document.getElementById('pkgExcelLabel');
      if (lbl) lbl.textContent = pkgUnknowns.length
        ? `✓ ${pkgUnknowns.length} row${pkgUnknowns.length !== 1 ? 's' : ''} loaded, ${needsCount} need${needsCount === 1 ? 's' : ''} review`
        : 'Loaded — no rows found';
      const miss = (pkgLastHeaders.ig && pkgLastHeaders.ig.missing) || [];
      showToast(pkgUnknowns.length
        ? `✦ ${pkgUnknowns.length} row${pkgUnknowns.length !== 1 ? 's' : ''} loaded (${needsCount} missing product or seller)`
        : miss.length ? `No ${miss.join(' / ')} column found. Map it in Package Audit → 🛠 Settings → Report columns.` : 'No rows found in this file', pkgUnknowns.length ? 'ok' : 'err');
      if (_pkgView === 'settings') pkgSettingsRender();
    } catch (err) {
      showToast('Failed to read the IN-Gauge Excel file: ' + err.message, 'err');
    } finally {
      busyDone();
    }
  };
  reader.readAsArrayBuffer(file);
}

// ── Guest list upload (optional, .xls/.xlsx/.csv) ───────────
// Neither the IN-Gauge export nor the Changes Log names the guest, so on
// their own there is no way to tell that two confirmation numbers are the
// same person. An Opera arrivals/reservations export carries both the
// confirmation number and the name, which is what links them.
function pkgLoadGuests(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      busyStart('Reading the guest list', 'matching guests to confirmations…');
      await busyPaint();
      const buf  = e.target.result;
      const head = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 8192)));
      // Opera's Reservation Detail export is tab-delimited text, not a
      // workbook, and it carries the guest's profile ID — a far better
      // link between bookings than a name ever is.
      pkgGuests = /CONFIRMATION_NO/.test(head) && head.includes('\t')
        ? _pkgParseResDetail(new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf)))
        : (() => { const wb = XLSX.read(buf, { type: 'array' });
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
            _pkgLastRows.guest = rows;
            return _pkgParseGuestList(rows); })();
      const n   = Object.keys(pkgGuests).length;
      const ids = Object.values(pkgGuests).filter(g => g.gid).length;
      const lbl = document.getElementById('pkgGuestLabel');
      if (lbl) lbl.textContent = n
        ? `✓ ${n} reservation${n !== 1 ? 's' : ''}${ids ? ' · guest IDs found' : ' (names only)'}`
        : 'Loaded — no Confirmation No. + Name columns found';
      showToast(n ? `✦ ${n} reservations loaded${ids ? ' with guest IDs' : ''}` : 'Could not find Confirmation No. and Name columns in this file', n ? 'ok' : 'err');
    } catch (err) {
      showToast('Failed to read the guest list: ' + err.message, 'err');
    } finally {
      busyDone();
      if (input) input.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}

// Opera → Reservations → Reservation Detail, exported as text. It is
// tab-delimited with one header line, but address fields contain raw
// newlines, so a record is only over when the next one begins — that is,
// at a line starting with the report's 8-digit sort date.
function _pkgParseResDetail(text) {
  const lines = String(text || '').split(/\r?\n/);
  const hi    = lines.findIndex(l => l.includes('CONFIRMATION_NO'));
  if (hi < 0) return {};
  const col = {};
  lines[hi].split('\t').forEach((h, i) => { col[h.trim().toUpperCase()] = i; });

  const body = lines.slice(hi + 1).join('\n');
  let recs = body.split(/\n(?=\d{8}\t)/);
  if (recs.length < 2) recs = body.split(/\r?\n/);   // a layout without the sort column

  const at = (p, ...names) => {
    for (const n of names) {
      const i = col[n];
      if (i != null && i < p.length) { const v = String(p[i]).trim(); if (v) return v; }
    }
    return '';
  };

  const out = {};
  recs.forEach(rec => {
    const p    = rec.split('\t');
    const conf = at(p, 'CONFIRMATION_NO');
    if (!/^\d+$/.test(conf)) return;
    const name = at(p, 'FULL_NAME', 'FULL_NAME_NO_SHR_IND');
    out[conf] = {
      name,
      norm: _pkgNormGuestName(name),
      gid:  at(p, 'GUEST_NAME_ID'),
      room: at(p, 'ROOM_NO', 'DISP_ROOM_NO'),
      arr:  at(p, 'TRUNC_BEGIN', 'ARRIVAL'),
      dep:  at(p, 'TRUNC_END', 'DEPARTURE'),
    };
  });
  return out;
}

function _pkgParseGuestList(rows) {
  if (!rows.length) return {};
  const hi   = _pkgHeaderRow(rows, PKG_GUEST_FIELDS, 'guest');
  const hdrs = (rows[hi] || []).map(h => String(h || '').trim());
  const C = _pkgMapColumns(hdrs, PKG_GUEST_FIELDS, 'guest');
  _pkgNoteParse('guest', rows, hi, C);
  const iConf = C.conf, iName = C.name, iGid = C.gid, iRoom = C.room, iArr = C.arr, iDep = C.dep;
  if (iConf < 0 || iName < 0) return {};

  const out = {};
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const conf = String(r[iConf] || '').trim().replace(/\.0+$/, '');
    const name = String(r[iName] || '').trim();
    if (!conf || !name) continue;
    out[conf] = {
      name,
      norm: _pkgNormGuestName(name),
      gid:  iGid  >= 0 ? String(r[iGid]  || '').trim() : '',
      room: iRoom >= 0 ? String(r[iRoom] || '').trim() : '',
      arr:  iArr  >= 0 ? _pkgCellDate(r[iArr]) : '',
      dep:  iDep  >= 0 ? _pkgCellDate(r[iDep]) : '',
    };
  }
  return out;
}

// A spreadsheet may hand back a date as text or as an Excel serial number,
// and a serial silently reads as "no date" — which would quietly switch the
// extension rule off rather than fail loudly. Normalise both to DD-MMM-YY.
const _PKG_MON_NAMES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
function _pkgCellDate(v) {
  const s = String(v ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return s;
  const n = Number(s);
  if (n < 20000 || n > 80000) return s;             // not a plausible Excel date
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
  return `${String(d.getUTCDate()).padStart(2, '0')}-${_PKG_MON_NAMES[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`;
}

// "Ali, Mohamed, Mr." and "Mohamed Ali" are one person written two ways,
// so titles go and the remaining words are sorted — order stops mattering.
function _pkgNormGuestName(s) {
  return String(s || '')
    .replace(/\b(MR|MRS|MS|MISS|DR|MSTR|MASTER|PROF)\b\.?/gi, ' ')
    .replace(/[^A-Za-z ]/g, ' ')
    .toUpperCase().split(/\s+/).filter(w => w.length > 1).sort().join(' ');
}

// The Changes Log states no date filter, so its coverage is taken from the
// entries themselves. This matters because the log is exported for a fixed
// span — run it on the 14th for 1–14 Aug and nothing sold on the 15th can
// possibly be in it, which would otherwise look like a missing record
// rather than a report that simply stops before the sale.
function _pkgRecomputeLogRange() {
  let min = Infinity, max = 0;
  Object.values(pkgEvents).forEach(list => list.forEach(e => {
    const day = Math.floor((e.ts || 0) / 10000);   // ts is YYYYMMDDHHMM
    if (!day) return;
    if (day < min) min = day;
    if (day > max) max = day;
  }));
  pkgLogRange = { min: min === Infinity ? 0 : min, max };
}

const _PKG_MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function _pkgDayLabel(n) {
  const s = String(n || '');
  if (s.length !== 8) return '';
  return s.slice(6, 8) + '-' + (_PKG_MON[+s.slice(4, 6) - 1] || '?');
}

// Maps an IN-Gauge product label to the Opera internal code pattern for
// that same package family (e.g. Opera logs Early Check In as USS100EC,
// USS200EC, etc. — the trailing EC/LC/BB suffix is the reliable part).
// Which kind carries which IN-Gauge name is part of the kinds list (PKG_KINDS, editable in Settings).
function _pkgCodeFamilyFor(product) {
  const p = String(product || '').trim().toLowerCase();
  if (!p) return null;
  const k = PKG_KINDS.find(e => e.ig && e.ig.toLowerCase() === p);
  return k ? k[2] : null;   // UPS30BB, BBSUM, BBWIN, MBREAK… for Breakfast
}

function _pkgFindCol(hdrs, ...names) {
  for (const n of names) { const i = hdrs.findIndex(h => h === n); if (i >= 0) return i; }
  for (const n of names) { const i = hdrs.findIndex(h => h.includes(n)); if (i >= 0) return i; }
  return -1;
}

// ── Report columns: which header holds which value ─────────
// The defaults are IN-Gauge's and Opera's own headers. If an export renames
// one, Package Audit → Settings → Report columns maps it (shared per hotel):
// settings.colMap = { ig: { product: 'Item' }, guest: { name: 'Guest' } }.
// [field, label, header names tried in order, required]
const PKG_IG_FIELDS = [
  ['product',  'Product (package)',  ['Product'], true],
  ['conf',     'Confirmation no.',   ['Confirmation no', 'Confirmation No'], true],
  ['room',     'Room',               ['Room No']],
  ['charge',   'Charge (AED)',       ['Product Charge']],
  ['days',     'Charge days',        ['Charge Days']],
  ['arr',      'Arrival',            ['Arrival Date']],
  ['dep',      'Departure',          ['Departure Date']],
  ['employee', 'Seller (employee)',  ['Employee']],
  ['daily',    'Charge date',        ['Daily Date']],
  ['status',   'Status',             ['Status']],
];
const PKG_GUEST_FIELDS = [
  ['conf', 'Confirmation no.',   ['Confirmation Number', 'Confirmation No', 'Confirmation no'], true],
  ['name', 'Guest name',         ['Name', 'Guest Name'], true],
  ['gid',  'Guest / profile ID', ['Guest Name Id', 'Guest Id', 'Client Id', 'Profile Id']],
  ['room', 'Room',               ['Room']],
  ['arr',  'Arrival',            ['Arrival']],
  ['dep',  'Departure',          ['Departure']],
];
/** { field: column index or -1 }: the mapped header first (exact, any case), else the usual names. */
function _pkgMapColumns(hdrs, fields, which, map) {
  map = map || ((typeof _pkgSetting === 'function' && _pkgSetting('colMap')) || {})[which] || {};
  const low = hdrs.map(h => String(h || '').trim().toLowerCase());
  const out = {};
  fields.forEach(([f, , names]) => {
    const want = String(map[f] || '').trim().toLowerCase();
    const i = want ? low.indexOf(want) : -1;
    out[f] = i >= 0 ? i : _pkgFindCol(hdrs, ...names);
  });
  return out;
}
/** The header row: the first of the top 15 rows where every required column is found (else row 1). */
function _pkgHeaderRow(rows, fields, which, map) {
  const need = fields.filter(x => x[3]).map(x => x[0]);
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const hdrs = (rows[i] || []).map(h => String(h || '').trim());
    const C = _pkgMapColumns(hdrs, fields, which, map);
    if (need.every(f => C[f] >= 0)) return i;
  }
  return 0;
}
/** What the last file of each kind looked like, for Settings → Report columns (headers + 3 sample rows). */
let pkgLastHeaders = {};
function _pkgNoteParse(which, rows, hi, C) {
  const fields = which === 'ig' ? PKG_IG_FIELDS : PKG_GUEST_FIELDS;
  pkgLastHeaders[which] = {
    hdrs: (rows[hi] || []).map(h => String(h || '').trim()), row: hi + 1,
    sample: rows.slice(hi + 1, hi + 4).map(r => (r || []).map(v => String(v ?? ''))),
    missing: fields.filter(x => x[3] && !(C[x[0]] >= 0)).map(x => x[1]),
  };
}

function _pkgParseExcelUnknowns(rows) {
  if (!rows.length) return [];
  const hi   = _pkgHeaderRow(rows, PKG_IG_FIELDS, 'ig');
  const hdrs = (rows[hi] || []).map(h => String(h || '').trim());
  const C = _pkgMapColumns(hdrs, PKG_IG_FIELDS, 'ig');
  _pkgNoteParse('ig', rows, hi, C);
  const iProduct = C.product, iConf = C.conf, iRoom = C.room, iCharge = C.charge, iDays = C.days,
        iArr = C.arr, iDep = C.dep, iEmp = C.employee, iDaily = C.daily, iStatus = C.status;
  if (iProduct < 0 || iConf < 0) return [];

  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const product = String(r[iProduct] || '').trim();
    if (!product) continue;
    const employee = iEmp >= 0 ? String(r[iEmp] || '').trim() : '';
    const needsProduct  = /unknown/i.test(product);
    const needsEmployee = !employee || employee === '-';
    // Every row is kept, complete or not — staff expect the row count here
    // to match IN-Gauge's own total, not a pre-filtered "problems only" list.

    const conf = String(r[iConf] || '').trim().replace(/\.0+$/, '');
    if (!conf) continue;
    out.push({
      conf,
      room:   iRoom   >= 0 ? String(r[iRoom]   || '').trim() : '',
      charge: iCharge >= 0 ? (parseFloat(r[iCharge]) || 0) : 0,
      days:   iDays   >= 0 ? String(r[iDays]   || '').trim() : '',
      arr:    iArr    >= 0 ? String(r[iArr]    || '').trim() : '',
      dep:    iDep    >= 0 ? String(r[iDep]    || '').trim() : '',
      daily:  iDaily  >= 0 ? String(r[iDaily]  || '').trim() : '',
      status: iStatus >= 0 ? String(r[iStatus] || '').trim().toUpperCase() : '',
      product, employee, needsProduct, needsEmployee,
    });
  }
  return out;
}

// ── Opera Changes Log upload (.pdf) ─────────────────────────
// Opera won't run the Changes Log without an Action Type, and a package
// can be logged under either one: added at booking time it lands under New
// Reservation, added later under Update Reservation. So the report has to be
// run once for each, and both logs uploaded here — selected together or one
// after the other. Loads merge rather than replace, so the second upload
// doesn't wipe the first.
async function pkgLoadPdf(input) {
  const files = [...(input?.files || [])];
  if (!files.length) return;
  if (typeof pdfjsLib === 'undefined') {
    showToast('PDF engine not loaded yet — please wait a moment and try again', 'err');
    return;
  }
  try {
    busyStart('Reading the Opera Changes Log', 'opening the PDF…');
    await busyPaint();
    let fresh = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const prefix = files.length > 1 ? `log ${i + 1} of ${files.length} · ` : '';
      const data = new Uint8Array(await file.arrayBuffer());
      const pdf  = await pdfjsLib.getDocument({ data }).promise;
      const ev   = await _pkgParsePdfEvents(pdf, (done, total) =>
        busyStep(done, total, `${prefix}reading page ${done} of ${total}`));
      fresh += _pkgMergeEvents(pkgEvents, ev);
      if (!pkgPdfFiles.includes(file.name)) pkgPdfFiles.push(file.name);
    }
    _pkgRecomputeLogRange();
    const span = pkgLogRange.max ? ` · covers ${_pkgDayLabel(pkgLogRange.min)} → ${_pkgDayLabel(pkgLogRange.max)}` : '';
    const count = Object.keys(pkgEvents).length;
    const lbl = document.getElementById('pkgPdfLabel');
    if (lbl) lbl.textContent = count
      ? `✓ ${pkgPdfFiles.length} log${pkgPdfFiles.length !== 1 ? 's' : ''} · ${count} confirmation${count !== 1 ? 's' : ''}${span}`
      : 'Loaded — no product events found';
    showToast(count
      ? `✦ ${fresh} new event${fresh !== 1 ? 's' : ''} · ${count} confirmations loaded`
      : 'No product events found — check the Search Text was "product"', count ? 'ok' : 'err');
  } catch (err) {
    showToast('Failed to read the Opera Changes Log PDF: ' + err.message, 'err');
  } finally {
    busyDone();
    if (input) input.value = '';   // let the same file be re-picked after a Clear
  }
}

// Merges a freshly parsed log into what's already loaded, skipping entries
// already present — the two Action Type exports overlap on nothing, but the
// same file being picked twice shouldn't double every event.
function _pkgMergeEvents(target, incoming) {
  let added = 0;
  Object.entries(incoming).forEach(([conf, list]) => {
    const dest = target[conf] = target[conf] || [];
    list.forEach(e => {
      const dup = dest.some(x => x.ts === e.ts && x.code === e.code &&
                                 x.action === e.action && x.user === e.user && x.price === e.price);
      if (!dup) { dest.push(e); added++; }
    });
  });
  return added;
}

// Column x-thresholds tuned to Opera's Changes Log / User Activity Log PDF
// layout: User | Time | Date | Action Type | Action Description.
function _pkgColOf(x) {
  if (x < 68)  return 'user';
  if (x < 108) return 'time';
  if (x < 250) return 'date';
  if (x < 352) return 'atype';
  return 'desc';
}

// Report chrome (page footer + the filter block Crystal repeats on every
// page). These land in the same X band as the User column and below the
// last data row, so without this they get swallowed into the last row of
// each page — corrupting that row's "sold by" and its description.
// The hotel's own name is printed in the footer too: it is read from this hotel's settings (the
// name under the logo), never written here, plus any extra lines listed in Package Audit → Settings.
const _PKG_CHROME = /^(?:Page \d+ of \d+|user_activity_log|Filter|For Activity |Activity by |Search Text |Sort Order|From Time |To Time |User Activity Log)/i;
function _pkgChromeWords() {
  const out = [];
  try {
    const el = typeof document !== 'undefined' && document.getElementById && document.getElementById('hotelName');
    const name = String((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
    if (name) { const w = name.split(' '); out.push((w.length >= 2 ? w.slice(0, 2) : w).join(' ').toLowerCase()); }
  } catch (_) {}
  (typeof _pkgSetting === 'function' ? (_pkgSetting('chrome') || []) : []).forEach(x => { x = String(x || '').trim().toLowerCase(); if (x) out.push(x); });
  return out;
}
function _pkgIsChrome(text, words) {
  const t = String(text || '');
  if (_PKG_CHROME.test(t)) return true;
  const low = t.toLowerCase();
  return (words || _pkgChromeWords()).some(w => w && low.startsWith(w));
}

// Crystal Reports draws each column as its own vertical band, so pdf.js's
// extracted items come back grouped by COLUMN, not by row — a wrapped user
// email or a multi-line product description shows up as several separate
// text items at the same X but different Y. Row boundaries are anchored on
// the Date column (one short value per row); everything else in that row's
// Y-band (down to the next row's Date) belongs to the same activity entry.
//
// Within a row, Opera renders the product clauses first and closes with
// "Confirmation No. N" — so the confirmation is the LAST thing in the band,
// not the first. When a row runs past the bottom of a page, that closing
// confirmation (and the tail of the user's name) continues at the top of
// the next page, which is why rows are stitched across the page break
// before any events are read out of them.
async function _pkgParsePdfEvents(pdf, onPage) {
  const rows = []; // every data row, in reading order across all pages
  const chromeWords = _pkgChromeWords();

  for (let p = 1; p <= pdf.numPages; p++) {
    if (onPage) onPage(p, pdf.numPages);
    const page    = await pdf.getPage(p);
    const content = await page.getTextContent();

    const pts = content.items
      .filter(it => it.str && it.str.trim() !== '')
      .map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5], col: _pkgColOf(it.transform[4]) }));

    // Cluster into column-scoped lines (same column, Y within tolerance)
    const lines = [];
    pts.forEach(pt => {
      let line = lines.find(l => l.col === pt.col && Math.abs(l.y - pt.y) <= 2);
      if (!line) { line = { col: pt.col, y: pt.y, parts: [] }; lines.push(line); }
      line.parts.push(pt);
    });
    lines.forEach(l => {
      l.parts.sort((a, b) => a.x - b.x);
      let text = '', prevEnd = null;
      l.parts.forEach(pt => {
        if (prevEnd !== null && pt.x - prevEnd > 1) text += ' ';
        text += pt.str;
        prevEnd = pt.x + pt.str.length * 4; // rough glyph-width estimate, only used for spacing decisions
      });
      l.text = text.trim();
    });

    // Everything at or above the column-header row is the page header (report
    // title, print timestamp, filter block) — never data. Anything matching
    // the chrome pattern is the repeated footer. Drop both before banding.
    const headerY = lines.find(l => l.col === 'desc' && l.text === 'Action Description')?.y ?? Infinity;
    const body    = lines.filter(l => l.y < headerY - 0.5 && !_pkgIsChrome(l.text, chromeWords));

    // PDF y increases upward — top-to-bottom reading order is DESCENDING y.
    const dateLines = body.filter(l => l.col === 'date');
    const rowStarts = [...new Set(dateLines.map(l => l.y))].sort((a, b) => b - a);

    for (let i = 0; i < rowStarts.length; i++) {
      const yTop    = rowStarts[i];
      const yBottom = i + 1 < rowStarts.length ? rowStarts[i + 1] : -1e9;
      const rowLines = { user: [], desc: [], time: [] };
      body.forEach(l => {
        if (l.y <= yTop + 0.5 && l.y > yBottom + 0.5 && (l.col === 'user' || l.col === 'desc' || l.col === 'time')) {
          rowLines[l.col].push(l);
        }
      });
      rowLines.user.sort((a, b) => b.y - a.y);
      rowLines.desc.sort((a, b) => b.y - a.y);
      // User email wraps mid-word across lines ("ACCOREN-" / "SALVAREZ@" /
      // "ACCOREN") — no separator. Description wraps at word boundaries —
      // join with a space, then collapse any doubled whitespace.
      rows.push({
        user: rowLines.user.map(l => l.text).join(''),
        desc: rowLines.desc.map(l => l.text).join(' ').replace(/\s+/g, ' ').trim(),
        ts:   _pkgTimestamp(dateLines.find(l => l.y === yTop)?.text || '', rowLines.time[0]?.text || ''),
        lastOfPage: i === rowStarts.length - 1,
      });
    }
  }

  // Stitch rows whose description ran past the bottom of a page, then read
  // the events out of each completed row.
  const events = {}; // conf -> [{action, code, price, from, to, user, ts}]
  let carry = null;
  for (const row of rows) {
    let cur = row;
    if (carry) {
      // Crystal re-renders the row's User cell in full on the continuation
      // page, so prefer that complete value; only glue the fragments
      // together when the continuation doesn't repeat it.
      cur = {
        user: /@/.test(row.user) ? row.user : (carry.user || '') + (row.user || ''),
        desc: `${carry.desc} ${row.desc}`.replace(/\s+/g, ' ').trim(),
        ts:   carry.ts || row.ts,
        lastOfPage: row.lastOfPage,
      };
      carry = null;
    }
    // Update Reservation closes with "Confirmation No. 617307419";
    // New Reservation opens with "CONFIRMATION NO = 617214992".
    const confMatch = cur.desc.match(/Confirmation\s+No\.?\s*=?\s*(\d+)/i);
    if (!confMatch) {
      // No closing confirmation: if this is the last row on a page, the rest
      // of it is at the top of the next page — hold it and merge. Otherwise
      // there's genuinely nothing to attribute, so drop it.
      if (cur.lastOfPage) carry = cur;
      continue;
    }
    _pkgReadEvents(events, confMatch[1], cur);
  }
  return events;
}

// Dates wrap mid-token across lines ("02- AUG-26"), so strip inner spaces.
function _pkgNormDate(s) {
  return String(s || '').replace(/\s+/g, '').replace(/[;:.]+$/, '') || null;
}

// A description is a ';'-separated list of clauses, e.g.
//   ;PRODUCT UPS30BB ADDED
//   ;PRODUCT UPS30BB BETWEEN 01-AUG-26 AND 02-AUG-26 :  PRICE  -> 24.48
// A removal reads "PRICE 24.48 ->" (old price, nothing after the arrow), so
// only a value AFTER the arrow counts as the new price. Reading the detail
// clause per product code — rather than scanning a fixed window after the
// ADDED marker — is what keeps prices and dates attached to the right
// product when one entry both removes and adds a package.
function _pkgReadEvents(events, conf, row) {
  const details  = {}; // code -> {from, to, price}
  const added    = [];
  const attached = [];

  // An Update Reservation entry separates its clauses with semicolons, but
  // a New Reservation entry — a package sold at booking time — lays the
  // same information out on its own lines with none. Splitting on ';' finds
  // nothing in that second form, so each statement is instead read straight
  // out of the description and bounded by whatever comes next: the following
  // PRODUCT keyword, a semicolon, or the end. Every pattern names its own
  // product code, so a price can't drift onto the wrong package.
  const NEXT = String.raw`(?=;|PRODUCT\s+[A-Z0-9]+\s+(?:ADDED|DELETED|ATTACHED|BETWEEN)|$)`;

  let m;
  const delRe = /PRODUCT\s+([A-Z0-9]+)\s+DELETED\b/gi;
  while ((m = delRe.exec(row.desc))) {
    const l = (pkgDeleted[conf] = pkgDeleted[conf] || []);
    if (!l.some(x => x.code === m[1] && x.ts === row.ts)) l.push({ code: m[1], ts: row.ts });
  }
  const addedRe = /PRODUCT\s+([A-Z0-9]+)\s+ADDED\b/gi;
  while ((m = addedRe.exec(row.desc))) added.push(m[1]);

  const attachedRe = new RegExp(String.raw`PRODUCT\s+([A-Z0-9]+)\s+ATTACHED\b([\s\S]*?)` + NEXT, 'gi');
  while ((m = attachedRe.exec(row.desc))) {
    // "ATTACHED FROM <old range> -> FROM <new range>" — the range after the
    // last arrow is the one now in effect.
    const seg   = m[2] || '';
    const arrow = seg.lastIndexOf('->');
    const dm = (arrow >= 0 ? seg.slice(arrow + 2) : seg).match(/FROM\s+(.+?)\s+TO\s+([\w\s-]+?)\s*$/i);
    attached.push({ code: m[1], from: dm ? _pkgNormDate(dm[1]) : null, to: dm ? _pkgNormDate(dm[2]) : null });
  }

  const detailRe = new RegExp(String.raw`PRODUCT\s+([A-Z0-9]+)\s+BETWEEN\s+(.+?)\s+AND\s+(.+?)\s*:([\s\S]*?)` + NEXT, 'gi');
  while ((m = detailRe.exec(row.desc))) {
    // Opera sometimes logs the date range with no PRICE clause at all, so
    // the price is optional here — the dates are still worth keeping. A
    // removal reads "PRICE 24.48 ->" with nothing after the arrow, so only
    // a value that follows the arrow counts as the new price.
    const priceM = (m[4] || '').match(/PRICE\b[^>]*->\s*([\d.]+)/i);
    details[m[1]] = { from: _pkgNormDate(m[2]), to: _pkgNormDate(m[3]), price: priceM ? priceM[1] : null };
  }

  const push = e => { (events[conf] = events[conf] || []).push(e); };
  // ADDED = the package was first sold — carries the price and dates we need.
  // ATTACHED = a later change to an already-added package's date range. It
  // has no price of its own, but its user/timestamp still matter: a
  // reservation whose ADDED entry predates this report's date range shows up
  // only through its ATTACHED entries.
  added.forEach(code => {
    const d = details[code] || {};
    push({ action: 'ADDED', code, ts: row.ts, user: row.user, price: d.price || null, from: d.from || null, to: d.to || null });
  });
  attached.forEach(a => {
    const d = details[a.code] || {};
    push({ action: 'ATTACHED', code: a.code, ts: row.ts, user: row.user, price: null, from: a.from || d.from || null, to: a.to || d.to || null });
  });
}

// "13-08-26" + "21:32" -> a sortable number. Falls back to 0 (oldest) if
// either piece is unparseable, so a bad timestamp never wins "earliest".
function _pkgTimestamp(dateText, timeText) {
  const dm = String(dateText).match(/(\d{2})-(\d{2})-(\d{2})/);
  const tm = String(timeText).match(/(\d{2}):(\d{2})/);
  if (!dm) return 0;
  const [, dd, mm, yy] = dm;
  const [hh, mi] = tm ? [tm[1], tm[2]] : ['00', '00'];
  return Number(`20${yy}${mm}${dd}${hh}${mi}`);
}

// Among candidate events for a confirmation, the originator is whoever's
// event is chronologically earliest — later modifications by someone else
// (e.g. a date-range ATTACHED change) never reassign credit for the sale.
function _pkgPickOriginator(cands) {
  if (!cands.length) return null;
  return cands.slice().sort((a, b) => a.ts - b.ts)[0];
}

// "13-Aug-2026" (IN-Gauge) and "13-AUG-26" (Opera) -> 20260813, so the two
// systems' dates can be compared directly.
const _PKG_MONTHS = { JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12' };
function _pkgDayNum(s) {
  const m = String(s || '').match(/(\d{1,2})\s*-\s*([A-Za-z]{3})[A-Za-z]*\s*-\s*(\d{2,4})/);
  if (!m) return 0;
  const mm = _PKG_MONTHS[m[2].toUpperCase()];
  if (!mm) return 0;
  const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
  return Number(`${yy}${mm}${String(m[1]).padStart(2, '0')}`);
}

// The package a row represents, whether IN-Gauge named it or we had to read
// the Opera code (USS100EC -> Early Check In).
function _pkgFamilyName(r) {
  const p = String(r.product || '');
  const pl = p.trim().toLowerCase();
  if (pl && PKG_KINDS.some(e => e.ig && e.ig.toLowerCase() === pl)) return p;
  const c = String(r.code || '');
  const k = c && PKG_KINDS.find(e => e.ig && e.nameTest(c));
  if (k) return k.ig;
  return p || c;
}
/** The IN-Gauge names of the kinds that have one (Early Check In, Late Check Out, Breakfast…). */
function _pkgKnownNames() { return PKG_KINDS.filter(e => e.ig).map(e => e.ig.toLowerCase()); }

// Early check-in and late checkout are charged ONCE per stay. Breakfast and
// the board packages are per-night, so IN-Gauge listing one row per day is
// expected for those and only for those. ("Once per stay" is a switch per kind in Settings.)
function _pkgIsOneTime(name) { const n = String(name || '').toLowerCase(); return !!n && PKG_KINDS.some(e => e.once && e.ig && e.ig.toLowerCase() === n); }

// Find the Opera event backing this charge. Price identifies the exact
// package when a stay has several (e.g. breakfast switched tiers mid-stay);
// otherwise fall back to whoever started that package family.
function _pkgMatchEvent(u, cands) {
  // Whoever STARTED the package is the one credited, so every shortlist is
  // resolved by earliest timestamp. Picking the first array entry instead
  // would credit the wrong person: events are stored in the order the PDF
  // reads them, and Opera prints the log newest-first, so the first entry
  // is typically the person who touched the package LAST.
  const priced = list => list.filter(c => c.price && Math.abs(parseFloat(c.price) - u.charge) < 0.02);

  if (u.needsProduct) {
    // Product unknown — only an ADDED entry (which carries a price) can
    // identify which package this charge is; a date-only ATTACHED can't.
    const added   = cands.filter(c => c.action === 'ADDED');
    const matches = priced(added);
    // Earliest-wins settles WHO gets the credit; it must not settle WHICH
    // package a charge is. A stay can log two different products at the
    // same price — sometimes in the same minute — and picking by time then
    // comes down to a coin flip, which is how a breakfast charge ends up
    // labelled an early check-in. Different codes at the same price is a
    // genuine ambiguity, so leave it for a human.
    const codes = new Set(matches.map(c => c.code));
    if (codes.size > 1) return null;
    return _pkgPickOriginator(matches) || (added.length === 1 ? added[0] : null);
  }
  const family = _pkgCodeFamilyFor(u.product);
  const pool = family ? cands.filter(c => family.test(c.code)) : cands;
  return _pkgPickOriginator(priced(pool)) || _pkgPickOriginator(pool);
}

// The same person is written several ways across the two systems:
// Opera's log always has the login ("ACCOREN-SALVAREZ@ACCOREN"), while
// IN-Gauge may carry the login ("ACCOREN-SALVAREZ") or the display name
// ("Sam ALVAREZ") depending on the column and the export.
function _pkgUserKey(u) { return String(u || '').split('@')[0].trim().toUpperCase(); }

// Last word of either form: "ACCOREN-SALVAREZ" -> SALVAREZ, "Sam ALVAREZ"
// -> ALVAREZ. Digits and separators in a tenant prefix (HA7N5-LMORENO) are
// treated as breaks, so the family part is what's left at the end.
function _pkgFamilyPart(key) {
  const w = String(key).replace(/[^A-Z]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  return w.length ? w[w.length - 1] : '';
}

function _pkgSameUser(a, b) {
  const x = _pkgUserKey(a), y = _pkgUserKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  for (const [name, al] of Object.entries(typeof PKG_STAFF_ALIASES !== 'undefined' ? PKG_STAFF_ALIASES : {})) {
    const is = k => _pkgUserKey(name) === k || al.some(t => k.split('-').pop() === t || k.split('-').pop().endsWith(t) || k.includes(t));
    if (is(x) && is(y)) return true;
  }
  // A renamed colleague: the old name (as IN-Gauge still shows it on old rows) is the same person.
  if (typeof PKG_STAFF_FORMER !== 'undefined') for (const [name, olds] of Object.entries(PKG_STAFF_FORMER)) {
    // One side must BE the person (their name now or before); the other may be any form of it.
    const keys = [_pkgUserKey(name), ...olds];
    const near = k => keys.some(q => q === k || _pkgSameUserPlain(q, k));
    if ((keys.includes(x) && near(y)) || (keys.includes(y) && near(x))) return true;
  }
  // A login is the family name with the person's initials stuck on the
  // front — SALVAREZ/ALVAREZ, LMORENO/MORENO, TKHAN/KHAN —
  // so the longer form ends with the shorter one. Requiring at least
  // three letters and no more than a couple of extra keeps that from
  // matching two different people who happen to share an ending.
  return _pkgSameUserPlain(x, y);
}
/** Login vs display name by the family-name ending alone (no team list). */
function _pkgSameUserPlain(x, y) {
  x = _pkgUserKey(x); y = _pkgUserKey(y);
  if (!x || !y) return false;
  if (x === y) return true;
  const fx = _pkgFamilyPart(x), fy = _pkgFamilyPart(y);
  if (fx.length < 3 || fy.length < 3) return false;
  const [long, short] = fx.length >= fy.length ? [fx, fy] : [fy, fx];
  return long.endsWith(short) && long.length - short.length <= 3;
}

// IN-Gauge's screens name people the way the dropdown does; Opera's log
// only ever carries the login. Showing "ACCOREN-SALVAREZ" next to a
// dropdown that says "Sam ALVAREZ" leaves the reader translating between
// the two, so the login is resolved back to the name wherever it's known.
//
// The team list lives in the database (packageAudit/staff, edited in
// ⚙️ Rules → Staff names), never in this public file. It starts EMPTY: an
// unrecognised login simply displays as itself, so nothing breaks while the
// list is empty or falls behind.
let PKG_STAFF = [];

// Extra spellings a login can carry for someone, when it is not simply
// initials + family name (e.g. "Sam ALVAREZ" logging in as ACCOREN-SALVAREZ2).
// Filled from the same staff list: { 'Sam ALVAREZ': ['SALVAREZ2', ...] }.
let PKG_STAFF_ALIASES = {};
// Names a colleague had before a rename: { 'New NAME': ['OLD NAME', ...] } (user keys, upper case).
let PKG_STAFF_FORMER = {};
// Who has left: { 'Name': 'YYYY-MM-DD' }. They keep the sales they made; they are not offered for new ones.
let PKG_STAFF_LEFT = {};

function _pkgStaffFor(u) {
  const key = _pkgUserKey(u);
  if (!key) return null;
  const login = key.split('-').pop();
  const renamed = Object.keys(PKG_STAFF_FORMER).find(name => PKG_STAFF_FORMER[name].includes(key));
  if (renamed) return renamed;
  return PKG_STAFF.find(name => _pkgSameUser(name, key)) ||
    Object.keys(PKG_STAFF_ALIASES).find(name => PKG_STAFF_ALIASES[name].some(a => login === a || login.endsWith(a) || key.includes(a))) ||
    _pkgReportNames().find(name => _pkgSameUser(name, key)) ||
    null;
}
// The names IN-Gauge itself uses (its Employee column), so a login reads as a name even before
// anyone fills in the team list. Nothing is saved: they come from the file loaded on this device.
let _pkgNamesCache = { src: null, list: [] };
function _pkgReportNames() {
  if (typeof pkgUnknowns === 'undefined' || !Array.isArray(pkgUnknowns)) return [];
  if (_pkgNamesCache.src === pkgUnknowns && _pkgNamesCache.n === pkgUnknowns.length) return _pkgNamesCache.list;
  const set = new Set();
  pkgUnknowns.forEach(r => { const e = String(r && r.employee || '').trim(); if (e && e !== '-' && /[a-z]/i.test(e) && !_pkgIsSystemUser(e)) set.add(e); });
  _pkgNamesCache = { src: pkgUnknowns, n: pkgUnknowns.length, list: [...set] };
  return _pkgNamesCache.list;
}

function _pkgUserLabel(u) {
  const key = _pkgUserKey(u);
  if (!key) return String(u || '');
  // Reuses the login/display-name matching, so SALVAREZ finds Sam ALVAREZ
  // without needing the exact login spelled out here.
  return _pkgStaffFor(u) || key;
}

// The matched event says WHICH package the charge is; it does not say who
// sold it. A package added once and repriced later logs two entries under
// the same code, and matching on the charged amount lands on the repricing
// — conf 617204564 is UPS60BB added by one person at 32.66 on 11-Aug and
// moved to 48.98 by a colleague on 13-Aug, where the 48.98 charge would credit
// the colleague for a package the first person started. Same code is the same package, so
// credit follows its earliest entry.
//
// Matched on the package FAMILY rather than the exact code, because an
// upgrade rewrites the code: breakfast for one guest is UPS30BB and for
// two is UPS60BB, so a colleague adding the second guest would otherwise
// take the whole sale off whoever booked the breakfast. Codes outside the
// three known families (half board, dinner) have no upgrade ladder to
// follow, so those stay matched on the exact code.
// Kinds of package: the same kind at another price (UPS30BB / UPS60BB, BBSUM / BBWIN,
// USS100EC / USS225EC, UPS59DIN / UPS118DIN, USS50 / USS75…) is the same package, and stays with
// whoever started it. Checked in this order (USS100EC is early check-in, not an upgrade).
// The list is data, editable per hotel in Package Audit → 🛠 Settings → Package kinds (shared at
// packageAudit/settings/kinds). Each kind: key, label, a code pattern (regex) and/or exact codes,
// the name IN-Gauge gives it (when it has one), once per stay, a price range, icon and colour.
// nameRe: which codes are read back as the IN-Gauge name (kept from before kinds were editable).
const PKG_KINDS_DEFAULT = [
  { k: 'EC',  label: 'Early check-in', re: 'EC$',             ig: 'Early Check In', nameRe: 'EC$', once: true, ico: '🌅', color: '#d8f0d8' },
  { k: 'LC',  label: 'Late check-out', re: 'LC$',             ig: 'Late Check Out', nameRe: 'LC$', once: true, ico: '🌙', color: '#e6daf5' },
  { k: 'BB',  label: 'Breakfast',      re: '(BB$|^BB|BREAK)', ig: 'Breakfast',      nameRe: 'BB$', ico: '🥐', color: '#fce7b2' },
  { k: 'DIN', label: 'Dinner',         re: 'DIN$',            ico: '🍽️', color: '#f8d3d3' },
  { k: 'HB',  label: 'Half board',     re: '^HB',             ico: '🍲', color: '#fde2c8' },
  { k: 'FB',  label: 'Full board',     re: '^FB',             ico: '🍱', color: '#e2e8f0' },
  { k: 'USS', label: 'Room upgrade',   re: '^USS\\d+$',        ico: '⬆️', color: '#d6e6fb' },
];
const _pkgCodeNorm = c => String(c || '').toUpperCase().replace(/\s+/g, '');
function _pkgSafeRe(src) { try { return src ? new RegExp(src, 'i') : null; } catch (_) { return null; } }
/** One kind as the audit uses it: [key, label, matcher] (matcher.test(code)), plus its settings as properties. */
function _pkgKindRow(d) {
  const re = _pkgSafeRe(d.re), codes = (Array.isArray(d.codes) ? d.codes : []).map(_pkgCodeNorm).filter(Boolean);
  const m = { test: c => { const x = _pkgCodeNorm(c); return !!x && (codes.includes(x) || (!!re && re.test(x))); }, source: d.re || '' };
  const nre = _pkgSafeRe(d.nameRe);
  const e = [String(d.k || '').toUpperCase(), String(d.label || d.k || ''), m];
  Object.assign(e, { ig: String(d.ig || '').trim(), once: !!d.once, ico: d.ico || '🎁', color: d.color || '', min: +d.min || 0, max: +d.max || 0,
    codes, re: d.re || '', nameTest: c => (nre ? nre.test(_pkgCodeNorm(c)) : m.test(c)) });
  return e;
}
const PKG_KINDS = PKG_KINDS_DEFAULT.map(_pkgKindRow);
/** Swap the kinds in place (other files keep their reference to PKG_KINDS). */
function _pkgSetKinds(list) {
  const rows = (Array.isArray(list) && list.length ? list : PKG_KINDS_DEFAULT).filter(d => d && d.k).map(_pkgKindRow);
  PKG_KINDS.splice(0, PKG_KINDS.length, ...rows);
}
const _pkgKindEntry = code => PKG_KINDS.find(k => k[2].test(String(code || '').replace(/\s+/g, ''))) || PKG_KINDS.find(k => k[0] === String(code || '').toUpperCase()) || null;
function _pkgFamilyOfCode(code) {
  const k = _pkgKindEntry(code);
  return k ? k[2] : null;
}

// A booking that arrives through TARS or another interface writes its
// packages under a system account, and nobody at the desk sold those — so
// those entries are passed over when deciding who to credit. Machine
// accounts appear as an opaque id (ACCOREN-70F54B3222) rather than a name,
// which is what the hex test catches; a name made only of letters is
// always treated as a real person, so an unfamiliar colleague is never
// mistaken for a system.
// Opera writes the interface account as literally "*TARS*", so the
// delimiter here has to be anything non-alphanumeric rather than the "-" and
// "." originally assumed — with the narrower pattern *TARS* was never
// recognised as a system account at all, and could be credited with a sale.
const _PKG_SYSTEM_USER = /(^|[^A-Z0-9])(TARS|PRODUCTION|INTERFACE|WEBSERVICE|SYSTEM|IFC|ONLINE|CHANNEL|BOOKING|PMS)([^A-Z0-9]|$)/i;

function _pkgIsSystemLogin(u) {
  const key = _pkgUserKey(u);
  if (!key) return true;
  if (_PKG_SYSTEM_USER.test(key)) return true;
  const login = key.split('-').pop() || key;
  return /\d/.test(login) && /^[0-9A-F]{6,}$/i.test(login);
}
// The rule "online / TARS / system bookings have no desk seller": switched off,
// a system account is credited like anyone else.
function _pkgIsSystemUser(u) {
  if (!_pkgRule('systemNoSeller')) return !_pkgUserKey(u);
  return _pkgIsSystemLogin(u);
}

// Returns null when every entry for the package is a system account —
// nobody sold it, so there is nobody to credit.
function _pkgOriginatorFor(ev, cands) {
  if (!ev) return null;
  // Rule off: whoever's entry matches the charged price gets it (null for a system account).
  if (!_pkgRule('firstPerson')) return _pkgIsSystemUser(ev.user) ? null : ev;
  const family = _pkgRule('familyMatch') ? _pkgFamilyOfCode(ev.code) : null;
  const pool = family ? cands.filter(c => family.test(c.code))
                      : cands.filter(c => c.code === ev.code);
  return pool.slice().sort((a, b) => a.ts - b.ts).find(c => !_pkgIsSystemUser(c.user)) || null;
}

// Decide which rows may actually be credited as an upsell.
//
// Deliberately NOT a rule: comparing the charged day against the date range
// on the matched Opera event. The Changes Log records changes over time, so
// each event's "BETWEEN x AND y" is only a snapshot from the moment it was
// written — a package added for one night and later extended across the stay
// shows an early event still reading the original single night. Treating that
// as the package's true span wrongly denies every legitimate later night.
// One package, one stay, two people paid for it. IN-Gauge bills a package
// night by night, and each night carries its own seller — so a package can
// end up credited to whoever happened to be on duty rather than whoever
// sold it. Opera cannot settle this: the sale is a single event there, and
// these rows all point back to it. Flagging is the honest response, since
// deciding which of two colleagues earned it is not the tool's call.
//
// Denied rows take no part: a rejected charge is not a second credit.
function _pkgFlagSplitSellers(results) {
  const byPkg = {};
  results.forEach(r => {
    if (r.verdict === 'settled') return;
    const fam = _pkgFamilyName(r);
    // Only group rows that are the same known package. "Unknown Product" is
    // the absence of a name, not a name — grouping on it would put a
    // breakfast and a late checkout in the same bucket and call them split.
    if (!_pkgKnownNames().includes(String(fam).toLowerCase())) return;
    (byPkg[`${r.conf}|${fam}`] = byPkg[`${r.conf}|${fam}`] || []).push(r);
  });
  if (!_pkgRule('splitFlag')) return;

  Object.values(byPkg).forEach(rows => {
    if (rows.length < 2) return;
    // Compare the seller each row will actually be credited to. A blank is a
    // missing value, not a second person — those rows are already flagged as
    // needing a seller and must not masquerade as a conflict.
    const named = s => { const v = String(s || '').trim(); return (!v || v === '-' || v === '—') ? '' : v; };
    const people = [];
    rows.forEach(r => {
      const who = named(r.user) || named(r.employee);
      if (!who) return;
      if (!people.some(p => _pkgSameUser(p, who))) people.push(who);
    });
    if (people.length < 2) return;
    const names = people.map(_pkgUserLabel);
    rows.forEach(r => {
      r.splitSeller = names;
      // Never downgrade a row that already needs a decision.
      if (r.verdict === 'credit' && r.alreadyComplete) {
        _pkgHit(r, 'splitFlag');
        r.verdict = 'review';
        r.note = `Split between ${names.join(' and ')} — one package, one stay, credited to more than one person`;
      }
    });
  });
}

function _pkgApplyVerdicts(results) {
  results.forEach(r => {
    r.family = _pkgFamilyName(r);
    r.verdict = 'credit';
    r.denyReason = '';

    // Already rejected in IN-Gauge: it credits nobody and there is nothing
    // left to act on, so it takes no further part in any of the checks
    // below — including the duplicate rule, where counting a rejected
    // charge would make a legitimate one look like the extra copy.
    if (r.status === 'DENIED') { r.verdict = 'settled'; return; }

    if (r.matchedEvent) return;

    if (!r.candidates || !r.candidates.length) {
      // Opera logged nothing for this reservation. Usually that isn't a
      // problem with the reservation at all — it's the log not reaching the
      // moment the package was sold. Separating those out matters: a row
      // nobody can act on shouldn't sit in the same pile as one that needs
      // a decision.
      // Nothing in the Excel says when a package was SOLD. IN-Gauge dates
      // the night being charged; Opera dates the sale, and the two can be
      // weeks apart — 617080953 is charged from 01-Aug for a package added
      // on 25-Jul. So arrival can't stand in for the sale date: that
      // reservation arrives on the log's first day yet its sale predates
      // the log entirely. With no entry to point at, the only honest
      // reading is that this log doesn't reach the sale.
      r.verdict = 'outside';
      const day = _pkgDayNum(r.daily);
      r.note = (pkgLogRange.max && day > pkgLogRange.max)
        ? `Charged ${r.daily}, after this log ends (${_pkgDayLabel(pkgLogRange.max)}) — the night audit hasn't reached it yet`
        : `Sold before this log starts (${_pkgDayLabel(pkgLogRange.min)}) — packages are often added when the booking is made, weeks before the stay`;
      return;
    }
    const family = _pkgCodeFamilyFor(r.family);
    if (family && !r.candidates.some(c => family.test(c.code)) && _pkgRule('denyNoOpera')) {
      // Opera does have this reservation's package activity, and none of it
      // is this kind of package.
      _pkgHit(r, 'denyNoOpera');
      r.verdict = 'deny';
      r.denyReason = `Opera shows no ${r.family} on this reservation (logged: ${r.candidates.map(c => c.code).filter((v, i, a) => a.indexOf(v) === i).join(', ')})`;
      return;
    }
    r.verdict = 'review';
  });

  // Early check-in and late checkout are charged once per stay, so any extra
  // rows IN-Gauge spread across the other nights are duplicates. This needs
  // no Opera data at all — IN-Gauge's own rows are enough to prove it.
  const groups = {};
  results.forEach(r => {
    if (!_pkgRule('oneTime')) return;
    if (r.verdict !== 'credit' || !_pkgIsOneTime(r.family)) return;
    const key = `${r.conf}|${r.family.toLowerCase()}`;
    (groups[key] = groups[key] || []).push(r);
  });
  Object.values(groups).forEach(list => {
    if (list.length < 2) return;
    // Keep the day Opera actually logged the package, when that's one of
    // them; otherwise keep the earliest and flag the rest.
    const opera = new Set(list.flatMap(r => (r.candidates || []).map(c => _pkgDayNum(c.from))).filter(Boolean));
    list.sort((a, b) => (_pkgDayNum(a.daily) || 0) - (_pkgDayNum(b.daily) || 0));
    const keep = list.find(r => opera.has(_pkgDayNum(r.daily))) || list[0];
    list.forEach(r => {
      if (r === keep) return;
      _pkgHit(r, 'oneTime');
      r.verdict = 'deny';
      r.denyReason = `${r.family} is charged once per stay — already counted on ${keep.daily || 'another row'}`;
    });
  });
}

// Groups a guest's reservations into one continuous stay, so an extension
// keyed as a fresh booking is still recognised as the same stay. Two
// bookings chain when they are the same guest and the second picks up where
// the first left off. Anything with a real break between it is a return
// visit and a separate sale; anything overlapping is a second room taken at
// the same time, which is also a separate sale.
//
// The guest's Opera profile ID is used when the export carries it — it is
// exact, where a name is a guess. Real data bears this out: chaining on
// contiguous dates, 93% of the links land in the same room, which is what
// an extension looks like. Allowing weeks between bookings drops that to
// 30% because it starts swallowing return visits.
//
// Returns confirmation -> the stay's first confirmation.
// guests: optional, defaults to the loaded guest list (My upsells passes its own).
function _pkgBuildChains(guests) {
  const byGuest = {};
  Object.entries(guests || pkgGuests).forEach(([conf, g]) => {
    const key = g.gid ? 'ID:' + g.gid : (g.norm ? 'NM:' + g.norm : '');
    if (!key) return;
    (byGuest[key] = byGuest[key] || []).push({ conf, ...g });
  });

  const head = {};
  Object.values(byGuest).forEach(list => {
    if (list.length < 2) return;
    // Arrival, then departure, then confirmation: two bookings made on the
    // same day must still order the same way on every run.
    list.sort((a, b) => (_pkgDayNum(a.arr) || 0) - (_pkgDayNum(b.arr) || 0)
                     || (_pkgDayNum(a.dep) || 0) - (_pkgDayNum(b.dep) || 0)
                     || String(a.conf).localeCompare(String(b.conf)));
    let chainHead = list[0].conf;
    let prevEnd   = _pkgDayNum(list[0].dep) || _pkgDayNum(list[0].arr);
    let prevRoom  = String(list[0].room || '').trim();
    const gapMax  = +_pkgRule('chainGap') || 0, sameRoom = !!_pkgRule('chainSameRoom');
    head[list[0].conf] = chainHead;
    for (let i = 1; i < list.length; i++) {
      const arr = _pkgDayNum(list[i].arr);
      // Compared as plain calendar days so month ends behave.
      const gap = (arr && prevEnd) ? _pkgDaysBetween(prevEnd, arr) : Infinity;
      // Only a booking that starts the day the last one ends continues the
      // stay: the guest never left, so the sale is still the first seller's.
      // Anything else is a fresh sale and belongs to whoever made it.
      //
      // Negative means the stays overlap — a second room taken at the same
      // time, not an extension. Even a single day's gap is a return visit:
      // across a real month, 232 of 252 contiguous pairs are the same room,
      // against 1 of 6 at a one-day gap, where the guest checked out and came
      // back into a different room.
      // "Only when same room" (a rule option): a move to another room starts a new stay.
      const room = String(list[i].room || '').trim();
      if (gap < 0 || gap > gapMax || (sameRoom && room && prevRoom && room !== prevRoom)) chainHead = list[i].conf;
      head[list[i].conf] = chainHead;
      prevEnd = _pkgDayNum(list[i].dep) || arr;
      prevRoom = room;
    }
  });
  return head;
}

function _pkgDaysBetween(a, b) {
  const toDate = n => { const s = String(n); return new Date(+s.slice(0,4), +s.slice(4,6) - 1, +s.slice(6,8)); };
  return Math.round((toDate(b) - toDate(a)) / 86400000);
}

// The sale belongs to whoever made the first booking of the stay. Without
// this, a guest extending onto a new confirmation number hands the credit
// to whoever keyed that booking — which also means a colleague's sale can
// be moved onto yourself simply by rebooking it.
// The seller of a booking that has no row in this IN-Gauge export, read
// from the Opera log alone: the earliest package entry by a real person.
// System accounts are skipped — a TARS booking sold nothing.
function _pkgOwnerFromOpera(conf, events) {
  const ev = (events || pkgEvents)[conf] || [];
  if (!ev.length) return null;
  const first = ev.slice().sort((a, b) => a.ts - b.ts).find(c => !_pkgIsSystemUser(c.user));
  return first ? { user: first.user, confirmed: true, viaOpera: true } : null;
}

// The kind of package a code is: EC / LC / BB by the reliable suffix, else its letter prefix
// (USS50 and USS100 are both room upgrades: "USS"). Used so the extension rule only carries a
// sale over to the SAME kind of package: a guest extending a breakfast stay who is then sold a
// room upgrade on the new booking bought something new, from whoever sold it.
function _pkgKindOfCode(code) {
  code = String(code || '').toUpperCase().replace(/\s+/g, '');
  if (_pkgRule('exactCode') && code) return code;   // UPS30BB and UPS60BB are two different packages
  const k = _pkgKindEntry(code);
  if (k) return k[0];
  const m = code.match(/^[A-Z]+/);
  return m ? m[0] : '';
}
function _pkgKindOfRow(r) {
  let c = (r.matchedEvent && r.matchedEvent.code) || (r.originEvent && r.originEvent.code) || '';
  // Exact codes: the package this booking ended up with. Swapping UPS30BB for UPS60BB logs the new
  // code at the old price first, so the charge can match the old code; the latest code added to
  // the booking in the same family is the one being charged.
  if (c && _pkgRule('exactCode')) {
    const fam = _pkgFamilyOfCode(c);
    const last = (pkgEvents[r.conf] || []).filter(e => e.action === 'ADDED' && (fam ? fam.test(e.code) : e.code === c))
      .sort((a, b) => b.ts - a.ts)[0];
    if (last) c = last.code;
  }
  if (c) return _pkgKindOfCode(c);
  if (_pkgRule('exactCode')) return '';   // no Opera code for this row: can't tell which exact package
  const n = String(_pkgFamilyName(r) || '').toLowerCase();
  const k = n && PKG_KINDS.find(e => e.ig && e.ig.toLowerCase() === n);
  return k ? k[0] : '';
}

function _pkgApplyExtensionCredit(results) {
  if (!Object.keys(pkgGuests).length) return;   // no guest list loaded: rule is inactive
  if (!_pkgRule('chain')) return;               // switched off in Rules
  const head = _pkgBuildChains();
  const arrOf = c => _pkgDayNum((pkgGuests[c] || {}).arr) || 0;
  // The kinds of package the bookings of a stay before this one carried, each with the first
  // Opera entry that put it there (who and when). Rows of those bookings count too, when Opera's
  // log doesn't reach back that far.
  function earlierKinds(h, conf) {
    const kinds = new Map();   // kind -> { user, ts } of the first entry, or null when only a row shows it
    Object.keys(head).filter(c => head[c] === h && c !== conf && arrOf(c) < arrOf(conf)).forEach(c => {
      (pkgEvents[c] || []).forEach(e => {
        const k = _pkgKindOfCode(e.code); if (!k) return;
        const cur = kinds.get(k);
        if (!cur || e.ts < cur.ts) kinds.set(k, { user: e.user, ts: e.ts });
      });
      results.forEach(x => { if (x.conf === c) { const k = _pkgKindOfRow(x); if (k && !kinds.has(k)) kinds.set(k, null); } });
    });
    return kinds;
  }

  // Who owns each stay: the seller on its first booking, preferring one
  // Opera actually confirms over IN-Gauge's unverified word.
  const owner = {};
  results.forEach(r => {
    if (head[r.conf] !== r.conf) return;
    if (r.verdict === 'settled' || r.verdict === 'deny') return;
    const sure = !!r.matchedEvent || !!r.memoryUsed;   // Opera, or remembered from the month the sale was made
    if (!owner[r.conf] || (sure && !owner[r.conf].confirmed)) {
      owner[r.conf] = { user: r.user || r.employee, confirmed: sure };
    }
  });

  results.forEach(r => {
    const h = head[r.conf];
    if (!h || h === r.conf) return;                                  // first booking of the stay
    if (r.verdict === 'settled' || r.verdict === 'deny') return;     // already handled

    // The first booking is very often not in this IN-Gauge export at all —
    // auditing a day at a time, a stay that began last week has its opening
    // charge in an earlier file. Opera still holds it, and the Changes Log
    // reaches back further than the export does, so fall back to whoever
    // Opera shows starting that booking's packages. Without this the whole
    // rule goes quiet for anyone not auditing a full month in one go.
    // Only the same kind of package continues the stay's sale. A kind the earlier bookings never
    // had (a room upgrade sold on the extension of a breakfast stay) is a new sale on this booking,
    // and stays with whoever sold it.
    // The sale belongs to the first one who put THIS package on the stay: the stay's seller when that
    // is who added it, otherwise whoever's entry for it comes first.
    const kind = _pkgKindOfRow(r);
    let own = owner[h] || _pkgOwnerFromOpera(h);
    if (kind) {
      const before = earlierKinds(h, r.conf);
      if (before.size && !before.has(kind) && _pkgRule('sameKind')) { _pkgHit(r, 'sameKind'); r.newKindOnExt = h; return; }
      const first = before.get(kind);
      if (first && first.user) {
        if (_pkgIsSystemUser(first.user)) { _pkgHit(r, 'systemNoSeller'); return; }   // it came with an online booking: nobody at the desk sold it
        if (!own || !_pkgSameUser(own.user, first.user)) own = { user: first.user, confirmed: true, viaOpera: true };
      }
    }
    if (!own || !own.user) return;
    // A stay that started on a TARS or interface booking has no seller to
    // hand the credit to, and moving a real person's sale onto a system
    // account would be worse than leaving it alone.
    if (_pkgIsSystemUser(own.user)) return;

    _pkgHit(r, 'chain');
    r.extendedFrom = h;
    r.extendedName = (pkgGuests[r.conf] || {}).name || '';
    r.extendedVia  = own.viaOpera ? 'opera' : '';
    // The stay's owner is the final word, and it overrides whatever the
    // per-booking originator concluded earlier. That step looks at one
    // booking in isolation and sees whoever added the package to the
    // extension — a different person by definition. Leaving its answer in
    // place is what made the tool ask for the same fix every day: apply the
    // correction, and next run the originator flags it straight back, now
    // pointing the other way.
    r.user = own.user;

    // Compared against what IN-Gauge actually holds — that is what decides
    // whether opening this confirmation would change anything.
    if (_pkgSameUser(r.employee, own.user)) {
      r.reassign = false;
      r.wasUser  = '';
      // Stated both ways round on purpose: a blank product or seller must
      // never end up hidden, whatever an earlier step concluded.
      r.alreadyComplete = !r.needsProduct && !r.needsEmployee;
      return;
    }

    // Opera may show someone else adding the package on the new booking;
    // the stay's original seller still keeps it.
    r.wasUser  = r.employee;
    r.reassign = true;
    r.alreadyComplete = false;
    r.verdict  = 'credit';
  });
}

// Records the day's upsell figures so the month can be looked at without
// re-running every export. Keyed by the charge date in IN-Gauge rather than
// today, so re-running an old file lands on the day it belongs to and
// re-running the same file simply overwrites that day rather than doubling it.
//
// Denied charges are excluded: they were never earned. Credit goes to the
// seller the audit settled on, not the one IN-Gauge had, so the archive
// matches what should actually be paid.
function _pkgArchive(results) {
  if (typeof saveHistory !== 'function') return;
  const byDay = {};
  results.forEach(r => {
    if (r.verdict === 'deny' || r.verdict === 'settled') return;
    const day = _pkgDayNum(r.daily);
    if (!day) return;
    const iso = `${String(day).slice(0,4)}-${String(day).slice(4,6)}-${String(day).slice(6,8)}`;
    const safe = v => String(v).replace(/[.#$\[\]\/]/g, ' ').replace(/\s+/g, ' ').trim() || '—';   // names become database keys
    const who = safe(_pkgUserLabel(r.user || r.employee) || 'Unassigned');
    const fam = safe(_pkgFamilyName(r));
    const d = byDay[iso] = byDay[iso] || { sellers:{}, products:{}, rows:0, aed:0 };
    const amt = parseFloat(r.charge) || 0;
    d.rows++; d.aed += amt;
    const s = d.sellers[who] = d.sellers[who] || { rows:0, aed:0 };
    s.rows++; s.aed += amt;
    const p = d.products[fam] = d.products[fam] || { rows:0, aed:0 };
    p.rows++; p.aed += amt;
  });
  Object.entries(byDay).forEach(([iso, d]) => {
    d.aed = Math.round(d.aed * 100) / 100;
    Object.values(d.sellers).forEach(s => { s.aed = Math.round(s.aed * 100) / 100; });
    Object.values(d.products).forEach(p => { p.aed = Math.round(p.aed * 100) / 100; });
    saveHistory('upsells', d, iso);
  });
}

// Last word before anything is shown: a row is only work if the seller in
// IN-Gauge differs from the one being credited. Every rule above can set
// reassign, and each compares against a slightly different thing, so this is
// the one place that asks the question the person actually faces — "will I
// have to change anything when I open this confirmation?" If not, it isn't
// on the list.
function _pkgDropNoOpReassigns(results) {
  results.forEach(r => {
    // A row someone has marked REVIEWED in IN-Gauge has already been decided
    // by a person, whichever way they decided. Opera cannot know why — the
    // seller may have been left alone on purpose, as on a booking that came
    // in through TARS where the colleague who extended it added the package
    // and has earned it. Re-raising it every run is how the same
    // confirmations came round day after day, already fixed.
    //
    // Unlike DENIED this is not struck out: the charge stands, so it keeps
    // its credit and still counts towards the totals and the leaderboard.
    // It simply stops being work.
    if (r.status === 'REVIEWED' && _pkgRule('reviewedStops')) {
      _pkgHit(r, 'reviewedStops');
      r.reviewed = true;
      r.reassign = false;
      r.wasUser  = '';
      // Reviewing settles who earned the sale — a judgement only a person can
      // make. It does not settle whether the charge should exist or whether
      // the record is complete: a duplicate is still a duplicate, a package
      // Opera has no record of is still unsupported, and a blank product or
      // seller is a gap rather than an opinion. Those stay on the list, and
      // say that they were reviewed, so a decision made on bad information
      // can be revisited rather than quietly standing. Assigned rather than
      // only set true, so a blank field cannot be hidden by an earlier step.
      r.alreadyComplete = !r.needsProduct && !r.needsEmployee;
      return;
    }
    if (!r.reassign) return;
    if (!_pkgSameUser(r.employee, r.user)) return;   // a genuine change
    r.reassign = false;
    r.wasUser  = '';
    r.noOpFixed = true;                              // already right, kept out of the action list
    if (!r.needsProduct && !r.needsEmployee) r.alreadyComplete = true;
  });
}

// ── Reconcile ────────────────────────────────────────────────
async function pkgRun() {
  const errBox = document.getElementById('pkgError');
  errBox.classList.remove('show');
  const showErr = msg => { document.getElementById('pkgErrorMsg').textContent = msg; errBox.classList.add('show'); };

  if (!pkgUnknowns.length) return showErr('Upload the IN-Gauge export first — no rows loaded.');
  if (!Object.keys(pkgEvents).length) return showErr('Upload the Opera Changes Log PDF first.');

  busyStart('Checking the charges', `matching ${pkgUnknowns.length} against Opera…`);
  await busyPaint();

  const results = _pkgCompute();
  _pkgArchive(results);
  pkgResults = results;
  try { _pkgMemorize(results); } catch (e) { console.warn('[pkg memory]', e); }   // remember every package resolved, for next month
  _pkgConfirmSweep();              // fixes this newer report proves right count as confirmed
  if (typeof logActivity === 'function') logActivity('pkg_audit_run', `${results.length} package lines checked`);
  _pkgRenderCoverage();
  document.getElementById('pkgResultsWrap').style.display = 'block';
  pkgRender();
  busyDone();
}

/** Note which rule decided something on this row (for Why? and the Rules suggestions). */
function _pkgHit(r, k) { (r.ruleHits = r.ruleHits || []).includes(k) || r.ruleHits.push(k); }

/** The whole audit on what is loaded, under the current rules: no screen, no saving. */
function _pkgCompute() {
  const results = pkgUnknowns.map(u => {
    const cands = pkgEvents[u.conf] || [];
    const ev = _pkgMatchEvent(u, cands);

    if (!ev) {
      const complete = !u.needsProduct && !u.needsEmployee;
      return { ...u, resolved: complete, alreadyComplete: complete, reassign: false,
               matchedEvent: null, candidates: cands,
               code: u.product, price: String(u.charge), from: u.arr, to: u.dep, user: u.employee };
    }

    // Credit goes to whoever started the package, which may be an earlier
    // entry than the one whose price identified the charge. Null means the
    // package only ever appears under a system account — a TARS booking
    // rather than something sold at the desk — so there is nobody to credit
    // and IN-Gauge's own value is left alone.
    const origin   = _pkgOriginatorFor(ev, cands);
    const noSeller = !origin;
    const ruleHits = [noSeller ? 'systemNoSeller' : 'firstPerson'];

    // A seller already filled in isn't proof it's the right one. Opera says
    // who started the package, so a name that disagrees needs reassigning —
    // that row is not "already correct" just because the field isn't blank.
    const reassign = !noSeller && !u.needsEmployee && !!origin.user && !_pkgSameUser(u.employee, origin.user);
    const alreadyComplete = !u.needsProduct && !u.needsEmployee && !reassign;

    // Keep IN-Gauge's own product name when it already had one, rather than
    // replacing it with Opera's raw internal code. Fall back to the Excel's
    // price/dates when the matched event is an ATTACHED entry, which is a
    // date-range change and carries no price of its own.
    return {
      ...u, ruleHits,
      resolved: true, alreadyComplete, reassign, noSeller,
      matchedEvent: ev, originEvent: origin, candidates: cands,
      code:  u.needsProduct ? ev.code : u.product,
      user:  (!noSeller && (u.needsEmployee || reassign)) ? origin.user : u.employee,
      wasUser: reassign ? u.employee : '',
      price: ev.price ?? String(u.charge),
      from:  ev.from  ?? u.arr,
      to:    ev.to    ?? u.dep,
    };
  });

  _pkgApplyVerdicts(results);
  _pkgApplyMemory(results);        // a package continuing from an earlier month keeps its seller (before the extension rule, which builds on it)
  _pkgApplyExtensionCredit(results);
  _pkgFlagSplitSellers(results);   // after credit is settled — it compares final sellers
  _pkgDropNoOpReassigns(results);  // nothing that needs no change stays on the list
  _pkgApplyPins(results);          // last: a person's pinned decision beats the log
  return results;
}

// ── Pins: decisions a person made that the audit must remember ──────────
// "This breakfast is Lina's sale even though Sam typed it into Opera",
// or "stop showing me this one". Saved per package (confirmation + package
// family), shared with the team, applied on every load.
let pkgPins = {};
const PKG_PIN_KEY = 'pkg_pins_v1';
try { pkgPins = _pkgClean(JSON.parse(localStorage.getItem(PKG_PIN_KEY) || '{}')); } catch (_) { pkgPins = {}; }
function _pkgPinKey(r) { return `${String(r.conf || '').trim()}|${_pkgFamilyName(r)}`.replace(/[.#$\[\]\/]/g, '_'); }

function _pkgApplyPins(results) {
  results.forEach(r => {
    let pin = pkgPins[_pkgPinKey(r)];
    // No pin of its own: a rule learned from earlier decisions (accepted by a person) decides the same way.
    if (!pin) { const L = typeof _pkgLearnedFor === 'function' ? _pkgLearnedFor(r) : null; if (L) { pin = L.pin; r.learned = L.rule; _pkgHit(r, 'learned'); } }
    r.pin = pin || null;
    if (!('prePinUser' in r)) { r.prePinUser = r.user; r.prePinVerdict = r.verdict; }
    if (!pin) return;
    _pkgHit(r, 'pin');
    if (pin.skip) { r.pinSkip = true; return; }
    if (pin.manual) {
      // Sold by hand in IN-Gauge (e.g. a 6 pm late checkout that cannot be
      // added as an Opera package): there is nothing in Opera to match, so the
      // person's word stands. Keep it credited, never flag it again.
      if (r.verdict === 'settled') return;
      r.verdict = 'credit';
      r.manualSale = true;
      r.denyReason = ''; r.splitSeller = false; r.needsProduct = false;
      const seller = pin.seller || r.employee;
      r.user = seller;
      r.needsEmployee = !seller || seller === '-';
      r.reassign = !!pin.seller && !!r.employee && r.employee !== '-' && !_pkgSameUser(r.employee, pin.seller);
      r.wasUser = r.reassign ? r.employee : '';
      r.alreadyComplete = !r.reassign && !r.needsEmployee;
      if (!r.price) r.price = String(r.charge ?? '');
      return;
    }
    if (pin.seller && (r.verdict === 'credit' || r.verdict === 'review')) {
      r.verdict = 'credit';
      r.splitSeller = false;
      r.user = pin.seller;
      r.reassign = !!r.employee && r.employee !== '-' && !_pkgSameUser(r.employee, pin.seller);
      r.needsEmployee = !r.employee || r.employee === '-';
      r.alreadyComplete = !r.reassign && !r.needsEmployee && !r.needsProduct;
      r.wasUser = r.reassign ? r.employee : '';
    }
  });
}

/** Save only the entries that changed since the server's last copy (pkgPins/<key>), never the
 *  whole map: two people pinning at once kept overwriting each other. Undo works the same way. */
function _pkgSaveDiff(path, cur, last) {
  if (typeof fbUpdate !== 'function') return;
  const patch = {};
  new Set([...Object.keys(cur), ...Object.keys(last)]).forEach(k => {
    const a = cur[k] == null ? null : JSON.stringify(cur[k]);
    if (a !== (last[k] == null ? null : last[k])) { patch[k] = cur[k] == null ? null : cur[k]; if (a == null) delete last[k]; else last[k] = a; }
  });
  if (Object.keys(patch).length) fbUpdate(path, patch);
}
const _pkgPinsLast = {}, _pkgDoneLast = {};
const _pkgRemember = (last, v) => { Object.keys(last).forEach(k => delete last[k]); Object.keys(v || {}).forEach(k => { last[k] = JSON.stringify(v[k]); }); };
function _pkgSavePins() {
  try { localStorage.setItem(PKG_PIN_KEY, JSON.stringify(pkgPins)); } catch (_) {}
  _pkgSaveDiff('pkgPins', pkgPins, _pkgPinsLast);
}

// ── Freeze seller (pins) ─────────────────────────────────────
// A pin is a person's decision the audit must remember: "this package is
// Sam's", "sold by hand in IN-Gauge" or "skip it". Saved per package
// (confirmation + package family), shared with the team, applied on every run.
function pkgPinChange(key, val) {
  const rows = _pkgGroupRows(key), r = rows[0];
  if (!r && val !== '__clear') return;
  const by = _pkgMe(), at = new Date().toISOString();
  // The package code and IN-Gauge product go with the pin, so the same decision can be learned for that code.
  const tag = p => { if (p && r) { const c = (r.matchedEvent && r.matchedEvent.code) || (r.needsProduct ? '' : '') || r.code || ''; if (c) p.code = String(c); if (r.product) p.product = String(r.product); } return p; };
  if (val === '__clear') delete pkgPins[key];
  else if (val === '__skip') pkgPins[key] = { skip: true, by, at };
  else if (val === '__manual') pkgPins[key] = { manual: true, by, at };
  else if (val.startsWith('__manual:')) pkgPins[key] = { manual: true, seller: val.slice(9), by, at };
  else if (val === '__other') {
    const name = (prompt('Seller name (as in IN-Gauge):') || '').trim();
    if (!name) { pkgRender(); return; }
    pkgPins[key] = { seller: name, by, at };
  } else if (val) pkgPins[key] = { seller: val, by, at };
  else { pkgRender(); return; }
  if (pkgPins[key]) tag(pkgPins[key]);
  _pkgSavePins();
  if (typeof logActivity === 'function') {
    const p = pkgPins[key];
    const what = !p ? 'unfrozen' : p.skip ? 'skipped' : p.manual ? `manual sale${p.seller ? ' · ' + p.seller : ''}` : `frozen to ${p.seller}`;
    logActivity('pkg_pin', `Conf ${String(key).split('|')[0]} · ${r ? 'room ' + (r.room || '?') + ' · ' : ''}${String(key).split('|')[1] || ''} → ${what}`);
  }
  _pkgRecompute();
  try { if (pkgResults.length) _pkgMemorize(pkgResults); } catch (_) {}
  if (_pkgView === 'rules') pkgRulesRender();
  showToast(val === '__clear' ? 'Unfrozen: the rules decide this package again' : 'Saved for the team: remembered on every run', 'ok');
}

/** The names a seller can be frozen to: the team list, plus everyone this audit already credits. */
function _pkgSellerChoices(extra) {
  // People who have left keep their old sales, but are not offered for new ones.
  const gone = n => !!PKG_STAFF_LEFT[n];
  const out = PKG_STAFF.filter(n => !gone(n));
  const add = n => { n = String(n || '').trim(); if (n && n !== '-' && !gone(n) && !out.some(x => x === n || _pkgSameUser(x, n))) out.push(n); };
  (pkgResults || []).forEach(r => { [r.user, r.employee].forEach(u => { if (u && !_pkgIsSystemLogin(u)) add(_pkgUserLabel(u)); }); });
  (extra || []).forEach(n => { n = String(n || '').trim(); if (n && !out.includes(n)) out.push(n); });   // the current pin, even for someone who left
  return out.sort((a, b) => a.localeCompare(b));
}

function _pkgPinPicker(r, key) {
  const cur = r.pin ? (r.pin.skip ? '__skip' : r.pin.manual ? (r.pin.seller ? '__manual:' + r.pin.seller : '__manual') : r.pin.seller) : '';
  const staff = _pkgSellerChoices(r.pin && r.pin.seller ? [r.pin.seller] : []);
  const J = v => escapeHtml(JSON.stringify(v));
  const title = r.pin ? `Frozen by ${r.pin.by || 'someone'}${r.pin.at ? ' · ' + r.pin.at.slice(0, 10) : ''}` : 'Freeze the seller of this package: the rules will not change it again';
  return `<label class="pa-pin${r.pin ? ' on' : ''}" title="${escapeHtml(title)}"><span>${r.pin ? (r.learned ? '🧠 ' : '') + (r.pin.skip ? '🙈 Skipped' : r.pin.manual ? '✍️ Manual' : '📌 Frozen') : '📌 Freeze seller'}</span>
    <select aria-label="Freeze seller" onchange="pkgPinChange(${J(key)}, this.value)">
    <option value="">${r.pin ? 'Frozen…' : 'Freeze seller…'}</option>
    <optgroup label="Freeze the seller to">${staff.map(n => `<option value="${escapeHtml(n)}"${cur === n ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('')}
    <option value="__other">Someone else…</option></optgroup>
    <optgroup label="Sold by hand in IN-Gauge (not in Opera)">
      <option value="__manual"${cur === '__manual' ? ' selected' : ''}>✍️ Manual sale: keep the IN-Gauge seller</option>
      ${staff.map(n => `<option value="__manual:${escapeHtml(n)}"${cur === '__manual:' + n ? ' selected' : ''}>✍️ Manual sale: ${escapeHtml(n)}</option>`).join('')}
    </optgroup>
    <option value="__skip"${cur === '__skip' ? ' selected' : ''}>🙈 Skip this package</option>
    ${r.pin && !r.learned ? '<option value="__clear">Unfreeze</option>' : ''}
  </select></label>`;
}

/** A map from the database with any null / broken entries left out. */
function _pkgClean(v) { const o = {}; if (v && typeof v === 'object') Object.keys(v).forEach(k => { if (v[k] && typeof v[k] === 'object') o[k] = v[k]; }); return o; }
function pkgLoadPins() {
  if (typeof fbListen !== 'function') return;
  fbListen('pkgPins', v => {
    const next = _pkgClean(v);   // nothing pinned arrives as null: empty, not "keep the old"
    const same = JSON.stringify(next) === JSON.stringify(pkgPins);
    pkgPins = next;
    _pkgRemember(_pkgPinsLast, pkgPins);
    try { localStorage.setItem(PKG_PIN_KEY, JSON.stringify(pkgPins)); } catch (_) {}
    if (!same && pkgResults.length) _pkgRecompute();   // a teammate froze or unfroze one
  });
}
document.addEventListener('DOMContentLoaded', () => setTimeout(pkgLoadPins, 1500));

// The log is exported for a fixed span, so a charge dated after it can
// never match — that is a stale report, not a missing record, and saying so
// stops the reader hunting in Opera for something that was never exported.
function _pkgRenderCoverage() {
  const box = document.getElementById('pkgCoverageWarn');
  if (!box) return;
  const outside = pkgResults.filter(r => r.verdict === 'outside');
  if (!outside.length || !pkgLogRange.max) { box.style.display = 'none'; return; }

  const late   = outside.filter(r => _pkgDayNum(r.daily) > pkgLogRange.max).length;
  const early  = outside.length - late;
  // Packages are sold when the booking is made, so the log has to start
  // before the earliest stay in the export — not on the 1st of the month.
  const arrivals = pkgUnknowns.map(u => _pkgDayNum(u.arr)).filter(Boolean);
  const firstArr = arrivals.length ? Math.min(...arrivals) : 0;

  const bits = [];
  if (early) bits.push(`<b>${early}</b> sold before it starts (${escapeHtml(_pkgDayLabel(pkgLogRange.min))})`);
  if (late)  bits.push(`<b>${late}</b> charged after it ends (${escapeHtml(_pkgDayLabel(pkgLogRange.max))}): the night audit hasn't reached those yet`);

  box.style.display = 'block';
  box.innerHTML = `⏳ <b>${outside.length} charge${outside.length !== 1 ? 's' : ''} sit outside this log</b>: ${bits.join(', and ')}.
    They're not in the list because no amount of checking resolves them here.
    ${early ? `A package is usually added when the booking is made, which can be weeks before the stay: the earliest arrival in this export is
    <b>${escapeHtml(_pkgDayLabel(firstArr))}</b>, so run the Changes Log from before that date (not from the 1st) and include
    <b>New Reservation</b> as well as Update Reservation.` : ''}`;
}

// Plain-language instruction for the row: what the person reading this
// actually has to go and do, rather than which field happened to be blank.
function _pkgActionText(r) {
  // Reviewing settles who earned a sale, not whether the charge is sound.
  // So the factual checks run first and the stamp is added to whatever they
  // find — a decision made on bad information should be visible, not hidden.
  const seen = r.reviewed;
  if (r.pinSkip) return 'Skipped (frozen)';
  if (r.manualSale) {
    if (r.needsEmployee) return 'Manual sale: set the seller in IN-Gauge';
    if (r.reassign) return `Manual sale: set the seller to ${_pkgUserLabel(r.user)}`;
    return `Nothing: manual sale kept (${_pkgUserLabel(r.user)})`;
  }
  if (r.pin && r.pin.seller && r.verdict === 'credit') {
    if (r.needsEmployee) return `Set the seller to ${_pkgUserLabel(r.pin.seller)} (frozen)`;
    if (r.reassign) return `Set the seller to ${_pkgUserLabel(r.pin.seller)} (frozen)`;
    if (r.needsProduct) return 'Set the package (seller frozen)';
    return `Nothing: frozen to ${_pkgUserLabel(r.pin.seller)}`;
  }
  if (r.verdict === 'settled') return 'Nothing: already denied';
  if (r.verdict === 'deny')    return seen ? 'Reviewed, but still remove this charge' : 'Remove this charge';
  if (r.verdict === 'outside') return 'Not in this log';
  if (r.verdict === 'review') {
    if (r.splitSeller) return seen ? 'Reviewed, but still split between two sellers' : 'Split: pick one seller';
    return seen ? 'Reviewed, but still needs checking in Opera' : 'Check in Opera';
  }
  // Came in through TARS or another interface — no one sold it.
  if (r.noSeller) return r.needsEmployee ? 'No seller: booked by system' : 'Nothing: booked by system';
  if (r.needsProduct && r.needsEmployee) return seen ? 'Reviewed, but package + seller still blank' : 'Set package + seller';
  if (r.needsProduct) return seen ? 'Reviewed, but package still blank' : 'Set the package';
  if (r.needsEmployee) return seen ? 'Reviewed, but seller still blank' : 'Set the seller';
  if (seen) return 'Nothing: you already reviewed it';
  if (r.reassign) return r.extendedFrom ? `Same stay as ${r.extendedFrom}: credit the first seller` : 'Change the seller';
  return 'Nothing: already correct';
}

// ═══════════════════════════════════════════════════════════
//  Fixed packages — ONE list, a smart "done"
//
//  Copying a confirmation number is how a package gets fixed in IN-Gauge,
//  so copying it IS "I fixed it", for every night of that package. It leaves
//  the list at once (Undo for a few seconds) and waits for proof:
//   • a newer IN-Gauge report shows it right   → confirmed ✓ (saved: ok)
//   • a newer IN-Gauge report still shows it wrong → it comes back, on top,
//     tagged with the nights still wrong
//   • no newer report loaded yet (the same old file again) → it stays away.
//  pkgDone[key] = { by, at, conf, room, fam, n, dl, seller, was, tries, ok }
//  Older entries ({by, at, nights:true, days:{night:{by,at}}}) are read as
//  "fixed at the latest of those times": nothing is rewritten or lost.
// ═══════════════════════════════════════════════════════════
let pkgDone = {};
const PKG_DONE_KEY = 'pkg_done_v1', PKG_DONE_DAYS = 45;   // the default; Settings → Keep fixed packages for
const _pkgDoneDays = () => Math.max(7, +(typeof _pkgSetting === 'function' && _pkgSetting('doneDays')) || PKG_DONE_DAYS);
try { pkgDone = _pkgClean(JSON.parse(localStorage.getItem(PKG_DONE_KEY) || '{}')); } catch (_) { pkgDone = {}; }
// When the loaded IN-Gauge export was saved (its file time): a fix is only
// proven or disproven by a report saved AFTER it.
let pkgReportAt = 0;
const _pkgMe = () => (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || '';

let _pkgKeyCache = { src: null, n: -1, map: new Map() };
function _pkgGroupRows(key) {
  const src = pkgResults;
  if (_pkgKeyCache.src !== src || _pkgKeyCache.n !== src.length) {
    const map = new Map();
    src.forEach(x => { const k = _pkgPinKey(x); if (!map.has(k)) map.set(k, []); map.get(k).push(x); });
    _pkgKeyCache = { src, n: src.length, map };
  }
  return _pkgKeyCache.map.get(key) || [];
}
function _pkgNeeds(r) { return !r.pinSkip && (r.verdict === 'deny' || r.verdict === 'review' || (r.verdict === 'credit' && !r.alreadyComplete)); }
/** When this package was marked fixed (old entries: the latest tick). */
function _pkgFixedAt(d) {
  if (!d) return 0;
  let t = Date.parse(d.at) || 0;
  if (d.days && typeof d.days === 'object') Object.values(d.days).forEach(n => { const x = Date.parse(n && n.at) || 0; if (x > t) t = x; });
  return t;
}
function _pkgNewerReport(d) { return pkgReportAt > 0 && pkgReportAt > _pkgFixedAt(d) + 60e3; }
/** Marked fixed, but an IN-Gauge report saved after that still shows this night wrong. */
function pkgBackWrong(r) { const d = pkgDone[_pkgPinKey(r)]; return !!d && _pkgNeeds(r) && _pkgNewerReport(d); }
/** This night was fixed (copied) and nothing newer says otherwise. */
function pkgNightDone(r) { return !!pkgDone[_pkgPinKey(r)] && !pkgBackWrong(r); }
function pkgIsDone(r) { return pkgNightDone(r); }
function pkgIsCopied(r) { return !!pkgDone[_pkgPinKey(r)]; }
/** back · confirmed · waiting · gone (a newer report no longer has it) */
function _pkgDoneState(key) {
  const d = pkgDone[key]; if (!d) return '';
  const rows = _pkgGroupRows(key);
  if (_pkgNewerReport(d)) {
    if (!rows.length) return d.ok ? 'confirmed' : 'gone';
    return rows.some(_pkgNeeds) ? 'back' : 'confirmed';
  }
  return d.ok ? 'confirmed' : 'waiting';
}
function _pkgSaveDone() {
  const cut = Date.now() - _pkgDoneDays() * 86400e3;
  Object.keys(pkgDone).forEach(k => { if (!(_pkgFixedAt(pkgDone[k]) > cut)) delete pkgDone[k]; });
  try { localStorage.setItem(PKG_DONE_KEY, JSON.stringify(pkgDone)); } catch (_) {}
  _pkgSaveDiff('pkgDone', pkgDone, _pkgDoneLast);
}
function pkgLoadDone() {
  if (typeof fbListen !== 'function') return;
  fbListen('pkgDone', v => {
    pkgDone = _pkgClean(v);
    _pkgRemember(_pkgDoneLast, pkgDone);
    try { localStorage.setItem(PKG_DONE_KEY, JSON.stringify(pkgDone)); } catch (_) {}
    if (pkgResults.length && document.getElementById('pkgResultsWrap')?.style.display !== 'none') pkgRender();
  });
}
document.addEventListener('DOMContentLoaded', () => setTimeout(pkgLoadDone, 1500));

/** After a run: every fix this (newer) report shows right is confirmed, for the whole team. */
function _pkgConfirmSweep() {
  let n = 0;
  Object.keys(pkgDone).forEach(k => {
    const d = pkgDone[k];
    if (d.ok || _pkgDoneState(k) !== 'confirmed') return;
    pkgDone[k] = Object.assign({}, d, { ok: new Date(pkgReportAt).toISOString() });
    n++;
  });
  if (n) _pkgSaveDone();
  return n;
}

const _pkgD = n => { const s = String(n || ''); return s.length === 8 ? `${+s.slice(6, 8)} ${_PKG_MON[+s.slice(4, 6) - 1] || ''}` : ''; };
/** "12–14 Oct, 18 Oct" for a set of nights. */
function _pkgNightsText(rows, joinAnd) {
  const days = [...new Set(rows.map(r => _pkgDayNum(r.daily) || _pkgDayNum(r.from)).filter(Boolean))].sort();
  if (!days.length) return rows.length ? `${rows.length} night${rows.length > 1 ? 's' : ''}` : '';
  if (joinAnd && days.length <= 3) {
    const lbl = days.map(_pkgD);
    const sameMon = days.every(d => String(d).slice(0, 6) === String(days[0]).slice(0, 6));
    const parts = sameMon ? days.map(d => String(+String(d).slice(6, 8))) : lbl;
    if (sameMon) parts[parts.length - 1] = lbl[lbl.length - 1];
    return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' & ' + parts[parts.length - 1] : parts[0];
  }
  const runs = [];
  days.forEach(d => { const last = runs[runs.length - 1]; if (last && _pkgDaysBetween(last[1], d) === 1) last[1] = d; else runs.push([d, d]); });
  return runs.map(([a, b]) => a === b ? _pkgD(a) : (String(a).slice(0, 6) === String(b).slice(0, 6) ? `${+String(a).slice(6, 8)}–${_pkgD(b)}` : `${_pkgD(a)} – ${_pkgD(b)}`)).join(', ');
}
function _pkgWhen(t) {
  const d = new Date(t || 0); if (isNaN(d) || !t) return '';
  const today = new Date().toDateString() === d.toDateString();
  return today ? 'today ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
               : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** Copy only copies (like the TD page): the package stays on the list until ✓ Fixed is pressed. */
function pkgCopyConf(btn, conf) {
  if (typeof copyToClipboard === 'function') copyToClipboard(String(conf));
  if (btn) { btn.classList.add('copied'); setTimeout(() => btn.classList.remove('copied'), 1400); }
}
/** One value chip: copy it; nothing is hidden or marked. */
function pkgCopyChip(btn) {
  const v = btn && btn.getAttribute('data-pkg-copy');
  if (v == null) return;
  if (typeof copyToClipboard === 'function') copyToClipboard(v);
  const old = btn.textContent;
  btn.textContent = 'copied'; btn.classList.add('copied');
  setTimeout(() => { btn.textContent = old; btn.classList.remove('copied'); }, 1200);
}
/** ✓ Fixed: done in IN-Gauge for every night of this package, for the whole team. It moves to
 *  "Fixed already" and stays there on later reports unless a NEWER report still shows it wrong. */
function pkgMarkFixed(btn, key) {
  const rows = _pkgGroupRows(key), need = rows.filter(_pkgNeeds);
  if (!rows.length) return;
  const conf = String(rows[0].conf || '');
  if (!need.length) { showToast('Nothing to fix on this package', 'ok'); return; }
  const prev = pkgDone[key] ? JSON.parse(JSON.stringify(pkgDone[key])) : null;
  const wasBack = prev && _pkgDoneState(key) === 'back';
  const r0 = need[0];
  pkgDone[key] = {
    by: _pkgMe(), at: new Date().toISOString(), conf: String(conf), room: String(r0.room || ''), fam: _pkgFamilyName(r0),
    n: need.length, dl: _pkgNightsText(need), act: _pkgActionText(r0),
    seller: r0.verdict === 'credit' ? _pkgUserLabel(r0.user) : '', was: _pkgUserLabel(r0.employee),
    tries: (prev && prev.tries || 0) + (wasBack ? 1 : 0),
  };
  _pkgSaveDone();
  const card = btn && btn.closest && btn.closest('.pa-card');
  const finish = () => pkgRender();
  if (card && pkgFilter_ === 'action' && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    card.style.maxHeight = card.scrollHeight + 'px';
    void card.offsetHeight;
    card.classList.add('pa-leaving');
    setTimeout(finish, 380);
  } else finish();
  try { _pkgMemoryNoteFixed(key); } catch (_) {}
  if (typeof logActivity === 'function') logActivity('pkg_fixed', `Conf ${conf} · ${_pkgFamilyName(r0)} · fixed in IN-Gauge`);
  const msg = `✓ ${conf} fixed (${need.length} night${need.length > 1 ? 's' : ''}): moved to Fixed already`;
  const undo = () => { if (prev) pkgDone[key] = prev; else delete pkgDone[key]; _pkgSaveDone(); pkgRender(); };
  if (typeof showUndoToast === 'function') showUndoToast(msg, undo); else showToast(msg, 'ok');
}
function pkgUndone(key) {
  if (!pkgDone[key]) return;
  const prev = pkgDone[key];
  delete pkgDone[key];
  _pkgSaveDone();
  pkgRender();
  if (typeof showUndoToast === 'function') showUndoToast('Back in the list', () => { pkgDone[key] = prev; _pkgSaveDone(); pkgRender(); });
}
/** A bulk copy (rows to update / to remove) holds every night of each package: all of them count as fixed. */
function _pkgCopiedMany(rows) {
  const keys = [...new Set(rows.filter(r => !pkgNightDone(r)).map(_pkgPinKey))];
  if (!keys.length) return;
  const snap = {}; keys.forEach(k => { snap[k] = pkgDone[k] ? JSON.parse(JSON.stringify(pkgDone[k])) : null; });
  keys.forEach(k => {
    const need = _pkgGroupRows(k).filter(_pkgNeeds), r0 = need[0] || _pkgGroupRows(k)[0] || {};
    pkgDone[k] = { by: _pkgMe(), at: new Date().toISOString(), conf: String(r0.conf || ''), room: String(r0.room || ''), fam: _pkgFamilyName(r0),
      n: need.length, dl: _pkgNightsText(need), act: _pkgActionText(r0), seller: r0.verdict === 'credit' ? _pkgUserLabel(r0.user) : '', was: _pkgUserLabel(r0.employee),
      tries: (snap[k] && snap[k].tries) || 0 };
  });
  _pkgSaveDone();
  pkgRender();
  const n = keys.length;
  const undo = () => { keys.forEach(k => { if (snap[k]) pkgDone[k] = snap[k]; else delete pkgDone[k]; }); _pkgSaveDone(); pkgRender(); };
  if (typeof showUndoToast === 'function') showUndoToast(`${n} package${n > 1 ? 's' : ''} marked fixed`, undo);
}

// ── The list ─────────────────────────────────────────────────
let pkgDoneOpen = false;
let pkgFixedOpen = false;
/** ✓ Mark all fixed: every package in the To fix list (Undo for a few seconds). */
function pkgMarkAllFixed() {
  const groups = _pkgAllGroups().filter(g => _pkgInView(g, 'action'));
  if (!groups.length) return;
  _pkgCopiedMany(groups.flatMap(g => g.rows));
  groups.forEach(g => { try { _pkgMemoryNoteFixed(g.key); } catch (_) {} });
}
const pkgWhyOpen = new Set();
function pkgToggleDoneList() { pkgDoneOpen = !pkgDoneOpen; pkgRender(); }
function pkgWhy(key) { if (pkgWhyOpen.has(key)) pkgWhyOpen.delete(key); else pkgWhyOpen.add(key); pkgRender(); }

const _PKG_VIEWS = [
  ['action', '🛠 To fix'], ['deny', '⛔ Remove'], ['review', '🔎 Check by hand'], ['pinned', '📌 Frozen'],
  ['outside', '⏳ Not in log'], ['complete', '✓ Nothing to do'], ['all', 'All'],
];
function _pkgInView(g, f) {
  const rows = g.rows, need = rows.filter(_pkgNeeds);
  if (f && f.startsWith('rule:')) return rows.some(r => (r.ruleHits || []).includes(f.slice(5)));
  switch (f) {
    case 'action':   return need.length > 0 && (!pkgDone[g.key] || rows.some(pkgBackWrong));
    case 'deny':     return rows.some(r => r.verdict === 'deny' && !r.pinSkip);
    case 'review':   return rows.some(r => r.verdict === 'review' && !r.pinSkip);
    case 'pinned':   return rows.some(r => r.pin);
    case 'outside':  return rows.some(r => r.verdict === 'outside');
    case 'complete': return !need.length && rows.some(r => r.verdict !== 'outside');
    default:         return true;
  }
}
function _pkgAllGroups() {
  const groups = [], gmap = new Map();
  pkgResults.forEach(r => {
    const k = _pkgPinKey(r);
    if (!gmap.has(k)) { const g = { key: k, rows: [] }; gmap.set(k, g); groups.push(g); }
    gmap.get(k).rows.push(r);
  });
  return groups;
}
function pkgSetFilter(f) { pkgFilter_ = f; pkgRender(); const l = document.getElementById('pkgList'); if (l && l.scrollIntoView && f.startsWith('rule:')) l.scrollIntoView({ block: 'start' }); }
function pkgSetSearch(val) { pkgSearch_ = val; pkgRender(); }

function pkgRender() {
  _pkgStyle2();
  const list = document.getElementById('pkgList');
  if (!list) return;
  const q = pkgSearch_.toLowerCase().trim();
  const all = _pkgAllGroups();
  const hay = g => g.rows.map(r => [r.conf, r.room, r.code, r.family, _pkgUserLabel(r.user), _pkgUserLabel(r.employee), _pkgActionText(r)].join(' ')).join(' ').toLowerCase();
  const counts = {};
  _PKG_VIEWS.forEach(([f]) => { counts[f] = all.filter(g => _pkgInView(g, f)).length; });
  let shown = all.filter(g => _pkgInView(g, pkgFilter_) && (!q || hay(g).includes(q)));
  const rank = g => { const n = g.rows.filter(_pkgNeeds); return g.rows.some(pkgBackWrong) ? 0 : n.some(r => r.verdict === 'deny') ? 1 : n.some(r => r.verdict === 'credit') ? 2 : n.length ? 3 : 4; };
  shown.sort((a, b) => rank(a) - rank(b) || String(a.rows[0].room).localeCompare(String(b.rows[0].room), undefined, { numeric: true }));

  // view chips
  const views = document.getElementById('pkgFilters');
  if (views) {
    const ruleF = pkgFilter_.startsWith('rule:') ? pkgFilter_.slice(5) : '';
    const ri = ruleF && PKG_RULE_INFO.find(x => x.k === ruleF);
    views.innerHTML = _PKG_VIEWS.map(([f, t]) => `<button type="button" class="pa-view${pkgFilter_ === f ? ' on' : ''}" onclick="pkgSetFilter('${f}')">${t} <span>${counts[f]}</span></button>`).join('')
      + (ruleF ? `<button type="button" class="pa-view on rule" onclick="pkgSetFilter('action')" title="Back to To fix">${ri ? ri.ico + ' ' : ''}Decided by: ${escapeHtml(ri ? ri.short : ruleF)} <span>${shown.length}</span> ✕</button>` : '');
  }

  // the done summary
  const sum = document.getElementById('pkgSummary');
  if (sum) sum.innerHTML = _pkgSummaryHtml();

  const left = counts.action;
  // Fixed packages stay visible (like the TD page): under "Fixed already", with Undo.
  const fixedG = pkgFilter_ === 'action' ? all.filter(g => pkgDone[g.key] && !g.rows.some(pkgBackWrong) && (!q || hay(g).includes(q))) : [];
  const fixedAll = all.filter(g => pkgDone[g.key] && !g.rows.some(pkgBackWrong)).length;
  const head = document.getElementById('pkgListHead');
  if (head) head.innerHTML = pkgFilter_ === 'action'
    ? `<span class="pa-count"><b>${left}</b> to fix <i>·</i> <b class="ok">${fixedAll}</b> fixed</span>
       <small>Copy the values you need with the small copy buttons, then press <b>✓ Fixed</b> when it is done in IN-Gauge.</small>
       ${left > 1 ? `<button type="button" class="pa-link" onclick="pkgMarkAllFixed()" title="Mark every package in this list fixed (Undo for a few seconds)">✓ Mark all ${left} fixed</button>` : ''}`
    : `<b>${shown.length}</b> package${shown.length !== 1 ? 's' : ''} <small>${escapeHtml((_PKG_VIEWS.find(v => v[0] === pkgFilter_) || [0, ''])[1])}</small>`;

  const fixedHtml = fixedG.length ? `<details class="pa-fixed" ${pkgFixedOpen ? 'open' : ''} ontoggle="pkgFixedOpen=this.open">
      <summary><span>✓ Fixed already <em>${fixedG.length}</em></span><small>marked fixed, so not a to-do even though this report may still show them. Undo puts one back.</small></summary>
      <div class="pa-list">${fixedG.map(g => _pkgCardHtml(g, true)).join('')}</div></details>` : '';
  list.innerHTML = (shown.length ? shown.map(g => _pkgCardHtml(g)).join('')
    : `<div class="pa-empty">${q ? 'No package matches your search.' : pkgFilter_ === 'action'
        ? `<b>✅ All fixed.</b><span>Nothing else needs a change in IN-Gauge${Object.keys(pkgDone).length ? '. Load the next IN-Gauge report to confirm the fixes' : ''}.</span>` : 'Nothing here.'}</div>`) + fixedHtml;
  try { pkgBoardRender(); } catch (e) { console.warn('[pkg board]', e); }
  if (_pkgView === 'rules') { try { pkgRulesRender(); } catch (e) { console.warn('[pkg rules]', e); } }
}

function _pkgSummaryHtml() {
  const keys = Object.keys(pkgDone);
  if (!keys.length) return `<div class="pa-sum muted">Tip: copy the values with their small copy buttons, then press ✓ Fixed when the package is done in IN-Gauge. It moves to Fixed already.</div>`;
  const st = {}; keys.forEach(k => { st[k] = _pkgDoneState(k); });
  const today = new Date().toDateString();
  const fixedToday = keys.filter(k => new Date(_pkgFixedAt(pkgDone[k])).toDateString() === today).length;
  const waiting = keys.filter(k => st[k] === 'waiting').length;
  const confirmed = keys.filter(k => st[k] === 'confirmed').length;
  const back = keys.filter(k => st[k] === 'back').length;
  const bits = [`<b class="ok">✓ ${fixedToday} fixed today</b>`];
  if (waiting) bits.push(`<span title="They come back only if a newer IN-Gauge report still shows them wrong">${waiting} waiting to be confirmed by the next IN-Gauge report</span>`);
  if (confirmed) bits.push(`<span class="ok">${confirmed} confirmed ✓</span>`);
  if (back) bits.push(`<span class="bad">↺ ${back} came back</span>`);
  let html = `<div class="pa-sum">${bits.join('<i>·</i>')}<button type="button" class="pa-link" onclick="pkgToggleDoneList()" aria-expanded="${pkgDoneOpen}">${pkgDoneOpen ? 'hide' : 'show'}</button></div>`;
  if (pkgDoneOpen) {
    const order = { back: 0, waiting: 1, confirmed: 2, gone: 3 };
    const ks = keys.sort((a, b) => (order[st[a]] - order[st[b]]) || (_pkgFixedAt(pkgDone[b]) - _pkgFixedAt(pkgDone[a])));
    const lbl = { back: ['bad', '↺ Came back'], waiting: ['wait', '⏳ Waiting'], confirmed: ['ok', '✓ Confirmed'], gone: ['muted', 'Not in this report'] };
    const J = v => escapeHtml(JSON.stringify(v));
    html += `<div class="pa-done-list">${ks.slice(0, 80).map(k => {
      const d = pkgDone[k], [conf, fam] = k.split('|'), rows = _pkgGroupRows(k), r0 = rows[0] || {};
      const [cls, txt] = lbl[st[k]] || ['muted', ''];
      return `<div class="pa-done-row"><span class="pa-room sm">${escapeHtml(d.room || r0.room || '—')}</span>
        <div class="pa-done-main"><b>${escapeHtml(d.fam || fam || '')}</b> <code>${escapeHtml(d.conf || conf)}</code>
          <small>${escapeHtml(d.by ? String(d.by).split(' ')[0] : 'Someone')} · ${escapeHtml(_pkgWhen(_pkgFixedAt(d)))}${d.dl ? ' · ' + escapeHtml(d.dl) : ''}${d.seller ? ' · → ' + escapeHtml(d.seller) : ''}</small></div>
        <span class="pa-chip ${cls}">${txt}</span>
        <button type="button" class="pa-undo" title="Not fixed: put it back in the list" onclick="pkgUndone(${J(k)})">↩ Undo</button></div>`;
    }).join('')}${ks.length > 80 ? `<div class="pa-more">and ${ks.length - 80} older</div>` : ''}</div>`;
  }
  return html;
}

/** The seller now (IN-Gauge) → the seller it should be, for a set of nights. */
function _pkgSellerLine(need) {
  const r0 = need[0];
  const now = [...new Set(need.map(r => (r.employee && r.employee !== '-') ? _pkgUserLabel(r.employee) : ''))];
  const nowTxt = now.map(n => n || 'nobody').join(' / ');
  if (r0.verdict === 'deny') return `<div class="pa-who"><div><small>In IN-Gauge now</small><b>${escapeHtml(nowTxt)}</b></div><span class="pa-arrow">→</span><div><small>Should be</small><b class="bad">Removed (denied)</b></div></div>`;
  if (r0.verdict === 'review') return `<div class="pa-who"><div><small>In IN-Gauge now</small><b>${escapeHtml(nowTxt)}</b></div><span class="pa-arrow">→</span><div><small>Should be</small><b class="warn">${r0.splitSeller ? 'One of: ' + escapeHtml(r0.splitSeller.join(' / ')) : 'Check by hand'}</b></div></div>`;
  const should = [...new Set(need.map(r => r.noSeller ? 'no seller (system)' : _pkgUserLabel(r.user) || 'nobody'))].join(' / ');
  const prod = need.some(r => r.needsProduct) ? `<div class="pa-prod">Package: set it to <b>${escapeHtml(_pkgFamilyName(r0) || r0.code || '?')}</b>${r0.code && r0.code !== _pkgFamilyName(r0) ? ` <code>${escapeHtml(r0.code)}</code>` : ''}</div>` : '';
  if (!need.some(r => r.reassign || r.needsEmployee)) return prod || '';
  return `<div class="pa-who"><div><small>In IN-Gauge now</small><b class="${now.every(n => !n) ? 'bad' : 'was'}">${escapeHtml(nowTxt)}</b></div><span class="pa-arrow">→</span><div><small>Should be</small><b class="ok">${escapeHtml(should)}</b></div></div>${prod}`;
}

/** One sentence: why this needs a change. The full story is under Why? */
function _pkgShortWhy(r) {
  if (r.pinSkip) return 'Skipped (frozen by ' + (r.pin && r.pin.by || 'someone') + ')';
  if (r.pin && (r.pin.seller || r.pin.manual)) return `Frozen by ${r.pin.by || 'someone'}${r.pin.at ? ' on ' + _pkgWhen(r.pin.at).replace(/ \d\d:\d\d$/, '') : ''}`;
  if (r.verdict === 'deny') return r.denyReason || '';
  if (r.verdict === 'review') return r.splitSeller ? `Split between ${r.splitSeller.join(' and ')}: one package, one stay, credited to more than one person` : (r.note || 'Opera has no clear entry for this package');
  if (r.verdict === 'outside') return r.note || '';
  if (r.noSeller) return 'It came with an online / TARS booking: nobody at the desk sold it';
  if (r.memoryNote) return r.memoryNote;
  if (r.extendedFrom) return `Same stay as booking ${r.extendedFrom} (back-to-back): ${_pkgUserLabel(r.user)} put this package on first`;
  const o = r.originEvent;
  if (o && (r.reassign || r.needsEmployee)) return `Opera shows ${_pkgUserLabel(o.user)} put it on first (${_pkgTs(o.ts)})`;
  if (r.needsProduct) return 'IN-Gauge did not recognise the package; Opera shows which one it is';
  return '';
}
function _pkgTs(ts) { const s = String(ts || ''); return s.length >= 12 ? `${+s.slice(6, 8)} ${_PKG_MON[+s.slice(4, 6) - 1]} ${s.slice(8, 10)}:${s.slice(10, 12)}` : '—'; }

/** The values the fix needs, each with its own copy button (copying never hides or marks anything).
 *  Which values and in which order is each person's own choice (Settings → My view). */
const PKG_CHIP_FIELDS = [
  ['conf', 'Conf. no.'], ['room', 'Room'], ['pkg', 'Package'], ['code', 'Code'], ['seller', 'Seller'],
  ['price', 'Price'], ['dates', 'Nights'], ['guest', 'Guest'],
];
function _pkgChipValues(rows, need) {
  const act = need.length ? need : rows, r0 = act[0] || {};
  const g = (typeof pkgGuests !== 'undefined' && pkgGuests[r0.conf]) || {};
  const sellerNeeded = need.some(r => r.reassign || r.needsEmployee) && r0.verdict === 'credit' && !r0.noSeller;
  const productNeeded = need.some(r => r.needsProduct);
  const price = r0.verdict === 'credit' ? (r0.price ?? r0.charge) : r0.charge;
  const nights = [...new Set(act.map(r => r.daily).filter(Boolean))];
  return {
    conf: String(r0.conf || ''),
    room: String(r0.room || ''),
    pkg: productNeeded || !need.length ? String(_pkgFamilyName(r0) || '') : '',
    code: (productNeeded || !need.length) && r0.code && r0.code !== _pkgFamilyName(r0) && !/unknown/i.test(r0.code) ? String(r0.code) : '',
    seller: sellerNeeded ? String(_pkgUserLabel(r0.user) || '') : '',
    price: price != null && price !== '' && +price ? String(Math.round(+price * 100) / 100) : '',
    dates: nights.length === 1 ? nights[0] : nights.length ? `${nights[0]} – ${nights[nights.length - 1]}` : '',
    guest: String(g.name || ''),
  };
}
function _pkgChipsHtml(rows, need) {
  const v = _pkgChipValues(rows, need), P = _pkgViewPrefs();
  const items = P.chips.filter(f => !P.hidden.includes(f) && v[f]);
  if (!items.length) return '';
  const lbl = f => (PKG_CHIP_FIELDS.find(x => x[0] === f) || [0, f])[1];
  return `<div class="pa-vals">${items.map(f => `<span class="pa-v${f === 'seller' ? ' em' : ''}"><small>${escapeHtml(lbl(f))}</small><code>${escapeHtml(v[f])}</code><button type="button" class="pa-cc" data-pkg-copy="${escapeHtml(v[f])}" title="Copy ${escapeHtml(lbl(f).toLowerCase())} (it stays on the list until you press ✓ Fixed)">copy</button></span>`).join('')}</div>`;
}

function _pkgCardHtml(g, inFixed) {
  const rows = g.rows, need = rows.filter(_pkgNeeds), act = need.length ? need : rows, r0 = act[0];
  const J = v => escapeHtml(JSON.stringify(v));
  const back = rows.filter(pkgBackWrong), state = pkgDone[g.key] ? _pkgDoneState(g.key) : '';
  const tone = back.length ? 'back' : r0.verdict === 'deny' ? 'deny' : r0.verdict === 'review' ? 'review' : need.length ? 'fix' : 'ok';
  const total = act.reduce((s, r) => s + (parseFloat(r.verdict === 'credit' ? (r.price ?? r.charge) : r.charge) || 0), 0);
  const acts = [...new Set(need.map(_pkgActionText))];
  const actTxt = need.length ? acts[0] : _pkgActionText(r0);
  const fam = _pkgFamilyName(r0) || r0.code || 'Package';
  const backTag = back.length ? (() => {
    const d = pkgDone[g.key];
    return `<div class="pa-back">↺ Came back: still wrong on ${escapeHtml(_pkgNightsText(back, true))}<small>Marked fixed ${escapeHtml(_pkgWhen(_pkgFixedAt(d)))}${d.by ? ' by ' + escapeHtml(String(d.by).split(' ')[0]) : ''}, but this newer IN-Gauge report still shows it wrong.</small></div>`;
  })() : '';
  const doneTag = !back.length && state ? `<span class="pa-chip ${state === 'confirmed' ? 'ok' : 'wait'}">${state === 'confirmed' ? '✓ Confirmed' : '⏳ Fixed, waiting'}</span>` : '';
  const whyOpen = pkgWhyOpen.has(g.key);
  const short = _pkgShortWhy(r0);
  const carry = rows.find(r => r.carriedFrom);
  const carryTag = carry ? `<button type="button" class="pa-carry" onclick="pkgMemoryOpen(${J(String(carry.carriedFrom.conf))})" title="Remembered from an earlier report: open its record">↪ continues from ${escapeHtml(_pkgMonShort(carry.carriedFrom.month))}${carry.carriedFrom.conf !== r0.conf ? ' · ' + escapeHtml(carry.carriedFrom.conf) : ''}</button>` : '';
  const learnTag = r0.learned ? `<span class="pa-chip">🧠 learned rule</span>` : '';
  const fixBtn = !need.length ? '' : (inFixed || (pkgDone[g.key] && !back.length))
    ? `<button type="button" class="pa-fix undo" onclick="pkgUndone(${J(g.key)})" title="Not fixed after all: back to the to-do list">↩ Undo</button>`
    : `<button type="button" class="pa-fix" onclick="pkgMarkFixed(this,${J(g.key)})" title="Done in IN-Gauge: it moves to Fixed already, for the whole team">✓ Fixed</button>`;
  return `<article class="pa-card t-${inFixed ? 'ok' : tone}${inFixed ? ' is-fixed' : ''}" data-key="${escapeHtml(g.key)}">
    ${backTag}
    <div class="pa-top">
      <span class="pa-room" title="Room">${escapeHtml(r0.room || '—')}</span>
      <div class="pa-pk"><b>${escapeHtml(fam)}</b><small>${act.length} night${act.length !== 1 ? 's' : ''} · ${escapeHtml(_pkgNightsText(act))}${total ? ' · AED ' + escapeHtml(String(Math.round(total * 100) / 100)) : ''}</small></div>
      <span class="pa-act">${escapeHtml(inFixed ? '✓ Fixed in IN-Gauge' : actTxt)}${!inFixed && acts.length > 1 ? ` <em>+${acts.length - 1}</em>` : ''}</span>${doneTag}
    </div>
    ${carryTag || learnTag ? `<div class="pa-tags">${carryTag}${learnTag}</div>` : ''}
    ${need.length && !inFixed ? _pkgSellerLine(need) : ''}
    ${short && !inFixed ? `<div class="pa-short">${escapeHtml(short)}</div>` : ''}
    ${_pkgChipsHtml(rows, need)}
    <div class="pa-foot">
      ${fixBtn}
      <button type="button" class="pa-btn${whyOpen ? ' on' : ''}" aria-expanded="${whyOpen}" onclick="pkgWhy(${J(g.key)})">Why?</button>
      ${_pkgPinPicker(r0, g.key)}
    </div>
    ${whyOpen ? `<div class="pa-whybox">${_pkgWhyHtml(g)}</div>` : ''}
  </article>`;
}

// ── Why? A step-by-step account of one package ───────────────
function _pkgWhyHtml(g) {
  const rows = g.rows, need = rows.filter(_pkgNeeds), r0 = (need[0] || rows[0]);
  const steps = [];
  const emp = [...new Set(rows.map(r => (r.employee && r.employee !== '-') ? _pkgUserLabel(r.employee) : 'nobody'))].join(' / ');
  steps.push(['📄', 'IN-Gauge', `${rows.length} night${rows.length > 1 ? 's' : ''} of ${_pkgFamilyName(r0) || r0.code} on booking ${r0.conf}, room ${r0.room || '?'}: ${_pkgNightsText(rows)}. Seller shown: <b>${escapeHtml(emp)}</b>${r0.status ? ` · status ${escapeHtml(r0.status)}` : ''}.`, true]);

  const ev = (r0.candidates || []).slice().sort((a, b) => a.ts - b.ts);
  if (!ev.length) {
    steps.push(['🧾', 'Opera log', `Nothing logged for this booking in the loaded log${pkgLogRange.max ? ` (it covers ${_pkgDayLabel(pkgLogRange.min)} → ${_pkgDayLabel(pkgLogRange.max)})` : ''}.`]);
  } else {
    const li = ev.map(e => {
      const tags = [];
      if (r0.originEvent === e || (r0.originEvent && r0.originEvent.ts === e.ts && r0.originEvent.code === e.code && r0.originEvent.user === e.user)) tags.push('<b class="ok">★ first person: gets it</b>');
      if (r0.matchedEvent && r0.matchedEvent.ts === e.ts && r0.matchedEvent.code === e.code && r0.matchedEvent.user === e.user) tags.push('matches the charge');
      if (_pkgIsSystemLogin(e.user)) tags.push('<span class="muted">online / system</span>');
      return `<li><span class="t">${escapeHtml(_pkgTs(e.ts))}</span> <b>${escapeHtml(_pkgUserLabel(e.user))}</b> ${escapeHtml(e.action === 'ADDED' ? 'added' : 'changed')} <code>${escapeHtml(e.code)}</code>${e.price ? ' · AED ' + escapeHtml(e.price) : ''}${tags.length ? ' · ' + tags.join(' · ') : ''}</li>`;
    }).join('');
    steps.push(['🧾', 'Opera log', `${ev.length} entr${ev.length > 1 ? 'ies' : 'y'} for this booking, oldest first:<ul>${li}</ul>`]);
  }

  if (r0.extendedFrom || r0.newKindOnExt) {
    const h = r0.extendedFrom || r0.newKindOnExt, head = _pkgBuildChains();
    const members = Object.keys(head).filter(c => head[c] === h)
      .sort((a, b) => (_pkgDayNum((pkgGuests[a] || {}).arr) || 0) - (_pkgDayNum((pkgGuests[b] || {}).arr) || 0));
    const li = members.map(c => {
      const gg = pkgGuests[c] || {}, e = (pkgEvents[c] || []).slice().sort((a, b) => a.ts - b.ts).find(x => !_pkgKindOfRow(r0) || _pkgKindOfCode(x.code) === _pkgKindOfRow(r0));
      return `<li${c === r0.conf ? ' class="me"' : ''}><code>${escapeHtml(c)}</code> room ${escapeHtml(gg.room || '?')} · ${escapeHtml(_pkgD(_pkgDayNum(gg.arr)))} → ${escapeHtml(_pkgD(_pkgDayNum(gg.dep)))}${e ? ` · ${escapeHtml(e.code)} first put by <b>${escapeHtml(_pkgUserLabel(e.user))}</b> (${escapeHtml(_pkgTs(e.ts))})` : ' · no such package'}${c === r0.conf ? ' · <i>this booking</i>' : ''}</li>`;
    }).join('');
    steps.push(['🔗', 'Same stay', r0.extendedFrom
      ? `The guest's bookings run back to back, so they are one stay:<ul>${li}</ul>The first person who put this kind of package on the stay keeps it.`
      : `This booking continues an earlier one, but this kind of package is new on it, so it is a new sale:<ul>${li}</ul>`]);
  }

  const mem = rows.find(r => r.carriedFrom);
  if (mem) {
    const c = mem.carriedFrom, rec = (pkgMemory[c.conf] || {})[c.kind] || {};
    const hist = Object.keys(rec.months || {}).sort().map(m => `${_pkgMonShort(m)}: ${escapeHtml((rec.months[m] || {}).seller || '?')} · ${(rec.months[m] || {}).n || 0} night${(rec.months[m] || {}).n === 1 ? '' : 's'}`).join(' · ');
    steps.push(['🧠', 'Remembered', `${escapeHtml(mem.memoryNote || 'This package continues from an earlier report.')}<br><small>Booking <code>${escapeHtml(c.conf)}</code> · ${escapeHtml(rec.code || '')} · ${escapeHtml(_pkgD(rec.from))} → ${escapeHtml(_pkgD(rec.to))} · decided by ${escapeHtml(_PKG_HOW[rec.how] || rec.how || '?')}${hist ? ' · ' + hist : ''}</small>
      <br><button type="button" class="pa-link" onclick="pkgMemoryOpen(${escapeHtml(JSON.stringify(String(c.conf)))})">Open the memory record ›</button>`]);
  }
  if (r0.learned) steps.push(['🧠', 'Learned rule', `${escapeHtml(_pkgLearnedText(r0.learned))}. Accepted by ${escapeHtml(r0.learned.by || 'someone')}.`]);
  const hits = [...new Set(rows.flatMap(r => r.ruleHits || []))];
  const ruleNames = hits.map(k => PKG_RULE_INFO.find(x => x.k === k)).filter(Boolean);
  if (ruleNames.length) steps.push(['⚙️', 'Rules used', ruleNames.map(x => `<span class="pa-rtag">${x.ico} ${escapeHtml(x.short)}</span>`).join(' ') + (hits.includes('pin') ? ' <span class="pa-rtag">📌 Frozen by a person</span>' : '')]);
  else if (hits.includes('pin')) steps.push(['⚙️', 'Rules used', '<span class="pa-rtag">📌 Frozen by a person</span>']);
  if (r0.pin) steps.push(['📌', 'Frozen', `${r0.pin.skip ? 'Skipped' : r0.pin.manual ? 'Manual sale' : 'Seller frozen to <b>' + escapeHtml(_pkgUserLabel(r0.pin.seller)) + '</b>'} by ${escapeHtml(r0.pin.by || 'someone')}${r0.pin.at ? ' on ' + escapeHtml(r0.pin.at.slice(0, 10)) : ''}. This beats the rules.`]);
  if (r0.reviewed) steps.push(['✅', 'Reviewed', 'Someone marked this REVIEWED in IN-Gauge, so the seller is left as it is.']);
  const d = pkgDone[g.key];
  if (d) steps.push(['🕓', 'Fixed', `Marked fixed by ${escapeHtml(d.by || 'someone')} ${escapeHtml(_pkgWhen(_pkgFixedAt(d)))}. ${{ back: 'This newer IN-Gauge report still shows it wrong.', confirmed: 'A newer IN-Gauge report confirms it ✓', waiting: 'Waiting for a newer IN-Gauge report to confirm it.', gone: 'The newer report no longer has it.' }[_pkgDoneState(g.key)] || ''}`]);

  // what to do
  const nights = _pkgNightsText(need.length ? need : rows);
  let todo;
  if (!need.length) todo = 'Nothing to change in IN-Gauge.';
  else if (r0.verdict === 'deny') todo = `Open booking <b>${escapeHtml(r0.conf)}</b> in IN-Gauge and deny the charge on ${escapeHtml(nights)}.`;
  else if (r0.verdict === 'review') todo = `Check booking <b>${escapeHtml(r0.conf)}</b> in Opera. When you know who sold it, freeze the seller here (📌), then fix IN-Gauge.`;
  else {
    const parts = [];
    if (need.some(r => r.needsProduct)) parts.push(`set the package to <b>${escapeHtml(_pkgFamilyName(r0))}</b>`);
    if (need.some(r => r.reassign || r.needsEmployee)) parts.push(`set the seller to <b>${escapeHtml(_pkgUserLabel(r0.user))}</b>`);
    todo = `Open booking <b>${escapeHtml(r0.conf)}</b> in IN-Gauge and on every night (${escapeHtml(nights)}) ${parts.join(' and ') || 'check the line'}. Then press ✓ Fixed here.`;
  }
  steps.push(['👉', 'What to do', todo]);
  return `<ol class="pa-steps">${steps.map(([i, t, b]) => `<li><span class="i">${i}</span><div><b>${t}</b><div>${b}</div></div></li>`).join('')}</ol>`;
}

// ── Copy resolved rows as TSV — Room / Conf / Product / Price / From / To / Sold By ──
// Who ran the audit and when. A deny list is a decision about someone's
// commission, and three weeks later "why was this removed?" needs an answer
// that does not depend on anyone remembering.
function _pkgAuditStamp() {
  const who = (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name)
    ? currentProfile.name
    : (typeof currentUser !== 'undefined' && currentUser && currentUser.email) ? currentUser.email : '';
  const when = new Date().toLocaleString('en-GB',
    { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  return { who, when };
}

// What Opera actually holds for this reservation, so the reason can be
// checked against the source rather than taken on trust.
function _pkgEvidence(r) {
  const c = r.candidates || [];
  if (!c.length) return 'Nothing logged in Opera for this confirmation';
  return c.map(e => `${e.code}${e.price ? ' @' + e.price : ''}${e.user ? ' by ' + _pkgUserLabel(e.user) : ''}`)
          .filter((v, i, a) => a.indexOf(v) === i).join('; ');
}

function pkgCopyResolved() {
  // Only rows that are valid to credit AND needed fixing — an already-correct
  // row has nothing to update, and a denied row must never be credited.
  const resolved = pkgResults.filter(r => r.verdict === 'credit' && !r.alreadyComplete && !r.pinSkip);
  if (!resolved.length) { showToast('No fixed rows to copy', 'err'); return; }
  const s = _pkgAuditStamp();
  const tsv = ['Room\tConfirmation No.\tProduct Code\tPrice (AED)\tFrom\tTo\tSold By\tCurrently Credited To\tWhy Changed\tAudited On\tAudited By']
    .concat(resolved.map(r => [r.room, r.conf, r.code, r.price, r.from || '', r.to || '', r.user, r.wasUser || '',
                               _pkgActionText(r), s.when, s.who]
      .map(v => String(v ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')))
    .join('\n');
  copyToClipboard(tsv, document.getElementById('pkgCopyBtn'), '📋 Copy rows to update');
  showToast(`${resolved.length} rows copied. Press ✓ Fixed on each package when it is done (or ✓ Mark all fixed).`, 'ok');
}

// ── Copy the deny list — the charges that should NOT be credited ──
function pkgCopyDeny() {
  const denied = pkgResults.filter(r => r.verdict === 'deny' && !r.pinSkip);
  if (!denied.length) { showToast('Nothing to deny: every charge is backed by Opera', 'ok'); return; }
  const s = _pkgAuditStamp();
  const tsv = ['Room\tConfirmation No.\tProduct\tCharge (AED)\tCharged Date\tWhy Deny\tWhat Opera Shows\tAudited On\tAudited By']
    .concat(denied.map(r => [r.room, r.conf, r.family || r.code, r.charge, r.daily || '',
                             r.denyReason, _pkgEvidence(r), s.when, s.who]
      // Tabs and newlines inside a reason would split the row into new columns.
      .map(v => String(v ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')))
    .join('\n');
  copyToClipboard(tsv, document.getElementById('pkgDenyBtn'), '⛔ Copy rows to remove');
  showToast(`${denied.length} rows copied. Press ✓ Fixed on each package when it is removed.`, 'ok');
}

function pkgClear() {
  pkgUnknowns = []; pkgEvents = {}; pkgDeleted = {}; pkgResults = []; pkgFilter_ = 'action'; pkgSearch_ = ''; pkgPdfFiles = []; pkgLogRange = { min: 0, max: 0 };
  pkgLastDiff = null;
  const ei = document.getElementById('pkgExcelFileInput'); if (ei) ei.value = '';
  const pi = document.getElementById('pkgPdfFileInput');   if (pi) pi.value = '';
  const el = document.getElementById('pkgExcelLabel'); if (el) el.textContent = 'Click to upload';
  const pl = document.getElementById('pkgPdfLabel');   if (pl) pl.textContent = 'Click to upload';
  const search = document.getElementById('pkgSearch'); if (search) search.value = '';
  document.getElementById('pkgResultsWrap').style.display = 'none';
  document.getElementById('pkgError').classList.remove('show');
  if (_pkgView === 'rules') pkgRulesRender();
}

// ═══════════════════════════════════════════════════════════
//  ⚙️ Rules — how the audit decides, in plain words, yours to change
//  • every rule as a card: what it does, a tiny example, a switch
//  • change one and the audit re-runs at once: "What changed" lists every
//    package that moved, before → after; Reset puts the defaults back
//  • 💡 suggestions from the loaded data; 📌 frozen packages; 👤 staff names
//  Rules: packageAudit/rules/<key> (only what differs from the default).
//  Staff: packageAudit/staff/<id> = { name, logins: [] }.
//  Owner, manager and supervisor may change them; everyone can read them.
// ═══════════════════════════════════════════════════════════
// Each rule is one yes/no question. "Yes" = the rule is on (for chainGap: 1 day).
// ex: a tiny example of what "Yes" does, as chips: '→' and '+' join, '⇒' leads to the result.
// more: shown under "More options". parent: only works when that rule is on.
const PKG_RULE_INFO = [
  { k: 'firstPerson', ico: '🥇', short: 'first person', t: 'The first person who put the package on gets it',
    q: 'Many people touched the package in Opera. Give it to the first person?',
    ex: ['Sam adds 🥐 · 3 Oct', '→', 'Lina changes dates · 5 Oct', '⇒', '🏆 Sam'],
    off: 'Now: whoever\'s Opera entry matches the price gets it.' },
  { k: 'familyMatch', ico: '🥐', short: 'same kind, new price', t: 'The same kind at another price is the same package', parent: 'firstPerson',
    q: 'Breakfast changes 30BB → 60BB. Still the same package?',
    ex: ['Sam · 🥐 30BB', '→', 'Lina · 🥐 60BB', '⇒', '🏆 Sam'],
    off: 'Now: a new price or season counts as a new package.' },
  { k: 'chain', ico: '🔗', short: 'extension (same stay)', t: 'Back-to-back bookings are one stay', needs: 'guests',
    q: 'Guest extends with a new confirmation number. Keep the first seller?',
    ex: ['Booking A · Sam · 🥐', '→', 'Booking B · Lina · 🥐', '⇒', '🏆 Sam'],
    off: 'Now: every confirmation number is its own sale.' },
  { k: 'sameKind', ico: '🧩', short: 'same kind only', t: 'Only the same kind of package carries over', parent: 'chain',
    q: 'On the extension, a different kind of package is sold. Is it a new sale?',
    ex: ['Booking A · Sam · 🥐', '→', 'Booking B · Lina · ⬆️ Upgrade', '⇒', '🏆 Lina'],
    off: 'Now: every package on the extension goes to the first seller of the stay.' },
  { k: 'memory', ico: '🧠', short: 'remembered from last month', t: 'A package continuing from an earlier month keeps its seller',
    q: 'The package started last month and the guest is still here. Keep last month\'s seller?',
    ex: ['Sep · Sam · 🥐', '→', 'Oct · same booking · 🥐', '⇒', '🏆 Sam'],
    off: 'Now: every month is checked on its own (sold before the log starts = not in log).' },
  { k: 'systemNoSeller', ico: '🌐', short: 'online / TARS = no seller', t: 'Online / TARS / system bookings have no desk seller',
    q: 'Booking came online (TARS). Give it to nobody?',
    ex: ['🌐 TARS · 🥐 with the booking', '⇒', '🚫 Nobody'],
    off: 'Now: the system account gets it like a person.' },
  { k: 'oneTime', ico: '⏰', short: 'once per stay', t: 'Early check-in and late check-out count once per stay',
    q: 'Early check-in charged on many nights. Count it once?',
    ex: ['⏰ Early check-in · 12, 13, 14 Oct', '⇒', '✓ 12 Oct · ⛔ 13, 14'],
    off: 'Now: every night is kept.' },
  { k: 'denyNoOpera', ico: '⛔', short: 'no such package in Opera', t: 'Remove a charge Opera does not show',
    q: 'Opera has no such package. Remove the charge?',
    ex: ['IN-Gauge · 🌙 Late check-out', '+', 'Opera · 🥐 only', '⇒', '⛔ Remove'],
    off: 'Now: these go to Check by hand.' },
  { k: 'chainSameRoom', ico: '🚪', short: 'same room only', t: 'Only when it is the same room', parent: 'chain', more: true,
    q: 'Guest moves to another room. Is it a new stay?',
    ex: ['Room 101 · Booking A', '→', 'Room 205 · Booking B', '⇒', '🆕 New stay'],
    off: 'Now: a room move is still the same stay.' },
  { k: 'chainGap', ico: '📅', short: 'one-night gap', t: 'Gap allowed between the bookings', parent: 'chain', more: true, opts: [[0, 'Same day'], [1, '1 day gap']],
    q: 'One night between the two bookings. Still the same stay?',
    ex: ['A ends 13 Oct', '→', '1 night away', '→', 'B starts 14 Oct', '⇒', '🔗 Same stay'],
    off: 'Now: booking B must start the day booking A ends.' },
  { k: 'exactCode', ico: '🏷️', short: 'exact code', t: 'Each package code is its own package', parent: 'sameKind', more: true,
    q: 'On an extension, are 30BB and 60BB two different packages?',
    ex: ['Booking A · Sam · 🥐 30BB', '→', 'Booking B · Lina · 🥐 60BB', '⇒', '🏆 Lina'],
    off: 'Now: every …BB is breakfast, so the first seller keeps it.' },
  { k: 'splitFlag', ico: '✂️', short: 'split sellers', t: 'One package with two sellers is flagged', more: true,
    q: 'One package has two sellers on different nights. Flag it?',
    ex: ['🥐 12 Oct · Sam', '+', '🥐 13–14 Oct · Lina', '⇒', '🔎 Check by hand'],
    off: 'Now: not flagged.' },
  { k: 'reviewedStops', ico: '✅', short: 'REVIEWED stops it', t: 'REVIEWED in IN-Gauge stops it being work', more: true,
    q: 'Row marked REVIEWED in IN-Gauge. Leave it alone?',
    ex: ['✅ REVIEWED by Lina', '⇒', '🙈 Not on the list again'],
    off: 'Now: reviewed rows are checked like any other.' },
];
let _pkgView = 'audit';
let pkgLastDiff = null;    // { label, list: [{key, conf, room, fam, nights, before, after}], at }
let pkgStaffDb = {};       // id -> { name, logins: [] }

// Shared settings (rules, team, kinds, report columns) are changed by an owner or manager, or by
// anyone whose role holds the "Edit the night checklist" power (Team → Roles & access) — by default
// supervisors too. Everyone can read them.
function _pkgCanEdit() {
  const p = typeof currentProfile !== 'undefined' && currentProfile;
  const r = p && p.role;
  if (r === 'owner' || r === 'manager') return true;
  if (!r) return false;
  try {
    const RR = typeof hoRoleRules !== 'undefined' ? hoRoleRules : (typeof window !== 'undefined' ? window.hoRoleRules : null);
    if (RR && typeof RR.can === 'function') return RR.can('canEditChecklist') === true;
  } catch (_) {}
  return r === 'supervisor';
}
function pkgShowView(v) {
  _pkgMountViews();
  _pkgView = ['rules', 'memory', 'settings'].includes(v) ? v : 'audit';
  const ids = { rules: 'pkgRulesView', memory: 'pkgMemoryView', settings: 'pkgSettingsView', audit: 'pkgMainView' };
  Object.entries(ids).forEach(([k, id]) => { const e = document.getElementById(id); if (e) e.hidden = k !== _pkgView; });
  const mu = document.getElementById('muView'); if (mu) mu.hidden = true;
  document.querySelectorAll('#pkgTabs [data-v]').forEach(b => { const on = b.dataset.v === _pkgView; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  _pkgStyle2(); _pkgStyle3(); _pkgStartRulesSync(); _pkgStartSettingsSync(); _pkgPrefsSync();
  if (_pkgView === 'rules') pkgRulesRender();
  if (_pkgView === 'memory') pkgMemoryRender();
  if (_pkgView === 'settings') pkgSettingsRender();
}

/** What each package comes out as: the seller, or Remove / Check by hand. */
function _pkgOutcome(r) {
  if (r.pinSkip) return 'skipped';
  if (r.verdict === 'deny') return '⛔ Remove';
  if (r.verdict === 'settled') return 'denied';
  if (r.verdict === 'review') return '🔎 Check by hand';
  if (r.verdict === 'outside') return 'not in log';
  if (r.noSeller) return 'no seller (system)';
  return _pkgUserLabel(r.user || r.employee) || 'nobody';
}
function _pkgDiff(before, after) {
  const by = new Map();
  after.forEach((r, i) => {
    const b = before[i]; if (!b) return;
    const x = _pkgOutcome(b), y = _pkgOutcome(r);
    if (x === y) return;
    const k = _pkgPinKey(r);
    if (!by.has(k)) by.set(k, { key: k, conf: r.conf, room: r.room, fam: _pkgFamilyName(r), rows: [], pairs: new Set() });
    const e = by.get(k); e.rows.push(r); e.pairs.add(x + ' → ' + y);
  });
  return [...by.values()].map(e => ({ key: e.key, conf: e.conf, room: e.room, fam: e.fam, nights: _pkgNightsText(e.rows), n: e.rows.length, change: [...e.pairs].join(' · ') }));
}
/** Re-run the audit on what is loaded (rules, pins or staff changed). Returns what changed. */
function _pkgRecompute() {
  if (!pkgUnknowns.length || !Object.keys(pkgEvents).length || !pkgResults.length) return null;
  const before = pkgResults;
  const after = _pkgCompute();
  pkgResults = after;
  const diff = _pkgDiff(before, after);
  _pkgRenderCoverage();
  pkgRender();
  return diff;
}

function pkgSetRule(k, v) {
  if (!_pkgCanEdit()) { showToast('Only a manager, supervisor or owner can change the rules', 'warn'); pkgRulesRender(); return; }
  if (!(k in PKG_RULE_DEFAULTS)) return;
  if (typeof PKG_RULE_DEFAULTS[k] === 'boolean') v = !!v; else v = +v || 0;
  const info = PKG_RULE_INFO.find(x => x.k === k);
  const sub = info && info.opts ? info : null;
  const name = info ? info.t : k;
  pkgRules[k] = v;
  try { localStorage.setItem('pkg_rules_v1', JSON.stringify(_pkgRulesStored())); } catch (_) {}
  if (typeof fbSet === 'function') fbSet('packageAudit/rules/' + k, v === PKG_RULE_DEFAULTS[k] ? null : v);
  if (typeof logActivity === 'function') logActivity('pkg_rule', `${name}: ${typeof v === 'boolean' ? (v ? 'on' : 'off') : v}`);
  const diff = _pkgRecompute();
  pkgLastDiff = diff ? { label: `${name}: ${typeof v === 'boolean' ? (v ? 'on' : 'off') : (sub && sub.opts ? (sub.opts.find(o => o[0] === v) || [0, v])[1] : v)}`, list: diff, at: Date.now() } : null;
  pkgRulesRender();
  showToast(diff ? `${diff.length} package${diff.length !== 1 ? 's' : ''} changed` : 'Saved for the team', 'ok');
}
function _pkgRulesStored() { const o = {}; Object.keys(PKG_RULE_DEFAULTS).forEach(k => { if (pkgRules[k] !== PKG_RULE_DEFAULTS[k]) o[k] = pkgRules[k]; }); return o; }
function pkgRulesReset() {
  if (!_pkgCanEdit()) return;
  const patch = {}; Object.keys(PKG_RULE_DEFAULTS).forEach(k => { patch[k] = null; });
  pkgRules = Object.assign({}, PKG_RULE_DEFAULTS);
  try { localStorage.setItem('pkg_rules_v1', '{}'); } catch (_) {}
  if (typeof fbUpdate === 'function') fbUpdate('packageAudit/rules', patch);
  if (typeof logActivity === 'function') logActivity('pkg_rule', 'Rules reset to default');
  const diff = _pkgRecompute();
  pkgLastDiff = diff ? { label: 'Reset to default', list: diff, at: Date.now() } : null;
  pkgRulesRender();
  showToast('Rules back to default', 'ok');
}

let _pkgRulesSync = false;
function _pkgStartRulesSync() {
  if (_pkgRulesSync || typeof fbListen !== 'function') return;
  _pkgRulesSync = true;
  fbListen('packageAudit/rules', v => {
    const next = Object.assign({}, PKG_RULE_DEFAULTS);
    if (v && typeof v === 'object') Object.keys(PKG_RULE_DEFAULTS).forEach(k => {
      if (v[k] == null) return;
      next[k] = typeof PKG_RULE_DEFAULTS[k] === 'boolean' ? !!v[k] : (+v[k] || 0);
    });
    if (JSON.stringify(next) === JSON.stringify(pkgRules)) return;
    pkgRules = next;
    try { localStorage.setItem('pkg_rules_v1', JSON.stringify(_pkgRulesStored())); } catch (_) {}
    const diff = _pkgRecompute();
    if (diff) pkgLastDiff = { label: 'The team changed the rules', list: diff, at: Date.now() };
    if (_pkgView === 'rules') pkgRulesRender();
  });
  fbListen('packageAudit/staff', v => {
    pkgStaffDb = _pkgClean(v);
    _pkgApplyStaff();
    if (pkgResults.length) _pkgRecompute();
    if (_pkgView === 'rules') pkgRulesRender();
  });
}
document.addEventListener('DOMContentLoaded', () => setTimeout(_pkgStartRulesSync, 1600));

// ── Staff names ──────────────────────────────────────────────
function _pkgLoginTok(l) { return _pkgUserKey(l).split('-').pop(); }
// packageAudit/staff/<id> = { name, logins: [], status: 'active'|'left', since, left, former: [{ name, until, by }] }
// (older entries are just { name, logins } and read as active).
function _pkgApplyStaff() {
  const list = Object.values(pkgStaffDb || {}).filter(s => s && s.name);
  PKG_STAFF = list.map(s => String(s.name)).sort((a, b) => a.localeCompare(b));
  PKG_STAFF_ALIASES = {}; PKG_STAFF_FORMER = {}; PKG_STAFF_LEFT = {};
  list.forEach(s => {
    const al = (Array.isArray(s.logins) ? s.logins : []).map(_pkgLoginTok).filter(a => a.length >= 3);
    if (al.length) PKG_STAFF_ALIASES[String(s.name)] = al;
    const olds = (Array.isArray(s.former) ? s.former : []).map(f => _pkgUserKey(f && f.name)).filter(Boolean);
    if (olds.length) PKG_STAFF_FORMER[String(s.name)] = olds;
    if (s.status === 'left') PKG_STAFF_LEFT[String(s.name)] = s.left || 'yes';
  });
}
const _pkgStaffId = name => String(name).trim().toLowerCase().replace(/[.#$\[\]\/\s]+/g, '_').slice(0, 60) || 'x';
/** "Sam ALVAREZ" · "Sam ALVAREZ = ACCOREN-SALVAREZ, SALVAREZ2" · "ACCOREN-SALVAREZ = Sam ALVAREZ" */
function _pkgParseStaffLine(line) {
  const s = String(line || '').trim(); if (!s) return null;
  let [a, b] = s.split(/\s*[=:→]\s*|\t/, 2).map(x => (x || '').trim());
  const looksLogin = x => x && !/\s/.test(x) && (/[-@]/.test(x) || x === x.toUpperCase());
  if (b && looksLogin(a) && !looksLogin(b)) [a, b] = [b, a];
  if (!a) return null;
  return { name: a, logins: (b || '').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean) };
}
function pkgStaffSeed() {
  if (!_pkgCanEdit()) return;
  if (Object.keys(pkgStaffDb).length) { showToast('The team list already exists: add or remove names one by one', 'warn'); return; }
  const ta = document.getElementById('pkgStaffSeed');
  const items = String(ta && ta.value || '').split(/\r?\n/).map(_pkgParseStaffLine).filter(Boolean);
  if (!items.length) { showToast('Type or paste at least one name', 'warn'); return; }
  const patch = {}; items.forEach(it => { patch[_pkgStaffId(it.name)] = it; });
  pkgStaffDb = Object.assign({}, patch);
  _pkgApplyStaff();
  if (typeof fbUpdate === 'function') fbUpdate('packageAudit/staff', patch);
  if (pkgResults.length) _pkgRecompute();
  pkgRulesRender();
  showToast(`${items.length} name${items.length > 1 ? 's' : ''} saved for the team`, 'ok');
}
function pkgStaffAdd() {
  if (!_pkgCanEdit()) return;
  const n = document.getElementById('pkgStaffName'), l = document.getElementById('pkgStaffLogins');
  const name = String(n && n.value || '').trim();
  if (!name) { showToast('Type the name as IN-Gauge shows it', 'warn'); return; }
  const id = _pkgStaffId(name), old = pkgStaffDb[id];
  const logins = [...new Set([...(old && old.logins || []), ...String(l && l.value || '').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean)])];
  const item = { name, logins };
  pkgStaffDb = Object.assign({}, pkgStaffDb, { [id]: item });
  _pkgApplyStaff();
  if (typeof fbSet === 'function') fbSet('packageAudit/staff/' + id, item);
  if (pkgResults.length) _pkgRecompute();
  pkgRulesRender();
  showToast(`${name} saved`, 'ok');
}
function pkgStaffDel(id) {
  if (!_pkgCanEdit() || !pkgStaffDb[id]) return;
  const prev = pkgStaffDb[id];
  const rest = Object.assign({}, pkgStaffDb); delete rest[id]; pkgStaffDb = rest;
  _pkgApplyStaff();
  if (typeof fbSet === 'function') fbSet('packageAudit/staff/' + id, null);
  if (pkgResults.length) _pkgRecompute();
  pkgRulesRender();
  if (typeof showUndoToast === 'function') showUndoToast(`${prev.name} removed`, () => {
    pkgStaffDb = Object.assign({}, pkgStaffDb, { [id]: prev }); _pkgApplyStaff();
    if (typeof fbSet === 'function') fbSet('packageAudit/staff/' + id, prev);
    if (pkgResults.length) _pkgRecompute(); pkgRulesRender();
  });
}
function pkgStaffPick(login) {
  const l = document.getElementById('pkgStaffLogins'), n = document.getElementById('pkgStaffName');
  if (l) l.value = login;
  if (n) { n.focus(); if (n.scrollIntoView) n.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
}
/** Opera logins in the loaded log that are people, but match no name in the team list. */
function _pkgUnknownLogins() {
  const seen = new Map();
  Object.values(pkgEvents || {}).forEach(list => list.forEach(e => {
    if (!e.user || _pkgIsSystemLogin(e.user)) return;
    const k = _pkgUserKey(e.user);
    if (!seen.has(k)) seen.set(k, 0);
    seen.set(k, seen.get(k) + 1);
  }));
  return [...seen.entries()].filter(([k]) => !_pkgStaffFor(k)).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ login: k, n }));
}

// ── Suggestions: what the loaded data says about the rules ───
function _pkgSuggestions() {
  const S = [];
  const loaded = pkgResults.length > 0;
  if (!loaded) S.push({ tone: 'idle', text: 'Load the three reports and check the charges to see how each rule decides your packages.', act: ['Go to the audit', "pkgShowView('audit')"] });
  const groups = loaded ? _pkgAllGroups() : [];
  const hit = k => groups.filter(g => g.rows.some(r => (r.ruleHits || []).includes(k))).length;
  const back = groups.filter(g => g.rows.some(pkgBackWrong)).length;
  if (back) S.push({ tone: 'bad', text: `${back} fixed package${back > 1 ? 's' : ''} came back: the newer IN-Gauge report still shows ${back > 1 ? 'them' : 'it'} wrong. They are on top of the list.`, act: ['Show them', "pkgShowView('audit');pkgSetFilter('action')"] });
  if (loaded && !Object.keys(pkgGuests).length) S.push({ tone: 'warn', text: 'No guest list loaded, so the extension rule (back-to-back bookings) is not used. Load Opera\'s Reservation Detail export.', act: ['Load it', "pkgShowView('audit');document.getElementById('pkgGuestFileInput').click()"] });
  const ch = hit('chain');
  if (ch) S.push({ tone: 'warn', text: `${ch} package${ch > 1 ? 's were' : ' was'} decided by the extension rule: the seller moved to whoever started the stay. Check ${ch > 1 ? 'them' : 'it'} once.`, act: ['Show them', "pkgShowView('audit');pkgSetFilter('rule:chain')"] });
  if (loaded) {
    const unk = _pkgUnknownLogins();
    if (!PKG_STAFF.length && !_pkgReportNames().length) S.push({ tone: 'warn', text: `Your team list is empty, so Opera logins show as they are (like CHAIN-SALVAREZ). Add your team in 🛠 Settings → Team.`, act: ['Add names', "pkgOpenStaff()"] });
    else if (unk.length) S.push({ tone: 'warn', text: `${unk.length} Opera login${unk.length > 1 ? 's don\'t' : ' doesn\'t'} match any staff name: ${unk.slice(0, 3).map(x => x.login).join(', ')}${unk.length > 3 ? '…' : ''}. Add ${unk.length > 1 ? 'them' : 'it'}.`, act: ['Add', "pkgOpenStaff()"] });
  }
  if (loaded && pkgLogRange.max) {
    const days = pkgUnknowns.map(u => _pkgDayNum(u.daily)).filter(Boolean);
    const last = days.length ? Math.max(...days) : 0;
    if (last > pkgLogRange.max) S.push({ tone: 'warn', text: `The Opera log covers ${_pkgDayLabel(pkgLogRange.min)} → ${_pkgDayLabel(pkgLogRange.max)}, but IN-Gauge has charges until ${_pkgDayLabel(last)}. Load the newer log.`, act: ['Load log', "pkgShowView('audit');document.getElementById('pkgPdfFileInput').click()"] });
    const arr = pkgUnknowns.map(u => _pkgDayNum(u.arr)).filter(Boolean);
    const first = arr.length ? Math.min(...arr) : 0;
    if (first && first < pkgLogRange.min && groups.some(g => g.rows.some(r => r.verdict === 'outside'))) S.push({ tone: 'idle', text: `Some stays began ${_pkgDayLabel(first)}, before the log starts (${_pkgDayLabel(pkgLogRange.min)}). Run the Changes Log from earlier to match them.` });
  }
  const rv = groups.filter(g => g.rows.some(r => r.verdict === 'review' && !r.pinSkip)).length;
  if (rv) S.push({ tone: 'warn', text: `${rv} package${rv > 1 ? 's need' : ' needs'} checking by hand. When you know the seller, freeze it (📌) so it never asks again.`, act: ['Show them', "pkgShowView('audit');pkgSetFilter('review')"] });
  const pinsOk = groups.filter(g => g.rows.some(r => r.pin && !r.learned && r.pin.seller && !r.pin.manual && r.prePinVerdict === 'credit' && _pkgSameUser(r.prePinUser, r.pin.seller)));
  if (pinsOk.length) S.push({ tone: 'idle', text: `${pinsOk.length} frozen package${pinsOk.length > 1 ? 's' : ''} now match${pinsOk.length > 1 ? '' : 'es'} the rules anyway. You can unfreeze ${pinsOk.length > 1 ? 'them' : 'it'}.`, act: ['Unfreeze', `pkgUnfreezeMany(${escapeHtml(JSON.stringify(pinsOk.map(g => g.key)))})`] });
  const mh = hit('memory');
  if (mh) S.push({ tone: 'idle', text: `${mh} package${mh > 1 ? 's continue' : ' continues'} from an earlier month: the seller was carried over from memory.`, act: ['Show them', "pkgShowView('audit');pkgSetFilter('rule:memory')"] });
  _pkgLearnSuggestions().slice(0, 3).forEach(L => S.push({ tone: 'warn', text: `🧠 ${L.text}. Do the same automatically next time?`, act: ['✓ Accept', `pkgLearnAccept(${escapeHtml(JSON.stringify(L.id))})`] }));
  const sys = hit('systemNoSeller');
  if (sys) S.push({ tone: 'idle', text: `${sys} package${sys > 1 ? 's' : ''} came with online / TARS bookings: no desk seller.`, act: ['Show them', "pkgShowView('audit');pkgSetFilter('rule:systemNoSeller')"] });
  const waiting = Object.keys(pkgDone).filter(k => _pkgDoneState(k) === 'waiting').length;
  if (waiting) S.push({ tone: 'idle', text: `${waiting} fixed package${waiting > 1 ? 's wait' : ' waits'} for a newer IN-Gauge report to confirm ${waiting > 1 ? 'them' : 'it'}.` });
  if (loaded && S.length === 0) S.push({ tone: 'ok', text: 'All good: nothing in this audit needs a rule change.' });
  return S;
}
function pkgUnfreezeMany(keys) {
  (keys || []).forEach(k => { delete pkgPins[k]; });
  _pkgSavePins();
  _pkgRecompute();
  pkgRulesRender();
  showToast(`${(keys || []).length} unfrozen`, 'ok');
}

// ── Rules view: questions, examples, try-a-confirmation ──────
const _pkgRulesOpen = new Set();   // which collapsible sections are open (kept across re-renders)
let _pkgSugAll = false;
let _pkgTryQ = '';
function _pkgSecToggle(id, open) { if (open) _pkgRulesOpen.add(id); else _pkgRulesOpen.delete(id); }
function _pkgRuleOn(k) { return k === 'chainGap' ? +_pkgRule(k) >= 1 : !!_pkgRule(k); }
function _pkgRuleDefOn(k) { return k === 'chainGap' ? +PKG_RULE_DEFAULTS[k] === 1 : !!PKG_RULE_DEFAULTS[k]; }
/** Answer a question: Yes / No. Saves through pkgSetRule (same save + instant re-run), then offers Undo. */
function pkgRuleAnswer(k, yes) {
  if (!_pkgCanEdit()) { showToast('Only managers can change rules', 'warn'); pkgRulesRender(); return; }
  if (_pkgRuleOn(k) === !!yes) return;
  const prev = _pkgRule(k);
  pkgSetRule(k, k === 'chainGap' ? (yes ? 1 : 0) : !!yes);
  const R = PKG_RULE_INFO.find(x => x.k === k);
  const label = `${R ? R.q : k} → ${yes ? 'Yes' : 'No'}`;
  pkgLastDiff = pkgLastDiff ? Object.assign(pkgLastDiff, { label }) : { label, list: null, at: Date.now() };
  pkgLastDiff.undo = { k, prev };
  pkgRulesRender();
}
function pkgRuleUndo() {
  const u = pkgLastDiff && pkgLastDiff.undo;
  if (!u || !_pkgCanEdit()) return;
  pkgSetRule(u.k, u.prev);
  if (pkgLastDiff) { pkgLastDiff.label = 'Undone: back to how it was'; delete pkgLastDiff.undo; }
  else pkgLastDiff = { label: 'Undone: back to how it was', list: null, at: Date.now() };
  pkgRulesRender();
}
function pkgOpenStaff() { pkgOpenSettings('team'); }
function pkgSugMore() { _pkgSugAll = !_pkgSugAll; pkgRulesRender(); }

/** The tiny example: chips joined by arrows, ending in the result. */
function _pkgExHtml(ex) {
  let res = false;
  return (ex || []).map(t => {
    if (t === '→' || t === '+') return `<span class="pr-arw" aria-hidden="true">${t}</span>`;
    if (t === '⇒') { res = true; return '<span class="pr-arw res" aria-hidden="true">⇒</span>'; }
    return `<span class="pr-tok${res ? ' win' : ''}">${escapeHtml(t)}</span>`;
  }).join('');
}

function _pkgQHtml(R, can, groups) {
  const on = _pkgRuleOn(R.k), def = _pkgRuleDefOn(R.k);
  const parentOff = R.parent && !_pkgRuleOn(R.parent);
  const pr = parentOff && PKG_RULE_INFO.find(x => x.k === R.parent);
  const dis = !can || parentOff;
  const n = groups.length ? groups.filter(g => g.rows.some(r => (r.ruleHits || []).includes(R.k))).length : 0;
  const needsGuests = R.needs === 'guests' && pkgResults.length && !Object.keys(pkgGuests).length;
  const btn = yes => {
    const sel = on === yes, rec = def === yes;
    return `<button type="button" class="pr-yn ${yes ? 'y' : 'n'}${sel ? ' on' : ''}" aria-pressed="${sel}" ${dis ? 'disabled' : ''} onclick="pkgRuleAnswer('${R.k}',${yes})">${yes ? 'Yes' : 'No'}${rec ? '<small>Recommended</small>' : ''}</button>`;
  };
  const notes = [];
  if (on !== def && R.off && !on) notes.push(R.off);
  if (parentOff) notes.push(`Works only when "${pr ? pr.q : R.parent}" is Yes.`);
  if (needsGuests) notes.push('Needs the guest list (Reservation Detail) loaded.');
  return `<article class="pr-q${parentOff ? ' dim' : ''}${on !== def ? ' changed' : ''}" data-k="${R.k}">
    <span class="pr-badge" aria-hidden="true">${R.ico}</span>
    <div class="pr-q-main">
      <h4>${escapeHtml(R.q)}</h4>
      <div class="pr-ex"><span class="pr-if">If yes</span>${_pkgExHtml(R.ex)}${n ? `<button type="button" class="pr-aff" onclick="pkgShowView('audit');pkgSetFilter('rule:${R.k}')" title="Show the packages this rule decided">affects <b>${n}</b> · see ›</button>` : ''}</div>
      ${notes.map(t => `<div class="pr-note">${escapeHtml(t)}</div>`).join('')}
    </div>
    <div class="pr-yns" role="group" aria-label="Answer">${btn(true)}${btn(false)}</div>
  </article>`;
}

/** 🔍 Try a confirmation: who gets it and why, in plain words. */
function pkgTryConf(v) {
  _pkgTryQ = String(v == null ? '' : v);
  const out = document.getElementById('pkgTryOut');
  if (out) out.innerHTML = _pkgTryHtml();
}
function _pkgTryHtml() {
  const q = _pkgTryQ.replace(/\s+/g, '');
  if (!q) return '';
  if (!pkgResults.length) return '<div class="pr-try-msg">Load the reports and check the charges first (📋 Audit), then try a number here.</div>';
  if (q.length < 4) return '';
  const groups = _pkgAllGroups().filter(g => g.rows.some(r => String(r.conf) === q));
  const near = groups.length ? groups : _pkgAllGroups().filter(g => g.rows.some(r => String(r.conf).includes(q))).slice(0, 3);
  if (!near.length) return `<div class="pr-try-msg">No package for <b>${escapeHtml(q)}</b> in this audit.</div>`;
  return near.map(g => {
    const rows = g.rows, need = rows.filter(_pkgNeeds), r0 = need[0] || rows[0];
    const fam = _pkgFamilyName(r0) || r0.code || 'Package';
    const who = _pkgOutcome(r0);
    const isPerson = !/^(⛔|🔎|skipped|denied|not in log|no seller|nobody)/.test(who);
    const head = isPerson ? `🏆 <b>${escapeHtml(who)}</b> gets it` : r0.noSeller ? '🚫 <b>Nobody</b> gets it (online / TARS)' : `<b>${escapeHtml(who)}</b>`;
    const why = _pkgShortWhy(r0);
    const open = pkgWhyOpen.has('try|' + g.key);
    return `<div class="pr-try-res">
      <div class="pr-try-top"><span class="pa-room sm">${escapeHtml(r0.room || '—')}</span><div><div class="pr-try-who">${head}</div><small>${escapeHtml(fam)} · <code>${escapeHtml(r0.conf)}</code> · ${escapeHtml(_pkgNightsText(rows))}</small></div></div>
      ${why ? `<div class="pr-try-why">Why: ${escapeHtml(why)}</div>` : ''}
      <button type="button" class="pr-link" aria-expanded="${open}" onclick="pkgWhyOpen.${open ? 'delete' : 'add'}(${escapeHtml(JSON.stringify('try|' + g.key))});pkgTryConf(_pkgTryQ)">${open ? 'Hide the steps' : 'Show every step'}</button>
      ${open ? `<div class="pa-whybox">${_pkgWhyHtml(g)}</div>` : ''}
    </div>`;
  }).join('');
}

function pkgRulesRender() {
  const box = document.getElementById('pkgRulesView');
  if (!box) return;
  _pkgStyle2();
  const can = _pkgCanEdit();
  const groups = pkgResults.length ? _pkgAllGroups() : [];
  const changed = Object.keys(PKG_RULE_DEFAULTS).filter(k => pkgRules[k] !== PKG_RULE_DEFAULTS[k]);
  const J = v => escapeHtml(JSON.stringify(v));
  const det = (id, title, count, body, extra) => `<details class="pr-sec" id="${id === 'staff' ? 'pkgStaffCard' : 'pkgSec_' + id}" ${_pkgRulesOpen.has(id) ? 'open' : ''} ontoggle="_pkgSecToggle('${id}',this.open)"${extra || ''}><summary><span class="pr-sec-t">${title}${count != null ? ` <em>${count}</em>` : ''}</span><span class="pr-chev" aria-hidden="true"></span></summary><div class="pr-sec-b">${body}</div></details>`;

  // keep focus + caret in the try box across re-renders
  const ae = document.activeElement, tryFocus = ae && ae.id === 'pkgTryIn', caret = tryFocus ? ae.selectionStart : 0;

  const steps = [['🧾', 'Opera', 'Who put the package on first'], ['🔗', 'Same stay', 'Guest stays on? Still one stay'], ['🥐', 'Same kind', 'Same kind = same package (30BB = 60BB)']];
  const stepHtml = `<ol class="pr-steps" aria-label="How it decides">${steps.map(([i, t, d], ix) => `<li><span class="pr-step-ico">${i}<em>${ix + 1}</em></span><div><b>${t}</b><small>${d}</small></div></li>`).join('')}</ol>`;

  const D = pkgLastDiff;
  let diffHtml = '';
  if (D) {
    const n = D.list ? D.list.length : 0;
    const title = !D.list ? 'Saved for the team' : n ? `${n} package${n !== 1 ? 's' : ''} changed` : 'No package changed';
    const sub = !D.list ? 'Load an audit to see which packages it changes.' : n ? 'The audit ran again with your answer.' : 'The results are the same as before.';
    diffHtml = `<section class="pr-diff${n ? '' : ' calm'}" role="status">
      <div class="pr-diff-hd"><span class="pr-badge sm" aria-hidden="true">${n ? '✨' : '✓'}</span><div class="pr-diff-t"><b>${title}</b><small>${escapeHtml(D.label)}</small><small class="m">${sub}</small></div>
        <div class="pr-diff-acts">${D.undo && can ? '<button type="button" class="pr-btn" onclick="pkgRuleUndo()">↶ Undo</button>' : ''}<button type="button" class="pr-x" onclick="pkgLastDiff=null;pkgRulesRender()" aria-label="Close">✕</button></div></div>
      ${n ? `<div class="pr-diff-list">${D.list.slice(0, 60).map(x => `<div class="pr-diff-row"><span class="pa-room sm">${escapeHtml(x.room || '—')}</span><div><b>${escapeHtml(x.fam)}</b> <code>${escapeHtml(x.conf)}</code><small>${escapeHtml(x.nights)}</small></div><span class="pr-chg">${escapeHtml(x.change)}</span></div>`).join('')}${D.list.length > 60 ? `<div class="pa-more">and ${D.list.length - 60} more</div>` : ''}</div>` : ''}
    </section>`;
  }

  const sug = _pkgSuggestions();
  const sugShown = _pkgSugAll ? sug : sug.slice(0, 3);
  const sugHtml = sug.length ? `<section class="pr-card pr-sugg"><h3><span>💡</span> Tips from this audit</h3>${sugShown.map(s => `<div class="pr-sg ${s.tone}"><span>${escapeHtml(s.text)}</span>${s.act ? `<button type="button" class="pr-btn sm" onclick="${s.act[1]}">${escapeHtml(s.act[0])}</button>` : ''}</div>`).join('')}${sug.length > 3 ? `<button type="button" class="pr-link" onclick="pkgSugMore()">${_pkgSugAll ? 'Show less' : `${sug.length - 3} more`}</button>` : ''}</section>` : '';

  const main = PKG_RULE_INFO.filter(R => !R.more), more = PKG_RULE_INFO.filter(R => R.more);
  const moreChanged = more.filter(R => _pkgRuleOn(R.k) !== _pkgRuleDefOn(R.k)).length;

  const pins = Object.entries(pkgPins || {}).filter(([, p]) => p && typeof p === 'object').sort((a, b) => String(b[1].at || '').localeCompare(String(a[1].at || '')));
  const pinBody = `<p class="pr-help">A frozen package keeps the seller a person chose, whatever the rules say. Freeze one from its card in the list (📌).</p>
    ${pins.length ? `<div class="pr-list">${pins.map(([k, p]) => { const [conf, fam] = k.split('|'); const rows = _pkgGroupRows(k); return `<div class="pr-row"><span class="pa-room sm">${escapeHtml((rows[0] || {}).room || '—')}</span><div><b>${escapeHtml(fam || '')}</b> <code>${escapeHtml(conf)}</code><small>${p.skip ? '🙈 Skipped' : p.manual ? '✍️ Manual sale' + (p.seller ? ': ' + escapeHtml(p.seller) : '') : '→ ' + escapeHtml(p.seller || '')} · by ${escapeHtml(p.by || 'someone')}${p.at ? ' · ' + escapeHtml(String(p.at).slice(0, 10)) : ''}</small></div><button type="button" class="pr-btn sm" onclick="pkgPinChange(${J(k)},'__clear')">Unfreeze</button></div>`; }).join('')}</div>` : '<div class="pa-more">Nothing frozen.</div>'}`;

  const staff = Object.entries(pkgStaffDb || {}).filter(([, s]) => s && s.name).sort((a, b) => String(a[1].name).localeCompare(String(b[1].name)));
  const unk = pkgResults.length ? _pkgUnknownLogins() : [];
  const staffBody = staff.length ? `<p class="pr-help">${staff.filter(([, s]) => s.status !== 'left').length} active, ${staff.filter(([, s]) => s.status === 'left').length} left${unk.length ? ` · <b>${unk.length}</b> login${unk.length > 1 ? 's' : ''} in this log with no name` : ''}. Rename, mark who left, add logins or import a list in 🛠 Settings → Team.</p>
    <div class="ps-row"><button type="button" class="pr-btn sm" onclick="pkgOpenSettings('team')">👥 Manage the team</button></div>` : `<p class="pr-help">Opera shows logins (CHAIN-SALVAREZ), IN-Gauge shows names (Sam ALVAREZ). This list joins them for the whole team.</p>
    ${!staff.length ? (can ? `<div class="pa-seed"><label for="pkgStaffSeed"><b>Start the list:</b> paste your team, one per line. Add logins after "=" when they are not simply initials + family name.</label>
        <textarea id="pkgStaffSeed" rows="5" placeholder="Sam ALVAREZ&#10;Lina MORENO = CHAIN-LMORENO2&#10;Test Person = CHAIN-TPERSON, TPERS"></textarea>
        <button type="button" class="btn gold sm" onclick="pkgStaffSeed()">Save the team list</button></div>` : '<div class="pa-more">No names yet. A manager can add the team here.</div>') : `
      <div class="pr-list">${staff.map(([id, s]) => `<div class="pr-row staff"><b>${escapeHtml(s.name)}</b><span>${(s.logins || []).map(l => `<code>${escapeHtml(l)}</code>`).join(' ') || '<small>matched by family name</small>'}</span>${can ? `<button type="button" class="pr-x" title="Remove" aria-label="Remove ${escapeHtml(s.name)}" onclick="pkgStaffDel(${J(id)})">✕</button>` : ''}</div>`).join('')}</div>
      ${can ? `<div class="pa-addstaff"><input id="pkgStaffName" placeholder="Name, as in IN-Gauge" autocomplete="off"><input id="pkgStaffLogins" placeholder="Opera login(s), optional" autocomplete="off"><button type="button" class="btn gold sm" onclick="pkgStaffAdd()">Add</button></div>` : ''}`}
    ${unk.length ? `<div class="pa-unk"><small>Logins in this log with no name${can && staff.length ? ' (tap to add)' : ''}:</small>${unk.slice(0, 20).map(u => can && staff.length ? `<button type="button" class="pa-chip btn-like" onclick="pkgStaffPick(${J(u.login)})">${escapeHtml(u.login)} <em>${u.n}</em></button>` : `<span class="pa-chip">${escapeHtml(u.login)} <em>${u.n}</em></span>`).join('')}</div>` : ''}`;

  box.innerHTML = `<div class="pr-rules">
    <div class="pr-head">
      <div class="pr-head-row">
        <div class="pr-title"><h2>⚙️ Package rules</h2><p>Answer each question. The audit runs again at once.</p></div>
        ${can ? `<button type="button" class="pr-btn" ${changed.length ? '' : 'disabled'} onclick="pkgRulesReset()" title="Put every answer back to Recommended">↺ Reset${changed.length ? ` (${changed.length})` : ''}</button>` : ''}
      </div>
      <label class="pr-try" for="pkgTryIn"><span class="pr-try-ico" aria-hidden="true">🔍</span><input id="pkgTryIn" type="search" inputmode="numeric" autocomplete="off" placeholder="Try a confirmation number: who gets it?" value="${escapeHtml(_pkgTryQ)}" oninput="pkgTryConf(this.value)"></label>
      <div id="pkgTryOut" class="pr-try-out" aria-live="polite">${_pkgTryHtml()}</div>
    </div>
    ${!can ? '<div class="pr-ro">🔒 Only managers can change rules. You can read them and try a number.</div>' : ''}
    ${diffHtml}
    <section class="pr-card pr-how"><h3>How it decides</h3>${stepHtml}</section>
    <section class="pr-qs" aria-label="Rules">${main.map(R => _pkgQHtml(R, can, groups)).join('')}</section>
    ${det('more', '⚙️ More options', moreChanged ? `${moreChanged} changed` : null, `<div class="pr-qs in">${more.map(R => _pkgQHtml(R, can, groups)).join('')}</div>`)}
    ${sugHtml}
    ${det('pins', '📌 Frozen sellers', pins.length, pinBody)}
    ${det('staff', '👥 Team names', staff.length, staffBody)}
  </div>`;
  if (tryFocus) { const i = document.getElementById('pkgTryIn'); if (i) { i.focus(); try { i.setSelectionRange(caret, caret); } catch (_) {} } }
}

// ── Styles (self-contained; theme variables only) ────────────
function _pkgStyle2() {
  if (document.getElementById('pkgStyle2')) return;
  const st = document.createElement('style'); st.id = 'pkgStyle2';
  st.textContent = `
#panel-package-audit .pa-tabs{display:inline-flex;gap:2px;padding:3px;border-radius:12px;background:var(--bg2);border:1px solid var(--border)}
#panel-package-audit .pa-tabs button{border:0;background:none;color:var(--text2);font:600 .8rem var(--font,inherit);padding:7px 14px;border-radius:9px;cursor:pointer;white-space:nowrap}
#panel-package-audit .pa-tabs button.on{background:var(--card);color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,.15)}
.pa-sum{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;margin:14px 0 10px;padding:9px 12px;border:1px solid var(--border);border-radius:var(--r,12px);background:var(--card);font-size:.78rem;color:var(--text2);line-height:1.5}
.pa-sum.muted{color:var(--text3);font-size:.74rem}
.pa-sum i{font-style:normal;color:var(--text3)}
.pa-sum .ok{color:var(--green)} .pa-sum .bad{color:var(--red);font-weight:700}
.pa-link{border:0;background:none;color:var(--gold,var(--accent));font:600 .76rem var(--font,inherit);cursor:pointer;padding:2px 4px;text-decoration:underline;text-underline-offset:2px}
.pa-done-list{margin:-4px 0 12px;border:1px solid var(--border);border-radius:var(--r,12px);background:var(--card);overflow:hidden}
.pa-done-row,.pa-diff-row,.pa-pinrow{display:flex;align-items:center;gap:10px;padding:8px 12px;border-top:1px solid var(--border);min-width:0}
.pa-done-row:first-child,.pa-diff-row:first-child,.pa-pinrow:first-child{border-top:0}
.pa-done-main,.pa-diff-row>div,.pa-pinrow>div{flex:1;min-width:0;font-size:.78rem;overflow-wrap:anywhere}
.pa-done-main small,.pa-diff-row small,.pa-pinrow small{display:block;color:var(--text3);font-size:.7rem;margin-top:1px}
.pa-done-list code,.pa-card code,.pa-diff code,.pa-pins code,.pa-staff code,.pa-whybox code{font:500 .72rem var(--mono);color:var(--text2)}
.pa-undo{flex:none;border:1px solid var(--border2);background:var(--bg2);color:var(--text2);border-radius:8px;padding:4px 8px;font-size:.7rem;cursor:pointer}
.pa-undo:hover{color:var(--text)}
.pa-chip{flex:none;display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font:600 .64rem var(--mono);background:var(--bg2);color:var(--text2);white-space:nowrap;border:1px solid transparent}
.pa-chip.ok{background:color-mix(in srgb,var(--green) 14%,transparent);color:var(--green)}
.pa-chip.bad{background:color-mix(in srgb,var(--red) 14%,transparent);color:var(--red)}
.pa-chip.wait{background:color-mix(in srgb,var(--gold,#e8b84b) 16%,transparent);color:var(--text2)}
.pa-chip.muted{color:var(--text3)} .pa-chip em{font-style:normal;opacity:.6}
.pa-chip.btn-like{cursor:pointer;border-color:var(--border2)}
.pa-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:4px 0 10px}
.pa-views{display:flex;flex-wrap:wrap;gap:6px;max-width:100%;flex:1 1 100%;padding:2px 0}
.pa-views::-webkit-scrollbar{display:none}
.pa-view{flex:none;border:1px solid var(--border);background:var(--card);color:var(--text2);border-radius:999px;padding:6px 11px;font:600 .74rem var(--font,inherit);cursor:pointer;white-space:nowrap}
.pa-view span{font:600 .66rem var(--mono);color:var(--text3);margin-left:2px}
.pa-view.on{background:var(--text);color:var(--bg2);border-color:var(--text)} .pa-view.on span{color:inherit;opacity:.75}
.pa-view.rule{background:var(--gold,var(--accent));border-color:var(--gold,var(--accent));color:#111}
.pa-search{flex:1 1 100%;max-width:420px;min-width:0;display:flex;align-items:center;gap:6px;border:1px solid var(--border);background:var(--card);border-radius:10px;padding:0 10px}
.pa-search input{flex:1;min-width:0;border:0;background:none;color:var(--text);font-size:.8rem;padding:8px 0;outline:none}
.pa-listhd{font-size:.86rem;color:var(--text);margin:2px 0 8px;display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline}
.pa-listhd small{color:var(--text3);font-size:.72rem}
.pa-list{display:flex;flex-direction:column;gap:8px}
.pa-card{position:relative;border:1px solid var(--border);border-left:4px solid var(--border2);border-radius:var(--r,12px);background:var(--card);padding:11px 12px 10px;overflow:hidden;transition:max-height .35s ease,opacity .3s ease,transform .35s ease,padding .35s ease,margin .35s ease,border-width .35s}
.pa-card.t-fix{border-left-color:var(--gold,var(--accent))} .pa-card.t-deny{border-left-color:var(--red)} .pa-card.t-review{border-left-color:var(--amber,#d97706)}
.pa-card.t-back{border-left-color:var(--red);box-shadow:0 0 0 1px color-mix(in srgb,var(--red) 35%,transparent)} .pa-card.t-ok{border-left-color:var(--green);opacity:.85}
.pa-card.pa-leaving{max-height:0!important;opacity:0;transform:translateX(24px);padding-top:0;padding-bottom:0;margin-top:-8px;border-width:0}
.pa-back{margin:-2px 0 8px;padding:6px 10px;border-radius:9px;background:color-mix(in srgb,var(--red) 12%,transparent);color:var(--red);font:700 .76rem var(--font,inherit)}
.pa-back small{display:block;font-weight:500;color:var(--text2);font-size:.7rem;margin-top:1px}
.pa-top{display:flex;gap:10px;align-items:flex-start;min-width:0}
.pa-room{flex:none;min-width:44px;text-align:center;padding:5px 6px;border-radius:9px;background:var(--bg2);border:1px solid var(--border);font:700 .82rem var(--mono);color:var(--text)}
.pa-room.sm{min-width:38px;padding:3px 5px;font-size:.72rem}
.pa-pk{flex:1;min-width:0} .pa-pk b{display:block;font-size:.9rem;color:var(--text)} .pa-pk small{display:block;font-size:.72rem;color:var(--text3);margin-top:1px;overflow-wrap:anywhere}
.pa-act{flex:none;max-width:46%;text-align:right;font:700 .72rem var(--font,inherit);color:var(--gold,var(--accent));line-height:1.35}
.pa-act em{font-style:normal;font-weight:600;color:var(--text3)}
.t-deny .pa-act{color:var(--red)} .t-review .pa-act{color:var(--amber,#d97706)} .t-back .pa-act{color:var(--red)} .t-ok .pa-act{color:var(--text3)}
.pa-who{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:8px;align-items:center;margin:9px 0 0;max-width:620px;padding:8px 10px;border-radius:10px;background:var(--bg2)}
.pa-who small{display:block;font:600 .58rem var(--mono);text-transform:uppercase;letter-spacing:.05em;color:var(--text3)}
.pa-who b{display:block;font-size:.82rem;color:var(--text);overflow-wrap:anywhere;margin-top:1px}
.pa-who b.was{color:var(--text2);text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--red) 60%,transparent)}
.pa-who b.ok{color:var(--green)} .pa-who b.bad{color:var(--red)} .pa-who b.warn{color:var(--amber,#d97706)}
.pa-arrow{color:var(--text3);font-weight:700}
.pa-prod{margin-top:6px;font-size:.76rem;color:var(--text2)}
.pa-short{margin-top:7px;font-size:.74rem;color:var(--text2);line-height:1.45}
.pa-foot{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:9px}
.pa-copy{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--border2);background:var(--bg2);color:var(--text);border-radius:10px;padding:6px 10px;cursor:copy;font:inherit;min-height:36px}
.pa-copy code{font:700 .84rem var(--mono)!important;color:var(--text)!important;user-select:text;-webkit-user-select:text}
.pa-copy span{font-size:.7rem;color:var(--text3);font-weight:600;white-space:nowrap}
.pa-copy:hover{border-color:var(--gold,var(--accent))} .pa-copy:hover span{color:var(--gold,var(--accent))}
.pa-copy.copied{border-color:var(--green)} .pa-copy.copied span{color:var(--green)}
.pa-btn{border:1px solid var(--border2);background:var(--card);color:var(--text2);border-radius:10px;padding:6px 11px;font:600 .74rem var(--font,inherit);cursor:pointer;min-height:36px;white-space:nowrap}
.pa-btn:hover,.pa-btn.on{color:var(--text);border-color:var(--text3)}
.pa-pin{position:relative;display:inline-flex;align-items:center;border:1px dashed var(--border2);border-radius:10px;padding:6px 10px;font:600 .72rem var(--font,inherit);color:var(--text3);min-height:36px;cursor:pointer}
.pa-pin.on{border-style:solid;border-color:var(--gold,var(--accent));color:var(--gold,var(--accent))}
.pa-pin select{position:absolute;inset:0;opacity:0;width:100%;cursor:pointer;font-size:16px}
.pa-whybox{margin-top:10px;padding:10px 12px;border-radius:10px;background:var(--bg2);border:1px solid var(--border)}
.pa-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:9px}
.pa-steps>li{display:flex;gap:9px;font-size:.76rem;color:var(--text2);line-height:1.5;min-width:0}
.pa-steps>li>div{min-width:0;overflow-wrap:anywhere}
.pa-steps>li>div>b{color:var(--text);font-size:.74rem}
.pa-steps .i{flex:none;width:24px;height:24px;border-radius:7px;display:grid;place-items:center;background:var(--card);font-size:.8rem}
.pa-steps ul{margin:4px 0 0;padding-left:16px} .pa-steps ul li{margin:2px 0} .pa-steps ul li.me{color:var(--text)}
.pa-steps .t{font-family:var(--mono);font-size:.7rem;color:var(--text3)} .pa-steps .ok{color:var(--green)} .pa-steps .muted{color:var(--text3)}
.pa-rtag{display:inline-block;margin:2px 4px 0 0;padding:1px 8px;border-radius:999px;background:var(--card);border:1px solid var(--border2);font-size:.7rem;color:var(--text)}
.pa-empty{padding:28px 16px;text-align:center;border:1px dashed var(--border2);border-radius:var(--r,12px);color:var(--text3);font-size:.8rem;display:flex;flex-direction:column;gap:4px}
.pa-empty b{color:var(--text);font-size:.95rem}
.pa-more{padding:8px 12px;font-size:.72rem;color:var(--text3)}
/* rules view */
.pa-addstaff{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.pa-addstaff input,.pa-seed textarea{flex:1 1 150px;min-width:0;border:1px solid var(--border2);background:var(--bg2);color:var(--text);border-radius:9px;padding:8px 10px;font-size:16px;font-family:inherit}
.pa-seed{display:flex;flex-direction:column;gap:8px} .pa-seed label{font-size:.76rem;color:var(--text2);line-height:1.45} .pa-seed .btn{align-self:flex-start}
.pa-unk{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px;align-items:center} .pa-unk small{width:100%;color:var(--text3);font-size:.72rem}
@media (max-width:760px){
  .pa-act{max-width:40%}
}
@media (max-width:600px){
  .pa-views{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none} .pa-search{max-width:none}
}
@media (max-width:480px){
  .pa-card{padding:10px}
  .pa-top{flex-wrap:wrap} .pa-act{order:3;flex-basis:100%;max-width:none;text-align:left;margin-left:54px}
  .pa-who{grid-template-columns:minmax(0,1fr);gap:4px} .pa-arrow{display:none}
  .pa-foot>*{flex:1 1 auto} .pa-copy{flex-basis:100%;justify-content:space-between}
  .pa-done-row{flex-wrap:wrap} .pa-done-main{flex-basis:calc(100% - 60px)}
}
/* ── Rules view (pr-*) ── */
.pr-rules{--pr-acc:var(--gold,var(--accent,#e8b84b));--pr-sh:0 1px 2px rgba(0,0,0,.06),0 4px 14px rgba(0,0,0,.05);display:flex;flex-direction:column;gap:16px;margin-top:8px;min-width:0}
.pr-rules code{font:500 .72rem var(--mono);color:var(--text2)}
.pr-head{display:flex;flex-direction:column;gap:8px;min-width:0}
.pr-head-row{display:flex;gap:12px;align-items:center;justify-content:space-between}
.pr-title{min-width:0} .pr-title h2{margin:0;font-size:1.08rem;font-weight:700;color:var(--text);letter-spacing:-.01em} .pr-title p{margin:2px 0 0;font-size:.8rem;color:var(--text3)}
.pr-try{display:flex;align-items:center;gap:8px;min-height:48px;padding:0 14px;border:1px solid var(--border2);border-radius:var(--r,12px);background:var(--card);box-shadow:var(--pr-sh);cursor:text;transition:border-color .15s,box-shadow .15s}
.pr-try:focus-within{border-color:var(--pr-acc);box-shadow:0 0 0 3px color-mix(in srgb,var(--pr-acc) 22%,transparent)}
.pr-try-ico{font-size:1rem;opacity:.75}
.pr-try input{flex:1;min-width:0;border:0;outline:0;background:none;color:var(--text);font:500 16px var(--font,inherit);padding:12px 0}
.pr-try input::placeholder{color:var(--text3)}
.pr-try-out:empty{display:none}
.pr-try-out{display:flex;flex-direction:column;gap:8px}
.pr-try-msg{padding:10px 14px;border-radius:var(--r,12px);background:var(--bg2);font-size:.8rem;color:var(--text2)}
.pr-try-res{padding:12px 14px;border:1px solid color-mix(in srgb,var(--pr-acc) 45%,var(--border));border-radius:var(--r,12px);background:var(--card);box-shadow:var(--pr-sh);min-width:0}
.pr-try-top{display:flex;gap:10px;align-items:center;min-width:0} .pr-try-top>div{min-width:0}
.pr-try-who{font-size:.95rem;color:var(--text)} .pr-try-top small{display:block;font-size:.72rem;color:var(--text3);overflow-wrap:anywhere}
.pr-try-why{margin-top:8px;font-size:.8rem;color:var(--text2);line-height:1.5;overflow-wrap:anywhere}
.pr-try-res .pa-whybox{margin-top:8px}
.pr-ro{display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:var(--r,12px);background:var(--bg2);border:1px dashed var(--border2);font-size:.8rem;color:var(--text2)}
.pr-card{border:1px solid var(--border);border-radius:var(--r,12px);background:var(--card);padding:16px;box-shadow:var(--pr-sh);min-width:0}
.pr-card h3{margin:0 0 12px;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text3)}
.pr-steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.pr-steps li{display:flex;flex-direction:column;gap:8px;align-items:flex-start;min-width:0;position:relative}
.pr-steps li:not(:last-child)::after{content:'';position:absolute;left:60px;right:-4px;top:23px;height:2px;border-radius:2px;background:linear-gradient(90deg,color-mix(in srgb,var(--pr-acc) 60%,transparent),color-mix(in srgb,var(--pr-acc) 15%,transparent))}
.pr-steps li>div{min-width:0}
.pr-steps b{display:block;font-size:.86rem;color:var(--text)} .pr-steps small{display:block;font-size:.78rem;color:var(--text2);line-height:1.4;margin-top:2px}
.pr-step-ico{flex:none;position:relative;width:48px;height:48px;border-radius:50%;display:grid;place-items:center;font-size:1.35rem;background:color-mix(in srgb,var(--pr-acc) 14%,var(--card));border:1px solid color-mix(in srgb,var(--pr-acc) 35%,transparent)}
.pr-step-ico em{position:absolute;right:-3px;top:-3px;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font:700 .62rem var(--font,inherit);font-style:normal;background:var(--pr-acc);color:#111;box-shadow:0 0 0 2px var(--card)}
.pr-qs{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:var(--r,12px);background:var(--card);box-shadow:var(--pr-sh);overflow:hidden;min-width:0}
.pr-qs.in{box-shadow:none;border-radius:10px}
.pr-q{display:grid;grid-template-columns:40px minmax(0,1fr) auto;gap:8px 16px;align-items:start;padding:16px;border-top:1px solid var(--border);transition:background .2s}
.pr-q:first-child{border-top:0}
.pr-q.changed{background:color-mix(in srgb,var(--pr-acc) 6%,var(--card))}
.pr-q.dim .pr-q-main{opacity:.55}
.pr-badge{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;font-size:1.1rem;background:color-mix(in srgb,var(--pr-acc) 13%,var(--card));border:1px solid color-mix(in srgb,var(--pr-acc) 28%,transparent)}
.pr-badge.sm{width:32px;height:32px;font-size:.95rem;flex:none}
.pr-q-main{min-width:0;display:flex;flex-direction:column;gap:8px;align-items:flex-start}
.pr-q h4{margin:0;font-size:.95rem;font-weight:600;line-height:1.4;color:var(--text)}
.pr-ex{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;min-width:0;max-width:100%}
.pr-if{font:700 .58rem var(--mono);text-transform:uppercase;letter-spacing:.07em;color:var(--text3);margin-right:2px}
.pr-tok{display:inline-flex;align-items:center;max-width:100%;padding:3px 9px;border-radius:7px;background:var(--bg2);border:1px solid var(--border);font:500 .72rem var(--font,inherit);color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pr-tok.win{background:color-mix(in srgb,var(--green) 13%,var(--card));border-color:color-mix(in srgb,var(--green) 40%,transparent);color:var(--text);font-weight:700}
.pr-arw{color:var(--text3);font-size:.8rem} .pr-arw.res{color:var(--green);font-weight:700}
.pr-note{font-size:.76rem;color:var(--amber,#d97706);line-height:1.4}
.pr-aff{margin-left:6px;border:1px solid var(--border);background:var(--bg2);color:var(--text2);border-radius:999px;padding:4px 11px;min-height:28px;font:500 .72rem var(--font,inherit);cursor:pointer;transition:border-color .15s,color .15s}
.pr-aff b{color:var(--text)} .pr-aff:hover{border-color:var(--pr-acc);color:var(--text)}
.pr-yns{display:inline-flex;padding:3px;gap:3px;border-radius:12px;background:var(--bg2);border:1px solid var(--border);align-self:center}
.pr-yn{position:relative;min-width:76px;min-height:44px;border:0;border-radius:9px;background:none;color:var(--text2);font:600 .86rem var(--font,inherit);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:4px 12px;transition:background .2s,color .2s,box-shadow .2s}
.pr-yn small{font:600 .56rem var(--font,inherit);text-transform:uppercase;letter-spacing:.05em;color:var(--text3)}
.pr-yn:hover:not(:disabled):not(.on){color:var(--text);background:color-mix(in srgb,var(--text) 6%,transparent)}
.pr-yn.on{background:var(--card);color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,.18)}
.pr-yn.y.on{background:var(--green);color:#fff} .pr-yn.y.on small{color:rgba(255,255,255,.85)}
.pr-yn.n.on{background:var(--text2);color:var(--card)} .pr-yn.n.on small{color:color-mix(in srgb,var(--card) 80%,transparent)}
.pr-yn:focus-visible{outline:2px solid var(--pr-acc);outline-offset:1px}
.pr-yn:disabled{cursor:not-allowed} .pr-yn:disabled:not(.on){opacity:.55} .pr-yn.on:disabled{opacity:.8}
.pr-diff{border:1px solid color-mix(in srgb,var(--pr-acc) 55%,var(--border));border-radius:var(--r,12px);background:linear-gradient(180deg,color-mix(in srgb,var(--pr-acc) 10%,var(--card)),var(--card) 70%);box-shadow:var(--pr-sh);padding:14px 16px;min-width:0;animation:pr-in .25s ease-out}
.pr-diff.calm{border-color:color-mix(in srgb,var(--green) 45%,var(--border));background:linear-gradient(180deg,color-mix(in srgb,var(--green) 8%,var(--card)),var(--card) 70%)}
@keyframes pr-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.pr-diff-hd{display:flex;gap:12px;align-items:flex-start}
.pr-diff-t{flex:1;min-width:0} .pr-diff-t b{display:block;font-size:.95rem;color:var(--text)} .pr-diff-t small{display:block;font-size:.76rem;color:var(--text2);line-height:1.4;overflow-wrap:anywhere} .pr-diff-t small.m{color:var(--text3)}
.pr-diff-acts{display:flex;gap:4px;align-items:center;flex:none}
.pr-diff-list{margin-top:12px;border:1px solid var(--border);border-radius:10px;max-height:320px;overflow:auto;background:var(--card)}
.pr-diff-row,.pr-row{display:flex;align-items:center;gap:10px;padding:8px 12px;border-top:1px solid var(--border);min-width:0}
.pr-diff-row:first-child,.pr-row:first-child{border-top:0}
.pr-diff-row>div,.pr-row>div{flex:1;min-width:0;font-size:.8rem;overflow-wrap:anywhere;color:var(--text)}
.pr-diff-row small,.pr-row small{display:block;color:var(--text3);font-size:.7rem;margin-top:1px}
.pr-chg{flex:none;max-width:50%;text-align:right;font:600 .74rem var(--font,inherit);color:var(--text);overflow-wrap:anywhere}
.pr-btn{border:1px solid var(--border2);background:var(--card);color:var(--text);border-radius:10px;padding:8px 14px;min-height:40px;font:600 .8rem var(--font,inherit);cursor:pointer;white-space:nowrap;transition:border-color .15s,background .15s}
.pr-btn:hover:not(:disabled){border-color:var(--text3)} .pr-btn:disabled{opacity:.45;cursor:default}
.pr-btn.sm{min-height:34px;padding:5px 11px;font-size:.74rem}
.pr-x{border:0;background:none;color:var(--text3);cursor:pointer;font-size:.9rem;min-width:36px;min-height:36px;border-radius:8px}
.pr-x:hover{background:var(--bg2);color:var(--text)}
.pr-link{align-self:flex-start;border:0;background:none;color:var(--pr-acc);font:600 .76rem var(--font,inherit);cursor:pointer;padding:6px 0 0;text-decoration:underline;text-underline-offset:3px}
.pr-sugg{display:flex;flex-direction:column;gap:6px;padding:14px 16px}
.pr-sugg h3{margin:0 0 4px}
.pr-sg{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:8px 10px 8px 12px;border-radius:10px;background:var(--bg2);font-size:.78rem;color:var(--text2);line-height:1.45;border-left:3px solid var(--border2)}
.pr-sg span{min-width:0;overflow-wrap:anywhere}
.pr-sg.warn{border-left-color:var(--pr-acc)} .pr-sg.bad{border-left-color:var(--red)} .pr-sg.ok{border-left-color:var(--green)}
.pr-sec{border:1px solid var(--border);border-radius:var(--r,12px);background:var(--card);box-shadow:var(--pr-sh);min-width:0}
.pr-sec>summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:52px;padding:0 16px;cursor:pointer;border-radius:var(--r,12px)}
.pr-sec>summary::-webkit-details-marker{display:none}
.pr-sec>summary:focus-visible{outline:2px solid var(--pr-acc);outline-offset:-2px}
.pr-sec-t{font-size:.9rem;font-weight:600;color:var(--text)} .pr-sec-t em{font:600 .7rem var(--mono);font-style:normal;color:var(--text3);background:var(--bg2);border-radius:999px;padding:2px 8px;margin-left:4px}
.pr-chev{width:8px;height:8px;border-right:2px solid var(--text3);border-bottom:2px solid var(--text3);transform:rotate(45deg) translateY(-2px);transition:transform .2s}
.pr-sec[open]>summary .pr-chev{transform:rotate(225deg) translateY(-2px)}
.pr-sec-b{padding:0 16px 16px;display:flex;flex-direction:column;gap:8px}
.pr-help{margin:0;font-size:.76rem;color:var(--text3);line-height:1.45}
.pr-list{border:1px solid var(--border);border-radius:10px;overflow:hidden}
.pr-row.staff b{flex:none;max-width:45%;overflow-wrap:anywhere;color:var(--text);font-size:.8rem} .pr-row.staff span{flex:1;min-width:0;overflow-wrap:anywhere;font-size:.8rem}
@media (min-width:761px){
  .pr-head{position:sticky;top:0;z-index:6;margin:0 -4px;padding:10px 4px 12px;background:var(--bg);border-bottom:1px solid var(--border)}
  .pr-try-out{max-height:52vh;overflow:auto}
  .pr-head-row{order:0}
}
@media (max-width:760px){
  .pr-steps{grid-template-columns:minmax(0,1fr);gap:12px}
  .pr-steps li{flex-direction:row;align-items:center;gap:12px}
  .pr-steps li:not(:last-child)::after{left:22px;right:auto;top:46px;width:2px;height:14px;background:color-mix(in srgb,var(--pr-acc) 45%,transparent)}
  .pr-step-ico{width:44px;height:44px;font-size:1.2rem}
  .pr-q{grid-template-columns:36px minmax(0,1fr);padding:14px}
  .pr-badge{width:36px;height:36px;font-size:1rem}
  .pr-yns{grid-column:1 / -1;display:flex;width:100%}
  .pr-yn{flex:1}
  .pr-card,.pr-sugg{padding:14px}
}
@media (max-width:480px){
  .pr-sg{flex-direction:column;align-items:flex-start}
  .pr-chg{max-width:45%}
  .pr-tok{white-space:normal}
  .pr-diff{padding:12px}
  .pr-diff-hd{flex-wrap:wrap} .pr-diff-t{flex-basis:calc(100% - 92px)} .pr-diff-acts{order:3;width:100%;justify-content:flex-end}
  .pr-diff-acts .pr-btn{flex:1}
}
@media (prefers-reduced-motion:reduce){.pr-rules *{transition:none!important;animation:none!important}}
@media (prefers-reduced-motion:reduce){.pa-card{transition:none}}`;
  document.head.appendChild(st);
}

// ═══════════════════════════════════════════════════════════
//  Seller board — packages, value and commission per seller per month
//
//  Reads pkgResults only (nothing is re-calculated): the same rows the
//  Commission report counts — credited charges, not skipped, not a system
//  (TARS) booking — under the seller the audit settled on (pins and the
//  extension rule included). A package billed over several nights counts
//  once under Packages and once per night under Nights. Rows whose seller
//  still has to be changed in IN-Gauge (not marked fixed yet) are counted
//  and flagged, so the board matches what should be paid.
//  The month is the IN-Gauge charge date (Daily Date).
//  The commission rate is shared with the team at packageAudit/board/rate.
// ═══════════════════════════════════════════════════════════
let pkgBoardMonth = '';
let pkgBoardRate = (() => { try { const v = parseFloat(localStorage.getItem('pkg_board_rate_v1')); return v >= 0 ? v : 0; } catch (_) { return 0; } })();
let pkgBoardSync = false;
const _PKGB_MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const _pkgbE = s => (typeof escapeHtml === 'function' ? escapeHtml(String(s ?? '')) : String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
const _pkgbN = v => (Math.round((+v || 0) * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const _pkgbMonthLabel = k => k === 'all' ? 'All months' : k === 'nodate' ? 'No charge date' : `${_PKGB_MON[+k.slice(4, 6) - 1] || '?'} ${k.slice(0, 4)}`;
function _pkgbMonthOf(r) {
  const n = _pkgDayNum(r.daily) || _pkgDayNum(r.from) || _pkgDayNum(r.arr);
  return n ? String(n).slice(0, 6) : 'nodate';
}

/** { months: ['202610', ...], by: {month: {seller: {...}}} } built from the audit result. */
function pkgBoardData() {
  const label = u => (_pkgUserLabel(u) || 'Unassigned');
  const by = {};
  (pkgResults || []).forEach(r => {
    if (r.verdict !== 'credit' || r.pinSkip || r.noSeller) return;
    const fam = _pkgFamilyName(r), who = label(r.user || r.employee);
    const amt = parseFloat(r.price ?? r.charge) || 0;
    const pending = !r.alreadyComplete && !pkgNightDone(r);
    [_pkgbMonthOf(r), 'all'].forEach(m => {
      const s = ((by[m] = by[m] || {})[who] = by[m][who] || { seller: who, pk: new Set(), nights: 0, aed: 0, fam: {}, pend: new Set() });
      s.pk.add(r.conf + '|' + fam); s.nights++; s.aed += amt;
      s.fam[fam] = (s.fam[fam] || 0) + 1;
      if (pending) s.pend.add(r.conf + '|' + fam);
    });
  });
  const months = Object.keys(by).filter(k => k !== 'all').sort().reverse();
  return { months, by };
}

/** The ranked rows for one month, with commission at the current rate. */
function pkgBoardRows(month) {
  const D = pkgBoardData();
  const m = month && D.by[month] ? month : (D.months[0] || 'all');
  const list = Object.values(D.by[m] || {}).map(s => ({
    seller: s.seller, packages: s.pk.size, nights: s.nights, aed: Math.round(s.aed * 100) / 100,
    commission: Math.round(s.aed * pkgBoardRate) / 100, pending: s.pend.size,
    what: Object.entries(s.fam).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ×${n}`).join(', ')
  })).sort((a, b) => b.aed - a.aed || b.packages - a.packages || a.seller.localeCompare(b.seller));
  const tot = list.reduce((t, r) => ({ packages: t.packages + r.packages, nights: t.nights + r.nights, aed: t.aed + r.aed, commission: t.commission + r.commission, pending: t.pending + r.pending }),
    { packages: 0, nights: 0, aed: 0, commission: 0, pending: 0 });
  // Month over month: the month before, from this audit when it covers it, else from the 🧠 memory.
  const prev = m.length === 6 ? _pkgPrevMonth(m) : '';
  const P = prev ? _pkgMonthTotals(prev, D) : null;
  if (P) {
    list.forEach(r => { const x = P.sellers[r.seller]; r.prevAed = x ? x.aed : 0; r.prevPk = x ? x.packages : 0; });
    tot.prevAed = P.aed; tot.prevPk = P.packages;
  }
  return { month: m, months: D.months, list, tot, prev: P ? prev : '' };
}
function _pkgPrevMonth(m) { const y = +m.slice(0, 4), mo = +m.slice(4, 6); return mo === 1 ? `${y - 1}12` : `${y}${String(mo - 1).padStart(2, '0')}`; }
/** One month per seller: { sellers: { name: { packages, nights, aed } }, aed, packages } or null when nothing is known. */
function _pkgMonthTotals(m, D) {
  D = D || pkgBoardData();
  const out = { sellers: {}, aed: 0, packages: 0, src: '' };
  if (D.by[m] && Object.keys(D.by[m]).length) {
    Object.values(D.by[m]).forEach(s => { out.sellers[s.seller] = { packages: s.pk.size, nights: s.nights, aed: Math.round(s.aed * 100) / 100 }; });
    out.src = 'audit';
  } else {
    Object.values(typeof pkgMemory !== 'undefined' ? pkgMemory : {}).forEach(o => Object.values(o).forEach(r => {
      const x = r.months && r.months[m]; if (!x) return;
      const name = x.seller || r.sellerName || 'Unassigned';
      const s = out.sellers[name] = out.sellers[name] || { packages: 0, nights: 0, aed: 0 };
      s.packages++; s.nights += +x.n || 0; s.aed = Math.round((s.aed + (+x.aed || 0)) * 100) / 100;
    }));
    out.src = 'memory';
  }
  if (!Object.keys(out.sellers).length) return null;
  Object.values(out.sellers).forEach(s => { out.aed += s.aed; out.packages += s.packages; });
  out.aed = Math.round(out.aed * 100) / 100;
  return out;
}
/** The last (up to) 6 months, per seller: { months: [...], rows: [{ seller, by: {m: aed}, pk: {m: n} }] }. */
function pkgBoardMonthly() {
  const D = pkgBoardData();
  const ms = new Set(D.months);
  Object.values(typeof pkgMemory !== 'undefined' ? pkgMemory : {}).forEach(o => Object.values(o).forEach(r => Object.keys(r.months || {}).forEach(m => ms.add(m))));
  const months = [...ms].filter(m => /^\d{6}$/.test(m)).sort().slice(-6);
  const rows = {};
  months.forEach(m => {
    const T = _pkgMonthTotals(m, D); if (!T) return;
    Object.entries(T.sellers).forEach(([name, x]) => { const r = rows[name] = rows[name] || { seller: name, by: {}, pk: {} }; r.by[m] = x.aed; r.pk[m] = x.packages; });
  });
  const last = months[months.length - 1];
  return { months, rows: Object.values(rows).sort((a, b) => (b.by[last] || 0) - (a.by[last] || 0) || a.seller.localeCompare(b.seller)) };
}
const _pkgDelta = (now, before) => { const d = Math.round(((+now || 0) - (+before || 0)) * 100) / 100; return d > 0 ? `<span class="pkgb-up">▲ ${_pkgbN(d)}</span>` : d < 0 ? `<span class="pkgb-down">▼ ${_pkgbN(-d)}</span>` : '<span class="pkgb-eq">=</span>'; };

function _pkgbStyle() {
  if (document.getElementById('pkgb-style')) return;
  const st = document.createElement('style'); st.id = 'pkgb-style';
  st.textContent = `
#pkgBoard{margin-top:22px;background:var(--card);border:1px solid var(--border);border-radius:var(--r,12px);padding:16px}
#pkgBoard .pkgb-hd{display:flex;gap:10px 16px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;margin-bottom:12px}
#pkgBoard .pkgb-t{font-weight:700;font-size:1rem} #pkgBoard .pkgb-s{font-size:.72rem;color:var(--text2);margin-top:2px;max-width:560px;line-height:1.5}
#pkgBoard .pkgb-ctl{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end}
#pkgBoard label{display:flex;flex-direction:column;gap:3px;font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3)}
#pkgBoard select,#pkgBoard input{font:inherit;font-size:.8rem;padding:6px 8px;border-radius:8px;border:1px solid var(--border2,var(--border));background:var(--bg2,var(--card2));color:var(--text);min-width:0}
#pkgBoard input{width:84px}
#pkgBoard .pkgb-k{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-bottom:12px}
#pkgBoard .pkgb-k div{background:var(--card2,var(--bg2));border:1px solid var(--border);border-radius:10px;padding:9px 11px;min-width:0}
#pkgBoard .pkgb-k small{display:block;font-family:var(--mono);font-size:.58rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);font-weight:600}
#pkgBoard .pkgb-k b{display:block;font-size:1.25rem;font-variant-numeric:tabular-nums;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#pkgBoard .pkgb-k .g b{color:var(--accent,#e8b84b)}
#pkgBoard .pkgb-row{display:grid;grid-template-columns:30px minmax(120px,1.3fr) minmax(90px,2fr) 70px 60px 100px 100px 104px;gap:10px;align-items:center;padding:8px 6px;border-top:1px solid var(--border)}
#pkgBoard .pkgb-row.h{border-top:0;font-family:var(--mono);font-size:.58rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);font-weight:600;padding-top:0}
#pkgBoard .pkgb-row.tot{font-weight:700;border-top:2px solid var(--border2,var(--border))}
#pkgBoard .pkgb-n{text-align:right;font-variant-numeric:tabular-nums;font-family:var(--mono);font-size:.8rem}
#pkgBoard .pkgb-rk{font-weight:800;color:var(--text3);text-align:center}

#pkgBoard .pkgb-nm{font-weight:600;min-width:0;overflow-wrap:anywhere}
#pkgBoard .pkgb-nm small{display:block;font-weight:400;font-size:.66rem;color:var(--text3);line-height:1.35}
#pkgBoard .pkgb-pend{display:inline-block;margin-top:2px;font-size:.62rem;font-weight:700;color:var(--amber,#d97706)}
#pkgBoard .pkgb-bar{height:10px;border-radius:5px;background:var(--bg2,var(--card2));overflow:hidden}
#pkgBoard .pkgb-bar i{display:block;height:100%;border-radius:5px;background:var(--accent,#e8b84b)}
#pkgBoard .pkgb-row.h>div{font-family:var(--mono);font-size:.58rem}
#pkgBoard .pkgb-empty{padding:22px;text-align:center;color:var(--text3);font-size:.8rem}
#pkgBoard .pkgb-foot{font-size:.66rem;color:var(--text3);margin-top:10px;line-height:1.5}
@media(max-width:760px){
  #pkgBoard{padding:12px}
  #pkgBoard .pkgb-k{grid-template-columns:repeat(2,minmax(0,1fr))}
  #pkgBoard .pkgb-k div:last-child{grid-column:1/-1}
  #pkgBoard .pkgb-row{grid-template-columns:26px minmax(0,1fr) auto;grid-template-areas:"rk nm aed" "rk bar bar" "rk st st";gap:4px 10px}
  #pkgBoard .pkgb-row.h{display:none}
  #pkgBoard .pkgb-row>.pkgb-rk{grid-area:rk} #pkgBoard .pkgb-row>.pkgb-nm{grid-area:nm} #pkgBoard .pkgb-row>.pkgb-bw{grid-area:bar}
  #pkgBoard .pkgb-row>.c-aed{grid-area:aed}
  #pkgBoard .pkgb-row>.c-pk,#pkgBoard .pkgb-row>.c-nt,#pkgBoard .pkgb-row>.c-cm,#pkgBoard .pkgb-row>.c-dl{display:none}
  #pkgBoard .pkgb-row>.pkgb-st{grid-area:st;display:block;font-size:.68rem;color:var(--text2);font-family:var(--mono)}
}
@media(min-width:761px){#pkgBoard .pkgb-st{display:none}}
#pkgBoard .pkgb-up{color:var(--green);font-weight:700} #pkgBoard .pkgb-down{color:var(--red);font-weight:700} #pkgBoard .pkgb-eq{color:var(--text3)}
#pkgBoard .pkgb-mm{margin-top:16px;overflow-x:auto;border:1px solid var(--border);border-radius:10px}
#pkgBoard .pkgb-mm table{border-collapse:collapse;width:100%;min-width:420px;font-size:.78rem}
#pkgBoard .pkgb-mm th,#pkgBoard .pkgb-mm td{padding:7px 9px;border-top:1px solid var(--border);text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
#pkgBoard .pkgb-mm th{border-top:0;font:600 .6rem var(--mono);text-transform:uppercase;letter-spacing:.05em;color:var(--text3)}
#pkgBoard .pkgb-mm th:first-child,#pkgBoard .pkgb-mm td:first-child{text-align:left;position:sticky;left:0;background:var(--card)}
#pkgBoard .pkgb-mm small{display:block;font-size:.62rem}
#pkgBoard .pkgb-mmt{font-weight:700;font-size:.86rem;margin:18px 0 6px}`;
  document.head.appendChild(st);
}

function _pkgbStartSync() {
  if (pkgBoardSync || typeof fbListen !== 'function') return;
  pkgBoardSync = true;
  try {
    fbListen('packageAudit/board/rate', v => {
      const n = parseFloat(v);
      if (v == null || !(n >= 0) || n === pkgBoardRate) return;
      pkgBoardRate = n;
      try { localStorage.setItem('pkg_board_rate_v1', String(n)); } catch (_) {}
      if (pkgResults.length) pkgBoardRender();
    });
  } catch (_) { pkgBoardSync = false; }
}

function pkgBoardSetMonth(v) { pkgBoardMonth = v; pkgBoardRender(); }
function pkgBoardSetRate(v) {
  const n = Math.max(0, Math.min(100, parseFloat(v) || 0));
  pkgBoardRate = n;
  try { localStorage.setItem('pkg_board_rate_v1', String(n)); } catch (_) {}
  try { if (typeof fbSet === 'function') fbSet('packageAudit/board/rate', n); } catch (_) {}
  pkgBoardRender();
}

function pkgBoardRender() {
  const wrap = document.getElementById('pkgResultsWrap');
  if (!wrap) return;
  _pkgbStyle(); _pkgbStartSync();
  let box = document.getElementById('pkgBoard');
  if (!box) { box = document.createElement('section'); box.id = 'pkgBoard'; wrap.appendChild(box); }
  const B = pkgBoardRows(pkgBoardMonth);
  const top = B.list.length ? Math.max(...B.list.map(r => r.aed), 0.01) : 1;
  const opts = [...B.months, ...(B.months.length > 1 ? ['all'] : [])]
    .map(k => `<option value="${_pkgbE(k)}"${k === B.month ? ' selected' : ''}>${_pkgbE(_pkgbMonthLabel(k))}</option>`).join('');
  const rate = pkgBoardRate;
  const comm = v => rate > 0 ? _pkgbN(v) : '—';
  const rows = B.list.map((r, i) => `
    <div class="pkgb-row">
      <div class="pkgb-rk">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</div>
      <div class="pkgb-nm">${_pkgbE(r.seller)}<small>${_pkgbE(r.what)}</small>${r.pending ? `<span class="pkgb-pend" title="The audit credits this seller, but IN-Gauge still shows someone else or a blank. Fix it in IN-Gauge and press ✓ Fixed in the list above.">⚠ ${r.pending} not fixed in IN-Gauge yet</span>` : ''}</div>
      <div class="pkgb-bw"><div class="pkgb-bar" title="${_pkgbE(_pkgbN(r.aed))} AED"><i style="width:${Math.max(2, Math.round(r.aed / top * 100))}%"></i></div></div>
      <div class="pkgb-n c-pk">${r.packages}</div>
      <div class="pkgb-n c-nt">${r.nights}</div>
      <div class="pkgb-n c-aed">${_pkgbN(r.aed)}</div>
      <div class="pkgb-n c-cm">${comm(r.commission)}</div>
      <div class="pkgb-n c-dl">${B.prev ? _pkgDelta(r.aed, r.prevAed) : '—'}</div>
      <div class="pkgb-st">${r.packages} package${r.packages === 1 ? '' : 's'} · ${r.nights} night${r.nights === 1 ? '' : 's'}${rate > 0 ? ' · commission ' + _pkgbN(r.commission) : ''}${B.prev ? ' · vs ' + _pkgMonShort(B.prev) + ' ' + _pkgDelta(r.aed, r.prevAed) : ''}</div>
    </div>`).join('');
  const T = B.tot;
  box.innerHTML = `
    <div class="pkgb-hd">
      <div><div class="pkgb-t">🏆 Seller board</div>
        <div class="pkgb-s">Packages sold per person, by the month they were charged. Counts the same sales as the Commission report: credited charges under the right seller (your pins included). Removed, skipped and system (TARS) charges are not counted.</div></div>
      <div class="pkgb-ctl">
        <label>Month<select id="pkgbMonth" onchange="pkgBoardSetMonth(this.value)">${opts || '<option>No sales</option>'}</select></label>
        <label title="Shared with the team">Commission %<input id="pkgbRate" type="number" min="0" max="100" step="0.5" inputmode="decimal" value="${rate}" onchange="pkgBoardSetRate(this.value)"></label>
        <button class="btn sm" type="button" onclick="pkgBoardCopy()">📋 Copy</button>
        <button class="btn sm" type="button" onclick="pkgBoardCsv()">📥 CSV</button>
        <button class="btn sm" type="button" onclick="pkgBoardXlsx()">📊 Excel</button>
        <button class="btn gold sm" type="button" onclick="pkgBoardPrint()">📄 Print / PDF</button>
      </div>
    </div>
    <div class="pkgb-k">
      <div><small>Packages</small><b>${T.packages}</b></div>
      <div><small>Nights</small><b>${T.nights}</b></div>
      <div><small>Value (AED)</small><b>${_pkgbN(T.aed)}</b></div>
      <div class="g"><small>Commission${rate > 0 ? ' · ' + _pkgbE(rate) + '%' : ''}</small><b>${rate > 0 ? _pkgbN(T.commission) : 'Set %'}</b></div>
      <div><small>Sellers</small><b>${B.list.length}</b></div>
    </div>
    ${B.list.length ? `<div class="pkgb-list">
      <div class="pkgb-row h"><div>#</div><div>Seller</div><div>Value</div><div class="pkgb-n">Packages</div><div class="pkgb-n">Nights</div><div class="pkgb-n">AED</div><div class="pkgb-n">Commission</div><div class="pkgb-n">${B.prev ? 'vs ' + _pkgbE(_pkgMonShort(B.prev)) : 'vs before'}</div></div>
      ${rows}
      <div class="pkgb-row tot"><div></div><div class="pkgb-nm">Total</div><div class="pkgb-bw"></div><div class="pkgb-n c-pk">${T.packages}</div><div class="pkgb-n c-nt">${T.nights}</div><div class="pkgb-n c-aed">${_pkgbN(T.aed)}</div><div class="pkgb-n c-cm">${comm(T.commission)}</div><div class="pkgb-n c-dl">${B.prev ? _pkgDelta(T.aed, T.prevAed) : '—'}</div>
        <div class="pkgb-st">${T.packages} packages · ${T.nights} nights${rate > 0 ? ' · commission ' + _pkgbN(T.commission) : ''}</div></div>
    </div>` : '<div class="pkgb-empty">No credited sales in this audit yet.</div>'}
    <div class="pkgb-foot">A package billed over several nights counts once under Packages and once per night under Nights. Commission = value × the rate you set (shared with the team).
      ${T.pending ? `<b>${T.pending}</b> package${T.pending === 1 ? ' is' : 's are'} credited here but not fixed in IN-Gauge yet: fix them in the list above so IN-Gauge matches.` : ''}
      For the whole month, run the audit with the IN-Gauge export from the 1st of the month.${B.prev ? ` "vs ${_pkgbE(_pkgMonShort(B.prev))}" compares with the month before (from this audit or the 🧠 memory).` : ''}</div>
    ${_pkgMonthlyHtml()}`;
}
function _pkgMonthlyHtml() {
  const M = pkgBoardMonthly();
  if (M.months.length < 2 || !M.rows.length) return '';
  const tot = m => M.rows.reduce((t, r) => t + (r.by[m] || 0), 0);
  return `<div class="pkgb-mmt">📈 Month by month <small style="font-weight:400;color:var(--text3);font-size:.7rem">AED per seller · ▲▼ against the month before</small></div>
    <div class="pkgb-mm"><table><thead><tr><th>Seller</th>${M.months.map(m => `<th>${_pkgbE(_pkgMonShort(m))}</th>`).join('')}</tr></thead><tbody>
    ${M.rows.map(r => `<tr><td>${_pkgbE(r.seller)}</td>${M.months.map((m, i) => `<td>${r.by[m] != null ? _pkgbN(r.by[m]) : '—'}${i && (r.by[m] != null || r.by[M.months[i - 1]] != null) ? `<small>${_pkgDelta(r.by[m], r.by[M.months[i - 1]])}</small>` : ''}</td>`).join('')}</tr>`).join('')}
    <tr><td><b>Total</b></td>${M.months.map((m, i) => `<td><b>${_pkgbN(tot(m))}</b>${i ? `<small>${_pkgDelta(tot(m), tot(M.months[i - 1]))}</small>` : ''}</td>`).join('')}</tr></tbody></table></div>`;
}
async function pkgBoardXlsx() {
  if (!pkgResults.length) { showToast('Run Package Audit first', 'err'); return; }
  const B = pkgBoardRows(pkgBoardMonth), T = B.tot, r2 = v => Math.round((+v || 0) * 100) / 100;
  const prevL = B.prev ? _pkgMonShort(B.prev) : '';
  const head = ['Rank', 'Seller', 'Packages', 'Nights', 'Value AED', 'Commission AED', ...(B.prev ? [`${prevL} AED`, `Change vs ${prevL}`] : []), 'Not fixed in IN-Gauge', 'What'];
  const rows = B.list.map((r, i) => [i + 1, r.seller, r.packages, r.nights, r2(r.aed), r2(r.commission), ...(B.prev ? [r2(r.prevAed), r2(r.aed - r.prevAed)] : []), r.pending, r.what]);
  const total = ['', 'Total', T.packages, T.nights, r2(T.aed), r2(T.commission), ...(B.prev ? [r2(T.prevAed), r2(T.aed - T.prevAed)] : []), T.pending, ''];
  const sheets = [{ name: 'Ranking', head, rows, total, money: [4, 5, ...(B.prev ? [6] : [])], delta: B.prev ? [7] : [] }];
  const M = pkgBoardMonthly();
  if (M.months.length > 1) {
    const mh = ['Seller', ...M.months.map(_pkgMonShort), `Change ${_pkgMonShort(M.months[M.months.length - 2])} → ${_pkgMonShort(M.months[M.months.length - 1])}`];
    const last = M.months.length - 1;
    const mr = M.rows.map(r => [r.seller, ...M.months.map(m => r2(r.by[m] || 0)), r2((r.by[M.months[last]] || 0) - (r.by[M.months[last - 1]] || 0))]);
    const sum = i => r2(M.rows.reduce((t, r) => t + (r.by[M.months[i]] || 0), 0));
    sheets.push({ name: 'Month by month', head: mh, rows: mr, total: ['Total', ...M.months.map((_, i) => sum(i)), r2(sum(last) - sum(last - 1))], money: M.months.map((_, i) => i + 1), delta: [M.months.length + 1] });
  }
  const month = _pkgbMonthLabel(B.month);
  await _pkgXlsx(`Seller_board_${B.month}`, 'Package seller board', `${month}${pkgBoardRate > 0 ? ' · commission ' + pkgBoardRate + '%' : ''}`, sheets,
    [['Packages', T.packages], ['Nights', T.nights], ['Value AED', r2(T.aed)], ['Sellers', B.list.length]]);
}

function _pkgbTable() {
  const B = pkgBoardRows(pkgBoardMonth);
  const head = ['Month', 'Rank', 'Seller', 'Packages', 'Nights', 'Value AED', 'Commission %', 'Commission AED', 'Not fixed in IN-Gauge', 'What'];
  const m = _pkgbMonthLabel(B.month), f = v => (Math.round((+v || 0) * 100) / 100).toFixed(2);
  const body = B.list.map((r, i) => [m, i + 1, r.seller, r.packages, r.nights, f(r.aed), pkgBoardRate, f(r.commission), r.pending, r.what]);
  body.push([m, '', 'Total', B.tot.packages, B.tot.nights, f(B.tot.aed), pkgBoardRate, f(B.tot.commission), B.tot.pending, '']);
  return { B, head, body };
}

async function pkgBoardCopy() {
  if (!pkgResults.length) { showToast('Run Package Audit first', 'err'); return; }
  const { head, body } = _pkgbTable();
  const tsv = [head, ...body].map(r => r.map(c => String(c).replace(/[\t\n]/g, ' ')).join('\t')).join('\n');
  try { await navigator.clipboard.writeText(tsv); showToast('Seller board copied: paste into Excel', 'ok'); }
  catch (_) { showToast('Copy was blocked by the browser', 'err'); }
}

function pkgBoardCsv() {
  if (!pkgResults.length) { showToast('Run Package Audit first', 'err'); return; }
  const { B, head, body } = _pkgbTable();
  const q = v => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = '﻿' + [head, ...body].map(r => r.map(q).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `Seller_board_${B.month}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function pkgBoardPrint() {
  if (!pkgResults.length) { showToast('Run Package Audit first', 'err'); return; }
  if (typeof mePrintPage !== 'function') { showToast('The print helper did not load. Reload the page.', 'err'); return; }
  const B = pkgBoardRows(pkgBoardMonth), T = B.tot, rate = pkgBoardRate, f = _pkgbN;
  const top = B.list.length ? Math.max(...B.list.map(r => r.aed), 0.01) : 1;
  const month = _pkgbMonthLabel(B.month);
  if (typeof logActivity === 'function') logActivity('pkg_board_print', `${month} · ${B.list.length} sellers`);
  const rows = B.list.map((r, i) => `<tr><td class="r">${i + 1}</td><td><b>${_pkgbE(r.seller)}</b><br><span class="muted">${_pkgbE(r.what)}</span>${r.pending ? `<br><span class="warn">${r.pending} not fixed in IN-Gauge yet</span>` : ''}</td>
    <td style="width:22%"><span class="barc" style="width:${Math.max(2, Math.round(r.aed / top * 100))}%"></span></td>
    <td class="r">${r.packages}</td><td class="r">${r.nights}</td><td class="r">${f(r.aed)}</td><td class="r">${rate > 0 ? f(r.commission) : '—'}</td></tr>`).join('');
  const sub = `<b>${_pkgbE(month)}</b> · by the month the package was charged in IN-Gauge${rate > 0 ? ` · commission ${_pkgbE(rate)}% of value` : ''}`;
  const head = typeof mePrintHead === 'function' ? mePrintHead('Package seller board', sub) : `<h1>Package seller board</h1><div class="sub">${sub}</div>`;
  const body = `${head}
    <div class="kpis">
      <div class="kpi"><small>Packages</small><b>${T.packages}</b></div>
      <div class="kpi"><small>Nights</small><b>${T.nights}</b></div>
      <div class="kpi"><small>Value (AED)</small><b>${f(T.aed)}</b></div>
      <div class="kpi"><small>Commission (AED)</small><b>${rate > 0 ? f(T.commission) : '—'}</b>${rate > 0 ? '' : '<i>no rate set</i>'}</div>
      <div class="kpi"><small>Sellers</small><b>${B.list.length}</b></div>
    </div>
    <h2>Ranking</h2>
    <div class="tw"><table><thead><tr><th class="r">#</th><th>Seller</th><th>Value</th><th class="r">Packages</th><th class="r">Nights</th><th class="r">AED</th><th class="r">Commission</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7" class="muted">No credited sales.</td></tr>'}
    <tr class="tot"><td></td><td>Total</td><td></td><td class="r">${T.packages}</td><td class="r">${T.nights}</td><td class="r">${f(T.aed)}</td><td class="r">${rate > 0 ? f(T.commission) : '—'}</td></tr></tbody></table></div>
    <div class="note">Credited charges only, under the seller the audit settled on (pinned decisions included). Removed, skipped and system (TARS) charges are not counted.
      A package billed over several nights counts once under Packages and once per night under Nights.${T.pending ? ` ${T.pending} package${T.pending === 1 ? ' is' : 's are'} credited here but not fixed in IN-Gauge yet.` : ''}</div>`;
  mePrintPage(`Seller board ${month}`, body, { sign: ['Prepared by', 'Checked by (Front Office Manager / Finance)'], signName: _pkgMe() });
}


// ═══════════════════════════════════════════════════════════
//  🛠 Settings — everything the audit needs to know about THIS hotel,
//  changed on screen, never in code.
//   • shared per hotel (packageAudit/settings/<section>): package kinds,
//     report columns, how long fixed packages and the memory are kept,
//     extra report lines to ignore. Rules stay at packageAudit/rules.
//   • per person (packageAudit/prefs/<uid> + this device): which values
//     each card shows with a copy button, and in which order.
//  Nothing stored = the defaults, so an empty hotel works as it always did.
// ═══════════════════════════════════════════════════════════
const PKG_SETTINGS_DEFAULTS = { kinds: null, colMap: { ig: {}, guest: {} }, doneDays: PKG_DONE_DAYS, memMonths: 13, chrome: [] };
const PKG_SETTINGS_KEY = 'pkg_settings_v1';
const _pkgClamp = (v, lo, hi, d) => { const n = Math.round(+v); return isFinite(n) && v !== '' && v != null ? Math.max(lo, Math.min(hi, n)) : d; };
/** A list the database may hand back as an object ({0: …, 1: …}) or with holes. */
const _pkgArr = v => Array.isArray(v) ? v.filter(x => x != null) : (v && typeof v === 'object') ? Object.keys(v).sort((a, b) => (+a) - (+b)).map(k => v[k]).filter(x => x != null) : [];

/** Stored settings on top of the defaults: every section always present and valid (pure). */
function _pkgMergeSettings(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const out = JSON.parse(JSON.stringify(PKG_SETTINGS_DEFAULTS));
  const kinds = _pkgArr(s.kinds).filter(k => k && typeof k === 'object' && String(k.k || '').trim());
  if (kinds.length) {
    const seen = new Set();
    out.kinds = kinds.map(k => ({
      k: String(k.k).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 12), label: String(k.label || k.k).slice(0, 40),
      re: String(k.re || ''), codes: _pkgArr(k.codes).map(_pkgCodeNorm).filter(Boolean), ig: String(k.ig || ''), nameRe: k.nameRe ? String(k.nameRe) : '',
      once: !!k.once, ico: String(k.ico || '🎁').slice(0, 4), color: /^#[0-9a-f]{6}$/i.test(k.color || '') ? k.color : '',
      min: Math.max(0, +k.min || 0), max: Math.max(0, +k.max || 0),
    })).filter(k => k.k && !seen.has(k.k) && seen.add(k.k));
    if (!out.kinds.length) out.kinds = null;
  }
  ['ig', 'guest'].forEach(w => {
    const m = s.colMap && s.colMap[w];
    if (m && typeof m === 'object') Object.keys(m).forEach(f => { const v = String(m[f] || '').trim(); if (v) out.colMap[w][f] = v; });
  });
  out.doneDays = _pkgClamp(s.doneDays, 7, 365, PKG_SETTINGS_DEFAULTS.doneDays);
  out.memMonths = _pkgClamp(s.memMonths, 1, 36, PKG_SETTINGS_DEFAULTS.memMonths);
  out.chrome = (typeof s.chrome === 'string' ? s.chrome.split(/[\n,]/) : _pkgArr(s.chrome)).map(x => String(x || '').trim()).filter(Boolean).slice(0, 20);
  return out;
}
let pkgSettingsRaw = {};
try { pkgSettingsRaw = JSON.parse(localStorage.getItem(PKG_SETTINGS_KEY) || '{}') || {}; } catch (_) { pkgSettingsRaw = {}; }
let pkgSettings = _pkgMergeSettings(pkgSettingsRaw);
function _pkgSetting(k) { return pkgSettings ? pkgSettings[k] : PKG_SETTINGS_DEFAULTS[k]; }
_pkgSetKinds(pkgSettings.kinds);

function _pkgApplySettings(raw, quiet) {
  const next = _pkgMergeSettings(raw);
  const same = JSON.stringify(next) === JSON.stringify(pkgSettings);
  pkgSettingsRaw = raw && typeof raw === 'object' ? raw : {};
  pkgSettings = next;
  try { localStorage.setItem(PKG_SETTINGS_KEY, JSON.stringify(pkgSettingsRaw)); } catch (_) {}
  _pkgSetKinds(pkgSettings.kinds);
  if (same || quiet) return;
  if (pkgResults.length) _pkgRecompute();
  if (_pkgView === 'settings') pkgSettingsRender();
}
/** Save one shared section (null = back to default) and re-run at once. */
function _pkgSaveSetting(section, value, label) {
  if (!_pkgCanEdit()) { showToast('Only a manager (or someone allowed to edit the checklist) can change shared settings', 'warn'); pkgSettingsRender(); return false; }
  const raw = Object.assign({}, pkgSettingsRaw);
  if (value == null) delete raw[section]; else raw[section] = value;
  if (typeof fbSet === 'function') fbSet('packageAudit/settings/' + section, value == null ? null : value);
  if (typeof logActivity === 'function') logActivity('pkg_settings', `${label || section}${value == null ? ' · back to default' : ''}`);
  const before = pkgResults.length ? pkgResults : null;
  _pkgApplySettings(raw, true);
  if (before) { const diff = _pkgRecompute(); if (diff && diff.length) showToast(`${diff.length} package${diff.length > 1 ? 's' : ''} changed`, 'ok'); }
  pkgSettingsRender();
  return true;
}
let _pkgSettingsSync = false;
function _pkgStartSettingsSync() {
  if (_pkgSettingsSync || typeof fbListen !== 'function') return;
  _pkgSettingsSync = true;
  fbListen('packageAudit/settings', v => _pkgApplySettings(v || {}));
  fbListen('packageAudit/memory', v => {
    const next = _pkgMemClean(v);
    if (JSON.stringify(next) === JSON.stringify(pkgMemory)) return;
    pkgMemory = next;
    _pkgMemoryRecomputeSoon();
    if (_pkgView === 'memory') pkgMemoryRender();
  });
  fbListen('packageAudit/learned', v => {
    pkgLearned = _pkgClean(v);
    if (pkgResults.length) _pkgRecompute();
    if (_pkgView === 'memory' || _pkgView === 'rules') (_pkgView === 'memory' ? pkgMemoryRender : pkgRulesRender)();
  });
  _pkgPrefsSync();
}
let _pkgPrefsOn = false;
function _pkgPrefsSync() {
  const uid = _pkgUid();
  if (_pkgPrefsOn || !uid || typeof fbListen !== 'function') return;
  _pkgPrefsOn = true;
  fbListen('packageAudit/prefs/' + uid, v => {
    if (!v || typeof v !== 'object') return;
    const cur = JSON.stringify(_pkgViewPrefs());
    try { localStorage.setItem(PKG_VIEW_KEY, JSON.stringify(v)); } catch (_) {}
    if (JSON.stringify(_pkgViewPrefs()) !== cur && pkgResults.length) pkgRender();
  });
}
document.addEventListener('DOMContentLoaded', () => setTimeout(_pkgStartSettingsSync, 1500));

// ── My view (per person) ─────────────────────────────────────
const PKG_VIEW_KEY = 'pkg_view_v1';
const _pkgUid = () => (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || '';
/** This person's view: copy values in their order, hidden ones (pure merge with the defaults). */
function _pkgMergeView(v) {
  const all = PKG_CHIP_FIELDS.map(x => x[0]);
  const o = v && typeof v === 'object' ? v : {};
  const chips = _pkgArr(o.chips).filter((f, i, a) => all.includes(f) && a.indexOf(f) === i);
  all.forEach(f => { if (!chips.includes(f)) chips.push(f); });
  return { chips, hidden: _pkgArr(o.hidden).filter(f => all.includes(f)) };
}
function _pkgViewPrefs() {
  let v = null;
  try { v = JSON.parse(localStorage.getItem(PKG_VIEW_KEY) || 'null'); } catch (_) {}
  return _pkgMergeView(v);
}
function _pkgSaveView(p) {
  const v = _pkgMergeView(p);
  try { localStorage.setItem(PKG_VIEW_KEY, JSON.stringify(v)); } catch (_) {}
  const uid = _pkgUid();
  if (uid && typeof fbSet === 'function') fbSet('packageAudit/prefs/' + uid, v);
  if (pkgResults.length) pkgRender();
  pkgSettingsRender();
}
function pkgViewMove(f, d) {
  const p = _pkgViewPrefs(), i = p.chips.indexOf(f), j = i + d;
  if (i < 0 || j < 0 || j >= p.chips.length) return;
  [p.chips[i], p.chips[j]] = [p.chips[j], p.chips[i]];
  _pkgSaveView(p);
}
function pkgViewToggle(f, on) {
  const p = _pkgViewPrefs();
  p.hidden = p.hidden.filter(x => x !== f);
  if (!on) p.hidden.push(f);
  _pkgSaveView(p);
}

// ═══════════════════════════════════════════════════════════
//  🧠 Memory — every package the audit resolves, kept month after month
//  packageAudit/memory/<conf>/<kind> = { conf, kind, fam, code, price, ts,
//    from, to, arr, dep, room, guest, gid, gnorm, seller, sellerName, how,
//    first, last (YYYYMM), months: { YYYYMM: { n, aed, seller } }, at, by, fixed }
//  When next month's report arrives, a package whose stay continues (the
//  same booking, or the same guest's back-to-back booking) keeps the seller
//  remembered from before, and an Unknown Product on a remembered booking at
//  the remembered price is named. Only months BEFORE the row's month count,
//  so a report never confirms itself.
// ═══════════════════════════════════════════════════════════
let pkgMemory = {};
try { pkgMemory = _pkgMemClean(JSON.parse(localStorage.getItem('ibis_packageAudit_memory') || 'null')); } catch (_) { pkgMemory = {}; }
let pkgLearned = {};
const _PKG_HOW = { opera: 'Opera: the first person who put it on', extension: 'extension (same stay)', pin: 'frozen by a person', manual: 'manual sale',
  memory: 'carried over from memory', learned: 'a learned rule', ingauge: 'IN-Gauge' };
function _pkgMemClean(v) {
  const o = {};
  if (v && typeof v === 'object') Object.keys(v).forEach(c => {
    const k = v[c]; if (!k || typeof k !== 'object') return;
    Object.keys(k).forEach(kk => { if (k[kk] && typeof k[kk] === 'object' && k[kk].seller) (o[c] = o[c] || {})[kk] = k[kk]; });
  });
  return o;
}
const _pkgDbKey = v => String(v == null ? '' : v).replace(/[.#$\[\]\/\s]+/g, '_').slice(0, 60) || '_';
/** "Sep" (this year) or "Sep 2025". */
function _pkgMonShort(m) {
  const s = String(m || ''); if (s.length !== 6) return s || '?';
  const mon = _PKG_MON[+s.slice(4, 6) - 1] || '?';
  return s.slice(0, 4) === String(new Date().getFullYear()) ? mon : `${mon} ${s.slice(0, 4)}`;
}
/** The memory key of a row's package: its kind (BB, EC…) or, without one, its name. */
function _pkgMemKind(r) { return _pkgDbKey(_pkgKindOfRow(r) || _pkgFamilyName(r) || r.code || 'PKG'); }
function _pkgHowOf(r) {
  if (r.pin && !r.learned) return r.pin.manual ? 'manual' : 'pin';
  if (r.learned) return 'learned';
  if (r.memoryUsed) return 'memory';
  if (r.extendedFrom) return 'extension';
  if (r.matchedEvent) return 'opera';
  return 'ingauge';
}

/** What the memory looks like after this audit: { next, patch } (pure: nothing is saved here).
 *  Only credited packages with a real seller are remembered. */
function _pkgMemoryBuild(results, mem, opt) {
  opt = opt || {};
  const next = JSON.parse(JSON.stringify(mem || {})), patch = {};
  const guests = opt.guests || (typeof pkgGuests !== 'undefined' ? pkgGuests : {});
  const groups = new Map();
  (results || []).forEach(r => {
    if (r.verdict !== 'credit' || r.pinSkip || r.noSeller) return;
    const seller = String(r.user || r.employee || '').trim();
    if (!seller || seller === '-' || _pkgIsSystemUser(seller)) return;
    const k = _pkgDbKey(r.conf) + '|' + _pkgMemKind(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  const now = opt.at || new Date().toISOString(), by = opt.by != null ? opt.by : _pkgMe();
  groups.forEach((rows, k) => {
    const [conf, kind] = k.split('|'), r0 = rows[0];
    const old = (next[conf] || {})[kind] || null;
    const g = guests[r0.conf] || {};
    const ev = r0.originEvent || r0.matchedEvent || null;
    const code = (r0.matchedEvent && r0.matchedEvent.code) || (ev && ev.code) || (!/unknown/i.test(r0.code || '') ? r0.code : '') || (old && old.code) || '';
    const days = rows.map(r => _pkgDayNum(r.daily)).filter(Boolean);
    const fa = [_pkgDayNum(ev && ev.from), ...days, old && old.from].filter(Boolean);
    const from = fa.length ? Math.min(...fa) : 0;
    const to = Math.max(0, ...[_pkgDayNum(ev && ev.to), ...days, old && old.to].filter(Boolean));
    const months = Object.assign({}, old && old.months);
    const byM = {};
    rows.forEach(r => { const m = _pkgbMonthOf(r); if (m === 'nodate') return; const x = byM[m] = byM[m] || { n: 0, aed: 0 }; x.n++; x.aed += parseFloat(r.price ?? r.charge) || 0; });
    const sellerName = _pkgUserLabel(r0.user || r0.employee);
    Object.keys(byM).forEach(m => { months[m] = { n: byM[m].n, aed: Math.round(byM[m].aed * 100) / 100, seller: sellerName }; });
    const ms = Object.keys(months).sort();
    if (!ms.length) return;
    const rec = {
      conf: String(r0.conf), kind, fam: (_pkgKindEntry(code) || [''])[0] || kind, code: String(code || ''), price: String(r0.price ?? r0.charge ?? ''),
      ts: (old && old.ts && ev && ev.ts ? Math.min(old.ts, ev.ts) : (ev && ev.ts) || (old && old.ts) || 0),
      from, to, arr: String(g.arr || r0.arr || (old && old.arr) || ''), dep: String(g.dep || r0.dep || (old && old.dep) || ''),
      room: String(r0.room || (old && old.room) || ''), guest: String(g.name || (old && old.guest) || ''), gid: String(g.gid || (old && old.gid) || ''),
      gnorm: String(g.norm || (old && old.gnorm) || ''), seller: String(r0.user || r0.employee), sellerName, how: _pkgHowOf(r0),
      first: ms[0], last: ms[ms.length - 1], months, at: old && old.at && _pkgSameMemo(old, months, r0) ? old.at : now, by: old && old.at && _pkgSameMemo(old, months, r0) ? (old.by || by) : by,
    };
    if (old && old.fixed) rec.fixed = old.fixed;
    // A carried-over package keeps the decision it was carried from (how it was first decided).
    if (rec.how === 'memory' && old && old.how) rec.how = old.how;
    if (old && JSON.stringify(old) === JSON.stringify(rec)) return;
    (next[conf] = next[conf] || {})[kind] = rec;
    patch[conf + '/' + kind] = rec;
  });
  // Forget what is older than the months to keep (counted back from the newest month remembered).
  const keep = opt.months || _pkgSetting('memMonths') || 13;
  let newest = '';
  Object.values(next).forEach(o => Object.values(o).forEach(r => { if (r.last > newest) newest = r.last; }));
  if (newest) {
    const y = +newest.slice(0, 4), m = +newest.slice(4, 6) - keep;
    const cut = String((y + Math.floor((m - 1) / 12)) * 100 + (((m - 1) % 12 + 12) % 12) + 1);
    Object.keys(next).forEach(c => Object.keys(next[c]).forEach(k => {
      if (String(next[c][k].last) < cut) { delete next[c][k]; patch[c + '/' + k] = null; }
    }));
    Object.keys(next).forEach(c => { if (!Object.keys(next[c]).length) delete next[c]; });
  }
  return { next, patch };
}
function _pkgSameMemo(old, months, r0) { return old.seller === String(r0.user || r0.employee) && JSON.stringify(old.months) === JSON.stringify(months); }

function _pkgMemorize(results) {
  const { next, patch } = _pkgMemoryBuild(results, pkgMemory);
  if (!Object.keys(patch).length) return 0;
  pkgMemory = next;
  if (typeof fbUpdate === 'function') fbUpdate('packageAudit/memory', patch);
  return Object.keys(patch).length;
}
let _pkgMemT = 0;
function _pkgMemoryRecomputeSoon() {
  if (!pkgResults.length) return;
  clearTimeout(_pkgMemT);
  _pkgMemT = setTimeout(() => { try { _pkgRecompute(); } catch (_) {} }, 400);
}
/** ✓ Fixed is remembered on the package's memory record too. */
function _pkgMemoryNoteFixed(key) {
  const rows = _pkgGroupRows(key); if (!rows.length) return;
  const conf = _pkgDbKey(rows[0].conf), kind = _pkgMemKind(rows[0]);
  const rec = (pkgMemory[conf] || {})[kind]; if (!rec) return;
  rec.fixed = { by: _pkgMe(), at: new Date().toISOString() };
  if (typeof fbSet === 'function') fbSet(`packageAudit/memory/${conf}/${kind}/fixed`, rec.fixed);
}

/** Guest key → remembered packages, for the guest's earlier booking. */
function _pkgMemGuestIndex(mem) {
  const idx = {};
  Object.values(mem || {}).forEach(o => Object.values(o).forEach(r => {
    if (r.gid) (idx['ID:' + r.gid] = idx['ID:' + r.gid] || []).push(r);
    if (r.gnorm) (idx['NM:' + r.gnorm] = idx['NM:' + r.gnorm] || []).push(r);
  }));
  return idx;
}

/** Packages continuing from an earlier month: the seller remembered from then (rule "memory"). */
function _pkgApplyMemory(results, mem) {
  mem = mem || pkgMemory;
  if (!_pkgRule('memory') || !mem || !Object.keys(mem).length) return;
  const gidx = _pkgMemGuestIndex(mem);
  const gapMax = +_pkgRule('chainGap') || 0;
  results.forEach(r => {
    if (r.verdict === 'settled' || r.verdict === 'deny' || r.extendedFrom) return;
    const month = _pkgbMonthOf(r);
    if (month === 'nodate') return;
    const earlier = x => x && x.first && String(x.first) < month && x.seller;
    const kind = _pkgKindOfRow(r);
    const recs = mem[_pkgDbKey(r.conf)] || {};
    let rec = null, via = 'same';
    if (kind) rec = earlier(recs[_pkgDbKey(kind)]) ? recs[_pkgDbKey(kind)] : null;
    if (!rec && kind) rec = Object.values(recs).find(x => earlier(x) && x.code && _pkgKindOfCode(x.code) === kind) || null;
    if (!rec && r.needsProduct && !r.matchedEvent) {
      // Unknown Product with nothing in this month's log: the same booking's remembered package at this price.
      const priced = Object.values(recs).filter(x => earlier(x) && x.price && Math.abs(parseFloat(x.price) - r.charge) < 0.02);
      if (priced.length && new Set(priced.map(x => x.code)).size === 1) { rec = priced[0]; via = 'price'; }
    }
    if (!rec && kind && _pkgRule('chain')) {
      // The guest's booking from an earlier month that ends the day this one starts: one stay.
      const g = (typeof pkgGuests !== 'undefined' && pkgGuests[r.conf]) || null;
      const arr = g && _pkgDayNum(g.arr);
      if (g && arr) {
        const list = (g.gid ? gidx['ID:' + g.gid] : null) || (g.norm ? gidx['NM:' + g.norm] : null) || [];
        const famOf = c => (_pkgKindEntry(c) || [''])[0];
        const cand = list.filter(x => earlier(x) && x.conf !== String(r.conf) && (!_pkgRule('sameKind') || x.kind === _pkgDbKey(kind) || (x.code && famOf(x.code) === famOf(kind))))
          .filter(x => {
            const end = _pkgDayNum(x.dep) || x.to; if (!end) return false;
            const gap = _pkgDaysBetween(end, arr);
            if (gap < 0 || gap > gapMax) return false;
            return !(_pkgRule('chainSameRoom') && x.room && g.room && String(x.room).trim() !== String(g.room).trim());
          }).sort((a, b) => (b.to || 0) - (a.to || 0));
        if (cand.length) { rec = cand[0]; via = 'guest'; }
      }
    }
    if (!rec) return;
    r.carriedFrom = { conf: rec.conf, kind: rec.kind, month: rec.last && rec.last < month ? rec.last : rec.first };
    if (_pkgIsSystemUser(rec.seller)) return;
    const o = r.originEvent;
    const apply = r.verdict === 'outside' || (r.verdict === 'review' && !r.matchedEvent) || via === 'guest' || via === 'price'
      || (r.verdict === 'credit' && _pkgRule('firstPerson') && rec.ts && o && o.ts && rec.ts < o.ts && !_pkgSameUser(rec.seller, r.user));
    if (!apply) return;
    _pkgHit(r, 'memory');
    r.memoryUsed = true;
    if (r.needsProduct && rec.code && (!r.code || /unknown/i.test(r.code))) { r.code = rec.code; r.memProduct = true; }
    const who = _pkgUserLabel(rec.seller), mon = _pkgMonShort(r.carriedFrom.month);
    r.memoryNote = via === 'guest' ? `Same stay as booking ${rec.conf} (${mon}, back-to-back): ${who} sold this package first`
      : via === 'price' ? `IN-Gauge did not name it; in ${mon} this booking had ${rec.code} at this price, sold by ${who}`
      : `Continues from ${mon}: ${who} sold this package (${_PKG_HOW[rec.how] || rec.how || 'remembered'})`;
    r.verdict = 'credit'; r.note = ''; r.noSeller = false; r.splitSeller = false;
    r.user = rec.seller;
    const same = _pkgSameUser(r.employee, rec.seller);
    r.reassign = !r.needsEmployee && !same;
    r.wasUser = r.reassign ? r.employee : '';
    r.alreadyComplete = !r.needsProduct && !r.needsEmployee && !r.reassign;
  });
}

// ── Learning from people's decisions ─────────────────────────
// Freezing the same kind of decision on the same package code again and
// again (skip it, a manual sale, always the same seller) is offered as a
// rule: ✓ Accept, and from then on it is decided that way without a pin.
// packageAudit/learned/<id> = { id, type, code | product, seller, by, at, n } or { id, dismissed: true }
function _pkgPinCode(key, p) {
  if (p && p.code) return { code: _pkgCodeNorm(p.code) };
  const r = _pkgGroupRows(key)[0];
  const c = r && ((r.matchedEvent && r.matchedEvent.code) || (!/unknown/i.test(r.code || '') ? r.code : ''));
  if (c) return { code: _pkgCodeNorm(c) };
  const prod = (p && p.product) || (r && r.product);
  return prod && !/unknown/i.test(prod) ? { product: String(prod) } : null;
}
/** Suggestions from the pins (pure on pkgPins + pkgLearned): [{ id, type, code|product, seller, n, text }]. */
function _pkgLearnSuggestions(pins, learned) {
  pins = pins || pkgPins; learned = learned || pkgLearned;
  const groups = {};
  Object.entries(pins || {}).forEach(([key, p]) => {
    if (!p || typeof p !== 'object') return;
    const m = _pkgPinCode(key, p); if (!m) return;
    const type = p.skip ? 'skip' : p.manual ? (p.seller ? '' : 'manual') : p.seller ? 'seller' : '';
    if (!type) return;
    const what = m.code || m.product;
    const id = _pkgDbKey(type + '_' + what + (type === 'seller' ? '_' + p.seller : ''));
    const g = groups[id] = groups[id] || Object.assign({ id, type, n: 0, seller: type === 'seller' ? p.seller : '' }, m);
    g.n++;
  });
  // "Always the same seller" only when nobody else was ever frozen on that code.
  const sellersByCode = {};
  Object.values(groups).filter(g => g.type === 'seller').forEach(g => { const w = g.code || g.product; (sellersByCode[w] = sellersByCode[w] || new Set()).add(g.seller); });
  return Object.values(groups).filter(g => !learned[g.id] && (g.type === 'seller' ? g.n >= 3 && sellersByCode[g.code || g.product].size === 1 : g.n >= 2))
    .sort((a, b) => b.n - a.n)
    .map(g => Object.assign(g, { text: `${g.type === 'skip' ? 'You skipped' : g.type === 'manual' ? 'You marked as a manual sale' : `You froze to ${g.seller}`} ${g.n} packages with ${g.code ? 'code ' + g.code : 'product ' + g.product}` }));
}
function _pkgLearnedText(L) {
  const w = L.code ? 'code ' + L.code : 'product ' + L.product;
  return L.type === 'skip' ? `Skip every package with ${w}` : L.type === 'manual' ? `Every package with ${w} that Opera does not show is a manual sale (IN-Gauge seller kept)` : `Every package with ${w} that Opera cannot decide goes to ${L.seller}`;
}
/** The accepted learned rule that decides this row, if any: { pin, rule }. */
function _pkgLearnedFor(r) {
  const list = Object.values(pkgLearned || {}).filter(L => L && !L.dismissed && !L.off && L.type);
  if (!list.length) return null;
  const code = _pkgCodeNorm((r.matchedEvent && r.matchedEvent.code) || (!/unknown/i.test(r.code || '') ? r.code : ''));
  const L = list.find(x => (x.code && code && _pkgCodeNorm(x.code) === code) || (x.product && r.product && String(r.product).toLowerCase() === String(x.product).toLowerCase()));
  if (!L) return null;
  const undecided = !r.matchedEvent || r.verdict === 'review' || r.verdict === 'outside';
  if (L.type === 'manual' && r.matchedEvent) return null;
  if (L.type === 'seller' && !undecided) return null;
  const pin = { by: '🧠 learned rule', at: L.at || '', learned: L.id };
  if (L.type === 'skip') pin.skip = true; else if (L.type === 'manual') pin.manual = true; else pin.seller = L.seller;
  return { pin, rule: L };
}
function pkgLearnAccept(id) {
  const L = _pkgLearnSuggestions().find(x => x.id === id);
  if (!L) return;
  if (!_pkgCanEdit()) { showToast('Only a manager can accept a rule for the team', 'warn'); return; }
  const rule = { id: L.id, type: L.type, n: L.n, by: _pkgMe(), at: new Date().toISOString() };
  if (L.code) rule.code = L.code; if (L.product) rule.product = L.product; if (L.seller) rule.seller = L.seller;
  pkgLearned = Object.assign({}, pkgLearned, { [id]: rule });
  if (typeof fbSet === 'function') fbSet('packageAudit/learned/' + id, rule);
  if (typeof logActivity === 'function') logActivity('pkg_learned', _pkgLearnedText(rule));
  if (pkgResults.length) _pkgRecompute();
  showToast('Learned: ' + _pkgLearnedText(rule), 'ok');
  if (_pkgView === 'rules') pkgRulesRender(); if (_pkgView === 'memory') pkgMemoryRender();
}
function pkgLearnDismiss(id) {
  if (!_pkgCanEdit()) return;
  pkgLearned = Object.assign({}, pkgLearned, { [id]: { id, dismissed: true, by: _pkgMe(), at: new Date().toISOString() } });
  if (typeof fbSet === 'function') fbSet('packageAudit/learned/' + id, pkgLearned[id]);
  if (_pkgView === 'memory') pkgMemoryRender(); else pkgRulesRender();
}
function pkgLearnRemove(id) {
  if (!_pkgCanEdit() || !pkgLearned[id]) return;
  const prev = pkgLearned[id];
  const rest = Object.assign({}, pkgLearned); delete rest[id]; pkgLearned = rest;
  if (typeof fbSet === 'function') fbSet('packageAudit/learned/' + id, null);
  if (pkgResults.length) _pkgRecompute();
  pkgMemoryRender();
  if (typeof showUndoToast === 'function') showUndoToast('Rule removed', () => { pkgLearned = Object.assign({}, pkgLearned, { [id]: prev }); if (typeof fbSet === 'function') fbSet('packageAudit/learned/' + id, prev); if (pkgResults.length) _pkgRecompute(); pkgMemoryRender(); });
}

// ═══════════════════════════════════════════════════════════
//  👥 Team per hotel — staff come and go every month
//  packageAudit/staff/<id> = { name, logins, status, since, left, former: [{ name, until, by }] }
//  • left: keeps every sale already made (old reports still credit them),
//    but is no longer offered when freezing a seller
//  • rename: the old name stays on as a former name, so last month's
//    IN-Gauge rows still find the person under the new one
//  • import a whole list by paste or file; another hotel starts empty
// ═══════════════════════════════════════════════════════════
const _pkgToday = () => (typeof hoLocalISO === 'function' ? hoLocalISO() : new Date().toISOString().slice(0, 10));
/** Lines → [{ name, logins, status?, date? }] (pure). Accepts "Name", "Name = login, login",
 *  "LOGIN = Name" and CSV "Name,login;login,left,2026-09-30" (a "Name" header row is skipped). */
function _pkgParseTeamText(text) {
  const out = [];
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    const t = line.trim(); if (!t) return;
    let it;
    if (!/[=:→]/.test(t) && /[,;\t]/.test(t)) {
      const c = t.split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(x => x.replace(/^"|"$/g, '').trim());
      if (i === 0 && /^(name|staff|employee)$/i.test(c[0])) return;
      it = { name: c[0], logins: String(c[1] || '').split(/[;\s|]+/).map(x => x.trim()).filter(Boolean) };
      const st = String(c[2] || '').toLowerCase();
      if (/left|gone|inactive|resigned/.test(st)) it.status = 'left'; else if (/active|current/.test(st)) it.status = 'active';
      const d = String(c[3] || '').match(/\d{4}-\d{2}-\d{2}/); if (d) it.date = d[0];
    } else it = _pkgParseStaffLine(t);
    if (it && it.name) out.push(it);
  });
  return out;
}
/** Merge a pasted list into the team (pure): { patch, added, updated }. Matched by name, an
 *  earlier name or a shared login; nobody is removed. */
function _pkgTeamMerge(db, items) {
  const cur = JSON.parse(JSON.stringify(db || {})), patch = {};
  let added = 0, updated = 0;
  const low = s => String(s || '').trim().toLowerCase();
  (items || []).forEach(it => {
    const logins = (it.logins || []).map(String);
    const id = Object.keys(cur).find(k => { const s = cur[k] || {};
      return low(s.name) === low(it.name) || (s.former || []).some(f => low(f && f.name) === low(it.name))
        || logins.some(l => (s.logins || []).some(x => _pkgLoginTok(x) === _pkgLoginTok(l))); });
    if (!id) {
      const nid = _pkgStaffId(it.name);
      const rec = { name: it.name, logins, status: it.status === 'left' ? 'left' : 'active', since: it.status !== 'left' && it.date ? it.date : _pkgToday() };
      if (it.status === 'left') rec.left = it.date || _pkgToday();
      cur[nid] = rec; patch[nid] = rec; added++;
      return;
    }
    const s = Object.assign({}, cur[id]);
    const before = JSON.stringify(s);
    s.logins = [...new Set([...(s.logins || []), ...logins])];
    if (it.status === 'left' && s.status !== 'left') { s.status = 'left'; s.left = it.date || _pkgToday(); }
    if (it.status === 'active' && s.status === 'left') { s.status = 'active'; delete s.left; }
    if (JSON.stringify(s) !== before) { cur[id] = s; patch[id] = s; updated++; }
  });
  return { patch, added, updated, next: cur };
}
function _pkgStaffSave(id, item, msg) {
  pkgStaffDb = Object.assign({}, pkgStaffDb); if (item) pkgStaffDb[id] = item; else delete pkgStaffDb[id];
  _pkgApplyStaff();
  if (typeof fbSet === 'function') fbSet('packageAudit/staff/' + id, item || null);
  if (pkgResults.length) _pkgRecompute();
  pkgSettingsRender(); if (_pkgView === 'rules') pkgRulesRender();
  if (msg) showToast(msg, 'ok');
}
function pkgTeamRename(id) {
  if (!_pkgCanEdit() || !pkgStaffDb[id]) return;
  const s = pkgStaffDb[id];
  const name = (prompt(`New name for ${s.name} (as IN-Gauge shows it now).\nThe old name is kept, so their earlier sales still count for them.`, s.name) || '').trim();
  if (!name || name === s.name) return;
  const item = Object.assign({}, s, { name, former: [...(s.former || []), { name: s.name, until: _pkgToday(), by: _pkgMe() }] });
  if (typeof logActivity === 'function') logActivity('pkg_staff', `Renamed ${s.name} → ${name}`);
  _pkgStaffSave(id, item, `${s.name} is now ${name}: old sales still count for them`);
}
function pkgTeamLeft(id) {
  if (!_pkgCanEdit() || !pkgStaffDb[id]) return;
  const s = pkgStaffDb[id];
  if (s.status === 'left') { const item = Object.assign({}, s, { status: 'active' }); delete item.left; _pkgStaffSave(id, item, `${s.name} is back on the team`); return; }
  const d = (prompt(`Last day of ${s.name} (YYYY-MM-DD). Their sales up to then still count for them; they are no longer offered for new ones.`, _pkgToday()) || '').trim();
  if (!d) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { showToast('Write the date as YYYY-MM-DD', 'warn'); return; }
  if (typeof logActivity === 'function') logActivity('pkg_staff', `${s.name} left · ${d}`);
  _pkgStaffSave(id, Object.assign({}, s, { status: 'left', left: d }), `${s.name} marked as left (${d})`);
}
function pkgTeamAlias(id, el) {
  if (!_pkgCanEdit() || !pkgStaffDb[id]) return;
  const v = String(el && el.value || '').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
  if (!v.length) return;
  const s = pkgStaffDb[id];
  _pkgStaffSave(id, Object.assign({}, s, { logins: [...new Set([...(s.logins || []), ...v])] }), `Login added to ${s.name}`);
}
function pkgTeamAliasDel(id, i) {
  if (!_pkgCanEdit() || !pkgStaffDb[id]) return;
  const s = pkgStaffDb[id], logins = (s.logins || []).slice(); const gone = logins.splice(i, 1)[0];
  _pkgStaffSave(id, Object.assign({}, s, { logins }));
  if (typeof showUndoToast === 'function') showUndoToast(`${gone} removed from ${s.name}`, () => _pkgStaffSave(id, s));
}
/** Opera login with no name: add it to a colleague (or as a new person). */
function pkgTeamAssign(login, sel) {
  const id = sel && sel.value; if (!id) return;
  if (id === '__new') { const n = document.getElementById('pkgStaffName'), l = document.getElementById('pkgStaffLogins'); if (l) l.value = login; if (n) n.focus(); return; }
  if (!_pkgCanEdit() || !pkgStaffDb[id]) return;
  const s = pkgStaffDb[id];
  _pkgStaffSave(id, Object.assign({}, s, { logins: [...new Set([...(s.logins || []), login])] }), `${login} → ${s.name}`);
}
let _pkgTeamPreview = null;
function pkgTeamPreview() {
  const ta = document.getElementById('pkgTeamPaste');
  const items = _pkgParseTeamText(ta && ta.value);
  _pkgTeamPreview = items.length ? _pkgTeamMerge(pkgStaffDb, items) : null;
  const o = document.getElementById('pkgTeamPrev');
  if (o) o.innerHTML = !items.length ? '' : `<b>${_pkgTeamPreview.added}</b> new · <b>${_pkgTeamPreview.updated}</b> updated · ${items.length - _pkgTeamPreview.added - _pkgTeamPreview.updated} already the same`;
}
function pkgTeamImport() {
  if (!_pkgCanEdit()) return;
  pkgTeamPreview();
  const P = _pkgTeamPreview;
  if (!P || !Object.keys(P.patch).length) { showToast('Nothing new in that list', 'warn'); return; }
  const prev = JSON.parse(JSON.stringify(pkgStaffDb));
  pkgStaffDb = P.next; _pkgApplyStaff();
  if (typeof fbUpdate === 'function') fbUpdate('packageAudit/staff', P.patch);
  if (typeof logActivity === 'function') logActivity('pkg_staff', `Team list imported: ${P.added} new, ${P.updated} updated`);
  if (pkgResults.length) _pkgRecompute();
  const ta = document.getElementById('pkgTeamPaste'); if (ta) ta.value = '';
  _pkgTeamPreview = null;
  pkgSettingsRender();
  const undo = () => { const back = {}; Object.keys(P.patch).forEach(k => { back[k] = prev[k] || null; }); pkgStaffDb = prev; _pkgApplyStaff(); if (typeof fbUpdate === 'function') fbUpdate('packageAudit/staff', back); if (pkgResults.length) _pkgRecompute(); pkgSettingsRender(); };
  if (typeof showUndoToast === 'function') showUndoToast(`${P.added} added · ${P.updated} updated`, undo); else showToast(`${P.added} added · ${P.updated} updated`, 'ok');
}
function pkgTeamFile(input) {
  const f = input && input.files && input.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = e => {
    let text = '';
    try {
      if (/\.xlsx?$/i.test(f.name) && typeof XLSX !== 'undefined') {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        text = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }).map(r => r.map(c => String(c).replace(/,/g, ' ')).join(',')).join('\n');
      } else text = new TextDecoder('utf-8').decode(new Uint8Array(e.target.result));
    } catch (err) { showToast('Could not read that file: ' + err.message, 'err'); return; }
    const ta = document.getElementById('pkgTeamPaste'); if (ta) ta.value = text;
    pkgTeamPreview();
    input.value = '';
  };
  rd.readAsArrayBuffer(f);
}
let _pkgTeamShowLeft = false;

// ── 📦 Start for another hotel: the setup without the team ───
/** This hotel's setup to copy (kinds, columns, keep times, rules, commission), never staff, memory or pins. */
function _pkgKit() {
  return { app: 'hotelops-package-audit', v: 1, at: new Date().toISOString(),
    settings: JSON.parse(JSON.stringify(pkgSettingsRaw || {})), rules: _pkgRulesStored(), rate: pkgBoardRate };
}
async function pkgKitCopy() {
  const txt = JSON.stringify(_pkgKit());
  try { await navigator.clipboard.writeText(txt); } catch (_) { if (typeof copyToClipboard === 'function') copyToClipboard(txt); }
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(_pkgKit(), null, 2)], { type: 'application/json' }));
    a.download = 'package-audit-setup.json'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (_) {}
  showToast('Setup copied and saved as a file. At the other hotel: Package Audit → 🛠 Settings → Another hotel → paste it. The team list is not included.', 'ok');
}
/** Read a pasted setup (pure): { settings, rules, rate } or null. */
function _pkgKitRead(text) {
  let k; try { k = JSON.parse(String(text || '').trim()); } catch (_) { return null; }
  if (!k || k.app !== 'hotelops-package-audit' || typeof k.settings !== 'object') return null;
  const rules = {};
  Object.keys(k.rules || {}).forEach(r => { if (r in PKG_RULE_DEFAULTS) rules[r] = typeof PKG_RULE_DEFAULTS[r] === 'boolean' ? !!k.rules[r] : (+k.rules[r] || 0); });
  const s = k.settings || {}, settings = {};
  ['kinds', 'colMap', 'doneDays', 'memMonths', 'chrome'].forEach(x => { if (s[x] != null) settings[x] = s[x]; });
  return { settings, rules, rate: +k.rate >= 0 ? +k.rate : null };
}
function pkgKitImport() {
  if (!_pkgCanEdit()) return;
  const ta = document.getElementById('pkgKitIn');
  const K = _pkgKitRead(ta && ta.value);
  if (!K) { showToast('That is not a Package Audit setup (paste the whole text)', 'err'); return; }
  if (!confirm('Use this setup here? Package kinds, report columns, keep times and rules are replaced. The team, memory and frozen sellers stay as they are.')) return;
  Object.keys(PKG_SETTINGS_DEFAULTS).forEach(x => { if (typeof fbSet === 'function') fbSet('packageAudit/settings/' + x, K.settings[x] == null ? null : K.settings[x]); });
  const patch = {}; Object.keys(PKG_RULE_DEFAULTS).forEach(r => { patch[r] = r in K.rules && K.rules[r] !== PKG_RULE_DEFAULTS[r] ? K.rules[r] : null; });
  if (typeof fbUpdate === 'function') fbUpdate('packageAudit/rules', patch);
  pkgRules = Object.assign({}, PKG_RULE_DEFAULTS, K.rules);
  try { localStorage.setItem('pkg_rules_v1', JSON.stringify(_pkgRulesStored())); } catch (_) {}
  if (K.rate != null) pkgBoardSetRate(K.rate);
  _pkgApplySettings(K.settings, true);
  if (pkgResults.length) _pkgRecompute();
  if (ta) ta.value = '';
  if (typeof logActivity === 'function') logActivity('pkg_settings', 'Setup imported from another hotel');
  pkgSettingsRender();
  showToast('Setup in use. Now add this hotel\'s team (👥 Team).', 'ok');
}

// ── Package kinds editor ─────────────────────────────────────
function _pkgKindsList() { return JSON.parse(JSON.stringify(pkgSettings.kinds || PKG_KINDS_DEFAULT.map(k => Object.assign({ codes: [], min: 0, max: 0 }, k)))); }
function _pkgSaveKinds(list, label) { return _pkgSaveSetting('kinds', list, label || 'Package kinds'); }
function pkgKindSet(i, field, val) {
  const L = _pkgKindsList(); if (!L[i]) return;
  if (field === 'once') val = !!val;
  else if (field === 'min' || field === 'max') val = Math.max(0, +val || 0);
  else if (field === 're') { if (val && !_pkgSafeRe(val)) { showToast('That pattern is not valid', 'err'); pkgSettingsRender(); return; } }
  else if (field === 'k') { val = String(val || '').toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 12); if (!val || L.some((k, j) => j !== i && k.k === val)) { showToast('Each kind needs its own short key', 'warn'); pkgSettingsRender(); return; } }
  else val = String(val || '').trim();
  L[i][field] = val;
  _pkgSaveKinds(L, `Kind ${L[i].label}: ${field}`);
}
function pkgKindCode(i, el) {
  const L = _pkgKindsList(); if (!L[i]) return;
  const add = String(el && el.value || '').split(/[,;\s]+/).map(_pkgCodeNorm).filter(Boolean);
  if (!add.length) return;
  L[i].codes = [...new Set([...(L[i].codes || []), ...add])];
  _pkgSaveKinds(L, `Kind ${L[i].label}: codes ${add.join(', ')}`);
}
function pkgKindCodeDel(i, j) { const L = _pkgKindsList(); if (!L[i]) return; (L[i].codes || []).splice(j, 1); _pkgSaveKinds(L); }
function pkgKindMove(i, to) {
  const L = _pkgKindsList(); if (!L[i] || to < 0 || to >= L.length || to === i) return;
  const [x] = L.splice(i, 1); L.splice(to, 0, x);
  _pkgSaveKinds(L, 'Kinds reordered');
}
function pkgKindAdd() {
  if (!_pkgCanEdit()) return;
  const label = (prompt('Name of the new kind (e.g. Spa, Parking, Airport transfer):') || '').trim(); if (!label) return;
  const L = _pkgKindsList();
  let k = label.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'K'; let n = 2; const base = k;
  while (L.some(x => x.k === k)) k = base + n++;
  L.push({ k, label, re: '', codes: [], ig: '', once: false, ico: '🎁', color: '#e2e8f0', min: 0, max: 0 });
  _pkgSaveKinds(L, 'Kind added: ' + label);
  _pkgSetOpen.add('kinds');
}
function pkgKindDel(i) {
  const L = _pkgKindsList(); if (!L[i] || !_pkgCanEdit()) return;
  if (!confirm(`Remove the kind "${L[i].label}"? Its codes then count as their own package.`)) return;
  const prev = _pkgKindsList(); L.splice(i, 1);
  if (_pkgSaveKinds(L, 'Kind removed') && typeof showUndoToast === 'function') showUndoToast('Kind removed', () => _pkgSaveKinds(prev, 'Kind restored'));
}
/** Merge kind i into kind j: its codes and pattern join j, and i goes. */
function pkgKindMerge(i, sel) {
  const j = +(sel && sel.value); if (sel) sel.value = '';
  const L = _pkgKindsList(); if (!L[i] || !L[j] || i === j) return;
  const a = L[i], b = L[j];
  b.codes = [...new Set([...(b.codes || []), ...(a.codes || [])])];
  if (a.re) b.re = b.re ? `(?:${b.re})|(?:${a.re})` : a.re;
  if (!b.ig && a.ig) b.ig = a.ig;
  const prev = _pkgKindsList(); L.splice(i, 1);
  if (_pkgSaveKinds(L, `Kind ${a.label} merged into ${b.label}`) && typeof showUndoToast === 'function') showUndoToast(`${a.label} merged into ${b.label}`, () => _pkgSaveKinds(prev, 'Merge undone'));
}
let _pkgKindTry = '';
function pkgKindTry(v) {
  _pkgKindTry = String(v || '');
  const o = document.getElementById('pkgKindTryOut'); if (!o) return;
  const c = _pkgCodeNorm(v);
  if (!c) { o.textContent = ''; return; }
  const k = _pkgKindEntry(c);
  o.innerHTML = k ? `${escapeHtml(k.ico)} <b>${escapeHtml(k[1])}</b> <small>(${escapeHtml(k[0])}${k.ig ? ' · IN-Gauge: ' + escapeHtml(k.ig) : ''})</small>` : `No kind: <b>${escapeHtml(c)}</b> counts as its own package`;
}
/** A kind whose price range fits an amount (Settings → price range): a hint for an Unknown Product. */
function _pkgKindByPrice(amount) {
  const a = +amount; if (!(a > 0)) return null;
  const list = PKG_KINDS.filter(k => k.max > 0 && a >= k.min && a <= k.max);
  return list.length === 1 ? list[0] : null;
}

// ── Report columns ───────────────────────────────────────────
let _pkgLastRows = {};
function pkgColSet(which, field, val) {
  const map = JSON.parse(JSON.stringify(pkgSettings.colMap || { ig: {}, guest: {} }));
  map[which] = map[which] || {};
  if (val) map[which][field] = val; else delete map[which][field];
  const empty = !Object.keys(map.ig || {}).length && !Object.keys(map.guest || {}).length;
  if (!_pkgSaveSetting('colMap', empty ? null : map, `Report column ${field}${val ? ' = ' + val : ' = auto'}`)) return;
  _pkgReparse(which);
}
/** Read the last loaded file again with the new column map. */
function _pkgReparse(which) {
  const rows = _pkgLastRows[which]; if (!rows) return;
  if (which === 'ig') {
    pkgUnknowns = _pkgParseExcelUnknowns(rows);
    const lbl = document.getElementById('pkgExcelLabel');
    if (lbl) lbl.textContent = pkgUnknowns.length ? `✓ ${pkgUnknowns.length} rows loaded` : 'Loaded — no rows found';
    if (pkgResults.length && pkgUnknowns.length) _pkgRecompute();
  } else {
    pkgGuests = _pkgParseGuestList(rows);
    if (pkgResults.length) _pkgRecompute();
  }
  pkgSettingsRender();
}
function pkgColReset() { if (_pkgSaveSetting('colMap', null, 'Report columns')) { _pkgReparse('ig'); _pkgReparse('guest'); } }

// ═══════════════════════════════════════════════════════════
//  Views: 🧠 Memory and 🛠 Settings (tabs next to Audit / Rules)
// ═══════════════════════════════════════════════════════════
function _pkgMountViews() {
  const tabs = document.getElementById('pkgTabs'), rules = document.getElementById('pkgRulesView');
  if (!tabs || !rules) return;
  const rb = tabs.querySelector('[data-v="rules"]');
  [['memory', '🧠 Memory'], ['settings', '🛠 Settings']].reverse().forEach(([v, t]) => {
    if (tabs.querySelector(`[data-v="${v}"]`)) return;
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.v = v; b.setAttribute('aria-selected', 'false'); b.textContent = t;
    b.addEventListener('click', () => pkgShowView(v));
    if (rb && rb.nextSibling) tabs.insertBefore(b, rb.nextSibling); else tabs.appendChild(b);
  });
  ['pkgSettingsView', 'pkgMemoryView'].forEach(id => {
    if (document.getElementById(id)) return;
    const d = document.createElement('div'); d.id = id; d.hidden = true;
    rules.parentNode.insertBefore(d, rules.nextSibling);
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { try { _pkgMountViews(); } catch (_) {} });
else { try { _pkgMountViews(); } catch (_) {} }
// One listener for every copy chip on the page (values are in data attributes, not inline code).
try {
  document.addEventListener('click', e => {
    const b = e.target && e.target.closest && e.target.closest('[data-pkg-copy]');
    if (b) { e.preventDefault(); pkgCopyChip(b); }
  });
} catch (_) {}

/** Drag & drop (mouse) + the ↑ ↓ buttons (touch, keyboard) for an ordered list. */
function _pkgDnd(box, onMove) {
  if (!box) return;
  let from = -1;
  box.querySelectorAll('[data-dnd-i]').forEach(el => {
    el.addEventListener('dragstart', e => { from = +el.dataset.dndI; el.classList.add('dragging'); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(from)); } catch (_) {} });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', e => { e.preventDefault(); el.classList.remove('over'); const to = +el.dataset.dndI; if (from >= 0 && to !== from) onMove(from, to); from = -1; });
  });
}

const _pkgSetOpen = new Set(['kinds']);
function _pkgSetToggle(id, open) { if (open) _pkgSetOpen.add(id); else _pkgSetOpen.delete(id); }
function pkgOpenSettings(sec) {
  _pkgSetOpen.add(sec);
  pkgShowView('settings');
  const d = document.getElementById('pkgSet_' + sec);
  if (d) { d.open = true; if (d.scrollIntoView) d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}

function pkgSettingsRender() {
  const box = document.getElementById('pkgSettingsView');
  if (!box || box.hidden) return;
  _pkgStyle2(); _pkgStyle3();
  const can = _pkgCanEdit(), E = escapeHtml, J = v => E(JSON.stringify(v)), dis = can ? '' : 'disabled';
  const ae = document.activeElement, keep = ae && ae.id && box.contains(ae) ? { id: ae.id, s: ae.selectionStart } : null;
  const sec = (id, title, sub, body, reset) => `<details class="pr-sec ps-sec" id="pkgSet_${id}" ${_pkgSetOpen.has(id) ? 'open' : ''} ontoggle="_pkgSetToggle('${id}',this.open)">
    <summary><span class="pr-sec-t">${title}${sub ? ` <em>${sub}</em>` : ''}</span><span class="pr-chev" aria-hidden="true"></span></summary>
    <div class="pr-sec-b">${body}${reset ? `<div class="ps-reset">${reset}</div>` : ''}</div></details>`;

  // kinds
  const L = _pkgKindsList();
  const kindsChanged = !!pkgSettings.kinds;
  const kindsBody = `<p class="pr-help">How package codes are grouped. The same kind at another price is the same package (UPS30BB = UPS60BB). Checked top to bottom: drag ⠿ to change the order. A code can match by pattern or be listed exactly.</p>
    <div class="ps-kinds" id="pkgKindsBox">${L.map((k, i) => `<div class="ps-kind" data-dnd-i="${i}" ${can ? 'draggable="true"' : ''} style="--kc:${E(k.color || '#e2e8f0')}">
      <div class="ps-kind-hd">
        <span class="ps-grip" title="Drag to reorder" aria-hidden="true">⠿</span>
        <input class="ps-ico" value="${E(k.ico || '🎁')}" aria-label="Icon" maxlength="4" ${dis} onchange="pkgKindSet(${i},'ico',this.value)">
        <input class="ps-name" value="${E(k.label)}" aria-label="Name" ${dis} onchange="pkgKindSet(${i},'label',this.value)">
        <input class="ps-key" value="${E(k.k)}" aria-label="Short key" title="Short key (BB, EC…)" ${dis} onchange="pkgKindSet(${i},'k',this.value)">
        <input type="color" class="ps-col" value="${E(k.color || '#e2e8f0')}" aria-label="Colour" ${dis} onchange="pkgKindSet(${i},'color',this.value)">
        <span class="ps-acts">
          <button type="button" class="pr-x" title="Up" aria-label="Move up" ${dis || (i ? '' : 'disabled')} onclick="pkgKindMove(${i},${i - 1})">↑</button>
          <button type="button" class="pr-x" title="Down" aria-label="Move down" ${dis || (i < L.length - 1 ? '' : 'disabled')} onclick="pkgKindMove(${i},${i + 1})">↓</button>
          ${can ? `<select class="ps-merge" aria-label="Merge into" onchange="pkgKindMerge(${i},this)"><option value="">Merge into…</option>${L.map((x, j) => j === i ? '' : `<option value="${j}">${E(x.label)}</option>`).join('')}</select>
          <button type="button" class="pr-x" title="Remove" aria-label="Remove ${E(k.label)}" onclick="pkgKindDel(${i})">✕</button>` : ''}
        </span>
      </div>
      <div class="ps-kind-b">
        <label>Code pattern<input value="${E(k.re || '')}" placeholder="e.g. BB$ (ends with BB)" ${dis} onchange="pkgKindSet(${i},'re',this.value)"></label>
        <label>IN-Gauge name<input value="${E(k.ig || '')}" placeholder="as IN-Gauge names it (optional)" ${dis} onchange="pkgKindSet(${i},'ig',this.value)"></label>
        <label class="ps-num">Price from<input type="number" min="0" step="0.5" inputmode="decimal" value="${+k.min || ''}" placeholder="—" ${dis} onchange="pkgKindSet(${i},'min',this.value)"></label>
        <label class="ps-num">to<input type="number" min="0" step="0.5" inputmode="decimal" value="${+k.max || ''}" placeholder="—" ${dis} onchange="pkgKindSet(${i},'max',this.value)"></label>
        <label class="ps-chk"><input type="checkbox" ${k.once ? 'checked' : ''} ${dis} onchange="pkgKindSet(${i},'once',this.checked)"> Once per stay</label>
      </div>
      <div class="ps-codes">${(k.codes || []).map((c, j) => `<span class="ps-chip"><code>${E(c)}</code>${can ? `<button type="button" aria-label="Remove ${E(c)}" onclick="pkgKindCodeDel(${i},${j})">✕</button>` : ''}</span>`).join('')}
        ${can ? `<input class="ps-add" placeholder="+ exact code(s)" aria-label="Add codes to ${E(k.label)}" onkeydown="if(event.key==='Enter'){event.preventDefault();pkgKindCode(${i},this)}" onchange="pkgKindCode(${i},this)">` : (k.codes || []).length ? '' : '<small>no exact codes</small>'}</div>
    </div>`).join('')}</div>
    <div class="ps-row">${can ? '<button type="button" class="pr-btn sm" onclick="pkgKindAdd()">+ Add a kind</button>' : ''}
      <label class="ps-try">Test a code <input id="pkgKindTryIn" value="${E(_pkgKindTry)}" placeholder="UPS30BB" oninput="pkgKindTry(this.value)"></label><span id="pkgKindTryOut" class="ps-tryout"></span></div>`;

  // rules as switches
  const ruleBody = `<p class="pr-help">The same rules as the ⚙️ Rules tab, as switches. The audit runs again at once.</p>
    <div class="ps-rules">${PKG_RULE_INFO.filter(R => R.k !== 'chainGap').map(R => {
      const on = !!_pkgRule(R.k), def = !!PKG_RULE_DEFAULTS[R.k];
      return `<label class="ps-rule${on !== def ? ' changed' : ''}"><span class="ps-sw"><input type="checkbox" role="switch" ${on ? 'checked' : ''} ${dis} onchange="pkgSetRule('${R.k}',this.checked);pkgSettingsRender()"><i></i></span>
        <span><b>${R.ico} ${E(R.t)}</b><small>${E(on ? (R.q || '') : (R.off || ''))}${on !== def ? ' · <em>changed</em>' : ''}</small></span></label>`;
    }).join('')}
    <label class="ps-rule slider"><span><b>📅 Days allowed between two bookings of one stay: <output id="pkgGapOut">${+_pkgRule('chainGap') || 0}</output></b>
      <small>0 = the new booking starts the day the old one ends. More days also joins a short break (a return visit can then look like an extension).</small></span>
      <input type="range" min="0" max="7" step="1" value="${+_pkgRule('chainGap') || 0}" ${dis} oninput="document.getElementById('pkgGapOut').textContent=this.value" onchange="pkgSetRule('chainGap',this.value);pkgSettingsRender()"></label></div>`;

  // keep
  const keepBody = `<div class="ps-rules">
    <label class="ps-rule slider"><span><b>Keep "fixed" marks for <output id="pkgDoneOut">${_pkgDoneDays()}</output> days</b><small>A package marked ✓ Fixed stays fixed this long, on every later report (unless a newer report still shows it wrong).</small></span>
      <input type="range" min="7" max="365" step="1" value="${_pkgDoneDays()}" ${dis} oninput="document.getElementById('pkgDoneOut').textContent=this.value" onchange="_pkgSaveSetting('doneDays',+this.value,'Keep fixed marks')"></label>
    <label class="ps-rule slider"><span><b>Remember packages for <output id="pkgMemOut">${_pkgSetting('memMonths')}</output> months</b><small>How far back the 🧠 memory reaches to recognise a package continuing from an earlier month.</small></span>
      <input type="range" min="1" max="36" step="1" value="${_pkgSetting('memMonths')}" ${dis} oninput="document.getElementById('pkgMemOut').textContent=this.value" onchange="_pkgSaveSetting('memMonths',+this.value,'Remember packages')"></label></div>`;

  // columns
  const colTable = (which, fields, title) => {
    const H = pkgLastHeaders[which], map = (pkgSettings.colMap || {})[which] || {};
    const C = H ? _pkgMapColumns(H.hdrs, fields, which) : null;
    const auto = H ? _pkgMapColumns(H.hdrs, fields, which, {}) : null;
    return `<div class="ps-cols"><h4>${title}${H ? ` <small>· header on row ${H.row} of the last file</small>` : ' <small>· load a file to pick from its headers</small>'}</h4>
      ${H && H.missing.length ? `<div class="pr-note">Not found: ${E(H.missing.join(', '))}. Pick the right column below.</div>` : ''}
      ${fields.map(([f, label, names, req]) => {
        const ix = C ? C[f] : -1, prev = H && ix >= 0 ? H.sample.map(r => r[ix]).filter(v => v !== '').slice(0, 3) : [];
        const sel = H ? `<select ${dis} aria-label="${E(label)} column" onchange="pkgColSet('${which}','${f}',this.value)">
            <option value="">Auto${auto && auto[f] >= 0 ? ': ' + E(H.hdrs[auto[f]]) : ' (not found)'}</option>
            ${H.hdrs.map(h => h ? `<option value="${E(h)}"${map[f] && map[f].toLowerCase() === h.toLowerCase() ? ' selected' : ''}>${E(h)}</option>` : '').join('')}
            ${map[f] && !H.hdrs.some(h => h.toLowerCase() === map[f].toLowerCase()) ? `<option value="${E(map[f])}" selected>${E(map[f])} (not in this file)</option>` : ''}</select>`
          : `<input ${dis} value="${E(map[f] || '')}" placeholder="${E(names[0])}" aria-label="${E(label)} header" onchange="pkgColSet('${which}','${f}',this.value.trim())">`;
        return `<div class="ps-col-row${req ? ' req' : ''}"><span>${E(label)}${req ? ' *' : ''}</span>${sel}<small>${prev.length ? E(prev.join(' · ')) : H ? '—' : ''}</small></div>`;
      }).join('')}</div>`;
  };
  const chromeTxt = (pkgSettings.chrome || []).join('\n');
  const colBody = `<p class="pr-help">If an export renames a column, pick the right one here. Auto finds the usual names; * = needed. The preview shows the first values.</p>
    ${colTable('ig', PKG_IG_FIELDS, '🎁 IN-Gauge export')}${colTable('guest', PKG_GUEST_FIELDS, '👤 Guest list (Arrivals / reservations export)')}
    <label class="ps-area">Extra lines to ignore in the Opera Changes Log PDF (one per line; the hotel name under the logo is ignored already)
      <textarea rows="2" ${dis} placeholder="e.g. Hotel name as printed in the report footer" onchange="_pkgSaveSetting('chrome',this.value.split('\\n').map(x=>x.trim()).filter(Boolean),'Report lines to ignore')">${E(chromeTxt)}</textarea></label>`;

  // team
  const all = Object.entries(pkgStaffDb || {}).filter(([, s]) => s && s.name).sort((a, b) => String(a[1].name).localeCompare(String(b[1].name)));
  const active = all.filter(([, s]) => s.status !== 'left'), left = all.filter(([, s]) => s.status === 'left');
  const unk = pkgResults.length ? _pkgUnknownLogins() : [];
  const person = ([id, s]) => `<div class="ps-person${s.status === 'left' ? ' left' : ''}">
      <div class="ps-p-hd"><b>${E(s.name)}</b>
        <span class="pa-chip ${s.status === 'left' ? 'muted' : 'ok'}">${s.status === 'left' ? 'Left ' + E(s.left || '') : 'Active' + (s.since ? ' since ' + E(s.since) : '')}</span>
        ${can ? `<span class="ps-acts"><button type="button" class="pr-btn sm" onclick="pkgTeamRename(${J(id)})">Rename</button>
          <button type="button" class="pr-btn sm" onclick="pkgTeamLeft(${J(id)})">${s.status === 'left' ? 'Back on team' : 'Left'}</button>
          <button type="button" class="pr-x" title="Delete" aria-label="Delete ${E(s.name)}" onclick="pkgStaffDel(${J(id)})">✕</button></span>` : ''}</div>
      ${(s.former || []).length ? `<small class="ps-was">was ${s.former.map(f => `${E(f.name)}${f.until ? ' (until ' + E(f.until) + ')' : ''}`).join(', ')}</small>` : ''}
      <div class="ps-codes">${(s.logins || []).map((l, j) => `<span class="ps-chip"><code>${E(l)}</code>${can ? `<button type="button" aria-label="Remove ${E(l)}" onclick="pkgTeamAliasDel(${J(id)},${j})">✕</button>` : ''}</span>`).join('') || '<small>matched by family name</small>'}
        ${can ? `<input class="ps-add" placeholder="+ login / other spelling" aria-label="Add a login for ${E(s.name)}" onkeydown="if(event.key==='Enter'){event.preventDefault();pkgTeamAlias(${J(id)},this)}" onchange="pkgTeamAlias(${J(id)},this)">` : ''}</div>
    </div>`;
  const teamBody = `<p class="pr-help">This hotel's team. Opera shows logins (like CHAIN-SALVAREZ), IN-Gauge shows names: each person's logins and other spellings join them. Someone who <b>left</b> keeps the sales they made but is not offered for new ones. <b>Rename</b> keeps the old name, so earlier sales still count.</p>
    ${active.map(person).join('') || '<div class="pa-more">No names yet.</div>'}
    ${left.length ? `<button type="button" class="pr-link" onclick="_pkgTeamShowLeft=!_pkgTeamShowLeft;pkgSettingsRender()">${_pkgTeamShowLeft ? 'Hide' : 'Show'} ${left.length} who left</button>${_pkgTeamShowLeft ? left.map(person).join('') : ''}` : ''}
    ${can ? `<div class="pa-addstaff"><input id="pkgStaffName" placeholder="Name, as in IN-Gauge" autocomplete="off"><input id="pkgStaffLogins" placeholder="Opera login(s), optional" autocomplete="off"><button type="button" class="btn gold sm" onclick="pkgStaffAdd()">Add</button></div>` : ''}
    ${unk.length ? `<div class="pa-unk"><small>Logins in the loaded log with no name${can ? ': pick who it is' : ''}</small>${unk.slice(0, 20).map(u => can
      ? `<label class="ps-unk"><code>${E(u.login)}</code> <em>${u.n}</em><select aria-label="Who is ${E(u.login)}" onchange="pkgTeamAssign(${J(u.login)},this)"><option value="">→ who?</option>${active.map(([id, s]) => `<option value="${E(id)}">${E(s.name)}</option>`).join('')}<option value="__new">New person…</option></select></label>`
      : `<span class="pa-chip">${E(u.login)} <em>${u.n}</em></span>`).join('')}</div>` : ''}
    ${can ? `<details class="ps-import"><summary>⤓ Import a team list (paste or file)</summary>
      <p class="pr-help">One per line: <code>Name</code>, <code>Name = login, login</code>, or CSV <code>Name,login;login,left,2026-09-30</code>. Existing people are updated (logins added), nobody is removed.</p>
      <textarea id="pkgTeamPaste" rows="5" placeholder="Sam ALVAREZ = CHAIN-SALVAREZ&#10;Lina MORENO,CHAIN-LMORENO2&#10;Test PERSON,CHAIN-TPERSON,left,2026-09-30" oninput="pkgTeamPreview()"></textarea>
      <div class="ps-row"><label class="pr-btn sm ps-file">📂 From a file (.csv / .txt / .xlsx)<input type="file" accept=".csv,.txt,.tsv,.xlsx,.xls" hidden onchange="pkgTeamFile(this)"></label>
        <span id="pkgTeamPrev" class="ps-tryout"></span><button type="button" class="btn gold sm" onclick="pkgTeamImport()">Import</button></div></details>` : ''}`;

  // another hotel
  const kitBody = `<p class="pr-help">Using Package Audit at another hotel? Copy this hotel's setup (package kinds, rules, report columns, keep times, commission %), then paste it there. <b>The team, memory and frozen sellers are not copied</b>: every hotel keeps its own.</p>
    <div class="ps-row"><button type="button" class="btn gold sm" onclick="pkgKitCopy()">📦 Start for another hotel: copy this setup</button></div>
    ${can ? `<label class="ps-area">Paste a setup from another hotel<textarea id="pkgKitIn" rows="3" placeholder='{"app":"hotelops-package-audit", …}'></textarea></label>
    <div class="ps-row"><button type="button" class="pr-btn sm" onclick="pkgKitImport()">Use this setup here</button></div>` : ''}`;

  // my view
  const P = _pkgViewPrefs(), lbl = f => (PKG_CHIP_FIELDS.find(x => x[0] === f) || [0, f])[1];
  const viewBody = `<p class="pr-help">Your own choice (only for you, on every device): which values each package card shows with a copy button, and their order. Drag ⠿ or use ↑ ↓.</p>
    <div class="ps-chips" id="pkgViewBox">${P.chips.map((f, i) => `<div class="ps-vrow" data-dnd-i="${i}" draggable="true"><span class="ps-grip" aria-hidden="true">⠿</span>
      <label class="ps-chk"><input type="checkbox" ${P.hidden.includes(f) ? '' : 'checked'} onchange="pkgViewToggle('${f}',this.checked)"> ${E(lbl(f))}</label>
      <span class="ps-acts"><button type="button" class="pr-x" aria-label="Move ${E(lbl(f))} up" ${i ? '' : 'disabled'} onclick="pkgViewMove('${f}',-1)">↑</button><button type="button" class="pr-x" aria-label="Move ${E(lbl(f))} down" ${i < P.chips.length - 1 ? '' : 'disabled'} onclick="pkgViewMove('${f}',1)">↓</button></span></div>`).join('')}</div>`;

  const resetBtn = (fn, txt) => can ? `<button type="button" class="pr-btn sm" onclick="${fn}">↺ ${txt || 'Reset to default'}</button>` : '';
  const changedRules = Object.keys(PKG_RULE_DEFAULTS).filter(k => pkgRules[k] !== PKG_RULE_DEFAULTS[k]).length;
  box.innerHTML = `<div class="pr-rules ps">
    <div class="pr-head"><div class="pr-head-row"><div class="pr-title"><h2>🛠 Package Audit settings</h2><p>Everything here is changed on screen: no code. Shared settings are for the whole hotel${can ? '' : ' (read only for your role)'}; "My view" is yours.</p></div></div></div>
    ${!can ? '<div class="pr-ro">🔒 Only a manager (or a role allowed to edit the checklist) can change the shared settings. You can change My view.</div>' : ''}
    ${sec('kinds', '🎁 Package kinds', L.length + (kindsChanged ? ' · changed' : ''), kindsBody, kindsChanged ? resetBtn("_pkgSaveSetting('kinds',null,'Package kinds')") : '')}
    ${sec('rules', '⚙️ Rule defaults', changedRules ? changedRules + ' changed' : null, ruleBody, changedRules ? resetBtn('pkgRulesReset();pkgSettingsRender()') : '')}
    ${sec('team', '👥 Team', `${active.length} active${left.length ? ' · ' + left.length + ' left' : ''}`, teamBody)}
    ${sec('cols', '📑 Report columns', Object.keys((pkgSettings.colMap || {}).ig || {}).length + Object.keys((pkgSettings.colMap || {}).guest || {}).length ? 'mapped' : null, colBody, pkgSettingsRaw.colMap || pkgSettingsRaw.chrome ? resetBtn("pkgColReset();_pkgSaveSetting('chrome',null)") : '')}
    ${sec('keep', '🗓 Keep & remember', null, keepBody, pkgSettingsRaw.doneDays || pkgSettingsRaw.memMonths ? resetBtn("_pkgSaveSetting('doneDays',null);_pkgSaveSetting('memMonths',null)") : '')}
    ${sec('view', '👁 My view', null, viewBody, `<button type="button" class="pr-btn sm" onclick="_pkgSaveView({})">↺ Reset my view</button>`)}
    ${sec('hotel', '🏨 Another hotel', null, kitBody)}
  </div>`;
  if (can) _pkgDnd(document.getElementById('pkgKindsBox'), (a, b) => pkgKindMove(a, b));
  _pkgDnd(document.getElementById('pkgViewBox'), (a, b) => { const p = _pkgViewPrefs(); const [x] = p.chips.splice(a, 1); p.chips.splice(b, 0, x); _pkgSaveView(p); });
  if (_pkgKindTry) pkgKindTry(_pkgKindTry);
  if (keep) { const el = document.getElementById(keep.id); if (el) { el.focus(); try { if (keep.s != null) el.setSelectionRange(keep.s, keep.s); } catch (_) {} } }
}

// ── 🧠 Memory view ───────────────────────────────────────────
let _pkgMemQ = '', _pkgMemAll = false;
function pkgMemoryOpen(conf) { _pkgMemQ = String(conf || ''); pkgShowView('memory'); }
function pkgMemorySearch(v) { _pkgMemQ = String(v || ''); _pkgMemAll = false; pkgMemoryRender(); }
function _pkgMemRecs() {
  const out = [];
  Object.values(pkgMemory || {}).forEach(o => Object.values(o).forEach(r => out.push(r)));
  return out;
}
function _pkgMemMatch(r, q) {
  if (!q) return true;
  const hay = [r.conf, r.guest, r.code, r.kind, r.sellerName, r.room, (_pkgKindEntry(r.code || r.kind) || [, ''])[1]].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}
function pkgMemoryForget(conf, kind) {
  const rec = (pkgMemory[conf] || {})[kind]; if (!rec) return;
  if (!_pkgCanEdit()) { showToast('Only a manager can forget a remembered package', 'warn'); return; }
  const o = Object.assign({}, pkgMemory[conf]); delete o[kind];
  pkgMemory = Object.assign({}, pkgMemory); if (Object.keys(o).length) pkgMemory[conf] = o; else delete pkgMemory[conf];
  if (typeof fbSet === 'function') fbSet(`packageAudit/memory/${conf}/${kind}`, null);
  if (typeof logActivity === 'function') logActivity('pkg_memory', `Forgot ${conf} · ${rec.code || kind}`);
  pkgMemoryRender(); _pkgMemoryRecomputeSoon();
  if (typeof showUndoToast === 'function') showUndoToast(`Forgot ${conf} · ${rec.code || kind}`, () => {
    pkgMemory = Object.assign({}, pkgMemory, { [conf]: Object.assign({}, pkgMemory[conf], { [kind]: rec }) });
    if (typeof fbSet === 'function') fbSet(`packageAudit/memory/${conf}/${kind}`, rec);
    pkgMemoryRender(); _pkgMemoryRecomputeSoon();
  });
}
function pkgMemoryRender() {
  const box = document.getElementById('pkgMemoryView');
  if (!box || box.hidden) return;
  _pkgStyle2(); _pkgStyle3();
  const E = escapeHtml, J = v => E(JSON.stringify(v)), can = _pkgCanEdit();
  const ae = document.activeElement, focus = ae && ae.id === 'pkgMemIn', caret = focus ? ae.selectionStart : 0;
  const all = _pkgMemRecs();
  const months = [...new Set(all.flatMap(r => Object.keys(r.months || {})))].sort();
  const hits = all.filter(r => _pkgMemMatch(r, _pkgMemQ.trim())).sort((a, b) => String(b.last).localeCompare(String(a.last)) || String(a.room).localeCompare(String(b.room), undefined, { numeric: true }));
  const byConf = new Map(); hits.forEach(r => { if (!byConf.has(r.conf)) byConf.set(r.conf, []); byConf.get(r.conf).push(r); });
  const confs = [...byConf.keys()], shown = _pkgMemAll ? confs : confs.slice(0, 60);
  const gidx = _pkgMemGuestIndex(pkgMemory);
  const card = conf => {
    const recs = byConf.get(conf), r0 = recs[0];
    const same = ((r0.gid && gidx['ID:' + r0.gid]) || (r0.gnorm && gidx['NM:' + r0.gnorm]) || []).filter(x => x.conf !== conf);
    const sameConfs = [...new Set(same.map(x => x.conf))];
    return `<article class="pm-card">
      <div class="pa-top"><span class="pa-room sm">${E(r0.room || '—')}</span>
        <div class="pa-pk"><b>${E(r0.guest || 'Guest not known')}</b><small><code>${E(conf)}</code>${r0.arr ? ' · ' + E(r0.arr) + ' → ' + E(r0.dep || '?') : ''}</small></div>
        <span class="pa-chip">${E(_pkgMonShort(r0.first))}${r0.last !== r0.first ? ' → ' + E(_pkgMonShort(r0.last)) : ''}</span></div>
      ${recs.map(r => { const k = _pkgKindEntry(r.code || r.kind);
        return `<div class="pm-rec"><span class="pm-k" style="--kc:${E((k && k.color) || '#e2e8f0')}">${E((k && k.ico) || '🎁')} ${E((k && k[1]) || r.kind)}</span>
          <div class="pm-main"><b>${E(r.sellerName || r.seller)}</b> <small>${E(r.code || '')}${r.price ? ' · AED ' + E(r.price) : ''} · ${E(_pkgD(r.from))}${r.to && r.to !== r.from ? ' → ' + E(_pkgD(r.to)) : ''} · ${E(_PKG_HOW[r.how] || r.how || '')}${r.fixed ? ' · ✓ fixed by ' + E(String(r.fixed.by || '').split(' ')[0] || 'someone') : ''}</small>
            <div class="pm-months">${Object.keys(r.months || {}).sort().map(m => `<span class="pa-chip"><b>${E(_pkgMonShort(m))}</b> ${E(r.months[m].seller || '')} · ${r.months[m].n} night${r.months[m].n === 1 ? '' : 's'} · ${E(_pkgbN(r.months[m].aed))}</span>`).join('')}</div></div>
          ${can ? `<button type="button" class="pa-undo" title="Forget this package" onclick="pkgMemoryForget(${J(conf)},${J(r.kind)})">Forget</button>` : ''}</div>`; }).join('')}
      ${sameConfs.length ? `<div class="pm-link">↪ Same guest: ${sameConfs.map(c => `<button type="button" class="pa-link" onclick="pkgMemorySearch(${J(c)});document.getElementById('pkgMemIn').value=${J(c)}">${E(c)}</button>`).join(' ')}</div>` : ''}
    </article>`;
  };
  const sug = _pkgLearnSuggestions();
  const rules = Object.values(pkgLearned || {}).filter(L => L && L.type && !L.dismissed);
  const learnHtml = (sug.length || rules.length) ? `<section class="pr-card pr-sugg"><h3><span>🧠</span> Learned from your decisions</h3>
    ${sug.map(L => `<div class="pr-sg warn"><span>${E(L.text)}. Decide it the same way next time?</span><span class="ps-acts">${can ? `<button type="button" class="pr-btn sm" onclick="pkgLearnAccept(${J(L.id)})">✓ Accept</button><button type="button" class="pr-x" aria-label="Dismiss" onclick="pkgLearnDismiss(${J(L.id)})">✕</button>` : '<small>a manager can accept it</small>'}</span></div>`).join('')}
    ${rules.map(L => `<div class="pr-sg ok"><span>✓ ${E(_pkgLearnedText(L))} <small>· by ${E(L.by || 'someone')}${L.at ? ' · ' + E(String(L.at).slice(0, 10)) : ''}</small></span>${can ? `<button type="button" class="pr-btn sm" onclick="pkgLearnRemove(${J(L.id)})">Remove</button>` : ''}</div>`).join('')}</section>` : '';
  box.innerHTML = `<div class="pr-rules">
    <div class="pr-head"><div class="pr-head-row"><div class="pr-title"><h2>🧠 Package memory</h2>
      <p>Every package the audit has resolved: ${confs.length === all.length ? '' : ''}<b>${all.length}</b> package${all.length === 1 ? '' : 's'} on <b>${Object.keys(pkgMemory).length}</b> booking${Object.keys(pkgMemory).length === 1 ? '' : 's'}${months.length ? `, ${E(_pkgMonShort(months[0]))} → ${E(_pkgMonShort(months[months.length - 1]))}` : ''}. Next month, a package that continues keeps its seller.</p></div>
      <button type="button" class="pr-btn" ${all.length ? '' : 'disabled'} onclick="pkgMemoryExport()">📊 Excel</button></div>
      <label class="pr-try" for="pkgMemIn"><span class="pr-try-ico" aria-hidden="true">🔍</span><input id="pkgMemIn" type="search" autocomplete="off" placeholder="Confirmation no., guest, package code or seller" value="${E(_pkgMemQ)}" oninput="pkgMemorySearch(this.value)"></label></div>
    ${learnHtml}
    ${!all.length ? `<div class="pa-empty"><b>Nothing remembered yet.</b><span>Run the audit (📋 Audit → Check the charges): every package it resolves is remembered here for next month.</span></div>`
      : !confs.length ? '<div class="pa-empty">No remembered package matches your search.</div>'
      : `<div class="pa-list">${shown.map(card).join('')}</div>${confs.length > shown.length ? `<button type="button" class="pr-link" onclick="_pkgMemAll=true;pkgMemoryRender()">Show all ${confs.length}</button>` : ''}`}
  </div>`;
  if (focus) { const i = document.getElementById('pkgMemIn'); if (i) { i.focus(); try { i.setSelectionRange(caret, caret); } catch (_) {} } }
}
async function pkgMemoryExport() {
  const recs = _pkgMemRecs().filter(r => _pkgMemMatch(r, _pkgMemQ.trim()));
  if (!recs.length) return;
  const months = [...new Set(recs.flatMap(r => Object.keys(r.months || {})))].sort();
  const head = ['Confirmation', 'Room', 'Guest', 'Kind', 'Code', 'Price AED', 'From', 'To', 'Seller', 'Decided by', 'First month', 'Last month', ...months.map(m => _pkgMonShort(m) + ' AED')];
  const rows = recs.sort((a, b) => String(a.conf).localeCompare(String(b.conf))).map(r => [r.conf, r.room, r.guest, (_pkgKindEntry(r.code || r.kind) || [, r.kind])[1], r.code, +r.price || 0, _pkgD(r.from), _pkgD(r.to), r.sellerName || r.seller, _PKG_HOW[r.how] || r.how, _pkgMonShort(r.first), _pkgMonShort(r.last), ...months.map(m => (r.months[m] || {}).aed || '')]);
  await _pkgXlsx('Package_memory', 'Package memory', `${recs.length} packages · ${_pkgMonShort(months[0])} → ${_pkgMonShort(months[months.length - 1])}`,
    [{ name: 'Memory', head, rows, money: [5, ...months.map((_, i) => 12 + i)] }], [['Packages', recs.length], ['Bookings', new Set(recs.map(r => r.conf)).size], ['Months', months.length]]);
}

// ── Styled Excel (ExcelJS, like the Gym / Handover reports; plain SheetJS offline) ──
const _PKG_EXCELJS = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
let _pkgExLoad = null;
function _pkgLoadExcelJS() {
  if (window.ExcelJS && window.ExcelJS.Workbook) return Promise.resolve(window.ExcelJS);
  if (_pkgExLoad) return _pkgExLoad;
  _pkgExLoad = new Promise((ok, no) => {
    const sc = document.createElement('script'); sc.src = _PKG_EXCELJS; sc.async = true; sc.crossOrigin = 'anonymous';
    const t = setTimeout(() => no(new Error('timeout')), 12000);
    sc.onload = () => { clearTimeout(t); window.ExcelJS && window.ExcelJS.Workbook ? ok(window.ExcelJS) : no(new Error('no ExcelJS')); };
    sc.onerror = () => { clearTimeout(t); no(new Error('not loaded')); };
    document.head.appendChild(sc);
  }).catch(e => { _pkgExLoad = null; throw e; });
  return _pkgExLoad;
}
/** sheets: [{ name, head, rows, money: [col indexes], delta: [col indexes], total: row }] */
async function _pkgXlsx(file, title, sub, sheets, kpis) {
  if (typeof hoRoleRules !== 'undefined' && hoRoleRules.can && hoRoleRules.can('canExport') === false) { showToast('Downloading files is not available for your role', 'err'); return; }
  const hotel = String((document.getElementById('hotelName') || {}).textContent || '').replace(/\s+/g, ' ').trim();
  const stamp = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const save = (buf, ext) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = `${file}.${ext || 'xlsx'}`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };
  try {
    const EJ = await _pkgLoadExcelJS();
    const wb = new EJ.Workbook(); wb.creator = 'HotelOps'; wb.created = new Date(); wb.title = title;
    const C = { band: 'FF1E293B', gold: 'FFC9A227', zebra: 'FFF8FAFC', line: 'FFE2E8F0', ink: 'FF0F172A', white: 'FFFFFFFF', total: 'FFFEF9E7', up: 'FF166534', down: 'FF991B1B', kpi: ['FFDBEAFE', 'FF1E40AF'] };
    const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
    const font = o => Object.assign({ name: 'Calibri', size: 11, color: { argb: C.ink } }, o);
    const thin = { style: 'thin', color: { argb: C.line } }, box = { top: thin, left: thin, bottom: thin, right: thin };
    sheets.forEach(S => {
      const n = Math.max(S.head.length, 3);
      const ws = wb.addWorksheet(S.name.slice(0, 31), { properties: { tabColor: { argb: C.gold } }, views: [{ showGridLines: false }] });
      ws.columns = S.head.map((h, i) => ({ width: Math.min(40, Math.max(10, String(h).length + 2, ...S.rows.slice(0, 200).map(r => String(r[i] ?? '').length + 2))) }));
      ws.mergeCells(1, 1, 1, n); Object.assign(ws.getCell(1, 1), { value: (hotel || 'HotelOps').toUpperCase() }); ws.getCell(1, 1).font = font({ size: 9.5, bold: true, color: { argb: 'FFF5D97A' } });
      ws.mergeCells(2, 1, 2, n); ws.getCell(2, 1).value = title; ws.getCell(2, 1).font = font({ size: 20, bold: true, color: { argb: C.white } });
      ws.mergeCells(3, 1, 3, n); ws.getCell(3, 1).value = `${sub} · ${stamp}${_pkgMe() ? ' · Prepared by ' + _pkgMe() : ''}`; ws.getCell(3, 1).font = font({ size: 10.5, color: { argb: 'FFCBD5E1' } });
      for (let r = 1; r <= 3; r++) for (let c = 1; c <= n; c++) { ws.getCell(r, c).fill = fill(C.band); ws.getCell(r, c).alignment = { vertical: 'middle', indent: 1 }; }
      for (let c = 1; c <= n; c++) ws.getCell(3, c).border = { bottom: { style: 'thick', color: { argb: C.gold } } };
      ws.getRow(2).height = 32; ws.getRow(3).height = 20;
      let H = 5;
      if (kpis && kpis.length) {
        const per = Math.max(1, Math.floor(n / kpis.length));
        kpis.forEach(([label, v], i) => {
          const c1 = i * per + 1, c2 = i === kpis.length - 1 ? n : Math.min(n, c1 + per - 1);
          if (c1 > n) return;
          if (c2 > c1) { ws.mergeCells(5, c1, 5, c2); ws.mergeCells(6, c1, 6, c2); }
          const vc = ws.getCell(5, c1), lc = ws.getCell(6, c1);
          vc.value = v; vc.font = font({ size: 18, bold: true, color: { argb: C.kpi[1] } }); vc.alignment = { horizontal: 'center' };
          lc.value = String(label).toUpperCase(); lc.font = font({ size: 8.5, bold: true, color: { argb: C.kpi[1] } }); lc.alignment = { horizontal: 'center' };
          for (let c = c1; c <= c2; c++) [5, 6].forEach(r => { ws.getCell(r, c).fill = fill(C.kpi[0]); });
        });
        ws.getRow(5).height = 30; H = 8;
      }
      const hr = ws.getRow(H); hr.values = S.head; hr.height = 24;
      S.head.forEach((_, i) => { const c = hr.getCell(i + 1); c.font = font({ bold: true, color: { argb: C.white } }); c.fill = fill(C.band); c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
      const all = S.total ? S.rows.concat([S.total]) : S.rows;
      all.forEach((cells, k) => {
        const row = ws.getRow(H + 1 + k); row.values = cells; row.height = 19;
        const isTot = S.total && k === all.length - 1;
        cells.forEach((v, i) => {
          const c = row.getCell(i + 1); c.border = box; c.font = font({ size: 10.5, bold: isTot });
          if (isTot) c.fill = fill(C.total); else if (k % 2) c.fill = fill(C.zebra);
          if ((S.money || []).includes(i) && typeof v === 'number') { c.numFmt = '#,##0.00;-#,##0.00;"–"'; c.alignment = { horizontal: 'right' }; }
          if ((S.delta || []).includes(i) && typeof v === 'number') { c.numFmt = '+#,##0.00;-#,##0.00;"="'; c.font = font({ size: 10.5, bold: true, color: { argb: v > 0 ? C.up : v < 0 ? C.down : C.ink } }); }
        });
      });
      ws.autoFilter = { from: { row: H, column: 1 }, to: { row: H + Math.max(1, S.rows.length), column: S.head.length } };
      ws.views = [{ state: 'frozen', ySplit: H, showGridLines: false }];
      ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    });
    save(new Uint8Array(await wb.xlsx.writeBuffer()));
    showToast('Excel saved', 'ok');
  } catch (e) {
    if (typeof XLSX === 'undefined') { showToast('Excel could not be made offline', 'err'); return; }
    const wb = XLSX.utils.book_new();
    sheets.forEach(S => { const ws = XLSX.utils.aoa_to_sheet([[title], [sub], [], S.head, ...S.rows, ...(S.total ? [S.total] : [])]); XLSX.utils.book_append_sheet(wb, ws, S.name.slice(0, 31)); });
    save(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
    showToast('Excel saved (plain: the styled version needs a connection)', 'ok');
  }
  if (typeof logActivity === 'function') logActivity('pkg_export', title);
}

// ── Styles for the copy values, Fixed, Memory and Settings (theme variables only) ──
function _pkgStyle3() {
  if (document.getElementById('pkgStyle3')) return;
  const st = document.createElement('style'); st.id = 'pkgStyle3';
  st.textContent = `
.pa-count{font-size:.9rem;color:var(--text)} .pa-count i{font-style:normal;color:var(--text3);margin:0 2px} .pa-count .ok{color:var(--green)}
.pa-vals{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px;min-width:0}
.pa-v{display:inline-flex;align-items:center;gap:6px;max-width:100%;min-width:0;padding:3px 4px 3px 9px;border:1px solid var(--border);border-radius:9px;background:var(--bg2)}
.pa-v small{font:600 .56rem var(--mono);text-transform:uppercase;letter-spacing:.05em;color:var(--text3);flex:none}
.pa-v code{font:600 .78rem var(--mono)!important;color:var(--text)!important;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;user-select:all;-webkit-user-select:all}
.pa-v.em{border-color:color-mix(in srgb,var(--green) 45%,var(--border))}
.pa-cc{flex:none;border:1px solid var(--border2);background:var(--card);color:var(--text2);border-radius:7px;padding:3px 8px;min-height:28px;font:600 .66rem var(--font,inherit);cursor:copy}
.pa-cc:hover{color:var(--text);border-color:var(--gold,var(--accent))} .pa-cc.copied{color:var(--green);border-color:var(--green)}
.pa-fix{border:1px solid var(--green);background:color-mix(in srgb,var(--green) 14%,var(--card));color:var(--green);border-radius:10px;padding:6px 14px;min-height:36px;font:700 .78rem var(--font,inherit);cursor:pointer;white-space:nowrap}
.pa-fix:hover{background:var(--green);color:#fff}
.pa-fix.undo{border-color:var(--border2);background:var(--bg2);color:var(--text2);font-weight:600} .pa-fix.undo:hover{color:var(--text);background:var(--bg2)}
.pa-card.is-fixed{opacity:.92} .pa-card.is-fixed .pa-act{color:var(--green)}
.pa-fixed{margin-top:14px;border:1px solid var(--border);border-radius:var(--r,12px);background:color-mix(in srgb,var(--green) 4%,var(--card))}
.pa-fixed>summary{cursor:pointer;list-style:none;display:flex;flex-wrap:wrap;gap:2px 10px;align-items:baseline;padding:12px 14px}
.pa-fixed>summary::-webkit-details-marker{display:none}
.pa-fixed>summary span{font-weight:700;font-size:.86rem;color:var(--text)} .pa-fixed>summary em{font:600 .7rem var(--mono);font-style:normal;color:var(--green);background:color-mix(in srgb,var(--green) 14%,transparent);border-radius:999px;padding:2px 8px;margin-left:4px}
.pa-fixed>summary small{color:var(--text3);font-size:.7rem}
.pa-fixed>.pa-list{padding:0 10px 10px}
.pa-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}
.pa-carry{border:1px solid color-mix(in srgb,var(--gold,#e8b84b) 50%,var(--border));background:color-mix(in srgb,var(--gold,#e8b84b) 12%,var(--card));color:var(--text);border-radius:999px;padding:3px 10px;min-height:26px;font:600 .7rem var(--font,inherit);cursor:pointer}
.pa-carry:hover{border-color:var(--gold,var(--accent))}
.pm-card{border:1px solid var(--border);border-radius:var(--r,12px);background:var(--card);padding:11px 12px;min-width:0}
.pm-rec{display:flex;gap:10px;align-items:flex-start;margin-top:9px;padding-top:9px;border-top:1px dashed var(--border);min-width:0}
.pm-k{flex:none;padding:3px 8px;border-radius:8px;background:color-mix(in srgb,var(--kc) 55%,var(--card));color:var(--text);font:600 .72rem var(--font,inherit);white-space:nowrap}
.pm-main{flex:1;min-width:0;font-size:.8rem;color:var(--text);overflow-wrap:anywhere} .pm-main small{color:var(--text3);font-size:.7rem}
.pm-months{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px} .pm-months .pa-chip{white-space:normal}
.pm-link{margin-top:8px;font-size:.74rem;color:var(--text2)}
.ps .pr-sec-b{gap:10px}
.ps-reset{display:flex;justify-content:flex-end;margin-top:4px}
.ps-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.ps-acts{display:inline-flex;gap:2px;align-items:center;margin-left:auto;flex-wrap:wrap}
.ps-kinds{display:flex;flex-direction:column;gap:8px}
.ps-kind{border:1px solid var(--border);border-left:5px solid var(--kc);border-radius:10px;background:var(--card);padding:8px 10px;min-width:0}
.ps-kind.dragging,.ps-vrow.dragging{opacity:.5} .ps-kind.over,.ps-vrow.over{box-shadow:0 -3px 0 var(--gold,var(--accent))}
.ps-kind-hd{display:flex;gap:6px;align-items:center;flex-wrap:wrap;min-width:0}
.ps-grip{cursor:grab;color:var(--text3);font-size:1rem;user-select:none;padding:0 2px}
.ps input:not([type=checkbox]):not([type=range]):not([type=color]),.ps select,.ps textarea{border:1px solid var(--border2);background:var(--bg2);color:var(--text);border-radius:8px;padding:6px 8px;font-size:16px;font-family:inherit;min-width:0;max-width:100%}
.ps .ps-ico{width:46px;text-align:center} .ps .ps-name{flex:1 1 120px;font-weight:600} .ps .ps-key{width:70px;font-family:var(--mono)!important;text-transform:uppercase}
.ps-col{width:36px;height:34px;padding:0;border:1px solid var(--border2);border-radius:8px;background:none}
.ps .ps-merge{max-width:140px;font-size:.8rem}
.ps-kind-b{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1.3fr) 90px 90px auto;gap:6px 8px;margin-top:8px;align-items:end}
.ps-kind-b label,.ps-try,.ps-area{display:flex;flex-direction:column;gap:3px;font:600 .62rem var(--mono);text-transform:uppercase;letter-spacing:.04em;color:var(--text3);min-width:0}
.ps-chk{display:inline-flex!important;flex-direction:row!important;align-items:center;gap:6px;font:500 .8rem var(--font,inherit)!important;text-transform:none!important;letter-spacing:0!important;color:var(--text)!important;min-height:36px}
.ps-chk input{width:18px;height:18px}
.ps-codes{display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-top:7px} .ps-codes small{color:var(--text3);font-size:.7rem}
.ps-chip{display:inline-flex;align-items:center;gap:2px;padding:1px 2px 1px 8px;border-radius:999px;background:var(--bg2);border:1px solid var(--border)}
.ps-chip code{font:600 .7rem var(--mono);color:var(--text)}
.ps-chip button{border:0;background:none;color:var(--text3);cursor:pointer;min-width:26px;min-height:26px;border-radius:50%} .ps-chip button:hover{color:var(--red)}
.ps .ps-add{width:170px;font-size:16px;padding:4px 8px}
.ps-try{flex-direction:row;align-items:center;gap:6px} .ps-try input{width:130px}
.ps-tryout{font-size:.78rem;color:var(--text2)}
.ps-rules{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:10px;overflow:hidden}
.ps-rule{display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border-top:1px solid var(--border);cursor:pointer;min-width:0}
.ps-rule:first-child{border-top:0} .ps-rule.changed{background:color-mix(in srgb,var(--gold,#e8b84b) 7%,var(--card))}
.ps-rule>span{min-width:0} .ps-rule b{display:block;font-size:.82rem;color:var(--text)} .ps-rule small{display:block;font-size:.72rem;color:var(--text3);line-height:1.4;margin-top:2px} .ps-rule em{color:var(--gold,var(--accent));font-style:normal}
.ps-rule.slider{flex-direction:column;gap:6px;cursor:default} .ps-rule.slider input{width:100%;accent-color:var(--gold,var(--accent))}
.ps-sw{position:relative;flex:none;width:42px;height:24px;margin-top:2px}
.ps-sw input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer}
.ps-sw i{position:absolute;inset:0;border-radius:999px;background:var(--border2);transition:background .2s}
.ps-sw i::after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:transform .2s}
.ps-sw input:checked+i{background:var(--green)} .ps-sw input:checked+i::after{transform:translateX(18px)}
.ps-sw input:focus-visible+i{outline:2px solid var(--gold,var(--accent));outline-offset:2px}
.ps-sw input:disabled+i{opacity:.5}
.ps-cols{border:1px solid var(--border);border-radius:10px;padding:10px 12px} .ps-cols h4{margin:0 0 6px;font-size:.82rem;color:var(--text)} .ps-cols h4 small{font-weight:400;color:var(--text3)}
.ps-col-row{display:grid;grid-template-columns:150px minmax(0,220px) minmax(0,1fr);gap:8px;align-items:center;padding:5px 0;border-top:1px solid var(--border);font-size:.78rem;color:var(--text2)}
.ps-col-row:first-of-type{border-top:0} .ps-col-row.req>span{color:var(--text);font-weight:600}
.ps-col-row small{color:var(--text3);font-family:var(--mono);font-size:.68rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ps-area textarea{font:inherit;font-size:16px;text-transform:none;letter-spacing:0;resize:vertical}
.ps-person{border:1px solid var(--border);border-radius:10px;padding:8px 10px;background:var(--card);min-width:0}
.ps-person.left{opacity:.7;background:var(--bg2)}
.ps-p-hd{display:flex;gap:8px;align-items:center;flex-wrap:wrap} .ps-p-hd b{font-size:.86rem;color:var(--text);overflow-wrap:anywhere}
.ps-was{display:block;color:var(--text3);font-size:.7rem;margin-top:2px}
.ps-unk{display:inline-flex;align-items:center;gap:4px;border:1px dashed var(--border2);border-radius:9px;padding:2px 4px 2px 8px;font-size:.72rem}
.ps-unk select{font-size:.75rem!important;padding:3px 4px!important}
.ps-import{border:1px dashed var(--border2);border-radius:10px;padding:8px 10px} .ps-import summary{cursor:pointer;font-weight:600;font-size:.8rem;color:var(--text)}
.ps-import textarea{width:100%;margin:6px 0}
.ps-file{cursor:pointer;display:inline-flex;align-items:center}
.ps-chips{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:10px;overflow:hidden;max-width:460px}
.ps-vrow{display:flex;align-items:center;gap:8px;padding:2px 8px;border-top:1px solid var(--border);background:var(--card)} .ps-vrow:first-child{border-top:0}
@media (max-width:760px){
  .ps-kind-b{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
  .ps-kind-b .ps-chk{grid-column:1/-1}
  .ps-col-row{grid-template-columns:minmax(0,1fr) minmax(0,1.2fr)} .ps-col-row small{grid-column:1/-1}
  .ps-acts{margin-left:0}
}
@media (max-width:480px){
  .pa-v{flex:1 1 auto;justify-content:space-between} .pa-v code{flex:1}
  .pa-fix{flex:1 1 100%}
  .pm-rec{flex-wrap:wrap} .pm-main{flex-basis:calc(100% - 4px)}
  .ps .ps-add{width:100%}
}`;
  document.head.appendChild(st);
}

// The Package Audit styles (tabs, list, rules) are needed before any file is loaded too.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { try { _pkgStyle2(); _pkgStyle3(); } catch (_) {} });
else { try { _pkgStyle2(); _pkgStyle3(); } catch (_) {} }

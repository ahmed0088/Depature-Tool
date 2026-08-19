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
const PKG_EXTENSION_DAYS = 31;

// ── IN-Gauge export upload (.xlsx) ──────────────────────────
function pkgLoadExcel(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      busyStart('Reading the IN-Gauge export', 'opening the spreadsheet…');
      await busyPaint();
      const wb  = XLSX.read(e.target.result, { type: 'array' });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      busyDetail(`sorting ${Math.max(rows.length - 1, 0)} charges…`);
      await busyPaint();
      pkgUnknowns = _pkgParseExcelUnknowns(rows);
      const needsCount = pkgUnknowns.filter(u => u.needsProduct || u.needsEmployee).length;
      const lbl = document.getElementById('pkgExcelLabel');
      if (lbl) lbl.textContent = pkgUnknowns.length
        ? `✓ ${pkgUnknowns.length} row${pkgUnknowns.length !== 1 ? 's' : ''} loaded, ${needsCount} need${needsCount === 1 ? 's' : ''} review`
        : 'Loaded — no rows found';
      showToast(pkgUnknowns.length
        ? `✦ ${pkgUnknowns.length} row${pkgUnknowns.length !== 1 ? 's' : ''} loaded (${needsCount} missing product or seller)`
        : 'No rows found in this file', pkgUnknowns.length ? 'ok' : 'err');
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
      busyStart('Reading the guest list', 'matching names to confirmations…');
      await busyPaint();
      const wb   = XLSX.read(e.target.result, { type: 'array' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      pkgGuests  = _pkgParseGuestList(rows);
      const n = Object.keys(pkgGuests).length;
      const lbl = document.getElementById('pkgGuestLabel');
      if (lbl) lbl.textContent = n ? `✓ ${n} reservation${n !== 1 ? 's' : ''} with guest names` : 'Loaded — no Confirmation No. + Name columns found';
      showToast(n ? `✦ ${n} guest names loaded` : 'Could not find Confirmation No. and Name columns in this file', n ? 'ok' : 'err');
    } catch (err) {
      showToast('Failed to read the guest list: ' + err.message, 'err');
    } finally {
      busyDone();
      if (input) input.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}

function _pkgParseGuestList(rows) {
  if (!rows.length) return {};
  const hdrs = rows[0].map(h => String(h || '').trim());
  const iConf = _pkgFindCol(hdrs, 'Confirmation Number', 'Confirmation No', 'Confirmation no');
  const iName = _pkgFindCol(hdrs, 'Name', 'Guest Name');
  const iRoom = _pkgFindCol(hdrs, 'Room');
  const iArr  = _pkgFindCol(hdrs, 'Arrival');
  const iDep  = _pkgFindCol(hdrs, 'Departure');
  if (iConf < 0 || iName < 0) return {};

  const out = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const conf = String(r[iConf] || '').trim().replace(/\.0+$/, '');
    const name = String(r[iName] || '').trim();
    if (!conf || !name) continue;
    out[conf] = {
      name,
      norm: _pkgNormGuestName(name),
      room: iRoom >= 0 ? String(r[iRoom] || '').trim() : '',
      arr:  iArr  >= 0 ? String(r[iArr]  || '').trim() : '',
      dep:  iDep  >= 0 ? String(r[iDep]  || '').trim() : '',
    };
  }
  return out;
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
function _pkgCodeFamilyFor(product) {
  if (product === 'Early Check In')  return /EC$/i;
  if (product === 'Late Check Out')  return /LC$/i;
  if (product === 'Breakfast')       return /BB$/i;
  return null;
}

function _pkgFindCol(hdrs, ...names) {
  for (const n of names) { const i = hdrs.findIndex(h => h === n); if (i >= 0) return i; }
  for (const n of names) { const i = hdrs.findIndex(h => h.includes(n)); if (i >= 0) return i; }
  return -1;
}

function _pkgParseExcelUnknowns(rows) {
  if (!rows.length) return [];
  const hdrs = rows[0].map(h => String(h || '').trim());
  const iProduct = _pkgFindCol(hdrs, 'Product');
  const iConf    = _pkgFindCol(hdrs, 'Confirmation no', 'Confirmation No');
  const iRoom    = _pkgFindCol(hdrs, 'Room No');
  const iCharge  = _pkgFindCol(hdrs, 'Product Charge');
  const iDays    = _pkgFindCol(hdrs, 'Charge Days');
  const iArr     = _pkgFindCol(hdrs, 'Arrival Date');
  const iDep     = _pkgFindCol(hdrs, 'Departure Date');
  const iEmp     = _pkgFindCol(hdrs, 'Employee');
  const iDaily   = _pkgFindCol(hdrs, 'Daily Date');
  const iStatus  = _pkgFindCol(hdrs, 'Status');
  if (iProduct < 0 || iConf < 0) return [];

  const out = [];
  for (let i = 1; i < rows.length; i++) {
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
const _PKG_CHROME = /^(?:Page \d+ of \d+|user_activity_log|Filter|For Activity |Activity by |Search Text |Sort Order|From Time |To Time |User Activity Log|Ibis Styles)/i;

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
    const body    = lines.filter(l => l.y < headerY - 0.5 && !_PKG_CHROME.test(l.text));

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
      // User email wraps mid-word across lines ("ACCOREN-" / "AHELSAFTY@" /
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
  if (/^(Early Check In|Late Check Out|Breakfast)$/i.test(p)) return p;
  const c = String(r.code || '');
  if (/EC$/i.test(c)) return 'Early Check In';
  if (/LC$/i.test(c)) return 'Late Check Out';
  if (/BB$/i.test(c)) return 'Breakfast';
  return p || c;
}

// Early check-in and late checkout are charged ONCE per stay. Breakfast and
// the board packages are per-night, so IN-Gauge listing one row per day is
// expected for those and only for those.
function _pkgIsOneTime(name) { return /^(Early Check In|Late Check Out)$/i.test(String(name || '')); }

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
// Opera's log always has the login ("ACCOREN-CNONIS@ACCOREN"), while
// IN-Gauge may carry the login ("ACCOREN-CNONIS") or the display name
// ("Chethmi NONIS") depending on the column and the export.
function _pkgUserKey(u) { return String(u || '').split('@')[0].trim().toUpperCase(); }

// Last word of either form: "ACCOREN-CNONIS" -> CNONIS, "Chethmi NONIS"
// -> NONIS. Digits and separators in a tenant prefix (HA7N5-HNAVED) are
// treated as breaks, so the family part is what's left at the end.
function _pkgFamilyPart(key) {
  const w = String(key).replace(/[^A-Z]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  return w.length ? w[w.length - 1] : '';
}

function _pkgSameUser(a, b) {
  const x = _pkgUserKey(a), y = _pkgUserKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // A login is the family name with the person's initials stuck on the
  // front — CNONIS/NONIS, MADAS/DAS, AHELSAFTY/ELSAFTY, HNAVED/NAVED —
  // so the longer form ends with the shorter one. Requiring at least
  // three letters and no more than a couple of extra keeps that from
  // matching two different people who happen to share an ending.
  const fx = _pkgFamilyPart(x), fy = _pkgFamilyPart(y);
  if (fx.length < 3 || fy.length < 3) return false;
  const [long, short] = fx.length >= fy.length ? [fx, fy] : [fy, fx];
  return long.endsWith(short) && long.length - short.length <= 3;
}

// IN-Gauge's screens name people the way the dropdown does; Opera's log
// only ever carries the login. Showing "ACCOREN-CNONIS" next to a
// dropdown that says "Chethmi NONIS" leaves the reader translating between
// the two, so the login is resolved back to the name wherever it's known.
//
// Add a line when someone joins — an unrecognised login simply displays
// as itself, so nothing breaks if this list falls behind.
const PKG_STAFF = [
  'AhmedHassan ELSAFTY', 'Bhadra SOUPTIK', 'Chethmi NONIS', 'Hassan NAVED',
  'HninWut YEEOO', 'Irene RUNTU', 'Manisha DAS', 'Syed Turrab Bukhari',
];

function _pkgUserLabel(u) {
  const key = _pkgUserKey(u);
  if (!key) return String(u || '');
  // Reuses the login/display-name matching, so CNONIS finds Chethmi NONIS
  // without needing the exact login spelled out here.
  return PKG_STAFF.find(name => _pkgSameUser(name, key)) || key;
}

// The matched event says WHICH package the charge is; it does not say who
// sold it. A package added once and repriced later logs two entries under
// the same code, and matching on the charged amount lands on the repricing
// — conf 617204564 is UPS60BB added by AHELSAFTY at 32.66 on 11-Aug and
// moved to 48.98 by CNONIS on 13-Aug, where the 48.98 charge would credit
// CNONIS for a package Ahmed started. Same code is the same package, so
// credit follows its earliest entry.
//
// Matched on the package FAMILY rather than the exact code, because an
// upgrade rewrites the code: breakfast for one guest is UPS30BB and for
// two is UPS60BB, so a colleague adding the second guest would otherwise
// take the whole sale off whoever booked the breakfast. Codes outside the
// three known families (half board, dinner) have no upgrade ladder to
// follow, so those stay matched on the exact code.
function _pkgFamilyOfCode(code) {
  if (/EC$/i.test(code)) return /EC$/i;
  if (/LC$/i.test(code)) return /LC$/i;
  if (/BB$/i.test(code)) return /BB$/i;
  return null;
}

// A booking that arrives through TARS or another interface writes its
// packages under a system account, and nobody at the desk sold those — so
// those entries are passed over when deciding who to credit. Machine
// accounts appear as an opaque id (ACCOREN-70F54B3222) rather than a name,
// which is what the hex test catches; a name made only of letters is
// always treated as a real person, so an unfamiliar colleague is never
// mistaken for a system.
const _PKG_SYSTEM_USER = /(^|[-.])(TARS|PRODUCTION|INTERFACE|WEBSERVICE|SYSTEM|IFC|ONLINE|CHANNEL|BOOKING|PMS)([-.]|$)/i;

function _pkgIsSystemUser(u) {
  const key = _pkgUserKey(u);
  if (!key) return true;
  if (_PKG_SYSTEM_USER.test(key)) return true;
  const login = key.split('-').pop() || key;
  return /\d/.test(login) && /^[0-9A-F]{6,}$/i.test(login);
}

// Returns null when every entry for the package is a system account —
// nobody sold it, so there is nobody to credit.
function _pkgOriginatorFor(ev, cands) {
  if (!ev) return null;
  const family = _pkgFamilyOfCode(ev.code);
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
    if (family && !r.candidates.some(c => family.test(c.code))) {
      // Opera does have this reservation's package activity, and none of it
      // is this kind of package.
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
      r.verdict = 'deny';
      r.denyReason = `${r.family} is charged once per stay — already counted on ${keep.daily || 'another row'}`;
    });
  });
}

// Groups a guest's reservations into one stay. Same name, and each
// booking starting within PKG_EXTENSION_DAYS of the one before it, so a
// guest returning months later is a separate sale rather than an
// extension. Returns confirmation -> the stay's first confirmation.
function _pkgBuildChains() {
  const byGuest = {};
  Object.entries(pkgGuests).forEach(([conf, g]) => {
    if (!g.norm) return;
    (byGuest[g.norm] = byGuest[g.norm] || []).push({ conf, ...g });
  });

  const head = {};
  Object.values(byGuest).forEach(list => {
    if (list.length < 2) return;
    list.sort((a, b) => (_pkgDayNum(a.arr) || 0) - (_pkgDayNum(b.arr) || 0));
    let chainHead = list[0].conf;
    let prevEnd   = _pkgDayNum(list[0].dep) || _pkgDayNum(list[0].arr);
    head[list[0].conf] = chainHead;
    for (let i = 1; i < list.length; i++) {
      const arr = _pkgDayNum(list[i].arr);
      // Compared as plain calendar days — close enough over a month, and
      // it avoids pretending YYYYMMDD arithmetic is exact across a month end.
      const gap = (arr && prevEnd) ? _pkgDaysBetween(prevEnd, arr) : Infinity;
      if (gap > PKG_EXTENSION_DAYS) chainHead = list[i].conf;   // too far apart: a new stay
      head[list[i].conf] = chainHead;
      prevEnd = _pkgDayNum(list[i].dep) || arr;
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
function _pkgApplyExtensionCredit(results) {
  if (!Object.keys(pkgGuests).length) return;   // no guest list loaded: rule is inactive
  const head = _pkgBuildChains();

  // Who owns each stay: the seller on its first booking, preferring one
  // Opera actually confirms over IN-Gauge's unverified word.
  const owner = {};
  results.forEach(r => {
    if (head[r.conf] !== r.conf) return;
    if (r.verdict === 'settled' || r.verdict === 'deny') return;
    if (!owner[r.conf] || (r.matchedEvent && !owner[r.conf].confirmed)) {
      owner[r.conf] = { user: r.user || r.employee, confirmed: !!r.matchedEvent };
    }
  });

  results.forEach(r => {
    const h = head[r.conf];
    if (!h || h === r.conf) return;                                  // first booking of the stay
    if (r.verdict === 'settled' || r.verdict === 'deny') return;     // already handled
    const own = owner[h];
    if (!own || !own.user) return;

    r.extendedFrom = h;
    r.extendedName = (pkgGuests[r.conf] || {}).name || '';
    if (_pkgSameUser(r.user || r.employee, own.user)) return;        // already the right person

    // Opera may show someone else adding the package on the new booking;
    // the stay's original seller still keeps it.
    r.wasUser  = r.employee;
    r.user     = own.user;
    r.reassign = true;
    r.alreadyComplete = false;
    r.verdict  = 'credit';
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
      ...u,
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
  _pkgApplyExtensionCredit(results);
  pkgResults = results;
  _pkgRenderCoverage();
  document.getElementById('pkgResultsWrap').style.display = 'block';
  pkgRender();
  busyDone();
}

// Plain-language instruction for the row — what the person reading this
// actually has to go and do, rather than which field happened to be blank.
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
  if (late)  bits.push(`<b>${late}</b> charged after it ends (${escapeHtml(_pkgDayLabel(pkgLogRange.max))}) — the night audit hasn't reached those yet`);

  box.style.display = 'block';
  box.innerHTML = `⏳ <b>${outside.length} charge${outside.length !== 1 ? 's' : ''} sit outside this log</b> — ${bits.join(', and ')}.
    They're hidden from Needs action because no amount of checking resolves them here.
    ${early ? `A package is usually added when the booking is made, which can be weeks before the stay: the earliest arrival in this export is
    <b>${escapeHtml(_pkgDayLabel(firstArr))}</b>, so run the Changes Log from before that date — not from the 1st — and include
    <b>New Reservation</b> as well as Update Reservation.` : ''}`;
}

function _pkgActionText(r) {
  if (r.verdict === 'settled') return 'Nothing — already denied';
  if (r.verdict === 'deny')    return 'Remove this charge';
  if (r.verdict === 'outside') return 'Not in this log';
  if (r.verdict === 'review')  return 'Check in Opera';
  // Came in through TARS or another interface — no one sold it.
  if (r.noSeller) return r.needsEmployee ? 'No seller — booked by system' : 'Nothing — booked by system';
  if (r.needsProduct && r.needsEmployee) return 'Set package + seller';
  if (r.needsProduct && r.reassign) return 'Set package, reassign seller';
  if (r.needsProduct) return 'Set the package';
  if (r.needsEmployee) return 'Set the seller';
  if (r.reassign) return r.extendedFrom ? 'Extension — credit stays with first seller' : 'Reassign the seller';
  return 'Nothing — already correct';
}

function _pkgActionCell(r) {
  const txt = _pkgActionText(r);
  const color = r.verdict === 'settled' ? 'var(--text3)'
    : r.verdict === 'deny' ? 'var(--rose)'
    : r.verdict === 'outside' ? 'var(--text3)'
    : r.verdict === 'review' ? 'var(--amber)'
    : r.reassign ? 'var(--amber)'
    : (r.needsProduct || r.needsEmployee) ? 'var(--sky)' : 'var(--text3)';
  // Spell out who it is currently credited to, so the change is checkable
  // rather than something the tool just asserts.
  const why = r.reassign ? ` title="IN-Gauge credits ${escapeHtml(_pkgUserLabel(r.wasUser))} — Opera shows ${escapeHtml(_pkgUserLabel(r.user))} started this package"` : '';
  return `<td style="font-size:0.68rem;color:${color};"${why}>${escapeHtml(txt)}</td>`;
}

function pkgRender() {
  const q = pkgSearch_.toLowerCase().trim();
  const filtered = pkgResults.filter(r => {
    // "Needs action" is the default: everything a person can actually do
    // something about. Rows the log simply doesn't reach are excluded —
    // they aren't decisions waiting to be made.
    const needsAction = r.verdict === 'deny' ||
                        (r.verdict === 'credit' && !r.alreadyComplete) ||
                        r.verdict === 'review';
    if (pkgFilter_ === 'action'    && !needsAction) return false;
    if (pkgFilter_ === 'complete'  && !((r.alreadyComplete && r.verdict === 'credit') || r.verdict === 'settled')) return false;
    if (pkgFilter_ === 'resolved'  && !(r.verdict === 'credit' && !r.alreadyComplete)) return false;
    if (pkgFilter_ === 'deny'      && r.verdict !== 'deny') return false;
    if (pkgFilter_ === 'review'    && r.verdict !== 'review') return false;
    if (pkgFilter_ === 'outside'   && r.verdict !== 'outside') return false;
    if (q) {
      const hay = [r.conf, r.room, r.code, r.family, r.user, _pkgActionText(r)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const settledCount   = pkgResults.filter(r => r.verdict === 'settled').length;
  const completeCount  = pkgResults.filter(r => (r.verdict === 'credit' && r.alreadyComplete) || r.verdict === 'settled').length;
  const fixedCount     = pkgResults.filter(r => r.verdict === 'credit' && !r.alreadyComplete).length;
  const denyCount      = pkgResults.filter(r => r.verdict === 'deny').length;
  const reviewCount    = pkgResults.filter(r => r.verdict === 'review').length;
  const outsideCount   = pkgResults.filter(r => r.verdict === 'outside').length;
  const actionCount    = fixedCount + denyCount + reviewCount;
  [['pkgfc-action', actionCount],
   ['pkgfc-outside', outsideCount],
   ['pkgfc-all', pkgResults.length],
   ['pkgfc-complete', completeCount],
   ['pkgfc-resolved', fixedCount],
   ['pkgfc-deny', denyCount],
   ['pkgfc-review', reviewCount],
  ].forEach(([id, v]) => { const el = document.getElementById(id); if (el) el.textContent = v; });

  document.getElementById('pkgKpis').innerHTML = `
    <div class="kpi sky"><div class="kpi-accent"></div><div class="kpi-label">Charges Checked</div><div class="kpi-val">${pkgResults.length}</div></div>
    <div class="kpi ${actionCount ? 'gold' : 'mint'}"><div class="kpi-accent"></div><div class="kpi-label">Needs Action</div><div class="kpi-val">${actionCount}</div></div>
    <div class="kpi ${denyCount ? 'rose' : ''}"><div class="kpi-accent"></div><div class="kpi-label">Remove</div><div class="kpi-val">${denyCount}</div></div>
    <div class="kpi ${reviewCount ? 'amber' : ''}"><div class="kpi-accent"></div><div class="kpi-label">Check by Hand</div><div class="kpi-val">${reviewCount}</div></div>`;

  const tbody = document.getElementById('pkgTable');
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:36px;font-family:var(--mono);font-size:0.7rem;color:var(--text3);">No rows match.</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(r => {
    const gapCell = _pkgActionCell(r);
    if (r.verdict === 'deny') {
      return `<tr style="opacity:0.8;">
        <td><span class="tt-room-pill">${escapeHtml(r.room)}</span></td>
        <td style="font-family:var(--mono);font-size:0.72rem;">${escapeHtml(r.conf)}</td>
        <td style="font-family:var(--mono);font-size:0.76rem;color:var(--text2);text-decoration:line-through;">${escapeHtml(r.family || r.code)}</td>
        <td style="font-family:var(--mono);font-size:0.72rem;color:var(--text3);">AED ${escapeHtml(String(r.charge))}</td>
        <td colspan="2" style="font-size:0.68rem;color:var(--rose);">${escapeHtml(r.denyReason)}</td>
        ${gapCell}
        <td><span style="color:var(--rose);">⛔ Remove</span></td>
      </tr>`;
    }
    if (r.verdict === 'credit') {
      const statusCell = r.alreadyComplete
        ? `<span style="color:var(--text3);">✓ OK</span>`
        : `<span style="color:var(--mint);">✏️ Update</span>`;
      return `<tr>
        <td><span class="tt-room-pill">${escapeHtml(r.room)}</span></td>
        <td style="font-family:var(--mono);font-size:0.72rem;">${escapeHtml(r.conf)}</td>
        <td style="font-family:var(--mono);font-size:0.76rem;font-weight:700;color:${r.alreadyComplete ? 'var(--text2)' : 'var(--mint)'};">${escapeHtml(r.code)}</td>
        <td style="font-family:var(--mono);font-size:0.72rem;">AED ${escapeHtml(r.price)}</td>
        <td style="font-family:var(--mono);font-size:0.68rem;color:var(--text2);">${escapeHtml(r.from) || '—'} → ${escapeHtml(r.to) || '—'}</td>
        <td style="font-family:var(--mono);font-size:0.68rem;color:var(--text2);">${escapeHtml(_pkgUserLabel(r.user))}</td>
        ${gapCell}
        <td>${statusCell}</td>
      </tr>`;
    }
    const candText = r.note ? escapeHtml(r.note)
      : r.candidates.length
      ? `${r.candidates.length} candidate${r.candidates.length !== 1 ? 's' : ''}, no exact price match — ${escapeHtml(r.candidates.map(c => `${c.code} (AED ${c.price ?? '?'})`).join(', '))}`
      : 'No product events found for this confirmation';
    const productCell = r.needsProduct
      ? `<span style="color:var(--text3);">? unresolved</span>`
      : escapeHtml(r.product);
    // Opera can't confirm these, but IN-Gauge still names a seller — and
    // that name is the whole point of the row, so it keeps its own column
    // instead of being swallowed by the explanation next to it. Shown in
    // the muted colour to mark it as IN-Gauge's word rather than Opera's.
    const claimed = r.employee && r.employee !== '-'
      ? `<span title="IN-Gauge credits this — not confirmed against Opera">${escapeHtml(_pkgUserLabel(r.employee))}</span>`
      : `<span style="color:var(--rose);">nobody</span>`;
    const statusCell = r.verdict === 'settled'
      ? `<span style="color:var(--text3);">⛔ Denied</span>`
      : r.verdict === 'outside'
      ? `<span style="color:var(--text3);">⏳ Not in log</span>`
      : `<span style="color:var(--amber);">⚠ Check</span>`;
    return `<tr${r.verdict === 'outside' ? ' style="opacity:0.75;"' : ''}>
      <td><span class="tt-room-pill">${escapeHtml(r.room)}</span></td>
      <td style="font-family:var(--mono);font-size:0.72rem;">${escapeHtml(r.conf)}</td>
      <td style="font-family:var(--mono);font-size:0.76rem;">${productCell}</td>
      <td style="font-family:var(--mono);font-size:0.72rem;color:var(--text3);">AED ${escapeHtml(String(r.charge))}</td>
      <td style="font-size:0.66rem;color:var(--text3);">${candText}</td>
      <td style="font-family:var(--mono);font-size:0.68rem;color:var(--text3);">${claimed}</td>
      ${gapCell}
      <td>${statusCell}</td>
    </tr>`;
  }).join('');
}

function pkgSetFilter(f, el) {
  pkgFilter_ = f;
  document.querySelectorAll('#pkgFilters .fchip').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  pkgRender();
}
function pkgSetSearch(val) { pkgSearch_ = val; pkgRender(); }

// ── Copy resolved rows as TSV — Room / Conf / Product / Price / From / To / Sold By ──
function pkgCopyResolved() {
  // Only rows that are valid to credit AND needed fixing — an already-correct
  // row has nothing to update, and a denied row must never be credited.
  const resolved = pkgResults.filter(r => r.verdict === 'credit' && !r.alreadyComplete);
  if (!resolved.length) { showToast('No fixed rows to copy', 'err'); return; }
  const tsv = ['Room\tConfirmation No.\tProduct Code\tPrice (AED)\tFrom\tTo\tSold By\tCurrently Credited To']
    .concat(resolved.map(r => [r.room, r.conf, r.code, r.price, r.from || '', r.to || '', r.user, r.wasUser || ''].join('\t')))
    .join('\n');
  copyToClipboard(tsv, document.getElementById('pkgCopyBtn'), '📋 Copy rows to update');
}

// ── Copy the deny list — the charges that should NOT be credited ──
function pkgCopyDeny() {
  const denied = pkgResults.filter(r => r.verdict === 'deny');
  if (!denied.length) { showToast('Nothing to deny — every charge is backed by Opera', 'ok'); return; }
  const tsv = ['Room\tConfirmation No.\tProduct\tCharge (AED)\tCharged Date\tWhy Deny']
    .concat(denied.map(r => [r.room, r.conf, r.family || r.code, r.charge, r.daily || '', r.denyReason].join('\t')))
    .join('\n');
  copyToClipboard(tsv, document.getElementById('pkgDenyBtn'), '⛔ Copy Deny List');
}

function pkgClear() {
  pkgUnknowns = []; pkgEvents = {}; pkgResults = []; pkgFilter_ = 'all'; pkgSearch_ = ''; pkgPdfFiles = []; pkgLogRange = { min: 0, max: 0 };
  const ei = document.getElementById('pkgExcelFileInput'); if (ei) ei.value = '';
  const pi = document.getElementById('pkgPdfFileInput');   if (pi) pi.value = '';
  const el = document.getElementById('pkgExcelLabel'); if (el) el.textContent = 'Click to upload';
  const pl = document.getElementById('pkgPdfLabel');   if (pl) pl.textContent = 'Click to upload';
  const search = document.getElementById('pkgSearch'); if (search) search.value = '';
  document.getElementById('pkgResultsWrap').style.display = 'none';
  document.getElementById('pkgError').classList.remove('show');
}

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
const PKG_EXTENSION_GAP = 0;

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
      busyStart('Reading the guest list', 'matching guests to confirmations…');
      await busyPaint();
      const buf  = e.target.result;
      const head = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 8192)));
      // Opera's Reservation Detail export is tab-delimited text, not a
      // workbook, and it carries the guest's profile ID — a far better
      // link between bookings than a name ever is.
      pkgGuests = /CONFIRMATION_NO/.test(head) && head.includes('\t')
        ? _pkgParseResDetail(new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf)))
        : _pkgParseGuestList(XLSX.utils.sheet_to_json(
            XLSX.read(buf, { type: 'array' }).Sheets[XLSX.read(buf, { type: 'array' }).SheetNames[0]],
            { header: 1, defval: '' }));
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
  const hdrs = rows[0].map(h => String(h || '').trim());
  const iConf = _pkgFindCol(hdrs, 'Confirmation Number', 'Confirmation No', 'Confirmation no');
  const iName = _pkgFindCol(hdrs, 'Name', 'Guest Name');
  const iGid  = _pkgFindCol(hdrs, 'Guest Name Id', 'Guest Id', 'Client Id', 'Profile Id');
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
  for (const [name, al] of Object.entries(typeof PKG_STAFF_ALIASES !== 'undefined' ? PKG_STAFF_ALIASES : {})) {
    const is = k => _pkgUserKey(name) === k || al.some(t => k.split('-').pop() === t || k.split('-').pop().endsWith(t) || k.includes(t));
    if (is(x) && is(y)) return true;
  }
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

// Extra spellings a login can carry for someone, when it is not simply
// initials + family name (e.g. Turrab's login may use TURAB or TURRAB).
const PKG_STAFF_ALIASES = {
  'Syed Turrab Bukhari': ['TURRAB', 'TURAB', 'BUKHARI', 'STBUKHARI', 'SBUKHARI', 'STURRAB', 'STURAB'],
};

function _pkgStaffFor(u) {
  const key = _pkgUserKey(u);
  if (!key) return null;
  const login = key.split('-').pop();
  return PKG_STAFF.find(name => _pkgSameUser(name, key)) ||
    Object.keys(PKG_STAFF_ALIASES).find(name => PKG_STAFF_ALIASES[name].some(a => login === a || login.endsWith(a) || key.includes(a))) ||
    null;
}

function _pkgUserLabel(u) {
  const key = _pkgUserKey(u);
  if (!key) return String(u || '');
  // Reuses the login/display-name matching, so CNONIS finds Chethmi NONIS
  // without needing the exact login spelled out here.
  return _pkgStaffFor(u) || key;
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
// Opera writes the interface account as literally "*TARS*", so the
// delimiter here has to be anything non-alphanumeric rather than the "-" and
// "." originally assumed — with the narrower pattern *TARS* was never
// recognised as a system account at all, and could be credited with a sale.
const _PKG_SYSTEM_USER = /(^|[^A-Z0-9])(TARS|PRODUCTION|INTERFACE|WEBSERVICE|SYSTEM|IFC|ONLINE|CHANNEL|BOOKING|PMS)([^A-Z0-9]|$)/i;

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
    if (!/^(Breakfast|Early Check In|Late Check Out)$/i.test(fam)) return;
    (byPkg[`${r.conf}|${fam}`] = byPkg[`${r.conf}|${fam}`] || []).push(r);
  });

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
function _pkgBuildChains() {
  const byGuest = {};
  Object.entries(pkgGuests).forEach(([conf, g]) => {
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
      if (gap < 0 || gap > PKG_EXTENSION_GAP) chainHead = list[i].conf;
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
// The seller of a booking that has no row in this IN-Gauge export, read
// from the Opera log alone: the earliest package entry by a real person.
// System accounts are skipped — a TARS booking sold nothing.
function _pkgOwnerFromOpera(conf) {
  const ev = pkgEvents[conf] || [];
  if (!ev.length) return null;
  const first = ev.slice().sort((a, b) => a.ts - b.ts).find(c => !_pkgIsSystemUser(c.user));
  return first ? { user: first.user, confirmed: true, viaOpera: true } : null;
}

// The kind of package a code is: EC / LC / BB by the reliable suffix, else its letter prefix
// (USS50 and USS100 are both room upgrades: "USS"). Used so the extension rule only carries a
// sale over to the SAME kind of package: a guest extending a breakfast stay who is then sold a
// room upgrade on the new booking bought something new, from whoever sold it.
function _pkgKindOfCode(code) {
  code = String(code || '').toUpperCase();
  if (/EC$/.test(code)) return 'EC';
  if (/LC$/.test(code)) return 'LC';
  if (/BB$/.test(code)) return 'BB';
  const m = code.match(/^[A-Z]+/);
  return m ? m[0] : '';
}
function _pkgKindOfRow(r) {
  const c = (r.matchedEvent && r.matchedEvent.code) || (r.originEvent && r.originEvent.code) || '';
  if (c) return _pkgKindOfCode(c);
  const n = _pkgFamilyName(r);
  return n === 'Early Check In' ? 'EC' : n === 'Late Check Out' ? 'LC' : n === 'Breakfast' ? 'BB' : '';
}

function _pkgApplyExtensionCredit(results) {
  if (!Object.keys(pkgGuests).length) return;   // no guest list loaded: rule is inactive
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
    if (!owner[r.conf] || (r.matchedEvent && !owner[r.conf].confirmed)) {
      owner[r.conf] = { user: r.user || r.employee, confirmed: !!r.matchedEvent };
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
      if (before.size && !before.has(kind)) return;
      const first = before.get(kind);
      if (first && first.user) {
        if (_pkgIsSystemUser(first.user)) return;   // it came with an online booking: nobody at the desk sold it
        if (!own || !_pkgSameUser(own.user, first.user)) own = { user: first.user, confirmed: true, viaOpera: true };
      }
    }
    if (!own || !own.user) return;
    // A stay that started on a TARS or interface booking has no seller to
    // hand the credit to, and moving a real person's sale onto a system
    // account would be worse than leaving it alone.
    if (_pkgIsSystemUser(own.user)) return;

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
    if (r.status === 'REVIEWED') {
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
  _pkgFlagSplitSellers(results);   // after credit is settled — it compares final sellers
  _pkgDropNoOpReassigns(results);  // nothing that needs no change stays on the list
  _pkgApplyPins(results);          // last: a person's pinned decision beats the log
  _pkgArchive(results);
  pkgResults = results;
  if (typeof logActivity === 'function') logActivity('pkg_audit_run', `${results.length} package lines checked`);
  _pkgRenderCoverage();
  document.getElementById('pkgResultsWrap').style.display = 'block';
  pkgRender();
  busyDone();
}

// ── Pins: decisions a person made that the audit must remember ──────────
// "This breakfast is Manisha's sale even though Hassan typed it into Opera",
// or "stop showing me this one". Saved per package (confirmation + package
// family), shared with the team, applied on every load.
let pkgPins = {};
const PKG_PIN_KEY = 'pkg_pins_v1';
try { pkgPins = JSON.parse(localStorage.getItem(PKG_PIN_KEY) || '{}') || {}; } catch (_) { pkgPins = {}; }
function _pkgPinKey(r) { return `${String(r.conf || '').trim()}|${_pkgFamilyName(r)}`.replace(/[.#$\[\]\/]/g, '_'); }

function _pkgApplyPins(results) {
  results.forEach(r => {
    const pin = pkgPins[_pkgPinKey(r)];
    r.pin = pin || null;
    if (!pin) return;
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

function pkgPinChange(idx, val) {
  const r = pkgResults[idx];
  if (!r) return;
  const key = _pkgPinKey(r);
  const by = (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || '';
  if (val === '__clear') delete pkgPins[key];
  else if (val === '__skip') pkgPins[key] = { skip: true, by, at: new Date().toISOString() };
  else if (val === '__manual') pkgPins[key] = { manual: true, by, at: new Date().toISOString() };
  else if (val.startsWith('__manual:')) pkgPins[key] = { manual: true, seller: val.slice(9), by, at: new Date().toISOString() };
  else if (val === '__other') {
    const name = (prompt('Seller name (as in IN-Gauge):') || '').trim();
    if (!name) { pkgRender(); return; }
    pkgPins[key] = { seller: name, by, at: new Date().toISOString() };
  } else if (val) pkgPins[key] = { seller: val, by, at: new Date().toISOString() };
  else { pkgRender(); return; }
  _pkgSavePins();
  if (typeof logActivity === 'function') {
    const p = pkgPins[key];
    const what = !p ? 'pin removed' : p.skip ? 'skipped' : p.manual ? `manual sale${p.seller ? ' · ' + p.seller : ''}` : `given to ${p.seller}`;
    logActivity('pkg_pin', `Conf ${r.conf} · room ${r.room || '?'} · ${r.family || r.code || ''} → ${what}`);
  }
  // re-apply on the current results without reloading the files
  pkgResults.forEach(x => { if (_pkgPinKey(x) === key) { delete x.pinSkip; } });
  _pkgApplyPins(pkgResults.filter(x => _pkgPinKey(x) === key));
  pkgRender();
  showToast(val === '__clear' ? 'Pin removed — reload the files to see the log\'s view again' : 'Saved — this will be remembered on every load', 'ok');
}

function _pkgPinCell(r) {
  const i = pkgResults.indexOf(r);
  const cur = r.pin ? (r.pin.skip ? '__skip' : r.pin.manual ? (r.pin.seller ? '__manual:' + r.pin.seller : '__manual') : r.pin.seller) : '';
  const staff = PKG_STAFF.slice();
  const curSeller = r.pin && r.pin.seller;
  if (curSeller && !staff.includes(curSeller)) staff.push(curSeller);
  const title = r.pin ? `Pinned by ${r.pin.by || 'someone'}${r.pin.at ? ' · ' + r.pin.at.slice(0, 10) : ''}` : 'Pin the seller or skip this package — remembered on every load';
  return `<td><select class="pkg-pin${r.pin ? ' on' : ''}" title="${escapeHtml(title)}" onchange="pkgPinChange(${i}, this.value)">
    <option value="">${r.pin ? (r.pin.manual ? '✍️' : '📌') : '📌 Pin…'}</option>
    ${staff.map(n => `<option value="${escapeHtml(n)}"${cur === n ? ' selected' : ''}>Seller: ${escapeHtml(n)}</option>`).join('')}
    <option value="__other">Seller: someone else…</option>
    <optgroup label="Sold by hand in IN-Gauge (not in Opera)">
      <option value="__manual"${cur === '__manual' ? ' selected' : ''}>✍️ Manual sale — keep, IN-Gauge seller</option>
      ${staff.map(n => `<option value="__manual:${escapeHtml(n)}"${cur === '__manual:' + n ? ' selected' : ''}>✍️ Manual sale — ${escapeHtml(n)}</option>`).join('')}
    </optgroup>
    <option value="__skip"${cur === '__skip' ? ' selected' : ''}>Skip this package</option>
    ${r.pin ? '<option value="__clear">Remove pin</option>' : ''}
  </select></td>`;
}

function pkgLoadPins() {
  if (typeof fbListen !== 'function') return;
  fbListen('pkgPins', v => {
    pkgPins = v && typeof v === 'object' ? v : {};   // nothing pinned arrives as null: empty, not "keep the old"
    _pkgRemember(_pkgPinsLast, pkgPins);
    try { localStorage.setItem(PKG_PIN_KEY, JSON.stringify(pkgPins)); } catch (_) {}
  });
}
document.addEventListener('DOMContentLoaded', () => setTimeout(pkgLoadPins, 1500));

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
  // Reviewing settles who earned a sale, not whether the charge is sound.
  // So the factual checks run first and the stamp is added to whatever they
  // find — a decision made on bad information should be visible, not hidden.
  const seen = r.reviewed;
  if (r.pinSkip) return 'Skipped (pinned)';
  if (r.manualSale) {
    if (r.needsEmployee) return 'Manual sale — set the seller in IN-Gauge';
    if (r.reassign) return `Manual sale — set the seller to ${_pkgUserLabel(r.user)}`;
    return `Nothing — manual sale kept (${_pkgUserLabel(r.user)})`;
  }
  if (r.pin && r.pin.seller && r.verdict === 'credit') {
    if (r.needsEmployee) return `Set the seller to ${_pkgUserLabel(r.pin.seller)} (pinned)`;
    if (r.reassign) return `Set the seller to ${_pkgUserLabel(r.pin.seller)} (pinned)`;
    if (r.needsProduct) return 'Set the package (seller pinned)';
    return `Nothing — pinned to ${_pkgUserLabel(r.pin.seller)}`;
  }
  if (r.verdict === 'settled') return 'Nothing — already denied';
  if (r.verdict === 'deny')    return seen ? 'Reviewed, but still remove this charge' : 'Remove this charge';
  if (r.verdict === 'outside') return 'Not in this log';
  if (r.verdict === 'review') {
    if (r.splitSeller) return seen ? 'Reviewed, but still split between two sellers' : 'Split — pick one seller';
    return seen ? 'Reviewed, but still needs checking in Opera' : 'Check in Opera';
  }
  // Came in through TARS or another interface — no one sold it.
  if (r.noSeller) return r.needsEmployee ? 'No seller — booked by system' : 'Nothing — booked by system';
  if (r.needsProduct && r.needsEmployee) return seen ? 'Reviewed, but package + seller still blank' : 'Set package + seller';
  if (r.needsProduct) return seen ? 'Reviewed, but package still blank' : 'Set the package';
  if (r.needsEmployee) return seen ? 'Reviewed, but seller still blank' : 'Set the seller';
  if (seen) return 'Nothing — you already reviewed it';
  if (r.reassign) return r.extendedFrom ? `Same stay as ${r.extendedFrom} — credit the first seller` : 'Reassign the seller';
  return 'Nothing — already correct';
}

function _pkgActionCell(r) {
  const txt = _pkgActionText(r);
  // Amber for anything still wrong after a review — it disagrees with a
  // decision a person already made, so it should not look routine.
  const color = (r.reviewed && txt.startsWith('Reviewed, but')) ? 'var(--amber)'
    : r.verdict === 'settled' ? 'var(--text3)'
    : r.verdict === 'deny' ? 'var(--rose)'
    : r.verdict === 'outside' ? 'var(--text3)'
    : r.verdict === 'review' ? 'var(--amber)'
    : r.reassign ? 'var(--amber)'
    : (r.needsProduct || r.needsEmployee) ? 'var(--sky)' : 'var(--text3)';
  // Spell out the reason, so the change is checkable rather than asserted.
  let why = '';
  if (r.reassign && r.extendedFrom) {
    why = ` title="Booking ${escapeHtml(r.extendedFrom)} is the same stay — ${escapeHtml(r.extendedName || 'this guest')} carried on into ${escapeHtml(r.conf)}. `
        + `IN-Gauge credits ${escapeHtml(_pkgUserLabel(r.wasUser))}; the stay was started by ${escapeHtml(_pkgUserLabel(r.user))}`
        + (r.extendedVia === 'opera' ? ', per the Opera log — that booking is not in this IN-Gauge export.' : '.') + `"`;
  } else if (r.reassign) {
    why = ` title="IN-Gauge credits ${escapeHtml(_pkgUserLabel(r.wasUser))} — Opera shows ${escapeHtml(_pkgUserLabel(r.user))} started this package"`;
  }
  return `<td style="font-size:0.68rem;color:${color};"${why}>${escapeHtml(txt)}</td>`;
}

function pkgRender() {
  const q = pkgSearch_.toLowerCase().trim();
  const filtered = pkgResults.filter(r => {
    // "Needs action" is the default: everything a person can actually do
    // something about. Rows the log simply doesn't reach are excluded —
    // they aren't decisions waiting to be made.
    if (pkgFilter_ === 'pinned') { if (!r.pin) return false; }
    else if (r.pinSkip && pkgFilter_ !== 'all') return false;
    const needsAction = !r.pinSkip && (r.verdict === 'deny' ||
                        (r.verdict === 'credit' && !r.alreadyComplete) ||
                        r.verdict === 'review');
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
  const live           = pkgResults.filter(r => !r.pinSkip);
  const fixedCount     = live.filter(r => r.verdict === 'credit' && !r.alreadyComplete).length;
  const denyCount      = live.filter(r => r.verdict === 'deny').length;
  const reviewCount    = live.filter(r => r.verdict === 'review').length;
  const pinnedCount    = pkgResults.filter(r => r.pin).length;
  const outsideCount   = pkgResults.filter(r => r.verdict === 'outside').length;
  const actionAll      = fixedCount + denyCount + reviewCount;
  const isAct          = r => r.verdict === 'deny' || r.verdict === 'review' || (r.verdict === 'credit' && !r.alreadyComplete);
  const actionCount    = actionAll - live.filter(r => isAct(r) && pkgNightDone(r) && !pkgBackWrong(r)).length;   // still to do
  [['pkgfc-action', actionCount],
   ['pkgfc-outside', outsideCount],
   ['pkgfc-all', pkgResults.length],
   ['pkgfc-complete', completeCount],
   ['pkgfc-resolved', fixedCount],
   ['pkgfc-deny', denyCount],
   ['pkgfc-review', reviewCount],
   ['pkgfc-pinned', pinnedCount],
  ].forEach(([id, v]) => { const el = document.getElementById(id); if (el) el.textContent = v; });

  document.getElementById('pkgKpis').innerHTML = `
    <div class="kpi sky"><div class="kpi-accent"></div><div class="kpi-label">Charges Checked</div><div class="kpi-val">${pkgResults.length}</div></div>
    <div class="kpi ${actionCount ? 'gold' : 'mint'}"><div class="kpi-accent"></div><div class="kpi-label">Needs Action</div><div class="kpi-val">${actionCount}</div></div>
    <div class="kpi ${denyCount ? 'rose' : ''}"><div class="kpi-accent"></div><div class="kpi-label">Remove</div><div class="kpi-val">${denyCount}</div></div>
    <div class="kpi ${reviewCount ? 'amber' : ''}"><div class="kpi-accent"></div><div class="kpi-label">Check by Hand</div><div class="kpi-val">${reviewCount}</div></div>`;

  const tbody = document.getElementById('pkgTable'), dbody = document.getElementById('pkgDoneTable');
  const dwrap = document.getElementById('pkgDoneWrap'), warn = document.getElementById('pkgDoneWarn');
  const empty = t => `<tr><td colspan="9" style="text-align:center;padding:36px;font-family:var(--mono);font-size:0.7rem;color:var(--text3);">${t}</td></tr>`;
  const rowHtml = (r, sub) => _pkgSubMark(_pkgDoneMark(_pkgRowHtmlInner(r), pkgNightDone(r) && !pkgBackWrong(r)), sub);
  // IN-Gauge bills a package night by night, so one 6-night breakfast is six
  // lines. Group them per confirmation + package: one line with the nights
  // and total, the single nights one tap away.
  const groups = [], gmap = new Map();
  filtered.forEach(r => {
    const k = _pkgPinKey(r);
    if (!gmap.has(k)) { const g = { key: k, rows: [] }; gmap.set(k, g); groups.push(g); }
    gmap.get(k).rows.push(r);
  });
  const html = list => list.map(g => g.rows.length === 1 ? rowHtml(g.rows[0], '')
    : _pkgDoneMark(_pkgGroupHtml(g), g.rows.every(x => pkgNightDone(x) && !pkgBackWrong(x))) + g.rows.map(r => rowHtml(r, g.key)).join('')).join('');
  // two windows: what is still to fix, and what was copied (not every day ticked first)
  const isBack = g => g.rows.some(pkgBackWrong);
  const todo = groups.filter(g => !pkgDone[g.key] || isBack(g)).sort((a, b) => isBack(b) - isBack(a));
  const part = g => _pkgLeft(g.key).length > 0;
  const copied = groups.filter(g => pkgDone[g.key] && !isBack(g)).sort((a, b) => part(b) - part(a));
  const backs = todo.filter(isBack), bw = document.getElementById('pkgBackWarn');
  if (bw) bw.innerHTML = backs.length ? `<div class="pkg-left-warn bad"><b>↺ ${backs.length} package${backs.length > 1 ? 's' : ''} came back wrong.</b> They were ticked fixed, but this IN-Gauge report, saved after that, still shows them wrong (the change didn't save, or only some days were changed). They are back on top of To fix.</div>` : '';
  tbody.innerHTML = todo.length ? html(todo) : empty(filtered.length ? '✅ Nothing left to fix here: everything is in Copied' : 'No rows match.');
  const tc = document.getElementById('pkgTodoCount'); if (tc) tc.textContent = todo.length;
  if (dbody) dbody.innerHTML = html(copied);
  if (dwrap) dwrap.hidden = !copied.length;
  const open = copied.filter(part);
  const dc = document.getElementById('pkgDoneCount'); if (dc) dc.textContent = copied.length;
  if (warn) warn.innerHTML = open.length ? `<div class="pkg-left-warn"><b>⚠ ${open.length} package${open.length > 1 ? 's' : ''} copied but not every day fixed yet.</b>
      IN-Gauge charges a package day by day and each day keeps the old seller until you change it. Fix every day, then tick it:
      <ul>${open.map(g => { const r0 = g.rows[0], left = _pkgLeft(g.key); return `<li>Room ${escapeHtml(r0.room || '?')} · ${escapeHtml(_pkgFamilyName(r0))} · conf ${escapeHtml(r0.conf)}: <b>${left.length} of ${_pkgGroupRows(g.key).length} days left</b> (${escapeHtml(left.map(x => x.daily || x.from || '?').join(', '))})</li>`; }).join('')}</ul></div>` : '';
  try { pkgBoardRender(); } catch (e) { console.warn('[pkg board]', e); }
}

const pkgOpenGroups = new Set();
function pkgToggleGroup(key) {
  if (pkgOpenGroups.has(key)) pkgOpenGroups.delete(key); else pkgOpenGroups.add(key);
  pkgRender();
}
// Marks a single-night row as belonging to a group (hidden until the group is opened)
function _pkgSubMark(html, key) {
  if (!key) return html;
  const hide = _pkgIsOpen(key) ? '' : 'display:none;';
  return html.replace(/^\s*<tr([^>]*)>/, (m, attrs) => {
    if (/style="/.test(attrs)) attrs = attrs.replace(/style="/, `style="${hide}`);
    else attrs += ` style="${hide}"`;
    return `<tr${attrs} class="pkg-sub">`;
  });
}

function _pkgGroupHtml(g) {
  const rows = g.rows, r0 = rows[0];
  const open = _pkgIsOpen(g.key);
  const total = rows.reduce((s, r) => s + (parseFloat(r.price ?? r.charge) || 0), 0);
  const dates = rows.flatMap(r => [r.from, r.to, r.arr, r.dep]).filter(Boolean);
  const uniq = a => [...new Set(a.filter(Boolean))];
  const sellers = uniq(rows.map(r => _pkgUserLabel(r.user || r.employee)));
  const acts = {}; rows.forEach(r => { const t = _pkgActionText(r); acts[t] = (acts[t] || 0) + 1; });
  const actKeys = Object.keys(acts);
  const actTxt = actKeys.length === 1 ? actKeys[0] : actKeys.map(k => `${acts[k]}× ${k}`).join(' · ');
  const needs = rows.some(r => !r.pinSkip && (r.verdict === 'deny' || r.verdict === 'review' || (r.verdict === 'credit' && !r.alreadyComplete)));
  const color = rows.some(r => r.verdict === 'deny') ? 'var(--rose)' : needs ? 'var(--amber)' : 'var(--text3)';
  return `<tr class="pkg-group" onclick="if(!event.target.closest('select,.pkg-conf')&&!String(window.getSelection()))pkgToggleGroup('${escapeHtml(g.key)}')" style="cursor:pointer;">
    <td><span class="tt-room-pill">${escapeHtml(r0.room)}</span></td>
    ${_pkgConfCell(r0.conf, r0, true)}
    <td style="font-family:var(--mono);font-size:0.76rem;font-weight:700;">${open ? '▾' : '▸'} ${escapeHtml(_pkgFamilyName(r0))} <span class="pkg-nights">× ${rows.length} nights</span></td>
    <td style="font-family:var(--mono);font-size:0.72rem;">AED ${escapeHtml(String(Math.round(total * 100) / 100))}</td>
    <td style="font-family:var(--mono);font-size:0.68rem;color:var(--text2);">${dates.length ? escapeHtml(dates[0]) + ' → ' + escapeHtml(dates[dates.length - 1]) : '—'}</td>
    <td style="font-family:var(--mono);font-size:0.68rem;color:var(--text2);">${escapeHtml(sellers.join(' / ') || '—')}</td>
    <td style="font-size:0.68rem;color:${color};">${escapeHtml(actTxt)}</td>
    <td style="font-size:0.66rem;color:var(--text3);">${open ? 'Hide nights' : 'Show nights'}</td>
    ${_pkgPinCell(r0)}
  </tr>`;
}

/** A confirmation number: tap to copy it (and still selectable); never opens or closes the row.
 *  Once copied: the package line shows how many of its days are ticked fixed, each night line a tick box. */
function _pkgConfCell(conf, r, isGroup) {
  const c = String(conf || '');
  if (!c) return '<td>—</td>';
  const key = r ? _pkgPinKey(r) : '', d = key && pkgDone[key], J = v => escapeHtml(JSON.stringify(v));
  let tag = '';
  const back = d && (isGroup ? _pkgGroupRows(key).filter(pkgBackWrong) : (pkgBackWrong(r) ? [r] : []));
  if (back && back.length) {
    const fx = _pkgNightAt(back[0]), when = fx ? new Date(fx).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
    return `<td><button type="button" class="pkg-conf" title="Copy ${escapeHtml(c)} again" onclick="event.stopPropagation();pkgCopyConf(this,${J(c)},${J(key)})">${escapeHtml(c)}<i aria-hidden="true">⧉</i></button><span class="pkg-back-tag" title="Ticked fixed ${escapeHtml(when)}, but this IN-Gauge report (saved later) still shows it wrong">↺ Still wrong after the fix of ${escapeHtml(when)}${isGroup && back.length > 1 ? ` · ${back.length} days` : ''}</span></td>`;
  }
  if (d) {
    const rows = _pkgGroupRows(key), n = rows.length || 1, who = d.by ? ' · ' + String(d.by).split(' ')[0] : '';
    const undo = `<button type="button" title="Not copied: back to To fix" onclick="event.stopPropagation();pkgUndone(${J(key)})">↩</button>`;
    if (isGroup || n === 1) {
      const ok = rows.filter(pkgNightDone).length;
      tag = isGroup
        ? `<span class="pkg-done-tag${ok < n ? ' part' : ''}" title="Copied ${escapeHtml(_pkgDoneWhen(d))}${escapeHtml(who)}">${ok < n ? '⚠' : '✅'} ${ok}/${n} days fixed${undo}</span>`
        : `<span class="pkg-done-tag" title="Copied ${escapeHtml(_pkgDoneWhen(d))}${escapeHtml(who)}">✅ ${escapeHtml(_pkgDoneWhen(d))}${escapeHtml(who)}${undo}</span>`;
    }
    if (!isGroup && n > 1) {
      const ok = pkgNightDone(r), day = r.daily || r.from || '';
      tag += `<label class="pkg-day-tick${ok ? ' on' : ''}" onclick="event.stopPropagation()" title="Tick when this day shows the right seller in IN-Gauge"><input type="checkbox"${ok ? ' checked' : ''} onchange="pkgTickNight(${J(key)},${J(_pkgNightKey(r))})"> ${ok ? 'Fixed' : 'Fix'} ${escapeHtml(day)}</label>`;
    }
  }
  return `<td><button type="button" class="pkg-conf" title="Copy ${escapeHtml(c)} (moves it to Copied)" onclick="event.stopPropagation();pkgCopyConf(this,${J(c)},${J(key)})">${escapeHtml(c)}<i aria-hidden="true">⧉</i></button>${tag}</td>`;
}
function pkgCopyConf(btn, conf, key) {
  copyToClipboard(conf);
  btn.classList.add('copied'); setTimeout(() => btn.classList.remove('copied'), 1400);
  const rows = _pkgGroupRows(key), snap = JSON.stringify(pkgDone);
  const back = key && pkgDone[key] ? rows.filter(pkgBackWrong) : [];
  if (back.length) {
    // came back wrong: those days are not fixed after all, tick them again once they really are
    const d = _pkgToNights(pkgDone[key], key);
    back.forEach(x => { delete d.days[_pkgNightKey(x)]; });
    d.at = new Date().toISOString(); d.by = _pkgMe();
    if (rows.length === 1) d.days[_pkgNightKey(rows[0])] = { by: d.by, at: d.at };
    _pkgSaveDone(); pkgRender();
    const msg = rows.length === 1 ? `Copied ${conf} again · back in Copied` : `Copied ${conf} again: ${back.length} day${back.length > 1 ? 's' : ''} still wrong (${back.map(x => x.daily || x.from).join(', ')}). Fix ${back.length > 1 ? 'them' : 'it'}, then tick in Copied`;
    if (typeof showUndoToast === 'function') showUndoToast(msg, () => { pkgDone = JSON.parse(snap); _pkgSaveDone(); pkgRender(); }); else showToast(msg, 'warn');
    return;
  }
  if (!key || pkgDone[key]) { if (typeof showToast === 'function') showToast(`Copied ${conf}`, 'ok'); return; }
  _pkgMarkCopied(key, rows.length === 1 ? [_pkgNightKey(rows[0])] : []);   // one night: copying it is fixing it
  pkgRender();
  const days = rows.map(x => x.daily || x.from).filter(Boolean);
  const msg = rows.length > 1
    ? `Copied ${conf}: ${rows.length} days (${days.join(', ')}). IN-Gauge charges it day by day, so fix every day, then tick each one in Copied`
    : `Copied ${conf} · moved to Copied`;
  if (typeof showUndoToast === 'function') showUndoToast(msg, () => { pkgDone = JSON.parse(snap); _pkgSaveDone(); pkgRender(); });
  else if (typeof showToast === 'function') showToast(msg, rows.length > 1 ? 'warn' : 'ok');
}

// ── Copied (done) marks ───────────────────────────────────
// Copying a package is how it gets fixed in IN-Gauge, so a copied package
// moves to the Copied window for the whole team: who, and when. IN-Gauge
// charges a package night by night, and each night keeps the old seller
// until it is changed, so a package of 4 nights is fixed only when all 4 are
// ticked. Until then it stays open in Copied with a reminder. ↩ puts it back.
// pkgDone[key] = { by, at, nights: true, days: { nightKey: { by, at } } }
// (an entry without "nights" is from before days were ticked: all fixed)
let pkgDone = {};
const PKG_DONE_KEY = 'pkg_done_v1', PKG_DONE_DAYS = 45;
try { pkgDone = JSON.parse(localStorage.getItem(PKG_DONE_KEY) || '{}') || {}; } catch (_) { pkgDone = {}; }
function _pkgNightKey(r) { return String(r.daily || r.from || r.arr || 'stay').replace(/[.#$\[\]\/\s]/g, '_'); }
function _pkgGroupRows(key) { return pkgResults.filter(x => _pkgPinKey(x) === key); }
function pkgIsCopied(r) { return !!pkgDone[_pkgPinKey(r)]; }
/** This night was copied and ticked fixed */
function pkgNightDone(r) { const d = pkgDone[_pkgPinKey(r)]; return !!d && (!d.nights || !!(d.days || {})[_pkgNightKey(r)]); }
function pkgIsDone(r) { return pkgNightDone(r); }
// A fix that didn't stick: the night was ticked fixed, but an IN-Gauge export saved after
// that still shows it wrong. It goes back to To fix, marked, instead of hiding in Copied.
let pkgReportAt = 0;
function _pkgNeeds(r) { return !r.pinSkip && (r.verdict === 'deny' || r.verdict === 'review' || (r.verdict === 'credit' && !r.alreadyComplete)); }
function _pkgNightAt(r) { const d = pkgDone[_pkgPinKey(r)]; if (!d) return 0; const n = d.nights ? (d.days || {})[_pkgNightKey(r)] : d; return n ? Date.parse(n.at) || 0 : 0; }
function pkgBackWrong(r) { return pkgReportAt > 0 && pkgNightDone(r) && _pkgNeeds(r) && pkgReportAt > _pkgNightAt(r) + 60e3; }
/** an old-style entry (whole package, no days) becomes one with every day ticked */
function _pkgToNights(d, key) {
  if (d.nights) { d.days = d.days || {}; return d; }
  d.nights = true; d.days = {};
  _pkgGroupRows(key).forEach(x => { d.days[_pkgNightKey(x)] = { by: d.by || '', at: d.at }; });
  return d;
}
/** The nights of a copied package not ticked yet */
function _pkgLeft(key) { const d = pkgDone[key]; return d && d.nights ? _pkgGroupRows(key).filter(x => !(d.days || {})[_pkgNightKey(x)]) : []; }
function _pkgDoneWhen(d) {
  const t = new Date(d.at || 0); if (isNaN(t)) return '';
  const today = new Date().toDateString() === t.toDateString();
  return today ? t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
function _pkgSaveDone() {
  const cut = Date.now() - PKG_DONE_DAYS * 86400e3;
  Object.keys(pkgDone).forEach(k => { if (!(new Date(pkgDone[k].at).getTime() > cut)) delete pkgDone[k]; });
  try { localStorage.setItem(PKG_DONE_KEY, JSON.stringify(pkgDone)); } catch (_) {}
  _pkgSaveDiff('pkgDone', pkgDone, _pkgDoneLast);
}
const _pkgMe = () => (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || '';
/** Mark a package copied, and these nights of it fixed. Saves. */
function _pkgMarkCopied(key, nights, force) {
  const by = _pkgMe(), at = new Date().toISOString();
  if (!pkgDone[key]) pkgDone[key] = { by, at, nights: true, days: {} };
  const d = force ? _pkgToNights(pkgDone[key], key) : pkgDone[key];
  if (d.nights) { d.days = d.days || {}; (nights || []).forEach(nk => { if (force || !d.days[nk]) d.days[nk] = { by, at }; }); }
  _pkgSaveDone();
}
function pkgTickNight(key, nk) {
  const d = pkgDone[key]; if (!d) return;
  if (!d.nights) { d.nights = true; d.days = {}; _pkgGroupRows(key).forEach(x => { d.days[_pkgNightKey(x)] = { by: d.by || '', at: d.at }; }); }
  d.days = d.days || {};
  if (d.days[nk]) delete d.days[nk]; else d.days[nk] = { by: _pkgMe(), at: new Date().toISOString() };
  _pkgSaveDone();
  pkgRender();
  const rows = _pkgGroupRows(key), left = _pkgLeft(key).length;
  if (!left && typeof showToast === 'function') showToast(`✅ All ${rows.length} days fixed`, 'ok');
}
function pkgUndone(key) {
  if (!pkgDone[key]) return;
  delete pkgDone[key];
  _pkgSaveDone();
  pkgRender();
}
function pkgLoadDone() {
  if (typeof fbListen !== 'function') return;
  fbListen('pkgDone', v => {
    pkgDone = v && typeof v === 'object' ? v : {};
    _pkgRemember(_pkgDoneLast, pkgDone);
    try { localStorage.setItem(PKG_DONE_KEY, JSON.stringify(pkgDone)); } catch (_) {}
    if (pkgResults.length && document.getElementById('pkgResultsWrap')?.style.display !== 'none') pkgRender();
  });
}
document.addEventListener('DOMContentLoaded', () => setTimeout(pkgLoadDone, 1500));
/** Marks a fixed row so it shows faded (the <tr> gets data-done) */
function _pkgDoneMark(html, done) { return done ? html.replace(/^\s*<tr/, '<tr data-done="1"') : html; }
/** A package's nights show by themselves while some are copied but not ticked: that is the reminder */
function _pkgIsOpen(key) { return pkgOpenGroups.has(key) || _pkgLeft(key).length > 0; }
function _pkgRowHtmlInner(r) {
    const gapCell = _pkgActionCell(r);
    if (r.verdict === 'deny') {
      return `<tr style="opacity:0.8;">
        <td><span class="tt-room-pill">${escapeHtml(r.room)}</span></td>
        ${_pkgConfCell(r.conf, r)}
        <td style="font-family:var(--mono);font-size:0.76rem;color:var(--text2);text-decoration:line-through;">${escapeHtml(r.family || r.code)}</td>
        <td style="font-family:var(--mono);font-size:0.72rem;color:var(--text3);">AED ${escapeHtml(String(r.charge))}</td>
        <td colspan="2" style="font-size:0.68rem;color:var(--rose);">${escapeHtml(r.denyReason)}</td>
        ${gapCell}
        <td><span style="color:var(--rose);">⛔ Remove</span></td>
        ${_pkgPinCell(r)}
      </tr>`;
    }
    if (r.verdict === 'credit') {
      const statusCell = r.alreadyComplete
        ? `<span style="color:var(--text3);">✓ OK</span>`
        : `<span style="color:var(--mint);">✏️ Update</span>`;
      return `<tr>
        <td><span class="tt-room-pill">${escapeHtml(r.room)}</span></td>
        ${_pkgConfCell(r.conf, r)}
        <td style="font-family:var(--mono);font-size:0.76rem;font-weight:700;color:${r.alreadyComplete ? 'var(--text2)' : 'var(--mint)'};">${escapeHtml(r.code)}</td>
        <td style="font-family:var(--mono);font-size:0.72rem;">AED ${escapeHtml(r.price)}</td>
        <td style="font-family:var(--mono);font-size:0.68rem;color:var(--text2);">${escapeHtml(r.from) || '—'} → ${escapeHtml(r.to) || '—'}</td>
        <td style="font-family:var(--mono);font-size:0.68rem;color:var(--text2);">${escapeHtml(_pkgUserLabel(r.user))}</td>
        ${gapCell}
        <td>${statusCell}</td>
        ${_pkgPinCell(r)}
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
      ${_pkgConfCell(r.conf, r)}
      <td style="font-family:var(--mono);font-size:0.76rem;">${productCell}</td>
      <td style="font-family:var(--mono);font-size:0.72rem;color:var(--text3);">AED ${escapeHtml(String(r.charge))}</td>
      <td style="font-size:0.66rem;color:var(--text3);">${candText}</td>
      <td style="font-family:var(--mono);font-size:0.68rem;color:var(--text3);">${claimed}</td>
      ${gapCell}
      <td>${statusCell}</td>
      ${_pkgPinCell(r)}
    </tr>`;
}

function pkgSetFilter(f, el) {
  pkgFilter_ = f;
  document.querySelectorAll('#pkgFilters .fchip').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  pkgRender();
}
function pkgSetSearch(val) { pkgSearch_ = val; pkgRender(); }

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
  _pkgCopiedMany(resolved);
}

// ── Copy the deny list — the charges that should NOT be credited ──
function pkgCopyDeny() {
  const denied = pkgResults.filter(r => r.verdict === 'deny' && !r.pinSkip);
  if (!denied.length) { showToast('Nothing to deny — every charge is backed by Opera', 'ok'); return; }
  const s = _pkgAuditStamp();
  const tsv = ['Room\tConfirmation No.\tProduct\tCharge (AED)\tCharged Date\tWhy Deny\tWhat Opera Shows\tAudited On\tAudited By']
    .concat(denied.map(r => [r.room, r.conf, r.family || r.code, r.charge, r.daily || '',
                             r.denyReason, _pkgEvidence(r), s.when, s.who]
      // Tabs and newlines inside a reason would split the row into new columns.
      .map(v => String(v ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')))
    .join('\n');
  copyToClipboard(tsv, document.getElementById('pkgDenyBtn'), '⛔ Copy Deny List');
  _pkgCopiedMany(denied);
}
function _pkgCopiedMany(rows) {
  // a bulk copy holds every night of each package, so every copied night counts as fixed
  const fresh = rows.filter(r => !pkgNightDone(r) || pkgBackWrong(r));
  if (!fresh.length) return;
  const snap = JSON.stringify(pkgDone), byKey = new Map();
  fresh.forEach(r => { const k = _pkgPinKey(r); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(_pkgNightKey(r)); });
  byKey.forEach((nights, k) => _pkgMarkCopied(k, nights, true));
  pkgRender();
  const n = byKey.size;
  if (typeof showUndoToast === 'function') showUndoToast(`${n} package${n > 1 ? 's' : ''} moved to Copied, every day ticked`, () => { pkgDone = JSON.parse(snap); _pkgSaveDone(); pkgRender(); });
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

// ═══════════════════════════════════════════════════════════
//  Seller board — packages, value and commission per seller per month
//
//  Reads pkgResults only (nothing is re-calculated): the same rows the
//  Commission report counts — credited charges, not skipped, not a system
//  (TARS) booking — under the seller the audit settled on (pins and the
//  extension rule included). A package billed over several nights counts
//  once under Packages and once per night under Nights. Rows whose seller
//  still has to be changed in IN-Gauge (not ticked Copied yet) are counted
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
    const pending = !r.alreadyComplete && (!pkgNightDone(r) || pkgBackWrong(r));
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
  return { month: m, months: D.months, list, tot };
}

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
#pkgBoard .pkgb-row{display:grid;grid-template-columns:30px minmax(120px,1.3fr) minmax(90px,2fr) 70px 60px 100px 100px;gap:10px;align-items:center;padding:8px 6px;border-top:1px solid var(--border)}
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
  #pkgBoard .pkgb-row>.c-pk,#pkgBoard .pkgb-row>.c-nt,#pkgBoard .pkgb-row>.c-cm{display:none}
  #pkgBoard .pkgb-row>.pkgb-st{grid-area:st;display:block;font-size:.68rem;color:var(--text2);font-family:var(--mono)}
}
@media(min-width:761px){#pkgBoard .pkgb-st{display:none}}`;
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
      <div class="pkgb-nm">${_pkgbE(r.seller)}<small>${_pkgbE(r.what)}</small>${r.pending ? `<span class="pkgb-pend" title="The audit credits this seller, but IN-Gauge still shows someone else or a blank. Fix it in IN-Gauge and tick it in the list above.">⚠ ${r.pending} not fixed in IN-Gauge yet</span>` : ''}</div>
      <div class="pkgb-bw"><div class="pkgb-bar" title="${_pkgbE(_pkgbN(r.aed))} AED"><i style="width:${Math.max(2, Math.round(r.aed / top * 100))}%"></i></div></div>
      <div class="pkgb-n c-pk">${r.packages}</div>
      <div class="pkgb-n c-nt">${r.nights}</div>
      <div class="pkgb-n c-aed">${_pkgbN(r.aed)}</div>
      <div class="pkgb-n c-cm">${comm(r.commission)}</div>
      <div class="pkgb-st">${r.packages} package${r.packages === 1 ? '' : 's'} · ${r.nights} night${r.nights === 1 ? '' : 's'}${rate > 0 ? ' · commission ' + _pkgbN(r.commission) : ''}</div>
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
      <div class="pkgb-row h"><div>#</div><div>Seller</div><div>Value</div><div class="pkgb-n">Packages</div><div class="pkgb-n">Nights</div><div class="pkgb-n">AED</div><div class="pkgb-n">Commission</div></div>
      ${rows}
      <div class="pkgb-row tot"><div></div><div class="pkgb-nm">Total</div><div class="pkgb-bw"></div><div class="pkgb-n c-pk">${T.packages}</div><div class="pkgb-n c-nt">${T.nights}</div><div class="pkgb-n c-aed">${_pkgbN(T.aed)}</div><div class="pkgb-n c-cm">${comm(T.commission)}</div>
        <div class="pkgb-st">${T.packages} packages · ${T.nights} nights${rate > 0 ? ' · commission ' + _pkgbN(T.commission) : ''}</div></div>
    </div>` : '<div class="pkgb-empty">No credited sales in this audit yet.</div>'}
    <div class="pkgb-foot">A package billed over several nights counts once under Packages and once per night under Nights. Commission = value × the rate you set (shared with the team).
      ${T.pending ? `<b>${T.pending}</b> package${T.pending === 1 ? ' is' : 's are'} credited here but not fixed in IN-Gauge yet: fix them in the list above so IN-Gauge matches.` : ''}
      For the whole month, run the audit with the IN-Gauge export from the 1st of the month.</div>`;
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

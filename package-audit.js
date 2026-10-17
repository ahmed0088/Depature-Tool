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
  if (product === 'Breakfast')       return /(BB$|^BB|BREAK)/i;   // UPS30BB, BBSUM, BBWIN, MBREAK…
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
  // A login is the family name with the person's initials stuck on the
  // front — SALVAREZ/ALVAREZ, LMORENO/MORENO, TKHAN/KHAN —
  // so the longer form ends with the shorter one. Requiring at least
  // three letters and no more than a couple of extra keeps that from
  // matching two different people who happen to share an ending.
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

function _pkgStaffFor(u) {
  const key = _pkgUserKey(u);
  if (!key) return null;
  const login = key.split('-').pop();
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
const PKG_KINDS = [
  ['EC',  'Early check-in',  /EC$/i],
  ['LC',  'Late check-out',  /LC$/i],
  ['BB',  'Breakfast',       /(BB$|^BB|BREAK)/i],
  ['DIN', 'Dinner',          /DIN$/i],
  ['HB',  'Half board',      /^HB/i],
  ['FB',  'Full board',      /^FB/i],
  ['USS', 'Room upgrade',    /^USS\d+$/i],
];
const _pkgKindEntry = code => PKG_KINDS.find(k => k[2].test(String(code || '').replace(/\s+/g, ''))) || null;
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
    if (!/^(Breakfast|Early Check In|Late Check Out)$/i.test(fam)) return;
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
  const n = _pkgFamilyName(r);
  return n === 'Early Check In' ? 'EC' : n === 'Late Check Out' ? 'LC' : n === 'Breakfast' ? 'BB' : '';
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
    const pin = pkgPins[_pkgPinKey(r)];
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
  _pkgSavePins();
  if (typeof logActivity === 'function') {
    const p = pkgPins[key];
    const what = !p ? 'unfrozen' : p.skip ? 'skipped' : p.manual ? `manual sale${p.seller ? ' · ' + p.seller : ''}` : `frozen to ${p.seller}`;
    logActivity('pkg_pin', `Conf ${String(key).split('|')[0]} · ${r ? 'room ' + (r.room || '?') + ' · ' : ''}${String(key).split('|')[1] || ''} → ${what}`);
  }
  _pkgRecompute();
  if (_pkgView === 'rules') pkgRulesRender();
  showToast(val === '__clear' ? 'Unfrozen: the rules decide this package again' : 'Saved for the team: remembered on every run', 'ok');
}

/** The names a seller can be frozen to: the team list, plus everyone this audit already credits. */
function _pkgSellerChoices(extra) {
  const out = PKG_STAFF.slice();
  const add = n => { n = String(n || '').trim(); if (n && n !== '-' && !out.some(x => x === n || _pkgSameUser(x, n))) out.push(n); };
  (pkgResults || []).forEach(r => { [r.user, r.employee].forEach(u => { if (u && !_pkgIsSystemLogin(u)) add(_pkgUserLabel(u)); }); });
  (extra || []).forEach(add);
  return out.sort((a, b) => a.localeCompare(b));
}

function _pkgPinPicker(r, key) {
  const cur = r.pin ? (r.pin.skip ? '__skip' : r.pin.manual ? (r.pin.seller ? '__manual:' + r.pin.seller : '__manual') : r.pin.seller) : '';
  const staff = _pkgSellerChoices(r.pin && r.pin.seller ? [r.pin.seller] : []);
  const J = v => escapeHtml(JSON.stringify(v));
  const title = r.pin ? `Frozen by ${r.pin.by || 'someone'}${r.pin.at ? ' · ' + r.pin.at.slice(0, 10) : ''}` : 'Freeze the seller of this package: the rules will not change it again';
  return `<label class="pa-pin${r.pin ? ' on' : ''}" title="${escapeHtml(title)}"><span>${r.pin ? (r.pin.skip ? '🙈 Skipped' : r.pin.manual ? '✍️ Manual' : '📌 Frozen') : '📌 Freeze seller'}</span>
    <select aria-label="Freeze seller" onchange="pkgPinChange(${J(key)}, this.value)">
    <option value="">${r.pin ? 'Frozen…' : 'Freeze seller…'}</option>
    <optgroup label="Freeze the seller to">${staff.map(n => `<option value="${escapeHtml(n)}"${cur === n ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('')}
    <option value="__other">Someone else…</option></optgroup>
    <optgroup label="Sold by hand in IN-Gauge (not in Opera)">
      <option value="__manual"${cur === '__manual' ? ' selected' : ''}>✍️ Manual sale: keep the IN-Gauge seller</option>
      ${staff.map(n => `<option value="__manual:${escapeHtml(n)}"${cur === '__manual:' + n ? ' selected' : ''}>✍️ Manual sale: ${escapeHtml(n)}</option>`).join('')}
    </optgroup>
    <option value="__skip"${cur === '__skip' ? ' selected' : ''}>🙈 Skip this package</option>
    ${r.pin ? '<option value="__clear">Unfreeze</option>' : ''}
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
const PKG_DONE_KEY = 'pkg_done_v1', PKG_DONE_DAYS = 45;
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
  const cut = Date.now() - PKG_DONE_DAYS * 86400e3;
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

/** Copy the confirmation number = "I fixed it" for every night of this package. */
function pkgCopyConf(btn, conf, key) {
  if (typeof copyToClipboard === 'function') copyToClipboard(conf);
  if (btn) { btn.classList.add('copied'); setTimeout(() => btn.classList.remove('copied'), 1400); }
  if (!key) return;
  const rows = _pkgGroupRows(key), need = rows.filter(_pkgNeeds);
  if (!need.length) { showToast(`Copied ${conf}`, 'ok'); return; }
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
  const msg = `✓ ${conf} marked fixed (${need.length} night${need.length > 1 ? 's' : ''}). It comes back only if a newer IN-Gauge report still shows it wrong.`;
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
  const head = document.getElementById('pkgListHead');
  if (head) head.innerHTML = pkgFilter_ === 'action'
    ? (left ? `<b>${left}</b> package${left > 1 ? 's' : ''} to fix in IN-Gauge <small>Tap the confirmation number to copy it: that marks it fixed.</small>` : '')
    : `<b>${shown.length}</b> package${shown.length !== 1 ? 's' : ''} <small>${escapeHtml((_PKG_VIEWS.find(v => v[0] === pkgFilter_) || [0, ''])[1])}</small>`;

  list.innerHTML = shown.length ? shown.map(_pkgCardHtml).join('')
    : `<div class="pa-empty">${q ? 'No package matches your search.' : pkgFilter_ === 'action'
        ? `<b>✅ All fixed.</b><span>Nothing else needs a change in IN-Gauge${Object.keys(pkgDone).length ? '. Load the next IN-Gauge report to confirm the fixes' : ''}.</span>` : 'Nothing here.'}</div>`;
  try { pkgBoardRender(); } catch (e) { console.warn('[pkg board]', e); }
  if (_pkgView === 'rules') { try { pkgRulesRender(); } catch (e) { console.warn('[pkg rules]', e); } }
}

function _pkgSummaryHtml() {
  const keys = Object.keys(pkgDone);
  if (!keys.length) return `<div class="pa-sum muted">Tip: tap a confirmation number to copy it. That marks the package fixed and takes it off the list.</div>`;
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
  if (r.extendedFrom) return `Same stay as booking ${r.extendedFrom} (back-to-back): ${_pkgUserLabel(r.user)} put this package on first`;
  const o = r.originEvent;
  if (o && (r.reassign || r.needsEmployee)) return `Opera shows ${_pkgUserLabel(o.user)} put it on first (${_pkgTs(o.ts)})`;
  if (r.needsProduct) return 'IN-Gauge did not recognise the package; Opera shows which one it is';
  return '';
}
function _pkgTs(ts) { const s = String(ts || ''); return s.length >= 12 ? `${+s.slice(6, 8)} ${_PKG_MON[+s.slice(4, 6) - 1]} ${s.slice(8, 10)}:${s.slice(10, 12)}` : '—'; }

function _pkgCardHtml(g) {
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
  return `<article class="pa-card t-${tone}" data-key="${escapeHtml(g.key)}">
    ${backTag}
    <div class="pa-top">
      <span class="pa-room" title="Room">${escapeHtml(r0.room || '—')}</span>
      <div class="pa-pk"><b>${escapeHtml(fam)}</b><small>${act.length} night${act.length !== 1 ? 's' : ''} · ${escapeHtml(_pkgNightsText(act))}${total ? ' · AED ' + escapeHtml(String(Math.round(total * 100) / 100)) : ''}</small></div>
      <span class="pa-act">${escapeHtml(actTxt)}${acts.length > 1 ? ` <em>+${acts.length - 1}</em>` : ''}</span>${doneTag}
    </div>
    ${need.length ? _pkgSellerLine(need) : ''}
    ${short ? `<div class="pa-short">${escapeHtml(short)}</div>` : ''}
    <div class="pa-foot">
      <button type="button" class="pa-copy" title="Copy ${escapeHtml(r0.conf)}${need.length ? ' and mark this package fixed' : ''}" onclick="pkgCopyConf(this,${J(String(r0.conf))},${J(g.key)})"><code>${escapeHtml(r0.conf)}</code><span>${need.length ? (back.length ? '⧉ Copy · fixed again' : '⧉ Copy · mark fixed') : '⧉ Copy'}</span></button>
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
    todo = `Open booking <b>${escapeHtml(r0.conf)}</b> in IN-Gauge and on every night (${escapeHtml(nights)}) ${parts.join(' and ') || 'check the line'}. Then copy the number here to mark it fixed.`;
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
  _pkgCopiedMany(resolved);
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
  _pkgCopiedMany(denied);
}

function pkgClear() {
  pkgUnknowns = []; pkgEvents = {}; pkgResults = []; pkgFilter_ = 'action'; pkgSearch_ = ''; pkgPdfFiles = []; pkgLogRange = { min: 0, max: 0 };
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

function _pkgCanEdit() {
  const r = typeof currentProfile !== 'undefined' && currentProfile && currentProfile.role;
  return ['owner', 'manager', 'supervisor'].includes(r);
}
function pkgShowView(v) {
  _pkgView = v === 'rules' ? 'rules' : 'audit';
  const rv = document.getElementById('pkgRulesView'), mv = document.getElementById('pkgMainView');
  if (rv) rv.hidden = _pkgView !== 'rules';
  if (mv) mv.hidden = _pkgView === 'rules';
  document.querySelectorAll('#pkgTabs [data-v]').forEach(b => { const on = b.dataset.v === _pkgView; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  _pkgStyle2(); _pkgStartRulesSync();
  if (_pkgView === 'rules') pkgRulesRender();
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
function _pkgApplyStaff() {
  const list = Object.values(pkgStaffDb || {}).filter(s => s && s.name);
  PKG_STAFF = list.map(s => String(s.name)).sort((a, b) => a.localeCompare(b));
  PKG_STAFF_ALIASES = {};
  list.forEach(s => {
    const al = (Array.isArray(s.logins) ? s.logins : []).map(_pkgLoginTok).filter(a => a.length >= 3);
    if (al.length) PKG_STAFF_ALIASES[String(s.name)] = al;
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
    if (!PKG_STAFF.length && !_pkgReportNames().length) S.push({ tone: 'warn', text: `Your team list is empty, so Opera logins show as they are (like ACCOREN-SALVAREZ). Add your team in Team names below.`, act: ['Add names', "pkgOpenStaff()"] });
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
  const pinsOk = groups.filter(g => g.rows.some(r => r.pin && r.pin.seller && !r.pin.manual && r.prePinVerdict === 'credit' && _pkgSameUser(r.prePinUser, r.pin.seller)));
  if (pinsOk.length) S.push({ tone: 'idle', text: `${pinsOk.length} frozen package${pinsOk.length > 1 ? 's' : ''} now match${pinsOk.length > 1 ? '' : 'es'} the rules anyway. You can unfreeze ${pinsOk.length > 1 ? 'them' : 'it'}.`, act: ['Unfreeze', `pkgUnfreezeMany(${escapeHtml(JSON.stringify(pinsOk.map(g => g.key)))})`] });
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
function _pkgRuleOn(k) { return k === 'chainGap' ? +_pkgRule(k) === 1 : !!_pkgRule(k); }
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
function pkgOpenStaff() {
  _pkgRulesOpen.add('staff');
  const d = document.getElementById('pkgStaffCard');
  if (d) { d.open = true; if (d.scrollIntoView) d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}
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
  const staffBody = `<p class="pr-help">Opera shows logins (ACCOREN-SALVAREZ), IN-Gauge shows names (Sam ALVAREZ). This list joins them for the whole team.</p>
    ${!staff.length ? (can ? `<div class="pa-seed"><label for="pkgStaffSeed"><b>Start the list:</b> paste your team, one per line. Add logins after "=" when they are not simply initials + family name.</label>
        <textarea id="pkgStaffSeed" rows="5" placeholder="Sam ALVAREZ&#10;Lina MORENO = ACCOREN-LMORENO2&#10;Test Person = ACCOREN-TPERSON, TPERS"></textarea>
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
      <div class="pkgb-nm">${_pkgbE(r.seller)}<small>${_pkgbE(r.what)}</small>${r.pending ? `<span class="pkgb-pend" title="The audit credits this seller, but IN-Gauge still shows someone else or a blank. Fix it in IN-Gauge and copy its number in the list above.">⚠ ${r.pending} not fixed in IN-Gauge yet</span>` : ''}</div>
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

// The Package Audit styles (tabs, list, rules) are needed before any file is loaded too.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { try { _pkgStyle2(); } catch (_) {} });
else { try { _pkgStyle2(); } catch (_) {} }

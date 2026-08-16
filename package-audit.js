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
//  → Changes Log, Group=Reservation, Action Type=Update Reservation,
//  Description="product", exported to PDF).
//
//  Matching key: Confirmation No. (present in both reports), then
//  disambiguated by price when a reservation has more than one
//  product event — a reservation's Unknown charge amount only ever
//  matches ONE of its logged product-ADDED events.
// ═══════════════════════════════════════════════════════════

let pkgUnknowns = [];   // from the IN-Gauge export: rows with Product = "Unknown Product"
let pkgEvents   = {};   // conf No. -> [{code, price, from, to, user}], from the Opera Changes Log
let pkgResults  = [];   // joined output after pkgRun()
let pkgFilter_  = 'all';
let pkgSearch_  = '';

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
      product, employee, needsProduct, needsEmployee,
    });
  }
  return out;
}

// ── Opera Changes Log upload (.pdf) ─────────────────────────
function pkgLoadPdf(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    if (typeof pdfjsLib === 'undefined') {
      showToast('PDF engine not loaded yet — please wait a moment and try again', 'err');
      return;
    }
    try {
      busyStart('Reading the Opera Changes Log', 'opening the PDF…');
      await busyPaint();
      const data = new Uint8Array(e.target.result);
      const pdf  = await pdfjsLib.getDocument({ data }).promise;
      pkgEvents  = await _pkgParsePdfEvents(pdf, (done, total) =>
        busyStep(done, total, `reading page ${done} of ${total}`));
      const count = Object.keys(pkgEvents).length;
      const lbl = document.getElementById('pkgPdfLabel');
      if (lbl) lbl.textContent = count
        ? `✓ ${count} confirmation${count !== 1 ? 's' : ''} with product activity`
        : 'Loaded — no product ADD events found';
      showToast(count
        ? `✦ ${count} confirmations with product activity loaded`
        : 'No product events found — check the Description filter was "product"', count ? 'ok' : 'err');
    } catch (err) {
      showToast('Failed to read the Opera Changes Log PDF: ' + err.message, 'err');
    } finally {
      busyDone();
    }
  };
  reader.readAsArrayBuffer(file);
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
    const confMatch = cur.desc.match(/Confirmation No\.\s*(\d+)/);
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

  row.desc.split(';').forEach(clause => {
    const c = clause.trim();
    let m;
    if ((m = c.match(/^PRODUCT\s+([A-Z0-9]+)\s+ADDED\b/i))) { added.push(m[1]); return; }
    if ((m = c.match(/^PRODUCT\s+([A-Z0-9]+)\s+ATTACHED\b/i))) {
      // "ATTACHED FROM <old range> -> FROM <new range>" — the range after
      // the last arrow is the one now in effect.
      const arrow = c.lastIndexOf('->');
      const dm = (arrow >= 0 ? c.slice(arrow + 2) : c).match(/FROM\s+(.+?)\s+TO\s+(.+?)\s*$/i);
      attached.push({ code: m[1], from: dm ? _pkgNormDate(dm[1]) : null, to: dm ? _pkgNormDate(dm[2]) : null });
      return;
    }
    if ((m = c.match(/^PRODUCT\s+([A-Z0-9]+)\s+BETWEEN\s+(.+?)\s+AND\s+(.+?)\s*:(.*)$/i))) {
      // Opera sometimes logs the date range with no PRICE clause at all, so
      // the price is optional here — the dates are still worth keeping.
      const priceM = m[4].match(/PRICE\b[^>]*->\s*([\d.]+)/i);
      details[m[1]] = { from: _pkgNormDate(m[2]), to: _pkgNormDate(m[3]), price: priceM ? priceM[1] : null };
    }
  });

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

// Opera's raw "ACCOREN-CNONIS@ACCOREN" is noise on screen — the tenant
// suffix never varies and never helps identify anyone.
function _pkgUserLabel(u) { return _pkgUserKey(u) || String(u || ''); }

// The matched event says WHICH package the charge is; it does not say who
// sold it. A package added once and repriced later logs two entries under
// the same code, and matching on the charged amount lands on the repricing
// — conf 617204564 is UPS60BB added by AHELSAFTY at 32.66 on 11-Aug and
// moved to 48.98 by CNONIS on 13-Aug, where the 48.98 charge would credit
// CNONIS for a package Ahmed started. Same code is the same package, so
// credit follows its earliest entry.
function _pkgOriginatorFor(ev, cands) {
  if (!ev) return null;
  return _pkgPickOriginator(cands.filter(c => c.code === ev.code)) || ev;
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
    if (r.matchedEvent) return;

    if (!r.candidates || !r.candidates.length) {
      // Opera logged no product activity at all for this reservation. That
      // may just mean the package was sold before this report's date range,
      // so it's a question for a human rather than an automatic reject.
      r.verdict = 'review';
      r.note = 'No Opera record in this report — widen the Changes Log dates to confirm';
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
    // entry than the one whose price identified the charge.
    const origin = _pkgOriginatorFor(ev, cands);

    // A seller already filled in isn't proof it's the right one. Opera says
    // who started the package, so a name that disagrees needs reassigning —
    // that row is not "already correct" just because the field isn't blank.
    const reassign = !u.needsEmployee && !!origin.user && !_pkgSameUser(u.employee, origin.user);
    const alreadyComplete = !u.needsProduct && !u.needsEmployee && !reassign;

    // Keep IN-Gauge's own product name when it already had one, rather than
    // replacing it with Opera's raw internal code. Fall back to the Excel's
    // price/dates when the matched event is an ATTACHED entry, which is a
    // date-range change and carries no price of its own.
    return {
      ...u,
      resolved: true, alreadyComplete, reassign, matchedEvent: ev, originEvent: origin, candidates: cands,
      code:  u.needsProduct ? ev.code : u.product,
      user:  (u.needsEmployee || reassign) ? origin.user : u.employee,
      wasUser: reassign ? u.employee : '',
      price: ev.price ?? String(u.charge),
      from:  ev.from  ?? u.arr,
      to:    ev.to    ?? u.dep,
    };
  });

  _pkgApplyVerdicts(results);
  pkgResults = results;
  document.getElementById('pkgResultsWrap').style.display = 'block';
  pkgRender();
  busyDone();
}

// Plain-language instruction for the row — what the person reading this
// actually has to go and do, rather than which field happened to be blank.
function _pkgActionText(r) {
  if (r.verdict === 'deny')   return 'Remove this charge';
  if (r.verdict === 'review') return 'Check in Opera';
  if (r.needsProduct && r.needsEmployee) return 'Set package + seller';
  if (r.needsProduct && r.reassign) return 'Set package, reassign seller';
  if (r.needsProduct) return 'Set the package';
  if (r.needsEmployee) return 'Set the seller';
  if (r.reassign) return 'Reassign the seller';
  return 'Nothing — already correct';
}

function _pkgActionCell(r) {
  const txt = _pkgActionText(r);
  const color = r.verdict === 'deny' ? 'var(--rose)'
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
    if (pkgFilter_ === 'complete'  && !(r.alreadyComplete && r.verdict === 'credit')) return false;
    if (pkgFilter_ === 'resolved'  && !(r.verdict === 'credit' && !r.alreadyComplete)) return false;
    if (pkgFilter_ === 'deny'      && r.verdict !== 'deny') return false;
    if (pkgFilter_ === 'review'    && r.verdict !== 'review') return false;
    if (q) {
      const hay = [r.conf, r.room, r.code, r.family, r.user, _pkgActionText(r)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const creditCount    = pkgResults.filter(r => r.verdict === 'credit').length;
  const completeCount  = pkgResults.filter(r => r.verdict === 'credit' && r.alreadyComplete).length;
  const fixedCount     = pkgResults.filter(r => r.verdict === 'credit' && !r.alreadyComplete).length;
  const denyCount      = pkgResults.filter(r => r.verdict === 'deny').length;
  const reviewCount    = pkgResults.filter(r => r.verdict === 'review').length;
  [['pkgfc-all', pkgResults.length],
   ['pkgfc-complete', completeCount],
   ['pkgfc-resolved', fixedCount],
   ['pkgfc-deny', denyCount],
   ['pkgfc-review', reviewCount],
  ].forEach(([id, v]) => { const el = document.getElementById(id); if (el) el.textContent = v; });

  document.getElementById('pkgKpis').innerHTML = `
    <div class="kpi sky"><div class="kpi-accent"></div><div class="kpi-label">Charges Checked</div><div class="kpi-val">${pkgResults.length}</div></div>
    <div class="kpi mint"><div class="kpi-accent"></div><div class="kpi-label">Good to Credit</div><div class="kpi-val">${creditCount}</div></div>
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
    return `<tr>
      <td><span class="tt-room-pill">${escapeHtml(r.room)}</span></td>
      <td style="font-family:var(--mono);font-size:0.72rem;">${escapeHtml(r.conf)}</td>
      <td style="font-family:var(--mono);font-size:0.76rem;">${productCell}</td>
      <td style="font-family:var(--mono);font-size:0.72rem;color:var(--text3);">AED ${escapeHtml(String(r.charge))}</td>
      <td colspan="2" style="font-size:0.68rem;color:var(--text3);">${candText}</td>
      ${gapCell}
      <td><span style="color:var(--amber);">⚠ Check</span></td>
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
  pkgUnknowns = []; pkgEvents = {}; pkgResults = []; pkgFilter_ = 'all'; pkgSearch_ = '';
  const ei = document.getElementById('pkgExcelFileInput'); if (ei) ei.value = '';
  const pi = document.getElementById('pkgPdfFileInput');   if (pi) pi.value = '';
  const el = document.getElementById('pkgExcelLabel'); if (el) el.textContent = 'Click to upload';
  const pl = document.getElementById('pkgPdfLabel');   if (pl) pl.textContent = 'Click to upload';
  const search = document.getElementById('pkgSearch'); if (search) search.value = '';
  document.getElementById('pkgResultsWrap').style.display = 'none';
  document.getElementById('pkgError').classList.remove('show');
}

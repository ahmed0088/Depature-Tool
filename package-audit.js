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
  reader.onload = e => {
    try {
      const wb  = XLSX.read(e.target.result, { type: 'array' });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      pkgUnknowns = _pkgParseExcelUnknowns(rows);
      const lbl = document.getElementById('pkgExcelLabel');
      if (lbl) lbl.textContent = pkgUnknowns.length
        ? `✓ ${pkgUnknowns.length} row${pkgUnknowns.length !== 1 ? 's' : ''} need${pkgUnknowns.length === 1 ? 's' : ''} review`
        : 'Loaded — every row already has a product and a seller';
      showToast(pkgUnknowns.length
        ? `✦ ${pkgUnknowns.length} row${pkgUnknowns.length !== 1 ? 's' : ''} flagged (unknown product or missing seller)`
        : 'No rows need review in this file', pkgUnknowns.length ? 'ok' : 'err');
    } catch (err) {
      showToast('Failed to read the IN-Gauge Excel file: ' + err.message, 'err');
    }
  };
  reader.readAsArrayBuffer(file);
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
    // A row only needs auditing if something's actually missing — a row
    // with a known product AND a known seller already has nothing to fix.
    if (!needsProduct && !needsEmployee) continue;

    const conf = String(r[iConf] || '').trim().replace(/\.0+$/, '');
    if (!conf) continue;
    out.push({
      conf,
      room:   iRoom   >= 0 ? String(r[iRoom]   || '').trim() : '',
      charge: iCharge >= 0 ? (parseFloat(r[iCharge]) || 0) : 0,
      days:   iDays   >= 0 ? String(r[iDays]   || '').trim() : '',
      arr:    iArr    >= 0 ? String(r[iArr]    || '').trim() : '',
      dep:    iDep    >= 0 ? String(r[iDep]    || '').trim() : '',
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
      const data = new Uint8Array(e.target.result);
      const pdf  = await pdfjsLib.getDocument({ data }).promise;
      pkgEvents  = await _pkgParsePdfEvents(pdf);
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

// Crystal Reports draws each column as its own vertical band, so pdf.js's
// extracted items come back grouped by COLUMN, not by row — a wrapped user
// email or a multi-line product description shows up as several separate
// text items at the same X but different Y. Row boundaries are anchored on
// the Date column (one short value per row); everything else in that row's
// Y-band (down to the next row's Date) belongs to the same activity entry.
async function _pkgParsePdfEvents(pdf) {
  const events = {}; // conf -> [{code, price, from, to, user}]

  for (let p = 1; p <= pdf.numPages; p++) {
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

    // PDF y increases upward — top-to-bottom reading order is DESCENDING y.
    const dateLines = lines.filter(l => l.col === 'date' && l.text !== 'Date');
    const rowStarts = [...new Set(dateLines.map(l => l.y))].sort((a, b) => b - a);

    for (let i = 0; i < rowStarts.length; i++) {
      const yTop    = rowStarts[i];
      const yBottom = i + 1 < rowStarts.length ? rowStarts[i + 1] : -1e9;
      const rowLines = { user: [], desc: [] };
      lines.forEach(l => {
        if (l.y <= yTop + 0.5 && l.y > yBottom + 0.5 && (l.col === 'user' || l.col === 'desc')) {
          rowLines[l.col].push(l);
        }
      });
      rowLines.user.sort((a, b) => b.y - a.y);
      rowLines.desc.sort((a, b) => b.y - a.y);
      // User email wraps mid-word across lines ("ACCOREN-" / "AHELSAFTY@" /
      // "ACCOREN") — no separator. Description wraps at word boundaries —
      // join with a space, then collapse any doubled whitespace.
      const user = rowLines.user.map(l => l.text).join('');
      const desc = rowLines.desc.map(l => l.text).join(' ').replace(/\s+/g, ' ').trim();

      const confMatch = desc.match(/Confirmation No\.\s*(\d+)/);
      if (!confMatch) continue;
      const conf = confMatch[1];

      const addedRe = /PRODUCT\s+([A-Z0-9]+)\s+ADDED/g;
      let m;
      while ((m = addedRe.exec(desc))) {
        const code = m[1];
        const tail = desc.slice(addedRe.lastIndex, addedRe.lastIndex + 300);
        const priceMatch = tail.match(/PRICE\s*[-\s]*>\s*([\d.]+)/);
        const dateMatch  = tail.match(/BETWEEN\s+([\d-]+-[A-Za-z]+-\d+)\s+AND\s+([\d-]+-[A-Za-z]+-\d+)/);
        (events[conf] = events[conf] || []).push({
          code,
          price: priceMatch ? priceMatch[1] : null,
          from:  dateMatch ? dateMatch[1] : null,
          to:    dateMatch ? dateMatch[2] : null,
          user,
        });
      }
    }
  }
  return events;
}

// ── Reconcile ────────────────────────────────────────────────
function pkgRun() {
  const errBox = document.getElementById('pkgError');
  errBox.classList.remove('show');
  const showErr = msg => { document.getElementById('pkgErrorMsg').textContent = msg; errBox.classList.add('show'); };

  if (!pkgUnknowns.length) return showErr('Upload the IN-Gauge export first — no "Unknown Product" rows loaded.');
  if (!Object.keys(pkgEvents).length) return showErr('Upload the Opera Changes Log PDF first.');

  const results = pkgUnknowns.map(u => {
    const cands = pkgEvents[u.conf] || [];
    const exact = cands.find(c => c.price && Math.abs(parseFloat(c.price) - u.charge) < 0.02);
    if (exact) {
      // If IN-Gauge already knew the product (e.g. "Early Check In"), keep
      // that name rather than overwrite it with Opera's raw internal code —
      // only the seller needed resolving for that row.
      const code = u.needsProduct  ? exact.code : u.product;
      const user = u.needsEmployee ? exact.user : u.employee;
      return { ...u, resolved: true, code, price: exact.price, from: exact.from, to: exact.to, user, candidates: cands };
    }
    return { ...u, resolved: false, candidates: cands };
  });

  pkgResults = results;
  document.getElementById('pkgResultsWrap').style.display = 'block';
  pkgRender();
}

function _pkgGapBadge(r) {
  if (r.needsProduct && r.needsEmployee) return `<span style="color:var(--rose);">Product + Seller</span>`;
  if (r.needsProduct) return `<span style="color:var(--rose);">Product</span>`;
  return `<span style="color:var(--amber);">Seller</span>`;
}

function pkgRender() {
  const q = pkgSearch_.toLowerCase().trim();
  const filtered = pkgResults.filter(r => {
    if (pkgFilter_ === 'resolved'  && !r.resolved) return false;
    if (pkgFilter_ === 'review'    && r.resolved)  return false;
    if (pkgFilter_ === 'noProduct' && !r.needsProduct) return false;
    if (pkgFilter_ === 'noSeller'  && !r.needsEmployee) return false;
    if (q) {
      const hay = [r.conf, r.room, r.code, r.user].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const resolvedCount  = pkgResults.filter(r => r.resolved).length;
  const noProductCount = pkgResults.filter(r => r.needsProduct).length;
  const noSellerCount  = pkgResults.filter(r => r.needsEmployee).length;
  [['pkgfc-all', pkgResults.length],
   ['pkgfc-resolved', resolvedCount],
   ['pkgfc-review', pkgResults.length - resolvedCount],
   ['pkgfc-noProduct', noProductCount],
   ['pkgfc-noSeller', noSellerCount],
  ].forEach(([id, v]) => { const el = document.getElementById(id); if (el) el.textContent = v; });

  document.getElementById('pkgKpis').innerHTML = `
    <div class="kpi sky"><div class="kpi-accent"></div><div class="kpi-label">Flagged Rows</div><div class="kpi-val">${pkgResults.length}</div></div>
    <div class="kpi mint"><div class="kpi-accent"></div><div class="kpi-label">Resolved</div><div class="kpi-val">${resolvedCount}</div></div>
    <div class="kpi ${pkgResults.length - resolvedCount ? 'amber' : ''}"><div class="kpi-accent"></div><div class="kpi-label">Needs Review</div><div class="kpi-val">${pkgResults.length - resolvedCount}</div></div>`;

  const tbody = document.getElementById('pkgTable');
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:36px;font-family:var(--mono);font-size:0.7rem;color:var(--text3);">No rows match.</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(r => {
    const gapCell = `<td style="font-family:var(--mono);font-size:0.66rem;">${_pkgGapBadge(r)}</td>`;
    if (r.resolved) {
      return `<tr>
        <td><span class="tt-room-pill">${escapeHtml(r.room)}</span></td>
        <td style="font-family:var(--mono);font-size:0.72rem;">${escapeHtml(r.conf)}</td>
        <td style="font-family:var(--mono);font-size:0.76rem;font-weight:700;color:var(--mint);">${escapeHtml(r.code)}</td>
        <td style="font-family:var(--mono);font-size:0.72rem;">AED ${escapeHtml(r.price)}</td>
        <td style="font-family:var(--mono);font-size:0.68rem;color:var(--text2);">${escapeHtml(r.from) || '—'} → ${escapeHtml(r.to) || '—'}</td>
        <td style="font-family:var(--mono);font-size:0.68rem;color:var(--text2);">${escapeHtml(r.user)}</td>
        ${gapCell}
        <td><span style="color:var(--mint);">✅ Resolved</span></td>
      </tr>`;
    }
    const candText = r.candidates.length
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
      <td><span style="color:var(--amber);">⚠ Review</span></td>
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
  const resolved = pkgResults.filter(r => r.resolved);
  if (!resolved.length) { showToast('No resolved rows to copy', 'err'); return; }
  const tsv = ['Room\tConfirmation No.\tProduct Code\tPrice (AED)\tFrom\tTo\tSold By']
    .concat(resolved.map(r => [r.room, r.conf, r.code, r.price, r.from || '', r.to || '', r.user].join('\t')))
    .join('\n');
  copyToClipboard(tsv, document.getElementById('pkgCopyBtn'), '📋 Copy Resolved Rows');
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

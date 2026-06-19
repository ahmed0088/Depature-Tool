// ═══════════════════════════════════════════════════════════
//  noshow.js  —  NA40 No-Show PDF Parser & Excel Exporter
//
//  Upload the daily NA40 PDF from Opera → extracts all
//  no-show guests → displays in a table → one-click copy
//  as TSV for direct paste into your Excel sheet.
//
//  Columns exported:
//    Date | Status | Guest Name | Conf. No. | Channel/Source
//    | No. of Nights | New Conf. No. (FO) | Room Rate | Total
// ═══════════════════════════════════════════════════════════

// ── State ─────────────────────────────────────────────────
let nsGuests   = [];
let nsReportDate = '';
let nsSearch_  = '';

// ── PDF.js worker URL ─────────────────────────────────────
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ── Init ──────────────────────────────────────────────────
function initNoShow() {
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }
  const badge = document.getElementById('badge-noshow');
  if (badge) badge.textContent = '—';
}

// ── File pick handler ─────────────────────────────────────
function nsHandleFile(input) {
  const file = input?.files?.[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
    showToast('Please upload a PDF file (NA40 report from Opera)', 'err');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => nsParsePDF(e.target.result);
  reader.onerror = () => showToast('Could not read the file', 'err');
  reader.readAsArrayBuffer(file);
}

// ── Drag-and-drop handlers ────────────────────────────────
function nsOnDragOver(e) {
  e.preventDefault();
  document.getElementById('nsDropZone').classList.add('ns-drag-active');
}
function nsOnDragLeave() {
  document.getElementById('nsDropZone').classList.remove('ns-drag-active');
}
function nsOnDrop(e) {
  e.preventDefault();
  document.getElementById('nsDropZone').classList.remove('ns-drag-active');
  const file = e.dataTransfer?.files?.[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (ev) => nsParsePDF(ev.target.result);
    reader.onerror = () => showToast('Could not read the file', 'err');
    reader.readAsArrayBuffer(file);
  }
}

// ── Core PDF parser ───────────────────────────────────────
async function nsParsePDF(arrayBuffer) {
  nsSetLoading(true);

  if (typeof pdfjsLib === 'undefined') {
    showToast('PDF engine not loaded yet — please wait a moment and try again', 'err');
    nsSetLoading(false);
    return;
  }

  try {
    const data = new Uint8Array(arrayBuffer);
    const pdf  = await pdfjsLib.getDocument({ data }).promise;
    let allRows = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      const page    = await pdf.getPage(p);
      const content = await page.getTextContent();
      const rows    = nsGroupByY(content.items, 1.2);
      allRows = allRows.concat(rows);
    }

    const guests = nsExtractGuests(allRows);

    if (guests.length === 0) {
      showToast('No no-show guests found — check this is an NA40 report', 'err');
      nsSetLoading(false);
      return;
    }

    // Extract report date from first guest's arrival date
    nsReportDate = guests[0].arrDate || '';
    nsGuests = guests;

    nsSetLoading(false);
    nsShowResults();
    nsRender();
    nsUpdateBadge();
    showToast(`${guests.length} no-show${guests.length !== 1 ? 's' : ''} loaded ✓`, 'ok');

  } catch (err) {
    console.error('[noshow] PDF parse error:', err);
    showToast('Could not parse PDF — make sure it is an Opera NA40 report', 'err');
    nsSetLoading(false);
  }
}

// ── Group text items by Y position (row reconstruction) ───
function nsGroupByY(items, tol) {
  const pts = items
    .filter(it => it.str && it.str.trim() !== '')
    .map(it => ({ str: it.str.trim(), x: it.transform[4], y: it.transform[5] }));

  pts.sort((a, b) => (b.y - a.y) || (a.x - b.x));

  const rows = [];
  for (const p of pts) {
    let row = rows.find(r => Math.abs(r.y - p.y) <= tol);
    if (!row) { row = { y: p.y, items: [] }; rows.push(row); }
    row.items.push(p);
  }
  rows.sort((a, b) => b.y - a.y);
  rows.forEach(r => r.items.sort((a, b) => a.x - b.x));
  return rows;
}

// ── Extract guest records from reconstructed rows ─────────
const _DATE_RE = /^\d{2}-\d{2}-\d{2}$/;
const _CONF_RE = /^\d{6,12}$/;
const _SKIP_RE = /^(Res\.?\s*Comments?|Reservation|General|Profile Comments|Property Notes|Reservation Notes|Total\b|Grand Total|Filter\b|Page \d|Room Class|Confirmation No\.?|Block Code|Travel Agent|Source$|Name$|Company$|From Date|To Date|nanoshow|NA40)/i;

function nsExtractGuests(rows) {
  const guests = [];

  for (let i = 0; i < rows.length; i++) {
    const items = rows[i].items;

    // Guest data rows always have exactly 2 date-shaped values (arr + dep)
    const datePositions = [];
    items.forEach((it, idx) => { if (_DATE_RE.test(it.str)) datePositions.push(idx); });
    if (datePositions.length < 2) continue;

    const arrIdx = datePositions[0];
    const depIdx = datePositions[1];

    // Items before first date: [room?, name, company...]
    const before = items.slice(0, arrIdx);
    // Items after dep date: [roomType, mktCode, resType, rateCode, rateAmount, rms, nights, potRev, deposit]
    const after  = items.slice(depIdx + 1);

    let b = [...before];
    // Drop leading room number if numeric
    if (b.length && /^\d{1,4}$/.test(b[0].str)) b = b.slice(1);

    const nameRaw    = b[0]?.str || '';
    const companyRaw = b.slice(1).map(x => x.str).join(' ').trim();
    const arrDate    = items[arrIdx].str;
    const depDate    = items[depIdx].str;

    const rateAmount  = after[4]?.str || '0.00';
    const nights      = after[6]?.str || '1';
    const potRev      = after[7]?.str || '0.00';

    // Look ahead for company continuation + confirmation number
    let company = companyRaw;
    let confNo  = '';
    let j = i + 1;

    if (j < rows.length) {
      const next    = rows[j].items;
      const nextStr = next.map(it => it.str).join(' ');
      const isConf  = next.length >= 1 && _CONF_RE.test(next[0].str);
      const isMainRow = next.filter(it => _DATE_RE.test(it.str)).length >= 2;
      const isSkip  = _SKIP_RE.test(nextStr);

      if (!isConf && !isMainRow && !isSkip && nextStr.length < 60) {
        company = (company + ' ' + nextStr).trim();
        j++;
      }
    }
    if (j < rows.length) {
      const cItems = rows[j].items;
      if (cItems.length && _CONF_RE.test(cItems[0].str)) confNo = cItems[0].str;
    }

    guests.push({
      arrDate,
      depDate,
      nameRaw,
      company,
      nights:     parseInt(nights) || 1,
      rateAmount: parseFloat(rateAmount.replace(/,/g, '')) || 0,
      potRev:     parseFloat(potRev.replace(/,/g, '')) || 0,
      confNo,
      newConf:    '',   // filled by FO after rebooking
    });
  }

  return guests;
}

// ── Name cleaner (matches existing cleanName() in utils.js) ──
function nsCleanName(raw) {
  if (!raw) return '—';
  // Remove title suffixes: ,Mr. / ,Mrs. / ,Ms. etc.
  let s = raw.replace(/,?\s*(Mr\.?|Mrs\.?|Ms\.?|Miss|MR|MRS|DR\.?)\s*$/i, '').trim();
  const parts = s.split(',').map(p => p.trim()).filter(p => p);
  if (parts.length >= 2) {
    // "Surname, Firstname" → "Firstname Surname"
    return (parts[1] + ' ' + parts[0]).replace(/\s+/g, ' ').trim();
  }
  return s;
}

// ── Source cleaner (matches cleanSource() in utils.js) ────
function nsCleanSource(raw) {
  if (!raw) return 'Walk-in';
  return raw
    .replace(/^[TCt][-–]\s*/i, '')                // remove "T-" or "C-" prefix
    .replace(/BOOKING\.COM BV.*$/i, 'Booking.com')
    .replace(/HOTELBEDS FZCO/i, 'Hotelbeds')
    .replace(/CTRIP INTERNATIONA.*/i, 'Ctrip International')
    .replace(/AGODA COMPANY PTE LTD/i, 'Agoda')
    .replace(/EXPEDIA\.COM.*/i, 'Expedia')
    .replace(/\s*\(.*?\)/g, '')
    .trim() || 'Direct';
}

// ── UI helpers ─────────────────────────────────────────────
function nsSetLoading(on) {
  const wrap = document.getElementById('nsLoadWrap');
  if (wrap) wrap.style.display = on ? 'flex' : 'none';
  const dz = document.getElementById('nsDropZone');
  if (dz) dz.style.opacity = on ? '0.4' : '1';
}

function nsShowResults() {
  document.getElementById('nsUploadCard').style.display = 'none';
  document.getElementById('nsResultCard').style.display = 'block';
  const hdr = document.getElementById('nsHeaderActions');
  if (hdr) hdr.style.display = '';
}

function nsUpdateBadge() {
  const badge = document.getElementById('badge-noshow');
  if (badge) badge.textContent = nsGuests.length || '0';
}

function nsUpdateKpi() {
  const count = nsGuests.length;
  const totalRev = nsGuests.reduce((s, g) => s + g.potRev, 0);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('ns-kpi-count',  count);
  set('ns-kpi-rev',    'AED ' + totalRev.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  set('ns-kpi-date',   nsReportDate || '—');
  set('nsDateLabel',   count
    ? `${count} no-show${count !== 1 ? 's' : ''} · ${nsReportDate}`
    : 'Upload a new NA40 report');
}

// ── Render table ──────────────────────────────────────────
function nsRender() {
  nsUpdateKpi();

  const search = (nsSearch_ || '').toLowerCase();
  const rows = nsGuests.filter(g => {
    if (!search) return true;
    const hay = [g.confNo, g.nameRaw, nsCleanName(g.nameRaw), nsCleanSource(g.company), g.company].join(' ').toLowerCase();
    return hay.includes(search);
  });

  const tbody = document.getElementById('nsTable');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:36px;font-family:var(--mono);font-size:0.7rem;color:var(--text3);">No results${search ? ' for "' + search + '"' : ''}.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((g, idx) => {
    const name   = nsCleanName(g.nameRaw);
    const source = nsCleanSource(g.company);
    return `<tr>
      <td style="font-family:var(--mono);font-size:0.7rem;color:var(--text3);">${g.arrDate}</td>
      <td><span class="ns-status-pill">No Show</span></td>
      <td style="font-weight:600;color:var(--text);">${name}</td>
      <td style="font-family:var(--mono);font-size:0.72rem;color:var(--text2);">${g.confNo || '—'}</td>
      <td style="font-size:0.75rem;color:var(--text2);">${source}</td>
      <td style="font-family:var(--mono);text-align:center;">${g.nights}</td>
      <td>
        <input
          class="ns-new-conf-input"
          type="text"
          placeholder="Enter new conf…"
          value="${g.newConf || ''}"
          data-idx="${idx}"
          oninput="nsGuests[${idx}].newConf=this.value"
        />
      </td>
      <td style="font-family:var(--mono);font-size:0.75rem;color:var(--text2);text-align:right;">
        ${g.rateAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </td>
      <td style="font-family:var(--mono);font-size:0.75rem;font-weight:600;color:var(--text);text-align:right;">
        ${g.potRev.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </td>
    </tr>`;
  }).join('');
}

// ── Copy as TSV for Excel paste ───────────────────────────
// ── Convert Opera DD-MM-YY to D-MMM for Excel (e.g. 16-Jun) ──
const _MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function nsExcelDate(operaDate) {
  if (!operaDate) return '';
  const p = operaDate.split('-');
  if (p.length !== 3) return operaDate;
  const day = parseInt(p[0], 10);
  const mon = parseInt(p[1], 10);
  if (!day || !mon || mon < 1 || mon > 12) return operaDate;
  return day + '-' + _MONTH_ABBR[mon - 1];
}

function nsCopyForExcel() {
  if (!nsGuests.length) { showToast('No data to copy', 'info'); return; }

  const search = (nsSearch_ || '').toLowerCase();
  const rows = nsGuests.filter(g => {
    if (!search) return true;
    const hay = [g.confNo, g.nameRaw, nsCleanName(g.nameRaw), nsCleanSource(g.company)].join(' ').toLowerCase();
    return hay.includes(search);
  });

  const lines = rows.map(g => [
      nsExcelDate(g.arrDate),
      'No Show',
      nsCleanName(g.nameRaw),
      g.confNo,
      nsCleanSource(g.company),
      g.nights,
      g.newConf || '',
      g.rateAmount.toFixed(2),
      g.potRev.toFixed(2),
    ].join('\t'));

  copyToClipboard(lines.join('\n'), null, '');
  showToast(`${rows.length} rows copied — paste into Excel ✓`, 'ok');
}

// ── Clear / new report ────────────────────────────────────
function nsClear() {
  nsGuests      = [];
  nsReportDate  = '';
  nsSearch_     = '';

  document.getElementById('nsUploadCard').style.display = 'block';
  document.getElementById('nsResultCard').style.display = 'none';
  const hdr = document.getElementById('nsHeaderActions');
  if (hdr) hdr.style.display = 'none';
  const inp = document.getElementById('nsPdfInput');
  if (inp) inp.value = '';
  const srch = document.getElementById('nsSearch');
  if (srch) srch.value = '';
  nsUpdateBadge();
}

// ── Search ────────────────────────────────────────────────
function nsSetSearch(val) {
  nsSearch_ = val || '';
  nsRender();
}

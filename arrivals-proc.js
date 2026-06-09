// ═══════════════════════════════════════════════════════════
//  arrivals-proc.js  —  Arrivals Report Processor
//  Integrated into Ibis Ops Platform
//  Uses showToast(), logActivity() from the main app
// ═══════════════════════════════════════════════════════════

// ── STATE ─────────────────────────────────────────────────
let apDays       = [];
let apSelIdx     = null;
let apDragSrcCol = null;
let apDragSrcIdx = null;
let apRawLines   = [];
let apRawHeaders = [];
let apDetectedCodes = [];
let apSortCol    = 'date';
let apSortDir    = 'asc';
let apStatusMap  = {};
let apExcludedStatuses = new Set();
let apColMapping = {};

const AP_PKG_DEFAULTS = {
  upsell: ['USS100EC', 'USS100LC'],
  fo:     ['UPS40BB', 'UPS80BB'],
  fb:     ['BBSUM', 'BBWIN', 'COMPBB', 'FBSUM', 'HBINC', 'HBWIN', 'MBREAK'],
};

function apLoadPkgData() {
  try {
    const saved = localStorage.getItem('ibis_arrivals_proc_profile');
    if (saved) {
      const p = JSON.parse(saved);
      if (p.pkgData) return {
        upsell: p.pkgData.upsell || [...AP_PKG_DEFAULTS.upsell],
        fo:     p.pkgData.fo     || [...AP_PKG_DEFAULTS.fo],
        fb:     p.pkgData.fb     || [...AP_PKG_DEFAULTS.fb],
      };
    }
  } catch(e) {}
  // No saved profile — use hotel defaults
  return {
    upsell: [...AP_PKG_DEFAULTS.upsell],
    fo:     [...AP_PKG_DEFAULTS.fo],
    fb:     [...AP_PKG_DEFAULTS.fb],
  };
}

const apPkgData = apLoadPkgData();

// Per-code count mode for F&B — 'pax' or 'room', defaults to 'pax'
let apFbCountMode = {};

function apLoadFbCountMode() {
  try {
    const saved = localStorage.getItem('ibis_arrivals_proc_profile');
    if (saved) {
      const p = JSON.parse(saved);
      if (p.fbCountMode) return p.fbCountMode;
    }
  } catch(e) {}
  return {};
}
apFbCountMode = apLoadFbCountMode();

function apAutoSaveProfile() {
  try {
    const p = {
      pkgData:     { upsell:[...apPkgData.upsell], fo:[...apPkgData.fo], fb:[...apPkgData.fb] },
      upsellMode:  document.getElementById('ap-mode-upsell')?.value  || 'contains',
      foMode:      document.getElementById('ap-mode-fo')?.value      || 'contains',
      fbMode:      document.getElementById('ap-mode-fb')?.value      || 'contains',
      upsellCount: document.getElementById('ap-count-upsell')?.value || 'room',
      foCount:     document.getElementById('ap-count-fo')?.value     || 'pax',
      fbCount:     document.getElementById('ap-count-fb')?.value     || 'pax',
      fbCountMode: apFbCountMode,
      exclStatus:  document.getElementById('ap-excl-status')?.value  || '',
    };
    localStorage.setItem('ibis_arrivals_proc_profile', JSON.stringify(p));
  } catch(e) {}
}

// ── COLUMN DEFINITIONS ────────────────────────────────────
const AP_COL_DEFS = [
  { key: 'dateLabel', label: 'Date Column',          required: true,  aliases: ['GROUPBY1_COL','ARRIVAL_DATE','ARR_DATE','DATE'] },
  { key: 'dateSort',  label: 'Date Sort Column',     required: false, aliases: ['GROUPBY1_SORT_COL','DATE_SORT'] },
  { key: 'status',    label: 'Reservation Status',   required: true,  aliases: ['SHORT_RESV_STATUS','RESV_STATUS','STATUS'] },
  { key: 'products',  label: 'Products/Packages',    required: false, aliases: ['PRODUCTS','PACKAGES','PACKAGE','PKG'] },
  { key: 'adults',    label: 'Adults/Pax',           required: true,  aliases: ['ADULTS','ADL','ADU','PAX'] },
  { key: 'persons',   label: 'Persons (fallback)',    required: false, aliases: ['PERSONS','CF_ADULTS'] },
  { key: 'chl',       label: 'Total Pax (Chl.)',      required: false, aliases: ['CHL','CHD','CHILD','CHILDREN'] },
  { key: 'confNo',    label: 'Confirmation No.',     required: true,  aliases: ['CONFIRMATION_NO','CONF_NO','CONFNO','RESERVATION_NO'] },
  { key: 'rownum',    label: 'Row No. (Opera dedup)',required: false, aliases: ['ROWNUM','ROW_NUM','ROW_NO'] },
  { key: 'adlArr',    label: 'ADL Arrivals (Opera)', required: false, aliases: ['ADL_ARRIVAL','ADL_ARR'] },
  { key: 'rmsArr',    label: 'Rooms Arrivals (Opera)',required: false, aliases: ['RMS_ARRIVAL','RMS_ARR'] },
  { key: 'roomCat',  label: 'Room Category',        required: false, aliases: ['ROOM_CATEGORY_LABEL','ROOM_CATEGORY','ROOM_TYPE','ROOM_CAT'] },
];

// ── INIT ──────────────────────────────────────────────────
function initArrivalsProc() {
  // Restore saved dropdown/settings from localStorage
  try {
    const saved = localStorage.getItem('ibis_arrivals_proc_profile');
    if (saved) {
      const p = JSON.parse(saved);
      if (p.upsellMode  && document.getElementById('ap-mode-upsell'))   document.getElementById('ap-mode-upsell').value   = p.upsellMode;
      if (p.foMode      && document.getElementById('ap-mode-fo'))        document.getElementById('ap-mode-fo').value        = p.foMode;
      if (p.fbMode      && document.getElementById('ap-mode-fb'))        document.getElementById('ap-mode-fb').value        = p.fbMode;
      if (p.upsellCount && document.getElementById('ap-count-upsell'))   document.getElementById('ap-count-upsell').value   = p.upsellCount;
      if (p.foCount     && document.getElementById('ap-count-fo'))       document.getElementById('ap-count-fo').value       = p.foCount;
      if (p.fbCount     && document.getElementById('ap-count-fb'))       document.getElementById('ap-count-fb').value       = p.fbCount;
      if (p.exclStatus  !== undefined && document.getElementById('ap-excl-status')) {
        document.getElementById('ap-excl-status').value = p.exclStatus;
        apExcludedStatuses = new Set(p.exclStatus.split(',').map(s => s.trim()).filter(Boolean));
      }
    }
  } catch(e) {}
  ['upsell','fo','fb'].forEach(apRenderTags);

  // Auto-save whenever any setting dropdown changes
  ['ap-mode-upsell','ap-mode-fo','ap-mode-fb','ap-count-upsell','ap-count-fo','ap-count-fb','ap-excl-status'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', apAutoSaveProfile);
  });
  const exclEl = document.getElementById('ap-excl-status');
  if (exclEl) exclEl.addEventListener('input', apAutoSaveProfile);

  const dz = document.getElementById('ap-drop-zone');
  if (!dz) return;

  dz.addEventListener('dragover', e => {
    e.preventDefault();
    dz.classList.add('ap-drag-active');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('ap-drag-active'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('ap-drag-active');
    if (e.dataTransfer.files[0]) apHandleFile(e.dataTransfer.files[0]);
  });
}

// ── FILE IMPORT ───────────────────────────────────────────
function apHandleFile(file) {
  if (!file) return;
  apShowProgress();
  const reader = new FileReader();
  reader.onload = e => {
    let content = e.target.result;
    if (file.name.match(/\.html?$/i)) content = apExtractFromHtml(content);
    document.getElementById('ap-raw').value = content;
    apOnRawChange(file.name);
    apSetProgress(100);
    setTimeout(apHideProgress, 400);
  };
  reader.readAsText(file);
}

function apExtractFromHtml(html) {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(html, 'text/html');
  const tables = doc.querySelectorAll('table');
  if (tables.length) {
    let best = tables[0];
    tables.forEach(t => { if (t.rows.length > best.rows.length) best = t; });
    const rows = [];
    best.querySelectorAll('tr').forEach(tr => {
      const cells = [];
      tr.querySelectorAll('th,td').forEach(td => cells.push(td.innerText || td.textContent || ''));
      if (cells.some(c => c.trim())) rows.push(cells.join('\t'));
    });
    if (rows.length > 1) return rows.join('\n');
  }
  const pre = doc.querySelector('pre,textarea');
  if (pre) return pre.textContent;
  return doc.body ? doc.body.innerText || doc.body.textContent : html;
}

function apTogglePaste() {
  const pa = document.getElementById('ap-paste-area');
  pa.style.display = pa.style.display === 'none' ? 'block' : 'none';
}

function apShowProgress() {
  const pb = document.getElementById('ap-progress-bar');
  if (pb) pb.style.display = 'block';
  apSetProgress(30);
  setTimeout(() => apSetProgress(70), 150);
}
function apSetProgress(v) {
  const f = document.getElementById('ap-progress-fill');
  if (f) f.style.width = v + '%';
}
function apHideProgress() {
  apSetProgress(0);
  setTimeout(() => {
    const pb = document.getElementById('ap-progress-bar');
    if (pb) pb.style.display = 'none';
  }, 300);
}

// ── RAW CHANGE → SCAN ─────────────────────────────────────
function apOnRawChange(fileName) {
  const raw = (document.getElementById('ap-raw')?.value || '').trim();
  if (!raw) { apHideScan(); return; }
  const lines = apJoinSplitRows(raw.split('\n').map(l => l.trimEnd()));
  if (lines.length < 2) { apHideScan(); return; }
  apRawLines   = lines;
  apRawHeaders = lines[0].split('\t').map(h => h.trim());
  apScanReport(fileName);
}

// ── Join rows split by newlines inside address fields ─────
// Opera sometimes exports BILL_TO_ADDRESS (and other free-text fields)
// with embedded newlines, which breaks the tab-delimited format by
// splitting one logical row across 2 or 3 physical lines.
//
// Example: room 0511 LARI — BILL_TO_ADDRESS = "30 08 Prudential Tow\nbangkok\n-049712"
// causes the single reservation row to appear as 3 physical lines in the file.
//
// Detection strategy:
//   • A real data row has ≥ 55% of the header's tab count  (was 40% — raised to reduce false starts)
//   • OR it starts with a date-like value (DD-MON-YY, YYYYMMDD, DD/MM/YY)
//   • OR it starts with a digit that could be a reservation/conf number
//   • A continuation line has very few tabs AND does not look like a new record
//
// After joining, a second pass validates column count and re-merges any rows
// that are still short (handles 3+ line splits).
function apJoinSplitRows(rawLines) {
  if (!rawLines.length) return rawLines;
  const headerTabCount = (rawLines[0].match(/\t/g) || []).length;
  // 55% threshold — a real Opera row will always have most of its columns populated.
  // Address continuation lines typically have 0-3 tabs; tail fragments have ~15.
  // With 55 header tabs, minTabs = 30. A 15-tab tail is below that → correctly
  // identified as continuation and merged into the address cell.
  const minTabs    = Math.ceil(headerTabCount * 0.55);
  const datePattern = /^(\d{1,2}[-\/]\w{2,3}[-\/]\d{2,4}|\d{8}|\d{2}-\d{2}-\d{2})/;
  // Opera row identifiers: reservation numbers, dates, or numeric IDs in first field
  const newRowStart = /^(\d{6,}|\d{1,2}[-\/])/;

  const joined = [rawLines[0]]; // keep header as-is
  for (let i = 1; i < rawLines.length; i++) {
    const line     = rawLines[i];
    if (!line.trim()) continue;                           // skip blank lines
    const tabCount = (line.match(/\t/g) || []).length;
    const firstField = line.split('\t')[0].trim();
    const isNewRow = tabCount >= minTabs
                  || datePattern.test(firstField)
                  || newRowStart.test(firstField);
    if (isNewRow) {
      joined.push(line);
    } else {
      // Continuation of previous row — append with a space.
      // The address tail's tabs re-create the correct column boundaries because
      // the text before the first tab merges into the address cell, and the
      // tab-delimited fields that follow land on the correct column indices.
      if (joined.length > 1) {
        joined[joined.length - 1] += ' ' + line.trim();
      }
    }
  }

  // ── Second pass: validate column counts ──────────────────
  // If a joined row still has fewer columns than the header, it means
  // the address had 3+ embedded newlines. Keep merging forward until
  // the column count is correct or we hit the next valid row.
  const result = [joined[0]];
  for (let i = 1; i < joined.length; i++) {
    const tabCount = (joined[i].match(/\t/g) || []).length;
    if (tabCount < headerTabCount && i + 1 < joined.length) {
      const nextTabs = (joined[i + 1].match(/\t/g) || []).length;
      // If next row would bring us closer to the header count, merge it
      if (tabCount + nextTabs <= headerTabCount + 2) {
        joined[i + 1] = joined[i] + ' ' + joined[i + 1].trim();
        continue; // skip adding current row — it'll come through with next
      }
    }
    result.push(joined[i]);
  }

  return result;
}

function apHideScan() {
  ['ap-scan-summary','ap-status-breakdown','ap-col-mapper','ap-detect-banner'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const dz = document.getElementById('ap-drop-zone');
  if (dz && dz.classList.contains('ap-loaded')) {
    dz.classList.remove('ap-loaded');
    const icon = document.getElementById('ap-drop-icon');
    const txt  = document.getElementById('ap-drop-txt');
    if (icon) icon.className = 'ti ti-file-upload';
    if (txt)  txt.textContent = 'Drop your Opera export here, or click to browse';
  }
}

function apScanReport(fileName) {
  const lines = apRawLines;
  const hdrs  = apRawHeaders;

  // Auto-match columns
  apColMapping = {};
  const matchConf = {};
  AP_COL_DEFS.forEach(def => {
    let found = -1, conf = 'low';
    for (const alias of def.aliases) {
      const i = hdrs.findIndex(h => h.toUpperCase() === alias.toUpperCase());
      if (i !== -1) { found = i; conf = 'high'; break; }
    }
    if (found === -1) {
      for (const alias of def.aliases) {
        const i = hdrs.findIndex(h => h.toUpperCase().includes(alias.toUpperCase()));
        if (i !== -1) { found = i; conf = 'low'; break; }
      }
    }
    apColMapping[def.key] = found;
    matchConf[def.key]    = conf;
  });

  // Count statuses
  apStatusMap = {};
  const statusIdx = apColMapping.status;
  if (statusIdx !== -1) {
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split('\t');
      const s = (c[statusIdx] || '').trim().toUpperCase();
      if (s) apStatusMap[s] = (apStatusMap[s] || 0) + 1;
    }
  }

  // Detect product codes
  const prodIdx = apColMapping.products;
  const codeSet = new Set();
  if (prodIdx !== -1) {
    for (let i = 1; i < lines.length; i++) {
      const c    = lines[i].split('\t');
      const cell = (c[prodIdx] || '').trim();
      if (!cell) continue;
      cell.split(/[,;\s\/|]+/).map(s => s.trim().toUpperCase())
        .filter(s => s.length >= 2 && s.length <= 12 && /^[A-Z0-9_-]+$/.test(s))
        .forEach(s => codeSet.add(s));
    }
  }
  apDetectedCodes = [...codeSet].sort();

  // Update drop zone
  const dz = document.getElementById('ap-drop-zone');
  if (dz) dz.classList.add('ap-loaded');
  const icon = document.getElementById('ap-drop-icon');
  const txt  = document.getElementById('ap-drop-txt');
  if (icon) icon.className = 'ti ti-circle-check';
  if (txt)  txt.textContent = (fileName || 'Report loaded') + ' — ' + (lines.length - 1) + ' rows';

  // Render scan summary
  const scanEl = document.getElementById('ap-scan-summary');
  if (scanEl) {
    scanEl.style.display = 'block';
    const required = ['confNo','status','adults','dateLabel'];
    const grid = document.getElementById('ap-scan-grid');
    if (grid) {
      const items = [
        { label:'Rows',         val:(lines.length - 1).toLocaleString(), dot:'ok' },
        { label:'Columns',      val:hdrs.length,                          dot:'ok' },
        { label:'Statuses',     val:Object.keys(apStatusMap).length,      dot:Object.keys(apStatusMap).length ? 'ok' : 'warn' },
        { label:'Pkg Codes',    val:apDetectedCodes.length,               dot:apDetectedCodes.length ? 'ok' : 'warn' },
        ...required.map(k => {
          const def   = AP_COL_DEFS.find(d => d.key === k);
          const found = apColMapping[k] !== -1;
          return { label:def.label, val:found ? hdrs[apColMapping[k]] : 'NOT FOUND', dot:found ? (matchConf[k] === 'high' ? 'ok' : 'warn') : 'miss' };
        }),
        { label:'Opera Totals', val:(apColMapping.adlArr !== -1 && apColMapping.rmsArr !== -1) ? 'Available' : 'Not found', dot:(apColMapping.adlArr !== -1 && apColMapping.rmsArr !== -1) ? 'ok' : 'warn' },
      ];
      grid.innerHTML = items.map(it =>
        `<div class="ap-scan-item"><div class="ap-scan-dot ${it.dot}"></div><span class="ap-scan-key">${it.label}:</span><span class="ap-scan-val">${it.val}</span></div>`
      ).join('');
    }
  }

  apRenderStatusBreakdown();
  apRenderColMapper(hdrs, matchConf);
  if (apDetectedCodes.length) apShowBanner();
  else { const b = document.getElementById('ap-detect-banner'); if (b) b.style.display = 'none'; }
}

// ── STATUS BREAKDOWN ──────────────────────────────────────
function apRenderStatusBreakdown() {
  const statuses = Object.keys(apStatusMap).sort();
  const sb = document.getElementById('ap-status-breakdown');
  if (!sb) return;
  if (!statuses.length) { sb.style.display = 'none'; return; }
  sb.style.display = 'block';
  const tagsEl = document.getElementById('ap-sb-tags');
  if (!tagsEl) return;
  tagsEl.innerHTML = '';
  statuses.forEach(s => {
    const tag = document.createElement('span');
    tag.className = 'ap-sb-tag ' + (apExcludedStatuses.has(s) ? 'excl' : 'incl');
    tag.innerHTML = `${s} <span style="opacity:.6;font-size:9px">(${apStatusMap[s]})</span>`;
    tag.title = (apExcludedStatuses.has(s) ? 'Click to include' : 'Click to exclude') + ' · ' + apStatusMap[s] + ' records';
    tag.onclick = () => apToggleStatus(s, tag);
    tagsEl.appendChild(tag);
  });
  apSyncExclInput();
}

function apToggleStatus(s, tag) {
  if (apExcludedStatuses.has(s)) {
    apExcludedStatuses.delete(s);
    tag.className = 'ap-sb-tag incl';
    tag.title = 'Click to exclude · ' + apStatusMap[s] + ' records';
  } else {
    apExcludedStatuses.add(s);
    tag.className = 'ap-sb-tag excl';
    tag.title = 'Click to include · ' + apStatusMap[s] + ' records';
  }
  apSyncExclInput();
}

function apSyncExclInput() {
  const el = document.getElementById('ap-excl-status');
  if (el) el.value = [...apExcludedStatuses].join(',');
}

// ── COLUMN MAPPER ─────────────────────────────────────────
function apRenderColMapper(hdrs, matchConf) {
  const mapperEl = document.getElementById('ap-col-mapper');
  if (!mapperEl) return;
  mapperEl.style.display = 'block';
  const grid = document.getElementById('ap-col-mapper-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const opts = ['(not mapped)', ...hdrs].map((h, i) =>
    `<option value="${i - 1}">${i === 0 ? '— not mapped —' : h}</option>`
  ).join('');

  AP_COL_DEFS.forEach(def => {
    const row  = document.createElement('div');
    row.className = 'ap-col-map-row';
    const idx  = apColMapping[def.key];
    const conf = matchConf[def.key];
    const matched = idx !== -1;
    const sel  = document.createElement('select');
    sel.className = 'ap-col-sel ' + (matched ? (conf === 'high' ? 'auto-matched' : 'unmatched') : '');
    sel.innerHTML = opts;
    sel.value = idx;
    sel.onchange = () => { apColMapping[def.key] = parseInt(sel.value); };
    const confBadge = matched ? `<span class="ap-col-conf ${conf}">${conf === 'high' ? 'AUTO' : 'APPROX'}</span>` : '';
    row.innerHTML = `<span class="ap-col-map-lbl ${def.required ? 'req' : ''}">${def.label}</span>`;
    row.appendChild(sel);
    if (matched) {
      const badge = document.createElement('span');
      badge.innerHTML = confBadge;
      row.appendChild(badge);
    }
    grid.appendChild(row);
  });
}

// ── DETECT BANNER ─────────────────────────────────────────
function apShowBanner() {
  const banner  = document.getElementById('ap-detect-banner');
  const codesEl = document.getElementById('ap-detect-codes');
  if (!banner || !codesEl) return;

  // Always show the banner when the report has codes
  if (!apDetectedCodes.length) { banner.style.display = 'none'; return; }
  banner.style.display = 'block';
  codesEl.innerHTML = '';

  const catLabel = { upsell: 'UP', fo: 'FO', fb: 'FB' };
  const catColor = { upsell: 'var(--amber)', fo: 'var(--mint)', fb: 'var(--sky)' };

  apDetectedCodes.forEach(code => {
    const btn = document.createElement('button');
    const cat = apGetCodeCategory(code);
    if (cat) {
      // Already assigned — show with category badge, not clickable
      btn.className = 'ap-detect-code-btn assigned';
      btn.style.cursor = 'default';
      btn.title = 'Assigned to ' + ({ upsell:'Upsell Rooms', fo:'FO F&B Upsell', fb:'With F&B Pkg' }[cat]);
      btn.innerHTML = `${code}<span style="font-size:9px;padding:1px 5px;border-radius:4px;margin-left:4px;background:${catColor[cat]}33;color:${catColor[cat]};font-weight:700;">${catLabel[cat]}</span>`;
    } else {
      // Not yet assigned — clickable
      btn.className = 'ap-detect-code-btn';
      btn.title = 'Click to assign to Upsell / FO / F&B';
      btn.innerHTML = code;
      btn.onclick = () => apPromptAssign(code, btn);
    }
    codesEl.appendChild(btn);
  });
}

function apGetCodeCategory(code) {
  if (apPkgData.upsell.includes(code)) return 'UP';
  if (apPkgData.fo.includes(code))     return 'FO';
  if (apPkgData.fb.includes(code))     return 'FB';
  return '';
}

function apUpdateDetectedAssigned() {
  // Just re-render the full banner — it shows all codes with correct assigned/unassigned state
  if (apDetectedCodes.length) apShowBanner();
}

function apPromptAssign(code, btn) {
  const existing = document.getElementById('ap-assign-popup');
  if (existing) existing.remove();
  const menu = document.createElement('div');
  menu.id = 'ap-assign-popup';
  menu.style.cssText = `position:fixed;background:var(--card2);border:1px solid var(--border2);border-radius:var(--r2);padding:6px;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,.5);font-family:var(--font);font-size:12px;min-width:160px`;
  const rect = btn.getBoundingClientRect();
  menu.style.top  = (rect.bottom + 6) + 'px';
  menu.style.left = rect.left + 'px';
  const cols  = [{ k:'upsell', label:'⬆ Upsell Rooms' }, { k:'fo', label:'💰 FO F&B Upsell' }, { k:'fb', label:'🍽 With F&B Pkg' }];
  const title = document.createElement('div');
  title.style.cssText = 'padding:4px 12px 6px;font-size:9.5px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid var(--border);margin-bottom:4px';
  title.textContent = 'Assign "' + code + '" to:';
  menu.appendChild(title);
  cols.forEach(col => {
    const opt = document.createElement('div');
    opt.innerHTML = col.label;
    opt.style.cssText = 'padding:7px 12px;cursor:pointer;border-radius:var(--r);color:var(--text2);transition:background .1s';
    opt.onmouseenter = () => { opt.style.background = 'var(--card)'; opt.style.color = 'var(--text)'; };
    opt.onmouseleave = () => { opt.style.background = ''; opt.style.color = 'var(--text2)'; };
    opt.onclick = () => {
      if (!apPkgData[col.k]) apPkgData[col.k] = [];
      if (!apPkgData[col.k].includes(code)) apPkgData[col.k].push(code);
      apRenderTags(col.k);
      apUpdateDetectedAssigned();
      apAutoSaveProfile();
      menu.remove();
    };
    menu.appendChild(opt);
  });
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 50);
}

// ── TAGS ──────────────────────────────────────────────────
function apRenderTags(col) {
  const el = document.getElementById('ap-tags-' + col);
  if (!el) return;
  el.innerHTML = '';
  (apPkgData[col] || []).forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'ap-pkg-tag';
    d.draggable = true;
    d.dataset.idx = i;
    if (col === 'fb') {
      d.innerHTML = `
        <i class="ti ti-grip-vertical ap-drag-handle"></i>
        <span class="ap-tag-name">${p}</span>
        <button class="ap-tag-rm" onclick="apRemovePkg('${col}',${i})" title="Remove">×</button>`;
    } else {
      d.innerHTML = `<i class="ti ti-grip-vertical ap-drag-handle"></i><span class="ap-tag-name">${p}</span><button class="ap-tag-rm" onclick="apRemovePkg('${col}',${i})" title="Remove">×</button>`;
    }
    d.addEventListener('dragstart', e => { apDragSrcCol = col; apDragSrcIdx = i; d.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    d.addEventListener('dragend',   () => d.classList.remove('dragging'));
    el.appendChild(d);
  });
}

function apToggleFbCount(code, btn) {
  const current = apFbCountMode[code] || 'pax';
  const next    = current === 'pax' ? 'room' : 'pax';
  apFbCountMode[code] = next;
  btn.className   = 'ap-tag-count-toggle ' + next;
  btn.textContent = next === 'pax' ? '👤 pax' : '🛏 room';
  apAutoSaveProfile();
}
function apOnDragOver(e)  { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.currentTarget.classList.add('ap-drag-over'); }
function apOnDragLeave(e) { e.currentTarget.classList.remove('ap-drag-over'); }
function apOnDrop(e, targetCol) {
  e.preventDefault();
  e.currentTarget.classList.remove('ap-drag-over');
  if (apDragSrcCol === null) return;
  const val = apPkgData[apDragSrcCol][apDragSrcIdx];
  apPkgData[apDragSrcCol].splice(apDragSrcIdx, 1);
  apRenderTags(apDragSrcCol);
  if (!apPkgData[targetCol]) apPkgData[targetCol] = [];
  if (!apPkgData[targetCol].includes(val)) apPkgData[targetCol].push(val);
  apRenderTags(targetCol);
  apDragSrcCol = null; apDragSrcIdx = null;
  apUpdateDetectedAssigned();
  apAutoSaveProfile();
}
function apRemovePkg(col, i) { apPkgData[col].splice(i, 1); apRenderTags(col); apUpdateDetectedAssigned(); apAutoSaveProfile(); }
function apAddPkg(col) {
  const inp = document.getElementById('ap-inp-' + col);
  if (!inp) return;
  const raw = inp.value.trim().toUpperCase();
  if (!raw) return;
  raw.split(',').map(s => s.trim()).filter(Boolean).forEach(p => {
    if (!apPkgData[col]) apPkgData[col] = [];
    if (!apPkgData[col].includes(p)) apPkgData[col].push(p);
  });
  inp.value = '';
  apRenderTags(col);
  apUpdateDetectedAssigned();
  apAutoSaveProfile();
}
function apKd(e, col) { if (e.key === 'Enter') { e.preventDefault(); apAddPkg(col); } }

// ── STATUS MSG ────────────────────────────────────────────
function apMsg(t, isErr) {
  const s = document.getElementById('ap-st');
  if (!s) return;
  s.textContent = t;
  s.className   = 'ap-st' + (isErr ? ' e' : t ? ' ok' : '');
}

// ── HELPERS ───────────────────────────────────────────────
function apMatchPkg(str, patterns, mode) {
  const s = str.toUpperCase();
  for (const p of patterns) {
    const pat = p.toUpperCase();
    if (mode === 'exact')  { if (s.split(/[,;\s\/|]+/).includes(pat)) return true; }
    else if (mode === 'starts') { if (s.split(/[,;\s\/|]+/).some(t => t.startsWith(pat))) return true; }
    else { if (s.includes(pat)) return true; }
  }
  return false;
}

function apBuildColMapping(hdrs) {
  const mapping = {};
  AP_COL_DEFS.forEach(def => {
    let found = -1;
    for (const alias of def.aliases) {
      const i = hdrs.findIndex(h => h.toUpperCase() === alias.toUpperCase());
      if (i !== -1) { found = i; break; }
    }
    if (found === -1) {
      for (const alias of def.aliases) {
        const i = hdrs.findIndex(h => h.toUpperCase().includes(alias.toUpperCase()));
        if (i !== -1) { found = i; break; }
      }
    }
    mapping[def.key] = found;
  });
  return mapping;
}

// ── PROCESS ───────────────────────────────────────────────
function apRun() {
  const raw = (document.getElementById('ap-raw')?.value || '').trim();
  if (!raw) { apMsg('Import or paste your report first.', true); return; }
  const lines = apRawLines.length ? apRawLines : raw.split('\n').map(l => l.trimEnd());
  if (lines.length < 2) { apMsg('Not enough data.', true); return; }

  const C = Object.keys(apColMapping).length ? apColMapping : apBuildColMapping(lines[0].split('\t').map(h => h.trim()));

  const missing = [];
  if (C.confNo    === -1) missing.push('CONFIRMATION_NO');
  if (C.status    === -1) missing.push('SHORT_RESV_STATUS');
  if (C.adults    === -1) missing.push('ADULTS');
  if (C.dateLabel === -1) missing.push('GROUPBY1_COL / ARRIVAL_DATE');
  if (missing.length) { apMsg('Missing columns: ' + missing.join(', '), true); return; }

  const useOperaTotals = C.adlArr !== -1 && C.rmsArr !== -1;
  const upsellMode  = document.getElementById('ap-mode-upsell')?.value  || 'contains';
  const foMode      = document.getElementById('ap-mode-fo')?.value      || 'contains';
  const fbMode      = document.getElementById('ap-mode-fb')?.value      || 'contains';
  const upsellCount = document.getElementById('ap-count-upsell')?.value || 'room';
  const foCount     = document.getElementById('ap-count-fo')?.value     || 'pax';
  const fbCount     = document.getElementById('ap-count-fb')?.value     || 'pax';

  // Determine best pax column: if Adl. is all zeros and Chl. is mapped, use Chl. for pax
  let paxCol = C.adults;
  if (C.chl !== undefined && C.chl !== -1 && C.adults !== -1) {
    let adlSum = 0;
    for (let i = 1; i < Math.min(lines.length, 20); i++) {
      adlSum += parseFloat((lines[i].split('\t')[C.adults] || '')) || 0;
    }
    if (adlSum === 0) paxCol = C.chl;
  }

  const manualExcl = (document.getElementById('ap-excl-status')?.value || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean);
  const exclStatus = new Set([...apExcludedStatuses, ...manualExcl]);

  const DATE_RE = /^\d{2}-\d{2}-\d{2}$/;
  const seen    = new Set();
  const dayMap  = {}, sortMap = {};

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const c        = lines[i].split('\t');
    const dateVal  = (c[C.dateLabel] || '').trim();
    if (!DATE_RE.test(dateVal)) continue;
    const status   = (c[C.status]   || '').trim().toUpperCase();
    const confNo   = (c[C.confNo]   || '').trim();
    const products = C.products !== -1 ? (c[C.products] || '').trim() : '';

    // ── Pax resolution: ADULTS → PERSONS → CF_ADULTS → RoomCategory → 1 ──────
    // Opera sometimes leaves ADULTS blank when a row is truncated due to embedded
    // newlines in address fields (e.g. LARI room 0511 — TWC category, FLRB1 rate).
    // apJoinSplitRows() re-assembles split rows so ADULTS is usually recovered,
    // but as a belt-and-braces fallback we also infer pax from the room category:
    //   TWC / DBL / TWN / DLX / STD2 / SUP / KING = 2 pax
    //   SNG / SGL / STD1 / ECO = 1 pax
    const adultRaw   = parseFloat(c[paxCol]);
    const personsRaw = C.persons  !== -1 ? parseFloat(c[C.persons])  : NaN;
    const chlRaw     = C.chl      !== -1 ? parseFloat(c[C.chl])      : NaN;
    // Room-category fallback: infer pax from category label
    let catPax = NaN;
    if (C.roomCat !== undefined && C.roomCat !== -1) {
      const cat = (c[C.roomCat] || '').trim().toUpperCase();
      if (/^(TWC|DBL|TWN|DLX|SUITE|STD2|SUP|KING|QUEEN|DOUBLE|TWIN)/.test(cat)) catPax = 2;
      else if (/^(SNG|SGL|STD1|ECO|SINGLE|SOLO)/.test(cat))                       catPax = 1;
    }
    const adults     = (adultRaw   > 0) ? adultRaw
                     : (personsRaw > 0) ? personsRaw
                     : (chlRaw     > 0) ? chlRaw
                     : (catPax     > 0) ? catPax   // room-category inference
                     : 1; // last resort: at least 1 pax per booking

    // ── Dedup key: ROWNUM is Opera's unique row identifier per reservation ──
    // Each booking appears multiple times (one row per membership programme).
    // ROWNUM is identical across these duplicates → perfect dedup key.
    // Fall back to confNo when ROWNUM column is absent.
    const rownum     = (C.rownum !== undefined && C.rownum !== -1) ? (c[C.rownum] || '').trim() : '';
    const dedupId    = rownum || confNo;   // prefer ROWNUM, fall back to confNo

    const sortVal  = C.dateSort !== -1 ? (c[C.dateSort] || dateVal).trim() : dateVal;

    if (!(dateVal in dayMap)) {
      let rms = 0, adl = 0;
      if (useOperaTotals) { adl = parseFloat(c[C.adlArr]) || 0; rms = parseFloat(c[C.rmsArr]) || 0; }
      dayMap[dateVal]  = { rms, adl, upsell:0, fo:0, fbWith:0, rmsSum:0, adlSum:0 };
      sortMap[dateVal] = sortVal;
    }

    if (!useOperaTotals && !exclStatus.has(status) && dedupId && !seen.has('rms|' + dateVal + '|' + dedupId)) {
      seen.add('rms|' + dateVal + '|' + dedupId);
      dayMap[dateVal].rmsSum += 1;
      dayMap[dateVal].adlSum += adults;
    }

    if (!dedupId) continue;
    const d = dayMap[dateVal];

    // ── F&B package counting ──────────────────────────────────────────────
    // Dedup by ROWNUM+token so each physical room is counted once.
    // Count mode: global fbCount dropdown is the single source of truth —
    //   'pax'  → add the actual number of adults in this room (correct for "With F&B Pkg" pax column)
    //   'room' → add 1 per room regardless of occupancy
    if (apPkgData.fb.length) {
      const tokens = products.toUpperCase().split(/[,;\s\/|]+/).map(t => t.trim()).filter(Boolean);
      tokens.forEach(token => {
        const tokenKey = 'fb|' + dateVal + '|' + dedupId + '|' + token;
        if (seen.has(tokenKey)) return;
        const hit = apPkgData.fb.some(p => {
          const pat = p.toUpperCase();
          if (fbMode === 'exact')       return token === pat;
          if (fbMode === 'starts')      return token.startsWith(pat);
          return token === pat || token.startsWith(pat);
        });
        if (hit) {
          seen.add(tokenKey);
          // Use global fbCount dropdown — 'pax' counts actual adults, 'room' counts 1 per room
          d.fbWith += (fbCount === 'room' ? 1 : adults);
        }
      });
    }

    if (exclStatus.has(status)) continue;

    const upsellPkgKey = 'upsell|' + dateVal + '|' + dedupId;
    if (apPkgData.upsell.length && apMatchPkg(products, apPkgData.upsell, upsellMode) && !seen.has(upsellPkgKey)) {
      seen.add(upsellPkgKey);
      d.upsell += (upsellCount === 'pax' ? adults : 1);
    }

    const foPkgKey = 'fo|' + dateVal + '|' + dedupId;
    if (apPkgData.fo.length && apMatchPkg(products, apPkgData.fo, foMode) && !seen.has(foPkgKey)) {
      seen.add(foPkgKey);
      d.fo += (foCount === 'pax' ? adults : 1);
    }
  }

  if (!useOperaTotals) Object.values(dayMap).forEach(d => { d.rms = d.rmsSum; d.adl = d.adlSum; });
  Object.values(dayMap).forEach(d => { d.fbWithout = Math.max(0, d.adl - d.fbWith); });

  apDays   = Object.entries(dayMap).sort((a, b) => (sortMap[a[0]] || a[0]).localeCompare(sortMap[b[0]] || b[0]));
  apSelIdx = null; apSortCol = 'date'; apSortDir = 'asc';

  if (!apDays.length) { apMsg('No arrivals found — check excluded statuses or column mapping.', true); return; }

  apRenderCards();
  apRenderTable();
  const out = document.getElementById('ap-out');
  if (out) out.style.display = 'block';
  const exclList = [...exclStatus];
  apMsg('Processed ' + apDays.length + ' days · ' + (useOperaTotals ? 'Opera totals' : 'row-sum') + (exclList.length ? ' · excl: ' + exclList.join(',') : ''), false);
  if (typeof logActivity === 'function') logActivity('arrivals_proc_run', `Processed ${apDays.length} days`);
}

// ── SORT ──────────────────────────────────────────────────
function apSortBy(col) {
  if (apSortCol === col) apSortDir = apSortDir === 'asc' ? 'desc' : 'asc';
  else { apSortCol = col; apSortDir = 'asc'; }
  const keyMap = { date:null, rms:'rms', upsell:'upsell', adl:'adl', fbWith:'fbWith', fbWithout:'fbWithout', fo:'fo' };
  apDays.sort((a, b) => {
    let va, vb;
    if (col === 'date') { va = a[0]; vb = b[0]; }
    else { va = a[1][keyMap[col]]; vb = b[1][keyMap[col]]; }
    return (va < vb ? -1 : va > vb ? 1 : 0) * (apSortDir === 'asc' ? 1 : -1);
  });
  document.querySelectorAll('#ap-thead-row th').forEach((th, i) => {
    th.classList.remove('sort-asc','sort-desc');
    const cols = ['date','rms','upsell','adl','fbWith','fbWithout','fo'];
    if (cols[i] === col) th.classList.add(apSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  });
  apRenderTable();
}

// ── RENDER ────────────────────────────────────────────────
const AP_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function apFmtDate(d) {
  const [dd, mm] = d.split('-');
  return parseInt(dd) + ' ' + (AP_MONTHS[parseInt(mm) - 1] || mm);
}

function apRenderCards() {
  let tR = 0, tA = 0, tU = 0, tF = 0, tFB = 0;
  apDays.forEach(([, d]) => { tR += d.rms; tA += d.adl; tU += d.upsell; tF += d.fo; tFB += d.fbWith; });
  const upsellPct = tR > 0 ? Math.round(tU / tR * 100) : 0;
  const fbPct     = tA > 0 ? Math.round(tFB / tA * 100) : 0;
  const cardsEl   = document.getElementById('ap-cards');
  if (!cardsEl) return;
  cardsEl.innerHTML = [
    { v:Math.round(tR),      l:'Total Rooms',   h:false },
    { v:Math.round(tA),      l:'Total Pax',     h:false },
    { v:Math.round(tU),      l:'Upsell Rooms',  h:false },
    { v:upsellPct + '%',     l:'Upsell Rate',   h:true  },
    { v:Math.round(tF),      l:'FO F&B Upsell', h:false },
    { v:fbPct + '%',         l:'F&B Pkg Rate',  h:true  },
    { v:apDays.length,       l:'Days in Report',h:false },
  ].map(c => `<div class="ap-stat-card${c.h ? ' highlight' : ''}"><div class="ap-stat-v">${c.v}</div><div class="ap-stat-l">${c.l}</div></div>`).join('');
}

function apRenderTable() {
  const tb = document.getElementById('ap-tbody');
  if (!tb) return;

  tb.innerHTML = '';
  apDays.forEach(([date, d], i) => {
    const tr = document.createElement('tr');
    tr.dataset.idx = i;
    tr.style.cursor = 'pointer';
    if (i === apSelIdx) {
      tr.classList.add('ap-sel');
      tr.style.background = 'var(--card2)';
      tr.style.borderLeft = '2px solid var(--accent)';
    }
    tr.innerHTML = `<td>${apFmtDate(date)}</td><td>${Math.round(d.rms)}</td><td>${Math.round(d.upsell)}</td><td>${Math.round(d.adl)}</td><td>${Math.round(d.fbWith)}</td><td>${Math.round(d.fbWithout)}</td><td>${Math.round(d.fo)}</td>`;
    tr.addEventListener('click', () => {
      // Clear all rows
      tb.querySelectorAll('tr').forEach(r => {
        r.classList.remove('ap-sel');
        r.style.background = '';
        r.style.borderLeft = '';
      });
      // Select this row
      tr.classList.add('ap-sel');
      tr.style.background = 'var(--card2)';
      tr.style.borderLeft = '2px solid var(--accent)';
      apSelIdx = i;
    });
    tb.appendChild(tr);
  });
  let tR = 0, tA = 0, tU = 0, tF = 0, tFBW = 0, tFBWO = 0;
  apDays.forEach(([, d]) => { tR += d.rms; tA += d.adl; tU += d.upsell; tF += d.fo; tFBW += d.fbWith; tFBWO += d.fbWithout; });
  const tfoot = document.getElementById('ap-tfoot');
  if (tfoot) tfoot.innerHTML = `<tr><td>TOTAL</td><td>${Math.round(tR)}</td><td>${Math.round(tU)}</td><td>${Math.round(tA)}</td><td>${Math.round(tFBW)}</td><td>${Math.round(tFBWO)}</td><td>${Math.round(tF)}</td></tr>`;
}

// ── COPY ──────────────────────────────────────────────────
function apToTsv(date, d) {
  return [parseInt(date.split('-')[0]), Math.round(d.rms), Math.round(d.upsell), Math.round(d.adl), Math.round(d.fbWith), Math.round(d.fbWithout), Math.round(d.fo)].join('\t');
}
function apCopyAll() {
  if (!apDays.length) return;
  navigator.clipboard.writeText(apDays.map(([dt, d]) => apToTsv(dt, d)).join('\n'))
    .then(() => { apMsg('All rows copied — paste into Excel.', false); showToast('All rows copied ✓','ok'); });
}
function apCopySel() {
  if (apSelIdx === null) { apMsg('Click a row first.', true); return; }
  const [dt, d] = apDays[apSelIdx];
  navigator.clipboard.writeText(apToTsv(dt, d))
    .then(() => { apMsg('Row copied!', false); showToast('Row copied ✓','ok'); });
}

// ── EXCEL EXPORT ──────────────────────────────────────────
function apExportExcel() {
  if (!apDays.length) return;
  const headers = ['Date','Arrival Rooms','Upsell Rooms','Arrival Pax','With F&B Pkg','Without F&B Pkg','FO F&B Upsell'];
  const rows = apDays.map(([date, d]) => [
    apFmtDate(date),
    Math.round(d.rms), Math.round(d.upsell), Math.round(d.adl),
    Math.round(d.fbWith), Math.round(d.fbWithout), Math.round(d.fo)
  ]);
  let tR = 0, tA = 0, tU = 0, tF = 0, tFBW = 0, tFBWO = 0;
  apDays.forEach(([, d]) => { tR += d.rms; tA += d.adl; tU += d.upsell; tF += d.fo; tFBW += d.fbWith; tFBWO += d.fbWithout; });
  rows.push(['TOTAL', Math.round(tR), Math.round(tU), Math.round(tA), Math.round(tFBW), Math.round(tFBWO), Math.round(tF)]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Arrivals');
  ws['!cols'] = [14, 14, 14, 12, 14, 16, 14].map(w => ({ wch: w }));
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `arrivals_report_${date}.xlsx`);
  apMsg('Excel file downloaded.', false);
  showToast('Excel exported ✓','ok');
  if (typeof logActivity === 'function') logActivity('arrivals_proc_export', 'Excel exported');
}

// ── PROFILE SAVE / LOAD ───────────────────────────────────
function apSaveProfile() {
  const p = {
    pkgData:      { upsell:[...apPkgData.upsell], fo:[...apPkgData.fo], fb:[...apPkgData.fb] },
    upsellMode:   document.getElementById('ap-mode-upsell')?.value,
    foMode:       document.getElementById('ap-mode-fo')?.value,
    fbMode:       document.getElementById('ap-mode-fb')?.value,
    upsellCount:  document.getElementById('ap-count-upsell')?.value,
    foCount:      document.getElementById('ap-count-fo')?.value,
    fbCount:      document.getElementById('ap-count-fb')?.value,
    fbCountMode:  apFbCountMode,
    exclStatus:   document.getElementById('ap-excl-status')?.value,
  };
  try { localStorage.setItem('ibis_arrivals_proc_profile', JSON.stringify(p)); } catch(e) {}
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(p, null, 2)], { type:'application/json' }));
  a.download = 'arrivals_profile.json';
  a.click();
  apMsg('Profile saved.', false);
  showToast('Profile saved ✓','ok');
}

function apLoadProfile() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json';
  inp.onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      try {
        const p = JSON.parse(ev.target.result);
        if (p.pkgData) { Object.assign(apPkgData, p.pkgData); ['upsell','fo','fb'].forEach(apRenderTags); }
        if (p.upsellMode) document.getElementById('ap-mode-upsell').value = p.upsellMode;
        if (p.foMode)     document.getElementById('ap-mode-fo').value     = p.foMode;
        if (p.fbMode)     document.getElementById('ap-mode-fb').value     = p.fbMode;
        if (p.upsellCount) document.getElementById('ap-count-upsell').value = p.upsellCount;
        if (p.foCount)     document.getElementById('ap-count-fo').value     = p.foCount;
        if (p.fbCount)     document.getElementById('ap-count-fb').value     = p.fbCount;
        if (p.fbCountMode) { apFbCountMode = p.fbCountMode; apRenderTags('fb'); }
        if (p.exclStatus !== undefined) {
          document.getElementById('ap-excl-status').value = p.exclStatus;
          apExcludedStatuses = new Set(p.exclStatus.split(',').map(s => s.trim()).filter(Boolean));
        }
        apUpdateDetectedAssigned();
        apAutoSaveProfile();
        apMsg('Profile loaded: ' + f.name, false);
        showToast('Profile loaded ✓','ok');
      } catch { apMsg('Invalid profile file.', true); }
    };
    r.readAsText(f);
  };
  inp.click();
}

function apResetAll() {
  const raw = document.getElementById('ap-raw');
  if (raw) raw.value = '';
  const out = document.getElementById('ap-out');
  if (out) out.style.display = 'none';
  const tbody = document.getElementById('ap-tbody');
  if (tbody) tbody.innerHTML = '';
  const cards = document.getElementById('ap-cards');
  if (cards) cards.innerHTML = '';
  const tfoot = document.getElementById('ap-tfoot');
  if (tfoot) tfoot.innerHTML = '';
  apHideScan();
  apDays = []; apSelIdx = null; apRawLines = []; apRawHeaders = []; apColMapping = {};
  apExcludedStatuses = new Set(); apStatusMap = {};
  const excl = document.getElementById('ap-excl-status');
  if (excl) excl.value = '';
  apMsg('', false);
}

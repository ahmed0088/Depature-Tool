// ═══════════════════════════════════════════════════════════
//  file-router.js — drop a report anywhere
//  Drag any Opera / DTCM / PDF report onto the app (any page) and it
//  works out what the file is from its name and first lines, opens the
//  page that reads it and loads it there. When it can't tell, it asks
//  with a short list of the pages that take that kind of file.
//  Drop boxes that already exist on a page keep working as before:
//  this only acts on drops nobody else handled.
// ═══════════════════════════════════════════════════════════

// Every page that reads a file. sel = its <input type="file">;
// ta/run = a paste box to fill and the function that reads it.
const FR_DEST = {
  dtcm:        { label: 'DTCM Recon',                 panel: 'dtcm',          ico: '🏦', ext: /\.(xml|txt|csv|tsv)$/i, sel: '#dtcFileInput', multi: true },
  tdaOpera:    { label: 'TD Audit · Opera file',      panel: 'td-audit',      ico: '🧮', ext: /\.(txt|tsv|csv)$/i, sel: '#tdaOperaFileInput' },
  tdaDtcm:     { label: 'TD Audit · DTCM XML',        panel: 'td-audit',      ico: '🧮', ext: /\.xml$/i, sel: '#tdaDtcmFileInput' },
  nationality: { label: 'Nationality report',         panel: 'nationality',   ico: '🌍', ext: /\.(txt|tsv|csv)$/i, ta: 'natInput', run: 'processNat' },
  rent1:       { label: 'Rent report · History Forecast', panel: 'rent',      ico: '📈', ext: /\.(txt|tsv|csv)$/i, ta: 'rentInput1' },
  rent2:       { label: 'Rent report · Room Type Stats',  panel: 'rent',      ico: '📈', ext: /\.(txt|tsv|csv)$/i, ta: 'rentInput2' },
  arrivals:    { label: 'Arrivals',                   panel: 'arrivals',      ico: '🛎️', ext: /\.(xlsx|xls|csv)$/i, sel: 'input[onchange*="loadOperaFile(this,\'arr\')"]' },
  purpose:     { label: 'Purpose of Stay',            panel: 'purpose',       ico: '📋', ext: /\.(xlsx|xls|csv)$/i, sel: 'input[onchange*="loadOperaFile(this,\'pur\')"]' },
  origin:      { label: 'Purpose · Origin XML',       panel: 'purpose',       ico: '📋', ext: /\.xml$/i, sel: 'input[onchange*="loadOriginXML"]' },
  xref:        { label: 'Arrivals × Departures check', panel: 'xref',         ico: '🔀', ext: /\.(txt|tsv|csv)$/i, sel: 'input[onchange*="xrefLoadFile"]' },
  immig:       { label: 'Immigration · report XML',   panel: 'immig',         ico: '🛂', ext: /\.xml$/i, sel: '#immigFileInput2' },
  immigIn:     { label: 'Immigration · Inhouse XML',  panel: 'immig',         ico: '🛂', ext: /\.xml$/i, sel: '#immigInhouseXmlInput' },
  immigArr:    { label: 'Immigration · Arrivals export', panel: 'immig',      ico: '🛂', ext: /\.(xls|xlsx|html?|csv|txt)$/i, sel: '#immigArrivalsInput' },
  immigRes:    { label: 'Immigration · Res. Detail',  panel: 'immig',         ico: '🛂', ext: /\.(txt|tsv)$/i, sel: '#immigResDetailInput' },
  itGiby:      { label: 'In-house tally · Guest In-House by Room', panel: 'inhouse-tally', ico: '🛏️', ext: /\.(txt|tsv|csv)$/i, sel: '#itGibyFileInput' },
  itXml:       { label: 'In-house tally · Guest Count XML', panel: 'inhouse-tally', ico: '🛏️', ext: /\.xml$/i, sel: '#itXmlFileInput' },
  pkgExcel:    { label: 'Package Audit · IN-Gauge Excel', panel: 'package-audit', ico: '🎁', ext: /\.(xlsx|xls)$/i, sel: '#pkgExcelFileInput' },
  pkgPdf:      { label: 'Package Audit · change log PDF', panel: 'package-audit', ico: '🎁', ext: /\.pdf$/i, sel: '#pkgPdfFileInput', multi: true },
  pkgGuests:   { label: 'Package Audit · guest list', panel: 'package-audit', ico: '🎁', ext: /\.(txt|tsv|xls|xlsx|csv)$/i, sel: '#pkgGuestFileInput' },
  noshow:      { label: 'No-Show (NA40 PDF)',         panel: 'noshow',        ico: '🚫', ext: /\.pdf$/i, sel: '#nsPdfInput' },
  tourism:     { label: 'Tourism tax',                panel: 'tourism',       ico: '🧾', ext: /\.(txt|csv)$/i, sel: 'input[onchange*="ttLoadFile"]' },
  apRaw:       { label: 'Arrivals processing',        panel: 'arrivals-proc', ico: '📥', ext: /\.(html?|txt|tsv|csv)$/i, sel: '#ap-file-input' },
  adagio:      { label: 'Adagio',                     panel: 'adagio',        ico: '🏢', ext: /\.(xlsx|xls|csv)$/i, sel: '#adg-file-input' },
  guestmem:    { label: 'Guest memory import',        panel: 'guestmem',      ico: '🧠', ext: /\.csv$/i, sel: 'input[onchange*="gmImportFile"]' },
};

/** Look at a file and say where it goes. Returns { dest, why } or { dest: null }. */
function frDetect(name, head) {
  const n = String(name || '').toLowerCase();
  const h = String(head || '');
  const H = h.toUpperCase();
  const firstLine = (h.split(/\r?\n/)[0] || '').toUpperCase();

  // DTCM XML / Opera journals → DTCM Recon (it sorts the three kinds itself)
  if (/hoteltransaction/i.test(h) || /hoteltransaction|_dynamic/.test(n)) return { dest: 'dtcm', why: 'DTCM portal XML' };
  if (/finjrnlbytax/.test(n) || /\bTAX_TRX_CODE\b/.test(firstLine)) return { dest: 'dtcm', why: 'Opera journal by tax code (long stays)' };
  if (/finjrnlbytrans|finjrnl/.test(n) || (/\bTRX_CODE\b/.test(firstLine) && /GUEST_FULL_NAME/.test(firstLine))) return { dest: 'dtcm', why: 'Opera journal by transaction' };

  if (/stat_countrybymon|countrybymon/.test(n) || /COUNTRY/.test(firstLine) && /NATIONALITY|COUNTRY_DESC/.test(firstLine)) return { dest: 'nationality', why: 'Opera nationality statistics' };
  if (/history_forecast/.test(n) || /NO_ROOMS/.test(firstLine) && /CONSIDERED_DATE/.test(firstLine)) return { dest: 'rent1', why: 'History & Forecast' };
  if (/statroomtype/.test(n) || /STAY_ROOMS/.test(firstLine) && /ROOM_CATEGORY/.test(firstLine)) return { dest: 'rent2', why: 'Room type statistics' };
  if (/gibyroom/.test(n)) return { dest: 'itGiby', why: 'Guest In-House by Room' };

  if (/\.pdf$/.test(n)) {
    if (/na40|no.?show/.test(n)) return { dest: 'noshow', why: 'NA40 no-show PDF' };
    if (/change|package|pkg/.test(n)) return { dest: 'pkgPdf', why: 'package change log PDF' };
    return { dest: null };
  }
  if (/\.xml$/.test(n) && /immig/.test(n)) return { dest: 'immig', why: 'immigration XML' };
  if (/\.(xlsx|xls)$/.test(n) && /ingauge|in-gauge|upsell/.test(n)) return { dest: 'pkgExcel', why: 'IN-Gauge export' };
  if (/\.json$/.test(n)) return { dest: 'backup', why: 'app backup' };
  return { dest: null };
}

function _frReadHead(file) {
  return new Promise(res => {
    if (/\.(pdf|xlsx|xls|png|jpe?g|gif|webp)$/i.test(file.name)) return res('');
    const r = new FileReader();
    r.onload = e => res(String(e.target.result || ''));
    r.onerror = () => res('');
    r.readAsText(file.slice(0, 8192));
  });
}

function _frReadText(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = e => res(String(e.target.result || '')); r.onerror = rej; r.readAsText(file, 'utf-8'); });
}

/** Load files into a page: fill its file input (or paste box) the same way the user would. */
async function frSend(destKey, files) {
  const d = FR_DEST[destKey];
  if (destKey === 'backup') {
    const inp = document.querySelector('input[accept=".json"][onchange*="handleImport"]');
    if (inp) _frPutFiles(inp, files.slice(0, 1));
    return;
  }
  if (!d) return;
  showPanel(d.panel);
  if (typeof closeMobMore === 'function') try { closeMobMore(); } catch (_) {}
  if (d.ta) {
    const ta = document.getElementById(d.ta);
    if (!ta) return;
    ta.value = await _frReadText(files[0]);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    if (d.run && typeof window[d.run] === 'function') window[d.run]();
  } else {
    const inp = document.querySelector(d.sel);
    if (!inp) { showToast(`Open ${d.label} and use its upload button`, 'err'); return; }
    _frPutFiles(inp, d.multi ? files : files.slice(0, 1));
  }
  const panel = document.getElementById('panel-' + d.panel);
  if (panel) { panel.classList.remove('fr-flash'); void panel.offsetWidth; panel.classList.add('fr-flash'); }
  if (typeof logActivity === 'function') try { logActivity('file', `${files.map(f => f.name).join(', ')} → ${d.label}`); } catch (_) {}
}

function _frPutFiles(inp, files) {
  const dt = new DataTransfer();
  files.forEach(f => dt.items.add(f));
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Work out where each dropped file goes, group them, send or ask. */
async function frRoute(fileList) {
  const files = [...fileList].filter(f => !/^image\//.test(f.type));
  if (!files.length) return;
  const groups = {};
  const unknown = [];
  for (const f of files) {
    const g = frDetect(f.name, await _frReadHead(f));
    if (g.dest) (groups[g.dest] = groups[g.dest] || { why: g.why, files: [] }).files.push(f);
    else unknown.push(f);
  }
  const keys = Object.keys(groups);
  for (const k of keys) {
    await frSend(k, groups[k].files);
    const d = FR_DEST[k];
    showToast(`${groups[k].why} → ${d ? d.label : 'backup import'}`, 'ok');
  }
  for (const f of unknown) await frAsk(f);
}

/** Can't tell: show the pages that take this kind of file. */
function frAsk(file) {
  return new Promise(resolve => {
    const opts = Object.entries(FR_DEST).filter(([, d]) => d.ext.test(file.name));
    document.getElementById('frSheet')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'frSheet';
    wrap.className = 'fr-overlay';
    wrap.innerHTML = `
      <div class="fr-sheet" role="dialog" aria-label="Where should this file go?">
        <div class="fr-h">Where should this file go?</div>
        <div class="fr-file">📄 ${escapeHtml(file.name)}</div>
        ${opts.length ? `<div class="fr-list">${opts.map(([k, d]) => `<button class="fr-opt" data-k="${k}"><span>${d.ico}</span>${escapeHtml(d.label)}</button>`).join('')}</div>`
                      : `<div class="fr-none">No page in the app reads this kind of file.</div>`}
        <button class="btn fr-cancel">Cancel</button>
      </div>`;
    const close = () => { wrap.remove(); resolve(); };
    wrap.addEventListener('click', e => {
      const b = e.target.closest('.fr-opt');
      if (b) { wrap.remove(); frSend(b.dataset.k, [file]).then(resolve); return; }
      if (e.target === wrap || e.target.closest('.fr-cancel')) close();
    });
    document.body.appendChild(wrap);
  });
}

// ── drag anywhere ─────────────────────────────────────────
(function () {
  let depth = 0;
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  const hint = on => document.body.classList.toggle('fr-dragging', on);
  document.addEventListener('dragenter', e => { if (!hasFiles(e) || (typeof hoPref === 'function' && !hoPref('dropAnywhere'))) return; depth++; hint(true); });
  document.addEventListener('dragleave', e => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) hint(false); });
  document.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener('drop', e => {
    depth = 0; hint(false);
    if (!hasFiles(e)) return;
    if (e.defaultPrevented) return;   // a page's own drop box already took it
    if (typeof hoPref === 'function' && !hoPref('dropAnywhere')) return;
    e.preventDefault();               // never let the browser open the file instead
    frRoute(e.dataTransfer.files);
  });
})();

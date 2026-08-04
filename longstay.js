// ═══════════════════════════════════════════════════════════
//  longstay.js  —  Long Stay TD Check
//  Aggregates a guest's back-to-back reservations/extensions and
//  flags every night beyond the DTCM long-stay threshold (default
//  30 consecutive nights) where Opera is still charging Tourism
//  Dirham (TD) but DTCM should have stopped counting it.
//  Ibis Styles Dubai · Front Desk Ops · 2026
// ═══════════════════════════════════════════════════════════

let lsRows      = [];   // raw parsed reservation rows
let lsChains    = [];   // grouped/merged guest stay chains (after lsRun)
let lsFilter    = 'all';
let lsSearch    = '';

// ── Date parsing — supports the common Opera export formats ──
function _lsParseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const MONTHS = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};

  // 04-Aug-2026 / 04-Aug-26
  let m = s.match(/^(\d{1,2})[\/\-]([A-Za-z]{3,})[\/\-](\d{2,4})$/);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase().slice(0,3)];
    if (mo !== undefined) {
      let yr = +m[3]; if (yr < 100) yr += 2000;
      const d = new Date(yr, mo, +m[1]);
      if (!isNaN(d)) return d;
    }
  }
  // 2026-08-04 (ISO)
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) { const d = new Date(+m[1], +m[2]-1, +m[3]); if (!isNaN(d)) return d; }

  // 04/08/2026 or 04-08-2026 — Opera Dubai exports are day/month/year
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let yr = +m[3]; if (yr < 100) yr += 2000;
    const day = +m[1], mon = +m[2];
    if (mon <= 12) { const d = new Date(yr, mon-1, day); if (!isNaN(d)) return d; }
  }

  // Fallback to native parser (handles "Aug 4 2026" etc.)
  const d = new Date(s);
  if (!isNaN(d)) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return null;
}

function _lsNightsBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

function _lsFmtDate(d) {
  if (!d) return '—';
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()} ${mo[d.getMonth()]} ${d.getFullYear()}`;
}

// Normalise a guest name for grouping: strip titles, collapse spaces/case.
function _lsNormName(name) {
  if (!name) return '';
  return String(name)
    .replace(/\b(MR|MRS|MS|MISS|DR|MSTR|MASTER)\b\.?/gi, '')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function _lsEsc(s) {
  return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '';
}

// ── Column detection — flexible header matching so different
// Opera export layouts (Reservation History / Confirmed Res / Stay History) all work.
function _lsFindCol(hdrs, candidates) {
  for (const c of candidates) {
    const i = hdrs.findIndex(h => h === c);
    if (i >= 0) return i;
  }
  for (const c of candidates) {
    const i = hdrs.findIndex(h => h.includes(c));
    if (i >= 0) return i;
  }
  return -1;
}

function _lsParseText(raw) {
  const lines = raw.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim());
  if (lines.length < 2) return { rows: [], error: 'Could not find any data rows — check the pasted export.' };

  const delim = lines[0].includes('\t') ? '\t' : ',';
  const hdrs  = lines[0].split(delim).map(h => h.trim().toUpperCase());

  const nameIdx = _lsFindCol(hdrs, ['GUEST NAME','NAME','FULL_NAME','GUEST']);
  const roomIdx = _lsFindCol(hdrs, ['ROOM','ROOM NO','ROOM_NO','RM']);
  const confIdx = _lsFindCol(hdrs, ['CONFIRMATION','CONF NO','CONF_NO','CONFIRMATION NO','RES NO','RESERVATION NO']);
  const arrIdx  = _lsFindCol(hdrs, ['ARRIVAL DATE','ARRIVAL','ARR DATE','CHECK-IN','CHECKIN','CHECK IN']);
  const depIdx  = _lsFindCol(hdrs, ['DEPARTURE DATE','DEPARTURE','DEP DATE','CHECK-OUT','CHECKOUT','CHECK OUT']);

  if (nameIdx < 0) return { rows: [], error: 'Could not find a Guest Name column in this export.' };
  if (arrIdx < 0 || depIdx < 0) return { rows: [], error: 'Could not find Arrival / Departure date columns in this export.' };

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delim);
    const name = (cols[nameIdx] || '').trim();
    if (!name) continue;
    const arrival   = _lsParseDate(cols[arrIdx]);
    const departure = _lsParseDate(cols[depIdx]);
    if (!arrival || !departure) continue;
    if (departure <= arrival) continue; // bad row, skip

    rows.push({
      name, key: _lsNormName(name),
      room: roomIdx >= 0 ? (cols[roomIdx] || '').trim() : '',
      conf: confIdx >= 0 ? (cols[confIdx] || '').trim() : '',
      arrival, departure,
      nights: _lsNightsBetween(arrival, departure),
    });
  }
  return { rows, error: rows.length ? null : 'No usable rows with valid dates were found.' };
}

// ── Main entry: parse textarea / pasted content ──
function lsLoad() {
  const raw = document.getElementById('lsInput').value;
  const errBox = document.getElementById('lsError');
  const errMsg = document.getElementById('lsErrorMsg');
  errBox.classList.remove('show');

  if (!raw || !raw.trim()) {
    errMsg.textContent = 'Paste or upload a report first.';
    errBox.classList.add('show');
    return;
  }
  const { rows, error } = _lsParseText(raw);
  if (error) {
    errMsg.textContent = error;
    errBox.classList.add('show');
    return;
  }
  lsRows = rows;
  showToast(`✦ Loaded ${rows.length} reservation rows`, 'ok');
  lsRun();
}

function lsLoadFile(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('lsInput').value = e.target.result;
    lsLoad();
  };
  reader.readAsText(file, 'utf-8');
}

// ── Build guest stay chains: merge back-to-back reservations for
// the same guest, then flag every night beyond the threshold. ──
function lsBuildChains() {
  const thresholdEl = document.getElementById('lsThreshold');
  const toleranceEl = document.getElementById('lsTolerance');
  const rateEl       = document.getElementById('lsRate');
  const threshold = Math.max(1, parseInt(thresholdEl?.value, 10) || 30);
  const tolerance = Math.max(0, parseInt(toleranceEl?.value, 10) || 1);
  const rate      = Math.max(0, parseFloat(rateEl?.value) || 15);

  // Group by normalised guest name
  const byGuest = {};
  lsRows.forEach(r => { (byGuest[r.key] = byGuest[r.key] || []).push(r); });

  const chains = [];
  Object.values(byGuest).forEach(stays => {
    stays.sort((a,b) => a.arrival - b.arrival);

    let cur = null;
    stays.forEach(s => {
      if (cur && _lsNightsBetween(cur.end, s.arrival) <= tolerance) {
        // Extend the current chain
        cur.end = s.departure > cur.end ? s.departure : cur.end;
        cur.reservations.push(s);
        cur.rooms.add(s.room);
      } else {
        if (cur) chains.push(cur);
        cur = {
          name: stays[0].name,
          key:  stays[0].key,
          start: s.arrival,
          end:   s.departure,
          reservations: [s],
          rooms: new Set([s.room]),
        };
      }
    });
    if (cur) chains.push(cur);
  });

  chains.forEach(c => {
    c.totalNights  = _lsNightsBetween(c.start, c.end);
    c.excessNights = Math.max(0, c.totalNights - threshold);
    c.overcharge   = Math.round(c.excessNights * rate);
    c.roomsList    = Array.from(c.rooms).filter(Boolean).join(', ') || '—';
    c.confList     = c.reservations.map(r => r.conf).filter(Boolean).join(', ') || '—';
  });

  chains.sort((a,b) => b.excessNights - a.excessNights || b.totalNights - a.totalNights);
  return chains;
}

function lsRun() {
  if (!lsRows.length) return;
  lsChains = lsBuildChains();
  document.getElementById('lsPasteCard').style.display  = 'none';
  document.getElementById('lsResultCard').style.display = 'block';
  document.getElementById('lsHeaderActions').style.display = 'flex';
  lsRenderKpis();
  lsRender();
}

function lsRenderKpis() {
  const totalGuests   = lsChains.length;
  const flagged       = lsChains.filter(c => c.excessNights > 0);
  const excessNights  = flagged.reduce((s,c) => s + c.excessNights, 0);
  const overcharge    = flagged.reduce((s,c) => s + c.overcharge, 0);

  document.getElementById('lsKpis').innerHTML = `
    <div class="kpi sky">
      <div class="kpi-accent"></div>
      <div class="kpi-label">Guests Scanned</div>
      <div class="kpi-val">${totalGuests}</div>
      <div class="kpi-sub">${lsRows.length} reservation rows</div>
    </div>
    <div class="kpi rose">
      <div class="kpi-accent"></div>
      <div class="kpi-label">Long-Stay Guests</div>
      <div class="kpi-val">${flagged.length}</div>
      <div class="kpi-sub">crossed the threshold</div>
    </div>
    <div class="kpi amber">
      <div class="kpi-accent"></div>
      <div class="kpi-label">Excess TD Nights</div>
      <div class="kpi-val">${excessNights}</div>
      <div class="kpi-sub">still charged past night 30</div>
    </div>
    <div class="kpi gold">
      <div class="kpi-accent"></div>
      <div class="kpi-label">Est. Overcharge</div>
      <div class="kpi-val">${overcharge.toLocaleString()}</div>
      <div class="kpi-sub">AED, at current rate</div>
    </div>`;

  const badge = document.getElementById('badge-longstay');
  if (badge) badge.textContent = flagged.length ? String(flagged.length) : '0';
}

function lsSetFilter(f, btn) {
  lsFilter = f;
  document.querySelectorAll('#lsFilters .fchip').forEach(b => b.classList.remove('on'));
  if (btn) btn.classList.add('on');
  lsRender();
}

function lsRender() {
  const q = lsSearch.trim().toUpperCase();
  let list = lsChains.slice();

  if (lsFilter === 'excess') list = list.filter(c => c.excessNights > 0);
  if (lsFilter === 'ok')     list = list.filter(c => c.excessNights === 0);
  if (q) list = list.filter(c => c.name.toUpperCase().includes(q) || c.roomsList.toUpperCase().includes(q));

  document.getElementById('lsfc-all').textContent    = lsChains.length;
  document.getElementById('lsfc-excess').textContent = lsChains.filter(c => c.excessNights > 0).length;
  document.getElementById('lsfc-ok').textContent     = lsChains.filter(c => c.excessNights === 0).length;

  const tbody = document.getElementById('lsTable');
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:24px;">No guests match this view.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(c => `
    <tr>
      <td>${_lsEsc(c.name)}</td>
      <td style="font-family:var(--mono);font-size:0.75rem;">${_lsEsc(c.roomsList)}</td>
      <td style="font-family:var(--mono);font-size:0.7rem;color:var(--text3);">${c.reservations.length} res · ${_lsEsc(c.confList)}</td>
      <td style="font-family:var(--mono);font-size:0.75rem;">${_lsFmtDate(c.start)} → ${_lsFmtDate(c.end)}</td>
      <td style="font-family:var(--mono);text-align:center;">${c.totalNights}</td>
      <td style="font-family:var(--mono);text-align:center;${c.excessNights ? 'color:var(--rose);font-weight:700;' : 'color:var(--text3);'}">${c.excessNights || '—'}</td>
      <td>${c.excessNights > 0
          ? `<span class="fchip on" style="cursor:default;color:var(--rose);border-color:rgba(240,107,122,0.4);background:rgba(240,107,122,0.1);">⚠ Stop TD after night ${document.getElementById('lsThreshold')?.value || 30}</span>`
          : `<span class="fchip on" style="cursor:default;">✅ Under threshold</span>`}</td>
    </tr>`).join('');
}

function lsSetSearch(v) { lsSearch = v; lsRender(); }

function lsCopyFlagged() {
  const flagged = lsChains.filter(c => c.excessNights > 0);
  if (!flagged.length) { showToast('No long-stay guests to copy.', 'err'); return; }
  const text = flagged.map(c =>
    `${c.name}\tRoom ${c.roomsList}\t${_lsFmtDate(c.start)} → ${_lsFmtDate(c.end)}\t${c.totalNights} nights\t${c.excessNights} excess TD nights\tAED ${c.overcharge}\tConf: ${c.confList}`
  ).join('\n');
  copyToClipboard(text, document.getElementById('lsCopyBtn'), '📋 Copy List');
}

function lsClear() {
  lsRows = []; lsChains = []; lsFilter = 'all'; lsSearch = '';
  document.getElementById('lsInput').value = '';
  document.getElementById('lsPasteCard').style.display  = 'block';
  document.getElementById('lsResultCard').style.display = 'none';
  document.getElementById('lsHeaderActions').style.display = 'none';
  document.getElementById('lsError').classList.remove('show');
  const fi = document.getElementById('lsFileInput'); if (fi) fi.value = '';
  const badge = document.getElementById('badge-longstay'); if (badge) badge.textContent = '0';
}

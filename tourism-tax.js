// ═══════════════════════════════════════════════════════════
//  tourism-tax.js  —  Tourism Tax · TD Portal Date Fix
//
//  Finds guests where Opera's arrival time has a * prefix.
//  The * means they physically checked in on the next calendar
//  day after their booking date — so the TD portal has the
//  wrong arrival date and needs to be corrected manually.
//
//  That's it. No time filtering. Just the * guests.
// ═══════════════════════════════════════════════════════════

let ttGuests  = [];
let ttFilter_ = 'all'; // 'all' | 'needsFix'
let ttDateStr = '';
let ttRawText = '';

// ── Column index resolver ─────────────────────────────────
function ttColIdx(hdrs, ...needles) {
  for (const needle of needles) {
    // exact match first
    const exact = hdrs.findIndex(h => h === needle);
    if (exact >= 0) return exact;
  }
  for (const needle of needles) {
    // fallback: includes (for partial column names)
    const idx = hdrs.findIndex(h => h.includes(needle));
    if (idx >= 0) return idx;
  }
  return -1;
}

// ── Parse Opera tab-delimited arrivals report ─────────────
function ttParseReport(raw) {
  const lines = raw.split('\n').map(l => l.trimEnd()).filter(l => l.trim());
  if (lines.length < 2) return [];

  const hdrs = lines[0].split('\t').map(h => h.trim().toUpperCase());

  const iRoom = ttColIdx(hdrs, 'DISP_ROOM_NO', 'ROOM_NO', 'ROOM');
  const iName = ttColIdx(hdrs, 'FULL_NAME_NO_SHR_IND', 'FULL_NAME', 'NAME');
  // ARRIVAL_TIME (not ARRIVAL_TIME1) is the column Opera marks with * for next-day check-ins
  const iArrTime = ttColIdx(hdrs, 'ARRIVAL_TIME', 'ARRIVAL_TIME1', 'ARRIVALTIME');
  const iConf = ttColIdx(hdrs, 'CONFIRMATION_NO', 'CONFIRM');
  const iArr  = ttColIdx(hdrs, 'ARRIVAL', 'TRUNC_BEGIN', 'BEGIN_DATE');
  const iDep  = ttColIdx(hdrs, 'DEPARTURE', 'TRUNC_END');
  const iNights = ttColIdx(hdrs, 'NO_OF_NIGHTS', 'NIGHTS');
  const iAdults = ttColIdx(hdrs, 'ADULTS');
  const iStatus = ttColIdx(hdrs, 'SHORT_RESV_STATUS');

  if (iRoom < 0 || iName < 0) return null;

  const seen   = new Set();
  const guests = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    if (cols.length < 5) continue;

    const room    = (cols[iRoom]    || '').trim();
    const rawName = (cols[iName]    || '').trim();
    const rawTime = (cols[iArrTime] || '').trim();
    const conf    = (cols[iConf]    || '').trim();
    const arrDate = (cols[iArr]     || '').trim();
    const depDate = (cols[iDep]     || '').trim();
    const nights  = parseInt(cols[iNights] || '1') || 1;
    const adults  = parseInt(cols[iAdults] || '1') || 1;
    const status  = (cols[iStatus]  || '').trim().toUpperCase();

    if (!room || !rawName) continue;
    if (status === 'GCC') continue;

    const dedupeKey = `${room}|${conf || rawName}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    // * prefix = Opera's own marker that the guest checked in
    // on the next calendar day after their booking date.
    const needsFix  = rawTime.startsWith('*');
    const cleanTime = rawTime.replace(/^\*/, '').trim();

    // Only keep guests that need fixing — skip everyone else
    if (!needsFix) continue;

    // Calculate the correct TD portal date (booking date + 1)
    const opDate = parseOperaDate(arrDate);
    let tdDate = '';
    if (opDate) {
      const next = new Date(opDate);
      next.setDate(next.getDate() + 1);
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      tdDate = `${String(next.getDate()).padStart(2,'0')}-${months[next.getMonth()]}-${next.getFullYear()}`;
    }

    guests.push({
      room,
      name:     parseName(rawName),
      conf,
      arrDate,
      depDate,
      nights,
      adults,
      arrTime:  cleanTime || '—',
      tdDate,
    });
  }

  return guests;
}

// ── Load / parse ──────────────────────────────────────────
function ttLoad() {
  const raw = (document.getElementById('ttInput')?.value || '').trim();
  if (!raw) { showToast('Paste the Opera arrivals report first', 'err'); return; }

  ttRawText = raw;
  const result = ttParseReport(raw);

  if (result === null) {
    showToast('Could not find Room/Name columns — check the report format', 'err');
    return;
  }

  ttGuests = result;

  // Extract report date from the data itself (first guest's arrival date) rather than
  // a fragile regex on raw text — Opera date formats: DD-MMM-YYYY or DD/MM/YYYY
  let ttDateStr = '';
  if (ttGuests.length && ttGuests[0].arrDate) {
    ttDateStr = ttGuests[0].arrDate;
  } else {
    // Fallback: scan raw text for a recognisable Opera date (DD-Mon-YYYY preferred)
    const m = ttRawText.match(/\d{2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{4}/i)
           || ttRawText.match(/\d{2}[-\/]\d{2}[-\/]\d{4}/);
    ttDateStr = m ? m[0] : new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
  }

  document.getElementById('ttPasteCard').style.display     = 'none';
  document.getElementById('ttResultCard').style.display    = 'block';
  document.getElementById('ttHeaderActions').style.display = '';

  ttRender();
  ttUpdateKpi();

  const msg = ttGuests.length
    ? `${ttGuests.length} room${ttGuests.length !== 1 ? 's' : ''} need TD portal correction ✓`
    : 'No next-day check-ins found — nothing to correct ✓';
  showToast(msg, ttGuests.length ? 'err' : 'ok');
}

// ── File upload support ───────────────────────────────────
function ttLoadFile(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const ta = document.getElementById('ttInput');
    if (ta) ta.value = e.target.result;
    ttLoad();
  };
  reader.readAsText(file, 'utf-8');
}

// ── KPI bar ───────────────────────────────────────────────
function ttUpdateKpi() {
  const count = ttGuests.length;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('tt-kpi-after12', count);

  const badge = document.getElementById('badge-tourism');
  if (badge) badge.textContent = count || '0';

  const lbl = document.getElementById('ttDateLabel');
  if (lbl) lbl.textContent = count
    ? `${count} room${count !== 1 ? 's' : ''} need TD portal date correction`
    : 'No corrections needed';
}

// ── Render table ──────────────────────────────────────────
function ttRender() {
  const search = (document.getElementById('ttSearch')?.value || '').toLowerCase();

  const rows = ttGuests.filter(g => {
    if (search && ![g.room, g.name, g.conf].join(' ').toLowerCase().includes(search)) return false;
    return true;
  });

  const tbody = document.getElementById('ttTable');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:36px;font-family:var(--mono);font-size:0.7rem;color:var(--text3);">No rooms to correct.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(g => `
    <tr class="tt-row-midnight">
      <td><span class="tt-room-pill">${g.room}</span></td>
      <td style="font-weight:500;color:var(--text);">${g.name}</td>
      <td style="font-family:var(--mono);font-size:0.72rem;color:var(--text2);">${g.conf || '—'}</td>
      <td style="font-family:var(--mono);font-size:0.72rem;color:var(--amber);font-weight:600;">*${g.arrTime}</td>
      <td style="font-family:var(--mono);font-size:0.72rem;color:var(--text2);">${g.arrDate} <span style="color:var(--text3);font-size:0.62rem;">(Opera)</span></td>
      <td style="font-family:var(--mono);font-size:0.72rem;font-weight:600;color:var(--rose);">${g.tdDate || '—'} <span style="color:var(--text3);font-size:0.62rem;">← TD Portal</span></td>
      <td><span class="tt-action-fix">⚠ Change date in TD Portal</span></td>
    </tr>`).join('');
}

// ── Copy list ─────────────────────────────────────────────
function ttCopyLate() {
  if (!ttGuests.length) { showToast('No rooms to copy', 'info'); return; }
  const lines = [
    `Tourism Tax — TD Portal Date Corrections Required`,
    `${'─'.repeat(65)}`,
    `Room    Arr Time  Opera Date    TD Portal Date  Name                    Conf`,
    `${'─'.repeat(65)}`,
    ...ttGuests.map(g =>
      `${g.room.padEnd(8)}${('*'+g.arrTime).padEnd(10)}${g.arrDate.padEnd(14)}${(g.tdDate || '—').padEnd(16)}${g.name.padEnd(24)}${g.conf}`
    ),
    `${'─'.repeat(65)}`,
    `Total: ${ttGuests.length} room${ttGuests.length !== 1 ? 's' : ''} to correct`,
  ];
  copyToClipboard(lines.join('\n'), null, '');
  showToast(`${ttGuests.length} rooms copied ✓`, 'ok');
}

// ── Clear / reset ─────────────────────────────────────────
function ttClear() {
  ttGuests  = [];
  ttFilter_ = 'all';
  ttRawText = '';
  document.getElementById('ttPasteCard').style.display  = 'block';
  document.getElementById('ttResultCard').style.display = 'none';
  const ta = document.getElementById('ttInput');
  if (ta) ta.value = '';
  const badge = document.getElementById('badge-tourism');
  if (badge) badge.textContent = '0';
  const ha = document.getElementById('ttHeaderActions');
  if (ha) ha.style.display = 'none';
}

// stub — kept so any HTML buttons referencing it don't throw
function ttSetCutoff() {}
function ttFilter(f, el) {
  document.querySelectorAll('[data-ttf]').forEach(b => b.classList.remove('on'));
  if (el) el.classList.add('on');
  ttRender();
}

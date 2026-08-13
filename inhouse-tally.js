// ═══════════════════════════════════════════════════════════
//  inhouse-tally.js  —  Inhouse Tally (Opera vs Immigration XML)
//
//  Reconciles two same-night reports:
//   1) A room-by-room occupancy list from Opera. Three formats accepted,
//      auto-detected:
//        · "Guest In-House By Room" (gibyroom) — tab-delimited,
//          ROOM + ADULTS/CHILDREN + FULL_NAME columns.
//        · "wa21" reservations export — comma-delimited quoted CSV,
//          Room + Adults/Children + Name columns.
//        · "Reservation Detail" (res_detail) export — tab-delimited,
//          one row per reservation but sometimes MULTIPLE rows per
//          reservation (one per ID/membership record on file) — those
//          are deduped by CONFIRMATION_NO before summing pax, otherwise
//          a guest with 2 ID records on file would silently double-count.
//          Uses ROOM_NO (not DISP_ROOM_NO, which is usually blank pre
//          check-in and would otherwise win the column match by being
//          listed first in the export).
//   2) A guest registration XML. Two formats accepted, auto-detected:
//        · Inhouse / Guest Count XML — Crystal Report export, one
//          <Details Level="2"> block per registered person, tagged
//          with PrimaryEscortFlag: P = Primary guest, E = Escort
//          (sharing/accompanying), V = Visitor — NOT an overnight
//          guest, excluded from the headcount. Older exports have no
//          flag at all — every record is then treated as a guest.
//        · VICAS "Transaction Report — Check In" XML — <Details
//          Level="1"> blocks, one row per check-in/escort EVENT
//          (FullName1 + Process1: "Check-in" = primary guest,
//          "Add-Escort" = companion). A room can rack up more than
//          one event for the same person (reprints, room turnover),
//          so each person's LAST event per room wins — that's always
//          whoever is currently occupying the room.
//
//  Room numbers are normalised (leading zeros stripped) since
//  gibyroom pads to 4 digits ("0601") while the XML doesn't ("601").
// ═══════════════════════════════════════════════════════════

let itGibyRooms  = {};   // norm room -> { pax, names:[] }
let itXmlRooms   = {};   // norm room -> { guestCount, visitorCount, guests:[{name,flag}] }
let itResults    = [];   // reconciled room rows, after itRun()
let itFilter_    = 'all';
let itSearchQ_   = '';

function _itNormRoom(room) {
  const t = (room || '').trim();
  if (!t) return '';
  const stripped = t.replace(/^0+/, '');
  return stripped || '0';
}

function _itNormName(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

// Find a header column by exact match first, then substring — mirrors the
// same flexible lookup used elsewhere in the app (tourism-tax.js etc.) so
// both the classic Opera export and a re-saved CSV like wa21 resolve to
// the same columns even though their header text differs slightly.
function _itFindCol(hdrs, ...names) {
  for (const n of names) {
    const exact = hdrs.findIndex(h => h === n);
    if (exact >= 0) return exact;
  }
  for (const n of names) {
    const idx = hdrs.findIndex(h => h.includes(n));
    if (idx >= 0) return idx;
  }
  return -1;
}

// ── Parse "Guest In-House By Room" — tab-delimited OR comma CSV ──
function itParseGiby(raw) {
  const lines = raw.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim());
  if (lines.length < 2) return null;

  // Auto-detect delimiter: classic gibyroom export is tab-delimited;
  // a report saved/re-copied as CSV (e.g. wa21) is comma+quoted.
  const delim     = lines[0].includes('\t') ? '\t' : ',';
  const splitLine = delim === '\t' ? (l => l.split('\t')) : parseCSVLine;

  const hdrs = splitLine(lines[0]).map(h => h.replace(/"/g, '').trim().toUpperCase());
  // ROOM_NO tried before the bare "ROOM" substring match — Reservation Detail
  // exports also have DISP_ROOM_NO (usually blank pre-check-in) which comes
  // earlier in the column order and would otherwise win the substring match.
  const iRoom   = _itFindCol(hdrs, 'ROOM_NO', 'ROOM');
  const iAdults = _itFindCol(hdrs, 'ADULTS');
  const iChild  = _itFindCol(hdrs, 'CHILDREN');
  const iName   = _itFindCol(hdrs, 'FULL_NAME', 'NAME');
  const iConf   = _itFindCol(hdrs, 'CONFIRMATION_NO');
  if (iRoom < 0) return null;

  const rooms = {};
  const seenConf = new Set(); // Reservation Detail: dedupe multi-row reservations (one row per ID/membership record)
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i]);
    if (iConf >= 0) {
      const conf = (cols[iConf] || '').replace(/"/g, '').trim();
      if (conf) {
        if (seenConf.has(conf)) continue;
        seenConf.add(conf);
      }
    }
    const room = (cols[iRoom] || '').replace(/"/g, '').trim();
    if (!room) continue;
    const adults   = iAdults >= 0 ? (parseInt(cols[iAdults]) || 0) : 0;
    const children = iChild  >= 0 ? (parseInt(cols[iChild])  || 0) : 0;
    const nameRaw  = iName   >= 0 ? (cols[iName] || '').replace(/"/g, '').trim() : '';
    const rn = _itNormRoom(room);
    if (!rooms[rn]) rooms[rn] = { pax: 0, names: [] };
    // If neither Adults nor Children columns were found at all, fall back
    // to counting 1 pax per reservation row rather than silently zeroing
    // the whole report out.
    rooms[rn].pax += (iAdults >= 0 || iChild >= 0) ? (adults + children) : 1;
    if (nameRaw) rooms[rn].names.push(typeof parseName === 'function' ? parseName(nameRaw) : nameRaw);
  }
  return rooms;
}

// ── Parse Inhouse / Guest Count XML OR VICAS Check-In XML ────
function _itXmlField(block, fieldName) {
  const re = new RegExp('Name="' + fieldName + '"[^>]*><FormattedValue>([^<]*)</FormattedValue>');
  const m = block.match(re);
  return m ? m[1].trim() : '';
}

function itParseXml(raw) {
  // Inhouse/Guest Count XML uses <Details Level="2">, one block per
  // registered person. The VICAS Transaction Report uses <Details
  // Level="1"> instead, one block per check-in/escort event.
  let details = raw.match(/<Details Level="2">[\s\S]*?<\/Details>/g);
  let level = 2;
  if (!details || !details.length) {
    details = raw.match(/<Details Level="1">[\s\S]*?<\/Details>/g);
    level = 1;
  }
  if (!details || !details.length) return null;

  const rooms = {};

  if (level === 2) {
    details.forEach(block => {
      const room = _itXmlField(block, 'RoomNumber1');
      if (!room) return;
      const given   = _itXmlField(block, 'GivenName1');
      const family  = _itXmlField(block, 'FamilyName1');
      const flagRaw = _itXmlField(block, 'PrimaryEscortFlag1');
      // No flag field at all (older report format) → treat as a guest.
      const flag = flagRaw || 'P';
      const rn = _itNormRoom(room);
      if (!rooms[rn]) rooms[rn] = { guestCount: 0, visitorCount: 0, guests: [] };
      const name = (given + ' ' + family).trim();
      if (flag === 'V') rooms[rn].visitorCount++;
      else              rooms[rn].guestCount++;
      rooms[rn].guests.push({ name, flag });
    });
    return rooms;
  }

  // VICAS Transaction Report (Level 1) — one row per check-in EVENT, not
  // per current occupant. The same person can appear more than once, and
  // not always for the same room: a reprinted registration card logs an
  // identical duplicate event, but a genuine room change/reassignment logs
  // the guest under a DIFFERENT room later in the report. Either way, the
  // fix is the same — track only each guest's most recent (room, flag) in
  // document order, so they're counted against wherever they ended up, not
  // every room they've ever briefly touched.
  const lastByGuest = {}; // normalised name -> { room, name, flag }
  details.forEach(block => {
    const room     = _itXmlField(block, 'RoomNumber1');
    const fullName = _itXmlField(block, 'FullName1');
    if (!room || !fullName) return;
    const process = _itXmlField(block, 'Process1');
    const flag = process === 'Add-Escort' ? 'E' : 'P';
    lastByGuest[_itNormName(fullName)] = { room: _itNormRoom(room), name: fullName, flag };
  });
  Object.values(lastByGuest).forEach(g => {
    if (!rooms[g.room]) rooms[g.room] = { guestCount: 0, visitorCount: 0, guests: [] };
    // VICAS has no "Visitor" concept — every distinct person logged
    // against a room is an actual overnight occupant.
    rooms[g.room].guestCount++;
    rooms[g.room].guests.push({ name: g.name, flag: g.flag });
  });
  return rooms;
}

// ── File upload handlers ──────────────────────────────────
function itLoadGibyFile(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('itGibyInput').value = e.target.result;
    const lbl = document.getElementById('itGibyLabel');
    if (lbl) lbl.textContent = '✓ ' + file.name;
  };
  reader.readAsText(file, 'utf-8');
}

function itLoadXmlFile(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('itXmlInput').value = e.target.result;
    const lbl = document.getElementById('itXmlLabel');
    if (lbl) lbl.textContent = '✓ ' + file.name;
  };
  reader.readAsText(file, 'utf-8');
}

// ── Reconcile + render ────────────────────────────────────
function itRun() {
  const errBox = document.getElementById('itError');
  errBox.classList.remove('show');
  const showErr = msg => { document.getElementById('itErrorMsg').textContent = msg; errBox.classList.add('show'); };

  const gibyRaw = (document.getElementById('itGibyInput').value || '').trim();
  const xmlRaw  = (document.getElementById('itXmlInput').value  || '').trim();
  if (!gibyRaw) return showErr('Upload or paste the Guest In-House By Room (or wa21) export first.');
  if (!xmlRaw)  return showErr('Upload or paste the Inhouse / Guest Count XML (or Vicas Check-In XML) first.');

  const giby = itParseGiby(gibyRaw);
  if (!giby) return showErr('Could not find a Room column — check this is the Guest In-House By Room or wa21 export.');
  const xml = itParseXml(xmlRaw);
  if (!xml) return showErr('Could not find any guest records — check this is the Inhouse/Guest Count XML or the Vicas Check-In XML.');

  itGibyRooms = giby;
  itXmlRooms  = xml;

  const allRooms = new Set([...Object.keys(giby), ...Object.keys(xml)]);
  const rows = [];
  allRooms.forEach(rn => {
    const g = giby[rn] || { pax: 0, names: [] };
    const x = xml[rn]  || { guestCount: 0, visitorCount: 0, guests: [] };
    let verdict;
    if (g.pax === 0)       verdict = 'missing_giby'; // in XML but no Opera reservation
    else if (x.guestCount === 0 && x.visitorCount === 0) verdict = 'missing_xml'; // in Opera but not registered at all
    else if (g.pax !== x.guestCount) verdict = 'mismatch';
    else verdict = 'ok';
    rows.push({ room: rn, opera: g, xml: x, verdict });
  });
  rows.sort((a, b) => (parseInt(a.room) || 0) - (parseInt(b.room) || 0));
  itResults = rows;

  const gibyTotal    = Object.values(giby).reduce((s, r) => s + r.pax, 0);
  const xmlGuestTotal = Object.values(xml).reduce((s, r) => s + r.guestCount, 0);
  const xmlVisitorTotal = Object.values(xml).reduce((s, r) => s + r.visitorCount, 0);
  const flaggedCount = rows.filter(r => r.verdict !== 'ok').length;
  const gap = gibyTotal - xmlGuestTotal;

  const kpiHTML = `
    <div class="kpi sky"><div class="kpi-accent"></div><div class="kpi-label">Opera In-House</div><div class="kpi-val">${gibyTotal}</div><div class="kpi-sub">${Object.keys(giby).length} rooms</div></div>
    <div class="kpi mint"><div class="kpi-accent"></div><div class="kpi-label">XML Guests</div><div class="kpi-val">${xmlGuestTotal}</div><div class="kpi-sub">Primary + Escort</div></div>
    <div class="kpi ${xmlVisitorTotal ? 'amber' : ''}"><div class="kpi-accent"></div><div class="kpi-label">Visitors Excluded</div><div class="kpi-val">${xmlVisitorTotal}</div><div class="kpi-sub">not overnight guests</div></div>
    <div class="kpi ${gap === 0 ? 'mint' : 'rose'}"><div class="kpi-accent"></div><div class="kpi-label">Gap</div><div class="kpi-val">${gap === 0 ? '✓ 0' : (gap > 0 ? '−' + gap : '+' + Math.abs(gap))}</div><div class="kpi-sub">${flaggedCount} room${flaggedCount !== 1 ? 's' : ''} flagged</div></div>`;
  document.getElementById('itKpis').innerHTML = kpiHTML;

  document.getElementById('itResultsWrap').style.display = 'block';
  itFilter_ = 'all';
  document.querySelectorAll('#itFilters .fchip').forEach(b => b.classList.remove('on'));
  const allBtn = document.querySelector('#itFilters [data-itf="all"]'); if (allBtn) allBtn.classList.add('on');
  itRender();

  const badge = document.getElementById('badge-inhouse-tally');
  if (badge) { badge.textContent = flaggedCount > 0 ? String(flaggedCount) : '✓'; }

  showToast(flaggedCount === 0 ? `All ${allRooms.size} rooms reconciled ✓` : `${flaggedCount} room${flaggedCount !== 1 ? 's' : ''} need a check`, flaggedCount === 0 ? 'ok' : 'err');
}

function itRender() {
  const q = itSearchQ_.toLowerCase().trim();
  const filtered = itResults.filter(r => {
    if (itFilter_ === 'mismatch' && r.verdict !== 'mismatch') return false;
    if (itFilter_ === 'missing'  && !(r.verdict === 'missing_giby' || r.verdict === 'missing_xml')) return false;
    if (itFilter_ === 'ok'       && r.verdict !== 'ok') return false;
    if (q) {
      const hay = [r.room, ...r.opera.names, ...r.xml.guests.map(g => g.name)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  [['itfc-all', itResults.length],
   ['itfc-mismatch', itResults.filter(r => r.verdict === 'mismatch').length],
   ['itfc-missing',  itResults.filter(r => r.verdict === 'missing_giby' || r.verdict === 'missing_xml').length],
   ['itfc-ok',       itResults.filter(r => r.verdict === 'ok').length],
  ].forEach(([id, v]) => { const el = document.getElementById(id); if (el) el.textContent = v; });

  const verdictHTML = r => {
    if (r.verdict === 'ok')           return `<span style="color:var(--mint);">✅ Match</span>`;
    if (r.verdict === 'mismatch')     return `<span style="color:var(--amber);">⚠ ${r.opera.pax} vs ${r.xml.guestCount}</span>`;
    if (r.verdict === 'missing_xml')  return `<span style="color:var(--rose);">🔴 Not in immigration</span>`;
    if (r.verdict === 'missing_giby') return `<span style="color:var(--rose);">🔴 No Opera reservation</span>`;
    return '';
  };

  const tbody = document.getElementById('itTable');
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:36px;font-family:var(--mono);font-size:0.7rem;color:var(--text3);">No rooms match.</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(r => `
    <tr>
      <td><span class="tt-room-pill">${r.room}</span></td>
      <td style="font-size:0.72rem;">${r.opera.pax} pax${r.opera.names.length ? ` <span style="color:var(--text3);">— ${escapeHtml(r.opera.names.join(', '))}</span>` : ''}</td>
      <td style="font-size:0.72rem;">${r.xml.guestCount} pax${r.xml.guests.length ? ` <span style="color:var(--text3);">— ${escapeHtml(r.xml.guests.map(g => g.name).join(', '))}</span>` : ''}</td>
      <td style="font-family:var(--mono);font-size:0.72rem;color:var(--text3);">${r.xml.visitorCount || '—'}</td>
      <td style="font-family:var(--mono);font-size:0.72rem;">${verdictHTML(r)}</td>
    </tr>`).join('');
}

function itSetFilter(f, el) {
  itFilter_ = f;
  document.querySelectorAll('#itFilters .fchip').forEach(b => b.classList.remove('on'));
  if (el) el.classList.add('on');
  itRender();
}

function itSetSearch(val) {
  itSearchQ_ = val || '';
  itRender();
}

function itCopyFlagged() {
  const flagged = itResults.filter(r => r.verdict !== 'ok');
  if (!flagged.length) { showToast('No flagged rooms — all clean ✓', 'info'); return; }
  const lines = [
    `Inhouse Tally — Flagged Rooms`,
    `${'─'.repeat(50)}`,
    ...flagged.map(r => {
      const tag = r.verdict === 'mismatch' ? `Opera ${r.opera.pax} vs XML ${r.xml.guestCount}`
                : r.verdict === 'missing_xml' ? 'No immigration registration'
                : 'No Opera reservation found';
      return `Room ${r.room}  —  ${tag}`;
    }),
    `${'─'.repeat(50)}`,
    `Total: ${flagged.length} room${flagged.length !== 1 ? 's' : ''} flagged`,
  ];
  copyToClipboard(lines.join('\n'), null, '');
  showToast(`${flagged.length} room${flagged.length !== 1 ? 's' : ''} copied ✓`, 'ok');
}

function itClear() {
  itGibyRooms = {}; itXmlRooms = {}; itResults = []; itFilter_ = 'all'; itSearchQ_ = '';
  const gi = document.getElementById('itGibyInput'); if (gi) gi.value = '';
  const xi = document.getElementById('itXmlInput');  if (xi) xi.value = '';
  const gl = document.getElementById('itGibyLabel'); if (gl) gl.textContent = 'Click to upload, or paste below';
  const xl = document.getElementById('itXmlLabel');  if (xl) xl.textContent = 'Click to upload, or paste below';
  const gf = document.getElementById('itGibyFileInput'); if (gf) gf.value = '';
  const xf = document.getElementById('itXmlFileInput');  if (xf) xf.value = '';
  const search = document.getElementById('itSearch'); if (search) search.value = '';
  document.getElementById('itResultsWrap').style.display = 'none';
  document.getElementById('itError').classList.remove('show');
  const badge = document.getElementById('badge-inhouse-tally'); if (badge) badge.textContent = '—';
}

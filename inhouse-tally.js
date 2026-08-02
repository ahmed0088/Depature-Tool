// ═══════════════════════════════════════════════════════════
//  inhouse-tally.js  —  Inhouse Tally (Opera vs Immigration XML)
//
//  Reconciles two same-night Opera exports:
//   1) "Guest In-House By Room" — tab-delimited, one row per room
//      reservation, with ADULTS/CHILDREN giving the true occupancy.
//   2) Inhouse / Guest Count XML — Crystal Report export, one
//      <Details Level="2"> block per registered person. Newer
//      exports tag each person with PrimaryEscortFlag:
//        P = Primary guest, E = Escort (sharing/accompanying),
//        V = Visitor — NOT an overnight guest, must be excluded
//            from the in-house headcount or totals won't match.
//      Older exports don't have this flag at all — in that case
//      every record is treated as a guest.
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

// ── Parse "Guest In-House By Room" (tab-delimited) ────────
function itParseGiby(raw) {
  const lines = raw.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim());
  if (lines.length < 2) return null;
  const hdrs = lines[0].split('\t').map(h => h.trim().toUpperCase());
  const idx  = {};
  hdrs.forEach((h, i) => { idx[h] = i; });
  if (idx['ROOM'] === undefined) return null;

  const rooms = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    const room = (cols[idx['ROOM']] || '').trim();
    if (!room) continue;
    const adults   = parseInt(cols[idx['ADULTS']])   || 0;
    const children = idx['CHILDREN'] !== undefined ? (parseInt(cols[idx['CHILDREN']]) || 0) : 0;
    const nameRaw  = idx['FULL_NAME'] !== undefined ? (cols[idx['FULL_NAME']] || '').trim() : '';
    const rn = _itNormRoom(room);
    if (!rooms[rn]) rooms[rn] = { pax: 0, names: [] };
    rooms[rn].pax += adults + children;
    if (nameRaw) rooms[rn].names.push(typeof parseName === 'function' ? parseName(nameRaw) : nameRaw);
  }
  return rooms;
}

// ── Parse Inhouse / Guest Count XML (Crystal Report export) ──
function _itXmlField(block, fieldName) {
  const re = new RegExp('Name="' + fieldName + '"[^>]*><FormattedValue>([^<]*)</FormattedValue>');
  const m = block.match(re);
  return m ? m[1].trim() : '';
}

function itParseXml(raw) {
  const details = raw.match(/<Details Level="2">[\s\S]*?<\/Details>/g);
  if (!details || !details.length) return null;

  const rooms = {};
  details.forEach(block => {
    const room = _itXmlField(block, 'RoomNumber1');
    if (!room) return;
    const given  = _itXmlField(block, 'GivenName1');
    const family = _itXmlField(block, 'FamilyName1');
    const flagRaw = _itXmlField(block, 'PrimaryEscortFlag1');
    // No flag field at all (older report format) → treat as a guest.
    const flag = flagRaw || 'P';
    const rn = _itNormRoom(room);
    if (!rooms[rn]) rooms[rn] = { guestCount: 0, visitorCount: 0, guests: [] };
    const name = (given + ' ' + family).trim();
    if (flag === 'V') {
      rooms[rn].visitorCount++;
    } else {
      rooms[rn].guestCount++;
    }
    rooms[rn].guests.push({ name, flag });
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
  if (!gibyRaw) return showErr('Upload or paste the Guest In-House By Room export first.');
  if (!xmlRaw)  return showErr('Upload or paste the Inhouse / Guest Count XML first.');

  const giby = itParseGiby(gibyRaw);
  if (!giby) return showErr('Could not find a ROOM column — check this is the Guest In-House By Room export.');
  const xml = itParseXml(xmlRaw);
  if (!xml) return showErr('Could not find any guest records — check this is the Inhouse/Guest Count XML.');

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

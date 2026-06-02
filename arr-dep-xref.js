// ═══════════════════════════════════════════════════════════
//  arr-dep-xref.js  v3  —  Arrivals ↔ Departures Cross-Reference
//
//  PURPOSE:
//  Compare today's departures with today's arrivals.
//  If the SAME GUEST appears in BOTH lists for the SAME ROOM
//  → they made a new booking as their extension.
//  This lets you instantly see which rooms have extensions booked.
// ═══════════════════════════════════════════════════════════

let _xrefArrRooms   = [];
let _xrefArrNoRoom  = [];
let _xrefLoaded     = false;
let _xrefFilter     = 'all';  // 'all' | 'extensions' | 'new' | 'unassigned'
let _xrefSearch     = '';

// ── Name normaliser — strips titles, extra spaces, commas ─
function _normName(raw) {
  if (!raw) return '';
  return raw
    .replace(/,?\s*(Mr\.?|Mrs\.?|Ms\.?|Miss|Dr\.?)\s*/gi, ' ')
    .replace(/[^a-z0-9]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ── Check if two names are the same guest ─────────────────
// Requires at least TWO significant words to match, OR one word ≥7 chars.
// This avoids false positives like "Ali" matching "Walid Ali Hassan".
function _namesMatch(a, b) {
  if (!a || !b) return false;
  const wa = _normName(a).split(' ').filter(w => w.length > 3);
  const wb = _normName(b).split(' ').filter(w => w.length > 3);
  if (!wa.length || !wb.length) return false;
  const shared = wa.filter(w => wb.includes(w));
  // Must share ≥2 words OR one long word (≥7 chars = likely unique surname)
  return shared.length >= 2 || shared.some(w => w.length >= 7);
}

// ── Source normaliser ─────────────────────────────────────
function _xrefSource(raw) {
  if (!raw) return 'Direct';
  const s = raw.trim();
  if (/booking\.com/i.test(s))      return 'Booking.com';
  if (/agoda/i.test(s))             return 'Agoda';
  if (/expedia/i.test(s))           return 'Expedia';
  if (/airbnb/i.test(s))            return 'Airbnb';
  if (/hotels\.com/i.test(s))       return 'Hotels.com';
  if (/trip\.com|ctrip/i.test(s))   return 'Trip.com';
  if (/travco/i.test(s))            return 'Travco';
  if (/dnata/i.test(s))             return 'Dnata';
  if (/almosafer/i.test(s))         return 'Almosafer';
  if (/cleartrip/i.test(s))         return 'Cleartrip';
  if (/makemytrip/i.test(s))        return 'MakeMyTrip';
  if (/corporate|company/i.test(s)) return 'Corporate';
  if (!s || s.length < 2)           return 'Direct';
  return s.replace(/\s*(B\.?V\.?|PTE\.? LTD\.?|LLC|INC\.?|LTD\.?)\.?\s*$/i, '').trim() || 'Direct';
}

function _xrefPlatformIcon(source) {
  const icons = {
    'Booking.com': '🔵', 'Agoda': '🟠', 'Expedia': '🟡',
    'Airbnb': '🩷', 'Hotels.com': '🟣', 'Trip.com': '🔴',
    'Direct': '🏨', 'Corporate': '🏢', 'Travco': '✈️',
    'Dnata': '✈️', 'Almosafer': '🌙',
  };
  return icons[source] || '📋';
}

// ── Parse arrivals report ─────────────────────────────────
function xrefParseArrivals(raw) {
  const lines = raw.split('\n').map(l => l.trimEnd()).filter(l => l.trim());
  if (lines.length < 2) return null;

  const hdrs = lines[0].split('\t').map(h => h.trim().toUpperCase());
  // Column resolver: try exact match for ALL needles first, then includes fallback for ALL.
  // This prevents e.g. 'DEPARTURE' from matching 'DEPARTURE_TIME' via includes.
  const col = (...needles) => {
    // Pass 1: exact match
    for (const n of needles) {
      const i = hdrs.indexOf(n);
      if (i >= 0) return i;
    }
    // Pass 2: includes fallback (whole-word boundary: needle must not be a prefix of a longer token)
    for (const n of needles) {
      const i = hdrs.findIndex(h => h === n || (h.includes(n) && !h.replace(n, '').match(/^[A-Z_]/)));
      if (i >= 0) return i;
    }
    return -1;
  };

  const iDispRoom = col('DISP_ROOM_NO');
  const iRoomNo   = col('ROOM_NO');
  const iName     = col('FULL_NAME_NO_SHR_IND', 'FULL_NAME', 'GUEST_NAME', 'NAME');
  const iNameFb   = col('GUEST_NAME', 'FULL_NAME'); // fallback if primary col has SHR indicator
  const iConf     = col('CONFIRMATION_NO', 'CONFIRM');
  const iArr      = col('TRUNC_BEGIN', 'ARRIVAL', 'BEGIN_DATE');
  const iDep      = col('TRUNC_END', 'DEPARTURE');
  const iNights   = col('NO_OF_NIGHTS', 'NIGHTS');
  const iAdults   = col('ADULTS');
  const iStatus   = col('SHORT_RESV_STATUS');
  const iSource   = col('COMPANY_NAME', 'TRAVEL_AGENT_NAME', 'SOURCE_NAME');
  const iArrTime  = col('ARRIVAL_TIME', 'ARRIVAL_TIME1');

  if (iName < 0) return null;

  const seen = new Set();
  const withRoom = [], withoutRoom = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    if (cols.length < 5) continue;

    const status = (cols[iStatus] || '').trim().toUpperCase();
    if (status === 'GCC' || status === 'C') continue;

    const rawName  = (cols[iName]    || '').trim();
    const dispRoom = (cols[iDispRoom]|| '').trim().replace(/^0+/, '');
    const roomNo   = iRoomNo >= 0 ? (cols[iRoomNo] || '').trim().replace(/^0+/, '') : '';
    const conf     = (cols[iConf]    || '').trim();
    const arrDate  = (cols[iArr]     || '').trim();
    const depDate  = (cols[iDep]     || '').trim();
    const nights   = parseInt(cols[iNights] || '1') || 1;
    const adults   = parseInt(cols[iAdults] || '1') || 1;
    const rawSrc   = (cols[iSource]  || '').trim();
    const rawTime  = iArrTime >= 0 ? (cols[iArrTime] || '').trim() : '';

    // Skip blank names, single-char SHR indicators (N/Y), and other junk ≤2 chars
    if (!rawName || rawName.length <= 2) continue;

    // If the primary name column only has a short indicator, try fallback column
    const effectiveName = rawName.length <= 2 && iNameFb >= 0
      ? (cols[iNameFb] || '').trim()
      : rawName;
    if (!effectiveName || effectiveName.length <= 2) continue;

    const dedupeKey = conf || effectiveName;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const source = _xrefSource(rawSrc);
    const room   = dispRoom || roomNo;
    const name   = parseName(effectiveName);

    // Final guard — parseName result must be a real name
    if (!name || name === '—' || name.length <= 2) continue;

    const record = {
      room, name, rawName: effectiveName,
      conf, arrDate, depDate, nights, adults, source,
      arrTime: rawTime.replace(/^\*/, '').trim(),
      // filled after cross-referencing dep board:
      isExtension: false,
      depGuest: null,   // matching dep board room object
    };

    if (room) withRoom.push(record);
    else      withoutRoom.push(record);
  }

  return { withRoom, withoutRoom };
}

// ── Core logic: is this arrival an extension? ─────────────
//
//  EXTENSION when ANY of:
//   A) Arrival has a room AND same room exists on dep board AND same guest name
//   B) Arrival has no room yet BUT same guest name found anywhere on dep board
//      (guest made a new booking before checking out — room TBD at desk)
//
//  NEW ARRIVAL when:
//   C) Arrival has a room on dep board but DIFFERENT guest name → room freed, new guest
//   D) Arrival has no room match on dep board at all → brand new guest
//
//  result sets on arrRecord:
//   isExtension  — true/false
//   depGuest     — matching depRooms entry (or null)
//   extReason    — short reason string for UI
function _xrefCheckExtension(arrRecord) {
  if (!depRooms || !depRooms.length) {
    arrRecord.isExtension = false;
    arrRecord.depGuest    = null;
    arrRecord.extReason   = 'Load dep board for verdict';
    return;
  }

  // Normalise arrival room (strip leading zeros)
  const arrRoom = (arrRecord.room || '').replace(/^0+/, '');

  // A) Room match — same room number on dep board
  if (arrRoom) {
    const depRoom = depRooms.find(r =>
      r.roomStr.replace(/^0+/, '') === arrRoom ||
      String(r.room) === arrRoom
    );

    if (depRoom) {
      arrRecord.depGuest = depRoom;

      if (_namesMatch(arrRecord.name, depRoom.name)) {
        // Same room, same guest → EXTENSION
        arrRecord.isExtension = true;
        arrRecord.extReason   = 'Same room · same guest · new booking = extension';
      } else {
        // Same room, different guest → new arrival, previous guest departing
        arrRecord.isExtension = false;
        arrRecord.extReason   = `Room occupied by ${depRoom.name} (due out today)`;
      }
      return;
    }

    // Room not on dep board at all → room is already clear / freshly freed
    arrRecord.isExtension = false;
    arrRecord.depGuest    = null;
    arrRecord.extReason   = 'Room not on dep board — clear for new arrival';
    return;
  }

  // B) No room assigned yet — search dep board by name only
  const nameMatch = depRooms.find(r => _namesMatch(arrRecord.name, r.name));
  if (nameMatch) {
    arrRecord.isExtension = true;
    arrRecord.depGuest    = nameMatch;
    arrRecord.extReason   = `Same guest in room ${nameMatch.roomStr} — extension (room TBD)`;
    return;
  }

  // D) No room, no name match → brand new guest
  arrRecord.isExtension = false;
  arrRecord.depGuest    = null;
  arrRecord.extReason   = 'New guest — no match on dep board';
}

function _xrefEnrichAll() {
  [..._xrefArrRooms, ..._xrefArrNoRoom].forEach(a => {
    a.isExtension = false;
    a.depGuest    = null;
    a.extReason   = '';
    _xrefCheckExtension(a);
  });
}

// ── Load ──────────────────────────────────────────────────
function _xrefApplyLoad(result) {
  _xrefArrRooms  = result.withRoom;
  _xrefArrNoRoom = result.withoutRoom;
  _xrefLoaded    = true;

  document.getElementById('xrefPasteCard').style.display  = 'none';
  document.getElementById('xrefResultCard').style.display = 'block';

  const reloadBtn = document.getElementById('xrefReloadBtn');
  if (reloadBtn) reloadBtn.style.display = '';

  const total = _xrefArrRooms.length + _xrefArrNoRoom.length;
  const lbl   = document.getElementById('xrefDateLabel');
  if (lbl) lbl.textContent = `${total} arrivals loaded · ${new Date().toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' })}`;

  _xrefEnrichAll();
  xrefRender();
  if (typeof depRender === 'function') depRender();

  const ext = [..._xrefArrRooms, ..._xrefArrNoRoom].filter(a => a.isExtension).length;
  let msg = `${total} arrivals loaded`;
  if (ext) msg += ` · ↪ ${ext} extension${ext > 1 ? 's' : ''} found`;
  showToast(msg, 'ok');
}

function xrefLoad() {
  const raw = (document.getElementById('xrefInput')?.value || '').trim();
  if (!raw) { showToast('Paste today\'s arrivals report first', 'err'); return; }

  const result = xrefParseArrivals(raw);
  if (!result) { showToast('Could not parse arrivals — check format', 'err'); return; }

  document.getElementById('xrefInput').value = '';
  _xrefApplyLoad(result);
}

function xrefLoadFile(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const ta = document.getElementById('xrefInput');
    if (ta) ta.value = e.target.result;
    xrefLoad();
  };
  reader.readAsText(file, 'utf-8');
}

// ── Reload modal ──────────────────────────────────────────
function openXrefReloadModal() {
  document.getElementById('xrefReloadModal').classList.add('open');
  document.getElementById('xrefReloadInput').value = '';
  const err = document.getElementById('xrefReloadError');
  if (err) err.style.display = 'none';
  setTimeout(() => document.getElementById('xrefReloadInput').focus(), 80);
}

function closeXrefReloadModal() {
  document.getElementById('xrefReloadModal').classList.remove('open');
}

function processXrefReload() {
  const raw    = (document.getElementById('xrefReloadInput')?.value || '').trim();
  const errBox = document.getElementById('xrefReloadError');
  const errMsg = document.getElementById('xrefReloadErrorMsg');
  if (errBox) errBox.style.display = 'none';

  if (!raw) {
    if (errMsg) errMsg.textContent = 'Please paste the arrivals report first.';
    if (errBox) errBox.style.display = '';
    return;
  }

  const result = xrefParseArrivals(raw);
  if (!result) {
    if (errMsg) errMsg.textContent = 'Could not parse arrivals — check the report format.';
    if (errBox) errBox.style.display = '';
    return;
  }

  closeXrefReloadModal();
  _xrefApplyLoad(result);
}

// ── Filters ───────────────────────────────────────────────
function xrefSetFilter(f, el) {
  _xrefFilter = f;
  document.querySelectorAll('.xref-filter-btn').forEach(b => b.classList.remove('on'));
  if (el) el.classList.add('on');
  xrefRender();
}

function xrefSetSearch(val) {
  _xrefSearch = (val || '').toLowerCase().trim();
  xrefRender();
}

function _xrefApplyFilters(records, type) {
  return records.filter(a => {
    if (_xrefFilter === 'extensions'  && !a.isExtension)  return false;
    if (_xrefFilter === 'new'         && a.isExtension)   return false;
    if (_xrefFilter === 'unassigned'  && type !== 'noroom') return false;
    if (_xrefSearch) {
      const hay = [a.room, a.name, a.conf, a.source, a.depGuest?.name || ''].join(' ').toLowerCase();
      if (!hay.includes(_xrefSearch)) return false;
    }
    return true;
  });
}

// ── Render ────────────────────────────────────────────────
function xrefRender() {
  _xrefEnrichAll();

  // Extensions can now come from BOTH withRoom and withoutRoom lists
  const allRecords   = [..._xrefArrRooms, ..._xrefArrNoRoom];
  const extensions   = allRecords.filter(a => a.isExtension).length;
  const newArrivals  = allRecords.filter(a => !a.isExtension).length;
  const unassigned   = _xrefArrNoRoom.length;
  const total        = allRecords.length;

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('xref-kpi-total',      total);
  set('xref-kpi-conflict',   extensions);
  set('xref-kpi-can-extend', newArrivals);
  set('xref-kpi-assigned',   _xrefArrRooms.length);
  set('xref-kpi-unassigned', unassigned);

  const badge = document.getElementById('badge-xref');
  if (badge) badge.textContent = extensions || total || '0';

  set('xref-fc-all',        total);
  set('xref-fc-conflicts',  extensions);
  set('xref-fc-can-extend', newArrivals);
  set('xref-fc-unassigned', unassigned);

  // Update filter tab labels
  const btnExt = document.querySelector('[data-xf="conflicts"]');
  const btnNew = document.querySelector('[data-xf="can_extend"]');
  if (btnExt) btnExt.childNodes[0].textContent = '↪ Extensions ';
  if (btnNew) btnNew.childNodes[0].textContent = '🛎 New Arrivals ';

  const noDep = document.getElementById('xrefNoteNoDep');
  if (noDep) noDep.style.display = (!depRooms || !depRooms.length) ? '' : 'none';

  const tbody = document.getElementById('xrefTable');
  if (!tbody) return;

  // Build visible lists respecting active filter
  const visExtRoom  = _xrefApplyFilters(_xrefArrRooms.filter(a =>  a.isExtension), 'room');
  const visNewRoom  = _xrefApplyFilters(_xrefArrRooms.filter(a => !a.isExtension), 'room');
  // No-room arrivals that turned out to be extensions (name-matched on dep board)
  const visExtNoRm  = _xrefApplyFilters(_xrefArrNoRoom.filter(a =>  a.isExtension), 'noroom-ext');
  const visNoRoom   = _xrefApplyFilters(_xrefArrNoRoom.filter(a => !a.isExtension), 'noroom');

  // Apply filter restrictions
  const showExt    = _xrefFilter === 'all' || _xrefFilter === 'extensions';
  const showNew    = _xrefFilter === 'all' || _xrefFilter === 'new';
  const showNoRoom = _xrefFilter === 'all' || _xrefFilter === 'unassigned';

  const extList   = showExt    ? [...visExtRoom, ...visExtNoRm] : [];
  const newList   = showNew    ? visNewRoom                     : [];
  const noRmList  = showNoRoom ? visNoRoom                      : [];

  if (!extList.length && !newList.length && !noRmList.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;font-family:var(--mono);font-size:0.7rem;color:var(--text3);">No results match this filter.</td></tr>`;
    return;
  }

  let html = '';

  if (extList.length) {
    html += _xrefSectionHeader('extension', `↪ EXTENSIONS — ${extList.length} room${extList.length > 1 ? 's' : ''} — same guest booked a new reservation`);
    extList.forEach(a => { html += _xrefRow(a, 'extension'); });
  }
  if (newList.length) {
    html += _xrefSectionHeader('new', `🛎 NEW ARRIVALS — ${newList.length} room${newList.length > 1 ? 's' : ''} — different guest checking in`);
    newList.forEach(a => { html += _xrefRow(a, 'new'); });
  }
  if (noRmList.length) {
    html += _xrefSectionHeader('noroom', `🏷 NO ROOM ASSIGNED — ${noRmList.length} arrival${noRmList.length > 1 ? 's' : ''} — assign room at check-in`);
    noRmList.forEach(a => { html += _xrefNoRoomRow(a); });
  }

  tbody.innerHTML = html;
  xrefInjectDepStrips();
}

// ── Section header ────────────────────────────────────────
function _xrefSectionHeader(type, label) {
  const cls = { extension:'ext-header', new:'new-header', noroom:'noroom-header' }[type] || 'noroom-header';
  return `<tr class="xref-section-header ${cls}"><td colspan="8">${label}</td></tr>`;
}

// ── Table row ─────────────────────────────────────────────
function _xrefRow(a, rowType) {
  const icon     = _xrefPlatformIcon(a.source);
  const isExt    = rowType === 'extension';
  const rowCls   = isExt ? 'xref-ext-row' : 'xref-new-row';
  const pillCls  = isExt ? 'ext' : 'new';

  let depInfo = '';
  if (isExt && a.depGuest) {
    const depStatus   = a.depGuest.status || 'due';
    const statusLabel = depStatus === 'out' ? 'CHECKED OUT' : depStatus === 'late' ? 'LATE DEPARTURE' : depStatus === 'extended' ? 'EXTENDED' : 'DUE OUT TODAY';
    const statusCls   = depStatus === 'out' ? 'dep-out' : 'dep-due';
    depInfo = `
      <div style="font-family:var(--mono);font-size:0.65rem;color:var(--text3);">Currently in room</div>
      <div style="font-weight:500;color:var(--sky);font-size:0.72rem;">${escapeHtml(a.depGuest.name)}</div>
      <span class="xref-dep-status ${statusCls}" style="margin-top:2px;">${statusLabel}</span>
    `;
  } else if (isExt) {
    depInfo = `<span style="font-family:var(--mono);font-size:0.65rem;color:var(--sky);">Same guest · matched by name</span>`;
  } else if (a.depGuest) {
    depInfo = `
      <div style="font-family:var(--mono);font-size:0.65rem;color:var(--text3);">Departing today</div>
      <div style="font-weight:500;color:var(--amber);font-size:0.72rem;">${escapeHtml(a.depGuest.name)}</div>
      <span class="xref-dep-status dep-due" style="margin-top:2px;">DUE OUT · DIFFERENT GUEST</span>
    `;
  } else {
    depInfo = `<span style="font-family:var(--mono);font-size:0.65rem;color:var(--mint);">Room clear — no departing guest</span>`;
  }

  const badge = isExt
    ? `<span class="xref-badge-ext">↪ EXTENSION</span>`
    : `<span class="xref-badge-new">🛎 NEW ARRIVAL</span>`;

  const reason = escapeHtml(a.extReason || (isExt ? 'Same guest · new booking' : 'Different guest · new reservation'));

  return `<tr class="xref-row ${rowCls}">
    <td><span class="xref-room-pill ${pillCls}">${a.room || '—'}</span></td>
    <td>
      <div class="xref-arr-name">${escapeHtml(a.name)}</div>
      <div class="xref-subtext">${a.conf || '—'}${a.adults > 1 ? ` · ${a.adults} pax` : ''}</div>
    </td>
    <td>
      <div class="xref-platform">${icon} ${escapeHtml(a.source)}</div>
    </td>
    <td style="font-family:var(--mono);font-size:0.7rem;color:var(--text2);">
      ${a.arrDate || '—'}<br>
      <span style="font-size:0.62rem;color:var(--text3);">${a.nights}N · out ${a.depDate || '—'}</span>
    </td>
    <td>${depInfo}</td>
    <td>${badge}</td>
    <td style="font-family:var(--mono);font-size:0.6rem;color:var(--text3);">${reason}</td>
    <td style="display:flex;gap:5px;align-items:center;">
      <button class="xref-copy-btn" onclick="xrefCopyRow(this,'${escapeHtml(a.room||'TBA')}','${escapeHtml(a.name)}','${escapeHtml(a.source)}','${a.nights}N','${isExt ? 'Extension' : 'New arrival'}')">📋</button>
      <button class="xref-copy-btn" style="color:var(--rose);border-color:rgba(240,107,122,0.3);" onclick="xrefDeleteRow('${escapeHtml(a.conf || a.name)}','room')" title="Remove from list">✕</button>
    </td>
  </tr>`;
}

// ── No room row ───────────────────────────────────────────
function _xrefNoRoomRow(a) {
  const icon = _xrefPlatformIcon(a.source);
  return `<tr class="xref-row xref-unassigned">
    <td>
      <div style="display:flex;align-items:center;gap:6px;">
        <span class="xref-room-pill unassigned">—</span>
        <button class="xref-assign-btn" onclick="xrefQuickAssign(this,'${escapeHtml(a.conf || a.name)}')">✏ Assign</button>
      </div>
    </td>
    <td>
      <div class="xref-arr-name">${escapeHtml(a.name)}</div>
      <div class="xref-subtext">${a.conf || '—'}${a.adults > 1 ? ` · ${a.adults} pax` : ''}</div>
    </td>
    <td><div class="xref-platform">${icon} ${escapeHtml(a.source)}</div></td>
    <td style="font-family:var(--mono);font-size:0.7rem;color:var(--text2);">
      ${a.arrDate || '—'}<br>
      <span style="font-size:0.62rem;color:var(--text3);">${a.nights}N · out ${a.depDate || '—'}</span>
    </td>
    <td colspan="2"><span class="xref-badge-pending">⏳ Room TBA</span></td>
    <td style="font-family:var(--mono);font-size:0.6rem;color:var(--amber);">Pending room assignment at check-in</td>
    <td style="display:flex;gap:5px;align-items:center;">
      <button class="xref-copy-btn" onclick="xrefCopyRow(this,'TBA','${escapeHtml(a.name)}','${escapeHtml(a.source)}','${a.nights}N','No room yet')">📋</button>
      <button class="xref-copy-btn" style="color:var(--rose);border-color:rgba(240,107,122,0.3);" onclick="xrefDeleteRow('${escapeHtml(a.conf || a.name)}','noroom')" title="Remove from list">✕</button>
    </td>
  </tr>`;
}

// ── Quick assign ──────────────────────────────────────────
function xrefQuickAssign(btn, key) {
  const room = prompt('Enter room number:');
  if (!room || !room.trim()) return;
  const roomNum = room.trim().replace(/^0+/, '');
  const rec = _xrefArrNoRoom.find(a => (a.conf || a.name) === key);
  if (!rec) return;
  rec.room = roomNum;
  _xrefArrNoRoom = _xrefArrNoRoom.filter(a => a !== rec);
  _xrefArrRooms.push(rec);
  _xrefCheckExtension(rec);
  xrefRender();
  showToast(`Room ${roomNum} assigned${rec.isExtension ? ' — ↪ Extension detected!' : ''}`, rec.isExtension ? 'ok' : 'info');
}

// ── Copy single row ───────────────────────────────────────
function xrefCopyRow(btn, room, name, source, stay, type) {
  const text = `Room ${room} · ${name} · ${source} · ${stay} · ${type}`;
  copyToClipboard(text, null, '');
  btn.textContent = '✅';
  setTimeout(() => { btn.textContent = '📋'; }, 2000);
}

// ── Delete a row from the list ────────────────────────────
function xrefDeleteRow(key, listType) {
  if (listType === 'room') {
    _xrefArrRooms = _xrefArrRooms.filter(a => (a.conf || a.name) !== key);
  } else {
    _xrefArrNoRoom = _xrefArrNoRoom.filter(a => (a.conf || a.name) !== key);
  }
  document.querySelectorAll('.xref-dep-strip').forEach(s => s.remove());
  xrefRender();
}

// ── Copy extensions list ──────────────────────────────────
function xrefCopyConflicts() {
  const list = _xrefArrRooms.filter(a => a.isExtension);
  if (!list.length) { showToast('No extensions found', 'info'); return; }
  const time = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  const lines = [
    `↪ Extensions — ${time}`,
    `${'─'.repeat(55)}`,
    `Room    Guest                    Nights  Source`,
    `${'─'.repeat(55)}`,
    ...list.map(a => `${a.room.padEnd(8)}${a.name.substring(0,24).padEnd(24)} ${String(a.nights+'N').padEnd(8)}${a.source}`),
    `${'─'.repeat(55)}`,
    `${list.length} room${list.length > 1 ? 's' : ''} with extension bookings`,
  ];
  copyToClipboard(lines.join('\n'), null, '');
  showToast(`${list.length} extension${list.length > 1 ? 's' : ''} copied ✓`, 'ok');
}

// ── Copy HK priority (extensions need priority turnover) ──
function xrefCopyHKPriority() {
  const list = _xrefArrRooms.filter(a => a.isExtension);
  if (!list.length) { showToast('No extension rooms', 'info'); return; }
  const time = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  const lines = [
    `🏨 *Extension Rooms — ${time}*`,
    `_Guest made new booking — same room_`,
    ``,
    ...list.map(a => `↪ Room ${a.room} · ${a.name} · ${a.nights}N · ${a.source}`),
    ``,
    `${list.length} room${list.length > 1 ? 's' : ''} with extensions`,
  ];
  copyToClipboard(lines.join('\n'), null, '');
  showToast('Extension list copied ✓', 'ok');
}

// ── Copy can extend (now = new arrivals list) ─────────────
function xrefCopyCanExtend() {
  const list = _xrefArrRooms.filter(a => !a.isExtension);
  if (!list.length) { showToast('No new arrivals', 'info'); return; }
  const time = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  const lines = [
    `🛎 New Arrivals — ${time}`,
    `${'─'.repeat(55)}`,
    ...list.map(a => `Room ${a.room.padEnd(6)} · ${a.name.substring(0,24).padEnd(24)} · ${a.nights}N · ${a.source}`),
    `${'─'.repeat(55)}`,
    `${list.length} new arrival${list.length > 1 ? 's' : ''}`,
  ];
  copyToClipboard(lines.join('\n'), null, '');
  showToast(`${list.length} new arrival${list.length > 1 ? 's' : ''} copied ✓`, 'ok');
}

// ── Inject strips into dep board cards ───────────────────
function xrefInjectDepWarnings() { xrefInjectDepStrips(); }
function xrefInjectDepStrips() {
  if (!_xrefLoaded) return;
  _xrefEnrichAll();

  document.querySelectorAll('.dep-card').forEach(card => {
    const roomStr = card.dataset.room;
    if (!roomStr) return;
    const roomNum = roomStr.replace(/^0+/, '');
    card.querySelectorAll('.xref-dep-strip').forEach(s => s.remove());

    const arrival = _xrefArrRooms.find(a => a.room === roomNum);
    if (!arrival) return;

    const body = card.querySelector('.dc-body');
    if (!body) return;

    const isExt = arrival.isExtension;
    const cls   = isExt ? 'xref-dep-strip-ext' : 'xref-dep-strip-new';
    const icon  = isExt ? '↪' : '🛎';
    const label = isExt ? 'EXTENSION BOOKED' : 'NEW ARRIVAL';
    const src   = `${_xrefPlatformIcon(arrival.source)} ${arrival.source}`;

    const strip = document.createElement('div');
    strip.className = `xref-dep-strip ${cls}`;
    strip.innerHTML = `
      <span class="xref-strip-icon">${icon}</span>
      <span class="xref-strip-text">
        ${isExt ? 'EXTENSION' : 'NEW ARRIVAL'} — <strong>${escapeHtml(arrival.name)}</strong>
        · ${arrival.nights}N · ${src}
      </span>
      <span class="xref-strip-badge xref-strip-badge-${isExt ? 'ext' : 'new'}">${label}</span>
    `;
    body.insertBefore(strip, body.firstChild);
  });
}

// ── Clear ─────────────────────────────────────────────────
function xrefClear() {
  _xrefArrRooms  = [];
  _xrefArrNoRoom = [];
  _xrefLoaded    = false;
  _xrefFilter    = 'all';
  _xrefSearch    = '';
  document.getElementById('xrefPasteCard').style.display  = 'block';
  document.getElementById('xrefResultCard').style.display = 'none';
  const reloadBtn = document.getElementById('xrefReloadBtn');
  if (reloadBtn) reloadBtn.style.display = 'none';
  const lbl = document.getElementById('xrefDateLabel');
  if (lbl) lbl.textContent = 'Same guest on arrivals + departures = extension booked · Load dep board first';
  const ta = document.getElementById('xrefInput');
  if (ta) ta.value = '';
  document.querySelectorAll('.xref-dep-strip').forEach(s => s.remove());
  const badge = document.getElementById('badge-xref');
  if (badge) badge.textContent = '0';
  const search = document.getElementById('xrefSearch');
  if (search) search.value = '';
}

// ── escapeHtml ────────────────────────────────────────────
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── CSS ───────────────────────────────────────────────────
(function injectXrefStyles() {
  if (document.getElementById('xrefStyles')) return;
  const style = document.createElement('style');
  style.id = 'xrefStyles';
  style.textContent = `
  .xref-kpi-row { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:16px; }
  .xref-kpi {
    flex:1; min-width:80px;
    background:var(--card); border:1px solid var(--border);
    border-radius:10px; padding:10px 12px; text-align:center;
  }
  .xref-kpi-val { font-size:1.4rem; font-weight:700; font-family:var(--serif); color:var(--text); }
  .xref-kpi-val.red   { color:var(--rose); }
  .xref-kpi-val.amber { color:var(--amber); }
  .xref-kpi-val.green { color:var(--mint); }
  .xref-kpi-val.sky   { color:var(--sky); }
  .xref-kpi-label { font-size:0.56rem; font-family:var(--mono); color:var(--text3); text-transform:uppercase; letter-spacing:0.1em; margin-top:3px; }

  .xref-filters { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:14px; }
  .xref-filter-btn {
    display:inline-flex; align-items:center; gap:5px;
    padding:5px 12px; border-radius:20px; cursor:pointer;
    font-family:var(--mono); font-size:0.62rem; font-weight:600;
    background:var(--bg2); border:1px solid var(--border);
    color:var(--text2); transition:all 0.15s; white-space:nowrap;
  }
  .xref-filter-btn:hover { border-color:var(--amber); color:var(--amber); }
  .xref-filter-btn.on { background:rgba(240,164,58,0.12); border-color:rgba(240,164,58,0.5); color:var(--amber); }
  .xref-filter-count { display:inline-block; background:var(--bg); border-radius:8px; padding:1px 6px; font-size:0.58rem; min-width:16px; text-align:center; }

  .xref-search-wrap { position:relative; margin-bottom:14px; }
  .xref-search-wrap input {
    width:100%; box-sizing:border-box;
    background:var(--bg2); border:1px solid var(--border);
    border-radius:8px; padding:8px 12px 8px 32px;
    font-family:var(--mono); font-size:0.72rem; color:var(--text);
    outline:none; transition:border-color 0.15s;
  }
  .xref-search-wrap input:focus { border-color:rgba(240,164,58,0.5); }
  .xref-search-wrap input::placeholder { color:var(--text3); }
  .xref-search-icon { position:absolute; left:10px; top:50%; transform:translateY(-50%); font-size:0.75rem; pointer-events:none; }

  .xref-action-bar { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; align-items:center; }

  .xref-table { width:100%; border-collapse:collapse; font-size:0.72rem; }
  .xref-section-header td {
    padding:7px 12px; font-family:var(--mono); font-size:0.58rem;
    letter-spacing:0.12em; text-transform:uppercase; font-weight:700;
  }
  .ext-header td    { background:rgba(139,124,248,0.1); color:#8b7cf8; border-bottom:1px solid rgba(139,124,248,0.25); }
  .new-header td    { background:rgba(62,207,142,0.08); color:var(--mint); border-bottom:1px solid rgba(62,207,142,0.2); }
  .noroom-header td { background:rgba(90,180,232,0.07); color:var(--sky); border-bottom:1px solid rgba(90,180,232,0.2); }

  .xref-row td { padding:9px 12px; border-bottom:1px solid var(--border); vertical-align:middle; }
  .xref-ext-row  { background:rgba(139,124,248,0.03); }
  .xref-new-row  { background:transparent; }
  .xref-unassigned { background:rgba(90,180,232,0.02); }

  .xref-room-pill {
    display:inline-block; padding:3px 10px; border-radius:20px;
    font-family:var(--mono); font-size:0.75rem; font-weight:700; letter-spacing:0.05em;
  }
  .xref-room-pill.ext       { background:rgba(139,124,248,0.15); color:#8b7cf8; border:1px solid rgba(139,124,248,0.4); }
  .xref-room-pill.new       { background:rgba(62,207,142,0.12);  color:var(--mint); border:1px solid rgba(62,207,142,0.3); }
  .xref-room-pill.unassigned{ background:rgba(90,180,232,0.1);   color:var(--sky);  border:1px solid rgba(90,180,232,0.3); }

  .xref-arr-name { font-weight:500; color:var(--text); margin-bottom:2px; }
  .xref-subtext  { font-family:var(--mono); font-size:0.6rem; color:var(--text3); }
  .xref-platform { font-family:var(--mono); font-size:0.65rem; color:var(--sky); }

  .xref-badge-ext {
    display:inline-block; padding:3px 9px; border-radius:5px;
    font-family:var(--mono); font-size:0.58rem; font-weight:700; letter-spacing:0.08em;
    background:rgba(139,124,248,0.15); color:#8b7cf8; border:1px solid rgba(139,124,248,0.4);
  }
  .xref-badge-new {
    display:inline-block; padding:3px 9px; border-radius:5px;
    font-family:var(--mono); font-size:0.58rem; font-weight:700; letter-spacing:0.08em;
    background:rgba(62,207,142,0.12); color:var(--mint); border:1px solid rgba(62,207,142,0.3);
  }
  .xref-badge-pending {
    display:inline-block; padding:3px 9px; border-radius:5px;
    font-family:var(--mono); font-size:0.58rem; font-weight:700;
    background:rgba(90,180,232,0.1); color:var(--sky); border:1px solid rgba(90,180,232,0.3);
  }

  .xref-dep-status { font-family:var(--mono); font-size:0.6rem; font-weight:700; letter-spacing:0.08em; display:block; margin-top:2px; }
  .dep-due  { color:var(--amber); }
  .dep-out  { color:var(--mint); }

  .xref-assign-btn {
    display:inline-block; padding:3px 8px; border-radius:5px; cursor:pointer;
    font-family:var(--mono); font-size:0.58rem; font-weight:600;
    background:rgba(240,164,58,0.1); color:var(--amber);
    border:1px solid rgba(240,164,58,0.35); white-space:nowrap; transition:all 0.15s;
  }
  .xref-assign-btn:hover { background:rgba(240,164,58,0.2); }

  .xref-copy-btn {
    display:inline-block; padding:4px 8px; border-radius:5px; cursor:pointer;
    background:var(--bg2); border:1px solid var(--border); color:var(--text3);
    font-size:0.7rem; transition:all 0.15s;
  }
  .xref-copy-btn:hover { border-color:var(--amber); color:var(--amber); }

  /* dep card strips */
  .xref-dep-strip {
    display:flex; align-items:center; gap:8px;
    border-radius:7px; padding:7px 10px; margin-bottom:10px; flex-wrap:wrap;
  }
  .xref-dep-strip-ext { background:rgba(139,124,248,0.1); border:1px solid rgba(139,124,248,0.35); }
  .xref-dep-strip-new { background:rgba(62,207,142,0.08); border:1px solid rgba(62,207,142,0.3); }
  .xref-strip-icon { font-size:0.9rem; flex-shrink:0; }
  .xref-strip-text { font-family:var(--mono); font-size:0.63rem; flex:1; min-width:0; }
  .xref-dep-strip-ext .xref-strip-text { color:#8b7cf8; }
  .xref-dep-strip-new .xref-strip-text { color:var(--mint); }
  .xref-strip-text strong { color:var(--text); }
  .xref-strip-badge {
    display:inline-block; padding:2px 8px; border-radius:4px;
    font-family:var(--mono); font-size:0.55rem; font-weight:700; letter-spacing:0.1em; white-space:nowrap; flex-shrink:0;
  }
  .xref-strip-badge-ext { background:rgba(139,124,248,0.2); border:1px solid #8b7cf8; color:#8b7cf8; }
  .xref-strip-badge-new { background:rgba(62,207,142,0.15); border:1px solid var(--mint); color:var(--mint); }
  `;
  document.head.appendChild(style);
})();

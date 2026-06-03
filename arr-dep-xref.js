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

// ── Extract last name from a full name ────────────────────
// Opera names come as "LASTNAME, FIRSTNAME" or "FIRSTNAME LASTNAME"
// We extract what we believe is the last name / family name.
function _lastName(raw) {
  if (!raw) return '';
  const clean = _normName(raw);
  // Opera format: "lastname, firstname" — comma separated
  if (raw.includes(',')) {
    const parts = clean.split(' ').filter(w => w.length > 1);
    // After normName, comma becomes space. First word = last name in Opera format.
    return parts[0] || '';
  }
  // Plain format: "firstname lastname" — last word is family name
  const parts = clean.split(' ').filter(w => w.length > 1);
  return parts[parts.length - 1] || '';
}

// ── Check if two names belong to the same guest ───────────
// Both inputs can be Opera raw format (LAST,FIRST,Mr.) or parsed (First Last).
// Rule 1: last names match AND are ≥4 chars (avoid "Lee", "Ali" false positives)
// Rule 2: any word ≥6 chars shared between both names (unique surname anywhere)
function _namesMatch(a, b) {
  if (!a || !b) return false;

  const lastA = _lastName(a);
  const lastB = _lastName(b);

  // Primary — last name match, case-insensitive, minimum 4 chars
  if (lastA.length >= 4 && lastA === lastB) return true;

  // Secondary — any long word (≥6 chars) shared between both names
  const wa = _normName(a).split(' ').filter(w => w.length >= 6);
  const wb = _normName(b).split(' ').filter(w => w.length >= 6);
  if (wa.length && wb.length && wa.some(w => wb.includes(w))) return true;

  return false;
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

  // ── Column indexes — verified against real Opera export formats ──
  //
  // res_detail report  (Arrivals — Delimited Data):
  //   DISP_ROOM_NO (15), ROOM_NO (56), FULL_NAME_NO_SHR_IND (26),
  //   CONFIRMATION_NO (21), TRUNC_BEGIN (19), TRUNC_END (20),
  //   NO_OF_NIGHTS (72), ADULTS (49), SHORT_RESV_STATUS (24),
  //   COMPANY_NAME (54), ARRIVAL_TIME1 (27)
  //
  // Opera UI copy-paste (Queue/Arrivals screen):
  //   ROOM (col name), NAME, CONFIRMATION NUMBER (with space), NIGHTS, ARRIVAL
  //
  // departure_all report (Departures — Delimited Data):
  //   ROOM (12), GUEST_NAME (20), COMPUTED_RESV_STATUS_DISPLAY (34)

  const iDispRoom = col('DISP_ROOM_NO');
  // ROOM_NO = res_detail export; ROOM = Opera UI copy-paste
  // Exact match only — includes() would also hit ROOM_TYPE / ROOM_CLASS
  const iRoomNo   = (() => {
    for (const n of ['ROOM_NO', 'ROOM']) { const i = hdrs.indexOf(n); if (i >= 0) return i; }
    return -1;
  })();
  const iName     = col('FULL_NAME_NO_SHR_IND', 'FULL_NAME', 'GUEST_NAME', 'NAME');
  const iNameFb   = col('GUEST_NAME', 'FULL_NAME');
  // CONFIRMATION_NO = res_detail; 'CONFIRMATION NUMBER' (space) = Opera UI paste
  const iConf     = col('CONFIRMATION_NO', 'CONFIRMATION_NUMBER', 'CONFIRM');
  const iConfAlt  = hdrs.findIndex(h => h === 'CONFIRMATION NUMBER');
  // TRUNC_BEGIN = res_detail; ARRIVAL = Opera UI paste / other exports
  const iArr      = col('TRUNC_BEGIN', 'ARRIVAL', 'BEGIN_DATE');
  // TRUNC_END = res_detail; DEPARTURE = other exports
  const iDep      = col('TRUNC_END', 'DEPARTURE');
  // NO_OF_NIGHTS = res_detail (col 72); NIGHTS = Opera UI paste
  const iNights   = col('NO_OF_NIGHTS', 'NIGHTS');
  const iAdults   = col('ADULTS');
  const iStatus   = col('SHORT_RESV_STATUS');
  // res_detail has COMPANY_NAME (col 54) for travel agent / OTA
  const iSource   = col('COMPANY_NAME', 'TRAVEL_AGENT_NAME', 'SOURCE_NAME');
  // ARRIVAL_TIME1 = res_detail (col 27); ARRIVAL_TIME = other exports
  const iArrTime  = col('ARRIVAL_TIME1', 'ARRIVAL_TIME');

  if (iName < 0) return null;

  const seen = new Set();
  const withRoom = [], withoutRoom = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    if (cols.length < 5) continue;

    // SHORT_RESV_STATUS values to SKIP (cancelled / no-show / waitlist only):
    //   C / NC = Cancelled / No-show Cancelled
    //   NS     = No-show
    //   WL     = Waitlist
    // DO NOT skip GCC — "Guaranteed by Credit Card" = active reservation
    // DO NOT skip NON — "Non-guaranteed" = active, just no deposit
    const status = (cols[iStatus] || '').trim().toUpperCase();
    const SKIP_STATUSES = new Set(['C','NC','NS','WL','X','CXL']);
    if (SKIP_STATUSES.has(status)) continue;

    const rawName  = (cols[iName]    || '').trim();
    const rawDispRoom = (cols[iDispRoom]|| '').trim();
    const rawRoomNo   = iRoomNo >= 0 ? (cols[iRoomNo] || '').trim() : '';
    // Strip leading zeros; if the result is empty (e.g. Opera stores '0' or '0000' for unassigned), treat as no room
    const dispRoom    = rawDispRoom.replace(/^0+/, '');
    const roomNo      = rawRoomNo.replace(/^0+/, '');
    const conf     = ((cols[iConf] || '') || (iConfAlt >= 0 ? cols[iConfAlt] : '') || '').trim();
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

    const source = _xrefSource(rawSrc);
    // Only treat as a real room number if the value contains digits.
    // Opera puts literal text like "Assign Room" when no room is pre-assigned —
    // that must go to withoutRoom, not withRoom with a bogus room string.
    const isRealRoom = (r) => !!r && /\d/.test(r);
    const room   = isRealRoom(dispRoom) ? dispRoom : isRealRoom(roomNo) ? roomNo : '';
    const name   = parseName(effectiveName);

    // Final guard — parseName result must be a real name
    if (!name || name === '—' || name.length <= 2) continue;

    // Dedupe key: confirmation number is the cleanest — Opera emits one row per
    // membership type attached to the reservation (A1, ID, etc.) for the same conf.
    // Fall back to room+name when conf is missing.
    const dedupeKey = conf
      ? conf
      : (room ? `${room}|${effectiveName}` : effectiveName);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

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

// ── Normalise room number for comparison ──────────────────
// Opera stores rooms as '0102', '0522' etc. Strip leading zeros
// but keep at least 1 digit so '0' doesn't become ''.
function _normRoom(r) {
  if (!r) return '';
  const s = String(r).trim().replace(/^0+/, '');
  return s || '0';
}

// ── Core logic: is this arrival an extension? ─────────────
//
//  EXTENSION when ANY of:
//   A) Same ROOM NUMBER on both dep board and arrivals list
//      → guest booked same room again (regardless of name match)
//   B) Same LAST NAME found anywhere on dep board
//      → guest made new booking, possibly different room
//      (both conditions checked for all arrivals, with or without room)
//
//  NEW ARRIVAL when:
//   C) Room on dep board but no name match → different guest, room being freed
//   D) No room match and no name match → brand new guest
//
//  result sets on arrRecord:
//   isExtension  — true/false
//   matchType    — 'room' | 'name' | null  (what triggered the match)
//   depGuest     — matching depRooms entry (or null)
//   extReason    — short reason string for UI
function _xrefCheckExtension(arrRecord) {
  if (!depRooms || !depRooms.length) {
    arrRecord.isExtension = false;
    arrRecord.matchType   = null;
    arrRecord.depGuest    = null;
    arrRecord.extReason   = 'Load dep board for verdict';
    return;
  }

  // Use _normRoom so '0102' and '102' compare equal
  const arrRoom = _normRoom(arrRecord.room);

  // ── A) ROOM NUMBER MATCH ──────────────────────────────────
  // Same room on dep board + arrivals = guest re-booked the same room → extension
  // (Primary signal — most reliable. Name match confirms it but is not required.)
  if (arrRoom) {
    const depByRoom = depRooms.find(r =>
      _normRoom(r.roomStr) === arrRoom ||
      _normRoom(String(r.room)) === arrRoom
    );

    if (depByRoom) {
      arrRecord.depGuest    = depByRoom;
      arrRecord.isExtension = true;
      arrRecord.matchType   = 'room';

      // Use rawName (Opera format) for name matching — more reliable than parsed name
      const nameForMatch = arrRecord.rawName || arrRecord.name;
      if (_namesMatch(nameForMatch, depByRoom.name)) {
        arrRecord.extReason = `Room ${arrRoom} · same guest (${parseName(depByRoom.name)}) · ↪ Extension`;
      } else {
        // Different name, same room — could be companion/spouse booking under diff name
        arrRecord.extReason = `Room ${arrRoom} · departing: ${parseName(depByRoom.name)} · incoming: ${arrRecord.name} — verify`;
      }
      return;
    }
  }

  // ── B) NAME MATCH anywhere on dep board ──────────────────
  // Guest booked a new reservation (possibly different room) — same last name found
  const nameForMatch = arrRecord.rawName || arrRecord.name;
  const depByName = depRooms.find(r => _namesMatch(nameForMatch, r.name));
  if (depByName) {
    arrRecord.isExtension = true;
    arrRecord.matchType   = 'name';
    arrRecord.depGuest    = depByName;
    const depRoom = _normRoom(depByName.roomStr || String(depByName.room || ''));
    arrRecord.extReason = arrRoom
      ? `Name match · in room ${depRoom} → new booking room ${arrRoom} · ↪ Extension`
      : `Name match · in room ${depRoom} → ↪ Extension (room TBD)`;
    return;
  }

  // ── C/D) No match → brand new guest ──────────────────────
  arrRecord.isExtension = false;
  arrRecord.matchType   = null;
  arrRecord.depGuest    = null;
  arrRecord.extReason   = arrRoom
    ? `Room ${arrRoom} becomes free · new guest checking in`
    : 'New guest · room not assigned yet';
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
  const extensions      = allRecords.filter(a => a.isExtension).length;
  // New arrivals = assigned rooms where the incoming guest is NOT an extension
  const newArrivals     = _xrefArrRooms.filter(a => !a.isExtension).length;
  const unassigned      = _xrefArrNoRoom.filter(a => !a.isExtension).length;
  const unassignedExt   = _xrefArrNoRoom.filter(a =>  a.isExtension).length;
  const total           = allRecords.length;

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('xref-kpi-total',      total);
  set('xref-kpi-conflict',   extensions);          // ↪ Extensions
  set('xref-kpi-can-extend', newArrivals);          // 🛎 New Arrivals (with room)
  set('xref-kpi-assigned',   _xrefArrRooms.length); // Total with room assigned
  set('xref-kpi-unassigned', unassigned);           // No room yet (new guests)

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

  let badge;
  if (isExt) {
    const matchLabel = a.matchType === 'room' ? '↪ SAME ROOM' : '↪ SAME GUEST';
    badge = `<span class="xref-badge-ext">${matchLabel}</span>`;
  } else {
    badge = `<span class="xref-badge-new">🛎 NEW ARRIVAL</span>`;
  }

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

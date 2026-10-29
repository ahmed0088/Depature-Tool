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
function _xrefNormName(raw) {
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
  const clean = _xrefNormName(raw);
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
  const wa = _xrefNormName(a).split(' ').filter(w => w.length >= 6);
  const wb = _xrefNormName(b).split(' ').filter(w => w.length >= 6);
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
function _xrefNormRoom(r) {
  if (!r) return '';
  const s = String(r).trim().replace(/^0+/, '');
  return s || '0';
}

// ── Core logic: who extended? ─────────────────────────────
//
//  Every departing room is paired with at most ONE arriving booking, and
//  every arrival with at most one departure (best score wins first):
//   100  same full name + same room          → ✓ sure
//    85  same full name, new room not given   → ✓ sure
//    80  same full name, moved to a new room  → ✓ sure (unless two guests share that name → check)
//    60  same room + only the surname matches → ~ check
//    40  only the surname matches             → ~ check
//  A bare room-number coincidence with a different name is routine same-day
//  turnover, not an extension; it is kept as `turnoverDep` for Other details.
//  Departures marked "Extended" on the Departures page with no new booking
//  become "Extended on the same booking" cards (see _adBuild).
//
//  result sets on arrRecord:
//   isExtension  — true/false
//   matchType    — 'room' | 'name' | null
//   depGuest     — matching depRooms entry (or null)
//   extReason    — short reason string for UI
//   adScore / adSure / turnoverDep

// Very common given names / particles: sharing one of these says nothing.
const _AD_COMMON = new Set(['MOHAMMED','MOHAMMAD','MOHAMED','MUHAMMAD','MUHAMMED','MOHAMAD','AHMED','AHMAD','ABDUL','ABDULLAH','ABDULLA',
  'ALI','KHAN','HASSAN','HUSSAIN','HUSSEIN','HUSAIN','KUMAR','SINGH','BIN','BINT','AL','EL','ABU','SYED','SAYED','SHEIKH','SHAIKH','DEVI','BEGUM']);

function _adNameKey(raw) {
  if (typeof _natNameKey === 'function') return _natNameKey(raw);   // arrivals-purpose.js: titles off, words sorted
  return String(raw || '')
    .replace(/\b(MR|MRS|MS|MISS|DR|MSTR|MASTER|PROF|SHEIKH|SHEIKHA)\b\.?/gi, ' ')
    .replace(/[^A-Za-z ]/g, ' ')
    .toUpperCase().split(/\s+/).filter(w => w.length > 1).sort().join(' ');
}

// 2 = same full name (word order and titles ignored), 1 = surname-level, 0 = no
function _adNameLevel(a, b) {
  const wa = _adNameKey(a).split(' ').filter(Boolean);
  const wb = _adNameKey(b).split(' ').filter(Boolean);
  if (!wa.length || !wb.length) return { lvl: 0 };
  const [sm, bg] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  if (sm.length >= 2 && sm.every(w => bg.includes(w))) return { lvl: 2 };
  const shared = wa.filter(w => wb.includes(w) && w.length >= 3 && !_AD_COMMON.has(w));
  if (shared.length >= 2) return { lvl: 2 };
  if (wa.join(' ') === wb.join(' ')) return { lvl: 1, word: wa[0] };          // single-word names
  if (shared.length === 1 && shared[0].length >= 4) return { lvl: 1, word: shared[0] };
  return { lvl: 0 };
}

function _adDepRoom(d) { return _xrefNormRoom(d.roomStr || String(d.room || '')); }
function _adCap(w) { w = String(w || '').toLowerCase(); return w.charAt(0).toUpperCase() + w.slice(1); }

function _xrefCheckExtension(arrRecord) { _xrefEnrichAll(); return arrRecord; }

let _adPairs = [];   // [{arr, dep, score, sure, reason}]
function _xrefEnrichAll() {
  const arrs = [..._xrefArrRooms, ..._xrefArrNoRoom];
  const deps = _adDepList().list;
  arrs.forEach(a => { a.isExtension = false; a.matchType = null; a.depGuest = null; a.extReason = ''; a.adScore = 0; a.adSure = false; a.turnoverDep = null; });
  _adPairs = [];
  if (!deps.length) {
    arrs.forEach(a => { a.extReason = 'Load departures for a verdict'; });
    return;
  }
  const cand = [];
  const fullA = new Map(), fullD = new Map();
  arrs.forEach(a => {
    const ar = a.room ? _xrefNormRoom(a.room) : '';
    deps.forEach(d => {
      const m = _adNameLevel(a.rawName || a.name, d.name);
      const sameRoom = !!ar && ar === _adDepRoom(d);
      if (sameRoom && !m.lvl) { a.turnoverDep = a.turnoverDep || d; return; }
      if (!m.lvl) return;
      let score;
      if (m.lvl === 2) score = sameRoom ? 100 : (!ar ? 85 : 80);
      else score = sameRoom ? 60 : 40;
      if (m.lvl === 2) { fullA.set(a, (fullA.get(a) || 0) + 1); fullD.set(d, (fullD.get(d) || 0) + 1); }
      cand.push({ a, d, score, sameRoom, lvl: m.lvl, word: m.word });
    });
  });
  cand.sort((x, y) => y.score - x.score);
  const usedA = new Set(), usedD = new Set();
  cand.forEach(c => {
    if (usedA.has(c.a) || usedD.has(c.d)) return;
    usedA.add(c.a); usedD.add(c.d);
    const a = c.a, d = c.d, dr = _adDepRoom(d), ar = a.room ? _xrefNormRoom(a.room) : '';
    const twins = c.lvl === 2 && !c.sameRoom && ((fullA.get(a) || 0) > 1 || (fullD.get(d) || 0) > 1);
    let sure = c.score >= 80 && !twins, reason;
    if (c.score === 100)      reason = 'Same name and same room on both lists.';
    else if (twins)           reason = 'Same name, but more than one guest has this name today. Check the right room.';
    else if (c.score === 85)  reason = `Same full name. New booking has no room yet (now in ${dr}).`;
    else if (c.score === 80)  reason = `Same full name. Moves from room ${dr} to ${ar}.`;
    else if (c.score === 60)  reason = `Same room and surname (${_adCap(c.word)}), but the first name is different. Check it is the same guest.`;
    else                      reason = `Only the surname (${_adCap(c.word)}) matches, in a different room. Could be a different guest — check.`;
    a.isExtension = true;
    a.matchType   = c.sameRoom ? 'room' : 'name';
    a.depGuest    = d;
    a.adScore     = c.score;
    a.adSure      = sure;
    a.extReason   = (sure ? '✓ ' : '~ Check · ') + reason;
    _adPairs.push({ arr: a, dep: d, score: c.score, sure, reason });
  });
  arrs.forEach(a => {
    if (a.isExtension) return;
    const ar = a.room ? _xrefNormRoom(a.room) : '';
    a.extReason = a.turnoverDep
      ? `Room ${ar} is leaving today (${parseName(a.turnoverDep.name)}) · new guest`
      : ar ? `Room ${ar} · new guest checking in` : 'New guest · room not assigned yet';
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
  if (lbl) lbl.textContent = `Arrivals report pasted (${total}) · ${new Date().toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' })}`;

  _xrefEnrichAll();
  xrefRender();
  if (typeof depRender === 'function' && !(typeof depIsTyping === 'function' && depIsTyping())) depRender();
  adRender();

  const ext = _adCards.length;
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
  if (input.value !== undefined) setTimeout(() => { try { input.value = ''; } catch (_) {} }, 0);  // the same file can be picked again
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
  // Global search fills this box: make the extension cards follow it too.
  const ad = document.getElementById('adSearch');
  if (ad && document.activeElement !== ad && typeof adSetSearch === 'function') { ad.value = val || ''; adSetSearch(val); }
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
  if (noDep) noDep.style.display = (typeof depRooms === 'undefined' || !depRooms || !depRooms.length) ? '' : 'none';

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
  if (_xrefLoaded) xrefInjectDepStrips();
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
  } else if (a.turnoverDep) {
    depInfo = `
      <div style="font-family:var(--mono);font-size:0.65rem;color:var(--text3);">Departing today</div>
      <div style="font-weight:500;color:var(--amber);font-size:0.72rem;">${escapeHtml(a.turnoverDep.name)}</div>
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
    <td><span class="xref-room-pill ${pillCls}">${escapeHtml(a.room) || '—'}</span></td>
    <td>
      <div class="xref-arr-name">${escapeHtml(a.name)}</div>
      <div class="xref-subtext">${escapeHtml(a.conf) || '—'}${a.adults > 1 ? ` · ${a.adults} pax` : ''}</div>
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
      <button class="xref-copy-btn" onclick="xrefCopyRow(this,'${escapeJsAttr(a.room||'TBA')}','${escapeJsAttr(a.name)}','${escapeJsAttr(a.source)}','${escapeJsAttr(a.nights)}N','${isExt ? 'Extension' : 'New arrival'}')">📋</button>
      <button class="xref-copy-btn" style="color:var(--rose);border-color:rgba(240,107,122,0.3);" onclick="xrefDeleteRow('${escapeJsAttr(a.conf || a.name)}','room')" title="Remove from list">✕</button>
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
        <button class="xref-assign-btn" onclick="xrefQuickAssign(this,'${escapeJsAttr(a.conf || a.name)}')">✏ Assign</button>
      </div>
    </td>
    <td>
      <div class="xref-arr-name">${escapeHtml(a.name)}</div>
      <div class="xref-subtext">${escapeHtml(a.conf) || '—'}${a.adults > 1 ? ` · ${a.adults} pax` : ''}</div>
    </td>
    <td><div class="xref-platform">${icon} ${escapeHtml(a.source)}</div></td>
    <td style="font-family:var(--mono);font-size:0.7rem;color:var(--text2);">
      ${a.arrDate || '—'}<br>
      <span style="font-size:0.62rem;color:var(--text3);">${a.nights}N · out ${a.depDate || '—'}</span>
    </td>
    <td colspan="2"><span class="xref-badge-pending">⏳ Room TBA</span></td>
    <td style="font-family:var(--mono);font-size:0.6rem;color:var(--amber);">Pending room assignment at check-in</td>
    <td style="display:flex;gap:5px;align-items:center;">
      <button class="xref-copy-btn" onclick="xrefCopyRow(this,'TBA','${escapeJsAttr(a.name)}','${escapeJsAttr(a.source)}','${escapeJsAttr(a.nights)}N','No room yet')">📋</button>
      <button class="xref-copy-btn" style="color:var(--rose);border-color:rgba(240,107,122,0.3);" onclick="xrefDeleteRow('${escapeJsAttr(a.conf || a.name)}','noroom')" title="Remove from list">✕</button>
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
  xrefRender(); adRender();
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
  xrefRender(); adRender();
}

// ── Copy extensions list ──────────────────────────────────
function xrefCopyConflicts() {
  const list = [..._xrefArrRooms, ..._xrefArrNoRoom].filter(a => a.isExtension);
  if (!list.length) { showToast('No extensions found', 'info'); return; }
  const time = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  const lines = [
    `↪ Extensions — ${time}`,
    `${'─'.repeat(55)}`,
    `Room    Guest                    Nights  Source`,
    `${'─'.repeat(55)}`,
    ...list.map(a => `${(a.room || 'TBA').padEnd(8)}${a.name.substring(0,24).padEnd(24)} ${String(a.nights+'N').padEnd(8)}${a.source}`),
    `${'─'.repeat(55)}`,
    `${list.length} room${list.length > 1 ? 's' : ''} with extension bookings`,
  ];
  copyToClipboard(lines.join('\n'), null, '');
  showToast(`${list.length} extension${list.length > 1 ? 's' : ''} copied ✓`, 'ok');
}

// ── Copy HK priority (extensions need priority turnover) ──
function xrefCopyHKPriority() {
  const list = [..._xrefArrRooms, ..._xrefArrNoRoom].filter(a => a.isExtension);
  if (!list.length) { showToast('No extension rooms', 'info'); return; }
  const time = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  const lines = [
    `🏨 *Extension Rooms — ${time}*`,
    `_Guest made new booking — same room_`,
    ``,
    ...list.map(a => `↪ Room ${a.room || 'TBA'} · ${a.name} · ${a.nights}N · ${a.source}`),
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
  adSchedule();                       // departures changed → refresh the Extensions list
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
  if (lbl) lbl.textContent = 'Guests leaving today who booked again — found for you';
  const ta = document.getElementById('xrefInput');
  if (ta) ta.value = '';
  document.querySelectorAll('.xref-dep-strip').forEach(s => s.remove());
  const badge = document.getElementById('badge-xref');
  if (badge) badge.textContent = '0';
  const search = document.getElementById('xrefSearch');
  if (search) search.value = '';
  _adArrSig = '';
  adRender();
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

// ═══════════════════════════════════════════════════════════
//  EXTENSIONS VIEW (top of the Arr vs Dep page)
//  Big count + one card per extension. Arrivals come from the pasted
//  report on this page, or — when none is pasted — from the Arrivals page
//  (arrGuests, shared through Firebase). "Mark as checked" is shared per
//  day, per item: arrdep/checked/{date}/{key}.
// ═══════════════════════════════════════════════════════════
let _adArrSig   = '';
let _adSrc      = '';        // 'paste' | 'arrivals' | ''
let _adQ        = '';
let _adChecked  = {};
let _adListenOn = '';
let _adBusy     = false;
let _adRaf      = 0;
let _adShowPaste = false;
let _adCards    = [];

const _adToday = () => typeof hoLocalISO === 'function' ? hoLocalISO() : new Date().toISOString().slice(0, 10);
const _AD_MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const _AD_DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function _adFmt(d) { return d && !isNaN(d) ? `${_AD_DAY[d.getDay()]} ${d.getDate()} ${_AD_MON[d.getMonth()]}` : ''; }
function _adIsoFmt(iso) { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(iso || ''); return m ? _adFmt(new Date(+m[1], m[2] - 1, +m[3])) : (iso || ''); }
function _adParse(s) { try { return typeof parseOperaDate === 'function' ? parseOperaDate(s) : null; } catch (e) { return null; } }
function _adAddDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

// When nothing is pasted here, use today's list from the Arrivals page.
function _adSyncArrivals() {
  if (_xrefLoaded) { _adSrc = 'paste'; return; }
  let g = (typeof arrGuests !== 'undefined' && Array.isArray(arrGuests)) ? arrGuests : [];
  const today = _adToday(), opA = _adOpRead('arrivals');
  // the Arrivals page is empty, or its list is older than Opera's read of today: use what Opera showed
  if (opA && (!g.length || (window._arrDate && window._arrDate < today))) {
    const L = _adOpArrivals(opA, today);
    if (L.length) {
      _adSrc = 'opera';
      const sig = 'op|' + opA.at + '|' + L.length;
      if (sig === _adArrSig) return;
      _adArrSig = sig;
      _xrefArrRooms = L.filter(x => x.room); _xrefArrNoRoom = L.filter(x => !x.room);
      return;
    }
  }
  if (!g.length) {
    if (_adSrc === 'arrivals' || _adSrc === 'opera') { _xrefArrRooms = []; _xrefArrNoRoom = []; }
    _adSrc = ''; _adArrSig = ''; return;
  }
  _adSrc = 'arrivals';
  const sig = g.length + '|' + g.map(x => `${x.room}~${x.name}~${x.conf}~${x.nights}`).join('|');
  if (sig === _adArrSig) return;
  _adArrSig = sig;
  const withRoom = [], withoutRoom = [];
  g.forEach(x => {
    const roomRaw = String(x.room || '').trim().replace(/^0+/, '');
    const room = /\d/.test(roomRaw) ? roomRaw : '';
    const name = String(x.name || '').trim();
    if (!name) return;
    const rec = { room, name: name.replace(/\b\w+/g, w => _adCap(w)), rawName: name, conf: String(x.conf || '').trim(),
      arrDate: '', depDate: '', nights: parseInt(x.nights) || 1, adults: 1, source: x.source || 'Direct', arrTime: '',
      isExtension: false, depGuest: null, _fromArr: true };
    (room ? withRoom : withoutRoom).push(rec);
  });
  _xrefArrRooms = withRoom; _xrefArrNoRoom = withoutRoom;
}

// ── 📡 Opera's reads (opera-bridge.js → window.hoOpera) when the reports are missing or older ──
// Departures: today's board (depRooms) unless it is empty or for an earlier day; then Opera's
// Departures read of today. Arrivals: see _adSyncArrivals. Shown as "from Opera, HH:MM".
let _adOpCache = { t: 0, v: {} };
function _adOpRead(kind) {
  if (typeof hoOpera === 'undefined' || !hoOpera || typeof hoOpera.last !== 'function') return null;
  const now = Date.now();
  if (now - _adOpCache.t > 2000) _adOpCache = { t: now, v: {} };
  if (kind in _adOpCache.v) return _adOpCache.v[kind];
  let L = null;
  try {
    L = hoOpera.last(kind);
    const d = L && L.at ? new Date(L.at) : null, t = _adToday();
    if (!d || isNaN(d) || `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` !== t || !Array.isArray(L.rows)) L = null;
  } catch (e) { L = null; }
  return (_adOpCache.v[kind] = L);
}
function _adOpStamp() { const a = _adOpRead('arrivals'), d = _adOpRead('departures'); return (a ? a.at : '') + '/' + (d ? d.at : ''); }
const _AD_OP_BAD = ['cancelled', 'no_show', 'waitlist'];
const _adOpRoom = r => /^[A-Za-z]?\d{1,5}[A-Za-z]?$/.test(String(r || '').trim());
const _adOpDay = iso => { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(iso || ''); return m ? `${m[3]}-${_AD_MON[+m[2] - 1].toUpperCase()}-${m[1].slice(2)}` : ''; };
/** Opera's Departures read → board-like rooms leaving today (checked out → 'out') */
function _adOpDepartures(read, today) {
  if (!read || !Array.isArray(read.rows)) return [];
  const sameDay = !read.date || read.date === today, seen = new Set();
  return read.rows.filter(r => r && _adOpRoom(r.room) && !_AD_OP_BAD.includes(r.status) && r.status !== 'due_in' && (r.departure ? r.departure === today : sameDay))
    .filter(r => { const k = _xrefNormRoom(r.room) + '|' + (r.conf || r.name); if (seen.has(k)) return false; seen.add(k); return true; })
    .map(r => ({ room: parseInt(r.room, 10) || 0, roomStr: String(r.room).trim(), name: r.name || '', conf: r.conf || '', departure: _adOpDay(today),
      arrival: _adOpDay(r.arrival), nights: r.nights || 0, source: r.agent || r.company || r.source || '', status: r.status === 'checked_out' ? 'out' : 'due', _fromOpera: true }));
}
/** Opera's Arrivals read → this page's arrival records (cancelled / no-show left out) */
function _adOpArrivals(read, today) {
  if (!read || !Array.isArray(read.rows)) return [];
  const sameDay = !read.date || read.date === today;
  return read.rows.filter(r => r && r.name && !_AD_OP_BAD.includes(r.status) && r.status !== 'checked_out' && (r.arrival ? r.arrival === today : sameDay)).map(r => {
    const room = _adOpRoom(r.room) ? _xrefNormRoom(r.room) : '';
    const clean = String(r.name).includes(',') ? String(r.name).split(',').map(x => x.trim()).filter(x => x && !/^(mr|mrs|ms|miss|dr)\.?$/i.test(x)).slice(0, 2).reverse().join(' ') : String(r.name).trim();
    return { room, name: clean.toLowerCase().replace(/\b\w+/g, w => _adCap(w)), rawName: r.name, conf: String(r.conf || '').trim(), arrDate: _adOpDay(r.arrival || today),
      depDate: _adOpDay(r.departure), nights: r.nights || 1, adults: r.adults || 1, source: r.agent || r.company || r.source || 'Direct', arrTime: '', isExtension: false, depGuest: null, _fromOpera: true };
  });
}
/** the departures this page compares: {list, src: 'board' | 'opera' | '', at} */
let _adDepMemo = { k: '', v: null };
function _adDepList() {
  const B = (typeof depRooms !== 'undefined' && Array.isArray(depRooms)) ? depRooms : [];
  const today = _adToday(), old = !B.length || (window._depDate && window._depDate < today);
  const R = old ? _adOpRead('departures') : null;
  if (!R) return { list: B, src: B.length ? 'board' : '', at: 0 };
  const k = R.at + '|' + B.length + '|' + today;
  if (_adDepMemo.k === k) return _adDepMemo.v;
  const L = _adOpDepartures(R, today);
  const v = L.length ? { list: L, src: 'opera', at: R.at } : { list: B, src: B.length ? 'board' : '', at: 0 };
  _adDepMemo = { k, v };
  return v;
}
const _adHHMM = at => { try { return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };

function _adKeyOf(c) {
  return (c.kind + '_' + (c.oldRoom || 'x') + '_' + (c.newConf || c.newRoom || _adNameKey(c.name).replace(/ /g, '-') || 'x'))
    .replace(/[.#$\[\]\/\s]/g, '_').slice(0, 120);
}

function _adBuild() {
  const cards = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  _adPairs.forEach(p => {
    const a = p.arr, d = p.dep;
    let out = _adParse(a.depDate);
    if (!out && a.nights) out = _adAddDays(today, a.nights);
    const st = d.status || 'due';
    const c = {
      kind: 'new', sure: p.sure, score: p.score, reason: p.reason,
      name: a.name || parseName(d.name), depName: parseName(d.name),
      oldRoom: _adDepRoom(d), newRoom: a.room ? _xrefNormRoom(a.room) : '',
      oldConf: String(d.conf || d.confNo || d.confirmation || '').trim(), newConf: a.conf || '',
      nights: a.nights || 0, out: _adFmt(out), source: a.source || '',
      note: st === 'out' ? 'Marked checked out on Departures' : st === 'extended' ? 'Also marked Extended on Departures' : '',
    };
    cards.push(c);
  });
  const paired = new Set(_adPairs.map(p => p.dep));
  const deps = _adDepList().list;
  deps.forEach(d => {
    if (d.status !== 'extended' || paired.has(d)) return;
    const base = _adParse(d.departure);
    const n = parseInt(d.extensionNights) || 0;
    cards.push({
      kind: 'same', sure: true, score: 90,
      reason: 'Marked Extended on the Departures page. Same booking — no new confirmation.',
      name: parseName(d.name), depName: parseName(d.name), oldRoom: _adDepRoom(d), newRoom: _adDepRoom(d),
      oldConf: String(d.conf || d.confNo || d.confirmation || '').trim(), newConf: '',
      nights: n, out: base && n ? _adFmt(_adAddDays(base, n)) : '', source: d.source || '',
      note: d.extConfirmed ? '✓ Opera updated' : '⚠ Opera not updated yet',
    });
  });
  cards.forEach(c => { c.key = _adKeyOf(c); c.checked = _adChecked[c.key] || null; });
  cards.sort((x, y) => (!!x.checked - !!y.checked) || (y.sure - x.sure) || (y.score - x.score) ||
    String(x.oldRoom).localeCompare(String(y.oldRoom), undefined, { numeric: true }));
  return cards;
}

function _adListen() {
  const date = _adToday();
  if (_adListenOn === date || typeof fbListen !== 'function') return;
  _adListenOn = date;
  try {
    fbListen('arrdep/checked/' + date, v => {
      if (_adListenOn !== date) return;
      _adChecked = (v && typeof v === 'object') ? v : {};
      adSchedule();
    });
  } catch (e) { /* offline: checks stay local */ }
}

function adSchedule() {
  if (_adBusy || _adRaf) return;
  _adRaf = requestAnimationFrame(() => { _adRaf = 0; adRender(); });
}

function _adMount() {
  const host = document.getElementById('adHero');
  if (!host || host.dataset.ready) return host;
  host.dataset.ready = '1';
  host.innerHTML = `
    <section class="ad-hero card">
      <div class="ad-hero-row">
        <div class="ad-hero-ico" aria-hidden="true">🔁</div>
        <div class="ad-hero-main">
          <div class="ad-hero-k">Extensions today</div>
          <div class="ad-hero-n"><span id="adCount">0</span><span class="ad-hero-date" id="adDate"></span></div>
        </div>
        <div class="ad-hero-acts">
          <button class="ad-btn" onclick="adCopyAll()" id="adCopyAllBtn">📋 Copy list</button>
        </div>
      </div>
      <div class="ad-chips" id="adChips"></div>
      <div class="ad-src" id="adSrc"></div>
      <div class="ad-search">
        <span class="ad-search-ico" aria-hidden="true">🔍</span>
        <input id="adSearch" type="search" autocomplete="off" placeholder="Search room, name or confirmation" oninput="adSetSearch(this.value)"/>
      </div>
    </section>
    <div class="ad-list" id="adList"></div>`;
  return host;
}

function _adSrcHtml(nDep, nArr) {
  const dDate = window._depDate || '';
  const aDate = window._arrDate || '';
  const today = _adToday();
  const DL = _adDepList(), opA = _adSrc === 'opera' ? _adOpRead('arrivals') : null;
  const depTxt = nDep && DL.src === 'opera' ? `🚪 Departures: <b>${nDep}</b> room${nDep > 1 ? 's' : ''} <em class="ad-op">📡 from Opera, ${escapeHtml(_adHHMM(DL.at))}</em>`
    : nDep ? `🚪 Departures: <b>${nDep}</b> room${nDep > 1 ? 's' : ''}${dDate && dDate !== today ? ` <em class="ad-warn">for ${escapeHtml(_adIsoFmt(dDate))}, not today</em>` : ''}`
                      : `🚪 Departures: <b class="ad-miss">not loaded</b>`;
  const arrFrom = _adSrc === 'paste' ? 'pasted here' : _adSrc === 'arrivals' ? 'from the Arrivals page' : _adSrc === 'opera' ? `<em class="ad-op">📡 from Opera, ${escapeHtml(_adHHMM(opA && opA.at))}</em>` : '';
  const arrTxt = nArr ? `🛎 Arrivals: <b>${nArr}</b> ${arrFrom}${_adSrc === 'arrivals' && aDate && aDate !== today ? ` <em class="ad-warn">for ${escapeHtml(_adIsoFmt(aDate))}, not today</em>` : ''}`
                      : `🛎 Arrivals: <b class="ad-miss">not loaded</b>`;
  const paste = _adSrc === 'arrivals' || _adSrc === 'opera'
    ? `<button class="ad-link" onclick="adTogglePaste()">${_adShowPaste ? 'Hide paste box' : 'Paste a different report'}</button>` : '';
  return `<span>${depTxt}</span><span>${arrTxt}</span>${paste}`;
}

function _adEmptyHtml(nDep, nArr) {
  const steps = [];
  if (!nDep) steps.push(`<li><b>Load today's departures.</b> Open <button class="ad-link" onclick="showPanel('departures')">🚪 Departures</button> and paste the Opera departures report (Delimited Data).</li>`);
  if (!nArr) steps.push(`<li><b>Load today's arrivals.</b> Paste the Opera arrivals report in the box below, or load it on the <button class="ad-link" onclick="showPanel('arrivals')">🛎 Arrivals</button> page.</li>`);
  if (steps.length) {
    const what = !nDep && !nArr ? 'departures and arrivals' : !nDep ? 'departures' : 'arrivals';
    return `<div class="ad-empty"><div class="ad-empty-ico">🧩</div><div class="ad-empty-t">To find extensions, load today's ${what}</div><ol>${steps.join('')}</ol>
      ${nDep && !nArr ? '<div class="ad-empty-s">Rooms marked “Extended” on Departures still show here.</div>' : ''}</div>`;
  }
  return `<div class="ad-empty"><div class="ad-empty-ico">✨</div><div class="ad-empty-t">No extensions found today</div>
    <div class="ad-empty-s">No guest leaving today has a new booking on today's arrivals. Arrivals and departures are in “Other details” below.</div></div>`;
}

function _adConf(label, val, missing) {
  if (!val) return `<div class="ad-conf none"><span class="ad-conf-l">${label}</span><span class="ad-conf-v">${missing}</span></div>`;
  return `<div class="ad-conf"><span class="ad-conf-l">${label}</span><span class="ad-conf-v">${escapeHtml(val)}</span>
    <button class="ad-ico-btn" title="Copy ${label.toLowerCase()}" aria-label="Copy ${label.toLowerCase()}" onclick="adCopy(this,'${escapeJsAttr(val)}')">⧉</button></div>`;
}

function _adCardHtml(c) {
  const moved = c.newRoom && c.oldRoom && c.newRoom !== c.oldRoom;
  const room = moved
    ? `<span class="ad-room">${escapeHtml(c.oldRoom)}</span><span class="ad-arrow">→</span><span class="ad-room new">${escapeHtml(c.newRoom)}</span>`
    : `<span class="ad-room">${escapeHtml(c.oldRoom || c.newRoom || '—')}</span>${c.kind === 'new' && !c.newRoom ? '<span class="ad-arrow">→</span><span class="ad-room tba">New room TBA</span>' : ''}`;
  const verdict = c.sure ? `<span class="ad-chip sure">✓ Sure</span>` : `<span class="ad-chip check">~ Check</span>`;
  const kind = c.kind === 'same' ? `<span class="ad-chip same">Same booking</span>` : `<span class="ad-chip kind">New booking</span>`;
  const other = c.depName && _adNameKey(c.depName) !== _adNameKey(c.name) ? `<div class="ad-was">Leaving guest: ${escapeHtml(c.depName)}</div>` : '';
  const stay = c.kind === 'same'
    ? (c.nights ? `<b>+${c.nights} night${c.nights > 1 ? 's' : ''}</b>${c.out ? ` · new check-out <b>${escapeHtml(c.out)}</b>` : ''}` : 'Extra nights not set yet on Departures')
    : `${c.nights ? `<b>${c.nights} night${c.nights > 1 ? 's' : ''}</b>` : ''}${c.out ? ` · new check-out <b>${escapeHtml(c.out)}</b>` : ''}`;
  const confs = c.kind === 'same'
    ? _adConf('Booking', c.oldConf, 'Same as now')
    : c.oldConf
      ? `${_adConf('Old booking', c.oldConf, '')}<span class="ad-conf-arrow" aria-hidden="true">→</span>${_adConf('New booking', c.newConf, 'Not in arrivals report')}`
      : _adConf('New booking', c.newConf, 'Not in arrivals report');
  const ck = c.checked;
  const ckTxt = ck ? `Checked${ck.by ? ' by ' + escapeHtml(ck.by) : ''}${ck.at ? ' · ' + escapeHtml(String(ck.at).slice(11, 16)) : ''}` : '';
  const k = escapeJsAttr(c.key);
  return `<article class="ad-card ${c.sure ? 'is-sure' : 'is-check'}${ck ? ' is-done' : ''}" data-key="${escapeHtml(c.key)}">
    <div class="ad-card-top">
      <div class="ad-rooms">${room}</div>
      <div class="ad-badges">${verdict}${kind}</div>
    </div>
    <div class="ad-name">${escapeHtml(c.name)}</div>${other}
    <div class="ad-why">${escapeHtml(c.reason)}${c.note ? ` <span class="ad-note">${escapeHtml(c.note)}</span>` : ''}</div>
    <div class="ad-confs">${confs}</div>
    ${stay || c.source ? `<div class="ad-stay">${stay}${c.source ? `<span class="ad-src-chip">${escapeHtml(c.source)}</span>` : ''}</div>` : ''}
    <div class="ad-acts">
      <button class="ad-btn" onclick="adCopyBoth('${k}',this)" title="Copy room, name and confirmation numbers">📋 ${c.oldConf && c.newConf ? 'Copy both' : 'Copy'}</button>
      <button class="ad-btn ${ck ? 'on' : 'primary'}" onclick="adToggleChecked('${k}')">${ck ? '↺ Undo check' : '☑ Mark as checked'}</button>
      ${c.oldRoom ? `<button class="ad-btn ghost" onclick="adOpenDep('${escapeJsAttr(c.oldRoom)}')">🚪 Room ${escapeHtml(c.oldRoom)} on Departures</button>` : ''}
      ${ckTxt ? `<span class="ad-done">✓ ${ckTxt}</span>` : ''}
    </div>
  </article>`;
}

function adRender() {
  if (_adBusy) return;
  _adBusy = true;
  try {
    const host = _adMount();
    if (!host) return;
    _adListen();
    _adSyncArrivals();
    _xrefEnrichAll();
    const deps = _adDepList().list;
    const nArr = _xrefArrRooms.length + _xrefArrNoRoom.length;
    const cards = _adCards = _adBuild();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerHTML = v; };
    set('adCount', String(cards.length));
    set('adDate', escapeHtml(_adFmt(new Date())));
    const nSure = cards.filter(c => c.sure).length, nChk = cards.length - nSure, nDone = cards.filter(c => c.checked).length;
    set('adChips', cards.length ? `<span class="ad-chip sure">✓ ${nSure} sure</span>${nChk ? `<span class="ad-chip check">~ ${nChk} to check</span>` : ''}<span class="ad-chip done">☑ ${nDone} of ${cards.length} checked</span>` : '');
    set('adSrc', _adSrcHtml(deps.length, nArr));
    const btn = document.getElementById('adCopyAllBtn'); if (btn) btn.style.display = cards.length ? '' : 'none';
    const sw = document.querySelector('#adHero .ad-search'); if (sw) sw.style.display = cards.length ? '' : 'none';

    const q = _adQ;
    const vis = q ? cards.filter(c => [c.oldRoom, c.newRoom, c.name, c.depName, c.oldConf, c.newConf].join(' ').toLowerCase().includes(q)) : cards;
    set('adList', !cards.length ? _adEmptyHtml(deps.length, nArr)
      : vis.length ? vis.map(_adCardHtml).join('')
      : `<div class="ad-empty small">No extension matches “${escapeHtml(q)}”.</div>`);

    const badge = document.getElementById('badge-xref');
    if (badge) badge.textContent = String(cards.filter(c => !c.checked).length);

    // Paste box: needed when there are no arrivals, optional when the Arrivals page has them.
    const paste = document.getElementById('xrefPasteCard');
    if (paste) paste.style.display = (_adSrc === '' || ((_adSrc === 'arrivals' || _adSrc === 'opera') && _adShowPaste)) ? 'block' : 'none';
    const res = document.getElementById('xrefResultCard');
    if (res) res.style.display = nArr ? 'block' : 'none';
    const rel = document.getElementById('xrefReloadBtn');
    if (rel) rel.style.display = _adSrc === 'paste' ? '' : 'none';
    if (nArr) xrefRender();
    _adRenderOther(deps);
  } finally { _adBusy = false; }
}

function _adRenderOther(deps) {
  const box = document.getElementById('adDepOnly');
  const paired = new Set(_adPairs.map(p => p.dep));
  const left = deps.filter(d => !paired.has(d) && d.status !== 'extended');
  const turn = [..._xrefArrRooms].filter(a => !a.isExtension && a.turnoverDep);
  const sum = document.getElementById('adOtherSum');
  const nArr = _xrefArrRooms.length + _xrefArrNoRoom.length;
  if (sum) sum.innerHTML = `<span>Other details</span><span class="ad-other-meta">${nArr} arrivals · ${left.length} leaving with no new booking · ${turn.length} same-day room change${turn.length === 1 ? '' : 's'}</span>`;
  if (!box) return;
  const chip = (room, name) => `<span class="ad-mini"><b>${escapeHtml(room)}</b> ${escapeHtml(name)}</span>`;
  box.innerHTML = `
    <div class="ad-sub">
      <div class="ad-sub-h">🚪 Leaving today, no new booking found <span>${left.length}</span></div>
      <div class="ad-mini-wrap">${left.length ? left.map(d => chip(_adDepRoom(d), parseName(d.name))).join('') : '<span class="ad-none">' + (deps.length ? 'None' : 'Departures not loaded') + '</span>'}</div>
    </div>
    <div class="ad-sub">
      <div class="ad-sub-h">🔄 Same room, new guest today (room change-over) <span>${turn.length}</span></div>
      <div class="ad-mini-wrap">${turn.length ? turn.map(a => chip(_xrefNormRoom(a.room), `${parseName(a.turnoverDep.name)} → ${a.name}`)).join('') : '<span class="ad-none">None</span>'}</div>
    </div>`;
}

function adSetSearch(v) { _adQ = String(v || '').toLowerCase().trim(); adRender(); }
function adTogglePaste() { _adShowPaste = !_adShowPaste; adRender(); if (_adShowPaste) setTimeout(() => document.getElementById('xrefInput')?.focus(), 50); }

function adCopy(btn, text) {
  copyToClipboard(String(text), null, '');
  if (btn) { const t = btn.textContent; btn.textContent = '✓'; btn.classList.add('ok'); setTimeout(() => { btn.textContent = t; btn.classList.remove('ok'); }, 1500); }
  if (typeof showToast === 'function') showToast('Copied ' + text, 'ok');
}
function _adLine(c) {
  const room = c.newRoom && c.newRoom !== c.oldRoom ? `${c.oldRoom || '?'} → ${c.newRoom}` : (c.oldRoom || c.newRoom || 'TBA');
  if (c.kind === 'same') return `Room ${room} · ${c.name} · extended on same booking${c.oldConf ? ' ' + c.oldConf : ''}${c.nights ? ' · +' + c.nights + 'N' : ''}${c.out ? ' · out ' + c.out : ''}`;
  return `Room ${room} · ${c.name} · ${c.oldConf ? `old ${c.oldConf} → new ${c.newConf || '—'}` : `new conf ${c.newConf || '—'}`}${c.nights ? ' · ' + c.nights + 'N' : ''}${c.out ? ' · out ' + c.out : ''}${c.sure ? '' : ' · CHECK'}`;
}
function adCopyBoth(key, btn) {
  const c = _adCards.find(x => x.key === key); if (!c) return;
  copyToClipboard(_adLine(c), null, '');
  if (btn) { const t = btn.textContent; btn.textContent = '✓ Copied'; setTimeout(() => { btn.textContent = t; }, 1500); }
}
function adCopyAll() {
  if (!_adCards.length) { showToast('No extensions to copy', 'warn'); return; }
  const lines = [`🔁 Extensions today — ${_adFmt(new Date())} (${_adCards.length})`, ..._adCards.map(c => `${c.sure ? '✓' : '~'} ${_adLine(c)}`)];
  copyToClipboard(lines.join('\n'), null, '');
  showToast(`${_adCards.length} extension${_adCards.length > 1 ? 's' : ''} copied`, 'ok');
}
function adToggleChecked(key) {
  const c = _adCards.find(x => x.key === key); if (!c) return;
  const path = 'arrdep/checked/' + _adToday() + '/' + key;
  const val = c.checked ? null : { by: (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || '', at: _adToday() + 'T' + new Date().toTimeString().slice(0, 5), room: c.oldRoom || c.newRoom || '' };
  // local first so the tick shows at once; Firebase listener confirms
  if (val) _adChecked[key] = val; else delete _adChecked[key];
  try { if (typeof fbSet === 'function') fbSet(path, val); } catch (e) {}
  if (val && typeof logActivity === 'function') { try { logActivity('extension_checked', `Room ${c.oldRoom || c.newRoom} · ${c.name}`); } catch (e) {} }
  adRender();
}
function adOpenDep(room) {
  showPanel('departures');
  const s = document.getElementById('depSearch');
  if (s) { s.value = room; if (typeof depSearchInput === 'function') depSearchInput(); }
}

// Re-draw when the page is opened, and when Arrivals/Departures data changes while it's open.
(function adBoot() {
  const start = () => {
    const panel = document.getElementById('panel-xref');
    if (!panel) return;
    adRender();
    try {
      new MutationObserver(() => { if (panel.classList.contains('active')) adRender(); })
        .observe(panel, { attributes: true, attributeFilter: ['class'] });
    } catch (e) {}
    let last = '';
    setInterval(() => {
      if (!panel.classList.contains('active')) return;
      const d = (typeof depRooms !== 'undefined' && Array.isArray(depRooms)) ? depRooms : [];
      const g = (typeof arrGuests !== 'undefined' && Array.isArray(arrGuests)) ? arrGuests : [];
      const sig = d.length + ':' + d.map(r => r.roomStr + r.status + (r.extensionNights || '')).join(',') + '|' + g.length + ':' + g.map(x => x.room + x.name + x.conf).join(',') + ':' + _adToday() + ':' + _adOpStamp();
      if (sig !== last) { last = sig; adRender(); }
    }, 2500);
    // a new Opera read: draw again soon (the 2.5 s check above sees it too, within the cache time)
    window.addEventListener('message', e => { if (e && e.data && e.data.source === 'ho-op') setTimeout(() => { _adOpCache.t = 0; if (panel.classList.contains('active')) adRender(); }, 700); });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

// ── Extensions view styles ────────────────────────────────
(function adStyles() {
  if (document.getElementById('adStyle')) return;
  const st = document.createElement('style');
  st.id = 'adStyle';
  st.textContent = `
  #panel-xref { --ad-ok: var(--green, #16a34a); --ad-chk: var(--amber, #d97706); }
  #panel-xref .ad-hero { position:relative; overflow:hidden; padding:18px 18px 14px; margin-bottom:14px; border-radius:var(--r2, 14px);
    background:linear-gradient(135deg, color-mix(in srgb, var(--accent) 14%, var(--card)) 0%, var(--card) 62%); border:1px solid var(--border2); }
  #panel-xref .ad-hero::after { content:''; position:absolute; right:-60px; top:-60px; width:180px; height:180px; border-radius:50%;
    background:radial-gradient(circle, color-mix(in srgb, var(--accent) 22%, transparent), transparent 70%); pointer-events:none; }
  .ad-hero-row { display:flex; align-items:center; gap:14px; position:relative; z-index:1; }
  .ad-hero-ico { width:52px; height:52px; flex:0 0 52px; border-radius:14px; display:grid; place-items:center; font-size:1.55rem;
    background:color-mix(in srgb, var(--accent) 16%, var(--card2)); border:1px solid color-mix(in srgb, var(--accent) 35%, transparent); }
  .ad-hero-main { flex:1; min-width:0; }
  .ad-hero-k { font-size:.72rem; letter-spacing:.12em; text-transform:uppercase; font-weight:700; color:var(--text2); }
  .ad-hero-n { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
  #adCount { font-size:2.6rem; line-height:1.05; font-weight:800; color:var(--text); font-variant-numeric:tabular-nums; letter-spacing:-.02em; }
  .ad-hero-date { font-size:.8rem; color:var(--text3); font-weight:600; }
  .ad-hero-acts { display:flex; gap:8px; flex-shrink:0; }
  .ad-chips { display:flex; gap:6px; flex-wrap:wrap; margin-top:12px; position:relative; z-index:1; }
  .ad-chip { display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:999px; font-size:.7rem; font-weight:700; white-space:nowrap;
    border:1px solid var(--border2); background:var(--card2); color:var(--text2); }
  .ad-chip.sure { color:var(--ad-ok); background:color-mix(in srgb, var(--ad-ok) 12%, var(--card)); border-color:color-mix(in srgb, var(--ad-ok) 35%, transparent); }
  .ad-chip.check { color:var(--ad-chk); background:color-mix(in srgb, var(--ad-chk) 12%, var(--card)); border-color:color-mix(in srgb, var(--ad-chk) 38%, transparent); }
  .ad-chip.same { color:var(--accent); background:color-mix(in srgb, var(--accent) 10%, var(--card)); border-color:color-mix(in srgb, var(--accent) 32%, transparent); }
  .ad-chip.kind, .ad-chip.done { font-weight:600; }
  .ad-src { display:flex; gap:6px 16px; flex-wrap:wrap; align-items:center; margin-top:10px; font-size:.75rem; color:var(--text2); position:relative; z-index:1; }
  .ad-src b { color:var(--text); } .ad-src b.ad-miss { color:var(--red, #dc2626); }
  .ad-warn { font-style:normal; color:var(--ad-chk); font-weight:600; }
  .ad-op { font-style:normal; color:var(--accent); font-weight:600; white-space:nowrap; }
  .ad-link { background:none; border:0; padding:0; font:inherit; color:var(--accent); font-weight:700; cursor:pointer; text-decoration:underline; text-underline-offset:2px; }
  .ad-search { position:relative; margin-top:12px; z-index:1; }
  .ad-search input { width:100%; box-sizing:border-box; padding:11px 12px 11px 36px; border-radius:var(--r, 10px); font-size:.9rem;
    background:var(--bg2); border:1px solid var(--border2); color:var(--text); outline:none; }
  .ad-search input:focus { border-color:var(--accent); box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent); }
  .ad-search-ico { position:absolute; left:12px; top:50%; transform:translateY(-50%); font-size:.85rem; opacity:.7; pointer-events:none; }

  .ad-list { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(100%, 380px), 1fr)); gap:12px; margin-bottom:18px; }
  .ad-card { position:relative; background:var(--card); border:1px solid var(--border2); border-radius:var(--r2, 14px); padding:14px 14px 12px 18px;
    box-shadow:var(--ho-shadow, 0 1px 2px rgba(0,0,0,.08)); min-width:0; transition:opacity .2s, border-color .2s; }
  .ad-card::before { content:''; position:absolute; left:0; top:12px; bottom:12px; width:4px; border-radius:0 4px 4px 0; background:var(--ad-ok); }
  .ad-card.is-check::before { background:var(--ad-chk); }
  .ad-card.is-check { border-color:color-mix(in srgb, var(--ad-chk) 30%, var(--border2)); }
  .ad-card.is-done { opacity:.62; } .ad-card.is-done::before { background:var(--text3); }
  .ad-card-top { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; flex-wrap:wrap; }
  .ad-rooms { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
  .ad-room { font-family:var(--mono); font-weight:800; font-size:1.15rem; padding:2px 10px; border-radius:8px; color:var(--text);
    background:var(--card2); border:1px solid var(--border2); font-variant-numeric:tabular-nums; }
  .ad-room.new { color:var(--accent); border-color:color-mix(in srgb, var(--accent) 45%, transparent); background:color-mix(in srgb, var(--accent) 10%, var(--card)); }
  .ad-room.tba { font-family:inherit; font-size:.72rem; font-weight:700; color:var(--text3); border-style:dashed; }
  .ad-arrow, .ad-conf-arrow { color:var(--text3); font-weight:700; }
  .ad-badges { display:flex; gap:5px; flex-wrap:wrap; }
  .ad-name { margin-top:9px; font-size:1.05rem; font-weight:700; color:var(--text); overflow-wrap:anywhere; }
  .ad-was { font-size:.75rem; color:var(--text3); margin-top:1px; }
  .ad-why { margin-top:5px; font-size:.8rem; color:var(--text2); line-height:1.4; }
  .ad-note { display:inline-block; margin-left:4px; font-size:.7rem; font-weight:700; color:var(--text3); }
  .ad-confs { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:10px; }
  .ad-conf { display:inline-flex; align-items:center; gap:6px; padding:5px 6px 5px 10px; border-radius:9px; background:var(--bg2); border:1px solid var(--border); min-width:0; max-width:100%; }
  .ad-conf.none { padding-right:10px; }
  .ad-conf-l { font-size:.62rem; text-transform:uppercase; letter-spacing:.08em; font-weight:700; color:var(--text3); white-space:nowrap; }
  .ad-conf-v { font-family:var(--mono); font-size:.85rem; font-weight:700; color:var(--text); overflow-wrap:anywhere; }
  .ad-conf.none .ad-conf-v { font-family:inherit; font-size:.72rem; font-weight:500; color:var(--text3); }
  .ad-ico-btn { border:1px solid var(--border2); background:var(--card); color:var(--text2); border-radius:7px; width:28px; height:26px; cursor:pointer; font-size:.85rem; line-height:1; flex-shrink:0; }
  .ad-ico-btn:hover { color:var(--accent); border-color:var(--accent); } .ad-ico-btn.ok { color:var(--ad-ok); border-color:var(--ad-ok); }
  .ad-stay { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:9px; font-size:.8rem; color:var(--text2); }
  .ad-stay b { color:var(--text); }
  .ad-src-chip { font-size:.68rem; font-weight:600; padding:2px 8px; border-radius:999px; background:var(--card2); border:1px solid var(--border); color:var(--text3); }
  .ad-acts { display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-top:12px; padding-top:10px; border-top:1px solid var(--border); }
  .ad-btn { display:inline-flex; align-items:center; gap:5px; padding:7px 11px; border-radius:9px; font-size:.75rem; font-weight:700; cursor:pointer;
    background:var(--card2); border:1px solid var(--border2); color:var(--text); white-space:nowrap; font-family:inherit; }
  .ad-btn:hover { border-color:var(--accent); }
  .ad-btn.primary { background:color-mix(in srgb, var(--accent) 16%, var(--card)); border-color:color-mix(in srgb, var(--accent) 45%, transparent); color:var(--text); }
  .ad-btn.on { color:var(--ad-ok); border-color:color-mix(in srgb, var(--ad-ok) 40%, transparent); }
  .ad-btn.ghost { background:transparent; color:var(--text2); }
  .ad-done { font-size:.72rem; font-weight:700; color:var(--ad-ok); margin-left:auto; }
  .ad-empty { grid-column:1/-1; text-align:center; padding:28px 18px; border:1px dashed var(--border2); border-radius:var(--r2, 14px); background:var(--card); color:var(--text2); }
  .ad-empty.small { padding:16px; font-size:.85rem; }
  .ad-empty-ico { font-size:1.8rem; } .ad-empty-t { font-weight:800; color:var(--text); margin:6px 0 8px; font-size:1rem; }
  .ad-empty ol { text-align:left; max-width:520px; margin:0 auto; padding-left:20px; font-size:.85rem; line-height:1.55; }
  .ad-empty li { margin:4px 0; } .ad-empty-s { font-size:.8rem; color:var(--text3); margin-top:8px; }

  .ad-other { margin-top:6px; border:1px solid var(--border2); border-radius:var(--r2, 14px); background:var(--card); }
  .ad-other > summary { list-style:none; cursor:pointer; padding:13px 16px; display:flex; flex-wrap:wrap; gap:4px 12px; align-items:baseline; font-weight:800; color:var(--text); }
  .ad-other > summary::-webkit-details-marker { display:none; }
  .ad-other > summary::before { content:'▸'; color:var(--text3); transition:transform .15s; display:inline-block; }
  .ad-other[open] > summary::before { transform:rotate(90deg); }
  .ad-other-meta { font-size:.72rem; font-weight:500; color:var(--text3); }
  .ad-other-body { padding:0 14px 14px; min-width:0; }
  .ad-sub { margin-bottom:12px; } .ad-sub-h { font-size:.78rem; font-weight:700; color:var(--text2); margin-bottom:6px; }
  .ad-sub-h span { font-weight:600; color:var(--text3); margin-left:4px; }
  .ad-mini-wrap { display:flex; flex-wrap:wrap; gap:5px; }
  .ad-mini { font-size:.72rem; padding:3px 9px; border-radius:7px; background:var(--bg2); border:1px solid var(--border); color:var(--text2); max-width:100%; overflow-wrap:anywhere; }
  .ad-mini b { font-family:var(--mono); color:var(--text); margin-right:3px; }
  .ad-none { font-size:.75rem; color:var(--text3); }
  #panel-xref .ad-other .xref-kpi-row { margin-top:4px; }

  @media (max-width: 600px) {
    #panel-xref .ad-hero { padding:14px 14px 12px; }
    .ad-hero-ico { width:44px; height:44px; flex-basis:44px; font-size:1.3rem; }
    #adCount { font-size:2.2rem; }
    .ad-hero-acts .ad-btn { padding:7px 9px; }
    .ad-card { padding:12px 12px 10px 15px; }
    .ad-conf-arrow { display:none; }
    .ad-conf { width:100%; box-sizing:border-box; }
    .ad-conf-v { margin-right:auto; }
    .ad-done { margin-left:0; width:100%; }
    #panel-xref .xref-kpi { min-width:calc(33% - 8px); }
  }`;
  document.head.appendChild(st);
})();

// Drop the arrivals file on the upload box
(function () {
  const hook = () => {
    const box = document.getElementById('xrefPasteCard');
    if (!box || box._xrefDrop) return;
    box._xrefDrop = true;
    const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
    let depth = 0;
    box.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; box.classList.add('dp-dragging'); });
    box.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; box.classList.remove('dp-dragging'); } });
    box.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
    box.addEventListener('drop', e => {
      if (!hasFiles(e)) return;
      e.preventDefault(); e.stopPropagation(); depth = 0; box.classList.remove('dp-dragging');
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) xrefLoadFile({ files: [f] });
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook); else hook();
})();

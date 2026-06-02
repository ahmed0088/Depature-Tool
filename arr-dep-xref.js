// ═══════════════════════════════════════════════════════════
//  arr-dep-xref.js  v2  —  Arrivals ↔ Departures Cross-Reference
//
//  NEW in v2:
//  · "Can this guest extend?" answered instantly per room
//  · Extension checker: compares dep board INTENT flag too
//    (maybe_extend / coming_back / returning)
//  · Platform / source displayed on every row
//  · Filter tabs: ALL · CONFLICTS · CAN EXTEND · UNASSIGNED
//  · Search bar: room number, name, confirmation, source
//  · Manual room-assign shortcut for no-room arrivals
//  · "Quick Assign" — type a room number for unassigned guest
//  · Extension verdict badge: ✅ CAN EXTEND / ⛔ NO EXTENSION
//  · Full dep-board injection improved (shows platform + ext verdict)
// ═══════════════════════════════════════════════════════════

let _xrefArrRooms   = [];   // arrivals with room pre-assigned
let _xrefArrNoRoom  = [];   // arrivals without a room yet
let _xrefLoaded     = false;
let _xrefDate       = '';
let _xrefFilter     = 'all';  // 'all' | 'conflicts' | 'can_extend' | 'unassigned'
let _xrefSearch     = '';

// ── Source normaliser (same logic as cleanSource) ─────────
function _xrefSource(raw) {
  if (!raw) return 'Direct';
  const s = raw.trim();
  if (/booking\.com/i.test(s))  return 'Booking.com';
  if (/agoda/i.test(s))         return 'Agoda';
  if (/expedia/i.test(s))       return 'Expedia';
  if (/airbnb/i.test(s))        return 'Airbnb';
  if (/hotels\.com/i.test(s))   return 'Hotels.com';
  if (/trip\.com|ctrip/i.test(s)) return 'Trip.com';
  if (/travco/i.test(s))        return 'Travco';
  if (/dnata/i.test(s))         return 'Dnata';
  if (/almosafer/i.test(s))     return 'Almosafer';
  if (/cleartrip/i.test(s))     return 'Cleartrip';
  if (/makemytrip/i.test(s))    return 'MakeMyTrip';
  if (/corporate|company/i.test(s)) return 'Corporate';
  if (!s || s.length < 2)       return 'Direct';
  // strip legal suffixes
  return s.replace(/\s*(B\.?V\.?|PTE\.? LTD\.?|LLC|INC\.?|LTD\.?)\.?\s*$/i, '').trim() || 'Direct';
}

// Platform icon helper
function _xrefPlatformIcon(source) {
  const icons = {
    'Booking.com': '🔵',
    'Agoda':       '🟠',
    'Expedia':     '🟡',
    'Airbnb':      '🩷',
    'Hotels.com':  '🟣',
    'Trip.com':    '🔴',
    'Direct':      '🏨',
    'Corporate':   '🏢',
    'Travco':      '✈️',
    'Dnata':       '✈️',
    'Almosafer':   '🌙',
  };
  return icons[source] || '📋';
}

// ── Parse arrivals report ──────────────────────────────────
function xrefParseArrivals(raw) {
  const lines = raw.split('\n').map(l => l.trimEnd()).filter(l => l.trim());
  if (lines.length < 2) return null;

  const hdrs = lines[0].split('\t').map(h => h.trim().toUpperCase());
  const col = (...needles) => {
    for (const n of needles) {
      const i = hdrs.indexOf(n);
      if (i >= 0) return i;
    }
    for (const n of needles) {
      const i = hdrs.findIndex(h => h.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };

  const iDispRoom = col('DISP_ROOM_NO');
  const iRoomNo   = col('ROOM_NO');
  const iName     = col('FULL_NAME_NO_SHR_IND', 'FULL_NAME', 'NAME');
  const iConf     = col('CONFIRMATION_NO', 'CONFIRM');
  const iArr      = col('TRUNC_BEGIN', 'ARRIVAL', 'BEGIN_DATE');
  const iDep      = col('TRUNC_END', 'DEPARTURE');
  const iNights   = col('NO_OF_NIGHTS', 'NIGHTS');
  const iAdults   = col('ADULTS');
  const iStatus   = col('SHORT_RESV_STATUS');
  const iSource   = col('COMPANY_NAME', 'TRAVEL_AGENT_NAME', 'SOURCE_NAME');
  const iPayment  = col('PAYMENT_METHOD');
  const iAmount   = col('EFFECTIVE_RATE_AMOUNT', 'SHARE_AMOUNT');
  const iRoomCat  = col('ROOM_CATEGORY_LABEL', 'ROOM_TYPE');
  const iRate     = col('RATE_CODE');
  const iNat      = col('NATIONALITY', 'NATIONALITY_CODE');
  const iArrTime  = col('ARRIVAL_TIME', 'ARRIVAL_TIME1');

  if (iName < 0) return null;

  const seen        = new Set();
  const withRoom    = [];
  const withoutRoom = [];

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
    const payment  = iPayment >= 0 ? (cols[iPayment] || '').trim() : '';
    const amount   = iAmount  >= 0 ? parseFloat(cols[iAmount] || '0') || 0 : 0;
    const roomCat  = iRoomCat >= 0 ? (cols[iRoomCat] || '').trim() : '';
    const rate     = iRate    >= 0 ? (cols[iRate]    || '').trim() : '';
    const nat      = iNat     >= 0 ? (cols[iNat]     || '').trim() : '';
    const rawTime  = iArrTime >= 0 ? (cols[iArrTime] || '').trim() : '';

    if (!rawName) continue;

    const dedupeKey = conf || rawName;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const source  = _xrefSource(rawSrc);
    const room    = dispRoom || roomNo;

    const record = {
      room, name: parseName(rawName), conf,
      arrDate, depDate, nights, adults,
      source, payment, amount, roomCat, rate, nat,
      arrTime: rawTime.replace(/^\*/, '').trim(),
      rawSrc,
      // Will be populated after dep board is loaded:
      canExtend: null,   // true | false | null (unknown — no dep data)
      depIntent: '',     // dep board intent for this room
      depStatus: '',     // dep board status
      depName:   '',     // dep board guest name
    };

    if (room) withRoom.push(record);
    else      withoutRoom.push(record);
  }

  return { withRoom, withoutRoom };
}

// ── Core: can this room extend? ────────────────────────────
// Returns object: { canExtend: bool, reason: string, depRoom: obj|null }
function xrefExtensionVerdict(arrRecord) {
  if (!arrRecord) return { canExtend: null, reason: 'No data', depRoom: null };

  const roomNum = arrRecord.room;
  if (!roomNum) return { canExtend: null, reason: 'No room assigned yet', depRoom: null };

  // Is this room in the departure board at all?
  const depRoom = depRooms.find(r => r.roomStr.replace(/^0+/, '') === roomNum);

  if (!depRoom) {
    // Room not in today's dep board → no conflict → can extend
    return { canExtend: true, reason: 'Room not on today\'s dep board — free to extend', depRoom: null };
  }

  // Room IS on dep board. Check its status.
  const s = depRoom.status;

  if (s === 'out') {
    return { canExtend: true, reason: 'Guest already checked out ✓', depRoom };
  }
  if (s === 'extended') {
    return { canExtend: false, reason: `Room already extended (+${depRoom.extensionNights || 1}N) — check new departure date`, depRoom };
  }
  if (s === 'late') {
    return { canExtend: false, reason: `Room on late checkout until ${depRoom.lateTime} — guest still in room`, depRoom };
  }
  if (s === 'na') {
    return { canExtend: false, reason: 'Room marked N/A — verify with housekeeping', depRoom };
  }

  // Status = 'due' — check intent flag
  if (depRoom.intent === 'maybe_extend') {
    return { canExtend: false, reason: 'Current guest flagged as "May Extend" — confirm checkout first', depRoom };
  }
  if (depRoom.intent === 'coming_back') {
    return { canExtend: false, reason: 'Current guest flagged as "Coming Back" — room blocked', depRoom };
  }
  if (depRoom.intent === 'returning') {
    return { canExtend: false, reason: 'Guest is a returning guest — coordinate carefully', depRoom };
  }

  // Guest is still due to check out — new arrival already assigned → CONFLICT
  return { canExtend: false, reason: 'New arrival assigned to this room — cannot extend current guest', depRoom };
}

// ── Enrich all arrival records with dep-board data ─────────
function _xrefEnrichAll() {
  _xrefArrRooms.forEach(a => {
    const verdict = xrefExtensionVerdict(a);
    a.canExtend = verdict.canExtend;
    a.depRoom   = verdict.depRoom;
    a.extReason = verdict.reason;
    if (verdict.depRoom) {
      a.depIntent = verdict.depRoom.intent || '';
      a.depStatus = verdict.depRoom.status || '';
      a.depName   = verdict.depRoom.name   || '';
    }
  });
}

// ── Get conflict set (arrival room = departure room, guest still in) ──
function xrefGetConflicts() {
  if (!_xrefLoaded || !depRooms.length) return [];
  return _xrefArrRooms.filter(a => a.canExtend === false && a.depRoom);
}

// ── Is this departing room a conflict? ────────────────────
function xrefIsConflict(roomStr) {
  if (!_xrefLoaded) return null;
  const num = roomStr.replace(/^0+/, '');
  return _xrefArrRooms.find(a => a.room === num && a.canExtend === false) || null;
}

// ── Load ──────────────────────────────────────────────────
function xrefLoad() {
  const raw = (document.getElementById('xrefInput')?.value || '').trim();
  if (!raw) { showToast('Paste today\'s arrivals report first', 'err'); return; }

  const result = xrefParseArrivals(raw);
  if (!result) { showToast('Could not parse arrivals — check format', 'err'); return; }

  _xrefArrRooms  = result.withRoom;
  _xrefArrNoRoom = result.withoutRoom;
  _xrefLoaded    = true;
  _xrefDate      = new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });

  const ta = document.getElementById('xrefInput');
  if (ta) ta.value = '';

  document.getElementById('xrefPasteCard').style.display  = 'none';
  document.getElementById('xrefResultCard').style.display = 'block';

  _xrefEnrichAll();
  xrefRender();
  if (typeof depRender === 'function') depRender();

  const conflicts  = xrefGetConflicts().length;
  const canExtend  = _xrefArrRooms.filter(a => a.canExtend === true).length;
  const total      = _xrefArrRooms.length + _xrefArrNoRoom.length;
  let msg = `${total} arrivals loaded`;
  if (conflicts)  msg += ` · ⛔ ${conflicts} conflict${conflicts > 1 ? 's' : ''}`;
  if (canExtend)  msg += ` · ✅ ${canExtend} extendable`;
  showToast(msg, conflicts ? 'err' : 'ok');
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

// ── Filter helpers ────────────────────────────────────────
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

// ── Apply filters + search to a record list ───────────────
function _xrefApplyFilters(records, type) {
  // type: 'room' | 'noroom'
  return records.filter(a => {
    // Filter tab
    if (_xrefFilter === 'conflicts'  && !(a.canExtend === false && a.depRoom)) return false;
    if (_xrefFilter === 'can_extend' && a.canExtend !== true) return false;
    if (_xrefFilter === 'unassigned' && type !== 'noroom') return false;
    if (_xrefFilter === 'unassigned' && type === 'noroom') { /* keep */ }

    // Search
    if (_xrefSearch) {
      const hay = [a.room, a.name, a.conf, a.source, a.depName, a.roomCat].join(' ').toLowerCase();
      if (!hay.includes(_xrefSearch)) return false;
    }
    return true;
  });
}

// ── Render ────────────────────────────────────────────────
function xrefRender() {
  _xrefEnrichAll();

  const conflicts  = xrefGetConflicts().length;
  const canExtend  = _xrefArrRooms.filter(a => a.canExtend === true).length;
  const unassigned = _xrefArrNoRoom.length;
  const total      = _xrefArrRooms.length + unassigned;

  // KPI
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('xref-kpi-conflict',   conflicts);
  set('xref-kpi-can-extend', canExtend);
  set('xref-kpi-assigned',   _xrefArrRooms.length);
  set('xref-kpi-unassigned', unassigned);
  set('xref-kpi-total',      total);

  const badge = document.getElementById('badge-xref');
  if (badge) badge.textContent = conflicts || total || '0';

  // Filter tab counts
  const _fCount = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
  _fCount('xref-fc-all',        total);
  _fCount('xref-fc-conflicts',  conflicts);
  _fCount('xref-fc-can-extend', canExtend);
  _fCount('xref-fc-unassigned', unassigned);

  // No-dep-board warning
  const noDep = document.getElementById('xrefNoteNoDep');
  if (noDep) noDep.style.display = (!depRooms || !depRooms.length) ? '' : 'none';

  const tbody = document.getElementById('xrefTable');
  if (!tbody) return;

  // Apply filter
  const visRooms   = _xrefFilter === 'unassigned' ? [] : _xrefApplyFilters(_xrefArrRooms, 'room');
  const visNoRoom  = _xrefFilter !== 'conflicts' && _xrefFilter !== 'can_extend'
    ? _xrefApplyFilters(_xrefArrNoRoom, 'noroom')
    : [];

  if (!visRooms.length && !visNoRoom.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;font-family:var(--mono);font-size:0.7rem;color:var(--text3);">No results match this filter.</td></tr>`;
    return;
  }

  let html = '';

  // ── Assigned rooms ─────────────────────────────────────
  if (visRooms.length) {
    // Group: conflicts first, then can-extend, then others
    const rowConflicts = visRooms.filter(a => a.canExtend === false && a.depRoom);
    const rowSafe      = visRooms.filter(a => a.canExtend === true);
    const rowUnknown   = visRooms.filter(a => a.canExtend === null);

    if (rowConflicts.length) {
      html += _xrefSectionHeader('conflict', `⛔ CANNOT EXTEND — ${rowConflicts.length} room${rowConflicts.length > 1 ? 's' : ''} — current guest STILL IN ROOM`);
      rowConflicts.forEach(a => { html += _xrefRow(a, 'conflict'); });
    }
    if (rowSafe.length) {
      html += _xrefSectionHeader('safe', `✅ CAN EXTEND — ${rowSafe.length} room${rowSafe.length > 1 ? 's' : ''} — room available for extension`);
      rowSafe.forEach(a => { html += _xrefRow(a, 'safe'); });
    }
    if (rowUnknown.length) {
      html += _xrefSectionHeader('unassigned', `⚠ VERIFY — ${rowUnknown.length} room${rowUnknown.length > 1 ? 's' : ''} — not on departure board`);
      rowUnknown.forEach(a => { html += _xrefRow(a, 'unknown'); });
    }
  }

  // ── Unassigned arrivals ─────────────────────────────────
  if (visNoRoom.length) {
    html += _xrefSectionHeader('noroom', `🏷 NO ROOM ASSIGNED — ${visNoRoom.length} arrival${visNoRoom.length > 1 ? 's' : ''} — assign room at check-in`);
    visNoRoom.forEach(a => { html += _xrefNoRoomRow(a); });
  }

  tbody.innerHTML = html;
  xrefInjectDepWarnings();
}

// ── Section header row ─────────────────────────────────────
function _xrefSectionHeader(type, label) {
  const cls = {
    conflict:   'conflict-header',
    safe:       'safe-header',
    unassigned: 'unassigned-header',
    noroom:     'noroom-header',
    unknown:    'unknown-header',
  }[type] || 'unassigned-header';
  return `<tr class="xref-section-header ${cls}"><td colspan="8">${label}</td></tr>`;
}

// ── Table row for assigned-room arrival ───────────────────
function _xrefRow(a, rowType) {
  const icon       = _xrefPlatformIcon(a.source);
  const extBadge   = _xrefExtBadge(a);
  const depInfo    = _xrefDepInfo(a);
  const rowCls     = { conflict:'xref-conflict', safe:'xref-safe', unknown:'xref-safe' }[rowType] || '';
  const roomPill   = { conflict:'conflict', safe:'safe', unknown:'unassigned' }[rowType] || 'unassigned';

  return `<tr class="xref-row ${rowCls}">
    <td><span class="xref-room-pill ${roomPill}">${a.room}</span></td>
    <td>
      <div class="xref-arr-name">${escapeHtml(a.name)}</div>
      <div class="xref-subtext">${a.conf || '—'}${a.adults > 1 ? ` · ${a.adults} pax` : ''}</div>
    </td>
    <td>
      <div class="xref-platform">${icon} ${escapeHtml(a.source)}</div>
      ${a.rate ? `<div class="xref-subtext">${escapeHtml(a.rate)}</div>` : ''}
    </td>
    <td style="font-family:var(--mono);font-size:0.7rem;color:var(--text2);">
      ${a.arrDate || '—'}<br>
      <span style="font-size:0.62rem;color:var(--text3);">${a.nights}N · out ${a.depDate || '—'}</span>
    </td>
    <td>${depInfo}</td>
    <td>${extBadge}</td>
    <td style="font-family:var(--mono);font-size:0.6rem;color:var(--text3);max-width:160px;word-break:break-word;">${escapeHtml(a.extReason || '')}</td>
    <td>
      <button class="xref-copy-btn" onclick="xrefCopyRow(this,'${escapeHtml(a.room)}','${escapeHtml(a.name)}','${escapeHtml(a.source)}','${a.nights}N','${escapeHtml(a.extReason || '')}')">📋</button>
    </td>
  </tr>`;
}

// ── Table row for unassigned arrival ──────────────────────
function _xrefNoRoomRow(a) {
  const icon = _xrefPlatformIcon(a.source);
  return `<tr class="xref-row xref-unassigned">
    <td>
      <div style="display:flex;align-items:center;gap:6px;">
        <span class="xref-room-pill unassigned">—</span>
        <button class="xref-assign-btn" onclick="xrefQuickAssign(this,'${escapeHtml(a.conf || a.name)}')" title="Quick assign room">✏ Assign</button>
      </div>
    </td>
    <td>
      <div class="xref-arr-name">${escapeHtml(a.name)}</div>
      <div class="xref-subtext">${a.conf || '—'}${a.adults > 1 ? ` · ${a.adults} pax` : ''}</div>
    </td>
    <td>
      <div class="xref-platform">${icon} ${escapeHtml(a.source)}</div>
      ${a.roomCat ? `<div class="xref-subtext">${escapeHtml(a.roomCat)}</div>` : ''}
    </td>
    <td style="font-family:var(--mono);font-size:0.7rem;color:var(--text2);">
      ${a.arrDate || '—'}<br>
      <span style="font-size:0.62rem;color:var(--text3);">${a.nights}N · out ${a.depDate || '—'}</span>
    </td>
    <td colspan="2"><span class="xref-badge-pending">⏳ Room TBA</span></td>
    <td style="font-family:var(--mono);font-size:0.6rem;color:var(--amber);">Pending assignment at check-in</td>
    <td>
      <button class="xref-copy-btn" onclick="xrefCopyRow(this,'TBA','${escapeHtml(a.name)}','${escapeHtml(a.source)}','${a.nights}N','Pending room assignment')">📋</button>
    </td>
  </tr>`;
}

// ── Extension verdict badge ───────────────────────────────
function _xrefExtBadge(a) {
  if (a.canExtend === true)  return `<span class="xref-ext-ok">✅ CAN EXTEND</span>`;
  if (a.canExtend === false) return `<span class="xref-ext-no">⛔ NO EXTENSION</span>`;
  return `<span class="xref-ext-unknown">❓ VERIFY</span>`;
}

// ── Departing guest info cell ─────────────────────────────
function _xrefDepInfo(a) {
  if (!a.depRoom) return `<span style="font-family:var(--mono);font-size:0.65rem;color:var(--text3);">Not on dep board</span>`;
  const r = a.depRoom;
  const statusLabel = {
    due:      '<span class="xref-dep-status dep-due">DUE OUT</span>',
    late:     `<span class="xref-dep-status dep-late">LATE CO ${r.lateTime || ''}</span>`,
    extended: `<span class="xref-dep-status dep-extended">EXTENDED +${r.extensionNights || 1}N</span>`,
    out:      '<span class="xref-dep-status dep-out">CHECKED OUT</span>',
    na:       '<span class="xref-dep-status dep-na">N/A</span>',
  }[r.status] || `<span class="xref-dep-status dep-due">${r.status.toUpperCase()}</span>`;

  const intentBadge = r.intent ? `<div class="xref-intent-badge xref-intent-${r.intent}">${
    {maybe_extend:'↔ May Extend', coming_back:'↩ Coming Back', returning:'↪ Returning'}[r.intent] || r.intent
  }</div>` : '';

  return `<div class="xref-dep-name">${escapeHtml(r.name)}</div>
    ${statusLabel}
    ${intentBadge}`;
}

// ── Quick Assign (manual room entry for unassigned guest) ──
function xrefQuickAssign(btn, key) {
  const room = prompt('Enter room number to assign:');
  if (!room || !room.trim()) return;
  const roomNum = room.trim().replace(/^0+/, '');

  // Find the record
  const rec = _xrefArrNoRoom.find(a => (a.conf || a.name) === key);
  if (!rec) return;

  // Move from no-room to with-room
  rec.room = roomNum;
  _xrefArrNoRoom = _xrefArrNoRoom.filter(a => a !== rec);
  _xrefArrRooms.push(rec);

  const verdict = xrefExtensionVerdict(rec);
  rec.canExtend = verdict.canExtend;
  rec.depRoom   = verdict.depRoom;
  rec.extReason = verdict.reason;
  if (verdict.depRoom) {
    rec.depIntent = verdict.depRoom.intent || '';
    rec.depStatus = verdict.depRoom.status || '';
    rec.depName   = verdict.depRoom.name   || '';
  }

  xrefRender();
  const msg = rec.canExtend === false
    ? `Room ${roomNum} assigned — ⛔ CONFLICT: ${rec.extReason}`
    : `Room ${roomNum} assigned — ✅ clear`;
  showToast(msg, rec.canExtend === false ? 'err' : 'ok');
}

// ── Copy single row ───────────────────────────────────────
function xrefCopyRow(btn, room, name, source, stay, reason) {
  const text = `Room ${room} · ${name} · ${source} · ${stay}\n${reason}`;
  copyToClipboard(text, null, '');
  btn.textContent = '✅';
  setTimeout(() => { btn.textContent = '📋'; }, 2000);
}

// ── Copy conflicts ────────────────────────────────────────
function xrefCopyConflicts() {
  const conflicts = xrefGetConflicts();
  if (!conflicts.length) { showToast('No conflicts to copy', 'info'); return; }
  const time = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  const lines = [
    `⛔ CANNOT EXTEND — Priority Rooms — ${time}`,
    `${'─'.repeat(60)}`,
    `Room    Departing Guest          Arriving Guest           Source`,
    `${'─'.repeat(60)}`,
    ...conflicts.map(a => {
      const dep = a.depRoom ? a.depRoom.name.substring(0,22).padEnd(22) : '—'.padEnd(22);
      return `${a.room.padEnd(8)}${dep}  →  ${a.name.substring(0,22).padEnd(22)}  ${a.source}`;
    }),
    `${'─'.repeat(60)}`,
    `${conflicts.length} room${conflicts.length > 1 ? 's' : ''} — current guest still in — CANNOT EXTEND`,
  ];
  copyToClipboard(lines.join('\n'), null, '');
  showToast(`${conflicts.length} conflict${conflicts.length > 1 ? 's' : ''} copied ✓`, 'ok');
}

// ── Copy HK priority ──────────────────────────────────────
function xrefCopyHKPriority() {
  const conflicts = xrefGetConflicts();
  if (!conflicts.length) { showToast('No priority rooms', 'info'); return; }
  const time = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  const lines = [
    `🏨 *HK Priority Turnaround — ${time}*`,
    `_New arrival assigned — clean ASAP after checkout_`,
    ``,
    ...conflicts.map(a => {
      const src = _xrefPlatformIcon(a.source) + ' ' + a.source;
      return `⛔ Room ${a.room} → ${a.name} · ${a.nights}N · ${src}`;
    }),
    ``,
    `${conflicts.length} room${conflicts.length > 1 ? 's' : ''} require priority turnover`,
  ];
  copyToClipboard(lines.join('\n'), null, '');
  showToast('HK priority list copied ✓', 'ok');
}

// ── Copy can-extend list ───────────────────────────────────
function xrefCopyCanExtend() {
  const list = _xrefArrRooms.filter(a => a.canExtend === true);
  if (!list.length) { showToast('No extendable rooms', 'info'); return; }
  const time = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  const lines = [
    `✅ Rooms Available for Extension — ${time}`,
    `${'─'.repeat(55)}`,
    `Room    Guest                    Source       Reason`,
    `${'─'.repeat(55)}`,
    ...list.map(a => `${a.room.padEnd(8)}${a.name.substring(0,24).padEnd(24)} ${a.source.padEnd(14)} ${a.extReason}`),
    `${'─'.repeat(55)}`,
    `${list.length} room${list.length > 1 ? 's' : ''} — no conflicts`,
  ];
  copyToClipboard(lines.join('\n'), null, '');
  showToast(`${list.length} room${list.length > 1 ? 's' : ''} copied ✓`, 'ok');
}

// ── Inject into dep board cards ───────────────────────────
function xrefInjectDepWarnings() {
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

    const canExt = arrival.canExtend;
    const icon   = canExt === true ? '✅' : '⛔';
    const label  = canExt === true ? 'CAN EXTEND' : 'CANNOT EXTEND';
    const cls    = canExt === true ? 'xref-dep-strip-ok' : 'xref-dep-strip-no';
    const src    = `${_xrefPlatformIcon(arrival.source)} ${arrival.source}`;

    const strip = document.createElement('div');
    strip.className = `xref-dep-strip ${cls}`;
    strip.innerHTML = `
      <span class="xref-strip-icon">${icon}</span>
      <span class="xref-strip-text">
        NEW ARRIVAL — <strong>${escapeHtml(arrival.name)}</strong>
        · ${arrival.nights}N · ${src}
      </span>
      <span class="xref-strip-badge xref-strip-badge-${canExt === true ? 'ok' : 'no'}">${label}</span>
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

  /* ── KPI row ──────────────────────────────────────────── */
  .xref-kpi-row {
    display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px;
  }
  .xref-kpi {
    flex: 1; min-width: 80px;
    background: var(--card); border: 1px solid var(--border);
    border-radius: 10px; padding: 10px 12px; text-align: center;
  }
  .xref-kpi-val { font-size: 1.4rem; font-weight: 700; font-family: var(--serif); color: var(--text); }
  .xref-kpi-val.red   { color: var(--rose); }
  .xref-kpi-val.amber { color: var(--amber); }
  .xref-kpi-val.green { color: var(--mint); }
  .xref-kpi-val.sky   { color: var(--sky); }
  .xref-kpi-label { font-size: 0.56rem; font-family: var(--mono); color: var(--text3); text-transform: uppercase; letter-spacing: 0.1em; margin-top: 3px; }

  /* ── Filter tabs ──────────────────────────────────────── */
  .xref-filters {
    display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px;
  }
  .xref-filter-btn {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 5px 12px; border-radius: 20px; cursor: pointer;
    font-family: var(--mono); font-size: 0.62rem; font-weight: 600;
    background: var(--bg2); border: 1px solid var(--border);
    color: var(--text2); transition: all 0.15s; white-space: nowrap;
    letter-spacing: 0.06em;
  }
  .xref-filter-btn:hover { border-color: var(--amber); color: var(--amber); }
  .xref-filter-btn.on { background: rgba(240,164,58,0.12); border-color: rgba(240,164,58,0.5); color: var(--amber); }
  .xref-filter-btn.on.red { background: rgba(240,107,122,0.12); border-color: rgba(240,107,122,0.5); color: var(--rose); }
  .xref-filter-btn.on.green { background: rgba(62,207,142,0.12); border-color: rgba(62,207,142,0.5); color: var(--mint); }
  .xref-filter-count {
    display: inline-block; background: var(--bg); border-radius: 8px;
    padding: 1px 6px; font-size: 0.58rem; min-width: 16px; text-align: center;
  }

  /* ── Search bar ───────────────────────────────────────── */
  .xref-search-wrap { position: relative; margin-bottom: 14px; }
  .xref-search-wrap input {
    width: 100%; box-sizing: border-box;
    background: var(--bg2); border: 1px solid var(--border);
    border-radius: 8px; padding: 8px 12px 8px 32px;
    font-family: var(--mono); font-size: 0.72rem; color: var(--text);
    outline: none; transition: border-color 0.15s;
  }
  .xref-search-wrap input:focus { border-color: rgba(240,164,58,0.5); }
  .xref-search-wrap input::placeholder { color: var(--text3); }
  .xref-search-icon {
    position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
    font-size: 0.75rem; pointer-events: none;
  }

  /* ── Action bar ───────────────────────────────────────── */
  .xref-action-bar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; align-items: center; }

  /* ── Table ────────────────────────────────────────────── */
  .xref-table { width: 100%; border-collapse: collapse; font-size: 0.72rem; }
  .xref-section-header td {
    padding: 7px 12px; font-family: var(--mono); font-size: 0.58rem;
    letter-spacing: 0.12em; text-transform: uppercase; font-weight: 700;
  }
  .conflict-header td   { background: rgba(240,107,122,0.1); color: var(--rose);  border-bottom: 1px solid rgba(240,107,122,0.2); }
  .safe-header td       { background: rgba(62,207,142,0.08); color: var(--mint);  border-bottom: 1px solid rgba(62,207,142,0.2); }
  .unassigned-header td { background: rgba(240,164,58,0.07); color: var(--amber); border-bottom: 1px solid rgba(240,164,58,0.2); }
  .noroom-header td     { background: rgba(90,180,232,0.07); color: var(--sky);   border-bottom: 1px solid rgba(90,180,232,0.2); }
  .unknown-header td    { background: rgba(139,124,248,0.07); color: var(--violet,#8b7cf8); border-bottom: 1px solid rgba(139,124,248,0.2); }

  .xref-row td { padding: 9px 12px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  .xref-conflict   { background: rgba(240,107,122,0.03); }
  .xref-safe       { background: transparent; }
  .xref-unassigned { background: rgba(90,180,232,0.02); }

  .xref-room-pill {
    display: inline-block; padding: 3px 10px; border-radius: 20px;
    font-family: var(--mono); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.05em;
  }
  .xref-room-pill.conflict   { background: rgba(240,107,122,0.14); color: var(--rose);  border: 1px solid rgba(240,107,122,0.4); }
  .xref-room-pill.safe       { background: rgba(62,207,142,0.12);  color: var(--mint);  border: 1px solid rgba(62,207,142,0.3); }
  .xref-room-pill.unassigned { background: rgba(90,180,232,0.1);   color: var(--sky);   border: 1px solid rgba(90,180,232,0.3); }

  .xref-arr-name { font-weight: 500; color: var(--text); margin-bottom: 2px; }
  .xref-dep-name { font-weight: 500; color: var(--text2); margin-bottom: 2px; font-size: 0.68rem; }
  .xref-subtext  { font-family: var(--mono); font-size: 0.6rem; color: var(--text3); }
  .xref-platform { font-family: var(--mono); font-size: 0.65rem; color: var(--sky); margin-bottom: 2px; }

  /* ── Extension verdict badges ─────────────────────────── */
  .xref-ext-ok, .xref-ext-no, .xref-ext-unknown {
    display: inline-block; padding: 3px 9px; border-radius: 5px;
    font-family: var(--mono); font-size: 0.58rem; font-weight: 700;
    letter-spacing: 0.08em; white-space: nowrap;
  }
  .xref-ext-ok      { background: rgba(62,207,142,0.12);  color: var(--mint);  border: 1px solid rgba(62,207,142,0.3); }
  .xref-ext-no      { background: rgba(240,107,122,0.12); color: var(--rose);  border: 1px solid rgba(240,107,122,0.35); }
  .xref-ext-unknown { background: rgba(240,164,58,0.1);   color: var(--amber); border: 1px solid rgba(240,164,58,0.3); }

  /* ── Pending badge ────────────────────────────────────── */
  .xref-badge-pending {
    display: inline-block; padding: 3px 9px; border-radius: 5px;
    font-family: var(--mono); font-size: 0.58rem; font-weight: 700;
    background: rgba(90,180,232,0.1); color: var(--sky); border: 1px solid rgba(90,180,232,0.3);
  }

  /* ── Dep status ───────────────────────────────────────── */
  .xref-dep-status { font-family: var(--mono); font-size: 0.6rem; font-weight: 700; letter-spacing: 0.08em; display: block; margin-top: 2px; }
  .dep-due      { color: var(--amber); }
  .dep-out      { color: var(--mint); }
  .dep-late     { color: var(--rose); }
  .dep-extended { color: #8b7cf8; }
  .dep-na       { color: var(--text3); }

  /* ── Intent badges ────────────────────────────────────── */
  .xref-intent-badge {
    display: inline-block; margin-top: 3px; padding: 2px 7px; border-radius: 4px;
    font-family: var(--mono); font-size: 0.56rem; font-weight: 600; letter-spacing: 0.08em;
  }
  .xref-intent-maybe_extend  { background: rgba(240,164,58,0.12); color: var(--amber); border: 1px solid rgba(240,164,58,0.3); }
  .xref-intent-coming_back   { background: rgba(90,180,232,0.1);  color: var(--sky);   border: 1px solid rgba(90,180,232,0.3); }
  .xref-intent-returning     { background: rgba(139,124,248,0.1); color: #8b7cf8;      border: 1px solid rgba(139,124,248,0.3); }

  /* ── Quick assign btn ─────────────────────────────────── */
  .xref-assign-btn {
    display: inline-block; padding: 3px 8px; border-radius: 5px; cursor: pointer;
    font-family: var(--mono); font-size: 0.58rem; font-weight: 600;
    background: rgba(240,164,58,0.1); color: var(--amber);
    border: 1px solid rgba(240,164,58,0.35); white-space: nowrap;
    transition: all 0.15s;
  }
  .xref-assign-btn:hover { background: rgba(240,164,58,0.2); }

  /* ── Copy btn ─────────────────────────────────────────── */
  .xref-copy-btn {
    display: inline-block; padding: 4px 8px; border-radius: 5px; cursor: pointer;
    background: var(--bg2); border: 1px solid var(--border); color: var(--text3);
    font-size: 0.7rem; transition: all 0.15s;
  }
  .xref-copy-btn:hover { border-color: var(--amber); color: var(--amber); }

  /* ── Dep card injection strips ────────────────────────── */
  .xref-dep-strip {
    display: flex; align-items: center; gap: 8px;
    border-radius: 7px; padding: 7px 10px; margin-bottom: 10px; flex-wrap: wrap;
  }
  .xref-dep-strip-no {
    background: rgba(240,107,122,0.1); border: 1px solid rgba(240,107,122,0.35);
  }
  .xref-dep-strip-ok {
    background: rgba(62,207,142,0.08); border: 1px solid rgba(62,207,142,0.3);
  }
  .xref-strip-icon { font-size: 0.9rem; flex-shrink: 0; }
  .xref-strip-text { font-family: var(--mono); font-size: 0.63rem; flex: 1; min-width: 0; }
  .xref-dep-strip-no .xref-strip-text  { color: var(--rose); }
  .xref-dep-strip-ok .xref-strip-text  { color: var(--mint); }
  .xref-strip-text strong { color: var(--text); }
  .xref-strip-badge {
    display: inline-block; padding: 2px 8px; border-radius: 4px;
    font-family: var(--mono); font-size: 0.55rem; font-weight: 700;
    letter-spacing: 0.1em; white-space: nowrap; flex-shrink: 0;
  }
  .xref-strip-badge-no { background: rgba(240,107,122,0.2); border: 1px solid var(--rose);  color: var(--rose); }
  .xref-strip-badge-ok { background: rgba(62,207,142,0.15); border: 1px solid var(--mint);  color: var(--mint); }

  /* ── Paste card ───────────────────────────────────────── */
  #xrefPasteCard .upload-textarea { min-height: 120px; }
  `;
  document.head.appendChild(style);
})();

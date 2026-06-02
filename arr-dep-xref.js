// ═══════════════════════════════════════════════════════════
//  arr-dep-xref.js  —  Arrivals ↔ Departures Cross-Reference
//
//  Load today's arrivals report alongside the departure board.
//  Any departing room that already has a new arrival assigned
//  is flagged CANNOT EXTEND — HK priority turnaround.
//  Unassigned arrivals are shown as potential room conflicts.
//
//  Plug-in: no changes to existing modules needed.
//  Just paste today's arrivals Opera report and hit Load.
// ═══════════════════════════════════════════════════════════

let _xrefArrRooms   = [];   // parsed arrival records with room assigned
let _xrefArrNoRoom  = [];   // arrivals without a room yet
let _xrefLoaded     = false;
let _xrefDate       = '';

// ── Parse arrivals report (same format as res_detail_*.txt) ──
function xrefParseArrivals(raw) {
  const lines = raw.split('\n').map(l => l.trimEnd()).filter(l => l.trim());
  if (lines.length < 2) return null;

  const hdrs = lines[0].split('\t').map(h => h.trim().toUpperCase());
  const col  = (...needles) => {
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
  const iRate     = col('RATE_CODE');
  const iSource   = col('COMPANY_NAME');
  const iPayment  = col('PAYMENT_METHOD');
  const iAmount   = col('EFFECTIVE_RATE_AMOUNT', 'SHARE_AMOUNT');
  const iRoomCat  = col('ROOM_CATEGORY_LABEL');

  if (iName < 0) return null;

  const seen    = new Set();
  const withRoom    = [];
  const withoutRoom = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    if (cols.length < 10) continue;

    const status = (cols[iStatus] || '').trim().toUpperCase();
    if (status === 'GCC' || status === 'C') continue; // skip cancelled

    const rawName  = (cols[iName]    || '').trim();
    const dispRoom = (cols[iDispRoom]|| '').trim().replace(/^0+/, ''); // strip leading zeros
    const roomNo   = (cols[iRoomNo]  || '').trim().replace(/^0+/, '');
    const conf     = (cols[iConf]    || '').trim();
    const arrDate  = (cols[iArr]     || '').trim();
    const depDate  = (cols[iDep]     || '').trim();
    const nights   = parseInt(cols[iNights] || '1') || 1;
    const adults   = parseInt(cols[iAdults] || '1') || 1;
    const rate     = (cols[iRate]    || '').trim();
    const source   = (cols[iSource]  || '').trim();
    const payment  = (cols[iPayment] || '').trim();
    const amount   = parseFloat(cols[iAmount] || '0') || 0;
    const roomCat  = (cols[iRoomCat] || '').trim();

    if (!rawName) continue;

    // Dedup by conf + name combo
    const key = conf || rawName;
    if (seen.has(key)) continue;
    seen.add(key);

    const record = {
      room:     dispRoom || roomNo,
      name:     parseName(rawName),
      conf,
      arrDate,
      depDate,
      nights,
      adults,
      rate,
      source:   cleanSource('', source, ''),
      payment,
      amount,
      roomCat,
    };

    if (record.room) {
      withRoom.push(record);
    } else {
      withoutRoom.push(record);
    }
  }

  return { withRoom, withoutRoom };
}

// ── Load arrivals report ──────────────────────────────────
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

  xrefRender();
  // Re-render departures so the new "arrival conflict" badges appear
  if (typeof depRender === 'function') depRender();

  const preAssigned = _xrefArrRooms.length;
  const unassigned  = _xrefArrNoRoom.length;
  const conflicts   = xrefGetConflicts().length;

  let msg = `${preAssigned + unassigned} arrivals loaded`;
  if (conflicts) msg += ` · ⚠ ${conflicts} room conflict${conflicts > 1 ? 's' : ''}`;
  showToast(msg, conflicts ? 'err' : 'ok');
}

// ── File upload ───────────────────────────────────────────
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

// ── Get conflicts: arrival rooms that match departing rooms ─
function xrefGetConflicts() {
  if (!_xrefLoaded || !depRooms.length) return [];
  const depRoomNums = new Set(depRooms.map(r => r.roomStr.replace(/^0+/, '')));
  return _xrefArrRooms.filter(a => depRoomNums.has(a.room));
}

// ── Is this departing room in a conflict? ─────────────────
// Called from departures.js rendering to add the badge
function xrefIsConflict(roomStr) {
  if (!_xrefLoaded) return null;
  const num = roomStr.replace(/^0+/, '');
  return _xrefArrRooms.find(a => a.room === num) || null;
}

// ── Render the xref panel ─────────────────────────────────
function xrefRender() {
  const conflicts   = xrefGetConflicts();
  const safe        = _xrefArrRooms.filter(a => !conflicts.includes(a));
  const unassigned  = _xrefArrNoRoom;

  // Update KPI pills
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('xref-kpi-conflict',   conflicts.length);
  set('xref-kpi-assigned',   _xrefArrRooms.length);
  set('xref-kpi-unassigned', unassigned.length);
  set('xref-kpi-total',      _xrefArrRooms.length + unassigned.length);

  const badge = document.getElementById('badge-xref');
  if (badge) badge.textContent = conflicts.length || (_xrefArrRooms.length + unassigned.length) || '0';

  const tbody = document.getElementById('xrefTable');
  if (!tbody) return;

  if (!conflicts.length && !safe.length && !unassigned.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:36px;font-family:var(--mono);font-size:0.7rem;color:var(--text3);">No arrivals loaded.</td></tr>`;
    return;
  }

  let html = '';

  // ── Section 1: CONFLICT rooms ─────────────────────────
  if (conflicts.length) {
    html += `<tr class="xref-section-header conflict-header">
      <td colspan="7">
        <span class="xref-section-icon">🔴</span>
        PRIORITY TURNAROUND — ${conflicts.length} room${conflicts.length > 1 ? 's' : ''} — NEW ARRIVAL ASSIGNED, CANNOT EXTEND
      </td>
    </tr>`;

    conflicts.forEach(a => {
      const depRoom = depRooms.find(r => r.roomStr.replace(/^0+/,'') === a.room);
      const depName  = depRoom ? depRoom.name  : '—';
      const depStatus= depRoom ? depRoom.status.toUpperCase() : '—';
      const statusCls = depRoom ? `xref-dep-status dep-${depRoom.status}` : '';
      html += `<tr class="xref-row xref-conflict">
        <td><span class="xref-room-pill conflict">${a.room}</span></td>
        <td>
          <div class="xref-arr-name">${escapeHtml(a.name)}</div>
          <div class="xref-subtext">${a.conf || '—'}</div>
        </td>
        <td><span class="xref-badge xref-badge-in">→ ARRIVING</span></td>
        <td>
          <div class="xref-dep-name">${escapeHtml(depName)}</div>
          <span class="${statusCls}">${depStatus}</span>
        </td>
        <td style="font-family:var(--mono);font-size:0.7rem;color:var(--text2);">
          ${a.arrDate || '—'} · ${a.nights}N
        </td>
        <td style="font-family:var(--mono);font-size:0.7rem;color:var(--sky);">${a.source}</td>
        <td>
          <span class="xref-conflict-flag">⚠ NO EXTENSION</span>
        </td>
      </tr>`;
    });
  }

  // ── Section 2: Assigned rooms (no conflict) ────────────
  if (safe.length) {
    html += `<tr class="xref-section-header safe-header">
      <td colspan="7">
        <span class="xref-section-icon">🟢</span>
        PRE-ASSIGNED ROOMS — ${safe.length} arrival${safe.length > 1 ? 's' : ''} — room allocated, no departure conflict
      </td>
    </tr>`;

    safe.forEach(a => {
      html += `<tr class="xref-row xref-safe">
        <td><span class="xref-room-pill safe">${a.room}</span></td>
        <td>
          <div class="xref-arr-name">${escapeHtml(a.name)}</div>
          <div class="xref-subtext">${a.conf || '—'}</div>
        </td>
        <td><span class="xref-badge xref-badge-in">→ ARRIVING</span></td>
        <td style="color:var(--text3);font-size:0.7rem;">Room free</td>
        <td style="font-family:var(--mono);font-size:0.7rem;color:var(--text2);">
          ${a.arrDate || '—'} · ${a.nights}N
        </td>
        <td style="font-family:var(--mono);font-size:0.7rem;color:var(--sky);">${a.source}</td>
        <td style="color:var(--mint);font-family:var(--mono);font-size:0.65rem;">✓ CLEAR</td>
      </tr>`;
    });
  }

  // ── Section 3: Unassigned arrivals ─────────────────────
  if (unassigned.length) {
    html += `<tr class="xref-section-header unassigned-header">
      <td colspan="7">
        <span class="xref-section-icon">🟡</span>
        NO ROOM ASSIGNED — ${unassigned.length} arrival${unassigned.length > 1 ? 's' : ''} — room to be allocated at check-in
      </td>
    </tr>`;

    unassigned.forEach(a => {
      html += `<tr class="xref-row xref-unassigned">
        <td><span class="xref-room-pill unassigned">—</span></td>
        <td>
          <div class="xref-arr-name">${escapeHtml(a.name)}</div>
          <div class="xref-subtext">${a.conf || '—'}</div>
        </td>
        <td><span class="xref-badge xref-badge-in">→ ARRIVING</span></td>
        <td style="color:var(--amber);font-family:var(--mono);font-size:0.65rem;">⏳ Pending assignment</td>
        <td style="font-family:var(--mono);font-size:0.7rem;color:var(--text2);">
          ${a.arrDate || '—'} · ${a.nights}N · ${a.roomCat || '—'}
        </td>
        <td style="font-family:var(--mono);font-size:0.7rem;color:var(--sky);">${a.source}</td>
        <td></td>
      </tr>`;
    });
  }

  tbody.innerHTML = html;

  // Also inject the conflict warning into the departure board
  xrefInjectDepWarnings();
}

// ── Inject conflict warnings into departure board ─────────
// Adds a "🔴 ARRIVAL TODAY" mini-strip inside each conflicted dep card
function xrefInjectDepWarnings() {
  if (!_xrefLoaded) return;
  const conflicts   = xrefGetConflicts();
  const conflictSet = new Set(conflicts.map(a => a.room));

  document.querySelectorAll('.dep-card').forEach(card => {
    const roomStr = card.dataset.room;
    if (!roomStr) return;
    const roomNum = roomStr.replace(/^0+/, '');

    // Remove any previous strip
    card.querySelectorAll('.xref-dep-strip').forEach(s => s.remove());

    if (!conflictSet.has(roomNum)) return;

    const arrival = conflicts.find(a => a.room === roomNum);
    if (!arrival) return;

    // Find a good injection point — after .dc-band
    const body = card.querySelector('.dc-body');
    if (!body) return;

    const strip = document.createElement('div');
    strip.className = 'xref-dep-strip';
    strip.innerHTML = `
      <span class="xref-strip-icon">🔴</span>
      <span class="xref-strip-text">
        NEW ARRIVAL ASSIGNED — <strong>${escapeHtml(arrival.name)}</strong>
        · ${arrival.nights}N · ${arrival.source || '—'}
      </span>
      <span class="xref-strip-badge">CANNOT EXTEND</span>
    `;
    body.insertBefore(strip, body.firstChild);
  });
}

// ── Copy conflict list ────────────────────────────────────
function xrefCopyConflicts() {
  const conflicts = xrefGetConflicts();
  if (!conflicts.length) { showToast('No conflicts to copy', 'info'); return; }
  const time = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  const lines = [
    `🔴 Priority Turnaround Rooms — ${time}`,
    `${'─'.repeat(55)}`,
    `Room   Departing Guest         Arriving Guest`,
    `${'─'.repeat(55)}`,
    ...conflicts.map(a => {
      const dep = depRooms.find(r => r.roomStr.replace(/^0+/,'') === a.room);
      const depName = dep ? dep.name.substring(0,22).padEnd(22) : '—'.padEnd(22);
      return `${a.room.padEnd(7)}${depName}  →  ${a.name}`;
    }),
    `${'─'.repeat(55)}`,
    `${conflicts.length} room${conflicts.length > 1 ? 's' : ''} — DO NOT EXTEND — new arrivals assigned`,
  ];
  copyToClipboard(lines.join('\n'), null, '');
  showToast(`${conflicts.length} conflict${conflicts.length > 1 ? 's' : ''} copied ✓`, 'ok');
}

// ── Copy HK priority list ─────────────────────────────────
function xrefCopyHKPriority() {
  const conflicts = xrefGetConflicts();
  if (!conflicts.length) { showToast('No priority rooms', 'info'); return; }
  const time = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  const lines = [
    `🏨 *HK Priority Rooms — ${time}*`,
    `_New arrivals assigned — clean ASAP_`,
    ``,
    ...conflicts.map(a => `🔴 Room ${a.room} → ${a.name} (${a.nights}N)`),
    ``,
    `${conflicts.length} room${conflicts.length > 1 ? 's' : ''} require priority turnover`,
  ];
  copyToClipboard(lines.join('\n'), null, '');
  showToast('HK priority list copied ✓', 'ok');
}

// ── Reset ─────────────────────────────────────────────────
function xrefClear() {
  _xrefArrRooms  = [];
  _xrefArrNoRoom = [];
  _xrefLoaded    = false;
  document.getElementById('xrefPasteCard').style.display  = 'block';
  document.getElementById('xrefResultCard').style.display = 'none';
  const ta = document.getElementById('xrefInput');
  if (ta) ta.value = '';
  // Remove any strips from dep cards
  document.querySelectorAll('.xref-dep-strip').forEach(s => s.remove());
  const badge = document.getElementById('badge-xref');
  if (badge) badge.textContent = '0';
}

// ── CSS injected at runtime ───────────────────────────────
// (So you don't need to touch styles.css)
(function injectXrefStyles() {
  if (document.getElementById('xrefStyles')) return;
  const style = document.createElement('style');
  style.id = 'xrefStyles';
  style.textContent = `
    /* ── Xref panel ─────────────────────────────────────── */
    .xref-kpi-row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 18px;
    }
    .xref-kpi {
      flex: 1;
      min-width: 90px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px 14px;
      text-align: center;
    }
    .xref-kpi-val {
      font-size: 1.5rem;
      font-weight: 700;
      font-family: var(--serif);
      color: var(--text);
    }
    .xref-kpi-val.red   { color: var(--rose); }
    .xref-kpi-val.amber { color: var(--amber); }
    .xref-kpi-val.green { color: var(--mint); }
    .xref-kpi-label {
      font-size: 0.58rem;
      font-family: var(--mono);
      color: var(--text3);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-top: 3px;
    }

    /* ── Table ───────────────────────────────────────────── */
    .xref-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.72rem;
    }
    .xref-section-header td {
      padding: 8px 12px;
      font-family: var(--mono);
      font-size: 0.6rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      font-weight: 700;
      border-radius: 6px;
    }
    .conflict-header td   { background: rgba(240,107,122,0.12); color: var(--rose); border: 1px solid rgba(240,107,122,0.25); }
    .safe-header td       { background: rgba(62,207,142,0.08);  color: var(--mint); border: 1px solid rgba(62,207,142,0.2); }
    .unassigned-header td { background: rgba(240,164,58,0.08);  color: var(--amber);border: 1px solid rgba(240,164,58,0.2); }
    .xref-section-icon    { margin-right: 6px; }

    .xref-row td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
    }
    .xref-conflict { background: rgba(240,107,122,0.04); }
    .xref-safe     { background: transparent; }
    .xref-unassigned { background: rgba(240,164,58,0.03); }

    .xref-room-pill {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 20px;
      font-family: var(--mono);
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.05em;
    }
    .xref-room-pill.conflict   { background: rgba(240,107,122,0.15); color: var(--rose);  border: 1px solid rgba(240,107,122,0.4); }
    .xref-room-pill.safe       { background: rgba(62,207,142,0.12);  color: var(--mint);  border: 1px solid rgba(62,207,142,0.3); }
    .xref-room-pill.unassigned { background: rgba(240,164,58,0.1);   color: var(--amber); border: 1px solid rgba(240,164,58,0.3); }

    .xref-arr-name { font-weight: 500; color: var(--text); margin-bottom: 2px; }
    .xref-dep-name { font-weight: 500; color: var(--text2); margin-bottom: 2px; font-size: 0.68rem; }
    .xref-subtext  { font-family: var(--mono); font-size: 0.6rem; color: var(--text3); }

    .xref-badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 4px;
      font-family: var(--mono);
      font-size: 0.58rem;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .xref-badge-in  { background: rgba(90,180,232,0.15); color: var(--sky); border: 1px solid rgba(90,180,232,0.3); }

    .xref-dep-status { font-family: var(--mono); font-size: 0.6rem; letter-spacing: 0.08em; }
    .dep-due      { color: var(--amber); }
    .dep-out      { color: var(--mint); }
    .dep-late     { color: var(--rose); }
    .dep-extended { color: var(--violet); }
    .dep-na       { color: var(--text3); }

    .xref-conflict-flag {
      display: inline-block;
      padding: 3px 8px;
      background: rgba(240,107,122,0.15);
      color: var(--rose);
      border: 1px solid rgba(240,107,122,0.4);
      border-radius: 4px;
      font-family: var(--mono);
      font-size: 0.58rem;
      font-weight: 700;
      letter-spacing: 0.1em;
      white-space: nowrap;
    }

    /* ── Departure card injection strip ─────────────────── */
    .xref-dep-strip {
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(240,107,122,0.1);
      border: 1px solid rgba(240,107,122,0.35);
      border-radius: 7px;
      padding: 7px 10px;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }
    .xref-strip-icon { font-size: 0.9rem; flex-shrink: 0; }
    .xref-strip-text {
      font-family: var(--mono);
      font-size: 0.64rem;
      color: var(--rose);
      flex: 1;
      min-width: 0;
    }
    .xref-strip-text strong { color: var(--text); }
    .xref-strip-badge {
      display: inline-block;
      padding: 2px 7px;
      background: rgba(240,107,122,0.2);
      border: 1px solid var(--rose);
      border-radius: 4px;
      font-family: var(--mono);
      font-size: 0.55rem;
      font-weight: 700;
      color: var(--rose);
      letter-spacing: 0.1em;
      white-space: nowrap;
      flex-shrink: 0;
    }

    /* ── Paste card ──────────────────────────────────────── */
    #xrefPasteCard .upload-textarea {
      min-height: 120px;
    }

    /* ── Action bar ──────────────────────────────────────── */
    .xref-action-bar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 16px;
      align-items: center;
    }
    .xref-action-bar .xref-date-lbl {
      font-family: var(--mono);
      font-size: 0.62rem;
      color: var(--text3);
      margin-left: auto;
    }
  `;
  document.head.appendChild(style);
})();

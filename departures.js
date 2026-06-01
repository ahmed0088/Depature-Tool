// ═══════════════════════════════════════════════════════════
//  departures.js  —  Departure follow-up board  v5
//  · Smart Reload / Merge
//  · Extended + Out hidden from All view (undo on card)
//  · Late CO: undo directly on card
//  · Guest intent flags (May Extend / Coming Back / Returning)
//    → auto-stamps a note when intent is set
//  · Balance warning on checkout attempt
//  · Overdue highlight (past 12:00 and still due)
//  · Time-stamped notes
//  · Departure time countdown badge
// ═══════════════════════════════════════════════════════════

// ── HK copy reminder ──────────────────────────────────────
let _hkLastCopy = null;   // Date object of last HK copy
let _hkTickerID = null;

function hkStampCopy() {
  _hkLastCopy = new Date();
  _hkTick();
  if (!_hkTickerID) _hkTickerID = setInterval(_hkTick, 30000);
}

function _hkTick() {
  const el   = document.getElementById('hkReminder');
  const dot  = document.getElementById('hkReminderDot');
  const txt  = document.getElementById('hkReminderText');
  if (!el || !_hkLastCopy) return;

  const mins = Math.floor((Date.now() - _hkLastCopy.getTime()) / 60000);
  const hhmm = _hkLastCopy.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });

  let label, state;
  if (mins < 1)        { label = `Sent just now`;                          state = 'ok'; }
  else if (mins < 30)  { label = `Sent ${mins} min ago · ${hhmm}`;         state = 'ok'; }
  else if (mins < 60)  { label = `⚠ ${mins} min ago · update HK soon`;    state = 'warn'; }
  else                 { label = `🔴 ${mins} min ago · HK needs update!`;  state = 'late'; }

  el.style.display   = 'flex';
  txt.textContent    = label;
  dot.className      = 'hk-reminder-dot hk-dot-' + state;
  el.className       = 'hk-reminder hk-reminder-' + state;
}



// ── Parse raw Opera text ───────────────────────────────────
function parseDepReport(raw) {
  const lines = raw.split('\n').filter(l => l.trim());
  if (lines.length < 2) return null;
  const hdrs = lines[0].split('\t').map(h => h.trim());
  const idx  = {}; hdrs.forEach((h, i) => idx[h] = i);
  if (idx['ROOM'] === undefined) return null;

  const rooms = [];
  for (let i = 1; i < lines.length; i++) {
    const p    = lines[i].split('\t'); if (p.length < 15) continue;
    const room = (p[idx['ROOM']] || '').trim(); if (!room || isNaN(parseInt(room))) continue;
    const bal  = parseFloat((p[idx['BALANCE']] || '0').replace(/,/g, '')) || 0;
    const agent = (p[idx['TRAVEL_AGENT_NAME']] || '').trim();
    const src   = cleanSource(agent, (p[idx['COMPANY_NAME']] || '').trim(), (p[idx['SOURCE_NAME']] || '').trim());
    rooms.push({
      room:            parseInt(room),
      roomStr:         room,
      name:            parseName(p[idx['GUEST_NAME']] || ''),
      arrival:         (p[idx['ARRIVAL']]         || '').trim(),
      departure:       (p[idx['DEPARTURE']]       || '').trim(),
      nights:          parseInt(p[idx['NIGHTS']]  || 0) || 0,
      balance:         bal,
      source:          src,
      company:         (p[idx['COMPANY_NAME']]    || '').trim(),
      rateCode:        (p[idx['RATE_CODE']]       || '').trim(),
      isVip:           !!(p[idx['VIP']]           || '').trim(),
      depTime:         (p[idx['DEPARTURE_TIME']]  || '').trim(),
      // Live tracking
      status:          'due',
      lateTime:        '',
      extensionNights: 0,
      intent:          '',   // '' | 'maybe_extend' | 'coming_back' | 'returning'
      note:            '',
      checkoutAt:      '',
    });
  }
  rooms.sort((a, b) => a.room - b.room);
  return rooms.length ? rooms : null;
}

// ── First load ─────────────────────────────────────────────
function processDep() {
  const raw    = document.getElementById('depInput').value.trim();
  const errBox = document.getElementById('depError');
  errBox.classList.remove('show');
  const showErr = msg => { document.getElementById('depErrorMsg').textContent = msg; errBox.classList.add('show'); };

  if (!raw) return showErr('Please paste the departure report first.');
  const rooms = parseDepReport(raw);
  if (!rooms) return showErr('No departure rooms found. Check ROOM column exists and use Delimited Data format.');

  depRooms = rooms;
  depLog   = [];

  document.getElementById('depInput').value = '';
  const totalToday = depRooms.length;
  document.getElementById('depDateLabel').textContent = `${totalToday} rooms departing · ${depRooms[0]?.departure || ''}`;
  document.getElementById('depBoard').style.display      = 'block';
  document.getElementById('depUploadCard').style.display = 'none';
  ['depPrintBtn','depExportBtn','depViewToggle','depReloadBtn'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = '';
  });

  depRender();
  updateDepBadge();
  saveDepartures(depRooms, depLog).then(() => showToast('Departure board loaded ✓'));
}

// ── Smart Reload / Merge ───────────────────────────────────
// New report from Opera:
//   Rooms that already exist  → keep status, notes, intent, times
//   New rooms in new report   → add as 'due'
//   Rooms gone from Opera     → remove (colleague checked out in system)
function processDepReload() {
  const raw    = document.getElementById('depReloadInput').value.trim();
  const errBox = document.getElementById('depReloadError');
  errBox.classList.remove('show');
  const showErr = msg => { document.getElementById('depReloadErrorMsg').textContent = msg; errBox.classList.add('show'); };

  if (!raw) return showErr('Paste the fresh Opera report first.');
  const freshRooms = parseDepReport(raw);
  if (!freshRooms) return showErr('No rooms found — check the report format.');

  const existing = {};
  depRooms.forEach(r => { existing[r.room] = r; });

  let added = 0, kept = 0, removed = 0;
  const merged = [];

  // Build a lookup from the log so we can restore rooms Opera drops after reload
  // (extended rooms vanish from Opera after the night — log is the only record)
  const logByRoom = {};
  depLog.forEach(l => {
    // Keep only the most recent log entry per room
    if (!logByRoom[l.room]) logByRoom[l.room] = l;
  });

  freshRooms.forEach(fresh => {
    const old = existing[fresh.room];
    if (old) {
      merged.push({
        ...fresh,                          // fresh Opera data: name, balance, dates
        status:          old.status,       // keep all live tracking
        lateTime:        old.lateTime,
        extensionNights: old.extensionNights,
        intent:          old.intent || '',
        note:            old.note,
        checkoutAt:      old.checkoutAt,
        naTime:          old.naTime || '',
        photo:           old.photo  || '',
      });
      kept++;
    } else {
      // New room from Opera — check if it was previously extended/out/late
      // and got dropped from the report. Restore its tracked state from the log.
      const logged = logByRoom[fresh.roomStr || fresh.room];
      if (logged && (logged.action === 'extended' || logged.action === 'out' || logged.action === 'late' || logged.action === 'na')) {
        merged.push({
          ...fresh,
          status:          logged.action,
          extensionNights: logged.extensionNights || 0,
          lateTime:        logged.lateTime        || '',
          checkoutAt:      logged.action === 'out' ? logged.time : '',
          naTime:          logged.action === 'na'  ? logged.time : '',
          intent:          '',
          note:            '',
          photo:           '',
        });
      } else {
        merged.push(fresh);
      }
      added++;
    }
  });

  // Rooms no longer in Opera report — keep if they're checked out / extended / NA
  // so the log and board stay accurate across reloads
  let preserved = 0;
  depRooms.forEach(r => {
    if (!freshRooms.find(f => f.room === r.room)) {
      removed++;
      if (r.status === 'out' || r.status === 'extended' || r.status === 'na') {
        merged.push(r); // preserve — has real tracked checkout/extension data
        preserved++;
      }
    }
  });

  depRooms = merged;
  document.getElementById('depReloadInput').value = '';
  closeReloadModal();
  const sc2 = depCounts();
  const active2 = sc2.due + sc2.late + sc2.na;
  document.getElementById('depDateLabel').textContent = `${active2} active · ${sc2.all} total · ${depRooms.find(r=>r.departure)?.departure || ''}`;

  depRender();
  updateDepBadge();
  const preservedNote = preserved ? ` · ${preserved} CO/ext kept` : '';
  saveDepartures(depRooms, depLog).then(() =>
    showToast(`Reloaded ✓  ${kept} kept · ${added} new · ${removed} dropped${preservedNote}`, 'info')
  );
}

function openReloadModal() {
  document.getElementById('depReloadModal').classList.add('open');
  document.getElementById('depReloadInput').value = '';
  const err = document.getElementById('depReloadError');
  if (err) err.classList.remove('show');
  setTimeout(() => {
    document.getElementById('depReloadInput').focus();
  }, 100);
}

function closeReloadModal() {
  document.getElementById('depReloadModal').classList.remove('open');
}

// ── Counts ─────────────────────────────────────────────────
function depCounts() {
  const due      = depRooms.filter(r => effectiveStatus(r) === 'due').length;
  const late     = depRooms.filter(r => effectiveStatus(r) === 'late').length;
  const extended = depRooms.filter(r => r.status === 'extended').length;
  const out      = depRooms.filter(r => r.status === 'out').length;
  const na       = depRooms.filter(r => r.status === 'na').length;
  return {
    all:          due + late + na + extended + out,   // today's rooms only (no preserved ghosts)
    due,
    late,
    extended,
    out,
    na,
    balance:      depRooms.filter(r => r.balance > 0 && effectiveStatus(r) !== 'out' && effectiveStatus(r) !== 'extended').length,
    maybe_extend: depRooms.filter(r => r.intent === 'maybe_extend').length,
    pending:      depRooms.filter(r => r.intent && effectiveStatus(r) !== 'out' && effectiveStatus(r) !== 'extended').length,
  };
}

// ── Parse a time string like "12:00" or "2:00 PM" → minutes since midnight ──
function _parseLcoTime(t) {
  if (!t) return null;
  const m = t.match(/(\d+):(\d+)\s*(AM|PM)?/i);
  if (!m) return null;
  let h = parseInt(m[1]), min = parseInt(m[2]);
  const ampm = (m[3] || '').toUpperCase();
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

// ── depTimeMins: parse r.depTime → minutes since midnight, or null ────────
function _depTimeMins(r) {
  return _parseLcoTime(r.depTime);
}

// ── Effective status ──────────────────────────────────────
// A due room whose Opera departure time has already passed
// is treated as Late CO automatically everywhere — counts,
// filters, badges, actions. r.status stays 'due' so Undo works.
function effectiveStatus(r) {
  if (r.status === 'due' && r.depTime && !r.lcoAcknowledged) {
    const depMins = _depTimeMins(r);
    if (depMins !== null) {
      const now = new Date();
      if (now.getHours() * 60 + now.getMinutes() > depMins) return 'late';
    }
  }
  return r.status;
}

// ── Is this room past its agreed/implied checkout time? ───
// Used for red-pulse overdue treatment and sort bubbling.
// · Auto-promoted (depTime passed)        → always overdue
// · Manually-set LCO with agreed lateTime → overdue when past that time
// · Manually-set LCO with no lateTime     → not considered overdue yet
function isLcoOverdue(r) {
  if (effectiveStatus(r) !== 'late') return false;
  if (r.status === 'due') return true;                       // auto-promoted
  if (r.status === 'late' && r.lateTime) {
    const now     = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const lcoMins = _parseLcoTime(r.lateTime);
    return lcoMins !== null && nowMins > lcoMins;
  }
  return false;
}

// ── Countdown tag — only shown while time hasn't passed yet ──────────────
function depTimeTag(r) {
  if (!r.depTime) return '';
  const es = effectiveStatus(r);
  // Hide on completed / auto-promoted-to-late rooms (overdue strip handles those)
  if (es === 'out' || es === 'extended' || es === 'late') return '';
  const depMins = _depTimeMins(r);
  if (depMins === null) return '';
  const now    = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const diff   = depMins - nowMin; // minutes remaining (negative = overdue)
  if (diff <= 0) return ''; // overdue — effectiveStatus already handles this
  const hrs   = Math.floor(diff / 60);
  const mins  = diff % 60;
  const label = hrs ? `${hrs}h ${mins}m` : `${mins}m`;
  if (diff <= 30) return `<span class="dc-time-tag soon">⏰ ${label} left</span>`;
  return `<span class="dc-time-tag ok">🕐 ${label}</span>`;
}

// ── Smart multi-room search ────────────────────────────────
// Detects:
//   "610,613,615"   → exact room list
//   "610 613 615"   → exact room list (spaces as separators)
//   "610-615"       → room range
//   "601, 603-606"  → mixed list + range
//   anything else   → normal text search (name, source, note)

function _parseSearchQuery(raw) {
  if (!raw) return { type: 'empty' };
  const trimmed = raw.trim();

  // Looks like a room query if it contains only digits, commas, dashes, spaces
  const isRoomQuery = /^[\d,\s\-]+$/.test(trimmed) && /\d/.test(trimmed);
  if (!isRoomQuery) return { type: 'text', q: trimmed.toLowerCase() };

  const rooms = new Set();
  // Split on commas or spaces, then handle each token
  const tokens = trimmed.split(/[\s,]+/).filter(Boolean);
  for (const tok of tokens) {
    if (tok.includes('-')) {
      // range: "610-615"
      const [a, b] = tok.split('-').map(Number);
      if (!isNaN(a) && !isNaN(b) && b >= a && b - a < 200) {
        for (let n = a; n <= b; n++) rooms.add(String(n));
      }
    } else if (!isNaN(Number(tok))) {
      rooms.add(tok);
    }
  }

  if (rooms.size === 1 && tokens.length === 1 && !tokens[0].includes('-')) {
    // Single room number — could still be partial match, keep as text so "6" shows all 6xx
    return { type: 'text', q: trimmed.toLowerCase() };
  }

  return rooms.size > 0
    ? { type: 'rooms', rooms }
    : { type: 'text', q: trimmed.toLowerCase() };
}

function _matchSearch(r, parsed) {
  if (parsed.type === 'empty') return true;
  if (parsed.type === 'rooms') return parsed.rooms.has(r.roomStr);
  // text — match room, name, source, note
  const q = parsed.q;
  return r.roomStr.toLowerCase().includes(q) ||
    r.name.toLowerCase().includes(q) ||
    r.source.toLowerCase().includes(q) ||
    (r.note && r.note.toLowerCase().includes(q));
}

// ── Search input handlers ──────────────────────────────────
function depSearchInput() {
  const val = (document.getElementById('depSearch')?.value || '').trim();
  const clearBtn = document.getElementById('depSearchClear');
  if (clearBtn) clearBtn.style.display = val ? 'flex' : 'none';
  _renderSearchPills(val);
  depRender();
}

function depSearchKey(e) {
  if (e.key === 'Escape') depSearchClear();
}

function depSearchClear() {
  const inp = document.getElementById('depSearch');
  if (inp) inp.value = '';
  depSearchInput();
}

function _renderSearchPills(raw) {
  const pillBox = document.getElementById('depSearchPills');
  if (!pillBox) return;
  if (!raw) { pillBox.style.display = 'none'; pillBox.innerHTML = ''; return; }

  const parsed = _parseSearchQuery(raw);
  if (parsed.type !== 'rooms' || parsed.rooms.size < 2) {
    pillBox.style.display = 'none'; pillBox.innerHTML = ''; return;
  }

  // Show room pills — each tappable to remove
  const roomArr = [...parsed.rooms].sort((a, b) => parseInt(a) - parseInt(b));
  pillBox.style.display = 'flex';
  pillBox.innerHTML = `
    <span class="srch-pill-lbl">${roomArr.length} rooms:</span>
    ${roomArr.map(r => `<span class="srch-pill" onclick="depRemoveRoomFromSearch('${r}')">${r} <span class="srch-pill-x">✕</span></span>`).join('')}
    <button class="srch-pill-clear" onclick="depSearchClear()">Clear all</button>`;
}

function depRemoveRoomFromSearch(room) {
  const inp = document.getElementById('depSearch');
  if (!inp) return;
  // Remove this room number from the raw input text
  const newVal = inp.value
    .split(/[\s,]+/)
    .filter(tok => {
      if (tok === room) return false;
      // Remove from range if it matches exactly
      if (tok.includes('-')) {
        const [a, b] = tok.split('-').map(Number);
        if (!isNaN(a) && !isNaN(b) && Number(room) >= a && Number(room) <= b) return false;
      }
      return true;
    })
    .join(', ');
  inp.value = newVal.trim().replace(/,\s*$/, '');
  depSearchInput();
}


// key: 'smart' | 'room' | 'name' | 'time' | 'balance' | 'status'
// dir: 1 = asc, -1 = desc
let depSort = { key: 'smart', dir: 1 };

function depSetSort(key) {
  if (depSort.key === key) depSort.dir *= -1;
  else { depSort.key = key; depSort.dir = 1; }
  // update UI
  document.querySelectorAll('.dep-sort-btn').forEach(b => {
    const active = b.dataset.s === key;
    b.classList.toggle('on', active);
    const arrow = b.querySelector('.sort-arrow');
    if (arrow) arrow.textContent = active ? (depSort.dir === 1 ? ' ↑' : ' ↓') : '';
  });
  depRender();
}
function depRender() {
  const sc  = depCounts();
  const pct = sc.all ? Math.round(sc.out / sc.all * 100) : 0;

  // Push counts to filter chips
  Object.entries(sc).forEach(([k, v]) => {
    const el = document.getElementById('dfc-' + k); if (el) el.textContent = v;
  });
  // 'All' chip shows active rooms (due + late + na — what staff still needs to action)
  const activeCount = sc.due + sc.late + sc.na;
  const allChipCount = document.getElementById('dfc-all');
  if (allChipCount) allChipCount.textContent = activeCount;

  // Balance outstanding total
  const totalOwing = depRooms
    .filter(r => r.balance > 0 && r.status !== 'out' && r.status !== 'extended')
    .reduce((s, r) => s + r.balance, 0);
  const balKpiVal = totalOwing > 0
    ? `AED ${totalOwing.toLocaleString('en',{minimumFractionDigits:0,maximumFractionDigits:0})}`
    : '✓ Clear';

  document.getElementById('depKpis').innerHTML = `
    <div class="dep-kpi k-total"><div class="dep-kpi-icon">🏨</div><div class="dep-kpi-val">${sc.all}</div><div class="dep-kpi-label">Total</div></div>
    <div class="dep-kpi k-due"><div class="dep-kpi-icon">⏳</div><div class="dep-kpi-val">${sc.due}</div><div class="dep-kpi-label">Due Out</div></div>
    <div class="dep-kpi k-ext"><div class="dep-kpi-icon">↪</div><div class="dep-kpi-val">${sc.extended}</div><div class="dep-kpi-label">Extended</div></div>
    <div class="dep-kpi k-late"><div class="dep-kpi-icon">🕐</div><div class="dep-kpi-val">${sc.late}</div><div class="dep-kpi-label">Late CO</div></div>
    <div class="dep-kpi k-na"><div class="dep-kpi-icon">📵</div><div class="dep-kpi-val">${sc.na}</div><div class="dep-kpi-label">No Answer</div></div>
    <div class="dep-kpi k-out"><div class="dep-kpi-icon">✓</div><div class="dep-kpi-val">${sc.out}</div><div class="dep-kpi-label">Checked Out</div></div>
    <div class="dep-kpi k-bal ${totalOwing>0?'has-balance':''}"><div class="dep-kpi-icon">💳</div><div class="dep-kpi-val" style="font-size:${totalOwing>0?'0.82rem':'1.1rem'}">${balKpiVal}</div><div class="dep-kpi-label">Balance Owing</div></div>`;

  // Update occupancy pill in topbar
  const occEl  = document.getElementById('topbarOcc');
  const occLbl = document.getElementById('occLabel');
  if (occEl && occLbl && sc.all > 0) {
    occEl.style.display = '';
    occLbl.textContent  = `${sc.out} / ${sc.all} departed`;
  }

  // HK Status bar — always visible when board is loaded
  const hkBar = document.getElementById('depHKBar');
  if (hkBar) hkBar.style.display = depRooms.length ? 'flex' : 'none';

  // NA Action Bar
  const naBar = document.getElementById('depNaBar');
  const naCnt = document.getElementById('depNaCount');
  if (naBar) naBar.style.display = sc.na > 0 ? 'flex' : 'none';
  if (naCnt) naCnt.textContent = sc.na + ' room' + (sc.na !== 1 ? 's' : '');

  // Extension Action Bar
  const extBar = document.getElementById('depExtBar');
  const extCnt = document.getElementById('depExtCount');
  if (extBar) extBar.style.display = sc.extended > 0 ? 'flex' : 'none';
  if (extCnt) extCnt.textContent = sc.extended + ' room' + (sc.extended !== 1 ? 's' : '');

  // Checked-Out Action Bar
  const outBar = document.getElementById('depOutBar');
  const outCnt = document.getElementById('depOutCount');
  if (outBar) outBar.style.display = sc.out > 0 ? 'flex' : 'none';
  if (outCnt) outCnt.textContent = sc.out + ' room' + (sc.out !== 1 ? 's' : '');

  document.getElementById('depProgLabel').textContent = `${sc.out} of ${sc.all} checked out`;
  document.getElementById('depProgPct').textContent   = pct + '%';
  document.getElementById('depProgFill').style.width  = pct + '%';

  const rawSearch = (document.getElementById('depSearch')?.value || '').trim();
  const parsed    = _parseSearchQuery(rawSearch);

  // When searching by specific room numbers, bypass the status filter entirely
  // so you can find any room regardless of whether it's due, out, extended, etc.
  let filtered = depRooms.filter(r => {
    if (parsed.type === 'rooms') return _matchSearch(r, parsed);

    // Single number typed — also search across all statuses
    if (parsed.type === 'text' && parsed.q && /^\d+$/.test(parsed.q)) {
      return r.roomStr.includes(parsed.q);
    }

    const es = effectiveStatus(r);
    let mf;
    switch (depFilter_) {
      case 'all':          mf = es === 'due' || es === 'late' || es === 'na'; break;
      case 'balance':      mf = r.balance > 0 && es !== 'out' && es !== 'extended'; break;
      case 'pending':      mf = !!r.intent && es !== 'out' && es !== 'extended'; break;
      case 'maybe_extend': mf = r.intent === 'maybe_extend'; break;
      case 'due':          mf = es === 'due'; break;
      case 'late':         mf = es === 'late'; break;
      case 'na':           mf = es === 'na'; break;
      case 'extended':     mf = es === 'extended'; break;
      case 'out':          mf = es === 'out'; break;
      default:             mf = es === depFilter_; break;
    }
    const ms = _matchSearch(r, parsed);
    return mf && ms;
  });

  // ── Sort ────────────────────────────────────────────────
  const STATUS_ORDER = { late: 0, due: 1, na: 2, extended: 3, out: 4 };

  // When viewing the checked-out list, always show newest checkout first
  // (unless user has explicitly chosen a different sort key)
  if (depFilter_ === 'out' && depSort.key === 'smart') {
    filtered.sort((a, b) => _coTimeSort(b, a)); // newest first
  } else
  filtered.sort((a, b) => {
    const es_a = effectiveStatus(a), es_b = effectiveStatus(b);
    const d = depSort.dir;
    switch (depSort.key) {
      case 'room':
        return d * (parseInt(a.room) - parseInt(b.room) || a.roomStr.localeCompare(b.roomStr));
      case 'name':
        return d * a.name.localeCompare(b.name);
      case 'time': {
        const at = _depTimeMins(a) ?? (a.lateTime ? _parseLcoTime(a.lateTime) : null);
        const bt = _depTimeMins(b) ?? (b.lateTime ? _parseLcoTime(b.lateTime) : null);
        if (at !== null && bt !== null) return d * (at - bt);
        if (at !== null) return -1;
        if (bt !== null) return  1;
        return d * (parseInt(a.room) - parseInt(b.room));
      }
      case 'balance':
        return d * ((b.balance || 0) - (a.balance || 0));
      case 'status': {
        const sa = STATUS_ORDER[es_a] ?? 9;
        const sb = STATUS_ORDER[es_b] ?? 9;
        return d * (sa - sb) || parseInt(a.room) - parseInt(b.room);
      }
      default: // 'smart' — overdue first, then soonest checkout time, then room number
      {
        const ao = isLcoOverdue(a), bo = isLcoOverdue(b);
        if (ao !== bo) return ao ? -1 : 1;
        const at2 = _depTimeMins(a), bt2 = _depTimeMins(b);
        if (at2 !== null && bt2 !== null) return at2 - bt2;
        if (at2 !== null) return -1;
        if (bt2 !== null) return  1;
        return parseInt(a.room) - parseInt(b.room);
      }
    }
  });

  document.getElementById('depGrid').innerHTML = filtered.map(r => depCardHTML(r)).join('');
  renderDepLog();
  if (_jumpOpen) renderDepQuickJump();

  const qb   = document.getElementById('depQuickBar');
  const qbIn = document.getElementById('depQuickBarInline');
  if (sc.due > 3) {
    qb.style.display = 'flex';
    if (qbIn) qbIn.style.display = 'flex';
    document.getElementById('depQuickLabel').textContent = `${sc.due} rooms still due out`;
  } else {
    qb.style.display = 'none';
    if (qbIn) qbIn.style.display = 'none';
  }
}

// ── Quick Jump bar ─────────────────────────────────────────
// Shows live room-number pills grouped by status category.
// Click any pill → filter switches to that group + card highlighted.
let _jumpOpen = false;

function toggleDepJump() {
  _jumpOpen = !_jumpOpen;
  const bar = document.getElementById('depJumpBar');
  const btn = document.getElementById('depJumpBtn');
  if (bar) bar.style.display = _jumpOpen ? 'block' : 'none';
  if (btn) btn.classList.toggle('on', _jumpOpen);
  if (_jumpOpen) renderDepQuickJump();
}

function renderDepQuickJump() {
  const bar = document.getElementById('depJumpBar');
  if (!bar) return;

  const groups = [
    {
      key:   'due',
      icon:  '⏳',
      label: 'Due Out',
      cls:   'jump-due',
      rooms: depRooms.filter(r => effectiveStatus(r) === 'due'),
    },
    {
      key:   'after12',
      icon:  '🕛',
      label: 'Auto LCO (past time)',
      cls:   'jump-late',
      rooms: depRooms.filter(r => r.status === 'due' && effectiveStatus(r) === 'late'),
    },
    {
      key:   'lco',
      icon:  '🕐',
      label: 'Manual LCO',
      cls:   'jump-lco',
      rooms: depRooms.filter(r => r.status === 'late'),
    },
    {
      key:   'na',
      icon:  '📵',
      label: 'No Answer',
      cls:   'jump-na',
      rooms: depRooms.filter(r => r.status === 'na'),
    },
    {
      key:   'balance',
      icon:  '💳',
      label: 'Balance Owing',
      cls:   'jump-bal',
      rooms: depRooms.filter(r => r.balance > 0 && effectiveStatus(r) !== 'out' && effectiveStatus(r) !== 'extended'),
    },
    {
      key:   'extended',
      icon:  '↪',
      label: 'Extended',
      cls:   'jump-ext',
      rooms: depRooms.filter(r => r.status === 'extended'),
    },
  ].filter(g => g.rooms.length > 0);

  if (!groups.length) {
    bar.innerHTML = `<div class="jump-empty">All rooms actioned — nothing to jump to 🎉</div>`;
    return;
  }

  bar.innerHTML = groups.map(g => `
    <div class="jump-group">
      <div class="jump-group-label ${g.cls}">${g.icon} ${g.label} <span class="jump-group-count">${g.rooms.length}</span></div>
      <div class="jump-pills">
        ${g.rooms.map(r => `
          <button class="jump-pill ${g.cls}" onclick="depJumpTo('${r.roomStr}','${
            g.key === 'after12' || g.key === 'lco' ? 'late'
            : g.key === 'due'      ? 'due'
            : g.key === 'na'       ? 'na'
            : g.key === 'extended' ? 'extended'
            : 'all'}','${r.roomStr}')">
            ${r.roomStr}<span class="jump-pill-name">${r.name.split(' ')[0]}</span>
          </button>`).join('')}
      </div>
    </div>`).join('');
}

function depJumpTo(roomStr, filterKey, targetRoom) {
  // Switch to the right filter
  const chipSel = filterKey === 'all' ? '[data-f="all"]'
    : filterKey === 'due'  ? '[data-f="due"]'
    : filterKey === 'late' ? '[data-f="late"]'
    : filterKey === 'na'   ? '[data-f="na"]'
    : '[data-f="all"]';
  const chip = document.querySelector(chipSel);
  if (chip) depFilter(filterKey, chip);

  // After render, find and highlight the card
  requestAnimationFrame(() => {
    const cards = document.querySelectorAll('.dep-card');
    for (const card of cards) {
      const roomEl = card.querySelector('.dc-room');
      if (roomEl && roomEl.textContent.trim() === targetRoom) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('dep-jump-highlight');
        setTimeout(() => card.classList.remove('dep-jump-highlight'), 2000);
        break;
      }
    }
  });
}
const INTENT_CONFIG = {
  maybe_extend: { icon:'🤔', label:'May Extend Stay',   color:'var(--violet)', autoNote:'Guest may extend — confirm with Opera before releasing room.' },
  coming_back:  { icon:'↩️', label:'Coming Back Later', color:'var(--amber)',  autoNote:'Guest coming back later today — hold key and luggage if needed.' },
  returning:    { icon:'🔁', label:'Returning Guest',    color:'var(--sky)',    autoNote:'Returning guest — check if new reservation is linked.' },
};

// ── Card HTML ──────────────────────────────────────────────
function depCardHTML(r) {
  const i   = depRooms.indexOf(r);
  const bal = r.balance;
  const es         = effectiveStatus(r);
  const lcoOverdue  = isLcoOverdue(r);

  const balClass = bal > 0 ? 'bal-owing' : bal < 0 ? 'bal-credit' : 'bal-zero';
  const balText  = bal === 0 ? '✓ Settled'
    : bal > 0 ? `AED ${Math.abs(bal).toLocaleString('en',{minimumFractionDigits:2})} OWING`
    :           `AED ${Math.abs(bal).toLocaleString('en',{minimumFractionDigits:2})} CREDIT`;

  // Card colour — driven by effective status
  let sClass = 's-' + (bal > 0 && es !== 'out' && es !== 'extended' && es !== 'na' ? 'balance' : es);
  if (r.intent && es !== 'out' && es !== 'extended' && es !== 'na') sClass += ' s-intent';
  if (lcoOverdue) sClass += ' s-lco-overdue';

  // Status badge — driven by effective status
  const autoPromoted = r.status === 'due' && es === 'late';
  let badgeCls, badgeText;
  if (es === 'due') {
    badgeCls  = 'sb-due';
    badgeText = 'DUE OUT';
  } else if (es === 'late') {
    badgeCls  = lcoOverdue ? 'sb-late sb-lco-overdue' : 'sb-late';
    badgeText = autoPromoted
      ? (lcoOverdue ? `⚠ OVERDUE · ${r.depTime}` : `LATE CO · ${r.depTime}`)
      : (lcoOverdue ? `⚠ LCO OVERDUE · ${r.lateTime}` : `LATE CO${r.lateTime ? ' · ' + r.lateTime : ''}`);
  } else if (es === 'extended') {
    badgeCls  = 'sb-extended';
    // Show new departure date in badge if calculable
    const origDep2 = parseOperaDate(r.departure);
    let extBadgeDate = '';
    if (origDep2 && r.extensionNights) {
      const nd2 = new Date(origDep2);
      nd2.setDate(nd2.getDate() + r.extensionNights);
      const months2 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      extBadgeDate = ` → ${String(nd2.getDate()).padStart(2,'0')} ${months2[nd2.getMonth()]}`;
    }
    badgeText = `↪ EXT +${r.extensionNights}N${extBadgeDate}`;
    if (!r.extConfirmed) badgeText += ' ⚠';
  } else if (es === 'out') {
    badgeCls  = 'sb-out';
    badgeText = `OUT${r.checkoutAt ? ' · ' + r.checkoutAt : ''}`;
  } else if (es === 'na') {
    badgeCls  = 'sb-na';
    badgeText = `NO ANSWER${r.naTime ? ' · ' + r.naTime : ''}`;
  } else {
    badgeCls  = 'sb-due';
    badgeText = 'DUE OUT';
  }

  const srcClean  = r.source.substring(0,26) + (r.source.length > 26 ? '…' : '');
  const vipHTML   = r.isVip ? '<div class="dc-vip">⭐ VIP</div>' : '';
  const compTag   = r.company ? `<div class="dc-mi">🏢 ${r.company.substring(0,36)}</div>` : '';
  const timeTag   = depTimeTag(r);

  // Intent banner
  const ic = INTENT_CONFIG[r.intent];
  const intentBanner = ic && r.status !== 'out' && r.status !== 'extended'
    ? `<div class="dc-intent-banner" style="border-color:${ic.color};color:${ic.color};">
         <span>${ic.icon} ${ic.label}</span>
         <button class="dc-intent-clear" onclick="depSetIntent(${i},'');event.stopPropagation()">✕ clear</button>
       </div>`
    : '';

  // Overdue warning strip
  const overdueStrip = lcoOverdue
    ? autoPromoted
      ? `<div class="dc-overdue-strip dc-lco-overdue-strip">⚠ Past checkout time (${r.depTime}) — Late CO, follow up required</div>`
      : `<div class="dc-overdue-strip dc-lco-overdue-strip">⚠ Past agreed LCO time (${r.lateTime}) — check out required now</div>`
    : '';

  // Late time dropdown — show for any LCO room (manual or auto-promoted)
  const lateRow = es === 'late' ? `
    <div class="dc-sel-row">
      <span class="dc-sel-lbl late">🕐 Agreed time:</span>
      <select class="dc-select late" onchange="depRooms[${i}].lateTime=this.value;depRender();saveDeps()">
        <option value="">Select…</option>
        ${(() => { const t=[]; for(let h=10;h<=23;h++){t.push(String(h).padStart(2,'0')+':00');t.push(String(h).padStart(2,'0')+':30');} return t; })()
          .map(t => `<option${r.lateTime===t?' selected':''}>${t}</option>`).join('')}
      </select>
    </div>` : '';


  // Extension details panel — full block shown when room is extended
  const extRow = es === 'extended' ? (() => {
    const origDep = parseOperaDate(r.departure);
    let newDepStr = '';
    if (origDep && r.extensionNights) {
      const nd = new Date(origDep);
      nd.setDate(nd.getDate() + r.extensionNights);
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      newDepStr = `${String(nd.getDate()).padStart(2,'0')} ${months[nd.getMonth()]} ${nd.getFullYear()}`;
    }
    const confirmedCls = r.extConfirmed ? 'ext-confirmed-yes' : 'ext-confirmed-no';
    const confirmedLbl = r.extConfirmed ? '✓ Opera updated' : '⚠ Needs Opera update';
    const summaryParts = [
      `+${r.extensionNights}N`,
      newDepStr ? `Departs ${newDepStr}` : '',
      r.extCheckoutTime ? `CO ${r.extCheckoutTime}` : '',
      r.extRate         ? `AED ${r.extRate}/night`   : '',
      r.extReason       ? r.extReason                : '',
      r.extConfirmed ? '✓ Updated' : '⚠ Pending',
    ].filter(Boolean).join(' · ');
    const summaryHTML = newDepStr
      ? `<div class="dc-ext-summary"><strong>${r.roomStr}</strong> · ${summaryParts}</div>`
      : '';
    return `
    <div class="dc-ext-panel">
      <div class="dc-ext-header">↪ Extension Details</div>
      <div class="dc-ext-grid">
        <div class="dc-ext-field">
          <label class="dc-ext-lbl">Extra nights</label>
          <select class="dc-select ext dc-ext-sel" onchange="depExtUpdate(${i},'nights',parseInt(this.value)||1)">
            ${[1,2,3,4,5,6,7,14,21,28].map(n => `<option value="${n}"${r.extensionNights===n?' selected':''}>${n} night${n>1?'s':''}</option>`).join('')}
          </select>
        </div>
        <div class="dc-ext-field">
          <label class="dc-ext-lbl">New departure</label>
          <div class="dc-ext-val ${newDepStr ? 'ext-val-highlight' : ''}">${newDepStr || '—'}</div>
        </div>
        <div class="dc-ext-field">
          <label class="dc-ext-lbl">Checkout time</label>
          <select class="dc-select ext dc-ext-sel" onchange="depExtUpdate(${i},'checkoutTime',this.value)">
            <option value="">Standard (12:00 PM)</option>
            ${['10:00 AM','11:00 AM','12:00 PM','1:00 PM','2:00 PM','3:00 PM','4:00 PM','5:00 PM','6:00 PM','7:00 PM','8:00 PM','9:00 PM','10:00 PM','11:00 PM']
              .map(t => `<option value="${t}"${r.extCheckoutTime===t?' selected':''}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="dc-ext-field">
          <label class="dc-ext-lbl">Rate / night (AED)</label>
          <input class="dc-ext-input" type="number" min="0" placeholder="Same rate"
            value="${r.extRate || ''}"
            onchange="depExtUpdate(${i},'rate',this.value)"/>
        </div>
        <div class="dc-ext-field dc-ext-field-full">
          <label class="dc-ext-lbl">Reason</label>
          <select class="dc-select ext dc-ext-sel" onchange="depExtUpdate(${i},'reason',this.value)">
            <option value="">Select reason…</option>
            ${['Guest request','VIP / loyalty','Flight cancelled / delayed','Visa issue','Medical','Business extension','Late arrival on next booking','Room upgrade','Overbooking move','Other']
              .map(v => `<option value="${v}"${r.extReason===v?' selected':''}>${v}</option>`).join('')}
          </select>
        </div>
        <div class="dc-ext-field dc-ext-field-full">
          <label class="dc-ext-lbl">Opera</label>
          <button class="dc-ext-confirm-btn ${confirmedCls}" onclick="depExtUpdate(${i},'confirmed',${!r.extConfirmed})">
            ${confirmedLbl}
          </button>
        </div>
      </div>
      ${summaryHTML}
    </div>`;
  })() : '';

  // Action buttons — driven by effective status
  let actHTML = '';
  if (es === 'extended') {
    actHTML = `<div class="dc-actions g1">
      <button class="dca dca-undo" onclick="depAction(${i},'due')">↺ Undo Extension</button>
    </div>`;

  } else if (es === 'out') {
    actHTML = `<div class="dc-actions g1">
      <button class="dca dca-undo" onclick="depAction(${i},'due')">↺ Undo Check Out</button>
    </div>`;

  } else if (es === 'na') {
    let naWarnStrip = '';
    if (r.naTime) {
      const [h, m]  = r.naTime.split(':').map(Number);
      const naDate  = new Date(); naDate.setHours(h, m, 0, 0);
      const minsSince = Math.floor((Date.now() - naDate.getTime()) / 60000);
      if (minsSince >= 30) {
        naWarnStrip = `<div class="dc-na-warn">⚠ No answer for ${minsSince} min — follow up now</div>`;
      }
    }
    actHTML = `${naWarnStrip}<div class="dc-actions g2">
      <button class="dca dca-co"   onclick="depAction(${i},'out')">✓ Check Out</button>
      <button class="dca dca-undo" onclick="depAction(${i},'due')">↺ Undo NA</button>
    </div>`;

  } else if (es === 'late') {
    // LCO room (manual or auto-promoted) — Check Out or Undo back to due
    actHTML = `<div class="dc-actions g2">
      <button class="dca dca-co"   onclick="depAction(${i},'out')">✓ Check Out</button>
      <button class="dca dca-undo" onclick="depAction(${i},'due')">↺ Undo LCO</button>
    </div>`;

  } else {
    // Due — full action row + intent buttons
    const intentRow = `
      <div class="dc-intent-row">
        <span class="dc-intent-lbl">Guest said:</span>
        <button class="dc-intent-btn${r.intent==='maybe_extend'?' active':''}"
          onclick="depSetIntent(${i},'maybe_extend')">🤔 May Extend</button>
        <button class="dc-intent-btn${r.intent==='coming_back' ?' active':''}"
          onclick="depSetIntent(${i},'coming_back')">↩️ Coming Back</button>
        <button class="dc-intent-btn${r.intent==='returning'   ?' active':''}"
          onclick="depSetIntent(${i},'returning')">🔁 Returning</button>
      </div>`;
    actHTML = `<div class="dc-actions g4">
      <button class="dca dca-co"   onclick="depCheckOut(${i})">✓ Check Out</button>
      <button class="dca dca-ext"  onclick="depAskExtend(${i})">↪ Extend</button>
      <button class="dca dca-late" onclick="depAskLCO(${i})">🕐 Late CO</button>
      <button class="dca dca-na"   onclick="depAction(${i},'na')">📵 No Answer</button>
    </div>${intentRow}`;
  }

  // Selection mode tick overlay — no label/input, just a div
  const isSelectable = _selGroup && r.status === _selGroup;
  const isSelected   = isSelectable && _selRooms.has(r.roomStr);
  const selTick = isSelectable
    ? `<div class="dep-sel-tick${isSelected ? ' checked' : ''}"></div>`
    : '';

  return `<div class="dep-card ${sClass}${isSelected ? ' dep-sel-active' : ''}"
    data-room="${r.roomStr}"
    ${isSelectable ? `onclick="depToggleSelect('${r.roomStr}')"` : ''}>
    ${selTick}
    ${vipHTML}
    <div class="dc-band"></div>
    <div class="dc-head">
      <div class="dc-room">${r.roomStr}</div>
      <div class="dc-badges">
        <div class="dc-sbadge ${badgeCls}">${badgeText}</div>
        <div class="dc-nights">🌙 ${r.nights}n</div>
        ${r.rateCode ? `<div class="dc-rate-code">${r.rateCode}</div>` : ''}
        <button class="dc-copy-card-btn" title="Copy room summary" onclick="depCopyCard(${i})">📋</button>
      </div>
    </div>
    <div class="dc-body">
      ${overdueStrip}
      ${intentBanner}
      <div class="dc-name-row"><div class="dc-name" ondblclick="depEditName(${i})" title="Double-click to edit">${escapeHtml(r.name)}</div></div>
      <div class="dc-meta">
        <div class="dc-mi">📅 <strong>${r.arrival}</strong> → <strong>${r.departure}</strong></div>
        ${r.depTime ? `<div class="dc-mi">${timeTag}</div>` : ''}
      </div>
      ${compTag}
      <div class="dc-src">${srcClean}</div>
      <div class="dc-bal ${balClass}">
        <span class="dc-bal-lbl">Balance</span>
        <span class="dc-bal-amt">${balText}</span>
      </div>
      ${lateRow}
      ${extRow}
      ${actHTML}
      <div style="margin-top:8px;">
        <div class="dc-note-lbl" style="display:flex;justify-content:space-between;align-items:center;">
          Notes
          <button class="dc-stamp-btn" onclick="depStampNote(${i})" title="Add timestamp">🕐 Stamp</button>
        </div>
        <textarea class="dc-note" placeholder="Luggage stored, guest requests, complaints…"
          onchange="depRooms[${i}].note=this.value;saveDeps()">${escapeHtml(r.note)}</textarea>
      </div>
    </div>
  </div>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]||m));
}

// ── Check Out with balance warning ─────────────────────────
function depCheckOut(i) {
  const r = depRooms[i];
  if (r.balance > 0) {
    if (!confirm(`⚠ Room ${r.roomStr} has AED ${r.balance.toLocaleString('en',{minimumFractionDigits:2})} owing.\n\nAre you sure you want to check them out?`)) return;
  }
  depAction(i, 'out');
}

// ── Timestamp stamp button ─────────────────────────────────
function depStampNote(i) {
  const t    = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  const sep  = depRooms[i].note ? '\n' : '';
  depRooms[i].note += sep + `[${t}] `;
  // Update the textarea in DOM immediately
  const textareas = document.querySelectorAll('.dc-note');
  // find the right one by re-rendering
  depRender();
  // focus the right textarea after render — find by room
  setTimeout(() => {
    const cards = document.querySelectorAll('.dep-card');
    const filtered = [...document.querySelectorAll('.dep-card')];
    // just save — user will type after
    saveDeps();
  }, 50);
}

// ── Guest intent ───────────────────────────────────────────
// Toggle: tap same intent again to clear it.
// Auto-stamps the note with context when set.
function depSetIntent(i, intent) {
  const r       = depRooms[i];
  const isToggle = r.intent === intent;

  r.intent = isToggle ? '' : intent;

  // Auto-stamp note when intent is SET (not when cleared)
  if (!isToggle && intent) {
    const cfg  = INTENT_CONFIG[intent];
    const t    = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
    const line = `[${t}] ${cfg.autoNote}`;
    r.note = r.note ? r.note + '\n' + line : line;
  }

  depRender();
  saveDeps();
}

// ── Name inline edit ───────────────────────────────────────
function depEditName(i) {
  const allFiltered = depRooms.filter(r => {
    const es = effectiveStatus(r);
    switch (depFilter_) {
      case 'all':          return es === 'due' || es === 'late' || es === 'na';
      case 'balance':      return r.balance > 0 && es !== 'out' && es !== 'extended';
      case 'pending':      return !!r.intent && es !== 'out' && es !== 'extended';
      case 'maybe_extend': return r.intent === 'maybe_extend';
      case 'due':          return es === 'due';
      case 'late':         return es === 'late';
      case 'na':           return es === 'na';
      case 'extended':     return es === 'extended';
      case 'out':          return es === 'out';
      default:             return es === depFilter_;
    }
  });
  const visIdx = allFiltered.indexOf(depRooms[i]);
  const el     = document.querySelectorAll('.dc-name')[visIdx];
  if (!el) return;
  const cur = depRooms[i].name;
  el.outerHTML = `<input class="dc-edit-name" id="en-${i}"
    value="${cur.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}"
    onblur="depSaveName(${i},this.value)"
    onkeydown="if(event.key==='Enter')this.blur()"/>`;
  const inp = document.getElementById('en-' + i);
  if (inp) inp.focus();
}

function depSaveName(i, val) {
  depRooms[i].name = (val || '').trim() || depRooms[i].name;
  depRender();
  saveDeps();
}

// ── Ask nights before extending ────────────────────────────
function depAskExtend(i) {
  const r = depRooms[i];
  const raw = prompt(`Room ${r.roomStr} — ${r.name}\n\nHow many extra nights?`, '1');
  if (raw === null) return; // cancelled
  const nights = parseInt(raw);
  if (!nights || nights < 1 || nights > 365) {
    showToast('Enter a valid number of nights', 'err');
    return;
  }
  depAction(i, 'extended', nights);
}

// ── Actions ────────────────────────────────────────────────
function depAction(i, status, extraNights) {
  const r    = depRooms[i];
  const prev = r.status;
  r.status   = status;
  const t    = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });

  if (status === 'out') r.checkoutAt = t; else r.checkoutAt = '';
  if (status === 'na')  r.naTime = t;     else r.naTime = '';
  if (status !== 'late') r.lateTime = '';
  if (status !== 'extended') {
    r.extensionNights = 0;
    r.extCheckoutTime = '';
    r.extRate         = 0;
    r.extReason       = '';
    r.extConfirmed    = false;
  }
  if (status === 'extended' && prev !== 'extended') {
    // Use nights from prompt, or default 1
    if (extraNights && extraNights >= 1) r.extensionNights = extraNights;
    else if (!r.extensionNights) r.extensionNights = 1;
    const line = `[${t}] Extension marked — ${r.extensionNights} night${r.extensionNights > 1 ? 's' : ''}. Please update Opera and confirm.`;
    r.note = r.note ? r.note + '\n' + line : line;
  }
  if (status === 'due') {
    r.intent = '';  // undo clears intent
    // If this was an auto-promoted room (depTime passed), staff is explicitly
    // acknowledging it — suppress auto-promotion so it stays in Due Out
    if (prev === 'due') r.lcoAcknowledged = true;
  } else {
    r.lcoAcknowledged = false;
  }

  if (status !== 'due') {
    depLog.unshift({
      room:            r.roomStr,
      name:            r.name,
      action:          status,
      time:            t,
      roomIdx:         depRooms.indexOf(r),
      prevStatus:      prev,
      extensionNights: status === 'extended' ? (r.extensionNights || 1) : 0,
      lateTime:        status === 'late'     ? (r.lateTime || '')        : '',
    });
  } else {
    // Undo — find what we're undoing and write an undo log entry
    const li = depLog.findIndex(l => l.room === r.roomStr && l.action !== 'undo');
    const undoneAction = li >= 0 ? depLog[li].action : prev;
    if (li >= 0) depLog.splice(li, 1);
    depLog.unshift({
      room:       r.roomStr,
      name:       r.name,
      action:     'undo',
      undone:     undoneAction,
      time:       t,
      roomIdx:    depRooms.indexOf(r),
      prevStatus: prev,
    });
  }

  depRender();
  updateDepBadge();
  saveDeps();

  // ── Per-user activity log ─────────────────────────────────
  const _actionLabels = { out:'Checked out', na:'Marked N/A', late:'Late checkout', extended:'Extended stay', due:'Undid action' };
  logActivity('departure_' + status, `Room ${r.roomStr} — ${r.name} (${_actionLabels[status] || status})`);
}

function saveDeps() {
  saveDepartures(depRooms, depLog);
}

// ── Extension field updater ────────────────────────────────
function depExtUpdate(i, field, value) {
  const r = depRooms[i];
  const t = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });

  if (field === 'nights') {
    r.extensionNights = value;
    depSyncExtToLog(i);
  } else if (field === 'checkoutTime') {
    r.extCheckoutTime = value;
  } else if (field === 'rate') {
    r.extRate = value ? parseFloat(value) : 0;
  } else if (field === 'reason') {
    r.extReason = value;
  } else if (field === 'confirmed') {
    r.extConfirmed = value;
    if (value) {
      // Auto-stamp note when Opera is confirmed
      const origDep = parseOperaDate(r.departure);
      let newDepStr = '';
      if (origDep && r.extensionNights) {
        const nd = new Date(origDep); nd.setDate(nd.getDate() + r.extensionNights);
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        newDepStr = `${String(nd.getDate()).padStart(2,'0')} ${months[nd.getMonth()]} ${nd.getFullYear()}`;
      }
      const line = `[${t}] Opera updated — Extended ${r.extensionNights}N` +
        (newDepStr ? `, new departure ${newDepStr}` : '') +
        (r.extCheckoutTime ? `, CO ${r.extCheckoutTime}` : '') +
        (r.extRate ? `, AED ${r.extRate}/night` : '') +
        (r.extReason ? ` (${r.extReason})` : '');
      r.note = r.note ? r.note + '\n' + line : line;
    }
  }

  depRender();
  saveDeps();
}


// Keep log in sync when nights dropdown changes on an already-extended card
function depSyncExtToLog(i) {
  const r   = depRooms[i];
  const li  = depLog.findIndex(l => l.room === r.roomStr && l.action === 'extended');
  if (li >= 0) depLog[li].extensionNights = r.extensionNights || 1;
}

// ── Action log ─────────────────────────────────────────────
function renderDepLog() {
  const wrap  = document.getElementById('depLogWrap');
  const body  = document.getElementById('depLogBody');
  const badge = document.getElementById('depLogCount');
  const entries = depLog.filter(l => l.action !== 'due');
  if (!entries.length) { if (wrap) wrap.style.display = 'none'; return; }
  if (wrap)  wrap.style.display = 'block';
  if (badge) badge.textContent = entries.length;

  const aLabel = {
    out:      '✓ Checked Out',
    extended: '↪ Extended',
    late:     '🕐 Late CO',
    na:       '📵 No Answer',
    undo:     '↺ Undone',
  };
  const aCls = {
    out:      'log-act-co',
    extended: 'log-act-ext',
    late:     'log-act-late',
    na:       'log-act-na',
    undo:     'log-act-undo',
  };

  if (body) body.innerHTML = entries.map((l, li) => {
    const isUndo = l.action === 'undo';
    const undoneLabel = isUndo
      ? ` <span class="log-undo-detail">${aLabel[l.undone] || l.undone || 'action'}</span>`
      : '';
    const undoBtn = isUndo
      ? '' // can't undo an undo
      : `<button class="log-undo-btn" onclick="depUndoLog(${li})">↺ Undo</button>`;
    return `
    <div class="log-row${isUndo ? ' log-row-undo' : ''}">
      <span class="log-room">${escapeHtml(l.room)}</span>
      <span class="log-action ${aCls[l.action]||''}">${aLabel[l.action]||l.action}${undoneLabel}</span>
      <span class="log-time">${l.time}</span>
      ${undoBtn}
    </div>`;
  }).join('');
}

function depUndoLog(li) {
  const entry = depLog[li]; if (!entry) return;
  // Can't undo an undo — only forward actions
  if (entry.action === 'undo') { showToast('Cannot undo an undo entry', 'info'); return; }
  const t = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  // Find room by string — roomIdx can be stale after reloads
  const r = depRooms.find(rm => rm.roomStr === entry.room) || depRooms[entry.roomIdx];
  if (r) {
    r.status          = entry.prevStatus || 'due';
    r.checkoutAt      = '';
    r.lateTime        = '';
    r.extensionNights = 0;
    r.intent          = '';
    r.naTime          = '';
  }
  // Replace the forward action with an undo entry — keep it in the log
  depLog.splice(li, 1, {
    room:       entry.room,
    name:       entry.name,
    action:     'undo',
    undone:     entry.action,
    time:       t,
    roomIdx:    entry.roomIdx,
    prevStatus: entry.action,
  });
  depRender();
  updateDepBadge();
  saveDeps();
  showToast('Undone — ' + entry.room + ' back to Due Out', 'ok');
}

// ── Filters ────────────────────────────────────────────────
// ── Copy single card for handover (WhatsApp / Teams) ─────
function depCopyCard(i) {
  const r = depRooms[i];
  const statusLabel = { due:'Due Out', out:'Checked Out', extended:'Extended', late:'Late CO', na:'No Answer' };
  const lines = [
    `🏨 Room ${r.roomStr}`,
    `Status: ${statusLabel[r.status] || r.status.toUpperCase()}${r.lateTime ? ' · ' + r.lateTime : ''}${r.extensionNights ? ' +' + r.extensionNights + 'N' : ''}`,
    r.note ? `Notes: ${r.note}` : '',
  ].filter(Boolean);
  copyToClipboard(lines.join('\n'), null, '');
  showToast(`Room ${r.roomStr} copied ✓`, 'ok');
}

// ── Copy menu toggle ───────────────────────────────────────
function depToggleCopyMenu(group) {
  const menu = document.getElementById('depCopyMenu-' + group);
  if (!menu) return;
  const isOpen = menu.classList.contains('open');

  // Close all open menus and return any teleported menu to its original parent
  _depCloseAllCopyMenus();

  if (!isOpen) {
    menu.classList.add('open');

    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      // CRITICAL FIX: .main has overflow:hidden which creates a stacking context,
      // trapping position:fixed children. We move the menu to <body> to escape it.
      const originalParent = menu.parentElement;
      const placeholder = document.createElement('span');
      placeholder.id = 'depMenuPlaceholder-' + group;
      placeholder.style.display = 'none';
      originalParent.insertBefore(placeholder, menu);
      document.body.appendChild(menu);
      menu._originalParent = originalParent;
      menu._placeholder = placeholder;

      // Backdrop overlay — same z-index level; menu is now on body so it will be truly above
      const overlay = document.createElement('div');
      overlay.id = 'depCopyOverlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,0.5);';
      overlay.addEventListener('click', () => _depCloseAllCopyMenus());
      overlay.addEventListener('touchend', (e) => {
        // Only close if tap is directly on overlay, not on the menu
        if (e.target === overlay) { e.preventDefault(); _depCloseAllCopyMenus(); }
      });
      document.body.appendChild(overlay);
    } else {
      // Desktop: simple outside-click close
      setTimeout(() => {
        const close = e => {
          if (menu.contains(e.target)) return;
          menu.classList.remove('open');
          document.removeEventListener('click', close);
        };
        document.addEventListener('click', close);
      }, 10);
    }
  }
}

function _depCloseAllCopyMenus() {
  document.querySelectorAll('.dep-copy-menu.open').forEach(m => {
    m.classList.remove('open');
    // Return teleported menus to their original parent
    if (m._placeholder && m._originalParent) {
      m._originalParent.insertBefore(m, m._placeholder);
      m._placeholder.remove();
      m._placeholder = null;
      m._originalParent = null;
    }
  });
  _depRemoveCopyOverlay();
}

function _depRemoveCopyOverlay() {
  const el = document.getElementById('depCopyOverlay');
  if (el) el.remove();
}

// ══════════════════════════════════════════════════════════════
//  SELECTION MODE  —  v2
//  · Card click = toggle (no double-fire bug)
//  · Smart select: auto-picks rooms by time window
//  · Multi-type: can select out + na in one go
//  · Floating tray stays visible while scrolling
// ══════════════════════════════════════════════════════════════

let _selGroup = null;   // 'na' | 'out' | 'extended' | 'mixed'
let _selRooms = new Set();

// ── Enter selection mode ──────────────────────────────────
function depStartSelect(group) {
  _selGroup = group;
  _selRooms = new Set();
  const chip = document.querySelector(`[data-f="${group}"]`);
  if (chip) depFilter(group, chip);
  depRender();
  _showSelTray();
  _updateSelTray();
}

// ── Smart select: auto-pick by time window ────────────────
function depSmartSelect(group, mins) {
  _selGroup = group;
  _selRooms = new Set();

  const now    = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const cutoff = nowMin - mins;

  if (group === 'out') {
    depRooms.filter(r => {
      if (r.status !== 'out') return false;
      if (!r.checkoutAt) return false;
      const t = _parseLcoTime(r.checkoutAt);
      if (t === null) return false;
      return cutoff < 0 ? (t >= cutoff + 1440 || t >= 0) : t >= cutoff;
    }).forEach(r => _selRooms.add(r.roomStr));
  } else if (group === 'na') {
    depRooms.filter(r => {
      if (r.status !== 'na') return false;
      if (!r.naTime) return false;
      const t = _parseLcoTime(r.naTime);
      if (t === null) return false;
      return cutoff < 0 ? (t >= cutoff + 1440 || t >= 0) : t >= cutoff;
    }).forEach(r => _selRooms.add(r.roomStr));
  }

  const chip = document.querySelector(`[data-f="${group}"]`);
  if (chip) depFilter(group, chip);
  depRender();
  _showSelTray();
  _updateSelTray();

  if (_selRooms.size === 0) {
    const label = mins < 60 ? `${mins} min` : `${mins / 60}h`;
    showToast(`No rooms in the last ${label} — showing all`, 'info');
    depRooms.filter(r => r.status === group).forEach(r => _selRooms.add(r.roomStr));
    depRender();
    _updateSelTray();
  }
}

// ── Toggle one card ───────────────────────────────────────
function depToggleSelect(roomStr) {
  if (_selRooms.has(roomStr)) _selRooms.delete(roomStr);
  else _selRooms.add(roomStr);
  // Lightweight DOM update — no full re-render needed
  document.querySelectorAll('.dep-card').forEach(card => {
    const rs = card.dataset.room;
    if (rs !== roomStr) return;
    const selected = _selRooms.has(rs);
    card.classList.toggle('dep-sel-active', selected);
    const tick = card.querySelector('.dep-sel-tick');
    if (tick) tick.classList.toggle('checked', selected);
  });
  _updateSelTray();
}

// ── Select all / none ─────────────────────────────────────
function depSelectAll() {
  depRooms.filter(r => r.status === _selGroup).forEach(r => _selRooms.add(r.roomStr));
  depRender();
  _updateSelTray();
}

function depSelectNone() {
  _selRooms = new Set();
  depRender();
  _updateSelTray();
}

// ── Cancel ────────────────────────────────────────────────
function depCancelSelect() {
  _selGroup = null;
  _selRooms = new Set();
  depRender();
  _hideSelTray();
}

// ── Floating tray ─────────────────────────────────────────
function _showSelTray() {
  const tray = document.getElementById('depSelTray');
  if (tray) tray.classList.add('visible');
}
function _hideSelTray() {
  const tray = document.getElementById('depSelTray');
  if (tray) tray.classList.remove('visible');
}

function _updateSelTray() {
  const total = depRooms.filter(r => r.status === _selGroup).length;
  const n     = _selRooms.size;

  const lbl = document.getElementById('selTrayLabel');
  if (lbl) {
    lbl.textContent = n === 0
      ? `Tap rooms to select · ${total} available`
      : `${n} room${n > 1 ? 's' : ''} selected`;
  }

  const copyBtn = document.getElementById('selTrayCopy');
  if (copyBtn) {
    copyBtn.textContent = n ? `📋 Copy ${n} Room${n > 1 ? 's' : ''}` : '📋 Copy';
    copyBtn.disabled = n === 0;
    copyBtn.style.opacity = n ? '1' : '0.4';
  }

  // Flash the count pill
  const pill = document.getElementById('selTrayCount');
  if (pill) {
    pill.textContent = n || '';
    pill.style.display = n ? 'flex' : 'none';
  }
}

function depCopySelected() {
  if (!_selRooms.size) { showToast('No rooms selected', 'info'); return; }
  const rooms = depRooms.filter(r => _selRooms.has(r.roomStr));
  const time  = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  let text = '';

  if (_selGroup === 'na') {
    const lines = rooms.map(r => `📵 ${r.roomStr} · ${r.naTime || time}`);
    text = `📵 *NA Rooms — ${time}*\n${lines.join('\n')}`;

  } else if (_selGroup === 'out') {
    const sorted = [...rooms].sort((a, b) => _coTimeSort(b, a));
    const lines  = sorted.map(r => `✓ ${r.roomStr} · ${r.checkoutAt || time}`);
    text = `✅ *Checked Out — ${time}*\n${lines.join('\n')}`;

  } else if (_selGroup === 'extended') {
    const lines = rooms.map(r => _extLine(r));
    text = `↪ *Extensions — ${time}*\n${lines.join('\n')}`;
  }

  copyToClipboard(text, null, '');
  showToast(`${_selRooms.size} room${_selRooms.size > 1 ? 's' : ''} copied ✓`, 'ok');
  depCancelSelect();
}

// ── NA copy ────────────────────────────────────────────────
function depCopyNAList(mode) {
  const rooms = depRooms.filter(r => r.status === 'na');
  if (!rooms.length) { showToast('No rooms marked No Answer', 'info'); return; }
  const time = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  let text = '';
  if (mode === 'summary') {
    text = `📵 *NA — ${time}*\nRooms: ${rooms.map(r => r.roomStr).join(', ')}`;
  } else {
    const lines = rooms.map(r => `📵 ${r.roomStr} · ${r.naTime || time}`);
    text = `📵 *NA Rooms — ${time}*\n${lines.join('\n')}`;
  }
  copyToClipboard(text, null, '');
  showToast('NA list copied ✓', 'ok');
}

// ── Out copy ───────────────────────────────────────────────
function depCopyOutList(mode) {
  const rooms = depRooms.filter(r => r.status === 'out');
  if (!rooms.length) { showToast('No checked-out rooms yet', 'info'); return; }
  const time = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  let text = '';
  if (mode === 'summary') {
    text = `✅ *Checked Out — ${time}*\nRooms: ${rooms.map(r => r.roomStr).join(', ')}`;
  } else {
    const sorted = [...rooms].sort((a, b) => _coTimeSort(b, a)); // newest first
    const lines = sorted.map(r => `✓ ${r.roomStr} · ${r.checkoutAt || time}`);
    text = `✅ *Checked Out Rooms — ${time}*\n${lines.join('\n')}`;
  }
  copyToClipboard(text, null, '');
  showToast('Checkout list copied ✓', 'ok');
}

// ── Recent checkout copy (for HK — last N minutes only) ───
function depCopyOutRecent(mins) {
  const now    = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const cutoff = nowMin - mins;

  const rooms = depRooms.filter(r => {
    if (r.status !== 'out') return false;
    if (!r.checkoutAt) return false; // no timestamp — skip
    const t = _parseLcoTime(r.checkoutAt);
    if (t === null) return false;
    // handle midnight wrap: if cutoff goes negative, anything after 00:00 also qualifies
    return cutoff < 0 ? (t >= cutoff + 1440 || t >= 0) : t >= cutoff;
  });

  const time = now.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });

  if (!rooms.length) {
    showToast(`No checkouts in the last ${mins} min`, 'info');
    return;
  }

  const sorted = [...rooms].sort((a, b) => _coTimeSort(b, a)); // newest first
  const lines  = sorted.map(r => `✓ ${r.roomStr} · ${r.checkoutAt}`);
  const label  = mins < 60 ? `last ${mins} min` : `last ${mins / 60}h`;
  const text   = `✅ *Checked Out (${label}) — ${time}*\n${lines.join('\n')}`;

  copyToClipboard(text, null, '');
  showToast(`${rooms.length} room${rooms.length > 1 ? 's' : ''} copied (${label}) ✓`, 'ok');
}

// ── Sort helper: compare two rooms by checkoutAt time (asc) ─
function _coTimeSort(a, b) {
  const ta = _parseLcoTime(a.checkoutAt);
  const tb = _parseLcoTime(b.checkoutAt);
  if (ta === null && tb === null) return 0;
  if (ta === null) return 1;
  if (tb === null) return -1;
  return ta - tb;
}

// ── Ext copy ───────────────────────────────────────────────
function _extLine(r) {
  const n       = r.extensionNights || 1;
  const origDep = parseOperaDate(r.departure);
  let newDep = '';
  if (origDep) {
    const nd = new Date(origDep); nd.setDate(nd.getDate() + n);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    newDep = ` → ${String(nd.getDate()).padStart(2,'0')} ${months[nd.getMonth()]}`;
  }
  
  return `↪ ${r.roomStr} · +${n}N${newDep}`;
}

function depCopyExtList(mode) {
  const rooms = depRooms.filter(r => r.status === 'extended');
  if (!rooms.length) { showToast('No extended rooms', 'info'); return; }
  const time = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  let text = '';
  if (mode === 'summary') {
    text = `↪ *Extensions — ${time}*\nRooms: ${rooms.map(r => r.roomStr + ' +' + (r.extensionNights||1) + 'N').join(', ')}`;
  } else {
    text = `↪ *Extensions — ${time}*\n${rooms.map(_extLine).join('\n')}`;
  }
  copyToClipboard(text, null, '');
  showToast('Extensions copied ✓', 'ok');
}

// ── HK Full Status Update ─────────────────────────────────
// Shows only rooms that still need action (due, late, NA, extended).
// Checked-out rooms are NOT included — HK already has those from the
// individual checkout copies. This is the "what's left" message.
function depCopyHKUpdate() {
  if (!depRooms.length) { showToast('No rooms loaded', 'info'); return; }
  const time = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });

  const HK_LABEL = {
    extended: '↪ EXT',
    late:     '🕐 LCO',
    na:       '📵 NA',
    due:      '⏳ DUE',
  };

  // Only include rooms that still need action — exclude checked-out
  const sorted = [...depRooms]
    .filter(r => effectiveStatus(r) !== 'out' && effectiveStatus(r) !== 'extended')
    .sort((a, b) => parseInt(a.room) - parseInt(b.room));

  const sc = depCounts();
  const summary = [
    sc.late     ? `🕐 ${sc.late} LCO`                                   : '',
    sc.na       ? `📵 ${sc.na} NA`                                       : '',
    sc.due      ? `⏳ ${sc.due} still due`                               : '',
    (sc.out || sc.extended) ? `✅ ${sc.out + sc.extended} done (${sc.out} CO · ${sc.extended} EXT)` : '',
  ].filter(Boolean).join('  ·  ');

  if (!sorted.length) {
    const text = `🏨 *HK Status — ${time}*\n✅ All rooms resolved — floor clear! (${sc.out} CO · ${sc.extended} EXT)`;
    copyToClipboard(text, null, '');
    hkStampCopy();
    showToast('HK update copied ✓', 'ok');
    return;
  }

  const lines = sorted.map(r => {
    const es = effectiveStatus(r);
    let label = HK_LABEL[es] || '⏳ DUE';
    if (r.status === 'extended' && r.extensionNights) label += ` +${r.extensionNights}n`;
    if (es === 'late' && r.lateTime)                  label += ` ${r.lateTime}`;
    if (r.intent === 'maybe_extend' && es !== 'extended') label = `⏳ Extending`;
    if (r.balance > 0 && es !== 'extended')           label += ` 💳`;
    return `${r.roomStr.padEnd(5)} ${label}`;
  });

  const mayExtCount = sorted.filter(r => r.intent === 'maybe_extend' && effectiveStatus(r) !== 'extended').length;
  const finalSummary = [
    sc.late     ? `🕐 ${sc.late} LCO`           : '',
    sc.na       ? `📵 ${sc.na} NA`               : '',
    sc.extended ? `↪ ${sc.extended} EXT`         : '',
    mayExtCount ? `🤔 ${mayExtCount} may extend`  : '',
    sc.due      ? `⏳ ${sc.due} still due`        : '',
    sc.out      ? `✅ ${sc.out} CO done`          : '',
  ].filter(Boolean).join('  ·  ');

  const text = `🏨 *HK Update — ${time}*\n${finalSummary}\n\n${lines.join('\n')}`;
  copyToClipboard(text, null, '');
  hkStampCopy();
  showToast(`HK update copied (${sorted.length} pending) ✓`, 'ok');
}

// ── HK Remaining — what's still on the floor ─────────────
// Same as above but exported for the "Remaining" button
function depCopyHKRemaining() {
  depCopyHKUpdate();
}

function depFilter(f, el) {
  depFilter_ = f;
  document.querySelectorAll('[data-f]').forEach(c => c.classList.remove('on','due','ext','late','bal','out','pending','na'));
  const btn = el || document.querySelector(`[data-f="${f}"]`);
  if (btn) {
    btn.classList.add('on');
    const map = { due:'due', extended:'ext', late:'late', balance:'bal', out:'out', pending:'pending', na:'na', maybe_extend:'ext' };
    if (map[f]) btn.classList.add(map[f]);
  }
  // When switching to 'out' view, reset to smart sort (which auto-sorts newest-first)
  if (f === 'out' && depSort.key !== 'smart') {
    depSort = { key: 'smart', dir: 1 };
    document.querySelectorAll('.dep-sort-btn').forEach(b => {
      const active = b.dataset.s === 'smart';
      b.classList.toggle('on', active);
      const arrow = b.querySelector('.sort-arrow');
      if (arrow) arrow.textContent = '';
    });
  }
  // Update sort label hint for checked-out view
  const sortLbl = document.getElementById('depSortLbl');
  if (sortLbl) sortLbl.textContent = f === 'out' ? '↓ Latest checkout first' : '';
  depRender();
}

function setDepSize(size, el) {
  depSize = size;
  document.querySelectorAll('.vt-btn').forEach(b => b.classList.remove('on'));
  if (el) el.classList.add('on');
  const grid = document.getElementById('depGrid');
  if (grid) grid.className = 'dep-grid size-' + size;
}

function updateDepBadge() {
  const sc  = depCounts();
  const active = sc.due + sc.late + sc.na;
  const el  = document.getElementById('badge-departures');
  if (el) el.textContent = active || '0';
}

// ── Bulk checkout ──────────────────────────────────────────
function depBulkCheckout() {
  const dueRooms   = depRooms.filter(r => effectiveStatus(r) === 'due');
  const withBalance = dueRooms.filter(r => r.balance > 0);
  if (withBalance.length) {
    if (!confirm(`${withBalance.length} due-out room(s) have an outstanding balance.\n\nCheck out ALL due-out rooms anyway?`)) return;
  } else {
    if (!confirm('Mark ALL due-out rooms as checked out?')) return;
  }
  const t = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  dueRooms.forEach(r => {
    const i = depRooms.indexOf(r);
    r.status = 'out'; r.checkoutAt = t;
    depLog.unshift({ room: r.roomStr, name: r.name, action:'out', time:t, roomIdx:i, prevStatus:'due' });
  });
  depRender();
  updateDepBadge();
  saveDeps();
}

// ── Clear ──────────────────────────────────────────────────
function clearDep() {
  if (!confirm('Clear the departure board and start fresh?')) return;
  depRooms = []; depFilter_ = 'all'; depLog = [];
  document.getElementById('depBoard').style.display      = 'none';
  document.getElementById('depUploadCard').style.display = 'block';
  document.getElementById('depInput').value              = '';
  document.getElementById('depDateLabel').textContent    = "Today's departures · Load Opera report to begin";
  const b = document.getElementById('badge-departures'); if (b) b.textContent = '0';
  const hkBar = document.getElementById('depHKBar'); if (hkBar) hkBar.style.display = 'none';
  ['depPrintBtn','depExportBtn','depViewToggle','depReloadBtn'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  saveDeps();
}

// ── Export ─────────────────────────────────────────────────
function exportDepSummary() {
  if (!depRooms.length) return;
  const wb   = XLSX.utils.book_new();
  const data = [['Room','Guest','Arrival','Departure','Nights','Balance AED','Source','Company','Status','Intent','Late Time','Ext Nights','Checkout At','Notes']];
  depRooms.forEach(r => data.push([
    r.roomStr, r.name, r.arrival, r.departure, r.nights, r.balance,
    r.source, r.company, r.status.toUpperCase(),
    r.intent ? INTENT_CONFIG[r.intent]?.label || r.intent : '',
    r.lateTime, r.extensionNights || '', r.checkoutAt, r.note,
  ]));
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [8,24,12,12,7,12,20,22,12,16,10,8,10,40].map(w => ({wch:w}));
  XLSX.utils.book_append_sheet(wb, ws, 'Departures');
  XLSX.writeFile(wb, 'Departures_' + new Date().toISOString().split('T')[0] + '.xlsx');
}

function depPrintList() { window.print(); }
// ── LCO Time Picker ────────────────────────────────────────
function depAskLCO(i) {
  const r = depRooms[i];
  const existing = document.getElementById('lcoPickerOverlay');
  if (existing) existing.remove();
  document.getElementById('lcoStyle')?.remove();

  // Read the current theme so colours always match
  const theme = document.documentElement.getAttribute('data-theme') || 'night-ops';
  const isOpera = theme === 'opera';

  const C = isOpera ? {
    bg:       '#FFFFFF',
    surface:  '#F5F5F5',
    border:   '#E0E0E0',
    text:     '#1D1D1B',
    text2:    '#4A4A4A',
    text3:    '#888888',
  } : {
    bg:       theme === 'midnight' ? '#192038' : '#161d28',
    surface:  theme === 'midnight' ? '#141b30' : '#111620',
    border:   theme === 'midnight' ? '#253050' : '#1f2d42',
    text:     theme === 'midnight' ? '#e2e8f4' : '#dce4f0',
    text2:    theme === 'midnight' ? '#7b8db0' : '#7f92aa',
    text3:    theme === 'midnight' ? '#4a5570' : '#3d5268',
  };
  const amber = '#f0a43a';

  const style = document.createElement('style');
  style.id = 'lcoStyle';
  style.textContent = `
    #lcoPicker {
      background:${C.bg};
      border:1px solid ${C.border};
      border-radius:14px;
      padding:28px;
      width:300px;
      box-shadow:0 32px 80px rgba(0,0,0,0.45);
    }
    #lcoPicker .lco-tag  { font-size:0.58rem;font-family:var(--mono,monospace);letter-spacing:0.18em;color:${amber};text-transform:uppercase;margin-bottom:10px; }
    #lcoPicker .lco-room { font-size:1rem;font-weight:600;color:${C.text};margin-bottom:2px; }
    #lcoPicker .lco-name { font-size:0.75rem;color:${C.text2};margin-bottom:22px; }
    #lcoPicker .lco-lbl  { font-size:0.65rem;color:${C.text2};margin-bottom:10px;font-family:var(--mono,monospace);letter-spacing:0.1em; }
    #lcoQuickBtns { display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:14px; }
    #lcoQuickBtns button {
      all:unset;
      display:block;
      box-sizing:border-box;
      padding:9px 4px;
      text-align:center;
      background:${C.surface};
      border:1px solid ${C.border};
      border-radius:7px;
      color:${C.text};
      font-family:var(--mono,monospace);
      font-size:0.67rem;
      cursor:pointer;
      transition:all 0.15s;
    }
    #lcoQuickBtns button:hover { border-color:rgba(240,164,58,0.4);color:${amber}; }
    #lcoQuickBtns button.lco-active { background:rgba(240,164,58,0.15);border-color:rgba(240,164,58,0.5);color:${amber}; }
    #lcoCustomInput {
      all:unset;
      display:block;
      box-sizing:border-box;
      width:100%;
      background:${C.surface};
      border:1px solid ${C.border};
      border-radius:8px;
      padding:10px 14px;
      color:${C.text};
      font-size:0.85rem;
      font-family:var(--mono,monospace);
      margin-bottom:18px;
    }
    #lcoCustomInput:focus { border-color:rgba(240,164,58,0.5);outline:none; }
    #lcoCustomInput::placeholder { color:${C.text3}; }
    #lcoConfirmBtn {
      all:unset;
      display:block;
      box-sizing:border-box;
      flex:1;
      padding:11px;
      text-align:center;
      background:rgba(240,164,58,0.13);
      border:1px solid rgba(240,164,58,0.4);
      color:${amber};
      border-radius:8px;
      font-size:0.82rem;
      font-weight:500;
      cursor:pointer;
    }
    #lcoConfirmBtn:hover { background:rgba(240,164,58,0.22); }
    #lcoCancelBtn {
      all:unset;
      display:block;
      box-sizing:border-box;
      padding:11px 18px;
      text-align:center;
      background:transparent;
      border:1px solid ${C.border};
      color:${C.text2};
      border-radius:8px;
      font-size:0.82rem;
      cursor:pointer;
    }
    #lcoCancelBtn:hover { color:${C.text}; }
  `;
  document.head.appendChild(style);

  const QUICK = ['10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','15:00','16:00','18:00'];

  const overlay = document.createElement('div');
  overlay.id = 'lcoPickerOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;';

  overlay.innerHTML = `
    <div id="lcoPicker">
      <div class="lco-tag">🕐 Late Checkout</div>
      <div class="lco-room">Room ${r.roomStr}</div>
      <div class="lco-name">${r.name}</div>
      <div class="lco-lbl">AGREED TIME</div>
      <div id="lcoQuickBtns">
        ${QUICK.map(t => `<button data-t="${t}" onclick="lcoQuickPick('${t}')">${t}</button>`).join('')}
      </div>
      <input id="lcoCustomInput" type="text" placeholder="or type e.g. 12:45" maxlength="5" value="${r.lateTime || ''}" />
      <div style="display:flex;gap:8px;">
        <button id="lcoConfirmBtn" onclick="lcoConfirm(${i})">Set Late CO</button>
        <button id="lcoCancelBtn" onclick="document.getElementById('lcoPickerOverlay').remove();document.getElementById('lcoStyle')?.remove();">Cancel</button>
      </div>
    </div>
  `;

  window.lcoQuickPick = function(t) {
    document.getElementById('lcoCustomInput').value = t;
    document.querySelectorAll('#lcoQuickBtns button').forEach(b => {
      b.classList.toggle('lco-active', b.dataset.t === t);
    });
  };

  window.lcoConfirm = function(idx) {
    const time = (document.getElementById('lcoCustomInput').value || '').trim();
    if (!time) { showToast('Pick or type a time first', 'err'); return; }
    document.getElementById('lcoPickerOverlay').remove();
    document.getElementById('lcoStyle')?.remove();
    depRooms[idx].lateTime = time;
    depAction(idx, 'late');
  };

  const cleanup = () => { document.getElementById('lcoStyle')?.remove(); };
  overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); cleanup(); } });
  document.body.appendChild(overlay);
  if (r.lateTime) lcoQuickPick(r.lateTime);
  setTimeout(() => document.getElementById('lcoCustomInput')?.focus(), 50);
}

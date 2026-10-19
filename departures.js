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

// ── Overdue LCO Alerts — sound + browser notification ──────
let _alertedRooms      = new Set();
let _depAlertTickerID  = null;
let depAlertsOn        = localStorage.getItem('dep_alerts') !== 'off';

function depToggleAlerts() {
  depAlertsOn = !depAlertsOn;
  localStorage.setItem('dep_alerts', depAlertsOn ? 'on' : 'off');
  if (depAlertsOn && 'Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  _renderAlertToggle();
  showToast(depAlertsOn ? '🔔 Overdue alerts ON' : '🔕 Overdue alerts OFF', 'info');
  if (depAlertsOn) _depCheckOverdueAlerts();
}

function _renderAlertToggle() {
  const btn = document.getElementById('depAlertToggle');
  if (!btn) return;
  btn.textContent = depAlertsOn ? '🔔' : '🔕';
  btn.classList.toggle('on', depAlertsOn);
}

// Two-tone beep synthesised with Web Audio — no external file,
// works fully offline (important for the PWA install).
function _depBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const ping = (freq, delay, dur) => setTimeout(() => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.start(); o.stop(ctx.currentTime + dur);
    }, delay);
    ping(880, 0, 0.45);
    ping(660, 220, 0.35);
  } catch (e) { /* Web Audio unavailable/blocked — fail silently */ }
}

function _depCheckOverdueAlerts() {
  if (!depAlertsOn || typeof depRooms === 'undefined' || !depRooms.length) return;
  if (typeof hoQuiet === 'function' && hoQuiet()) return;   // not on shift today
  _renderAlertToggle();

  const overdueNow = depRooms.filter(r => {
    const es = effectiveStatus(r);
    if (r.intent === 'extending') return es !== 'out' && es !== 'extended' && _depIsOverdue(r);   // ⏳ paperwork not done by 6 PM
    return isLcoOverdue(r) && es !== 'out' && es !== 'extended' && es !== 'na' && es !== 'dnd';
  });
  // Rooms that resolved since the last check can re-alert if they somehow
  // become overdue again later (e.g. LCO time re-set).
  const stillOverdueSet = new Set(overdueNow.map(r => r.roomStr));
  _alertedRooms.forEach(rm => { if (!stillOverdueSet.has(rm)) _alertedRooms.delete(rm); });

  const newlyOverdue = overdueNow.filter(r => !_alertedRooms.has(r.roomStr));
  if (!newlyOverdue.length) return;
  newlyOverdue.forEach(r => _alertedRooms.add(r.roomStr));

  _depBeep();
  if ('Notification' in window && Notification.permission === 'granted') {
    const names = newlyOverdue.slice(0, 3).map(r => `${r.roomStr} (${r.name})`).join(', ');
    try {
      new Notification('⚠ Late checkout overdue', {
        body: newlyOverdue.length > 3 ? `${names} +${newlyOverdue.length - 3} more` : names,
        tag:  'dep-overdue',
      });
    } catch (e) {}
  }
  const nx = newlyOverdue.filter(r => r.intent === 'extending');
  if (nx.length) showToast(`⏳ 6 PM passed: ${nx.map(r => r.roomStr).join(', ')} still not extended (${nx.map(r => depExtWaiting(r).join(', ') || 'mark extended').join(' · ')})`, 'err');
  if (newlyOverdue.length > nx.length) showToast(`⚠ ${newlyOverdue.length - nx.length} room${newlyOverdue.length - nx.length > 1 ? 's' : ''} overdue for checkout`, 'err');
}

function _depStartAlertTicker() {
  if (_depAlertTickerID) return;
  _depAlertTickerID = setInterval(_depCheckOverdueAlerts, 60000);
}
_depStartAlertTicker();

// ── Click ripple feedback ───────────────────────────────────
// Delegated + capture-phase on the grid container so re-renders (which
// replace innerHTML) never need rebinding, and buttons that call
// event.stopPropagation() in their own onclick still trigger it — capture
// fires on the way down, before that stopPropagation runs on the target.
function _depInitRipple() {
  const grid = document.getElementById('depGrid');
  if (!grid || grid._rippleBound) return;
  grid._rippleBound = true;

  grid.addEventListener('click', e => {
    const el = e.target.closest('.dca, .dc-copy-card-btn, .dc-stamp-btn');
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.6;
    const ripple = document.createElement('span');
    ripple.className = 'dc-ripple';
    ripple.style.width  = size + 'px';
    ripple.style.height = size + 'px';
    ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
    ripple.style.top  = (e.clientY - rect.top  - size / 2) + 'px';
    el.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  }, true);
}

// ── Swipe gestures (mobile) ─────────────────────────────────
// Swipe a card right → quick checkout · swipe left → mark DND.
// Attached once, delegated on the grid container so re-renders
// (which replace innerHTML) don't need to re-bind anything.
let _swipeCard = null, _swipeStartX = 0, _swipeStartY = 0, _swiping = false;
const DEP_SWIPE_THRESHOLD = 90;

function _depInitSwipe() {
  const grid = document.getElementById('depGrid');
  if (!grid || grid._swipeBound) return;
  grid._swipeBound = true;

  grid.addEventListener('touchstart', e => {
    const card = e.target.closest('.dep-card');
    if (!card || card.classList.contains('dep-sel-active')) return;
    if (typeof _selGroup !== 'undefined' && _selGroup) return; // don't fight bulk-select mode
    _swipeCard   = card;
    _swipeStartX = e.touches[0].clientX;
    _swipeStartY = e.touches[0].clientY;
    _swiping     = false;
  }, { passive: true });

  grid.addEventListener('touchmove', e => {
    if (!_swipeCard) return;
    const dx = e.touches[0].clientX - _swipeStartX;
    const dy = e.touches[0].clientY - _swipeStartY;
    if (!_swiping && Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.5) _swiping = true;
    if (_swiping) {
      _swipeCard.style.transform = `translateX(${dx}px)`;
      _swipeCard.classList.toggle('dc-swipe-right', dx > 30);
      _swipeCard.classList.toggle('dc-swipe-left',  dx < -30);
    }
  }, { passive: true });

  grid.addEventListener('touchend', e => {
    if (!_swipeCard) return;
    const card = _swipeCard;
    const dx   = e.changedTouches[0].clientX - _swipeStartX;
    card.style.transform = '';
    card.classList.remove('dc-swipe-right', 'dc-swipe-left');

    if (_swiping && Math.abs(dx) > DEP_SWIPE_THRESHOLD) {
      const room = card.dataset.room;
      const idx  = depRooms.findIndex(r => r.roomStr === room);
      if (idx >= 0) {
        const r  = depRooms[idx];
        const es = effectiveStatus(r);
        if (navigator.vibrate) navigator.vibrate(15);
        if (dx > 0 && es !== 'out' && es !== 'extended') {
          depCheckOut(idx);
          showToast(`✓ Room ${room} checked out (swipe)`, 'ok');
        } else if (dx < 0 && es !== 'out' && es !== 'extended' && es !== 'dnd') {
          depAction(idx, 'dnd');
          showToast(`🚫 Room ${room} marked DND (swipe)`, 'info');
        }
      }
    }
    _swipeCard = null; _swiping = false;
  });
}

// ── Weekly trend tracking ────────────────────────────────────
// Snapshots today's counts to hotels/{HOTEL_ID}/depTrends/{date}
// (debounced — depRender fires on every keystroke, we don't need
// a write that often). Old days accumulate automatically.
let _depTrendTimer = null;

function _depQueueTrendSnapshot() {
  clearTimeout(_depTrendTimer);
  _depTrendTimer = setTimeout(_depSaveTrendSnapshot, 5000);
}

async function _depSaveTrendSnapshot() {
  if (typeof depRooms === 'undefined' || !depRooms.length) return;
  if (typeof fbSet !== 'function') return;
  const today = hoLocalISO();
  const c = depCounts();
  try {
    await fbSet('depTrends/' + today, {
      date: today, total: c.all, due: c.due, late: c.late,
      extended: c.extended, out: c.out, na: c.na, dnd: c.dnd, balance: c.balance,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) { /* offline — fbSet already falls back to localStorage */ }
}

async function depShowTrends() {
  const modal = document.getElementById('depTrendsModal');
  const body  = document.getElementById('depTrendsBody');
  if (!modal || !body) return;
  modal.classList.add('open');
  body.innerHTML = `<div class="gs-empty">Loading trend history…</div>`;

  let days = [];
  try {
    const snap = await fbGet('depTrends');
    days = Object.values(snap || {}).sort((a, b) => a.date < b.date ? -1 : 1).slice(-7);
  } catch (e) {}

  if (!days.length) {
    body.innerHTML = `<div class="gs-empty">No trend history yet — check back after a few days of use.</div>`;
    return;
  }

  const maxLate = Math.max(1, ...days.map(d => d.late || 0));
  const maxExt  = Math.max(1, ...days.map(d => d.extended || 0));
  const avgLate = (days.reduce((s, d) => s + (d.late || 0), 0) / days.length).toFixed(1);
  const avgExt  = (days.reduce((s, d) => s + (d.extended || 0), 0) / days.length).toFixed(1);
  const avgBal  = (days.reduce((s, d) => s + (d.balance || 0), 0) / days.length).toFixed(1);

  const bars = (label, key, max, color) => `
    <div class="ho-section">
      <div class="ho-section-title">${label}</div>
      <div class="dep-trend-chart">
        ${days.map(d => `
          <div class="dep-trend-col">
            <div class="dep-trend-bar" style="height:${Math.max(4, (d[key] || 0) / max * 60)}px;background:${color};" title="${d[key] || 0}"></div>
            <div class="dep-trend-val">${d[key] || 0}</div>
            <div class="dep-trend-day">${d.date.slice(5)}</div>
          </div>`).join('')}
      </div>
    </div>`;

  body.innerHTML = `
    <div class="ho-section">
      <div class="ho-snap-row">Avg late checkouts/day: <strong>${avgLate}</strong></div>
      <div class="ho-snap-row">Avg extensions/day: <strong>${avgExt}</strong></div>
      <div class="ho-snap-row">Avg rooms w/ balance owing: <strong>${avgBal}</strong></div>
    </div>
    ${bars('🕐 Late Checkouts', 'late', maxLate, 'var(--amber)')}
    ${bars('↪ Extensions', 'extended', maxExt, 'var(--sky)')}`;
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
  _depLastSt = null;

  document.getElementById('depInput').value = '';
  const totalToday = depRooms.length;
  document.getElementById('depDateLabel').textContent = `${totalToday} rooms departing · ${depRooms[0]?.departure || ''}`;
  document.getElementById('depBoard').style.display      = 'block';
  document.getElementById('depUploadCard').style.display = 'none';
  ['depPrintBtn','depExportBtn','depViewToggle','depReloadBtn','depAlertToggle','depTrendsBtn'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = '';
  });

  depRender();
  updateDepBadge();
  const n = depRooms.length, when = _depDateLabel(_depBoardDate()) || 'today';
  saveDepartures(depRooms, depLog).then(() => showToast(`✓ ${n} departures loaded for ${when}`, 'ok'));
  if (typeof depSetBase === 'function') depSetBase(depRooms, depLog);
  if (typeof logActivity === 'function') logActivity('dep_loaded', `${n} departures loaded for ${when}`);
}

// ── A room added by hand ───────────────────────────────────
// The report wasn't loaded today, or a room isn't on it (in-house, early
// departure): add it to the board so it can be checked out, made late, etc.
function depAddManualRoom(room, name) {
  room = String(room || '').trim();
  if (!/^\d{1,5}[A-Za-z]?$/.test(room)) { showToast('Write the room number', 'warn'); return false; }
  if (depRooms.some(r => String(r.roomStr).trim() === room)) { showToast(`Room ${room} is already on the board`, 'warn'); return false; }
  const today = hoLocalISO();
  depRooms.push({
    room: parseInt(room), roomStr: room, name: String(name || '').trim().toUpperCase() || '—',
    arrival: '', departure: today, nights: 0, balance: 0, source: '', company: '', rateCode: '', isVip: false, depTime: '',
    status: 'due', lateTime: '', extensionNights: 0, intent: '', note: '', checkoutAt: '', manual: true,
  });
  depRooms.sort((a, b) => a.room - b.room);
  ['depBoard'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'block'; });
  const up = document.getElementById('depUploadCard'); if (up) up.style.display = 'none';
  ['depPrintBtn','depExportBtn','depViewToggle','depReloadBtn','depAlertToggle','depTrendsBtn'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = ''; });
  depRender(); updateDepBadge(); saveDepartures(depRooms, depLog);
  if (typeof logActivity === 'function') logActivity('dep_added', `Room ${room} added by hand`);
  return true;
}
function depAddManualPrompt(room) {
  room = room || prompt('Room number');
  if (!room) return;
  const name = prompt(`Guest name in room ${room} (optional)`) || '';
  if (depAddManualRoom(room, name)) showToast(`Room ${room} added to today's departures`, 'ok');
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
      // fresh Opera data (name, balance, dates) over everything tracked on the board (extension rate and
      // reason, DND time, acknowledged late check-out…), then the live tracking itself
      const tracked = {}; Object.keys(old).forEach(k => { if (!(k in fresh)) tracked[k] = old[k]; });
      merged.push({
        ...tracked,
        ...fresh,
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
      if (r.status === 'out' || r.status === 'extended' || r.status === 'na' || r.manual) {   // (a room added by hand isn't in Opera's report: keep it)
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
  const when = _depDateLabel(_depBoardDate()) || 'today';
  saveDepartures(depRooms, depLog).then(() =>
    showToast(`✓ ${freshRooms.length} departures loaded for ${when} · ${kept} kept · ${added} new · ${removed} gone${preservedNote}`, 'ok')
  );
  if (typeof depSetBase === 'function') depSetBase(depRooms, depLog);
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
  const dnd      = depRooms.filter(r => r.status === 'dnd').length;
  return {
    all:          due + late + na + dnd + out + extended,
    due,
    late,
    extended,
    out,
    na,
    dnd,
    balance:      depRooms.filter(r => depOwes(r) && effectiveStatus(r) !== 'out' && effectiveStatus(r) !== 'extended').length,
    maybe_extend: depRooms.filter(r => (r.intent === 'maybe_extend' || r.intent === 'extending') && effectiveStatus(r) !== 'extended').length,
    extending:    depRooms.filter(r => r.intent === 'extending' && effectiveStatus(r) !== 'extended' && effectiveStatus(r) !== 'out').length,
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
  if (r.status === 'due' && r.depTime && !r.lcoAcknowledged && r.intent !== 'extending' && r.intent !== 'finance_hold') {   // ⏳ extending (stays on) or 🧾 left, waiting for Finance: never late
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
  if (r && r.intent === 'finance_hold') return false;          // the guest has already left
  if (r && r.intent === 'extending') return false;             // staying on; only the paperwork is pending
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
  const select = document.getElementById('depSortSelect');
  if (select) select.value = key;
  depRender();
}
// ── Save & restore expanded card + open note state ─────────
function _depSaveOpenState() {
  const expanded = new Set();
  const noteOpen = new Set();
  const noteValues = {};
  document.querySelectorAll('.dep-card').forEach(card => {
    const room = card.dataset.room;
    const body = card.querySelector('.dc-body');
    if (body && !body.classList.contains('dc-body-collapsed')) expanded.add(room);
    const nb = card.querySelector('.dc-note-body');
    if (nb && nb.style.display !== 'none') {
      noteOpen.add(room);
      const ta = nb.querySelector('textarea');
      if (ta) noteValues[room] = ta.value;
    }
  });
  return { expanded, noteOpen, noteValues };
}

function _depRestoreOpenState({ expanded, noteOpen, noteValues }) {
  document.querySelectorAll('.dep-card').forEach(card => {
    const room = card.dataset.room;
    if (expanded.has(room)) {
      const body  = card.querySelector('.dc-body');
      const arrow = card.querySelector('.dc-expand-arrow');
      if (body)  body.classList.remove('dc-body-collapsed');
      if (arrow) arrow.textContent = '▾';
    }
    if (noteOpen.has(room)) {
      const nb    = card.querySelector('.dc-note-body');
      const arrow = card.querySelector('.dc-note-arrow');
      if (nb)    nb.style.display = 'block';
      card.classList.add('dp-note-open');
      if (arrow) arrow.textContent = '▾';
      // Restore any in-progress typed value
      if (noteValues[room] !== undefined) {
        const ta = nb?.querySelector('textarea');
        if (ta) {
          ta.value = noteValues[room];
          // Restore cursor to end
          ta.setSelectionRange(ta.value.length, ta.value.length);
        }
      }
    }
  });
}

// ── Overdue: still in the room past checkout time ──────────
// Late CO rooms count once their agreed time has passed; due / no-answer / DND
// rooms once their Opera departure time (or 12:00 when there is none) has passed.
// Display only: it never changes a room's saved status.
function _depIsOverdue(r) {
  const es = effectiveStatus(r);
  if (es === 'out' || es === 'extended') return false;
  if (r.intent === 'finance_hold') return false;                  // left already; only finance is pending
  if (r.intent === 'extending') {                                  // staying on; booking / TD / payment are due by 6 PM
    const n = new Date(); return n.getHours() * 60 + n.getMinutes() > DEP_EXTG_BY;
  }
  if (es === 'late') return isLcoOverdue(r);
  if (r.lcoAcknowledged) return false;
  const dd = r.departure ? parseOperaDate(r.departure) : null;   // a list for a later day is not late yet
  if (dd && !isNaN(dd) && _depIsoOf(dd) > (typeof hoLocalISO === 'function' ? hoLocalISO() : _depIsoOf(new Date()))) return false;
  const now = new Date(), nowMins = now.getHours() * 60 + now.getMinutes();
  const limit = _depTimeMins(r);
  return nowMins > (limit !== null ? limit : 12 * 60);
}

// The list's date: "17-OCT-26" on the rooms, else the saved date
function _depBoardDate() {
  const r = depRooms.find(x => x.departure && !x.manual) || depRooms.find(x => x.departure);
  const d = r ? parseOperaDate(r.departure) : null;
  if (d && !isNaN(d)) return d;
  if (window._depDate && /^\d{4}-\d{2}-\d{2}$/.test(window._depDate)) { const p = window._depDate.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  return null;
}
function _depIsoOf(d) { return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : ''; }
function _depDateLabel(d, long) { return d ? d.toLocaleDateString('en-GB', long ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' }) : ''; }

// ── Compact / comfortable view (remembered on this device) ──
let depDensity = (() => { try { return localStorage.getItem('dep_density_v1') === 'compact' ? 'compact' : 'comfy'; } catch (_) { return 'comfy'; } })();
function depSetDensity(d) {
  depDensity = d === 'compact' ? 'compact' : 'comfy';
  try { localStorage.setItem('dep_density_v1', depDensity); } catch (_) {}
  _depApplyDensity();
}
function _depApplyDensity() {
  const board = document.getElementById('depBoard');
  if (board) board.classList.toggle('dp-compact', depDensity === 'compact');
  document.querySelectorAll('.dp-dens-btn').forEach(b => { const on = b.dataset.d === depDensity; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
}

// KPI tile tap: filter, tap again to go back to the to-do list
function depKpiTap(key) { depFilter(depFilter_ === key ? 'all' : key); }

// ── Balance that is fine to leave (Expedia / agent / company pays) ──
// Per room: r.balOk = 'Expedia'. For a whole source: settings/depBalanceOk = ['expedia', …] (shared).
let depBalOkSources = [];
function _depSrcKey(r) { return String((r && (r.source || r.company)) || '').trim().toLowerCase(); }
function depBalOk(r) {
  if (!r || !(r.balance > 0)) return false;
  if (r.balOk) return true;
  const k = _depSrcKey(r);
  return !!k && depBalOkSources.some(s => s && k.includes(s));
}
/** Still owes money that someone at the desk has to collect */
function depOwes(r) { return !!r && r.balance > 0 && !depBalOk(r); }
function _depBalWho(r) { return r.balOk && r.balOk !== true ? r.balOk : (r.source || r.company || 'Billed'); }
function depBalListen() {
  if (typeof fbListen !== 'function') return;
  fbListen('settings/depBalanceOk', v => {
    depBalOkSources = (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []).map(x => String(x || '').toLowerCase()).filter(Boolean);
    if (typeof depRender === 'function' && depRooms.length) depRender();
  });
}
function depBalMenu(i, ev) {
  if (ev) { ev.stopPropagation(); ev.preventDefault(); }
  const r = depRooms[i]; if (!r) return;
  document.getElementById('depBalPop')?.remove();
  const src = (r.source || r.company || '').trim(), key = _depSrcKey(r);
  const rule = !!key && depBalOkSources.some(s => key.includes(s));
  const pop = document.createElement('div'); pop.id = 'depBalPop'; pop.className = 'dp-balpop'; pop.setAttribute('role', 'menu');
  const opts = depBalOk(r)
    ? [r.balOk ? ['↩ Show as owing again', () => { delete r.balOk; }] : null,
       rule ? [`Stop treating ${src} balances as OK`, () => { depBalSetRule(key, false); }] : null]
    : [[`✓ OK for room ${r.roomStr} (${src || 'billed'} pays)`, () => { r.balOk = src || 'Billed'; }],
       src ? [`✓ Always OK for ${src} bookings`, () => { depBalSetRule(key, true); }] : null];
  pop.innerHTML = `<div class="dp-balpop-h">AED ${Number(r.balance).toFixed(2)} on room ${escapeHtml(r.roomStr)}</div>` +
    opts.filter(Boolean).map((o, k) => `<button type="button" data-k="${k}">${escapeHtml(o[0])}</button>`).join('') +
    `<button type="button" class="dp-balpop-x" data-x="1">Cancel</button>`;
  document.body.appendChild(pop);
  const list = opts.filter(Boolean);
  pop.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    pop.remove(); if (b.dataset.x) return;
    const o = list[+b.dataset.k]; if (!o) return;
    o[1](); saveDeps(); depRender();
    if (typeof showToast === 'function') showToast(depBalOk(r) ? `Room ${r.roomStr}: balance marked OK` : `Room ${r.roomStr}: balance shows as owing again`, 'ok');
  });
  const at = (ev && ev.currentTarget && ev.currentTarget.getBoundingClientRect) ? ev.currentTarget.getBoundingClientRect() : { left: innerWidth / 2 - 130, bottom: innerHeight / 2 };
  pop.style.left = Math.max(8, Math.min(innerWidth - 288, at.left)) + 'px';
  pop.style.top = Math.min(innerHeight - pop.offsetHeight - 8, at.bottom + 6) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', off, true); } }, true), 0);
}
function depBalSetRule(key, on) {
  const set = new Set(depBalOkSources);
  if (on) set.add(key); else [...set].forEach(s => { if (key.includes(s)) set.delete(s); });
  depBalOkSources = [...set];
  if (typeof fbSet === 'function') fbSet('settings/depBalanceOk', depBalOkSources.length ? depBalOkSources : null);
}
if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', depBalListen); else setTimeout(depBalListen, 0); }

let _depLastSt = null;      // room → status at the last render (for the change flash)
const _depFlashAt = {};     // room → when its status last changed on screen
let _depLastKpi = {};

function depRender() {
  const sc  = depCounts();
  const done = sc.out + sc.extended;
  const pct = sc.all ? Math.round(done / sc.all * 100) : 0;
  const overdueCount = depRooms.filter(_depIsOverdue).length;

  // Push counts to filter chips
  Object.entries(sc).forEach(([k, v]) => {
    const el = document.getElementById('dfc-' + k); if (el) el.textContent = v;
  });
  const ovChip = document.getElementById('dfc-overdue'); if (ovChip) ovChip.textContent = overdueCount;
  // 'To do' chip shows active rooms (due + late + na — what staff still needs to action)
  const activeCount = sc.due + sc.late + sc.na;
  const allChipCount = document.getElementById('dfc-all');
  if (allChipCount) allChipCount.textContent = activeCount;
  document.querySelectorAll('.dp-chips .fchip').forEach(c => {
    const n = parseInt((c.querySelector('span') || {}).textContent, 10);
    c.classList.toggle('dp-zero', c.dataset.f !== 'all' && !n && c.dataset.f !== depFilter_);
    c.setAttribute('aria-pressed', c.dataset.f === depFilter_ ? 'true' : 'false');
  });

  // Balance outstanding total
  const totalOwing = depRooms
        .filter(r => depOwes(r) && r.status !== 'out' && r.status !== 'extended')
    .reduce((s, r) => s + r.balance, 0);
  const balKpiVal = totalOwing > 0
    ? `${totalOwing.toLocaleString('en', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    : '0';

  // ── Hero ──
  const bd = _depBoardDate();
  const isToday = bd && _depIsoOf(bd) === (typeof hoLocalISO === 'function' ? hoLocalISO() : _depIsoOf(new Date()));
  const setTxt = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
  setTxt('depHeroDate', bd ? _depDateLabel(bd, true) : 'Departures');
  const kick = document.getElementById('depHeroKicker');
  if (kick) {
    kick.textContent = !bd ? 'Departures' : isToday ? 'Departures · today' : `Not today's list · ${_depDateLabel(bd)}`;
    kick.classList.toggle('dp-kicker-warn', !!bd && !isToday);
  }
  const toGo = sc.all - done;
  setTxt('depHeroSub', sc.all ? (toGo ? `${toGo} still to go · ${sc.all} rooms` : `All ${sc.all} rooms done 🎉`) : '');
  setTxt('depRingNum', done);
  setTxt('depRingOf', `of ${sc.all} done`);
  const ring = document.getElementById('depRingFill');
  if (ring) { const C = 2 * Math.PI * 52; ring.style.strokeDasharray = C.toFixed(1); ring.style.strokeDashoffset = (C * (1 - pct / 100)).toFixed(1); }
  const ringWrap = document.getElementById('depRing'); if (ringWrap) ringWrap.classList.toggle('dp-ring-done', !!sc.all && pct === 100);
  const lbl = document.getElementById('depDateLabel');
  if (lbl && depRooms.length) lbl.textContent = `${sc.all} rooms departing${bd ? ' · ' + _depDateLabel(bd) : ''}`;

  // ── KPI tiles (tap = filter) ──
  const tiles = [
    ['due',      'Due out',        sc.due,        '⏳', ''],
    ['out',      'Checked out',    sc.out,        '✓',  ''],
    ['late',     'Late check-out', sc.late,       '🕐', ''],
    ['overdue',  'Overdue',        overdueCount,  '⚠',  'past check-out time'],
    ['na',       'No answer',      sc.na,         '📵', ''],
    ['dnd',      'DND',            sc.dnd,        '🚫', ''],
    ['extended', 'Extended',       sc.extended,   '↪',  ''],
    ['balance',  'Open balance',   balKpiVal,     '💳', totalOwing > 0 ? `AED · ${sc.balance} room${sc.balance === 1 ? '' : 's'}` : 'all settled'],
  ];
  const kpiEl = document.getElementById('depKpis');
  if (kpiEl) kpiEl.innerHTML = tiles.map(([k, label, val, ico, sub]) => {
    const on = depFilter_ === k;
    const bump = _depLastKpi[k] !== undefined && String(_depLastKpi[k]) !== String(val);
    const zero = String(val) === '0';
    return `<button class="dp-kpi dp-k-${k}${on ? ' on' : ''}${zero ? ' dp-zero' : ''}" data-kf="${k}" onclick="depKpiTap('${k}')" aria-pressed="${on}" title="Show ${label.toLowerCase()}">
      <span class="dp-kpi-top"><span class="dp-kpi-ico" aria-hidden="true">${ico}</span><span class="dp-kpi-lbl">${label}</span></span>
      <b class="dp-kpi-val${bump ? ' dp-bump' : ''}">${val}</b>
      ${sub ? `<span class="dp-kpi-sub">${sub}</span>` : ''}
    </button>`;
  }).join('');
  tiles.forEach(([k, , v]) => { _depLastKpi[k] = v; });

  // Update occupancy pill in topbar
  const occEl  = document.getElementById('topbarOcc');
  const occLbl = document.getElementById('occLabel');
  if (occEl && occLbl && sc.all > 0) {
    occEl.style.display = '';
    occLbl.textContent  = `${sc.out + sc.extended} / ${sc.all} done`;
  }

  // HK Status bar — always visible when board is loaded
  const hkBar = document.getElementById('depHKBar');
  if (hkBar) hkBar.style.display = depRooms.length ? 'flex' : 'none';

  const showBar = (barId, cntId, n) => {
    const bar = document.getElementById(barId), cnt = document.getElementById(cntId);
    if (bar) bar.style.display = n > 0 ? 'flex' : 'none';
    if (cnt) cnt.textContent = n + ' room' + (n !== 1 ? 's' : '');
  };
  showBar('depNaBar', 'depNaCount', sc.na);
  showBar('depDndBar', 'depDndCount', sc.dnd);
  showBar('depExtBar', 'depExtCount', sc.extended);
  showBar('depOutBar', 'depOutCount', sc.out);

  setTxt('depProgLabel', `${sc.out} out · ${sc.extended} extended`);
  setTxt('depProgPct', pct + '%');
  const fill = document.getElementById('depProgFill'); if (fill) fill.style.width = pct + '%';

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
      case 'all':          mf = es === 'due' || es === 'late' || es === 'na' || es === 'dnd'; break; // extended excluded — done
      case 'balance':      mf = depOwes(r) && es !== 'out' && es !== 'extended'; break;
      case 'pending':      mf = !!r.intent && es !== 'out' && es !== 'extended'; break;
      case 'maybe_extend': mf = r.intent === 'maybe_extend' || r.intent === 'extending'; break;
      case 'overdue':      mf = _depIsOverdue(r); break;
      case 'due':          mf = es === 'due'; break;
      case 'late':         mf = es === 'late'; break;
      case 'na':           mf = es === 'na'; break;
      case 'dnd':          mf = es === 'dnd'; break;
      case 'extended':     mf = es === 'extended'; break;
      case 'out':          mf = es === 'out'; break;
      default:             mf = es === depFilter_; break;
    }
    const ms = _matchSearch(r, parsed);
    return mf && ms;
  });

  // ── Sort ────────────────────────────────────────────────
  const STATUS_ORDER = { late: 0, due: 1, na: 2, dnd: 2, out: 3, extended: 3 };

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

  const _openState = _depSaveOpenState();
  const grid = document.getElementById('depGrid');
  grid.innerHTML = filtered.map(r => depCardHTML(r)).join('');
  _depRestoreOpenState(_openState);

  // Micro-animation: cards whose status just changed flash; a fresh board fades in
  const firstPaint = !_depLastSt;
  const nowSt = {};
  depRooms.forEach(r => { nowSt[r.roomStr] = effectiveStatus(r); });
  let k = 0;
  const tNow = Date.now();
  grid.querySelectorAll('.dep-card').forEach(card => {
    const rs = card.dataset.room;
    if (firstPaint) { if (k < 30) { card.style.setProperty('--dp-i', k++); card.classList.add('dp-enter'); } return; }
    if (_depLastSt[rs] !== undefined && _depLastSt[rs] !== nowSt[rs]) _depFlashAt[rs] = tNow;
    // a re-render straight after (our own save echo) carries on the same flash instead of cutting it
    const age = tNow - (_depFlashAt[rs] || 0);
    if (age < 700) { card.classList.add('dp-flash'); if (age > 0) card.style.animationDelay = `-${age}ms`; }
  });
  _depLastSt = depRooms.length ? nowSt : null;

  // Nothing to show: say why
  const nores = document.getElementById('depNoResults');
  if (nores) {
    if (filtered.length || !depRooms.length) { nores.style.display = 'none'; nores.innerHTML = ''; }
    else {
      nores.style.display = 'block';
      nores.innerHTML = rawSearch
        ? `<div class="dp-nr-ico">🔎</div><b>No room matches “${escapeHtml(rawSearch)}”</b><span>Try a room number, a name, or several rooms like 610,613.</span><button class="dp-pill-btn" onclick="depSearchClear()">Clear search</button>`
        : depFilter_ === 'all'
          ? `<div class="dp-nr-ico">🎉</div><b>Nothing left to do</b><span>Every room is out or extended.</span><button class="dp-pill-btn" onclick="depFilter('out')">See checked-out rooms</button>`
          : `<div class="dp-nr-ico">✓</div><b>No rooms here</b><span>Nothing matches this filter right now.</span><button class="dp-pill-btn" onclick="depFilter('all')">Back to the to-do list</button>`;
    }
  }

  renderDepLog();
  if (_jumpOpen) renderDepQuickJump();
  _depApplyDensity();

  const qb   = document.getElementById('depQuickBar');
  const qbIn = document.getElementById('depQuickBarInline');
  if (sc.due > 3) {
    if (qb) qb.style.display = 'flex';
    if (qbIn) qbIn.style.display = 'flex';
    setTxt('depQuickLabel', `${sc.due} rooms still due out`);
  } else {
    if (qb) qb.style.display = 'none';
    if (qbIn) qbIn.style.display = 'none';
  }

  // Inject arrival warnings into dep cards (arr-dep-xref.js)
  if (typeof xrefInjectDepWarnings === 'function') xrefInjectDepWarnings();

  _depInitSwipe();
  _depInitRipple();
  _depCheckOverdueAlerts();
  _depQueueTrendSnapshot();
  _dpnRefresh();   // an open Room notes window follows live changes
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
      key:   'dnd',
      icon:  '🚫',
      label: 'DND',
      cls:   'jump-dnd',
      rooms: depRooms.filter(r => r.status === 'dnd'),
    },
    {
      key:   'balance',
      icon:  '💳',
      label: 'Balance Owing',
      cls:   'jump-bal',
      rooms: depRooms.filter(r => depOwes(r) && effectiveStatus(r) !== 'out' && effectiveStatus(r) !== 'extended'),
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
            : g.key === 'dnd'      ? 'dnd'
            : g.key === 'extended' ? 'extended'
            : 'all'}','${r.roomStr}')">
            ${r.roomStr}<span class="jump-pill-name">${escapeHtml(String(r.name || '').split(' ')[0])}</span>
          </button>`).join('')}
      </div>
    </div>`).join('');
}

function depJumpTo(roomStr, filterKey, targetRoom) {
  // Switch to the right filter
  depFilter(filterKey);

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
  finance_hold:  { icon:'🧾', label:'Left · waiting', color:'var(--amber)', autoNote:'' },
  extending:     { icon:'⏳', label:'Extending',          color:'var(--teal)',   autoNote:'Extending: waiting for the booking, signature, TD and payment.' },
  maybe_extend:  { icon:'🤔', label:'May Extend Stay',   color:'var(--violet)', autoNote:'Guest may extend — confirm with Opera before releasing room.' },
  coming_back:   { icon:'↩️', label:'Coming Back Later', color:'var(--amber)',  autoNote:'Guest coming back later today — hold key and luggage if needed.' },
  returning:     { icon:'🔁', label:'Returning Guest',    color:'var(--sky)',    autoNote:'Returning guest — check if new reservation is linked.' },
  pay_td:        { icon:'💵', label:'Coming to Pay TD',   color:'var(--gold)',   autoNote:'Guest coming down to pay Tourism Dirham (TD) before checkout.' },
  checkout_soon: { icon:'⏱',  label:'Checking Out Soon',  color:'var(--mint)',   autoNote:'' }, // label/note built dynamically with the minutes value
};

// ── Card HTML ──────────────────────────────────────────────
// One room. Hook classes other code relies on are kept: .dep-card[data-room],
// .dc-room, .dc-sbadge (patched in place), .dca/.dca-* (ripple, tests), .dc-body
// (arrivals cross-check strips), .dc-note / .dc-note-body (notes), .dc-ext-*.
// Display only: "SAM TEST" → "Sam Test" (names typed in mixed case are left alone)
function _dpNice(s) {
  s = String(s || '');
  return s && s === s.toUpperCase() && /[A-Z]/.test(s)
    ? s.toLowerCase().replace(/(^|[\s\-'’(\/])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
    : s;
}

const DEP_EXTG_BY = 18 * 60;   // ⏳ an extending guest has until 6 PM to finish the booking, signature, TD and payment
/** what an extending room still waits for: ['Booking', 'RC sign', 'TD', 'Payment'] */
function depExtWaiting(r) {
  return [['extBook', 'Booking'], ['extSign', 'RC sign'], ['extTd', 'TD'], ['extPay', 'Payment']].filter(([k]) => !r[k]).map(([, l]) => l);
}

function depCardHTML(r) {
  const i   = depRooms.indexOf(r);
  const bal = r.balance;
  const es         = effectiveStatus(r);
  const lcoOverdue  = isLcoOverdue(r);
  const overdue     = _depIsOverdue(r);
  const active      = es !== 'out' && es !== 'extended';
  const money = v => Math.abs(v).toLocaleString('en', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  // Status pill — driven by effective status
  const autoPromoted = r.status === 'due' && es === 'late';
  let badgeText;
  if (es === 'due') {
    badgeText = overdue ? 'DUE · PAST 12:00' : 'DUE OUT';
  } else if (es === 'late') {
    badgeText = autoPromoted
      ? (lcoOverdue ? `OVERDUE · ${r.depTime}` : `LATE CO · ${r.depTime}`)
      : (lcoOverdue ? `LCO OVERDUE · ${r.lateTime}` : `LATE CO${r.lateTime ? ' · ' + r.lateTime : ''}`);
  } else if (es === 'extended') {
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
    badgeText = `OUT${r.checkoutAt ? ' · ' + r.checkoutAt : ''}`;
  } else if (es === 'na') {
    badgeText = `NO ANSWER${r.naTime ? ' · ' + r.naTime : ''}`;
  } else if (es === 'dnd') {
    badgeText = `DND${r.dndTime ? ' · ' + r.dndTime : ''}`;
  } else {
    badgeText = 'DUE OUT';
  }
  // ⏳ extending: the guest stays, the paperwork is on its way — not due, not overdue
  // 🧾 left, waiting for Finance / Reservations to fix the room — not due either
  const extg = r.intent === 'extending' && active, finw = r.intent === 'finance_hold' && active;
  // short on the pill (the box under it lists the paperwork); the full story on hover
  let badgeTip = '';
  if (extg) { badgeText = '⏳ EXTENDING · ' + (overdue ? 'PAST 6 PM' : 'BY 6 PM'); badgeTip = depExtWaiting(r).length ? 'Waiting for ' + depExtWaiting(r).join(', ') + ' — due by 6 PM' : 'All done: mark it extended'; }
  if (finw) { badgeText = '🧾 LEFT · ' + String(r.finWho || 'Finance').toUpperCase(); badgeTip = `Guest left${r.finAt ? ' at ' + r.finAt : ''}; waiting for ${r.finWho || 'Finance'} to fix the room`; }

  let sClass = extg ? 'dp-s-due dp-s-extg' : finw ? 'dp-s-due dp-s-fin' : 'dp-s-' + (es || 'due');
  if (overdue) sClass += ' dp-overdue';
  if (depOwes(r) && active) sClass += ' dp-owing';
  if (r.intent && active && es !== 'na') sClass += ' dp-intent';

  // Chips: VIP · returning · company · balance · note
  const chips = [];
  if (r.isVip) chips.push(`<span class="dp-chip dp-chip-vip">VIP</span>`);
  const gmProfile = typeof gmLookup === 'function' ? gmLookup(r.name) : null;
  if (gmProfile) chips.push(`<span class="dp-chip dp-chip-ret" title="Stayed before${gmProfile.lastSeen ? ' · last seen ' + escapeHtml(gmProfile.lastSeen) : ''}${gmProfile.nat ? ' · ' + escapeHtml(gmProfile.nat) : ''}">Returning</span>`);
  if (r.manual) chips.push(`<span class="dp-chip">✍ Added by hand</span>`);
  if (r.company) chips.push(`<span class="dp-chip dp-chip-co" title="${escapeHtml(r.company)}">${escapeHtml(r.company.substring(0, 26))}${r.company.length > 26 ? '…' : ''}</span>`);
  const balChip = bal > 0 && depBalOk(r)
    ? `<span class="dp-bal dp-bal-okpay" role="button" tabindex="0" onclick="depBalMenu(${i},event)" title="Balance is fine: ${escapeHtml(_depBalWho(r))} pays. Tap to change.">AED ${money(bal)} <small>${escapeHtml(String(_depBalWho(r)).slice(0, 16))} pays ✓</small></span>`
    : bal > 0
    ? `<span class="dp-bal dp-bal-owe${active ? '' : ' dp-bal-muted'}" role="button" tabindex="0" onclick="depBalMenu(${i},event)" title="Balance owing. Tap if it is fine (e.g. Expedia or the company pays)">AED ${money(bal)} <small>owing</small></span>`
    : bal < 0
      ? `<span class="dp-bal dp-bal-cr" title="Credit">AED ${money(bal)} <small>credit</small></span>`
      : `<span class="dp-bal dp-bal-ok" title="No balance">Settled</span>`;

  const timeTag = depTimeTag(r);

  // Intent banner
  const ic = INTENT_CONFIG[r.intent];
  const intentLabel = (r.intent === 'checkout_soon' && r.intentMinutes)
    ? `Checking Out in ${r.intentMinutes} min`
    : ic?.label;
  const finBanner = r.intent === 'finance_hold' && r.status !== 'out' && r.status !== 'extended'
    ? `<div class="dc-intent-banner dp-intent-banner dp-fin" style="--dp-ic:var(--amber);">
         <span>🧾 Guest left${r.finAt ? ' at ' + escapeHtml(r.finAt) : ''} · waiting for ${escapeHtml(r.finWho || 'Finance')}${r.finAt ? ` <small class="dp-fin-ago">${escapeHtml(_depFinAgo(r))}</small>` : ''}</span>
         <span class="dp-extg-acts">
           <button type="button" class="dp-extg-go ready" onclick="depFinanceDone(${i});event.stopPropagation()" title="${escapeHtml(r.finWho || 'Finance')} fixed the room: check it out">✓ Fixed · check out</button>
           <button class="dc-intent-clear" onclick="depSetIntent(${i},'');event.stopPropagation()" title="Guest has not left after all">✕</button>
         </span>
       </div>`
    : '';
  const intentBanner = finBanner ? finBanner : r.intent === 'extending' && r.status !== 'out' && r.status !== 'extended'
    ? `<div class="dc-intent-banner dp-intent-banner dp-extg" style="--dp-ic:${ic.color};">
         <span class="dp-extg-t">⏳ Extending · waiting for</span>
         <span class="dp-extg-ck">
           <button type="button" class="dp-extg-b${r.extBook ? ' on' : ''}" aria-pressed="${!!r.extBook}" onclick="depExtPaper(${i},'extBook');event.stopPropagation()" title="The new booking is made (by the guest or by us)">${r.extBook ? '✓' : '○'} Booking</button>
           <button type="button" class="dp-extg-b${r.extSign ? ' on' : ''}" aria-pressed="${!!r.extSign}" onclick="depExtPaper(${i},'extSign');event.stopPropagation()">${r.extSign ? '✓' : '○'} Signature</button>
           <button type="button" class="dp-extg-b${r.extTd ? ' on' : ''}" aria-pressed="${!!r.extTd}" onclick="depExtPaper(${i},'extTd');event.stopPropagation()">${r.extTd ? '✓' : '○'} TD</button>
           <button type="button" class="dp-extg-b${r.extPay ? ' on' : ''}" aria-pressed="${!!r.extPay}" onclick="depExtPaper(${i},'extPay');event.stopPropagation()" title="The full payment for the extra nights is taken">${r.extPay ? '✓' : '○'} Payment</button>
         </span>
         <span class="dp-extg-acts">
           <button type="button" class="dp-extg-go${r.extBook && r.extSign && r.extTd && r.extPay ? ' ready' : ''}" onclick="depAskExtend(${i});event.stopPropagation()" title="Mark the room as extended">↪ Mark extended</button>
           <button class="dc-intent-clear" onclick="depSetIntent(${i},'');event.stopPropagation()" title="Not extending after all">✕</button>
         </span>
       </div>`
    : ic && r.status !== 'out' && r.status !== 'extended'
    ? `<div class="dc-intent-banner dp-intent-banner" style="--dp-ic:${ic.color};">
         <span>${ic.icon} ${intentLabel}</span>
         <button class="dc-intent-clear" onclick="depSetIntent(${i},'');event.stopPropagation()">✕ Clear</button>
       </div>`
    : '';

  // Overdue warning strip
  const overdueStrip = lcoOverdue
    ? autoPromoted
      ? `<div class="dp-alert">⚠ Past checkout time (${r.depTime}). Follow up now.</div>`
      : `<div class="dp-alert">⚠ Past the agreed late check-out (${r.lateTime}). Check out now.</div>`
    : '';

  // Late time dropdown — show for any LCO room (manual or auto-promoted)
  const lateRow = es === 'late' ? `
    <div class="dc-sel-row dp-field">
      <span class="dc-sel-lbl late">🕐 Agreed time</span>
      <select class="dc-select late" onchange="depSetLateTime(${i},this.value)">
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
    return `
    <div class="dc-ext-panel dp-ext">
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
          <button class="dc-ext-confirm-btn ${confirmedCls}" onclick="depExtUpdate(${i},'confirmed',${!r.extConfirmed})">${confirmedLbl}</button>
        </div>
      </div>
    </div>`;
  })() : '';

  // "Guest said…" quick-log (hidden once out/extended)
  const intentRowHTML = active ? `
      <select class="dc-intent-select dp-said" aria-label="Guest said" onclick="event.stopPropagation()"
        onchange="depIntentSelect(${i}, this.value, this); event.stopPropagation()">
        <option value="">💬 Guest said…</option>
        <option value="maybe_extend">🤔 May Extend</option>
        <option value="coming_back">↩️ Coming Back</option>
        <option value="returning">🔁 Returning</option>
        <option value="pay_td">💵 Paying TD</option>
        <option value="checkout_soon">⏱ Checking Out In…</option>
      </select>` : '';

  const B = (cls, fn, ico, txt, title) => `<button class="dca ${cls}" onclick="${fn}"${title ? ` title="${title}"` : ''}><span class="dca-i" aria-hidden="true">${ico}</span><span class="dca-t">${txt}</span></button>`;

  // NA / DND follow-up warnings
  let warn = '';
  const minsSince = hhmm => { const [h, m] = String(hhmm).split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return Math.floor((Date.now() - d.getTime()) / 60000); };
  if (es === 'na' && r.naTime && minsSince(r.naTime) >= 30) warn = `<div class="dc-na-warn dp-alert dp-alert-soft">📵 No answer for ${minsSince(r.naTime)} min. Follow up now.</div>`;
  if (es === 'dnd' && r.dndTime && minsSince(r.dndTime) >= 60) warn = `<div class="dc-na-warn dp-alert dp-alert-soft">🚫 DND for ${minsSince(r.dndTime)} min. Consider calling again.</div>`;

  // Action buttons — driven by effective status (same functions as before)
  let actHTML = '';
  if (es === 'extended') {
    actHTML = `<div class="dc-actions dp-acts g1">${B('dca-undo', `depAction(${i},'due')`, '↺', 'Undo extension')}</div>`;
  } else if (es === 'out') {
    actHTML = `<div class="dc-actions dp-acts g1">${B('dca-undo', `depAction(${i},'due')`, '↺', 'Undo check-out')}</div>`;
  } else if (es === 'na') {
    actHTML = `<div class="dc-actions dp-acts g2">${B('dca-co', `depAction(${i},'out')`, '✓', 'Check out')}${r.intent === 'finance_hold' ? '' : B('dca-fin', `depFinanceHold(${i},event)`, '🧾', 'Left · waiting', 'Guest has physically left; Finance or Reservations still has to fix the room')}${B('dca-undo', `depAction(${i},'due')`, '↺', 'Undo NA')}</div>`;
  } else if (es === 'dnd') {
    actHTML = `<div class="dc-actions dp-acts g2">${B('dca-co', `depAction(${i},'out')`, '✓', 'Check out')}${r.intent === 'finance_hold' ? '' : B('dca-fin', `depFinanceHold(${i},event)`, '🧾', 'Left · waiting', 'Guest has physically left; Finance or Reservations still has to fix the room')}${B('dca-undo', `depAction(${i},'due')`, '↺', 'Undo DND')}</div>`;
  } else if (es === 'late') {
    actHTML = `<div class="dc-actions dp-acts g2">${B('dca-co', `depAction(${i},'out')`, '✓', 'Check out')}${r.intent === 'finance_hold' ? '' : B('dca-fin', `depFinanceHold(${i},event)`, '🧾', 'Left · waiting', 'Guest has physically left; Finance or Reservations still has to fix the room')}${B('dca-undo', `depAction(${i},'due')`, '↺', 'Undo LCO')}</div>`;
  } else {
    actHTML = `<div class="dc-actions dp-acts g5">
      ${r.intent === 'finance_hold' ? '' : B('dca-co', `depCheckOut(${i})`, '✓', 'Check out')}
      ${r.intent === 'finance_hold' ? '' : B('dca-fin', `depFinanceHold(${i},event)`, '🧾', 'Left · waiting', 'Guest has physically left; Finance or Reservations still has to fix the room')}
      ${B('dca-ext', `depAskExtend(${i})`, '↪', 'Extend')}
      ${B('dca-extg' + (r.intent === 'extending' ? ' on' : ''), `depSetIntent(${i},'extending')`, '⏳', 'Extending', 'Guest is extending: tick the booking, signature, TD and payment as they are done')}
      ${B('dca-late', `depAskLCO(${i})`, '🕐', 'Late CO')}
      ${B('dca-na', `depAction(${i},'na')`, '📵', 'No answer')}
      ${B('dca-dnd', `depAction(${i},'dnd')`, '🚫', 'DND')}
    </div>`;
  }

  // Selection mode tick overlay
  const isSelectable = _selGroup && r.status === _selGroup;
  const isSelected   = isSelectable && _selRooms.has(r.roomStr);
  const selTick = isSelectable ? `<div class="dep-sel-tick${isSelected ? ' checked' : ''}"></div>` : '';

  const shortDate = s => { const d = parseOperaDate(s); return d && !isNaN(d) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : (s || ''); };
  const srcClean  = r.source ? r.source.substring(0, 22) + (r.source.length > 22 ? '…' : '') : '';
  // meta line: each part gets a small icon (CSS mask, .dp-mi-*); text stays plain
  const metaParts = [
    r.arrival || r.departure ? ['cal', `${shortDate(r.arrival)} → ${shortDate(r.departure)}`] : null,
    r.nights ? ['moon', r.nights + (r.nights === 1 ? ' night' : ' nights')] : null,
    srcClean ? ['src', srcClean] : null,
  ].filter(Boolean);
  const metaHTML = metaParts.map(([k, t]) => `<span class="dp-mi dp-mi-${k}">${escapeHtml(t)}</span>`).join('');

  // Time left: a small ring that fills as checkout time gets close (6 h window); red and full when overdue
  let timeHTML = '';
  if (active && !finw) {
    const nowD = new Date(), nowM = nowD.getHours() * 60 + nowD.getMinutes();
    const fmtM = m => { const h = Math.floor(m / 60), mm = m % 60; return h ? `${h}h ${mm}m` : `${mm}m`; };
    const agreed = es === 'late' && r.status === 'late' ? _parseLcoTime(r.lateTime) : null;
    const limit  = extg ? DEP_EXTG_BY : agreed !== null ? agreed : (_depTimeMins(r) !== null ? _depTimeMins(r) : (overdue ? 12 * 60 : null));
    if (limit !== null) {
      const diff = limit - nowM;
      if (overdue && diff < 0) {
        timeHTML = `<span class="dp-time dp-time-over" style="--p:1" title="${fmtM(-diff)} past ${extg ? 'the 6 PM limit for the extension' : 'checkout time'}"><i class="dp-tring" aria-hidden="true"></i><span class="dc-time-tag over">${fmtM(-diff)} over</span></span>`;
      } else if (diff > 0 && (timeTag || agreed !== null || extg)) {
        const pct = Math.max(.04, Math.min(1, 1 - diff / 360)).toFixed(3);
        timeHTML = `<span class="dp-time${diff <= 30 ? ' dp-time-soon' : ''}" style="--p:${pct}" title="${fmtM(diff)} left ${extg ? 'to finish the extension (6 PM)' : 'to check out'}"><i class="dp-tring" aria-hidden="true"></i><span class="dc-time-tag ${diff <= 30 ? 'soon' : 'ok'}">${fmtM(diff)} left</span></span>`;
      }
    }
  }

  // note chip: the pinned note (else the newest) with its type icon; the Note button shows how many
  const noteE = r.note ? dpnPreview(r.note, r.notePin) : null;
  const noteN = r.note ? dpnParse(r.note).length : 0;
  const noteCat = noteE ? (DPN_CAT[noteE.cat] || DPN_CAT.gen) : null;
  const notePrev = noteE ? escapeHtml(noteE.body.replace(/\s+/g, ' ').substring(0, 70)) : '';

  return `<div class="dep-card dp-card ${sClass}${isSelected ? ' dep-sel-active' : ''}"
    data-room="${escapeHtml(r.roomStr)}" data-st="${es}"
    ${isSelectable ? `onclick="depToggleSelect('${r.roomStr}')"` : ''}>
    ${selTick}
    <div class="dp-top">
      <div class="dc-room dp-room">${escapeHtml(r.roomStr)}</div>
      <div class="dp-id">
        <div class="dp-name dc-name" ondblclick="event.stopPropagation();depEditName(${i})" title="${escapeHtml(r.name)} · double-click to edit">${escapeHtml(_dpNice(r.name))}</div>
        <div class="dp-meta">${metaHTML}</div>
      </div>
      <div class="dp-side">
        <span class="dc-sbadge dp-pill"${badgeTip ? ` title="${escapeHtml(badgeTip)}"` : ''}>${badgeText}</span>
        ${timeHTML}
      </div>
    </div>
    <div class="dp-tags">
      ${balChip}${chips.join('')}
      ${noteE ? `<button class="dp-chip dp-chip-note${r.notePin && noteE.key === r.notePin ? ' dp-chip-pinned' : ''}" style="--k:${noteCat.c}" onclick="event.stopPropagation();depOpenNotes('${r.roomStr}')" title="${escapeHtml((noteE.time ? noteE.time + ' · ' : '') + noteCat.l + ': ' + noteE.text.substring(0, 200))}"><i class="dp-chip-ni" aria-hidden="true">${noteCat.i}</i><span>${notePrev}</span></button>` : ''}
    </div>
    <div class="dc-body dp-body">
      ${overdueStrip}
      ${warn}
      ${intentBanner}
      ${lateRow}
      ${extRow}
      ${actHTML}
      <div class="dp-foot">
        ${intentRowHTML}
        <button class="dp-note-btn" onclick="event.stopPropagation();depOpenNotes('${r.roomStr}')" aria-label="Notes for room ${escapeHtml(r.roomStr)}${noteN ? ' (' + noteN + ')' : ''}"><i class="dp-ic dp-ic-note" aria-hidden="true"></i>${noteN ? 'Notes' : 'Note'}${noteN ? `<b class="dp-note-n">${noteN}</b>` : ''}</button>
        <button class="dc-copy-card-btn dp-icon-btn" title="Copy room summary" aria-label="Copy room summary" onclick="event.stopPropagation();depCopyCard(${i})"><i class="dp-ic dp-ic-copy" aria-hidden="true"></i></button>
      </div>
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════
// Room notes window. r.note stays plain text ("[HH:MM] [Category] text" lines),
// so WhatsApp, undo, copy and every other reader keep working.
// ══════════════════════════════════════════════════════════════
// ── Room notes: parser (pure, tested in tests/run-tests.js) ──
const DPN_CATS = [
  // key, label, icon, colour, words that pick it (the first match wins, in this order)
  { k: 'lco',  l: 'Late CO',      i: '⏰', c: 'var(--amber)',  re: /\blate\s*(check[\s-]?out|c\.?o\b)|\blco\b/i },
  { k: 'co',   l: 'Check-out',    i: '✓',  c: 'var(--green)',  re: /\bchecked[\s-]?out\b|\bcheck[\s-]?out (done|complete)|\bleft the hotel\b|\bkey(s)? returned\b/i },
  { k: 'fin',  l: 'Finance',      i: '🧾', c: 'var(--blue)',   re: /\bfinance\b|\breservations\b|\binvoice\b|\bcity ledger\b|🧾/i },
  { k: 'ext',  l: 'Extension',    i: '↪',  c: 'var(--teal)',   re: /\bextend|\bextension|\bextending\b|⏳|\bext\b|\bmore nights?\b/i },
  { k: 'pay',  l: 'Payment',      i: '💳', c: 'var(--purple)', re: /\bpaid\b|\bpay(ing|ment|s)?\b|\bbalance\b|\btd\b|tourism dirham|\bcard\b|\bcash\b|\bdeposit\b|\brefund|\baed\b|\bsettled\b/i },
  { k: 'lug',  l: 'Luggage',      i: '🧳', c: 'var(--sky)',    re: /\bluggage\b|\bbags?\b|\bsuitcases?\b|\bbaggage\b/i },
  { k: 'taxi', l: 'Taxi',         i: '🚕', c: 'var(--amber)',  re: /\btaxi\b|\bcab\b|\btransport|\bairport\b|\bpick[\s-]?up\b|\btransfer\b|\bcareem\b|\buber\b|\blimo\b/i },
  { k: 'vip',  l: 'VIP / Prefs',  i: '⭐', c: 'var(--amber)',  re: /\bvip\b|\bprefer|\ballerg|\bbirthday\b|\banniversary\b|\bloyal|\breturning guest\b|\bhoneymoon\b|\bquiet room\b|\bhigh floor\b|\bnext time\b/i },
  { k: 'hk',   l: 'Housekeeping', i: '🧹', c: 'var(--mint)',   re: /\bhousekeeping\b|\bhk\b|\btowels?\b|\bclean|\bbed\s?sheets?\b|\blinen\b|\btoilet paper\b|\btoliet\b|\bamenit|\brequest|\bminibar\b|\bpillows?\b/i },
  { k: 'mnt',  l: 'Maintenance',  i: '🔧', c: 'var(--red)',    re: /\bmaintenance\b|\brepair|\bbroken\b|\bleak|\bac\b|\bair ?con|\bnot working\b|\bengineer/i },
  { k: 'call', l: 'Call / DND',   i: '📞', c: 'var(--rose)',   re: /\bno answer\b|\bdnd\b|\bdo not disturb\b|\bcalled\b|\bcall(ed|ing)?\b|\bphone\b|\bknock/i },
  { k: 'wa',   l: 'WhatsApp',     i: '💬', c: 'var(--green)',  re: /whatsapp/i },
  { k: 'gen',  l: 'General',      i: '📝', c: 'var(--text2)',  re: null },
];
const DPN_CAT = Object.fromEntries(DPN_CATS.map(c => [c.k, c]));
// "[Luggage]" / "[Late CO]" / "[Housekeeping]"… at the start of a line's text → that category
function dpnTagCat(tag) {
  const t = String(tag || '').trim().toLowerCase();
  if (!t) return null;
  const hit = DPN_CATS.find(c => c.l.toLowerCase() === t || c.k === t);
  if (hit) return hit.k;
  const syn = { 'checkout': 'co', 'check out': 'co', 'late checkout': 'lco', 'late check-out': 'lco', 'extend': 'ext', 'extending': 'ext', 'balance': 'pay', 'td': 'pay', 'transport': 'taxi', 'request': 'hk', 'requests': 'hk', 'call': 'call', 'dnd': 'call', 'no answer': 'call', 'reservations': 'fin', 'vip': 'vip', 'preference': 'vip', 'note': 'gen', 'general': 'gen' };
  return syn[t] || null;
}
function dpnCat(text) {
  const s = String(text || '');
  for (const c of DPN_CATS) if (c.re && c.k !== 'wa' && c.re.test(s.replace(/WhatsApp\s*·[^:—]*?\d{1,2}:\d{2}\s*(AM|PM)?(\s*\(edited\))?/gi, ''))) return c.k;
  return /whatsapp/i.test(s) ? 'wa' : 'gen';
}
// who / where a line came from: "… — WhatsApp · Sam 1:52 PM (edited)" or "WhatsApp · Sam 9:01 AM: text"
function dpnVia(text) {
  const m = String(text || '').match(/WhatsApp\s*·\s*([^\d:—]+?)\s+(\d{1,2}:\d{2}\s*(?:AM|PM)?)(?:\s*\((edited|redo|word explained)\))?/i);
  if (!m) return null;
  return { src: 'WhatsApp', who: m[1].trim(), at: m[2].trim(), edited: m[3] || '' };
}
// the text without the WhatsApp signature
function dpnBody(text) {
  return String(text || '')
    .replace(/^\s*WhatsApp\s*·\s*[^\d:—]+?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?(?:\s*\([^)]*\))*\s*:\s*/i, '')
    .replace(/\s*—\s*WhatsApp\s*·\s*[^\d:—]+?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?(?:\s*\([^)]*\))*\s*$/i, '')
    .trim();
}
// r.note → entries, in line order. A "[HH:MM]" line starts an entry; the lines under it belong to it
// until a blank line. Lines with no time (before any time, or after a blank line) are untimed entries.
function dpnParse(note) {
  const lines = String(note || '').split('\n'), out = [];
  let cur = null;
  lines.forEach((ln, idx) => {
    const m = ln.match(/^\s*\[(\d{1,2}):(\d{2})\]\s?(.*)$/);
    if (m) {
      cur = { start: idx, count: 1, time: m[1].padStart(2, '0') + ':' + m[2], rest: m[3] };
      out.push(cur);
    } else if (!ln.trim()) {
      cur = null;
    } else if (cur) {
      cur.count = idx - cur.start + 1; cur.rest += '\n' + ln;
    } else {
      cur = { start: idx, count: 1, time: '', rest: ln };
      out.push(cur);
    }
  });
  return out.map((e, n) => {
    const tm = e.rest.match(/^\s*\[([A-Za-z][A-Za-z /&-]{1,20})\]\s*/), tagK = tm ? dpnTagCat(tm[1]) : null;
    const text = tagK ? e.rest.slice(tm[0].length) : e.rest;
    const via = dpnVia(text);
    return { n, start: e.start, count: e.count, time: e.time, tag: tagK ? tm[1] : '', cat: tagK || dpnCat(text), text: text.trim(), body: dpnBody(text) || text.trim(), via, key: lines.slice(e.start, e.start + e.count).join('\n') };
  }).filter(e => e.text);
}
// one entry back to text: "[HH:MM] [Category] text"
function dpnLine(time, catK, text, tagIt) {
  const c = DPN_CAT[catK];
  return (time ? `[${time}] ` : '') + (tagIt && c && catK !== 'gen' && catK !== 'wa' ? `[${c.l}] ` : '') + String(text || '').trim();
}
// replace (or with text === null delete) one entry inside the note
function dpnReplace(note, e, newText) {
  const L = String(note || '').split('\n');
  if (newText === null) L.splice(e.start, e.count); else L.splice(e.start, e.count, ...String(newText).split('\n'));
  return L.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
}
// the entry shown on the card: the pinned one, else the newest
function dpnPreview(note, pin) {
  const E = dpnParse(note);
  if (!E.length) return null;
  return (pin && E.find(e => e.key === pin || e.key.split('\n')[0] === pin)) || E[E.length - 1];
}
function dpnPart(time) {
  if (!time) return 'No time';
  const h = parseInt(time, 10);
  return h < 5 ? 'Night' : h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Night';
}
// ── end room notes parser ──

// ── Room notes window (UI) ──
const DPN_TPL = {
  gen:  ['Spoke to the guest', 'Guest will come to the desk', 'Guest asked for a receipt'],
  lug:  ['Luggage in store, {n} bags', 'Luggage collected', 'Bags to the lobby at {time}'],
  taxi: ['Taxi booked for {time}', 'Airport drop at {time}', 'Guest has own transport'],
  pay:  ['Paid by card', 'Paid cash', 'TD paid', 'Balance settled'],
  hk:   ['Room ready to clean', 'Towels sent', 'Extra amenities requested'],
  mnt:  ['AC not working, maintenance told', 'Fixed by maintenance'],
  call: ['Called, no answer', 'DND sign on the door', 'Spoke to the guest on the phone'],
  fin:  ['Waiting for finance', 'Waiting for reservations', 'Finance done'],
  vip:  ['VIP: welcome amenity', 'Guest prefers a high floor', 'Allergy: {what}'],
  lco:  ['Late check-out until {time}', 'Late check-out approved by DM'],
  ext:  ['Guest wants to extend {n} nights', 'Extension rate agreed'],
};
const DPN_PICK = ['gen', 'lug', 'taxi', 'pay', 'hk', 'mnt', 'call', 'fin', 'vip', 'lco', 'ext'];
const _dpn = { room: null, filter: 'all', q: '', cat: 'gen', raw: false, edit: -1, del: -1 };
function _dpnRoom() { return depRooms.find(r => r.roomStr === _dpn.room) || null; }
function _dpnIdx() { const r = _dpnRoom(); return r ? depRooms.indexOf(r) : -1; }
function _dpnNow() { return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
function _dpnSave() { saveDeps(); depRender(); }   // the board is behind the window: re-rendering it never touches what is typed here
function _dpnEsc(s) { return escapeHtml(String(s == null ? '' : s)); }

// Opens the window for a room (the card's "Note" button and note chip call this)
function depOpenNotes(roomStr) {
  const r = depRooms.find(x => x.roomStr === String(roomStr));
  if (!r) return;
  Object.assign(_dpn, { room: r.roomStr, filter: 'all', q: '', cat: 'gen', raw: false, edit: -1, del: -1 });
  let ov = document.getElementById('dpnOv');
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'dpnOv'; ov.className = 'dpn-ov';
    ov.addEventListener('mousedown', e => { if (e.target === ov) depCloseNotes(); });
    document.body.appendChild(ov);
    document.addEventListener('keydown', _dpnKey, true);
  }
  ov.innerHTML = `<div class="dpn-win" role="dialog" aria-modal="true" aria-labelledby="dpnTitle">
    <header class="dpn-hd" id="dpnHd"></header>
    <div class="dpn-tools">
      <label class="dpn-search"><span aria-hidden="true">⌕</span><input id="dpnQ" type="search" placeholder="Search notes…" autocomplete="off" oninput="_dpn.q=this.value;_dpnPaint()"></label>
      <div class="dpn-filters" id="dpnFilters" role="tablist" aria-label="Note types"></div>
    </div>
    <div class="dpn-body" id="dpnBody"></div>
    <footer class="dpn-comp" id="dpnComp">
      <div class="dpn-cats" id="dpnCats" role="radiogroup" aria-label="Note type"></div>
      <div class="dpn-tpls" id="dpnTpls"></div>
      <div class="dpn-write">
        <textarea id="dpnText" rows="1" placeholder="Write a note…" aria-label="New note" onkeydown="_dpnComposeKey(event)" oninput="_dpnGrow(this)"></textarea>
        <button type="button" class="dpn-send" onclick="_dpnAdd()" aria-label="Save note">Add</button>
      </div>
      <div class="dpn-hint">Enter saves · Shift+Enter for a new line · the time is added for you</div>
    </footer>
  </div>`;
  document.documentElement.classList.add('dpn-lock');
  ov.classList.remove('dpn-closing');
  ov.classList.add('open');
  _dpnPaintAll();
  if (window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches) setTimeout(() => document.getElementById('dpnText')?.focus(), 60);
}
// kept for older callers: the card buttons used to open an inline editor
function depToggleNote(roomStr) { depOpenNotes(roomStr); }

function depCloseNotes() {
  const ov = document.getElementById('dpnOv');
  if (!ov || !ov.classList.contains('open')) return;
  const draft = document.getElementById('dpnText');
  if (draft && draft.value.trim() && !confirm('Close without saving the note you are writing?')) return;
  _dpn.room = null;
  ov.classList.add('dpn-closing');
  document.documentElement.classList.remove('dpn-lock');
  const fin = () => { ov.classList.remove('open', 'dpn-closing'); ov.innerHTML = ''; };
  const rm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  rm ? fin() : setTimeout(fin, 190);
  if (ov.contains(document.activeElement)) document.activeElement.blur();
  depRender();
}
function _dpnKey(e) {
  const ov = document.getElementById('dpnOv');
  if (!ov || !ov.classList.contains('open') || ov.classList.contains('dpn-closing')) return;
  if (e.key === 'Escape') {
    e.stopPropagation(); e.preventDefault();
    if (_dpn.edit >= 0 || _dpn.del >= 0) { _dpn.edit = _dpn.del = -1; _dpnPaint(); return; }
    depCloseNotes();
  } else if (e.key === 'Tab') {   // keep focus inside the window
    const f = [...ov.querySelectorAll('button, input, textarea, select, [tabindex="0"]')].filter(x => x.offsetParent && !x.disabled);
    if (!f.length) return;
    const a = f[0], z = f[f.length - 1];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  }
}
function _dpnGrow(t) { t.style.height = 'auto'; t.style.height = Math.min(140, t.scrollHeight) + 'px'; }
function _dpnComposeKey(e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); _dpnAdd(); } }

function _dpnPaintAll() { _dpnHead(); _dpnCats(); _dpnPaint(); }
function _dpnHead() {
  const r = _dpnRoom(), hd = document.getElementById('dpnHd');
  if (!r || !hd) return;
  const es = effectiveStatus(r);
  const st = { due: 'Due out', late: 'Late CO' + (r.lateTime ? ' · ' + r.lateTime : ''), out: 'Checked out' + (r.checkoutAt ? ' · ' + r.checkoutAt : ''), extended: 'Extended +' + (r.extensionNights || 0) + 'N', na: 'No answer', dnd: 'DND' }[es] || 'Due out';
  const d = s => { const x = parseOperaDate(s); return x && !isNaN(x) ? x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : (s || ''); };
  const n = dpnParse(r.note).length;
  hd.className = 'dpn-hd dp-s-' + (es || 'due') + (_depIsOverdue(r) ? ' dp-overdue' : '');
  hd.innerHTML = `<div class="dpn-room" aria-hidden="true">${_dpnEsc(r.roomStr)}</div>
    <div class="dpn-who">
      <div class="dpn-title" id="dpnTitle">${_dpnEsc(_dpNice(r.name))} <span class="dpn-pill">${_dpnEsc(st)}</span></div>
      <div class="dpn-sub">Room ${_dpnEsc(r.roomStr)} · ${_dpnEsc(d(r.arrival))} → ${_dpnEsc(d(r.departure))}${r.nights ? ' · ' + r.nights + (r.nights === 1 ? ' night' : ' nights') : ''} · ${n} note${n === 1 ? '' : 's'}</div>
    </div>
    <div class="dpn-hd-acts">
      <button type="button" class="dpn-hbtn${_dpn.raw ? ' on' : ''}" onclick="_dpnRaw()" aria-pressed="${_dpn.raw}" title="Edit all notes as plain text">${_dpn.raw ? '☰ Timeline' : '✎ Raw text'}</button>
      <button type="button" class="dpn-hbtn" onclick="_dpnCopy()" title="Copy all notes">⧉ Copy</button>
      <button type="button" class="dpn-x" onclick="depCloseNotes()" aria-label="Close notes">✕</button>
    </div>`;
}
function _dpnCats() {
  const el = document.getElementById('dpnCats'); if (!el) return;
  el.innerHTML = DPN_PICK.map(k => { const c = DPN_CAT[k]; return `<button type="button" role="radio" aria-checked="${_dpn.cat === k}" class="dpn-cat${_dpn.cat === k ? ' on' : ''}" style="--k:${c.c}" onclick="_dpn.cat='${k}';_dpnCats()"><i aria-hidden="true">${c.i}</i>${_dpnEsc(c.l)}</button>`; }).join('');
  const t = document.getElementById('dpnTpls');
  if (t) t.innerHTML = (DPN_TPL[_dpn.cat] || []).map((s, j) => `<button type="button" class="dpn-tpl" onclick="_dpnTpl(${j})">${_dpnEsc(s)}</button>`).join('');
}
function _dpnTpl(j) {
  const s = (DPN_TPL[_dpn.cat] || [])[j], ta = document.getElementById('dpnText');
  if (!s || !ta) return;
  ta.value = ta.value.trim() ? ta.value.trim() + ' ' + s : s;
  _dpnGrow(ta); ta.focus();
  const a = ta.value.indexOf('{'), b = ta.value.indexOf('}', a);
  if (a >= 0 && b > a) ta.setSelectionRange(a, b + 1); else ta.setSelectionRange(ta.value.length, ta.value.length);
}
function _dpnPaint() {
  const r = _dpnRoom(), body = document.getElementById('dpnBody'), fl = document.getElementById('dpnFilters');
  if (!r || !body) return;
  const ov = document.getElementById('dpnOv'); if (ov) ov.classList.toggle('dpn-israw', _dpn.raw);
  if (_dpn.raw) {
    if (fl) fl.innerHTML = '';
    body.innerHTML = `<div class="dpn-raw"><div class="dpn-raw-hint">Plain text, one note per line. Lines starting with a time like <code>[09:30]</code> become timeline entries.</div>
      <textarea id="dpnRaw" class="dc-note" spellcheck="false" oninput="depNoteInput(${depRooms.indexOf(r)},this.value)">${_dpnEsc(r.note)}</textarea></div>`;
    return;
  }
  const E = dpnParse(r.note);
  // filter chips: All, WhatsApp (where it came from), then each type that is used
  const counts = {}; E.forEach(e => { counts[e.cat] = (counts[e.cat] || 0) + 1; });
  const waN = E.filter(e => e.via).length;
  const chips = [['all', 'All', '', E.length, 'var(--accent)']];
  if (waN) chips.push(['src:wa', 'WhatsApp', '💬', waN, 'var(--green)']);
  DPN_CATS.forEach(c => { if (counts[c.k] && !(c.k === 'wa' && waN)) chips.push([c.k, c.l, c.i, counts[c.k], c.c]); });
  if (!chips.some(c => c[0] === _dpn.filter)) _dpn.filter = 'all';
  if (fl) fl.innerHTML = chips.map(([k, l, i, n, col]) => `<button type="button" role="tab" aria-selected="${_dpn.filter === k}" class="dpn-f${_dpn.filter === k ? ' on' : ''}" style="--k:${col}" onclick="_dpn.filter='${k}';_dpnPaint()">${i ? `<i aria-hidden="true">${i}</i>` : ''}${_dpnEsc(l)}<b>${n}</b></button>`).join('');
  const q = _dpn.q.trim().toLowerCase();
  let V = E.filter(e => _dpn.filter === 'all' || (_dpn.filter === 'src:wa' ? !!e.via : e.cat === _dpn.filter));
  if (q) V = V.filter(e => (e.text + ' ' + (DPN_CAT[e.cat] || {}).l + ' ' + e.time).toLowerCase().includes(q));
  // newest first: timed entries by time (later line wins a tie), untimed at the end
  V.sort((a, b) => (b.time ? 1 : 0) - (a.time ? 1 : 0) || b.time.localeCompare(a.time) || b.start - a.start);
  if (!E.length) { body.innerHTML = `<div class="dpn-empty"><div class="dpn-empty-ico">🗒️</div><b>No notes yet</b><span>Pick a type below and write the first note. The time is added for you.</span></div>`; return; }
  if (!V.length) { body.innerHTML = `<div class="dpn-empty"><div class="dpn-empty-ico">🔎</div><b>Nothing matches</b><span>Try another word or type.</span><button type="button" class="dpn-hbtn" onclick="_dpn.filter='all';_dpn.q='';document.getElementById('dpnQ').value='';_dpnPaint()">Show all notes</button></div>`; return; }
  const pinKey = r.notePin || '';
  let html = '', part = null;
  V.forEach(e => {
    const p = dpnPart(e.time);
    if (p !== part) { part = p; html += `<div class="dpn-part">${p}</div>`; }
    const c = DPN_CAT[e.cat] || DPN_CAT.gen, pinned = pinKey && (e.key === pinKey || e.key.split('\n')[0] === pinKey);
    const via = e.via ? `<span class="dpn-via">via ${_dpnEsc(e.via.src)} · ${_dpnEsc(e.via.who)}${e.via.at ? ' · ' + _dpnEsc(e.via.at) : ''}${e.via.edited ? ' · ' + _dpnEsc(e.via.edited) : ''}</span>` : '';
    let main;
    if (_dpn.edit === e.n) {
      main = `<div class="dpn-editbox">
        <select id="dpnEditCat" aria-label="Note type">${DPN_CATS.filter(x => x.k !== 'wa').map(x => `<option value="${x.k}"${x.k === e.cat ? ' selected' : ''}>${x.i} ${_dpnEsc(x.l)}</option>`).join('')}</select>
        <textarea id="dpnEditText" rows="2" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();_dpnSaveEdit(${e.n})}">${_dpnEsc(e.text)}</textarea>
        <div class="dpn-editacts"><button type="button" class="dpn-hbtn" onclick="_dpn.edit=-1;_dpnPaint()">Cancel</button><button type="button" class="dpn-send" onclick="_dpnSaveEdit(${e.n})">Save</button></div></div>`;
    } else {
      main = `<div class="dpn-text">${_dpnEsc(e.body).replace(/\n/g, '<br>')}</div>${via}`;
    }
    const delBar = _dpn.del === e.n ? `<div class="dpn-delq" role="alert">Delete this note? <button type="button" class="dpn-hbtn" onclick="_dpn.del=-1;_dpnPaint()">Keep</button><button type="button" class="dpn-hbtn dpn-danger" onclick="_dpnDelete(${e.n})">Delete</button></div>` : '';
    html += `<article class="dpn-e${pinned ? ' pinned' : ''}" style="--k:${c.c}">
      <div class="dpn-e-time">${e.time ? _dpnEsc(e.time) : '—'}</div>
      <div class="dpn-e-dot" aria-hidden="true">${c.i}</div>
      <div class="dpn-e-main">
        <div class="dpn-e-top"><span class="dpn-chip">${_dpnEsc(c.l)}</span>${pinned ? '<span class="dpn-pinned">★ On the card</span>' : ''}
          <span class="dpn-e-acts">
            <button type="button" class="dpn-ib${pinned ? ' on' : ''}" onclick="_dpnPin(${e.n})" title="${pinned ? 'Unpin' : 'Show this note on the card'}" aria-label="${pinned ? 'Unpin note' : 'Pin note to the card'}" aria-pressed="${!!pinned}">${pinned ? '★' : '☆'}</button>
            <button type="button" class="dpn-ib" onclick="_dpn.edit=${e.n};_dpn.del=-1;_dpnPaint();setTimeout(()=>{const t=document.getElementById('dpnEditText');if(t){t.focus();t.setSelectionRange(t.value.length,t.value.length);}},0)" title="Edit" aria-label="Edit note">✎</button>
            <button type="button" class="dpn-ib" onclick="_dpn.del=${e.n};_dpn.edit=-1;_dpnPaint();document.querySelector('.dpn-delq')?.scrollIntoView({block:'nearest'})" title="Delete" aria-label="Delete note">🗑</button>
          </span></div>
        ${main}${delBar}
      </div>
    </article>`;
  });
  body.innerHTML = html;
}
function _dpnAdd() {
  const r = _dpnRoom(), ta = document.getElementById('dpnText');
  if (!r || !ta) return;
  const txt = ta.value.replace(/\{[^}]*\}/g, '').replace(/[ \t]+/g, ' ').trim();
  if (!txt) { ta.focus(); return; }
  const line = dpnLine(_dpnNow(), _dpn.cat, txt, true);
  r.note = r.note ? r.note.replace(/\s+$/, '') + '\n' + line : line;
  ta.value = ''; _dpnGrow(ta);
  if (_dpn.filter !== 'all' && _dpn.filter !== _dpn.cat) _dpn.filter = 'all';
  _dpnHead(); _dpnPaint(); _dpnSave(); ta.focus();
  const b = document.getElementById('dpnBody'); if (b) b.scrollTop = 0;
  if (typeof showToast === 'function') showToast(`Note added to room ${r.roomStr}`, 'ok');
}
function _dpnFind(n) { const r = _dpnRoom(); return r ? dpnParse(r.note).find(e => e.n === n) : null; }
function _dpnSaveEdit(n) {
  const r = _dpnRoom(), e = _dpnFind(n);
  const t = document.getElementById('dpnEditText'), c = document.getElementById('dpnEditCat');
  if (!r || !e || !t) return;
  const txt = t.value.trim();
  if (!txt) { _dpn.del = n; _dpn.edit = -1; _dpnPaint(); return; }
  const cat = c ? c.value : e.cat, tagIt = !!e.tag || cat !== dpnCat(txt);
  const was = e.key, now = dpnLine(e.time, cat, txt, tagIt);
  r.note = dpnReplace(r.note, e, now);
  if (r.notePin && (r.notePin === was || r.notePin === was.split('\n')[0])) r.notePin = now;
  _dpn.edit = -1; _dpnHead(); _dpnPaint(); _dpnSave();
}
function _dpnDelete(n) {
  const r = _dpnRoom(), e = _dpnFind(n);
  if (!r || !e) return;
  if (r.notePin && (r.notePin === e.key || r.notePin === e.key.split('\n')[0])) r.notePin = '';
  r.note = dpnReplace(r.note, e, null);
  _dpn.del = -1; _dpnHead(); _dpnPaint(); _dpnSave();
  if (typeof showToast === 'function') showToast('Note deleted', 'ok');
}
function _dpnPin(n) {
  const r = _dpnRoom(), e = _dpnFind(n);
  if (!r || !e) return;
  r.notePin = (r.notePin === e.key || r.notePin === e.key.split('\n')[0]) ? '' : e.key;
  _dpnPaint(); _dpnSave();
}
function _dpnRaw() {
  _dpn.raw = !_dpn.raw; _dpn.edit = _dpn.del = -1;
  _dpnHead(); _dpnPaint();
  if (_dpn.raw) { const t = document.getElementById('dpnRaw'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }
  else _dpnSave();
}
function _dpnCopy() {
  const r = _dpnRoom(); if (!r) return;
  const E = dpnParse(r.note);
  const txt = `Room ${r.roomStr} · ${_dpNice(r.name)}\n` + (E.length ? E.map(e => `${e.time ? e.time + ' ' : ''}${(DPN_CAT[e.cat] || DPN_CAT.gen).i} ${e.text}`).join('\n') : '(no notes)');
  const ok = () => typeof showToast === 'function' && showToast('Notes copied', 'ok');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, () => {});
}
// after the board re-renders (a colleague's change, WhatsApp…): refresh an open window unless someone is editing in it
function _dpnRefresh() {
  const ov = document.getElementById('dpnOv');
  if (!ov || !ov.classList.contains('open') || !_dpn.room) return;
  if (!_dpnRoom()) { depCloseNotes(); return; }
  _dpnHead();
  const busy = _dpn.edit >= 0 || _dpn.raw || (ov.contains(document.activeElement) && document.activeElement.closest('#dpnBody'));
  if (!busy) _dpnPaint();
}

// ── Check Out with balance warning ─────────────────────────
function depCheckOut(i) {
  const r = depRooms[i];
  if (depOwes(r)) {
    if (!confirm(`⚠ Room ${r.roomStr} has AED ${r.balance.toLocaleString('en',{minimumFractionDigits:2})} owing.\n\nAre you sure you want to check them out?`)) return;
  }
  depAction(i, 'out');
}

// ── Timestamp stamp button ─────────────────────────────────
function depStampNote(i) {
  const t   = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  const sep = depRooms[i].note ? '\n' : '';
  depRooms[i].note += sep + `[${t}] `;

  // Find the card and update textarea directly — no full re-render
  const card = [...document.querySelectorAll('.dep-card')]
    .find(c => c.dataset.room === depRooms[i].roomStr);
  if (card) {
    const ta = card.querySelector('.dc-note');
    const body = card.querySelector('.dc-note-body');
    const arrow = card.querySelector('.dc-note-arrow');
    const lbl = card.querySelector('.dc-note-lbl');
    if (ta) {
      ta.value = depRooms[i].note;
      // Expand the card body first if collapsed
      const dcBody = card.querySelector('.dc-body');
      const expandArrow = card.querySelector('.dc-expand-arrow');
      if (dcBody && dcBody.classList.contains('dc-body-collapsed')) {
        dcBody.classList.remove('dc-body-collapsed');
        if (expandArrow) expandArrow.textContent = '▾';
      }
      // Make sure the note section is open
      if (body) body.style.display = 'block';
      card.classList.add('dp-note-open');
      if (arrow) arrow.textContent = '▾';
      // Update preview snippet in header
      const preview = card.querySelector('.dc-note-preview');
      if (preview) {
        const first = depRooms[i].note.split('\n')[0].substring(0, 30);
        preview.textContent = first + (depRooms[i].note.length > 30 ? '…' : '');
      }
      // Focus at end
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }
  saveDeps();
}

// ── Guest intent ───────────────────────────────────────────
// Toggle: tap same intent again to clear it.
// Auto-stamps the note with context when set.
// Guest has physically left but finance still has to fix the room before the Opera check-out
function _depFinAgo(r) {
  if (!r.finAt) return '';
  const [h, m] = String(r.finAt).split(':').map(Number), d = new Date(); d.setHours(h, m, 0, 0);
  const min = Math.max(0, Math.round((Date.now() - d) / 60000));
  return min < 1 ? 'just now' : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}
const DEP_FIN_WHO = ['Finance', 'Reservations'];
function depFinanceHold(i, ev, who) {
  const r = depRooms[i]; if (!r) return;
  if (r.intent === 'finance_hold') { depSetIntent(i, ''); return; }
  if (!who) {   // ask who has to fix it
    if (ev) { ev.stopPropagation(); ev.preventDefault(); }
    document.getElementById('depBalPop')?.remove();
    const pop = document.createElement('div'); pop.id = 'depBalPop'; pop.className = 'dp-balpop'; pop.setAttribute('role', 'menu');
    pop.innerHTML = `<div class="dp-balpop-h">Room ${escapeHtml(r.roomStr)}: guest left. Waiting for…</div>` +
      DEP_FIN_WHO.map(w => `<button type="button" data-w="${w}">${w === 'Finance' ? '🧾' : '📅'} ${w}</button>`).join('') +
      `<button type="button" class="dp-balpop-x" data-x="1">Cancel</button>`;
    document.body.appendChild(pop);
    pop.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; pop.remove(); if (b.dataset.w) depFinanceHold(i, null, b.dataset.w); });
    const at = (ev && ev.currentTarget && ev.currentTarget.getBoundingClientRect) ? ev.currentTarget.getBoundingClientRect() : { left: innerWidth / 2 - 140, bottom: innerHeight / 2 };
    pop.style.left = Math.max(8, Math.min(innerWidth - 288, at.left)) + 'px';
    pop.style.top = Math.min(innerHeight - pop.offsetHeight - 8, at.bottom + 6) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', off, true); } }, true), 0);
    return;
  }
  r.finAt = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  r.finWho = who;
  r.note = (r.note ? r.note + '\n' : '') + `[${r.finAt}] Guest has physically left. Waiting for ${who} to fix the room before checking out in Opera.`;
  r.intent = 'finance_hold'; r.intentMinutes = null;
  depRender(); saveDeps();
  if (typeof showToast === 'function') showToast(`Room ${r.roomStr}: guest left, waiting for ${who}`, 'ok');
}
function depFinanceDone(i) {
  const r = depRooms[i]; if (!r) return;
  const t = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  r.note = (r.note ? r.note + '\n' : '') + `[${t}] ${r.finWho || 'Finance'} fixed the room${r.finAt ? ' (guest left at ' + r.finAt + ')' : ''}.`;
  r.intent = '';
  depAction(i, 'out');
}

// Extending: tick the paperwork (signature, TD) as it comes in
function depExtPaper(i, key) {
  const r = depRooms[i]; if (!r) return;
  r[key] = !r[key];
  const t = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const what = { extBook: 'New booking made', extSign: 'Signature collected', extTd: 'TD collected', extPay: 'Full payment taken' }[key] || key;
  if (r[key]) r.note = (r.note ? r.note + '\n' : '') + `[${t}] ${what} for the extension.`;
  depRender(); saveDeps();
  if (r.extBook && r.extSign && r.extTd && r.extPay && typeof showToast === 'function') showToast(`Room ${r.roomStr}: booking, signature, TD and payment done. Press ↪ Mark extended.`, 'ok');
}

function depSetIntent(i, intent) {
  const r       = depRooms[i];
  const isToggle = r.intent === intent;

  r.intent = isToggle ? '' : intent;
  if (r.intent !== 'checkout_soon') r.intentMinutes = null;

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

// ── Dispatcher for the "Guest said…" dropdown — resets the select back
// to its placeholder after firing, since the intent banner up top (not
// the select itself) is what shows the currently-active state. ──
function depIntentSelect(i, val, selectEl) {
  if (!val) return;
  if (val === 'checkout_soon') depSetCheckoutSoon(i);
  else depSetIntent(i, val);
  if (selectEl) selectEl.value = '';
}

// ── "Checking out in X mins" — same as depSetIntent but asks for the
// minutes value up front, since that's the whole point of this one. ──
function depSetCheckoutSoon(i) {
  const r = depRooms[i];
  if (r.intent === 'checkout_soon') {
    r.intent = ''; r.intentMinutes = null;
    depRender(); saveDeps();
    return;
  }
  const mins = prompt('Guest checking out in how many minutes?', '15');
  if (mins === null) return; // cancelled
  const n = parseInt(mins, 10);
  if (!n || n <= 0) { showToast('Enter a valid number of minutes', 'err'); return; }

  r.intent = 'checkout_soon';
  r.intentMinutes = n;
  const t    = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  const line = `[${t}] Guest checking out in ${n} min.`;
  r.note = r.note ? r.note + '\n' + line : line;

  depRender();
  saveDeps();
}

// ── Name inline edit ───────────────────────────────────────
function depEditName(i) {
  const card = [...document.querySelectorAll('#depGrid .dep-card')].find(c => c.dataset.room === String(depRooms[i] && depRooms[i].roomStr));
  const byCard = card && card.querySelector('.dc-name');
  if (byCard) {
    byCard.outerHTML = `<input class="dc-edit-name dp-edit-name" id="en-${i}"
      value="${escapeHtml(depRooms[i].name)}"
      onblur="depSaveName(${i},this.value)"
      onkeydown="if(event.key==='Enter')this.blur()"/>`;
    const inp0 = document.getElementById('en-' + i);
    if (inp0) { inp0.focus(); inp0.select(); }
    return;
  }
  const allFiltered = depRooms.filter(r => {
    const es = effectiveStatus(r);
    switch (depFilter_) {
      case 'all':          return es === 'due' || es === 'late' || es === 'na' || es === 'dnd';
      case 'balance':      return depOwes(r) && es !== 'out' && es !== 'extended';
      case 'pending':      return !!r.intent && es !== 'out' && es !== 'extended';
      case 'maybe_extend': return r.intent === 'maybe_extend' || r.intent === 'extending';
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
  if (status === 'na')  r.naTime  = t;    else r.naTime  = '';
  if (status === 'dnd') r.dndTime = t;    else r.dndTime = '';
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
  const _actionLabels = { out:'Checked out', na:'Marked N/A', dnd:'Marked DND', late:'Late checkout', extended:'Extended stay', due:'Undid action' };
  logActivity('departure_' + status, `Room ${r.roomStr} — ${r.name} (${_actionLabels[status] || status})`);
}

// The last copy heard from the server, so a save sends only what this device changed: a whole-board
// save from a copy that was behind put a colleague's check-outs back to "due" and dropped their log lines.
let _depBase = null;
function depSetBase(rooms, log) { _depBase = { rooms: (rooms || []).map(r => JSON.stringify(r)), log: (log || []).map(e => JSON.stringify(e)) }; }
function saveDeps() {
  const b = _depBase, srv = window._depPendingSnap;
  const sameBoard = b && typeof fbUpdate === 'function' && b.rooms.length === depRooms.length &&
    depRooms.every((r, i) => { try { return JSON.parse(b.rooms[i]).roomStr === r.roomStr; } catch (_) { return false; } });
  if (!sameBoard) { saveDepartures(depRooms, depLog); depSetBase(depRooms, depLog); return; }   // a new upload or a clear: the whole board
  const patch = {};
  depRooms.forEach((r, i) => { if (JSON.stringify(r) !== b.rooms[i]) patch['rooms/' + i] = r; });
  // the log: my new lines on top of the server's, minus the lines I removed (undo)
  const js = e => JSON.stringify(e), local = depLog.map(js), baseSet = new Set(b.log), localSet = new Set(local);
  const added = depLog.filter((e, i) => !baseSet.has(local[i]));
  const removed = new Set(b.log.filter(x => !localSet.has(x)));
  const server = (srv && Array.isArray(srv.log)) ? srv.log : b.log.map(x => JSON.parse(x));
  const merged = added.concat(server.filter(e => !removed.has(js(e))));
  if (!Object.keys(patch).length && merged.length === server.length && !added.length && !removed.size) return;
  patch.log = merged; patch.date = typeof hoLocalISO === 'function' ? hoLocalISO() : new Date().toISOString().slice(0, 10); patch.updatedAt = new Date().toISOString();
  fbUpdate('departures', patch);
}

// Public read-only check used by the Firebase listener and depRender
function depIsTyping() {
  // True if user is actively in a note field OR the typing lock is still hot
  const depGrid = document.getElementById('depGrid');
  const focusedInGrid = depGrid && depGrid.contains(document.activeElement);
  return _noteTypingActive || focusedInGrid;
}

// ── Late time setter — no re-render, patches badge directly ─
function depSetLateTime(i, time) {
  depRooms[i].lateTime = time;
  // Update the badge text in-place
  const r    = depRooms[i];
  const card = [...document.querySelectorAll('.dep-card')].find(c => c.dataset.room === r.roomStr);
  if (card) {
    const badge = card.querySelector('.dc-sbadge');
    if (badge) badge.textContent = `LATE CO${time ? ' · ' + time : ''}`;
  }
  saveDeps();
}

// ── Note input — debounced save, typing-lock blocks re-renders ─
// _noteDebounceTimer: delays the Firebase write until 2s after last keystroke
// _noteTypingLock:    blocks ANY depRender() for 3s after last keystroke,
//                     so a colleague's update or our own Firebase echo can
//                     never interrupt mid-sentence.
let _noteDebounceTimer = null;
let _noteTypingLock    = null;
let _noteTypingActive  = false;

function depNoteInput(i, value) {
  depRooms[i].note = value;

  // Set typing lock — any re-render that checks _noteTypingActive will skip
  _noteTypingActive = true;
  clearTimeout(_noteTypingLock);
  _noteTypingLock = setTimeout(() => { _noteTypingActive = false; }, 3000);

  // Debounce the actual Firebase save to 2s after last keystroke
  clearTimeout(_noteDebounceTimer);
  _noteDebounceTimer = setTimeout(() => saveDeps(), 2000);
}

// ── Extension field updater ────────────────────────────────
function depExtUpdate(i, field, value) {
  const r = depRooms[i];
  const t = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });

  if (field === 'nights') {
    r.extensionNights = value;
    depSyncExtToLog(i);
    // Update the new departure date label in the card without full re-render
    const card = [...document.querySelectorAll('.dep-card')].find(c => c.dataset.room === r.roomStr);
    if (card) {
      const origDep = parseOperaDate(r.departure);
      if (origDep) {
        const nd = new Date(origDep); nd.setDate(nd.getDate() + value);
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const newDepStr = `${String(nd.getDate()).padStart(2,'0')} ${months[nd.getMonth()]} ${nd.getFullYear()}`;
        const valEl = card.querySelector('.dc-ext-val');
        if (valEl) { valEl.textContent = newDepStr; valEl.className = 'dc-ext-val ext-val-highlight'; }
        // Update badge
        const badge = card.querySelector('.dc-sbadge');
        if (badge) {
          badge.textContent = `↪ EXT +${value}N → ${String(nd.getDate()).padStart(2,'0')} ${months[nd.getMonth()]}`;
          if (!r.extConfirmed) badge.textContent += ' ⚠';
        }
      }
    }
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
      // Patch textarea directly — no re-render
      const card = [...document.querySelectorAll('.dep-card')].find(c => c.dataset.room === r.roomStr);
      if (card) {
        const ta = card.querySelector('.dc-note');
        if (ta) ta.value = r.note;
        const confirmBtn = card.querySelector('.dc-ext-confirm-btn');
        if (confirmBtn) {
          confirmBtn.textContent = '✓ Opera updated';
          confirmBtn.className   = 'dc-ext-confirm-btn ext-confirmed-yes';
          confirmBtn.setAttribute('onclick', `depExtUpdate(${i},'confirmed',false)`);
        }
      }
    } else {
      // Toggled off — just update the button, no note
      const card = [...document.querySelectorAll('.dep-card')].find(c => c.dataset.room === r.roomStr);
      if (card) {
        const confirmBtn = card.querySelector('.dc-ext-confirm-btn');
        if (confirmBtn) {
          confirmBtn.textContent = '⚠ Needs Opera update';
          confirmBtn.className   = 'dc-ext-confirm-btn ext-confirmed-no';
          confirmBtn.setAttribute('onclick', `depExtUpdate(${i},'confirmed',true)`);
        }
      }
    }
  }

  // Only re-render for nights change (badge/date update already done inline above)
  // All other fields are simple data changes — save only, no DOM rebuild
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
  const lastEl = document.getElementById('depLogLast');
  if (lastEl) {
    const l0 = entries[0], verb = { out: 'checked out', extended: 'extended', late: 'late check-out', na: 'no answer', dnd: 'DND', undo: 'undone' };
    lastEl.textContent = l0 ? `Last: ${l0.room} ${verb[l0.action] || l0.action} · ${l0.time}` : '';
  }

  const aLabel = {
    out:      '✓ Checked Out',
    extended: '↪ Extended',
    late:     '🕐 Late CO',
    na:       '📵 No Answer',
    dnd:      '🚫 DND',
    undo:     '↺ Undone',
  };
  const aCls = {
    out:      'log-act-co',
    extended: 'log-act-ext',
    late:     'log-act-late',
    na:       'log-act-na',
    dnd:      'log-act-na',
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
  // only the room's latest action can be undone: undoing an older line put a checked-out room back to "due"
  if (depLog.slice(0, li).some(e => e && e.room === entry.room && e.action !== 'undo')) {
    showToast(`Room ${entry.room} has a newer action — undo that one first`, 'info'); return;
  }
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
// ── Copy DND rooms list ────────────────────────────────────
function depCopyDNDList(mode) {
  const rooms = depRooms.filter(r => r.status === 'dnd');
  if (!rooms.length) { showToast('No DND rooms', 'info'); return; }

  let text;
  if (mode === 'summary') {
    text = '🚫 DND Rooms\n' + rooms.map(r => r.roomStr).join(', ');
  } else {
    const t = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
    text = `🚫 DND Rooms — ${t}\n${'─'.repeat(30)}\n` +
      rooms.map(r => {
        const since = r.dndTime ? ` · DND since ${r.dndTime}` : '';
        return `Rm ${r.roomStr}${since}`;
      }).join('\n');
  }
  copyToClipboard(text, null, '');
  showToast('DND list copied ✓', 'ok');
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

// ── Copy just the single most-recently checked-out room ───
// The bulk copy options (30 min / 1 hour / all) all group multiple rooms;
// this is the "just one room, whichever checked out last" case that
// otherwise required hunting for it in Pick Rooms mode.
function depCopyLastOut() {
  const rooms = depRooms.filter(r => r.status === 'out' && r.checkoutAt);
  if (!rooms.length) { showToast('No checked-out rooms with a time yet', 'info'); return; }
  const r = [...rooms].sort((a, b) => _coTimeSort(b, a))[0]; // newest first
  const time = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  const text = `✅ *Checked Out — ${time}*\n${r.roomStr} · ${r.checkoutAt}`;
  copyToClipboard(text, null, '');
  showToast(`Room ${r.roomStr} copied ✓`, 'ok');
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
// Shows only rooms that still need action (due, late, NA). Extended = done.
// Checked-out rooms are NOT included — HK already has those from the
// individual checkout copies. This is the "what's left" message.
function depCopyHKUpdate() {
  if (!depRooms.length) { showToast('No rooms loaded', 'info'); return; }
  const time = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });

  const HK_LABEL = {
    extended: '↪ EXT',
    late:     '🕐 LCO',
    na:       '📵 NA',
    dnd:      '🚫 DND',
    due:      '⏳ DUE',
  };

  // Only include rooms that still need action — exclude checked-out
  const sorted = [...depRooms]
    .filter(r => effectiveStatus(r) !== 'out' && r.status !== 'extended' && r.status !== 'dnd')
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
    if ((r.intent === 'maybe_extend' || r.intent === 'extending') && es !== 'extended') label = `⏳ Extending`;
    if (r.intent === 'finance_hold' && es !== 'out' && es !== 'extended') label = `🧾 LEFT (${String(r.finWho || 'finance').toLowerCase()})`;
    if (depOwes(r) && es !== 'extended')              label += ` 💳`;
    return `${r.roomStr.padEnd(5)} ${label}`;
  });

  const mayExtCount = sorted.filter(r => r.intent === 'maybe_extend' && effectiveStatus(r) !== 'extended').length;
  const finalSummary = [
    sc.late     ? `🕐 ${sc.late} LCO`           : '',
    sc.na       ? `📵 ${sc.na} NA`               : '',
    sc.dnd      ? `🚫 ${sc.dnd} DND`             : '',
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
  if (grid) grid.className = 'dp-grid dp-size-' + size;
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
  const withBalance = dueRooms.filter(r => depOwes(r));
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
  depRooms = []; depFilter_ = 'all'; depLog = []; _depLastSt = null; _depLastKpi = {};
  document.getElementById('depBoard').style.display      = 'none';
  document.getElementById('depUploadCard').style.display = 'block';
  document.getElementById('depInput').value              = '';
  document.getElementById('depDateLabel').textContent    = "Today's departures · Load Opera report to begin";
  const b = document.getElementById('badge-departures'); if (b) b.textContent = '0';
  const hkBar = document.getElementById('depHKBar'); if (hkBar) hkBar.style.display = 'none';
  ['depPrintBtn','depExportBtn','depViewToggle','depReloadBtn','depAlertToggle','depTrendsBtn'].forEach(id => {
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
  XLSX.writeFile(wb, 'Departures_' + hoLocalISO() + '.xlsx');
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
      <div class="lco-name">${escapeHtml(r.name || '')}</div>
      <div class="lco-lbl">AGREED TIME</div>
      <div id="lcoQuickBtns">
        ${QUICK.map(t => `<button data-t="${t}" onclick="lcoQuickPick('${t}')">${t}</button>`).join('')}
      </div>
      <input id="lcoCustomInput" type="text" placeholder="or type e.g. 12:45" maxlength="5" value="${escapeHtml(r.lateTime || '')}" />
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
    // "1pm", "1300", "13.30": written as 13:00 / 13:30, or the overdue alert could never read it
    let lt = time;
    if (_parseLcoTime(lt) == null) {
      const m = lt.replace(/\s+/g, '').match(/^(\d{1,2})(?:[.h]?(\d{2}))?(am|pm)?$/i);
      let h = m ? +m[1] : NaN, mi = m && m[2] ? +m[2] : 0;
      if (m && m[3]) { const pm = /pm/i.test(m[3]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
      if (!m || h > 23 || mi > 59) { showToast('Write the time like 12:45 or 1pm', 'err'); return; }
      lt = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
    }
    document.getElementById('lcoPickerOverlay').remove();
    document.getElementById('lcoStyle')?.remove();
    depRooms[idx].lateTime = lt;
    depAction(idx, 'late');
  };

  const cleanup = () => { document.getElementById('lcoStyle')?.remove(); };
  overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); cleanup(); } });
  document.body.appendChild(overlay);
  if (r.lateTime) lcoQuickPick(r.lateTime);
  setTimeout(() => document.getElementById('lcoCustomInput')?.focus(), 50);
}

// ══════════════════════════════════════════════════════════════
//  LOAD FROM A FILE — Browse button, drag & drop (paste still works)
//  Every format ends up as the tab-separated text the Opera
//  "Delimited Data" export already is, then goes through the same
//  parseDepReport → processDep / processDepReload path as a paste.
// ══════════════════════════════════════════════════════════════
function depBrowse() {
  const inp = document.getElementById('depFileInput');
  if (!inp) return;
  inp.value = '';
  inp.click();
}

function depLoadFromInput(inp) {
  const f = inp && inp.files && inp.files[0];
  if (f) depHandleFile(f);
}

const _DEP_ALIAS = {
  ROOM: ['ROOM_NO', 'ROOM_NUMBER', 'RM', 'RM_NO'],
  GUEST_NAME: ['FULL_NAME', 'NAME', 'GUEST', 'GUESTNAME', 'GUEST_FULL_NAME'],
  ARRIVAL: ['ARRIVAL_DATE', 'ARR', 'ARR_DATE'],
  DEPARTURE: ['DEPARTURE_DATE', 'DEP', 'DEP_DATE'],
  DEPARTURE_TIME: ['DEP_TIME', 'ETD', 'CHECKOUT_TIME'],
  BALANCE: ['BAL', 'BALANCE_AMOUNT', 'OPEN_BALANCE'],
  NIGHTS: ['NO_OF_NIGHTS', 'NTS'],
};

// Excel date cells → the Opera text the parser reads ("17-OCT-26" / "14:00")
function _depCellText(v) {
  if (v instanceof Date && !isNaN(v)) {
    if (v.getFullYear() < 1901) return `${String(v.getHours()).padStart(2, '0')}:${String(v.getMinutes()).padStart(2, '0')}`;
    const M = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    return `${String(v.getDate()).padStart(2, '0')}-${M[v.getMonth()]}-${String(v.getFullYear()).slice(-2)}`;
  }
  return v == null ? '' : String(v).replace(/[\t\r\n]+/g, ' ').trim();
}

// 2-D rows → tab text with Opera header names; finds the header row under any title lines
function _depRowsToTsv(rows) {
  rows = (rows || []).filter(r => Array.isArray(r) && r.some(c => _depCellText(c)));
  const norm = h => _depCellText(h).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  let hi = rows.findIndex((r, i) => i < 25 && r.some(c => { const n = norm(c); return n === 'ROOM' || _DEP_ALIAS.ROOM.includes(n); }));
  if (hi < 0) return '';
  const hdr = rows[hi].map(norm);
  Object.entries(_DEP_ALIAS).forEach(([canon, alts]) => {
    if (hdr.includes(canon)) return;
    const j = hdr.findIndex(h => alts.includes(h));
    if (j >= 0) hdr[j] = canon;
  });
  const width = Math.max(15, hdr.length);
  const pad = r => { const a = r.map(_depCellText); while (a.length < width) a.push(''); return a.join('\t'); };
  return [pad(hdr)].concat(rows.slice(hi + 1).map(pad)).join('\n');
}

// Opera XML: the repeated element that has a <ROOM> child is one room
function _depXmlRows(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return [];
  const recs = [...doc.getElementsByTagName('*')].filter(el =>
    [...el.children].some(c => /^(ROOM|ROOM_NO|ROOM_NUMBER)$/i.test(c.tagName) && !c.children.length));
  if (!recs.length) return [];
  const cols = [];
  recs.forEach(el => [...el.children].forEach(c => { if (!c.children.length && !cols.includes(c.tagName)) cols.push(c.tagName); }));
  return [cols].concat(recs.map(el => cols.map(cn => { const c = [...el.children].find(x => x.tagName === cn); return c ? c.textContent : ''; })));
}

// One sheet → rows; Excel date cells become Opera text without any time-zone shift
function _depSheetToRows(ws) {
  if (!ws || !ws['!ref']) return [];
  const rg = XLSX.utils.decode_range(ws['!ref']), rows = [];
  const M = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  for (let R = rg.s.r; R <= rg.e.r; R++) {
    const row = [];
    for (let C = rg.s.c; C <= rg.e.c; C++) {
      const c = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      let v = c ? c.v : '';
      if (c && c.t === 'n' && c.z && XLSX.SSF && XLSX.SSF.is_date(c.z)) {
        const d = XLSX.SSF.parse_date_code(c.v);
        v = c.v < 1 ? `${String(d.H).padStart(2, '0')}:${String(d.M).padStart(2, '0')}`
                    : `${String(d.d).padStart(2, '0')}-${M[d.m - 1]}-${String(d.y).slice(-2)}`;
      } else if (c && c.t === 'd' && c.v instanceof Date) v = _depCellText(c.v);
      else if (c && c.w !== undefined && c.t !== 'n') v = c.w;
      row.push(v == null ? '' : v);
    }
    rows.push(row);
  }
  return rows;
}

function _depSheetRows(wb) {
  let best = [];
  (wb.SheetNames || []).forEach(n => {
    const rows = _depSheetToRows(wb.Sheets[n]);
    if (_depRowsToTsv(rows) && rows.length > best.length) best = rows;
  });
  return best;
}

async function depHandleFile(file) {
  const name = (file && file.name) || 'file';
  try {
    if (/\.pdf$/i.test(name)) {
      showToast('A PDF can’t be read here. In Opera, download the departures report as Delimited Data (.txt) or Excel.', 'warn');
      return false;
    }
    let tsv = '';
    if (/\.(xlsx|xls|csv|html?)$/i.test(name)) {
      if (typeof XLSX === 'undefined') { showToast('The Excel reader is still loading. Try again in a moment.', 'warn'); return false; }
      const wb = /\.(csv|html?)$/i.test(name)
        ? XLSX.read(await file.text(), { type: 'string', raw: true })
        : XLSX.read(await file.arrayBuffer(), { type: 'array', cellNF: true });
      tsv = _depRowsToTsv(_depSheetRows(wb));
    } else {
      const text = await file.text();
      if (/^\s*</.test(text)) tsv = _depRowsToTsv(_depXmlRows(text));
      else if (/\t/.test(text.split('\n')[0] || '')) tsv = /(^|\t)ROOM(\t|\r|$)/m.test(text.split('\n')[0]) ? text : _depRowsToTsv(text.split(/\r?\n/).map(l => l.split('\t')));
      else if (typeof XLSX !== 'undefined') tsv = _depRowsToTsv(_depSheetRows(XLSX.read(text, { type: 'string', raw: true })));
      else tsv = _depRowsToTsv(text.split(/\r?\n/).map(l => l.split(/[;,]/)));
    }
    return depLoadText(tsv, name);
  } catch (e) {
    try { console.warn('[departures] file', e); } catch (_) {}
    showToast(`Could not read ${name}`, 'err');
    return false;
  }
}

// Same day already on the board → merge (statuses, notes and times are kept);
// a new day → a fresh board, as a paste does.
function depLoadText(text, srcName) {
  const rooms = text ? parseDepReport(text) : null;
  if (!rooms) {
    showToast(`No departure rooms found in ${srcName || 'this file'}. It needs a ROOM column (Opera Delimited Data or Excel).`, 'err');
    return false;
  }
  const newDate = (rooms.find(r => r.departure) || {}).departure || '';
  const curDate = (depRooms.find(r => r.departure && !r.manual) || {}).departure || '';
  if (depRooms.length && (!curDate || !newDate || curDate === newDate)) {
    const ta = document.getElementById('depReloadInput');
    if (ta) { ta.value = text; processDepReload(); return true; }
  }
  if (depRooms.length && depLog.length && !confirm(`The board has the list for ${curDate} with ${depLog.length} action${depLog.length === 1 ? '' : 's'}.\n\nReplace it with the list for ${newDate}?`)) return false;
  const inp = document.getElementById('depInput');
  if (!inp) return false;
  inp.value = text;
  processDep();
  return true;
}

// Drop a file anywhere on the Departures page
function _depInitDrop() {
  const panel = document.getElementById('panel-departures');
  if (!panel || panel._dpDrop) return;
  panel._dpDrop = true;
  let depth = 0;
  const hasFiles = e => [...((e.dataTransfer && e.dataTransfer.types) || [])].includes('Files');
  panel.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; panel.classList.add('dp-dragging'); });
  panel.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
  panel.addEventListener('dragleave', e => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) panel.classList.remove('dp-dragging'); });
  panel.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();               // the app-wide drop router leaves it to this page
    depth = 0; panel.classList.remove('dp-dragging');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) depHandleFile(f);
  });
}

function _depInitUi() {
  _depInitDrop();
  _depApplyDensity();
  // the action log starts folded away: tap its header to open it
  try { if (typeof toggleLog === 'function' && typeof _logOpen !== 'undefined' && _logOpen) toggleLog(); } catch (_) {}
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _depInitUi);
else _depInitUi();

// ── Masonry: cards of different heights fit together with no empty gaps ──
// Each card spans as many 4px grid rows as its height, so the next card moves up under it while the
// order still reads left → right. Recomputed when cards change size (notes, extend form, status).
(function () {
  const ROW = 4, GAP = 10;
  let ro = null, raf = 0;
  function layout() {
    raf = 0;
    const grid = document.getElementById('depGrid');
    if (!grid) return;
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
    const on = false;   // rows stay straight (4 per line); the old masonry stagger is off
    grid.classList.toggle('dp-masonry', on);
    grid.querySelectorAll(':scope > .dp-card').forEach(c => {
      if (!on) { c.style.gridRowEnd = ''; return; }
      const h = c.getBoundingClientRect().height;
      c.style.gridRowEnd = 'span ' + Math.max(1, Math.ceil((h + GAP) / ROW));
    });
  }
  const queue = () => { if (!raf) raf = requestAnimationFrame(layout); };
  function watch() {
    const grid = document.getElementById('depGrid');
    if (!grid || grid._dpMasonry) return;
    grid._dpMasonry = true;
    if ('ResizeObserver' in window) ro = new ResizeObserver(queue);
    const observeCards = () => { if (ro) grid.querySelectorAll(':scope > .dp-card').forEach(c => ro.observe(c)); queue(); };
    new MutationObserver(observeCards).observe(grid, { childList: true });
    window.addEventListener('resize', queue);
    observeCards();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
  window.depMasonryLayout = queue;
})();

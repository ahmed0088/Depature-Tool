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

// ── Render ─────────────────────────────────────────────────
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

  const search = (document.getElementById('depSearch')?.value || '').toLowerCase();

  // Filter rules:
  // 'all'     → active only: due + late + na  (out + extended are done/hidden)
  // 'balance' → active rooms with owing balance
  // 'pending' → rooms with a guest intent flag still active
  // everything else → match effectiveStatus exactly
  let filtered = depRooms.filter(r => {
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
    const ms = !search ||
      r.roomStr.includes(search) ||
      r.name.toLowerCase().includes(search) ||
      r.source.toLowerCase().includes(search) ||
      (r.note && r.note.toLowerCase().includes(search));
    return mf && ms;
  });

  // Sort: overdue first → then by time remaining (soonest deadline first) → then room number
  filtered.sort((a, b) => {
    const ao = isLcoOverdue(a), bo = isLcoOverdue(b);
    if (ao !== bo) return ao ? -1 : 1;
    // Both overdue or both not — sort by depTime if available, then room number
    const at = _depTimeMins(a), bt = _depTimeMins(b);
    if (at !== null && bt !== null) return at - bt;
    if (at !== null) return -1;
    if (bt !== null) return 1;
    return a.room - b.room;
  });

  document.getElementById('depGrid').innerHTML = filtered.map(r => depCardHTML(r)).join('');
  renderDepLog();

  const qb = document.getElementById('depQuickBar');
  if (sc.due > 3) {
    qb.style.display = 'flex';
    document.getElementById('depQuickLabel').textContent = `${sc.due} rooms still due out`;
  } else {
    qb.style.display = 'none';
  }
}

// ── Intent config ──────────────────────────────────────────
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
    badgeText = `EXT +${r.extensionNights}N`;
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
        ${['10:00 AM','11:00 AM','12:00 PM','1:00 PM','2:00 PM','3:00 PM','4:00 PM',
           '5:00 PM','6:00 PM','7:00 PM','8:00 PM','9:00 PM','10:00 PM','11:00 PM','12:00 AM']
          .map(t => `<option${r.lateTime===t?' selected':''}>${t}</option>`).join('')}
      </select>
    </div>` : '';

  // Extension nights dropdown
  const extRow = es === 'extended' ? `
    <div class="dc-sel-row">
      <span class="dc-sel-lbl ext">↪ Extra nights:</span>
      <select class="dc-select ext" onchange="depRooms[${i}].extensionNights=parseInt(this.value)||0;depSyncExtToLog(${i});depRender();saveDeps()">
        ${[1,2,3,4,5,6,7].map(n => `<option${r.extensionNights===n?' selected':''}>${n} night${n>1?'s':''}</option>`).join('')}
      </select>
    </div>` : '';

  // Action buttons — driven by effective status
  let actHTML = '';
  if (es === 'out' || es === 'extended') {
    actHTML = `<div class="dc-actions g1">
      <button class="dca dca-undo" onclick="depAction(${i},'due')">↺ Undo</button>
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
      <button class="dca dca-ext"  onclick="depAction(${i},'extended')">↪ Extend</button>
      <button class="dca dca-late" onclick="depAction(${i},'late')">🕐 Late CO</button>
      <button class="dca dca-na"   onclick="depAction(${i},'na')">📵 No Answer</button>
    </div>${intentRow}`;
  }

  return `<div class="dep-card ${sClass}">
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

// ── Actions ────────────────────────────────────────────────
function depAction(i, status) {
  const r    = depRooms[i];
  const prev = r.status;
  r.status   = status;
  const t    = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });

  if (status === 'out') r.checkoutAt = t; else r.checkoutAt = '';
  if (status === 'na')  r.naTime = t;     else r.naTime = '';
  if (status !== 'late')     r.lateTime = '';
  if (status !== 'extended') r.extensionNights = 0;
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
    const li = depLog.findIndex(l => l.room === r.roomStr);
    if (li >= 0) depLog.splice(li, 1);
  }

  depRender();
  updateDepBadge();
  saveDeps();
}

function saveDeps() {
  saveDepartures(depRooms, depLog);
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
  const aLabel = { out:'✓ Checked Out', extended:'↪ Extended', late:'🕐 Late CO', na:'📵 No Answer' };
  const aCls   = { out:'log-act-co',    extended:'log-act-ext', late:'log-act-late', na:'log-act-na' };
  if (body) body.innerHTML = entries.map((l, li) => `
    <div class="log-row">
      <span class="log-room">${escapeHtml(l.room)}</span>
      <span class="log-name">${escapeHtml(l.name)}</span>
      <span class="log-action ${aCls[l.action]||''}">${aLabel[l.action]||l.action}</span>
      <span class="log-time">${l.time}</span>
      <button class="log-undo" onclick="depUndoLog(${li})">↺ Undo</button>
    </div>`).join('');
}

function depUndoLog(li) {
  const entry = depLog[li]; if (!entry) return;
  // Find by room string — roomIdx can be stale after reloads
  const r = depRooms.find(rm => rm.roomStr === entry.room) || depRooms[entry.roomIdx];
  if (r) {
    r.status         = entry.prevStatus || 'due';
    r.checkoutAt     = '';
    r.lateTime       = '';
    r.extensionNights = 0;
    r.intent         = '';
    r.naTime         = '';
  }
  depLog.splice(li, 1);
  depRender();
  updateDepBadge();
  saveDeps();
}

function toggleLog() {
  const body = document.getElementById('depLogBody');
  const icon = document.getElementById('depLogToggleIcon');
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (icon) icon.textContent = open ? '▸ expand' : '▾ collapse';
}

// ── Filters ────────────────────────────────────────────────
// ── Copy single card for handover (WhatsApp / Teams) ─────
function depCopyCard(i) {
  const r = depRooms[i];
  const statusLabel = { due:'Due Out', out:'Checked Out', extended:'Extended', late:'Late CO', na:'No Answer' };
  const lines = [
    `🏨 Room ${r.roomStr} — ${r.name}`,
    `Status: ${statusLabel[r.status] || r.status.toUpperCase()}${r.lateTime ? ' · ' + r.lateTime : ''}${r.extensionNights ? ' +' + r.extensionNights + 'N' : ''}`,
    `Dates: ${r.arrival} → ${r.departure} (${r.nights}n)`,
    r.balance > 0 ? `⚠ Balance: AED ${r.balance.toLocaleString('en', {minimumFractionDigits:2})} OWING` : `Balance: Settled`,
    r.source ? `Source: ${r.source}` : '',
    r.rateCode ? `Rate: ${r.rateCode}` : '',
    r.note ? `Notes: ${r.note}` : '',
  ].filter(Boolean);
  copyToClipboard(lines.join('\n'), null, '');
  showToast(`Room ${r.roomStr} copied ✓`, 'ok');
}

function depCopyNAList() {
  const naRooms = depRooms.filter(r => r.status === 'na');
  if (!naRooms.length) { showToast('No rooms marked No Answer', 'info'); return; }
  const time = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  const lines = naRooms.map(r => {
    const t = r.naTime || time;
    return `📵 ${r.roomStr} · ${r.name} · ${t}`;
  });
  const text = `📵 *NA Rooms — ${time}*\n${lines.join('\n')}\n\n*Please do* 🙏`;
  const btn = document.getElementById('depNaCopyBtn');
  copyToClipboard(text, btn, '📋 Copy for HK');
  showToast('NA list copied ✓', 'ok');
}

function depCopyOutList() {
  const outRooms = depRooms.filter(r => r.status === 'out');
  if (!outRooms.length) { showToast('No checked-out rooms yet', 'info'); return; }
  const time = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  const lines = outRooms.map(r => {
    const t = r.checkoutAt || time;
    return `✓ ${r.roomStr} · ${r.name} · ${t}`;
  });
  const text = `✅ *Checked Out Rooms — ${time}*\n${lines.join('\n')}\n\n*Please do* 🙏`;
  const btn = document.getElementById('depOutCopyBtn');
  copyToClipboard(text, btn, '📋 Copy for HK');
  showToast('Checkout list copied ✓', 'ok');
}

function depCopyExtList() {
  const extRooms = depRooms.filter(r => r.status === 'extended');
  if (!extRooms.length) { showToast('No extended rooms', 'info'); return; }
  const time = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  const lines = extRooms.map(r => {
    const n = r.extensionNights || 1;
    return `↪ ${r.roomStr} · ${r.name} · +${n}N`;
  });
  const text = `↪ *Extensions — ${time}*\n${lines.join('\n')}`;
  const btn = document.getElementById('depExtCopyBtn');
  copyToClipboard(text, btn, '📋 Copy for HK');
  showToast('Extensions copied ✓', 'ok');
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
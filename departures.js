// ═══════════════════════════════════════════════════════════
//  departures.js  —  Departure follow-up board (with No Answer + Pending Extension)
// ═══════════════════════════════════════════════════════════

function processDep(isReload = false) {
  const raw    = document.getElementById('depInput').value.trim();
  const errBox = document.getElementById('depError');
  errBox.classList.remove('show');
  const showErr = msg => { document.getElementById('depErrorMsg').textContent = msg; errBox.classList.add('show'); };

  if (!raw) return showErr('Please paste the departure report first.');
  const lines = raw.split('\n').filter(l => l.trim());
  if (lines.length < 2) return showErr('File appears empty.');
  const hdrs = lines[0].split('\t').map(h => h.trim());
  const idx  = {}; hdrs.forEach((h, i) => idx[h] = i);
  if (idx['ROOM'] === undefined) return showErr('ROOM column not found. Use Delimited Data format.');

  // Parse incoming report
  const incomingRooms = [];
  for (let i = 1; i < lines.length; i++) {
    const p    = lines[i].split('\t'); if (p.length < 15) continue;
    const room = (p[idx['ROOM']] || '').trim(); if (!room || isNaN(parseInt(room))) continue;
    const bal  = parseFloat((p[idx['BALANCE']] || '0').replace(/,/g, '')) || 0;
    const agent = (p[idx['TRAVEL_AGENT_NAME']] || '').trim();
    const src   = cleanSource(agent, (p[idx['COMPANY_NAME']] || '').trim(), (p[idx['SOURCE_NAME']] || '').trim());
    incomingRooms.push({
      room: parseInt(room), roomStr: room,
      name:      parseName(p[idx['GUEST_NAME']] || ''),
      arrival:   (p[idx['ARRIVAL']]   || '').trim(),
      departure: (p[idx['DEPARTURE']] || '').trim(),
      nights:    parseInt(p[idx['NIGHTS']] || 0) || 0,
      balance:   bal,
      source:    src,
      company:   (p[idx['COMPANY_NAME']] || '').trim(),
      rateCode:  (p[idx['RATE_CODE']]    || '').trim(),
      isVip:     !!(p[idx['VIP']]        || '').trim(),
      depTime:   (p[idx['DEPARTURE_TIME']] || '').trim(),
    });
  }
  if (!incomingRooms.length) return showErr('No departure rooms found.');

  // If this is a reload and we have existing rooms, MERGE intelligently
  let mergedRooms = [];
  let removedRooms = [];
  const logTime = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });

  if (isReload && depRooms.length > 0) {
    const existingMap = new Map();
    depRooms.forEach(r => { existingMap.set(r.roomStr, r); });

    incomingRooms.forEach(incoming => {
      const existing = existingMap.get(incoming.roomStr);
      
      if (existing) {
        if (existing.status === 'out') {
          mergedRooms.push({
            ...incoming,
            status: 'due',
            pendingExtension: false,
            pendingExtensionNights: 0,
            noAnswer: false,
            noAnswerCount: 0,
            lastAttemptAt: '',
            lateTime: '',
            extensionNights: 0,
            note: existing.note || '',
            checkoutAt: '',
          });
        } else {
          mergedRooms.push({
            ...incoming,
            status: existing.status,
            pendingExtension: existing.pendingExtension || false,
            pendingExtensionNights: existing.pendingExtensionNights || 0,
            noAnswer: existing.noAnswer || false,
            noAnswerCount: existing.noAnswerCount || 0,
            lastAttemptAt: existing.lastAttemptAt || '',
            lateTime: existing.lateTime || '',
            extensionNights: existing.extensionNights || 0,
            note: existing.note || '',
            checkoutAt: existing.checkoutAt || '',
          });
        }
      } else {
        mergedRooms.push({
          ...incoming,
          status: 'due',
          pendingExtension: false,
          pendingExtensionNights: 0,
          noAnswer: false,
          noAnswerCount: 0,
          lastAttemptAt: '',
          lateTime: '',
          extensionNights: 0,
          note: '',
          checkoutAt: '',
        });
      }
    });

    removedRooms = depRooms.filter(r => 
      !incomingRooms.some(incoming => incoming.roomStr === r.roomStr) && 
      r.status !== 'out'
    );

    removedRooms.forEach(r => {
      const rIdx = depRooms.indexOf(r);
      if (rIdx >= 0 && r.status !== 'out') {
        depLog.unshift({ 
          room: r.roomStr, 
          name: r.name, 
          action: 'auto_out', 
          time: logTime, 
          roomIdx: rIdx, 
          prevStatus: r.status 
        });
      }
    });

    depRooms = mergedRooms;
  } else {
    depRooms = incomingRooms.map(r => ({
      ...r,
      status: 'due',
      pendingExtension: false,
      pendingExtensionNights: 0,
      noAnswer: false,
      noAnswerCount: 0,
      lastAttemptAt: '',
      lateTime: '',
      extensionNights: 0,
      note: '',
      checkoutAt: '',
    }));
    removedRooms = [];
  }

  depRooms.sort((a, b) => a.room - b.room);
  depLog = depLog.filter(log => depRooms.some(r => r.roomStr === log.room));

  document.getElementById('depDateLabel').textContent = `${depRooms.length} rooms departing · ${depRooms[0]?.departure || ''}`;
  document.getElementById('depBoard').style.display    = 'block';
  document.getElementById('depUploadCard').style.display = 'none';
  ['depPrintBtn','depExportBtn','depViewToggle','depReloadBtn'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = ''; });

  depRender();
  updateDepBadge();
  saveDepartures(depRooms, depLog).then(() => {
    const removedCount = removedRooms.length;
    if (removedCount > 0) showToast(`Report loaded: ${depRooms.length} rooms, ${removedCount} auto-checked out ✓`);
    else showToast(`Report loaded: ${depRooms.length} rooms saved to Firebase ✓`);
  });
}

function reloadDepReport() {
  const uploadCard = document.getElementById('depUploadCard');
  
  if (uploadCard.style.display === 'none') {
    uploadCard.style.display = 'block';
    uploadCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('depInput').value = '';
    
    const loadBtn = uploadCard.querySelector('.btn.gold');
    if (loadBtn) {
      const originalText = loadBtn.textContent;
      loadBtn.textContent = '🔄 Reload with New Report';
      loadBtn.style.background = 'linear-gradient(135deg, var(--violet), var(--sky))';
      
      loadBtn._originalClick = loadBtn.onclick;
      loadBtn.onclick = () => {
        const raw = document.getElementById('depInput').value.trim();
        if (raw) {
          processDep(true);
        } else {
          showToast('Please paste new report data first', 'err');
        }
        loadBtn.textContent = originalText;
        loadBtn.style.background = '';
        loadBtn.onclick = loadBtn._originalClick;
        uploadCard.style.display = 'none';
      };
    }
  }
}

function depCounts() {
  return {
    all:      depRooms.length,
    due:      depRooms.filter(r => r.status === 'due' && !r.noAnswer && !r.pendingExtension).length,
    pendingExt: depRooms.filter(r => r.pendingExtension === true && r.status !== 'out' && r.status !== 'extended').length,
    noAnswer: depRooms.filter(r => r.noAnswer === true && r.status !== 'out').length,
    extended: depRooms.filter(r => r.status === 'extended').length,
    late:     depRooms.filter(r => r.status === 'late').length,
    balance:  depRooms.filter(r => r.balance > 0 && r.status !== 'out').length,
    out:      depRooms.filter(r => r.status === 'out').length,
  };
}

function depRender() {
  const sc    = depCounts();
  const total = sc.all, out = sc.out;
  const pct   = total ? Math.round(out / total * 100) : 0;

  Object.entries(sc).forEach(([k, v]) => { 
    const el = document.getElementById('dfc-' + k); 
    if (el) el.textContent = v; 
  });

  document.getElementById('depKpis').innerHTML = `
    <div class="dep-kpi k-total"><div class="dep-kpi-icon">🏨</div><div class="dep-kpi-val">${total}</div><div class="dep-kpi-label">Total</div><div class="dep-kpi-bar"></div></div>
    <div class="dep-kpi k-due"><div class="dep-kpi-icon">⏳</div><div class="dep-kpi-val">${sc.due}</div><div class="dep-kpi-label">Due Out</div><div class="dep-kpi-bar"></div></div>
    <div class="dep-kpi k-pending" style="border-color:rgba(139,124,248,0.4);"><div class="dep-kpi-icon">⏰❓</div><div class="dep-kpi-val" style="color:var(--violet);">${sc.pendingExt}</div><div class="dep-kpi-label">Pending Ext</div><div class="dep-kpi-bar" style="background:linear-gradient(90deg, transparent, var(--violet), transparent);"></div></div>
    <div class="dep-kpi k-noanswer" style="border-color:rgba(240,164,58,0.4);"><div class="dep-kpi-icon">📞❌</div><div class="dep-kpi-val" style="color:var(--amber);">${sc.noAnswer}</div><div class="dep-kpi-label">No Answer</div><div class="dep-kpi-bar" style="background:linear-gradient(90deg, transparent, var(--amber), transparent);"></div></div>
    <div class="dep-kpi k-ext"><div class="dep-kpi-icon">↪</div><div class="dep-kpi-val">${sc.extended}</div><div class="dep-kpi-label">Extended</div><div class="dep-kpi-bar"></div></div>
    <div class="dep-kpi k-late"><div class="dep-kpi-icon">🕐</div><div class="dep-kpi-val">${sc.late}</div><div class="dep-kpi-label">Late CO</div><div class="dep-kpi-bar"></div></div>
    <div class="dep-kpi k-out"><div class="dep-kpi-icon">✓</div><div class="dep-kpi-val">${out}</div><div class="dep-kpi-label">Checked Out</div><div class="dep-kpi-bar"></div></div>`;

  document.getElementById('depProgLabel').textContent = `${out} of ${total} checked out`;
  document.getElementById('depProgPct').textContent   = pct + '%';
  document.getElementById('depProgFill').style.width  = pct + '%';

  const search = (document.getElementById('depSearch')?.value || '').toLowerCase();
  let filtered = depRooms.filter(r => {
    let mf = true;
    if      (depFilter_ === 'all')     mf = r.status !== 'out' && r.status !== 'extended';
    else if (depFilter_ === 'balance') mf = r.balance > 0 && r.status !== 'out';
    else if (depFilter_ === 'noanswer') mf = r.noAnswer === true && r.status !== 'out';
    else if (depFilter_ === 'pending') mf = r.pendingExtension === true && r.status !== 'out' && r.status !== 'extended';
    else                               mf = r.status === depFilter_;
    const ms = !search || r.roomStr.includes(search) || r.name.toLowerCase().includes(search) || r.source.toLowerCase().includes(search);
    return mf && ms;
  });

  const grid = document.getElementById('depGrid');
  grid.innerHTML = filtered.map(r => depCardHTML(r)).join('');
  makeDepCardsDraggable();
  renderDepLog();

  const qb = document.getElementById('depQuickBar');
  if (sc.due > 3) { qb.style.display = 'flex'; document.getElementById('depQuickLabel').textContent = `${sc.due} rooms still due out`; }
  else qb.style.display = 'none';
}

function depCardHTML(r) {
  const i        = depRooms.indexOf(r);
  const bal      = r.balance;
  const balClass = bal > 0 ? 'bal-owing' : bal < 0 ? 'bal-credit' : 'bal-zero';
  const balText  = bal === 0 ? '✓ Settled'
    : bal > 0 ? `AED ${Math.abs(bal).toLocaleString('en',{minimumFractionDigits:2})} OWING`
    :           `AED ${Math.abs(bal).toLocaleString('en',{minimumFractionDigits:2})} CREDIT`;
  
  let sClass = 's-' + (r.balance > 0 && r.status !== 'out' ? 'balance' : r.status);
  if (r.pendingExtension && r.status !== 'out' && r.status !== 'extended') sClass += ' s-pending';
  if (r.noAnswer && r.status !== 'out') sClass += ' s-noanswer';
  
  let badgeCls = r.status==='due'?'sb-due':r.status==='extended'?'sb-extended':r.status==='late'?'sb-late':'sb-out';
  let badgeText = r.status==='due'?'DUE OUT':r.status==='extended'?`EXT +${r.extensionNights}N`:r.status==='late'?`LATE${r.lateTime?' · '+r.lateTime:''}`:'CHECKED OUT';
  
  if (r.pendingExtension && r.status !== 'out' && r.status !== 'extended') {
    badgeCls = 'sb-pending';
    badgeText = `PENDING EXT${r.pendingExtensionNights ? ` (+${r.pendingExtensionNights})` : ''}`;
  } else if (r.noAnswer && r.status !== 'out') {
    badgeCls = 'sb-noanswer';
    badgeText = `NO ANSWER${r.noAnswerCount > 0 ? ` (${r.noAnswerCount}x)` : ''}`;
  }
  
  const srcClean  = r.source.substring(0, 26) + (r.source.length > 26 ? '…' : '');
  const vipHTML   = r.isVip ? '<div class="dc-vip">⭐ VIP</div>' : '';
  const depTag    = r.depTime ? `<div class="dc-mi">🕐 Sched: <strong>${r.depTime}</strong></div>` : '';
  const compTag   = r.company ? `<div class="dc-company">🏢 ${r.company.substring(0, 36)}</div>` : '';
  const noAnswerTag = r.lastAttemptAt ? `<div class="dc-mi">📞 Last attempt: <strong>${r.lastAttemptAt}</strong></div>` : '';
  const pendingTag = r.pendingExtension && !r.pendingExtensionNights ? `<div class="dc-mi">⏰ Guest said: <strong>Will call back about extension</strong></div>` : '';

  const lateHTML = r.status === 'late' ? `
    <div class="dc-sel-row">
      <span class="dc-sel-lbl late">🕐 Late time:</span>
      <select class="dc-select late" onchange="depRooms[${i}].lateTime=this.value;depRooms[${i}].noAnswer=false;depRender();saveDeps()">
        <option value="">Select…</option>
        ${['10:00 AM','11:00 AM','12:00 PM','1:00 PM','2:00 PM','3:00 PM','4:00 PM','5:00 PM','6:00 PM','7:00 PM','8:00 PM','9:00 PM','10:00 PM','11:00 PM','12:00 AM']
          .map(t => `<option${r.lateTime===t?' selected':''}>${t}</option>`).join('')}
      </select>
    </div>` : '';

  const extensionHTML = (r.status === 'due' && !r.pendingExtension) || r.status === 'extended' ? `
    <div class="dc-sel-row">
      <span class="dc-sel-lbl ext">↪ ${r.status === 'extended' ? 'Confirmed Extra nights:' : 'Pending nights (if confirm):'}</span>
      <select class="dc-select ext" onchange="depUpdateExtension(${i}, this.value)">
        <option value="0">-- Select --</option>
        ${[1,2,3,4,5,6,7,8,9,10,14,21].map(n => `<option value="${n}"${(r.status === 'extended' ? r.extensionNights === n : r.pendingExtensionNights === n) ? ' selected' : ''}>${n} night${n>1?'s':''}</option>`).join('')}
      </select>
    </div>
  ` : '';

  const pendingActionHTML = (r.status === 'due' && !r.noAnswer) ? `
    <div class="dc-actions" style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:8px;">
      <button class="dca dca-pending" onclick="depMarkPending(${i})">
        ⏰❓ ${r.pendingExtension ? 'Clear Pending' : 'Mark as Pending Extension'}
      </button>
      <button class="dca dca-confirm-ext" onclick="depConfirmExtension(${i})">
        ✅ Confirm Extension
      </button>
    </div>
  ` : '';

  const noAnswerHTML = (r.status === 'due' && !r.pendingExtension) || r.noAnswer ? `
    <div class="dc-actions" style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:8px;">
      <button class="dca dca-noanswer" onclick="depMarkNoAnswer(${i})">
        📞❌ ${r.noAnswer ? 'Mark as Answered' : 'No Answer'}
      </button>
      <button class="dca dca-callback" onclick="depScheduleCallback(${i})">
        ⏰ Schedule Callback
      </button>
    </div>
  ` : '';

  const actHTML = r.status !== 'out'
    ? `<div class="dc-actions g3">
         <button class="dca dca-co"   onclick="depAction(${i},'out')">✓ Check Out</button>
         <button class="dca dca-ext"  onclick="depAction(${i},'extended')">↪ Extend (Confirmed)</button>
         <button class="dca dca-late" onclick="depAction(${i},'late')">🕐 Late CO</button>
       </div>`
    : `<div class="dc-actions g1"><button class="dca dca-undo" onclick="depAction(${i},'due')">↺ Undo</button></div>`;

  return `<div class="dep-card ${sClass}" draggable="true">
    ${vipHTML}
    <div class="dc-band"></div>
    <div class="dc-head">
      <div class="dc-room">${r.roomStr}</div>
      <div class="dc-badges">
        <div class="dc-sbadge ${badgeCls}">${badgeText}</div>
        <div class="dc-nights">🌙 ${r.nights}n</div>
      </div>
    </div>
    <div class="dc-body">
      <div class="dc-name-row">
        <div class="dc-name" ondblclick="depEditName(${i})" title="Double-click to edit">${escapeHtml(r.name)}</div>
      </div>
      <div class="dc-meta">
        <div class="dc-mi">📅 <strong>${r.arrival}</strong> → <strong>${r.departure}</strong></div>
        ${depTag}
        ${noAnswerTag}
        ${pendingTag}
      </div>
      ${compTag}
      <div class="dc-src">${escapeHtml(srcClean)}</div>
      <div class="dc-bal ${balClass}">
        <span class="dc-bal-lbl">Balance</span>
        <span class="dc-bal-amt">${balText}</span>
      </div>
      ${lateHTML}
      ${extensionHTML}
      ${pendingActionHTML}
      ${noAnswerHTML}
      ${actHTML}
      <div style="margin-top:7px;">
        <div class="dc-note-lbl">Notes</div>
        <textarea class="dc-note" placeholder="Guest notes, extension details, callback info…"
          onchange="depRooms[${i}].note=this.value;saveDeps()">${escapeHtml(r.note)}</textarea>
      </div>
    </div>
  </div>`;
}

// New function: Mark Pending Extension
function depMarkPending(i) {
  const r = depRooms[i];
  const t = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  
  if (r.pendingExtension) {
    // Clear pending extension
    r.pendingExtension = false;
    r.pendingExtensionNights = 0;
    showToast(`${r.roomStr} - Pending extension cleared`, 'info');
    depLog.unshift({ 
      room: r.roomStr, 
      name: r.name, 
      action: 'pending_cleared', 
      time: t, 
      roomIdx: i 
    });
  } else {
    // Mark as pending extension
    r.pendingExtension = true;
    showToast(`${r.roomStr} - Marked as pending extension (guest will confirm)`, 'info');
    depLog.unshift({ 
      room: r.roomStr, 
      name: r.name, 
      action: 'pending_extension', 
      time: t, 
      roomIdx: i 
    });
  }
  
  depRender();
  updateDepBadge();
  saveDeps();
}

// New function: Confirm Extension (convert pending to confirmed)
function depConfirmExtension(i) {
  const r = depRooms[i];
  const t = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  const nights = r.pendingExtensionNights || 1;
  
  if (confirm(`Confirm extension for ${r.roomStr} - ${r.name} for ${nights} night(s)?`)) {
    r.status = 'extended';
    r.extensionNights = nights;
    r.pendingExtension = false;
    r.pendingExtensionNights = 0;
    
    showToast(`${r.roomStr} - Extension confirmed for +${nights} night(s) ✓`, 'ok');
    depLog.unshift({ 
      room: r.roomStr, 
      name: r.name, 
      action: 'extension_confirmed', 
      time: t, 
      roomIdx: i,
      nights: nights
    });
    
    depRender();
    updateDepBadge();
    saveDeps();
  }
}

// Update extension nights (for both pending and confirmed)
function depUpdateExtension(i, value) {
  const r = depRooms[i];
  const nights = parseInt(value) || 0;
  
  if (r.status === 'extended') {
    r.extensionNights = nights;
    if (nights > 0) {
      showToast(`${r.roomStr} - Extension updated to +${nights} night(s)`, 'ok');
    }
  } else if (r.pendingExtension) {
    r.pendingExtensionNights = nights;
    if (nights > 0) {
      showToast(`${r.roomStr} - Pending extension set to +${nights} night(s)`, 'info');
    }
  }
  
  depRender();
  saveDeps();
}

// Mark No Answer function
function depMarkNoAnswer(i) {
  const r = depRooms[i];
  const t = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  
  if (r.noAnswer) {
    r.noAnswer = false;
    r.status = 'due';
    showToast(`${r.roomStr} - Guest marked as answered`, 'ok');
    depLog.unshift({ 
      room: r.roomStr, 
      name: r.name, 
      action: 'answered', 
      time: t, 
      roomIdx: i, 
      prevStatus: 'noanswer' 
    });
  } else {
    r.noAnswer = true;
    r.noAnswerCount = (r.noAnswerCount || 0) + 1;
    r.lastAttemptAt = t;
    r.status = 'due';
    
    showToast(`${r.roomStr} - ${r.name} · No answer (attempt ${r.noAnswerCount})`, 'info');
    depLog.unshift({ 
      room: r.roomStr, 
      name: r.name, 
      action: 'noanswer', 
      time: t, 
      roomIdx: i, 
      prevStatus: 'due',
      attemptCount: r.noAnswerCount 
    });
  }
  
  depRender();
  updateDepBadge();
  saveDeps();
}

// Schedule Callback function
function depScheduleCallback(i) {
  const r = depRooms[i];
  const callbackTime = prompt(`Schedule callback for room ${r.roomStr} - ${r.name}:\nEnter time (e.g., 14:30 or 2:30 PM)`, "30 min");
  
  if (callbackTime && callbackTime.trim()) {
    const scheduled = callbackTime.trim();
    r.callbackScheduled = scheduled;
    r.note = (r.note ? r.note + '\n' : '') + `📞 Callback scheduled: ${scheduled}`;
    
    showToast(`${r.roomStr} - Callback scheduled for ${scheduled}`, 'ok');
    depLog.unshift({ 
      room: r.roomStr, 
      name: r.name, 
      action: 'callback_scheduled', 
      time: new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }),
      roomIdx: i,
      scheduled: scheduled
    });
    
    depRender();
    saveDeps();
  }
}

// Drag and drop for departure cards
let draggedCard = null;

function makeDepCardsDraggable() {
  const cards = document.querySelectorAll('.dep-card');
  cards.forEach((card, idx) => {
    card.setAttribute('draggable', 'true');
    card.setAttribute('data-card-idx', idx);
    
    card.removeEventListener('dragstart', handleDragStart);
    card.removeEventListener('dragend', handleDragEnd);
    card.removeEventListener('dragover', handleDragOver);
    card.removeEventListener('drop', handleDrop);
    
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);
    card.addEventListener('dragover', handleDragOver);
    card.addEventListener('drop', handleDrop);
  });
}

function handleDragStart(e) {
  draggedCard = this;
  e.dataTransfer.effectAllowed = 'move';
  this.style.opacity = '0.5';
}

function handleDragEnd(e) {
  if (draggedCard) draggedCard.style.opacity = '';
  draggedCard = null;
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function handleDrop(e) {
  e.preventDefault();
  if (!draggedCard || draggedCard === this) return;
  
  const grid = document.getElementById('depGrid');
  const cards = Array.from(grid.children);
  const fromIdx = cards.indexOf(draggedCard);
  const toIdx = cards.indexOf(this);
  
  if (fromIdx < 0 || toIdx < 0) return;
  
  const search = (document.getElementById('depSearch')?.value || '').toLowerCase();
  let filtered = depRooms.filter(r => {
    let mf = true;
    if      (depFilter_ === 'all')     mf = r.status !== 'out' && r.status !== 'extended';
    else if (depFilter_ === 'balance') mf = r.balance > 0 && r.status !== 'out';
    else if (depFilter_ === 'noanswer') mf = r.noAnswer === true && r.status !== 'out';
    else if (depFilter_ === 'pending') mf = r.pendingExtension === true && r.status !== 'out' && r.status !== 'extended';
    else                               mf = r.status === depFilter_;
    const ms = !search || r.roomStr.includes(search) || r.name.toLowerCase().includes(search) || r.source.toLowerCase().includes(search);
    return mf && ms;
  });
  
  const fromRoom = filtered[fromIdx];
  const toRoom = filtered[toIdx];
  
  if (fromRoom && toRoom) {
    const fromGlobalIdx = depRooms.indexOf(fromRoom);
    const toGlobalIdx = depRooms.indexOf(toRoom);
    if (fromGlobalIdx >= 0 && toGlobalIdx >= 0) {
      [depRooms[fromGlobalIdx], depRooms[toGlobalIdx]] = [depRooms[toGlobalIdx], depRooms[fromGlobalIdx]];
      saveDeps();
    }
  }
  
  draggedCard.style.opacity = '';
  draggedCard = null;
  depRender();
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

function depEditName(i) {
  const allNames = document.querySelectorAll('.dc-name');
  const visibleRooms = depRooms.filter(r => {
    if (depFilter_ === 'all')     return r.status !== 'out' && r.status !== 'extended';
    if (depFilter_ === 'balance') return r.balance > 0 && r.status !== 'out';
    if (depFilter_ === 'noanswer') return r.noAnswer === true && r.status !== 'out';
    if (depFilter_ === 'pending') return r.pendingExtension === true && r.status !== 'out' && r.status !== 'extended';
    return r.status === depFilter_;
  });
  const vi = visibleRooms.indexOf(depRooms[i]);
  const el = allNames[vi];
  if (!el) return;
  const cur = depRooms[i].name;
  el.outerHTML = `<input class="dc-edit-name" id="en-${i}" value="${escapeHtml(cur)}"
    onblur="depSaveName(${i},this.value)"
    onkeydown="if(event.key==='Enter')this.blur()"/>`;
  const inp = document.getElementById('en-' + i);
  if (inp) inp.focus();
}

function depSaveName(i, val) {
  depRooms[i].name = (val || '').trim() || depRooms[i].name;
  depRender(); saveDeps();
}

function depAction(i, status) {
  const r = depRooms[i];
  const prev = r.status;
  r.status = status;
  const t = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  
  // Clear flags when taking action
  r.noAnswer = false;
  r.pendingExtension = false;
  
  if (status === 'out') r.checkoutAt = t; else r.checkoutAt = '';
  if (status !== 'late') r.lateTime = '';
  if (status !== 'extended') {
    r.extensionNights = 0;
    r.pendingExtensionNights = 0;
  }
  if (status !== 'due') {
    depLog.unshift({ room:r.roomStr, name:r.name, action:status, time:t, roomIdx:i, prevStatus:prev });
  } else {
    const li = depLog.findIndex(l => l.room === r.roomStr);
    if (li >= 0) depLog.splice(li, 1);
  }
  depRender(); updateDepBadge(); saveDeps();
}

function saveDeps() {
  saveDepartures(depRooms, depLog);
}

function renderDepLog() {
  const wrap  = document.getElementById('depLogWrap');
  const body  = document.getElementById('depLogBody');
  const badge = document.getElementById('depLogCount');
  const entries = depLog.filter(l => l.action !== 'due' && l.action !== 'auto_out');
  if (!entries.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  if (badge) badge.textContent = entries.length;
  const aLabel = { 
    out:'✓ Checked Out', 
    auto_out:'✓ Auto Checked Out', 
    extended:'↪ Extended', 
    late:'🕐 Late CO',
    noanswer:'📞❌ No Answer',
    answered:'📞✓ Answered',
    callback_scheduled:'⏰ Callback Scheduled',
    pending_extension:'⏰❓ Pending Extension',
    pending_cleared:'↪ Pending Cleared',
    extension_confirmed:'✅ Extension Confirmed'
  };
  const aCls   = { 
    out:'log-act-co', 
    auto_out:'log-act-co', 
    extended:'log-act-ext', 
    late:'log-act-late',
    noanswer:'log-act-noanswer',
    answered:'log-act-answered',
    callback_scheduled:'log-act-callback',
    pending_extension:'log-act-pending',
    pending_cleared:'log-act-pending',
    extension_confirmed:'log-act-confirm'
  };
  body.innerHTML = entries.map((l, li) => `
    <div class="log-row">
      <span class="log-room">${l.room}</span>
      <span class="log-name">${escapeHtml(l.name)}</span>
      <span class="log-action ${aCls[l.action]||''}">${aLabel[l.action]||l.action}${l.attemptCount ? ` (x${l.attemptCount})` : ''}${l.scheduled ? ` at ${l.scheduled}` : ''}${l.nights ? ` +${l.nights}n` : ''}</span>
      <span class="log-time">${l.time}</span>
      <button class="log-undo" onclick="depUndoLog(${li})">↺ Undo</button>
    </div>
  `).join('');
}

function depUndoLog(li) {
  const entry = depLog[li]; if (!entry) return;
  const r = depRooms[entry.roomIdx];
  if (r) { 
    r.status = entry.prevStatus || 'due'; 
    r.checkoutAt = ''; 
    r.lateTime = ''; 
    r.extensionNights = 0;
    r.pendingExtension = false;
    r.pendingExtensionNights = 0;
    if (entry.action === 'noanswer') {
      r.noAnswer = false;
      r.noAnswerCount = (r.noAnswerCount || 1) - 1;
    }
    if (entry.action === 'pending_extension') {
      r.pendingExtension = false;
    }
    if (entry.action === 'extension_confirmed') {
      r.status = 'due';
      r.extensionNights = 0;
    }
  }
  depLog.splice(li, 1);
  depRender(); updateDepBadge(); saveDeps();
}

function toggleLog() {
  const body = document.getElementById('depLogBody');
  const icon = document.getElementById('depLogToggleIcon');
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (icon) icon.textContent = open ? '▸ expand' : '▾ collapse';
}

function clearDepSearch() {
  const searchInput = document.getElementById('depSearch');
  if (searchInput) {
    searchInput.value = '';
    depRender();
  }
}

function depFilter(f, el) {
  depFilter_ = f;
  document.querySelectorAll('[data-f]').forEach(c => c.classList.remove('on','due','ext','late','bal','out','noanswer','pending'));
  const btn = el || document.querySelector(`[data-f="${f}"]`);
  if (btn) {
    btn.classList.add('on');
    const map = { due:'due', extended:'ext', late:'late', balance:'bal', out:'out', noanswer:'noanswer', pending:'pending' };
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
  const due = depRooms.filter(r => (r.status === 'due' || r.status === 'late') && !r.noAnswer && !r.pendingExtension).length;
  const el  = document.getElementById('badge-departures');
  if (el) el.textContent = due || depRooms.length || '0';
}

function depBulkCheckout() {
  if (!confirm('Mark ALL due-out rooms as checked out? (Pending extensions will be skipped)')) return;
  const t = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  depRooms.filter(r => r.status === 'due' && !r.noAnswer && !r.pendingExtension).forEach(r => {
    const i = depRooms.indexOf(r);
    r.status = 'out'; r.checkoutAt = t;
    r.noAnswer = false;
    depLog.unshift({ room:r.roomStr, name:r.name, action:'out', time:t, roomIdx:i, prevStatus:'due' });
  });
  depRender(); updateDepBadge(); saveDeps();
}

function clearDep() {
  depRooms = []; depFilter_ = 'all'; depLog = [];
  document.getElementById('depBoard').style.display      = 'none';
  document.getElementById('depUploadCard').style.display = 'block';
  document.getElementById('depInput').value              = '';
  document.getElementById('depDateLabel').textContent    = "Today's departures · Load Opera report to begin";
  const b = document.getElementById('badge-departures'); if (b) b.textContent = '0';
  ['depPrintBtn','depExportBtn','depViewToggle','depReloadBtn'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  saveDeps();
}

function exportDepSummary() {
  if (!depRooms.length) return;
  const wb   = XLSX.utils.book_new();
  const data = [['Room','Guest','Arrival','Departure','Nights','Balance AED','Source','Company','Status','Pending Ext','Pending Nights','No Answer','Attempts','Last Attempt','Late Time','Ext Nights','Checkout','Notes']];
  depRooms.forEach(r => data.push([
    r.roomStr, r.name, r.arrival, r.departure, r.nights, r.balance, r.source, r.company, 
    r.status.toUpperCase(),
    r.pendingExtension ? 'YES' : 'NO',
    r.pendingExtensionNights || 0,
    r.noAnswer ? 'YES' : 'NO',
    r.noAnswerCount || 0,
    r.lastAttemptAt || '',
    r.lateTime,
    r.extensionNights||'',
    r.checkoutAt,
    r.note
  ]));
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [8,24,12,12,7,12,20,22,12,8,8,8,8,12,10,8,10,30].map(w => ({wch:w}));
  XLSX.utils.book_append_sheet(wb, ws, 'Departures');
  XLSX.writeFile(wb, 'Departures_' + new Date().toISOString().split('T')[0] + '.xlsx');
}

function depPrintList() { window.print(); }

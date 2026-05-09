// ═══════════════════════════════════════════════════════════
// departures.js — Departure follow-up board (FULL FIXED)
// ═══════════════════════════════════════════════════════════

let depRooms = [];
let depLog = [];
let depFilter_ = 'all';
let depSize = 'md';

// ====================== MAIN PROCESS ======================
function processDep() {
  const raw = document.getElementById('depInput').value.trim();
  const errBox = document.getElementById('depError');
  errBox.classList.remove('show');

  const showErr = msg => {
    document.getElementById('depErrorMsg').textContent = msg;
    errBox.classList.add('show');
  };

  if (!raw) return showErr('Please paste the departure report first.');

  const lines = raw.split('\n').filter(l => l.trim());
  if (lines.length < 2) return showErr('File appears empty.');

  const hdrs = lines[0].split('\t').map(h => h.trim());
  const idx = {}; 
  hdrs.forEach((h, i) => idx[h] = i);

  if (idx['ROOM'] === undefined) return showErr('ROOM column not found. Use Delimited Data format.');

  depRooms = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split('\t'); 
    if (p.length < 15) continue;
    const room = (p[idx['ROOM']] || '').trim(); 
    if (!room || isNaN(parseInt(room))) continue;

    const bal = parseFloat((p[idx['BALANCE']] || '0').replace(/,/g, '')) || 0;
    const agent = (p[idx['TRAVEL_AGENT_NAME']] || '').trim();
    const src = typeof cleanSource === 'function' 
      ? cleanSource(agent, (p[idx['COMPANY_NAME']] || '').trim(), (p[idx['SOURCE_NAME']] || '').trim()) 
      : 'Walk-in';

    depRooms.push({
      room: parseInt(room), 
      roomStr: room,
      name: typeof parseName === 'function' ? parseName(p[idx['GUEST_NAME']] || '') : (p[idx['GUEST_NAME']] || ''),
      arrival: (p[idx['ARRIVAL']] || '').trim(),
      departure: (p[idx['DEPARTURE']] || '').trim(),
      nights: parseInt(p[idx['NIGHTS']] || 0) || 0,
      balance: bal,
      source: src,
      company: (p[idx['COMPANY_NAME']] || '').trim(),
      rateCode: (p[idx['RATE_CODE']] || '').trim(),
      isVip: !!(p[idx['VIP']] || '').trim(),
      depTime: (p[idx['DEPARTURE_TIME']] || '').trim(),
      status: 'due', 
      lateTime: '', 
      extensionNights: 0, 
      note: '', 
      checkoutAt: '',
    });
  }

  if (!depRooms.length) return showErr('No departure rooms found.');

  depRooms.sort((a, b) => a.room - b.room);

  document.getElementById('depDateLabel').textContent = `${depRooms.length} rooms departing · ${depRooms[0]?.departure || ''}`;
  document.getElementById('depBoard').style.display = 'block';
  document.getElementById('depUploadCard').style.display = 'none';

  ['depPrintBtn','depExportBtn','depViewToggle'].forEach(id => { 
    const el = document.getElementById(id); 
    if (el) el.style.display = ''; 
  });

  depRender();
  updateDepBadge();
  saveDepartures(depRooms, depLog).then(() => showToast('Departure board saved to Firebase ✓'));
}

function depCounts() {
  return {
    all: depRooms.length,
    due: depRooms.filter(r => r.status === 'due').length,
    extended: depRooms.filter(r => r.status === 'extended').length,
    late: depRooms.filter(r => r.status === 'late').length,
    balance: depRooms.filter(r => r.balance > 0 && r.status !== 'out').length,
    out: depRooms.filter(r => r.status === 'out').length,
  };
}

function depRender() {
  const sc = depCounts();
  const total = sc.all, out = sc.out;
  const pct = total ? Math.round(out / total * 100) : 0;

  Object.entries(sc).forEach(([k, v]) => { 
    const el = document.getElementById('dfc-' + k); 
    if (el) el.textContent = v; 
  });

  document.getElementById('depKpis').innerHTML = `
    <div class="dep-kpi k-total"><div class="dep-kpi-icon">🏨</div><div class="dep-kpi-val">${total}</div><div class="dep-kpi-label">Total</div><div class="dep-kpi-bar"></div></div>
    <div class="dep-kpi k-due"><div class="dep-kpi-icon">⏳</div><div class="dep-kpi-val">${sc.due}</div><div class="dep-kpi-label">Due Out</div><div class="dep-kpi-bar"></div></div>
    <div class="dep-kpi k-ext"><div class="dep-kpi-icon">↪</div><div class="dep-kpi-val">${sc.extended}</div><div class="dep-kpi-label">Extended</div><div class="dep-kpi-bar"></div></div>
    <div class="dep-kpi k-late"><div class="dep-kpi-icon">🕐</div><div class="dep-kpi-val">${sc.late}</div><div class="dep-kpi-label">Late CO</div><div class="dep-kpi-bar"></div></div>
    <div class="dep-kpi k-out"><div class="dep-kpi-icon">✓</div><div class="dep-kpi-val">${out}</div><div class="dep-kpi-label">Checked Out</div><div class="dep-kpi-bar"></div></div>`;

  document.getElementById('depProgLabel').textContent = `${out} of ${total} checked out`;
  document.getElementById('depProgPct').textContent = pct + '%';
  document.getElementById('depProgFill').style.width = pct + '%';

  const search = (document.getElementById('depSearch')?.value || '').toLowerCase();
  let filtered = depRooms.filter(r => {
    let mf = true;
    if (depFilter_ === 'all') mf = r.status !== 'out' && r.status !== 'extended';
    else if (depFilter_ === 'balance') mf = r.balance > 0 && r.status !== 'out';
    else mf = r.status === depFilter_;
    const ms = !search || r.roomStr.includes(search) || r.name.toLowerCase().includes(search) || r.source.toLowerCase().includes(search);
    return mf && ms;
  });

  document.getElementById('depGrid').innerHTML = filtered.map(r => depCardHTML(r)).join('');
  renderDepLog();

  const qb = document.getElementById('depQuickBar');
  if (sc.due > 3) { 
    qb.style.display = 'flex'; 
    document.getElementById('depQuickLabel').textContent = `${sc.due} rooms still due out`; 
  } else qb.style.display = 'none';
}

function depCardHTML(r) {
  const i = depRooms.indexOf(r);
  const bal = r.balance;
  const balClass = bal > 0 ? 'bal-owing' : bal < 0 ? 'bal-credit' : 'bal-zero';
  const balText = bal === 0 ? '✓ Settled'
    : bal > 0 ? `AED ${Math.abs(bal).toLocaleString('en',{minimumFractionDigits:2})} OWING`
    : `AED ${Math.abs(bal).toLocaleString('en',{minimumFractionDigits:2})} CREDIT`;
  const sClass = 's-' + (r.balance > 0 && r.status !== 'out' ? 'balance' : r.status);
  const badgeCls = r.status==='due'?'sb-due':r.status==='extended'?'sb-extended':r.status==='late'?'sb-late':'sb-out';
  const badgeText = r.status==='due'?'DUE OUT':r.status==='extended'?`EXT +${r.extensionNights}N`:r.status==='late'?`LATE${r.lateTime?' · '+r.lateTime:''}`:'CHECKED OUT';
  const srcClean = r.source.substring(0, 26) + (r.source.length > 26 ? '…' : '');
  const vipHTML = r.isVip ? '<div class="dc-vip">⭐ VIP</div>' : '';
  const depTag = r.depTime ? `<div class="dc-mi">🕐 Sched: <strong>${r.depTime}</strong></div>` : '';
  const compTag = r.company ? `<div class="dc-company">🏢 ${r.company.substring(0, 36)}</div>` : '';
  const lateHTML = r.status === 'late' ? `
    <div class="dc-sel-row">
      <span class="dc-sel-lbl late">🕐 Late time:</span>
      <select class="dc-select late" onchange="depRooms[${i}].lateTime=this.value;depRender();saveDeps()">
        <option value="">Select…</option>
        ${['10:00 AM','11:00 AM','12:00 PM','1:00 PM','2:00 PM','3:00 PM','4:00 PM','5:00 PM','6:00 PM','7:00 PM','8:00 PM','9:00 PM','10:00 PM','11:00 PM','12:00 AM']
          .map(t => `<option${r.lateTime===t?' selected':''}>${t}</option>`).join('')}
      </select>
    </div>` : r.status === 'extended' ? `
    <div class="dc-sel-row">
      <span class="dc-sel-lbl ext">↪ Extra nights:</span>
      <select class="dc-select ext" onchange="depRooms[${i}].extensionNights=parseInt(this.value)||0;depRender();saveDeps()">
        ${[1,2,3,4,5,6,7].map(n => `<option${r.extensionNights===n?' selected':''}>${n} night${n>1?'s':''}</option>`).join('')}
      </select>
    </div>` : '';
  const actHTML = r.status !== 'out'
    ? `<div class="dc-actions g3">
         <button class="dca dca-co" onclick="depAction(${i},'out')">✓ Check Out</button>
         <button class="dca dca-ext" onclick="depAction(${i},'extended')">↪ Extend</button>
         <button class="dca dca-late" onclick="depAction(${i},'late')">🕐 Late CO</button>
       </div>`
    : `<div class="dc-actions g1"><button class="dca dca-undo" onclick="depAction(${i},'due')">↺ Undo</button></div>`;
  return `<div class="dep-card ${sClass}">
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
        <div class="dc-name" ondblclick="depEditName(${i})" title="Double-click to edit">${r.name}</div>
      </div>
      <div class="dc-meta">
        <div class="dc-mi">📅 <strong>${r.arrival}</strong> → <strong>${r.departure}</strong></div>
        ${depTag}
      </div>
      ${compTag}
      <div class="dc-src">${srcClean}</div>
      <div class="dc-bal ${balClass}">
        <span class="dc-bal-lbl">Balance</span>
        <span class="dc-bal-amt">${balText}</span>
      </div>
      ${lateHTML}
      ${actHTML}
      <div style="margin-top:7px;">
        <div class="dc-note-lbl">Notes</div>
        <textarea class="dc-note" placeholder="Guest requests, luggage, complaints…"
          onchange="depRooms[${i}].note=this.value;saveDeps()">${r.note}</textarea>
      </div>
    </div>
  </div>`;
}

function depEditName(i) {
  const allNames = document.querySelectorAll('.dc-name');
  const visibleRooms = depRooms.filter(r => {
    if (depFilter_ === 'all') return r.status !== 'out' && r.status !== 'extended';
    if (depFilter_ === 'balance') return r.balance > 0 && r.status !== 'out';
    return r.status === depFilter_;
  });
  const vi = visibleRooms.indexOf(depRooms[i]);
  const el = allNames[vi];
  if (!el) return;
  const cur = depRooms[i].name;
  el.outerHTML = `<input class="dc-edit-name" id="en-${i}" value="${cur}"
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
  if (status === 'out') r.checkoutAt = t; else r.checkoutAt = '';
  if (status !== 'late') r.lateTime = '';
  if (status !== 'extended') r.extensionNights = 0;
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
  const wrap = document.getElementById('depLogWrap');
  const body = document.getElementById('depLogBody');
  const badge = document.getElementById('depLogCount');
  const entries = depLog.filter(l => l.action !== 'due');
  if (!entries.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  if (badge) badge.textContent = entries.length;
  const aLabel = { out:'✓ Checked Out', extended:'↪ Extended', late:'🕐 Late CO' };
  const aCls = { out:'log-act-co', extended:'log-act-ext', late:'log-act-late' };
  body.innerHTML = entries.map((l, li) => `
    <div class="log-row">
      <span class="log-room">${l.room}</span>
      <span class="log-name">${l.name}</span>
      <span class="log-action ${aCls[l.action]||''}">${aLabel[l.action]||l.action}</span>
      <span class="log-time">${l.time}</span>
      <button class="log-undo" onclick="depUndoLog(${li})">↺ Undo</button>
    </div>`).join('');
}

function depUndoLog(li) {
  const entry = depLog[li]; if (!entry) return;
  const r = depRooms[entry.roomIdx];
  if (r) { r.status = entry.prevStatus || 'due'; r.checkoutAt = ''; r.lateTime = ''; r.extensionNights = 0; }
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

function depFilter(f, el) {
  depFilter_ = f;
  document.querySelectorAll('[data-f]').forEach(c => c.classList.remove('on','due','ext','late','bal','out'));
  const btn = el || document.querySelector(`[data-f="${f}"]`);
  if (btn) {
    btn.classList.add('on');
    const map = { due:'due', extended:'ext', late:'late', balance:'bal', out:'out' };
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
  const due = depRooms.filter(r => r.status === 'due' || r.status === 'late').length;
  const el = document.getElementById('badge-departures');
  if (el) el.textContent = due || depRooms.length || '0';
}

function depBulkCheckout() {
  if (!confirm('Mark ALL due-out rooms as checked out?')) return;
  const t = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  depRooms.filter(r => r.status === 'due').forEach(r => {
    const i = depRooms.indexOf(r);
    r.status = 'out'; r.checkoutAt = t;
    depLog.unshift({ room:r.roomStr, name:r.name, action:'out', time:t, roomIdx:i, prevStatus:'due' });
  });
  depRender(); updateDepBadge(); saveDeps();
}

function clearDep() {
  depRooms = []; depFilter_ = 'all'; depLog = [];
  document.getElementById('depBoard').style.display = 'none';
  document.getElementById('depUploadCard').style.display = 'block';
  document.getElementById('depInput').value = '';
  document.getElementById('depDateLabel').textContent = "Today's departures · Load Opera report to begin";
  const b = document.getElementById('badge-departures'); if (b) b.textContent = '0';
  ['depPrintBtn','depExportBtn','depViewToggle'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  saveDeps();
}

function exportDepSummary() {
  if (!depRooms.length) return;
  const wb = XLSX.utils.book_new();
  const data = [['Room','Guest','Arrival','Departure','Nights','Balance AED','Source','Company','Status','Late Time','Ext Nights','Checkout','Notes']];
  depRooms.forEach(r => data.push([r.roomStr,r.name,r.arrival,r.departure,r.nights,r.balance,r.source,r.company,r.status.toUpperCase(),r.lateTime,r.extensionNights||'',r.checkoutAt,r.note]));
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [8,24,12,12,7,12,20,22,12,10,8,10,30].map(w => ({wch:w}));
  XLSX.utils.book_append_sheet(wb, ws, 'Departures');
  XLSX.writeFile(wb, 'Departures_' + new Date().toISOString().split('T')[0] + '.xlsx');
}

function depPrintList() { window.print(); }

// ====================== GLOBAL EXPORTS (MUST HAVE) ======================
window.processDep = processDep;
window.depRender = depRender;
window.depAction = depAction;
window.depFilter = depFilter;
window.setDepSize = setDepSize;
window.updateDepBadge = updateDepBadge;
window.depBulkCheckout = depBulkCheckout;
window.clearDep = clearDep;
window.exportDepSummary = exportDepSummary;
window.depPrintList = depPrintList;
window.depEditName = depEditName;
window.depSaveName = depSaveName;
window.depUndoLog = depUndoLog;
window.toggleLog = toggleLog;
window.saveDeps = saveDeps;

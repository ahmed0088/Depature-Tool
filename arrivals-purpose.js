// ═══════════════════════════════════════════════════════════
//  arrivals-purpose.js  —  Arrivals + Purpose of Stay + Guest modal + File loader
// ═══════════════════════════════════════════════════════════

// ── ARRIVALS ──────────────────────────────────────────────

// ── Shared log helper ─────────────────────────────────────
function addArrLog(action, detail) {
  const t = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  arrLog.unshift({ action, detail, time: t, ts: Date.now() });
  if (arrLog.length > 100) arrLog.pop();
  saveArrLog(arrLog);
  renderArrLog();
}

function renderArrLog() {
  const wrap  = document.getElementById('arrLogWrap');
  const body  = document.getElementById('arrLogBody');
  const badge = document.getElementById('arrLogCount');
  if (!wrap) return;
  if (!arrLog.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  if (badge) badge.textContent = arrLog.length;
  const icons = {
    'Loaded':'📥', 'Added':'➕', 'Removed':'✕', 'Purpose':'🔄',
    'Cleared':'🗑️', 'AI Nat':'✦', 'Exported':'📤', 'Synced':'🔁',
  };
  const cls = {
    'Loaded':'log-act-ext', 'Added':'log-act-co', 'Removed':'log-act-late',
    'Purpose':'log-act-ext', 'Cleared':'log-act-late', 'AI Nat':'log-act-co',
    'Exported':'log-act-ext', 'Synced':'log-act-co',
  };
  if (body) body.innerHTML = arrLog.map((l, li) => `
    <div class="log-row">
      <span class="log-action ${cls[l.action] || ''}">${icons[l.action] || '·'} ${l.action}</span>
      <span class="log-name">${escapeLogText(l.detail)}</span>
      <span class="log-time">${l.time}</span>
    </div>`).join('');
}

function toggleArrLog() {
  const body = document.getElementById('arrLogBody');
  const icon = document.getElementById('arrLogToggleIcon');
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (icon) icon.textContent = open ? '▸' : '▾';
}

function escapeLogText(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function arrKpiUpdate() {
  const t   = arrGuests.length;
  const l   = arrGuests.filter(g => g.purpose === 'Leisure').length;
  const b   = arrGuests.filter(g => g.purpose === 'Business').length;
  const avg = t ? Math.round(arrGuests.reduce((s, g) => s + Number(g.nights), 0) / t) : 0;
  ['ak-total','ak-leisure','ak-business','ak-nights'].forEach((id, i) => {
    const el = document.getElementById(id); if (el) el.textContent = [t,l,b,avg][i];
  });
  const badge = document.getElementById('badge-arrivals'); if (badge) badge.textContent = t || '0';
}

function arrRemoveGuest(i) {
  const g = arrGuests[i];
  arrGuests.splice(i, 1);
  arrRender(); saveArrivals(arrGuests);
  addArrLog('Removed', `${g.name} — Room ${g.room}`);
}

function arrChangePurpose(i, val) {
  const prev = arrGuests[i].purpose;
  arrGuests[i].purpose = val;
  arrRender(); saveArrivals(arrGuests);
  addArrLog('Purpose', `${arrGuests[i]?.name || 'Guest'}: ${prev} → ${val}`);
}

function arrRender() {
  const search   = (document.getElementById('arrSearch')?.value || '').toLowerCase();
  const filtered = arrGuests.filter(g => {
    const mf = arrFilter_ === 'all' || g.purpose === arrFilter_;
    const ms = !search || [g.room,g.conf,g.name,g.nat,g.source].join(' ').toLowerCase().includes(search);
    return mf && ms;
  });
  const tbody = document.getElementById('arrTable'); if (!tbody) return;
  if (!arrGuests.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:36px;font-family:var(--mono);font-size:0.7rem;color:var(--text3);">No arrivals loaded. Paste Opera data or upload a file above.</td></tr>';
    arrKpiUpdate(); return;
  }
  tbody.innerHTML = filtered.map(g => {
    const i = arrGuests.indexOf(g);
    return `<tr class="${g.purpose==='Leisure'?'leisure-row':''}">
      <td><input value="${g.room}"    onchange="arrGuests[${i}].room=this.value;saveArrivals(arrGuests)" style="width:46px;"/></td>
      <td><input value="${g.conf}"    onchange="arrGuests[${i}].conf=this.value" style="width:86px;"/></td>
      <td><input value="${g.name}"    onchange="arrGuests[${i}].name=this.value.toUpperCase();this.value=arrGuests[${i}].name;saveArrivals(arrGuests)" style="width:165px;"/></td>
      <td><select onchange="arrChangePurpose(${i},this.value)">
        ${['Business','Leisure','Flight'].map(p=>`<option${g.purpose===p?' selected':''}>${p}</option>`).join('')}
      </select></td>
      <td><input type="number" value="${g.nights}" onchange="arrGuests[${i}].nights=this.value;arrKpiUpdate()" style="width:42px;"/></td>
      <td><div style="display:flex;gap:3px;align-items:center;">
        <input value="${g.nat}" onchange="arrGuests[${i}].nat=this.value" style="width:86px;"/>
        <button class="icon-btn ai-btn" onclick="aiOneGuest(${i},'arr')" title="AI guess">✦</button>
      </div></td>
      <td><input value="${g.email}"   onchange="arrGuests[${i}].email=this.value" style="width:138px;"/></td>
      <td><input value="${g.source}"  onchange="arrGuests[${i}].source=this.value" style="width:100px;"/></td>
      <td><input value="${g.remarks}" onchange="arrGuests[${i}].remarks=this.value" style="width:86px;"/></td>
      <td><button class="icon-btn" onclick="arrRemoveGuest(${i})">✕</button></td>
    </tr>`;
  }).join('');
  arrKpiUpdate();
}

function arrFilter(f, el) {
  arrFilter_ = f;
  document.querySelectorAll('[data-af]').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  arrRender();
}

async function runAINat_arr() {
  setSpinner('aiSpinArr', true);
  arrGuests.forEach(g => { if (!g.nat) g.nat = guessNat(g.name); });
  arrRender();
  setSpinner('aiSpinArr', false);
  saveArrivals(arrGuests);
  addArrLog('AI Nat', `Nationality guessed for ${arrGuests.filter(g=>g.nat).length} guests`);
}

async function aiOneGuest(i, list) {
  const guests = list === 'arr' ? arrGuests : purposeGuests;
  const nat    = guessNat(guests[i].name);
  if (nat) guests[i].nat = nat;
  arrRender(); purposeRender();
}

function loadArrivals() {
  const raw = document.getElementById('arrInput').value.trim();
  if (!raw) { alert('Please paste data first.'); return; }
  const lines = raw.split('\n').filter(l => l.trim());
  if (lines.length < 2) { alert('Not enough data.'); return; }
  const hdrs = lines[0].split('\t').map(h => h.trim().toUpperCase());
  const ci   = n => hdrs.findIndex(h => h.includes(n));
  const rI=ci('ROOM'),nI=ci('NAME'),niI=ci('NIGHT'),cI=hdrs.findIndex(h=>h.includes('CONFIRM')),taI=ci('TRAVEL'),coI=ci('COMPANY'),srcI=ci('SOURCE');
  if (rI < 0 || nI < 0) { alert('Could not find Room/Name columns.'); return; }
  const guests = [];
  for (let i = 1; i < lines.length; i++) {
    const p    = lines[i].split('\t');
    const room = (p[rI]||'').trim();
    const rn   = (p[nI]||'').trim();
    if (!room || !rn) continue;
    guests.push({ room, conf:cI>=0?(p[cI]||'').trim():'', name:cleanName(rn), purpose:'Business',
      nights:niI>=0?parseInt(p[niI])||1:1, nat:'', email:'No@email.com',
      source:cleanSource(taI>=0?(p[taI]||'').trim():'', coI>=0?(p[coI]||'').trim():'', srcI>=0?(p[srcI]||'').trim():''),
      remarks:'' });
  }
  if (!guests.length) { alert('No guests found.'); return; }
  arrGuests = guests; arrRender(); setTimeout(() => runAINat_arr(), 300);
  addArrLog('Loaded', `${guests.length} guests loaded from paste`);
  logActivity('arrivals_loaded', `${guests.length} guests`);
}

function clearArrivals() { arrGuests = []; arrRender(); saveArrivals([]); addArrLog('Cleared', 'All arrivals cleared'); logActivity('arrivals_cleared', ''); }

function exportArrivals() {
  const wb   = XLSX.utils.book_new();
  const data = [['Room','Conf.','Name','Purpose','Nights','Nationality','Email','Source','Remarks']];
  arrGuests.forEach(g => data.push([g.room,g.conf,g.name,g.purpose,g.nights,g.nat,g.email,g.source,g.remarks]));
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [8,16,28,14,8,14,26,20,18].map(w => ({wch:w}));
  XLSX.utils.book_append_sheet(wb, ws, 'Arrivals');
  XLSX.writeFile(wb, 'Arrivals_' + new Date().toISOString().split('T')[0] + '.xlsx');
  addArrLog('Exported', `${arrGuests.length} guests exported to Excel`);
}

// ── PURPOSE OF STAY ───────────────────────────────────────

function addPurposeLog(action, detail) {
  const t = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  purposeLog.unshift({ action, detail, time: t, ts: Date.now() });
  if (purposeLog.length > 100) purposeLog.pop();
  savePurposeLog(purposeLog);
  renderPurposeLog();
}

function renderPurposeLog() {
  const wrap  = document.getElementById('purposeLogWrap');
  const body  = document.getElementById('purposeLogBody');
  const badge = document.getElementById('purposeLogCount');
  if (!wrap) return;
  if (!purposeLog.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  if (badge) badge.textContent = purposeLog.length;
  const icons = { 'Loaded':'📥','Added':'➕','Removed':'✕','Purpose':'🔄','Cleared':'🗑️','AI Nat':'✦','Exported':'📤','Synced':'🔁' };
  const cls   = { 'Loaded':'log-act-ext','Added':'log-act-co','Removed':'log-act-late','Purpose':'log-act-ext','Cleared':'log-act-late','AI Nat':'log-act-co','Exported':'log-act-ext','Synced':'log-act-co' };
  if (body) body.innerHTML = purposeLog.map(l => `
    <div class="log-row">
      <span class="log-action ${cls[l.action] || ''}">${icons[l.action] || '·'} ${l.action}</span>
      <span class="log-name">${escapeLogText(l.detail)}</span>
      <span class="log-time">${l.time}</span>
    </div>`).join('');
}

function togglePurposeLog() {
  const body = document.getElementById('purposeLogBody');
  const icon = document.getElementById('purposeLogToggleIcon');
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (icon) icon.textContent = open ? '▸' : '▾';
}

function purposeRemoveGuest(i) {
  const g = purposeGuests[i];
  purposeGuests.splice(i, 1);
  purposeRender(); savePurpose(purposeGuests);
  addPurposeLog('Removed', `${g.name} — Room ${g.room}`);
}

function purposeChangePurpose(i, val) {
  const prev = purposeGuests[i].purpose;
  purposeGuests[i].purpose = val;
  purposeKpiUpdate(); purposeRender(); savePurpose(purposeGuests);
  addPurposeLog('Purpose', `${purposeGuests[i]?.name || 'Guest'}: ${prev} → ${val}`);
}

function editPurposeTitle() {
  const t = prompt('Report title:', _purposeTitle);
  if (t) { _purposeTitle = t; const el = document.getElementById('purposeTitle'); if (el) el.textContent = t; }
}

function purposeKpiUpdate() {
  const t = purposeGuests.length;
  ['pk-total','pk-biz','pk-lei'].forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.textContent = [t, purposeGuests.filter(g=>g.purpose==='Business').length, purposeGuests.filter(g=>g.purpose==='Leisure').length][i];
  });
  const badge = document.getElementById('badge-purpose'); if (badge) badge.textContent = t || '0';
}

function purposeRender() {
  const search   = (document.getElementById('purposeSearch')?.value || '').toLowerCase();
  const filtered = purposeGuests.filter(g => {
    const mf = purposeFilter_ === 'all' || g.purpose === purposeFilter_;
    const ms = !search || [g.room,g.conf,g.name,g.nat,g.source].join(' ').toLowerCase().includes(search);
    return mf && ms;
  });
  const tbody = document.getElementById('purposeTable'); if (!tbody) return;
  if (!purposeGuests.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:36px;font-family:var(--mono);font-size:0.7rem;color:var(--text3);">No guests loaded. Sync from Arrivals, upload, or add manually.</td></tr>';
    purposeKpiUpdate(); return;
  }
  tbody.innerHTML = filtered.map(g => {
    const i = purposeGuests.indexOf(g);
    return `<tr class="${g.purpose==='Leisure'?'leisure-row':''}">
      <td><input value="${g.room}"    onchange="purposeGuests[${i}].room=this.value" style="width:46px;"/></td>
      <td><input value="${g.conf}"    onchange="purposeGuests[${i}].conf=this.value" style="width:86px;"/></td>
      <td><input value="${g.name}"    onchange="purposeGuests[${i}].name=this.value.toUpperCase();this.value=purposeGuests[${i}].name;savePurpose(purposeGuests)" style="width:165px;"/></td>
      <td><select onchange="purposeChangePurpose(${i},this.value)">
        ${['Business','Leisure','Flight'].map(p=>`<option${g.purpose===p?' selected':''}>${p}</option>`).join('')}
      </select></td>
      <td><input type="number" value="${g.nights}" onchange="purposeGuests[${i}].nights=this.value" style="width:42px;"/></td>
      <td><div style="display:flex;gap:3px;align-items:center;">
        <input value="${g.nat}" onchange="purposeGuests[${i}].nat=this.value" style="width:86px;"/>
        <button class="icon-btn ai-btn" onclick="aiOneGuest(${i},'purpose')" title="AI">✦</button>
      </div></td>
      <td><input value="${g.email}"   onchange="purposeGuests[${i}].email=this.value" style="width:138px;"/></td>
      <td><input value="${g.source}"  onchange="purposeGuests[${i}].source=this.value" style="width:100px;"/></td>
      <td><input value="${g.remarks}" onchange="purposeGuests[${i}].remarks=this.value" style="width:86px;"/></td>
      <td><button class="icon-btn" onclick="purposeRemoveGuest(${i})">✕</button></td>
    </tr>`;
  }).join('');
  purposeKpiUpdate();
}

function purposeFilter(f, el) {
  purposeFilter_ = f;
  document.querySelectorAll('[data-pf]').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  purposeRender();
}

function syncFromArrivals() {
  if (!arrGuests.length) { alert('No arrivals loaded. Go to Arrivals tab first.'); return; }
  purposeGuests = arrGuests.map(g => ({...g}));
  purposeRender(); savePurpose(purposeGuests);
  showToast('Synced from Arrivals ✓');
  addPurposeLog('Synced', `${purposeGuests.length} guests synced from Arrivals`);
}

function clearPurpose() {
  purposeGuests = []; purposeRender(); savePurpose([]);
  addPurposeLog('Cleared', 'All guests cleared');
}

function loadPurpose() {
  const raw = document.getElementById('purposeInput').value.trim();
  if (!raw) { alert('Please paste data first.'); return; }
  const lines = raw.split('\n').filter(l => l.trim()); if (lines.length < 2) return;
  const hdrs  = lines[0].split('\t').map(h => h.trim().toUpperCase());
  const ci    = n => hdrs.findIndex(h => h.includes(n));
  const rI=ci('ROOM'),nI=ci('NAME'),niI=ci('NIGHT'),cI=hdrs.findIndex(h=>h.includes('CONFIRM')),taI=ci('TRAVEL'),coI=ci('COMPANY'),srcI=ci('SOURCE');
  if (rI < 0 || nI < 0) { alert('Could not find Room/Name.'); return; }
  const guests = [];
  for (let i = 1; i < lines.length; i++) {
    const p    = lines[i].split('\t');
    const room = (p[rI]||'').trim();
    const rn   = (p[nI]||'').trim();
    if (!room || !rn) continue;
    guests.push({ room, conf:cI>=0?(p[cI]||'').trim():'', name:cleanName(rn), purpose:'Business',
      nights:niI>=0?parseInt(p[niI])||1:1, nat:'', email:'No@email.com',
      source:cleanSource(taI>=0?(p[taI]||'').trim():'', coI>=0?(p[coI]||'').trim():'', srcI>=0?(p[srcI]||'').trim():''),
      remarks:'' });
  }
  purposeGuests = guests; purposeRender(); setTimeout(() => runAINat_purpose(), 300);
  addPurposeLog('Loaded', `${guests.length} guests loaded from paste`);
}

async function runAINat_purpose() {
  setSpinner('aiSpinPurpose', true);
  purposeGuests.forEach(g => { if (!g.nat) g.nat = guessNat(g.name); });
  purposeRender();
  setSpinner('aiSpinPurpose', false);
  savePurpose(purposeGuests);
  addPurposeLog('AI Nat', `Nationality guessed for ${purposeGuests.filter(g=>g.nat).length} guests`);
}

function exportPurpose() {
  const wb   = XLSX.utils.book_new();
  const data = [['Room','Conf.','Name','Purpose','Nights','Nationality','Email','Source','Remarks']];
  purposeGuests.forEach(g => data.push([g.room,g.conf,g.name,g.purpose,g.nights,g.nat,g.email,g.source,g.remarks]));
  const ws = XLSX.utils.aoa_to_sheet(data);
  const hS = {font:{bold:true,color:{rgb:'FFFFFF'},name:'Arial',sz:10},fill:{fgColor:{rgb:'1F4E79'},patternType:'solid'},alignment:{horizontal:'center'},border:{top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'}}};
  const bS = {font:{name:'Arial',sz:10},fill:{fgColor:{rgb:'FFFFFF'},patternType:'solid'},border:{top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'}}};
  const lS = {font:{name:'Arial',sz:10},fill:{fgColor:{rgb:'E2EFDA'},patternType:'solid'},border:{top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'}}};
  ['A','B','C','D','E','F','G','H','I'].forEach(c => { if (ws[c+'1']) ws[c+'1'].s = hS; });
  purposeGuests.forEach((g, ri) => {
    const rn = ri + 2; const s = g.purpose === 'Leisure' ? lS : bS;
    ['A','B','C','D','E','F','G','H','I'].forEach(c => { const cell = ws[c+rn]; if (cell) cell.s = s; });
  });
  ws['!cols'] = [8,16,28,14,8,14,26,20,18].map(w => ({wch:w}));
  XLSX.utils.book_append_sheet(wb, ws, 'Purpose of Stay');
  XLSX.writeFile(wb, (_purposeTitle||'Purpose').replace(/\s+/g,'_')+'.xlsx', {bookSST:false,type:'binary',cellStyles:true});
  addPurposeLog('Exported', `${purposeGuests.length} guests exported`);
}

// ── ADD GUEST MODAL ───────────────────────────────────────
function openAddGuest(target = 'arrivals') {
  guestModalTarget = target;
  document.getElementById('guestModalTitle').textContent = 'Add Guest — ' + (target==='arrivals'?'Arrivals':'Purpose of Stay');
  ['mg-room','mg-conf','mg-name','mg-email','mg-source','mg-remarks','mg-nat'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('mg-nights').value  = 1;
  document.getElementById('mg-purpose').value = 'Business';
  document.getElementById('guestModal').classList.add('open');
}
function closeModal() { document.getElementById('guestModal').classList.remove('open'); }
function aiGuessModal() {
  const name = document.getElementById('mg-name').value.toUpperCase();
  if (!name) return;
  const nat = guessNat(name);
  if (nat) document.getElementById('mg-nat').value = nat;
}
function saveGuest() {
  const g = {
    room:    document.getElementById('mg-room').value,
    conf:    document.getElementById('mg-conf').value,
    name:    document.getElementById('mg-name').value.toUpperCase(),
    purpose: document.getElementById('mg-purpose').value,
    nights:  Number(document.getElementById('mg-nights').value) || 1,
    nat:     document.getElementById('mg-nat').value,
    email:   document.getElementById('mg-email').value || 'No@email.com',
    source:  document.getElementById('mg-source').value,
    remarks: document.getElementById('mg-remarks').value,
  };
  if (!g.name) return;
  if (guestModalTarget === 'arrivals') {
    arrGuests.push(g); arrRender(); saveArrivals(arrGuests);
    addArrLog('Added', `${g.name} — Room ${g.room}`);
  } else {
    purposeGuests.push(g); purposeRender(); savePurpose(purposeGuests);
    addPurposeLog('Added', `${g.name} — Room ${g.room}`);
  }
  closeModal();
}

// ── OPERA FILE LOADER ─────────────────────────────────────
function loadOperaFile(input, target) {
  const file = input.files[0]; if (!file) return;
  const ext  = file.name.split('.').pop().toLowerCase();
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      let rows = [];
      if (ext === 'csv') {
        const text = new TextDecoder('utf-8').decode(new Uint8Array(e.target.result));
        rows = text.split('\n').filter(l => l.trim()).map(parseCSVLine);
      } else {
        const wb = XLSX.read(e.target.result, {type:'array'});
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
      }
      if (rows.length < 2) { alert('File empty'); return; }
      let hdrRow = 0;
      for (let i = 0; i < Math.min(5, rows.length); i++) {
        const r = rows[i].map(c => String(c).toLowerCase());
        if (r.some(c => c.includes('room') || c.includes('name'))) { hdrRow = i; break; }
      }
      const hdrs = rows[hdrRow].map(c => String(c).replace(/"/g,'').trim().toUpperCase());
      const ci   = name => hdrs.findIndex(h => h === name || h.includes(name));
      const rI=ci('ROOM'), nI=ci('NAME'), cI=hdrs.findIndex(h=>h.includes('CONFIRM')), niI=ci('NIGHT'),
            taI=hdrs.findIndex(h=>h.includes('TRAVEL')), coI=ci('COMPANY'), srcI=ci('SOURCE');
      if (rI < 0 || nI < 0) { alert('Cannot find Room/Name.\nHeaders: ' + hdrs.slice(0,10).join(', ')); return; }
      const guests = [];
      for (let i = hdrRow + 1; i < rows.length; i++) {
        const r    = rows[i];
        const room = String(r[rI]||'').replace(/"/g,'').trim();
        const rn   = String(r[nI]||'').replace(/"/g,'').trim();
        if (!room || !rn) continue;
        guests.push({
          room, conf: cI>=0?String(r[cI]||'').replace(/"/g,'').trim():'',
          name:   cleanName(rn),
          purpose:'Business',
          nights: niI>=0?parseInt(r[niI])||1:1,
          nat:    '', email:'No@email.com',
          source: cleanSource(taI>=0?String(r[taI]||'').trim():'', coI>=0?String(r[coI]||'').trim():'', srcI>=0?String(r[srcI]||'').trim():''),
          remarks:'',
        });
      }
      if (!guests.length) { alert('No valid guest rows found.'); return; }
      if (target === 'arr') { arrGuests = guests; arrRender(); setTimeout(() => runAINat_arr(), 400); }
      else { purposeGuests = guests; purposeRender(); setTimeout(() => runAINat_purpose(), 400); }
    } catch (err) { console.error(err); alert('Error: ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
}

// ═══════════════════════════════════════════════════════════
//  arrivals-purpose.js  —  Arrivals + Purpose of Stay + Guest modal + File loader
// ═══════════════════════════════════════════════════════════

// ── Debounced save helpers ────────────────────────────────
// Saves fire 800ms after the last keystroke — table never
// re-renders while the user is mid-edit.
let _saveArrTimer     = null;
let _savePurposeTimer = null;

function debounceSaveArrivals() {
  clearTimeout(_saveArrTimer);
  _saveArrTimer = setTimeout(() => saveArrivals(arrGuests), 5000);
}
function debounceSavePurpose() {
  clearTimeout(_savePurposeTimer);
  _savePurposeTimer = setTimeout(() => savePurpose(purposeGuests), 5000);
}

// ── Origin of Travel — XML lookup maps ───────────────────
// _originNameMap : normalised "GIVEN FAMILY" guest name → nationality (PRIMARY match)
// _originMap     : normalised room number (no leading zeros, uppercase) → nationality (fallback)
// Both populated by parseOriginXML()
let _originMap     = {};
let _originNameMap = {};

function _normRoom(r) {
  // Strip leading zeros so "0621" matches "621", keep as string
  return String(r || '').replace(/^0+/, '').trim().toUpperCase();
}

// Normalise a guest name for matching: collapse whitespace, uppercase, trim.
function _normName(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

// A valid UAE Emirates ID is a 15-digit number starting with "784"
// (format 784-YYYY-XXXXXXX-X). Guests with one on file are UAE residents,
// regardless of their passport nationality.
function _isEmiratesId(doc) {
  const d = String(doc || '').replace(/[\s-]/g, '');
  return /^784\d{12}$/.test(d);
}

// Parse the Crystal Reports Inhouse XML and build lookup maps:
//   nameMap: "GIVEN FAMILY" → Origin value   (primary — works for guests not yet room-assigned)
//   roomMap: room number    → Origin value   (fallback — used only if a real room number is set)
// Origin value = "UAE" if the guest has an Emirates ID on file (DocumentNumber1
// starts with 784), otherwise their passport Nationality1 — see _isEmiratesId().
// "Main Contact" records take priority when there's a collision.
function parseOriginXML(xmlText) {
  const roomMap = {};
  const nameMap = {};
  try {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(xmlText, 'text/xml');
    // Crystal Reports XML uses a default namespace, so querySelector('Details')
    // returns nothing in browsers. Use getElementsByTagNameNS with wildcard instead.
    const ns       = 'urn:crystal-reports:schemas:report-detail';
    const sections = doc.getElementsByTagNameNS(ns, 'Section');

    const getField = (sec, fieldName) => {
      // Find <Field Name="fieldName"> then its <FormattedValue>
      const fields = sec.getElementsByTagNameNS(ns, 'Field');
      for (let i = 0; i < fields.length; i++) {
        if (fields[i].getAttribute('Name') === fieldName) {
          const fv = fields[i].getElementsByTagNameNS(ns, 'FormattedValue')[0];
          return fv ? (fv.textContent || '').trim() : '';
        }
      }
      return '';
    };

    for (let i = 0; i < sections.length; i++) {
      const sec   = sections[i];
      // Only process sections that are direct children of <Details>
      if (!sec.parentNode || sec.parentNode.localName !== 'Details') continue;
      const room    = getField(sec, 'RoomNumber1');
      const nat     = getField(sec, 'Nationality1');
      const docNum  = getField(sec, 'DocumentNumber1');
      const gtype   = getField(sec, 'GuestType1');
      const given   = getField(sec, 'GivenName1');
      const family  = getField(sec, 'FamilyName1');
      if (!nat) continue;

      // Emirates ID on file → guest is a UAE resident, regardless of passport nationality
      const origin = _isEmiratesId(docNum) ? 'UAE' : nat;

      // Room-based map (fallback only — kept for compatibility)
      if (room) {
        const rKey = _normRoom(room);
        if (gtype === 'Main Contact' || !roomMap[rKey]) roomMap[rKey] = origin;
      }

      // Name-based map (primary) — same word order as parseName(): GIVEN then FAMILY
      if (given && family) {
        const nKey = _normName(`${given} ${family}`);
        if (gtype === 'Main Contact' || !nameMap[nKey]) nameMap[nKey] = origin;
      }
    }
  } catch (e) {
    console.warn('[OriginXML] parse error:', e);
  }
  return { roomMap, nameMap };
}

// Load XML from file input (called by HTML button)
function loadOriginXML(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const { roomMap, nameMap } = parseOriginXML(e.target.result);
    _originMap     = roomMap;
    _originNameMap = nameMap;
    const count = Math.max(Object.keys(nameMap).length, Object.keys(roomMap).length);
    if (!count) { showToast('No guest data found in XML — check file format', 'err'); return; }
    showToast(`✦ Origin map loaded — ${count} guests`, 'ok');
    // Apply to any already-loaded purpose guests
    _applyOriginToPurpose();
    purposeRender();
    // Update the badge/label
    const lbl = document.getElementById('originXmlLabel');
    if (lbl) lbl.textContent = `${count} guests loaded from XML`;
  };
  reader.readAsText(file, 'utf-8');
}

// Fill originOfTravel field on purposeGuests from the XML lookup maps.
// Matches primarily by guest name (works even when no room is assigned yet);
// falls back to room number only if the guest has a real (numeric) room.
// Any value filled this way is also saved into shared Guest Memory so it's
// available next time, even without re-loading the Inhouse XML.
// If the Inhouse XML's Nationality field is "United Arab Emirates", it almost
// always means Opera read this from the guest's Emirates ID (residency doc),
// NOT their actual passport nationality. For Origin of Travel purposes that
// just means "UAE resident" — normalise it to the short form "UAE".
// Every other nationality is passed through unchanged.
function _normOrigin(nat) {
  const n = String(nat || '').trim();
  if (/^united arab emirates$/i.test(n)) return 'UAE';
  return n;
}

function _applyOriginToPurpose() {
  if (!purposeGuests.length) return;
  if (!Object.keys(_originNameMap).length && !Object.keys(_originMap).length) return;
  let filled = 0;
  purposeGuests.forEach(g => {
    if (g.originOfTravel) return;

    let nat = _originNameMap[_normName(g.name)];

    if (!nat) {
      const roomKey = _normRoom(g.room);
      // Ignore placeholder room text like "ASSIGN ROOM" — only use real room numbers
      if (roomKey && /\d/.test(roomKey)) nat = _originMap[roomKey];
    }

    if (nat) {
      const origin = _normOrigin(nat);
      g.originOfTravel = origin;
      filled++;
      // Persist to Guest Memory so future stays auto-fill even without the XML
      if (typeof gmOnEdit === 'function') gmOnEdit(g.name, 'originOfTravel', origin);
    }
  });
  if (filled) showToast(`✦ Origin of Travel filled for ${filled} guest${filled !== 1 ? 's' : ''}`, 'ok');
}

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
      <td><input value="${g.room}"
        oninput="arrGuests[${i}].room=this.value"
        onblur="debounceSaveArrivals()"
        style="width:46px;"/></td>
      <td><input value="${g.conf}"
        oninput="arrGuests[${i}].conf=this.value"
        style="width:86px;"/></td>
      <td><input value="${g.name}"
        oninput="arrGuests[${i}].name=this.value"
        onblur="arrGuests[${i}].name=this.value.toUpperCase();this.value=arrGuests[${i}].name;debounceSaveArrivals()"
        style="width:165px;"/></td>
      <td><select onchange="arrChangePurpose(${i},this.value)">
        ${['Business','Leisure','Flight'].map(p=>`<option${g.purpose===p?' selected':''}>${p}</option>`).join('')}
      </select></td>
      <td><input type="number" value="${g.nights}"
        oninput="arrGuests[${i}].nights=this.value"
        onblur="arrKpiUpdate();debounceSaveArrivals()"
        style="width:42px;"/></td>
      <td><div style="display:flex;gap:3px;align-items:center;">
        <input value="${g.nat}"
          oninput="arrGuests[${i}].nat=this.value"
          onblur="gmOnEdit(arrGuests[${i}].name,'nat',this.value);debounceSaveArrivals()"
          style="width:86px;${g._fromMemory?'border-color:var(--sky);':''}"/>
        <button class="icon-btn ai-btn" onclick="aiOneGuest(${i},'arr')" title="AI guess">✦</button>
      </div></td>
      <td><input value="${g.email}"
        oninput="arrGuests[${i}].email=this.value"
        onblur="gmOnEdit(arrGuests[${i}].name,'email',this.value);debounceSaveArrivals()"
        style="width:138px;${g._fromMemory?'border-color:var(--sky);':''}"/></td>
      <td><input value="${g.source}"
        oninput="arrGuests[${i}].source=this.value"
        style="width:100px;"/></td>
      <td><input value="${g.remarks}"
        oninput="arrGuests[${i}].remarks=this.value"
        style="width:86px;"/></td>
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
  arrGuests = guests;
  arrRender();
  // AI guesser first, memory on top — memory always wins
  setTimeout(() => {
    runAINat_arr().then(() => {
      if (typeof gmAutoFill === 'function') gmAutoFill(arrGuests);
      arrRender();
    });
  }, 300);
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
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:28px 36px;">
      <div style="font-family:var(--mono);font-size:0.7rem;color:var(--text3);margin-bottom:14px;">
        No guests loaded. Sync from Arrivals, upload a file, or add manually.
      </div>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
        <button class="btn mint" onclick="syncFromArrivals()" style="font-size:0.72rem;">↑ Sync from Arrivals</button>
        <button class="btn gold" onclick="openAddGuest('purpose')" style="font-size:0.72rem;">+ Add Guest Manually</button>
      </div>
    </td></tr>`;
    purposeKpiUpdate(); return;
  }
  tbody.innerHTML = filtered.map(g => {
    const i      = purposeGuests.indexOf(g);
    const origin = g.originOfTravel || '';
    // Visual cue: green border if filled from XML, orange if blank
    const originStyle = origin
      ? 'border-color:var(--mint);'
      : (Object.keys(_originMap).length ? 'border-color:var(--amber);' : '');
    return `<tr class="${g.purpose==='Leisure'?'leisure-row':''}">
      <td><input value="${g.room}"
        oninput="purposeGuests[${i}].room=this.value"
        onblur="debounceSavePurpose()"
        style="width:46px;"/></td>
      <td><input value="${g.conf}"
        oninput="purposeGuests[${i}].conf=this.value"
        style="width:86px;"/></td>
      <td><input value="${g.name}"
        oninput="purposeGuests[${i}].name=this.value"
        onblur="purposeGuests[${i}].name=this.value.toUpperCase();this.value=purposeGuests[${i}].name;debounceSavePurpose()"
        style="width:165px;"/></td>
      <td><select onchange="purposeChangePurpose(${i},this.value)">
        ${['Business','Leisure','Flight'].map(p=>`<option${g.purpose===p?' selected':''}>${p}</option>`).join('')}
      </select></td>
      <td><input type="number" value="${g.nights}"
        oninput="purposeGuests[${i}].nights=this.value"
        onblur="purposeKpiUpdate();debounceSavePurpose()"
        style="width:42px;"/></td>
      <td><div style="display:flex;gap:3px;align-items:center;">
        <input value="${g.nat}"
          oninput="purposeGuests[${i}].nat=this.value"
          onblur="gmOnEdit(purposeGuests[${i}].name,'nat',this.value);debounceSavePurpose()"
          style="width:86px;${g._fromMemory?'border-color:var(--sky);':''}"/>
        <button class="icon-btn ai-btn" onclick="aiOneGuest(${i},'purpose')" title="AI">✦</button>
      </div></td>
      <td><input value="${g.email}"
        oninput="purposeGuests[${i}].email=this.value"
        onblur="gmOnEdit(purposeGuests[${i}].name,'email',this.value);debounceSavePurpose()"
        style="width:138px;${g._fromMemory?'border-color:var(--sky);':''}"/></td>
      <td><input value="${g.source}"
        oninput="purposeGuests[${i}].source=this.value"
        style="width:100px;"/></td>
      <td>
        <input value="${origin}"
          oninput="purposeGuests[${i}].originOfTravel=this.value"
          onblur="gmOnEdit(purposeGuests[${i}].name,'originOfTravel',this.value);debounceSavePurpose()"
          placeholder="—"
          title="Origin of Travel — loaded from Inhouse XML"
          style="width:96px;${originStyle}"/>
      </td>
      <td><input value="${g.remarks}"
        oninput="purposeGuests[${i}].remarks=this.value"
        style="width:86px;"/></td>
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
  _applyOriginToPurpose();
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
      originOfTravel: _originMap[_normRoom(room)] || '',
      remarks:'' });
  }
  purposeGuests = guests;
  purposeRender();
  // AI guesser first, memory on top — memory always wins
  setTimeout(() => {
    runAINat_purpose().then(() => {
      if (typeof gmAutoFill === 'function') gmAutoFill(purposeGuests);
      _applyOriginToPurpose();
      purposeRender();
    });
  }, 300);
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
  const data = [['Room','Conf.','Name','Purpose','Nights','Nationality','Email','Source','Origin of Travel','Remarks']];
  purposeGuests.forEach(g => data.push([g.room,g.conf,g.name,g.purpose,g.nights,g.nat,g.email,g.source,g.originOfTravel||'',g.remarks]));
  const ws = XLSX.utils.aoa_to_sheet(data);
  const hS = {font:{bold:true,color:{rgb:'FFFFFF'},name:'Arial',sz:10},fill:{fgColor:{rgb:'1F4E79'},patternType:'solid'},alignment:{horizontal:'center'},border:{top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'}}};
  const bS = {font:{name:'Arial',sz:10},fill:{fgColor:{rgb:'FFFFFF'},patternType:'solid'},border:{top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'}}};
  const lS = {font:{name:'Arial',sz:10},fill:{fgColor:{rgb:'E2EFDA'},patternType:'solid'},border:{top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'}}};
  ['A','B','C','D','E','F','G','H','I','J'].forEach(c => { if (ws[c+'1']) ws[c+'1'].s = hS; });
  purposeGuests.forEach((g, ri) => {
    const rn = ri + 2; const s = g.purpose === 'Leisure' ? lS : bS;
    ['A','B','C','D','E','F','G','H','I','J'].forEach(c => { const cell = ws[c+rn]; if (cell) cell.s = s; });
  });
  ws['!cols'] = [8,16,28,14,8,14,26,20,18,18].map(w => ({wch:w}));
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

function purposeAddManual() {
  openAddGuest('purpose');
}

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
          originOfTravel: _originMap[_normRoom(room)] || '',
          remarks:'',
        });
      }
      if (!guests.length) { alert('No valid guest rows found.'); return; }
      // AI guesser first, memory on top — memory always wins
      if (target === 'arr') {
        arrGuests = guests;
        arrRender();
        setTimeout(() => {
          runAINat_arr().then(() => {
            if (typeof gmAutoFill === 'function') gmAutoFill(arrGuests);
            arrRender();
          });
        }, 400);
      } else {
        purposeGuests = guests;
        purposeRender();
        setTimeout(() => {
          runAINat_purpose().then(() => {
            if (typeof gmAutoFill === 'function') gmAutoFill(purposeGuests);
            _applyOriginToPurpose();
            purposeRender();
          });
        }, 400);
      }
    } catch (err) { console.error(err); alert('Error: ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
}

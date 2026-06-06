// ═══════════════════════════════════════════════════════════
//  guest-memory.js  —  Guest Profile Memory Store
//
//  FLOW:
//  1. gmInit()         — loads profiles from Firebase once
//  2. On import        — gmAutoFill() runs once, silently fills
//                        blank nat/email from stored profiles.
//                        Zero writes to Firebase. Zero side effects.
//  3. User edits cell  — gmOnEdit() updates _gmStore locally,
//                        queues a debounced Firebase save.
//                        Never re-renders the table.
//  4. "Save to Memory" — gmScanAndSaveAll() saves everything
//                        currently loaded into memory.
// ═══════════════════════════════════════════════════════════

let _gmStore     = {};
let _gmReady     = false;
let _gmSaveTimer = null;
// Auto-fill toggle — persisted in localStorage so it survives page refresh
let _gmAutoFillOn = localStorage.getItem('gm_autofill') !== 'off';

function gmKey(name) {
  return String(name || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

// ── Auto-fill toggle ──────────────────────────────────────
function gmToggleAutoFill() {
  _gmAutoFillOn = !_gmAutoFillOn;
  localStorage.setItem('gm_autofill', _gmAutoFillOn ? 'on' : 'off');
  _gmRenderToggle();
  showToast(_gmAutoFillOn ? '✦ Auto-fill ON — guests will be filled on import' : '✦ Auto-fill OFF — import won\'t touch guest fields', 'info');
}

function _gmRenderToggle() {
  const track  = document.getElementById('gmAutoFillTrack');
  const thumb  = document.getElementById('gmAutoFillThumb');
  const label  = document.getElementById('gmAutoFillLabel');
  const wrap   = document.getElementById('gmAutoFillToggleWrap');
  if (!track) return;
  if (_gmAutoFillOn) {
    track.style.background      = 'var(--mint, #3ecf8e)';
    thumb.style.left            = '18px';
    label.textContent           = 'Auto-fill: ON';
    label.style.color           = 'var(--mint, #3ecf8e)';
    wrap.style.borderColor      = 'rgba(62,207,142,0.4)';
  } else {
    track.style.background      = 'var(--border, #2a2f3d)';
    thumb.style.left            = '2px';
    label.textContent           = 'Auto-fill: OFF';
    label.style.color           = 'var(--text3)';
    wrap.style.borderColor      = 'var(--border, #2a2f3d)';
  }
}

// ── Init: load from Firebase once, stay in sync with colleagues ──
function gmInit() {
  if (typeof fbListen !== 'function') {
    console.warn('[GuestMemory] fbListen not available');
    return;
  }
  // Render toggle to correct state as soon as DOM is ready
  setTimeout(_gmRenderToggle, 0);

  fbListen('guestMemory', snap => {
    _gmStore = snap || {};
    _gmReady = true;
    const tbl     = document.getElementById('gmTable');
    const editing = tbl && tbl.contains(document.activeElement);
    if (!editing) _gmUpdateUI();
    else          _gmUpdateStatsOnly();
    _gmRenderToggle();
  });
}

// ── Debounced Firebase save ───────────────────────────────
function _gmPersist() {
  clearTimeout(_gmSaveTimer);
  _gmSaveTimer = setTimeout(async () => {
    try { await fbSet('guestMemory', _gmStore); }
    catch (e) { console.warn('[GuestMemory] save failed:', e); }
  }, 3000);
}

// ── Auto-fill: called once after import ───────────────────
// Respects the _gmAutoFillOn toggle — if OFF, does nothing.
// Read-only: zero Firebase writes, zero hit counting.
function gmAutoFill(guests, silent) {
  if (!_gmAutoFillOn) return 0;   // toggle is OFF — skip entirely
  if (!_gmReady || !guests || !guests.length) return 0;
  let filled = 0;
  guests.forEach(g => {
    const profile = _gmStore[gmKey(g.name)];
    if (!profile) return;
    let hit = false;
    if (!g.nat    || g.nat    === '')             { if (profile.nat)     { g.nat     = profile.nat;     hit = true; } }
    if (!g.email  || g.email  === 'No@email.com') { if (profile.email)   { g.email   = profile.email;   hit = true; } }
    if (!g.purpose|| g.purpose=== 'Business')     { if (profile.purpose) { g.purpose = profile.purpose; hit = true; } }
    if (hit) { filled++; g._fromMemory = true; }
  });
  // No _gmPersist() here — reading only, never writes back
  if (filled && !silent) showToast(`✦ ${filled} guest${filled !== 1 ? 's' : ''} filled from memory`, 'info');
  return filled;
}

// ── Called by onchange on a table input/select ────────────
// Patches _gmStore in memory and queues a Firebase save.
// NEVER rebuilds the table DOM — user keeps focus.
function gmOnEdit(name, field, value) {
  const key = gmKey(name);
  if (!_gmStore[key]) _gmStore[key] = { nat:'', email:'', purpose:'Business', hits:0, lastSeen:'' };
  _gmStore[key][field]   = value;
  _gmStore[key].lastSeen = new Date().toISOString().split('T')[0];
  _gmUpdateStatsOnly();
  _gmPersist();
}

// ── "Save to Memory" button ───────────────────────────────
function gmScanAndSaveAll() {
  const lists = [];
  if (typeof arrGuests     !== 'undefined' && arrGuests.length)     lists.push(...arrGuests);
  if (typeof purposeGuests !== 'undefined' && purposeGuests.length) lists.push(...purposeGuests);
  if (!lists.length) { showToast('No guests loaded — load Arrivals or Purpose first', 'err'); return; }

  let saved = 0, updated = 0;
  lists.forEach(g => {
    if (!g.name || g.name === '—') return;
    const key = gmKey(g.name), ex = _gmStore[key] || {}, isNew = !_gmStore[key];
    _gmStore[key] = {
      nat:      (g.nat   && g.nat   !== '')             ? g.nat   : (ex.nat   || ''),
      email:    (g.email && g.email !== 'No@email.com') ? g.email : (ex.email || ''),
      purpose:  g.purpose  || ex.purpose  || 'Business',
      conf:     g.conf     || ex.conf     || '',
      hits:     ex.hits    || 0,
      lastSeen: ex.lastSeen|| new Date().toISOString().split('T')[0],
    };
    if (isNew) saved++; else updated++;
  });
  _gmPersist();
  _gmUpdateUI();
  showToast(`🧠 ${saved} new · ${updated} updated in memory`, 'ok');
}

function gmSaveProfile(g) {
  if (!g || !g.name) return;
  const key = gmKey(g.name), ex = _gmStore[key] || {};
  _gmStore[key] = {
    nat:      g.nat     || ex.nat     || '',
    email:    g.email   || ex.email   || '',
    purpose:  g.purpose || ex.purpose || 'Business',
    conf:     g.conf    || ex.conf    || '',
    hits:     ex.hits   || 0,
    lastSeen: new Date().toISOString().split('T')[0],
  };
  _gmPersist();
}

function gmLookup(name) { return _gmStore[gmKey(name)] || null; }

function gmDeleteProfile(name) {
  const key = gmKey(name);
  if (!_gmStore[key]) return;
  delete _gmStore[key];
  _gmPersist();
  _gmRenderTable();
  showToast('Profile deleted', 'info');
}

function gmClearAll() {
  if (!confirm('Clear ALL guest memory profiles? This cannot be undone.')) return;
  _gmStore = {};
  _gmPersist();
  _gmRenderTable();
  showToast('Guest memory cleared', 'info');
}

// ── Stats bar only — no table DOM changes ─────────────────
function _gmUpdateStatsOnly() {
  const entries   = Object.entries(_gmStore);
  const total     = entries.length;
  const withNat   = entries.filter(([,p]) => p.nat   && p.nat   !== '').length;
  const withEmail = entries.filter(([,p]) => p.email && p.email !== '' && p.email !== 'No@email.com').length;
  const badge = document.getElementById('badge-guestmem');
  if (badge) badge.textContent = total || '0';
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('gm-count', total);
  set('gm-with-nat', withNat);
  set('gm-with-email', withEmail);
  set('gm-total-hits', '—');   // no longer tracked
}

function _gmUpdateUI() {
  _gmUpdateStatsOnly();
  _gmRenderTable();
}

// ── Render table ──────────────────────────────────────────
function _gmRenderTable() {
  const tbody = document.getElementById('gmTable');
  if (!tbody) return;
  const search  = (document.getElementById('gmSearch')?.value || '').toLowerCase();
  const entries = Object.entries(_gmStore)
    .filter(([k]) => !search || k.toLowerCase().includes(search))
    .sort((a, b) => a[0].localeCompare(b[0]));

  const cnt = document.getElementById('gmProfileCount');
  if (cnt) cnt.textContent = entries.length + ' profiles';

  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:36px;
      font-family:var(--mono);font-size:0.7rem;color:var(--text3);">
      No profiles yet. Load guests then click "Save to Memory".</td></tr>`;
    return;
  }

  tbody.innerHTML = entries.map(([key, p]) => {
    const ek = key.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    return `
    <tr>
      <td style="font-weight:500;color:var(--text);font-size:0.72rem;">${key}</td>
      <td>
        <input class="gm-inline-inp" value="${(p.nat||'').replace(/"/g,'&quot;')}"
          onchange="gmOnEdit('${ek}','nat',this.value)"
          placeholder="—" style="width:90px;"/>
      </td>
      <td>
        <input class="gm-inline-inp" value="${(p.email||'').replace(/"/g,'&quot;')}"
          onchange="gmOnEdit('${ek}','email',this.value)"
          placeholder="—" style="width:160px;"/>
      </td>
      <td>
        <select class="gm-inline-inp"
          onchange="gmOnEdit('${ek}','purpose',this.value)"
          style="width:90px;">
          ${['Business','Leisure','Flight'].map(v =>
            `<option${(p.purpose||'Business')===v?' selected':''}>${v}</option>`).join('')}
        </select>
      </td>
      <td style="font-family:var(--mono);font-size:0.62rem;color:var(--text3);">
        ${p.lastSeen || '—'}
      </td>
      <td>
        <button class="icon-btn" onclick="gmDeleteProfile('${ek}')"
          title="Delete" style="color:var(--rose);">✕</button>
      </td>
    </tr>`;
  }).join('');
}

// ── Export CSV ────────────────────────────────────────────
function gmExport() {
  const rows = [['Name','Nationality','Email','Purpose','Last Seen']];
  Object.entries(_gmStore).forEach(([k,p]) =>
    rows.push([k, p.nat||'', p.email||'', p.purpose||'', p.lastSeen||'']));
  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'guest_memory_' + new Date().toISOString().split('T')[0] + '.csv';
  a.click(); URL.revokeObjectURL(a.href);
  showToast('Memory exported ✓', 'ok');
}

// ── Import CSV ────────────────────────────────────────────
function gmImportFile(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const lines = e.target.result.split('\n').slice(1);
    let count = 0;
    lines.forEach(line => {
      if (!line.trim()) return;
      const parts = line.split(',').map(p => p.replace(/^"|"$/g,'').trim());
      if (!parts[0]) return;
      _gmStore[gmKey(parts[0])] = {
        nat:parts[1]||'', email:parts[2]||'', purpose:parts[3]||'Business',
        hits:0, lastSeen:parts[4]||'',
      };
      count++;
    });
    _gmPersist();
    _gmRenderTable();
    showToast(`${count} profiles imported ✓`, 'ok');
  };
  reader.readAsText(file);
}

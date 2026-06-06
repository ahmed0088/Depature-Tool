// ═══════════════════════════════════════════════════════════
//  guest-memory.js  —  Guest Profile Memory Store
// ═══════════════════════════════════════════════════════════

// ── In-memory cache ───────────────────────────────────────
let _gmStore     = {};
let _gmReady     = false;
let _gmSaveTimer = null;
// Tracks whether ANY input/select inside the memory table is focused.
// While true, the Firebase listener must not touch the DOM.
let _gmUserEditing = false;

// ── Key normaliser ────────────────────────────────────────
function gmKey(name) {
  return String(name || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

// ── Init ──────────────────────────────────────────────────
function gmInit() {
  if (typeof fbListen !== 'function') {
    console.warn('[GuestMemory] fbListen not available — memory disabled');
    return;
  }

  // Track focus anywhere inside the memory table
  document.addEventListener('focusin', e => {
    const tbl = document.getElementById('gmTable');
    if (tbl && tbl.contains(e.target)) _gmUserEditing = true;
  });
  document.addEventListener('focusout', e => {
    const tbl = document.getElementById('gmTable');
    // Small delay so focusout → focusin inside same table doesn't flicker
    setTimeout(() => {
      if (!tbl || !tbl.contains(document.activeElement)) _gmUserEditing = false;
    }, 100);
  });

  fbListen('guestMemory', snap => {
    _gmStore = snap || {};
    _gmReady = true;

    if (_gmUserEditing) {
      // User is typing — only update the stats numbers, never touch the table DOM
      _gmUpdateStatsOnly();
    } else {
      _gmUpdateUI();
    }

    console.log(`[GuestMemory] ${Object.keys(_gmStore).length} profiles`);

    // Self-healing: fill guests that loaded before Firebase responded
    if (typeof arrGuests !== 'undefined' && arrGuests.length) {
      const n = gmAutoFill(arrGuests, true);
      if (n > 0 && typeof arrRender === 'function') arrRender();
    }
    if (typeof purposeGuests !== 'undefined' && purposeGuests.length) {
      const n = gmAutoFill(purposeGuests, true);
      if (n > 0 && typeof purposeRender === 'function') purposeRender();
    }
  });
}

// ── Debounced Firebase save ───────────────────────────────
// Longer debounce (2 s) so rapid typing doesn't spam Firebase.
function _gmPersist() {
  clearTimeout(_gmSaveTimer);
  _gmSaveTimer = setTimeout(async () => {
    try { await fbSet('guestMemory', _gmStore); }
    catch (e) { console.warn('[GuestMemory] save failed:', e); }
  }, 2000);
}

// ── Auto-fill (read-only — never writes to Firebase) ──────
function gmAutoFill(guests, silent) {
  if (!_gmReady || !guests || !guests.length) return 0;
  let filled = 0;
  guests.forEach(g => {
    const profile = _gmStore[gmKey(g.name)];
    if (!profile) return;
    let changed = false;
    if (!g.nat    || g.nat   === '')             { g.nat     = profile.nat     || g.nat;     changed = true; }
    if (!g.email  || g.email === 'No@email.com') { g.email   = profile.email   || g.email;   changed = true; }
    if (!g.purpose|| g.purpose=== 'Business')    { g.purpose = profile.purpose || g.purpose; changed = true; }
    if (changed) { filled++; g._fromMemory = true; }
  });
  if (filled && !silent) showToast(`✦ ${filled} guest${filled !== 1 ? 's' : ''} auto-filled from memory`, 'info');
  return filled;
}

// ── Edit handler — called by onchange on table inputs ─────
// NEVER re-renders the table. Patches _gmStore and updates
// only the stats bar. Firebase save is debounced 2 s.
function gmOnEdit(name, field, value) {
  const key = gmKey(name);
  if (!_gmStore[key]) _gmStore[key] = { nat:'', email:'', purpose:'Business', hits:0, lastSeen:'' };
  _gmStore[key][field]   = value;
  _gmStore[key].lastSeen = new Date().toISOString().split('T')[0];
  // Count hits only for nat/email — intentional user edits
  if (field === 'nat' || field === 'email') {
    _gmStore[key].hits = (_gmStore[key].hits || 0) + 1;
    // Patch the hits badge in-place so the number updates without re-render
    const row = document.querySelector(`[data-gmkey="${CSS.escape(key)}"]`);
    if (row) {
      const badge = row.querySelector('.gm-hit-badge');
      if (badge) badge.textContent = _gmStore[key].hits + '×';
    }
  }
  _gmUpdateStatsOnly();
  _gmPersist();
  // No _gmRenderTable() call here — ever.
}

// ── Bulk scan ─────────────────────────────────────────────
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

// ── Save full profile ─────────────────────────────────────
function gmSaveProfile(g) {
  if (!g || !g.name) return;
  const key = gmKey(g.name), ex = _gmStore[key] || {};
  _gmStore[key] = {
    nat:      g.nat     || ex.nat     || '',
    email:    g.email   || ex.email   || '',
    purpose:  g.purpose || ex.purpose || 'Business',
    conf:     g.conf    || ex.conf    || '',
    hits:     (ex.hits  || 0) + 1,
    lastSeen: new Date().toISOString().split('T')[0],
  };
  _gmPersist();
}

// ── Lookup ────────────────────────────────────────────────
function gmLookup(name) { return _gmStore[gmKey(name)] || null; }

// ── Delete ────────────────────────────────────────────────
function gmDeleteProfile(name) {
  const key = gmKey(name);
  if (!_gmStore[key]) return;
  delete _gmStore[key];
  _gmPersist();
  _gmRenderTable();
  showToast('Profile deleted', 'info');
}

// ── Clear all ─────────────────────────────────────────────
function gmClearAll() {
  if (!confirm('Clear ALL guest memory profiles? This cannot be undone.')) return;
  _gmStore = {};
  _gmPersist();
  _gmRenderTable();
  showToast('Guest memory cleared', 'info');
}

// ── Stats bar only (no DOM table changes) ─────────────────
function _gmUpdateStatsOnly() {
  const entries   = Object.entries(_gmStore);
  const total     = entries.length;
  const withNat   = entries.filter(([,p]) => p.nat   && p.nat   !== '').length;
  const withEmail = entries.filter(([,p]) => p.email && p.email !== '' && p.email !== 'No@email.com').length;
  const totalHits = entries.reduce((s,[,p]) => s + (p.hits || 0), 0);
  const badge = document.getElementById('badge-guestmem');
  if (badge) badge.textContent = total || '0';
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('gm-count', total); set('gm-with-nat', withNat);
  set('gm-with-email', withEmail); set('gm-total-hits', totalHits);
}

// ── Full UI update (stats + table) ───────────────────────
function _gmUpdateUI() {
  _gmUpdateStatsOnly();
  _gmRenderTable();
}

// ── Render table ──────────────────────────────────────────
// Uses onchange (fires on blur/Enter) NOT oninput (fires on every keystroke).
// Each row gets data-gmkey so gmOnEdit can patch the badge in-place.
// _gmRenderTable() is NEVER called from gmOnEdit — only from:
//   · Initial load / Firebase listener (when user is NOT editing)
//   · Delete / Clear / Import / Search
function _gmRenderTable() {
  const tbody = document.getElementById('gmTable');
  if (!tbody) return;
  const search  = (document.getElementById('gmSearch')?.value || '').toLowerCase();
  const entries = Object.entries(_gmStore)
    .filter(([k]) => !search || k.toLowerCase().includes(search))
    .sort((a, b) => (b[1].hits || 0) - (a[1].hits || 0));

  const count = document.getElementById('gmProfileCount');
  if (count) count.textContent = entries.length + ' profiles';

  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:36px;font-family:var(--mono);font-size:0.7rem;color:var(--text3);">
      No profiles yet. Nationality and email are saved automatically as you enter them.</td></tr>`;
    return;
  }

  tbody.innerHTML = entries.map(([key, p]) => `
    <tr data-gmkey="${key.replace(/"/g,'&quot;')}">
      <td style="font-weight:500;color:var(--text);font-size:0.72rem;">${key}</td>
      <td>
        <input class="gm-inline-inp" value="${(p.nat||'').replace(/"/g,'&quot;')}"
          onchange="gmOnEdit('${key.replace(/'/g,"\\'")}','nat',this.value)"
          placeholder="—" style="width:90px;"/>
      </td>
      <td>
        <input class="gm-inline-inp" value="${(p.email||'').replace(/"/g,'&quot;')}"
          onchange="gmOnEdit('${key.replace(/'/g,"\\'")}','email',this.value)"
          placeholder="—" style="width:160px;"/>
      </td>
      <td>
        <select class="gm-inline-inp"
          onchange="gmOnEdit('${key.replace(/'/g,"\\'")}','purpose',this.value)"
          style="width:90px;">
          ${['Business','Leisure','Flight'].map(v =>
            `<option${(p.purpose||'Business')===v?' selected':''}>${v}</option>`).join('')}
        </select>
      </td>
      <td style="font-family:var(--mono);font-size:0.62rem;color:var(--text3);">
        ${p.hits ? `<span class="gm-hit-badge">${p.hits}×</span>` : '—'}
        <span style="margin-left:4px;">${p.lastSeen||''}</span>
      </td>
      <td>
        <button class="icon-btn" onclick="gmDeleteProfile('${key.replace(/'/g,"\\'")}'')"
          title="Delete" style="color:var(--rose);">✕</button>
      </td>
    </tr>`).join('');
}

// ── Export CSV ────────────────────────────────────────────
function gmExport() {
  const rows = [['Name','Nationality','Email','Purpose','Seen','Last Seen']];
  Object.entries(_gmStore).forEach(([k,p]) =>
    rows.push([k, p.nat||'', p.email||'', p.purpose||'', p.hits||0, p.lastSeen||'']));
  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv' });
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
        hits:parseInt(parts[4])||1, lastSeen:parts[5]||'',
      };
      count++;
    });
    _gmPersist(); _gmRenderTable();
    showToast(`${count} profiles imported ✓`, 'ok');
  };
  reader.readAsText(file);
}

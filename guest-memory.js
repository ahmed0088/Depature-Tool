// ═══════════════════════════════════════════════════════════
//  guest-memory.js  —  Guest Profile Memory Store
//
//  PURPOSE:
//  Remembers nationality, email, and purpose-of-stay for
//  returning guests. Next time the same guest appears, their
//  data is auto-filled — no re-entering needed.
//
//  HOW IT WORKS:
//  · Key = cleaned guest name (uppercase, normalised)
//  · On every load, scans arrivals/purpose list and fills
//    any blank nat/email from the memory store
//  · When you edit nat or email in the table, the profile
//    is updated automatically (debounced 1.5s)
//  · Data lives in Firebase at: hotels/ibis_dubai/guestMemory
//    (shared across all colleagues on same shift)
//
//  FIX NOTES:
//  · fbListen callback now retroactively fills any guests
//    already loaded before Firebase responded (_gmReady race)
//  · gmAutoFill is called AFTER runAINat in arrivals-purpose.js
//    so memory values always beat AI-guessed values
// ═══════════════════════════════════════════════════════════

// ── In-memory cache ───────────────────────────────────────
let _gmStore   = {};   // { "JOHN SMITH": { nat, email, purpose, conf, hits, lastSeen } }
let _gmReady   = false;
let _gmSaveTimer = null;

// ── Key normaliser ────────────────────────────────────────
function gmKey(name) {
  return String(name || '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Init: load from Firebase once, then keep live ─────────
function gmInit() {
  if (typeof fbListen !== 'function') {
    console.warn('[GuestMemory] fbListen not available — memory disabled');
    return;
  }
  fbListen('guestMemory', snap => {
    _gmStore = snap || {};
    _gmReady = true;
    _gmUpdateUI();
    console.log(`[GuestMemory] loaded — ${Object.keys(_gmStore).length} profiles`);

    // ── FIX: self-healing fill ────────────────────────────
    // If Firebase was slow and guests were already loaded before
    // _gmReady became true, retroactively fill them now.
    let didFill = false;
    if (typeof arrGuests !== 'undefined' && arrGuests.length) {
      const n = gmAutoFill(arrGuests);
      if (n > 0) { didFill = true; if (typeof arrRender === 'function') arrRender(); }
    }
    if (typeof purposeGuests !== 'undefined' && purposeGuests.length) {
      const n = gmAutoFill(purposeGuests);
      if (n > 0) { didFill = true; if (typeof purposeRender === 'function') purposeRender(); }
    }
  });
}

// ── Save entire store to Firebase (debounced) ─────────────
function _gmPersist() {
  clearTimeout(_gmSaveTimer);
  _gmSaveTimer = setTimeout(async () => {
    try {
      await fbSet('guestMemory', _gmStore);
    } catch (e) {
      console.warn('[GuestMemory] save failed:', e);
    }
  }, 1500);
}

// ── Auto-fill: call after loading any guest list ──────────
// Returns count of guests that were auto-filled
function gmAutoFill(guests) {
  if (!_gmReady || !guests || !guests.length) return 0;
  let filled = 0;
  guests.forEach(g => {
    const key     = gmKey(g.name);
    const profile = _gmStore[key];
    if (!profile) return;

    let changed = false;
    if (!g.nat   || g.nat   === '')             { g.nat     = profile.nat     || g.nat;     changed = true; }
    if (!g.email || g.email === 'No@email.com') { g.email   = profile.email   || g.email;   changed = true; }
    if (!g.purpose || g.purpose === 'Business') { g.purpose = profile.purpose || g.purpose; changed = true; }
    if (changed) {
      filled++;
      // Bump hit counter and last seen
      profile.hits     = (profile.hits || 0) + 1;
      profile.lastSeen = new Date().toISOString().split('T')[0];
      g._fromMemory    = true;   // flag for visual indicator (blue border)
    }
  });
  if (filled) {
    _gmPersist();
    showToast(`✦ ${filled} guest${filled !== 1 ? 's' : ''} auto-filled from memory`, 'info');
  }
  return filled;
}

// ── Called when user edits nat or email in the table ──────
// Upserts the profile for that guest name
function gmOnEdit(name, field, value) {
  if (!name || !value) return;
  const key = gmKey(name);
  if (!_gmStore[key]) {
    _gmStore[key] = { nat:'', email:'', purpose:'Business', hits:0, lastSeen:'' };
  }
  _gmStore[key][field]   = value;
  _gmStore[key].lastSeen = new Date().toISOString().split('T')[0];
  _gmPersist();
}

// ── Bulk scan: save all loaded guests to memory ───────────
// Call from Arrivals or Purpose panel to seed memory instantly.
function gmScanAndSaveAll() {
  const lists = [];
  if (typeof arrGuests     !== 'undefined' && arrGuests.length)     lists.push(...arrGuests);
  if (typeof purposeGuests !== 'undefined' && purposeGuests.length) lists.push(...purposeGuests);

  if (!lists.length) {
    showToast('No guests loaded — load Arrivals or Purpose first', 'err');
    return;
  }

  let saved = 0, updated = 0;
  lists.forEach(g => {
    if (!g.name || g.name === '—') return;
    const key      = gmKey(g.name);
    const existing = _gmStore[key] || {};
    const isNew    = !_gmStore[key];
    _gmStore[key] = {
      nat:      (g.nat   && g.nat   !== '')             ? g.nat   : (existing.nat   || ''),
      email:    (g.email && g.email !== 'No@email.com') ? g.email : (existing.email || ''),
      purpose:  g.purpose  || existing.purpose  || 'Business',
      conf:     g.conf     || existing.conf     || '',
      hits:     existing.hits || 0,
      lastSeen: existing.lastSeen || new Date().toISOString().split('T')[0],
    };
    if (isNew) saved++; else updated++;
  });

  _gmPersist();
  _gmUpdateUI();
  showToast(`🧠 ${saved} new · ${updated} updated in memory`, 'ok');
}

// ── Save a full guest profile at once ─────────────────────
function gmSaveProfile(g) {
  if (!g || !g.name) return;
  const key = gmKey(g.name);
  const existing = _gmStore[key] || {};
  _gmStore[key] = {
    nat:      g.nat     || existing.nat     || '',
    email:    g.email   || existing.email   || '',
    purpose:  g.purpose || existing.purpose || 'Business',
    conf:     g.conf    || existing.conf    || '',
    hits:     (existing.hits || 0) + 1,
    lastSeen: new Date().toISOString().split('T')[0],
  };
  _gmPersist();
}

// ── Lookup a single guest ─────────────────────────────────
function gmLookup(name) {
  return _gmStore[gmKey(name)] || null;
}

// ── Delete a profile ──────────────────────────────────────
function gmDeleteProfile(name) {
  const key = gmKey(name);
  if (!_gmStore[key]) return;
  delete _gmStore[key];
  _gmPersist();
  _gmRenderTable();
  showToast('Profile deleted', 'info');
}

// ── Clear entire memory ───────────────────────────────────
function gmClearAll() {
  if (!confirm('Clear ALL guest memory profiles? This cannot be undone.')) return;
  _gmStore = {};
  _gmPersist();
  _gmRenderTable();
  showToast('Guest memory cleared', 'info');
}

// ── Update panel UI ───────────────────────────────────────
function _gmUpdateUI() {
  const entries   = Object.entries(_gmStore);
  const total     = entries.length;
  const withNat   = entries.filter(([,p]) => p.nat   && p.nat   !== '').length;
  const withEmail = entries.filter(([,p]) => p.email && p.email !== '' && p.email !== 'No@email.com').length;
  const totalHits = entries.reduce((s,[,p]) => s + (p.hits || 0), 0);

  const badge = document.getElementById('badge-guestmem');
  if (badge) badge.textContent = total || '0';

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('gm-count',      total);
  set('gm-with-nat',   withNat);
  set('gm-with-email', withEmail);
  set('gm-total-hits', totalHits);

  _gmRenderTable();
}

// ── Render the memory panel table ─────────────────────────
function _gmRenderTable() {
  const tbody  = document.getElementById('gmTable');
  if (!tbody) return;
  const search = (document.getElementById('gmSearch')?.value || '').toLowerCase();
  const entries = Object.entries(_gmStore)
    .filter(([k]) => !search || k.toLowerCase().includes(search))
    .sort((a, b) => (b[1].hits || 0) - (a[1].hits || 0));

  const count = document.getElementById('gmProfileCount');
  if (count) count.textContent = entries.length + ' profiles';

  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:36px;font-family:var(--mono);font-size:0.7rem;color:var(--text3);">
      No profiles stored yet. Nationality and email are saved automatically as you enter them.
    </td></tr>`;
    return;
  }

  tbody.innerHTML = entries.map(([key, p]) => `
    <tr>
      <td style="font-weight:500;color:var(--text);font-size:0.72rem;">${key}</td>
      <td>
        <input class="gm-inline-inp" value="${p.nat || ''}"
          onchange="gmOnEdit('${key}','nat',this.value);_gmRenderTable()"
          placeholder="—" style="width:90px;"/>
      </td>
      <td>
        <input class="gm-inline-inp" value="${p.email || ''}"
          onchange="gmOnEdit('${key}','email',this.value);_gmRenderTable()"
          placeholder="—" style="width:160px;"/>
      </td>
      <td>
        <select class="gm-inline-inp" onchange="gmOnEdit('${key}','purpose',this.value);_gmRenderTable()" style="width:90px;">
          ${['Business','Leisure','Flight'].map(v => `<option${(p.purpose||'Business')===v?' selected':''}>${v}</option>`).join('')}
        </select>
      </td>
      <td style="font-family:var(--mono);font-size:0.62rem;color:var(--text3);">
        ${p.hits ? `<span class="gm-hit-badge">${p.hits}×</span>` : '—'}
        <span style="margin-left:4px;">${p.lastSeen || ''}</span>
      </td>
      <td>
        <button class="icon-btn" onclick="gmDeleteProfile('${key}')" title="Delete profile" style="color:var(--rose);">✕</button>
      </td>
    </tr>`).join('');
}

// ── Export memory as CSV ──────────────────────────────────
function gmExport() {
  const rows = [['Name','Nationality','Email','Purpose','Seen','Last Seen']];
  Object.entries(_gmStore).forEach(([k, p]) => {
    rows.push([k, p.nat||'', p.email||'', p.purpose||'', p.hits||0, p.lastSeen||'']);
  });
  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'guest_memory_' + new Date().toISOString().split('T')[0] + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Memory exported ✓', 'ok');
}

// ── Import memory from CSV ────────────────────────────────
function gmImportFile(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const lines = e.target.result.split('\n').slice(1); // skip header
    let count = 0;
    lines.forEach(line => {
      if (!line.trim()) return;
      const parts = line.split(',').map(p => p.replace(/^"|"$/g,'').trim());
      if (!parts[0]) return;
      const key = gmKey(parts[0]);
      _gmStore[key] = {
        nat:      parts[1] || '',
        email:    parts[2] || '',
        purpose:  parts[3] || 'Business',
        hits:     parseInt(parts[4]) || 1,
        lastSeen: parts[5] || '',
      };
      count++;
    });
    _gmPersist();
    _gmRenderTable();
    showToast(`${count} profiles imported ✓`, 'ok');
  };
  reader.readAsText(file);
}

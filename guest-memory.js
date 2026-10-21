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
//
//  PASSWORD PROTECTION:
//  · A panel-level password is stored in Firebase under
//    hotels/{HOTEL_ID}/settings/gmPassword (hashed with SHA-256).
//  · Owner / Manager can set or change it via the lock button.
//  · Once unlocked, the session stays open for 30 minutes,
//    then the panel re-locks automatically.
//  · gmAutoFill() always works regardless of lock state —
//    it only fills blanks on import and never exposes the table.
// ═══════════════════════════════════════════════════════════

let _gmStore     = {};
let _gmReady     = false;
let _gmSaveTimer = null;
// Auto-fill toggle — persisted in localStorage so it survives page refresh
let _gmAutoFillOn = localStorage.getItem('gm_autofill') !== 'off';

// ── Password / lock state ─────────────────────────────────
let _gmUnlocked      = false;   // true = panel is currently accessible
let _gmLockTimer     = null;    // auto-lock timeout handle
const GM_LOCK_MINS   = 30;      // session duration before auto-relock

// ── SHA-256 helper (Web Crypto API) ──────────────────────
async function _gmHash(str) {
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── Load stored password hash from Firebase ───────────────
async function _gmGetStoredHash() {
  try {
    const snap = await firebase.database().ref(`hotels/${HOTEL_ID}/settings/gmPassword`).once('value');
    return snap.val() || null;
  } catch(e) { return null; }
}

// ── Save password hash to Firebase ───────────────────────
async function _gmSetPassword(hash) {
  try {
    await firebase.database().ref(`hotels/${HOTEL_ID}/settings/gmPassword`).set(hash);
  } catch(e) { showToast('Failed to save password', 'err'); }
}

// ── Render the lock / unlock overlay ─────────────────────
function _gmRenderLockState() {
  const overlay  = document.getElementById('gmLockOverlay');
  const content  = document.getElementById('gmPanelContent');
  const lockBtn  = document.getElementById('gmLockBtn');
  if (!overlay || !content) return;

  if (_gmUnlocked) {
    overlay.style.display  = 'none';
    content.style.display  = '';
    if (lockBtn) {
      lockBtn.textContent = '🔒 Lock';
      lockBtn.title       = 'Lock Guest Memory panel';
    }
  } else {
    overlay.style.display  = 'flex';
    content.style.display  = 'none';
    if (lockBtn) {
      lockBtn.textContent = '🔑 Unlock';
      lockBtn.title       = 'Unlock Guest Memory panel';
    }
  }
}

// ── Owner override — the account login already proves who they are, so
// an owner should never have to also type the panel password ───────────
function _gmIsOwner() {
  return typeof currentProfile !== 'undefined' && currentProfile?.role === 'owner';
}
// called after sign-in (auth.js): only refreshes the lock card — the owner opens it with Face ID (gmUnlock)
function _gmApplyOwnerAutoUnlock() { try { _gmFaceRender(); } catch (_) {} }

// ── Try unlocking: prompt for password, verify, open ─────
async function gmUnlock() {
  if (!_gmIsOwner()) { showToast('Only the owner can open Guest Memory (with Face ID)', 'err'); return; }
  if (_gmFaceOn()) { await gmFaceCheck(); return; }
  // the owner's first time on this phone: saving their Face ID is the unlock
  await gmFaceEnable(true);
}
/** the panel is open for GM_LOCK_MINS (how: 'Face ID') */
function _gmOpenSession(how) {
  _gmUnlocked = true;
  clearTimeout(_gmLockTimer);
  _gmLockTimer = setTimeout(() => {
    _gmUnlocked = false;
    _gmRenderLockState();
    showToast('Guest Memory locked (session expired)', 'info');
  }, GM_LOCK_MINS * 60 * 1000);
  _gmRenderLockState();
  _gmUpdateUI();
  showToast(`✓ Guest Memory unlocked with ${how} · auto-locks in ${GM_LOCK_MINS} min`, 'ok');
  if (typeof logActivity === 'function') logActivity('guestmem_unlock', how);
  _gmFaceRender();
}

// ── Manual lock ───────────────────────────────────────────
function gmLock() {
  if (!_gmUnlocked) return;
  _gmUnlocked = false;
  clearTimeout(_gmLockTimer);
  _gmRenderLockState();
  showToast('Guest Memory locked', 'info');
}

// ── Toggle lock / unlock from header button ───────────────
function gmToggleLock() {
  if (_gmUnlocked) gmLock();
  else {
    // Just show the overlay — user types password there
    _gmRenderLockState();
  }
}

// ── Set / change password (owner + manager only) ──────────
async function gmSetPassword() {
  const role = (typeof currentProfile !== 'undefined' && currentProfile?.role) || '';
  if (role !== 'owner' && role !== 'manager') {
    showToast('Only owners and managers can set the Guest Memory password', 'err');
    return;
  }

  const storedHash = await _gmGetStoredHash();
  const overlay    = document.getElementById('gmChangePwOverlay');
  if (overlay) {
    // Show the change-password UI inside the panel
    overlay.style.display = 'flex';
    document.getElementById('gmCpOldWrap').style.display = storedHash ? '' : 'none';
    const firstInput = storedHash
      ? document.getElementById('gmCpOld')
      : document.getElementById('gmCpNew');
    if (firstInput) { firstInput.value = ''; firstInput.focus(); }
    if (document.getElementById('gmCpNew'))    document.getElementById('gmCpNew').value    = '';
    if (document.getElementById('gmCpNewConf'))document.getElementById('gmCpNewConf').value = '';
    return;
  }

  // Fallback: prompt-based flow (if HTML overlay not present)
  if (storedHash) {
    const old = prompt('Enter current password to confirm:');
    if (old === null) return;
    const oldHash = await _gmHash(old.trim());
    if (oldHash !== storedHash) { showToast('Current password incorrect', 'err'); return; }
  }
  const np  = prompt(storedHash ? 'Enter new password:' : 'Set Guest Memory password:');
  if (!np || !np.trim()) return;
  const np2 = prompt('Confirm new password:');
  if (np.trim() !== np2?.trim()) { showToast('Passwords do not match', 'err'); return; }
  const hash = await _gmHash(np.trim());
  await _gmSetPassword(hash);
  showToast(storedHash ? 'Password changed ✓' : 'Password set ✓', 'ok');
  if (typeof logActivity === 'function') logActivity('guestmem_password_change', '');
}

// ── Confirm password change (from the inline UI) ──────────
async function gmConfirmChangePw() {
  const storedHash = await _gmGetStoredHash();
  const oldEl      = document.getElementById('gmCpOld');
  const newEl      = document.getElementById('gmCpNew');
  const confEl     = document.getElementById('gmCpNewConf');

  if (storedHash) {
    const oldVal = (oldEl?.value || '').trim();
    if (!oldVal) { showToast('Enter current password', 'err'); return; }
    const oldHash = await _gmHash(oldVal);
    if (oldHash !== storedHash) {
      showToast('Current password is incorrect', 'err');
      if (oldEl) { oldEl.value = ''; oldEl.focus(); }
      return;
    }
  }

  const np  = (newEl?.value  || '').trim();
  const np2 = (confEl?.value || '').trim();
  if (!np)       { showToast('Enter a new password', 'err'); return; }
  if (np.length < 4) { showToast('Password must be at least 4 characters', 'err'); return; }
  if (np !== np2) { showToast('Passwords do not match', 'err'); return; }

  const hash = await _gmHash(np);
  await _gmSetPassword(hash);
  gmClosePwOverlay();
  showToast(storedHash ? '🔑 Password changed ✓' : '🔑 Password set ✓', 'ok');
  if (typeof logActivity === 'function') logActivity('guestmem_password_change', '');
}

function gmClosePwOverlay() {
  const overlay = document.getElementById('gmChangePwOverlay');
  if (overlay) overlay.style.display = 'none';
}

function gmKey(name) {
  // the database refuses . # $ [ ] / in a key ("JOHN A. SMITH"): one bad key would stop every later save
  return String(name || '').toUpperCase().replace(/[.#$\[\]\/]/g, ' ').replace(/\s+/g, ' ').trim();
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
  if (typeof firebase === 'undefined' || !firebase.database) {
    console.warn('[GuestMemory] firebase not available');
    return;
  }
  // One-time cleanup: older versions mirrored this into localStorage via
  // fbListen()/lsSave() before every page load, regardless of lock state.
  // Purge that leftover plaintext copy now that it's no longer written.
  try { localStorage.removeItem('ibis_guestMemory'); } catch(e) {}
  // Render toggle to correct state as soon as DOM is ready
  setTimeout(_gmRenderToggle, 0);
  // Render lock state — panel starts locked on every page load
  setTimeout(async () => {
    _gmRenderLockState();
    // Owner is already authenticated at the account level — no separate
    // panel password needed. (Also re-applied right after login in auth.js,
    // since currentProfile usually isn't populated yet this early at boot.)
    if (_gmIsOwner()) { _gmApplyOwnerAutoUnlock(); return; }
  }, 0);

  // Deliberately NOT using db.js's fbListen() here — it mirrors every path
  // into localStorage (for offline fallback) via lsSave(), which would leave
  // the entire guest email/nationality store in plaintext on disk regardless
  // of this panel's lock state, undoing the whole point of hiding/locking it.
  // A raw listener keeps the same "always loaded, lock only gates the UI"
  // behavior gmAutoFill() depends on, but keeps the data in memory only.
  if (typeof firebase !== 'undefined' && firebase.database) {
    // bring this hotel's old separate memory in, once someone is signed in
    // (the shared memory is only readable once signed in: a listener started on the login screen is refused and cancelled for good)
    const _gmWaitLogin = setInterval(() => { if (typeof currentUser !== 'undefined' && currentUser) { clearInterval(_gmWaitLogin); _gmMigrateToShared(); _gmListen(); } }, 1500);
    const _gmListen = () => firebase.database().ref(GM_SHARED_PATH).on('value', snap => {
      // an edit still waiting to be saved (3 s) stays on top of what another hotel just saved
      const mine = {};
      if (_gmSaveTimer) { Object.keys(_gmStore).forEach(k => { if (JSON.stringify(_gmStore[k]) !== JSON.stringify(_gmServer[k])) mine[k] = _gmStore[k]; }); Object.keys(_gmServer).forEach(k => { if (!(k in _gmStore)) mine[k] = null; }); }
      const fresh = snap.val() || {};
      _gmServer = JSON.parse(JSON.stringify(fresh));
      Object.keys(mine).forEach(k => { if (mine[k] === null) delete fresh[k]; else fresh[k] = mine[k]; });
      _gmStore = fresh;
      _gmReady = true;
      if (!_gmUnlocked) return;  // don't touch DOM if locked
      const tbl     = document.getElementById('gmTable');
      const editing = tbl && tbl.contains(document.activeElement);
      if (!editing) _gmUpdateUI();
      else          _gmUpdateStatsOnly();
      _gmRenderToggle();
    });
  }
}

// ── One Guest Memory for every hotel ──────────────────────
// A guest remembered at one hotel is recognised at all of them. Saves send
// only the guests that changed, so two hotels saving at once never
// overwrite each other's additions. (The panel password stays per hotel.)
const GM_SHARED_PATH = 'guestMemoryShared';
let _gmServer = {};   // last copy received from the database, to work out what changed

// Bring this hotel's older, separate memory into the shared one (once per hotel).
async function _gmMigrateToShared() {
  try {
    const db = firebase.database();
    const flag = db.ref(`hotels/${HOTEL_ID}/settings/gmShared`);
    if ((await flag.once('value')).val()) return;
    const own = (await db.ref(`hotels/${HOTEL_ID}/guestMemory`).once('value')).val() || {};
    const shared = (await db.ref(GM_SHARED_PATH).once('value')).val() || {};
    const patch = {};
    Object.entries(own).forEach(([k, v]) => {
      const s = shared[k];
      if (!s || String(v.lastSeen || '') > String(s.lastSeen || '')) patch[k] = Object.assign({}, s || {}, v, { hits: Math.max(+(s && s.hits) || 0, +v.hits || 0) });
    });
    if (Object.keys(patch).length) await db.ref(GM_SHARED_PATH).update(patch);
    await flag.set(new Date().toISOString());
    console.log('[GuestMemory] merged', Object.keys(patch).length, 'guests into the shared memory');
  } catch (e) { console.warn('[GuestMemory] merge into shared memory failed:', e); }
}

// ── Debounced Firebase save ───────────────────────────────
// Also bypasses fbSet() / localStorage mirroring — see note above.
function _gmPersist() {
  clearTimeout(_gmSaveTimer);
  _gmSaveTimer = setTimeout(_gmPersistNow, 3000);
}
async function _gmPersistNow() {
  clearTimeout(_gmSaveTimer);
  {
    const patch = {};
    Object.keys(_gmStore).forEach(k => { if (JSON.stringify(_gmStore[k]) !== JSON.stringify(_gmServer[k])) patch[k] = _gmStore[k]; });
    Object.keys(_gmServer).forEach(k => { if (!(k in _gmStore)) patch[k] = null; });
    if (!Object.keys(patch).length) return;
    try { await firebase.database().ref(GM_SHARED_PATH).update(patch); Object.assign(_gmServer, JSON.parse(JSON.stringify(patch))); Object.keys(patch).forEach(k => { if (patch[k] === null) delete _gmServer[k]; }); }
    catch (e) { console.warn('[GuestMemory] save failed:', e); }
  }
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
    if (!g.nat    || g.nat    === '')             { if (profile.nat)           { g.nat           = profile.nat;           hit = true; } }
    if (!g.email  || g.email  === 'No@email.com') { if (profile.email)         { g.email         = profile.email;         hit = true; } }
    if (!g.purpose|| g.purpose=== 'Business')     { if (profile.purpose)       { g.purpose       = profile.purpose;       hit = true; } }
    if (!g.originOfTravel || g.originOfTravel === '') { if (profile.originOfTravel) { g.originOfTravel = profile.originOfTravel; hit = true; } }
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
  _gmStore[key].lastSeen = hoLocalISO();
  _gmUpdateStatsOnly();
  _gmPersist();
}

// ── "Save to Memory" button ───────────────────────────────
function gmScanAndSaveAll() {
  if (!_gmUnlocked) { showToast('Unlock Guest Memory first 🔒', 'err'); return; }
  gmCancelAutoSave();
  const r = _gmMergeLoaded();
  if (!r) { showToast('No guests loaded — load Arrivals or Purpose first', 'err'); return; }
  _gmPersist();
  _gmUpdateUI();
  showToast(`🧠 ${r.saved} new · ${r.updated} updated in memory`, 'ok');
}

// ── Auto-save after Import Emails ─────────────────────────
// After emails are imported, wait a little (time to fix a wrong email) and
// then save everyone to Guest Memory, unless "Save to Memory" was clicked.
// Leaving the page or the app saves straight away instead of waiting.
const GM_AUTOSAVE_MS = 120000;
let _gmAutoT = null;
function gmScheduleAutoSave(quiet) {
  clearTimeout(_gmAutoT);
  _gmAutoT = setTimeout(() => gmAutoSaveNow(quiet ? 'quiet' : 'timer'), GM_AUTOSAVE_MS);
  if (!quiet) showToast('📧 Emails imported — they go into Guest Memory automatically in 2 minutes (or tap 🧠 Save to Memory now)', 'ok');
}
function gmCancelAutoSave() { clearTimeout(_gmAutoT); _gmAutoT = null; }
function gmAutoSaveNow(why) {
  if (!_gmAutoT && why !== 'force') return;
  gmCancelAutoSave();
  if (!_gmReady) return;
  const r = _gmMergeLoaded();
  if (!r) return;
  _gmPersistNow();
  if (_gmUnlocked) _gmUpdateUI();
  if (why === 'timer') showToast(`🧠 Saved to Guest Memory: ${r.saved} new · ${r.updated} updated`, 'ok');
  if (typeof logActivity === 'function') try { logActivity('guestmem_autosave', `${r.saved} new · ${r.updated} updated`); } catch (_) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') gmAutoSaveNow('leave'); });
window.addEventListener('pagehide', () => gmAutoSaveNow('leave'));

/** Put every loaded arrival / Purpose guest into the memory (no saving yet). */
function _gmMergeLoaded() {
  const lists = [];
  if (typeof arrGuests     !== 'undefined' && arrGuests.length)     lists.push(...arrGuests);
  if (typeof purposeGuests !== 'undefined' && purposeGuests.length) lists.push(...purposeGuests);
  if (!lists.length) return null;

  let saved = 0, updated = 0;
  lists.forEach(g => {
    if (!g.name || g.name === '—') return;
    const key = gmKey(g.name), ex = _gmStore[key] || {}, isNew = !_gmStore[key];
    _gmStore[key] = {
      nat:            (g.nat   && g.nat   !== '')             ? g.nat   : (ex.nat   || ''),
      email:          (g.email && g.email !== 'No@email.com') ? g.email : (ex.email || ''),
      purpose:        g.purpose        || ex.purpose        || 'Business',
      conf:           g.conf           || ex.conf           || '',
      originOfTravel: g.originOfTravel || ex.originOfTravel || '',
      hits:           ex.hits    || 0,
      lastSeen:       ex.lastSeen|| hoLocalISO(),
    };
    if (isNew) saved++; else updated++;
  });
  return { saved, updated };
}

function gmLookup(name) { return _gmStore[gmKey(name)] || null; }

function gmDeleteProfile(name) {
  if (!_gmUnlocked) { showToast('Unlock Guest Memory first 🔒', 'err'); return; }
  const key = gmKey(name);
  if (!_gmStore[key]) return;
  delete _gmStore[key];
  _gmPersist();
  _gmRenderTable();
  showToast('Profile deleted', 'info');
}

function gmClearAll() {
  if (!_gmUnlocked) { showToast('Unlock Guest Memory first 🔒', 'err'); return; }
  // Guest Memory is shared by every hotel: only an owner may empty it, and must say so twice
  if (!(typeof currentProfile !== 'undefined' && currentProfile && currentProfile.role === 'owner')) { showToast('Only an owner can clear Guest Memory — it is shared by every hotel', 'err'); return; }
  if (!confirm('Clear ALL guest memory profiles?\n\nGuest Memory is shared by EVERY hotel on HotelOps — this empties it for all of them. This cannot be undone.')) return;
  if (prompt('Type CLEAR to empty Guest Memory for every hotel:') !== 'CLEAR') { showToast('Nothing was cleared', 'info'); return; }
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
let _gmRenderT = null;
function _gmRenderSoon() { clearTimeout(_gmRenderT); _gmRenderT = setTimeout(_gmRenderTable, 200); }   // while typing a search
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
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:36px;
      font-family:var(--mono);font-size:0.7rem;color:var(--text3);">
      No profiles yet. Load guests then click "Save to Memory".</td></tr>`;
    return;
  }

  // the memory is shared by every hotel: show at most 500 rows (search to find the rest)
  const more = entries.length - 500;
  tbody.innerHTML = entries.slice(0, 500).map(([key, p]) => {
    const ek = escapeHtml(key.replace(/\\/g,'\\\\').replace(/'/g,"\\'"));
    return `
    <tr>
      <td style="font-weight:500;color:var(--text);font-size:0.72rem;">${escapeHtml(key)}</td>
      <td>
        <input class="gm-inline-inp" value="${escapeHtml(p.nat||'')}"
          onchange="gmOnEdit('${ek}','nat',this.value)"
          placeholder="—" style="width:90px;"/>
      </td>
      <td>
        <input class="gm-inline-inp" value="${escapeHtml(p.email||'')}"
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
      <td>
        <input class="gm-inline-inp" value="${(p.originOfTravel||'').replace(/"/g,'&quot;')}"
          onchange="gmOnEdit('${ek}','originOfTravel',this.value)"
          placeholder="—" style="width:100px;"/>
      </td>
      <td style="font-family:var(--mono);font-size:0.62rem;color:var(--text3);">
        ${p.lastSeen || '—'}
      </td>
      <td>
        <button class="icon-btn" onclick="gmDeleteProfile('${ek}')"
          title="Delete" style="color:var(--rose);">✕</button>
      </td>
    </tr>`;
  }).join('') + (more > 0 ? `<tr><td colspan="7" style="text-align:center;padding:14px;font-family:var(--mono);font-size:0.68rem;color:var(--text3);">${more} more — type a name in Search to find them</td></tr>` : '');
}

// ── Export CSV ────────────────────────────────────────────
function gmExport() {
  if (!_gmUnlocked) { showToast('Unlock Guest Memory first 🔒', 'err'); return; }
  const rows = [['Name','Nationality','Email','Purpose','Origin of Travel','Last Seen']];
  Object.entries(_gmStore).forEach(([k,p]) =>
    rows.push([k, p.nat||'', p.email||'', p.purpose||'', p.originOfTravel||'', p.lastSeen||'']));
  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'guest_memory_' + hoLocalISO() + '.csv';
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
      const key = gmKey(parts[0]);
      const ex  = _gmStore[key] || {};
      _gmStore[key] = {
        nat:            parts[1] || ex.nat            || '',
        email:          parts[2] || ex.email          || '',
        purpose:        parts[3] || ex.purpose         || 'Business',
        originOfTravel: parts[4] || ex.originOfTravel || '',
        hits:           ex.hits  || 0,
        lastSeen:       parts[5] || ex.lastSeen        || '',
      };
      count++;
    });
    _gmPersist();
    _gmRenderTable();
    showToast(`${count} profiles imported ✓`, 'ok');
  };
  reader.readAsText(file);
}

// ── Phones (no keyboard for Ctrl+Shift+M): press and hold the HotelOps logo ~1.5 s.
// Still hidden from the menu, and the panel's own password lock still applies.
// A normal tap on the logo keeps doing what it did (rename the hotel).
(function () {
  let t = 0, held = false, sx = 0, sy = 0;
  const logoOf = e => e.target && e.target.closest && e.target.closest('.topbar .logo');
  const stop = () => { clearTimeout(t); t = 0; };
  document.addEventListener('pointerdown', e => {
    if (!logoOf(e)) return;
    held = false; sx = e.clientX; sy = e.clientY; stop();
    t = setTimeout(() => {
      held = true;
      try { if (navigator.vibrate) navigator.vibrate(30); } catch (_) {}
    }, 1500);
  }, true);
  document.addEventListener('pointermove', e => { if (t && Math.hypot(e.clientX - sx, e.clientY - sy) > 12) stop(); }, true);
  // opened when the finger lifts: phones only show Face ID from a tap or release
  document.addEventListener('pointerup', e => { stop(); if (held && logoOf(e)) gmOpen(); }, true);
  ['pointercancel', 'pointerleave'].forEach(n => document.addEventListener(n, stop, true));
  // the tap that ends the hold must not also open "rename hotel"
  document.addEventListener('click', e => { if (held && logoOf(e)) { held = false; e.stopPropagation(); e.preventDefault(); } }, true);
  document.addEventListener('contextmenu', e => { if (logoOf(e)) e.preventDefault(); }, true);
})();


// ── Face ID / fingerprint (the phone's own check, like a passkey) ────────────
// Turned on per phone and per account from inside Guest Memory ("Use Face ID on this phone").
// Then opening Guest Memory asks for Face ID (owner included); the password stays as the fallback.
// The check runs on this phone only (there is no server), so it is a lock on this device, not a new account login.
const GM_FACE_KEY = 'gm_faceid_v1';
const _gmUid = () => (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.uid) || '';
const _gmB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const _gmBuf = s => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), c => c.charCodeAt(0));
function _gmFaceRec() { try { const v = JSON.parse(localStorage.getItem(GM_FACE_KEY) || 'null'); return v && v.id && v.uid === _gmUid() ? v : null; } catch (_) { return null; } }
function _gmFaceOn() { return !!(window.PublicKeyCredential && navigator.credentials && _gmFaceRec()); }
async function _gmFaceCan() { try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (_) { return false; } }

/** ask for Face ID; true when it passed and the panel is open */
async function gmFaceCheck() {
  const rec = _gmFaceRec(); if (!rec) return false;
  try {
    const ch = crypto.getRandomValues(new Uint8Array(32));
    const got = await navigator.credentials.get({ publicKey: { challenge: ch, allowCredentials: [{ type: 'public-key', id: _gmBuf(rec.id) }], userVerification: 'required', timeout: 60000 } });
    if (!got || _gmB64(got.rawId) !== rec.id) throw new Error('not this phone\'s key');
    if (got.response && got.response.authenticatorData) { const flags = new Uint8Array(got.response.authenticatorData)[32]; if (!(flags & 4)) throw new Error('no Face ID'); }   // UV flag: the face / finger was really checked
    _gmOpenSession('Face ID');
    return true;
  } catch (e) {
    showToast(e && e.name === 'NotAllowedError' ? 'Face ID cancelled' : 'Face ID did not work: ' + ((e && e.message) || 'try again'), 'warn');
    return false;
  }
}
/** turn Face ID on for this phone (only once unlocked) */
async function gmFaceEnable(andOpen) {
  if (!_gmIsOwner()) { showToast('Only the owner can set up Face ID for Guest Memory', 'err'); return; }
  if (!_gmUnlocked && !andOpen) { showToast('Unlock Guest Memory first', 'warn'); return; }
  if (!(await _gmFaceCan())) { showToast('This phone or browser has no Face ID / fingerprint for websites', 'err'); return; }
  try {
    const p = typeof currentProfile !== 'undefined' && currentProfile ? currentProfile : {};
    const cred = await navigator.credentials.create({ publicKey: {
      rp: { name: 'HotelOps Guest Memory' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: p.email || 'hotelops', displayName: p.name || 'HotelOps' },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000, attestation: 'none' } });
    localStorage.setItem(GM_FACE_KEY, JSON.stringify({ id: _gmB64(cred.rawId), uid: _gmUid(), at: Date.now() }));
    showToast('✓ Face ID saved: only your face opens Guest Memory on this phone', 'ok');
    if (typeof logActivity === 'function') logActivity('guestmem_password_change', 'Face ID on');
    if (andOpen) _gmOpenSession('Face ID');
  } catch (e) { showToast(e && e.name === 'NotAllowedError' ? 'Face ID set-up cancelled' : 'Could not turn on Face ID', 'warn'); }
  _gmFaceRender();
}
function gmFaceDisable() {
  if (!_gmUnlocked || !_gmIsOwner()) { showToast('Unlock Guest Memory first', 'warn'); return; }
  if (!confirm('Remove your Face ID from Guest Memory on this phone? It locks now, and you set it up again next time you open it.')) return;
  try { localStorage.removeItem(GM_FACE_KEY); } catch (_) {}
  _gmUnlocked = false; clearTimeout(_gmLockTimer); _gmRenderLockState();
  showToast('Face ID removed on this phone · Guest Memory locked', 'info');
  _gmFaceRender();
}
/** the Face ID buttons: "Use Face ID" on the lock card, and the on/off switch next to Lock */
async function _gmFaceRender() {
  const lockBtn = document.getElementById('gmLockBtn'), main = document.getElementById('gmFaceMain'), sub = document.getElementById('gmLockSub');
  if (main && sub) {
    const own = _gmIsOwner(), on = _gmFaceOn(), can = await _gmFaceCan();
    main.style.display = own && can ? '' : 'none';
    main.textContent = on ? '🙂 Unlock with Face ID' : '🙂 Save my Face ID and open';
    sub.textContent = !own ? 'Only the owner can open Guest Memory.'
      : !can ? 'This device has no Face ID / fingerprint for websites. Open Guest Memory on your phone.'
      : on ? 'Confirm it is you with Face ID.' : 'First time on this phone: save your Face ID. After that, only your face opens it here.';
  }
  if (lockBtn && lockBtn.parentNode) {
    let t = document.getElementById('gmFaceToggle');
    const can = await _gmFaceCan();
    if (!can || !_gmUnlocked) { if (t) t.remove(); return; }
    if (!t) { t = document.createElement('button'); t.id = 'gmFaceToggle'; t.type = 'button'; t.className = 'btn sm'; lockBtn.parentNode.insertBefore(t, lockBtn); }
    const on = _gmFaceOn();
    if (!_gmIsOwner()) { t.remove(); return; }
    t.textContent = on ? '🙂 Face ID: on' : '🙂 Save my Face ID';
    t.title = on ? 'Remove your Face ID on this phone (Guest Memory locks)' : 'Save your Face ID for this phone';
    t.onclick = () => (on ? gmFaceDisable() : gmFaceEnable());
  }
}
/** open Guest Memory (shortcut, or holding the logo): asks for Face ID straight away when it is on */
function gmOpen() {
  if (typeof showPanel === 'function') showPanel('guestmem');
  _gmRenderLockState(); _gmFaceRender();
  if (!_gmUnlocked && _gmIsOwner() && _gmFaceOn()) gmFaceCheck();
}
setTimeout(() => { try { _gmFaceRender(); } catch (_) {} }, 1500);

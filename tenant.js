// ═══════════════════════════════════════════════════════════
//  tenant.js — one app, a separate space per hotel
//
//  Every hotel's data lives under hotels/<hotelId>/… . Each person is
//  assigned to one hotel by the owner or manager who adds them in Team
//  management (userHotels/<uid> = hotelId). After sign-in the app opens
//  that person's hotel; they never pick it themselves.
//
//  An owner can add a new hotel together with its first owner account;
//  that owner then adds their own team, who all land in the new hotel.
//
//  Moving a device to another hotel clears the device's saved copies of
//  the previous hotel first, so two hotels never mix on a shared PC.
// ═══════════════════════════════════════════════════════════

const TN_KEY = 'hotelops_hotel';
// kept on the device across hotels (personal, not hotel data)
const TN_KEEP = new Set([TN_KEY, 'hotelops_prefs_v1', 'whats_new_seen_v1', 'install_prompt_later_v1',
  'ibis_saved_email']);   // Ops Brain's memory is per hotel, so it is cleared too

const _tnDb = () => firebase.database();
const tnSlug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
const _tnHotelOf = v => (typeof v === 'string' ? v : (v && typeof v === 'object' ? Object.keys(v).find(k => v[k]) : null)) || null;

/**
 * After sign-in: the hotel this person was assigned to.
 * Returns the hotel id, or 'reloading' when the device moves to it.
 */
async function tnResolveHotel(uid) {
  let assigned = null;
  // (offline the reads would wait forever: give up after a few seconds and stay on this device's hotel)
  const read = ref => Promise.race([ref.once('value'), new Promise((_, no) => setTimeout(() => no(new Error('offline')), 6000))]);
  let offline = false;
  try { assigned = _tnHotelOf((await read(_tnDb().ref('userHotels/' + uid))).val()); } catch (e) { offline = e && e.message === 'offline'; }
  if (!assigned && !offline) {
    // accounts from before hotels had their own spaces belong to this one
    try {
      const here = await read(_tnDb().ref(`hotels/${HOTEL_ID}/users/${uid}`));
      if (here.exists()) { await _tnDb().ref('userHotels/' + uid).set(HOTEL_ID); assigned = HOTEL_ID; }
    } catch (_) {}
  }
  if (assigned && assigned !== HOTEL_ID) { tnMoveDevice(assigned); return 'reloading'; }
  tnShowHotelName();
  return HOTEL_ID;
}

/** Show this hotel's own name under the logo (saved in its settings). */
async function tnShowHotelName() {
  try {
    const s = await _tnDb().ref(`hotels/${HOTEL_ID}/settings/hotelName`).once('value');
    const n = s.val();
    const el = document.getElementById('hotelName');
    if (n && el) el.textContent = n;
  } catch (_) {}
}

/** Point this device at another hotel: clear the old hotel's saved copies, reload. */
function tnMoveDevice(hid) {
  try {
    Object.keys(localStorage).filter(k => !TN_KEEP.has(k) && !/^firebase:/.test(k)).forEach(k => localStorage.removeItem(k));
    localStorage.setItem(TN_KEY, hid);
  } catch (_) {}
  location.reload();
}

// ── Team management: whoever an owner / manager adds belongs to their hotel ──
async function tnLinkUser(uid) { try { await _tnDb().ref('userHotels/' + uid).set(HOTEL_ID); } catch (e) { console.warn('[tenant] link failed', e); } }
async function tnUnlinkUser(uid) {
  try { const r = _tnDb().ref('userHotels/' + uid); if (_tnHotelOf((await r.once('value')).val()) === HOTEL_ID) await r.remove(); } catch (e) { console.warn('[tenant] unlink failed', e); }
}

/** Owner: create a new hotel and its first owner account. */
async function tnCreateHotel(f) {
  const name = String(f.name || '').trim(), oName = String(f.ownerName || '').trim(), email = String(f.email || '').trim(), pass = String(f.pass || '');
  if (!name) throw new Error('Enter the hotel name');
  if (!oName || !email) throw new Error('Enter the new hotel owner\'s name and email');
  if (pass.length < 6) throw new Error('The password needs at least 6 characters');
  let hid = tnSlug(name);
  if (!hid) throw new Error('Use letters or numbers in the hotel name');
  const base = hid; let n = 2;
  while (hid === HOTEL_ID || (await _tnDb().ref(`hotelsIndex/${hid}`).once('value')).exists()) hid = `${base}_${n++}`;

  // the owner's login, made without signing you out
  const sec = firebase.initializeApp(FIREBASE_CONFIG, 'newhotel_' + Date.now());
  let uid;
  try {
    const cred = await sec.auth().createUserWithEmailAndPassword(email, pass);
    uid = cred.user.uid;
    await sec.auth().signOut();
  } finally { try { await sec.delete(); } catch (_) {} }

  const now = new Date().toISOString(), by = currentUser.uid;
  await _tnDb().ref(`hotelsIndex/${hid}`).set({ name, createdAt: now, createdBy: by });
  await _tnDb().ref(`hotels/${hid}/users/${uid}`).set({ uid, name: oName, email, role: 'owner', active: true, createdAt: now, createdBy: by });
  await _tnDb().ref(`hotels/${hid}/settings`).set({ hotelName: name, updatedAt: now });
  await _tnDb().ref(`hotels/${hid}/settings/td`).set(Object.assign({}, typeof HotelCfg !== 'undefined' ? HotelCfg.DEFAULTS : {},
    { tdCodes: String(f.tdCodes || '').trim() || '7510', tdRate: +f.tdRate > 0 ? +f.tdRate : 10 }));
  await _tnDb().ref('userHotels/' + uid).set(hid);
  if (typeof logActivity === 'function') try { await logActivity('hotel_created', `${name} · owner ${oName} (${email})`); } catch (_) {}
  return hid;
}

// ── Settings → Hotel ──────────────────────────────────────
async function tnRenderSettings() {
  const box = document.getElementById('tnBox');
  if (!box || typeof currentUser === 'undefined' || !currentUser) return;
  const isOwner = typeof currentProfile !== 'undefined' && currentProfile && currentProfile.role === 'owner';
  let mine = [];
  if (isOwner) {
    try {
      const all = (await _tnDb().ref('hotelsIndex').once('value')).val() || {};
      mine = Object.entries(all).filter(([id, h]) => h && h.createdBy === currentUser.uid).map(([id, h]) => h.name || id);
    } catch (_) {}
  }
  box.innerHTML = `
    <div class="hs-row" data-s="hotel space id">
      <span class="hs-txt"><b>This hotel's space</b><small>${escapeHtml(document.getElementById('hotelName')?.textContent || HOTEL_ID)} · <code>${escapeHtml(HOTEL_ID)}</code>. Everyone you add in Team management works in this hotel.</small></span>
    </div>
    ${isOwner ? `<div class="hs-row hs-col" data-s="add hotel new hotel create owner">
      <span class="hs-txt"><b>Add a hotel</b><small>Creates a new hotel with its own empty space and its owner's login. That owner signs in and adds their own team; nothing is shared with this hotel.${mine.length ? ` Hotels you added: ${mine.map(escapeHtml).join(', ')}.` : ''}</small></span>
      <div class="hs-grid">
        <label>Hotel name<input id="tnName" placeholder="e.g. ibis Al Barsha"></label>
        <label>Opera TD code<input id="tnCode" value="7510"></label>
        <label>TD rate (AED / night)<input id="tnRate" type="number" value="10"></label>
        <label>Owner's name<input id="tnOwner" placeholder="Full name"></label>
        <label>Owner's email<input id="tnEmail" type="email" placeholder="name@hotel.com"></label>
        <label>Owner's password<input id="tnPass" type="password" placeholder="at least 6 characters"></label>
      </div>
      <div class="hs-acts"><button class="btn gold sm" id="tnBtn" onclick="tnCreateFromForm()">Create hotel</button><small>Give the owner their email and password; they can change the password after signing in.</small></div>
    </div>` : ''}`;
}

async function tnCreateFromForm() {
  const b = document.getElementById('tnBtn');
  const v = id => document.getElementById(id)?.value || '';
  try {
    if (b) { b.disabled = true; b.textContent = 'Creating…'; }
    await tnCreateHotel({ name: v('tnName'), tdCodes: v('tnCode'), tdRate: v('tnRate'), ownerName: v('tnOwner'), email: v('tnEmail'), pass: v('tnPass') });
    showToast(`${v('tnName')} created — ${v('tnEmail')} can sign in now`, 'ok');
    ['tnName', 'tnOwner', 'tnEmail', 'tnPass'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    tnRenderSettings();
  } catch (e) {
    const m = { 'auth/email-already-in-use': 'That email already has a HotelOps login', 'auth/invalid-email': 'That email address is not valid', 'auth/weak-password': 'The password is too weak' }[e.code];
    showToast(m || e.message || 'Could not create the hotel', 'err');
  } finally { if (b) { b.disabled = false; b.textContent = 'Create hotel'; } }
}

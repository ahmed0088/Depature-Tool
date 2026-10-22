// ═══════════════════════════════════════════════════════════
//  face-login.js — sign in with Face ID / Touch ID (a passkey)
//  After one normal sign-in, this device can keep your email and
//  password locked behind a passkey. Next time the sign-in card shows
//  "Sign in with Face ID": one look and you're in.
//
//  How it stays safe without a server:
//  • The passkey lives in the phone's keychain (iCloud Passwords on
//    iPhone) and only opens with your face / finger.
//  • Where the phone supports it (iOS 18+, Chrome), the passkey itself
//    makes the key that locks the password (WebAuthn "PRF"), so the
//    saved password can't be opened without your face.
//  • Older phones: the key is kept by the browser and can't be read
//    out, and the passkey check is still asked every time.
//  The saved sign-in is for this device only. Change your password →
//  sign in with it once and turn Face ID on again.
// ═══════════════════════════════════════════════════════════

(function (W) {
  const KEY = 'ho_facelogin_v1';
  const NO_ASK = 'ho_facelogin_noask_v1';
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64 = s => { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
  const rand = n => crypto.getRandomValues(new Uint8Array(n));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function rec() { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && v.id && v.ct ? v : null; } catch (_) { return null; } }
  function save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (_) {} }
  function supported() { return !!(W.PublicKeyCredential && navigator.credentials && W.crypto && crypto.subtle); }
  async function canUse() { try { return supported() && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch (_) { return false; } }
  function bioName() { return /iPhone|iPad|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document ? 'Face ID' : /Mac/.test(navigator.userAgent) ? 'Touch ID' : 'Face ID'; }

  // ── the fallback key (no PRF): a browser-held AES key that can't be exported ──
  function idb() {
    return new Promise((ok, no) => { const r = indexedDB.open('ho-facelogin', 1); r.onupgradeneeded = () => r.result.createObjectStore('k'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  }
  async function idbKey(make) {
    const db = await idb();
    const get = () => new Promise((ok, no) => { const q = db.transaction('k').objectStore('k').get('key'); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); });
    let k = await get();
    if (!k && make) {
      k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await new Promise((ok, no) => { const t = db.transaction('k', 'readwrite'); t.objectStore('k').put(k, 'key'); t.oncomplete = ok; t.onerror = () => no(t.error); });
    }
    return k;
  }
  async function idbDrop() { try { const db = await idb(); db.transaction('k', 'readwrite').objectStore('k').delete('key'); } catch (_) {} }
  const prfKey = bytes => crypto.subtle.importKey('raw', new Uint8Array(bytes).slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);

  /** Ask for Face ID on our passkey; returns the PRF bytes (or null when this phone has no PRF). */
  async function assert(r, salt) {
    const pk = { challenge: rand(32), allowCredentials: [{ type: 'public-key', id: unb64(r.id), transports: ['internal', 'hybrid'] }], userVerification: 'required', timeout: 60000, rpId: location.hostname };
    if (salt) pk.extensions = { prf: { eval: { first: salt } } };
    const got = await navigator.credentials.get({ publicKey: pk });
    if (!got) throw new Error('cancelled');
    const ex = got.getClientExtensionResults ? got.getClientExtensionResults() : {};
    return ex && ex.prf && ex.prf.results && ex.prf.results.first || null;
  }

  // ── turn on ──
  let _pending = null;   // { email, pass, at } kept in memory only, right after a password sign-in
  async function enable(email, pass) {
    if (!(await canUse())) { toast('This device has no Face ID / fingerprint for apps — use your password', 'err'); return false; }
    const u = typeof currentUser !== 'undefined' && currentUser;
    const name = (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || email;
    const salt = rand(32);
    let cred;
    try {
      cred = await navigator.credentials.create({ publicKey: {
        challenge: rand(32),
        rp: { name: 'HotelOps', id: location.hostname },
        user: { id: u && u.uid ? enc.encode(String(u.uid)).slice(0, 64) : rand(16), name: email, displayName: name },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        timeout: 60000, attestation: 'none',
        extensions: { prf: { eval: { first: salt } } },
      } });
    } catch (e) { if (e && e.name !== 'NotAllowedError') console.warn('[FaceLogin] create', e); toast(e && e.name === 'InvalidStateError' ? 'A passkey for HotelOps is already on this phone — try again' : 'Face ID was not set up', 'err'); return false; }
    if (!cred) return false;
    const r = { id: b64(cred.rawId), email, name, at: Date.now() };
    const ex = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
    let key = null;
    try {
      let bytes = ex.prf && ex.prf.results && ex.prf.results.first;
      if (!bytes && ex.prf && ex.prf.enabled) bytes = await assert(r, salt);   // some phones give the key only on the first use
      if (bytes) { key = await prfKey(bytes); r.prf = 1; r.salt = b64(salt); }
    } catch (e) { console.warn('[FaceLogin] prf', e); }
    if (!key) { key = await idbKey(true); r.prf = 0; }
    const iv = rand(12);
    r.iv = b64(iv);
    r.ct = b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify({ e: email, p: pass }))));
    save(r);
    try { localStorage.removeItem(NO_ASK); } catch (_) {}
    toast(`${bioName()} sign-in is on for this device ✓`);
    if (typeof logActivity === 'function') try { logActivity('settings', 'Face ID sign-in turned on for this device'); } catch (_) {}
    renderLogin(); refreshSettings();
    return true;
  }

  function disable(quiet) {
    try { localStorage.removeItem(KEY); } catch (_) {}
    idbDrop();
    if (!quiet) toast(`${bioName()} sign-in turned off for this device. You can also delete the HotelOps passkey in Settings → Passwords.`);
    renderLogin(); refreshSettings();
  }

  // ── sign in ──
  let _busy = false;
  async function signIn(auto) {
    const r = rec(); if (!r || _busy) return;
    _busy = true; btnState('busy');
    let creds;
    try {
      const bytes = await assert(r, r.prf ? unb64(r.salt) : null);
      const key = r.prf ? (bytes ? await prfKey(bytes) : null) : await idbKey(false);
      if (!key) throw Object.assign(new Error('nokey'), { name: 'NoKey' });
      creds = JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(r.iv) }, key, unb64(r.ct))));
    } catch (e) {
      _busy = false; btnState('idle');
      if (auto) return;   // the quiet try when the app opens: just leave the button there
      if (e && e.name === 'NotAllowedError') return lgMsg('Face ID was cancelled. Tap the button to try again, or use your password.', 'info');
      if (e && (e.name === 'NoKey' || e.name === 'OperationError')) { disable(true); return lgMsg('The saved sign-in on this device can\'t be opened any more. Sign in with your password, then turn Face ID on again.', 'warn'); }
      console.warn('[FaceLogin] get', e);
      return lgMsg('Face ID didn\'t work this time. Try again, or use your password.', 'warn');
    }
    try {
      if (typeof _lgSigningIn !== 'undefined') _lgSigningIn = true;
      try { localStorage.setItem('ibis_saved_email', creds.e); } catch (_) {}
      await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      await firebase.auth().signInWithEmailAndPassword(creds.e, creds.p);
      // onAuthStateChanged (auth.js) takes it from here
    } catch (e) {
      if (typeof _lgSigningIn !== 'undefined') _lgSigningIn = false;
      const code = (e && e.code) || '';
      if (/wrong-password|invalid-credential|invalid-login|user-not-found|user-disabled/.test(code)) {
        disable(true);
        lgMsg('Your password was changed, so Face ID was turned off on this device. Sign in with your new password and turn it on again.', 'warn');
      } else lgMsg(typeof friendlyAuthError === 'function' ? friendlyAuthError(code, e && e.message) : 'Could not sign in — try again', navigator.onLine === false ? 'warn' : 'err');
    } finally { _busy = false; btnState('idle'); creds = null; }
  }

  // ── the sign-in card ──
  const FACE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 9v1.5M15 9v1.5M12 9v4h-1M9.5 16a3.5 3.5 0 0 0 5 0"/></svg>';
  function lgMsg(m, tone) { if (typeof _lgShowMsg === 'function') _lgShowMsg(m, tone); }
  function btnState(s) {
    const b = document.getElementById('flBtn'); if (!b) return;
    b.disabled = s === 'busy'; b.classList.toggle('is-busy', s === 'busy');
    b.querySelector('.fl-label').textContent = s === 'busy' ? 'Signing in…' : `Sign in with ${bioName()}`;
  }
  let _autoTried = false;
  function renderLogin(msg) {
    const form = document.getElementById('loginForm'); if (!form) return;
    let box = document.getElementById('flBox');
    const r = rec();
    if (!r || !supported()) { if (box) box.remove(); return; }
    if (!box) { box = document.createElement('div'); box.id = 'flBox'; box.className = 'fl-box lg-in'; box.style.setProperty('--i', '3'); form.parentNode.insertBefore(box, form); }
    const first = String(r.name || r.email || '').split(/[\s@]/)[0];
    box.innerHTML = `<button type="button" id="flBtn" class="fl-btn" onclick="hoFaceLogin.signIn()">${FACE_SVG}<span class="fl-label">Sign in with ${bioName()}</span></button>
      <div class="fl-who">as <b>${esc(first)}</b> · <button type="button" class="fl-link" onclick="hoFaceLogin.forget()">not you?</button></div>
      <div class="fl-or"><span>or use your password</span></div>`;
    // opening the app from the Home Screen: ask for Face ID straight away (only on a fresh open, never
    // right after being signed out by a manager or for being idle)
    const standalone = (W.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    if (!_autoTried && !msg && standalone) { _autoTried = true; setTimeout(() => signIn(true), 350); }
  }
  function forget() {
    if (!confirm('Remove the Face ID sign-in from this device? You can turn it on again after signing in.')) return;
    disable(true); lgMsg('Face ID sign-in removed from this device.', 'info');
  }

  // ── offer it right after a password sign-in ──
  function offer(email, pass) {
    if (rec() || !email || !pass) return;
    try { if (localStorage.getItem(NO_ASK)) return; } catch (_) {}
    _pending = { email, pass, at: Date.now() };
    setTimeout(() => { if (_pending && !_pending.used) _pending = null; }, 3 * 60e3);   // the password is never kept longer than this
    canUse().then(ok => { if (ok) setTimeout(showOffer, 1600); else _pending = null; });
  }
  function showOffer() {
    if (!_pending || document.getElementById('flOffer') || typeof currentUser === 'undefined' || !currentUser) return;
    const d = document.createElement('div');
    d.id = 'flOffer'; d.className = 'fl-offer'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Use Face ID next time');
    d.innerHTML = `<div class="fl-offer-ic">${FACE_SVG}</div>
      <div class="fl-offer-txt"><b>Sign in with ${bioName()} next time?</b><span>No more typing your password on this device. Your password stays locked on this phone behind your face.</span></div>
      <div class="fl-offer-act"><button type="button" class="btn ghost" onclick="hoFaceLogin.offerNo()">Not now</button><button type="button" class="btn primary" onclick="hoFaceLogin.offerYes()">Turn on</button></div>`;
    document.body.appendChild(d);
    requestAnimationFrame(() => d.classList.add('on'));
  }
  function closeOffer() { const d = document.getElementById('flOffer'); if (d) { d.classList.remove('on'); setTimeout(() => d.remove(), 300); } }
  async function offerYes() {
    const p = _pending; closeOffer();
    if (!p) return toast('Sign in with your password again to turn this on', 'err');
    p.used = true; _pending = null;
    await enable(p.email, p.pass);
  }
  function offerNo() { closeOffer(); _pending = null; try { localStorage.setItem(NO_ASK, '1'); } catch (_) {} toast('OK — you can turn it on any time in Settings → Privacy & security'); }

  // ── Settings → Privacy & security ──
  function settingsRow() {
    if (!supported()) return '';
    const r = rec(), n = bioName();
    return `<div class="hs-row" data-s="face id touch id passkey biometric sign in login">
      <span class="hs-txt"><b>${n} / passkey sign-in</b><small>${r ? `On for this device (${esc(r.email)}). The sign-in card shows "Sign in with ${n}"` : `Sign in with one look instead of typing your password. This device only`}</small></span>
      <button class="btn ${r ? 'ghost' : 'primary'}" onclick="${r ? 'hoFaceLogin.disable()' : 'hoFaceLogin.setup()'}">${r ? 'Turn off' : 'Turn on'}</button>
    </div>`;
  }
  function refreshSettings() { if (document.getElementById('hs-privacy') && typeof hoSettingsRender === 'function') try { hoSettingsRender(); } catch (_) {} }
  /** From Settings: ask for the password once (checked with Firebase), then make the passkey. */
  function setup() {
    const u = typeof currentUser !== 'undefined' && currentUser;
    if (!u || !u.email) return toast('Sign in first', 'err');
    if (_pending && _pending.email === u.email) return offerYes();
    let d = document.getElementById('flAsk'); if (d) d.remove();
    d = document.createElement('div'); d.id = 'flAsk'; d.className = 'fl-ask';
    d.innerHTML = `<form class="fl-ask-card" onsubmit="event.preventDefault();hoFaceLogin.setupGo()">
      <div class="fl-offer-ic">${FACE_SVG}</div>
      <b>Turn on ${bioName()} sign-in</b>
      <span>Type your HotelOps password once. It's checked, then locked on this device behind your face.</span>
      <input type="email" autocomplete="username" value="${esc(u.email)}" hidden>
      <input id="flAskPass" type="password" class="input" autocomplete="current-password" placeholder="Your password" required>
      <div class="fl-ask-err" id="flAskErr"></div>
      <div class="fl-offer-act"><button type="button" class="btn ghost" onclick="document.getElementById('flAsk').remove()">Cancel</button><button type="submit" class="btn primary" id="flAskGo">Continue</button></div>
    </form>`;
    d.addEventListener('click', e => { if (e.target === d) d.remove(); });
    document.body.appendChild(d);
    setTimeout(() => document.getElementById('flAskPass')?.focus(), 50);
  }
  async function setupGo() {
    const u = currentUser, inp = document.getElementById('flAskPass'), err = document.getElementById('flAskErr'), go = document.getElementById('flAskGo');
    const pass = inp && inp.value; if (!pass) return;
    go.disabled = true; err.textContent = '';
    try {
      const A = firebase.auth;
      if (A.EmailAuthProvider && u.reauthenticateWithCredential) await u.reauthenticateWithCredential(A.EmailAuthProvider.credential(u.email, pass));
    } catch (e) {
      go.disabled = false;
      err.textContent = /wrong-password|invalid-credential|invalid-login/.test((e && e.code) || '') ? 'That password is not right' : (navigator.onLine === false ? 'You\'re offline — connect and try again' : 'Could not check the password — try again');
      inp.select(); return;
    }
    document.getElementById('flAsk')?.remove();
    await enable(u.email, pass);
  }

  function toast(m, t) { if (typeof showToast === 'function') showToast(m, t); }

  W.hoFaceLogin = { signIn, enable, disable, forget, offer, offerYes, offerNo, setup, setupGo, settingsRow, renderLogin, rec, canUse };
})(window);

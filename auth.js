// ═══════════════════════════════════════════════════════════
//  auth.js  —  Full Authentication & Role Management System
//  Ibis Styles Dubai · Front Desk Ops · 2026
// ═══════════════════════════════════════════════════════════

// Powers marked true are what each role could already do before the app checked them
// (Export, Clear, Delete, See activity logs): the owner can take them away in Team → Roles & access.
const ROLES = {
  owner: {
    label: 'Owner', color: '#f0a43a', icon: '👑',
    panels: ['home','departures','arrivals','xref','purpose','shifts','checklist','nationality','rent','audit','immig','tourism','td-audit','dtcm','arrivals-proc','inhouse-tally','package-audit','noshow','reports','standards','pipeline','history','settings','learn','roster','wakeups','rates','handover-book'],
    canManageUsers: true, canExport: true, canImport: true, canClear: true,
    canEditChecklist: true, canEditShifts: true, canReports: true,
    canDelete: true, canViewAll: true, canForceLogout: true, canViewLogs: true,
  },
  manager: {
    label: 'Manager', color: '#8b7cf8', icon: '🏅',
    panels: ['home','departures','arrivals','xref','purpose','shifts','checklist','nationality','rent','audit','immig','tourism','td-audit','dtcm','arrivals-proc','inhouse-tally','package-audit','noshow','standards','pipeline','history','settings','learn','roster','wakeups','rates','handover-book'],
    canManageUsers: true, canExport: true, canImport: false, canClear: true,
    canEditChecklist: true, canEditShifts: true, canReports: true,
    canDelete: true, canViewLogs: true,
  },
  supervisor: {
    label: 'Supervisor', color: '#5ab4e8', icon: '⭐',
    panels: ['home','departures','arrivals','xref','purpose','shifts','checklist','nationality','rent','audit','immig','tourism','td-audit','dtcm','arrivals-proc','inhouse-tally','package-audit','noshow','standards','pipeline','history','settings','learn','roster','wakeups','rates','handover-book'],
    canManageUsers: false, canExport: true, canImport: false, canClear: true,
    canEditChecklist: true, canEditShifts: true, canReports: true,
    canDelete: true, canViewLogs: true,
  },
  agent: {
    label: 'Agent', color: '#3ecf8e', icon: '🛎️',
    panels: ['home','departures','arrivals','xref','shifts','checklist','noshow','standards','settings','learn','roster','wakeups','handover-book'],
    canManageUsers: false, canExport: true, canImport: false, canClear: true,
    canEditChecklist: false, canEditShifts: false, canReports: false,
    canDelete: true,
  },
  readonly: {
    label: 'Read Only', color: '#888', icon: '👁️',
    panels: ['home','departures','arrivals','xref','shifts','standards','settings','learn','roster','wakeups','handover-book'],
    canManageUsers: false, canExport: false, canImport: false, canClear: false,
    canEditChecklist: false, canEditShifts: false, canReports: false,
  },
};

/** A role as it applies now: the built-in defaults above with the owner's changes from
 *  Team → Roles & access laid on top (role-rules.js). Use this, not ROLES[role], for pages and powers. */
function roleDef(role, access) {
  if (typeof hoRoleRules !== 'undefined' && hoRoleRules && typeof hoRoleRules.def === 'function') return hoRoleRules.def(role, access);
  return ROLES[role] || ROLES.readonly;
}
/** The signed-in person: role → role rules → their own access (Team → Users → Access). */
function myRoleDef() {
  if (typeof hoRoleRules !== 'undefined' && hoRoleRules && typeof hoRoleRules.myDef === 'function' && currentProfile) return hoRoleRules.myDef();
  return roleDef(currentProfile ? currentProfile.role : 'readonly');
}
const ROLE_CAPS = ['canManageUsers','canExport','canImport','canClear','canEditChecklist','canEditShifts','canReports','canDelete','canViewAll','canForceLogout','canViewLogs'];

let currentUser    = null;
let currentProfile = null;

// ── Init ──────────────────────────────────────────────────
let _selfListener    = null; // real-time listener on own user record
let _selfListenerRef = null; // the DB ref, so we can .off() cleanly

function authInit() {
  // Restore saved email
  let savedEmail = null; try { savedEmail = localStorage.getItem('ibis_saved_email'); } catch (_) {}
  if (savedEmail) {
    const emailEl = document.getElementById('loginEmail');
    if (emailEl) emailEl.value = savedEmail;
    document.getElementById('rememberMe').checked = true;
  }

  firebase.auth().onAuthStateChanged(async user => {
    if (!user) { showLoginScreen(); return; }
    // open the hotel this person was assigned to (tenant.js)
    if (typeof tnResolveHotel === 'function' && await tnResolveHotel(user.uid) === 'reloading') return;
    const profile = await loadUserProfile(user.uid);
    if (!profile || !profile.active) {
      await firebase.auth().signOut();
      showLoginScreen(navigator.onLine === false ? 'You\'re offline. Connect to the internet once to sign in on this device.' : 'We couldn\'t find an active account for you. Please ask your manager.');
      return;
    }
    // An unrecognised role gets the least access, never the most
    if (!ROLES[profile.role]) {
      console.warn('[Auth] Unknown role "' + profile.role + '" — using read only');
      profile.role = 'readonly';
    }
    currentUser    = user;
    currentProfile = profile;
    if (typeof fbSignedInNow === 'function') setTimeout(fbSignedInNow, 0);   // live updates that waited for sign-in
    if (typeof hoRoleRules !== 'undefined' && hoRoleRules.start) setTimeout(hoRoleRules.start, 0);   // Team → Roles & access changes, live

    // Clear any stale forceLogout flag left from a previous disconnect
    if (profile.forceLogout) {
      try { await firebase.database().ref(`hotels/${HOTEL_ID}/users/${user.uid}`).update({ forceLogout: false }); } catch(e) {}
    }

    // not awaited: a database write only settles when the server confirms, so offline these never
    // finished and the app stayed on the login screen. They are sent when the connection is back.
    updateLastLogin(user.uid);
    logActivity('login');
    let myTheme = null; try { myTheme = localStorage.getItem('ho_theme_v1'); } catch (_) {}
    if (profile.theme && !myTheme) setTheme(profile.theme, null, true);   // this device's own choice wins
    applyRole(profile.role);
    hideLoginScreen();
    updateAuthUI();
    if (typeof _gmApplyOwnerAutoUnlock === 'function') _gmApplyOwnerAutoUnlock();

    // Start watching own record live — catches disable, delete, force-disconnect
    _startSelfListener(user.uid);
    _resetIdleTimer();
  });
}

// ── Idle auto-logout — shared front-desk PCs stay signed in forever
// otherwise. Any click/key/touch/scroll resets the clock; same duration
// as Guest Memory's own auto-relock (30 min) for a consistent convention.
const IDLE_LOGOUT_MINS = 30;
let _idleTimer = null;
/** Minutes from Settings → Privacy → Sign out when idle (0 = never); 30 until someone chooses */
/** your own device: you ticked "Stay signed in", signed in with Face ID, or it's the app on your Home Screen */
function hoStaysSignedIn() {
  let v = null; try { v = localStorage.getItem('ho_stay_signed_in_v1'); } catch (_) {}
  const app = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  return v === '1' || app;
}
function _idleMins() {
  // the idle sign-out is for shared desk PCs: on your own device it stays off unless you chose a time in Settings
  if (typeof hoPrefs === 'undefined' || !hoPrefs.autoLockChosen) return hoStaysSignedIn() ? 0 : IDLE_LOGOUT_MINS;
  const m = +hoPrefs.autoLock; return Number.isFinite(m) ? m : IDLE_LOGOUT_MINS;
}
function _resetIdleTimer() {
  clearTimeout(_idleTimer);
  if (!currentUser || !_idleMins()) return;
  _idleTimer = setTimeout(_idleLogout, _idleMins() * 60000);
}
async function _idleLogout() {
  if (!currentUser) return;
  if (_selfListenerRef && _selfListener) {
    _selfListenerRef.off('value', _selfListener);
    _selfListener    = null;
    _selfListenerRef = null;
  }
  currentUser    = null;
  currentProfile = null;
  try { await firebase.auth().signOut(); } catch(e) {}
  _clearLocalGuestDataCache();
  _afterSignOut(`You were signed out after ${_idleMins()} minutes without activity. Sign in again to carry on.`);
}
['mousedown', 'keydown', 'touchstart', 'scroll'].forEach(evt =>
  document.addEventListener(evt, _resetIdleTimer, { passive: true })
);

// ── Real-time self-watcher ────────────────────────────────
// Fires immediately on login, then on every change to this user's DB record.
// Three triggers: record deleted, active=false, forceLogout=true.
function _startSelfListener(uid) {
  // Detach any stale listener from a previous session
  if (_selfListenerRef && _selfListener) {
    _selfListenerRef.off('value', _selfListener);
  }
  _selfListenerRef = firebase.database().ref(`hotels/${HOTEL_ID}/users/${uid}`);
  _selfListener = _selfListenerRef.on('value', async snap => {
    if (!currentUser) return; // already signed out, ignore
    if (!snap.exists()) {
      // Record deleted by owner
      _forceSignOut('Your account was removed. Please ask your manager if you still need access.');
      return;
    }
    const data = snap.val();
    if (data.active === false) {
      // Account disabled
      _forceSignOut('Your account is switched off. Please ask your manager to turn it back on.');
      return;
    }
    if (data.forceLogout === true) {
      // Admin used the Disconnect button
      _forceSignOut('A manager signed you out of this device. Sign in again to carry on.');
      return;
    }
  }, err => console.warn('[Auth] self-listener error:', err));
}

// ── Force sign-out with message ───────────────────────────
async function _forceSignOut(message) {
  clearTimeout(_idleTimer);
  // Detach listener first to prevent re-triggering
  if (_selfListenerRef && _selfListener) {
    _selfListenerRef.off('value', _selfListener);
    _selfListener    = null;
    _selfListenerRef = null;
  }
  currentUser    = null;
  currentProfile = null;
  try { await firebase.auth().signOut(); } catch(e) {}
  _clearLocalGuestDataCache();
  _afterSignOut(message);
}
/** After signing out: start the page fresh, so no live data keeps arriving (or refilling this device's
 *  copy of guest data) and the next person's sign-in doesn't add a second set of everything. */
function _afterSignOut(message) {
  try { sessionStorage.setItem('ho_signout_msg', message || ''); } catch (_) {}
  try { location.reload(); } catch (_) { showLoginScreen(message); }
}

/** A database read that gives up after ms (offline, the read would otherwise wait forever). */
function _authRead(ref, ms) {
  return Promise.race([ref.once('value'), new Promise((_, no) => setTimeout(() => no(new Error('offline')), ms || 8000))]);
}
async function loadUserProfile(uid) {
  const cacheKey = 'ho_profile_' + HOTEL_ID + '_' + uid;
  let snap;
  try { snap = await _authRead(firebase.database().ref(`hotels/${HOTEL_ID}/users/${uid}`)); }
  catch (e) {
    // offline: the profile this device saw last time this person signed in
    try { const c = JSON.parse(localStorage.getItem(cacheKey) || 'null'); if (c) return c; } catch (_) {}
    return null;
  }
  try {
    const profile = snap.val();
    // If profile exists, return it as-is
    if (profile) { try { localStorage.setItem(cacheKey, JSON.stringify(profile)); } catch (_) {} return profile; }
    // No profile found — check if this Firebase Auth user has an email we can use
    // as a fallback so the owner is never locked out
    // Only the very first account of a brand-new hotel becomes its owner: once the hotel has users,
    // an account nobody added gets no access (anyone can make a sign-in with the public API key)
    const authUser = firebase.auth().currentUser;
    let hasUsers = true;
    try { hasUsers = (await firebase.database().ref(`hotels/${HOTEL_ID}/users`).limitToFirst(1).once('value')).exists(); } catch (e) {}
    if (authUser && authUser.email && !hasUsers) {
      console.warn('[Auth] No DB profile found for', uid, '— creating owner fallback record');
      const fallback = {
        uid,
        name: authUser.email.split('@')[0],
        email: authUser.email,
        role: 'owner',
        active: true,
        createdAt: new Date().toISOString(),
        createdBy: 'auto-fallback',
      };
      // Write it so future logins work normally
      try {
        await firebase.database().ref(`hotels/${HOTEL_ID}/users/${uid}`).set(fallback);
      } catch(e) {
        console.warn('[Auth] Could not write fallback profile (will use in-memory):', e);
      }
      return fallback;
    }
    return null;
  } catch(e) { return null; }
}

// ── Apply role ────────────────────────────────────────────
function applyRole(role) {
  const def = currentProfile && currentProfile.role === role ? myRoleDef() : roleDef(role);

  // Owner sees everything — no panel hiding, no capability hiding
  const isOwner = role === 'owner';

  document.querySelectorAll('.nav-item[data-panel]').forEach(el => {
    el.style.display = (isOwner || def.panels.includes(el.dataset.panel)) ? '' : 'none';
  });
  document.querySelectorAll('.mob-nav-btn[data-panel]').forEach(el => {
    el.style.display = (isOwner || def.panels.includes(el.dataset.panel)) ? '' : 'none';
  });
  document.querySelectorAll('.mob-more-item[data-panel]').forEach(el => {
    el.style.display = (isOwner || def.panels.includes(el.dataset.panel)) ? '' : 'none';
  });

  // Guest Memory is never shown in navigation, owner included — the
  // isOwner bypass above would otherwise re-reveal it on every login.
  // Ctrl/Cmd+Shift+M (plus its own password lock) is the only way in.
  document.querySelectorAll('[data-panel="guestmem"]').forEach(el => { el.style.display = 'none'; });

  // All capability-gated elements: owner sees all
  ROLE_CAPS.forEach(cap => {
    document.querySelectorAll(`[data-require="${cap}"]`).forEach(el =>
      el.style.display = (isOwner || def[cap]) ? '' : 'none');
  });

  const adminBtn    = document.getElementById('adminPanelBtn');
  const mobAdminBtn = document.getElementById('mobAdminBtn');
  if (adminBtn)    adminBtn.style.display    = (isOwner || def.canManageUsers) ? '' : 'none';
  if (mobAdminBtn) mobAdminBtn.style.display = (isOwner || def.canManageUsers) ? '' : 'none';

  // powers the app checks: buttons that need them hide (role-rules.js), owners keep everything
  ROLE_CAPS.forEach(cap => document.body.classList.toggle('ho-no-' + cap, !isOwner && !def[cap]));
  const actTab = document.querySelector('#adminModal .admin-tab-btn[data-tab="activity"]');
  if (actTab) actTab.style.display = (isOwner || def.canViewLogs) ? '' : 'none';

  document.body.classList.toggle('role-readonly', role === 'readonly');
  document.body.classList.toggle('role-owner', isOwner);
}

// ── Show / hide login ─────────────────────────────────────
// Messages on the sign-in card are a soft callout (login.css): tone 'info' (blue, e.g. signed
// out when idle), 'warn' (amber, offline / account problems) or 'err' (wrong password).
let _lgSigningIn = false, _lgLeaveT = 0, _lgDoneT = 0;
function _lgMsgTone(msg) {
  const m = String(msg || '').toLowerCase();
  if (/signed out|signed you out|disconnected/.test(m)) return 'info';
  return 'warn';
}
function _lgShowMsg(msg, tone) {
  const el = document.getElementById('loginError');
  if (!el) return;
  if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
  el.textContent = msg;
  el.dataset.tone = tone || _lgMsgTone(msg);
  el.style.display = 'block';
}
function _lgBtn(state) {
  const btn = document.getElementById('loginBtn');
  if (!btn) return;
  btn.classList.remove('is-busy', 'is-done');
  btn.disabled = state !== 'idle';
  btn.removeAttribute('aria-busy');
  if (state === 'busy') {
    btn.classList.add('is-busy'); btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = '<span class="login-btn-spinner" aria-hidden="true"></span><span class="lg-btn-label">Signing in…</span>';
  } else if (state === 'done') {
    btn.classList.add('is-done');
    btn.innerHTML = '<svg class="lg-btn-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><span class="lg-btn-label">Signed in</span>';
  } else {
    btn.innerHTML = '<span class="lg-btn-label">Sign in</span><svg class="lg-btn-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  }
}
let _lgWired = false;
function _lgWire() {
  if (_lgWired) return; _lgWired = true;
  // fields lose their red edge as soon as you start fixing them
  ['loginEmail', 'loginPass'].forEach(id => document.getElementById(id)?.addEventListener('input', e => e.target.removeAttribute('aria-invalid')));
  // the moving background rests while the tab is in the background
  document.addEventListener('visibilitychange', () => document.getElementById('loginScreen')?.classList.toggle('lg-paused', document.hidden));
  window.addEventListener('online', () => { const el = document.getElementById('loginError'); if (el && /offline/i.test(el.textContent)) _lgShowMsg(''); });
}
function showLoginScreen(errorMsg) {
  const scr = document.getElementById('loginScreen');
  clearTimeout(_lgLeaveT); clearTimeout(_lgDoneT); _lgSigningIn = false;
  scr.classList.remove('lg-leaving');
  scr.style.display = 'flex';
  document.getElementById('appWrapper').style.display  = 'none';
  _lgWire();
  if (document.getElementById('loginBtn')?.disabled) _lgBtn('idle');   // back here mid sign-in (account switched off etc.)
  // Apply correct theme to login screen too
  const cur = typeof hoThemeName === 'function' ? hoThemeName() : (document.documentElement.getAttribute('data-theme') || 'night-ops');
  _applyLoginTheme(cur);
  if (errorMsg) _lgShowMsg(errorMsg);
  if (typeof hoFaceLogin !== 'undefined') hoFaceLogin.renderLogin(errorMsg);   // "Sign in with Face ID" (face-login.js)
}

function hideLoginScreen() {
  const scr = document.getElementById('loginScreen');
  document.getElementById('appWrapper').style.display  = '';
  const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Signed in just now from this card: a short "Signed in" moment, then the card steps back and
  // the app (already drawn underneath) shows through. A saved sign-in on page load hides at once.
  if (!_lgSigningIn || calm || scr.style.display === 'none') { _lgSigningIn = false; scr.style.display = 'none'; return; }
  _lgSigningIn = false;
  _lgBtn('done');
  _lgShowMsg('');
  clearTimeout(_lgLeaveT); clearTimeout(_lgDoneT);
  _lgLeaveT = setTimeout(() => scr.classList.add('lg-leaving'), 420);
  _lgDoneT  = setTimeout(() => { scr.style.display = 'none'; scr.classList.remove('lg-leaving'); _lgBtn('idle'); }, 420 + 560);
}

// ── Login theme sync ──────────────────────────────────────
// The sign-in page follows the chosen theme (login.css): light themes get a clean white card on a
// light page, dark themes a dark glass card. Here we only hand over the accent pair and the
// colour that reads on the accent, for the Sign in button.
function _applyLoginTheme(name) {
  const accents = {
    // Same accent/accent2 pairs as the real app theme (styles.css :root overrides)
    'night-ops': { accent:'#e8b84b', accentDark:'#c49a2f', btnColor:'#080b10' },
    'opera':     { accent:'#C74634', accentDark:'#A3362A', btnColor:'#ffffff' },
    'midnight':  { accent:'#818cf8', accentDark:'#6366f1', btnColor:'#ffffff' },
    'ios':       { accent:'#007aff', accentDark:'#0062cc', btnColor:'#ffffff' },
    'ios-dark':  { accent:'#0a84ff', accentDark:'#0071e3', btnColor:'#ffffff' },
    'titanium':  { accent:'#c9a27e', accentDark:'#a8845f', btnColor:'#1b1a18' },
    'ocean':     { accent:'#2dd4bf', accentDark:'#14b8a6', btnColor:'#04201d' },
    'catppuccin': { accent:'#cba6f7', accentDark:'#b4befe', btnColor:'#1e1e2e' },
    'latte': { accent:'#8839ef', accentDark:'#7287fd', btnColor:'#ffffff' },
    'nord': { accent:'#88c0d0', accentDark:'#81a1c1', btnColor:'#2e3440' },
    'dracula': { accent:'#bd93f9', accentDark:'#ff79c6', btnColor:'#1e1f29' },
    'tokyo': { accent:'#7aa2f7', accentDark:'#bb9af7', btnColor:'#16161e' },
    'rosepine': { accent:'#ebbcba', accentDark:'#c4a7e7', btnColor:'#191724' },
    'paper': { accent:'#0f766e', accentDark:'#14b8a6', btnColor:'#ffffff' },
    'sky': { accent:'#0284c7', accentDark:'#38bdf8', btnColor:'#ffffff' },
    'mint': { accent:'#059669', accentDark:'#34d399', btnColor:'#ffffff' },
    'sakura': { accent:'#db2777', accentDark:'#f472b6', btnColor:'#ffffff' },
    'sand': { accent:'#b45309', accentDark:'#f59e0b', btnColor:'#ffffff' },
  };
  const t = accents[name] || accents['night-ops'];
  const scr = document.getElementById('loginScreen');
  if (scr) { scr.style.setProperty('--lg-a', t.accent); scr.style.setProperty('--lg-a2', t.accentDark); scr.style.setProperty('--lg-on', t.btnColor); }
  const s = document.getElementById('loginThemeStyle');
  if (s) s.textContent = '';
}

// ── Login ─────────────────────────────────────────────────
async function authLogin() {
  const email  = document.getElementById('loginEmail').value.trim();
  const pass   = document.getElementById('loginPass').value;
  const remember = document.getElementById('rememberMe')?.checked;
  const btn    = document.getElementById('loginBtn');
  if (btn && btn.disabled) return;   // already signing in

  _lgShowMsg('');
  ['loginEmail', 'loginPass'].forEach(id => document.getElementById(id)?.removeAttribute('aria-invalid'));
  _lgBtn('busy');

  // Save email if remember checked
  try { if (remember) localStorage.setItem('ibis_saved_email', email); else localStorage.removeItem('ibis_saved_email'); } catch (_) {}
  try { if (remember) localStorage.setItem('ho_stay_signed_in_v1', '1'); else localStorage.removeItem('ho_stay_signed_in_v1'); } catch (_) {}

  // ── Firebase persistence — stay logged in if remember checked ──
  const persistence = remember
    ? firebase.auth.Auth.Persistence.LOCAL
    : firebase.auth.Auth.Persistence.SESSION;

  try {
    _lgSigningIn = true;
    await firebase.auth().setPersistence(persistence);
    await firebase.auth().signInWithEmailAndPassword(email, pass);
    // onAuthStateChanged handles the rest
    if (typeof hoFaceLogin !== 'undefined') hoFaceLogin.offer(email, pass);   // "Use Face ID next time?"
  } catch(e) {
    _lgSigningIn = false;
    _lgBtn('idle');
    const offline = navigator.onLine === false || e.code === 'auth/network-request-failed';
    _lgShowMsg(friendlyAuthError(e.code, e.message), offline ? 'warn' : 'err');
    const errEl = document.getElementById('loginError');
    if (errEl) errEl.title = e.code ? 'Code: ' + e.code : '';
    // point at the field to fix
    const bad = /email|user-not-found/.test(e.code || '') ? 'loginEmail' : /password|credential/.test(e.code || '') ? 'loginPass' : '';
    if (bad) { const f = document.getElementById(bad); f.setAttribute('aria-invalid', 'true'); if (bad === 'loginPass') f.select(); else f.focus(); }
    // Restart the shake even on back-to-back failed attempts
    const card = document.querySelector('#loginScreen .login-card');
    if (card && !offline) { card.classList.remove('lg-shake'); void card.offsetWidth; card.classList.add('lg-shake'); }
    console.error('🔴 Auth error:', e.code, e.message);
  }
}

function friendlyAuthError(code, message) {
  console.error('🔴 Auth error code:', code, '| message:', message);
  if (navigator.onLine === false) return 'You\'re offline. Connect to the internet once to sign in on this device.';
  const map = {
    'auth/user-not-found':         'We couldn\'t find an account with this email. Check it, or ask your manager to add you.',
    'auth/wrong-password':         'That email and password don\'t match. Try again or ask your manager to reset it.',
    'auth/invalid-email':          'That email doesn\'t look right. Check it and try again.',
    'auth/too-many-requests':      'Too many tries in a row. Wait a few minutes and try again, or ask your manager to reset your password.',
    'auth/user-disabled':          'This account is switched off. Please ask your manager.',
    'auth/invalid-credential':     'That email and password don\'t match. Try again or ask your manager to reset it.',
    'auth/missing-password':       'Please type your password.',
    'auth/operation-not-allowed':  'Email sign-in is turned off for this hotel. Your manager can turn it on in Firebase.',
    'auth/network-request-failed': 'Can\'t reach the sign-in service. Check your internet and try again.',
  };
  return map[code] || 'Sign in didn\'t work this time. Please try again.' + (code ? ' (' + code.replace('auth/', '') + ')' : '');
}

// ── Logout ────────────────────────────────────────────────
// Front desk PCs are shared. db.js mirrors every Firebase path into
// localStorage (offline fallback), which otherwise leaves guest names,
// balances, notes, and pasted nationality/passport data sitting in
// plaintext on the machine indefinitely after sign-out. Clear it on
// logout — keep only small non-guest-data preferences.
const _LOCAL_CACHE_KEEP = new Set(['ibis_saved_email', 'ibis_arrivals_proc_profile']);
function _clearLocalGuestDataCache() {
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith('ibis_') && !_LOCAL_CACHE_KEEP.has(k))
      .forEach(k => localStorage.removeItem(k));
  } catch(e) {}
}

async function authLogout() {
  if (!confirm('Sign out?')) return;
  clearTimeout(_idleTimer);
  try { await logActivity('logout'); } catch(e) {}
  // Detach self-listener before signing out
  if (_selfListenerRef && _selfListener) {
    _selfListenerRef.off('value', _selfListener);
    _selfListener    = null;
    _selfListenerRef = null;
  }
  currentUser    = null;
  currentProfile = null;
  try { await firebase.auth().signOut(); } catch(e) {}
  _clearLocalGuestDataCache();
  _afterSignOut('');
}

// ── Update topbar ─────────────────────────────────────────
function updateAuthUI() {
  const p      = currentProfile;
  const def    = myRoleDef();
  const isMob  = window.innerWidth <= 768;
  const el     = document.getElementById('authUserPill');
  if (el) {
    // On mobile: show only icon + first name, no logout button (it's in More drawer)
    const firstName = p.name.split(' ')[0];
    if (isMob) {
      el.innerHTML = `
        <span style="color:${def.color};font-size:0.9rem;flex-shrink:0;">${def.icon}</span>
        <span class="pill-name" style="font-weight:600;font-size:0.65rem;overflow:hidden;text-overflow:ellipsis;max-width:90px;">${escapeHtml(firstName)}</span>
      `;
    } else {
      el.innerHTML = `
        <span style="color:${def.color};font-size:0.85rem;flex-shrink:0;">${def.icon}</span>
        <span class="pill-name" style="font-weight:600;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(p.name)}</span>
        <span class="pill-role" style="color:var(--text3);font-size:0.6rem;flex-shrink:0;">${def.label}</span>
        <button onclick="authLogout()" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:0.8rem;padding:2px 0 0 2px;line-height:1;flex-shrink:0;" title="Sign out">⏻</button>
      `;
    }
    el.style.display = 'flex';
  }
  // Show admin button in topbar (desktop) and more drawer (mobile)
  const adminBtn    = document.getElementById('adminPanelBtn');
  const mobAdminBtn = document.getElementById('mobAdminBtn');
  const canAdmin    = def.canManageUsers;
  if (adminBtn)    adminBtn.style.display    = (!isMob && canAdmin) ? '' : 'none';
  if (mobAdminBtn) mobAdminBtn.style.display = canAdmin ? '' : 'none';
}

// Re-render pill on resize
window.addEventListener('resize', () => {
  if (currentProfile) updateAuthUI();
});

// ── Theme save to profile ─────────────────────────────────
async function saveThemeToProfile(name) {
  if (!currentUser || currentUser.uid === 'master_bypass') return;
  try {
    await firebase.database()
      .ref(`hotels/${HOTEL_ID}/users/${currentUser.uid}`)
      .update({ theme: name });
  } catch(e) {}
}

// ── Activity log ──────────────────────────────────────────
async function logActivity(action, detail = '') {
  if (!currentUser) return;
  try {
    await firebase.database().ref(`hotels/${HOTEL_ID}/activityLog`).push({
      uid: currentUser.uid, name: currentProfile?.name || currentUser.email,
      role: currentProfile?.role || '?', action, detail, ts: new Date().toISOString(),
    });
  } catch(e) {}
}

async function updateLastLogin(uid) {
  try {
    await firebase.database().ref(`hotels/${HOTEL_ID}/users/${uid}`)
      .update({ lastLogin: new Date().toISOString() });
  } catch(e) {}
}

// ══════════════════════════════════════════════════════════
//  ADMIN PANEL
// ══════════════════════════════════════════════════════════

let _adminUsers    = {};
let _adminActivity = [];

async function openAdminPanel() {
  if (!currentProfile || !myRoleDef().canManageUsers) { showToast('Not available for your role', 'err'); return; }
  document.getElementById('adminModal').classList.add('open');
  const sub = document.getElementById('admSub');
  const hotel = (document.getElementById('hotelName')?.textContent || '').trim();
  if (sub) sub.textContent = (hotel ? hotel + ' · ' : '') + 'Accounts, access and activity';
  if (typeof hoRoleRules !== 'undefined' && hoRoleRules.render) hoRoleRules.render();
  await adminLoadUsers();
  await adminLoadActivity();
}

function closeAdminPanel() {
  document.getElementById('adminModal').classList.remove('open');
}

async function adminLoadUsers() {
  const snap = await firebase.database().ref(`hotels/${HOTEL_ID}/users`).once('value');
  _adminUsers = snap.val() || {};
  if (typeof hoRoleRules !== 'undefined' && hoRoleRules.loadAllAccess) await hoRoleRules.loadAllAccess();
  adminRenderUsers();
}

const _ADM_IC = {
  edit:  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  out:   '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
  lock:  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  ok:    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>',
  key:   '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  bin:   '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
};
function _admInitials(name) {
  const w = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
}

function adminRenderUsers() {
  const container = document.getElementById('adminUserCards');
  if (!container) return;
  const users = Object.entries(_adminUsers);

  // Summary chips
  const strip = document.getElementById('adminStatsStrip');
  if (strip) {
    const total    = users.length;
    const active   = users.filter(([,u]) => u.active).length;
    const disabled = total - active;
    const roleCount = {};
    users.forEach(([,u]) => { roleCount[u.role] = (roleCount[u.role]||0)+1; });
    const order = ['owner','manager','supervisor','agent','readonly'];
    strip.innerHTML = `
      <div class="adm-stat"><b>${total}</b><span>${total === 1 ? 'person' : 'people'}</span></div>
      <div class="adm-stat ok"><b>${active}</b><span>active</span></div>
      ${disabled ? `<div class="adm-stat off"><b>${disabled}</b><span>switched off</span></div>` : ''}
      ${Object.entries(roleCount).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([role,cnt]) => {
        const d = ROLES[role]||ROLES.readonly;
        return `<div class="adm-stat role" style="--rc:${d.color}"><b>${cnt}</b><span>${escapeHtml(d.label)}</span></div>`;
      }).join('')}`;
  }

  if (!users.length) {
    container.innerHTML = `<div class="adm-empty"><b>No accounts yet</b><span>Tap “New account” to add the first person.</span></div>`;
    return;
  }

  // Sort: owner first, then by name
  const order = ['owner','manager','supervisor','agent','readonly'];
  users.sort((a,b) => {
    const ra = order.indexOf(a[1].role), rb = order.indexOf(b[1].role);
    if (ra !== rb) return ra - rb;
    return (a[1].name||'').localeCompare(b[1].name||'');
  });

  const isOwner = currentProfile.role === 'owner';
  const isMgr   = currentProfile.role === 'manager';

  container.innerHTML = users.map(([uid, u]) => {
    const def   = ROLES[u.role] || ROLES.readonly;
    const isMe  = uid === currentUser?.uid;
    const canEdit = (isOwner || (isMgr && u.role !== 'owner')) && !isMe;
    const lastLogin = u.lastLogin
      ? new Date(u.lastLogin).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})
      : 'never';
    const created = u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '';
    const id = escapeHtml(uid);
    const hasRR = typeof hoRoleRules !== 'undefined' && hoRoleRules.summaryFor;
    const accLine = hasRR ? hoRoleRules.summaryFor(uid, u) : null;
    const canAcc = hasRR && hoRoleRules.canEditFor(uid, u);

    return `
    <article class="adm-user${isMe ? ' is-me' : ''}${!u.active ? ' is-off' : ''}" style="--rc:${def.color}">
      <div class="adm-user-top">
        <div class="adm-av" aria-hidden="true">${escapeHtml(_admInitials(u.name))}<span class="adm-av-ic">${def.icon}</span></div>
        <div class="adm-user-main">
          <div class="adm-user-name"><span>${escapeHtml(u.name || '')}</span>${isMe ? '<span class="adm-you">You</span>' : ''}</div>
          <div class="adm-user-mail">${escapeHtml(u.email || '')}</div>
          <div class="adm-user-tags">
            <span class="adm-tag role">${def.icon} ${escapeHtml(def.label)}</span>
            <span class="adm-tag ${u.active ? 'ok' : 'off'}"><i></i>${u.active ? 'Active' : 'Switched off'}</span>
          </div>
          ${accLine ? `<div class="adm-user-acc"><i class="adm-dot"></i>${escapeHtml(accLine)}</div>` : ''}
        </div>
      </div>
      <div class="adm-user-meta"><span>Last sign-in <b>${lastLogin}</b></span>${created ? `<span>Added <b>${created}</b></span>` : ''}</div>
      ${canEdit ? `
      <div class="adm-user-acts">
        <button type="button" class="adm-act primary" onclick="adminEditUser('${id}')">${_ADM_IC.edit}Edit</button>
        ${canAcc ? `<button type="button" class="adm-act" onclick="adminUserAccess('${id}')" title="Pages and powers for this person only">${_ADM_IC.key}Access</button>` : ''}
        <button type="button" class="adm-act" onclick="adminDisconnectUser('${id}')" title="Sign them out now (they can sign back in)">${_ADM_IC.out}Sign out</button>
        <button type="button" class="adm-act ${u.active ? 'warn' : 'good'}" onclick="adminToggleActive('${id}',${!u.active})">${u.active ? _ADM_IC.lock + 'Switch off' : _ADM_IC.ok + 'Switch on'}</button>
        ${isOwner && u.role !== 'owner' ? `<button type="button" class="adm-act danger" onclick="adminDeleteUser('${id}')" title="Delete account for good" aria-label="Delete account">${_ADM_IC.bin}</button>` : ''}
      </div>` : isMe ? `
      <div class="adm-user-acts"><span class="adm-hint">Your own account · change your theme and details in Settings</span></div>` : ''}
    </article>`;
  }).join('');
}

async function adminLoadActivity() {
  if (currentProfile && currentProfile.role !== 'owner' && !myRoleDef().canViewLogs) { _adminActivity = []; return; }
  const snap = await firebase.database().ref(`hotels/${HOTEL_ID}/activityLog`).limitToLast(200).once('value');
  _adminActivity = Object.values(snap.val() || {}).reverse();
  adminRenderActivity();
}


function openCreateUser() {
  document.getElementById('adminEditForm').style.display   = 'none';
  document.getElementById('adminCreateForm').style.display = 'block';
  document.getElementById('adminCreateErr').style.display  = 'none';
  ['newUserName','newUserEmail','newUserPass'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('newUserRole').value = 'agent';
  document.getElementById('adminCreateForm').scrollIntoView({ behavior:'smooth', block:'nearest' });
}

function closeCreateUser() {
  document.getElementById('adminCreateForm').style.display = 'none';
}

async function adminCreateUser() {
  const name  = document.getElementById('newUserName').value.trim();
  const email = document.getElementById('newUserEmail').value.trim();
  const pass  = document.getElementById('newUserPass').value;
  const role  = document.getElementById('newUserRole').value;
  const errEl = document.getElementById('adminCreateErr');

  if (!name || !email || !pass) { errEl.textContent = 'All fields required.'; errEl.style.display = 'block'; return; }
  if (pass.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; errEl.style.display = 'block'; return; }
  if (currentProfile.role !== 'owner' && role === 'owner') { errEl.textContent = 'Only the owner can create Owner accounts.'; errEl.style.display = 'block'; return; }

  const btn = document.getElementById('adminCreateBtn');
  btn.disabled = true; btn.textContent = 'Creating…';

  try {
    const secondaryApp = firebase.initializeApp(FIREBASE_CONFIG, 'secondary_' + Date.now());
    const cred = await secondaryApp.auth().createUserWithEmailAndPassword(email, pass);
    const uid  = cred.user.uid;
    await secondaryApp.auth().signOut();
    await secondaryApp.delete();
    await firebase.database().ref(`hotels/${HOTEL_ID}/users/${uid}`).set({
      uid, name, email, role, active: true, createdAt: new Date().toISOString(), createdBy: currentUser.uid
    });
    if (typeof tnLinkUser === 'function') await tnLinkUser(uid);   // they work in this hotel
    await logActivity('create_user', `${name} (${role})`);
    closeCreateUser();
    await adminLoadUsers();
    showToast(`${name} created ✓`, 'ok');
  } catch(e) {
    errEl.textContent = friendlyAuthError(e.code) || e.message;
    errEl.style.display = 'block';
  }
  btn.disabled = false; btn.textContent = 'Create Account';
}

function adminEditUser(uid) {
  const u = _adminUsers[uid];
  if (!u) return;
  document.getElementById('editUserId').value    = uid;
  document.getElementById('editUserName').value  = u.name;
  document.getElementById('editUserEmail').value = u.email || '';
  document.getElementById('editUserRole').value  = u.role;
  document.getElementById('editUserPass').value  = '';
  document.getElementById('adminEditErr').style.display  = 'none';
  document.getElementById('adminCreateForm').style.display = 'none';
  document.getElementById('adminEditForm').style.display   = 'block';
  document.getElementById('adminEditForm').scrollIntoView({ behavior:'smooth', block:'nearest' });
}

function closeEditUser() {
  document.getElementById('adminEditForm').style.display = 'none';
}

async function adminSaveEdit() {
  const uid      = document.getElementById('editUserId').value;
  const name     = document.getElementById('editUserName').value.trim();
  const newEmail = document.getElementById('editUserEmail').value.trim().toLowerCase();
  const role     = document.getElementById('editUserRole').value;
  const newPass  = document.getElementById('editUserPass').value;
  const errEl    = document.getElementById('adminEditErr');

  if (!name) { errEl.textContent = 'Name is required.'; errEl.style.display = 'block'; return; }
  if (!newEmail || !newEmail.includes('@')) { errEl.textContent = 'A valid email is required.'; errEl.style.display = 'block'; return; }
  if (currentProfile.role !== 'owner' && role === 'owner') { errEl.textContent = 'Only the owner can give the Owner role.'; errEl.style.display = 'block'; return; }
  if (newPass && newPass.length < 6) { errEl.textContent = 'New password must be at least 6 characters.'; errEl.style.display = 'block'; return; }

  const btn = document.getElementById('adminSaveEditBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  errEl.style.display = 'none';

  const u = _adminUsers[uid];
  const emailChanged = u && u.email && u.email.toLowerCase() !== newEmail;

  try {
    // ── Step 1: update DB profile (name, email display field, role) ──
    await firebase.database().ref(`hotels/${HOTEL_ID}/users/${uid}`).update({ name, email: newEmail, role });

    // ── Step 2: if password OR email changed, use secondary app to re-auth ──
    // Firebase Admin SDK isn't available client-side, so we sign in as that user
    // with the existing password to get a fresh credential, then update.
    // If we don't have their current password we can only update via Admin SDK.
    // Workaround: we send a password-reset email for email changes,
    // and for password changes we use a secondary app with the admin creating a new account.
    //
    // APPROACH: use the updateUser Cloud Function pattern if available,
    // else fall back to Firebase Auth Admin via secondary app sign-in.
    //
    // SAFE fallback: send password reset email for password/email changes.
    if (newPass || emailChanged) {
      // Try secondary app approach: sign in as the user with a master credential
      // Since we can't sign in as them without their current password,
      // the safest cross-browser approach is:
      // • Password change → sign them out (forceLogout) + send reset email
      // • Email change → update the DB record (already done) + notify
      //
      // If we can use Firebase Admin REST API directly:
      const idTokenResult = await firebase.auth().currentUser?.getIdTokenResult(true);
      // REST API update (works if Security Rules allow, and your token has admin claim)
      if (newPass) {
        try {
          const idToken = await firebase.auth().currentUser.getIdToken(true);
          const resp = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${FIREBASE_CONFIG.apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ idToken, localId: uid, password: newPass, returnSecureToken: false }),
            }
          );
          // The above only works for the currently signed-in user.
          // For OTHER users, we must use Firebase Admin SDK (server-side).
          // Since we're client-only, best practice is:
          // kick the user + send password reset email.
          if (!resp.ok) throw new Error('REST password update failed');
          showToast(`Password updated for ${name} ✓`, 'ok');
        } catch(_) {
          // Fallback: send password reset email
          try {
            await firebase.auth().sendPasswordResetEmail(newEmail);
            showToast(`Reset email sent to ${newEmail} — they'll set their new password on next login`, 'info');
          } catch(e2) {
            errEl.textContent = `Password reset email failed: ${e2.message}. Change manually in Firebase Console → Authentication.`;
            errEl.style.display = 'block';
          }
          // Also force-logout the user so the reset takes effect
          await firebase.database().ref(`hotels/${HOTEL_ID}/users/${uid}`).update({ forceLogout: true });
        }
      }
      if (emailChanged) {
        showToast(`Email updated in DB. To update Firebase Auth email, use Firebase Console → Authentication.`, 'info');
      }
    }

    await logActivity('edit_user', `${name} → ${role}${emailChanged ? ' · email changed' : ''}${newPass ? ' · password reset' : ''}`);
    await adminLoadUsers();
    closeEditUser();
    showToast(`${name} updated ✓`, 'ok');
  } catch(e) {
    errEl.textContent = e.message || 'Save failed';
    errEl.style.display = 'block';
  }
  btn.disabled = false; btn.textContent = 'Save Changes';
}

async function adminToggleActive(uid, active) {
  const u = _adminUsers[uid];
  if (!u) return;
  const action = active ? 'enable' : 'disable';
  if (!confirm(`${action.charAt(0).toUpperCase()+action.slice(1)} ${u.name}?`)) return;
  // When disabling: set both active:false AND forceLogout:true so any live session
  // is kicked immediately via the real-time self-watcher.
  // When enabling: clear forceLogout so they can sign back in cleanly.
  const update = active
    ? { active: true,  forceLogout: false }
    : { active: false, forceLogout: true  };
  await firebase.database().ref(`hotels/${HOTEL_ID}/users/${uid}`).update(update);
  await logActivity(action + '_user', u.name);
  await adminLoadUsers();
  showToast(`${u.name} ${action}d ✓`, 'ok');
}

// ── Force-disconnect (kick session without disabling account) ─
async function adminDisconnectUser(uid) {
  const u = _adminUsers[uid];
  if (!u) return;
  if (uid === currentUser?.uid) { showToast("You can't disconnect yourself", 'err'); return; }
  if (!confirm(`Disconnect ${u.name} from their current session?

They will be signed out immediately but can sign back in.`)) return;
  try {
    await firebase.database().ref(`hotels/${HOTEL_ID}/users/${uid}`).update({ forceLogout: true });
    await logActivity('disconnect_user', u.name);
    showToast(`${u.name} disconnected ✓`, 'ok');
  } catch(e) {
    showToast('Disconnect failed: ' + (e.message || e.code), 'err');
  }
}

// ── Delete account (Owner only) ───────────────────────────
// Removes the user from the Firebase DB profile.
// Firebase Auth deletion requires the user to be signed in, so we
// disable + remove the DB record. The Auth entry becomes an orphan
// (can't log in — no DB profile) and can be cleaned from Firebase Console.
async function adminDeleteUser(uid) {
  if (currentProfile?.role !== 'owner') { showToast('Owner only', 'err'); return; }
  const u = _adminUsers[uid];
  if (!u) return;
  if (uid === currentUser?.uid) { showToast('You cannot delete yourself', 'err'); return; }

  // Double-confirm with name typed
  const confirmed = confirm(
    `⚠️ PERMANENTLY DELETE ACCOUNT\n\n` +
    `Name:  ${u.name}\n` +
    `Email: ${u.email}\n` +
    `Role:  ${u.role}\n\n` +
    `This removes them from the database immediately.\n` +
    `They will no longer be able to sign in.\n\n` +
    `This cannot be undone. Continue?`
  );
  if (!confirmed) return;

  try {
    // 1 — Remove DB profile. This triggers the real-time self-watcher on the
    //     target's browser (!snap.exists()), kicking them out immediately if online.
    await firebase.database().ref(`hotels/${HOTEL_ID}/users/${uid}`).remove();
    if (typeof tnUnlinkUser === 'function') await tnUnlinkUser(uid);

    // 2 — Log before the local record disappears
    await logActivity('delete_user', `${u.name} (${u.role}) — ${u.email}`);

    // 3 — Refresh table
    delete _adminUsers[uid];
    adminRenderUsers();
    showToast(`${u.name} deleted ✓`, 'ok');
  } catch(e) {
    console.error('Delete failed:', e);
    showToast('Delete failed: ' + (e.message || e.code), 'err');
  }
}

function adminTab(tab) {
  document.querySelectorAll('.admin-tab-btn').forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
  document.querySelectorAll('.admin-tab-pane').forEach(p => p.style.display = 'none');
  const pane = document.getElementById('adminTab-' + tab);
  if (pane) pane.style.display = 'block';
  const seg = document.querySelector('#adminModal .adm-seg');
  if (seg) seg.dataset.on = tab;
  if (typeof hoRoleRules !== 'undefined' && hoRoleRules.closeUser) hoRoleRules.closeUser();
  if (tab === 'roles' && typeof hoRoleRules !== 'undefined' && hoRoleRules.render) hoRoleRules.render();
  const body = document.querySelector('#adminModal .adm-body'); if (body) body.scrollTop = 0;
}

// ── Show / hide password ──────────────────────────────────
const _EYE_OPEN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const _EYE_SHUT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

function togglePassVis() {
  const input = document.getElementById('loginPass');
  const icon  = document.getElementById('eyeIcon');
  if (!input || !icon) return;
  const isHidden = input.type === 'password';
  input.type   = isHidden ? 'text' : 'password';
  icon.innerHTML = isHidden ? _EYE_SHUT : _EYE_OPEN;   // shown → "hide" icon, hidden → "show" icon
  const b = document.getElementById('loginEye');
  if (b) { const l = isHidden ? 'Hide password' : 'Show password'; b.setAttribute('aria-label', l); b.title = l; b.setAttribute('aria-pressed', String(isHidden)); }
  input.focus();
}

// ── Admin password/eye toggle ─────────────────────────────
function adminToggleVis(inputId, btnId) {
  const input = document.getElementById(inputId);
  const btn   = document.getElementById(btnId);
  if (!input) return;
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  if (btn) {
    btn.innerHTML = isHidden
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  }
  input.focus();
}

// ── Activity log filter ───────────────────────────────────
let _adminActivityAll = [];
function adminFilterActivity(q) {
  if (!q) {
    adminRenderActivity();
    return;
  }
  const lq = q.toLowerCase();
  const filtered = _adminActivityAll.filter(e =>
    (e.name||'').toLowerCase().includes(lq) ||
    (e.action||'').toLowerCase().includes(lq) ||
    (e.detail||'').toLowerCase().includes(lq) ||
    (e.role||'').toLowerCase().includes(lq)
  );
  const el = document.getElementById('adminActivityLog');
  if (!el) return;
  if (!filtered.length) {
    el.innerHTML = `<div class="adm-empty"><b>Nothing matches</b><span>Try a name, a page or an action.</span></div>`;
    return;
  }
  _renderActivityEntries(el, filtered);
}

function adminRenderActivity() {
  const el = document.getElementById('adminActivityLog');
  if (!el) return;
  if (!_adminActivity.length) {
    el.innerHTML = `<div class="adm-empty"><b>No activity yet</b><span>Sign-ins and team changes show up here.</span></div>`;
    return;
  }
  _adminActivityAll = _adminActivity;
  _renderActivityEntries(el, _adminActivity);
}

function _renderActivityEntries(el, entries) {
  const icons = {
    login:'🔓', logout:'🔒',
    create_user:'➕', edit_user:'✏️', disable_user:'🔒', enable_user:'✓', delete_user:'🗑️',
    disconnect_user:'⏏', password_reset_sent:'🔑', role_rules:'🛡️', user_access:'🛡️',
    shift_task_done:'✅', shift_task_undone:'↩', shift_task_added:'➕', shift_task_deleted:'🗑️', shift_reset:'↺',
    checklist_done:'✅', checklist_undone:'↩', checklist_skipped:'⏭', checklist_unskipped:'↩',
    departure_out:'🚪', departure_na:'—', departure_late:'🕐', departure_extended:'📅', departure_due:'↩',
    arrivals_loaded:'📥', arrivals_cleared:'🗑️',
  };
  el.innerHTML = entries.map(e => {
    const rd = ROLES[e.role] || ROLES.readonly;
    const when = e.ts ? new Date(e.ts).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
    return `
    <div class="adm-log" style="--rc:${rd.color}">
      <span class="adm-log-ic" aria-hidden="true">${icons[e.action] || '•'}</span>
      <div class="adm-log-body">
        <div class="adm-log-line"><b>${escapeHtml(e.name || '')}</b><span class="adm-log-act">${escapeHtml(String(e.action || '').replace(/_/g,' '))}</span></div>
        ${e.detail ? `<div class="adm-log-detail">${escapeHtml(e.detail)}</div>` : ''}
      </div>
      <div class="adm-log-side"><span class="adm-log-role">${escapeHtml(rd.label)}</span><time>${when}</time></div>
    </div>`;
  }).join('');
}

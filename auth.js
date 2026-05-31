// ═══════════════════════════════════════════════════════════
//  auth.js  —  Full Authentication & Role Management System
//  Ibis Styles Dubai · Front Desk Ops · 2026
//
//  Roles:
//    owner      — full access + manage users + all settings
//    manager    — all modules + manage agents (no owner controls)
//    supervisor — all ops modules + checklist + reports
//    agent      — departures, arrivals, shifts, checklist only
//    readonly   — view only, no actions
// ═══════════════════════════════════════════════════════════

// ── Role definitions ──────────────────────────────────────
const ROLES = {
  owner: {
    label: 'Owner',
    color: '#f0a43a',
    icon: '👑',
    panels: ['departures','arrivals','purpose','shifts','checklist','nationality','rent','audit','immig','tourism'],
    canManageUsers: true,
    canExport: true,
    canImport: true,
    canClear: true,
    canEditChecklist: true,
    canEditShifts: true,
    canReports: true,
  },
  manager: {
    label: 'Manager',
    color: '#8b7cf8',
    icon: '🏅',
    panels: ['departures','arrivals','purpose','shifts','checklist','nationality','rent','audit','immig','tourism'],
    canManageUsers: true,
    canExport: true,
    canImport: false,
    canClear: false,
    canEditChecklist: true,
    canEditShifts: true,
    canReports: true,
  },
  supervisor: {
    label: 'Supervisor',
    color: '#5ab4e8',
    icon: '⭐',
    panels: ['departures','arrivals','purpose','shifts','checklist','nationality','rent','audit','immig','tourism'],
    canManageUsers: false,
    canExport: true,
    canImport: false,
    canClear: false,
    canEditChecklist: true,
    canEditShifts: true,
    canReports: true,
  },
  agent: {
    label: 'Agent',
    color: '#3ecf8e',
    icon: '🛎️',
    panels: ['departures','arrivals','shifts','checklist'],
    canManageUsers: false,
    canExport: false,
    canImport: false,
    canClear: false,
    canEditChecklist: false,
    canEditShifts: false,
    canReports: false,
  },
  readonly: {
    label: 'Read Only',
    color: '#888',
    icon: '👁️',
    panels: ['departures','arrivals','shifts'],
    canManageUsers: false,
    canExport: false,
    canImport: false,
    canClear: false,
    canEditChecklist: false,
    canEditShifts: false,
    canReports: false,
  },
};

// ── Current session ───────────────────────────────────────
let currentUser    = null;   // Firebase auth user
let currentProfile = null;   // { uid, name, email, role, active }

// ── Init auth ─────────────────────────────────────────────
function authInit() {
  firebase.auth().onAuthStateChanged(async user => {
    if (!user) {
      showLoginScreen();
      return;
    }
    const profile = await loadUserProfile(user.uid);
    if (!profile || !profile.active) {
      await firebase.auth().signOut();
      showLoginScreen('Account disabled or not found. Contact your manager.');
      return;
    }
    currentUser    = user;
    currentProfile = profile;
    await logActivity('login');
    applyRole(profile.role);
    hideLoginScreen();
    updateAuthUI();
  });
}

// ── Load user profile from DB ─────────────────────────────
async function loadUserProfile(uid) {
  try {
    const snap = await firebase.database()
      .ref(`hotels/${HOTEL_ID}/users/${uid}`)
      .once('value');
    return snap.val();
  } catch(e) {
    console.error('loadUserProfile error:', e);
    return null;
  }
}

// ── Apply role — show/hide nav items and features ─────────
function applyRole(role) {
  const def = ROLES[role] || ROLES.readonly;

  // Sidebar nav
  document.querySelectorAll('.nav-item[data-panel]').forEach(el => {
    const panel = el.dataset.panel;
    el.style.display = def.panels.includes(panel) ? '' : 'none';
  });

  // Mobile bottom nav
  document.querySelectorAll('.mob-nav-btn[data-panel]').forEach(el => {
    const panel = el.dataset.panel;
    el.style.display = def.panels.includes(panel) ? '' : 'none';
  });

  // Mobile more drawer
  document.querySelectorAll('.mob-more-item[data-panel]').forEach(el => {
    const panel = el.dataset.panel;
    el.style.display = def.panels.includes(panel) ? '' : 'none';
  });

  // Export / Import / Clear buttons
  document.querySelectorAll('[data-require="canExport"]').forEach(el =>
    el.style.display = def.canExport ? '' : 'none');
  document.querySelectorAll('[data-require="canImport"]').forEach(el =>
    el.style.display = def.canImport ? '' : 'none');
  document.querySelectorAll('[data-require="canClear"]').forEach(el =>
    el.style.display = def.canClear ? '' : 'none');
  document.querySelectorAll('[data-require="canReports"]').forEach(el =>
    el.style.display = def.canReports ? '' : 'none');

  // Checklist edit mode
  document.querySelectorAll('[data-require="canEditChecklist"]').forEach(el =>
    el.style.display = def.canEditChecklist ? '' : 'none');

  // Admin panel access
  const adminBtn = document.getElementById('adminPanelBtn');
  if (adminBtn) adminBtn.style.display = def.canManageUsers ? '' : 'none';

  // Read-only overlay
  if (role === 'readonly') {
    document.body.classList.add('role-readonly');
  } else {
    document.body.classList.remove('role-readonly');
  }
}

// ── Show login screen ─────────────────────────────────────
function showLoginScreen(errorMsg) {
  document.getElementById('loginScreen').style.display  = 'flex';
  document.getElementById('appWrapper').style.display   = 'none';
  if (errorMsg) {
    const el = document.getElementById('loginError');
    if (el) { el.textContent = errorMsg; el.style.display = 'block'; }
  }
}

function hideLoginScreen() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appWrapper').style.display  = '';
}

// ── Login ─────────────────────────────────────────────────
async function authLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPass').value;
  const errEl = document.getElementById('loginError');
  const btn   = document.getElementById('loginBtn');

  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Signing in…';

  // ── Master bypass (use when Firebase Auth is rate-limited) ──
  if (pass === MASTER_PASS) {
    masterBypass(email);
    btn.disabled = false;
    btn.textContent = 'Sign In';
    return;
  }

  try {
    await firebase.auth().signInWithEmailAndPassword(email, pass);
    // onAuthStateChanged handles the rest
  } catch(e) {
    btn.disabled = false;
    btn.textContent = 'Sign In';
    errEl.textContent = friendlyAuthError(e.code, e.message);
    errEl.style.display = 'block';
    console.error('🔴 Full error object:', e);
  }
}

function friendlyAuthError(code) {
  const map = {
    'auth/user-not-found':      'No account found with this email.',
    'auth/wrong-password':      'Incorrect password.',
    'auth/invalid-email':       'Invalid email address.',
    'auth/too-many-requests':   'Too many attempts. Try again in a few minutes.',
    'auth/user-disabled':       'This account has been disabled.',
    'auth/invalid-credential':  'Incorrect email or password.',
  };
  return map[code] || 'Sign in failed. Please try again.';
}

// ── Logout ────────────────────────────────────────────────
async function authLogout() {
  await logActivity('logout');
  currentUser    = null;
  currentProfile = null;
  await firebase.auth().signOut();
}

// ── Update topbar with user info ──────────────────────────
function updateAuthUI() {
  const p   = currentProfile;
  const def = ROLES[p.role] || ROLES.readonly;
  const el  = document.getElementById('authUserPill');
  if (el) {
    el.innerHTML = `
      <span style="color:${def.color};font-size:0.85rem;">${def.icon}</span>
      <span style="font-weight:600;">${p.name}</span>
      <span style="color:var(--text3);font-size:0.62rem;">${def.label}</span>
      <button onclick="authLogout()" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:0.7rem;padding:0 0 0 4px;" title="Sign out">⏻</button>
    `;
    el.style.display = 'flex';
  }
}

// ── Activity log ──────────────────────────────────────────
async function logActivity(action, detail = '') {
  if (!currentUser) return;
  const entry = {
    uid:    currentUser.uid,
    name:   currentProfile?.name || currentUser.email,
    role:   currentProfile?.role || '?',
    action,
    detail,
    ts:     new Date().toISOString(),
  };
  try {
    await firebase.database()
      .ref(`hotels/${HOTEL_ID}/activityLog`)
      .push(entry);
  } catch(e) {}
}

// ══════════════════════════════════════════════════════════
//  ADMIN PANEL
// ══════════════════════════════════════════════════════════

let _adminUsers    = {};
let _adminActivity = [];

async function openAdminPanel() {
  if (!currentProfile?.role || !ROLES[currentProfile.role]?.canManageUsers) {
    showToast('Access denied', 'err'); return;
  }
  document.getElementById('adminModal').classList.add('open');
  await adminLoadUsers();
  await adminLoadActivity();
}

function closeAdminPanel() {
  document.getElementById('adminModal').classList.remove('open');
}

// ── Load all users ────────────────────────────────────────
async function adminLoadUsers() {
  const snap = await firebase.database()
    .ref(`hotels/${HOTEL_ID}/users`)
    .once('value');
  _adminUsers = snap.val() || {};
  adminRenderUsers();
}

function adminRenderUsers() {
  const tbody = document.getElementById('adminUserTable');
  if (!tbody) return;

  const users = Object.entries(_adminUsers);
  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text3);">No users yet</td></tr>`;
    return;
  }

  tbody.innerHTML = users.map(([uid, u]) => {
    const def     = ROLES[u.role] || ROLES.readonly;
    const isMe    = uid === currentUser?.uid;
    const canEdit = currentProfile.role === 'owner' || (currentProfile.role === 'manager' && u.role !== 'owner');
    return `<tr class="${isMe ? 'admin-row-me' : ''}">
      <td>
        <div style="font-weight:600;color:var(--text);">${u.name}</div>
        <div style="font-family:var(--mono);font-size:0.62rem;color:var(--text3);">${u.email}</div>
      </td>
      <td>
        <span class="admin-role-badge" style="background:${def.color}22;color:${def.color};border:1px solid ${def.color}44;">
          ${def.icon} ${def.label}
        </span>
      </td>
      <td>
        <span class="admin-status-dot" style="background:${u.active ? 'var(--mint)' : 'var(--rose)'}"></span>
        ${u.active ? 'Active' : 'Disabled'}
      </td>
      <td style="font-family:var(--mono);font-size:0.62rem;color:var(--text3);">
        ${u.lastLogin ? new Date(u.lastLogin).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—'}
      </td>
      <td>
        ${canEdit && !isMe ? `
          <div style="display:flex;gap:4px;">
            <button class="btn sm" onclick="adminEditUser('${uid}')">✏️ Edit</button>
            <button class="btn sm" style="color:var(--rose);" onclick="adminToggleActive('${uid}',${!u.active})">${u.active ? '🔒 Disable' : '✓ Enable'}</button>
          </div>` : isMe ? '<span style="font-size:0.65rem;color:var(--text3);">You</span>' : '—'}
      </td>
    </tr>`;
  }).join('');
}

// ── Load activity log ─────────────────────────────────────
async function adminLoadActivity() {
  const snap = await firebase.database()
    .ref(`hotels/${HOTEL_ID}/activityLog`)
    .limitToLast(100)
    .once('value');
  const raw = snap.val() || {};
  _adminActivity = Object.values(raw).reverse();
  adminRenderActivity();
}

function adminRenderActivity() {
  const el = document.getElementById('adminActivityLog');
  if (!el) return;
  if (!_adminActivity.length) {
    el.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text3);">No activity yet</div>`;
    return;
  }
  const icons = { login:'🔓', logout:'🔒', create_user:'➕', edit_user:'✏️', disable_user:'🔒', enable_user:'✓' };
  el.innerHTML = _adminActivity.map(e => `
    <div class="admin-log-row">
      <span class="admin-log-icon">${icons[e.action] || '•'}</span>
      <div class="admin-log-body">
        <span class="admin-log-name">${e.name}</span>
        <span class="admin-log-action">${e.action.replace(/_/g,' ')}</span>
        ${e.detail ? `<span class="admin-log-detail">${e.detail}</span>` : ''}
      </div>
      <span class="admin-log-time">${new Date(e.ts).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</span>
    </div>`).join('');
}

// ── Create new user ───────────────────────────────────────
function openCreateUser() {
  document.getElementById('adminCreateForm').style.display = 'block';
  document.getElementById('adminCreateErr').style.display  = 'none';
  document.getElementById('newUserName').value  = '';
  document.getElementById('newUserEmail').value = '';
  document.getElementById('newUserPass').value  = '';
  document.getElementById('newUserRole').value  = 'agent';
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

  if (!name || !email || !pass) {
    errEl.textContent = 'All fields are required.';
    errEl.style.display = 'block'; return;
  }
  if (pass.length < 6) {
    errEl.textContent = 'Password must be at least 6 characters.';
    errEl.style.display = 'block'; return;
  }

  // Managers cannot create owners
  if (currentProfile.role === 'manager' && role === 'owner') {
    errEl.textContent = 'Managers cannot create Owner accounts.';
    errEl.style.display = 'block'; return;
  }

  const btn = document.getElementById('adminCreateBtn');
  btn.disabled = true; btn.textContent = 'Creating…';

  try {
    // Create Firebase Auth user via a secondary app instance so we don't sign out current user
    const secondaryApp = firebase.initializeApp(FIREBASE_CONFIG, 'secondary_' + Date.now());
    const cred = await secondaryApp.auth().createUserWithEmailAndPassword(email, pass);
    const uid  = cred.user.uid;
    await secondaryApp.auth().signOut();
    await secondaryApp.delete();

    // Save profile to DB
    const profile = { uid, name, email, role, active: true, createdAt: new Date().toISOString(), createdBy: currentUser.uid };
    await firebase.database().ref(`hotels/${HOTEL_ID}/users/${uid}`).set(profile);
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

// ── Edit user ─────────────────────────────────────────────
function adminEditUser(uid) {
  const u = _adminUsers[uid];
  if (!u) return;
  document.getElementById('editUserId').value    = uid;
  document.getElementById('editUserName').value  = u.name;
  document.getElementById('editUserRole').value  = u.role;
  document.getElementById('editUserPass').value  = '';
  document.getElementById('adminEditErr').style.display = 'none';
  document.getElementById('adminEditForm').style.display = 'block';
}

function closeEditUser() {
  document.getElementById('adminEditForm').style.display = 'none';
}

async function adminSaveEdit() {
  const uid  = document.getElementById('editUserId').value;
  const name = document.getElementById('editUserName').value.trim();
  const role = document.getElementById('editUserRole').value;
  const pass = document.getElementById('editUserPass').value;
  const errEl = document.getElementById('adminEditErr');

  if (!name) { errEl.textContent = 'Name is required.'; errEl.style.display = 'block'; return; }
  if (currentProfile.role === 'manager' && role === 'owner') {
    errEl.textContent = 'Managers cannot assign Owner role.';
    errEl.style.display = 'block'; return;
  }

  const btn = document.getElementById('adminSaveEditBtn');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    await firebase.database().ref(`hotels/${HOTEL_ID}/users/${uid}`).update({ name, role });
    await logActivity('edit_user', `${name} → ${role}`);
    await adminLoadUsers();
    closeEditUser();
    showToast('User updated ✓', 'ok');
  } catch(e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  }
  btn.disabled = false; btn.textContent = 'Save Changes';
}

// ── Toggle active ─────────────────────────────────────────
async function adminToggleActive(uid, active) {
  const u = _adminUsers[uid];
  if (!u) return;
  const action = active ? 'enable' : 'disable';
  if (!confirm(`${action.charAt(0).toUpperCase()+action.slice(1)} ${u.name}?`)) return;
  await firebase.database().ref(`hotels/${HOTEL_ID}/users/${uid}`).update({ active });
  await logActivity(action + '_user', u.name);
  await adminLoadUsers();
  showToast(`${u.name} ${action}d ✓`, 'ok');
}

// ── Admin tab switcher ────────────────────────────────────
function adminTab(tab) {
  document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.admin-tab-pane').forEach(p => p.style.display = 'none');
  document.querySelector(`.admin-tab-btn[data-tab="${tab}"]`).classList.add('active');
  document.getElementById('adminTab-' + tab).style.display = 'block';
}

// ── Update lastLogin on sign in ───────────────────────────
async function updateLastLogin(uid) {
  try {
    await firebase.database()
      .ref(`hotels/${HOTEL_ID}/users/${uid}`)
      .update({ lastLogin: new Date().toISOString() });
  } catch(e) {}
}

// ── Master bypass login ───────────────────────────────────
// Used when Firebase Auth is rate-limited (TOO_MANY_ATTEMPTS).
// Enter any email + the master password to get in as owner.
const MASTER_PASS = "Kazokuyktsha@31";

function masterBypass(email, name) {
  currentUser    = { uid: 'master_bypass', email };
  currentProfile = {
    uid:    'master_bypass',
    name:   name || email.split('@')[0],
    email,
    role:   'owner',
    active: true,
  };
  applyRole('owner');
  hideLoginScreen();
  updateAuthUI();
  showToast('⚠ Master bypass active — Firebase Auth rate limited', 'info');
}

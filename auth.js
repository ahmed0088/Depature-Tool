// ═══════════════════════════════════════════════════════════
//  auth.js  —  Full Authentication & Role Management System
//  Ibis Styles Dubai · Front Desk Ops · 2026
// ═══════════════════════════════════════════════════════════

const ROLES = {
  owner: {
    label: 'Owner', color: '#f0a43a', icon: '👑',
    panels: ['departures','arrivals','purpose','shifts','checklist','nationality','rent','audit','immig','tourism'],
    canManageUsers: true, canExport: true, canImport: true, canClear: true,
    canEditChecklist: true, canEditShifts: true, canReports: true,
  },
  manager: {
    label: 'Manager', color: '#8b7cf8', icon: '🏅',
    panels: ['departures','arrivals','purpose','shifts','checklist','nationality','rent','audit','immig','tourism'],
    canManageUsers: true, canExport: true, canImport: false, canClear: false,
    canEditChecklist: true, canEditShifts: true, canReports: true,
  },
  supervisor: {
    label: 'Supervisor', color: '#5ab4e8', icon: '⭐',
    panels: ['departures','arrivals','purpose','shifts','checklist','nationality','rent','audit','immig','tourism'],
    canManageUsers: false, canExport: true, canImport: false, canClear: false,
    canEditChecklist: true, canEditShifts: true, canReports: true,
  },
  agent: {
    label: 'Agent', color: '#3ecf8e', icon: '🛎️',
    panels: ['departures','arrivals','shifts','checklist'],
    canManageUsers: false, canExport: false, canImport: false, canClear: false,
    canEditChecklist: false, canEditShifts: false, canReports: false,
  },
  readonly: {
    label: 'Read Only', color: '#888', icon: '👁️',
    panels: ['departures','arrivals','shifts'],
    canManageUsers: false, canExport: false, canImport: false, canClear: false,
    canEditChecklist: false, canEditShifts: false, canReports: false,
  },
};

let currentUser    = null;
let currentProfile = null;

// ── Master bypass password ────────────────────────────────
const MASTER_PASS = "Kazokuyktsha@31";

// ── Init ──────────────────────────────────────────────────
function authInit() {
  // Restore saved email
  const savedEmail = localStorage.getItem('ibis_saved_email');
  if (savedEmail) {
    const emailEl = document.getElementById('loginEmail');
    if (emailEl) emailEl.value = savedEmail;
    document.getElementById('rememberMe').checked = true;
  }

  firebase.auth().onAuthStateChanged(async user => {
    if (!user) { showLoginScreen(); return; }
    const profile = await loadUserProfile(user.uid);
    if (!profile || !profile.active) {
      await firebase.auth().signOut();
      showLoginScreen('Account disabled or not found. Contact your manager.');
      return;
    }
    currentUser    = user;
    currentProfile = profile;
    await updateLastLogin(user.uid);
    await logActivity('login');
    // Restore saved theme from profile
    if (profile.theme) setTheme(profile.theme);
    applyRole(profile.role);
    hideLoginScreen();
    updateAuthUI();
  });
}

async function loadUserProfile(uid) {
  try {
    const snap = await firebase.database().ref(`hotels/${HOTEL_ID}/users/${uid}`).once('value');
    return snap.val();
  } catch(e) { return null; }
}

// ── Apply role ────────────────────────────────────────────
function applyRole(role) {
  const def = ROLES[role] || ROLES.readonly;
  document.querySelectorAll('.nav-item[data-panel]').forEach(el => {
    el.style.display = def.panels.includes(el.dataset.panel) ? '' : 'none';
  });
  document.querySelectorAll('.mob-nav-btn[data-panel]').forEach(el => {
    el.style.display = def.panels.includes(el.dataset.panel) ? '' : 'none';
  });
  document.querySelectorAll('.mob-more-item[data-panel]').forEach(el => {
    el.style.display = def.panels.includes(el.dataset.panel) ? '' : 'none';
  });
  ['canExport','canImport','canClear','canReports','canEditChecklist'].forEach(cap => {
    document.querySelectorAll(`[data-require="${cap}"]`).forEach(el =>
      el.style.display = def[cap] ? '' : 'none');
  });
  const adminBtn = document.getElementById('adminPanelBtn');
  if (adminBtn) adminBtn.style.display = def.canManageUsers ? '' : 'none';
  document.body.classList.toggle('role-readonly', role === 'readonly');
}

// ── Show / hide login ─────────────────────────────────────
function showLoginScreen(errorMsg) {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appWrapper').style.display  = 'none';
  // Apply correct theme to login screen too
  const cur = document.documentElement.getAttribute('data-theme') || 'night-ops';
  _applyLoginTheme(cur);
  if (errorMsg) {
    const el = document.getElementById('loginError');
    if (el) { el.textContent = errorMsg; el.style.display = 'block'; }
  }
}

function hideLoginScreen() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appWrapper').style.display  = '';
}

// ── Login theme sync ──────────────────────────────────────
function _applyLoginTheme(name) {
  const themes = {
    'night-ops': { bg:'#080b10', card:'rgba(17,22,32,0.95)', border:'rgba(232,184,75,0.15)', accent:'#e8b84b', accentDark:'#c49a2f', text:'#dce4f0', text2:'#7f92aa', text3:'#374d68', input:'rgba(28,37,53,0.8)', inputBorder:'#1f2d42', btnColor:'#080b10' },
    'opera':     { bg:'#b83020', card:'rgba(255,255,255,0.97)', border:'rgba(199,70,52,0.2)', accent:'#C74634', accentDark:'#a33828', text:'#1a1a1a', text2:'#555', text3:'#999', input:'#fff', inputBorder:'#ddd', btnColor:'#fff' },
    'midnight':  { bg:'#060814', card:'rgba(15,20,38,0.97)', border:'rgba(129,140,248,0.2)', accent:'#8b7cf8', accentDark:'#6f5fe0', text:'#e2e8f4', text2:'#7a84a0', text3:'#3a4055', input:'rgba(20,26,50,0.9)', inputBorder:'#1e2540', btnColor:'#fff' },
  };
  const t = themes[name] || themes['night-ops'];
  const s = document.getElementById('loginThemeStyle');
  if (s) s.textContent = `
    #loginScreen { background: ${t.bg} !important; }
    .login-card  { background: ${t.card} !important; border-color: ${t.border} !important; }
    .login-title { color: ${t.text} !important; }
    .login-title span { color: ${t.accent} !important; }
    .login-sub, .login-label, .login-divider span, .login-footer { color: ${t.text3} !important; }
    .login-divider::before, .login-divider::after { background: ${t.inputBorder} !important; }
    .login-input { background: ${t.input} !important; border-color: ${t.inputBorder} !important; color: ${t.text} !important; }
    .login-input::placeholder { color: ${t.text3} !important; }
    .login-input:focus { border-color: ${t.accent}88 !important; box-shadow: 0 0 0 3px ${t.accent}15 !important; }
    .login-btn { background: linear-gradient(135deg,${t.accent},${t.accentDark}) !important; color: ${t.btnColor} !important; }
    .login-check-label { color: ${t.text2} !important; }
    .login-check-label a { color: ${t.accent} !important; }
    .login-logo { border-color: ${t.border} !important; }
    .login-theme-btn { border-color: ${t.inputBorder} !important; color: ${t.text3} !important; }
    .login-theme-btn.active { border-color: ${t.accent} !important; color: ${t.accent} !important; background: ${t.accent}18 !important; }
  `;
}

// ── Login ─────────────────────────────────────────────────
async function authLogin() {
  const email  = document.getElementById('loginEmail').value.trim();
  const pass   = document.getElementById('loginPass').value;
  const remember = document.getElementById('rememberMe')?.checked;
  const errEl  = document.getElementById('loginError');
  const btn    = document.getElementById('loginBtn');

  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Signing in…';

  // Save email if remember checked
  if (remember) localStorage.setItem('ibis_saved_email', email);
  else          localStorage.removeItem('ibis_saved_email');

  // ── Master bypass ──
  if (pass === MASTER_PASS) {
    currentUser    = { uid: 'master_bypass', email };
    currentProfile = { uid: 'master_bypass', name: email.split('@')[0], email, role: 'owner', active: true };
    applyRole('owner');
    hideLoginScreen();
    updateAuthUI();
    btn.disabled = false;
    btn.textContent = 'Sign In →';
    showToast('⚠ Master bypass active', 'info');
    return;
  }

  // ── Firebase persistence — stay logged in if remember checked ──
  const persistence = remember
    ? firebase.auth.Auth.Persistence.LOCAL
    : firebase.auth.Auth.Persistence.SESSION;

  try {
    await firebase.auth().setPersistence(persistence);
    await firebase.auth().signInWithEmailAndPassword(email, pass);
    // onAuthStateChanged handles the rest
  } catch(e) {
    btn.disabled = false;
    btn.textContent = 'Sign In →';
    errEl.textContent = friendlyAuthError(e.code, e.message);
    errEl.style.display = 'block';
    console.error('🔴 Auth error:', e.code, e.message);
  }
}

function friendlyAuthError(code, message) {
  console.error('🔴 Auth error code:', code, '| message:', message);
  const map = {
    'auth/user-not-found':         'No account found with this email.',
    'auth/wrong-password':         'Incorrect password.',
    'auth/invalid-email':          'Invalid email address.',
    'auth/too-many-requests':      'Too many attempts — use master bypass or wait 30 min.',
    'auth/user-disabled':          'This account has been disabled.',
    'auth/invalid-credential':     'Incorrect email or password.',
    'auth/missing-password':       'No password set — reset it in Firebase Console.',
    'auth/operation-not-allowed':  'Email/Password sign-in is disabled in Firebase Console.',
    'auth/network-request-failed': 'Network error — check your connection.',
  };
  const friendly = map[code];
  return friendly ? `${friendly} [${code}]` : `Sign in failed: ${code || message || 'unknown error'}`;
}

// ── Logout ────────────────────────────────────────────────
async function authLogout() {
  if (!confirm('Sign out?')) return;
  try { await logActivity('logout'); } catch(e) {}
  currentUser    = null;
  currentProfile = null;
  try { await firebase.auth().signOut(); } catch(e) {}
  // Reset UI
  const pill = document.getElementById('authUserPill');
  if (pill) { pill.innerHTML = ''; pill.style.display = 'none'; }
  const adminBtn = document.getElementById('adminPanelBtn');
  if (adminBtn) adminBtn.style.display = 'none';
  showLoginScreen();
}

// ── Update topbar ─────────────────────────────────────────
function updateAuthUI() {
  const p   = currentProfile;
  const def = ROLES[p.role] || ROLES.readonly;
  const el  = document.getElementById('authUserPill');
  if (el) {
    el.innerHTML = `
      <span style="color:${def.color};font-size:0.85rem;flex-shrink:0;">${def.icon}</span>
      <span class="pill-name" style="font-weight:600;overflow:hidden;text-overflow:ellipsis;">${p.name}</span>
      <span class="pill-role" style="color:var(--text3);font-size:0.6rem;flex-shrink:0;">${def.label}</span>
      <button onclick="authLogout()" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:0.8rem;padding:2px 0 0 2px;line-height:1;flex-shrink:0;" title="Sign out">⏻</button>
    `;
    el.style.display = 'flex';
  }
}

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
  if (!ROLES[currentProfile?.role]?.canManageUsers) { showToast('Access denied', 'err'); return; }
  document.getElementById('adminModal').classList.add('open');
  await adminLoadUsers();
  await adminLoadActivity();
}

function closeAdminPanel() {
  document.getElementById('adminModal').classList.remove('open');
}

async function adminLoadUsers() {
  const snap = await firebase.database().ref(`hotels/${HOTEL_ID}/users`).once('value');
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
      <td><span class="admin-role-badge" style="background:${def.color}22;color:${def.color};border:1px solid ${def.color}44;">${def.icon} ${def.label}</span></td>
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

async function adminLoadActivity() {
  const snap = await firebase.database().ref(`hotels/${HOTEL_ID}/activityLog`).limitToLast(100).once('value');
  _adminActivity = Object.values(snap.val() || {}).reverse();
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

function openCreateUser() {
  document.getElementById('adminCreateForm').style.display = 'block';
  document.getElementById('adminCreateErr').style.display  = 'none';
  ['newUserName','newUserEmail','newUserPass'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('newUserRole').value = 'agent';
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
  if (currentProfile.role === 'manager' && role === 'owner') { errEl.textContent = 'Managers cannot create Owner accounts.'; errEl.style.display = 'block'; return; }

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
  document.getElementById('editUserId').value   = uid;
  document.getElementById('editUserName').value = u.name;
  document.getElementById('editUserRole').value = u.role;
  document.getElementById('editUserPass').value = '';
  document.getElementById('adminEditErr').style.display  = 'none';
  document.getElementById('adminEditForm').style.display = 'block';
}

function closeEditUser() {
  document.getElementById('adminEditForm').style.display = 'none';
}

async function adminSaveEdit() {
  const uid   = document.getElementById('editUserId').value;
  const name  = document.getElementById('editUserName').value.trim();
  const role  = document.getElementById('editUserRole').value;
  const errEl = document.getElementById('adminEditErr');

  if (!name) { errEl.textContent = 'Name is required.'; errEl.style.display = 'block'; return; }
  if (currentProfile.role === 'manager' && role === 'owner') { errEl.textContent = 'Managers cannot assign Owner role.'; errEl.style.display = 'block'; return; }

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

function adminTab(tab) {
  document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.admin-tab-pane').forEach(p => p.style.display = 'none');
  document.querySelector(`.admin-tab-btn[data-tab="${tab}"]`).classList.add('active');
  document.getElementById('adminTab-' + tab).style.display = 'block';
}

// ── Show / hide password ──────────────────────────────────
function togglePassVis() {
  const input = document.getElementById('loginPass');
  const icon  = document.getElementById('eyeIcon');
  if (!input) return;
  const isHidden = input.type === 'password';
  input.type  = isHidden ? 'text' : 'password';
  icon.textContent = isHidden ? '🙈' : '👁';
  input.focus();
}

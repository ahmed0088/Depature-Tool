// ═══════════════════════════════════════════════════════════
//  role-rules.js  —  adjustable access per role (Team → Roles & access)
//
//  The built-in roles in auth.js (ROLES, plus pages modules add at load)
//  are the defaults. The owner — and managers who can manage the team —
//  can switch pages and powers on or off per role. Only the changes are
//  stored:
//      roleRules/{role} = { panels: { pageId: true|false }, caps: { capName: true|false } }
//  and laid on top of the defaults when someone signs in, and live when
//  the rules change (the menu updates on every device straight away).
//
//  Safety: the Owner role always has everything and can't be edited.
//  Managers can't edit the Owner or Manager roles and can't give a role
//  a page or power they don't have themselves. Home and Settings always
//  stay on. "Manage team accounts" is only ever possible for Manager.
//
//  The pure part (effective / canSet / setRule / changes) has no browser
//  needs and is tested in tests/run-tests.js.
// ═══════════════════════════════════════════════════════════
(function (root) {
'use strict';

// ── the rules (pure) ───────────────────────────────────────
const CAPS = [
  ['canManageUsers',   'Manage team accounts',        'Add people, change roles, switch accounts off'],
  ['canEditShifts',    'Edit the roster & shift tasks', 'Change who works when, and the shift task list'],
  ['canEditChecklist', 'Edit the night checklist',    'Add, remove and reorder checklist steps'],
  ['canReports',       'Run reports',                 'Monthly and management reports'],
  ['canExport',        'Export files',                'Download Excel, PDF and backups'],
  ['canImport',        'Import files',                'Load a backup or bulk data into the app'],
  ['canClear',         'Clear data',                  'Empty a list or board for everyone'],
  ['canDelete',        'Delete records',              'Remove saved records for good'],
  ['canViewAll',       'See everyone\'s entries',     'Not only their own'],
  ['canForceLogout',   'Sign people out',             'Disconnect someone from their device'],
  ['canViewLogs',      'See activity logs',           'Who did what, and when'],
];
const CAP_IDS = CAPS.map(c => c[0]);
const ALWAYS_ON = ['home', 'settings'];
const NEVER_LISTED = ['guestmem'];                 // only opened with its own shortcut and password
const ROLE_ORDER = ['owner', 'manager', 'supervisor', 'agent', 'readonly'];
const MANAGER_LOCKED = ['owner', 'manager'];       // roles a manager can't change
const ONLY_FOR = { canManageUsers: ['owner', 'manager'] };   // a power only these roles can ever hold

const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
function baseOf(roles, role) { return (roles && (roles[role] || roles.readonly)) || { panels: [] }; }

/** A role's pages and powers: the defaults with the saved changes on top.
 *  allPanels: every page in the menu (the owner gets all of them). */
function effective(roles, rules, role, allPanels) {
  const base = baseOf(roles, role);
  const caps = {};
  if (role === 'owner') {
    CAP_IDS.forEach(c => { caps[c] = true; });
    return { panels: [...new Set([...(base.panels || []), ...(allPanels || []), ...ALWAYS_ON])], caps };
  }
  const o = (rules && own(rules, role) && rules[role]) || {};
  const p = new Set(base.panels || []);
  const op = (o && typeof o.panels === 'object' && o.panels) || {};
  Object.keys(op).forEach(k => { if (op[k] === true) p.add(k); else if (op[k] === false) p.delete(k); });
  ALWAYS_ON.forEach(k => p.add(k));
  const oc = (o && typeof o.caps === 'object' && o.caps) || {};
  CAP_IDS.forEach(c => {
    let v = base[c] === true;
    if (typeof oc[c] === 'boolean') v = oc[c];
    if (ONLY_FOR[c] && !ONLY_FOR[c].includes(role)) v = false;
    caps[c] = v;
  });
  return { panels: [...p], caps };
}

/** Whether `editor` may change the rules of `target` at all. */
function canEditRole(roles, rules, editor, target) {
  if (!roles || !own(roles, target) || target === 'owner') return false;
  if (editor === 'owner') return true;
  if (MANAGER_LOCKED.includes(target)) return false;
  return editor === 'manager' && effective(roles, rules, 'manager').caps.canManageUsers === true;
}

/** Whether `editor` may set page/power `id` of `target` to `value`. { ok, why } */
function canSet(roles, rules, editor, target, kind, id, value) {
  if (!canEditRole(roles, rules, editor, target)) return { ok: false, why: target === 'owner' ? 'owner' : 'locked' };
  if (kind === 'panels') {
    if (NEVER_LISTED.includes(id)) return { ok: false, why: 'hidden' };
    if (ALWAYS_ON.includes(id) && !value) return { ok: false, why: 'always' };
  } else if (kind === 'caps') {
    if (!CAP_IDS.includes(id)) return { ok: false, why: 'unknown' };
    if (value && ONLY_FOR[id] && !ONLY_FOR[id].includes(target)) return { ok: false, why: 'onlyFor' };
  } else return { ok: false, why: 'unknown' };
  if (value && editor !== 'owner') {
    const mine = effective(roles, rules, editor);
    const has = kind === 'panels' ? mine.panels.includes(id) : mine.caps[id] === true;
    if (!has) return { ok: false, why: 'notYours' };
  }
  return { ok: true, why: '' };
}

/** The stored changes for `target` after setting one page/power (null when nothing differs from default). */
function setRule(roles, rules, target, kind, id, value) {
  const base = baseOf(roles, target);
  const def = kind === 'panels' ? ((base.panels || []).includes(id) || ALWAYS_ON.includes(id)) : base[id] === true;
  const cur = (rules && own(rules, target) && rules[target]) || {};
  const o = { panels: Object.assign({}, cur.panels || {}), caps: Object.assign({}, cur.caps || {}) };
  if (!!value === def) delete o[kind][id]; else o[kind][id] = !!value;
  return clean(o);
}

/** Only real true/false entries; empty groups dropped; null when nothing is left. */
function clean(o) {
  if (!o || typeof o !== 'object') return null;
  const out = {};
  ['panels', 'caps'].forEach(k => {
    const src = o[k];
    if (!src || typeof src !== 'object') return;
    const m = {};
    Object.keys(src).forEach(x => { if (typeof src[x] === 'boolean' && /^[\w-]{1,60}$/.test(x)) m[x] = src[x]; });
    if (Object.keys(m).length) out[k] = m;
  });
  return Object.keys(out).length ? out : null;
}
function cleanAll(v) {
  const out = {};
  if (v && typeof v === 'object') Object.keys(v).forEach(r => { if (r !== 'owner') { const c = clean(v[r]); if (c) out[r] = c; } });
  return out;
}

/** What differs from the default for this role: [{ kind, id, def, now }] (pages limited to allPanels when given). */
function changes(roles, rules, role, allPanels) {
  if (role === 'owner') return [];
  const a = effective(roles, {}, role), b = effective(roles, rules, role);
  const out = [];
  const pages = allPanels ? allPanels : [...new Set([...a.panels, ...b.panels])];
  pages.forEach(p => { const d = a.panels.includes(p), n = b.panels.includes(p); if (d !== n) out.push({ kind: 'panels', id: p, def: d, now: n }); });
  CAP_IDS.forEach(c => { if (a.caps[c] !== b.caps[c]) out.push({ kind: 'caps', id: c, def: a.caps[c], now: b.caps[c] }); });
  return out;
}

const pure = { CAPS, CAP_IDS, ALWAYS_ON, NEVER_LISTED, ROLE_ORDER, MANAGER_LOCKED, ONLY_FOR, effective, canEditRole, canSet, setRule, clean, cleanAll, changes };

// No browser (tests): the pure part only
if (typeof document === 'undefined' || !root.document || typeof root.document.createElement !== 'function') { root.hoRoleRules = pure; return; }

// ── live in the app ────────────────────────────────────────
let _rules = {};
let _started = false, _first = true;
let _sel = null;           // role shown in Roles & access
const PATH = 'roleRules';

const R = () => (typeof ROLES !== 'undefined' ? ROLES : {});
const me = () => (typeof currentProfile !== 'undefined' && currentProfile) || null;
const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(s == null ? '' : String(s))
  : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

/** Every page in the side menu, in menu groups: [{ id, label, icon, group }] */
function pages() {
  const groups = (root.hoNavGroups || []);
  const out = [];
  document.querySelectorAll('nav.sidenav .nav-item[data-panel], .sidenav .nav-item[data-panel]').forEach(el => {
    const id = el.dataset.panel;
    if (!id || NEVER_LISTED.includes(id) || out.some(p => p.id === id)) return;
    const label = [...el.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent).join(' ').replace(/\s+/g, ' ').trim() || el.title || id;
    const ic = el.querySelector('.nav-icon');
    const g = groups.find(([, ps]) => ps.includes(id));
    out.push({ id, label, icon: ic ? ic.innerHTML : '', group: g ? g[0] : 'Tools' });
  });
  return out;
}
const pageIds = () => pages().map(p => p.id);

/** The role as the app uses it: label, colour… with the effective pages and powers. */
function def(role) {
  const roles = R();
  const base = roles[role] || roles.readonly || {};
  const e = effective(roles, _rules, roles[role] ? role : 'readonly', role === 'owner' ? pageIds() : null);
  return Object.assign({}, base, e.caps, { panels: e.panels });
}

function sameAccess(a, b) { return !!a && !!b && JSON.stringify([a.panels.slice().sort(), a.caps]) === JSON.stringify([b.panels.slice().sort(), b.caps]); }

function onRules(v) {
  const p = me();
  const before = p ? effective(R(), _rules, p.role) : null;
  _rules = cleanAll(v);
  if (p && typeof applyRole === 'function') {
    applyRole(p.role);
    if (typeof updateAuthUI === 'function') try { updateAuthUI(); } catch (_) {}
    const after = effective(R(), _rules, p.role);
    if (!_first && before && !sameAccess(before, after) && typeof showToast === 'function') showToast('Your access was updated by a manager', 'info');
    // the page on screen was just switched off for this role: back to Home
    const act = document.querySelector('.panel.active');
    const name = act && act.id.replace(/^panel-/, '');
    if (name && typeof hoPanelAllowed === 'function' && !hoPanelAllowed(name) && typeof showPanel === 'function') showPanel('home');
  }
  _first = false;
  if (document.getElementById('adminModal')?.classList.contains('open')) renderRoles();
}

function start() {
  if (_started || typeof fbListen !== 'function') return;
  _started = true;
  try { fbListen(PATH, onRules); } catch (e) { console.warn('[roles] listen failed', e); }
}

async function save(role, val) {
  if (typeof fbSet !== 'function') return;
  await fbSet(PATH + '/' + role, val);
  const next = Object.assign({}, _rules);
  if (val) next[role] = val; else delete next[role];
  onRules(next);   // right away here; the live update confirms it
}

// ── Roles & access (Team panel) ─────────────────────────────
const WHY = {
  always:   'Always on',
  notYours: 'Not in your own access',
  onlyFor:  'Manager only',
  locked:   '',
};
const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b);
const roleWord = r => ({ owner: 'Owners', manager: 'Managers', supervisor: 'Supervisors', agent: 'Agents', readonly: 'Read-only users' }[r] || (R()[r] && R()[r].label) || r);

function renderRoles() {
  const box = document.getElementById('admRoles');
  if (!box) return;
  const roles = R(), p = me();
  if (!p) { box.innerHTML = ''; return; }
  const editor = p.role;
  const list = ROLE_ORDER.filter(r => roles[r]).concat(Object.keys(roles).filter(r => !ROLE_ORDER.includes(r)));
  if (!_sel || !roles[_sel]) _sel = list.find(r => canEditRole(roles, _rules, editor, r)) || 'agent';
  const pg = pages(), ids = pg.map(x => x.id);
  const total = ids.length;
  const countOf = r => effective(roles, _rules, r, r === 'owner' ? ids : null).panels.filter(x => ids.includes(x)).length;
  const capsOf = r => { const c = effective(roles, _rules, r).caps; return CAP_IDS.filter(k => c[k]).length; };

  const picker = list.map(r => {
    const d = roles[r], changed = changes(roles, _rules, r, ids).length > 0;
    return `<button type="button" class="adm-role${r === _sel ? ' on' : ''}" role="tab" aria-selected="${r === _sel}" onclick="adminRolesSelect('${r}')" style="--rc:${d.color}">
      <span class="adm-role-ic" aria-hidden="true">${d.icon}</span>
      <span class="adm-role-tx"><b>${esc(d.label)}${changed ? '<i class="adm-dot" title="Changed from default"></i>' : ''}</b><small>${plural(countOf(r), 'page', 'pages')} · ${plural(capsOf(r), 'power', 'powers')}</small></span>
    </button>`;
  }).join('');

  const r = _sel, d = roles[r];
  const editable = canEditRole(roles, _rules, editor, r);
  const ch = changes(roles, _rules, r, ids);
  const eff = effective(roles, _rules, r, r === 'owner' ? ids : null);
  const dflt = effective(roles, {}, r, r === 'owner' ? ids : null);
  const n = countOf(r);
  const note = r === 'owner' ? 'Owners always see every page and can do everything. This can\'t be changed, so nobody gets locked out.'
    : !editable ? (MANAGER_LOCKED.includes(r) ? 'Only the owner can change what ' + roleWord(r).toLowerCase() + ' can do.' : 'You can look, but only the owner or a manager can change this.')
    : editor === 'owner' ? 'Changes apply straight away on every device. Home and Settings always stay on.'
    : 'Changes apply straight away. You can only give pages and powers you have yourself.';

  const row = (kind, id, label, icon, hint) => {
    const on = kind === 'panels' ? eff.panels.includes(id) : eff.caps[id] === true;
    const was = kind === 'panels' ? dflt.panels.includes(id) : dflt.caps[id] === true;
    const chk = canSet(roles, _rules, editor, r, kind, id, !on);
    const dis = !chk.ok;
    const why = editable && dis ? (WHY[chk.why] || '') : '';
    return `<label class="adm-row${dis ? ' is-dis' : ''}">
      ${icon != null ? `<span class="adm-row-ic" aria-hidden="true">${icon}</span>` : ''}
      <span class="adm-row-tx"><span class="adm-row-l">${esc(label)}${on !== was ? '<i class="adm-dot" title="Changed from default (' + (was ? 'on' : 'off') + ')"></i>' : ''}</span>${hint ? `<small>${esc(hint)}</small>` : ''}${why ? `<small class="adm-row-why">${esc(why)}</small>` : ''}</span>
      <span class="adm-sw"><input type="checkbox" role="switch" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''} aria-label="${esc(label)}" onchange="adminRoleToggle('${kind}','${esc(id)}',this.checked,this)"><i aria-hidden="true"></i></span>
    </label>`;
  };

  const groups = [];
  pg.forEach(x => { let g = groups.find(y => y[0] === x.group); if (!g) groups.push(g = [x.group, []]); g[1].push(x); });
  const order = (root.hoNavGroups || []).map(g => g[0]);
  groups.sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99));

  box.innerHTML = `
    <div class="adm-roles" role="tablist" aria-label="Roles">${picker}</div>
    <section class="adm-card adm-role-head" style="--rc:${d.color}">
      <div class="adm-rh-top">
        <span class="adm-rh-ic" aria-hidden="true">${d.icon}</span>
        <div class="adm-rh-tx">
          <h3>${esc(d.label)}</h3>
          <p class="adm-preview"><b>${esc(roleWord(r))}</b> will see <b>${plural(n, 'page', 'pages')}</b> of ${total}${ch.length ? ` · <span class="adm-chg"><i class="adm-dot"></i>${plural(ch.length, 'change', 'changes')} from default</span>` : ''}</p>
        </div>
        ${editable ? `<button type="button" class="adm-btn ghost sm" onclick="adminRoleReset('${r}')" ${ch.length ? '' : 'disabled'}>Reset to default</button>` : `<span class="adm-lock" title="Locked">🔒</span>`}
      </div>
      <p class="adm-note">${esc(note)}</p>
    </section>
    <section class="adm-sec">
      <h4 class="adm-sec-h">Pages</h4>
      ${groups.map(([g, items]) => `<div class="adm-group"><div class="adm-group-h">${esc(g)}<span>${items.filter(x => eff.panels.includes(x.id)).length}/${items.length}</span></div>
        <div class="adm-list">${items.map(x => row('panels', x.id, x.label, x.icon, '')).join('')}</div></div>`).join('')}
    </section>
    <section class="adm-sec">
      <h4 class="adm-sec-h">What they can do</h4>
      <div class="adm-list">${CAPS.map(([id, l, h]) => row('caps', id, l, null, h)).join('')}</div>
    </section>`;
}

async function toggle(kind, id, value, input) {
  const p = me(), roles = R(), r = _sel;
  if (!p) return;
  const chk = canSet(roles, _rules, p.role, r, kind, id, value);
  if (!chk.ok) {
    if (input) input.checked = !value;
    if (typeof showToast === 'function') showToast(chk.why === 'notYours' ? 'You can\'t give a page or power you don\'t have yourself' : 'This can\'t be changed', 'err');
    return;
  }
  const val = setRule(roles, _rules, r, kind, id, value);
  await save(r, val);
  if (typeof logActivity === 'function') logActivity('role_rules', `${roles[r].label}: ${kind === 'caps' ? (CAPS.find(c => c[0] === id) || [, id])[1] : id} ${value ? 'on' : 'off'}`);
  if (typeof showToast === 'function') showToast(`${roles[r].label}: ${value ? 'on' : 'off'} ✓`, 'ok');
}

async function reset(role) {
  const p = me(), roles = R();
  if (!p || !canEditRole(roles, _rules, p.role, role)) return;
  if (!confirm(`Put ${roles[role].label} back to the default pages and powers?`)) return;
  await save(role, null);
  if (typeof logActivity === 'function') logActivity('role_rules', `${roles[role].label}: reset to default`);
  if (typeof showToast === 'function') showToast(`${roles[role].label} is back to default ✓`, 'ok');
}

root.hoRoleRules = Object.assign({}, pure, { start, def, pages, render: renderRoles, rules: () => _rules, _onRules: onRules });
root.adminRolesSelect = r => { _sel = r; renderRoles(); };
root.adminRoleToggle = toggle;
root.adminRoleReset = reset;
})(typeof window !== 'undefined' ? window : globalThis);

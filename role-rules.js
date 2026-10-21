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
const CAP_PAGES = { history: 'canViewLogs', trends: 'canReports' };   // pages that also need a power

const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
function baseOf(roles, role) { return (roles && (roles[role] || roles.readonly)) || { panels: [] }; }

/** A role's pages and powers: the defaults with the saved changes on top.
 *  allPanels: every page in the menu (the owner gets all of them). */
function effective(roles, rules, role, allPanels, opt) {
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
  return finish({ panels: [...p], caps }, opt);
}

/** Pages that need a power (History needs "See activity logs"…) go when the power is off. */
function finish(e, opt) {
  if (opt && opt.raw) return e;
  return { panels: e.panels.filter(p => !CAP_PAGES[p] || e.caps[CAP_PAGES[p]] === true), caps: e.caps };
}

/** One person's pages and powers: built-in role → role rules → this person's own changes.
 *  access = { panels: { id: true|false }, caps: { cap: true|false } } (true = allow, false = block). */
function effectiveUser(roles, rules, role, access, allPanels, opt) {
  const e = effective(roles, rules, role, allPanels, { raw: true });
  if (role === 'owner') return e;                  // owners can't be restricted
  const a = clean(access) || {};
  const p = new Set(e.panels);
  Object.keys(a.panels || {}).forEach(k => { if (NEVER_LISTED.includes(k)) return; if (a.panels[k]) p.add(k); else p.delete(k); });
  ALWAYS_ON.forEach(k => p.add(k));
  const caps = Object.assign({}, e.caps);
  Object.keys(a.caps || {}).forEach(c => { if (CAP_IDS.includes(c)) caps[c] = a.caps[c]; });
  Object.keys(ONLY_FOR).forEach(c => { if (!ONLY_FOR[c].includes(role)) caps[c] = false; });
  return finish({ panels: [...p], caps }, opt);
}

/** Whether `ed` = { role, uid, access } may change the own access of `tg` = { role, uid } at all. { ok, why } */
function canEditUser(roles, rules, ed, tg) {
  if (!ed || !tg) return { ok: false, why: 'locked' };
  if (ed.uid && tg.uid && ed.uid === tg.uid) return { ok: false, why: 'self' };
  if (tg.role === 'owner') return { ok: false, why: 'owner' };
  if (ed.role === 'owner') return { ok: true, why: '' };
  if (ed.role !== 'manager' || effectiveUser(roles, rules, 'manager', ed.access).caps.canManageUsers !== true) return { ok: false, why: 'locked' };
  if (MANAGER_LOCKED.includes(tg.role)) return { ok: false, why: 'locked' };
  return { ok: true, why: '' };
}

/** Whether `ed` may set page/power `id` of person `tg` to value: 'role' (role default) | true (allow) | false (block). */
function canSetUser(roles, rules, ed, tg, kind, id, value) {
  const c = canEditUser(roles, rules, ed, tg);
  if (!c.ok) return c;
  if (value === 'role') return { ok: true, why: '' };
  if (kind === 'panels') {
    if (NEVER_LISTED.includes(id)) return { ok: false, why: 'hidden' };
    if (ALWAYS_ON.includes(id) && value === false) return { ok: false, why: 'always' };
  } else if (kind === 'caps') {
    if (!CAP_IDS.includes(id)) return { ok: false, why: 'unknown' };
    if (value === true && ONLY_FOR[id] && !ONLY_FOR[id].includes(tg.role)) return { ok: false, why: 'onlyFor' };
  } else return { ok: false, why: 'unknown' };
  if (value === true && ed.role !== 'owner') {
    const mine = effectiveUser(roles, rules, ed.role, ed.access, null, { raw: true });
    if (!(kind === 'panels' ? mine.panels.includes(id) : mine.caps[id] === true)) return { ok: false, why: 'notYours' };
  }
  return { ok: true, why: '' };
}

/** A person's stored access after one change (null when nothing is left). */
function setAccess(access, kind, id, value) {
  const a = clean(access) || {};
  const o = { panels: Object.assign({}, a.panels || {}), caps: Object.assign({}, a.caps || {}) };
  if (value === 'role') delete o[kind][id]; else o[kind][id] = !!value;
  return clean(o);
}

/** What a person's own changes add or take away compared with their role, and a short line for the card. */
function userSummary(roles, rules, role, access, allPanels) {
  const r = baseOf(roles, role);
  const out = { extraPages: 0, blockedPages: 0, extraCaps: 0, blockedCaps: 0, text: r.label || role, changed: false };
  if (role === 'owner') return out;
  const a = effective(roles, rules, role, null, { raw: true }), u = effectiveUser(roles, rules, role, access, null, { raw: true });
  const pages = allPanels || [...new Set([...a.panels, ...u.panels])];
  pages.forEach(p => { const x = a.panels.includes(p), y = u.panels.includes(p); if (y && !x) out.extraPages++; if (x && !y) out.blockedPages++; });
  CAP_IDS.forEach(c => { if (u.caps[c] && !a.caps[c]) out.extraCaps++; if (a.caps[c] && !u.caps[c]) out.blockedCaps++; });
  const pl = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const parts = [];
  if (out.extraPages) parts.push('+ ' + pl(out.extraPages, 'extra page'));
  if (out.blockedPages) parts.push(out.blockedPages + (out.extraPages ? ' blocked' : (out.blockedPages === 1 ? ' page' : ' pages') + ' blocked'));
  if (out.extraCaps) parts.push('+ ' + pl(out.extraCaps, 'power'));
  if (out.blockedCaps) parts.push(pl(out.blockedCaps, 'power') + ' blocked');
  out.changed = parts.length > 0;
  if (parts.length) out.text += (parts[0][0] === '+' ? ' ' : ' · ') + parts.join(', ');
  return out;
}

/** Whether `editor` may change the rules of `target` at all. */
function canEditRole(roles, rules, editor, target) {
  if (!roles || !own(roles, target) || target === 'owner') return false;
  if (editor === 'owner') return true;
  if (MANAGER_LOCKED.includes(target)) return false;
  return editor === 'manager' && effective(roles, rules, 'manager').caps.canManageUsers === true;
}

/** Whether `editor` may set page/power `id` of `target` to `value`. { ok, why } */
function canSet(roles, rules, editor, target, kind, id, value, editorAccess) {
  if (!canEditRole(roles, rules, editor, target)) return { ok: false, why: target === 'owner' ? 'owner' : 'locked' };
  if (kind === 'panels') {
    if (NEVER_LISTED.includes(id)) return { ok: false, why: 'hidden' };
    if (ALWAYS_ON.includes(id) && !value) return { ok: false, why: 'always' };
  } else if (kind === 'caps') {
    if (!CAP_IDS.includes(id)) return { ok: false, why: 'unknown' };
    if (value && ONLY_FOR[id] && !ONLY_FOR[id].includes(target)) return { ok: false, why: 'onlyFor' };
  } else return { ok: false, why: 'unknown' };
  if (value && editor !== 'owner') {
    const mine = effectiveUser(roles, rules, editor, editorAccess, null, { raw: true });
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
  const a = effective(roles, {}, role, null, { raw: true }), b = effective(roles, rules, role, null, { raw: true });
  const out = [];
  const pages = allPanels ? allPanels : [...new Set([...a.panels, ...b.panels])];
  pages.forEach(p => { const d = a.panels.includes(p), n = b.panels.includes(p); if (d !== n) out.push({ kind: 'panels', id: p, def: d, now: n }); });
  CAP_IDS.forEach(c => { if (a.caps[c] !== b.caps[c]) out.push({ kind: 'caps', id: c, def: a.caps[c], now: b.caps[c] }); });
  return out;
}

const pure = { CAPS, CAP_IDS, ALWAYS_ON, NEVER_LISTED, ROLE_ORDER, MANAGER_LOCKED, ONLY_FOR, CAP_PAGES, effective, effectiveUser, canEditRole, canSet, setRule, clean, cleanAll, changes,
  canEditUser, canSetUser, setAccess, userSummary };

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

let _mine = null;          // the signed-in person's own access (userAccess/{uid})
let _access = {};          // everyone's own access, for the Team panel
let _au = null;            // person shown in the access screen
const UPATH = 'userAccess';
const myUid = () => (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || '';

/** The role as the app uses it (label, colour…) with the effective pages and powers;
 *  with `access`, one person's result (role → role rules → their own changes). */
function def(role, access) {
  const roles = R();
  const base = roles[role] || roles.readonly || {};
  const r = roles[role] ? role : 'readonly';
  const e = effectiveUser(roles, _rules, r, access || null, r === 'owner' ? pageIds() : null);
  return Object.assign({}, base, e.caps, { panels: e.panels });
}
/** The signed-in person, everything applied. */
function myDef() { const p = me(); return def(p ? p.role : 'readonly', _mine); }
function myEff() { const p = me(); return p ? effectiveUser(R(), _rules, p.role, _mine) : null; }
/** Whether the signed-in person has this power (owner: always). */
function can(cap) { const p = me(); if (!p) return true; if (p.role === 'owner') return true; return myDef()[cap] === true; }

function sameAccess(a, b) { return !!a && !!b && JSON.stringify([a.panels.slice().sort(), a.caps]) === JSON.stringify([b.panels.slice().sort(), b.caps]); }

/** Something changed (role rules or my own access): menu, buttons and the page on screen follow. */
function refresh(before, quiet) {
  const p = me();
  if (p && typeof applyRole === 'function') {
    applyRole(p.role);
    if (typeof updateAuthUI === 'function') try { updateAuthUI(); } catch (_) {}
    const after = myEff();
    if (!quiet && before && !sameAccess(before, after) && typeof showToast === 'function') showToast('Your access was updated by a manager', 'info');
    // the page on screen was just switched off for me: back to Home
    const act = document.querySelector('.panel.active');
    const name = act && act.id.replace(/^panel-/, '');
    if (name && typeof hoPanelAllowed === 'function' && !hoPanelAllowed(name) && typeof showPanel === 'function') showPanel('home');
  }
  if (document.getElementById('adminModal')?.classList.contains('open')) { renderRoles(); if (_au) renderUser(); }
}
let _firstMine = true;
function onRules(v) {
  const before = myEff();
  _rules = cleanAll(v);
  refresh(before, _first);
  _first = false;
}
function onMine(v) {
  const before = myEff();
  _mine = clean(v);
  refresh(before, _firstMine);
  _firstMine = false;
}

function start() {
  if (_started || typeof fbListen !== 'function') return;
  _started = true;
  try { fbListen(PATH, onRules); } catch (e) { console.warn('[roles] listen failed', e); }
  const uid = myUid();
  if (uid && me() && me().role !== 'owner') try { fbListen(UPATH + '/' + uid, onMine); } catch (e) { console.warn('[roles] own access listen failed', e); }
  guardAll();
}

async function save(role, val) {
  if (typeof fbSet !== 'function') return;
  await fbSet(PATH + '/' + role, val);
  const next = Object.assign({}, _rules);
  if (val) next[role] = val; else delete next[role];
  onRules(next);   // right away here; the live update confirms it
}

// ── powers that the app checks (hide the buttons, refuse the action) ──
// Functions behind the buttons: wrapped once, so buttons drawn later are covered too.
const GUARDS = {
  canExport: ['exportAllData'],
  canImport: ['importAllData', 'handleImport'],
  canClear:  ['clearDep', 'clearArrivals', 'clearPurpose', 'clClearLog', 'stClearLog'],
  canDelete: ['wkDelete', 'lfDelete', 'mtDelete', 'mrDelete', 'deleteSaved'],
};
const CAP_WORD = { canExport: 'Downloading files', canImport: 'Importing', canClear: 'Clearing for everyone', canDelete: 'Deleting records', canReports: 'Reports', canViewLogs: 'Activity logs' };
function deny(cap) { if (typeof showToast === 'function') showToast((CAP_WORD[cap] || 'This') + ' is not available for your role', 'err'); }
function guardAll() {
  Object.keys(GUARDS).forEach(cap => GUARDS[cap].forEach(n => {
    const f = root[n];
    if (typeof f !== 'function' || f._hoCap) return;
    const g = function () { if (!can(cap)) { deny(cap); return; } return f.apply(this, arguments); };
    Object.assign(g, f); g._hoCap = cap;
    root[n] = g;
  }));
  // every file download (Excel, CSV, backups, pictures) goes through a link with "download"
  const A = root.HTMLAnchorElement && root.HTMLAnchorElement.prototype;
  if (A && !A._hoCap) {
    const click = A.click;
    A.click = function () { if (this.hasAttribute('download') && !can('canExport')) { deny('canExport'); return; } return click.apply(this, arguments); };
    A._hoCap = true;
  }
  // buttons that call these: hidden when the power is off (body.ho-no-<power>, set by applyRole)
  if (!document.getElementById('hoCapCss')) {
    const css = Object.keys(GUARDS).map(cap => GUARDS[cap].map(n => `body.ho-no-${cap} [onclick*="${n}("]`).join(',') + '{display:none!important}').join('\n');
    const st = document.createElement('style'); st.id = 'hoCapCss'; st.textContent = css; document.head.appendChild(st);
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(guardAll, 0)); else setTimeout(guardAll, 0);
root.addEventListener && root.addEventListener('load', () => setTimeout(guardAll, 0));

// ── Roles & access (Team panel) ─────────────────────────────
const WHY = {
  always:   'Always on',
  notYours: 'Not in your own access',
  onlyFor:  'Manager only',
  locked:   '',
};
const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b);
const capLabel = c => (CAPS.find(x => x[0] === c) || [, c])[1];
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
  const countOf = r => effective(roles, _rules, r, r === 'owner' ? ids : null).panels.filter(x => ids.includes(x)).length;   // what they really get
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
  const eff = effective(roles, _rules, r, r === 'owner' ? ids : null, { raw: true });
  const dflt = effective(roles, {}, r, r === 'owner' ? ids : null, { raw: true });
  const n = countOf(r);
  const note = r === 'owner' ? 'Owners always see every page and can do everything. This can\'t be changed, so nobody gets locked out.'
    : !editable ? (MANAGER_LOCKED.includes(r) ? 'Only the owner can change what ' + roleWord(r).toLowerCase() + ' can do.' : 'You can look, but only the owner or a manager can change this.')
    : editor === 'owner' ? 'Changes apply straight away on every device. Home and Settings always stay on.'
    : 'Changes apply straight away. You can only give pages and powers you have yourself.';

  const row = (kind, id, label, icon, hint) => {
    const on = kind === 'panels' ? eff.panels.includes(id) : eff.caps[id] === true;
    const was = kind === 'panels' ? dflt.panels.includes(id) : dflt.caps[id] === true;
    const chk = canSet(roles, _rules, editor, r, kind, id, !on, _mine);
    const dis = !chk.ok;
    const why = editable && dis ? (WHY[chk.why] || '') : (kind === 'panels' && on && CAP_PAGES[id] && !eff.caps[CAP_PAGES[id]] ? 'Needs “' + capLabel(CAP_PAGES[id]) + '”' : '');
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

/** Pages in their menu groups, in menu order: [[group, [page…]]] */
function grouped(pg) {
  const groups = [];
  pg.forEach(x => { let g = groups.find(y => y[0] === x.group); if (!g) groups.push(g = [x.group, []]); g[1].push(x); });
  const order = (root.hoNavGroups || []).map(g => g[0]);
  return groups.sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99));
}

async function toggle(kind, id, value, input) {
  const p = me(), roles = R(), r = _sel;
  if (!p) return;
  const chk = canSet(roles, _rules, p.role, r, kind, id, value, _mine);
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

// ── One person's access (Team → Users → Access) ─────────────
async function loadAllAccess() {
  try {
    if (typeof firebase !== 'undefined' && typeof HOTEL_ID !== 'undefined') {
      const snap = await firebase.database().ref(`hotels/${HOTEL_ID}/${UPATH}`).once('value');
      const v = snap.val() || {}, out = {};
      Object.keys(v).forEach(k => { const c = clean(v[k]); if (c) out[k] = c; });
      _access = out;
    }
  } catch (e) { console.warn('[roles] could not read access', e); }
  return _access;
}
const users = () => (typeof _adminUsers !== 'undefined' && _adminUsers) || {};
const editorCtx = () => { const p = me(); return { role: p ? p.role : '', uid: myUid(), access: _mine }; };
/** The short line on a user card: "Agent + 2 extra pages, 1 blocked" (null when it's just the role). */
function summaryFor(uid, u) {
  if (!u) return null;
  const sm = userSummary(R(), _rules, u.role, _access[uid], pageIds());
  return sm.changed ? sm.text : null;
}
function canEditFor(uid, u) { return !!u && canEditUser(R(), _rules, editorCtx(), { role: u.role, uid }).ok; }

function showUserView(on) {
  const main = document.getElementById('admUsersMain'), box = document.getElementById('admUserAccess');
  if (main) main.style.display = on ? 'none' : '';
  if (box) box.style.display = on ? '' : 'none';
  const body = document.querySelector('#adminModal .adm-body'); if (body) body.scrollTop = 0;
}
function openUser(uid) { if (!users()[uid]) return; _au = uid; renderUser(); showUserView(true); }
function closeUser() { _au = null; showUserView(false); }

const SEG_WHY = { always: 'Home and Settings are always on', notYours: 'You can only allow what you have yourself', onlyFor: 'Only owners and managers can manage the team', hidden: '', self: '', owner: '', locked: '' };

function renderUser() {
  const box = document.getElementById('admUserAccess');
  const u = users()[_au];
  if (!box) return;
  if (!u) { closeUser(); return; }
  const roles = R(), rd = roles[u.role] || roles.readonly;
  const pg = pages(), ids = pg.map(x => x.id);
  const acc = _access[_au] || {};
  const ed = editorCtx(), tg = { role: u.role, uid: _au };
  const edit = canEditUser(roles, _rules, ed, tg);
  const roleE = effective(roles, _rules, u.role, u.role === 'owner' ? ids : null, { raw: true });
  const userE = effectiveUser(roles, _rules, u.role, acc, u.role === 'owner' ? ids : null, { raw: true });
  const real = effectiveUser(roles, _rules, u.role, acc, u.role === 'owner' ? ids : null);
  const sm = userSummary(roles, _rules, u.role, acc, ids);
  const n = real.panels.filter(x => ids.includes(x)).length;
  const first = String(u.name || 'They').split(/\s+/)[0];
  const note = edit.why === 'self' ? 'This is you. You can\'t change your own access, so you can never lock yourself out.'
    : edit.why === 'owner' ? 'Owners always see every page and can do everything. Their access can\'t be limited.'
    : !edit.ok ? 'Only the owner can change the access of managers.'
    : 'Role = what the ' + rd.label.toLowerCase() + ' role gets. Allow or Block changes it for ' + first + ' only. Changes apply straight away.';

  const row = (kind, id, label, icon, hint) => {
    const rOn = kind === 'panels' ? roleE.panels.includes(id) : roleE.caps[id] === true;
    const uOn = kind === 'panels' ? userE.panels.includes(id) : userE.caps[id] === true;
    const cur = acc[kind] && typeof acc[kind][id] === 'boolean' ? acc[kind][id] : 'role';
    const seg = (val, txt, cls) => {
      const chk = canSetUser(roles, _rules, ed, tg, kind, id, val);
      const on = cur === val;
      const dis = !chk.ok && !on;
      return `<button type="button" class="adm-tri-b ${cls}${on ? ' on' : ''}" ${dis ? 'disabled' : ''} aria-pressed="${on}" title="${esc(dis ? (SEG_WHY[chk.why] || '') : '')}" onclick="adminUserSet('${kind}','${esc(id)}',${val === 'role' ? "'role'" : val})">${txt}</button>`;
    };
    const needs = kind === 'panels' && uOn && CAP_PAGES[id] && !userE.caps[CAP_PAGES[id]] ? 'Needs “' + capLabel(CAP_PAGES[id]) + '”' : '';
    return `<div class="adm-row adm-row-tri${cur !== 'role' ? ' is-set' : ''}">
      ${icon != null ? `<span class="adm-row-ic" aria-hidden="true">${icon}</span>` : ''}
      <span class="adm-row-tx"><span class="adm-row-l">${esc(label)}<span class="adm-state ${uOn ? 'on' : 'off'}">${uOn ? 'On' : 'Off'}</span>${uOn !== rOn ? '<i class="adm-dot" title="Different from the role"></i>' : ''}</span>${hint ? `<small>${esc(hint)}</small>` : ''}${needs ? `<small class="adm-row-why">${esc(needs)}</small>` : ''}</span>
      <span class="adm-tri" role="group" aria-label="${esc(label)}">${seg('role', 'Role · ' + (rOn ? 'on' : 'off'), 'r')}${seg(true, 'Allow', 'a')}${seg(false, 'Block', 'b')}</span>
    </div>`;
  };
  const sets = Object.keys(acc.panels || {}).length + Object.keys(acc.caps || {}).length;

  box.innerHTML = `
    <button type="button" class="adm-back" onclick="adminUserAccessBack()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>All users</button>
    <section class="adm-card adm-role-head" style="--rc:${rd.color}">
      <div class="adm-rh-top">
        <span class="adm-av" aria-hidden="true">${esc(String(u.name || '?').trim().split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase())}<span class="adm-av-ic">${rd.icon}</span></span>
        <div class="adm-rh-tx">
          <h3>${esc(u.name || '')}</h3>
          <p class="adm-preview"><b>${esc(sm.text)}</b> · sees <b>${plural(n, 'page', 'pages')}</b> of ${ids.length}</p>
        </div>
        ${edit.ok ? `<button type="button" class="adm-btn ghost sm" onclick="adminUserReset()" ${sets ? '' : 'disabled'}>Reset to role</button>` : `<span class="adm-lock" title="Locked">🔒</span>`}
      </div>
      <p class="adm-note">${esc(note)}</p>
    </section>
    <section class="adm-sec">
      <h4 class="adm-sec-h">Pages</h4>
      ${grouped(pg).map(([g, items]) => `<div class="adm-group"><div class="adm-group-h">${esc(g)}<span>${items.filter(x => real.panels.includes(x.id)).length}/${items.length}</span></div>
        <div class="adm-list${edit.ok ? '' : ' is-ro'}">${items.map(x => row('panels', x.id, x.label, x.icon, '')).join('')}</div></div>`).join('')}
    </section>
    <section class="adm-sec">
      <h4 class="adm-sec-h">What ${esc(first)} can do</h4>
      <div class="adm-list${edit.ok ? '' : ' is-ro'}">${CAPS.map(([id, l, h]) => row('caps', id, l, null, h)).join('')}</div>
    </section>`;
}

async function saveUser(uid, val) {
  if (typeof fbSet === 'function') await fbSet(UPATH + '/' + uid, val);
  if (val) _access[uid] = val; else delete _access[uid];
  if (uid === myUid()) onMine(val);
  renderUser();
  if (typeof adminRenderUsers === 'function') adminRenderUsers();
}
async function userSet(kind, id, value) {
  const u = users()[_au]; if (!u) return;
  const chk = canSetUser(R(), _rules, editorCtx(), { role: u.role, uid: _au }, kind, id, value);
  if (!chk.ok) { if (typeof showToast === 'function') showToast(SEG_WHY[chk.why] || 'This can\'t be changed', 'err'); return; }
  const uid = _au, val = setAccess(_access[uid], kind, id, value);
  await saveUser(uid, val);
  const what = kind === 'caps' ? capLabel(id) : ((pages().find(x => x.id === id) || {}).label || id);
  const how = value === 'role' ? 'role default' : value ? 'allowed' : 'blocked';
  if (typeof logActivity === 'function') logActivity('user_access', `${u.name}: ${what} ${how}`);
  if (typeof showToast === 'function') showToast(`${String(u.name || '').split(' ')[0]}: ${what} · ${how} ✓`, 'ok');
}
async function userReset() {
  const u = users()[_au]; if (!u || !canEditFor(_au, u)) return;
  if (!confirm(`Give ${u.name} exactly the ${(R()[u.role] || {}).label || u.role} role's access again?`)) return;
  await saveUser(_au, null);
  if (typeof logActivity === 'function') logActivity('user_access', `${u.name}: reset to role`);
  if (typeof showToast === 'function') showToast(`${u.name} is back to the role's access ✓`, 'ok');
}

root.hoRoleRules = Object.assign({}, pure, { start, def, myDef, can, pages, render: renderRoles, rules: () => _rules, mine: () => _mine,
  loadAllAccess, summaryFor, canEditFor, closeUser, guardAll, _onRules: onRules, _onMine: onMine, _access: () => _access });
root.adminUserAccess = openUser;
root.adminUserAccessBack = closeUser;
root.adminUserSet = userSet;
root.adminUserReset = userReset;
root.adminRolesSelect = r => { _sel = r; renderRoles(); };
root.adminRoleToggle = toggle;
root.adminRoleReset = reset;
})(typeof window !== 'undefined' ? window : globalThis);

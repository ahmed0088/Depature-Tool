// ═══════════════════════════════════════════════════════════
//  shift-links.js  —  a shift task opens the page that does its work
//
//  A task can be linked to one page of the app ("Enrollment" → Guest
//  Pipeline). The link is saved with the task (task.tool = page id;
//  'none' = "no page, stop suggesting"), so older copies of the app just
//  ignore it. On the list the task shows "Open Guest Pipeline →" for
//  everyone; people who can edit shift tasks also see a suggestion for
//  tasks with no link yet, and "Link all suggestions". After opening a
//  page from a task, coming back offers "Mark '…' done?" (never ticked
//  without a tap).
// ═══════════════════════════════════════════════════════════
(function (root) {
'use strict';

// Names used when the menu isn't there (tests, pages that add themselves late)
const LABELS = {
  home: 'Home', departures: 'Departures', arrivals: 'Arrivals', xref: 'Arr vs Dep', purpose: 'Purpose of Stay', wakeups: 'Wake-up Calls',
  'ops-logs': 'Front Office Log', 'handover-book': 'Handover Book', 'hk-requests': 'HK Requests', checklist: 'Night Checklist', audit: 'PM Rooms',
  'inhouse-tally': 'Inhouse Tally', rent: 'Rented Rooms & Beds', immig: 'Immigration Check', nationality: 'Nationality Report', tourism: 'Tourism Tax',
  'td-audit': 'TD 30-Day Audit', dtcm: 'DTCM Recon', 'package-audit': 'Package Audit', 'skip-clean': 'Skip The Clean', noshow: 'No-Show Tracker',
  rates: 'Rate Shop', pipeline: 'Guest Pipeline', 'arrivals-proc': 'Arrivals Processor', trends: 'Trends', history: 'History', roster: 'Roster',
  standards: 'Accor Standards', learn: 'Learn HotelOps', qr: 'QR Code Maker', settings: 'Settings',
};
const NEVER = ['guestmem', 'shifts'];   // Guest Memory is never linked; a task opening its own list makes no sense

// Words in a task → the page that does it. First match wins, so the specific ones come first.
const RULES = [
  [/\barr(?:ivals?)?\.? ?(?:vs\.?|v\.?|versus|\/) ?dep(?:artures?)?\b|cross.?ref|\bx.?ref\b|extensions?\b/i, 'xref'],
  [/skip (?:the )?clean|\bSTC\b/i, 'skip-clean'],
  [/\bTD\b.{0,12}(?:30|audit)|30.?days? (?:TD|tourism|audit)|\btd.?audit\b/i, 'td-audit'],
  [/\bdtcm\b/i, 'dtcm'],
  [/tourism|dirham/i, 'tourism'],
  [/\bTD\b/, 'tourism'],
  [/enrol|(?<!(?:team|staff|crew) )\bmembers?(?:hips?)?\b|loyalty|guest pipeline|\bpipeline\b/i, 'pipeline'],
  [/wake.?ups?\b|morning calls?\b/i, 'wakeups'],
  [/immigration|passports?\b|\bimmig\b/i, 'immig'],
  [/no.?shows?\b|\bNA40\b/i, 'noshow'],
  [/hand.?overs?\b/i, 'handover-book'],
  [/\bHK\b|house.?keeping/i, 'hk-requests'],
  [/night audit|check.?list/i, 'checklist'],
  [/\bpm rooms?\b/i, 'audit'],
  [/\bPM\b/, 'audit'],
  [/rate ?shop|\brates?\b|comp ?set|competitors?\b/i, 'rates'],
  [/in.?house|\btally\b/i, 'inhouse-tally'],
  [/\brented\b|\brooms? ?(?:&|and|\/) ?beds?\b/i, 'rent'],
  [/packages?\b|upsells?\b/i, 'package-audit'],
  [/nationalit/i, 'nationality'],
  [/purpose/i, 'purpose'],
  [/\broster\b|\brota\b/i, 'roster'],
  [/\bQR\b/i, 'qr'],
  [/pre.?reg|\barrivals?\b|check.?ins?\b/i, 'arrivals'],
  [/\bdepartures?\b|check.?outs?\b/i, 'departures'],
  [/\bC\/?O\b/, 'departures'],
  [/\bfloat\b|\bcash\b|lost ?(?:&|and|\+) ?found|\bL&F\b|maintenance|\blog(?:book|s)?\b/i, 'ops-logs'],
];
// "ALL" (Accor Live Limitless) only when written in capitals inside normal text, not "CHECK ALL ROOMS"
const ALL_RE = /\bALL\b/;

/** The page these words point to, or '' */
function suggestFromText(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  for (const [re, id] of RULES) if (re.test(s)) return id;
  if (ALL_RE.test(s) && s !== s.toUpperCase()) return 'pipeline';
  return '';
}
/** A suggestion for a task: from its name first, then its hint. '' when it is linked, or set to "no page". */
function suggest(t) {
  if (!t || (t.tool != null && t.tool !== '')) return '';
  return suggestFromText(t.name) || suggestFromText(t.hint);
}
/** The page a task is linked to ('' for none) */
function toolOf(t) { const v = t && t.tool; return v && v !== 'none' && !NEVER.includes(v) ? String(v) : ''; }
/** A copy of the task list with these links set: { taskId: pageId | 'none' | null (= remove) }.
 *  Only the named tasks change; ids not in the list are ignored (a colleague deleted it). */
function applyTools(tasks, changes) {
  const ch = changes || {};
  return (Array.isArray(tasks) ? tasks : []).map(t => {
    if (!t || !Object.prototype.hasOwnProperty.call(ch, t.id)) return t;
    const v = ch[t.id], c = Object.assign({}, t);
    if (v == null || v === '' || NEVER.includes(v)) delete c.tool; else c.tool = String(v);
    return c;
  });
}
/** Every task with no link and a suggestion → { taskId: pageId } */
function linkAllChanges(tasks) {
  const out = {};
  (Array.isArray(tasks) ? tasks : []).forEach(t => { const s = suggest(t); if (s && t.id) out[t.id] = s; });
  return out;
}
/** A saved task list as a plain array (Firebase can hand back an object keyed 0, 1, 2…) */
function asList(v) { return Array.isArray(v) ? v.filter(Boolean) : (v && typeof v === 'object') ? Object.values(v).filter(Boolean) : null; }

const pure = { LABELS, RULES, NEVER, suggestFromText, suggest, toolOf, applyTools, linkAllChanges, asList };
root.hoShiftLinks = pure;
if (typeof document === 'undefined' || !root.document || typeof root.document.createElement !== 'function') return;

// ══════════ In the app ══════════
const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(s == null ? '' : String(s))
  : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
const jsq = s => esc(JSON.stringify(String(s)));   // a value inside onclick="…('…')"

function navItem(id) { return document.querySelector(`nav.sidenav .nav-item[data-panel="${id}"]`); }
function labelOf(id) {
  const el = navItem(id);
  const txt = el ? [...el.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent).join(' ').replace(/\s+/g, ' ').trim() : '';
  return txt || LABELS[id] || id;
}
function iconOf(id) {
  const svg = typeof hoIcon === 'function' ? hoIcon(id) : '';
  if (svg) return svg;
  const ic = navItem(id) && navItem(id).querySelector('.nav-icon');
  return esc(ic ? (ic.dataset.emoji || ic.textContent.trim()) : '🔗');
}
/** Every page that can be linked, in menu groups: [{ id, label, group }] */
function catalog() {
  const groups = root.hoNavGroups || [];
  const ids = [];
  document.querySelectorAll('nav.sidenav .nav-item[data-panel]').forEach(el => { const id = el.dataset.panel; if (id && !ids.includes(id)) ids.push(id); });
  Object.keys(LABELS).forEach(id => { if (!ids.includes(id) && !navItem(id) && document.getElementById('panel-' + id)) ids.push(id); });
  const out = ids.filter(id => !NEVER.includes(id)).map(id => {
    const g = groups.find(([, ps]) => ps.includes(id));
    return { id, label: labelOf(id), group: g ? g[0] : 'Tools' };
  });
  const order = groups.map(g => g[0]);
  const rank = p => { const gi = order.indexOf(p.group); const g = groups[gi]; return (gi < 0 ? 99 : gi) * 1000 + (g ? Math.max(0, g[1].indexOf(p.id)) : 999); };
  return out.sort((a, b) => rank(a) - rank(b));
}
function exists(id) { return !!(navItem(id) || document.getElementById('panel-' + id)); }
function allowed(id) { try { return typeof hoPanelAllowed === 'function' ? hoPanelAllowed(id) : true; } catch (_) { return true; } }
/** May this person change the task list (Team → Roles & access: "Edit the roster & shift tasks") */
function canEdit() {
  if (typeof currentProfile === 'undefined' || !currentProfile) return true;
  if (currentProfile.role === 'owner') return true;
  if (typeof roCanEdit === 'function') { try { return !!roCanEdit(); } catch (_) {} }
  const d = typeof myRoleDef === 'function' ? myRoleDef() : null;
  return !!(d && d.canEditShifts);
}

// ── On the list ───────────────────────────────────────────
/** The chip under a task: "Open Guest Pipeline →", or a suggestion for editors */
function chipHtml(key, t) {
  const id = toolOf(t);
  if (id) {
    const lbl = labelOf(id);
    if (!exists(id)) return `<div class="stl-row"><span class="stl-chip off" title="This page isn't on this device">${iconOf(id)}<span>${esc(lbl)}</span><em>not on this device</em></span></div>`;
    if (!allowed(id)) return `<div class="stl-row"><button type="button" class="stl-chip off" disabled aria-disabled="true" title="Not available for your role">${iconOf(id)}<span>${esc(lbl)}</span><em>Not available for your role</em></button></div>`;
    return `<div class="stl-row"><button type="button" class="stl-chip" onclick="stlOpen(${jsq(key)},${jsq(t.id)})" title="Open ${esc(lbl)}">${iconOf(id)}<span><i class="stl-open">Open </i>${esc(lbl)}</span><b aria-hidden="true">→</b></button></div>`;
  }
  const s = suggest(t);
  if (!s || !canEdit() || !exists(s)) return '';
  return `<div class="stl-row"><span class="stl-sug"><span class="stl-sug-lbl">Suggested:</span>${iconOf(s)}<span class="stl-sug-name">${esc(labelOf(s))}</span>`
    + `<button type="button" class="stl-sug-yes" onclick="stlLink(${jsq(key)},${jsq(t.id)},${jsq(s)})">Link it</button>`
    + `<button type="button" class="stl-sug-no" onclick="stlLink(${jsq(key)},${jsq(t.id)},'none')" title="No page for this task" aria-label="Don't link">✕</button></span></div>`;
}
/** Above the list: "back from …, mark done?" and "Link all suggestions" */
function topHtml(key, active) {
  let h = '';
  const r = _ret;
  if (r && r.key === key && Date.now() - r.at < 3 * 3600e3 && typeof SHIFTS !== 'undefined') {
    const t = (SHIFTS[key].tasks || []).find(x => x.id === r.id);
    if (t && !(typeof stIsDone === 'function' && stIsDone(key, t))) {
      h += `<div class="stl-back" role="status">${iconOf(r.tool)}<span class="stl-back-txt">Back from <b>${esc(labelOf(r.tool))}</b>. Mark “${esc(t.name)}” done?</span>`
        + `<span class="stl-back-acts"><button type="button" class="btn gold sm" onclick="stlReturnDone()">✓ Mark done</button><button type="button" class="btn sm" onclick="stlReturnSkip()">Not yet</button></span></div>`;
    } else _ret = null;
  }
  if (canEdit()) {
    const ch = linkAllChanges(active || []);
    const ids = Object.keys(ch).filter(id => exists(ch[id]));
    if (ids.length >= 2) h += `<div class="stl-all"><span>🔗 <b>${ids.length} tasks</b> could open the page that does them</span><button type="button" class="btn sm" onclick="stlLinkAll(${jsq(key)})">Link all suggestions</button></div>`;
  }
  return h;
}

// ── Opening a page from a task, and coming back ──────────
let _ret = null;   // { key, id, tool, at }: the task the person left from
function stlOpen(key, id) {
  const t = (SHIFTS[key] && SHIFTS[key].tasks || []).find(x => x.id === id); if (!t) return;
  const tool = toolOf(t); if (!tool) return;
  if (!allowed(tool)) { if (typeof showToast === 'function') showToast('Not available for your role', 'err'); return; }
  const done = typeof stIsDone === 'function' && stIsDone(key, t);
  _ret = done ? null : { key, id, tool, at: Date.now() };
  showPanel(tool);
  try { (document.querySelector('.main') || document.scrollingElement || document.documentElement).scrollTo(0, 0); } catch (_) {}
}
function stlReturnDone() {
  const r = _ret; _ret = null; if (!r) return;
  const t = (SHIFTS[r.key] && SHIFTS[r.key].tasks || []).find(x => x.id === r.id);
  if (t && !stIsDone(r.key, t)) stToggle(r.key, r.id); else _renderShiftContent(r.key);
}
function stlReturnSkip() { const r = _ret; _ret = null; if (r) _renderShiftContent(r.key); }

// ── Saving links ─────────────────────────────────────────
// Only the link changes, on top of the saved list read fresh, so a colleague's newer task
// edits aren't overwritten by this device's copy.
async function save(key, changes) {
  if (!SHIFTS[key]) return;
  SHIFTS[key].tasks = applyTools(SHIFTS[key].tasks, changes);
  _renderShiftContent(key);
  if (typeof shiftsLoaded === 'function' && !shiftsLoaded()) { console.warn('[shifts] not saving — the saved tasks have not loaded yet'); return; }
  let fresh = null;
  try { fresh = typeof fbGet === 'function' ? asList(await fbGet('shifts/data/' + key + '/tasks')) : null; } catch (_) {}
  if (fresh && fresh.length) SHIFTS[key].tasks = applyTools(fresh, changes);
  persistShifts(key);
  if (typeof activeShift !== 'undefined' && activeShift === key) _renderShiftContent(key);
}
function stlLink(key, id, tool) {
  if (!canEdit()) { if (typeof showToast === 'function') showToast('Only roles that can edit shift tasks can link them', 'err'); return; }
  const t = (SHIFTS[key].tasks || []).find(x => x.id === id); if (!t) return;
  save(key, { [id]: tool });
  if (tool && tool !== 'none') {
    if (typeof stLog === 'function') stLog(key, 'linked to ' + labelOf(tool), t.name);
    if (typeof showToast === 'function') showToast(`🔗 "${t.name}" opens ${labelOf(tool)}`, 'ok');
  }
}
function stlLinkAll(key) {
  if (!canEdit()) return;
  const day = typeof stDayOf === 'function' ? stDayOf(key) : '';
  const list = (SHIFTS[key].tasks || []).filter(t => typeof stTaskState !== 'function' || stTaskState(t, day, key) !== 'gone');
  const ch = linkAllChanges(list);
  Object.keys(ch).forEach(id => { if (!exists(ch[id])) delete ch[id]; });
  const n = Object.keys(ch).length; if (!n) return;
  save(key, ch);
  if (typeof stLog === 'function') stLog(key, 'linked to their pages', n + ' task' + (n > 1 ? 's' : ''));
  if (typeof showToast === 'function') showToast(`🔗 ${n} task${n > 1 ? 's' : ''} linked to their pages`, 'ok');
}

// ── The page picker ──────────────────────────────────────
let _pick = null;   // { cb, cur }
function pickOpen(cur, cb, sugg) {
  let bg = document.getElementById('stlPick');
  if (!bg) {
    bg = document.createElement('div'); bg.id = 'stlPick'; bg.className = 'modal-bg stl-pick-bg';
    bg.innerHTML = `<div class="modal stl-pick" role="dialog" aria-modal="true" aria-labelledby="stlPickT" onclick="event.stopPropagation()">
      <div class="stl-pick-hd"><div id="stlPickT" class="stl-pick-t">Linked tool</div><button type="button" class="stl-pick-x" onclick="stlPickClose()" aria-label="Close">✕</button></div>
      <input id="stlPickQ" class="stl-pick-q" type="search" placeholder="Search pages…" autocomplete="off" oninput="stlPickRender()"/>
      <div id="stlPickL" class="stl-pick-l"></div></div>`;
    bg.addEventListener('click', () => stlPickClose());
    bg.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); stlPickClose(); } });
    document.body.appendChild(bg);
  }
  _pick = { cb, cur: cur || '', sugg: sugg || '' };
  document.getElementById('stlPickQ').value = '';
  stlPickRender();
  bg.classList.add('open');
  setTimeout(() => { try { document.getElementById('stlPickQ').focus(); } catch (_) {} }, 30);
}
function stlPickClose() { const bg = document.getElementById('stlPick'); if (bg) bg.classList.remove('open'); _pick = null; }
function stlPickRender() {
  const L = document.getElementById('stlPickL'); if (!L || !_pick) return;
  const q = (document.getElementById('stlPickQ').value || '').trim().toLowerCase();
  const all = catalog();
  const hit = p => !q || p.label.toLowerCase().includes(q) || p.id.includes(q) || p.group.toLowerCase().includes(q) || suggestFromText(q) === p.id;
  const row = (id, label, extra) => `<button type="button" class="stl-opt${_pick.cur === id ? ' on' : ''}" onclick="stlPickChoose(${jsq(id)})">`
    + `<span class="stl-opt-ic">${id ? iconOf(id) : '∅'}</span><span class="stl-opt-l">${esc(label)}</span>${extra || ''}${_pick.cur === id ? '<b class="stl-opt-ck">✓</b>' : ''}</button>`;
  let h = '';
  if (!q) h += row('', 'None', '<small>no page</small>');
  if (!q && _pick.sugg && !_pick.cur) { const s = all.find(p => p.id === _pick.sugg); if (s) h += `<div class="stl-grp">Suggested</div>` + row(s.id, s.label, '<small>from its words</small>'); }
  let g = '';
  all.filter(hit).forEach(p => {
    if (p.group !== g) { g = p.group; h += `<div class="stl-grp">${esc(g)}</div>`; }
    h += row(p.id, p.label, allowed(p.id) ? '' : '<small>not for your role</small>');
  });
  if (q && !all.some(hit)) h += '<div class="stl-none">No page matches</div>';
  L.innerHTML = h;
}
function stlPickChoose(id) { const p = _pick; stlPickClose(); if (p && p.cb) p.cb(id || ''); }

// ── In the edit window ───────────────────────────────────
function field() {
  let f = document.getElementById('et-tool-f');
  if (f) return f;
  const after = document.getElementById('et-name') && document.getElementById('et-name').closest('.mf');
  if (!after) return null;
  f = document.createElement('div'); f.className = 'mf mf-task'; f.id = 'et-tool-f';
  f.innerHTML = `<label class="mf-label-task">Linked tool <span style="opacity:0.45;font-weight:400;">(optional: the page that does this task)</span></label>
    <input type="hidden" id="et-tool"/><button type="button" id="et-tool-btn" class="stl-field" onclick="stlEditPick()"></button><div id="et-tool-sug" class="stl-field-sug"></div>`;
  after.after(f);
  const nm = document.getElementById('et-name');
  if (nm && !nm.dataset.stl) { nm.dataset.stl = '1'; nm.addEventListener('input', paintField); }
  return f;
}
function paintField() {
  const hid = document.getElementById('et-tool'), btn = document.getElementById('et-tool-btn'), sg = document.getElementById('et-tool-sug');
  if (!hid || !btn) return;
  const v = hid.value, ed = canEdit();
  btn.disabled = !ed;
  btn.innerHTML = v && v !== 'none'
    ? `<span class="stl-field-ic">${iconOf(v)}</span><span class="stl-field-l">${esc(labelOf(v))}</span><span class="stl-field-c">Change ▾</span>`
    : `<span class="stl-field-ic">∅</span><span class="stl-field-l muted">None</span><span class="stl-field-c">${ed ? 'Choose ▾' : ''}</span>`;
  btn.title = ed ? 'Choose the page this task opens' : 'Only roles that can edit shift tasks can change this';
  let s = '';
  if (ed && !v) {
    const sug = suggestFromText(document.getElementById('et-name').value) || suggestFromText(document.getElementById('et-hint') && document.getElementById('et-hint').value);
    if (sug && exists(sug)) s = `<span class="stl-sug"><span class="stl-sug-lbl">Suggested:</span>${iconOf(sug)}<span class="stl-sug-name">${esc(labelOf(sug))}</span><button type="button" class="stl-sug-yes" onclick="stlEditSet(${jsq(sug)})">Link it</button></span>`;
  }
  if (sg) sg.innerHTML = s;
}
/** openEditTask → show this task's link */
function stlEditOpen(task) { if (!field()) return; document.getElementById('et-tool').value = task && task.tool && task.tool !== 'none' ? task.tool : (task && task.tool === 'none' ? 'none' : ''); paintField(); }
function stlEditSet(id) { const h = document.getElementById('et-tool'); if (h) h.value = id || ''; paintField(); }
function stlEditPick() {
  if (!canEdit()) return;
  const cur = document.getElementById('et-tool').value;
  const sug = suggestFromText(document.getElementById('et-name').value);
  pickOpen(cur === 'none' ? '' : cur, id => stlEditSet(id || 'none'), sug);
}
/** saveEditTask → store the chosen link on the task (only people who may edit change it) */
function stlEditRead(task) {
  const h = document.getElementById('et-tool'); if (!h || !task || !canEdit()) return;
  const v = h.value;
  if (v) task.tool = v; else delete task.tool;
}

// ── In the "add a task" row ──────────────────────────────
function addBtnHtml(key) {
  if (!canEdit()) return '';
  return `<button type="button" class="st-add-at stl-add" id="stTool-${esc(key)}" data-tool="" onclick="stlAddPick(${jsq(key)})" title="Linked tool (optional): the page this task opens">🔗 Tool</button>`;
}
function stlAddPick(key) {
  const b = document.getElementById('stTool-' + key); if (!b) return;
  const n = document.getElementById('stIn-' + key);
  pickOpen(b.dataset.tool, id => {
    b.dataset.tool = id || '';
    b.innerHTML = id ? `${iconOf(id)}<span>${esc(labelOf(id))}</span>` : '🔗 Tool';
    b.classList.toggle('on', !!id);
  }, suggestFromText(n && n.value));
}
/** stAddTask → the link chosen in the add row (then cleared) */
function stlAddRead(key, task) {
  const b = document.getElementById('stTool-' + key); if (!b) return;
  if (b.dataset.tool) task.tool = b.dataset.tool;
  b.dataset.tool = ''; b.innerHTML = '🔗 Tool'; b.classList.remove('on');
}

Object.assign(root, { stlChipHtml: chipHtml, stlTopHtml: topHtml, stlAddBtnHtml: addBtnHtml, stlAddRead, stlAddPick, stlOpen, stlReturnDone, stlReturnSkip,
  stlLink, stlLinkAll, stlPickClose, stlPickRender, stlPickChoose, stlEditOpen, stlEditRead, stlEditSet, stlEditPick, stlCatalog: catalog });
})(typeof window !== 'undefined' ? window : globalThis);

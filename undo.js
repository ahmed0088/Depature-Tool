// ═══════════════════════════════════════════════════════════
//  undo.js — Ctrl+Z / Cmd+Z undoes what you just did, anywhere in the app
//
//  hoUndo.push(label, undoFn, { redo, quiet })   remember an action
//  hoUndo.undo() / hoUndo.redo()                 Ctrl+Z · Ctrl+Shift+Z / Ctrl+Y
//  hoUndo.list()                                 newest first
//
//  • Keeps the last 30 actions; anything older than 2 hours is dropped.
//  • While you type in a box (input, textarea, select, editable text) Ctrl+Z
//    is left to the browser, so it undoes your typing as usual.
//  • Every Undo toast (showUndoToast in utils.js) lands here too, so it can
//    still be undone with Ctrl+Z after the toast has gone. Each undo runs once.
//  • The common one-tap actions (tick a shift task, a monthly report, a
//    checklist step or a DTCM row; a room's status; a wake-up call …) are
//    wrapped below. Their undo goes back through the app's own functions, so
//    it saves to the database the same way the action did (one item at a time).
//  • Recent actions: the list (last 10, each with Undo) opens from the
//    keyboard-shortcuts window (⌨ / ?) and from the Undo bar.
//  Load after the feature scripts (after handover.js).
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';
const MAX = 30, TTL = 2 * 3600e3, BAR_MS = 10000;
const W = typeof window !== 'undefined' ? window : globalThis;
const doc = typeof document !== 'undefined' ? document : null;

let stack = [], redoStack = [], busy = 0, seq = 0;
const now = () => Date.now();
function prune() {
  const cut = now() - TTL;
  stack = stack.filter(e => e.at >= cut).slice(-MAX);
  redoStack = redoStack.filter(e => e.at >= cut).slice(-MAX);
}
/** Run fn with undo recording switched off (an undo / redo in progress). */
function quietly(fn) {
  busy++;
  try { return fn(); } finally { busy--; }
}
function push(label, undoFn, opt) {
  opt = opt || {};
  if (busy || typeof undoFn !== 'function') return null;
  const e = { id: ++seq, label: String(label || 'Last action'), undo: undoFn, redo: typeof opt.redo === 'function' ? opt.redo : null, at: now() };
  stack.push(e); redoStack = []; prune();
  if (!opt.quiet) ui('bar', e);
  return e;
}
function remove(e) {
  const had = stack.includes(e) || redoStack.includes(e);
  stack = stack.filter(x => x !== e); redoStack = redoStack.filter(x => x !== e);
  return had;
}
function fail(e, err) {
  try { console.warn('[undo]', e.label, err); } catch (_) {}
  ui('toast', `Could not undo "${e.label}": ${(err && err.message) || 'it changed since'}`, 'err');
}
/** Undo the newest action, or the one given (from the Recent actions list). */
function undo(entry) {
  prune();
  const e = entry || stack[stack.length - 1];
  if (!e || !stack.includes(e)) { ui('toast', 'Nothing to undo', 'info'); return false; }
  remove(e);
  let r;
  try { r = quietly(() => e.undo()); }
  catch (err) { fail(e, err); return false; }
  if (r && typeof r.then === 'function') r.catch(err => fail(e, err));
  if (e.redo) { e.at = now(); redoStack.push(e); }
  ui('done', e, 'undo');
  return true;
}
function redo() {
  prune();
  const e = redoStack.pop();
  if (!e) { ui('toast', 'Nothing to redo', 'info'); return false; }
  let r;
  try { r = quietly(() => e.redo()); }
  catch (err) { try { console.warn('[undo] redo', e.label, err); } catch (_) {} ui('toast', `Could not redo "${e.label}"`, 'err'); return false; }
  // a redo may hand back a fresh undo (the action was done again, with new details)
  if (typeof r === 'function') e.undo = r;
  e.at = now(); stack.push(e); prune();
  ui('done', e, 'redo');
  return true;
}
/** True when Ctrl+Z belongs to the browser: the focus is in something you type into. */
function isTyping(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const t = String(el.tagName || '').toUpperCase();
  if (t === 'TEXTAREA' || t === 'SELECT') return true;
  if (t !== 'INPUT') return false;
  // a ticked box or a button has no text to undo: Ctrl+Z there is the app's
  return !/^(checkbox|radio|button|submit|reset|range|color|file|image)$/i.test(el.type || 'text');
}
/** What a key press means: 'undo', 'redo' or '' (not ours). */
function keyAction(e, active) {
  if (!e || !(e.ctrlKey || e.metaKey) || e.altKey) return '';
  const k = String(e.key || '').toLowerCase();
  let a = '';
  if (k === 'z') a = e.shiftKey ? 'redo' : 'undo';
  else if (k === 'y' && e.ctrlKey && !e.shiftKey) a = 'redo';
  if (!a || isTyping(active)) return '';
  return a;
}

const hoUndo = {
  push, undo, redo, remove, quietly, isTyping, keyAction,
  busy: () => busy > 0,
  list: () => { prune(); return stack.slice().reverse(); },
  redoList: () => { prune(); return redoStack.slice().reverse(); },
  clear: () => { stack = []; redoStack = []; },
  MAX, TTL,
};
W.hoUndo = hoUndo;

// ══ Screen ══════════════════════════════════════════════════
const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
const isMac = () => { try { return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent); } catch (_) { return false; } };
const keyName = () => isMac() ? '⌘Z' : 'Ctrl+Z';

function mount() {
  if (!doc || doc.getElementById('hoUndoCss')) return;
  const st = doc.createElement('style'); st.id = 'hoUndoCss';
  st.textContent = `
#hoUndoBar{position:fixed;left:50%;bottom:calc(132px + env(safe-area-inset-bottom,0px));transform:translateX(-50%) translateY(16px);z-index:9998;
  display:flex;align-items:center;gap:8px;max-width:calc(100vw - 32px);box-sizing:border-box;padding:8px 8px 8px 14px;
  background:var(--card);color:var(--text);border:1px solid var(--border2);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);
  opacity:0;pointer-events:none;transition:opacity .18s,transform .18s;font-size:.78rem}
#hoUndoBar.show{opacity:1;pointer-events:auto;transform:translateX(-50%) translateY(0)}
#hoUndoBar .hu-msg{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#hoUndoBar .hu-key{font-family:var(--mono);font-size:.62rem;color:var(--text3);white-space:nowrap}
#hoUndoBar button{flex:none;border-radius:8px;padding:5px 10px;font:inherit;font-size:.72rem;font-weight:600;cursor:pointer;
  background:var(--card2);color:var(--text);border:1px solid var(--border2)}
#hoUndoBar button.hu-main{background:var(--accent-bg,var(--card2));color:var(--accent,var(--gold));border-color:var(--accent-border,var(--border2))}
#hoUndoBar button.hu-main:hover{background:var(--accent,var(--gold));color:var(--bg,#111)}
#hoUndoBar button.hu-ico{padding:5px 8px;font-weight:400}
@media (max-width:480px){#hoUndoBar .hu-key{display:none}#hoUndoBar{font-size:.74rem}}
#hoUndoList .modal{max-width:440px;width:calc(100vw - 32px);box-sizing:border-box}
#hoUndoList .hu-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
#hoUndoList .hu-head h3{margin:0;font-size:1rem}
#hoUndoList .hu-x{background:none;border:none;color:var(--text2);font-size:1rem;cursor:pointer;padding:4px 8px}
#hoUndoList .hu-sub{font-size:.72rem;color:var(--text3);margin:0 0 10px}
#hoUndoList .hu-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--border)}
#hoUndoList .hu-row .hu-l{flex:1;min-width:0;font-size:.8rem;color:var(--text);overflow-wrap:anywhere}
#hoUndoList .hu-row .hu-t{font-family:var(--mono);font-size:.62rem;color:var(--text3);white-space:nowrap}
#hoUndoList .hu-row button{flex:none;border-radius:8px;padding:4px 10px;font-size:.72rem;cursor:pointer;background:var(--card2);color:var(--text);border:1px solid var(--border2)}
#hoUndoList .hu-empty{padding:18px 0;text-align:center;color:var(--text3);font-size:.8rem}
.kb-undo-btn{margin-top:6px;border-radius:8px;padding:5px 10px;font-size:.72rem;cursor:pointer;background:var(--card2);color:var(--text);border:1px solid var(--border2)}`;
  doc.head.appendChild(st);
  kbSection();
}

let barTimer = null;
function bar(html, ms) {
  let b = doc.getElementById('hoUndoBar');
  if (!b) { b = doc.createElement('div'); b.id = 'hoUndoBar'; b.setAttribute('role', 'status'); b.setAttribute('aria-live', 'polite'); doc.body.appendChild(b); }
  b.innerHTML = html;
  doc.getElementById('undoToast')?.classList.remove('show');   // one bar at a time (its undo stays on Ctrl+Z)
  b.classList.add('show');
  clearTimeout(barTimer); barTimer = setTimeout(() => b.classList.remove('show'), ms);
  return b;
}
function hideBar() { const b = doc && doc.getElementById('hoUndoBar'); if (b) b.classList.remove('show'); }

function ui(kind, a, b) {
  if (!doc || !doc.body) return;
  mount();
  if (kind === 'toast') { if (typeof showToast === 'function') showToast(a, b === 'err' ? 'err' : 'info'); return; }
  if (kind === 'bar') {
    const e = a;
    const el = bar(`<span class="hu-msg" title="${esc(e.label)}">${esc(e.label)}</span><span class="hu-key">${keyName()}</span>
      <button class="hu-main" type="button">↩ Undo</button><button class="hu-ico" type="button" title="Recent actions" aria-label="Recent actions">🕘</button>`, BAR_MS);
    el.querySelector('.hu-main').onclick = () => { hideBar(); undo(e); };
    el.querySelector('.hu-ico').onclick = () => { hideBar(); openList(); };
    return;
  }
  if (kind === 'done') {
    const e = a, wasUndo = b === 'undo';
    const el = bar(`<span class="hu-msg" title="${esc(e.label)}">${wasUndo ? '↩ Undone' : '↪ Redone'}: ${esc(e.label)}</span>
      ${wasUndo && e.redo ? '<button class="hu-main" type="button">↪ Redo</button>' : ''}${!wasUndo ? '<button class="hu-main" type="button">↩ Undo</button>' : ''}`, 5000);
    const btn = el.querySelector('.hu-main');
    if (btn) btn.onclick = () => { hideBar(); if (wasUndo) redo(); else undo(e); };
    if (doc.getElementById('hoUndoList')?.classList.contains('open')) renderList();
  }
}

// ── Recent actions ────────────────────────────────────────
function ago(t) {
  const m = Math.round((now() - t) / 60e3);
  return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min ago';
}
function renderList() {
  const box = doc.getElementById('hoUndoListBody'); if (!box) return;
  const L = hoUndo.list().slice(0, 10);
  box.innerHTML = L.length ? L.map(e => `<div class="hu-row"><span class="hu-l">${esc(e.label)}</span><span class="hu-t">${ago(e.at)}</span><button type="button" data-hu="${e.id}">↩ Undo</button></div>`).join('')
    : '<div class="hu-empty">Nothing to undo yet. What you do in the next 2 hours shows here.</div>';
  box.querySelectorAll('[data-hu]').forEach(btn => btn.onclick = () => {
    const e = stack.find(x => String(x.id) === btn.getAttribute('data-hu'));
    if (e) undo(e); renderList();
  });
}
function openList() {
  mount();
  let m = doc.getElementById('hoUndoList');
  if (!m) {
    m = doc.createElement('div'); m.id = 'hoUndoList'; m.className = 'modal-bg';
    m.innerHTML = `<div class="modal" role="dialog" aria-label="Recent actions"><div class="hu-head"><h3>🕘 Recent actions</h3><button class="hu-x" type="button" aria-label="Close">✕</button></div>
      <p class="hu-sub">Your last 10 actions on this device. Undo any of them, or press ${keyName()} for the newest one.</p><div id="hoUndoListBody"></div></div>`;
    m.addEventListener('click', ev => { if (ev.target === m || ev.target.closest('.hu-x')) m.classList.remove('open'); });
    doc.body.appendChild(m);
  }
  doc.getElementById('kbModal')?.classList.remove('open');
  renderList();
  m.classList.add('open');
}
hoUndo.openList = openList;

/** An "Undo" part in the keyboard-shortcuts window, with the Recent actions button */
function kbSection() {
  const host = doc.querySelector('#kbModal .kb-sections');
  if (!host || doc.getElementById('kbUndoSec')) return;
  const s = doc.createElement('div'); s.className = 'kb-section'; s.id = 'kbUndoSec';
  const c = isMac() ? '⌘' : 'Ctrl';
  s.innerHTML = `<div class="kb-section-title">Undo</div>
    <div class="kb-row"><kbd>${c}</kbd>+<kbd>Z</kbd><span>Undo your last action</span></div>
    <div class="kb-row"><kbd>${c}</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd><span>Redo</span></div>
    <button class="kb-undo-btn" type="button" onclick="hoUndo.openList()">🕘 Recent actions</button>`;
  host.insertBefore(s, host.firstChild);
}

// ── Keys ──────────────────────────────────────────────────
let lastInput = 0;
if (doc) {
  ['pointerdown', 'keydown', 'touchstart', 'change', 'click'].forEach(t => doc.addEventListener(t, e => { if (e.isTrusted) lastInput = now(); }, true));
  doc.addEventListener('keydown', e => {
    const a = keyAction(e, doc.activeElement);
    if (!a) return;
    e.preventDefault();
    if (a === 'undo') undo(); else redo();
  });
}

// ══ Hooks: the common actions that had no undo ═════════════
// Each wrapper only records what a person did (a tap or a key, not a timer or a
// sync), and its undo runs the app's own function again, so saving is unchanged.
const userAct = () => {
  if (busy || depth) return false;
  const ev = W.event;
  return !!(ev && ev.isTrusted) || now() - lastInput < 1500 || hoUndo._force === true;
};
let depth = 0;
function hook(name, make) {
  const orig = W[name];
  if (typeof orig !== 'function' || orig._hoUndo) return;
  const f = function (...a) {
    if (!userAct()) return orig.apply(this, a);
    depth++;
    try { return make(orig, a, this); } finally { depth--; }
  };
  f._hoUndo = true; f._orig = orig;
  try { W[name] = f; } catch (_) {}
}
const raw = name => (W[name] && W[name]._orig) || W[name];
/** run a function that asks "Are you sure?" as if OK was pressed (redo of a confirmed action) */
function yes(fn) {
  const c = W.confirm; W.confirm = () => true;
  try { return fn(); } finally { W.confirm = c; }
}
const J = o => JSON.stringify(o === undefined ? null : o);
const clone = o => JSON.parse(J(o));
// globals other scripts declare with let / const (not on window): read by name, no eval (the page's CSP forbids it)
const GLOBALS = {
  SHIFTS: () => typeof SHIFTS !== 'undefined' ? SHIFTS : undefined,
  depRooms: () => typeof depRooms !== 'undefined' ? depRooms : undefined,
  depLog: () => typeof depLog !== 'undefined' ? depLog : undefined,
  bxWakes: () => typeof bxWakes !== 'undefined' ? bxWakes : undefined,
  clState: () => typeof clState !== 'undefined' ? clState : undefined,
  CL_STEPS: () => typeof CL_STEPS !== 'undefined' ? CL_STEPS : undefined,
};
const g = name => { try { return GLOBALS[name](); } catch (_) { return undefined; } };

/** An action + its undo; redo does it again and returns the fresh undo. */
function record(label, perform) {
  const undoFn = perform();
  if (typeof undoFn === 'function') push(label, undoFn, { redo: () => perform() });
}

function installShifts() {
  const S = () => g('SHIFTS');
  const T = (key, id) => ((S() || {})[key]?.tasks || []).find(t => t.id === id);
  const lbl = key => (S() || {})[key]?.label || key;
  const paint = key => { if (typeof _renderShiftContent === 'function') _renderShiftContent(key); if (typeof updateShiftBadge === 'function') updateShiftBadge(key); };

  hook('stToggle', (orig, [key, id]) => {
    const t = T(key, id); if (!t) return orig(key, id);
    const was = stIsDone(key, t), res = orig(key, id), t2 = T(key, id);
    if (t2 && stIsDone(key, t2) !== was) {
      const flip = want => () => { const x = T(key, id); if (!x) throw new Error('the task is gone'); if (stIsDone(key, x) !== want) orig(key, id); };
      push(`${was ? 'Unticked' : 'Ticked'} '${t.name}' (${lbl(key)})`, flip(was), { redo: flip(!was) });
    }
    return res;
  });
  hook('stToggleImp', (orig, [key, id]) => {
    const t = T(key, id); if (!t) return orig(key, id);
    const was = !!t.imp, res = orig(key, id);
    const flip = want => () => { const x = T(key, id); if (!x) throw new Error('the task is gone'); if (!!x.imp !== want) orig(key, id); };
    push(`${was ? 'Unmarked' : 'Marked'} '${t.name}' important`, flip(was), { redo: flip(!was) });
    return res;
  });
  hook('stAddTask', (orig, [key]) => {
    const sh = (S() || {})[key]; if (!sh) return orig(key);
    const before = new Set(sh.tasks.map(t => t.id)), res = orig(key);
    const added = (S()[key].tasks || []).filter(t => !before.has(t.id));
    if (added.length === 1) {
      const task = clone(added[0]);
      const take = () => {
        const s = S()[key]; const i = s.tasks.findIndex(t => t.id === task.id); if (i < 0) return;
        s.tasks.splice(i, 1); s.done = (s.done || []).filter(d => d !== task.id);
        if (typeof stLog === 'function') stLog(key, 'deleted', task.name);
        paint(key); persistShifts(key);
      };
      const put = () => {
        const s = S()[key]; if (s.tasks.some(t => t.id === task.id)) return;
        s.tasks.push(clone(task));
        if (typeof stLog === 'function') stLog(key, 'added', task.name);
        paint(key); persistShifts(key);
      };
      push(`Added '${task.name}' (${lbl(key)})`, take, { redo: put });
    }
    return res;
  });
  hook('saveEditTask', (orig, a) => {
    const key = doc.getElementById('et-shift')?.value, id = doc.getElementById('et-id')?.value;
    const t = T(key, id); if (!t) return orig(...a);
    const before = clone(t), res = orig(...a), t2 = T(key, id);
    if (!t2 || J(t2) === J(before)) return res;
    const after = clone(t2);
    const set = v => () => {
      const x = T(key, id); if (!x) throw new Error('the task is gone');
      Object.keys(x).forEach(k => delete x[k]); Object.assign(x, clone(v));
      paint(key); persistShifts(key);
    };
    push(`Edited '${after.name}' (${lbl(key)})`, set(before), { redo: set(after) });
    return res;
  });
  hook('resetShift', (orig, [key]) => {
    const sh = (S() || {})[key]; if (!sh) return orig(key);
    const done = (sh.done || []).slice(), at = sh.resetAt || '', res = orig(key);
    if (S()[key].resetAt === at) return res;   // "Cancel" in the question
    const back = () => {
      const s = S()[key];
      s.done = [...new Set((s.done || []).concat(done))].filter(id => s.tasks.some(t => t.id === id));
      s.resetAt = at;
      paint(key); persistShifts(key, { done: s.done, resetAt: at || null });
    };
    push(`Reset ${lbl(key)} tasks`, back, { redo: () => yes(() => orig(key)) });
    return res;
  });
}

function installMonthly() {
  const item = id => (typeof mrItems === 'function' ? mrItems() : []).find(r => r.id === id);
  const isDone = id => typeof mrOpen === 'function' && !mrOpen().some(r => r.id === id);
  const can = () => typeof fbSet === 'function';
  hook('mrToggle', (orig, [id]) => {
    const r = item(id); if (!r) return orig(id);
    const was = isDone(id), res = orig(id);
    if (isDone(id) === was) return res;
    const flip = want => () => { if (!item(id)) throw new Error('the report is gone'); if (isDone(id) !== want) orig(id); };
    push(`${was ? 'Unticked' : 'Ticked'} '${r.name}' (Monthly reports)`, flip(was), { redo: flip(!was) });
    return res;
  });
  const strip = r => { const o = clone(r); delete o.id; return o; };
  hook('mrAdd', (orig, a) => {
    const before = new Set((mrItems() || []).map(r => r.id)), res = orig(...a);
    const added = (mrItems() || []).filter(r => !before.has(r.id));
    if (added.length === 1) {
      const r = added[0], v = strip(r);
      push(`Added '${r.name}' (Monthly reports)`, () => yes(() => raw('mrDelete')(r.id)), { redo: () => { if (can()) fbSet('monthly/list/' + r.id, v); if (typeof mrRender === 'function') mrRender(); } });
    }
    return res;
  });
  hook('mrDelete', (orig, [id]) => {
    const r = item(id); if (!r) return orig(id);
    const v = strip(r), res = orig(id);
    if (item(id)) return res;   // "Cancel"
    push(`Removed '${r.name}' (Monthly reports)`, () => { if (can()) fbSet('monthly/list/' + id, v); if (typeof mrRender === 'function') mrRender(); }, { redo: () => yes(() => orig(id)) });
    return res;
  });
  hook('mrEdit', (orig, [id]) => {
    const r = item(id); if (!r) return orig(id);
    const before = { name: r.name, hint: r.hint || '' }, res = orig(id), r2 = item(id);
    if (!r2 || (r2.name === before.name && (r2.hint || '') === before.hint)) return res;
    const after = { name: r2.name, hint: r2.hint || '' };
    const set = v => () => { if (!item(id)) throw new Error('the report is gone'); if (typeof fbUpdate === 'function') fbUpdate('monthly/list/' + id, v); if (typeof mrRender === 'function') mrRender(); };
    push(`Edited '${after.name}' (Monthly reports)`, set(before), { redo: set(after) });
    return res;
  });
}

const DEP_NAME = { out: 'Out', na: 'No answer', dnd: 'DND', late: 'Late check-out', extended: 'Extended', due: 'Due out' };
const DEP_FIELDS = ['status', 'checkoutAt', 'naTime', 'dndTime', 'lateTime', 'extensionNights', 'extCheckoutTime', 'extRate', 'extReason', 'extConfirmed', 'intent', 'intentMinutes', 'lcoAcknowledged', 'note'];
function installDepartures() {
  const rooms = () => g('depRooms') || [];
  const log = () => g('depLog') || [];
  const pick = r => { const o = {}; DEP_FIELDS.forEach(k => { o[k] = r[k] === undefined ? null : clone(r[k]); }); return o; };
  hook('depAction', (orig, a) => {
    const [i, status, extra] = a;
    const r = rooms()[i]; if (!r) return orig(...a);
    const room = r.roomStr, prev = r.status;
    const perform = () => {
      const idx = rooms().findIndex(x => x.roomStr === room); if (idx < 0) throw new Error(`room ${room} is not on the board`);
      const x = rooms()[idx], before = pick(x), from = x.status;
      const L0 = log(), fwd = L0.findIndex(l => l.room === room && l.action !== 'undo'), fwdJ = fwd >= 0 ? J(L0[fwd]) : null;
      orig(idx, status, extra);
      const y = rooms().find(z => z.roomStr === room); if (!y) return null;
      const after = pick(y), topJ = J(log()[0]);
      if (J(after) === J(before)) return null;
      return () => {
        const z = rooms().find(q => q.roomStr === room); if (!z) throw new Error(`room ${room} is not on the board`);
        if (z.status !== after.status) throw new Error(`room ${room} changed since`);
        DEP_FIELDS.forEach(k => { if (k === 'note' && z.note !== after.note) return; if (before[k] === null) delete z[k]; else z[k] = clone(before[k]); });
        // the board's own log: the action becomes an "undo" line (as ↺ in the log does); undoing an undo puts the line back
        const Lg = log(), li = Lg.findIndex(l => J(l) === topJ);
        const t = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        if (status !== 'due') {
          const line = { room, name: z.name, action: 'undo', undone: status, time: t, roomIdx: rooms().indexOf(z), prevStatus: status };
          if (li >= 0) Lg.splice(li, 1, line); else Lg.unshift(line);
        } else {
          if (li >= 0) Lg.splice(li, 1);
          if (fwdJ) Lg.unshift(JSON.parse(fwdJ));
        }
        if (typeof depRender === 'function') depRender();
        if (typeof updateDepBadge === 'function') updateDepBadge();
        saveDeps();
        if (typeof logActivity === 'function') logActivity('departure_undo', `Room ${room}: back to ${DEP_NAME[from] || from}`);
      };
    };
    if (prev === status) return orig(...a);
    record(`Room ${room} → ${DEP_NAME[status] || status}`, perform);
  });
}

function installWakeups() {
  const wakes = () => g('bxWakes') || {};
  const save = (id, w) => { const B = wakes(); B[id] = w; if (typeof fbSet === 'function') fbSet('brain/wakeups/' + id, w); };
  const what = { wkAnswered: 'answered', wkSentUp: 'someone went up', wkCancel: 'cancelled', wkUndo: 'back to open', wkNoAnswer: 'no answer, calling again', wkEditTime: 'new time', wkConfirmed: 'read back' };
  Object.keys(what).forEach(name => hook(name, (orig, [id]) => {
    const w = wakes()[id]; if (!w) return orig(id);
    const room = w.room;
    const perform = () => {
      const B = wakes(); if (!B[id]) throw new Error('the call is gone');
      const before = clone(B[id]), ids = new Set(Object.keys(B));
      if (name === 'wkCancel') yes(() => orig(id)); else orig(id);
      const B2 = wakes(), after = B2[id] ? clone(B2[id]) : null, made = Object.keys(B2).filter(k => !ids.has(k));
      if (!after || (J(after) === J(before) && !made.length)) return null;
      return () => {
        if (!wakes()[id]) throw new Error('the call is gone');
        const patch = {};
        new Set(Object.keys(before).concat(Object.keys(after))).forEach(k => { if (J(before[k]) !== J(after[k])) patch[k] = before[k] === undefined ? null : before[k]; });
        if (Object.keys(patch).length) _wkPatch(id, patch);
        made.forEach(k => { delete wakes()[k]; if (typeof fbSet === 'function') fbSet('brain/wakeups/' + k, null); });   // the backup call it booked
        if (typeof wkRender === 'function') wkRender();
      };
    };
    // the question was answered "Cancel": nothing to record (perform returns null)
    record(`Wake-up call room ${room}: ${what[name]}`, perform);
  }));
  hook('wkDelete', (orig, [id]) => {
    const w = wakes()[id]; if (!w) return orig(id);
    const v = clone(w), res = orig(id);
    if (wakes()[id]) return res;   // "Cancel"
    push(`Deleted the wake-up call for room ${v.room} at ${v.time}`, () => { save(id, clone(v)); if (typeof wkRender === 'function') wkRender(); }, { redo: () => yes(() => orig(id)) });
    return res;
  });
}

function installChecklist() {
  const st = () => g('clState'), step = id => (g('CL_STEPS') || []).find(s => s.id === id);
  hook('clToggle2', (orig, [id]) => {
    const S = st(); if (!S || S.skipped.has(id)) return orig(id);
    const was = S.done.has(id), s = step(id), res = orig(id);
    if (st().done.has(id) === was) return res;
    const flip = want => () => { if (st().skipped.has(id)) throw new Error('the step is skipped now'); if (st().done.has(id) !== want) orig(id); };
    push(`${was ? 'Unticked' : 'Ticked'} '${(s && s.name) || 'step'}' (Night checklist)`, flip(was), { redo: flip(!was) });
    return res;
  });
  hook('clSkip2', (orig, [id]) => {
    const S = st(); if (!S) return orig(id);
    const was = S.skipped.has(id), wasDone = S.done.has(id), s = step(id), res = orig(id);
    if (st().skipped.has(id) === was) return res;
    push(`${was ? 'Unskipped' : 'Skipped'} '${(s && s.name) || 'step'}' (Night checklist)`, () => {
      if (st().skipped.has(id) !== was) orig(id);
      if (wasDone && !st().done.has(id)) raw('clToggle2')(id);
    }, { redo: () => { if (st().skipped.has(id) === was) orig(id); } });
    return res;
  });
}

function installDtcm() {
  hook('dtcToggleDone', (orig, [cb]) => {
    const key = cb && cb.getAttribute && cb.getAttribute('data-dtc-key'); if (!key) return orig(cb);
    const on = !!cb.checked, res = orig(cb);
    const tr = cb.closest && cb.closest('tr');
    const room = tr ? [...tr.cells].slice(1, 3).map(c => c.textContent.trim()).filter(Boolean).join(' · ') : '';
    const set = want => () => {
      const el = [...doc.querySelectorAll('input[data-dtc-key]')].find(x => x.getAttribute('data-dtc-key') === key);
      if (!el) throw new Error('open the DTCM sheet first');
      if (el.checked === want) return;
      el.checked = want; orig(el);
    };
    push(`${on ? 'Ticked' : 'Unticked'} DTCM row${room ? ' ' + room.slice(0, 40) : ''}`, set(!on), { redo: set(on) });
    return res;
  });
}

function install() {
  if (!doc) return;
  [installShifts, installMonthly, installDepartures, installWakeups, installChecklist, installDtcm].forEach(f => { try { f(); } catch (e) { try { console.warn('[undo] hook', e); } catch (_) {} } });
  mount();
}
if (doc) {
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', install); else install();
  W.addEventListener && W.addEventListener('load', install);   // a feature script that loads later is wrapped too
}
})();

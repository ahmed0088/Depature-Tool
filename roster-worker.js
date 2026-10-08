// ═══════════════════════════════════════════════════════════
//  roster-worker.js — builds the roster in the background
//  The same engine as the page (roster.js, roster-build.js,
//  roster-team.js), run in a Web Worker so the screen never
//  freezes while it tries different weeks. The page sends the
//  builder's input and the data it reads; the worker sends back
//  the week. If anything goes wrong the page builds it itself.
// ═══════════════════════════════════════════════════════════
/* global roDays:writable, roStaff:writable, roCodes:writable, rbPeople:writable, rbSettings:writable, rbWeek:writable, rbSolve */
self.window = self;
const _noop = () => {};
const _el = () => ({ style: {}, classList: { add: _noop, remove: _noop, toggle: _noop, contains: () => false }, addEventListener: _noop, appendChild: _noop, remove: _noop, querySelector: () => null, querySelectorAll: () => [], setAttribute: _noop });
self.document = { readyState: 'loading', addEventListener: _noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: _el, body: _el(), documentElement: _el() };
if (!self.localStorage) self.localStorage = { getItem: () => null, setItem: _noop, removeItem: _noop };
self.escapeHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
self.showToast = _noop; self.fbSet = _noop; self.fbUpdate = _noop; self.fbListen = _noop; self.roCanEdit = () => true;

let _ready = null;
try { importScripts('roster.js', 'roster-build.js', 'roster-team.js'); _ready = true; } catch (e) { _ready = e.message || String(e); }

self.onmessage = e => {
  const d = e.data || {};
  if (_ready !== true) { self.postMessage({ id: d.id, ok: false, error: 'load: ' + _ready }); return; }
  try {
    roDays = d.roDays || {}; roStaff = d.roStaff || {}; roCodes = d.roCodes || {};
    rbPeople = d.rbPeople || {}; rbSettings = d.rbSettings || {}; rbWeek = d.I && d.I.week;
    const t = Date.now(), res = rbSolve(d.I);
    self.postMessage({ id: d.id, ok: true, res: { cells: res.cells, notes: res.notes || [] }, ms: Date.now() - t });
  } catch (err) { self.postMessage({ id: d.id, ok: false, error: err && err.message || String(err) }); }
};

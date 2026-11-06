'use strict';
// Render synthetic run records; never connects to Firebase or starts a real job.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const elements = {}, listeners = {}, writes = [], opened = [];
let now = 200000, intervalTick;
function element() {
  const classes = new Set();
  return { _html: '', htmlWrites: 0, get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; this.htmlWrites++; }, hidden: false, events: {}, classList: { add: s => classes.add(s), remove: s => classes.delete(s), contains: s => classes.has(s) },
    setAttribute() {}, addEventListener(k, fn) { this.events[k] = fn; }, querySelector: () => null, querySelectorAll: () => [] };
}
const sb = { console, Date: class extends Date { static now() { return now; } },
  document: { readyState: 'loading', addEventListener() {}, getElementById: id => elements[id] || null, createElement: element,
    body: { appendChild(e) { elements[e.id] = e; } } },
  localStorage: { getItem: () => null, setItem() {} }, _ref: {},
  fbListen: (p, cb) => { listeners[p] = cb; }, fbSet() {}, fbUpdate: (p, data) => writes.push({ p, data }),
  setTimeout: () => 0, setInterval: fn => { intervalTick = fn; return 1; }, clearInterval() {},
  gpAccorRunWin: () => opened.push('enrol'), hoNxRunOpen: () => opened.push('neorcha') };
sb.window = sb;
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'run-dock.js'), 'utf8'), sb);
const runs = {
  done: { tag: 'done', no: 1, kind: 'enrol', state: 'done', started: 10000, at: 40000, n: 4, done: 4, note: 'Complete' },
  error: { tag: 'error', no: 2, kind: 'neorcha', state: 'error', started: 50000, at: 70000, note: 'HTTP 404', url: 'https://github.com/example/repo/actions/runs/1' },
  stopped: { tag: 'stopped', no: 3, kind: 'enrol', state: 'stopped', started: 80000, at: 100000 },
};
listeners.cloudRuns(runs);
sb.hoRuns.list();
let html = elements.hoRunList.innerHTML;
assert.match(html, /Cloud run history/);
assert.match(html, /Run history · ended/);
assert(!html.includes('Open live window'), 'completed, failed and stopped records must never have a live action');
assert(!elements.hoRunDock.innerHTML.includes('data-hrd-open='), 'finished runs must not remain as live dock chips');
assert.match(elements.hoRunDock.innerHTML, /Run history/);
assert.match(html, /HTTP 404/); assert.match(html, /GitHub ↗/);
now += 60000; sb.hoRuns.list();
assert.equal(elements.hoRunList.innerHTML, html, 'history duration and status must not keep advancing');

// Even a stale button still present in a previous render cannot reopen a completed job.
elements.hoRunList.events.click({ target: { closest: sel => sel === '[data-hrl-open]' ? { dataset: { hrlOpen: 'done' } } : null } });
assert.equal(opened.length, 0);
listeners.enrollLive({ tag: 'done', state: 'run', at: now, started: 10000, n: 4 });
sb.hoRuns.list(); assert(!elements.hoRunList.innerHTML.includes('Open live window'), 'late progress cannot reactivate finished history');
assert.equal(writes.length, 0);

const live = { tag: 'live', no: 4, kind: 'neorcha', state: 'run', started: 150000, at: now, n: 1, prog: 0, note: '' };
listeners.cloudRuns({ ...runs, live }); sb.hoRuns.list(); html = elements.hoRunList.innerHTML;
assert.match(html, /Active runs/);
assert.equal((html.match(/Open live window/g) || []).length, 1, 'only the current active run gets a live action');
assert(html.indexOf('Active runs') < html.indexOf('Run history · ended'));
assert.match(elements.hoRunDock.innerHTML, /data-hrd-open="live"/);
const dock = elements.hoRunDock, clock = { dataset: { hrdTime: 'live' }, textContent: '' };
dock.querySelectorAll = () => [clock];
const renders = dock.htmlWrites;
now += 1000; intervalTick(); const firstTime = clock.textContent;
now += 1000; intervalTick();
assert.notEqual(clock.textContent, firstTime, 'elapsed time must still advance');
assert.equal(dock.htmlWrites, renders, 'clock ticks must not rebuild cards or their close buttons');
listeners.neorchaLive({ ...live, at: now });
assert.equal(dock.htmlWrites, renders, 'heartbeat-only updates must preserve the same card');
elements.hoRunList.events.click({ target: { closest: sel => sel === '[data-hrl-open]' ? { dataset: { hrlOpen: 'live' } } : null } });
assert.deepEqual(opened, ['neorcha']);
listeners.neorchaLive({ tag: 'live', state: 'done', started: 150000, at: now + 1000, n: 10 });
sb.hoRuns.list();
assert(!elements.hoRunList.innerHTML.includes('Open live window'), 'a newly completed run immediately becomes history');
assert(!elements.hoRunDock.innerHTML.includes('data-hrd-open='));
console.log('Run history checks passed: terminal states, live controls, in-place timers and stable heartbeat rendering.');

'use strict';
// Regression for the reported ADF Departures grid. All row values are synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..');
const R = require(path.join(ROOT, 'tools/hotelops-opera.console.js'));
const parts = ['OPERA Cloud', 'Departures', 'Search', '/ACCOREN/operacloud/faces/opera-cloud-index/OperaCloud'];
R.setTaught({ s: { 'OPERA Cloud': 'other', Departures: 'other' } });
assert.equal(R.pageKind(parts, []), 'departures', 'explicit Departures heading must beat an old learned other mapping');
for (const [title, kind] of [['Arrivals', 'arrivals'], ['In House', 'inhouse'], ['Queue', 'queue']]) {
  assert.equal(R.pageKind(['OPERA Cloud', title, 'Search'], []), kind);
}
R.setTaught({ s: { 'OPERA Cloud': 'other', 'Front Desk Workspace': 'inhouse' } });
assert.equal(R.pageKind(['OPERA Cloud', 'Front Desk Workspace'], []), 'inhouse', 'specific custom teaching still works');
assert.equal(R.pageKind(['OPERA Cloud'], [{ room: '0102', status: 'due_out' }]), 'departures', 'shared Opera title must not override actual reservation status');
R.setTaught({ s: { 'OPERA Cloud': 'other', Departures: 'other' } });
const heads = ['Show Detail', 'Display Color', 'Select All', 'I Want To...', 'Confirmation Number', 'Room', 'Nights', 'Name', 'Room Type', 'Arrival', 'Departure', 'Travel Agent', 'Balance', 'Rate', 'Rate Code', 'Adults'];
const raw = [
  ['', '', '', '12 I Want To…', '700000001', '0102', '8', 'SYNTHETIC, ALPHA', 'TWC', '29-10-2026', '06-11-2026', '', '1,234.00 AED', '150.00 AED', 'TEST', '1'],
  ['', '', '', '12 I Want To…', '700000002', '0416', '8', 'SYNTHETIC, BETA', 'SGC', '29-10-2026', '06-11-2026', '', '200.00 AED', '150.00 AED', 'TEST', '1'],
  ['', '', '', '16 I Want To…', '700000003', '0521', '2', 'SYNTHETIC, GAMMA', 'SGC', '04-11-2026', '06-11-2026', '', '0.00 AED', '150.00 AED', 'TEST', '1'],
];
const mapped = R.mapHeaders(heads);
const rows = R.finishRows(raw.map(row => R.rowFrom(row, mapped.map)), 'mdy');
assert.equal(rows.length, 3); assert(rows.every(r => r.departure === '2026-11-06'));
assert.equal(rows[0].room, '0102'); assert.equal(rows[0].balance, 1234);
const sb = { console, URL }; sb.globalThis = sb; vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'opera-bridge.js'), 'utf8'), sb);
const O = sb.hoOperaPure;
const snap = O.sanitize({ kind: R.pageKind(parts, rows), date: '2026-11-06', rows });
const inp = { snap, today: '2026-11-06', board: { rooms: [], day: '' }, arr: [], pur: [], ih: null };
const plan = O.plan(inp);
assert.equal(plan.dep.create.length, 3, 'recognized Opera list must initialize today\'s departure board');
inp.board = { day: '2026-11-06', rooms: [{ roomStr: '0102', name: 'ALPHA SYNTHETIC', status: 'due', balance: 0 }] };
const update = O.plan(inp);
assert(update.dep.fill.some(x => x.room === '0102' && x.set.balance === 1234), 'changed Opera balance updates an existing board');
assert.equal(update.dep.add.length, 2, 'new departures are added to an existing board');
R.setTaught(null);
console.log('Opera Departures checks passed: reported headings, stale teaching, grid parsing, board creation and updates.');

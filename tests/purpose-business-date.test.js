'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'purpose-business-date.js'), 'utf8');
const R = require(path.join(ROOT, 'tools/hotelops-opera.console.js'));
const bridgeContext = { console, URL }; bridgeContext.globalThis = bridgeContext; vm.createContext(bridgeContext);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'opera-bridge.js'), 'utf8'), bridgeContext);
const O = bridgeContext.hoOperaPure;
const plain = v => JSON.parse(JSON.stringify(v));

function sandbox({ at = '2026-11-13T19:50:00Z', storage = new Map(), role = 'owner' } = {}) {
  const clock = { now: Date.parse(at) }, writes = [], events = [];
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [clock.now])); } static now() { return clock.now; } }
  const sb = { Date: ClockDate, Intl, Map, Set, Promise, console, HOTEL_ID: 'ibis', currentProfile: role ? { role } : null,
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    CustomEvent: class { constructor(type, value) { this.type = type; this.detail = value.detail; } },
    dispatchEvent: e => events.push(plain(e.detail)), savePurposeBusinessDate: (date, meta) => writes.push({ date, meta: plain(meta) }) };
  sb.window = sb; vm.createContext(sb); vm.runInContext(source, sb);
  return { sb, clock, storage, writes, events, api: sb.PurposeBusinessDate };
}

test('first-day fallback uses Dubai and remains fixed after midnight, edits and reload', () => {
  const x = sandbox(); assert.equal(x.api.resolve(), '2026-11-13');
  x.clock.now = Date.parse('2026-11-14T01:00:00Z');
  assert.equal(x.api.resolve(), '2026-11-13');
  const restored = sandbox({ at: '2026-11-15T01:00:00Z', storage: x.storage });
  assert.equal(restored.api.resolve(), '2026-11-13');
  assert.equal(sandbox({ at: '2026-11-12T21:00:00Z' }).api.resolve(), '2026-11-13', 'Dubai is already Friday while UTC is Thursday');
});

test('Opera outranks the calendar fallback, advances on actual rollover, and rejects stale reads', () => {
  const x = sandbox({ at: '2026-11-14T01:00:00Z' });
  assert.equal(x.api.resolve(), '2026-11-14');
  assert.equal(x.api.observe('2026-11-13', { source: 'opera' }), true);
  assert.equal(x.api.resolve(), '2026-11-13'); assert.equal(x.writes.length, 1);
  assert.equal(x.api.observe('2026-11-13', { source: 'opera' }), false);
  x.clock.now += 60000;
  assert.equal(x.api.observe('2026-11-14', { source: 'opera' }), true);
  assert.equal(x.api.resolve(), '2026-11-14'); assert.equal(x.writes.length, 2);
  assert.equal(x.api.observe('2026-11-13', { source: 'opera', at: x.clock.now + 1 }), false);
  assert.equal(x.api.observe('2026-11-15', { source: 'opera', at: x.clock.now - 1 }), false);
  assert.equal(x.writes.length, 2);
});

test('saved purpose date migrates without a wall-clock overwrite or stale Firebase rollback', () => {
  const x = sandbox({ at: '2026-11-14T01:00:00Z' });
  x.api.restore({ date: '2026-11-13', updatedAt: '2026-11-13T12:00:00Z' });
  assert.equal(x.api.resolve(), '2026-11-13'); assert.equal(x.writes.length, 0);
  x.api.observe('2026-11-14', { source: 'opera' });
  x.api.restore({ date: '2026-11-12', updatedAt: '2026-11-14T02:00:00Z' });
  assert.equal(x.api.resolve(), '2026-11-14', 'legacy dates cannot undo explicitly observed Opera state');
  x.api.restore({ businessDate: '2026-11-13', businessDateSource: 'opera', businessDateAt: x.clock.now - 10000 });
  assert.equal(x.api.resolve(), '2026-11-14');
});

test('namespaces and restored date metadata cannot leak between hotels', () => {
  const x = sandbox(); x.api.observe('2026-11-12', { source: 'opera' });
  x.sb.HOTEL_ID = 'mercure'; assert.equal(x.api.resolve(), '2026-11-13');
  x.api.observe('2026-11-14', { source: 'opera' });
  x.sb.HOTEL_ID = 'ibis'; assert.equal(x.api.resolve(), '2026-11-12');
  x.api.restore({ businessDate: '2026-11-15', businessDateSource: 'opera', businessDateAt: x.clock.now + 1000, businessDateHotelId: 'mercure' });
  assert.equal(x.api.resolve(), '2026-11-12');
  assert.equal(x.storage.size, 2);
});

test('manual overrides are explicit; readonly users never persist date changes', () => {
  const x = sandbox(); x.api.observe('2026-11-14', { source: 'opera' });
  assert.equal(x.api.observe('2026-11-10', { source: 'manual' }), true);
  assert.equal(x.api.resolve(), '2026-11-10');
  const ro = sandbox({ role: 'readonly' });
  assert.equal(ro.api.observe('2026-11-12', { source: 'manual' }), false);
  assert.equal(ro.api.observe('2026-11-14', { source: 'opera' }), true);
  assert.equal(ro.api.resolve(), '2026-11-14'); assert.equal(ro.writes.length, 0);
  const anonymous = sandbox({ role: null }); anonymous.api.observe('2026-11-14', { source: 'opera' });
  assert.equal(anonymous.writes.length, 0);
});

test('impossible or malformed dates never become a report day', () => {
  const x = sandbox(); const before = x.api.resolve();
  for (const date of ['2026-02-30', '2026-13-01', '2026-11-00', '13-Nov-2026', '', null, '2026-1-1']) {
    assert.equal(x.api.validISO(date), false); assert.equal(x.api.observe(date, { source: 'opera' }), false);
  }
  assert.equal(x.api.validISO('2028-02-29'), true);
  assert.equal(x.api.resolve(), before); assert.equal(x.writes.length, 0);
});

test('saving guest edits and date-only observations preserve business date and existing guests', async () => {
  const x = sandbox(); x.api.restore({ businessDate: '2026-11-13', businessDateSource: 'opera', businessDateAt: x.clock.now });
  x.clock.now = Date.parse('2026-11-14T01:00:00Z');
  const db = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
  const block = db.slice(db.indexOf('async function savePurpose(guests)'), db.indexOf('async function saveShifts('));
  const sets = [], patches = []; x.sb.fbSet = (key, value) => sets.push({ key, value: plain(value) }); x.sb.fbUpdate = (key, value) => patches.push({ key, value: plain(value) });
  vm.runInContext(block, x.sb); x.sb.testGuests = [{ room: '101', name: 'Synthetic Guest' }];
  await vm.runInContext('savePurpose(testGuests)', x.sb);
  assert.equal(sets[0].value.date, '2026-11-13'); assert.equal(sets[0].value.businessDate, '2026-11-13');
  assert.equal(sets[0].value.businessDateSource, 'opera'); assert.deepEqual(sets[0].value.guests, plain(x.sb.testGuests));
  x.api.observe('2026-11-14', { source: 'opera' });
  assert.equal(patches[0].value.businessDate, '2026-11-14'); assert(!('guests' in patches[0].value), 'rollover is a metadata patch, never a guest-list replacement');
  x.sb.currentProfile = { role: 'readonly' }; await vm.runInContext("savePurposeBusinessDate('2026-11-15', {hotelId:'ibis',source:'opera',at:Date.now()})", x.sb);
  assert.equal(patches.length, 1);
});

test('reader operating date parser excludes ordinary screen dates and rejects impossible dates', () => {
  assert.equal(R.businessDateFromText('Business Date: 13-Nov-2026'), '2026-11-13');
  assert.equal(R.businessDateFromText('BusinessDate13-Nov-2026'), '2026-11-13');
  assert.equal(R.businessDateFromText('Arrival from 15-Nov-2026'), '');
  assert.equal(R.businessDateFromText('Departures Friday, 13 Nov 2026'), '');
  assert.equal(R.businessDateFromText('Business Date 31-Feb-2026'), '');
  assert.equal(R.businessDateFromText('Arrival 20-Nov-2026 | Business Date 13-Nov-2026'), '2026-11-13');
  assert.equal(O.sanitize({ kind: 'other', rows: [], businessDate: '2026-11-13' }).businessDate, '2026-11-13');
  assert.equal(O.sanitize({ kind: 'other', rows: [], businessDate: '2026-02-30' }).businessDate, undefined);
});

test('reader date DOM accepts labelled readonly authority and ignores editable filters or data-grid dates', () => {
  const text = fs.readFileSync(path.join(ROOT, 'tools/hotelops-opera.console.js'), 'utf8');
  const block = text.slice(text.indexOf('  function businessDate(doc, order)'), text.indexOf('  // Never in Opera\'s way:'));
  const read = new Function('txt', 'mine', 'inData', 'businessDateFromText', block + ';return businessDate;')(e => e.text || '', e => !!e.mine, e => !!e.data, R.businessDateFromText);
  const node = (tagName, text, attr = {}) => ({ tagName, text, getAttribute: key => attr[key] || '', ...attr });
  const input = node('INPUT', '', { value: '13-Nov-2026', readOnly: true });
  const label = node('LABEL', 'Business Date', { for: 'bd' });
  const doc = { querySelectorAll: () => [label], getElementById: () => input };
  assert.equal(read(doc), '2026-11-13');
  input.readOnly = false; assert.equal(read(doc), '', 'editable report/search business-date filter is not the operating day');
  input.readOnly = true; label.data = true; assert.equal(read(doc), '', 'a row value is not the operating date');
  const mixed = node('SPAN', 'Business Date'); mixed.parentElement = node('DIV', 'Arrival 20-Nov-2026 Business Date 13-Nov-2026');
  assert.equal(read({ querySelectorAll: () => [mixed] }), '2026-11-13');
});

test('accepted explicit Opera business date is observed before duplicate handling; other property and screen dates are ignored', () => {
  const text = fs.readFileSync(path.join(ROOT, 'opera-bridge.js'), 'utf8');
  const start = text.indexOf('function receive(raw, h, reply)');
  const block = text.slice(start, text.indexOf('// ══ Opera\'s Departures vs the board', start));
  const observations = [], last = { other: { h: 'same' } }, seen = new Map([['same', 'up to date']]);
  const deps = { sanitize: O.sanitize, propCheck: prop => prop === 'OTHER1' ? 'another hotel' : '', safe: fn => fn(), stuckApp: () => {},
    W: { PurposeBusinessDate: { observe: (...args) => observations.push(args) } }, rememberHome: () => {}, hashOf: () => 'same', SEEN: seen, WAITING: 'waiting', LAST: last,
    saveLast: () => {}, remember: () => {}, paintDepChips: () => {}, handle: () => 'up to date', reconAutoRun: () => {}, paint: () => {} };
  const receive = new Function(...Object.keys(deps), block + ';return receive;')(...Object.values(deps));
  const base = { kind: 'other', rows: [], prop: 'IBIS1', businessDate: '2026-11-13' };
  receive(base, 'same'); assert.equal(observations.length, 1, 'unchanged guest rows must not suppress a business-date rollover');
  receive({ ...base, prop: 'OTHER1', businessDate: '2026-11-14' }, 'same'); assert.equal(observations.length, 1);
  receive({ kind: 'other', rows: [], date: '2026-11-15', prop: 'IBIS1' }, 'same'); assert.equal(observations.length, 1);
});

test('Purpose rows use its operating day after midnight while Arrivals and Departures retain their own day', () => {
  const input = { today: '2026-11-14', purposeDate: '2026-11-13', board: { rooms: [], day: '2026-11-14' }, arr: [], pur: [], ih: null,
    snap: { kind: 'arrivals', date: '2026-11-13', rows: [
      { room: '101', conf: '12345678', name: 'Prior Business Guest', arrival: '2026-11-13', departure: '2026-11-15', status: 'in_house' },
      { room: '102', conf: '12345679', name: 'Next Calendar Guest', arrival: '2026-11-14', departure: '2026-11-15', status: 'due_in' }
    ] } };
  const beforeRollover = O.plan(input);
  assert.deepEqual(plain(beforeRollover.pur.add.map(g => g.room)), ['101']);
  assert.deepEqual(plain(beforeRollover.arr.add.map(g => g.room)), ['102']);
  const afterRollover = O.plan({ ...input, purposeDate: '2026-11-14' });
  assert.deepEqual(plain(afterRollover.pur.add.map(g => g.room)), ['102']);
  assert.deepEqual(plain(afterRollover.arr.add.map(g => g.room)), ['102']);
  const unspecifiedArrival = { ...input, snap: { kind: 'arrivals', date: '2026-11-14', rows: [{ room: '103', name: 'Filtered Future Guest' }] } };
  assert.equal(O.plan(unspecifiedArrival).pur.add.length, 0, 'future arrivals filter must not feed the previous operating-day purpose report');
  const compatible = O.plan({ ...input, purposeDate: undefined });
  assert.deepEqual(plain(compatible.pur.add.map(g => g.room)), ['102'], 'older bridge callers keep existing calendar-day behavior');
});

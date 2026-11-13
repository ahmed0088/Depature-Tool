'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const R = require('../purpose-referral.js');
const copy = value => JSON.parse(JSON.stringify(value));
const seeded = (seed = 27) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const walkins = n => Array.from({ length: n }, (_, i) => ({ conf: String(1000 + i), source: 'Walk-in', howHeard: '' }));

test('referral headers are exact after punctuation/case/space normalization', () => {
  for (const h of ['How you hear about us', 'HOW DID YOU HEAR ABOUT US?', 'How did you know about us', 'How did you find us', 'How\ndid you find out about us', 'Referral source']) {
    assert.equal(R.headerIndex(['Booking Source', h, 'Source country']), 1);
  }
  assert.equal(R.headerIndex(['Source', 'Booking source', 'How many guests', 'How did you hear about us count']), -1);
  assert.equal(R.headerIndex(null), -1);
});
test('Excel cells and missing row values are handled safely', () => {
  assert.equal(R.headerIndex([{ v: 'Room' }, { v: 'How you hear about us' }]), 1);
  assert.equal(R.read(['101', { v: '  Friend referral  ' }], ['Room', 'How did you know about us']), 'Friend referral');
  assert.equal(R.read([], ['How you hear about us']), '');
  assert.equal(R.read(null, ['How you hear about us']), '');
  assert.equal(R.text({ unexpected: 'Not a cell value' }), '');
});
test('walk-ins receive an exact rounded online search split', () => {
  const rows = walkins(10), result = R.fill(rows, { random: seeded() });
  assert.equal(result.filled, 10); assert.equal(result.walkin.online, 8);
  assert.equal(rows.filter(g => g.howHeard === 'Online search').length, 8);
  assert(rows.every(g => R.options.includes(g.howHeard) && g._howHeardGenerated));
  assert.equal(result.bySource.walkin, 10); assert.equal(result.remaining, 0);
  assert.equal(R.fill(walkins(3), { random: seeded() }).walkin.online, 2);
});
test('percentage limits produce all or no online walk-ins and reject invalid settings before mutation', () => {
  assert.equal(R.fill(walkins(4), { walkinOnlinePercent: 0, random: () => 0 }).online, 0);
  assert.equal(R.fill(walkins(4), { walkinOnlinePercent: 100, random: () => 1 }).online, 4);
  for (const percent of [-1, 101, NaN, Infinity, 'bad']) {
    const rows = walkins(2), before = copy(rows);
    assert.throws(() => R.fill(rows, { walkinOnlinePercent: percent }), /percentage/);
    assert.deepEqual(rows, before);
  }
});
test('blank-only filling preserves entered answers and purpose/booking data', () => {
  const rows = [{ source: 'Walk-in', purpose: 'Business', howHeard: 'Billboard', room: '101' }, { source: 'Walk-in', purpose: 'Flight', howHeard: ' ' }];
  const result = R.fill(rows, { random: seeded() });
  assert.equal(result.filled, 1); assert.equal(result.preserved, 1);
  assert.deepEqual(rows[0], { source: 'Walk-in', purpose: 'Business', howHeard: 'Billboard', room: '101' });
  assert.equal(rows[1].purpose, 'Flight'); assert.equal(rows[1].source, 'Walk-in');
});
test('saved generated suggestions remain stable until an explicit regenerate', () => {
  const rows = walkins(10); R.fill(rows, { random: seeded() }); const before = copy(rows);
  const result = R.fill(rows, { random: () => { throw Error('Must not randomize a saved answer'); } });
  assert.equal(result.filled, 0); assert.deepEqual(rows, before);
  const next = R.fill(rows, { regenerate: true, walkinOnlinePercent: 0, random: seeded() });
  assert.equal(next.regenerated, 10); assert.equal(next.online, 0);
});
test('regenerate never overwrites real answers or a hand-edited generated suggestion', () => {
  const rows = walkins(3); R.fill(rows, { random: seeded() });
  rows[0].howHeard = 'Guest confirmed a brochure'; rows[0]._howHeardGenerated = false;
  rows[1].howHeard = 'Guest typed another answer'; // old clients may leave the flag behind
  const before = rows.map(g => g.howHeard), result = R.fill(rows, { regenerate: true, walkinOnlinePercent: 0, random: seeded() });
  assert.equal(rows[0].howHeard, before[0]); assert.equal(rows[1].howHeard, before[1]);
  assert.equal(result.regenerated, 1); assert.equal(result.preserved, 2);
});
test('OTA, ALL app and corporate sources get corresponding suggestions; blank is not walk-in', () => {
  const rows = [{ source: 'Booking.com' }, { source: 'Agoda' }, { source: 'ALL App' }, { source: 'Accor' }, { source: 'Corporate company' }, { source: '' }, { source: 'Walk outside' }];
  const result = R.fill(rows, { random: () => .95 });
  assert.deepEqual(rows.map(g => g.howHeard), ['Booking website', 'Booking website', 'ALL app', 'ALL app', 'Company', 'Previous stay', 'Previous stay']);
  assert.equal(result.bySource.walkin, 0); assert.equal(result.bySource.ota, 2);
  assert.equal(R.sourceOf({ source: 'Walk-in' }), 'walkin'); assert.equal(R.sourceOf({ source: 'walkin' }), 'walkin');
});
test('shared application source classification takes priority and unrecognized buckets fall back', () => {
  const sandbox = { sourceCategory: source => source === 'my direct label' ? 'allapp' : 'unknown', Math, console };
  sandbox.window = sandbox; vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('../purpose-referral.js'), 'utf8'), sandbox);
  assert.equal(sandbox.PurposeReferral.sourceOf({ source: 'my direct label' }), 'allapp');
  assert.equal(sandbox.PurposeReferral.sourceOf({ source: 'Walk-in' }), 'walkin');
});
test('bad random output is atomic and option bounds do not create undefined values', () => {
  const rows = walkins(10), before = copy(rows); let calls = 0;
  assert.throws(() => R.fill(rows, { random: () => ++calls > 2 ? NaN : .5 }), /invalid value/);
  assert.deepEqual(rows, before);
  R.fill(rows, { random: () => 1, walkinOnlinePercent: 0 }); assert(rows.every(g => R.options.includes(g.howHeard)));
  assert.throws(() => R.fill({}, {}), /guest list/); assert.throws(() => R.fill([], { random: null }), /random number/);
});
test('empty lists and invalid entries produce no fabricated guest records', () => {
  assert.equal(R.fill([]).total, 0);
  const rows = [null, 'guest', [], { source: 'Walk-in', howHeard: 'Guest answer' }], before = copy(rows);
  assert.equal(R.fill(rows).filled, 0); assert.deepEqual(rows, before);
});

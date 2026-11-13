'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const plain = value => JSON.parse(JSON.stringify(value));
const binding = extra => ({ portalUrl: 'https://app.fpg-ingauge.com/', tenantId: '1', propertyId: '2', departmentId: '3', property: 'Example Hotel', department: 'Front Desk', ...extra });

function fixture() {
  const values = new Map(), writes = [];
  const sb = {
    console, JSON, Date, Map, Set, String, Object, Array, URL,
    HOTEL_ID: 'private-example', uid: 'owner-one',
    document: { readyState: 'loading', addEventListener() {}, getElementById: () => null, querySelector: () => null },
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { writes.push([key, value]); values.set(key, value); }, removeItem: key => values.delete(key) },
    addEventListener() {}, setTimeout: () => 0, clearTimeout() {},
    _ref: { child() { throw Error('Preferences must never write financial storage'); } },
  };
  sb.firebase = { auth: () => ({ currentUser: { uid: sb.uid } }) };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'ingauge-settings.js'), 'utf8'), sb);
  return { sb, api: sb.InGaugeSettings, values, writes, state: { binding: binding() } };
}

test('settings start with enabled features, ordinary layout and monthly landing', () => {
  const { api, state } = fixture(), prefs = plain(api.get(state));
  assert.deepEqual(prefs, plain(api.DEFAULTS));
  assert.equal(prefs.compact, false); assert.equal(prefs.landing, 'monthly');
  for (const key of ['monthly', 'manual', 'automatic', 'find', 'automation', 'add', 'edit', 'approve', 'deny', 'remove', 'graphs', 'breakdown', 'history', 'hints', 'autoOpenRun']) assert.equal(prefs[key], true, key);
});

test('preferences persist by complete target identity, account and private namespace', () => {
  const { sb, api, state } = fixture(), original = api.key(state);
  api.set(state, { graphs: false, compact: true, remove: false });
  assert.equal(api.get(state).graphs, false); assert.equal(api.get(state).compact, true);
  for (const change of [{ propertyId: '22' }, { departmentId: '33' }, { tenantId: '11' }, { portalUrl: 'https://other.fpg-ingauge.com/' }]) {
    const other = { binding: binding(change) };
    assert.notEqual(api.key(other), original, JSON.stringify(change));
    assert.equal(api.get(other).graphs, true, 'another target cannot inherit disabled graphs');
  }
  sb.uid = 'owner-two'; assert.notEqual(api.key(state), original); assert.equal(api.get(state).compact, false);
  sb.uid = 'owner-one'; sb.HOTEL_ID = 'private-other'; assert.notEqual(api.key(state), original); assert.equal(api.get(state).remove, true);
  sb.HOTEL_ID = 'private-example'; assert.equal(api.key(state), original); assert.equal(api.get(state).remove, false);
});

test('hotel display names do not change a target preference identity', () => {
  const { api, state } = fixture();
  api.set(state, { hints: false });
  const renamed = { binding: binding({ property: 'Renamed Hotel', department: 'Renamed Desk' }) };
  assert.equal(api.key(renamed), api.key(state)); assert.equal(api.get(renamed).hints, false);
});

test('malformed storage and nonboolean values fall back without disabling audit modes', () => {
  const { api, state, values } = fixture(), key = api.key(state);
  for (const raw of ['{bad', 'null', '[]', '"false"']) {
    values.set(key, raw); const prefs = api.get(state);
    assert.equal(prefs.graphs, true); assert.equal(prefs.manual || prefs.automatic, true);
  }
  values.set(key, JSON.stringify({ schema: 1, prefs: { graphs: 'false', compact: 1, manual: false, automatic: false, landing: 'unknown', unsafeBypassReview: true } }));
  const prefs = api.get(state);
  assert.equal(prefs.graphs, true); assert.equal(prefs.compact, false); assert.equal(prefs.manual || prefs.automatic, true);
  assert(['monthly', 'audit', 'edit'].includes(prefs.landing)); assert.equal('unsafeBypassReview' in prefs, false);
});

test('invalid patches and blocked device storage fail without pretending to save', () => {
  const { sb, api, state } = fixture();
  for (const patch of [{ graphs: 'false' }, { compact: 1 }, { landing: 'unknown' }, { unsafeBypassReview: true }, { manual: false, automatic: false }]) assert.throws(() => api.set(state, patch));
  assert.deepEqual(plain(api.get(state)), plain(api.DEFAULTS));
  sb.localStorage.setItem = () => { throw Error('Blocked storage'); };
  assert.throws(() => api.set(state, { graphs: false }), /saved|storage/i);
  assert.equal(api.get(state).graphs, true);
});

test('landing adapts to enabled tools and setting patches retain unrelated choices', () => {
  const { api, state } = fixture();
  api.set(state, { hints: false, landing: 'edit' });
  api.set(state, { find: false, monthly: false });
  assert.equal(api.get(state).landing, 'audit'); assert.equal(api.get(state).hints, false);
  assert.equal(api.get(state).automation, true); assert.equal(api.get(state).manual || api.get(state).automatic, true);
});

test('reset restores only personal preferences and leaves other hotels intact', () => {
  const { api, state, writes } = fixture(), other = { binding: binding({ propertyId: '22' }) };
  api.set(state, { automation: false, compact: true }); api.set(other, { graphs: false });
  api.reset(state);
  assert.deepEqual(plain(api.get(state)), plain(api.DEFAULTS)); assert.equal(api.get(other).graphs, false);
  assert(writes.length >= 2); assert(writes.every(([key]) => typeof key === 'string'));
});

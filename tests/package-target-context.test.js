'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const plain = value => JSON.parse(JSON.stringify(value));
const HEADERS = ['ID', 'Product', 'Product ID', 'Employee', 'Employee ID', 'Confirmation no', 'Room No', 'Product Charge', 'Charge Days', 'Arrival Date', 'Departure Date', 'Daily Date( Other Data )', 'Daily Date', 'Status', 'Currency', 'Tenant Location', 'Manually Added Record', 'Created By'];
const table = (values = {}) => [HEADERS, ['100', 'Late Check Out', '4', 'Bob Editor', '2', '12345678', '101', '100', '1', '01-Nov-2026', '03-Nov-2026', '01-Nov-2026', '01-Nov-2026', 'APPROVED', 'AED', 'Mercure Example', 'No', 'Bob Editor'].map((v, i) => HEADERS[i] in values ? values[HEADERS[i]] : v)];
const event = (values = {}) => ({ action: 'ADDED', code: 'USS100LC', ts: 202611011200, user: 'Alice Original', price: '100', from: '01-Nov-2026', to: '03-Nov-2026', ...values });
const input = (extra = {}) => ({ rows: table(), events: { '12345678': [event()] }, ...extra });

function sandbox() {
  const writes = [], noop = () => {};
  const sb = {
    console, Date, JSON, Math, Uint8Array, setTimeout: () => 0, clearTimeout: noop, setInterval: () => 0,
    localStorage: { getItem: () => null, setItem: (...args) => writes.push(['local', ...args]), removeItem: (...args) => writes.push(['remove', ...args]) },
    document: { getElementById: id => id === 'hotelName' ? { textContent: 'Ibis Host Space' } : null, querySelector: () => null, querySelectorAll: () => [], addEventListener: noop, readyState: 'loading' },
    addEventListener: noop, navigator: { onLine: true },
    fbSet: (...args) => writes.push(['set', ...args]), fbUpdate: (...args) => writes.push(['update', ...args]),
    saveHistory: (...args) => writes.push(['history', ...args]), logActivity: (...args) => writes.push(['activity', ...args]),
    InGaugeWorkspace: { state: { snapshot: { contributors: [{ id: '1', name: 'Alice Original' }, { id: '2', name: 'Bob Editor' }] } } },
    writes,
  };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  for (const name of ['ingauge-audit-core.js', 'package-audit.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'), sb);
  writes.length = 0;
  return sb;
}
function compute(sb, args) { sb.targetInput = args; return plain(vm.runInContext('pkgComputeForTarget(targetInput)', sb)); }
const STATE_NAMES = ['pkgUnknowns', 'pkgDeleted', 'pkgEvents', 'pkgResults', 'pkgPdfFiles', 'pkgLogRange', 'pkgGuests', 'pkgRules', 'pkgPins', 'pkgDone', 'pkgStaffDb', 'pkgMemory', 'pkgLearned', 'pkgSettingsRaw', 'pkgSettings', 'pkgLastHeaders', '_pkgLastRows', '_pkgNamesCache', '_pkgKeyCache', '_pkgTargetSnapshotOverride', 'PKG_STAFF', 'PKG_STAFF_ALIASES', 'PKG_STAFF_FORMER', 'PKG_STAFF_LEFT'];
function seedHost(sb) {
  vm.runInContext(`
    pkgUnknowns = [{ conf: 'HOST', employee: 'Host Employee' }]; pkgDeleted = { HOST: [{ code: 'HOST' }] };
    pkgEvents = { HOST: [{ user: 'Host Employee' }] }; pkgResults = [{ conf: 'HOST' }]; pkgPdfFiles = ['host.pdf'];
    pkgLogRange = { min: 20261001, max: 20261031 }; pkgGuests = { HOST: { name: 'Host Guest' } };
    pkgPins = { '12345678|Late Check Out': { seller: 'Bob Editor' } }; pkgDone = { HOST: { at: 'yesterday' } };
    pkgMemory = { '12345678': { LC: { conf: '12345678', kind: 'LC', seller: 'Bob Editor', first: '202610', last: '202610', ts: 202610011200, code: 'USS100LC', price: '100', months: { '202610': { n: 1, aed: 100 } } } } };
    pkgLearned = { host: { type: 'skip', product: 'Late Check Out' } };
    pkgStaffDb = { host: { name: 'Bob Editor', logins: ['ACCOREN-OPAQUELOGIN'], former: [{ name: 'Alice Original' }], status: 'left', left: '2026-10-31' } };
    _pkgApplyStaff(); pkgRules = Object.assign({}, PKG_RULE_DEFAULTS, { firstPerson: false, systemNoSeller: false });
    pkgSettingsRaw = { chrome: ['host custom footer'], colMap: { ig: { employee: 'Host seller column' } }, kinds: [{ k: 'HOST', label: 'Host package', codes: ['USS100LC'], ig: 'Late Check Out' }] };
    pkgSettings = _pkgMergeSettings(pkgSettingsRaw); _pkgSetKinds(pkgSettings.kinds);
    pkgLastHeaders = { host: 'headers' }; _pkgLastRows = { host: 'rows' };
    _pkgNamesCache = { src: pkgUnknowns, list: ['Host Employee'] }; _pkgKeyCache = { src: pkgResults, n: 1, map: new Map([['HOST', 'host']]) };
    pkgReportAt = 12345;
  `, sb);
  sb.stateNames = STATE_NAMES;
  vm.runInContext('hostRefs = Object.fromEntries(stateNames.map(k => [k, eval(k)])); hostKinds = PKG_KINDS.slice(); hostStateJson = JSON.stringify(hostRefs);', sb);
}
function assertHostRestored(sb) {
  assert.equal(vm.runInContext('stateNames.every(k => eval(k) === hostRefs[k])', sb), true, 'host state references must be restored');
  assert.equal(vm.runInContext('JSON.stringify(hostRefs) === hostStateJson', sb), true, 'host data must remain unchanged');
  assert.equal(vm.runInContext('PKG_KINDS.length === hostKinds.length && PKG_KINDS.every((k, i) => k === hostKinds[i]) && pkgReportAt === 12345', sb), true);
  assert.deepEqual(sb.writes, [], 'target computation must never persist host changes');
}

test('target audit uses standard rules and current live identities without host settings, aliases, memory or pins', () => {
  const sb = sandbox(), baseline = compute(sb, input());
  assert.equal(baseline.results[0].user, 'Alice Original');
  assert.equal(baseline.results[0].verdict, 'credit');
  assert.equal(baseline.results[0].reassign, true);
  seedHost(sb);
  const result = compute(sb, input());
  assert.deepEqual(result.results, baseline.results);
  assert.equal(result.memoryNext['12345678'].LC.seller, 'Alice Original');
  assert.equal(result.memoryPatch['12345678/LC'].seller, 'Alice Original');
  assert.equal(result.memoryNext['12345678'].LC.guest, '');
  assert.equal(result.memoryNext['12345678'].LC.by, '');
  assertHostRestored(sb);
});

test('only the target staff aliases can resolve an opaque Opera login', () => {
  const sb = sandbox(); seedHost(sb);
  const args = input({ events: { '12345678': [event({ user: 'ACCOREN-OPAQUELOGIN' })] } });
  const held = compute(sb, args).results[0];
  assert.equal(held.verdict, 'review'); assert.equal(held.identityReview, true);
  const resolved = compute(sb, { ...args, context: { staff: { target: { name: 'Alice Original', contributorId: '1', logins: ['ACCOREN-OPAQUELOGIN'] } } } }).results[0];
  assert.equal(resolved.verdict, 'credit'); assert.equal(resolved.identityReview, undefined);
  assert.equal(resolved.user, 'ACCOREN-OPAQUELOGIN');
  assertHostRestored(sb);
});

test('legacy computations ignore an independent target catalog while scoped computations verify against it', () => {
  const sb = sandbox();
  sb.InGaugeWorkspace.state.independent = true;
  sb.InGaugeWorkspace.state.snapshot.contributors = [{ id: '9', name: 'Mercure Contributor' }];
  sb.targetInput = input();
  const legacy = plain(vm.runInContext('pkgUnknowns = _pkgParseExcelUnknowns(targetInput.rows); pkgEvents = targetInput.events; _pkgRecomputeLogRange(); _pkgCompute()', sb));
  assert.equal(legacy[0].verdict, 'credit');
  assert.equal(legacy[0].user, 'Alice Original');
  assert.equal(legacy[0].identityReview, undefined);
  const target = compute(sb, input()).results[0];
  assert.equal(target.verdict, 'review');
  assert.equal(target.identityReview, true, 'the target catalog must still guard scoped attribution');
  assert.equal(vm.runInContext('_pkgLiveSnapshot()', sb), null, 'target override must be restored after computation');
  sb.InGaugeWorkspace.state.snapshot.contributors.push({ id: '1', name: 'Alice Original' });
  const verified = compute(sb, input()).results[0];
  assert.equal(verified.verdict, 'credit');
  assert.equal(verified.identityReview, undefined);
});

test('target pins, memory and learned decisions apply through the existing audit rules', () => {
  const sb = sandbox(); seedHost(sb);
  const pin = compute(sb, input({ context: { pins: { '12345678|Late Check Out': { seller: 'Bob Editor' } } } })).results[0];
  assert.equal(pin.user, 'Bob Editor'); assert.equal(pin.pin.seller, 'Bob Editor');
  const memory = { '12345678': { LC: { conf: '12345678', kind: 'LC', seller: 'Bob Editor', first: '202610', last: '202610', ts: 202610011200, code: 'USS100LC', price: '100', months: { '202610': { n: 1, aed: 100 } } } } };
  const carried = compute(sb, input({ context: { memory } })).results[0];
  assert.equal(carried.memoryUsed, true); assert.equal(carried.user, 'Bob Editor');
  const learned = compute(sb, input({ context: { learned: { target: { id: 'target', type: 'skip', product: 'Late Check Out' } } } })).results[0];
  assert.equal(learned.pinSkip, true); assert.equal(learned.learned.id, 'target');
  assertHostRestored(sb);
});

test('target rule overrides and custom kinds do not borrow or replace host configuration', () => {
  const sb = sandbox(); seedHost(sb);
  const args = input({ events: { '12345678': [event(), event({ ts: 202611011300, user: 'Bob Editor', price: '110' })] }, rows: table({ 'Product Charge': '110' }) });
  const standard = compute(sb, args).results[0];
  assert.equal(standard.user, 'Alice Original');
  const overridden = compute(sb, { ...args, context: { rules: { firstPerson: false } } }).results[0];
  assert.equal(overridden.user, 'Bob Editor');
  const custom = compute(sb, input({ rows: table({ Product: 'Custom lounge', 'Product Charge': '100' }), events: { '12345678': [event({ code: 'LOUNGE' })] }, context: { settings: { kinds: [{ k: 'CL', label: 'Custom lounge', codes: ['LOUNGE'], ig: 'Custom lounge' }] } } }));
  assert.equal(custom.results[0].verdict, 'credit'); assert.equal(custom.results[0].user, 'Alice Original');
  assert.equal(custom.memoryNext['12345678'].CL.seller, 'Alice Original');
  assertHostRestored(sb);
});

test('reservation text belongs to the target memory only and arguments remain unchanged', () => {
  const sb = sandbox(); seedHost(sb);
  const args = input({ reservationText: 'CONFIRMATION_NO\tFULL_NAME\tGUEST_NAME_ID\tROOM_NO\tTRUNC_BEGIN\tTRUNC_END\n12345678\tTarget Guest\tG123\t101\t01-Nov-2026\t03-Nov-2026' });
  const before = plain(args), result = compute(sb, args);
  assert.equal(result.memoryNext['12345678'].LC.guest, 'Target Guest');
  assert.equal(result.memoryNext['12345678'].LC.gid, 'G123');
  assert.deepEqual(args, before);
  assertHostRestored(sb);
});

test('parse and compute failures always restore host state, including caches and kind references', () => {
  for (const stage of ['_pkgParseExcelUnknowns', '_pkgCompute', '_pkgMemoryBuild']) {
    const sb = sandbox(); seedHost(sb); sb.stage = stage;
    vm.runInContext('originalStage = eval(stage); globalThis[stage] = () => { throw new Error("target failure"); };', sb);
    assert.throws(() => compute(sb, input()), /target failure/);
    assertHostRestored(sb);
  }
});

function pdf(items) {
  return { numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: items.map(([str, x, y]) => ({ str, transform: [1, 0, 0, 1, x, y] })) }) }), destroy: async () => {} };
}
function report(user = 'Alice Original', conf = '12345678', ts = '01-11-26') {
  return pdf([['Action Description', 360, 800], [user, 10, 700], ['12:00', 80, 700], [ts, 130, 700], [`;PRODUCT USS100LC ADDED;PRODUCT USS100LC BETWEEN 01-NOV-26 AND 03-NOV-26 : PRICE ->100;PRODUCT OLDLC DELETED;Confirmation No. ${conf}`, 360, 700], ['Mercure Example Hotel', 10, 100]]);
}
const file = name => ({ name, arrayBuffer: async () => new ArrayBuffer(1) });

test('target PDF merger uses private accumulators, deduplicates events and never writes legacy deletion data', async () => {
  const sb = sandbox(); seedHost(sb);
  sb.pdfjsLib = { getDocument: () => ({ promise: Promise.resolve(report()) }) };
  const prior = { events: { '87654321': [event({ ts: 202610301200 })] }, files: ['prior.pdf'], hotelName: 'Mercure Example Hotel' }, before = plain(prior);
  const result = plain(await sb.pkgLoadTargetPdf([file('new.pdf'), file('new.pdf')], prior));
  assert.equal(result.events['12345678'].length, 1);
  assert.equal(result.events['12345678'][0].user, 'Alice Original', 'target footer must be excluded');
  assert.deepEqual(result.files, ['prior.pdf', 'new.pdf']);
  assert.deepEqual(result.range, { min: 20261030, max: 20261101 });
  assert.deepEqual(prior, before);
  assertHostRestored(sb);
});

test('target PDF failures propagate without adding failed filenames or mutating prior/host reports', async () => {
  const sb = sandbox(); seedHost(sb);
  let count = 0;
  sb.pdfjsLib = { getDocument: () => ({ promise: ++count === 1 ? Promise.resolve(report()) : Promise.reject(new Error('corrupt report')) }) };
  const prior = { events: {}, files: [], hotelName: 'Mercure Example Hotel' };
  await assert.rejects(sb.pkgLoadTargetPdf([file('good.pdf'), file('bad.pdf')], prior), error => {
    assert.match(error.message, /bad.pdf.*corrupt report/);
    assert.deepEqual(plain(error.partial.files), ['good.pdf']);
    assert.equal(error.partial.events['12345678'].length, 1);
    return true;
  });
  assert.deepEqual(prior, { events: {}, files: [], hotelName: 'Mercure Example Hotel' });
  assertHostRestored(sb);
});

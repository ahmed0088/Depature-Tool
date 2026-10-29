#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  tests/run-tests.js — regression tests for the reconciliation logic
//
//  Runs the REAL app code (hotel-settings, dtcm-core, dtcm-recon, reports)
//  against anonymised copies of real reports and checks the answers we
//  already verified by hand. If a change breaks one of them, this fails.
//
//  Run:  node tests/run-tests.js        (exit code 1 on any failure)
//
//  Fixtures in tests/fixtures are real DTCM / Opera files with every guest
//  and staff name replaced by a made-up one (same replacement in both files,
//  so the matching behaves exactly like the original).
// ═══════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
// Every sandbox runs on a fixed clock (11 Oct 2026, noon), so tests written for the week of 12 Oct don't
// start failing once that week is in the past ("already started" shifts get no cover options).
const _vmCreate = vm.createContext;
vm.createContext = (sb, ...a) => {
  const c = _vmCreate(sb, ...a);
  vm.runInContext(`(() => { const R = Date, FIX = new R(2026, 9, 11, 12, 0, 0).getTime();
    class D extends R { constructor(...a) { if (a.length) super(...a); else super(FIX); } static now() { return FIX; } }
    globalThis.Date = D; })()`, c);
  return c;
};

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');

// ── minimal browser shims ─────────────────────────────────
class El { constructor(tag, a) { this.tag = tag; this.a = a; } getAttribute(k) { return k in this.a ? this.a[k] : null; } }
function makeSandbox(settings) {
  const store = {};
  if (settings) store.hotel_td_settings_v1 = JSON.stringify(settings);
  const sb = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    document: { readyState: 'complete', addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    setTimeout: () => 0,
    DOMParser: class {
      parseFromString(t) {
        const els = [];
        for (const m of t.matchAll(/<(\w+)((?:\s+[\w:]+="[^"]*")*)\s*\/?>/g)) {
          const a = {};
          for (const x of m[2].matchAll(/([\w:]+)="([^"]*)"/g)) a[x[1]] = x[2].replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"');
          els.push(new El(m[1], a));
        }
        return { querySelector: () => null, getElementsByTagName: () => els, querySelectorAll: s => els.filter(e => e.tag === s) };
      }
    },
  };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of ['hotel-settings.js', 'dtcm-core.js', 'dtcm-recon.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  }
  return sb;
}

function recon(name, settings) {
  const sb = makeSandbox(settings);
  const R = sb.Reconciler;
  const xml = fs.readFileSync(path.join(FIX, name + '.dtcm.xml'), 'utf8');
  const opera = fs.readFileSync(path.join(FIX, name + '.opera.txt'), 'utf8');
  const d = R.parseDTCM(xml), o = R.parseOpera(opera);
  return R.reconcile(d, o.rows, o.fileTotal);
}

// ── tiny test harness ─────────────────────────────────────
let pass = 0, fail = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '\n      expected ' + e + '\n      got      ' + a); }
}
const rooms = rc => rc.fixPlan.map(p => p.room);
const kinds = rc => rc.fixPlan.map(p => p.room + ':' + p.kind);

// ── 1. DTCM Recon — 1-4 Oct (first files) ─────────────────
console.log('\nDTCM Recon · 1-4 Oct (original files)');
{
  const rc = recon('oct1-4');
  check('DTCM XML total', rc.gap.rawDtcm, 4870);
  check('Opera total', rc.gap.rawOpera, 4810);
  check('DTCM compared with Opera', rc.gap.adjDtcm, 4790);
  check('gap fully explained (leftover 0)', rc.gap.leftover, 0);
  check('extra nights from early / late ticks', rc.gap.dtcmExtra, 60);
  check('rooms with an early / late tick', rc.gap.dtcmExtraRooms.slice().sort(), ['204', '226', '313', '423', '506', '514']);
  check('10 items, in plan order', rooms(rc), ['524', '201', '226', '423', '514', '204', '313', '506', '217', '108']);
  check('item kinds', kinds(rc), ['524:room_chain_short', '201:day_use_repost', '226:early_tick', '423:early_tick', '514:early_tick',
    '204:early_tick', '313:late_tick', '506:early_tick', '217:dtcm_day_use', '108:dtcm_day_use']);
  check('room 201 is NOT reported as a duplicate', rc.duplicates.length, 0);
  check('217 and 108 are check-ins made by mistake', rc.fixPlan.filter(p => p.kind === 'dtcm_day_use').map(p => !!(p.extra && p.extra.detail && p.extra.detail.mistake)), [true, true]);
  check('month-end tally equal at 4830', [rc.gap.monthEnd.dtcm, rc.gap.monthEnd.opera, rc.gap.monthEnd.equal], [4830, 4830, true]);
  check('room-move night 606 is not a posting to add', rc.missing.filter(m => m.room === '606' && !m.pairedMove).length, 0);
}

// ── 2. DTCM Recon — 1-4 Oct after the user's DTCM fixes ───
console.log('\nDTCM Recon · 1-4 Oct (after fixes: 423 and 313 corrected)');
{
  const rc = recon('oct1-4-fixed');
  check('DTCM XML total', rc.gap.rawDtcm, 4850);
  check('gap fully explained (leftover 0)', rc.gap.leftover, 0);
  check('8 items', rooms(rc), ['524', '201', '226', '514', '204', '506', '217', '108']);
  check('423 becomes a "total right, dates wrong" note', rc.checks.some(c => c.type === 'Total right, DTCM dates wrong' && c.room === '423'), true);
  check('month-end tally equal at 4810', [rc.gap.monthEnd.dtcm, rc.gap.monthEnd.opera, rc.gap.monthEnd.equal], [4810, 4810, true]);
}

// ── 3. Hotel settings: another code, another rate ────────
console.log('\nDTCM Recon · month-to-date report (made-up guests)');
{
  const sb = makeSandbox(), R = sb.Reconciler, C = sb.DtcmCore;
  const days = Array.from({ length: 13 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
  const seg = (room, ci, co, n, extra) => Object.assign({ room, roomRaw: room, guest: 'Guest ' + room, guestNorm: 'guest ' + room, storedNights: n, storedTdFees: n * 10,
    checkIn: new Date(ci + 'T00:00:00Z'), checkOut: co ? new Date(co + 'T00:00:00Z') : null, checkInISO: ci, checkOutISO: co, checkInTime: '02:00 PM', checkOutTime: co ? '11:00 AM' : '',
    status: co ? 'Checked Out' : 'Checked In', bedrooms: 1, houseUse: false, earlyCheckin: false, lateCheckout: false }, extra);
  const post = (room, d, amt) => ({ code: '7510', desc: 'Tourism Dirham', room, guest: 'Guest ' + room, guestNorm: 'guest ' + room, businessDate: d, amount: amt, debit: amt, credit: 0,
    kind: 'nightly', isRoomMove: false, isPackage: false, isAdjustment: false, isReversal: false, remark: '', ref: '', trxNo: room + d, time: '23:30' });
  // a long stay from 12 Sep: night 30 is 11 Oct, so DTCM charges only 1 - 11 Oct
  const long = seg('619', '2026-09-12', '', 11);
  check('30-night cap: a long stay\'s charged nights are the first in the window', C.buildExpected([long], { windowDates: days }).map(e => e.businessDate.slice(8)).join(), '01,02,03,04,05,06,07,08,09,10,11');
  // a guest in since September and gone on 5 Oct: DTCM counts only the October nights
  const segs = [long, seg('224', '2026-09-28', '2026-10-05', 4), seg('305', '2026-10-02', '2026-10-10', 8)];
  const rows = [].concat(
    days.map(d => post('619', d, d <= '2026-10-11' ? 10 : 0)),
    ['01', '02', '03', '04'].map(x => post('224', '2026-10-' + x, 10)),
    ['02', '03', '04', '05', '06', '07', '08', '09'].map(x => post('305', '2026-10-' + x, 10)));
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const rc = R.reconcile({ segments: segs, finalFees: 230 }, rows, total);
  check('13 days of postings are read as one window (not expanded from September check-ins)', [rc.mode, rc.windowStart, rc.windowEnd].join(), 'window,2026-10-01,2026-10-13');
  check('nothing to fix when both sides agree', rc.fixPlan.length, 0);
}

console.log('\nHotel TD settings');
{
  // same Opera file with code 7510 → 7600 and a different description
  const o = fs.readFileSync(path.join(FIX, 'oct1-4.opera.txt'), 'utf8').split('\n');
  const h = o[0].split('\t'), iCode = h.indexOf('TRX_CODE'), iDesc = h.indexOf('TRX_DESC');
  const o7600 = [o[0]].concat(o.slice(1).map(l => { const c = l.split('\t'); if (c.length > iCode) { c[iCode] = '7600'; c[iDesc] = 'Tourism Fee'; } return c.join('\t'); })).join('\n');
  fs.writeFileSync(path.join(FIX, '_tmp7600.opera.txt'), o7600);
  fs.copyFileSync(path.join(FIX, 'oct1-4.dtcm.xml'), path.join(FIX, '_tmp7600.dtcm.xml'));
  try {
    const wrong = recon('_tmp7600', { tdCodes: '7510' });
    check('wrong code reads no Opera TD lines', wrong.gap.rawOpera, 0);
    const right = recon('_tmp7600', { tdCodes: '7600', tdDesc: 'xxxx' });
    check('code 7600 gives the same result as 7510', [right.gap.rawOpera, right.gap.monthEnd.dtcm, rooms(right).length], [4810, 4830, 10]);
  } finally {
    fs.unlinkSync(path.join(FIX, '_tmp7600.opera.txt'));
    fs.unlinkSync(path.join(FIX, '_tmp7600.dtcm.xml'));
  }
}

// ── 4. Nationality report — Opera spellings ──────────────
console.log('\nNationality report');
{
  const sb = { console: { log() {} }, document: { readyState: 'complete', addEventListener() {}, getElementById() { return null; } },
               localStorage: { getItem() { return null; }, setItem() {} }, setTimeout: () => 0, window: {} };
  vm.createContext(sb);
  const src = fs.readFileSync(path.join(ROOT, 'reports.js'), 'utf8');
  vm.runInContext(src.slice(0, src.indexOf('// ── NATIONALITY REPORT')) + ';this.R = resolveCountry;', sb);
  const R = n => { const r = sb.R(n); return r.isUnknown ? 'UNKNOWN' : r.excel; };
  check('Antigua and Barbuda', R('Antigua and Barbuda'), 'Antigua & Barbuda');
  check('Korea (North)', R('Korea (North)'), "Korea, Democratic People's Republic of (North)");
  check('Cayman Islands', R('Cayman Islands'), 'Cayman Island');
  check('zzz = no nationality', R('zzz'), 'UNKNOWN');
  check('St. Lucia', R('St. Lucia'), 'Saint Lucia');
  check('a real unknown country stays unplaced', R('Madeupland'), null);
}

// ── Roster builder ────────────────────────────────────────
console.log('\nRoster builder');
{
  const sb = { console: { log() {}, warn() {}, error() {} }, localStorage: { getItem() { return null; }, setItem() {} },
               document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } }, window: {}, setTimeout: () => 0, navigator: {} };
  vm.createContext(sb);
  for (const f of ['roster.js', 'roster-build.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  const W = '2026-10-12', dates = [0, 1, 2, 3, 4, 5, 6].map(d => sb.roAdd(W, d));
  const S = ['00:00 - 09:00', '08:00 - 17:00', '12:00 - 21:00', '15:00 - 00:00'];
  const one = [1, 1, 1, 1, 1, 1, 1];
  const person = (key, x) => Object.assign({ key, group: 'Ibis DD', offs: 1, fixed: '', usual: '', allowed: null, prefOff: [], lastShift: '', run: 0, lastOffs: [], phOwed: 0 }, x);
  const I = {
    week: W, groups: { 'Ibis DD': { shifts: S, need: { [S[0]]: one, [S[1]]: one, [S[2]]: one, [S[3]]: one } } },
    people: [person('NIGHT AUDITOR', { fixed: S[0] }), person('LATE WORKER', { lastShift: '15:00 - 00:00', run: 2 }), person('ON LEAVE', {}), person('WANTS FRIDAY', {}), person('LONG RUN', { run: 6 }), person('SPARE ONE', {})],
    pre: { 'ON LEAVE': { [dates[2]]: 'AL', [dates[3]]: 'AL' }, 'WANTS FRIDAY': { [dates[4]]: 'OFF' } },
    rules: { minRest: 11, maxRun: 6, givePh: false, lend: true }, seed: 1,
  };
  const r = sb.rbSolve(I), c = r.cells;
  check('every shift covered every day', r.problems.filter(p => p.kind === 'short').length, 0);
  check('nobody short of rest or over 6 days in a row', r.problems.filter(p => p.kind === 'rest' || p.kind === 'run').length, 0);
  check('everyone has their day off', r.problems.filter(p => p.kind === 'offs').length, 0);
  check('night auditor only works nights', dates.map(d => c['NIGHT AUDITOR'][d]).filter(v => v !== 'OFF').every(v => v === S[0]), true);
  check('annual leave kept', [c['ON LEAVE'][dates[2]], c['ON LEAVE'][dates[3]]], ['AL', 'AL']);
  check('day-off request kept', c['WANTS FRIDAY'][dates[4]], 'OFF');
  check('after 15:00-00:00 no 08:00 or 00:00 start on Monday', ![S[0], S[1]].includes(c['LATE WORKER'][dates[0]]), true);
  check('6 days in a row last week → off on Monday', c['LONG RUN'][dates[0]], 'OFF');
  check('rest hours: 15:00-00:00 then 08:00-17:00 is 8 h', sb.rbRest('15:00 - 00:00', '08:00 - 17:00'), 8);
  check('rest hours: 19:00-04:00 then 19:00-04:00 is 15 h', sb.rbRest('19:00 - 04:00', '19:00 - 04:00'), 15);

  // a short hotel borrows from one with spare
  const N = '12:00 - 21:00', two = [2, 2, 2, 2, 2, 2, 2];
  const I2 = { week: W, groups: { 'Adagio GD': { shifts: [N], need: { [N]: two } }, 'Mercure DD': { shifts: [N], need: { [N]: one } } },
    people: [person('A ONE', { group: 'Adagio GD' }), person('M ONE', { group: 'Mercure DD', title: 'Supervisor' }), person('M TWO', { group: 'Mercure DD', title: 'Supervisor' }), person('M THREE', { group: 'Mercure DD', title: 'Supervisor' })],
    pre: {}, rules: { minRest: 11, maxRun: 6, givePh: false, lend: true, lendIdeal: true }, seed: 3 };
  const r2 = sb.rbSolve(I2);
  { // 🛎 a desk is never empty: a regular colleague from the nearest hotel stands in, never someone set to "never moved"
    const M = '08:00 - 17:00', E = '15:00 - 00:00';
    const Gd = { 'Mercure DD': { shifts: [M, E], need: { [M]: one, [E]: one } }, 'Ibis DD': { shifts: [M, E], need: { [M]: one, [E]: one } } };
    const ppl = [person('ME A', { group: 'Mercure DD', fixed: M }), person('IB A', { group: 'Ibis DD' }), person('IB B', { group: 'Ibis DD' }), person('IB C', { group: 'Ibis DD' }), person('IB E', { group: 'Ibis DD' }), person('IB D', { group: 'Ibis DD', move: false })];
    const r = sb.rbSolve({ week: W, groups: Gd, people: ppl, pre: {}, rules: { minRest: 11, maxRun: 6, givePh: false, lend: true }, seed: 4 });
    const emptyHrs = sb.rbDesk({ week: W, groups: Gd, people: ppl }, r.cells, 'Mercure DD').slice(0, 6).reduce((t, row) => t + row.slice(8, 24).filter(c => !c).length, 0);
    check('desk: Mercure (one person) is covered 08:00–00:00 by colleagues from Ibis', emptyHrs, 0);
    check('desk: someone set to "never moved" is never sent', Object.values(r.cells['IB D']).some(v => / - /.test(String(v).replace(/^\d\d:\d\d - \d\d:\d\d/, ''))), false);
    check('desk: the stand-in is written under Decisions', (r.notes || []).some(n => /covers the Mercure DD desk/.test(n.text)), true);
  }
  { // 🛋 one day off a week, always: "0 days off" on a card, a freeze over the whole week, or no spare cover
    const M = '07:00 - 16:00';
    const base = { week: W, groups: { 'Ibis DD': { shifts: [M], need: { [M]: one } } }, pre: {}, rules: { minRest: 11, maxRun: 6, givePh: false, lend: false }, seed: 2 };
    const offOf = (r, k) => dates.filter(dt => !sb.rbParse(r.cells[k][dt])).length;
    const r0 = sb.rbSolve(Object.assign({}, base, { people: [person('ZERO', { offs: 0 }), person('MATE2', {})] }));
    check('"0 days off" on a card still gets one day off', offOf(r0, 'ZERO') >= 1, true);
    const frz = {}; dates.forEach(dt => { frz[dt] = true; });
    const r1 = sb.rbSolve(Object.assign({}, base, { people: [person('FROZEN', {}), person('MATE3', {})], noOff: { FROZEN: frz } }));
    check('a freeze over the whole week still leaves one day off', offOf(r1, 'FROZEN') >= 1, true);
    const r2 = sb.rbSolve(Object.assign({}, base, { people: [person('ALONE', {})] }));
    check('alone on the shift: still one day off (the gap shows as a problem)', [offOf(r2, 'ALONE') >= 1, r2.problems.some(x => x.kind === 'short')], [true, true]);
  }
  { // 📆 days worked at the end of last week count on a Monday too: an extra Monday off is not taken back into 7 days in a row
    const M = '07:00 - 16:00', Io = { week: W, groups: { 'Ibis DD': { shifts: [M], need: { [M]: one } } },
      people: [person('RUNNER', { run: 4, lastShift: M })], pre: { RUNNER: { [dates[3]]: 'OFF' } }, rules: { minRest: 11, maxRun: 6 } };
    const res = { cells: { RUNNER: { [dates[0]]: 'OFF', [dates[1]]: M, [dates[2]]: M, [dates[3]]: 'OFF', [dates[4]]: M, [dates[5]]: M, [dates[6]]: M } } };
    sb.rbOneOff(Io, res);
    check('an extra Monday off stays when last week ran long', res.cells.RUNNER[dates[0]], 'OFF');
    const I2r = Object.assign({}, Io, { people: Io.people.concat([person('MATE', { lastShift: M })]) });
    const res2 = { cells: { RUNNER: { [dates[0]]: M, [dates[1]]: M, [dates[2]]: M, [dates[3]]: 'OFF', [dates[4]]: M, [dates[5]]: M, [dates[6]]: M },
      MATE: { [dates[0]]: M, [dates[1]]: M, [dates[2]]: M, [dates[3]]: M, [dates[4]]: M, [dates[5]]: 'OFF', [dates[6]]: M } } };
    sb.rbBreakRuns(I2r, res2);
    check('7 days in a row → an extra day off where there is cover', sb.rbProblems(I2r, res2.cells).some(x => x.kind === 'run' && x.key === 'RUNNER'), false);
    check('…and no shift left empty for it', sb.rbProblems(I2r, res2.cells).some(x => x.kind === 'short'), false);
  }
  { // 🚶 "Can be moved" on an agent's card: they may be borrowed, from the nearest hotel first (Ibis → Mercure → Adagio)
    const Im = { week: W, groups: { 'Adagio GD': { shifts: [N], need: { [N]: two } }, 'Mercure DD': { shifts: [N], need: { [N]: one } }, 'Ibis DD': { shifts: [N], need: { [N]: one } } },
      people: [person('A ONE', { group: 'Adagio GD' }), person('M ONE', { group: 'Mercure DD' }), person('M TWO', { group: 'Mercure DD', move: true }), person('M THREE', { group: 'Mercure DD', move: true }),
        person('I ONE', { group: 'Ibis DD' }), person('I TWO', { group: 'Ibis DD', move: true }), person('I THREE', { group: 'Ibis DD', move: true })],
      pre: {}, rules: { minRest: 11, maxRun: 6, givePh: false, lend: true, lendIdeal: true }, seed: 5 };
    const rm = sb.rbSolve(Im), at = (k) => Object.values(rm.cells[k] || {}).filter(v => / - Adagio$/.test(v)).length;
    check('a movable agent is borrowed for an empty shift', at('M TWO') + at('M THREE') + at('I TWO') + at('I THREE') > 0, true);
    check('the nearest hotel (Mercure) lends to Adagio, not Ibis', at('I TWO') + at('I THREE'), 0);
    check('an agent not marked movable stays home', at('M ONE') + at('I ONE'), 0);
    check('walking distance: Ibis → Adagio is the far end', [sb.rbHotelDist('Ibis DD', 'Adagio GD'), sb.rbHotelDist('Mercure DD', 'Adagio GD'), sb.rbHotelDist('Ibis DD', 'Ibis DD')], [2, 1, 0]);
    check('the hotel\'s own walking order wins', sb.rbHotelDist('Ibis DD', 'Adagio GD', { hotelOrder: ['Adagio GD', 'Ibis DD', 'Mercure DD'] }), 1);
  }
  { // only Duty Managers and Supervisors are ever moved to another hotel: the same week with agents, nobody moves
    const Ia = Object.assign({}, I2, { people: I2.people.map(p => Object.assign({}, p, { title: '' })) });
    const ra = sb.rbSolve(Ia), movedA = Object.values(ra.cells).reduce((t, row) => t + Object.values(row).filter(v => / - Adagio$/.test(v)).length, 0);
    { // 🔁 "Covers for": on the days X is off, Y works X's shift at X's hotel (even an agent, even another hotel)
      const Mx = '08:00 - 17:00', one7 = [1, 1, 1, 1, 1, 1, 1];
      const Ex = '15:00 - 00:00';
      const Ic = { week: W, groups: { 'Adagio GD': { shifts: [Mx, Ex], need: { [Mx]: one7, [Ex]: one7 } } },
        people: [person('X SUP', { group: 'Adagio GD', title: 'Supervisor', usual: Mx, likes: [Mx] }), person('Y AG', { group: 'Adagio GD', covers: 'X SUP', usual: Ex, likes: [Ex] }), person('A2', { group: 'Adagio GD' }), person('A3', { group: 'Adagio GD' })],
        pre: {}, rules: { minRest: 11, maxRun: 6, givePh: false, lend: true }, seed: 4 };
      const rc = sb.rbSolve(Ic), dts = dates.filter(dt => !sb.rbParse(rc.cells['X SUP'][dt]));
      check('covers: on X\'s days off, Y (same hotel) works X\'s shift', [dts.length > 0, dts.every(dt => rc.cells['Y AG'][dt] === '08:00 - 17:00'), rc.notes.some(n => /covers/.test(n.text))].join(), 'true,true,true');
    }
    { // covering a night: even with a morning request that day, then a day off, then back to mornings
      const Mx = '07:00 - 15:00', Nx = '23:00 - 07:00', one7 = [1, 1, 1, 1, 1, 1, 1], d3 = W ? null : null;
      const Ic = { week: W, groups: { 'Ibis DD': { shifts: [Mx, Nx], need: { [Mx]: one7, [Nx]: one7 } } },
        people: [person('NS', { title: 'Supervisor', usual: Nx, likes: [Nx], fixed: Nx }), person('TM', { covers: 'NS', usual: Mx, likes: [Mx] }), person('B1'), person('B2'), person('B3')],
        pre: {}, rules: { minRest: 11, maxRun: 6, givePh: false, lend: true }, seed: 6 };
      const r0 = sb.rbSolve(Object.assign({}, Ic, { people: Ic.people.map(p => Object.assign({}, p, { covers: '' })) }));
      const off0 = dates.filter(dt => !sb.rbParse(r0.cells['NS'][dt]));
      Ic.pre = { TM: Object.fromEntries(off0.map(dt => [dt, Mx])) };   // TM asked for mornings on exactly those days
      const rc = sb.rbSolve(Ic), offN = dates.filter(dt => !sb.rbParse(rc.cells['NS'][dt]));
      const ok = offN.length > 0 && offN.every(dt => rc.cells['TM'][dt] === Nx) && offN.every(dt => { const d = dates.indexOf(dt), nx = dates[d + 1]; return !nx || offN.includes(nx) || sb.rbKind(rc.cells['TM'][nx]) === 'off'; });
      check('covers a night: the deputy takes the night even over a morning request, then a day off', ok, true);
    }
    { // more people than needed: spread them over the shifts, not all on the one they like (no 3 on a shift that needs 1)
      const Mx = '07:00 - 15:00', Dx = '12:00 - 21:00', Ex = '15:00 - 00:00', one7 = [1, 1, 1, 1, 1, 1, 1];
      const ks = ['P1', 'P2', 'P3', 'P4', 'P5'];
      const Id = { week: W, groups: { 'Ibis DD': { shifts: [Mx, Dx, Ex], need: { [Mx]: one7, [Dx]: one7, [Ex]: one7 } } },
        people: ks.map((k, i) => person(k, { likes: i < 3 ? [Dx] : [], usual: i < 3 ? Dx : '' })),
        pre: {}, rules: { minRest: 11, maxRun: 6, givePh: false, lend: true }, seed: 8 };
      const rd = sb.rbSolve(Id);
      const stacked = dates.filter(dt => [Mx, Dx, Ex].some(s => ks.filter(k => rd.cells[k][dt] === s).length >= 3)).length;
      check('extra people are spread over the shifts, never piled on one (even if they all like it)', stacked, 0);
    }
    { // your own rules: two people never off on the same day; someone never on a shift
      const Mx = '07:00 - 15:00', Ex = '15:00 - 00:00', one7 = [1, 1, 1, 1, 1, 1, 1];
      const ks = ['Q1', 'Q2', 'Q3', 'Q4'];
      const base = { week: W, groups: { 'Ibis DD': { shifts: [Mx, Ex], need: { [Mx]: one7, [Ex]: one7 } } },
        people: ks.map(k => person(k, { prefOff: [5] })), pre: {}, seed: 9 };
      const rules = { minRest: 11, maxRun: 6, givePh: false, lend: true, custom: [{ t: 'offApart', a: 'Q1', b: 'Q2', level: 3 }, { t: 'personNo', a: 'Q3', shift: Ex, level: 3 }] };
      const ro = sb.rbSolve(Object.assign({}, base, { rules }));
      const bothOff = dates.filter(dt => sb.rbKind(ro.cells.Q1[dt]) === 'off' && sb.rbKind(ro.cells.Q2[dt]) === 'off').length;
      const q3eve = dates.filter(dt => ro.cells.Q3[dt] === Ex).length;
      check('own rules: two people never off the same day, and someone kept off a shift', [bothOff, q3eve].join(), '0,0');
    }
    { // days off spread over the week: not three people of a small hotel off the same day (even if all like that day)
      const Mx = '08:00 - 17:00', Dx = '12:00 - 21:00', Nx = '00:00 - 09:00', one7 = [1, 1, 1, 1, 1, 1, 1];
      const ks = ['H1', 'H2', 'H3', 'H4', 'H5'];
      const Io = { week: W, groups: { 'Ibis DD': { shifts: [Mx, Dx, Nx], need: { [Mx]: one7, [Dx]: one7, [Nx]: one7 } } },
        people: ks.map(k => person(k, { prefOff: [6], learnedOff: [6] })), pre: {}, rules: { minRest: 11, maxRun: 6, givePh: false, lend: true }, seed: 11 };
      const ro = sb.rbSolve(Io);
      const most = Math.max(...dates.map(dt => ks.filter(k => sb.rbKind(ro.cells[k][dt]) === 'off').length));
      check('days off are spread: never three of a small hotel off the same day', most <= 2, true);
    }
    { // a night kept for Supervisors: the deputy who covers the Supervisor may still do it (not flagged)
      const Mx = '08:00 - 17:00', Nx = '00:00 - 09:00', one7 = [1, 1, 1, 1, 1, 1, 1];
      const Iw = { week: W, groups: { 'Mercure DD': { shifts: [Mx, Nx], need: { [Mx]: one7, [Nx]: one7 }, who: { [Nx]: ['Supervisor', 'Duty Manager'] } } },
        people: [person('SY', { group: 'Mercure DD', title: 'Duty Manager', fixed: Nx, usual: Nx }), person('HN', { group: 'Mercure DD', title: 'Team Leader', covers: 'SY', usual: Mx }), person('M2', { group: 'Mercure DD' }), person('M3', { group: 'Mercure DD' })],
        pre: {}, rules: { minRest: 11, maxRun: 6, givePh: false, lend: true }, seed: 12 };
      const rw = sb.rbSolve(Iw);
      check('covers: the deputy may do the colleague\'s Supervisor-only night, not flagged', [dates.some(dt => rw.cells.HN[dt] === Nx), rw.problems.filter(p => p.kind === 'who' && p.key === 'HN').length].join(), 'true,0');
    }
    { // ☀️ two at the desk every morning, even when each shift only "needs" one
      const Mx = '08:00 - 17:00', Dx = '12:00 - 21:00', Ex = '15:00 - 00:00', Nx = '00:00 - 09:00', one7 = [1, 1, 1, 1, 1, 1, 1];
      const ks = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'];
      const Im = { week: W, groups: { 'Ibis DD': { shifts: [Nx, Mx, Dx, Ex], need: { [Nx]: one7, [Mx]: one7, [Dx]: one7, [Ex]: one7 } } },
        people: ks.map(k => person(k, { likes: [Dx, Ex] })), pre: {}, rules: { minRest: 11, maxRun: 6, givePh: false, lend: true }, seed: 13 };
      const rm = sb.rbSolve(Im), at = (dt, h) => ks.filter(k => { const x = sb.rbParse(rm.cells[k][dt]); return x && x.s <= h * 60 && x.e > h * 60; }).length;
      check('morning: two at the desk 09:00 – 12:00 when people are free', dates.every(dt => at(dt, 10) >= 2), true);
    }
    // an agent goes to another hotel only to keep its desk from being empty (the day its only person is off), never to make it two
    const agentDays = dates.filter(dt => Object.keys(ra.cells).some(k => / - Adagio$/.test(ra.cells[k][dt] || ''))), aOff = dates.filter(dt => !sb.rbParse(ra.cells['A ONE'][dt]));
    check('agents move to another hotel only so its desk is never empty (not to make it two)', [agentDays.every(dt => aOff.includes(dt)), sb.rbMayWork(Ia, 'Adagio GD', Ia.people[1], N), sb.rbMayWork(I2, 'Adagio GD', I2.people[1], N)].join(), 'true,false,true');
  }
  check('moves: the hotels touched by moves are counted (from and to)', [...sb.rbMoveHotels(I2, { 'M ONE': { [dates[0]]: '12:00 - 21:00 - Adagio' }, 'A ONE': {}, 'M TWO': {}, 'M THREE': {} })].sort().join(), 'Adagio GD,Mercure DD');
  { // a Duty Manager and a Supervisor never on the same shift together
    const Mx = '08:00 - 17:00', Ex = '15:00 - 00:00', twoD = [2, 2, 2, 2, 2, 2, 2];
    const I5 = { week: W, groups: { 'Ibis DD': { shifts: [Mx, Ex], need: { [Mx]: twoD, [Ex]: twoD } } },
      people: [person('DM1', { title: 'Duty Manager', likes: [Mx], usual: Mx }), person('SUP1', { title: 'Supervisor', likes: [Mx], usual: Mx }), person('AG1'), person('AG2'), person('AG3'), person('AG4')],
      pre: {}, rules: { minRest: 11, maxRun: 6, givePh: false, lend: true }, seed: 5 };
    const r5 = sb.rbSolve(I5);
    check('a Duty Manager and a Supervisor are never on the same shift (even when both like mornings)', sb.rbSeniorClash(I5, r5.cells, dates).length + '|' + r5.problems.filter(p => p.kind === 'short').length, '0|0');
  }
  { // by default staff stay in their own hotel: moved only to a shift that would be empty, not for the ideal second person
    const r3 = sb.rbSolve(Object.assign({}, I2, { rules: Object.assign({}, I2.rules, { lendIdeal: false }) }));
    const moved = Object.values(r3.cells).reduce((t, row) => t + Object.values(row).filter(v => / - Adagio$/.test(v)).length, 0);
    const emptyDays = dates.filter(dt => !sb.rbParse(r3.cells['A ONE'][dt])).length;
    // someone alone the whole shift (nobody with them for a break) is worse than borrowing a colleague (the lender keeps its own cover)
    const aloneLeft = r3.problems.filter(p => p.group === 'Adagio GD' && (p.kind === 'thin' || p.kind === 'short')).length;
    check('alone all shift: a colleague comes from a hotel with one spare; the lender is never left short', [moved >= emptyDays, aloneLeft, r3.problems.filter(p => p.group === 'Mercure DD' && p.kind === 'short').length].join(), 'true,0,0');
  }
  { // with company for a few hours (another shift overlaps), nobody is moved for the second person
    const D9 = '09:00 - 18:00', D12 = '12:00 - 21:00', both = [1, 1, 1, 1, 1, 1, 1], two = [2, 2, 2, 2, 2, 2, 2];
    const I6 = { week: W, groups: { 'Adagio GD': { shifts: [D9, D12], need: { [D9]: two, [D12]: both } }, 'Mercure DD': { shifts: [D9], need: { [D9]: both } } },
      people: [person('A1', { group: 'Adagio GD' }), person('A2', { group: 'Adagio GD' }), person('A3', { group: 'Adagio GD' }), person('M1', { group: 'Mercure DD' }), person('M2', { group: 'Mercure DD' }), person('M3', { group: 'Mercure DD' })],
      pre: {}, rules: { minRest: 11, maxRun: 6, givePh: false, lend: true }, seed: 3 };
    const r6 = sb.rbSolve(I6);
    const moved6 = Object.values(r6.cells).reduce((t, row) => t + Object.values(row).filter(v => / - Adagio$/.test(v)).length, 0);
    const emptyA = r6.problems.filter(p => p.group === 'Adagio GD' && p.kind === 'short').length;
    check('company for a few hours: one on a shift stays one, nobody moved for the ideal second', [moved6, emptyA].join(), '0,0');
  }
  const lent = Object.values(r2.cells).reduce((t, row) => t + Object.values(row).filter(v => / - Adagio$/.test(v)).length, 0);
  check('Mercure lends staff to Adagio ("12:00 - 21:00 - Adagio")', lent >= 5, true);
  check('lending never leaves the lender short', r2.problems.filter(p => p.kind === 'short' && p.group === 'Mercure DD').length, 0);
  check('lent shifts count for the hotel they work at', r2.cover['Adagio GD'][N].reduce((a, b) => a + b, 0) >= 11, true);

  // weeks in a row, each starting from how the last one ended (the way it is really used)
  let probs = 0, weeks = 0, thinAll = 0;
  let tight = 0;
  for (let team = 0; team <= 3; team++) {
    const n = 5 + team, R = sb.rbRand((team || 4) * 97);
    const need = {}; S.forEach(x => { need[x] = one; }); if (n >= 6) need[S[1]] = [2, 2, 2, 2, 2, 1, 1];
    let ppl = Array.from({ length: n }, (_, i) => person('P' + i, { fixed: i === 0 ? S[0] : '' })), w = W;
    for (let k = 0; k < 4; k++, w = sb.roAdd(w, 7)) {
      const ds = [0, 1, 2, 3, 4, 5, 6].map(d => sb.roAdd(w, d)), pre = {};
      if (R() < 0.5) { const d = Math.floor(R() * 5); pre['P' + (1 + Math.floor(R() * (n - 1)))] = { [ds[d]]: 'AL', [ds[d + 1]]: 'AL' }; }
      const r3 = sb.rbSolve({ week: w, groups: { 'Ibis DD': { shifts: S, need } }, people: ppl, pre, rules: { minRest: 11, maxRun: 12, givePh: false, lend: false }, seed: k + 1, attempts: 2 });
      if (n === 5) { tight = Math.max(tight, r3.problems.length); if (r3.problems.length > 1) console.log('   tight:', JSON.stringify(r3.problems.map(x => [x.kind, x.key, x.date && x.date.slice(8), x.shift || x.from, x.to || '']))); } else { probs += r3.problems.filter(x => x.kind !== 'thin').length; thinAll += r3.problems.filter(x => x.kind === 'thin').length; weeks++; }
      ppl = ppl.map(p => { const row = ds.map(d => r3.cells[p.key][d] || ''); let run = 0; for (let d = 6; d >= 0 && sb.rbParse(row[d]); d--) run++; if (run === 7) run += p.run; return Object.assign({}, p, { lastShift: row[6], run }); });
    }
  }
  check(`${weeks} weeks in a row for teams of 6 to 8: no gaps, rest, night/day or day-off problems`, probs, 0);
  check(`${weeks} weeks: steady shifts cost at most one shift run by one person (allowed when there is no other way)`, thinAll <= 1, true);
  check('a team of 5 with no spare at all: at most one gap a week, never a broken rule', tight <= 1, true);
}

// ── Roster scenarios ──────────────────────────────────────
console.log('\nRoster scenarios');
{
  const sb = { console: { log() {}, warn() {}, error() {} }, localStorage: { getItem() { return null; }, setItem() {} },
               document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } }, window: {}, setTimeout: () => 0, setInterval: () => 0, navigator: {} };
  vm.createContext(sb);
  for (const f of ['roster.js', 'roster-build.js', 'roster-team.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  const W = '2026-10-12', dates = [0, 1, 2, 3, 4, 5, 6].map(d => sb.roAdd(W, d)), day = n => Array(7).fill(n);
  const P = (key, x) => Object.assign({ key, group: 'Ibis DD', offs: 1, fixed: '', usual: '', allowed: null, prefOff: [], lastShift: '', run: 0, lastOffs: [], phOwed: 0, title: '' }, x);
  const solve = (groups, people, pre, rules) => sb.rbSolve({ week: W, groups, people, pre: pre || {}, rules: Object.assign({ minRest: 11, maxRun: 12, maxHours: 9, allowOne: true, givePh: false, lend: true }, rules), seed: 1 });
  const M = '08:00 - 17:00', E = '15:00 - 00:00', N = '00:00 - 09:00', D9 = '09:00 - 18:00';

  // 0. a gap is fixed the gentlest way: one night borrowed beats a whole week moved to another hotel
  {
    const G = { 'Ibis DD': { shifts: [M, E], need: { [M]: day(1), [E]: day(1) } }, 'Mercure DD': { shifts: [M, E], need: { [M]: day(1), [E]: day(1) } } };
    const ppl = [P('A'), P('B'), P('Y', { group: 'Mercure DD' }), P('Z', { group: 'Mercure DD' })];
    const I = { week: W, groups: G, people: ppl, pre: {}, rules: { minRest: 11, maxRun: 12, maxHours: 9, allowOne: true, givePh: false, lend: true } };
    const base = {}; ppl.forEach((p, i) => { base[p.key] = {}; dates.forEach((dt, d) => { base[p.key][dt] = d === i ? 'OFF' : i % 2 ? E : M; }); });
    const one = JSON.parse(JSON.stringify(base)); one.Z[dates[3]] = E + ' - Ibis';
    const week = JSON.parse(JSON.stringify(base)); dates.forEach((dt, d) => { if (d !== 2) week.Y[dt] = E + ' - Ibis'; });
    check('stay home: one night at another hotel costs less than a whole week moved', sb.rbUpset(I, base, one) < sb.rbUpset(I, base, week), true);
    check('stay home: each day at another hotel counts much more than a day changed at home', sb.rbUpset(I, base, one) > 10 * 10, true);
  }
  // 0b. an earlier start than the day before (12-21 then 09-18) needs a day off between; an hour earlier is fine
  {
    const R = { nightSwitch: true };
    check('earlier start: 12-21 then 08-17 the next day is not allowed (more than 3 h earlier)', sb.rbSwitchOk('12:00 - 21:00', '08:00 - 17:00', R), false);
    check('earlier start: 15-00 then 12-21 the next day is fine (3 h earlier, rest kept)', sb.rbSwitchOk('15:00 - 00:00', '12:00 - 21:00', R), true);
    check('earlier start: an hour earlier (09-18 then 08-17) is fine; later is fine', [sb.rbSwitchOk('09:00 - 18:00', '08:00 - 17:00', R), sb.rbSwitchOk('09:00 - 18:00', '12:00 - 21:00', R)].join(), 'true,true');
    check('earlier start: can be switched off in Rules', sb.rbSwitchOk('12:00 - 21:00', '09:00 - 18:00', { noBack: false }), true);
    const D12 = '12:00 - 21:00';
    const r = solve({ 'Ibis DD': { shifts: [D9, D12], need: { [D9]: day(1), [D12]: day(1) } } }, ['A', 'B', 'C'].map(k => P(k)));
    const back = r.problems.filter(p => p.kind === 'back').length;
    let seen = 0; ['A', 'B', 'C'].forEach(k => dates.forEach((dt, d) => { if (d && r.cells[k][dates[d - 1]] === D12 && r.cells[k][dt] === D9) seen++; }));
    check('earlier start: the builder never plans 12-21 then 09-18', [seen, back].join(), '0,0');
  }
  // 0c. "never to Ibis" on someone's card: never sent there, other hotels still fine
  {
    const p = P('Z', { group: 'Mercure DD', noGo: ['Ibis DD'], title: 'Supervisor' }), I = { groups: { 'Ibis DD': { shifts: [M] }, 'Adagio GD': { shifts: [M] }, 'Mercure DD': { shifts: [M] } } };
    check('never to a hotel: not to Ibis, Adagio and home still fine', [sb.rbMayWork(I, 'Ibis DD', p, M), sb.rbMayWork(I, 'Adagio GD', p, M), sb.rbMayWork(I, 'Mercure DD', p, M)].join(), 'false,true,true');
    const G = { 'Ibis DD': { shifts: [M, E], need: { [M]: day(1), [E]: day(1) } }, 'Mercure DD': { shifts: [M, E], need: { [M]: day(1), [E]: day(1) } } };
    const ppl = [P('A'), P('Y', { group: 'Mercure DD', noGo: ['Ibis DD'] }), P('Z', { group: 'Mercure DD', noGo: ['Ibis DD'] }), P('X', { group: 'Mercure DD', noGo: ['Ibis DD'] })];
    const r = sb.rbSolve({ week: W, groups: G, people: ppl, pre: {}, rules: { minRest: 11, maxRun: 12, maxHours: 9, allowOne: true, givePh: false, lend: true }, seed: 1 });
    check('never to a hotel: the builder never sends them, even to fill Ibis', ['Y', 'Z', 'X'].some(k => dates.some(dt => /Ibis/.test(r.cells[k][dt] || ''))), false);
  }
  // 0d. covering the night supervisor's day off never costs anyone a second day off that week
  {
    const G = { 'Ibis DD': { shifts: [N, M, E], need: { [N]: day(1), [M]: day(1), [E]: day(1) }, who: { [N]: ['Supervisor'] } } };
    const ppl = [P('H', { title: 'Supervisor', fixed: N, usual: N }), P('T', { title: 'Supervisor', usual: N }), P('A'), P('B'), P('C')];
    const r = sb.rbSolve({ week: W, groups: G, people: ppl, pre: {}, rules: { minRest: 11, maxRun: 12, maxHours: 9, allowOne: true, givePh: false, lend: true }, seed: 1 });
    const extra = ppl.filter(p => dates.filter(dt => sb.rbKind(r.cells[p.key][dt] || '') === 'off').length > 1).map(p => p.key);
    check('night cover: nobody gets two days off in the week', extra.join(), '');
  }
  // 0e. the last check: never a second day off — it becomes a working day that fits, or a PH day when one is owed
  {
    const G = { 'Ibis DD': { shifts: [M, E], need: { [M]: day(1), [E]: day(1) } } };
    const t = P('T'), u = P('U', { phOwed: 2, phLabels: ['28th Aug.', '2nd Sep.'], allowed: [M] });
    const I = { week: W, groups: G, people: [t, u], pre: {}, rules: { minRest: 11, maxRun: 12, maxHours: 9 } };
    const res = { cells: { T: {}, U: {} } };
    dates.forEach((dt, d) => { res.cells.T[dt] = d === 1 || d === 3 ? 'OFF' : M; res.cells.U[dt] = d === 1 ? 'OFF' : d === 0 || d === 2 ? '00:00 - 09:00' : d === 3 ? 'OFF' : M; });   // (each day off right after a night: no morning fits)
    sb.rbOneOff(I, res);
    const offsOf = k => dates.filter(dt => /^OFF$/.test(res.cells[k][dt])).length;
    check('one day off a week: an extra day off becomes a working day that fits', [offsOf('T'), res.cells.T[dates[1]]].join('|'), '1|' + M);
    check('one day off a week: no shift fits (after a night) and PH owed → a PH day', [offsOf('U'), /^PH/.test(res.cells.U[dates[1]] + res.cells.U[dates[3]])].join('|'), '1|true');
  }
  // 0f. back from nights on a later shift: the first shift after the nights (and a day off) is traded with a colleague
  //     in the same hotel on a later shift, for the whole run, so the cover stays exactly the same
  {
    const L = '12:00 - 21:00', G = { 'Ibis DD': { shifts: [N, M, L], need: { [N]: day(1), [M]: day(1), [L]: day(1) } } };
    const I = { week: W, groups: G, people: [P('X'), P('Y'), P('Z')], pre: {}, rules: { minRest: 11, maxRun: 12, maxHours: 9 } };
    const res = { cells: { X: {}, Y: {}, Z: {} } };
    dates.forEach((dt, d) => { res.cells.X[dt] = d < 2 ? N : d === 2 ? 'OFF' : M; res.cells.Y[dt] = d === 0 ? 'OFF' : d < 3 ? M : L; res.cells.Z[dt] = d === 0 ? M : d === 1 ? 'OFF' : d === 2 ? N : d === 3 ? 'OFF' : N; });
    res.cells.Z[dates[1]] = 'OFF'; res.cells.Y[dates[0]] = L; res.cells.Y[dates[1]] = L; res.cells.Y[dates[2]] = 'OFF';
    const before = JSON.stringify(dates.map(dt => ['X', 'Y', 'Z'].map(k => res.cells[k][dt]).sort()));
    sb.rbSoftLanding(I, res);
    const after = JSON.stringify(dates.map(dt => ['X', 'Y', 'Z'].map(k => res.cells[k][dt]).sort()));
    check('back from nights: the first shift back is a later one, not a morning', [res.cells.X[dates[3]], sb.rbLanding(res.cells, I.people[0], dates).length].join('|'), L + '|0');
    check('back from nights: the same shifts are worked every day (same cover)', after, before);
  }
  // 0g. 🚫 day-off freeze: Mon–Thu only A may be off; the others take their day off Fri–Sun. A freeze that took the
  //     whole week before gives the missed day off back the week it ends
  {
    const G = { 'Ibis DD': { shifts: [M, E], need: { [M]: day(1), [E]: day(1) } } };
    const ppl = ['A', 'B', 'C', 'D'].map(k => P(k));
    const I = { week: W, groups: G, people: ppl, pre: {}, rules: { minRest: 11, maxRun: 12, maxHours: 9, allowOne: true, givePh: false, lend: false, offFreeze: [{ from: dates[0], to: dates[3], allow: ['A'] }] }, seed: 1 };
    sb.rbFreeze(I);
    const r = sb.rbSolve(I);
    const offDays = k => dates.map((dt, d) => sb.rbKind(r.cells[k][dt] || '') === 'off' ? d : -1).filter(d => d >= 0);
    check('day-off freeze: nobody but A is off Mon–Thu, A must be off inside it; everyone still gets one day off', ['B', 'C', 'D'].every(k => offDays(k).length === 1 && offDays(k)[0] >= 4) && offDays('A').length === 1 && offDays('A')[0] <= 3, true);
    const I2 = { week: W, groups: G, people: ['A', 'B'].map(k => P(k)), pre: {}, rules: { offFreeze: [{ from: sb.roAdd(W, -7), to: dates[2], allow: [] }] } };
    sb.rbFreeze(I2);
    check('day-off freeze: never two days off in one week (one, after the freeze)', [I2.people[0].offs, sb.rbOffsDue(I2, I2.people[0], dates), !!(I2.noOff.A || {})[dates[2]], !!(I2.noOff.A || {})[dates[3]]].join(), '1,1,true,false');
  }
  // 0g2. bell boys follow the freeze and the cut-off too (only managers keep their days off as usual)
  {
    const BG = 'Ibis DD · Bell', G = { 'Ibis DD': { shifts: [M, E], need: { [M]: day(1), [E]: day(1) } }, [BG]: { shifts: [D9], need: { [D9]: day(1) }, post: 'Bell' } };
    const ppl = ['A', 'B', 'C'].map(k => P(k)).concat(['BB1', 'BB2'].map(k => P(k, { group: BG, post: 'Bell', title: 'Bell Boy' })));
    const I = { week: W, groups: G, people: ppl, pre: {}, rules: { minRest: 11, maxRun: 12, maxHours: 9, allowOne: true, givePh: false, lend: false, offFreeze: [{ from: dates[0], to: dates[3], allow: ['A'] }] }, seed: 1 };
    sb.rbFreeze(I);
    const r = sb.rbSolve(I), offDays = k => dates.map((dt, d) => sb.rbKind(r.cells[k][dt] || '') === 'off' ? d : -1).filter(d => d >= 0);
    check('day-off freeze: bell boys too, their day off only after it', ['BB1', 'BB2'].map(k => offDays(k).length === 1 && offDays(k)[0] >= 4).join(), 'true,true');
  }
  // 0g3. 🛎 a bell boy's day off is fine: the team works without him, no bell boy is borrowed from another hotel for it
  {
    const IB = 'Ibis DD · Bell', MB = 'Mercure DD · Bell';
    const G = { 'Ibis DD': { shifts: [M], need: { [M]: day(1) } }, 'Mercure DD': { shifts: [M], need: { [M]: day(1) } }, [IB]: { shifts: [D9], need: { [D9]: day(1) }, post: 'Bell' }, [MB]: { shifts: [D9], need: { [D9]: day(1) }, post: 'Bell' } };
    const ppl = [P('A'), P('B'), P('C', { group: 'Mercure DD' }), P('D', { group: 'Mercure DD' }), P('BI', { group: IB, post: 'Bell', title: 'Bell Boy' }), P('BM', { group: MB, post: 'Bell', title: 'Bell Boy' })];
    const r = solve(G, ppl, {});
    const moved = ['BI', 'BM'].some(k => dates.some(dt => /Ibis|Mercure/i.test(r.cells[k][dt] || '')));
    check('bell boys: each takes his day off at home, nobody borrowed to cover it, no problem shown', [moved, ['BI', 'BM'].every(k => dates.filter(dt => sb.rbKind(r.cells[k][dt] || '') === 'off').length === 1), r.problems.filter(p => p.kind === 'short').length].join(), 'false,true,0');
  }
  // 0j. 💡 kinder-week ideas: an earlier start without a day off is removed by a one-day trade, same cover, same days off
  {
    const A2 = '12:00 - 21:00', G = { 'Ibis DD': { shifts: [M, A2], need: { [M]: day(1), [A2]: day(1) } } };
    const ppl = [P('X'), P('Y')], cells = { X: {}, Y: {} };
    dates.forEach((dt, d) => { cells.X[dt] = [A2, M, 'OFF', M, M, M, M][d]; cells.Y[dt] = [M, A2, A2, 'OFF', A2, A2, A2][d]; });
    const I = { week: W, groups: G, people: ppl, pre: {}, rules: { minRest: 11, maxRun: 12, maxHours: 9 } };
    const L = sb.rbIdeas(I, cells);
    check('ideas: a one-day trade fixes an earlier start (12–21 → 08–17), keeping cover and days off', [L.length >= 1, L[0] && L[0].changes.length, L[0] && /earlier start/.test(L[0].why)].join(), 'true,2,true');
  }
  // 0h. ✂️ HR cut-off on the 15th, 2 days off each half. Week Mon 12 – Sun 18: the first half ends Thursday.
  //     X took both already (none left: no day off Mon–Thu, the usual one Fri–Sun); Y took none (both before Friday);
  //     Z took one (one before Friday, none after). A 📌 fixed day off stays as it is.
  {
    const WK = '2026-10-12', ds = Array.from({ length: 7 }, (_, d) => sb.roAdd(WK, d));
    vm.runInContext(`globalThis._cutSave = { a: roDays['2026-10-03'], b: roDays['2026-10-08'] }; roDays['2026-10-03'] = Object.assign({}, roDays['2026-10-03'], { X: 'OFF', Z: 'OFF' }); roDays['2026-10-08'] = Object.assign({}, roDays['2026-10-08'], { X: 'OFF' });`, sb);
    const G = { 'Ibis DD': { shifts: [M, E], need: { [M]: day(1), [E]: day(1) } } };
    const ppl = ['X', 'Y', 'Z', 'Q'].map(k => P(k));
    const I = { week: WK, groups: G, people: ppl, pre: {}, rules: { minRest: 11, maxRun: 12, maxHours: 9, allowOne: true, givePh: false, lend: false, cutoff: { on: true, day: 15, per: 2 } }, seed: 1 };
    sb.rbCutoff(I);
    check('cut-off: one day off a week, in the half that still owes one (X 0+1, Y 1+0 with 1 still owed, Z 1+0)', ['X', 'Y', 'Z'].map(k => ppl.find(p => p.key === k).cut.map(x => x.due).join('+')).join(' ') + ' ' + ppl.find(p => p.key === 'Y').cut[0].owed, '0+1 1+0 1+0 1');
    const r = sb.rbSolve(I), offIdx = k => ds.map((dt, d) => sb.rbKind(r.cells[k][dt] || '') === 'off' ? d : -1).filter(d => d >= 0);
    check('cut-off: the week follows it (X off Fri–Sun, Y and Z off Mon–Thu, nobody twice)', [offIdx('X').every(d => d >= 4) && offIdx('X').length === 1, offIdx('Y').length === 1 && offIdx('Y')[0] <= 3, offIdx('Z').length === 1 && offIdx('Z')[0] <= 3].join(), 'true,true,true');
    // with a 🚫 freeze Mon–Thu too (only Y picked): everyone still gets exactly one day off; X, Z and Q after the 15th
    const ppl2 = ['X', 'Y', 'Z', 'Q'].map(k => P(k));
    const I2 = { week: WK, groups: G, people: ppl2, pre: {}, rules: { minRest: 11, maxRun: 12, maxHours: 9, allowOne: true, givePh: false, lend: false, cutoff: { on: true, day: 15, per: 2 }, offFreeze: [{ from: ds[0], to: ds[3], allow: ['Y'] }] }, seed: 1 };
    sb.rbFreeze(I2); sb.rbCutoff(I2);
    const r2 = sb.rbSolve(I2), off2 = k => ds.map((dt, d) => sb.rbKind(r2.cells[k][dt] || '') === 'off' ? d : -1).filter(d => d >= 0);
    check('freeze + cut-off: one day off each, only the picked one before the 15th, no problems', [['X', 'Z', 'Q'].every(k => off2(k).length === 1 && off2(k)[0] >= 4), off2('Y').length === 1 && off2('Y')[0] <= 3, r2.problems.filter(p => p.kind !== 'thin').length].join(), 'true,true,0');
    vm.runInContext(`if (_cutSave.a) roDays['2026-10-03'] = _cutSave.a; else delete roDays['2026-10-03']; if (_cutSave.b) roDays['2026-10-08'] = _cutSave.b; else delete roDays['2026-10-08'];`, sb);
  }
  // 0i. ⚠️ "only if no other option" for a hotel: someone else is borrowed first; alone, they still go
  {
    const G = { 'Ibis DD': { shifts: [M], need: { [M]: day(1) } }, 'Mercure DD': { shifts: [M], need: { [M]: day(1) } } };
    const mk = soft => [P('A', { softGo: soft ? ['Mercure DD'] : [], title: 'Supervisor' }), P('B', { title: 'Supervisor' }), P('C', { title: 'Supervisor' }), P('Z', { group: 'Mercure DD' })];
    const pre = { Z: Object.fromEntries(dates.map(dt => [dt, 'AL'])) };
    const away = (r, k) => dates.filter(dt => /Mercure/i.test(r.cells[k][dt] || '')).length;
    const r1 = solve(G, mk(true), pre), r2 = solve(G, mk(false), pre);
    check('hotel "only if no option": the others go to Mercure first', [away(r1, 'A'), away(r1, 'B') + away(r1, 'C') >= 6, r1.problems.filter(p => p.kind === 'short').length].join(), '0,true,0');
    const sh = r => r.problems.filter(p => p.kind === 'short').length;
    const r3 = solve(G, [P('A', { softGo: ['Mercure DD'], title: 'Supervisor' }), P('B', { title: 'Supervisor' }), P('Z', { group: 'Mercure DD' })], pre), r4 = solve(G, [P('A', { title: 'Supervisor' }), P('B', { title: 'Supervisor' }), P('Z', { group: 'Mercure DD' })], pre);
    check('hotel "only if no option": still goes when nobody else can (cover as good as without it)', [sh(r3) === sh(r4), away(r3, 'A') + away(r3, 'B') > 0].join(), 'true,true');
  }
  // 1. ideal two per shift, too few people: never an empty shift, some one-person shifts
  {
    const r = solve({ 'Ibis DD': { shifts: [M, E], need: { [M]: day(2), [E]: day(2) } } }, ['A', 'B', 'C', 'D'].map(k => P(k)), {}, { overlapMin: 0 });
    check('short-handed: no shift left empty', r.problems.filter(p => p.kind === 'short').length, 0);
    check('short-handed: one-person shifts reported instead', r.problems.filter(p => p.kind === 'thin').length > 0, true);
    // alone on the shift but with company for a few hours (08-17 and 15-00 overlap 15:00-17:00): fine, they can take a break
    const r2 = solve({ 'Ibis DD': { shifts: [M, E], need: { [M]: day(2), [E]: day(2) } } }, ['A', 'B', 'C', 'D'].map(k => P(k)));
    check('company: one on a shift with 2 hours together on the desk is not a problem', r2.problems.filter(p => p.kind === 'thin' || p.kind === 'short').length, 0);
    const r3 = solve({ 'Ibis DD': { shifts: [M, E], need: { [M]: day(2), [E]: day(2) } } }, ['A', 'B', 'C', 'D'].map(k => P(k)), {}, { overlapMin: 3 });
    check('company: asking for 3 hours together, 2 is not enough', r3.problems.filter(p => p.kind === 'thin').length > 0, true);
  }
  // 2. three staff, three shifts of one (one-man shifts): the gaps that can't be filled say "bring in a staff member"
  {
    const G = { 'Ibis DD': { shifts: [N, M, E], need: { [N]: day(1), [M]: day(1), [E]: day(1) } } };
    const ppl = ['A', 'B', 'C'].map(k => P(k)), r = solve(G, ppl, {}, { offWorked: true, morningTwo: false });
    const gaps = r.problems.filter(p => p.kind === 'short');
    check('three staff, 21 shifts, 18 working days: even with "work a day off" on, nobody gives up their only day off — the gaps are left to decide', [gaps.length, r.problems.filter(p => p.kind === 'offs').length, (r.notes || []).some(n => /works their day off/.test(n.text))].join(), '3,0,false');
    const r0 = solve(G, ppl, {}, { morningTwo: false });   // the default: nobody loses their weekly day off, the gaps are left for the manager
    check('by default nobody works their day off to fill a shift (the gap is shown instead)', [r0.problems.filter(p => p.kind === 'offs').length, r0.problems.filter(p => p.kind === 'short').length].join(), '0,3');
    check('no rest rule broken to close them, and only one day off given up a week', r.problems.filter(p => p.kind === 'rest').length, 0);
    const I = { week: W, groups: G, people: ppl, pre: {}, rules: { minRest: 11, maxHours: 9, allowOne: true } };
    const o = sb.rtCoverOptions(I, r.cells, 'Ibis DD', gaps[0].date, gaps[0].shift);
    check('a gap nobody can fill → "bring in a staff member"', o.length === 1 && o[0].kind === 'bring', true);
  }
  // 3. managers hold a shift only when it would be empty
  {
    const G = { 'Ibis DD': { shifts: [N, D9], need: { [N]: day(1), [D9]: day(1) } } };
    const mgrStays = solve(G, [P('MGR', { title: 'Manager', fixed: D9, fixedCost: 400 }), P('A1'), P('A2')]);
    check('enough agents: the manager stays on 09:00 - 18:00', dates.map(d => mgrStays.cells.MGR[d]).filter(v => v !== 'OFF').every(v => v === D9), true);
    const pre = { A1: { [dates[2]]: 'SL', [dates[3]]: 'SL', [dates[4]]: 'SL' } };
    const mgrMoves = solve(G, [P('MGR', { title: 'Manager', fixed: D9, fixedCost: 400 }), P('A1'), P('A2')], pre);
    check('agent sick 3 days: no night left empty (the manager steps in if needed)', mgrMoves.problems.filter(p => p.kind === 'short' && p.shift === N).length, 0);
  }
  // 4. rotation: a different main shift from last week
  {
    const r = solve({ 'Ibis DD': { shifts: [M, E], need: { [M]: day(1), [E]: day(1) } } }, [P('ROT', { mode: 'rotate', lastMain: M }), P('B'), P('C')]);
    const mine = dates.map(d => r.cells.ROT[d]).filter(v => v !== 'OFF');
    check('rotating person moves off last week\'s shift', mine.filter(v => v === E).length > mine.filter(v => v === M).length, true);
  }
  // 5. nine hours at most
  {
    const I = { week: W, groups: { 'Ibis DD': { shifts: [M], need: { [M]: day(0) } } }, people: [P('LONG')], pre: {}, rules: { maxHours: 9 } };
    const cells = { LONG: { [dates[0]]: '08:00 - 19:00' } };
    check('an 11-hour shift is flagged', sb.rbProblems(I, cells).some(p => p.kind === 'long' && p.hours === 11), true);
  }
  // 6. someone who leaves mid-week is not rostered after, and isn't owed a day off
  {
    const pre = { GONE: { [dates[3]]: '—', [dates[4]]: '—', [dates[5]]: '—', [dates[6]]: '—' } };
    const r = solve({ 'Ibis DD': { shifts: [M], need: { [M]: day(1) } } }, [P('GONE'), P('B'), P('C')], pre);
    check('leaver: not on shift after leaving', [3, 4, 5, 6].every(i => r.cells.GONE[dates[i]] === '—'), true);
    check('leaver: no "day off missing" for them', r.problems.some(p => p.key === 'GONE'), false);
  }
  // 8. a day off between night and day shifts
  {
    check('night (00:00 - 09:00) then 08:00 the next day is not allowed', sb.rbSwitchOk(N, M, {}), false);
    check('day then 19:00 - 04:00 the next day is fine (later is easy to follow)', sb.rbSwitchOk(M, '19:00 - 04:00', {}), true);
    check('night then night is fine', sb.rbSwitchOk(N, N, {}), true);
    const r = solve({ 'Ibis DD': { shifts: [N, M, E], need: { [N]: day(1), [M]: day(1), [E]: day(1) } } }, ['A', 'B', 'C', 'D', 'F'].map(k => P(k, { lastShift: k === 'A' ? N : '' })));
    let bad = 0; Object.keys(r.cells).forEach(k => { let prev = k === 'A' ? N : ''; dates.forEach(d => { const v = r.cells[k][d] || ''; if (sb.rbParse(prev) && sb.rbParse(v) && sb.rbIsNight(prev) !== sb.rbIsNight(v)) bad++; prev = v; }); });
    check('a built week never goes night → day or day → night without a day off', bad, 0);
  }
  // 9. only supervisors and duty managers on the 00:00 - 09:00 night
  {
    const G = { 'Ibis DD': { shifts: [N, M], need: { [N]: day(1), [M]: day(1) }, who: { [N]: ['Supervisor', 'Duty Manager'] } } };
    const ppl = [P('SUP', { title: 'Supervisor' }), P('DM', { title: 'Duty Manager' }), P('AG1', { title: 'Agent' }), P('AG2', { title: 'Agent' })];
    const r = solve(G, ppl);
    check('agents are never put on 00:00 - 09:00', ['AG1', 'AG2'].every(k => dates.every(d => r.cells[k][d] !== N)), true);
    check('the nights are covered by the supervisor and the duty manager', r.problems.filter(p => p.kind === 'short' && p.shift === N).length, 0);
    check('a person set to nights only is only on nights', sb.rbSolve({ week: W, groups: G, people: [P('NO', { title: 'Supervisor', allowed: [N] }), ...ppl.slice(1)], pre: {}, rules: { allowOne: true }, seed: 2 }).cells.NO && dates.every(d => { const v = sb.rbSolve({ week: W, groups: G, people: [P('NO', { title: 'Supervisor', allowed: [N] }), ...ppl.slice(1)], pre: {}, rules: { allowOne: true }, seed: 2 }).cells.NO[d]; return v === N || v === 'OFF'; }), true);
  }
  // 7. sick mid-week: cover suggestions that keep the rules
  {
    const G = { 'Ibis DD': { shifts: [M, E], need: { [M]: day(1), [E]: day(1) } } };
    const ppl = ['A', 'B', 'C', 'D'].map(k => P(k));
    const I = { week: W, groups: G, people: ppl, pre: {}, rules: { minRest: 11, maxHours: 9, allowOne: true } };
    const r = sb.rbSolve(Object.assign({ seed: 1 }, I));
    const who = Object.keys(r.cells).find(k => r.cells[k][dates[2]] === M);
    const cells = JSON.parse(JSON.stringify(r.cells)); cells[who][dates[2]] = 'SL';
    I.pre = { [who]: { [dates[2]]: 'SL' } };
    const o = sb.rtCoverOptions(I, cells, 'Ibis DD', dates[2], M);
    check('sick: at least one way to cover', o.length > 0 && !!o[0].cells, true);
    const after = o[0].cells;
    check('sick: the first suggestion fills the shift without new rule breaks', sb.rbProblems(I, after).filter(p => p.kind !== 'thin').length, 0);
  }
  // 7b. nobody fits every rule: an option that bends night ↔ day once, flagged, with the reason; never when a clean option exists
  {
    const G = { 'Ibis DD': { shifts: [N, M], need: { [N]: day(1), [M]: day(1) }, who: { [N]: ['Supervisor'] } } };
    const ppl = [P('S', { title: 'Supervisor' }), P('T', { title: 'Supervisor' }), P('A'), P('B')];
    const cells = { S: {}, T: {}, A: {}, B: {} };
    dates.forEach((dt, d) => { cells.S[dt] = d === 1 ? 'OFF' : M; cells.T[dt] = d === 6 ? 'OFF' : N; cells.A[dt] = d === 2 ? 'OFF' : M; cells.B[dt] = 'OFF'; });
    cells.T[dates[1]] = 'SL';
    const I = { week: W, groups: G, people: ppl, pre: { T: { [dates[1]]: 'SL' } }, rules: { minRest: 11, maxHours: 9, allowOne: true, nightSwitch: true, lend: true } };
    const o = sb.rtCoverOptions(I, cells, 'Ibis DD', dates[1], N);
    // (the night of the 13th starts at midnight after the 13th: S, off that day, takes it; A takes S's morning on the 14th)
    check('night cover: the Supervisor off that day takes the night, a colleague his next morning, every rule kept', o.some(x => x.cells && !x.bend && x.key === 'S'), true);
    { // only way left: 7 h rest (the night ends 09:00, their 16:00 – 01:00 that day is locked)
      const E7 = '16:00 - 01:00', G3 = { 'Ibis DD': { shifts: [N, M, E7], need: { [N]: day(1), [M]: day(1), [E7]: day(1) }, who: { [N]: ['Supervisor'] } } };
      const mk = tl => { const pl = [P('S', { title: 'Supervisor' }), P('T', { title: 'Supervisor' }), P('A'), P('B')].concat(tl ? [P('L', { title: 'Team Leader' })] : []), c = {};
        pl.forEach(p => { c[p.key] = {}; });
        dates.forEach((dt, d) => { c.S[dt] = d === 0 ? M : d === 1 || d === 5 ? 'OFF' : E7; c.T[dt] = d === 6 ? 'OFF' : N; c.A[dt] = d === 4 ? 'OFF' : M; c.B[dt] = d === 5 ? M : E7; if (tl) c.L[dt] = d === 1 || d === 2 ? 'OFF' : M; });
        c.T[dates[1]] = 'SL';
        const I3 = { week: W, groups: G3, people: pl, pre: { T: { [dates[1]]: 'SL' }, S: { [dates[0]]: M, [dates[2]]: E7 }, B: { [dates[0]]: E7, [dates[2]]: E7 } }, rules: { minRest: 11, maxHours: 9, allowOne: true, nightSwitch: true, lend: true } };
        return sb.rtCoverOptions(I3, c, 'Ibis DD', dates[1], N).filter(x => x.cells); };
      const o3 = mk(false);
      check('reception never empty: when only a bend is left (short rest), it is offered and flagged', o3.some(x => x.bend && x.key === 'S' && /rest/.test(x.why || '')), true);
      const ot = mk(true);
      check('night: a Team Leader (rest kept) comes before cutting a Supervisor\'s rest', ot[0] && ot[0].key, 'L');
    }
    { // no Supervisor free for the night: a Team Leader is asked before an agent
      const pl = [P('S', { title: 'Supervisor' }), P('T', { title: 'Supervisor' }), P('L', { title: 'Team Leader' }), P('A')], c = { S: {}, T: {}, L: {}, A: {} };
      dates.forEach((dt, d) => { c.S[dt] = d === 1 ? 'OFF' : M; c.T[dt] = d === 6 ? 'OFF' : N; c.L[dt] = d <= 2 ? 'OFF' : M; c.A[dt] = d <= 2 ? 'OFF' : M; });
      c.S[dates[1]] = 'SL'; c.T[dates[1]] = 'SL';
      const It = { week: W, groups: G, people: pl, pre: { S: { [dates[1]]: 'SL' }, T: { [dates[1]]: 'SL' } }, rules: { minRest: 11, maxHours: 9, allowOne: true, nightSwitch: true, lend: true } };
      const ot = sb.rtCoverOptions(It, c, 'Ibis DD', dates[1], N).filter(x => x.cells);
      check('night with no Supervisor free: a Team Leader first, flagged', [ot[0] && ot[0].key, !!(ot[0] && ot[0].bend && /Team Leader/.test(ot[0].why || ''))].join(), 'L,true');
    }
    const ob = sb.rtCoverOptions(Object.assign({}, I, { groups: { 'Ibis DD · Bell': Object.assign({ post: 'Bell' }, G['Ibis DD']) } }), cells, 'Ibis DD · Bell', dates[1], N);
    check('a bell team may stay short: no rule is bent for it', ob.some(x => x.cells && x.bend), false);
    check('later is fine, earlier is not: day or evening → night next day is fine (rest still checked); night → day needs a day off', [
      sb.rbSwitchOk('12:00 - 21:00', '19:00 - 04:00', {}), sb.rbSwitchOk('15:00 - 00:00', '19:00 - 04:00', {}), sb.rbSwitchOk('00:00 - 09:00', '08:00 - 17:00', { eveNight: true }),
      sb.rbSwitchOk('19:00 - 04:00', '12:00 - 21:00', {}), sb.rbRest('15:00 - 00:00', '00:00 - 09:00'), sb.rbRest('00:00 - 09:00', '08:00 - 17:00') < 0].join(), 'true,true,false,false,24,true');
    // an evening person can cover a night as a last resort, flagged, with the reason
    {
      const E2 = '15:00 - 00:00', L = '19:00 - 04:00';
      const G2 = { 'Ibis DD': { shifts: [M, E2, L], need: { [M]: day(1), [E2]: day(1), [L]: day(1) } } };
      const pp = [P('X'), P('Y'), P('Z'), P('Q')], c = { X: {}, Y: {}, Z: {}, Q: {} };
      dates.forEach((dt, d) => { c.X[dt] = d === 6 ? 'OFF' : M; c.Y[dt] = d === 5 ? 'OFF' : E2; c.Z[dt] = d === 4 ? 'OFF' : L; c.Q[dt] = d === 3 ? 'OFF' : E2; });
      c.Z[dates[2]] = 'SL';
      const I2 = { week: W, groups: G2, people: pp, pre: { Z: { [dates[2]]: 'SL' } }, rules: { minRest: 11, maxHours: 9, allowOne: true, nightSwitch: true, lend: true } };
      const o2 = sb.rtCoverOptions(I2, c, 'Ibis DD', dates[2], L), b = o2.find(x => x.bend);
      check('later is fine: an evening person takes the late night next day, no rule bent', o2.some(x => x.cells && !x.bend && (x.key === 'Y' || x.key === 'Q')), true);
    }
  }
  // 7d. nights across hotels: every night has a Supervisor or above; the regulars' days off line up and one floater does them as a block
  {
    const H = ['Adagio GD', 'Mercure DD', 'Ibis DD'], G = {}, ppl = [];
    H.forEach((h, i) => { G[h] = { shifts: [N, M], need: { [N]: day(1), [M]: day(1) }, who: { [N]: ['Supervisor', 'Duty Manager'] } };
      ppl.push(P('DM' + i, { group: h, title: 'Duty Manager', fixed: N, usual: N, lastShift: N }), P('A' + i, { group: h, usual: M, lastShift: M }), P('B' + i, { group: h, usual: M, lastShift: M })); });
    ppl.push(P('SUP', { group: 'Adagio GD', title: 'Supervisor', usual: M, lastShift: 'OFF' }));
    const r = sb.rbSolve({ week: W, groups: G, people: ppl, pre: {}, rules: { minRest: 11, maxRun: 12, maxHours: 9, allowOne: true, nightSwitch: true, lend: true, givePh: false }, seed: 1 });
    const nightsOk = H.every(h => dates.every(dt => ppl.some(p => { const x = sb.rbParse(r.cells[p.key][dt]); return x && x.s % 1440 === 0 && x.type === 'night' && sb.rbAt({ groups: G }, p, x) === h && /Supervisor|Duty Manager/.test(p.title); })));
    check('nights: every hotel, every night, a Supervisor or above', nightsOk, true);
    check('nights: no rule broken to do it', r.problems.filter(p => p.kind !== 'thin').length, 0);
    check('nights: the plan is written down', (r.notes || []).some(n => /covers the night supervisor's days off/.test(n.text)), true);
  }
  // 7d2. rule "Own Team Leader for night gaps" (tlHome): off, a Supervisor is lent from another hotel as before; on, the hotel's own Team Leader covers
  {
    const H = ['Ibis DD', 'Mercure DD'], G = {}, ppl = [];
    H.forEach((h, i) => { G[h] = { shifts: [N, M], need: { [N]: day(1), [M]: day(1) }, who: { [N]: ['Supervisor', 'Duty Manager'] } };
      ppl.push(P('DM' + i, { group: h, title: 'Duty Manager', fixed: N, usual: N, lastShift: N }), P('A' + i, { group: h, usual: M, lastShift: M }), P('B' + i, { group: h, usual: M, lastShift: M })); });
    ppl.push(P('SUP', { group: 'Mercure DD', title: 'Supervisor', usual: M, lastShift: 'OFF' }), P('TL', { group: 'Ibis DD', title: 'Team Leader', usual: M, lastShift: 'OFF' }));
    const run = tlHome => sb.rbSolve({ week: W, groups: G, people: ppl, pre: {}, rules: Object.assign({ minRest: 11, maxRun: 12, maxHours: 9, allowOne: true, nightSwitch: true, lend: true, givePh: false }, tlHome == null ? {} : { tlHome }), seed: 1 });
    const lent = r => dates.filter(dt => /^00:00 - 09:00 - /.test(r.cells.SUP[dt] || '')).length, tlN = r => dates.filter(dt => sb.rbIsNight(r.cells.TL[dt])).length;
    const covered = r => H.every(h => dates.every(dt => ppl.some(p => { const x = sb.rbParse(r.cells[p.key][dt]); return x && x.type === 'night' && sb.rbAt({ groups: G }, p, x) === h; })));
    const r0 = run(null), r1 = run(false), r2 = run(true);
    check('own TL rule off (default): a Supervisor is lent to the other hotel\'s night, the Team Leader stays on days', [lent(r0) > 0, tlN(r0), JSON.stringify(r0.cells) === JSON.stringify(r1.cells)].join(), 'true,0,true');
    check('own TL rule on: the hotel\'s own Team Leader covers its night gap, nobody lent, every night covered, no problem flagged', [lent(r2), tlN(r2) > 0, covered(r2), r2.problems.filter(p => p.kind !== 'thin').length].join(), '0,true,true,0');
  }
  // 7e. "prefer not": kept off a shift when someone else can do it, still used when it's the only way
  {
    const G = { 'Ibis DD': { shifts: [M, E], need: { [M]: day(1), [E]: day(1) } } };
    const base = { week: W, groups: G, pre: {}, rules: { minRest: 11, maxRun: 12, maxHours: 9, allowOne: true, givePh: false, lend: true }, seed: 1 };
    const r1 = sb.rbSolve(Object.assign({}, base, { people: [P('A', { soft: [E] }), P('B'), P('C')] }));
    check('prefer not: kept off it when others can do it', dates.filter(d => r1.cells.A[d] === E).length, 0);
    const r2 = sb.rbSolve(Object.assign({}, base, { people: [P('A', { soft: [E], offs: 1 }), P('B', { allowed: [M] })] }));
    check('prefer not: still used when it is the only way to cover', r2.problems.filter(p => p.kind === 'short').length <= 2 && dates.some(d => r2.cells.A[d] === E), true);
  }
  // 7c. Duty Managers work anywhere; Supervisors too, but only after everyone else
  check('floats: Duty Manager yes, Supervisor last, Agent no', [sb.rbFloats({ title: 'Duty Manager' }), sb.rbFloatsLast({ title: 'Supervisor' }), sb.rbFloats({ title: 'Agent' }) || sb.rbFloatsLast({ title: 'Agent' })].join(), 'true,true,false');
  {
    const I = { rules: { lend: false } };
    check('floats: with everyone kept home, a Duty Manager or Supervisor can still help another hotel; an Agent stays', [sb.rtStays(I, { group: 'Mercure DD', title: 'Duty Manager' }, 'Ibis DD'), sb.rtStays(I, { group: 'Mercure DD', title: 'Supervisor' }, 'Ibis DD'), sb.rtStays(I, { group: 'Mercure DD', title: 'Agent' }, 'Ibis DD'), sb.rtStays(I, { group: 'Mercure DD', title: 'Duty Manager', home: true }, 'Ibis DD')].join(), 'false,false,true,true');
  }
  // 8. "put B on mornings": band request keeps B on morning shifts, and keep = the old week changes little
  {
    const G = { 'Ibis DD': { shifts: [M, E], need: { [M]: day(1), [E]: day(1) } } };
    const ppl = ['A', 'B', 'C', 'D'].map(k => P(k));
    const base = sb.rbSolve({ week: W, groups: G, people: ppl, pre: {}, rules: { minRest: 11, maxHours: 9, allowOne: true }, seed: 1 }).cells;
    check('shift type: morning band holds only morning shifts', JSON.stringify(sb.rbBandShifts([M, E, N, D9], 'morning')), JSON.stringify([M, D9]));
    check('shift type: night band', JSON.stringify(sb.rbBandShifts([M, E, N], 'night')), JSON.stringify([N]));
    const avoid = { B: {} }; dates.forEach(d => { avoid.B[d] = [E]; });
    const r = sb.rbSolve({ week: W, groups: G, people: ppl, pre: {}, avoid, keep: base, rules: { minRest: 11, maxHours: 9, allowOne: true }, seed: 1 });
    check('shift type: B never on evenings', dates.some(d => r.cells.B[d] === E), false);
    check('shift type: rules still kept', r.problems.filter(p => p.kind !== 'thin').length, 0);
    const same = sb.rbSolve({ week: W, groups: G, people: ppl, pre: {}, keep: base, rules: { minRest: 11, maxHours: 9, allowOne: true }, seed: 3 }).cells;
    check('keep: nothing asked, nothing changes', ['A', 'B', 'C', 'D'].reduce((n, k) => n + dates.filter(d => same[k][d] !== base[k][d]).length, 0), 0);
  }  // 9. two on the desk: 08–17 and 12–21 overlap 12–17; a spare person goes where someone would be alone
  {
    const A = '07:00 - 16:00', B = '12:00 - 21:00', O = '19:00 - 04:00';
    const g = sb.rbDeskGrid([M, '12:00 - 21:00', O], (d, x) => (x === M || x === '12:00 - 21:00' || x === O ? 1 : 0), () => 0);
    check('desk: 08–17 + 12–21 = two at 12:00–17:00', [11, 12, 16, 17].map(h => g[1][h]).join(','), '1,2,2,1');
    check('desk: a 19–04 shift is on the desk after midnight the next day', g[1][2], 1);
    check('desk: the week starts with nobody before the first night', g[0][2], 0);
    const G = { 'Ibis DD': { shifts: [A, B], need: { [A]: day(1), [B]: day(1) } } };
    const r = sb.rbSolve({ week: W, groups: G, people: ['A', 'B', 'C'].map(k => P(k, { offs: 0 })), pre: {}, rules: { minRest: 11, maxHours: 9, allowOne: true, deskMin: 2, deskFrom: 6, deskTo: 18 }, seed: 1 });
    // ("0 days off" is not allowed: each still has one, so 4 spare shifts a week, not 7)
    const onA = dates.filter(d => ['A', 'B', 'C'].filter(k => r.cells[k][d] === A).length === 2).length, onB = dates.filter(d => ['A', 'B', 'C'].filter(k => r.cells[k][d] === B).length === 2).length;
    check('desk: the spare person goes where someone would be alone (07–16 when the aim is 06:00–18:00)', [onA >= 3, onB].join(), 'true,0');
    check('desk: everyone still has a day off', ['A', 'B', 'C'].every(k => dates.some(d => !sb.rbParse(r.cells[k][d]))), true);
  }

}

// ── Team health (roster-health.js) ───────────────────────
{
  const sb = { console: { log() {}, warn() {}, error() {} }, localStorage: { getItem() { return null; }, setItem() {} }, fbSet() {}, showToast() {}, escapeHtml: x => String(x),
               document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; } }, window: {}, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, navigator: {} };
  vm.createContext(sb);
  for (const f of ['roster.js', 'roster-build.js', 'roster-team.js', 'roster-health.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  vm.runInContext(`
    var M = '08:00 - 17:00', E = '15:00 - 00:00', N = '23:00 - 08:00';
    roStaff.A = { name: 'Anna Lee', group: 'Ibis DD' }; roStaff.B = { name: 'Sam Reed', group: 'Ibis DD' }; roStaff.C = { name: 'Lina Park', group: 'Ibis DD' }; roStaff.Z = { name: 'Omar Hale', group: 'Ibis DD' };
    rhWindow().forEach((dt, i) => {
      const wd = i % 7;
      roDays[dt] = { A: wd >= 5 ? 'OFF' : M,                        // easy: weekends off, mornings
                     B: wd === 2 ? 'OFF' : wd % 2 ? E : M,           // evening then morning: short rest, no weekends
                     C: i % 9 === 8 ? 'OFF' : N };                   // long stretches of nights
    });
  `, sb);
  const run = js => vm.runInContext(js, sb);
  const H = run('rhAll()');
  check('health: someone with weekends off and good rest is thriving', H.A.grade[1], 'Thriving');
  check('health: evening → morning shows as short rest', H.B.M.find(m => m.id === 'rest').s < 70 && H.B.worst.some(m => m.id === 'rest'), true);
  check('health: 8 days in a row is flagged', H.C.M.find(m => m.id === 'run').s < 70, true);
  check('health: the weakest person scores lower than the strongest', H.A.score > H.B.score && H.A.score > H.C.score, true);
  check('health: no roster yet means no score, not a bad one', !!H.Z.none, true);
  check('health: the card and the team view render', run(`rhPersonHtml('B').includes('What would help') && rhTeamHtml(['Ibis DD']).includes('Team health') && rhBadge('A').includes('rh-ring')`), true);
}

// ── Public holidays, Duty Managers, meetings (roster-holidays.js, roster-events.js) ──
{
  const sb = { console: { log() {}, warn() {}, error() {} }, localStorage: { getItem() { return null; }, setItem() {} }, fbSet() {}, showToast() {}, escapeHtml: x => String(x), confirm: () => true, prompt: () => null,
               document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; } }, window: {}, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, navigator: {},
               TextDecoder, TextEncoder, atob: s => Buffer.from(s, 'base64').toString('binary') };
  vm.createContext(sb);
  for (const f of ['roster.js', 'roster-build.js', 'roster-team.js', 'roster-holidays.js', 'roster-events.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  const run = js => vm.runInContext(js, sb);
  run(`
    var M = '08:00 - 17:00', E = '15:00 - 00:00';
    roStaff.A = { name: 'Anna Lee', group: 'Ibis DD' }; roStaff.B = { name: 'Sam Reed', group: 'Ibis DD' }; roStaff.C = { name: 'Lina Park', group: 'Mercure DD' }; roStaff.D = { name: 'Omar Hale', group: 'Mercure DD' };
    roToday = () => '2026-03-25';
    ['2026-03-16','2026-03-17','2026-03-18','2026-03-19','2026-03-20','2026-03-21','2026-03-22'].forEach((dt, i) => { roDays[dt] = Object.assign({ A: dt === '2026-03-19' ? 'OFF' : M, B: E, C: M }, dt >= '2026-03-21' ? { D: E } : {}, dt >= '2026-03-20' ? { F: 'OFF' } : {}); });
    roStaff.F = { name: 'Rita Moss', group: 'Ibis DD' };
    rbPeople = { D: { joined: '2026-03-21' } };
  `);
  check('holidays: Eid shows as a question while it is near, not before', run(`[hdPending('2026-02-20').length, hdPending('2026-03-05').map(h => h.name).join()].join('|')`), '0|Eid Al Fitr');
  check('holidays: nothing counts before you say yes', run(`rbPhOwed('A').owed`), 0);
  run(`hdAccept(hdPending('2026-03-05')[0].id)`);
  check('holidays: after yes, everyone on the team earns them (also on their day off); new people from the day they joined', run(`['A','B','C','D','F'].map(k => rbPhOwed(k).owed).join()`), '3,3,3,1,2');
  check('holidays: answered once, not asked again', run(`hdPending('2026-03-05').length`), 0);
  run(`roDays['2026-03-23'] = { A: 'PH - 19th Mar.' }; rbStampReset();`);   // the app saves through fbSet, which does this
  check('holidays: a PH on a posted roster comes off the balance, oldest first', run(`[rbPhOwed('A').owed, rbPhOwed('A').label].join()`), '2,20th Mar.');
  run(`rbSettings.phEarn = 'worked';`);
  check('holidays: "only who works it" mode', run(`['A','B'].map(k => rbPhOwed(k).owed).join()`), '1,3');
  run(`rbSettings.phEarn = 'all'; hdReject(hdList().find(h => h.name === 'Arafat Day' && h.dates[0].startsWith('2026')).id);`);
  check('holidays: "not a PH" is remembered', run(`hdPending('2026-05-10').map(h => h.name).join()`), 'Eid Al Adha');
  check('holidays: any year is worked out on the device (2030: Eid Al Fitr from the Hijri calendar)', run(`hdComputeYear(2030).map(h => h[0] + ' ' + h[2]).join(' | ')`), "2030-01-01 New Year's Day | 2030-02-04 Eid Al Fitr | 2030-04-12 Arafat Day | 2030-04-13 Eid Al Adha | 2030-05-04 Hijri New Year | 2030-07-13 Prophet's Birthday | 2030-12-02 National Day");
  check('holidays: the worked-out dates match the announced ones (2027)', run(`JSON.stringify(hdComputeYear(2027).map(h => h[0])) === JSON.stringify(HD_REGIONS.AE.days[2027].map(h => h[0]).sort())`), true);
  check('holidays: next year is there already in December', run(`(() => { const t = roToday; roToday = () => '2029-12-10'; const ok = hdList().some(h => h.dates[0] === '2030-01-01'); roToday = t; return ok; })()`), true);

  // Managers / Asst. Managers: one is enough for all the hotels, so their days off are spread
  run(`
    roToday = () => '2026-10-07'; rbSettings = {}; roDays = {}; rbPeople = {};
    var W = '2026-10-12', DM = '09:00 - 18:00';
    ['Ibis DD', 'Mercure DD'].forEach((g, gi) => { for (let i = 0; i < 4; i++) roStaff[g[0] + i] = { name: 'P' + g[0] + i, group: g, order: i }; });
    delete roStaff.A; delete roStaff.B; delete roStaff.C; delete roStaff.D;
    rbPeople.I0 = { title: 'Asst. Manager' }; rbPeople.M0 = { title: 'Asst. Manager' };
    rbSettings.groups = {};
  `);
  const dm = run(`(() => { rbWeek = W; const I = rbInput(3); I.people.filter(p => rbMgrP(p)).forEach(p => { p.prefOff = [5]; }); const r = rbSolve(I); const ds = Array.from({ length: 7 }, (_, d) => roAdd(W, d)); return ds.filter(dt => !['I0','M0'].some(k => rbParse(r.cells[k][dt]))).length + '|' + rbMgrGap(I, r.cells, ds, I.rules); })()`);
  check('managers: never both off on the same day, even when both ask for Saturday (one covers all hotels)', dm, '0|0');
  check('managers: Duty Managers are not counted as managers', run(`rbMgrP({ title: 'Duty Manager' }) + '|' + rbMgrP({ title: 'Asst. Manager' }) + '|' + rbMgrP({ title: 'Manager' })`), 'false|true|true');
  check('managers: with the rule off they may share a day off', run(`(() => { rbWeek = W; const I = rbInput(3); I.rules.mgrMin = 0; return rbMgrGap(I, { I0: {}, M0: {} }, [W], I.rules); })()`), 0);

  // Meetings: reading Outlook
  run(`roToday = () => '2026-10-08'; rbPeople = {}; roStaff = { A: { name: 'Anna Lee', group: 'Ibis DD' }, B: { name: 'Sam Reed', group: 'Ibis DD' }, C: { name: 'Lina Park', group: 'Ibis DD' }, D: { name: 'Sam Cole', group: 'Ibis DD' } };`);
  const ics = 'BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:abc-123\r\nSUMMARY:Fire safety\r\n  training\r\nDTSTART;TZID=Arabian Standard Time:20261013T100000\r\nDTEND;TZID=Arabian Standard Time:20261013T113000\r\nLOCATION:Meeting room 2\r\nORGANIZER;CN=Training Team:mailto:training@example.com\r\nATTENDEE;CN=Anna Lee;ROLE=REQ-PARTICIPANT:mailto:anna.lee@example.com\r\nATTENDEE;CN="Reed, Sam":mailto:sam.reed@example.com\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const ri = run(`evParse(${JSON.stringify(ics)})`);
  check('outlook: invite (.ics) → title, day, time, place, people', [ri.title, ri.date, ri.from, ri.to, ri.where, ri.keys.sort().join('+'), ri.kind, ri.uid].join('|'), 'Fire safety training|2026-10-13|10:00|11:30|Meeting room 2|A+B|training|abc-123');
  const eml = 'From: Front Office Manager <fom@example.com>\nTo: Lina Park <lina.park@example.com>, "Sam Cole" <sam.cole@example.com>\nSubject: =?utf-8?B?TW9udGhseSBicmllZmluZw==?=\nMIME-Version: 1.0\nContent-Type: multipart/alternative; boundary="b1"\n\n--b1\nContent-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: quoted-printable\n\nWhen: Thursday, 15 October 2026 3:00 PM-4:00 PM (UTC+04:00) Abu Dhabi, Muscat=0AWhere: Lobby lounge\n--b1--\n';
  const re = run(`evParse(${JSON.stringify(eml)})`);
  check('outlook: email (.eml, encoded subject, quoted-printable) → meeting', [re.title, re.date, re.from, re.to, re.where, re.keys.sort().join('+'), re.kind].join('|'), 'Monthly briefing|2026-10-15|15:00|16:00|Lobby lounge|C+D|meeting');
  const rp = run(`evParse('Hi all, Anna and Lina have the induction on 20/10/2026 from 9am to 1pm in the training room')`);
  check('outlook: pasted text, day/month/year, 9am to 1pm, first names', [rp.date, rp.from, rp.to, rp.keys.sort().join('+'), rp.kind].join('|'), '2026-10-20|09:00|13:00|A+C|training');
  check('outlook: "Sam" alone is not guessed when two people are called Sam', run(`evParse('Sam has a meeting tomorrow at 3 pm').keys.length + '|' + evParse('Sam has a meeting tomorrow at 3 pm').date + '|' + evParse('Sam has a meeting tomorrow at 3 pm').from`), '0|2026-10-09|15:00');
  check('outlook: a forwarded email: the Sent: date is not the meeting day', run(`(() => { const r = evParse('From: Anna Lee\\nSent: Monday, October 12, 2026 9:14 AM\\nSubject: FW: Audit meeting\\n\\nPlease join the audit meeting on 22 October 2026 at 14:30.'); return [r.title, r.date, r.from].join('|'); })()`), 'Audit meeting|2026-10-22|14:30');
  check('outlook: a cancelled invite is recognised', run(`evParse('Subject: Canceled: Monthly briefing\\nWhen: 15 Oct 2026 15:00').cancel`), true);
  // a real .msg (Compound File) built here, with small streams in the mini stream like Outlook writes them
  const u16 = str => Buffer.from(str, 'utf16le');
  const streams = [['__substg1.0_0037001F', u16('Duty manager meeting')], ['__substg1.0_1000001F', u16('When: Monday, October 19, 2026 11:00 AM-12:00 PM\r\nWhere: GM office\r\nAll duty managers please attend.')], ['__substg1.0_0E04001F', u16('Lee, Anna; Park, Lina')]];
  const SS = 512, MS = 64, mini = [], mfat = [], ents = [];
  streams.forEach(([n, b]) => { const start = mini.length / MS; const pad = Math.ceil(b.length / MS) * MS; const buf = Buffer.alloc(pad); b.copy(buf); for (let i = 0; i < pad / MS; i++) mfat.push(i === pad / MS - 1 ? 0xFFFFFFFE : start + i + 1); mini.push(...buf); ents.push({ n, type: 2, start, size: b.length }); });
  const miniBuf = Buffer.from(mini), miniSecs = Math.ceil(miniBuf.length / SS);
  const fat = [0xFFFFFFFD, 0xFFFFFFFE, 0xFFFFFFFE]; for (let i = 0; i < miniSecs; i++) fat.push(i === miniSecs - 1 ? 0xFFFFFFFE : 4 + i);
  ents.unshift({ n: 'Root Entry', type: 5, start: 3, size: miniBuf.length });
  const file = Buffer.alloc(SS * (4 + miniSecs), 0);
  Buffer.from('D0CF11E0A1B11AE1', 'hex').copy(file, 0); file.writeUInt16LE(0x3E, 24); file.writeUInt16LE(3, 26); file.writeUInt16LE(0xFFFE, 28); file.writeUInt16LE(9, 30); file.writeUInt16LE(6, 32);
  file.writeUInt32LE(1, 44); file.writeUInt32LE(1, 48); file.writeUInt32LE(4096, 56); file.writeUInt32LE(2, 60); file.writeUInt32LE(1, 64); file.writeUInt32LE(0xFFFFFFFE, 68); file.writeUInt32LE(0, 72);
  for (let i = 0; i < 109; i++) file.writeUInt32LE(i === 0 ? 0 : 0xFFFFFFFF, 76 + i * 4);
  for (let i = 0; i < SS / 4; i++) file.writeUInt32LE(i < fat.length ? fat[i] : 0xFFFFFFFF, SS + i * 4);
  ents.forEach((e, i) => { const o = SS * 2 + i * 128, nm = Buffer.from(e.n + '\0', 'utf16le'); nm.copy(file, o); file.writeUInt16LE(nm.length, o + 64); file[o + 66] = e.type; file.writeUInt32LE(0xFFFFFFFF, o + 68); file.writeUInt32LE(0xFFFFFFFF, o + 72); file.writeUInt32LE(0xFFFFFFFF, o + 76); file.writeUInt32LE(e.start, o + 116); file.writeUInt32LE(e.size, o + 120); });
  for (let i = 0; i < SS / 4; i++) file.writeUInt32LE(i < mfat.length ? mfat[i] : 0xFFFFFFFF, SS * 3 + i * 4);
  miniBuf.copy(file, SS * 4);
  sb._msg = Uint8Array.from(file);
  const rm = run(`(() => { const b = new Uint8Array(_msg).buffer; const r = evParse(evMsgText(b)); return [evIsCfb(b), r.title, r.date, r.from, r.to, r.where, r.keys.sort().join('+')].join('|'); })()`);
  check('outlook: a saved Outlook email (.msg) is read', rm, 'true|Duty manager meeting|2026-10-19|11:00|12:00|GM office|A+C');

  // Meetings in the builder
  run(`
    roDays = {}; rbPeople = {}; rbSettings = { groups: {} }; roStaff = {};
    for (let i = 0; i < 6; i++) roStaff['S' + i] = { name: 'Staff ' + 'ABCDEF'[i] + ' Test', group: 'Ibis DD', order: i };
    W = '2026-10-12';
    evAll = { e1: { title: 'Briefing', kind: 'meeting', plan: 'cover', date: '2026-10-14', from: '10:00', to: '11:00', keys: ['S0', 'S1'] },
              e2: { title: 'Course', kind: 'training', plan: 'away', date: '2026-10-15', until: '2026-10-16', keys: ['S2'] } };
  `);
  const sh = run(`rbGroupCfg('Ibis DD').shifts.join('|')`);
  const rb = run(`(() => { rbWeek = W; const I = rbInput(1); const r = rbSolve(I); return [r.cells.S0['2026-10-14'], r.cells.S1['2026-10-14'], r.cells.S2['2026-10-15'], r.cells.S2['2026-10-16']].join('|'); })()`).split('|');
  const covers = v => run(`evCoverShifts([${JSON.stringify(v)}], '10:00', '11:00').length`) === 1;
  check('meetings: on shift at that time, never their day off', [covers(rb[0]), covers(rb[1])].join(), 'true,true');
  check('meetings: an away training day is TRN', rb.slice(2).join(), 'TRN,TRN');
  check('meetings: the shifts that cover 10:00–11:00 are found', run(`evCoverShifts(['07:00 - 16:00', '15:00 - 00:00', '23:00 - 08:00'], '10:00', '11:00').join()`) + ' · ' + sh.length, '07:00 - 16:00 · ' + sh.length);
  check('meetings: a meeting that falls outside their posted shift is flagged', run(`(() => { roDays['2026-10-14'] = { S0: '15:00 - 00:00' }; return evCheck(evAll.e1).length; })()`), 1);
}

// ── The background builder (roster-worker.js) gives the same week as the page ──
{
  const out = [];
  const wk = { console: { log() {}, warn() {}, error() {} }, setTimeout: () => 0, clearTimeout() {}, Date, Math, JSON };
  wk.self = wk; wk.postMessage = m => out.push(m);
  wk.importScripts = (...fs) => fs.forEach(f => vm.runInContext(fs_read(f), wk, { filename: f }));
  function fs_read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
  vm.createContext(wk);
  vm.runInContext(fs_read('roster-worker.js'), wk, { filename: 'roster-worker.js' });
  // the page side, to make the input
  const pg = { console: { log() {}, warn() {}, error() {} }, localStorage: { getItem() { return null; }, setItem() {} }, fbSet() {}, showToast() {}, escapeHtml: x => String(x),
               document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; } }, window: {}, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, navigator: {} };
  vm.createContext(pg);
  for (const f of ['roster.js', 'roster-build.js', 'roster-team.js']) vm.runInContext(fs_read(f), pg, { filename: f });
  const data = JSON.parse(vm.runInContext(`(() => {
    const M = '08:00 - 17:00', E = '15:00 - 00:00', N = '00:00 - 09:00';
    ['Anna Lee', 'Sam Reed', 'Lina Park', 'Omar Hale', 'Rita Moss'].forEach((n, i) => { roStaff['K' + i] = { name: n, group: 'Ibis DD', order: i }; });
    const W0 = roAdd(roMonday(new Date()), -7);
    for (let d = 0; d < 7; d++) roDays[roAdd(W0, d)] = { K0: d === 0 ? 'OFF' : M, K1: d === 1 ? 'OFF' : E, K2: d === 2 ? 'OFF' : M, K3: d === 3 ? 'OFF' : N, K4: d === 4 ? 'OFF' : E };
    rbWeek = roAdd(W0, 14);
    const I = rbInput(1);
    return JSON.stringify({ I, roDays, roStaff, roCodes, rbPeople, rbSettings, page: rbSolve(I).cells });
  })()`, pg));
  wk.onmessage({ data: { id: 7, I: data.I, roDays: data.roDays, roStaff: data.roStaff, roCodes: data.roCodes, rbPeople: data.rbPeople, rbSettings: data.rbSettings } });
  const m = out[0] || {};
  check('background builder: loads and answers', [m.id, m.ok, m.error || ''].join('|'), '7|true|');
  check('background builder: the same week as building on the page', JSON.stringify(m.res && m.res.cells), JSON.stringify(data.page));
}

// ── Rate Shop (rates.js) ─────────────────────────────────
{
  const sb = { console: { log() {}, warn() {}, error() {} }, localStorage: { getItem() { return null; }, setItem() {} }, fbSet() {}, showToast() {}, escapeHtml: x => String(x),
               document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; } }, window: {}, setTimeout: () => 0 };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'rates.js'), 'utf8'), sb, { filename: 'rates.js' });
  const run = js => vm.runInContext(js, sb);
  check('rate shop: our three hotels to start with', run(`rkHotels().map(h => h.name).join(' | ')`), 'Ibis Styles Dubai Deira | Mercure Dubai Deira | Adagio Dubai Deira');
  run(`var h = { id: 'ibis', name: 'Ibis Styles Dubai Deira', comps: [{ id: 'a', name: 'Hotel A' }, { id: 'b', name: 'Hotel B' }, { id: 'c', name: 'Hotel C' }, { id: 'd', name: 'Hotel D' }] };
       rkPrices = { '2026-10-20': { ibis: { us: { r: 300 }, a: { r: 250 }, b: { r: 280 }, c: { r: 320 }, d: { r: 400 } } } };`);
  check('rate shop: market median, lowest, highest, our difference and place', run(`(() => { const M = rkMarket(h, '2026-10-20'); return [M.n, M.med, M.min, M.max, Math.round(M.diff * 1000) / 10, M.rank, M.of].join(); })()`), '4,300,250,400,0,3,5');
  check('rate shop: no prices = no comparison (not zero)', run(`(() => { const M = rkMarket(h, '2026-10-21'); return [M.n, M.diff === undefined].join(); })()`), '0,true');
  run(`rkSetup = {}; rkSaveHotel(Object.assign({}, rkHotels()[0], { comps: [{ id: 'x', name: 'Hotel X' }] }));`);
  check('rate shop: changing one keeps all three of ours', run(`rkHotels().length + '|' + rkHotels()[0].comps.length`), '3|1');
}

// ── Dropping files: Vicas exports go to one question together ──
{
  const sb = { console: { log() {}, warn() {}, error() {} }, document: { addEventListener() {}, getElementById() { return null }, querySelector() { return null }, body: { classList: { toggle() {} } } }, window: {}, setTimeout: () => 0 };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'file-router.js'), 'utf8'), sb, { filename: 'file-router.js' });
  const d = (n, h) => JSON.stringify(sb.frDetect(n, h));
  check('drop: Vicas transaction XML is asked about (Purpose first)', d('Vicas_V2.xml', '<Field FieldName="{usp_RPTTransactionReport;1.Nationality}">'), JSON.stringify({ dest: null, ask: 'vicas', prefer: ['origin', 'itXml'] }));
  check('drop: Arrival Today Vicas XML is recognised by its fields too', JSON.parse(d('report.xml', '<Field FieldName="{Command.Nationality}">')).ask, 'vicas');
  check('drop: a DTCM portal XML still goes straight to DTCM', JSON.parse(d('HotelTransactionReport_Dynamic_5.xml', '')).dest, 'dtcm');
  check('drop: Purpose takes several Origin XML files at once', vm.runInContext('!!FR_DEST.origin.multi', sb), true);
}

// ── Team history (team-log.js): a posted week writes down the wishes it granted ──
{
  const sent = [];
  const sb = { console: { log() {}, warn() {}, error() {} }, localStorage: { getItem() { return null; }, setItem() {} }, fbSet: (p, v) => sent.push(p), showToast: m => sent.push('toast:' + m), escapeHtml: x => String(x),
               document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; } }, window: {}, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, navigator: {} };
  vm.createContext(sb);
  for (const f of ['roster.js', 'roster-build.js', 'roster-team.js', 'team-log.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  const run = js => vm.runInContext(js, sb);
  run(`
    var W = '2026-10-12', M = '07:00 - 15:00', E = '15:00 - 23:00';
    roStaff.A = { name: 'Anna Lee', group: 'Ibis DD' }; roStaff.B = { name: 'Sam Reed', group: 'Ibis DD' };
    rbPeople.A = { likes: [M] }; rbPeople.B = { prefOff: [5, 6] };
    var cells = { A: {}, B: {} }; for (let d = 0; d < 7; d++) { const dt = roAdd(W, d); cells.A[dt] = d === 2 ? 'OFF' : M; cells.B[dt] = d === 5 ? 'OFF' : E; }
    tlWeekPosted(W, cells);
  `);
  check('history: a posted week writes the wishes it granted, person by person', run(`tlOf('A').filter(e => e.t === 'wish').length + '|' + tlList(e => e.t === 'posted').length`), '1|1');
  check('history: you are told which wishes were granted', sent.some(x => /^toast:💛 .*granted/.test(x) && /Anna/.test(x)), true);
  check('history: posting the same week again does not write it twice', run(`tlWeekPosted(W, cells); tlList(e => e.t === 'posted').length + '|' + tlOf('A').filter(e => e.t === 'wish').length`), '1|1');
  check('history: shows on the card and in the builder', run(`tlPersonHtml('A').includes('History') && tlTeamHtml().includes('Wish granted')`), true);
  // the builder carries on from the posted roster only: a draft that was never posted is not history
  run(`roDays = {}; var P0 = '2026-10-05'; for (let d = 0; d < 7; d++) roDays[roAdd(P0, d)] = { A: d === 6 ? '15:00 - 23:00' : M, B: E };
    rbDrafts = { [W]: { cells: { A: { [roAdd(W, 6)]: '23:00 - 07:00' } } } }; rbStampReset();`);
  check('posted roster: next week follows the posted one, not an unposted draft', run(`[rbLearnPerson('A', W).lastShift, rbLearnPerson('A', roAdd(W, 7)).lastShift || 'none'].join('|')`), '15:00 - 23:00|none');
  check('posted roster: the builder says what it builds on, and warns when last week is not posted', run(`rbWeek = W; const a = rbBaseHtml(); rbWeek = roAdd(W, 7); const b = rbBaseHtml(); [/Builds on the posted roster/.test(a), /isn't posted yet/.test(b) && /only a draft/.test(b)].join()`), 'true,true');
}

// ── Vacation balance (roster-vacation.js) ──────────────────
{
  const sb = { console: { log() {}, warn() {}, error() {} }, localStorage: { getItem() { return null; }, setItem() {} }, fbSet() {}, showToast() {}, escapeHtml: x => String(x),
               document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; } }, window: {}, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, navigator: {} };
  vm.createContext(sb);
  for (const f of ['roster.js', 'roster-build.js', 'roster-team.js', 'roster-vacation.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  const run = js => vm.runInContext(js, sb);
  run(`
    roStaff.A = { name: 'Anna Lee', group: 'Ibis DD' };
    rbPeople.A = { joined: '2026-01-01', absences: { x: { from: '2026-08-01', to: '2026-08-05', code: 'AL' }, y: { from: '2026-06-10', to: '2026-06-10', code: 'SL' } } };
    ['2026-03-02', '2026-03-03', '2026-03-04', '2026-08-01'].forEach(dt => { roDays[dt] = { A: 'AL' }; });
    roDays['2026-03-05'] = { A: 'SL' }; roDays['2026-03-06'] = { A: 'ALP' };
  `);
  check('vacation: AL, ALA and VAC count; sick, PH and pending leave do not', run(`['AL','ALA','VAC','AL - 3 days','SL','PH','ALP','OFF'].map(vcIsAL).join(',')`), 'true,true,true,true,false,false,false,false');
  check('vacation: 30 a year earned from joining, used days off, booked days (each day once) counted apart', run(`const b = vcBalance('A', '2026-07-01'); [b.now, b.used, b.booked, b.after].join('|')`), '12|3|5|7');
  check('vacation: a balance from HR counts on from the next day', run(`rbPeople.A.vacBal = { n: 20, at: '2026-07-02' }; vcBalance('A', '2026-07-01').now + '|' + vcBalance('A', '2026-08-01').now`), '20|21.5');
  check('vacation: days a year can be set for one person', run(`rbPeople.A.vacYear = 22; vcRate('A')`), 22);
  check('vacation: Ops Brain answers "vacation balance of Anna" and "how many vacation days does Anna have"', run(`!!_vcMatch('vacation balance of Anna') && !!_vcMatch('how many vacation days does Anna have') && !_vcMatch('Anna is sick tomorrow')`), true);
  check('vacation: shows on the card and in the builder', run(`vcPersonHtml('A').includes('vacation days today') && vcTeamHtml().includes('Anna Lee')`), true);
}

// ── Rules: levels and your own rules (roster-build.js, roster-rules.js) ──
{
  const sb = { console: { log() {}, warn() {}, error() {} }, localStorage: { getItem() { return null; }, setItem() {} }, fbSet() {}, showToast() {}, escapeHtml: x => String(x),
               document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; } }, window: {}, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, navigator: {} };
  vm.createContext(sb);
  for (const f of ['roster.js', 'roster-build.js', 'roster-team.js', 'roster-rules.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  const run = js => vm.runInContext(js, sb);
  // 📋 someone away: the last week they were away shows how management ran it, and it is copied
  run(`roDays = {}; var P5 = '2026-10-05'; for (let d = 0; d < 7; d++) roDays[roAdd(P5, d)] = { V: 'ALA', Y: d === 2 ? 'OFF' : '12:00 - 21:00', Z: '08:00 - 17:00' }; rbStampReset();
    var Ilb = { week: '2026-10-12', groups: { 'Adagio GD': { shifts: ['08:00 - 17:00', '12:00 - 21:00'], need: { '08:00 - 17:00': [1,1,1,1,1,1,1], '12:00 - 21:00': [2,2,2,2,2,2,2] } } },
      people: ['V', 'Y', 'Z'].map(k => ({ key: k, group: 'Adagio GD', title: '' })), pre: { V: { '2026-10-12': 'AL', '2026-10-13': 'AL', '2026-10-14': 'AL' } }, rules: {} };
    rbLikeBefore(Ilb);`);
  check('like before: cover on those days is what management ran (12–21 had 1, and 0 on the day it was off), the same people, the same days off', run(`[Ilb.groups['Adagio GD'].need['12:00 - 21:00'].join(''), Ilb.keep.Y['2026-10-12'], Ilb.keep.Y['2026-10-14'], !!Ilb.likeBefore].join('|')`), '1102222|12:00 - 21:00|OFF|true');
  check('levels: as always by default, Off = 0, Must counts more', run(`[rbW({}, 'fair'), rbW({ levels: { fair: 0 } }, 'fair'), rbW({ levels: { fair: 4 } }, 'fair') > 2].join()`), '1,0,true');
  check('levels: own hotel and same hours are Very important by default (move people as little as possible)', run(`[rbW({}, 'home'), rbW({}, 'steady'), rbW({ levels: { steady: 2 } }, 'steady')].join()`), '2.5,2.5,1');
  run(`
    var W = '2026-10-12', M = '07:00 - 15:00', E = '15:00 - 23:00', dates = [0,1,2,3,4,5,6].map(d => roAdd(W, d)), day = n => Array(7).fill(n);
    var P = (key, x) => Object.assign({ key, group: 'Ibis DD', offs: 1, fixed: '', usual: '', allowed: null, prefOff: [], lastShift: '', run: 0, lastOffs: [], phOwed: 0, title: '' }, x);
    var G = { 'Ibis DD': { shifts: [M, E], need: { [M]: day(2), [E]: day(2) } } };
    var ppl = [P('A'), P('B'), P('C'), P('D'), P('T', { title: 'Trainee' })];
    var solve = custom => rbSolve({ week: W, groups: G, people: ppl, pre: {}, rules: { minRest: 11, maxRun: 12, maxHours: 9, allowOne: true, givePh: false, lend: true, custom }, seed: 1 });
    var same = (c, a, b) => dates.filter(dt => c[a][dt] && c[a][dt] === c[b][dt] && rbParse(c[a][dt])).length;
    var apart = solve([{ t: 'apart', a: 'A', b: 'B', level: 4 }]), withR = solve([{ t: 'with', a: 'C', b: 'D', level: 4 }]);
  `);
  check('own rule: "A and B never on the same shift" is kept', run(`same(apart.cells, 'A', 'B')`), 0);
  check('own rule: "C always with D" — on days both work, the same shift', run(`dates.filter(dt => rbParse(withR.cells.C[dt]) && rbParse(withR.cells.D[dt]) && withR.cells.C[dt] !== withR.cells.D[dt]).length`), 0);
  run(`var G2 = { 'Ibis DD': { shifts: [M, '23:00 - 07:00'], need: { [M]: day(1), ['23:00 - 07:00']: day(1) } } };
    var tn = rbSolve({ week: W, groups: G2, people: [P('A'), P('B'), P('T', { title: 'Trainee' })], pre: {}, rules: { minRest: 11, maxRun: 12, maxHours: 9, allowOne: true, givePh: false, custom: [{ t: 'titleNo', title: 'Trainee', shift: 'night', level: 4 }] }, seed: 1 });`);
  check('own rule: "Trainees never on nights" is kept', run(`dates.filter(dt => rbIsNight(tn.cells.T[dt])).length`), 0);
  run(`roStaff.S1 = { name: 'Sam Reed', group: 'Ibis DD' }; roStaff.L1 = { name: 'Lina Park', group: 'Ibis DD' }; roStaff.R1 = { name: 'Rita Moss', group: 'Ibis DD' };`);
  check('say it: "Sam and Lina never on the same shift"', run(`JSON.stringify(rrParseSay('Sam and Lina never on the same shift'))`), JSON.stringify({ t: 'apart', a: 'S1', b: 'L1' }));
  check('say it: "Rita always with Lina"', run(`JSON.stringify(rrParseSay('Rita always with Lina'))`), JSON.stringify({ t: 'with', a: 'R1', b: 'L1' }));
  check('say it: "trainees never on nights"', run(`JSON.stringify(rrParseSay('trainees never on nights'))`), JSON.stringify({ t: 'titleNo', title: 'Trainee', shift: 'night' }));
  check('say it: other commands are left alone ("swap Sam with Lina")', run(`rrParseSay('swap Sam with Lina')`), null);
  check('apart: overlapping shifts count as together (09–18 and 12–21), back to back does not (07–15 and 15–23)', run(`const R = { custom: [{ t: 'apart', a: 'A', b: 'B', level: 4 }] }, d = [W];
    const I = { week: W, groups: G, people: ppl };
    [rbMineBroken(I, { A: { [W]: '09:00 - 18:00' }, B: { [W]: '12:00 - 21:00' } }, d, R).length, rbMineBroken(I, { A: { [W]: M }, B: { [W]: E } }, d, R).length].join()`), '1,0');
  check('never at the same hotel: different shifts on the same day still count (07–15 and 15–23), other hotels or a day off do not', run(`(() => { const R = { custom: [{ t: 'apartHotel', a: 'A', b: 'B', level: 4 }] }, d = [W];
    const I = { week: W, groups: Object.assign({}, G, { 'Mercure DD': { shifts: [M, E], need: { [M]: day(1), [E]: day(1) } } }), people: ppl };
    return [rbMineBroken(I, { A: { [W]: M }, B: { [W]: E } }, d, R).length, rbMineBroken(I, { A: { [W]: M }, B: { [W]: E + ' - Mercure' } }, d, R).length, rbMineBroken(I, { A: { [W]: M }, B: { [W]: 'OFF' } }, d, R).length].join(); })()`), '1,0,0');
  check('say it: "Sam and Lina never in the same hotel", "Sam can\'t be at the same property as Lina"', run(`['Sam and Lina never in the same hotel', "Sam can't be at the same property as Lina"].map(q => (rrParseSay(q) || {}).t).join()`), 'apartHotel,apartHotel');
  check('say it: "avoid Sam with Lina", "Sam and Lina never together", "Sam can\'t work with Lina"', run(`['avoid Sam with Lina', 'Sam and Lina never together', "Sam can't work with Lina"].map(q => (rrParseSay(q) || {}).t).join()`), 'apart,apart,apart');
  run(`var N = '23:00 - 07:00', G3 = { 'Ibis DD': { shifts: [M, E, N], need: { [M]: day(1), [E]: day(1), [N]: day(1) } } };
    var nightsOf = (care, lvl) => { const pp = ['A', 'B', 'C', 'D'].map(k => P(k, k === 'C' && care ? { care: 2, careScore: 45 } : {})); const r = rbSolve({ week: W, groups: G3, people: pp, pre: {}, rules: { minRest: 11, maxRun: 12, maxHours: 9, allowOne: true, givePh: false, levels: lvl || {} }, seed: 2 }); return { n: dates.filter(dt => rbIsNight(r.cells.C[dt])).length, notes: r.notes || [] }; };`);
  check('extra care: someone close to breaking gets no more nights than before, and it is written down', run(`const a = nightsOf(false), b = nightsOf(true); [b.n <= a.n, b.notes.some(x => x.care && /Extra care/.test(x.text))].join()`), 'true,true');
  check('extra care: switched Off in Rules, nothing changes', run(`nightsOf(true, { care: 0 }).notes.some(x => x.care)`), false);
}

// ── 🌐 Languages (i18n.js) ────────────────────────────────
{
  const sb = { console, hoPrefs: { lang: 'ar' }, document: { documentElement: { style: {} } } };
  vm.createContext(sb); vm.runInContext(fs.readFileSync(path.join(ROOT, 'i18n.js'), 'utf8'), sb, { filename: 'i18n.js' });
  check('languages: a menu word, a greeting with a name, and an unknown word left alone', vm.runInContext(`[hoT('Home'), hoT('Good morning, Sam'), hoT('Good morning, Sam', 'fr'), String(hoT('Room 512')), hoT('Home', 'en')].join(' | ')`, sb),
    'الرئيسية | صباح الخير، Sam | Bonjour, Sam | null | Home');
  check('languages: every word has all six translations', vm.runInContext(`Object.entries(HO_T).filter(([k, v]) => v.length !== 6 || v.some(x => !x)).map(([k]) => k).join()`, sb), '');
}
// ── 🎮 Live desk and looks (roster-live.js) ───────────────
{
  const sb = { console: { log() {}, warn() {}, error() {} }, localStorage: { getItem() { return null; }, setItem() {} }, fbSet() {}, showToast() {}, escapeHtml: x => String(x),
               document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; } }, window: {}, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, navigator: {} };
  vm.createContext(sb);
  for (const f of ['roster.js', 'roster-build.js', 'roster-team.js', 'roster-live.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  const run = js => vm.runInContext(js, sb);
  run(`roStaff.A = { name: 'Lina Park', group: 'Ibis DD' }; roStaff.B = { name: 'Omar Hale', group: 'Ibis DD' }; roStaff.C = { name: 'Rita Moss', group: 'Mercure DD' };
    var T = '2026-10-12'; roDays[T] = { A: '12:00 - 21:00', B: '19:00 - 04:00', C: '08:00 - 17:00 - Ibis' }; roToday = () => T;`);
  check('live desk: who is on at 19:30 and 2 h together (Lina 12–21, Omar 19–04)', run(`const S = lvScene(roDate(T).getTime() + (19 * 60 + 30) * 6e4).find(x => x.g === 'Ibis DD'); S.on.map(x => x.key).sort().join()`), 'A,B');
  check('live desk: a day at another hotel shows at that hotel', run(`lvScene(roDate(T).getTime() + 10 * 36e5).find(x => x.g === 'Ibis DD').on.map(x => x.key).join()`), 'C');
  check('live desk: coming in next', run(`lvScene(roDate(T).getTime() + 18 * 36e5).find(x => x.g === 'Ibis DD').coming.map(x => x.key).join()`), 'B');
  check('looks: picked on the card, never guessed; a cartoon for everyone', run(`rbPeople.A = { look: { hair: 'hijab', skin: 4 } }; [avLook('A').hair, avLook('A').skin, avLook('B').skin, /<svg/.test(avSvg('B', 40))].join()`), 'hijab,4,2,true');
  check('live desk + app: nothing loaded, nothing to show', run(`JSON.stringify(lvOpsRead(Date.now()))`), '{"dep":null,"arr":null,"inh":null,"wa":null,"hb":null,"rh":null,"st":null,"brain":null}');
  check('live desk + app: departures, WhatsApp and handover read as they are (read only)', run(`var depRooms = [{ room: 101, status: 'out' }, { room: 102, status: 'due' }, { room: 103, status: 'extended' }, { room: 104, status: 'late' }];
    function depCounts() { return { all: 4, out: 1, extended: 1 }; } function isLcoOverdue(r) { return r.room === 104; }
    window.hoWaBridge = { log: () => [{ at: 5, sender: 'Desk Bot', text: '104 lco 2pm', res: [{ st: 'lco', room: '104' }] }, { at: 6, mine: true, text: 'ok' }] };
    window.hoHandoverBook = { items: () => [{ key: 'a', status: 'open', text: 'Iron for 233' }, { key: 'b', status: 'done' }, { key: 'c', status: 'open', chat: 1 }] };
    const O = lvOpsRead(Date.now()); [O.dep.out + '/' + O.dep.total, O.dep.late.join(), O.dep.lco, O.wa.n, _lvSay(O.wa.list[0].r), O.hb.open + ' open ' + O.hb.done + ' done', depRooms.map(r => r.status).join()].join(' | ')`),
    '1/3 | 104 | 1 | 1 | ⏰ Late check-out · 104 | 1 open 1 done | out,due,extended,late');
}

// ── Ops Brain understands plain talk (brain-understand.js) ──
{
  const sb = { console: { log() {}, warn() {}, error() {} }, localStorage: { getItem() { return null; }, setItem() {} }, fbSet() {}, showToast() {}, escapeHtml: x => String(x),
               document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; } }, window: {}, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, navigator: {} };
  vm.createContext(sb);
  for (const f of ['roster.js', 'roster-build.js', 'roster-team.js', 'brain-understand.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  const run = js => vm.runInContext(js, sb);
  run(`[['S', 'Tariq Benson', 'Adagio GD'], ['A', 'Omar Zaki Malik', 'Adagio GD'], ['H', 'Hadi Saleh', 'Ibis DD'], ['M', 'Maya Rai', 'Ibis DD'], ['L', 'Lina Park', 'Mercure DD']].forEach(([k, n, g]) => { roStaff[k] = { name: n, group: g }; });`);
  const say = q => run(`(u => (u.sure ? 'DO ' : 'ASK ') + (u.cmd || u.options.map(o => o.cmd).join(' / ')))(buUnderstand(${JSON.stringify(q)}))`);
  check('plain talk: "can u keep tariq away from mr omar pls"', say('can u keep tariq away from mr omar pls'), 'DO avoid Tariq Benson with Omar Zaki Malik');
  check('plain talk: "hadi not coming tmrw" (typo)', say('hadi not coming tmrw'), 'DO Hadi Saleh is sick tomorrow');
  check('plain talk: "maya dont want nights anymore"', say('maya dont want nights anymore'), 'DO Maya Rai prefers not nights');
  check('plain talk: "how many vacation days left for lina"', say('how many vacation days left for lina'), 'DO vacation balance of Lina Park');
  check('plain talk: "who is working now"', say('who is working now'), 'DO who is on now');
  check('plain talk: "make next week roster"', say('make next week roster'), 'DO build the roster');
  check('plain talk: a misspelt name ("tarq and omar never together")', say('tarq and omar never together'), 'DO avoid Tariq Benson with Omar Zaki Malik');
  check('plain talk: "dont send lina to ibis"', say('dont send lina to ibis'), 'DO never send Lina Park to Ibis DD');
  check('plain talk: a guest or a room is never a change to the team ("Mr Hadi in 512 is sick")', run(`buUnderstand('Mr Hadi in 512 is sick').options.length`), 0);
  check('plain talk: "Mr Hadi is sick" asks first (could be a guest)', say('Mr Hadi is sick'), 'ASK Hadi Saleh is sick today');
  check('plain talk: a plain question is left to Ops Brain ("how do I post TD")', run(`buUnderstand('how do I post TD').options.length`), 0);
  run(`roStaff.SB = { name: 'Samira Testa', group: 'Adagio GD' }; roToday = () => '2026-10-10'; roCanEdit = () => true; _rtOut = () => {};`);
  check('dates: "15" and "the 15th" are the next 15th', run(`[rtDay('15'), rtDay('the 15th'), rtDay('until 5')].join()`), '2026-10-15,2026-10-15,2026-11-05');
  check('plain talk: "samira on vaction until 15" books vacation today → 15th', run(`const u = buUnderstand('samira on vaction until 15'); RT_COMMANDS.find(c => c.re.test(u.cmd)).run(u.cmd); JSON.stringify(Object.values(rbPeople.SB.absences).map(a => [a.from, a.to, a.code]))`), JSON.stringify([['2026-10-10', '2026-10-15', 'AL']]));
  run(`for (let d = 0; d < 7; d++) { const dt = roAdd('2026-10-05', d); roDays[dt] = Object.assign({}, roDays[dt], { SB: d === 6 ? 'OFF' : d >= 4 ? 'ALA' : '12:00 - 21:00' }); } rbPeople.SB = {}; rtApplyPublished = () => true; rbStampReset();`);
  check('leave: a day off or leave already posted stays as it is; only working days change', run(`const t = rtMarkAbsent('SB', '2026-10-08', '2026-10-15', 'AL', true); [t.changed.join(' '), t.kept.join(' ')].join(' | ')`), '2026-10-08 | 2026-10-09 2026-10-10 2026-10-11');
  { const sh15 = run(`(rbGroupCfg('Adagio GD').shifts || []).find(s => s.startsWith('15:00')) || ''`);
    check('fixed shift by typing: "samira always 15:00" / "always 3pm" / "any shift"', run(`JSON.stringify([rtStaticShiftParse('samira always 15:00'), rtStaticShiftParse('samira always on 3pm'), rtStaticShiftParse('samira any shift'), rtStaticShiftParse('samira always off on friday')].map(x => x && [x.k, x.shift]))`), JSON.stringify([sh15 ? ['SB', sh15] : null, sh15 ? ['SB', sh15] : null, ['SB', ''], null])); }
  check('plain talk: "until 15 oct" is the end date, not the start', say('samira is on vacation until 15 oct'), 'DO Samira Testa is on vacation today until 15 oct');
  check('plain talk: "how to …" shows how and asks before doing it', say('how to keep samira on vaction until 15 ?'), 'ASK Samira Testa is on vacation today until 15');
  check('plain talk: learns what you meant', run(`const c = buRead('put tariq far from omar'); buLearn(c, 'apart'); buUnderstand('put lina far from maya').cmd`), 'avoid Lina Park with Maya Rai');
}

// ── What if… (roster-team.js) ─────────────────────────────
{
  const sb = { console: { log() {}, warn() {}, error() {} }, localStorage: { getItem() { return null; }, setItem() {} }, fbSet() {}, showToast() {}, escapeHtml: x => String(x),
               document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; } }, window: {}, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, navigator: {} };
  vm.createContext(sb);
  for (const f of ['roster.js', 'roster-build.js', 'roster-team.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  vm.runInContext(`
    var W = roAdd(roMonday(new Date()), 7), M = '08:00 - 17:00', E = '15:00 - 00:00';
    const NM = { A: 'Anna Lee', B: 'Bilal Khan', C: 'Carla Diaz', D: 'Dmitri Sokolov', F: 'Stanley Okafor' };
    ['A', 'B', 'C', 'D', 'F'].forEach((k, i) => { roStaff[k] = { name: NM[k], group: 'Ibis DD', order: i }; });
    for (const base of [roAdd(W, -7), W]) for (let d = 0; d < 7; d++) {
      const dt = roAdd(base, d);
      roDays[dt] = { A: d === 0 ? 'OFF' : M, B: d === 1 ? 'OFF' : E, C: d === 2 ? 'OFF' : d % 2 ? M : E, D: d === 3 ? 'OFF' : d % 2 ? E : M, F: d === 4 ? 'OFF' : d === 5 ? 'AL' : d % 2 ? M : E };
    }
    roCanEdit = () => true;
  `, sb);
  const run = js => vm.runInContext(js, sb);
  run(`rbSettings.rules = Object.assign({}, rbSettings.rules, { overlapMin: 0 })`);   // two the whole shift: one person alone is a gap
  const r = run(`rtWhatIf({ key: 'A', kind: 'sick', from: roAdd(W, 2), to: roAdd(W, 3) })`);
  check('what if: a sick person leaves gaps that are listed', r.gaps.length > 0, true);
  check('what if: plans are offered', r.plans.length > 0, true);
  check('what if: the best plan breaks no rule', r.plans[0].bad.length, 0);
  check('what if: no plan puts the sick person back to work', r.plans.every(p => [2, 3].every(d => p.cells.A[run(`roAdd(W, ${d})`)] === 'SL')), true);
  check('what if: leave in the roster is never moved', r.plans.every(p => p.cells.F[run('roAdd(W, 5)')] === 'AL'), true);
  const n = run(`rtWhatIf({ key: 'A', kind: 'notshift', from: roAdd(W, 4), shift: M })`);
  check("what if: \"not on that shift\" never puts them on it", n.plans.every(p => p.cells.A[run('roAdd(W, 4)')] !== run('M')), true);
  const idle = run(`rtWhatIf({ key: 'A', kind: 'sick', from: W })`);
  check('what if: sick on their day off needs nothing', !!idle.idle, true);
  // the Ops Brain reads the question
  run(`var _last = null; rtWhatIf = (function (f) { return function (q) { _last = q; return f(q); }; })(rtWhatIf); _rtOut = () => {};`);
  const ask = q => { run(`RT_COMMANDS.find(c => c.re.test(${JSON.stringify(q)})).run(${JSON.stringify(q)})`); return run('_last'); };
  const q1 = ask('what if Anna is sick for 2 days');
  check('brain: "sick for 2 days" = two days from today', [q1.kind, q1.from === run('roToday()'), q1.to === run('roAdd(roToday(), 1)')].join(), 'sick,true,true');
  const q2 = ask('what if Bilal takes Monday next week off');
  check('brain: "takes Monday next week off" = that Monday, off', [q2.kind, q2.from === run('W'), q2.to === run('W')].join(), 'off,true,true');
  const q3 = ask("what if Carla isn't on 08-17 on Friday next week");
  check('brain: "isn\'t on 08-17" = not on that shift', [q3.kind, q3.shift, q3.from === run('roAdd(W, 4)')].join(), 'notshift,08:00 - 17:00,true');
  const q4 = ask('what if Dmitri is on leave next week');
  check('brain: "on leave next week" = the whole week', [q4.kind, q4.from === run('W'), q4.to === run('roAdd(W, 6)')].join(), 'leave,true,true');
  // bell boys: rostered on their own shifts, never front desk cover
  const t1 = ask0 => { run(`RT_COMMANDS.find(c => c.re.test(${JSON.stringify(ask0)})).run(${JSON.stringify(ask0)})`); };
  t1('stanly and dmitry are bell bits');
  check('brain: "X and Y are bell bits" sets Bell Boy (typos too)', run("[rbTitle('F'), rbTitle('D')].join()"), 'Bell Boy,Bell Boy');
  run("rbSetPerson('D', 'title', '')");
  const bell = run(`(() => { rbWeek = W; const I = rbInput(1), res = rbSolve(I), dates = [0, 1, 2, 3, 4, 5, 6].map(d => roAdd(W, d)), F = I.people.find(p => p.key === 'F');
    const desk = dates.some(dt => { const x = rbParse(res.cells.F[dt]); return x && !rbAt(I, F, x).includes(' · '); });
    const gap = res.problems.find(p => p.group === 'Ibis DD' && p.kind === 'short') || { date: dates[3], shift: Object.keys(I.groups['Ibis DD'].need)[0] };
    const sugg = rtCoverOptions(I, res.cells, 'Ibis DD', gap.date, gap.shift).some(o => o.key === 'F');
    return { groups: Object.keys(I.groups).join('|'), fGroup: F.group, desk, sugg }; })()`);
  check('bell: the hotel gets its own bell cover', bell.groups, 'Ibis DD|Ibis DD · Bell');
  check('bell: a bell boy is in the bell team', bell.fGroup, 'Ibis DD · Bell');
  check('bell: a bell boy never counts as front desk', bell.desk, false);
  check('bell: a bell boy is never suggested for a desk gap', bell.sugg, false);
  check('bell: "what if the bell boy is sick" needs no cover', run(`(() => { rbSetPerson('F', 'title', 'Bell Boy'); const dt = [0, 1, 2, 3, 4, 5, 6].map(d => roAdd(W, d)).find(d => rbParse((roDays[d] || {}).F)); const r = rtWhatIf({ key: 'F', kind: 'sick', from: dt }); return r.gaps.length + ':' + (r.plans[0] ? Math.round(r.plans[0].cover * 100) : 'x'); })()`), '0:100');
  run("rbSetPerson('F', 'title', '')");
  // 🔒 managers keep their shift; 🏨 people (or everyone) stay at their hotel
  run(`roStaff.G = { name: 'Gina Morales', group: 'Mercure DD', order: 9 }; roStaff.H = { name: 'Hugo Brandt', group: 'Mercure DD', order: 10 };
       for (const base of [roAdd(W, -7), W]) for (let d = 0; d < 7; d++) { const dt = roAdd(base, d); roDays[dt].G = d === 6 ? 'OFF' : '09:00 - 18:00'; roDays[dt].H = d === 5 ? 'OFF' : '09:00 - 18:00'; }
       rbSetPerson('A', 'title', 'Manager'); rbSetPerson('G', 'title', 'Supervisor');`);
  const lk = run(`(() => { rbWeek = W; const I = rbInput(1), A = I.people.find(p => p.key === 'A'), res = rbSolve(I), dates = [0, 1, 2, 3, 4, 5, 6].map(d => roAdd(W, d));
    const moved = dates.some(dt => rbParse(res.cells.A[dt]) && rbNorm(res.cells.A[dt]) !== A.fixed);
    const gap = { date: dates[3], shift: '15:00 - 00:00' };
    const optA = rtCoverOptions(I, res.cells, 'Ibis DD', gap.date, gap.shift).some(o => o.key === 'A');
    // (with Mercure's desk still covered without her: H on the same shift that day. Lending G when she is all Mercure has is never offered — a desk is never left empty)
    const spare = JSON.parse(JSON.stringify(res.cells)), prevD = dates[2]; ['G', 'H'].forEach(k => { spare[k][prevD] = '09:00 - 18:00'; spare[k][gap.date] = '09:00 - 18:00'; });
    const borrowG = rtCoverOptions(I, spare, 'Ibis DD', gap.date, '08:00 - 17:00').some(o => o.key === 'G');
    const lastOne = rtCoverOptions(I, res.cells, 'Ibis DD', gap.date, '08:00 - 17:00').some(o => o.key === 'G' && rbDesk(I, Object.assign({}, res.cells, { G: Object.assign({}, res.cells.G, { [gap.date]: '' }) }), 'Mercure DD')[3].some((c, h) => !c && h >= 15));
    rbSetPerson('G', 'home', true);
    const I2 = rbInput(1), homeG = rtCoverOptions(I2, res.cells, 'Ibis DD', gap.date, '08:00 - 17:00').some(o => o.key === 'G');
    rbSetPerson('G', 'home', undefined); rbSetRule('lend', false);
    const I3 = rbInput(1), allHome = rtCoverOptions(I3, res.cells, 'Ibis DD', gap.date, '08:00 - 17:00').some(o => o.key === 'H');   // H is an agent: never borrowed (G is a Supervisor: may still go where nobody else can)
    rbSetRule('lend', true);
    return { lock: A.lock, fixed: A.fixed, moved, optA, borrowG, lastOne, homeG, allHome }; })()`);
  check('lock: a manager keeps their shift by default', [lk.lock, lk.fixed].join(), 'true,08:00 - 17:00');
  check('lock: the builder never moves a manager off it', lk.moved, false);
  check('lock: a manager is never suggested to cover', lk.optA, false);
  check('lock: a Supervisor from another hotel can be borrowed normally (her own desk stays covered)', lk.borrowG, true);
  check('desk: never lent away when she is the only one keeping her own desk covered', lk.lastOne, false);
  check('lock: 🏨 someone who stays at their hotel is never borrowed', lk.homeG, false);
  check('lock: "keep everyone in their own hotel" stops all borrowing', lk.allHome, false);
  const lp = q => { const r = run(`rtLockParse(${JSON.stringify(q)})`); return r ? r.mode + ':' + r.keys.join('') : 'none'; };
  const sp = q => { const r = run(`rtSoftParse(${JSON.stringify(q)})`); return r ? (r.undo ? 'undo:' : '') + r.keys.join('') + ':' + (r.band || r.shift) : 'none'; };
  check('brain: prefer-not phrases', [sp('Gina prefers not nights'), sp('try to avoid evenings for Hugo'), sp('Gina can do nights again'), sp('the guest prefers not the 5th floor')].join(' '), 'G:night H:evening undo:G:night none');
  check('brain: lock phrases', [lp('lock Gina in her hotel'), lp('keep Hugo on his shift'), lp('Gina stays at Mercure'), lp('unlock gina'), lp('the guest stays in room 512'), lp('lock Gina in room 4')].join(' '), 'home:G shift:H home:G un:G none none');
  // autocomplete
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'brain-complete.js'), 'utf8'), sb, { filename: 'brain-complete.js' });
  const sug = q => run(`bcSuggest(${JSON.stringify(q)}, 6).map(x => x.q)`);
  check('autocomplete: "what if gi" offers what-ifs for Gina', sug('what if gi').every(x => /^what if Gina/.test(x)) && sug('what if gi').length > 0, true);
  check('autocomplete: words cut short, in order ("put hu nig")', sug('put hu nig')[0], 'put Hugo on nights next week');
  check('autocomplete: "keep every" → keep everyone in their own hotel', sug('keep every')[0], 'keep everyone in their own hotel');
  check('autocomplete: made-up example names never show', sug('sam').some(x => /\bSam\b/.test(x)), false);
  // review fixes: Ops Brain never takes a guest's sentence as a staff command
  run(`roStaff.ALI = { name: 'Ali', group: 'Ibis DD', order: 20 };`);
  check('names: "Khalid" is not Ali, "Mr Bilal" is a guest, "who" is nobody', run(`[rtFind('Khalid'), rtFind('Mr Bilal'), rtFind('who'), rtFind('the guest in 512')].map(x => x || '-').join()`), '-,-,-,-');
  check('names: real names still found', run(`[rtFind('Ali'), rtFind('bilal'), rtFind('Carla Diaz')].join()`), 'ALI,B,C');
  const takes = q => run(`RT_COMMANDS.some(c => c.re.test(${JSON.stringify(q)}))`);
  const guest = ['Mr Bilal is sick, send doctor to 512', 'breakfast starts at 6:30', 'the conference starts at 9am tomorrow', 'swap room 512 and 514', 'who can do late checkout for 512', 'who can take the airport pickup', 'pillow cover issues in 512', 'arrivals last week', 'nationality history', 'how many guests on vacation', 'who is the manager', 'Mr Bilal stays at the hotel', 'what if the guest is late'];
  check('brain: guest and room sentences are left to the rest of Ops Brain', guest.filter(takes).join(' | '), '');
  const staffQ = ['Bilal is sick tomorrow', 'Ali wants Friday off', 'swap Bilal and Carla on Tue', 'who can cover nights on Wed', 'roster problems', 'Carla last week', 'what if Anna is sick tomorrow', 'put Anna on mornings next week', 'put Anna or Carla on day shifts this week', 'Bilal is a supervisor', 'lock Gina in her hotel', 'add new staff Rosa Diaz to Ibis'];
  check('brain: staff commands still work', staffQ.filter(q => !takes(q)).join(' | '), '');
  run(`delete roStaff.ALI;`);
  // review fixes: the builder
  check('groups: a hotel name with " · " is not a bell team', run(`rbBaseGroup('Rove · Downtown') + '|' + rbBaseGroup('Ibis DD · Bell')`), 'Rove · Downtown|Ibis DD');
  check('groups: hotels sharing a first word are told apart', run(`[rbShortU('Ibis DD', ['Ibis DD', 'Ibis GD']), rbShortU('Adagio GD', ['Adagio GD', 'Ibis DD']), rbNoteGroup('Ibis GD', ['Ibis DD', 'Ibis GD']), rbNoteGroup('Adagio', ['Adagio GD', 'Ibis DD'])].join()`), 'Ibis DD,Adagio,Ibis GD,Adagio GD');
  check('problems: a person with no row in the draft does not crash', run(`(() => { rbWeek = W; const I = rbInput(1); try { rbProblems(I, {}); rtCoverOptions(I, {}, 'Ibis DD', roAdd(W, 3), I.groups['Ibis DD'].shifts[0]); return 'ok'; } catch (e) { return e.message; } })()`), 'ok');
  check('PH is never given on a fixed day', run(`(() => { rbWeek = W; const I = rbInput(1); const A = I.people.find(p => p.key === 'B'); A.phOwed = 1; A.phLabel = 'test'; const d = roAdd(W, 0); I.pre = Object.assign({}, I.pre, { B: { [d]: '15:00 - 00:00' } }); I.groups['Ibis DD'].need['15:00 - 00:00'] = [0, 0, 0, 0, 0, 0, 0]; const r = rbSolve(I); return r.cells.B[d]; })()`), '15:00 - 00:00');
  check('PH balance: 1 a week by default (last option), oldest label first, never leaving a shift short', run(`(() => { rbWeek = W; const I = rbInput(1); const A = I.people.find(p => p.key === 'B'); A.phOwed = 3; A.phLabels = ['1st Jan.', '2nd Jan.', '3rd Jan.']; A.phLabel = '1st Jan.'; Object.keys(I.groups['Ibis DD'].need).forEach(s => I.groups['Ibis DD'].need[s] = [0, 0, 0, 0, 0, 0, 0]); const r = rbSolve(I); const ph = Object.values(r.cells.B).filter(v => /^PH/.test(v || '')).sort(); const short = r.problems.filter(p => p.kind === 'short').length; return ph.length + '|' + ph.join(',') + '|' + short; })()`), '1|PH - 1st Jan.|0');
  check('PH balance: only 1 person a week per hotel gets a PH (the biggest balance)', run(`(() => { rbWeek = W; const I = rbInput(1); ['A','B','C'].forEach((k, i) => { const p = I.people.find(x => x.key === k); if (p) { p.phOwed = i + 1; p.phLabels = ['x']; } }); Object.keys(I.groups['Ibis DD'].need).forEach(s => I.groups['Ibis DD'].need[s] = [0, 0, 0, 0, 0, 0, 0]); const r = rbSolve(I); return ['A','B','C'].filter(k => r.cells[k] && Object.values(r.cells[k]).some(v => /^PH/.test(v || ''))).join(); })()`), 'C');
  check('PH balance: set to 2 a week, oldest label first, never leaving a shift short', run(`(() => { rbWeek = W; const I = rbInput(1); I.rules.phMax = 2; const A = I.people.find(p => p.key === 'B'); A.phOwed = 3; A.phLabels = ['1st Jan.', '2nd Jan.', '3rd Jan.']; A.phLabel = '1st Jan.'; Object.keys(I.groups['Ibis DD'].need).forEach(s => I.groups['Ibis DD'].need[s] = [0, 0, 0, 0, 0, 0, 0]); const r = rbSolve(I); const ph = Object.values(r.cells.B).filter(v => /^PH/.test(v || '')).sort(); const short = r.problems.filter(p => p.kind === 'short').length; return ph.length + '|' + ph.join(',') + '|' + short; })()`), '2|PH - 1st Jan.,PH - 2nd Jan.|0');
  check('night times: 00:00 on a day is that day\'s night (after its 15:00 – 00:00), so evening → night next day is a full day of rest', run(`[rbRest('15:00 - 00:00', '00:00 - 09:00'), rbRest('00:00 - 09:00', '00:00 - 09:00'), rbRest('00:00 - 09:00', '15:00 - 00:00')].join()`), '24,15,6');
  check('posted week: two on one hotel\'s night and nobody at the other → one of them was covering it (for learning)', run(`(() => {
    const save = {}, N = '00:00 - 09:00', W2 = roAdd(W, 70), dts = rtDates(W2);
    Object.assign(roStaff, { NA: { name: 'Nat Ames', group: 'Ibis DD' }, NB: { name: 'Ned Bose', group: 'Ibis DD' }, NC: { name: 'Nia Cole', group: 'Mercure DD' } });
    dts.forEach((dt, d) => { roDays[dt] = { NA: N, NB: d < 2 ? N : 'OFF', NC: d < 2 ? 'SL' : N }; });
    const r = rbDayRead(dts[0]), q = rbDayRead(dts[3]);
    dts.forEach(dt => delete roDays[dt]); ['NA', 'NB', 'NC'].forEach(k => delete roStaff[k]);
    return [r.NA, r.NB, q === q && q.NC].join(' | ');
  })()`), '00:00 - 09:00 | 00:00 - 09:00 - Mercure DD | 00:00 - 09:00');
  run(`roStaff.NOH = { name: 'Nora Hale', order: 30 };`);
  check('groups: someone with no hotel set is still rostered', run(`rbGroups().includes('')`), true);
  run(`delete roStaff.NOH;`);
  // two people editing the same draft: each save sends only its own cells, and a change arriving
  // while an edit waits to be sent keeps both
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8').match(/function fbApplyPatch[\s\S]*?\n}\n/)[0], sb);
  // 💛 wishes: the builder grants them when cover allows
  check('wishes: a liked shift, a day off wished for, days off together', run(`(() => {
    rbWeek = W;
    const count = (I, k, f) => rtDates(W).filter(dt => f(rbSolve(I).cells[k][dt])).length;
    const base = rbInput(1), shifts = base.groups['Ibis DD'].shifts, E = shifts[shifts.length - 1];
    const plain = (() => { const I = rbInput(1); const r = rbSolve(I); return rtDates(W).filter(dt => r.cells.C[dt] === E).length; })();
    const I1 = rbInput(1); I1.people.find(p => p.key === 'C').likes = [E];
    const liked = rtDates(W).filter(dt => rbSolve(I1).cells.C[dt] === E).length;
    const I2 = rbInput(1); const pC = I2.people.find(p => p.key === 'C'); pC.prefOff = [3]; pC.offs = 2; pC.together = true;
    const r2 = rbSolve(I2), offs = rtDates(W).map((dt, d) => rbKind(r2.cells.C[dt]) === 'off' ? d : -1).filter(d => d >= 0);
    const happy = rbWishes(I2, pC, r2.cells, rtDates(W));
    return [liked >= plain, offs.includes(3), offs.some((d, i) => i && d - offs[i - 1] === 1), happy.length === 2].join();
  })()`), 'true,true,true,true');
  check('fair over weeks: a wish not granted last week counts more this week', run(`(() => {
    rbWeek = W; rbSetPerson('A', 'prefOff', [3]);   // last week Anna was off on Monday, not Thursday
    const I = rbInput(1), a = I.people.find(p => p.key === 'A'), b = I.people.find(p => p.key === 'B');
    rbSetPerson('A', 'prefOff', undefined);
    return [a.wishDebt > 0, rbWishWeight(a) > 1, rbWishWeight(b) === 1, typeof a.wkOffShort === 'number'].join();
  })()`), 'true,true,true,true');
  check('night → one day off → morning is found (and two days off is fine)', run(`(() => {
    const dts = rtDates(W), N = '00:00 - 09:00', Mo = '07:00 - 16:00', p = { key: 'X', lastShift: '' };
    const one = { X: { [dts[0]]: N, [dts[1]]: 'OFF', [dts[2]]: Mo } }, two = { X: { [dts[0]]: N, [dts[1]]: 'OFF', [dts[2]]: 'OFF', [dts[3]]: Mo } };
    return rbNightToMorning(one, p, dts).length + ',' + rbNightToMorning(two, p, dts).length;
  })()`), '1,0');
  check('learning: usual days off, weekly rotation, and the week after the latest posted', run(`(() => {
    const next = roAdd(W, 7), L = rbLearnPerson('A', next);   // Anna: off on Monday in both posted weeks
    // Rita rotates by week (posted by a manager, three weeks: mornings, evenings, mornings)
    const M = '08:00 - 17:00', E = '15:00 - 00:00', wks = [roAdd(W, -7), W, next];
    roStaff.R = { name: 'Rita Moss', group: 'Ibis DD' };
    const save = {}; wks.forEach((w, i) => rtDates(w).forEach((dt, d) => { save[dt] = roDays[dt]; roDays[dt] = Object.assign({}, roDays[dt], { R: d === 6 ? 'OFF' : [M, E, M][i] }); }));
    const R = rbLearnPerson('R', roAdd(next, 7));
    const def = rbDefaultWeek();
    Object.keys(save).forEach(dt => { if (save[dt]) roDays[dt] = save[dt]; else delete roDays[dt]; }); delete roStaff.R;
    return [L.learnedOff.join(), R.rotates, R.nextMain === E, def === roAdd(next, 7)].join(' ');
  })()`), '0 true true true');
  check('drafts: a save sends only the changed cells', run(`JSON.stringify(rbDraftDiff({ cells: { A: { d1: 'M', d2: 'E' }, B: { d1: 'OFF' } }, at: 1 }, { cells: { A: { d1: 'M', d2: 'OFF' }, C: { d1: 'E' } }, at: 2 }))`),
    JSON.stringify({ 'cells/A/d2': 'OFF', 'cells/B': null, 'cells/C/d1': 'E', at: 2 }));
  check('drafts: my waiting edit and a colleague\'s edit both stay', run(`(() => {
    rbDraftsIn({ [W]: { cells: { A: { d1: 'M' }, B: { d1: 'E' } } } });
    rbWeek = W; rbDrafts[W].cells.A.d1 = 'OFF'; _rbSaving[W] = 1;           // I change Anna, not sent yet
    rbDraftsIn({ [W]: { cells: { A: { d1: 'M' }, B: { d1: 'M' } } } });     // meanwhile a colleague changes Bilal
    const shown = rbDrafts[W].cells.A.d1 + rbDrafts[W].cells.B.d1;
    const out = JSON.stringify(rbDraftDiff(_rbBase[W], rbDrafts[W]));       // what my save will send
    delete _rbSaving[W];
    return shown + ' ' + out;
  })()`), 'OFFM {"cells/A/d1":"OFF"}');
  check('drafts: Undo puts back only my change, not a colleague\'s', run(`(() => {
    rbDraftsIn({ [W]: { cells: { A: { d1: 'M' }, B: { d1: 'N' } } } });
    rbWeek = W; rbUndoStack.length = 0; rbUndoPush(); rbDrafts[W].cells.A.d1 = 'OFF'; _rbUndoMark(W);   // I change Anna
    rbDraftsIn({ [W]: { cells: { A: { d1: 'OFF' }, B: { d1: 'E' } } } });                                  // a colleague changes Bilal
    rbRender = () => {}; rbUndo(); delete _rbSaving[W];
    return rbDrafts[W].cells.A.d1 + rbDrafts[W].cells.B.d1;
  })()`), 'ME');
  check('drafts: two people adding a note both keep theirs', run(`(() => {
    rbDraftsIn({ [W]: { cells: {}, notes: [{ text: 'n1' }] } });
    rbDrafts[W].notes = rbDrafts[W].notes.concat([{ text: 'mine' }]); _rbSaving[W] = 1;
    rbDraftsIn({ [W]: { cells: {}, notes: [{ text: 'n1' }, { text: 'theirs' }] } });
    delete _rbSaving[W];
    return rbDrafts[W].notes.map(n => n.text).join();
  })()`), 'n1,theirs,mine');
}

console.log('\nQuiet when off · shift task times');
{
  const sb = { console: { log() {}, warn() {}, error() {} }, localStorage: { getItem() { return null; }, setItem() {} },
               document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } }, window: {}, setTimeout: () => 0, setInterval: () => 0, navigator: {} };
  vm.createContext(sb);
  for (const f of ['roster.js', 'roster-build.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  const run = js => vm.runInContext(js, sb);
  run(`roMeKey = 'ME'; roDays = { '2026-10-10': { ME: '00:00 - 09:00' }, '2026-10-11': { ME: 'PH' }, '2026-10-12': { ME: '07:00 - 15:00' }, '2026-10-13': { ME: 'OFF' } };`);
  const duty = (d, h, m) => run(`hoMyDuty(new Date(${d.replace(/-/g, ',').replace(/,0?(\d+),/, (x, mo) => ',' + (mo - 1) + ',')}, ${h}, ${m || 0})).state`);
  check('PH today: off (quiet)', duty('2026-10-11', 12), 'off');
  check('PH today after Saturday night: still on until that night ends (09:00 Sunday)', duty('2026-10-11', 8), 'on');
  check('day off: off', duty('2026-10-13', 10), 'off');
  check('on shift: on (from 1 h before)', duty('2026-10-12', 6, 15), 'on');
  check('working day but the shift is over: quiet', duty('2026-10-12', 20), 'off');
  check('nothing on the roster: unknown, alarms as before', duty('2026-10-20', 10), 'unknown');
  check('no name chosen: unknown', run(`(() => { const k = roMeKey; roMeKey = ''; const r = hoMyDuty(new Date(2026, 9, 11, 12)).state; roMeKey = k; return r; })()`), 'unknown');
  check('the reason says PH', run(`hoMyDuty(new Date(2026, 9, 11, 12)).why`), "you're on PH today");
  check('next shift label: 00:00 dated today is tonight at midnight', run(`_roWhen({ date: '2026-10-11', info: roInfo('00:00 - 09:00'), span: {}, inDays: 0 })`), 'Tonight at midnight');
  check('next shift label: 02:00 dated today starts tonight, not this morning', run(`_roWhen({ date: '2026-10-11', info: roInfo('02:00 - 10:00'), span: {}, inDays: 0 })`), 'Tonight at 02:00');
  check('next shift label: 00:00 dated tomorrow is tomorrow night', run(`_roWhen({ date: '2026-10-12', info: roInfo('00:00 - 09:00'), span: {}, inDays: 1 })`), 'Tomorrow night at midnight');
  check('Quiet when I\'m off can be turned off', run(`(() => { globalThis.hoPref = k => k === 'quietOff' ? false : undefined; const r = hoQuiet(new Date(2026, 9, 11, 12)); delete globalThis.hoPref; return r; })()`), false);

  const sh = { console: { log() {}, warn() {}, error() {} }, localStorage: { getItem() { return null; }, setItem() {} },
               document: { addEventListener() {}, getElementById() { return null; } }, setInterval: () => 0, setTimeout: () => 0 };
  vm.createContext(sh);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'state.js'), 'utf8').replace(/\bconst (SHIFTS|DEFAULT_TASKS)\b/g, 'var $1'), sh);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'shifts.js'), 'utf8'), sh, { filename: 'shifts.js' });
  const late = (key, at, d) => vm.runInContext(`stIsLate('${key}', { at: '${at}' }, new Date(${d}))`, sh);
  check('night task at 02:00: not late at 23:30', late('night', '02:00', '2026,9,11,23,30'), false);
  check('night task at 02:00: late at 02:05 (the night that started yesterday)', late('night', '02:00', '2026,9,12,2,5'), true);
  check('morning task at 10:00: not rung during the night', late('morning', '10:00', '2026,9,12,2,5'), false);
  check('morning task at 10:00: late at 10:01', late('morning', '10:00', '2026,9,12,10,1'), true);
  const rule = n => vm.runInContext(`(() => { const r = stAutoRule({ name: ${JSON.stringify(n)} }); return r ? String(r.re) : ''; })()`, sh);
  check('auto tick: "ALL enrollment" is recognised', !!rule('ALL enrollment'), true);
  check('auto tick: "Check all your Check-ins" is not an ALL enrollment', rule('Check all your Check-ins.'), '');
  check('auto tick: "Give the in-house guest list" is left to people', rule('Give mounier Inhouse guest list'), '');
  check('auto tick: "Complete night audit checklist" is recognised', !!rule('Complete night audit checklist'), true);
  check('auto tick: "Follow up on pending checkouts" is recognised', !!rule('Follow up on pending checkouts'), true);
  check('auto tick: "Prepare departure list for tomorrow" is left to people', rule('Prepare departure list for tomorrow'), '');
  check('auto tick: "Handle late arrivals" is left to people', rule('Handle late arrivals'), '');
  check('auto tick: "Reconcile front desk float" is left to people', rule('Reconcile front desk float'), '');
  const lastDay = (key, d) => vm.runInContext(`_stLastStartDay('${key}', new Date(${d}))`, sh);
  check('daily fresh start: morning list before 07:00 is still yesterday\'s', lastDay('morning', '2026,9,15,6,30'), '2026-10-14');
  check('daily fresh start: morning list from 07:00 is today\'s', lastDay('morning', '2026,9,15,7,0'), '2026-10-15');
  check('daily fresh start: night list at 02:00 belongs to the night that began yesterday', lastDay('night', '2026,9,15,2,0'), '2026-10-14');
  check('daily fresh start: an afternoon list nobody opened still starts fresh the next day', lastDay('afternoon', '2026,9,16,16,0') > '2026-10-15', true);
}

// ── Package Audit: the extension rule only carries the SAME kind of package ──
{
  const noop = () => {}, el = () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop }, addEventListener: noop, appendChild: noop, querySelector: () => null, querySelectorAll: () => [] });
  const sb = { console, setTimeout, clearTimeout, setInterval: () => 0, Date, JSON, Math,
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: noop, createElement: el, body: el(), readyState: 'complete' },
    addEventListener: noop, navigator: { onLine: true } };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'package-audit.js'), 'utf8'), sb, { filename: 'package-audit.js' });
  // Same guest, same room: booking A 05-13 Oct (Lina sold breakfast), booking B 13-17 Oct starting the day A ends.
  const run = codeB => vm.runInContext(`(() => {
    pkgGuests = { A1: { name: 'TEST,GUEST', norm: 'test guest', room: '410', arr: '05-OCT-26', dep: '13-OCT-26' },
                  B1: { name: 'TEST,GUEST', norm: 'test guest', room: '410', arr: '13-OCT-26', dep: '17-OCT-26' } };
    pkgEvents = { A1: [{ action: 'ADDED', code: 'UPS40BB', ts: 202610051553, user: 'ACCOREN-LSTAFF@ACCOREN' }],
                  B1: [{ action: 'ADDED', code: '${codeB}', ts: 202610100142, user: 'ACCOREN-SSELLER@ACCOREN' }] };
    const ev = pkgEvents.B1[0];
    const rows = [{ conf: 'A1', verdict: 'credit', user: 'ACCOREN-LSTAFF@ACCOREN', employee: 'ACCOREN-LSTAFF@ACCOREN', matchedEvent: pkgEvents.A1[0], product: 'Breakfast' },
                  { conf: 'B1', verdict: 'credit', user: 'ACCOREN-SSELLER@ACCOREN', employee: 'ACCOREN-SSELLER@ACCOREN', matchedEvent: ev, originEvent: ev, product: '' }];
    _pkgApplyExtensionCredit(rows);
    return rows[1].user + '|' + (rows[1].extendedFrom || '');
  })()`, sb);
  check('package extension: a room upgrade sold on the extension of a breakfast stay stays with its seller', run('USS50'), 'ACCOREN-SSELLER@ACCOREN|');
  check('package extension: the same breakfast continuing on the extension still goes to the first seller', run('UPS40BB'), 'ACCOREN-LSTAFF@ACCOREN|A1');
  check('package extension: any …BB is breakfast, so 40BB → 60BB on the extension stays with whoever started the breakfast', run('UPS60BB'), 'ACCOREN-LSTAFF@ACCOREN|A1');
  check('package extension: BBWIN (winter breakfast) on the extension is still the breakfast the first seller started', run('BBWIN'), 'ACCOREN-LSTAFF@ACCOREN|A1');
  check('package extension: dinner (UPS59DIN) is a different package from breakfast', run('UPS59DIN'), 'ACCOREN-SSELLER@ACCOREN|');
  check('package kinds: the same kind at another price is one package', ['UPS30BB','UPS80BB','BBSUM','BBWIN','MBREAK','USS100EC','USS225EC','USS100LC','UPS59DIN','UPS118DIN','USS50','USS75','HBWIN','FBSUM'].map(c => vm.runInContext('_pkgKindOfCode(' + JSON.stringify(c) + ')', sb)).join(' '), 'BB BB BB BB BB EC EC LC DIN DIN USS USS HB FB');
  // A stay whose first booking had no package: the first one who put breakfast on a LATER booking owns it.
  const run3 = () => vm.runInContext(`(() => {
    pkgGuests = { H0: { name: 'TEST,TWO', norm: 'test two', room: '413', arr: '16-SEP-26', dep: '02-OCT-26' },
                  M1: { name: 'TEST,TWO', norm: 'test two', room: '413', arr: '02-OCT-26', dep: '08-OCT-26' },
                  E2: { name: 'TEST,TWO', norm: 'test two', room: '413', arr: '08-OCT-26', dep: '09-OCT-26' } };
    pkgEvents = { M1: [{ action: 'ADDED', code: 'UPS30BB', ts: 202610021007, user: 'ACCOREN-MFIRST@ACCOREN' }],
                  E2: [{ action: 'ADDED', code: 'UPS30BB', ts: 202610090013, user: 'ACCOREN-SLATER@ACCOREN' }] };
    const ev = pkgEvents.E2[0];
    const rows = [{ conf: 'E2', verdict: 'credit', user: 'ACCOREN-SLATER@ACCOREN', employee: 'ACCOREN-SLATER@ACCOREN', matchedEvent: ev, originEvent: ev, product: 'Breakfast' }];
    _pkgApplyExtensionCredit(rows);
    return rows[0].user;
  })()`, sb);
  check('package extension: the first one who put the package on the stay keeps it, even after a no-package first booking', run3(), 'ACCOREN-MFIRST@ACCOREN');

  // ── Package Audit rules: each switch changes the outcome it names, and the defaults change nothing ──
  const R = (code, js) => vm.runInContext(`(() => { pkgRules = Object.assign({}, PKG_RULE_DEFAULTS); ${js}; return (${code})(); })()`, sb);
  const ext = `() => run2()`;
  vm.runInContext(`function run2(roomB, arrB, codeB) {
    pkgGuests = { A1: { name: 'TEST,GUEST', norm: 'test guest', room: '410', arr: '05-OCT-26', dep: '13-OCT-26' },
                  B1: { name: 'TEST,GUEST', norm: 'test guest', room: roomB || '410', arr: arrB || '13-OCT-26', dep: '17-OCT-26' } };
    pkgEvents = { A1: [{ action: 'ADDED', code: 'UPS40BB', ts: 202610051553, user: 'ACCOREN-LSTAFF@ACCOREN' }],
                  B1: [{ action: 'ADDED', code: codeB || 'UPS40BB', ts: 202610100142, user: 'ACCOREN-SSELLER@ACCOREN' }] };
    const ev = pkgEvents.B1[0];
    const rows = [{ conf: 'A1', verdict: 'credit', user: 'ACCOREN-LSTAFF@ACCOREN', employee: 'ACCOREN-LSTAFF@ACCOREN', matchedEvent: pkgEvents.A1[0], product: 'Breakfast' },
                  { conf: 'B1', verdict: 'credit', user: 'ACCOREN-SSELLER@ACCOREN', employee: 'ACCOREN-SSELLER@ACCOREN', matchedEvent: ev, originEvent: ev, product: '' }];
    _pkgApplyExtensionCredit(rows);
    return rows[1].user.split('@')[0].split('-').pop();
  }`, sb);
  check('package rules: default — the extension keeps breakfast with the first seller', R(ext, ''), 'LSTAFF');
  check('package rules: extension rule off — every booking is its own sale', R(ext, `pkgRules.chain = false`), 'SSELLER');
  check('package rules: "same room only" — a move to another room starts a new stay', R(`() => run2('411')`, `pkgRules.chainSameRoom = true`), 'SSELLER');
  check('package rules: "same room only" off — a room move is still the same stay', R(`() => run2('411')`, ''), 'LSTAFF');
  check('package rules: "same room only" — the same room still chains', R(`() => run2('410')`, `pkgRules.chainSameRoom = true`), 'LSTAFF');
  check('package rules: a one-day gap is a new stay by default', R(`() => run2('410', '14-OCT-26')`, ''), 'SSELLER');
  check('package rules: gap 1 day — a one-night break is still one stay', R(`() => run2('410', '14-OCT-26')`, `pkgRules.chainGap = 1`), 'LSTAFF');
  check('package rules: same kind only — an upgrade on the extension stays with its seller', R(`() => run2('410', '', 'USS50')`, ''), 'SSELLER');
  check('package rules: same kind off — everything on the extension goes to the first seller', R(`() => run2('410', '', 'USS50')`, `pkgRules.sameKind = false`), 'LSTAFF');

  // The whole audit on a small made-up month: who gets what, rule by rule.
  vm.runInContext(`function auditOf() {
    const U = (conf, product, employee, charge, daily) => ({ conf, room: '101', charge, days: '', arr: '09-Oct-2026', dep: '13-Oct-2026', daily, status: 'APPROVED',
      product, employee, needsProduct: /unknown/i.test(product), needsEmployee: !employee || employee === '-' });
    pkgGuests = {};
    pkgUnknowns = [U('C1', 'Breakfast', 'Lina MORENO', 48.98, '10-Oct-2026'), U('C1', 'Breakfast', 'Lina MORENO', 48.98, '11-Oct-2026'),
                   U('C2', 'Breakfast', '-', 24.48, '10-Oct-2026'),
                   U('C3', 'Early Check In', 'ACCOREN-SALVAREZ', 50, '10-Oct-2026'), U('C3', 'Early Check In', 'ACCOREN-SALVAREZ', 50, '11-Oct-2026'), U('C3', 'Early Check In', 'ACCOREN-SALVAREZ', 50, '12-Oct-2026'),
                   U('C4', 'Late Check Out', 'ACCOREN-SALVAREZ', 50, '11-Oct-2026')];
    pkgEvents = {
      C1: [{ action: 'ADDED', code: 'UPS60BB', ts: 202610050900, user: 'ACCOREN-LMORENO@ACCOREN', price: '48.98' },
           { action: 'ADDED', code: 'UPS30BB', ts: 202610010900, user: 'ACCOREN-SALVAREZ@ACCOREN', price: '24.48' }],
      C2: [{ action: 'ADDED', code: 'UPS30BB', ts: 202610010800, user: '*TARS*', price: '24.48' }],
      C3: [{ action: 'ADDED', code: 'USS100EC', ts: 202610090800, user: 'ACCOREN-SALVAREZ@ACCOREN', price: '50', from: '10-OCT-26', to: '10-OCT-26' }],
      C4: [{ action: 'ADDED', code: 'UPS30BB', ts: 202610090800, user: 'ACCOREN-SALVAREZ@ACCOREN', price: '24.48' }] };
    _pkgRecomputeLogRange();
    return _pkgCompute().map(r => r.conf + ':' + r.verdict + ':' + (r.noSeller ? 'SYS' : String(r.user || '').split('@')[0].split('-').pop())).join(' ');
  }`, sb);
  const base = 'C1:credit:SALVAREZ C1:credit:SALVAREZ C2:credit:SYS C3:credit:SALVAREZ C3:deny:SALVAREZ C3:deny:SALVAREZ C4:deny:SALVAREZ';
  check('package rules: default rules decide exactly as before', R(`auditOf`, ''), base);
  check('package rules: nothing stored = the defaults', R(`() => JSON.stringify(_pkgRulesStored())`, ''), '{}');
  check('package rules: switching a rule off and back gives the identical result', R(`auditOf`, `pkgRules.firstPerson = false; auditOf(); pkgRules.firstPerson = true`), base);
  // (IN-Gauge already credits Lina MORENO, the login LMORENO, so she then stays)
  check('package rules: first person off — the entry matching the price wins', R(`auditOf`, `pkgRules.firstPerson = false`).split(' ').slice(0, 2).join(' '), 'C1:credit:Lina MORENO');
  check('package rules: upgrade-is-same-package off — the upgrade is its own sale', R(`auditOf`, `pkgRules.familyMatch = false`).split(' ').slice(0, 2).join(' '), 'C1:credit:Lina MORENO');
  check('package rules: system bookings off — the TARS account is credited', R(`auditOf`, `pkgRules.systemNoSeller = false`).split(' ')[2], 'C2:credit:*TARS*');
  check('package rules: once-per-stay off — every early check-in night is kept', R(`auditOf`, `pkgRules.oneTime = false`).split(' ').slice(3, 6).join(' '), 'C3:credit:SALVAREZ C3:credit:SALVAREZ C3:credit:SALVAREZ');
  check('package rules: remove-when-Opera-has-none off — it goes to Check by hand', R(`auditOf`, `pkgRules.denyNoOpera = false`).split(' ')[6], 'C4:review:SALVAREZ');

  // The smart "done": a fix stays away until a NEWER IN-Gauge report says otherwise.
  const done = js => vm.runInContext(`(() => { pkgRules = Object.assign({}, PKG_RULE_DEFAULTS); auditOf(); pkgResults = _pkgCompute(); ${js} })()`, sb);
  const T = Date.parse('2026-10-11T08:00:00Z');
  check('package done: fixed, same old report loaded again → stays away (waiting)',
    done(`pkgDone = { 'C1|Breakfast': { by: 'Sam', at: new Date(${T}).toISOString() } }; pkgReportAt = ${T} - 3600e3;
      return _pkgDoneState('C1|Breakfast') + ':' + pkgResults.filter(r => r.conf === 'C1').map(pkgNightDone).join(',') + ':' + _pkgAllGroups().filter(g => _pkgInView(g, 'action')).map(g => g.key).includes('C1|Breakfast')`),
    'waiting:true,true:false');
  check('package done: a newer report still wrong → it comes back, with its nights',
    done(`pkgDone = { 'C1|Breakfast': { by: 'Sam', at: new Date(${T}).toISOString() } }; pkgReportAt = ${T} + 3600e3;
      return _pkgDoneState('C1|Breakfast') + ':' + _pkgAllGroups().filter(g => _pkgInView(g, 'action')).map(g => g.key).includes('C1|Breakfast') + ':' + _pkgNightsText(pkgResults.filter(pkgBackWrong), true)`),
    'back:true:10 & 11 Oct');
  check('package done: a newer report that shows it right → confirmed',
    done(`pkgResults.forEach(r => { if (r.conf === 'C1') { r.reassign = false; r.alreadyComplete = true; } });
      pkgDone = { 'C1|Breakfast': { by: 'Sam', at: new Date(${T}).toISOString() } }; pkgReportAt = ${T} + 3600e3;
      const n = _pkgConfirmSweep(); return _pkgDoneState('C1|Breakfast') + ':' + n + ':' + !!pkgDone['C1|Breakfast'].ok`),
    'confirmed:1:true');
  check('package done: an old per-day entry is kept and read as fixed at its latest tick',
    done(`pkgDone = { 'C1|Breakfast': { by: 'Sam', at: new Date(${T}).toISOString(), nights: true, days: { '10-Oct-2026': { by: 'Sam', at: new Date(${T} + 7200e3).toISOString() } } } };
      pkgReportAt = ${T} + 3600e3; return _pkgFixedAt(pkgDone['C1|Breakfast']) === ${T} + 7200e3 ? _pkgDoneState('C1|Breakfast') : 'wrong time'`),
    'waiting');
  check('package staff: a pasted "LOGIN = Name" line is read the right way round',
    vm.runInContext(`JSON.stringify(_pkgParseStaffLine('ACCOREN-SALVAREZ2 = Sam ALVAREZ'))`, sb), JSON.stringify({ name: 'Sam ALVAREZ', logins: ['ACCOREN-SALVAREZ2'] }));
  check('package staff: the code ships with no staff names', vm.runInContext(`PKG_STAFF.length + Object.keys(PKG_STAFF_ALIASES).length`, sb), 0);
}

// ── Undo (undo.js): the Ctrl+Z stack ──────────────────────
{
  console.log('\nUndo stack');
  const sb = { console: { log() {}, warn() {}, error() {}, info() {} } };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'undo.js'), 'utf8'), sb, { filename: 'undo.js' });
  const U = sb.hoUndo, ran = [];
  U.push('A', () => ran.push('A')); U.push('B', () => ran.push('B'), { redo: () => ran.push('B again') }); U.push('C', () => ran.push('C'));
  check('undo: newest first in the list', U.list().map(e => e.label), ['C', 'B', 'A']);
  U.undo(); U.undo();
  check('undo: Ctrl+Z undoes the newest action first', ran, ['C', 'B']);
  check('undo: an undone action leaves the list', U.list().map(e => e.label), ['A']);
  U.redo();
  check('undo: redo runs the redo and puts it back on the list', [ran[2], U.list()[0].label], ['B again', 'B']);
  U.push('D', () => {});
  check('undo: a new action clears what could be redone', U.redoList().length, 0);
  U.clear(); ran.length = 0;
  check('undo: empty list → nothing happens', U.undo(), false);
  for (let i = 0; i < 40; i++) U.push('x' + i, () => {});
  check('undo: keeps the last 30 only', [U.list().length, U.list()[0].label, U.list()[29].label], [30, 'x39', 'x10']);
  U.clear(); U.push('old', () => ran.push('old'));
  vm.runInContext('Date.now = (n => () => n + 2 * 3600e3 + 1000)(Date.now())', sb);
  U.push('new', () => {});
  check('undo: actions older than 2 hours are dropped', U.list().map(e => e.label), ['new']);
  U.clear();
  const e = U.push('once', () => ran.push('once'));
  U.remove(e);
  check('undo: undone from its toast → Ctrl+Z does not run it again', [U.undo(), ran.includes('once')], [false, false]);
  U.push('broken', () => { throw new Error('gone'); });
  check('undo: an undo that fails is reported and removed', [U.undo(), U.list().length], [false, 0]);
  sb.__inner = 0;
  U.push('outer', () => { U.push('inner', () => {}); sb.__inner = U.list().length; });
  U.undo();
  check('undo: what an undo does is not recorded again', sb.__inner, 0);
  const key = (k, o) => Object.assign({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }, o);
  const inp = (tag, type, ce) => ({ tagName: tag, type, isContentEditable: !!ce });
  check('undo keys: Ctrl+Z / Cmd+Z / Ctrl+Shift+Z / Ctrl+Y',
    [U.keyAction(key('z', { ctrlKey: true }), null), U.keyAction(key('z', { metaKey: true }), null), U.keyAction(key('Z', { ctrlKey: true, shiftKey: true }), null), U.keyAction(key('y', { ctrlKey: true }), null), U.keyAction(key('z'), null)],
    ['undo', 'undo', 'redo', 'redo', '']);
  check('undo keys: left to the browser while typing (input, textarea, select, editable text)',
    [inp('INPUT', 'text'), inp('INPUT', 'search'), inp('TEXTAREA'), inp('SELECT'), inp('DIV', undefined, true)].map(el => U.keyAction(key('z', { ctrlKey: true }), el)),
    ['', '', '', '', '']);
  check('undo keys: a ticked box or a button is not typing', [inp('INPUT', 'checkbox'), inp('BUTTON')].map(el => U.keyAction(key('z', { ctrlKey: true }), el)), ['undo', 'undo']);
}

// ── My upsells: who owns each charged night (same rules as Package Audit) ──
{
  const noop = () => {}, el = () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop }, addEventListener: noop, appendChild: noop, querySelector: () => null, querySelectorAll: () => [] });
  const sb = { console, setTimeout: () => 0, clearTimeout: noop, setInterval: () => 0, JSON, Math, TextDecoder,
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: noop, createElement: el, head: el(), body: el(), readyState: 'complete' },
    addEventListener: noop, navigator: { onLine: true } };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'package-audit.js'), 'utf8'), sb, { filename: 'package-audit.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'my-upsells.js'), 'utf8'), sb, { filename: 'my-upsells.js' });
  const M = sb.MyUpsells;
  const L = 'ACCOREN-LSTAFF@ACCOREN', S2 = 'ACCOREN-SSELLER@ACCOREN';
  vm.runInContext(`
    pkgGuests = {
      A1: { name: 'GUEST,TEST', norm: 'GUEST TEST', gid: 'G1', room: '0410', arr: '05-OCT-26', dep: '13-OCT-26' },
      B1: { name: 'GUEST,TEST', norm: 'GUEST TEST', gid: 'G1', room: '0410', arr: '13-OCT-26', dep: '17-OCT-26' },
      C1: { name: 'TWO,TEST',   norm: 'TEST TWO',   gid: 'G2', room: '0512', arr: '10-OCT-26', dep: '12-OCT-26' },
      D1: { name: 'THREE,TEST', norm: 'TEST THREE', gid: 'G3', room: '0301', arr: '10-OCT-26', dep: '11-OCT-26' },
      E1: { name: 'FOUR,TEST',  norm: 'FOUR TEST',  gid: 'G4', room: '0302', arr: '10-OCT-26', dep: '11-OCT-26' } };
    pkgEvents = {
      A1: [{ action: 'ADDED', code: 'UPS40BB', ts: 202610051553, user: '${L}', price: '32.66', from: '05-OCT-26', to: '12-OCT-26' }],
      B1: [{ action: 'ADDED', code: 'UPS40BB', ts: 202610130900, user: '${S2}', price: '32.66', from: '13-OCT-26', to: '16-OCT-26' },
           { action: 'ADDED', code: 'USS50', ts: 202610130905, user: '${S2}', price: '40.82', from: '13-OCT-26', to: '16-OCT-26' }],
      C1: [{ action: 'ADDED', code: 'UPS30BB', ts: 202610090800, user: '${S2}', price: '24.48', from: '10-OCT-26', to: '11-OCT-26' },
           { action: 'ADDED', code: 'UPS60BB', ts: 202610100900, user: '${L}', price: '48.98', from: '10-OCT-26', to: '11-OCT-26' },
           { action: 'ADDED', code: 'USS100EC', ts: 202610100700, user: '${L}', price: '50', from: '10-OCT-26', to: '10-OCT-26' }],
      D1: [{ action: 'ADDED', code: 'UPS30BB', ts: 202610010800, user: '*TARS*', price: '24.48', from: '10-OCT-26', to: '10-OCT-26' },
           { action: 'ATTACHED', code: 'UPS30BB', ts: 202610100800, user: '${S2}', price: null, from: '10-OCT-26', to: '10-OCT-26' }],
      E1: [{ action: 'ADDED', code: 'UPS30BB', ts: 202610010800, user: '*TARS*', price: '24.48', from: '10-OCT-26', to: '10-OCT-26' }] };
    PKG_STAFF = ['Lina STAFF'];`, sb);
  const H = ['GUEST_FULL_NAME', 'TRX_DESC', 'BUSINESS_DATE', 'ROOM', 'TRX_CODE', 'CASHIER_DEBIT', 'CASHIER_CREDIT', 'REFERENCE', 'REMARK', 'TRX_NO'];
  const line = (g, d, date, room, code, amt) => [g, d, date, room, code, amt, 0, '', '', '9' + room].join('\t');
  const journal = [H.join('\t'),
    line('GUEST,TEST', 'Tourism Dirham', '10-OCT-26', '0410', '7510', 10),
    line('GUEST,TEST', 'Accommodation', '10-OCT-26', '0410', '1000', 300),
    line('GUEST,TEST', 'Breakfast Package', '10-OCT-26', '0410', '2010', 32.66),
    line('GUEST,TEST', 'Breakfast Package', '14-OCT-26', '0410', '2010', 32.66),
    line('GUEST,TEST', 'Room Upgrade', '14-OCT-26', '0410', '2050', 40.82),
    line('TWO,TEST', 'Breakfast Package', '11-OCT-26', '0512', '2010', 48.98),
    line('TWO,TEST', 'Early Check In', '10-OCT-26', '0512', '2070', 50),
    line('TWO,TEST', 'Early Check In', '11-OCT-26', '0512', '2070', 50),
    line('THREE,TEST', 'Breakfast Package', '10-OCT-26', '0301', '2010', 24.48),
    line('FOUR,TEST', 'Breakfast Package', '10-OCT-26', '0302', '2010', 24.48),
    line('GUEST,TEST', 'Mystery item', '11-OCT-26', '0410', '9999', 15)].join('\n');
  const J = M.parseJournal(journal);
  // A payment whose remark mentions breakfast is never a breakfast sold
  {
    const PH = ['GUEST_FULL_NAME', 'TRX_DESC', 'BUSINESS_DATE', 'ROOM', 'TRX_CODE', 'CASHIER_DEBIT', 'CASHIER_CREDIT', 'REFERENCE', 'REMARK', 'TRX_NO'];
    const pj = M.parseJournal([PH.join('\t'),
      ['GUEST,TEST', 'Visa Card Manual', '10-OCT-26', '0410', '9101', 0, 180, '', 'breakfast UPS40BB', '1'].join('\t'),
      ['GUEST,TEST', 'Cash', '10-OCT-26', '0410', '9000', 0, 50, 'breakfast', '', '2'].join('\t'),
      ['GUEST,TEST', 'Upgrade / Upsell Fee', '10-OCT-26', '0410', '1010', 0, 40.82, '', '', '3'].join('\t')].join('\n'));
    const pc = M.chargesFromJournal(pj, vm.runInContext('pkgEvents', sb), vm.runInContext('pkgGuests', sb), {});
    check('my upsells: card / cash payments are never counted, a package reversal still is', pc.map(c => c.amount).join(' '), '-40.82');
    const tj = M.parseJournal([PH.join('\t'),
      ['GUEST,TEST', 'Breakfast Package', '11-OCT-26', '0410', '2010', 24.48, 0, '', '', '4'].join('\t'),
      ['GUEST,TEST', 'Breakfast Service Charge', '11-OCT-26', '0410', '2011', 2.45, 0, '', '', '5'].join('\t'),
      ['GUEST,TEST', 'Breakfast', '11-OCT-26', '0410', '2012', 2.45, 0, '', '', '6'].join('\t'),
      ['GUEST,TEST', 'VAT on Breakfast', '11-OCT-26', '0410', '2013', 1.22, 0, '', '', '7'].join('\t')].join('\n'));
    check('my upsells: tax / service lines next to a package are not counted as another sale', M.chargesFromJournal(tj, vm.runInContext('pkgEvents', sb), vm.runInContext('pkgGuests', sb), {}).map(c => c.amount).join(' '), '24.48');
  }
  check('my upsells: the journal is read with every transaction code, not only 7510', [J.rows.length, J.min, J.max], [11, 20261010, 20261014]);
  const E = () => vm.runInContext('pkgEvents', sb), G = () => vm.runInContext('pkgGuests', sb);
  const ownAll = (trx) => M.own(M.chargesFromJournal(J, E(), G(), { trx }), E(), G());
  const sum = list => list.map(c => `${c.date % 100}:${c.conf}:${c.kind}:${c.status}:${c.owner ? String(c.owner).split('@')[0].split('-').pop() : '-'}`).join(' ');
  const all = ownAll('');
  check('my upsells: package postings only, linked to the booking by room + night, owner by the audit rules', sum(all),
    '10:A1:BB:owned:LSTAFF 14:B1:BB:owned:LSTAFF 14:B1:USS:owned:SSELLER 11:C1:BB:owned:SSELLER 10:C1:EC:owned:LSTAFF 11:C1:EC:dup:LSTAFF 10:D1:BB:owned:SSELLER 10:E1:BB:system:-');
  check('my upsells: a configured transaction code (9999=BB) counts as a package line', ownAll('9999=BB').length, all.length + 1);
  const mine = M.split(all, 'ACCOREN-SSELLER', 20261001, 20261031);
  check('my upsells: mine = the first real person on the kind (a TARS entry is skipped); a new kind on an extension is a new sale', mine.mine.map(c => c.conf + ':' + c.kind), ['D1:BB', 'C1:BB', 'B1:USS']);
  check('my upsells: "not mine but close" = touched by me, given to someone else', mine.close.map(c => c.conf + ':' + c.kind + ':' + c.status), ['B1:BB:owned']);
  const lina = M.split(all, 'ACCOREN-LSTAFF', 20261001, 20261031);
  const ext = lina.mine.find(c => c.conf === 'B1');
  check('my upsells: the extension night says why it is mine', /Extension of conf A1/.test(M.whyMine(ext, 'ACCOREN-LSTAFF')) && /Opera journal/.test(M.whyMine(ext, 'ACCOREN-LSTAFF')), true);
  check('my upsells: the first-seller night names the Opera entry', /You added UPS30BB on 9 Oct 08:00/.test(M.whyMine(mine.mine[1], 'ACCOREN-SSELLER')) && /Later changes by Lina STAFF/.test(M.whyMine(mine.mine[1], 'ACCOREN-SSELLER')), true);
  check('my upsells: after an online booking, the first real person who touched the package gets it, and it says so', /You attached UPS30BB.*online \/ TARS entry is no seller/.test(M.whyMine(mine.mine[0], 'ACCOREN-SSELLER')), true);
  check('my upsells: close reasons in plain words', [/online \/ TARS bookings have no desk seller/.test(M.whyNot(all.find(c => c.conf === 'E1'), 'ACCOREN-SSELLER')), /Extension of conf A1: Lina STAFF started/.test(M.whyNot(mine.close[0], 'ACCOREN-SSELLER'))], [true, true]);
  check('my upsells: the period filter', M.split(all, 'ACCOREN-LSTAFF', 20261011, 20261013).mine.length, 0);
  check('my upsells: the signed-in person is found by their team name', M.personFor('Lina STAFF', M.sellers(all)), 'ACCOREN-LSTAFF');
  const est = M.own(M.chargesFromLog(E(), G(), {}, 20261020), E(), G());
  check('my upsells: the estimate counts only nights already charged (up to yesterday)', M.chargesFromLog(E(), G(), {}, 20261009).filter(c => c.conf === 'A1').map(c => c.date % 100).join(','), '5,6,7,8');
  check('my upsells: a package deleted after it was added is not estimated', M.chargesFromLog(E(), G(), { A1: [{ code: 'UPS40BB', ts: 202610061000 }] }, 20261020).filter(c => c.conf === 'A1').length, 0);
  check('my upsells: a package deleted and put back (price change) is still estimated', M.chargesFromLog(E(), G(), { A1: [{ code: 'UPS40BB', ts: 202610051553 }] }, 20261020).filter(c => c.conf === 'A1').length, 8);
  const estA = est.filter(c => c.conf === 'A1');
  check('my upsells: no journal → nights estimated from the log date range × price', [estA.length, estA[0].date, estA[estA.length - 1].date, estA[0].amount, estA[0].estimated], [8, 20261005, 20261012, 32.66, true]);
  check('my upsells: estimated early check-in is one night only', est.filter(c => c.conf === 'C1' && c.kind === 'EC').length, 1);
  vm.runInContext(`pkgUnknowns = [{ conf: 'C1', room: '512', charge: 48.98, daily: '11-Oct-2026', product: 'Unknown Product', employee: '-', status: '' }]`, sb);
  const ig = M.own(M.chargesFromIngauge(vm.runInContext('pkgUnknowns', sb), E(), G()), E(), G());
  check('my upsells: an IN-Gauge row can be the charge list too', sum(ig), '11:C1:BB:owned:SSELLER');
  vm.runInContext(`pkgPins = { 'C1|Breakfast': { seller: 'Lina STAFF', by: 'Sam' } }`, sb);
  check('my upsells: a seller pinned in Package Audit wins', sum(ownAll('').filter(c => c.conf === 'C1' && c.kind === 'BB')), '11:C1:BB:owned:Lina STAFF');
  vm.runInContext(`pkgPins = {}`, sb);
  const big = { name: 'Sam', login: 'ACCOREN-SSELLER', from: 20261001, to: 20261031, madeAt: 'x', madeBy: 'Sam', source: '', files: [],
    rows: Array.from({ length: 650 }, (_, i) => ({ date: 20261001 + (i % 28), conf: 'C' + i, room: '1', guest: 'Test Guest', code: 'UPS30BB', kind: 'BB', kindLabel: 'Breakfast', amount: 10, soldOn: '', soldBy: '', why: 'w', evidence: 'e', src: '' })) };
  big.totals = M.totals(big.rows);
  const snaps = M.snapshots(big, Date.now());
  check('my upsells: a big record is saved in parts of 300 rows, one group', [snaps.length, snaps.map(s => s.snap.rows.length), new Set(snaps.map(s => s.snap.group)).size, new Set(snaps.map(s => s.id)).size], [3, [300, 300, 50], 1, 3]);
  const twice = {}; snaps.forEach(s => { twice[s.id] = s.snap; }); M.snapshots(big, Date.now() + 1000).forEach(s => { twice[s.id] = s.snap; });
  const RL = M.recordList(twice);
  check('my upsells: two saves are two records, but the month total counts each night once', [RL.list.length, RL.list[0].rows.length, RL.months['202610'].nights, RL.months['202610'].aed], [2, 650, 650, 6500]);
  check('my upsells: the file name', M.fileName({ name: 'Sam ALVAREZ', from: 20261001, to: 20261013 }), 'Upsells - Sam ALVAREZ - 1 Oct 2026 to 13 Oct 2026.xlsx');
  check('my upsells: a whole month is named by the month', M.fileName({ name: 'ACCOREN-SALVAREZ@ACCOREN', from: 20261001, to: 20261031 }), 'Upsells - SALVAREZ - Oct 2026.xlsx');
}

console.log('\nWhatsApp HK bridge · message reader');
{
  const sb = { console: { log() {}, warn() {}, error() {} } }; sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'wa-bridge.js'), 'utf8'), sb, { filename: 'wa-bridge.js' });
  const P = t => JSON.parse(JSON.stringify(sb.hoWaParse(t)));
  const A = t => P(t).actions.map(a => [a.room, a.act, a.time || a.note || ''].filter(Boolean).join(' ')).join(' | ');
  check('wa: "324 CO" checks out 324', A('324 CO'), '324 co');
  check('wa: "407 CO" checks out 407', A('407 CO'), '407 co');
  check('wa: "415 change bedsheet" is a note', A('415 change bedsheet'), '415 note change bedsheet');
  check('wa: "503 Cleaning." is a note without the dot', A('503 Cleaning.'), '503 note Cleaning');
  check('wa: an edited cleaning message is one note', A('201 Clean the room, add also toliet paper and towels..'), '201 note Clean the room, add also toliet paper and towels');
  check('wa: no room → nothing to do', [P('Hk please come asap..').kind, P('Update').kind], ['none', 'none']);
  check('wa: the app\'s own extension post is ignored', P('🔁 Extensions — 09:07\n🔁 0113 · +4N → 22 Oct\n🔁 0425 · +1N → 19 Oct'), { kind: 'ignore', actions: [] });
  check('wa: one extension line on its own is ignored', P('🔁 0113 · +4N → 22 Oct').kind, 'ignore');
  check('wa: CO words', ['202 C/O', '202 checked out', '202 check out', '202 checkout', '202 out', '202 co ✅', '202 CO.'].map(A), Array(7).fill('202 co'));
  check('wa: LCO times', ['202 LCO 6PM', '202 lco 6 pm', '202 LCO 6:30 pm', '202 LCO 18:00', '202 LCO 1800', '202 late check out 2pm', '202 late co 6.30 p.m.'].map(A),
    ['202 lco 18:00', '202 lco 18:00', '202 lco 18:30', '202 lco 18:00', '202 lco 18:00', '202 lco 14:00', '202 lco 18:30']);
  check('wa: LCO with no time', P('202 LCO').actions, [{ room: '202', act: 'lco', time: '' }]);
  check('wa: Room / Rm / # before the number', ['Room 202 CO', 'Rm 202 CO', '#202 CO', 'rm. 1204 LCO 1800'].map(A), ['202 co', '202 co', '202 co', '1204 lco 18:00']);
  check('wa: several rooms in one message', ['202 205 CO', '202, 205 CO', '202 & 205 CO', '202 CO\n205 CO', '202\n205\nCO'].map(A), Array(5).fill('202 co | 205 co'));
  check('wa: different commands on one line', A('202 CO, 205 LCO 2pm'), '202 co | 205 lco 14:00');
  check('wa: leading-zero rooms keep their digits, match by number', [A('0113 CO'), sb.hoWaPure.actionKey({ room: '0113', act: 'co' }) === sb.hoWaPure.actionKey({ room: '113', act: 'co' })], ['0113 co', true]);
  check('wa: "out of order" and "checkout tomorrow" are notes, not check-outs', [A('324 out of order'), A('324 checkout tomorrow')], ['324 note out of order', '324 note checkout tomorrow']);
  check('wa: a note\'s second line joins it', A('201 Clean the room\nalso towels'), '201 note Clean the room also towels');
  check('wa: time labels', ['18:00', '18:30', '12:00', '09:05'].map(sb.hoWaPure.timeLabel), ['6 PM', '6:30 PM', '12 PM', '9:05 AM']);
  // more words: check-out synonyms, extensions, late check-out, typos
  check('wa: more check-out words', ['202 C.O', '202 checkedout', '202 chkout', '202 chk out', '202 checked-out', '202 left', '202 vacated', '202 departed', '202 has checked out', '202 guest checked out', '202 CO done ✅'].map(A), Array(11).fill('202 co'));
  check('wa: typos and order', ['324co', '324-CO', 'CO 324', '324 co.', 'Rm324 c/o', '#324 C/O', 'C/O 324.', 'Checked out: 324'].map(A), Array(8).fill('324 co'));
  check('wa: "CO 324, 325" and "Checked out 324 & 325"', [A('CO 324, 325'), A('Checked out 324 & 325')], ['324 co | 325 co', '324 co | 325 co']);
  check('wa: not a check-out → a note', ['324 out of order', '324 OOO', '324 CO tmrw', '324 checkout tomorrow', '324 left luggage', '324 out for lunch', '324 CO?', '324 not checked out'].map(A),
    ['324 note out of order', '324 note OOO (Out of Order)', '324 note CO tmrw', '324 note checkout tomorrow', '324 note left luggage', '324 note out for lunch', '324 note CO?', '324 note not checked out']);
  check('wa: late check-out words', ['202 late co 6pm', '202 late checkout 6pm', '202 late check out 6 pm', '202 L/C 6pm', '202 late till 6pm', '202 late until 18:00', 'LCO 202 6PM', '202-lco 6pm'].map(A), Array(8).fill('202 lco 18:00'));
  check('wa: "late" alone or LCO tomorrow → a note', [A('202 late'), A('202 LCO tomorrow 2pm')], ['202 note late', '202 note LCO tomorrow 2pm']);
  const E = t => P(t).actions.map(a => [a.room, a.act, a.nights ? '+' + a.nights + 'N' : '', a.until ? '→' + a.until : '', a.note || ''].filter(Boolean).join(' ')).join(' | ');
  check('wa: extension words', ['0113 ext', '0113 extend', '0113 extended', '0113 extension', '0113 EXT.'].map(E), Array(5).fill('0113 ext'));
  check('wa: extension nights', ['0113 EXT 2N', '0113 extended 2 nights', '0113 +2N', '0113 ext +2', '0113 extend 2', 'EXT 0113 2N', '0113 ext 2 more nights', '0113 extended two nights', 'Extended 0113 for 2 nights'].map(E), Array(9).fill('0113 ext +2N'));
  check('wa: extension to a date', ['0113 ext till 22', '0113 ext to 22 Oct', '0113 extended until 22nd', '0113 ext 22/10', '0113 ext till Oct 22', '0113 ext 22'].map(E),
    ['0113 ext →22', '0113 ext →22/10', '0113 ext →22', '0113 ext →22/10', '0113 ext →22/10', '0113 ext →22']);
  check('wa: ext till tomorrow = 1 night', E('0113 ext till tomorrow'), '0113 ext +1N');
  check('wa: not sure → a note; on its way → ⏳ extending', ['0113 ext?', '0113 wants to extend', '0113 extension request', '0113 ext maybe', '0113 extension not confirmed', '0113 ext pending'].map(E),
    ['0113 note ext?', '0113 extending', '0113 extending', '0113 note ext maybe', '0113 note extension not confirmed', '0113 extending']);
  check('wa: the app\'s own posts stay ignored', ['🔁 0113 · +4N → 22 Oct', '0113 · +4N → 22 Oct', 'Extensions — 09:07\n0113 · +4N → 22 Oct'].map(t => P(t).kind), ['ignore', 'ignore', 'ignore']);
  check('wa: mixed message', E('202 CO, 0113 EXT 2N\n415 late till 4pm'), '202 co | 0113 ext +2N | 415 lco');
  const XN = (a, b) => { const r = sb.hoWaPure.extNights(a, b); return r && [r.nights, r.label, r.guessed].join(' '); };
  const base = new Date(2026, 9, 18);
  check('wa: extension → nights from the departure day', [XN({ nights: 2 }, base), XN({ until: '22' }, base), XN({ until: '22/10' }, base), XN({ until: '5' }, base), XN({}, base), XN({ until: '10/10' }, base), XN({ until: '2/1' }, new Date(2026, 11, 30))],
    ['2 20 Oct false', '4 22 Oct false', '4 22 Oct false', '18 5 Nov false', '1 19 Oct true', null, '3 2 Jan false']);
  check('wa: action keys tell extensions apart', [sb.hoWaPure.actionKey({ room: '0113', act: 'ext', nights: 2 }), sb.hoWaPure.actionKey({ room: '113', act: 'ext', until: '22/10' })], ['113:ext:2n:', '113:ext:22/10:']);
  check('wa: chips', [{ room: '324', act: 'co' }, { room: '202', act: 'lco', time: '18:00' }, { room: '0113', act: 'ext', nights: 2 }, { room: '0113', act: 'ext', until: '22/10' }, { room: '415', act: 'note', note: 'x' }].map(sb.hoWaPure.chip),
    ['✓ CO 324', '⏰ LCO 202 6 PM', '↪ EXT 0113 +2N', '↪ EXT 0113 → 22 Oct', '📝 note 415']);
  // the chat backup + search
  if (sb.hoWaPure.findRoom) {
    sb.purposeGuests = [{ room: '0206', name: 'TEST GUEST' }]; sb.arrGuests = [{ room: '512', name: 'ARR GUEST' }]; sb.itGibyRooms = { '733': { pax: 1, names: ['TALLY GUEST'] } };
    const F = r => { const f = sb.hoWaPure.findRoom(r); return f ? f.src + ':' + f.name : 'none'; };
    check('wa: room lookup off the departures', ['206', '512', '0733', '999'].map(F), ['in-house list:TEST GUEST', 'arrivals:ARR GUEST', 'in-house tally:TALLY GUEST', 'none']);
    sb.purposeGuests = []; sb.arrGuests = []; sb.itGibyRooms = {};
  }
  const W2 = sb.hoWaPure;
  check('wa backup: ids are made safe for the database', [W2.safeKey('false_1203@g.us_3EB0.A#B$C[D]/E'), W2.safeKey(''), W2.safeKey('a\nb')], ['false_1203@g_us_3EB0_A_B_C_D__E', '_', 'a_b']);
  check('wa backup: a pasted message (no id) gets the same short key each time', [W2.hashKey('2026-10-18|09:01|sam|324 CO') === W2.hashKey('2026-10-18|09:01|sam|324 CO'), W2.hashKey('a') !== W2.hashKey('b'), /^[a-z0-9]+$/.test(W2.hashKey('x.y#z'))], [true, true, true]);
  check('wa backup: what was done, compact', W2.archR([{ st: 'co', room: '324' }, { st: 'lco', room: '202', d: '6 PM' }, { st: 'ext', room: '0113', d: '+2N → 20 Oct' }, { st: 'none' }]), 'co 324 · lco 202 6 PM · ext 0113 +2N → 20 Oct · none');
  check('wa backup: chips from it', W2.archChips('co 324 · ext 0113 +2N → 20 Oct').map(c => c.label), ['✓ CO 324', '↪ EXT 0113 +2N → 20 Oct']);
  const days = { '2026-10-17': { a: { t: '20:00', s: 'Alex', x: '0324 CO', r: 'co 0324' } }, '2026-10-18': { b: { t: '09:01', s: 'Sam', x: '324 CO', r: 'co 324' }, c: { t: '08:00', s: 'Lina', x: '1324 towels', r: 'note 1324' }, d: { t: '10:00', s: 'Sam', x: 'Hello team' } } };
  const K = q => W2.hoWaSearch(days, q).map(o => o.key).join();
  check('wa search: a room finds 324 and 0324, not 1324', [K('324'), K('0324')], ['b,a', 'b,a']);
  check('wa search: names, words, two words, case', [K('sam'), K('TOWELS'), K('lina towels'), K('sam towels'), K('')], ['b,d', 'c', 'c', '', 'c,b,d,a']);
  check('wa search: what was done is searchable', K('co'), 'b,a');
  check('wa search: highlight is safe HTML', W2.hoWaHi('Room 0324 <b>CO</b> 1324', '324 co'), 'Room <mark>0324</mark> &lt;b&gt;<mark>CO</mark>&lt;/b&gt; 1324');
  const L = W2.hoWaSearch(days, '324');
  check('wa backup: .txt in WhatsApp\'s own format, oldest first, and the app reads it back', [W2.hoWaExportTxt(L), sb.hoWaParseCopied(W2.hoWaExportTxt(L)).map(m => m.sender + ':' + m.text).join()],
    ['[8:00 PM, 17/10/2026] Alex: 0324 CO\n[9:01 AM, 18/10/2026] Sam: 324 CO\n', 'Alex:0324 CO,Sam:324 CO']);
  check('wa backup: CSV for Excel', W2.hoWaExportCsv(L).split('\r\n')[1], '"17/10/2026","8:00 PM","Alex","0324 CO","✓ CO 0324"');
  check('wa backup: file names', [W2.hoWaExportName('2026-10-01', '2026-10-18', 'txt'), W2.hoWaExportName('2026-10-18', '2026-10-18', 'csv')], ['HK chat 2026-10-01 to 2026-10-18.txt', 'HK chat 2026-10-18.csv']);
  const C = sb.hoWaParseCopied([
    '#hotelops-wa',
    '[9:01 AM, 11/10/2026] Sam: 324 CO',
    '[9:05 AM, 11/10/2026] Alex: 201 Clean the room',
    'also towels',
    '11/10/2026, 9:10 am - Sam: 202 LCO 6PM',
    '11/10/2026, 9:00 am - Messages and calls are end-to-end encrypted.',
    '[11/10/2026, 10:01:05 AM] Lina: 415 change bedsheet',
    '10/10/2026, 22:15 - Alex: 333 CO',
  ].join('\n'));
  check('wa copy: WhatsApp Web, Android and iPhone formats are read', C.map(m => [m.time, m.date, m.sender, m.text].join(' / ')), [
    '9:01 AM / 11/10/2026 / Sam / 324 CO', '9:05 AM / 11/10/2026 / Alex / 201 Clean the room\nalso towels',
    '9:10 am / 11/10/2026 / Sam / 202 LCO 6PM', '10:01:05 AM / 11/10/2026 / Lina / 415 change bedsheet', '22:15 / 10/10/2026 / Alex / 333 CO']);
  const now = new Date(2026, 9, 11, 12);
  check('wa copy: dates either way round, today wins', ['11/10/2026', '10/11/2026', '10/10/2026', '25/12/26', '2026-10-11'].map(d => sb.hoWaPure.waDateISO(d, now)),
    ['2026-10-11', '2026-10-11', '2026-10-10', '2026-12-25', '2026-10-11']);
  check('wa copy: times to 24 h', ['9:01 AM', '9:01 pm', '12:30 am', '21:05', '10:01:05 AM'].map(sb.hoWaPure.waTime24), ['09:01', '21:01', '00:30', '21:05', '10:01']);

  // the WhatsApp Web console snippet's own helpers
  const ws = { console: sb.console, module: { exports: {} } }; ws.globalThis = ws;
  vm.createContext(ws);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'tools', 'hotelops-whatsapp.console.js'), 'utf8'), ws, { filename: 'hotelops-whatsapp.console.js' });
  const H = ws.module.exports;
  check('wa snippet: reads data-pre-plain-text', JSON.parse(JSON.stringify(H.parsePre('[9:35 AM, 10/11/2026] Sam: '))), { time: '9:35 AM', date: '10/11/2026', sender: 'Sam' });
  check('wa snippet: a name with a colon-less suffix and narrow spaces', JSON.parse(JSON.stringify(H.parsePre('[9:35 PM, 11/10/2026] +971 50 000 0000: '))), { time: '9:35 PM', date: '11/10/2026', sender: '+971 50 000 0000' });
  check('wa snippet: not a pre-text → null', H.parsePre('hello'), null);
  check('wa snippet: today filter (US and UK dates)', ['10/11/2026', '11/10/2026', '10/10/2026', '12/10/2026', ''].map(d => H.isToday(d, now)), [true, true, false, false, false]);
  check('wa snippet: sent by me from the data-id', [H.isMineId('true_120363@g.us_3EB0AB'), H.isMineId('false_120363@g.us_3EB0CD_971500@c.us')], [true, false]);
  const txt = H.copyText([{ time: '9:01 AM', date: '11/10/2026', sender: 'Sam', text: '324 CO' }, { time: '9:02 AM', date: '11/10/2026', sender: 'Alex', text: '201 clean\nplease' }]);
  check('wa snippet: copy format has the marker and WhatsApp\'s own lines', txt, '#hotelops-wa\n[9:01 AM, 11/10/2026] Sam: 324 CO\n[9:02 AM, 11/10/2026] Alex: 201 clean\nplease');
  check('wa snippet → app: what the snippet copies, the app reads back', sb.hoWaParseCopied(txt).map(m => m.sender + ':' + m.text), ['Sam:324 CO', 'Alex:201 clean\nplease']);
  // the snippet HotelOps hands out has the same reader baked in
  const raw = fs.readFileSync(path.join(ROOT, 'tools', 'hotelops-whatsapp.console.js'), 'utf8');
  const built = sb.hoWaPure.snippet(raw, 'https://example.test/app/index.html?x=$&');
  const ws2 = { console: sb.console, module: { exports: {} } }; ws2.globalThis = ws2;
  vm.createContext(ws2); vm.runInContext(built, ws2, { filename: 'built-snippet.js' });
  const H2 = ws2.module.exports;
  check('wa snippet: address and reader filled in', [built.includes('var APP_URL = "https://example.test/app/index.html?x=$&"'), !!H2.parser, H.parser], [true, true, null]);
  check('wa snippet: never uses innerHTML', /\.innerHTML|insertAdjacentHTML|outerHTML/.test(raw), false);
  const corpus = ['324 CO', 'CO 324, 325', '0113 EXT 2N', '0113 ext till 22 Oct', '202 late till 6pm', '324 out of order', '🔁 0113 · +4N → 22 Oct', 'Hk please come', '201 Clean the room\nalso towels', 'Rm324 c/o', '202 CO, 205 LCO 2pm'];
  check('wa snippet: reads every message exactly like the app', corpus.map(t => JSON.stringify(H2.parser.hoWaParse(t))), corpus.map(t => JSON.stringify(sb.hoWaParse(t))));
  check('wa snippet: chips in the window', ['324 CO', '202 LCO 6PM', '0113 extended 2 nights', '415 change bedsheet', 'Hk please come', '🔁 0113 · +4N → 22 Oct'].map(t => JSON.parse(JSON.stringify(H2.chips(t))).map(c => c.tone + ' ' + c.label).join(' / ')),
    ['co ✓ CO 324', 'lco ⏰ LCO 202 6 PM', 'ext ↪ EXT 0113 +2N', 'note 📝 note 415', 'off — ignored', 'off — ignored (HotelOps post)']);
  // ── lists, HotelOps' own posts, separators ──
  check('wa lists: one message, many rooms', ['CO\n101\n102\n103', 'Checkout list:\n101 ✓\n102 ✓', 'Checked out: 101, 102, 103', 'Departures done 101 102 103', '1. 101 CO\n2. 102 CO', '- 101\n- 102\nCO'].map(A),
    ['101 co | 102 co | 103 co', '101 co | 102 co', '101 co | 102 co | 103 co', '101 co | 102 co | 103 co', '101 co | 102 co', '101 co | 102 co']);
  check('wa lists: a command per line', A('101 CO\n102 LCO 2PM\n103 ext 1N'), '101 co | 102 lco 14:00 | 103 ext');
  check('wa lists: under a late check-out / extended heading', [A('Late check-outs:\n202 2pm\n205 4 pm'), E('Extended:\n0113 2N\n0425 +1')], ['202 lco 14:00 | 205 lco 16:00', '0113 ext +2N | 0425 ext +1N']);
  check('wa lists: "Departures:" alone is not a check-out, a bare "101 ✓" is nothing', [P('Departures:\n101\n102').kind, P('101 ✓').kind, P('324 done').kind], ['none', 'none', 'none']);
  const LIST = W2.checkoutListText([{ roomStr: '0113', status: 'out' }, { roomStr: '201', status: 'due' }, { roomStr: '202', status: 'late', lateTime: '18:00' }, { roomStr: '0425', status: 'extended', extensionNights: 2 }, { roomStr: '324', status: 'out' }], new Date(2026, 9, 18, 10, 30));
  check('wa send: the checkout list HotelOps posts', LIST, '✅ HotelOps · Checkout list · 10:30\nChecked out (2): 0113, 324\nLate check-out (1): 202 (6 PM)\nExtended (1): 0425 (+2N)\nStill due (1): 201');
  check('wa send: read back, HotelOps\' own posts never act (header or invisible mark)', [P(LIST).kind, P(LIST).ho, P('⁣324 CO done ✓').kind, P('324 CO done ✓').kind], ['ignore', true, 'ignore', 'act']);
  check('wa send: templates', [W2.fillTemplate('{room} LCO {time} approved', { room: '202', time: '2 PM' }), W2.fillTemplate('{room} please clean', {})], ['202 LCO 2 PM approved', '{room} please clean']);
  check('wa: room lists with dots, commas, slashes, dashes, spaces', ['212.319.504 VD', '212,319,504 VD', '212/319/504 VD', '212 - 319 - 504 VD', '212 319 504 VD', '212.319 CO'].map(A),
    ['212 co | 319 co | 504 co', '212 co | 319 co | 504 co', '212 co | 319 co | 504 co', '212 co | 319 co | 504 co', '212 co | 319 co | 504 co', '212 co | 319 co']);
  check('wa: prices, times and dates are not rooms', ['AED 50.00 for 324', '324 LCO 12.30', 'paid 29.02 room 324', '18.10.2026 324 CO', '324 CO 18.10.2026', '1200.1300'].map(A), ['', '324 lco 12:30', '', '', '324 co', '']);
  // the user's live message (a reply to HotelOps' "🚫 NA Rooms" post)
  const LIVE = '212.319.504.509.416 all VD\n507 guest inside', Q = 'You · 🚫 NA Rooms — 12:01\n🚫 0212 · 11:54\n🚫 0507 · 11:55…';
  check('wa live: "212.319.504.509.416 all VD / 507 guest inside"', A(LIVE), '212 co | 319 co | 504 co | 509 co | 416 co | 507 note guest inside');
  check('wa live: as a reply to the no-answer list → "Guest inside (was No answer)"', JSON.parse(JSON.stringify(sb.hoWaParse(LIVE, { quote: Q }))).actions.map(a => a.room + ' ' + a.act + (a.note ? ' ' + a.note : '')).join(' | '),
    '212 co | 319 co | 504 co | 509 co | 416 co | 507 note Guest inside (was No answer)');
  check('wa: "all CO" for the rooms above; "all clean" is a note', [A('212\n319\nall CO'), A('212 319 all clean')], ['212 co | 319 co', '212 note all clean | 319 note all clean']);
  check('wa: housekeeping words built in', ['315 VD', '315 VC', '315 VR', '315 ED', '315 OD', '315 DND', '315 RC'].map(t => P(t).actions.map(a => a.act).join()), ['co', 'co', 'co', 'co', 'note', 'note', 'extending']);
  check('wa: the HK word in the chip', W2.chip(P('315 VD').actions[0]), '✓ CO 315 · VD Vacant Dirty');
  // the hotel's own word list (wa-brain.js: window.hoWaWords) comes first
  const DW = { vd: { m: 'note', label: 'Very dusty' }, kk: { m: 'co', label: 'Kay Kay' }, zz: { m: 'ignore', label: '' }, 'late out': { m: 'lco', label: 'Late out' } };
  sb.hoWaWords = { lookup: w => DW[String(w).toLowerCase()] || null };
  check('wa words: hoWaWords.lookup wins over the built-in list', ['315 VD', '315 kk', 'KK: 315, 402', '315 kk\n402 kk', 'kk\n315\n402', '315 zz', '202 late out 4pm'].map(A),
    ['315 note VD (Very dusty)', '315 co', '315 co | 402 co', '315 co | 402 co', '315 co | 402 co', '', '202 lco 16:00']);
  check('wa words: the label in the chip', W2.chip(P('315 kk').actions[0]), '✓ CO 315 · KK Kay Kay');
  delete sb.hoWaWords;
  check('wa words: a lookup can be passed in (the WhatsApp window)', A.call(null, '315 kk') + '/' + sb.hoWaParse('315 kk', { words: w => DW[w] }).actions.map(a => a.act).join(), '/co');
  // ask the team about a word nobody taught HotelOps
  const ASK = t => { const r = sb.hoWaParse(t); return r.ask ? r.ask.word + '@' + r.ask.room : ''; };
  check('wa ask: short unknown words after a room are asked', ['415 ckd', '415 CKD.', '101 chkd', '202 CO, 415 ckd', '510 xq'].map(ASK), ['ckd@415', 'ckd@415', 'chkd@101', 'ckd@415', 'xq@510']);
  check('wa ask: common words, hotel words, longer notes and questions are not', ['324 OOO', '202 late', '503 Cleaning.', '324 CO?', '415 change bedsheet', '324 please', '201 dirty', '324 ok', '415 ckd please', '315 VD', '507 TD', '324 asap', '415 towels'].map(ASK), Array(13).fill(''));
  check('wa ask: nothing is done with the asked room, the rest still is', [P('415 ckd').kind, A('202 CO, 415 ckd')], ['none', '202 co']);
  check('wa ask: once answered (in the word list), it acts', sb.hoWaParse('415 ckd', { words: w => (w === 'ckd' ? { m: 'co', label: 'Checked' } : null) }).actions.map(a => W2.chip(a)).join(), '✓ CO 415 · CKD Checked');
  // ⏳ Extending: on its way vs done
  const X = t => sb.hoWaParse(t).actions.map(a => W2.chip(a) + (['book', 'sign', 'td', 'pay'].filter(k => a[k] !== undefined).length ? ' ' + ['book', 'sign', 'td', 'pay'].filter(k => a[k] !== undefined).map(k => k + '=' + (a[k] ? 1 : 0)).join(',') : '')).join(' | ');
  check('wa extending: bare / progressive / future', ['507 Extending', 'Extending 507', '507 extending', '112 will extend', '112 wants to extend', '0113 ext pending', '0113 extension request'].map(X),
    ['⏳ Extending 507', '⏳ Extending 507', '⏳ Extending 507', '⏳ Extending 112', '⏳ Extending 112', '⏳ Extending 0113', '⏳ Extending 0113']);
  check('wa extending: what is still to do', ['extending 507 waiting for TD and RC Sign', '507 extending, waiting TD + RC', '507 TD + RC', '507 ext pending TD RC payment', '507 extending, only TD left', '507 TD done, RC pending'].map(X), [
    '⏳ Extending 507 · waiting TD, RC book=1,sign=0,td=0,pay=1', '⏳ Extending 507 · waiting TD, RC book=1,sign=0,td=0,pay=1', '⏳ Extending 507 · waiting TD, RC sign=0,td=0',
    '⏳ Extending 507 · waiting TD, RC, payment book=1,sign=0,td=0,pay=0', '⏳ Extending 507 · waiting TD book=1,sign=1,td=0,pay=1', '⏳ Extending 507 · waiting RC book=1,sign=0,td=1,pay=1']);
  check('wa extending: done wording', ['507 TD done', '507 RC signed', '507 TD paid', '507 paid full', '507 booking done', '507 booking created', '507 TD ✓ RC ✓', '507 all done', '112 extending, booking done'].map(X), [
    '✓ 507 TD collected td=1', '✓ 507 RC signed sign=1', '✓ 507 TD collected td=1', '✓ 507 paid in full pay=1', '✓ 507 booking made book=1', '✓ 507 booking made book=1', '✓ 507 TD collected, RC signed sign=1,td=1',
    '⏳ 507 ready → mark extended book=1,sign=1,td=1,pay=1', '✓ 112 booking made book=1']);
  check('wa extending: only confirmed wording marks it extended', ['507 extended', '507 ext 2N', '507 +2N', '507 extended till 22'].map(E), ['507 ext', '507 ext +2N', '507 ext +2N', '507 ext →22']);
  // the window's helpers
  check('wa window: tiny balances are not a warning', [W2.balInfo({ bal: 0.02 }), W2.balInfo({ bal: 120.5 }), W2.balInfo({ text: '0318 checked out · ⚠ balance AED 0.02' }), W2.balInfo({ bal: 0 })].map(b => b && b.tone + ' ' + b.label),
    ['tiny balance AED 0.02 (tiny)', 'warn ⚠ balance AED 120.50', 'tiny balance AED 0.02 (tiny)', null]);
  check('wa window: filters', [{ res: [{ st: 'co' }] }, { res: [{ st: 'req' }] }, { res: [{ st: 'notlist' }] }, { res: [{ st: 'co', bal: 5 }] }, { res: [{ st: 'none' }] }, { res: [{ st: 'co' }], undone: true }, { res: [{ st: 'extending' }] }].map(l => [...W2.entryKinds(l)].sort().join('+')),
    ['actions', 'notes', 'attention', 'actions+attention', 'ignored', 'ignored', 'actions']);
  check('wa window: avatars, hours', [W2.initials('Sam Test'), W2.initials('Lina'), W2.initials('+971 50 000 0000'), W2.isPhone('+971 50 000 0000'), W2.hourLabel('09:41'), W2.hourLabel('13:05'), W2.hourLabel('')], ['ST', 'L', '', true, '9 AM', '1 PM', 'Earlier']);
  // the WhatsApp window: groups, previews, signal, typing check
  check('wa reader: group names match with emoji / spacing / extra words', [H2.groupMatch('IBIS FO,HK and Security', 'IBIS FO, HK and Security 🏨'), H2.groupMatch('Night Team', 'night  team'), H2.groupMatch('Night Team', 'Day Team'), H2.groupMatch('HK', '')], [true, true, false, false]);
  check('wa reader: chat-list previews', [H2.splitPreview('Sam: 324 CO'), H2.splitPreview('You: 324 CO'), H2.splitPreview('324 CO'), H2.splitPreview('324 CO', 'Lina'), H2.splitPreview('10:30: x')].map(p => [p.sender, p.text, p.mine].join('|')),
    ['Sam|324 CO|false', 'Me|324 CO|true', '|324 CO|false', 'Lina|324 CO|false', '|10:30: x|false']);
  check('wa reader: only today\'s times in the chat list', ['10:31', '10:31 AM', '9.05 pm', 'Yesterday', 'Mon', '17/10/2026'].map(H2.listTime), ['10:31', '10:31 AM', '9.05 pm', '', '', '']);
  const T0 = new Date(2026, 9, 18, 10, 30).getTime();
  check('wa reader: relative times', [H2.relTime(T0 - 10000, T0), H2.relTime(T0 - 125000, T0), H2.relTime(T0 - 2 * 3600e3, T0)], ['just now', '2 min ago', '2 h ago']);
  check('wa reader: messages per 10 minutes', H2.bins([T0 - 60e3, T0 - 120e3, T0 - 11 * 60e3, T0 - 3 * 3600e3], T0, 4), [0, 0, 1, 2]);
  check('wa reader: the box holds what we typed', [H2.sameText('⁣324 CO\ndone ', '324 CO done'), H2.sameText('324 CO', '325 CO')], [true, false]);
  check('wa reader: chips with an ask and with HotelOps\' words', [H2.chips('415 ckd').map(c => c.tone + ' ' + c.label).join(' / '), H2.chips('416 zz', H2.wordsLookup([{ w: 'zz', m: 'co', label: 'Zed' }])).map(c => c.label).join(), H2.chips('⁣324 CO done').map(c => c.label).join()],
    ['ask ❓ what is "ckd"?', '✓ CO 416 · ZZ Zed', '↗ sent from HotelOps']);
  // 🧾 guest left, waiting for Finance / Reservations
  check('wa finance hold', ['507 left, waiting finance', '507 left, waiting reservations', '507 guest left, folio with finance', '507 res to fix', '507 finance done', '507 fixed', '507 left'].map(t => P(t).actions.map(W2.chip).join()),
    ['🧾 507 guest left · waiting for Finance', '🧾 507 guest left · waiting for Reservations', '🧾 507 guest left · waiting for Finance', '🧾 507 guest left · waiting for Reservations', '✓ 507 fixed → check out', '✓ 507 fixed → check out', '✓ CO 507']);
  // typos: Ops Brain's matcher (wa-brain.js: hoWaBrainPure.wbReadCmd) — exact/likely act, unsure asks
  const FZ = r => { const w = String(r).toLowerCase().split(/\s+/)[0]; return { chekout: { m: 'co', conf: 'likely', word: 'chekout', tail: '' }, lcoo: { m: 'lco', conf: 'likely', word: 'lcoo', tail: r.split(/\s+/).slice(1).join(' ') }, cht: { m: 'co', conf: 'unsure', word: 'cht', tail: '' } }[w] || null; };
  const FX = t => { const r = sb.hoWaParse(t, { fuzzy: FZ }); return r.actions.map(W2.chip).join() + (r.ask ? ' ask ' + r.ask.word : ''); };
  check('wa typos: likely → done and marked guessed, unsure → asked, none → as before', ['415 chekout', '202 lcoo 6pm', '415 cht', '415 change bedsheet'].map(FX),
    ['✓ CO 415 · 🤔 guessed', '⏰ LCO 202 6 PM · 🤔 guessed', ' ask cht', '📝 note 415']);
  sb.hoWaBrainPure = { wbReadCmd: FZ };
  check('wa typos: picked up from window.hoWaBrainPure', A('415 chekout'), '415 co');
  delete sb.hoWaBrainPure;
  // talking normally: what the team writes in full sentences
  const NA = (t, now) => sb.hoWaParse(t, { now: now || '10:02' }).actions.map(a => [a.room, a.act, a.time || '', a.soon ? 'in' + a.soon : '', a.plan ? 'plan' : '', a.nights ? '+' + a.nights + 'N' : '', a.until ? '→' + a.until : '', a.act === 'note' ? a.note : ''].filter(Boolean).join(' ')).join(' | ');
  check('wa typos: "EXTENDE", "exended", "chekd out" are read (as a guess to confirm); look-alike words are not', ['310 - EXTENDE', '310 exended', '310 extedned 2n', '310 chekd out', '310 external door broken', '310 exit sign broken', '310 cheque payment', '310 checkout tomorrow'].map(t => P(t).actions.map(a => a.act + (a.nights ? a.nights : '') + (a.guess ? '?' : '')).join()),
    ['ext?', 'ext?', 'ext2?', 'co?', 'note', 'note', 'note', 'note']);
  check('wa ask: an unknown word is asked with a best guess first ("xtendd" → extension, "ckd" → checked out, "vacnt" → HK); no guess when nothing is close', ['310 xtendd', '310 ckd', '310 vacnt', '310 lte', '310 blabla'].map(t => { const a = P(t).ask; return a ? a.word + ':' + (a.guess || '-') : 'none'; }),
    ['xtendd:ext', 'ckd:co', 'vacnt:hk', 'lte:lco', 'blabla:-']);
  check('wa answers from the team: "Early Depart" and "please make check out" = checked out (not when it is for later or a question); a bare time = late check-out; "physical check out" = a request; "io" = IP',
    ['421 Early Depart', '421 early departure tomorrow', '421 early dep?', '524 523 please make check out', '524 make checkout tomorrow', '626 4 pm', '315 - 3 pm', '512 14:00', '512 2', '514 cleaning after 2pm', '105 physical check out', '203 io'].map(t => P(t).actions.map(a => a.room + ' ' + a.act + (a.time ? ' ' + a.time : '')).join(', ')),
    ['421 co', '421 note', '421 note', '524 co, 523 co', '524 note', '626 lco 16:00', '315 lco 15:00', '512 lco 14:00', '512 note', '514 note', '105 note', '203 note']);
  check('wa talk: "luggage inside" → the guest might extend; luggage in store is not', ['301 luggage inside', '301 bags still in the room', '301 room occupied', '301 occupied', '301 luggage in store', '301 luggage inside?', '301 needs towels'].map(t => P(t).actions.map(a => a.act).join()),
    ['maybe', 'maybe', 'maybe', 'maybe', 'note', 'note', 'note']);
  check('wa talk: "checking out in N min" → leaving soon, from the message\'s time, rounded up to 5 min',
    ['514 Checking out in 10mins', '514 checking out in half an hour', '514 checking out in 1 hour', '514 leaving in 10 min', '514 coming down in 5 min', '514 checking out 15 min', '514 leaving after 30 mins', '514 leaving 1hr', '514 co in 20', '514 checking out in 10-15 mins', '514 leaving in an hour and a half'].map(t => NA(t)),
    ['514 lco 10:15 in10', '514 lco 10:35 in30', '514 lco 11:05 in60', '514 lco 10:15 in10', '514 lco 10:10 in5', '514 lco 10:20 in15', '514 lco 10:35 in30', '514 lco 11:05 in60', '514 lco 10:25 in20', '514 lco 10:20 in15', '514 lco 11:35 in90']);
  check('wa talk: "now", "shortly", "checking out" with no time', ['514 going down now', '514 leaving now', '#514 leaving now', '514 coming down shortly', '514 checkingout'].map(t => NA(t, '13:50')),
    ['514 lco 13:55 in5', '514 lco 13:55 in5', '514 lco 13:55 in5', '514 lco 14:05 in15', '514 lco 13:55 in5']);
  check('wa talk: a time to leave at', ['514 will check out at 3pm', '514 check out at 2', '514 will leave around 1:30', '514 leaving by 2', '514 checkout around 2:30', '514 leaving until 4pm', '514 guest said she will check out at 3pm'].map(t => NA(t)),
    ['514 lco 15:00 plan', '514 lco 14:00 plan', '514 lco 13:30 plan', '514 lco 14:00 plan', '514 lco 14:30 plan', '514 lco 16:00 plan', '514 lco 15:00 plan']);
  check('wa talk: late check-out in words', ['514 wants late checkout till 2', '514 late check out 3pm', '514 needs till 4pm', '514 guest asked for late checkout until 3pm', '514 got LCO 4pm', '514 keeping the room till 3pm', '514 staying till 2pm'].map(t => NA(t)),
    ['514 lco 14:00', '514 lco 15:00', '514 lco 16:00', '514 lco 15:00', '514 lco 16:00', '514 lco 15:00', '514 lco 14:00']);
  check('wa talk: no clear time, or not sure → a note', ['514 checkout after lunch', '514 checking out tomorrow', '514 might leave at 3', '514 not leaving at 2pm', '514 leaving at 3?'].map(t => NA(t)),
    ['514 note checkout after lunch', '514 note checking out tomorrow', '514 note might leave at 3', '514 note not leaving at 2pm', '514 note leaving at 3?']);
  check('wa talk: housekeeping talk with a time stays a note', ['514 needs towels', '514 cleaning after 2pm', '514 guest going out at 3pm', '514 coming down to pay TD', '514 leaving luggage till 4pm', '514 DND till 2pm', '514 make up room at 3pm', '514 free upgrade', '514 staying', '514 khalas', '514 extra towels for 2 nights'].map(t => NA(t)),
    ['514 note needs towels', '514 note cleaning after 2pm', '514 note guest going out at 3pm', '514 note coming down to pay TD', '514 note leaving luggage till 4pm', '514 note DND till 2pm', '514 note make up room at 3pm', '514 note free upgrade', '514 note staying', '514 note khalas', '514 note extra towels for 2 nights']);
  check('wa talk: a room inside a sentence that is not a clear action → nothing, as before', ['please clean 514 after 2pm', 'call ext 2245', 'guest from 514 called reception'].map(t => P(t).kind), ['none', 'none', 'none']);
  check('wa talk: the guest has left', ['514 checked out', '514 has left', '514 is out', '514 gone', '514 vacated', '514 guest left the room', '514 room free', '514 keys at desk', '514 dep done', '514 departure done', '514 co khalas', '514 c/o done', '514 left the hotel already', '514\'s guest left', 'rm 514 gone', 'room 514 has left'].map(A), Array(16).fill('514 co'));
  check('wa talk: the room after the words', ['guest in 514 left', 'keys returned 514', 'checked out 514', 'the guest of room 514 checked out', 'guests in 514 and 516 left', 'keys returned 514, 516', 'dep done 514'].map(A),
    ['514 co', '514 co', '514 co', '514 co', '514 co | 516 co', '514 co | 516 co', '514 co']);
  check('wa talk: several rooms in one sentence', ['514 and 516 checked out', '514, 516, 520 left', '514 & 516 gone'].map(A), ['514 co | 516 co', '514 co | 516 co | 520 co', '514 co | 516 co']);
  check('wa talk: staying on (dates from the message\'s day: Mon 19 Oct 2026)',
    ['514 staying 2 more nights', '514 will stay one more night', '514 one more night', '514 another night', '514 another 2 nights', '514 wants to extend till Friday', '514 wants to extend until 25th', '514 staying till Sat', '514 ext till next friday', '514 extended 3 nights', '514 ext till 25/10', '514 extending tomorrow also', '514 staying tomorrow too', '514 extend 2n', '514 +2 nights', 'ext till 25/10 514'].map(t => NA(t, new Date(2026, 9, 19, 10, 0))),
    ['514 ext +2N', '514 ext +1N', '514 ext +1N', '514 ext +1N', '514 ext +2N', '514 ext →23/10', '514 ext →25', '514 ext →24/10', '514 ext →23/10', '514 ext +3N', '514 ext →25/10', '514 ext +1N', '514 ext +1N', '514 ext +2N', '514 ext +2N', '514 ext →25/10']);
  check('wa talk: may stay on → ⏳ extending', ['514 wants to extend but no booking yet', '514 thinking to extend', '514 may extend', '514 staying longer', '514 guest considering extending', '514 wants to extend'].map(t => NA(t)),
    ['514 extending', '514 extending', '514 extending', '514 extending', '514 extending', '514 extending']);
  check('wa talk: left, waiting for Finance / Reservations', ['514 left, waiting for finance', '514 left, balance pending', '514 left, res to correct rate', '514 guest left, bill not settled'].map(t => P(t).actions.map(W2.chip).join()),
    ['🧾 514 guest left · waiting for Finance', '🧾 514 guest left · waiting for Finance', '🧾 514 guest left · waiting for Reservations', '🧾 514 guest left · waiting for Finance']);
  check('wa talk: chips and keys for "checking out in 10 min"', [W2.chip({ room: '514', act: 'lco', time: '10:15', soon: 10 }), sb.hoWaPure.actionKey({ room: '514', act: 'lco', time: '10:15', soon: 10 })], ['⏱ 514 out in 10 min (≈ 10:15 AM)', '514:lco:in10:']);
  const ASKT = t => { const r = sb.hoWaParse(t, { now: '10:00' }); return r.ask ? r.ask.word : ''; };
  check('wa talk: everyday words are never asked about', ['514 khalas', '514 tamam', '514 yalla', '514 free', '514 empty', '514 leaving', '514 going', '514 soon', '514 dep', '514 mins', '514 checking out in 10 mins'].map(ASKT), Array(11).fill(''));
  check('wa talk: HotelOps\' own posts stay ignored', ['✅ HotelOps · 514 checking out in 10 min', '✅ HotelOps · 514 gone'].map(t => P(t).kind), ['ignore', 'ignore']);
  const corpus2 = ['CO\n101\n102', 'Checkout list:\n101 ✓', '212.319.504 all VD\n507 guest inside', '415 ckd', '507 extending, only TD left', '507 TD ✓ RC ✓', '⁣✅ HotelOps · Checkout list', '514 gone', 'guests in 514 and 516 left', '514 staying 2 more nights', '514 thinking to extend', '514 will check out at 3pm', '514 cleaning after 2pm'];
  check('wa snippet: the new rules read the same in the WhatsApp window', corpus2.map(t => JSON.stringify(H2.parser.hoWaParse(t))), corpus2.map(t => JSON.stringify(sb.hoWaParse(t))));
  // learned from a real HK group export (rewritten, made-up examples)
  const PC = t => J2(sb.hoWaParseCopied(t)), J2 = x => JSON.parse(JSON.stringify(x));
  check('wa export: iPhone "[7/22/26, 12:40:30 PM]", month first, media and forward marks, edited, deleted, system lines',
    PC('Messages and calls are end-to-end encrypted.\n[7/22/26, 12:40:30 PM] Sam Test: 516 ip\n[7/22/26, 1:00:07 PM] +971 50 000 0000: [Forwarded] <video omitted> 411 vd room\n[7/22/26, 1:02:00 PM] Lina Demo: 205 co <This message was edited>\n[7/22/26, 1:03:00 PM] Lina Demo: This message was deleted\n[7/22/26, 1:04:00 PM] Sam Test: <album message>\n[8/1/26, 9:10:00 AM] Sam Test: Physical check\n\n101\n102\n[8/1/26, 9:11:00 AM] - Sam Test added Lina Demo').map(m => [m.iso, m.time, m.text, !!m.edited, !!m.deleted]),
    [['2026-07-22', '12:40:30 PM', '516 ip', false, false], ['2026-07-22', '1:00:07 PM', '411 vd room', false, false], ['2026-07-22', '1:02:00 PM', '205 co', true, false], ['2026-07-22', '1:03:00 PM', '', false, true],
     ['2026-07-22', '1:04:00 PM', '', false, false], ['2026-08-01', '9:10:00 AM', 'Physical check\n\n101\n102', false, false]]);
  check('wa export: day first when the paste shows it, no guess when it does not', [PC('[18/10/2026, 9:01:05 AM] Sam: 324 CO\n[3/10/2026, 9:02:00 AM] Sam: 325 CO').map(m => m.iso), PC('[3/10/2026, 9:02:00 AM] Sam: 325 CO')[0].iso], [['2026-10-18', '2026-10-03'], undefined]);
  check('wa export: a Markdown export (day headings, bold names, quoted replies over several lines)',
    PC('# WhatsApp Chat Export: Test group\n\n---\n\n## 22 July 2026\n\n[12:40 PM] **Sam Test:** 516 ip\n\n[1:00 PM] **+971 50 000 0000:** [Forwarded] [Video] 411 vd room\n\n[1:45 PM] **Lina Demo:**\n> _Sam Test: Physical check\n\n101\n102_\nDone ✅\n\n[1:46 PM] **Sam Test:** _This message was deleted_\n\n[1:50 PM] __Sam Test added Lina Demo__\n\n---\n\n## 1 August 2026\n\n[9:00 AM] **Lina Demo:** 214 co').map(m => [m.iso, m.time, m.sender, m.text, m.quote || '', !!m.deleted]),
    [['2026-07-22', '12:40 PM', 'Sam Test', '516 ip', '', false], ['2026-07-22', '1:00 PM', '+971 50 000 0000', '411 vd room', '', false], ['2026-07-22', '1:45 PM', 'Lina Demo', 'Done ✅', 'Physical check\n\n101\n102', false],
     ['2026-07-22', '1:46 PM', 'Sam Test', '', '', true], ['2026-08-01', '9:00 AM', 'Lina Demo', '214 co', '', false]]);
  check('wa learned: HK status words are notes with their meaning, never a check-out', ['516 ip', '225 N/L', '513 sleep out', '614 double lock', '209 - NA', '406 ongoing', '617 IP @Sam Test'].map(A),
    ['516 note ip (Inspected — room ready)', '225 note N/L (No Luggage)', '513 note sleep out (Sleep Out)', '614 note double lock (Double Lock)', '209 note NA (No Answer)', '406 note ongoing (Cleaning in progress)', '617 note IP (Inspected — room ready)']);
  check('wa learned: IP and other HK words are not asked about any more', ['516 ip', '225 N/L', '405 sugar', '425 coffee', '219 tissue', '416 makeup', '509 staus', '310 cofee'].map(t => (P(t).ask || {}).word || ''), Array(8).fill(''));
  check('wa learned: questions about rooms never act ("any update", "vd update plz", "status?") — nothing is written either',
    ['101 112 204 207 any update Due out rooms plz@Sam Test', '214,321,325,303 any update due out room @Sam', '315/316/317 vd any updates', '106 vd update plz @Lina', '509 status?', '306 ready?', '412 any updated due out room'].map(t => P(t).actions.length), Array(7).fill(0));
  check('wa learned: a question keeps a room from acting, even with a command word in it', ['what about 309? check out or extend', '424 any update today due out extend?', '214 vd any update'].map(A), ['', '424 note any update today due out extend?', '']);
  check('wa learned: the room before the question still acts', A('417 co 322 any updates'), '417 co');
  check('wa learned: "VD room is ready" tells (checked out), only "ready?" asks', [A('210 vd room is ready ✅'), A('210 room is ready ✅'), P('210 ready?').actions.length], ['210 co', '210 note room is ready ✅', 0]);
  check('wa learned: "till 14:00 pm" and "2 PM check out" are late check-outs; a morning time is not', ['102 - till 14:00 pm', '412 - till 16: 00 pm', '108 - till 13;00 pm', '626 till 14:30 pm (gold member)', '517 5 pm check out', '218 - 2 PM CHECKOUT', '311 - till 10:00 am', '512 cleaning till 2pm'].map(A),
    ['102 lco 14:00', '412 lco 16:00', '108 lco 13:00', '626 lco 14:30', '517 lco 17:00', '218 lco 14:00', '311 note till 10:00 am', '512 note cleaning till 2pm']);
  check('wa learned: "Stay Extended", "extended room cleaning", "extended but no need clean" are extended', ['209 Stay Extended', '206 Stay Extended, room makeup, guest outside', '301 - extended room cleaning', '412 extended and request room cleaning', '310 extended but no need cleaning'].map(A),
    ['209 ext', '206 ext', '301 ext', '412 ext', '310 ext']);
  check('wa learned: "on extension" is on its way (⏳), not extended; "extended but not paid" stays a note', ['206 - on Extension', '310 extended but not paid'].map(A), ['206 extending', '310 note extended but not paid']);
  check('wa learned: C/out, "Room : 205", forwarded and image lines, "physically checked out"', ['415 C/out', '415 c/out, please prepare asap', 'Room: 312 checkout.', '[Forwarded] 205 - co', '<image omitted> 525 - luggages inside', '206 physically checkedout', '105 physical check out'].map(A),
    ['415 co', '415 co', '312 co', '205 co', '525 maybe luggages inside', '206 co', '105 note physical check out']);
  check('wa learned: luggage and OCC rooms might extend; "no luggage" / "occ room no luggage" are notes', ['306 - luggages inside', '517 inside luggage', '303 luggage 🧳 inside', '526 OCC room @Sam', '320 occ room no luggage', '417 no luggage 🧳'].map(t => P(t).actions.map(a => a.act).join()),
    ['maybe', 'maybe', 'maybe', 'maybe', 'note', 'note']);
  check('wa learned: lists under "See the below …" headings', ['See the below extension\n\n223\n224', 'See the below late departure\n\n107 - till 14:00 pm\n315 - till 15:00 pm', 'Physical check\n\n101\n102', 'Please inspect the below rooms for DND\n\n510\n511\n\nThank you 🙏'].map(A),
    ['223 extending | 224 extending', '107 lco 14:00 | 315 lco 15:00', '', '']);
  check('wa learned: room moves and requests stay notes', ['522 move to 202 (twin bed )', '516 moved to 517 ceiling leakage', '513 - cleaning service', '522 - baby cot'].map(A),
    ['522 note move to 202 (twin bed )', '516 note moved to 517 ceiling leakage', '513 note cleaning service', '522 note baby cot']);
  check('wa learned: a mention is cut, the message is still read', ['@Sam Test 105 send towels', '325 - Extended @Lina Demo', '301 co plz@Sam'].map(A), ['105 note send towels', '325 ext', '301 co']);
  check('wa learned: "305 payment done" alone may be an amenity: only for a room that is extending', P('305 payment done ✅').actions.map(a => a.act + (a.weak ? ' weak' : '')), ['extending weak']);
  check('wa learned: HotelOps\' own summaries shared by hand are ignored', ['✅ *Checked Out — 12:31*\nRooms: 0210, 0218', '📵 NA Rooms — 13:25\n📵 0204 · 11:46', '🏨 HK Update — 14:20\n🕐 2 LCO\n\n0301  ⏳ Extending', '✅ Checked Out (last 30 min) — 11:58\n✓ 0308 · 11:48'].map(t => P(t).kind), Array(4).fill('ignore'));
}

console.log('\nWhatsApp × Ops Brain');
{
  const sb = { console: { log() {}, warn() {}, error() {} } }; sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'wa-bridge.js'), 'utf8'), sb, { filename: 'wa-bridge.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'wa-brain.js'), 'utf8'), sb, { filename: 'wa-brain.js' });
  const B = sb.hoWaBrainPure, J = x => JSON.parse(JSON.stringify(x)), P = sb.hoWaParse;
  const cat = t => B.wbCategorize(t).map(c => c.id).join(',');
  // rooms and categories
  check('wab rooms: rooms, not times, money, phone extensions or dates', [B.wbRooms('Rm 324 towels at 4pm, ext 2245, AED 1200, 0113 and 405'), B.wbRooms('202 LCO 1800'), B.wbRooms('18/10/2026 9:01 call 201')].map(J), [['324', '0113', '405'], ['202'], ['201']]);
  check('wab categories: requests', ['305 towels and toliet paper pls', '201 bedsheet change', '410 make up room please', '512 2 water bottles', '602 baby cot', '603 extra bed', '604 iron pls', '605 shampoo and slippers', '606 luggage pick up'].map(cat),
    ['towel,tp', 'linen', 'clean', 'water', 'cot', 'xbed', 'iron', 'amen', 'luggage']);
  check('wab categories: maintenance (water problems are plumbing, not a water request)', ['201 no hot water and AC not working', '503 shower leaking', '711 TV remote broken', '712 light not working', '713 smell of smoke', '714 cockroach', '715 door lock', '716 wifi', '717 something broken'].map(cat),
    ['ac,plumb', 'plumb', 'tv', 'elec', 'smell', 'pest', 'door', 'wifi', 'fix']);
  const rq = t => !!B.wbRequestOf({ x: t }, P);
  check('wab request detection: room + request words; status reports, commands and answers are not requests',
    ['201 towels please', '305 AC not working', '410 come asap', '201 clean', '201 ready ✅', '324 CO', '202 LCO 6PM', 'towels please', '201 towels given ✅'].map(rq), [true, true, true, false, false, false, false, false, false]);
  // unanswered requests
  const recs = [{ t: '09:00', s: 'Sam', x: '201 towels please' }, { t: '09:10', s: 'Lina', x: '305 AC not working asap' }, { t: '09:20', s: 'Alex', x: '305 done ✅' }, { t: '09:30', s: 'Sam', x: '324 CO' },
    { t: '09:35', s: 'Sam', x: '201 still waiting towels' }, { t: '09:40', s: 'Lina', x: '510 water pls' }, { t: '09:45', s: 'Alex', x: '510 sent' }, { t: '10:05', s: 'Sam', x: '407 bedsheet pls' }];
  const OR = (n, o) => B.wbOpenRequests(recs, n, Object.assign({ parse: P }, o)).map(o => o.room + ' ' + o.age + ' ' + B.wbWhat(o.cats));
  check('wab unanswered: a reply about the room closes it; a second ask by the same person does not', OR(600), ['201 60 towels']);
  check('wab unanswered: not before 30 min', [OR(629).length, OR(640)], [1, ['201 100 towels', '407 35 bedsheets']]);
  const one = B.wbOpenRequests(recs, 640, { parse: P })[0];
  check('wab unanswered: "Mark handled" hides it', OR(640, { handled: new Set([one.id]) }), ['407 35 bedsheets']);
  check('wab unanswered: ids stay the same between devices', B.wbOpenRequests(recs, 640, { parse: P })[0].id === one.id, true);
  // repeats
  const day = d => '2026-10-' + d;
  check('wab repeats: a room 3+ times today', J(B.wbRepeatsToday([{ x: '503 AC' }, { x: '503 still hot' }, { x: 'room 503 guest calling' }, { x: '201 towels' }, { x: '201 ok' }])), [{ room: '503', key: '503', n: 3 }]);
  const byDay = { [day(18)]: [{ x: '503 AC not cold' }], [day(16)]: [{ x: '503 aircon noise' }], [day(14)]: [{ x: 'rm 503 a/c' }, { x: '201 tv' }], [day(10)]: [{ x: '201 tv' }] };
  check('wab repeats: the same problem on 3 days in a week', J(B.wbRepeatIssues(byDay, day(18)).map(i => [i.room, i.cat.id, i.days])), [['503', 'ac', 3]]);
  // stats and tips
  const L = [];
  for (let i = 0; i < 6; i++) L.push({ day: day(18), rec: { t: '09:' + (10 + i), s: 'Sam', x: (301 + i) + ' towels pls' } });
  L.push({ day: day(18), rec: { t: '10:30', s: 'Lina', x: '503 AC not working' } }, { day: day(18), rec: { t: '10:40', s: 'Lina', x: '503 AC still not working' } }, { day: day(18), rec: { t: '11:00', s: 'Lina', x: '503 AC again' } },
    { day: day(18), rec: { t: '15:00', s: 'Alex', x: '302 water please' } }, { day: day(18), rec: { t: '16:00', s: 'Alex', x: '302 CO' } });
  const S = B.wbStats(L, P);
  check('wab stats: messages, requests, most requested, busiest hour, rooms', [S.msgs, S.reqs, B.topOf(S.cats, 2), S.byHour[9], B.topOf(S.rooms, 1)], [11, 10, [['towel', 6], ['ac', 3]], 6, [['503', 3]]]);
  const Sp = B.wbStats([{ day: day(10), rec: { t: '10:00', s: 'Sam', x: '503 AC not working' } }], P);
  check('wab tips: share with the busy hours, and a trend', B.wbTips(S, Sp, null).slice(0, 2), ['Towels are 60% of requests, most between 9–11 AM — stock the HK trolley before 9 AM.', 'AC complaints more than doubled (1 → 3) compared with the period before.']);
  // room moves
  check('wab moves: from / to', ['move 302 to 405', '302 → 405', '302 moved to 405 because AC', 'RM 302 to 405', 'guest shifted from 503 to 711 noise', 'morning shift to start', 'upgrade 410 to 1201', '302 room change', 'Rm324 c/o', '201 towels'].map(t => { const m = B.wbMoveOf(t); return m ? m.from + '>' + m.to : null; }),
    ['302>405', '302>405', '302>405', '302>405', '503>711', null, '410>1201', '302>', null, null]);
  const ML = [{ day: day(18), rec: { t: '09:00', s: 'Sam', x: '503 AC not cooling' } }, { day: day(18), rec: { t: '10:00', s: 'Lina', x: 'move 503 to 711' } }, { day: day(17), rec: { t: '10:00', s: 'Lina', x: '503 → 712 noise' } },
    { day: day(17), rec: { t: '12:00', s: 'Lina', x: '410 upgraded to 1201' } }, { day: day(16), rec: { t: '08:00', s: 'Sam', x: '205 dirty' } }, { day: day(16), rec: { t: '13:00', s: 'Sam', x: '205 move to 206' } }];
  const MV = B.wbMoves(ML);
  check('wab moves: reason from the same message, or from the room\'s messages in the 2 h before', MV.map(m => [m.from, m.to, m.reason.id, m.reason.src]), [['205', '206', 'unknown', ''], ['503', '712', 'noise', 'same'], ['410', '1201', 'upgrade', 'same'], ['503', '711', 'ac', 'before']]);
  const MS = B.wbMoveSummary(MV);
  check('wab moves: why rooms move and the rooms that keep causing them', [MS.total, MS.reasons.length, J(MS.repeat.map(r => [r.room, r.n, r.tip]))], [4, 4, [['503', 2, 'Ask maintenance to check 503\'s AC']]]);
  check('wab problem rooms', J(B.wbProblemRooms(ML, MV).slice(0, 2).map(o => [o.room, o.issues, o.moves, o.top[0][0]])), [['503', 1, 2, 'AC / cooling'], ['205', 0, 1, 'Not said']].slice(0, 1).concat([J(B.wbProblemRooms(ML, MV).slice(1, 2).map(o => [o.room, o.issues, o.moves, (o.top[0] || [''])[0]]))[0]]));
  check('wab tips: moves', B.wbTips(B.wbStats(ML, P), null, MS).filter(t => /moves?\b/.test(t)), ['Room 503 caused 2 of 4 moves.', 'Ask maintenance to check 503\'s AC (2 moves).']);
  // reminders
  const RM = (t, x) => B.wbRemindersOf({ t, s: 'Sam', x }, P).map(r => [B.clock(r.at), r.text, r.day]);
  check('wab reminders: a late check-out at 6 PM → 5:45 PM and 6:05 PM', RM('09:05', '202 LCO 6PM'), [['5:45 PM', 'Room 202 late check-out at 6 PM — check if they\'re ready', 0], ['6:05 PM', 'Room 202 is past its 6 PM late check-out', 0]]);
  check('wab reminders: "remind 305 taxi at 4" → 3:55 PM', RM('14:10', 'remind 305 taxi at 4'), [['3:55 PM', 'Room 305 taxi at 4 PM', 0]]);
  check('wab reminders: in 30 min, no time (+30 min), tomorrow morning', [RM('09:05', 'call 201 in 30 min'), RM('09:05', 'follow up 415 laundry'), RM('22:00', 'remind 0113 tomorrow morning breakfast')],
    [[['9:35 AM', 'Room 201 call', 0]], [['9:35 AM', 'Room 415 follow up laundry', 0]], [['8:30 AM', 'Room 0113 breakfast (this morning)', 1]]]);
  check('wab reminders: plain messages and commands make none', [RM('09:00', '324 CO'), RM('09:00', '201 towels please'), RM('09:00', 'ok')], [[], [], []]);
  check('wab when: times', [B.wbParseWhen('at 4', 600), B.wbParseWhen('by 10:30am', 600), B.wbParseWhen('in 2 hours', 600), B.wbParseWhen('room 405 ok', 600)].map(w => w && [w.min, w.label]), [[960, '4 PM'], [630, '10:30 AM'], [720, 'in 2 hours'], null]);
  check('wab shift end (default hours)', [600, 1000, 1400, 120].map(B.wbShiftEndDefault), [900, 1380, 1860, 420]);
  // words colleagues type
  const fz = w => { const t = w.split(' '), f = B.wbFuzzyWord(t[0], t[1]); return f ? f.m + '/' + f.conf : '-'; };
  check('wab words: typos read as commands', ['ckod', 'chkd', 'chkout', 'cheked out', 'chked', 'c.o.', 'cout', 'ckd', 'extn', 'exnd', 'xtnd', 'extd', 'extnd', 'lco', 'l.c.o', 'latco', 'late c/o', 'lt co'].map(fz),
    ['co/likely', 'co/likely', 'co/exact', 'co/likely', 'co/likely', 'co/exact', 'co/likely', 'co/unsure', 'ext/exact', 'ext/likely', 'ext/likely', 'ext/exact', 'ext/exact', 'lco/exact', 'lco/exact', 'lco/likely', 'lco/exact', 'lco/likely']);
  check('wab words: safe words stay words', ['ok', 'cold', 'code', 'co-worker', 'cool', 'out', 'exit', 'extra', 'lock', 'check', 'clean'].map(fz), Array(11).fill('-'));
  check('wab words: phone extensions, "out of order" and long sentences are not commands', ['ext. 2245', 'call him on ext 2245', 'out of order', 'co-worker is here', 'ckod guest left luggage'].map(t => B.wbReadCmd(t, {})), [null, null, null, null, null]);
  check('wab words: a typo with nights or a time', [J(B.wbReadCmd('xtnd 2n', {})), J(B.wbReadCmd('latco 6pm', {}))].map(x => x.m + ' ' + x.conf + ' ' + x.tail), ['ext likely 2n', 'lco likely 6pm']);
  const store = {}, puts = {};
  const Wd = B.wbMakeWords({ load: () => null, save: v => { store.v = v; } }, (k, e) => { puts[k] = e; }, () => 'Sam');
  check('wab dictionary: built-in housekeeping codes', ['VD', 'v.d', 'VC', 'VCI', 'ED', 'OD', 'OOO', 'DND', 'SO', 'NS', 'C/O', 'LC', 'EXT', 'XYZ'].map(w => { const e = Wd.lookup(w); return e ? e.m : null; }),
    ['co', 'co', 'co', 'co', 'co', 'hk', 'note', 'hk', 'hk', 'note', 'co', 'lco', 'ext', null]);
  check('wab dictionary: status lists', J(Wd.read('VD: 315, 402, 518\n320 VD\n330, 331 OD\n340 OD guest wants towels\n350 VD, 351 OD').map(s => s.room + ' ' + s.word + ' ' + s.m)), ['315 vd co', '402 vd co', '518 vd co', '320 vd co', '330 od hk', '331 od hk', '350 vd co', '351 od hk']);
  let changes = 0; Wd.onChange(() => changes++);
  Wd.add('VD', 'note', 'Our VD means something else');
  check('wab dictionary: a word the team added wins over the built-in one, saved with who and when', [Wd.lookup('vd').m, Wd.lookup('vd').note, puts.vd.by, puts.vd.m, !!puts.vd.at, changes], ['note', 'Our VD means something else', 'Sam', 'note', true, 1]);
  Wd.remove('vd'); const off = Wd.lookup('vd'), offAll = Wd.all().some(e => e.key === 'vd'), offList = Wd.allWithOff().find(e => e.key === 'vd').off; Wd.restore('vd');
  check('wab dictionary: a built-in word can be turned off and back on', [off, offAll, offList, Wd.lookup('vd').m, Wd.lookup('vd').label, puts.vd], [null, false, true, 'co', 'Vacant Dirty — the guest has left', null]);
  Wd.add('ckd', 'co'); Wd.remove('ckd');
  check('wab dictionary: a team word is deleted', [Wd.lookup('ckd'), puts.ckd, Wd.all().some(e => e.key === 'ckd')], [null, null, false]);
  Wd.setRemote({ zz: { m: 'ext', by: 'Lina', at: 1 }, bad: { m: 'nonsense' } });
  check('wab dictionary: the team\'s words from the database', [Wd.lookup('zz').m, Wd.lookup('bad'), Wd.lookup('vd').m], ['ext', null, 'co']);
  check('wab dictionary: learned words come before typo guesses', [J(B.wbReadCmd('zz', Wd.dict())).conf, J(B.wbReadCmd('VD', Wd.dict())).m, J(B.wbReadCmd('ckod', Wd.dict())).conf], ['learned', 'co', 'likely']);
  const A = B.wbMakeAsk({ load: () => null, save: () => {} }, Wd, () => 'Sam');
  check('wab questions: unknown words in a message', J(B.wbAskCandidates('415 ckd\n416 ckod\n417 VD\n418 change bed\n419 OD', Wd.dict())).map(c => c.room + ' ' + c.word + ' ' + c.m + ' ' + c.conf), ['415 ckd co unsure', '416 ckod co likely', '417 vd co learned']);
  const q1 = A.add({ word: 'ckd', room: '415', text: '415 ckd', sender: 'Sam', key: 'k1' }), q2 = A.add({ word: 'CKD', room: '420', text: '420 ckd', sender: 'Lina', key: 'k2' });
  check('wab questions: one per message, none for a known word', [A.list().length, A.add({ word: 'ckd', room: '415', text: '415 ckd', key: 'k1' }).id === q1.id, A.add({ word: 'VD', room: '1', text: 'x', key: 'k3' })], [2, true, null]);
  let heard = null; A.onAnswer(x => { heard = x; });
  const hit = A.answer('ckd', 'co');
  check('wab questions: an answer applies to every waiting message with that word and teaches the dictionary', [hit.map(h => h.room), heard.meaning, A.list().length, Wd.lookup('ckd').m, J(B.wbReadCmd('ckd', Wd.dict())).conf], [['415', '420'], 'co', 0, 'co', 'learned']);
  check('wab questions: a bad meaning is refused', A.answer('xx', 'maybe'), []);
  // the requests log (every room, in-house or departing)
  check('wab requests log: what closes a request', ['206 cleaned', '206 ✓', 'towels sent 201', '201 not done yet?', '201 towels pls', '206 done, 207 please clean', '305 still not cleaned', '410 ok'].map(t => B.wbDoneOf({ x: t })),
    [['206'], ['206'], ['201'], [], [], ['206'], [], ['410']]);
  const R2 = [{ t: '09:10', s: 'Sam', x: '206 cleaning please', g: 'HK' }, { t: '09:20', s: 'Lina', x: '201 towels pls' }, { t: '09:35', s: 'Alex', x: '206 cleaned ✅' }, { t: '13:02', s: 'Sam', x: '206 towels please' },
    { t: '13:10', s: 'Lina', x: '201 not done yet?' }, { t: '13:20', s: 'Lina', x: '305 ✓' }];
  const RL = B.wbRequestLog(R2, 800, {}, [{ id: 'm1', room: '410', what: 'Iron', t: '12:00', by: 'Sam' }], { parse: P, day: '2026-10-18' });
  check('wab requests log: status by itself from the chat, open time, overdue, added by hand', RL.map(i => [i.room, i.what, i.st, i.doneT, i.open, i.overdue]),
    [['206', 'towels', 'open', '', 18, false], ['410', 'Iron', 'open', '', 80, true], ['201', 'towels', 'open', '', 240, true], ['206', 'cleaning', 'done', '09:35', 25, false]]);
  const tow = RL.find(i => i.room === '201');
  const RL2 = B.wbRequestLog(R2, 800, { [tow.id]: { st: 'done', by: 'Lina', at: new Date(2026, 9, 18, 13, 30).getTime() } }, [], { parse: P, day: '2026-10-18' });
  check('wab requests log: "Done" tapped by the team', (x => [x.st, x.doneBy, x.how, x.doneT, x.open])(RL2.find(i => i.room === '201')), ['done', 'Lina', 'tap', '13:30', 250]);
  check('wab requests log: asked again = the same request', B.wbRequestLog([{ t: '09:00', s: 'Lina', x: '503 AC not working' }, { t: '09:05', s: 'Lina', x: '503 AC still not cold' }, { t: '09:30', s: 'Sam', x: '503 fixed' }], 600, {}, [], { parse: P }).map(i => [i.room, i.again, i.st, i.doneT]), [['503', 1, 'done', '09:30']]);
  check('wab requests log: per-room history', B.wbRoomHistory(RL, '206'), '206: cleaning 9:10 AM ✅ 9:35 AM · towels 1:02 PM 🟡');
  check('wab requests log: any room, even one not departing, and a past day is not overdue', B.wbRequestLog([{ t: '09:00', s: 'Sam', x: '1205 water please' }], 0, {}, [], { parse: P, past: true }).map(i => [i.room, i.st, i.overdue]), [['1205', 'open', false]]);
  // Brain questions about the chat
  const CQ = q => { const x = B.wbChatQuery(q); return x && [x.room, x.act, x.words.join('+'), x.day, x.q].join('|'); };
  check('wab brain search: what to look for', ['324', 'room 324', 'what happened with 0113', 'towels', 'who checked out 407', 'late checkouts today', 'how do I post TD for a day use guest', 'fix: the board'].map(CQ),
    ['324||||324', '324||||324', '0113||||0113', '||towel||towel', '407|co|||407', '|lco||today|lco', null, null]);
  const rec = { t: '09:01', s: 'Sam', x: '0113 EXT 2N', r: 'ext 0113 +2N → 20 Oct' };
  check('wab brain search: matches', [B.wbChatMatch(rec, B.wbChatQuery('what happened with 113'), P), B.wbChatMatch(rec, B.wbChatQuery('who checked out 0113'), P), B.wbChatMatch({ t: '09:00', s: 'Lina', x: '201 Towels pls' }, B.wbChatQuery('towels'), P), B.wbChatMatch({ x: '202 LCO 6PM' }, B.wbChatQuery('late checkouts today'), P)],
    [true, false, true, true]);
  // HK Requests: what is (not) a request, learned from a real HK group (made-up examples)
  const RQ = x => { const q = B.wbRequestOf({ t: '10:00', s: 'Sam', x }, P); return q ? q.rooms.map(r => r + ':' + ((q.byRoom && q.byRoom[String(parseInt(r, 10))]) || q.cats).map(c => c.id).join('+')).join(' ') : '-'; };
  check('wab requests: a blanket is a blanket, not pillows', [RQ('105 send heavy blanket'), RQ('108 pillow and blanket'), B.wbWhat(B.wbCategorize('105 send heavy blanket'))], ['105:blanket', '108:pillow+blanket', 'blanket']);
  check('wab requests: what is not wanted is not a request ("no need cleaning", "do not clean", "no luggage"); problems still are',
    ['310 - extended but no need cleaning', '624 - do not clean for today', '622 no luggage', '310 dont clean, guest sleeping', '412 no hot water', '202 room not clean please', '503 AC not working'].map(RQ),
    ['-', '-', '-', '-', '412:plumb', '202:clean', '503:ac']);
  check('wab requests: a payment note for the front office is not an HK job; giving something and taking payment still is',
    [RQ('325 guest will pay the laundry bill by card at reception, pls dont forget to collect payment'), RQ('322 1 dental kit guest will pay at reception'), RQ('621 one slipper give to guest and take payment also')], ['-', '-', '621:amen']);
  check('wab requests: each room with its own words; HK statuses (IP, OCC, luggage inside, sleep out) are not requests',
    [RQ('203 physically IP, smoke smell 206, 506 physically IP wall paint smell'), RQ('516 ip'), RQ('526 OCC room @Lina Demo'), RQ('513 sleep out with luggage 🧳\n@Lina Demo'), RQ('102, 507 ..... VD\n410 ..... luggage inside\n104 ..... DND')], ['206:smell 506:smell', '-', '-', '-', '-']);
  check('wab requests: asking for updates, or asking FO to check out, is not an HK job; tea bags are not luggage',
    [RQ('101 112 204 any update due out rooms plz @Sam'), RQ('524 523 516 please make check out'), RQ('310 tea bags'), RQ('520 please assist with luggage down')], ['-', '-', '310:amen', '520:luggage']);
  const RLc = B.wbRequestLog([{ t: '10:00', s: 'Sam', x: '513 - cleaning service' }, { t: '10:20', s: 'Lina', x: 'Done ✅', q: '513 - cleaning service' }, { t: '10:30', s: 'Sam', x: '522 - baby cot' }, { t: '10:40', s: 'Lina', x: 'ok' , q: '522 - baby cot' }], 660, {}, [], { parse: P });
  check('wab requests log: "Done ✅" in reply to a request closes it by itself; a plain "ok" does not', RLc.map(i => i.room + ' ' + i.st + ' ' + i.doneBy), ['522 open ', '513 done Lina']);
  check('wab requests log: calm by default — "Sent to HK" / "Done by HK", no timers; tracking brings Open / Done back',
    [RLc.map(i => B.wbReqStatus(i, false).text + '|' + B.wbReqStatus(i, false).sub), RLc.map(i => B.wbReqStatus(i, true).text)], [['📨 Sent to HK|', '✓ Done by HK 10:20 AM|Lina'], ['🟡 Open', '✅ Done 10:20 AM']]);
  check('wab done replies', ['Done ✅', 'done', 'ok done', '✅', 'Delivered', 'Done with Payment ✅', 'ok', 'not done yet', '305 done'].map(B.wbDoneReply), [true, true, true, true, true, true, false, false, false]);
}

// ── Room notes (departures.js): the note text → timeline entries, types, edit and delete ──
{
  console.log('\nRoom notes');
  const src = fs.readFileSync(path.join(ROOT, 'departures.js'), 'utf8');
  const code = src.slice(src.indexOf('// ── Room notes: parser (pure'), src.indexOf('// ── end room notes parser'));
  const sb = {}; vm.createContext(sb);
  vm.runInContext(code + '\nthis.N = { DPN_CAT, dpnParse, dpnCat, dpnTagCat, dpnVia, dpnBody, dpnLine, dpnReplace, dpnPreview, dpnPart };', sb);
  const N = sb.N;
  const NOTE = ['Guest asked for a quiet room next time',
    '[09:05] Late check-out 2 PM — WhatsApp · Sam 9:05 AM',
    '[09:20] WhatsApp · Lina 9:20 AM: 101 change bedsheet and towels',
    '[9:40] Luggage in store, 3 bags',
    'tag 4471, behind the desk',
    '',
    'Untimed line after a gap',
    '[10:02] 🧾 Guest left · waiting for Finance',
    '[10:10] Called, no answer',
    '[10:12] [Taxi] Car at 4 PM please',
    '[10:15] ',
    '[13:52] Checked out — WhatsApp · Sam 1:52 PM (edited)'].join('\n');
  const E = N.dpnParse(NOTE);
  check('room notes: entries (empty stamps dropped), times padded, continuation kept', E.map(e => [e.time, e.cat, e.count]),
    [['', 'vip', 1], ['09:05', 'lco', 1], ['09:20', 'hk', 1], ['09:40', 'lug', 2], ['', 'gen', 1], ['10:02', 'fin', 1], ['10:10', 'call', 1], ['10:12', 'taxi', 1], ['13:52', 'co', 1]]);
  check('room notes: a [Category] tag wins and is taken off the text', [E[7].tag, E[7].text, E[7].cat], ['Taxi', 'Car at 4 PM please', 'taxi']);
  check('room notes: WhatsApp sender and the plain text', [E[1].via, E[1].body, E[2].via.who, E[2].body, E[8].via.edited],
    [{ src: 'WhatsApp', who: 'Sam', at: '9:05 AM', edited: '' }, 'Late check-out 2 PM', 'Lina', '101 change bedsheet and towels', 'edited']);
  check('room notes: types from words', ['Paid by card', 'TD paid', 'AC not working', 'Taxi to the airport at 5', 'Guest may extend 2 nights', 'Opera updated — Extended 2N, AED 300/night', 'DND sign on the door', 'Waiting for reservations', 'VIP: welcome amenity', 'hello', 'WhatsApp · Sam 9:01 AM: ok'].map(N.dpnCat),
    ['pay', 'pay', 'mnt', 'taxi', 'ext', 'ext', 'call', 'fin', 'vip', 'gen', 'wa']);
  check('room notes: tags by name or short word', ['Luggage', 'late co', 'Housekeeping', 'Call / DND', 'td', 'Nope'].map(N.dpnTagCat), ['lug', 'lco', 'hk', 'call', 'pay', null]);
  check('room notes: a new line', [N.dpnLine('10:28', 'lug', ' Luggage in store, 2 bags ', true), N.dpnLine('10:28', 'gen', 'Hi', true), N.dpnLine('', 'pay', 'Paid', false)],
    ['[10:28] [Luggage] Luggage in store, 2 bags', '[10:28] Hi', 'Paid']);
  check('room notes: edit replaces just that entry (both of its lines)', N.dpnReplace(NOTE, E[3], '[09:40] [Luggage] 2 bags').split('\n').slice(3, 6), ['[09:40] [Luggage] 2 bags', '', 'Untimed line after a gap']);
  check('room notes: delete removes the entry and tidies blank lines', N.dpnReplace('[09:00] a\n\n[10:00] b\n\n[11:00] c', N.dpnParse('[09:00] a\n\n[10:00] b\n\n[11:00] c')[1], null), '[09:00] a\n\n[11:00] c');
  check('room notes: card preview = pinned, else newest', [N.dpnPreview(NOTE, '[10:10] Called, no answer').text, N.dpnPreview(NOTE, 'gone').time, N.dpnPreview('', '')], ['Called, no answer', '13:52', null]);
  check('room notes: parts of the day', ['04:10', '09:00', '12:00', '18:30', '22:00', ''].map(N.dpnPart), ['Night', 'Morning', 'Afternoon', 'Evening', 'Night', 'No time']);
}

// ── Departures board (departures.js): states, counters, filters, undo, reload — on a set clock ──
{
  console.log('\nDepartures board');
  const els = {}, el = id => els[id] || (els[id] = { id, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, textContent: '', innerHTML: '', value: '', querySelectorAll: () => [], querySelector: () => null, setAttribute() {}, appendChild() {}, addEventListener() {}, focus() {} });
  const toasts = [];
  const sb = { console: { log() {}, warn() {}, error() {} }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { readyState: 'complete', addEventListener() {}, getElementById: el, querySelectorAll: () => [], querySelector: () => null, createElement: () => el('x' + Math.random()), head: { appendChild() {} }, body: { appendChild() {} }, documentElement: { getAttribute: () => null } },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, requestAnimationFrame: () => 0, navigator: {}, addEventListener() {}, MutationObserver: class { observe() {} },
    showToast: m => toasts.push(m), saveDepartures: () => Promise.resolve(), fbUpdate() {}, fbSet() {}, fbListen() {}, logActivity() {}, confirm: () => true, prompt: () => null };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(`(() => { const R = Object.getPrototypeOf(Date); let FIX = new R(2026, 9, 20, 14, 0).getTime();
    class D extends R { constructor(...a) { if (a.length) super(...a); else super(FIX); } static now() { return FIX; } }
    globalThis.Date = D; globalThis.setNow = (h, m) => { FIX = new R(2026, 9, 20, h, m).getTime(); };
    globalThis.hoLocalISO = d => { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }; })()`, sb);
  vm.runInContext(['utils.js', 'state.js', 'departures.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n') +
    '\n;globalThis.DB = { set rooms(v) { depRooms = v; depLog = []; }, get rooms() { return depRooms; }, get log() { return depLog; }, filter(f) { depFilter_ = f; depRender(); return [...document.getElementById("depGrid").innerHTML.matchAll(/data-room="(\\w+)"/g)].map(m => m[1]); } };', sb, { filename: 'departures-bundle.js' });
  const mk = (n, o) => Object.assign({ room: n, roomStr: String(n), name: 'TEST GUEST ' + n, arrival: '19-OCT-26', departure: '20-OCT-26', nights: 1, balance: 0, source: 'Booking.com', company: '', rateCode: '', isVip: false, depTime: '', status: 'due', lateTime: '', extensionNights: 0, intent: '', note: '', checkoutAt: '' }, o);
  const st = o => { sb.DB.rooms = [mk(101, o)]; const r = sb.DB.rooms[0]; return [sb.effectiveStatus(r), sb._depIsOverdue(r)]; };
  check('dep: due past 12:00 is overdue; its own Opera time makes it late', [st({}), st({ depTime: '11:00' }), st({ depTime: '15:00' })], [['due', true], ['late', true], ['due', false]]);
  check('dep: tomorrow\'s list is never late or overdue today (it was, with a departure time)', [st({ departure: '21-OCT-26', depTime: '11:00' }), st({ departure: '21-OCT-26' }), st({ departure: '21-OCT-26', intent: 'extending' })], [['due', false], ['due', false], ['due', false]]);
  check('dep: a room still due from an earlier day\'s list is overdue', st({ departure: '19-OCT-26' }), ['due', true]);
  check('dep: extending / finance hold are not late or overdue before 6 PM; extending is after it', [st({ depTime: '11:00', intent: 'extending' }), st({ depTime: '11:00', intent: 'finance_hold' }), (sb.setNow(18, 30), st({ intent: 'extending' })), st({ intent: 'finance_hold' })], [['due', false], ['due', false], ['due', true], ['due', false]]);
  sb.setNow(14, 0);
  check('dep: a date like 2026-10-20 (a room added by hand) reads as that day', sb._depIsoOf(sb.parseOperaDate('2026-10-20')), '2026-10-20');
  sb.DB.rooms = [mk(301, { departure: '21-OCT-26' })]; sb.depAddManualRoom('350', 'test');
  check('dep: a room added by hand takes the board\'s day', sb.DB.rooms.find(r => r.manual).departure, '21-OCT-26');
  // counters = the cards each filter shows
  sb.DB.rooms = [mk(101), mk(102, { status: 'dnd' }), mk(103, { status: 'na' }), mk(104, { intent: 'extending' }), mk(105, { intent: 'finance_hold' }),
    mk(106, { status: 'extended', extensionNights: 2, intent: 'extending' }), mk(107, { status: 'out', intent: 'maybe_extend' }), mk(108, { intent: 'maybe_extend' })];
  const todo = sb.DB.filter('all');
  check('dep: the To do chip counts the cards it shows (DND too)', [el('dfc-all').textContent, todo.length], [6, 6]);
  const due = sb.DB.filter('due');
  check('dep: Due = the cards that say DUE OUT (not ⏳ extending / 🧾 left)', [el('dfc-due').textContent, due], [2, ['101', '108']]);
  const may = sb.DB.filter('maybe_extend');
  check('dep: May extend chip = its list (not extended or checked-out rooms)', [el('dfc-maybe_extend').textContent, may], [2, ['104', '108']]);
  sb.depBulkCheckout();
  check('dep: check out all due leaves extending, may-extend and finance-hold rooms', sb.DB.rooms.map(r => r.status).join(' '), 'out dnd na due due extended out due');
  // undo from the log brings the time back
  sb.DB.rooms = [mk(201, { status: 'late', lateTime: '15:00' }), mk(202, { status: 'dnd', dndTime: '09:00' }), mk(203, { status: 'na', naTime: '10:30' })];
  [0, 1, 2].forEach(i => sb.depAction(i, 'out'));
  [2, 1, 0].forEach(() => sb.depUndoLog(sb.DB.log.findIndex(l => l.action === 'out')));
  check('dep: ↺ in the log puts LCO / DND / NA back with their times', sb.DB.rooms.map(r => r.status + ' ' + (r.lateTime || r.dndTime || r.naTime)), ['late 15:00', 'dnd 09:00', 'na 10:30']);
  // the agreed-time box on a room that turned late by itself
  sb.DB.rooms = [mk(301, { depTime: '11:00' })]; sb.depSetLateTime(0, '16:00');
  check('dep: an agreed time on an auto late room makes it a real late check-out', [sb.DB.rooms[0].status, sb.DB.rooms[0].lateTime, sb._depIsOverdue(sb.DB.rooms[0])], ['late', '16:00', false]);
  // check out from a No answer card asks about the balance
  sb.DB.rooms = [mk(401, { status: 'na', balance: 300 })]; sb.DB.filter('all');
  check('dep: Check out on a No answer card warns about the balance', /onclick="depCheckOut\(0\)"/.test(el('depGrid').innerHTML), true);
  sb.DB.rooms = [mk(402, { status: 'na', intent: 'extending' })]; sb.DB.filter('all');
  check('dep: an extending room set to No answer says so on its badge', /⏳ EXTENDING · NA</.test(el('depGrid').innerHTML), true);
  sb.DB.rooms = [mk(403, { intent: 'checkout_soon', intentMinutes: 15, intentAt: '13:40' })]; sb.DB.filter('all');
  check('dep: checking out in 15 min shows the time it means', /Checking Out by 13:55/.test(el('depGrid').innerHTML), true);
  // finance fixed → checked out: the hold stays on the record until the check-out is done (so undo gets it back)
  sb.DB.rooms = [mk(501, { intent: 'finance_hold', finWho: 'Finance', finAt: '12:00' })];
  let seen = null; const da = sb.depAction; sb.depAction = (...a) => { seen = sb.DB.rooms[0].intent; return da(...a); };
  sb.depFinanceDone(0); sb.depAction = da;
  check('dep: Fixed → check out: checked out, hold cleared after (undo sees the hold)', [sb.DB.rooms[0].status, sb.DB.rooms[0].intent, seen], ['out', '', 'finance_hold']);
  // reload
  const HDR = 'ROOM\tGUEST_NAME\tARRIVAL\tDEPARTURE\tNIGHTS\tBALANCE\tTRAVEL_AGENT_NAME\tCOMPANY_NAME\tSOURCE_NAME\tRATE_CODE\tVIP\tDEPARTURE_TIME\tA\tB\tC';
  const row = (n, d) => `${n}\tTEST,GUEST\t19-OCT-26\t${d}\t1\t0\t\t\tWEB\tBAR\t\t\t\t\t`;
  sb.DB.rooms = [mk(601, { status: 'out', checkoutAt: '10:00' }), mk(602, { intent: 'extending', extBook: true, note: '[09:00] hi' })]; sb.depAddManualRoom('650', '');
  el('depReloadInput').value = [HDR, row(601, '20-OCT-26'), row(602, '20-OCT-26'), row(650, '20-OCT-26'), row(603, '20-OCT-26')].join('\n'); sb.processDepReload();
  check('dep: same-day reload keeps tracking, adds new rooms (the last one too, with empty end columns), a hand-added room on the report is no longer "by hand"',
    sb.DB.rooms.map(r => [r.roomStr, r.status, r.intent || '', !!r.extBook, !!r.manual]), [['601', 'out', '', false, false], ['602', 'due', 'extending', true, false], ['603', 'due', '', false, false], ['650', 'due', '', false, false]]);
  el('depReloadInput').value = [HDR, row(601, '21-OCT-26'), row(604, '21-OCT-26')].join('\n'); el('depInput').value = ''; sb.processDepReload();
  check('dep: another day\'s report in Reload is a fresh board, not merged into today\'s', sb.DB.rooms.map(r => r.roomStr + ' ' + r.status + ' ' + r.departure), ['601 due 21-OCT-26', '604 due 21-OCT-26']);
}

// ── Roster picture (roster-ocr.js): the on-device reader's pure helpers ──
{
  console.log('\nRoster picture');
  const sb = { console: { log() {}, warn() {}, error() {} }, localStorage: { getItem() { return null; }, setItem() {} }, fbSet() {}, showToast() {}, escapeHtml: x => String(x),
               document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; } }, window: {}, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, navigator: {} };
  vm.createContext(sb);
  for (const f of ['roster.js', 'roster-ocr.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  const run = js => vm.runInContext(js, sb);
  // a made-up Excel roster: "18-Oct / Sun" (last week's Sunday) before "Employee Name", then 19–25 Oct
  sb.H = [['18-Oct', 'Employee Name', '19-Oct', '20-Oct', '21-Oct', '22-Oct', '23-Oct', '24-Oct', '25-Oct'], ['Sun', '', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']];
  check('picture: a day column before the names is last week, the names column after it, then 7 days', run('JSON.stringify(_roOcrLayout(H, 9))'), JSON.stringify({ name: 1, days: [2, 3, 4, 5, 6, 7, 8], prev: [0] }));
  check('picture: "Employee Name" misread: the first column with no date holds the names', run(`JSON.stringify(_roOcrLayout([['18-Oct', 'Emp|oyee', '19-Oct', '20-Oct', '21-Oct'], ['Sun', '', 'Mon', 'Tue', 'Wed']], 5))`), JSON.stringify({ name: 1, days: [2, 3, 4], prev: [0] }));
  check('picture: the usual layout (names first) is unchanged', run(`JSON.stringify(_roOcrLayout([['Employee Name', '5 Oct', '6 Oct', '7 Oct', '8 Oct']], 5))`), JSON.stringify({ name: 0, days: [1, 2, 3, 4], prev: [] }));
  check('picture: no header read at all: names first', run('JSON.stringify(_roOcrLayout([], 8))'), JSON.stringify({ name: 0, days: [1, 2, 3, 4, 5, 6, 7], prev: [] }));
  check('picture: a "Total" column after the days is not a day', run(`_roOcrLayout([['Staff', 'Mon', 'Tue', 'Wed', 'Thu', 'Total']], 6).days.join()`), '1,2,3,4');
  check('picture: 8 day columns: the week starts on the Monday', run(`[_roOcrWeekStart(['2026-10-18','2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-24','2026-10-25']), _roOcrWeekStart(['2026-10-19','2026-10-20'])].join()`), '1,0');
  check('picture: hours written any way read as "HH:MM - HH:MM"', run(`['08:00 -17:00', '19:00-04:00', '00:00 - 09:00', '15:00 - 00:00', '9:00-18:00'].map(t => _roOcrTime(t).s + (_roOcrTime(t).ok ? '' : ' ?')).join(' | ')`),
    '08:00 - 17:00 | 19:00 - 04:00 | 00:00 - 09:00 | 15:00 - 00:00 | 09:00 - 18:00');
  check('picture: a note after the hours is kept', run(`_roOcrTail('12:00 - 21:00  ibis') + '|' + _roOcrTail('12:00 - 21:00 - Adagio') + '|' + _roOcrTail('19:00-04:00')`), 'ibis|Adagio|');
  check('picture: OFF, V and Training; one letter read twice is that code', run(`['0FF', 'V', 'VV', 'Training', 'ALA'].map(w => _roOcrWord(w, roAllCodes())).join()`), 'OFF,V,V,Training,ALA');
  check('picture: "employee number - name", 6 or 7 digits', run(`[_roOcrName('001032 - Sam Lee'), _roOcrName('0001051 - Lina Park Oo')].map(n => n.id + '|' + n.name).join(' / ')`), '001032|Sam Lee / 0001051|Lina Park Oo');
  check('picture: a hotel title, never the roster title', run(`[_roOcrGroupName('Mercure DD'), _roOcrGroupName('Cluster Roster DD 2026 - Front Office')].join('|')`), 'Mercure DD|');
  // a misread seen three times ("18:00 - 04:00" next to many "19:00 - 04:00") is marked to check
  check('picture: a frequent misread of an odd length is marked to check', run(`
    const N = '19:00 - 04:00', S = '09:00 - 18:00', people = [
      { day: [N, N, N, N, N, 'OFF', N] }, { day: [S, S, S, S, 'OFF', S, S] }, { day: [N, N, 'OFF', N, N, N, N] },
      { day: ['00:00 - 09:00', '00:00 - 09:00', '00:00 - 09:00', 'OFF', S, S, S] }, { day: ['OFF', '18:00 - 04:00', '18:00 - 04:00', '18:00 - 04:00', N, N, N] }];
    _roOcrFix(people); people[4].day.slice(0, 5).join(' | ') + ' // ' + people[0].day[0]`), 'OFF | 18:00 - 04:00 ? | 18:00 - 04:00 ? | 18:00 - 04:00 ? | 19:00 - 04:00 // 19:00 - 04:00');
}

console.log('\nHandover Book');
{
  const sb = { console: { log() {}, warn() {}, error() {} } }; sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of ['wa-bridge.js', 'wa-brain.js', 'handover-book.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  const H = sb.hoHandoverPure, J = x => JSON.parse(JSON.stringify(x)), parse = sb.hoWaParse, opt = { parse };
  // handover groups and the "HO -" mark
  check('ho group: names with HO or handover', ['HO - Ibis Styles', 'Ibis HO', 'Shift Handover', 'hand-over FO', 'HK Ibis Styles', 'Hotel Ops', 'HOTEL TEAM', 'Housekeeping'].map(n => H.isHandoverGroup(n)), [true, true, true, true, false, false, false, false]);
  check('ho group: switched on or off by hand wins', [H.isHandoverGroup('FO team', true), H.isHandoverGroup('HO - Ibis', false)], [true, false]);
  check('ho mark: HO -, HO:, ho, H/O, Handover: start a handover item', ['HO - Room 512 to twin', 'HO: balance 300 412', 'ho 512 ED', 'H/O 305 refund', 'Handover: taxi 5am', 'HO-512 ok'].map(H.hoPrefix), ['Room 512 to twin', 'balance 300 412', '512 ED', '305 refund', 'taxi 5am', '512 ok']);
  check('ho mark: HOTEL…, HOLD…, "Hold on", "Hotel 512 ok" and a bare "HO" do not', ['HOTEL guest in 512', 'HOLD 512', 'Hold on', 'Hotel 512 ok', 'HO', 'Housekeeping 512'].map(H.hoPrefix), [null, null, null, null, null, null]);
  // shifts
  check('shift: Morning 07–15, Afternoon 15–23, Night 23–07', ['07:00', '14:59', '15:00', '22:59', '23:00', '06:59', '00:30', ''].map(H.shiftOf), ['Morning', 'Morning', 'Afternoon', 'Afternoon', 'Night', 'Night', 'Night', '']);
  check('shift: the boundaries are one constant', H.SHIFT_BOUNDS.map(s => s.id + ' ' + s.from / 60 + '-' + s.to / 60), ['Morning 7-15', 'Afternoon 15-23', 'Night 23-7']);
  // splitting a message into items
  check('split: bullets become items; greeting and thanks are dropped', J(H.splitItems('Good morning team\n- 305 balance AED 200 pending\n- 412 TD collected\n• 512 AC leaking, engineering informed\nThanks')).map(x => x.text),
    ['305 balance AED 200 pending', '412 TD collected', '512 AC leaking, engineering informed']);
  check('split: a heading "Pending:" goes with the lines under it', J(H.splitItems('Pending:\n305 refund\n412 invoice')), [{ text: '305 refund', head: 'Pending' }, { text: '412 invoice', head: 'Pending' }]);
  check('split: a sentence carried on to the next line stays one item', J(H.splitItems('Guest in 305 asked for late checkout\nuntil 2pm, approved by manager')).map(x => x.text), ['Guest in 305 asked for late checkout until 2pm, approved by manager']);
  check('split: numbered lines and "ok" under a list', J(H.splitItems('Handover morning shift\n1. 512 early depart\n2) 305 refund\nok')).map(x => x.text), ['512 early depart', '305 refund']);
  check('split: one line is one item', J(H.splitItems('512 early departure')).length, 1);
  // categories and status
  const cs = t => H.categorize(t) + ' ' + H.statusOf(t, H.categorize(t));
  check('category: front office topics', ['512 early depart', 'room 514 need to be shifted to 2beds', 'Upgrade 305 to suite', '305 balance AED 200 pending', 'Refund done 410', 'Invoice requested by company for 410', 'City ledger for 207',
    '512 AC leaking', 'OOO 512 smell', 'Extra bed 305', 'Laundry for 512', 'Taxi booked to airport 5am room 210', 'Lost phone found in 310', 'Float 2000 handed over', 'Wake-up call 6am room 305', 'Passport copy missing 410',
    'Police visit for 512', '305 DND no answer', 'VIP arriving 9pm room 701', 'Guest in 305 complained about noise', 'Breakfast for 305 at 6am', 'Late arrival 302 ETA 2am', 'Group arrival tomorrow 20 rooms pre-registered', 'No-show 214',
    'Follow up tomorrow please', 'Printer in back office'].map(cs),
    ['res open', 'move open', 'move open', 'pay open', 'pay info', 'pay open', 'pay info', 'maint open', 'maint open', 'hk info', 'hk info', 'transport info', 'lost info', 'cash info', 'desk info', 'desk open',
     'desk info', 'desk open', 'guest open', 'guest info', 'fb info', 'res open', 'res open', 'res info', 'follow open', 'info info']);
  // rooms and tags
  check('rooms: rooms, not money, times, phone extensions or dates', ['Rm 324 towels at 4pm, ext 2245, AED 1200, 0113 and 405', '202 LCO 1800', '18/10/2026 call 201', 'pay 1,200 for 305', 'Oct 2026 room 512'].map(t => J(H.roomsOf(t))), [['324', '0113', '405'], ['202'], ['201'], ['305'], ['512']]);
  check('tags: what the WhatsApp reader understands, and handover words', ['202 LCO 2pm', '324 CO', '0113 EXT 2N', 'VIP 701 birthday', '512 early depart', '512 balance pending'].map(t => H.tagsOf(t, parse).join(',')), ['LCO 2 PM', 'CO', 'EXT +2N', 'VIP,Celebration', 'ED', '']);
  // tidy English
  const TD = { 'room 512 have bad smell': 'Room 512 has a bad smell.', 'room 514 need to be shifted to 2beds': 'Room 514 needs to be shifted to 2 beds.', 'room 512 Early Depart': 'Room 512: early departure.',
    'pls chk 305 balance tmrw': 'Please check 305 balance tomorrow.', 'Mr Gust called, he have TD pending': 'Mr Gust called, he has TD pending.', '324 CO': 'Room 324: check-out.', 'LCO 2pm for 202': 'Late check-out 2 PM for 202.',
    'ac not working in 305 , engineering informed': 'AC not working in 305, engineering informed.', 'recieved payement from guset': 'Received payment from guest.', 'i will f/u w/ guest asap': 'I will follow-up with guest ASAP.',
    'Room 512 has to be shifted to twc tomorrow': 'Room 512 has to be shifted to twin tomorrow.', 'the guest have to pay 200 aed before 6pm': 'The guest has to pay 200 AED before 6 PM.', '512 - balance AED 300 pending': 'Room 512: balance AED 300 pending.',
    'Room 511 and Room 512 have no hot water': 'Room 511 and Room 512 have no hot water.', 'Did the guest have breakfast?': 'Did the guest have breakfast?', 'call ext 2245 for the guest': 'Call ext 2245 for the guest.', 'dont forget msg to u': "Don't forget message to you." };
  check('tidy: clean, professional English', Object.keys(TD).map(H.tidy), Object.values(TD));
  const digits = s => (s.match(/\d+/g) || []).join(' ');
  const keepT = ['512 balance 1,200.50 AED, call +971 50 123 4567 at 18:30', 'Sam Lee in 0113 paid 300 on 20/10/2026 at 3.30pm', 'Mr Gust and Ms Pol in 214, conf 88213, 2N'];
  check('tidy: never changes numbers, times or names', keepT.map(t => digits(H.tidy(t)) === digits(t) && ['Sam Lee', 'Gust', 'Pol'].every(n => !t.includes(n) || H.tidy(t).includes(n))), [true, true, true]);
  // a message in another group: a handover item, or not?
  const lk = t => H.looksLikeHandover(t, opt);
  check('auto-pick: handover items from any group', ['512 early depart', 'room 514 need to be shifted to 2beds', '512 AC not working', 'Room 305 guest complained about noise', 'Taxi booked for 305 at 5am', 'Balance pending 412', 'Lost phone found in 310'].map(lk), [true, true, true, true, true, true, true]);
  check('auto-pick: never room commands, HK requests or chat', ['324 CO', '202 LCO 6pm', '0113 EXT 2N', 'VD: 402, 518', '305 towels please', '201 cleaned', '514 checking out in 10 mins', 'guest in 514 left', 'Please check', 'ok noted', 'Good morning team'].map(lk), Array(11).fill(false));
  // team chat in the handover group
  check('ho group chat: kept aside', ['ok', 'Noted 👍', 'Thanks Sam', 'who is on shift?', 'on my way', '<Media omitted>', 'Good night team', 'done', '👍👍', 'yes'].map(H.isChat), Array(10).fill(true));
  check('ho group chat: anything with substance is handover', ['512 balance 300', 'Mr Lee arriving 10 PM', 'Room 305 done', 'Please call the guest in the morning', 'who will collect the TD from 512?'].map(H.isChat), [false, false, false, false, false]);
  const B = H.buildItems({ base: 'm1', date: '2026-10-20', time: '09:05', sender: 'Sam Test', group: 'HO - Test', text: 'Handover morning\n- 512 early depart\n- 305 balance AED 200 pending\nok' }, { parse, ho: true });
  check('items: one per line, linked to the message, tidy + original kept', B.map(i => [i.key, i.msg, i.part + '/' + i.parts, i.text, i.orig, i.cat, i.status, i.shift, i.rooms.join()]),
    [['m1_1', 'm1', '1/2', 'Room 512: early departure.', '512 early depart', 'res', 'open', 'Morning', '512'], ['m1_2', 'm1', '2/2', 'Room 305: balance AED 200 pending.', '305 balance AED 200 pending', 'pay', 'open', 'Morning', '305']]);
  check('items: a lone "ok" in the handover group is team chat; "HO -" always counts', [H.buildItems({ base: 'a', time: '10:00', text: 'ok' }, { parse, ho: true })[0].chat, H.buildItems({ base: 'b', time: '10:00', text: 'HO - ok 512 moved to twin' }, { parse, ho: true })[0].chat, H.buildItems({ base: 'c', time: '10:00', text: 'HO - Room 512 to twc tomorrow' }, { parse })[0].text],
    [1, undefined, 'Room 512 to twin tomorrow.']);
  // paste anything
  const PA = J(H.pasteItems('[1:07 PM, 20/10/2026] Sam Test: 512 early depart\n[1:09 PM, 20/10/2026] Lina Demo: ok\n[1:10 PM, 20/10/2026] Lina Demo: HO - 305 balance pending', { parseCopied: sb.hoWaParseCopied }));
  check('paste: a copied WhatsApp chat keeps who and when; chat is marked', PA.map(x => [x.text, x.sender, x.time, x.date, x.chat]), [['512 early depart', 'Sam Test', '13:07', '2026-10-20', false], ['ok', 'Lina Demo', '13:09', '2026-10-20', true], ['305 balance pending', 'Lina Demo', '13:10', '2026-10-20', false]]);
  check('paste: an e-mail without headers, greeting, signature or quotes', J(H.pasteItems('From: Front Office\nSubject: handover\n\nDear team,\n\n1. 512 early departure tomorrow\n2. 305 refund AED 200 pending\n\nRegards\n-- \nAlex Demo\n> old quoted')).map(x => x.text), ['512 early departure tomorrow', '305 refund AED 200 pending']);
  check('paste: Opera trace notes, one per stamp with its time', J(H.pasteItems('20-OCT-26 14:05 JDOE Guest requests late c/o 2pm room 512\n20-OCT-26 15:10 ASMITH Airport pickup booked 6am 305')).map(x => x.time + ' ' + x.text), ['14:05 Guest requests late c/o 2pm room 512', '15:10 Airport pickup booked 6am 305']);
  check('paste: a typed list', J(H.pasteItems('512 ED\n305 taxi 5am\n410 TD pending')).length, 3);
  // suggestions from HotelOps' own data
  const SG = J(H.suggestFrom({ rooms: [{ roomStr: '512', status: 'late', lateTime: '14:00' }, { roomStr: '305', intent: 'finance_hold', finWho: 'Accounts', status: 'due' }, { roomStr: '210', status: 'out', note: 'x' }], hk: [{ room: '201', what: 'towels', s: 'HK Ana', t: '09:00' }],
    mt: { a: { area: '512', problem: 'AC leaking', status: 'open' }, b: { area: '601', problem: 'TV', status: 'fixed' } }, lf: { c: { what: 'black phone', room: '310', status: 'found', at: Date.now() } }, now: new Date(2026, 9, 20, 15, 0) }));
  check('suggestions: late check-out past time, finance hold, open HK request, open ticket, lost & found (not checked-out rooms or fixed tickets)', SG.map(s => s.cat + ': ' + s.text), ['res: Room 512: late check-out until 2 PM — time has passed.', 'pay: Room 305: guest left — waiting for Accounts before check-out.', 'hk: Room 201: towels still open (asked by HK Ana at 9:00 AM).', 'maint: Room 512: AC leaking — maintenance ticket open.', 'lost: Lost & found: black phone from Room 310.']);
  // filters, summary, Excel, e-mail
  const day = B.concat([{ key: 'x', date: '2026-10-20', time: '16:10', shift: 'Afternoon', sender: 'Lina Demo', text: 'VIP in 701.', orig: 'VIP in 701', cat: 'guest', rooms: ['701'], tags: ['VIP'], status: 'done', doneBy: 'Lina Demo', doneAt: new Date(2026, 9, 20, 17, 5).getTime(), note: 'Amenity sent', src: 'copy', group: 'HK Ibis' },
    { key: 'y', date: '2026-10-20', time: '10:00', text: 'ok', orig: 'ok', chat: 1, status: 'info' }, { key: 'z', date: '2026-10-20', time: '11:00', text: 'gone', del: 1, status: 'open' }]);
  check('filter: shift, status, room, search, source; chat and deleted never show', [{ shift: 'Afternoon' }, { st: 'open' }, { room: '701' }, { q: 'balance' }, { src: 'auto' }, { src: 'marked' }, {}].map(f => H.filterItems(day, f).map(i => i.key).join()), ['x', 'm1_1,m1_2', 'x', 'm1_2', 'x', 'm1_1,m1_2', 'm1_1,m1_2,x']);
  check('summary: items, open, done, rooms', (({ items, open, done, rooms }) => [items, open, done, rooms])(H.summaryOf(day)), [3, 2, 1, 3]);
  check('urgent: VIP / complaint / ASAP while not done', [H.isUrgent({ orig: 'VIP 701 arriving', status: 'open' }), H.isUrgent({ orig: 'guest complained', status: 'info' }), H.isUrgent(day[2]), H.isUrgent({ orig: '512 ED', status: 'open' })], [true, true, false, false]);
  const XR = H.excelRows(day);
  check('excel: the columns', XR[0], ['Date', 'Shift', 'Time', 'From', 'Category', 'Rooms', 'Item', 'Status', 'Done by', 'Note']);
  check('excel: rows in time order, tidy text, done by, note', XR.slice(1).map(r => r.join(' | ')), ['20/10/2026 | Morning | 9:05 AM | Sam Test | Reservations | 512 | Room 512: early departure. [ED] | Pending |  | ', '20/10/2026 | Morning | 9:05 AM | Sam Test | Payment & billing | 305 | Room 305: balance AED 200 pending. | Pending |  | ',
    '20/10/2026 | Afternoon | 4:10 PM | Lina Demo | Guest / complaint | 701 | VIP in 701. [VIP] | Done | Lina Demo · 5:05 PM | Amenity sent']);
  check('excel: the original text as an extra column', H.excelRows(day, { orig: true }).map(r => r[10]), ['Original', '512 early depart', '305 balance AED 200 pending', 'VIP in 701']);
  const SR = H.summaryRows(day, '2026-10-20', 'Test Hotel');
  check('excel summary: counts by category and shift, the open items', [SR.rows[0][0], SR.rows.find(r => r[0] === 'Payment & billing').join(), SR.rows.find(r => r[0] === 'Morning').join(), SR.rows.filter(r => r.length === 5 && r[1] !== 'Time').length, SR.bold.length], ['Shift handover – 20 Oct 2026 – Test Hotel', 'Payment & billing,1,1', 'Morning,2,2', 2, 4]);
  check('excel: the file name', [H.fileName('Ibis Styles', '2026-10-20'), H.fileName('A/B: Hotel', '2026-01-05')], ['Handover - Ibis Styles - 20 Oct 2026.xlsx', 'Handover - A B Hotel - 5 Jan 2026.xlsx']);
  const st = H.polishStyles('<styleSheet><fonts count="1"><font/></fonts><fills count="2"><fill/><fill/></fills><cellXfs count="1"><xf/></cellXfs></styleSheet>');
  const sh = H.polishSheet('<worksheet><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="G2" t="s"><v>1</v></c><c r="B2"/></row></sheetData></worksheet>', { head: st.head, wrap: st.wrap, boldRows: [1], wrapCols: ['G'], freeze: true });
  check('excel: bold header style, wrapped column and frozen first row are written in the XML', [st.head, st.wrap, /<fonts count="2">.*<b\/>/.test(st.xml), /<cellXfs count="3">/.test(st.xml), /<c s="1" r="A1"/.test(sh), /<c s="2" r="G2"/.test(sh), /<c r="B2"\/>/.test(sh), /state="frozen"/.test(sh)], [1, 2, true, true, true, true, true, true]);
  // the styled Excel report (ExcelJS): pure model and style picks
  check('excel style: status colours (Pending amber, Done green, Info grey)', ['open', 'done', 'info', 'x'].map(s => H.statusStyle(s).fill + ' ' + H.statusStyle(s).label), ['FFFEF3C7 Pending', 'FFD1FAE5 Done', 'FFF1F5F9 Info', 'FFF1F5F9 Info']);
  check('excel style: a soft colour per category, Info for unknown', [H.catStyle('pay').fill, H.catStyle('maint').font, H.catStyle('nope').fill, H.CATS.every(c => /^FF[0-9A-F]{6}$/.test(H.catStyle(c[0]).fill))], ['FFDCFCE7', 'FF9A3412', 'FFF1F5F9', true]);
  check('excel style: the app colour as ARGB', ['#c2410c', '#fa0', 'rgb(37, 99, 235)', ' #E8B84A ', 'var(--x)', ''].map(H.argbOf), ['FFC2410C', 'FFFFAA00', 'FF2563EB', 'FFE8B84A', '', '']);
  check('excel style: taller rows for long wrapped text', [H.rowHeight(['short'], [60]), H.rowHeight(['x'.repeat(130)], [60]), H.rowHeight(['a\nb\nc'], [60]), H.rowHeight([''], [60], 24)], [21, 51, 51, 24]);
  const RM = H.reportModel(day, { hotel: 'Test Hotel', date: '2026-10-20', user: 'Demo User', exportedAt: new Date(2026, 9, 20, 17, 42).getTime() });
  check('excel report: title block and KPIs', [RM.title, RM.meta, J(RM.kpis)], ['Test Hotel — Shift Handover', 'Tuesday 20 October 2026   ·   Shifts: Morning, Afternoon   ·   Prepared by Demo User   ·   Exported 20 Oct 2026, 17:42',
    [['Items', 3, 'ink'], ['Pending', 2, 'open'], ['Done', 1, 'done'], ['Urgent', 0, 'urgent'], ['Rooms', 3, 'rooms']]]);
  check('excel report: one section per shift with its rows, status and category', RM.sections.map(x => [x.label, x.count, x.open, x.rows.map(r => r.cells[6] + ' | ' + r.status + ' | ' + r.cat + (r.done ? ' | done' : '')).join(' / ')]),
    [['Morning', 2, 2, 'Room 512: early departure.  [ED] | open | res / Room 305: balance AED 200 pending. | open | pay'], ['Afternoon', 1, 0, 'VIP in 701.  [VIP] | done | guest | done']]);
  check('excel report: columns, the Original column on demand, counts by category and shift, open items', [RM.head.join(), RM.widths.length, H.reportModel(day, { orig: true }).head.length, J(RM.byCat.map(x => [x.label, x.items, x.open, x.done])), J(RM.byShift.map(x => [x.label, x.items])), RM.open.map(o => o.cells[3]), J(RM.totals)],
    ['Date,Shift,Time,From,Category,Rooms,Item,Status,Done by,Note', 10, 11, [['Guest / complaint', 1, 0, 1], ['Payment & billing', 1, 1, 0], ['Reservations', 1, 1, 0]], [['Morning', 2], ['Afternoon', 1]], ['Room 512: early departure.', 'Room 305: balance AED 200 pending.'], { items: 3, open: 2, done: 1 }]);
  { const PH = H.pdfHtml(RM);
    check('pdf report: title, every item, status and category colours, escaped text', [PH.includes('Test Hotel — Shift Handover'), RM.sections.every(sec => sec.rows.every(r => PH.includes(r.cells[6].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')))), PH.includes('background:#fef3c7'), H.cssOf('FFC2410C'), H.pdfHtml(H.reportModel([{ key: 'x', time: '08:00', shift: 'Morning', text: '<b>x</b>', cat: 'info', status: 'info' }], {})).includes('&lt;b&gt;x&lt;/b&gt;')], [true, true, true, '#c2410c', true]); }
  { const PPL = [{ name: 'SAM TESTER', info: { type: 'afternoon', from: '12:00', to: '21:00' } }, { name: 'LINA DEMO', me: true, info: { type: 'morning', from: '07:00', to: '16:00' } }, { name: 'RIO EXAMPLE', info: { type: 'night', from: '23:00', to: '07:00' } }];
    check('handover shift from the roster: the writer\'s shift, else mine, with the hours', [J(H.rosterShiftOf(PPL, '~ Sam Tester', false)), J(H.rosterShiftOf(PPL, 'Unknown Person', false)), J(H.rosterShiftOf(PPL, 'Rio', false)), H.rosterShiftOf([], 'Sam', false), H.sameName('Sam T', 'SAM TESTER'), H.sameName('Samir', 'SAM TESTER'), H.hoursOf([{ shiftHours: '12:00–21:00' }, { shiftHours: '12:00–21:00' }, { shiftHours: '15:00–00:00' }])],
      [{ id: 'Afternoon', hours: '12:00–21:00', who: 'SAM TESTER' }, { id: 'Morning', hours: '07:00–16:00', who: 'LINA DEMO' }, { id: 'Night', hours: '23:00–07:00', who: 'RIO EXAMPLE' }, null, true, false, '12:00–21:00']); }
  { const EX = [{ t: H.learnToks('Good morning team, coffee machine broken in staff room'), v: 'no' }, { t: H.learnToks('Room 512 guest wants invoice copy emailed'), v: 'yes' }];
    check('handover learning: the same kind of message is left out or kept, a near one is asked, others untouched', [H.learnToks('Room 512 guest wants late check-out 2pm please'), J(H.learnedVerdict('good morning team, coffee machine broken in the staff room again', EX)).v, J(H.learnedVerdict('Room 701 guest wants invoice copy emailed', EX)).v, J(H.learnedVerdict('coffee machine broken in lobby', EX)).v, H.learnedVerdict('Room 305 balance AED 200 pending', EX), H.learnedVerdict('ok', EX)],
      [['wants', 'late', 'check', 'out'], 'no', 'yes', 'ask', null, null]); }
  { const EX = [{ t: H.learnToks('Room 512 parking card lost'), v: 'cat:desk', at: 1 }, { t: H.learnToks('Room 512 parking card lost'), v: 'st:info', at: 1 }];
    check('handover learning: your topic and pending/info choices, and your word fixes', [H.learnedField('Room 220 parking card lost again', EX, 'cat'), H.learnedField('Room 220 parking card lost again', EX, 'st'), H.learnedField('Room 305 balance pending', EX, 'cat'),
      J(H.wordSwaps('Room 512 has bad smel in bathroom.', 'Room 512 has bad smell in bathroom.')), J(H.wordSwaps('Guest in 220 left keys.', 'Guest in 220 left the keys.')), H.applySwaps('Bad smel in 610, smel strong.', [['smel', 'smell']]), J(H.wordSwaps('Room 512 at 2 PM.', 'Room 514 at 3 PM.'))],
      ['desk', 'info', '', [['smel', 'smell']], [], 'Bad smell in 610, smell strong.', []]); }
  { const D = '2026-10-21', TT = t => Date.parse(D + 'T' + t + ':00');
    const IT = [{ key: 'a', date: D, time: '13:50', group: 'HO', text: 'Room 401: blocked as out of service.', orig: '401 Blocked as out of service for a meeting today', rooms: ['401'], status: 'open', cat: 'res' },
      { key: 'b', date: D, time: '14:52', group: 'HO', text: 'Room 506 to collect 90 AED.', orig: '506 to collect 90 /- AED', rooms: ['506'], status: 'open', cat: 'pay' },
      { key: 'd', date: D, time: '20:22', group: 'HO', text: '606 needs to be shifted tomorrow.', orig: '606 need to be shifted to a twin tomorrow', rooms: ['606'], status: 'open', cat: 'move' }];
    const top = (q, r, o) => (H.doneTargets(IT, q, r, o)[0] || {}).key || '';
    check('handover "Done" replies: what counts as done, and which item it closes (quote, room, verb, timing)',
      [!!H.doneReply('Done ✅'), !!H.doneReply('ok done'), J(H.doneReply('506 collected')), H.doneReply('Done, but the guest wants a receipt'), H.doneReply('who is on?'),
       top('401 Blocked as out of service for a meeting today', [], { text: 'Done', group: 'HO', at: TT('23:12') }), top('', ['506'], { text: '506 done', at: TT('23:00') }),
       top('', [], { text: 'collected', group: 'HO', at: TT('23:00') }), top('', [], { text: 'Done', group: 'HO', at: TT('20:25') }), H.doneTargets(IT, '', [], { text: 'Done', group: 'HO', at: TT('23:59') }).length],
      [true, true, { rooms: ['506'] }, null, null, 'a', 'b', 'b', 'd', 0]); }
  check('excel report: urgent items first among the open ones, and the footer', [H.reportModel([{ key: 'a', time: '08:00', shift: 'Morning', text: 'Room 210: towels.', cat: 'hk', status: 'open', rooms: ['210'] }, { key: 'b', time: '09:00', shift: 'Morning', text: 'VIP 701 complaint.', orig: 'VIP 701 complaint', cat: 'guest', status: 'open', rooms: ['701'] }], { hotel: 'Test Hotel', date: '2026-10-20' }).open.map(o => o.urgent), RM.footer], [[true, false], 'Test Hotel · Shift handover 20 Oct 2026']);
  check('written summary', H.writtenSummary(day), '3 items · 2 pending · 1 done. Still to do: Room 512: early departure; Room 305: balance AED 200 pending.');
  // audit fixes: real-life messages
  check('ho group chat: a chat reply on two lines ("Thanks Sam" / "Noted") and "ok will check" stay team chat', [H.isChat('Thanks Sam\nNoted'), H.isChat('ok will check'), H.isChat('sure, will do'), H.isChat('Thanks Sam\n512 balance pending'), H.buildItems({ base: 'tc', time: '09:00', text: 'Thanks Sam\nNoted' }, { parse, ho: true })[0].chat], [true, true, true, false, 1]);
  check('ho title: "Handover morning shift 20/10" over a list is no item (handover group and "Handover" mark)', [H.buildItems({ base: 't1', time: '09:00', text: 'Handover morning shift 20/10\n1. 601 refund pending\n2. 602 invoice to company' }, { parse, ho: true }).map(i => i.orig), H.buildItems({ base: 't2', time: '09:00', text: 'H/O night 21/10\n- 701 VIP 6pm' }, { parse }).map(i => i.orig), H.hoBody('HO - 512 ED\n305 refund'), H.hoBody('Handover: 512 taxi 5am')],
    [['601 refund pending', '602 invoice to company'], ['701 VIP 6pm'], '512 ED\n305 refund', '512 taxi 5am']);
  check('ho mark: "Ho gaya" / "ho jayega" are not a mark; "ho 512 ED" and "Ho - …" are', [H.hoPrefix('Ho gaya sir'), H.hoPrefix('ho jayega'), H.hoPrefix('ho 512 ED'), H.hoPrefix('Ho - guest in 512 wants taxi'), H.hoPrefix('ho room 512 twin')], [null, null, '512 ED', 'guest in 512 wants taxi', 'room 512 twin']);
  check('split: a "Done:" heading is a heading (its lines are not pending)', J(H.buildItems({ base: 'dn', time: '09:00', text: 'Pending:\n- 801 TD\nDone:\n- 802 refund given' }, { parse, ho: true }).map(i => i.head + ' ' + i.status)), ['Pending open', 'Done info']);
  check('split: warning and pin emoji are bullets', J(H.splitItems('⚠️ 305 AC leaking\n❗ 410 balance 300 pending\n📌 512 taxi 5am')).map(x => x.text), ['305 AC leaking', '410 balance 300 pending', '512 taxi 5am']);
  check('tidy: never capitals inside "3rd" or after a number', ['3rd floor ac not working', '100% paid'].map(H.tidy), ['3rd floor AC not working.', '100% paid.']);
  check('learning: two lessons that match the same, the newer wins', [J(H.learnedVerdict('coffee machine broken in back office, IT called again', [{ t: H.learnToks('coffee machine in back office broken again'), v: 'no', at: 1 }, { t: H.learnToks('coffee machine broken in back office, IT called'), v: 'yes', at: 2 }])).v,
    J(H.learnedVerdict('coffee machine broken in back office, IT called again', [{ t: H.learnToks('coffee machine broken in back office, IT called'), v: 'yes', at: 2 }, { t: H.learnToks('coffee machine in back office broken again'), v: 'no', at: 3 }])).v], ['yes', 'no']);
  { const N = [{ key: 'a', date: '2026-10-20', time: '02:10', shift: 'Night', text: 'Room 512: guest arrived.', cat: 'info', status: 'info' }, { key: 'b', date: '2026-10-20', time: '09:00', shift: 'Morning', text: 'Room 601: refund.', cat: 'pay', status: 'open' },
      { key: 'c', date: '2026-10-20', time: '23:40', shift: 'Night', text: 'Room 703: taxi 4 AM.', cat: 'transport', status: 'open' }, { key: 'd', date: '2026-10-31', time: '23:10', shift: 'Night', text: 'x', cat: 'info', status: 'info' }];
    check('night: after midnight is last night, apart from tonight (page sections, Excel, PDF)', [N.map(i => H.sectionOf(i).k + ' ' + H.sectionOf(i).label), H.reportModel(N.slice(0, 3), { date: '2026-10-20' }).sections.map(x => x.label + ':' + x.count), H.reportModel(N.slice(0, 3), { date: '2026-10-20' }).byShift.map(x => x.label)],
      [['Night0 Night 19–20 Oct', 'Morning Morning', 'Night Night 20–21 Oct', 'Night Night 31 Oct–1 Nov'], ['Night 19–20 Oct:1', 'Morning:1', 'Night 20–21 Oct:1'], ['Night 19–20 Oct', 'Morning', 'Night 20–21 Oct']]); }
  check('written summary: a cut item ends with "…", not "…."', /…\.$/.test(H.writtenSummary([{ key: 'a', time: '09:00', text: 'Room 603: taxi 4 AM tomorrow ' + 'very long text '.repeat(10), status: 'open' }])), false);
  // the WhatsApp reader shows handover groups as handover (never CO / LCO)
  const RD = require(path.join(ROOT, 'tools/hotelops-whatsapp.console.js'));
  check('reader: handover group and "HO -" mark', [RD.isHoGroup('HO - Ibis Styles'), RD.isHoGroup('HK Ibis'), RD.hoMarked('HO - 512 twin'), RD.hoMarked('HOTEL 512'), J(RD.hoChips('324 CO 512'))], [true, false, true, false, [{ tone: 'ho', label: '📋 Handover · 324, 512' }]]);
  check('reader: "Ho gaya" is not a handover mark (same rule as HotelOps)', [RD.hoMarked('Ho gaya sir'), RD.hoMarked('ho 512 ED')], [false, true]);
  // learned from a real HK group (made-up examples)
  check('auto-pick: room moves are handover items, however they are written', ['522 move to 202 (twin bed )', '516 moved to 517 ceiling leakage and bad smell', '407 shifted to 611 guest complaining about noise', '510 guest has move 405 (twin bed)'].map(t => [lk(t), H.handoverScore(t, opt).cat]),
    [[true, 'move'], [true, 'move'], [true, 'move'], [true, 'move']]);
  check('auto-pick: the HK group\'s routine is not a handover item', ['Physical check\n\n101\n102\n103', 'Kindly check the physical status of 503, 407, 222', '101 112 any update due out rooms plz', '403 IP @Sam Test', '424 on queue', '220 - prepare for arrival', 'I handover to the reception @Sam Test', '202 laundry pickup', '508 shower gel refill', 'Need king bed'].map(lk), Array(10).fill(false));
  check('category: laundry pick-up is housekeeping, shower gel is not plumbing, a bed set-up is not a room move', ['202 laundry pick up', 'Taxi pick up 5am room 210', '508 shower gel refill', '508 shower not working', 'Need king bed', 'room 514 need to be shifted to 2beds', 'Room 512 to twin tomorrow'].map(H.categorize),
    ['hk', 'transport', 'hk', 'maint', 'hk', 'move', 'move']);
}

// ── Handover from WhatsApp: only the handover (HO) group and messages marked HO / #ho / handover (made-up text only) ──
console.log('\nHandover from WhatsApp');
{
  const store = {}, got = [];
  const sb = { console: { log() {}, warn() {}, error() {} }, localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    document: { readyState: 'complete', addEventListener() {}, dispatchEvent() {}, getElementById() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; },
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }), head: { appendChild() {} }, body: { appendChild() {} } },
    addEventListener() {}, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    currentProfile: { name: 'Test User' }, depLog: [], depRooms: [], DAY: '2026-10-11',
    depRender() {}, updateDepBadge() {}, saveDeps() {}, saveDepartures() {}, logActivity() {}, showToast() {}, showUndoToast() {} };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  const dep = fs.readFileSync(path.join(ROOT, 'departures.js'), 'utf8'), ut = fs.readFileSync(path.join(ROOT, 'utils.js'), 'utf8');
  const fnSrc = (src, name) => { const i = src.indexOf('function ' + name + '('); return src.slice(i, src.indexOf('\n}\n', i) + 3); };
  vm.runInContext(fnSrc(dep, 'depAction') + fnSrc(dep, 'depAddManualRoom') + fnSrc(dep, '_depBoardDate') + fnSrc(ut, 'parseOperaDate') + 'function hoLocalISO() { return DAY; }', sb);
  for (const f of ['wa-bridge.js', 'handover-book.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  const H = sb.hoHandoverPure, B = sb.hoHandoverBook;
  sb.hoHandoverBook = { fromWa: p => { got.push(p); return 0; } };            // what the bridge hands to the book
  ['512', '305', '410'].forEach(n => sb.depRooms.push({ room: +n, roomStr: n, name: 'TEST GUEST', departure: '11-OCT-26', nights: 1, balance: 0, status: 'due', lateTime: '', extensionNights: 0, note: '' }));
  const send = (id, group, text, x) => { got.length = 0; sb.hoWaBridge.handle(Object.assign({ id, group, text, sender: 'Sam Test', time: '10:05' }, x || {}), 'page'); return got.map(p => p.kind + (p.src ? ':' + p.src : '') + (p.strict ? ':strict' : '')).join() || 'none'; };

  check('rule: the HO group by its name (handover, a standalone HO), or switched on by hand', ['HO - Test Hotel', 'Test hotel ho', 'Shift Handover', 'Hand over FO', 'HK Test Team', 'Hotel Ops Test', 'Who is who', 'Showroom'].map(g => H.waToHandover(g, 'anything')).concat(H.waToHandover('FO Test', 'x', true)),
    ['group', 'group', 'group', 'group', null, null, null, null, 'group']);
  check('rule: a message that says HO / #ho / handover goes in, the mark taken off', ['HO: 512 waiting for transfer', '512 waiting for transfer #ho', '#HO 305 refund pending', '305 refund pending HO', '(HO) 410 taxi 5am', '410 taxi 5am - handover', 'ho 512 early departure', 'Handover: 305 key card not working'].map(H.hoStrip),
    ['512 waiting for transfer', '512 waiting for transfer', '305 refund pending', '305 refund pending', '410 taxi 5am', '410 taxi 5am', '512 early departure', '305 key card not working']);
  check('rule: never inside a word, and not Hindi / Tagalog "ho" or "hand over the keys"', ['hotel 512 ok', 'who is on shift', '512 shower not working', 'hold 512 for now', 'Ho gaya sir', 'HO GAYA', 'kya ho raha hai', 'salamat ho', 'I will hand over the keys to the guest', 'HO', '512 early departure'].map(t => H.waToHandover('HK Test Team', t)),
    Array(11).fill(null));
  check('bridge: another group is never picked from (no more "reads like a handover item")', [send('h1', 'HK Test Team', '512 early depart'), send('h2', 'HK Test Team', 'Room 305 guest complained about noise'), send('h3', 'HK Test Team', 'Lost phone found in 410')], ['none', 'none', 'none']);
  check('bridge: marked HO in any group → the book (never a room command)', [send('h4', 'HK Test Team', 'HO: 512 waiting for transfer'), send('h5', 'HK Test Team', '305 CO #ho'), sb.depRooms.find(r => r.roomStr === '305').status], ['msg:prefix', 'msg:prefix', 'due']);
  check('bridge: everything in the HO group → the book', [send('h6', 'HO - Test Hotel', '410 balance pending'), send('h7', 'HO - Test Hotel', 'ok noted')], ['msg:wa', 'msg:wa']);
  check('bridge: a "Done" in another group only ticks when it quotes an item, and never asks', [send('h8', 'HK Test Team', 'Done ✅'), send('h9', 'HK Test Team', 'Done ✅', { quote: '512 waiting for transfer', time: '10:09' })], ['none', 'done:strict']);
  check('"None of these": that message is never asked about again (kept on this device)', [B.noAsked('m-test-1'), (B.rememberNoAsk('m-test-1'), B.noAsked('m-test-1')), JSON.parse(store.hb_noask_v1 || '[]').includes('m-test-1'), B.noAsked('m-test-2')], [false, true, true, false]);
  const RD = require(path.join(ROOT, 'tools/hotelops-whatsapp.console.js'));
  check('reader: the same rule in the WhatsApp window', ['HO: 512 waiting', '512 waiting #ho', '512 waiting HO', 'hotel 512', 'who is there', 'shower 512', 'hold 512', 'kya ho raha'].map(RD.hoMarked), [true, true, true, false, false, false, false, false]);
}

// ── Ops Brain: calm by default (brain-live.js) ──
console.log('\nOps Brain · calm hints');
{
  const store = {};
  const sb = { console: { log() {}, warn() {}, error() {} }, localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; } }, addEventListener() {}, setTimeout: () => 0, clearTimeout() {} };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'brain-live.js'), 'utf8'), sb, { filename: 'brain-live.js' });
  const run = c => vm.runInContext(c, sb);
  check('mode: Calm unless Normal or Off was chosen', [run('blMode()'), (sb.hoPref = k => (k === 'brainMode' ? 'off' : true), run('blMode()')), (sb.hoPref = () => 'normal', run('blMode()')), (sb.hoPref = () => undefined, run('blMode()'))], ['calm', 'off', 'normal', 'calm']);
  const now = 50 * 60e3, R = (k, o) => run(`blRoute(${JSON.stringify(k)}, ${JSON.stringify(Object.assign({ now, last: 0 }, o))})`);
  check('calm: a hint never pops up; Normal still does', [R('thought', { mode: 'calm' }), R('thought', { mode: 'off' }), R('thought', { mode: 'normal' })], ['hold', 'hold', 'bubble']);
  check('calm: something it did by itself is one small toast at most every 10 minutes, none while typing', [R('result', { mode: 'calm' }), R('result', { mode: 'calm', last: now - 5 * 60e3 }), R('result', { mode: 'calm', typing: true }), R('result', { mode: 'off' }), R('result', { mode: 'calm', last: now - 11 * 60e3 })], ['toast', 'hold', 'hold', 'hold', 'toast']);
  check('calm: what you tapped and the alarms you set (reminders, wake-up calls) still show', [R('result', { mode: 'calm', prompted: true }), R('alarm', { mode: 'calm', typing: true }), R('alarm', { mode: 'off' })], ['bubble', 'bubble', 'bubble']);
  const T = [{ id: 'arrNat:3', tone: 'warn' }, { id: 'habit:arrivals:Sun Oct 11 2026:9', tone: 'idle' }, { id: 'lco:512', tone: 'bad' }];
  check('calm: a tip seen once is not shown again (the 09:00 and 10:00 habit tip are one tip)', [run('blSeenKey({ id: "habit:arrivals:Sun Oct 11 2026:9" })') === run('blSeenKey({ id: "habit:arrivals:Sun Oct 11 2026:10" })'),
    run(`blCalmFilter(${JSON.stringify(T)}, { 'habit:arrivals:Sun Oct 11 2026': 1 }, 'calm').map(t => t.id)`), run(`blCalmFilter(${JSON.stringify(T)}, { 'habit:arrivals:Sun Oct 11 2026': 1 }, 'normal').length`)],
    [true, ['arrNat:3', 'lco:512'], 3]);
  check('the 🧠 number: calm counts only what you have not seen; off shows none', [run(`blCountable(${JSON.stringify(T)}, [], {}, { 'arrNat:3': 1 }, 'calm', 0)`), run(`blCountable(${JSON.stringify(T)}, [{ id: 'heal:1' }], { 'lco:512': 9 }, {}, 'calm', 0)`), run(`blCountable(${JSON.stringify(T)}, [], {}, {}, 'off', 0)`), run(`blCountable(${JSON.stringify(T)}, [], {}, { 'arrNat:3': 1 }, 'normal', 0)`)],
    [2, 3, 0, 3]);
  check('a day off: the Brain stays silent (only what you tap answers)', [R('thought', { mode: 'normal', dayOff: true }), R('result', { mode: 'calm', dayOff: true, last: -1e9 }), R('alarm', { mode: 'normal', dayOff: true }), R('result', { mode: 'calm', prompted: true, dayOff: true })], ['hold', 'hold', 'hold', 'bubble']);
}

// ── WhatsApp bridge acting on a board (wa-bridge.js handle() with departures.js depAction, no browser) ──
console.log('\nWhatsApp bridge · acting on the board');
{
  const store = {}, toasts = [];
  const sb = { console: { log() {}, warn() {}, error() {} }, localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    document: { readyState: 'complete', addEventListener() {}, dispatchEvent() {}, getElementById() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; } },
    addEventListener() {}, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    currentProfile: { name: 'Test User' }, depLog: [], depRooms: [], DAY: '2026-10-11',
    depRender() {}, updateDepBadge() {}, saveDeps() {}, saveDepartures() {}, logActivity() {}, showToast: (m, t) => toasts.push(m), showUndoToast: (m, fn) => { toasts.push(m); sb.lastUndo = fn; } };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  const dep = fs.readFileSync(path.join(ROOT, 'departures.js'), 'utf8'), ut = fs.readFileSync(path.join(ROOT, 'utils.js'), 'utf8');
  const fnSrc = (src, name) => { const i = src.indexOf('function ' + name + '('); return src.slice(i, src.indexOf('\n}\n', i) + 3); };
  vm.runInContext(fnSrc(dep, 'depAction') + fnSrc(dep, 'depAddManualRoom') + fnSrc(dep, '_depBoardDate') + fnSrc(ut, 'parseOperaDate') + 'function hoLocalISO() { return DAY; }', sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'wa-bridge.js'), 'utf8'), sb, { filename: 'wa-bridge.js' });
  const mk = (n, x) => Object.assign({ room: parseInt(n, 10), roomStr: String(n), name: 'TEST GUEST', arrival: '', departure: '11-OCT-26', nights: 1, balance: 0, depTime: '', status: 'due', lateTime: '', extensionNights: 0, intent: '', note: '', checkoutAt: '' }, x || {});
  const board = list => { sb.depRooms.length = 0; sb.depLog.length = 0; list.forEach(r => sb.depRooms.push(typeof r === 'object' ? r : mk(r))); };
  const room = n => sb.depRooms.find(r => parseInt(r.roomStr, 10) === n) || {};
  const H = (id, text, x) => sb.hoWaBridge.handle(Object.assign({ id, text, sender: 'Sam Test', time: '10:05' }, x || {}), 'page');
  const res = () => sb.hoWaBridge.log()[0].res.map(r => r.st + ' ' + (r.room || '')).join(', ');
  const st = n => [room(n).status, room(n).lateTime || '', room(n).extensionNights || 0].join(' ');

  // the built-in word list (wa-brain.js) has CO, checkout, LCO, EXT: those still go through the parser's own checks
  const BW = { co: 'co', checkout: 'co', lco: 'lco', ext: 'ext', ed: 'co', vd: 'co' };
  const words = w => { const m = BW[String(w).toLowerCase().replace(/[.\/\s]/g, '')]; return m ? { m, label: 'x' } : null; };
  check('wa words: "CO tomorrow", "LCO cancelled", "ext maybe", "ED tomorrow" are notes even with CO/LCO/EXT/ED in the word list',
    ['324 CO tomorrow', '202 LCO cancelled', '113 ext maybe', '113 ext pending', '512 ED tomorrow', '324 CO', '202 LCO 6pm', '113 ext 2n', '512 ED', '315 VD'].map(t => sb.hoWaParse(t, { words }).actions.map(a => a.act + (a.time ? ' ' + a.time : '') + (a.nights ? ' ' + a.nights : '')).join()),
    ['note', 'note', 'note', 'extending', 'note', 'co', 'lco 18:00', 'ext 2', 'co', 'co']);

  // a room added by hand (departure "2026-10-11"): the board is still today's, its extension counts from today
  check('manual room: ISO departure read as that day', [sb.parseOperaDate('2026-10-11').toDateString(), sb.parseOperaDate('11-OCT-26').toDateString()], ['Sun Oct 11 2026', 'Sun Oct 11 2026']);
  board([]); sb.depAddManualRoom('705', 'X');
  check('manual room only on the board: WhatsApp acts at once (not "waiting for today\'s list")', [H('a1', '705 ext till 13'), res(), st(705)], ['done', 'ext 705', 'extended  2']);

  // "LCO 12am" / "midnight": the end of the day, not overdue at once
  board([201, 202]); H('a2', '201 LCO 12am'); H('a3', '202 LCO midnight');
  check('LCO 12am / midnight → 23:59', [st(201), st(202)], ['late 23:59 0', 'late 23:59 0']);

  // the same message read by a second HotelOps on the same board (its own done list): not twice
  board([101, 102, mk(103, { depTime: '12:00' }), 104, 107]);
  const M = [['b1', '101 CO'], ['b2', '102 LCO 2pm'], ['b3', '103 checking out in 10 min'], ['b4', '104 change towels'], ['b7', '107 luggage inside']];
  M.forEach(([id, t]) => H(id, t)); const notes = [101, 102, 103, 104, 107].map(n => room(n).note);
  delete store.ho_wa_done; toasts.length = 0;
  const again = M.map(([id, t]) => (H(id, t), res()));
  check('second PC: nothing done twice, no Undo offered', [again, [101, 102, 103, 104, 107].every((n, i) => room(n).note === notes[i]), toasts.length], [['skip 101', 'skip 102', 'skip 103', 'skip 104', 'skip 107'], true, 0]);

  // edited in WhatsApp: what the old text no longer says is taken back
  board([324, 325, 202, 501]);
  H('e1', '324 CO'); H('e1', '325 CO', { edited: true });
  H('e2', '202 LCO 2pm'); H('e2', '202 LCO 4pm', { edited: true });
  H('e3', '501 CO'); H('e3', '501 sorry wrong room', { edited: true });
  check('edit: "324 CO" → "325 CO" puts 324 back; LCO time changed; a CO edited away is undone', [st(324), st(325), st(202), st(501)], ['due  0', 'out  0', 'late 16:00 0', 'due  0']);

  // past midnight: yesterday's log is not today's, and nothing from it runs on the new board
  board([mk(951, { departure: '12-OCT-26' })]);
  H('n1', '951 CO', { time: '23:50' });
  check('tomorrow\'s board: not acted on', [res(), st(951)], ['notlist 951', 'due  0']);
  sb.DAY = '2026-10-12'; sb.hoWaBridge.flushPending(); sb.hoWaBridge.flushPending();   // (every 4 s)
  check('after midnight: yesterday\'s message never runs on the new board, log starts empty', [st(951), sb.hoWaBridge.log().length], ['due  0', 0]);
}

// ── Team → Roles & access (role-rules.js): defaults + saved changes → what each role gets ──
console.log('\nRoles & access');
{
  const sb = { console: { log() {}, warn() {}, error() {} } };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  const au = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
  const i = au.indexOf('const ROLES = {'), j = au.indexOf('\n};\n', i) + 3;
  vm.runInContext(au.slice(i, j).replace('const ROLES', 'var ROLES'), sb, { filename: 'auth.js (ROLES)' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'role-rules.js'), 'utf8'), sb, { filename: 'role-rules.js' });
  const RR = sb.hoRoleRules, ROLES = JSON.parse(JSON.stringify(sb.ROLES));
  ROLES.agent.panels.push('ops-logs');   // a module adding its page at load (after the defaults)
  const J = x => JSON.parse(JSON.stringify(x));
  const E = (rules, r, all) => RR.effective(ROLES, rules, r, all);
  const has = (rules, r, p) => E(rules, r).panels.includes(p);
  const ALL = ['home', 'departures', 'rates', 'settings', 'qr', 'ops-logs'];

  check('no changes: each role gets its defaults (and pages modules added), Home and Settings on',
    [has({}, 'agent', 'handover-book'), has({}, 'agent', 'ops-logs'), has({}, 'agent', 'rates'), has({}, 'readonly', 'settings'), E({}, 'agent').caps.canImport, E({}, 'manager').caps.canManageUsers, E({}, 'readonly').caps.canDelete],
    [true, true, false, true, false, true, false]);
  check('powers the app now checks keep what each role could already do (export, clear, delete, logs)',
    [['agent', 'supervisor', 'manager'].map(r => [E({}, r).caps.canExport, E({}, r).caps.canClear, E({}, r).caps.canDelete].join()), E({}, 'supervisor').caps.canViewLogs, E({}, 'agent').caps.canViewLogs, E({}, 'readonly').caps.canExport],
    [['true,true,true', 'true,true,true', 'true,true,true'], true, false, false]);
  const rules = { agent: { panels: { rates: true, 'handover-book': false, home: false, settings: false }, caps: { canExport: true, canManageUsers: true } } };
  check('a page that needs a power goes with it (History needs activity logs, Trends needs reports)',
    [has({}, 'supervisor', 'history'), has({ supervisor: { caps: { canViewLogs: false } } }, 'supervisor', 'history'), has({ supervisor: { caps: { canReports: false } } }, 'supervisor', 'trends'), RR.effective(ROLES, { supervisor: { caps: { canViewLogs: false } } }, 'supervisor', null, { raw: true }).panels.includes('history')],
    [true, false, false, true]);
  check('changes on top: a page on, a page off, a power on; Home/Settings can\'t be switched off; agents never manage the team',
    [has(rules, 'agent', 'rates'), has(rules, 'agent', 'handover-book'), has(rules, 'agent', 'home'), has(rules, 'agent', 'settings'), E(rules, 'agent').caps.canExport, E(rules, 'agent').caps.canManageUsers, has(rules, 'readonly', 'rates')],
    [true, false, true, true, true, false, false]);
  check('owner: always everything, whatever is saved for it',
    [E({ owner: { panels: { departures: false, home: false }, caps: { canManageUsers: false } } }, 'owner', ALL).panels.includes('departures'), E({ owner: { caps: { canManageUsers: false } } }, 'owner').caps.canManageUsers, ALL.every(p => E({}, 'owner', ALL).panels.includes(p)), RR.CAP_IDS.every(c => E({}, 'owner').caps[c])],
    [true, true, true, true]);
  check('unknown role is read only; junk in the database is ignored',
    [J(E({}, 'nobody')).panels.join() === J(E({}, 'readonly')).panels.join(), J(RR.cleanAll({ agent: { panels: { rates: 'yes', 'x y': true, ok: false }, caps: 5 }, owner: { caps: { canExport: false } }, supervisor: null }))],
    [true, { agent: { panels: { ok: false } } }]);
  check('who can edit which role: owner all but owner; manager only supervisor/agent/read only; others none',
    [['owner', 'manager', 'supervisor', 'agent', 'readonly'].map(r => RR.canEditRole(ROLES, {}, 'owner', r)), ['owner', 'manager', 'supervisor', 'agent', 'readonly'].map(r => RR.canEditRole(ROLES, {}, 'manager', r)),
      RR.canEditRole(ROLES, {}, 'supervisor', 'agent'), RR.canEditRole(ROLES, {}, 'agent', 'agent'), RR.canEditRole(ROLES, { manager: { caps: { canManageUsers: false } } }, 'manager', 'agent')],
    [[false, true, true, true, true], [false, false, true, true, true], false, false, false]);
  const noRates = { manager: { panels: { rates: false }, caps: { canExport: false } } };
  check('manager limits: can\'t give more than they have; can always take away; owner can give anything',
    [RR.canSet(ROLES, {}, 'manager', 'agent', 'panels', 'rates', true).ok, RR.canSet(ROLES, noRates, 'manager', 'agent', 'panels', 'rates', true).why, RR.canSet(ROLES, {}, 'manager', 'agent', 'caps', 'canImport', true).why,
      RR.canSet(ROLES, noRates, 'manager', 'agent', 'caps', 'canExport', true).why, RR.canSet(ROLES, noRates, 'manager', 'agent', 'panels', 'departures', false).ok, RR.canSet(ROLES, {}, 'owner', 'agent', 'caps', 'canImport', true).ok,
      RR.canSet(ROLES, {}, 'manager', 'manager', 'panels', 'rates', false).ok, RR.canSet(ROLES, {}, 'owner', 'agent', 'panels', 'home', false).why, RR.canSet(ROLES, {}, 'owner', 'supervisor', 'caps', 'canManageUsers', true).why, RR.canSet(ROLES, {}, 'owner', 'manager', 'caps', 'canManageUsers', false).ok],
    [true, 'notYours', 'notYours', 'notYours', true, true, false, 'always', 'onlyFor', true]);
  { let r = {};
    r.agent = RR.setRule(ROLES, r, 'agent', 'panels', 'rates', true);
    const a1 = J(r.agent);
    r.agent = RR.setRule(ROLES, r, 'agent', 'caps', 'canImport', true);
    const n1 = RR.changes(ROLES, r, 'agent').length;
    r.agent = RR.setRule(ROLES, r, 'agent', 'panels', 'rates', false);
    r.agent = RR.setRule(ROLES, r, 'agent', 'caps', 'canImport', false);
    check('saving: only differences from default are kept; back to default stores nothing ("changed" dot goes)', [a1, n1, r.agent, RR.changes(ROLES, r, 'agent').length, RR.changes(ROLES, { owner: { panels: { home: false } } }, 'owner').length],
      [{ panels: { rates: true } }, 2, null, 0, 0]); }
  // ── one person's own access on top (users → Access) ──
  const EU = (rules, r, acc) => RR.effectiveUser(ROLES, rules, r, acc);
  { const rr = { agent: { panels: { rates: true } } };
    const acc = { panels: { audit: true, rates: false, home: false }, caps: { canDelete: false, canReports: true, canManageUsers: true } };
    const u = EU(rr, 'agent', acc);
    check('3 levels: built-in role → role rules → person (allow adds, block removes; Home stays; never team management)',
      [EU(rr, 'agent', null).panels.includes('rates'), u.panels.includes('rates'), u.panels.includes('audit'), u.panels.includes('home'), u.caps.canDelete, u.caps.canReports, u.caps.canManageUsers, EU({}, 'agent', null).panels.sort().join() === E({}, 'agent').panels.sort().join()],
      [true, false, true, true, false, true, false, true]);
    check('3 levels: a person block wins over a role rule, a person allow wins over a role block',
      [EU({ agent: { panels: { rates: true } } }, 'agent', { panels: { rates: false } }).panels.includes('rates'), EU({ agent: { panels: { departures: false } } }, 'agent', { panels: { departures: true } }).panels.includes('departures')], [false, true]);
    check('owner accounts can\'t be restricted, whatever is saved for them',
      [EU({}, 'owner', { panels: { departures: false }, caps: { canExport: false, canManageUsers: false } }).panels.includes('departures'), EU({}, 'owner', { caps: { canExport: false } }).caps.canExport, EU({}, 'owner', { caps: { canManageUsers: false } }).caps.canManageUsers], [true, true, true]);
    const sum = RR.userSummary(ROLES, rr, 'agent', { panels: { audit: true, immig: true, departures: false } });
    check('card summary: "Agent + 2 extra pages, 1 blocked"; nothing changed → just the role',
      [sum.text, RR.userSummary(ROLES, rr, 'agent', null).text, RR.userSummary(ROLES, {}, 'agent', { panels: { departures: false } }).text, RR.userSummary(ROLES, {}, 'agent', { caps: { canReports: true } }).text, RR.userSummary(ROLES, {}, 'agent', { panels: { departures: true } }).changed],
      ['Agent + 2 extra pages, 1 blocked', 'Agent', 'Agent · 1 page blocked', 'Agent + 1 power', false]); }
  { const O = { role: 'owner', uid: 'o1' }, M = { role: 'manager', uid: 'm1' }, S = { role: 'supervisor', uid: 's1' };
    const can = (ed, tg, kind, id, v, rules) => { const r = RR.canSetUser(ROLES, rules || {}, ed, tg, kind, id, v); return r.ok || r.why; };
    check('who can change a person: not yourself, never an owner; managers only below manager; others no one',
      [RR.canEditUser(ROLES, {}, O, { role: 'agent', uid: 'a1' }).ok, RR.canEditUser(ROLES, {}, O, { role: 'owner', uid: 'o2' }).why, RR.canEditUser(ROLES, {}, O, { role: 'owner', uid: 'o1' }).why,
        RR.canEditUser(ROLES, {}, O, { role: 'manager', uid: 'm1' }).ok, RR.canEditUser(ROLES, {}, M, { role: 'manager', uid: 'm2' }).why, RR.canEditUser(ROLES, {}, M, { role: 'manager', uid: 'm1' }).why,
        RR.canEditUser(ROLES, {}, M, { role: 'agent', uid: 'a1' }).ok, RR.canEditUser(ROLES, {}, S, { role: 'agent', uid: 'a1' }).why, RR.canEditUser(ROLES, {}, Object.assign({ access: { caps: { canManageUsers: false } } }, M), { role: 'agent', uid: 'a1' }).ok],
      [true, 'owner', 'self', true, 'locked', 'self', true, 'locked', false]);
    const A = { role: 'agent', uid: 'a1' };
    check('person limits: Home/Settings can\'t be blocked; team management never for agents; managers can\'t allow beyond their own (rules or own access); back to role always ok',
      [can(O, A, 'panels', 'home', false), can(O, A, 'panels', 'settings', 'role'), can(O, A, 'caps', 'canManageUsers', true), can(O, A, 'caps', 'canImport', true), can(M, A, 'caps', 'canImport', true),
        can(M, A, 'panels', 'rates', true), can(Object.assign({ access: { panels: { rates: false } } }, M), A, 'panels', 'rates', true), can(M, A, 'panels', 'rates', true, { manager: { panels: { rates: false } } }), can(M, A, 'panels', 'departures', false), can(M, A, 'caps', 'canImport', 'role')],
      [ 'always', true, 'onlyFor', true, 'notYours', true, 'notYours', 'notYours', true, true]);
    let a = null;
    a = RR.setAccess(a, 'panels', 'rates', true); a = RR.setAccess(a, 'caps', 'canDelete', false);
    const a1 = J(a);
    a = RR.setAccess(a, 'panels', 'rates', 'role'); a = RR.setAccess(a, 'caps', 'canDelete', 'role');
    check('person saving: Allow/Block kept, "Role" removes it; nothing left → nothing stored', [a1, a], [{ panels: { rates: true }, caps: { canDelete: false } }, null]); }

}

// ── Shift task → linked tool (shift-links.js): words → page, saving links on a list ──
console.log('\nShift tasks · linked tools');
{
  const sb = { console: { log() {}, warn() {}, error() {} } };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'shift-links.js'), 'utf8'), sb, { filename: 'shift-links.js' });
  const L = sb.hoShiftLinks, J = x => JSON.parse(JSON.stringify(x));
  const sug = n => L.suggestFromText(n);
  check('suggest: enrollment / ALL / members → Guest Pipeline',
    ['Enrollment', 'ALL enrollments', 'Enroll walk-in guests', 'New members sign-up', 'Loyalty cards'].map(sug), ['pipeline', 'pipeline', 'pipeline', 'pipeline', 'pipeline']);
  check('suggest: "all" in normal words, all-caps text and team members are not loyalty',
    ['Check all rooms', 'CHECK ALL ROOMS', 'Brief team members'].map(sug), ['', '', '']);
  check('suggest: front desk pages',
    ['Follow up on pending checkouts', 'Update departure board', 'CO list', 'Handle late arrivals', 'Pre-reg tomorrow', 'Process remaining check-ins', 'Arr vs Dep', 'Wake up calls', 'Purpose of stay'].map(sug),
    ['departures', 'departures', 'departures', 'arrivals', 'arrivals', 'arrivals', 'xref', 'wakeups', 'purpose']);
  check('suggest: night audit pages',
    ['Complete night audit checklist', 'PM Rooms', 'In-house tally', 'Rented rooms & beds', 'Passport scan', 'Immigration check', 'Nationality report'].map(sug),
    ['checklist', 'audit', 'inhouse-tally', 'rent', 'immig', 'immig', 'nationality']);
  check('suggest: money and tax pages (TD audit before Tourism, DTCM before Tourism)',
    ['TD 30-day audit', 'Post TD', 'Tourism dirham', 'DTCM recon', 'Package audit', 'Skip the clean', 'STC report', 'No show report'].map(sug),
    ['td-audit', 'tourism', 'tourism', 'dtcm', 'package-audit', 'skip-clean', 'skip-clean', 'noshow']);
  check('suggest: logs, handover, housekeeping, rates, roster, QR',
    ['Reconcile front desk float', 'Lost & found', 'Maintenance issues', 'Check overnight log', 'Receive handover from morning shift', 'Coordinate with housekeeping', 'HK requests', 'Rate shop', 'Check roster', 'Print QR'].map(sug),
    ['ops-logs', 'ops-logs', 'ops-logs', 'ops-logs', 'handover-book', 'hk-requests', 'hk-requests', 'rates', 'roster', 'qr']);
  check('suggest: nothing for words with no page ("5 pm" is not PM Rooms)', ['Update room status report', 'Call room 204 at 5 pm', '', null].map(sug), ['', '', '', '']);
  check('suggest from a task: name first, then hint; none once linked or set to "no page"',
    [L.suggest({ name: 'Update room status report', hint: 'Coordinate with housekeeping.' }), L.suggest({ name: 'Enrollment', hint: 'Coordinate with housekeeping.' }),
      L.suggest({ name: 'Enrollment', tool: 'departures' }), L.suggest({ name: 'Enrollment', tool: 'none' })],
    ['hk-requests', 'pipeline', '', '']);
  check('linked page: none / Guest Memory / the list itself never count as a link',
    [L.toolOf({ tool: 'pipeline' }), L.toolOf({ tool: 'none' }), L.toolOf({ tool: 'guestmem' }), L.toolOf({ tool: 'shifts' }), L.toolOf({}), L.toolOf(null)], ['pipeline', '', '', '', '', '']);
  const tasks = [{ id: 'a', name: 'Enrollment' }, { id: 'b', name: 'Reconcile front desk float', imp: true }, { id: 'c', name: 'Update room status report' }, { id: 'd', name: 'Handle late arrivals', tool: 'none' }, { id: 'e', name: 'Departures', tool: 'xref' }];
  check('link all: only unlinked tasks with a suggestion; "no page" and already-linked tasks are left alone',
    J(L.linkAllChanges(tasks)), { a: 'pipeline', b: 'ops-logs' });
  const before = J(tasks);
  const out = L.applyTools(tasks, { a: 'pipeline', e: null, zz: 'rates', c: 'guestmem' });
  check('saving links: only named tasks change, other fields kept, null removes, unknown ids ignored, Guest Memory never stored',
    [J(out), J(tasks)], [[{ id: 'a', name: 'Enrollment', tool: 'pipeline' }, before[1], { id: 'c', name: 'Update room status report' }, before[3], { id: 'e', name: 'Departures' }], before]);
  // a colleague added a task and renamed one since this device loaded: the link lands on the fresh list
  const fresh = L.asList({ 0: { id: 'a', name: 'ALL enrollment (walk-ins too)' }, 1: { id: 'n', name: 'New task from a colleague' } });
  check('saving on the fresh list: Firebase object → array, the colleague\'s task and rename stay, link added by id',
    J(L.applyTools(fresh, { a: 'pipeline', b: 'ops-logs' })), [{ id: 'a', name: 'ALL enrollment (walk-ins too)', tool: 'pipeline' }, { id: 'n', name: 'New task from a colleague' }]);
  check('old saved tasks (no tool field) work as before', [L.toolOf(before[0]), L.asList(null), L.asList([null, { id: 'x' }]).length, L.applyTools(undefined, { a: 'x' }).length], ['', null, 1, 0]);
}

// ── Gym & Pool (gym.js): email reading, dates, status, extending, ID masking, files, import, report ──
console.log('\nGym & Pool memberships');
{
  const sb = { console: { log() {}, warn() {}, error() {} } };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'gym.js'), 'utf8'), sb, { filename: 'gym.js' });
  const P = sb.hoGymPure, J = x => JSON.parse(JSON.stringify(x)), T = '2026-10-21';
  // dates
  check('end date: one month ends the day before the same date (3 Oct → 2 Nov; 13 Oct → 12 Nov); 6 months 6 Oct → 5 Apr',
    [P.endFor('2026-10-03', '1m'), P.endFor('2026-10-13', '1m'), P.endFor('2026-10-06', '6m'), P.endFor('2026-12-15', '1m'), P.endFor('2026-10-21', '12m')],
    ['2026-11-02', '2026-11-12', '2027-04-05', '2027-01-14', '2027-10-20']);
  check('end date: month ends (31 Jan → 28/29 Feb, 30 Jan → 28 Feb, 31 Mar → 30 Apr); 30 days = start + 29; custom → none',
    [P.endFor('2026-01-31', '1m'), P.endFor('2028-01-31', '1m'), P.endFor('2026-01-30', '1m'), P.endFor('2026-03-31', '1m'), P.endFor('2026-10-21', '30d'), P.endFor('2026-12-15', '30d'), P.endFor('2026-10-21', 'custom'), P.endFor('nope', '1m')],
    ['2026-02-28', '2028-02-29', '2026-02-28', '2026-04-30', '2026-11-19', '2027-01-13', '', '']);
  check('length from the dates: 1 month, 6 months, 30 days, else custom',
    [P.lenOf('2026-10-13', '2026-11-12'), P.lenOf('2026-10-06', '2027-04-05'), P.lenOf('2026-10-21', '2026-11-19'), P.lenOf('2026-10-21', '2026-10-25'), P.lenLabel('45d'), P.lenLabel('1m')],
    ['1m', '6m', '30d', 'custom', '45 days', '1 month']);
  // status and countdown
  const m = (start, end) => ({ name: 'Test', start, end });
  check('status: active / ending soon (≤ 3 days, or the set number) / expired / not started',
    [P.statusOf(m('2026-10-01', '2026-11-01'), T), P.statusOf(m('2026-10-01', '2026-10-24'), T), P.statusOf(m('2026-10-01', '2026-10-25'), T), P.statusOf(m('2026-10-01', '2026-10-25'), T, 5), P.statusOf(m('2026-10-01', '2026-10-21'), T), P.statusOf(m('2026-09-01', '2026-10-20'), T), P.statusOf(m('2026-10-22', '2026-11-21'), T)],
    ['active', 'ending', 'active', 'ending', 'ending', 'expired', 'notstarted']);
  check('countdown words',
    [P.countdown(m('2026-10-01', '2026-11-02'), T), P.countdown(m('2026-10-01', '2026-10-22'), T), P.countdown(m('2026-10-01', '2026-10-21'), T), P.countdown(m('2026-09-01', '2026-10-20'), T), P.countdown(m('2026-09-01', '2026-10-19'), T), P.countdown(m('2026-10-22', '2026-11-21'), T), P.countdown(m('2026-10-24', '2026-11-23'), T)],
    ['12 days left', '1 day left', 'ends today', 'ended yesterday', 'ended 2 days ago', 'starts tomorrow', 'starts in 3 days']);
  // extending
  const on = { start: '2026-10-03', end: '2026-11-02' }, off = { start: '2026-09-01', end: '2026-10-10' };
  check('extend: still on → the day after the end; expired → today; or a date; +1 month / +30 days / custom',
    [J(P.extendPlan(on, '30d', T)), J(P.extendPlan(on, '1m', T, 'after')), J(P.extendPlan(off, '1m', T)), J(P.extendPlan(on, '30d', T, 'today')), J(P.extendPlan(on, '1m', T, 'date', '2026-12-01')), J(P.extendPlan(on, 'custom', T, 'after', '', '2026-11-20')), P.extendPlan(on, 'custom', T, 'after', '', '2026-11-01').end],
    [{ start: '2026-11-03', end: '2026-12-02', mode: 'after' }, { start: '2026-11-03', end: '2026-12-02', mode: 'after' }, { start: T, end: '2026-11-20', mode: 'today' }, { start: T, end: '2026-11-19', mode: 'today' }, { start: '2026-12-01', end: '2026-12-31', mode: 'date' }, { start: '2026-11-03', end: '2026-11-20', mode: 'after' }, '']);
  check('extend: one unbroken membership keeps its first day; a gap starts again; never shortens the end',
    [J(P.applyExtend(on, P.extendPlan(on, '30d', T))), J(P.applyExtend(off, P.extendPlan(off, '1m', T))), J(P.applyExtend(on, P.extendPlan(on, '1m', T, 'date', '2026-12-10'))), J(P.applyExtend(on, { start: T, end: '2026-10-30' })), P.applyExtend(on, { start: T, end: '' })],
    [{ start: '2026-10-03', end: '2026-12-02' }, { start: T, end: '2026-11-20' }, { start: '2026-12-10', end: '2027-01-09' }, { start: '2026-10-03', end: '2026-11-02' }, null]);
  // IDs
  check('ID masking: Emirates ID shows only 784 and the last digit; passports the last 3; full number formatted',
    [P.maskId('784-1990-1234567-1', 'eid'), P.maskId('784199012345671'), P.maskId('X1234567', 'passport'), P.maskId('AB1', 'passport'), P.maskId('', 'eid'), P.fmtEid('784 1990 1234567 1'), P.fmtEid('X1234567')],
    ['784-XXXX-XXXXXXX-1', '784-XXXX-XXXXXXX-1', 'XXXXX567', 'XXX', '', '784-1990-1234567-1', 'X1234567']);
  // emails (made-up people)
  const e1 = P.parseEmail('Ms. Lina Testova, our guest, has extended her gym membership for an additional 30 days starting from today.', T);
  check('email: an extension for an additional 30 days from today (name, Ms., gym, guest)',
    [e1.title, e1.name, e1.action, e1.type, e1.kind, e1.len, e1.start, e1.end], ['Ms', 'Lina Testova', 'extend', 'gym', 'guest', '30d', T, '2026-11-19']);
  const e2 = P.parseEmail('Dear team,\nMr. Karim Example has a new gym and pool membership for one month, starting today.\nMembership period: 03-10-2026 to 02-11-2026\nAttachment: EID_784199012345671 2.pdf', '2026-10-03');
  check('email: new gym + pool for one month, the period and the Emirates ID from the file name',
    [e2.title, e2.name, e2.action, e2.type, e2.len, e2.start, e2.end, e2.idType, e2.idNo], ['Mr', 'Karim Example', 'new', 'gympool', '1m', '2026-10-03', '2026-11-02', 'eid', '784-1990-1234567-1']);
  const e3 = P.parseEmail('Mrs. Dana Sample (room 512) – pool membership for 3 months from 5 November 2026. Passport no: X1234567. Mobile: 050 123 4567. Car plate: E 16477. AED 750', T);
  check('email: pool, room, 3 months from a written date, passport, mobile, car plate, amount',
    [e3.name, e3.type, e3.room, e3.kind, e3.len, e3.start, e3.end, e3.idType, e3.idNo, e3.phone, e3.plate, e3.price], ['Dana Sample', 'pool', '512', 'guest', '3m', '2026-11-05', '2027-02-04', 'passport', 'X1234567', '050 123 4567', 'E16477', 750]);
  const e4 = P.parseEmail('Mr. Sam Placeholder renewed his gym membership. Membership period: 21/10/2026 - 20/11/2026', T);
  check('email: renewed = extension; dd/mm/yyyy range; nothing found in empty text',
    [e4.action, e4.start, e4.end, e4.len, P.parseEmail('', T).name, P.parseEmail('Mr. Y has a new gym membership for one month, starting today.', T).name], ['extend', '2026-10-21', '2026-11-20', '1m', '', 'Y']);
  check('dates in emails: 03-10-2026, 3.10.26, 2026-10-03, 3rd October 2026, Oct 3, 2026; 31-02-2026 is not a date',
    ['03-10-2026', '3.10.26', '2026-10-03', '3rd October 2026', 'Oct 3, 2026', '31-02-2026'].map(P.parseDate), ['2026-10-03', '2026-10-03', '2026-10-03', '2026-10-03', '2026-10-03', '']);
  const L = [{ id: 'a', name: 'Lina Testova', end: '2026-10-30' }, { id: 'b', name: 'Karim Example', end: '2026-11-02' }, { id: 'c', name: 'Karim Other', end: '2026-11-02', del: 1 }];
  check('find the member a pasted name points to (titles and case ignored; deleted ones never)',
    [(P.findMember(L, 'Ms. Lina Testova') || {}).id, (P.findMember(L, 'karim') || {}).id, P.findMember(L, 'Karim Other'), P.findMember(L, 'Nobody Here')], ['a', 'b', null, null]);
  // summary, due, filter, sort
  const M = [
    { id: '1', name: 'Alpha Test', type: 'gym', kind: 'guest', room: '512', start: '2026-10-01', end: '2026-10-21', phone: '050 111 2222', idNo: '784199012345671', hist: { h: { start: '2026-10-01', end: '2026-10-21', price: 299, paid: 'paid' } } },
    { id: '2', name: 'Beta Test', type: 'pool', kind: 'outside', start: '2026-10-05', end: '2026-10-22', plate: 'E16477', hist: { h: { start: '2026-10-05', end: '2026-10-22', price: 299, paid: 'topay' } } },
    { id: '3', name: 'Gamma Test', type: 'gympool', kind: 'staff', start: '2026-09-01', end: '2026-10-10', hist: { h: { start: '2026-09-01', end: '2026-10-10', price: 1499, paid: 'paid' } } },
    { id: '4', name: 'Delta Test', type: 'gym', kind: 'guest', start: '2026-10-15', end: '2026-11-14', hist: { h: { start: '2026-10-15', end: '2026-11-14', price: 299, paid: 'paid' } } },
    { id: '5', name: 'Epsilon Test', type: 'gym', kind: 'guest', start: '2026-10-25', end: '2026-11-24' },
    { id: '6', name: 'Gone Test', start: '2026-10-01', end: '2026-10-30', del: 1 }];
  check('summary strip: active, ending this week, expired this month, revenue this month (paid periods starting this month)',
    J(P.summary(M, T)), { active: 3, ending: 2, week: 2, expiredMonth: 1, notstarted: 1, revenue: 598, toCollect: 299, toCollectN: 1, total: 5 });
  check('reminders: ending today, then tomorrow', P.dueSoon(M, T).map(d => d.m.id + ':' + d.when), ['1:today', '2:tomorrow']);
  const ids = f => P.filterMembers(M, f, T).map(x => x.id);
  check('filters: status (active includes ending), type, kind; search by name, room, ID last digits, phone, car plate',
    [ids({ st: 'active' }), ids({ st: 'ending' }), ids({ st: 'expired' }), ids({ st: 'notstarted' }), ids({ type: 'pool' }), ids({ kind: 'guest' }), ids({ q: 'beta' }), ids({ q: '512' }), ids({ q: '5671' }), ids({ q: '1112222' }), ids({ q: 'e164' })],
    [['1', '2', '4'], ['1', '2'], ['3'], ['5'], ['2'], ['1', '4', '5'], ['2'], ['1'], ['1'], ['1'], ['2']]);
  check('sort by end date: running (soonest first), then not started, then expired', P.sortMembers(M.filter(x => !x.del), T).map(x => x.id), ['1', '2', '4', '5', '3']);
  // files
  const big = 'A'.repeat(P.CHUNK * 2 + 10);
  check('files: split into 500 KB pieces and joined back (array or object from the database)',
    [P.chunk(big).length, P.unchunk(P.chunk(big)) === big, P.unchunk({ 1: 'cd', 0: 'ab', 2: 'e' }), P.unchunk(null), P.chunk('').length], [3, true, 'abcde', '', 1]);
  check('files: size guard (PDF ≤ 1.5 MB, pictures ≤ 1.2 MB after shrinking, nothing else), base64 sizes, shrinking to 1600 px',
    [P.docCheck('application/pdf', 1.4 * 1048576), !!P.docCheck('application/pdf', 1.6 * 1048576), P.docCheck('image/jpeg', 500000), !!P.docCheck('image/jpeg', 1.3 * 1048576), !!P.docCheck('application/zip', 10), P.b64Len(3), P.b64Bytes('QUJD'), P.b64Bytes('QUI='), J(P.scaleTo(4000, 3000, 1600)), J(P.scaleTo(800, 600, 1600))],
    ['', true, '', true, true, 4, 3, 2, { w: 1600, h: 1200 }, { w: 800, h: 600 }]);
  check('files: what a file is from its name', ['EID_784199012345671 2.pdf', 'signed waiver.jpg', 'Receipt 123.pdf', 'IMG_0001.jpg'].map(P.guessLabel), ['ID copy', 'Signed form', 'Receipt', 'Other']);
  // import of the team's sheet (made-up rows)
  const sheet = [['Gym Membership Tracker'], [], ['Guest Name', 'Mobile number ', 'Start Date', 'End Date', 'Car Plate Number', 'Amount Paid'],
    ['Test Person One', '0501234567', '13.10.2026', '12.11.2026', 'E16477', 299],
    ['Test Person Two', 971500000000, 46301, 46482, 'No car', 'AED 1,499.00'],
    ['Test Person Three', '', '21/10/2026', '', 'no', ''],
    ['', '', '', '', '', ''], ['Bad Dates', '', 'soon', 'later', '', ''], ['Total', '', '', '', '', 2097]];
  const R = P.importRows(sheet, T);
  check('import: header found (spaces and case ignored), dd.mm.yyyy, Excel serial dates, dd/mm/yyyy, plates, amounts; bad rows listed, totals skipped',
    [R.header, J(R.rows.map(r => [r.name, r.phone, r.start, r.end, r.len, r.plate, r.price])), J(R.skipped)],
    [2, [['Test Person One', '0501234567', '2026-10-13', '2026-11-12', '1m', 'E16477', 299], ['Test Person Two', '971500000000', '2026-10-06', '2027-04-05', '6m', 'No car', 1499], ['Test Person Three', '', '2026-10-21', '2026-11-20', '1m', 'No car', 0]], [{ line: 8, name: 'Bad Dates', why: 'no dates' }]]);
  check('import: date cells (serial, dd.mm.yyyy, dd/mm/yyyy, with a time, text) and a CSV with quotes / semicolons',
    [P.cellDate(46308), P.cellDate('13.10.2026'), P.cellDate('13/10/2026'), P.cellDate('13/10/2026 00:00'), P.cellDate('46308'), P.cellDate('x'), J(P.parseCsv('Guest Name,Amount Paid\n"Doe, Test",299\n')), J(P.parseCsv('a;b\r\n1;2'))],
    ['2026-10-13', '2026-10-13', '2026-10-13', '2026-10-13', '2026-10-13', '', [['Guest Name', 'Amount Paid'], ['Doe, Test', '299']], [['a', 'b'], ['1', '2']]]);
  const have = [{ id: 'x1', name: 'Test Person One', phone: '+971 50 123 4567', start: '2026-10-13', end: '2026-11-12', plate: 'E16477', hist: { h: { start: '2026-10-13', end: '2026-11-12', price: 299 } } },
    { id: 'x2', name: 'Test Person Two', phone: '0509999999', start: '2026-04-06', end: '2026-10-05' }];
  const plan = P.mergePlan(have, R.rows.concat([{ line: 99, name: 'Test Person Three', phone: '', start: '2026-10-21', end: '2026-12-20', len: '2m', plate: '', price: 0 }]));
  check('import merge: same name + mobile → same / update, another mobile → new, duplicates in the file → the latest end',
    plan.map(p => `${p.row.name}:${p.act}:${p.changes.join('+')}:${p.row.end}`), ['Test Person One:same::2026-11-12', 'Test Person Two:new::2027-04-05', 'Test Person Three:new::2026-12-20']);
  check('import merge: a later period is a new period; a changed plate shows',
    P.mergePlan([{ id: 'y', name: 'Test Person One', phone: '0501234567', start: '2026-09-13', end: '2026-10-12', plate: 'No car' }], R.rows.slice(0, 1)).map(p => p.act + ':' + p.changes.join('+')), ['update:car plate+new period']);
  check('price presets: 1 month 299, 6 months 1499, others none; settings win (0 = none)',
    [P.pricePreset({}, '1m'), P.pricePreset(null, '6m'), P.pricePreset({}, '30d'), P.pricePreset({ prices: { '1m': 350, '6m': 0 } }, '1m'), P.pricePreset({ prices: { '6m': 0 } }, '6m')], [299, 1499, '', 350, '']);
  // the manager's report
  const RM = P.reportModel(M, M, T, { scope: 'all', hotel: 'Test Hotel', user: 'Tester' });
  check('report: the team sheet\'s columns first, then status…; rows sorted by end; totals of the amounts',
    [RM.head.slice(0, 6), RM.rows.map(r => r[0]), J(RM.rows[1]), RM.total[5], RM.meta], [['Guest Name', 'Mobile', 'Start', 'End', 'Car Plate', 'Amount Paid (AED)'], ['Alpha Test', 'Beta Test', 'Delta Test', 'Epsilon Test', 'Gamma Test'],
      ['Beta Test', '', '2026-10-05', '2026-10-22', 'E16477', 299, 'Ending soon', 1, 'Pool', 'Outside', 'No'], 2396, 'Test Hotel · 21 Oct 2026 · All · Prepared by Tester']);
  check('report scopes: active only, ending ≤ 7 days, this month; the second part lists ending soon & expired; KPIs',
    [P.scopeFilter(M, 'active', T).map(x => x.id), P.scopeFilter(M, 'ending', T).map(x => x.id), P.scopeFilter(M, 'month', T).map(x => x.id), RM.attention.map(r => r[0]), J(RM.kpis.map(k => k[1]))],
    [['1', '2', '4'], ['1', '2'], ['1', '2', '3', '4', '5'], ['Alpha Test', 'Beta Test', 'Gamma Test'], [3, 2, 1, 'AED 598']]);
  check('report: Excel day numbers, dd.mm.yyyy for the PDF, file name, the PDF shows no ID number',
    [P.xlSerial('2026-10-13'), P.xlSerial('x'), P.dDot('2026-10-13'), P.fileName('Test Hotel', T), /784/.test(P.reportHtml(RM)), /13\.10\.2026|05\.10\.2026/.test(P.reportHtml(RM))],
    [46308, '', '13.10.2026', 'Gym - Pool Memberships Test Hotel 21 Oct 2026.xlsx', false, true]);
  check('member card: masked ID unless asked, the period and the waiver line',
    [/784-XXXX-XXXXXXX-1/.test(P.cardHtml(M[0], { today: T })), /784-1990-1234567-1/.test(P.cardHtml(M[0], { today: T, fullId: true })), /own risk/.test(P.cardHtml(M[0], { today: T }))], [true, true, true]);
}

// ── In-House Guests (inhouse.js): Opera Cloud delimited report, counts, find(room), WhatsApp lookup, drop routing ──
console.log('\nIn-House Guests');
{
  const sb = { console: { log() {}, warn() {}, error() {} } };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'inhouse.js'), 'utf8'), sb, { filename: 'inhouse.js' });
  const P = sb.hoInHousePure, T = '2026-10-21', J = x => JSON.parse(JSON.stringify(x));
  // made-up guests only
  const TAB = ['In House Guests Report', 'Property: TEST', '',
    'ROOM\tGUEST_NAME\tARRIVAL\tDEPARTURE\tNIGHTS\tADULTS\tCHILDREN\tRATE_CODE\tSHARE_AMOUNT\tCOMPANY_NAME\tTRAVEL_AGENT_NAME\tMARKET_CODE\tBALANCE\tVIP\tMEMBERSHIP\tCONFIRMATION_NO\tNATIONALITY\tPAYMENT_METHOD\tRESV_STATUS\tCOMMENTS\tFLOOR',
    '0113\tTestperson, Alpha, Mr\t18-OCT-26\t21-OCT-26\t3\t2\t0\tBAR\t450.00\t\t\tTRN\t1,120.50\t\t\t111222\tGB\tCA\tCHECKED IN\tlate co asked\t1',
    '0204\tExample, Beta\t14-OCT-26\t22-OCT-26\t\t1\t1\tCORP\t380\tTest Corp LLC\t\tCOR\t0\tVIP1\tALL1234567\t111333\tIN\tAX\tCHECKED IN\t\t2',
    '0204\tExample, Gamma\t14-OCT-26\t22-OCT-26\t8\t1\t0\tCORP\t0\tTest Corp LLC\t\tCOR\t-50.00\t\t\t111334\tIN\tAX\tCHECKED IN\t\t2',
    '0310\tSample, Zeta\t21-OCT-26\t04-NOV-26\t14\t2\t0\tLSTAY\t300\t\tTest Travel Ltd\tLEI\t0\t\t\t111335\tDE\tVI\tCHECKED IN\t\t3',
    'Total Rooms: 3\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t'].join('\r\n');
  const R = P.parseReport(TAB);
  check('in-house: tab report with title lines → header found, columns by name, unknown column kept, totals line skipped',
    [R.delim, R.cols.map(c => c.f).join(), R.extraCols, R.rows.length, R.skipped, R.errors],
    ['tab', 'room,name,arrival,departure,nights,adults,children,rateCode,rate,company,agent,market,balance,vip,member,conf,nat,pay,status,notes', ['FLOOR'], 4, 1, []]);
  check('in-house: a row read (name "Last, First, Mr" → First Last, Opera dates, money with commas, nights worked out when empty)',
    [J(R.rows[0]).name, R.rows[0].arrival, R.rows[0].departure, R.rows[0].balance, R.rows[0].rate, J(R.rows[0].extra), R.rows[1].nights, R.rows[1].vip, R.rows[1].member, R.rows[2].balance],
    ['Alpha Testperson', '2026-10-18', '2026-10-21', 1120.5, 450, { FLOOR: '1' }, 8, 'VIP1', 'ALL1234567', -50]);
  const CSV = '"Room No.","Last Name","First Name","Arr.","Dep.","Pax","Rate Code","Rate","Travel Agent","Balance","Conf #","Notes"\n' +
    '"421","Sample","Delta","2026-10-20","2026-10-27","2/1","OTA","1,250.00","Test OTA","(25.00)","9988","needs ""quiet"" room, high floor"\n' +
    '"0007","Doe","Epsilon","20/10/2026","21/10/2026","1","BAR","300","","0","9989","two\nlines"\n';
  const C = P.parseReport(CSV);
  check('in-house: comma CSV with quotes (commas, "" and a line break inside), Room No. / Last / First / Arr. / Dep. / Pax 2/1 / Conf #',
    [C.delim, C.cols.map(c => c.f).join(), J(C.rows.map(r => [r.room, r.name, r.arrival, r.departure, r.nights, r.adults, r.children, r.balance, r.conf, r.notes]))],
    ['comma', 'room,last,first,arrival,departure,pax,rateCode,rate,agent,balance,conf,notes',
      [['421', 'Delta Sample', '2026-10-20', '2026-10-27', 7, 2, 1, -25, '9988', 'needs "quiet" room, high floor'], ['0007', 'Epsilon Doe', '2026-10-20', '2026-10-21', 1, 1, 0, 0, '9989', 'two lines']]]);
  check('in-house: pipe and semicolon files, Guest / Arrival Date / Departure Date / Adults / Children / Market Code / Membership Number',
    [P.parseReport('Room|Guest|Arrival Date|Departure Date|Adults|Children\n512|Test Guest|20/10/26|23/10/26|2|0').rows.map(r => r.room + ' ' + r.name + ' ' + r.arrival + ' ' + r.departure + ' ' + r.adults).join(),
      P.parseReport('Rm No;Full Name;Check In;Check Out;Market Code;Membership Number\n618;Placeholder Kim;2026-10-19;2026-10-25;COR;12345').rows.map(r => [r.room, r.name, r.departure, r.market, r.member].join(' ')).join()],
    ['512 Test Guest 2026-10-20 2026-10-23 2', '618 Placeholder Kim 2026-10-25 COR 12345']);
  check('in-house dates: 20-OCT-26, 20-Oct-2026, 2026-10-20, 20/10/2026, 20.10.26, Oct 20 2026, with a time, mm/dd when it must, Excel day; junk → empty',
    ['20-OCT-26', '20-Oct-2026', '2026-10-20', '20/10/2026', '20.10.26', 'Oct 20, 2026', '20/10/2026 14:00', '10/20/2026', '46315', '31/02/2026', 'soon', ''].map(P.parseDate),
    ['2026-10-20', '2026-10-20', '2026-10-20', '2026-10-20', '2026-10-20', '2026-10-20', '2026-10-20', '2026-10-20', '2026-10-20', '', '', '']);
  check('in-house: no Room column / empty → a clear error, no rows',
    [P.parseReport('Name\tArrival\nTest Guest\t20-OCT-26').errors[0], P.parseReport('').errors[0], P.parseReport('ROOM\tGUEST_NAME\nTOTAL\t3').errors[0].slice(0, 21)],
    ['No header row with a Room column and a name or date column was found in the first lines.', 'The report is empty.', 'The header was found ']);
  // counts (rooms, sharers, departing today / tomorrow, long stays, VIP, balances)
  const rooms = P.groupRooms(R.rows.concat(C.rows));
  const S = P.summary(rooms, T);
  check('in-house counts: rooms (sharers in one room), guests, departing today / tomorrow, arrived today, long stays, VIP, open balances',
    [S.rooms, S.guests, S.adults, S.children, S.depToday, S.depTomorrow, S.arrToday, S.long, S.vip, S.balance, S.balanceRooms, S.members],
    [5, 11, 9, 2, 2, 1, 1, 3, 1, 1120.5, 1, 1]);
  check('in-house filters and sort: departing today, tomorrow, long stay, balance owing, search by company / confirmation / name, sort by departure',
    [rooms.filter(r => P.matches(r, 'today', T)).map(r => r.room), rooms.filter(r => P.matches(r, 'tomorrow', T)).map(r => r.room), rooms.filter(r => P.matches(r, 'long', T)).map(r => r.room),
      rooms.filter(r => P.matches(r, 'balance', T)).map(r => r.room), rooms.filter(r => P.searchHit(r, 'test corp')).map(r => r.room), rooms.filter(r => P.searchHit(r, '9988')).map(r => r.room),
      rooms.filter(r => P.searchHit(r, 'gamma')).map(r => r.room), rooms.filter(r => P.searchHit(r, '113')).map(r => r.room), rooms.filter(r => P.searchHit(r, '111334')).map(r => r.room), P.sortRooms(rooms, 'departure').map(r => r.room)],
    [['0113', '0007'], ['0204'], ['0204', '0310', '421'], ['0113'], ['0204'], ['421'], ['0204'], ['0113'], ['0204'], ['0007', '0113', '0204', '421', '0310']]);
  check('in-house: same-day reload preview (+ new, − gone, changed)',
    J(P.diff(R.rows, R.rows.filter(r => r.room !== '0310').map(r => (r.room === '0113' ? Object.assign({}, r, { departure: '2026-10-23', balance: 0 }) : r)).concat(C.rows.slice(0, 1)))),
    { added: [{ room: '421', name: 'Delta Sample' }], gone: [{ room: '0310', name: 'Zeta Sample' }], changed: [{ room: '0113', name: 'Alpha Testperson', what: ['departure 21 Oct → 23 Oct', 'balance 1,120.50 → 0.00'] }] });
  check('in-house: departing tomorrow list to copy', P.tomorrowText(rooms, T, 'Test Hotel'), '🧳 Departing tomorrow 22 Oct · Test Hotel · 1 room\n0204 · Beta Example · 2+1 pax · VIP');
  const RM = P.reportModel(rooms, rooms, T, { hotel: 'Test Hotel', user: 'Tester' });
  check('in-house report: only columns the file had, rows by room, today / tomorrow marked, file name',
    [RM.head.slice(0, 6), RM.head.includes('Payment'), RM.rows.map(r => r[0]), RM.flags, P.fileName('Test Hotel', T)],
    [['Room', 'Guest', 'Arrival', 'Departure', 'Nights', 'Adults'], true, ['0007', '0113', '0204', '0310', '421'], ['today', 'today', 'tomorrow', '', ''], 'In-House Guests Test Hotel 21 Oct 2026.xlsx']);
  // the API other modules use
  sb.hoInHouse.setSnapshot({ date: T, at: '2026-10-21T05:00:00Z', by: 'Tester', rows: R.rows.concat(C.rows) });
  const F = r => { const f = sb.hoInHouse.find(r); return f ? [f.room, f.name, f.departure].join(' ') : null; };
  check('hoInHouse.find: 0113 and 113 are the same room, 7 finds 0007, sharers come with the room; unknown → null',
    [F('113'), F('0113'), F(113), F('7'), J(sb.hoInHouse.find('204').names), F('999'), sb.hoInHouse.date, sb.hoInHouse.rooms().length],
    ['0113 Alpha Testperson 2026-10-21', '0113 Alpha Testperson 2026-10-21', '0113 Alpha Testperson 2026-10-21', '0007 Epsilon Doe 2026-10-21', ['Beta Example', 'Gamma Example'], null, T, 5]);

  // WhatsApp: findRoom looks in the in-house list first (then Purpose of Stay, Arrivals, the tally as before)
  sb.hoLocalISO = () => T;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'wa-bridge.js'), 'utf8'), sb, { filename: 'wa-bridge.js' });
  sb.purposeGuests = [{ room: '421', name: 'PURPOSE GUEST' }, { room: '0206', name: 'OTHER GUEST' }];
  const WF = r => { const f = sb.hoWaPure.findRoom(r); return f ? f.src + ':' + f.name : 'none'; };
  check('wa findRoom: the in-house list first, other lists after it; a guest whose departure is past is not in the hotel',
    [WF('421'), WF('0113'), WF('206'), WF('999')], ['in-house list:Delta Sample', 'in-house list:Alpha Testperson', 'in-house list:OTHER GUEST', 'none']);
  sb.hoLocalISO = () => '2026-10-28';
  check('wa findRoom: after the in-house guest\'s departure the next list answers', WF('421'), 'in-house list:PURPOSE GUEST');
}
// WhatsApp "421 Early Depart" for a room that is not on today's departures: found in-house → added to the board and checked out
{
  const store = {}, toasts = [];
  const sb = { console: { log() {}, warn() {}, error() {} }, localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    document: { readyState: 'complete', addEventListener() {}, dispatchEvent() {}, getElementById() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; } },
    addEventListener() {}, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    currentProfile: { name: 'Test User' }, depLog: [], depRooms: [], DAY: '2026-10-11',
    depRender() {}, updateDepBadge() {}, saveDeps() {}, saveDepartures() {}, logActivity() {}, showToast: (m, t) => toasts.push(m), showUndoToast: (m, fn) => { toasts.push(m); sb.lastUndo = fn; } };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  const dep = fs.readFileSync(path.join(ROOT, 'departures.js'), 'utf8'), ut = fs.readFileSync(path.join(ROOT, 'utils.js'), 'utf8');
  const fnSrc = (src, name) => { const i = src.indexOf('function ' + name + '('); return src.slice(i, src.indexOf('\n}\n', i) + 3); };
  vm.runInContext(fnSrc(dep, 'depAction') + fnSrc(dep, 'depAddManualRoom') + fnSrc(dep, '_depBoardDate') + fnSrc(ut, 'parseOperaDate') + 'function hoLocalISO() { return DAY; }', sb);
  // inhouse.js without a page (its panel needs a real document): only its data part
  const ih = fs.readFileSync(path.join(ROOT, 'inhouse.js'), 'utf8').replace("const doc = typeof document", 'const doc = null && typeof document');
  vm.runInContext(ih, sb, { filename: 'inhouse.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'wa-bridge.js'), 'utf8'), sb, { filename: 'wa-bridge.js' });
  sb.depRooms.push({ room: 101, roomStr: '101', name: 'TEST GUEST', arrival: '', departure: '11-OCT-26', nights: 1, balance: 0, depTime: '', status: 'due', lateTime: '', extensionNights: 0, intent: '', note: '', checkoutAt: '' });
  sb.hoInHouse.setSnapshot({ date: '2026-10-11', rows: sb.hoInHousePure.parseReport('ROOM\tGUEST_NAME\tARRIVAL\tDEPARTURE\n0421\tSample, Delta\t09-OCT-26\t14-OCT-26\n0101\tGuest, Test\t10-OCT-26\t11-OCT-26').rows });
  sb.hoWaBridge.handle({ id: 'ih1', text: '421 Early Depart', sender: 'Sam Test', time: '10:05' }, 'page');
  const r421 = sb.depRooms.find(r => r.roomStr === '421') || {};
  const res = sb.hoWaBridge.log()[0].res.map(r => r.st + ' ' + r.room + ' ' + (r.text || '')).join();
  check('wa + in-house: "421 Early Depart" (not on departures) → found in the in-house list, added to Departures and checked out',
    [r421.status, r421.name, r421.manual, /added from in-house list/.test(res), /^co 421/.test(res)], ['out', 'DELTA SAMPLE', true, true, true]);
}

// ── Dropping files: an Opera in-house report goes to In-House Guests, a departures report still to Departures ──
{
  const sb = { console: { log() {}, warn() {}, error() {} }, document: { addEventListener() {}, getElementById() { return null }, querySelector() { return null }, body: { classList: { toggle() {} } } }, setTimeout: () => 0 };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  const ih = fs.readFileSync(path.join(ROOT, 'inhouse.js'), 'utf8').replace("const doc = typeof document", 'const doc = null && typeof document');
  vm.runInContext(ih, sb, { filename: 'inhouse.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'file-router.js'), 'utf8'), sb, { filename: 'file-router.js' });
  const d = (n, h) => (sb.frDetect(n, h) || {}).dest || null;
  const IH = 'ROOM\tGUEST_NAME\tARRIVAL\tDEPARTURE\n0113\tA, B\t18-OCT-26\t21-OCT-26\n0204\tC, D\t14-OCT-26\t25-OCT-26\n0310\tE, F\t20-OCT-26\t22-OCT-26\n';
  const DEP = 'ROOM\tGUEST_NAME\tARRIVAL\tDEPARTURE\n0113\tA, B\t18-OCT-26\t21-OCT-26\n0204\tC, D\t14-OCT-26\t21-OCT-26\n0310\tE, F\t20-OCT-26\t21-OCT-26\n';
  const ARR = 'ROOM\tGUEST_NAME\tARRIVAL\tDEPARTURE\n0113\tA, B\t21-OCT-26\t23-OCT-26\n0204\tC, D\t21-OCT-26\t25-OCT-26\n0310\tE, F\t21-OCT-26\t22-OCT-26\n';
  check('drop: in-house report by name or by its rows; departures and arrivals-like lists are not taken; Inhouse Tally files stay theirs',
    [d('inhouse_guests.txt', ''), d('In House 21 Oct.csv', ''), d('report.txt', IH), d('report.txt', DEP), d('departure_all.txt', IH), d('report.txt', ARR) !== 'inhouse', d('gibyroom.txt', '') , d('Inhouse.xml', '')],
    ['inhouse', 'inhouse', 'inhouse', 'departures', 'departures', true, 'itGiby', null]);
}

// ── Room card + shared room notes (room-card.js): room matching, stays, which notes show, the timeline ──
{
  const sb = { console: { log() {}, warn() {}, error() {} } };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'room-card.js'), 'utf8'), sb, { filename: 'room-card.js' });
  const P = sb.hoRoomPure, T = '2026-10-21';
  check('room card: 0113 and 113 are the same room; 1130, A113 are not',
    [P.roomKey('0113'), P.roomKey(' 113 '), P.sameRoom('0113', '113'), P.sameRoom('113', '1130'), P.sameRoom('A113', '113'), P.sameRoom('', ''), P.roomKey('rm 113')], ['113', '113', true, false, false, false, '']);
  check('room card: a room in a text — "0113" finds 113; not 1130, 11:30, AED 113.50, 2/113',
    ['rm 0113 towels', '113 CO', 'room 1130 late', 'call at 11:30', 'paid 113.50', 'on 2/113', 'HO - 113, 204 ok'].map(t => P.mentionsRoom(t, '113')), [true, true, false, false, false, false, true]);
  check('room card: dates from Opera / Excel / ISO', [P.isoDate('21-OCT-26'), P.isoDate('21/10/2026'), P.isoDate('2026-10-21'), P.isoDate('soon')], ['2026-10-21', '2026-10-21', '2026-10-21', '']);
  const A = P.makeStay({ conf: '700001', name: 'Fakeworth, Xi, Mr', arrival: '19-OCT-26', departure: '2026-10-23' });
  check('room card: a stay from the in-house list', A, { confs: ['700001'], name: 'Fakeworth, Xi, Mr', arrival: '2026-10-19', departure: '2026-10-23' });
  check('room card: same stay — confirmation first, then arrival date, then name',
    [P.sameStay(A, { confs: ['700001'], name: 'Other' }), P.sameStay(A, { confs: ['700002'] }), P.sameStay(A, { name: 'XI FAKEWORTH', arrival: '2026-10-19' }), P.sameStay(A, { name: 'XI FAKEWORTH', arrival: '2026-10-20' }),
     P.sameStay(A, { name: 'Sample Delta' }), P.sameStay(A, null), P.sameStay({ arrival: '2026-10-19' }, { arrival: '2026-10-19' })], [true, false, true, false, false, null, true]);
  check('room card: a new note lasts — just today / until departure / 7 days when nothing is known',
    [P.untilFor('today', A, T), P.untilFor('stay', A, T), P.untilFor('stay', null, T), P.untilFor('stay', { departure: '2026-10-01' }, T)], [T, '2026-10-23', '2026-10-28', '2026-10-28']);
  const at = h => new Date(2026, 9, 20, h, 0).getTime();
  const notes = {
    a: { text: 'Late taxi at 4', cat: 'taxi', at: at(9), scope: 'stay', stay: A, until: '2026-10-23' },
    b: { text: 'Old guest note', at: at(8), scope: 'stay', stay: { confs: ['699999'], name: 'Example, Beta' }, until: '2026-10-20' },
    c: { text: 'Pinned VIP', cat: 'vip', at: at(7), scope: 'stay', stay: A, until: '2026-10-23', pin: true },
    d: { text: 'Just yesterday', at: at(10), scope: 'today', until: '2026-10-20' },
    e: { text: 'Today only', at: at(11), scope: 'today', until: T },
    f: { text: 'Nobody knew the guest', at: at(12), scope: 'stay', until: '2026-10-22' },
    g: { text: '   ', at: at(13), scope: 'stay' },
  };
  const ids = (cur, day) => P.notesFor(notes, cur, day || T).map(n => n.id);
  check('room card: notes for the same guest — pinned first, then newest; other guest and yesterday-only hidden', ids(A), ['c', 'f', 'e', 'a']);
  check('room card: an extension keeps the stay notes after the departure date written', ids(Object.assign({}, A, { departure: '2026-10-26' }), '2026-10-25'), ['c', 'a']);
  check('room card: a new guest in the room hides the old stay notes', ids(P.makeStay({ conf: '800123', name: 'Newcomer, Test', arrival: T })), ['f', 'e']);
  check('room card: nobody known in the room → each note until its own date', ids(null), ['c', 'f', 'e', 'a']);
  check('room card: who may change a note', [P.canEdit({ by: 'Sam Test' }, { name: 'Sam Test', role: 'agent' }), P.canEdit({ by: 'Sam Test' }, { name: 'Lee Test', role: 'agent' }), P.canEdit({ by: 'Sam Test' }, { name: 'Max Test', role: 'manager' }),
    P.canEdit({ by: 'X', uid: 'u1' }, { name: 'X', uid: 'u2', role: 'supervisor' }), P.canEdit({ by: 'Sam Test' }, { name: 'Sam Test', role: 'readonly' })], [true, false, true, false, false]);
  const day = new Date(2026, 9, 21).getTime();
  const M = P.mergeTimeline([[{ src: 'wa', id: 'w1', at: day + 9 * 36e5, text: 'a' }, { src: 'wa', id: 'w1', at: day + 9 * 36e5, text: 'dup' }],
    [{ src: 'dep', id: 'd1', at: day + 9 * 36e5, text: 'b' }, { src: 'ho', id: 'h1', at: day + 15 * 36e5, text: 'c' }],
    [{ src: 'log', id: 'l1', at: day - 5 * 864e5, text: 'old' }, { src: 'log', id: 'l2', at: day - 5 * 864e5, text: 'old but open', keep: true }, { src: 'gym', id: 'g', at: NaN }]], { since: day - 864e5 });
  check('room card: timeline — newest first, each item once, same time by source, before the stay only when still open', M.map(i => i.id), ['h1', 'd1', 'w1', 'l2']);
  check('room card: Ops Brain words → the room', ['room 512', 'what\'s up with 512?', 'room card 0113', 'whats going on in room 204', 'notes for 305', 'late checkouts today', '512 towels'].map(P.brainRoom), ['512', '512', '0113', '204', '305', '', '']);
  check('room card: summary for WhatsApp', P.summaryText({ room: '512', guest: 'Xi Fakeworth', dates: '19 Oct → 23 Oct', dep: '', notes: [{ cat: 'vip', text: 'Pinned  VIP' }, { cat: 'zzz', text: 'Late taxi' }] }),
    '🛏️ Room 512 · Xi Fakeworth\n19 Oct → 23 Oct\n⭐ Pinned VIP\n📝 Late taxi');
}

// ── In-House ↔ Departures (inhouse.js overlay): check-outs, extensions, LCO, rooms missing on either side ──
console.log('\nIn-House linked with Departures');
{
  const sb = { console: { log() {}, warn() {}, error() {} } };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'inhouse.js'), 'utf8'), sb, { filename: 'inhouse.js' });
  const P = sb.hoInHousePure, T = '2026-10-21', J = x => JSON.parse(JSON.stringify(x));
  // made-up guests only
  const IH = ['ROOM\tGUEST_NAME\tARRIVAL\tDEPARTURE\tADULTS\tCHILDREN',
    '0113\tTestperson, Alpha\t18-OCT-26\t21-OCT-26\t2\t0',     // checked out on the board ("113")
    '0204\tExample, Beta\t14-OCT-26\t21-OCT-26\t1\t1',          // extended +2
    '0310\tSample, Zeta\t19-OCT-26\t21-OCT-26\t2\t0',           // late check-out 14:00
    '0412\tDoe, Epsilon\t20-OCT-26\t21-OCT-26\t1\t0',           // left, waiting for Finance
    '0507\tPlaceholder, Kim\t17-OCT-26\t21-OCT-26\t2\t0',       // not on the board
    '0618\tFake, Omega\t19-OCT-26\t24-OCT-26\t1\t0',            // may extend… but stays anyway
    '0720\tNewcomer, Test\t21-OCT-26\t23-OCT-26\t2\t0',         // re-let: the board's guest left this room today
    '0809\tExample, Theta\t20-OCT-26\t22-OCT-26\t1\t0'].join('\n'); // departs tomorrow
  const rooms = P.groupRooms(P.parseReport(IH).rows);
  const D = (room, o) => Object.assign({ room: parseInt(room, 10), roomStr: room, name: 'X', departure: '21-OCT-26', status: 'due', lateTime: '', extensionNights: 0, intent: '', checkoutAt: '' }, o);
  const board = [D('113', { status: 'out', checkoutAt: '11:02' }), D('204', { status: 'extended', extensionNights: 2 }), D('310', { status: 'late', lateTime: '14:00' }),
    D('412', { intent: 'finance_hold', finAt: '10:40', finWho: 'Finance' }), D('720', { status: 'out', checkoutAt: '09:15' }), D('999', {})];
  const L = P.liveRooms(rooms, board, {});
  const by = k => L.find(r => r.rk === k);
  check('overlay: "113" on Departures is in-house 0113 (leading zero) → checked out 11:02',
    [P.isOut(by('113')), by('113').ov.checkedOutAt, P.isOut(by('507')), !!by('507').ov], [true, '11:02', false, false]);
  check('overlay: extended +2 N on a 21 Oct departure → leaves 23 Oct, 9 nights, no longer departing today, departs 23 Oct',
    [by('204').departure, by('204').operaDeparture, by('204').nights, by('204').ov.extendedTo, P.matches(by('204'), 'today', T), P.matches(by('204'), 'tomorrow', '2026-10-22')],
    ['2026-10-23', '2026-10-21', 9, '2026-10-23', false, true]);
  check('overlay: a room re-let today (the board\'s guest left, a new guest arrived) is not marked out', [!!by('720').ov, P.isOut(by('720'))], [false, false]);
  check('overlay: LCO with time and left · waiting for Finance come through as facts', [by('310').ov.status, by('310').ov.lateTime, by('412').ov.intent, by('412').ov.finAt], ['late', '14:00', 'finance_hold', '10:40']);
  const ext = (day, n) => P.liveRooms(P.groupRooms(P.parseReport('ROOM\tGUEST_NAME\tARRIVAL\tDEPARTURE\n0901\tSample, Month\t25-OCT-26\t' + day).rows),
    [D('901', { departure: day, status: 'extended', extensionNights: n })], {})[0];
  check('overlay: extension across month and year ends (30 Oct +3 → 2 Nov, 31 Dec +2 → 2 Jan, 28 Feb +1 → 1 Mar)',
    [ext('30-OCT-26', 3).departure, ext('31-DEC-26', 2).departure, ext('28-FEB-27', 1).departure, ext('30-NOV-26', 1).departure], ['2026-11-02', '2027-01-02', '2027-03-01', '2026-12-01']);
  check('overlay: Opera already has the new date (in-house loaded after the extension) → not added twice',
    P.liveRooms(P.groupRooms(P.parseReport('ROOM\tGUEST_NAME\tARRIVAL\tDEPARTURE\n0204\tExample, Beta\t14-OCT-26\t23-OCT-26').rows), [D('204', { status: 'extended', extensionNights: 2 })], {}).map(r => [r.departure, r.nights, !!r.ov, r.operaDeparture || ''])[0],
    ['2026-10-23', 9, true, '']);
  const S = P.liveSummary(L, T);
  check('counts: checked-out rooms not counted (rooms, guests, departing today); extended moves out of today; left-for-Finance still a room but not a guest in the hotel',
    [S.rooms, S.out, S.guests, S.inHotel, S.depToday, S.depTomorrow, S.ext, S.late, S.left, S.leftPax], [7, 1, 11, 10, 3, 1, 1, 1, 1, 1]);
  check('Departures missing: in-house rooms leaving today not on today\'s board (with name and today\'s date); none when the board is another day\'s',
    [J(P.missingFromBoard(L, board, T)), P.missingFromBoard(L, board.map(d => Object.assign({}, d, { departure: '20-OCT-26' })), T).length, P.missingFromBoard(L, [], T).length],
    [[{ room: '0507', rk: '507', name: 'Kim Placeholder', departure: T }], 0, 0]);
  check('on Departures but not in-house (gone per Opera), checked-out ones left out', P.boardNotInHouse(rooms, board.concat([D('1001', { status: 'out' })])), ['999']);
  const M1 = P.rememberBoard(null, board, T);
  check('remembered today: check-outs and extensions only', Object.keys(M1.rooms).sort(), ['113', '204', '720']);
  const M2 = P.rememberBoard(M1, [D('113', {}), D('310', {})], T);
  check('remembered: Undo on the board forgets the room; a board loaded again without the room keeps it; another day starts empty',
    [Object.keys(M2.rooms).sort(), Object.keys(P.rememberBoard(M2, [], '2026-10-22').rooms)], [['204', '720'], []]);
  const L2 = P.liveRooms(rooms, [D('310', {})], { memory: M1.rooms });
  check('remembered facts lay over when the board no longer has the room', [P.isOut(L2.find(r => r.rk === '113')), L2.find(r => r.rk === '204').departure, L2.find(r => r.rk === '113').ov.onBoard], [true, '2026-10-23', false]);
  check('Opera day for a room added to Departures', [P.operaDay('2026-10-21'), P.operaDay('2027-01-02'), P.operaDay('')], ['21-OCT-26', '02-JAN-27', '']);
  // the API: find(room) carries the overlay (status, checkedOutAt, extendedTo)
  sb.hoLocalISO = () => T;
  sb.depRooms = board;
  sb.hoInHouse.setSnapshot({ date: T, rows: P.parseReport(IH).rows });
  const F = r => { const f = sb.hoInHouse.find(r); return [f.status, f.checkedOutAt, f.extendedTo, f.departure, f.onDepartures]; };
  check('hoInHouse.find: status out with time, extended with the new date, nothing for a room not on the board',
    [F('113'), F('0204'), F('507')], [['out', '11:02', '', '2026-10-21', true], ['extended', '', '2026-10-23', '2026-10-23', true], ['', '', '', '2026-10-21', false]]);
  // WhatsApp: a room checked out today and no longer on the board (loaded again since) is not put back
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'wa-bridge.js'), 'utf8'), sb, { filename: 'wa-bridge.js' });
  sb.depRooms = [D('310', {})];
  sb.hoInHouse.setMemory(M1);
  const WF = r => { const f = sb.hoWaPure.findRoom(r); return f ? [f.src, !!f.out, f.checkoutAt || ''] : null; };
  check('wa findRoom: checked out today (remembered) → found with out, not re-added; an in-house room still in → found', [WF('113'), WF('0507')], [['in-house list', true, '11:02'], ['in-house list', false, '']]);
}

// ── Hotel setup (hotel-setup.js): defaults, merge, shifts, menu, categories, copy to another hotel ──
{
  console.log('\nHotel setup');
  const mkSb = () => {
    const store = {};
    const sb = { console: { log() {}, warn() {}, error() {} }, setTimeout: () => 0,
      localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } } };
    sb.window = sb; sb.globalThis = sb; vm.createContext(sb);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'hotel-setup.js'), 'utf8'), sb, { filename: 'hotel-setup.js' });
    return sb;
  };
  const sb = mkSb(), P = sb.hoSetupPure, C = sb.hoCfg, J = x => JSON.parse(JSON.stringify(x));
  check('setup: nothing saved → the defaults (12:00 out, 15:00 in, extensions by 18:00)', [C.checkoutMin(), C.checkinMin(), C.extendByMin(), C.followRoster(), J(C.hiddenForAll())], [720, 900, 1080, true, []]);
  const M = P.merge({ profile: { checkout: '11:00', checkin: 'noon', extendBy: 99 }, shifts: { morning: { from: '06:00' } }, dep: { lcoTimes: ['13:00', 'x'] }, junk: 1 });
  check('setup: saved values over the defaults; a bad time or type keeps the default; unknown sections dropped',
    [M.profile.checkout, M.profile.checkin, M.profile.extendBy, M.shifts.morning.from, M.shifts.morning.to, M.shifts.night.label, J(M.dep.lcoTimes), 'junk' in M], ['11:00', '15:00', '18:00', '06:00', '15:00', 'Night', ['13:00'], false]);
  check('setup: time helpers', [P.toMin('7:05'), P.toMin('24:00'), P.toMin(''), P.ampm(1080), P.ampm(1110), P.ampm(720, 1), P.hhmm(425)], [425, null, null, '6 PM', '6:30 PM', '12:00 PM', '07:05']);
  const B = P.shiftBounds({ morning: { label: 'Early', from: '06:00', to: '14:00' }, afternoon: { from: '14:00', to: '22:00' }, night: { from: '22:00', to: '06:00' } });
  check('setup: shift bounds keep their ids, take the names and hours', B.map(b => [b.id, b.label, b.from, b.to]), [['Morning', 'Early', 360, 840], ['Afternoon', 'Afternoon', 840, 1320], ['Night', 'Night', 1320, 360]]);
  check('setup: which shift a time is in (night goes past midnight)', [P.shiftAt(B, 359), P.shiftAt(B, 360), P.shiftAt(B, 1319), P.shiftAt(B, 1320), P.shiftAt(B, 0)], ['night', 'morning', 'afternoon', 'night', 'night']);
  check('setup: hours with no shift and hours with two',
    J(P.shiftCheck(P.shiftBounds({ morning: { from: '07:00', to: '16:00' }, afternoon: { from: '15:00', to: '22:00' }, night: { from: '23:00', to: '07:00' } }))), { gaps: [[1320, 1380]], overlaps: [[900, 960]] });
  check('setup: the default shifts cover the day once', J(P.shiftCheck(P.shiftBounds())), { gaps: [], overlaps: [] });
  const defs = [{ id: 'desk', title: 'Front Desk', pages: ['home', 'departures', 'arrivals'] }, { id: 'night', title: 'Night Audit', pages: ['checklist', 'audit'] }, { id: 'tools', title: 'Tools', pages: ['qr'] }];
  check('menu: no setup → the default groups', J(P.navPlan(defs, { groups: null })), defs);
  check('menu: saved order, renamed group, a page moved between groups; a page the setup does not name goes back to its own group',
    J(P.navPlan(defs, { groups: [{ id: 'night', title: 'Nights', pages: ['audit', 'departures'] }, { id: 'desk', title: '', pages: ['home', 'audit'] }, { id: 'gx', title: 'Mine', pages: [] }] })),
    [{ id: 'night', title: 'Nights', pages: ['audit', 'departures', 'checklist'] }, { id: 'desk', title: 'Front Desk', pages: ['home', 'arrivals'] }, { id: 'gx', title: 'Mine', pages: [] }, { id: 'tools', title: 'Tools', pages: ['qr'] }]);
  check('cats: extra words → a whole-word pattern', [P.wordsRe('shuttle, bus to mall').test('the bus  to mall at 5'), P.wordsRe('shuttle').test('shuttles'), P.wordsRe(''), P.wordsRe('a')], [true, false, null, null]);
  check('copy: a new hotel gets the setup without this hotel\'s name',
    J(P.forNewHotel({ profile: { shortName: 'Sample Inn', checkout: '11:00' }, shifts: { followRoster: false } })), { profile: { checkout: '11:00' }, shifts: { followRoster: false } });
  const F = P.readFile(JSON.stringify({ hotelops: 'setup', v: 1, setup: { profile: { shortName: 'Other Inn', checkout: '11:30' }, bogus: {} }, td: { tdRate: 15 }, balOk: ['Expedia', ''] }));
  check('copy: a setup file → known sections only, the name dropped, sources tidied', [F.setup.profile.checkout, 'shortName' in F.setup.profile, 'bogus' in F.setup, F.td.tdRate, J(F.balOk)], ['11:30', false, false, 15, ['expedia']]);
  let bad = ''; try { P.readFile('{"hotelops":"settings"}'); } catch (e) { bad = e.message; }
  check('copy: another kind of file is refused', bad, 'not a HotelOps setup file');
  C.set('profile', { checkout: '11:00', extendBy: '17:30' }); C.set('menu', { hidden: ['qr', 'settings'] });
  check('setup: a saved section answers at once (Settings can never be hidden)', [C.checkoutMin(), C.extendByMin(), sb.hoCheckoutMin(), J(C.hiddenForAll()), C.shiftRanges().night], [660, 1050, 660, ['qr'], '23:00 - 07:00']);
  C.set('profile', null);
  check('setup: reset → the default again', C.checkoutMin(), 720);
  // the Handover Book and HK requests use the categories through their own tables
  const hb = mkSb();
  for (const f of ['wa-bridge.js', 'wa-brain.js', 'handover-book.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), hb, { filename: f });
  const H = hb.hoHandoverPure, WB = hb.hoWaBrainPure;
  check('cats: built-in handover sorting before any setup', [H.categorize('taxi to airport 5am'), H.categorize('mall bus at 9'), H.categorize('valet key for 512')], ['transport', 'info', 'desk']);
  hb.hoCfg.set('cats', { ho: { transport: { label: 'Cars', icon: '🚐', words: 'mall bus', hue: 90 }, lost: { off: true }, cz: { custom: true, label: 'Parking', icon: '🅿️', words: 'valet' } },
    hk: { towel: { label: 'Bath towels' }, cot: { off: true }, ck: { custom: true, label: 'Umbrella', words: 'umbrella' } } });
  check('cats: renamed, recoloured, extra words, switched off, added',
    [H.categorize('mall bus at 9'), H.CAT.transport.label, H.CAT.transport.icon, H.CAT.transport.hue, H.categorize('lost and found: item found'), H.categorize('valet key for 512'), H.CATS.some(c => c[0] === 'lost'), (H.CATS.find(c => c[0] === 'cz') || [])[1]],
    ['transport', 'Cars', '🚐', 90, 'info', 'cz', false, 'Parking']);
  check('cats: HK requests follow it too', [WB.wbCategorize('need towels 512').map(c => c.label).join(), WB.wbCategorize('baby cot please').map(c => c.id).join(), WB.wbCategorize('umbrella for 301').map(c => c.id).join()], ['Bath towels', '', 'ck']);
  hb.hoCfg.set('cats', null);
  check('cats: reset → the built-in names and words', [H.CAT.transport.label, H.categorize('mall bus at 9'), H.CATS.some(c => c[0] === 'lost'), WB.wbCategorize('baby cot please').map(c => c.id).join(), WB.wbCategorize('need towels 512').map(c => c.label).join()],
    ['Transport', 'info', true, 'cot', 'Towels']);
  hb.hoCfg.set('shifts', { morning: { label: 'Early', from: '06:00', to: '14:00' }, afternoon: { from: '14:00', to: '22:00' }, night: { from: '22:00', to: '06:00' } });
  check('shifts: the Handover Book takes the hotel\'s hours and names', [['06:30', '13:59', '14:00', '22:30', '05:59'].map(H.shiftOf), H.SHIFT_BOUNDS[0].label], [['Morning', 'Morning', 'Afternoon', 'Night', 'Night'], 'Early']);
  hb.hoCfg.set('shifts', null);
  check('shifts: reset → 07 / 15 / 23 again', ['06:59', '07:00', '15:00', '23:00'].map(H.shiftOf), ['Night', 'Morning', 'Afternoon', 'Night']);
}

// ── Words & phrases (words-page.js): built-in patterns → readable words; words added and built-in words removed ──
{
  console.log('\nWords & phrases');
  const store = {};
  const sb = { console: { log() {}, warn() {}, error() {} }, setTimeout: () => 0,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } } };
  sb.window = sb; sb.globalThis = sb; vm.createContext(sb);
  for (const f of ['hotel-setup.js', 'wa-bridge.js', 'wa-brain.js', 'handover-book.js', 'room-health.js', 'words-page.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  const P = sb.hoWordsPure, S = sb.hoSetupPure, WB = sb.hoWaBrainPure, H = sb.hoHandoverPure, C = sb.hoCfg, J = x => JSON.parse(JSON.stringify(x));
  check('words: optional letters and spaces are written out', J([P.reWords(/\b(?:towels?|bath ?mat)\b/), P.reWords(/\b(?:a\/c|ac|aircon)\b/), P.reWords(/\b(?:iron(?:ing)?(?: board)?)\b/)]),
    [['towel', 'towels', 'bath mat', 'bathmat'], ['a/c', 'ac', 'aircon'], ['iron', 'iron board', 'ironing', 'ironing board']]);
  check('words: any ending is "…", a number "#", look-arounds left out, a word with no end boundary goes on',
    J([P.reWords(/\b(?:leak\w*|drain\w*)\b/), P.reWords(/\b(?:\d) ?nights?\b/), P.reWords(/\b(?:(?<!\btea\s)bags?)\b/), P.reWords(/\btaxi|\bcab\b/), P.reWords(/\bair[\s-]?con\b/)]),
    [['leak…', 'drain…'], ['# night', '# nights', '#night', '#nights'], ['bag', 'bags'], ['taxi…', 'cab'], ['air con', 'air-con', 'aircon']]);
  check('words: too many combinations → one short form', J(P.reWords(/\b(?:a|b|c|d|e)(?:f|g|h|i|j)(?:k|l)\b/)), ['(a|b|c|d|e)(f|g|h|i|j)(k|l)']);
  check('words: every built-in HK and handover pattern reads as words (no raw pattern left)',
    Object.values(WB.CAT_RE).concat(H.CAT_RULES.map(r => r[1])).every(re => { const L = P.reWords(re); return L.length && L.every(w => !/[\\[\]?*+{}]|\(\?/.test(w)); }), true);
  check('words: a removed word as a pattern (… any ending, a space or none, (a|b) one of them)',
    [S.dropPat('leak…').test('leaking'), S.dropPat('leak…').test('leak'), S.dropPat('bath mat').test('bathmat'), S.dropPat('mov(e|ed) (to|from)').test('moved from'), S.dropPat('towel').test('towels'), S.dropPat('')], [true, true, true, true, false, null]);
  check('words: keepHit skips removed words only', [S.keepHit(/\b(?:towels?|tissues?)\b/, 'towels and tissue', S.dropList(['towels'])), S.keepHit(/\b(?:towels?|tissues?)\b/, 'more towels', S.dropList({ 0: 'towels' })), S.keepHit(/\btowels?\b/, 'towels', [])], [true, false, true]);
  check('words: a removed word shows as removed', [P.isDropped('bathmat', ['bath mat']), P.isDropped('towels', ['towel']), P.isDropped('leaking', ['leak…'])], [true, false, true]);
  const cat = t => WB.wbCategorize(t).map(c => c.id).join();
  check('words: before any change', [cat('512 kleenex please'), cat('need towels 512'), cat('512 bath mat'), H.categorize('booked a taxi'), H.categorize('taxi to airport')], ['', 'towel', 'towel', 'transport', 'transport']);
  C.set('cats', { hk: { tp: { words: 'kleenex, tissue box' }, towel: { drop: ['towel', 'towels'] } }, ho: { transport: { drop: ['taxi…'] } } });
  check('words: an added word sorts the message; a removed built-in word no longer counts (other words still do)',
    [cat('512 kleenex please'), cat('512 tissue box please'), cat('need towels 512'), cat('512 bath mat'), cat('512 towel and bath mat'), H.categorize('booked a taxi'), H.categorize('taxi to airport')], ['tp', 'tp', '', 'towel', 'towel', 'info', 'transport']);
  C.set('cats', { hk: { towel: { label: 'Bath towels', drop: ['towels'] } } });
  check('words: renaming keeps the removed words', [WB.CATS.towel.label, cat('need towels 512'), cat('need a towel')], ['Bath towels', '', 'towel']);
  C.set('cats', null);
  check('words: restored → the built-in words count again', [cat('need towels 512'), H.categorize('booked a taxi')], ['towel', 'transport']);
  check('words: what the WhatsApp reader made of a message', [P.parseLine(sb.hoWaParse('324 CO')), P.parseLine(sb.hoWaParse('0113 EXT 2N')), P.parseLine(sb.hoWaParse('415 change bed'))],
    ['✓ 324 checked out', '↪ 0113 extended +2N', '📝 415 note']);
}


// ── Package Audit: team changes, month-to-month memory, report columns, settings, ✓ Fixed ──
{
  console.log('\nPackage Audit · memory, team, columns, settings, fixed');
  const noop = () => {}, el = () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop }, addEventListener: noop, appendChild: noop, querySelector: () => null, querySelectorAll: () => [] });
  const saved = [];
  const sb = { console: { log() {}, warn() {}, error() {}, info() {} }, setTimeout: () => 0, clearTimeout: noop, setInterval: () => 0, JSON, Math,
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: noop, createElement: el, head: el(), body: el(), readyState: 'complete' },
    addEventListener: noop, navigator: { onLine: true }, showToast: noop, showUndoToast: noop, logActivity: noop,
    fbUpdate: (p, patch) => saved.push(['update', p, JSON.parse(JSON.stringify(patch))]), fbSet: (p, v) => saved.push(['set', p, v]) };
  sb.window = sb; sb.globalThis = sb; sb.__saved = saved;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'package-audit.js'), 'utf8'), sb, { filename: 'package-audit.js' });
  const run = js => vm.runInContext(`(() => { ${js} })()`, sb);
  // A made-up hotel: September, then October. Guest Fakeworth stays 25 Sep → 5 Oct with breakfast
  // sold by Sam (login CHAIN-SALVAREZ); the October log no longer reaches that sale.
  vm.runInContext(`
    var U = (conf, product, employee, charge, daily, room) => ({ conf, room: room || '101', charge, days: '', arr: '25-Sep-2026', dep: '05-Oct-2026', daily, status: 'APPROVED',
      product, employee, needsProduct: /unknown/i.test(product), needsEmployee: !employee || employee === '-' });
    function sepAudit() {
      pkgRules = Object.assign({}, PKG_RULE_DEFAULTS); pkgMemory = {}; pkgPins = {}; pkgLearned = {};
      pkgGuests = { M1: { name: 'FAKEWORTH, XI', norm: 'FAKEWORTH XI', gid: 'G77', room: '101', arr: '25-SEP-26', dep: '30-SEP-26' } };
      pkgUnknowns = [U('M1', 'Breakfast', 'CHAIN-LMORENO', 24.48, '28-Sep-2026'), U('M1', 'Unknown Product', '-', 24.48, '29-Sep-2026'),
                     U('M2', 'Late Check Out', 'Lina MORENO', 50, '29-Sep-2026', '102')];
      pkgEvents = { M1: [{ action: 'ADDED', code: 'UPS30BB', ts: 202609200900, user: 'CHAIN-SALVAREZ@CHAIN', price: '24.48', from: '25-SEP-26', to: '29-SEP-26' }],
                    M2: [{ action: 'ADDED', code: 'USS100LC', ts: 202609290800, user: 'CHAIN-LMORENO@CHAIN', price: '50' }] };
      _pkgRecomputeLogRange();
      return _pkgCompute();
    }
    function octAudit(js) {
      pkgUnknowns = [U('M1', 'Breakfast', 'CHAIN-LMORENO', 24.48, '01-Oct-2026'), U('M1', 'Unknown Product', '-', 24.48, '02-Oct-2026')];
      pkgEvents = { Z9: [{ action: 'ADDED', code: 'UPS30BB', ts: 202610010900, user: 'CHAIN-TKHAN@CHAIN', price: '24.48' }] };
      if (js) js();
      _pkgRecomputeLogRange();
      return _pkgCompute();
    }
    var who = r => r.conf + ':' + r.verdict + ':' + _pkgUserLabel(r.user) + (r.carriedFrom ? ':↪' + r.carriedFrom.month : '');
  `, sb);
  const sepMem = run(`const res = sepAudit(); const b = _pkgMemoryBuild(res, {}, { at: 'T', by: 'Tester' }); return { keys: Object.keys(b.patch).sort(), rec: b.next.M1.BB };`);
  check('memory: September remembers every credited package (booking/kind)', sepMem.keys, ['M1/BB', 'M2/LC']);
  check('memory: the record keeps code, seller, dates, guest and how it was decided',
    [sepMem.rec.code, sepMem.rec.seller, sepMem.rec.from, sepMem.rec.to, sepMem.rec.guest, sepMem.rec.gid, sepMem.rec.how, sepMem.rec.first, sepMem.rec.months['202609'].n],
    ['UPS30BB', 'CHAIN-SALVAREZ@CHAIN', 20260925, 20260929, 'FAKEWORTH, XI', 'G77', 'opera', '202609', 2]);
  check('memory: October without memory — the sale is before the log (not in log)',
    run(`sepAudit(); pkgMemory = {}; return octAudit().map(who).join(' ');`), 'M1:outside:CHAIN-LMORENO M1:outside:-');
  check('memory: October with September remembered — the stay continues, Sam keeps it, unknown night named',
    run(`pkgMemory = _pkgMemoryBuild(sepAudit(), {}).next; return octAudit().map(who).join(' ');`),
    'M1:credit:CHAIN-SALVAREZ:↪202609 M1:credit:CHAIN-SALVAREZ:↪202609');
  check('memory: the Unknown Product night gets the remembered code and still asks for package + seller',
    run(`pkgMemory = _pkgMemoryBuild(sepAudit(), {}).next; const r = octAudit()[1]; return [r.code, r.needsProduct, r.reassign, _pkgActionText(r), _pkgFamilyName(r)];`),
    ['UPS30BB', true, false, 'Set package + seller', 'Breakfast']);
  check('memory: a report never confirms itself (September memory does not touch September)',
    run(`pkgMemory = _pkgMemoryBuild(sepAudit(), {}).next; pkgEvents = {}; _pkgRecomputeLogRange(); return _pkgCompute().filter(r => r.carriedFrom).length;`), 0);
  check('memory: rule switched off — every month on its own again',
    run(`pkgMemory = _pkgMemoryBuild(sepAudit(), {}).next; pkgRules.memory = false; return octAudit().map(r => r.verdict).join(' ');`), 'outside outside');
  check('memory: a later colleague in October’s log does not take a package Sam started in September',
    run(`pkgMemory = _pkgMemoryBuild(sepAudit(), {}).next; return octAudit(() => { pkgEvents.M1 = [{ action: 'ATTACHED', code: 'UPS30BB', ts: 202610010700, user: 'CHAIN-TKHAN@CHAIN', price: null }]; })[0].user;`),
    'CHAIN-SALVAREZ@CHAIN');
  check('memory: the same guest extending onto a new booking in October keeps the September seller (profile ID)',
    run(`pkgMemory = _pkgMemoryBuild(sepAudit(), {}).next;
      pkgGuests = { N5: { name: 'XI FAKEWORTH', norm: 'FAKEWORTH XI', gid: 'G77', room: '101', arr: '30-SEP-26', dep: '04-OCT-26' } };
      pkgUnknowns = [U('N5', 'Breakfast', 'CHAIN-TKHAN', 24.48, '02-Oct-2026')];
      pkgEvents = { N5: [{ action: 'ADDED', code: 'UPS30BB', ts: 202609301000, user: 'CHAIN-TKHAN@CHAIN', price: '24.48' }] };
      _pkgRecomputeLogRange(); const r = _pkgCompute()[0]; return [r.user, r.reassign, r.carriedFrom.conf, /Same stay as booking M1/.test(r.memoryNote)];`),
    ['CHAIN-SALVAREZ@CHAIN', true, 'M1', true]);
  check('memory: both bookings in October\u2019s guest list — the extension still goes to the September seller, not IN-Gauge\u2019s guess',
    run(`pkgMemory = _pkgMemoryBuild(sepAudit(), {}).next;
      pkgGuests = { M1: { name: 'FAKEWORTH, XI', norm: 'FAKEWORTH XI', gid: 'G77', room: '101', arr: '25-SEP-26', dep: '30-SEP-26' },
                    N5: { name: 'XI FAKEWORTH', norm: 'FAKEWORTH XI', gid: 'G77', room: '101', arr: '30-SEP-26', dep: '04-OCT-26' } };
      pkgUnknowns = [U('M1', 'Breakfast', 'CHAIN-LMORENO', 24.48, '01-Oct-2026'), U('N5', 'Breakfast', 'CHAIN-TKHAN', 24.48, '02-Oct-2026')];
      pkgEvents = { N5: [{ action: 'ADDED', code: 'UPS30BB', ts: 202609301000, user: 'CHAIN-TKHAN@CHAIN', price: '24.48' }] };
      _pkgRecomputeLogRange(); return _pkgCompute().map(r => r.conf + ':' + r.user).join(' ');`), 'M1:CHAIN-SALVAREZ@CHAIN N5:CHAIN-SALVAREZ@CHAIN');
  check('memory: a guest returning after a break is a new sale',
    run(`pkgMemory = _pkgMemoryBuild(sepAudit(), {}).next;
      pkgGuests = { N6: { name: 'XI FAKEWORTH', norm: 'FAKEWORTH XI', gid: 'G77', room: '305', arr: '10-OCT-26', dep: '12-OCT-26' } };
      pkgUnknowns = [U('N6', 'Breakfast', 'CHAIN-TKHAN', 24.48, '11-Oct-2026')];
      pkgEvents = { N6: [{ action: 'ADDED', code: 'UPS30BB', ts: 202610100900, user: 'CHAIN-TKHAN@CHAIN', price: '24.48' }] };
      _pkgRecomputeLogRange(); const r = _pkgCompute()[0]; return [r.user, !!r.memoryUsed];`), ['CHAIN-TKHAN', false]);
  check('memory: October adds its own month to the record; older than the months to keep is forgotten',
    run(`const m1 = _pkgMemoryBuild(sepAudit(), {}).next; pkgMemory = m1; const oct = octAudit();
      const b = _pkgMemoryBuild(oct, m1); const old = { X1: { BB: { conf: 'X1', seller: 'A', first: '202401', last: '202401', months: { '202401': { n: 1, aed: 1 } } } } };
      const c = _pkgMemoryBuild([], Object.assign({}, b.next, old), { months: 13 });
      return [Object.keys(b.next.M1.BB.months).join(','), b.next.M1.BB.how, c.patch['X1/BB'], !!c.next.M1];`),
    ['202609,202610', 'opera', null, true]);

  // Team: renamed and left colleagues
  vm.runInContext(`function team() {
    pkgStaffDb = {
      sam: { name: 'Sam KHAN', logins: ['CHAIN-SALVAREZ'], status: 'active', former: [{ name: 'Sam ALVAREZ', until: '2026-09-30' }] },
      lina: { name: 'Lina MORENO', logins: [], status: 'left', left: '2026-09-30' },
      tom: { name: 'Tom KHANDI', logins: ['CHAIN-TKHANDI'], status: 'active' } };
    _pkgApplyStaff(); pkgResults = [];
  }`, sb);
  check('team: a renamed colleague — old login and old IN-Gauge name both read as the new name',
    run(`team(); return [_pkgUserLabel('CHAIN-SALVAREZ@CHAIN'), _pkgUserLabel('Sam ALVAREZ'), _pkgSameUser('Sam ALVAREZ', 'Sam KHAN'), _pkgSameUser('CHAIN-SALVAREZ', 'Sam KHAN')];`),
    ['Sam KHAN', 'Sam KHAN', true, true]);
  check('team: a rename does not join two different people', run(`team(); return [_pkgSameUser('CHAIN-TKHANDI', 'Sam ALVAREZ'), _pkgSameUser('Tom KHANDI', 'Sam KHAN')];`), [false, false]);
  check('team: someone who left still gets their old sales, but is not offered for new ones',
    run(`team(); sepAudit(); team(); const r = _pkgCompute().find(x => x.conf === 'M2');
      return [_pkgUserLabel(r.user), r.verdict, _pkgSellerChoices().join('|'), _pkgSellerChoices(['Lina MORENO']).includes('Lina MORENO')];`),
    ['Lina MORENO', 'credit', 'Sam KHAN|Tom KHANDI', true]);
  check('team: a pasted list / CSV — names, logins, who left; header skipped',
    run(`return JSON.stringify(_pkgParseTeamText('Name,Logins,Status\\nAna TEST,CHAIN-ATEST;ATEST2,active\\nBo SAMPLE,,left,2026-08-31\\nCy EXAMPLE = CHAIN-CEXAMPLE'));`),
    JSON.stringify([{ name: 'Ana TEST', logins: ['CHAIN-ATEST', 'ATEST2'], status: 'active' }, { name: 'Bo SAMPLE', logins: [], status: 'left', date: '2026-08-31' }, { name: 'Cy EXAMPLE', logins: ['CHAIN-CEXAMPLE'] }]));
  check('team: importing merges by name, old name or login and never removes anyone',
    run(`team(); const m = _pkgTeamMerge(pkgStaffDb, [{ name: 'Sam ALVAREZ', logins: ['SALV2'] }, { name: 'New PERSON', logins: [] }, { name: 'Lina MORENO', logins: [], status: 'active' }]);
      return [m.added, m.updated, m.next.sam.logins.join(','), m.next.lina.status, Object.keys(m.next).length];`),
    [1, 2, 'CHAIN-SALVAREZ,SALV2', 'active', 4]);

  // Report columns
  const rows = [['IN-Gauge export'], [''], ['Item', 'Booking Ref', 'Room No', 'Product Charge', 'Seller', 'Daily Date'], ['Breakfast', '7001', '101', 24.48, 'Ana TEST', '01-Oct-2026']];
  check('columns: renamed headers are not found until mapped', run(`pkgSettings = _pkgMergeSettings({}); return _pkgParseExcelUnknowns(${JSON.stringify(rows)}).length + ':' + pkgLastHeaders.ig.missing.join('/')`), '0:Product (package)/Confirmation no.');
  check('columns: mapped in Settings — read from the right columns, header row found below a title',
    run(`pkgSettings = _pkgMergeSettings({ colMap: { ig: { product: 'Item', conf: 'booking ref', employee: 'Seller' } } }); const r = _pkgParseExcelUnknowns(${JSON.stringify(rows)});
      return [r.length, r[0].conf, r[0].product, r[0].employee, r[0].charge, pkgLastHeaders.ig.row];`), [1, '7001', 'Breakfast', 'Ana TEST', 24.48, 3]);
  check('columns: the usual IN-Gauge headers still work with nothing mapped',
    run(`pkgSettings = _pkgMergeSettings({}); const r = _pkgParseExcelUnknowns([['Product', 'Confirmation No', 'Employee'], ['Breakfast', '7002', '-']]); return [r[0].conf, r[0].needsEmployee];`), ['7002', true]);
  check('columns: guest list mapped too', run(`pkgSettings = _pkgMergeSettings({ colMap: { guest: { name: 'Who' } } }); return Object.keys(_pkgParseGuestList([['Confirmation Number', 'Who'], ['7003', 'TEST, ANA']]));`), ['7003']);

  // Settings merged with the defaults
  check('settings: nothing stored = the defaults', run(`return JSON.stringify(_pkgMergeSettings(null)) === JSON.stringify(PKG_SETTINGS_DEFAULTS);`), true);
  check('settings: bad values are clamped, lists from the database (objects) read back in order',
    run(`const s = _pkgMergeSettings({ doneDays: 2, memMonths: 99, chrome: 'Line A, Line B', kinds: { 1: { k: 'lc', label: 'Late', re: 'LC$' }, 0: { k: 'bb', label: 'Breakfast', re: 'BB$', codes: { 0: 'mbreak ' } } } });
      return [s.doneDays, s.memMonths, s.chrome.join('|'), s.kinds.map(k => k.k).join(','), s.kinds[0].codes[0]];`), [7, 36, 'Line A|Line B', 'BB,LC', 'MBREAK']);
  check('settings: a hotel’s own kind (Spa) with an exact code, then back to default',
    run(`const L = PKG_KINDS_DEFAULT.concat([{ k: 'SPA', label: 'Spa', re: '^SPA', codes: ['RELAX1'], once: true, ig: 'Spa Treatment' }]);
      _pkgSetKinds(_pkgMergeSettings({ kinds: L }).kinds); const a = [_pkgKindOfCode('SPA60'), _pkgKindOfCode('relax1'), _pkgIsOneTime('Spa Treatment'), _pkgKindOfCode('UPS30BB')];
      _pkgSetKinds(null); return a.concat([_pkgKindOfCode('RELAX1'), PKG_KINDS.length]);`), ['SPA', 'SPA', true, 'BB', 'RELAX', 7]);
  check('settings: my view keeps my order, adds new values, drops unknown ones',
    run(`return JSON.stringify(_pkgMergeView({ chips: ['seller', 'nope', 'conf', 'seller'], hidden: ['guest', 'x'] }));`),
    JSON.stringify({ chips: ['seller', 'conf', 'room', 'pkg', 'code', 'price', 'dates', 'guest'], hidden: ['guest'] }));
  check('settings: a setup for another hotel carries kinds and rules, never the team',
    run(`pkgSettingsRaw = { doneDays: 60 }; pkgRules = Object.assign({}, PKG_RULE_DEFAULTS, { chainGap: 1 }); pkgStaffDb = { a: { name: 'Ana TEST' } };
      const k = _pkgKitRead(JSON.stringify(_pkgKit())); pkgRules = Object.assign({}, PKG_RULE_DEFAULTS);
      return [k.settings.doneDays, k.rules.chainGap, JSON.stringify(k).includes('Ana'), _pkgKitRead('{"app":"other"}')];`), [60, 1, false, null]);

  // ✓ Fixed: copying never marks; Fixed is shared, stays fixed, and a teammate's fix merges in
  vm.runInContext(`function fixedSetup() {
    pkgStaffDb = {}; _pkgApplyStaff(); pkgSettings = _pkgMergeSettings({}); pkgDone = {}; pkgMemory = {}; pkgReportAt = Date.parse('2026-10-11T06:00:00Z');
    sepAudit(); pkgResults = _pkgCompute(); _pkgRemember(_pkgDoneLast, {});
  }`, sb);
  check('fixed: copying a value only copies — the package stays to fix',
    run(`fixedSetup(); pkgCopyConf(null, 'M1'); pkgCopyChip({ getAttribute: () => 'M1', textContent: '', classList: { add() {}, remove() {} } });
      return [Object.keys(pkgDone).length, _pkgAllGroups().filter(g => _pkgInView(g, 'action')).map(g => g.key).join(',')];`),
    [0, 'M1|Breakfast']);
  saved.length = 0;
  check('fixed: ✓ Fixed moves it to Fixed already, saved for the team (only that entry)',
    run(`fixedSetup(); pkgMarkFixed(null, 'M1|Breakfast');
      const g = _pkgAllGroups(); return [_pkgDoneState('M1|Breakfast'), g.filter(x => _pkgInView(x, 'action')).map(x => x.key).join(','), g.filter(x => pkgDone[x.key] && !x.rows.some(pkgBackWrong)).map(x => x.key).join(',')];`),
    ['waiting', '', 'M1|Breakfast']);
  check('fixed: the save is a patch of the one package, not the whole list', saved.filter(x => x[1] === 'pkgDone').map(x => Object.keys(x[2])), [['M1|Breakfast']]);
  check('fixed: a teammate’s fix arriving from the database merges with mine; the next save sends nothing old',
    run(`fixedSetup(); pkgMarkFixed(null, 'M1|Breakfast'); const mine = pkgDone['M1|Breakfast'];
      const remote = { 'M1|Breakfast': mine, 'M2|Late Check Out': { by: 'Teammate', at: '2026-10-11T07:00:00.000Z', conf: 'M2' } };
      pkgDone = _pkgClean(remote); _pkgRemember(_pkgDoneLast, pkgDone); const before = __saved.length; _pkgSaveDone();
      return [Object.keys(pkgDone).sort().join(','), __saved.length - before];`), ['M1|Breakfast,M2|Late Check Out', 0]);
  check('fixed: stays fixed on a later report that shows it right (confirmed), comes back only if still wrong',
    run(`fixedSetup(); pkgMarkFixed(null, 'M1|Breakfast'); pkgReportAt = Date.now() + 3600e3;
      const back = _pkgDoneState('M1|Breakfast');
      pkgResults.forEach(r => { if (r.conf === 'M1') { r.reassign = false; r.alreadyComplete = true; } });
      return [back, _pkgDoneState('M1|Breakfast')];`), ['back', 'confirmed']);
  check('fixed: kept as long as Settings says (older marks are tidied away)',
    run(`fixedSetup(); pkgSettings = _pkgMergeSettings({ doneDays: 10 }); pkgDone = { old: { at: new Date(Date.now() - 11 * 864e5).toISOString() }, recent: { at: new Date(Date.now() - 9 * 864e5).toISOString() } };
      _pkgSaveDone(); return Object.keys(pkgDone);`), ['recent']);
  check('fixed: the memory record remembers who fixed it',
    run(`fixedSetup(); pkgMemory = {}; pkgResults = _pkgCompute(); _pkgMemorize(pkgResults); pkgMarkFixed(null, 'M1|Breakfast'); return !!(pkgMemory.M1.BB.fixed && pkgMemory.M1.BB.fixed.at);`), true);

  // Learning from decisions
  check('learning: the same decision on one code twice is offered as a rule, then applied without a pin',
    run(`pkgLearned = {}; pkgPins = { 'A1|Spa': { skip: true, code: 'SPA60' }, 'A2|Spa': { skip: true, code: 'spa60' }, 'A3|Spa': { seller: 'Ana TEST', code: 'SPA60' } };
      const s = _pkgLearnSuggestions(); pkgLearned = { [s[0].id]: { id: s[0].id, type: 'skip', code: 'SPA60', by: 'Tester' } }; pkgPins = {};
      const L = _pkgLearnedFor({ code: 'SPA60', verdict: 'credit', matchedEvent: { code: 'SPA60' } });
      return [s.length, s[0].type, s[0].n, !!(L && L.pin.skip), _pkgLearnSuggestions({ 'A1|Spa': { skip: true, code: 'SPA60' }, 'A2|Spa': { skip: true, code: 'SPA60' } }).length];`),
    [1, 'skip', 2, true, 0]);
}

// ── Room Health (room-health.js): room problems → who to send, repeats, messages, fixed replies ──
console.log('\nRoom Health');
{
  const sb = { console: { log() {}, warn() {}, error() {} } };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'room-health.js'), 'utf8'), sb, { filename: 'room-health.js' });
  const P = sb.hoRoomHealthPure;
  const K = t => P.classify(t).kinds.map(k => k.kind).join('+') || '-';
  const phr = [
    ['AC not cooling', 'ac'], ['a/c nt cooliing pls', 'ac'], ['aircon is too cold, guest freezing', 'ac'], ['room is very hot', 'ac'],
    ['water leeking from the ceiling', 'leak'], ['dripping in bathroom', 'leak'], ['no hot water', 'hotwater'], ['water pressure very low in shower', 'hotwater'],
    ['tolet not flushing', 'plumb'], ['sink blocked', 'plumb'], ['bulb fused', 'elec'], ['no power in the room', 'elec'], ['TV remote not working', 'tv'],
    ['key card not working', 'lock'], ['safe box locked, guest cant open', 'lock'], ['fridge not cooling', 'fridge'], ['curtain motor not working', 'window'],
    ['AC making loud noise', 'machnoise'], ['wifi not wrking', 'wifi'], ['internet very slow', 'wifi'],
    ['smoke smell', 'smell'], ['smel in bathroom', 'smell'], ['cockroch in bathroom', 'pest'], ['bed bugs on the mattress', 'pest'],
    ['stains on the carpet', 'stain'], ['dirty towels', 'linen'], ['no shampoo', 'amen'], ['room not clean, guest complained', 'clean'],
    ['loud music next door', 'noise'], ['guest smoking in room', 'smoking'], ['broken chair', 'repair'],
    ['2 towels please', '-'], ['please clean the toilet', '-'], ['please send hot water for tea', '-'], ['minibar refill', '-'], ['614 double lock', '-'], ['VD dirty', '-'], ['do not disturb', '-'], ['toilet paper missing', 'amen'],
  ];
  check('room health: classifier — many made-up phrasings with typos', phr.map(([t]) => K(t)), phr.map(p => p[1]));
  check('room health: departments and severity', ['leak', 'AC not cooling', 'bulb fused', 'wifi down not working', 'cockroach', 'noise from next room'].map(t => { const k = P.classify(t).kinds[0]; return k.dept + ':' + k.severity; }),
    ['eng:high', 'eng:med', 'eng:med', 'it:med', 'hk:high', 'sec:med']);
  check('room health: negations and fixes', ['AC working now', 'no issue with the AC', 'leak fixed', 'still leaking', 'leak not fixed yet', 'AC is working?', 'done ✅', 'fixed ✅', 'AC not working now'].map(t => P.classify(t).fix || '-'),
    ['strong', 'strong', 'strong', '-', '-', '-', 'weak', 'strong', '-']);
  check('room health: rooms in a message (not times, money, nights)', [P.roomsIn('smoke smell 206, 506 paint smell'), P.roomsIn('0106 AC at 14:00'), P.roomsIn('paid AED 250 for 2 nights'), P.roomsIn('lco 1400')],
    [['206', '506'], ['0106'], [], []]);
  const ex = (text, at, extra) => P.extract(Object.assign({ text, at, source: 'wa', who: 'Sam Test' }, extra || {}));
  check('room health: one message, two rooms, two problems', ex('203 physically IP, smoke smell 206, 418 leaking again', 1).map(e => e.room + ':' + e.kind), ['206:smell', '418:leak']);
  check('room health: our own messages are never read back', [ex('Engineering: Room 512 — AC not cooling. Please check. — HotelOps', 1).length, ex('⁣512 AC not cooling', 1).length, ex('🩺 Sent Engineering for AC', 1).length], [0, 0, 0]);
  const D = (d, h, m) => new Date(2026, 9, d, h, m || 0).getTime(), NOW = D(21, 12);
  // repeats
  const evA = [].concat(ex('512 AC not cooling', D(20, 9)), ex('512 AC not cooling pls send someone', D(20, 9, 30)), ex('512 AC working now', D(20, 11)), ex('512 AC not cooling again', D(21, 10)));
  const cA = P.build(evA, { now: NOW });
  check('room health: a chase is the same case, a fix closes it, the next time is a repeat', cA.map(c => [c.status, c.reports.length, c.n7, c.repeat]), [['open', 1, 2, true], ['fixed', 2, 2, true]]);
  const evB = [].concat(ex('418 leak in bathroom', D(1, 9)), ex('418 leak fixed', D(1, 12)), ex('418 leaking from ceiling', D(10, 9)), ex('418 leak fixed', D(10, 15)), ex('418 water leak again', D(20, 8)), ex('418 leak fixed ✅', D(20, 13)));
  const cB = P.build(evB, { now: NOW });
  check('room health: 3× in 30 days is a repeat even when each was fixed', [cB.length, cB.every(c => c.status === 'fixed'), cB[0].n30, cB[0].repeat], [3, true, 3, true]);
  check('room health: one report is not a repeat; old open ones go quiet', P.build(ex('305 no hot water', D(21, 11)).concat(ex('306 TV not working', D(15, 9))), { now: NOW }).map(c => c.rk + ':' + c.status + ':' + c.repeat), ['305:open:false', '306:stale:false']);
  // done / fixed closing
  const sentId = '206|smell|' + D(21, 9);
  const evC = ex('206 smoke smell', D(21, 9)).concat(ex('206 done ✅', D(21, 10)));
  check('room health: "206 done ✅" closes only what was sent', [P.build(evC, { now: NOW })[0].status, P.build(evC, { now: NOW, acts: { [sentId]: { sent: { at: D(21, 9, 30), dept: 'hk' } } } })[0].status], ['open', 'fixed']);
  check('room health: "Done ✅" quoting the message closes it', P.build(ex('512 AC not cooling', D(21, 9)).concat(ex('Done ✅', D(21, 9, 40), { quote: '512 AC not cooling' })), { now: NOW }).map(c => c.status + ':' + c.fixedBy), ['fixed:Sam Test']);
  check('room health: ✓ Fixed tapped in the app', P.build(ex('512 TV not working', D(21, 9)), { now: NOW, acts: { ['512|tv|' + D(21, 9)]: { fixedAt: D(21, 10), fixedBy: 'Lee Test' } } })[0].status, 'fixed');
  // ranking: arrival at risk > repeat > single
  const evR = [].concat(ex('206 bad smell', D(21, 8)), ex('512 AC not cooling', D(20, 9)), ex('512 AC fixed', D(20, 12)), ex('512 AC not cooling again', D(21, 9)), ex('305 no hot water', D(21, 11)));
  const cR = P.build(evR, { now: NOW });
  const recs = P.advise(cR, { now: NOW, ctx: { arr: { 206: true }, vacant: {}, vip: {} } });
  check('room health: advice — arrival at risk, then repeat, then a single report', recs.map(r => r.rk + ':' + r.type), ['206:arrival', '512:repeat', '305:single']);
  check('room health: advice titles', recs.map(r => r.title), [
    'Send HK to 206 — bad smell; deodorise before the arrival today (check-in 14:00)',
    'Send Engineering to 512 — AC not cooling reported 2× since yesterday',
    'Send Engineering to 305 — no hot water']);
  const chk = P.advise(cB, { now: NOW, ctx: { co: { 418: true } } });
  check('room health: a room that keeps leaking gets a full check while it is vacant', chk.map(r => r.type + ':' + r.title), ['check:Room 418 had a leak 3× in 30 days — ask Engineering for a full check while it\'s vacant (guest checks out today)']);
  check('room health: VIP and vacant rooms move up', P.advise(P.build(ex('101 TV not working', D(21, 9)).concat(ex('102 TV not working', D(21, 9))), { now: NOW }), { now: NOW, ctx: { vip: { 102: true } } }).map(r => r.rk), ['102', '101']);
  // messages
  check('room health: WhatsApp message for Engineering', P.compose(recs[1], null, {}), 'Engineering: Room 512 — AC not cooling (reported 2× since yesterday). Please check. — HotelOps');
  check('room health: WhatsApp message for HK before an arrival', P.compose(recs[0], null, {}), 'Housekeeping: Room 206 — bad smell. Arrival today: please deodorise before check-in (14:00). — HotelOps');
  check('room health: the message reads back as ours', P.isOurs(P.compose(recs[1], null, {})), true);
  // follow-up once, only high severity
  const cF = P.build(ex('305 no hot water', D(21, 7)), { now: NOW });
  const fA = id => ({ [id]: { sent: { at: D(21, 8), dept: 'eng' } } });
  check('room health: follow-up after 3 h only for a high problem, not after a chase', [P.advise(cF, { now: NOW, acts: fA(cF[0].id) })[0].follow, P.advise(cF, { now: D(21, 10), acts: fA(cF[0].id) })[0].follow,
    P.advise(cF, { now: NOW, acts: { [cF[0].id]: { sent: { at: D(21, 8) }, chased: D(21, 11) } } })[0].follow], [true, false, false]);
  // settings
  const cfg = P.mergeCfg({ depts: { eng: { group: 'Eng Team Test' }, ga: { name: 'Guest Relations', emoji: '💐' } }, kinds: { ac: { kw: 'ac, aircon, klima' }, gx: { label: 'Balcony door', dept: 'ga', kw: 'balcony door' } }, th: { rep7: 3 } });
  check('room health: settings — own words, a new department and problem type', [cfg.depts.find(d => d.id === 'eng').group, P.classify('klima kaputt', cfg).kinds.map(k => k.kind).join(), P.classify('balcony door broken', cfg).kinds.map(k => k.dept).join(), cfg.th.rep7, cfg.th.rep30],
    ['Eng Team Test', 'ac', 'ga', 3, 3]);
  const PR = P.problemRooms(cB.concat(cA), 30, NOW);
  check('room health: problem rooms ranked with their kinds', PR.map(p => p.rk + ' ' + P.kindsLine(p.kinds, P.compile())), ['418 Water leak ×3', '512 AC ×2']);
  check('room health: summary', (s => [s.open, s.repeatRooms, s.arrivals, s.fixedWeek])(P.summary(cR, recs, NOW)), [3, 1, 1, 1]);
}

// ── Phone notifications hub (notify-hub.js): quiet hours, shift gating, dedupe claims, batching, roster diff ──
console.log('\nPhone notifications hub');
{
  const sb = { console: { log() {}, warn() {}, error() {} } };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'notify-hub.js'), 'utf8'), sb, { filename: 'notify-hub.js' });
  const P = sb.hoNotifyPure, at = (h, m) => new Date(2026, 9, 11, h, m || 0);
  const Q = { quiet: true, qFrom: '23:00', qTo: '07:00' };
  check('notify: quiet hours over midnight (23:00–07:00)', [at(23, 30), at(2), at(6, 59), at(7), at(12), at(22, 59)].map(d => P.inQuiet(Q, d)), [true, true, true, false, false, false]);
  check('notify: quiet hours in the day, off, or the same time twice', [P.inQuiet({ quiet: true, qFrom: '13:00', qTo: '14:00' }, at(13, 30)), P.inQuiet({ quiet: true, qFrom: '13:00', qTo: '14:00' }, at(14)), P.inQuiet(Object.assign({}, Q, { quiet: false }), at(2)), P.inQuiet({ quiet: true, qFrom: '08:00', qTo: '08:00' }, at(8))], [true, false, false, false]);
  const cfg = JSON.parse(JSON.stringify(P.DEF)), ctx = (o, c) => Object.assign({ cfg, now: at(12), shift: 'on', openedAt: at(11).getTime() }, c || {});
  const G = (o, c) => { const g = P.gate(Object.assign({ cat: 'wakeup', prio: 3 }, o), ctx(o, c)); return g.ok ? 'ok' : g.why; };
  check('notify: on shift → goes; off shift / shift ended → waits; no roster name → goes', [G({}), G({}, { shift: 'off' }), G({}, { shift: 'ended' }), G({}, { shift: 'unknown' })], ['ok', 'off shift', 'off shift', 'ok']);
  check('notify: the roster and requests reach you on your day off; "even off shift" lets shift alerts through', [G({ cat: 'roster' }, { shift: 'off' }), G({}, { shift: 'off', cfg: Object.assign({}, cfg, { offShift: true }) }), G({ shiftChecked: true }, { shift: 'off' })], ['ok', 'ok', 'ok']);
  const qc = Object.assign({}, cfg, Q);
  check('notify: quiet hours hold prio 1–4, never urgent (5) or the guard', [G({ prio: 4 }, { cfg: qc, now: at(2) }), G({ prio: 5 }, { cfg: qc, now: at(2) }), G({ cat: 'guard', prio: 3, ignoreQuiet: true }, { cfg: qc, now: at(2) }), G({ prio: 4 }, { cfg: qc, now: at(9) })], ['quiet hours', 'ok', 'ok', 'ok']);
  check('notify: a category switched off; a test (force) always goes', [G({}, { cfg: Object.assign({}, cfg, { cats: Object.assign({}, cfg.cats, { wakeup: false }) }) }), G({ force: true }, { cfg: Object.assign({}, cfg, { cats: { wakeup: false } }), shift: 'off' }), P.catOn(cfg, 'hk'), P.catOn(cfg, 'guard')], ['switched off', 'ok', false, true]);
  check('notify: no storm on start — an event from before the app opened is dropped, a state that is still true is not', [G({ at: at(10).getTime() }), G({ at: at(10).getTime(), state: true }), G({ at: at(11, 30).getTime() }), G({})], ['old', 'ok', 'ok', 'ok']);
  const off = Object.assign({}, cfg, { offUntil: P.dayOffEnd(at(9), 1) });
  check('notify: a day off silences everything, even urgent and the guard (unless kept) — until 06:00 the morning after', [G({ prio: 5 }, { cfg: off }), G({ cat: 'guard', prio: 5, instant: true }, { cfg: off }), G({ cat: 'guard', prio: 5 }, { cfg: Object.assign({}, off, { offGuard: true }) }), G({ force: true }, { cfg: off }), G({ prio: 5 }, { cfg: off, now: new Date(2026, 9, 12, 6, 0) }), new Date(P.dayOffEnd(at(9), 2)).getDate()], ['day off', 'day off', 'ok', 'ok', 'ok', 13]);
  check('notify: a day off on the posted roster silences everything by itself; "I\'m back" today, the switch off, or a working day → alerts go', [G({ prio: 5 }, { rosterOff: true }), G({ cat: 'roster' }, { rosterOff: true }), G({ prio: 5 }, { rosterOff: true, cfg: Object.assign({}, cfg, { workDay: '2026-10-11' }) }), G({ prio: 5 }, { rosterOff: true, cfg: Object.assign({}, cfg, { workDay: '2026-10-10' }) }), G({ prio: 5 }, { rosterOff: true, cfg: Object.assign({}, cfg, { autoOff: false }) }), G({ prio: 5 }, { rosterOff: false })], ['day off', 'day off', 'ok', 'day off', 'ok', 'ok']);
  // dedupe: the first device to claim a key sends it; the claim is kept for days
  const T0 = at(12).getTime();
  check('notify: claim — nobody had it → mine; someone has it → abort; an old claim → mine again', [P.claimNext(null, 'dA', T0, 864e5), P.claimNext({ at: T0 - 5000, by: 'dB' }, 'dA', T0, 864e5), P.claimNext({ at: T0 - 5000, by: 'dA' }, 'dA', T0, 864e5), P.claimNext({ at: T0 - 2 * 864e5, by: 'dB' }, 'dA', T0, 864e5)],
    [{ at: T0, by: 'dA' }, undefined, undefined, { at: T0, by: 'dA' }]);
  // batching
  check('notify: low priority waits to be merged; urgent, the guard and "instant" never', [P.shouldBatch({ cat: 'tasks', prio: 3 }, [], T0), P.shouldBatch({ cat: 'tasks', prio: 2 }, [], T0), P.shouldBatch({ cat: 'tasks', prio: 4 }, [], T0), P.shouldBatch({ cat: 'wakeup', prio: 5 }, [], T0), P.shouldBatch({ cat: 'guard', prio: 3 }, [], T0), P.shouldBatch({ cat: 'tasks', prio: 3, instant: true }, [], T0)], [true, true, false, false, false, false]);
  const burst = Array.from({ length: 8 }, (_, i) => T0 - i * 20e3);
  check('notify: a burst (8 messages in 5 min) merges prio 4 too; old sends don\'t count', [P.storm(burst, T0), P.shouldBatch({ cat: 'departures', prio: 4 }, burst, T0), P.storm(burst.map(t => t - 6 * 60e3), T0), P.shouldBatch({ cat: 'wakeup', prio: 5 }, burst, T0)], [true, true, false, false]);
  const M = P.mergeBatch([{ cat: 'departures', prio: 3, key: 'a', title: '🚪 Room 512 past check-out', body: 'Check-out was 12:00 PM — not out yet.' }, { cat: 'departures', prio: 4, key: 'b', title: '🚪 Room 610 past check-out', body: 'x' }]);
  check('notify: two departures in a minute → one message, the louder priority, a line each', [M.title, M.prio, M.n, M.body.split('\n').length, M.body.split('\n')[0]], ['🚪 2 × Departures', 4, 2, 2, '• 🚪 Room 512 past check-out — Check-out was 12:00 PM — not out yet.']);
  const M2 = P.mergeBatch(Array.from({ length: 10 }, (_, i) => ({ cat: i % 2 ? 'tasks' : 'notes', prio: 2, key: 'k' + i, title: 'T' + i })));
  check('notify: mixed alerts merge as "N alerts" with "+N more"', [M2.title, M2.body.split('\n').length, M2.body.split('\n').pop(), P.mergeBatch([{ cat: 'tasks', title: 'one', key: 'x' }]).title], ['🔔 10 alerts', 9, '+2 more', 'one']);
  // roster: what changed for me
  const D1 = P.rosterDiff({ '2026-10-12': '07:00-15:00', '2026-10-13': 'OFF' }, { '2026-10-12': '15:00-23:00', '2026-10-13': 'off', '2026-10-14': '07:00-15:00' });
  check('notify: roster diff — a changed shift, a new posted day; OFF vs off is no change', [D1.changed, D1.added], [[{ d: '2026-10-12', f: '07:00-15:00', t: '15:00-23:00' }], [{ d: '2026-10-14', t: '07:00-15:00' }]]);
  check('notify: roster diff — nothing changed → nothing; the hash is stable', [P.rosterDiff({ a: 'X' }, { a: 'X' }), P.hash('abc') === P.hash('abc'), P.hash('abc') === P.hash('abd'), P.fbKey('wk_a.b/c#1')], [{ changed: [], added: [] }, true, false, 'wk_a_b_c_1']);
}

// The hub at work, on two devices that share one database: one sends, never twice, small ones merged
function nhDevice(db, dev, sent) {
  const store = { ho_sa_dev_v1: JSON.stringify(dev) }, timers = [];
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    document: { createElement: () => ({}), head: { appendChild() {} }, addEventListener() {}, getElementById: () => null, querySelector: () => null, visibilityState: 'hidden' },
    location: { origin: 'https://hotelops.test', pathname: '/', search: '', hash: '' }, history: { replaceState() {} },
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout() {}, setInterval: f => { f(); return 0; }, clearInterval() {},
    MutationObserver: class { observe() {} }, URLSearchParams,
    currentUser: { uid: 'u1' }, isOnline: () => true,
    fbListen: (p, cb) => cb(p === 'waGuard/u1/tg' ? { token: '123456:' + 'A'.repeat(34), bot: 'fake_test_bot', chat: 42 } : p === 'waGuard/u1/ntfy' ? { topic: 'hotelops-abcdefghijkmnop' } : null),
    fbPushLog: async () => [], fbSet: async () => {}, fbGet: async () => null,
    fetch: async (url, o) => { sent.push({ dev, url: url.replace(/bot\d+:\w+/, 'bot…'), body: typeof o.body === 'string' ? JSON.parse(o.body) : Object.fromEntries(o.body) }); return { ok: true, json: async () => ({ ok: true }) }; },
  };
  // the shared database: a claim is a transaction on notifyHub/u1/claims/{key}
  sb._ref = { child: p => ({ transaction: async f => { const v = f(db[p]); if (v === undefined) return { committed: false, snapshot: { val: () => db[p] } }; db[p] = v; return { committed: true, snapshot: { val: () => v } }; } }) };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'notify-hub.js'), 'utf8'), sb, { filename: 'notify-hub.js' });
  return { H: sb.hoNotify, timers, sb };
}
const nhAsync = (async () => {
  const db = {}, sent = [];
  const A = nhDevice(db, 'dphoneaa', sent), B = nhDevice(db, 'dpcbbbbb', sent);
  const wk = { cat: 'wakeup', prio: 5, state: true, key: 'wk_w1_1760000000000', url: 'wakeups', title: '☎️ Wake-up call now: room 512', body: '06:30' };
  const r = [await A.H.send(wk), await B.H.send(wk), await A.H.send(wk)];
  check('notify (2 devices): the phone claims a wake-up first and sends it; the PC and a second try don\'t', [r, sent.length, [...new Set(sent.map(s => s.dev))]], [[true, false, false], 2, ['dphoneaa']]);
  const nt = sent.find(s => /ntfy/.test(s.url)).body, tg = sent.find(s => /telegram/.test(s.url)).body;
  check('notify: it goes to both ways set up — ntfy (priority 5, a tap opens Wake-up Calls) and Telegram (loud)', [sent.map(s => s.url).sort(), nt.priority, nt.click, tg.disable_notification],
    [['https://api.telegram.org/bot…/sendMessage', 'https://ntfy.sh/'], 5, 'https://hotelops.test/#go=wakeups', 'false']);
  sent.length = 0;
  const p1 = A.H.send({ cat: 'departures', prio: 3, state: true, key: 'dep_od_x_512', title: '🚪 Room 512 past check-out' });
  const p2 = A.H.send({ cat: 'departures', prio: 3, state: true, key: 'dep_od_x_610', title: '🚪 Room 610 past check-out' });
  await new Promise(res => setImmediate(res));
  const before = sent.length, flushT = A.timers.find(t => t.ms === 60e3);
  await A.H.flush();
  const ok = await Promise.all([p1, p2]);
  check('notify: two low-priority alerts wait up to 60 s, then go as ONE message (per way)', [before, !!flushT, ok, sent.length, sent.find(s => /ntfy/.test(s.url)).body.title], [0, true, [true, true], 2, '🚪 2 × Departures']);
  check('notify: the recent alerts log keeps what was sent, newest first', [A.H.state.log.map(e => e.title), A.H.state.log[0].n, A.H.state.log[0].ok], [['🚪 2 × Departures', '☎️ Wake-up call now: room 512'], 2, true]);
  sent.length = 0;
  const g = await B.H.send({ cat: 'guard', prio: 5, claimed: true, instant: true, ignoreQuiet: true, title: '🚨 Someone is on your WhatsApp' });
  check('notify: the guard goes straight out from the PC that saw it (no claim, no wait)', [g, sent.length, sent.every(s => s.dev === 'dpcbbbbb')], [true, 2, true]);
})().catch(e => { fail++; console.log('  ✗ notify (2 devices) threw: ' + (e && e.stack || e)); });

// ── Opera reader: tools/hotelops-opera.console.js (reads Opera Cloud's screens) + opera-bridge.js (what the app does with them) ──
console.log('\nOpera reader');
{
  const R = require(path.join(ROOT, 'tools/hotelops-opera.console.js'));
  const J = o => JSON.parse(JSON.stringify(o));
  // headers as Opera Cloud's grids show them (with sort hints, #, slashes)
  const heads = ['Room', 'Name', 'Conf. #', 'Arrival', 'Departure', 'Nights', 'Reservation Status', 'Nationality', 'E-mail', 'Company', 'Travel Agent', 'Source', 'Rate Code', 'VIP', 'Adults/Children', 'Balance Sort ascending', 'Room Type', 'Arrival Time', 'Guest Count'];
  check('opera: headers mapped by their words', heads.map(R.fieldOf), ['room', 'name', 'conf', 'arrival', 'departure', 'nights', 'status', 'nat', 'email', 'company', 'agent', 'source', 'rateCode', 'vip', 'pax', 'balance', 'roomType', 'eta', 'pax']);
  check('opera: more spellings', ['Rm', 'Guest Name', 'Confirmation Number', 'Reservation #', 'Arr', 'Dep', 'Departure Date/Time', 'Country', 'Email Address', 'Rate Plan', 'Children', 'Adults', 'Open Balance', 'Last Name', 'Room Status', 'Something else'].map(R.fieldOf),
    ['room', 'name', 'conf', 'conf', 'arrival', 'departure', 'departure', 'nat', 'email', 'rateCode', 'children', 'adults', 'balance', 'last', 'roomStatus', '']);
  const M = R.mapHeaders(['', 'Room', 'Name', 'Status', 'Name']);
  check('opera: a grid is read when it names a room / guest and one more thing (first column wins)', [J(M.map), R.usable(M), R.usable(R.mapHeaders(['Room', 'Foo'])), R.usable(R.mapHeaders(['Nights', 'Balance']))], [{ room: 1, name: 2, status: 3 }, true, false, false]);
  check('opera: dates in en-GB, US, ISO and Opera style', ['2026-10-28', '28-OCT-26', '28-Oct-2026', '28 Oct 2026', 'Oct 28, 2026', 'Wed, 28 Oct 2026', 'Wednesday, October 28, 2026', '28/10/2026', '10/28/2026', '28.10.26', '20261028', '31-Feb-2026', 'soon'].map(d => R.parseDate(d)),
    ['2026-10-28', '2026-10-28', '2026-10-28', '2026-10-28', '2026-10-28', '2026-10-28', '2026-10-28', '2026-10-28', '2026-10-28', '2026-10-28', '2026-10-28', '', '']);
  check('opera: 05/10/2026 is 5 Oct the en-GB way, 10 May the US way', [R.parseDate('05/10/2026'), R.parseDate('05/10/2026', 'mdy')], ['2026-10-05', '2026-05-10']);
  check('opera: which way round a list writes its dates (a day over 12, or the nights)', [R.dateOrder(['10/28/2026', '10/30/2026']), R.dateOrder(['28/10/2026']), R.dateOrder(['10/11/2026', '10/12/2026'], [['10/11/2026', '10/12/2026', 1]]), R.dateOrder(['10/11/2026'], [['10/11/2026', '11/11/2026', 1]]), R.dateOrder(['01/02/2026'])],
    ['mdy', 'dmy', 'mdy', 'dmy', '']);
  check('opera: the date shown on screen', [R.findDate('Business Date 28-Oct-2026'), R.findDate('Arrivals for Wed, 28 Oct 2026 (42)'), R.findDate('Departures 2026-10-29'), R.findDate('no date')], ['2026-10-28', '2026-10-28', '2026-10-29', '']);
  check('opera: status words', ['Due In', 'Checked In', 'In House', 'Due Out', 'Checked Out', 'Departed', 'Cancelled', 'No Show', 'Reserved', 'DUE_OUT', 'Waitlist', 'Something'].map(R.normStatus),
    ['due_in', 'in_house', 'in_house', 'due_out', 'checked_out', 'checked_out', 'cancelled', 'no_show', 'due_in', 'due_out', 'waitlist', '']);
  check('opera: rooms, money, conf, email', [R.roomOf('0113 QKNG Clean'), R.roomOf('Rm 512'), R.roomOf('Assign Room'), R.roomKey('0113'), R.money('AED 1,234.50'), R.money('(120.00)'), R.money('—'), R.confOf('123456789\nGTD'), R.confOf('N/A'), R.emailOf('Mail: test.one@example.com ✉')],
    ['0113', '512', '', '113', 1234.5, -120, null, '123456789', '', 'test.one@example.com']);
  const hm = R.mapHeaders(heads).map;
  const raw = [
    R.rowFrom(['0101', 'Testperson, Alpha', '100001', '10/27/2026', '10/28/2026', '1', 'Due Out', 'GB', 'alpha.test@example.com', '', 'Made Up Travel', '', 'BAR', '', '2/1', 'AED 120.00', 'STD', ''], hm),
    R.rowFrom(['0102', 'Sample, Bravo', '100002', '10/25/2026', '10/28/2026', '', 'Checked Out', 'IN', '—', 'Made Up Corp', '', '', 'CORP', 'VIP1', '1/0', '0.00'], hm),
    R.rowFrom(['', 'Unassigned, Charlie', '100003', '10/28/2026', '10/30/2026', '2', 'Due In', '', '', '', '', '', 'BAR', 'N', '', ''], hm),
  ];
  const rows = R.finishRows(raw);
  check('opera: a grid line → a guest line (US dates read from the list, nights from the dates, pax split)', J(rows[0]),
    { room: '0101', name: 'Testperson, Alpha', conf: '100001', nights: 1, statusText: 'Due Out', status: 'due_out', roomType: 'STD', agent: 'Made Up Travel', rateCode: 'BAR', nat: 'GB', email: 'alpha.test@example.com', adults: 2, children: 1, balance: 120, arrival: '2026-10-27', departure: '2026-10-28' });
  check('opera: empty values stay out, nights counted, VIP kept, "N" is not VIP', [J(rows[1]).nights, rows[1].vip, rows[1].email, rows[2].room, rows[2].vip, rows[2].status], [3, 'VIP1', undefined, undefined, undefined, 'due_in']);
  check('opera: the same reservation read twice is one line (conf., else room + name)', [R.rowKey(rows[0]), R.rowKey({ room: '0113', name: 'Doe, Test' }), R.rowKey({ room: '113', name: 'TEST DOE' }), R.rowKey({})], ['c:100001', 'r:113|DOE TEST', 'r:113|DOE TEST', '']);
  const m1 = R.mergeRows([{ room: '0101', name: 'Testperson, Alpha', balance: 50 }, { room: '0202', name: 'Other, Guest' }], [{ room: '0101', name: 'Testperson, Alpha', conf: '100001', balance: 120 }, { room: '0303', name: 'New, One', conf: '5555' }]);
  check('opera: a long list read while scrolling: rows merged, a fresher value wins, nothing seen is dropped', J(m1), [{ room: '0101', name: 'Testperson, Alpha', balance: 120, conf: '100001' }, { room: '0202', name: 'Other, Guest' }, { room: '0303', name: 'New, One', conf: '5555' }]);
  check('opera: reservation details (label → value) → one guest line', J(R.pairsToRow([['Confirmation Number', '200005'], ['Room', '0303'], ['Name', 'Known, Kilo'], ['Arrival', '28-Oct-2026'], ['Nationality', 'Portugal'], ['Phone', '000']])),
    { room: '0303', name: 'Known, Kilo', conf: '200005', nat: 'Portugal', arrival: '2026-10-28' });
  check('opera: label pairs that are not a reservation → nothing', R.pairsToRow([['Username', 'x'], ['Room', '0303']]), null);
  check('opera: what the screen is (title / headings / address; else the statuses)', [R.pageKind(['OPERA Cloud', 'Arrivals']), R.pageKind(['Manage In House Guests']), R.pageKind(['', 'Departures (25)']), R.pageKind(['Look Up Reservations']), R.pageKind(['Reservation Overview']), R.pageKind(['OPERA Cloud', '/opera/frontdesk/ArrivalsTF']),
    R.pageKind(['OPERA Cloud'], [{ status: 'due_out' }, { status: 'checked_out' }, { status: 'due_out' }]), R.pageKind(['x'], [{ room: '1' }]), R.pageKind([])], ['arrivals', 'inhouse', 'departures', 'search', 'details', 'arrivals', 'departures', 'list', '']);
  check('opera: pill words and list totals', [R.summary('departures', 42), R.summary('arrivals', 1), R.summary('arrivals', 25, 42), R.totalOf('1-25 of 42'), R.totalOf('Total Records: 17'), R.totalOf('nothing')], ['read 42 departures', 'read 1 arrival', 'read 25 of 42 arrivals', 42, 17, 0]);
  check('opera: the reader only reads (no clicks, no typing, no innerHTML) and is the same hash for the same rows', [/\.click\(\)|dispatchEvent\(new (?:Mouse|Keyboard)|\.innerHTML|\.value\s*=[^=]/.test(fs.readFileSync(path.join(ROOT, 'tools/hotelops-opera.console.js'), 'utf8')), R.hash([1, 'a']) === R.hash([1, 'a']), R.hash([1]) !== R.hash([2])], [false, true, true]);

  // ── the app's side: what Opera's screen changes in the lists (opera-bridge.js, pure) ──
  const sb = { console: { log() {}, warn() {}, error() {} }, URL }; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'opera-bridge.js'), 'utf8'), sb, { filename: 'opera-bridge.js' });
  const O = sb.hoOperaPure, T = '2026-10-28';
  check('bridge: dates and names the board way', [O.toIso('28-OCT-26'), O.toIso('2026-10-28'), O.operaDay('2026-10-28'), O.firstLast('Doe, Test Mr.'), O.sameGuest('Testperson, Alpha', 'Alpha Testperson'), O.sameGuest('Doe, Test', 'Other Person'), O.sameGuest('', 'X Y')],
    ['2026-10-28', '2026-10-28', '28-OCT-26', 'Test Doe', true, false, true]);
  check('bridge: nationality codes → names, UAE short; OTA relay emails are not real ones', [O.natName('AE'), O.natName('gb'), O.natName('India'), O.natName('United Arab Emirates'), O.goodEmail('a.b@example.com'), O.goodEmail('x123@guest.booking.com'), O.goodEmail('No@email.com'), O.goodEmail('—')],
    ['UAE', 'United Kingdom', 'India', 'UAE', true, false, false, false]);
  const clean = sb.hoOperaPure.sanitize({ kind: 'evil', date: 'x', rows: [{ room: '0101', name: 'A'.repeat(500), balance: '12.5', nights: 'abc', arrival: 'tomorrow', hack: '<b>', status: 'due_out' }, null, { foo: 1 }] });
  check('bridge: what comes from another tab is made safe', [clean.kind, clean.date, clean.rows.length, clean.rows[0].name.length, clean.rows[0].balance, clean.rows[0].nights, clean.rows[0].arrival, clean.rows[0].hack], ['list', '', 1, 90, 12.5, undefined, undefined, undefined]);
  const mk = (n, name, x) => Object.assign({ room: parseInt(n, 10), roomStr: n, name, arrival: '', departure: '28-OCT-26', nights: 1, balance: 0, rateCode: '', company: '', isVip: false, depTime: '', status: 'due', note: 'typed by hand' }, x || {});
  const board = { day: T, rooms: [mk('0101', 'Alpha Testperson'), mk('0102', 'Bravo Sample'), mk('0104', 'Delta Demo'), mk('0105', 'Echo Fake', { status: 'out' }), mk('0106', 'Foxtrot Mock'), mk('0107', 'Golf Real')] };
  const dep = { kind: 'departures', date: T, rows: [
    { room: '0101', name: 'Testperson, Alpha', departure: T, status: 'due_out', balance: 120, rateCode: 'BAR', vip: 'VIP1' },
    { room: '0102', name: 'Sample, Bravo', departure: T, status: 'checked_out' },
    { room: '0103', name: 'Example, Charlie', departure: T, status: 'checked_out', arrival: '2026-10-25', nights: 3 },
    { room: '0104', name: 'Demo, Delta', arrival: '2026-10-27', departure: '2026-10-30', status: 'in_house' },
    { room: '0105', name: 'Fake, Echo', departure: T, status: 'checked_out' },
    { room: '0106', name: 'Mock, Foxtrot', departure: T, status: 'cancelled' },
    { room: '0107', name: 'Somebody, Else', departure: T, status: 'checked_out' },
  ] };
  const P = O.plan({ snap: dep, today: T, board, arr: [], pur: [], ih: null });
  check('bridge departures: checked out in Opera → out; already out not again; another guest in the room not touched; cancelled ignored',
    [P.dep.out.map(o => o.room), P.dep.add.map(a => a.row.room + (a.out ? ' out' : '')), P.dep.ext.map(e => e.room + ' +' + e.nights + ' → ' + e.to), J(P.dep.fill), P.notes.length, P.dep.create],
    [['0102'], ['0103 out'], ['0104 +2 → 2026-10-30'], [{ room: '0101', set: { balance: 120, rateCode: 'BAR', isVip: true } }], 2, null]);
  check('bridge: what it tells you', [O.summaryText(P), O.worthAlert(P)], ['1 room checked out, 1 room extended, 1 departure added, 1 departure updated', true]);
  check('bridge departures: no board yet (or yesterday\'s) → made from Opera; tomorrow\'s board is left alone; a search screen never makes one',
    [O.plan({ snap: dep, today: T, board: { rooms: [], day: '' }, arr: [], pur: [] }).dep.create.map(r => r.room), O.plan({ snap: dep, today: T, board: { rooms: [mk('0101', 'X')], day: '2026-10-27' }, arr: [], pur: [] }).dep.create.length,
      O.plan({ snap: dep, today: T, board: { rooms: [mk('0101', 'X')], day: '2026-10-29' }, arr: [], pur: [] }).n, O.plan({ snap: Object.assign({}, dep, { kind: 'search' }), today: T, board: { rooms: [], day: '' }, arr: [], pur: [] }).dep.create],
    [['0101', '0102', '0103', '0105', '0107'], 5, 0, null]);
  const rep = O.depReport([{ room: '0101', name: 'Testperson, Alpha', arrival: '2026-10-27', departure: T, nights: 1, balance: 120, agent: 'Made Up Travel', rateCode: 'BAR', etd: '11:30' }]);
  check('bridge: the board is made by the departures report parser (Opera\'s columns, 15+ of them)', [rep.split('\n')[0].split('\t').length >= 15, rep.split('\n')[1].split('\t').slice(0, 6), rep.split('\n')[1].split('\t')[11]],
    [true, ['0101', 'Testperson, Alpha', '27-OCT-26', '28-OCT-26', '1', '120'], '11:30']);
  // arrivals + purpose of stay
  const arr = [{ room: '0303', conf: '200005', name: 'KILO KNOWN', purpose: 'Leisure', nights: 2, nat: 'Spain', _natFromAI: true, email: 'No@email.com', source: 'ALL App', remarks: 'typed' },
    { room: 'ASSIGN', conf: '200007', name: 'MIKE WAITING', nat: 'Kenya', email: 'mike@example.com' }];
  const pur = [{ room: '0303', conf: '200005', name: 'KILO KNOWN', nat: 'Brazil', _natUserEdited: true, email: 'No@email.com' },
    { room: '0305', conf: '200008', name: 'NOVA XML', nat: 'Chile', _natFromXML: true, email: '' }, { room: '0306', conf: '200010', name: 'OSCAR SCRAPED', nat: 'Peru', email: 'oscar@example.com' }];
  const arrSnap = { kind: 'arrivals', date: T, rows: [
    { room: '0301', name: 'Newguest, Golf', conf: '200001', arrival: T, nights: 2, status: 'due_in', nat: 'AE', email: 'golf.new@example.com', agent: 'Agoda' },
    { name: 'Unassigned, India', conf: '200003', arrival: T, status: 'due_in' },
    { room: '9001', name: 'Pmroom, Juliet', conf: '200004', arrival: T, status: 'due_in' },
    { room: '0303', name: 'Known, Kilo', conf: '200005', arrival: T, status: 'due_in', nat: 'PT', email: 'kilo.known@example.com' },
    { room: '0304', name: 'Cancelled, Lima', conf: '200006', arrival: T, status: 'cancelled' },
    { room: '0310', name: 'Waiting, Mike', conf: '200007', arrival: T, status: 'due_in', nat: 'KE' },
    { room: '0305', name: 'Xml, Nova', conf: '200008', arrival: T, status: 'in_house', nat: 'AR', email: 'nova@guest.booking.com' },
    { room: '0306', name: 'Scraped, Oscar', conf: '200010', arrival: T, status: 'due_in', nat: 'CO' },
  ] };
  const A = O.plan({ snap: arrSnap, today: T, board: { rooms: [], day: '' }, arr, pur, ih: null });
  check('bridge arrivals: new ones added (with a room; PM rooms on Arrivals only), cancelled not',
    [A.arr.add.map(g => g.room + ' ' + g.name + ' ' + g.nat + ' ' + g.email + ' ' + g.source + ' ' + g.purpose), A.pur.add.map(g => g.room + ' ' + g.originOfTravel)],
    [['0301 GOLF NEWGUEST UAE golf.new@example.com Agoda Business', '9001 JULIET PMROOM  No@email.com ALL App Business', '0305 NOVA XML Argentina No@email.com ALL App Business', '0306 OSCAR SCRAPED Colombia No@email.com ALL App Business'], ['0301 ', '0310 ']]);
  check('bridge arrivals: only empty things filled — room, email, nationality; a nationality already there (guess, hand-typed, Vicas, scraper) never changed',
    [A.arr.fill.map(f => f.g.name + ' ' + JSON.stringify(f.set)), A.pur.fill.map(f => f.g.name + ' ' + JSON.stringify(f.set))],
    [['KILO KNOWN {"email":"kilo.known@example.com"}', 'MIKE WAITING {"room":"0310"}'], ['KILO KNOWN {"email":"kilo.known@example.com"}']]);
  check('bridge arrivals: an empty nationality gets Opera\'s', O.plan({ snap: arrSnap, today: T, board: { rooms: [], day: '' }, arr: [{ room: '0303', conf: '200005', name: 'KILO KNOWN', nat: '', email: '' }], pur: [] }).arr.fill.map(f => JSON.stringify(f.set)),
    ['{"email":"kilo.known@example.com","nat":"Portugal"}']);
  check('bridge arrivals: notes (cancelled, no room yet) and the words', [A.notes, O.summaryText(A)], [['1 cancelled / no-show in Opera (left as they are here)', '1 arrival without a room yet — added once Opera gives a room'], '4 new arrivals added, 3 arrivals filled in']);
  check('bridge arrivals: another day\'s arrivals change nothing', [O.plan({ snap: Object.assign({}, arrSnap, { date: '2026-10-29', rows: arrSnap.rows.map(r => Object.assign({}, r, { arrival: '2026-10-29' })) }), today: T, board: { rooms: [], day: '' }, arr, pur }).n], [0]);
  // in-house
  const ihSnap = { kind: 'inhouse', date: T, rows: [{ room: '0104', name: 'Demo, Delta', conf: '100004', arrival: '2026-10-27', departure: '2026-10-30', status: 'in_house', balance: 55.5, adults: 2, children: 1 }, { room: '0401', name: 'Stayer, Mike', conf: '300001', arrival: '2026-10-23', departure: '2026-11-01', status: 'in_house' }] };
  const I1 = O.plan({ snap: ihSnap, today: T, board: { rooms: [], day: '' }, arr: [], pur: [], ih: null });
  const I2 = O.plan({ snap: ihSnap, today: T, board: { rooms: [], day: '' }, arr: [], pur: [], ih: { date: T, rows: [{ room: '104', rk: '104', name: 'Delta Demo', conf: '100004', departure: '2026-10-29', balance: 0, notes: 'typed' }] } });
  check('bridge in-house: none today → made from the In House screen; one today → new rooms added, fresher values, nothing removed',
    [I1.ih.mode, I1.ih.add.map(g => g.rk + ' ' + g.name + ' ' + g.nights), I2.ih.mode, I2.ih.add.map(g => g.room), I2.ih.upd.map(u => JSON.stringify(u.set))],
    ['create', ['104 Delta Demo 3', '401 Mike Stayer 9'], 'merge', ['0401'], ['{"arrival":"2026-10-27","departure":"2026-10-30","nights":3,"adults":2,"children":1,"balance":55.5}']]);
  // ── more screens, privacy, learning ──
  check('opera: new header words (room status, profile) and card / secret columns are never a field',
    ['HK Status', 'FO Status', 'Discrepancy', 'Room Status', 'Membership Level', 'Preferences', 'Language', 'Credit Card Number', 'CVV', 'Card No.', 'Expiry Date'].map(R.fieldOf),
    ['hkStatus', 'foStatus', 'disc', 'roomStatus', 'memberLevel', 'prefs', 'language', '', '', '', '']);
  check('opera privacy: card numbers masked to the last 4 (spaces, dashes, a 16-digit run inside text, half-hidden); a conf. number stays',
    [R.maskCards('4111 1111 1111 1111'), R.maskCards('4111-1111-1111-1111'), R.maskCards('Paid with 4111111111111111 at the desk'), R.maskCards('VA4111XXXXXXXX1111'), R.maskCards('Amex 3782 822463 10005'), R.maskCards('Conf 123456789, room 0101, AED 1,234.50')],
    ['•••• 1111', '•••• 1111', 'Paid with •••• 1111 at the desk', 'VA•••• 1111', 'Amex •••• 0005', 'Conf 123456789, room 0101, AED 1,234.50']);
  check('opera privacy: card / CC / PAN / CVV / CVC / expiry / auth code / password / PIN labels are secret; card TYPE and payment method are not',
    ['Card Number', 'CC', 'Credit Card', 'PAN', 'CVV', 'CVC', 'Exp. Date', 'Expiry', 'Auth Code', 'Authorization Code', 'Password', 'PIN', 'Card Type', 'Payment Method', 'Exp. Departure', 'Room', 'Balance'].map(R.secretLabel),
    [true, true, true, true, true, true, true, true, true, true, true, true, false, false, false, false, false]);
  const tb = R.tableFrom(['Room', 'Card Number', 'Expiry', 'Amount', 'Notes'], [['0101', '4111 1111 1111 1111', '12/29', '120.00', 'card 4111-1111-1111-1111 on file']], 'Some screen');
  check('opera privacy: a card column is dropped from a table, a card number in another column is masked', J(tb), { title: 'Some screen', heads: ['Room', 'Amount', 'Notes'], rows: [['0101', '120.00', 'card •••• 1111 on file']] });
  check('opera privacy: the last net (every string of a snapshot, card-named keys dropped)', J(R.scrub({ rows: [{ room: '0101', notes: 'cc 4111 1111 1111 1111' }], cardNumber: '4111111111111111', extra: [['Phone', '+1 555 0100']] })),
    { rows: [{ room: '0101', notes: 'cc •••• 1111' }], extra: [['Phone', '+1 555 0100']] });
  check('opera billing: payment TYPE only', ['VA 4111 •••• 1111', 'Visa', 'MC', 'American Express', 'Cash AED', 'City Ledger', 'Direct Bill', 'Room Charge', 'Check Out'].map(R.payType), ['Visa', 'Visa', 'Mastercard', 'Amex', 'Cash', 'City Ledger', 'City Ledger', '', '']);
  const ph = ['Date', 'Code', 'Description', 'Amount', 'Supplement', 'Reference', 'Card Number'];
  const pm = R.mapHeaders(ph, R.postFieldOf);
  check('opera billing: a postings grid is known by its words (code / description + amount), the card column is no field', [J(pm.map), R.usablePost(pm), R.usablePost(R.mapHeaders(['Room', 'Name'], R.postFieldOf))],
    [{ date: 0, code: 1, desc: 2, amount: 3, ref: 4 }, true, false]);
  const posts = R.postingsFrom([['27/10/2026', '1000', 'Accommodation', '120.00', 'Room 0101', 'BK-77', '4111111111111111'], ['28/10/2026', '2005', 'Minibar', '35.50', 'Water x2', '', ''],
    ['28/10/2026', '9004', 'Visa 4111 1111 1111 1111', '-155.50', 'Auth 123456', 'XYZ', '']], pm.map, 'dmy', 1);
  check('opera billing: postings read (date, code, description, amount, supplement); a payment keeps its type only — no card, no auth code, no reference', J(posts),
    [{ code: '1000', amount: 120, date: '2026-10-27', desc: 'Accommodation', ref: 'Room 0101', window: 1 }, { code: '2005', amount: 35.5, date: '2026-10-28', desc: 'Minibar', ref: 'Water x2', window: 1 },
      { code: '9004', amount: -155.5, date: '2026-10-28', pay: 'Visa', desc: 'Visa payment', window: 1 }]);
  check('opera billing: debit / credit columns make the amount', J(R.postingsFrom([['Laundry', '20.00', ''], ['Cash', '', '20.00']], R.mapHeaders(['Description', 'Debit', 'Credit'], R.postFieldOf).map)),
    [{ code: '', amount: 20, desc: 'Laundry' }, { code: '', amount: -20, pay: 'Cash', desc: 'Cash payment' }]);
  const fo = R.folioFrom([{ n: 1, balance: 0 }, { n: 2, balance: 85 }], posts, [['Room', '0101'], ['Status', 'Checked In']]);
  check('opera billing: the folio — windows, total, payment types, open', [J(fo.windows), fo.balance, fo.zero, fo.settled, J(fo.pays), fo.status], [[{ n: 1, balance: 0 }, { n: 2, balance: 85 }], 85, false, false, ['Visa'], 'in_house']);
  const fz = R.folioFrom([], posts, [['Balance', '0.00']]);
  check('opera billing: a zero balance is settled; "Window 1 Balance" labels are windows; no windows → the postings add up', [fz.balance, fz.zero, fz.settled, J(R.folioFrom([], [], [['Window 1 Balance', '10.00'], ['Window 3 Balance', '(5.00)']]).windows), R.folioFrom([], posts.slice(0, 2), []).balance],
    [0, true, true, [{ n: 1, balance: 10 }, { n: 3, balance: -5 }], 155.5]);
  check('opera: room status words', ['Clean', 'Dirty', 'Inspected', 'Pickup', 'Out of Order', 'OOS', 'VC', 'OD', 'Occupied'].map(R.normRoomStatus), ['clean', 'dirty', 'inspected', 'pickup', 'ooo', 'oos', 'clean', 'dirty', '']);
  check('opera: the new screens', [R.pageKind(['OPERA Cloud', 'Billing']), R.pageKind(['Folio History']), R.pageKind(['Post Charges']), R.pageKind(['Room Management']), R.pageKind(['Housekeeping Board']), R.pageKind(['Manage Profile']),
    R.pageKind(['Reservation Traces']), R.pageKind(['Rate Query']), R.pageKind(['Group Rooming List']), R.pageKind(['End of Day']), R.pageKind(['Arrivals'])],
    ['billing', 'billing', 'billing', 'rooms', 'rooms', 'profile', 'traces', 'rates', 'group', 'audit', 'arrivals']);
  const tm = R.mapHeaders(['Date', 'Department', 'Trace Text', 'Resolved On'], R.traceFieldOf);
  check('opera traces: read (date, department, text, done)', [R.usableTrace(tm), J(R.tracesFrom([['28/10/2026 15:00', 'HK', 'Extra towels', ''], ['27/10/2026', 'FO', 'Call guest re card 4111 1111 1111 1111', '27/10/2026']], tm.map, 'dmy'))],
    [true, [{ text: 'Extra towels', date: '2026-10-28', time: '15:00', dept: 'HK' }, { text: 'Call guest re card •••• 1111', date: '2026-10-27', dept: 'FO', done: true }]]);
  check('opera profile: name + VIP / membership is enough (loose), the strict rule stays for reservations; every other detail kept as extra (no card / passport)',
    [J(R.pairsToRow([['Name', 'Testperson, Alpha'], ['VIP', 'V2'], ['Membership Level', 'Gold'], ['Preferences', 'High floor']], '', true)), R.pairsToRow([['Name', 'Testperson, Alpha'], ['VIP', 'V2']]),
      J(R.pairsExtra([['Phone', '+1 555 0100'], ['Credit Card', '4111 1111 1111 1111'], ['Passport No', 'X1234567'], ['Language', 'English']]))],
    [{ name: 'Testperson, Alpha', memberLevel: 'Gold', prefs: 'High floor', vip: 'V2' }, null, [['Phone', '+1 555 0100'], ['Language', 'English']]]);
  check('opera audit: state from its words', [R.auditState(['Final procedures', 'Completed']), R.auditState(['Posting room and tax', 'In progress']), R.auditState(['Print reports', 'Failed']), R.auditState([])], ['done', 'running', 'failed', '']);
  check('opera learning: button labels only — names, numbers, amounts, emails are not kept', ['Post Charge', '✓ Settle', 'Window 2', 'Doe, John', 'AED 120.00', '0101', 'test@example.com', 'Room 512', 'A very long label with far too many words in it'].map(R.cleanLabel),
    ['Post Charge', 'Settle', 'Window 2', '', '', '', '', '', '']);
  check('opera learning: a screen title is cut before the guest', [R.safeTitle('Billing - Testperson, Alpha'), R.safeTitle('Reservation (100001)'), R.safeTitle('Folio History | Room 0101')], ['Billing', 'Reservation', 'Folio History']);
  check('bridge in-house: yesterday\'s list is not merged into; a search screen never makes one', [O.plan({ snap: ihSnap, today: T, board: { rooms: [], day: '' }, arr: [], pur: [], ih: { date: '2026-10-27', rows: [] } }).ih.mode, O.plan({ snap: Object.assign({}, ihSnap, { kind: 'search' }), today: T, board: { rooms: [], day: '' }, arr: [], pur: [], ih: null }).ih.mode], ['create', '']);
  // ── bridge: folios, profiles, privacy, learning ──
  const sn = O.sanitize({ kind: 'billing', rows: [{ room: '0101', name: 'Testperson, Alpha', balance: 85, payment: 'VA 4111111111111111', extra: [['Card Number', '4111'], ['Phone', '000']] }],
    folio: { room: '0101', name: 'Testperson, Alpha', balance: 85, windows: [{ n: 1, balance: 0 }, { n: 9, balance: 1 }], pays: ['Visa', '4111'], postings: [{ code: '9004', desc: 'Visa 4111 1111 1111 1111', amount: -10, pay: 'Visa', ref: 'AUTH 99' }, { code: '1000', desc: 'Room', amount: 95, ref: 'card 4111111111111111' }] },
    tables: [{ title: 'x', heads: ['Room', 'CVV'], rows: [['0101', '123']] }], traces: [{ text: 'call re 4111-1111-1111-1111', room: '0101' }] });
  check('bridge privacy: the app\'s own net — a number as payment dropped, card labels / columns dropped, card numbers masked, a payment keeps its type only',
    [sn.kind, sn.rows[0].payment, J(sn.rows[0].extra), J(sn.folio.windows), J(sn.folio.pays), J(sn.folio.postings), J(sn.tables), sn.traces[0].text],
    ['billing', undefined, [['Phone', '000']], [{ n: 1, balance: 0 }], ['Visa'], [{ code: '9004', desc: 'Visa payment', amount: -10, pay: 'Visa' }, { code: '1000', desc: 'Room', amount: 95, ref: 'card •••• 1111' }], [{ title: 'x', heads: ['Room'], rows: [['0101']] }], 'call re •••• 1111']);
  const bill = { kind: 'billing', date: '', rows: [{ room: '0101', name: 'Testperson, Alpha', balance: 85 }], folio: { room: '0101', name: 'Testperson, Alpha', conf: '100001', balance: 85, windows: [], pays: [], postings: [] } };
  const ihT = { date: T, rows: [{ room: '0101', rk: '101', name: 'Alpha Testperson', conf: '100001', balance: 0 }] };
  const PB = O.plan({ snap: bill, today: T, board, arr: [], pur: [], ih: ihT });
  check('bridge billing: the folio balance goes onto today\'s departure and the in-house list (live), and says so',
    [J(PB.dep.fill), PB.ih.mode, J(PB.ih.upd.map(u => u.set)), O.summaryText(PB), O.worthAlert(PB)],
    [[{ room: '0101', set: { balance: 85 }, folio: true }], 'merge', [{ balance: 85 }], 'room 0101 balance AED 85.00 from its Opera folio, in-house list +0 ~1', false]);
  const P0 = O.plan({ snap: Object.assign({}, bill, { folio: Object.assign({}, bill.folio, { balance: 0, zero: true, settled: true }) }), today: T, board: { day: T, rooms: [mk('0101', 'Alpha Testperson', { balance: 120, status: 'out' })] }, arr: [], pur: [], ih: null });
  check('bridge billing: settled in Opera → 0.00 (the board shows Settled); another guest\'s folio for the room changes nothing',
    [O.summaryText(P0), O.plan({ snap: Object.assign({}, bill, { folio: Object.assign({}, bill.folio, { name: 'Somebody, Else' }) }), today: T, board, arr: [], pur: [], ih: null }).n], ['room 0101 balance settled (0.00) from its Opera folio', 0]);
  const prof = { kind: 'profile', date: '', rows: [{ name: 'Testperson, Alpha', vip: 'V2', memberLevel: 'Gold' }, { name: 'Demo, Delta', vip: 'V1', member: 'Silver' }] };
  const PP = O.plan({ snap: prof, today: T, board, arr: [], pur: [], ih: { date: T, rows: [{ room: '0101', rk: '101', name: 'Alpha Testperson', vip: '', member: '' }, { room: '0104', rk: '104', name: 'Delta Demo', vip: 'typed', member: '' }] } });
  check('bridge profiles: only an EMPTY VIP / membership is filled (a typed one stays); Departures VIP when not set',
    [J(PP.ih.upd.map(u => [u.r.room, u.set])), J(PP.dep.fill)], [[['0101', { vip: 'V2', member: 'Gold' }], ['0104', { member: 'Silver' }]], [{ room: '0101', set: { isVip: true } }, { room: '0104', set: { isVip: true } }]]);
  // learning: a week of made-up work in Opera
  const t0 = new Date(2026, 9, 19, 10, 0).getTime(), lraw = [];
  for (let d = 0; d < 5; d++) {
    let tt = t0 + d * 864e5; const go = (k, x) => { tt += 45e3; lraw.push(Object.assign({ t: tt, k }, x)); };
    go('s', { s: 'inhouse', l: 'Manage In House' }); go('r'); go('s', { s: 'billing', l: 'Billing - Testperson, Alpha' }); go('c', { l: 'Post Charge' }); go('c', { l: 'Settle' }); go('c', { l: 'Check Out' });
    go('c', { l: 'Testperson Alpha' }); go('c', { l: 'AED 120.00' }); go('c', { l: '0101' }); go('c', { l: 'alpha.test@example.com' }); go('s', { s: 'other', l: 'Testperson' });
  }
  const ev = O.learnClean(lraw, new Set(['TESTPERSON', 'ALPHA'])), LM = O.learnModel(ev);
  check('bridge learning: routines, what comes before a check-out, the usual hours, the next step',
    [LM.routines.map(r => r.steps.join(' → ')), LM.routines[0].n, LM.routines[0].hours, LM.before.slice(0, 2).map(b => b.l), LM.billBeforeCO, O.learnNext(LM, ['s:billing', 'c:post charge']), O.learnNext(LM, ['s:arrivals'])],
    [['In House → a line of a list → Billing → Post Charge → Settle → Check Out'], 5, '10:00–12:00', ['In House', 'a line of a list'], true, 'Settle', '']);
  const tk = O.sessionsOf(O.learnClean([{ t: t0, k: 'c', l: 'Billing' }, { t: t0 + 2000, k: 's', s: 'billing' }, { t: t0 + 9000, k: 'c', l: 'Check Out' }, { t: t0 + 20000, k: 's', s: 'arrivals' }], new Set())).map(T2 => T2.map(x => x.k));
  check('bridge learning: the menu click that opens a screen of the same name is one step; a check-out ends a task', tk, [['s:billing', 'c:check out'], ['s:arrivals']]);
  const LS0 = JSON.stringify(O.learnSummary(LM)) + JSON.stringify(ev);
  // ── stuck reports: a screen it can't read → its layout only, never a value ──
  check('stuck: value shapes (letters a/A, digits 9, long numbers capped, 24 characters; a shape stays a shape)',
    [R.shapeOf('Testperson, Alpha'), R.shapeOf('28/10/2026'), R.shapeOf('7000123'), R.shapeOf('alpha.test@example.com'), R.shapeOf('A very long text that goes on and on'), R.shapeOf(R.shapeOf('Quixote, Romeo 7000123')), O.shapeOf('Zoë Ünal 12')],
    ['Aaaaaaaaaa, Aaaaa', '99/99/9999', '999999+', 'aaaaa.aaaa＠aaaaaaa.aaa', 'A aaaa aaaa aaaa aaaa a…', 'Aaaaaaa, Aaaaa 999999+', 'Aaa Aaaa 99']);
  check('stuck: titles, headings and the address keep no IDs or guest names', [R.structText('Billing - Testperson, Alpha'), R.structText('Arrivals (42)'), R.pathShape('/OPERA9/opera/operacloud/res/ab12cd34ef56gh78', '#res=123'), R.pathShape('/opera/frontdesk', '#departures'), R.headText('Name (Last, First)'), R.classShape('oj-table-9 x123 data-row oj-complete a b c d')],
    ['Billing', 'Arrivals', '/OPERA#/opera/operacloud/res/:id', '/opera/frontdesk #departures', 'Name (Last / First)', ['oj-table', 'x', 'data-row', 'oj-complete', 'a']]);
  check('stuck: guest data in a report is found (email, 7+ digits, "Lastname, Firstname"); shapes are not', [R.reportLeaks('mail a.b@example.com'), R.reportLeaks('conf 7000123'), R.reportLeaks('guest Quixote, Romeo'), R.reportLeaks('Aaaaaaa, Aaaaa · 999999+ · 99/99/9999'), O.stuckLeaks('room 0101 · 2026-10-29 10:42')],
    ['an email', 'a long number', 'a name', '', '']);
  // a made-up screen the reader can't map: Unit / Occupant / Leaving On
  const stuckRows = [['0901', 'Quixote, Romeo', '29/10/2026', '7000123', 'romeo.q@example.com'], ['0902', 'Sierra, Tango', '30/10/2026', '7000124', ''], ['0903', 'Umbra, Victor', '31/10/2026', '7000125', ''], ['0904', 'Whiskey, Xray', '01/11/2026', '7000126', '']];
  const srep = R.makeReport({ v: '436', at: new Date(2026, 9, 29, 10, 42).getTime(), kind: 'departures', hint: 'departures', date: '2026-10-29', title: 'OPERA Cloud', path: '/OPERA9/opera/operacloud/', hash: '#units',
    heads: ['Departures', 'Billing - Quixote, Romeo', 'Sierra Tango'], why: [{ c: 'unread-grid', t: 'a grid with 4 rows on a "departures" screen: its headers could not be matched (Unit · Occupant · Leaving On · Ref · Contact)' }],
    grids: [{ sel: 'div[role=grid] in oj-table', cells: 'role=columnheader', head: ['Unit', 'Occupant', 'Leaving On', 'Ref', 'Contact'], aria: ['Unit column', 'Occupant Quixote'], anc: [{ t: 'div', r: 'grid', c: ['oj-table-body'] }, { t: 'div', r: '', c: ['oj-table', 'oj-component'] }], n: 4, rows: stuckRows, stuck: true }],
    pairs: [['Business Date', '29-Oct-2026'], ['Guest', 'Quixote, Romeo'], ['Card Number', '4111 1111 1111 1111']], concl: 'kind departures · 0 guest lines', err: '' });
  const repTxt = R.reportText(srep, { n: 2, app: 'up to date' }), repAll = JSON.stringify(srep) + repTxt;
  check('stuck: the report keeps the layout — headers, how each was mapped, row shapes, DOM hints — and a fake page to test on',
    [srep.grids[0].head.map(h => h.join('→')), srep.grids[0].shapes[0], srep.heads, srep.grids[0].aria, srep.pairs, /^HotelOps Opera reader report — please teach the reader this screen:\n/.test(repTxt), /<div role="columnheader" aria-colindex="2">Occupant<\/div>/.test(repTxt), /seen 2 times/.test(repTxt), /HotelOps answered: up to date/.test(repTxt)],
    [['Unit→?', 'Occupant→?', 'Leaving On→?', 'Ref→post.ref', 'Contact→?'], ['9999', 'Aaaaaaa, Aaaaa', '99/99/9999', '999999+', 'aaaaa.a＠aaaaaaa.aaa'], ['Departures', 'Billing'], ['Unit column'], [['Business Date', '99-Aaa-9999'], ['Guest', 'Aaaaaaa, Aaaaa'], ['Card Number', '•••• 9999']], true, true, true, true]);
  check('stuck privacy: no row value survives (names, rooms, conf. numbers, emails, dates), not even in headings or aria-labels',
    ['Quixote', 'Romeo', 'Sierra', 'Tango', 'Umbra', 'Victor', 'Whiskey', 'Xray', '7000123', '7000126', 'romeo.q', 'example.com', '0901', '29/10/2026', '4111'].filter(v => repAll.includes(v)), []);
  check('stuck: the reader and the app write the same text (one format to paste)', [O.stuckText(O.stuckClean(J(srep)), { n: 2, app: 'up to date' }) === repTxt, O.reportText === undefined ? 'missing' : 'ok'], [true, 'ok']);
  const evil = O.stuckClean({ why: [{ c: 'manual!', t: 'x' }], grids: [{ head: [['Room', 'room']], shapes: [['Testperson, Alpha', '7000123']], anc: [{ t: 'DIV<script>', c: ['a1b2'] }] }], pairs: [['Guest', 'Testperson, Alpha']], title: 'x'.repeat(300) });
  check('stuck: what the app keeps is re-shaped and cut (a value sent as a "shape" is shaped again)', [evil.why[0].c, evil.grids[0].shapes[0], evil.grids[0].anc[0].t, evil.pairs[0][1], evil.title.length, O.stuckClean({ why: [] }), O.stuckClean(null)],
    ['manual', ['Aaaaaaaaaa, Aaaaa', '999999+'], 'div', 'Aaaaaaaaaa, Aaaaa', 80, null, null]);
  check('stuck: a report whose text still holds guest data is refused', [R.makeReport({ v: '1', at: 1.7e12, why: [{ c: 'manual', t: 'see Quixote, Romeo' }], grids: [], pairs: [] }), !!R.makeReport({ v: '1', at: 1.7e12, why: [{ c: 'manual', t: 'fine' }], grids: [], pairs: [] })], [null, true]);
  // ── linking: what the Opera window says when it can't link ──
  const LD = o => R.linkDiag(Object.assign({ ext: true, linked: false, since: 20000, relay: null, relayEver: false, anyIn: -1, extErr: '' }, o)).code;
  check('link: the checklist tells the causes apart', [LD({ linked: true }), LD({ ext: false }), LD({ since: 3000 }), LD({ relay: { apps: 0, age: 1000 } }), LD({ relay: { apps: 1, age: 1000 } }), LD({ relay: { apps: 1, age: 90000 }, relayEver: true }), LD({}), LD({ extErr: 'Extension context invalidated' })],
    ['linked', 'console', 'linking', 'no-app', 'app-silent', 'no-relay', 'no-answer', 'ext-error']);
  // ── 🟢 Open Opera: the address and the card ──
  const DEMO = 'https://demo123.oraclehospitality.eu-frankfurt-1.ocs.oraclecloud.com/DEMOEN/operacloud/faces/opera-cloud-index/OperaCloud';
  check('open opera: a pasted address is kept as it is (the entry page), only its query and hash go; anything else is refused',
    [O.operaHome(DEMO), O.operaHome(DEMO + '?token=abc&x=1#frag'), O.operaHome('demo123.oraclehospitality.eu-frankfurt-1.ocs.oraclecloud.com/DEMOEN/operacloud/faces/opera-cloud-index/OperaCloud'), O.operaHome('https://mtce1.oracleindustry.com/OPERA9/'),
      O.operaHome('http://x.oraclecloud.com/OPERA9/'), O.operaHome('https://evil.com/x.oraclecloud.com/'), O.operaHome('https://oraclecloud.com.evil.io/'), O.operaHome('https://user:pw@x.oraclecloud.com/'), O.operaHome('https://x.oraclecloud.com:8443/'), O.operaHome('javascript:alert(1)'), O.operaHome('')],
    [DEMO, DEMO, DEMO, 'https://mtce1.oracleindustry.com/OPERA9/', '', '', '', '', '', '', '']);
  check('open opera: the address learned from the reader is its entry page, even from a deeper screen',
    [O.operaEntry('https://demo123.oraclehospitality.eu-frankfurt-1.ocs.oraclecloud.com/DEMOEN/operacloud/faces/opera-cloud-index/OperaCloud/reservations/lookup?id=12345'), O.operaEntry('demo123.oraclehospitality.eu-frankfurt-1.ocs.oraclecloud.com/DEMOEN/operacloud/faces/fd/arrivals'),
      O.operaEntry('https://demo123.oraclehospitality.eu-frankfurt-1.ocs.oraclecloud.com/DEMOEN/operacloud/'), O.operaEntry('https://x.oracleindustry.com/other/app'), O.operaEntry('https://example.com/DEMOEN/operacloud/')],
    [DEMO, DEMO, DEMO, 'https://x.oracleindustry.com/other/app', '']);
  // the helper's Opera content script covers that host (and every frame of it)
  const OPM = ['https://*.oraclecloud.com/*', 'https://*.oracleindustry.com/*', 'https://*.oraclehospitality.com/*'];
  const matchOf = (pat, url) => { const m = pat.match(/^https:\/\/\*\.([^/]+)\/\*$/); const u = new URL(url); return u.protocol === 'https:' && (u.hostname === m[1] || u.hostname.endsWith('.' + m[1])); };
  check('open opera: the helper\'s Opera match covers the hotel\'s host, all frames', [OPM.some(m => matchOf(m, DEMO)), /OP_MATCHES = \['https:\/\/\*\.oraclecloud\.com\/\*'/.test(fs.readFileSync(path.join(ROOT, 'wa-helper.js'), 'utf8')), /js: \['opera\.js'\], run_at: 'document_idle', all_frames: true/.test(fs.readFileSync(path.join(ROOT, 'wa-helper.js'), 'utf8'))], [true, true, true]);
  // ── the Brain asks, and the answers teach the reader ──
  const stuckE = { h: 'x1', rep: O.stuckClean(J(srep)) }, stuckS = { h: 'x2', rep: { why: [{ c: 'unknown-screen', t: '' }], heads: ['Front Desk Workspace'], title: 'OPERA Cloud', grids: [] } };
  const TH = (o) => O.operaThoughts(Object.assign({ stuck: [stuckE, stuckS], asked: {}, taught: { h: {}, s: {} }, dayOff: false, cfg: { auto: true, review: false }, board: { rooms: [], day: '' }, last: {}, folios: [], now: new Date(2026, 9, 29, 10, 0).getTime(), today: T, coMin: 720 }, o));
  const q1 = TH({});
  check('brain asks: one simple question per unknown column (two at a time), with choices from the shape of its values',
    [q1.map(t => t.id), q1[0].text, q1[1].opts.map(x => x[0]), q1.every(t => t.opts.some(x => x[1] === 'ask:x'))],
    [['opq:col:UNIT', 'opq:col:OCCUPANT'], 'In Opera\'s "Departures" list there\'s a column "Unit" — is it:', ['Guest name', 'Company', 'Something else', 'Ignore'], true]);
  const q2 = TH({ asked: { 'col:UNIT': 1, 'col:OCCUPANT': 1 }, taught: { h: { 'LEAVING ON': 'departure' }, s: {} } });
  check('brain asks: an answered (or taught) column is never asked again; then the next one and the unknown screen',
    [q2.map(t => t.id), q2.find(t => t.id === 'opq:col:CONTACT') ? 1 : 0, (q2.find(t => /^opq:scr/.test(t.id)) || { opts: [] }).opts.map(x => x[0])],
    [['opq:col:CONTACT', 'opq:scr:front desk workspace'], 1, ['Arrivals', 'Departures', 'In House', 'Billing', 'Room status', 'Profile', 'Other']]);
  check('brain asks nothing on a day off', TH({ dayOff: true }).length, 0);
  check('brain: the choices fit the column', [O.teachChoices('99/99/9999').slice(0, 2).map(x => x[1]), O.teachChoices('9999').slice(0, 2).map(x => x[1]), O.teachChoices('999999+')[0][1], O.teachChoices('Aaaaaaa, Aaaaa')[0][1]], [['departure', 'arrival'], ['room', 'conf'], 'conf', 'name']);
  const dep2 = { departures: { at: 1, rows: [{ room: '0412', name: 'Testperson, Alpha', status: 'checked_out' }] } };
  const sugg = o => TH(Object.assign({ stuck: [], board: { day: T, rooms: [{ roomStr: '0412', name: 'Alpha Testperson', status: 'due' }] }, last: dep2 }, o)).map(t => t.type);
  check('brain suggests: "checked out in Opera but still due here" only when it did not adjust by itself',
    [sugg({}), sugg({ cfg: { auto: false } }), sugg({ cfg: { auto: true, review: true } }), TH({ stuck: [], board: { day: T, rooms: [{ roomStr: '0412', name: 'Alpha Testperson', status: 'due' }] }, last: dep2, cfg: { auto: false } })[0].text],
    [[], ['opCo'], ['opCo'], 'Room 0412 is checked out in Opera but still "due" here — mark it out?']);
  const at = h => new Date(2026, 9, 29, h, 50).getTime();
  check('brain suggests: open balances 30 min before check-out; Opera not read for 2 h; an old reader',
    [TH({ stuck: [], board: { day: T, rooms: [{ roomStr: '0412', name: 'X', status: 'due' }] }, folios: [{ room: '0412', balance: 40 }], now: at(11) }).map(t => t.type), TH({ stuck: [], board: { day: T, rooms: [{ roomStr: '0412', name: 'X', status: 'due' }] }, folios: [{ room: '0412', balance: 40 }], now: at(9) }).length,
      TH({ stuck: [], last: { arrivals: { at: at(8) } }, now: at(11) }).map(t => t.type), TH({ stuck: [], readerV: '434', appV: 'v436', linkAt: at(11) - 1000, now: at(11) }).map(t => t.type)],
    [['opBal'], 0, ['opStale'], ['opOld']]);
  R.setTaught({ h: { 'Leaving On': 'departure', Unit: 'room', Occupant: 'name', Contact: '-' }, s: { 'Front Desk Workspace': 'inhouse' } });
  const tm2 = R.mapHeaders(['Unit', 'Occupant', 'Leaving On', 'Ref', 'Contact']);
  check('taught: what the Brain learned changes how the reader reads the headers and the screen', [J(tm2.map), R.usable(tm2), R.pageKind(['OPERA Cloud', 'Front Desk Workspace']), R.fieldOf('Email')], [{ room: 0, name: 1, departure: 2 }, true, 'inhouse', 'email']);
  R.setTaught(null);
  check('taught: forgotten again → read as before', [R.fieldOf('Leaving On'), R.pageKind(['Front Desk Workspace'])], ['', '']);
  const OS = o => { const x = O.openState(o); return [x.state, x.btn]; };
  check('open opera: the card — no helper / user scripts off / on, linked or not',
    [OS({ helper: false, us: false, linked: false }), OS({ helper: true, us: false, linked: false }), OS({ helper: true, us: true, linked: true }), OS({ helper: true, us: true, linked: false }), O.openState({ helper: true, us: true, linked: false }).b],
    [['nohelper', '🟢 Open Opera'], ['noscripts', '🟢 Open Opera'], ['on', '✓ Linked · open Opera'], ['on', '🟢 Open Opera'], '⚡ Reader on · reads by itself · updates by itself']);
  check('bridge departures: how many of Opera\'s departures matched the board (for the "matches nothing" report)', [P.dep.rows, P.dep.matched], [5, 4]);
  check('bridge learning: what it keeps carries no guest data (no name, room, amount or email)', [/testperson|alpha|0101|120|example\.com|4111/i.test(LS0), ev.every(e => ['s', 'c', 'r'].includes(e.k) && Object.keys(e).sort().join() === 'k,l,t,v')], [false, true]);
  // ── Opera Cloud is Oracle ADF: screens known by their headings, menus / layout never "stuck", forms read by their labels ──
  check('adf: a screen is known by the headings it shows together (they win over single words)',
    [R.pageKind(['OPERA Cloud', 'Membership', 'Stay Details', 'Notes', 'Packages and Items', 'Payment Instructions']), R.pageKind(['OPERA Cloud', 'Membership', 'Stay Details', 'Notes', 'Packages and Items', 'Payment Instructions', 'Select Guests']),
      R.pageKind(['OPERA Cloud', 'Identification', 'Notes', 'Membership', 'Preferences']), R.pageKind(['OPERA Cloud', 'Rate Availability Analysis']), R.pageKind(['OPERA Cloud', 'Search', 'Minimum Stay Availability']),
      R.pageKind(['OPERA Cloud', 'Verify Payment', 'Select Guests', 'Report Destination']), R.pageKind(['OPERA Cloud', 'Queue', 'Search', 'Search']), R.pageKind(['OPERA Cloud', 'In House', 'Search']), R.pageKind(['OPERA Cloud', 'Arrivals', 'Search']),
      R.pageKind(['OPERA Cloud', 'Departures (15)']), R.pageKind(['OPERA Cloud', 'Notes']), R.pageKind(['OPERA Cloud', 'Notes', 'Alerts']), R.pageKind(['OPERA Cloud', 'Traces']), R.pageKind(['OPERA Cloud', 'Search'], [{ room: '0412' }])],
    ['details', 'details', 'profile', 'rates', 'rates', 'checkin', 'queue', 'inhouse', 'arrivals', 'departures', '', '', 'traces', 'list']);
  check('adf: a form label is a whole field name ("Loading Complete", "Assign Room", "Notes" are not); card / passport labels never',
    ['Arrival', 'Departure:', 'Room Type', 'Rate Code', 'Confirmation Number', 'Nationality', 'VIP', 'Membership', 'Payment Method', 'ETA', 'Travel Agent', 'Loading Complete', 'Assign Room', 'Notes', 'Preferences', 'Credit Card Number', 'Passport No'].map(R.formLabel),
    ['arrival', 'departure', 'roomType', 'rateCode', 'conf', 'nat', 'vip', 'member', 'payment', 'eta', 'agent', '', '', '', '', '', '']);
  check('adf: only a list holding data can be "stuck": 2+ lines, 3+ columns, digits in 30% of them (a menu bar is not)',
    [R.dataLook([['', 'Front Desk'], ['', 'Bookings']]), R.dataLook([['Front Desk', 'Bookings', 'Client Relations', 'Inventory', 'Financials', 'Exports', 'Miscellaneous']]), R.dataLook([['0412', 'Testperson, Alpha', '28-Oct-2026'], ['0413', 'Testperson, Bravo', '29-Oct-2026']]), R.dataLook([['a', 'b', 'c'], ['d', 'e', 'f'], ['g', 'h', '1']])],
    [false, false, true, true]);
  check('adf: a list\'s own count near it (ADF has no "pag" / "total" class names)', ['1-15 of 15', 'Results: 15', 'Total 15', '15 records', 'Window 1 of 3', '28-Oct-2026', 'Room 0412'].map(R.totalLine), [15, 15, 15, 15, 0, 0, 0]);
  const frep = R.makeReport({ v: '438', at: 1.79e12, kind: 'details', hint: 'details', date: '', title: 'OPERA Cloud', path: '/ACCOREN/operacloud/faces/opera-cloud-index/OperaCloud', hash: '', heads: ['Stay Details'], why: [{ c: 'unread-form', t: 'a reservation screen, but its fields could not be read' }],
    grids: [{ sel: 'div[role=grid]', cells: 'th', head: ['Room', 'Name'], aria: [], anc: [], n: 2, rows: [['0412', 'Testperson, Alpha'], ['0413', 'Testperson, Bravo']], stuck: false, hc: ['th[role=columnheader][aria-colindex=1]'], rc: 'tr[role=row] {_afrrk,class} in table[role=presentation] · cells: td[role=gridcell] {headers}' }],
    pairs: [], form: [{ l: 'Arrival', f: 'arrival', how: 'parent-next', path: 'span < td < tr < table[role=presentation] · value span < td', v: '28-Oct-2026' }, { l: 'Testperson', f: '', how: 'next-sibling', path: 'label', v: 'Alpha Testperson' }] });
  const frTxt = R.reportText(frep);
  check('adf report: reader revision, header cells and the first line\'s attribute names, the form\'s label → value layout (a label that is a guest\'s word dropped)',
    [frep.rr, /reader v438 r2/.test(frTxt), /header cells: th\[role=columnheader\]\[aria-colindex=1\]/.test(frTxt), /first data row: tr\[role=row\] \{_afrrk,class\}/.test(frTxt), /"Arrival" → arrival = 99-Aaa-9999 · parent-next · span < td < tr < table\[role=presentation\]/.test(frTxt), /Testperson|Alpha|0412/.test(frTxt.replace(/^.*headers → fields.*$/m, ''))],
    [2, true, true, true, true, false]);
  check('adf report: the app keeps the new parts and writes the same text', O.stuckText(O.stuckClean(J(frep))) === frTxt, true);
  // ── the app side: Queue feeds Arrivals only, a check-in dialog changes nothing ──
  const qSnap = { kind: 'queue', date: T, rows: [{ room: '0412', name: 'Testperson, Alpha', conf: '100001', arrival: T, departure: '2026-10-30', status: 'checked_out' }, { room: '0413', name: 'Testperson, Bravo', conf: '100002', arrival: T, departure: T, status: 'due_in' }] };
  const PQ = O.plan({ snap: qSnap, today: T, board: { day: T, rooms: [mk('0413', 'Bravo Testperson')] }, arr: [], pur: [], ih: null });
  const PC = O.plan({ snap: Object.assign({}, arrSnap, { kind: 'checkin' }), today: T, board, arr, pur, ih: null });
  check('bridge queue / check-in: the Queue adds arrivals and never checks a room out or touches departures; a check-in dialog changes nothing',
    [PQ.arr.add.map(g => g.room), PQ.dep.out.length + PQ.dep.add.length + PQ.dep.ext.length + PQ.dep.fill.length, PQ.ih.mode, PC.n, O.sanitize({ kind: 'queue', rows: [] }).kind, O.sanitize({ kind: 'checkin', rows: [] }).kind],
    [['0413'], 0, '', 0, 'queue', 'checkin']);
  // ── Opera's Departures vs the board ──
  const b16 = { day: T, rooms: Array.from({ length: 16 }, (_, i) => mk('04' + String(i + 1).padStart(2, '0'), 'Guest' + 'ABCDEFGHIJKLMNOP'[i] + ' Testperson', { conf: String(100001 + i) })).concat([mk('9001', 'Pm Room')]) };
  const op15 = { date: T, total: 15, rows: b16.rooms.filter(b => b.roomStr !== '0412' && b.roomStr !== '9001').map(b => ({ room: b.roomStr.replace(/^0/, ''), name: 'Testperson, ' + b.name.split(' ')[0], conf: b.conf, departure: T, status: 'due_out' })) };
  const ihL = { inhouse: { date: T, rows: [{ room: '0412', name: 'Testperson, GuestL', conf: '100012', arrival: '2026-10-26', departure: '2026-10-31', status: 'in_house' }] } };
  const RC = O.depRecon({ dep: op15, board: b16, today: T, reads: ihL });
  const RC0 = O.depRecon({ dep: op15, board: b16, today: T, reads: {} });
  check('departures vs Opera: 16 on the board, 15 in Opera (complete, room keys without leading zeros, PM rooms left out) → 1 difference: 0412 extended (from the in-house read)',
    [RC.state, RC.opN, RC.boardN, O.reconHead(RC), RC.diffs.map(d => [d.type, d.room, d.why, d.nights, !!d.sure, d.acts.join(',')]), RC.diffs[0].reason],
    ['ok', 15, 16, '📡 Opera: 15 departures · HotelOps: 16 — 1 difference', [['missing', '0412', 'extended', 3, true, 'ext,remove,keep']], 'in house in Opera until 31 Oct → extended']);
  const AU = O.reconAuto(RC), AP = O.reconPlan(AU.map(d => ({ d, act: 'ext' })), T);
  check('departures vs Opera: auto marks it extended only when it is clear; never removes; without the in-house read it only asks',
    [AU.map(d => d.room), J(AP.dep.ext.map(e => [e.room, e.nights, e.to])), AP.dep.rm.length, O.reconAuto(RC0).length, RC0.diffs[0].acts.join(','), /extended, moved, checked out earlier or cancelled/.test(RC0.diffs[0].reason),
      O.reconAuto({ state: 'ok', diffs: [{ type: 'missing', why: 'moved', sure: false }, { type: 'missing', why: '', sure: false }] }).length, O.summaryText(O.reconPlan([{ d: RC0.diffs[0], act: 'remove' }], T))],
    [['0412'], [['0412', 3, '2026-10-31']], 0, 0, 'out,ext,remove,keep', false, 0, '1 room removed from today\'s departures']);
  // Opera's list holds only the guests still to leave: rooms already out here are not differences; a common name is not a room move
  const bOut = { day: T, rooms: [mk('0401', 'GuestA Testperson', { conf: '100001' }), Object.assign(mk('0402', 'Mohamed Sampleone', { conf: '100002' }), { status: 'out' }), mk('0403', 'Mohamed Sampletwo', { conf: '' }), Object.assign(mk('0405', 'GuestE Testperson', { conf: '100005' }), { status: 'out' })] };
  const opDue = { date: T, total: 2, rows: [{ room: '401', name: 'Testperson, GuestA', conf: '100001', departure: T, status: 'due_out' }, { room: '405', name: 'Testperson, GuestE', conf: '100005', departure: T, status: 'due_out' }] };
  const RD = O.depRecon({ dep: opDue, board: bOut, today: T, reads: { search: { date: T, rows: [{ room: '0419', name: 'Mohamed, Otherguest', conf: '777777', departure: '2026-10-13', status: 'in_house' }] } } });
  check('departures vs Opera: only guests still to leave in Opera → rooms out here are left out; a due room missing there → "probably left" + Mark out; "Mohamed" alone is no room move; out here but due in Opera → check out in Opera',
    [RD.boardN, RD.outN, O.reconHead(RD), RD.diffs.map(d => [d.type, d.room, d.why, d.acts[0]])],
    [2, 2, '📡 Opera: 2 departures still to leave · HotelOps: 2 still to leave — 2 differences', [['missing', '0403', 'gone', 'out'], ['opdue', '0405', 'opdue', 'keep']]]);
  const RI = O.depRecon({ dep: Object.assign({}, op15, { rows: op15.rows.slice(0, 12) }), board: b16, today: T, reads: {} });
  check('departures vs Opera: an incomplete read says how far it got instead of listing differences', [RI.state, RI.diffs.length, O.reconHead(RI)], ['incomplete', 0, '📡 Opera read 12 of 15 — scroll the Departures list in Opera to the end']);
  const op17 = Object.assign({}, op15, { total: 17, rows: op15.rows.concat([{ room: '0412', name: 'Testperson, GuestL', conf: '100012', departure: T, status: 'due_out' }, { room: '0417', name: 'Newcomer, Quinn', conf: '100017', departure: T, status: 'checked_out' }]) });
  const RA = O.depRecon({ dep: op17, board: b16, today: T, reads: {} }), PA = O.reconPlan(O.reconAuto(RA).map(d => ({ d, act: 'add' })), T);
  check('departures vs Opera: a room only in Opera → "Add" (done by itself), already checked out there → added as out; a kept room is not listed again',
    [RA.diffs.map(d => d.type + ' ' + d.room), PA.dep.add.map(a => a.row.room + (a.out ? ' out' : '')), O.depRecon({ dep: op17, board: b16, today: T, reads: {}, keep: { 417: 1 } }).diffs.length],
    [['extra 0417'], ['0417 out'], 0]);
  const RG = O.depRecon({ dep: { date: T, total: 0, rows: [{ room: '0401', name: 'Someone, Else', departure: T, status: 'due_out' }, { room: '0402', name: 'Testperson, GuestB', departure: T, status: 'checked_out' }] }, board: { day: T, rooms: [mk('0401', 'GuestA Testperson'), mk('0402', 'GuestB Testperson')] }, today: T, reads: {} });
  check('departures vs Opera: another guest in the room → "room move?" with Fix name; left in Opera but due here → Mark out', RG.diffs.map(d => [d.type, d.room, d.acts[0]]), [['guest', '0401', 'fixname'], ['status', '0402', 'out']]);
}

// ── Opera everywhere (brief/home/search): morning-brief.js, handover.js, home.js, global-search.js read hoOpera (made-up data) ──
console.log('\nOpera everywhere (brief/home/search)');
{
  const T = '2026-10-11', AT = new Date(2026, 9, 11, 9, 5).getTime();
  const rows = [
    { room: '0512', name: 'Testperson, Alpha', conf: '900001', status: 'due_out', departure: T, vip: 'V1' },
    { room: '0610', name: 'Sample, Bravo', conf: '900002', status: 'checked_out', departure: T },
    { room: '0701', name: 'Demo, Charlie', conf: '900003', status: 'in_house', departure: '2026-10-13' },
    { room: '0303', name: 'Known, Kilo', conf: '900004', status: 'due_in', arrival: T, vip: 'GLD' },
    { room: '0201', name: 'Fake, Echo', conf: '900005', status: 'in_house', departure: '2026-10-14' },
  ];
  const fol = { '512': { room: '0512', balance: 1234.5, status: 'due_out' }, '701': { room: '0701', balance: 80, status: 'in_house' }, '610': { room: '0610', balance: 0, zero: true, status: 'checked_out' } };
  const rs = { '701': 'dirty', '201': 'ooo', '512': 'clean' };
  const rk = r => String(r).replace(/^0+/, '');
  const fakeOpera = read => ({
    fresh: () => read, linked: () => true, last: () => (read ? { kind: 'departures', at: AT } : null), rows: () => (read ? rows.slice() : []),
    reads: () => (read ? { departures: { kind: 'departures', at: AT, rows: rows.slice(0, 2) }, inhouse: { kind: 'inhouse', at: AT - 1000, rows: rows.slice(1) } } : {}),
    folio: r => fol[rk(r)] || null, folios: () => Object.values(fol), openBalances: () => Object.values(fol).filter(f => f.balance > 0).sort((a, b) => b.balance - a.balance),
    roomStatus: r => (rs[rk(r)] ? { rs: rs[rk(r)] } : null), traces: () => [{ room: '0512', dept: 'FO', text: 'Return the key card', date: T }, { room: '0701', dept: 'HK', text: 'Extra towels', date: T, done: true }, { dept: 'FO', text: 'Call the bank', date: T }],
    openPage: () => { opened.push('page'); },
  });
  const opened = [];
  const mkSb = read => {
    const el = () => ({ appendChild() {}, insertBefore() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }, style: {} });
    const sb = { console: { log() {}, warn() {}, error() {}, info() {} }, setTimeout: () => 0, setInterval: () => 0, clearInterval() {}, escapeHtml: x => String(x),
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, hoLocalISO: () => T, navigator: {},
      document: { readyState: 'complete', head: el(), body: el(), addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el } };
    if (read !== undefined) sb.hoOpera = fakeOpera(read);
    sb.window = sb; sb.globalThis = sb;
    vm.createContext(sb);
    ['morning-brief.js', 'handover.js', 'home.js', 'global-search.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f }));
    return sb;
  };
  const sb = mkSb(true);
  const op = sb.mbSections().find(x => x.id === 'opera');
  check('brief: a 📡 From Opera block — due out owing (room + AED), VIPs (room + code), traces by department, dirty / OOO, last read',
    op && op.rows.map(r => (r.k ? r.k + ': ' : '') + r.t),
    ['💳 Due out, owing: 0512 AED 1,234.50', '⭐ VIPs: 0512 (V1), 0303 (GLD) arriving', '📌 Traces: FO 2 · HK 1 (2 open)', '🧹 Dirty: 1 room: 0701', '⛔ Out of order: 1 room: 0201', 'Opera last read 09:05']);
  check('brief: the copied text has the block, no guest names from Opera', [/📡 \*From Opera\*/.test(sb.mbText()), /Testperson|Known/.test(sb.mbText())], [true, false]);
  check('brief: no block when Opera was not read today, or without the reader', [!!mkSb(false).mbSections().find(x => x.id === 'opera'), !!mkSb(undefined).mbSections().find(x => x.id === 'opera')], [false, false]);
  const ho = sb._hoTodo().find(g => g.icon === '📡');
  check('handover: a short Opera line — open balance still due out, traces not done, out of order',
    ho && ho.items, ['Open balance, still due out: 0512 AED 1,234.50', 'Traces not done: 2 (0512 FO, FO)', 'Out of order: 0201']);
  check('handover: nothing from Opera when it was not read / no reader', [!!mkSb(false)._hoTodo().find(g => g.icon === '📡'), !!mkSb(undefined)._hoTodo().find(g => g.icon === '📡')], [false, false]);
  const tile = sb.homeTiles().find(t => t.panel === 'opera');
  check('home: the 📡 Opera tile — open bills (count + AED), checked out today, linked, last read; a tap opens the Opera page',
    tile && [tile.big, tile.sub, tile.tone, tile.go], [2, 'open bills · AED 1,314.50 · 1 checked out · 🟢 linked · read 09:05', 'warn', 'hoOpera.openPage()']);
  check('home: not read today → "—"; no reader → no tile', [mkSb(false).homeTiles().find(t => t.panel === 'opera').sub, !!mkSb(undefined).homeTiles().find(t => t.panel === 'opera')], ['🟢 linked · not read today', false]);
  const hits = q => sb.gsBuildIndex(q).filter(r => r.panel === 'opera').map(r => [r.label, r.room, r.name, r.extra]);
  check('search: Opera rows read today by room, name or conf. — "📡 Opera · <screen>", status and the folio balance',
    [hits('512'), hits('kilo'), hits('900003')],
    [[['📡 Opera · Departures', '0512', 'Testperson, Alpha', 'due out · conf. 900001 · AED 1,234.50 open']], [['📡 Opera · In House', '0303', 'Known, Kilo', 'arriving · conf. 900004']], [['📡 Opera · In House', '0701', 'Demo, Charlie', 'in house · conf. 900003 · AED 80.00 open']]]);
  const r610 = sb.gsBuildIndex('610').find(r => r.panel === 'opera');
  check('search: a settled folio reads "settled"; the same guest on two screens shows once (the newest)', [r610.extra, r610.label, sb.gsBuildIndex('sample').filter(r => r.panel === 'opera').length], ['checked out · conf. 900002 · settled', '📡 Opera · Departures', 1]);
  const card = []; sb.hoRoom = { open: r => card.push(r), known: () => true }; r610.act(); delete sb.hoRoom;
  sb.gsBuildIndex('610').find(r => r.panel === 'opera').act();
  check('search: a tap opens the room card when the app has one, else the Opera page', [card, opened], [['0610'], ['page']]);
  check('search: nothing from Opera when it was not read today / no reader', [mkSb(false).gsBuildIndex('512').filter(r => r.panel === 'opera').length, mkSb(undefined).gsBuildIndex('512').filter(r => r.panel === 'opera').length], [0, 0]);
}

// ── Opera everywhere: Guest Memory fills only empty fields, the night checklist suggests ticks,
//    wake-up calls and the Handover Book suggest from Opera traces (made-up guests) ──
console.log('\nOpera everywhere (memory/checklist/wakeups/handover)');
{
  const J = x => JSON.parse(JSON.stringify(x));
  const store = {}, LSx = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  const docx = { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; }, activeElement: null };
  // ── Guest Memory ──
  {
    const timers = [], saved = [], acts = [];
    const sb = { console: { log() {}, warn() {}, error() {} }, localStorage: LSx, document: docx, setTimeout: f => { timers.push(f); return timers.length; }, clearTimeout() {}, setInterval() { return 0; },
      showToast() {}, logActivity: (a, d) => acts.push([a, d]), currentProfile: { role: 'manager' }, hoOperaPure: { natName: v => ({ GB: 'United Kingdom', AE: 'UAE' }[v] || v) },
      firebase: { database: () => ({ ref: p => ({ update: async patch => { saved.push([p, J(patch)]); }, once: async () => ({ val: () => null }), on() {}, set: async () => {} }) }) } };
    sb.window = sb; sb.globalThis = sb; sb.window.addEventListener = () => {};
    vm.createContext(sb);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'guest-memory.js'), 'utf8') + '\nfunction hoLocalISO(d) { d = d || new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }', sb, { filename: 'guest-memory.js' });
    const run = s => vm.runInContext(s, sb);
    run(`_gmStore = { 'TEST DOE': { nat: '', email: 'test.doe@example.com', purpose: 'Business', hits: 0, lastSeen: '2026-10-01' }, 'ALPHA SAMPLE': { nat: 'India', vip: '', purpose: 'Leisure' }, 'BETA EXAMPLE': { nat: '', member: 'Silver' } }; _gmServer = JSON.parse(JSON.stringify(_gmStore)); _gmReady = true;`);
    const rows = [{ name: 'Doe, Test Mr.', vip: 'VIP2', memberLevel: 'Gold', nat: 'GB' }, { name: 'Sample, Alpha', nat: 'AE', vip: '1' }, { name: 'Example, Beta', memberLevel: 'Platinum' }, { name: 'Unknown, Guest', vip: '1', nat: 'GB' }];
    check('memory: the pure gap finder fills only empty fields', [J(sb.gmOperaGaps({ nat: '', vip: '' }, rows[0])), J(sb.gmOperaGaps({ nat: 'India' }, { nat: 'AE' })), J(sb.gmOperaGaps({ nat: 'X', vip: 'V', member: 'M' }, rows[0]))],
      [{ nat: 'United Kingdom', vip: 'VIP2', member: 'Gold' }, null, null]);
    sb.currentProfile = { role: 'frontdesk' };
    check('memory: other roles save nothing (and the store stays as it was)', [run('gmOperaFill(' + JSON.stringify(rows) + ')'), run('JSON.stringify(_gmStore["TEST DOE"])')], [0, JSON.stringify({ nat: '', email: 'test.doe@example.com', purpose: 'Business', hits: 0, lastSeen: '2026-10-01' })]);
    sb.currentProfile = { role: 'manager' };
    const n = run('gmOperaFill(' + JSON.stringify(rows) + ')');
    check('memory: a manager — known guests get ONLY their empty fields; an unknown guest is not added; nothing overwritten',
      [n, J(run('_gmStore["TEST DOE"]')), J(run('_gmStore["ALPHA SAMPLE"]')), J(run('_gmStore["BETA EXAMPLE"]')), run('Object.keys(_gmStore).length')],
      [2, { nat: 'United Kingdom', email: 'test.doe@example.com', purpose: 'Business', hits: 0, lastSeen: '2026-10-01', vip: 'VIP2', member: 'Gold' }, { nat: 'India', vip: '1', purpose: 'Leisure' }, { nat: '', member: 'Silver' }, 3]);
    check('memory: reading the same again changes nothing', run('gmOperaFill(' + JSON.stringify(rows) + ')'), 0);
    timers.forEach(f => { try { f(); } catch (_) {} });
    check('memory: saved through its own save path (only the changed guests) · the lock stays locked', [saved.length ? Object.keys(saved[saved.length - 1][1]).sort() : [], saved.length ? saved[0][0] : '', run('_gmUnlocked')], [['ALPHA SAMPLE', 'TEST DOE'], 'guestMemoryShared', false]);
    check('memory: the count of "filled from Opera" is kept and logged', [run('gmOperaCount()'), acts.filter(a => a[0] === 'guestmem_opera').length, /2 guests filled from Opera/.test((acts.find(a => a[0] === 'guestmem_opera') || [])[1])], [2, 1, true]);
    // the tick: only reads from today, only once per read
    const now = run('Date.now()');
    sb.hoOpera = { last: k => (k === 'profile' ? { at: now, rows: [{ name: 'Example, Beta', nat: 'AE', vip: 'VIP1' }] } : k === 'details' ? { at: now - 3 * 864e5, rows: [{ name: 'Doe, Test', memberLevel: 'X' }] } : null),
      timeline: () => [{ at: now, kind: 'read', screen: 'profile' }, { at: now - 3 * 864e5, kind: 'read', screen: 'details' }] };
    run('gmOperaTick()');
    check('memory: the tick fills from today\'s Opera read, not an older one', [J(run('_gmStore["BETA EXAMPLE"]')), run('_gmStore["TEST DOE"].member')], [{ nat: 'UAE', member: 'Silver', vip: 'VIP1' }, 'Gold']);
    run('_gmStore["BETA EXAMPLE"].vip = ""'); run('gmOperaTick()');
    check('memory: the same read is not used twice (cheap)', run('_gmStore["BETA EXAMPLE"].vip'), '');
    delete sb.hoOpera;
    check('memory: no Opera reader → nothing happens', (run('gmOperaTick()'), true), true);
  }
  // ── Night checklist ──
  {
    const sb = { console: { log() {}, warn() {}, error() {} }, localStorage: LSx, document: docx, setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, showToast() {}, logActivity() {}, saveChecklist() {},
      escapeHtml: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) };
    sb.window = sb; sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext('var CL_STEPS = []; var clState = { done: new Set(), skipped: new Set() }; var clEditMode = false;', sb);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'checklist.js'), 'utf8'), sb, { filename: 'checklist.js' });
    const run = s => vm.runInContext(s, sb);
    const night = new Date(2026, 9, 10, 12, 0).getTime(), at = new Date(2026, 9, 11, 3, 58).getTime();
    const S = o => J(run(`clOperaSugg(Object.assign({ steps: CL_STEPS, done: new Set(), skipped: new Set(), since: ${night} }, ${JSON.stringify(o)}))`));
    check('checklist: Opera\'s night audit done → only "Run the night audit" is suggested',
      [S({ audit: { state: 'done', at } }), S({ audit: { state: 'running', at } }), S({ audit: { state: 'failed', at } }), S({ audit: { state: 'done', at: night - 60e3 } }), S({ audit: { state: 'done', at }, no: [115] })],
      [{ 115: 'Night audit done in Opera ✓ (read at 03:58)' }, {}, {}, {}, {}]);
    check('checklist: a step ticked or skipped is not suggested', [J(run(`clOperaSugg({ steps: CL_STEPS, done: new Set([115]), skipped: new Set(), audit: { state: 'done', at: ${at} }, since: ${night} })`)), J(run(`clOperaSugg({ steps: CL_STEPS, done: new Set(), skipped: new Set([115]), audit: { state: 'done', at: ${at} }, since: ${night} })`))], [{}, {}]);
    check('checklist: tonight began at noon (12:00 before midnight, the day before after midnight)', [run(`clNightStart(${new Date(2026, 9, 11, 3, 0).getTime()})`), run(`clNightStart(${new Date(2026, 9, 11, 22, 0).getTime()})`)], [new Date(2026, 9, 10, 12, 0).getTime(), new Date(2026, 9, 11, 12, 0).getTime()]);
    const now = run('Date.now()');
    sb.hoOpera = { last: k => (k === 'audit' ? { at: now, audit: { state: 'done' }, rows: [] } : null) };
    run('clOperaTick()');
    check('checklist: the tick suggests — and NEVER ticks by itself', [Object.keys(J(run('_clOpSugg'))), run('clState.done.size'), /✓ Tick it/.test(run('_clOpHtml(CL_STEPS.find(s => s.id === 115), false, false)')), run('_clOpHtml(CL_STEPS.find(s => s.id === 115), true, false)')], [['115'], 0, true, '']);
    run('clOperaNo(115)'); run('clOperaTick()');
    check('checklist: ✕ hides it for the rest of the night (remembered)', [J(run('_clOpSugg')), run('clState.done.size'), JSON.parse(store.cl_opera_no_v1).ids], [{}, 0, [115]]);
    run('clToggle2(115)');
    check('checklist: a real tap ticks it', run('clState.done.has(115)'), true);
    delete sb.hoOpera;
  }
  // ── Wake-up calls ──
  {
    const toasts = [];
    const sb = { console: { log() {}, warn() {}, error() {} }, localStorage: LSx, document: docx, setTimeout() { return 0; }, setInterval() { return 0; }, showToast: m => toasts.push(m), logActivity() {}, confirm: () => true,
      bxWakes: {}, fbSet() {}, escapeHtml: s => String(s == null ? '' : s) };
    sb.window = sb; sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'wakeup.js'), 'utf8'), sb, { filename: 'wakeup.js' });
    const run = s => vm.runInContext(s, sb);
    check('wake-ups: the time a trace asks for', ['wake up 6:30', 'WUC 0630', 'Morning call at 7am', 'Wake-up call 6.45 am please', 'room 0412 WUC 0630', 'Room 0412 06:15 wake up', 'Extra towels at 3 pm', 'wake up call please'].map(t => J(sb.wkOperaTime(t, '0412'))),
      [[6, 30], [6, 30], [7, 0], [6, 45], [6, 30], [6, 15], null, null]);
    // the sandbox clock: Sun 11 Oct 2026, 12:00
    const tr = [{ room: '0412', dept: 'FO', date: '2026-10-12', text: 'WUC 0630', name: 'Doe, Test' }, { room: '0305', dept: 'FO', date: '2026-10-11', text: 'wake up 6:30' }, { room: '0510', text: 'Morning call 18:15' },
      { room: '0610', date: '2026-10-12', text: 'wake up 7:00', done: true }, { room: '0711', date: '2026-10-12', text: 'Extra pillows' }, { date: '2026-10-12', text: 'wake up 7:00 (no room)' }];
    const L = J(sb.wkOperaSugg(tr, [], run('Date.now()'), []));
    check('wake-ups: suggestions — a future day keeps its day; today\'s past time, done traces, no room or no wake-up are left out',
      L.map(s => [s.room, s.time, s.day, s.name]), [['0510', '18:15', '2026-10-11', ''], ['0412', '06:30', '2026-10-12', 'Test Doe']]);
    const at = new Date(2026, 9, 12, 6, 30).getTime();
    check('wake-ups: a call already set for that room and time is not suggested again (leading zeros too); ✕ hides it',
      [sb.wkOperaSugg(tr, [{ room: '412', time: '06:30', at }], run('Date.now()'), []).length, sb.wkOperaSugg(tr, [{ room: '412', time: '06:45', at: at + 15 * 60e3 }], run('Date.now()'), []).length, sb.wkOperaSugg(tr, [], run('Date.now()'), [L[1].key]).length],
      [1, 2, 1]);
    sb.hoOpera = { traces: () => tr };
    run(`wkOperaAdd(${JSON.stringify(L[1].key)})`);
    const W0 = Object.values(sb.bxWakes);
    check('wake-ups: one tap adds it through the normal add — then it is no longer suggested', [W0.length, W0[0] && [W0[0].room, W0[0].time, W0[0].at === at, W0[0].name, /Opera trace/.test(W0[0].note), W0[0].done], J(run('_wkOpList()')).map(s => s.room)],
      [1, ['0412', '06:30', true, 'Test Doe', true, false], ['0510']]);
    run(`wkOperaNo(${JSON.stringify(L[0].key)})`);
    check('wake-ups: ✕ is remembered for today · nothing is ever added by itself', [J(run('_wkOpList()')).length, Object.keys(sb.bxWakes).length], [0, 1]);
    delete sb.hoOpera;
    check('wake-ups: no Opera reader → no suggestions', J(run('_wkOpList()')), []);
  }
  // ── Handover Book ──
  {
    const sb = { console: { log() {}, warn() {}, error() {} } }; sb.window = sb; sb.globalThis = sb;
    vm.createContext(sb);
    for (const f of ['wa-bridge.js', 'wa-brain.js', 'handover-book.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
    const H = sb.hoHandoverPure, T = '2026-10-11';
    const tr = [{ room: '0412', dept: 'FO', date: T, time: '14:00', text: 'Guest requests late check-out 2pm' }, { room: '0305', dept: 'HK', date: T, text: 'Extra towels at 3 pm' },
      { room: '0210', dept: 'Front Office', date: T, text: 'Call guest about deposit', done: true }, { dept: 'FO', date: '2026-10-10', text: 'Yesterday\'s trace' }, { room: '0512', dept: 'Reception', date: T, text: 'Room 0512 airport taxi 5am' }, { dept: 'FO', text: 'Collect the passport copy' }];
    const L = J(H.operaTraceSugg(tr, T));
    check('handover: today\'s front office traces not done become suggestions (HK, done and old ones are not)', L.map(s => s.text), ['Room 0412: Guest requests late check-out 2pm', 'Room 0512 airport taxi 5am', 'Collect the passport copy']);
    check('handover: dismissed / added keys and items already in the book are not suggested again',
      [J(H.operaTraceSugg(tr, T, { no: [L[0].key] })).map(s => s.room), J(H.operaTraceSugg(tr, T, { have: new Set(['room 0512 airport taxi 5am']) })).length, L[0].key === J(H.operaTraceSugg(tr, T))[0].key],
      [['0512', ''], 2, true]);
    check('handover: front office department names', ['FO', 'F/O', 'Front Office', 'front desk', 'Reception', 'HK', 'ENG', ''].map(d => H.FO_DEPT_RX.test(d)), [true, true, true, true, true, false, false, false]);
    check('handover: the WhatsApp rules are untouched (HO group / marked messages only)', [H.isHandoverGroup('HO - Ibis Styles'), H.isHandoverGroup('HK Ibis Styles'), H.hoPrefix('HO - Room 512 to twin'), H.hoPrefix('HOTEL guest in 512')], [true, false, 'Room 512 to twin', null]);
  }
}

// ── Opera everywhere: DTCM / tourism tax, In-House gaps, Arr vs Dep, No-shows (made-up guests only) ──
console.log('\nOpera everywhere (dtcm/inhouse/xref/noshow)');
{
  const T = '2026-10-11', J = x => JSON.parse(JSON.stringify(x));
  // ── DTCM: Opera vs DTCM today (dtcm-recon.js operaXref) ──
  const R = makeSandbox().Reconciler;
  const stays = [{ room: '101', guest: 'Alpha Testperson', in: '2026-10-07', out: '' }, { room: '102', guest: 'Bravo Sample', in: '2026-10-08', out: '' },
    { room: '103', guest: 'Charlie Old', in: '2026-10-05', out: '' }, { room: '104', guest: 'Delta Gone', in: '2026-10-08', out: '2026-10-10' },
    { room: '105', guest: 'Echo Left', in: '2026-10-09', out: '' }, { room: '108', guest: 'Golf Ghost', in: '2026-10-09', out: '' }, { room: '109', guest: 'Hotel Cancel', in: '2026-10-09', out: '', st: 'Canceled' }];
  const op = [{ room: '0101', name: 'Testperson, Alpha', arrival: '2026-10-07', status: 'in_house' }, { room: '0102', name: 'Sample, Bravo', arrival: '2026-10-09', status: 'due_out' },
    { room: '0106', name: 'Newguest, Foxtrot', arrival: '2026-10-09', status: 'in_house' }, { room: '0107', name: 'Today, Late', arrival: T, status: 'in_house' },
    { room: '0105', name: 'Left, Echo', departure: T, status: 'checked_out' }, { room: '0103', name: 'Old, Charlie', departure: T, status: 'checked_out' }, { room: '0103', name: 'Relet, India', arrival: T, status: 'in_house' },
    { room: '0101', name: 'Testperson, Alpha', arrival: '2026-10-01', status: 'in_house' }];   // an older read of the same guest: the newest wins
  const X = R.operaXref(stays, op, T, '2026-10-10', { inhouseRead: true });
  check('dtcm × opera: in house in Opera but not in DTCM (arrivals after the DTCM file are not compared)', [X.missingInDtcm.map(r => r.room), X.later], [['106'], 2]);
  check('dtcm × opera: in DTCM, not in house in Opera (cancelled stays left out)', X.missingInOpera.map(r => r.room + ' ' + r.name), ['108 Golf Ghost']);
  check('dtcm × opera: nights differ (check-in 8 Oct in DTCM, 9 Oct in Opera)', J(X.nights), [{ room: '102', name: 'Sample, Bravo', dtcmIn: '2026-10-08', operaIn: '2026-10-09', dtcm: 3, opera: 2 }]);
  check('dtcm × opera: checked out in Opera, still open in DTCM (also when the room was re-let today)', X.notOut.map(r => r.room), ['103', '105']);
  check('dtcm × opera: without an In House read, "not in Opera" is not asked', [R.operaXref(stays, op, T, '2026-10-10', {}).missingInOpera.length, R.operaXref(stays, op, T, '2026-10-10', {}).asked], [0, false]);
  check('dtcm × opera: nothing read → nothing to say', R.operaXref(stays, [], T, '2026-10-10', {}).n, 0);
  const rc = recon('oct1-4');
  check('dtcm × opera: the reconcile result carries the DTCM stays and the last night it covers (for the comparison)', [rc.stays.length > 10, Object.keys(rc.stays[0]).join(), /^\d{4}-\d\d-\d\d$/.test(rc.asOf)], [true, 'room,guest,in,out,n,st', true]);

  // ── In-House: gaps filled from Opera, hand-typed / report values kept ──
  const ib = { console: { log() {}, warn() {}, error() {} } }; ib.window = ib; ib.globalThis = ib; vm.createContext(ib);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'inhouse.js'), 'utf8'), ib, { filename: 'inhouse.js' });
  const P = ib.hoInHousePure;
  const rooms = P.groupRooms(P.parseReport('ROOM\tGUEST_NAME\tARRIVAL\tDEPARTURE\tRATE_CODE\tVIP\n0113\tTestperson, Alpha\t08-OCT-26\t12-OCT-26\tBAR\t\n0204\tExample, Beta\t07-OCT-26\t13-OCT-26\t\tV1\n0310\tSample, Zeta\t07-OCT-26\t13-OCT-26\t\t').rows);
  const at = new Date(2026, 9, 11, 9, 5).getTime();
  const src = { rows: [{ room: '113', name: 'Alpha Testperson', rateCode: 'CORP', roomType: 'KING', vip: 'V2', etd: '11:30', balance: 50, at }, { room: '0204', name: 'Example, Beta', rateCode: 'OTA', vip: 'V9', nat: 'IN', balance: 12, at },
    { room: '0310', name: 'Other, Person', rateCode: 'X', at }, { room: '0310', name: 'Sample, Zeta', rateCode: 'NOPE', status: 'cancelled', at }], folio: () => null, profile: n => (/Alpha/.test(n) ? { member: 'ALL123' } : null) };
  const F = P.operaFill(rooms, src, { balanceEmpty: true });
  check('in-house × opera: empty room type, VIP, membership (profile), ETD, balance filled; the report\'s rate code BAR stays',
    [F[0].rateCode, F[0].roomType, F[0].vip, F[0].member, F[0].depTime, F[0].balance, Object.keys(F[0].opf).join(), F[0].opf.vip, F[0].guests[0].depTime], ['BAR', 'KING', 'V2', 'ALL123', '11:30', 50, 'roomType,vip,member,depTime,balance', '09:05', '11:30']);
  check('in-house × opera: VIP V1 from the report kept; rate code and nationality filled', [F[1].vip, F[1].rateCode, F[1].nat, Object.keys(F[1].opf).join()], ['V1', 'OTA', 'IN', 'rateCode,nat,balance']);
  check('in-house × opera: another guest in the room, or a cancelled booking, fills nothing', [F[2] === rooms[2], F[2].rateCode], [true, '']);
  check('in-house × opera: a balance column in the report → Opera\'s balance is not laid over', [P.operaFill(rooms, src, { balanceEmpty: false })[0].balance, 'balance' in P.operaFill(rooms, src, {})[0].opf], [0, false]);
  check('in-house × opera: the saved rooms are not changed', [rooms[0].roomType, rooms[0].vip, 'opf' in rooms[0]], ['', '', false]);

  // ── Arrivals vs Departures: Opera's reads when the reports are missing or older ──
  const el = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, innerHTML: '', textContent: '' });
  const docStub = () => ({ readyState: 'complete', head: el(), body: el(), getElementById: () => null, createElement: el, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] });
  const xs = { console: { log() {}, warn() {}, error() {} }, document: docStub(), addEventListener() {}, requestAnimationFrame: () => 0, setInterval: () => 0, setTimeout: () => 0 };
  xs.window = xs; xs.globalThis = xs; vm.createContext(xs);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'arr-dep-xref.js'), 'utf8') + `;this.X = { sync: _adSyncArrivals, deps: _adDepList, html: _adSrcHtml, get src() { return _adSrc; }, get arrs() { return _xrefArrRooms.concat(_xrefArrNoRoom); } };`, xs, { filename: 'arr-dep-xref.js' });
  vm.runInContext(`var depRooms = [], arrGuests = []; function hoLocalISO() { return '${T}'; } function escapeHtml(s) { return String(s); } function parseName(s) { return String(s); }`, xs);
  const now = vm.runInContext('Date.now()', xs);   // the sandbox's clock (11 Oct)
  xs.hoOpera = { last: k => J({ arrivals: { kind: 'arrivals', date: T, at: now, rows: [{ room: '0412', name: 'Testperson, Alpha, Mr', conf: '9001', arrival: T, nights: 2, status: 'due_in' }, { name: 'Sample, Bravo', conf: '9002', arrival: T, status: 'due_in' }, { room: '0414', name: 'Gone, Charlie', conf: '9003', arrival: T, status: 'no_show' }] },
    departures: { kind: 'departures', date: T, at: now, rows: [{ room: '0412', name: 'Testperson, Alpha', conf: '8001', departure: T, status: 'due_out' }, { room: '0501', name: 'Example, Delta', departure: T, status: 'checked_out' }, { room: '0502', name: 'Later, Echo', departure: '2026-10-12', status: 'in_house' }] } }[k] || null) };
  xs.X.sync();
  const D = xs.X.deps();
  check('xref × opera: no board, no Arrivals list → Opera\'s departures (checked out → out) and arrivals (no-show left out)',
    [D.src, D.list.map(d => d.roomStr + ':' + d.status), xs.X.src, xs.X.arrs.map(a => (a.room || '-') + ' ' + a.name + ' ' + a.conf)], ['opera', ['0412:due', '0501:out'], 'opera', ['412 Alpha Testperson 9001', '- Bravo Sample 9002']]);
  check('xref × opera: labelled "from Opera, HH:MM"', /📡 from Opera, \d\d:\d\d[\s\S]*📡 from Opera, \d\d:\d\d/.test(xs.X.html(2, 2)), true);
  vm.runInContext(`depRooms.push({ room: 101, roomStr: '101', name: 'Board Guest', status: 'due' }); window._depDate = '${T}'; arrGuests.push({ room: '201', name: 'Typed Guest', conf: '1' }); window._arrDate = '${T}';`, xs);
  xs.X.sync();
  check('xref × opera: today\'s board and Arrivals list come first', [xs.X.deps().src, xs.X.src, xs.X.arrs.length], ['board', 'arrivals', 1]);
  vm.runInContext(`window._depDate = '2026-10-10'; window._arrDate = '2026-10-10';`, xs);
  xs.X.sync();
  check('xref × opera: yesterday\'s board / Arrivals list is older than Opera\'s read → Opera\'s', [xs.X.deps().src, xs.X.src], ['opera', 'opera']);
  xs.hoOpera = undefined; vm.runInContext('_adOpCache.t = 0;', xs);
  xs.X.sync();
  check('xref × opera: no Opera reader → the uploaded lists as before', [xs.X.deps().src, xs.X.src], ['board', 'arrivals']);

  // ── No-shows: Opera's "no show" / "cancelled" arrivals offered, added only on a tap ──
  const ns = { console: { log() {}, warn() {}, error() {} }, document: Object.assign(docStub(), { getElementById: () => el() }), addEventListener() {}, setInterval: () => 0, setTimeout: () => 0, clearTimeout() {} };
  ns.window = ns; ns.globalThis = ns; vm.createContext(ns);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'noshow.js'), 'utf8') + ';this.N = { get guests() { return nsGuests; }, sug: nsOperaSuggestions, render: nsRenderOpera, add: nsAddFromOpera, get list() { return _nsOpList; } };', ns, { filename: 'noshow.js' });
  vm.runInContext(`function hoLocalISO() { return '${T}'; } function escapeHtml(s) { return String(s); } function escapeJsAttr(s) { return String(s); } var saved = 0; function saveNoShow() { saved++; } function showToast() {} function cleanName(s) { return nsCleanName(s); } var arrGuests = [];`, ns);
  const nrows = [{ room: '', name: 'Testperson, Alpha', conf: '7001', arrival: T, departure: '2026-10-13', nights: 2, rate: 400, agent: 'Test OTA', status: 'no_show' },
    { name: 'Sample, Bravo', conf: '7002', arrival: T, status: 'cancelled', rate: 300 }, { name: 'Example, Charlie', conf: '7003', arrival: T, status: 'due_in' }, { name: 'Old, Delta', conf: '7004', arrival: '2026-10-10', status: 'no_show' }];
  const nsNow = vm.runInContext('Date.now()', ns);
  ns.hoOpera = { last: k => (k === 'arrivals' ? J({ kind: 'arrivals', at: nsNow, rows: nrows }) : null) };
  const S = ns.N.sug(nrows, [], T);
  check('no-show × opera: no show + cancelled of today become suggestions (as an NA40 line: DD-MM-YY, nights, rate × nights)',
    J(S).map(g => [g.status, g.nameRaw, g.confNo, g.arrDate, g.nights, g.potRev, g._fromOpera]), [['No Show', 'Testperson, Alpha', '7001', '11-10-26', 2, 800, true], ['Cancelled', 'Sample, Bravo', '7002', '11-10-26', 1, 300, true]]);
  ns.N.render();
  check('no-show × opera: nothing is added by itself', [ns.N.guests.length, ns.N.list.length, vm.runInContext('saved', ns)], [0, 2, 0]);
  ns.N.add(0);
  check('no-show × opera: one tap adds it through the normal add (saved for the team), and it leaves the suggestions', [ns.N.guests.map(g => g.confNo + ' ' + g.status), ns.N.list.map(g => g.confNo), vm.runInContext('saved', ns) > 0], [['7001 No Show'], ['7002'], true]);
  ns.N.add('*'); ns.N.add('*');
  check('no-show × opera: "add all" once; a guest already on the list is not added twice', [ns.N.guests.map(g => g.confNo), ns.N.list.length], [['7001', '7002'], 0]);
  check('no-show × opera: a guest already on the NA40 list (same conf) is not suggested', ns.N.sug(nrows, [{ nameRaw: 'TESTPERSON, ALPHA', confNo: '7001' }], T).map(g => g.confNo), ['7002']);
}

nhAsync.then(() => {
  console.log(`\n${pass} passed · ${fail} failed`);
  process.exit(fail ? 1 : 0);
});

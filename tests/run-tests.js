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
    people: [person('A ONE', { group: 'Adagio GD' }), person('M ONE', { group: 'Mercure DD' }), person('M TWO', { group: 'Mercure DD' }), person('M THREE', { group: 'Mercure DD' })],
    pre: {}, rules: { minRest: 11, maxRun: 6, givePh: false, lend: true, lendIdeal: true }, seed: 3 };
  const r2 = sb.rbSolve(I2);
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
    check('earlier start: 12-21 then 09-18 the next day is not allowed', sb.rbSwitchOk('12:00 - 21:00', '09:00 - 18:00', R), false);
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
    const p = P('Z', { group: 'Mercure DD', noGo: ['Ibis DD'] }), I = { groups: { 'Ibis DD': { shifts: [M] }, 'Adagio GD': { shifts: [M] }, 'Mercure DD': { shifts: [M] } } };
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
    dates.forEach((dt, d) => { res.cells.T[dt] = d === 1 || d === 3 ? 'OFF' : M; res.cells.U[dt] = d === 1 ? 'OFF' : d === 2 ? '00:00 - 09:00' : d === 3 ? 'OFF' : M; });
    sb.rbOneOff(I, res);
    const offsOf = k => dates.filter(dt => /^OFF$/.test(res.cells[k][dt])).length;
    check('one day off a week: an extra day off becomes a working day that fits', [offsOf('T'), res.cells.T[dates[1]]].join('|'), '1|' + M);
    check('one day off a week: no shift fits (after a night) and PH owed → a PH day', [offsOf('U'), /^PH/.test(res.cells.U[dates[1]] + res.cells.U[dates[3]])].join('|'), '1|true');
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
    const ppl = ['A', 'B', 'C'].map(k => P(k)), r = solve(G, ppl);
    const gaps = r.problems.filter(p => p.kind === 'short');
    check('three staff, 21 shifts, 18 working days: one gap closed by someone working their day off (written down), the rest left', [gaps.length, r.problems.filter(p => p.kind === 'offs').length, (r.notes || []).some(n => /works their day off/.test(n.text))].join(), '2,1,true');
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
    check('day then 19:00 - 04:00 the next day is not allowed', sb.rbSwitchOk(M, '19:00 - 04:00', {}), false);
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
    check('reception never empty: day → night without a day off only as the very last bend, flagged', o.filter(x => x.cells).every(x => x.bend && /without a day off/.test(x.why || '')) && o.some(x => x.cells), true);
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
    check('never: day ↔ night always needs a day off; an evening next to a night only as a last resort', [
      sb.rbSwitchOk('12:00 - 21:00', '19:00 - 04:00', { eveNight: true }), sb.rbSwitchOk('08:00 - 17:00', '00:00 - 09:00', { eveNight: true }), sb.rbSwitchOk('00:00 - 09:00', '08:00 - 17:00', { eveNight: true }),
      sb.rbSwitchOk('15:00 - 00:00', '19:00 - 04:00', {}), sb.rbSwitchOk('15:00 - 00:00', '19:00 - 04:00', { eveNight: true })].join(), 'false,false,false,false,true');
    // an evening person can cover a night as a last resort, flagged, with the reason
    {
      const E2 = '15:00 - 00:00', L = '19:00 - 04:00';
      const G2 = { 'Ibis DD': { shifts: [M, E2, L], need: { [M]: day(1), [E2]: day(1), [L]: day(1) } } };
      const pp = [P('X'), P('Y'), P('Z'), P('Q')], c = { X: {}, Y: {}, Z: {}, Q: {} };
      dates.forEach((dt, d) => { c.X[dt] = d === 6 ? 'OFF' : M; c.Y[dt] = d === 5 ? 'OFF' : E2; c.Z[dt] = d === 4 ? 'OFF' : L; c.Q[dt] = d === 3 ? 'OFF' : E2; });
      c.Z[dates[2]] = 'SL';
      const I2 = { week: W, groups: G2, people: pp, pre: { Z: { [dates[2]]: 'SL' } }, rules: { minRest: 11, maxHours: 9, allowOne: true, nightSwitch: true, lend: true } };
      const o2 = sb.rtCoverOptions(I2, c, 'Ibis DD', dates[2], L), b = o2.find(x => x.bend);
      check('last resort: an evening person may take the late night, flagged and explained', !!(b && /evening then a night without a day off/.test(b.text) && /nobody could take it with every rule kept/.test(b.why) && b.key !== 'X'), true);
    }
  }
  // 7d. nights across hotels: every night has a Supervisor or above; the regulars' days off line up and one floater does them as a block
  {
    const H = ['Adagio GD', 'Mercure DD', 'Ibis DD'], G = {}, ppl = [];
    H.forEach((h, i) => { G[h] = { shifts: [N, M], need: { [N]: day(1), [M]: day(1) }, who: { [N]: ['Supervisor', 'Duty Manager'] } };
      ppl.push(P('DM' + i, { group: h, title: 'Duty Manager', fixed: N, usual: N, lastShift: N }), P('A' + i, { group: h, usual: M, lastShift: M }), P('B' + i, { group: h, usual: M, lastShift: M })); });
    ppl.push(P('SUP', { group: 'Adagio GD', title: 'Supervisor', usual: M, lastShift: 'OFF' }));
    const r = sb.rbSolve({ week: W, groups: G, people: ppl, pre: {}, rules: { minRest: 11, maxRun: 12, maxHours: 9, allowOne: true, nightSwitch: true, lend: true, givePh: false }, seed: 1 });
    const nightsOk = H.every(h => dates.every(dt => ppl.some(p => { const x = sb.rbParse(r.cells[p.key][dt]); return x && x.s === 0 && x.type === 'night' && sb.rbAt({ groups: G }, p, x) === h && /Supervisor|Duty Manager/.test(p.title); })));
    check('nights: every hotel, every night, a Supervisor or above', nightsOk, true);
    check('nights: no rule broken to do it', r.problems.filter(p => p.kind !== 'thin').length, 0);
    check('nights: the plan is written down', (r.notes || []).some(n => /covers the night supervisor's days off/.test(n.text)), true);
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
    const onA = dates.filter(d => ['A', 'B', 'C'].filter(k => r.cells[k][d] === A).length === 2).length;
    check('desk: the spare person goes where someone would be alone (07–16 when the aim is 06:00–18:00)', onA >= 6, true);
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
  check('levels: as always by default, Off = 0, Must counts more', run(`[rbW({}, 'home'), rbW({ levels: { home: 0 } }, 'home'), rbW({ levels: { home: 4 } }, 'home') > 2].join()`), '1,0,true');
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
  check('say it: "avoid Sam with Lina", "Sam and Lina never together", "Sam can\'t work with Lina"', run(`['avoid Sam with Lina', 'Sam and Lina never together', "Sam can't work with Lina"].map(q => (rrParseSay(q) || {}).t).join()`), 'apart,apart,apart');
  run(`var N = '23:00 - 07:00', G3 = { 'Ibis DD': { shifts: [M, E, N], need: { [M]: day(1), [E]: day(1), [N]: day(1) } } };
    var nightsOf = (care, lvl) => { const pp = ['A', 'B', 'C', 'D'].map(k => P(k, k === 'C' && care ? { care: 2, careScore: 45 } : {})); const r = rbSolve({ week: W, groups: G3, people: pp, pre: {}, rules: { minRest: 11, maxRun: 12, maxHours: 9, allowOne: true, givePh: false, levels: lvl || {} }, seed: 2 }); return { n: dates.filter(dt => rbIsNight(r.cells.C[dt])).length, notes: r.notes || [] }; };`);
  check('extra care: someone close to breaking gets no more nights than before, and it is written down', run(`const a = nightsOf(false), b = nightsOf(true); [b.n <= a.n, b.notes.some(x => x.care && /Extra care/.test(x.text))].join()`), 'true,true');
  check('extra care: switched Off in Rules, nothing changes', run(`nightsOf(true, { care: 0 }).notes.some(x => x.care)`), false);
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
}

// ── Ops Brain understands plain talk (brain-understand.js) ──
{
  const sb = { console: { log() {}, warn() {}, error() {} }, localStorage: { getItem() { return null; }, setItem() {} }, fbSet() {}, showToast() {}, escapeHtml: x => String(x),
               document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; } }, window: {}, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, navigator: {} };
  vm.createContext(sb);
  for (const f of ['roster.js', 'roster-build.js', 'roster-team.js', 'brain-understand.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  const run = js => vm.runInContext(js, sb);
  run(`[['S', 'Souptik Bhadra', 'Adagio GD'], ['A', 'Ali Zama Mirza', 'Adagio GD'], ['H', 'Ahmed Saleh', 'Ibis DD'], ['M', 'Manisha Rai', 'Ibis DD'], ['L', 'Lina Park', 'Mercure DD']].forEach(([k, n, g]) => { roStaff[k] = { name: n, group: g }; });`);
  const say = q => run(`(u => (u.sure ? 'DO ' : 'ASK ') + (u.cmd || u.options.map(o => o.cmd).join(' / ')))(buUnderstand(${JSON.stringify(q)}))`);
  check('plain talk: "can u keep souptik away from mr ali pls"', say('can u keep souptik away from mr ali pls'), 'DO avoid Souptik Bhadra with Ali Zama Mirza');
  check('plain talk: "ahmed not coming tmrw" (typo)', say('ahmed not coming tmrw'), 'DO Ahmed Saleh is sick tomorrow');
  check('plain talk: "manisha dont want nights anymore"', say('manisha dont want nights anymore'), 'DO Manisha Rai prefers not nights');
  check('plain talk: "how many vacation days left for lina"', say('how many vacation days left for lina'), 'DO vacation balance of Lina Park');
  check('plain talk: "who is working now"', say('who is working now'), 'DO who is on now');
  check('plain talk: "make next week roster"', say('make next week roster'), 'DO build the roster');
  check('plain talk: a misspelt name ("souptk and ali never together")', say('souptk and ali never together'), 'DO avoid Souptik Bhadra with Ali Zama Mirza');
  check('plain talk: "dont send lina to ibis"', say('dont send lina to ibis'), 'DO never send Lina Park to Ibis DD');
  check('plain talk: a guest or a room is never a change to the team ("Mr Ahmed in 512 is sick")', run(`buUnderstand('Mr Ahmed in 512 is sick').options.length`), 0);
  check('plain talk: "Mr Ahmed is sick" asks first (could be a guest)', say('Mr Ahmed is sick'), 'ASK Ahmed Saleh is sick today');
  check('plain talk: a plain question is left to Ops Brain ("how do I post TD")', run(`buUnderstand('how do I post TD').options.length`), 0);
  run(`roStaff.SB = { name: 'Sandrine Berinyuy', group: 'Adagio GD' }; roToday = () => '2026-10-10'; roCanEdit = () => true; _rtOut = () => {};`);
  check('dates: "15" and "the 15th" are the next 15th', run(`[rtDay('15'), rtDay('the 15th'), rtDay('until 5')].join()`), '2026-10-15,2026-10-15,2026-11-05');
  check('plain talk: "sandrine on vaction until 15" books vacation today → 15th', run(`const u = buUnderstand('sandrine on vaction until 15'); RT_COMMANDS.find(c => c.re.test(u.cmd)).run(u.cmd); JSON.stringify(Object.values(rbPeople.SB.absences).map(a => [a.from, a.to, a.code]))`), JSON.stringify([['2026-10-10', '2026-10-15', 'AL']]));
  run(`for (let d = 0; d < 7; d++) { const dt = roAdd('2026-10-05', d); roDays[dt] = Object.assign({}, roDays[dt], { SB: d === 6 ? 'OFF' : d >= 4 ? 'ALA' : '12:00 - 21:00' }); } rbPeople.SB = {}; rtApplyPublished = () => true; rbStampReset();`);
  check('leave: a day off or leave already posted stays as it is; only working days change', run(`const t = rtMarkAbsent('SB', '2026-10-08', '2026-10-15', 'AL', true); [t.changed.join(' '), t.kept.join(' ')].join(' | ')`), '2026-10-08 | 2026-10-09 2026-10-10 2026-10-11');
  check('plain talk: "until 15 oct" is the end date, not the start', say('sandrine is on vacation until 15 oct'), 'DO Sandrine Berinyuy is on vacation today until 15 oct');
  check('plain talk: "how to …" shows how and asks before doing it', say('how to keep sandrine on vaction until 15 ?'), 'ASK Sandrine Berinyuy is on vacation today until 15');
  check('plain talk: learns what you meant', run(`const c = buRead('put souptik far from ali'); buLearn(c, 'apart'); buUnderstand('put lina far from manisha').cmd`), 'avoid Lina Park with Manisha Rai');
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
       rbSetPerson('A', 'title', 'Manager');`);
  const lk = run(`(() => { rbWeek = W; const I = rbInput(1), A = I.people.find(p => p.key === 'A'), res = rbSolve(I), dates = [0, 1, 2, 3, 4, 5, 6].map(d => roAdd(W, d));
    const moved = dates.some(dt => rbParse(res.cells.A[dt]) && rbNorm(res.cells.A[dt]) !== A.fixed);
    const gap = { date: dates[3], shift: '15:00 - 00:00' };
    const optA = rtCoverOptions(I, res.cells, 'Ibis DD', gap.date, gap.shift).some(o => o.key === 'A');
    const borrowG = rtCoverOptions(I, res.cells, 'Ibis DD', gap.date, '08:00 - 17:00').some(o => o.key === 'G');
    rbSetPerson('G', 'home', true);
    const I2 = rbInput(1), homeG = rtCoverOptions(I2, res.cells, 'Ibis DD', gap.date, '08:00 - 17:00').some(o => o.key === 'G');
    rbSetPerson('G', 'home', undefined); rbSetRule('lend', false);
    const I3 = rbInput(1), allHome = rtCoverOptions(I3, res.cells, 'Ibis DD', gap.date, '08:00 - 17:00').some(o => o.key === 'G' || o.key === 'H');
    rbSetRule('lend', true);
    return { lock: A.lock, fixed: A.fixed, moved, optA, borrowG, homeG, allHome }; })()`);
  check('lock: a manager keeps their shift by default', [lk.lock, lk.fixed].join(), 'true,08:00 - 17:00');
  check('lock: the builder never moves a manager off it', lk.moved, false);
  check('lock: a manager is never suggested to cover', lk.optA, false);
  check('lock: someone from another hotel can be borrowed normally', lk.borrowG, true);
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

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);

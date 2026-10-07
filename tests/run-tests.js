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
    pre: {}, rules: { minRest: 11, maxRun: 6, givePh: false, lend: true }, seed: 3 };
  const r2 = sb.rbSolve(I2);
  const lent = Object.values(r2.cells).reduce((t, row) => t + Object.values(row).filter(v => / - Adagio$/.test(v)).length, 0);
  check('Mercure lends staff to Adagio ("12:00 - 21:00 - Adagio")', lent >= 5, true);
  check('lending never leaves the lender short', r2.problems.filter(p => p.kind === 'short' && p.group === 'Mercure DD').length, 0);
  check('lent shifts count for the hotel they work at', r2.cover['Adagio GD'][N].reduce((a, b) => a + b, 0) >= 11, true);

  // weeks in a row, each starting from how the last one ended (the way it is really used)
  let probs = 0, weeks = 0;
  let tight = 0;
  for (let team = 0; team <= 3; team++) {
    const n = 5 + team, R = sb.rbRand((team || 4) * 97);
    const need = {}; S.forEach(x => { need[x] = one; }); if (n >= 6) need[S[1]] = [2, 2, 2, 2, 2, 1, 1];
    let ppl = Array.from({ length: n }, (_, i) => person('P' + i, { fixed: i === 0 ? S[0] : '' })), w = W;
    for (let k = 0; k < 4; k++, w = sb.roAdd(w, 7)) {
      const ds = [0, 1, 2, 3, 4, 5, 6].map(d => sb.roAdd(w, d)), pre = {};
      if (R() < 0.5) { const d = Math.floor(R() * 5); pre['P' + (1 + Math.floor(R() * (n - 1)))] = { [ds[d]]: 'AL', [ds[d + 1]]: 'AL' }; }
      const r3 = sb.rbSolve({ week: w, groups: { 'Ibis DD': { shifts: S, need } }, people: ppl, pre, rules: { minRest: 11, maxRun: 12, givePh: false, lend: false }, seed: k + 1, attempts: 2 });
      if (n === 5) tight = Math.max(tight, r3.problems.length); else { probs += r3.problems.length; weeks++; }
      ppl = ppl.map(p => { const row = ds.map(d => r3.cells[p.key][d] || ''); let run = 0; for (let d = 6; d >= 0 && sb.rbParse(row[d]); d--) run++; if (run === 7) run += p.run; return Object.assign({}, p, { lastShift: row[6], run }); });
    }
  }
  check(`${weeks} weeks in a row for teams of 6 to 8: no gaps, rest, night/day or day-off problems`, probs, 0);
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

  // 1. ideal two per shift, too few people: never an empty shift, some one-person shifts
  {
    const r = solve({ 'Ibis DD': { shifts: [M, E], need: { [M]: day(2), [E]: day(2) } } }, ['A', 'B', 'C', 'D'].map(k => P(k)));
    check('short-handed: no shift left empty', r.problems.filter(p => p.kind === 'short').length, 0);
    check('short-handed: one-person shifts reported instead', r.problems.filter(p => p.kind === 'thin').length > 0, true);
  }
  // 2. three staff, three shifts of one (one-man shifts): the gaps that can't be filled say "bring in a staff member"
  {
    const G = { 'Ibis DD': { shifts: [N, M, E], need: { [N]: day(1), [M]: day(1), [E]: day(1) } } };
    const ppl = ['A', 'B', 'C'].map(k => P(k)), r = solve(G, ppl);
    const gaps = r.problems.filter(p => p.kind === 'short');
    check('three staff, 21 shifts, 18 working days: only 3 gaps', gaps.length, 3);
    check('no rest or day-off rule broken to close them', r.problems.filter(p => p.kind === 'rest' || p.kind === 'offs').length, 0);
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
    const b = o.find(x => x.bend);
    check('bend: offered only as a flagged last resort', !!b && !o.some(x => x.cells && !x.bend), true);
    check('bend: it says what it does and why', !!(b && /no day off between night and day/.test(b.text) && /nobody else could/.test(b.why)), true);
    check('bend: rest and 9 h are still kept', b ? sb.rbProblems(I, b.cells).filter(p => p.kind === 'rest' || p.kind === 'long').length : -1, 0);
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

// ── What if… (roster-team.js) ─────────────────────────────
{
  const sb = { console: { log() {}, warn() {}, error() {} }, localStorage: { getItem() { return null; }, setItem() {} }, fbSet() {}, showToast() {}, escapeHtml: x => String(x),
               document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; } }, window: {}, setTimeout: () => 0, setInterval: () => 0, navigator: {} };
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
  run(`roStaff.NOH = { name: 'Nora Hale', order: 30 };`);
  check('groups: someone with no hotel set is still rostered', run(`rbGroups().includes('')`), true);
  run(`delete roStaff.NOH;`);
}

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);

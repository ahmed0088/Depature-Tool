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
  for (let team = 1; team <= 3; team++) {
    const n = 4 + team, R = sb.rbRand(team * 97);
    const need = {}; S.forEach(x => { need[x] = one; }); if (n >= 6) need[S[1]] = [2, 2, 2, 2, 2, 1, 1];
    let ppl = Array.from({ length: n }, (_, i) => person('P' + i, { fixed: i === 0 ? S[0] : '' })), w = W;
    for (let k = 0; k < 4; k++, w = sb.roAdd(w, 7)) {
      const ds = [0, 1, 2, 3, 4, 5, 6].map(d => sb.roAdd(w, d)), pre = {};
      if (R() < 0.5) { const d = Math.floor(R() * 5); pre['P' + (1 + Math.floor(R() * (n - 1)))] = { [ds[d]]: 'AL', [ds[d + 1]]: 'AL' }; }
      const r3 = sb.rbSolve({ week: w, groups: { 'Ibis DD': { shifts: S, need } }, people: ppl, pre, rules: { minRest: 11, maxRun: 12, givePh: false, lend: false }, seed: k + 1, attempts: 2 });
      probs += r3.problems.length; weeks++;
      ppl = ppl.map(p => { const row = ds.map(d => r3.cells[p.key][d] || ''); let run = 0; for (let d = 6; d >= 0 && sb.rbParse(row[d]); d--) run++; if (run === 7) run += p.run; return Object.assign({}, p, { lastShift: row[6], run }); });
    }
  }
  check(`${weeks} weeks in a row for 3 teams of 5 to 7: no gaps, rest or day-off problems`, probs, 0);
}

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);

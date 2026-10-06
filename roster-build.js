// ═══════════════════════════════════════════════════════════
//  roster-build.js — the roster builder
//
//  Makes next week's roster the way a front-office manager does:
//    • learns from the rosters already in HotelOps: which shifts each hotel
//      runs, how many people each shift needs on each weekday, everyone's
//      usual shift and how many days off they get;
//    • takes the week's requests: day off, AL / ALA / SL, PH day,
//      must work a shift, can't work a shift;
//    • builds the week: weekly OFFs on the days with the most spare
//      staff, at least 11 h rest between shifts, a cap on days in a row
//      (12 by default: one OFF in every Monday–Sunday week), people keep their shift through the week,
//      weekend offs rotate, PH days owed are given when there is spare
//      cover, and a hotel that is short borrows from another hotel;
//    • you check it (cover table, problems, tap any cell to change it),
//      publish it to the team and share it as a picture.
//
//  Firebase (per hotel space):
//    roster/builder/settings        rules, cover needed, public holidays
//    roster/builder/people/{KEY}    days off a week, fixed shift, …
//    roster/builder/requests/{week}/{id}
//    roster/builder/drafts/{week}   the roster being built
// ═══════════════════════════════════════════════════════════

// ── Time ──────────────────────────────────────────────────
function rbMin(t) { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); }
/** A working shift's start and end in minutes from the start of its day (end may pass midnight). */
const _rbPC = new Map(), _rbKC = new Map();   // read once per text: the builder asks thousands of times
function rbParse(code) {
  code = code == null ? '' : String(code);
  if (_rbPC.has(code)) return _rbPC.get(code);
  const i = typeof roInfo === 'function' ? roInfo(code) : null;
  let r = null;
  if (i && i.from) { const s = rbMin(i.from); let e = rbMin(i.to); if (e <= s) e += 1440; r = { from: i.from, to: i.to, s, e, type: i.type, note: i.note || '' }; }
  _rbPC.set(code, r);
  return r;
}
/** "09:00 - 18:00" for any way of writing the same hours. */
function rbNorm(code) { const p = rbParse(code); return p ? `${p.from} - ${p.to}` : null; }
/** Hours of rest between a shift on one day and a shift on the next. */
function rbRest(prev, next) { const a = rbParse(prev), b = rbParse(next); return a && b ? (1440 + b.s - a.e) / 60 : 99; }
function rbKind(code) {
  code = code == null ? '' : String(code);
  if (_rbKC.has(code)) return _rbKC.get(code);
  const i = code && typeof roInfo === 'function' ? roInfo(code) : null;
  const k = !code ? '' : rbParse(code) ? 'work' : i ? i.type : 'other';
  _rbKC.set(code, k);
  return k;
}
function rbRand(seed) { let a = seed >>> 0 || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function rbShort(group) { return String(group || '').split(/\s+/)[0]; }

// ── The engine (no screen, so it can be tested) ───────────
/**
 * I = { week:'YYYY-MM-DD' (Monday), groups:{ [group]:{ shifts:[code], need:{ [code]:[7 numbers] } } },
 *       people:[{ key, group, offs, fixed, usual, allowed:[codes]|null, prefOff:[0-6], lastShift, run, lastOffs:[0-6], lastWeekendOff, phOwed, phLabel }],
 *       pre:{ [key]:{ [date]:value } }, avoid:{ [key]:{ [date]:[codes] } },
 *       rules:{ minRest, maxRun, givePh, lend }, seed }
 * → { cells:{ [key]:{ [date]:value } }, problems:[…], cover:{ [group]:{ [code]:[have×7] } } }
 */
function rbSolve(I) {
  _rbPC.clear(); _rbKC.clear();   // codes may have been renamed since last time
  // a few attempts from different starting points; the best week wins
  const R0 = Object.assign({ minRest: 11, maxRun: 12, givePh: true, lend: true }, I.rules || {});
  const dates0 = Array.from({ length: 7 }, (_, d) => roAdd(I.week, d));
  let best = null, bestSc = Infinity;
  for (let k = 0; k < (I.attempts || 4); k++) {
    const cells = _rbAttempt(I, (I.seed || 1) + k * 7919);
    const sc = Object.keys(I.groups).reduce((t, g) => t + rbScore(I, g, cells, dates0, R0), 0);
    if (sc < bestSc) { bestSc = sc; best = cells; }
  }
  return _rbFinish(I, best);
}
function _rbAttempt(I, seed) {
  const D = 7, dates = Array.from({ length: D }, (_, d) => roAdd(I.week, d));
  const rnd = rbRand(seed || 1);
  const R = Object.assign({ minRest: 11, maxRun: 12, givePh: true, lend: true }, I.rules || {});
  const cells = {};
  I.people.forEach(p => { cells[p.key] = {}; dates.forEach(dt => { const v = ((I.pre || {})[p.key] || {})[dt]; if (v) cells[p.key][dt] = v; }); });
  const G = I.groups;
  const need = (g, s, d) => ((G[g] && G[g].need[s]) || [])[d] || 0;
  const needDay = (g, d) => (G[g] ? G[g].shifts : []).reduce((t, s) => t + need(g, s, d), 0);
  const free = (p, d) => !cells[p.key][dates[d]];
  const offOrAway = v => { const k = rbKind(v); return k === 'off' || k === 'leave' || k === 'other'; };
  const avoidS = (p, d, s) => (((I.avoid || {})[p.key] || {})[dates[d]] || []).includes(s);

  for (const g of Object.keys(G)) {
    const P = I.people.filter(p => p.group === g);
    // 1. weekly days off, on the days with the most spare people
    const offsTaken = p => dates.filter(dt => rbKind(cells[p.key][dt]) === 'off').length;
    const deadline = p => { const firstBreak = dates.findIndex(dt => offOrAway(cells[p.key][dt])); return firstBreak >= 0 && firstBreak <= R.maxRun - (p.run || 0) ? 99 : R.maxRun - (p.run || 0); };
    const order = P.slice().sort((a, b) => deadline(a) - deadline(b) || dates.filter((_, d) => free(a, d)).length - dates.filter((_, d) => free(b, d)).length || rnd() - 0.5);
    for (const p of order) {
      let k = Math.max(0, (p.offs == null ? 1 : p.offs) - offsTaken(p));
      while (k-- > 0) {
        let best = -1, bc = Infinity;
        for (let d = 0; d < D; d++) {
          if (!free(p, d)) continue;
          const can = P.filter(q => q !== p && (free(q, d) || rbParse(cells[q.key][dates[d]]))).length;   // who else can work that day
          const spare = can - needDay(g, d);
          let c = -spare * 4 + (spare < 0 ? 100 : 0);
          if (p.fixed) {
            const cover = P.filter(q => q !== p && (q.fixed === p.fixed || (!q.fixed && (!q.allowed || !q.allowed.length || q.allowed.includes(p.fixed)))) && (free(q, d) || rbNorm(cells[q.key][dates[d]]) === p.fixed)).length;
            if (cover < need(g, p.fixed, d)) c += 70;
          }
          if ((p.prefOff || []).includes(d)) c -= 25;
          if ((p.lastOffs || []).includes(d)) c -= 2;
          if (p.lastWeekendOff && d >= 4) c += 5;                       // weekend offs take turns
          const firstBreak = dates.findIndex(dt => offOrAway(cells[p.key][dt]));
          if ((firstBreak < 0 || firstBreak > d) && (p.run || 0) + d > R.maxRun) c += 90;   // too many days in a row from last week
          if (dates.some((dt, e) => Math.abs(e - d) === 1 && rbKind(cells[p.key][dt]) === 'off')) c -= 3;
          c += rnd() * 2;
          if (c < bc) { bc = c; best = d; }
        }
        if (best < 0) break;
        cells[p.key][dates[best]] = 'OFF';
      }
    }
    // 2. shifts: each day solved as a whole (everyone working that day matched to the shifts at once)
    for (let d = 0; d < D; d++) rbMatchDay(I, g, cells, dates, d, R, rnd);
  }
  // 3. improve the whole week: try changes, keep the ones that score better
  Object.keys(G).forEach(g => rbImprove(I, g, cells, dates, R, rnd));
  return cells;
}
function _rbFinish(I, cells) {
  const D = 7, dates = Array.from({ length: D }, (_, d) => roAdd(I.week, d)), G = I.groups;
  const R = Object.assign({ minRest: 11, maxRun: 12, givePh: true, lend: true }, I.rules || {});
  const need = (g, s, d) => ((G[g] && G[g].need[s]) || [])[d] || 0;
  // 4. a hotel that is short borrows someone on the same shift from a hotel with one spare
  let cover = rbCover(I, cells);
  if (R.lend) {
    for (const g of Object.keys(G)) for (let d = 0; d < D; d++) for (const s of G[g].shifts) {
      while (cover[g][s][d] < need(g, s, d)) {
        const dt = dates[d];
        const donor = I.people.find(q => q.group !== g && G[q.group] && cells[q.key][dt] === s && cover[q.group][s] && cover[q.group][s][d] > need(q.group, s, d));
        if (!donor) break;
        cells[donor.key][dt] = `${s} - ${rbShort(g)}`;
        cover = rbCover(I, cells);
      }
    }
  }
  // 5. PH days owed, when the shift has someone spare
  if (R.givePh) {
    I.people.filter(p => (p.phOwed || 0) > 0).forEach(p => {
      for (let d = 0; d < D; d++) {
        const dt = dates[d], s = cells[p.key][dt];
        if (!s || !G[p.group] || !G[p.group].shifts.includes(s)) continue;
        if (cover[p.group][s][d] > need(p.group, s, d)) { cells[p.key][dt] = p.phLabel ? `PH - ${p.phLabel}` : 'PH'; cover = rbCover(I, cells); break; }
      }
    });
  }
  return { cells, cover, problems: rbProblems(I, cells, cover) };
}

/** The cheapest way to give each row its own column (Hungarian method). C has rows ≤ columns. */
function rbHungarian(C) {
  const n = C.length, m = n ? C[0].length : 0, INF = 1e15;
  const u = new Float64Array(n + 1), v = new Float64Array(m + 1), p = new Int32Array(m + 1), way = new Int32Array(m + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0;
    const minv = new Float64Array(m + 1).fill(INF), used = new Uint8Array(m + 1);
    do {
      used[j0] = 1; const i0 = p[j0]; let delta = INF, j1 = 0;
      for (let j = 1; j <= m; j++) if (!used[j]) {
        const cur = C[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const res = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]) res[p[j] - 1] = j - 1;
  return res;
}
/** Give everyone working on day d (who isn't fixed by a request) the best shift, all at once:
 *  needed places first, the rest as extra hands; rest rules with the day before and after. */
function rbMatchDay(I, g, cells, dates, d, R, rnd) {
  const G = I.groups[g], dt = dates[d], BAD = 1e6;
  const have = {}; G.shifts.forEach(s => { have[s] = 0; });
  const rows = [];
  I.people.forEach(p => {
    if (p.group !== g) return;
    const v = cells[p.key][dt] || '';
    const locked = !!(((I.pre || {})[p.key] || {})[dt]);
    if (!locked && (!v || G.shifts.includes(v))) { rows.push(p); return; }
    if (G.shifts.includes(v)) have[v]++;
  });
  if (!rows.length) return;
  const cols = [];
  G.shifts.forEach(s => { for (let k = have[s]; k < (((G.need[s] || [])[d]) || 0); k++) cols.push({ s, req: true }); });
  G.shifts.forEach(s => { for (let k = 0; k < rows.length; k++) cols.push({ s, req: false, k }); });
  const base = (p, s) => {
    if (p.allowed && p.allowed.length && !p.allowed.includes(s)) return BAD;
    if ((((I.avoid || {})[p.key] || {})[dt] || []).includes(s)) return BAD;
    const pv = d === 0 ? p.lastShift || '' : cells[p.key][dates[d - 1]] || '';
    const nx = d < 6 ? cells[p.key][dates[d + 1]] || '' : '';
    if (rbParse(pv) && rbRest(pv, s) < R.minRest) return BAD;
    if (rbParse(nx) && rbRest(s, nx) < R.minRest) return BAD;
    let c = 0;
    if (p.fixed) c += s === p.fixed ? -8 : 30;
    if (rbParse(pv)) c += rbNorm(pv) === s ? -6 : 3;
    if (rbParse(nx)) c += rbNorm(nx) === s ? -3 : 1.5;
    if (p.usual && s === p.usual) c -= 3;
    return c + (rnd ? rnd() * 1.5 : 0);
  };
  const C = rows.map(p => { const b = {}; G.shifts.forEach(s => { b[s] = base(p, s); }); return cols.map(c => b[c.s] >= BAD ? BAD : b[c.s] + (c.req ? -1000 : 2 + c.k * 0.3)); });
  const pick = rbHungarian(C);
  rows.forEach((p, i) => { const j = pick[i]; cells[p.key][dt] = j >= 0 && C[i][j] < BAD ? cols[j].s : 'OFF'; });   // no shift gives enough rest: a forced rest day
}

/** How good a week is for one hotel: lower is better. Gaps in cover and broken rules weigh most. */
function rbScore(I, g, cells, dates, R) {
  const G = I.groups[g], P = I.people.filter(p => p.group === g);
  let sc = 0;
  for (let d = 0; d < 7; d++) {
    const have = {}; G.shifts.forEach(s => { have[s] = 0; });
    P.forEach(p => { const v = cells[p.key][dates[d]]; if (have[v] != null) have[v]++; });
    G.shifts.forEach(s => { const n = (G.need[s] || [])[d] || 0; if (have[s] < n) sc += 1000 * (n - have[s]); else sc += 0.5 * (have[s] - n); });
  }
  P.forEach(p => {
    let run = p.run || 0, prev = p.lastShift || '', offs = 0;
    for (let d = 0; d < 7; d++) {
      const dt = dates[d], v = cells[p.key][dt] || '';
      if (rbParse(v)) {
        run++;
        if (run > R.maxRun) sc += 2500;
        if (prev && rbParse(prev) && rbRest(prev, v) < R.minRest) sc += 3000;
        if (p.fixed && rbNorm(v) !== p.fixed) sc += 40;
        if (p.allowed && p.allowed.length && !p.allowed.includes(v)) sc += 800;
        if ((((I.avoid || {})[p.key] || {})[dt] || []).includes(v)) sc += 800;
        if (prev && rbParse(prev) && rbNorm(prev) !== rbNorm(v)) sc += 3;   // a change of shift mid-week
        if (p.usual && v === p.usual) sc -= 1;
      } else {
        run = 0;
        if (rbKind(v) === 'off') { offs++; if ((p.prefOff || []).includes(d)) sc -= 10; if ((p.lastOffs || []).includes(d)) sc -= 1; if (p.lastWeekendOff && d >= 4) sc += 5; }
      }
      prev = v;
    }
    sc += 2000 * Math.abs(offs - (p.offs == null ? 1 : p.offs));   // rest, days in a row and days off come before cover
  });
  return sc;
}
/** Local search: change a cell, move someone's day off, or swap two people's shifts; keep what scores better. */
function rbImprove(I, g, cells, dates, R, rnd) {
  const G = I.groups[g], P = I.people.filter(p => p.group === g);
  const locked = (p, d) => !!(((I.pre || {})[p.key] || {})[dates[d]]);
  const opts = G.shifts.concat(['OFF']);
  let best = rbScore(I, g, cells, dates, R);
  const tryIt = (apply, undo) => { apply(); const sc = rbScore(I, g, cells, dates, R); if (sc < best - 1e-9) { best = sc; return true; } undo(); return false; };
  for (let pass = 0; pass < 40 && best > 0; pass++) {
    let improved = false;
    const order = [];
    P.forEach(p => { for (let d = 0; d < 7; d++) if (!locked(p, d)) order.push([p, d]); });
    order.sort(() => rnd() - 0.5);
    for (const [p, d] of order) {
      const dt = dates[d], cur = cells[p.key][dt];
      // another shift, or off
      for (const o of opts) { if (o === cur) continue; if (tryIt(() => { cells[p.key][dt] = o; }, () => { cells[p.key][dt] = cur; })) { improved = true; break; } }
      // swap two of their own days (moves a day off without changing how many)
      for (let e = 0; e < 7; e++) {
        if (e === d || locked(p, e)) continue;
        const a = cells[p.key][dt], b = cells[p.key][dates[e]];
        if (a === b) continue;
        if (tryIt(() => { cells[p.key][dt] = b; cells[p.key][dates[e]] = a; }, () => { cells[p.key][dt] = a; cells[p.key][dates[e]] = b; })) { improved = true; }
      }
      // move a day off here and give the day it leaves the shift that fits best
      if (rbKind(cells[p.key][dt]) !== 'off') for (let e = 0; e < 7; e++) {
        if (e === d || locked(p, e) || rbKind(cells[p.key][dates[e]]) !== 'off') continue;
        const a = cells[p.key][dt], b = cells[p.key][dates[e]];
        for (const o of G.shifts) if (tryIt(() => { cells[p.key][dt] = 'OFF'; cells[p.key][dates[e]] = o; }, () => { cells[p.key][dt] = a; cells[p.key][dates[e]] = b; })) { improved = true; break; }
      }
      // move this person's day off to here, then re-solve both days for the whole team
      if (rbKind(cells[p.key][dt]) !== 'off') for (let e = 0; e < 7; e++) {
        if (e === d || locked(p, e) || rbKind(cells[p.key][dates[e]]) !== 'off') continue;
        const snap = P.map(q => [q.key, cells[q.key][dt], cells[q.key][dates[e]]]);
        if (tryIt(() => { cells[p.key][dt] = 'OFF'; cells[p.key][dates[e]] = ''; rbMatchDay(I, g, cells, dates, e, R, null); rbMatchDay(I, g, cells, dates, d, R, null); },
                  () => { snap.forEach(([k, a, b]) => { cells[k][dt] = a; cells[k][dates[e]] = b; }); })) { improved = true; break; }
      }
      // two days in a row on one shift (rest rules often need both to change together)
      if (d < 6 && !locked(p, d + 1)) for (const o of G.shifts) {
        const a = cells[p.key][dt], b = cells[p.key][dates[d + 1]];
        if (a === o && b === o) continue;
        if (tryIt(() => { cells[p.key][dt] = o; cells[p.key][dates[d + 1]] = o; }, () => { cells[p.key][dt] = a; cells[p.key][dates[d + 1]] = b; })) { improved = true; break; }
      }
      // swap with a colleague that day
      for (const q of P) {
        if (q === p || locked(q, d)) continue;
        const a = cells[p.key][dt], b = cells[q.key][dt];
        if (a === b) continue;
        if (tryIt(() => { cells[p.key][dt] = b; cells[q.key][dt] = a; }, () => { cells[p.key][dt] = a; cells[q.key][dt] = b; })) improved = true;
      }
    }
    // re-solve each day as a whole with the days around it as they are now
    for (let d = 0; d < 7; d++) {
      const snap = P.map(q => [q.key, cells[q.key][dates[d]]]);
      if (tryIt(() => rbMatchDay(I, g, cells, dates, d, R, null), () => snap.forEach(([k, v]) => { cells[k][dates[d]] = v; }))) improved = true;
    }
    if (!improved) break;
  }
  return best;
}

/** How many people each hotel has on each shift each day (someone lent out counts where they work). */
function rbCover(I, cells) {
  const dates = Array.from({ length: 7 }, (_, d) => roAdd(I.week, d)), out = {};
  const byShort = {}; Object.keys(I.groups).forEach(g => { byShort[rbShort(g).toLowerCase()] = g; out[g] = {}; I.groups[g].shifts.forEach(s => { out[g][s] = [0, 0, 0, 0, 0, 0, 0]; }); });
  I.people.forEach(p => dates.forEach((dt, d) => {
    const v = cells[p.key] && cells[p.key][dt], x = rbParse(v);
    if (!x) return;
    const g = (x.note && byShort[x.note.split(/\s+/)[0].toLowerCase()]) || p.group, s = `${x.from} - ${x.to}`;
    if (out[g] && out[g][s]) out[g][s][d]++;
  }));
  return out;
}

/** What is wrong with a roster: short cover, too little rest, too many days in a row, no day off. */
function rbProblems(I, cells, cover) {
  const dates = Array.from({ length: 7 }, (_, d) => roAdd(I.week, d)), out = [];
  const R = Object.assign({ minRest: 11, maxRun: 12 }, I.rules || {});
  cover = cover || rbCover(I, cells);
  Object.keys(I.groups).forEach(g => I.groups[g].shifts.forEach(s => dates.forEach((dt, d) => {
    const n = (I.groups[g].need[s] || [])[d] || 0, h = cover[g][s][d];
    if (h < n) out.push({ kind: 'short', group: g, shift: s, date: dt, need: n, have: h });
  })));
  I.people.forEach(p => {
    let run = p.run || 0, prev = p.lastShift || '';
    dates.forEach((dt, d) => {
      const v = cells[p.key][dt] || '';
      if (rbParse(v)) {
        run++;
        if (prev && rbParse(prev) && rbRest(prev, v) < R.minRest) out.push({ kind: 'rest', key: p.key, date: dt, hours: rbRest(prev, v), from: prev, to: v });
        if (run === R.maxRun + 1) out.push({ kind: 'run', key: p.key, date: dt, days: run });
      } else if (v) run = 0;
      prev = v;
    });
    const offs = dates.filter(dt => rbKind(cells[p.key][dt]) === 'off').length;
    if (offs < (p.offs == null ? 1 : p.offs)) out.push({ kind: 'offs', key: p.key, have: offs, need: p.offs == null ? 1 : p.offs });
  });
  return out;
}

// ── Learning from the rosters already saved ───────────────
function rbHistory(week, n) {
  const out = [];
  for (let i = 1, w = roAdd(week, -7); i <= 12 && out.length < (n || 6); i++, w = roAdd(w, -7)) {
    if ([0, 1, 2, 3, 4, 5, 6].some(d => Object.keys(roDays[roAdd(w, d)] || {}).length)) out.push(w);
  }
  return out;
}
const _rbMed = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
/** The shifts a hotel runs and the cover each one needs on each weekday, from past weeks. */
function rbLearnGroup(group, week) {
  const weeks = rbHistory(week);
  const counts = {};                     // code → weekday → [per week]
  const groupOf = {}; Object.entries(roStaff).forEach(([k, s]) => { groupOf[k] = (s && s.group) || ''; });
  const shorts = {}; Object.values(groupOf).forEach(g => { if (g) shorts[rbShort(g).toLowerCase()] = g; });
  const tally = [];
  weeks.forEach(w => { for (let d = 0; d < 7; d++) {
    const c = {};
    Object.entries(roDays[roAdd(w, d)] || {}).forEach(([k, v]) => {
      const x = rbParse(v); if (!x) return;
      const g = (x.note && shorts[x.note.split(/\s+/)[0].toLowerCase()]) || groupOf[k] || '';
      if (g !== group) return;
      const s = `${x.from} - ${x.to}`; c[s] = (c[s] || 0) + 1;
    });
    tally.push({ d, c });
  } });
  tally.forEach(({ c }) => Object.keys(c).forEach(s => { counts[s] = counts[s] || [[], [], [], [], [], [], []]; }));
  tally.forEach(({ d, c }) => Object.keys(counts).forEach(s => counts[s][d].push(c[s] || 0)));
  const shifts = Object.keys(counts).sort((a, b) => rbMin(a) - rbMin(b));
  const need = {};
  shifts.forEach(s => {
    if (weeks.length >= 3) { need[s] = counts[s].map(_rbMed); return; }
    // one or two weeks say little about each weekday (that week's leave and offs are in it): use a typical day
    const all = [].concat(...counts[s]), avg = all.reduce((a, b) => a + b, 0) / Math.max(1, all.length);
    need[s] = Array(7).fill(Math.round(avg));
  });
  return { shifts, need, weeks: weeks.length };
}
/** Someone's usual shift, days off a week, and how last week ended. */
function rbLearnPerson(key, week) {
  const weeks = rbHistory(week, 4), seen = {};
  let samples = 0; const offsPerWeek = [];
  weeks.forEach(w => { let offs = 0, any = false; for (let d = 0; d < 7; d++) { const v = (roDays[roAdd(w, d)] || {})[key]; if (!v) continue; any = true; const n = rbNorm(v); if (n) { seen[n] = (seen[n] || 0) + 1; samples++; } else if (rbKind(v) === 'off') offs++; } if (any) offsPerWeek.push(offs); });
  const usual = Object.keys(seen).sort((a, b) => seen[b] - seen[a])[0] || '';
  const share = usual ? seen[usual] / samples : 0;
  let run = 0;
  for (let i = 1; i <= 14; i++) { const v = (roDays[roAdd(week, -i)] || {})[key]; if (rbParse(v)) run++; else break; }
  const last = roAdd(week, -7), lastOffs = [];
  for (let d = 0; d < 7; d++) if (rbKind((roDays[roAdd(last, d)] || {})[key]) === 'off') lastOffs.push(d);
  return { usual, fixedGuess: samples >= 5 && share >= 0.85 ? usual : '', offs: offsPerWeek.length ? Math.max(1, _rbMed(offsPerWeek)) : 1, lastShift: (roDays[roAdd(week, -1)] || {})[key] || '', run, lastOffs, lastWeekendOff: lastOffs.some(d => d >= 4) };
}
/** Public holidays: the ones entered, plus any named in PH cells ("PH - 28th Aug."). */
function rbHolidays() {
  const out = {};
  ((rbSettings.holidays) || []).forEach(h => { if (h && h.date) out[h.date] = h.name || ''; });
  Object.entries(roDays).forEach(([dt, day]) => Object.values(day || {}).forEach(v => {
    const m = String(v).match(/^PH\s*[-–:]?\s*(\d{1,2})(?:st|nd|rd|th)?\s*([A-Za-z]{3})/i);
    if (!m) return;
    const iso = roParseDate(`${m[1]} ${m[2]}`, dt);
    if (iso && iso <= dt && !out[iso]) out[iso] = '';
  }));
  return out;
}
function rbPhLabel(iso) { const d = roDate(iso), n = d.getDate(), suf = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'; return `${n}${suf} ${d.toLocaleDateString('en-GB', { month: 'short' })}.`; }
/** PH days someone is owed: public holidays they worked, minus PH days already given, plus any set by hand. */
function rbPhOwed(key) {
  const hol = rbHolidays(), worked = Object.keys(hol).filter(dt => dt <= roToday() && rbParse((roDays[dt] || {})[key])).sort();
  let taken = 0; Object.values(roDays).forEach(day => { if (/^PH\b/i.test(String((day || {})[key] || ''))) taken++; });
  const adj = +(((rbPeople[key]) || {}).phAdj) || 0;
  const owed = Math.max(0, worked.length - taken + adj);
  const next = worked[taken];
  return { owed, label: next ? rbPhLabel(next) : '' };
}

// ── State ─────────────────────────────────────────────────
let rbSettings = {}, rbPeople = {}, rbReqs = {}, rbDrafts = {};
let rbWeek = null, rbGroup = null, rbOut = null, rbSeed = 1;
const RB_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function rbRules() { return Object.assign({ minRest: 11, maxRun: 12, givePh: true, lend: true }, rbSettings.rules || {}); }
function rbGroups() { const g = roGroups(); return g.length ? g : ['']; }
function rbMembers(g) { return Object.keys(roStaff).filter(k => ((roStaff[k] || {}).group || '') === g && !((rbPeople[k] || {}).inactive)).sort((a, b) => ((roStaff[a].order ?? 999) - (roStaff[b].order ?? 999)) || roStaff[a].name.localeCompare(roStaff[b].name)); }
/** Cover needed for a hotel: what was set by hand, else what past rosters show. */
function rbGroupCfg(g) {
  const set = ((rbSettings.groups || {})[g.replace(/[.#$\[\]\/]/g, '_')]) || null;
  if (set && set.shifts && set.shifts.length) return { shifts: set.shifts.slice(), need: Object.assign({}, set.need), set: true };
  const L = rbLearnGroup(g, rbWeek);
  if (!L.shifts.length) return { shifts: ['07:00 - 15:00', '15:00 - 23:00', '23:00 - 07:00'], need: { '07:00 - 15:00': [1, 1, 1, 1, 1, 1, 1], '15:00 - 23:00': [1, 1, 1, 1, 1, 1, 1], '23:00 - 07:00': [1, 1, 1, 1, 1, 1, 1] }, set: false, guess: true };
  return Object.assign(L, { set: false });
}
function rbPersonCfg(k) {
  const L = rbLearnPerson(k, rbWeek), c = rbPeople[k] || {};
  return {
    key: k, group: (roStaff[k] || {}).group || '',
    offs: c.offs != null ? +c.offs : L.offs,
    fixed: c.fixed === undefined ? L.fixedGuess : c.fixed, fixedLearned: c.fixed === undefined && !!L.fixedGuess,
    usual: L.usual, allowed: c.allowed || null, prefOff: c.prefOff || [],
    lastShift: L.lastShift, run: L.run, lastOffs: L.lastOffs, lastWeekendOff: L.lastWeekendOff,
  };
}
/** Requests for the week → cells fixed before building, and shifts to avoid. */
function rbPre() {
  const pre = {}, avoid = {}, dates = Array.from({ length: 7 }, (_, d) => roAdd(rbWeek, d));
  Object.values(rbReqs[rbWeek] || {}).forEach(r => {
    if (!r || !r.key) return;
    dates.filter(dt => dt >= r.from && dt <= (r.to || r.from)).forEach(dt => {
      if (r.type === 'avoid') { ((avoid[r.key] = avoid[r.key] || {})[dt] = (avoid[r.key][dt] || [])).push(r.code); return; }
      const v = r.type === 'off' ? 'OFF' : r.type === 'shift' ? r.code : r.type === 'ph' ? (r.code ? `PH - ${r.code}` : 'PH') : (r.code || 'AL');
      (pre[r.key] = pre[r.key] || {})[dt] = v;
    });
  });
  return { pre, avoid };
}
function rbInput(seed) {
  const groups = {}, people = [];
  rbGroups().forEach(g => {
    const c = rbGroupCfg(g); groups[g] = { shifts: c.shifts, need: c.need };
    rbMembers(g).forEach(k => { const p = rbPersonCfg(k); const ph = rbPhOwed(k); p.phOwed = ph.owed; p.phLabel = ph.label; people.push(p); });
  });
  const { pre, avoid } = rbPre();
  return { week: rbWeek, groups, people, pre, avoid, rules: rbRules(), seed: seed || 1 };
}

// ── Building ──────────────────────────────────────────────
function rbBuild(again) {
  if (!roCanEdit()) { showToast('Only supervisors, managers and owners can build the roster', 'err'); return; }
  if (!Object.keys(roStaff).length) { showToast('Add one roster first (picture or Excel), so the builder knows the team', 'warn'); return; }
  const has = rbDrafts[rbWeek] && Object.keys(rbDrafts[rbWeek].cells || {}).length;
  if (has && !again && !confirm('Build the week again? Changes you made to the draft are replaced.')) return;
  rbSeed = again ? (rbSeed * 7 + 13) % 100000 : 1;
  const out = document.getElementById('rbOut');
  if (out) { out.innerHTML = '<div class="ri-reading"><span class="ri-spin"></span><div><b>Building the roster…</b><small>Trying several ways and keeping the one that covers every shift and keeps every rule.</small></div></div>'; out.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  setTimeout(() => _rbBuildNow(), 60);
}
function _rbBuildNow() {
  const I = rbInput(rbSeed);
  const res = rbSolve(I);
  rbDrafts[rbWeek] = { cells: res.cells, at: Date.now(), by: (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || '' };
  rbSaveDraft();
  rbRender();
  const short = res.problems.filter(p => p.kind === 'short').length;
  showToast(short ? `Roster built: ${short} gap${short === 1 ? '' : 's'} in cover to look at` : 'Roster built: every shift is covered', short ? 'warn' : 'ok');
  setTimeout(() => document.getElementById('rbOut')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
}
function rbSaveDraft() {
  clearTimeout(rbSaveDraft._t);
  rbSaveDraft._t = setTimeout(() => fbSet('roster/builder/drafts/' + rbWeek, rbDrafts[rbWeek] || null), 400);
}

// ── Screen ────────────────────────────────────────────────
function rbOpen() { showPanel('roster-build'); }
function rbDefaultWeek() { const t = new Date(), w = roMonday(t); return [0, 4, 5, 6].includes(t.getDay()) ? roAdd(w, 7) : roAdd(w, 7); }
function rbGo(n) { rbWeek = n === 0 ? rbDefaultWeek() : roAdd(rbWeek, n); rbRender(); }
function rbWeekLabel(w) { return `${roDate(w).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${roDate(roAdd(w, 6)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`; }
const _rbQ = s => JSON.stringify(s).replace(/"/g, '&quot;');

function rbRender() {
  const root = document.getElementById('rbRoot');
  if (!root) return;
  if (!rbWeek) rbWeek = rbDefaultWeek();
  if (!roCanEdit()) { root.innerHTML = `<div class="page-hd"><div class="page-hd-left"><h1>Roster builder</h1><p>Supervisors, managers and owners build the roster here.</p></div></div>`; return; }
  const groups = rbGroups();
  if (rbGroup == null) rbGroup = (roStaff[roMeKey] || {}).group || '';
  const shown = rbGroup && groups.includes(rbGroup) ? [rbGroup] : groups;
  const dates = Array.from({ length: 7 }, (_, d) => roAdd(rbWeek, d));
  const reqs = Object.entries(rbReqs[rbWeek] || {});
  const draft = rbDrafts[rbWeek];
  root.innerHTML = `
    <div class="page-hd">
      <div class="page-hd-left"><h1>Roster builder</h1><p>Add the week's requests, press Build, check it, publish. It learns the shifts, the cover each hotel needs and everyone's usual pattern from the rosters already in HotelOps.</p></div>
      <div class="page-hd-actions"><button class="btn" onclick="showPanel('roster')">← Roster</button></div>
    </div>
    ${!Object.keys(roStaff).length ? '<div class="ro-warn">The builder needs one roster to learn from. Add this week\'s roster on the Roster page first (picture or Excel).</div>' : ''}
    <div class="card rb-bar">
      <div class="ro-weeknav"><button class="btn sm" onclick="rbGo(-7)">‹</button><b>${escapeHtml(rbWeekLabel(rbWeek))}</b><button class="btn sm" onclick="rbGo(7)">›</button>${rbWeek === rbDefaultWeek() ? '<span class="ro-tag">Next week</span>' : '<button class="btn sm" onclick="rbGo(0)">Next week</button>'}</div>
      ${groups.length > 1 ? `<div class="ro-groups">${['', ...groups].map(g => `<button class="fchip${(rbGroup || '') === g ? ' on' : ''}" onclick="rbGroup=${_rbQ(g)};rbRender()">${escapeHtml(g || 'All hotels')}</button>`).join('')}</div>` : ''}
    </div>

    <div class="rb-grid">
      <div class="card rb-card">
        <div class="ro-card-hd"><b>📝 Requests this week</b><span>${reqs.length || 'none yet'}</span></div>
        ${reqs.length ? `<div class="rb-reqs">${reqs.sort((a, b) => a[1].from.localeCompare(b[1].from)).map(([id, r]) => `<div class="rb-req"><b>${escapeHtml((roStaff[r.key] || {}).name || r.key)}</b><span>${escapeHtml(rbReqText(r))}</span><button class="ro-x" title="Remove" onclick="rbDelReq('${id}')">✕</button></div>`).join('')}</div>` : '<div class="ro-empty">Day-off requests, leave, PH days, "must work" or "can\'t work" a shift. Everything else the builder decides.</div>'}
        <div class="rb-req-add">
          <select id="rbRqP">${shown.map(g => `<optgroup label="${escapeHtml(g || 'Team')}">${rbMembers(g).map(k => `<option value="${escapeHtml(k)}">${escapeHtml(roStaff[k].name)}</option>`).join('')}</optgroup>`).join('')}</select>
          <select id="rbRqT" onchange="rbReqTypeChange()">
            <option value="off">Day off request</option><option value="leave">Leave (AL, ALA, SL…)</option><option value="ph">PH day (in lieu)</option><option value="shift">Must work a shift</option><option value="avoid">Can't work a shift</option>
          </select>
          <span id="rbRqC"></span>
          <label>From <input type="date" id="rbRqF" value="${dates[0]}" min="${dates[0]}" max="${dates[6]}"></label>
          <label>To <input type="date" id="rbRqTo" value="${dates[0]}" min="${dates[0]}" max="${dates[6]}"></label>
          <button class="btn sm gold" onclick="rbAddReq()">+ Add</button>
        </div>
      </div>

      <details class="card rb-card"${draft ? '' : ' open'}>
        <summary class="ro-card-hd"><b>👥 Cover needed</b><span>people on each shift, each day</span></summary>
        ${shown.map(g => rbNeedHtml(g)).join('')}
      </details>

      <details class="card rb-card">
        <summary class="ro-card-hd"><b>🧑‍💼 Team</b><span>days off, fixed shifts, PH owed</span></summary>
        ${shown.map(g => rbTeamHtml(g)).join('')}
      </details>

      <details class="card rb-card">
        <summary class="ro-card-hd"><b>⚖️ Rules & public holidays</b></summary>
        ${rbRulesHtml()}
      </details>
    </div>

    <div class="rb-go">
      <button class="btn gold rb-big" onclick="rbBuild()">✨ ${draft ? 'Build again from scratch' : 'Build the roster'}</button>
      ${draft ? '<button class="btn" onclick="rbBuild(true)">🔀 Try another way</button>' : ''}
      <small>Requests and rules come first; you can change any cell after.</small>
    </div>
    <div id="rbOut">${draft ? rbOutHtml(shown, dates) : ''}</div>`;
  rbReqTypeChange();
}

function rbReqText(r) {
  const d = r.from === (r.to || r.from) ? roDayLbl(r.from) : `${roDayLbl(r.from)} → ${roDayLbl(r.to)}`;
  return `${r.type === 'off' ? 'Day off' : r.type === 'leave' ? (r.code || 'Leave') : r.type === 'ph' ? 'PH' + (r.code ? ' (' + r.code + ')' : '') : r.type === 'shift' ? 'Works ' + r.code : 'Not ' + r.code} · ${d}`;
}
function rbReqTypeChange() {
  const t = document.getElementById('rbRqT')?.value, box = document.getElementById('rbRqC');
  if (!box) return;
  const k = document.getElementById('rbRqP')?.value, g = (roStaff[k] || {}).group || '';
  const shifts = rbGroupCfg(g).shifts;
  const leave = Object.entries(roAllCodes()).filter(([, v]) => v.type === 'leave' && !/^PH$/.test('')).map(([c]) => c).filter(c => c !== 'PH');
  box.innerHTML = t === 'leave' ? `<select id="rbRqCode">${leave.map(c => `<option${c === 'AL' ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select>`
    : t === 'shift' || t === 'avoid' ? `<select id="rbRqCode">${shifts.map(s => `<option>${escapeHtml(s)}</option>`).join('')}</select>`
    : t === 'ph' ? `<input id="rbRqCode" placeholder="for (e.g. 28th Aug.)" value="${escapeHtml(rbPhOwed(k).label)}">` : '';
}
function rbAddReq() {
  const r = { key: document.getElementById('rbRqP').value, type: document.getElementById('rbRqT').value, from: document.getElementById('rbRqF').value, to: document.getElementById('rbRqTo').value, code: (document.getElementById('rbRqCode') || {}).value || '' };
  if (!r.key || !r.from) return;
  if (r.to < r.from) r.to = r.from;
  const id = 'q' + Date.now().toString(36);
  (rbReqs[rbWeek] = rbReqs[rbWeek] || {})[id] = r;
  fbSet(`roster/builder/requests/${rbWeek}/${id}`, r);
  rbRender();
}
function rbDelReq(id) { if (rbReqs[rbWeek]) delete rbReqs[rbWeek][id]; fbSet(`roster/builder/requests/${rbWeek}/${id}`, null); rbRender(); }

function rbNeedHtml(g) {
  const c = rbGroupCfg(g), gk = g.replace(/[.#$\[\]\/]/g, '_');
  return `<div class="rb-need"><div class="rb-sub">${escapeHtml(g || 'Team')} <small>${c.set ? 'set by hand' : c.guess ? 'a first guess: set it' : `learned from ${c.weeks} week${c.weeks === 1 ? '' : 's'}`}</small></div>
    <div class="ro-scroll"><table class="ro-table rb-need-t"><thead><tr><th class="ro-name">Shift</th>${RB_DAYS.map(d => `<th>${d}</th>`).join('')}<th></th></tr></thead><tbody>
    ${c.shifts.map(s => { const i = roInfo(s); return `<tr><td class="ro-name ro-t-${i ? i.type : 'other'}"><b>${escapeHtml(s)}</b></td>${(c.need[s] || [0, 0, 0, 0, 0, 0, 0]).map((n, d) => `<td><input type="number" min="0" max="20" value="${n}" onchange="rbSetNeed(${_rbQ(g)},${_rbQ(s)},${d},this.value)"></td>`).join('')}<td><button class="ro-x" title="Remove shift" onclick="rbDelShift(${_rbQ(g)},${_rbQ(s)})">✕</button></td></tr>`; }).join('')}
    </tbody></table></div>
    <div class="rb-inline"><input id="rbNs_${escapeHtml(gk)}" placeholder="Add a shift, e.g. 07:00 - 16:00"><button class="btn sm" onclick="rbAddShift(${_rbQ(g)})">+ Shift</button>${c.set ? `<button class="btn sm" onclick="rbResetNeed(${_rbQ(g)})">↺ Learn again</button>` : ''}</div></div>`;
}
function _rbSetGroup(g, c) { const gk = g.replace(/[.#$\[\]\/]/g, '_'); rbSettings.groups = Object.assign({}, rbSettings.groups, { [gk]: { shifts: c.shifts, need: c.need } }); fbSet('roster/builder/settings/groups/' + gk, rbSettings.groups[gk]); }
function rbSetNeed(g, s, d, v) { const c = rbGroupCfg(g); c.need[s] = (c.need[s] || [0, 0, 0, 0, 0, 0, 0]).slice(); c.need[s][d] = Math.max(0, +v || 0); _rbSetGroup(g, c); rbRefreshOut(); }
function rbAddShift(g) {
  const inp = document.getElementById('rbNs_' + g.replace(/[.#$\[\]\/]/g, '_')), s = rbNorm(inp.value);
  if (!s) { showToast('Write the hours like 07:00 - 16:00', 'warn'); return; }
  const c = rbGroupCfg(g); if (!c.shifts.includes(s)) { c.shifts.push(s); c.shifts.sort((a, b) => rbMin(a) - rbMin(b)); c.need[s] = [1, 1, 1, 1, 1, 1, 1]; }
  _rbSetGroup(g, c); rbRender();
}
function rbDelShift(g, s) { const c = rbGroupCfg(g); c.shifts = c.shifts.filter(x => x !== s); delete c.need[s]; _rbSetGroup(g, c); rbRender(); }
function rbResetNeed(g) { const gk = g.replace(/[.#$\[\]\/]/g, '_'); if (rbSettings.groups) delete rbSettings.groups[gk]; fbSet('roster/builder/settings/groups/' + gk, null); rbRender(); }

function rbTeamHtml(g) {
  const shifts = rbGroupCfg(g).shifts;
  return `<div class="rb-sub">${escapeHtml(g || 'Team')}</div><div class="rb-team">${rbMembers(g).map(k => {
    const p = rbPersonCfg(k), ph = rbPhOwed(k), c = rbPeople[k] || {}, q = _rbQ(k);
    return `<div class="rb-person">
      <b>${escapeHtml(roStaff[k].name)}</b>
      <label>Days off <select onchange="rbSetPerson(${q},'offs',+this.value)">${[0, 1, 2, 3].map(n => `<option${n === p.offs ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Shift <select onchange="rbSetPerson(${q},'fixed',this.value==='~'?undefined:this.value)"><option value="~"${c.fixed === undefined ? ' selected' : ''}>${p.fixedLearned ? 'Always ' + escapeHtml(p.fixed) + ' (learned)' : 'Any (rotates)'}</option><option value=""${c.fixed === '' ? ' selected' : ''}>Any shift</option>${shifts.map(s => `<option value="${escapeHtml(s)}"${c.fixed === s ? ' selected' : ''}>Always ${escapeHtml(s)}</option>`).join('')}</select></label>
      <label>Prefers off <select onchange="rbSetPerson(${q},'prefOff',this.value===''?[]:[+this.value])"><option value="">no preference</option>${RB_DAYS.map((d, i) => `<option value="${i}"${(p.prefOff || []).includes(i) ? ' selected' : ''}>${d}</option>`).join('')}</select></label>
      <label>PH owed <input type="number" min="0" max="30" value="${ph.owed}" onchange="rbSetPh(${q},+this.value)" title="Public holidays worked and not yet given back${ph.label ? ' (next: ' + escapeHtml(ph.label) + ')' : ''}"></label>
      <label class="rb-chk"><input type="checkbox" ${c.inactive ? '' : 'checked'} onchange="rbSetPerson(${q},'inactive',!this.checked)"> on the roster</label>
    </div>`; }).join('') || '<div class="ro-empty">Nobody in this hotel yet.</div>'}</div>`;
}
function rbSetPerson(k, f, v) { const c = Object.assign({}, rbPeople[k]); if (v === undefined) delete c[f]; else c[f] = v; rbPeople[k] = c; fbSet('roster/builder/people/' + k, c); if (f === 'inactive') rbRender(); }
function rbSetPh(k, v) { const base = rbPhOwed(k).owed - (+((rbPeople[k] || {}).phAdj) || 0); rbSetPerson(k, 'phAdj', v - base); }

function rbRulesHtml() {
  const R = rbRules(), hol = rbSettings.holidays || [];
  return `<div class="rb-rules">
    <label>Rest between shifts, at least <input type="number" min="6" max="16" value="${R.minRest}" onchange="rbSetRule('minRest',+this.value)"> hours</label>
    <label>Days in a row, at most <input type="number" min="3" max="14" value="${R.maxRun}" onchange="rbSetRule('maxRun',+this.value)"></label>
    <label class="rb-chk"><input type="checkbox" ${R.givePh ? 'checked' : ''} onchange="rbSetRule('givePh',this.checked)"> Give PH days owed when a shift has someone spare</label>
    <label class="rb-chk"><input type="checkbox" ${R.lend ? 'checked' : ''} onchange="rbSetRule('lend',this.checked)"> A hotel that is short borrows from another hotel ("12:00 - 21:00 - Adagio")</label>
    <div class="rb-sub">Public holidays <small>working one earns a PH day; PH cells in past rosters are counted too</small></div>
    <div class="rb-hols">${hol.map((h, i) => `<span class="rb-hol">${escapeHtml(roDayLbl(h.date, true))}${h.name ? ' · ' + escapeHtml(h.name) : ''}<button class="ro-x" onclick="rbDelHol(${i})">✕</button></span>`).join('') || '<span class="ro-empty">None added yet.</span>'}</div>
    <div class="rb-inline"><input type="date" id="rbHd"><input id="rbHn" placeholder="Name, e.g. National Day"><button class="btn sm" onclick="rbAddHol()">+ Holiday</button></div>
  </div>`;
}
function rbSetRule(k, v) { rbSettings.rules = Object.assign({}, rbSettings.rules, { [k]: v }); fbSet('roster/builder/settings/rules', rbSettings.rules); rbRefreshOut(); }
function rbAddHol() { const d = document.getElementById('rbHd').value; if (!d) return; const h = (rbSettings.holidays || []).concat([{ date: d, name: document.getElementById('rbHn').value.trim() }]).sort((a, b) => a.date.localeCompare(b.date)); rbSettings.holidays = h; fbSet('roster/builder/settings/holidays', h); rbRender(); }
function rbDelHol(i) { const h = (rbSettings.holidays || []).slice(); h.splice(i, 1); rbSettings.holidays = h; fbSet('roster/builder/settings/holidays', h); rbRender(); }

// ── The draft: table, cover, problems ─────────────────────
function rbOutHtml(shown, dates) {
  const I = rbInput(rbSeed), cells = rbDrafts[rbWeek].cells || {};
  I.people.forEach(p => { cells[p.key] = cells[p.key] || {}; });
  const cover = rbCover(I, cells), probs = rbProblems(I, cells, cover);
  const name = k => (roStaff[k] || {}).name || k;
  const today = roToday();
  const rows = shown.map(g => `${shown.length > 1 || g ? `<tr class="ro-sec"><td colspan="8"><span>${escapeHtml(g || 'Team')}</span></td></tr>` : ''}${rbMembers(g).map(k => `<tr><td class="ro-name" title="${escapeHtml(name(k))}">${escapeHtml(name(k))}</td>${dates.map(dt => { const v = cells[k][dt] || '', i = roInfo(v); const bad = probs.some(p => p.key === k && p.date === dt); return `<td class="ro-cell ${i ? 'ro-t-' + i.type : ''}${bad ? ' ro-unsure' : ''}${dt === today ? ' ro-today' : ''}" onclick="rbPick(this,${_rbQ(k)},'${dt}')" title="${escapeHtml(v || 'empty')}: tap to change">${escapeHtml(roCellTxt(i)) || '·'}${i && i.note ? `<i class="ro-note">${escapeHtml(i.note)}</i>` : ''}</td>`; }).join('')}</tr>`).join('')}`).join('');
  const covers = shown.map(g => { const G = I.groups[g]; if (!G) return ''; return `<div class="rb-sub">${escapeHtml(g || 'Team')} · cover</div><div class="ro-scroll"><table class="ro-table rb-cover"><thead><tr><th class="ro-name">Shift</th>${dates.map(dt => `<th>${escapeHtml(roDayLbl(dt))}</th>`).join('')}</tr></thead><tbody>${G.shifts.map(s => `<tr><td class="ro-name">${escapeHtml(s)}</td>${dates.map((dt, d) => { const n = (G.need[s] || [])[d] || 0, h = cover[g][s][d]; return `<td class="${h < n ? 'rb-short' : h > n ? 'rb-over' : 'rb-ok'}">${h}/${n}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`; }).join('');
  const inShown = p => !p.group || shown.includes(p.group) || (p.key && shown.includes((roStaff[p.key] || {}).group || ''));
  const P = probs.filter(inShown);
  const ptxt = p => p.kind === 'short' ? `${escapeHtml(roDayLbl(p.date))} · ${escapeHtml(p.shift)}${shown.length > 1 ? ' · ' + escapeHtml(p.group) : ''}: needs ${p.need}, has ${p.have}`
    : p.kind === 'rest' ? `${escapeHtml(name(p.key))}: only ${Math.round(p.hours)} h rest before ${escapeHtml(roDayLbl(p.date))} (${escapeHtml(p.from)} → ${escapeHtml(p.to)})`
    : p.kind === 'run' ? `${escapeHtml(name(p.key))}: ${p.days} days in a row by ${escapeHtml(roDayLbl(p.date))}`
    : `${escapeHtml(name(p.key))}: ${p.have} day${p.have === 1 ? '' : 's'} off (should have ${p.need})`;
  return `<div class="card rb-draft">
    <div class="ro-card-hd"><b>📋 Draft roster · ${escapeHtml(rbWeekLabel(rbWeek))}</b><span>built ${escapeHtml(new Date(rbDrafts[rbWeek].at || Date.now()).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }))} · tap a cell to change it</span></div>
    ${P.length ? `<div class="rb-probs">${P.map(p => `<div class="rb-prob ${p.kind}">${p.kind === 'short' ? '⚠' : '⛔'} ${ptxt(p)}</div>`).join('')}</div>` : '<div class="rb-allgood">✓ Every shift is covered, everyone has their days off and enough rest.</div>'}
    <div class="ro-scroll"><table class="ro-table rb-table"><thead><tr><th class="ro-name">Name</th>${dates.map(dt => `<th>${escapeHtml(roDayLbl(dt))}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
    <details class="rb-covers" open><summary>Cover: people on each shift (has / needs)</summary>${covers}</details>
    <div class="ro-acts rb-acts">
      <button class="btn gold" onclick="rbPublish()">📤 Publish to the team</button>
      <button class="btn" onclick="rbSharePic()">🖼 Picture to share</button>
      <button class="btn" onclick="rbCopy(this)">📋 Copy for Excel</button>
      <button class="btn" onclick="rbClearDraft()">🗑 Discard draft</button>
    </div>
  </div>`;
}
function rbRefreshOut() {
  const o = document.getElementById('rbOut');
  if (!o || !rbDrafts[rbWeek]) return;
  const groups = rbGroups(), shown = rbGroup && groups.includes(rbGroup) ? [rbGroup] : groups;
  o.innerHTML = rbOutHtml(shown, Array.from({ length: 7 }, (_, d) => roAdd(rbWeek, d)));
}
function rbClearDraft() { if (!confirm('Discard this draft?')) return; delete rbDrafts[rbWeek]; fbSet('roster/builder/drafts/' + rbWeek, null); rbRender(); }

/** Tap a cell: pick a shift, OFF, leave or PH. */
function rbPick(td, k, dt) {
  document.getElementById('rbMenu')?.remove();
  const g = (roStaff[k] || {}).group || '', shifts = rbGroupCfg(g).shifts;
  const others = rbGroups().filter(x => x !== g);
  const leave = Object.entries(roAllCodes()).filter(([c, v]) => v.type === 'leave' && c !== 'PH').map(([c]) => c);
  const cur = (rbDrafts[rbWeek].cells[k] || {})[dt] || '';
  const opt = (v, label, cls) => `<button class="rb-opt ${cls || ''}${v === cur ? ' on' : ''}" onclick="rbSetCell(${_rbQ(k)},'${dt}',${_rbQ(v)})">${escapeHtml(label || v)}</button>`;
  const m = document.createElement('div');
  m.id = 'rbMenu'; m.className = 'rb-menu';
  m.innerHTML = `<div class="rb-menu-hd"><b>${escapeHtml((roStaff[k] || {}).name || k)}</b><span>${escapeHtml(roDayLbl(dt, true))}</span></div>
    <div class="rb-opts">${shifts.map(s => opt(s, s, 'ro-t-' + ((roInfo(s) || {}).type || 'other'))).join('')}</div>
    <div class="rb-opts">${opt('OFF', 'OFF', 'ro-t-off')}${opt(rbPhOwed(k).label ? 'PH - ' + rbPhOwed(k).label : 'PH', 'PH', 'ro-t-leave')}${leave.slice(0, 8).map(c => opt(c, c, 'ro-t-leave')).join('')}</div>
    ${others.length ? `<div class="rb-opts"><small>Lend to another hotel:</small>${others.map(o => shifts.map(s => opt(`${s} - ${rbShort(o)}`, `${s.slice(0, 5)}… at ${rbShort(o)}`, 'ro-t-other')).join('')).join('')}</div>` : ''}
    <div class="rb-inline"><input id="rbOther" placeholder="Other (e.g. TRN, 10:00 - 19:00)" value=""><button class="btn sm" onclick="rbSetCell(${_rbQ(k)},'${dt}',document.getElementById('rbOther').value)">Set</button><button class="btn sm" onclick="rbSetCell(${_rbQ(k)},'${dt}','')">Clear</button></div>`;
  document.body.appendChild(m);
  const r = td.getBoundingClientRect(), mw = Math.min(340, window.innerWidth - 16);
  m.style.width = mw + 'px';
  m.style.left = Math.max(8, Math.min(window.innerWidth - mw - 8, r.left + r.width / 2 - mw / 2)) + 'px';
  const top = r.bottom + 6, h = m.offsetHeight;
  m.style.top = (top + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : top) + 'px';
  setTimeout(() => document.addEventListener('click', function close(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('click', close, true); } }, true), 0);
}
function rbSetCell(k, dt, v) {
  v = String(v || '').trim();
  const c = rbDrafts[rbWeek].cells; c[k] = c[k] || {};
  if (v) c[k][dt] = v; else delete c[k][dt];
  document.getElementById('rbMenu')?.remove();
  rbSaveDraft();
  rbRefreshOut();
}

// ── Out: publish, picture, Excel ──────────────────────────
function rbAsRes() {
  const dates = Array.from({ length: 7 }, (_, d) => roAdd(rbWeek, d)), cells = rbDrafts[rbWeek].cells;
  const names = [], out = {}, groups = {}, ids = {};
  rbGroups().forEach(g => rbMembers(g).forEach(k => {
    const s = roStaff[k]; if (!s) return;
    names.push(s.name); out[s.name] = Object.assign({}, cells[k] || {});
    if (g) groups[s.name] = g; if (s.id) ids[s.name] = s.id;
  }));
  return { names, dates, cells: out, groups, ids, by: '🛠 Built in HotelOps' };
}
async function rbPublish() {
  const res = rbAsRes();
  const probs = rbProblems(rbInput(rbSeed), rbDrafts[rbWeek].cells).length;
  if (probs && !confirm(`${probs} problem${probs === 1 ? '' : 's'} still in the draft. Publish anyway?`)) return;
  if (!confirm(`Publish the roster for ${rbWeekLabel(rbWeek)}? It replaces those days for everyone and tells the team.`)) return;
  try { if (typeof riPending !== 'undefined') riPending = { dataUrl: rbPicture().toDataURL('image/jpeg', 0.86) }; } catch (_) {}
  roPreview = res;
  document.getElementById('roPreview') && (document.getElementById('roPreview').innerHTML = '');
  const ok = window.confirm; window.confirm = () => true;   // the questions were asked above
  try { roSavePreview(); } finally { window.confirm = ok; }
  showPanel('roster');
  roWeek = rbWeek; roRender();
}
/** The roster as a picture, laid out like management's (title, dates, hotel bars, coloured cells). */
function rbPicture() {
  const res = rbAsRes(), dates = res.dates;
  const colors = { morning: '#92d050', afternoon: '#f4b084', night: '#ffff00', nightLate: '#00b0f0', off: '#bfbfbf', leave: '#ff4040', ph: '#9bc2e6', other: '#ffffff' };
  const fill = v => { const i = roInfo(v); if (!i) return '#ffffff'; if (/^PH\b/i.test(v)) return colors.ph; if (i.type === 'night') return rbMin(i.from || '00:00') >= 12 * 60 ? colors.nightLate : colors.night; return colors[i.type] || colors.other; };
  const nameW = 260, colW = 128, rowH = 26, x0 = 10, W = x0 * 2 + nameW + colW * 7;
  const groups = []; res.names.forEach(n => { const g = res.groups[n] || ''; let G = groups.find(x => x.g === g); if (!G) groups.push(G = { g, n: [] }); G.n.push(n); });
  const H = 40 + rowH * 2 + groups.reduce((t, G) => t + (G.g || groups.length > 1 ? rowH : 0) + G.n.length * rowH, 0) + 14;
  const c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2;
  const x = c.getContext('2d'); x.scale(2, 2);
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.textBaseline = 'middle'; x.textAlign = 'center';
  x.fillStyle = '#111'; x.font = 'bold 20px Georgia, serif';
  x.fillText(rbSettings.title || `Roster · ${rbWeekLabel(rbWeek)}`, W / 2, 22);
  let y = 40;
  const cell = (cx, cy, w, h, bg, txt, font, color) => { x.fillStyle = bg; x.fillRect(cx, cy, w, h); x.strokeStyle = '#333'; x.lineWidth = 0.8; x.strokeRect(cx, cy, w, h); if (txt) { x.fillStyle = color || '#111'; x.font = font || '12px Calibri, Arial'; x.fillText(txt, cx + w / 2, cy + h / 2, w - 6); } };
  cell(x0, y, nameW, rowH * 2, '#c6efce', 'Employee Name', 'bold 13px Calibri, Arial');
  dates.forEach((dt, d) => { const D = roDate(dt); cell(x0 + nameW + d * colW, y, colW, rowH, '#c6efce', `${D.getDate()}-${D.toLocaleDateString('en-GB', { month: 'short' })}`, 'bold 13px Calibri, Arial'); cell(x0 + nameW + d * colW, y + rowH, colW, rowH, '#c6efce', RB_DAYS[d], 'bold 13px Calibri, Arial'); });
  y += rowH * 2;
  groups.forEach(G => {
    if (G.g || groups.length > 1) { x.fillStyle = '#000'; x.fillRect(x0, y, W - x0 * 2, rowH); x.fillStyle = '#fff'; x.font = 'bold 15px Georgia, serif'; x.textAlign = 'left'; x.fillText(G.g || 'Team', x0 + 12, y + rowH / 2); x.textAlign = 'center'; y += rowH; }
    G.n.forEach(n => {
      x.fillStyle = '#fff'; x.fillRect(x0, y, nameW, rowH); x.strokeStyle = '#333'; x.strokeRect(x0, y, nameW, rowH);
      x.fillStyle = '#111'; x.font = '12px Calibri, Arial'; x.textAlign = 'left'; x.fillText(`${res.ids[n] ? res.ids[n] + ' - ' : ''}${n}`, x0 + 6, y + rowH / 2, nameW - 10); x.textAlign = 'center';
      dates.forEach((dt, d) => { const v = res.cells[n][dt] || ''; cell(x0 + nameW + d * colW, y, colW, rowH, fill(v), v, rbParse(v) || /^OFF$/i.test(v) ? 'bold 12px Calibri, Arial' : '12px Calibri, Arial'); });
      y += rowH;
    });
  });
  return c;
}
function rbSharePic() {
  const c = rbPicture(), name = `Roster ${rbWeekLabel(rbWeek).replace(/[^\w –-]/g, '')}.png`;
  c.toBlob(async b => {
    const f = new File([b], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: 'Roster' }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    if (typeof riView === 'function') riView(c.toDataURL('image/png'));
  }, 'image/png');
}
function rbCopy(btn) {
  const res = rbAsRes(), lines = [['Employee Name', ...res.dates.map(dt => { const D = roDate(dt); return `${D.getDate()}-${D.toLocaleDateString('en-GB', { month: 'short' })}`; })].join('\t'), ['', ...RB_DAYS].join('\t')];
  let last = null;
  res.names.forEach(n => { const g = res.groups[n] || ''; if (g !== last && g) { lines.push(g); last = g; } lines.push([`${res.ids[n] ? res.ids[n] + ' - ' : ''}${n}`, ...res.dates.map(dt => res.cells[n][dt] || '')].join('\t')); });
  copyToClipboard(lines.join('\n'), btn, '📋 Copy for Excel');
}

// ── Start ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (typeof fbListen !== 'function') return;
    const re = () => { if (document.getElementById('panel-roster-build')?.classList.contains('active') && !document.getElementById('rbMenu') && !(document.activeElement && /INPUT|SELECT/.test(document.activeElement.tagName) && document.activeElement.closest('#rbRoot'))) rbRender(); };
    fbListen('roster/builder/settings', v => { rbSettings = v || {}; re(); });
    fbListen('roster/builder/people', v => { rbPeople = v || {}; re(); });
    fbListen('roster/builder/requests', v => { rbReqs = v || {}; re(); });
    fbListen('roster/builder/drafts', v => { rbDrafts = v || {}; re(); });
  }, 1600);
  if (typeof BA_COMMANDS !== 'undefined') BA_COMMANDS.unshift({ re: /^(build|make|create|plan|do)\s+(the\s+|a\s+|next\s+week'?s?\s+|the\s+next\s+)*(roster|rota|schedule)\b/i, ask: true, ex: 'build the roster', does: 'opens the roster builder for next week', run: () => { if (typeof brClose === 'function') brClose(); rbOpen(); return true; } });
});

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
/** What a change of shift costs from one working day to the next: people want the same hours through a run of
 *  working days; changing only after a day off. Earlier hours than the day before (afternoon → morning) is worst. */
// ── On the desk, hour by hour ─────────────────────────────
// "Two in the shift" means two people at the desk at the same time: 08–17 and 12–21 overlap 12:00–17:00.
const RB_DESK_W = 8;   // how much each person-hour short of the desk aim counts: well under cover and rules
const _rbHC = new Map();
/** The whole hours a shift covers: on its own day, and after midnight on the next. */
function rbShiftHours(code) {
  const k = String(code || ''); if (_rbHC.has(k)) return _rbHC.get(k);
  const x = rbParse(k); let r = null;
  if (x) { r = [[], []]; for (let h = 0; h < 48; h++) if (x.s <= h * 60 && x.e >= (h + 1) * 60) r[h < 24 ? 0 : 1].push(h % 24); }
  _rbHC.set(k, r); return r;
}
/** Whether the desk target is on, and the hours it covers. */
function rbDeskOn(R) { return !!R && R.deskMin > 1 && R.deskTo % 24 !== R.deskFrom % 24; }
/** Within the desk hours; "8 to 2" runs past midnight (08:00 – 02:00). */
function rbDeskHour(R, h) { const f = R.deskFrom % 24, t = R.deskTo % 24; return f < t ? h >= f && h < t : h >= f || h < t; }
/** People on the desk each hour, 7 days × 24: count(d, code) says how many work that shift that day;
 *  prev = the shifts of the day before the week (spill past midnight into Monday). */
function rbDeskGrid(shifts, count, prev) {
  const out = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (let d = -1; d < 7; d++) shifts.forEach(sh => {
    const n = d < 0 ? (prev ? prev(sh) : 0) : count(d, sh); if (!n) return;
    const H = rbShiftHours(sh); if (!H) return;
    if (d >= 0) H[0].forEach(h => { out[d][h] += n; });
    if (d + 1 < 7) H[1].forEach(h => { out[d + 1][h] += n; });
  });
  return out;
}
/** Hours (and people-hours) below the desk target in a grid. */
function rbDeskShort(grid, R) {
  let hours = 0, gap = 0;
  if (!rbDeskOn(R)) return { hours, gap };
  grid.forEach(row => row.forEach((c, h) => { if (rbDeskHour(R, h) && c < R.deskMin) { hours++; gap += R.deskMin - c; } }));
  return { hours, gap };
}
/** One hotel's desk grid from a roster (lent people count where they work). */
function rbDesk(I, cells, g) {
  const dates = Array.from({ length: 7 }, (_, d) => roAdd(I.week, d)), G = I.groups[g];
  if (!G) return null;
  const sh = new Set(G.shifts), cnt = Array.from({ length: 7 }, () => ({})), extra = new Set(), prev = {};
  I.people.forEach(p => {
    dates.forEach((dt, d) => {
      const v = cells[p.key] && cells[p.key][dt], x = rbParse(v); if (!x) return;
      const at = rbAt(I, p, x); if (at !== g) return;
      const c = `${x.from} - ${x.to}`; cnt[d][c] = (cnt[d][c] || 0) + 1; if (!sh.has(c)) extra.add(c);
    });
    if (p.group === g && rbParse(p.lastShift)) { const c = rbNorm(p.lastShift); prev[c] = (prev[c] || 0) + 1; if (!sh.has(c)) extra.add(c); }
  });
  return rbDeskGrid([...sh, ...extra], (d, c) => cnt[d][c] || 0, c => prev[c] || 0);
}

function rbChangeCost(prev, next, acrossWeeks) {
  const a = rbParse(prev), b = rbParse(next);
  if (!a || !b) return 0;
  if (rbNorm(prev) === rbNorm(next)) return -15;
  const back = b.s < a.s ? 15 : 0;
  return acrossWeeks ? 8 + back / 2 : 25 + back;   // a new week may start on new hours; mid-run it hurts
}
/** Night shifts (00:00–09:00, 19:00–04:00) and day shifts don't follow each other: a day off comes between. */
function rbIsNight(code) { const p = rbParse(code); return !!p && p.type === 'night'; }
function rbSwitchOk(prev, next, R) {
  if (R && R.nightSwitch === false) return true;
  if (!rbParse(prev) || !rbParse(next) || rbIsNight(prev) === rbIsNight(next)) return true;
  // a day shift (08:00 - 17:00, 12:00 - 21:00…) and a night always need a day off between: never bent.
  // Only an evening (15:00 - 00:00) next to a night may go without one, as a last resort, as past rosters did.
  const day = c => !rbIsNight(c) && rbParse(c).s < 13 * 60;
  if (day(prev) || day(next)) return false;
  return !!(R && R.eveNight);
}
/** "Prefer not" a shift (on their card, or asked for that week): kept off it when there is another way. */
function rbSoftNo(I, p, dt, s) { const c = rbNorm(s) || s; return ((p && p.soft) || []).includes(c) || ((((I.soft || {})[p && p.key] || {})[dt]) || []).includes(c); }
const RB_SOFT_W = 80;   // above steady-hours costs, far below an empty shift: used when it's the only way
const RB_EV_W = 300;    // 📅 a shift that misses their meeting or training: well above wishes, below an empty shift
function rbEvMiss(I, p, dt, s) { const L = (((I.evMiss || {})[p && p.key] || {})[dt]); return !!L && L.includes(rbNorm(s) || s); }
/** The real night: starts around midnight or ends in the morning (00:00 - 09:00), not a late evening (19:00 - 04:00). */
function rbDeepNight(code) { const x = rbParse(code); return !!x && x.type === 'night' && (x.s < 120 || x.e >= 1440 + 360); }
/** Who may work a shift: the titles set for it (e.g. nights: Supervisor, Duty Manager), else everyone. */
function rbMayWork(I, g, p, s) { if (p && (((I.groups || {})[g] || {}).post || '') !== (p.post || '')) return false; const who = (((I.groups || {})[g] || {}).who || {})[rbNorm(s) || s]; return !who || !who.length || who.includes((p && p.title) || ''); }
/** Shift types people ask for: morning, day (morning + 12:00), evening, night. */
const RB_BANDS = {
  morning: { label: 'Morning', test: x => x.type !== 'night' && x.s >= 300 && x.s < 660 },
  day: { label: 'Day (morning + 12:00)', test: x => x.type !== 'night' && x.s >= 300 && x.s < 780 },
  evening: { label: 'Evening', test: x => x.type !== 'night' && x.s >= 720 && x.s < 1080 },
  night: { label: 'Night', test: x => x.type === 'night' },
};
/** The shifts of a hotel in a type (or the exact shift asked for). */
function rbBandShifts(shifts, band) {
  if (RB_BANDS[band]) return shifts.filter(s => { const x = rbParse(s); return x && RB_BANDS[band].test(x); });
  const n = rbNorm(band); return n && shifts.includes(n) ? [n] : [];
}
function rbBandLabel(band) { return RB_BANDS[band] ? RB_BANDS[band].label : band; }
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
// ── Positions with their own shifts (bell boys): rostered like everyone, never front desk cover ──
const RB_POSTS = { 'Bell Boy': 'Bell' };
function rbPost(k) { return RB_POSTS[rbTitle(k)] || ''; }
function rbPGroup(k) { const g = (roStaff[k] || {}).group || '', p = rbPost(k); return p ? `${g} · ${p}` : g; }
function rbBaseGroup(g) { const m = String(g || '').match(/^(.*) · ([^·]+)$/); return m && Object.values(RB_POSTS).includes(m[2]) ? m[1] : String(g || ''); }
/** The word written after a lent shift ("12:00 - 21:00 - Adagio"): the hotel's first word, or its whole name when another hotel starts with the same word. */
function rbShortU(g, all) { const w = rbShort(g).toLowerCase(), hs = (all || rbGroups()).filter(x => x && rbBaseGroup(x) === x); return hs.filter(x => rbShort(x).toLowerCase() === w).length > 1 ? g : rbShort(g); }
/** Which hotel a lent shift's note names: the whole name first, else a first word only one hotel has. */
function rbNoteGroup(note, groups) {
  const n = String(note || '').toLowerCase().trim(); if (!n) return null;
  const hs = groups.filter(x => rbBaseGroup(x) === x);
  const full = hs.filter(x => x && n.startsWith(x.toLowerCase())).sort((a, b) => b.length - a.length)[0]; if (full) return full;
  const w = n.split(/\s+/)[0], one = hs.filter(x => x && rbShort(x).toLowerCase() === w);
  return one.length === 1 ? one[0] : null;
}
/** The cover a shift counts for: the hotel in its note ("12:00 - 21:00 - Adagio") or their own, at their position. */
function rbAt(I, p, x) {
  let h = rbBaseGroup(p.group);
  if (x && x.note) {
    if (!I._nc) I._nc = {};
    const hit = I._nc[x.note] !== undefined ? I._nc[x.note] : (I._nc[x.note] = rbNoteGroup(x.note, Object.keys(I.groups).filter(g => !I.groups[g].post)));
    if (hit) h = hit;
  }
  return p.post ? `${h} · ${p.post}` : h;
}
/** The hotels that moves between hotels touch this week (where people come from and where they go).
 *  Staff stay in their own hotel as much as we can, and when someone has to move it stays between one pair of hotels. */
function rbMoveHotels(I, cells) {
  const out = new Set();
  I.people.forEach(p => Object.values(cells[p.key] || {}).forEach(v => { const x = rbParse(v); if (!x || !x.note) return; const at = rbBaseGroup(rbAt(I, p, x)), home = rbBaseGroup(p.group); if (at !== home) { out.add(at); out.add(home); } }));
  return out;
}

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
  const plan = I.noNightPlan ? null : rbPlanNights(I);
  if (plan) I = Object.assign({}, I, { pre: plan.pre });
  // a few attempts from different starting points; the best week wins
  const R0 = Object.assign({ minRest: 11, maxRun: 12, maxHours: 9, allowOne: true, nightSwitch: true, givePh: true, lend: true, lockMgr: true, mgrMin: 1, deskMin: 2, deskFrom: 8, deskTo: 23 }, I.rules || {});
  const dates0 = Array.from({ length: 7 }, (_, d) => roAdd(I.week, d));
  let best = null, bestSc = Infinity;
  for (let k = 0; k < (I.attempts || 4); k++) {
    const cells = _rbAttempt(I, (I.seed || 1) + k * 7919);
    const sc = Object.keys(I.groups).reduce((t, g) => t + rbScore(I, g, cells, dates0, R0), 0);
    if (sc < bestSc) { bestSc = sc; best = cells; }
  }
  // staff stay in their own hotel as much as we can: an empty shift is first fixed inside the hotel (a day off moved,
  // two people trading); only what's still empty borrows someone from another hotel, then the usual last resorts
  const home = rbRepair(I, _rbFinish(I, best, { lend: false, ph: false }), { homeOnly: true });
  let res = rbRepair(I, _rbFinish(I, home.cells));
  res.notes = ((plan && plan.notes) || []).concat(res.notes || []);
  // covering every shift comes before any wish: a week with an empty shift is tried again without the wishes,
  // and the one that covers more wins (on a tie, the one with the wishes)
  const shorts = r => { try { return rbProblems(I, r.cells).filter(x => x.kind === 'short').length; } catch (_) { return 0; } };
  const hasWishes = I.people.some(p => (p.likes || []).length || (p.prefOff || []).length || p.together || p.steady || p.maxNights != null || p.wishDebt || p.nightExtra || p.wkOffShort);
  if (!I._plain && hasWishes && shorts(res) > 0) {
    const plainPeople = I.people.map(p => Object.assign({}, p, { likes: [], prefOff: [], together: false, steady: false, maxNights: null, wishDebt: 0, nightExtra: 0, wkOffShort: 0 }));
    const alt = rbSolve(Object.assign({}, I, { people: plainPeople, _plain: true, noNightPlan: true, attempts: 2 }));   // (the night plan is already in I.pre)
    if (shorts(alt) < shorts(res)) { alt.notes = ((plan && plan.notes) || []).concat((alt.notes || []).filter(n => !((plan && plan.notes) || []).some(m => m.text === n.text))); res = alt; }
  }
  return res;
}

// ── Nights across the cluster ─────────────────────────────
/** Every hotel needs a Supervisor (or above) on its night. Each hotel's regular night person has a day off, so:
 *  their days off are put on days next to each other, and one Supervisor / Duty Manager does those nights as one
 *  block at the start or end of the week, going wherever needed, with their day off right after (or before) it,
 *  so nobody goes from night to day without a day off. Their own hotel first: moving hotel only when needed. */
function rbPlanNights(I) {
  const dates = Array.from({ length: 7 }, (_, d) => roAdd(I.week, d)), R = Object.assign({ nightSwitch: true, lend: true }, I.rules || {});
  const pre = JSON.parse(JSON.stringify(I.pre || {})), has = (k, d) => !!(pre[k] || {})[dates[d]];
  const hotels = [];
  Object.keys(I.groups).forEach(g => {
    const G = I.groups[g]; if (G.post) return;
    const ns = G.shifts.find(sh => { const x = rbParse(sh); return x && x.type === 'night' && x.s < 120 && ((G.who || {})[sh] || []).length; });
    if (!ns) return;
    const regs = I.people.filter(p => p.group === g && (p.fixed === ns || p.usual === ns) && rbMayWork(I, g, p, ns) && !p.post);
    if (regs.length !== 1 || dates.some((_, d) => ((G.need[ns] || [])[d] || 0) !== 1)) return;   // one regular night person, one a night: the usual case
    hotels.push({ g, ns, reg: regs[0] });
  });
  if (!hotels.length) return null;
  const isReg = new Set(hotels.map(h => h.reg.key));
  const floaters = I.people.filter(p => !isReg.has(p.key) && !p.post && !p.lock && hotels.some(h => rbMayWork(I, h.g, p, h.ns)));
  if (!floaters.length) return null;
  // each regular: the days their day off could go (nothing fixed that day), or none if leave already covers it
  const offOpts = hotels.map(h => {
    const p = h.reg, taken = dates.filter((_, d) => has(p.key, d) && rbKind(pre[p.key][dates[d]]) === 'off').length;
    const due = Math.max(0, rbOffsDue(I, p, dates) - taken);
    const away = dates.map((_, d) => has(p.key, d) && !rbParse(pre[p.key][dates[d]])).map((x, d) => x ? d : -1).filter(d => d >= 0);   // leave, requests: nights to cover anyway
    return { due, away, days: due ? [0, 1, 2, 3, 4, 5, 6].filter(d => !has(p.key, d)) : [null] };
  });
  if (offOpts.some(o => o.due > 1)) return null;
  let best = null;
  const homeOf = p => rbBaseGroup(p.group);
  const tryCombo = offs => {
    // the nights to cover: each regular's day off and leave
    const gaps = [];
    hotels.forEach((h, i) => { const ds = new Set(offOpts[i].away); if (offs[i] != null) ds.add(offs[i]); ds.forEach(d => gaps.push({ i, d })); });
    if (!gaps.length) return;
    const byDay = {}; gaps.forEach(x => { (byDay[x.d] = byDay[x.d] || []).push(x); });
    // blocks for floaters: the first k days or the last k days of the week
    const blocks = f => { const out = [{ days: [] }]; for (let k = 1; k <= 6; k++) { out.push({ days: Array.from({ length: k }, (_, j) => j), off: k, start: true }); out.push({ days: Array.from({ length: k }, (_, j) => 7 - k + j), off: 6 - k }); } return out.filter(b => b.days.every(d => !has(f.key, d)) && (b.off == null || b.off > 6 || b.off < 0 || !has(f.key, b.off)) && (!b.start || !rbParse(f.lastShift) || (rbIsNight(rbNorm(f.lastShift)) || rbParse(f.lastShift).e <= 1440 - 11 * 60 + 0))); };
    const fl = floaters.slice(0, 4), opts = fl.map(blocks);
    const walk = (fi, used, plan, cost) => {
      if (fi === fl.length) {
        if (gaps.some(x => !used.has(x.i + ':' + x.d))) return;
        // preferences: regulars' usual days off, the regulars' requests
        let c = cost;
        { const t = new Set(); plan.forEach(({ f, pick }) => pick.forEach(({ i }) => { if (hotels[i].g !== homeOf(f)) { t.add(hotels[i].g); t.add(homeOf(f)); } })); if (t.size > 2) c += 300 * (t.size - 2); }   // moves stay between one pair of hotels
        offs.forEach((d, i) => { const p = hotels[i].reg; if (d != null && (p.prefOff || []).includes(d)) c -= 3; if (d != null && (p.lastOffs || []).includes(d)) c -= 1; });
        if (!best || c < best.cost) best = { cost: c, offs: offs.slice(), plan: plan.slice() };
        return;
      }
      const f = fl[fi];
      for (const b of opts[fi]) {
        if (!b.days.length) { walk(fi + 1, used, plan, cost); continue; }
        // every night of the block covers a gap that day: their own hotel first
        const pick = [], u2 = new Set(used); let ok = true, c = cost + 4 + (rbFloats(f) ? 0 : 3) * b.days.length;   // a Duty Manager before a Supervisor
        for (const d of b.days) {
          const cand = (byDay[d] || []).filter(x => !u2.has(x.i + ':' + x.d) && rbMayWork(I, hotels[x.i].g, f, hotels[x.i].ns));
          if (!cand.length) { ok = false; break; }
          // their own hotel first, then the hotel they'd rather go to when moved
          const own = cand.find(x => hotels[x.i].g === homeOf(f)) || (f.alt && cand.find(x => rbBaseGroup(hotels[x.i].g) === f.alt)) || cand[0];
          if (hotels[own.i].g !== homeOf(f)) { if (f.home || (!R.lend && !rbFloats(f) && !rbFloatsLast(f))) { ok = false; break; } c += f.alt && rbBaseGroup(hotels[own.i].g) === f.alt ? 50 : 60; }   // working at another hotel: only when there's no way at their own hotel
          u2.add(own.i + ':' + own.d); pick.push({ d, i: own.i });
        }
        if (ok) walk(fi + 1, u2, plan.concat([{ f, b, pick }]), c);
      }
    };
    walk(0, new Set(), [], 0);
  };
  const rec = (i, offs) => { if (i === hotels.length) { tryCombo(offs); return; } for (const d of offOpts[i].days) { if (d != null && offs.includes(d)) continue; rec(i + 1, offs.concat([d])); } };
  rec(0, []);
  if (!best) return null;
  const notes = [];
  best.offs.forEach((d, i) => { if (d != null) (pre[hotels[i].reg.key] = pre[hotels[i].reg.key] || {})[dates[d]] = 'OFF'; });
  best.plan.forEach(({ f, b, pick }) => {
    const row = (pre[f.key] = pre[f.key] || {});
    pick.forEach(({ d, i }) => { const h = hotels[i]; row[dates[d]] = h.g === homeOf(f) ? h.ns : `${h.ns} - ${rbShortU(h.g, Object.keys(I.groups))}`; });
    if (b.off >= 0 && b.off <= 6) row[dates[b.off]] = 'OFF';
    const nm = typeof roStaff !== 'undefined' && roStaff[f.key] ? roStaff[f.key].name.split(' ')[0] : f.key;
    const where = pick.map(({ d, i }) => `${RB_DAYS[d]}${hotels[i].g !== homeOf(f) ? ' at ' + hotels[i].g : ''}`).join(', ');
    notes.push({ key: f.key, date: dates[pick[0].d], plan: true, text: `Nights: ${nm} covers the night supervisor's days off (${where}), ${b.off >= 0 && b.off <= 6 ? (b.start ? 'then their day off ' + RB_DAYS[b.off] : 'with their day off just before, ' + RB_DAYS[b.off]) : ''}${pick.some(({ i }) => hotels[i].g !== homeOf(f)) ? '. Working at another hotel only because nobody there could' : ''}.` });
  });
  return { pre, notes };
}
/** Empty shifts left after building: fill each with the best fix a supervisor would make that keeps every rule
 *  (another hotel's Duty Manager, a day off moved, two people trading), never one that bends a rule. */
function rbRepair(I, res, o) {
  if (I.noRepair || typeof rtCoverOptions !== 'function') return res;
  o = o || {};
  // homeOnly: fixes inside each hotel only (a day off moved, two people trading), nobody sent to another hotel
  const moves = c2 => I.people.some(p => Object.keys(c2[p.key] || {}).some(dt => { const v = c2[p.key][dt]; return v !== (res.cells[p.key] || {})[dt] && rbParse(v) && rbParse(v).note; }));
  let cells = res.cells, guard = 0;
  const shorts = c => rbProblems(I, c).filter(p => p.kind === 'short');
  const breaks = c => rbProblems(I, c).filter(p => p.kind !== 'short' && p.kind !== 'thin').length;
  for (let gaps = shorts(cells); gaps.length && guard < 12; guard++) {
    const before = breaks(cells); let done = false;
    for (const g of gaps) {
      const opts = rtCoverOptions(Object.assign({}, I, { noRepair: true }), cells, g.group, g.date, g.shift).filter(x => x.cells && !x.bend && !(o.homeOnly && moves(x.cells)));
      const ok = opts.find(o => shorts(o.cells).length < gaps.length && breaks(o.cells) <= before);
      if (ok) { cells = ok.cells; done = true; break; }
    }
    if (!done) break;
    gaps = shorts(cells);
  }
  // still stuck: every shift has to be covered, so the mildest way past rosters used (evening then late night,
  // night ↔ day without a day off, short rest, back to back), never over 9 h a shift. Each one is written down.
  const notes = [];
  for (let gaps = shorts(cells), n = 0; gaps.length && n < 8 && !I.noBend && !o.homeOnly; n++) {
    let pick = null;
    for (const g of gaps) {
      const o = rtCoverOptions(Object.assign({}, I, { noRepair: true }), cells, g.group, g.date, g.shift).filter(o => o.cells && o.bend && shorts(o.cells).length < gaps.length).sort((a, b) => a.cost - b.cost)[0];
      if (o && (!pick || o.cost < pick.cost)) pick = o;
    }
    if (!pick) break;
    cells = pick.cells; (pick.notes || []).forEach(x => notes.push(Object.assign({ auto: true }, x)));
    gaps = shorts(cells);
  }
  if (cells === res.cells) return res;
  const cover = rbCover(I, cells);
  return { cells, cover, problems: rbProblems(I, cells, cover), notes };
}
function _rbAttempt(I, seed) {
  const D = 7, dates = Array.from({ length: D }, (_, d) => roAdd(I.week, d));
  const rnd = rbRand(seed || 1);
  const R = Object.assign({ minRest: 11, maxRun: 12, maxHours: 9, allowOne: true, nightSwitch: true, givePh: true, lend: true, lockMgr: true, mgrMin: 1, deskMin: 2, deskFrom: 8, deskTo: 23 }, I.rules || {});
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
      let k = Math.max(0, rbOffsDue(I, p, dates) - offsTaken(p));
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
          if (((I.busy || {})[p.key] || {})[dates[d]]) c += 60;   // 📅 a meeting or training that day: not their day off
          if (rbMgrP(p)) { const min = R.mgrMin == null ? 1 : +R.mgrMin, mg = I.people.filter(q => q !== p && rbMgrP(q)); if (min > 0 && mg.length >= min && mg.filter(q => !offOrAway(cells[q.key][dates[d]])).length < min) c += 150; }   // keep a manager on duty every day (one can look after all the hotels)
          if (I.keep && I.keep[p.key] && rbKind(I.keep[p.key][dates[d]]) === 'off') c -= 30;   // keep their day off where it was
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
function _rbFinish(I, cells, o) {
  o = o || {};
  const D = 7, dates = Array.from({ length: D }, (_, d) => roAdd(I.week, d)), G = I.groups;
  const R = Object.assign({ minRest: 11, maxRun: 12, maxHours: 9, allowOne: true, nightSwitch: true, givePh: true, lend: true, lockMgr: true, mgrMin: 1, deskMin: 2, deskFrom: 8, deskTo: 23 }, I.rules || {});
  const need = (g, s, d) => ((G[g] && G[g].need[s]) || [])[d] || 0;
  // 4. a hotel with an empty shift borrows someone on the same shift from a hotel with one spare (staff stay in their own hotel as much as we can)
  let cover = rbCover(I, cells);
  if (o.lend !== false) { // even with lending off, a Duty Manager may go where they're needed
    for (const g of Object.keys(G)) for (let d = 0; d < D; d++) for (const s of G[g].shifts) {
      while (cover[g][s][d] < need(g, s, d)) {
        if (cover[g][s][d] >= 1 && R.allowOne !== false && !R.lendIdeal) break;   // moving someone to another hotel only for an empty shift, not for the ideal second person
        const dt = dates[d];
        const cand = I.people.filter(q => q.group !== g && !q.home && !q.lock && (R.lend || rbFloats(q) || rbFloatsLast(q)) && !((I.pre || {})[q.key] || {})[dt] && G[q.group] && cells[q.key][dt] === s && cover[q.group][s] && cover[q.group][s][d] > need(q.group, s, d) && rbMayWork(I, g, q, s)).sort((a, b) => (rbFloatsLast(a) ? 1 : 0) - (rbFloatsLast(b) ? 1 : 0) || (rbFloats(b) ? 1 : 0) - (rbFloats(a) ? 1 : 0) || (b.alt === rbBaseGroup(g) ? 1 : 0) - (a.alt === rbBaseGroup(g) ? 1 : 0));   // (then whoever would rather come to this hotel)
        const used = rbMoveHotels(I, cells), inPair = q => used.size === 0 || (used.has(rbBaseGroup(g)) && used.has(rbBaseGroup(q.group)) ) || (used.size < 2 && (used.has(rbBaseGroup(g)) || used.has(rbBaseGroup(q.group))));
        const donor = cand.find(inPair) || cand[0];   // one pair of hotels a week; a third hotel only when there's no other way
        if (!donor) break;
        cells[donor.key][dt] = `${s} - ${rbShortU(g, Object.keys(G))}`;
        cover = rbCover(I, cells);
      }
    }
  }
  // 5. PH days owed, only as the last option: when the shift has someone spare anyway. Normally a week has one day off
  //    (4 a month), so 1 person a week per hotel gets one (rules: phPeople, phMax), the biggest balance first,
  //    next to a day off where possible (a longer break), oldest PH first
  if (R.givePh && o.ph !== false) {
    const isPh = v => /^PH\b/i.test(String(v || ''));
    const offish = v => !!v && v !== '—' && !rbParse(v);   // OFF, PH, leave: anything that isn't a shift
    const phMax = R.phMax == null ? 1 : +R.phMax, phPeople = R.phPeople == null ? 1 : +R.phPeople;
    const hasPh = q => dates.some(dt => isPh((cells[q.key] || {})[dt]));
    const phIn = h => I.people.filter(q => rbBaseGroup(q.group) === h && hasPh(q)).length;   // people with a PH this week, in that hotel
    I.people.filter(p => (p.phOwed || 0) > 0).sort((a, b) => (b.phOwed || 0) - (a.phOwed || 0)).forEach(p => {
      if (!hasPh(p) && phIn(rbBaseGroup(p.group)) >= phPeople) return;   // one person a week per hotel (a rule): the biggest balance
      const already = dates.filter(dt => isPh(cells[p.key][dt])).length;   // PH asked for this week
      const labels = (p.phLabels && p.phLabels.length ? p.phLabels : [p.phLabel || '']).slice(already);
      let left = Math.min(p.phOwed - already, phMax - already), n = 0;
      while (left > 0) {
        const cand = [];
        for (let d = 0; d < D; d++) {
          const dt = dates[d], s = cells[p.key][dt];
          if (!s || !G[p.group] || !G[p.group].shifts.includes(s) || ((I.pre || {})[p.key] || {})[dt] || ((I.busy || {})[p.key] || {})[dt]) continue;   // never over a fixed day (requests, days gone by) or a meeting day
          if (!(cover[p.group][s][d] > need(p.group, s, d))) continue;
          const next = offish(cells[p.key][dates[d - 1]]) || offish(cells[p.key][dates[d + 1]]);
          cand.push({ d, c: (next ? 0 : 10) - ((p.prefOff || []).includes(d) ? 5 : 0) + d * 0.1 });
        }
        if (!cand.length) break;
        cand.sort((a, b) => a.c - b.c);
        const lb = labels[n] || '';
        cells[p.key][dates[cand[0].d]] = lb ? `PH - ${lb}` : 'PH';
        cover = rbCover(I, cells); left--; n++;
      }
      if (n > 1) { let i = 0; dates.forEach(dt => { if (isPh(cells[p.key][dt]) && !((I.pre || {})[p.key] || {})[dt]) { const lb = labels[i++] || ''; cells[p.key][dt] = lb ? `PH - ${lb}` : 'PH'; } }); }   // oldest PH on the earliest day
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
  // the first person on a shift is worth the most; with one-person shifts allowed the rest up to the ideal count less
  G.shifts.forEach(s => { for (let k = have[s]; k < (((G.need[s] || [])[d]) || 0); k++) cols.push({ s, req: true, w: k === 0 || R.allowOne === false ? 1000 : 300 }); });
  G.shifts.forEach(s => { for (let k = 0; k < rows.length; k++) cols.push({ s, req: false, k }); });
  const base = (p, s) => {
    if (p.allowed && p.allowed.length && !p.allowed.includes(s)) return BAD;
    if ((((I.avoid || {})[p.key] || {})[dt] || []).includes(s)) return BAD;
    const pv = d === 0 ? p.lastShift || '' : cells[p.key][dates[d - 1]] || '';
    const nx = d < 6 ? cells[p.key][dates[d + 1]] || '' : '';
    if (rbParse(pv) && rbRest(pv, s) < R.minRest) return BAD;
    if (rbParse(nx) && rbRest(s, nx) < R.minRest) return BAD;
    if (!rbSwitchOk(pv, s, R) || !rbSwitchOk(s, nx, R)) return BAD;
    if (!rbMayWork(I, g, p, s)) return BAD;
    if (p.lock && p.fixed && G.shifts.includes(p.fixed) && s !== p.fixed) return BAD;   // 🔒 always their own shift
    const soft = rbSoftNo(I, p, dt, s) ? RB_SOFT_W : 0;
    if ((rbParse(s) || {}).e - (rbParse(s) || {}).s > (R.maxHours || 9) * 60) return BAD;
    let c = soft + (rbEvMiss(I, p, dt, s) ? RB_EV_W : 0);
    if (I.keep && I.keep[p.key] && I.keep[p.key][dt] !== undefined) c += rbNorm(I.keep[p.key][dt]) === s ? -6 : 10;   // change as little as possible
    if (p.fixed) c += s === p.fixed ? -8 : (p.fixedCost || 30);
    if (p.lastMain && p.mode === 'rotate' && s === p.lastMain) c += 6;   // rotates: a different shift from last week
    if (p.mode === 'rotate' && p.nextMain && s === p.nextMain) c -= 5;   // …and the one that usually comes next, as the posted rosters show
    c += rbChangeCost(pv, s, d === 0);
    if (rbParse(nx)) c += rbNorm(nx) === s ? -8 : rbChangeCost(s, nx, false) / 2;
    if (p.usual && s === p.usual && p.mode !== 'rotate') c -= 3;
    if ((p.likes || []).includes(s)) c -= 12 * rbWishWeight(p);   // 💛 a shift they like (more when they missed wishes lately)
    if (d >= 1 && rbIsMorning(s) && rbKind(cells[p.key][dates[d - 1]] || '') === 'off' && rbIsNight(d >= 2 ? cells[p.key][dates[d - 2]] || '' : p.lastShift || '')) c += 45;   // night → day off → morning: only when needed
    if (rbIsNight(s) && p.nightExtra > 0) c += 3 * p.nightExtra;  // more nights than the team lately: someone else's turn
    return c + (rnd ? rnd() * 1.5 : 0);
  };
  const C = rows.map(p => { const b = {}; G.shifts.forEach(s => { b[s] = base(p, s); }); return cols.map(c => b[c.s] >= BAD ? BAD : b[c.s] + (c.req ? -c.w : 2 + c.k * 0.3)); });
  const pick = rbHungarian(C);
  rows.forEach((p, i) => { const j = pick[i]; cells[p.key][dt] = j >= 0 && C[i][j] < BAD ? cols[j].s : 'OFF'; });   // no shift gives enough rest: a forced rest day
}

/** Days off someone should get this week: fewer if they join or leave mid-week, or are on leave most of it. */
function rbOffsDue(I, p, dates) {
  const want = p.offs == null ? 1 : p.offs, pre = (I.pre || {})[p.key] || {};
  if (dates.some(dt => pre[dt] === '—')) return 0;
  const open = dates.filter(dt => !pre[dt] || rbKind(pre[dt]) === 'off').length;
  return Math.min(want, open);
}
/** How good a week is for one hotel: lower is better. Gaps in cover and broken rules weigh most. */
function rbScore(I, g, cells, dates, R) {
  const G = I.groups[g], P = I.people.filter(p => p.group === g);
  let sc = 0;
  const haveAll = [];
  for (let d = 0; d < 7; d++) {
    const have = haveAll[d] = {}; G.shifts.forEach(s => { have[s] = 0; });
    P.forEach(p => { const v = cells[p.key][dates[d]]; if (have[v] != null) have[v]++; });
    G.shifts.forEach(s => {
      const n = (G.need[s] || [])[d] || 0, h = have[s];
      if (h < n) sc += R.allowOne === false ? 1000 * (n - h) : (h === 0 ? 1000 : 0) + 300 * (n - Math.max(h, 1));   // an empty shift is the worst; one person short of the ideal less so
      else sc += 0.5 * (h - n);
    });
  }
  if (rbDeskOn(R)) sc += RB_DESK_W * rbDeskShort(rbDeskGrid(G.shifts, (d, s) => haveAll[d][s] || 0, s => P.filter(p => rbNorm(p.lastShift) === s).length), R).gap;   // two on the desk at once, when it can be done
  P.forEach(p => {
    let run = p.run || 0, prev = p.lastShift || '', offs = 0, nights = 0;
    const offDays = [];
    for (let d = 0; d < 7; d++) {
      const dt = dates[d], v = cells[p.key][dt] || '';
      if (I.keep && I.keep[p.key] && (I.keep[p.key][dt] || '') !== v) sc += 10;   // each change from the week as it was
      if (rbParse(v)) {
        run++;
        if (run > R.maxRun) sc += 2500;
        if (prev && rbParse(prev) && rbRest(prev, v) < R.minRest) sc += 3000;
        if (!rbSwitchOk(prev, v, R)) sc += 3000;
        if (!rbMayWork(I, g, p, v)) sc += 3000;
        if (p.fixed && rbNorm(v) !== p.fixed) sc += p.lock ? 3000 : p.fixedCost || 30;
        if (p.lastMain && p.mode === 'rotate' && rbNorm(v) === p.lastMain) sc += 6;
        if (p.mode === 'rotate' && p.nextMain && rbNorm(v) === p.nextMain) sc -= 2;
        if (rbParse(v).e - rbParse(v).s > (R.maxHours || 9) * 60) sc += 3000;
        if (p.allowed && p.allowed.length && !p.allowed.includes(v)) sc += 800;
        if (rbSoftNo(I, p, dt, v)) sc += RB_SOFT_W;   // prefers not: only when it's the way to cover
        if (rbEvMiss(I, p, dt, v)) sc += RB_EV_W;   // 📅 misses their meeting or training
        if ((((I.avoid || {})[p.key] || {})[dt] || []).includes(v)) sc += 800;
        if (prev && rbParse(prev) && rbNorm(prev) !== rbNorm(v)) sc += rbChangeCost(prev, v, d === 0) + 15 + (p.steady ? 40 * rbWishWeight(p) : 0);   // a change of shift in a run of working days (💛 steady hours: much more)
        if (p.usual && v === p.usual) sc -= 1;
        if ((p.likes || []).includes(rbNorm(v))) sc -= 6 * rbWishWeight(p);   // 💛 a shift they like
        if (rbIsNight(v)) { nights++; if (p.nightExtra > 0) sc += 3 * p.nightExtra; }   // fair nights: whoever had more lately gets fewer
      } else {
        run = 0;
        if (rbKind(v) === 'off') { offs++; offDays.push(d); if (((I.busy || {})[p.key] || {})[dt]) sc += 60; if ((p.prefOff || []).includes(d)) sc -= 10 * rbWishWeight(p); if (d >= 5 && p.wkOffShort > 0) sc -= 4 * p.wkOffShort; /* fewer weekends off than the team lately: theirs first */ if ((p.learnedOff || []).includes(d)) sc -= 3; /* their usual day off, as the posted rosters show */ if ((p.lastOffs || []).includes(d)) sc -= 1; if (p.lastWeekendOff && d >= 4) sc += 5; }
      }
      prev = v;
    }
    sc += 2000 * Math.abs(offs - rbOffsDue(I, p, dates));   // rest, days in a row and days off come before cover
    sc += 90 * rbNightToMorning(cells, p, dates).length;   // a night, one day off, then a morning: the day off goes on sleep, so only when there's no other way
    if (p.maxNights != null && nights > p.maxNights) sc += 60 * rbWishWeight(p) * (nights - p.maxNights);   // 💛 no more nights than they asked for (unless it's the only way)
    if (p.together && offDays.length >= 2 && !offDays.some((d, i) => i && d - offDays[i - 1] === 1)) sc += 25 * rbWishWeight(p);   // 💛 their days off next to each other
    else if (!p.together && p.learnedTogether && offDays.length >= 2 && !offDays.some((d, i) => i && d - offDays[i - 1] === 1)) sc += 6;   // they usually have them together
  });
  if (P.some(rbMgrP)) sc += 400 * rbMgrGap(I, cells, dates, R);
  if (P.some(p => rbFloats(p) || rbFloatsLast(p))) sc += 500 * rbSeniorClash(I, cells, dates).filter(c => c.hotel === rbBaseGroup(g)).length;   // a Duty Manager and a Supervisor on the same shift: one is enough   // a day with no manager anywhere: below an empty shift, above any wish
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
    // one shift for a whole run of working days, and everyone else re-solved around it
    for (const p of P) {
      const runs = []; let cur = [];
      for (let d = 0; d < 7; d++) { const v = cells[p.key][dates[d]]; if (rbParse(v) && !rbParse(v).note && !locked(p, d)) cur.push(d); else { if (cur.length > 1) runs.push(cur); cur = []; } }
      if (cur.length > 1) runs.push(cur);
      for (const run of runs) {
        if (new Set(run.map(d => cells[p.key][dates[d]])).size < 2) continue;      // already one shift
        for (const sh of G.shifts) {
          const snap = P.map(q => [q.key, run.map(d => cells[q.key][dates[d]])]);
          const pre0 = I.pre; I.pre = Object.assign({}, I.pre, { [p.key]: Object.assign({}, (I.pre || {})[p.key]) });
          if (tryIt(() => { run.forEach(d => { cells[p.key][dates[d]] = sh; I.pre[p.key][dates[d]] = sh; }); run.forEach(d => rbMatchDay(I, g, cells, dates, d, R, null)); I.pre = pre0; },
                    () => { I.pre = pre0; snap.forEach(([k, vs]) => run.forEach((d, i) => { cells[k][dates[d]] = vs[i]; })); })) { improved = true; break; }
        }
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
  Object.keys(I.groups).forEach(g => { out[g] = {}; I.groups[g].shifts.forEach(s => { out[g][s] = [0, 0, 0, 0, 0, 0, 0]; }); });
  I.people.forEach(p => dates.forEach((dt, d) => {
    const v = cells[p.key] && cells[p.key][dt], x = rbParse(v);
    if (!x) return;
    const g = rbAt(I, p, x), s = `${x.from} - ${x.to}`;
    if (out[g] && out[g][s]) out[g][s][d]++;
  }));
  return out;
}

/** What is wrong with a roster: short cover, too little rest, too many days in a row, no day off. */
function rbProblems(I, cells, cover) {
  const dates = Array.from({ length: 7 }, (_, d) => roAdd(I.week, d)), out = [];
  const R = Object.assign({ minRest: 11, maxRun: 12, maxHours: 9, allowOne: true, nightSwitch: true, deskMin: 2, deskFrom: 8, deskTo: 23 }, I.rules || {});
  cover = cover || rbCover(I, cells);
  Object.keys(I.groups).forEach(g => I.groups[g].shifts.forEach(s => dates.forEach((dt, d) => {
    const n = (I.groups[g].need[s] || [])[d] || 0, h = cover[g][s][d];
    if (h < n) out.push({ kind: (h === 0 || R.allowOne === false) && !I.groups[g].post ? 'short' : 'thin', group: g, shift: s, date: dt, need: n, have: h });
  })));
  I.people.forEach(p => {
    let run = p.run || 0, prev = p.lastShift || '';
    dates.forEach((dt, d) => {
      const v = (cells[p.key] || {})[dt] || '';
      if (rbParse(v)) {
        run++;
        if (rbParse(v).e - rbParse(v).s > (R.maxHours || 9) * 60) out.push({ kind: 'long', key: p.key, date: dt, hours: (rbParse(v).e - rbParse(v).s) / 60, code: v });
        if (prev && rbParse(prev) && rbRest(prev, v) < R.minRest) out.push({ kind: 'rest', key: p.key, date: dt, hours: rbRest(prev, v), from: prev, to: v });
        else if (prev && !rbSwitchOk(prev, v, R)) out.push({ kind: 'switch', key: p.key, date: dt, from: prev, to: v });
        { const tg = rbAt(I, p, rbParse(v));
          if (!rbMayWork(I, tg, p, v)) out.push({ kind: 'who', key: p.key, date: dt, code: v, who: ((I.groups[tg] || {}).post || '') !== (p.post || '') ? [p.post ? 'front desk staff (not ' + p.post.toLowerCase() + ')' : 'the ' + ((I.groups[tg] || {}).post || '').toLowerCase() + ' team'] : ((I.groups[tg] || {}).who || {})[rbNorm(v)] }); }
        if (run === R.maxRun + 1) out.push({ kind: 'run', key: p.key, date: dt, days: run });
      } else if (v) run = 0;
      prev = v;
    });
    const offs = dates.filter(dt => rbKind((cells[p.key] || {})[dt]) === 'off').length, due = rbOffsDue(I, p, dates);
    if (offs < due) out.push({ kind: 'offs', key: p.key, have: offs, need: due });
  });
  return out;
}

// ── Learning from the rosters already saved ───────────────
function rbHistory(week, n) {
  const out = [], has = w => [0, 1, 2, 3, 4, 5, 6].some(d => Object.keys(roDays[roAdd(w, d)] || {}).length);
  for (let i = 1, w = roAdd(week, -7); i <= 12 && out.length < (n || 6); i++, w = roAdd(w, -7)) if (has(w)) out.push(w);
  // nothing before it (e.g. checking the first roster ever imported): learn from that week and the ones after
  if (!out.length) for (let i = 0, w = week; i <= 6 && out.length < (n || 6); i++, w = roAdd(w, 7)) if (has(w)) out.push(w);
  return out;
}
const _rbMed = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
/** The shifts a hotel runs and the cover each one needs on each weekday, from past weeks. */
const _rbLGC = new Map();   // asked many times per screen: learned once until the rosters or the team change
function rbLearnGroup(group, week) {
  const ck = group + '|' + week + '|' + _rbLearnStamp() + '|' + Object.keys(roStaff).map(k => (roStaff[k] || {}).group + '/' + rbTitle(k)).join(',');
  if (!_rbLGC.has(ck)) { if (_rbLGC.size > 50) _rbLGC.clear(); _rbLGC.set(ck, JSON.stringify(_rbLearnGroup(group, week))); }
  return JSON.parse(_rbLGC.get(ck));   // a copy: callers may change it
}
function _rbLearnGroup(group, week) {
  const weeks = rbHistory(week);
  const counts = {};                     // code → weekday → [per week]
  const groupOf = {}, postOf = {}; Object.keys(roStaff).forEach(k => { groupOf[k] = rbPGroup(k); postOf[k] = rbPost(k); });
  const hotels = [...new Set(Object.values(roStaff).map(st => (st && st.group) || '').filter(Boolean))];
  const tally = [];
  weeks.forEach(w => { for (let d = 0; d < 7; d++) {
    const c = {};
    Object.entries(roDays[roAdd(w, d)] || {}).forEach(([k, v]) => {
      const x = rbParse(v); if (!x) return;
      const h = x.note && rbNoteGroup(x.note, hotels);
      const g = h ? (postOf[k] ? `${h} · ${postOf[k]}` : h) : groupOf[k] || '';
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
const _rbLearnC = new Map();   // the same week asked again while building: learned once
function rbLearnPerson(key, week) {
  const ck = key + '|' + week + '|' + _rbLearnStamp(); if (_rbLearnC.has(ck)) return _rbLearnC.get(ck);
  const r = _rbLearnPerson(key, week); if (_rbLearnC.size > 600) _rbLearnC.clear(); _rbLearnC.set(ck, r); return r;
}
/** Changes when a roster is posted or edited, so what was learned is read again. */
function _rbLearnStamp() { let n = 0; for (const dt in roDays) n += Object.keys(roDays[dt] || {}).length; return Object.keys(roDays).length + ':' + n; }
/** What the posted rosters say about someone: whoever made them (built here, a picture, Excel, another manager),
 *  the last 8 weeks that have a roster (weeks without one are skipped). Settings on their card always come first. */
function _rbLearnPerson(key, week) {
  const weeks = rbHistory(week, 8), seen = {};
  let samples = 0; const offsPerWeek = [], offDay = [0, 0, 0, 0, 0, 0, 0], mains = []; let weeksSeen = 0, pairWeeks = 0, togetherWeeks = 0;
  weeks.slice().reverse().forEach(w => {   // oldest first
    let offs = 0, any = false; const wk = {}, od = [];
    for (let d = 0; d < 7; d++) { const v = (roDays[roAdd(w, d)] || {})[key]; if (!v) continue; any = true; const n = rbNorm(v); if (n) { seen[n] = (seen[n] || 0) + 1; samples++; wk[n] = (wk[n] || 0) + 1; } else if (rbKind(v) === 'off') { offs++; offDay[d]++; od.push(d); } }
    if (!any) return;
    weeksSeen++; offsPerWeek.push(offs);
    if (od.length >= 2) { pairWeeks++; if (od.some((d, i) => i && d - od[i - 1] === 1)) togetherWeeks++; }
    const m = Object.keys(wk).sort((a, b) => wk[b] - wk[a])[0]; if (m) mains.push(m);
  });
  // their usual days off: the days they had off in at least half of the weeks
  const learnedOff = weeksSeen >= 2 ? offDay.map((n, d) => n / weeksSeen >= 0.5 ? d : -1).filter(d => d >= 0) : [];
  // rotation: the main shift changes week to week; and what usually comes after which
  const changes = mains.slice(1).filter((m, i) => m !== mains[i]).length, rotates = mains.length >= 3 && changes >= Math.ceil((mains.length - 1) * 0.6);
  const next = {}; mains.slice(1).forEach((m, i) => { if (m !== mains[i]) { const a = mains[i]; next[a] = next[a] || {}; next[a][m] = (next[a][m] || 0) + 1; } });
  const usual = Object.keys(seen).sort((a, b) => seen[b] - seen[a])[0] || '';
  const share = usual ? seen[usual] / samples : 0;
  let run = 0;
  for (let i = 1; i <= 14; i++) { const v = (roDays[roAdd(week, -i)] || {})[key]; if (rbParse(v)) run++; else break; }
  const last = roAdd(week, -7), lastOffs = [];
  for (let d = 0; d < 7; d++) if (rbKind((roDays[roAdd(last, d)] || {})[key]) === 'off') lastOffs.push(d);
  const lastSeen = {}; for (let d = 0; d < 7; d++) { const n = rbNorm((roDays[roAdd(last, d)] || {})[key]); if (n) lastSeen[n] = (lastSeen[n] || 0) + 1; }
  const lastMain = Object.keys(lastSeen).sort((a, b) => lastSeen[b] - lastSeen[a])[0] || '';
  const nx = lastMain && next[lastMain] ? Object.keys(next[lastMain]).sort((a, b) => next[lastMain][b] - next[lastMain][a])[0] : '';
  return { usual, lastMain, fixedGuess: samples >= 5 && share >= 0.85 ? usual : '', offs: offsPerWeek.length ? Math.max(1, _rbMed(offsPerWeek)) : 1, lastShift: (roDays[roAdd(week, -1)] || {})[key] || '', run, lastOffs, lastWeekendOff: lastOffs.some(d => d >= 4),
    learnedOff, learnedTogether: pairWeeks >= 2 && togetherWeeks / pairWeeks >= 0.6, rotates, nextMain: rotates ? nx : '', weeksLearned: weeks.filter(w => [0, 1, 2, 3, 4, 5, 6].some(d => (roDays[roAdd(w, d)] || {})[key])) };
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
/** PH days someone is owed: public holidays earned (see rbPhEarns), minus PH days in posted rosters, plus any set by hand. */
/** Who earns a PH for a holiday: 'all' = everyone on the team that day (the holidays in the list), 'worked' = only who worked it.
 *  Holidays only seen in PH cells ("PH - 28th Aug.") always count for who worked them. */
function rbPhEarns(key, dt, listed) {
  if (rbParse((roDays[dt] || {})[key])) return true;
  if ((rbSettings.phEarn || 'all') !== 'all' || !listed.has(dt)) return false;
  const c = rbPeople[key] || {};
  if (c.left && c.left <= dt) return false;
  if (c.joined) return c.joined <= dt;
  return rbFirstDay(key) <= dt;   // no join date: from their first day on a roster
}
/** Read once per redraw: everyone's first day on a roster and PH days taken (a list of 20 people asked 20 times). */
let _rbScanC = null;
function _rbScan() {
  const stamp = _rbLearnStamp() + JSON.stringify(rbSettings.holidays || []);
  if (_rbScanC && _rbScanC.stamp === stamp) return _rbScanC;
  const first = {}, taken = {}, hol = rbHolidays();
  for (const dt in roDays) { const day = roDays[dt] || {}; for (const k in day) { if (!day[k]) continue; if (!first[k] || dt < first[k]) first[k] = dt; if (/^PH\b/i.test(String(day[k]))) (taken[k] = taken[k] || []).push(dt); } }
  _rbScanC = { first, taken, hol, stamp };
  setTimeout(() => { _rbScanC = null; }, 0);
  return _rbScanC;
}
function rbFirstDay(key) { return _rbScan().first[key] || '9999'; }
function rbPhOwed(key, skipWeek) {
  const hol = _rbScan().hol, listed = new Set((rbSettings.holidays || []).map(h => h && h.date)), today = roToday();
  const worked = Object.keys(hol).filter(dt => dt <= today && rbPhEarns(key, dt, listed)).sort();
  const skip = skipWeek ? dt => dt >= skipWeek && dt <= roAdd(skipWeek, 6) : () => false;   // a week being rebuilt: its PH days are the builder's to place again
  const taken = (_rbScan().taken[key] || []).filter(dt => !skip(dt)).length;
  const adj = +(((rbPeople[key]) || {}).phAdj) || 0;
  const owed = Math.max(0, worked.length - taken + adj);
  const labels = Array.from({ length: owed }, (_, i) => worked[taken + i] ? rbPhLabel(worked[taken + i]) : '');
  return { owed, label: labels[0] || '', labels };
}

/** The PH label to use next for someone in the draft: skips the ones this week already has. */
function rbPhNext(k, cells) {
  const ph = rbPhOwed(k, rbWeek), c = (cells || ((rbDrafts[rbWeek] || {}).cells) || {})[k] || {};
  const used = Array.from({ length: 7 }, (_, d) => c[roAdd(rbWeek, d)]).filter(v => /^PH\b/i.test(String(v || ''))).length;
  return used < ph.owed ? ph.labels[used] || '' : '';
}
// ── State ─────────────────────────────────────────────────
let rbSettings = {}, rbPeople = {}, rbReqs = {}, rbDrafts = {};
let rbWeek = null, rbGroup = null, rbOut = null, rbSeed = 1, rbStale = false;
const RB_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function rbRules() { return Object.assign({ minRest: 11, maxRun: 12, maxHours: 9, allowOne: true, nightSwitch: true, givePh: true, lend: true, lockMgr: true, mgrMin: 1, deskMin: 2, deskFrom: 8, deskTo: 23 }, rbSettings.rules || {}); }
function rbGroups() { const g = roGroups(); return !g.length ? [''] : Object.values(roStaff).some(st => st && !st.group) ? g.concat(['']) : g; }   // '' = people with no hotel set
/** "Adagio GD · Bell" when the hotel has bell boys: their own cover, shifts and people. */
function rbPostGroups(g, week) { return [...new Set(rbMembers(g, week).map(rbPost).filter(Boolean))].map(p => `${g} · ${p}`); }
function rbWithPosts(shown) { return [].concat(...shown.map(g => [g, ...rbPostGroups(g)])); }
const RB_TITLES = ['Manager', 'Asst. Manager', 'Duty Manager', 'Supervisor', 'Team Leader', 'Night Auditor', 'Agent', 'Trainee', 'Bell Boy'];
const RB_NIGHT_WHO = ['Supervisor', 'Duty Manager'];   // who works 00:00 - 09:00 unless set otherwise
/** Someone works in the week: not marked off the roster, joined by its end, not left before it starts. */
function rbActive(k, week) {
  const c = rbPeople[k] || {}, w = week || rbWeek;
  return !c.inactive && !(c.left && c.left <= w) && !(c.joined && c.joined > roAdd(w, 6));
}
function rbTitle(k) { return (rbPeople[k] || {}).title || ''; }
/** Duty Managers float: any hotel, any shift, even when everyone else stays at their own hotel. */
function rbFloats(p) { return /^duty manager$/i.test((p && p.title) || ''); }
/** Supervisors can go anywhere too, but only when nobody else can: they come after everyone else. */
function rbFloatsLast(p) { return /^supervisor$/i.test((p && p.title) || ''); }
/** A Duty Manager and a Supervisor are never on the same shift together in the same hotel (one of them is enough):
 *  every such day and shift, as { date, hotel, shift, keys }. */
function rbSeniorClash(I, cells, dates) {
  const out = [], sen = I.people.filter(p => /^(duty manager|supervisor)$/i.test(p.title || ''));
  if (!sen.some(p => /^duty manager$/i.test(p.title)) || !sen.some(p => /^supervisor$/i.test(p.title))) return out;
  dates.forEach(dt => {
    const at = {};
    sen.forEach(p => { const v = (cells[p.key] || {})[dt], x = rbParse(v); if (!x) return; const k = rbBaseGroup(rbAt(I, p, x)) + '|' + rbNorm(v); (at[k] = at[k] || []).push(p); });
    Object.entries(at).forEach(([k, L]) => { if (L.some(rbFloats) && L.some(rbFloatsLast)) { const [hotel, shift] = k.split('|'); out.push({ date: dt, hotel, shift, keys: L.map(p => p.key) }); } });
  });
  return out;
}
/** Managers and Asst. Managers (not Duty Managers): one can look after all the hotels when needed, two is fine. */
function rbMgrP(p) { return /^(manager|asst\.? manager|assistant manager)$/i.test((p && p.title) || ''); }
/** Days in the week with fewer managers on duty (all hotels together) than the rule asks. Only counted when the
 *  cluster has more managers than that, so it can be done. */
function rbMgrGap(I, cells, dates, R) {
  const min = R.mgrMin == null ? 1 : +R.mgrMin; if (!(min > 0)) return 0;
  const mg = I.people.filter(rbMgrP); if (mg.length <= min) return 0;
  let gap = 0;
  dates.forEach(dt => { const on = mg.filter(p => rbParse((cells[p.key] || {})[dt])).length; if (on < min) gap += min - on; });
  return gap;
}
function rbIsManager(k) { return /^(manager|asst\. manager)$/i.test(rbTitle(k)); }   // duty managers rotate like supervisors
function rbMembers(g, week) { return Object.keys(roStaff).filter(k => ((roStaff[k] || {}).group || '') === g && rbActive(k, week)).sort((a, b) => ((roStaff[a].order ?? 999) - (roStaff[b].order ?? 999)) || roStaff[a].name.localeCompare(roStaff[b].name)); }
/** Cover needed for a hotel: what was set by hand, else what past rosters show. */
function rbGroupCfg(g) {
  const set = ((rbSettings.groups || {})[g.replace(/[.#$\[\]\/]/g, '_')]) || null;
  if (set && set.shifts && set.shifts.length) return { shifts: set.shifts.slice(), need: Object.assign({}, set.need), who: Object.assign({}, set.who), set: true };
  const L = rbLearnGroup(g, rbWeek || rbDefaultWeek());
  if (!L.shifts.length) return { shifts: ['07:00 - 15:00', '15:00 - 23:00', '23:00 - 07:00'], need: { '07:00 - 15:00': [1, 1, 1, 1, 1, 1, 1], '15:00 - 23:00': [1, 1, 1, 1, 1, 1, 1], '23:00 - 07:00': [1, 1, 1, 1, 1, 1, 1] }, set: false, guess: true };
  return Object.assign(L, { set: false });
}
function rbPersonCfg(k) {
  const L = rbLearnPerson(k, rbWeek || rbDefaultWeek()), c = rbPeople[k] || {};
  const mgr = rbIsManager(k);
  // static / rotates weekly / any: set by hand, else managers and anyone always on one shift stay static
  // 🔒 their shift is locked: set on their card, or a manager while "managers keep their shift" is on
  const lock = c.lockShift != null ? !!c.lockShift : mgr && rbRules().lockMgr !== false;
  const mode = c.mode || (c.fixed ? 'static' : c.fixed === '' && !lock ? 'any' : (L.fixedGuess || ((mgr || lock) && L.usual)) ? 'static' : L.rotates ? 'rotate' : 'any');   // (rotates week to week, as the posted rosters show)
  const fixed = mode === 'static' || lock ? (c.fixed || L.fixedGuess || L.usual || '') : '';
  return {
    key: k, group: rbPGroup(k), post: rbPost(k), title: c.title || '', mode, lock: lock && !!fixed, home: !!c.home, alt: c.alt || '',
    offs: c.offs != null ? +c.offs : L.offs,
    fixed, fixedLearned: !c.fixed && !!fixed,
    fixedCost: mgr ? 400 : /supervisor|leader|duty/i.test(c.title || '') ? 60 : 30,   // managers move only to stop a shift being empty
    lastMain: L.lastMain,
    usual: L.usual, allowed: c.allowed || null, soft: c.soft || [], prefOff: c.prefOff || [],
    // their wishes (💛 on their card): shifts they like, days off together, steady hours, a cap on nights
    likes: (c.likes || []).filter(x => rbGroupCfg((roStaff[k] || {}).group || '').shifts.includes(x)), together: !!c.together, steady: !!c.steady,
    // learned from the posted rosters (lighter than anything set on their card)
    learnedOff: c.prefOff && c.prefOff.length ? [] : (L.learnedOff || []), learnedTogether: c.together == null && !!L.learnedTogether, nextMain: L.nextMain || '', learnedFrom: (L.weeksLearned || []).length,
    maxNights: c.maxNights != null && !isNaN(+c.maxNights) && !(fixed && rbIsNight(fixed)) ? +c.maxNights : null,   // (static night staff: nights are their job)
    lastShift: L.lastShift, run: L.run, lastOffs: L.lastOffs, lastWeekendOff: L.lastWeekendOff,
  };
}
/** Requests for the week → cells fixed before building, and shifts to avoid. */
function rbPre() {
  const pre = {}, avoid = {}, soft = {}, dates = Array.from({ length: 7 }, (_, d) => roAdd(rbWeek, d));
  // before someone joins or after they leave: not on the roster
  Object.keys(roStaff).forEach(k => {
    const c = rbPeople[k] || {};
    dates.forEach(dt => { if ((c.left && dt >= c.left) || (c.joined && dt < c.joined)) (pre[k] = pre[k] || {})[dt] = '—'; });
  });
  // leave entered on the team page (sick, vacation) for any dates
  Object.keys(roStaff).forEach(k => Object.values((rbPeople[k] || {}).absences || {}).forEach(a => {
    dates.filter(dt => dt >= a.from && dt <= (a.to || a.from)).forEach(dt => { (pre[k] = pre[k] || {})[dt] = a.code || 'SL'; });
  }));
  Object.values(rbReqs[rbWeek] || {}).forEach(r => {
    if (!r || !r.key) return;
    dates.filter(dt => dt >= r.from && dt <= (r.to || r.from)).forEach(dt => {
      if (r.type === 'avoid') { ((avoid[r.key] = avoid[r.key] || {})[dt] = (avoid[r.key][dt] || [])).push(r.code); return; }
      if (r.type === 'soft') { ((soft[r.key] = soft[r.key] || {})[dt] = (soft[r.key][dt] || [])).push(r.code); return; }
      if (r.type === 'band') {
        const sh = rbGroupCfg(rbPGroup(r.key)).shifts, ok = rbBandShifts(sh, r.code);
        if (ok.length) { (avoid[r.key] = avoid[r.key] || {})[dt] = (avoid[r.key][dt] || []).concat(sh.filter(x => !ok.includes(x))); }
        return;
      }
      const v = r.type === 'off' ? 'OFF' : r.type === 'shift' ? r.code : r.type === 'ph' ? (r.code ? `PH - ${r.code}` : 'PH') : (r.code || 'AL');
      (pre[r.key] = pre[r.key] || {})[dt] = v;
    });
  });
  const busy = {}, evMiss = {};
  if (typeof evPre === 'function') evPre(dates, pre, evMiss, busy);   // 📅 meetings and training
  return { pre, avoid, soft, busy, evMiss };
}
/** Who may work each shift: as set, else the night shift (00:00 start) for Supervisors and Duty Managers,
 *  once anyone in the cluster has one of those titles. */
function rbWho(g, c) {
  const who = Object.assign({}, c.who || {});
  const titled = Object.keys(roStaff).some(k => RB_NIGHT_WHO.includes(rbTitle(k)));
  if (titled && rbBaseGroup(g) === g) c.shifts.forEach(s => { const x = rbParse(s); if (who[s] === undefined && x && x.type === 'night' && x.s < 120) who[s] = RB_NIGHT_WHO.slice(); });   // [] set by hand stays "everyone"
  Object.keys(who).forEach(s => { if (!who[s] || !who[s].length || who[s].includes('*')) delete who[s]; });   // '*' = everyone, set by hand
  return who;
}
function rbInput(seed) {
  const groups = {}, people = [];
  rbGroups().forEach(g => {
    const c = rbGroupCfg(g); groups[g] = { shifts: c.shifts, need: c.need, who: rbWho(g, c) };
    rbMembers(g).forEach(k => { const p = rbPersonCfg(k); const ph = rbPhOwed(k, rbWeek); p.phOwed = ph.owed; p.phLabel = ph.label; p.phLabels = ph.labels; people.push(p); });
    rbPostGroups(g).forEach(gp => { const c2 = rbGroupCfg(gp); groups[gp] = { shifts: c2.shifts, need: c2.need, who: rbWho(gp, c2), post: gp.slice(g.length + 3) }; });
  });
  const { pre, avoid, soft, busy, evMiss } = rbPre();
  const I = { week: rbWeek, groups, people, pre, avoid, soft, busy, evMiss, rules: rbRules(), seed: seed || 1 };
  rbFairHistory(I);
  return I;
}
/** The last 4 posted weeks, person by person, so every week is fair over time:
 *  wishes that weren't granted lately are owed (they come first this week), and whoever had more nights or
 *  fewer weekends off than the team gets the lighter side this time. */
function rbFairHistory(I) {
  const weeks = rbHistory(I.week, 4).filter(w => w < I.week), W = [1, 0.75, 0.5, 0.25];   // the last 4 weeks that have a roster, gaps skipped
  const byGroup = {};
  I.people.forEach(p => {
    let debt = 0, nights = 0, wkOff = 0, seen = 0;
    weeks.forEach((w, i) => {
      const dates = Array.from({ length: 7 }, (_, d) => roAdd(w, d));
      const row = {}; dates.forEach(dt => { const v = (roDays[dt] || {})[p.key]; if (v) row[dt] = v; });
      if (!Object.keys(row).length) return;
      seen++;
      const wishes = rbWishes(I, p, { [p.key]: row }, dates);
      debt += W[i] * wishes.filter(x => !x.ok).length;
      dates.forEach((dt, d) => { const v = row[dt] || ''; if (rbIsNight(v)) nights++; else if (d >= 5 && /^(off|leave)$/.test(rbKind(v))) wkOff++; });
    });
    p.wishDebt = Math.round(debt * 10) / 10; p.histWeeks = seen; p.nightsHist = nights; p.wkOffHist = wkOff;
    const night = p.fixed && rbIsNight(p.fixed);   // static night staff: nights are their job, not counted against anyone
    if (seen && !night && !p.post) (byGroup[p.group] = byGroup[p.group] || []).push(p);
  });
  Object.values(byGroup).forEach(list => {
    if (list.length < 2) return;
    const avgN = list.reduce((t, p) => t + p.nightsHist / p.histWeeks, 0) / list.length, avgW = list.reduce((t, p) => t + p.wkOffHist / p.histWeeks, 0) / list.length;
    list.forEach(p => { p.nightExtra = Math.round((p.nightsHist / p.histWeeks - avgN) * 10) / 10; p.wkOffShort = Math.round((avgW - p.wkOffHist / p.histWeeks) * 10) / 10; });
  });
}
/** A morning shift (starting before 10:00, not a night). */
function rbIsMorning(v) { const x = rbParse(v); return !!x && !rbIsNight(v) && x.s < 10 * 60; }
/** Days where someone goes night → one day off → a morning: their day off is spent sleeping, so it's kept for when there's no other way. */
function rbNightToMorning(cells, p, dates) {
  const v = d => d < 0 ? (d === -1 ? (p.lastShift || '') : '') : ((cells[p.key] || {})[dates[d]] || '');
  const out = [];
  for (let d = 1; d < dates.length; d++) if (rbIsMorning(v(d)) && rbKind(v(d - 1)) === 'off' && rbIsNight(v(d - 2))) out.push(dates[d]);
  return out;
}
/** How much more a person's wishes count this week: 1, up to 3 when they missed wishes in the weeks before. */
function rbWishWeight(p) { return 1 + Math.min(2, (p.wishDebt || 0) * 0.5); }

// ── Building ──────────────────────────────────────────────
let _rbBuilding = false;
function rbBuild(again) {
  if (_rbBuilding) return;   // already building: one at a time
  if (!roCanEdit()) { showToast('Only supervisors, managers and owners can build the roster', 'err'); return; }
  if (!Object.keys(roStaff).length) { showToast('Add one roster first (picture or Excel), so the builder knows the team', 'warn'); return; }
  const has = rbDrafts[rbWeek] && Object.keys(rbDrafts[rbWeek].cells || {}).length;
  if (has && !again && !confirm('Build the week again? Changes you made to the draft are replaced.')) return;
  rbSeed = again ? (rbSeed * 7 + 13) % 100000 : 1;
  const out = document.getElementById('rbOut');
  if (out) { out.innerHTML = `<div class="ri-reading ro-busy">${roBusyAnim('build')}<div><b>Building the roster…</b>${roBusySteps(['Reading the last weeks of rosters…', 'Placing days off fairly…', 'Covering every shift, reception first…', 'Checking rest between shifts…', 'Keeping wishes where it can…', 'Fixing gaps inside each hotel…', 'Trying another way and keeping the best…'])}<div class="ro-prog"><i></i></div></div></div>`; out.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  _rbBuilding = true;
  setTimeout(() => _rbBuildNow().catch(e => { console.error(e); showToast('Building failed: ' + e.message, 'err'); rbRender(); }).finally(() => { _rbBuilding = false; }), 60);
}
/** The engine in the background (roster-worker.js), so the screen never freezes while it builds. Falls back to
 *  building here if the browser can't (old browser, file opened offline before the worker was cached). */
let _rbWk = null, _rbWkN = 0;
function rbSolveAsync(I) {
  const here = () => rbSolve(I);
  if (typeof Worker !== 'function' || self._rbNoWorker) return Promise.resolve(here());
  return new Promise(resolve => {
    let done = false;
    const finish = r => { if (done) return; done = true; resolve(r); };
    try {
      if (!_rbWk) { _rbWk = new Worker('roster-worker.js'); _rbWk.onerror = () => { self._rbNoWorker = true; try { _rbWk.terminate(); } catch (_) {} _rbWk = null; }; }
      const id = ++_rbWkN, w = _rbWk;
      const onMsg = e => { if (!e.data || e.data.id !== id) return; w.removeEventListener('message', onMsg); clearTimeout(t);
        if (e.data.ok) { const cells = e.data.res.cells; finish({ cells, notes: e.data.res.notes || [], problems: rbProblems(I, cells) }); }
        else { console.warn('Roster worker:', e.data.error); finish(here()); } };
      w.addEventListener('message', onMsg);
      const t = setTimeout(() => { w.removeEventListener('message', onMsg); try { w.terminate(); } catch (_) {} _rbWk = null; finish(here()); }, 90000);   // stuck: start again here
      w.postMessage({ id, I: JSON.parse(JSON.stringify(I)), roDays, roStaff, roCodes, rbPeople, rbSettings });
    } catch (e) { self._rbNoWorker = true; finish(here()); }
  });
}
async function _rbBuildNow() {
  const I = rbInput(rbSeed), week = rbWeek;
  const res = await rbSolveAsync(I);
  if (rbWeek !== week) rbWeek = week;   // (the week built is the week saved, even if someone switched meanwhile)
  rbDrafts[rbWeek] = Object.assign({ cells: res.cells, at: Date.now(), by: (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || '' }, res.notes && res.notes.length ? { notes: res.notes } : {});
  rbSaveDraft();
  rbRender();
  const short = res.problems.filter(p => p.kind === 'short').length, bent = (res.notes || []).filter(n => n.auto).length;
  showToast(short ? `Roster built: ${short} gap${short === 1 ? '' : 's'} in cover to look at` : bent ? `Roster built: every shift is covered. ${bent} shift${bent === 1 ? '' : 's'} needed a rule bent the way past rosters did; see "Decisions this week"` : 'Roster built: every shift is covered', short || bent ? 'warn' : 'ok');
  setTimeout(() => document.getElementById('rbOut')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
}
// Saving a draft sends only what changed since it was last seen from the server (cell by cell), so two
// people editing the same week at once keep each other's changes; only the very same cell is "last one wins".
const _rbSaving = {}, _rbBase = {};
const _rbClone = v => (v == null ? null : JSON.parse(JSON.stringify(v)));
/** What changed from base to cur, as paths: { 'cells/KEY/2026-10-12': '09:00 - 18:00', 'notes': [...] }. */
function rbDraftDiff(base, cur) {
  const up = {}, bc = (base && base.cells) || {}, cc = (cur && cur.cells) || {};
  new Set([...Object.keys(bc), ...Object.keys(cc)]).forEach(k => {
    if (!cc[k]) { if (bc[k]) up['cells/' + k] = null; return; }
    const b = bc[k] || {}, c = cc[k];
    new Set([...Object.keys(b), ...Object.keys(c)]).forEach(d => { if ((b[d] ?? null) !== (c[d] ?? null)) up[`cells/${k}/${d}`] = c[d] ?? null; });
  });
  new Set([...Object.keys(base || {}), ...Object.keys(cur || {})]).forEach(f => {
    if (f !== 'cells' && JSON.stringify((base || {})[f] ?? null) !== JSON.stringify((cur || {})[f] ?? null)) up[f] = (cur || {})[f] ?? null;
  });
  return up;
}
/** Send week w's draft now. */
function rbPutDraft(w) {
  _rbUndoMark(w);
  const cur = rbDrafts[w] || null, base = _rbBase[w];
  if (!cur || !base) fbSet('roster/builder/drafts/' + w, cur);
  else fbUpdate('roster/builder/drafts/' + w, rbDraftDiff(base, cur));
  _rbBase[w] = _rbClone(cur);
}
function rbSaveDraft() {
  const w = rbWeek;   // the week edited, even if another week is open when the save runs
  _rbUndoMark(w);
  clearTimeout(_rbSaving[w]);
  _rbSaving[w] = setTimeout(() => { delete _rbSaving[w]; rbPutDraft(w); }, 400);
}
/** Drafts from the server: a week with an edit still waiting to be sent keeps that edit on top of the new version. */
function rbDraftsIn(v) {
  v = v || {};
  const server = _rbClone(v);
  Object.keys(_rbSaving).forEach(w => {
    // a colleague discarded the whole draft meanwhile: that wins, my waiting edit goes with it
    if (_rbBase[w] && !v[w]) { clearTimeout(_rbSaving[w]); delete _rbSaving[w]; return; }
    const mine = rbDraftDiff(_rbBase[w], rbDrafts[w]);
    if (!rbDrafts[w] || !Object.keys(mine).length) return;
    if ('notes' in mine && v[w]) {
      // notes: theirs and mine both kept (only the ones I removed go)
      const id = n => JSON.stringify(n), had = new Set(((_rbBase[w] || {}).notes || []).map(id)), keep = new Set((rbDrafts[w].notes || []).map(id));
      const merged = [...(v[w].notes || []).filter(n => !(had.has(id(n)) && !keep.has(id(n))))];
      (rbDrafts[w].notes || []).forEach(n => { if (!merged.some(m => id(m) === id(n))) merged.push(n); });
      mine.notes = merged.length ? merged : null;
    }
    v[w] = fbApplyPatch(v[w], mine);
  });
  // what the server has is the base now, so the next save sends only this person's own changes
  Object.keys(_rbBase).forEach(w => delete _rbBase[w]);
  Object.keys(server).forEach(w => { _rbBase[w] = server[w]; });
  rbDrafts = v;
}

// ── Screen ────────────────────────────────────────────────
function rbOpen() { showPanel('roster-build'); }
/** The week to build: the one right after the latest posted roster (whoever posted it), else next week. */
function rbDefaultWeek() {
  const w = roMonday(new Date()), has = x => [0, 1, 2, 3, 4, 5, 6].some(d => Object.keys(roDays[roAdd(x, d)] || {}).length);
  let last = null; for (let i = 0; i <= 4; i++) { const x = roAdd(w, 7 * i); if (has(x)) last = x; }
  return last && last >= w ? roAdd(last, 7) : roAdd(w, 7);
}
function rbGo(n) { rbWeek = n === 0 ? rbDefaultWeek() : roAdd(rbWeek, n); rbRender(); }
function rbWeekLabel(w) { return `${roDate(w).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${roDate(roAdd(w, 6)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`; }
const _rbQ = s => JSON.stringify(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function rbRender() {
  rbStale = false;
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
      <div class="rb-status">${rbStatusHtml()}</div>
      <div class="rb-steps" id="rbSteps">${rbStepsHtml()}</div>
    </div>

    ${rbQuickHtml(draft)}

    <div class="rb-grid">
      ${typeof evBuilderHtml === 'function' ? evBuilderHtml(dates) : ''}
      <details class="card rb-card"${rbSec('req', !draft)}>
        <summary class="ro-card-hd"><b>📝 Requests this week</b><span>${reqs.length ? `<i class="rb-count">${reqs.length}</i>` : 'none yet'}</span></summary>
        ${reqs.length ? `<div class="rb-reqs">${reqs.sort((a, b) => a[1].from.localeCompare(b[1].from)).map(([id, r]) => `<div class="rb-req"><b>${escapeHtml((roStaff[r.key] || {}).name || r.key)}</b><span>${escapeHtml(rbReqText(r))}</span>${r.type === 'off' && rbPhOwed(r.key, rbWeek).owed > 0 ? `<button class="btn sm ghost" title="They have PH owed: take it from the balance instead" onclick="rbReqToPh('${id}')">→ PH (${rbPhOwed(r.key, rbWeek).owed} owed)</button>` : ''}<button class="ro-x" title="Remove" onclick="rbDelReq('${id}')">✕</button></div>`).join('')}</div>` : '<div class="ro-empty">Day-off requests, leave, PH days, "must work" or "can\'t work" a shift. Everything else the builder decides.</div>'}
        <div class="rb-req-add">
          <select id="rbRqP">${shown.map(g => `<optgroup label="${escapeHtml(g || 'Team')}">${rbMembers(g).map(k => `<option value="${escapeHtml(k)}">${escapeHtml(roStaff[k].name)}</option>`).join('')}</optgroup>`).join('')}</select>
          <select id="rbRqT" onchange="rbReqTypeChange()">
            <option value="off">Day off request</option><option value="leave">Leave (AL, ALA, SL…)</option><option value="ph">PH day (in lieu)</option><option value="band">Shift type (morning, day, evening, night)</option><option value="shift">Must work a shift</option><option value="soft">Prefer not a shift (only if needed)</option><option value="avoid">Can't work a shift</option>
          </select>
          <span id="rbRqC"></span>
          <label>From <input type="date" id="rbRqF" value="${dates[0]}" min="${dates[0]}" max="${dates[6]}"></label>
          <label>To <input type="date" id="rbRqTo" value="${dates[0]}" min="${dates[0]}" max="${dates[6]}"></label>
          <button class="btn sm gold" onclick="rbAddReq()">+ Add</button>
        </div>
      </details>

      ${typeof rtPlanHtml === 'function' && Object.keys(roStaff).length ? rtPlanHtml(shown, dates) : ''}
      <details class="card rb-card"${rbSec('need', false)}>
        <summary class="ro-card-hd"><b>👥 Cover needed</b><span>people on each shift, each day</span></summary>
        ${rbLazy('need', false, () => rbWithPosts(shown).map(g => rbNeedHtml(g)).join(''))}
      </details>

      <details class="card rb-card"${rbSec('team', false)}>
        <summary class="ro-card-hd"><b>🧑‍💼 Team</b><span>titles, static or rotating, leave, history</span></summary>
        ${rbLazy('team', false, () => typeof rtTeamHtml === 'function' ? rtTeamHtml(shown) : shown.map(g => rbTeamHtml(g)).join(''))}
      </details>

      <details class="card rb-card"${rbSec('rules', false)}>
        <summary class="ro-card-hd"><b>⚖️ Rules & public holidays</b></summary>
        ${rbLazy('rules', false, () => rbRulesHtml())}
      </details>
    </div>

    <div class="rb-go">
      <button class="btn gold rb-big" onclick="rbBuild()">✨ ${draft ? 'Build again from scratch' : 'Build the roster'}</button>
      ${draft ? '<button class="btn" onclick="rbBuild(true)">🔀 Try another way</button>' : ''}
      ${draft ? '<button class="btn" onclick="rtWhatIfDialog()">🤔 What if…</button>' : ''}
      <small>Requests and rules come first; you can change any cell after.</small>
    </div>
    <div id="rbOut">${draft ? rbOutHtml(shown, dates) : ''}</div>`;
  rbReqTypeChange();
  rbSecWire(root);
  const sp = document.getElementById('rbSteps'); if (sp) sp.innerHTML = rbStepsHtml();
}
// Setup sections stay open or closed as the person left them, across re-renders.
const rbSecState = {};
/** A folded section's inside is drawn when it's opened (not on every redraw while it's shut). */
const _rbLazyFn = {};
function rbLazy(id, dflt, fn) {
  if (id in rbSecState ? rbSecState[id] : dflt) return fn();
  _rbLazyFn[id] = fn;
  return `<div class="rb-lazy" data-lazy="${id}"></div>`;
}
function rbSec(id, dflt) { return `${(id in rbSecState ? rbSecState[id] : dflt) ? ' open' : ''} data-sec="${id}"`; }
function rbSecWire(root) { root.querySelectorAll('details[data-sec]').forEach(d => d.addEventListener('toggle', () => { rbSecState[d.dataset.sec] = d.open; const ph = d.open && d.querySelector(':scope > .rb-lazy'); if (ph && _rbLazyFn[ph.dataset.lazy]) { try { ph.outerHTML = _rbLazyFn[ph.dataset.lazy](); } catch (e) { console.error(e); } } })); }
/** ① Requests ② Build ③ Check ④ Publish: where this week is. */
let _rbHealth = null;
function rbStepsHtml() {
  const D = rbDrafts[rbWeek], pub = typeof rtIsPublished === 'function' && rtIsPublished(rbWeek);
  const n = Object.keys(rbReqs[rbWeek] || {}).length, h = D && _rbHealth && _rbHealth.week === rbWeek ? _rbHealth : null;
  const pending = pub && D && D.fromPublished && typeof rtDiff === 'function' ? rtDiff(rbWeek, D.cells).length : 0;
  const st = [
    ['Requests', n ? n + ' added' : 'optional', n ? 'done' : ''],
    ['Build', D ? 'built' : 'not yet', D ? 'done' : 'now'],
    ['Check', !D ? '' : !h ? '' : h.bad ? h.bad + ' to fix' : h.thin ? h.thin + ' one-person' : 'all good', !D ? '' : h && h.bad ? 'warn' : 'done'],
    ['Publish', pub ? (pending ? pending + ' unsent' : 'posted') : D ? 'ready' : '', pub && !pending ? 'done' : D && !(h && h.bad) ? 'now' : ''],
  ];
  if (st[2][2] === 'done' && !(pub && !pending)) st[3][2] = 'now';
  return st.map(([t, sub, c], i) => `<div class="rb-step ${c}"><i>${c === 'done' ? '✓' : i + 1}</i><b>${t}</b><small>${escapeHtml(sub)}</small></div>`).join('');
}

// ── Quick start: the four things done most ─────────────────
function rbQuickHtml(draft) {
  const prev = rbPrevWeek(rbWeek), pub = typeof rtIsPublished === 'function' && rtIsPublished(rbWeek);
  return `<div class="rb-quick">
    <label class="rb-q" title="A picture or Excel of the current roster: it's read, you check it, then next week is built from it">
      <b>📥 Give this week's roster</b><small>Picture or Excel: it reads it, then builds the next week from it</small>
      <input type="file" accept="image/*,.xlsx,.xls,.csv" hidden onchange="rbStartFromFile(this)"></label>
    <button class="rb-q" onclick="rbFromLastWeek()"${prev ? '' : ' disabled'}><b>📋 Same as last week</b><small>${prev ? `${escapeHtml(rbWeekLabel(prev))} carried on, with this week's requests and the rules` : 'No earlier week in HotelOps yet'}</small></button>
    <button class="rb-q" onclick="rtNewStaffDialog()"><b>＋ New staff</b><small>Someone joining: name, hotel, title, start date</small></button>
    <button class="rb-q" onclick="rbDownloadPic()"${draft || pub ? '' : ' disabled'}><b>🖼 Download picture</b><small>${draft ? 'This draft' : pub ? 'The posted roster' : 'Build or post the week first'}, as an image to send</small></button>
  </div>`;
}
/** The newest week before this one that has a roster in HotelOps. */
function rbPrevWeek(week) { for (let i = 1; i <= 8; i++) { const w = roAdd(week, -7 * i); if ([0, 1, 2, 3, 4, 5, 6].some(d => Object.keys(roDays[roAdd(w, d)] || {}).length)) return w; } return null; }
function rbStartFromFile(input) {
  const f = input.files && input.files[0]; if (!f) return;
  if (!roCanEdit()) { showToast('Only supervisors, managers and owners can change the roster', 'err'); return; }
  window._rbContinue = Date.now();
  showPanel('roster');
  if (/^image\//.test(f.type) && typeof roFromImage === 'function') roFromImage(f);
  else { roImportOpen(true); roFromFile(input); }
  showToast('Reading the roster… check it, press Save, and next week is built from it', 'ok');
}
/** After a roster is saved: open the builder on the week after it and build it. */
function rbContinueFrom(firstDate) {
  rbWeek = roAdd(roMonday(roDate(firstDate)), 7);
  rbOpen();
  setTimeout(() => {
    if (rbDrafts[rbWeek] && Object.keys(rbDrafts[rbWeek].cells || {}).length && !confirm(`There's already a draft for ${rbWeekLabel(rbWeek)}. Build it again from the roster you just gave?`)) { rbRender(); return; }
    rbSeed = 1; rbRender(); _rbBuildNow();
  }, 250);
}
/** Last week carried on: the same days off and shifts where they still fit, fixed for this week's requests and the rules. */
function rbFromLastWeek() {
  const prev = rbPrevWeek(rbWeek); if (!prev) return;
  if (rbDrafts[rbWeek] && Object.keys(rbDrafts[rbWeek].cells || {}).length && !confirm('Replace the draft for this week with last week carried on?')) return;
  const I = rbInput(1), keep = {};
  I.people.forEach(p => { keep[p.key] = {}; for (let d = 0; d < 7; d++) { const v = (roDays[roAdd(prev, d)] || {})[p.key]; if (v && (rbParse(v) || rbKind(v) === 'off')) keep[p.key][roAdd(rbWeek, d)] = rbParse(v) ? rbNorm(v) : 'OFF'; } });
  I.keep = keep;
  const res = rbSolve(I);
  if (rbDrafts[rbWeek]) rbUndoPush();
  rbDrafts[rbWeek] = { cells: res.cells, at: Date.now(), by: (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || '', from: prev };
  rbSaveDraft(); rbRender();
  let same = 0, all = 0; Object.keys(keep).forEach(k => Object.keys(keep[k]).forEach(dt => { all++; if (rbNorm(res.cells[k][dt]) === keep[k][dt] || (keep[k][dt] === 'OFF' && rbKind(res.cells[k][dt]) === 'off')) same++; }));
  showToast(`Built from ${rbWeekLabel(prev)}: ${same} of ${all} days the same; the rest changed for requests, leave and the rules`, 'ok');
  setTimeout(() => document.getElementById('rbOut')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
}
function rbDownloadPic() {
  if (rbDrafts[rbWeek]) { rbSharePic(); return; }
  if (typeof rtIsPublished === 'function' && rtIsPublished(rbWeek)) { rtSharePosted(rbWeek); return; }
  showToast('Build or post this week first', 'warn');
}

function rbStatusHtml() {
  const pub = typeof rtIsPublished === 'function' && rtIsPublished(rbWeek), D = rbDrafts[rbWeek];
  if (pub && D && D.fromPublished) { const n = typeof rtDiff === 'function' ? rtDiff(rbWeek, D.cells).length : 0; return `<span class="ro-tag">✏️ Editing the posted week</span>${n ? ` <b>${n} change${n === 1 ? '' : 's'}</b> not published yet` : ' no changes yet'}`; }
  if (pub) return `<span class="ro-tag">✓ Posted</span> <button class="btn sm" onclick="rbLoadPublished(rbWeek)">✏️ Edit this week</button>`;
  return D ? '<span class="rb-dim">Draft, not posted yet</span>' : '<span class="rb-dim">Not built yet</span>';
}
/** Open a posted week (imported picture, Excel or built here) in the builder to change it. */
function rbLoadPublished(week, quiet) {
  if (!quiet && rbDrafts[week] && !rbDrafts[week].fromPublished && !confirm('Replace the draft for this week with what is posted?')) return;
  const cells = rtPublished(week);
  Object.keys(cells).forEach(k => { if (!Object.keys(cells[k]).length && !rbActive(k, week)) delete cells[k]; });
  rbDrafts[week] = { cells, at: Date.now(), by: (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || '', fromPublished: true };
  rbWeek = week;
  rbPutDraft(week);
  rbRender();
}
// ↶ undo for changes made in the draft
let rbUndoStack = [];
function rbUndoPush() { const D = rbDrafts[rbWeek]; if (!D) return; rbUndoStack.push({ week: rbWeek, cells: JSON.parse(JSON.stringify(D.cells || {})) }); if (rbUndoStack.length > 30) rbUndoStack.shift(); }
function rbUndo() {
  const u = rbUndoStack.pop(); if (!u) { showToast('Nothing to undo', 'warn'); return; }
  rbWeek = u.week;
  if (u.after && rbDrafts[u.week]) {
    // put back only the cells this change touched, so a colleague's edits since then stay
    const cells = _rbClone(rbDrafts[u.week].cells || {}), patch = rbDraftDiff({ cells: u.after }, { cells: u.cells });
    rbDrafts[u.week] = Object.assign({}, rbDrafts[u.week], fbApplyPatch({ cells }, patch));
  } else rbDrafts[u.week] = Object.assign({}, rbDrafts[u.week], { cells: u.cells });
  rbSaveDraft(); rbRender();
}
/** Right after a change: what the week looks like with it, so Undo knows which cells it touched. */
function _rbUndoMark(w) {
  const u = rbUndoStack[rbUndoStack.length - 1];
  if (u && u.week === w && !u.after && rbDrafts[w]) u.after = _rbClone(rbDrafts[w].cells || {});
}
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z') && document.getElementById('panel-roster-build')?.classList.contains('active') && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) { e.preventDefault(); rbUndo(); }
});
function rbApplyCells(cells, why, notes) { rbUndoPush(); rbDrafts[rbWeek] = Object.assign({}, rbDrafts[rbWeek], { cells }); rbAddNotes(rbWeek, notes); rbSaveDraft(); rbRefreshOut(); showToast(why ? `Done: ${why} It's noted under Decisions. ↶ Undo is above the table` : 'Done. ↶ Undo is above the table', why ? 'warn' : 'ok'); }
let _rbOpt = [];
function rbOptApply(i) { const o = _rbOpt[i]; if (o && o.cells) rbApplyCells(JSON.parse(JSON.stringify(o.cells)), o.why, o.notes); }
/** Decisions kept with the week: a rule bent on purpose, and why. */
function rbAddNotes(week, notes) {
  if (!notes || !notes.length || !rbDrafts[week]) return;
  const D = rbDrafts[week], who = (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || '';
  // (the database refuses a value that is undefined: leave such fields out)
  D.notes = (D.notes || []).concat(notes.map(n => JSON.parse(JSON.stringify(Object.assign({ at: Date.now(), by: who }, n)))));
}
/** A rule break that a decision covers: same person, that day or the day after (night ↔ day shows on the next day). */
function rbNoted(p) { return !!p.key && ((rbDrafts[rbWeek] || {}).notes || []).some(n => n.key === p.key && n.date && p.date && Math.abs(roDate(p.date) - roDate(n.date)) <= 864e5 * 1.5); }
function rbDelNote(i) { const D = rbDrafts[rbWeek]; if (!D || !D.notes) return; D.notes = D.notes.filter((_, j) => j !== i); rbSaveDraft(); rbRefreshOut(); }
/** Decisions this week: rules bent on purpose (with why) and everyone working at another hotel. */
function rbDecisionsHtml(I, cells, shown, dates) {
  const D = rbDrafts[rbWeek] || {}, notes = D.notes || [], moved = [];
  I.people.forEach(p => dates.forEach(dt => { const v = (cells[p.key] || {})[dt], x = rbParse(v); if (!x || !x.note) return; const at = rbBaseGroup(rbAt(I, p, x)), home = rbBaseGroup(p.group); if (at !== home && (shown.includes(at) || shown.includes(home))) moved.push({ p, dt, at, home, sh: rbNorm(v) }); }));
  const soft = []; I.people.forEach(p => dates.forEach(dt => { const v = (cells[p.key] || {})[dt]; if (rbParse(v) && rbSoftNo(I, p, dt, v) && shown.includes(rbBaseGroup(p.group))) soft.push({ p, dt, sh: rbNorm(v) }); }));
  const n2m = []; I.people.forEach(p => { if (shown.includes(rbBaseGroup(p.group))) rbNightToMorning(cells, p, dates).forEach(dt => n2m.push({ p, dt })); });
  if (!notes.length && !moved.length && !soft.length && !n2m.length) return '';
  const fn = k => escapeHtml(((roStaff[k] || {}).name || k).split(' ')[0]);
  const named = p => notes.some(n => new RegExp('\\b' + ((roStaff[p.key] || {}).name || '').split(' ')[0] + '\\b').test(n.text || ''));
  const why = p => named(p) ? 'part of the decision above' : rbFloats(p) ? 'Duty Manager: works wherever needed' : rbFloatsLast(p) ? 'Supervisor from another hotel: only because nobody else could' : I.rules.lend === false ? '' : 'spare at their own hotel that day';
  return `<div class="rb-decide"><div class="rb-sub">📝 Decisions this week <small>so you know what was done, and why</small></div>
    ${notes.map((n, i) => `<div class="rb-dec warn"><span>⚠ ${escapeHtml(n.text)}${n.by ? ` <i>· ${escapeHtml(n.by)}</i>` : ''}</span><button class="ro-x" title="Remove this note" onclick="rbDelNote(${i})">✕</button></div>`).join('')}
    ${soft.map(m => `<div class="rb-dec"><span>🙏 <b>${fn(m.p.key)}</b> works ${escapeHtml(m.sh)} on ${escapeHtml(roDayLbl(m.dt))}, a shift they prefer not to: needed to cover it</span></div>`).join('')}
    ${n2m.map(m => `<div class="rb-dec"><span>😴 <b>${fn(m.p.key)}</b> goes from a night to a morning on ${escapeHtml(roDayLbl(m.dt))} with only one day off between (their day off goes on sleep): no other way to cover it</span></div>`).join('')}
    ${moved.map(m => `<div class="rb-dec"><span>🏨 <b>${fn(m.p.key)}</b> (${escapeHtml(m.home)}) works ${escapeHtml(m.sh)} at <b>${escapeHtml(m.at)}</b> on ${escapeHtml(roDayLbl(m.dt))}${why(m.p) ? ': ' + escapeHtml(why(m.p)) : ''}</span></div>`).join('')}
  </div>`;
}

function rbReqText(r) {
  const d = r.from === (r.to || r.from) ? roDayLbl(r.from) : `${roDayLbl(r.from)} → ${roDayLbl(r.to)}`;
  return `${r.type === 'off' ? 'Day off' : r.type === 'leave' ? (r.code || 'Leave') : r.type === 'ph' ? 'PH' + (r.code ? ' (' + r.code + ')' : '') : r.type === 'shift' ? 'Works ' + r.code : r.type === 'soft' ? 'Prefers not ' + r.code : r.type === 'band' ? rbBandLabel(r.code) + ' shifts' : 'Not ' + r.code} · ${d}`;
}
function rbReqTypeChange() {
  const t = document.getElementById('rbRqT')?.value, box = document.getElementById('rbRqC');
  if (!box) return;
  const k = document.getElementById('rbRqP')?.value, g = (roStaff[k] || {}).group || '';
  const shifts = rbGroupCfg(g).shifts;
  const leave = Object.entries(roAllCodes()).filter(([, v]) => v.type === 'leave' && !/^PH$/.test('')).map(([c]) => c).filter(c => c !== 'PH');
  box.innerHTML = t === 'leave' ? `<select id="rbRqCode">${leave.map(c => `<option${c === 'AL' ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select>`
    : t === 'band' ? `<select id="rbRqCode">${Object.keys(RB_BANDS).map(b => `<option value="${b}">${escapeHtml(RB_BANDS[b].label)}</option>`).join('')}</select>`
    : t === 'shift' || t === 'avoid' || t === 'soft' ? `<select id="rbRqCode">${shifts.map(s => `<option>${escapeHtml(s)}</option>`).join('')}</select>`
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
    ${c.shifts.map(s => { const i = roInfo(s), who = rbWho(g, c)[s]; return `<tr><td class="ro-name ro-t-${i ? i.type : 'other'}"><button class="ro-tap" title="Change the hours (bus times)" onclick="rbEditShift(${_rbQ(g)},${_rbQ(s)})"><b>${escapeHtml(s)}</b> ✏️</button><button class="rb-who${who ? ' set' : ''}" onclick="rbEditWho(${_rbQ(g)},${_rbQ(s)})">${who ? '👤 ' + escapeHtml(who.join(', ')) : '👥 Everyone'}</button></td>${(c.need[s] || [0, 0, 0, 0, 0, 0, 0]).map((n, d) => `<td><input type="number" min="0" max="20" value="${n}" onchange="rbSetNeed(${_rbQ(g)},${_rbQ(s)},${d},this.value)"></td>`).join('')}<td><button class="ro-x" title="Remove shift" onclick="rbDelShift(${_rbQ(g)},${_rbQ(s)})">✕</button></td></tr>`; }).join('')}
    </tbody></table></div>
    <div class="rb-inline"><input id="rbNs_${escapeHtml(gk)}" placeholder="Add a shift, e.g. 07:00 - 16:00"><button class="btn sm" onclick="rbAddShift(${_rbQ(g)})">+ Shift</button>${c.set ? `<button class="btn sm" onclick="rbResetNeed(${_rbQ(g)})">↺ Learn again</button>` : ''}</div></div>`;
}
function _rbSetGroup(g, c) { const gk = g.replace(/[.#$\[\]\/]/g, '_'); rbSettings.groups = Object.assign({}, rbSettings.groups, { [gk]: { shifts: c.shifts, need: c.need, who: c.who || {} } }); fbSet('roster/builder/settings/groups/' + gk, rbSettings.groups[gk]); }
function rbSetNeed(g, s, d, v) { const c = rbGroupCfg(g); c.need[s] = (c.need[s] || [0, 0, 0, 0, 0, 0, 0]).slice(); c.need[s][d] = Math.max(0, +v || 0); _rbSetGroup(g, c); rbRefreshOut(); }
function rbAddShift(g) {
  const inp = document.getElementById('rbNs_' + g.replace(/[.#$\[\]\/]/g, '_')), s = rbNorm(inp.value);
  if (!s) { showToast('Write the hours like 07:00 - 16:00', 'warn'); return; }
  { const x = rbParse(s); if ((x.e - x.s) / 60 > rbRules().maxHours) { showToast(`That is ${(x.e - x.s) / 60} hours; the longest shift is ${rbRules().maxHours} h`, 'err'); return; } }
  const c = rbGroupCfg(g); if (!c.shifts.includes(s)) { c.shifts.push(s); c.shifts.sort((a, b) => rbMin(a) - rbMin(b)); c.need[s] = [1, 1, 1, 1, 1, 1, 1]; }
  _rbSetGroup(g, c); rbRender();
}
/** Who may work a shift (e.g. nights: Supervisors and Duty Managers only). */
function rbEditWho(g, s) {
  document.getElementById('rbMenu')?.remove();
  const c = rbGroupCfg(g), cur = rbWho(g, c)[s] || [];
  const m = document.createElement('div'); m.id = 'rbMenu'; m.className = 'rb-menu';
  m.innerHTML = `<div class="rb-menu-hd"><b>Who can work ${escapeHtml(s)}</b><span>${escapeHtml(g || 'Team')}</span></div>
    <div class="rb-who-list">${RB_TITLES.map(t => `<label class="rb-chk"><input type="checkbox" value="${escapeHtml(t)}"${cur.includes(t) ? ' checked' : ''}> ${escapeHtml(t)}</label>`).join('')}</div>
    <small class="ro-hint">Nothing ticked = everyone. People without one of the ticked titles are never put on this shift.</small>
    <div class="ro-acts"><button class="btn sm gold" onclick="rbSaveWho(${_rbQ(g)},${_rbQ(s)})">Save</button><button class="btn sm" onclick="document.getElementById('rbMenu').remove()">Cancel</button></div>`;
  document.body.appendChild(m);
  const w = Math.min(320, window.innerWidth - 16); m.style.width = w + 'px'; m.style.left = ((window.innerWidth - w) / 2) + 'px'; m.style.top = Math.max(8, (window.innerHeight - m.offsetHeight) / 2) + 'px';
}
function rbSaveWho(g, s) {
  const list = [...document.querySelectorAll('#rbMenu .rb-who-list input:checked')].map(x => x.value);
  const c = rbGroupCfg(g); c.who = Object.assign({}, rbWho(g, c)); c.who[s] = list.length ? list : ['*'];   // '*' = everyone, kept so the night default doesn't come back
  _rbSetGroup(g, c); document.getElementById('rbMenu')?.remove(); rbRender();
}
/** New hours for a shift (bus times changed): kept everywhere: cover, people, this week's draft. */
function rbEditShift(g, s) {
  const v = prompt(`New hours for ${s} (e.g. 07:30 - 16:30)`, s);
  const n = v && rbNorm(v);
  if (!v) return;
  if (!n) { showToast('Write the hours like 07:30 - 16:30', 'warn'); return; }
  const x = rbParse(n); if ((x.e - x.s) / 60 > rbRules().maxHours) { showToast(`That is ${(x.e - x.s) / 60} hours; the longest shift is ${rbRules().maxHours} h`, 'err'); return; }
  const c = rbGroupCfg(g);
  c.shifts = c.shifts.map(y => (y === s ? n : y)).sort((a, b) => rbMin(a) - rbMin(b)); c.need[n] = c.need[s]; delete c.need[s];
  _rbSetGroup(g, c);
  Object.keys(rbPeople).forEach(k => { const p = rbPeople[k]; if (!p || ((roStaff[k] || {}).group || '') !== g) return; let ch = false; if (p.fixed === s) { p.fixed = n; ch = true; } if (p.allowed && p.allowed.includes(s)) { p.allowed = p.allowed.map(y => (y === s ? n : y)); ch = true; } if (ch) fbSet('roster/builder/people/' + k, p); });
  Object.keys(rbDrafts).filter(w => w >= roMonday(new Date())).forEach(w => { const D = rbDrafts[w]; let ch = false; Object.keys(D.cells || {}).forEach(k => { if (((roStaff[k] || {}).group || '') !== g) return; Object.keys(D.cells[k]).forEach(dt => { const cur = D.cells[k][dt]; if (rbNorm(cur) === s) { D.cells[k][dt] = n + (rbParse(cur).note ? ' - ' + rbParse(cur).note : ''); ch = true; } }); }); if (ch) rbPutDraft(w); });
  rbRender();
  showToast(`${s} is now ${n}`, 'ok');
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
  // one rule = a title, a short hint and its control: − value + for numbers, a switch for yes/no
  const row = (title, hint, ctl, off) => `<div class="rr-row${off ? ' off' : ''}"><div class="rr-l"><b>${title}</b>${hint ? `<small>${hint}</small>` : ''}</div><div class="rr-c">${ctl}</div></div>`;
  const step = (val, min, max, set, unit) => `<div class="rr-step"><button type="button" aria-label="Less" onclick="rbStep(this,-1)">−</button><input type="number" inputmode="numeric" min="${min}" max="${max}" value="${val}" onchange="${set}">${unit ? `<span>${unit}</span>` : ''}<button type="button" aria-label="More" onclick="rbStep(this,1)">+</button></div>`;
  const sw = (on, set) => `<label class="rr-sw"><input type="checkbox" ${on ? 'checked' : ''} onchange="${set}"><i></i></label>`;
  const card = (ico, title, body) => `<div class="rr-card"><div class="rr-hd"><span>${ico}</span>${title}</div>${body}</div>`;
  const mgrs = Object.keys(roStaff).filter(k => rbMgrP({ title: rbTitle(k) }) && !((rbPeople[k] || {}).deleted)).map(k => (roStaff[k].name || k).split(' ')[0]);
  const hh = h => String(h % 24).padStart(2, '0') + ':00';
  return `<div class="rb-rules">
    <div class="rr-grid">
    ${card('😴', 'Rest & hours',
      row('Rest between shifts', 'at least', step(R.minRest, 6, 16, "rbSetRule('minRest',+this.value)", 'h'))
      + row('Only if there\'s no other way', 'down to, one hour at a time; it tells you who and why', step(R.restFloor != null ? R.restFloor : 7, 0, R.minRest, "rbSetRule('restFloor',this.value===''||isNaN(+this.value)?undefined:Math.max(0,Math.min(+this.value,rbRules().minRest)))", 'h'))
      + row('Days in a row', 'at most', step(R.maxRun, 3, 14, "rbSetRule('maxRun',+this.value)", 'days'))
      + row('Longest shift', '', step(R.maxHours, 6, 12, "rbSetRule('maxHours',+this.value)", 'h'))
      + row('Day off between night and day', 'no night on Monday then 08:00 on Tuesday', sw(R.nightSwitch !== false, "rbSetRule('nightSwitch',this.checked)")))}
    ${card('🛎', 'Desk & cover',
      row('People on the desk at once', 'aim for; 1 = off', step(R.deskMin, 1, 6, "rbSetRule('deskMin',+this.value)", ''))
      + row('From', 'e.g. one on 08–17 and one on 12–21 = two at once 12–17', step(R.deskFrom, 0, 23, "rbSetRule('deskFrom',+this.value)", ':00'))
      + row('To', R.deskTo % 24 < R.deskFrom % 24 ? 'the next day (runs past midnight)' : hh(R.deskFrom) + ' – ' + hh(R.deskTo), step(R.deskTo, 0, 24, "rbSetRule('deskTo',+this.value)", ':00'))
      + row('One person on a shift', 'only when there\'s no other way', sw(R.allowOne !== false, "rbSetRule('allowOne',this.checked)")))}
    ${card('🏖', 'PH days',
      row('Give PH owed', 'the last option: only when a shift has someone spare anyway', sw(R.givePh, "rbSetRule('givePh',this.checked);rbRender()"))
      + row('People a week, per hotel', 'the biggest balance first', step(R.phPeople == null ? 1 : R.phPeople, 0, 9, "rbSetRule('phPeople',Math.max(0,Math.min(9,+this.value||0)))", ''), !R.givePh)
      + row('PH each', 'a week normally has one day off (4 a month)', step(R.phMax == null ? 1 : R.phMax, 0, 3, "rbSetRule('phMax',Math.max(0,Math.min(3,+this.value||0)))", ''), !R.givePh))}
    ${card('🏨', 'Hotels & managers',
      row('Keep everyone in their own hotel', R.lend === false ? 'nobody is moved, by the builder or in suggestions' : 'off: moved only when a shift would be empty, one pair of hotels a week', sw(R.lend === false, "rbSetRule('lend',!this.checked);rbRender()"))
      + row('Managers keep their own shift', 'never moved to cover; unlock one on their card', sw(R.lockMgr !== false, "rbSetRule('lockMgr',this.checked);rbRender()"))
      + row('Managers on duty each day', `all hotels together; 0 = off · ${mgrs.length ? 'now: ' + escapeHtml(mgrs.join(', ')) : 'nobody has the title yet (their card in 🧑‍💼 Team)'}`, step(R.mgrMin, 0, 3, "rbSetRule('mgrMin',Math.max(0,Math.min(3,+this.value||0)))", '')))}
    </div>
    ${typeof hdPanelHtml === 'function' ? hdPanelHtml() : `<div class="rb-sub">Public holidays</div>
    <div class="rb-hols">${hol.map((h, i) => `<span class="rb-hol">${escapeHtml(roDayLbl(h.date, true))}${h.name ? ' · ' + escapeHtml(h.name) : ''}<button class="ro-x" onclick="rbDelHol(${i})">✕</button></span>`).join('') || '<span class="ro-empty">None added yet.</span>'}</div>
    <div class="rb-inline"><input type="date" id="rbHd"><input id="rbHn" placeholder="Name, e.g. National Day"><button class="btn sm" onclick="rbAddHol()">+ Holiday</button></div>`}
    ${typeof rtTaskTimesHtml === 'function' ? rtTaskTimesHtml() : ''}
  </div>`;
}
/** − / + next to a number: change it and save it like typing it would. */
function rbStep(btn, d) { const inp = btn.parentNode.querySelector('input'); if (!inp) return; const v = Math.max(+inp.min, Math.min(+inp.max, (+inp.value || 0) + d)); if (v === +inp.value) return; inp.value = v; inp.dispatchEvent(new Event('change')); }
function rbSetRule(k, v) { rbSettings.rules = Object.assign({}, rbSettings.rules, { [k]: v }); fbSet('roster/builder/settings/rules', rbSettings.rules); rbRefreshOut(); }
function rbAddHol() { const d = document.getElementById('rbHd').value; if (!d) return; const h = (rbSettings.holidays || []).concat([{ date: d, name: document.getElementById('rbHn').value.trim() }]).sort((a, b) => a.date.localeCompare(b.date)); rbSettings.holidays = h; fbSet('roster/builder/settings/holidays', h); rbRender(); }
function rbDelHol(i) { const h = (rbSettings.holidays || []).slice(); h.splice(i, 1); rbSettings.holidays = h; fbSet('roster/builder/settings/holidays', h); rbRender(); }

// ── The draft: table, cover, problems ─────────────────────
function rbOutHtml(shown, dates) {
  _rbDefGen++;
  const I = rbInput(rbSeed), cells = rbDrafts[rbWeek].cells || {};
  I.people.forEach(p => { cells[p.key] = cells[p.key] || {}; });
  const cover = rbCover(I, cells), probs = rbProblems(I, cells, cover);
  const name = k => (roStaff[k] || {}).name || k;
  const today = roToday();
  const chg = new Set(rbChanges(I, cells, dates).filter(c => !c.week).map(c => c.key + '|' + c.date));
  const rows = shown.map(g => `${shown.length > 1 || g ? `<tr class="ro-sec"><td colspan="9"><span>${escapeHtml(g || 'Team')}</span></td></tr>` : ''}${rbMembers(g).map(k => `<tr><td class="ro-name" title="${escapeHtml(name(k))}"><button class="ro-tap" onclick="rtPerson(${_rbQ(k)})">${escapeHtml(name(k))}${rbTitle(k) || rbLockMark(I, k) ? `<i class="rt-t">${escapeHtml(rbTitle(k))}${rbLockMark(I, k)}</i>` : ''}</button></td>${dates.map(dt => { const v = cells[k][dt] || '', i = roInfo(v); const bad = probs.some(p => p.key === k && p.date === dt); return `<td class="ro-cell ${i ? 'ro-t-' + i.type : ''}${bad ? ' ro-unsure' : ''}${dt === today ? ' ro-today' : ''}${chg.has(k + '|' + dt) ? ' rb-chg' : ''}" data-k="${escapeHtml(k)}" data-d="${dt}" onclick="if(!this.dataset.noClick)rbPick(this,${_rbQ(k)},'${dt}')" title="${escapeHtml(v || 'empty')}: tap to change, or drag onto another cell to swap">${escapeHtml(roCellTxt(i)) || '·'}${i && i.note ? `<i class="ro-note">${escapeHtml(i.note)}</i>` : ''}${typeof evMark === 'function' ? evMark(k, dt) : ''}</td>`; }).join('')}${rbTotCell(k, cells[k], dates, probs)}</tr>`).join('')}`).join('');
  const covers = rbWithPosts(shown).map(g => { const G = I.groups[g]; if (!G) return ''; return `<div class="rb-sub">${escapeHtml(g || 'Team')} · cover</div><div class="ro-scroll"><table class="ro-table rb-cover"><thead><tr><th class="ro-name">Shift</th>${dates.map(dt => `<th>${escapeHtml(roDayLbl(dt))}</th>`).join('')}</tr></thead><tbody>${G.shifts.map(s => `<tr><td class="ro-name">${escapeHtml(s)}</td>${dates.map((dt, d) => { const n = (G.need[s] || [])[d] || 0, h = cover[g][s][d]; return `<td class="${h < n ? 'rb-cv-short' : h > n ? 'rb-cv-over' : 'rb-cv-ok'} rb-covtap" title="Who can take ${escapeHtml(s)} on ${escapeHtml(roDayLbl(dt))}" onclick="rbGapMenu(${_rbQ(g)},${_rbQ(s)},'${dt}')">${h}/${n}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`; }).join('');
  const inShown = p => !p.group || shown.includes(rbBaseGroup(p.group)) || (p.key && shown.includes((roStaff[p.key] || {}).group || ''));
  const P = probs.filter(inShown);
  const ptxt = p => p.kind === 'short' ? `${escapeHtml(roDayLbl(p.date))} · ${escapeHtml(p.shift)}${shown.length > 1 || p.group !== rbBaseGroup(p.group) ? ' · ' + escapeHtml(p.group) : ''}: needs ${p.need}, has ${p.have}`
    : p.kind === 'rest' ? `${escapeHtml(name(p.key))}: ${p.hours <= 0 ? 'shifts overlap' : 'only ' + Math.round(p.hours) + ' h rest'} before ${escapeHtml(roDayLbl(p.date))} (${escapeHtml(p.from)} → ${escapeHtml(p.to)})`
    : p.kind === 'run' ? `${escapeHtml(name(p.key))}: ${p.days} days in a row by ${escapeHtml(roDayLbl(p.date))}`
    : p.kind === 'thin' ? `${escapeHtml(roDayLbl(p.date))} · ${escapeHtml(p.shift)}${shown.length > 1 || p.group !== rbBaseGroup(p.group) ? ' · ' + escapeHtml(p.group) : ''}: ${p.have ? `one person (ideal ${p.need})` : 'nobody'}`
    : p.kind === 'switch' ? `${escapeHtml(name(p.key))}: ${escapeHtml(p.from)} then ${escapeHtml(p.to)} on ${escapeHtml(roDayLbl(p.date))}: night and day shifts need a day off between`
    : p.kind === 'who' ? `${escapeHtml(name(p.key))}: ${escapeHtml(p.code)} on ${escapeHtml(roDayLbl(p.date))} is for ${escapeHtml((p.who || []).join(', '))} only`
    : p.kind === 'long' ? `${escapeHtml(name(p.key))}: ${escapeHtml(p.code)} on ${escapeHtml(roDayLbl(p.date))} is ${p.hours} h (over ${rbRules().maxHours})`
    : `${escapeHtml(name(p.key))}: ${p.have} day${p.have === 1 ? '' : 's'} off (should have ${p.need})`;
  return `<div class="card rb-draft">
    <div class="ro-card-hd"><b>📋 Draft roster · ${escapeHtml(rbWeekLabel(rbWeek))}</b><span>built ${escapeHtml(new Date(rbDrafts[rbWeek].at || Date.now()).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }))} · tap a cell to change it</span></div>
    ${rbHealthHtml(I, cells, cover, P, shown, dates)}
    ${P.some(p => p.kind !== 'short' && p.kind !== 'thin') ? `<div class="rb-probs">${P.filter(p => p.kind !== 'short' && p.kind !== 'thin').map(p => { const agreed = rbNoted(p); return `<div class="rb-prob ${p.kind}${agreed ? ' agreed' : ''}">${agreed ? '⚠ Bent on purpose (see Decisions):' : '⛔'} ${ptxt(p)}</div>`; }).join('')}</div>` : ''}
    ${rbDecisionsHtml(I, cells, shown, dates)}
    ${rbFixHtml(I, cells, shown, ptxt)}
    ${chg.size ? rbChangesHtml(I, cells, shown, dates) : ''}
    <div class="rb-tools"><button class="btn sm" onclick="rbUndo()"${rbUndoStack.length ? '' : ' disabled'} title="Undo (Ctrl+Z)">↶ Undo</button>${rbLegendHtml()}</div>
    <small class="rb-hint">Tap a cell to change it · drag onto another to swap (long-press on a phone) · tap a name for their card</small>
    <div class="ro-scroll"><table class="ro-table rb-table${rbHi ? ' rb-hi rb-hi-' + rbHi : ''}" id="rbTable"><thead><tr><th class="ro-name">Name</th>${dates.map(dt => `<th>${escapeHtml(roDayLbl(dt))}</th>`).join('')}<th class="rb-tot" title="Days worked · hours this week">Week</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${rbDefer('rbDeskD', () => rbDeskHtml(I, cells, shown, dates))}
    <details class="rb-covers"${P.some(p => p.kind === 'short' || p.kind === 'thin') ? ' open' : ''}><summary>Cover: people on each shift (has / needs) · tap a number for who can take it</summary>${covers}</details>
    ${(() => { const H = rbHappyHtml(I, cells, shown, dates); return `<details class="rb-covers"><summary>💛 Team happiness${H.sum ? ': ' + H.sum : ''}</summary>${H.html}</details>`; })()}
    ${(() => { const B = rbPhHtml(I, cells, shown, dates); return B ? `<details class="rb-covers"${B.open ? ' open' : ''}><summary>🏖 PH balance: ${B.sum}</summary>${B.html}</details>` : ''; })()}
    ${(() => { const L = rbLearnedHtml(I, shown); return `<details class="rb-covers"><summary>🧠 What I learned: ${L.sum}</summary>${L.html}</details>`; })()}
    <details class="rb-covers"><summary>📊 Fairness: nights, weekends and hours over the last 4 weeks and this one</summary>${rbFairHtml(I, cells, shown, dates)}</details>
    <div class="ro-acts rb-acts">
      <button class="btn gold" onclick="rbPublish()">📤 Publish to the team</button>
      <button class="btn" onclick="rbSharePic()">🖼 Picture to share</button>
      <button class="btn" onclick="rbCopy(this)">📋 Copy for Excel</button>
      <button class="btn" onclick="rbClearDraft()">🗑 Discard draft</button>
    </div>
  </div>`;
}
/** Hours that change from one working day to the next (people dislike it): marked and listed. */
function rbChanges(I, cells, dates) {
  const out = [];
  I.people.forEach(p => { let prev = p.lastShift || ''; dates.forEach((dt, d) => { const v = (cells[p.key] || {})[dt] || ''; if (rbParse(v) && rbParse(prev) && rbNorm(v) !== rbNorm(prev)) out.push({ key: p.key, date: dt, from: rbNorm(prev), to: rbNorm(v), back: rbParse(v).s < rbParse(prev).s, week: d === 0 }); prev = v; }); });
  return out;
}
/** The draft at a glance: cover, rules, one-person shifts, steady hours, total hours. */
function rbHealthHtml(I, cells, cover, P, shown, dates) {
  let need = 0, have = 0, hours = 0;
  shown.forEach(g => { const G = I.groups[g]; if (!G) return; G.shifts.forEach(sh => dates.forEach((dt, d) => { const n = (G.need[sh] || [])[d] || 0; need += n; have += Math.min(n, ((cover[g] || {})[sh] || [])[d] || 0); })); });
  shown.forEach(g => rbMembers(g).forEach(k => dates.forEach(dt => { const x = rbParse((cells[k] || {})[dt]); if (x) hours += (x.e - x.s) / 60; })));
  const short = P.filter(p => p.kind === 'short').length, thin = P.filter(p => p.kind === 'thin' && !(I.groups[p.group] || {}).post).length, bad = P.filter(p => p.kind !== 'thin').length;
  const ch = rbChanges(I, cells, dates).filter(c => !c.week && shown.includes((roStaff[c.key] || {}).group || '')).length;
  _rbHealth = { week: rbWeek, bad, thin };
  const chip = (cls, big, lbl, tip) => `<div class="rb-h ${cls}" title="${escapeHtml(tip)}"><b>${big}</b><span>${lbl}</span></div>`;
  return `<div class="rb-health">
    ${chip(short ? 'bad' : 'ok', `${have}<small>/${need}</small>`, 'places filled', short ? short + ' shift' + (short === 1 ? '' : 's') + ' short' : 'every shift has its people')}
    ${chip(bad - short ? 'bad' : 'ok', bad - short ? bad - short : '✓', bad - short ? 'rule breaks' : 'rules kept', 'rest, days off, days in a row, night ↔ day, who can work nights, 9 h')}
    ${rbDeskChip(I, cells, shown, chip)}
    ${chip(thin ? 'warn' : 'ok', thin, 'one-person', 'shifts where the ideal is two but only one is on')}
    ${(() => { const mg = I.people.filter(rbMgrP), min = rbRules().mgrMin; if (mg.length < 2 || !(min > 0)) return ''; const none = dates.filter(dt => mg.filter(p => rbParse((cells[p.key] || {})[dt])).length < min); return chip(none.length ? 'warn' : 'ok', none.length ? none.length : '✓', none.length ? 'days without a manager' : 'manager every day', none.length ? 'No Manager / Asst. Manager on duty (any hotel): ' + none.map(dt => roDayLbl(dt)).join(', ') : 'At least ' + min + ' manager on duty every day, across all hotels'); })()}
    ${(() => { const cl = rbSeniorClash(I, cells, dates).filter(c => shown.includes(c.hotel)); return cl.length ? chip('bad', cl.length, 'DM + Supervisor together', cl.map(c => `${roDayLbl(c.date)} ${c.shift.slice(0, 5)} at ${c.hotel}: ${c.keys.map(k => ((roStaff[k] || {}).name || k).split(' ')[0]).join(' + ')}`).join(' · ') + '. A Duty Manager and a Supervisor should not be on the same shift: tap a cell to move one') : ''; })()}
    ${(() => { if (Object.keys(I.groups).filter(g => !I.groups[g].post).length < 2) return ''; const mh = rbMoveHotels(I, cells); let n = 0; I.people.forEach(p => Object.values(cells[p.key] || {}).forEach(v => { const x = rbParse(v); if (x && x.note && rbBaseGroup(rbAt(I, p, x)) !== rbBaseGroup(p.group)) n++; })); return chip(!n ? 'ok' : mh.size > 2 ? 'bad' : 'warn', n ? n : '✓', n ? (mh.size > 2 ? 'moves, ' + mh.size + ' hotels' : 'moved shifts') : 'nobody moved', n ? 'Shifts worked at another hotel: ' + [...mh].join(' ↔ ') + (mh.size > 2 ? '. More than one pair of hotels: only because there was no other way' : '') : 'Everyone works at their own hotel'); })()}
    ${chip(ch ? 'warn' : 'ok', ch, 'hours changes', 'hours that change in the middle of a run of working days')}
    ${chip('', Math.round(hours), 'hours planned', 'all shifts this week')}
  </div>`;
}
/** Share of the desk hours with the target number of people on at once. */
function rbDeskChip(I, cells, shown, chip) {
  const R = rbRules(); if (!rbDeskOn(R)) return '';
  let ok = 0, all = 0;
  shown.forEach(g => { const gr = rbDesk(I, cells, g); if (!gr) return; gr.forEach(row => row.forEach((c, h) => { if (rbDeskHour(R, h)) { all++; if (c >= R.deskMin) ok++; } })); });
  if (!all) return '';
  const pc = Math.round(ok / all * 100);
  return chip(pc >= 90 ? 'ok' : pc >= 60 ? 'warn' : 'bad', pc + '<small>%</small>', `${R.deskMin} on desk`, `${ok} of ${all} hours between ${R.deskFrom}:00 and ${R.deskTo}:00 have ${R.deskMin} or more people on at once`);
}
/** Hour by hour: how many are on the desk, who, and where someone is alone. */
function rbDeskHtml(I, cells, shown, dates) {
  const R = rbRules();
  const first = k => ((roStaff[k] || {}).name || k).split(' ')[0];
  const blocks = shown.map(g => {
    const G = I.groups[g]; if (!G) return '';
    const who = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => []));
    I.people.forEach(p => {
      const put = (code, d, at) => { const x = rbParse(code); if (!x || at !== g) return; const H = rbShiftHours(code); if (d >= 0) H[0].forEach(h => who[d][h].push(first(p.key))); if (d + 1 < 7) H[1].forEach(h => who[d + 1][h].push(first(p.key))); };
      dates.forEach((dt, d) => { const v = cells[p.key] && cells[p.key][dt], x = rbParse(v); if (x) put(v, d, rbAt(I, p, x)); });
      if (p.group === g && p.lastShift) put(p.lastShift, -1, g);
    });
    const solo = {};   // "09–12" → days
    const rows = dates.map((dt, d) => {
      let run = null;
      const flush = h => { if (run != null) { const k = `${String(run).padStart(2, '0')}–${String(h).padStart(2, '0')}`; (solo[k] = solo[k] || []).push(d); run = null; } };
      const tds = who[d].map((names, h) => {
        const c = names.length, inWin = rbDeskOn(R) && rbDeskHour(R, h), low = inWin && c < R.deskMin;
        if (low && c > 0) { if (run == null) run = h; } else flush(h);
        const cls = c === 0 ? 'z' : low ? 'lo' : c >= 2 ? 'ok' : 'one';
        const best = low ? rbDeskBest(G, h) : '';
        return `<td class="rb-dk ${cls}${inWin ? '' : ' out'}" title="${escapeHtml(roDayLbl(dt))} ${h}:00–${h + 1}:00 · ${c ? escapeHtml(names.join(', ')) : 'nobody'}${best ? ' · tap: who can take ' + escapeHtml(best) : ''}"${best ? ` onclick="rbGapMenu(${_rbQ(g)},${_rbQ(best)},'${dt}')"` : ''}>${c || ''}</td>`;
      }).join('');
      flush(24);
      return `<tr><th>${escapeHtml(roDayLbl(dt).split(' ')[0])}</th>${tds}</tr>`;
    }).join('');
    const DN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const days = ds => ds.length === 7 ? 'every day' : ds.map(d => DN[d]).join(', ');
    const sl = Object.entries(solo).sort((a, b) => b[1].length - a[1].length);
    return `<div class="rb-sub">${escapeHtml(g || 'Team')}</div>
      <div class="ro-scroll"><table class="rb-desk"><thead><tr><th></th>${Array.from({ length: 24 }, (_, h) => `<th>${h % 3 === 0 ? h : ''}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
      ${rbDeskOn(R) ? (sl.length ? `<div class="rb-desk-note">👤 Alone at the desk: ${sl.slice(0, 5).map(([k, ds]) => `<b>${k}</b> ${days(ds)}`).join(' · ')}${sl.length > 5 ? ' …' : ''}</div>` : `<div class="rb-desk-note ok">✓ ${R.deskMin} or more on the desk from ${R.deskFrom}:00 to ${R.deskTo}:00 every day</div>`) : ''}
      ${rbDeskAdviceHtml(g, days)}`;
  }).join('');
  return `<details class="rb-covers rb-desk-wrap" open><summary>🕐 On the desk, hour by hour${rbDeskOn(R) ? ` · aim: ${R.deskMin} at once from ${R.deskFrom}:00 to ${R.deskTo}:00` : ''}</summary>
    ${blocks}
    <small class="ro-hint">Number = people on at that hour (hover or long-press for names). Amber = alone when the aim is ${R.deskMin}; tap it for who can come in on an overlapping shift. Set the aim in ⚖️ Rules.</small></details>`;
}
/** Same number of people, more overlap: ways to move places in the cover table from one shift to another
 *  (on every day it fits) that leave fewer hours with someone alone at the desk. Best on paper first. */
function rbDeskCands(g) {
  const R = rbRules(); if (!rbDeskOn(R)) return [];
  const c = rbGroupCfg(g), who = rbWho(g, c);
  const base = {}; c.shifts.forEach(x => { base[x] = (c.need[x] || [0, 0, 0, 0, 0, 0, 0]).slice(); });
  const clone = n => { const o = {}; c.shifts.forEach(x => { o[x] = n[x].slice(); }); return o; };
  const score = n => { const gr = rbDeskGrid(c.shifts, (d, x) => n[x][d] || 0, x => n[x][6] || 0); let gap = 0, zero = 0; gr.forEach(row => row.forEach((v, h) => { if (rbDeskHour(R, h) && v < R.deskMin) gap += R.deskMin - v; if (v === 0) zero++; })); return { gap, zero }; };
  const moves = n => { const cur = score(n), out = [];
    c.shifts.forEach(a => c.shifts.forEach(b => {
      if (a === b || who[b]) return;                                   // nights for some titles only: never moved into
      const days = [0, 1, 2, 3, 4, 5, 6].filter(d => n[a][d] >= 2);   // a shift keeps at least one person
      if (!days.length) return;
      const m = clone(n); days.forEach(d => { m[a][d]--; m[b][d]++; });
      const r = score(m); if (r.zero <= cur.zero && r.gap < cur.gap) out.push({ from: a, to: b, days, need: m, gap: r.gap });
    }));
    return out.sort((x, y) => x.gap - y.gap); };
  const out = [], seen = new Set();
  moves(base).slice(0, 4).forEach(m1 => {
    out.push({ moves: [m1], need: m1.need, gap: m1.gap });
    const m2 = moves(m1.need)[0]; if (m2) out.push({ moves: [m1, m2], need: m2.need, gap: m2.gap });
  });
  return out.filter(o => { const k = JSON.stringify(o.need); if (seen.has(k)) return false; seen.add(k); return true; }).sort((x, y) => x.gap - y.gap).slice(0, 3);
}
/** Each idea is built with the real team before it is shown: kept only if every shift and rule holds as well as now. */
const _rbDeskChecked = {};
function _rbDeskKey(g) { const c = rbGroupCfg(g); return JSON.stringify([rbWeek, g, c.shifts, c.need, rbRules(), rbReqs[rbWeek] || {}, rbPeople, Object.keys(roStaff).length]); }
function rbDeskCheck(g, done) {
  const key = _rbDeskKey(g); if (_rbDeskChecked[key]) { if (!_rbDeskChecked[key].pending) done(_rbDeskChecked[key]); else _rbDeskChecked[key].wait.push(done); return; }
  const cands = rbDeskCands(g); if (!cands.length) { done(_rbDeskChecked[key] = { best: null }); return; }
  const R = rbRules();
  _rbDeskChecked[key] = { pending: true, wait: [done] };   // renders meanwhile wait for this check instead of starting another
  const finish = st => { const w = _rbDeskChecked[key].wait; _rbDeskChecked[key] = st; w.forEach(f => f(st)); };
  const run = need => { const I = rbInput(1); if (need) I.groups[g] = Object.assign({}, I.groups[g], { need }); const res = rbSolve(I); return { bad: res.problems.filter(p => p.kind !== 'thin').length, thin: res.problems.filter(p => p.kind === 'thin').length, alone: rbDeskShort(rbDesk(I, res.cells, g), R).hours }; };
  let i = -1, base = null, best = null;
  const step = () => {
    if (rbWeek !== JSON.parse(key)[0]) { delete _rbDeskChecked[key]; return; }
    if (i < 0) base = run(null);
    else { const o = cands[i], r = run(o.need); if (r.bad <= base.bad && r.thin <= base.thin && r.alone < base.alone && (!best || r.alone < best.r.alone)) best = { o, r }; }
    if (++i < cands.length) setTimeout(step, 0); else finish({ best, base });
  };
  setTimeout(step, 30);
}
function rbDeskApply(g) {
  const st = _rbDeskChecked[_rbDeskKey(g)]; if (!st || !st.best) return;
  const c = rbGroupCfg(g); c.need = Object.assign({}, c.need, st.best.o.need);
  _rbSetGroup(g, c);
  if (typeof rtIsPublished === 'function' && rtIsPublished(rbWeek)) { rbRender(); showToast('Cover changed. The posted week stays as it is; the next week you build uses it', 'ok'); return; }
  if (rbDrafts[rbWeek]) rbUndoPush();
  rbSeed = 1; _rbBuildNow();
  showToast('Cover changed and the week built again with more overlap. ↶ Undo brings the old draft back', 'ok');
}
function rbDeskAdviceHtml(g, days) {
  const id = 'rbDT_' + g.replace(/[^A-Za-z0-9]/g, '_');
  const st = _rbDeskChecked[_rbDeskKey(g)];
  if (st && !st.pending) { setTimeout(() => rbDeskFill(g, id, days, st), 0); return `<div id="${id}"></div>`; }
  if (!rbDeskOn(rbRules()) || !rbDeskCands(g).length) return '';
  // test-building the week several times takes a few seconds: only when asked, never in the background
  return `<div id="${id}"><button class="btn sm rb-desk-ask" onclick="rbDeskAsk(${_rbQ(g)},'${id}')">💡 Can the same people overlap more? Check</button></div>`;
}
function rbDeskAsk(g, id) {
  const el = document.getElementById(id); if (!el) return;
  el.innerHTML = '<div class="ri-reading ro-busy">' + roBusyAnim('build') + '<div><b>Trying it with your team…</b><small>A few seconds: the week is built each way to make sure every shift stays covered.</small></div></div>';
  const DN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], days = ds => ds.length === 7 ? 'every day' : ds.map(d => DN[d]).join(', ');
  setTimeout(() => rbDeskCheck(g, st => rbDeskFill(g, id, days, st, true)), 60);
}
function rbDeskFill(g, id, days, st, asked) {
  const el = document.getElementById(id); if (!el) return;
  if (!st.best) { el.innerHTML = asked ? '<small class="ro-hint">✓ Checked: with this team, moving places in the cover table doesn\'t give more overlap without leaving a shift short.</small>' : ''; return; }
  const { o, r } = st.best;
  el.innerHTML = `<div class="rb-desk-tip"><b>💡 Same people, more overlap</b>${o.moves.map(m => `<div>Move one place from <b>${escapeHtml(m.from)}</b> to <b>${escapeHtml(m.to)}</b> (${days(m.days)})</div>`).join('')}
      <small>Alone at the desk: ${st.base.alone} h → ${r.alone} h a week. Built with your team to check: ${r.bad ? `${r.bad} problem${r.bad === 1 ? '' : 's'}, no more than now` : 'every shift covered, all rules kept'}; nobody works more. It changes 👥 Cover needed.</small>
      <button class="btn sm gold" onclick="rbDeskApply(${_rbQ(g)})">Use this</button></div>`;
}
/** The shift that best gives a second person at hour h: it covers h and starts on that day, the longest overlap first. */
function rbDeskBest(G, h) {
  let best = '', bl = -1;
  G.shifts.forEach(s => { const H = rbShiftHours(s); if (!H || !H[0].includes(h)) return; const l = H[0].length; if (l > bl) { bl = l; best = s; } });
  return best;
}
/** 🔒 shift locked, 🏨 stays at their hotel (all of them when lending between hotels is off). */
function rbLockMark(I, k) { const p = I.people.find(x => x.key === k); return p ? `${p.lock ? ' 🔒' : ''}${p.home && I.rules.lend !== false ? ' 🏨' : ''}` : ''; }
/** Days worked and hours this week, for the last column. */
function rbTotCell(k, row, dates, probs) {
  let d = 0, h = 0; dates.forEach(dt => { const x = rbParse((row || {})[dt]); if (x) { d++; h += (x.e - x.s) / 60; } });
  const bad = probs.some(p => p.key === k && p.kind === 'offs');
  return `<td class="rb-tot${bad ? ' bad' : ''}" title="${d} days, ${h} hours${bad ? ': wrong number of days off' : ''}"><b>${d}d</b><small>${Math.round(h)}h</small></td>`;
}
/** Highlight one kind of shift in the table. */
let rbHi = '';
const RB_HI = [['morning', 'Morning'], ['afternoon', 'Afternoon'], ['night', 'Night'], ['off', 'Off'], ['leave', 'Leave'], ['chg', '↻ Changes']];
function rbLegendHtml() {
  return `<div class="rb-legend" role="group" aria-label="Highlight">${RB_HI.map(([t, l]) => `<button class="rb-lg ro-t-${t}${rbHi === t ? ' on' : ''}" onclick="rbSetHi('${t}')"><i></i>${l}</button>`).join('')}</div>`;
}
function rbSetHi(t) {
  rbHi = rbHi === t ? '' : t;
  const tb = document.getElementById('rbTable'); if (tb) tb.className = `ro-table rb-table${rbHi ? ' rb-hi rb-hi-' + rbHi : ''}`;
  document.querySelectorAll('.rb-lg').forEach(b => b.classList.toggle('on', b.classList.contains('ro-t-' + rbHi)));
}
/** 🧠 What the builder learned from the posted rosters, person by person (whoever made them). */
function rbLearnedHtml(I, shown) {
  const weeks = rbHistory(I.week, 8).filter(w => w < I.week).sort();
  if (!weeks.length) return { sum: 'no posted weeks yet', html: '<div class="ro-empty">Nothing to learn from yet. Post a week (a picture, Excel, or built here): every posted week teaches the builder how your team works.</div>' };
  const sh = x => { const i = roInfo(x); return i && i.from ? roShort(i) : x; };
  const rows = I.people.filter(p => shown.includes(rbBaseGroup(p.group)) && p.learnedFrom).map(p => {
    const c = rbPeople[p.key] || {}, bits = [];
    if (p.mode === 'static' && p.fixed) bits.push(`always ${sh(p.fixed)}${c.fixed || c.mode ? ' (set by you)' : ''}`);
    else if (p.mode === 'rotate') bits.push(`rotates week to week${p.lastMain ? ` · last week ${sh(p.lastMain)}${p.nextMain ? ` → usually ${sh(p.nextMain)} next` : ''}` : ''}`);
    else if (p.usual) bits.push(`mostly ${sh(p.usual)}`);
    const offs = (p.prefOff && p.prefOff.length ? p.prefOff : p.learnedOff || []);
    if (offs.length) bits.push(`off ${offs.map(d => RB_DAYS[d]).join(' & ')}${p.prefOff && p.prefOff.length ? ' (their wish)' : ' usually'}`);
    if (p.together || p.learnedTogether) bits.push('days off together');
    bits.push(`${p.offs} day${p.offs === 1 ? '' : 's'} off a week`);
    return `<div class="rb-ln-row"><b>${escapeHtml((roStaff[p.key] || {}).name || p.key)}</b><span>${bits.map(escapeHtml).join(' · ')}</span><small>${p.learnedFrom} wk</small></div>`;
  });
  const lbl = w => roDate(w).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return { sum: `from ${weeks.length} posted week${weeks.length === 1 ? '' : 's'}`, html: `<div class="rb-learned">${rows.join('')}</div><small class="ro-hint">Learned from the weeks posted here, whoever made them (built here, a picture, Excel, another manager): ${weeks.map(lbl).join(', ')}. Weeks with no roster are skipped. Anything set on someone's card comes first; post each week (even one you made yourself) and the builder keeps learning.</small>` };
}
/** Each person's wishes (💛 on their card) and which ones this week grants. */
function rbWishes(I, p, cells, dates) {
  const W = [], v = d => (cells[p.key] || {})[dates[d]] || '', worked = dates.map((_, d) => v(d)).filter(x => rbParse(x));
  const offD = dates.map((_, d) => d).filter(d => rbKind(v(d)) === 'off');
  // days they'd like off: one wish per day they can actually have (wishing for 4 days with 2 days off a week: 2 wishes, any of the 4)
  const want = (p.prefOff || []).filter(d => d >= 0 && d < 7), canHave = Math.min(want.length, Math.max(1, p.offs || 1)), got = want.filter(d => offD.includes(d)).length;
  if (want.length && want.length <= canHave) want.forEach(d => W.push({ t: `${RB_DAYS[d]} off`, ok: offD.includes(d) }));
  else if (want.length) for (let i = 0; i < canHave; i++) W.push({ t: `a day off on ${want.map(d => RB_DAYS[d]).join('/')}`, ok: got > i });
  if ((p.likes || []).length && worked.length) { const n = worked.filter(x => p.likes.includes(rbNorm(x))).length; W.push({ t: `likes ${p.likes.join(' / ')}`, ok: n * 2 >= worked.length, n: `${n} of ${worked.length} days` }); }
  if ((p.soft || []).length) { const bad = worked.filter(x => p.soft.includes(rbNorm(x))); W.push({ t: `not ${p.soft.join(' / ')}`, ok: !bad.length, n: bad.length ? `${bad.length} day${bad.length === 1 ? '' : 's'}` : '' }); }
  if (p.together && offD.length >= 2) W.push({ t: 'days off together', ok: offD.some((d, i) => i && d - offD[i - 1] === 1) });
  if (p.steady) { let ch = 0, prev = ''; dates.forEach((_, d) => { const x = v(d); if (rbParse(x) && rbParse(prev) && rbNorm(x) !== rbNorm(prev)) ch++; prev = x; }); W.push({ t: 'same hours', ok: !ch, n: ch ? `${ch} change${ch === 1 ? '' : 's'}` : '' }); }
  if (p.maxNights != null) { const n = worked.filter(x => rbIsNight(x)).length; W.push({ t: `at most ${p.maxNights} night${p.maxNights === 1 ? '' : 's'}`, ok: n <= p.maxNights, n: `${n} night${n === 1 ? '' : 's'}` }); }
  return W;
}
/** 🏖 PH owed, person by person: what this week clears and one-tap days where a PH fits (the shift has someone spare). */
function rbPhHtml(I, cells, shown, dates) {
  const G = I.groups, cover = rbCover(I, cells), isPh = v => /^PH\b/i.test(String(v || ''));
  const rows = I.people.filter(p => shown.includes(rbBaseGroup(p.group)) && cells[p.key] && (p.phOwed || 0) > 0).map(p => {
    const given = dates.filter(dt => isPh(cells[p.key][dt])).length, left = Math.max(0, p.phOwed - given);
    const fits = left ? dates.map((dt, d) => ({ dt, d, s: cells[p.key][dt] })).filter(x => x.s && G[p.group] && G[p.group].shifts.includes(x.s) && !((I.pre || {})[p.key] || {})[x.dt] && x.dt >= roToday() && cover[p.group][x.s][x.d] > (((G[p.group].need[x.s]) || [])[x.d] || 0)) : [];
    return { p, given, left, fits };
  }).sort((a, b) => b.left - a.left || b.p.phOwed - a.p.phOwed);
  if (!rows.length) return null;
  const owed = rows.reduce((t, r) => t + r.p.phOwed, 0), given = rows.reduce((t, r) => t + r.given, 0);
  return { open: rows.some(r => r.left && r.fits.length), sum: `${given} of ${owed} PH day${owed === 1 ? '' : 's'} owed given this week`, html: `<div class="rb-happy">${rows.map(r => `<div class="rb-hp-row"><span class="rb-hp-f">${r.left ? '🏖' : '✅'}</span><b>${escapeHtml((roStaff[r.p.key] || {}).name || r.p.key)}</b><span class="rb-hp-n">${r.p.phOwed}</span><span class="rb-hp-w">${r.given ? `<i class="ok">✓ ${r.given} given this week</i>` : ''}${r.left ? `<i class="no">${r.left} still owed${r.p.phLabels && r.p.phLabels[r.given] ? ' · oldest ' + escapeHtml(r.p.phLabels[r.given]) : ''}</i>` : ''}${r.fits.map(x => `<button class="btn sm ghost" onclick="rbGivePh(${_rbQ(r.p.key)},'${x.dt}')">PH on ${escapeHtml(RB_DAYS[x.d])}</button>`).join('')}${r.left && !r.fits.length ? '<em class="rb-hp-note">no spare shift this week: if they ask for a day off, tap → PH on the request</em>' : ''}</span></div>`).join('')}</div><small class="ro-hint">A week normally has one day off (4 a month), so PH is the last option: the builder gives one to ${rbRules().phPeople == null ? 1 : rbRules().phPeople} person a week per hotel, the biggest balance first, and only when a shift has someone spare anyway. The buttons show other days where a PH fits, if you decide to give one. Change the balance on the person's row under ⚙ Settings → People (PH owed).</small>` };
}
function rbGivePh(k, dt) {
  const D = rbDrafts[rbWeek]; if (!D || !D.cells) return;
  const cells = JSON.parse(JSON.stringify(D.cells)), L = rbPhNext(k, cells);
  (cells[k] = cells[k] || {})[dt] = L ? `PH - ${L}` : 'PH';
  rbApplyCells(cells, '');
}
/** A day-off request → a PH day, for someone with PH owed (it uses their balance instead of a normal day off). */
function rbReqToPh(id) {
  const r = (rbReqs[rbWeek] || {})[id]; if (!r) return;
  const n = Object.values(rbReqs[rbWeek]).filter(x => x !== r && x.key === r.key && x.type === 'ph').length;
  r.type = 'ph'; r.code = rbPhOwed(r.key, rbWeek).labels[n] || '';
  fbSet(`roster/builder/requests/${rbWeek}/${id}`, r);
  rbRender(); showToast('Changed to PH: it comes off their PH balance', 'ok');
}
/** 😊 How many wishes the week grants, person by person: the least happy first. */
function rbHappyHtml(I, cells, shown, dates) {
  const rows = I.people.filter(p => shown.includes(rbBaseGroup(p.group)) && cells[p.key]).map(p => ({ p, W: rbWishes(I, p, cells, dates) })).filter(r => r.W.length);
  const noted = I.people.filter(p => shown.includes(rbBaseGroup(p.group)) && (rbPeople[p.key] || {}).note && !rows.some(r => r.p === p));
  if (!rows.length) return { sum: '', html: '<div class="ro-empty">Nobody has wishes yet. Open someone\'s card (🧑‍💼 Team) → 💛 Likes & wishes: shifts they like, days they\'d like off, days off together, same hours all week, a limit on nights. The builder tries to grant them all.</div>' };
  rows.forEach(r => { r.ok = r.W.filter(w => w.ok).length; r.f = r.ok / r.W.length; });
  rows.sort((a, b) => a.f - b.f || (roStaff[a.p.key] || {}).name?.localeCompare((roStaff[b.p.key] || {}).name || ''));
  const all = rows.reduce((t, r) => t + r.W.length, 0), met = rows.reduce((t, r) => t + r.ok, 0);
  const face = f => f >= 1 ? '😊' : f >= 0.5 ? '🙂' : '😐';
  return { sum: `${face(met / all)} ${met} of ${all} wishes granted`, html: `<div class="rb-happy">${rows.map(r => `<div class="rb-hp-row"><span class="rb-hp-f">${face(r.f)}</span><b>${escapeHtml((roStaff[r.p.key] || {}).name || r.p.key)}</b><span class="rb-hp-n">${r.ok}/${r.W.length}</span><span class="rb-hp-w">${r.p.wishDebt >= 1 ? `<i class="owed" title="Wishes not granted in the last weeks count more this week">📈 first in line</i>` : ''}${(rbPeople[r.p.key] || {}).note ? `<em class="rb-hp-note">📝 ${escapeHtml(rbPeople[r.p.key].note)}</em>` : ''}${r.W.map(w => `<i class="${w.ok ? 'ok' : 'no'}">${w.ok ? '✓' : '✗'} ${escapeHtml(w.t)}${w.n && !w.ok ? ' · ' + escapeHtml(w.n) : ''}</i>`).join('')}</span><button class="btn sm ghost" onclick="rtPerson(${_rbQ(r.p.key)})">💛</button></div>`).join('')}</div>${noted.map(p => `<div class="rb-hp-row"><span class="rb-hp-f">📝</span><b>${escapeHtml((roStaff[p.key] || {}).name || p.key)}</b><span class="rb-hp-n"></span><span class="rb-hp-w"><em class="rb-hp-note">${escapeHtml(rbPeople[p.key].note)}</em></span><button class="btn sm ghost" onclick="rtPerson(${_rbQ(p.key)})">💛</button></div>`).join('')}<small class="ro-hint">Every week the builder reads the last 4 posted weeks: wishes that weren't granted lately count more now (📈 first in line), and whoever had more nights or fewer weekends off than the team gets the lighter side. Wishes are granted when the cover and the rest rules allow it. ✗ = not this week (usually because a shift would be empty otherwise). Try 🔀 another way to see a different week.</small>` };
}
/** Who has had the most nights, the fewest weekends off, the most hours: last 4 weeks plus this draft. */
function rbFairHtml(I, cells, shown, dates) {
  const weeks = [4, 3, 2, 1].map(n => roAdd(rbWeek, -7 * n));
  const rows = [];
  shown.forEach(g => rbMembers(g).forEach(k => {
    let nights = 0, wkOff = 0, hrs = 0, weeksSeen = 0;
    const tally = (get, ds) => { let seen = false; ds.forEach((dt, d) => { const v = get(dt); if (!v) return; seen = true; const x = rbParse(v), i = roInfo(v); if (x) { hrs += (x.e - x.s) / 60; if (x.type === 'night' || rbIsNight(rbNorm(v))) nights++; } else if (d >= 5 && i && (i.type === 'off' || i.type === 'leave')) wkOff++; }); if (seen) weeksSeen++; };
    weeks.forEach(w => tally(dt => (roDays[dt] || {})[k], Array.from({ length: 7 }, (_, d) => roAdd(w, d))));
    tally(dt => (cells[k] || {})[dt], dates);
    rows.push({ k, g, nights, wkOff, avg: weeksSeen ? hrs / weeksSeen : 0, weeksSeen });
  }));
  if (!rows.length) return '';
  const avgN = rows.reduce((a, r) => a + r.nights, 0) / rows.length, avgW = rows.reduce((a, r) => a + r.wkOff, 0) / rows.length;
  const maxN = Math.max(1, ...rows.map(r => r.nights)), maxW = Math.max(1, ...rows.map(r => r.wkOff));
  const bar = (v, max, hot) => `<span class="rb-fbar${hot ? ' hot' : ''}"><i style="width:${Math.round(v / max * 100)}%"></i><b>${v}</b></span>`;
  return `<div class="ro-scroll"><table class="ro-table rb-fair"><thead><tr><th class="ro-name">Name</th><th>Nights</th><th>Weekend days off</th><th>Hours a week</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td class="ro-name">${escapeHtml((roStaff[r.k] || {}).name || r.k)}${shown.length > 1 ? `<i class="rt-t">${escapeHtml(r.g)}</i>` : ''}</td><td>${bar(r.nights, maxN, r.nights > avgN * 1.6 && r.nights - avgN >= 3)}</td><td>${bar(r.wkOff, maxW, r.wkOff < avgW * 0.4 && avgW - r.wkOff >= 2)}</td><td>${r.weeksSeen ? Math.round(r.avg) : '–'}</td></tr>`).join('')}
  </tbody></table></div><small class="ro-hint">${rows[0].weeksSeen > 1 ? 'From the rosters in HotelOps plus this draft. Amber = well above (nights) or below (weekends off) the team.' : 'Fills in as more weeks are added to HotelOps.'} Static night staff will always show more nights.</small>`;
}
function rbChangesHtml(I, cells, shown, dates) {
  const ch = rbChanges(I, cells, dates).filter(c => !c.week && shown.includes((roStaff[c.key] || {}).group || ''));
  if (!ch.length) return '<div class="rb-steady">✓ Nobody\'s hours change in the middle of a run of working days.</div>';
  return `<div class="rb-steady warn">↻ Hours change mid-run (people dislike it): ${ch.map(c => `<b>${escapeHtml((roStaff[c.key] || {}).name || c.key)}</b> ${escapeHtml(roDayLbl(c.date))} ${escapeHtml(c.from.slice(0, 5))}→${escapeHtml(c.to.slice(0, 5))}${c.back ? ' (earlier)' : ''}`).join(' · ')}. Drag or tap a cell to even it out, or 🔀 Try another way.</div>`;
}
/** A shift that has already started (or a day gone by): nothing can change it any more. */
function rbShiftStarted(date, shift) {
  const m = String(shift || '').match(/(\d{1,2}):(\d{2})/), d = roDate(date);
  if (m) d.setHours(+m[1], +m[2], 0, 0); else d.setHours(23, 59, 0, 0);
  return d.getTime() <= Date.now();
}
/** Gaps in cover, each with the best ways to fill it (or "bring in a staff member"). */
function rbFixHtml(I, cells, shown, ptxt) {
  if (typeof rtAdvice !== 'function') return '';
  const keep = a => shown.includes(rbBaseGroup(a.group)) && !(I.groups[a.group] || {}).post   // a bell boy's day off needs no cover
    && !rbShiftStarted(a.date, a.shift);   // a shift already under way or gone by: nothing to fix any more
  _rbOpt = [];
  const head = adv => `<div class="rb-sub">Cover to fix <small>${adv.filter(a => a.kind === 'short').length} empty · ${adv.filter(a => a.kind === 'thin').length} with one person</small></div>`;
  const cached = typeof rtAdviceCached === 'function' ? rtAdviceCached(I, cells) : null;
  if (cached) { const adv = cached.filter(keep); return adv.length ? `<div class="rb-fix" id="rbFix">${head(adv)}${adv.slice(0, 12).map(a => rbGapHtml(I, cells, a, ptxt(a))).join('')}</div>` : ''; }
  // not worked out yet: the gaps show at once, and who can take each one fills in a moment later, one gap at a time,
  // so a tap on the table never waits for it
  const all = rbProblems(I, cells).filter(p => p.kind === 'short' || p.kind === 'thin'), shownIdx = all.map((a, i) => keep(a) ? i : -1).filter(i => i >= 0).slice(0, 12);
  if (!shownIdx.length && !all.length) return '';
  const gen = _rbDefGen, done = [];
  const step = i => {
    if (gen !== _rbDefGen) return;   // redrawn since: that redraw does its own
    if (i >= all.length) { if (typeof rtAdviceStore === 'function') rtAdviceStore(I, cells, done); return; }
    const a = Object.assign({}, all[i], { options: rtCoverOptions(I, cells, all[i].group, all[i].date, all[i].shift).slice(0, 3) });
    done.push(a);
    const el = document.getElementById('rbGap' + i); if (el) el.outerHTML = rbGapHtml(I, cells, a, ptxt(a));
    setTimeout(() => step(i + 1), 0);
  };
  setTimeout(() => step(0), 30);
  if (!shownIdx.length) return '';
  return `<div class="rb-fix" id="rbFix">${head(shownIdx.map(i => all[i]))}${shownIdx.map(i => `<div class="rb-fix-item ${all[i].kind || ''}" id="rbGap${i}"><div>${all[i].kind === 'short' ? '⚠' : '◐'} ${ptxt(all[i])}</div><div class="rb-fix-opts"><span class="rb-finding"><span class="ri-spin"></span> finding who can take it…</span></div></div>`).join('')}</div>`;
}
/** A part of the screen drawn a moment after the rest (heavy, and below the table): the table shows at once. */
let _rbDefGen = 0;
function rbDefer(id, fn) {
  const gen = _rbDefGen;
  setTimeout(() => { if (gen !== _rbDefGen) return; const el = document.getElementById(id); if (!el) return; try { el.outerHTML = fn() || ''; } catch (e) { console.error(e); el.remove(); } }, 0);
  return `<div id="${id}" class="rb-defer"></div>`;
}
/** One short shift: the people who can take it and why they're OK, and why not the others. */
function rbGapHtml(I, cells, a, title) {
  const opts = a.options || rtCoverOptions(I, cells, a.group, a.date, a.shift).slice(0, 3);
  const not = typeof rtWhyNot === 'function' ? rtWhyNot(I, cells, a.group, a.date, a.shift, opts.map(o => o.key)) : [];
  return `<div class="rb-fix-item ${a.kind || ''}"><div>${a.kind === 'short' ? '⚠' : '◐'} ${title}</div>
    <div class="rb-fix-opts">${opts.map(o => { if (!o.cells) return `<span class="rb-bring">🙋 ${escapeHtml(o.text)}</span>`; _rbOpt.push(o); return `<button class="btn sm" onclick="rbOptApply(${_rbOpt.length - 1})"><span>✓ ${escapeHtml(o.text)}</span>${o.ok ? `<small class="rb-ok">OK: ${escapeHtml(o.ok)}</small>` : ''}</button>`; }).join('')}</div>
    ${not.length ? `<details class="rb-whynot"><summary>Why not the others (${not.length})</summary><ul>${not.map(n => `<li><b>${escapeHtml(n.name)}</b>: ${escapeHtml(n.reason)}</li>`).join('')}</ul></details>` : ''}
  </div>`;
}
/** Tap a cell of the cover table: who can take that shift that day. */
function rbGapMenu(g, s, dt) {
  document.getElementById('rbMenu')?.remove();
  const I = rbInput(rbSeed), cells = rbDrafts[rbWeek].cells, d = rtDates(rbWeek).indexOf(dt);
  const need = ((I.groups[g] || {}).need[s] || [])[d] || 0, have = rbCover(I, cells)[g][s][d];
  const opts = rtCoverOptions(I, cells, g, dt, s).slice(0, 5);
  const m = document.createElement('div'); m.id = 'rbMenu'; m.className = 'rb-menu';
  m.innerHTML = `<div class="rb-menu-hd"><b>${escapeHtml(s)} · ${escapeHtml(roDayLbl(dt, true))}</b><span>${escapeHtml(g || 'Team')} · has ${have} / needs ${need}</span></div>
    ${rbGapHtml(I, cells, { group: g, shift: s, date: dt, kind: have === 0 ? 'short' : 'thin', options: opts }, have >= need ? 'Covered. To add one more:' : `Short by ${need - have}. You can put:`)}
    <div class="ro-acts"><button class="btn sm" onclick="document.getElementById('rbMenu').remove()">Close</button></div>`;
  document.body.appendChild(m);
  const w = Math.min(420, window.innerWidth - 16); m.style.width = w + 'px'; m.style.left = ((window.innerWidth - w) / 2) + 'px'; m.style.top = Math.max(8, (window.innerHeight - m.offsetHeight) / 2) + 'px';
  setTimeout(() => document.addEventListener('click', function close(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('click', close, true); } }, true), 0);
}
function rbRefreshOut() {
  const st = document.querySelector('.rb-status'); if (st) st.innerHTML = rbStatusHtml();
  const o = document.getElementById('rbOut');
  if (!o || !rbDrafts[rbWeek]) return;
  const groups = rbGroups(), shown = rbGroup && groups.includes(rbGroup) ? [rbGroup] : groups;
  o.innerHTML = rbOutHtml(shown, Array.from({ length: 7 }, (_, d) => roAdd(rbWeek, d)));
  const sp = document.getElementById('rbSteps'); if (sp) sp.innerHTML = rbStepsHtml();
}
function rbClearDraft() { if (!confirm('Discard this draft?')) return; clearTimeout(_rbSaving[rbWeek]); delete _rbSaving[rbWeek]; delete rbDrafts[rbWeek]; rbPutDraft(rbWeek); rbRender(); }

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
    <div class="rb-opts">${opt('OFF', 'OFF', 'ro-t-off')}${(() => { const L = rbPhNext(k); return opt(L ? 'PH - ' + L : 'PH', 'PH', 'ro-t-leave'); })()}${leave.slice(0, 8).map(c => opt(c, c, 'ro-t-leave')).join('')}</div>
    ${rbSwapMenuHtml(k, dt)}
    <div class="rb-opts"><small>Sick or leave from this day:</small>${['SL', 'AL', 'EL'].map(c => `<button class="rb-opt ro-t-leave" onclick="rbLeaveFrom(${_rbQ(k)},'${dt}','${c}')">${c} …</button>`).join('')}</div>
    ${others.length ? `<details class="rb-opts-more"><summary>Lend to another hotel…</summary><div class="rb-opts">${others.map(o => shifts.map(s => opt(`${s} - ${rbShortU(o)}`, `${s.slice(0, 5)} at ${rbShortU(o)}`, 'ro-t-other')).join('')).join('')}</div></details>` : ''}
    <div class="rb-inline"><input id="rbOther" placeholder="Other (e.g. TRN, 10:00 - 19:00)" value=""><button class="btn sm" onclick="rbSetCell(${_rbQ(k)},'${dt}',document.getElementById('rbOther').value)">Set</button><button class="btn sm" onclick="rbSetCell(${_rbQ(k)},'${dt}','')">Clear</button></div>`;
  document.body.appendChild(m);
  const r = td.getBoundingClientRect(), mw = Math.min(340, window.innerWidth - 16);
  m.style.width = mw + 'px';
  m.style.left = Math.max(8, Math.min(window.innerWidth - mw - 8, r.left + r.width / 2 - mw / 2)) + 'px';
  const top = r.bottom + 6, h = m.offsetHeight;
  m.style.top = (top + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : top) + 'px';
  setTimeout(() => document.addEventListener('click', function close(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('click', close, true); } }, true), 0);
}
function rbSwapMenuHtml(k, dt) {
  if (typeof rtSwapOptions !== 'function') return '';
  const opts = rtSwapOptions(rbInput(rbSeed), rbDrafts[rbWeek].cells, k, dt);
  _rbOpt = _rbOpt.slice(0, 200);
  return opts.length ? `<div class="rb-opts"><small>🔁 Swaps that keep everyone's rest and cover:</small>${opts.slice(0, 5).map(o => { _rbOpt.push(o); return `<button class="rb-opt rb-swap" onclick="document.getElementById('rbMenu')?.remove();rbOptApply(${_rbOpt.length - 1})">${escapeHtml(o.text)}</button>`; }).join('')}</div>` : '<div class="rb-opts"><small>🔁 No swap keeps everyone\'s rules on this day.</small></div>';
}
function rbLeaveFrom(k, dt, code) {
  const until = prompt(`${code} for ${(roStaff[k] || {}).name} from ${roDayLbl(dt)} until (date, e.g. ${roAdd(dt, 2)})`, dt);
  if (until == null) return;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(until.trim()) ? until.trim() : roParseDate(until, dt) || dt;
  document.getElementById('rbMenu')?.remove();
  rbUndoPush();
  rtMarkAbsent(k, dt, to, code);
  rbRender();
}
function rbSetCell(k, dt, v) {
  rbUndoPush();
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
  const names = [], out = {}, groups = {}, ids = {}, keys = {};
  rbGroups().forEach(g => rbMembers(g).forEach(k => {
    const s = roStaff[k]; if (!s) return;
    names.push(s.name); out[s.name] = Object.assign({}, cells[k] || {}); keys[s.name] = k;   // their own key: a renamed person stays one person
    if (g) groups[s.name] = g; if (s.id) ids[s.name] = s.id;
  }));
  return { names, dates, cells: out, groups, ids, keys, by: '🛠 Built in HotelOps' };
}
async function rbPublish() {
  window._rbContinue = false;   // publishing is never the "give this week's roster" step
  const res = rbAsRes();
  const probs = rbProblems(rbInput(rbSeed), rbDrafts[rbWeek].cells).length;
  if (probs && !confirm(`${probs} problem${probs === 1 ? '' : 's'} still in the draft. Publish anyway?`)) return;
  if (!confirm(rtIsPublished(rbWeek) ? `Publish the changes to ${rbWeekLabel(rbWeek)}? Only the people whose shifts change are told.` : `Publish the roster for ${rbWeekLabel(rbWeek)}? It replaces those days for everyone and tells the team.`)) return;
  const changes = typeof rtDiff === 'function' && rtIsPublished(rbWeek) ? rtDiff(rbWeek, rbDrafts[rbWeek].cells) : [];
  if (rtIsPublished(rbWeek)) {
    // a posted week: write only what changed and tell those people
    if (!changes.length) { showToast('No changes to publish', 'warn'); return; }
    rtApplyPublished(rbWeek, rbDrafts[rbWeek].cells, 'roster updated');
    const D = rbDrafts[rbWeek]; D.fromPublished = true; rbPutDraft(rbWeek);
    showToast(`${changes.length} change${changes.length === 1 ? '' : 's'} published; the people concerned are told`, 'ok');
    rbRender(); return;
  }
  try { if (typeof riPending !== 'undefined') riPending = { dataUrl: rbPicture().toDataURL('image/jpeg', 0.86) }; } catch (_) {}
  roPreview = res;
  document.getElementById('roPreview') && (document.getElementById('roPreview').innerHTML = '');
  const ok = window.confirm; window.confirm = () => true;   // the questions were asked above
  try { roSavePreview(); } finally { window.confirm = ok; }
  showPanel('roster');
  roWeek = rbWeek; roRender();
}
/** The roster as a picture, laid out like management's (title, dates, hotel bars, coloured cells). */
/** What the roster picture shows: the heading (and its words), job titles, employee numbers. Kept for everyone. */
function rbPicOpts() { return Object.assign({ heading: true, text: '', titles: false, ids: true }, rbSettings.pic || {}); }
function rbPicture(res, title, opts) {
  res = res || rbAsRes(); const dates = res.dates, O = Object.assign(rbPicOpts(), opts || {});
  const keyOf = n => (res.keys || {})[n] || Object.keys(roStaff).find(k => (roStaff[k] || {}).name === n);
  // the colours management uses, with a key at the bottom so anyone can read it
  const colors = { morning: '#92d050', afternoon: '#f4b084', night: '#ffff00', nightLate: '#00b0f0', off: '#d9d9d9', leave: '#ff5a5a', ph: '#9bc2e6', other: '#ffffff' };
  const kindOf = v => { const i = roInfo(v); if (!i) return ''; if (/^PH\b/i.test(v)) return 'ph'; if (i.type === 'night') return rbMin(i.from || '00:00') >= 12 * 60 ? 'nightLate' : 'night'; return colors[i.type] ? i.type : 'other'; };
  const fill = v => colors[kindOf(v)] || '#ffffff';
  const F = "Arial, 'Helvetica Neue', Helvetica, sans-serif";
  const nameW = 300, colW = 150, rowH = 36, hdH = 30, x0 = 14, W = x0 * 2 + nameW + colW * 7;
  const groups = []; res.names.forEach(n => { const g = res.groups[n] || ''; let G = groups.find(x => x.g === g); if (!G) groups.push(G = { g, n: [] }); G.n.push(n); });
  const used = new Set(); res.names.forEach(n => dates.forEach(dt => { const k = kindOf(res.cells[n][dt] || ''); if (k) used.add(k); }));
  const top = O.heading ? 56 : 14, legendH = used.size ? 54 : 10;
  const H = top + hdH * 2 + groups.reduce((t, G) => t + (G.g || groups.length > 1 ? rowH : 0) + G.n.length * rowH, 0) + legendH + 10;
  const c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2;
  const x = c.getContext('2d'); x.scale(2, 2);
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.textBaseline = 'middle'; x.textAlign = 'center';
  if (O.heading) { x.fillStyle = '#111'; x.font = `bold 24px ${F}`; x.fillText(O.text || title || rbSettings.title || `Roster · ${rbWeekLabel(roMonday(roDate(dates[0])))}`, W / 2, 30, W - 28); }
  let y = top;
  const cell = (cx, cy, w, h, bg, txt, font, color) => { x.fillStyle = bg; x.fillRect(cx, cy, w, h); x.strokeStyle = '#555'; x.lineWidth = 0.8; x.strokeRect(cx, cy, w, h); if (txt) { x.fillStyle = color || '#111'; x.font = font || `14px ${F}`; x.fillText(txt, cx + w / 2, cy + h / 2 + 0.5, w - 8); } };
  cell(x0, y, nameW, hdH * 2, '#c6efce', 'Employee Name', `bold 15px ${F}`);
  dates.forEach((dt, d) => { const D = roDate(dt), we = D.getDay() === 6 || D.getDay() === 0 /* Saturday and Sunday: the UAE weekend */; cell(x0 + nameW + d * colW, y, colW, hdH, we ? '#b4dfa0' : '#c6efce', `${D.getDate()} ${D.toLocaleDateString('en-GB', { month: 'short' })}`, `bold 15px ${F}`); cell(x0 + nameW + d * colW, y + hdH, colW, hdH, we ? '#b4dfa0' : '#c6efce', D.toLocaleDateString('en-GB', { weekday: 'long' }), `bold 14px ${F}`); });
  y += hdH * 2;
  groups.forEach(G => {
    if (G.g || groups.length > 1) { x.fillStyle = '#1f2937'; x.fillRect(x0, y, W - x0 * 2, rowH); x.fillStyle = '#fff'; x.font = `bold 17px ${F}`; x.textAlign = 'left'; x.fillText(`${G.g || 'Team'}`, x0 + 14, y + rowH / 2); x.font = `13px ${F}`; x.fillStyle = '#c9d1dc'; x.textAlign = 'right'; x.fillText(`${G.n.length} staff`, W - x0 - 14, y + rowH / 2); x.textAlign = 'center'; y += rowH; }
    G.n.forEach((n, ri) => {
      x.fillStyle = ri % 2 ? '#f4f6f8' : '#fff'; x.fillRect(x0, y, nameW, rowH); x.strokeStyle = '#555'; x.strokeRect(x0, y, nameW, rowH);
      const t = O.titles ? rbTitle(keyOf(n) || '') : '';
      if (t) { x.font = `italic 12px ${F}`; x.fillStyle = '#666'; x.textAlign = 'right'; x.fillText(t, x0 + nameW - 8, y + rowH / 2, 96); }
      x.textAlign = 'left';
      let tx = x0 + 10;
      if (O.ids && res.ids[n]) { x.font = `12px ${F}`; x.fillStyle = '#777'; x.fillText(res.ids[n], tx, y + rowH / 2); tx += x.measureText(res.ids[n]).width + 10; }
      x.fillStyle = '#111'; x.font = `bold 15px ${F}`; x.fillText(n, tx, y + rowH / 2, x0 + nameW - tx - (t ? 104 : 10)); x.textAlign = 'center';
      dates.forEach((dt, d) => { const v = res.cells[n][dt] || '', i = roInfo(v); const txt = i && i.from ? `${i.from} - ${i.to}${i.note ? ' · ' + i.note : ''}` : v; cell(x0 + nameW + d * colW, y, colW, rowH, fill(v), txt, `${i && (i.from || /^OFF$/i.test(v)) ? 'bold ' : 'bold '}${i && i.note ? 13 : 15}px ${F}`, kindOf(v) === 'leave' ? '#fff' : '#111'); });
      y += rowH;
    });
  });
  // the key: what each colour means
  if (used.size) {
    const L = [['morning', 'Morning'], ['afternoon', 'Afternoon / evening'], ['night', 'Night (00:00)'], ['nightLate', 'Night (19:00)'], ['off', 'Day off'], ['leave', 'Leave / sick'], ['ph', 'Public holiday']].filter(([k]) => used.has(k));
    let lx = x0; y += 18; x.textAlign = 'left'; x.font = `13px ${F}`;
    L.forEach(([k, lbl]) => { x.fillStyle = colors[k]; x.fillRect(lx, y, 22, 18); x.strokeStyle = '#555'; x.strokeRect(lx, y, 22, 18); x.fillStyle = '#333'; x.fillText(lbl, lx + 30, y + 9.5); lx += 30 + x.measureText(lbl).width + 26; });
  }
  return c;
}
/** Each person's own week as a picture, for the team members who don't use the app. */
async function rbPersonPics(res) {
  res = res || rbAsRes();
  if (typeof rsWeekCanvas !== 'function') return;
  const files = [];
  for (const n of res.names) {
    const k = (res.keys || {})[n] || Object.keys(roStaff).find(q => (roStaff[q] || {}).name === n);
    const days = res.dates.map(dt => ({ date: dt, code: res.cells[n][dt] || '' }));
    const c = rsWeekCanvas(n, res.groups[n] || ((roStaff[k] || {}).group) || '', days);
    const b = await new Promise(r => c.toBlob(r, 'image/png'));
    files.push(new File([b], `${n} ${res.dates[0]}.png`, { type: 'image/png' }));
  }
  if (!files.length) return;
  try { if (navigator.canShare && navigator.canShare({ files })) { await navigator.share({ files, title: 'Roster' }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  for (const f of files) { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); await new Promise(r => setTimeout(r, 250)); }
  showToast(`👤 ${files.length} pictures saved, one for each person`, 'ok');
}
/** Picture options with a live preview, then share or download. */
function rbSharePic(res) {
  res = res || rbAsRes();
  document.getElementById('rbPicSheet')?.remove();
  const O = rbPicOpts(), d = document.createElement('div'); d.id = 'rbPicSheet'; d.className = 'ri-viewer';
  const dflt = rbSettings.title || `Roster · ${rbWeekLabel(roMonday(roDate(res.dates[0])))}`;
  d.innerHTML = `<div class="card rt-sheet rb-pic-sheet"><div class="ro-card-hd"><b>🖼 Roster picture</b><button class="ro-x" onclick="document.getElementById('rbPicSheet').remove()">✕</button></div>
    <div class="rb-pic-opts">
      <label class="rb-chk"><input type="checkbox" id="rbPoH" ${O.heading ? 'checked' : ''}> Heading</label>
      <input id="rbPoT" value="${escapeHtml(O.text || dflt)}" placeholder="${escapeHtml(dflt)}" ${O.heading ? '' : 'disabled'}>
      <label class="rb-chk"><input type="checkbox" id="rbPoJ" ${O.titles ? 'checked' : ''}> Job titles (Manager, Supervisor…)</label>
      <label class="rb-chk"><input type="checkbox" id="rbPoI" ${O.ids ? 'checked' : ''}> Employee numbers</label>
    </div>
    <div class="rb-pic-prev"><img id="rbPoImg" alt="Roster picture preview"></div>
    <div class="ro-acts"><button class="btn gold" id="rbPoGo">⬇ Download / share</button><button class="btn" id="rbPoEach" title="Each person's own week, big and simple, to send to them">👤 A picture for each person</button><small>Your choices are kept for next time and for the picture posted with the roster.</small></div></div>`;
  d.addEventListener('click', e => { if (e.target === d) d.remove(); });
  document.body.appendChild(d);
  const read = () => ({ heading: document.getElementById('rbPoH').checked, text: document.getElementById('rbPoT').value.trim() === dflt ? '' : document.getElementById('rbPoT').value.trim(), titles: document.getElementById('rbPoJ').checked, ids: document.getElementById('rbPoI').checked });
  const draw = () => { const o = read(); document.getElementById('rbPoT').disabled = !o.heading; document.getElementById('rbPoImg').src = rbPicture(res, null, o).toDataURL('image/png'); };
  ['rbPoH', 'rbPoJ', 'rbPoI'].forEach(id => document.getElementById(id).addEventListener('change', draw));
  document.getElementById('rbPoT').addEventListener('input', () => { clearTimeout(draw._t); draw._t = setTimeout(draw, 250); });
  document.getElementById('rbPoEach').onclick = () => { d.remove(); rbPersonPics(res); };
  document.getElementById('rbPoGo').onclick = () => {
    const o = read(); rbSettings.pic = o;
    if (typeof roCanEdit === 'function' && roCanEdit()) fbSet('roster/builder/settings/pic', o);
    d.remove(); rbSharePicNow(res, o);
  };
  draw();
}
function rbSharePicNow(res, opts) {
  const c = rbPicture(res, null, opts), name = `Roster ${roMonday(roDate((res || rbAsRes()).dates[0]))}.png`;
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
    // a change saved comes straight back from the database: redraw once (not per field), and not while a card or
    // dialog is open on top (it's redrawn when that closes): that made every tap on a person's card slow
    let reT = 0;
    const re = () => { clearTimeout(reT); reT = setTimeout(() => { if (document.getElementById('rtSheet') || document.getElementById('evDlg')) { rbStale = true; return; } if (document.getElementById('panel-roster-build')?.classList.contains('active') && !document.getElementById('rbMenu') && !(document.activeElement && /INPUT|SELECT/.test(document.activeElement.tagName) && document.activeElement.closest('#rbRoot'))) rbRender(); }, 150); };
    // what we just saved comes straight back: if nothing differs from what's on screen, nothing is redrawn
    const same = (a, b) => { try { return JSON.stringify(a || {}) === JSON.stringify(b || {}); } catch (_) { return false; } };
    fbListen('roster/builder/settings', v => { if (same(v, rbSettings)) return; rbSettings = v || {}; re(); });
    fbListen('roster/builder/people', v => { if (same(v, rbPeople)) return; rbPeople = v || {}; re(); });
    fbListen('roster/builder/requests', v => { if (same(v, rbReqs)) return; rbReqs = v || {}; re(); });
    fbListen('roster/builder/drafts', v => { const before = JSON.stringify(rbDrafts || {}); rbDraftsIn(v); if (JSON.stringify(rbDrafts || {}) !== before) re(); });
  }, 1600);
  if (typeof BA_COMMANDS !== 'undefined') BA_COMMANDS.unshift({ re: /^(build|make|create|plan|do)\s+(the\s+|a\s+|next\s+week'?s?\s+|the\s+next\s+)*(roster|rota|schedule)\b/i, ask: true, ex: 'build the roster', does: 'opens the roster builder for next week', run: () => { if (typeof brClose === 'function') brClose(); rbOpen(); return true; } });
});

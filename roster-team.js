// ═══════════════════════════════════════════════════════════
//  roster-team.js — the team, changes and help around the roster
//
//    • Who can cover a gap (someone sick, someone left): their day off
//      moved, moved from a shift with spare, borrowed from another hotel,
//      a manager as the last resort, or "bring in a staff member".
//    • Swap suggestions when someone asks to change: only swaps that keep
//      everyone's rest, 9-hour shifts and cover.
//    • Team: titles, static / rotating / any shift, hotel, days off, PH,
//      sick and leave dates, joined / left, add and delete staff, and each
//      person's history (what they worked last weeks).
//    • Mid-week changes: edit the posted week; only the people whose
//      shifts changed are told.
//    • Drag a cell onto another to swap (long-press on a phone).
//    • Ops Brain: "Omar is sick tomorrow", "Ali wants Friday off",
//      "swap Sam and Lina on Tue", "who can cover nights on Wed",
//      "roster problems", "Lina last week".
//    • Shift Tasks follow the roster's real hours.
// ═══════════════════════════════════════════════════════════

const RT_LEAVE = ['SL', 'AL', 'ALA', 'EL', 'ML', 'UL', 'CL', 'PH', 'TRN'];
const rtDates = w => Array.from({ length: 7 }, (_, d) => roAdd(w, d));
const rtName = k => (roStaff[k] || {}).name || k;
const _rtQ = s => JSON.stringify(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Builder input (rules, cover, people) for any week. */
function rtCtx(week) { const keep = rbWeek; rbWeek = week; try { return rbInput(1); } finally { rbWeek = keep; } }
/** What is posted for a week, person by person. */
function rtPublished(week) {
  const out = {};
  Object.keys(roStaff).forEach(k => { out[k] = {}; rtDates(week).forEach(dt => { const v = (roDays[dt] || {})[k]; if (v) out[k][dt] = v; }); });
  return out;
}
function rtIsPublished(week) { return rtDates(week).some(dt => Object.keys(roDays[dt] || {}).length); }
const _rtClone = c => JSON.parse(JSON.stringify(c || {}));

/** Changes of hours between working days in a row (counting from last week's last shift). */
function rtHourChanges(I, cells, p) {
  const dates = rtDates(I.week); let n = 0, prev = p.lastShift || '';
  dates.forEach(dt => { const v = (cells[p.key] || {})[dt] || ''; if (rbParse(v) && rbParse(prev) && rbNorm(v) !== rbNorm(prev)) n++; prev = v; });
  return n;
}
// ── Why someone is OK (or not) for a shift ────────────────
/** Short reasons a placement is fine: rest before and after, no night/day switch, title, days in a row, hours. */
function rtWhyOk(I, cells, p, date, code) {
  const dates = rtDates(I.week), d = dates.indexOf(date), out = [];
  const prev = d === 0 ? p.lastShift || '' : (cells[p.key] || {})[dates[d - 1]] || '';
  const next = d < 6 ? (cells[p.key] || {})[dates[d + 1]] || '' : '';
  out.push(rbParse(prev) ? `${Math.round(rbRest(prev, code))} h rest before` : 'off the day before');
  // the same hours as the days around it, or a change of hours (what people dislike)
  const near = [prev, next].filter(x => rbParse(x));
  if (near.length && near.every(x => rbNorm(x) === rbNorm(code))) out.unshift('same hours as their other days');
  else if (near.some(x => rbNorm(x) !== rbNorm(code))) out.unshift(`⚠ hours change (${[...new Set(near.filter(x => rbNorm(x) !== rbNorm(code)).map(x => rbNorm(x).slice(0, 5)))].join(', ')} → ${rbNorm(code).slice(0, 5)})`);
  if (rbParse(next)) out.push(`${Math.round(rbRest(code, next))} h rest after`);
  else if (d < 6) out.push('off the day after');
  const x = rbParse(code); if (x) out.push(`${(x.e - x.s) / 60} h shift`);
  const g = x ? rbAt(I, p, x) : p.group;
  const who = ((I.groups[g] || {}).who || {})[rbNorm(code)];
  if (who) out.push(`${p.title} ✓`);
  let run = 0; for (let i = d; i >= 0 && rbParse((cells[p.key] || {})[dates[i]]); i--) run++; if (run === d + 1) run += p.run || 0;
  for (let i = d + 1; i < 7 && rbParse((cells[p.key] || {})[dates[i]]); i++) run++;
  out.push(`${run} day${run === 1 ? '' : 's'} in a row`);
  return out.join(' · ');
}
/** Why each other colleague can't take it (on leave, rest, night/day, title…). */
function rtWhyNot(I, cells, group, date, shift, skip) {
  const dates = rtDates(I.week), d = dates.indexOf(date), G = I.groups;
  const there0 = p => p.group !== group ? ` (${p.group})` : '';
  const who = ((G[group] || {}).who || {})[shift];
  return I.people.filter(p => !(skip || []).includes(p.key) && (p.group === group || rbBaseGroup(p.group) === rbBaseGroup(group) || (who ? who.includes(p.title || '') : false))).map(p => {
    const v = (cells[p.key] || {})[date] || '', pre = ((I.pre || {})[p.key] || {})[date];
    let r;
    if (pre === '—') return null;
    if (p.lock && rbNorm(v) !== shift) return { key: p.key, name: rtName(p.key) + there0(p), reason: `🔒 keeps ${p.fixed}${/manager/i.test(p.title || '') ? ' (manager)' : ''}` };
    if (rtStays(I, p, group)) return { key: p.key, name: rtName(p.key) + there0(p), reason: `🏨 stays at ${rbBaseGroup(p.group)}` };
    if ((p.post || '') !== ((G[group] || {}).post || '')) return { key: p.key, name: rtName(p.key), reason: p.post ? `${p.title || p.post}: not front desk` : `front desk, not ${(G[group] || {}).post.toLowerCase()}` };
    const there = p.group !== group ? ` (${p.group})` : '';
    if (pre) r = rbKind(pre) === 'off' ? 'asked for this day off' : `on ${pre}`;
    else if (rbNorm(v) === shift) r = p.group === group ? 'already on it' : `on ${shift} at ${p.group}; moving them leaves it short there`;
    else if (who && !who.includes(p.title || '')) r = `${shift} is for ${who.join(' / ')} only${p.title ? ` (${p.title})` : ' (no title set)'}`;
    else if (p.allowed && p.allowed.length && !p.allowed.includes(shift)) r = 'can\'t work this shift';
    else {
      const c2 = _rtClone(cells); c2[p.key][date] = shift;
      const pb = rbProblems(I, c2).find(x => x.key === p.key && x.date >= dates[Math.max(0, d - 1)] && x.date <= dates[Math.min(6, d + 1)] && x.kind !== 'offs');
      if (pb) r = pb.kind === 'rest' ? (pb.hours <= 0 ? `overlaps with their ${pb.to === shift ? pb.from : pb.to}` : `only ${Math.round(pb.hours)} h rest (${pb.from} → ${pb.to})`) : pb.kind === 'switch' ? `night ↔ day without a day off (${pb.from} → ${pb.to})` : pb.kind === 'run' ? `${pb.days} days in a row` : pb.kind === 'long' ? 'over 9 h' : 'breaks a rule';
      else if (rbKind(v) === 'off') r = 'day off, and no later day to move it to without leaving a shift empty';
      else if (rbParse(v)) r = `moving them leaves ${p.group !== group ? p.group + "'s " : ''}${rbNorm(v)} empty`;
      else if (v) r = `on ${v}`;
      else r = 'not available';
    }
    return { key: p.key, name: rtName(p.key) + there, reason: r };
  }).filter(Boolean);
}

// ── Who can cover ─────────────────────────────────────────
/** Ways to fill one gap, best first. Each: { text, cells (the week after), cost, kind } */
/** Someone who can't be moved for this gap: shift locked (managers), or another hotel when they (or everyone) stay home. */
function rtStays(I, p, group) {
  if (p.lock) return true;
  const away = rbBaseGroup(p.group) !== rbBaseGroup(group);
  return away && (p.home || ((I.rules || {}).lend === false && !rbFloats(p) && !rbFloatsLast(p)));   // Duty Managers work anywhere; Supervisors too, last
}
function rtCoverOptions(I, cells, group, date, shift, opt) {
  const allowEmpty = !!(opt && opt.allowEmpty);   // a plan of several moves may empty a shift that a later move fills
  const dates = rtDates(I.week), d = dates.indexOf(date), today = roToday();
  if (d < 0 || date < today) return [];
  const G = I.groups, need = (g, s, dd) => ((G[g] && G[g].need[s]) || [])[dd] || 0;
  const before = rbProblems(I, cells);
  const fine = (c2, keys) => !rbProblems(I, c2).some(p => p.key && keys.includes(p.key) && p.kind !== 'offs' && !before.some(b => b.kind === p.kind && b.key === p.key && b.date === p.date));
  const opts = [];
  const offs = (c, k) => dates.filter(x => rbKind((c[k] || {})[x]) === 'off').length;
  const keepsOffs = (c2, k) => offs(c2, k) >= offs(cells, k);   // nobody loses a day off to cover a gap
  I.people.forEach(p => {
    const v = (cells[p.key] || {})[date] || '';
    if (((I.pre || {})[p.key] || {})[date]) return;            // asked for this day, on leave, or not employed
    if (!rbMayWork(I, group, p, shift)) return;                 // bell boys stay bell boys; nights for the titles set
    if (rtStays(I, p, group)) return;                           // 🔒 their shift, or 🏨 their hotel
    if (v && !rbParse(v) && rbKind(v) !== 'off') return;       // sick, on leave, training… written in the roster
    const mgr = /manager/i.test(p.title || '');
    const away = p.group !== group, label = away ? `${shift} - ${rbShortU(rbBaseGroup(group))}` : shift;
    const from = away ? ` from ${p.group}` : '';
    const extra = (mgr ? 40 : 0) + (away && !rbFloats(p) ? 10 : 0) + (away && rbFloatsLast(p) ? 60 : 0);   // a Supervisor from another hotel: only when nobody else
    if (rbKind(v) === 'off') {
      // works that day; their day off moves to a day with spare cover
      dates.forEach((e, i) => {
        if (i === d || e <= today || ((I.pre || {})[p.key] || {})[e]) return;   // a day off moves only to a day still to come
        const T = rbNorm((cells[p.key] || {})[e]); if (!T || rbParse(cells[p.key][e]).note) return;
        const c2 = _rtClone(cells); c2[p.key][date] = label; c2[p.key][e] = 'OFF';
        if (!fine(c2, [p.key])) return;
        const cov = rbCover(I, c2)[p.group]; const left = cov && cov[T] ? cov[T][i] : 1;
        if (need(p.group, T, i) > 0 && left < 1 && !allowEmpty) return;           // never empties another shift
        opts.push({ kind: 'offmove', key: p.key, cost: 10 + extra + (left < need(p.group, T, i) ? 15 : 0), cells: c2, ok: rtWhyOk(I, c2, p, date, label) + (left < need(p.group, T, i) ? ` · ${T} on ${roDayLbl(e)} drops to ${left}` : ''), text: `Put ${rtName(p.key)}${from} on ${shift}${mgr ? ' (manager)' : ''}: their day off moves to ${roDayLbl(e)}` });
      });
    } else if (rbParse(v) && !rbParse(v).note) {
      const T = rbNorm(v);
      if (T === shift && !away) return;
      const c2 = _rtClone(cells); c2[p.key][date] = label;
      if (!fine(c2, [p.key])) return;
      const cov = rbCover(I, c2)[p.group]; const left = cov && cov[T] ? cov[T][d] : 1;
      if (need(p.group, T, d) > 0 && left < 1 && !allowEmpty) return;
      const spare = left >= need(p.group, T, d);
      opts.push({ kind: away ? 'borrow' : 'move', key: p.key, cost: (away && T === shift ? 12 : 15) + extra + (spare ? 0 : 20), cells: c2,
        ok: rtWhyOk(I, c2, p, date, label) + (spare ? ` · their ${T} still has ${left}` : ` · their ${T} drops to ${left}`),
        text: away ? `Borrow ${rtName(p.key)} from ${p.group} for ${shift}${T === shift ? ' (same shift)' : ' (instead of ' + T + ')'}`
                   : `Put ${rtName(p.key)} on ${shift}${mgr ? ' (manager)' : ''} instead of ${T}` });
    }
  });
  // two-day fixes: they take the gap, a day next to it becomes their day off, and they work their old day off instead
  if (Object.keys(opts.reduce((m, o) => (m[o.key] = 1, m), {})).length < 3) I.people.forEach(p => {
    if (((I.pre || {})[p.key] || {})[date] || opts.some(o => o.key === p.key) || rtStays(I, p, group)) return;
    const away = p.group !== group, label = away ? `${shift} - ${rbShortU(rbBaseGroup(group))}` : shift, mgr = /^(manager|asst\. manager)$/i.test(p.title || '');
    const v = (cells[p.key] || {})[date] || '';
    if (!rbMayWork(I, group, p, shift) || (p.allowed && p.allowed.length && !p.allowed.includes(shift)) || (rbParse(v) && rbParse(v).note)) return;
    if (v && !rbParse(v) && rbKind(v) !== 'off') return;     // sick, on leave, training…: never
    const f = dates.find(x => x > today && x !== date && rbKind((cells[p.key] || {})[x]) === 'off' && !((I.pre || {})[p.key] || {})[x]);
    dates.forEach((e, i) => {
      if (e === date || e <= today || ((I.pre || {})[p.key] || {})[e] || e === f) return;
      const Te = (cells[p.key] || {})[e] || ''; if (!rbParse(Te) || rbParse(Te).note) return;
      const c2 = _rtClone(cells); c2[p.key][date] = label; c2[p.key][e] = 'OFF';
      if (rbKind(v) === 'off' && f === undefined) return;
      if (f) c2[p.key][f] = rbParse(v) ? v : Te;          // their old day off becomes a working day
      if (!fine(c2, [p.key]) || !keepsOffs(c2, p.key)) return;
      const cov = rbCover(I, c2), had = rbCover(I, cells);
      const emptied = Object.keys(G).some(g => (G[g].shifts || []).some(s => dates.some((x, j) => need(g, s, j) > 0 && had[g][s][j] > 0 && cov[g][s][j] === 0)));
      if (emptied) return;
      opts.push({ kind: 'rework', key: p.key, cost: 28 + (mgr ? 40 : 0) + (away ? 10 : 0), cells: c2, ok: rtWhyOk(I, c2, p, date, label),
        text: `Put ${rtName(p.key)}${away ? ' from ' + p.group : ''} on ${shift}: ${roDayLbl(e)} becomes their day off${f ? `, and they work ${roDayLbl(f)} (${rbNorm(c2[p.key][f])})` : ''}` });
    });
  });
  // a block on that shift: from the gap until their day off (or the end of the week); if the day before
  // doesn't give enough rest or is a day shift, that day becomes their day off instead
  if (Object.keys(opts.reduce((m, o) => (m[o.key] = 1, m), {})).length < 3) I.people.forEach(p => {
    if (opts.some(o => o.key === p.key) || rtStays(I, p, group)) return;
    const pre = (I.pre || {})[p.key] || {}, row = cells[p.key] || {}, v = row[date] || '';
    if (pre[date] || (v && !rbParse(v) && rbKind(v) !== 'off') || (rbParse(v) && rbParse(v).note)) return;
    if (!rbMayWork(I, group, p, shift) || (p.allowed && p.allowed.length && !p.allowed.includes(shift))) return;
    const away = p.group !== group, label = away ? `${shift} - ${rbShortU(rbBaseGroup(group))}` : shift;
    const c2 = _rtClone(cells), r2 = (c2[p.key] = c2[p.key] || {});
    const prevDt = d > 0 ? dates[d - 1] : null, prevV = prevDt ? row[prevDt] || '' : p.lastShift || '';
    let moved = '';
    if (rbParse(prevV) && (rbRest(prevV, shift) < (I.rules.minRest || 11) || !rbSwitchOk(prevV, shift, I.rules))) {
      if (!prevDt || prevDt <= today || pre[prevDt]) return;
      const f = dates.find(x => x > date && rbKind(row[x]) === 'off' && !pre[x]);
      if (!f) return;
      r2[prevDt] = 'OFF'; r2[f] = ''; moved = prevDt;          // their day off comes before the block
    }
    let last = date;
    for (let j = d; j < 7; j++) {
      const x = dates[j], cur = r2[x] || '';
      if (pre[x] || (rbKind(cur) === 'off' && x !== date) || (cur && !rbParse(cur) && rbKind(cur) !== 'off') || (rbParse(cur) && rbParse(cur).note)) break;
      r2[x] = label; last = x;
    }
    if (!fine(c2, [p.key]) || !keepsOffs(c2, p.key)) return;
    const cov = rbCover(I, c2), had = rbCover(I, cells);
    if (Object.keys(G).some(g => (G[g].shifts || []).some(s2 => dates.some((x, j) => need(g, s2, j) > 0 && had[g][s2][j] > 0 && cov[g][s2][j] === 0)))) return;
    opts.push({ kind: 'block', key: p.key, cost: 35 + (away ? 10 : 0), cells: c2, ok: rtWhyOk(I, c2, p, date, label),
      text: `Put ${rtName(p.key)}${away ? ' from ' + p.group : ''} on ${shift} ${last === date ? 'on ' + roDayLbl(date) : 'from ' + roDayLbl(date) + ' to ' + roDayLbl(last)}${moved ? `; ${roDayLbl(moved)} becomes their day off` : ''}` });
  });
  opts.forEach(o => { const p = I.people.find(x => x.key === o.key); if (p && o.cells) o.cost += Math.max(0, rtHourChanges(I, o.cells, p) - rtHourChanges(I, cells, p)) * 14; });
  opts.forEach(o => { const p = I.people.find(x => x.key === o.key); if (p && o.cells && rbSoftNo(I, p, date, shift)) { o.cost += 50; o.text += ' (prefers not this shift)'; } });
  const best = {}; opts.forEach(o => { if (!best[o.key] || best[o.key].cost > o.cost) best[o.key] = o; });
  const list = Object.values(best).sort((a, b) => a.cost - b.cost).slice(0, 6);
  const who = ((G[group] || {}).who || {})[shift];
  // nobody fits every rule: our rules first, then what past rosters did when there was no other way, mildest first:
  // an evening next to a night without a day off, rest down to 7 h, an evening straight into a night. Never over 9 h a shift.
  // (a day shift next to a night always keeps its day off between: not in any step)
  const TIERS = [
    { rules: { eveNight: true }, cost: 120 },
    { rules: { eveNight: true, minRest: 7 }, cost: 400 },
    { rules: { eveNight: true, minRest: 0 }, cost: 600 },
  ];
  const fn = k => rtName(k).split(' ')[0];
  const bendText = (c0, c1, keys) => {   // what the plan bends, in words
    const was = rbProblems(I, c0), now = rbProblems(I, c1).filter(p => keys.includes(p.key) && (p.kind === 'switch' || p.kind === 'rest') && !was.some(w => w.kind === p.kind && w.key === p.key && w.date === p.date));
    return now.map(p => p.kind === 'switch' ? `${fn(p.key)}: ${rbIsNight(p.from) ? 'a night then an evening' : 'an evening then a night'} without a day off (${rbNorm(p.from).slice(0, 5)} → ${rbNorm(p.to).slice(0, 5)}), as in past rosters`
      : p.hours <= 0 ? `${fn(p.key)}: back to back (${rbNorm(p.from).slice(0, 5)} straight into ${rbNorm(p.to).slice(0, 5)}, ${Math.round(((rbParse(p.from).e - rbParse(p.from).s) + (rbParse(p.to).e - rbParse(p.to).s)) / 60)} h)` : `${fn(p.key)}: only ${Math.round(p.hours)} h rest (${rbNorm(p.from).slice(0, 5)} → ${rbNorm(p.to).slice(0, 5)})`);
  };
  if (!list.length && !(opt && opt.noBend) && !(G[group] || {}).post) {
    const shortsIn = c => rbProblems(I, c).filter(p => p.kind === 'short'), before = shortsIn(cells);
    const isNew = p => !before.some(b => b.group === p.group && b.date === p.date && b.shift === p.shift);
    for (const T of TIERS) {
      if (list.some(o => o.cells)) break;
      const I2 = Object.assign({}, I, { rules: Object.assign({}, I.rules, T.rules) });
      const seen = new Set();
      for (const o of rtCoverOptions(I2, cells, group, date, shift, Object.assign({}, opt, { noBend: true, allowEmpty: true })).filter(o => o.cells)) {
        if (list.length >= 3 || seen.has(o.key)) continue;
        const left = shortsIn(o.cells).filter(isNew);
        if (left.length > 1) continue;
        let cells2 = o.cells, text = o.text, ok = o.ok || '', keys = [o.key];
        const away = rbBaseGroup((I.people.find(x => x.key === o.key) || {}).group) !== rbBaseGroup(group);
        let tail = '';
        if (left.length === 1) {         // their own shift is left empty: someone else takes it, every rule kept
          const g2 = left[0], f = rtCoverOptions(I, o.cells, g2.group, g2.date, g2.shift, { noBend: true }).find(x => x.cells && x.key !== o.key);
          if (!f) continue;
          cells2 = f.cells; keys.push(f.key); text += `; then ${f.text.charAt(0).toLowerCase() + f.text.slice(1)}`; ok = ok.replace(/\s·\s[^·]*drops to \d+/g, '');
          tail = ` ${fn(f.key)} takes over the ${g2.shift} on ${roDayLbl(g2.date)}${rbBaseGroup(g2.group) !== rbBaseGroup((I.people.find(x => x.key === f.key) || {}).group) ? ' at ' + rbBaseGroup(g2.group) : ''}.`;
        }
        seen.add(o.key);
        const bent = bendText(cells, cells2, keys);
        const lead = `${fn(o.key)} covers ${shift} on ${roDayLbl(date)}${away ? ' at ' + rbBaseGroup(group) : ''}`;
        if (bent.length) {
          const why = `${lead}: nobody could take it with every rule kept, so it bends ${bent.join('; ')}.${tail}`;
          list.push(Object.assign({}, o, { cells: cells2, bend: true, why, notes: [{ key: o.key, date, text: why }], cost: o.cost + T.cost, text: text + ' ⚠ ' + bent.join(' · '), ok: '⚠ bends: ' + bent.join(' · ') + ' (never over 9 h a shift) · ' + ok }));
        } else list.push(Object.assign({}, o, { cells: cells2, cost: o.cost + 60, text, why: lead + '.' + tail, notes: null }));
      }
    }
    list.sort((a, b) => a.cost - b.cost);
    if (list.some(o => o.bend) && !list.some(o => o.cells && !o.bend)) list.unshift({ kind: 'bring', cost: 998, cells: null, text: `Nobody can take ${shift} on ${roDayLbl(date)} with every rule kept. Only by bending a rule, the way past rosters did when there was no other way:` });
  }
  if (!list.length) list.push({ kind: 'bring', cost: 999, cells: null, text: `Nobody can take ${shift} on ${roDayLbl(date)} without breaking the rules${who ? ` (it's for ${who.join(' / ')} only: set titles in Team, or change who can work it in Cover needed)` : ' (rest, a day off between night and day, 9 hours)'}. Bring in a staff member${(G[group] && need(group, shift, d) > 1) ? ', or run it with one person' : ''}.` });
  return list;
}
/** Swaps that keep everyone's rules: with a colleague that day, or with another of their own days. */
function rtSwapOptions(I, cells, key, date) {
  const dates = rtDates(I.week), me = I.people.find(p => p.key === key);
  if (!me) return [];
  const before = rbProblems(I, cells), pre = (k, dt) => ((I.pre || {})[k] || {})[dt];
  const fine = (c2, keys) => !rbProblems(I, c2).some(p => (p.key ? keys.includes(p.key) : true) && !before.some(b => b.kind === p.kind && b.key === p.key && b.date === p.date && b.shift === p.shift));
  const out = [];
  if (pre(key, date) || date < roToday()) return out;
  const mine = (cells[key] || {})[date] || '';
  I.people.forEach(q => {
    if (q.key === key || q.group !== me.group || pre(q.key, date) || q.lock) return;
    const theirs = (cells[q.key] || {})[date] || '';
    if (theirs === mine || !theirs || (!rbParse(theirs) && rbKind(theirs) !== 'off') || (!rbParse(mine) && rbKind(mine) !== 'off')) return;
    const c2 = _rtClone(cells); c2[key][date] = theirs; c2[q.key][date] = mine;
    if (fine(c2, [key, q.key])) out.push({ cells: c2, text: `${rtName(key)} ↔ ${rtName(q.key)}: ${rtName(key)} takes ${theirs}, ${rtName(q.key)} takes ${mine}` });
  });
  dates.forEach(e => {
    if (e === date || e <= roToday() || pre(key, e)) return;
    const other = (cells[key] || {})[e] || '';
    if (other === mine || (!rbParse(other) && rbKind(other) !== 'off')) return;
    const c2 = _rtClone(cells); c2[key][date] = other; c2[key][e] = mine;
    if (fine(c2, [key])) out.push({ cells: c2, text: `${rtName(key)}: ${roDayLbl(date)} becomes ${other}, ${roDayLbl(e)} becomes ${mine}` });
  });
  return out.slice(0, 8);
}
/** Gaps in a week with the best ways to fill each. */
function rtAdvice(I, cells) {
  return rbProblems(I, cells).filter(p => p.kind === 'short' || p.kind === 'thin').map(p => Object.assign({}, p, { options: rtCoverOptions(I, cells, p.group, p.date, p.shift).slice(0, 3) }));
}

// ── "Put Sam on mornings this week" ─────────────────────
/** Try one person (or each of several) on a shift type for some days; each option is the week with that,
 *  changing as little as possible, with what it costs: changes for others, problems, hours changing mid-run. */
function rtPlanOptions(week, keys, band, from, to, both) {
  const dates = rtDates(week), today = roToday();
  from = from || dates[0]; to = to || dates[6];
  const base = rbDrafts[week] && rbDrafts[week].cells ? _rtClone(rbDrafts[week].cells) : rtIsPublished(week) ? rtPublished(week) : null;
  const days = dates.filter(dt => dt >= from && dt <= to && dt > today);
  return (both ? [keys] : keys.map(k => [k])).map(ks => {
    const keepWeek = rbWeek; rbWeek = week;
    let I; try { I = rbInput(1); } finally { rbWeek = keepWeek; }
    if (ks.some(k => !I.people.some(p => p.key === k))) return null;   // not on the roster that week (left, not joined yet, off the roster)
    I.avoid = I.avoid || {}; I.pre = I.pre || {};
    ks.forEach(k => {
      const g = (roStaff[k] || {}).group || '', sh = (I.groups[g] || {}).shifts || [], ok = rbBandShifts(sh, band);
      days.forEach(dt => { const av = (I.avoid[k] = I.avoid[k] || {}); av[dt] = (av[dt] || []).concat(sh.filter(x => !ok.includes(x))); });
    });
    if (base) {
      I.keep = base;
      dates.filter(dt => dt <= today).forEach(dt => Object.keys(base).forEach(k => { const v = base[k][dt]; if (v) (I.pre[k] = I.pre[k] || {})[dt] = v; }));   // days gone by stay as they were
    }
    I.attempts = 3;
    const res = rbSolve(I);
    const changes = [];
    if (base) Object.keys(res.cells).forEach(k => dates.forEach(dt => { const a = (base[k] || {})[dt] || '', b = res.cells[k][dt] || ''; if (a !== b) changes.push({ key: k, date: dt, from: a, to: b }); }));
    let inBand = 0, work = 0;
    ks.forEach(k => days.forEach(dt => { const v = res.cells[k][dt]; if (rbParse(v)) { work++; if (rbBandShifts([rbNorm(v)], band).length) inBand++; } }));
    const hourChanges = rbChanges(I, res.cells, dates).filter(c => !c.week).length;
    const probs = res.problems.filter(p => p.kind !== 'thin');
    return { keys: ks, band, from, to, week, cells: res.cells, changes, probs, thin: res.problems.length - probs.length, hourChanges, inBand, work,
      score: probs.length * 100 + changes.length * 2 + hourChanges * 6 + (work - inBand) * 60 };
  }).filter(Boolean).sort((a, b) => a.score - b.score);
}
function rtPlanText(o) {
  const who = o.keys.map(rtName).join(' and ');
  const others = o.changes.filter(c => !o.keys.includes(c.key));
  const fmt = c => `${rtName(c.key).split(' ')[0]} ${roDayLbl(c.date)} ${roCellTxt(roInfo(c.from)) || '·'}→${roCellTxt(roInfo(c.to)) || '·'}`;
  return {
    title: `${who} on ${rbBandLabel(o.band).toLowerCase()} shifts${o.work && o.inBand < o.work ? ` (${o.inBand} of ${o.work} days)` : ''}`,
    ok: [o.probs.length ? `⚠ ${o.probs.length} problem${o.probs.length === 1 ? '' : 's'}` : '✓ every shift covered, all rules kept', o.thin ? `${o.thin} one-person shift${o.thin === 1 ? '' : 's'}` : '', others.length ? `${others.length} change${others.length === 1 ? '' : 's'} for others: ${others.slice(0, 4).map(fmt).join(', ')}${others.length > 4 ? '…' : ''}` : 'nobody else changes', o.hourChanges ? `↻ ${o.hourChanges} hour change${o.hourChanges === 1 ? '' : 's'} mid-run` : 'steady hours'].filter(Boolean).join(' · '),
  };
}
let _rtPlans = [];
function rtPlanButtons(opts) {
  return `<div class="rt-opts">${opts.map(o => { _rtPlans.push(o); const t = rtPlanText(o); return `<button class="btn sm" onclick="rtApplyPlan(${_rtPlans.length - 1})"><span>✓ ${escapeHtml(t.title)}</span><small class="rb-ok">${escapeHtml(t.ok)}</small></button>`; }).join('')}</div>`;
}
/** Use an option: the request is kept for rebuilds, and the week (draft or posted) takes the new cells. */
function rtApplyPlan(i) {
  const o = _rtPlans[i]; if (!o) return;
  if (!roCanEdit()) { showToast('Only supervisors, managers and owners can change the roster', 'err'); return; }
  o.keys.forEach((k, i) => { const id = 'q' + Date.now().toString(36) + i + '_' + k.replace(/[^A-Za-z0-9]/g, '').slice(0, 12), r = { key: k, type: 'band', code: o.band, from: o.from > roToday() ? o.from : roAdd(roToday(), 1), to: o.to }; (rbReqs[o.week] = rbReqs[o.week] || {})[id] = r; fbSet(`roster/builder/requests/${o.week}/${id}`, r); });
  if (rtIsPublished(o.week)) {
    const n = rtApplyPublished(o.week, o.cells, 'shift type');
    rbDrafts[o.week] = { cells: _rtClone(o.cells), at: Date.now(), fromPublished: true }; rbPutDraft(o.week);
    showToast(`${n} change${n === 1 ? '' : 's'} made in the posted roster; the people concerned are told`, 'ok');
  } else {
    if (typeof rbUndoPush === 'function' && rbWeek === o.week) rbUndoPush();
    rbDrafts[o.week] = Object.assign({}, rbDrafts[o.week], { cells: _rtClone(o.cells), at: Date.now() }); rbPutDraft(o.week);
    showToast('Done in the draft. ↶ Undo is above the table', 'ok');
  }
  _rtPlans = [];
  if (typeof brClose === 'function') try { brClose(); } catch (_) {}
  if (document.getElementById('panel-roster-build')?.classList.contains('active')) { rbWeek = o.week; rbRender(); }
}
/** The builder card. */
function rtPlanHtml(shown, dates) {
  const people = shown.map(g => `<optgroup label="${escapeHtml(g || 'Team')}">${rbMembers(g).map(k => `<option value="${escapeHtml(k)}">${escapeHtml(rtName(k))}</option>`).join('')}</optgroup>`).join('');
  const first = dates.find(dt => dt > roToday()) || dates[0];
  return `<details class="card rb-card"${typeof rbSec === 'function' ? rbSec('plan', false) : ''}>
    <summary class="ro-card-hd"><b>🎯 Put someone on…</b><span>morning, day, evening or night</span></summary>
    <div class="rb-req-add">
      <select id="rtPlP1">${people}</select>
      <select id="rtPlP2"><option value="">or someone else? (optional)</option>${people}</select>
      <select id="rtPlB">${Object.keys(RB_BANDS).map(b => `<option value="${b}">${escapeHtml(RB_BANDS[b].label)}</option>`).join('')}</select>
      <label>From <input type="date" id="rtPlF" value="${first}" min="${dates[0]}" max="${dates[6]}"></label>
      <label>To <input type="date" id="rtPlT" value="${dates[6]}" min="${dates[0]}" max="${dates[6]}"></label>
      <button class="btn sm gold" onclick="rtPlanRun()">Show options</button>
    </div>
    <div id="rtPlOut"></div>
  </details>`;
}
function rtPlanRun() {
  const k1 = document.getElementById('rtPlP1').value, k2 = document.getElementById('rtPlP2').value, band = document.getElementById('rtPlB').value;
  const from = document.getElementById('rtPlF').value, to = document.getElementById('rtPlT').value, out = document.getElementById('rtPlOut');
  const keys = [k1, k2].filter((k, i, a) => k && a.indexOf(k) === i);
  out.innerHTML = '<div class="ri-reading"><span class="ri-spin"></span><div><b>Trying it…</b><small>Building the week each way, changing as little as possible.</small></div></div>';
  setTimeout(() => {
    _rtPlans = [];
    const opts = rtPlanOptions(rbWeek, keys, band, from, to, false);
    if (keys.length > 1) opts.push(...rtPlanOptions(rbWeek, keys, band, from, to, true));
    opts.sort((a, b) => a.score - b.score);
    if (!opts.length) { out.innerHTML = '<div class="rb-prob">Not on the roster that week (left, not started yet, or off the roster on their card).</div>'; return; }
    out.innerHTML = `<div class="rb-sub">${keys.length > 1 ? 'Best first' : 'What it would look like'}</div>${rtPlanButtons(opts)}<small class="ro-hint">Tap one to use it. It's kept as a request, so building again keeps it.</small>`;
  }, 60);
}

// ── What if… ──────────────────────────────────────────────
// "What if Ahmed is sick tomorrow / takes today off / isn't on 12–21 on Wed?" Nothing changes until a plan is used:
// it shows what would be short, then whole plans that fill every gap under the rules, fewest changes first.
const RT_WI_KINDS = { sick: 'is sick', leave: 'is on leave', off: 'takes the day off', notshift: "isn't on that shift" };
function rtWhatIf(s) {
  const week = roMonday(roDate(s.from)), dates = rtDates(week), today = roToday();
  const to = (s.to && s.to >= s.from ? s.to : s.from) > dates[6] ? dates[6] : (s.to && s.to >= s.from ? s.to : s.from);
  const D = rbDrafts[week], posted = rtIsPublished(week);
  const base = D && D.cells && (!posted || D.fromPublished) ? _rtClone(D.cells) : posted ? rtPublished(week) : null;
  const out = { s, week, from: s.from, to, posted, plans: [], gaps: [] };
  if (!base) { out.none = true; return out; }
  const I = rtCtx(week); I.people.forEach(p => { base[p.key] = base[p.key] || {}; });
  const k = s.key, me = I.people.find(p => p.key === k);
  if (!me) { out.notOn = true; return out; }
  const days = dates.filter(dt => dt >= s.from && dt <= to && dt >= today);
  if (!days.length) { out.past = true; return out; }
  const code = s.kind === 'sick' ? (s.code || 'SL') : s.kind === 'leave' ? (s.code || 'AL') : s.kind === 'off' ? 'OFF' : null;
  const plain = v => !v || rbKind(v) === 'off' || (rbParse(v) && !rbParse(v).note);
  out.already = days.filter(dt => !rbParse(base[k][dt]));            // not working those days anyway
  if (code && out.already.length === days.length) { out.idle = true; out.days = days; out.base = base; return out; }
  // the cover to keep is the cover the week has now: no plan is blamed for gaps that were already there
  const cov0 = rbCover(I, base), groups = {};
  Object.keys(I.groups).forEach(g => { const G = I.groups[g]; groups[g] = Object.assign({}, G, { need: {} }); G.shifts.forEach(x => { groups[g].need[x] = dates.map((dt, d) => dt < today ? 0 : Math.min(((G.need[x] || [])[d]) || 0, cov0[g][x][d])); }); });
  // the question, as a week: their days, everyone else as now
  const sc = _rtClone(base);
  const Iq = Object.assign({}, I, { groups, pre: _rtClone(I.pre || {}), avoid: _rtClone(I.avoid || {}) });
  Object.keys(base).forEach(x => dates.forEach(dt => { const v = base[x][dt]; if (v && (dt < today || !plain(v))) (Iq.pre[x] = Iq.pre[x] || {})[dt] = v; }));   // days gone by, leave, PH, training, lent: stay
  days.forEach(dt => {
    if (code) { sc[k][dt] = code; (Iq.pre[k] = Iq.pre[k] || {})[dt] = code; }
    else { const cur = rbNorm(base[k][dt]); const sh = s.shift || cur; (Iq.avoid[k] = Iq.avoid[k] || {})[dt] = ((Iq.avoid[k] || {})[dt] || []).concat([sh]); if (cur && cur === sh) sc[k][dt] = 'OFF'; }
  });
  const ignore = p => p.kind === 'offs' && p.key === k && (code === 'OFF' || !code);    // an extra day off for them is the question itself
  const avoided = dt => !code && ((Iq.avoid[k] || {})[dt] || []);
  const respects = c => code || !days.some(dt => avoided(dt).includes(rbNorm((c[k] || {})[dt])));
  const before = rbProblems(Iq, base);
  const isNew = p => !before.some(b => b.kind === p.kind && b.key === p.key && b.date === p.date && b.shift === p.shift && b.group === p.group);
  const probsOf = c => rbProblems(Iq, c).filter(p => !ignore(p) && isNew(p) && (!p.date || p.date >= today) && !(p.group && (Iq.groups[p.group] || {}).post));   // a day without a bell boy is fine
  out.gaps = probsOf(sc).filter(p => (p.kind === 'short' || p.kind === 'thin') && p.date >= today).sort((a, b) => a.date.localeCompare(b.date) || rbMin(a.shift) - rbMin(b.shift));
  out.was = before.filter(p => p.kind !== 'thin').length;
  // places filled, for "100% covered"
  const fill = c => { const cov = rbCover(Iq, c); let n = 0, h = 0; Object.keys(Iq.groups).filter(g => !Iq.groups[g].post).forEach(g => Iq.groups[g].shifts.forEach(x => dates.forEach((dt, d) => { if (dt < today) return; const nd = (Iq.groups[g].need[x] || [])[d] || 0; n += nd; h += Math.min(nd, cov[g][x][d]); }))); return n ? h / n : 1; };
  const plans = [];
  const add = (cells, texts, how) => {
    if (!respects(cells)) return;
    const pr = probsOf(cells), bad = pr.filter(p => p.kind !== 'thin'), thin = pr.filter(p => p.kind === 'thin');
    const changes = []; Object.keys(cells).forEach(x => dates.forEach(dt => { const a = (sc[x] || {})[dt] || '', b = (cells[x] || {})[dt] || ''; if (a !== b) changes.push({ key: x, date: dt, from: (base[x] || {})[dt] || '', to: b }); }));
    const hc = rbChanges(Iq, cells, dates).filter(c => !c.week).length - rbChanges(Iq, sc, dates).filter(c => !c.week).length;
    plans.push({ cells, texts, how, bad, thin, changes, hc: Math.max(0, hc), cover: fill(cells), score: bad.length * 1000 + pr.filter(p => p.kind === 'short').length * 500 + thin.length * 60 + changes.length * 3 + Math.max(0, hc) * 8 });
  };
  if (!out.gaps.length) { add(_rtClone(sc), [code ? 'Nothing else needs to change' : `${rtName(k)} works another shift, nothing else changes`], 'none'); if (code) { out.plans = plans; out.Iq = Iq; out.base = base; out.code = code; out.days = days; return out; } }
  // 1. fill the gaps one by one with the moves a supervisor would make (three different first moves)
  const gapsIn = c => probsOf(c).filter(p => p.kind === 'short' || p.kind === 'thin');
  const breaks = c => probsOf(c).filter(p => p.kind !== 'short' && p.kind !== 'thin').length;
  const better = (a, b) => { const ga = gapsIn(a), gb = gapsIn(b); const w = x => x.reduce((t, p) => t + (p.kind === 'short' ? 3 : 1), 0); return breaks(a) <= breaks(b) && w(ga) < w(gb); };
  const same = (a, b) => a.group === b.group && a.date === b.date && a.shift === b.shift;
  const fixable = (next, prev) => { const g = gapsIn(next).find(z => !gapsIn(prev).some(w => same(w, z))); return !!g && rtCoverOptions(Iq, next, g.group, g.date, g.shift).some(y => y.cells && better(y.cells, prev)); };
  const chain = (cells, first) => {
    const texts = [], used = {}; let c = cells;
    if (first) { if (!respects(first.cells) || (breaks(first.cells) > breaks(c) && !first.bend)) return null; c = first.cells; texts.push(first.text); used[first.key] = 1; }
    for (let n = 0; n < 8; n++) {
      const g = gapsIn(c)[0];
      if (!g) break;
      const ok = x => x.cells && (used[x.key] || 0) < 2 && respects(x.cells);
      const o = rtCoverOptions(Iq, c, g.group, g.date, g.shift).find(x => ok(x) && better(x.cells, c))
             || (n < 2 ? rtCoverOptions(Iq, c, g.group, g.date, g.shift, { allowEmpty: true }).find(x => ok(x) && breaks(x.cells) <= breaks(c) && fixable(x.cells, c)) : null);   // a move that opens a gap the next move fills
      if (!o) break;
      c = o.cells; texts.push(o.text); used[o.key] = (used[o.key] || 0) + 1;
    }
    return { c, texts };
  };
  if (out.gaps.length) {
    const g0 = out.gaps[0];
    const firsts = rtCoverOptions(Iq, sc, g0.group, g0.date, g0.shift).filter(o => o.cells).slice(0, 4).concat(rtCoverOptions(Iq, sc, g0.group, g0.date, g0.shift, { allowEmpty: true }).filter(o => o.cells).slice(0, 4));
    firsts.forEach(f => { const r = chain(sc, f); if (r) add(r.c, r.texts, 'moves'); });
  }
  // 2. a swap for them that day (for "not on this shift")
  if (!code) days.forEach(dt => rtSwapOptions(Iq, base, k, dt).filter(o => rbNorm(o.cells[k][dt]) !== (s.shift || rbNorm(base[k][dt]))).slice(0, 2).forEach(o => add(o.cells, [o.text], 'swap')));
  // 3. the rest of the week planned again around it, changing as little as possible
  [1, 2].forEach(seed => {
    const J = Object.assign({}, Iq, { keep: sc, seed, attempts: 2 });
    const res = rbSolve(J);
    add(res.cells, [seed === 1 ? 'Plan the rest of the week again around it, changing as little as possible' : 'Another way to plan the rest of the week'], 'replan');
  });
  const seen = new Set();
  let list = plans.filter(p => { const key = JSON.stringify(p.changes.map(c => c.key + c.date + c.to)); if (seen.has(key)) return false; seen.add(key); return true; }).sort((a, b) => a.score - b.score);
  if (list.some(p => !p.bad.length)) list = list.filter(p => !p.bad.length || p.how !== 'replan');   // a clean plan exists: no rule-breaking re-plans
  out.plans = list.slice(0, 4);
  out.Iq = Iq; out.base = base; out.code = code; out.days = days;
  return out;
}
let _rtWI = null;
function rtProbText(x) {
  const n = x.key ? rtName(x.key).split(' ')[0] : '', d = x.date ? roDayLbl(x.date) : '';
  return x.kind === 'short' ? `${d} ${x.shift} empty` : x.kind === 'rest' ? `${n}: only ${Math.round(x.hours)} h rest before ${d}` : x.kind === 'run' ? `${n}: ${x.days} days in a row` : x.kind === 'switch' ? `${n}: night ↔ day without a day off (${d})` : x.kind === 'who' ? `${n}: ${x.code} is for ${(x.who || []).join(' / ')} only` : x.kind === 'long' ? `${n}: over ${rbRules().maxHours} h on ${d}` : x.kind === 'offs' ? `${n}: ${x.have} day${x.have === 1 ? '' : 's'} off (should be ${x.need})` : `${n} ${d}`.trim();
}
function rtWhatIfText(r) {
  const s = r.s, who = rtName(s.key), when = r.from === r.to ? roDayLbl(r.from) : `${roDayLbl(r.from)} → ${roDayLbl(r.to)}`;
  return s.kind === 'notshift' ? `${who} not on ${s.shift || 'their shift'} · ${when}` : `${who} ${RT_WI_KINDS[s.kind]} · ${when}`;
}
function rtWhatIfHtml(r) {
  _rtWI = r;
  const head = `<div class="rt-wi-q">🤔 What if ${escapeHtml(rtWhatIfText(r))}</div>`;
  if (r.none) return head + `<div class="rb-prob">That week has no roster yet. Add it as a request in the builder and the week is planned around it.</div>`;
  if (r.notOn) return head + `<div class="rb-prob">${escapeHtml(rtName(r.s.key))} isn't on the roster that week.</div>`;
  if (r.past) return head + `<div class="rb-prob">Those days have passed.</div>`;
  if (r.idle) return head + `<div class="rb-allgood">${escapeHtml(rtName(r.s.key))} isn't working then anyway (${escapeHtml(r.days.map(dt => roDayLbl(dt) + ' ' + (roCellTxt(roInfo(r.base[r.s.key][dt])) || 'off')).join(', '))}). Nothing to cover.</div>`;
  const fmtGap = g => `${roDayLbl(g.date)} · ${g.shift}${Object.keys(r.Iq.groups).length > 1 ? ' · ' + g.group : ''}: ${g.have === 0 ? 'nobody' : 'one person'}`;
  const impact = r.gaps.length ? `<div class="rt-wi-imp"><b>Without a change:</b> ${r.gaps.slice(0, 6).map(g => `<span class="rt-wi-gap${g.have === 0 ? ' z' : ''}">${escapeHtml(fmtGap(g))}</span>`).join('')}${r.gaps.length > 6 ? ` +${r.gaps.length - 6} more` : ''}</div>` : `<div class="rb-allgood">✓ Cover holds without ${escapeHtml(rtName(r.s.key))}: every shift still has its people.</div>`;
  const cell = v => { const i = roInfo(v), x = rbParse(v); return (roCellTxt(i) || '·') + (x && x.note ? ' ' + x.note.split(/\s+/)[0] : ''); };
  const fmt = c => `${escapeHtml(rtName(c.key).split(' ')[0])} ${escapeHtml(roDayLbl(c.date))} ${escapeHtml(cell(c.from))}→${escapeHtml(cell(c.to))}`;
  const plans = r.plans.map((p, i) => {
    const full = p.cover >= 0.999, ok = !p.bad.length;
    const others = p.changes.filter(c => c.key !== r.s.key);
    return `<div class="rt-wi-plan${i === 0 && ok && full ? ' best' : ''}">
      <div class="rt-wi-hd">${i === 0 && ok && full ? '<em>★ Best</em>' : ''}${p.texts.length > 1 ? `<ol>${p.texts.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ol>` : `<b>${escapeHtml(p.texts[0])}</b>`}</div>
      <div class="rt-wi-chips"><i class="${full ? 'ok' : 'bad'}">${Math.round(p.cover * 100)}% covered</i><i class="${ok ? 'ok' : 'bad'}">${ok ? '✓ rules kept' : '⚠ ' + p.bad.length + ' rule' + (p.bad.length === 1 ? '' : 's') + ' broken'}</i>${p.thin.length ? `<i class="warn">${p.thin.length} one-person</i>` : ''}<i>${others.length} change${others.length === 1 ? '' : 's'} for others</i>${p.hc ? `<i class="warn">↻ ${p.hc} hour change${p.hc === 1 ? '' : 's'}</i>` : ''}</div>
      ${others.length ? `<small class="rt-wi-ch">${others.slice(0, 6).map(fmt).join(' · ')}${others.length > 6 ? ' …' : ''}</small>` : ''}
      ${p.bad.length ? `<small class="rt-wi-ch bad">${p.bad.slice(0, 3).map(x => escapeHtml(rtProbText(x))).join(' · ')}</small>` : ''}
      <button class="btn sm${i === 0 ? ' gold' : ''}" onclick="rtWhatIfUse(${i})">Use this</button>
    </div>`;
  }).join('');
  const none100 = r.gaps.length && !r.plans.some(p => p.cover >= 0.999 && !p.bad.length);
  return head + impact + (none100 ? `<div class="rb-prob short">No plan covers 100% under the rules with this team. The closest are below; or bring in a staff member${r.gaps.some(g => g.kind === 'thin') ? ', or run a shift with one person' : ''}.</div>` : '') + `<div class="rt-wi-plans">${plans}</div><small class="ro-hint">Nothing has changed yet. "Use this" ${r.posted ? 'changes the posted roster and tells only the people whose shifts change' : 'changes the draft'}${r.code && r.code !== 'OFF' ? ', and records the ' + escapeHtml(r.code) : ''}.</small>`;
}
function rtWhatIfUse(i) {
  const r = _rtWI, p = r && r.plans[i]; if (!p) return;
  if (!roCanEdit()) { showToast('Only supervisors, managers and owners can change the roster', 'err'); return; }
  const k = r.s.key;
  if (r.code && r.code !== 'OFF') { const c = Object.assign({}, rbPeople[k]); c.absences = Object.assign({}, c.absences, { ['a' + Date.now().toString(36)]: { from: r.days[0], to: r.days[r.days.length - 1], code: r.code } }); rbPeople[k] = c; fbSet('roster/builder/people/' + k, c); }
  const bent = p.bad.length ? `${rtWhatIfText(r)}: ${p.texts.join('; then ')}. Bends: ${p.bad.map(rtProbText).join(', ')} (the closest plan with this team).` : '';
  if (r.posted) {
    const n = rtApplyPublished(r.week, p.cells, rtWhatIfText(r));
    rbDrafts[r.week] = { cells: _rtClone(p.cells), at: Date.now(), fromPublished: true }; rbPutDraft(r.week);
    showToast(`${n} change${n === 1 ? '' : 's'} made in the posted roster; the people concerned are told`, 'ok');
  } else {
    if (typeof rbUndoPush === 'function' && rbWeek === r.week) rbUndoPush();
    rbDrafts[r.week] = Object.assign({}, rbDrafts[r.week], { cells: _rtClone(p.cells), at: Date.now() }); rbPutDraft(r.week);
    showToast(bent ? `Done, and noted in the draft: ${bent}` : 'Done in the draft. ↶ Undo is above the table', bent ? 'warn' : 'ok');
  }
  if (bent) { rbAddNotes(r.week, p.bad.map(x => ({ key: x.key, date: x.date, text: bent }))); rbPutDraft(r.week); }
  document.getElementById('rtWI')?.remove();
  if (typeof brClose === 'function') try { brClose(); } catch (_) {}
  if (document.getElementById('panel-roster-build')?.classList.contains('active')) { rbWeek = r.week; rbRender(); }
}
/** The What if… sheet: who, what, when; the answer appears underneath. */
function rtWhatIfDialog(pre) {
  document.getElementById('rtWI')?.remove();
  const d = document.createElement('div'); d.id = 'rtWI'; d.className = 'ri-viewer';
  const people = Object.keys(roStaff).filter(k => rbActive(k, roMonday(new Date()))).sort((a, b) => rtName(a).localeCompare(rtName(b)));
  d.innerHTML = `<div class="card rt-sheet rt-wi"><div class="ro-card-hd"><b>🤔 What if…</b><button class="ro-x" onclick="document.getElementById('rtWI').remove()">✕</button></div>
    <div class="rt-form">
      <label>Who<select id="rtWiP" onchange="rtWiShifts()">${people.map(k => `<option value="${escapeHtml(k)}"${k === pre ? ' selected' : ''}>${escapeHtml(rtName(k))}</option>`).join('')}</select></label>
      <label>What<select id="rtWiK" onchange="rtWiShifts()"><option value="off">takes the day off</option><option value="sick">is sick</option><option value="leave">is on leave</option><option value="notshift">isn't on a shift</option></select></label>
      <label id="rtWiSL" hidden>Shift<select id="rtWiS"></select></label>
      <label>From<input type="date" id="rtWiF" value="${roToday()}"></label>
      <label>Until<input type="date" id="rtWiT" value="${roToday()}"></label>
    </div>
    <div class="ro-acts"><button class="btn gold" onclick="rtWhatIfRun()">Show me</button><small>Nothing changes until you pick a plan.</small></div>
    <div id="rtWiOut"></div></div>`;
  d.addEventListener('click', e => { if (e.target === d) d.remove(); });
  document.body.appendChild(d);
  rtWiShifts();
}
function rtWiShifts() {
  const k = document.getElementById('rtWiP').value, kind = document.getElementById('rtWiK').value;
  document.getElementById('rtWiSL').hidden = kind !== 'notshift';
  const g = (roStaff[k] || {}).group || '', dt = document.getElementById('rtWiF').value || roToday();
  const mine = rbNorm((roDays[dt] || {})[k] || ((rbDrafts[roMonday(roDate(dt))] || {}).cells || {})[k]?.[dt] || '');
  document.getElementById('rtWiS').innerHTML = rbGroupCfg(g).shifts.map(x => `<option${x === mine ? ' selected' : ''}>${escapeHtml(x)}</option>`).join('');
}
function rtWhatIfRun() {
  const s = { key: document.getElementById('rtWiP').value, kind: document.getElementById('rtWiK').value, from: document.getElementById('rtWiF').value, to: document.getElementById('rtWiT').value, shift: document.getElementById('rtWiS').value };
  const out = document.getElementById('rtWiOut');
  out.innerHTML = '<div class="ri-reading"><span class="ri-spin"></span><div><b>Working it out…</b><small>Finding who can cover, under the rules, with the fewest changes.</small></div></div>';
  setTimeout(() => { out.innerHTML = rtWhatIfHtml(rtWhatIf(s)); }, 50);
}
const RT_WI_RE = /^what\s+if\s+(.+?)\s+(?:is\s+|was\s+|gets\s+|got\s+|calls\s+in\s+|goes\s+)?(sick|off sick|on sick leave|absent|on leave|on vacation|on annual leave|off|takes?\s+(?:the\s+)?(?:day\s+)?off|takes?\s+.+?\s+off|doesn'?t come|does not come|can'?t come|not coming|isn'?t on|is not on|not on|doesn'?t work|does not work|can'?t work|isn'?t in|not in)\b\s*(.*)$/i;
/** Ops Brain: "what if Ahmed is sick tomorrow", "what if Ahmed takes today off", "what if Ahmed isn't on 12-21 on Wed". */
function _rtWhatIfCmd(q) {
  const m = q.match(RT_WI_RE);
  if (!m) return false;
  let who = m[1], verb = m[2].toLowerCase(), rest = m[3] || '';
  const tk = verb.match(/^takes?\s+(.+?)\s+off$/); if (tk && !/^(the\s+)?day$/.test(tk[1])) rest = tk[1] + ' ' + rest;
  const k = rtFind(who);
  if (!k || Array.isArray(k)) { _rtOut(`<div class="br-title">${Array.isArray(k) ? 'Which one: ' + k.map(rtName).map(escapeHtml).join(', ') + '?' : 'I can\'t find "' + escapeHtml(who) + '" in the team.'}</div>`); return true; }
  const kind = /sick|absent|doesn|does not|can'?t come|not coming/.test(verb) ? 'sick' : /leave|vacation/.test(verb) ? 'leave' : /not on|isn'?t on|doesn'?t work|does not work|can'?t work|isn'?t in|not in/.test(verb) ? 'notshift' : 'off';
  const g = (roStaff[k] || {}).group || '';
  const shift = kind === 'notshift' ? rtShiftIn(rest, g) : null;
  const restD = rest.replace(/\d{1,2}[:.]?\d{0,2}\s*(?:-|–|to)\s*\d{1,2}[:.]?\d{0,2}/, ' ').replace(/\b(?:the\s+)?(?:morning|evening|afternoon|night|day|mid)s?\s+shifts?\b|\b(?:the\s+)?shifts?\b|\bnights?\b|\bmornings?\b|\bevenings?\b|\bafternoons?\b/gi, ' ');
  let from = rtDay(restD.replace(/\b(until|till|to)\b.*$/, '').replace(/for\s+\d+\s+days?/, '')) || roToday();
  const um = restD.match(/\b(?:until|till)\s+(.+)$/), fm = restD.match(/for\s+(\d+)\s+days?/), wk = /this week|all week|the week|rest of the week/.test(restD);
  let to = um ? rtDay(um[1]) || from : fm ? roAdd(from, +fm[1] - 1) : wk ? roAdd(roMonday(roDate(from)), 6) : from;
  if (/next week/i.test(restD)) {                       // "on Monday next week" = that day next week; "next week" alone = all of it
    const nw = roAdd(roMonday(new Date()), 7), dn = restD.toLowerCase().match(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*/);
    if (dn) { from = to = roAdd(nw, ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(dn[1])); } else { from = nw; to = roAdd(nw, 6); }
  }
  if (!roCanEdit()) { _rtOut('<div class="br-title">Only supervisors, managers and owners can change the roster.</div>'); return true; }
  const r = rtWhatIf({ key: k, kind, from, to, shift });
  _rtOut(`<div class="br-kind">🤔 Roster · what if</div>${rtWhatIfHtml(r)}<div class="br-acts"><button class="btn sm" onclick="brClose&&brClose();rtWhatIfDialog(${_rtQ(k)})">Try another what-if</button></div>`);
  return true;
}

// ── Changes to a posted week ──────────────────────────────
function rtDiff(week, cells) {
  const out = [];
  Object.keys(cells).forEach(k => rtDates(week).forEach(dt => { const a = (roDays[dt] || {})[k] || '', b = (cells[k] || {})[dt] || ''; if (a !== b) out.push({ key: k, date: dt, from: a, to: b }); }));
  return out;
}
/** Write changed cells straight into the posted roster and tell the people concerned. */
function rtApplyPublished(week, cells, why) {
  const ch = rtDiff(week, cells);
  if (!ch.length) return 0;
  ch.forEach(c => { roDays[c.date] = Object.assign({}, roDays[c.date]); if (c.to) roDays[c.date][c.key] = c.to; else delete roDays[c.date][c.key]; fbSet(`roster/days/${c.date}/${c.key}`, c.to || null); });
  rtNotify(week, ch, why);
  if (typeof logActivity === 'function') try { logActivity('roster_changed', `${ch.length} change${ch.length === 1 ? '' : 's'} · ${why || ''}`.trim()); } catch (_) {}
  if (typeof _roRefresh === 'function') _roRefresh();
  return ch.length;
}
function rtNotify(week, changes, why) {
  const dates = rtDates(week);
  const post = { at: Date.now(), by: (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || 'Someone', byUid: roMyUid(), from: dates[0], to: dates[6], update: true, why: why || '', changes: changes.slice(0, 120).map(c => ({ k: c.key, d: c.date, f: c.from, t: c.to })) };
  roPosted = post;
  fbSet('roster/posted', post);
  roMarkSeen();
}
/** Mark someone sick or on leave for dates, in drafts to come and in any posted week. */
function rtMarkAbsent(k, from, to, code, quiet) {
  to = to && to >= from ? to : from; code = code || 'SL';
  const c = Object.assign({}, rbPeople[k]); const id = 'a' + Date.now().toString(36);
  c.absences = Object.assign({}, c.absences, { [id]: { from, to, code } });
  rbPeople[k] = c; fbSet('roster/builder/people/' + k, c);
  const weeks = new Set(); for (let dt = from; dt <= to; dt = roAdd(dt, 1)) weeks.add(roMonday(roDate(dt)));
  const touched = [];
  weeks.forEach(w => {
    if (rbDrafts[w]) { rtDates(w).forEach(dt => { if (dt >= from && dt <= to) { rbDrafts[w].cells[k] = rbDrafts[w].cells[k] || {}; rbDrafts[w].cells[k][dt] = code; } }); rbPutDraft(w); }
    if (rtIsPublished(w)) {
      const cells = rtPublished(w); rtDates(w).forEach(dt => { if (dt >= from && dt <= to) cells[k][dt] = code; });
      if (rtApplyPublished(w, cells, `${rtName(k)}: ${code}`)) touched.push(w);
    }
  });
  if (!quiet) showToast(`${rtName(k)}: ${code} ${from === to ? 'on ' + roDayLbl(from) : roDayLbl(from) + ' → ' + roDayLbl(to)}`, 'ok');
  return touched;
}

// ── The posted week as a picture ──────────────────────────
function rtPostedRes(week) {
  const dates = rtDates(week), names = [], cells = {}, groups = {}, ids = {};
  const keys = Object.keys(roStaff).filter(k => dates.some(dt => (roDays[dt] || {})[k]));
  const gOrder = roGroups();
  keys.sort((a, b) => gOrder.indexOf(roStaff[a].group || '') - gOrder.indexOf(roStaff[b].group || '') || (roStaff[a].order ?? 999) - (roStaff[b].order ?? 999));
  keys.forEach(k => { const s = roStaff[k]; names.push(s.name); cells[s.name] = {}; dates.forEach(dt => { const v = (roDays[dt] || {})[k]; if (v) cells[s.name][dt] = v; }); if (s.group) groups[s.name] = s.group; if (s.id) ids[s.name] = s.id; });
  return { names, dates, cells, groups, ids };
}
function rtSharePosted(week) {
  week = week || roWeek;
  const res = rtPostedRes(week);
  if (!res.names.length) { showToast('No roster posted for this week yet', 'warn'); return; }
  rbSharePic(res);
}

// ── Team file (staff and a roster, imported in one go) ────
/** { hotelopsTeam: 1, staff: [{ name, id, hotel, title }], roster: [{ name, days: { 'YYYY-MM-DD': 'OFF' } }] } */
function rtImportTeam(data) {
  if (!data || !data.hotelopsTeam || !Array.isArray(data.staff)) { showToast('That isn\'t a HotelOps team file', 'err'); return; }
  let n = 0, t = 0, cells = 0;
  const base = Math.max(0, ...Object.values(roStaff).map(x => x.order || 0));
  data.staff.forEach((p, i) => {
    if (!p || !p.name) return;
    const k = roKey(p.name);
    roStaff[k] = Object.assign({}, roStaff[k], { name: p.name, order: (roStaff[k] && roStaff[k].order != null) ? roStaff[k].order : base + i + 1 });
    if (p.hotel) roStaff[k].group = p.hotel;
    if (p.id) roStaff[k].id = String(p.id);
    fbSet('roster/staff/' + k, roStaff[k]); n++;
    if (p.title && !rbTitle(k)) { rbSetPerson(k, 'title', p.title); t++; }
  });
  (data.roster || []).forEach(r => {
    const k = roKey(r.name || ''); if (!roStaff[k]) return;
    Object.entries(r.days || {}).forEach(([dt, v]) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(dt) || !v) return; roDays[dt] = Object.assign({}, roDays[dt], { [k]: v }); fbSet(`roster/days/${dt}/${k}`, v); cells++; });
  });
  if (typeof roGuessMe === 'function') roGuessMe();
  showToast(`Team file: ${n} staff, ${t} titles, ${cells} roster days`, 'ok');
  if (typeof logActivity === 'function') try { logActivity('team_import', `${n} staff`); } catch (_) {}
  if (typeof rbRender === 'function') rbRender();
  if (typeof _roRefresh === 'function') _roRefresh();
}
function rtImportTeamFile(input) {
  const f = input.files && input.files[0]; input.value = '';
  if (!f) return;
  f.text().then(t => { try { rtImportTeam(JSON.parse(t)); } catch (e) { showToast('Could not read the team file: ' + e.message, 'err'); } });
}

// ── Team ──────────────────────────────────────────────────
function rtTeamHtml(shown) {
  return `<div class="rt-team-acts"><button class="btn sm gold" onclick="rtNewStaffDialog()">＋ Add staff</button><button class="btn sm" onclick="rtSickDialog()">🤒 Sick / leave</button><label class="btn sm">📥 Team file<input type="file" accept=".json,application/json" hidden onchange="rtImportTeamFile(this)"></label><small>Tap a name for titles, shift, leave and history.</small></div>
  ${shown.map(g => `<div class="rb-sub">${escapeHtml(g || 'Team')}</div><div class="rt-list">${Object.keys(roStaff).filter(k => ((roStaff[k] || {}).group || '') === g && !((rbPeople[k] || {}).deleted)).sort((a, b) => (roStaff[a].order ?? 999) - (roStaff[b].order ?? 999) || roStaff[a].name.localeCompare(roStaff[b].name)).map(k => {
    const c = rbPeople[k] || {}, p = rbPersonCfg(k), ph = rbPhOwed(k), today = roToday();
    const away = Object.values(c.absences || {}).find(a => a.to >= today);
    const left = c.left && c.left <= roAdd(rbWeek, 6);
    return `<button class="rt-row${left ? ' gone' : ''}" onclick="rtPerson(${_rtQ(k)})">
      <span class="rt-n"><b>${escapeHtml(roStaff[k].name)}${p.lock ? ' 🔒' : ''}${c.home ? ' 🏨' : ''}</b>${c.title ? `<i class="rt-title ${/manager/i.test(c.title) ? 'mgr' : /supervisor|leader/i.test(c.title) ? 'sup' : ''}">${escapeHtml(c.title)}</i>` : ''}</span>
      <span class="rt-m">${left ? 'left ' + escapeHtml(roDayLbl(c.left)) : p.mode === 'static' ? 'Static ' + escapeHtml(roShort(roInfo(p.fixed)) || p.fixed) : p.mode === 'rotate' ? 'Rotates' : 'Any shift'} · ${p.offs} off${ph.owed ? ' · PH ' + ph.owed : ''}${away ? ` · <em>${escapeHtml(away.code)} ${escapeHtml(roDayLbl(away.from))}${away.to !== away.from ? '–' + escapeHtml(roDayLbl(away.to)) : ''}</em>` : ''}</span></button>`; }).join('') || '<div class="ro-empty">Nobody yet.</div>'}</div>`).join('')}`;
}
function rtSet(k, f, v) { rbSetPerson(k, f, v); }
function rtSetStaff(k, f, v) { roStaff[k] = Object.assign({}, roStaff[k], { [f]: v }); fbSet(`roster/staff/${k}/${f}`, v); }

/** A person's card: details, shift, leave, history. */
function rtPerson(k) {
  const s = roStaff[k]; if (!s) return;
  const c = rbPeople[k] || {}, p = rbPersonCfg(k), ph = rbPhOwed(k), g = s.group || '';
  const shifts = rbGroupCfg(g).shifts, q = _rtQ(k);
  const groups = rbGroups().filter(Boolean);
  // history: the last 6 weeks
  const weeks = []; for (let i = 5; i >= -1; i--) weeks.push(roAdd(roMonday(new Date()), -7 * i));
  const hist = weeks.map(w => `<tr><td class="ro-name">${escapeHtml(roDate(w).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}</td>${rtDates(w).map(dt => { const v = (roDays[dt] || {})[k] || ''; const i = roInfo(v); return `<td class="ro-cell ${i ? 'ro-t-' + i.type : ''}${dt === roToday() ? ' ro-today' : ''}" title="${escapeHtml(v)}">${escapeHtml(roCellTxt(i)) || '·'}</td>`; }).join('')}</tr>`).join('');
  const since = roAdd(roToday(), -30), tally = {};
  Object.keys(roDays).filter(dt => dt >= since && dt <= roToday()).forEach(dt => { const v = (roDays[dt] || {})[k]; if (!v) return; const key = rbNorm(v) || (/^PH/i.test(v) ? 'PH' : v.toUpperCase()); tally[key] = (tally[key] || 0) + 1; });
  const absences = Object.entries(c.absences || {}).sort((a, b) => b[1].from.localeCompare(a[1].from));
  document.getElementById('rtSheet')?.remove();
  const d = document.createElement('div');
  d.id = 'rtSheet'; d.className = 'ri-viewer';
  d.innerHTML = `<div class="card rt-sheet">
    <div class="ro-card-hd"><b>${escapeHtml(s.name)}</b><button class="ro-x" onclick="document.getElementById('rtSheet').remove();rbRender()">✕</button></div>
    <div class="rt-form">
      <label>Name<input value="${escapeHtml(s.name)}" onchange="rtSetStaff(${q},'name',this.value.trim())"></label>
      <label>Employee no.<input value="${escapeHtml(s.id || '')}" onchange="rtSetStaff(${q},'id',this.value.trim())"></label>
      <label>Title<select onchange="rtSet(${q},'title',this.value||undefined)"><option value="">—</option>${RB_TITLES.map(t => `<option${c.title === t ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Hotel<select onchange="if(this.value==='~'){const n=prompt('New hotel name');if(n)rtSetStaff(${q},'group',n.trim());}else rtSetStaff(${q},'group',this.value);rtPerson(${q})">${groups.map(x => `<option${x === g ? ' selected' : ''}>${escapeHtml(x)}</option>`).join('')}${!g ? '<option selected value="">—</option>' : ''}<option value="~">＋ New hotel…</option></select></label>
      <label>Shift<select onchange="const v=this.value;if(v==='rotate'||v==='any'){rtSet(${q},'mode',v);rtSet(${q},'fixed',v==='any'?'':undefined);}else{rtSet(${q},'mode','static');rtSet(${q},'fixed',v);}rtPerson(${q})">
        ${shifts.map(x => `<option value="${escapeHtml(x)}"${p.mode === 'static' && p.fixed === x ? ' selected' : ''}>Static: always ${escapeHtml(x)}</option>`).join('')}
        <option value="rotate"${p.mode === 'rotate' ? ' selected' : ''}>Rotates week to week</option><option value="any"${p.mode === 'any' ? ' selected' : ''}>Any shift (flexible)</option></select></label>
      <label>Days off a week<select onchange="rtSet(${q},'offs',+this.value)">${[0, 1, 2, 3].map(n => `<option${n === p.offs ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Prefers off<select onchange="rtSet(${q},'prefOff',this.value===''?[]:[+this.value])"><option value="">no preference</option>${RB_DAYS.map((x, i) => `<option value="${i}"${(p.prefOff || []).includes(i) ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>PH owed<input type="number" min="0" max="30" value="${ph.owed}" onchange="rbSetPh(${q},+this.value)"></label>
    </div>
    <div class="rt-cant"><span>Locks:</span><button class="rb-opt${p.lock ? ' on' : ''}" onclick="rtSet(${q},'lockShift',${!p.lock});rtPerson(${q})">${p.lock ? '🔒' : '🔓'} ${p.lock ? 'Keeps ' + escapeHtml(p.fixed || 'their shift') : 'Shift can change'}</button><button class="rb-opt${c.home ? ' on' : ''}" onclick="rtSet(${q},'home',${c.home ? 'undefined' : 'true'});rtPerson(${q})">🏨 ${c.home ? 'Stays at ' + escapeHtml(g || 'their hotel') : 'Can help other hotels'}</button></div>
    <div class="rt-cant"><span>Works:</span><button class="rb-opt ro-t-night" onclick="rtOnly(${q},'night')">🌙 Nights only</button><button class="rb-opt ro-t-morning" onclick="rtOnly(${q},'day')">☀️ Days only</button><button class="rb-opt" onclick="rtOnly(${q},'all')">All shifts</button></div>
    <div class="rt-cant"><span>Shifts:</span>${shifts.map(x => { const no = (c.allowed && c.allowed.length && !c.allowed.includes(x)), soft = (c.soft || []).includes(x); return `<button class="rb-opt ro-t-${(roInfo(x) || {}).type}${no ? ' on' : soft ? ' soft' : ''}" onclick="rtToggleShift(${q},${_rtQ(x)})" title="Tap: prefer not → can't work → fine">${no ? '🚫 ' : soft ? '⚠ ' : ''}${escapeHtml(x)}</button>`; }).join('')}<small class="ro-hint">Tap a shift: ⚠ prefer not (only if needed) → 🚫 can't work → fine</small></div>
    <div class="rb-sub">Sick & leave</div>
    <div class="rt-abs">${absences.map(([id, a]) => `<span class="rb-hol">${escapeHtml(a.code)} · ${escapeHtml(roDayLbl(a.from))}${a.to !== a.from ? ' → ' + escapeHtml(roDayLbl(a.to)) : ''}<button class="ro-x" onclick="rtDelAbsence(${q},'${id}')">✕</button></span>`).join('') || '<span class="ro-empty">None.</span>'}</div>
    <div class="rb-inline"><select id="rtAbC">${RT_LEAVE.map(x => `<option>${x}</option>`).join('')}</select><input type="date" id="rtAbF" value="${roToday()}"><input type="date" id="rtAbT" value="${roToday()}"><button class="btn sm gold" onclick="rtAbsentFromSheet(${q})">Add</button></div>
    <div class="rb-sub">History <small>last weeks, and the last 30 days: ${Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([x, n]) => `${escapeHtml(x)} ×${n}`).join(' · ') || 'nothing yet'}</small></div>
    <div class="ro-scroll"><table class="ro-table"><thead><tr><th class="ro-name">Week</th>${RB_DAYS.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${hist}</tbody></table></div>
    <div class="rb-sub">Working here</div>
    <div class="rb-inline"><label>Joined <input type="date" value="${escapeHtml(c.joined || '')}" onchange="rtSet(${q},'joined',this.value||undefined)"></label><label>Left on <input type="date" value="${escapeHtml(c.left || '')}" onchange="rtSet(${q},'left',this.value||undefined);rtPerson(${q})"></label></div>
    <div class="ro-acts"><button class="btn" onclick="rtDelete(${q})">🗑 Delete from the team</button><small>Left staff stay in old rosters; deleting removes them from the team list too.</small></div>
  </div>`;
  d.addEventListener('click', e => { if (e.target === d) { d.remove(); rbRender(); } });
  document.body.appendChild(d);
}
function rtOnly(k, kind) {
  const g = (roStaff[k] || {}).group || '', all = rbGroupCfg(g).shifts;
  const list = kind === 'all' ? all : all.filter(s => (kind === 'night') === rbIsNight(s));
  rtSet(k, 'allowed', kind === 'all' || !list.length ? undefined : list);
  if (kind !== 'all' && (rbPeople[k] || {}).fixed && !list.includes(rbPeople[k].fixed)) rtSet(k, 'fixed', undefined);
  rtPerson(k);
}
/** fine → ⚠ prefer not (used only when needed) → 🚫 can't work → fine */
function rtToggleShift(k, s) {
  const c = rbPeople[k] || {}, soft = (c.soft || []).slice(), cant = c.allowed && c.allowed.length && !c.allowed.includes(s);
  if (cant) { rtToggleCant(k, s, true); return; }                              // can't → fine
  if (soft.includes(s)) { rtSet(k, 'soft', soft.filter(x => x !== s).length ? soft.filter(x => x !== s) : undefined); rtToggleCant(k, s); return; }   // prefer not → can't
  rtSet(k, 'soft', soft.concat([s])); rtPerson(k);                               // fine → prefer not
}
function rtToggleCant(k, s) {
  const g = (roStaff[k] || {}).group || '', all = rbGroupCfg(g).shifts, c = rbPeople[k] || {};
  let allowed = c.allowed && c.allowed.length ? c.allowed.slice() : all.slice();
  allowed = allowed.includes(s) ? allowed.filter(x => x !== s) : allowed.concat([s]);
  rtSet(k, 'allowed', allowed.length === all.length ? undefined : allowed);
  rtPerson(k);
}
function rtAbsentFromSheet(k) {
  const from = document.getElementById('rtAbF').value, to = document.getElementById('rtAbT').value, code = document.getElementById('rtAbC').value;
  if (!from) return;
  const touched = rtMarkAbsent(k, from, to, code);
  rtPerson(k);
  if (touched.length) rtOfferCover(touched[0]);
}
function rtDelAbsence(k, id) { const c = Object.assign({}, rbPeople[k]); c.absences = Object.assign({}, c.absences); delete c.absences[id]; rbPeople[k] = c; fbSet('roster/builder/people/' + k, c); rtPerson(k); }
function rtDelete(k) {
  if (!confirm(`Delete ${rtName(k)} from the team? Past rosters keep their shifts.`)) return;
  rtSet(k, 'deleted', true); rtSet(k, 'left', rtSet && (rbPeople[k] || {}).left || roToday());
  delete roStaff[k]; fbSet('roster/staff/' + k, null);
  document.getElementById('rtSheet')?.remove(); rbRender();
  showToast('Removed from the team', 'ok');
}
/** A new person joining: one form, then they're in the team and the next build. */
function rtNewStaffDialog(pre) {
  pre = pre || {};
  document.getElementById('rtNew')?.remove();
  const d = document.createElement('div'); d.id = 'rtNew'; d.className = 'ri-viewer';
  const groups = rbGroups().filter(Boolean), g0 = pre.group || rbGroup || (roStaff[roMeKey] || {}).group || groups[0] || '';
  const start = pre.from || (rbWeek && rbWeek > roToday() ? rbWeek : roToday());
  const shifts = rbGroupCfg(g0).shifts;
  d.innerHTML = `<div class="card rt-sheet"><div class="ro-card-hd"><b>＋ New staff</b><button class="ro-x" onclick="document.getElementById('rtNew').remove()">✕</button></div>
    <div class="rt-form">
      <label>Full name<input id="rtNwN" value="${escapeHtml(pre.name || '')}" placeholder="e.g. Maria Santos" autocomplete="off"></label>
      <label>Employee no. <small>(optional)</small><input id="rtNwI" autocomplete="off"></label>
      <label>Hotel<select id="rtNwG" onchange="rtNwShifts()">${groups.map(x => `<option${x === g0 ? ' selected' : ''}>${escapeHtml(x)}</option>`).join('') || '<option value="">—</option>'}</select></label>
      <label>Title<select id="rtNwT"><option value="">Agent (no title)</option>${RB_TITLES.map(t => `<option${t === pre.title ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Starts on<input type="date" id="rtNwF" value="${start}"></label>
      <label>Days off a week<select id="rtNwO">${[1, 2, 3].map(n => `<option${n === 1 ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Shifts<select id="rtNwS"><option value="">Any shift (rotates)</option>${shifts.map(x => `<option>${escapeHtml(x)}</option>`).join('')}</select></label>
    </div>
    <div class="ro-acts"><button class="btn gold" onclick="rtNewStaffSave()">Add to the team</button><small>They're rostered from their start date. Training days or a fixed shift can be set on their card after.</small></div></div>`;
  d.addEventListener('click', e => { if (e.target === d) d.remove(); });
  document.body.appendChild(d);
  setTimeout(() => document.getElementById('rtNwN')?.focus(), 50);
}
function rtNwShifts() { const g = document.getElementById('rtNwG').value; document.getElementById('rtNwS').innerHTML = '<option value="">Any shift (rotates)</option>' + rbGroupCfg(g).shifts.map(x => `<option>${escapeHtml(x)}</option>`).join(''); }
function rtNewStaffSave() {
  const name = document.getElementById('rtNwN').value.trim().replace(/\s+/g, ' ');
  if (!name) { showToast('Write their name', 'warn'); return; }
  if (!roCanEdit()) { showToast('Only supervisors, managers and owners can change the team', 'err'); return; }
  const k = roKey(name);
  if (roStaff[k] && !(rbPeople[k] || {}).deleted) { showToast(`${roStaff[k].name} is already in the team`, 'warn'); return; }
  const g = document.getElementById('rtNwG').value, id = document.getElementById('rtNwI').value.trim(), title = document.getElementById('rtNwT').value;
  const from = document.getElementById('rtNwF').value || roToday(), offs = +document.getElementById('rtNwO').value, fixed = document.getElementById('rtNwS').value;
  const order = Math.max(0, ...Object.values(roStaff).map(x => x.order || 0)) + 1;
  roStaff[k] = Object.assign({ name, group: g, order }, id ? { id } : {});
  fbSet('roster/staff/' + k, roStaff[k]);
  rbPeople[k] = Object.assign({ joined: from, offs }, title ? { title } : {}, fixed ? { mode: 'static', fixed } : { mode: 'any' });
  fbSet('roster/builder/people/' + k, rbPeople[k]);
  document.getElementById('rtNew')?.remove();
  showToast(`${name} added to ${g || 'the team'} from ${roDayLbl(from)}. Build again to put them on the roster`, 'ok');
  if (document.getElementById('panel-roster-build')?.classList.contains('active')) rbRender();
}
function rtAddStaff() {
  const name = prompt('Full name of the new staff member');
  if (!name || !name.trim()) return;
  const k = roKey(name);
  if (roStaff[k]) { showToast(`${roStaff[k].name} is already in the team`, 'warn'); rtPerson(k); return; }
  const g = rbGroup || (roStaff[roMeKey] || {}).group || rbGroups()[0] || '';
  const order = Math.max(0, ...Object.values(roStaff).map(x => x.order || 0)) + 1;
  roStaff[k] = { name: name.trim().replace(/\s+/g, ' '), group: g, order };
  fbSet('roster/staff/' + k, roStaff[k]);
  rbPeople[k] = { joined: rbWeek, mode: 'any' }; fbSet('roster/builder/people/' + k, rbPeople[k]);
  rtPerson(k);
}
/** Quick: someone is sick or on leave. */
function rtSickDialog(pre) {
  document.getElementById('rtSick')?.remove();
  const d = document.createElement('div'); d.id = 'rtSick'; d.className = 'ri-viewer';
  const people = Object.keys(roStaff).filter(k => rbActive(k, roMonday(new Date()))).sort((a, b) => rtName(a).localeCompare(rtName(b)));
  d.innerHTML = `<div class="card rt-sheet"><div class="ro-card-hd"><b>🤒 Sick or on leave</b><button class="ro-x" onclick="document.getElementById('rtSick').remove()">✕</button></div>
    <div class="rt-form">
      <label>Who<select id="rtSkP">${people.map(k => `<option value="${escapeHtml(k)}"${k === pre ? ' selected' : ''}>${escapeHtml(rtName(k))}${(roStaff[k].group ? ' · ' + escapeHtml(roStaff[k].group) : '')}</option>`).join('')}</select></label>
      <label>What<select id="rtSkC">${RT_LEAVE.map(x => `<option>${x}</option>`).join('')}</select></label>
      <label>From<input type="date" id="rtSkF" value="${roToday()}"></label>
      <label>Until<input type="date" id="rtSkT" value="${roToday()}"></label>
    </div>
    <div class="ro-acts"><button class="btn gold" onclick="rtSickSave()">Save and find cover</button><small>Changes the posted roster too and tells the people whose shifts change.</small></div></div>`;
  d.addEventListener('click', e => { if (e.target === d) d.remove(); });
  document.body.appendChild(d);
}
function rtSickSave() {
  const k = document.getElementById('rtSkP').value, from = document.getElementById('rtSkF').value, to = document.getElementById('rtSkT').value, code = document.getElementById('rtSkC').value;
  document.getElementById('rtSick')?.remove();
  const touched = rtMarkAbsent(k, from, to, code);
  rtOfferCover(touched[0] || roMonday(roDate(from)));
}
/** Open the builder on a posted week, with the gaps and the ways to fill them on top. */
function rtOfferCover(week) {
  rbWeek = week;
  if (rtIsPublished(week) && !(rbDrafts[week] && rbDrafts[week].fromPublished)) rbLoadPublished(week, true);
  if (typeof rbOpen === 'function') rbOpen();
  setTimeout(() => document.getElementById('rbFix')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
}

// ── Drag a cell onto another to swap ──────────────────────
(function () {
  let drag = null, timer = null;
  const cellAt = (x, y) => { const el = document.elementFromPoint(x, y); return el && el.closest && el.closest('.rb-table td.ro-cell[data-k]'); };
  const end = () => { clearTimeout(timer); if (drag && drag.ghost) drag.ghost.remove(); document.querySelectorAll('.rb-drop').forEach(e => e.classList.remove('rb-drop')); document.body.classList.remove('rb-dragging'); drag = null; };
  const start = (td, x, y) => {
    drag.on = true; document.body.classList.add('rb-dragging');
    const g = document.createElement('div'); g.className = 'rb-ghost'; g.textContent = td.textContent.trim() || '·'; document.body.appendChild(g);
    drag.ghost = g; g.style.left = x + 'px'; g.style.top = y + 'px';
    if (navigator.vibrate) try { navigator.vibrate(15); } catch (_) {}
  };
  document.addEventListener('pointerdown', e => {
    const td = e.target.closest && e.target.closest('.rb-table td.ro-cell[data-k]');
    if (!td || e.button > 0) return;
    drag = { td, x: e.clientX, y: e.clientY, on: false, touch: e.pointerType !== 'mouse' };
    if (drag.touch) timer = setTimeout(() => { if (drag && !drag.moved) start(td, drag.x, drag.y); }, 380);
  }, true);
  document.addEventListener('pointermove', e => {
    if (!drag) return;
    const dist = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
    if (!drag.on) {
      if (drag.touch) { if (dist > 10) { drag.moved = true; clearTimeout(timer); } return; }   // a phone scrolls until a long press
      if (dist > 6) start(drag.td, e.clientX, e.clientY); else return;
    }
    drag.ghost.style.left = e.clientX + 'px'; drag.ghost.style.top = e.clientY + 'px';
    document.querySelectorAll('.rb-drop').forEach(x => x.classList.remove('rb-drop'));
    const t = cellAt(e.clientX, e.clientY); if (t && t !== drag.td) t.classList.add('rb-drop');
  }, true);
  document.addEventListener('touchmove', e => { if (drag && drag.on) e.preventDefault(); }, { passive: false });
  document.addEventListener('pointerup', e => {
    if (!drag) return;
    const d0 = drag; clearTimeout(timer);
    if (d0.on) {
      const t = cellAt(e.clientX, e.clientY);
      end();
      if (t && t !== d0.td) rtDragSwap(d0.td.dataset.k, d0.td.dataset.d, t.dataset.k, t.dataset.d);
      e.preventDefault(); e.stopPropagation();
      d0.td.dataset.noClick = '1'; setTimeout(() => { delete d0.td.dataset.noClick; }, 50);
      return;
    }
    end();
  }, true);
  document.addEventListener('pointercancel', end, true);
})();
function rtDragSwap(k1, d1, k2, d2) {
  const D = rbDrafts[rbWeek]; if (!D) return;
  const I = rbInput(rbSeed), pre = (k, dt) => ((I.pre || {})[k] || {})[dt];
  if (pre(k1, d1) || pre(k2, d2)) { showToast('That day is fixed by a request or leave: change it in the requests first', 'warn'); return; }
  rbUndoPush();
  const a = (D.cells[k1] || {})[d1] || '', b = (D.cells[k2] || {})[d2] || '';
  D.cells[k1] = D.cells[k1] || {}; D.cells[k2] = D.cells[k2] || {};
  D.cells[k1][d1] = b; D.cells[k2][d2] = a;
  const bad = rbProblems(I, D.cells).filter(p => (p.key === k1 || p.key === k2) && p.kind !== 'offs');
  rbSaveDraft(); rbRefreshOut();
  const why = p => p.kind === 'rest' ? `${rtName(p.key)} gets only ${Math.round(p.hours)} h rest` : p.kind === 'long' ? 'a shift over 9 h' : p.kind === 'switch' ? `${rtName(p.key)} goes between night and day without a day off` : p.kind === 'who' ? `${rtName(p.key)}: ${p.code} is for ${(p.who || []).join(' / ')} only` : `${rtName(p.key)} works too many days in a row`;
  showToast(bad.length ? `Swapped, but check: ${[...new Set(bad.map(why))].join('; ')}. ↶ Undo is above the table.` : 'Swapped', bad.length ? 'warn' : 'ok');
}

// ── Ops Brain ─────────────────────────────────────────────
const RT_NOT_STAFF = /\b(?:mr|mrs|ms|miss|dr|guests?|rooms?|pax|booking|reservation|conf|confirmation|company|group|vip)\b|\d/i;
const RT_STOP = /^(?:who|what|which|when|where|why|how|is|are|was|the|a|an|on|for|to|in|at|of|and|or|with|his|her|their|our|my|me|this|that|next|last|week|today|tomorrow|tonight|now|all|any|someone|somebody|anyone|everyone|staff|team|shift|shifts|day|days|night|morning|evening|off|manager|supervisor|agent)$/;
function rtFind(text) {
  const raw = String(text || '');
  if (RT_NOT_STAFF.test(raw)) return null;                       // "Mr Ahmed", "the guest in 512": a guest, never a staff member
  const t = raw.toLowerCase().replace(/[^a-z\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const staff = Object.keys(roStaff).map(k => ({ k, n: rtName(k).toLowerCase() }));
  let hit = staff.filter(s => s.n === t || (' ' + t + ' ').includes(' ' + s.n + ' '));   // whole words: "Khalid" is not "Ali"
  if (hit.length === 1) return hit[0].k;
  const words = t.split(' ').filter(w => w.length > 1 && !RT_STOP.test(w));
  if (!words.length || words.length > 4) return null;
  hit = staff.filter(s => words.length && words.every(w => s.n.split(' ').some(x => x.startsWith(w))));
  if (hit.length === 1) return hit[0].k;
  if (hit.length > 1) return hit.map(h => h.k);
  // a typo: each word within one or two letters of a word in their name ("stanly" → Stanley)
  const near = (a, b) => { if (Math.abs(a.length - b.length) > 2) return false; const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) dp[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return dp[a.length][b.length] <= (a.length >= 6 ? 2 : 1); };
  hit = staff.filter(s => words.length && words.every(w => w.length >= 3 && s.n.split(' ').some(x => near(w, x))));
  if (hit.length === 1) return hit[0].k;
  if (hit.length > 1) return hit.map(h => h.k);
  return null;
}
/** Every name in "Ahmed or Manisha" is someone on the team (or could be one of a few: then we ask which). */
function rtNamesOk(s) { const parts = String(s || '').split(/\s*(?:,|\bor\b|\band\b|&|\/)\s*/i).filter(Boolean); return parts.length > 0 && parts.every(x => !!rtFind(x)); }
/** A command pattern that only matches when the names it captures are staff: guests' and rooms' questions go to the rest of Ops Brain. */
function rtNamed(re, pick) { return { test: q => { const m = String(q).trim().match(re); return !!m && pick(m).filter(x => x != null).every(rtNamesOk); }, source: re.source }; }
/** "Manisha prefers not nights", "try to avoid nights for Manisha", "avoid 19-04 for Ahmed", "Manisha can do nights again" */
function rtSoftParse(q) {
  q = String(q || '').trim();
  const SH = '(mornings?|days?|day shifts?|evenings?|afternoons?|nights?|\\d{1,2}[:.]?\\d{0,2}\\s*(?:-|–|to)\\s*\\d{1,2}[:.]?\\d{0,2})';
  let m = q.match(new RegExp('^(.+?)\\s+(?:prefers? not(?: to (?:do|work))?|would rather not(?: do| work)?|doesn\'?t like|does not like|should avoid|tries to avoid)\\s+(?:the\\s+)?' + SH + '(?:\\s+shifts?)?$', 'i')), who, sh, undo = false;
  if (m) { who = m[1]; sh = m[2]; }
  else if ((m = q.match(new RegExp('^(?:try to\\s+)?avoid\\s+(?:the\\s+)?' + SH + '(?:\\s+shifts?)?\\s+for\\s+(.+)$', 'i')))) { sh = m[1]; who = m[2]; }
  else if ((m = q.match(new RegExp('^(.+?)\\s+(?:can do|is fine (?:with|on)|is ok (?:with|on))\\s+(?:the\\s+)?' + SH + '(?:\\s+shifts?)?(?:\\s+again)?$', 'i')))) { who = m[1]; sh = m[2]; undo = true; }
  else return null;
  const keys = who.split(/\s*(?:,|\band\b|&|\/)\s*/i).filter(Boolean).map(rtFind);
  if (!keys.length || keys.some(k => !k || Array.isArray(k))) return null;
  const t = sh.toLowerCase().replace(/s$/, '').replace(/ shift$/, '');
  const band = /^morning/.test(t) ? 'morning' : /^day/.test(t) ? 'day' : /^(evening|afternoon)/.test(t) ? 'evening' : /^night/.test(t) ? 'night' : '';
  return { keys, band, shift: band ? '' : rbNorm(sh), undo };
}
/** Words people use for a title → the title in the app. */
/** "lock Ayoub in Adagio", "keep Saad on his shift", "Ali stays at his hotel", "unlock Ayoub": only with real names and a hotel. */
function rtLockParse(q) {
  q = String(q || '').trim();
  const hotelish = t => { t = t.toLowerCase().trim(); return /^(?:his|her|their|the)?\s*(?:own\s+|same\s+)?(?:hotel|property)$/.test(t) || rbGroups().some(g => g && (g.toLowerCase() === t || rbShort(g).toLowerCase() === t)); };
  let m, mode, who;
  if ((m = q.match(/^unlock\s+(.+?)(?:\s+(?:from|in|at)\s+.+)?$/i))) { mode = 'un'; who = m[1]; }
  else if ((m = q.match(/^(?:lock|keep)\s+(.+?)\s+on\s+(?:his|her|their)\s+(?:own\s+)?(?:shift|timing|times|hours?)$/i))) { mode = 'shift'; who = m[1]; }
  else if ((m = q.match(/^(?:lock|keep)\s+(.+?)\s+(?:in|at|to)\s+(.+)$/i)) && hotelish(m[2])) { mode = 'home'; who = m[1]; }
  else if ((m = q.match(/^(.+?)\s+(?:stays?|remains?|should stay|must stay)\s+(?:in|at)\s+(.+)$/i)) && hotelish(m[2])) { mode = 'home'; who = m[1]; }
  else return null;
  const keys = who.split(/\s*(?:,|\band\b|&|\/)\s*/i).filter(Boolean).map(rtFind);
  return keys.length && keys.every(k => k && !Array.isArray(k)) ? { mode, keys } : null;
}
function rtTitleWord(t) {
  t = String(t || '').toLowerCase().replace(/s$/, '').trim();
  if (/^bell\s*(boy|bit|man|hop|staff|desk)?|^porter|^luggage/.test(t)) return 'Bell Boy';
  if (/^(asst\.?|assistant)\s*(front office\s*)?manager/.test(t)) return 'Asst. Manager';
  if (/^duty\s*manager|^dm$/.test(t)) return 'Duty Manager';
  if (/^(front office\s*)?manager|^fom$/.test(t)) return 'Manager';
  if (/^supervisor|^sup$/.test(t)) return 'Supervisor';
  if (/^team\s*leader|^tl$/.test(t)) return 'Team Leader';
  if (/^night\s*audit/.test(t)) return 'Night Auditor';
  if (/^(agent|receptionist|gsa|front desk( agent)?|fda)$/.test(t)) return 'Agent';
  if (/^trainee|^intern/.test(t)) return 'Trainee';
  return '';
}
function rtDay(text) {
  const t = String(text || '').toLowerCase().trim();
  if (!t || /\btoday|tonight|now\b/.test(t)) return roToday();
  if (/tomorrow/.test(t)) return roAdd(roToday(), 1);
  if (/yesterday/.test(t)) return roAdd(roToday(), -1);
  const dn = t.match(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*/);
  if (dn) { const want = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(dn[1]); for (let i = 0; i < 7; i++) { const d = roAdd(roToday(), i); if (roDate(d).getDay() === want) return /next/.test(t) && i < 7 ? roAdd(d, 7) : d; } }
  const p = roParseDate(t.replace(/^(on|for)\s+/, ''), roToday());
  return p || null;
}
function rtShiftIn(text, g) {
  const shifts = rbGroupCfg(g).shifts, t = String(text || '').toLowerCase();
  const n = rbNorm(t.match(/\d{1,2}[:.]?\d{0,2}\s*(?:-|–|to)\s*\d{1,2}[:.]?\d{0,2}/) ? t.match(/\d{1,2}[:.]?\d{0,2}\s*(?:-|–|to)\s*\d{1,2}[:.]?\d{0,2}/)[0] : '');
  if (n && shifts.includes(n)) return n;
  const type = /night/.test(t) ? 'night' : /morning|day shift/.test(t) ? 'morning' : /afternoon|evening|mid/.test(t) ? 'afternoon' : '';
  return type ? shifts.find(s => (roInfo(s) || {}).type === type) || null : null;
}
function _rtOut(html) { if (typeof _bxOut === 'function') _bxOut(html); else { const b = document.getElementById('brAnswers'); if (b) b.innerHTML = `<div class="br-card ba-res">${html}</div>`; } }
let _rtPending = {};
/** Buttons in an Ops Brain answer that apply a change to a posted week. */
function rtOptButtons(week, opts) {
  return `<div class="rt-opts">${opts.map(o => { if (!o.cells) return `<div class="rb-prob short">${escapeHtml(o.text)}</div>`; const id = 'o' + Math.random().toString(36).slice(2, 8); _rtPending[id] = { week, cells: o.cells, why: o.why, notes: o.notes }; return `<button class="btn sm" onclick="rtApplyPending('${id}')">✓ ${escapeHtml(o.text)}${o.ok ? `<small class="rb-ok">OK: ${escapeHtml(o.ok)}</small>` : ''}</button>`; }).join('')}</div>`;
}
function rtApplyPending(id) {
  const o = _rtPending[id]; if (!o) return;
  if (!roCanEdit()) { showToast('Only supervisors, managers and owners can change the roster', 'err'); return; }
  if (rtIsPublished(o.week)) { const n = rtApplyPublished(o.week, o.cells, o.why || 'cover'); rbDrafts[o.week] = Object.assign({}, rbDrafts[o.week], { cells: _rtClone(o.cells), at: Date.now(), fromPublished: true }); showToast(o.why ? `Done: ${o.why}` : `${n} change${n === 1 ? '' : 's'} made; the people concerned are told`, o.why ? 'warn' : 'ok'); }
  else { rbDrafts[o.week] = Object.assign({}, rbDrafts[o.week], { cells: o.cells, at: Date.now() }); showToast(o.why ? `Done: ${o.why}` : 'Changed in the draft', o.why ? 'warn' : 'ok'); }
  rbAddNotes(o.week, o.notes);
  rbPutDraft(o.week);
  _rtPending = {};
  if (typeof brClose === 'function') brClose();
}
const RT_PLAN_RE = [/^(?:put|move|switch|change|give|set|make)\s+(.+?)\s+(?:on|to|for|in|onto)\s+(?:the\s+|a\s+)?(morning|day|evening|afternoon|night|\d{1,2}[:.]?\d{0,2}\s*(?:-|–|to)\s*\d{1,2}[:.]?\d{0,2})s?(?:\s+shifts?)?\s*(this week|next week)?\s*$/i, /^(.+?)\s+(?:on\s+)?(morning|day|evening|afternoon|night)s?(?:\s+shifts?)?\s+(this week|next week)$/i];
function _rtPlanCmd(q) {
  const m = q.match(RT_PLAN_RE[0]) || q.match(RT_PLAN_RE[1]);
  if (!m) return false;
  const both = /\s(and|&)\s/i.test(m[1]);
  const names = m[1].split(/\s*(?:\bor\b|\band\b|&|\/|,)\s*/i).filter(Boolean);
  const keys = names.map(rtFind);
  if (keys.some(k => !k || Array.isArray(k))) { _rtOut(`<div class="br-title">I couldn't tell who: ${names.map((n, i) => !keys[i] ? '"' + escapeHtml(n) + '" isn\'t in the team' : Array.isArray(keys[i]) ? escapeHtml(n) + ' could be ' + keys[i].map(rtName).map(escapeHtml).join(' or ') : '').filter(Boolean).join('; ')}.</div>`); return true; }
  if (!roCanEdit()) { _rtOut('<div class="br-title">Only supervisors, managers and owners can change the roster.</div>'); return true; }
  const band = /afternoon/i.test(m[2]) ? 'evening' : RB_BANDS[m[2].toLowerCase()] ? m[2].toLowerCase() : rbNorm(m[2]);
  const week = /this week/i.test(m[3] || '') ? roMonday(new Date()) : /next week/i.test(m[3] || '') ? roAdd(roMonday(new Date()), 7) : (document.getElementById('panel-roster-build')?.classList.contains('active') && rbWeek) || roAdd(roMonday(new Date()), 7);
  _rtPlans = [];
  const opts = rtPlanOptions(week, keys, band, null, null, both);
  if (!both && keys.length > 1) opts.push(...rtPlanOptions(week, keys, band, null, null, true));
  opts.sort((a, b) => a.score - b.score);
  if (!opts.length) { _rtOut(`<div class="br-title">${escapeHtml(keys.map(rtName).join(' / '))} ${keys.length > 1 ? 'aren\'t' : 'isn\'t'} on the roster that week (left, not started yet, or off the roster on their card).</div>`); return true; }
  _rtOut(`<div class="br-kind">🎯 Roster · ${escapeHtml(rbWeekLabel(week))}</div><div class="br-title">${escapeHtml(keys.map(rtName).join(both ? ' and ' : ' or '))} on ${escapeHtml(rbBandLabel(band).toLowerCase())}</div><div class="br-body">${keys.length > 1 && !both ? 'Each way, best first:' : 'What it would look like:'}</div>${rtPlanButtons(opts)}`);
  return true;
}
const RT_COMMANDS = [
  { re: { test: q => !!rtSoftParse(q) }, ex: 'Lina prefers not nights', does: '⚠ kept off those shifts unless they are the only way to cover', run: q => {
      const L = rtSoftParse(q); if (!L) return false;
      if (!roCanEdit()) { _rtOut('<div class="br-title">Only supervisors, managers and owners can change this.</div>'); return true; }
      const done = [];
      L.keys.forEach(k => { const sh = rbGroupCfg((roStaff[k] || {}).group || '').shifts.filter(x => L.band ? rbBandShifts([x], L.band).length : rbNorm(x) === L.shift); const c = rbPeople[k] || {}; const cur = c.soft || [];
        const next = L.undo ? cur.filter(x => !sh.includes(x)) : [...new Set(cur.concat(sh))]; rbSetPerson(k, 'soft', next.length ? next : undefined); done.push(`${rtName(k)}: ${sh.join(', ') || 'no such shift'}`); });
      if (document.getElementById('panel-roster-build')?.classList.contains('active')) rbRender();
      _rtOut(`<div class="br-kind">⚠ Team</div><div class="br-title">${L.undo ? 'Fine again' : 'Prefers not'}: ${done.map(escapeHtml).join(' · ')}</div><div class="br-body">${L.undo ? 'The builder uses them on those shifts like anyone else.' : 'The builder keeps them off these shifts, and only uses them there when it is the only way to cover (it then says so under Decisions this week).'} Change it on their card in 🧑‍💼 Team.</div>`);
      return true; } },
  { re: { test: q => /^(?:add|new)\s+(?:a\s+)?(?:new\s+)?(?:staff|member|person|employee|joiner|agent)(?:\s+member)?\b/i.test(q) || (/^([a-z][a-z'-]+(?:\s+[a-z][a-z'-]+){0,3})\s+(?:is\s+)?(?:joining|joins)\b/i.test(q) && !RT_NOT_STAFF.test(q) && !/^(?:the|a|an|our|my|breakfast|lunch|dinner|check|group|event|meeting|conference)\b/i.test(q)) }, ex: 'add new staff Maria Santos to Ibis from Monday', does: 'opens the new staff form, filled in', run: q => {
      let m = q.match(/^(?:add|new)\s+(?:a\s+)?(?:new\s+)?(?:staff|member|person|employee|joiner|agent)(?:\s+member)?\b(.*)$/i), rest, name = '';
      if (m) rest = m[1] || ''; else { m = q.match(/^(.+?)\s+(?:is\s+)?(?:joining|joins)\b(.*)$/i); name = m[1]; rest = m[2] || ''; if (rtFind(name)) return false; }
      const gm = rbGroups().find(g => g && new RegExp('\\b(?:to|at|in)\\s+' + rbShort(g), 'i').test(rest));
      const tm = rest.match(/\bas\s+(?:an?\s+)?([a-z .]+?)(?=\s+(?:from|on|starting|at|in|to)\b|$)/i);
      const fm = rest.match(/\b(?:from|on|starting)\s+(.+)$/i);
      if (!name) name = rest.replace(/\b(?:to|at|in)\s+\S+(?:\s+(?:dd|gd))?/i, '').replace(/\bas\s+.+$/i, '').replace(/\b(?:from|on|starting)\s+.+$/i, '').replace(/^\s*(?:called|named)\s+/i, '').trim();
      if (typeof brClose === 'function') try { brClose(); } catch (_) {}
      rtNewStaffDialog({ name: name.replace(/\b\w/g, c => c.toUpperCase()), group: gm, title: tm ? rtTitleWord(tm[1]) : '', from: fm ? rtDay(fm[1]) : '' });
      return true; } },
  { re: /^(?:lock|keep|leave)\s+(?:all|everyone|everybody|all staff|all the staff|the staff|all people)\s+(?:in|at|to)\s+(?:their|his|her|the same|same|own|their own)\s*(?:own\s+)?hotels?$|^(?:no|stop|don'?t)\s+(?:move|moving|lend|lending|borrow|borrowing)\b.*hotels?|^(?:allow|let|start)\s+(?:moving|lending|borrowing|people to move)\b.*hotels?|^unlock\s+(?:all|everyone)\b.*hotels?$/i, ex: 'keep everyone in their own hotel', does: 'no moving people between hotels (or "allow moving between hotels")', run: q => {
      if (!roCanEdit()) { _rtOut('<div class="br-title">Only supervisors, managers and owners can change roster rules.</div>'); return true; }
      const on = !/^(allow|let|start|unlock)/i.test(q);
      rbSetRule('lend', !on);
      _rtOut(`<div class="br-kind">🏨 Roster rules</div><div class="br-title">${on ? 'Everyone stays in their own hotel' : 'Hotels can borrow from each other again'}</div><div class="br-body">${on ? 'The builder and every suggestion keep people at their own hotel. Say "allow moving between hotels" to undo.' : 'A short hotel can borrow someone spare from another. People locked on their card still stay.'}</div>`);
      return true; } },
  { re: { test: q => !!rtLockParse(q) }, ex: 'lock Sam in his hotel', does: '🏨 never moved to another hotel (or "keep Sam on his shift" 🔒, "unlock Sam")', run: q => {
      const L = rtLockParse(q); if (!L) return false;
      if (!roCanEdit()) { _rtOut('<div class="br-title">Only supervisors, managers and owners can change this.</div>'); return true; }
      L.keys.forEach(k => { if (L.mode === 'un') { rbSetPerson(k, 'home', undefined); rbSetPerson(k, 'lockShift', false); } else if (L.mode === 'shift') rbSetPerson(k, 'lockShift', true); else rbSetPerson(k, 'home', true); });
      if (document.getElementById('panel-roster-build')?.classList.contains('active')) rbRender();
      const nm = L.keys.map(rtName).map(escapeHtml).join(' and ');
      _rtOut(`<div class="br-kind">${L.mode === 'un' ? '🔓' : L.mode === 'shift' ? '🔒' : '🏨'} Team</div><div class="br-title">${L.mode === 'un' ? nm + ': unlocked' : L.mode === 'shift' ? nm + ': always ' + L.keys.map(k => escapeHtml(rbPersonCfg(k).fixed || 'their shift')).join(' / ') : nm + ': stays at ' + L.keys.map(k => escapeHtml((roStaff[k] || {}).group || 'their hotel')).join(' / ')}</div><div class="br-body">${L.mode === 'un' ? 'The builder can move them again when it needs to.' : L.mode === 'shift' ? 'The builder never moves them off it, and they are never suggested to cover.' : 'Never moved to another hotel by the builder or in suggestions.'} Change it on their card in 🧑‍💼 Team.</div>`);
      return true; } },
  { re: rtNamed(/^(.+?)\s+(?:is|are)\s+(?:a\s+|an\s+|the\s+|our\s+|now\s+)*(bell\s*\w*|porters?|luggage\s*\w*|(?:asst\.?\s+|assistant\s+)?(?:front office\s+)?managers?|duty\s*managers?|supervisors?|team\s*leaders?|night\s*auditors?|agents?|receptionists?|gsas?|front desk(?:\s+agents?)?|trainees?|interns?)\s*$/i, m => [m[1]]), ex: 'Sam and Lina are bell boys', does: 'sets their title (bell boys get their own shifts, not front desk)', run: q => {
      const m = q.match(/^(.+?)\s+(?:is|are)\s+(?:a\s+|an\s+|the\s+|our\s+|now\s+)*(.+?)\s*$/i), T = rtTitleWord(m[2]);
      if (!T) return false;
      const names = m[1].split(/\s*(?:,|\band\b|&|\/)\s*/i).filter(Boolean), keys = names.map(rtFind);
      if (keys.some(k => !k || Array.isArray(k))) { _rtOut(`<div class="br-title">${names.map((n, i) => !keys[i] ? `I can't find "${escapeHtml(n)}" in the team` : Array.isArray(keys[i]) ? `${escapeHtml(n)} could be ${keys[i].map(rtName).map(escapeHtml).join(' or ')}` : '').filter(Boolean).join('; ')}.</div>`); return true; }
      if (!roCanEdit()) { _rtOut('<div class="br-title">Only supervisors, managers and owners can change titles.</div>'); return true; }
      keys.forEach(k => rbSetPerson(k, 'title', T));
      if (document.getElementById('panel-roster-build')?.classList.contains('active')) rbRender();
      _rtOut(`<div class="br-kind">🧑‍💼 Team</div><div class="br-title">${keys.map(rtName).map(escapeHtml).join(' and ')}: ${escapeHtml(T)}</div><div class="br-body">${T === 'Bell Boy' ? 'They get their own bell shifts and days off in the builder, with their own cover, and never count as front desk or get suggested for desk gaps. Check 👥 Cover needed for each hotel\'s bell cover.' : 'Saved on their card in 🧑‍💼 Team.'}</div><div class="br-acts"><button class="btn sm" onclick="brClose&&brClose();rbOpen()">Open the builder</button></div>`);
      return true; } },
  { re: rtNamed(RT_WI_RE, m => [m[1]]), ex: 'what if Sam is sick tomorrow', does: 'shows what would be short and plans that cover it all', run: q => _rtWhatIfCmd(q) },
  { re: { test: q => RT_PLAN_RE.some(r => { const m = String(q).trim().match(r); return !!m && rtNamesOk(m[1]); }) }, ex: 'put Sam or Lina on day shifts', does: 'tries it each way and shows what changes', run: q => _rtPlanCmd(q) },
  { re: rtNamed(/^(.+?)\s+(?:is\s+|got\s+|called\s+|has\s+)?(sick|on sick leave|off sick|absent|not coming|can'?t come|cannot come|on leave|on vacation|on annual leave)\b(.*)$/i, m => [m[1]]), ex: 'Omar is sick tomorrow', does: 'marks it and finds cover', run: q => {
      const m = q.match(/^(.+?)\s+(?:is\s+|got\s+|called\s+|has\s+)?(sick|on sick leave|off sick|absent|not coming|can'?t come|cannot come|on leave|on vacation|on annual leave)\b(.*)$/i);
      const k = rtFind(m[1]);
      if (!k || Array.isArray(k)) { _rtOut(`<div class="br-title">${Array.isArray(k) ? 'Which one: ' + k.map(rtName).map(escapeHtml).join(', ') + '?' : 'I can\'t find "' + escapeHtml(m[1]) + '" in the team.'}</div>`); return true; }
      if (!roCanEdit()) { _rtOut('<div class="br-title">Only supervisors, managers and owners can change the roster.</div>'); return true; }
      const rest = m[3] || '', code = /leave|vacation/i.test(m[2]) ? 'AL' : 'SL';
      const from = rtDay(rest.replace(/\b(until|till|to)\b.*$/, '')) || roToday();
      const um = rest.match(/\b(?:until|till|to)\s+(.+)$/), fm = rest.match(/for\s+(\d+)\s+days?/);
      const to = um ? rtDay(um[1]) || from : fm ? roAdd(from, +fm[1] - 1) : from;
      const touched = rtMarkAbsent(k, from, to, code, true);
      const w = roMonday(roDate(from));
      let html = `<div class="br-kind">🗓️ Roster</div><div class="br-title">${escapeHtml(rtName(k))}: ${code} ${from === to ? escapeHtml(roDayLbl(from, true)) : escapeHtml(roDayLbl(from)) + ' → ' + escapeHtml(roDayLbl(to))}</div>`;
      if (rtIsPublished(w)) {
        const I = rtCtx(w), adv = rtAdvice(I, rtPublished(w)).filter(a => a.date >= from && a.date <= to);
        html += adv.length ? adv.slice(0, 3).map(a => `<div class="br-body"><b>${escapeHtml(roDayLbl(a.date))} · ${escapeHtml(a.shift)} · ${escapeHtml(a.group)}</b>: ${a.have === 0 ? 'nobody now' : 'one person now'}</div>${rtOptButtons(w, a.options)}`).join('') : '<div class="br-body">Cover is still fine; nothing else to change.</div>';
      } else html += '<div class="br-body">It goes into the roster when you build that week.</div>';
      html += `<div class="br-acts"><button class="btn sm" onclick="brClose&&brClose();rtOfferCover('${w}')">Open in the builder</button></div>`;
      _rtOut(html); return true; } },
  { re: { test: q => { const m = String(q).trim().match(/^(.+?)\s+(?:wants|asks for|asked for|needs|requests?|would like)\s+(?:a\s+|the\s+)?(?:day\s+)?off\b(.*)$/i) || String(q).trim().match(/^(.+?)\s+(?:wants|asks|asked|needs)\s+(\w+day|tomorrow)\s+off$/i); return !!m && rtNamesOk(m[1]); } }, ex: 'Ali wants Friday off', does: 'a day-off request, or swaps if the week is posted', run: q => {
      const m = q.match(/^(.+?)\s+(?:wants|asks for|asked for|needs|requests?|would like)\s+(?:a\s+|the\s+)?(?:day\s+)?off\b(.*)$/i) || q.match(/^(.+?)\s+(?:wants|asks|asked|needs)\s+(\w+day|tomorrow)\s+off$/i);
      const k = rtFind(m[1]), day = rtDay(m[2] || '');
      if (!k || Array.isArray(k) || !day) { _rtOut(`<div class="br-title">${!day ? 'Which day?' : Array.isArray(k) ? 'Which one: ' + k.map(rtName).map(escapeHtml).join(', ') + '?' : 'I can\'t find that person.'}</div>`); return true; }
      const w = roMonday(roDate(day));
      if (rtIsPublished(w)) {
        const I = rtCtx(w), cells = rtPublished(w);
        let opts = rtSwapOptions(I, cells, k, day).filter(o => rbKind(o.cells[k][day]) === 'off');
        const cur = cells[k] && cells[k][day];
        if (rbParse(cur)) {
          // just give the day off, and fill the hole it leaves
          const c2 = _rtClone(cells); c2[k][day] = 'OFF';
          const g = (roStaff[k] || {}).group || '', s = rbNorm(cur), d = rtDates(w).indexOf(day);
          const left = ((rbCover(I, c2)[g] || {})[s] || [])[d] || 0, need = (((I.groups[g] || {}).need || {})[s] || [])[d] || 0;
          if (left >= need) opts.push({ cells: c2, text: `Give ${rtName(k)} the day off: ${s} still has ${left}` });
          else { rtCoverOptions(I, c2, g, day, s).filter(o => o.cells).slice(0, 3).forEach(o => opts.push({ cells: o.cells, text: `Give it, and ${o.text.charAt(0).toLowerCase() + o.text.slice(1)}` })); if (left >= 1) opts.push({ cells: c2, text: `Give it: ${s} runs with ${left} that day` }); }
        }
        _rtOut(`<div class="br-kind">🗓️ Roster</div><div class="br-title">${escapeHtml(rtName(k))} wants ${escapeHtml(roDayLbl(day, true))} off</div><div class="br-body">That week is posted. Ways that keep everyone's rest and cover:</div>${opts.length ? rtOptButtons(w, opts.slice(0, 4)) : '<div class="br-body">No swap keeps the rules. Open the builder to look at other changes.</div>'}<div class="br-acts"><button class="btn sm" onclick="brClose&&brClose();rtOfferCover('${w}')">Open in the builder</button></div>`);
      } else {
        const id = 'q' + Date.now().toString(36), r = { key: k, type: 'off', from: day, to: day, code: '' };
        (rbReqs[w] = rbReqs[w] || {})[id] = r; fbSet(`roster/builder/requests/${w}/${id}`, r);
        _rtOut(`<div class="br-kind">🗓️ Roster</div><div class="br-title">Noted: ${escapeHtml(rtName(k))} off on ${escapeHtml(roDayLbl(day, true))}</div><div class="br-body">It's a request for the week of ${escapeHtml(rbWeekLabel(w))}; the builder keeps it.</div>`);
      }
      return true; } },
  { re: rtNamed(/^swap\s+(.+?)\s+(?:and|with|&)\s+(.+?)(?:\s+(?:on|for)\s+(.+))?$/i, m => [m[1], m[2]]), ex: 'swap Sam and Lina on Tue', does: 'swaps their shifts if the rules allow', run: q => {
      const m = q.match(/^swap\s+(.+?)\s+(?:and|with|&)\s+(.+?)(?:\s+(?:on|for)\s+(.+))?$/i);
      const a = rtFind(m[1]), b = rtFind(m[2]), day = rtDay(m[3] || 'today');
      if (!a || !b || Array.isArray(a) || Array.isArray(b)) { _rtOut('<div class="br-title">I couldn\'t tell who. Use their names as on the roster.</div>'); return true; }
      const w = roMonday(roDate(day)), I = rtCtx(w), cells = rtIsPublished(w) ? rtPublished(w) : (rbDrafts[w] || {}).cells || {};
      const o = rtSwapOptions(I, cells, a, day).find(x => x.text.includes(rtName(b)));
      _rtOut(o ? `<div class="br-kind">🔁 Swap</div><div class="br-title">${escapeHtml(roDayLbl(day, true))}</div>${rtOptButtons(w, [o])}` : `<div class="br-title">That swap would break a rule (rest, 9 hours or cover) on ${escapeHtml(roDayLbl(day))}.</div>`);
      return true; } },
  { re: /^who\s+can\s+(?:cover|work|do|take|fill)\s+(?:the\s+|a\s+)?(?:nights?|mornings?|evenings?|afternoons?|mid|day\s+shifts?|\d{1,2}[:.]?\d{0,2}\s*(?:-|–|to)\s*\d{1,2}[:.]?\d{0,2})\b.*$/i, ex: 'who can cover nights on Wed', does: 'the best people to fill a shift', run: q => {
      const m = q.match(/^who\s+can\s+(?:cover|work|do|take|fill)\s+(.+?)(?:\s+(?:on|for)\s+(\w[\w\s]*))?\??$/i);
      const g = rbGroups().find(x => x && new RegExp('\\b' + rbShort(x), 'i').test(q)) || (roStaff[roMeKey] || {}).group || rbGroups()[0];
      const s = rtShiftIn(m[1], g), day = rtDay(m[2] || 'today');
      if (!s || !day) { _rtOut(`<div class="br-title">Which shift? ${rbGroupCfg(g).shifts.map(escapeHtml).join(', ')}</div>`); return true; }
      const w = roMonday(roDate(day)), I = rtCtx(w), cells = rtIsPublished(w) ? rtPublished(w) : (rbDrafts[w] || {}).cells || {};
      const opts = rtCoverOptions(I, cells, g, day, s);
      _rtOut(`<div class="br-kind">🗓️ ${escapeHtml(g)}</div><div class="br-title">${escapeHtml(s)} on ${escapeHtml(roDayLbl(day, true))}</div>${rtOptButtons(w, opts.slice(0, 5))}`);
      return true; } },
  { re: /\b(?:roster|staff(?:ing)?)\s+(?:problems?|gaps?|issues?|short(?:ages?)?)\b|\bcover\s+(?:gaps?|problems?)\b|\bshort\s+(?:of\s+)?staff\b|\bunderstaffed\b|\bstaff shortage\b/i, ex: 'roster problems', does: 'gaps this week and next, with fixes', run: () => {
      const out = [roMonday(new Date()), roAdd(roMonday(new Date()), 7)].map(w => {
        const cells = rtIsPublished(w) ? rtPublished(w) : (rbDrafts[w] || {}).cells; if (!cells) return `<div class="br-body"><b>${escapeHtml(rbWeekLabel(w))}</b>: not built yet.</div>`;
        const I = rtCtx(w), adv = rtAdvice(I, cells).filter(a => a.date >= roToday());
        return `<div class="br-body"><b>${escapeHtml(rbWeekLabel(w))}</b>: ${adv.length ? adv.length + ' gap' + (adv.length === 1 ? '' : 's') : 'every shift covered'}</div>${adv.slice(0, 3).map(a => `<div class="br-body">${escapeHtml(roDayLbl(a.date))} · ${escapeHtml(a.shift)} · ${escapeHtml(a.group)}: ${a.have}/${a.need}</div>${rtOptButtons(w, a.options.slice(0, 2))}`).join('')}`;
      }).join('');
      _rtOut(`<div class="br-kind">🗓️ Roster</div><div class="br-title">Cover</div>${out}`); return true; } },
  { re: { test: q => { const m = String(q).trim().match(/^(?:when|what)\s+(?:did|does|is)\s+(.+?)\s+work/i) || String(q).trim().match(/^(.+?)(?:'s)?\s+(?:history|shifts?\s+last\s+week|last\s+week|last\s+month)$/i); return !!m && rtNamesOk(m[1]); } }, ex: 'Lina last week', does: 'what someone worked lately', run: q => {
      const m = q.match(/^(?:when|what)\s+(?:did|does|is)\s+(.+?)\s+work/i) || q.match(/^(.+?)(?:'s)?\s+(?:history|shifts?\s+last\s+week|last\s+week|last\s+month)$/i);
      const k = rtFind(m[1]); if (!k || Array.isArray(k)) return false;
      const days = /month/i.test(q) ? 30 : 14, list = [];
      for (let i = days; i >= 0; i--) { const dt = roAdd(roToday(), -i), v = (roDays[dt] || {})[k]; if (v) list.push(`<li><b>${escapeHtml(roDayLbl(dt))}</b>: ${escapeHtml(v)}</li>`); }
      _rtOut(`<div class="br-kind">🗓️ ${escapeHtml(rtName(k))}</div><div class="br-title">Last ${days} days</div>${list.length ? `<ul class="ba-ul">${list.join('')}</ul>` : '<div class="br-body">Nothing in the rosters yet.</div>'}<div class="br-acts"><button class="btn sm" onclick="brClose&&brClose();rbOpen();setTimeout(()=>rtPerson(${_rtQ(k)}),300)">Open their card</button></div>`);
      return true; } },
];

// ── Shift Tasks follow the roster ─────────────────────────
/** The hours each task list stands for: set by hand, else read from your hotel's roster. */
function rtTaskTimes() {
  const set = (rbSettings && rbSettings.taskTimes) || {};
  const g = (roStaff[roMeKey] || {}).group || rbGroups()[0] || '';
  let shifts = [];
  try { shifts = typeof rbGroupCfg === 'function' && Object.keys(roStaff).length ? rbGroupCfg(g).shifts : []; } catch (_) {}
  const of = t => shifts.filter(s => (roInfo(s) || {}).type === t).sort((a, b) => rbMin(a) - rbMin(b));
  const night = of('night'), morn = of('morning'), aft = of('afternoon');
  return {
    morning: set.morning || morn[0] || '07:00 - 15:00',
    mid: set.mid || (aft.length > 1 ? aft[0] : '') || '12:00 - 20:00',
    afternoon: set.afternoon || aft[aft.length - 1] || '15:00 - 23:00',
    night: set.night || night.find(s => rbMin(s) < 300) || night[0] || '23:00 - 07:00',
  };
}
function rtApplyTaskTimes() {
  if (typeof SHIFTS === 'undefined') return;
  const T = rtTaskTimes();
  Object.keys(T).forEach(k => { if (SHIFTS[k]) SHIFTS[k].time = T[k].replace(' - ', ' – '); });
}
function rtTaskTimesHtml() {
  const g = (roStaff[roMeKey] || {}).group || rbGroups()[0] || '', shifts = rbGroupCfg(g).shifts, T = rtTaskTimes(), set = rbSettings.taskTimes || {};
  return `<div class="rb-sub">Shift Tasks hours <small>which roster shift each task list is for (${escapeHtml(g || 'your hotel')})</small></div>
    <div class="rt-form">${[['morning', 'Morning'], ['mid', 'Mid'], ['afternoon', 'Afternoon'], ['night', 'Night']].map(([k, n]) => `<label>${n}<select onchange="rtSetTaskTime('${k}',this.value)"><option value="">${set[k] ? 'From the roster' : 'From the roster: ' + escapeHtml(T[k])}</option>${shifts.map(s => `<option${set[k] === s ? ' selected' : ''}>${escapeHtml(s)}</option>`).join('')}</select></label>`).join('')}</div>`;
}
function rtSetTaskTime(k, v) { rbSettings.taskTimes = Object.assign({}, rbSettings.taskTimes, { [k]: v || null }); fbSet('roster/builder/settings/taskTimes/' + k, v || null); rtApplyTaskTimes(); }

// ── Start ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (typeof BA_COMMANDS !== 'undefined') BA_COMMANDS.unshift(...RT_COMMANDS);
  if (typeof BR_FAQ !== 'undefined') [
    ['someone sick call in sick sick leave vacation absent cover roster', 'Someone is sick', 'Roster → 🤒 Sick / leave (or tell me "Omar is sick tomorrow"). It goes into the posted roster, and I show who can cover: someone whose day off moves, someone moved from a shift with spare, someone borrowed from another hotel, a manager as the last resort, or "bring in a staff member".'],
    ['change roster mid week edit posted roster adjust this week', 'Changing the posted roster', 'Roster → ✏️ Change this week, or in the builder ✏️ Edit this week. Change cells, drag to swap, apply a fix, then 📤 Publish: only the people whose shifts changed are told.'],
    ['swap shift change timing staff asks change shift', 'Someone asks to change their shift', 'Tap their cell in the builder: 🔁 shows only swaps that keep everyone\'s rest and cover. Or ask me "swap Sam and Lina on Tue" or "Ali wants Friday off".'],
    ['add staff new staff delete staff left terminated resigned title manager supervisor', 'Team: add, remove, titles', 'Builder → 🧑‍💼 Team: ＋ Add staff, or tap a name for title, hotel, static or rotating shift, days off, can\'t-work shifts, sick and leave dates, "left on" date, delete, and their history.'],
    ['put someone on morning mornings day evening night shift type this week keep on mornings', 'Put someone on mornings / days / evenings / nights', 'Builder → 🎯 Put someone on…: pick one person (or two, "this or that"), the shift type and the days; you get the options best first with what changes for others. Or ask me "put Sam or Lina on day shifts this week".'],
    ['lock staff hotel lock shift manager keep same hotel move between hotels lend borrow', 'Lock someone to their shift or hotel', 'Their card in 🧑‍💼 Team: 🔒 keeps their shift (managers are locked to theirs by default, so they run the operation), 🏨 stays at their hotel. ⚖️ Rules: "Keep everyone in their own hotel". Or tell me "lock Sam in his hotel", "keep Sam on his shift", "keep everyone in their own hotel".'],
    ['bell boy bellboy porter title', 'Bell boys on the roster', 'Set their title to Bell Boy (their card, or tell me "Sam and Lina are bell boys"): they get their own bell shifts and cover, and never count or get suggested for the front desk.'],
    ['bus time shift times change hours shift timing', 'Shift hours changed (bus times)', 'Builder → 👥 Cover needed: tap the shift\'s hours ✏️ and type the new ones (9 hours at most). It changes everywhere: cover, people on it, and drafts to come.'],
  ].forEach(([q, t, a]) => BR_FAQ.push({ q, t, a, go: 'roster-build', kind: '💡 How the app works' }));
  const old = typeof roIsQuestion === 'function' ? roIsQuestion : null;
  window.roIsQuestion = q => (old && old(q)) || RT_COMMANDS.some(c => c.re.test(String(q).trim()));
  setInterval(rtApplyTaskTimes, 60000); setTimeout(rtApplyTaskTimes, 4000);
  (window.BL_THINKERS = window.BL_THINKERS || []).push(add => {
    if (typeof roCanEdit !== 'function' || !roCanEdit() || !Object.keys(roStaff).length) return;
    const wd = new Date().getDay(), next = roAdd(roMonday(new Date()), 7);
    // Sunday is roster day
    if ((wd === 6 || wd === 0) && !rtIsPublished(next)) add({ id: 'rosterSunday:' + next, type: 'roster', icon: '🗓️', tone: wd === 0 ? 'warn' : 'idle', text: wd === 0 ? 'It\'s Sunday: next week\'s roster isn\'t posted yet.' : 'Tomorrow is Sunday: next week\'s roster is ready to build.', why: rbDrafts[next] ? 'A draft is waiting: check it and publish.' : 'Requests in, press Build, publish.', acts: [['Open the builder', () => { rbWeek = next; rbOpen(); }]] });
    // an empty shift today or tomorrow in the posted roster
    const w = roMonday(new Date());
    if (rtIsPublished(w)) {
      const I = rtCtx(w), adv = rtAdvice(I, rtPublished(w)).filter(a => a.kind === 'short' && (a.date === roToday() || a.date === roAdd(roToday(), 1)));
      adv.slice(0, 2).forEach(a => add({ id: `rosterGap:${a.date}:${a.group}:${a.shift}`, type: 'roster', icon: '⚠️', tone: 'bad', text: `${a.date === roToday() ? 'Today' : 'Tomorrow'} ${a.shift} at ${a.group || 'the hotel'} has nobody.`, why: a.options[0] ? 'Best cover: ' + a.options[0].text : 'Nobody can cover within the rules.', acts: [['Fix it', () => rtOfferCover(w)]] }));
    }
  });
});

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
//    • Ops Brain: "Saad is sick tomorrow", "Ali wants Friday off",
//      "swap Hassan and Turab on Tue", "who can cover nights on Wed",
//      "roster problems", "Manisha last week".
//    • Shift Tasks follow the roster's real hours.
// ═══════════════════════════════════════════════════════════

const RT_LEAVE = ['SL', 'AL', 'ALA', 'EL', 'ML', 'UL', 'CL', 'PH', 'TRN'];
const rtDates = w => Array.from({ length: 7 }, (_, d) => roAdd(w, d));
const rtName = k => (roStaff[k] || {}).name || k;
const _rtQ = s => JSON.stringify(s).replace(/"/g, '&quot;');

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
  const g = (x && x.note && Object.keys(I.groups).find(gg => rbShort(gg).toLowerCase() === x.note.split(/\s+/)[0].toLowerCase())) || p.group;
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
  const who = ((G[group] || {}).who || {})[shift];
  return I.people.filter(p => !(skip || []).includes(p.key) && (p.group === group || (who ? who.includes(p.title || '') : false))).map(p => {
    const v = (cells[p.key] || {})[date] || '', pre = ((I.pre || {})[p.key] || {})[date];
    let r;
    if (pre === '—') return null;
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
function rtCoverOptions(I, cells, group, date, shift) {
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
    if (v && !rbParse(v) && rbKind(v) !== 'off') return;       // sick, on leave, training… written in the roster
    const mgr = /manager/i.test(p.title || '');
    const away = p.group !== group, label = away ? `${shift} - ${rbShort(group)}` : shift;
    const from = away ? ` from ${p.group}` : '';
    const extra = (mgr ? 40 : 0) + (away ? 10 : 0);
    if (rbKind(v) === 'off') {
      // works that day; their day off moves to a day with spare cover
      dates.forEach((e, i) => {
        if (i === d || e <= today || ((I.pre || {})[p.key] || {})[e]) return;   // a day off moves only to a day still to come
        const T = rbNorm((cells[p.key] || {})[e]); if (!T || rbParse(cells[p.key][e]).note) return;
        const c2 = _rtClone(cells); c2[p.key][date] = label; c2[p.key][e] = 'OFF';
        if (!fine(c2, [p.key])) return;
        const cov = rbCover(I, c2)[p.group]; const left = cov && cov[T] ? cov[T][i] : 1;
        if (need(p.group, T, i) > 0 && left < 1) return;           // never empties another shift
        opts.push({ kind: 'offmove', key: p.key, cost: 10 + extra + (left < need(p.group, T, i) ? 15 : 0), cells: c2, ok: rtWhyOk(I, c2, p, date, label) + (left < need(p.group, T, i) ? ` · ${T} on ${roDayLbl(e)} drops to ${left}` : ''), text: `Put ${rtName(p.key)}${from} on ${shift}${mgr ? ' (manager)' : ''}: their day off moves to ${roDayLbl(e)}` });
      });
    } else if (rbParse(v) && !rbParse(v).note) {
      const T = rbNorm(v);
      if (T === shift && !away) return;
      const c2 = _rtClone(cells); c2[p.key][date] = label;
      if (!fine(c2, [p.key])) return;
      const cov = rbCover(I, c2)[p.group]; const left = cov && cov[T] ? cov[T][d] : 1;
      if (need(p.group, T, d) > 0 && left < 1) return;
      const spare = left >= need(p.group, T, d);
      opts.push({ kind: away ? 'borrow' : 'move', key: p.key, cost: (away && T === shift ? 12 : 15) + extra + (spare ? 0 : 20), cells: c2,
        ok: rtWhyOk(I, c2, p, date, label) + (spare ? ` · their ${T} still has ${left}` : ` · their ${T} drops to ${left}`),
        text: away ? `Borrow ${rtName(p.key)} from ${p.group} for ${shift}${T === shift ? ' (same shift)' : ' (instead of ' + T + ')'}`
                   : `Put ${rtName(p.key)} on ${shift}${mgr ? ' (manager)' : ''} instead of ${T}` });
    }
  });
  // two-day fixes: they take the gap, a day next to it becomes their day off, and they work their old day off instead
  if (Object.keys(opts.reduce((m, o) => (m[o.key] = 1, m), {})).length < 3) I.people.forEach(p => {
    if (((I.pre || {})[p.key] || {})[date] || opts.some(o => o.key === p.key)) return;
    const away = p.group !== group, label = away ? `${shift} - ${rbShort(group)}` : shift, mgr = /^(manager|asst\. manager)$/i.test(p.title || '');
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
    if (opts.some(o => o.key === p.key)) return;
    const pre = (I.pre || {})[p.key] || {}, row = cells[p.key] || {}, v = row[date] || '';
    if (pre[date] || (v && !rbParse(v) && rbKind(v) !== 'off') || (rbParse(v) && rbParse(v).note)) return;
    if (!rbMayWork(I, group, p, shift) || (p.allowed && p.allowed.length && !p.allowed.includes(shift))) return;
    const away = p.group !== group, label = away ? `${shift} - ${rbShort(group)}` : shift;
    const c2 = _rtClone(cells), r2 = c2[p.key];
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
  const best = {}; opts.forEach(o => { if (!best[o.key] || best[o.key].cost > o.cost) best[o.key] = o; });
  const list = Object.values(best).sort((a, b) => a.cost - b.cost).slice(0, 6);
  const who = ((G[group] || {}).who || {})[shift];
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
    if (q.key === key || q.group !== me.group || pre(q.key, date)) return;
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
    if (rbDrafts[w]) { rtDates(w).forEach(dt => { if (dt >= from && dt <= to) { rbDrafts[w].cells[k] = rbDrafts[w].cells[k] || {}; rbDrafts[w].cells[k][dt] = code; } }); fbSet('roster/builder/drafts/' + w, rbDrafts[w]); }
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
  return `<div class="rt-team-acts"><button class="btn sm gold" onclick="rtAddStaff()">＋ Add staff</button><button class="btn sm" onclick="rtSickDialog()">🤒 Sick / leave</button><label class="btn sm">📥 Team file<input type="file" accept=".json,application/json" hidden onchange="rtImportTeamFile(this)"></label><small>Tap a name for titles, shift, leave and history.</small></div>
  ${shown.map(g => `<div class="rb-sub">${escapeHtml(g || 'Team')}</div><div class="rt-list">${Object.keys(roStaff).filter(k => ((roStaff[k] || {}).group || '') === g && !((rbPeople[k] || {}).deleted)).sort((a, b) => (roStaff[a].order ?? 999) - (roStaff[b].order ?? 999) || roStaff[a].name.localeCompare(roStaff[b].name)).map(k => {
    const c = rbPeople[k] || {}, p = rbPersonCfg(k), ph = rbPhOwed(k), today = roToday();
    const away = Object.values(c.absences || {}).find(a => a.to >= today);
    const left = c.left && c.left <= roAdd(rbWeek, 6);
    return `<button class="rt-row${left ? ' gone' : ''}" onclick="rtPerson(${_rtQ(k)})">
      <span class="rt-n"><b>${escapeHtml(roStaff[k].name)}</b>${c.title ? `<i class="rt-title ${/manager/i.test(c.title) ? 'mgr' : /supervisor|leader/i.test(c.title) ? 'sup' : ''}">${escapeHtml(c.title)}</i>` : ''}</span>
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
    <div class="rt-cant"><span>Works:</span><button class="rb-opt ro-t-night" onclick="rtOnly(${q},'night')">🌙 Nights only</button><button class="rb-opt ro-t-morning" onclick="rtOnly(${q},'day')">☀️ Days only</button><button class="rb-opt" onclick="rtOnly(${q},'all')">All shifts</button></div>
    <div class="rt-cant"><span>Can't work:</span>${shifts.map(x => { const no = (c.allowed && c.allowed.length && !c.allowed.includes(x)); return `<button class="rb-opt ro-t-${(roInfo(x) || {}).type}${no ? ' on' : ''}" onclick="rtToggleCant(${q},${_rtQ(x)})">${no ? '🚫 ' : ''}${escapeHtml(x)}</button>`; }).join('')}</div>
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
function rtFind(text) {
  const t = String(text || '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const staff = Object.keys(roStaff).map(k => ({ k, n: rtName(k).toLowerCase() }));
  let hit = staff.filter(s => s.n === t || t.includes(s.n));
  if (hit.length === 1) return hit[0].k;
  const words = t.split(' ').filter(w => w.length > 1 && !/^(mr|ms|mrs|the|is|on|for)$/.test(w));
  hit = staff.filter(s => words.length && words.every(w => s.n.split(' ').some(x => x.startsWith(w))));
  if (hit.length === 1) return hit[0].k;
  if (hit.length > 1) return hit.map(h => h.k);
  return null;
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
  return `<div class="rt-opts">${opts.map(o => { if (!o.cells) return `<div class="rb-prob short">${escapeHtml(o.text)}</div>`; const id = 'o' + Math.random().toString(36).slice(2, 8); _rtPending[id] = { week, cells: o.cells }; return `<button class="btn sm" onclick="rtApplyPending('${id}')">✓ ${escapeHtml(o.text)}${o.ok ? `<small class="rb-ok">OK: ${escapeHtml(o.ok)}</small>` : ''}</button>`; }).join('')}</div>`;
}
function rtApplyPending(id) {
  const o = _rtPending[id]; if (!o) return;
  if (!roCanEdit()) { showToast('Only supervisors, managers and owners can change the roster', 'err'); return; }
  if (rtIsPublished(o.week)) { const n = rtApplyPublished(o.week, o.cells, 'cover'); showToast(`${n} change${n === 1 ? '' : 's'} made; the people concerned are told`, 'ok'); }
  else { rbDrafts[o.week] = Object.assign({}, rbDrafts[o.week], { cells: o.cells, at: Date.now() }); fbSet('roster/builder/drafts/' + o.week, rbDrafts[o.week]); showToast('Changed in the draft', 'ok'); }
  _rtPending = {};
  if (typeof brClose === 'function') brClose();
}
const RT_COMMANDS = [
  { re: /^(.+?)\s+(?:is\s+|got\s+|called\s+|has\s+)?(sick|on sick leave|off sick|absent|not coming|can'?t come|cannot come|on leave|on vacation|on annual leave)\b(.*)$/i, ex: 'Saad is sick tomorrow', does: 'marks it and finds cover', run: q => {
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
  { re: /^(.+?)\s+(?:wants|asks for|asked for|needs|requests?|would like)\s+(?:a\s+|the\s+)?(?:day\s+)?off\b(.*)$|^(.+?)\s+(?:wants|asks|asked|needs)\s+(\w+day|tomorrow)\s+off$/i, ex: 'Ali wants Friday off', does: 'a day-off request, or swaps if the week is posted', run: q => {
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
  { re: /^swap\s+(.+?)\s+(?:and|with|&)\s+(.+?)(?:\s+(?:on|for)\s+(.+))?$/i, ex: 'swap Hassan and Turab on Tue', does: 'swaps their shifts if the rules allow', run: q => {
      const m = q.match(/^swap\s+(.+?)\s+(?:and|with|&)\s+(.+?)(?:\s+(?:on|for)\s+(.+))?$/i);
      const a = rtFind(m[1]), b = rtFind(m[2]), day = rtDay(m[3] || 'today');
      if (!a || !b || Array.isArray(a) || Array.isArray(b)) { _rtOut('<div class="br-title">I couldn\'t tell who. Use their names as on the roster.</div>'); return true; }
      const w = roMonday(roDate(day)), I = rtCtx(w), cells = rtIsPublished(w) ? rtPublished(w) : (rbDrafts[w] || {}).cells || {};
      const o = rtSwapOptions(I, cells, a, day).find(x => x.text.includes(rtName(b)));
      _rtOut(o ? `<div class="br-kind">🔁 Swap</div><div class="br-title">${escapeHtml(roDayLbl(day, true))}</div>${rtOptButtons(w, [o])}` : `<div class="br-title">That swap would break a rule (rest, 9 hours or cover) on ${escapeHtml(roDayLbl(day))}.</div>`);
      return true; } },
  { re: /^who\s+can\s+(?:cover|work|do|take|fill)\s+(.+?)(?:\s+(?:on|for)\s+(\w[\w\s]*))?\??$/i, ex: 'who can cover nights on Wed', does: 'the best people to fill a shift', run: q => {
      const m = q.match(/^who\s+can\s+(?:cover|work|do|take|fill)\s+(.+?)(?:\s+(?:on|for)\s+(\w[\w\s]*))?\??$/i);
      const g = rbGroups().find(x => x && new RegExp('\\b' + rbShort(x), 'i').test(q)) || (roStaff[roMeKey] || {}).group || rbGroups()[0];
      const s = rtShiftIn(m[1], g), day = rtDay(m[2] || 'today');
      if (!s || !day) { _rtOut(`<div class="br-title">Which shift? ${rbGroupCfg(g).shifts.map(escapeHtml).join(', ')}</div>`); return true; }
      const w = roMonday(roDate(day)), I = rtCtx(w), cells = rtIsPublished(w) ? rtPublished(w) : (rbDrafts[w] || {}).cells || {};
      const opts = rtCoverOptions(I, cells, g, day, s);
      _rtOut(`<div class="br-kind">🗓️ ${escapeHtml(g)}</div><div class="br-title">${escapeHtml(s)} on ${escapeHtml(roDayLbl(day, true))}</div>${rtOptButtons(w, opts.slice(0, 5))}`);
      return true; } },
  { re: /(roster|staff(ing)?|cover)\s+(problems?|gaps?|issues?|short(ages?)?)|short\s+(of\s+)?staff|understaffed|staff shortage/i, ex: 'roster problems', does: 'gaps this week and next, with fixes', run: () => {
      const out = [roMonday(new Date()), roAdd(roMonday(new Date()), 7)].map(w => {
        const cells = rtIsPublished(w) ? rtPublished(w) : (rbDrafts[w] || {}).cells; if (!cells) return `<div class="br-body"><b>${escapeHtml(rbWeekLabel(w))}</b>: not built yet.</div>`;
        const I = rtCtx(w), adv = rtAdvice(I, cells).filter(a => a.date >= roToday());
        return `<div class="br-body"><b>${escapeHtml(rbWeekLabel(w))}</b>: ${adv.length ? adv.length + ' gap' + (adv.length === 1 ? '' : 's') : 'every shift covered'}</div>${adv.slice(0, 3).map(a => `<div class="br-body">${escapeHtml(roDayLbl(a.date))} · ${escapeHtml(a.shift)} · ${escapeHtml(a.group)}: ${a.have}/${a.need}</div>${rtOptButtons(w, a.options.slice(0, 2))}`).join('')}`;
      }).join('');
      _rtOut(`<div class="br-kind">🗓️ Roster</div><div class="br-title">Cover</div>${out}`); return true; } },
  { re: /^(?:when|what)\s+(?:did|does|is)\s+(.+?)\s+work(?:ing|ed)?\b.*$|^(.+?)(?:'s)?\s+(?:history|shifts?\s+last\s+week|last\s+week|last\s+month)$/i, ex: 'Manisha last week', does: 'what someone worked lately', run: q => {
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
    ['someone sick call in sick sick leave vacation absent cover roster', 'Someone is sick', 'Roster → 🤒 Sick / leave (or tell me "Saad is sick tomorrow"). It goes into the posted roster, and I show who can cover: someone whose day off moves, someone moved from a shift with spare, someone borrowed from another hotel, a manager as the last resort, or "bring in a staff member".'],
    ['change roster mid week edit posted roster adjust this week', 'Changing the posted roster', 'Roster → ✏️ Change this week, or in the builder ✏️ Edit this week. Change cells, drag to swap, apply a fix, then 📤 Publish: only the people whose shifts changed are told.'],
    ['swap shift change timing staff asks change shift', 'Someone asks to change their shift', 'Tap their cell in the builder: 🔁 shows only swaps that keep everyone\'s rest and cover. Or ask me "swap Hassan and Turab on Tue" or "Ali wants Friday off".'],
    ['add staff new staff delete staff left terminated resigned title manager supervisor', 'Team: add, remove, titles', 'Builder → 🧑‍💼 Team: ＋ Add staff, or tap a name for title, hotel, static or rotating shift, days off, can\'t-work shifts, sick and leave dates, "left on" date, delete, and their history.'],
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

// ═══════════════════════════════════════════════════════════
//  roster-rules.js — ⚖️ the roster rules, in plain words, yours to change
//  • every rule with a real example from your roster, and how much it counts:
//    Off · Nice · Important · Very important · Must (the builder follows it)
//  • quick questions ("which is worse?") that set the levels for you
//  • your own rules: "Sam and Lina never on the same shift", "Rita always with
//    Lina", "Trainees never on nights", by tapping or by telling Ops Brain
//  • 💡 suggestions from the brain, from what this week's draft shows
//  Stored in rbSettings.rules.levels { id: 0-4 } and rbSettings.rules.custom [ ]
// ═══════════════════════════════════════════════════════════

const RR_LV = [['Off', 'off'], ['Nice', 'nice'], ['Important', 'imp'], ['Very important', 'very'], ['Must', 'must']];
/** The rules the builder weighs (soft): id → icon, title, what it means. */
const RR_SOFT = [
  ['care', '💚', 'Extra care for anyone close to breaking', 'Team Health under 70: fewer nights, their wishes first, days off together, one steady shift.'],
  ['alone', '👥', 'Nobody alone the whole shift', 'Two on a shift when there are enough people. Alone is fine with company for a few hours.'],
  ['home', '🏨', 'Staff stay in their own hotel', 'Moved only when there is no other way, one day at a time, never all three hotels.'],
  ['steady', '🧘', 'The same shift all week', 'Hours change only after a day off.'],
  ['meet', '📅', 'Meetings and training', 'Free for their meeting or training, and not on their day off.'],
  ['senior', '🎖', 'A Duty Manager and a Supervisor not together', 'One senior on a shift is enough; spread them out.'],
  ['mgr', '👔', 'A manager on duty every day', 'Across the three hotels.'],
  ['nm', '🌅', 'Back from nights on a later shift', 'Night → day off → morning is avoided (that day off goes on sleep). At the end the builder trades so the first shift back starts 12:00 or later, without changing the cover.'],
  ['preferNot', '⚠', '"Prefer not" shifts', 'Kept off the shifts they prefer not to do.'],
  ['wishes', '💛', 'Wishes', 'Liked shifts, days off they asked for, nights they want at most. More weight for whoever missed out lately.'],
  ['together', '🛋', 'Days off together', 'For people who asked for their days off next to each other.'],
  ['desk', '🖥', 'Two on the desk at once', 'In the desk hours, as the aim in the numbers below.'],
  ['fair', '⚖️', 'Fair nights and weekends', 'Shared over the last 4 weeks: whoever had more nights or fewer weekends gets the lighter side.'],
];

function rrLevels() { return Object.assign({}, (rbRules().levels) || {}); }
function rrLevel(id) { const L = rrLevels()[id]; return L == null || isNaN(+L) ? RB_RULE_DEF[id] : +L; }
function rrSetLevel(id, lv) {
  const L = rrLevels(); if (+lv === RB_RULE_DEF[id]) delete L[id]; else L[id] = +lv;
  rbSetRule('levels', L); rrRefresh();
  const t = RR_SOFT.find(r => r[0] === id); if (t && typeof showToast === 'function') showToast(`${t[1]} ${t[2]}: ${RR_LV[lv][0]}`, 'ok');
}
function rrCustom() { return ((rbRules().custom) || []).filter(Boolean); }
function rrSetCustom(list) { rbSetRule('custom', list); rrRefresh(); }

// ── Real examples from your roster ────────────────────────
const _rrFirst = k => ((roStaff[k] || {}).name || k).split(' ')[0];
const _rrHH = sh => { const x = rbParse(sh); return x ? x.from.replace(':00', '') + '–' + x.to.replace(':00', '') : sh; };
/** Two people at the same hotel, one day, whose shifts overlap for a few hours (like 12–21 and 19–04). */
function rrOverlapExample() {
  const today = roToday(), days = Object.keys(roDays).filter(dt => dt <= roAdd(today, 7) && dt >= roAdd(today, -21)).sort().reverse();
  const need = rbRules().overlapMin == null ? 2 : +rbRules().overlapMin;
  for (const dt of days) {
    const day = roDays[dt] || {}, ks = Object.keys(day).filter(k => roStaff[k] && rbParse(day[k]));
    for (const a of ks) for (const b of ks) {
      if (a >= b || rbBaseGroup(roStaff[a].group || '') !== rbBaseGroup(roStaff[b].group || '')) continue;
      const x = rbParse(day[a]), y = rbParse(day[b]); if (rbNorm(day[a]) === rbNorm(day[b])) continue;
      const [p, q] = x.s <= y.s ? [x, y] : [y, x], [pk, qk] = x.s <= y.s ? [a, b] : [b, a];
      const h = (Math.min(p.e, q.e) - q.s) / 60;
      if (h >= Math.max(1, need) && h <= 4) return `${_rrFirst(pk)} works ${_rrHH(day[pk])} and ${_rrFirst(qk)} comes at ${q.from.replace(':00', '')} (${_rrHH(day[qk])}): ${h} h together, so one can take a break. Fine.`;
    }
  }
  return 'Like 12–21 and 19–04: 2 h together (19:00–21:00), so one can take a break. Fine.';
}
function rrSomeone(pred) { const ks = Object.keys(roStaff).filter(k => !(rbPeople[k] || {}).deleted && (!pred || pred(k))); return ks.length ? ks[(new Date().getDate()) % ks.length] : null; }
function rrShiftsOf(k) { try { return rbGroupCfg((roStaff[k] || {}).group || '').shifts || []; } catch (_) { return []; } }
/** One line, with names and hours from your team, for each rule. */
function rrExample(id) {
  const k = rrSomeone(), n = k ? _rrFirst(k) : 'Sam', S = k ? rrShiftsOf(k).filter(s => !rbIsNight(s)) : [];
  const early = S[0] || '07:00 - 15:00', late = S[S.length - 1] || '15:00 - 23:00', night = (k ? rrShiftsOf(k) : []).find(rbIsNight) || '23:00 - 07:00';
  const other = Object.keys(roStaff).find(x => x !== k && !(rbPeople[x] || {}).deleted), o = other ? _rrFirst(other) : 'Lina';
  const R = rbRules();
  return ({
    reception: `If ${n} calls in sick and nobody fits every rule, someone still covers the desk (and it's written under Decisions).`,
    rest: `${n} finishes ${_rrHH(late).split('–')[1]}:00 → next shift at least ${R.minRest} h later.`,
    nightday: `${n} on ${_rrHH(night)} on Monday can't do ${_rrHH(early)} on Tuesday without a day off.`,
    back: (() => { const D = (k ? rrShiftsOf(k) : []).filter(s => !rbIsNight(s)); let pr = null;   // a pair with enough rest, only the start is earlier (like 12–21 then 09–18)
      D.forEach(a => D.forEach(b => { const x = rbParse(a), y = rbParse(b); if (!pr && y.s <= x.s - 120 && rbRest(a, b) >= R.minRest) pr = [a, b]; }));
      const [a, b] = pr || ['12:00 - 21:00', '09:00 - 18:00'];
      return `${n} on ${_rrHH(a)} on Monday, then ${_rrHH(b)} on Tuesday: no, that's too hard without a day off. An hour earlier is fine.`; })(),
    hours: `No shift longer than ${R.maxHours} h.`,
    nightwho: `00:00–09:00 is for Supervisors and Duty Managers; a Team Leader only if none can, and anyone else only to keep the desk covered.`,
    run: `At most ${R.maxRun} working days in a row.`,
    offs: `${n} gets their days off every week (normally 1, 4 a month).`,
    care: `If ${n}'s health ring drops under 70, their next week gets fewer nights and their wishes first.`,
    alone: rrOverlapExample(),
    home: `${o} works at their own hotel; sent to another only if a shift there would be empty, for that one day.`,
    steady: `${n} stays on ${_rrHH(early)} all week instead of switching to ${_rrHH(late)} on Wednesday.`,
    meet: `${n} has training on Tuesday at 10:00: not on nights that week, and Tuesday isn't their day off.`,
    senior: `A Duty Manager and a Supervisor on the same shift: one moves to another shift.`,
    mgr: `Every day at least one manager is on duty somewhere.`,
    nm: `${n} works a night, has one day off, then a morning: avoided.`,
    preferNot: `${n} prefers not ${_rrHH(late)}: only if there's no other way.`,
    wishes: `${n} asked for Friday off: granted when it fits the rules above.`,
    together: `${n}'s two days off on Saturday and Sunday, not Tuesday and Friday.`,
    desk: `From ${R.deskFrom}:00 to ${R.deskTo}:00, two people on the desk at once when it can be done.`,
    fair: `${n} had 5 nights last month and ${o} had 1: ${o} gets the next nights.`,
  })[id] || '';
}

// ── Screens ───────────────────────────────────────────────
function rrLevelCtl(id, lv) {
  return `<div class="rr-lv" role="group" aria-label="How much it counts">${RR_LV.map(([t, c], i) => `<button type="button" class="rr-lvb ${c}${i === lv ? ' on' : ''}" onclick="rrSetLevel('${id}',${i})" title="${t}">${i === 0 ? 'Off' : t.split(' ')[0]}</button>`).join('')}</div>`;
}
function rrRuleRow(ico, title, ex, ctl, cls) {
  return `<div class="rr-rule ${cls || ''}"><span class="rr-ico">${ico}</span><div class="rr-txt"><b>${title}</b><small>${escapeHtml(ex)}</small></div>${ctl}</div>`;
}
function rrHtml() {
  const R = rbRules(), lv = {}; RR_SOFT.forEach(([id]) => { lv[id] = rrLevel(id); });
  const always = (on, set) => set ? `<label class="rr-sw"><input type="checkbox" ${on ? 'checked' : ''} onchange="${set};rrRefresh()"><i></i></label>` : '<span class="rr-must">Always</span>';
  const hard = [
    ['🛎', 'Reception is never empty', 'reception'],
    ['😴', `${R.minRest} h rest between shifts`, 'rest'],
    ['🌙', 'A day off between night and day', 'nightday', R.nightSwitch !== false, "rbSetRule('nightSwitch',this.checked)"],
    ['🌅', 'A day off before an earlier start', 'back', R.noBack !== false, "rbSetRule('noBack',this.checked)"],
    ['⏱', `No shift over ${R.maxHours} h`, 'hours'],
    ['🎖', 'Nights for Supervisors and Duty Managers', 'nightwho'],
    ['📆', `At most ${R.maxRun} days in a row`, 'run'],
    ['🛋', 'Days off every week', 'offs'],
  ];
  const groups = [4, 3, 2, 1, 0].map(L => ({ L, list: RR_SOFT.filter(([id]) => lv[id] === L) })).filter(g => g.list.length);
  const mine = rrCustom();
  return `<div class="rr-box" id="rrBox">
    <div class="rr-intro">Tell the builder what matters. Every rule has an example from your team; tap how much it counts. <b>Must</b> comes first, <b>Off</b> is ignored.</div>
    ${rrSuggestHtml()}
    ${rrCutHtml()}
    ${rrFreezeHtml()}
    ${groups.map(g => `<div class="rr-sec">${['⚪ Off', '🟢 Nice to have', '🟡 Important', '🟠 Very important', '🔴 Must'][g.L]}</div>
      <div class="rr-list">${g.list.map(([id, ico, t, what]) => rrRuleRow(ico, t, rrExample(id) || what, rrLevelCtl(id, lv[id]), 'lv' + g.L)).join('')}</div>`).join('')}
    <details class="rr-hard"><summary>🔒 Always: ${hard.length} rules that are the base of every roster <small>tap to see</small></summary>
      <div class="rr-list">${hard.map(([ico, t, id, on, set]) => rrRuleRow(ico, t, rrExample(id), always(on, set), 'hard' + (set && !on ? ' off' : ''))).join('')}</div></details>
    ${rrHabitsHtml()}
    <div class="rr-sec">✍️ Your own rules</div>
    <div class="rr-list">${mine.map((r, i) => rrRuleRow(r.t === 'apart' ? '↔️' : r.t === 'with' ? '🤝' : '🚫', escapeHtml(rrMineText(r)), rrMineLeft(r), `<div class="rr-mine-ctl">${rrMineLvCtl(i, r.level == null ? 2 : +r.level)}<button class="ro-x" title="Remove" onclick="rrDelMine(${i})">✕</button></div>`, 'mine')).join('') || '<div class="ro-empty">None yet. Make one below, or tell Ops Brain: "Sam and Lina never on the same shift".</div>'}</div>
    ${rrMakeHtml()}
    ${rrQuizHtml()}
  </div>`;
}
/** 🚫 Day-off freeze: from one date to another only the people picked may be off; everyone else works through
 *  and takes the day off after it. Managers keep their days off as usual. */
function _rrFzPeople() { const seen = new Set(); return rbGroups().flatMap(g => rbMembers(g)).filter(k => !seen.has(k) && seen.add(k) && roStaff[k] && !rbIsManager(k)).sort((a, b) => String(roStaff[a].name).localeCompare(roStaff[b].name)); }
function rrFreezeHtml() {
  const F = rbFreezes(rbRules()), nm = k => roStaff[k] ? String(roStaff[k].name).split(' ')[0] : k, today = roToday();
  const list = F.map((f, i) => `<div class="rr-fz${f.to < today ? ' past' : ''}"><div><b>🚫 ${escapeHtml(roDayLbl(f.from))} → ${escapeHtml(roDayLbl(f.to))}</b><small>${f.allow && f.allow.length ? `<b>${escapeHtml(f.allow.map(nm).join(', '))}</b> must take their day off inside these dates.` : 'Nobody is off.'} Everyone else works through and gets their day off after; managers as usual.${f.to < today ? ' (over)' : ''}</small></div><button class="btn sm ghost" onclick="rrFreezeDel(${i})" title="Remove">🗑</button></div>`).join('');
  return `<div class="rr-sec">🚫 Day-off freeze</div>
    <div class="rr-list">${list || '<div class="rr-fz-none">Busy dates? Pick who must take their day off in them; nobody else gets a day off until it ends.</div>'}
    <details class="rr-fz-add"${F.length ? '' : ' open'}><summary>➕ Add a day-off freeze</summary>
      <div class="rr-fz-dates"><label>From<input type="date" id="rrFzFrom" value="${today}"></label><label>To<input type="date" id="rrFzTo" value="${roAdd(today, 4)}"></label></div>
      <div class="rr-fz-lbl">Who must take their day off in these dates (managers are always as usual):</div>
      <div class="rr-fz-who">${_rrFzPeople().map(k => `<label><input type="checkbox" value="${escapeHtml(k)}"><span>${escapeHtml(nm(k))}</span></label>`).join('')}</div>
      <button class="btn sm gold" onclick="rrFreezeAdd()">Save the freeze</button>
    </details></div>`;
}
/** ✂️ HR cut-off: days off per half-month, counted from what each person already took. */
function rrCutHtml() {
  const R = rbRules(), C = rbCutCfg(R), raw = R.cutoff || {}, day = +raw.day || 15, per = raw.per != null ? +raw.per : 2;
  const head = `<div class="rr-sec">✂️ HR cut-off</div>
    <div class="rr-cut-top"><label class="rr-sw"><input type="checkbox" ${C ? 'checked' : ''} onchange="rrCutSet('on',this.checked)"><i></i></label>
      <span>Month cut on the <input type="number" min="1" max="27" value="${day}" onchange="rrCutSet('day',+this.value)" class="rr-cut-n"><b>th</b>: everyone takes
      <button class="rr-pm" onclick="rrCutSet('per',${Math.max(0, per - 1)})">−</button><b class="rr-cut-v">${per}</b><button class="rr-pm" onclick="rrCutSet('per',${per + 1})">+</button>
      days off before it and ${per} after.</span></div>`;
  if (!C) return head + '<div class="rr-fz-none">Off: days off are one a week as usual. Turn it on to count days off per half-month for HR.</div>';
  const W = rbWeek || rbDefaultWeek(), periods = [rbCutPeriod(W, C.day)], nx = rbCutPeriod(roAdd(periods[0].end, 1), C.day);
  if (nx.start <= roAdd(W, 6)) periods.push(nx);
  const ppl = _rrFzPeople().filter(k => !((rbPeople[k] || {}).staticOff || []).length), nm = k => String(roStaff[k].name).split(' ')[0];
  return head + periods.map(P => {
    // days of this half before the week being built that have no posted roster: days off taken then are unknown
    let missing = 0; for (let dt = P.start; dt <= P.end && dt < W; dt = roAdd(dt, 1)) if (!Object.keys(roDays[dt] || {}).length) missing++;
    const rows = ppl.map(k => { const q = rbCutQuota(C, P, k), t = rbCutTaken(k, P, W), left = Math.max(0, q - t);
      return `<div class="rr-cut-row${left ? '' : ' none'}"><span>${escapeHtml(nm(k))}</span><small>${t} taken</small><span class="rr-cut-q"><button class="rr-pm" onclick="rrCutAdj('${P.id}',${_rtQ(k)},${t + Math.max(0, left - 1)})">−</button><b>${left}</b><button class="rr-pm" onclick="rrCutAdj('${P.id}',${_rtQ(k)},${t + left + 1})">+</button></span><em>${left ? 'left' : 'none left'}</em></div>`; }).join('');
    return `<details class="rr-cut-p" open><summary>${escapeHtml(roDayLbl(P.start))} → ${escapeHtml(roDayLbl(P.end))} <small>days off still to take in this half · counted before ${escapeHtml(roDayLbl(W))}</small></summary>
      ${missing ? `<div class="rr-cut-warn">⚠️ No roster in the app for ${missing} day${missing === 1 ? '' : 's'} of this half (before ${escapeHtml(roDayLbl(W))}), so days off taken then are not counted. Set what each person has <b>left</b> below (or add that roster).</div>` : ''}
      <div class="rr-cut-quick">Everyone left: ${[0, 1, 2].map(n => `<button class="btn sm ghost" onclick="rrCutAllLeft('${P.id}',${n})">${n}</button>`).join('')}</div>
      <details class="rr-cut-ex"><summary>✅ Everyone took theirs, except…</summary>
        <div class="rr-fz-who" id="rrCx${P.id}">${ppl.map(k => `<label><input type="checkbox" value="${escapeHtml(k)}"><span>${escapeHtml(nm(k))}</span></label>`).join('')}</div>
        <button class="btn sm gold" onclick="rrCutExcept('${P.id}')">Save: only these still have a day off left</button></details>
      <div class="rr-cut-list">${rows}</div></details>`;
  }).join('') + '<small class="ro-hint">A must, every week: one day off a week (never two), in the half that still owes one, the half ending first first. None left: no day off until the cut-off. Managers and anyone with a 📌 fixed day off stay as they are.</small>';
}
function rrCutSet(k, v) { rbSetRule('cutoff', Object.assign({ day: 15, per: 2 }, rbRules().cutoff, { [k]: v })); rrRefresh(); }
function rrCutAdj(id, k, n) { const c = Object.assign({ day: 15, per: 2 }, rbRules().cutoff), adj = Object.assign({}, c.adj); adj[id] = Object.assign({}, adj[id], { [k]: n }); c.adj = adj; rbSetRule('cutoff', c); rrRefresh(); }
/** Everyone took their days off in this half, except the people picked (they have one left). */
function rbCutExcept(id, keys, n) {
  const c = Object.assign({ day: 15, per: 2 }, rbRules().cutoff, { on: true }), adj = Object.assign({}, c.adj), W = rbWeek || rbDefaultWeek();
  const P = rbCutPeriod(id.slice(-1) === 'A' ? id.slice(0, 7) + '-01' : id.slice(0, 7) + '-28', c.day || 15);
  adj[id] = {}; _rrFzPeople().forEach(k => { adj[id][k] = rbCutTaken(k, P, W) + (keys.includes(k) ? (n || 1) : 0); });
  c.adj = adj; rbSetRule('cutoff', c);
}
function rrCutExcept(id) {
  const keys = [...document.querySelectorAll(`#rrCx${CSS.escape(id)} input:checked`)].map(x => x.value);
  rbCutExcept(id, keys); rrRefresh();
  if (typeof showToast === 'function') showToast(`✂️ Only ${keys.length ? keys.map(k => String(roStaff[k].name).split(' ')[0]).join(', ') : 'nobody'} still ${keys.length === 1 ? 'has' : 'have'} a day off before the cut-off. Build the week again`, 'ok');
}
function rrCutAllLeft(id, n) { const c = Object.assign({ day: 15, per: 2 }, rbRules().cutoff), adj = Object.assign({}, c.adj), W = rbWeek || rbDefaultWeek(), P = rbCutPeriod(id.slice(-1) === 'A' ? id.slice(0, 7) + '-01' : id.slice(0, 7) + '-28', c.day || 15); adj[id] = {}; _rrFzPeople().forEach(k => { adj[id][k] = rbCutTaken(k, P, W) + n; }); c.adj = adj; rbSetRule('cutoff', c); rrRefresh(); }
function rrCutAll(id, n) { const c = Object.assign({ day: 15, per: 2 }, rbRules().cutoff), adj = Object.assign({}, c.adj); adj[id] = {}; _rrFzPeople().forEach(k => { adj[id][k] = n; }); c.adj = adj; rbSetRule('cutoff', c); rrRefresh(); }
function rrFreezeAdd() {
  const from = (document.getElementById('rrFzFrom') || {}).value, to = (document.getElementById('rrFzTo') || {}).value;
  if (!from || !to || to < from) { if (typeof showToast === 'function') showToast('Pick a start and an end date (the end on or after the start)', 'warn'); return; }
  const allow = [...document.querySelectorAll('.rr-fz-who input:checked')].map(x => x.value);
  rbSetRule('offFreeze', rbFreezes(rbRules()).concat([{ from, to, allow }]));
  rrRefresh();
  if (typeof showToast === 'function') showToast(`🚫 ${roDayLbl(from)} → ${roDayLbl(to)}: ${allow.length} take their day off in it, nobody else. Build the week to apply it`, 'ok');
}
function rrFreezeDel(i) { const F = rbFreezes(rbRules()).slice(); F.splice(i, 1); rbSetRule('offFreeze', F); rrRefresh(); }
function rrRefresh() {
  const el = document.getElementById('rrBox'); if (!el) return;
  const y = window.scrollY; el.outerHTML = rrHtml(); window.scrollTo(0, y);
}

/** 📋 What your managers do when there is no other way (from the posted rosters): the builder tries these first. */
function rrHabitsHtml() {
  if (typeof rbMgmtHabits !== 'function' || !rbWeek) return '';
  const H = rbMgmtHabits(rbWeek); if (!H.weeks) return '';
  const ex = (L, f) => L.slice(0, 2).map(f).join('; ');
  const day = d => roDayLbl(d);
  const rows = [
    [H.eveNight, '🌙', 'An evening straight into a night', x => `${x.who} ${x.from.slice(0, 5)} → ${x.to.slice(0, 5)} (${day(x.date)})`],
    [H.lend, '🏨', 'Borrowing someone from another hotel', x => `${x.who} ${x.shift.slice(0, 5)} at ${x.at} (${day(x.date)})`],
    [H.rest, '😴', 'Less rest between shifts', x => `${x.who} ${x.hours} h (${day(x.date)})`],
    [H.back, '🌅', 'An earlier start the next day', x => `${x.who} ${x.from.slice(0, 5)} → ${x.to.slice(0, 5)} (${day(x.date)})`],
    [H.b2b, '⏱', 'Back to back (very rare)', x => `${x.who} ${x.from.slice(0, 5)} → ${x.to.slice(0, 5)} (${day(x.date)})`],
  ].filter(r => r[0].length).sort((a, b) => b[0].length - a[0].length);
  if (!rows.length) return '';
  return `<details class="rr-hard"><summary>📋 What your managers do when there's no other way <small>learned from ${H.weeks} posted week${H.weeks === 1 ? '' : 's'} · tried first, most used first</small></summary>
    <div class="rr-list">${rows.map(([L, ico, t, f]) => rrRuleRow(ico, `${t} · ${L.length}×`, 'e.g. ' + ex(L, f), '', 'hard')).join('')}</div>
    <small class="ro-hint" style="display:block;padding:0 10px 10px">The builder keeps every rule when it can. When it can't, it bends one of these and says so under 📝 Decisions: who, which rule and why.</small></details>`;
}

// ── Your own rules ────────────────────────────────────────
const RR_BANDN = { night: 'nights', morning: 'mornings', evening: 'evenings', day: 'day shifts' };
function rrMineText(r) {
  if (r.t === 'apart') return `${_rrFirst(r.a)} and ${_rrFirst(r.b)} never on duty together`;
  if (r.t === 'with') return `${_rrFirst(r.a)} always on the same shift as ${_rrFirst(r.b)}`;
  if (r.t === 'titleNo') return `${r.title}s never on ${RR_BANDN[r.shift] || r.shift}`;
  return '';
}
/** Is it kept in this week's draft? */
function rrMineLeft(r) {
  try {
    const D = (typeof rbDrafts !== 'undefined' && rbDrafts[rbWeek]) || null; if (!D || !D.cells) return 'Checked on the next roster you build.';
    const I = rbInput(1), dates = Array.from({ length: 7 }, (_, d) => roAdd(rbWeek, d));
    const b = rbMineBroken(I, D.cells, dates, Object.assign({}, I.rules, { custom: [Object.assign({}, r, { level: 2 })] }));
    return b.length ? `⚠ Not kept on ${b.length} day${b.length === 1 ? '' : 's'} this week: ${b.slice(0, 3).map(x => roDayLbl(x.date)).join(', ')}` : '✓ Kept in this week\'s draft';
  } catch (_) { return ''; }
}
function rrMineLvCtl(i, lv) { return `<div class="rr-lv sm">${RR_LV.slice(1).map(([t, c], j) => `<button type="button" class="rr-lvb ${c}${j + 1 === lv ? ' on' : ''}" onclick="rrMineLv(${i},${j + 1})" title="${t}">${t.split(' ')[0]}</button>`).join('')}</div>`; }
function rrMineLv(i, lv) { const L = rrCustom(); if (!L[i]) return; L[i] = Object.assign({}, L[i], { level: lv }); rrSetCustom(L); }
function rrDelMine(i) { const L = rrCustom(); L.splice(i, 1); rrSetCustom(L); }
function rrAddMine(r) {
  if (!r) return false;
  const L = rrCustom(), same = x => x.t === r.t && ((x.a === r.a && x.b === r.b) || (x.a === r.b && x.b === r.a && r.t === 'apart') || (r.t === 'titleNo' && x.title === r.title && x.shift === r.shift));
  if (L.some(same)) { showToast('You already have that rule', 'warn'); return false; }
  L.push(Object.assign({ level: 3 }, r)); rrSetCustom(L);
  if (typeof tlLog === 'function') tlLog('note', { keys: [r.a, r.b].filter(Boolean), text: 'New rule: ' + rrMineText(r) });
  showToast('✍️ ' + rrMineText(r) + ' · Very important', 'ok');
  return true;
}
function rrMakeHtml() {
  const ks = Object.keys(roStaff).filter(k => !(rbPeople[k] || {}).deleted).sort((a, b) => (roStaff[a].name || '').localeCompare(roStaff[b].name || ''));
  const ppl = `<option value="">someone…</option>${ks.map(k => `<option value="${escapeHtml(k)}">${escapeHtml(roStaff[k].name)}</option>`).join('')}`;
  return `<div class="rr-make">
    <div class="rr-make-row"><select id="rrA">${ppl}</select><select id="rrT" onchange="document.getElementById('rrB').style.display=this.value==='never'?'none':'';document.getElementById('rrTi').style.display=this.value==='never'?'':'none'"><option value="apart">never on duty together with</option><option value="with">always on the same shift as</option><option value="never">— or: a title never on —</option></select><select id="rrB">${ppl}</select>
      <span id="rrTi" style="display:none"><select id="rrTitle">${RB_TITLES.map(t => `<option>${t}</option>`).join('')}</select><select id="rrSh">${Object.keys(RR_BANDN).map(b => `<option value="${b}">${RR_BANDN[b]}</option>`).join('')}</select></span>
      <button class="btn sm gold" onclick="rrMakeAdd()">＋ Add rule</button></div>
    <small class="ro-hint">New rules start as Very important; tap another level any time.</small></div>`;
}
function rrMakeAdd() {
  const t = document.getElementById('rrT').value;
  if (t === 'never') { rrAddMine({ t: 'titleNo', title: document.getElementById('rrTitle').value, shift: document.getElementById('rrSh').value }); return; }
  const a = document.getElementById('rrA').value, b = document.getElementById('rrB').value;
  if (!a || !b || a === b) { showToast('Pick two different people', 'warn'); return; }
  rrAddMine({ t, a, b });
}

/** In the draft: your own rules this week doesn't keep (with the days). */
function rrMineDraftHtml(I, cells, dates) {
  const L = rrCustom(); if (!L.length) return '';
  const B = []; L.forEach(r => { const b = rbMineBroken(I, cells, dates, Object.assign({}, I.rules, { custom: [Object.assign({}, r, { level: 2 })] })); if (b.length) B.push([r, b]); });
  if (!B.length) return `<div class="rr-draft ok">✍️ Your ${L.length} own rule${L.length === 1 ? ' is' : 's are'} kept this week.</div>`;
  return `<div class="rr-draft">${B.map(([r, b]) => `<div>✍️ <b>${escapeHtml(rrMineText(r))}</b>: not kept on ${b.map(x => escapeHtml(roDayLbl(x.date))).join(', ')}${(r.level == null ? 2 : +r.level) < 4 ? ' (no other way with the higher rules; make it a Must in ⚖️ Rules to put it first)' : ''}</div>`).join('')}</div>`;
}

// ── Quick questions: which is worse? ──────────────────────
const RR_QUIZ = [
  ['alone', 'Someone alone the whole shift', 'home', 'Moving someone to another hotel'],
  ['steady', 'Changing someone\'s hours mid-week', 'wishes', 'Not granting a wish'],
  ['senior', 'A Duty Manager and a Supervisor together', 'mgr', 'A day with no manager'],
  ['fair', 'Someone getting more nights than the rest', 'wishes', 'Not granting a liked shift'],
  ['care', 'A tired person getting a hard week', 'fair', 'Nights not shared equally this week'],
  ['nm', 'Night → one day off → morning', 'steady', 'A change of hours after a day off'],
];
function rrQuizHtml() {
  return `<details class="rr-quiz"><summary>❓ Quick questions: which is worse? <small>tap one: it sets the levels for you</small></summary>
    ${RR_QUIZ.map(([a, ta, b, tb], i) => { const la = rrLevel(a), lb = rrLevel(b); return `<div class="rr-q"><button class="rr-qa${la > lb ? ' on' : ''}" onclick="rrQuiz(${i},0)">${escapeHtml(ta)}</button><span>or</span><button class="rr-qa${lb > la ? ' on' : ''}" onclick="rrQuiz(${i},1)">${escapeHtml(tb)}</button></div>`; }).join('')}
  </details>`;
}
function rrQuiz(i, pick) {
  const q = RR_QUIZ[i], win = pick ? q[2] : q[0], lose = pick ? q[0] : q[2];
  const L = rrLevels(), lw = rrLevel(win), ll = rrLevel(lose);
  if (lw <= ll) { if (ll < 4) L[win] = ll + 1; else L[lose] = 3; }
  [win, lose].forEach(id => { if (L[id] != null && +L[id] === RB_RULE_DEF[id]) delete L[id]; });
  rbSetRule('levels', L); rrRefresh();
  showToast('Got it: ' + (pick ? q[3] : q[1]).toLowerCase() + ' is worse', 'ok');
}

// ── 💡 Suggestions from the brain ─────────────────────────
function rrSuggest() {
  const out = [];
  try {
    const D = (typeof rbDrafts !== 'undefined' && rbDrafts[rbWeek]) || null;
    const I = rbInput(1), dates = Array.from({ length: 7 }, (_, d) => roAdd(rbWeek, d));
    if (D && D.cells) {
      const cells = D.cells;
      // wishes rarely granted
      const H = typeof rbHappyHtml === 'function' ? rbHappyHtml(I, cells, rbGroups(), dates) : null, m = H && String(H.sum).match(/(\d+) of (\d+)/);
      if (m && +m[2] >= 6 && +m[1] / +m[2] < 0.45 && rrLevel('wishes') < 2) out.push({ id: 'wishes', text: `Only ${m[1]} of ${m[2]} wishes are granted this week.`, act: 'Make wishes Important', fn: () => rrSetLevel('wishes', 2) });
      // many days at another hotel
      let moved = 0; I.people.forEach(p => dates.forEach(dt => { const x = rbParse((cells[p.key] || {})[dt]); if (x && x.note && rbBaseGroup(rbAt(I, p, x)) !== rbBaseGroup(p.group)) moved++; }));
      if (moved >= 3 && rrLevel('home') < 3) out.push({ id: 'home', text: `${moved} days at another hotel in this draft.`, act: 'Staying home: Very important', fn: () => rrSetLevel('home', 3) });
      // your own rules not kept
      rrCustom().forEach((r, i) => { const b = rbMineBroken(I, cells, dates, Object.assign({}, I.rules, { custom: [r] })); if (b.length && (r.level == null ? 2 : +r.level) < 4) out.push({ id: 'mine' + i, text: `Your rule "${rrMineText(r)}" isn't kept on ${b.length} day${b.length === 1 ? '' : 's'}.`, act: 'Make it a Must', fn: () => rrMineLv(i, 4) }); });
      // night → off → morning
      const nm = I.people.reduce((t, p) => t + rbNightToMorning(cells, p, dates).length, 0);
      if (nm >= 2 && rrLevel('nm') < 2) out.push({ id: 'nm', text: `${nm} times night → one day off → morning this week.`, act: 'Make it Important', fn: () => rrSetLevel('nm', 2) });
    }
    // someone close to breaking while extra care is off
    if (typeof rhAll === 'function' && rrLevel('care') === 0) { const H = rhAll(), low = Object.values(H).filter(h => !h.none && h.score < 60); if (low.length) out.push({ id: 'care', text: `${low.map(h => _rrFirst(h.k)).slice(0, 3).join(', ')} ${low.length === 1 ? 'is' : 'are'} under 60 on Team Health.`, act: 'Turn extra care on', fn: () => rrSetLevel('care', 2) }); }
  } catch (e) { console.warn('rules suggestions', e); }
  return out.filter(s => !(_rrNo[s.id]));
}
const _rrNo = {};
let _rrSug = [], _rrSugC = null;
/** Worked out again only when the draft, the rules or the roster change (Ops Brain asks every 20 s). */
function rrSuggestCached() {
  const D = (typeof rbDrafts !== 'undefined' && rbDrafts[rbWeek]) || {};
  const key = [rbWeek, D.at || '', JSON.stringify(rbSettings.rules || {}), typeof _rbLearnStamp === 'function' ? _rbLearnStamp() : '', Object.keys(_rrNo).join()].join('|');
  if (!_rrSugC || _rrSugC.key !== key) _rrSugC = { key, out: rrSuggest() };
  return _rrSugC.out;
}
function rrSuggestHtml() {
  _rrSug = rrSuggestCached(); if (!_rrSug.length) return '';
  return `<div class="rr-sug">${_rrSug.map((s, i) => `<div class="rr-sug-row"><span>💡</span><div>${escapeHtml(s.text)}</div><button class="btn sm gold" onclick="_rrSug[${i}].fn()">${escapeHtml(s.act)}</button><button class="ro-x" title="Not now" onclick="_rrNo['${s.id}']=1;rrRefresh()">✕</button></div>`).join('')}</div>`;
}

// ── Ops Brain: say a rule in your own words ───────────────
const RR_SAY = [
  [/^(?:avoid|keep|separate)\s+(.+?)\s+(?:and|from|with|away from)\s+(.+?)(?:\s+apart)?(?:\s+(?:on the same shift|together|at the same time))?\s*\.?$/i, 'apart'],
  [/^(.+?)\s+and\s+(.+?)\s+(?:should\s+)?(?:never|not|can'?t|cannot)\s+(?:be\s+|work\s+)?together\s*\.?$/i, 'apart'],
  [/^(.+?)\s+(?:should\s+)?(?:never|not|can'?t|cannot|shouldn'?t|mustn'?t)\s+(?:work|be)\s+(?:on duty\s+)?with\s+(.+?)\s*\.?$/i, 'apart'],
  [/^(.+?)\s+and\s+(.+?)\s+(?:should\s+)?(?:never|not|can'?t|cannot|must not|mustn'?t)\s+(?:be\s+|work\s+)?(?:on\s+|in\s+)?(?:the\s+)?same\s+shift\s*\.?$/i, 'apart'],
  [/^(.+?)\s+(?:always\s+(?:works?\s+)?(?:with|together with|on the same shift as)|(?:works?\s+)?on the same shift as)\s+(.+?)(?:\s+always)?\s*\.?$/i, 'with'],
  [/^(.+?)\s+and\s+(.+?)\s+(?:always\s+)?(?:on|in)\s+(?:the\s+)?same\s+shift(?:\s+always)?\s*\.?$/i, 'with'],
  [/^(?:all\s+|the\s+)?(.+?)s?\s+(?:never|not|can'?t|cannot)\s+(?:do\s+|work\s+)?(?:on\s+)?(nights?|mornings?|evenings?|days?|day shifts?)\s*\.?$/i, 'titleNo'],
];
function rrParseSay(q) {
  q = String(q || '').trim();
  for (const [re, t] of RR_SAY) {
    const m = q.match(re); if (!m) continue;
    if (t === 'titleNo') {
      const T = typeof rtTitleWord === 'function' ? rtTitleWord(m[1]) : null; if (!T) continue;
      const b = m[2].toLowerCase().replace(/s$/, '').replace(' shift', ''); return { t, title: T, shift: b === 'day' ? 'day' : b };
    }
    if (typeof rtFind !== 'function') continue;
    const a = rtFind(m[1]), b = rtFind(m[2]); if (!a || !b || Array.isArray(a) || Array.isArray(b) || a === b) continue;
    return { t, a, b };
  }
  return null;
}
if (typeof RT_COMMANDS !== 'undefined') RT_COMMANDS.unshift({ re: { test: q => !!rrParseSay(q), source: RR_SAY[0][0].source }, ex: 'Sam and Lina never on the same shift', does: 'adds your own roster rule', run: q => {
  const r = rrParseSay(q); if (!r) return false;
  if (!roCanEdit()) { _rtOut('<div class="br-title">Only supervisors, managers and owners can change the rules.</div>'); return true; }
  const ok = rrAddMine(r);
  _rtOut(`<div class="br-kind">⚖️ Rules</div><div class="br-title">${ok ? '✍️ ' : ''}${escapeHtml(rrMineText(r))}</div><div class="br-body">${ok ? 'Saved as Very important. The builder follows it from the next roster you build.' : 'You already have that rule.'}</div><div class="br-acts"><button class="btn sm" onclick="brClose&&brClose();rbSecState.rules=true;showPanel('roster-build')">See all rules</button></div>`);
  return true;
} });

document.addEventListener('DOMContentLoaded', () => {
  (window.BL_THINKERS = window.BL_THINKERS || []).push(add => {
    if (typeof roCanEdit !== 'function' || !roCanEdit() || !Object.keys(roStaff || {}).length || typeof rbWeek === 'undefined' || !rbWeek) return;
    const S = rrSuggestCached(); if (!S.length) return;
    add({ id: 'rulesSug:' + rbWeek + ':' + S.map(s => s.id).join(','), type: 'roster', icon: '💡', tone: 'idle', silent: true, text: `Rules: ${S[0].text} ${S[0].act}?`, why: 'A suggestion from this week\'s draft. Every rule and its level is in ⚖️ Rules.', acts: [[S[0].act, () => S[0].fn()], ['See rules', () => { rbSecState.rules = true; showPanel('roster-build'); }]] });
  });
});

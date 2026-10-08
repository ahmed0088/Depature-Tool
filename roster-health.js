// ═══════════════════════════════════════════════════════════
//  roster-health.js — how each team member is doing, from the roster
//  Reads the posted roster for the last 4 weeks (to the end of this
//  week) and scores 8 things: rest between shifts, days in a row,
//  nights, weekends off, hours, days off, sick days and PH owed.
//  Nights, weekends and hours are compared with the rest of their hotel.
//  Team list: a ring per person · person card: the full picture and
//  what would help.
// ═══════════════════════════════════════════════════════════

const RH_DAYS = 28;
const RH_GRADES = [[85, 'Thriving', 'good'], [70, 'Good', 'ok'], [50, 'Watch', 'warn'], [0, 'Needs care', 'bad']];
let _rhC = null;

function rhWindow() { const end = roAdd(roMonday(new Date()), 6); return Array.from({ length: RH_DAYS }, (_, i) => roAdd(end, i - RH_DAYS + 1)); }
function rhGrade(s) { return RH_GRADES.find(g => s >= g[0]); }
function _rhOffish(v) { return !!v && v !== '—' && !rbParse(v); }

/** Raw numbers for one person over the window. */
function rhRaw(k, dates) {
  const r = { days: 0, worked: 0, hours: 0, nights: 0, wkDays: 0, wkOff: 0, short: 0, worst: 99, n2m: 0, run: 0, runEnd: '', sick: 0, offShort: 0, longShift: 0 };
  let run = 0, prev = null, prevDt = null, nightThenOff = 0;
  dates.forEach((dt, i) => {
    const v = (roDays[dt] || {})[k];
    if (!v || v === '—') { run = 0; prev = null; prevDt = null; return; }
    r.days++;
    const x = rbParse(v), wd = roDate(dt).getDay(), weekend = wd === 0 || wd === 6;
    if (weekend) { r.wkDays++; if (!x) r.wkOff++; }
    if (x) {
      r.worked++; const h = (x.e - x.s) / 60; r.hours += h; if (h > 9.01) r.longShift++;
      if (rbIsNight(v)) r.nights++;
      if (prev && prevDt === roAdd(dt, -1) && rbParse(prev)) { const rest = rbRest(prev, v); if (rest < 11) { r.short++; r.worst = Math.min(r.worst, rest); } }
      if (nightThenOff === 2 && rbIsMorning(v)) r.n2m++;
      run++; if (run > r.run) { r.run = run; r.runEnd = dt; }
      nightThenOff = rbIsNight(v) ? 1 : 0;
    } else {
      run = 0; nightThenOff = nightThenOff === 1 ? 2 : 0;
      if (/^S(L|ICK)\b/i.test(String(v))) r.sick++;
    }
    prev = v; prevDt = dt;
  });
  // days off each week (full weeks only)
  const want = (rbPersonCfg(k) || {}).offs ?? 1;
  for (let w = 0; w + 7 <= dates.length; w += 7) {
    const wk = dates.slice(w, w + 7).map(dt => (roDays[dt] || {})[k]);
    if (wk.filter(v => v && v !== '—').length === 7 && wk.filter(_rhOffish).length < want) r.offShort++;
  }
  return r;
}

/** Everyone's health, with team averages per hotel. Cached until the roster changes. */
function rhAll() {
  const dates = rhWindow(), stamp = dates[0] + '#' + Object.keys(roStaff).length + '#' + dates.map(dt => JSON.stringify(roDays[dt] || {})).join('');
  if (_rhC && _rhC.stamp === stamp) return _rhC.out;
  const raw = {}; Object.keys(roStaff).forEach(k => { if (!(rbPeople[k] || {}).deleted) raw[k] = rhRaw(k, dates); });
  const avg = {};
  Object.keys(raw).forEach(k => { const g = rbBaseGroup((roStaff[k] || {}).group || ''), r = raw[k]; if (r.worked < 5) return; const a = avg[g] = avg[g] || { n: 0, nightRate: 0, wkOffRate: 0, hpw: 0 }; a.n++; a.nightRate += r.nights / r.worked; a.wkOffRate += r.wkDays ? r.wkOff / r.wkDays : 0; a.hpw += r.hours / (r.days / 7); });
  Object.values(avg).forEach(a => { a.nightRate /= a.n; a.wkOffRate /= a.n; a.hpw /= a.n; });
  const out = {};
  Object.keys(raw).forEach(k => { out[k] = rhScore(k, raw[k], avg[rbBaseGroup((roStaff[k] || {}).group || '')] || null); });
  _rhC = { stamp, out };
  return out;
}

function rhScore(k, r, a) {
  if (r.worked < 5) return { k, none: true, r };
  const p = rbPersonCfg(k) || {}, nightStaff = p.mode === 'static' && rbIsNight(p.fixed);
  const clamp = x => Math.max(0, Math.min(100, Math.round(x)));
  const weeks = r.days / 7, hpw = r.hours / weeks;
  const nightRate = r.nights / r.worked, wkOffRate = r.wkDays ? r.wkOff / r.wkDays : 0;
  const ph = typeof rbPhOwed === 'function' ? rbPhOwed(k).owed : 0;
  const M = [
    { id: 'rest', ico: '😴', name: 'Rest', w: 3,
      s: clamp(100 - r.short * 22 - r.n2m * 15 - (r.worst < 8 ? 15 : 0)),
      v: r.short ? `${r.short} short` : '11 h+', d: r.short ? `${r.short} time${r.short > 1 ? 's' : ''} under 11 h between shifts (shortest ${Math.max(0, Math.round(r.worst))} h)${r.n2m ? ` · ${r.n2m}× night → one day off → morning` : ''}` : r.n2m ? `${r.n2m}× night → one day off → morning` : 'Always 11 hours or more between shifts',
      tip: 'Keep 11 h between shifts and two days off between a night and a morning' },
    { id: 'run', ico: '📆', name: 'Days in a row', w: 2,
      s: r.run <= 6 ? 100 : r.run === 7 ? 70 : r.run === 8 ? 45 : 15,
      v: `${r.run} max`, d: `Longest stretch: ${r.run} working days in a row${r.runEnd ? ' (to ' + roDayLbl(r.runEnd) + ')' : ''}`, tip: 'Break up the long stretch with a day off' },
    { id: 'nights', ico: '🌙', name: 'Nights', w: 2,
      s: nightStaff || !a ? 100 : clamp(100 - Math.max(0, nightRate - a.nightRate) * 220),
      v: `${r.nights}`, d: nightStaff ? `${r.nights} nights · works nights by choice` : `${r.nights} nights in 4 weeks${a ? ` (hotel average ${Math.round(a.nightRate * r.worked)})` : ''}`, tip: 'Fewer nights for a while: the builder already gives the lighter side to whoever had more' },
    { id: 'wk', ico: '🏖', name: 'Weekends', w: 2,
      s: r.wkDays < 6 ? 100 : clamp((r.wkOff ? 100 : 55) - Math.max(0, (a ? a.wkOffRate : 0.3) - wkOffRate) * 160),
      v: `${r.wkOff} off`, d: `${r.wkOff} weekend day${r.wkOff === 1 ? '' : 's'} off in 4 weeks${a ? ` (hotel average ${(a.wkOffRate * r.wkDays).toFixed(1)})` : ''}`, tip: 'Give a Saturday or Sunday off soon' },
    { id: 'hrs', ico: '⏱', name: 'Hours', w: 2,
      s: clamp(100 - Math.max(0, hpw - (a ? a.hpw : 48) - 2) * 7 - r.longShift * 6),
      v: `${Math.round(hpw)} h/wk`, d: `${Math.round(hpw)} hours a week${a ? ` (hotel average ${Math.round(a.hpw)})` : ''}${r.longShift ? ` · ${r.longShift} shift${r.longShift > 1 ? 's' : ''} over 9 h` : ''}`, tip: 'A lighter week: fewer or shorter shifts' },
    { id: 'off', ico: '🛋', name: 'Days off', w: 2,
      s: clamp(100 - r.offShort * 35),
      v: r.offShort ? `${r.offShort} short` : 'all', d: r.offShort ? `${r.offShort} week${r.offShort > 1 ? 's' : ''} with fewer days off than they should get (${p.offs ?? 1})` : `Every week had their ${p.offs ?? 1} day${(p.offs ?? 1) === 1 ? '' : 's'} off`, tip: 'Give back the day off they missed' },
    { id: 'sick', ico: '🤒', name: 'Sick', w: 1,
      s: r.sick === 0 ? 100 : r.sick <= 2 ? 80 : r.sick <= 5 ? 55 : 30,
      v: `${r.sick} day${r.sick === 1 ? '' : 's'}`, d: r.sick ? `${r.sick} sick day${r.sick === 1 ? '' : 's'} in 4 weeks` : 'No sick days in 4 weeks', tip: 'Check in with them: a short chat goes a long way' },
    { id: 'ph', ico: '🎟', name: 'PH owed', w: 1,
      s: ph <= 2 ? 100 : ph <= 4 ? 75 : ph <= 7 ? 50 : 25,
      v: `${ph}`, d: ph ? `${ph} PH day${ph === 1 ? '' : 's'} owed` : 'No PH owed', tip: 'Clear some PH: the builder gives 1 a week when a shift has someone spare anyway' },
  ];
  const score = Math.round(M.reduce((t, m) => t + m.s * m.w, 0) / M.reduce((t, m) => t + m.w, 0));
  const worst = M.filter(m => m.s < 70).sort((x, y) => x.s - y.s);
  return { k, score, grade: rhGrade(score), M, worst, r };
}

// ── UI ────────────────────────────────────────────────────
function rhRing(score, size, cls) {
  const g = rhGrade(score);
  return `<span class="rh-ring rh-${g[2]}${cls ? ' ' + cls : ''}" style="--p:${score};--sz:${size || 34}px" title="Health ${score}/100 · ${g[1]}"><b>${score}</b></span>`;
}
/** Small ring + the flags worth a look, for the team list. */
function rhBadge(k) {
  const H = rhAll()[k];
  if (!H || H.none) return '<span class="rh-badge"><span class="rh-ring rh-none" style="--p:0;--sz:30px" title="Not enough roster yet"><b>·</b></span></span>';
  return `<span class="rh-badge">${H.worst.slice(0, 3).map(m => `<i title="${escapeHtml(m.name)}: ${escapeHtml(m.d)}">${m.ico}</i>`).join('')}${rhRing(H.score, 30)}</span>`;
}
/** The team at a glance: average, the spread, and who needs care first. */
function rhTeamHtml(shown) {
  const all = rhAll(), list = Object.values(all).filter(H => !H.none && shown.includes(rbBaseGroup((roStaff[H.k] || {}).group || '')));
  if (!list.length) return '';
  const avg = Math.round(list.reduce((t, H) => t + H.score, 0) / list.length);
  const n = g => list.filter(H => H.grade[2] === g).length;
  const care = list.filter(H => H.score < 70).sort((a, b) => a.score - b.score);
  const seg = (g, label) => n(g) ? `<span class="rh-seg rh-${g}" style="flex:${n(g)}" title="${n(g)} ${label}">${n(g)}</span>` : '';
  const g = rhGrade(avg);
  return `<div class="rh-team">
    ${rhRing(avg, 58, 'big')}
    <div class="rh-team-m">
      <div class="rh-team-hd"><b>Team health</b><span class="rh-pill rh-${g[2]}">${g[1]}</span><small>${list.length} people · last 4 weeks of rosters</small></div>
      <div class="rh-bar">${seg('good', 'thriving')}${seg('ok', 'good')}${seg('warn', 'to watch')}${seg('bad', 'need care')}</div>
      <div class="rh-legend"><span><i class="rh-dot rh-good"></i>Thriving ${n('good')}</span><span><i class="rh-dot rh-ok"></i>Good ${n('ok')}</span><span><i class="rh-dot rh-warn"></i>Watch ${n('warn')}</span><span><i class="rh-dot rh-bad"></i>Needs care ${n('bad')}</span></div>
      ${care.length ? `<div class="rh-care"><span>Look after first:</span>${care.slice(0, 6).map(H => `<button class="rh-chip rh-${H.grade[2]}" onclick="rtPerson(${_rtQ(H.k)})">${H.worst[0] ? H.worst[0].ico + ' ' : ''}${escapeHtml(((roStaff[H.k] || {}).name || H.k).split(' ')[0])} <b>${H.score}</b></button>`).join('')}</div>` : '<div class="rh-care ok">💚 Everyone is in good shape.</div>'}
    </div>
  </div>`;
}
/** The full picture on a person's card. */
function rhPersonHtml(k) {
  const H = rhAll()[k];
  if (!H) return '';
  if (H.none) return `<div class="rh-card rh-empty-card"><span class="rh-ring rh-none" style="--p:0;--sz:46px"><b>·</b></span><div><b>Health</b><small>Shows once they have a week or so on posted rosters.</small></div></div>`;
  const tips = H.worst.slice(0, 3);
  return `<div class="rh-card">
    <div class="rh-card-hd">${rhRing(H.score, 64, 'big')}<div><b>Health · <span class="rh-txt-${H.grade[2]}">${H.grade[1]}</span></b><small>From the last 4 weeks of rosters${H.M.find(m => m.id === 'nights').d.includes('by choice') ? '' : ', compared with their hotel'}</small></div></div>
    <div class="rh-tiles">${H.M.map(m => { const g = rhGrade(m.s); return `<div class="rh-tile rh-${g[2]}" title="${escapeHtml(m.d)}"><div class="rh-tile-t"><span>${m.ico}</span>${escapeHtml(m.name)}</div><div class="rh-tile-v">${escapeHtml(m.v)}</div><div class="rh-meter"><i style="width:${Math.max(6, m.s)}%"></i></div></div>`; }).join('')}</div>
    ${tips.length ? `<div class="rh-tips"><b>What would help</b>${tips.map(m => `<div class="rh-tip rh-${rhGrade(m.s)[2]}"><span>${m.ico}</span><div>${escapeHtml(m.tip)}<small>${escapeHtml(m.d)}</small></div></div>`).join('')}</div>` : '<div class="rh-tips ok">💚 Nothing to worry about: good rest, fair nights and weekends.</div>'}
  </div>`;
}

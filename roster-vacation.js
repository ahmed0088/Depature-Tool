// ═══════════════════════════════════════════════════════════
//  roster-vacation.js — 🌴 vacation (annual leave) balance
//  Everyone earns vacation every day they work here (30 days a year
//  unless set otherwise, for the team in Rules or for one person on
//  their card). AL / ALA / ANL / VAC days in the roster and leave added
//  on their card are taken off: days up to today are "used", later ones
//  are "booked". Set today's balance from HR once and it counts on from
//  there; without it, it counts from the day they joined.
//  Stored on the person: rbPeople[k].vacBal = { n, at }, .vacYear
// ═══════════════════════════════════════════════════════════

const VC_DEF = 30;
/** A roster cell or leave code that is vacation (annual leave), not sick or pending. */
function vcIsAL(v) {
  const s = String(v || '').trim().toUpperCase();
  if (!s) return false;
  if (/^(AL|ALA|ANL|VAC)\b/.test(s)) return true;
  const i = typeof roInfo === 'function' ? roInfo(s) : null;
  return !!(i && i.type === 'leave' && /annual|vacation/i.test(i.label || '') && !/pending/i.test(i.label || ''));
}
function vcRate(k) { const c = rbPeople[k] || {}; return +c.vacYear || +rbRules().vacDays || VC_DEF; }
function _vcR(n) { return Math.round(n * 10) / 10; }
function _vcISO(v) { const s = String(v || ''); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; }
function _vcDays(a, b) { return Math.round((roDate(b) - roDate(a)) / 864e5); }
/** Where the count starts: the balance set by hand (from the day after it was set), else the join date. */
function vcStart(k) {
  const c = rbPeople[k] || {};
  if (c.vacBal && _vcISO(c.vacBal.at)) return { n: +c.vacBal.n || 0, at: c.vacBal.at, set: true };
  return { n: 0, at: _vcISO(c.joined) || _vcISO(typeof rbFirstDay === 'function' ? rbFirstDay(k) : '') || roToday(), set: false };
}
/** The roster read once per redraw for everyone (a list of 20 people asked 20 times reads it once),
 *  and each code looked up once ("AL", "07:00 - 15:00"… are the same few hundred values over and over). */
let _vcScanC = null;
function _vcScan() {
  if (_vcScanC && _vcScanC.live) return _vcScanC;   // same redraw: no need to even check
  const stamp = typeof _rbLearnStamp === 'function' ? _rbLearnStamp() : '';
  if (_vcScanC && _vcScanC.stamp === stamp) { _vcLive(); return _vcScanC; }
  const al = {}, memo = new Map();
  for (const dt in roDays) {
    const day = roDays[dt]; if (!day) continue;
    for (const k in day) { const v = day[k]; if (!v) continue; let r = memo.get(v); if (r === undefined) { r = vcIsAL(v); memo.set(v, r); } if (r) (al[k] = al[k] || []).push(dt); }
  }
  _vcScanC = { al, stamp }; _vcLive();
  return _vcScanC;
}
function _vcLive() { const C = _vcScanC; C.live = true; setTimeout(() => { C.live = false; }, 0); }
/** Every vacation day someone has from a date on: posted roster and leave on their card (each day once). */
function vcDates(k, from) {
  const days = new Set(), c = rbPeople[k] || {};
  (_vcScan().al[k] || []).forEach(dt => { if (dt >= from) days.add(dt); });
  Object.values(c.absences || {}).forEach(a => {
    if (!a || !a.from || !vcIsAL(a.code)) return;
    let dt = a.from, n = 0;
    while (dt <= (a.to || a.from) && n++ < 400) { if (dt >= from) days.add(dt); dt = roAdd(dt, 1); }
  });
  return [...days].sort();
}
/** { now, after, earned, used, booked, next, rate, from, set } — now = balance today; after = once booked days are taken. */
function vcBalance(k, onDate) {
  const today = _vcISO(onDate) || roToday(), s = vcStart(k), c = rbPeople[k] || {};
  const left = _vcISO(c.left), end = left && left < today ? left : today;
  const earned = Math.max(0, _vcDays(s.at, end) + (s.set ? 0 : 1)) * vcRate(k) / 365;
  const D = vcDates(k, s.at), used = D.filter(d => d <= today).length, next = D.filter(d => d > today);
  const now = s.n + earned - used;
  return { now: _vcR(now), after: _vcR(now - next.length), earned: _vcR(earned), used, booked: next.length, next, rate: vcRate(k), from: s.at, set: s.set };
}
/** "Balance today" typed on the card: counted on from tomorrow. */
function vcSetBal(k, n) {
  if (isNaN(n)) return;
  rbSetPerson(k, 'vacBal', { n: _vcR(n), at: roAdd(roToday(), 1) });
  if (typeof tlLog === 'function') tlLog('note', { key: k, text: `Vacation balance set to ${_vcR(n)} days` });
}
function vcSetRate(k, n) { rbSetPerson(k, 'vacYear', n > 0 && n !== (+rbRules().vacDays || VC_DEF) ? n : undefined); }
function _vcN(n) { return (n % 1 ? n.toFixed(1) : String(n)); }

// ── Screens ───────────────────────────────────────────────
/** On a person's card. */
function vcPersonHtml(k) {
  const b = vcBalance(k), q = typeof _rtQ === 'function' ? _rtQ(k) : JSON.stringify(k), tone = b.after < 0 ? 'bad' : b.now >= 45 ? 'warn' : 'ok';
  const nx = b.next.length ? `${roDayLbl(b.next[0])}${b.next.length > 1 ? ' → ' + roDayLbl(b.next[b.next.length - 1]) : ''}` : '';
  return `<div class="vc-card vc-${tone}">
    <div class="vc-top"><span class="vc-ico">🌴</span><div class="vc-big"><b>${_vcN(b.now)}</b><small>vacation days today</small></div>
      <div class="vc-facts"><span>+${_vcN(_vcR(b.rate / 12))} a month (${b.rate} a year)</span><span>${b.used} used since ${escapeHtml(roDayLbl(b.from))}</span>${b.booked ? `<span>${b.booked} booked · ${escapeHtml(nx)}</span><span><b>${_vcN(b.after)}</b> left after that</span>` : ''}</div></div>
    ${b.after < 0 ? `<div class="vc-msg">⚠ Booked ${_vcN(-b.after)} day${b.after === -1 ? '' : 's'} more than they will have.</div>` : b.now >= 45 ? '<div class="vc-msg">A big balance: worth planning some of it.</div>' : ''}
    <div class="rb-inline vc-set"><label>Balance today <input type="number" step="0.5" min="-60" max="200" value="${b.now}" onchange="vcSetBal(${q},+this.value);rtPerson(${q})"></label><label>Days a year <input type="number" min="0" max="60" value="${b.rate}" onchange="vcSetRate(${q},+this.value);rtPerson(${q})"></label></div>
    <small class="ro-hint">${b.set ? 'Counting on from the balance you set.' : 'Counted from the day they joined. Type the balance from HR once to make it exact.'} AL, ALA and VAC days in the roster and leave added below come off it.</small>
  </div>`;
}
/** In the builder: everyone's balance, biggest first. */
function vcTeamHtml() {
  const ks = Object.keys(roStaff).filter(k => roStaff[k] && !(rbPeople[k] || {}).deleted && !((rbPeople[k] || {}).left && rbPeople[k].left <= roToday()));
  const L = ks.map(k => ({ k, b: vcBalance(k) })).sort((a, b) => b.b.now - a.b.now);
  if (!L.length) return '<div class="ro-empty">Nobody in the team yet.</div>';
  const max = Math.max(30, ...L.map(x => x.b.now));
  return `<div class="vc-team">${L.map(({ k, b }) => `<button class="vc-row${b.after < 0 ? ' bad' : b.now >= 45 ? ' warn' : ''}" onclick="rtPerson(${typeof _rtQ === 'function' ? _rtQ(k) : JSON.stringify(k)})">
    <span class="vc-nm">${escapeHtml(roStaff[k].name || k)}<small>${escapeHtml(roStaff[k].group || '')}</small></span>
    <span class="vc-bar"><i style="width:${Math.max(0, Math.min(100, b.now / max * 100))}%"></i></span>
    <span class="vc-n"><b>${_vcN(b.now)}</b>${b.booked ? `<small>${b.booked} booked → ${_vcN(b.after)}</small>` : ''}</span></button>`).join('')}</div>
    <small class="ro-hint">Tap a name to set their balance from HR. ${L.some(x => !x.b.set) ? 'Without one it counts from the day they joined.' : ''}</small>`;
}
function vcSummary() {
  const ks = Object.keys(roStaff).filter(k => roStaff[k] && !(rbPeople[k] || {}).deleted && !((rbPeople[k] || {}).left && rbPeople[k].left <= roToday()));
  const B = ks.map(k => vcBalance(k)), over = B.filter(b => b.after < 0).length;
  return ks.length ? `${_vcN(_vcR(B.reduce((t, b) => t + b.now, 0) / ks.length))} days on average${over ? ` · ⚠ ${over} booked over` : ''}` : '';
}
/** Before adding vacation on a card: say if it is more than they have. true = go ahead. */
function vcCheckAdd(k, from, to, code) {
  if (!vcIsAL(code)) return true;
  const b = vcBalance(k), have = new Set(vcDates(k, from));
  let n = 0; for (let dt = from, i = 0; dt <= (to || from) && i < 400; dt = roAdd(dt, 1), i++) if (!have.has(dt)) n++;
  if (n <= b.after) return true;
  return confirm(`${(roStaff[k] || {}).name || k} has ${_vcN(b.after)} vacation day${b.after === 1 ? '' : 's'} left${b.booked ? ' after what is booked' : ''}, and this is ${n}. Add it anyway?`);
}

// ── Ops Brain ─────────────────────────────────────────────
function _vcAnswer(who) {
  if (who) {
    const k = rtFind(who);
    if (!k || Array.isArray(k)) return `<div class="br-title">${Array.isArray(k) ? 'Which one: ' + k.map(rtName).map(escapeHtml).join(', ') + '?' : 'I can\'t find "' + escapeHtml(who) + '" in the team.'}</div>`;
    const b = vcBalance(k);
    return `<div class="br-kind">🌴 Vacation</div><div class="br-title">${escapeHtml(rtName(k))}: ${_vcN(b.now)} days today</div><div class="br-body">${b.rate} a year · ${b.used} used since ${escapeHtml(roDayLbl(b.from))}${b.booked ? ` · ${b.booked} booked (from ${escapeHtml(roDayLbl(b.next[0]))}), ${_vcN(b.after)} left after` : ''}.</div><div class="br-acts"><button class="btn sm" onclick="brClose&&brClose();showPanel('roster-build');setTimeout(()=>rtPerson(${_rtQ(k)}),80)">Open card</button></div>`;
  }
  return `<div class="br-kind">🌴 Vacation balance</div><div class="br-title">${escapeHtml(vcSummary())}</div><div class="br-body">${vcTeamHtml()}</div>`;
}
const VC_ASK = [
  /^(?:what(?:'s| is)\s+)?(?:the\s+)?(?:vacation|annual leave|leave|al)\s+balances?(?:\s+(?:of|for)\s+(.+?))?\s*\??$/i,
  /^(.+?)(?:'s|s')\s+(?:vacation|annual leave|leave|al)(?:\s+balance)?\s*\??$/i,
  /^how\s+(?:much|many)\s+(?:vacation|annual leave|leave|al)(?:\s+days)?\s+(?:does|has)\s+(.+?)\s+(?:have|got|left)(?:\s+left)?\s*\??$/i,
];
function _vcMatch(q) { q = String(q || '').trim(); for (const r of VC_ASK) { const m = q.match(r); if (m && (!m[1] || (typeof rtNamesOk !== 'function' || rtNamesOk(m[1])))) return m; } return null; }
if (typeof RT_COMMANDS !== 'undefined') RT_COMMANDS.unshift({ re: { test: q => !!_vcMatch(q), source: VC_ASK[0].source }, ex: 'vacation balance of Sam', does: 'shows vacation days left (and booked)', run: q => { const m = _vcMatch(q); _rtOut(_vcAnswer(m && m[1])); return true; } });

document.addEventListener('DOMContentLoaded', () => {
  (window.BL_THINKERS = window.BL_THINKERS || []).push(add => {
    if (typeof roStaff === 'undefined' || !Object.keys(roStaff).length) return;
    const ks = Object.keys(roStaff).filter(k => roStaff[k] && !(rbPeople[k] || {}).deleted && !((rbPeople[k] || {}).left && rbPeople[k].left <= roToday()));
    const B = ks.map(k => [k, vcBalance(k)]);
    const over = B.filter(([, b]) => b.after < 0), big = B.filter(([, b]) => b.now >= 45);
    const open = k => ['Open card', () => { showPanel('roster-build'); setTimeout(() => rtPerson(k), 80); }];
    if (over.length) add({ id: 'vacOver:' + over.map(x => x[0]).join(','), type: 'roster', icon: '🌴', tone: 'warn', text: `Vacation booked over the balance: ${over.map(([k, b]) => `${rtName(k).split(' ')[0]} (${_vcN(b.after)})`).join(', ')}.`, why: 'More AL days in the roster or on their card than they will have earned. Check with HR or shorten the leave.', acts: [open(over[0][0])] });
    if (big.length) add({ id: 'vacBig:' + roMonday(new Date()), type: 'roster', icon: '🌴', tone: 'idle', silent: true, text: `Big vacation balances: ${big.sort((a, b) => b[1].now - a[1].now).slice(0, 5).map(([k, b]) => `${rtName(k).split(' ')[0]} ${_vcN(b.now)} days`).join(', ')}.`, why: 'Planning some of it now avoids everyone wanting it at once.', acts: [open(big[0][0])] });
  });
});

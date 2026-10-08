// ═══════════════════════════════════════════════════════════
//  roster-holidays.js — public holidays for the region, with your OK
//  The app knows the UAE public holidays (Islamic ones are expected
//  dates: they move a day with the moon sighting). When one comes near
//  (3 weeks before) it asks once: add it to everyone's PH balance, change
//  the dates, or not a PH. Nothing is added without a yes.
//  Saved in roster/builder/settings: holidays (the list the balance
//  uses), holRegion, holDecided { id: 'yes' | 'no' }, phEarn.
// ═══════════════════════════════════════════════════════════

const HD_REGIONS = {
  AE: { label: 'UAE (Dubai)', days: {
    // [first day, number of days, name, expected (moon sighting)?]
    2026: [['2026-01-01', 1, "New Year's Day"], ['2026-03-19', 3, 'Eid Al Fitr', 1], ['2026-05-26', 1, 'Arafat Day', 1], ['2026-05-27', 3, 'Eid Al Adha', 1],
           ['2026-06-15', 1, 'Hijri New Year'], ['2026-08-25', 1, "Prophet's Birthday", 1], ['2026-12-02', 2, 'National Day']],
    2027: [['2027-01-01', 1, "New Year's Day"], ['2027-03-09', 3, 'Eid Al Fitr', 1], ['2027-05-15', 1, 'Arafat Day', 1], ['2027-05-16', 3, 'Eid Al Adha', 1],
           ['2027-06-06', 1, 'Hijri New Year', 1], ['2027-08-14', 1, "Prophet's Birthday", 1], ['2027-12-02', 2, 'National Day']],
    2028: [['2028-01-01', 1, "New Year's Day"], ['2028-02-26', 3, 'Eid Al Fitr', 1], ['2028-05-04', 1, 'Arafat Day', 1], ['2028-05-05', 3, 'Eid Al Adha', 1],
           ['2028-05-25', 1, 'Hijri New Year', 1], ['2028-08-03', 1, "Prophet's Birthday", 1], ['2028-12-02', 2, 'National Day']],
  } },
};
const HD_AHEAD = 21, HD_BEHIND = 45;   // ask from 3 weeks before; still ask up to 45 days after if nobody answered

function hdRegion() { const r = (typeof rbSettings !== 'undefined' && rbSettings.holRegion) || 'AE'; return HD_REGIONS[r] ? r : ''; }
/** The region's holidays as groups: { id, name, dates:[iso], expected }. */
function hdList(region) {
  const R = HD_REGIONS[region || hdRegion()]; if (!R) return [];
  const out = [];
  Object.values(R.days).forEach(list => list.forEach(([from, n, name, exp]) => {
    out.push({ id: `${region || hdRegion()}:${from}:${name.replace(/\W+/g, '')}`, name, dates: Array.from({ length: n }, (_, i) => roAdd(from, i)), expected: !!exp });
  }));
  return out;
}
function hdDecided(id) { return ((rbSettings.holDecided || {})[id]) || ''; }
/** Holidays to ask about now: near, not answered, not already in the list. */
function hdPending(today) {
  today = today || roToday();
  const have = new Set((rbSettings.holidays || []).map(h => h && h.date));
  return hdList().filter(h => !hdDecided(h.id) && h.dates.some(d => !have.has(d))
    && h.dates[0] <= roAdd(today, HD_AHEAD) && h.dates[h.dates.length - 1] >= roAdd(today, -HD_BEHIND));
}
function hdWhen(h) { const a = h.dates[0], b = h.dates[h.dates.length - 1]; return a === b ? roDayLbl(a, true) : `${roDayLbl(a, true)} → ${roDayLbl(b, true)}`; }
function hdTeamCount() { return Object.keys(roStaff || {}).filter(k => !((rbPeople[k] || {}).deleted) && !((rbPeople[k] || {}).left && rbPeople[k].left <= roToday())).length; }

/** Yes: the days go in the holiday list, so everyone earns them (or only who works them, as set). */
function hdAccept(id, dates) {
  const h = hdList().find(x => x.id === id); if (!h) return;
  dates = dates || h.dates;
  const list = (rbSettings.holidays || []).filter(x => x && !dates.includes(x.date)).concat(dates.map(d => ({ date: d, name: h.name, src: hdRegion() }))).sort((a, b) => a.date.localeCompare(b.date));
  rbSettings.holidays = list; fbSet('roster/builder/settings/holidays', list);
  hdSetDecided(id, 'yes');
  showToast(`${h.name}: ${dates.length} PH day${dates.length > 1 ? 's' : ''} added${(rbSettings.phEarn || 'all') === 'all' ? ' to everyone\'s balance (once the day has come)' : ' for whoever works it'}`, 'ok');
  hdRefresh();
}
function hdReject(id) { hdSetDecided(id, 'no'); showToast('OK: not added', 'ok'); hdRefresh(); }
function hdSetDecided(id, v) { rbSettings.holDecided = Object.assign({}, rbSettings.holDecided, { [id]: v }); fbSet('roster/builder/settings/holDecided/' + id.replace(/[.#$/[\]]/g, '_'), v); }
/** Change the dates first (the moon moved it): pick the first day and how many days. */
function hdChange(id) {
  const h = hdList().find(x => x.id === id); if (!h) return;
  const from = prompt(`${h.name}: first day (YYYY-MM-DD)`, h.dates[0]); if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from.trim())) return;
  const n = parseInt(prompt('How many days?', String(h.dates.length)), 10); if (!(n >= 1 && n <= 7)) return;
  hdAccept(id, Array.from({ length: n }, (_, i) => roAdd(from.trim(), i)));
}
function hdRefresh() { if (typeof rbRender === 'function' && document.getElementById('panel-roster-build')?.classList.contains('active')) rbRender(); }
function hdSetRegion(r) { rbSettings.holRegion = r || 'none'; fbSet('roster/builder/settings/holRegion', rbSettings.holRegion); hdRefresh(); }
function hdSetEarn(v) { rbSettings.phEarn = v; fbSet('roster/builder/settings/phEarn', v); hdRefresh(); }

function hdAskHtml(h) {
  return `<div class="hd-ask"><span class="hd-ico">🎉</span><div class="hd-txt"><b>${escapeHtml(h.name)}</b> · ${escapeHtml(hdWhen(h))}${h.expected ? ' <i title="Islamic holidays move with the moon sighting: change the dates if the announcement differs">(expected)</i>' : ''}
    <small>Add ${h.dates.length} PH day${h.dates.length > 1 ? 's' : ''} to ${(rbSettings.phEarn || 'all') === 'all' ? `everyone's balance (${hdTeamCount()} people)` : 'whoever works it'}?</small></div>
    <div class="hd-acts"><button class="btn sm gold" onclick="hdAccept(${_hdQ(h.id)})">✓ Add</button><button class="btn sm" onclick="hdChange(${_hdQ(h.id)})">✏️ Dates</button><button class="btn sm ghost" onclick="hdReject(${_hdQ(h.id)})">Not a PH</button></div></div>`;
}
function _hdQ(s) { return escapeHtml(JSON.stringify(String(s))); }
/** In the builder, under ⚖️ Rules: region, who earns, questions, the coming holidays and the PH list. */
function hdPanelHtml() {
  const today = roToday(), pend = hdPending(), reg = rbSettings.holRegion || 'AE', earnAll = (rbSettings.phEarn || 'all') === 'all';
  const have = new Set((rbSettings.holidays || []).map(h => h && h.date));
  const up = hdList().filter(h => h.dates[h.dates.length - 1] >= today && !pend.some(x => x.id === h.id)).slice(0, 5);
  const tile = iso => { const d = roDate(iso); return `<span class="hd-date"><b>${d.getDate()}</b><i>${d.toLocaleDateString('en-GB', { month: 'short' })}</i></span>`; };
  const range = h => { const a = roDate(h.dates[0]), b = roDate(h.dates[h.dates.length - 1]); const wd = x => x.toLocaleDateString('en-GB', { weekday: 'short' }); return h.dates.length > 1 ? `${wd(a)} – ${wd(b)} · ${h.dates.length} days` : wd(a); };
  const status = h => { const dec = hdDecided(h.id), added = h.dates.every(d => have.has(d));
    if (dec === 'no') return '<span class="hd-st no">Not a PH</span>';
    if (dec === 'yes' || added) return '<span class="hd-st yes">✓ Added</span>';
    return `<span class="hd-st wait">I'll ask ${escapeHtml(roDate(roAdd(h.dates[0], -HD_AHEAD)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}</span>`; };
  // the PH list, grouped by holiday (Eid = one row with its days)
  const groups = []; (rbSettings.holidays || []).filter(h => h && h.date).forEach(h => { const g = groups[groups.length - 1]; if (g && g.name === (h.name || '') && roAdd(g.dates[g.dates.length - 1], 1) === h.date) g.dates.push(h.date); else groups.push({ name: h.name || '', dates: [h.date] }); });
  const recent = groups.filter(g => g.dates[g.dates.length - 1] >= roAdd(today, -400)).reverse();
  return `<div class="hd-panel">
    <div class="hd-hd"><div><b>🎉 Public holidays</b><small>${earnAll ? 'Everyone on the team earns a PH day for each one.' : 'Whoever works it earns a PH day.'} A PH on a posted roster comes off the balance.</small></div></div>
    <div class="hd-ctls">
      <label>Region<select onchange="hdSetRegion(this.value)">${Object.entries(HD_REGIONS).map(([k, v]) => `<option value="${k}"${reg === k ? ' selected' : ''}>${escapeHtml(v.label)}</option>`).join('')}<option value="none"${reg === 'none' ? ' selected' : ''}>None: add them by hand</option></select></label>
      <label>Who earns a PH<select onchange="hdSetEarn(this.value)"><option value="all"${earnAll ? ' selected' : ''}>Everyone on the team</option><option value="worked"${!earnAll ? ' selected' : ''}>Only who works that day</option></select></label>
    </div>
    ${pend.map(hdAskHtml).join('')}
    ${up.length ? `<div class="hd-sec">Coming up</div><div class="hd-list">${up.map(h => `<div class="hd-row">${tile(h.dates[0])}<div class="hd-m"><b>${escapeHtml(h.name)}</b><small>${escapeHtml(range(h))}${h.expected ? ' · expected' : ''}</small></div>${status(h)}</div>`).join('')}</div>` : ''}
    <div class="hd-sec">In the PH list <small>${recent.length ? recent.reduce((t, g) => t + g.dates.length, 0) + ' days' : ''}</small></div>
    ${recent.length ? `<div class="hd-chips">${recent.map(g => `<span class="hd-chip">${tile(g.dates[0])}<span><b>${escapeHtml(g.name || 'Holiday')}</b><small>${g.dates.length > 1 ? g.dates.length + ' days' : roDate(g.dates[0]).toLocaleDateString('en-GB', { weekday: 'short' })}${g.dates[0] > today ? ' · coming' : ''}</small></span><button class="ro-x" title="Remove" onclick="hdDelGroup(${_hdQ(g.dates.join(','))})">✕</button></span>`).join('')}</div>` : `<div class="hd-empty">None yet. Say ✓ Add when I ask, or add one below.</div>`}
    <div class="hd-add"><input type="date" id="rbHd" aria-label="Date"><input id="rbHn" placeholder="Name, e.g. National Day" aria-label="Name"><button class="btn sm gold" onclick="rbAddHol()">＋ Add</button></div>
  </div>`;
}
function hdDelGroup(list) {
  const ds = String(list).split(',');
  const h = (rbSettings.holidays || []).filter(x => x && !ds.includes(x.date));
  rbSettings.holidays = h; fbSet('roster/builder/settings/holidays', h); hdRefresh();
}

// Ops Brain: asks quietly when one is near
document.addEventListener('DOMContentLoaded', () => {
  (window.BL_THINKERS = window.BL_THINKERS || []).push(add => {
    if (typeof roCanEdit !== 'function' || !roCanEdit() || typeof rbSettings === 'undefined' || !Object.keys(roStaff || {}).length) return;
    hdPending().slice(0, 2).forEach(h => add({ id: 'holiday:' + h.id, type: 'roster', icon: '🎉', tone: 'idle', silent: true,
      text: `${h.name} ${hdWhen(h)}${h.expected ? ' (expected)' : ''}: add ${h.dates.length} PH day${h.dates.length > 1 ? 's' : ''} to ${(rbSettings.phEarn || 'all') === 'all' ? 'everyone\'s' : 'the'} balance?`,
      why: 'Public holiday in your region. Nothing is added until you say yes.',
      acts: [['✓ Add', () => hdAccept(h.id)], ['✏️ Dates', () => hdChange(h.id)], ['Not a PH', () => hdReject(h.id)]] }));
  });
});

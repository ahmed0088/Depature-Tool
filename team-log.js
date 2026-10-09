// ═══════════════════════════════════════════════════════════
//  team-log.js — 📜 the team's history
//  Everything that happens to the team is written down as it happens:
//  weeks posted, wishes granted, PH days given, sick and leave, people
//  joining and leaving, swaps, moves between hotels, meetings, public
//  holidays accepted. When a week is posted you're told which wishes
//  were granted. Each person's card shows their history; the builder
//  shows the whole team's, with filters.
//  Firebase: roster/log/{id} = { t, at, by, date, key?, keys?, text }
// ═══════════════════════════════════════════════════════════

let tlAll = {};
const TL_TYPES = {
  posted: ['📤', 'Week posted'], wish: ['💛', 'Wish granted'], ph: ['🏖', 'PH given'], leave: ['🤒', 'Sick / leave'],
  joined: ['👋', 'Joined'], left: ['🚪', 'Left'], swap: ['🔁', 'Swap'], moved: ['🏨', 'Other hotel'], meeting: ['📅', 'Meeting / training'],
  holiday: ['🎉', 'Public holiday'], change: ['✏️', 'Roster changed'], note: ['📝', 'Note'],
};

function _tlName(k) { return ((typeof roStaff !== 'undefined' && roStaff[k]) || {}).name || k; }
function _tlMe() { return (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || ''; }
/** Write one line of history. Same thing twice (same id) is written once. */
function tlLog(t, o) {
  o = o || {};
  const id = o.id ? String(o.id).replace(/[.#$/[\]]/g, '_').slice(0, 120) : 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const e = { t, at: Date.now(), by: _tlMe(), date: o.date || (typeof roToday === 'function' ? roToday() : ''), text: String(o.text || '').slice(0, 400) };
  if (o.key) e.key = o.key;
  if (o.keys && o.keys.length) e.keys = o.keys.slice(0, 20);
  if (o.week) e.week = o.week;
  tlAll[id] = e;
  try { if (typeof fbSet === 'function') fbSet('roster/log/' + id, e); } catch (_) {}
  return id;
}
function tlList(f) { return Object.entries(tlAll || {}).map(([id, e]) => Object.assign({ id }, e)).filter(e => e && e.t && (!f || f(e))).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.at - a.at); }
function tlOf(k) { return tlList(e => e.key === k || (e.keys || []).includes(k)); }

/** A week is posted: write down what it gave each person, and say which wishes were granted. */
function tlWeekPosted(week, cells) {
  if (typeof rbInput !== 'function') return;
  const keep = rbWeek; rbWeek = week;
  let I; try { I = rbInput(1); } finally { rbWeek = keep; }
  const dates = Array.from({ length: 7 }, (_, d) => roAdd(week, d)), granted = [];
  I.people.forEach(p => {
    if (!cells[p.key]) return;
    // wishes granted (and the ones that weren't, so the history is honest)
    const W = typeof rbWishes === 'function' ? rbWishes(I, p, cells, dates) : [];
    const ok = W.filter(w => w.ok).map(w => w.t), no = W.filter(w => !w.ok).map(w => w.t);
    if (ok.length) { granted.push({ k: p.key, ok }); tlLog('wish', { id: `wish:${week}:${p.key}`, key: p.key, week, date: week, text: `${ok.join(', ')}${no.length ? ` · not this week: ${no.join(', ')}` : ''}` }); }
    // PH days given and days at another hotel
    dates.forEach(dt => {
      const v = (cells[p.key] || {})[dt] || '';
      if (/^PH\b/i.test(v)) tlLog('ph', { id: `ph:${dt}:${p.key}`, key: p.key, week, date: dt, text: `${v} on ${roDayLbl(dt)}` });
      const x = rbParse(v); if (x && x.note && typeof rbAt === 'function') { const at = rbBaseGroup(rbAt(I, p, x)); if (at !== rbBaseGroup(p.group)) tlLog('moved', { id: `mv:${dt}:${p.key}`, key: p.key, week, date: dt, text: `${rbNorm(v)} at ${at} on ${roDayLbl(dt)}` }); }
    });
  });
  if (typeof evList === 'function') evList().filter(e => evDays(e).some(d => dates.includes(d))).forEach(e => tlLog('meeting', { id: `ev:${e.id}`, keys: e.keys || [], week, date: e.date, text: `${e.title} · ${roDayLbl(e.date)} ${evTime(e)}${e.where ? ' · ' + e.where : ''}` }));
  const n = granted.reduce((t, g) => t + g.ok.length, 0);
  tlLog('posted', { id: `posted:${week}`, week, date: week, text: `Week of ${roDayLbl(week)} posted${n ? ` · ${n} wish${n === 1 ? '' : 'es'} granted for ${granted.length} ${granted.length === 1 ? 'person' : 'people'}` : ''}` });
  if (granted.length) tlTellWishes(week, granted);
}
/** 💛 Tell the person posting which wishes the week grants (and keep it in Ops Brain for the day). */
function tlTellWishes(week, granted) {
  const lines = granted.map(g => `${_tlName(g.k).split(' ')[0]}: ${g.ok.join(', ')}`);
  _tlNews = { week, at: Date.now(), lines };
  const n = granted.reduce((t, g) => t + g.ok.length, 0);
  if (typeof showToast === 'function') showToast(`💛 ${n} wish${n === 1 ? '' : 'es'} granted this week: ${lines.slice(0, 3).join(' · ')}${lines.length > 3 ? ` · +${lines.length - 3} more` : ''}`, 'ok');
}
let _tlNews = null;

// ── Screens ───────────────────────────────────────────────
function tlRow(e, withName) {
  const [ico, lbl] = TL_TYPES[e.t] || ['•', e.t];
  const who = withName ? (e.key ? _tlName(e.key) : (e.keys || []).map(k => _tlName(k).split(' ')[0]).join(', ')) : '';
  return `<div class="tl-row tl-${escapeHtml(e.t)}"><span class="tl-ico">${ico}</span><div class="tl-m"><b>${escapeHtml(lbl)}${who ? ' · ' + escapeHtml(who) : ''}</b><span>${escapeHtml(e.text || '')}</span></div><small class="tl-d">${escapeHtml(e.date ? roDayLbl(e.date) : '')}${e.by ? '<br>' + escapeHtml(e.by.split(' ')[0]) : ''}</small></div>`;
}
/** On a person's card: their history, newest first, with a count of wishes granted. */
function tlPersonHtml(k) {
  const L = tlOf(k); if (!L.length) return '';
  const wishes = L.filter(e => e.t === 'wish').length, ph = L.filter(e => e.t === 'ph').length;
  return `<details class="tl-card"><summary>📜 History <small>${L.length} entr${L.length === 1 ? 'y' : 'ies'}${wishes ? ` · 💛 wishes granted ${wishes} week${wishes === 1 ? '' : 's'}` : ''}${ph ? ` · 🏖 ${ph} PH` : ''}</small></summary>
    <div class="tl-list">${L.slice(0, 60).map(e => tlRow(e, false)).join('')}</div></details>`;
}
let _tlF = 'all', _tlQ = '';
/** In the builder: the whole team's history, filtered by kind and searched by name. */
function tlTeamHtml() {
  const L = tlList(e => (_tlF === 'all' || e.t === _tlF) && (!_tlQ || `${_tlName(e.key || '')} ${(e.keys || []).map(_tlName).join(' ')} ${e.text}`.toLowerCase().includes(_tlQ)));
  const kinds = ['all'].concat(Object.keys(TL_TYPES).filter(t => tlList(e => e.t === t).length));
  return `<div class="tl-team" id="tlTeam">
    <div class="tl-filters">${kinds.map(t => `<button class="rb-opt${_tlF === t ? ' on' : ''}" onclick="_tlF='${t}';tlTeamRefresh()">${t === 'all' ? 'All' : TL_TYPES[t][0] + ' ' + TL_TYPES[t][1]}</button>`).join('')}<input class="tl-q" placeholder="Search a name…" value="${escapeHtml(_tlQ)}" oninput="_tlQ=this.value.toLowerCase().trim();tlTeamRefresh(true)"></div>
    ${L.length ? `<div class="tl-list">${L.slice(0, 150).map(e => tlRow(e, true)).join('')}</div>${L.length > 150 ? `<small class="ro-hint">Showing the newest 150 of ${L.length}.</small>` : ''}` : '<div class="ro-empty">Nothing yet. From now on everything is written here as it happens: weeks posted, wishes granted, PH, sick and leave, swaps, people joining and leaving.</div>'}
  </div>`;
}
function tlTeamRefresh(keepFocus) {
  const el = document.getElementById('tlTeam'); if (!el) return;
  const pos = keepFocus ? (document.activeElement && document.activeElement.selectionStart) : null;
  el.outerHTML = tlTeamHtml();
  if (keepFocus) { const q = document.querySelector('#tlTeam .tl-q'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (_) {} } }
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => { if (typeof fbListen === 'function') fbListen('roster/log', v => { tlAll = v || {}; }); }, 1900);
  (window.BL_THINKERS = window.BL_THINKERS || []).push(add => {
    if (!_tlNews || Date.now() - _tlNews.at > 24 * 3600e3) return;
    add({ id: 'wishes:' + _tlNews.week, type: 'roster', icon: '💛', tone: 'idle', silent: true, text: `Wishes granted in the week of ${roDayLbl(_tlNews.week)}: ${_tlNews.lines.join(' · ')}`, why: 'Written in each person\'s history (📜 on their card).' });
  });
});

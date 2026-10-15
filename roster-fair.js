// ═══════════════════════════════════════════════════════════
//  roster-fair.js — ⚖️ Monthly fairness report
//
//  For one month of the roster (this month first; ‹ › for others), per
//  person, grouped by hotel, with their title: shifts worked, nights,
//  weekend shifts, PH days worked, days off, mornings and afternoons, and
//  a marker when someone is well above or below the others with the same
//  title. Bars, sort by any column, copy as text or CSV.
//
//  Reads only: roDays / roStaff / roInfo (roster.js), rbTitle and
//  rbHolidays (roster-build.js) when they are loaded. Saves nothing to the
//  database (the weekend choice is kept on this device only).
//  Opened from "⚖️ Fairness" on the Roster page, or rfOpen().
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';

const RF_WK = {
  satsun: { label: 'Sat + Sun', days: [6, 0] },
  frisat: { label: 'Fri + Sat', days: [5, 6] },
  frisun: { label: 'Fri – Sun', days: [5, 6, 0] },
};
const RF_COLS = [
  ['worked', 'Worked', 'Shifts worked'],
  ['nights', 'Nights', 'Night shifts'],
  ['weekend', 'Weekend', 'Shifts worked on the weekend'],
  ['ph', 'PH worked', 'Public holidays worked'],
  ['off', 'Days off', 'Days off (OFF, rest day)'],
  ['morning', 'Mornings', 'Morning shifts'],
  ['afternoon', 'Afternoons', 'Afternoon and evening shifts'],
];
// what counts as "well above / below the others with the same title": 40% off the average and at least 2 days
const RF_FAR = (v, avg) => Math.abs(v - avg) >= 2 && (avg === 0 ? v >= 2 : Math.abs(v - avg) / avg >= 0.4);

let rfMonth = '', rfSort = { col: '', dir: 1 };
const _ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (_) { return null; } return null; };
function rfWkKey() { const v = _ls('roster_fair_weekend_v1'); return RF_WK[v] ? v : 'satsun'; }
const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const thisMonth = () => (typeof roToday === 'function' ? roToday() : iso(new Date())).slice(0, 7);
function monthDates(m) { const [y, mo] = m.split('-').map(Number), n = new Date(y, mo, 0).getDate(); return Array.from({ length: n }, (_, i) => `${m}-${String(i + 1).padStart(2, '0')}`); }
function monthLbl(m) { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); }
function shiftMonth(m, n) { const [y, mo] = m.split('-').map(Number), d = new Date(y, mo - 1 + n, 1); return iso(d).slice(0, 7); }
function titleOf(k) {
  const t = (typeof rbTitle === 'function' && rbTitle(k)) || ((typeof roStaff !== 'undefined' && roStaff[k]) || {}).title || '';
  return String(t).trim();
}

/** Everyone's numbers for one month: { rows, dates, withRoster, hols } */
function rfData(m) {
  const dates = monthDates(m), wk = RF_WK[rfWkKey()].days;
  let hols = {}; try { hols = typeof rbHolidays === 'function' ? rbHolidays() || {} : {}; } catch (_) { hols = {}; }
  const D = typeof roDays !== 'undefined' ? roDays : {}, S = typeof roStaff !== 'undefined' ? roStaff : {};
  const by = {}; let withRoster = 0;
  dates.forEach(dt => {
    const day = D[dt]; if (!day || !Object.keys(day).length) return;
    withRoster++;
    const dow = new Date(+dt.slice(0, 4), +dt.slice(5, 7) - 1, +dt.slice(8, 10)).getDay();
    Object.keys(day).forEach(k => {
      const v = day[k]; if (!v) return;
      const i = typeof roInfo === 'function' ? roInfo(v) : null; if (!i) return;
      const r = by[k] || (by[k] = { key: k, days: 0, worked: 0, nights: 0, weekend: 0, ph: 0, off: 0, morning: 0, afternoon: 0, leave: 0, phDates: [] });
      r.days++;
      const work = i.type === 'morning' || i.type === 'afternoon' || i.type === 'night' || (typeof rbParse === 'function' && !!rbParse(v));
      if (work) {
        r.worked++;
        if (i.type === 'night') r.nights++; else if (i.type === 'morning') r.morning++; else if (i.type === 'afternoon') r.afternoon++;
        if (wk.includes(dow)) r.weekend++;
        if (hols[dt] != null) { r.ph++; r.phDates.push(dt); }
      } else if (i.type === 'off') r.off++;
      else if (i.type === 'leave') r.leave++;
    });
  });
  const rows = Object.values(by).map(r => Object.assign(r, {
    name: (S[r.key] || {}).name || r.key, group: (S[r.key] || {}).group || '', order: (S[r.key] || {}).order ?? 999, title: titleOf(r.key),
  }));
  // the marker: against the others with the same title (all hotels), only people with most of the month in the roster
  const peers = {};
  rows.forEach(r => { if (r.days >= Math.min(14, withRoster * 0.6)) (peers[r.title || '·'] = peers[r.title || '·'] || []).push(r); });
  rows.forEach(r => {
    r.flags = []; r.avg = {};
    const P = peers[r.title || '·'] || [];
    if (P.length < 2 || !P.includes(r)) { r.noPeers = true; return; }
    RF_COLS.forEach(([c]) => { r.avg[c] = P.reduce((t, x) => t + x[c], 0) / P.length; });
    const f = (c, v, up, dn, hotUp) => { const a = r.avg[c]; if (!RF_FAR(v, a)) return; r.flags.push({ c, hot: v > a ? hotUp : !hotUp, txt: v > a ? up : dn }); };
    f('nights', r.nights, 'more nights', 'fewer nights', true);
    f('weekend', r.weekend, 'more weekends', 'fewer weekends', true);
    f('ph', r.ph, 'more PH worked', 'fewer PH worked', true);
    f('off', r.off, 'more days off', 'fewer days off', false);
  });
  return { rows, dates, withRoster, hols };
}

function rfSorted(rows) {
  const c = rfSort.col, dir = rfSort.dir;
  const groups = [...new Set(rows.map(r => r.group))].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b));
  return groups.map(g => ({ g, rows: rows.filter(r => r.group === g).sort((a, b) => {
    if (c === 'name') return dir * a.name.localeCompare(b.name);
    if (c === 'fair') return dir * (b.flags.length - a.flags.length) || a.name.localeCompare(b.name);
    if (c) return dir * (b[c] - a[c]) || a.name.localeCompare(b.name);
    return a.order - b.order || a.name.localeCompare(b.name);
  }) }));
}

const CSS = `
.rf-ov{position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.55);display:flex;align-items:flex-start;justify-content:center;padding:24px 16px;overflow-y:auto}
.rf-box{background:var(--card);color:var(--text);border:1px solid var(--border2);border-radius:var(--r,14px);width:100%;max-width:1080px;box-shadow:0 20px 60px rgba(0,0,0,.35);display:flex;flex-direction:column;min-width:0}
.rf-hd{display:flex;align-items:center;gap:10px;padding:16px 18px 10px;flex-wrap:wrap}
.rf-hd h3{margin:0;font-size:17px;font-weight:700;flex:1;min-width:180px}
.rf-hd h3 small{display:block;font-size:12px;font-weight:400;color:var(--text3);margin-top:2px}
.rf-x{background:none;border:1px solid var(--border);color:var(--text2);border-radius:8px;width:34px;height:34px;font-size:16px;cursor:pointer}
.rf-bar{display:flex;align-items:center;gap:8px;padding:0 18px 12px;flex-wrap:wrap}
.rf-mon{display:flex;align-items:center;gap:6px}
.rf-mon b{min-width:128px;text-align:center;font-size:14px}
.rf-seg{display:inline-flex;border:1px solid var(--border);border-radius:9px;overflow:hidden}
.rf-seg button{background:none;border:0;color:var(--text2);padding:6px 9px;font-size:12px;cursor:pointer}
.rf-seg button.on{background:var(--card2);color:var(--text);font-weight:650}
.rf-seg-l{font-size:12px;color:var(--text3)}
.rf-sp{flex:1}
.rf-grp{display:flex;align-items:center;gap:8px;flex-wrap:nowrap}
.rf-body{padding:0 18px 16px;min-width:0}
.rf-scroll{overflow-x:auto;border:1px solid var(--border);border-radius:10px;-webkit-overflow-scrolling:touch}
.rf-t{border-collapse:separate;border-spacing:0;width:100%;font-size:13px}
.rf-t th{position:sticky;top:0;background:var(--card2);color:var(--text2);font-size:11.5px;font-weight:650;text-align:left;padding:8px 8px;border-bottom:1px solid var(--border);white-space:nowrap;cursor:pointer;user-select:none}
.rf-t th.on{color:var(--gold,var(--amber,#d97706))}
.rf-t td{padding:7px 8px;border-bottom:1px solid var(--border);vertical-align:middle;white-space:nowrap}
.rf-t tr:last-child td{border-bottom:0}
.rf-t .rf-nm{position:sticky;left:0;background:var(--card);z-index:1;min-width:130px;max-width:190px;white-space:normal}
.rf-t th.rf-nm{background:var(--card2);z-index:2}
.rf-nm b{display:block;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis}
.rf-nm i{font-style:normal;font-size:11px;color:var(--text3)}
.rf-sec td{background:var(--bg2);font-size:12px;font-weight:700;color:var(--text2);letter-spacing:.03em;padding:6px 8px}
.rf-sec td.rf-nm{background:var(--bg2)}
.rf-c{display:flex;align-items:center;gap:6px;min-width:66px}
.rf-c em{font:600 13px var(--mono);color:var(--text);font-style:normal;min-width:18px;text-align:right}
.rf-c s{display:block;height:6px;border-radius:3px;background:var(--border);flex:1;min-width:30px;max-width:70px;text-decoration:none;position:relative;overflow:hidden}
.rf-c s i{position:absolute;inset:0 auto 0 0;background:color-mix(in srgb,var(--text3) 70%,transparent);border-radius:3px}
.rf-c.hot s i{background:var(--gold,var(--amber,#d97706))}.rf-c.hot em{color:var(--gold,var(--amber,#d97706))}
.rf-c.lite s i{background:var(--green)}
.rf-f{display:flex;gap:4px;flex-wrap:wrap}
.rf-f span{font-size:11px;padding:2px 7px;border-radius:20px;border:1px solid var(--border);color:var(--text2);white-space:nowrap}
.rf-f span.hot{border-color:color-mix(in srgb,var(--gold,var(--amber,#d97706)) 55%,transparent);color:var(--gold,var(--amber,#d97706));background:color-mix(in srgb,var(--gold,var(--amber,#d97706)) 10%,transparent)}
.rf-f span.lite{border-color:color-mix(in srgb,var(--green) 45%,transparent);color:var(--green)}
.rf-f span.ok{color:var(--text3)}
.rf-note{font-size:12px;color:var(--text3);margin-top:10px;line-height:1.5}
.rf-empty{padding:28px 10px;text-align:center;color:var(--text3);font-size:14px}
@media(max-width:640px){
  .rf-ov{padding:0}
  .rf-box{border-radius:0;min-height:100%;border:0}
  .rf-hd{padding:14px 16px 8px}.rf-bar{padding:0 16px 10px}.rf-body{padding:0 16px 16px}
  .rf-mon b{min-width:110px}
  .rf-sp{display:none}
  .rf-t .rf-nm{min-width:108px;max-width:130px}
  .rf-c s{display:none}.rf-c{min-width:34px}
}`;

function cell(r, c, max) {
  const fl = r.flags.find(x => x.c === c), w = max ? Math.round(r[c] / max * 100) : 0;
  const tip = r.avg[c] != null ? ` title="${esc(`${r[c]} · average for ${r.title || 'no title'}: ${(Math.round(r.avg[c] * 10) / 10)}`)}"` : '';
  return `<div class="rf-c${fl ? (fl.hot ? ' hot' : ' lite') : ''}"${tip}><em>${r[c]}</em><s><i style="width:${w}%"></i></s></div>`;
}
function fairCell(r) {
  if (r.noPeers) return `<div class="rf-f"><span class="ok" title="Nobody else with the same title, or only part of the month in the roster">–</span></div>`;
  if (!r.flags.length) return '<div class="rf-f"><span class="ok">✓ even</span></div>';
  return `<div class="rf-f">${r.flags.map(f => `<span class="${f.hot ? 'hot' : 'lite'}">${f.hot ? '▲' : '▼'} ${esc(f.txt)}</span>`).join('')}</div>`;
}

function rfRender() {
  const box = document.getElementById('rfBox'); if (!box) return;
  const m = rfMonth || (rfMonth = thisMonth()), wkK = rfWkKey(), data = rfData(m), G = rfSorted(data.rows);
  const max = {}; RF_COLS.forEach(([c]) => { max[c] = Math.max(1, ...data.rows.map(r => r[c])); });
  const th = (c, lbl, tip, cls) => `<th class="${cls || ''}${rfSort.col === c ? ' on' : ''}" title="${esc(tip || 'Sort')}" onclick="rfSortBy('${c}')">${esc(lbl)}${rfSort.col === c ? (rfSort.dir > 0 ? ' ↓' : ' ↑') : ''}</th>`;
  const many = G.length > 1 || (G[0] && G[0].g);
  const hols = Object.keys(data.hols).filter(d => d.slice(0, 7) === m).length;
  box.innerHTML = `
    <div class="rf-hd"><h3>⚖️ Monthly fairness<small>Who did the nights, weekends and holidays, against others with the same title</small></h3><button class="rf-x" onclick="rfClose()" aria-label="Close">✕</button></div>
    <div class="rf-bar">
      <div class="rf-mon"><button class="btn sm" onclick="rfGo(-1)" title="Previous month">‹</button><b>${esc(monthLbl(m))}</b><button class="btn sm" onclick="rfGo(1)" title="Next month">›</button>${m !== thisMonth() ? '<button class="btn sm ghost" onclick="rfGo(0)">This month</button>' : ''}</div>
      <span class="rf-sp"></span>
      <div class="rf-grp"><span class="rf-seg-l">Weekend</span><div class="rf-seg">${Object.keys(RF_WK).map(k => `<button class="${k === wkK ? 'on' : ''}" onclick="rfSetWk('${k}')">${esc(RF_WK[k].label)}</button>`).join('')}</div></div>
      <div class="rf-grp"><button class="btn sm" onclick="rfCopy('text')" ${data.rows.length ? '' : 'disabled'}>⧉ Copy text</button><button class="btn sm" onclick="rfCopy('csv')" ${data.rows.length ? '' : 'disabled'}>⧉ Copy CSV</button></div>
    </div>
    <div class="rf-body">${data.rows.length ? `<div class="rf-scroll"><table class="rf-t">
      <thead><tr>${th('name', 'Name', 'Sort by name', 'rf-nm')}${RF_COLS.map(([c, l, t]) => th(c, l, t)).join('')}${th('fair', 'Fair?', 'Well above or below others with the same title')}</tr></thead>
      <tbody>${G.map(({ g, rows }) => (many ? `<tr class="rf-sec"><td class="rf-nm">${esc(g || 'No hotel set')}</td><td colspan="${RF_COLS.length + 1}"></td></tr>` : '') + rows.map(r => `<tr>
        <td class="rf-nm"><b title="${esc(r.name)}">${esc(r.name)}</b><i>${esc(r.title || 'No title')}${r.leave ? ` · ${r.leave} leave` : ''}</i></td>
        ${RF_COLS.map(([c]) => `<td>${cell(r, c, max[c])}</td>`).join('')}<td>${fairCell(r)}</td></tr>`).join('')).join('')}</tbody>
    </table></div>
    <div class="rf-note">${data.withRoster} of ${data.dates.length} days of ${esc(monthLbl(m))} are in the roster${data.withRoster < data.dates.length ? ' (the rest is not posted yet)' : ''}. Weekend = ${esc(RF_WK[wkK].label)}. ${hols ? `${hols} public holiday${hols === 1 ? '' : 's'} this month.` : 'No public holiday this month.'}
      ▲ / ▼ = well above or below the average for the same title (at least 2 days and 40% apart). People with only part of the month in the roster are not compared. Tap a column to sort.</div>`
      : `<div class="rf-empty">No roster for ${esc(monthLbl(m))} yet.</div>`}</div>`;
}

function rfText(kind) {
  const data = rfData(rfMonth || thisMonth()), G = rfSorted(data.rows), wk = RF_WK[rfWkKey()].label;
  const flags = r => r.noPeers ? '' : r.flags.length ? r.flags.map(f => (f.hot ? '▲ ' : '▼ ') + f.txt).join('; ') : 'even';
  if (kind === 'csv') {
    const q = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const head = ['Hotel', 'Name', 'Title', ...RF_COLS.map(c => c[1] + (c[0] === 'weekend' ? ` (${wk})` : '')), 'Leave', 'Fair?'];
    return [head.map(q).join(',')].concat(...G.map(({ g, rows }) => rows.map(r => [g, r.name, r.title, ...RF_COLS.map(([c]) => r[c]), r.leave, flags(r)].map(q).join(',')))).join('\n');
  }
  const out = [`Monthly fairness · ${monthLbl(rfMonth || thisMonth())} (weekend ${wk})`];
  G.forEach(({ g, rows }) => {
    out.push('', g || 'No hotel set');
    rows.forEach(r => out.push(`• ${r.name}${r.title ? ' (' + r.title + ')' : ''}: ${r.worked} worked, ${r.nights} nights, ${r.weekend} weekend, ${r.ph} PH worked, ${r.off} days off, ${r.morning} mornings, ${r.afternoon} afternoons${flags(r) && flags(r) !== 'even' ? ' · ' + flags(r) : ''}`));
  });
  return out.join('\n');
}
function rfCopy(kind) {
  const t = rfText(kind), ok = () => { if (typeof showToast === 'function') showToast(kind === 'csv' ? 'Copied as CSV: paste it into Excel' : 'Copied: paste it into WhatsApp or an email', 'ok'); };
  const fallback = () => { const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); ok(); } catch (_) { if (typeof showToast === 'function') showToast('Could not copy', 'err'); } ta.remove(); };
  try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, fallback); else fallback(); } catch (_) { fallback(); }
}

function rfOpen(month) {
  mount();
  if (month && /^\d{4}-\d{2}$/.test(month)) rfMonth = month; else if (!rfMonth) rfMonth = thisMonth();
  let ov = document.getElementById('rfOv');
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'rfOv'; ov.className = 'rf-ov';
    ov.innerHTML = '<div class="rf-box" id="rfBox" role="dialog" aria-modal="true" aria-label="Monthly fairness"></div>';
    ov.addEventListener('click', e => { if (e.target === ov) rfClose(); });
    document.body.appendChild(ov);
    document.addEventListener('keydown', rfKey);
  }
  rfRender();
}
function rfKey(e) { if (e.key === 'Escape') rfClose(); }
function rfClose() { const ov = document.getElementById('rfOv'); if (ov) ov.remove(); document.removeEventListener('keydown', rfKey); }
function rfGo(n) { rfMonth = n === 0 ? thisMonth() : shiftMonth(rfMonth || thisMonth(), n); rfRender(); }
function rfSetWk(k) { if (RF_WK[k]) _ls('roster_fair_weekend_v1', k); rfRender(); }
function rfSortBy(c) { if (rfSort.col === c) { if (rfSort.dir === 1) rfSort.dir = -1; else rfSort = { col: '', dir: 1 }; } else rfSort = { col: c, dir: 1 }; rfRender(); }

function mount() {
  if (!document.getElementById('rf-style')) { const st = document.createElement('style'); st.id = 'rf-style'; st.textContent = CSS; document.head.appendChild(st); }
  if (!document.getElementById('roFairBtn')) {
    const anchor = document.getElementById('roSwapBtn') || document.getElementById('roWhatBtn') || document.getElementById('roBuildBtn');
    if (anchor && anchor.parentNode) {
      const b = document.createElement('button'); b.className = 'btn'; b.id = 'roFairBtn'; b.type = 'button'; b.textContent = '⚖️ Fairness';
      b.title = 'Monthly fairness: nights, weekends and holidays per person';
      b.onclick = () => rfOpen();
      b.hidden = !(typeof roCanEdit === 'function' && roCanEdit());
      anchor.parentNode.insertBefore(b, anchor.nextSibling);
    }
  }
}

Object.assign(window, { rfOpen, rfClose, rfGo, rfSetWk, rfSortBy, rfCopy, rfData, rfText });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
// roCanEdit() depends on the signed-in role, known a little after load: show the button once it is
setTimeout(() => { const b = document.getElementById('roFairBtn'); if (b && typeof roCanEdit === 'function') b.hidden = !roCanEdit(); }, 2500);
})();

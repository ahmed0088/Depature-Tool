// ═══════════════════════════════════════════════════════════
//  neorcha.js — Neorcha Guest Documents → HotelOps
//
//  Neorcha (ibis.myneorcha.com → Guest Documents) holds the registration cards guests fill at check-in: their
//  purpose of visit, nationality and loyalty membership. Export → CSV (All) from Neorcha, drop the file here:
//  the month at a glance (registrations, purposes, nationalities, ALL members, who checked guests in) and one tap
//  links it to Purpose of Stay — the purpose the guest gave, and the nationality where it is still empty.
//  Columns are found by their names. Passport / ID numbers, birth dates, emails, phones and addresses are never
//  read: they are dropped while the file is read and never stored.
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';
const W = window, PANEL = 'neorcha', LS = 'ho_neorcha_v1';

// the columns kept, found by their names (Neorcha's own labels)
const COLS = [
  ['conf', /confirmation/i], ['first', /first\s*name/i], ['last', /last\s*name/i], ['name', /^(guest\s*)?name$|full\s*name/i],
  ['nat', /nationality/i], ['purpose', /purpose/i], ['arr', /^arrival(\s*date)?$|arrival\s*date(?!.*hijri)/i], ['dep', /^departure(\s*date)?$|departure\s*date(?!.*hijri)/i],
  ['room', /room\s*(number|no\.?|#)?$/i], ['adults', /adult/i], ['children', /child/i], ['member', /membership\s*(number|no|#)|loyalty\s*(number|no)|card\s*number/i],
  ['mtype', /membership\s*type|loyalty\s*(type|program)/i], ['by', /checked\s*in\s*by|operator|^agent$|^user$/i], ['doc', /^document\s*type|^type$/i],
  ['company', /company/i], ['at', /insertion|insert\s*date|created|creation/i], ['source', /^source$|platform/i],
];
// never read (sensitive): checked first, a column like this is skipped even if a kept name also matches
const NEVER = /passport|birth|e-?mail|phone|mobile|document\s*number|id\s*number|\bno\s*uae\b|address|city|zip|postal|car\s*reg|signature|card\s*(holder|expir)|iban/i;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (m, t) => { if (typeof showToast === 'function') showToast(m, t); };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── reading ─────────────────────────────────────────────────
/** a date cell → "YYYY-MM-DD" ("01-10-2026", "1-Oct-2026", "2026-10-01", Excel day number) */
function isoOf(v) {
  if (v instanceof Date && !isNaN(v)) return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  if (typeof v === 'number' && v > 20000 && v < 80000) { const t = new Date(Math.round((v - 25569) * 864e5)); return t.toISOString().slice(0, 10); }
  const s = String(v || '').trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  if ((m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s,]+(\d{2,4})/))) { const mi = MON.findIndex(x => x.toLowerCase() === m[2].toLowerCase()); if (mi >= 0) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + String(mi + 1).padStart(2, '0') + '-' + m[1].padStart(2, '0'); }
  return '';
}
/** "AE" → "United Arab Emirates" (a nationality given as a 2-letter code) */
function natName(v) {
  const s = String(v || '').trim();
  if (/^[A-Za-z]{2}$/.test(s)) { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(s.toUpperCase()) || s; } catch (_) { return s; } }
  return s;
}
/** the guest's purpose of visit → Purpose of Stay's words (Business / Leisure / Flight), '' when it says nothing clear */
function purposeOf(v) {
  const s = String(v || '').toLowerCase();
  if (!s.trim()) return '';
  if (/transit|flight|crew|airline|layover|stop\s*over/.test(s)) return 'Flight';
  if (/business|work|conference|meeting|corporate|training|exhibition|mice|official/.test(s)) return 'Business';
  if (/leisure|holiday|vacation|tourism|tourist|family|personal|visit|shopping|honeymoon|pleasure|medical|religio|event|sport|study/.test(s)) return 'Leisure';
  return '';
}
/** rows of cells → { rows: [...kept fields only], cols: [{f, h}], skipped: n } */
function parseAoa(aoa) {
  aoa = (aoa || []).map(r => (r || []).map(c => (c == null ? '' : c)));
  const hi = aoa.findIndex(r => r.some(c => /confirmation/i.test(String(c))) && r.some(c => /first\s*name|last\s*name|nationality|room/i.test(String(c))));
  if (hi < 0) return null;
  const head = aoa[hi].map(h => String(h).replace(/\s+/g, ' ').trim()), map = {};
  head.forEach((h, i) => { if (!h || NEVER.test(h)) return; const k = COLS.find(([f, re]) => map[f] === undefined && re.test(h)); if (k) map[k[0]] = i; });
  if (map.conf === undefined && map.room === undefined) return null;
  const cell = (r, f) => (map[f] === undefined ? '' : String(r[map[f]] == null ? '' : r[map[f]]).trim());
  const rows = []; let skipped = 0;
  aoa.slice(hi + 1).forEach(r => {
    if (!r.some(c => String(c).trim())) return;
    const conf = cell(r, 'conf').replace(/\.0+$/, ''), room = cell(r, 'room').replace(/\.0+$/, '');
    const name = [cell(r, 'first'), cell(r, 'last')].filter(Boolean).join(' ') || cell(r, 'name');
    if (!conf && !room && !name) { skipped++; return; }
    const pv = cell(r, 'purpose');
    rows.push({ conf, room, name, nat: natName(cell(r, 'nat')), purposeRaw: pv, purpose: purposeOf(pv), arr: isoOf(map.arr === undefined ? '' : r[map.arr]), dep: isoOf(map.dep === undefined ? '' : r[map.dep]),
      adults: parseInt(cell(r, 'adults'), 10) || 0, children: parseInt(cell(r, 'children'), 10) || 0,
      member: !!cell(r, 'member').replace(/^[-0\s]+$/, ''), mtype: cell(r, 'mtype'), by: cell(r, 'by'), doc: cell(r, 'doc'), company: cell(r, 'company'), at: isoOf(map.at === undefined ? '' : r[map.at]) });
  });
  return { rows, cols: Object.keys(map).map(f => ({ f, h: head[map[f]] })), skipped };
}
/** the month at a glance (pure) */
function summary(rows) {
  const cnt = (f, val) => { const o = {}; rows.forEach(r => { const k = val(r); if (k) o[k] = (o[k] || 0) + 1; }); return Object.entries(o).sort((a, b) => b[1] - a[1]); };
  const staff = {}; rows.forEach(r => { const k = r.by || '—'; const s = staff[k] = staff[k] || { n: 0, members: 0 }; s.n++; if (r.member) s.members++; });
  const days = cnt('day', r => r.arr);
  return { n: rows.length, guests: rows.reduce((a, r) => a + (r.adults + r.children || 1), 0), members: rows.filter(r => r.member).length,
    purposes: cnt('p', r => r.purpose || (r.purposeRaw ? 'Other' : 'Not given')), nats: cnt('n', r => r.nat), mtypes: cnt('t', r => r.member ? (r.mtype || 'Member') : ''),
    staff: Object.entries(staff).map(([by, s]) => ({ by, n: s.n, members: s.members })).sort((a, b) => b.n - a.n), days: days.sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    from: days.length ? days.map(d => d[0]).sort()[0] : '', to: days.length ? days.map(d => d[0]).sort().pop() : '' };
}
// ── linking to Purpose of Stay ──────────────────────────────
const digits = s => String(s || '').replace(/\D/g, '');
const roomKey = s => String(s || '').replace(/^0+/, '').trim().toUpperCase();
const words = s => String(s || '').toLowerCase().replace(/\b(mr|mrs|ms|miss|dr)\b\.?/g, ' ').split(/[^a-zÀ-ɏ]+/).filter(w => w.length > 1);
function sameGuest(a, b) { const A = new Set(words(a)), B = words(b); return B.filter(w => A.has(w)).length >= Math.min(2, Math.max(1, Math.min(A.size, B.length))); }
/** what linking would change on Purpose of Stay (pure): the purpose the guest gave, the nationality where still empty */
function linkPlan(rows, guests) {
  const byConf = new Map(); rows.forEach(r => { const c = digits(r.conf); if (c) byConf.set(c, r); });
  const out = { matched: 0, purpose: [], nat: [], unmatched: 0 };
  (guests || []).forEach((g, i) => {
    let r = byConf.get(digits(g.conf));
    if (!r) r = rows.find(x => x.room && roomKey(x.room) === roomKey(g.room) && x.name && sameGuest(g.name, x.name));
    if (!r) { out.unmatched++; return; }
    out.matched++;
    if (r.purpose && r.purpose !== g.purpose) out.purpose.push({ i, room: g.room, name: g.name, from: g.purpose || '', to: r.purpose, said: r.purposeRaw });
    if (r.nat && !String(g.nat || '').trim()) out.nat.push({ i, room: g.room, name: g.name, to: r.nat });
  });
  return out;
}

// ── the page ────────────────────────────────────────────────
let S = null;
try { S = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (_) { S = null; }
const $ = id => document.getElementById('nx-' + id);
const pg = () => (typeof purposeGuests !== 'undefined' && Array.isArray(purposeGuests) ? purposeGuests : []);
async function load(file) {
  if (!file) return;
  try {
    if (typeof XLSX === 'undefined') throw new Error('The Excel reader did not load. Reload the page.');
    const wb = /\.(csv|txt)$/i.test(file.name) ? XLSX.read(await file.text(), { type: 'string', raw: true }) : XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
    let R = null;
    for (const n of wb.SheetNames) { R = parseAoa(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' })); if (R) break; }
    if (!R || !R.rows.length) { toast('No guests found in that file — export Guest Documents → Export Excel → CSV (All) from Neorcha', 'err'); return; }
    S = Object.assign(R, { file: file.name, at: Date.now() });
    try { localStorage.setItem(LS, JSON.stringify(S)); } catch (_) {}
    if (typeof logActivity === 'function') try { logActivity('neorcha_loaded', R.rows.length + ' registrations'); } catch (_) {}
    draw();
  } catch (e) { toast(e.message || 'Could not read that file', 'err'); }
}
function applyLink(kind) {
  if (!S) return;
  const P = linkPlan(S.rows, pg()), list = kind === 'nat' ? P.nat : P.purpose;
  if (!list.length) return;
  if (!confirm(kind === 'nat' ? `Fill the nationality of ${list.length} guest${list.length === 1 ? '' : 's'} on Purpose of Stay (only where it is empty)?` : `Set the purpose of ${list.length} guest${list.length === 1 ? '' : 's'} on Purpose of Stay to what they gave on their Neorcha registration card?`)) return;
  const G = pg();
  list.forEach(x => { const g = G[x.i]; if (!g) return; if (kind === 'nat') g.nat = x.to; else g.purpose = x.to; });
  try { if (typeof savePurpose === 'function') savePurpose(G); } catch (_) {}
  try { if (typeof purposeRender === 'function') purposeRender(); } catch (_) {}
  try { if (typeof addPurposeLog === 'function') addPurposeLog('Neorcha', `${list.length} ${kind === 'nat' ? 'nationalities filled' : 'purposes set'} from the registration cards`); } catch (_) {}
  toast(`✓ ${list.length} ${kind === 'nat' ? 'nationalities filled' : 'purposes set'} on Purpose of Stay`, 'ok');
  draw();
}
const bar = (n, max) => `<i style="width:${Math.max(3, Math.round(n / Math.max(1, max) * 100))}%"></i>`;
const dLbl = s => { const [y, m, d] = String(s).split('-'); return +d + ' ' + MON[+m - 1]; };
function draw() {
  const out = $('out'); if (!out) return;
  const stp = $('steps'); if (stp) stp.querySelectorAll('li').forEach(li => { const k = +li.dataset.s; li.className = !S ? (k === 1 ? 'now' : '') : k === 1 ? 'done' : 'now'; });
  if (!S) { out.innerHTML = ''; return; }
  const Y = summary(S.rows), P = linkPlan(S.rows, pg()), maxP = Math.max(1, ...Y.purposes.map(x => x[1])), maxN = Math.max(1, ...Y.nats.slice(0, 8).map(x => x[1])), maxD = Math.max(1, ...Y.days.map(x => x[1]));
  const kpi = (cls, l, v, sub) => `<div class="${cls}"><small>${l}</small><b>${v}</b><i>${sub}</i></div>`;
  out.innerHTML = `
    <div class="nx-sum">${kpi('k0', 'Registration cards', Y.n, Y.from ? dLbl(Y.from) + ' – ' + dLbl(Y.to) : esc(S.file || ''))}${kpi('k1', 'Guests', Y.guests, 'adults + children')}${kpi('k2', 'ALL members', Y.members, Y.n ? Math.round(Y.members / Y.n * 100) + '% of cards' : '')}${kpi('k3', 'Nationalities', Y.nats.length, Y.nats[0] ? 'most: ' + esc(Y.nats[0][0]) : '')}</div>
    <div class="nx-cols">Columns read: ${S.cols.map(c => `<span>${esc(c.h)}</span>`).join('')} <em>· passport, ID, birth date, email and phone are never read</em></div>
    <div class="nx-link"><div class="nx-link-h"><span>🔗</span><div><b>Link to Purpose of Stay</b><small>${pg().length ? `${P.matched} of ${pg().length} guests on Purpose of Stay found on a registration card (by confirmation no., else room + name)` : 'Load Purpose of Stay first (Front Desk → Purpose of Stay), then come back.'}</small></div></div>
      ${pg().length ? `<div class="nx-link-a">
        <div><b>${P.purpose.length}</b> purpose${P.purpose.length === 1 ? '' : 's'} to set from the guest's own card${P.purpose.length ? `<small>${P.purpose.slice(0, 4).map(x => `${esc(x.room)} ${esc(x.from || '—')} → ${esc(x.to)}`).join(' · ')}${P.purpose.length > 4 ? ' …' : ''}</small>` : ''}<button type="button" class="btn gold sm" data-nx="purpose"${P.purpose.length ? '' : ' disabled'}>Apply</button></div>
        <div><b>${P.nat.length}</b> empty nationalit${P.nat.length === 1 ? 'y' : 'ies'} to fill${P.nat.length ? `<small>${P.nat.slice(0, 4).map(x => `${esc(x.room)} → ${esc(x.to)}`).join(' · ')}${P.nat.length > 4 ? ' …' : ''}</small>` : ''}<button type="button" class="btn gold sm" data-nx="nat"${P.nat.length ? '' : ' disabled'}>Apply</button></div></div>` : ''}</div>
    <div class="nx-grid">
      <div class="nx-box"><h4>🎯 Purpose of visit</h4>${Y.purposes.map(([k, n]) => `<div class="nx-bar"><span>${esc(k)}</span>${bar(n, maxP)}<b>${n}</b></div>`).join('') || '<p class="nx-m">Not in the file</p>'}</div>
      <div class="nx-box"><h4>🌍 Top nationalities</h4>${Y.nats.slice(0, 8).map(([k, n]) => `<div class="nx-bar"><span>${esc(k)}</span>${bar(n, maxN)}<b>${n}</b></div>`).join('') || '<p class="nx-m">Not in the file</p>'}</div>
      <div class="nx-box"><h4>💎 Members & who checked guests in</h4><table class="nx-t"><thead><tr><th>Checked in by</th><th>Cards</th><th>Members</th></tr></thead><tbody>${Y.staff.slice(0, 10).map(s => `<tr><td>${esc(s.by)}</td><td>${s.n}</td><td>${s.members} <small>${s.n ? Math.round(s.members / s.n * 100) + '%' : ''}</small></td></tr>`).join('')}</tbody></table>
        ${Y.mtypes.length ? `<p class="nx-m">${Y.mtypes.slice(0, 5).map(([k, n]) => `${esc(k)} ${n}`).join(' · ')}</p>` : ''}</div>
      <div class="nx-box"><h4>📅 Cards by arrival day</h4><div class="nx-days">${Y.days.map(([d, n]) => `<div title="${dLbl(d)}: ${n}"><i style="height:${Math.max(6, Math.round(n / maxD * 100))}%"></i><span>${+d.slice(8)}</span></div>`).join('') || '<p class="nx-m">No arrival dates in the file</p>'}</div></div>
    </div>
    <details class="nx-list"><summary>All ${Y.n} registration cards</summary><div class="nx-tw"><table class="nx-t"><thead><tr><th>Room</th><th>Guest</th><th>Arrival</th><th>Nationality</th><th>Purpose</th><th>Member</th><th>By</th></tr></thead><tbody>
      ${S.rows.slice(0, 600).map(r => `<tr><td>${esc(r.room)}</td><td>${esc(r.name)}</td><td>${r.arr ? dLbl(r.arr) : ''}</td><td>${esc(r.nat)}</td><td>${esc(r.purpose || r.purposeRaw)}</td><td>${r.member ? '💎' : ''}</td><td>${esc(r.by)}</td></tr>`).join('')}</tbody></table></div></details>`;
  out.querySelectorAll('[data-nx]').forEach(b => { b.onclick = () => applyLink(b.dataset.nx); });
}
const CSS = `
#panel-${PANEL} .nx-hero{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:20px 22px;margin-bottom:14px;border-radius:18px;border:1px solid var(--border);background:radial-gradient(120% 140% at 0% 0%,rgba(99,102,241,.18),transparent 55%),radial-gradient(120% 140% at 100% 0%,rgba(20,184,166,.14),transparent 55%),var(--card)}
#panel-${PANEL} .nx-hero-ic{width:56px;height:56px;border-radius:16px;display:grid;place-items:center;font-size:28px;background:linear-gradient(135deg,#6366f1,#4338ca);box-shadow:0 10px 26px -8px rgba(67,56,202,.6);flex:none}
#panel-${PANEL} .nx-hero-t{flex:1;min-width:200px}#panel-${PANEL} .nx-hero h1{margin:0;font-size:1.55rem}#panel-${PANEL} .nx-hero p{margin:4px 0 0;color:var(--text2);font-size:.88rem}
#panel-${PANEL} .nx-steps{list-style:none;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 14px;padding:0}
#panel-${PANEL} .nx-steps li{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;border:1px solid var(--border);background:var(--card);color:var(--text3);font-size:.84rem;font-weight:600}
#panel-${PANEL} .nx-steps b{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:var(--bg2);border:1px solid var(--border2);font-size:.8rem;flex:none}
#panel-${PANEL} .nx-steps li.now{color:var(--text);border-color:color-mix(in srgb,var(--accent) 55%,var(--border))}#panel-${PANEL} .nx-steps li.now b{background:var(--accent);color:#111;border-color:var(--accent)}
#panel-${PANEL} .nx-steps li.done b{background:var(--green,#16a34a);color:#fff;border-color:transparent;font-size:0}#panel-${PANEL} .nx-steps li.done b::after{content:'✓';font-size:.85rem}
#panel-${PANEL} .nx-drop{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:18px;border:2px dashed var(--border2);border-radius:14px;background:var(--bg2)}#panel-${PANEL} .nx-drop.over{border-color:var(--accent)}
#panel-${PANEL} .nx-drop-t{flex:1 1 220px;display:flex;flex-direction:column;gap:2px}#panel-${PANEL} .nx-drop-t span{color:var(--text3);font-size:.8rem}
#panel-${PANEL} .nx-how{margin:10px 0 0;border:1px solid var(--border);border-radius:12px;background:var(--card)}#panel-${PANEL} .nx-how summary{cursor:pointer;padding:9px 14px;font-weight:600;color:var(--text2);font-size:.84rem}
#panel-${PANEL} .nx-how ol{margin:0;padding:4px 16px 12px 34px;line-height:1.8;font-size:.85rem;color:var(--text2)}
#panel-${PANEL} .nx-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:16px 0 8px}
#panel-${PANEL} .nx-sum>div{position:relative;overflow:hidden;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column}
#panel-${PANEL} .nx-sum>div::before{content:'';position:absolute;left:0;top:0;right:0;height:3px;background:var(--k)}#panel-${PANEL} .k0{--k:#6366f1}#panel-${PANEL} .k1{--k:#0ea5e9}#panel-${PANEL} .k2{--k:#d97706}#panel-${PANEL} .k3{--k:#16a34a}
#panel-${PANEL} .nx-sum small{font:700 10.5px var(--font);letter-spacing:.06em;text-transform:uppercase;color:var(--text3)}#panel-${PANEL} .nx-sum b{font-size:1.4rem;margin-top:2px}#panel-${PANEL} .nx-sum i{font-style:normal;color:var(--text3);font-size:.78rem}
#panel-${PANEL} .nx-cols{font-size:.76rem;color:var(--text3);margin:0 0 12px;display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center}#panel-${PANEL} .nx-cols span{padding:1px 7px;border-radius:99px;border:1px solid var(--border);color:var(--text2)}#panel-${PANEL} .nx-cols em{font-style:normal}
#panel-${PANEL} .nx-link{padding:14px 16px;border-radius:14px;border:1px solid color-mix(in srgb,#6366f1 35%,var(--border));background:linear-gradient(180deg,color-mix(in srgb,#6366f1 7%,var(--card)),var(--card));margin-bottom:14px}
#panel-${PANEL} .nx-link-h{display:flex;gap:12px;align-items:center}#panel-${PANEL} .nx-link-h>span{font-size:22px}#panel-${PANEL} .nx-link-h small{display:block;color:var(--text3);font-size:.8rem}
#panel-${PANEL} .nx-link-a{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-top:12px}
#panel-${PANEL} .nx-link-a>div{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:10px 12px;border-radius:12px;background:var(--bg2);border:1px solid var(--border);font-size:.86rem}
#panel-${PANEL} .nx-link-a b{font-size:1.1rem}#panel-${PANEL} .nx-link-a small{flex-basis:100%;order:3;color:var(--text3);font-size:.76rem}#panel-${PANEL} .nx-link-a .btn{margin-left:auto}
#panel-${PANEL} .nx-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
#panel-${PANEL} .nx-box{padding:14px 16px;border-radius:14px;border:1px solid var(--border);background:var(--card)}#panel-${PANEL} .nx-box h4{margin:0 0 10px;font-size:.9rem}
#panel-${PANEL} .nx-bar{display:grid;grid-template-columns:minmax(80px,140px) 1fr 40px;gap:8px;align-items:center;margin:5px 0;font-size:.82rem}#panel-${PANEL} .nx-bar span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text2)}
#panel-${PANEL} .nx-bar i{display:block;height:8px;border-radius:99px;background:linear-gradient(90deg,#818cf8,#4f46e5)}#panel-${PANEL} .nx-bar b{text-align:right;font-family:var(--mono);font-size:.8rem}
#panel-${PANEL} .nx-m{margin:8px 0 0;color:var(--text3);font-size:.8rem}
#panel-${PANEL} .nx-t{width:100%;border-collapse:collapse;font-size:.8rem}#panel-${PANEL} .nx-t th,#panel-${PANEL} .nx-t td{padding:5px 8px;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap}#panel-${PANEL} .nx-t th{font:700 10.5px var(--font);text-transform:uppercase;letter-spacing:.05em;color:var(--text3)}
#panel-${PANEL} .nx-t small{color:var(--text3)}
#panel-${PANEL} .nx-box{min-width:0;overflow:auto}#panel-${PANEL} .nx-box .nx-t{table-layout:fixed}#panel-${PANEL} .nx-box .nx-t th:first-child,#panel-${PANEL} .nx-box .nx-t td:first-child{overflow:hidden;text-overflow:ellipsis}#panel-${PANEL} .nx-box .nx-t th:not(:first-child),#panel-${PANEL} .nx-box .nx-t td:not(:first-child){width:84px;text-align:right}
#panel-${PANEL} .nx-days{display:flex;align-items:flex-end;gap:3px;height:110px}#panel-${PANEL} .nx-days>div{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;gap:3px;min-width:0}
#panel-${PANEL} .nx-days i{display:block;width:100%;border-radius:4px 4px 2px 2px;background:linear-gradient(180deg,#818cf8,#4f46e5)}#panel-${PANEL} .nx-days span{font-size:9px;color:var(--text3)}
#panel-${PANEL} .nx-list{margin-top:12px;border:1px solid var(--border);border-radius:12px;background:var(--card)}#panel-${PANEL} .nx-list summary{cursor:pointer;padding:10px 14px;font-weight:600;color:var(--text2)}#panel-${PANEL} .nx-tw{max-height:420px;overflow:auto;padding:0 10px 10px}
@media (max-width:640px){#panel-${PANEL} .nx-steps{grid-template-columns:1fr}}`;
function mount() {
  if (document.getElementById('panel-' + PANEL)) return;
  const main = document.querySelector('main.main') || document.querySelector('main'), nav = document.querySelector('nav.sidenav') || document.querySelector('nav');
  if (!main || !nav) return;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const panel = document.createElement('div'); panel.className = 'panel'; panel.id = 'panel-' + PANEL;
  panel.innerHTML = `<div style="max-width:1200px">
    <div class="nx-hero"><div class="nx-hero-ic">🪪</div><div class="nx-hero-t"><h1>Neorcha Registrations</h1><p>The registration cards from Neorcha: purpose of visit, nationality and ALL members — linked to Purpose of Stay</p></div>
      <button type="button" class="btn rose" id="nx-clear">✕ Clear</button></div>
    <ol class="nx-steps" id="nx-steps"><li data-s="1"><b>1</b><span>Export from Neorcha</span></li><li data-s="2"><b>2</b><span>See the month</span></li><li data-s="3"><b>3</b><span>Link to Purpose of Stay</span></li></ol>
    <div class="nx-drop" id="nx-drop"><div style="font-size:26px">🪪</div><div class="nx-drop-t"><b>Drop the Neorcha export here</b><span>Guest Documents → Export Excel → CSV (All) · .csv or .xlsx</span></div>
      <button type="button" class="btn gold" id="nx-browse">📂 Browse…</button><input type="file" id="nx-file" accept=".csv,.txt,.xlsx,.xls" hidden></div>
    <details class="nx-how"><summary>❔ How to get the file from Neorcha</summary><ol>
      <li>Open <b>ibis.myneorcha.com</b> and log in.</li><li>Go to <b>Guest Documents</b>, pick the <b>Hotel</b> and the <b>Arrival Date From / To</b> (e.g. 1–31 Oct), press <b>Search</b>.</li>
      <li>Press <b>Export Excel → CSV (All)</b>, then drop that file above.</li></ol></details>
    <div id="nx-out"></div></div>`;
  main.appendChild(panel);
  const item = document.createElement('div'); item.className = 'nav-item'; item.id = 'nav-' + PANEL; item.dataset.panel = PANEL;
  item.setAttribute('onclick', "showPanel('" + PANEL + "')");
  item.innerHTML = '<div class="nav-icon">🪪</div>Neorcha Registrations';
  const anchor = document.getElementById('nav-purpose'); if (anchor && nav.contains(anchor)) anchor.after(item); else nav.appendChild(item);
  try { ['owner', 'manager', 'supervisor', 'agent'].forEach(r => { if (typeof ROLES !== 'undefined' && ROLES[r] && !ROLES[r].panels.includes(PANEL)) ROLES[r].panels.push(PANEL); });
    if (typeof currentProfile !== 'undefined' && currentProfile && typeof applyRole === 'function') applyRole(currentProfile.role); } catch (_) {}
  $('browse').onclick = () => { $('file').value = ''; $('file').click(); };
  $('file').onchange = e => load(e.target.files[0]);
  $('clear').onclick = () => { S = null; try { localStorage.removeItem(LS); } catch (_) {} draw(); };
  const z = $('drop');
  ['dragenter', 'dragover'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.remove('over'); }));
  z.addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) load(f); });
  // Purpose of Stay changes (loaded later, edited): the link numbers follow
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('[data-panel="' + PANEL + '"]')) setTimeout(draw, 50); }, true);
  draw();
}
W.hoNeorcha = { parseAoa, summary, linkPlan, purposeOf, isoOf, natName, NEVER };
if (typeof document !== 'undefined' && document.addEventListener) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount(); }
})();

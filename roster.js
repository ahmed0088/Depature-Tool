// ═══════════════════════════════════════════════════════════
//  roster.js — the team's weekly roster, inside HotelOps
//
//  Put the roster in once (paste it from Excel, upload the .xlsx, or
//  type it) and everyone sees it on any phone: "My shifts" for the next
//  days, who is on today, and the full week. It is kept per date, so a
//  one-week, two-week or monthly roster all work, and next week's paste
//  never wipes this week.
//
//  Firebase (per hotel):
//    roster/days/{YYYY-MM-DD}/{NAME KEY} = "N"     the code for that day
//    roster/staff/{NAME KEY} = { name, order }      who is on the roster
//    roster/codes/{CODE} = { label, from, to, type }  the hotel's own codes
//    roster/me/{uid} = NAME KEY                     which row is you
// ═══════════════════════════════════════════════════════════

const RO_DEFAULT_CODES = {
  M:   { label: 'Morning',      from: '07:00', to: '15:00', type: 'morning' },
  A:   { label: 'Afternoon',    from: '15:00', to: '23:00', type: 'afternoon' },
  E:   { label: 'Evening',      from: '15:00', to: '23:00', type: 'afternoon' },
  N:   { label: 'Night',        from: '23:00', to: '07:00', type: 'night' },
  OFF: { label: 'Day off', type: 'off' },
  O:   { label: 'Day off', type: 'off' },
  DO:  { label: 'Day off', type: 'off' },
  RD:  { label: 'Rest day', type: 'off' },
  AL:  { label: 'Annual leave', type: 'leave' },
  SL:  { label: 'Sick leave', type: 'leave' },
  PH:  { label: 'Public holiday', type: 'leave' },
  TR:  { label: 'Training', type: 'other' },
};
const RO_TYPES = { morning: 'Morning', afternoon: 'Afternoon', night: 'Night', other: 'Other', leave: 'Leave', off: 'Off' };
const RO_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const RO_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

let roDays = {}, roStaff = {}, roCodes = {}, roMeKey = '', roMeLoaded = false;
let roWeek = null, roEdit = false, roPreview = null;

// ── Dates ─────────────────────────────────────────────────
function roIso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function roDate(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
function roAdd(iso, n) { const d = roDate(iso); d.setDate(d.getDate() + n); return roIso(d); }
function roMonday(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return roIso(x); }
function roToday() { return roIso(new Date()); }
function roDayLbl(iso, long) { const d = roDate(iso); return d.toLocaleDateString('en-GB', long ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short', day: 'numeric' }); }

// ── Names and codes ───────────────────────────────────────
function roKey(name) { return String(name || '').trim().toUpperCase().replace(/[.#$\[\]\/]/g, ' ').replace(/\s+/g, ' ').trim(); }
function roAllCodes() { return Object.assign({}, RO_DEFAULT_CODES, roCodes || {}); }
function _roType(h) { return h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 20 ? 'afternoon' : 'night'; }

/** What a cell means: { code, label, from, to, type } or null for an empty cell. */
function roInfo(code) {
  const c = String(code || '').trim();
  if (!c) return null;
  const k = c.toUpperCase(), codes = roAllCodes();
  if (codes[k]) return Object.assign({ code: c }, codes[k]);
  const t = c.match(/(\d{1,2})(?:[:.]?(\d{2}))?\s*(?:-|–|to)\s*(\d{1,2})(?:[:.]?(\d{2}))?/i);
  if (t) {
    const h1 = +t[1], h2 = +t[3];
    if (h1 < 24 && h2 < 24) {
      const f = `${String(h1).padStart(2, '0')}:${t[2] || '00'}`, to = `${String(h2).padStart(2, '0')}:${t[4] || '00'}`;
      return { code: c, label: `${f}–${to}`, from: f, to, type: _roType(h1) };
    }
  }
  const l = c.toLowerCase();
  const type = /\b(off|rest|r\/d|day ?off)\b/.test(l) ? 'off'
    : /leave|vacation|holiday|sick|^ul$|^ml$/.test(l) ? 'leave'
    : /morn|^am$|^ms$/.test(l) ? 'morning'
    : /after|even|^pm$|^as$/.test(l) ? 'afternoon'
    : /night|^ns$|^ng$/.test(l) ? 'night' : 'other';
  return { code: c, label: c, type };
}
function roTime(i) { return i && i.from ? `${i.from}–${i.to}` : ''; }
function roShort(i) { const h = t => (t.endsWith(':00') ? t.slice(0, 2) : t); return i && i.from ? `${h(i.from)}–${h(i.to)}` : ''; }

// ── Who can change it ─────────────────────────────────────
function roCanEdit() {
  const r = typeof currentProfile !== 'undefined' && currentProfile && currentProfile.role;
  return !!(typeof ROLES !== 'undefined' && ROLES[r] && ROLES[r].canEditShifts);
}

// ── Reading a roster (pasted or from a file) ──────────────
/** A header cell → a date (ISO) or null. Day names alone fall in the week of weekStart. */
function roParseDate(cell, weekStart) {
  if (cell == null || cell === '') return null;
  if (typeof cell === 'number') {
    if (cell > 40000 && cell < 60000) { const d = new Date(Math.round((cell - 25569) * 864e5)); return roIso(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
    return null;
  }
  const s = String(cell).trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1');
  if (s.length > 40) return null;
  const ws = roDate(weekStart);
  const near = (m, d) => { // the year that puts the date closest to the week
    let best = null;
    [ws.getFullYear() - 1, ws.getFullYear(), ws.getFullYear() + 1].forEach(y => { const x = new Date(y, m, d); if (x.getMonth() === m && (!best || Math.abs(x - ws) < Math.abs(best - ws))) best = x; });
    return best && roIso(best);
  };
  const y2 = y => (y < 100 ? 2000 + y : y);
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return roIso(new Date(+m[1], +m[2] - 1, +m[3]));
  if ((m = s.match(/(?:^|\s)(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/))) return roIso(new Date(y2(+m[3]), +m[2] - 1, +m[1]));   // day first, as in Dubai
  const mon = s.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/);
  if (mon) {
    const mi = RO_MONTHS.indexOf(mon[1].slice(0, 3));
    const rest = s.replace(mon[0], ' '), dm = rest.match(/\b(\d{1,2})\b/);
    if (!dm) return null;
    const y = rest.replace(dm[0], ' ').match(/\b(20\d{2}|\d{2})\b/);
    return y ? roIso(new Date(y2(+y[1]), mi, +dm[1])) : near(mi, +dm[1]);
  }
  const dn = s.match(/^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?(?:\s*(\d{1,2}))?$/);
  if (dn) {
    const off = (RO_DAYS.indexOf(dn[1]) + 6) % 7;      // Monday = 0
    if (dn[2]) {                                         // "Mon 5": that day number, near the week
      const want = +dn[2];
      for (let i = -10; i <= 17; i++) { const iso = roAdd(weekStart, i); if (roDate(iso).getDate() === want && (roDate(iso).getDay() + 6) % 7 === off) return iso; }
    }
    return roAdd(weekStart, off);
  }
  return null;
}

const RO_NOT_NAMES = /^(name|names|employee|employees|staff|position|designation|dept|department|total|totals|morning|afternoon|evening|night|shift|shifts|remarks?|notes?|s\.?\s?no\.?|no\.?|id|emp ?(no|id)?|front office|reception|guest services?)$/i;

/** rows (arrays of cells) → { names:[], dates:[], cells:{name:{date:code}} } */
function roParse(rows, weekStart) {
  rows = (rows || []).map(r => (r || []).map(c => (typeof c === 'number' ? c : c == null ? '' : String(c).trim())));
  rows = rows.filter(r => r.some(c => c !== ''));
  if (!rows.length) return null;
  // header rows: three or more cells that read as dates or day names
  const colDate = {}, headRows = new Set();
  const heads = [];
  rows.slice(0, 10).forEach((r, i) => {
    const hit = {}; let real = 0;
    r.forEach((c, j) => { const d = roParseDate(c, weekStart); if (d) { hit[j] = d; if (!/^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?$/i.test(String(c).trim())) real++; } });
    if (Object.keys(hit).length >= 3) { heads.push({ i, hit, real }); headRows.add(i); }
  });
  heads.sort((a, b) => a.real - b.real).forEach(h => Object.assign(colDate, h.hit));   // real dates win over day names
  let dayCols = Object.keys(colDate).map(Number).sort((a, b) => a - b);
  // name column: the left column with the most names in it
  const body = rows.filter((r, i) => !headRows.has(i));
  const firstDay = dayCols.length ? dayCols[0] : Infinity;
  const width = Math.max(...rows.map(r => r.length));
  let nameCol = -1, best = 0;
  for (let j = 0; j < Math.min(firstDay, width); j++) {
    const head = heads.length ? String(rows[heads[0].i][j] || '') : '';
    let n = body.filter(r => { const c = String(r[j] == null ? '' : r[j]); return /[a-z]{2,}/i.test(c) && !RO_NOT_NAMES.test(c) && !RO_DEFAULT_CODES[c.toUpperCase()]; }).length;
    if (/name|employee|staff/i.test(head)) n += 1000;
    if (n > best) { best = n; nameCol = j; }
  }
  if (nameCol < 0) nameCol = 0;
  if (!dayCols.length) {           // no header: name, then Monday … Sunday of the chosen week
    dayCols = [1, 2, 3, 4, 5, 6, 7].map(k => nameCol + k);
    dayCols.forEach((j, k) => { colDate[j] = roAdd(weekStart, k); });
  }
  const names = [], cells = {};
  body.forEach(r => {
    const nm = String(r[nameCol] == null ? '' : r[nameCol]).replace(/\s+/g, ' ').trim();
    if (!/[a-z]{2,}/i.test(nm) || RO_NOT_NAMES.test(nm) || nm.length > 60) return;
    const row = {}; let any = false;
    dayCols.forEach(j => { const v = r[j] == null ? '' : String(r[j]).trim(); if (v) { row[colDate[j]] = v; any = true; } });
    if (!any) return;
    if (!cells[nm]) names.push(nm);
    cells[nm] = Object.assign(cells[nm] || {}, row);
  });
  const dates = [...new Set(dayCols.map(j => colDate[j]))].sort();
  return names.length ? { names, dates, cells } : null;
}

// ── Import: paste, file, preview, save ────────────────────
function roImportOpen(show) {
  const b = document.getElementById('roImport');
  if (!b) return;
  b.hidden = show === false ? true : !b.hidden;
  if (!b.hidden) { const w = document.getElementById('roImpWeek'); if (w && !w.value) w.value = roAdd(roMonday(new Date()), new Date().getDay() >= 4 || new Date().getDay() === 0 ? 7 : 0); b.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}
function roFromPaste() {
  const t = document.getElementById('roPaste')?.value || '';
  if (!t.trim()) { showToast('Paste the roster first: copy it from Excel and paste it in the box', 'warn'); return; }
  const sep = t.includes('\t') ? '\t' : t.includes(';') ? ';' : ',';
  roShowPreview(roParse(t.split(/\r?\n/).map(l => l.split(sep)), document.getElementById('roImpWeek').value || roMonday(new Date())));
}
function roFromFile(input) {
  const f = input.files && input.files[0];
  if (!f) return;
  if (typeof XLSX === 'undefined') { showToast('The Excel reader did not load. Check the internet and try again', 'err'); return; }
  const rd = new FileReader();
  rd.onload = e => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      const ws = document.getElementById('roImpWeek').value || roMonday(new Date());
      // the first sheet that reads as a roster
      let res = null;
      for (const n of wb.SheetNames) { res = roParse(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }), ws); if (res) break; }
      roShowPreview(res);
    } catch (err) { showToast('Could not read that file: ' + err.message, 'err'); }
    input.value = '';
  };
  rd.readAsArrayBuffer(f);
}
function roShowPreview(res) {
  const box = document.getElementById('roPreview');
  roPreview = res;
  if (!box) return;
  if (!res) { box.innerHTML = '<div class="ro-empty">Couldn\'t find names and days in that. The roster needs one person per row, with their name and then a code for each day (like M, A, N, OFF or 07-15).</div>'; return; }
  const first = res.dates[0], last = res.dates[res.dates.length - 1];
  box.innerHTML = `<div class="ro-prev-hd"><b>${res.names.length} people · ${res.dates.length} day${res.dates.length === 1 ? '' : 's'}</b> <span>${escapeHtml(roDayLbl(first, true))} → ${escapeHtml(roDayLbl(last, true))}</span></div>
    ${_roTable(res.names.map(n => ({ key: n, name: n })), res.dates, (r, d) => res.cells[r.key][d], false)}
    <div class="ro-acts"><button class="btn gold" onclick="roSavePreview()">✓ Save roster</button><button class="btn" onclick="roShowPreview(null);document.getElementById('roPreview').innerHTML=''">Cancel</button>
    <small>These days are replaced; other weeks stay as they are.</small></div>`;
}
function roSavePreview() {
  const res = roPreview;
  if (!res) return;
  if (!roCanEdit()) { showToast('Only supervisors, managers and owners can change the roster', 'err'); return; }
  const staff = Object.assign({}, roStaff);
  res.names.forEach((n, i) => { const k = roKey(n); staff[k] = { name: n, order: i }; });
  res.dates.forEach(d => {
    const day = {};
    res.names.forEach(n => { const v = res.cells[n][d]; if (v) day[roKey(n)] = v; });
    roDays[d] = day;
    fbSet('roster/days/' + d, Object.keys(day).length ? day : null);
  });
  roStaff = staff;
  fbSet('roster/staff', staff);
  if (typeof logActivity === 'function') try { logActivity('roster_saved', `${res.names.length} people · ${res.dates[0]} to ${res.dates[res.dates.length - 1]}`); } catch (_) {}
  roPreview = null;
  document.getElementById('roPreview').innerHTML = '';
  document.getElementById('roPaste').value = '';
  roImportOpen(false);
  roWeek = roMonday(roDate(res.dates[0]));
  roGuessMe();
  roRender();
  showToast(`Roster saved: ${res.names.length} people`, 'ok');
}

// ── Editing in place ──────────────────────────────────────
function roSetCell(key, date, val) {
  if (!roCanEdit()) return;
  val = String(val || '').trim();
  roDays[date] = Object.assign({}, roDays[date] || {});
  if (val) roDays[date][key] = val; else delete roDays[date][key];
  fbSet(`roster/days/${date}/${key}`, val || null);
  const td = document.querySelector(`.ro-cell[data-k="${CSS.escape(key)}"][data-d="${date}"]`);
  if (td) { const i = roInfo(val); td.className = 'ro-cell ' + (i ? 'ro-t-' + i.type : ''); }
  roRenderSide();
}
function roAddPerson() {
  const inp = document.getElementById('roNewName');
  const n = (inp?.value || '').replace(/\s+/g, ' ').trim();
  if (!n) return;
  const k = roKey(n);
  if (!roStaff[k]) { roStaff[k] = { name: n, order: Object.keys(roStaff).length }; fbSet('roster/staff/' + k, roStaff[k]); }
  // shows in this week with empty days until codes are typed
  roWeekAdd = roWeekAdd || {}; (roWeekAdd[roWeek] = roWeekAdd[roWeek] || []).push(k);
  inp.value = '';
  roRender();
}
let roWeekAdd = {};
function roClearPerson(key) {
  if (!roCanEdit()) return;
  const nm = (roStaff[key] || {}).name || key;
  if (!confirm(`Clear ${nm}'s days in this week?`)) return;
  for (let i = 0; i < 7; i++) { const d = roAdd(roWeek, i); if (roDays[d] && roDays[d][key]) roSetCell(key, d, ''); }
  if (roWeekAdd[roWeek]) roWeekAdd[roWeek] = roWeekAdd[roWeek].filter(k => k !== key);
  roRender();
}
function roCopyLastWeek() {
  if (!roCanEdit()) return;
  const prev = roAdd(roWeek, -7);
  let n = 0;
  for (let i = 0; i < 7; i++) n += Object.keys(roDays[roAdd(prev, i)] || {}).length;
  if (!n) { showToast('Last week has no roster to copy', 'warn'); return; }
  const has = [0, 1, 2, 3, 4, 5, 6].some(i => Object.keys(roDays[roAdd(roWeek, i)] || {}).length);
  if (has && !confirm('This week already has a roster. Replace it with last week\'s?')) return;
  for (let i = 0; i < 7; i++) {
    const src = roDays[roAdd(prev, i)] || {}, d = roAdd(roWeek, i);
    roDays[d] = Object.assign({}, src);
    fbSet('roster/days/' + d, Object.keys(src).length ? src : null);
  }
  roRender();
  showToast('Last week copied. Change the days that are different', 'ok');
}

// ── Which row is you ──────────────────────────────────────
function roMyUid() { return typeof currentUser !== 'undefined' && currentUser ? currentUser.uid : ''; }
function roSetMe(key) {
  roMeKey = key || '';
  const uid = roMyUid();
  try { localStorage.setItem('roster_me_v1', roMeKey); } catch (_) {}
  if (uid) fbSet('roster/me/' + uid, roMeKey || null);
  roRender();
}
/** Match the signed-in name to a roster name when it isn't set yet. */
function roGuessMe() {
  if (roMeKey || !roMeLoaded) return;
  const me = String(typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name || '').toUpperCase().trim();
  if (!me) return;
  const keys = Object.keys(roStaff);
  let hit = keys.find(k => k === roKey(me));
  if (!hit) { const f = me.split(/\s+/)[0]; const m = keys.filter(k => k.split(' ')[0] === f); if (m.length === 1) hit = m[0]; }
  if (hit) roSetMe(hit);
}
async function roLoadMe() {
  if (roMeLoaded) return;
  const uid = roMyUid();
  if (!uid) return;
  roMeLoaded = true;
  let k = null;
  try { k = await fbGet('roster/me/' + uid); } catch (_) {}
  if (!k) try { k = localStorage.getItem('roster_me_v1'); } catch (_) {}
  roMeKey = k || '';
  roGuessMe();
  if (document.getElementById('panel-roster')?.classList.contains('active')) roRender();
}

// ── Questions the rest of the app asks ────────────────────
function roCode(key, date) { return (roDays[date] || {})[key] || ''; }
/** Who works on a date, by shift type. */
function roOn(date) {
  const out = {};
  Object.entries(roDays[date] || {}).forEach(([k, c]) => { const i = roInfo(c); if (!i) return; (out[i.type] = out[i.type] || []).push({ key: k, name: (roStaff[k] || {}).name || k, info: i }); });
  return out;
}
/** Your next n days, from today. */
function roMine(n = 7) {
  if (!roMeKey) return [];
  return Array.from({ length: n }, (_, i) => { const d = roAdd(roToday(), i); return { date: d, info: roInfo(roCode(roMeKey, d)) }; });
}
function roNextShift() {
  if (!roMeKey) return null;
  const now = new Date();
  for (let i = 0; i < 21; i++) {
    const d = roAdd(roToday(), i), inf = roInfo(roCode(roMeKey, d));
    if (!inf || inf.type === 'off' || inf.type === 'leave') continue;
    if (i === 0 && inf.to && inf.type !== 'night') { const [h, m] = inf.to.split(':').map(Number); if (now.getHours() * 60 + now.getMinutes() >= h * 60 + m) continue; }
    return { date: d, info: inf, inDays: i };
  }
  return null;
}
function _roWhen(n) { return n.inDays === 0 ? 'Today' : n.inDays === 1 ? 'Tomorrow' : roDayLbl(n.date, true); }

// ── Page ──────────────────────────────────────────────────
function _roTable(rows, dates, get, editable) {
  const today = roToday();
  return `<div class="ro-scroll"><table class="ro-table">
    <thead><tr><th class="ro-name">Name</th>${dates.map(d => `<th class="${d === today ? 'ro-today' : ''}">${escapeHtml(roDayLbl(d))}</th>`).join('')}${editable ? '<th></th>' : ''}</tr></thead>
    <tbody>${rows.map(r => `<tr class="${r.key === roMeKey ? 'ro-me' : ''}"><td class="ro-name">${escapeHtml(r.name)}${r.key === roMeKey ? ' <span class="ro-you">you</span>' : ''}</td>${dates.map(d => {
      const v = get(r, d) || '', i = roInfo(v);
      return `<td class="ro-cell ${i ? 'ro-t-' + i.type : ''}${d === today ? ' ro-today' : ''}" data-k="${escapeHtml(r.key)}" data-d="${d}" title="${escapeHtml(i ? i.label + (roTime(i) ? ' ' + roTime(i) : '') : '')}">${editable
        ? `<input value="${escapeHtml(v)}" maxlength="14" onchange="roSetCell(${JSON.stringify(r.key).replace(/"/g, '&quot;')},'${d}',this.value)">`
        : escapeHtml(v)}</td>`; }).join('')}${editable ? `<td><button class="ro-x" title="Clear this week" onclick="roClearPerson(${JSON.stringify(r.key).replace(/"/g, '&quot;')})">✕</button></td>` : ''}</tr>`).join('')}</tbody>
  </table></div>`;
}

function roWeekRows() {
  const keys = new Set(roWeekAdd[roWeek] || []);
  for (let i = 0; i < 7; i++) Object.keys(roDays[roAdd(roWeek, i)] || {}).forEach(k => keys.add(k));
  return [...keys].map(k => ({ key: k, name: (roStaff[k] || {}).name || k, order: (roStaff[k] || {}).order ?? 999 }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

function roRenderSide() {
  // My shifts
  const me = document.getElementById('roMine');
  if (me) {
    const names = Object.keys(roStaff).map(k => ({ k, n: roStaff[k].name || k })).sort((a, b) => a.n.localeCompare(b.n));
    if (!roMeKey) {
      me.innerHTML = `<div class="ro-card-hd"><b>My shifts</b></div>${names.length
        ? `<div class="ro-pick"><span>Which one is you? You only choose once.</span><select onchange="roSetMe(this.value)"><option value="">Choose your name…</option>${names.map(x => `<option value="${escapeHtml(x.k)}">${escapeHtml(x.n)}</option>`).join('')}</select></div>`
        : '<div class="ro-empty">No roster yet. ' + (roCanEdit() ? 'Press <b>Add roster</b> and paste it from Excel.' : 'Your supervisor adds it here once a week.') + '</div>'}`;
    } else {
      const nx = roNextShift();
      me.innerHTML = `<div class="ro-card-hd"><b>My shifts</b><span>${escapeHtml((roStaff[roMeKey] || {}).name || roMeKey)} · <a href="javascript:void 0" onclick="roSetMe('')">not you?</a></span></div>
        ${nx ? `<div class="ro-next ro-t-${nx.info.type}"><small>Next shift</small><b>${escapeHtml(_roWhen(nx))} · ${escapeHtml(nx.info.label)}</b>${roTime(nx.info) ? `<span>${escapeHtml(roTime(nx.info))}</span>` : ''}</div>` : '<div class="ro-empty">No shift in the roster for the next three weeks.</div>'}
        <div class="ro-days">${roMine(7).map(x => `<div class="ro-day ${x.info ? 'ro-t-' + x.info.type : 'ro-t-none'}${x.date === roToday() ? ' is-today' : ''}"><small>${escapeHtml(x.date === roToday() ? 'Today' : roDate(x.date).toLocaleDateString('en-GB', { weekday: 'short' }))}</small><b>${escapeHtml(x.info ? x.info.code : '—')}</b><span>${escapeHtml(x.info ? (roShort(x.info) || x.info.label) : '—')}</span></div>`).join('')}</div>`;
    }
  }
  // Today on shift
  const on = document.getElementById('roTodayOn');
  if (on) {
    const t = roOn(roToday());
    const order = ['morning', 'afternoon', 'night', 'other'];
    const any = order.some(k => t[k] && t[k].length);
    on.innerHTML = `<div class="ro-card-hd"><b>On shift today</b><span>${escapeHtml(roDayLbl(roToday(), true))}</span></div>` + (any
      ? order.filter(k => t[k] && t[k].length).map(k => `<div class="ro-on ro-t-${k}"><span class="ro-on-k">${RO_TYPES[k]}${t[k][0].info.from ? ` <small>${escapeHtml(roTime(t[k][0].info))}</small>` : ''}</span><span>${t[k].map(x => `<b class="${x.key === roMeKey ? 'is-me' : ''}">${escapeHtml(x.name)}</b>`).join('')}</span></div>`).join('')
        + ((t.off || []).length + (t.leave || []).length ? `<div class="ro-on ro-t-off"><span class="ro-on-k">Off / leave</span><span>${[...(t.off || []), ...(t.leave || [])].map(x => `<b>${escapeHtml(x.name)}</b>`).join('')}</span></div>` : '')
      : '<div class="ro-empty">Nobody is on the roster for today.</div>');
  }
}

function roRender() {
  const box = document.getElementById('roBody');
  if (!box) return;
  if (!roWeek) roWeek = roMonday(new Date());
  roLoadMe();
  const ed = roCanEdit();
  document.getElementById('roEditBtn')?.toggleAttribute('hidden', !ed);
  document.getElementById('roAddBtn')?.toggleAttribute('hidden', !ed);
  const eb = document.getElementById('roEditBtn'); if (eb) { eb.textContent = roEdit ? '✓ Done' : '✏️ Edit'; eb.classList.toggle('gold', roEdit); }
  roRenderSide();
  const dates = [0, 1, 2, 3, 4, 5, 6].map(i => roAdd(roWeek, i));
  const rows = roWeekRows();
  const isNow = roWeek === roMonday(new Date());
  box.innerHTML = `
    <div class="ro-weeknav">
      <button class="btn sm" onclick="roGo(-7)" title="Previous week">‹</button>
      <b>${escapeHtml(roDate(dates[0]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))} – ${escapeHtml(roDate(dates[6]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))}</b>
      <button class="btn sm" onclick="roGo(7)" title="Next week">›</button>
      ${isNow ? '<span class="ro-tag">This week</span>' : '<button class="btn sm" onclick="roGo(0)">This week</button>'}
      ${roEdit ? '<button class="btn sm" onclick="roCopyLastWeek()">⧉ Copy last week</button>' : ''}
    </div>
    ${rows.length || roEdit ? _roTable(rows, dates, (r, d) => roCode(r.key, d), roEdit) : `<div class="ro-empty ro-big">No roster for this week yet.${ed ? ' Press <b>Add roster</b> to paste it, or <b>Edit</b> → <b>Copy last week</b>.' : ''}</div>`}
    ${roEdit ? `<div class="ro-add"><input id="roNewName" placeholder="Add a person to this week…" onkeydown="if(event.key==='Enter')roAddPerson()"><button class="btn sm" onclick="roAddPerson()">+ Add</button><small>Type a code in each day: M, A, N, OFF, AL, or hours like 07-15.</small></div>` : ''}
    <div class="ro-legend">${['morning', 'afternoon', 'night', 'off', 'leave', 'other'].map(k => `<span class="ro-t-${k}">${RO_TYPES[k]}</span>`).join('')}</div>
    ${roCodesHtml()}`;
}
function roGo(n) { roWeek = n === 0 ? roMonday(new Date()) : roAdd(roWeek, n); roRender(); }
function roToggleEdit() { roEdit = !roEdit; roRender(); }

// ── The hotel's own codes ─────────────────────────────────
function roCodesHtml() {
  const all = roAllCodes();
  const ed = roCanEdit();
  return `<details class="ro-codes"><summary>Shift codes and times</summary>
    <div class="ro-codes-list">${Object.entries(all).map(([k, v]) => `<div class="ro-code ro-t-${v.type}"><b>${escapeHtml(k)}</b><span>${escapeHtml(v.label)}${v.from ? ` · ${escapeHtml(v.from)}–${escapeHtml(v.to)}` : ''}</span></div>`).join('')}</div>
    ${ed ? `<div class="ro-code-add">
      <input id="roCdK" placeholder="Code (e.g. MS)" maxlength="8"><input id="roCdL" placeholder="Name (e.g. Mid shift)">
      <input id="roCdF" type="time"><input id="roCdT" type="time">
      <select id="roCdY">${Object.entries(RO_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <button class="btn sm gold" onclick="roSaveCode()">Save code</button></div>
      <small class="ro-hint">Hours written in the roster (07-15, 0700-1500, 23:00-07:00) are understood by themselves. Add a code here when your roster uses its own letters, or to change a time.</small>` : ''}
  </details>`;
}
function roSaveCode() {
  const k = (document.getElementById('roCdK').value || '').trim().toUpperCase().replace(/[.#$\[\]\/]/g, '');
  if (!k) { showToast('Type the code first', 'warn'); return; }
  const v = { label: document.getElementById('roCdL').value.trim() || k, type: document.getElementById('roCdY').value };
  const f = document.getElementById('roCdF').value, t = document.getElementById('roCdT').value;
  if (f && t) { v.from = f; v.to = t; }
  roCodes = Object.assign({}, roCodes, { [k]: v });
  fbSet('roster/codes/' + k, v);
  roRender();
  showToast(`Code ${k} saved`, 'ok');
}

// ── Home tile ─────────────────────────────────────────────
function roHomeTile() {
  if (!Object.keys(roStaff).length) return { panel: 'roster', icon: '🗓️', title: 'Roster', big: '—', sub: roCanEdit() ? 'Add the team roster once a week' : 'No roster yet', tone: 'idle' };
  if (!roMeKey) return { panel: 'roster', icon: '🗓️', title: 'Roster', big: '?', sub: 'Choose your name to see your shifts', tone: 'idle' };
  const nx = roNextShift();
  return { panel: 'roster', icon: '🗓️', title: 'My next shift', big: nx ? nx.info.code : '—', sub: nx ? `${_roWhen(nx)}${roTime(nx.info) ? ' · ' + roTime(nx.info) : ' · ' + nx.info.label}` : 'Nothing in the roster yet', tone: 'idle' };
}

// ── Ops Brain ─────────────────────────────────────────────
function roIsQuestion(q) { return RO_COMMANDS.some(c => c.re.test(String(q).trim())); }
function _roOut(html) { if (typeof _bxOut === 'function') _bxOut(html); else { const b = document.getElementById('brAnswers'); if (b) b.innerHTML = `<div class="br-card ba-res">${html}</div>`; } }
const RO_COMMANDS = [
  { re: /^(my (shifts?|roster|rota|schedule|week|days? off)|when (do|am) i (work|working|on|off)|what'?s my (shift|roster|rota|schedule)|am i (working|on|off)\b.*|my next shift|when is my next shift)\s*\??$/i, ask: true, ex: 'my shifts', does: 'your next 7 days from the roster', run: () => {
      if (!roMeKey) { _roOut(`<div class="br-title">I don't know which name on the roster is you yet.</div><div class="br-acts"><button class="btn sm gold" onclick="brClose&&brClose();showPanel('roster')">Open Roster</button></div>`); return true; }
      const nx = roNextShift();
      _roOut(`<div class="br-kind">🗓️ Your roster</div><div class="br-title">${nx ? `Next: ${escapeHtml(_roWhen(nx))}, ${escapeHtml(nx.info.label)}${roTime(nx.info) ? ' ' + escapeHtml(roTime(nx.info)) : ''}` : 'No shift in the roster for the next three weeks.'}</div>
        <ul class="ba-ul">${roMine(7).map(x => `<li><b>${escapeHtml(x.date === roToday() ? 'Today' : roDayLbl(x.date))}</b>: ${escapeHtml(x.info ? x.info.label + (roTime(x.info) ? ' ' + roTime(x.info) : '') : 'not in the roster')}</li>`).join('')}</ul>
        <div class="br-acts"><button class="btn sm" onclick="brClose&&brClose();showPanel('roster')">Open Roster</button></div>`);
      return true; } },
  { re: /^(who'?s|who is|who are|who)\s+(on|working|on shift|on duty|in)\b.*$|^who works\b.*$/i, ask: true, ex: 'who is on tonight', does: 'who works today, tonight or tomorrow', run: q => {
      const tm = /tomorrow/i.test(q), early = new Date().getHours() < 7 && /tonight|night|now/i.test(q);
      const d = tm ? roAdd(roToday(), 1) : early ? roAdd(roToday(), -1) : roToday();   // after midnight the night shift began yesterday
      const want = /tonight|night/i.test(q) ? ['night'] : /morning/i.test(q) ? ['morning'] : /afternoon|evening/i.test(q) ? ['afternoon'] : ['morning', 'afternoon', 'night', 'other'];
      const t = roOn(d);
      const lines = want.filter(k => t[k] && t[k].length).map(k => `<li><b>${RO_TYPES[k]}</b>${t[k][0].info.from ? ` (${escapeHtml(roTime(t[k][0].info))})` : ''}: ${t[k].map(x => escapeHtml(x.name)).join(', ')}</li>`);
      _roOut(`<div class="br-kind">🗓️ Roster · ${escapeHtml(roDayLbl(d, true))}</div>${lines.length ? `<ul class="ba-ul">${lines.join('')}</ul>` : '<div class="br-title">Nobody on the roster for that.</div>'}<div class="br-acts"><button class="btn sm" onclick="brClose&&brClose();showPanel('roster')">Open Roster</button></div>`);
      return true; } },
];

// ── Start ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (typeof BA_COMMANDS !== 'undefined') BA_COMMANDS.unshift(...RO_COMMANDS);
  if (typeof BR_FAQ !== 'undefined') BR_FAQ.push({ q: 'roster rota schedule my shifts day off who is working add the roster', t: 'Roster', a: 'Open <b>Roster</b>. Supervisors and managers press <b>Add roster</b> and paste it from Excel (or upload the file) once a week; everyone then sees <b>My shifts</b> and who is on today. Ask me "my shifts" or "who is on tonight".', go: 'roster', kind: '💡 How the app works' });
  setTimeout(() => {
    if (typeof fbListen !== 'function') return;
    fbListen('roster/days', v => { roDays = v || {}; _roRefresh(); });
    fbListen('roster/staff', v => { roStaff = v || {}; roGuessMe(); _roRefresh(); });
    fbListen('roster/codes', v => { roCodes = v || {}; _roRefresh(); });
  }, 1500);
  // supervisors: a nudge when next week's roster isn't in by Thursday
  (window.BL_THINKERS = window.BL_THINKERS || []).push(add => {
    if (!roCanEdit() || !Object.keys(roStaff).length) return;
    const wd = new Date().getDay();
    if (wd < 4 && wd !== 0) return;
    const next = roAdd(roMonday(new Date()), 7);
    const has = [0, 1, 2, 3, 4, 5, 6].some(i => Object.keys(roDays[roAdd(next, i)] || {}).length);
    if (has) return;
    add({ id: 'roster:' + next, type: 'roster', icon: '🗓️', tone: 'idle', text: 'Next week\'s roster isn\'t in HotelOps yet.', why: 'Paste it once and the team sees their shifts on their phones.',
      acts: [['Add roster', () => { showPanel('roster'); setTimeout(() => roImportOpen(true), 300); }]] });
  });
});
function _roRefresh() {
  clearTimeout(_roRefresh._t);
  _roRefresh._t = setTimeout(() => {
    if (document.getElementById('panel-roster')?.classList.contains('active')) roRender();
    if (document.getElementById('panel-home')?.classList.contains('active') && typeof homeRender === 'function') homeRender();
  }, 150);
}

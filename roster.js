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
  ALA: { label: 'Annual leave', type: 'leave' },
  SL:  { label: 'Sick leave', type: 'leave' },
  PH:  { label: 'Public holiday', type: 'leave' },
  TR:  { label: 'Training', type: 'other' },
  TRN: { label: 'Training', type: 'other' },
  CL:  { label: 'Casual leave', type: 'leave' },
  EL:  { label: 'Emergency leave', type: 'leave' },
  ML:  { label: 'Medical / maternity leave', type: 'leave' },
  UL:  { label: 'Unpaid leave', type: 'leave' },
  LWP: { label: 'Leave without pay', type: 'leave' },
  BL:  { label: 'Bereavement leave', type: 'leave' },
  VAC: { label: 'Vacation', type: 'leave' },
  CO:  { label: 'Compensatory off', type: 'off' },
  COFF:{ label: 'Compensatory off', type: 'off' },
  SB:  { label: 'Standby', type: 'other' },
  STBY:{ label: 'Standby', type: 'other' },
};
/** First guesses for words a roster uses without saying what they mean. */
const RO_GUESS = {
  ALA: ['Annual leave (approved)', 'leave'], ALP: ['Annual leave (pending)', 'leave'], AL: ['Annual leave', 'leave'], ANL: ['Annual leave', 'leave'],
  PHL: ['Public holiday (in lieu)', 'off'], LIEU: ['Day off in lieu', 'off'], IL: ['Day off in lieu', 'off'], OIL: ['Off in lieu', 'off'], DIL: ['Day in lieu', 'off'],
  HOL: ['Holiday', 'leave'], PL: ['Paid / paternity leave', 'leave'], LOP: ['Loss of pay (unpaid leave)', 'leave'], UPL: ['Unpaid leave', 'leave'], HL: ['Hajj leave', 'leave'], MAT: ['Maternity leave', 'leave'], PAT: ['Paternity leave', 'leave'],
  RO: ['Rest off', 'off'], WO: ['Weekly off', 'off'], X: ['Off', 'off'], NA: ['Not available', 'off'],
  OD: ['On duty elsewhere', 'other'], BT: ['Business trip', 'other'], WFH: ['Working from home', 'other'], TBA: ['To be announced', 'other'], TBC: ['To be confirmed', 'other'],
  MS: ['Morning shift', 'morning'], AS: ['Afternoon shift', 'afternoon'], ES: ['Evening shift', 'afternoon'], NS: ['Night shift', 'night'], GY: ['Graveyard (night) shift', 'night'], MID: ['Middle shift', 'other'], SPL: ['Split shift', 'other'], SPLIT: ['Split shift', 'other'],
  NJ: ['New joiner', 'other'], RES: ['Resigned', 'off'], TRF: ['Transferred', 'other'], ADAGIO: ['Working at Adagio that day', 'other'], MERCURE: ['Working at Mercure that day', 'other'], IBIS: ['Working at Ibis that day', 'other'],
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
function _roType(h) { return h >= 5 && h < 11 ? 'morning' : h >= 11 && h < 18 ? 'afternoon' : 'night'; }   // 00:00 and 19:00 starts are nights

/** What a cell means: { code, label, from, to, type } or null for an empty cell. */
function roInfo(code) {
  const c = String(code || '').trim();
  if (!c) return null;
  const k = c.toUpperCase(), codes = roAllCodes();
  if (codes[k]) return Object.assign({ code: c }, codes[k]);
  const t = c.match(/(\d{1,2})(?:[:.]?(\d{2}))?\s*(?:-|–|to)\s*(\d{1,2})(?:[:.]?(\d{2}))?/i);
  if (t) {
    let h1 = +t[1], h2 = +t[3];
    // short hotel forms without minutes ("7-3", "3-11", "11-7", "9-6"): a 12-hour clock
    if (!t[2] && !t[4] && h1 <= 12 && h2 <= 12) {
      if ((h1 === 10 || h1 === 11) && (h2 === 6 || h2 === 7)) h1 += 12;      // 11-7: the night shift
      else if (h1 < 5) h1 += 12;                                              // 3-11: afternoon
      if (h2 <= h1 % 24 && h2 + 12 > h1 && h2 + 12 - h1 <= 12) h2 += 12;      // 7-3 → 07:00-15:00, 9-6 → 09:00-18:00
      h1 %= 24; h2 %= 24;
    }
    if (h1 < 24 && h2 < 24) {
      const f = `${String(h1).padStart(2, '0')}:${t[2] || '00'}`, to = `${String(h2).padStart(2, '0')}:${t[4] || '00'}`;
      const note = c.slice(t.index + t[0].length).replace(/^[\s\-–:,/]+/, '').trim();   // "12:00 - 21:00 - Adagio": working at Adagio
      return { code: c, label: `${f}–${to}${note ? ' · ' + note : ''}`, from: f, to, note, type: _roType(h1) };
    }
  }
  const lead = c.match(/^([A-Za-z]{1,4})\b\s*[-–:,]?\s*(.*)$/);
  if (lead && codes[lead[1].toUpperCase()]) { const b = codes[lead[1].toUpperCase()]; return Object.assign({ code: c }, b, { label: b.label + (lead[2] ? ' · ' + lead[2] : ''), note: lead[2] }); }
  const l = c.toLowerCase();
  const type = /\b(off|rest|r\/d|day ?off)\b/.test(l) ? 'off'
    : /leave|vacation|holiday|sick|^(al|ala|sl|ul|ml|cl|ph|el)\b/.test(l) ? 'leave'
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
    let n = body.filter(r => { const c = String(r[j] == null ? '' : r[j]); return /[a-z]{2,}/i.test(c) && !RO_NOT_NAMES.test(c) && !RO_DEFAULT_CODES[c.toUpperCase()]; }).length;
    if (heads.some(h => /name|employee|staff/i.test(String(rows[h.i][j] || '')))) n += 1000;
    if (n > best) { best = n; nameCol = j; }
  }
  if (nameCol < 0) nameCol = 0;
  if (!dayCols.length) {           // no header: name, then Monday … Sunday of the chosen week
    dayCols = [1, 2, 3, 4, 5, 6, 7].map(k => nameCol + k);
    dayCols.forEach((j, k) => { colDate[j] = roAdd(weekStart, k); });
  }
  const names = [], cells = {}, groups = {}, ids = {};
  const lastHead = heads.length ? Math.max(...heads.map(h => h.i)) : -1;
  let group = '';
  rows.forEach((r, i) => {
    if (headRows.has(i)) return;
    let nm = String(r[nameCol] == null ? '' : r[nameCol]).replace(/\s+/g, ' ').trim();
    const row = {}; let any = false;
    dayCols.forEach(j => { const v = r[j] == null ? '' : String(r[j]).trim(); if (v) { row[colDate[j]] = v; any = true; } });
    // a title line on its own ("Ibis DD", "Mercure DD"…) starts a section; a cluster roster has several hotels
    const filled = r.filter(c => c !== '').length;
    if (!any || i < lastHead) {
      if (nm && /[a-z]{2,}/i.test(nm) && !/^\d{3,}/.test(nm) && !RO_NOT_NAMES.test(nm) && nm.length <= 30 && filled <= 2) group = nm;
      return;
    }
    // "001032 - Name": the employee number goes, the name stays
    const idm = nm.match(/^\s*(\d{3,})\s*[-–.:]?\s*(.+)$/);
    let id = '';
    if (idm) { id = idm[1]; nm = idm[2].trim(); }
    if (!/[a-z]{2,}/i.test(nm) || RO_NOT_NAMES.test(nm) || nm.length > 60) return;
    if (!cells[nm]) names.push(nm);
    cells[nm] = Object.assign(cells[nm] || {}, row);
    if (group) groups[nm] = group;
    if (id) ids[nm] = id;
  });
  const dates = [...new Set(dayCols.map(j => colDate[j]))].sort();
  return names.length ? { names, dates, cells, groups, ids } : null;
}

// ── Import: paste, file, preview, save ────────────────────
function roImportOpen(show) {
  const b = document.getElementById('roImport');
  if (!b) return;
  b.hidden = show === false ? true : show === true ? false : !b.hidden;
  if (!b.hidden && typeof riRenderAiLine === 'function') riRenderAiLine();
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
/** Tap a cell in the check table: edit its full text. */
function roPrevEdit(td) {
  if (!roPreview || td.querySelector('input')) return;
  const k = td.dataset.k, d = td.dataset.d, v = ((roPreview.cells[k] || {})[d] || '');
  td.innerHTML = `<input value="${escapeHtml(v)}" maxlength="40" placeholder="empty">`;
  const inp = td.querySelector('input');
  inp.focus(); inp.select();
  const done = () => { const nv = inp.value.replace(/\s*\?$/, '').trim(); roPrevSet(k, d, nv); const i = roInfo(nv); td.innerHTML = `${escapeHtml(roCellTxt(i))}${i && i.note ? `<i class="ro-note">${escapeHtml(i.note)}</i>` : ''}`; td.title = (nv || 'empty') + ': tap to correct'; };
  inp.addEventListener('blur', done, { once: true });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = v; inp.blur(); } });
}
function roPrevEditName(btn, key) {
  const nv = prompt('Name', key.replace(/\s*\?$/, ''));
  if (nv != null && nv.trim()) roPrevRename(key, nv.trim());
}
function roPrevSet(name, date, v) {
  if (!roPreview) return;
  v = String(v || '').trim();
  const row = roPreview.cells[name] = roPreview.cells[name] || {};
  if (v) row[date] = v; else delete row[date];
  const td = document.querySelector(`#roPreview .ro-cell[data-k="${CSS.escape(name)}"][data-d="${date}"]`);
  if (td) { const i = roInfo(v); td.className = 'ro-cell ' + (i ? 'ro-t-' + i.type : '') + (/\?/.test(v) ? ' ro-unsure' : ''); }
}
function roPrevRename(old, nu, quiet) {
  const R = roPreview; nu = String(nu || '').replace(/\s+/g, ' ').trim();
  if (!R || !nu || nu === old || !R.cells[old]) return;
  if (R.cells[nu]) { showToast(`${nu} is already in the roster`, 'warn'); return; }
  R.names = R.names.map(n => (n === old ? nu : n));
  R.cells[nu] = R.cells[old]; delete R.cells[old];
  ['groups', 'ids'].forEach(k => { if (R[k] && R[k][old] != null) { R[k][nu] = R[k][old]; delete R[k][old]; } });
  if (!quiet) roShowPreview(R);
}
/** Codes in a roster the app doesn't know yet, with a first guess (from the AI when it read the picture). */
function roUnknownWords(res) {
  const seen = new Map(), all = roAllCodes();
  const tokOf = v => (String(v || '').trim().match(/^[A-Za-z][A-Za-z\-]{0,7}\b/) || [])[0];
  const add = (code, meaning, type, from) => { const k = String(code || '').toUpperCase(); if (!k || seen.has(k) || all[k] || /^(OFF|AM|PM)$/.test(k)) return; seen.set(k, { code: k, meaning: meaning || '', type: type || 'other', from }); };
  (res.terms || []).forEach(t => { const k = tokOf(t.text); if (k) add(k, t.meaning, { leave: 'leave', off: 'off', work: 'other', morning: 'morning', afternoon: 'afternoon', night: 'night' }[t.kind] || 'other', 'ai'); });
  Object.values(res.cells).forEach(row => Object.values(row).forEach(v => {
    const i = roInfo(v);
    if (!i || i.from || all[String(v).trim().toUpperCase()]) return;
    const k = tokOf(v); if (!k || all[k.toUpperCase()]) return;
    const g = RO_GUESS[k.toUpperCase()];
    add(k, g ? g[0] : '', g ? g[1] : i.type, g ? 'guess' : '');
  }));
  return [...seen.values()];
}
function roShowPreview(res) {
  const box = document.getElementById('roPreview');
  roPreview = res;
  if (!box) return;
  if (!res) { box.innerHTML = '<div class="ro-empty">Couldn\'t find names and days in that. The roster needs one person per row, with their name and then a code for each day (like M, A, N, OFF or 07-15).</div>'; return; }
  const first = res.dates[0], last = res.dates[res.dates.length - 1];
  const rows = []; let lastG = null;
  res.names.forEach(n => { const g = (res.groups || {})[n] || ''; if (g !== lastG && Object.keys(res.groups || {}).length) { rows.push({ section: g || 'Others' }); lastG = g; } rows.push({ key: n, name: n }); });
  const unsure = res.names.reduce((t, n) => t + Object.values(res.cells[n] || {}).filter(v => /\?/.test(v)).length, 0);
  const words = roUnknownWords(res);
  const q = s => JSON.stringify(s).replace(/"/g, '&quot;');
  box.innerHTML = `<div class="ro-prev-hd"><b>${res.names.length} people · ${res.dates.length} day${res.dates.length === 1 ? '' : 's'}</b> <span>${escapeHtml(roDayLbl(first, true))} → ${escapeHtml(roDayLbl(last, true))}</span>${res.by ? `<span class="ro-tag">${escapeHtml(res.by)}</span>` : ''}</div>
    ${res.notes ? `<div class="ro-ai-note">🤖 ${escapeHtml(res.notes)}</div>` : ''}
    ${unsure ? `<div class="ro-warn">⚠ ${unsure} cell${unsure === 1 ? '' : 's'} could not be read clearly (marked in red). Check them against the picture and type the right value.</div>` : ''}
    <div class="ro-hint">Check it against the picture. Tap any cell to correct it before saving.</div>
    ${_roTable(rows, res.dates, (r, d) => (res.cells[r.key] || {})[d], 'preview')}
    ${words.length ? `<div class="ro-words"><div class="ro-card-hd"><b>🔎 Words in this roster</b><span>Say what they mean once; HotelOps remembers for every roster after.</span></div>
      ${words.map(w => `<div class="ro-word"><b>${escapeHtml(w.code)}</b><input class="ro-w-m" data-code="${escapeHtml(w.code)}" value="${escapeHtml(w.meaning)}" placeholder="What does ${escapeHtml(w.code)} mean?"><select class="ro-w-t">${Object.entries(RO_TYPES).map(([k, v]) => `<option value="${k}"${k === w.type ? ' selected' : ''}>${v}</option>`).join('')}</select>${w.from ? `<small>${w.from === 'ai' ? 'AI guess' : 'usual meaning'}</small>` : '<small class="bad">unknown</small>'}</div>`).join('')}
    </div>` : ''}
    <div class="ro-acts"><button class="btn gold" onclick="roSavePreview()">✓ Save roster${typeof riPending !== 'undefined' && riPending ? ' and post it' : ''}</button><button class="btn" onclick="roShowPreview(null);document.getElementById('roPreview').innerHTML='';if(typeof riPending!=='undefined')riPending=null">Cancel</button>
    <small>These days are replaced; other weeks stay as they are. The team is told a new roster is posted.</small></div>`;
}
function roSavePreview() {
  const res = roPreview;
  if (!res) return;
  if (!roCanEdit()) { showToast('Only supervisors, managers and owners can change the roster', 'err'); return; }
  const qNames = res.names.filter(n => /\s*\?$/.test(n)).length;
  const qCells = res.names.reduce((t, n) => t + Object.values(res.cells[n] || {}).filter(v => /\?/.test(v)).length, 0);
  if ((qNames || qCells) && !confirm(`${qCells ? qCells + ' cell' + (qCells === 1 ? '' : 's') : ''}${qCells && qNames ? ' and ' : ''}${qNames ? qNames + ' name' + (qNames === 1 ? '' : 's') : ''} still marked to check (red). Save anyway? Marked cells stay red for everyone until someone fixes them.`)) return;
  // a name left with "?" is saved without it
  res.names.slice().forEach(n => { if (/\s*\?$/.test(n)) { const c = n.replace(/\s*\?$/, ''); if (!res.cells[c]) roPrevRename(n, c, true); } });
  const staff = Object.assign({}, roStaff);
  res.names.forEach((n, i) => { const k = roKey(n); staff[k] = { name: n, order: i }; if (res.groups && res.groups[n]) staff[k].group = res.groups[n]; if (res.ids && res.ids[n]) staff[k].id = res.ids[n]; });
  res.dates.forEach(d => {
    const day = {};
    res.names.forEach(n => { const v = res.cells[n][d]; if (v) day[roKey(n)] = v; });
    roDays[d] = day;
    fbSet('roster/days/' + d, Object.keys(day).length ? day : null);
  });
  roStaff = staff;
  fbSet('roster/staff', staff);
  document.querySelectorAll('#roPreview .ro-w-m').forEach(inp => {
    const k = inp.dataset.code, m = inp.value.trim();
    if (!k || !m) return;
    const v = { label: m, type: inp.parentElement.querySelector('.ro-w-t').value };
    roCodes = Object.assign({}, roCodes, { [k]: v });
    fbSet('roster/codes/' + k.replace(/[.#$\[\]\/]/g, ''), v);
  });
  roPost(res);
  if (typeof logActivity === 'function') try { logActivity('roster_saved', `${res.names.length} people · ${res.dates[0]} to ${res.dates[res.dates.length - 1]}`); } catch (_) {}
  roPreview = null;
  document.getElementById('roPreview').innerHTML = '';
  document.getElementById('roPaste').value = '';
  roImportOpen(false);
  roWeek = roMonday(roDate(res.dates[0]));
  roGuessMe();
  roRender();
  showToast(`Roster saved: ${res.names.length} people`, 'ok');
  // given from the builder's "Give this week's roster": straight on to building the week after it
  if (window._rbContinue && Date.now() - window._rbContinue < 30 * 60000 && typeof rbContinueFrom === 'function') { window._rbContinue = false; rbContinueFrom(res.dates[0]); }
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
const _roMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
/** When a shift really starts and ends. 00:00 on the 6th starts the night of the 5th; an end before the start is the next morning. */
function roSpan(date, info) {
  if (!info || !info.from) return null;
  const s = roDate(date); s.setMinutes(_roMin(info.from));
  const e = roDate(date); e.setMinutes(_roMin(info.to));
  if (e <= s) e.setDate(e.getDate() + 1);
  return { start: s, end: e };
}
/** Short text for a cell: 12–21, OFF, ALA, SL, PH… */
function roCellTxt(i) {
  if (!i) return '';
  if (i.from) return roShort(i);
  const m = i.code.match(/^[A-Za-z]{1,4}\b/);
  return (m ? m[0] : i.code).toUpperCase().slice(0, 5);
}

// ── Hotels on a cluster roster ────────────────────────────
function roGroups() { return [...new Set(Object.values(roStaff).map(s => s && s.group).filter(Boolean))]; }
/** The hotel shown: your choice on this device, else the hotel your name is under, else all. */
function roCurGroup() {
  let g = null;
  try { g = localStorage.getItem('roster_group_v1'); } catch (_) {}
  if (g === null) g = (roStaff[roMeKey] || {}).group || 'all';
  return g === 'all' || !roGroups().includes(g) ? '' : g;
}
function roSetGroup(g) { try { localStorage.setItem('roster_group_v1', g || 'all'); } catch (_) {} roRender(); }
function roInGroup(key) { const g = roCurGroup(); return !g || (roStaff[key] || {}).group === g; }

/** Everyone with something on a date (your hotel unless all), earliest start first. */
function roPeople(date, all) {
  return Object.entries(roDays[date] || {}).map(([k, c]) => ({ key: k, name: (roStaff[k] || {}).name || k, group: (roStaff[k] || {}).group || '', info: roInfo(c) }))
    .filter(x => x.info && (all || roInGroup(x.key)))
    .sort((a, b) => (a.info.from ? _roMin(a.info.from) : 9999) - (b.info.from ? _roMin(b.info.from) : 9999) || a.name.localeCompare(b.name));
}
/** Who is working at a moment (yesterday's overnight shifts count). */
function roWorkingAt(t, all) {
  const d = roIso(t), out = [];
  [roAdd(d, -1), d].forEach(day => roPeople(day, all).forEach(x => { const sp = roSpan(day, x.info); if (sp && sp.start <= t && t < sp.end) out.push(Object.assign({ day }, x)); }));
  return out;
}
/** The night of a date: shifts starting from 18:00 that evening up to 05:00 the next morning. */
function roNight(date, all) {
  const a = roDate(date); a.setHours(18);
  const b = roDate(roAdd(date, 1)); b.setHours(5);
  const out = [];
  [date, roAdd(date, 1)].forEach(day => roPeople(day, all).forEach(x => { const sp = roSpan(day, x.info); if (sp && sp.start >= a && sp.start < b) out.push(Object.assign({ day }, x)); }));
  return out;
}
/** People grouped by their hours: [[label, type, [people]]] */
function roByTime(list) {
  const m = new Map();
  list.forEach(x => { const k = x.info.from ? roTime(x.info) : RO_TYPES[x.info.type]; if (!m.has(k)) m.set(k, [k, x.info.type, []]); m.get(k)[2].push(x); });
  return [...m.values()];
}

/** Your next n days, from today. */
function roMine(n = 7) {
  if (!roMeKey) return [];
  return Array.from({ length: n }, (_, i) => { const d = roAdd(roToday(), i); return { date: d, info: roInfo(roCode(roMeKey, d)) }; });
}
function roNextShift() {
  if (!roMeKey) return null;
  const now = new Date();
  for (let i = -1; i < 21; i++) {
    const d = roAdd(roToday(), i), inf = roInfo(roCode(roMeKey, d));
    if (!inf || inf.type === 'off' || inf.type === 'leave') continue;
    const sp = roSpan(d, inf);
    if (sp ? sp.end <= now : i < 0) continue;            // already over
    return { date: d, info: inf, inDays: i, span: sp, now: !!(sp && sp.start <= now) };
  }
  return null;
}
function _roWhen(n) {
  if (n.now) return `Now, until ${n.info.to === '00:00' ? 'midnight' : n.info.to}`;
  if (!n.span) return n.inDays === 0 ? 'Today' : n.inDays === 1 ? 'Tomorrow' : roDayLbl(n.date, true);
  if (n.info.from === '00:00') { const prev = roAdd(n.date, -1); return prev === roToday() ? 'Tonight at midnight' : `${roDayLbl(prev, true)}, at midnight`; }
  const d = n.date;
  return `${d === roToday() ? 'Today' : d === roAdd(roToday(), 1) ? 'Tomorrow' : roDayLbl(d, true)} at ${n.info.from}`;
}

// ── Page ──────────────────────────────────────────────────
function _roTable(rows, dates, get, editable) {
  const today = roToday();
  const q = s => JSON.stringify(s).replace(/"/g, '&quot;');
  const span = dates.length + 1 + (editable === true ? 1 : 0);
  return `<div class="ro-scroll"><table class="ro-table">
    <thead><tr><th class="ro-name">Name</th>${dates.map(d => `<th class="${d === today ? 'ro-today' : ''}">${escapeHtml(roDayLbl(d))}</th>`).join('')}${editable === true ? '<th></th>' : ''}</tr></thead>
    <tbody>${rows.map(r => r.section ? `<tr class="ro-sec"><td colspan="${span}"><span>${escapeHtml(r.section)}</span></td></tr>` : `<tr class="${r.key === roMeKey ? 'ro-me' : ''}"><td class="ro-name${/\?$/.test(r.name) ? ' ro-unsure' : ''}" title="${escapeHtml(r.name)}">${editable === 'preview' ? `<button class="ro-tap" onclick="roPrevEditName(this,${q(r.key)})" title="Tap to correct">${escapeHtml(r.name)}</button>` : escapeHtml(r.name)}${r.key === roMeKey ? ' <span class="ro-you">you</span>' : ''}</td>${dates.map(d => {
      const v = get(r, d) || '', i = roInfo(v);
      if (editable === 'preview') return `<td class="ro-cell ${i ? 'ro-t-' + i.type : ''}${/\?/.test(v) ? ' ro-unsure' : ''}" data-k="${escapeHtml(r.key)}" data-d="${d}" title="${escapeHtml(v || 'empty')}: tap to correct" onclick="roPrevEdit(this)">${escapeHtml(v === '?' ? '?' : roCellTxt(i))}${i && i.note ? `<i class="ro-note">${escapeHtml(i.note.replace(/\s*\?$/, ''))}</i>` : ''}</td>`;
      return `<td class="ro-cell ${i ? 'ro-t-' + i.type : ''}${d === today ? ' ro-today' : ''}${/\?/.test(v) ? ' ro-unsure' : ''}" data-k="${escapeHtml(r.key)}" data-d="${d}" title="${escapeHtml(i ? i.label + (i.from && !i.label.startsWith(i.from) ? ' ' + roTime(i) : '') : '')}">${editable
        ? `<input value="${escapeHtml(v)}" maxlength="40" onchange="${editable === 'preview' ? 'roPrevSet' : 'roSetCell'}(${q(r.key)},'${d}',this.value)">`
        : `${escapeHtml(roCellTxt(i))}${i && i.note ? `<i class="ro-note">${escapeHtml(i.note)}</i>` : ''}`}</td>`; }).join('')}${editable === true ? `<td><button class="ro-x" title="Clear this week" onclick="roClearPerson(${q(r.key)})">✕</button></td>` : ''}</tr>`).join('')}</tbody>
  </table></div>`;
}

function roWeekRows() {
  const keys = new Set(roWeekAdd[roWeek] || []);
  for (let i = 0; i < 7; i++) Object.keys(roDays[roAdd(roWeek, i)] || {}).forEach(k => keys.add(k));
  const list = [...keys].filter(roInGroup).map(k => ({ key: k, name: (roStaff[k] || {}).name || k, group: (roStaff[k] || {}).group || '', order: (roStaff[k] || {}).order ?? 999 }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  // all hotels: a title line before each hotel's people
  if (roCurGroup() || roGroups().length < 2) return list;
  const out = []; let last = null;
  list.forEach(r => { if (r.group !== last) { out.push({ section: r.group || 'Others' }); last = r.group; } out.push(r); });
  return out;
}

function roRenderSide() {
  // My shifts
  const me = document.getElementById('roMine');
  if (me) {
    const names = Object.keys(roStaff).map(k => ({ k, n: roStaff[k].name || k, g: roStaff[k].group || '' })).sort((a, b) => a.n.localeCompare(b.n));
    if (!roMeKey) {
      me.innerHTML = `<div class="ro-card-hd"><b>My shifts</b></div>${names.length
        ? `<div class="ro-pick"><span>Which one is you? You only choose once.</span><select onchange="roSetMe(this.value)"><option value="">Choose your name…</option>${names.map(x => `<option value="${escapeHtml(x.k)}">${escapeHtml(x.n)}${x.g ? ' · ' + escapeHtml(x.g) : ''}</option>`).join('')}</select></div>`
        : '<div class="ro-empty">No roster yet. ' + (roCanEdit() ? 'Press <b>Add roster</b> and add the roster picture.' : 'Your supervisor adds it here once a week.') + '</div>'}`;
    } else {
      const nx = roNextShift(), st = roStaff[roMeKey] || {};
      me.innerHTML = `<div class="ro-card-hd"><b>My shifts</b><span>${escapeHtml(st.name || roMeKey)}${st.group ? ' · ' + escapeHtml(st.group) : ''} · <a href="javascript:void 0" onclick="roSetMe('')">not you?</a></span></div>
        ${nx ? `<div class="ro-next ro-t-${nx.info.type}${nx.now ? ' is-now' : ''}"><small>${nx.now ? 'On shift now' : 'Next shift'}</small><b>${escapeHtml(_roWhen(nx))}</b><span>${escapeHtml(nx.info.from ? roTime(nx.info) + (nx.info.note ? ' · ' + nx.info.note : '') : nx.info.label)}</span></div>` : '<div class="ro-empty">No shift in the roster for the next three weeks.</div>'}
        <div class="ro-days">${roMine(7).map(x => `<div class="ro-day ${x.info ? 'ro-t-' + x.info.type : 'ro-t-none'}${x.date === roToday() ? ' is-today' : ''}" title="${escapeHtml(x.info ? x.info.label : '')}"><small>${escapeHtml(x.date === roToday() ? 'Today' : roDate(x.date).toLocaleDateString('en-GB', { weekday: 'short' }))}</small><b>${escapeHtml(x.info ? roCellTxt(x.info) : '—')}</b><span>${escapeHtml(x.info ? (x.info.note || (x.info.from ? RO_TYPES[x.info.type] : x.info.label)) : '—')}</span></div>`).join('')}</div>`;
    }
  }
  // Today: everyone's hours on one timeline, with a line at the time now
  const on = document.getElementById('roTodayOn');
  if (on) {
    const g = roCurGroup(), now = new Date(), today = roToday();
    const d0 = roDate(today), d1 = roDate(roAdd(today, 1)), DAY = 864e5;
    const working = new Set(roWorkingAt(now).map(x => x.key));
    const bars = [];   // { key, name, info, a, b (0–1), carry }
    // yesterday's overnight shifts still running this morning
    roPeople(roAdd(today, -1)).forEach(x => { const sp = roSpan(roAdd(today, -1), x.info); if (sp && sp.end > d0) bars.push({ x, a: 0, b: Math.min(1, (sp.end - d0) / DAY), carry: true }); });
    const ppl = roPeople(today);
    ppl.forEach(x => { const sp = roSpan(today, x.info); if (sp) bars.push({ x, a: Math.max(0, (sp.start - d0) / DAY), b: Math.min(1, (Math.min(sp.end, d1) - d0) / DAY), carry: false }); });
    bars.sort((p, q) => p.a - q.a || q.b - p.b || p.x.name.localeCompare(q.x.name));
    const away = ppl.filter(x => x.info.type === 'off' || x.info.type === 'leave');
    const other = ppl.filter(x => !x.info.from && x.info.type !== 'off' && x.info.type !== 'leave');
    const pct = v => (v * 100).toFixed(2) + '%';
    const nowP = (now - d0) / DAY;
    const chip = x => `<b class="${x.key === roMeKey ? 'is-me' : ''}" title="${escapeHtml(x.info.label)}">${escapeHtml(x.name)} <i>${escapeHtml(roCellTxt(x.info))}</i></b>`;
    on.innerHTML = `<div class="ro-card-hd"><b>Today${g ? ' · ' + escapeHtml(g) : ''}</b><span>${escapeHtml(roDayLbl(today, true))}${working.size ? ` · <em class="ro-live">${working.size} on shift now</em>` : ''}</span></div>` + (bars.length || other.length
      ? `<div class="ro-tl" style="--now:${pct(nowP)}">
          <div class="ro-tl-axis"><span></span><div>${[0, 3, 6, 9, 12, 15, 18, 21, 24].map(h => `<i style="left:${pct(h / 24)}">${String(h % 24).padStart(2, '0')}</i>`).join('')}</div></div>
          ${bars.map(({ x, a, b, carry }) => `<div class="ro-tl-row${x.key === roMeKey ? ' is-me' : ''}${working.has(x.key) && (carry || a <= nowP) ? ' is-on' : ''}">
            <span class="ro-tl-name" title="${escapeHtml(x.name)}">${escapeHtml(x.name)}</span>
            <div class="ro-tl-track"><i class="ro-tl-bar ro-t-${x.info.type}${carry ? ' carry' : ''}" style="left:${pct(a)};width:${pct(Math.max(b - a, 0.02))}" title="${escapeHtml(x.name + ' · ' + x.info.label + (carry ? ' (from yesterday)' : ''))}"><em>${escapeHtml(carry ? '…' + x.info.to : roShort(x.info))}${x.info.note && !carry ? ' · ' + escapeHtml(x.info.note) : ''}</em></i></div>
          </div>`).join('')}
        </div>`
        + (other.length ? `<div class="ro-on ro-t-other"><span class="ro-on-k">Other</span><span>${other.map(chip).join('')}</span></div>` : '')
        + (away.length ? `<div class="ro-on ro-t-off"><span class="ro-on-k">Off / leave</span><span>${away.map(chip).join('')}</span></div>` : '')
      : '<div class="ro-empty">Nobody is on the roster for today.</div>');
  }
}

// ── A new roster is posted: tell the team ─────────────────
let roPosted = null;
function roSeen() { try { return +localStorage.getItem('roster_seen_v1') || 0; } catch (_) { return 0; } }
function roIsNew() { return !!(roPosted && roPosted.at > roSeen() && roPosted.byUid !== roMyUid()); }
function roMarkSeen() { if (roPosted) try { localStorage.setItem('roster_seen_v1', String(roPosted.at)); } catch (_) {} roBadge(); }
function roBadge() { const n = roIsNew(); document.querySelectorAll('#nav-roster, .mob-more-item[data-panel="roster"], #tbRoster').forEach(e => e.classList.toggle('ro-has-new', n)); }
function roNotifyOn() { try { return localStorage.getItem('roster_notify_v1') !== '0'; } catch (_) { return true; } }
async function roToggleNotify() {
  const on = !(roNotifyOn() && 'Notification' in window && Notification.permission === 'granted');
  if (on && 'Notification' in window && Notification.permission !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') { showToast('Notifications are blocked. Allow them for this site in the browser settings', 'err'); return; }
  }
  try { localStorage.setItem('roster_notify_v1', on ? '1' : '0'); } catch (_) {}
  showToast(on ? 'You\'ll get a notification when a new roster is posted' : 'Roster notifications off', 'ok');
  roRender();
}
function roNotify(title, body) {
  if (typeof hoChime === 'function') try { hoChime(); } catch (_) {}
  if (!roNotifyOn() || !('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = { body, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'hotelops-roster', data: { panel: 'roster' } };
  const plain = () => { try { new Notification(title, opts); } catch (_) {} };
  if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then(r => r.showNotification(title, opts)).catch(plain); else plain();
}
async function roPost(res) {
  let image = null;
  if (typeof riStorePending === 'function') try { image = await riStorePending(res); } catch (e) { console.warn('[roster] picture', e); }
  roPosted = { at: Date.now(), by: (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || 'Someone', byUid: roMyUid(), from: res.dates[0], to: res.dates[res.dates.length - 1], people: res.names.length, image: image || null };
  fbSet('roster/posted', roPosted);
  roMarkSeen();
}
function roOnPosted(v) {
  roPosted = v || null;
  roBadge();
  if (!v || !roIsNew()) return;
  if (document.getElementById('panel-roster')?.classList.contains('active')) { roMarkSeen(); return; }
  let al = 0; try { al = +localStorage.getItem('roster_alerted_v1') || 0; } catch (_) {}
  if (v.at <= al) return;
  try { localStorage.setItem('roster_alerted_v1', String(v.at)); } catch (_) {}
  const span = `${roDate(v.from).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${roDate(v.to).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  if (v.update) {
    // a change to a posted week: only the people whose shifts changed are told
    const mine = (v.changes || []).filter(c => c.k === roMeKey);
    if (!mine.length) { roMarkSeen(); return; }
    const txt = mine.map(c => `${roDayLbl(c.d)}: ${roCellTxt(roInfo(c.f)) || '—'} → ${roCellTxt(roInfo(c.t)) || '—'}`).join(', ');
    showToast(`🗓️ Your roster changed: ${txt}`, 'warn');
    roNotify('Your roster changed', `${v.by}: ${txt}`);
    return;
  }
  showToast(`🗓️ New roster posted by ${v.by} (${span})`, 'ok');
  roNotify('New roster posted', `${v.by} posted the roster for ${span}. Tap to see your shifts.`);
}

function roRender() {
  const box = document.getElementById('roBody');
  if (!box) return;
  if (!roWeek) roWeek = roMonday(new Date());
  roLoadMe();
  roMarkSeen();
  const bell = document.getElementById('roBellBtn');
  if (bell) { const on = roNotifyOn() && 'Notification' in window && Notification.permission === 'granted'; bell.textContent = on ? '🔔 Alerts on' : '🔕 Alerts off'; bell.title = on ? 'You get a notification when a new roster is posted. Tap to turn off.' : 'Get a notification when a new roster is posted'; }
  const ed = roCanEdit();
  document.getElementById('roEditBtn')?.toggleAttribute('hidden', !ed);
  document.getElementById('roAddBtn')?.toggleAttribute('hidden', !ed);
  document.getElementById('roBuildBtn')?.toggleAttribute('hidden', !ed);
  document.getElementById('roSickBtn')?.toggleAttribute('hidden', !ed);
  document.getElementById('roWhatBtn')?.toggleAttribute('hidden', !ed);
  document.getElementById('roChangeBtn')?.toggleAttribute('hidden', !ed || !Object.keys(roStaff).length);
  const eb = document.getElementById('roEditBtn'); if (eb) { eb.textContent = roEdit ? '✓ Done' : '✏️ Edit'; eb.classList.toggle('gold', roEdit); }
  roRenderSide();
  const dates = [0, 1, 2, 3, 4, 5, 6].map(i => roAdd(roWeek, i));
  const rows = roWeekRows();
  const isNow = roWeek === roMonday(new Date());
  const pic = typeof riPicFor === 'function' ? riPicFor(roWeek) : null;
  box.innerHTML = `
    <div class="ro-weeknav">
      <button class="btn sm" onclick="roGo(-7)" title="Previous week">‹</button>
      <b>${escapeHtml(roDate(dates[0]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))} – ${escapeHtml(roDate(dates[6]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))}</b>
      <button class="btn sm" onclick="roGo(7)" title="Next week">›</button>
      ${isNow ? '<span class="ro-tag">This week</span>' : '<button class="btn sm" onclick="roGo(0)">This week</button>'}
      ${roEdit ? '<button class="btn sm" onclick="roCopyLastWeek()">⧉ Copy last week</button>' : ''}
      ${pic ? `<button class="btn sm" onclick="riOpen('${pic[0]}')" title="The roster picture management sent">📷 Original picture</button>` : ''}
    </div>
    ${roGroups().length > 1 ? `<div class="ro-groups">${['', ...roGroups()].map(g => `<button class="fchip${roCurGroup() === g ? ' on' : ''}" onclick="roSetGroup(${JSON.stringify(g || 'all').replace(/"/g, '&quot;')})">${escapeHtml(g || 'All hotels')}</button>`).join('')}</div>` : ''}
    ${rows.length || roEdit ? _roTable(rows, dates, (r, d) => roCode(r.key, d), roEdit) : pic ? `<div class="ro-empty ro-big">Only the picture is posted for this week. <button class="btn sm gold" onclick="riOpen('${pic[0]}')">📷 Open the roster picture</button>${ed ? '<br><small>Set up AI reading and add the picture again to get My shifts and the timeline, or type the shifts with Edit.</small>' : ''}</div>`
      : `<div class="ro-empty ro-big">No roster for this week yet.${ed ? ' Press <b>Add roster</b> to paste it, or <b>Edit</b> → <b>Copy last week</b>.' : ''}</div>`}
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
  return { panel: 'roster', icon: '🗓️', title: nx && nx.now ? 'On shift now' : 'My next shift', big: nx ? roCellTxt(nx.info) : '—', sub: nx ? _roWhen(nx) + (nx.info.note ? ' · ' + nx.info.note : '') : 'Nothing in the roster yet', tone: nx && nx.now ? 'ok' : 'idle' };
}

// ── Ops Brain ─────────────────────────────────────────────
function roIsQuestion(q) { return RO_COMMANDS.some(c => c.re.test(String(q).trim())); }
function _roOut(html) { if (typeof _bxOut === 'function') _bxOut(html); else { const b = document.getElementById('brAnswers'); if (b) b.innerHTML = `<div class="br-card ba-res">${html}</div>`; } }
const _roOpenBtn = '<div class="br-acts"><button class="btn sm" onclick="typeof brClose===\'function\'&&brClose();showPanel(\'roster\')">Open Roster</button></div>';
function _roList(list) { return roByTime(list).map(([lbl, , xs]) => `<li><b>${escapeHtml(lbl)}</b>: ${xs.map(x => escapeHtml(x.name) + (x.info.note ? ` (${escapeHtml(x.info.note)})` : '')).join(', ')}</li>`).join(''); }
const RO_COMMANDS = [
  { re: /^(my (shifts?|roster|rota|schedule|week|days? off)|when (do|am) i (work|working|on|off)|what'?s my (shift|roster|rota|schedule)|am i (working|on|off)\b.*|my next shift|when is my next shift)\s*\??$/i, ask: true, ex: 'my shifts', does: 'your next 7 days from the roster', run: () => {
      if (!roMeKey) { _roOut(`<div class="br-title">I don't know which name on the roster is you yet.</div>${_roOpenBtn}`); return true; }
      const nx = roNextShift();
      _roOut(`<div class="br-kind">🗓️ Your roster</div><div class="br-title">${nx ? `${nx.now ? 'On shift' : 'Next'}: ${escapeHtml(_roWhen(nx))}${nx.info.from ? ` (${escapeHtml(roTime(nx.info))})` : ''}${nx.info.note ? ' · ' + escapeHtml(nx.info.note) : ''}` : 'No shift in the roster for the next three weeks.'}</div>
        <ul class="ba-ul">${roMine(7).map(x => `<li><b>${escapeHtml(x.date === roToday() ? 'Today' : roDayLbl(x.date))}</b>: ${escapeHtml(x.info ? x.info.label : 'not in the roster')}</li>`).join('')}</ul>${_roOpenBtn}`);
      return true; } },
  { re: /^(who'?s|who is|who are|who)\s+(on|working|on shift|on duty|in|off|on leave)\b.*$|^who works\b.*$/i, ask: true, ex: 'who is on tonight', does: 'who works now, tonight, today or tomorrow', run: q => {
      const g = roCurGroup(), where = g ? ` · ${escapeHtml(g)}` : '';
      const tm = /tomorrow/i.test(q), base = tm ? roAdd(roToday(), 1) : roToday();
      let title, list;
      if (/\b(off|leave)\b/i.test(q)) { list = roPeople(base).filter(x => x.info.type === 'off' || x.info.type === 'leave'); title = `Off or on leave ${tm ? 'tomorrow' : 'today'}`; return _roOut(`<div class="br-kind">🗓️ Roster${where}</div><div class="br-title">${title}</div>${list.length ? `<ul class="ba-ul">${list.map(x => `<li>${escapeHtml(x.name)}: ${escapeHtml(x.info.label)}</li>`).join('')}</ul>` : '<div class="br-body">Nobody.</div>'}${_roOpenBtn}`), true; }
      if (/tonight|night/i.test(q)) {
        const d = tm ? base : (new Date().getHours() < 7 ? roAdd(roToday(), -1) : roToday());   // after midnight, "tonight" began yesterday evening
        list = roNight(d); title = `The night of ${roDayLbl(d, true)}`;
      } else if (/\bnow\b|right now|at the moment|currently/i.test(q) || !/today|tomorrow|morning|afternoon|evening/i.test(q) && !tm) {
        list = roWorkingAt(new Date()); title = 'On shift right now';
      } else {
        list = roPeople(base).filter(x => x.info.type !== 'off' && x.info.type !== 'leave');
        if (/morning/i.test(q)) list = list.filter(x => x.info.type === 'morning');
        if (/afternoon|evening/i.test(q)) list = list.filter(x => x.info.type === 'afternoon');
        title = roDayLbl(base, true);
      }
      _roOut(`<div class="br-kind">🗓️ Roster${where}</div><div class="br-title">${escapeHtml(title)}</div>${list.length ? `<ul class="ba-ul">${_roList(list)}</ul>` : '<div class="br-body">Nobody on the roster for that.</div>'}${_roOpenBtn}`);
      return true; } },
];

// ── Start ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (typeof BA_COMMANDS !== 'undefined') BA_COMMANDS.unshift(...RO_COMMANDS);
  if (typeof BR_FAQ !== 'undefined') BR_FAQ.push({ q: 'roster rota schedule my shifts day off who is working add the roster', t: 'Roster', a: 'Open <b>Roster</b> (🗓 in the top bar). Supervisors and managers press <b>Add roster</b> and add the roster picture (read on the device, free) or paste it from Excel, once a week; everyone then sees <b>My shifts</b> and who is on today. Ask me "my shifts" or "who is on tonight".', go: 'roster', kind: '💡 How the app works' });
  setTimeout(() => {
    if (typeof fbListen !== 'function') return;
    fbListen('roster/days', v => { roDays = v || {}; _roRefresh(); });
    fbListen('roster/staff', v => { roStaff = v || {}; roGuessMe(); _roRefresh(); });
    fbListen('roster/codes', v => { roCodes = v || {}; _roRefresh(); });
    fbListen('roster/posted', roOnPosted);
  }, 1500);
  // the timeline's "now" line moves while the page is open
  setInterval(() => { if (document.getElementById('panel-roster')?.classList.contains('active') && !roEdit) roRenderSide(); }, 60000);
  // opened from a "new roster" notification
  if (/[?&]panel=roster\b/.test(location.search)) setTimeout(() => { if (typeof showPanel === 'function') showPanel('roster'); }, 2600);
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.panel === 'roster' && typeof showPanel === 'function') showPanel('roster'); });
  (window.BL_THINKERS = window.BL_THINKERS || []).push(add => {
    if (!roIsNew()) return;
    add({ id: 'rosterNew:' + roPosted.at, type: 'roster', icon: '🗓️', tone: 'idle', text: `New roster posted by ${roPosted.by}.`, why: 'Your shifts for the coming days are in.',
      acts: [['Show my shifts', () => showPanel('roster')]] });
  });
  // supervisors: a nudge when next week's roster isn't in by Thursday
  (window.BL_THINKERS = window.BL_THINKERS || []).push(add => {
    if (!roCanEdit() || !Object.keys(roStaff).length) return;
    const wd = new Date().getDay();
    if (wd < 4 && wd !== 0) return;
    const next = roAdd(roMonday(new Date()), 7);
    const has = [0, 1, 2, 3, 4, 5, 6].some(i => Object.keys(roDays[roAdd(next, i)] || {}).length);
    if (has) return;
    add({ id: 'roster:' + next, type: 'roster', icon: '🗓️', tone: 'idle', text: 'Next week\'s roster isn\'t in HotelOps yet.', why: 'Paste it once and the team sees their shifts on their phones.',
      acts: [['Build it', () => { if (typeof rbOpen === 'function') rbOpen(); }], ['Add roster', () => { showPanel('roster'); setTimeout(() => roImportOpen(true), 300); }]] });
  });
});
function _roRefresh() {
  clearTimeout(_roRefresh._t);
  _roRefresh._t = setTimeout(() => {
    if (document.getElementById('panel-roster')?.classList.contains('active')) roRender();
    if (document.getElementById('panel-home')?.classList.contains('active') && typeof homeRender === 'function') homeRender();
  }, 150);
}

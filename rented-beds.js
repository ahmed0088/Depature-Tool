/* Rented rooms and beds: independent date-range reporting. No guest or financial writes. */
(function (root) {
  'use strict';
  const MONTHS = 'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ');
  const TYPES = ['LABEL', 'ROOM_TYPE', 'ROOM_CATEGORY_LABEL', 'ROOM_CLASS', 'ROOM_CATEGORY'];
  const DESCS = ['SHORT_DESCRIPTION', 'DESCRIPTION', 'ROOM_CATEGORY_DESC', 'ROOM_TYPE_DESC', 'ROOM_DESCRIPTION', 'LONG_DESCRIPTION'];
  const PROPS = ['RESORT', 'RESORT_CODE', 'PROPERTY_CODE', 'HOTEL_CODE', 'PROPERTY', 'HOTEL', 'RESORT_NAME', 'PROPERTY_NAME', 'HOTEL_NAME'];
  const known = { SGC: 1, TWC: 2, KGD: 1, TWD: 2, KGB: 1, KGBCI: 1 };
  function date(value) {
    const s = String(value == null ? '' : value).trim(); let y, m, d, a;
    if ((a = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]00:00(?::00)?)?$/))) [, y, m, d] = a;
    else if ((a = s.match(/^(\d{1,2})[- /](JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[- /](\d{2}|\d{4})$/i))) { d = a[1]; m = MONTHS.indexOf(a[2].toUpperCase()) + 1; y = a[3]; }
    else if ((a = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{2}|\d{4})$/))) { d = a[1]; m = a[2]; y = a[3]; }
    else return '';
    y = +y + (String(y).length === 2 ? 2000 : 0); m = +m; d = +d;
    const t = new Date(Date.UTC(y, m - 1, d));
    return y >= 1900 && y <= 2199 && t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : '';
  }
  const count = v => /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.0+)?$/.test(String(v).trim()) && Number.isSafeInteger(+String(v).replace(/,/g, '')) ? +String(v).replace(/,/g, '') : null;
  function guess(type, description) {
    const n = String(description || '').match(/\b([1-9])\s*(?:x\s*)?(?:single|double|king(?:\s*size)?|queen|twin|sofa)?\s*beds?\b/i);
    return known[String(type).toUpperCase()] || (n ? +n[1] : /twin/i.test(description || '') || /^TW/i.test(type) ? 2 : 1);
  }
  function cells(text) {
    const first = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).slice(0, 25).join('\n');
    const sep = first.includes('\t') ? '\t' : first.includes(';') ? ';' : ',';
    const out = []; let row = [], value = '', quote = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"' && (quote || value === '')) { if (quote && text[i + 1] === '"') { value += '"'; i++; } else quote = !quote; }
      else if (!quote && (c === sep || c === '\n' || c === '\r')) { row.push(value); value = ''; if (c !== sep) { out.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; } }
      else value += c;
    }
    if (value || row.length) { row.push(value); out.push(row); }
    return out;
  }
  function parseRows(rows, source) {
    const records = [], issues = []; let header = null, kind = '', found = false;
    const normal = v => String(v || '').replace(/^\uFEFF/, '').trim().toUpperCase().replace(/[ -]+/g, '_');
    rows.forEach((p, i) => {
      const h = p.map(normal);
      if ((h.includes('STAY_ROOMS') && h.includes('BUSINESS_DATE')) || (h.includes('NO_ROOMS') && h.includes('CONSIDERED_DATE'))) {
        header = Object.fromEntries(h.map((k, j) => [k, j])); kind = h.includes('STAY_ROOMS') ? 'type' : 'history'; found = true; return;
      }
      if (!header || !p.some(v => String(v || '').trim())) return;
      const get = k => header[k] === undefined ? '' : String(p[header[k]] == null ? '' : p[header[k]]).trim();
      const ds = get(kind === 'type' ? 'BUSINESS_DATE' : 'CONSIDERED_DATE');
      if (!ds || /^(?:grand\s*)?total\b/i.test(ds)) return;
      const day = date(ds), n = count(get(kind === 'type' ? 'STAY_ROOMS' : 'NO_ROOMS')), property = get(PROPS.find(k => get(k)));
      if (!day || n === null) { issues.push({ source, line: i + 1, date: day, property, message: !day ? 'Invalid business date: ' + ds : 'Missing or invalid room count.' }); return; }
      const type = kind === 'type' ? get(TYPES.find(k => header[k] !== undefined)) : '';
      if (kind === 'type' && (!type || /^(?:grand\s*)?totals?$/i.test(type))) { if (!/total/i.test(type)) issues.push({ source, line: i + 1, date: day, property, message: 'Missing room type; this row cannot determine beds.' }); return; }
      records.push({ kind, date: day, rooms: n, type, description: get(DESCS.find(k => header[k] !== undefined)), property, source, line: i + 1 });
    });
    if (!found) throw Error('Use Opera Room Type Statistics (STAY_ROOMS / BUSINESS_DATE) or History Forecast (NO_ROOMS / CONSIDERED_DATE).');
    if (!records.length) throw Error(issues[0]?.message || 'No dated room counts were found in this file.');
    return { records, issues };
  }
  function parseText(text, source) { return parseRows(cells(String(text || '')), source || 'Pasted report'); }
  function parsePdfLines(lines, source) {
    const records = [], issues = [];
    (lines || []).forEach((line, i) => {
      const s = String(line).replace(/\s+/g, ' ').trim();
      const m = s.match(/^(\d{1,2}[-./]\d{1,2}[-./]\d{2,4}) (\S+) (.*?) (\d+) (\d+) (\d+) (-?[\d,]+\.\d{2})$/);
      if (!m) { if (/^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}\s/.test(s)) issues.push({ source, line: i + 1, date: date(s.split(' ')[0]), message: 'A dated PDF row could not be read. Use Delimited Data for this row.' }); return; }
      if (/^(?:grand)?total/i.test(m[2])) return;
      const day = date(m[1]);
      if (!day) { issues.push({ source, line: i + 1, message: 'Invalid business date: ' + m[1] }); return; }
      records.push({ kind: 'type', date: day, type: m[2], description: m[3], rooms: +m[5], property: '', source, line: i + 1 });
    });
    if (!records.length) throw Error('No Room Type Statistics rows found in this PDF. Delimited Data is recommended.');
    return { records, issues };
  }
  function merge(files, property) {
    const map = new Map(), issues = [], types = {}; let duplicates = 0; const duplicateDates = [];
    for (const file of files) {
      issues.push(...file.issues.filter(v => v.property === undefined || v.property === property).map(v => ({ ...v, severity: 'check' })));
      for (const record of file.records) {
        if (record.property !== property) continue;
        const k = JSON.stringify([record.kind, record.date, record.type]); const prior = map.get(k);
        if (record.kind === 'type') types[record.type] = record.description || types[record.type] || '';
        if (!prior) map.set(k, { ...record, sources: [record.source], conflict: false });
        else {
          if (!prior.sources.includes(record.source)) prior.sources.push(record.source);
          if (prior.rooms === record.rooms) { duplicates++; duplicateDates.push(record.date); }
          else { prior.conflict = true; issues.push({ severity: 'conflict', date: record.date, source: prior.sources.join(' / '), message: (record.type || 'History Forecast') + ': conflicting counts ' + prior.rooms + ' and ' + record.rooms + '. Remove the outdated file before counting this day.' }); }
        }
      }
    }
    return { records: [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type)), types, issues, duplicates, duplicateDates };
  }
  function calculate(files, options) {
    const from = date(options.from), to = date(options.to);
    if (!from || !to || from > to) throw Error('Choose a valid start and end date.');
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
    if (days > 3660) throw Error('Choose a date range of ten years or less.');
    const merged = merge(files, options.property || '');
    const records = merged.records.filter(v => v.date >= from && v.date <= to);
    const types = Object.fromEntries(Object.entries(merged.types).filter(([t]) => records.some(r => r.type === t)));
    const per = {}; for (const t of Object.keys(types)) { const n = +(options.beds?.[t] ?? guess(t, types[t])); if (!Number.isInteger(n) || n < 1 || n > 9) throw Error('Beds per room must be a whole number from 1 to 9 (' + t + ').'); per[t] = n; }
    const issues = merged.issues.filter(v => !v.date || (v.date >= from && v.date <= to));
    const byDate = new Map(); for (const r of records) { if (!byDate.has(r.date)) byDate.set(r.date, []); byDate.get(r.date).push(r); }
    const daily = [], monthly = new Map();
    for (let n = 0; n < days; n++) {
      const day = new Date(Date.parse(from) + n * 86400000).toISOString().slice(0, 10), data = byDate.get(day) || [], h = data.find(v => v.kind === 'history'), rt = data.filter(v => v.kind === 'type');
      let rooms = null, beds = null, extra = null, status = 'Missing data', reason = 'No report rows for this date.';
      const typeRooms = rt.reduce((s, r) => s + r.rooms, 0), typeBeds = rt.reduce((s, r) => s + r.rooms * per[r.type], 0);
      if (issues.some(v => v.date === day && v.severity !== 'conflict')) { status = 'Invalid source row'; reason = 'Correct unreadable or invalid rows for this date; this day is excluded from totals.'; }
      else if (data.some(v => v.conflict)) { status = 'Conflicting files'; reason = 'Remove conflicting source files; this day is excluded from totals.'; }
      else if (rt.length && options.allTypes !== false) {
        if (h && h.rooms !== typeRooms) { status = 'Room totals differ'; reason = 'History Forecast: ' + h.rooms + '; room types: ' + typeRooms + '. Check report scope; this day is excluded from totals.'; }
        else { rooms = typeRooms; beds = typeBeds; extra = beds - rooms; status = 'Counted'; reason = 'All room types × configured beds per room' + (h ? '; History Forecast matches.' : '.'); }
      } else if (h) {
        rooms = h.rooms;
        if (rooms === 0) { beds = 0; extra = 0; status = 'Counted'; reason = 'History Forecast reports zero rented rooms.'; }
        else if (rt.length && typeRooms <= rooms && options.allTypes === false) { extra = typeBeds - typeRooms; beds = rooms + extra; status = 'Counted with partial types'; reason = 'History Forecast rooms + extra beds in supplied room types. Other types assumed one bed per room.'; }
        else { status = 'Beds need room types'; reason = 'Room total is available; add Room Type Statistics to calculate beds.'; }
      } else if (rt.length) { status = 'History Forecast needed'; reason = 'Partial room types cannot determine all rooms or beds.'; }
      const row = { date: day, rooms, beds, extra, status, reason, sources: [...new Set(data.flatMap(v => v.sources))].join(' / ') };
      if (!Number.isSafeInteger(beds ?? 0) || !Number.isSafeInteger(rooms ?? 0)) throw Error('A report count exceeds the supported numeric range.');
      daily.push(row);
      const k = day.slice(0, 7); if (!monthly.has(k)) monthly.set(k, { month: k, days: 0, countedDays: 0, roomDays: 0, rooms: 0, beds: 0, extra: 0 });
      const m = monthly.get(k); m.days++; if (rooms !== null) { m.rooms += rooms; m.roomDays++; } if (beds !== null) { m.beds += beds; m.extra += extra; m.countedDays++; }
    }
    const months = [...monthly.values()], rooms = months.reduce((n, m) => n + m.rooms, 0), beds = months.reduce((n, m) => n + m.beds, 0), countedDays = months.reduce((n, m) => n + m.countedDays, 0), roomDays = months.reduce((n, m) => n + m.roomDays, 0);
    if (![rooms, beds].every(Number.isSafeInteger)) throw Error('The report total exceeds the supported numeric range.');
    const checks = [...issues, ...daily.filter(v => !v.status.startsWith('Counted')).map(v => ({ date: v.date, source: v.sources, severity: 'check', message: v.reason }))];
    const unconfirmedTypes = Object.keys(types).filter(t => !known[t.toUpperCase()] && !options.confirmed?.[t]);
    for (const t of unconfirmedTypes) checks.push({ severity: 'check', source: t, message: 'Confirm beds per room for ' + t + ': currently ' + per[t] + ' (suggested from code/description).' });
    return { from, to, property: options.property || '', hotel: options.hotel || options.property || 'Hotel', days, roomDays, countedDays, rooms, beds, extra: months.reduce((n, m) => n + m.extra, 0), daily, months, types, per, records, checks, duplicates: merged.duplicateDates.filter(d => d >= from && d <= to).length, allTypes: options.allTypes !== false, complete: countedDays === days && !checks.length, unconfirmedTypes };
  }
  const number = n => n == null ? '—' : n.toLocaleString('en-GB');
  function workbook(r, generated) {
    const coverage = r.complete ? 'Complete for selected dates' : 'Partial / checks required';
    const styles = [{ color: '243449' }, { bold: true, color: 'FFFFFF', fill: '152D47', size: 18 }, { color: '52647A', fill: 'F1F5F9', wrap: true }, { bold: true, color: 'FFFFFF', fill: '236D86', wrap: true }, { fill: 'F1F5F9', numFmtId: 3 }, { numFmtId: 3 }, { bold: true, fill: 'DBECE7', color: '164E43', numFmtId: 3 }, { fill: 'FFF2D7', color: '805B17', wrap: true }, { fill: 'F1F5F9', wrap: true }, { wrap: true }];
    const sheets = [];
    function sheet(name, headers, data, cols, total) {
      const rows = [['RENTED ROOMS & BEDS · ' + name.toUpperCase()], [r.hotel + (r.property ? ' · Opera property ' + r.property : '')], [r.from + ' to ' + r.to + ' · ' + coverage], ['Generated ' + generated + ' · Rented rooms/beds are daily room-nights/bed-nights; not unique rooms, guests or revenue.'], [], headers, ...data];
      if (total) rows.push(total);
      sheets.push({ name, rows, cols, freezeRows: 6, filterRow: 6, filterEnd: 6 + data.length, merges: [0, 1, 2, 3].map(i => 'A' + (i + 1) + ':' + String.fromCharCode(64 + headers.length) + (i + 1)), styleAt: (i, c) => i === 0 ? 1 : i < 4 ? 2 : i === 5 ? 3 : total && i === rows.length - 1 ? 6 : i > 5 ? (typeof rows[i][c] === 'number' ? (i % 2 ? 4 : 5) : (i % 2 ? 8 : 9)) : 0 });
    }
    sheet('Summary', ['Metric', 'Value', 'Explanation'], [
      ['Rented rooms', r.roomDays ? r.rooms : null, 'Sum of reported daily rented rooms (' + r.roomDays + ' of ' + r.days + ' days).'],
      ['Rented beds', r.countedDays ? r.beds : null, 'Sum of calculated daily beds (' + r.countedDays + ' of ' + r.days + ' days).'],
      ['Extra beds above rooms', r.countedDays ? r.extra : null, 'Additional bed capacity in rented rooms; not extra-bed charges.'],
      ['Report status', coverage, 'Missing/conflicting days are blank and excluded, never treated as zero.'],
      ['Days in selected range', r.days, 'Inclusive start and end dates.'], ['Days counted for beds', r.countedDays, 'Only days with enough consistent data.'],
      ['Checks', r.checks.length, 'See Checks sheet. Confirm room-type setup before relying on totals.'], ['Identical overlapping rows ignored', r.duplicates, 'Conflicting copies are excluded until resolved.'],
      ['Calculation', r.allTypes ? 'All room types' : 'Partial types + History Forecast', r.allTypes ? 'Sum of each room type × its beds per room.' : 'Other room types are assumed to have one bed; verify this assumption.']
    ], [34, 35, 95]);
    sheet('Monthly totals', ['Month', 'Rented rooms', 'Rented beds', 'Extra beds', 'Days counted', 'Days in range', 'Coverage'], r.months.map(m => [m.month, m.roomDays ? m.rooms : null, m.countedDays ? m.beds : null, m.countedDays ? m.extra : null, m.countedDays, m.days, m.countedDays === m.days ? 'All days counted' : 'Incomplete']), [18, 20, 20, 18, 18, 18, 28], ['TOTAL', r.roomDays ? r.rooms : null, r.countedDays ? r.beds : null, r.countedDays ? r.extra : null, r.countedDays, r.days, coverage]);
    sheet('Daily totals', ['Business date', 'Day', 'Rented rooms', 'Rented beds', 'Extra beds', 'Status', 'Explanation', 'Source files'], r.daily.map(d => [d.date, new Date(d.date + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' }), d.rooms, d.beds, d.extra, d.status, d.reason, d.sources]), [18, 17, 20, 20, 18, 30, 95, 65], ['TOTAL', '', r.roomDays ? r.rooms : null, r.countedDays ? r.beds : null, r.countedDays ? r.extra : null, coverage]);
    sheet('Room setup', ['Room type', 'Description', 'Beds per room', 'Setup'], Object.keys(r.types).sort().map(t => [t, r.types[t], r.per[t], r.unconfirmedTypes.includes(t) ? 'Suggested — confirm' : 'Known / confirmed']), [20, 65, 20, 30]);
    sheet('Source records', ['Date', 'Report', 'Room type', 'Description', 'Reported rooms', 'Beds per room', 'Calculated type beds', 'Property', 'Source files', 'Check'], r.records.map(v => [v.date, v.kind === 'type' ? 'Room Type Statistics' : 'History Forecast', v.type, v.description, v.rooms, v.kind === 'type' ? r.per[v.type] : null, v.kind === 'type' && !v.conflict ? v.rooms * r.per[v.type] : null, v.property, v.sources.join(' / '), v.conflict ? 'Conflict — excluded from totals' : 'Source evidence; not an additional total']), [18, 25, 20, 50, 20, 20, 25, 20, 65, 55]);
    sheet('Checks', ['Date', 'Source', 'Check'], r.checks.length ? r.checks.map(v => [v.date || '', v.source || '', v.message]) : [['', '', 'No unresolved checks for the selected range.']], [18, 55, 110]);
    return { sheets, styles };
  }
  const API = { date, count, guess, cells, parseRows, parseText, parsePdfLines, merge, calculate, workbook };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.RentedBeds = API;
  if (typeof document === 'undefined') return;
  const S = { files: [], result: null, property: '', busy: false, nextId: 1, periodMode: 'auto' };
  API.state = S;
  const $ = id => document.getElementById(id), esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function config() {
    try { return JSON.parse(localStorage.getItem('ho_rent_period_setup:' + (typeof _meHotel === 'function' ? _meHotel() : 'hotel') + ':' + S.property) || '{}'); } catch (_) { return {}; }
  }
  function saveSetup(t, n) { const saved = config(); saved[t] = n; localStorage.setItem('ho_rent_period_setup:' + (typeof _meHotel === 'function' ? _meHotel() : 'hotel') + ':' + S.property, JSON.stringify(saved)); }
  function options() {
    const saved = config(); let legacy = {}; try { if (typeof rentBedsSaved === 'function') legacy = rentBedsSaved(); } catch (_) {}
    return { property: S.property, from: $('rbFrom').value, to: $('rbTo').value, hotel: $('rbHotel').value.trim(), allTypes: $('rbAllTypes').checked, beds: { ...legacy, ...saved }, confirmed: { ...legacy, ...saved } };
  }
  function message(s) { $('rbMessage').textContent = s || ''; $('rbMessage').hidden = !s; }
  function dates(all) {
    const values = S.files.flatMap(f => f.records.filter(r => r.property === S.property).map(r => r.date)).sort();
    if (values.length && (all || !$('rbFrom').value)) { $('rbFrom').value = values[0]; $('rbTo').value = values.at(-1); $('rbYear').value = values[0].slice(0, 4); }
  }
  function sources() {
    const properties = [...new Set(S.files.flatMap(f => f.records.map(r => r.property)))].sort();
    if (!properties.includes(S.property)) S.property = properties[0] || '';
    $('rbProperty').innerHTML = properties.map(p => '<option value="' + esc(p) + '">' + esc(p || 'Property not encoded in file') + '</option>').join('');
    $('rbPropertyWrap').hidden = properties.length < 2;
    $('rbFiles').innerHTML = S.files.map(f => '<div class="rb-file"><span><b>' + esc(f.name) + '</b><small>' + number(f.records.length) + ' source rows · ' + f.records[0].date + ' to ' + f.records.at(-1).date + '</small></span><button class="btn sm" type="button" data-rb-remove="' + f.id + '" aria-label="Remove ' + esc(f.name) + '">Remove</button></div>').join('');
  }
  async function load(files) {
    if (S.busy) return; S.busy = true; if (!$('rbHotel').value.trim()) { try { $('rbHotel').value = typeof _meHotel === 'function' ? _meHotel() || '' : ''; } catch (_) {} } $('rbBrowse').disabled = true; message('Reading reports…'); const failures = [];
    for (const f of files) {
      try {
        let parsed;
        if (/\.pdf$/i.test(f.name)) parsed = parsePdfLines(await rentReadPdf(f), f.name);
        else if (/\.xlsx?$/i.test(f.name)) {
          if (typeof XLSX === 'undefined') throw Error('The Excel reader is still loading. Try again shortly.');
          const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true }), results = [];
          for (const name of wb.SheetNames) { try { results.push(parseRows(XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' }).map(row => row.map(v => v instanceof Date ? v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0') : v)), f.name + ' · ' + name)); } catch (_) {} }
          if (!results.length) throw Error('No Opera Room Type Statistics or History Forecast columns found in this workbook.');
          parsed = { records: results.flatMap(v => v.records), issues: results.flatMap(v => v.issues) };
        } else parsed = parseText(await f.text(), f.name);
        parsed.records.sort((a, b) => a.date.localeCompare(b.date)); S.files.push({ ...parsed, id: S.nextId++, name: f.name });
      } catch (e) { failures.push(f.name + ': ' + e.message); }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    S.busy = false; $('rbBrowse').disabled = false; sources(); dates(S.periodMode === 'auto'); render(); if (failures.length) message(failures.join('\n'));
  }
  function render() {
    S.result = null; $('rbExport').disabled = true;
    if (!S.files.length) { $('rbResults').hidden = true; message(''); return; }
    try {
      const r = calculate(S.files, options()); S.result = r; message(''); $('rbResults').hidden = false;
      $('rbRooms').textContent = r.roomDays ? number(r.rooms) : '—'; $('rbBeds').textContent = r.countedDays ? number(r.beds) : '—'; $('rbCoverage').textContent = r.countedDays + ' / ' + r.days;
      $('rbStatus').textContent = r.complete ? 'All dates counted' : 'Partial report · ' + r.checks.length + ' checks'; $('rbStatus').classList.toggle('rb-warn', !r.complete);
      $('rbPeriodText').textContent = r.from + ' → ' + r.to + (r.duplicates ? ' · ' + r.duplicates + ' identical overlapping rows ignored' : '');
      $('rbMonths').innerHTML = r.months.map(m => '<tr><th scope="row">' + esc(new Date(m.month + '-01T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })) + '</th><td>' + (m.roomDays ? number(m.rooms) : '—') + '</td><td>' + (m.countedDays ? number(m.beds) : '—') + '</td><td>' + m.countedDays + ' / ' + m.days + '</td></tr>').join('') + '<tr class="rb-total"><th scope="row">Total for selected dates</th><td>' + (r.roomDays ? number(r.rooms) : '—') + '</td><td>' + (r.countedDays ? number(r.beds) : '—') + '</td><td>' + r.countedDays + ' / ' + r.days + '</td></tr>';
      $('rbSetup').innerHTML = Object.keys(r.types).sort().map(t => '<label class="rb-type"><span><b>' + esc(t) + '</b><small>' + esc(r.types[t]) + (r.unconfirmedTypes.includes(t) ? ' · confirm suggestion' : '') + '</small></span><input data-rb-type="' + esc(t) + '" type="number" min="1" max="9" step="1" value="' + r.per[t] + '" aria-label="Beds per ' + esc(t) + ' room"><button type="button" class="btn sm" data-rb-confirm="' + esc(t) + '">' + (r.unconfirmedTypes.includes(t) ? 'Confirm' : 'Save') + '</button></label>').join('');
      $('rbCheckSummary').textContent = 'Checks and missing dates (' + r.checks.length + ')'; $('rbChecks').innerHTML = r.checks.length ? r.checks.slice(0, 80).map(v => '<li><b>' + esc(v.date || v.source || 'Report') + '</b> ' + esc(v.message) + '</li>').join('') + (r.checks.length > 80 ? '<li>All ' + r.checks.length + ' checks are included in Excel.</li>' : '') : '<li>No unresolved checks for this date range.</li>';
      $('rbDaily').innerHTML = r.daily.map(d => '<tr><th scope="row">' + d.date + '</th><td>' + number(d.rooms) + '</td><td>' + number(d.beds) + '</td><td title="' + esc(d.reason) + '">' + esc(d.status) + '</td></tr>').join('');
      $('rbExport').disabled = !r.records.length; $('rbExport').textContent = r.complete ? 'Download Excel report' : 'Download Excel · partial report';
    } catch (e) { $('rbResults').hidden = true; message(e.message); }
  }
  function download(r) {
    const generated = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dubai' }) + ' (Dubai)', wb = workbook(r, generated);
    downloadStyledWorkbook('Rented_beds_' + r.from + '_to_' + r.to + '.xlsx', wb.sheets, wb.styles);
  }
  API.render = render; API.load = load; API.download = download;
  function mount() {
    if (!$('rentPeriodReport')) return;
    try { $('rbHotel').value = typeof _meHotel === 'function' ? _meHotel() || '' : ''; } catch (_) {}
    $('rbYear').value = new Date().getFullYear();
    $('rbBrowse').onclick = () => { $('rbUpload').value = ''; $('rbUpload').click(); }; $('rbUpload').onchange = e => load(Array.from(e.target.files));
    $('rbFullYear').onclick = () => { const y = +$('rbYear').value; if (!Number.isInteger(y) || y < 1900 || y > 2199) return message('Choose a year from 1900 to 2199.'); S.periodMode = 'manual'; $('rbFrom').value = y + '-01-01'; $('rbTo').value = y + '-12-31'; render(); };
    $('rbAllDates').onclick = () => { S.periodMode = 'auto'; dates(true); render(); };
    for (const id of ['rbFrom', 'rbTo', 'rbAllTypes', 'rbHotel']) $(id).addEventListener('change', () => { if (id === 'rbFrom' || id === 'rbTo') S.periodMode = 'manual'; render(); });
    $('rbProperty').onchange = () => { S.property = $('rbProperty').value; dates(S.periodMode === 'auto'); render(); };
    $('rbFiles').onclick = e => { const b = e.target.closest('[data-rb-remove]'); if (b) { S.files = S.files.filter(f => f.id !== +b.dataset.rbRemove); sources(); render(); } };
    $('rbSetup').onclick = e => { const b = e.target.closest('[data-rb-confirm]'); if (!b) return; const t = b.dataset.rbConfirm, input = Array.from($('rbSetup').querySelectorAll('[data-rb-type]')).find(el => el.dataset.rbType === t), n = +input.value; if (!Number.isInteger(n) || n < 1 || n > 9) return message('Beds per room must be a whole number from 1 to 9.'); try { saveSetup(t, n); render(); } catch (_) { message('Could not save the room setup on this device. Check available browser storage.'); } };
    $('rbClear').onclick = () => { S.files = []; S.result = null; S.periodMode = 'auto'; $('rbFrom').value = $('rbTo').value = ''; sources(); render(); };
    $('rbExport').onclick = () => { if (S.result) download(S.result); };
    const zone = $('rbDrop'); zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); }); zone.addEventListener('dragleave', () => zone.classList.remove('over')); zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); load(Array.from(e.dataTransfer.files)); });
    for (const b of document.querySelectorAll('[data-rent-view]')) b.onclick = () => { const period = b.dataset.rentView === 'period'; $('rentPeriodReport').hidden = !period; $('rentMonthlyReport').hidden = period; document.querySelectorAll('[data-rent-view]').forEach(btn => { btn.classList.toggle('active', btn === b); btn.setAttribute('aria-selected', String(btn === b)); }); };
    $('rentMonthExcel').onclick = () => {
      try {
        const files = []; for (const id of ['rentInput1', 'rentInput2']) { const text = $(id).value.trim(); if (text) files.push(parseText(text, id === 'rentInput1' ? 'Monthly report 1' : 'Monthly report 2')); }
        if (root._rentPdf?.lines) files.push(parsePdfLines(root._rentPdf.lines, root._rentPdf.name));
        if (!files.length) throw Error('Upload the dated Opera reports first.');
        const records = files.flatMap(f => f.records), properties = [...new Set(records.map(r => r.property))], days = records.map(r => r.date).sort();
        if (properties.length !== 1) throw Error('Use Year / custom report to select one Opera property before exporting.');
        if (new Set(days.map(d => d.slice(0, 7))).size !== 1) throw Error('Use Year / custom report for files covering more than one month.');
        let saved = {}; try { if (typeof rentBedsSaved === 'function') saved = rentBedsSaved(); } catch (_) {}
        const report = calculate(files, { property: properties[0], from: days[0].slice(0, 7) + '-01', to: days.at(-1), hotel: typeof _meHotel === 'function' ? _meHotel() : '', beds: { ...saved, ...(root._rentPer || {}) }, confirmed: saved, allTypes: !!root._rentRT && Object.keys(root._rentRT.types).some(t => !/^TW/i.test(t) && !/twin/i.test(root._rentRT.types[t])) });
        download(report);
        if (!report.complete && typeof showToast === 'function') showToast('Excel downloaded with checks. See the Checks sheet for missing dates or room setup.');
      } catch (e) { if (typeof showToast === 'function') showToast(e.message, 'err'); }
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})(typeof window !== 'undefined' ? window : globalThis);

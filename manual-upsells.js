// Manual sales: report-only reconciliation. No reservation or IN-Gauge writes.
(function (global) {
  'use strict';
  const clean = v => String(v ?? '').trim();
  const norm = v => clean(v).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\b(MR|MRS|MS|MISS|DR|MSTR|MASTER|PROF)\b/g, ' ').match(/[A-Z]+/g)?.sort().join(' ') || '';
  const searchNorm = v => clean(v).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const id = v => clean(v).replace(/\.0$/, '');
  const room = v => id(v).replace(/^0+(?=\d)/, '');
  const esc = v => clean(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const products = { '1061': 'Early Check In', '1062': 'Late Check Out', '2090': 'Breakfast' };
  const labels = { add: 'What to add', review: 'Needs review', coverage: 'Await newer export', existing: 'Already submitted', package: 'Automatic packages' };
  const money = cents => (cents / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function amount(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
    let s = clean(v).replace(/,/g, '');
    if (!s) return 0;
    if (/^\(\d+(?:\.\d+)?\)$/.test(s)) s = '-' + s.slice(1, -1);
    if (!/^-?\d+(?:\.\d{1,2})?$/.test(s)) return null;
    const negative = s.startsWith('-'); s = s.replace(/^-/, '');
    const [whole, fraction = ''] = s.split('.');
    const n = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    return Number.isSafeInteger(n) ? (negative ? -n : n) : null;
  }
  function date(v) {
    if (v instanceof Date || Object.prototype.toString.call(v) === '[object Date]') {
      if (!Number.isFinite(v.getTime())) return '';
      return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
    }
    if (typeof v === 'number' && v >= 20000 && v <= 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000).toISOString().slice(0, 10);
    const s = clean(v); let y, m, d, a;
    if ((a = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/))) [, y, m, d] = a;
    else if ((a = s.match(/^(\d{1,2})[-/.]([A-Za-z]{3}|\d{1,2})[-/.](\d{2}|\d{4})$/))) {
      d = a[1]; m = /^\d+$/.test(a[2]) ? a[2] : ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(a[2].toUpperCase()) + 1;
      y = a[3].length === 2 ? '20' + a[3] : a[3];
    } else return '';
    const value = new Date(Date.UTC(+y, +m - 1, +d));
    return value.getUTCFullYear() === +y && value.getUTCMonth() === +m - 1 && value.getUTCDate() === +d ? value.toISOString().slice(0, 10) : '';
  }
  const textLines = text => String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  function header(lines, required) {
    const hi = lines.slice(0, 40).findIndex(l => { const h = l.split('\t').map(clean); return required.every(k => h.includes(k)); });
    if (hi < 0) throw new Error('Wrong report or missing columns: ' + required.join(', ') + '. Use Opera’s tab-delimited text export.');
    return { hi, fields: lines[hi].split('\t').map(clean) };
  }
  function parseJournal(text) {
    const lines = textLines(text), { hi, fields } = header(lines, ['TRX_NO','TRX_CODE','BUSINESS_DATE','CASHIER_DEBIT','CASHIER_CREDIT','GUEST_FULL_NAME','ROOM','CURRENCY1']);
    const rows = [], warnings = [], seen = new Map();
    for (let i = hi + 1; i < lines.length; i++) {
      const cells = lines[i].split('\t'), r = Object.fromEntries(fields.map((k, n) => [k, clean(cells[n])]));
      if (!/^\d+$/.test(r.TRX_NO)) continue; // Opera totals and footer, not transactions.
      if (cells.length < fields.length) throw new Error(`Journal line ${i + 1} is truncated. Export the report again before reconciling.`);
      if (seen.has(r.TRX_NO)) {
        if (seen.get(r.TRX_NO) !== lines[i]) throw new Error(`Conflicting copies of transaction ${r.TRX_NO}. Check the journal export.`);
        warnings.push(`Identical duplicate transaction ${r.TRX_NO} excluded.`); continue;
      }
      if (amount(r.CASHIER_DEBIT) === null || amount(r.CASHIER_CREDIT) === null) throw new Error(`Unrecognized amount on journal line ${i + 1}.`);
      seen.set(r.TRX_NO, lines[i]); rows.push({ ...r, line: i + 1 });
    }
    if (!rows.length) throw new Error('No transactions found in this journal.');
    return { rows, warnings };
  }
  function parseReservations(text) {
    const lines = textLines(text), { hi, fields } = header(lines, ['CONFIRMATION_NO','FULL_NAME','TRUNC_BEGIN','TRUNC_END','ROOM_NO','SHORT_RESV_STATUS']);
    const blocks = [], rows = [], warnings = [];
    for (let i = hi + 1; i < lines.length; i++) {
      if (/^\d{8}\t/.test(lines[i])) blocks.push({ line: i + 1, text: lines[i] });
      else if (blocks.length) blocks[blocks.length - 1].text += '\n' + lines[i];
    }
    if (!blocks.length) throw new Error('Reservation Detail record boundaries were not found. Use the res_detail text report.');
    const requiredEnd = Math.max(...['CONFIRMATION_NO','FULL_NAME','TRUNC_BEGIN','TRUNC_END','ROOM_NO','SHORT_RESV_STATUS'].map(k => fields.indexOf(k)));
    for (const block of blocks) {
      const cells = block.text.split('\t'), r = Object.fromEntries(fields.map((k, i) => [k, clean(cells[i])]));
      if (!/^\d+$/.test(r.CONFIRMATION_NO)) continue;
      if (cells.length <= requiredEnd || !date(r.TRUNC_BEGIN) || !date(r.TRUNC_END)) throw new Error(`Reservation Detail record at line ${block.line} is incomplete or has invalid dates.`);
      if (cells.length > fields.length) warnings.push(`Reservation block at line ${block.line} has extra footer/continuation fields; matching uses its validated identity fields.`);
      rows.push({ ...r, line: block.line });
    }
    if (!rows.length) throw new Error('No reservations found in this report.');
    return { rows, warnings };
  }
  function parseIngauge(rows) {
    const required = ['Product','Employee','Confirmation no','Daily Date( Other Data )','Product Charge','Status','Currency'];
    const hi = rows.slice(0, 15).findIndex(r => required.every(k => (r || []).map(clean).includes(k)));
    if (hi < 0) throw new Error('This is not the IN-Gauge product export. Required columns: ' + required.join(', ') + '.');
    const fields = rows[hi].map(clean), out = [], seen = new Map(), warnings = [];
    for (let i = hi + 1; i < rows.length; i++) {
      const r = Object.fromEntries(fields.map((k, n) => [k, rows[i]?.[n] ?? '']));
      if (!clean(r.Product)) continue;
      const row = { ...r, line: i + 1, conf: id(r['Confirmation no']), day: date(r['Daily Date( Other Data )']), cents: amount(r['Product Charge']), status: clean(r.Status).toUpperCase(), product: clean(r.Product), employee: clean(r.Employee), currency: clean(r.Currency).toUpperCase() };
      if (!row.conf || !row.day || row.cents === null) throw new Error(`IN-Gauge row ${i + 1} has a missing confirmation, invalid daily date or charge. Export the complete product list again.`);
      const recordId = id(r.ID);
      if (recordId && seen.has(recordId)) {
        if (seen.get(recordId) !== JSON.stringify(r)) throw new Error(`IN-Gauge ID ${recordId} has conflicting duplicate rows.`);
        warnings.push(`Identical duplicate IN-Gauge ID ${recordId} excluded.`); continue;
      }
      if (recordId) seen.set(recordId, JSON.stringify(r));
      out.push(row);
    }
    if (!out.length) throw new Error('The IN-Gauge export is empty. Upload a complete product list to check for missing sales.');
    return { rows: out, warnings };
  }
  const noteText = j => [...new Set([j.REFERENCE, j.REMARK].map(clean).filter(Boolean))].join(' | ');
  function sellerOf(j, employees) {
    const note = noteText(j), names = [];
    for (const m of note.matchAll(/\*\*\s*([A-Za-z][A-Za-z .'-]*?)(?=\s+-\s+\d|\*\*|\||$)/g)) if (!names.some(n => norm(n) === norm(m[1]))) names.push(m[1].trim().replace(/[ .-]+$/, ''));
    const posted = clean(j.CASHIER_NAME) || clean(j.USER_NAME) || clean(j.INSERT_USER) || 'Unknown posting user';
    if (names.length > 1) return { name: names.join(' / '), basis: 'Conflicting notes', mapped: false, warning: 'The notes name different sellers. Confirm who made the sale.', explanation: `Notes name ${names.join(' and ')}; posted by ${posted}. Seller credit needs confirmation.`, employeeId: '' };
    if (names.length) {
      const name = names[0], tokens = norm(name).split(' '), hits = employees.filter(e => tokens.every(t => norm(e.name).split(' ').includes(t)));
      const seller = hits.length === 1 ? hits[0].name : name;
      const conflict = !tokens.every(t => norm(posted).split(' ').includes(t));
      return { name: seller, basis: 'Opera note', mapped: hits.length === 1, employeeId: hits.length === 1 ? hits[0].id : '', warning: [conflict ? 'The named seller differs from the posting user.' : '', hits.length !== 1 ? 'Seller is not uniquely mapped to an IN-Gauge employee in this export.' : ''].filter(Boolean).join(' '), explanation: `Credit ${seller}: the Opera note names this seller; posted by ${posted}.` };
    }
    const system = /night\s*audit|system|interface/i.test(posted);
    const hits = employees.filter(e => norm(e.name) === norm(posted));
    return { name: hits.length === 1 ? hits[0].name : posted, basis: system ? 'Unresolved posting user' : 'Posting user fallback', mapped: false, employeeId: '', warning: system ? 'A system/night-audit posting account does not establish the seller.' : 'No seller named in notes: confirm seller credit before adding.', explanation: `No seller identified in the note. Posted by ${posted}; ${system ? 'the seller is unknown.' : 'this is only a suggested seller, requiring confirmation.'}` };
  }
  function reconcile(journal, reservations, ig) {
    const employees = [...new Map(ig.map(g => [(id(g['Employee ID']) ? 'id:' + id(g['Employee ID']) : 'name:' + norm(g.employee)), { name: g.employee, id: id(g['Employee ID']) }])).values()].filter(e => e.name && !/^[-—]$/.test(e.name));
    const dates = [...new Set(ig.map(g => g.day).filter(Boolean))].sort(), dateSet = new Set(dates), guestIndex = new Map(), exactIndex = new Map(), confIndex = new Map();
    const productKey = v => clean(v).toLowerCase().replace(/[-\s]+/g, ' ');
    for (const r of reservations) {
      const key = room(r.ROOM_NO || r.DISP_ROOM_NO) + '|' + norm(r.FULL_NAME);
      if (!guestIndex.has(key)) guestIndex.set(key, []); guestIndex.get(key).push(r);
    }
    for (const g of ig) {
      const key = g.conf + '|' + productKey(g.product), exact = key + '|' + g.day;
      if (!exactIndex.has(exact)) exactIndex.set(exact, []); exactIndex.get(exact).push(g);
      if (!confIndex.has(key)) confIndex.set(key, []); confIndex.get(key).push(g);
    }
    const result = journal.map(j => {
      const day = date(j.BUSINESS_DATE), code = clean(j.TRX_CODE), product = products[code] || clean(j.TRX_DESC) || 'Unmapped product', cents = amount(j.CASHIER_DEBIT) - amount(j.CASHIER_CREDIT), seller = sellerOf(j, employees);
      const candidates = [...new Map((guestIndex.get(room(j.ROOM) + '|' + norm(j.GUEST_FULL_NAME)) || []).filter(r => ['CKIN','CKOT','DUEIN','DUEOUT'].includes(r.SHORT_RESV_STATUS) && day && date(r.TRUNC_BEGIN) <= day && day <= date(r.TRUNC_END)).map(r => [r.CONFIRMATION_NO, r])).values()];
      const r = { transaction: j.TRX_NO, day, code, product, cents, room: clean(j.ROOM), guest: clean(j.GUEST_FULL_NAME), currency: clean(j.CURRENCY1).toUpperCase(), note: noteText(j), seller, cashier: clean(j.CASHIER_NAME), username: clean(j.USER_NAME), userId: clean(j.INSERT_USER), conf: candidates.length === 1 ? candidates[0].CONFIRMATION_NO : '', candidates, matches: [], line: j.line, bucket: '', reason: '', action: '' };
      const decide = (bucket, reason, action) => Object.assign(r, { bucket, reason, action });
      if (/\[NA\s+Pkgs\./i.test(r.note)) return decide('package', 'Automatic package posting. Package Audit handles package corrections.', 'Use the Audit tab for package corrections.');
      if (r.currency !== 'AED') return decide('review', 'Journal currency is missing or differs from AED.', 'Verify currency before comparing amounts.');
      if (!products[code]) return decide('review', 'This transaction code has no verified product mapping.', 'Confirm the product before adding anything.');
      if (cents <= 0) return decide('review', 'Zero or negative posting: this may reverse another charge.', 'Reconcile the original and reversal together.');
      if (code === '2090' && !/upsell/i.test(r.note)) return decide('review', 'Breakfast has no manual-upsell evidence in its notes.', 'Check the billing note; do not assume this is a new manual sale.');
      if (!day || !dateSet.has(day)) return decide('coverage', 'The IN-Gauge export has no daily entries for this posting date. Absence does not prove the sale is missing.', 'Upload a complete IN-Gauge export covering this date.');
      if (!r.conf) {
        r.matches = ig.filter(g => g.day === day && productKey(g.product) === productKey(product) && g.cents !== null && Math.abs(g.cents - cents) <= 2 && norm(g.employee) === norm(seller.name));
        return decide('review', (candidates.length ? 'More than one confirmation overlaps this posting: an extension/shared stay needs checking.' : 'No matching reservation in the supplied Reservation Detail.') + (r.matches.length ? ` Possible existing ${[...new Set(r.matches.map(g => g.status || 'unknown-status'))].join('/')} request by seller, product, date and amount. Do not add it again without confirming identity.` : ''), 'Use the candidate confirmation(s) or load a wider Reservation Detail report.');
      }
      const key = r.conf + '|' + productKey(product), exact = exactIndex.get(key + '|' + day) || [], otherDay = confIndex.get(key) || [];
      r.matches = exact;
      if (exact.length) {
        const total = exact.reduce((s, g) => s + g.cents, 0), statuses = [...new Set(exact.map(g => g.status))];
        if (exact.some(g => g.currency !== 'AED')) return decide('review', 'This reservation/product/date already exists, with a different or missing currency.', 'Check the existing entry; do not submit another full charge.');
        if (exact.length > 1) return decide('review', 'Multiple IN-Gauge records match this charge. They may be duplicate requests or a split charge.', 'Review the existing records before adding anything.');
        if (statuses.includes('DENIED')) return decide('review', 'This sale has a denied IN-Gauge entry.', 'Review the rejection; do not create a duplicate request.');
        if (Math.abs(total - cents) > 2) return decide('review', 'An IN-Gauge entry exists for this reservation, product and date, but its amount differs.', 'Compare the amount on the existing entry; do not add the full charge again.');
        if (!exact.every(g => norm(g.employee) === norm(seller.name))) return decide('review', 'An IN-Gauge entry already represents this charge, with a different seller.', 'Check seller credit on the existing entry.');
        if (statuses.includes('PENDING')) return decide('existing', 'The seller already requested this sale. It is PENDING in the uploaded export.', 'Approve or reject the existing request in IN-Gauge, then upload a fresh export.');
        if (statuses.every(s => ['APPROVED','REVIEWED'].includes(s))) return decide('existing', `Already ${statuses.join('/')} in the uploaded IN-Gauge export.`, 'Nothing to add.');
        return decide('review', 'An IN-Gauge entry already exists with an unrecognized or blank status.', 'Check that entry in IN-Gauge before doing anything.');
      }
      const unnamed = ig.filter(g => g.conf === r.conf && g.day === day && /unknown|unmapped|^[-—]$|^$/i.test(g.product));
      if (unnamed.length) { r.matches = unnamed; return decide('review', 'An unidentified IN-Gauge product already exists on this confirmation and date.', 'Use Audit to identify the existing product before submitting another request.'); }
      if (otherDay.length && ['1061','1062'].includes(code)) {
        r.matches = otherDay;
        return decide('review', 'This one-off product already exists on the same confirmation with a different daily date.', 'Check the existing request before adding another.');
      }
      // A different confirmation with the same seller/day/amount may be an extension or a missing identity link.
      const weak = ig.filter(g => g.day === day && productKey(g.product) === productKey(product) && Math.abs(g.cents - cents) <= 2 && norm(g.employee) === norm(seller.name));
      if (weak.length) { r.matches = weak; return decide('review', 'A request with the same seller, product, day and amount exists on another confirmation.', 'Check whether this is the same sale across an extension before adding.'); }
      if (seller.basis !== 'Opera note' || seller.warning) return decide('review', 'Not found in this export, but seller credit needs confirmation. ' + seller.warning, 'Confirm the seller and employee mapping before adding.');
      return decide('add', 'Unique reservation and note-identified seller; no corresponding IN-Gauge entry in this export.', 'Add one manual request in IN-Gauge with the details below, after checking the export is complete.');
    });
    const groups = new Map();
    result.filter(r => r.bucket !== 'package').forEach(r => { const key = (r.conf || norm(r.guest) + '|' + room(r.room)) + '|' + r.code + '|' + r.day; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); });
    groups.forEach(rows => { if (rows.length > 1) rows.forEach(r => { if (r.bucket !== 'coverage') Object.assign(r, { bucket: 'review', reason: 'Multiple postings or reversals for this event. One IN-Gauge line cannot clear multiple Opera transactions.', action: 'Reconcile the event’s net total and existing requests before adding.' }); }); });
    return { rows: result, dates, summary: Object.fromEntries(Object.keys(labels).map(k => [k, result.filter(r => r.bucket === k).length])), totalCents: result.reduce((s, r) => s + r.cents, 0) };
  }

  const state = { files: {}, data: {}, shared: {}, result: null, filter: 'add', search: '', busy: false, error: '', open: new Set(), limit: 60 };
  const el = id => document.getElementById(id);
  const toast = (message, tone) => { if (typeof global.showToast === 'function') global.showToast(message, tone); };
  function invalidate() { state.result = null; state.error = ''; state.open.clear(); state.limit = 60; }
  async function readFile(kind, file, sharedOnly) {
    if (!file) return;
    const parsed = kind === 'ingauge' ? readWorkbook(await file.arrayBuffer()) : kind === 'journal' ? parseJournal(await file.text()) : parseReservations(await file.text());
    const entry = { parsed, name: file.name, file };
    if (sharedOnly) { state.shared[kind] = entry; return; }
    state.data[kind] = parsed; state.files[kind] = entry; invalidate();
  }
  function readWorkbook(buffer) {
    if (!global.XLSX) throw new Error('The Excel reader is still loading. Try again when the app has loaded.');
    const wb = global.XLSX.read(buffer, { type: 'array' });
    for (const name of wb.SheetNames) {
      const rows = global.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
      if (rows.slice(0, 15).some(r => r.map(clean).includes('Confirmation no'))) return parseIngauge(rows);
    }
    throw new Error('No product report sheet found in this IN-Gauge workbook.');
  }
  async function load(kind, file) {
    if (state.busy) return;
    state.busy = true; state.error = ''; invalidate(); render();
    // A failed replacement must not leave results based on the previous file.
    delete state.data[kind]; delete state.files[kind];
    try { await readFile(kind, file, false); }
    catch (error) { state.error = error.message; }
    finally { state.busy = false; render(); }
  }
  async function run() {
    if (state.busy || !['journal','reservations','ingauge'].every(k => state.data[k])) return;
    state.busy = true; state.error = ''; render();
    await new Promise(resolve => setTimeout(resolve, 20));
    try { state.result = reconcile(state.data.journal.rows, state.data.reservations.rows, state.data.ingauge.rows); state.filter = 'add'; state.limit = 60; state.open.clear(); }
    catch (error) { state.result = null; state.error = error.message; }
    finally { state.busy = false; render(); }
  }
  function copy(text, button) {
    if (typeof global.copyToClipboard === 'function') global.copyToClipboard(text, button, button.textContent);
    else if (global.navigator?.clipboard) global.navigator.clipboard.writeText(text).then(() => toast('Copied', 'ok')).catch(() => toast('Copy failed. Select and copy the text.', 'err'));
  }
  function rowValues(r) {
    return { 'Transaction ID': r.transaction, 'Posting date': r.day, 'Product': r.product, 'Transaction code': r.code, 'Room': r.room, 'Guest': r.guest, 'Confirmation': r.conf, 'Candidate confirmations': r.candidates.map(c => c.CONFIRMATION_NO).join(', '), 'Net charge AED': r.cents / 100, 'Charge days': ['1061','1062'].includes(r.code) ? 1 : '', 'Seller': r.seller.name, 'Employee ID': r.seller.employeeId, 'Seller evidence': r.seller.basis, 'Seller explanation': r.seller.explanation, 'Seller warning': r.seller.warning, 'Posted by': r.cashier, 'Posting username': r.username, 'Posting user ID': r.userId, 'Opera note': r.note, 'IN-Gauge IDs': r.matches.map(g => id(g.ID)).join(', '), 'IN-Gauge confirmations': [...new Set(r.matches.map(g => g.conf))].join(', '), 'IN-Gauge statuses': [...new Set(r.matches.map(g => g.status))].join(', '), 'Result': labels[r.bucket], 'Why': r.reason, 'Next step': r.action, 'Journal line': r.line };
  }
  function exportWorkbook() {
    if (!state.result || !global.XLSX) return;
    const X = global.XLSX, wb = X.utils.book_new();
    function addSheet(name, rows) {
      const ws = X.utils.aoa_to_sheet(rows);
      ws['!cols'] = (rows[0] || []).map((_, i) => ({ wch: Math.min(65, Math.max(16, ...rows.slice(0, 100).map(r => String(r[i] ?? '').length + 2))) }));
      // All uploaded strings remain literal strings, never spreadsheet formulas.
      Object.keys(ws).filter(k => !k.startsWith('!')).forEach(k => { if (ws[k].t === 's') delete ws[k].f; });
      X.utils.book_append_sheet(wb, ws, name);
    }
    addSheet('Summary', [['Manual sales review', ''], ['Created', new Date().toISOString()], ['IN-Gauge report', state.files.ingauge.name], ['Daily dates observed', state.result.dates[0] + ' to ' + state.result.dates.at(-1)], ['Important', 'Missing means absent from the uploaded export. Recheck live IN-Gauge before adding.'], ['Seller rule', 'Notes first. Posting identity is a flagged fallback. Pending requests already exist.'], ...Object.entries(state.result.summary).map(([k, v]) => [labels[k], v]), ...Object.values(state.files).map(f => ['Source file', f.name])]);
    const headers = Object.keys(rowValues(state.result.rows[0]));
    for (const key of Object.keys(labels)) addSheet(labels[key].slice(0, 31), [headers, ...state.result.rows.filter(r => r.bucket === key).map(r => Object.values(rowValues(r)))]);
    addSheet('Data quality', [['Report notes'], ...Object.values(state.data).flatMap(d => d.warnings).map(w => [w]), ['Net charges are debit minus credit; no VAT multiplier or breakfast quantity is inferred.'], ['This journal has verified mappings for early check-in, late checkout and breakfast only.']]);
    X.writeFile(wb, 'Manual-Sales-Review-' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }
  const entryText = r => Object.entries(rowValues(r)).filter(([, v]) => v !== '').map(([k, v]) => `${k}: ${v}`).join('\n');
  function chip(label, value) { return `<div class="msu-value"><span>${esc(label)}</span><strong>${esc(value || '—')}</strong>${value ? `<button type="button" data-ms-copy="${esc(value)}" aria-label="Copy ${esc(label)}">Copy</button>` : ''}</div>`; }
  function card(r, index) {
    const expanded = state.open.has(r.transaction);
    const badge = r.bucket === 'existing' && r.matches.some(g => g.status === 'PENDING') ? 'Pending · already requested' : labels[r.bucket];
    return `<article class="msu-sale msu-${r.bucket}">
      <div class="msu-sale-head"><div class="msu-room"><small>Room</small><b>${esc(r.room || '—')}</b></div><div class="msu-sale-title"><h3>${esc(r.product)}</h3><p>${esc(r.guest || 'Guest not named')} · ${esc(r.day || 'Date unknown')}</p></div><div class="msu-price"><strong>AED ${money(r.cents)}</strong><small>Net posted charge</small></div></div>
      <div class="msu-badge">${esc(badge)}</div><p class="msu-reason">${esc(r.reason)}</p>
      <div class="msu-credit"><span class="msu-credit-icon" aria-hidden="true">↳</span><div><b>${esc(r.seller.explanation)}</b>${r.seller.warning ? `<small>${esc(r.seller.warning)}</small>` : ''}</div></div>
      <div class="msu-values">${chip(r.conf ? 'Confirmation' : r.matches.length ? 'Possible IN-Gauge confirmation' : 'Confirmation', r.conf || [...new Set(r.matches.map(g => g.conf))].join(', '))}${chip(r.seller.basis === 'Opera note' ? 'Seller from note' : 'Suggested seller', r.seller.name)}${chip('Posting date', r.day)}${chip('Net amount · AED', (r.cents / 100).toFixed(2))}</div>
      <div class="msu-next"><b>Next step</b><span>${esc(r.action)}</span></div>
      <div class="msu-card-actions"><button type="button" class="btn" data-ms-entry="${index}">${r.bucket === 'add' ? 'Copy addition details' : 'Copy review details'}</button><button type="button" class="msu-link" data-ms-evidence="${esc(r.transaction)}" aria-expanded="${expanded}">${expanded ? 'Hide evidence' : 'Why this result?'} <span aria-hidden="true">${expanded ? '−' : '+'}</span></button></div>
      ${expanded ? `<div class="msu-evidence"><div><b>Original Opera note</b><p>${esc(r.note || 'No note supplied')}</p></div><div><b>Posted by</b><p>${esc(r.cashier || 'Not provided')} · ${esc(r.username || r.userId || 'No login provided')}</p></div><div><b>Reservation match</b><p>${r.candidates.length ? r.candidates.map(c => `Confirmation ${esc(c.CONFIRMATION_NO)} · ${esc(c.ROOM_NO || c.DISP_ROOM_NO)} · ${esc(c.FULL_NAME)} · ${esc(c.TRUNC_BEGIN)} → ${esc(c.TRUNC_END)}`).join('<br>') : 'No room + full guest name + stay-date match in this report.'}</p></div><div><b>Existing IN-Gauge entries</b><p>${r.matches.length ? r.matches.map(g => `${esc(g.status || 'Status missing')} · ID ${esc(id(g.ID) || 'not supplied')} · confirmation ${esc(g.conf)} · ${esc(g.employee)} · ${esc(g.day)} · ${esc(g.currency)} ${money(g.cents)}${clean(g['Manually Added Record']) ? ' · manually added: ' + esc(g['Manually Added Record']) : ''}`).join('<br>') : 'No corresponding entry in the uploaded export.'}</p></div><p class="msu-fine">Journal transaction ${esc(r.transaction)} · source line ${r.line} · code ${esc(r.code)}${r.seller.employeeId ? ' · employee ID ' + esc(r.seller.employeeId) : ''}</p></div>` : ''}
    </article>`;
  }
  function renderResults() {
    const root = el('msuResults'); if (!root) return;
    if (!state.result) { root.innerHTML = '<div class="msu-empty"><span aria-hidden="true">✓</span><h3>Your monthly add list, with the proof</h3><p>Upload all three reports and check manual sales. You’ll see what to add, who earned it, and which requests already exist.</p></div>'; return; }
    const result = state.result, warnings = Object.values(state.data).flatMap(d => d.warnings);
    const matches = result.rows.map((r, i) => ({ r, i })).filter(({ r }) => r.bucket === state.filter && (!state.search || searchNorm([r.room, r.guest, r.conf, r.product, r.seller.name, r.transaction, r.note, ...r.matches.map(g => g.conf)].join(' ')).includes(searchNorm(state.search)) || [r.room, r.conf, r.transaction, ...r.matches.map(g => g.conf)].some(v => clean(v).includes(state.search))));
    root.innerHTML = `<div class="msu-report-coverage"><div><b>IN-Gauge daily dates: ${esc(result.dates[0])} → ${esc(result.dates.at(-1))}</b><p>Results use your uploaded export. A newer approval appears after you upload a newer report.</p></div><button type="button" class="btn" data-ms-export>Export review</button></div>
      <div class="msu-stats" aria-label="Results">${Object.entries(labels).map(([k, label]) => `<button type="button" class="msu-stat ${k}${state.filter === k ? ' selected' : ''}" data-ms-filter="${k}" aria-pressed="${state.filter === k}"><strong>${result.summary[k]}</strong><span>${label}</span>${k === 'add' ? `<small>AED ${money(result.rows.filter(r => r.bucket === 'add').reduce((s, r) => s + r.cents, 0))} net</small>` : ''}</button>`).join('')}</div>
      <div class="msu-list-head"><div><h2>${labels[state.filter]}</h2><p>${state.filter === 'add' ? 'Proposed additions missing from this export. Use a complete, unfiltered report before adding.' : state.filter === 'package' ? 'Automatic package charges stay with Package Audit’s existing correction workflow.' : state.filter === 'existing' ? 'Pending and approved requests are already submitted. Do not create another.' : state.filter === 'coverage' ? 'These dates need a newer or wider IN-Gauge export before a missing sale can be confirmed.' : 'Identity, seller, amount or status needs checking before another request is created.'}</p></div><label class="msu-search"><span class="sr-only">Search sales</span><input id="msuSearch" type="search" value="${esc(state.search)}" placeholder="Room, seller, guest or confirmation…"></label></div>
      <div class="msu-list">${matches.length ? matches.slice(0, state.limit).map(({ r, i }) => card(r, i)).join('') : `<div class="msu-empty"><h3>${state.search ? 'No matching sales' : 'Nothing in this list'}</h3><p>${state.search ? 'Try another room, seller or confirmation.' : 'Choose another result above to see its details.'}</p></div>`}</div>
      ${matches.length > state.limit ? `<button type="button" class="btn msu-more" data-ms-more>Show more · ${matches.length - state.limit} remaining</button>` : ''}
      ${warnings.length ? `<details class="msu-quality"><summary>Report checks · ${warnings.length} note${warnings.length === 1 ? '' : 's'}</summary><ul>${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}
      <p class="msu-fine">Net charge = debit minus credit. No tax conversion or breakfast quantity is inferred. Verified codes: 1061, 1062 and 2090. Unsupported codes require review.</p>`;
  }
  function render() {
    if (!el('manualUpsellView')) return;
    for (const kind of ['journal','reservations','ingauge']) {
      const box = el('msuFile-' + kind), file = state.files[kind];
      if (box) { box.classList.toggle('loaded', !!file); box.querySelector('.msu-file-status').textContent = file ? `${file.name} · ${state.data[kind].rows.length} rows` : 'Choose file or drop it here'; }
      const input = el('msuInput-' + kind); if (input) input.disabled = state.busy;
    }
    const btn = el('msuRun'); btn.disabled = state.busy || !['journal','reservations','ingauge'].every(k => state.data[k]); btn.textContent = state.busy ? 'Reading reports…' : 'Check manual sales';
    el('msuClear').disabled = state.busy; el('msuUseAudit').disabled = state.busy;
    el('msuShareAudit').disabled = state.busy || !state.files.ingauge?.file || !state.files.reservations?.file;
    const error = el('msuError'); error.hidden = !state.error; error.textContent = state.error;
    renderResults();
  }
  function show() {
    if (!mount()) return;
    if (typeof global.showPanel === 'function') global.showPanel('package-audit');
    if (typeof global.hoPanelAllowed === 'function' && !global.hoPanelAllowed('package-audit')) return;
    ['pkgMainView','pkgRulesView','pkgMemoryView','pkgSettingsView','muView'].forEach(id => { if (el(id)) el(id).hidden = true; });
    if (typeof _pkgView !== 'undefined') _pkgView = 'manual';
    el('manualUpsellView').hidden = false;
    if (el('pkgClearReports')) el('pkgClearReports').hidden = true;
    document.querySelectorAll('#pkgTabs [data-v]').forEach(b => { const active = b.dataset.v === 'manual'; b.classList.toggle('on', active); b.setAttribute('aria-selected', String(active)); });
    render();
  }
  function hide() { if (el('manualUpsellView')) el('manualUpsellView').hidden = true; if (el('pkgClearReports')) el('pkgClearReports').hidden = false; }
  function mount() {
    const tabs = el('pkgTabs'), main = el('pkgMainView');
    if (!tabs || !main) return false;
    if (el('manualUpsellView')) return true;
    const tab = document.createElement('button'); tab.type = 'button'; tab.id = 'msuTab'; tab.dataset.v = 'manual'; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', 'manualUpsellView'); tab.setAttribute('aria-selected', 'false'); tab.textContent = '↗ Manual sales'; tab.addEventListener('click', show);
    tabs.insertBefore(tab, tabs.querySelector('[data-v="rules"]'));
    tabs.addEventListener('click', e => { const t = e.target.closest('[data-v]'); if (t && t.dataset.v !== 'manual') hide(); }, true);
    const view = document.createElement('section'); view.id = 'manualUpsellView'; view.className = 'msu'; view.hidden = true; view.setAttribute('aria-label', 'Manual sales reconciliation');
    view.innerHTML = `<div class="msu-hero"><div><span class="msu-eyebrow">MONTHLY RECONCILIATION</span><h2>Every manual sale.<br><span>Accounted for.</span></h2><p>Find Opera upsells missing from IN-Gauge, with the right reservation, seller and evidence.</p></div><div class="msu-hero-aside"><span aria-hidden="true">↗</span><b>Notes say who sold it.<br>Posting user says who entered it.</b><p>Pending requests count as already submitted.</p></div></div>
      <div class="msu-upload-heading"><h3>Start with your three reports</h3><button type="button" class="msu-link" id="msuUseAudit">Use reports loaded in Audit ↙</button></div>
      <div class="msu-uploads">${[['journal','01','Opera journal','Journal by Transaction Code · finjrnlbytrans','The manual charges and original seller notes.','.txt,.tsv'],['reservations','02','Reservation Detail','Opera · res_detail text export','Rooms, guests, stay dates and confirmations.','.txt,.tsv'],['ingauge','03','IN-Gauge product list','Complete product export · .xlsx or .xls','Include all staff and statuses, including Pending.','.xlsx,.xls']].map(([kind, step, title, sub, hint, accept]) => `<label class="msu-file" id="msuFile-${kind}"><input type="file" id="msuInput-${kind}" data-ms-kind="${kind}" accept="${accept}"><span class="msu-step">${step}</span><b>${title}</b><span class="msu-file-sub">${sub}</span><p>${hint}</p><span class="msu-file-status">Choose file or drop it here</span></label>`).join('')}</div>
      <div class="msu-runbar"><div><button type="button" class="btn gold" id="msuRun" disabled>Check manual sales</button><button type="button" class="msu-link" id="msuClear">Clear reports</button></div><span>Reports are processed on this device.</span></div>
      <div class="msu-error" id="msuError" role="alert" hidden></div>
      <div id="msuResults" aria-live="polite"></div>
      <details class="msu-help"><summary>Which reports do I need, and how does matching work?</summary><ol><li><b>Opera journal:</b> export Journal by Transaction Code as text for your month. Include early check-in (1061), late checkout (1062), breakfast (2090) and any reversals.</li><li><b>Reservation Detail:</b> export as text with stays covering those postings, including checked-out guests and extensions. A wider stay range helps resolve missing confirmations.</li><li><b>IN-Gauge:</b> export the complete product list for the same month, all employees and all statuses. Download a fresh copy after approving or adding requests.</li><li>We link room + full guest name + stay dates to a confirmation, then compare confirmation + product + daily date + net charge. Uncertain matches stay in Needs review.</li><li>The seller explicitly named after <code>**</code> in the Opera note comes first. A posting-user fallback is always flagged. Pending, approved, denied and automatically imported records are checked before proposing additions.</li></ol></details>
      <div class="msu-audit-link"><div><b>One workspace, two checks</b><p>Audit fixes existing package records. Manual sales finds journal charges that need a request.</p></div><button type="button" class="btn" id="msuShareAudit" disabled>Use these reports in Audit →</button></div>`;
    main.parentNode.insertBefore(view, main.nextSibling);
    view.addEventListener('change', e => { if (e.target.dataset.msKind && e.target.files[0]) load(e.target.dataset.msKind, e.target.files[0]); });
    view.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.msFilter) { state.filter = b.dataset.msFilter; state.limit = 60; renderResults(); }
      else if (b.hasAttribute('data-ms-copy')) copy(b.dataset.msCopy, b);
      else if (b.hasAttribute('data-ms-entry')) copy(entryText(state.result.rows[Number(b.dataset.msEntry)]), b);
      else if (b.dataset.msEvidence) { const key = b.dataset.msEvidence; if (state.open.has(key)) state.open.delete(key); else state.open.add(key); renderResults(); const target = [...view.querySelectorAll('[data-ms-evidence]')].find(x => x.dataset.msEvidence === key); target?.focus({ preventScroll: true }); }
      else if (b.hasAttribute('data-ms-export')) exportWorkbook();
      else if (b.hasAttribute('data-ms-more')) { state.limit += 60; renderResults(); }
    });
    view.addEventListener('input', e => { if (e.target.id === 'msuSearch') { const position = e.target.selectionStart; state.search = e.target.value; state.limit = 60; renderResults(); const input = el('msuSearch'); input.focus({ preventScroll: true }); try { input.setSelectionRange(position, position); } catch (_) {} } });
    view.querySelectorAll('.msu-file').forEach(box => {
      box.addEventListener('dragover', e => { e.preventDefault(); box.classList.add('drag'); });
      box.addEventListener('dragleave', () => box.classList.remove('drag'));
      box.addEventListener('drop', e => { e.preventDefault(); box.classList.remove('drag'); const file = e.dataTransfer?.files[0]; if (file) load(box.querySelector('input').dataset.msKind, file); });
    });
    el('msuRun').onclick = run;
    el('msuClear').onclick = () => { state.data = {}; state.files = {}; state.search = ''; invalidate(); view.querySelectorAll('input[type="file"]').forEach(i => { i.value = ''; }); render(); };
    el('msuUseAudit').onclick = () => {
      if (state.busy) return;
      try {
        const shared = { ...state.shared };
        if (typeof _pkgLastRows !== 'undefined' && _pkgLastRows.ig?.length) shared.ingauge = { parsed: parseIngauge(_pkgLastRows.ig), name: 'IN-Gauge report loaded in Audit' };
        let count = 0;
        for (const kind of ['ingauge','reservations']) if (shared[kind]) { state.data[kind] = shared[kind].parsed; state.files[kind] = shared[kind]; count++; }
        invalidate(); if (!count) state.error = 'Load the IN-Gauge and Reservation Detail reports in Audit first, or upload them here.';
        render(); if (count) toast(`Copied ${count} report${count === 1 ? '' : 's'} from Audit.`, 'ok');
      } catch (error) { state.error = error.message; render(); }
    };
    el('msuShareAudit').onclick = () => {
      if (state.busy) return;
      if (typeof global.pkgLoadExcel === 'function') global.pkgLoadExcel({ files: [state.files.ingauge.file] });
      if (typeof global.pkgLoadGuests === 'function') global.pkgLoadGuests({ files: [state.files.reservations.file] });
      if (typeof global.pkgShowView === 'function') global.pkgShowView('audit');
      toast('Reports passed to Audit. Add its Changes Log to check package corrections.', 'ok');
    };
    // Copies only: importing in Audit never mutates or runs the manual reconciliation.
    for (const [inputId, kind] of [['pkgExcelFileInput','ingauge'],['pkgGuestFileInput','reservations']]) el(inputId)?.addEventListener('change', e => { const file = e.target.files?.[0]; if (file) readFile(kind, file, true).catch(() => { delete state.shared[kind]; }); });
    render(); return true;
  }
  const api = { parseJournal, parseReservations, parseIngauge, reconcile, sellerOf, amount, date, rowValues, show, hide, mount, state, readWorkbook, exportWorkbook, run, load };
  global.ManualUpsells = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  }
})(typeof window !== 'undefined' ? window : globalThis);

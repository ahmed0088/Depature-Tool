// ═══════════════════════════════════════════════════════════
//  report-center.js — 📊 Reports: an Opera-style report centre
//  Pick a report, filter it, and get it the way Opera prints them: the
//  hotel and report name on top, "printed on … by …", one clean table with
//  totals, page numbers on paper. Print / PDF, Excel, CSV or copy.
//  The data is what HotelOps already holds (it never asks Opera): today's
//  Departures and Arrivals boards, the In-House list, No-Shows, WhatsApp,
//  the Handover Book and Room Health. Read only — a report changes nothing.
// ═══════════════════════════════════════════════════════════

(function (W) {
  const doc = W.document, PANEL = 'reports';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safe = (f, d) => { try { return f(); } catch (_) { return d; } };
  const money = v => (+v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hotel = () => (doc.getElementById('hotelName') && doc.getElementById('hotelName').textContent.trim()) || 'Hotel';
  const user = () => (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || '';
  const nice = s => String(s || '').replace(/\s+/g, ' ').trim();
  const st = { cur: '', q: '', sort: null, dir: 1, f: {} };

  // ── the sources (each returns [] when that page has nothing loaded) ──
  const depRows = () => safe(() => (typeof depRooms !== 'undefined' && depRooms || []).slice(), []);   // the pages' own lists (shared script globals)
  const arrRows = () => safe(() => (typeof arrGuests !== 'undefined' && arrGuests || []).slice(), []);
  const ihRows = () => safe(() => (W.hoInHouse && W.hoInHouse.rooms ? W.hoInHouse.rooms() : []) || [], []);
  const nsRows = () => safe(() => (typeof nsGuests !== 'undefined' && nsGuests || []).slice(), []);
  const waRows = () => safe(() => (W.hoWaBridge && W.hoWaBridge.log ? W.hoWaBridge.log() : []) || [], []);
  const hoRows = () => safe(() => (W.hoHandoverBook && W.hoHandoverBook.items ? W.hoHandoverBook.items() : []) || [], []);
  const rhRows = () => safe(() => (W.hoRoomHealth && W.hoRoomHealth.recs ? W.hoRoomHealth.recs() : []) || [], []);
  const STATUS = { due: 'Due out', out: 'Checked out', late: 'Late check-out', extended: 'Extended', extending: 'Extending', finance: 'Finance hold', noshow: 'No-show' };
  const depStatus = r => STATUS[r.status] || nice(r.status) || 'Due out';

  // ── the reports: id, group, Opera-like code, title, what it lists, columns [key, label, kind], rows(), totals ──
  // kind: 'n' number · 'm' money (summed) · 't' text · 'r' room
  const REPORTS = [
    { id: 'dep', group: 'Front Office', code: 'FO-DEP', title: 'Departures', desc: 'Every room due out today with balance and status',
      src: 'Departures', cols: [['room', 'Room', 'r'], ['name', 'Guest', 't'], ['arrival', 'Arrival', 't'], ['departure', 'Departure', 't'], ['nights', 'Nts', 'n'], ['status', 'Status', 't'], ['lco', 'LCO', 't'], ['source', 'Source / Company', 't'], ['balance', 'Balance AED', 'm']],
      filters: [['all', 'All'], ['due', 'Still in'], ['out', 'Checked out'], ['late', 'Late CO'], ['ext', 'Extending / extended'], ['bal', 'Owing']],
      rows: f => depRows().filter(r => f === 'due' ? !['out', 'extended'].includes(r.status) : f === 'out' ? r.status === 'out' : f === 'late' ? r.status === 'late' : f === 'ext' ? /exten/.test(r.status) : f === 'bal' ? (+r.balance || 0) > 0 : true)
        .map(r => ({ room: r.roomStr || r.room, name: nice(r.name), arrival: r.arrival, departure: r.departure, nights: r.nights || '', status: depStatus(r) + (r.status === 'out' && r.checkoutAt ? ' ' + r.checkoutAt : ''), lco: r.lateTime || '', source: nice(r.company || r.source), balance: +r.balance || 0 })) },
    { id: 'arr', group: 'Front Office', code: 'FO-ARR', title: 'Arrivals', desc: 'Today\'s arrivals with confirmation, source and purpose',
      src: 'Arrivals', cols: [['room', 'Room', 'r'], ['name', 'Guest', 't'], ['conf', 'Conf. No', 't'], ['nights', 'Nts', 'n'], ['source', 'Source', 't'], ['purpose', 'Purpose', 't'], ['nat', 'Nationality', 't'], ['email', 'Email', 't']],
      rows: () => arrRows().map(g => ({ room: g.room, name: nice(g.name), conf: g.conf, nights: g.nights || '', source: nice(g.source), purpose: g.purpose || '', nat: g.nat || '', email: /^no@email/i.test(g.email || '') ? '' : (g.email || '') })) },
    { id: 'ih', group: 'Front Office', code: 'FO-INH', title: 'In-House Guest List', desc: 'Every occupied room: stay, guests, company, rate and balance',
      src: 'In-House', cols: [['room', 'Room', 'r'], ['name', 'Guest', 't'], ['arrival', 'Arrival', 't'], ['departure', 'Departure', 't'], ['nights', 'Nts', 'n'], ['pax', 'A/C', 't'], ['company', 'Company / Agent', 't'], ['rateCode', 'Rate', 't'], ['vip', 'VIP', 't'], ['balance', 'Balance AED', 'm']],
      filters: [['all', 'All'], ['vip', 'VIP'], ['long', 'Long stay (7+)'], ['bal', 'Owing'], ['company', 'Company']],
      rows: f => ihRows().filter(r => f === 'vip' ? !!r.vip : f === 'long' ? (r.nights || 0) >= 7 : f === 'bal' ? (r.balance || 0) > 0 : f === 'company' ? !!r.company : true)
        .map(r => ({ room: r.room, name: nice((r.names || [r.name]).join(' / ')), arrival: r.arrival, departure: r.departure, nights: r.nights || '', pax: `${r.adults || 0}/${r.children || 0}`, company: nice(r.company || r.agent || r.source), rateCode: r.rateCode || '', vip: r.vip || '', balance: +r.balance || 0 })) },
    { id: 'bal', group: 'Cashiering', code: 'CA-BAL', title: 'Balances Due', desc: 'Rooms with money still to collect, departing first',
      src: 'Departures · In-House', cols: [['room', 'Room', 'r'], ['name', 'Guest', 't'], ['departure', 'Departure', 't'], ['where', 'From', 't'], ['company', 'Company', 't'], ['balance', 'Balance AED', 'm']],
      rows: () => {
        const out = [], seen = new Set();
        depRows().filter(r => (+r.balance || 0) > 0 && r.status !== 'out').forEach(r => { seen.add(String(r.roomStr || r.room)); out.push({ room: r.roomStr || r.room, name: nice(r.name), departure: 'Today', where: 'Departures', company: nice(r.company || r.source), balance: +r.balance }); });
        ihRows().filter(r => (r.balance || 0) > 0 && !seen.has(String(r.room))).forEach(r => out.push({ room: r.room, name: nice(r.name), departure: r.departure, where: 'In-House', company: nice(r.company || r.agent), balance: +r.balance }));
        return out;
      } },
    { id: 'lco', group: 'Front Office', code: 'FO-LCO', title: 'Late Check-outs & Extensions', desc: 'Agreed late check-outs, extending and extended rooms',
      src: 'Departures', cols: [['room', 'Room', 'r'], ['name', 'Guest', 't'], ['status', 'Status', 't'], ['lco', 'Time', 't'], ['ext', 'Extra nights', 'n'], ['note', 'Last note', 't']],
      rows: () => depRows().filter(r => r.status === 'late' || /exten/.test(r.status) || r.intent).map(r => ({ room: r.roomStr || r.room, name: nice(r.name), status: depStatus(r) + (r.intent && !/exten|late/.test(r.status) ? ' (may extend)' : ''), lco: r.lateTime || '', ext: r.extensionNights || '', note: nice(String(r.note || '').split('\n').pop()).slice(0, 90) })) },
    { id: 'ns', group: 'Reservations', code: 'RS-NSH', title: 'No-Shows', desc: 'Last night\'s no-shows with nights, rate and revenue',
      src: 'No-Show', cols: [['name', 'Guest', 't'], ['conf', 'Conf. No', 't'], ['arr', 'Arrival', 't'], ['nights', 'Nts', 'n'], ['company', 'Company / Agent', 't'], ['rate', 'Rate AED', 'm'], ['rev', 'Revenue AED', 'm'], ['newConf', 'New conf.', 't']],
      rows: () => nsRows().map(g => ({ name: nice(g.nameRaw || g.name), conf: g.confNo || '', arr: g.arrDate || '', nights: g.nights || '', company: nice(g.company), rate: +g.rateAmount || 0, rev: +g.potRev || 0, newConf: g.newConf || '' })) },
    { id: 'rh', group: 'Housekeeping', code: 'HK-RMP', title: 'Room Problems', desc: 'Open room problems and who to send (Room Health)',
      src: 'Room Health', cols: [['room', 'Room', 'r'], ['problem', 'Problem', 't'], ['dept', 'Send', 't'], ['times', 'Reported', 't'], ['flags', 'Flags', 't'], ['sent', 'Sent', 't']],
      rows: () => rhRows().map(r => ({ room: r.room, problem: nice(r.say || r.title), dept: ({ hk: 'Housekeeping', eng: 'Engineering', it: 'IT', sec: 'Security' })[r.dept] || r.dept || '', times: r.cnt ? `${r.cnt}× ${r.since || ''}` : '', flags: [r.arrival ? 'Arrival today' : '', r.vip ? 'VIP' : '', r.type === 'repeat' ? 'Repeat' : ''].filter(Boolean).join(', '), sent: r.sent ? new Date(r.sent.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + (r.sent.by ? ' · ' + r.sent.by : '') : '' })) },
    { id: 'wa', group: 'Housekeeping', code: 'HK-WAL', title: 'WhatsApp Activity Log', desc: 'Every message from the groups today and what HotelOps did with it',
      src: 'WhatsApp', cols: [['time', 'Time', 't'], ['group', 'Group', 't'], ['sender', 'From', 't'], ['text', 'Message', 't'], ['did', 'HotelOps did', 't']],
      filters: [['all', 'All'], ['act', 'Actions only'], ['req', 'Requests']],
      rows: f => waRows().filter(l => !l.undone).filter(l => { const s = (l.res || []).map(x => x.st); return f === 'act' ? s.some(x => /^(co|lco|ext|extending)$/.test(x)) : f === 'req' ? s.includes('req') : true; })
        .map(l => ({ time: l.time || '', group: nice(l.group), sender: nice(l.sender), text: nice(l.text).slice(0, 160), did: (l.res || []).map(x => nice(x.text)).filter(Boolean).join(' · ').slice(0, 160) })) },
    { id: 'ho', group: 'Front Office', code: 'FO-HOV', title: 'Shift Handover', desc: 'Today\'s Handover Book: open, done and info items',
      src: 'Handover Book', cols: [['shift', 'Shift', 't'], ['room', 'Room', 'r'], ['cat', 'Type', 't'], ['text', 'Item', 't'], ['status', 'Status', 't'], ['by', 'By', 't']],
      filters: [['all', 'All'], ['open', 'Open'], ['done', 'Done']],
      rows: f => hoRows().filter(i => f === 'all' || i.status === f).map(i => ({ shift: i.shift || '', room: i.room || (i.rooms && i.rooms[0]) || '', cat: i.cat || '', text: nice(i.text).slice(0, 200), status: i.status === 'done' ? 'Done' : i.status === 'info' ? 'Info' : 'Open', by: i.by || '' })) },
  ];
  const R = id => REPORTS.find(r => r.id === id);

  // ── one report, sorted and searched ──
  function data(rep) {
    let rows = safe(() => rep.rows(st.f[rep.id] || 'all'), []);
    const q = st.q.trim().toLowerCase();
    if (q) rows = rows.filter(r => rep.cols.some(([k]) => String(r[k] == null ? '' : r[k]).toLowerCase().includes(q)));
    const k = st.sort || rep.cols[0][0], kind = (rep.cols.find(c => c[0] === k) || [])[2];
    rows.sort((a, b) => {
      const x = a[k], y = b[k];
      if (kind === 'm' || kind === 'n') return ((+x || 0) - (+y || 0)) * st.dir;
      if (kind === 'r') return ((parseInt(x, 10) || 0) - (parseInt(y, 10) || 0) || String(x).localeCompare(String(y))) * st.dir;
      return String(x == null ? '' : x).localeCompare(String(y == null ? '' : y)) * st.dir;
    });
    return rows;
  }
  const cell = (v, kind) => kind === 'm' ? (v ? money(v) : '—') : (v == null || v === '' ? '' : String(v));
  const totals = (rep, rows) => rep.cols.map(([k, , kind]) => kind === 'm' ? rows.reduce((s, r) => s + (+r[k] || 0), 0) : null);
  const stamp = () => new Date().toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  // ── the page ──
  function render() {
    const root = doc.getElementById('rptRoot'); if (!root) return;
    const rep = st.cur && R(st.cur);
    if (!rep) {
      const groups = [...new Set(REPORTS.map(r => r.group))];
      root.innerHTML = `<div class="page-hd"><div class="page-hd-left"><h1>📊 Reports</h1><p>Opera-style reports from what HotelOps holds today — print, PDF, Excel, CSV or copy.</p></div></div>
        ${groups.map(g => `<div class="rpt-gh">${esc(g)}</div><div class="rpt-cat">${REPORTS.filter(r => r.group === g).map(r => { const n = safe(() => r.rows('all').length, 0); return `<button type="button" class="rpt-tile${n ? '' : ' empty'}" data-rpt-open="${r.id}"><span class="rpt-code">${esc(r.code)}</span><b>${esc(r.title)}</b><small>${esc(r.desc)}</small><i>${n ? n + ' line' + (n === 1 ? '' : 's') : 'Nothing loaded · ' + esc(r.src)}</i></button>`; }).join('')}</div>`).join('')}
        <p class="rpt-foot">Reports read today's Departures, Arrivals, In-House, No-Show, WhatsApp, Handover Book and Room Health. Load the Opera reports on those pages first; nothing is sent anywhere.</p>`;
      return;
    }
    const rows = data(rep), T = totals(rep, rows), f = st.f[rep.id] || 'all';
    const sortK = st.sort || rep.cols[0][0];
    root.innerHTML = `<div class="rpt-bar no-print">
        <button type="button" class="btn ghost sm" data-rpt-back>‹ All reports</button>
        <input type="search" class="rpt-q" id="rptQ" placeholder="Search this report…" value="${esc(st.q)}" autocomplete="off">
        ${rep.filters ? `<div class="rpt-seg">${rep.filters.map(([k, l]) => `<button type="button" class="${f === k ? 'on' : ''}" data-rpt-f="${k}">${esc(l)}</button>`).join('')}</div>` : ''}
        <span class="rpt-sp"></span>
        <button type="button" class="btn sm" data-rpt-x="copy">⧉ Copy</button><button type="button" class="btn sm" data-rpt-x="csv">CSV</button><button type="button" class="btn sm" data-rpt-x="xlsx">⬇ Excel</button><button type="button" class="btn sm gold" data-rpt-x="print">🖨 Print / PDF</button></div>
      <div class="rpt-sheet" id="rptSheet">
        <div class="rpt-hd"><div><div class="rpt-hotel">${esc(hotel())}</div><div class="rpt-title">${esc(rep.title)}${f !== 'all' && rep.filters ? ' — ' + esc((rep.filters.find(x => x[0] === f) || [])[1]) : ''}${st.q ? ` — "${esc(st.q)}"` : ''}</div></div>
          <div class="rpt-meta"><span>${esc(rep.code)}</span><span>Printed ${esc(stamp())}${user() ? ' · ' + esc(user()) : ''}</span><span>${rows.length} line${rows.length === 1 ? '' : 's'}</span></div></div>
        ${rows.length ? `<div class="rpt-tw"><table class="rpt-t"><thead><tr>${rep.cols.map(([k, l, kind]) => `<th class="${kind === 'm' || kind === 'n' ? 'num' : ''}" data-rpt-sort="${k}">${esc(l)}${sortK === k ? (st.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
          <tbody>${rows.map(r => `<tr>${rep.cols.map(([k, , kind]) => `<td class="${kind === 'm' || kind === 'n' ? 'num' : kind === 'r' ? 'rm' : ''}">${esc(cell(r[k], kind))}</td>`).join('')}</tr>`).join('')}</tbody>
          ${T.some(x => x != null) ? `<tfoot><tr>${rep.cols.map(([, , kind], i) => `<td class="${kind === 'm' ? 'num' : ''}">${i === 0 ? 'Total' : T[i] != null ? esc(money(T[i])) : ''}</td>`).join('')}</tr></tfoot>` : ''}</table></div>`
          : `<div class="rpt-none">Nothing to show. ${safe(() => rep.rows('all').length, 0) ? 'Try another filter or search.' : `Load today's report on the ${esc(rep.src)} page first.`}</div>`}
        <div class="rpt-end">*** End of report ***</div></div>`;
    const q = doc.getElementById('rptQ'); if (q && st.qFocus) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }

  // ── exports ──
  function table(rep) { const rows = data(rep); return [rep.cols.map(c => c[1])].concat(rows.map(r => rep.cols.map(([k, , kind]) => kind === 'm' ? (+r[k] || 0) : (r[k] == null ? '' : r[k])))); }
  function fileName(rep, ext) { const d = new Date(); return `${rep.code} ${rep.title} ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.${ext}`.replace(/[\\/:*?"<>|]/g, ''); }
  function save(blob, name) { const a = doc.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; doc.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  function exp(kind) {
    const rep = R(st.cur); if (!rep) return;
    const t = table(rep);
    if (t.length < 2) { toast('Nothing to export', 'warn'); return; }
    if (kind === 'copy') { const tsv = t.map(r => r.join('\t')).join('\n'); (navigator.clipboard ? navigator.clipboard.writeText(tsv) : Promise.reject()).then(() => toast(`Copied ${t.length - 1} lines — paste in Excel`, 'ok'), () => toast('Could not copy', 'err')); return; }
    if (kind === 'csv') { const q = v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v); save(new Blob(['﻿' + t.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), fileName(rep, 'csv')); toast('CSV saved', 'ok'); return; }
    if (kind === 'xlsx') {
      if (typeof XLSX === 'undefined') { toast('Excel is still loading — try again in a moment, or use CSV', 'warn'); return; }
      const head = [[hotel()], [rep.title + ' (' + rep.code + ')'], ['Printed ' + stamp() + (user() ? ' · ' + user() : '')], []];
      const T = totals(rep, data(rep)), foot = T.some(x => x != null) ? [rep.cols.map((c, i) => i === 0 ? 'Total' : T[i] != null ? Math.round(T[i] * 100) / 100 : '')] : [];
      const ws = XLSX.utils.aoa_to_sheet(head.concat(t, foot));
      ws['!cols'] = rep.cols.map(([k, l, kind]) => ({ wch: kind === 't' ? Math.min(48, Math.max(l.length + 2, ...t.slice(1).map(r => String(r[rep.cols.findIndex(c => c[0] === k)] || '').length))) : 12 }));
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, rep.code); XLSX.writeFile(wb, fileName(rep, 'xlsx')); toast('Excel saved', 'ok'); return;
    }
    if (kind === 'print') { doc.documentElement.classList.add('rpt-printing'); setTimeout(() => { W.print(); setTimeout(() => doc.documentElement.classList.remove('rpt-printing'), 500); }, 60); }
  }
  function toast(m, t) { if (typeof showToast === 'function') showToast(m, t); }

  // ── clicks ──
  function onClick(e) {
    const t = e.target.closest('button, th'); if (!t) return;
    if (t.dataset.rptOpen) { st.cur = t.dataset.rptOpen; st.q = ''; st.sort = null; st.dir = 1; render(); doc.getElementById('panel-' + PANEL)?.scrollTo?.(0, 0); }
    else if (t.hasAttribute('data-rpt-back')) { st.cur = ''; render(); }
    else if (t.dataset.rptF) { st.f[st.cur] = t.dataset.rptF; render(); }
    else if (t.dataset.rptSort) { const k = t.dataset.rptSort; if ((st.sort || R(st.cur).cols[0][0]) === k) st.dir = -st.dir; else { st.sort = k; st.dir = 1; } render(); }
    else if (t.dataset.rptX) exp(t.dataset.rptX);
  }

  const CSS = `
#rptRoot .rpt-gh{margin:18px 0 8px;font:700 11.5px var(--font);letter-spacing:.08em;text-transform:uppercase;color:var(--text3)}
#rptRoot .rpt-cat{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr));gap:10px}
#rptRoot .rpt-tile{display:flex;flex-direction:column;align-items:flex-start;gap:4px;text-align:left;padding:14px 16px;border-radius:var(--r2,14px);border:1px solid var(--border);background:var(--card);color:var(--text);cursor:pointer;font:inherit;transition:transform .12s,border-color .15s}
#rptRoot .rpt-tile:hover{border-color:var(--accent);transform:translateY(-1px)}#rptRoot .rpt-tile.empty{opacity:.62}
#rptRoot .rpt-tile b{font-size:15px}#rptRoot .rpt-tile small{color:var(--text2);font-size:12.5px;line-height:1.4}#rptRoot .rpt-tile i{font-style:normal;font-size:12px;font-weight:600;color:var(--accent);margin-top:4px}
#rptRoot .rpt-code{font:600 10.5px var(--mono);color:var(--text3);letter-spacing:.06em}
#rptRoot .rpt-foot{margin-top:18px;color:var(--text3);font-size:12.5px}
#rptRoot .rpt-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}#rptRoot .rpt-sp{flex:1}
#rptRoot .rpt-q{flex:1 1 200px;min-width:0;padding:9px 12px;border-radius:10px;border:1px solid var(--border2);background:var(--card);color:var(--text);font:inherit}
#rptRoot .rpt-seg{display:flex;gap:3px;padding:3px;border-radius:11px;background:var(--bg2);flex-wrap:wrap}#rptRoot .rpt-seg button{padding:6px 10px;border:0;border-radius:8px;background:none;color:var(--text2);font:600 12.5px var(--font);cursor:pointer}#rptRoot .rpt-seg button.on{background:var(--card);color:var(--accent);box-shadow:0 1px 3px rgba(0,0,0,.12)}
/* the sheet: white paper like an Opera report, in every theme */
#rptRoot .rpt-sheet{background:#fff;color:#111;border:1px solid #d9d9d9;border-radius:6px;padding:22px 24px;box-shadow:0 10px 30px -18px rgba(0,0,0,.35);font-family:Arial,'Helvetica Neue',sans-serif}
#rptRoot .rpt-hd{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;padding-bottom:10px;border-bottom:2px solid #111;margin-bottom:12px}
#rptRoot .rpt-hotel{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#444}#rptRoot .rpt-title{font-size:20px;font-weight:700;margin-top:2px}
#rptRoot .rpt-meta{display:flex;flex-direction:column;align-items:flex-end;gap:2px;font-size:11.5px;color:#555}#rptRoot .rpt-meta span:first-child{font-family:'Courier New',monospace;font-weight:700;color:#111}
#rptRoot .rpt-tw{overflow-x:auto;-webkit-overflow-scrolling:touch}
#rptRoot .rpt-t{width:100%;border-collapse:collapse;font-size:12.5px;min-width:0 !important}
#rptRoot .rpt-t th{position:sticky;top:0;background:#f2f2f2;color:#111;text-align:left;font-weight:700;font-size:11.5px;text-transform:uppercase;letter-spacing:.03em;padding:7px 8px;border-bottom:1px solid #999;cursor:pointer;white-space:nowrap;user-select:none}
#rptRoot .rpt-t td{padding:6px 8px;border-bottom:1px solid #e6e6e6;vertical-align:top;color:#111}
#rptRoot .rpt-t tbody tr:nth-child(even) td{background:#fafafa}
#rptRoot .rpt-t .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}#rptRoot .rpt-t .rm{font-weight:700;white-space:nowrap}
#rptRoot .rpt-t tfoot td{font-weight:700;border-top:2px solid #111;border-bottom:0;background:#fff !important}
#rptRoot .rpt-none{padding:30px 10px;text-align:center;color:#666}
#rptRoot .rpt-end{margin-top:14px;text-align:center;font-size:11px;color:#777;letter-spacing:.08em}
@media (max-width:768px){#rptRoot .rpt-sheet{padding:14px 12px}#rptRoot .rpt-title{font-size:17px}#rptRoot .rpt-meta{align-items:flex-start}}
@media print{
  html.rpt-printing body *{visibility:hidden !important}
  html.rpt-printing #rptSheet,html.rpt-printing #rptSheet *{visibility:visible !important}
  html.rpt-printing #rptSheet{position:absolute;left:0;top:0;width:100%;border:0;box-shadow:none;padding:0;border-radius:0}
  html.rpt-printing .rpt-tw{overflow:visible}
  html.rpt-printing .rpt-t thead{display:table-header-group}html.rpt-printing .rpt-t tr{break-inside:avoid}
  @page{size:A4 landscape;margin:12mm 10mm 14mm;@bottom-right{content:"Page " counter(page) " of " counter(pages);font:10px Arial}}
}`;

  function mount() {
    const main = doc.querySelector('#appWrapper .main') || doc.querySelector('.main') || doc.querySelector('main');
    const nav = doc.querySelector('.sidenav'); if (!main || !nav || doc.getElementById('panel-' + PANEL)) return;
    const s = doc.createElement('style'); s.textContent = CSS; doc.head.appendChild(s);
    const panel = doc.createElement('div'); panel.className = 'panel'; panel.id = 'panel-' + PANEL; panel.innerHTML = '<div id="rptRoot"></div>';
    main.appendChild(panel);
    panel.addEventListener('click', onClick);
    panel.addEventListener('input', e => { if (e.target.id === 'rptQ') { st.q = e.target.value; st.qFocus = true; clearTimeout(st.t); st.t = setTimeout(() => { render(); }, 150); } });
    panel.addEventListener('focusout', e => { if (e.target.id === 'rptQ') st.qFocus = false; });
    const item = doc.createElement('div'); item.className = 'nav-item'; item.id = 'nav-' + PANEL; item.dataset.panel = PANEL;
    item.setAttribute('onclick', "showPanel('" + PANEL + "')");
    item.innerHTML = '<div class="nav-icon">📊</div>Reports';
    const anchor = doc.getElementById('nav-trends'); if (anchor && anchor.parentNode) anchor.before(item); else nav.appendChild(item);
    const grid = doc.querySelector('.mob-more-grid');
    if (grid) {
      const b = doc.createElement('button'); b.className = 'mob-more-item'; b.dataset.panel = PANEL; b.type = 'button';
      b.setAttribute('onclick', "showPanel('" + PANEL + "');(typeof closeMobMore==='function'?closeMobMore:function(){})()");
      b.innerHTML = '<span class="mob-item-icon">📊</span>Reports'; grid.appendChild(b);
    }
    if (typeof hoApplyIcons === 'function') safe(() => hoApplyIcons());
    safe(() => {
      if (typeof ROLES !== 'undefined') ['owner', 'manager', 'supervisor', 'agent', 'readonly'].forEach(r => { const p = ROLES[r] && ROLES[r].panels; if (p && !p.includes(PANEL)) p.push(PANEL); });
      if (typeof currentProfile !== 'undefined' && currentProfile && typeof applyRole === 'function') applyRole(currentProfile.role);
    });
    let was = false;
    new MutationObserver(() => { const on = panel.classList.contains('active'); if (on && !was) render(); was = on; }).observe(panel, { attributes: true, attributeFilter: ['class'] });
    render();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount); else mount();

  // Ops Brain: "departures report", "in house list", "balances"…
  (W.BR_EXTRA = W.BR_EXTRA || []).push(() => REPORTS.map(r => ({ id: 'rep:' + r.id, kind: '📊 Reports', title: r.title + ' report', body: esc(r.desc) + `<div class="br-acts"><button class="btn gold" onclick="brClose();hoReports.open('${r.id}')">Open the report</button></div>`, text: r.title + ' report reports print pdf excel ' + r.desc + ' ' + r.code, boost: 1 })));

  W.hoReports = { open: id => { st.cur = R(id) ? id : ''; if (typeof showPanel === 'function') showPanel(PANEL); render(); }, list: () => REPORTS.map(r => ({ id: r.id, title: r.title, lines: safe(() => r.rows('all').length, 0) })), data: id => data(R(id)), table: id => table(R(id)) };
})(window);

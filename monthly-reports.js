// ═══════════════════════════════════════════════════════════
//  monthly-reports.js  —  📆 Monthly reports (shared by everyone)
//
//  The reports to finish for each month that ended ("Monthly TD check",
//  "Revenue data by accounts", "Statistics report" …). Add each one once.
//  Every month they come back: October's reports are due from 1 to 4 Nov
//  (the last day can be changed). Anyone can tick one; it shows who and when.
//  From the 1st the Ops Brain reminds whoever is on shift every day until all
//  are ticked; on the last day and after it, the reminder rings (late).
//
//  Saved under monthly/list/{id} = { name, hint, order }
//              monthly/done/{YYYY-MM}/{id} = { by, at }
//              monthly/cfg/by = last day (1–28, default 4)
//  The card sits at the top of Shift Tasks. Load after shifts.js.
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';

const MR = { list: {}, done: {}, by: 4, open: null };
const MR_SUGGEST = ['Monthly TD check', 'Revenue data by accounts', 'Statistics report'];
const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
const pad = n => String(n).padStart(2, '0');
const ym = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const mName = (key, opt) => new Date(key + '-15T12:00:00').toLocaleDateString('en-GB', opt || { month: 'long', year: 'numeric' });
const ord = n => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

/** Which month's reports are being done now, and where we are in the window */
function mrPeriod(now) {
  now = now || new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 15), by = MR.by || 4, d = now.getDate();
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return {
    key: ym(prev),                        // the month the reports are for
    month: ym(now),                       // the month they are done in
    by, day: d,
    left: by - d,                         // days left after today (0 = today is the last day)
    late: d > by,
    next: ym(now), nextIn: dim - d + 1,   // this month's reports start on the 1st of next month
  };
}
/** The reports, all of them, or (with a month) only those that count for it: one added in
 *  October counts from October's reports on (due in November), not as late for September. */
function mrItems(key) {
  return Object.entries(MR.list || {}).filter(([, v]) => v && v.name && (!key || !v.since || v.since <= key))
    .map(([id, v]) => ({ id, ...v })).sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(b.name));
}
function mrDoneOf(key) { return (MR.done || {})[key] || {}; }
function mrOpen(now) { const p = mrPeriod(now), dn = mrDoneOf(p.key); return mrItems(p.key).filter(r => !dn[r.id]); }
window.mrPeriod = mrPeriod; window.mrOpen = mrOpen; window.mrItems = mrItems;

function _who() { return (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || (typeof currentUser !== 'undefined' && currentUser && currentUser.email) || ''; }
function _can() { return typeof fbSet === 'function'; }

// ── Actions ───────────────────────────────────────────────
function mrToggle(id) {
  const p = mrPeriod(), dn = MR.done[p.key] = MR.done[p.key] || {}, r = MR.list[id]; if (!r) return;
  const was = !!dn[id];
  if (was) delete dn[id]; else dn[id] = { by: _who(), at: new Date().toISOString() };
  if (_can()) fbSet(`monthly/done/${p.key}/${id}`, was ? null : dn[id]);
  if (typeof logActivity === 'function') logActivity(was ? 'monthly_report_undone' : 'monthly_report_done', `${r.name} (${mName(p.key)})`);
  if (!was && !mrOpen().length && mrItems(p.key).length && typeof showToast === 'function') showToast(`🎉 All ${mName(p.key, { month: 'long' })} reports are done`, 'ok');
  mrRender();
}
function mrAdd(name, hint) {
  const nEl = document.getElementById('mrIn'), hEl = document.getElementById('mrHint');
  name = String(name != null ? name : nEl?.value || '').trim(); hint = String(hint != null ? hint : hEl?.value || '').trim();
  if (!name) { nEl?.focus(); return; }
  if (mrItems().some(r => r.name.toLowerCase() === name.toLowerCase())) { if (typeof showToast === 'function') showToast('That report is already on the list', 'warn'); return; }
  const id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const order = mrItems().reduce((m, r) => Math.max(m, r.order || 0), 0) + 1;
  MR.list[id] = { name, hint, order, since: ym(new Date()) };
  if (_can()) fbSet(`monthly/list/${id}`, MR.list[id]);
  if (typeof logActivity === 'function') logActivity('monthly_report_added', name);
  if (nEl) nEl.value = ''; if (hEl) hEl.value = '';
  mrRender();
  document.getElementById('mrIn')?.focus();
}
function mrEdit(id) {
  const r = MR.list[id]; if (!r) return;
  const name = prompt('Report name', r.name); if (name == null) return;
  const hint = prompt('Note (optional): where to find it, who sends it …', r.hint || ''); if (hint == null) return;
  r.name = name.trim() || r.name; r.hint = hint.trim();
  if (_can()) fbUpdate(`monthly/list/${id}`, { name: r.name, hint: r.hint });
  mrRender();
}
function mrDelete(id) {
  const r = MR.list[id]; if (!r) return;
  if (!confirm(`Remove "${r.name}" from the monthly reports? It won't come back next month.`)) return;
  delete MR.list[id];
  if (_can()) fbSet(`monthly/list/${id}`, null);
  if (typeof logActivity === 'function') logActivity('monthly_report_removed', r.name);
  mrRender();
}
function mrSetBy(v) {
  v = Math.max(1, Math.min(28, parseInt(v, 10) || 4)); MR.by = v;
  if (_can()) fbSet('monthly/cfg/by', v);
  mrRender();
}
function mrToggleOpen() { MR.open = !mrIsOpen(); try { localStorage.setItem('mr_open', MR.open ? '1' : '0'); } catch (_) {} mrRender(); }
function mrIsOpen() {
  if (MR.open != null) return MR.open;
  try { const v = localStorage.getItem('mr_open'); if (v != null) return v === '1'; } catch (_) {}
  return true;
}
Object.assign(window, { mrToggle, mrAdd, mrEdit, mrDelete, mrSetBy, mrToggleOpen });

// ── Card ──────────────────────────────────────────────────
function _fmtAt(iso) { try { const d = new Date(iso); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } }
function mrStatus(now) {
  const p = mrPeriod(now), all = mrItems(), items = mrItems(p.key), open = mrOpen(now), m = mName(p.key, { month: 'long' });
  const dueTxt = `due 1–${p.by} ${mName(p.month, { month: 'short' })}`;
  const nx = mName(ym(new Date((now || new Date()).getFullYear(), (now || new Date()).getMonth() + 1, 1)), { month: 'short' });
  if (!all.length) return { cls: '', text: 'Add the reports you finish every month', p };
  if (!items.length) return { cls: 'ok', text: `First time: ${mName(p.month, { month: 'long' })}'s reports, due 1–${p.by} ${nx}`, p };
  if (!open.length) return { cls: 'ok', text: `✓ All ${m} reports done · ${mName(p.month, { month: 'long' })}'s are due 1–${p.by} ${nx}`, p };
  if (p.late) return { cls: 'bad', text: `⚠️ Late: ${open.length} not done, they were ${dueTxt}`, p };
  if (p.left === 0) return { cls: 'bad', text: `⏰ Last day today: ${open.length} left`, p };
  return { cls: 'warn', text: `${open.length} left · ${p.left + 1} day${p.left ? 's' : ''} to go (${dueTxt})`, p };
}
function mrHtml() {
  const st = mrStatus(), p = st.p, items = mrItems(), cnt = mrItems(p.key), dn = mrDoneOf(p.key), open = mrIsOpen();
  const doneN = cnt.filter(r => dn[r.id]).length, pct = cnt.length ? Math.round(doneN / cnt.length * 100) : 0;
  const prevKey = ym(new Date(new Date(p.key + '-15').getFullYear(), new Date(p.key + '-15').getMonth() - 1, 15));
  const pdn = mrDoneOf(prevKey), pItems = mrItems(prevKey), pN = pItems.filter(r => pdn[r.id]).length;
  const rows = items.map(r => {
    const d = dn[r.id], counts = cnt.includes(r);
    if (!counts) return `<div class="mr-row new"><div class="mr-txt"><div class="mr-name">${esc(r.name)}</div>${r.hint ? `<div class="mr-hint">${esc(r.hint)}</div>` : ''}<div class="mr-by">Starts with ${esc(mName(r.since, { month: 'long' }))}'s report</div></div>
      <button class="cl-step-btn edit-btn" onclick="mrEdit('${r.id}')" title="Edit">✏️</button><button class="cl-step-btn del" onclick="mrDelete('${r.id}')" title="Remove">✕</button></div>`;
    return `<div class="mr-row${d ? ' done' : ''}${!d && p.late ? ' late' : ''}">
      <div class="st-check" role="checkbox" aria-checked="${d ? 'true' : 'false'}" tabindex="0" onclick="mrToggle('${r.id}')" onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();mrToggle('${r.id}')}" title="${d ? 'Done: tap to undo' : 'Tap when it is finished'}"></div>
      <div class="mr-txt"><div class="mr-name">${esc(r.name)}</div>
        ${r.hint ? `<div class="mr-hint">${esc(r.hint)}</div>` : ''}
        ${d ? `<div class="mr-by">✓ ${esc(d.by || 'Someone')} · ${esc(_fmtAt(d.at))}</div>` : (p.late ? '<div class="mr-by late">Not done yet: late</div>' : '')}</div>
      <button class="cl-step-btn edit-btn" onclick="mrEdit('${r.id}')" title="Edit">✏️</button>
      <button class="cl-step-btn del" onclick="mrDelete('${r.id}')" title="Remove">✕</button>
    </div>`;
  }).join('');
  const sugg = MR_SUGGEST.filter(n => !items.some(r => r.name.toLowerCase() === n.toLowerCase()));
  return `<div class="mr-card ${st.cls}" id="mrCard">
    <div class="mr-hd" onclick="mrToggleOpen()" role="button" tabindex="0" onkeydown="if(event.key==='Enter')mrToggleOpen()">
      <div class="mr-ttl">📆 Monthly reports <span class="mr-for">${esc(mName(cnt.length || !items.length ? p.key : p.month))}</span></div>
      ${cnt.length ? `<div class="mr-prog"><div class="mr-bar"><i style="width:${pct}%"></i></div><b>${doneN}/${cnt.length}</b></div>` : ''}
      <span class="mr-chev">${open ? '▾' : '▸'}</span>
      <div class="mr-st">${esc(st.text)}</div>
    </div>
    ${open ? `<div class="mr-body">
      <div class="mr-help">Reports for the month that ended. Finish them between the 1st and the
        <select class="mr-by-sel" onchange="mrSetBy(this.value)" aria-label="Last day">${Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}"${i + 1 === p.by ? ' selected' : ''}>${ord(i + 1)}</option>`).join('')}</select>
        of the new month. Everyone sees this list; I remind whoever is on shift every day until they're all ticked.</div>
      ${rows || '<div class="st-empty">No monthly reports yet: add them below (once), they come back every month.</div>'}
      ${sugg.length ? `<div class="mr-sugg"><span>Quick add:</span>${sugg.map(n => `<button class="btn ghost sm" onclick="mrAdd(${esc(JSON.stringify(n))},'')">＋ ${esc(n)}</button>`).join('')}</div>` : ''}
      <div class="st-add-wrap mr-add">
        <input class="st-add-in" id="mrIn" placeholder="Add a monthly report…" onkeydown="if(event.key==='Enter')mrAdd()"/>
        <input class="st-add-hint" id="mrHint" placeholder="Note (optional)" onkeydown="if(event.key==='Enter')mrAdd()"/>
        <button class="btn gold sm" onclick="mrAdd()">+ Add</button>
      </div>
      ${pItems.length && pN < pItems.length ? `<div class="mr-prev">${esc(mName(prevKey, { month: 'long' }))}: ${pN}/${pItems.length} were ticked</div>` : ''}
    </div>` : ''}
  </div>`;
}
function mrRender() {
  const panel = document.getElementById('panel-shifts'); if (!panel) return;
  let host = document.getElementById('mrHost');
  if (!host) {
    host = document.createElement('div'); host.id = 'mrHost';
    const tabs = document.getElementById('shiftTabs');
    if (tabs) tabs.parentNode.insertBefore(host, tabs); else panel.appendChild(host);
  }
  const f = document.activeElement, keep = f && (f.id === 'mrIn' || f.id === 'mrHint') ? { id: f.id, v: f.value, n: document.getElementById('mrIn')?.value, h: document.getElementById('mrHint')?.value } : null;
  host.innerHTML = mrHtml();
  if (keep) { const a = document.getElementById('mrIn'), b = document.getElementById('mrHint'); if (a) a.value = keep.n || ''; if (b) b.value = keep.h || ''; document.getElementById(keep.id)?.focus(); }
}
window.mrRender = mrRender;

// ── Live data ─────────────────────────────────────────────
function mrStart() {
  if (typeof fbListen !== 'function') { mrRender(); return; }
  fbListen('monthly/list', v => { MR.list = v && typeof v === 'object' ? v : {}; mrRender(); });
  fbListen('monthly/done', v => { MR.done = v && typeof v === 'object' ? v : {}; mrRender(); });
  fbListen('monthly/cfg', v => { const b = parseInt(v && v.by, 10); MR.by = b >= 1 && b <= 28 ? b : 4; mrRender(); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mrStart); else mrStart();

// ── Reminders (Ops Brain) ─────────────────────────────────
(window.BL_THINKERS = window.BL_THINKERS || []).push(add => {
  try {
    const p = mrPeriod(), open = mrOpen();
    if (!open.length) return;
    const last = p.left <= 0, m = mName(p.key, { month: 'long' });
    add({ id: `monthly:${p.key}:${p.month}-${pad(p.day)}`, type: 'monthly', icon: '📆', tone: last ? 'bad' : 'warn',
      text: p.late ? `${open.length} ${m} report${open.length > 1 ? 's are' : ' is'} late` : last ? `Last day for the ${m} reports: ${open.length} left` : `${m} reports: ${open.length} to finish by the ${ord(p.by)}`,
      why: open.map(r => r.name).join(' · '),
      acts: [['Open the list', () => { if (typeof showPanel === 'function') showPanel('shifts'); MR.open = true; mrRender(); setTimeout(() => document.getElementById('mrCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150); }]] });
  } catch (_) {}
});
})();

// ═══════════════════════════════════════════════════════════
//  ops-logs.js  —  🗂️ Front Office Log
//
//  Four everyday desk logs in one page:
//    🧳 Lost & Found   opslogs/lf/{id}
//    🔧 Maintenance    opslogs/mt/{id}      (notes in opslogs/mt/{id}/hist/{hid})
//    💵 Float count    opslogs/cash/{id}    (expected float: opslogs/cfg/float)
//    💰 Upsell list    opslogs/upsell/{date}/{guestKey}
//
//  Every save writes ONE record (fbSet / fbUpdate on its own path), never a
//  whole list, so two devices never overwrite each other.
//  Photos are shrunk in the browser (max 800px JPEG) and kept in the record.
//
//  The module adds its own panel, sidebar item, mobile-menu item and styles,
//  so index.html only needs  <script src="ops-logs.js"></script>  (after auth.js).
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';

const PANEL = 'ops-logs';
const ROOT = 'opslogs';
const DENOMS = [1000, 500, 200, 100, 50, 20, 10, 5, 1, 0.5, 0.25];
const dKey = d => 'd' + String(d).replace('.', '_');          // Firebase keys can't hold "."
const DAY = 864e5;

// ───────────────────────── small helpers ─────────────────────────
const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(s == null ? '' : String(s))
  : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
const $ = id => document.getElementById('ol-' + id);
const me = () => (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || 'Front Desk';
const role = () => (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.role) || 'agent';
const isLead = () => ['owner', 'manager', 'supervisor'].includes(role());
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const isoDay = d => { d = d || new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDT = ms => { if (!ms) return ''; const d = new Date(ms); return `${d.getDate()} ${MON[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtD = ms => { if (!ms) return ''; const d = new Date(ms); return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; };
const localInput = ms => { const d = new Date(ms || Date.now()); return `${isoDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const ageTxt = ms => {
  const h = (Date.now() - ms) / 36e5;
  if (h < 1) return Math.max(1, Math.round(h * 60)) + ' min';
  if (h < 24) return Math.round(h) + ' h';
  const d = Math.floor(h / 24); return d + ' day' + (d === 1 ? '' : 's');
};
const money = n => (Math.round((+n || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toast = (m, t) => { if (typeof showToast === 'function') showToast(m, t || 'ok'); };
const vals = o => Object.values(o || {}).filter(x => x && typeof x === 'object');
const act = (a, d) => { try { if (typeof logActivity === 'function') logActivity(a, d); } catch (_) {} };
function save(path, v) { try { if (typeof fbSet === 'function') return fbSet(ROOT + '/' + path, v); } catch (e) { toast('Could not save – check the connection', 'err'); } }
function patch(path, p) { try { if (typeof fbUpdate === 'function') return fbUpdate(ROOT + '/' + path, p); } catch (e) { toast('Could not save – check the connection', 'err'); } }

// ───────────────────────── state ─────────────────────────
let LF = {}, MT = {}, CASH = {}, CFG = {}, UP = {}, upDay = '';
let tab = 'lf', lfQ = '', lfF = 'found', mtF = 'open', upF = 'sugg';
try { tab = localStorage.getItem('ol_tab') || 'lf'; } catch (_) {}

// ───────────────────────── photos ─────────────────────────
/** Shrinks a picked photo to a small JPEG data URL (max 800px, about 150KB at most). */
function shrinkPhoto(file) {
  return new Promise((ok, no) => {
    if (!file || !/^image\//.test(file.type || 'image/')) return no(new Error('Not a picture'));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const out = (max, q) => {
        const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', q);
      };
      let d = out(800, 0.6);
      if (d.length > 200000) d = out(640, 0.5);       // ~150KB of bytes is ~200K base64 characters
      if (d.length > 200000) d = out(480, 0.45);
      URL.revokeObjectURL(url); ok(d);
    };
    img.onerror = () => { URL.revokeObjectURL(url); no(new Error('Could not read the picture')); };
    img.src = url;
  });
}
function viewPhoto(src) {
  if (!src || !/^data:image\//.test(src)) return;
  const v = document.createElement('div'); v.className = 'ol-viewer'; v.setAttribute('role', 'dialog');
  v.innerHTML = `<img alt="Photo" src="${esc(src)}"><span>Tap anywhere to close</span>`;
  v.onclick = () => v.remove(); document.body.appendChild(v);
}
const thumb = src => src && /^data:image\//.test(src) ? `<button class="ol-thumb" type="button" data-act="photo" aria-label="View photo"><img alt="" src="${esc(src)}"></button>` : '';

// ───────────────────────── modal ─────────────────────────
let modalPhoto = null;
function openModal(title, body, onSave, saveLabel) {
  closeModal(); modalPhoto = null;
  const m = document.createElement('div'); m.className = 'ol-modal'; m.id = 'ol-modal';
  m.innerHTML = `<div class="ol-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="ol-sheet-hd"><b>${esc(title)}</b><button type="button" class="ol-x" data-m="close" aria-label="Close">✕</button></div>
    <div class="ol-sheet-bd">${body}</div>
    <div class="ol-sheet-ft"><button type="button" class="btn" data-m="close">Cancel</button><button type="button" class="btn gold" data-m="save">${esc(saveLabel || 'Save')}</button></div></div>`;
  m.addEventListener('click', e => {
    if (e.target === m || e.target.closest('[data-m="close"]')) return closeModal();
    if (e.target.closest('[data-m="save"]')) { if (onSave(m) !== false) closeModal(); }
  });
  const ph = m.querySelector('.ol-ph-in');
  if (ph) ph.addEventListener('change', async () => {
    const f = ph.files && ph.files[0]; if (!f) return;
    const box = m.querySelector('.ol-ph-prev'); box.textContent = 'Making the photo smaller…';
    try { modalPhoto = await shrinkPhoto(f); box.innerHTML = `<img alt="" src="${esc(modalPhoto)}"><small>${Math.round(modalPhoto.length * 0.75 / 1024)} KB · ready</small>`; }
    catch (err) { modalPhoto = null; box.textContent = err.message; }
  });
  document.body.appendChild(m);
  const first = m.querySelector('input:not([type=file]):not([type=checkbox]),textarea,select'); if (first) setTimeout(() => first.focus(), 50);
}
function closeModal() { const m = document.getElementById('ol-modal'); if (m) m.remove(); }
const fv = (m, n) => { const el = m.querySelector(`[name="${n}"]`); return el ? (el.type === 'checkbox' ? el.checked : String(el.value || '').trim()) : ''; };
const field = (label, inner, wide) => `<label class="ol-f${wide ? ' wide' : ''}"><span>${label}</span>${inner}</label>`;
const photoField = () => `<div class="ol-f wide"><span>Photo (optional)</span><label class="ol-ph"><input class="ol-ph-in" type="file" accept="image/*">📷 Take or choose a photo</label><div class="ol-ph-prev"></div></div>`;
const timeOf = (m, n) => { const v = fv(m, n); const t = v ? new Date(v).getTime() : NaN; return isNaN(t) ? Date.now() : t; };

// ═════════════════════════ 🧳 LOST & FOUND ═════════════════════════
const lfOld = r => r.status === 'found' && Date.now() - (r.at || 0) > 90 * DAY;
function lfNew() {
  openModal('🧳 Log a found item', `<div class="ol-form">
    ${field('What is it? *', '<input name="what" maxlength="120" placeholder="e.g. Black phone charger">', true)}
    ${field('Where found', '<input name="where" maxlength="80" placeholder="e.g. Lobby, room, gym">')}
    ${field('Room', '<input name="room" maxlength="10" inputmode="numeric" placeholder="e.g. 412">')}
    ${field('Found by', `<input name="foundBy" maxlength="60" value="${esc(me())}">`)}
    ${field('Date and time', `<input name="at" type="datetime-local" value="${localInput()}">`)}
    ${field('Kept where', '<input name="storage" maxlength="80" placeholder="e.g. Lost & Found box, shelf B">', true)}
    ${photoField()}</div>`, m => {
    const what = fv(m, 'what'); if (!what) { toast('Write what the item is', 'warn'); return false; }
    const id = newId();
    const r = { id, what, where: fv(m, 'where'), room: fv(m, 'room'), foundBy: fv(m, 'foundBy') || me(), at: timeOf(m, 'at'),
      storage: fv(m, 'storage'), status: 'found', photo: modalPhoto || null, by: me(), created: Date.now() };
    LF[id] = r; save('lf/' + id, r); act('lostfound_logged', what); toast('🧳 Item logged'); render();
  }, 'Save item');
}
function lfReturn(id) {
  const r = LF[id]; if (!r) return;
  openModal('Return: ' + r.what, `<div class="ol-form">
    ${field('Returned to (guest name) *', '<input name="to" maxlength="80" placeholder="Name as on the ID">', true)}
    ${field('Handed over by', `<input name="by" maxlength="60" value="${esc(me())}">`)}
    ${field('When', `<input name="at" type="datetime-local" value="${localInput()}">`)}
    <label class="ol-check wide"><input type="checkbox" name="id"> ID checked and matches the guest</label></div>`, m => {
    const to = fv(m, 'to'); if (!to) { toast('Write who it was returned to', 'warn'); return false; }
    if (!fv(m, 'id') && !confirm('The ID is not ticked as checked. Return it anyway?')) return false;
    const ret = { to, by: fv(m, 'by') || me(), at: timeOf(m, 'at'), idChecked: !!fv(m, 'id') };
    Object.assign(r, { status: 'returned', ret }); patch('lf/' + id, { status: 'returned', ret });
    act('lostfound_returned', r.what); toast('✅ Marked as returned'); render();
  }, 'Mark returned');
}
function lfDispose(id) {
  const r = LF[id]; if (!r || !confirm(`Mark "${r.what}" as disposed?`)) return;
  const disp = { by: me(), at: Date.now() }; Object.assign(r, { status: 'disposed', disp });
  patch('lf/' + id, { status: 'disposed', disp }); act('lostfound_disposed', r.what); render();
}
function lfUndo(id) {
  const r = LF[id]; if (!r || !confirm('Put this item back as "in storage"?')) return;
  Object.assign(r, { status: 'found', ret: null, disp: null }); patch('lf/' + id, { status: 'found', ret: null, disp: null }); render();
}
function lfDelete(id) {
  const r = LF[id]; if (!r || !confirm(`Delete "${r.what}" for good? Use this only for a mistake.`)) return;
  delete LF[id]; save('lf/' + id, null); render();
}
function lfHtml() {
  const all = vals(LF), q = lfQ.toLowerCase();
  const cnt = { found: 0, returned: 0, disposed: 0 }; all.forEach(r => { cnt[r.status] = (cnt[r.status] || 0) + 1; });
  const old = all.filter(lfOld).length;
  const L = all.filter(r => (lfF === 'all' || r.status === lfF) && (!q || [r.what, r.where, r.room, r.storage, r.foundBy, r.ret && r.ret.to].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => (b.at || 0) - (a.at || 0));
  const chip = (k, l) => `<button type="button" class="ol-fchip${lfF === k ? ' on' : ''}" data-act="lfF" data-k="${k}">${l}<em>${k === 'all' ? all.length : cnt[k] || 0}</em></button>`;
  return `<div class="ol-bar">
      <button type="button" class="btn gold" data-act="lfNew">＋ Log found item</button>
      <input class="ol-q" id="ol-lfq" type="search" placeholder="🔍 Search item, room, place, guest…" value="${esc(lfQ)}">
    </div>
    <div class="ol-fchips">${chip('found', '📦 In storage')}${chip('returned', '✅ Returned')}${chip('disposed', '🗑️ Disposed')}${chip('all', 'All')}</div>
    ${old ? `<div class="ol-hint warn">⏳ ${old} item${old === 1 ? ' has' : 's have'} been in storage more than 90 days. Consider disposing ${old === 1 ? 'it' : 'them'} (follow hotel policy).</div>` : ''}
    ${L.length ? `<div class="ol-list">${L.map(lfCard).join('')}</div>` : `<div class="ol-empty">${all.length ? 'Nothing matches.' : '🧳 No items yet. Tap <b>Log found item</b> when something is handed in.'}</div>`}`;
}
function lfCard(r) {
  const st = { found: ['In storage', 'blue'], returned: ['Returned', 'green'], disposed: ['Disposed', 'muted'] }[r.status] || ['?', 'muted'];
  const ret = r.ret || {}, disp = r.disp || {};
  return `<div class="ol-card${lfOld(r) ? ' old' : ''}" data-id="${esc(r.id)}" data-kind="lf">
    ${thumb(r.photo)}
    <div class="ol-main">
      <div class="ol-top"><b class="ol-title">${esc(r.what)}</b><span class="ol-chip ${st[1]}">${st[0]}</span></div>
      <div class="ol-chips">${r.room ? `<span class="ol-chip">🚪 ${esc(r.room)}</span>` : ''}${r.where ? `<span class="ol-chip">📍 ${esc(r.where)}</span>` : ''}${r.storage ? `<span class="ol-chip">🗄️ ${esc(r.storage)}</span>` : ''}</div>
      <div class="ol-meta">Found by ${esc(r.foundBy || '?')} · ${esc(fmtDT(r.at))} · ${esc(ageTxt(r.at || Date.now()))} ago</div>
      ${r.status === 'returned' ? `<div class="ol-meta ok">Returned to <b>${esc(ret.to)}</b> by ${esc(ret.by)} · ${esc(fmtDT(ret.at))} · ${ret.idChecked ? '🪪 ID checked' : '⚠️ ID not checked'}</div>` : ''}
      ${r.status === 'disposed' ? `<div class="ol-meta">Disposed by ${esc(disp.by)} · ${esc(fmtDT(disp.at))}</div>` : ''}
      ${lfOld(r) ? '<div class="ol-meta warn">⏳ Over 90 days in storage: consider disposing.</div>' : ''}
      <div class="ol-acts">${r.status === 'found'
        ? '<button type="button" class="btn mint sm" data-act="lfReturn">↩ Return to guest</button><button type="button" class="btn sm" data-act="lfDispose">🗑️ Disposed</button>'
        : '<button type="button" class="btn sm" data-act="lfUndo">Undo</button>'}${isLead() ? '<button type="button" class="ol-link" data-act="lfDelete">Delete</button>' : ''}</div>
    </div></div>`;
}

// ═════════════════════════ 🔧 MAINTENANCE ═════════════════════════
const PRIO = { high: ['High', 'red', 0], normal: ['Normal', 'amber', 1], low: ['Low', 'muted', 2] };
const MST = { open: ['Open', 'red'], progress: ['In progress', 'amber'], fixed: ['Fixed', 'green'] };
const mtLive = r => r.status !== 'fixed';
const mtOverdue = r => mtLive(r) && r.prio === 'high' && Date.now() - (r.at || 0) > DAY;
function mtNew() {
  openModal('🔧 New maintenance ticket', `<div class="ol-form">
    ${field('Room or area *', '<input name="area" maxlength="60" placeholder="e.g. 305, Lobby toilet">')}
    ${field('Priority', '<select name="prio"><option value="normal">Normal</option><option value="high">High (guest affected)</option><option value="low">Low</option></select>')}
    ${field('What is the problem? *', '<textarea name="problem" rows="3" maxlength="400" placeholder="e.g. AC not cooling, guest waiting"></textarea>', true)}
    ${field('Reported by', `<input name="by" maxlength="60" value="${esc(me())}">`)}
    ${field('Reported at', `<input name="at" type="datetime-local" value="${localInput()}">`)}
    ${photoField()}</div>`, m => {
    const area = fv(m, 'area'), problem = fv(m, 'problem');
    if (!area || !problem) { toast('Write the room or area and the problem', 'warn'); return false; }
    const id = newId(), at = timeOf(m, 'at'), by = fv(m, 'by') || me(), hid = newId();
    const r = { id, area, problem, prio: fv(m, 'prio') || 'normal', photo: modalPhoto || null, by, at, status: 'open', created: Date.now(),
      hist: { [hid]: { at: Date.now(), by: me(), status: 'open', text: 'Ticket opened' } } };
    MT[id] = r; save('mt/' + id, r); act('maintenance_opened', area + ': ' + problem); toast('🔧 Ticket saved'); render();
  }, 'Save ticket');
}
function mtStep(id, status, text) {
  const r = MT[id]; if (!r) return;
  const hid = newId(), h = { at: Date.now(), by: me(), status, text: text || '' };
  const p = { status, ['hist/' + hid]: h };
  if (status === 'fixed') { p.fixedBy = me(); p.fixedAt = Date.now(); } else { p.fixedBy = null; p.fixedAt = null; }
  r.hist = Object.assign({}, r.hist, { [hid]: h }); Object.assign(r, { status, fixedBy: p.fixedBy, fixedAt: p.fixedAt });
  patch('mt/' + id, p); act('maintenance_' + status, r.area); render();
}
function mtFix(id) {
  const r = MT[id]; if (!r) return;
  openModal('✅ Mark fixed: ' + r.area, `<div class="ol-form">${field('What was done? (optional)', '<textarea name="note" rows="3" maxlength="300" placeholder="e.g. Filter cleaned, AC working"></textarea>', true)}</div>`,
    m => { mtStep(id, 'fixed', fv(m, 'note') || 'Fixed'); toast('✅ Ticket fixed'); }, 'Mark fixed');
}
function mtNote(id) {
  const r = MT[id]; if (!r) return;
  openModal('📝 Add a note: ' + r.area, `<div class="ol-form">${field('Note', '<textarea name="note" rows="3" maxlength="300" placeholder="e.g. Engineering called, coming at 3pm"></textarea>', true)}</div>`, m => {
    const text = fv(m, 'note'); if (!text) return false;
    const hid = newId(), h = { at: Date.now(), by: me(), text };
    r.hist = Object.assign({}, r.hist, { [hid]: h }); patch('mt/' + id, { ['hist/' + hid]: h }); render();
  }, 'Add note');
}
function mtDelete(id) { const r = MT[id]; if (!r || !confirm(`Delete the ticket for ${r.area}? Use this only for a mistake.`)) return; delete MT[id]; save('mt/' + id, null); render(); }
function mtHtml() {
  const all = vals(MT), live = all.filter(mtLive), over = all.filter(mtOverdue).length;
  const L = all.filter(r => mtF === 'all' || (mtF === 'open' ? mtLive(r) : r.status === 'fixed')).sort((a, b) =>
    (mtLive(b) - mtLive(a)) || (mtLive(a) ? (mtOverdue(b) - mtOverdue(a)) || ((PRIO[a.prio] || PRIO.normal)[2] - (PRIO[b.prio] || PRIO.normal)[2]) || (a.at - b.at)
      : (b.fixedAt || 0) - (a.fixedAt || 0)));
  const chip = (k, l, n) => `<button type="button" class="ol-fchip${mtF === k ? ' on' : ''}" data-act="mtF" data-k="${k}">${l}<em>${n}</em></button>`;
  return `<div class="ol-bar"><button type="button" class="btn gold" data-act="mtNew">＋ New ticket</button>
      <div class="ol-stats"><span><b>${live.length}</b> open</span>${over ? `<span class="bad"><b>${over}</b> overdue</span>` : ''}<span><b>${all.length - live.length}</b> fixed</span></div></div>
    <div class="ol-fchips">${chip('open', '🔴 Open', live.length)}${chip('fixed', '✅ Fixed', all.length - live.length)}${chip('all', 'All', all.length)}</div>
    ${over ? `<div class="ol-hint bad">⏰ ${over} high-priority ticket${over === 1 ? ' is' : 's are'} open for more than 24 hours. Chase engineering.</div>` : ''}
    ${L.length ? `<div class="ol-list">${L.slice(0, 80).map(mtCard).join('')}</div>` : `<div class="ol-empty">${mtF === 'open' ? '🎉 No open tickets. All good!' : '🔧 No tickets yet.'}</div>`}`;
}
function mtCard(r) {
  const p = PRIO[r.prio] || PRIO.normal, s = MST[r.status] || MST.open;
  const hist = vals(r.hist).sort((a, b) => (a.at || 0) - (b.at || 0));
  return `<div class="ol-card mt${mtOverdue(r) ? ' over' : ''}${r.status === 'fixed' ? ' done' : ''}" data-id="${esc(r.id)}" data-kind="mt">
    ${thumb(r.photo)}
    <div class="ol-main">
      <div class="ol-top"><b class="ol-title">${esc(r.area)}</b><span class="ol-chip ${s[1]}">${s[0]}</span><span class="ol-chip ${p[1]}">${p[0]}</span>
        ${mtLive(r) ? `<span class="ol-age${mtOverdue(r) ? ' bad' : ''}">${esc(ageTxt(r.at))} open</span>` : ''}</div>
      <div class="ol-text">${esc(r.problem)}</div>
      <div class="ol-meta">Reported by ${esc(r.by || '?')} · ${esc(fmtDT(r.at))}${r.status === 'fixed' ? ` · <span class="ok">fixed by ${esc(r.fixedBy)} ${esc(fmtDT(r.fixedAt))}</span>` : ''}</div>
      ${hist.length > 1 ? `<details class="ol-hist"><summary>History (${hist.length})</summary>${hist.map(h => `<div><small>${esc(fmtDT(h.at))} · ${esc(h.by)}</small>${h.status ? ` <span class="ol-chip ${(MST[h.status] || MST.open)[1]}">${(MST[h.status] || MST.open)[0]}</span>` : ''} ${esc(h.text || '')}</div>`).join('')}</details>` : ''}
      <div class="ol-acts">
        ${r.status === 'open' ? '<button type="button" class="btn amber sm" data-act="mtStart">▶ Start work</button>' : ''}
        ${mtLive(r) ? '<button type="button" class="btn mint sm" data-act="mtFix">✅ Fixed</button>' : '<button type="button" class="btn sm" data-act="mtReopen">↺ Reopen</button>'}
        <button type="button" class="btn sm" data-act="mtNote">📝 Note</button>
        ${isLead() ? '<button type="button" class="ol-link" data-act="mtDelete">Delete</button>' : ''}
      </div>
    </div></div>`;
}

// ═════════════════════════ 💵 FLOAT / CASH COUNT ═════════════════════════
const shiftNow = () => { try { return typeof hoShiftNow === 'function' ? hoShiftNow(new Date()) : null; } catch (_) { return null; } };
const SHIFT_LBL = { morning: '🌅 Morning', afternoon: '🌇 Afternoon', night: '🌙 Night', mid: '☀️ Mid' };
const cashSum = c => DENOMS.reduce((t, d) => t + d * (+((c || {})[dKey(d)]) || 0), 0);
function cashLive() {
  const box = document.getElementById('panel-' + PANEL); if (!box) return;
  const c = {}; box.querySelectorAll('.ol-den input').forEach(i => { c[i.dataset.k] = +i.value || 0; });
  box.querySelectorAll('.ol-den').forEach(r => { const i = r.querySelector('input'); r.querySelector('output').textContent = money((+i.value || 0) * +i.dataset.v); });
  const tot = cashSum(c), exp = +CFG.expected || 0, diff = tot - exp;
  const t = $('cashTot'); if (t) t.textContent = money(tot);
  const d = $('cashDiff');
  if (d) { d.className = 'ol-diff ' + (!exp ? '' : Math.abs(diff) < 0.005 ? 'ok' : 'bad'); d.textContent = !exp ? 'Set the expected float to see the difference' : Math.abs(diff) < 0.005 ? '✅ Matches the float' : (diff > 0 ? '▲ Over by AED ' : '▼ Short by AED ') + money(Math.abs(diff)); }
}
function cashSave() {
  const box = document.getElementById('panel-' + PANEL), counts = {};
  box.querySelectorAll('.ol-den input').forEach(i => { const n = Math.max(0, Math.round(+i.value || 0)); if (n) counts[i.dataset.k] = n; });
  if (!Object.keys(counts).length) { toast('Enter how many of each note or coin', 'warn'); return; }
  const by = ($('cashBy').value || '').trim() || me(), sh = shiftNow(), total = Math.round(cashSum(counts) * 100) / 100, exp = +CFG.expected || 0;
  const id = newId(), r = { id, at: Date.now(), day: isoDay(sh && sh.start || new Date()), shift: sh ? sh.key : '', by,
    witness: ($('cashWit').value || '').trim(), note: ($('cashNote').value || '').trim(), counts, total, expected: exp || null,
    diff: exp ? Math.round((total - exp) * 100) / 100 : null };
  CASH[id] = r; save('cash/' + id, r);
  box.querySelectorAll('.ol-cash input').forEach(i => { if (i.id !== 'ol-cashBy') i.value = ''; });
  // keep the newest 200 counts; older ones are removed one by one (never the whole list)
  const old = vals(CASH).sort((a, b) => b.at - a.at).slice(200);
  if (old.length) { const p = {}; old.forEach(o => { p[o.id] = null; delete CASH[o.id]; }); patch('cash', p); }
  act('float_counted', `AED ${money(total)}${r.diff ? ` (diff ${r.diff})` : ''}`);
  toast(r.diff ? `Saved. Difference AED ${money(r.diff)}` : '💵 Count saved', r.diff ? 'warn' : 'ok');
  render();
}
function cashSetExpected() {
  openModal('💵 Expected float', `<div class="ol-form">${field('Float amount in AED (the same every shift)', `<input name="exp" type="number" min="0" step="0.25" inputmode="decimal" value="${esc(CFG.expected || '')}">`, true)}
    <p class="ol-small wide">This is set once for the whole hotel. Every count is compared with it.</p></div>`, m => {
    const v = +fv(m, 'exp'); if (!(v >= 0)) { toast('Enter a number', 'warn'); return false; }
    CFG = { expected: v, by: me(), at: Date.now() }; save('cfg/float', CFG); toast('Expected float saved'); render();
  });
}
function cashHtml() {
  const sh = shiftNow(), exp = +CFG.expected || 0;
  const H = vals(CASH).sort((a, b) => b.at - a.at).slice(0, 60);
  const lastShift = H[0];
  return `<div class="ol-cash">
    <div class="ol-card ol-count">
      <div class="ol-top"><b class="ol-title">Count the float</b><span class="ol-chip blue">${esc(sh ? (SHIFT_LBL[sh.key] || sh.key) : 'Shift')} shift</span></div>
      <div class="ol-exp">Expected float: <b>${exp ? 'AED ' + money(exp) : 'not set'}</b>
        ${isLead() || !exp ? `<button type="button" class="ol-link" data-act="cashExp">${exp ? 'Change' : 'Set it'}</button>` : ''}
        ${CFG.by ? `<small>set by ${esc(CFG.by)}, ${esc(fmtD(CFG.at))}</small>` : ''}</div>
      <div class="ol-dens">${DENOMS.map(d => `<label class="ol-den"><span>${d >= 1 ? 'AED ' + d : d * 100 + ' fils'}</span><span class="ol-x-sign">×</span>
        <input type="number" min="0" step="1" inputmode="numeric" data-k="${dKey(d)}" data-v="${d}" placeholder="0" aria-label="How many ${d >= 1 ? 'AED ' + d : d * 100 + ' fils'}"><output>0.00</output></label>`).join('')}</div>
      <div class="ol-totrow"><span>Total</span><b>AED <span id="ol-cashTot">0.00</span></b></div>
      <div class="ol-diff" id="ol-cashDiff"></div>
      <div class="ol-form">
        ${field('Counted by', `<input id="ol-cashBy" maxlength="60" value="${esc(me())}">`)}
        ${field('Witness (optional)', '<input id="ol-cashWit" maxlength="60" placeholder="Name">')}
        ${field('Note (optional)', '<input id="ol-cashNote" maxlength="200" placeholder="e.g. 50 AED paid out for taxi, receipt in drawer">', true)}
      </div>
      <div class="ol-acts"><button type="button" class="btn gold" data-act="cashSave">💾 Save count</button><button type="button" class="btn sm" data-act="cashClear">Clear</button></div>
    </div>
    <div class="ol-card ol-histc">
      <div class="ol-top"><b class="ol-title">History</b><span class="ol-small">last ${H.length} of 60</span></div>
      ${lastShift ? '' : '<div class="ol-empty sm">No counts yet.</div>'}
      ${H.map(r => `<div class="ol-hrow"><div><b>AED ${money(r.total)}</b> <span class="ol-chip">${esc(SHIFT_LBL[r.shift] || r.shift || '')}</span>
          ${r.diff == null ? '' : Math.abs(r.diff) < 0.005 ? '<span class="ol-chip green">OK</span>' : `<span class="ol-chip red">${r.diff > 0 ? '+' : '−'}${money(Math.abs(r.diff))}</span>`}
          <div class="ol-meta">${esc(fmtDT(r.at))} · ${esc(r.by)}${r.witness ? ' · witness ' + esc(r.witness) : ''}</div>
          ${r.note ? `<div class="ol-meta">📝 ${esc(r.note)}</div>` : ''}</div></div>`).join('')}
    </div></div>`;
}

// ═════════════════════════ 💰 UPSELL LIST ═════════════════════════
const OFFERS = { eci: '⏰ Early check-in', lco: '🌙 Late check-out', bb: '🍳 Breakfast', upg: '⬆️ Upgrade' };
const gKey = g => String(g.conf || ((g.room || '') + '_' + (g.name || ''))).replace(/[.#$/[\]\s]/g, '_').slice(0, 80) || 'x';
const pick = (g, ...ks) => { for (const k of ks) if (g[k] != null && String(g[k]).trim()) return String(g[k]).trim(); return ''; };
function etaMin(s) { const m = String(s || '').match(/(\d{1,2})[:.h](\d{2})\s*(am|pm)?/i); if (!m) return null; let h = +m[1]; if (m[3]) { h %= 12; if (/pm/i.test(m[3])) h += 12; } return h * 60 + +m[2]; }
/** Breakfast already included? true / false, or null when the data does not say (same rule as Package Audit: a code ending in BB is breakfast). */
function hasBreakfast(rate, pkgs) {
  const all = (rate + ' ' + pkgs).toUpperCase();
  if (!all.trim()) return null;
  if (/BB\b|\bHB|\bFB|BFST|BRKF|BREAKFAST|HALF ?BOARD|FULL ?BOARD|\bBB[A-Z]|MBREAK/.test(all)) return true;
  if (/\bRO\b|ROOM ?ONLY|NOBB/.test(all) || rate) return false;   // a rate code without a breakfast part
  return null;
}
function upGuests() {
  const G = (typeof arrGuests !== 'undefined' && Array.isArray(arrGuests)) ? arrGuests : [];
  return G.filter(g => g && (g.room || g.name)).map(g => {
    const rate = pick(g, 'rateCode', 'rate', 'rateCodes', 'rate_code'), pk = pick(g, 'products', 'packages');
    const eta = pick(g, 'eta', 'arrTime', 'arrivalTime'), rt = pick(g, 'roomType', 'roomCat', 'rtc', 'roomCategory');
    const mem = pick(g, 'membership', 'member', 'loyalty', 'tier');
    const allBooking = !mem && /\ball\b|accor/i.test(g.source || '');
    const nights = +g.nights || 1, em = etaMin(eta), bb = hasBreakfast(rate, pk);
    const why = {};
    if (em != null && em < 14 * 60) why.eci = 'ETA ' + eta;
    if (nights >= 4) why.lco = nights + ' nights'; else if (mem) why.lco = 'Member';
    if (bb === false) why.bb = rate ? 'No breakfast in ' + rate : 'No breakfast';
    if (mem) why.upg = 'Member ' + mem; else if (nights >= 5) why.upg = nights + ' nights'; else if (allBooking) why.upg = 'ALL booking';
    return { g, key: gKey(g), rate, rt, eta, mem, allBooking, nights, why, n: Object.keys(why).length };
  });
}
function upSave(key, p) {
  const r = Object.assign({}, UP[key] || {}, p, { by: me(), at: Date.now() });
  UP[key] = r; patch('upsell/' + upDay + '/' + key, Object.assign({}, p, { by: r.by, at: r.at }));
}
function upHtml() {
  const L = upGuests(), d = window._arrDate;
  if (!L.length) return `<div class="ol-empty big"><i>💰</i><b>No arrivals loaded yet</b><span>Load today's arrivals in the <button type="button" class="ol-link" data-act="goArr">🛎️ Arrivals</button> page first. The list of guests to offer upgrades, breakfast, early check-in and late check-out then appears here.</span></div>`;
  const recs = vals(UP), sold = recs.filter(r => r.sold), total = sold.reduce((t, r) => t + (+r.amount || 0), 0), offered = recs.filter(r => r.offered || r.sold).length;
  const shown = L.filter(x => upF === 'all' || (upF === 'sugg' ? x.n : (UP[x.key] || {}).sold)).sort((a, b) => b.n - a.n || String(a.g.room).localeCompare(String(b.g.room), undefined, { numeric: true }));
  const sugg = L.filter(x => x.n).length;
  const chip = (k, l, n) => `<button type="button" class="ol-fchip${upF === k ? ' on' : ''}" data-act="upF" data-k="${k}">${l}<em>${n}</em></button>`;
  const noData = !L.some(x => x.rate || x.eta || x.mem);
  return `<div class="ol-kpis"><div><small>Arrivals</small><b>${L.length}</b></div><div><small>Offered</small><b>${offered}</b></div><div><small>Sold</small><b>${sold.length}</b></div><div class="gold"><small>Sold today</small><b>AED ${money(total)}</b></div></div>
    ${d && d !== isoDay() ? `<div class="ol-hint warn">These arrivals are for ${esc(d)}. Ticks are saved under today (${esc(isoDay())}).</div>` : ''}
    ${noData ? '<div class="ol-hint">The arrivals list has no ETA, rate code or membership, so tips use the length of stay and ALL bookings only. Every guest can still be ticked.</div>' : ''}
    <div class="ol-fchips">${chip('sugg', '✨ Suggested', sugg)}${chip('all', 'All arrivals', L.length)}${chip('sold', '💰 Sold', sold.length)}</div>
    ${shown.length ? `<div class="ol-list">${shown.map(upRow).join('')}</div>` : `<div class="ol-empty">${upF === 'sold' ? 'Nothing sold yet today.' : 'No clear suggestions. Switch to <b>All arrivals</b> to tick anyone.'}</div>`}`;
}
function upRow(x) {
  const r = UP[x.key] || {}, items = r.items || {}, g = x.g;
  return `<div class="ol-card up${r.sold ? ' sold' : ''}" data-key="${esc(x.key)}" data-kind="up">
    <div class="ol-main">
      <div class="ol-top"><span class="ol-room">${esc(g.room || '—')}</span><b class="ol-title">${esc(g.name || 'Guest')}</b>
        <span class="ol-small">${x.nights} night${x.nights === 1 ? '' : 's'}${x.rt ? ' · ' + esc(x.rt) : ''}${x.rate ? ' · ' + esc(x.rate) : ''}${x.eta ? ' · ETA ' + esc(x.eta) : ''}</span>
        ${x.mem ? `<span class="ol-chip gold">⭐ ${esc(x.mem)}</span>` : x.allBooking ? '<span class="ol-chip gold">ALL</span>' : ''}</div>
      <div class="ol-offers">${Object.keys(OFFERS).map(k => `<button type="button" class="ol-offer${x.why[k] ? ' sug' : ''}${items[k] ? ' on' : ''}" data-act="upItem" data-k="${k}" title="${esc(x.why[k] || 'Tap to mark what you offered')}">${OFFERS[k]}${x.why[k] ? `<small>${esc(x.why[k])}</small>` : ''}</button>`).join('')}</div>
      <div class="ol-uprow">
        <label class="ol-check"><input type="checkbox" data-act="upOff"${r.offered || r.sold ? ' checked' : ''}> Offered</label>
        <label class="ol-check"><input type="checkbox" data-act="upSold"${r.sold ? ' checked' : ''}> Sold</label>
        <label class="ol-amt"${r.sold ? '' : ' hidden'}>AED <input type="number" min="0" step="1" inputmode="decimal" data-act="upAmt" value="${esc(r.amount || '')}" placeholder="0"></label>
        ${r.by ? `<span class="ol-small">${esc(r.by)} · ${esc(fmtDT(r.at).split(' ').pop())}</span>` : ''}
      </div>
    </div></div>`;
}

// ═════════════════════════ page ═════════════════════════
const TABS = [['lf', '🧳', 'Lost & Found'], ['mt', '🔧', 'Maintenance'], ['cash', '💵', 'Float count'], ['up', '💰', 'Upsell']];
function tabCount(k) {
  if (k === 'lf') return vals(LF).filter(r => r.status === 'found').length;
  if (k === 'mt') return vals(MT).filter(mtLive).length;
  if (k === 'cash') { const sh = shiftNow(); if (!sh) return ''; const t = sh.start.getTime(); return vals(CASH).some(r => r.at >= t) ? '✓' : '!'; }
  if (k === 'up') { const s = vals(UP).filter(r => r.sold).length; return s || ''; }
  return '';
}
function render() {
  const body = $('body'); if (!body) return;
  if (upDay !== isoDay()) listenUpsell();
  const tabs = $('tabs');
  if (tabs) tabs.innerHTML = TABS.map(([k, i, l]) => {
    const c = tabCount(k), over = k === 'mt' && vals(MT).some(mtOverdue), warn = k === 'cash' && c === '!';
    return `<button type="button" role="tab" id="ol-tab-${k}" class="ol-tab${tab === k ? ' on' : ''}" aria-selected="${tab === k}" data-tab="${k}"><span>${i}</span>${l}${c !== '' ? `<em class="${over || warn ? 'bad' : ''}">${c}</em>` : ''}</button>`;
  }).join('');
  const keepQ = document.activeElement && document.activeElement.id === 'ol-lfq' ? document.activeElement.selectionStart : null;
  // keep half-typed cash counts when a live update redraws the page
  const cashKeep = {}; body.querySelectorAll('.ol-cash input').forEach(i => { cashKeep[i.dataset.k || i.id] = i.value; });
  body.innerHTML = tab === 'lf' ? lfHtml() : tab === 'mt' ? mtHtml() : tab === 'cash' ? cashHtml() : upHtml();
  if (tab === 'cash') { body.querySelectorAll('.ol-cash input').forEach(i => { const k = i.dataset.k || i.id; if (cashKeep[k] != null && cashKeep[k] !== '') i.value = cashKeep[k]; }); cashLive(); }
  if (keepQ != null) { const q = $('lfq'); if (q) { q.focus(); try { q.setSelectionRange(keepQ, keepQ); } catch (_) {} } }
  badge();
}
function badge() {
  const n = vals(MT).filter(mtLive).length, over = vals(MT).some(mtOverdue);
  const b = document.getElementById('badge-' + PANEL); if (b) { b.textContent = n || '—'; b.classList.toggle('ol-badge-bad', over); }
  const mb = document.getElementById('mob-badge-' + PANEL); if (mb) mb.textContent = n ? String(n) : '';
}
function setTab(k) { if (!TABS.some(t => t[0] === k)) return; tab = k; try { localStorage.setItem('ol_tab', k); } catch (_) {} render(); }

function onClick(e) {
  const t = e.target.closest('[data-tab]'); if (t) return setTab(t.dataset.tab);
  const a = e.target.closest('[data-act]'); if (!a) return;
  const card = a.closest('[data-kind]'), id = card && card.dataset.id, key = card && card.dataset.key, k = a.dataset.act;
  const R = card && card.dataset.kind === 'lf' ? LF[id] : card && card.dataset.kind === 'mt' ? MT[id] : null;
  switch (k) {
    case 'photo': if (R) viewPhoto(R.photo); break;
    case 'lfNew': lfNew(); break; case 'lfReturn': lfReturn(id); break; case 'lfDispose': lfDispose(id); break;
    case 'lfUndo': lfUndo(id); break; case 'lfDelete': lfDelete(id); break;
    case 'lfF': lfF = a.dataset.k; render(); break;
    case 'mtNew': mtNew(); break; case 'mtStart': mtStep(id, 'progress', 'Work started'); break;
    case 'mtFix': mtFix(id); break; case 'mtReopen': mtStep(id, 'open', 'Reopened'); break;
    case 'mtNote': mtNote(id); break; case 'mtDelete': mtDelete(id); break; case 'mtF': mtF = a.dataset.k; render(); break;
    case 'cashSave': cashSave(); break; case 'cashExp': cashSetExpected(); break;
    case 'cashClear': document.querySelectorAll('#ol-body .ol-den input').forEach(i => { i.value = ''; }); cashLive(); break;
    case 'upF': upF = a.dataset.k; render(); break;
    case 'upItem': {
      const it = Object.assign({}, (UP[key] || {}).items);
      if (it[a.dataset.k]) delete it[a.dataset.k]; else it[a.dataset.k] = true;
      upSave(key, { items: Object.keys(it).length ? it : null, offered: true }); render(); break;
    }
    case 'goArr': if (typeof showPanel === 'function') showPanel('arrivals'); break;
  }
}
function onChange(e) {
  const a = e.target.closest('[data-act]'); if (!a) return;
  const card = a.closest('[data-kind]'), key = card && card.dataset.key;
  if (a.dataset.act === 'upOff') { upSave(key, { offered: a.checked }); if (!a.checked && (UP[key] || {}).sold) { upSave(key, { sold: false }); } render(); }
  if (a.dataset.act === 'upSold') { upSave(key, a.checked ? { sold: true, offered: true } : { sold: false }); render(); }
  if (a.dataset.act === 'upAmt') { upSave(key, { amount: Math.max(0, +a.value || 0) }); render(); }
}
function onInput(e) {
  if (e.target.id === 'ol-lfq') { lfQ = e.target.value; render(); }
  else if (e.target.closest('.ol-den')) cashLive();
}

// ───────────────────────── live data ─────────────────────────
const asObj = v => (v && typeof v === 'object') ? (Array.isArray(v) ? Object.assign({}, v) : v) : {};
let upOff = null;
function listen(path, cb) {
  let tries = 0;
  const go = () => {
    if (typeof fbListen !== 'function') return;
    if (typeof _ref !== 'undefined' && _ref) { fbListen(ROOT + '/' + path, v => { cb(v); render(); }); return; }
    if (++tries > 40) { cb(typeof lsLoad === 'function' ? lsLoad(ROOT + '/' + path) : null); render(); return; }   // offline: this device's copy
    setTimeout(go, 500);
  };
  go();
}
function listenUpsell() {
  upDay = isoDay(); UP = {};
  const day = upDay, path = 'upsell/' + day;
  if (upOff) { try { upOff(); } catch (_) {} upOff = null; }
  // a newer day replaces the listener's target: answers for an old day are ignored
  listen(path, v => { if (day === upDay) UP = asObj(v); });
}
function startSync() {
  listen('lf', v => { LF = asObj(v); });
  listen('mt', v => { MT = asObj(v); });
  listen('cash', v => { CASH = asObj(v); });
  listen('cfg/float', v => { CFG = asObj(v); });
  listenUpsell();
}

// Ops Brain: high-priority tickets open for more than a day, and old Lost & Found items
(window.BL_THINKERS = window.BL_THINKERS || []).push(add => {
  const over = vals(MT).filter(mtOverdue);
  if (over.length) add({ id: 'olMtOver:' + over.map(r => r.id).join(','), type: 'opsMaint', icon: '🔧', tone: 'bad',
    text: `${over.length} high-priority maintenance ticket${over.length === 1 ? ' is' : 's are'} open for more than 24 hours: ${over.slice(0, 3).map(r => r.area).join(', ')}${over.length > 3 ? '…' : ''}.`,
    why: 'A guest is likely affected. Chase engineering and update the ticket.',
    acts: [['Open tickets', () => { if (typeof showPanel === 'function') showPanel(PANEL); mtF = 'open'; setTab('mt'); }]] });
  const old = vals(LF).filter(lfOld);
  if (old.length >= 3) add({ id: 'olLfOld:' + old.length, type: 'opsLf', icon: '🧳', tone: 'idle',
    text: `${old.length} Lost & Found items are older than 90 days.`, why: 'Consider disposing of them, following hotel policy.',
    acts: [['Show me', () => { if (typeof showPanel === 'function') showPanel(PANEL); lfF = 'found'; setTab('lf'); }]] });
});

// ───────────────────────── styles ─────────────────────────
const CSS = `
#panel-ops-logs{--ol-blue:var(--blue,#2563eb);--ol-amber:var(--amber,#d97706)}
#panel-ops-logs .ol-wrap{max-width:1100px}
.ol-tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:0 0 14px;padding:4px;background:var(--bg2);border:1px solid var(--border);border-radius:calc(var(--r,10px) + 4px)}
.ol-tabs::-webkit-scrollbar{display:none}
.ol-tab{flex:1 0 auto;display:flex;align-items:center;justify-content:center;gap:6px;padding:9px 12px;border:0;border-radius:var(--r,10px);background:transparent;color:var(--text2);font:inherit;font-size:.86rem;font-weight:600;cursor:pointer;white-space:nowrap}
.ol-tab:hover{color:var(--text)}
.ol-tab.on{background:var(--card);color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.ol-tab em{font-style:normal;font-family:var(--mono);font-size:.7rem;min-width:18px;padding:1px 6px;border-radius:9px;background:var(--card2);color:var(--text2);border:1px solid var(--border)}
.ol-tab em.bad{background:var(--red);border-color:var(--red);color:#fff}
.ol-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
.ol-q{flex:1 1 220px;min-width:0;padding:9px 12px;border:1px solid var(--border2);border-radius:var(--r,10px);background:var(--card);color:var(--text);font:inherit}
.ol-stats{display:flex;gap:12px;font-size:.82rem;color:var(--text2);margin-left:auto}
.ol-stats b{color:var(--text);font-family:var(--mono)}.ol-stats .bad,.ol-stats .bad b{color:var(--red)}
.ol-fchips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.ol-fchip{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border:1px solid var(--border2);border-radius:999px;background:var(--card);color:var(--text2);font:inherit;font-size:.8rem;cursor:pointer}
.ol-fchip.on{border-color:var(--gold);color:var(--text);background:var(--card2);font-weight:600}
.ol-fchip em{font-style:normal;font-family:var(--mono);font-size:.72rem;color:var(--text3)}
.ol-hint{padding:9px 12px;border-radius:var(--r,10px);background:var(--bg2);border:1px solid var(--border);font-size:.84rem;color:var(--text2);margin-bottom:12px}
.ol-hint.warn{border-color:var(--ol-amber);color:var(--text)}.ol-hint.bad{border-color:var(--red);color:var(--text);background:var(--red-bg,rgba(220,38,38,.08))}
.ol-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:10px}
.ol-card{display:flex;gap:12px;padding:12px 14px;background:var(--card);border:1px solid var(--border);border-radius:calc(var(--r,10px) + 2px);min-width:0}
.ol-card.old{border-left:3px solid var(--ol-amber)}
.ol-card.mt{border-left:3px solid var(--border2)}
.ol-card.over{border-color:var(--red);border-left:3px solid var(--red);background:linear-gradient(90deg,var(--red-bg,rgba(220,38,38,.07)),var(--card) 40%)}
.ol-card.done{opacity:.78}
.ol-card.sold{border-left:3px solid var(--green)}
.ol-main{flex:1;min-width:0}
.ol-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px}
.ol-title{font-size:.95rem;color:var(--text);margin-right:2px;overflow-wrap:anywhere}
.ol-text{font-size:.86rem;color:var(--text);margin:2px 0 4px;overflow-wrap:anywhere;white-space:pre-wrap}
.ol-chips{display:flex;gap:5px;flex-wrap:wrap;margin:4px 0}
.ol-chip{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:.72rem;font-weight:600;background:var(--bg2);color:var(--text2);border:1px solid var(--border);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ol-chip.green{color:var(--green);border-color:var(--green-border,var(--green))}
.ol-chip.red{color:var(--red);border-color:var(--red-border,var(--red))}
.ol-chip.amber{color:var(--ol-amber);border-color:var(--amber-border,var(--ol-amber))}
.ol-chip.blue{color:var(--ol-blue);border-color:var(--ol-blue)}
.ol-chip.gold{color:var(--gold);border-color:var(--gold)}
.ol-chip.muted{opacity:.75}
.ol-age{margin-left:auto;font-family:var(--mono);font-size:.74rem;color:var(--text2)}
.ol-age.bad{color:var(--red);font-weight:700}
.ol-meta{font-size:.76rem;color:var(--text3);margin-top:3px;overflow-wrap:anywhere}
.ol-meta.ok,.ol-meta .ok{color:var(--green)}.ol-meta.warn{color:var(--ol-amber)}
.ol-meta b{color:var(--text)}
.ol-acts{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:9px}
.ol-acts .btn.sm,.ol-card .btn.sm{padding:5px 10px;font-size:.78rem}
.ol-link{background:none;border:0;color:var(--text3);text-decoration:underline;cursor:pointer;font:inherit;font-size:.78rem;padding:4px}
.ol-acts .ol-link{margin-left:auto}
.ol-thumb{flex:0 0 64px;width:64px;height:64px;padding:0;border:1px solid var(--border);border-radius:var(--r,10px);overflow:hidden;cursor:zoom-in;background:var(--bg2)}
.ol-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.ol-hist{margin-top:6px;font-size:.78rem;color:var(--text2)}
.ol-hist summary{cursor:pointer;color:var(--text3)}
.ol-hist div{padding:3px 0 3px 10px;border-left:2px solid var(--border);margin:3px 0 0 4px;overflow-wrap:anywhere}
.ol-hist small{color:var(--text3);font-family:var(--mono)}
.ol-empty{padding:28px 16px;text-align:center;color:var(--text2);background:var(--card);border:1px dashed var(--border2);border-radius:calc(var(--r,10px) + 2px);font-size:.9rem}
.ol-empty.sm{padding:14px;border:0;background:none}
.ol-empty.big{display:flex;flex-direction:column;gap:6px;align-items:center;line-height:1.5;font-size:.9rem}
.ol-empty.big i{font-style:normal;font-size:2rem}
.ol-empty.big b{font-size:1.05rem;color:var(--text)}
.ol-small{font-size:.76rem;color:var(--text3)}
.ol-cash{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:12px;align-items:start}
.ol-cash .ol-card{display:block}
.ol-exp{font-size:.84rem;color:var(--text2);margin:2px 0 10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.ol-exp b{color:var(--text);font-family:var(--mono)}
.ol-dens{display:grid;grid-template-columns:1fr 1fr;gap:6px 14px}
.ol-den{display:grid;grid-template-columns:72px 12px minmax(0,1fr) 78px;align-items:center;gap:6px;font-size:.84rem}
.ol-den span:first-child{font-family:var(--mono);color:var(--text);font-weight:600;white-space:nowrap}
.ol-x-sign{color:var(--text3);text-align:center}
.ol-den input{width:100%;min-width:0;height:34px;box-sizing:border-box;padding:4px 8px;border:1px solid var(--border2);border-radius:8px;background:var(--bg2);color:var(--text);font:inherit;font-family:var(--mono);text-align:right}
.ol-den output{font-family:var(--mono);font-size:.78rem;color:var(--text3);text-align:right}
.ol-totrow{display:flex;justify-content:space-between;align-items:baseline;margin-top:12px;padding-top:10px;border-top:1px solid var(--border)}
.ol-totrow b{font-family:var(--mono);font-size:1.3rem;color:var(--text)}
.ol-diff{margin:8px 0 4px;padding:8px 10px;border-radius:8px;font-size:.86rem;font-weight:600;background:var(--bg2);color:var(--text2)}
.ol-diff.ok{color:var(--green);background:var(--green-bg,rgba(22,163,74,.1))}
.ol-diff.bad{color:var(--red);background:var(--red-bg,rgba(220,38,38,.1))}
.ol-histc{max-height:720px;overflow:auto}
.ol-hrow{padding:8px 0;border-bottom:1px solid var(--border)}.ol-hrow:last-child{border-bottom:0}
.ol-hrow b{font-family:var(--mono)}
.ol-form{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
.ol-f{display:flex;flex-direction:column;gap:4px;min-width:0}
.ol-f.wide,.ol-form .wide{grid-column:1/-1}
.ol-f>span{font-size:.74rem;color:var(--text2);font-weight:600}
.ol-f input,.ol-f select,.ol-f textarea{width:100%;box-sizing:border-box;min-width:0;padding:9px 10px;border:1px solid var(--border2);border-radius:8px;background:var(--bg2);color:var(--text);font:inherit;font-size:.9rem}
.ol-f textarea{resize:vertical}
.ol-check{display:inline-flex;gap:7px;align-items:center;font-size:.86rem;color:var(--text);cursor:pointer}
.ol-check input{width:18px;height:18px;accent-color:var(--green)}
.ol-ph{display:flex;align-items:center;justify-content:center;padding:10px;border:1px dashed var(--border2);border-radius:8px;cursor:pointer;color:var(--text2);font-size:.86rem;background:var(--bg2)}
.ol-ph input{position:absolute;width:1px;height:1px;opacity:0}
.ol-ph-prev{display:flex;gap:10px;align-items:center;font-size:.78rem;color:var(--text3)}
.ol-ph-prev img{width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid var(--border)}
.ol-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:12px}
.ol-kpis>div{padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:calc(var(--r,10px) + 2px);min-width:0}
.ol-kpis small{display:block;font-size:.72rem;color:var(--text3);text-transform:uppercase;letter-spacing:.04em}
.ol-kpis b{font-family:var(--mono);font-size:1.25rem;color:var(--text);white-space:nowrap}
.ol-kpis .gold{border-color:var(--gold)}.ol-kpis .gold b{color:var(--gold)}
.ol-room{font-family:var(--mono);font-weight:700;font-size:.82rem;padding:2px 7px;border-radius:6px;background:var(--bg2);border:1px solid var(--border2);color:var(--text)}
.ol-offers{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
.ol-offer{display:flex;flex-direction:column;align-items:flex-start;padding:5px 9px;border:1px solid var(--border);border-radius:8px;background:var(--bg2);color:var(--text3);font:inherit;font-size:.78rem;cursor:pointer;text-align:left}
.ol-offer small{font-size:.66rem;color:var(--text3)}
.ol-offer.sug{border-color:var(--gold);color:var(--text);border-style:dashed}
.ol-offer.on{border-style:solid;border-color:var(--green);background:var(--green-bg,rgba(22,163,74,.1));color:var(--text)}
.ol-uprow{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.ol-amt{display:inline-flex;gap:6px;align-items:center;font-size:.84rem;color:var(--text2)}
.ol-amt[hidden]{display:none}
.ol-amt input{width:90px;padding:6px 8px;border:1px solid var(--border2);border-radius:8px;background:var(--bg2);color:var(--text);font:inherit;font-family:var(--mono)}
.ol-uprow .ol-small{margin-left:auto}
.ol-modal{position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px}
.ol-sheet{width:100%;max-width:520px;max-height:calc(100vh - 32px);display:flex;flex-direction:column;background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,.35)}
.ol-sheet-hd{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--border)}
.ol-x{background:none;border:0;color:var(--text2);font-size:1.1rem;cursor:pointer;padding:4px 8px}
.ol-sheet-bd{padding:4px 16px 14px;overflow:auto}
.ol-sheet-ft{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--border)}
.ol-viewer{position:fixed;inset:0;z-index:9100;background:rgba(0,0,0,.88);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:16px;cursor:zoom-out}
.ol-viewer img{max-width:100%;max-height:calc(100vh - 70px);border-radius:8px}
.ol-viewer span{color:#ddd;font-size:.8rem}
.nav-badge.ol-badge-bad{background:var(--red)!important;color:#fff!important}
@media (max-width:860px){.ol-cash{grid-template-columns:1fr}.ol-histc{max-height:none}}
@media (max-width:600px){
  .ol-list{grid-template-columns:1fr}
  .ol-tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px}
  .ol-tab{padding:8px 6px;font-size:.8rem}
  .ol-dens{grid-template-columns:1fr;gap:5px}
  .ol-den{grid-template-columns:70px minmax(0,1fr) 76px}
  .ol-x-sign{display:none}
  .ol-den input{height:36px;padding:4px 8px}
  .ol-form{grid-template-columns:1fr}
  .ol-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ol-stats{margin-left:0;width:100%}
  .ol-card{padding:11px 12px;gap:10px}
  .ol-thumb{flex-basis:52px;width:52px;height:52px}
  .ol-modal{align-items:flex-end;padding:0}
  .ol-sheet{max-width:none;border-radius:16px 16px 0 0;max-height:92vh}
}`;

const PANEL_HTML = `<div class="ol-wrap">
  <div class="page-hd"><div class="page-hd-left"><h1>🗂️ Front Office Log</h1><p>Lost & Found, maintenance tickets, float counts and today's upsell list, shared live with the team.</p></div></div>
  <div class="ol-tabs" id="ol-tabs" role="tablist"></div>
  <div id="ol-body"></div>
</div>`;

function mount() {
  if (document.getElementById('panel-' + PANEL)) return;
  const main = document.querySelector('main.main') || document.querySelector('main');
  const nav = document.querySelector('nav.sidenav') || document.querySelector('nav');
  if (!main || !nav) { console.warn('[ops-logs] app layout not found; panel not added'); return; }

  const st = document.createElement('style'); st.id = 'ol-style'; st.textContent = CSS; document.head.appendChild(st);
  const panel = document.createElement('div'); panel.className = 'panel'; panel.id = 'panel-' + PANEL; panel.innerHTML = PANEL_HTML;
  main.appendChild(panel);
  panel.addEventListener('click', onClick); panel.addEventListener('change', onChange); panel.addEventListener('input', onInput);

  const item = document.createElement('div');
  item.className = 'nav-item'; item.id = 'nav-' + PANEL; item.dataset.panel = PANEL;
  item.setAttribute('onclick', "showPanel('" + PANEL + "')");
  item.innerHTML = '<div class="nav-icon">🗂️</div>Front Office Log<span class="nav-badge" id="badge-' + PANEL + '">—</span>';
  const anchor = document.getElementById('nav-shifts');
  if (anchor && anchor.parentNode === nav) anchor.after(item); else nav.appendChild(item);

  const grid = document.querySelector('.mob-more-grid');
  if (grid) {
    const b = document.createElement('button');
    b.className = 'mob-more-item'; b.dataset.panel = PANEL; b.type = 'button';
    b.setAttribute('onclick', "showPanel('" + PANEL + "');(typeof closeMobMore==='function'?closeMobMore:typeof toggleMobMore==='function'?toggleMobMore:function(){})()");
    b.innerHTML = '<span class="mob-item-icon">🗂️</span><span class="mob-more-badge" id="mob-badge-' + PANEL + '"></span>Front Office Log';
    const after = grid.querySelector('.mob-more-item[data-panel="shifts"]');
    if (after) after.after(b); else grid.appendChild(b);
  }

  if (typeof hoApplyIcons === 'function') hoApplyIcons();   // the same line icon as the other menu items

  // every role that sees Shift Tasks sees this page
  try {
    if (typeof ROLES !== 'undefined') Object.keys(ROLES).forEach(r => {
      const p = ROLES[r] && ROLES[r].panels; if (p && p.includes('shifts') && !p.includes(PANEL)) p.push(PANEL);
    });
    if (typeof currentProfile !== 'undefined' && currentProfile && typeof applyRole === 'function') applyRole(currentProfile.role);
  } catch (e) { console.warn('[ops-logs] role setup:', e); }

  // redraw when the page is opened (arrivals may have been loaded since), and every minute for ages
  let wasOn = false;
  new MutationObserver(() => { const on = panel.classList.contains('active'); if (on && !wasOn) render(); wasOn = on; }).observe(panel, { attributes: true, attributeFilter: ['class'] });
  setInterval(() => { if (panel.classList.contains('active') && !document.getElementById('ol-modal') && !(document.activeElement && panel.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) render(); else badge(); }, 60000);

  render(); startSync();
}

window.olTab = k => { if (typeof showPanel === 'function') showPanel(PANEL); setTab(k); };
window.olShrinkPhoto = shrinkPhoto;   // for tests
// read-only for the room card (room-card.js): lost & found, maintenance tickets, today's upsell answers
window.hoOpsLogs = { lf: () => LF, mt: () => MT, upsell: () => UP, upKey: gKey };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();

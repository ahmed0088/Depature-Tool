// ═══════════════════════════════════════════════════════════
//  history.js — History page
//  Who did what and when, for the whole team, in plain words.
//  Reads the activity log every page already writes (logActivity in
//  auth.js → hotels/<id>/activityLog). Search by name, room, page or
//  anything in the detail; filter by person, page and period.
// ═══════════════════════════════════════════════════════════

// action → [page, icon, words]
const HIST_ACTIONS = {
  login: ['Sign-in', '🔓', 'signed in'], logout: ['Sign-in', '🔒', 'signed out'],
  create_user: ['Team', '➕', 'added a user'], edit_user: ['Team', '✏️', 'edited a user'], disable_user: ['Team', '🔒', 'disabled a user'],
  enable_user: ['Team', '✓', 'enabled a user'], delete_user: ['Team', '🗑️', 'deleted a user'], disconnect_user: ['Team', '⏏', 'signed a user out'],
  departure_out: ['Departures', '🚪', 'checked out'], departure_na: ['Departures', '—', 'marked N/A'], departure_late: ['Departures', '🕐', 'marked late checkout'],
  departure_extended: ['Departures', '📅', 'marked extended'], departure_due: ['Departures', '↩', 'set back to due'],
  arrivals_loaded: ['Arrivals', '📥', 'loaded arrivals'], arrivals_cleared: ['Arrivals', '🗑️', 'cleared arrivals'],
  arrivals_proc_run: ['Arrivals processor', '⚙️', 'processed arrivals'], arrivals_proc_export: ['Arrivals processor', '📤', 'exported Excel'],
  shift_task_done: ['Shift tasks', '✅', 'did a task'], shift_task_undone: ['Shift tasks', '↩', 'un-ticked a task'],
  shift_task_added: ['Shift tasks', '➕', 'added a task'], shift_task_deleted: ['Shift tasks', '🗑️', 'deleted a task'], shift_reset: ['Shift tasks', '↺', 'reset the shift'],
  checklist_done: ['Night checklist', '✅', 'did a step'], checklist_undone: ['Night checklist', '↩', 'un-ticked a step'],
  checklist_skipped: ['Night checklist', '⏭', 'skipped a step'], checklist_unskipped: ['Night checklist', '↩', 'un-skipped a step'],
  dtcm_analyzed: ['DTCM Recon', '🏦', 'ran DTCM Recon'], dtcm_cleared: ['DTCM Recon', '🗑️', 'cleared DTCM Recon'],
  dtcm_item_done: ['DTCM Recon', '✅', 'fixed an item'], dtcm_item_undone: ['DTCM Recon', '↩', 'un-ticked an item'],
  dtcm_month_end_report: ['DTCM Recon', '🗂', 'printed the month-end report'], td_settings: ['DTCM Recon', '⚙️', 'changed hotel TD settings'],
  pkg_audit_run: ['Package Audit', '🎁', 'ran Package Audit'], pkg_pin: ['Package Audit', '📌', 'pinned a package'],
  pkg_commission_report: ['Package Audit', '💰', 'printed the commission report'],
  noshow_loaded: ['No-Show', '📥', 'loaded NA40'], noshow_copied: ['No-Show', '📋', 'copied no-shows'], noshow_cleared: ['No-Show', '🗑️', 'cleared no-shows'],
  handover_generated: ['Handover', '📋', 'made a handover note'],
  guestmem_unlock: ['Guest memory', '🔓', 'opened guest memory'], guestmem_password_change: ['Guest memory', '🔑', 'changed the guest memory password'],
  file: ['Files', '📥', 'dropped a file'],
};

let histAll = [];
let histLoaded = false;

function _histInfo(a) {
  return HIST_ACTIONS[a] || ['Other', '•', String(a || '').replace(/_/g, ' ')];
}

async function histLoad() {
  const box = document.getElementById('histList');
  if (box && !histLoaded) box.innerHTML = '<div class="hist-empty">Loading…</div>';
  try {
    const snap = await firebase.database().ref(`hotels/${HOTEL_ID}/activityLog`).limitToLast(2000).once('value');
    histAll = Object.values(snap.val() || {}).filter(e => e && e.ts).reverse().sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
    histLoaded = true;
  } catch (e) {
    if (box) box.innerHTML = '<div class="hist-empty">Could not read the history — check the connection.</div>';
    return;
  }
  // fill the person and page pickers from what is in the log
  const fill = (id, vals, first) => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">${first}</option>` + vals.map(v => `<option>${escapeHtml(v)}</option>`).join('');
    if (vals.includes(cur)) el.value = cur;
  };
  fill('histWho', [...new Set(histAll.map(e => e.name).filter(Boolean))].sort(), 'Everyone');
  fill('histPage', [...new Set(histAll.map(e => _histInfo(e.action)[0]))].sort(), 'All pages');
  histRender();
}

function histFiltered() {
  const q = (document.getElementById('histSearch')?.value || '').trim().toLowerCase();
  const who = document.getElementById('histWho')?.value || '';
  const page = document.getElementById('histPage')?.value || '';
  const days = +(document.getElementById('histWhen')?.value || 0);
  const since = days ? Date.now() - days * 864e5 : 0;
  const hideLogin = document.getElementById('histNoLogin')?.checked;
  return histAll.filter(e => {
    const [pg, , words] = _histInfo(e.action);
    if (who && e.name !== who) return false;
    if (page && pg !== page) return false;
    if (since && new Date(e.ts).getTime() < since) return false;
    if (hideLogin && pg === 'Sign-in') return false;
    if (q && !`${e.name} ${pg} ${words} ${e.action} ${e.detail || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function histRender() {
  const box = document.getElementById('histList');
  if (!box) return;
  const rows = histFiltered();
  const cnt = document.getElementById('histCount');
  if (cnt) cnt.textContent = `${rows.length} of ${histAll.length}`;
  if (!rows.length) { box.innerHTML = `<div class="hist-empty">${histAll.length ? 'Nothing matches.' : 'Nothing recorded yet.'}</div>`; return; }
  let lastDay = '';
  box.innerHTML = rows.slice(0, 500).map(e => {
    const d = new Date(e.ts);
    const day = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    const [pg, ico, words] = _histInfo(e.action);
    const head = day !== lastDay ? `<div class="hist-day">${escapeHtml(day)}</div>` : '';
    lastDay = day;
    return `${head}<div class="hist-row">
      <span class="hist-time">${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
      <span class="hist-ico">${ico}</span>
      <div class="hist-body"><b>${escapeHtml(e.name || '?')}</b> ${escapeHtml(words)}${e.detail ? `<div class="hist-detail">${escapeHtml(e.detail)}</div>` : ''}</div>
      <span class="hist-page">${escapeHtml(pg)}</span>
    </div>`;
  }).join('') + (rows.length > 500 ? '<div class="hist-empty">Showing the newest 500 — search or filter to narrow it down.</div>' : '');
}

function histCopy(btn) {
  const rows = histFiltered();
  const tsv = ['Date\tTime\tWho\tPage\tWhat\tDetail'].concat(rows.map(e => {
    const d = new Date(e.ts); const [pg, , words] = _histInfo(e.action);
    return [d.toLocaleDateString('en-GB'), d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), e.name || '', pg, words, (e.detail || '').replace(/\s+/g, ' ')].join('\t');
  })).join('\n');
  copyToClipboard(tsv, btn, '📋 Copy for Excel');
}

// ═══════════════════════════════════════════════════════════
//  global-search.js  —  Global search / command palette
//  Ctrl+K (or the 🔍 topbar icon) jumps straight to a room,
//  guest, checklist step, or shift task across every panel.
// ═══════════════════════════════════════════════════════════

// Panel → search input id, used to auto-fill and re-trigger
// that panel's own filter once we land on it.
const GS_SEARCH_INPUT = {
  departures: 'depSearch',
  arrivals:   'arrSearch',
  purpose:    'purposeSearch',
  xref:       'xrefSearch',
  tourism:    'ttSearch',
  noshow:     'nsSearch',
  standards:  'stdSearchBox',
};

const GS_PANEL_LABEL = {
  option:     'Option',
  departures: 'Departures',
  arrivals:   'Arrivals',
  purpose:    'Purpose of Stay',
  xref:       'Arr vs Dep',
  tourism:    'Tourism Tax',
  'inhouse-tally': 'Inhouse Tally',
  noshow:     'No-Show',
  dtcm:       'DTCM Recon',
  checklist:  'Night Checklist',
  shifts:     'Shift Tasks',
  standards:  'Accor Standards',
  'roster-build': 'Roster builder',
  roster:     'Roster',
  wakeups:    'Wake-up Calls',
  rates:      'Rate Shop',
  page:       'Page',
};

let _gsSelIdx = 0;
let _gsResults = [];

function gsOpen() {
  const modal = document.getElementById('gsModal');
  if (!modal) return;
  modal.classList.add('open');
  const input = document.getElementById('gsInput');
  if (input) { input.value = ''; setTimeout(() => input.focus(), 30); }
  gsSearch('');
}

function gsClose() {
  document.getElementById('gsModal')?.classList.remove('open');
}

// ── Build the searchable index on demand (data changes constantly,
//    so we re-scan the live arrays every keystroke rather than caching) ──
function gsBuildIndex(q) {
  const out = [];
  if (!q) return out;

  const add = (panel, room, name, extra, icon, jumpTerm) => {
    out.push({ panel, room: room || '', name: name || '', extra: extra || '', icon, jumpTerm: jumpTerm ?? (room || name) });
  };
  const hit = (...vals) => vals.some(v => (v || '').toString().toLowerCase().includes(q));

  (typeof depRooms !== 'undefined' ? depRooms : []).forEach(r => {
    if (hit(r.roomStr, r.name)) add('departures', r.roomStr, r.name, r.status, '🚪', r.roomStr);
  });
  (typeof arrGuests !== 'undefined' ? arrGuests : []).forEach(g => {
    if (hit(g.room, g.name)) add('arrivals', g.room, g.name, g.purpose, '🛎️', g.room || g.name);
  });
  (typeof purposeGuests !== 'undefined' ? purposeGuests : []).forEach(g => {
    if (hit(g.room, g.name)) add('purpose', g.room, g.name, g.nat, '🧾', g.room || g.name);
  });
  (typeof ttGuests !== 'undefined' ? ttGuests : []).forEach(g => {
    if (hit(g.room, g.name)) add('tourism', g.room, g.name, 'TD portal fix', '🏛️', g.room || g.name);
  });
  (typeof dtcRecon !== 'undefined' && dtcRecon ? (dtcRecon.actions || []) : []).forEach(a => {
    if (hit(a.room, a.why)) add('dtcm', a.room, a.action + ' ' + (a.date || ''), a.why, '🏦', '');
  });
  (typeof nsGuests !== 'undefined' ? nsGuests : []).forEach(g => {
    if (hit(g.nameRaw, g.confNo, g.company)) add('noshow', '', g.nameRaw, g.company, '🚫', g.nameRaw || g.confNo);
  });
  (typeof CL_STEPS !== 'undefined' ? CL_STEPS : []).forEach(s => {
    if (hit(s.name, s.hint)) add('checklist', '', s.name, 'Night checklist step', '✅', '');
  });
  if (typeof SHIFTS !== 'undefined') {
    Object.entries(SHIFTS).forEach(([key, shift]) => {
      (shift.tasks || []).forEach(t => {
        if (hit(t.name, t.hint)) add('shifts', '', t.name, shift.label, '🕐', '');
      });
    });
  }

  (typeof STD_ITEMS !== 'undefined' ? STD_ITEMS : []).forEach(it => {
    if (hit(it.title, it.tags)) {
      const c = (typeof STD_CATS !== 'undefined' ? STD_CATS : []).find(x => x.id === it.cat);
      add('standards', '', it.title, c ? c.name : 'Accor Standards', '📘', it.title);
    }
  });

  // team members, meetings, wake-up calls, our hotels, and every page by its name
  const edit = typeof roCanEdit === 'function' && roCanEdit();
  Object.entries(typeof roStaff !== 'undefined' ? roStaff : {}).forEach(([k, st]) => {
    if (!st || !hit(st.name, st.group)) return;
    out.push({ panel: edit ? 'roster-build' : 'roster', room: '', name: st.name, extra: (st.group || '') + (edit ? ' · open their card' : ''), icon: '🧑‍💼', act: () => { if (edit && typeof rtPerson === 'function') { showPanel('roster-build'); setTimeout(() => rtPerson(k), 80); } else showPanel('roster'); } });
  });
  if (edit && typeof evList === 'function') evList().filter(e => (e.until || e.date) >= roToday() && hit(e.title, e.where, evWho(e))).forEach(e => {
    out.push({ panel: 'roster-build', room: '', name: e.title, extra: `${roDayLbl(e.date)} · ${evTime(e)} · ${evWho(e)}`, icon: '📅', act: () => { showPanel('roster-build'); setTimeout(() => evEdit(e.id), 80); } });
  });
  Object.values(typeof bxWakes !== 'undefined' ? bxWakes : {}).filter(w => w && !w.done && hit(w.room, w.name)).forEach(w => {
    out.push({ panel: 'wakeups', room: w.room, name: w.name || 'Wake-up call', extra: w.time || '', icon: '⏰' });
  });
  if (typeof rkHotels === 'function' && (typeof hoPanelAllowed !== 'function' || hoPanelAllowed('rates'))) rkHotels().filter(h => hit(h.name)).forEach(h => {
    out.push({ panel: 'rates', room: '', name: h.name, extra: 'rates vs the hotels around', icon: '💲', act: () => { rkHotel = h.id; showPanel('rates'); } });
  });
  if (typeof gsFeatureHits === 'function' && q.length >= 2) out.push(...gsFeatureHits(q));
  document.querySelectorAll('.nav-item[data-panel]').forEach(n => {
    const label = n.textContent.replace(/\s+/g, ' ').replace(/\s[\d—–]+\s*$/, '').trim();
    if (hit(label) && (typeof hoPanelAllowed !== 'function' || hoPanelAllowed(n.dataset.panel))) out.push({ panel: 'page', room: '', name: label, extra: 'open the page', icon: '➡️', act: () => showPanel(n.dataset.panel) });
  });

  // a word that starts with what was typed beats a match inside a word ("Ali" before "invalid"); people and pages first
  const starts = r => new RegExp('(^|[^a-z0-9])' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(`${r.room} ${r.name}`);
  const rank = r => (starts(r) ? 0 : 10) + (r.act ? 0 : 1);
  return out.map((r, i) => [r, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(x => x[0]).slice(0, 30);
}

function gsSearch(val) {
  const q = (val || '').trim().toLowerCase();
  _gsResults = gsBuildIndex(q);
  _gsSelIdx = 0;
  gsRenderResults(q);
}

function gsRenderResults(q) {
  const box = document.getElementById('gsResults');
  if (!box) return;

  if (!q) {
    box.innerHTML = `<div class="gs-empty">Type a room, guest, staff member, page, task, or an option like "fixed day off", "12 hour", "freeze"…</div>`;
    return;
  }
  if (!_gsResults.length) {
    box.innerHTML = `<div class="gs-empty">No matches for "${escapeHtml(q)}"</div>`;
    return;
  }

  box.innerHTML = _gsResults.map((r, i) => `
    <div class="gs-result${i === _gsSelIdx ? ' sel' : ''}" onclick="gsJump(${i})" onmouseenter="gsHover(${i}, this)">
      <span class="gs-result-icon">${r.icon}</span>
      <div class="gs-result-body">
        <span class="gs-result-name">${r.room ? `<span class="gs-result-room">${escapeHtml(r.room)}</span> ` : ''}${escapeHtml(r.name || '—')}</span>
        <span class="gs-result-extra">${escapeHtml(r.extra || '')}</span>
      </div>
      <span class="gs-result-panel">${GS_PANEL_LABEL[r.panel] || r.panel}</span>
    </div>`).join('');
}

/** hover only moves the highlight: redrawing the list here replaced the row under the mouse, so the click was lost */
function gsHover(i, el) {
  _gsSelIdx = i;
  el.parentElement?.querySelectorAll('.gs-result.sel').forEach(x => x.classList.remove('sel'));
  el.classList.add('sel');
}
function gsKeyNav(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); _gsSelIdx = Math.min(_gsSelIdx + 1, _gsResults.length - 1); gsRenderResults(document.getElementById('gsInput').value.toLowerCase()); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); _gsSelIdx = Math.max(_gsSelIdx - 1, 0); gsRenderResults(document.getElementById('gsInput').value.toLowerCase()); }
  else if (e.key === 'Enter') { e.preventDefault(); if (_gsResults.length) gsJump(_gsSelIdx); }
  else if (e.key === 'Escape') { gsClose(); }
}

function gsJump(i) {
  const r = _gsResults[i];
  if (!r) return;
  gsClose();
  if (r.act) { r.act(); return; }
  showPanel(r.panel);

  const inputId = GS_SEARCH_INPUT[r.panel];
  if (inputId && r.jumpTerm) {
    setTimeout(() => {
      const el = document.getElementById(inputId);
      if (!el) return;
      el.value = r.jumpTerm;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.focus();
    }, 60);
  }

  if (r.panel === 'shifts') {
    // Switch to whichever shift tab contains the matched task
    for (const [key, shift] of Object.entries(SHIFTS)) {
      if ((shift.tasks || []).some(t => t.name === r.name)) {
        switchShift(key, document.querySelector(`.shift-tab[onclick*="'${key}'"]`));
        break;
      }
    }
  }
}

// ── Options and features: find a setting or a tool by what it does ─────
// Typing "fixed day off", "12 hour" or "freeze" finds the option and takes you to it: the page opens,
// the right section unfolds, and the option is scrolled to and lit up for a moment.
function gsFlash(el) {
  if (!el) return;
  for (let d = el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) if (!d.open) d.open = true;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('gs-flash'); void el.offsetWidth; el.classList.add('gs-flash');
  setTimeout(() => el.classList.remove('gs-flash'), 2400);
}
/** the first heading, label or button on a page whose text contains t */
function gsFindText(root, t) {
  t = String(t).toLowerCase();
  const els = (root || document).querySelectorAll('.rr-sec, .rr-hd, summary, h1, h2, h3, .rb-sub, .rr-l b, .hs-row b, button, label, .card-title, .page-hd p');
  return [...els].find(e => e.offsetParent !== null && e.textContent.toLowerCase().includes(t)) || [...els].find(e => e.textContent.toLowerCase().includes(t)) || null;
}
/** open a page (and a builder section), then light up what has this text, or this selector */
function gsGo(panel, opts) {
  opts = opts || {};
  showPanel(panel);
  if (opts.run) setTimeout(() => { try { opts.run(); } catch (_) {} }, 200);
  // wait for the page (and a folded section) to be drawn, then light the option up: a big page takes a moment
  let n = 0;
  const tick = () => {
    const root = document.getElementById('panel-' + panel) || document;
    if (opts.sec) { const d = root.querySelector(`details[data-sec="${opts.sec}"]`); if (d && !d.open) d.open = true; }
    const el = (opts.sel && root.querySelector(opts.sel)) || (opts.text && gsFindText(root, opts.text)) || (!opts.sel && !opts.text && opts.sec && root.querySelector(`details[data-sec="${opts.sec}"] > summary`));
    if (el) { setTimeout(() => gsFlash(el), 120); return; }
    if (++n < 34) setTimeout(tick, 150);
  };
  setTimeout(tick, 150);
}
const GS_FEATURES = [
  // roster builder
  ['📌 Fixed days off', 'fixed static day off same day every week saturday sat friday managers', 'Roster builder → Rules', () => gsGo('roster-build', { sec: 'rules', text: 'Fixed days off' })],
  ['🚫 Day-off freeze', 'freeze no days off busy dates exclude between two dates', 'Roster builder → Rules', () => gsGo('roster-build', { sec: 'rules', text: 'Day-off freeze' })],
  ['✂️ HR cut-off (2 before the 15th, 2 after)', 'cut off cutoff 15th half month hr days off before after', 'Roster builder → Rules', () => gsGo('roster-build', { sec: 'rules', text: 'HR cut-off' })],
  ['✍️ Your own rules', 'own rules never together always with trainee custom rule', 'Roster builder → Rules', () => gsGo('roster-build', { sec: 'rules', text: 'Your own rules' })],
  ['⚖️ How much each rule counts', 'rule levels important very important must nice moving people own hotel same hours steady night morning', 'Roster builder → Rules', () => gsGo('roster-build', { sec: 'rules', text: 'Very important' })],
  ['😴 Rest & hours', 'rest minimum hours 11 hours days in a row max hours', 'Roster builder → Rules', () => gsGo('roster-build', { sec: 'rules', text: 'Rest & hours' })],
  ['🛎 Desk & cover rules', 'desk cover alone company team leader nights lend', 'Roster builder → Rules', () => gsGo('roster-build', { sec: 'rules', text: 'Desk & cover' })],
  ['🏖 PH days', 'ph public holiday balance owed give ph', 'Roster builder → Rules', () => gsGo('roster-build', { sec: 'rules', text: 'PH days' })],
  ['🏨 Hotels & managers', 'hotels managers lend move borrow other hotel', 'Roster builder → Rules', () => gsGo('roster-build', { sec: 'rules', text: 'Hotels & managers' })],
  ['👥 Cover needed (shift hours)', 'cover needed shifts hours bus times how many people per shift', 'Roster builder', () => gsGo('roster-build', { sec: 'need' })],
  ['🧑‍💼 Team: titles, hotels, locks, shifts', 'team staff card title hotel lock shift static rotating add staff remove left', 'Roster builder', () => gsGo('roster-build', { sec: 'team' })],
  ['😀 Character look', 'avatar character look face hair skin outfit glasses cartoon', 'Team → a person\'s card', () => gsGo('roster-build', { sec: 'team' })],
  ['🙋 Requests and wishes', 'requests wishes day off request prefer', 'Roster builder', () => gsGo('roster-build', { sec: 'req' })],
  ['🌴 Vacation planner', 'vacation annual leave planner al', 'Roster builder', () => gsGo('roster-build', { sec: 'vac' })],
  ['📅 Meetings & training', 'meeting training outlook event invite', 'Roster builder', () => gsGo('roster-build', { sec: 'plan' })],
  // roster page
  ['🕐 12-hour / 24-hour times', '12 hour 24 hour am pm time format clock roster times', 'Roster page', () => gsGo('roster', { sel: '.ro-12' })],
  ['➕ Add the roster (picture, Excel)', 'add roster upload picture photo excel import posted roster', 'Roster page', () => gsGo('roster', { text: 'Add roster' })],
  ['🤒 Sick / leave', 'sick leave absent cover call in sick', 'Roster page', () => gsGo('roster', { text: 'Sick / leave' })],
  ['🔁 Swap shifts', 'swap trade change shift with colleague', 'Roster page', () => gsGo('roster', { text: 'Swap shifts' })],
  ['🤔 What if…', 'what if scenario try', 'Roster page', () => gsGo('roster', { text: 'What if' })],
  ['✏️ Change this week', 'change edit posted week', 'Roster page', () => gsGo('roster', { text: 'Change this week' })],
  ['🙋 My shifts', 'my shifts my name which one is me next shift', 'Roster page', () => gsGo('roster', { text: 'My shifts' })],
  ['🎮 Live desk', 'live desk game who is on shift lobby rush hour', 'Roster page', () => { showPanel('roster'); setTimeout(() => typeof lvOpen === 'function' && lvOpen(), 300); }],
  // shift tasks
  ['⏰ Shift task with a time (reminder)', 'task time reminder alarm ring shift task', 'Shift Tasks', () => gsGo('shifts', { sel: '[id^="stAt-"]' })],
  ['☀️ Morning brief', 'morning brief summary day today manager whatsapp who is on', 'Home', () => mbOpen()],
  ['🙋 Ask for a day off', 'day off request leave annual leave holiday vacation time off ask manager approve shift wish', 'Roster', () => gsGo('roster', { sel: '#askMine' })],
  ['🙋 Day-off requests to approve', 'approve decline day off requests leave waiting staff requests', 'Roster', () => gsGo('roster', { sel: '#askMgrRo' })],
  ['🎓 Standards quiz', 'quiz test standards training score new staff questions', 'Learn HotelOps', () => gsGo('learn', { sel: '#qzRoot' })],
  ['🏆 Seller board', 'seller board leaderboard commission packages sold per person month ranking csv', 'Package Audit', () => gsGo('package-audit', { sel: '#pkgBoard' })],
  ['📄 Skip The Clean month summary', 'skip the clean pdf month summary print loyalty points', 'Skip The Clean', () => gsGo('skip-clean', { sel: '#stc-pdf' })],
  ['🗂 DTCM month-end pack', 'dtcm month end pack pdf finance tourism dirham corrections sign', 'DTCM Recon', () => gsGo('dtcm')],
  ['⚖️ Monthly fairness', 'fairness fair nights weekends weekend public holiday ph worked days off mornings afternoons monthly report roster balance team', 'Roster', () => { showPanel('roster'); setTimeout(() => rfOpen(), 200); }],
  ['🧾 My balances', 'my balances ph owed vacation left annual leave days off nights this month', 'Roster', () => gsGo('roster', { sel: '#roBal' })],
  ['👥 Own Team Leader for night gaps', 'team leader night gap tl cover lend supervisor own hotel rule', 'Roster builder → Rules', () => gsGo('roster-build', { sec: 'rules', text: 'Own Team Leader' })],
  ['🗂️ Front Office Log', 'front office log lost found maintenance float cash count upsell', 'Front Office Log', () => gsGo('ops-logs', { sel: '#ol-tabs' })],
  ['🧳 Lost & Found', 'lost found item left behind returned guest dispose', 'Front Office Log', () => gsGo('ops-logs', { run: () => olTab('lf'), sel: '#ol-tab-lf' })],
  ['🔧 Maintenance tickets', 'maintenance ticket repair broken engineering ac leak fix', 'Front Office Log', () => gsGo('ops-logs', { run: () => olTab('mt'), sel: '#ol-tab-mt' })],
  ['💵 Float count', 'float cash count drawer denominations short over shift', 'Front Office Log', () => gsGo('ops-logs', { run: () => olTab('cash'), sel: '#ol-tab-cash' })],
  ['💰 Upsell list', 'upsell early check-in late check-out breakfast upgrade offer sold', 'Front Office Log', () => gsGo('ops-logs', { run: () => olTab('up'), sel: '#ol-tab-up' })],
  ['🔐 New-device sign-in alerts', 'security new device sign in login alert phone stolen hacked account', 'Team', () => { if (typeof openAdminPanel === 'function') openAdminPanel(); }],
  ['💾 Download a backup', 'backup download export save everything file restore', 'Settings', () => gsSet('Download a backup')],
  ['❗ Important shift task', 'important urgent priority red tag shift task flag', 'Shift Tasks', () => gsGo('shifts', { sel: '[id^="stImp-"]' })],
  ['📦 Package Audit: to fix', 'package upsell in-gauge fix list copy fixed confirmed came back seller', 'Package Audit', () => gsGo('package-audit', { sel: '#pkgList' })],
  ['⚙️ Package Audit rules', 'package rules extension same stay first person tars freeze seller staff names logins why', 'Package Audit', () => { gsGo('package-audit'); setTimeout(() => pkgShowView('rules'), 300); }],
  ['⏎ Enter to save', 'enter key save keyboard shortcut submit ok', 'Keyboard', () => showToast('Press Enter in any window field to save it', 'ok')],
  ['↩ Undo / Recent actions', 'undo ctrl z redo recent actions history mistake back', 'Everywhere', () => hoUndo.openList()],
  ['📆 Monthly reports (TD check, revenue by accounts, statistics)', 'monthly report reports month end td revenue accounts statistics statics due 1 4 remind every month', 'Shift Tasks', () => gsGo('shifts', { sel: '#mrCard' })],
  ['🔁 Repeat a shift task every week or every month', 'repeat recurring every week weekly every month monthly task', 'Shift Tasks', () => gsGo('shifts', { sel: '[id^="stRep-"]' })],
  ['📅 Shift task for a date (one-off)', 'task date one off coming up later day', 'Shift Tasks', () => gsGo('shifts', { sel: '[id^="stOn-"]' })],
  // other pages
    ['🏛️ DTCM Recon', 'dtcm tourism dirham recon month to date corrections', 'DTCM Recon', () => gsGo('dtcm')],
  ['☎️ Wake-up calls', 'wake up call morning call', 'Wake-up Calls', () => gsGo('wakeups')],
];
/** open Settings filtered to one option, and light it up */
function gsSet(name) {
  showPanel('settings');
  let n = 0;
  const tick = () => {
    const s = document.getElementById('hsSearch'), row = [...document.querySelectorAll('#hsBody [data-s]')].find(r => (r.querySelector('b')?.textContent || '').trim() === name);
    if (!row) { if (++n < 34) setTimeout(tick, 150); return; }
    if (s) { s.value = name; hoSettingsFilter(name); }
    setTimeout(() => gsFlash(row), 120);
  };
  setTimeout(tick, 150);
}
GS_FEATURES.push(
  ['✅ Auto-tick shift tasks', 'auto tick automatic ticked by the app done enrollment checklist', 'Settings → Helpers', () => gsSet('Tick shift tasks the app can see are done')],
  ['🌴 Quiet on my day off', 'quiet off day ph leave mute alarms notifications not working', 'Settings → Alerts & sounds', () => gsSet('Quiet when I\'m off')],
  ['🔔 Notifications and sound', 'notifications notify sound chime alert desktop', 'Settings → Alerts & sounds', () => gsSet('Desktop notifications')],
  ['🔒 Sign out when idle', 'auto logout sign out idle lock timeout', 'Settings → Privacy & security', () => gsSet('Sign out when idle')],
  ['🔄 Fresh shift tasks every day', 'reset shift tasks daily fresh clear ticks', 'Settings → Helpers', () => gsSet('Fresh shift tasks every day')],
);
function gsFeatureHits(q) {
  // every word you type, in any order, hyphens or not ("12 hour" finds "12-hour", "day off fixed" finds "Fixed days off")
  const norm = x => String(x || '').toLowerCase().replace(/[-–_/]+/g, ' ');
  const words = norm(q).split(/\s+/).filter(Boolean);
  const out = [], hit = (...xs) => { const t = norm(xs.join(' ')); return words.every(w => t.includes(w)); };
  const shortcut = new Set();   // settings already offered by a named shortcut above
  const allowed = pn => typeof hoPanelAllowed !== 'function' || hoPanelAllowed(pn);
  GS_FEATURES.forEach(([name, keys, where, act]) => {
    const pn = (String(act).match(/(?:gsGo|showPanel)\('([a-z-]+)'/) || [])[1];
    const sn = (String(act).match(/gsSet\('((?:[^'\\]|\\.)*)'/) || [])[1];
    if (hit(name, keys, where) && sn) shortcut.add(sn.replace(/\\'/g, "'"));
    if (hit(name, keys, where) && (!pn || allowed(pn))) out.push({ panel: 'option', room: '', name, extra: where, icon: '🧭', act });
  });
  // every Settings option, from the settings page itself
  try {
    if (typeof hoSettingsRender === 'function' && !document.querySelector('#hsBody [data-s]')) hoSettingsRender();
    document.querySelectorAll('#hsBody [data-s]').forEach(row => {
      const b = row.querySelector('b'), name = (b ? b.textContent : '').trim();
      if (!name || !hit(name, row.dataset.s) || shortcut.has(name)) return;
      const sec = row.closest('.hs-sec')?.querySelector('h2')?.textContent.trim() || 'Settings';
      out.push({ panel: 'option', room: '', name, extra: 'Settings → ' + sec, icon: '⚙️', act: () => gsSet(name) });
    });
  } catch (_) {}
  return out.slice(0, 12);
}

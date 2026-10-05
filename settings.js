// ═══════════════════════════════════════════════════════════
//  settings.js — Settings page
//  Everything you can switch on, off, show or hide, in one place.
//  Personal choices (look, menu, helpers) are saved on this device;
//  hotel choices (name, Tourism Dirham) are shared with the team.
//  Hiding a page only tidies your menu — it never changes who is
//  allowed to open what (that stays with Team management).
// ═══════════════════════════════════════════════════════════

const HO_PREFS_KEY = 'hotelops_prefs_v1';
const HO_PREF_DEFAULTS = {
  textSize: 'm',          // s · m · l · xl
  density: 'comfortable', // comfortable · compact
  motion: true,
  menuStyle: 'full',      // full · icons
  startPage: 'home',
  hiddenPages: [],
  hiddenTiles: [],
  homeTip: true,
  brainOn: true,
  brainBubbles: true,
  brainHome: true,
  whatsNew: true,
  installPrompt: true,
  dropAnywhere: true,
  confirmCheckout: true,
  accent: 'theme',        // theme · gold · blue · green · teal · rose · purple
  corners: 'rounded',     // rounded · soft · sharp
  font: 'inter',          // inter · system
  contrast: false,
  tbClock: true, tbVersion: true, tbConn: true, tbThemes: true, tbUser: true,
  clock12: false, clockSeconds: false, greetName: true,
  privacy: false,
  autoLock: 0,            // minutes without activity before signing out (0 = never)
  soundAlerts: false,
  desktopNotify: false,
  haptics: true,
  depSize: 'md',
  syncPrefs: false,
};
const HO_ACCENTS = {
  gold: ['#eab94a', '#c99a2e', '#f6d77e', '#c38b26'], blue: ['#4f8cff', '#2f6fe6', '#9cc0ff', '#2f6fe6'],
  green: ['#3ecf8e', '#22a86f', '#9ff0c9', '#1f9a63'], teal: ['#2dd4bf', '#14a597', '#99f6e4', '#0f8f84'],
  rose: ['#f46a86', '#d94a68', '#ffb3c3', '#d94a68'], purple: ['#a78bfa', '#7c5ce6', '#d6c8ff', '#7c5ce6'],
};
let hoPrefs = (() => { try { return Object.assign({}, HO_PREF_DEFAULTS, JSON.parse(localStorage.getItem(HO_PREFS_KEY) || '{}')); } catch (_) { return Object.assign({}, HO_PREF_DEFAULTS); } })();

function hoPref(k) { return hoPrefs[k]; }
function hoSetPref(k, v) {
  hoPrefs[k] = v;
  try { localStorage.setItem(HO_PREFS_KEY, JSON.stringify(hoPrefs)); } catch (_) {}
  hoApplyPrefs();
  if (k === 'depSize' && typeof setDepSize === 'function') setDepSize(v, [...document.querySelectorAll('.vt-btn')].find(b => (b.getAttribute('onclick') || '').includes(`'${v}'`)));
  if (k === 'syncPrefs' && !v) { const uid = _hoUid(); if (uid && typeof fbSet === 'function') fbSet('userPrefs/' + uid + '/syncPrefs', false); }
  hoSyncUp();
}

// pages people can hide (Home and Settings always stay)
function _hoPages() {
  return [...document.querySelectorAll('.sidenav .nav-item[data-panel]')]
    .map(n => ({ id: n.dataset.panel, name: n.textContent.replace(/\s*[\d—✓/]+\s*$/, '').replace(/Compare|Upload/g, '').trim(), allowed: n.style.display !== 'none' }))
    .filter(p => p.id !== 'home' && p.id !== 'settings' && p.allowed);
}

function hoApplyPrefs() {
  const b = document.body;
  if (!b) return;
  const z = { s: 0.92, m: 1, l: 1.08, xl: 1.16 }[hoPrefs.textSize] || 1;
  const app = document.getElementById('appWrapper');
  if (app) app.style.zoom = z === 1 ? '' : z;
  b.classList.toggle('ho-compact', hoPrefs.density === 'compact');
  b.classList.toggle('ho-still', !hoPrefs.motion);
  b.classList.toggle('ho-rail', hoPrefs.menuStyle === 'icons');
  b.classList.toggle('ho-no-brain', !hoPrefs.brainOn);
  b.classList.toggle('ho-no-hometip', !hoPrefs.homeTip);
  const hidden = new Set(hoPrefs.hiddenPages || []);
  document.querySelectorAll('.nav-item[data-panel], .mob-more-item[data-panel], .mob-nav-btn[data-panel]').forEach(el => {
    el.classList.toggle('ho-hidden', hidden.has(el.dataset.panel));
  });
  // icons-only menu: keep the page name as a tooltip
  document.querySelectorAll('.sidenav .nav-item').forEach(n => { if (!n.title) n.title = n.textContent.replace(/\s*[\d—✓/]+\s*$/, '').trim(); });
  if (!hoPrefs.brainOn) document.getElementById('blBubble')?.remove();
  // accent colour, corners, font
  const R = document.documentElement.style;
  const ac = HO_ACCENTS[hoPrefs.accent];
  ['--accent', '--accent2', '--accent-bg', '--accent-border', '--ho-a1', '--ho-a2'].forEach(v => R.removeProperty(v));
  if (ac) {
    R.setProperty('--accent', ac[0], 'important'); R.setProperty('--accent2', ac[1], 'important');
    R.setProperty('--accent-bg', ac[0] + '1a', 'important'); R.setProperty('--accent-border', ac[0] + '47', 'important');
    R.setProperty('--ho-a1', ac[2], 'important'); R.setProperty('--ho-a2', ac[3], 'important');
  }
  ['--r', '--r2', '--r3'].forEach(v => R.removeProperty(v));
  const rr = { soft: ['6px', '9px', '12px'], sharp: ['3px', '4px', '6px'] }[hoPrefs.corners];
  if (rr) { R.setProperty('--r', rr[0], 'important'); R.setProperty('--r2', rr[1], 'important'); R.setProperty('--r3', rr[2], 'important'); }
  if (hoPrefs.font === 'system') R.setProperty('--font', "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"); else R.removeProperty('--font');
  b.classList.toggle('ho-contrast', !!hoPrefs.contrast);
  b.classList.toggle('ho-privacy', !!hoPrefs.privacy);
  [['tbClock', 'ho-no-clock'], ['tbVersion', 'ho-no-ver'], ['tbConn', 'ho-no-conn'], ['tbThemes', 'ho-no-themes'], ['tbUser', 'ho-no-user']].forEach(([k, c]) => b.classList.toggle(c, !hoPrefs[k]));
  if (typeof updateClock === 'function') updateClock();
  hoArmAutoLock();
  if (typeof homeRender === 'function' && document.getElementById('panel-home')?.classList.contains('active')) homeRender();
}

// ── Page ─────────────────────────────────────────────────
const _hoTog = (k, label, desc) => `
  <label class="hs-row" data-s="${escapeHtml((label + ' ' + desc).toLowerCase())}">
    <span class="hs-txt"><b>${label}</b><small>${desc}</small></span>
    <span class="hs-switch"><input type="checkbox" ${hoPrefs[k] ? 'checked' : ''} onchange="hoSetPref('${k}', this.checked)"><i></i></span>
  </label>`;
const _hoSeg = (k, label, desc, opts) => `
  <div class="hs-row" data-s="${escapeHtml((label + ' ' + desc).toLowerCase())}">
    <span class="hs-txt"><b>${label}</b><small>${desc}</small></span>
    <span class="hs-seg">${opts.map(([v, t]) => `<button class="${hoPrefs[k] === v ? 'on' : ''}" onclick="hoSetPref('${k}',${JSON.stringify(v).replace(/"/g, '&quot;')});hoSettingsRender()">${t}</button>`).join('')}</span>
  </div>`;
const _hoBtn = (label, desc, btn, fn, cls = '') => `
  <div class="hs-row" data-s="${escapeHtml((label + ' ' + desc).toLowerCase())}">
    <span class="hs-txt"><b>${label}</b><small>${desc}</small></span>
    <button class="btn ${cls}" onclick="${fn}">${btn}</button>
  </div>`;
const _hoSec = (id, icon, title, sub, body) => `
  <section class="hs-sec" id="hs-${id}">
    <div class="hs-sec-hd"><span class="hs-sec-ic">${(typeof hoIcon === 'function' && hoIcon(icon)) || ''}</span><div><h2>${title}</h2><p>${sub}</p></div></div>
    <div class="hs-card">${body}</div>
  </section>`;

function hoSettingsRender() {
  const box = document.getElementById('hsBody');
  if (!box) return;
  const theme = document.documentElement.getAttribute('data-theme') || 'night-ops';
  const pages = _hoPages();
  const hidden = new Set(hoPrefs.hiddenPages || []);
  const tiles = [['departures', 'Departures'], ['arrivals', 'Arrivals'], ['purpose', 'Purpose of Stay'], ['dtcm', 'DTCM Recon'], ['package-audit', 'Package Audit'], ['checklist', 'Night Checklist'], ['shifts', 'Shift Tasks'], ['pipeline', 'ALL enrollment']];
  const hiddenT = new Set(hoPrefs.hiddenTiles || []);
  const me = (typeof currentProfile !== 'undefined' && currentProfile) || {};
  const role = (typeof ROLES !== 'undefined' && ROLES[me.role]) || null;
  const td = typeof HotelCfg !== 'undefined' ? HotelCfg.get() : null;
  const hotel = document.getElementById('hotelName')?.textContent || '';

  box.innerHTML = [
    _hoSec('look', 'sparkle', 'Appearance', 'How HotelOps looks on this device',
      `<div class="hs-row" data-s="theme colour color dark light night opera midnight">
         <span class="hs-txt"><b>Theme</b><small>Colours for the whole app</small></span>
         <span class="hs-themes">${[['night-ops', 'Night Ops', '#eab94a', '#0b0e14'], ['opera', 'Opera', '#c74634', '#f4f5f7'], ['midnight', 'Midnight', '#818cf8', '#0b1020']].map(([v, t, a, bg]) =>
           `<button class="${theme === v ? 'on' : ''}" onclick="setTheme('${v}');hoSettingsRender()"><span style="background:${bg}"><i style="background:${a}"></i></span>${t}</button>`).join('')}</span>
       </div>`
      + _hoSeg('textSize', 'Text size', 'Bigger text is easier to read on the desk PC', [['s', 'Small'], ['m', 'Normal'], ['l', 'Large'], ['xl', 'Extra large']])
      + _hoSeg('density', 'Density', 'Compact fits more rows on the screen', [['comfortable', 'Comfortable'], ['compact', 'Compact']])
      + _hoSeg('menuStyle', 'Side menu', 'Icons only gives the pages more room', [['full', 'Icons and names'], ['icons', 'Icons only']])
      + _hoTog('motion', 'Animations', 'Page transitions and small movements. Turn off if the PC is slow')
      + `<div class="hs-row" data-s="accent colour color gold blue green">
           <span class="hs-txt"><b>Accent colour</b><small>Buttons, highlights and the logo</small></span>
           <span class="hs-swatches"><button class="${hoPrefs.accent === 'theme' ? 'on' : ''}" title="Theme default" onclick="hoSetPref('accent','theme');hoSettingsRender()"><i style="background:conic-gradient(#eab94a 0 33%,#c74634 0 66%,#818cf8 0)"></i></button>${Object.entries(HO_ACCENTS).map(([k, c]) => `<button class="${hoPrefs.accent === k ? 'on' : ''}" title="${k}" onclick="hoSetPref('accent','${k}');hoSettingsRender()"><i style="background:${c[0]}"></i></button>`).join('')}</span>
         </div>`
      + _hoSeg('corners', 'Corners', 'How round cards and buttons are', [['rounded', 'Rounded'], ['soft', 'Soft'], ['sharp', 'Sharp']])
      + _hoSeg('font', 'Font', 'Inter, or your device\'s own font', [['inter', 'Inter'], ['system', 'System']])
      + _hoTog('contrast', 'High contrast', 'Brighter secondary text and stronger lines, for bright rooms or tired eyes')),

    _hoSec('topbar', 'menu', 'Top bar', 'Choose what the bar at the top shows',
      _hoTog('tbClock', 'Clock', 'The current time')
      + _hoTog('tbConn', 'Connection', 'Whether you are connected to the team database')
      + _hoTog('tbVersion', 'Version', 'The version label (tap it to update)')
      + _hoTog('tbThemes', 'Theme switcher', 'The three colour dots')
      + _hoTog('tbUser', 'Your name', 'Who is signed in')),

    _hoSec('time', 'shifts', 'Date & time', 'How times are shown',
      _hoSeg('clock12', 'Clock', '24-hour like Opera, or 12-hour with AM/PM', [[false, '24-hour'], [true, '12-hour']])
      + _hoTog('clockSeconds', 'Show seconds', 'In the top bar clock')
      + _hoTog('greetName', 'Greet me by name', '"Good evening, Ahmed" on Home')),

    _hoSec('menu', 'more', 'Menu & pages', 'Show only the pages you use. Hidden pages can still be opened from search (Ctrl K)',
      `<div class="hs-row" data-s="start page open first launch">
         <span class="hs-txt"><b>Open first</b><small>The page HotelOps opens on</small></span>
         <select onchange="hoSetPref('startPage', this.value)">${[['home', 'Home']].concat(pages.map(p => [p.id, p.name])).map(([v, t]) => `<option value="${v}" ${hoPrefs.startPage === v ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select>
       </div>
       <div class="hs-pages" data-s="pages menu hide show ${escapeHtml(pages.map(p => p.name).join(' ').toLowerCase())}">
         ${pages.map(p => `<label class="hs-page ${hidden.has(p.id) ? 'off' : ''}"><input type="checkbox" ${hidden.has(p.id) ? '' : 'checked'} onchange="hoTogglePage('${p.id}', this.checked)"><span class="hs-page-ic">${(typeof hoIcon === 'function' && hoIcon(p.id)) || ''}</span>${escapeHtml(p.name)}</label>`).join('')}
       </div>
       <div class="hs-row hs-mini"><span class="hs-txt"><small>${pages.length - hidden.size} of ${pages.length} pages shown</small></span>
         <span><button class="btn sm ghost" onclick="hoSetPref('hiddenPages',[]);hoSettingsRender()">Show all</button></span></div>`),

    _hoSec('home', 'home', 'Home', 'What the Home page shows',
      `<div class="hs-pages" data-s="home tiles cards dashboard">
         ${tiles.map(([v, t]) => `<label class="hs-page ${hiddenT.has(v) ? 'off' : ''}"><input type="checkbox" ${hiddenT.has(v) ? '' : 'checked'} onchange="hoToggleTile('${v}', this.checked)"><span class="hs-page-ic">${(typeof hoIcon === 'function' && hoIcon(v)) || ''}</span>${t}</label>`).join('')}
       </div>`
      + _hoTog('brainHome', 'Ops Brain suggestions on Home', 'The 3 things it would do next, under the tiles')
      + _hoTog('homeTip', 'Drop-a-file tip', 'The reminder that you can drag reports onto the app')),

    _hoSec('brain', 'sparkle', 'Ops Brain', 'Your assistant: what it may do and how much it talks',
      _hoTog('brainOn', 'Ops Brain', 'The 🧠 button, suggestions, health check and commands. Off = it stays completely quiet')
      + _hoTog('brainBubbles', 'Speak up', 'Bubbles next to 🧠 when it notices something. Errors are always shown')
      + `<label class="hs-row" data-s="autopilot fix by itself">
           <span class="hs-txt"><b>Autopilot</b><small>Fixes safe things by itself (duplicates, nationality guesses, country names) and tells you, with Undo</small></span>
           <span class="hs-switch"><input type="checkbox" ${typeof blAutopilot === 'function' && blAutopilot() ? 'checked' : ''} onchange="blSetAutopilot(this.checked)"><i></i></span>
         </label>`
      + _hoBtn('What it learned', 'Your habits, team answers, turned-off suggestions', 'Open', "brOpen('learned')", 'ghost')
      + _hoBtn('Turn all suggestions back on', 'Undo every "Don\'t suggest this"', 'Reset', 'blResetLearned()', 'ghost')),

    _hoSec('help', 'handover', 'Helpers', 'Small things that pop up',
      _hoTog('whatsNew', '"What\'s new" after updates', 'Shows what changed the first time a new version opens')
      + _hoTog('installPrompt', '"Add to home screen" on phones', 'The one-time install suggestion')
      + _hoTog('dropAnywhere', 'Drop a report anywhere', 'Drag a file onto any page and it opens the right page')
      + _hoTog('confirmCheckout', 'Ask before checking out a room that owes money', 'Applies to Ops Brain commands like "check out 512"')
      + _hoTog('haptics', 'Vibration on phones', 'A light tap when you press buttons')),

    _hoSec('alerts', 'feedback', 'Alerts & sounds', 'How HotelOps gets your attention',
      `<label class="hs-row" data-s="overdue late checkout alerts departures">
         <span class="hs-txt"><b>Late check-out alerts</b><small>Warn when a room passes its late check-out time</small></span>
         <span class="hs-switch"><input type="checkbox" ${typeof depAlertsOn !== 'undefined' && depAlertsOn ? 'checked' : ''} onchange="if (typeof depToggleAlerts === 'function' && depAlertsOn !== this.checked) depToggleAlerts()"><i></i></span>
       </label>`
      + _hoTog('soundAlerts', 'Sound', 'A short chime when Ops Brain sees something urgent (late check-out, an error, DTCM not tallying)')
      + `<label class="hs-row" data-s="desktop notifications browser popup">
           <span class="hs-txt"><b>Desktop notifications</b><small>Urgent things pop up even when HotelOps is in another tab${'Notification' in window && Notification.permission === 'denied' ? ' — <b>blocked in this browser</b>: allow notifications in the address bar first' : ''}</small></span>
           <span class="hs-switch"><input type="checkbox" ${hoPrefs.desktopNotify ? 'checked' : ''} onchange="hoSetNotify(this.checked, this)"><i></i></span>
         </label>`
      + _hoBtn('Test', 'Play the chime and show a test notification', 'Test', 'hoAlert(\'This is how HotelOps gets your attention\', true)', 'ghost')),

    _hoSec('deps', 'departures', 'Departures', 'Your defaults for the Departures board',
      _hoSeg('depSize', 'Card size', 'How big each room card is', [['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large'], ['list', 'List']])),

    _hoSec('privacy', 'immig', 'Privacy & security', 'Protect guest details on a shared desk',
      _hoTog('privacy', 'Privacy screen', 'Blurs guest names and emails until you point at them. Use it when guests can see the screen')
      + _hoSeg('autoLock', 'Sign out when idle', 'Signs out this device after no activity', [[0, 'Never'], [15, '15 min'], [30, '30 min'], [60, '1 hour'], [240, '4 hours']])),

    _hoSec('hotel', 'adagio', 'Hotel', 'Shared with the whole team',
      `<div class="hs-row" data-s="hotel name property">
         <span class="hs-txt"><b>Hotel name</b><small>Shown under the HotelOps logo and on reports</small></span>
         <span class="hs-inline"><input id="hsHotel" value="${escapeHtml(hotel)}"><button class="btn sm" onclick="hoSaveHotel()">Save</button></span>
       </div>`
      + (td ? `<div class="hs-row hs-col" data-s="tourism dirham td code rate cap night audit 7510 dtcm">
         <span class="hs-txt"><b>Tourism Dirham</b><small>Opera code, rate per night, night cap and audit time. Used by DTCM Recon, TD Audit and Long Stay</small></span>
         <div class="hs-grid">
           <label>Opera code(s)<input id="hsTdCodes" value="${escapeHtml(td.tdCodes)}"></label>
           <label>Description<input id="hsTdDesc" value="${escapeHtml(td.tdDesc)}"></label>
           <label>Rate (AED / night)<input id="hsTdRate" type="number" value="${escapeHtml(String(td.tdRate))}"></label>
           <label>Night cap<input id="hsTdCap" type="number" value="${escapeHtml(String(td.tdCap))}"></label>
           <label>Night audit ends<input id="hsTdAudit" value="${escapeHtml(td.auditTime)}"></label>
         </div>
         <div class="hs-acts"><button class="btn gold sm" onclick="hoSaveTd()">Save TD settings</button><small>Star rating: 5★ 20 · 4★ 15 · 3★ 10 · 1–2★ 7 AED</small></div>
       </div>` : '')),

    _hoSec('sync', 'team', 'Sync', 'Take your settings to every device you sign in on',
      _hoTog('syncPrefs', 'Sync my settings', 'Saves these settings to your account. Sign in on another PC or phone and they follow you')),

    _hoSec('data', 'save', 'Data & storage', 'Backups and this device\'s saved copies',
      _hoBtn('Download a backup', 'Everything the team saved, as one file', 'Download', 'exportAllData()')
      + _hoBtn('Restore a backup', 'Load a backup file', 'Choose file', "document.querySelector('input[accept=\".json\"][onchange*=handleImport]').click()")
      + _hoBtn('Health check', 'Look for a waiting update, damaged data and errors', 'Run', "brOpen('health')")
      + _hoBtn('Clear this device\'s copies', 'Frees space; the team data comes back from the database', 'Clear', 'hoClearCache()', 'ghost')
      + `<div class="hs-row" data-s="storage space used device"><span class="hs-txt"><b>Storage on this device</b><small id="hsStorage">Measuring…</small></span><span class="hs-meter"><i id="hsStorageBar"></i></span></div>`
      + _hoBtn('Export settings', 'Save these settings as a file', 'Export', 'hoExportPrefs()', 'ghost')
      + _hoBtn('Import settings', 'Load settings from a file', 'Import', "document.getElementById('hsPrefsFile').click()", 'ghost')
      + _hoBtn('Reset these settings', 'Back to the defaults on this device', 'Reset', 'hoResetPrefs()', 'ghost')
      + '<input type="file" id="hsPrefsFile" accept=".json" style="display:none" onchange="hoImportPrefs(this)">'),

    _hoSec('adv', 'keyboard', 'Advanced', 'For checking problems',
      _hoBtn('Keyboard shortcuts', 'Ctrl K search, Ctrl J Ops Brain and more', 'Show', "document.getElementById('kbModal')?.classList.add('open')", 'ghost')
      + _hoBtn('Error log', 'Errors this device saw, with a one-tap report', 'Open', "brOpen('health')", 'ghost')
      + _hoBtn('Reload the app fresh', 'Clears the app cache and loads the newest version', 'Reload', 'appForceUpdate()', 'ghost')
      + `<div class="hs-row hs-col" data-s="technical details debug info"><span class="hs-txt"><b>Technical details</b><small>Read these out if the developer asks</small></span><pre class="hs-pre" id="hsTech">…</pre></div>`),

    _hoSec('account', 'team', 'Account', 'Who is signed in on this device',
      `<div class="hs-row" data-s="account user name role email">
         <span class="hs-txt"><b>${escapeHtml(me.name || 'Signed in')}</b><small>${escapeHtml([role ? role.label : me.role, me.email].filter(Boolean).join(' · '))}</small></span>
         <span class="hs-inline">${role && role.canManageUsers ? '<button class="btn sm ghost" onclick="openAdminPanel()">Team management</button>' : ''}<button class="btn sm" onclick="authLogout()">Sign out</button></span>
       </div>`),

    _hoSec('about', 'reports', 'About', 'HotelOps',
      `<div class="hs-row" data-s="version update about">
         <span class="hs-txt"><b>HotelOps ${escapeHtml(typeof APP_VERSION !== 'undefined' ? APP_VERSION : '')}</b><small>Front office operations for ${escapeHtml(hotel || 'your hotel')}</small></span>
         <span class="hs-inline"><button class="btn sm ghost" onclick="wnOpen(true)">What's new</button><button class="btn sm" onclick="appForceUpdate()">Check for update</button></span>
       </div>`),
  ].join('');
  hoSettingsFilter(document.getElementById('hsSearch')?.value || '');
  hoFillTech();
}

async function hoFillTech() {
  let bytes = 0;
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); bytes += (k.length + (localStorage.getItem(k) || '').length) * 2; } } catch (_) {}
  const kb = Math.round(bytes / 1024), pct = Math.min(100, Math.round(bytes / 5e6 * 100));
  const s = document.getElementById('hsStorage'); if (s) s.textContent = `${kb.toLocaleString('en')} KB of about 5,000 KB (${pct}%)`;
  const bar = document.getElementById('hsStorageBar'); if (bar) { bar.style.width = pct + '%'; bar.classList.toggle('hi', pct > 80); }
  let cache = '—';
  try { cache = (await caches.keys()).join(', ') || 'none'; } catch (_) {}
  const me = (typeof currentProfile !== 'undefined' && currentProfile) || {};
  const t = document.getElementById('hsTech');
  if (t) t.textContent = [
    `Version     ${typeof APP_VERSION !== 'undefined' ? APP_VERSION : '?'}`,
    `Cache       ${cache}`,
    `Database    ${document.getElementById('fbLabel')?.textContent || '?'}`,
    `Signed in   ${me.name || '?'} (${me.role || '?'})`,
    `Screen      ${screen.width}×${screen.height} · window ${innerWidth}×${innerHeight}`,
    `Browser     ${navigator.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 110)}`,
    `Online      ${navigator.onLine ? 'yes' : 'no'} · installed ${matchMedia('(display-mode: standalone)').matches ? 'yes' : 'no'}`,
  ].join('\n');
}

// ── Alerts ───────────────────────────────────────────────
let _hoAudio = null;
function hoChime() {
  try {
    _hoAudio = _hoAudio || new (window.AudioContext || window.webkitAudioContext)();
    const a = _hoAudio, now = a.currentTime;
    [[880, 0], [1320, 0.14]].forEach(([f, d]) => {
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now + d); g.gain.exponentialRampToValueAtTime(0.18, now + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, now + d + 0.35);
      o.connect(g).connect(a.destination); o.start(now + d); o.stop(now + d + 0.4);
    });
  } catch (_) {}
}
/** urgent thing to tell the person: chime and/or desktop notification, as they chose */
function hoAlert(text, test) {
  if (hoPrefs.soundAlerts || test) hoChime();
  if ((hoPrefs.desktopNotify || test) && 'Notification' in window && Notification.permission === 'granted' && (document.hidden || test)) {
    try { new Notification('HotelOps', { body: text, icon: 'icon-192.png', tag: 'hotelops-' + text.slice(0, 40) }); } catch (_) {}
  }
}
async function hoSetNotify(on, el) {
  if (on && 'Notification' in window && Notification.permission !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') { if (el) el.checked = false; showToast('Notifications are blocked in this browser', 'err'); return; }
  }
  hoSetPref('desktopNotify', !!on);
}

// ── Sign out when idle ───────────────────────────────────
let _hoIdleT = null, _hoIdleArmed = false;
function hoArmAutoLock() {
  clearTimeout(_hoIdleT);
  const m = +hoPrefs.autoLock || 0;
  if (!m) return;
  if (!_hoIdleArmed) {
    _hoIdleArmed = true;
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { if (+hoPrefs.autoLock) { clearTimeout(_hoIdleT); _hoIdleT = setTimeout(_hoIdleOut, hoPrefs.autoLock * 60e3); } }, { passive: true }));
  }
  _hoIdleT = setTimeout(_hoIdleOut, m * 60e3);
}
function _hoIdleOut() {
  const app = document.getElementById('appWrapper');
  if (!app || app.style.display === 'none' || typeof authLogout !== 'function') return;
  if (typeof logActivity === 'function') try { logActivity('logout', `signed out after ${hoPrefs.autoLock} min without activity`); } catch (_) {}
  authLogout();
}

// ── Settings as a file, and across devices ───────────────
function hoExportPrefs() {
  const blob = new Blob([JSON.stringify({ hotelops: 'settings', v: 1, prefs: hoPrefs }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'hotelops-settings.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function hoImportPrefs(input) {
  const f = input.files && input.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || d.hotelops !== 'settings' || typeof d.prefs !== 'object') throw new Error('not a HotelOps settings file');
      const clean = {};
      Object.keys(HO_PREF_DEFAULTS).forEach(k => { if (k in d.prefs && typeof d.prefs[k] === typeof HO_PREF_DEFAULTS[k]) clean[k] = d.prefs[k]; });
      hoPrefs = Object.assign({}, HO_PREF_DEFAULTS, clean);
      try { localStorage.setItem(HO_PREFS_KEY, JSON.stringify(hoPrefs)); } catch (_) {}
      hoApplyPrefs(); hoSettingsRender(); showToast('Settings imported', 'ok');
    } catch (e) { showToast('That file is not a HotelOps settings file', 'err'); }
    input.value = '';
  };
  r.readAsText(f);
}
function _hoUid() { return (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || null; }
function hoSyncUp() {
  const uid = _hoUid();
  if (hoPrefs.syncPrefs && uid && typeof fbSet === 'function') fbSet('userPrefs/' + uid, hoPrefs);
}
async function hoSyncDown() {
  const uid = _hoUid();
  if (!uid || typeof fbGet !== 'function') return;
  try {
    const v = await fbGet('userPrefs/' + uid);
    if (v && v.syncPrefs) {
      hoPrefs = Object.assign({}, HO_PREF_DEFAULTS, v);
      try { localStorage.setItem(HO_PREFS_KEY, JSON.stringify(hoPrefs)); } catch (_) {}
      hoApplyPrefs();
    }
  } catch (_) {}
}

function hoSettingsFilter(q) {
  q = String(q || '').trim().toLowerCase();
  document.querySelectorAll('#hsBody .hs-sec').forEach(sec => {
    let any = false;
    sec.querySelectorAll('[data-s]').forEach(r => { const on = !q || r.dataset.s.includes(q) || sec.querySelector('h2').textContent.toLowerCase().includes(q); r.style.display = on ? '' : 'none'; any = any || on; });
    sec.style.display = any ? '' : 'none';
  });
}

function hoTogglePage(id, show) {
  const s = new Set(hoPrefs.hiddenPages || []);
  if (show) s.delete(id); else s.add(id);
  hoSetPref('hiddenPages', [...s]);
  hoSettingsRender();
}
function hoToggleTile(id, show) {
  const s = new Set(hoPrefs.hiddenTiles || []);
  if (show) s.delete(id); else s.add(id);
  hoSetPref('hiddenTiles', [...s]);
  hoSettingsRender();
}
function hoSaveHotel() {
  const v = (document.getElementById('hsHotel')?.value || '').trim();
  if (!v) { showToast('Enter the hotel name', 'err'); return; }
  const el = document.getElementById('hotelName'); if (el) el.textContent = v;
  if (typeof saveSettings === 'function') saveSettings({ hotelName: v });
  showToast('Hotel name saved for the team', 'ok');
}
function hoSaveTd() {
  const g = id => (document.getElementById(id)?.value || '').trim();
  const rate = parseFloat(g('hsTdRate')), cap = parseInt(g('hsTdCap'), 10), audit = g('hsTdAudit');
  if (!g('hsTdCodes')) { showToast('Enter at least one Opera code', 'err'); return; }
  if (!(rate > 0) || !(cap > 0)) { showToast('Rate and night cap must be above 0', 'err'); return; }
  if (!/^\d{1,2}:\d{2}$/.test(audit)) { showToast('Night audit time looks like 04:20', 'err'); return; }
  HotelCfg.set({ tdCodes: g('hsTdCodes'), tdDesc: g('hsTdDesc') || 'Tourism Dirham', tdRate: rate, tdCap: cap, auditTime: audit });
  if (typeof hsRenderForm === 'function') hsRenderForm();
  if (typeof logActivity === 'function') logActivity('td_settings', `Code ${HotelCfg.codeLabel()} · AED ${HotelCfg.rate()} · cap ${HotelCfg.cap()} · audit ${audit}`);
  showToast('TD settings saved for the team — run DTCM Analyze again to use them', 'ok');
}
function hoClearCache() {
  if (!confirm('Clear the saved copies on this device? Your team data stays safe in the database and loads again.')) return;
  try { Object.keys(localStorage).filter(k => /^ibis_/.test(k)).forEach(k => localStorage.removeItem(k)); } catch (_) {}
  location.reload();
}
function hoResetPrefs() {
  if (!confirm('Reset all settings on this device to the defaults?')) return;
  hoPrefs = Object.assign({}, HO_PREF_DEFAULTS);
  try { localStorage.removeItem(HO_PREFS_KEY); } catch (_) {}
  { const uid = _hoUid(); if (uid && typeof fbSet === 'function') fbSet('userPrefs/' + uid + '/syncPrefs', false); }
  hoApplyPrefs(); hoSettingsRender();
  showToast('Settings reset', 'ok');
}

// vibration follows the setting
(function () {
  if (!navigator.vibrate) return;
  const v = navigator.vibrate.bind(navigator);
  navigator.vibrate = function (p) { return hoPrefs.haptics ? v(p) : false; };
})();

document.addEventListener('DOMContentLoaded', () => {
  hoApplyPrefs();
  // after sign-in: settings saved to the account, and the Departures card size
  const ts = setInterval(() => {
    const app = document.getElementById('appWrapper');
    if (!app || app.style.display === 'none' || !_hoUid()) return;
    clearInterval(ts);
    hoSyncDown();
    if (hoPrefs.depSize !== 'md' && typeof setDepSize === 'function') setDepSize(hoPrefs.depSize, [...document.querySelectorAll('.vt-btn')].find(b => (b.getAttribute('onclick') || '').includes(`'${hoPrefs.depSize}'`)));
  }, 700);
  setTimeout(hoApplyPrefs, 1500);
  // open the chosen start page once, after sign-in
  if (hoPrefs.startPage && hoPrefs.startPage !== 'home') {
    const t = setInterval(() => {
      const app = document.getElementById('appWrapper');
      if (!app || app.style.display === 'none') return;
      clearInterval(t);
      const nav = document.getElementById('nav-' + hoPrefs.startPage);
      if (nav && nav.style.display !== 'none' && typeof showPanel === 'function') showPanel(hoPrefs.startPage);
    }, 500);
  }
});

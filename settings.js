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
};
let hoPrefs = (() => { try { return Object.assign({}, HO_PREF_DEFAULTS, JSON.parse(localStorage.getItem(HO_PREFS_KEY) || '{}')); } catch (_) { return Object.assign({}, HO_PREF_DEFAULTS); } })();

function hoPref(k) { return hoPrefs[k]; }
function hoSetPref(k, v) {
  hoPrefs[k] = v;
  try { localStorage.setItem(HO_PREFS_KEY, JSON.stringify(hoPrefs)); } catch (_) {}
  hoApplyPrefs();
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
    <span class="hs-seg">${opts.map(([v, t]) => `<button class="${hoPrefs[k] === v ? 'on' : ''}" onclick="hoSetPref('${k}','${v}');hoSettingsRender()">${t}</button>`).join('')}</span>
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
      + _hoTog('motion', 'Animations', 'Page transitions and small movements. Turn off if the PC is slow')),

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
      + _hoTog('confirmCheckout', 'Ask before checking out a room that owes money', 'Applies to Ops Brain commands like "check out 512"')),

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

    _hoSec('data', 'save', 'Data & storage', 'Backups and this device\'s saved copies',
      _hoBtn('Download a backup', 'Everything the team saved, as one file', 'Download', 'exportAllData()')
      + _hoBtn('Restore a backup', 'Load a backup file', 'Choose file', "document.querySelector('input[accept=\".json\"][onchange*=handleImport]').click()")
      + _hoBtn('Health check', 'Look for a waiting update, damaged data and errors', 'Run', "brOpen('health')")
      + _hoBtn('Clear this device\'s copies', 'Frees space; the team data comes back from the database', 'Clear', 'hoClearCache()', 'ghost')
      + _hoBtn('Reset these settings', 'Back to the defaults on this device', 'Reset', 'hoResetPrefs()', 'ghost')),

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
  hoApplyPrefs(); hoSettingsRender();
  showToast('Settings reset', 'ok');
}

document.addEventListener('DOMContentLoaded', () => {
  hoApplyPrefs();
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

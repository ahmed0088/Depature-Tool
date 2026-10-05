// ═══════════════════════════════════════════════════════════
//  brand.js — HotelOps identity
//  The logo, line icons for the menus and top bar, and the hotel name
//  under the wordmark. Icons are drawn inline (no icon font, works
//  offline) and take the colour of the text around them.
// ═══════════════════════════════════════════════════════════

let _hoLogoN = 0;
function hoLogo() { const id = 'hoG' + (++_hoLogoN); return `<svg class="ho-logo" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--ho-a1,#f6d77e)"/><stop offset="1" style="stop-color:var(--ho-a2,#c38b26)"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#${id})"/><path d="M17 15h9v14h12V15h9v34h-9V37H26v12h-9z" style="fill:var(--ho-ink,#0b0f16)"/><circle cx="32" cy="21.5" r="3.2" style="fill:var(--ho-ink,#0b0f16)"/></svg>`; }

const _hoI = d => `<svg class="ho-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const HOX_ICONS = {
  home: _hoI('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  departures: _hoI('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>'),
  arrivals: _hoI('<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>'),
  xref: _hoI('<path d="M4 7h13l-3-3"/><path d="M20 17H7l3 3"/>'),
  purpose: _hoI('<rect x="8" y="2.5" width="8" height="4" rx="1"/><path d="M16 4.5h2a2 2 0 0 1 2 2V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h4"/>'),
  shifts: _hoI('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  nationality: _hoI('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z"/>'),
  rent: _hoI('<path d="M3 19V6"/><path d="M3 14h18v5"/><path d="M21 14a4 4 0 0 0-4-4h-6v4"/><circle cx="7" cy="10.5" r="1.8"/>'),
  audit: _hoI('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
  immig: _hoI('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="2.5"/><path d="M14 10h4M14 14h4"/>'),
  tourism: _hoI('<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
  'td-audit': _hoI('<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="m9 15 2 2 4-4"/>'),
  skipclean: _hoI('<path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
  dtcm: _hoI('<path d="M3 10 12 4l9 6"/><path d="M5 10v8M10 10v8M14 10v8M19 10v8"/><path d="M3 21h18"/>'),
  'inhouse-tally': _hoI('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01"/>'),
  'package-audit': _hoI('<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9"/><path d="M12 8v13"/><path d="M12 8C10.5 4.5 7 4 7 6.3 7 7.6 9 8 12 8zM12 8c1.5-3.5 5-4 5-1.7C17 7.6 15 8 12 8z"/>'),
  checklist: _hoI('<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6"/>'),
  'arrivals-proc': _hoI('<path d="M3 3v18h18"/><path d="M7.5 16v-4M12 16V8M16.5 16v-6"/>'),
  noshow: _hoI('<circle cx="9" cy="8" r="4"/><path d="M3 21a6 6 0 0 1 12 0"/><path d="m17 8 4 4M21 8l-4 4"/>'),
  reports: _hoI('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h6"/>'),
  trends: _hoI('<path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/>'),
  pipeline: _hoI('<path d="M3 4h18l-7 8.5V19l-4 2v-8.5z"/>'),
  standards: _hoI('<path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z"/><path d="M8 7h8M8 11h5"/>'),
  history: _hoI('<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>'),
  adagio: _hoI('<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01"/><path d="M10 21v-3h4v3"/>'),
  guestmem: _hoI('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'),
  more: _hoI('<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>'),
  search: _hoI('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  handover: _hoI('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="m9 14 2 2 4-4"/>'),
  sparkle: _hoI('<path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z"/><path d="M19 3v4M17 5h4"/>'),
  feedback: _hoI('<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  keyboard: _hoI('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
  save: _hoI('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'),
  open: _hoI('<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/>'),
  team: _hoI('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18.5 14.5A6.5 6.5 0 0 1 21.5 20"/>'),
  learn: _hoI('<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/><path d="M22 10v5"/>'),
  settings: _hoI('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  menu: _hoI('<path d="M4 6h16M4 12h16M4 18h16"/>'),
};
const HOX_PANEL_ICON = { 'skip-clean': 'skipclean', skip: 'skipclean' };

function hoIcon(name) { return HOX_ICONS[HOX_PANEL_ICON[name] || name] || ''; }

function hoApplyIcons(root = document) {
  root.querySelectorAll('.nav-item[data-panel] .nav-icon, .mob-more-item[data-panel] .mob-item-icon, .mob-nav-btn[data-panel] .mob-nav-icon').forEach(el => {
    const p = el.closest('[data-panel]').dataset.panel;
    const svg = hoIcon(p);
    if (svg && !el.dataset.hoIc) { el.dataset.hoIc = '1'; el.dataset.emoji = el.textContent.trim(); el.innerHTML = svg; }
  });
  // items without a data-panel (Skip The Clean, More, Team…) by their label
  root.querySelectorAll('.nav-item:not([data-panel]) .nav-icon, .mob-more-item:not([data-panel]) .mob-item-icon, .mob-nav-btn:not([data-panel]) .mob-nav-icon').forEach(el => {
    if (el.dataset.hoIc) return;
    const t = (el.parentElement.textContent || '').toLowerCase();
    const k = /skip/.test(t) ? 'skipclean' : /more/.test(t) ? 'more' : /team/.test(t) ? 'team' : /report/.test(t) ? 'reports' : /memory/.test(t) ? 'guestmem' : null;
    if (k) { el.dataset.hoIc = '1'; el.innerHTML = HOX_ICONS[k]; }
  });
  // top bar buttons, matched by their tooltip
  const TB = [[/^search/i, 'search'], [/handover/i, 'handover'], [/what's new/i, 'sparkle'], [/feedback/i, 'feedback'], [/keyboard/i, 'keyboard'], [/export/i, 'save'], [/import/i, 'open'], [/team/i, 'team'], [/^settings/i, 'settings'], [/hide menu|menu/i, 'menu']];
  root.querySelectorAll('.topbar .icon-round').forEach(el => {
    if (el.dataset.hoIc) return;
    const hit = TB.find(([re]) => re.test(el.title || ''));
    if (!hit) return;
    el.dataset.hoIc = '1';
    const input = el.querySelector('input');
    el.innerHTML = HOX_ICONS[hit[1]];
    if (input) el.appendChild(input);
  });
}

function hoBrand() {
  // top bar: logo + wordmark + the hotel's name
  const logo = document.querySelector('.topbar .logo');
  if (logo && !logo.dataset.ho) {
    logo.dataset.ho = '1';
    const saved = (() => { try { return (JSON.parse(localStorage.getItem('ibis_settings') || '{}') || {}).hotelName; } catch (_) { return ''; } })();
    const hotel = saved || (typeof HOTEL_ID !== 'undefined' && HOTEL_ID !== 'ibis_dubai' ? '' : 'Ibis Styles Dubai');
    logo.innerHTML = `<div class="logo-mark">${hoLogo()}</div><div class="ho-word"><div class="ho-name">Hotel<b>Ops</b></div><div class="logo-name" id="hotelName">${escapeHtml(hotel)}</div></div>`;
    logo.title = 'Tap to change the hotel name';
  }
  // top bar search box (opens the Ctrl+K search)
  const center = document.getElementById('topbarDate');
  if (center && !document.getElementById('hoSearch')) {
    center.insertAdjacentHTML('afterend', `<button id="hoSearch" class="ho-search mob-hide" onclick="gsOpen()">${HOX_ICONS.search}<span>Search rooms, guests, pages…</span><kbd>Ctrl K</kbd></button>`);
  }
  // sign-in screen
  const ll = document.querySelector('.login-logo');
  if (ll && !ll.dataset.ho) {
    ll.dataset.ho = '1';
    ll.innerHTML = hoLogo();
    const t = document.querySelector('.login-title'); if (t) t.innerHTML = 'Hotel<b>Ops</b>';
    const s = document.querySelector('.login-sub'); if (s) s.textContent = 'Front office operations';
    const bg = document.querySelector('.login-bg');
    if (bg && !document.getElementById('hoHero')) bg.insertAdjacentHTML('afterbegin', `
      <div id="hoHero" class="ho-hero">
        <div class="ho-hero-logo">${hoLogo()}</div>
        <h1>Hotel<b>Ops</b></h1>
        <p>Every shift, one place. Departures, arrivals, night audit, Tourism Dirham, packages and reports, with an assistant that watches the details for you.</p>
        <ul>
          <li>${HOX_ICONS.dtcm}<span><b>DTCM and Opera tally</b> to the dirham, month after month</span></li>
          <li>${HOX_ICONS.sparkle}<span><b>Ops Brain</b> spots what's missing and fixes it with you</span></li>
          <li>${HOX_ICONS.team}<span><b>Live for the whole team</b>, on desk PCs and phones</span></li>
        </ul>
      </div>`);
  }
  hoApplyIcons();
}

document.addEventListener('DOMContentLoaded', () => {
  hoBrand();
  // pages that rebuild their menus later (role filtering, More drawer)
  setTimeout(hoApplyIcons, 1500);
  setTimeout(hoApplyIcons, 4000);
});

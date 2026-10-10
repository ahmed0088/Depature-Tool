// ═══════════════════════════════════════════════════════════
//  utils.js  —  Shared helpers used across all modules
// ═══════════════════════════════════════════════════════════

// ── Clock ─────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const t = el => document.getElementById(el);
  const h12 = typeof hoPref === 'function' && hoPref('clock12'), sec = typeof hoPref === 'function' && hoPref('clockSeconds');
  if (t('topbarTime'))  t('topbarTime').textContent  = now.toLocaleTimeString(h12 ? 'en-US' : 'en-GB', { hour: h12 ? 'numeric' : '2-digit', minute:'2-digit', second: sec ? '2-digit' : undefined, hour12: !!h12 });
  if (t('topbarDate'))  t('topbarDate').textContent  = now.toLocaleDateString('en-GB',  { weekday:'long', day:'numeric', month:'long', year:'numeric' }).toUpperCase();
  if (t('cl-date-lbl')) t('cl-date-lbl').textContent = now.toLocaleDateString('en-GB',  { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}

// ── Panel switcher ────────────────────────────────────────
/** Whether the signed-in person's role may open this page (the menu hides the others; this stops
 *  Ops Brain, home tiles and links from opening them anyway). */
function hoPanelAllowed(name) {
  if (typeof currentProfile === 'undefined' || !currentProfile || typeof ROLES === 'undefined') return true;
  const role = currentProfile.role, def = ROLES[role] || ROLES.readonly;
  if (role === 'owner' || name === 'guestmem' || (def.panels || []).includes(name)) return true;
  return !document.querySelector(`.nav-item[data-panel="${name}"]`);   // pages without a menu entry are opened from allowed ones
}
function showPanel(name) {
  if (!hoPanelAllowed(name)) { if (typeof showToast === 'function') showToast('Your role can\'t open that page. Ask a manager if you need it.', 'err'); return; }
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const panel = document.getElementById('panel-' + name);
  const nav   = document.getElementById('nav-'   + name);
  if (panel) panel.classList.add('active');
  if (nav)   nav.classList.add('active');
  if (name === 'shifts') renderShift(activeShift);
  // Read history every time Trends is opened, so a run in another panel shows up without a reload.
  if (name === 'trends' && typeof trLoad === 'function') trLoad();
  if (name === 'adagio' && typeof window._adgBoot === 'function') window._adgBoot();
  if (name === 'pipeline' && typeof gpLoadLog === 'function') gpLoadLog();
  if (name === 'home' && typeof homeRender === 'function') homeRender();
  if (name === 'history' && typeof histLoad === 'function') histLoad();
  if (name === 'settings' && typeof hoSettingsRender === 'function') hoSettingsRender();
  if (name === 'learn' && typeof learnRender === 'function') learnRender();
  if (name === 'wakeups' && typeof wkRender === 'function') wkRender();
  if (name === 'rates' && typeof rkRender === 'function') rkRender();
  if (name === 'roster' && typeof roRender === 'function') roRender();
  if (name === 'roster-build' && typeof rbRender === 'function') rbRender();
  if (typeof brTrackPanel === 'function') brTrackPanel(name);
}

// ── Clipboard ─────────────────────────────────────────────
function copyToClipboard(text, btn, label) {
  const done = (ok) => {
    if (!btn) return;
    btn.textContent = ok ? '✅ Copied!' : '⚠️ Copy failed';
    setTimeout(() => { btn.textContent = label; }, 3000);
  };
  // Modern async clipboard API (works on desktop + mobile HTTPS)
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => done(true)).catch(() => fbCopy(text, done));
  } else {
    fbCopy(text, done);
  }
}
function fbCopy(text, cb) {
  // Fallback: create off-screen textarea, force select, then copy
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    // Must be visible & in viewport for iOS to allow selection
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.01;font-size:16px;border:none;outline:none;';
    document.body.appendChild(ta);
    ta.focus();
    ta.setSelectionRange(0, ta.value.length); // explicit range — more reliable than ta.select() on iOS
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (cb) cb(ok);
  } catch (e) {
    if (cb) cb(false);
  }
}

// ── HTML escaping ─────────────────────────────────────────
// Single canonical definition — every table/card renderer that interpolates
// guest-entered text into an HTML attribute or text node must go through
// this. Escapes quotes too (not just &<>), since most call sites insert
// values into double-quoted attributes like value="${...}" where an
// unescaped `"` breaks out of the attribute and injects arbitrary markup —
// e.g. a guest name of `John" onmouseover="alert(1)` — and that injected
// markup runs for every other connected user once the data syncs.
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// For values embedded as a single-quoted JS string literal INSIDE an
// onclick="..." (or similar) HTML attribute, e.g.
// onclick="doThing('${escapeJsAttr(name)}')" — escapeHtml alone isn't
// enough there: it stops a `"` breaking out of the *attribute*, but a raw
// `'` in the data still breaks out of the *string literal* once the
// browser decodes the attribute and runs it as JS on click. JS-escape
// first (backslash/quote), then HTML-escape the result — order matters.
function escapeJsAttr(s) {
  const jsEscaped = String(s ?? '').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  return escapeHtml(jsEscaped);
}

// ── Name / source cleaners ────────────────────────────────
function parseName(raw) {
  if (!raw) return '—';
  if (raw.includes(',')) {
    const parts = raw.split(',').map(p => p.trim())
      .filter(p => p && !/^(Mr\.?|Mrs\.?|Ms\.?|Miss|MR|MRS|MS|Dr\.?)$/i.test(p));
    return parts.slice(0, 2).reverse().join(' ').trim() || raw.trim();
  }
  return raw.trim();
}
function cleanName(raw) {
  if (!raw) return '';
  raw = raw.replace(/,?\s*(Mr\.|Mrs\.|Ms\.|Miss|MR|MRS|DR\.?)\.?\s*$/i, '').trim();
  const parts = raw.split(',').map(p => p.trim()).filter(p => p);
  if (parts.length >= 2) return (parts[1] + ' ' + parts[0]).trim().toUpperCase();
  return raw.toUpperCase();
}
function cleanSource(agent, company, source) {
  let src = agent || company || source || '';
  src = src
    .replace(/BOOKING\.COM BV.*$/i, 'Booking.com')
    .replace(/AGODA COMPANY PTE LTD/i, 'Agoda')
    .replace(/EXPEDIA\.COM.*/i, 'Expedia')
    .replace(/\s*\(.*?\)/g, '')
    .trim();
  // No agent/company/source on the booking does NOT mean the guest walked in —
  // it almost always means a direct/ALL App booking with no third-party agent.
  // Only the literal "walk in" text (from Opera) should ever be labelled Walk-in.
  if (!src) return 'ALL App';
  if (/walk[\s-]?in/i.test(src)) return 'Walk-in';
  return src;
}

// Buckets a raw source string into a filterable category. Shared by the
// Arrivals and Purpose of Stay panels so "Walk-in" / "ALL App" / "OTA" mean
// exactly the same thing everywhere in the app.
const SOURCE_CATEGORIES = {
  walkin:    { label: 'Walk-in',   color: 'amber'  },
  allapp:    { label: 'ALL App',   color: 'green'  },
  ota:       { label: 'OTA',       color: 'blue'   },
  corporate: { label: 'Corporate', color: 'purple' },
  other:     { label: 'Other',     color: 'teal'   },
};
function sourceCategory(src) {
  const s = (src || '').trim();
  if (!s) return 'allapp';
  if (/walk[\s-]?in/i.test(s)) return 'walkin';
  if (/\ball\b|accor/i.test(s)) return 'allapp';
  if (/booking\.com|agoda|expedia|hotels\.com|trip\.com|traveloka|makemytrip/i.test(s)) return 'ota';
  if (/\bcorp|company|corporate\b/i.test(s)) return 'corporate';
  return 'other';
}

// Live-updates a row's source-category badge as the user types, without a
// full table re-render (keeps their cursor/focus exactly where it is).
function _updateSrcBadge(elId, value) {
  const el = document.getElementById(elId);
  if (!el) return;
  const cat = sourceCategory(value);
  el.className   = 'src-badge ' + cat;
  el.textContent = SOURCE_CATEGORIES[cat].label;
}

// ── CSV line parser ───────────────────────────────────────
function parseCSVLine(line) {
  const res = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { res.push(cur.trim()); cur = ''; }
    else { cur += c; }
  }
  res.push(cur.trim());
  return res;
}

// ── Date formatters ───────────────────────────────────────
function fmtDate(d) {
  if (!d) return '—';
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}
function fmtDateExcel(d) {
  if (!d) return '';
  return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
}
function parseOperaDate(s) {
  if (!s) return null;
  const p = s.trim().split(/[-\/]/);
  if (p.length !== 3) return null;
  const months = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };
  const day    = parseInt(p[0]);
  const yr     = parseInt(p[2]) + (parseInt(p[2]) < 100 ? 2000 : 0);
  const monIdx = months[p[1].toUpperCase()];
  if (monIdx !== undefined) return new Date(yr, monIdx, day);
  return new Date(yr, parseInt(p[1]) - 1, day);
}
function parseExcelDate(s) {
  if (!s) return null;
  const p = s.split('/');
  if (p.length === 3) return new Date(parseInt(p[2]), parseInt(p[0]) - 1, parseInt(p[1]));
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
function parseBalance(s) {
  if (!s) return 0;
  return parseFloat(String(s).replace(/,/g, '')) || 0;
}
function sameDate(a, b) {
  if (!a || !b) return !a && !b;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function fmtBalance(n) {
  if (n === 0) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });
}

// ── Toast notification ────────────────────────────────────
function showToast(msg, type = 'ok') {
  let toast = document.getElementById('appToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'appToast';
    // Announced to a screen reader without stealing focus — "polite"
    // waits for the user to finish what they're saying/doing.
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);padding:10px 20px;border-radius:10px;font-family:var(--mono);font-size:0.72rem;z-index:9999;transition:opacity 0.3s;pointer-events:none;';
    document.body.appendChild(toast);
  }
  const colors = { ok:'rgba(62,207,142,0.9)', err:'rgba(240,107,122,0.9)', info:'rgba(90,180,232,0.9)' };
  toast.style.background = colors[type] || colors.info;
  toast.style.color = '#0a0c10';
  toast.style.opacity = '1';
  toast.textContent = msg;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

// ── Undo toast ────────────────────────────────────────────
// Generic "soft delete" pattern: perform the action immediately,
// but show a toast with an Undo button for a few seconds.
// Usage:
//   showUndoToast('Task deleted', () => { restore the item });
let _undoTimer = null;
function showUndoToast(msg, undoFn, timeoutMs = 6000) {
  let toast = document.getElementById('undoToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'undoToast';
    toast.className = 'undo-toast';
    document.body.appendChild(toast);
  }
  clearTimeout(_undoTimer);
  let remaining = Math.round(timeoutMs / 1000);
  const render = () => {
    toast.innerHTML = `
      <span class="undo-toast-msg">${msg}</span>
      <button class="undo-toast-btn" id="undoToastBtn">↺ Undo</button>
      <span class="undo-toast-timer">${remaining}s</span>`;
    document.getElementById('undoToastBtn').onclick = () => {
      clearTimeout(_undoTimer);
      toast.classList.remove('show');
      if (typeof undoFn === 'function') undoFn();
    };
  };
  render();
  toast.classList.add('show');
  const tick = setInterval(() => {
    remaining -= 1;
    const t = toast.querySelector('.undo-toast-timer');
    if (t) t.textContent = remaining + 's';
    if (remaining <= 0) clearInterval(tick);
  }, 1000);
  _undoTimer = setTimeout(() => {
    clearInterval(tick);
    toast.classList.remove('show');
  }, timeoutMs);
}

// ── Theme ─────────────────────────────────────────────────
// Each theme sits on one of the three base themes (night-ops dark, opera light, midnight) and adds its own skin on top.
const HO_THEMES = {
  'night-ops': { label: 'Night Ops', emoji: '🌙', base: 'night-ops', bg: '#0b0e14', a: '#eab94a', btn: '#080b10' },
  'ios':       { label: 'iPhone', emoji: '📱', base: 'opera', skin: 'ios', bg: '#f2f2f7', a: '#007aff', btn: '#ffffff' },
  'ios-dark':  { label: 'iPhone Dark', emoji: '🖤', base: 'night-ops', skin: 'ios-dark', bg: '#000000', a: '#0a84ff', btn: '#ffffff' },
  'titanium':  { label: 'Titanium', emoji: '🪨', base: 'night-ops', skin: 'titanium', bg: '#1b1a18', a: '#c9a27e', btn: '#1b1a18' },
  'ocean':     { label: 'Ocean', emoji: '🌊', base: 'midnight', skin: 'ocean', bg: '#06161f', a: '#2dd4bf', btn: '#04201d' },
  'opera':     { label: 'Opera', emoji: '☀️', base: 'opera', bg: '#f4f5f7', a: '#c74634', btn: '#ffffff' },
  'midnight':  { label: 'Midnight', emoji: '🌌', base: 'midnight', bg: '#0b1020', a: '#818cf8', btn: '#ffffff' },
  'catppuccin': { label: 'Catppuccin', emoji: '🐱', base: 'midnight', skin: 'catppuccin', bg: '#1e1e2e', a: '#cba6f7', btn: '#1e1e2e' },
  'latte': { label: 'Latte', emoji: '🥛', base: 'opera', skin: 'latte', bg: '#eff1f5', a: '#8839ef', btn: '#ffffff' },
  'nord': { label: 'Nord', emoji: '🧊', base: 'midnight', skin: 'nord', bg: '#2e3440', a: '#88c0d0', btn: '#2e3440' },
  'dracula': { label: 'Dracula', emoji: '🧛', base: 'midnight', skin: 'dracula', bg: '#282a36', a: '#bd93f9', btn: '#1e1f29' },
  'tokyo': { label: 'Tokyo Night', emoji: '🌃', base: 'midnight', skin: 'tokyo', bg: '#1a1b26', a: '#7aa2f7', btn: '#16161e' },
  'rosepine': { label: 'Rosé Pine', emoji: '🌹', base: 'midnight', skin: 'rosepine', bg: '#1f1d2e', a: '#ebbcba', btn: '#191724' },
};
function hoThemeName() { return document.documentElement.getAttribute('data-skin') || document.documentElement.getAttribute('data-theme') || 'night-ops'; }
function setTheme(name, btn, noSave) {
  const T = HO_THEMES[name] || HO_THEMES['night-ops']; if (!HO_THEMES[name]) name = 'night-ops';
  document.documentElement.setAttribute('data-theme', T.base);
  if (T.skin) document.documentElement.setAttribute('data-skin', T.skin); else document.documentElement.removeAttribute('data-skin');
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', T.bg);
  hoThemeMenuSync();
  document.querySelectorAll('.theme-btn, .mob-theme-btn').forEach(b => b.classList.remove('active'));
  // sync login theme buttons too
  document.querySelectorAll('.login-theme-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.t === name);
  });
  // sync the mobile drawer's theme buttons too — they share data-t
  document.querySelectorAll('.mob-theme-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.t === name);
  });
  const target = btn || document.querySelector(`.theme-btn[data-t="${name}"]`);
  if (target) target.classList.add('active');
  // each person's own choice: this device, and their profile for their other devices (never the whole hotel)
  if (!noSave) {
    try { localStorage.setItem('ho_theme_v1', name); } catch (_) {}
    if (typeof saveThemeToProfile === 'function') saveThemeToProfile(name);
  }
  // sync login screen colors if visible
  if (typeof _applyLoginTheme === 'function') _applyLoginTheme(name);
}

/** The top bar's one theme button, and its menu of every theme. */
function hoThemeMenuSync() {
  const T = HO_THEMES[hoThemeName()] || HO_THEMES['night-ops'], b = document.getElementById('hoThemeBtn');
  if (b) b.innerHTML = `<span class="theme-dot" style="background:${T.a};box-shadow:0 0 0 2px ${T.bg}, 0 0 0 3px ${T.a}55"></span><span>${T.label}</span>`;
}
function hoThemeMenu(btn) {
  const old = document.getElementById('hoThemePop'); if (old) { old.remove(); return; }
  const cur = hoThemeName(), pop = document.createElement('div'); pop.id = 'hoThemePop'; pop.className = 'ho-theme-pop'; pop.setAttribute('role', 'menu');
  pop.innerHTML = '<div class="ho-tp-hd">Theme</div>' + Object.entries(HO_THEMES).map(([k, t]) => `<button role="menuitemradio" aria-checked="${k === cur}" class="${k === cur ? 'on' : ''}" onclick="setTheme('${k}');document.getElementById('hoThemePop')?.remove()"><span class="ho-tp-sw" style="background:${t.bg}"><i style="background:${t.a}"></i></span>${t.label}${k === cur ? '<b>✓</b>' : ''}</button>`).join('');
  document.body.appendChild(pop);
  const r = btn.getBoundingClientRect(), w = 220; pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px'; pop.style.top = (r.bottom + 8) + 'px';
  setTimeout(() => document.addEventListener('click', function off(e) { if (!pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) { pop.remove(); document.removeEventListener('click', off); } }), 0);
}
document.addEventListener('DOMContentLoaded', () => setTimeout(hoThemeMenuSync, 50));
function toggleTheme() {
  const cur    = hoThemeName();
  const themes = Object.keys(HO_THEMES);
  setTheme(themes[(themes.indexOf(cur) + 1) % themes.length]);
}

// ── Sidebar collapse ──────────────────────────────────────
function toggleSidenav() {
  const nav = document.querySelector('.sidenav');
  if (!nav) return;
  const collapsed = nav.classList.toggle('collapsed');
  try { localStorage.setItem('sidenavCollapsed', collapsed ? '1' : '0'); } catch (_) {}
  const btn = document.getElementById('sidenavToggleBtn');
  if (btn) btn.title = collapsed ? 'Show menu' : 'Hide menu';
}
(function _restoreSidenavState() {
  try { if (localStorage.getItem('sidenavCollapsed') !== '1') return; } catch (_) { return; }
  const nav = document.querySelector('.sidenav');
  if (nav) nav.classList.add('collapsed');
  const btn = document.getElementById('sidenavToggleBtn');
  if (btn) btn.title = 'Show menu';
})();

// ── Hotel name ────────────────────────────────────────────
function editHotel() {
  const el = document.getElementById('hotelName');
  const n  = prompt('Hotel name:', el.textContent);
  if (n && n.trim()) {
    el.textContent = n.trim();
    saveSettings({ hotelName: n.trim() });
  }
}

// ── Spinner helper ────────────────────────────────────────
function setSpinner(id, on) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = on ? '<div class="spinner"></div> ' : '';
}

// ── Busy / progress ───────────────────────────────────────
//  Shared feedback for jobs slow enough to look frozen — parsing a
//  15-page PDF, an XML roster, a large Excel export.
//
//  busyStart('Reading the Opera log');          // indeterminate
//  busyStep(3, 15, 'page 3 of 15');             // determinate
//  busyDone();
//
//  The markup is created on first use and reused, so panels don't
//  need to carry their own spinner. Always pair a busyStart with a
//  busyDone in a finally block — a stuck overlay blocks the whole UI.
let _busyEls = null;

function _busyEnsure() {
  if (_busyEls) return _busyEls;
  const top = document.createElement('div');
  top.id = 'appTopProgress';
  top.innerHTML = '<i></i>';

  const ov = document.createElement('div');
  ov.id = 'busyOverlay';
  ov.innerHTML = `
    <div class="busy-card">
      <div class="busy-ring"></div>
      <div class="busy-title"></div>
      <div class="busy-detail"></div>
      <div class="busy-bar"><i></i></div>
      <div class="busy-rows"><span></span><span></span><span></span><span></span></div>
    </div>`;

  document.body.appendChild(top);
  document.body.appendChild(ov);
  _busyEls = {
    top, topBar: top.querySelector('i'), ov,
    title:  ov.querySelector('.busy-title'),
    detail: ov.querySelector('.busy-detail'),
    bar:    ov.querySelector('.busy-bar'),
    barFill:ov.querySelector('.busy-bar > i'),
  };
  return _busyEls;
}

function busyStart(title, detail) {
  const e = _busyEnsure();
  e.title.textContent  = title || 'Working…';
  e.detail.textContent = detail || '';
  e.barFill.style.width = '0%';
  e.bar.style.display = 'none';        // shown once we know a total
  e.ov.classList.add('on');
  e.top.classList.add('on', 'indet');
  e.topBar.style.width = '';
}

// done/total drives both bars; omit total to just update the caption.
function busyStep(done, total, detail) {
  const e = _busyEnsure();
  if (detail != null) e.detail.textContent = detail;
  if (!total) return;
  const pct = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
  e.top.classList.remove('indet');
  e.bar.style.display = '';
  e.barFill.style.width = pct + '%';
  e.topBar.style.width  = pct + '%';
}

function busyDetail(text) { _busyEnsure().detail.textContent = text || ''; }

function busyDone() {
  if (!_busyEls) return;
  const e = _busyEls;
  e.topBar.style.width = '100%';
  e.ov.classList.remove('on');
  setTimeout(() => {
    e.top.classList.remove('on', 'indet');
    e.topBar.style.width = '0%';
  }, 260);
}

// Lets the browser paint the overlay before a synchronous parse blocks
// the main thread — without this the spinner never actually appears.
function busyPaint() { return new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))); }

// ── Keyboard + screen-reader access for icon controls ─────
//  The topbar and drawer icons are <div onclick> — clickable with a
//  mouse but invisible to Tab and to a screen reader. Rather than
//  rewrite every one as a <button>, mark them up as buttons at boot
//  and let a single delegated handler fire them on Enter/Space, the
//  keys a real button responds to.
function _a11yUpgradeIconButtons(root) {
  (root || document).querySelectorAll('.icon-round, .theme-btn, .fchip, .vt-btn').forEach(el => {
    if (el.tagName === 'BUTTON' || el.dataset.a11y) return;
    el.dataset.a11y = '1';
    if (!el.hasAttribute('role'))     el.setAttribute('role', 'button');
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    // Icon-only controls have no text for a screen reader to read out;
    // the tooltip already says what they do, so reuse it.
    if (!el.hasAttribute('aria-label') && el.title) el.setAttribute('aria-label', el.title);
  });
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target;
  if (!el || el.getAttribute?.('role') !== 'button' || el.tagName === 'BUTTON') return;
  e.preventDefault();
  el.click();
});

document.addEventListener('DOMContentLoaded', () => {
  _a11yUpgradeIconButtons();
  // Filter chips and view toggles are re-rendered whenever a panel loads
  // data, so upgrade whatever appears later as well. Batched on a frame
  // to avoid doing this once per node during a big table render.
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; _a11yUpgradeIconButtons(); });
  }).observe(document.body, { childList: true, subtree: true });
});

// ── App version + forced update ───────────────────────────
//  Phones keep the whole app in a service-worker cache, so a fix can be
//  live on the server while a colleague is still running last week's
//  copy — and the bug they report has usually already been fixed. This
//  puts the running version on screen so it can be read out, and gives
//  a one-tap way to drop the cache and reload.
//
//  Keep in step with CACHE_NAME in sw.js.
const APP_VERSION = 'v218';

async function appForceUpdate() {
  if (!confirm('Reload the app and fetch the newest version?')) return;
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (err) {
    console.warn('[update] cache clear failed:', err);
  }
  // Cache-busting query so the HTML itself isn't served from the browser
  // cache that we just stepped around.
  location.replace(location.pathname + '?v=' + Date.now());
}

document.addEventListener('DOMContentLoaded', () => {
  ['appVersionPill', 'mobVersionLabel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = APP_VERSION;
  });
});

// ═══════════════════════════════════════════════════════════
//  Styled .xlsx writer
//
//  SheetJS's community build parses cell styles but does not WRITE them —
//  a `cell.s` assignment is accepted and silently dropped, producing a
//  workbook whose styles.xml holds nothing but the two mandatory default
//  fills. Every coloured export in this app was therefore plain white.
//
//  This builds the OOXML by hand instead: a stored (uncompressed) ZIP with
//  a real styles.xml, so fills and fonts survive into Excel. Uncompressed
//  keeps it dependency-free — these sheets are a few hundred rows, so the
//  size difference does not matter.
// ═══════════════════════════════════════════════════════════

const _CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function _crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = _CRC32_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function _xmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    // Control characters are illegal in XML 1.0 and make Excel refuse the file.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function _colName(n) {                    // 0 -> A, 26 -> AA
  let s = '';
  n += 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; }
  return s;
}

// Builds a stored-ZIP archive from [{name, data:Uint8Array}] and returns a Blob.
function _zipStore(files) {
  const enc = [];
  let offset = 0;
  const central = [];
  const u16 = n => [n & 0xFF, (n >>> 8) & 0xFF];
  const u32 = n => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];

  files.forEach(f => {
    const nameBytes = new TextEncoder().encode(f.name);
    const crc  = _crc32(f.data);
    const size = f.data.length;
    const local = [].concat(
      u32(0x04034B50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0));
    enc.push(new Uint8Array(local), nameBytes, f.data);
    central.push([].concat(
      u32(0x02014B50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(nameBytes.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset)));
    central[central.length - 1]._name = nameBytes;
    offset += local.length + nameBytes.length + size;
  });

  const cdStart = offset;
  central.forEach(c => { enc.push(new Uint8Array(c), c._name); offset += c.length + c._name.length; });
  enc.push(new Uint8Array([].concat(
    u32(0x06054B50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(offset - cdStart), u32(cdStart), u16(0))));

  let total = 0; enc.forEach(a => total += a.length);
  const out = new Uint8Array(total);
  let p = 0; enc.forEach(a => { out.set(a, p); p += a.length; });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// styles: array of { bold, color, fill, align } — index 0 is the default.
function _stylesXml(styles) {
  const fonts = styles.map(s =>
    `<font><sz val="10"/><name val="Arial"/>${s.bold ? '<b/>' : ''}${s.color ? `<color rgb="FF${s.color}"/>` : ''}</font>`);
  // fills 0 and 1 are reserved by the format and must be none/gray125
  const fills = ['<fill><patternFill patternType="none"/></fill>',
                 '<fill><patternFill patternType="gray125"/></fill>']
    .concat(styles.map(s => s.fill
      ? `<fill><patternFill patternType="solid"><fgColor rgb="FF${s.fill}"/><bgColor indexed="64"/></patternFill></fill>`
      : '<fill><patternFill patternType="none"/></fill>'));
  const xfs = styles.map((s, i) =>
    `<xf numFmtId="0" fontId="${i}" fillId="${i + 2}" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"${
      s.align ? ` applyAlignment="1"><alignment horizontal="${s.align}"/></xf>` : '/>'}`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="${fonts.length}">${fonts.join('')}</fonts>
<fills count="${fills.length}">${fills.join('')}</fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

/**
 * Writes a genuinely styled .xlsx and hands it to the browser.
 *   rows    — 2D array of cell values
 *   styleAt — (rowIndex, colIndex) => style index into `styles`
 *   styles  — [{bold,color,fill,align}], index 0 used when styleAt returns nothing
 *   cols    — optional array of column widths (characters)
 */
function writeStyledXlsx(filename, sheetName, rows, styleAt, styles, cols) {
  const enc = s => new TextEncoder().encode(s);
  const sheetRows = rows.map((row, r) => {
    const cells = row.map((v, c) => {
      const ref = _colName(c) + (r + 1);
      const si  = (styleAt ? (styleAt(r, c) || 0) : 0);
      if (v === '' || v == null) return `<c r="${ref}" s="${si}"/>`;
      if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}" s="${si}"><v>${v}</v></c>`;
      return `<c r="${ref}" s="${si}" t="inlineStr"><is><t xml:space="preserve">${_xmlEsc(v)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');

  const colsXml = cols && cols.length
    ? `<cols>${cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${colsXml}<sheetData>${sheetRows}</sheetData></worksheet>`;

  const files = [
    { name: '[Content_Types].xml', data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`) },
    { name: '_rels/.rels', data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: 'xl/workbook.xml', data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${_xmlEsc(sheetName).slice(0,31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: 'xl/styles.xml', data: enc(_stylesXml(styles)) },
    { name: 'xl/worksheets/sheet1.xml', data: enc(sheet) },
  ];

  const blob = _zipStore(files);
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Swipeable header button rows: mark the sides where more buttons are hidden (pro.css fades them)
(function () {
  const mark = el => { const more = el.scrollWidth - el.clientWidth > 4; el.classList.toggle('hd-more-r', more && el.scrollLeft + el.clientWidth < el.scrollWidth - 4); el.classList.toggle('hd-more-l', more && el.scrollLeft > 4); };
  const all = () => document.querySelectorAll('.page-hd-actions').forEach(mark);
  document.addEventListener('scroll', e => { if (e.target && e.target.classList && e.target.classList.contains('page-hd-actions')) mark(e.target); }, true);
  window.addEventListener('resize', () => setTimeout(all, 50));
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(all, 300);
    // a page opening, or its buttons appearing, can change what fits
    new MutationObserver(() => { clearTimeout(all._t); all._t = setTimeout(all, 120); }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  });
})();

// ── Sideways rows on a computer ───────────────────────────
// Rows of buttons and chips that scroll sideways (Ops Brain suggestions, page tabs, filters…) move with a
// finger on a phone, but a mouse wheel only scrolls up and down. Here the wheel scrolls such a row sideways
// while it still can, and a row can be dragged with the mouse. Everywhere in the app, for every such row.
(function () {
  const sideways = el => {
    for (let n = el; n && n !== document.body && n.nodeType === 1; n = n.parentElement) {
      // only a low row (chips, tabs, buttons): a wide table keeps the wheel for scrolling the page down
      if (n.scrollWidth > n.clientWidth + 2 && n.clientHeight <= 120) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll') return n;
      }
    }
    return null;
  };
  document.addEventListener('wheel', e => {
    if (e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;   // trackpad sideways and zoom work already
    const row = sideways(e.target); if (!row) return;
    // a tall box that scrolls both ways (a table) keeps the wheel for up and down
    if (row.scrollHeight > row.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(row).overflowY)) return;
    const max = row.scrollWidth - row.clientWidth;
    if ((e.deltaY > 0 && row.scrollLeft >= max - 1) || (e.deltaY < 0 && row.scrollLeft <= 0)) return;   // at the end: the page scrolls on
    row.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 32 : 1);
    e.preventDefault();
  }, { passive: false });
  // drag with the mouse
  let drag = null;
  document.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('input,textarea,select,[contenteditable]')) return;
    const row = sideways(e.target); if (!row) return;
    drag = { row, x: e.clientX, left: row.scrollLeft, moved: false };
  });
  document.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 6) return;
    drag.moved = true; drag.row.scrollLeft = drag.left - dx; drag.row.style.cursor = 'grabbing';
  });
  const end = () => { if (!drag) return; const d = drag; drag = null; d.row.style.cursor = ''; if (d.moved) { const stop = ev => { ev.stopPropagation(); ev.preventDefault(); }; document.addEventListener('click', stop, { capture: true, once: true }); setTimeout(() => document.removeEventListener('click', stop, true), 50); } };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
})();

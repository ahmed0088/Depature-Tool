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
  const role = currentProfile.role, def = typeof myRoleDef === 'function' ? myRoleDef() : (ROLES[role] || ROLES.readonly);   // role rules + this person's own access
  if (role === 'owner' || name === 'guestmem' || (def.panels || []).includes(name)) return true;
  return !document.querySelector(`.nav-item[data-panel="${name}"]`);   // pages without a menu entry are opened from allowed ones
}
function showPanel(name) {
  if (!hoPanelAllowed(name)) { if (typeof showToast === 'function') showToast('Not available for your role', 'err'); return; }
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const panel = document.getElementById('panel-' + name);
  const nav   = document.getElementById('nav-'   + name);
  if (panel) panel.classList.add('active');
  if (nav)   nav.classList.add('active');
  if (name === 'shifts') {
    // open on the shift you are working: the afternoon and night teams used to land on Morning. A tab you pick stays until the next shift starts.
    try { const cur = typeof hoShiftNow === 'function' ? hoShiftNow().key : ''; if (cur && typeof SHIFTS !== 'undefined' && SHIFTS[cur] && cur !== window._stAutoKey) { window._stAutoKey = cur; activeShift = cur; } } catch (_) {}
    renderShift(activeShift);
    document.querySelectorAll('.shift-tab').forEach(t => t.classList.toggle('active', t.dataset.shift === activeShift));
    const rb = document.getElementById('shiftResetBtn'); if (rb && typeof SHIFTS !== 'undefined' && SHIFTS[activeShift]) rb.textContent = '↺ Reset ' + SHIFTS[activeShift].label;
  }
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
// ── Balances to look at: OTA bookings with money still open, and high balances ──
/** a booking from an online travel agency (Booking.com, Agoda, Expedia …): usually prepaid, so an open balance there needs a look */
const HO_OTA_RE = /booking\.?com|\bagoda|expedia|hotels\.com|\btrip\.?com|\bctrip|hotelbeds|webbeds|\bdotw\b|\bhrs\b|airbnb|traveloka|makemytrip|goibibo|cleartrip|\byatra|almosafer|tajawal|\bwego\b|musafir|despegar|\btiket|hostelworld|lastminute|\bopodo|edreams|priceline|\borbitz|travelocity|\btbo\b|rakuten|hotelopia|\bota\b/i;
function hoIsOta(...parts) { return parts.some(p => HO_OTA_RE.test(String(p || ''))); }
/** "high balance" starts at this many AED (each device remembers its own; 500 until changed) */
function hoHighBal() { try { const v = +localStorage.getItem('ho_hibal_v1'); return v > 0 ? v : 500; } catch (_) { return 500; } }
function hoSetHighBal(v) { v = Math.round(+String(v).replace(/[^\d.]/g, '')); if (!(v > 0)) return false; try { localStorage.setItem('ho_hibal_v1', String(v)); } catch (_) {} return true; }
/** ask for a new "high balance" amount; true when it changed */
function hoAskHighBal() { const v = typeof prompt === 'function' ? prompt('Show balances of at least how many AED?', String(hoHighBal())) : null; return v != null && hoSetHighBal(v); }

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
  if (/^\d{4}$/.test(p[0])) return new Date(+p[0], +p[1] - 1, +p[2]);   // "2026-10-20" (a room added by hand): read as 2020-Apr before
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
  // an undo / redo that is running right now does not offer its own Undo
  if (typeof hoUndo !== 'undefined' && hoUndo.busy()) return;
  let toast = document.getElementById('undoToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'undoToast';
    toast.className = 'undo-toast';
    document.body.appendChild(toast);
  }
  clearTimeout(_undoTimer);
  clearInterval(showUndoToast._tick);   // a new toast replaces the old countdown
  let remaining = Math.round(timeoutMs / 1000);
  // Runs once only: from this toast's button or from Ctrl+Z (undo.js), whichever comes first.
  let undone = false;
  const runUndo = () => { if (undone) return; undone = true; if (typeof undoFn === 'function') return undoFn(); };
  const entry = typeof hoUndo !== 'undefined' ? hoUndo.push(String(msg), () => {
    if (toast._undoEntry === entry) { clearTimeout(_undoTimer); toast.classList.remove('show'); }
    return runUndo();
  }, { quiet: true }) : null;
  toast._undoEntry = entry;
  const render = () => {
    toast.innerHTML = `
      <span class="undo-toast-msg">${escapeHtml(String(msg))}</span>
      <button class="undo-toast-btn" id="undoToastBtn">↺ Undo</button>
      <span class="undo-toast-timer">${remaining}s</span>`;
    document.getElementById('undoToastBtn').onclick = () => {
      clearTimeout(_undoTimer);
      toast.classList.remove('show');
      if (entry) hoUndo.remove(entry);
      runUndo();
    };
  };
  render();
  toast.classList.add('show');
  const tick = showUndoToast._tick = setInterval(() => {
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
  'paper': { label: 'Paper', emoji: '📄', base: 'opera', skin: 'paper', bg: '#eef0f2', a: '#0f766e', btn: '#ffffff' },
  'sky': { label: 'Sky', emoji: '🌤', base: 'opera', skin: 'sky', bg: '#e3eefb', a: '#0284c7', btn: '#ffffff' },
  'mint': { label: 'Mint', emoji: '🌿', base: 'opera', skin: 'mint', bg: '#e2f2ea', a: '#059669', btn: '#ffffff' },
  'sakura': { label: 'Sakura', emoji: '🌸', base: 'opera', skin: 'sakura', bg: '#fae6ee', a: '#db2777', btn: '#ffffff' },
  'sand': { label: 'Desert', emoji: '🏜', base: 'opera', skin: 'sand', bg: '#f1e7d6', a: '#b45309', btn: '#ffffff' },
  // App styles (themes-pro.css): the whole app dressed like an app people know
  'notes':    { label: 'Apple Notes', emoji: '📝', group: 'style', base: 'opera', skin: 'notes', bg: '#f6f5f0', a: '#e0a800', btn: '#1c1c1e' },
  'whatsapp': { label: 'WhatsApp', emoji: '💬', group: 'style', base: 'opera', skin: 'whatsapp', bg: '#efeae2', a: '#00a884', btn: '#ffffff' },
  'telegram': { label: 'Telegram', emoji: '✈️', group: 'style', base: 'opera', skin: 'telegram', bg: '#dfe8cf', a: '#3390ec', btn: '#ffffff' },
  'discord':  { label: 'Discord', emoji: '🎧', group: 'style', base: 'night-ops', skin: 'discord', bg: '#313338', a: '#5865f2', btn: '#ffffff' },
  'gaming':   { label: 'Gaming', emoji: '🕹', group: 'style', base: 'night-ops', skin: 'gaming', bg: '#05060d', a: '#00f0ff', btn: '#05060d', font: 'Orbitron:wght@600;800&family=Rajdhani:wght@500;600;700' },
  'classic':  { label: 'Classic', emoji: '🏛', group: 'style', base: 'opera', skin: 'classic', bg: '#f4efe4', a: '#1f3a5f', btn: '#fffdf8' },
  'pro':      { label: 'Pro', emoji: '⚡', group: 'style', base: 'night-ops', skin: 'pro', bg: '#000000', a: '#ededed', btn: '#000000' },
  'study':    { label: 'Study', emoji: '📚', group: 'style', base: 'opera', skin: 'study', bg: '#f7f8fc', a: '#5b5bd6', btn: '#ffffff', font: 'Nunito:wght@500;600;700;800' },
  'notepad':  { label: 'Notepad', emoji: '🗒', group: 'style', base: 'opera', skin: 'notepad', bg: '#f3f3f3', a: '#005fb8', btn: '#ffffff' },
  'found':    { label: 'Found', emoji: '🕷', group: 'style', base: 'night-ops', skin: 'found', bg: '#1129e2', a: '#ffffff', btn: '#1129e2' },
  'atlas':    { label: 'Myth Atlas', emoji: '📜', group: 'style', base: 'opera', skin: 'atlas', bg: '#ebe1cd', a: '#b4532a', btn: '#ffffff', font: 'Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500' },
  'atlas-dusk': { label: 'Atlas Dusk', emoji: '🌘', group: 'style', base: 'night-ops', skin: 'atlas-dusk', bg: '#17120d', a: '#e08a4f', btn: '#17120d', font: 'Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500' },
  'grove':    { label: 'Heritage Grove', emoji: '🌿', group: 'style', base: 'opera', skin: 'grove', bg: '#EAE3DE', a: '#175A67', btn: '#EAE3DE', font: 'Cormorant+Garamond:wght@400;500;600&family=Poppins:wght@300;400;500;600' },
  'stratum':  { label: 'Stratum', emoji: '🏛', group: 'style', base: 'night-ops', skin: 'stratum', bg: '#04070d', a: '#e8d1cb', btn: '#15131b', font: 'Chakra+Petch:wght@600;700&family=Inter:wght@400;500;700' },
  'orbit':    { label: 'Orbit', emoji: '🪐', group: 'style', base: 'night-ops', skin: 'orbit', bg: '#05060a', a: '#9b8cff', btn: '#ffffff' },
  'orvante':  { label: 'Orvante', emoji: '◼️', group: 'style', base: 'opera', skin: 'orvante', bg: '#dadada', a: '#111111', btn: '#111111', font: 'Archivo:wght@400;500;600;700;800;900' },
  'redwhite': { label: 'Redline White', emoji: '🔴', group: 'style', base: 'opera', skin: 'redwhite', bg: '#fbf6f6', a: '#d0182c', btn: '#ffffff', font: 'Montserrat:wght@500;600;700;800;900' },
  'redline':  { label: 'Redline', emoji: '🪐', group: 'style', base: 'night-ops', skin: 'redline', bg: '#2a0d04', a: '#e8283c', btn: '#ffffff', font: 'Montserrat:wght@300;400;500;600;800;900' },
};
/** a style's own font, loaded only when someone picks it */
function hoThemeFont(T) {
  if (!T || !T.font || document.getElementById('hoFont-' + T.skin)) return;
  const l = document.createElement('link'); l.id = 'hoFont-' + T.skin; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=' + T.font + '&display=swap'; document.head.appendChild(l);
}
function hoThemeName() { return document.documentElement.getAttribute('data-skin') || document.documentElement.getAttribute('data-theme') || 'night-ops'; }
function setTheme(name, btn, noSave) {
  const T = HO_THEMES[name] || HO_THEMES['night-ops']; if (!HO_THEMES[name]) name = 'night-ops';
  document.documentElement.setAttribute('data-theme', T.base);
  if (T.skin) document.documentElement.setAttribute('data-skin', T.skin); else document.documentElement.removeAttribute('data-skin');
  if (T.group) document.documentElement.setAttribute('data-skin-group', T.group); else document.documentElement.removeAttribute('data-skin-group');
  hoThemeFont(T);
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
  hoApplyDark();   // 🌙 dark mode stays on across theme changes (a light theme turns dark, a dark one stays as it is)
  // sync login screen colors if visible
  if (typeof _applyLoginTheme === 'function') _applyLoginTheme(name);
}

// ── 🌙 Dark mode for every theme ──────────────────────────
// A light theme keeps its style (fonts, corners, shapes, its own accent colour) and swaps its colours for dark ones: the base becomes
// Night Ops underneath (html[data-dark="1"] + themes-pro.css "Dark mode for every theme"). Themes that are dark already stay as they are.
const HO_DARK_KEY = 'ho_dark_v1';
function hoDarkOn() { try { return localStorage.getItem(HO_DARK_KEY) === '1'; } catch (_) { return false; } }
// 🌆 dark by itself in the evening (19:00–07:00), only if you switch it on
const HO_DARK_AUTO_KEY = 'ho_dark_auto_v1';
function hoDarkAuto() { try { return localStorage.getItem(HO_DARK_AUTO_KEY) === '1'; } catch (_) { return false; } }
/** the evening and night hours (pure) */
function hoIsEvening(d) { const h = (d || new Date()).getHours(); return h >= 19 || h < 7; }
/** dark right now? your switch, or the evening when "dark in the evening" is on (pure) */
function hoDarkNow(manual, auto, d) { return !!manual || (!!auto && hoIsEvening(d)); }
/** an accent made readable on a dark page (pure): '#175A67' → a lighter teal; light accents stay */
function hoDarkAccent(hex) {
  const m = String(hex || '').trim().match(/^#?([0-9a-f]{6})$/i); if (!m) return null;
  let [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  const lum = (r, g, b) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  for (let k = 0; k < 20 && (lum(r, g, b) + .05) / (lum(14, 17, 22) + .05) < 4.5; k++) { r += (255 - r) * .15; g += (255 - g) * .15; b += (255 - b) * .15; }   // lighter until it reads on the dark page
  r = Math.round(r); g = Math.round(g); b = Math.round(b);
  const L = lum(r, g, b), cWhite = 1.05 / (L + .05), cDark = (L + .05) / (lum(17, 19, 24) + .05);   // the text on it: whichever reads better
  return { a: `rgb(${r}, ${g}, ${b})`, bg: `rgba(${r}, ${g}, ${b}, .14)`, border: `rgba(${r}, ${g}, ${b}, .45)`, on: cDark >= cWhite ? '#111318' : '#ffffff' };
}
function hoApplyDark() {
  const H = document.documentElement, name = hoThemeName(), T = HO_THEMES[name] || HO_THEMES['night-ops'], light = T.base === 'opera';
  const on = hoDarkNow(hoDarkOn(), hoDarkAuto()) && light;
  ['--accent', '--accent2', '--accent-bg', '--accent-border', '--on-accent', '--gold', '--ho-a1', '--ho-a2'].forEach(k => H.style.removeProperty(k));
  if (on) {
    H.setAttribute('data-dark', '1'); H.setAttribute('data-theme', 'night-ops');
    const A = hoDarkAccent(T.a);
    if (A) { H.style.setProperty('--accent', A.a, 'important'); H.style.setProperty('--accent2', A.a, 'important'); H.style.setProperty('--gold', A.a, 'important'); H.style.setProperty('--ho-a1', A.a); H.style.setProperty('--ho-a2', A.a);
      H.style.setProperty('--accent-bg', A.bg, 'important'); H.style.setProperty('--accent-border', A.border, 'important'); H.style.setProperty('--on-accent', A.on, 'important'); }
  } else {
    H.removeAttribute('data-dark');
    if (light) H.setAttribute('data-theme', T.base);
  }
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', on ? '#0e1116' : T.bg);
}
function hoSetDark(on) {
  try { localStorage.setItem(HO_DARK_KEY, on ? '1' : '0'); } catch (_) {}
  hoApplyDark(); hoThemeMenuSync();
  const pop = document.getElementById('hoThemePop'); if (pop) { const b = pop.querySelector('.ho-tp-dark'); if (b) { b.classList.toggle('on', !!on); b.setAttribute('aria-checked', String(!!on)); } }
  if (typeof _applyLoginTheme === 'function') _applyLoginTheme(hoThemeName());
}
function hoSetDarkAuto(on) {
  try { localStorage.setItem(HO_DARK_AUTO_KEY, on ? '1' : '0'); } catch (_) {}
  hoApplyDark(); hoApplyEye();
  const pop = document.getElementById('hoThemePop'); if (pop) { const b = pop.querySelector('.ho-tp-darkauto'); if (b) { b.classList.toggle('on', !!on); b.setAttribute('aria-checked', String(!!on)); } }
}
// ── 👁 Eye saver: a warm filter that takes the blue out of the screen (Off · Low · Medium · Strong), always or only in the evening ──
const HO_EYE_KEY = 'ho_eye_v1', HO_EYE_AUTO_KEY = 'ho_eye_auto_v1', HO_EYE_LEVELS = { off: 0, low: .08, med: .14, high: .22 };
function hoEyeLevel() { try { const v = localStorage.getItem(HO_EYE_KEY); return HO_EYE_LEVELS[v] != null ? v : 'off'; } catch (_) { return 'off'; } }
function hoEyeAuto() { try { return localStorage.getItem(HO_EYE_AUTO_KEY) === '1'; } catch (_) { return false; } }
function hoApplyEye() {
  const lv = hoEyeLevel(), a = HO_EYE_LEVELS[lv], on = a > 0 && (!hoEyeAuto() || hoIsEvening());
  let o = document.getElementById('hoEye');
  if (!on) { if (o) o.remove(); document.documentElement.removeAttribute('data-eye'); return; }
  if (!o) { o = document.createElement('div'); o.id = 'hoEye'; o.setAttribute('aria-hidden', 'true'); document.body.appendChild(o); }
  o.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:2147483600;background:rgba(255,140,40,${a});mix-blend-mode:multiply`;
  document.documentElement.setAttribute('data-eye', lv);
}
function hoSetEye(lv, auto) {
  try { if (lv != null) localStorage.setItem(HO_EYE_KEY, lv); if (auto != null) localStorage.setItem(HO_EYE_AUTO_KEY, auto ? '1' : '0'); } catch (_) {}
  hoApplyEye();
  const pop = document.getElementById('hoThemePop');
  if (pop) { pop.querySelectorAll('[data-eye]').forEach(b => { const on = b.dataset.eye === hoEyeLevel(); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); const e = pop.querySelector('.ho-tp-eyeauto'); if (e) { e.classList.toggle('on', hoEyeAuto()); e.setAttribute('aria-checked', String(hoEyeAuto())); } }
}
document.addEventListener('DOMContentLoaded', () => { hoApplyDark(); hoApplyEye(); });
// the evening comes and goes by itself: check every minute
setInterval(() => { if (hoDarkAuto()) hoApplyDark(); if (hoEyeAuto() && hoEyeLevel() !== 'off') hoApplyEye(); }, 60000);
// 🕐 tap the clock in the top bar: AM/PM ↔ 24-hour (the same setting as Settings, the roster follows)
document.addEventListener('click', e => {
  const t = e.target.closest && e.target.closest('#topbarTime'); if (!t || typeof hoSetPref !== 'function') return;
  hoSetPref('clock12', !hoPref('clock12'));
  if (typeof showToast === 'function') showToast(hoPref('clock12') ? '🕐 12-hour clock (AM/PM)' : '🕐 24-hour clock', 'ok');
  if (typeof roRender === 'function') try { roRender(); } catch (_) {}
});

/** The top bar's one theme button, and its menu of every theme. */
function hoThemeMenuSync() {
  const T = HO_THEMES[hoThemeName()] || HO_THEMES['night-ops'], b = document.getElementById('hoThemeBtn');
  if (b) b.innerHTML = `<span class="theme-dot" style="background:${T.a};box-shadow:0 0 0 2px ${T.bg}, 0 0 0 3px ${T.a}55"></span><span>${T.label}</span>`;
  // the sign-in screen's and the phone menu's one theme button
  document.querySelectorAll('#loginThemeBtn, #mobThemeBtn').forEach(L => L.innerHTML = `<span class="theme-dot" style="background:${T.a};box-shadow:0 0 0 2px ${T.bg}, 0 0 0 3px ${T.a}55"></span><span>${T.label}</span><span class="ltp-caret">▾</span>`);
}
function hoThemeMenu(btn) {
  const old = document.getElementById('hoThemePop'); if (old) { old.remove(); return; }
  const cur = hoThemeName(), pop = document.createElement('div'); pop.id = 'hoThemePop'; pop.className = 'ho-theme-pop'; pop.setAttribute('role', 'menu');
  const item = ([k, t]) => `<button type="button" role="menuitemradio" aria-checked="${k === cur}" class="${k === cur ? 'on' : ''}" onclick="setTheme('${k}');document.getElementById('hoThemePop')?.remove()"><span class="ho-tp-sw" style="background:${t.bg}"><i style="background:${t.a}"></i></span><span class="ho-tp-name">${t.label}</span>${k === cur ? '<b aria-hidden="true">✓</b>' : ''}</button>`;
  const all = Object.entries(HO_THEMES);
  const dk = hoDarkOn(), curT = HO_THEMES[cur] || {}, already = curT.base && curT.base !== 'opera';
  pop.innerHTML = `<div class="ho-tp-header"><div><strong>Appearance</strong><small>Your screen, your style</small></div><button type="button" class="ho-tp-close" aria-label="Close appearance settings" onclick="document.getElementById('hoThemePop')?.remove()">✕</button></div>`
    + `<div class="ho-tp-hd">Display</div><button type="button" role="menuitemcheckbox" aria-checked="${dk}" class="ho-tp-dark${dk ? ' on' : ''}" onclick="event.stopPropagation();hoSetDark(!hoDarkOn())"><span aria-hidden="true">☾</span><b>Dark mode</b><small>${already ? 'This style is already dark' : 'A darker look for your screen'}</small><i class="ho-tp-tog" aria-hidden="true"></i></button>`
    + `<button type="button" role="menuitemcheckbox" aria-checked="${hoDarkAuto()}" class="ho-tp-dark ho-tp-darkauto${hoDarkAuto() ? ' on' : ''}" onclick="event.stopPropagation();hoSetDarkAuto(!hoDarkAuto())"><span aria-hidden="true">◷</span><b>Evening mode</b><small>Automatic · 19:00–07:00</small><i class="ho-tp-tog" aria-hidden="true"></i></button>`
    + `<div class="ho-tp-eye"><div class="ho-tp-eyehd"><span aria-hidden="true">☀</span><b>Eye saver</b><small>Warmer tones, less blue light</small></div><div class="ho-tp-seg" role="group" aria-label="Eye saver strength">${[['off', 'Off'], ['low', 'Low'], ['med', 'Medium'], ['high', 'Strong']].map(([k, l]) => `<button type="button" data-eye="${k}" aria-pressed="${hoEyeLevel() === k}" class="${hoEyeLevel() === k ? 'on' : ''}" onclick="event.stopPropagation();hoSetEye('${k}')">${l}</button>`).join('')}</div>
      <button type="button" role="menuitemcheckbox" aria-checked="${hoEyeAuto()}" class="ho-tp-eyeauto${hoEyeAuto() ? ' on' : ''}" onclick="event.stopPropagation();hoSetEye(null, !hoEyeAuto())"><i class="ho-tp-box" aria-hidden="true"></i><span>Evenings only<small>19:00–07:00</small></span></button></div>`
    + '<div class="ho-tp-hd">App styles</div><div class="ho-tp-themes">' + all.filter(x => x[1].group === 'style').map(item).join('') + '</div>'
    + '<div class="ho-tp-hd">Colours</div><div class="ho-tp-themes">' + all.filter(x => x[1].group !== 'style').map(item).join('') + '</div>';
  document.body.appendChild(pop);
  const r = btn.getBoundingClientRect(), w = Math.min(360, window.innerWidth - 24);
  pop.style.width = w + 'px'; pop.style.maxHeight = Math.min(640, window.innerHeight - 24) + 'px';
  pop.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.right - w)) + 'px';
  pop.style.top = Math.max(12, Math.min(window.innerHeight - pop.getBoundingClientRect().height - 12, r.bottom + 8)) + 'px';
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
const _A11Y_SEL = '.icon-round, .theme-btn, .fchip, .vt-btn';
function _a11yUpgradeIconButtons(root) {
  const r = root || document, list = [...r.querySelectorAll(_A11Y_SEL)];
  if (r.nodeType === 1 && r.matches(_A11Y_SEL)) list.push(r);
  list.forEach(el => {
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
  // only the parts that were just added are looked at — not the whole page on every change (that was a big share of start-up time)
  const added = new Set(); let queued = false;
  new MutationObserver(ms => {
    ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) added.add(n); }));
    if (queued || !added.size) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; const L = [...added]; added.clear(); L.forEach(n => { if (n.isConnected) _a11yUpgradeIconButtons(n); }); });
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
const APP_VERSION = 'v576';

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

// ── Esc closes whatever is open on top ────────────────────
// One key for every popup, sheet and dialog. While typing in a box, the
// first Esc is left to that box (cancel an edit, clear a search) and just
// lets go of it; the next Esc closes the window. Lock screens never close.
const ESC_SEL = '.ri-viewer, .fr-overlay, .br-overlay, .modal-bg.open, .ho-theme-pop, .rb-menu, #mobMoreOverlay, #depCopyOverlay, #lcoPickerOverlay, #ap-assign-popup, #gmChangePwOverlay';
const ESC_CLOSE = { lvView: () => lvClose(), evDlg: () => evClose(), brSheet: () => brClose(), gsModal: () => gsClose(), hoModal: () => hoClose(), guestModal: () => closeModal(), feedbackModal: () => closeFeedbackModal(), mobMoreOverlay: () => toggleMobMore(), gmChangePwOverlay: () => gmClosePwOverlay() };
function escShown(el) { if (!el.isConnected || !el.getClientRects().length) return false; const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; }
/** The open overlay drawn on top: highest z-index, then the one added last. */
function escTop() {
  let best = null, bz = -Infinity;
  document.querySelectorAll(ESC_SEL).forEach(el => { if (!escShown(el)) return; const z = parseInt(getComputedStyle(el).zIndex) || 0; if (z >= bz) { best = el; bz = z; } });
  return best;
}
function escClose(el) {
  const f = ESC_CLOSE[el.id];
  if (f) { try { f(); } catch (e) {} }
  if (escShown(el)) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));   // most windows close when you tap outside them
  if (escShown(el)) { if (el.classList.contains('modal-bg')) el.classList.remove('open'); else el.remove(); }
}
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  const a = document.activeElement;
  if (a && a !== document.body && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) {
    setTimeout(() => { if (document.activeElement === a) a.blur(); }, 0);
    return;
  }
  const top = escTop(); if (!top) return;
  e.stopImmediatePropagation(); e.preventDefault();
  escClose(top);
}, true);

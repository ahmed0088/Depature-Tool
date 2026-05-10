// ═══════════════════════════════════════════════════════════
//  utils.js  —  Shared helpers used across all modules
// ═══════════════════════════════════════════════════════════

// ── Clock ─────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const t = el => document.getElementById(el);
  if (t('topbarTime'))  t('topbarTime').textContent  = now.toLocaleTimeString('en-GB',  { hour:'2-digit', minute:'2-digit' });
  if (t('topbarDate'))  t('topbarDate').textContent  = now.toLocaleDateString('en-GB',  { weekday:'long', day:'numeric', month:'long', year:'numeric' }).toUpperCase();
  if (t('cl-date-lbl')) t('cl-date-lbl').textContent = now.toLocaleDateString('en-GB',  { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}

// Add this to the end of utils.js if not already there

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

// Make sure cleanSource is defined
function cleanSource(agent, company, source) {
  let src = agent || company || source || '';
  src = src
    .replace(/BOOKING\.COM BV.*$/i, 'Booking.com')
    .replace(/AGODA COMPANY PTE LTD/i, 'Agoda')
    .replace(/EXPEDIA\.COM.*/i, 'Expedia')
    .replace(/\s*\(.*?\)/g, '')
    .trim();
  return src || 'Walk-in';
}

// Make sure parseName is defined
function parseName(raw) {
  if (!raw) return '—';
  if (raw.includes(',')) {
    const parts = raw.split(',').map(p => p.trim())
      .filter(p => p && !/^(Mr\.?|Mrs\.?|Ms\.?|Miss|MR|MRS|MS|Dr\.?)$/i.test(p));
    return parts.slice(0, 2).reverse().join(' ').trim() || raw.trim();
  }
  return raw.trim();
}

// Make sure cleanName is defined
function cleanName(raw) {
  if (!raw) return '';
  raw = raw.replace(/,?\s*(Mr\.|Mrs\.|Ms\.|Miss|MR|MRS|DR\.?)\.?\s*$/i, '').trim();
  const parts = raw.split(',').map(p => p.trim()).filter(p => p);
  if (parts.length >= 2) return (parts[1] + ' ' + parts[0]).trim().toUpperCase();
  return raw.toUpperCase();
}

// ── Panel switcher ────────────────────────────────────────
function showPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const panel = document.getElementById('panel-' + name);
  const nav   = document.getElementById('nav-'   + name);
  if (panel) panel.classList.add('active');
  if (nav)   nav.classList.add('active');
  if (name === 'shifts') renderShift(activeShift);
}

// ── Clipboard ─────────────────────────────────────────────
function copyToClipboard(text, btn, label) {
  const done = () => {
    if (!btn) return;
    btn.textContent = '✅ Copied!';
    setTimeout(() => { btn.textContent = label; }, 3000);
  };
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(done).catch(() => fbCopy(text, done));
  } else {
    fbCopy(text, done);
  }
}
function fbCopy(text, cb) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  if (cb) cb();
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
  return src || 'Walk-in';
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
  const p = s.trim().split('-');
  if (p.length !== 3) return null;
  const yr = parseInt(p[2]) + (parseInt(p[2]) < 100 ? 2000 : 0);
  return new Date(yr, parseInt(p[1]) - 1, parseInt(p[0]));
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

// ── Theme ─────────────────────────────────────────────────
function toggleTheme() {
  const cur  = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = cur === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  document.getElementById('themeBtn').textContent = next === 'light' ? '☀️' : '🌙';
  saveSettings({ theme: next });
}

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

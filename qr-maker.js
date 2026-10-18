// ═══════════════════════════════════════════════════════════
//  qr-maker.js  —  🔳 QR Code Maker
//
//  Paste a link (or any text, or Wi-Fi details) and get a QR code that
//  phones can scan. Download it as a PNG, print it, or copy it.
//  Works fully offline: the QR encoder is built in (no CDN, no service).
//  Recent codes are kept on this device only (localStorage 'ho_qr_recent').
//
//  The QR encoder below is a compact port of Project Nayuki's
//  "QR Code generator library" (https://www.nayuki.io/page/qr-code-generator-library)
//
//    Copyright (c) Project Nayuki. (MIT License)
//    Permission is hereby granted, free of charge, to any person obtaining a copy of
//    this software and associated documentation files (the "Software"), to deal in
//    the Software without restriction, including without limitation the rights to
//    use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
//    the Software, and to permit persons to whom the Software is furnished to do so,
//    subject to the following conditions:
//    - The above copyright notice and this permission notice shall be included in
//      all copies or substantial portions of the Software.
//    - The Software is provided "as is", without warranty of any kind, express or
//      implied, including but not limited to the warranties of merchantability,
//      fitness for a particular purpose and noninfringement. In no event shall the
//      authors or copyright holders be liable for any claim, damages or other
//      liability, whether in an action of contract, tort or otherwise, arising from,
//      out of or in connection with the Software or the use or other dealings in the
//      Software.
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';

const PANEL = 'qr';
const LS_KEY = 'ho_qr_recent';
const MAX_RECENT = 8;

/* ───────────────────────── QR encoder (byte mode) ───────────────────────── */
const QR = (() => {
  // ecl: 0=L 1=M 2=Q 3=H ; format bits per ecl
  const FMT = [1, 0, 3, 2];
  const ECC = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]];
  const BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]];

  const bit = (x, i) => ((x >>> i) & 1) !== 0;
  const rawModules = v => {
    let r = (16 * v + 128) * v + 64;
    if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
    return r;
  };
  const dataCodewords = (v, e) => Math.floor(rawModules(v) / 8) - ECC[e][v] * BLOCKS[e][v];

  // GF(2^8) / Reed-Solomon
  const gmul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z & 0xFF; };
  const rsDivisor = deg => {
    const r = new Array(deg).fill(0); r[deg - 1] = 1; let root = 1;
    for (let i = 0; i < deg; i++) {
      for (let j = 0; j < deg; j++) { r[j] = gmul(r[j], root); if (j + 1 < deg) r[j] ^= r[j + 1]; }
      root = gmul(root, 2);
    }
    return r;
  };
  const rsRemainder = (data, div) => {
    const r = div.map(() => 0);
    for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gmul(c, f); }); }
    return r;
  };

  function encode(bytes, minEcl, boost) {
    if (minEcl == null) minEcl = 1;
    let ver = 0;
    for (let v = 1; v <= 40; v++) {
      const used = 4 + (v <= 9 ? 8 : 16) + bytes.length * 8;
      if (used <= dataCodewords(v, minEcl) * 8) { ver = v; break; }
    }
    if (!ver) return null;                                   // too long
    const ccBits = ver <= 9 ? 8 : 16, usedBits = 4 + ccBits + bytes.length * 8;
    let ecl = minEcl;
    if (boost !== false) for (let e = minEcl + 1; e <= 3; e++) if (usedBits <= dataCodewords(ver, e) * 8) ecl = e;

    // bit stream
    const bb = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, ccBits); for (const b of bytes) put(b, 8);
    const cap = dataCodewords(ver, ecl) * 8;
    put(0, Math.min(4, cap - bb.length));
    put(0, (8 - bb.length % 8) % 8);
    for (let p = 0xEC; bb.length < cap; p ^= 0xEC ^ 0x11) put(p, 8);
    const data = [];
    for (let i = 0; i < bb.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bb[i + j]; data.push(b); }

    // ecc + interleave
    const nb = BLOCKS[ecl][ver], el = ECC[ecl][ver], raw = Math.floor(rawModules(ver) / 8);
    const nShort = nb - raw % nb, shortLen = Math.floor(raw / nb), div = rsDivisor(el), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const dat = data.slice(k, k + shortLen - el + (i < nShort ? 0 : 1)); k += dat.length;
      const ecc = rsRemainder(dat, div); if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const all = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - el || j >= nShort) all.push(b[i]); });

    // matrix
    const size = ver * 4 + 17;
    const m = [], fn = [];
    for (let y = 0; y < size; y++) { m.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    const setF = (x, y, d) => { m[y][x] = d; fn[y][x] = true; };
    for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    const finder = (x, y) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)), xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setF(xx, yy, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    if (ver > 1) {
      const n = Math.floor(ver / 7) + 2, step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2, pos = [6];
      for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
    const formatBits = mask => {
      const d = FMT[ecl] << 3 | mask; let r = d;
      for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const bits = (d << 10 | r) ^ 0x5412;
      for (let i = 0; i <= 5; i++) setF(8, i, bit(bits, i));
      setF(8, 7, bit(bits, 6)); setF(8, 8, bit(bits, 7)); setF(7, 8, bit(bits, 8));
      for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(bits, i));
      for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(bits, i));
      for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(bits, i));
      setF(8, size - 8, true);
    };
    formatBits(0);
    if (ver >= 7) {
      let r = ver; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      const bits = ver << 12 | r;
      for (let i = 0; i < 18; i++) { const b = bit(bits, i), a = size - 11 + i % 3, c = Math.floor(i / 3); setF(a, c, b); setF(c, a, b); }
    }
    // codewords, zigzag
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && i < all.length * 8) { m[y][x] = bit(all[i >>> 3], 7 - (i & 7)); i++; }
      }
    }
    const applyMask = k => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        let inv;
        switch (k) {
          case 0: inv = (x + y) % 2 === 0; break;
          case 1: inv = y % 2 === 0; break;
          case 2: inv = x % 3 === 0; break;
          case 3: inv = (x + y) % 3 === 0; break;
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: inv = x * y % 2 + x * y % 3 === 0; break;
          case 6: inv = (x * y % 2 + x * y % 3) % 2 === 0; break;
          default: inv = ((x + y) % 2 + x * y % 3) % 2 === 0;
        }
        if (!fn[y][x] && inv) m[y][x] = !m[y][x];
      }
    };
    const penalty = () => {
      let p = 0, dark = 0;
      const line = get => {                    // N1 runs + N3 finder-like patterns on one row/column
        let run = 0, prev = null;
        for (let k = 0; k < size; k++) {
          const c = get(k);
          if (c === prev) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else { run = 1; prev = c; }
        }
        for (let k = -4; k < size; k++) {      // 1011101 with 4 light on one side (outside = light)
          const at = q => (q >= 0 && q < size) ? get(q) : false;
          if (at(k + 4) && !at(k + 5) && at(k + 6) && at(k + 7) && at(k + 8) && !at(k + 9) && at(k + 10)) {
            if (!at(k) && !at(k + 1) && !at(k + 2) && !at(k + 3)) p += 40;
            if (!at(k + 11) && !at(k + 12) && !at(k + 13) && !at(k + 14)) p += 40;
          }
        }
      };
      for (let y = 0; y < size; y++) line(x => m[y][x]);
      for (let x = 0; x < size; x++) line(y => m[y][x]);
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
        const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
      }
      for (const row of m) for (const c of row) if (c) dark++;
      const total = size * size;
      p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
      return p;
    };
    let best = 0, min = Infinity;
    for (let k = 0; k < 8; k++) {
      applyMask(k); formatBits(k);
      const pp = penalty(); if (pp < min) { min = pp; best = k; }
      applyMask(k);
    }
    applyMask(best); formatBits(best);
    return { version: ver, ecl: 'LMQH'[ecl], mask: best, size, modules: m };
  }

  const utf8 = s => (typeof TextEncoder !== 'undefined') ? Array.from(new TextEncoder().encode(s)) : Array.from(unescape(encodeURIComponent(s)), c => c.charCodeAt(0));
  return { encode, encodeText: (s, ecl, boost) => encode(utf8(s), ecl, boost), utf8 };
})();

/* ───────────────────────── helpers ───────────────────────── */
const esc = s => (typeof escapeHtml === 'function') ? escapeHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (msg, type) => { if (typeof showToast === 'function') showToast(msg, type || 'ok'); else console.log('[qr]', msg); };
const $ = id => document.getElementById(id);
const lsGet = () => { try { const v = JSON.parse(localStorage.getItem(LS_KEY) || '[]'); return Array.isArray(v) ? v.filter(x => x && typeof x.t === 'string') : []; } catch (e) { return []; } };
const lsSet = list => { try { localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, MAX_RECENT))); } catch (e) {} };

const wifiEsc = s => String(s || '').replace(/([\\;,:"])/g, '\\$1');
function wifiString(name, pass, type) {
  const t = type === 'WEP' ? 'WEP' : type === 'nopass' ? 'nopass' : 'WPA';
  return 'WIFI:T:' + t + ';S:' + wifiEsc(name) + ';' + (t === 'nopass' ? '' : 'P:' + wifiEsc(pass) + ';') + ';';
}
function wifiParse(s) {
  if (!/^WIFI:/i.test(s)) return null;
  const out = { T: 'WPA', S: '', P: '' }; const body = s.slice(5);
  let key = '', val = '', inVal = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inVal) {
      if (c === '\\' && i + 1 < body.length) { val += body[++i]; continue; }
      if (c === ';') { out[key.toUpperCase()] = val; key = ''; val = ''; inVal = false; continue; }
      val += c;
    } else if (c === ':') inVal = true; else if (c !== ';') key += c;
  }
  return { name: out.S, pass: out.P, type: /^wep$/i.test(out.T) ? 'WEP' : /^nopass$/i.test(out.T) || !out.T ? 'nopass' : 'WPA' };
}
const looksLikeBareDomain = s => /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#]\S*)?$/i.test(s) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(s);
function hostOf(s) {
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'https://' + s).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}
function fileName() {
  let base;
  if (state.mode === 'wifi') base = 'Wi-Fi ' + (state.wifi.name || '').trim();
  else { const t = state.text.trim(); base = (looksLikeBareDomain(t) || /^https?:\/\//i.test(t)) ? hostOf(t) : ''; if (!base) base = 'text'; }
  base = base.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'code';
  return 'QR - ' + base + '.png';
}

/* ───────────────────────── state ───────────────────────── */
const SIZES = { S: { px: 190, out: 720, cm: 6 }, M: { px: 260, out: 1080, cm: 9 }, L: { px: 340, out: 1600, cm: 13 } };
const state = { mode: 'link', text: '', caption: '', captionTouched: false, capBy: { link: ['', false], wifi: ['', false] }, size: 'M', wifi: { name: '', pass: '', type: 'WPA' }, qr: null, err: '' };
let tDraw = 0, tSave = 0;

const payload = () => state.mode === 'wifi' ? (state.wifi.name.trim() ? wifiString(state.wifi.name, state.wifi.pass, state.wifi.type) : '') : state.text;
const captionNow = () => {
  const c = state.caption.trim();
  if (c || state.captionTouched) return c;
  return state.mode === 'wifi' && state.wifi.name.trim() ? 'Wi-Fi: ' + state.wifi.name.trim() : '';
};

/* ───────────────────────── drawing ───────────────────────── */
const QUIET = 4;
function drawQR(ctx, qr, x0, y0, scale) {
  ctx.fillStyle = '#000000';
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.modules[y][x]) ctx.fillRect(x0 + (x + QUIET) * scale, y0 + (y + QUIET) * scale, scale, scale);
}
function wrapLines(ctx, text, maxW, maxLines) {
  const words = text.split(/\s+/).filter(Boolean), lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + ' …'; }
  return lines.map(l => { while (ctx.measureText(l).width > maxW && l.length > 2) l = l.slice(0, -2) + '…'; return l; });
}
// A full image (white, QR + quiet zone, optional caption) at about `target` px wide.
function renderImage(target) {
  const qr = state.qr; if (!qr) return null;
  const n = qr.size + QUIET * 2, scale = Math.max(2, Math.round(target / n)), w = n * scale;
  const cap = captionNow();
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
  const font = Math.round(w * 0.055), fam = (getComputedStyle(document.body).fontFamily || 'sans-serif');
  let lines = [];
  if (cap) { ctx.font = '700 ' + font + 'px ' + fam; lines = wrapLines(ctx, cap, w - scale * QUIET * 2, 2); }
  const capH = lines.length ? Math.round(lines.length * font * 1.3 + scale * QUIET * 0.6) : 0;
  cv.width = w; cv.height = w + capH;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
  drawQR(ctx, qr, 0, 0, scale);
  if (lines.length) {
    ctx.fillStyle = '#000000'; ctx.font = '700 ' + font + 'px ' + fam; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, w / 2, w - scale * QUIET * 0.55 + i * font * 1.3));
  }
  return cv;
}
function drawPreview() {
  const cv = $('qr-canvas'); if (!cv || !state.qr) return;
  const n = state.qr.size + QUIET * 2, css = SIZES[state.size].px, dpr = Math.min(3, window.devicePixelRatio || 1);
  const scale = Math.max(1, Math.ceil(css * dpr / n));
  cv.width = cv.height = n * scale;
  cv.style.width = cv.style.height = css + 'px';
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
  drawQR(ctx, state.qr, 0, 0, scale);
}

/* ───────────────────────── render ───────────────────────── */
const CSS = `
#panel-qr .qr-wrap{max-width:1040px;margin:0 auto}
#panel-qr .qr-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,420px);grid-template-areas:"form prev" "recent prev";gap:16px;align-items:start}
#panel-qr .qr-form{grid-area:form}
#panel-qr .qr-prev{grid-area:prev}
#panel-qr .qr-recent{grid-area:recent}
#panel-qr .qr-card{background:var(--card);border:1px solid var(--border);border-radius:var(--r2,14px);padding:16px;min-width:0}
#panel-qr .qr-tabs{display:inline-flex;gap:4px;padding:3px;background:var(--card2);border:1px solid var(--border);border-radius:999px;margin-bottom:14px}
#panel-qr .qr-tab{font-family:var(--font);font-size:.8rem;font-weight:600;padding:6px 14px;border-radius:999px;border:0;background:transparent;color:var(--text2);cursor:pointer}
#panel-qr .qr-tab[aria-selected="true"]{background:var(--accent-bg);color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent-border)}
#panel-qr .qr-lbl{display:block;font-size:.72rem;font-weight:700;color:var(--text2);margin:0 0 6px;letter-spacing:.2px}
#panel-qr .qr-field{margin-bottom:14px}
#panel-qr .qr-field:last-child{margin-bottom:0}
#panel-qr .qr-in{width:100%;box-sizing:border-box;font-family:var(--font);font-size:.92rem;color:var(--text);background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;outline:none;transition:border-color .12s,box-shadow .12s}
#panel-qr textarea.qr-in{resize:vertical;min-height:84px;line-height:1.4;font-size:1rem;word-break:break-all}
#panel-qr .qr-in:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-bg)}
#panel-qr .qr-in::placeholder{color:var(--text3)}
#panel-qr .qr-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}
#panel-qr .qr-pass{position:relative}
#panel-qr .qr-pass .qr-in{padding-right:64px}
#panel-qr .qr-eye{position:absolute;right:6px;top:50%;transform:translateY(-50%);font-family:var(--font);font-size:.7rem;font-weight:600;border:0;background:transparent;color:var(--text3);cursor:pointer;padding:6px}
#panel-qr .qr-seg{display:inline-flex;gap:4px;flex-wrap:wrap}
#panel-qr .qr-seg button{font-family:var(--font);font-size:.78rem;font-weight:600;min-width:44px;padding:7px 12px;border-radius:9px;border:1px solid var(--border);background:var(--card2);color:var(--text2);cursor:pointer}
#panel-qr .qr-seg button[aria-pressed="true"]{background:var(--accent-bg);color:var(--accent);border-color:var(--accent-border)}
#panel-qr .qr-hint{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;font-size:.74rem;color:var(--text2);background:var(--accent-bg);border:1px solid var(--accent-border);border-radius:9px;padding:7px 10px}
#panel-qr .qr-hint button{font-family:var(--font);font-size:.72rem;font-weight:700;border:0;background:transparent;color:var(--accent);cursor:pointer;padding:0;text-decoration:underline}
#panel-qr .qr-meta{margin-top:6px;margin-bottom:4px;font-family:var(--mono);font-size:.64rem;color:var(--text3);min-height:1em}
#panel-qr .qr-meta.bad{color:var(--red,#e5484d)}
#panel-qr .qr-prev{display:flex;flex-direction:column;align-items:center;gap:14px;position:sticky;top:12px}
#panel-qr .qr-sheet{background:#fff;color:#000;border-radius:12px;padding:10px 10px 12px;display:flex;flex-direction:column;align-items:center;max-width:100%;box-sizing:border-box;box-shadow:0 1px 0 rgba(0,0,0,.04),0 6px 24px rgba(0,0,0,.18)}
#panel-qr .qr-sheet canvas{display:block;max-width:100%;height:auto !important;image-rendering:pixelated;image-rendering:crisp-edges}
#panel-qr .qr-cap{font-family:var(--font);font-weight:700;font-size:1rem;color:#000;text-align:center;margin-top:2px;max-width:100%;overflow-wrap:anywhere;padding:0 6px}
#panel-qr .qr-cap:empty{display:none}
#panel-qr .qr-empty{width:260px;max-width:100%;aspect-ratio:1/1;box-sizing:border-box;border:2px dashed var(--border);border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;padding:20px;color:var(--text3)}
#panel-qr .qr-empty b{color:var(--text2);font-size:.9rem}
#panel-qr .qr-empty span{font-size:.75rem;line-height:1.4}
#panel-qr .qr-empty .qr-ghost{font-size:2.4rem;opacity:.6;line-height:1}
#panel-qr .qr-acts{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;width:100%}
#panel-qr .qr-acts .btn{flex:0 1 auto}
#panel-qr .qr-acts .btn[disabled]{opacity:.45;cursor:not-allowed}
#panel-qr .qr-sizes{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;font-size:.72rem;color:var(--text3)}
#panel-qr .qr-recent h3{font-size:.82rem;font-weight:700;color:var(--text);margin:0 0 10px;display:flex;align-items:center;justify-content:space-between;gap:8px}
#panel-qr .qr-recent h3 small{font-family:var(--mono);font-weight:400;font-size:.62rem;color:var(--text3)}
#panel-qr .qr-rlist{display:flex;flex-direction:column;gap:6px}
#panel-qr .qr-ritem{display:flex;align-items:center;gap:8px;background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:4px 4px 4px 10px;min-width:0}
#panel-qr .qr-ritem:hover{border-color:var(--accent-border)}
#panel-qr .qr-ruse{flex:1;min-width:0;text-align:left;border:0;background:transparent;color:var(--text);font-family:var(--font);cursor:pointer;padding:5px 0;display:flex;flex-direction:column;gap:1px}
#panel-qr .qr-ruse b{font-size:.8rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#panel-qr .qr-ruse span{font-family:var(--mono);font-size:.62rem;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#panel-qr .qr-rx{flex:0 0 auto;width:32px;height:32px;border:0;border-radius:8px;background:transparent;color:var(--text3);cursor:pointer;font-size:.85rem}
#panel-qr .qr-rx:hover{background:var(--card);color:var(--text)}
#panel-qr .qr-rnone{font-size:.75rem;color:var(--text3)}
#panel-qr .qr-pop{animation:qrPop .18s ease}
@keyframes qrPop{from{opacity:.4;transform:scale(.985)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){#panel-qr .qr-pop{animation:none}#panel-qr .qr-in{transition:none}}
@media (max-width:820px){
  #panel-qr .qr-grid{grid-template-columns:minmax(0,1fr);grid-template-areas:"form" "prev" "recent"}
  #panel-qr .qr-prev{position:static}
}
@media (max-width:480px){
  #panel-qr .qr-row{grid-template-columns:minmax(0,1fr)}
  #panel-qr .qr-card{padding:13px}
  #panel-qr .qr-acts .btn{flex:1 1 calc(50% - 8px);justify-content:center}
}
#qr-print{display:none}
@media print{
  body.qr-printing > *:not(#qr-print){display:none !important}
  body.qr-printing{background:#fff !important}
  body.qr-printing #qr-print{display:flex !important;align-items:center;justify-content:center;min-height:95vh;margin:0}
  #qr-print img{display:block;image-rendering:pixelated}
}`;

const PANEL_HTML = `<div class="qr-wrap" data-no-enter>
  <div class="page-hd"><div class="page-hd-left"><h1>🔳 QR Code Maker</h1><p>Paste a link or text and get a QR code guests can scan with their phone.</p></div></div>
  <div class="qr-grid">
    <div class="qr-card qr-form">
      <div class="qr-tabs" role="tablist" aria-label="What to put in the code">
        <button type="button" class="qr-tab" role="tab" data-mode="link" aria-selected="true">🔗 Link or text</button>
        <button type="button" class="qr-tab" role="tab" data-mode="wifi" aria-selected="false">📶 Wi-Fi</button>
      </div>
      <div id="qr-f-link">
        <div class="qr-field">
          <label class="qr-lbl" for="qr-text">Paste a link or any text</label>
          <textarea id="qr-text" class="qr-in" rows="3" placeholder="https://www.booking.com/…" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done"></textarea>
          <div id="qr-hint"></div>
          <div class="qr-meta" id="qr-meta"></div>
        </div>
      </div>
      <div id="qr-f-wifi" hidden>
        <div class="qr-field qr-row">
          <div><label class="qr-lbl" for="qr-ssid">Network name</label><input id="qr-ssid" class="qr-in" type="text" placeholder="Hotel-Guest" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="next"></div>
          <div><label class="qr-lbl" for="qr-pass">Password</label><div class="qr-pass"><input id="qr-pass" class="qr-in" type="password" placeholder="Wi-Fi password" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done"><button type="button" class="qr-eye" id="qr-eye">Show</button></div></div>
        </div>
        <div class="qr-field">
          <span class="qr-lbl">Security</span>
          <div class="qr-seg" id="qr-wtype">
            <button type="button" data-wt="WPA" aria-pressed="true">WPA / WPA2</button>
            <button type="button" data-wt="WEP" aria-pressed="false">WEP</button>
            <button type="button" data-wt="nopass" aria-pressed="false">No password</button>
          </div>
          <div class="qr-meta" id="qr-wmeta"></div>
        </div>
      </div>
      <div class="qr-field">
        <label class="qr-lbl" for="qr-caption">Caption under the code <span style="font-weight:400;color:var(--text3)">(optional)</span></label>
        <input id="qr-caption" class="qr-in" type="text" maxlength="80" placeholder="e.g. Scan for our menu" autocomplete="off" enterkeyhint="done">
      </div>
    </div>
    <div class="qr-prev">
      <div id="qr-stage"></div>
      <div class="qr-sizes"><span>Size</span><div class="qr-seg" id="qr-size">
        <button type="button" data-sz="S" aria-pressed="false" title="Small">S</button>
        <button type="button" data-sz="M" aria-pressed="true" title="Medium">M</button>
        <button type="button" data-sz="L" aria-pressed="false" title="Large">L</button></div></div>
      <div class="qr-acts">
        <button type="button" class="btn gold" id="qr-dl" disabled>⬇ Download PNG</button>
        <button type="button" class="btn" id="qr-print-btn" disabled>🖨 Print</button>
        <button type="button" class="btn" id="qr-copy" disabled>📋 Copy image</button>
      </div>
    </div>
    <div class="qr-card qr-recent">
      <h3>Recent <small>on this device</small></h3>
      <div class="qr-rlist" id="qr-recent"></div>
    </div>
  </div>
</div>`;

function renderStage(animate) {
  const st = $('qr-stage'); if (!st) return;
  const has = !!state.qr;
  ['qr-dl', 'qr-print-btn', 'qr-copy'].forEach(id => { const b = $(id); if (b) b.disabled = !has; });
  if (!has) {
    const wifi = state.mode === 'wifi';
    st.innerHTML = `<div class="qr-empty" style="width:${SIZES[state.size].px}px"><div class="qr-ghost">${wifi ? '📶' : '🔳'}</div><b>${state.err ? 'Can\'t make this code' : 'Your QR code shows here'}</b><span>${esc(state.err || (wifi ? 'Type the network name and password. Guests scan it to join the Wi-Fi.' : 'Paste a link or type any text. The code appears here as you type.'))}</span></div>`;
    return;
  }
  let sheet = st.querySelector('.qr-sheet');
  if (!sheet) { st.innerHTML = '<div class="qr-sheet"><canvas id="qr-canvas" role="img"></canvas><div class="qr-cap" id="qr-cap"></div></div>'; sheet = st.querySelector('.qr-sheet'); }
  drawPreview();
  const cv = $('qr-canvas'); if (cv) cv.setAttribute('aria-label', 'QR code for: ' + payload().slice(0, 120));
  const cap = $('qr-cap'); if (cap) { cap.textContent = captionNow(); cap.style.maxWidth = SIZES[state.size].px + 'px'; }
  if (animate) { sheet.classList.remove('qr-pop'); void sheet.offsetWidth; sheet.classList.add('qr-pop'); }
}

function renderMeta() {
  const meta = $(state.mode === 'wifi' ? 'qr-wmeta' : 'qr-meta'), other = $(state.mode === 'wifi' ? 'qr-meta' : 'qr-wmeta');
  if (other) { other.textContent = ''; other.classList.remove('bad'); }
  if (meta) {
    const bytes = QR.utf8(payload()).length;
    if (state.err) { meta.textContent = state.err; meta.classList.add('bad'); }
    else { meta.classList.remove('bad'); meta.textContent = state.qr ? bytes + ' characters · version ' + state.qr.version + ' · ' + state.qr.size + '×' + state.qr.size : ''; }
  }
  const hint = $('qr-hint');
  if (hint) {
    const t = state.text.trim();
    hint.innerHTML = (state.mode === 'link' && looksLikeBareDomain(t))
      ? '<div class="qr-hint">💡 Tip: add https:// so phones open it as a link. <button type="button" id="qr-addhttps">Add it</button></div>' : '';
  }
}

function update(animate) {
  const p = payload(); state.err = ''; state.qr = null;
  if (p) {
    const q = QR.encodeText(p, 1);
    if (q) state.qr = q; else state.err = 'This is too long for one QR code (max about 2,300 characters). Try a shorter link.';
  }
  renderMeta(); renderStage(animate);
  clearTimeout(tSave);
  if (state.qr && p.trim().length >= 3) tSave = setTimeout(() => addRecent(), 2500);
}

function schedule() { clearTimeout(tDraw); tDraw = setTimeout(() => update(true), 160); }

/* ───────────────────────── recent ───────────────────────── */
function addRecent() {
  const t = payload(); if (!t || !state.qr) return;
  const list = lsGet().filter(x => x.t !== t);
  list.unshift({ t, c: state.caption.trim(), at: Date.now() });
  lsSet(list); renderRecent();
}
function recentLabel(x) {
  const w = wifiParse(x.t);
  if (w) return { main: '📶 Wi-Fi: ' + (w.name || '(no name)'), sub: x.c || (w.type === 'nopass' ? 'No password' : w.type) };
  return { main: x.c || x.t, sub: x.c ? x.t : '' };
}
function renderRecent() {
  const box = $('qr-recent'); if (!box) return;
  const list = lsGet();
  if (!list.length) { box.innerHTML = '<div class="qr-rnone">Codes you make will show here so you can use them again.</div>'; return; }
  box.innerHTML = list.map((x, i) => {
    const l = recentLabel(x), when = x.at ? new Date(x.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
    return `<div class="qr-ritem"><button type="button" class="qr-ruse" data-ri="${i}" title="Use this again"><b>${esc(l.main)}</b><span>${esc([l.sub, when].filter(Boolean).join(' · '))}</span></button><button type="button" class="qr-rx" data-rx="${i}" aria-label="Remove from recent" title="Remove">✕</button></div>`;
  }).join('');
}
function useRecent(i) {
  const x = lsGet()[i]; if (!x) return;
  const w = wifiParse(x.t);
  if (w) { state.wifi = { name: w.name, pass: w.pass, type: w.type }; setMode('wifi', true); }
  else { state.text = x.t; setMode('link', true); }
  state.caption = x.c || ''; state.captionTouched = !!x.c;
  syncInputs(); update(true);
}
function removeRecent(i) { const list = lsGet(); list.splice(i, 1); lsSet(list); renderRecent(); }

/* ───────────────────────── actions ───────────────────────── */
function download() {
  const cv = renderImage(SIZES[state.size].out); if (!cv) return;
  const name = fileName();
  const go = url => { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
  if (cv.toBlob) cv.toBlob(b => { if (!b) return go(cv.toDataURL('image/png')); const u = URL.createObjectURL(b); go(u); setTimeout(() => URL.revokeObjectURL(u), 4000); }, 'image/png');
  else go(cv.toDataURL('image/png'));
  addRecent(); toast('Saved ' + name, 'ok');
}
function print() {
  const cv = renderImage(1400); if (!cv) return;
  let box = $('qr-print');
  if (!box) { box = document.createElement('div'); box.id = 'qr-print'; document.body.appendChild(box); }
  const cm = SIZES[state.size].cm;
  box.innerHTML = '<img alt="QR code" style="width:' + cm + 'cm;height:auto">';
  const img = box.querySelector('img');
  const done = () => { document.body.classList.remove('qr-printing'); window.removeEventListener('afterprint', done); };
  img.onload = () => { document.body.classList.add('qr-printing'); window.addEventListener('afterprint', done); setTimeout(() => { try { window.print(); } catch (e) {} setTimeout(done, 1500); }, 30); };
  img.src = cv.toDataURL('image/png');
  addRecent();
}
async function copyImage() {
  const cv = renderImage(SIZES[state.size].out); if (!cv) return;
  try {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined' || !navigator.clipboard.write) throw new Error('unsupported');
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    addRecent(); toast('QR code copied. Paste it into WhatsApp, email or a document.', 'ok');
  } catch (e) {
    toast('This browser can\'t copy images. Use Download PNG instead.', 'err');
  }
}

/* ───────────────────────── wiring ───────────────────────── */
function setMode(m, quiet) {
  const next = m === 'wifi' ? 'wifi' : 'link';
  if (next !== state.mode) {                                   // each mode keeps its own caption
    state.capBy[state.mode] = [state.caption, state.captionTouched];
    [state.caption, state.captionTouched] = state.capBy[next];
    const ci = $('qr-caption'); if (ci) ci.value = state.caption;
  }
  state.mode = next;
  document.querySelectorAll('#panel-qr .qr-tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === state.mode)));
  const fl = $('qr-f-link'), fw = $('qr-f-wifi');
  if (fl) fl.hidden = state.mode !== 'link'; if (fw) fw.hidden = state.mode !== 'wifi';
  const cap = $('qr-caption'); if (cap) cap.placeholder = state.mode === 'wifi' ? 'e.g. Free Wi-Fi: scan to join' : 'e.g. Scan for our menu';
  if (!quiet) { update(true); const f = $(state.mode === 'wifi' ? 'qr-ssid' : 'qr-text'); if (f) f.focus(); }
}
function syncInputs() {
  const set = (id, v) => { const e = $(id); if (e && e.value !== v) e.value = v; };
  set('qr-text', state.text); set('qr-caption', state.caption); set('qr-ssid', state.wifi.name); set('qr-pass', state.wifi.pass);
  document.querySelectorAll('#qr-wtype button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.wt === state.wifi.type)));
  document.querySelectorAll('#qr-size button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sz === state.size)));
  const pw = $('qr-pass'); if (pw) pw.disabled = state.wifi.type === 'nopass';
}

function onInput(e) {
  const t = e.target;
  if (t.id === 'qr-text') { state.text = t.value; schedule(); }
  else if (t.id === 'qr-ssid') { state.wifi.name = t.value; schedule(); }
  else if (t.id === 'qr-pass') { state.wifi.pass = t.value; schedule(); }
  else if (t.id === 'qr-caption') { state.caption = t.value; state.captionTouched = t.value.length > 0; const c = $('qr-cap'); if (c) c.textContent = captionNow(); }
}
function onKey(e) {
  if (e.key !== 'Enter' || e.isComposing) return;
  const t = e.target;
  if (t.id === 'qr-text' && e.shiftKey) return;                    // Shift+Enter = new line in text
  if (/^qr-(text|ssid|pass|caption)$/.test(t.id || '')) {
    e.preventDefault(); e.stopPropagation();
    if (t.id === 'qr-ssid') { const p = $('qr-pass'); if (p && !p.disabled) { p.focus(); return; } }
    clearTimeout(tDraw); update(false); t.blur();
  }
}
function onClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.mode) return setMode(b.dataset.mode);
  if (b.dataset.wt) { state.wifi.type = b.dataset.wt; syncInputs(); return update(true); }
  if (b.dataset.sz) { state.size = b.dataset.sz; try { localStorage.setItem('ho_qr_size', state.size); } catch (_) {} syncInputs(); return renderStage(false); }
  if (b.dataset.ri != null) return useRecent(+b.dataset.ri);
  if (b.dataset.rx != null) return removeRecent(+b.dataset.rx);
  switch (b.id) {
    case 'qr-dl': return download();
    case 'qr-print-btn': return print();
    case 'qr-copy': return copyImage();
    case 'qr-eye': { const p = $('qr-pass'); if (p) { const show = p.type === 'password'; p.type = show ? 'text' : 'password'; b.textContent = show ? 'Hide' : 'Show'; } return; }
    case 'qr-addhttps': { state.text = 'https://' + state.text.trim(); syncInputs(); update(true); const ta = $('qr-text'); if (ta) ta.focus(); return; }
  }
}

function mount() {
  if (document.getElementById('panel-' + PANEL)) return;
  const main = document.querySelector('main.main') || document.querySelector('main');
  const nav = document.querySelector('nav.sidenav') || document.querySelector('nav');
  if (!main || !nav) { console.warn('[qr-maker] app layout not found; panel not added'); return; }

  const st = document.createElement('style'); st.id = 'qr-style'; st.textContent = CSS; document.head.appendChild(st);
  const panel = document.createElement('div'); panel.className = 'panel'; panel.id = 'panel-' + PANEL; panel.innerHTML = PANEL_HTML;
  main.appendChild(panel);
  panel.addEventListener('click', onClick); panel.addEventListener('input', onInput); panel.addEventListener('keydown', onKey);

  const item = document.createElement('div');
  item.className = 'nav-item'; item.id = 'nav-' + PANEL; item.dataset.panel = PANEL;
  item.setAttribute('onclick', "showPanel('" + PANEL + "')");
  item.innerHTML = '<div class="nav-icon">🔳</div>QR Code Maker';
  nav.appendChild(item);

  const grid = document.querySelector('.mob-more-grid');
  if (grid) {
    const b = document.createElement('button');
    b.className = 'mob-more-item'; b.dataset.panel = PANEL; b.type = 'button';
    b.setAttribute('onclick', "showPanel('" + PANEL + "');(typeof closeMobMore==='function'?closeMobMore:typeof toggleMobMore==='function'?toggleMobMore:function(){})()");
    b.innerHTML = '<span class="mob-item-icon">🔳</span>QR Code Maker';
    grid.appendChild(b);
  }

  try {
    if (typeof ROLES !== 'undefined') Object.keys(ROLES).forEach(r => {
      const p = ROLES[r] && ROLES[r].panels; if (p && p.includes('shifts') && !p.includes(PANEL)) p.push(PANEL);
    });
    if (typeof currentProfile !== 'undefined' && currentProfile && typeof applyRole === 'function') applyRole(currentProfile.role);
  } catch (e) { console.warn('[qr-maker] role setup:', e); }
  if (typeof hoApplyIcons === 'function') hoApplyIcons();

  try { const s = localStorage.getItem('ho_qr_size'); if (SIZES[s]) state.size = s; } catch (_) {}
  syncInputs(); renderRecent(); update(false);
}

// for tests and other modules
window.hoQR = { encode: QR.encodeText, wifiString, wifiParse, renderImage: () => renderImage(SIZES[state.size].out), fileName, state };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();

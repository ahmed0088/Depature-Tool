// ═══════════════════════════════════════════════════════════
//  roster-ocr.js — read a roster picture on this device, no AI needed
//
//  Uses Tesseract (free text recognition that runs in the browser). The
//  first time it downloads its reader (about 3 MB) and keeps it, so it
//  works offline after that.
//
//  How it reads a table picture:
//    1. Enlarge it and turn every coloured fill white, so only the text
//       and the lines stay dark (red, yellow, green or blue cells all read
//       the same).
//    2. Find the table's lines: thin lines make the cells, thick dark
//       bars are hotel titles ("Mercure DD").
//    3. Read each cell on its own. Hours are read digits-only first, so
//       09 is never 08; anything else (OFF, ALA, notes) is read in full.
//    4. Dates from the header, names matched to people already known by
//       their employee number. Anything unsure is marked for checking.
//  No table lines in the picture? It falls back to reading word by word.
// ═══════════════════════════════════════════════════════════

const RO_OCR_VER = '5.1.1';
const RO_OCR_CDN = 'https://cdn.jsdelivr.net/npm/';
let _roOcrLib = null;

function roOcrLoad() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (_roOcrLib) return _roOcrLib;
  _roOcrLib = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${RO_OCR_CDN}tesseract.js@${RO_OCR_VER}/dist/tesseract.min.js`;
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => { _roOcrLib = null; reject(new Error('Couldn\'t download the picture reader. Connect to the internet once and try again.')); };
    document.head.appendChild(s);
  });
  return _roOcrLib;
}
async function _roOcrWorker(params) {
  const T = await roOcrLoad();
  const w = await T.createWorker('eng', 1, {
    workerPath: `${RO_OCR_CDN}tesseract.js@${RO_OCR_VER}/dist/worker.min.js`,
    corePath: `${RO_OCR_CDN}tesseract.js-core@${RO_OCR_VER}`,
    langPath: `${RO_OCR_CDN}@tesseract.js-data/eng/4.0.0`,
  });
  await w.setParameters(Object.assign({ tessedit_pageseg_mode: '7' }, params || {}));
  return w;
}

// ── 1. Clean picture ──────────────────────────────────────
function _roOcrPrep(im) {
  const scale = Math.max(1, Math.min(4, 3000 / im.naturalWidth));
  const W = Math.round(im.naturalWidth * scale), H = Math.round(im.naturalHeight * scale);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high';
  x.drawImage(im, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H), a = d.data, g = new Uint8ClampedArray(W * H);
  // the brightest colour channel: any coloured fill turns light, black or dark text stays dark
  for (let i = 0, j = 0; i < a.length; i += 4, j++) {
    let v = (Math.max(a[i], a[i + 1], a[i + 2]) - 80) * 255 / 110;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    g[j] = v; a[i] = a[i + 1] = a[i + 2] = v;
  }
  x.putImageData(d, 0, 0);
  // the picture at its own size too: thin table lines are sharpest there
  const w0 = im.naturalWidth, h0 = im.naturalHeight, c0 = document.createElement('canvas'); c0.width = w0; c0.height = h0;
  const x0 = c0.getContext('2d', { willReadFrequently: true }); x0.drawImage(im, 0, 0);
  const a0 = x0.getImageData(0, 0, w0, h0).data, g0 = new Uint8ClampedArray(w0 * h0);
  for (let i = 0, j = 0; i < a0.length; i += 4, j++) g0[j] = Math.max(a0[i], a0[i + 1], a0[i + 2]);
  return { c, g, W, H, g0, w0, h0, scale };
}

// ── 2. Table lines ────────────────────────────────────────
function _roOcrRuns(arr, thr) {
  const out = []; let s = -1;
  arr.forEach((v, i) => { if (v > thr) { if (s < 0) s = i; } else if (s >= 0) { out.push([s, i - 1]); s = -1; } });
  if (s >= 0) out.push([s, arr.length - 1]);
  return out;
}
function _roOcrGrid(P) {
  // found on the picture at its own size (a line darker than its surroundings, across most of the table), then scaled up
  const { g0, w0, h0, scale } = P, dark = (X, Y) => g0[Y * w0 + X] < 170;
  const rows = [], cols = [];
  for (let y = 0; y < h0; y++) { let k = 0; for (let X = 0; X < w0; X++) if (dark(X, y)) k++; rows.push(k / w0); }
  for (let X = 0; X < w0; X++) { let k = 0; for (let y = 0; y < h0; y++) if (dark(X, y)) k++; cols.push(k / h0); }
  const up = runs => runs.map(([a, b]) => [Math.floor(a * scale), Math.min(Math.ceil((b + 1) * scale) - 1, Math.round((b + 1) * scale))]);
  return { hr: up(_roOcrRuns(rows, 0.5)), vr: up(_roOcrRuns(cols, 0.5)) };
}
/** A cell as its own small canvas (dark cells turned light), plus where its ink is. */
function _roOcrCrop(P, l, t, r, b) {
  const w = Math.max(1, r - l), h = Math.max(1, b - t);
  const c = document.createElement('canvas'); c.width = w + 16; c.height = h + 16;
  const x = c.getContext('2d');
  let inkL = w, inkR = -1;
  const hist = new Uint32Array(256); let n = 0;
  for (let yy = t; yy < b; yy += 2) for (let xx = l; xx < r; xx += 2) { hist[P.g[yy * P.W + xx]]++; n++; }
  let acc = 0, bg = 255; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n / 2) { bg = v; break; } }   // the cell's own background
  const inv = bg < 110;   // white text on a dark bar
  const B = inv ? 255 - bg : bg, ink = Math.max(25, Math.min(110, B - 55));   // ink: clearly darker than this cell's background
  const img = x.createImageData(w, h);
  let inkN = 0;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    let v = P.g[(t + yy) * P.W + l + xx]; if (inv) v = 255 - v;
    // stretch so the background is white and the ink black, whatever the colours were
    const o = Math.max(0, Math.min(255, Math.round((v - ink * 0.5) * 255 / Math.max(40, B - ink * 0.5))));
    const k = (yy * w + xx) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = o; img.data[k + 3] = 255;
    if (v < B - 55) { inkN++; if (xx < inkL) inkL = xx; if (xx > inkR) inkR = xx; }
  }
  if (inkN < w * h * 0.002) inkR = -1;   // a few specks are not writing
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.putImageData(img, 8, 8);
  return { c, w, inkL, inkR, empty: inkR < 0 };
}

// ── 3. Reading a cell ─────────────────────────────────────
const _RO_TIME = /(\d{1,2})\s*[:.]\s*(\d{2})\s*[-–~]*\s*(\d{1,2})\s*[:.]\s*(\d{2})|(\d{1,2})[:.]?(\d{2})\s*[-–~]+\s*(\d{1,2})[:.]?(\d{2})/;
function _roOcrTime(t) {
  const s = String(t || '').replace(/[Oo]/g, '0').replace(/[lI|]/g, '1');
  let m = s.match(_RO_TIME);
  if (!m) {
    // separators lost or misread ("00 - 00 - 09:00", "0000 0900"): rebuild from the digits, and always check it
    if (/[a-z]{2,}/i.test(s)) return null;
    const d = (s.match(/\d+/g) || []).join('');
    if (d.length !== 8 || !/^\s*\d{2}\D{0,3}\d{2}\D{0,3}\d{2}\D{0,3}\d{2}\s*$/.test(s)) return null;
    return { s: `${d.slice(0, 2)}:${d.slice(2, 4)} - ${d.slice(4, 6)}:${d.slice(6, 8)}`, ok: false };
  }
  if (m[1] == null) m = [m[0], m[5], m[6], m[7], m[8]];
  const okM = v => /^(00|15|30|45)$/.test(v);
  return { s: `${m[1].padStart(2, '0')}:${m[2]} - ${m[3].padStart(2, '0')}:${m[4]}`, ok: +m[1] <= 24 && +m[3] <= 24 && okM(m[2]) && okM(m[4]) };
}
function _roOcrTail(t) {
  const m = String(t || '').replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, '0').match(_RO_TIME);
  return m ? String(t).slice(m.index + m[0].length).replace(/^[\s\-–|:.,]+/, '').replace(/[|\[\]{}]/g, '').trim() : '';
}
function _roOcrWord(t) {
  let s = String(t || '').replace(/[|\[\]{}_]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^[0O]FF$/i.test(s)) return 'OFF';
  if (/^[A-Z0-9]{1,5}$/i.test(s)) s = s.toUpperCase().replace(/0/g, 'O');
  return s.replace(/\s*-\s*/g, ' - ');
}
let _roOcrWidths = [];   // how wide plain hours are in this picture
async function _roOcrCell(wd, wf, crop) {
  if (crop.empty) return '';
  const A = (await wd.recognize(crop.c)).data;
  const ta = _roOcrTime(A.text);
  const inkW = crop.inkR - crop.inkL;
  if (ta && ta.ok && A.confidence >= 50) {
    // anything after the hours, more ink to their right, or writing wider than plain hours → a note ("- Adagio"): read it in full
    const after = _roOcrTail(String(A.text).replace(/[Oo]/g, '0')).replace(/[\s.\-]/g, '');
    const right = Math.max(0, ...(A.words || []).map(w => w.bbox.x1 - 8));
    const ws = _roOcrWidths.slice().sort((a, b) => a - b), typical = ws.length >= 5 ? ws[ws.length >> 1] : 0;
    const wide = typical && inkW > typical * 1.3;
    if (!after && !wide && crop.inkR - right < crop.w * 0.1) { _roOcrWidths.push(inkW); return ta.s; }
  }
  const B = (await wf.recognize(crop.c)).data;
  const tb = _roOcrTime(B.text);
  if (tb || ta) {
    const t = ta && ta.ok ? ta : tb;
    const tail = _roOcrTail(B.text);
    return t.s + (tail ? ' - ' + tail : '') + (t.ok ? '' : ' ?');
  }
  const w = _roOcrWord(B.text);
  return w ? w + (B.confidence < 45 ? ' ?' : '') : '?';   // something is written there: never leave it blank
}

// ── 4. Dates, names, hotels ───────────────────────────────
const _RO_DAYNAME = /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?$/i;
/** A header cell: a date ("5-Oct", "5-Ot", "05/10") or a day name, never working hours. */
function _roOcrHeadLike(t) {
  t = String(t || '').replace(/[|\[\]]/g, '').trim();
  if (!t || _roOcrTime(t)) return false;
  return /^\d{1,2}\s*[-\/. ]\s*([a-z0-9]{2,9})\.?$/i.test(t) || _RO_DAYNAME.test(t) || /^(mo|tu|we|th|fr|sa|su)[a-z]{0,7}\.?$/i.test(t) || /^\d{4}-\d{2}-\d{2}$/.test(t);
}
function _roOcrDates(cells, hint) {
  const parsed = cells.map(t => { const d = roParseDate(String(t || '').replace(/[|]/g, '').trim(), hint); return d && !_RO_DAYNAME.test(String(t).trim()) ? d : null; });
  const i = parsed.findIndex(Boolean);
  if (i >= 0 && parsed.filter(Boolean).length >= Math.min(2, cells.length)) return cells.map((_, k) => roAdd(parsed[i], k - i));
  // "5-Ot", "6-0ct": the day numbers alone, next to each other
  const nums = cells.map(t => { const m = String(t || '').match(/^\D{0,3}(\d{1,2})\b/); return m ? +m[1] : null; });
  const j = nums.findIndex(v => v != null);
  if (j >= 0) {
    for (let k = -10; k <= 17; k++) { const d = roAdd(hint, k); if (roDate(d).getDate() === nums[j]) { const base = roAdd(d, -j); if (nums.every((v, q) => v == null || roDate(roAdd(base, q)).getDate() === v)) return cells.map((_, q) => roAdd(base, q)); } }
  }
  return null;
}
function _roOcrSim(a, b) {
  a = String(a).toLowerCase().replace(/[^a-z]/g, ''); b = String(b).toLowerCase().replace(/[^a-z]/g, '');
  if (!a || !b) return 0;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[a.length][b.length] / Math.max(a.length, b.length);
}
/** "001032 - Ali Zama Mirza" → { id, name }, spelled as the team already knows it. */
function _roOcrName(raw) {
  let s = String(raw || '').replace(/[|\[\]{}_]/g, ' ').replace(/\s+/g, ' ').trim(), id = '';
  // the employee number in front; letters a picture often mixes up with digits are read as those digits
  const m = s.match(/^\s*([0-9OoDIlSB%]{3,}[0-9%]*)\s*[-–.:]?\s+(.*)$/) || s.match(/^\s*([0-9OoDIlSB%]*\d[0-9OoDIlSB%]*)\s*[-–.:]\s*(.*)$/);
  if (m && /\d/.test(m[1])) { id = m[1].replace(/[OoD]/g, '0').replace(/[Il]/g, '1').replace(/S/g, '5').replace(/B/g, '8'); s = m[2].trim(); }
  s = s.replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z.')\s-]+$/, '').trim();
  const known = Object.values(typeof roStaff !== 'undefined' ? roStaff : {});
  const byId = id && known.find(k => k.id && String(k.id).replace(/^0+/, '') === id.replace(/^0+/, ''));
  if (byId && _roOcrSim(byId.name, s) >= 0.4) return { id, name: byId.name, sure: true };
  let best = null, bs = 0, second = 0;
  known.forEach(k => { const v = _roOcrSim(k.name, s); if (v > bs) { second = bs; bs = v; best = k; } else if (v > second) second = v; });
  if (best && (bs >= 0.8 || (bs >= 0.66 && bs - second >= 0.2))) return { id: best.id || id, name: best.name, sure: bs >= 0.8 };
  return { id, name: s, sure: s.length >= 3 && /[aeiou]/i.test(s) };
}
function _roOcrGroupName(t) {
  const s = String(t || '').replace(/[|\[\]{}_]/g, ' ').replace(/\s+/g, ' ').trim();
  return s && /[a-z]{3,}/i.test(s) && /[aeiouy]/i.test(s) && s.length <= 30 && !/roster|schedule|employee|name|week|front office|staff/i.test(s) ? s : '';
}

// ── The reader ────────────────────────────────────────────
/** Read a roster picture on this device. onStep(done, total, text) shows progress. */
async function roOcrRead(im, hint, onStep) {
  const step = onStep || (() => {});
  step(0, 1, 'Getting the picture reader ready…');
  const P = _roOcrPrep(im);
  _roOcrWidths = [];
  const G = _roOcrGrid(P);
  const [wd, wf] = await Promise.all([_roOcrWorker({ tessedit_char_whitelist: '0123456789:-. ' }), _roOcrWorker()]);
  try {
    if (G.vr.length < 3 || G.hr.length < 4) return await _roOcrNoLines(P, wf, hint, step);
    const thick = r => r[1] - r[0] + 1;
    const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
    const tH = med(G.hr.map(thick));
    const cols = []; for (let i = 0; i + 1 < G.vr.length; i++) if (G.vr[i + 1][0] - G.vr[i][1] > 20) cols.push({ l: G.vr[i][1] + 1, r: G.vr[i + 1][0] - 1 });
    const lines = [];   // bands and hotel bars, top to bottom
    for (let i = 0; i < G.hr.length; i++) {
      const r = G.hr[i];
      if (thick(r) > Math.max(12, tH * 4)) {
        // a dark band with writing across the day columns is a header row (white on dark), not a hotel title
        const inked = cols.slice(1).filter(c => !_roOcrCrop(P, c.l + 4, r[0] + 4, c.r - 4, r[1] - 4).empty).length;
        lines.push(inked >= Math.max(2, (cols.length - 1) / 2) ? { top: r[0], bot: r[1] } : { bar: true, top: r[0], bot: r[1] });
      }
      if (i + 1 < G.hr.length && G.hr[i + 1][0] - r[1] > 18) lines.push({ top: r[1] + 1, bot: G.hr[i + 1][0] - 1 });
    }
    // a row line the picture lost: a band twice as tall holds two rows
    const hMed = med(lines.filter(x => !x.bar).map(x => x.bot - x.top));
    for (let i = lines.length - 1; i >= 0; i--) {
      const ln = lines[i], k = Math.round((ln.bot - ln.top) / hMed);
      if (!ln.bar && k >= 2 && (ln.bot - ln.top) / hMed > 1.6) { const h = (ln.bot - ln.top) / k; lines.splice(i, 1, ...Array.from({ length: k }, (_, q) => ({ top: Math.round(ln.top + q * h), bot: Math.round(ln.top + (q + 1) * h) }))); }
    }
    const pad = 5, total = lines.filter(x => !x.bar).length * cols.length + lines.filter(x => x.bar).length + 1;
    let done = 0;
    const read = async (w, l, t, r, b) => { const cr = _roOcrCrop(P, l + pad, t + pad, r - pad, b - pad); if (cr.empty) return ''; return (await w.recognize(cr.c)).data.text.trim(); };
    // a hotel name above the table (top-left), then each band
    const bandH = med(lines.filter(x => !x.bar).map(x => x.bot - x.top));
    let group = G.hr[0][0] > bandH * 0.6 ? _roOcrGroupName(await read(wf, cols[0].l, 0, cols[0].r, G.hr[0][0])) : '';
    step(++done, total, 'Reading the table…');
    const people = [], heads = [];
    let seenPerson = false;
    for (const ln of lines) {
      if (ln.bar) { const t = _roOcrGroupName(await read(wf, cols[0].l, ln.top - 2, Math.max(cols[0].r, cols[1] ? cols[1].r : cols[0].r), ln.bot + 2)); if (t) group = t; step(++done, total); continue; }
      const nameRaw = await read(wf, cols[0].l, ln.top, cols[0].r, ln.bot);
      step(++done, total);
      const day = [];
      if (!seenPerson) {
        // header lines: read in full (dates, day names)
        for (let c = 1; c < cols.length; c++) { day.push(await read(wf, cols[c].l, ln.top, cols[c].r, ln.bot)); step(++done, total); }
        const looksHead = day.filter(_roOcrHeadLike).length >= Math.ceil(day.length / 2);
        if (looksHead) { heads.push(day); continue; }
        // not a header after all: re-read its cells the careful way
        for (let c = 1; c < cols.length; c++) { const cr = _roOcrCrop(P, cols[c].l + pad, ln.top + pad, cols[c].r - pad, ln.bot - pad); day[c - 1] = await _roOcrCell(wd, wf, cr); }
      } else {
        for (let c = 1; c < cols.length; c++) { const cr = _roOcrCrop(P, cols[c].l + pad, ln.top + pad, cols[c].r - pad, ln.bot - pad); day.push(await _roOcrCell(wd, wf, cr)); step(++done, total); }
      }
      const nm = _roOcrName(nameRaw);
      if (!nm.name || !/[a-z]{2,}/i.test(nm.name) || !day.some(Boolean)) { const gName = _roOcrGroupName(nameRaw); if (gName && !day.some(Boolean)) group = gName; continue; }
      seenPerson = true;
      people.push({ nm, day, group });
    }
    let dates = null;
    for (const h of heads) { dates = _roOcrDates(h, hint); if (dates) break; }
    if (!dates) dates = Array.from({ length: cols.length - 1 }, (_, k) => roAdd(hint, k));
    const small = im.naturalWidth < 900 ? ' The picture is small, so more cells may need checking; the original full-size picture reads best.' : '';
    return _roOcrRes(people, dates, 'Read on this device from the table lines. Check it against the picture before saving.' + small);
  } finally { wd.terminate(); wf.terminate(); }
}

/** The roster checks itself: a value seen once that is one character away from a value
 *  used all over the roster is most likely a misread. Fixed and marked for checking. */
function _roOcrFix(people) {
  const tCnt = {}, wCnt = {}, durCnt = {};
  const dur = t => { const m = t.match(/(\d\d):(\d\d) - (\d\d):(\d\d)/); if (!m) return null; let d = (+m[3] * 60 + +m[4]) - (+m[1] * 60 + +m[2]); if (d <= 0) d += 1440; return d; };
  const split = v => { const k = v.replace(/\s*\?$/, ''), t = _roOcrTime(k); return t ? { t: t.s, tail: _roOcrTail(k), ok: t.ok } : { w: k }; };
  people.forEach(p => p.day.forEach(v => { if (!v || v === '?') return; const x = split(v); if (x.t) { tCnt[x.t] = (tCnt[x.t] || 0) + 1; const d = dur(x.t); durCnt[d] = (durCnt[d] || 0) + 1; } else wCnt[x.w.toUpperCase()] = (wCnt[x.w.toUpperCase()] || 0) + 1; }));
  const commonT = Object.keys(tCnt).filter(k => tCnt[k] >= 3), commonW = Object.keys(wCnt).filter(k => wCnt[k] >= 2);
  const nT = Object.values(durCnt).reduce((a, b) => a + b, 0);
  const usualDur = new Set(Object.keys(durCnt).filter(d => durCnt[d] >= 3 && durCnt[d] >= nT * 0.15).map(Number));
  const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
  const known = Object.keys(roAllCodes());
  people.forEach(p => { p.day = p.day.map(v => {
    if (!v || v === '?') return v;
    const flagged = /\?$/.test(v), x = split(v);
    if (x.t) {
      if (tCnt[x.t] >= 3 && x.ok) return v;
      const near = commonT.filter(c => c !== x.t && lev(c, x.t) <= 1);
      const normal = usualDur.has(dur(x.t)) && x.ok;
      const usualNear = near.filter(c => usualDur.has(dur(c)));
      if (!normal && usualNear.length === 1) return usualNear[0] + (x.tail ? ' - ' + x.tail : '') + ' ?';   // e.g. 18:00 - 04:00 → 19:00 - 04:00
      if (!flagged && (!normal || (near.length && tCnt[x.t] <= 2))) return v + ' ?';                       // odd length, or rare and close to a common one: check it
      return v;
    }
    const W = x.w.toUpperCase();
    if (known.includes(W) || x.w.length > 6) return v;
    const kc = known.filter(k => k.length === W.length && k.length >= 2 && lev(k, W) <= 1);
    if (kc.length && !(wCnt[W] >= 3)) { const used = kc.filter(k => wCnt[k] >= 1); const pick = used.length === 1 ? used[0] : kc.length === 1 ? kc[0] : ''; return (pick || x.w) + ' ?'; }
    if (wCnt[W] >= 2) return v;
    let c = commonW.filter(k => lev(k, W) <= 1 && k.length >= 2);
    if (c.length !== 1) c = known.filter(k => lev(k, W) <= 1 && k.length >= 2 && Math.abs(k.length - W.length) <= 1);
    return c.length === 1 ? c[0] + ' ?' : v;
  }); });
}

function _roOcrRes(people, dates, note) {
  _roOcrFix(people);
  const names = [], cells = {}, groups = {}, ids = {};
  let unsureNames = 0;
  people.forEach(p => {
    let n = p.nm.name;
    if (!p.nm.sure) { unsureNames++; n += ' ?'; }
    if (cells[n]) n += ' (2)';
    names.push(n);
    cells[n] = {};
    p.day.forEach((v, i) => { if (v && dates[i]) cells[n][dates[i]] = v; });
    if (p.group) groups[n] = p.group;
    if (p.nm.id) ids[n] = p.nm.id;
  });
  if (!names.length) throw new Error('No names found in the picture. Try a clearer picture or a screenshot of the roster.');
  return { names, dates, cells, groups, ids, terms: [], notes: note + (unsureNames ? ` ${unsureNames} name${unsureNames === 1 ? '' : 's'} could not be read clearly (ending in ?): tap to correct.` : ''), by: '📷 Read on this device' };
}

/** No table lines: read every word with its position and rebuild rows and columns. */
async function _roOcrNoLines(P, wf, hint, step) {
  step(0, 1, 'No table lines found: reading word by word…');
  await wf.setParameters({ tessedit_pageseg_mode: '11' });
  const { data } = await wf.recognize(P.c, {}, { blocks: true });
  const words = [];
  (data.blocks || []).forEach(b => (b.paragraphs || []).forEach(p => (p.lines || []).forEach(l => (l.words || []).forEach(w => { if (w.text.trim()) words.push(w); }))));
  if (!words.length) throw new Error('No text found in the picture.');
  const hMed = words.map(w => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b)[words.length >> 1];
  // rows: words whose middles are close
  const rows = [];
  words.slice().sort((a, b) => (a.bbox.y0 + a.bbox.y1) - (b.bbox.y0 + b.bbox.y1)).forEach(w => {
    const y = (w.bbox.y0 + w.bbox.y1) / 2, r = rows.find(r => Math.abs(r.y - y) < hMed * 0.6);
    if (r) { r.w.push(w); r.y = (r.y * (r.w.length - 1) + y) / r.w.length; } else rows.push({ y, w: [w] });
  });
  rows.forEach(r => r.w.sort((a, b) => a.bbox.x0 - b.bbox.x0));
  // columns: from the header row with the most dates or day names
  let head = null, best = 0;
  rows.slice(0, 8).forEach(r => { const k = r.w.filter(w => roParseDate(w.text, hint) || _RO_DAYNAME.test(w.text)).length; if (k > best) { best = k; head = r; } });
  if (!head || best < 3) throw new Error('Couldn\'t find the days in this picture. A screenshot of the roster table reads best.');
  const hw = head.w.filter(w => roParseDate(w.text, hint) || _RO_DAYNAME.test(w.text));
  const centers = hw.map(w => (w.bbox.x0 + w.bbox.x1) / 2);
  const gap = (centers[centers.length - 1] - centers[0]) / Math.max(1, centers.length - 1);
  const dates = _roOcrDates(hw.map(w => w.text), hint) || centers.map((_, k) => roAdd(hint, k));
  const people = [];
  let group = '';
  rows.filter(r => r.y > head.y + hMed).forEach(r => {
    const name = r.w.filter(w => (w.bbox.x0 + w.bbox.x1) / 2 < centers[0] - gap / 2).map(w => w.text).join(' ');
    const day = centers.map(() => []);
    r.w.forEach(w => { const cx = (w.bbox.x0 + w.bbox.x1) / 2; if (cx < centers[0] - gap / 2) return; let k = 0, d = 1e9; centers.forEach((c, i) => { if (Math.abs(c - cx) < d) { d = Math.abs(c - cx); k = i; } }); if (d < gap * 0.6) day[k].push(w); });
    const vals = day.map(ws => { if (!ws.length) return ''; const t = ws.map(w => w.text).join(' '), conf = Math.min(...ws.map(w => w.confidence)); const tm = _roOcrTime(t); const v = tm ? tm.s + (_roOcrTail(t) ? ' - ' + _roOcrTail(t) : '') : _roOcrWord(t); return v + (conf < 70 || (tm && !tm.ok) ? ' ?' : ''); });
    if (!vals.some(Boolean)) { const g = _roOcrGroupName(name); if (g) group = g; return; }
    const nm = _roOcrName(name);
    if (nm.name) people.push({ nm, day: vals, group });
  });
  return _roOcrRes(people, dates, 'This picture has no table lines, so it was read word by word. Check every row against the picture.');
}

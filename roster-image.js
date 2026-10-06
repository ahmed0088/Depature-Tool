// ═══════════════════════════════════════════════════════════
//  roster-image.js — the roster comes as a picture
//
//  Management sends the roster as an image. Drop it, paste it or pick it
//  on the Roster page and:
//    • Claude (Anthropic's AI, with a key saved on this device) reads the
//      table, whatever its layout: hotels, names, dates, every cell, and
//      what the odd words mean. You check the result, fix any cell, save.
//    • The picture itself is kept, so anyone can open the original from
//      the Roster page.
//    • Saving posts it: the team gets "New roster posted".
//  Without a key the picture can still be posted for everyone to see, and
//  the shifts typed in with Edit.
//
//  Firebase: roster/images/{id} = the picture (JPEG data URL)
//            roster/imageIndex/{id} = { at, by, from, to, people }
//  The key never leaves this device except to call api.anthropic.com.
// ═══════════════════════════════════════════════════════════

const RI_CFG_KEY = 'roster_ai_v1';
const RI_MODELS = [
  ['claude-sonnet-5-5', 'Sonnet 5.5 (recommended)'],
  ['claude-opus-5-5', 'Opus 5.5 (hardest pictures, costs more)'],
  ['claude-haiku-4-5-20251001', 'Haiku 4.5 (cheapest, less exact)'],
];
let riPending = null;     // { dataUrl } waiting for "Save roster"
let riIndex = {};         // pictures already posted

function riCfg() { try { return JSON.parse(localStorage.getItem(RI_CFG_KEY) || '{}') || {}; } catch (_) { return {}; } }
function riSetCfg(c) { try { localStorage.setItem(RI_CFG_KEY, JSON.stringify(c)); } catch (_) {} }

// ── Picture in ────────────────────────────────────────────
function riLoadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => { resolve(im); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This picture format can\'t be opened here. Take a screenshot of the roster and use that.')); };
    im.src = url;
  });
}
/** Resized JPEG as a data URL: long side at most `max` px. */
function riJpeg(im, max, q) {
  const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.imageSmoothingQuality = 'high';
  x.drawImage(im, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}

async function riFromFile(input) {
  const f = input && input.files && input.files[0];
  if (input) input.value = '';
  if (f) await roFromImage(f);
}

/** Start here with any picture of a roster. */
async function roFromImage(file) {
  if (!roCanEdit()) { showToast('Only supervisors, managers and owners can post the roster', 'err'); return; }
  if (!file || !/^image\//.test(file.type || '') && !/\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name || '')) { showToast('That isn\'t a picture', 'warn'); return; }
  roImportOpen(true);
  const box = document.getElementById('roPreview');
  let im;
  try { im = await riLoadImage(file); } catch (e) { showToast(e.message, 'err'); return; }
  riRetry._im = im;
  const shown = riJpeg(im, 1800, 0.78);
  riPending = { dataUrl: shown };
  const cfg = riCfg();
  const useAi = !!cfg.key && cfg.engine !== 'device' && riRetry._engine !== 'device';
  riRetry._engine = '';
  if (!useAi) return riReadOnDevice(im, shown);
  box.innerHTML = `${riPicHtml(shown)}<div class="ri-reading"><span class="ri-spin"></span><div><b>Reading the roster with AI…</b><small>Names, dates and every shift. This takes about 20–40 seconds.</small></div></div>`;
  try {
    const forAi = riJpeg(im, 2000, 0.9);
    const json = await riAskAI(forAi.split(',')[1], document.getElementById('roImpWeek')?.value || roMonday(new Date()));
    const res = riToRes(json);
    res.by = '✨ Read by AI';
    roShowPreview(res);
    box.insertAdjacentHTML('afterbegin', riPicHtml(shown));
  } catch (e) {
    console.warn('[roster-image]', e);
    box.innerHTML = `${riPicHtml(shown)}<div class="ro-warn">The AI couldn't read the roster: ${escapeHtml(e.message || String(e))}</div>
      <div class="ro-acts"><button class="btn gold" onclick="riRetry('device')">📷 Read it on this device</button><button class="btn" onclick="riRetry()">↻ Try the AI again</button><button class="btn" onclick="riPostPictureOnly()">📌 Post the picture only</button></div>`;
  }
}
/** Free reading on this device (no AI, no key). */
async function riReadOnDevice(im, shown) {
  const box = document.getElementById('roPreview');
  const hint = (document.getElementById('roImpWeek')?.value) || roAdd(roMonday(new Date()), [0, 4, 5, 6].includes(new Date().getDay()) ? 7 : 0);
  box.innerHTML = `${riPicHtml(shown)}<div class="ri-reading"><span class="ri-spin"></span><div><b id="riStepT">Reading the roster on this device…</b><small id="riStepS">The first time it downloads its reader (about 3 MB). Then it takes about a minute.</small><div class="ri-bar"><i id="riStepBar" style="width:2%"></i></div></div></div>`;
  const t0 = Date.now();
  try {
    const res = await roOcrRead(im, hint, (done, total, text) => {
      const bar = document.getElementById('riStepBar'); if (bar) bar.style.width = Math.max(2, Math.round(done / total * 100)) + '%';
      if (text) { const t = document.getElementById('riStepT'); if (t) t.textContent = text; }
      const sm = document.getElementById('riStepS'); if (sm && done > 1) { const left = Math.round((Date.now() - t0) / done * (total - done) / 1000); sm.textContent = `${done} of ${total} cells · about ${left < 60 ? left + ' s' : Math.round(left / 60) + ' min'} left`; }
    });
    roShowPreview(res);
    box.insertAdjacentHTML('afterbegin', riPicHtml(shown));
  } catch (e) {
    console.warn('[roster-ocr]', e);
    box.innerHTML = `${riPicHtml(shown)}<div class="ro-warn">Couldn't read the roster: ${escapeHtml(e.message || String(e))}</div>
      <div class="ro-acts"><button class="btn gold" onclick="riRetry('device')">↻ Try again</button>${riCfg().key ? '<button class="btn" onclick="riRetry(\'ai\')">✨ Read it with AI</button>' : ''}<button class="btn" onclick="riPostPictureOnly()">📌 Post the picture only</button></div>`;
  }
}
async function riRetry(engine) {
  const im = riRetry._im;
  if (!im) return;
  riRetry._engine = engine === 'device' ? 'device' : '';
  if (engine === 'ai') { const c = riCfg(); delete c.engine; riSetCfg(c); }
  const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0);
  c.toBlob(b => roFromImage(new File([b], 'roster.png', { type: 'image/png' })), 'image/png');
}
function riPicHtml(src) { return `<details class="ri-pic" open><summary>The picture</summary><img src="${src}" alt="Roster picture" onclick="riView(this.src)"></details>`; }

// ── Asking Claude to read it ──────────────────────────────
function riPrompt(weekStart) {
  return `This picture is a hotel front-office staff roster (the shift schedule) sent by management. Read the whole table exactly, whatever its layout.

Today is ${roToday()}. The roster is most likely for the week starting ${weekStart}. Where the year isn't shown, use the year that puts the dates closest to today.

Reply with ONLY one JSON object, no other text:
{
  "title": "the roster's title, or empty",
  "dates": ["YYYY-MM-DD"],
  "sections": [
    { "name": "section name as written, e.g. Ibis DD",
      "people": [ { "id": "employee number if shown, else empty", "name": "full name without the number", "cells": ["one string per date, same order as dates"] } ] }
  ],
  "terms": [ { "text": "a code or word used in the cells that is not a plain time range or OFF", "meaning": "what it most likely means in a hotel roster", "kind": "leave | off | work | morning | afternoon | night | other", "sure": true } ],
  "notes": "one or two short sentences about anything unusual: someone working at another hotel, a change marked in the picture, cells you could not read. Empty if nothing."
}

Structure:
- "dates": one per day column, left to right.
- "sections": the hotels or departments in the order shown (one section with name "" if there are none). Each person's "cells" has exactly one string per date, in the same order.
- Plain JSON only: no comments, no trailing commas.

Rules for the cells:
- Write working hours as 24-hour "HH:MM - HH:MM" (e.g. "9-6" or "9am-6pm" → "09:00 - 18:00", "7-3" → "07:00 - 15:00", "11p-7a" → "23:00 - 07:00"). Keep the hours exactly as shown; never move a shift to another day.
- Keep any extra words after the hours: "12:00 - 21:00 - Adagio".
- Keep codes as written: OFF, ALA, SL, AL, PH, "PH - 28th Aug." and so on.
- A cell merged across several days: repeat its value for each day.
- An empty cell: "". A cell you cannot read with confidence: put your best reading followed by " ?" (e.g. "09:00 - 18:00 ?"), or just "?".
- Include every person, also those on leave all week. Do not invent people or days.`;
}

async function riAskAI(b64, weekStart) {
  const cfg = riCfg();
  if (!cfg.key) throw new Error('AI reading is not set up on this device');
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({
        model: cfg.model || RI_MODELS[0][0],
        max_tokens: 16000,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
          { type: 'text', text: riPrompt(weekStart) },
        ] }],
      }),
    });
  } catch (e) { throw new Error('No connection to the AI. Check the internet and try again.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = (j.error && j.error.message) || ('error ' + r.status);
    if (r.status === 401) throw new Error('The API key was refused. Check it in AI settings.');
    if (r.status === 429 || r.status === 529) throw new Error('The AI is busy right now. Try again in a minute.');
    if (/credit|billing|balance/i.test(m)) throw new Error('The Anthropic account has no credit left. Add credit at console.anthropic.com.');
    throw new Error(m);
  }
  const txt = (j.content || []).filter(x => x.type === 'text').map(x => x.text).join('');
  const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('The AI did not find a roster table in this picture.');
  try { return JSON.parse(txt.slice(a, b + 1)); } catch (_) { throw new Error('The AI answer was cut off or unclear. Try again.'); }
}

/** The AI's JSON → the same shape a pasted roster gives. */
function riToRes(j) {
  const dates = (j.dates || []).map(d => String(d).trim());
  if (!dates.length || !dates.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d))) throw new Error('Couldn\'t tell which dates the roster is for. Set "Week starting" and try again.');
  const names = [], cells = {}, groups = {}, ids = {};
  (j.sections || []).forEach(sec => (sec.people || []).forEach(p => {
    let nm = String(p.name || '').replace(/\s+/g, ' ').trim(), id = String(p.id || '').trim();
    const m = nm.match(/^(\d{3,})\s*[-–.:]?\s*(.+)$/);
    if (m) { id = id || m[1]; nm = m[2].trim(); }
    if (!nm) return;
    if (!cells[nm]) names.push(nm);
    const row = cells[nm] = cells[nm] || {};
    (p.cells || []).forEach((v, i) => { v = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); if (v && dates[i]) row[dates[i]] = v; });
    if (sec.name) groups[nm] = String(sec.name).trim();
    if (id) ids[nm] = id;
  }));
  if (!names.length) throw new Error('No names found in the picture.');
  return { names, dates: [...new Set(dates)].sort(), cells, groups, ids, terms: Array.isArray(j.terms) ? j.terms : [], notes: String(j.notes || '').trim(), title: String(j.title || '') };
}

// ── Keeping the picture ───────────────────────────────────
function _riDb() { return typeof _ref !== 'undefined' && _ref ? _ref : null; }   // straight to Firebase: too big for the local copy
/** Called by roPost() when a roster is saved: store the picture that came with it. */
async function riStorePending(res) {
  if (!riPending) return null;
  const db = _riDb(), id = 'p' + Date.now().toString(36);
  const meta = { at: Date.now(), by: (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || '', from: res.dates[0], to: res.dates[res.dates.length - 1], people: res.names.length };
  const data = riPending.dataUrl;
  riPending = null;
  if (!db) return null;
  await db.child('roster/images/' + id).set(data);
  await db.child('roster/imageIndex/' + id).set(meta);
  riIndex[id] = meta;
  // keep the 12 newest pictures
  const old = Object.entries(riIndex).sort((a, b) => b[1].at - a[1].at).slice(12);
  old.forEach(([k]) => { db.child('roster/images/' + k).remove(); db.child('roster/imageIndex/' + k).remove(); });
  return id;
}
/** No AI: post just the picture for its week. */
function riPostPictureOnly() {
  if (!riPending) return;
  const ws = document.getElementById('roImpWeek')?.value || roMonday(new Date());
  const dates = [0, 1, 2, 3, 4, 5, 6].map(i => roAdd(ws, i));
  roPost({ dates, names: [] }).then(() => { showToast('Roster picture posted. The team can open it on the Roster page', 'ok'); roImportOpen(false); document.getElementById('roPreview').innerHTML = ''; roWeek = ws; roRender(); });
}
/** The newest picture covering a week. */
function riPicFor(weekStart) {
  const end = roAdd(weekStart, 6);
  return Object.entries(riIndex).filter(([, m]) => m.from <= end && m.to >= weekStart).sort((a, b) => b[1].at - a[1].at)[0] || null;
}
async function riOpen(id) {
  const db = _riDb();
  let data = null;
  try { data = db ? (await db.child('roster/images/' + id).once('value')).val() : null; } catch (_) {}
  if (!data) { showToast('The picture isn\'t available offline', 'warn'); return; }
  riView(data);
}
function riView(src) {
  document.getElementById('riViewer')?.remove();
  const v = document.createElement('div');
  v.id = 'riViewer'; v.className = 'ri-viewer';
  v.innerHTML = `<div class="ri-v-bar"><b>Roster picture</b><span><button class="btn sm" onclick="document.getElementById('riViewer').classList.toggle('zoom')">🔍 Zoom</button><button class="btn sm" onclick="document.getElementById('riViewer').remove()">✕ Close</button></span></div><div class="ri-v-body"><img src="${src}" alt="Roster picture"></div>`;
  v.addEventListener('click', e => { if (e.target === v) v.remove(); });
  document.body.appendChild(v);
}

// ── AI settings (this device only) ────────────────────────
function riSetupOpen() {
  const cfg = riCfg();
  document.getElementById('riSetup')?.remove();
  const d = document.createElement('div');
  d.id = 'riSetup'; d.className = 'ri-viewer';
  d.innerHTML = `<div class="ri-setup card">
    <div class="ro-card-hd"><b>✨ AI reading of roster pictures</b><button class="ro-x" onclick="document.getElementById('riSetup').remove()">✕</button></div>
    <p>Roster pictures are read <b>on this device for free</b> (the table's lines, cell by cell). For pictures without clear table lines, phone photos at an angle, or to get the meaning of odd words explained, you can use <b>Claude, Anthropic's AI</b> instead. It needs an Anthropic API key, set once on the device that posts the roster.</p>
    <label>Read roster pictures<select id="riEngine"><option value="device"${cfg.engine === 'device' || !cfg.key ? ' selected' : ''}>On this device (free)</option><option value="ai"${cfg.key && cfg.engine !== 'device' ? ' selected' : ''}>With AI (Claude, needs a key)</option></select></label>
    <ol><li>Go to <b>console.anthropic.com</b>, sign in, add a little credit (Billing).</li><li>Open <b>API keys</b> → <b>Create key</b>, copy it.</li><li>Paste it below and press Save. Each roster costs a few cents.</li></ol>
    <label>API key<input id="riKey" type="password" autocomplete="off" placeholder="sk-ant-…" value="${escapeHtml(cfg.key || '')}"></label>
    <label>Model<select id="riModel">${RI_MODELS.map(([v, t]) => `<option value="${v}"${(cfg.model || RI_MODELS[0][0]) === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
    <small class="ro-hint">The key is kept on this device only (not in the team database) and is sent only to api.anthropic.com. Use this on your own phone or PC, not a shared desk PC.</small>
    <div class="ro-acts"><button class="btn gold" onclick="riSaveSetup()">Save</button>${cfg.key ? '<button class="btn" onclick="riForget()">Remove key</button>' : ''}</div>
  </div>`;
  d.addEventListener('click', e => { if (e.target === d) d.remove(); });
  document.body.appendChild(d);
}
function riSaveSetup() {
  const key = document.getElementById('riKey').value.trim(), engine = document.getElementById('riEngine').value;
  if (engine === 'ai' && !/^sk-ant-/.test(key)) { showToast('To use AI, paste an Anthropic key (it starts with sk-ant-)', 'warn'); return; }
  if (key && !/^sk-ant-/.test(key)) { showToast('That doesn\'t look like an Anthropic key (it starts with sk-ant-)', 'warn'); return; }
  riSetCfg({ key, model: document.getElementById('riModel').value, engine });
  document.getElementById('riSetup')?.remove();
  showToast(engine === 'ai' ? 'Roster pictures will be read with AI on this device' : 'Roster pictures will be read on this device', 'ok');
  riRenderAiLine();
  if (riPending && riRetry._im) riRetry();
  else if (riPending) { const im = new Image(); im.onload = () => { riRetry._im = im; riRetry(); }; im.src = riPending.dataUrl; }
}
function riForget() { riSetCfg({}); document.getElementById('riSetup')?.remove(); riRenderAiLine(); showToast('API key removed from this device', 'ok'); }
function riRenderAiLine() {
  const el = document.getElementById('riAiLine');
  if (!el) return;
  const cfg = riCfg();
  el.innerHTML = cfg.key && cfg.engine !== 'device'
    ? `✨ Pictures are read with AI (${escapeHtml((RI_MODELS.find(m => m[0] === cfg.model) || RI_MODELS[0])[1].replace(/ \(.*/, ''))}) · <a href="javascript:void 0" onclick="riSetupOpen()">change</a>`
    : `📷 Pictures are read on this device, free · <a href="javascript:void 0" onclick="riSetupOpen()">options</a>`;
}

// ── Start ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // paste a picture (Ctrl+V / long-press paste) while the Roster page is open
  document.addEventListener('paste', e => {
    if (!document.getElementById('panel-roster')?.classList.contains('active')) return;
    const f = [...(e.clipboardData && e.clipboardData.files || [])].find(x => /^image\//.test(x.type));
    if (f) { e.preventDefault(); roFromImage(f); }
  });
  setTimeout(() => {
    const db = _riDb();
    if (db) db.child('roster/imageIndex').on('value', s => { riIndex = s.val() || {}; if (document.getElementById('panel-roster')?.classList.contains('active') && typeof roRender === 'function') roRender(); });
  }, 1700);
});

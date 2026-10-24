// ═══════════════════════════════════════════════════════════
//  opera-folder.js — Opera folder watch + daily backup to a folder
//  Desk PC only (Chrome / Edge: File System Access API).
//
//  1) Watch a folder: pick the folder Opera Cloud exports land in
//     (e.g. Downloads/Opera) once. While the tab is visible HotelOps
//     looks at it every 45 s (and when the tab comes back) and loads
//     new or changed reports through file-router.js — the same path a
//     drag-and-drop takes, so the same parsers run.
//     • first run: files from before today are ignored
//     • .crdownload / .tmp / .part / ~$ files are ignored, and a file is
//       only loaded once its size is the same on two looks in a row
//       (Chrome writes a download in pieces)
//     • nothing in the folder is ever changed or deleted (read access)
//  2) Daily backup: once a day, the first time the app is open after the
//     chosen time (06:00), writes HotelOps-backup-YYYY-MM-DD.json — the
//     same content as Settings → Download a backup — into a folder, and
//     keeps the newest N (14). Only HotelOps-backup-*.json files are
//     ever deleted.
//
//  Folder handles live in IndexedDB (hotelops-fs / handles), so they
//  survive reloads. After a reload Chrome may ask again: the browser only
//  lets a tap do that, so a "Resume watching" button shows up.
//  Saved on this device: localStorage ho_opera_folder_v1.
// ═══════════════════════════════════════════════════════════

(function (W, D) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CAN = typeof W.showDirectoryPicker === 'function';
  const KEY = 'ho_opera_folder_v1', LOCK = 'ho_opera_folder_lock';
  const POLL_MS = 45e3, QUICK_MS = 5e3;            // a file seen growing gets a quick second look instead of waiting 45 s
  const BK_RE = /^HotelOps-backup-\d{4}-\d{2}-\d{2}\.json$/;
  const TAB = Math.random().toString(36).slice(2);
  const toast = (m, t) => { try { if (typeof showToast === 'function') showToast(m, t || 'ok'); } catch (_) {} };
  const day = d => { d = d || new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const hhmm = t => { const d = new Date(t); return isNaN(d) ? '' : (day(d) === day() ? '' : day(d) + ' ') + d.toTimeString().slice(0, 5); };

  // ── saved state (this device) ─────────────────────────────
  const DEF = { watchOn: true, watchName: '', seen: {}, lastCheck: 0, lastFile: null, loaded: {}, bkName: '', bkTime: '06:00', bkKeep: 14, lastBackup: null };
  let S = load();
  function load() { try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (_) { return Object.assign({}, DEF); } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (_) {} }
  // another tab may have loaded a file meanwhile: always work from the newest copy
  function fresh() { S = load(); return S; }

  // ── handles in IndexedDB ──────────────────────────────────
  function idb() {
    return new Promise((res, rej) => {
      try {
        const r = indexedDB.open('hotelops-fs', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('handles');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    });
  }
  async function hGet(k) {
    try { const db = await idb(); return await new Promise(res => { const q = db.transaction('handles').objectStore('handles').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); }
    catch (_) { return null; }
  }
  async function hSet(k, v) {
    try { const db = await idb(); await new Promise(res => { const t = db.transaction('handles', 'readwrite'); t.objectStore('handles').put(v, k); t.oncomplete = res; t.onerror = res; }); }
    catch (_) {}
  }

  let watchDir = null, bkDir = null;
  const perm = { watch: 'none', backup: 'none' };      // granted | prompt | denied | none
  async function query(h, mode) {
    if (!h) return 'none';
    try { return h.queryPermission ? await h.queryPermission({ mode }) : 'granted'; } catch (_) { return 'prompt'; }
  }
  async function ask(h, mode) {
    if (!h) return 'none';
    try {
      let p = await query(h, mode);
      if (p !== 'granted' && h.requestPermission) p = await h.requestPermission({ mode });
      return p;
    } catch (_) { return 'prompt'; }
  }

  // ── 1) watch the Opera folder ─────────────────────────────
  // temp / partial / hidden / Office lock files, and our own backups
  const SKIP = n => /\.(crdownload|tmp|part|partial|download|opdownload)$/i.test(n) || /^(~\$|\.)/.test(n) || /\.json$/i.test(n) || /^desktop\.ini$/i.test(n);

  async function list(dir) {
    const out = [];
    try {
      const it = dir.values ? dir.values() : dir.entries();
      for await (const x of it) {
        const h = Array.isArray(x) ? x[1] : x;
        if (!h || h.kind !== 'file' || SKIP(h.name)) continue;
        try { const f = await h.getFile(); out.push({ name: h.name, size: f.size, mod: f.lastModified, file: f }); } catch (_) {}   // locked while Opera is still writing it: next time
      }
    } catch (e) { console.warn('[opera-folder] list failed', e); }
    return out;
  }

  // the user is typing somewhere: switching page under them is rude, so wait (at most 3 looks)
  let _waited = 0;
  function busy() {
    const a = D.activeElement;
    const typing = a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) && a.type !== 'file' && a.type !== 'checkbox';
    return typing || !!D.getElementById('frSheet');
  }

  // only one tab looks at the folder (two tabs would load each file twice)
  function lockOk() {
    try {
      const l = JSON.parse(localStorage.getItem(LOCK) || 'null');
      if (l && l.id !== TAB && Date.now() - l.at < POLL_MS * 2.5) return false;
      localStorage.setItem(LOCK, JSON.stringify({ id: TAB, at: Date.now() }));
    } catch (_) {}
    return true;
  }

  let _checking = false, _quick = null;
  async function checkNow(manual) {
    if (!CAN || _checking) return { loaded: [] };
    if (!watchDir) { if (manual) toast('Choose the Opera folder first', 'err'); return { loaded: [] }; }
    if (!manual && (!S.watchOn || !lockOk())) return { loaded: [] };
    perm.watch = await query(watchDir, 'read');
    if (perm.watch !== 'granted') { paint(); pill(); return { loaded: [] }; }
    _checking = true;
    const loaded = [];
    try {
      fresh();
      const files = await list(watchDir);
      const first = !Object.keys(S.seen).length;
      const today0 = new Date(); today0.setHours(0, 0, 0, 0);
      const ready = [];
      let growing = false;
      const names = new Set(files.map(f => f.name));
      Object.keys(S.seen).forEach(n => { if (!names.has(n)) delete S.seen[n]; });   // gone from the folder: forget it
      for (const f of files) {
        const s = S.seen[f.name];
        if (!s) {
          // first look at this folder: what's there from before today is old news
          S.seen[f.name] = (first && f.mod < today0.getTime()) ? { s: f.size, m: f.mod, st: 'old' } : { s: f.size, m: f.mod, st: 'pend' };
          if (S.seen[f.name].st === 'pend') growing = true;
          continue;
        }
        if (s.st === 'pend') {
          if (s.s === f.size && s.m === f.mod && f.size > 0) ready.push(f);
          else { s.s = f.size; s.m = f.mod; growing = true; }
          continue;
        }
        if (s.s !== f.size || s.m !== f.mod) { S.seen[f.name] = { s: f.size, m: f.mod, st: 'pend' }; growing = true; }   // changed (exported again under the same name)
      }
      if (ready.length && busy() && !manual && _waited < 3) { _waited++; ready.length = 0; growing = true; }
      if (ready.length) { _waited = 0; loaded.push(...await route(ready)); }
      S.lastCheck = Date.now();
      save();
      clearTimeout(_quick);
      if (growing && S.watchOn) _quick = setTimeout(() => checkNow(), QUICK_MS);
    } catch (e) { console.warn('[opera-folder] check failed', e); }
    finally { _checking = false; }
    paint();
    return { loaded };
  }

  // Hand ready files to file-router.js: frDetect says where each goes, frSend loads it the
  // way a drop would. Files it can't place (or a backup .json) are left alone: a pop-up
  // asking "where does this go?" while nobody is at the desk would just wait there.
  async function route(ready) {
    const out = [];
    if (typeof frDetect !== 'function' || typeof frSend !== 'function') { ready.forEach(f => { S.seen[f.name].st = 'skip'; }); return out; }
    const groups = {};
    for (const f of ready) {
      let g = { dest: null };
      try { g = frDetect(f.name, typeof _frReadHead === 'function' ? await _frReadHead(f.file) : ''); } catch (_) {}
      const dest = g && g.dest && g.dest !== 'backup' && typeof FR_DEST !== 'undefined' && FR_DEST[g.dest] ? g.dest : null;
      S.seen[f.name].st = dest ? 'done' : 'skip';
      if (dest) (groups[dest] = groups[dest] || []).push(f);
    }
    // Always the LAST export of each kind:
    //  • several new files of one kind in one look → only the newest (by lastModified) is loaded, the rest are just marked seen
    //  • a file older than the one already loaded for that kind today is never loaded over it
    // Pages that take several files at once (DTCM Recon …) get them all, oldest → newest, so the newest is applied last.
    const today = day();
    Object.keys(S.loaded).forEach(k => { if (S.loaded[k].day !== today) delete S.loaded[k]; });   // yesterday's doesn't count
    // kinds in order of their newest file, so the page left open at the end is the most recent export
    const order = Object.entries(groups).sort((a, b) => Math.max(...a[1].map(f => f.mod)) - Math.max(...b[1].map(f => f.mod)));
    for (const [dest, fs] of order) {
      const d = FR_DEST[dest], cur = S.loaded[dest];
      fs.sort((a, b) => a.mod - b.mod);
      const fresh_ = cur ? fs.filter(f => f.mod >= cur.mod) : fs;
      fs.filter(f => !fresh_.includes(f)).forEach(f => { S.seen[f.name].st = 'older'; });
      if (!fresh_.length) continue;
      const send = d.multi ? fresh_ : [fresh_[fresh_.length - 1]];
      if (!d.multi) fresh_.slice(0, -1).forEach(f => { S.seen[f.name].st = 'older'; });
      try {
        await frSend(dest, send.map(f => f.file));
        const label = d.label.replace(/ ·.*$/, '');
        // the page says its own "✓ 6 departures loaded" first; ours follows unless the page showed a problem
        const msg = `📂 Loaded ${label} from ${send.map(f => f.name).join(', ')}`;
        toast(msg, 'ok');
        setTimeout(() => { const t = D.getElementById('appToast'); if (!t || !/240,\s*107,\s*122/.test(t.style.background)) toast(msg, 'ok'); }, 1500);
        const newest = send[send.length - 1];
        S.loaded[dest] = { name: send.map(f => f.name).join(', '), label: d.label, ico: d.ico, mod: newest.mod, at: Date.now(), day: today };
        S.lastFile = { name: S.loaded[dest].name, label, at: Date.now() };
        out.push({ dest, files: send.map(f => f.name) });
      } catch (e) { console.warn('[opera-folder] load failed', e); toast(`Could not load ${send[0].name}`, 'err'); }
    }
    return out;
  }

  async function pick() {
    if (!CAN) return false;
    try {
      const h = await W.showDirectoryPicker({ id: 'hotelops-opera', mode: 'read' });
      if (!h) return false;
      watchDir = h; perm.watch = 'granted';
      await hSet('watch', h);
      fresh();
      if (S.watchName !== h.name || !Object.keys(S.seen).length) S.seen = {};   // another folder: start over (old files ignored again)
      S.watchName = h.name; S.watchOn = true; save();
      toast(`📂 Watching ${h.name}`, 'ok');
      await checkNow(true);
      start();
      return true;
    } catch (e) { if (e && e.name !== 'AbortError') toast('Could not open that folder', 'err'); return false; }
    finally { paint(); pill(); }
  }

  function setWatch(on) { fresh(); S.watchOn = !!on; save(); if (on) checkNow(true); paint(); }

  // ── 2) daily backup into a folder ─────────────────────────
  // Same content as db.js exportAllData() (Settings → Download a backup): the whole database as one JSON file.
  async function backupJson() {
    if (typeof fbGet !== 'function') return null;
    const snap = await fbGet('');
    if (!snap || typeof snap !== 'object' || !Object.keys(snap).length) return null;   // offline with nothing saved: never write (and prune with) an empty file
    return JSON.stringify(snap, null, 2);
  }
  function allowed() {
    try { if (W.hoRoleRules && typeof W.hoRoleRules.can === 'function' && !W.hoRoleRules.can('canExport')) return false; } catch (_) {}
    return true;
  }

  let _backing = false;
  async function backupNow(manual) {
    if (!CAN || _backing) return false;
    if (!bkDir) { if (manual) toast('Choose the backup folder first', 'err'); return false; }
    if (!allowed()) { if (manual) toast('Backups are not available for your role', 'err'); return false; }
    perm.backup = manual ? await ask(bkDir, 'readwrite') : await query(bkDir, 'readwrite');
    if (perm.backup !== 'granted') { paint(); pill(); return false; }
    _backing = true;
    try {
      const json = await backupJson();
      if (!json) { if (manual) toast('Nothing to back up yet (still loading?)', 'err'); return false; }
      const name = `HotelOps-backup-${day()}.json`;
      const fh = await bkDir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(new Blob([json], { type: 'application/json' }));
      await w.close();
      fresh();
      S.lastBackup = { day: day(), at: Date.now(), name, size: json.length }; save();
      try { localStorage.setItem('ho_last_backup', new Date().toISOString()); } catch (_) {}   // security.js: stops the weekly "download a backup" nudge
      await prune();
      toast('💾 Backup saved', 'ok');
      return true;
    } catch (e) { console.warn('[opera-folder] backup failed', e); toast('Backup to the folder failed', 'err'); return false; }
    finally { _backing = false; paint(); }
  }

  // newest N stay; only files named exactly HotelOps-backup-YYYY-MM-DD.json are touched
  async function prune() {
    try {
      const keep = Math.max(1, parseInt(S.bkKeep, 10) || 14), names = [];
      for await (const x of (bkDir.values ? bkDir.values() : bkDir.entries())) {
        const h = Array.isArray(x) ? x[1] : x;
        if (h && h.kind === 'file' && BK_RE.test(h.name)) names.push(h.name);
      }
      names.sort().reverse();
      for (const n of names.slice(keep)) { try { await bkDir.removeEntry(n); } catch (_) {} }
    } catch (e) { console.warn('[opera-folder] prune failed', e); }
  }

  // once a day, the first time the app is open after the chosen time, and only when signed in
  function backupDue() {
    fresh();
    if (!bkDir || (S.lastBackup && S.lastBackup.day === day())) return false;
    if (typeof currentUser !== 'undefined' && !currentUser) return false;
    const [h, m] = String(S.bkTime || '06:00').split(':').map(Number), now = new Date();
    return now.getHours() * 60 + now.getMinutes() >= (h || 0) * 60 + (m || 0);
  }

  async function pickBackup() {
    if (!CAN) return false;
    try {
      const h = await W.showDirectoryPicker({ id: 'hotelops-backup', mode: 'readwrite' });
      if (!h) return false;
      bkDir = h; perm.backup = 'granted';
      await hSet('backup', h);
      fresh(); S.bkName = h.name; save();
      toast(`💾 Backups go to ${h.name}`, 'ok');
      if (backupDue()) await backupNow();
      return true;
    } catch (e) { if (e && e.name !== 'AbortError') toast('Could not open that folder', 'err'); return false; }
    finally { paint(); pill(); }
  }
  function setBk(k, v) {
    fresh();
    if (k === 'bkTime' && /^\d{1,2}:\d{2}$/.test(v)) S.bkTime = v;
    if (k === 'bkKeep') S.bkKeep = Math.min(365, Math.max(1, parseInt(v, 10) || 14));
    save(); paint();
  }

  // ── "Resume watching" after a reload (needs a tap) ────────
  async function resume() {
    if (watchDir) perm.watch = await ask(watchDir, 'read');
    if (bkDir) perm.backup = await ask(bkDir, 'readwrite');
    pill(); paint();
    if (perm.watch === 'granted') { checkNow(true); start(); }
    if (perm.backup === 'granted' && backupDue()) backupNow();
  }
  let _pillT = null;
  function pill() {
    const need = (watchDir && S.watchOn && perm.watch === 'prompt') || (bkDir && perm.backup === 'prompt');
    let el = D.getElementById('ofPill');
    if (!need) { if (el) el.remove(); return; }
    if (el || !D.body) return;
    const login = D.getElementById('loginScreen');
    if (login && login.style.display !== 'none' && getComputedStyle(login).display !== 'none') { clearTimeout(_pillT); _pillT = setTimeout(pill, 2e3); return; }   // after sign-in, not over the login card
    el = D.createElement('div');
    el.id = 'ofPill';
    el.innerHTML = `<button class="of-go">📂 Resume watching${watchDir && S.watchName ? ' ' + esc(S.watchName) : ''}</button><button class="of-x" aria-label="Not now">×</button>`;
    el.querySelector('.of-go').onclick = resume;
    el.querySelector('.of-x').onclick = () => el.remove();
    D.body.appendChild(el);
  }

  // ── Settings card ─────────────────────────────────────────
  function row(s, label, desc, right) {
    return `<div class="hs-row" data-s="${esc(s)}"><span class="hs-txt"><b>${label}</b><small>${desc}</small></span>${right ? `<span class="hs-inline">${right}</span>` : ''}</div>`;
  }
  function cardHtml() {
    if (!CAN) return row('opera folder watch backup', 'Opera folder & auto backup', 'Works on Chrome or Edge on the desk PC');
    const w = watchDir, b = bkDir;
    const wState = !w ? 'No folder chosen' : perm.watch === 'granted' ? (S.watchOn ? 'Watching' : 'Paused') : 'Needs a tap to resume';
    const lf = S.lastFile ? `${esc(S.lastFile.label)} · ${esc(S.lastFile.name)} · ${hhmm(S.lastFile.at)}` : 'Nothing yet';
    const today = day();
    const loadedRows = Object.values(S.loaded || {}).filter(x => x.day === today).sort((a, b) => b.at - a.at)
      .map(x => `<div class="of-kind"><span>${esc(x.ico || '📄')} ${esc(x.label)}</span><span title="${esc(x.name)}">${esc(x.name)}</span><small>exported ${hhmm(x.mod)}</small></div>`).join('');
    const lb = S.lastBackup ? `${esc(S.lastBackup.name)} · ${hhmm(S.lastBackup.at)}` : 'None yet';
    return row('opera folder watch exports downloads', 'Opera export folder', w ? `📂 <b>${esc(w.name)}</b> · ${wState}` : 'Export reports from Opera into one folder (e.g. Downloads/Opera) and HotelOps loads new ones by itself',
        `<button class="btn sm ${w ? 'ghost' : 'gold'}" data-of="pick">${w ? 'Change' : 'Choose folder'}</button>`)
      + (w ? `<label class="hs-row" data-s="opera folder watching on off"><span class="hs-txt"><b>Watch the folder</b><small>Looks every 45 s while HotelOps is open. Last check: ${S.lastCheck ? hhmm(S.lastCheck) : '—'}</small></span>
           <span class="hs-switch"><input type="checkbox" data-of="on" ${S.watchOn ? 'checked' : ''}><i></i></span></label>`
        + row('opera folder last file loaded', 'Last file loaded', lf, `${perm.watch === 'prompt' ? '<button class="btn sm gold" data-of="resume">Resume watching</button>' : ''}<button class="btn sm ghost" data-of="check">Check now</button>`)
        + (loadedRows ? `<div class="hs-row hs-col" data-s="opera folder loaded today per report kind"><span class="hs-txt"><b>Loaded today (newest export of each)</b><small>An older export never replaces a newer one</small></span><div class="of-kinds">${loadedRows}</div></div>` : '') : '')
      + row('auto backup folder daily', 'Daily backup folder', b ? `💾 <b>${esc(b.name)}</b>${perm.backup === 'granted' ? '' : ' · needs a tap'} · writes HotelOps-backup-date.json once a day` : 'Saves the same file as "Download a backup" into a folder every day',
        `<button class="btn sm ${b ? 'ghost' : 'gold'}" data-of="pickb">${b ? 'Change' : 'Choose folder'}</button>`)
      + (b ? row('backup time keep days', 'When & how many', 'First time the app is open after this time; older backups beyond the count are deleted (only HotelOps backups)',
          `<input type="time" data-of="time" value="${esc(S.bkTime)}" style="min-width:0;width:130px"><label class="of-keep">Keep <input type="number" data-of="keep" min="1" max="365" value="${esc(S.bkKeep)}" style="min-width:0;width:64px"></label>`)
        + row('last backup now', 'Last backup', lb, `<button class="btn sm" data-of="bk">Back up now</button>`) : '');
  }
  function sectionHtml() {
    const ic = (typeof hoIcon === 'function' && hoIcon('save')) || '';
    return `<section class="hs-sec" id="hs-folder">
      <div class="hs-sec-hd"><span class="hs-sec-ic">${ic}</span><div><h2>Opera folder & auto backup</h2><p>Load Opera exports by themselves · daily backup to a folder</p></div></div>
      <div class="hs-card">${cardHtml()}</div></section>`;
  }
  function paint() {
    const c = D.querySelector('#hs-folder .hs-card');
    if (!c) return;
    if (c.contains(D.activeElement) && D.activeElement.tagName === 'INPUT' && D.activeElement.type !== 'checkbox') return;   // don't wipe a time being typed
    c.innerHTML = cardHtml();
  }
  function inject() {
    const box = D.getElementById('hsBody');
    if (!box || !box.querySelector('.hs-sec') || D.getElementById('hs-folder')) return;
    const after = D.getElementById('hs-data');
    if (after) after.insertAdjacentHTML('afterend', sectionHtml()); else box.insertAdjacentHTML('beforeend', sectionHtml());
    const toc = D.querySelector('.hs-toc a[href="#hs-data"]');
    if (toc && !D.querySelector('.hs-toc a[href="#hs-folder"]')) toc.insertAdjacentHTML('afterend', '<a href="#hs-folder">Opera folder</a>');
    const q = D.getElementById('hsSearch');
    if (q && q.value && typeof hoSettingsFilter === 'function') try { hoSettingsFilter(q.value); } catch (_) {}
  }
  function wireSettings() {
    const box = D.getElementById('hsBody');
    if (!box) return;
    // settings.js redraws #hsBody with innerHTML: put the section back each time
    try { new MutationObserver(inject).observe(box, { childList: true }); } catch (_) {}
    inject();
    box.addEventListener('click', e => {
      const t = e.target.closest && e.target.closest('#hs-folder [data-of]');
      if (!t || t.tagName === 'INPUT') return;
      const a = t.dataset.of;
      if (a === 'pick') pick(); else if (a === 'pickb') pickBackup(); else if (a === 'check') checkNow(true).then(r => { if (!r.loaded.length) toast('No new Opera files', 'info'); });
      else if (a === 'bk') backupNow(true); else if (a === 'resume') resume();
    });
    box.addEventListener('change', e => {
      const t = e.target.closest && e.target.closest('#hs-folder [data-of]');
      if (!t) return;
      if (t.dataset.of === 'on') setWatch(t.checked);
      else if (t.dataset.of === 'time') setBk('bkTime', t.value);
      else if (t.dataset.of === 'keep') setBk('bkKeep', t.value);
    });
  }

  function css() {
    if (D.getElementById('ofCss')) return;
    const s = D.createElement('style');
    s.id = 'ofCss';
    s.textContent = `
#ofPill { position: fixed; left: 16px; bottom: 16px; z-index: 9000; display: flex; align-items: center; gap: 2px; background: var(--card, #1b1f27); border: 1px solid var(--accent-border, #555); border-radius: 99px; box-shadow: 0 6px 22px rgba(0,0,0,.28); padding: 3px; max-width: calc(100vw - 32px); }
#ofPill button { border: 0; background: none; color: var(--text, #eee); font: inherit; font-size: 13px; cursor: pointer; padding: 7px 12px; border-radius: 99px; }
#ofPill .of-go { background: var(--accent, #c9a14a); color: #111; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#ofPill .of-x { padding: 7px 10px; color: var(--text3, #999); }
#hs-folder .of-keep { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text2, #bbb); }
#hs-folder .of-kinds { display: grid; gap: 6px; margin-top: 10px; }
#hs-folder .of-kind { display: grid; grid-template-columns: minmax(0, 200px) minmax(0, 1fr) auto; gap: 10px; align-items: baseline; font-size: 12.5px; padding: 6px 10px; border: 1px solid var(--border, #333); border-radius: var(--r, 6px); }
#hs-folder .of-kind span:first-child { font-weight: 600; color: var(--text, #eee); }
#hs-folder .of-kind span + span { color: var(--text2, #bbb); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#hs-folder .of-kind small { color: var(--text3, #999); }
@media (max-width: 560px) { #hs-folder .of-kind { grid-template-columns: 1fr; gap: 2px; } }
#hs-folder .hs-txt b b { font-weight: 700; }
@media (max-width: 768px) { #ofPill { bottom: 76px; } }`;
    (D.head || D.documentElement).appendChild(s);
  }

  // ── start ─────────────────────────────────────────────────
  let _timer = null, _lastFocus = 0;
  function tick() {
    if (D.visibilityState === 'hidden') return;
    if (watchDir && S.watchOn) checkNow();
    if (bkDir && backupDue()) backupNow();
  }
  function start() {
    if (_timer) return;
    _timer = setInterval(tick, POLL_MS);
    D.addEventListener('visibilitychange', () => { if (D.visibilityState === 'visible') tick(); });
    W.addEventListener('focus', () => { if (Date.now() - _lastFocus > 5e3) { _lastFocus = Date.now(); tick(); } });
  }
  async function boot() {
    css();
    wireSettings();
    if (!CAN) return;
    watchDir = await hGet('watch');
    bkDir = await hGet('backup');
    perm.watch = await query(watchDir, 'read');
    perm.backup = await query(bkDir, 'readwrite');
    paint(); pill();
    if (watchDir || bkDir) {
      start();
      setTimeout(tick, 4e3);           // let the pages draw first
      setTimeout(() => { if (bkDir && backupDue()) backupNow(); }, 20e3);   // the database has answered by then
    }
  }

  W.hoOperaFolder = {
    pick, pickBackup, checkNow: () => checkNow(true), backupNow: () => backupNow(true), resume,
    state: () => ({ supported: CAN, watching: !!watchDir && S.watchOn && perm.watch === 'granted', folder: watchDir ? watchDir.name : '', backupFolder: bkDir ? bkDir.name : '',
      perm: Object.assign({}, perm), lastCheck: S.lastCheck, lastFile: S.lastFile, loaded: JSON.parse(JSON.stringify(S.loaded || {})), bkTime: S.bkTime, bkKeep: S.bkKeep, lastBackup: S.lastBackup, seen: Object.assign({}, S.seen) }),
    _tick: tick,   // tests
  };
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', () => boot().catch(() => {})); else boot().catch(() => {});
})(window, document);

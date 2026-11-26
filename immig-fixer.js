// ═══════════════════════════════════════════════════════════
//  immig-fixer.js — "Fix in Opera" card on the Immigration Check page
//  Builds a plan of EMPTY gender / nationality / ID fields from the Opera immigration report and the
//  Vicas Inhouse list (matched by room + name), lets him edit and approve each field, and copies only
//  the approved ones for the Opera profile fixer (tools/hotelops-opera-fixer.console.js).
//  · ID numbers stay in this tab's memory: never saved to the database, never logged (last 4 only).
//  · Gender / nationality decisions and the change log are shared per hotel (hotels/<id>/immigFix, immigFixLog).
//  · Nothing here writes to Opera.
// ═══════════════════════════════════════════════════════════
(function () {
  'use strict';
  const C = window.hoImmigFix; if (!C || !window.hoOperaAuto) return;
  const S = { plan: null, ok: {}, shared: {}, uaeType: '', opera: '' };
  const A = window.hoOperaAuto;
  const lsKey = () => 'hoOperaUrl_' + (typeof HOTEL_ID !== 'undefined' ? HOTEL_ID : '');   // ok: { itemId: { field: true } }
  const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  const db = () => { try { return typeof firebase !== 'undefined' && typeof HOTEL_ID !== 'undefined' && HOTEL_ID ? firebase.database() : null; } catch (_) { return null; } };
  const key = it => (it.room + '_' + String(it.arrival || '').replace(/[^0-9]/g, '')).replace(/[.#$\[\]\/]/g, '');
  const toast = (m, t) => { if (typeof showToast === 'function') showToast(m, t || 'ok'); };

  function build() {
    const rows = typeof immigAllRows2 !== 'undefined' ? immigAllRows2 : [];
    const list = typeof _immigInhouseList !== 'undefined' ? _immigInhouseList : [];
    const meta = typeof _immigMeta !== 'undefined' ? _immigMeta : {};
    S.plan = C.buildPlan(rows, list, { hotel: meta.hotel, businessDate: meta.biz, uaeIdType: S.uaeType });
    S.ok = {};
    S.plan.items.forEach(it => {
      const sh = S.shared[key(it)] || {};
      S.ok[it.id] = {};
      it.fields.forEach(f => {
        const saved = sh[f.field];
        if (saved && (f.field === 'gender' || f.field === 'nationality') && saved.value) { f.value = saved.value; f.display = f.field === 'nationality' ? saved.value + ' · ' + ((C.countryList().find(c => c.code === saved.value) || {}).name || '') : saved.value; f.source = 'saved by ' + (saved.by || 'the team'); S.ok[it.id][f.field] = !!saved.on; }
        else S.ok[it.id][f.field] = !f.needsTap && !!f.value;
      });
    });
  }
  function operaRow() {
    const ok = S.opera ? A.validateOperaUrl(S.opera) : null;
    return '<div class="imm-h"><b>Your Opera link</b><span>Paste it once. The fixer only works on this link.</span></div>' +
      '<label class="imm-lbl" for="immigOperaUrl">Paste your hotel\'s Opera link <small>(link only, no password)</small></label>' +
      '<div class="imm-row"><input id="immigOperaUrl" type="url" inputmode="url" autocomplete="off" placeholder="https://…oraclecloud.com/…/OperaCloud" value="' + esc(S.opera) + '"><button class="btn gold" id="immigOperaSave">Save link</button>' + (ok && ok.ok ? '<a class="btn" id="immigOperaOpen" href="' + esc(ok.url) + '" target="_blank" rel="noopener noreferrer">Open Opera ↗</a>' : '') + '</div>' +
      '<div class="imm-msg" id="immigOperaMsg">' + (ok && ok.ok ? 'Saved.' : 'No link saved yet.') + '</div>' +
      '';
  }
  function renderShell() {
    let el = document.getElementById('immigOperaSetup');
    if (!el) {
      const panel = document.getElementById('panel-immig'), anchor = panel && (document.getElementById('immigStep4Slot') || panel.querySelector('.imm-steps') || panel.querySelector('.howto'));
      el = document.createElement('div'); el.id = 'immigOperaSetup'; el.className = 'card imm-opera';
      if (anchor && anchor.id === 'immigStep4Slot') anchor.appendChild(el); else if (anchor) anchor.after(el); else { const res = document.getElementById('immigResults2'); if (!res) return; res.insertBefore(el, res.firstChild); }
    }
    const typing = document.activeElement && document.activeElement.id === 'immigOperaUrl';
    if (!typing) el.innerHTML = operaRow();
    const b = document.getElementById('immigOperaSave'); if (b) b.onclick = saveOperaLink;
  }
  async function loadOperaLink() {
    try { const l = localStorage.getItem(lsKey()); if (l && A.validateOperaUrl(l).ok) S.opera = l; } catch (_) {}
    const d = db(); if (d) { try { const o = await d.ref('hotels/' + HOTEL_ID + '/operaUrl').once('value'); if (o.val() && A.validateOperaUrl(o.val()).ok) S.opera = o.val(); } catch (_) {} }
    renderShell();
  }
  async function saveOperaLink() {
    const el = document.getElementById('immigOperaUrl'), msg = document.getElementById('immigOperaMsg'), v = A.validateOperaUrl(el && el.value);
    if (!v.ok) { if (msg) { msg.textContent = v.reason; msg.style.color = 'var(--red,#c0392b)'; } return; }
    S.opera = v.url; try { localStorage.setItem(lsKey(), v.url); } catch (_) {}
    const d = db(); if (d) { try { await d.ref('hotels/' + HOTEL_ID + '/operaUrl').set(v.url); } catch (_) { toast('Saved on this device only (no database access).', 'err'); } }
    toast('Opera link saved.', 'ok'); renderShell();
  }
  async function loadShared() {
    try { const l = localStorage.getItem(lsKey()); if (l && A.validateOperaUrl(l).ok) S.opera = l; } catch (_) {}
    const d = db(); if (!d || !S.plan) return;
    try { const o = await d.ref('hotels/' + HOTEL_ID + '/operaUrl').once('value'); if (o.val() && A.validateOperaUrl(o.val()).ok) S.opera = o.val(); } catch (_) {}
    try { const ps = await d.ref('hotels/' + HOTEL_ID + '/immigFixPrefs/uaeIdType').once('value'); S.uaeType = C.UAE_ID_TYPES.includes(ps.val()) ? ps.val() : ''; } catch (_) {}
    try { const bd = String((typeof _immigMeta !== 'undefined' && _immigMeta.biz) || '').slice(0, 10) || 'today'; const snap = await d.ref('hotels/' + HOTEL_ID + '/immigFix/' + bd).once('value'); S.shared = snap.val() || {}; } catch (_) { S.shared = {}; }
  }
  function chip(it, f) {
    const typeSet = !!((it.fields.find(x => x.field === 'idType') || {}).value), on = !!S.ok[it.id][f.field] && (f.field !== 'idNumber' || typeSet), dis = f.field === 'idNumber' ? !typeSet : (f.field === 'idType' ? false : !f.value);
    let val;
    if (f.field === 'gender') val = '<select data-edit="' + esc(it.id) + '|gender"><option value="">choose…</option><option' + (f.value === 'M' ? ' selected' : '') + ' value="M">M</option><option' + (f.value === 'F' ? ' selected' : '') + ' value="F">F</option></select>';
    else if (f.field === 'nationality') val = '<select data-edit="' + esc(it.id) + '|nationality"><option value="">choose…</option>' + C.countryList().map(c => '<option value="' + c.code + '"' + (c.code === f.value ? ' selected' : '') + '>' + esc(c.code + ' · ' + c.name) + '</option>').join('') + '</select>';
    else if (f.field === 'idType') val = '<select data-edit="' + esc(it.id) + '|idType"><option value="">choose…</option>' + (f.idKind === 'EID' ? C.UAE_ID_TYPES : C.ID_TYPES).map(c => '<option value="' + c + '"' + (c === f.value ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>';
    else val = '<b>' + esc(f.display) + '</b>';
    const guess = f.needsTap && f.value && f.field !== 'idType' && f.field !== 'idNumber' ? ' <small style="color:var(--amber)">tap to accept</small>' : '';
    return '<label style="display:flex;gap:6px;align-items:center;margin:2px 0;' + (dis ? 'opacity:.55' : '') + '"><input type="checkbox" data-ok="' + esc(it.id) + '|' + f.field + '"' + (on ? ' checked' : '') + (dis ? ' disabled' : '') + '> <span style="min-width:74px;color:var(--text3)">' + esc(f.label) + '</span> ' + val + ' <small style="color:var(--text3)">· ' + esc(f.source) + '</small>' + guess + '</label>';
  }
  function approvedCount() { let n = 0; Object.keys(S.ok).forEach(i => Object.keys(S.ok[i]).forEach(f => { if (S.ok[i][f]) n++; })); return n; }
  function paint() {
    const card = document.getElementById('immigFixerCard'); if (!card || !S.plan) return;
    const items = S.plan.items;
    const full = it => it.fields.length && it.fields.every(f => S.ok[it.id][f.field]);
    const ready = items.filter(it => it.fields.length && full(it)), needs = items.filter(it => it.fields.length && !full(it)), skipped = items.filter(it => !it.fields.length);
    const row = it => '<div style="border:1px solid var(--border);border-radius:9px;padding:7px 10px;margin:6px 0"><b style="color:var(--sky)">Room ' + esc(it.room) + '</b> · ' + esc(it.name) + (it.notes.length ? '<div style="font-size:0.62rem;color:var(--amber)">' + it.notes.map(esc).join(' · ') + '</div>' : '') + '<div style="font-size:0.7rem;margin-top:4px">' + it.fields.map(f => chip(it, f)).join('') + '</div></div>';
    card.innerHTML = '<div class="imm-h"><b>Step 4 · Fix the guests</b></div>' +
      '<div class="imm-sum"><span class="ok">✔ ' + ready.length + ' ready</span><span class="ask">✋ ' + needs.length + ' need your choice</span><span class="skip">' + skipped.length + ' cannot be fixed</span></div>' +
      (needs.length ? '<div class="imm-sub">Choose these, then they are ready too:</div><div style="max-height:46vh;overflow:auto">' + needs.map(row).join('') + '</div>' : '') +
      (ready.length ? '<details class="imm-more"><summary>See the ' + ready.length + ' ready guests</summary>' + ready.map(row).join('') + '</details>' : '') +
      (skipped.length ? '<details class="imm-more"><summary>Why ' + skipped.length + ' cannot be fixed</summary><div class="imm-small">' + skipped.map(it => 'Room ' + esc(it.room) + ' · ' + esc(it.name) + ' · ' + esc(it.notes.join(' · ') || 'nothing to fill')).join('<br>') + '</div></details>' : '') +
      (!items.length ? '<div class="imm-sub">Nothing to fix. All good.</div>' : '') +
      '<div class="imm-go"><button class="btn gold imm-big" id="immigFixCopy">▶ Start fixing (<span id="immigFixN">' + approvedCount() + '</span> ticked fields)</button> <button class="btn imm-big" id="immigFixCloud">☁ Run in cloud (check only)</button></div>' +
      '<details class="imm-more" id="immigCloudBox"><summary>Cloud run code</summary><div class="imm-small" id="immigCloudWant" style="margin:6px 0">When the GitHub cloud run asks for your authenticator code, type the 6 digits here and press Send. It is used once and deleted.</div><div style="display:flex;gap:8px"><input id="immigCloudCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6-digit code" style="width:130px"><button class="btn" id="immigCloudSend">Send code</button></div></details>' +
      '<div class="imm-small" id="immigFixStatus" style="margin:6px 0">' + esc(S.fxNote || '') + '</div>' + extState() +
      (helperFx() ? '<ol class="imm-3"><li>Press <b>Start fixing</b>. The list goes to your Opera tab.</li><li>In the fixer window there, press <b>Start</b>. It opens each guest and fills the empty boxes.</li><li>Check the guest, press Save in Opera yourself, then press <b>Next guest</b>.</li></ol>' : '<ol class="imm-3"><li>Press <b>Start fixing</b>. It copies the list.</li><li>In Opera: open the fixer window, paste the list, press <b>Load</b>.</li><li>Press <b>Start</b> in the window. It opens each guest and fills the empty boxes. You press Save in Opera.</li></ol>') +
      '<details class="imm-more"><summary>More</summary><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn" id="immigFixSave">Remember gender and nationality</button></div>' +
      '<div class="imm-small" style="margin-top:10px">What the fixer changed (paste its log here)</div><textarea id="immigFixLogIn" style="width:100%;height:46px;font:11px monospace"></textarea><div style="margin-top:4px"><button class="btn" id="immigFixLogSave">Save this log</button></div><div id="immigFixLogList" style="font:10px monospace;color:var(--text3);margin-top:6px;white-space:pre-wrap"></div></details>';
    card.onchange = e => {
      const t = e.target;
      if (t.dataset && t.dataset.ok) { const [id, f] = t.dataset.ok.split('|'); S.ok[id][f] = t.checked; paint(); }
      else if (t.dataset && t.dataset.edit) {
        const [id, field] = t.dataset.edit.split('|'), it = S.plan.items.find(x => x.id === id), f = it && it.fields.find(x => x.field === field);
        if (f) { f.value = t.value; f.display = field === 'nationality' && t.value ? t.value + ' · ' + t.selectedOptions[0].textContent.split(' · ')[1] : t.value; f.source = 'you chose'; S.ok[id][field] = !!t.value; if (field === 'idType' && !t.value) S.ok[id].idNumber = false;
          if (field === 'idType' && f.idKind === 'EID' && C.UAE_ID_TYPES.includes(t.value)) { S.uaeType = t.value; const d = db(); if (d) d.ref('hotels/' + HOTEL_ID + '/immigFixPrefs/uaeIdType').set(t.value).catch(() => {}); S.plan.items.forEach(o => o.fields.forEach(x => { if (x.field === 'idType' && x.idKind === 'EID' && !x.value) { x.value = t.value; x.display = t.value; x.source = 'your usual UAE type'; } })); }
          paint(); }
      }
    };
    document.getElementById('immigFixCopy').onclick = copyPlan;
    document.getElementById('immigFixCloud').onclick = copyCloudRequest;
    document.getElementById('immigCloudSend').onclick = sendCloudCode;
    watchCloudWant();
    document.getElementById('immigFixSave').onclick = saveShared;
    document.getElementById('immigFixLogSave').onclick = saveLog;
    showLog();
  }
  const helperFx = () => { try { return !!document.documentElement.dataset.hoFxHelper; } catch (_) { return false; } };
  // one line: is the Chrome helper's fixer as new as this page?  (the helper takes new fixer code from this page by itself; only an old helper needs a download)
  function extState() {
    if (!helperFx()) return '';
    const D = document.documentElement.dataset, app = parseFloat(String(typeof APP_VERSION !== 'undefined' ? APP_VERSION : '').replace(/^v/, '')) || 0, fx = parseFloat(D.hoFxCode || '0') || 0;
    let t, c = '';
    if (!D.hoFxCode) { t = '⚠ Old helper (' + (D.hoWaHelper || '?') + '): download the new helper once (Settings). After that, fixer updates need no reinstall.'; c = 'color:var(--red,#c0392b)'; }
    else if (D.hoWaUs === '0' && fx < app) { t = '⚠ Turn on "Allow User Scripts" for the helper (chrome://extensions > Details) so it can update itself.'; c = 'color:var(--red,#c0392b)'; }
    else if (fx >= app) t = '✓ Extension up to date (fixer v' + fx + ')';
    else t = '⏳ Updating the helper fixer (v' + fx + ' to v' + app + '), keep this page open a few seconds.';
    return '<div class="imm-small" id="immigExtState" style="opacity:.85;' + c + '">' + esc(t) + '</div>';
  }
  setInterval(() => { const el = document.getElementById('immigExtState'); if (!el) return; const h = document.createElement('div'); h.innerHTML = extState(); const n = h.firstChild; if (n) { el.textContent = n.textContent; el.style.cssText = n.style.cssText; } }, 2000);
  function setStatus(t, bad) { S.fxNote = String(t || ''); const el = document.getElementById('immigFixStatus'); if (el) { el.textContent = S.fxNote; el.style.color = bad ? 'var(--red,#c0392b)' : ''; } }
  window.addEventListener('message', e => {
    const d = e.source === window && e.data; if (!d || typeof d !== 'object') return;
    if (d.source === 'ho-fx-progress') setStatus(d.note, d.bad);
    else if (d.source === 'ho-fx-log' && d.entry) { const ta = document.getElementById('immigFixLogIn'); if (ta) ta.value += (ta.value ? '\n' : '') + JSON.stringify(d.entry); }
  });
  // Cloud run request: text only, no names, ID numbers as last 4. The cloud run checks these rooms in Opera (read-only) and reports. Nothing is stored by the app.
  function cloudRequestText() {
    const rows = [];
    (S.plan ? S.plan.items : []).forEach(it => {
      const ok = S.ok[it.id] || {}, f = {};
      it.fields.forEach(x => { if (ok[x.field] && x.value) f[x.field] = x; });
      if (!Object.keys(f).length) return;
      rows.push([it.room, it.arrival || '', f.gender ? f.gender.value : '', f.nationality ? f.nationality.value : '', f.idType ? f.idType.value : '', f.idNumber ? f.idNumber.display : ''].join('|'));
    });
    return rows.length ? 'CLOUD OPERA CHECK (read-only, change nothing in Opera)\nroom|arrival|gender|nationality|id type|id number last 4\n' + rows.join('\n') : '';
  }
  // the authenticator code for the GitHub cloud run: written once to a private path, the run reads it and deletes it
  async function sendCloudCode() {
    const el = document.getElementById('immigCloudCode'), v = String(el && el.value || '').replace(/\D/g, ''), d = db();
    if (!/^\d{6}$/.test(v)) return toast('Type the 6 digits from your authenticator app.', 'err');
    if (!d) return toast('Not connected to the database.', 'err');
    try { await d.ref('hotels/' + HOTEL_ID + '/operaCloudCode').set({ code: v, at: Date.now() }); el.value = ''; toast('Code sent. The cloud run uses it once.', 'ok'); } catch (_) { toast('Could not send the code.', 'err'); }
  }
  let wantRef = null;
  function watchCloudWant() {
    const d = db(); if (!d || wantRef) return;
    try { wantRef = d.ref('hotels/' + HOTEL_ID + '/operaCloudWant'); wantRef.on('value', snap => {
      const v = snap.val(), el = document.getElementById('immigCloudWant'), box = document.getElementById('immigCloudBox'); if (!el) return;
      if (v && Date.now() - Number(v.at || 0) < 200000) { el.textContent = 'The cloud run is waiting for your authenticator code now. Type it and press Send.'; el.style.color = 'var(--red,#c0392b)'; if (box) box.open = true; }
      else { el.style.color = ''; el.textContent = 'When the GitHub cloud run asks for your authenticator code, type the 6 digits here and press Send. It is used once and deleted.'; }
    }); } catch (_) { wantRef = null; }
  }
  async function copyCloudRequest() {
    const t = cloudRequestText(); if (!t) return toast('Tick at least one fix first.', 'err');
    try { await navigator.clipboard.writeText(t); toast('Copied. Paste it in your Instinct chat and send it. The cloud run checks these rooms in Opera and replies. No names or full ID numbers are in it.', 'ok'); } catch (_) { window.prompt('Copy this, then paste it in your Instinct chat:', t); }
    setStatus('Cloud request copied: paste it in your Instinct chat. It only checks, it changes nothing.', false);
  }
  async function copyPlan() {
    if (!approvedCount()) return toast('Tick at least one fix first.', 'err');
    const ov = S.opera ? A.validateOperaUrl(S.opera) : null;
    const code = C.encodePlan(S.plan, S.ok, { origin: ov && ov.ok ? ov.origin : '' });
    if (helperFx()) { setStatus('Sending to Opera…'); window.postMessage({ source: 'ho-fx-job', code, url: ov && ov.ok ? ov.url : '' }, location.origin); return; }
    try { await navigator.clipboard.writeText(code); toast('Copied. Now paste it in the fixer window in Opera. It has ID numbers: do not share it.', 'ok'); } catch (_) { window.prompt('Copy this plan:', code); }
  }
  async function saveShared() {
    const d = db(); if (!d) return toast('Not connected to the database.', 'err');
    const bd = String((typeof _immigMeta !== 'undefined' && _immigMeta.biz) || '').slice(0, 10) || 'today', patch = {}, by = (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || '';
    S.plan.items.forEach(it => it.fields.forEach(f => {
      if ((f.field === 'gender' || f.field === 'nationality') && f.value) { patch[key(it) + '/' + f.field] = { value: f.value, on: !!S.ok[it.id][f.field], by, at: new Date().toISOString() }; }
      if (f.field === 'idNumber') patch[key(it) + '/idLast4'] = { value: C.last4(f.value) };   // never the full number
    }));
    try { await d.ref('hotels/' + HOTEL_ID + '/immigFix/' + bd).update(patch); toast('Saved for the whole team (gender and nationality only).', 'ok'); } catch (e) { toast('Could not save: ' + (e.message || e), 'err'); }
  }
  function cleanLog(text) {
    return String(text || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => { let o; try { o = JSON.parse(l); } catch (_) { return null; } if (!o || !C.FIELDS.includes(o.field)) return null;
      return { t: String(o.t || '').slice(0, 30), room: C.normRoom(o.room), arrival: String(o.arrival || '').slice(0, 12), field: o.field, to: o.field === 'idNumber' ? C.last4(String(o.to || '').replace(/[^A-Za-z0-9]/g, '')) : String(o.to || '').slice(0, 4), result: String(o.result || '').slice(0, 60), dry: !!o.dry }; }).filter(Boolean);
  }
  async function saveLog() {
    const d = db(); if (!d) return toast('Not connected to the database.', 'err');
    const rows = cleanLog(document.getElementById('immigFixLogIn').value); if (!rows.length) return toast('No log lines found.', 'err');
    const by = (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || '', hotel = S.plan && S.plan.hotel || '';
    try { const ref = d.ref('hotels/' + HOTEL_ID + '/immigFixLog'); for (const r of rows) await ref.push(Object.assign({ by, hotel }, r)); document.getElementById('immigFixLogIn').value = ''; toast('Log saved (' + rows.length + ' lines).', 'ok'); showLog(); } catch (e) { toast('Could not save: ' + (e.message || e), 'err'); }
  }
  async function showLog() {
    const el = document.getElementById('immigFixLogList'), d = db(); if (!el || !d) return;
    try { const snap = await d.ref('hotels/' + HOTEL_ID + '/immigFixLog').limitToLast(15).once('value'), v = snap.val() || {}; el.textContent = Object.keys(v).map(k => v[k]).map(r => (r.t || '').slice(0, 16).replace('T', ' ') + ' room ' + r.room + ' ' + r.field + ' ' + r.to + ' · ' + r.result + (r.dry ? ' (dry)' : '') + ' · ' + (r.by || '')).reverse().join('\n') || 'No log yet.'; } catch (_) { el.textContent = ''; }
  }
  window.immigFixerRender = async function () {
    const res = document.getElementById('immigResults2'); if (!res) return;
    let card = document.getElementById('immigFixerCard');
    if (!card) { card = document.createElement('div'); card.id = 'immigFixerCard'; card.style.cssText = 'margin:12px 0;padding:12px 14px;background:var(--card);border:1px solid var(--border);border-radius:var(--r)'; res.insertBefore(card, res.firstChild); }
    renderShell();
    try { if (typeof window.immigReconcileRender === 'function') window.immigReconcileRender(); } catch (_) {}
    build(); paint(); await loadShared(); if (Object.keys(S.shared).length || S.uaeType) { build(); paint(); }
  };

  // one clear next step at a time
  function guide() {
    const nx = document.getElementById('immigStep4Slot') && document.getElementById('immNext'); if (!nx) return;
    const vic = document.getElementById('immigInhouseXmlLabel'), vOk = !!(vic && !/not loaded/i.test(vic.textContent || '')), res = document.getElementById('immigResults2'), shown = !!(res && res.style.display !== 'none' && S.plan);
    const paste = document.getElementById('immigPasteInput2'), oOk = shown || !!(paste && paste.value.trim().length > 50);
    const step = shown ? 4 : (!vOk ? 1 : (!oOk ? 2 : 3));
    const txt = { 1: 'Next: Step 1. Choose the Vicas file.', 2: 'Next: Step 2. Choose the Opera file.', 3: 'Next: Step 3. Press Check guests.', 4: 'Next: Step 4. Press Start fixing.' }[step];
    if (nx.textContent !== txt) nx.textContent = txt;
    document.querySelectorAll('#panel-immig [data-step]').forEach(n => n.classList.toggle('imm-now', Number(n.dataset.step) === step));
    const c = document.getElementById('immigFixerCard'); if (c) c.classList.toggle('imm-now', step === 4);
  }
  setInterval(guide, 700); setTimeout(guide, 300);
  window.hoImmigFixerState = S;
  // the Opera link box is on the page from the start, before any report is loaded
  const boot = () => { try { renderShell(); loadOperaLink(); } catch (_) {} };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  setTimeout(boot, 2500); setTimeout(boot, 7000);
})();

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
    return '<div style="border:1px solid var(--border);border-radius:9px;padding:7px 10px;margin:6px 0"><div style="font-size:0.66rem;color:var(--text3);margin-bottom:4px">🔗 This hotel\'s Opera Cloud link (the link only, never a username or password)</div><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><input id="immigOperaUrl" type="url" inputmode="url" autocomplete="off" placeholder="https://…oraclecloud.com/…/OperaCloud" value="' + esc(S.opera) + '" style="flex:1 1 220px;min-width:0"><button class="btn" id="immigOperaSave">Save link</button>' + (ok && ok.ok ? '<a class="btn" id="immigOperaOpen" href="' + esc(ok.url) + '" target="_blank" rel="noopener noreferrer">Open Opera ↗</a>' : '') + '</div><div id="immigOperaMsg" style="font-size:0.64rem;margin-top:4px;color:var(--text3)">' + (ok && ok.ok ? 'Saved for the team. The fixer only runs on this Opera link.' : 'No link saved yet. The fixer then runs on any Opera page.') + '</div></div>';
  }
  async function saveOperaLink() {
    const el = document.getElementById('immigOperaUrl'), msg = document.getElementById('immigOperaMsg'), v = A.validateOperaUrl(el && el.value);
    if (!v.ok) { if (msg) { msg.textContent = v.reason; msg.style.color = 'var(--red,#c0392b)'; } return; }
    S.opera = v.url; try { localStorage.setItem(lsKey(), v.url); } catch (_) {}
    const d = db(); if (d) { try { await d.ref('hotels/' + HOTEL_ID + '/operaUrl').set(v.url); } catch (_) { toast('Saved on this device only (no database access).', 'err'); } }
    toast('Opera link saved.', 'ok'); paint();
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
    card.innerHTML = '<div style="font-family:var(--mono);font-size:0.72rem;margin-bottom:8px"><b>🛠 Fix in Opera</b> · fills only EMPTY fields in a guest\'s Opera profile, never saves (you press Save). ID numbers stay on this screen only, never stored or logged in full.</div>' +
      operaRow() +
      (items.length ? '<div style="max-height:46vh;overflow:auto">' + items.map(it => '<div style="border:1px solid var(--border);border-radius:9px;padding:7px 10px;margin:6px 0"><b style="color:var(--sky)">Room ' + esc(it.room) + '</b> · ' + esc(it.name) + (it.notes.length ? '<div style="font-size:0.62rem;color:var(--amber)">' + it.notes.map(esc).join(' · ') + '</div>' : '') + '<div style="font-size:0.7rem;margin-top:4px">' + it.fields.map(f => chip(it, f)).join('') + '</div></div>').join('') + '</div>' : '<div style="font-size:0.72rem;color:var(--text3)">Nothing to fix from these files.</div>') +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px"><button class="btn" id="immigFixCopy">Copy plan for the Opera fixer (<span id="immigFixN">' + approvedCount() + '</span> approved)</button><button class="btn" id="immigFixSave">Save gender/nationality for the team</button></div>' +
      '<div style="margin-top:12px;font-family:var(--mono);font-size:0.66rem;color:var(--text3)">Fixer change log (paste what "Copy log" gave you in Opera)</div><textarea id="immigFixLogIn" style="width:100%;height:46px;font:11px monospace"></textarea><div style="display:flex;gap:8px;margin-top:4px"><button class="btn" id="immigFixLogSave">Save log for the team</button></div><div id="immigFixLogList" style="font:10px monospace;color:var(--text3);margin-top:6px;white-space:pre-wrap"></div>';
    card.onchange = e => {
      const t = e.target;
      if (t.dataset && t.dataset.ok) { const [id, f] = t.dataset.ok.split('|'); S.ok[id][f] = t.checked; const n = document.getElementById('immigFixN'); if (n) n.textContent = approvedCount(); }
      else if (t.dataset && t.dataset.edit) {
        const [id, field] = t.dataset.edit.split('|'), it = S.plan.items.find(x => x.id === id), f = it && it.fields.find(x => x.field === field);
        if (f) { f.value = t.value; f.display = field === 'nationality' && t.value ? t.value + ' · ' + t.selectedOptions[0].textContent.split(' · ')[1] : t.value; f.source = 'you chose'; S.ok[id][field] = !!t.value; if (field === 'idType' && !t.value) S.ok[id].idNumber = false;
          if (field === 'idType' && f.idKind === 'EID' && C.UAE_ID_TYPES.includes(t.value)) { S.uaeType = t.value; const d = db(); if (d) d.ref('hotels/' + HOTEL_ID + '/immigFixPrefs/uaeIdType').set(t.value).catch(() => {}); S.plan.items.forEach(o => o.fields.forEach(x => { if (x.field === 'idType' && x.idKind === 'EID' && !x.value) { x.value = t.value; x.display = t.value; x.source = 'your usual UAE type'; } })); }
          paint(); }
      }
    };
    document.getElementById('immigFixCopy').onclick = copyPlan;
    document.getElementById('immigOperaSave').onclick = saveOperaLink;
    document.getElementById('immigFixSave').onclick = saveShared;
    document.getElementById('immigFixLogSave').onclick = saveLog;
    showLog();
  }
  async function copyPlan() {
    if (!approvedCount()) return toast('Approve at least one field first.', 'err');
    const code = C.encodePlan(S.plan, S.ok, { origin: S.opera && A.validateOperaUrl(S.opera).ok ? A.validateOperaUrl(S.opera).origin : '' });
    try { await navigator.clipboard.writeText(code); toast('Plan copied. Paste it in the Opera fixer window. ID numbers are inside it: do not share it.', 'ok'); } catch (_) { window.prompt('Copy this plan:', code); }
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
    if (!card) { card = document.createElement('div'); card.id = 'immigFixerCard'; card.style.cssText = 'margin:12px 0;padding:12px 14px;background:var(--card);border:1px solid var(--border);border-radius:var(--r)'; const tw = res.querySelector('.tbl-wrap'); res.insertBefore(card, tw || null); }
    build(); paint(); await loadShared(); if (Object.keys(S.shared).length || S.uaeType) { build(); paint(); }
  };
  window.hoImmigFixerState = S;
})();

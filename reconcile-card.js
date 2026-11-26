// reconcile-card.js — "In House vs Vicas" card on the Immigration Check page (read-only; see reconcile-core.js)
(function () {
  'use strict';
  const R = window.hoReconcile; if (!R) return;
  const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  window.immigReconcileRender = function () {
    const res = document.getElementById('immigResults2'); if (!res) return;
    let card = document.getElementById('immigReconCard');
    if (!card) { card = document.createElement('div'); card.id = 'immigReconCard'; card.style.cssText = 'margin:12px 0;padding:12px 14px;background:var(--card);border:1px solid var(--border);border-radius:var(--r)'; const tw = res.querySelector('.tbl-wrap'); res.insertBefore(card, tw || null); }
    const rows = typeof immigAllRows2 !== 'undefined' ? immigAllRows2 : [], list = typeof _immigInhouseList !== 'undefined' ? _immigInhouseList : [];
    const head = '<div style="font-family:var(--mono);font-size:0.72rem;margin-bottom:8px"><b>🔎 In House vs Vicas</b> · compares the two lists room by room. Read only: nothing is saved or sent.</div>';
    if (!list.length) { card.innerHTML = head + '<div style="font-size:0.72rem;color:var(--text3)">Add the Vicas Inhouse file with the Opera report to compare the two lists.</div>'; return; }
    const r = R.reconcile(rows, list), bad = r.onlyOpera.length + r.onlyVicas.length + r.nameDiff.length;
    const sec = (title, color, items) => items.length ? '<div style="margin-top:8px"><b style="color:' + color + ';font-size:0.7rem">' + title + ' (' + items.length + ')</b>' + items.map(i => '<div style="font-size:0.7rem;padding:2px 0">Room ' + esc(i.room) + ' · ' + i.text + '</div>').join('') + '</div>' : '';
    card.innerHTML = head + '<div style="font-size:0.74rem"><b>' + r.matched + '</b> guests match in both lists across ' + r.checked + ' rooms' + (bad ? ' · <b style="color:var(--amber)">' + bad + ' to check</b>' : ' · <b style="color:var(--green,#1b9c5a)">nothing to check</b>') + '</div>' +
      sec('Names differ in the same room', 'var(--amber)', r.nameDiff.map(i => ({ room: i.room, text: 'Opera: <b>' + esc(i.opera) + '</b> · Vicas: <b>' + esc(i.vicas) + '</b>' }))) +
      sec('Only in the Opera report', 'var(--rose,#c0392b)', r.onlyOpera.map(i => ({ room: i.room, text: '<b>' + esc(i.name) + '</b> is not in the Vicas list' }))) +
      sec('Only in the Vicas list', 'var(--sky)', r.onlyVicas.map(i => ({ room: i.room, text: '<b>' + esc(i.name) + '</b> is not in the Opera report' })));
  };
})();

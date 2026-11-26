// ═══════════════════════════════════════════════════════════
//  reconcile-core.js — In House (Opera immigration report) vs Vicas Inhouse list, room by room (pure)
//  Shows who is in one list but not the other, and rooms where the names differ.
//  Read-only: it compares two lists already on screen. Nothing is saved, nothing goes to Opera.
//  Rooms with no number or 8000 and up (POS and house accounts in Opera) are left out.
// ═══════════════════════════════════════════════════════════
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.hoReconcile = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'mstr', 'master', 'sir', 'madam']);
  const tokens = s => fold(s).split(' ').filter(t => t && !TITLES.has(t));
  const normRoom = r => String(r == null ? '' : r).trim().replace(/^0+(?=\d)/, '').toUpperCase();
  const isGuestRoom = r => { const n = normRoom(r); return !!n && !(/^\d+$/.test(n) && Number(n) >= 8000); };
  const shared = (a, b) => { const B = new Set(tokens(b)); return tokens(a).filter(t => B.has(t)).length; };
  /** opera: [{room,name}], vicas: [{room,name}] -> { matched, onlyOpera, onlyVicas, nameDiff, checked } */
  function reconcile(opera, vicas) {
    const group = (list, key) => { const m = new Map(); (list || []).filter(g => isGuestRoom(g.room)).forEach(g => { const k = normRoom(g.room); if (!m.has(k)) m.set(k, []); m.get(k).push(g); }); return m; };
    const O = group(opera), V = group(vicas), rooms = [...new Set([...O.keys(), ...V.keys()])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const out = { matched: 0, onlyOpera: [], onlyVicas: [], nameDiff: [], checked: rooms.length };
    rooms.forEach(room => {
      let o = (O.get(room) || []).slice(), v = (V.get(room) || []).slice();
      // best name overlaps first
      const pairs = [];
      o.forEach((a, i) => v.forEach((b, j) => { const s = shared(a.name, b.name); if (s > 0) pairs.push({ i, j, s }); }));
      pairs.sort((x, y) => y.s - x.s);
      const usedO = new Set(), usedV = new Set();
      pairs.forEach(p => { if (!usedO.has(p.i) && !usedV.has(p.j)) { usedO.add(p.i); usedV.add(p.j); out.matched++; } });
      const lo = o.filter((_, i) => !usedO.has(i)), lv = v.filter((_, j) => !usedV.has(j));
      const n = Math.min(lo.length, lv.length);
      for (let k = 0; k < n; k++) out.nameDiff.push({ room, opera: lo[k].name, vicas: lv[k].name });
      lo.slice(n).forEach(g => out.onlyOpera.push({ room, name: g.name }));
      lv.slice(n).forEach(g => out.onlyVicas.push({ room, name: g.name }));
    });
    return out;
  }
  return { reconcile, isGuestRoom, normRoom };
});

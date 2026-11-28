// ═══════════════════════════════════════════════════════════
//  opera-auto-core.js — shared rules for HotelOps' Opera automation (pure: no page, no network)
//  Everything an Opera automation (the profile fixer today, other features later) must agree on:
//   · which Opera link belongs to a hotel (validated, never holds a username or password)
//   · which buttons automation may never press (Save, Delete, New, Enroll, Check in/out, Post ...)
//   · how guest names and empty values are compared on screen
//  The pasted console scripts in tools/ cannot import files, so each carries a small copy of the
//  rules it needs; tests/opera-auto.test.js keeps the copies honest.
// ═══════════════════════════════════════════════════════════
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.hoOperaAuto = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  /** Opera Cloud lives on oraclecloud.com / oraclehospitality hosts. A link with credentials in it is refused. */
  function validateOperaUrl(input) {
    const raw = String(input&&typeof input==='object'?input.url||'':input||'').trim();
    if (!raw) return { ok: false, reason: 'Paste the hotel\'s Opera Cloud link.' };
    let u; try { u = new URL(raw); } catch (_) { return { ok: false, reason: 'That is not a web link.' }; }
    if (u.protocol !== 'https:') return { ok: false, reason: 'The Opera link must start with https://' };
    if (u.username || u.password) return { ok: false, reason: 'Remove the username/password from the link. Never store a login here.' };
    const h = u.hostname.toLowerCase();
    if (!(/(^|\.)oraclecloud\.com$/.test(h) || /(^|\.)oraclehospitality\.[a-z0-9.-]+$/.test(h))) return { ok: false, reason: 'That does not look like an Opera Cloud link (oraclecloud.com).' };
    if (/[?&#](pass|pwd|password|token|key|secret)/i.test(u.search + u.hash)) return { ok: false, reason: 'The link carries a password or token. Paste the plain link.' };
    return { ok: true, url: u.origin + u.pathname, origin: u.origin, host: h };
  }
  /** Buttons no automation may press: only the person at the keyboard does. */
  const FORBIDDEN = /\b(save|ok|submit|apply|confirm|done|yes|delete|remove|cancel|check ?in|check ?out|post|settle|finish|close|discard|new|create|enroll|merge|pay)\b/i;
  const isForbiddenControl = text => FORBIDDEN.test(String(text || '').trim());
  const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'sir', 'mstr', 'master', 'mx']);
  const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const nameWords = s => fold(s).split(' ').filter(t => t && !TITLES.has(t));
  /** every word of the planned name appears in the name shown on screen, any order, titles ignored */
  function nameMatches(planned, shown) {
    const A = nameWords(planned), B = new Set(nameWords(shown));
    return A.length > 0 && A.every(t => B.has(t));
  }
  const isEmptyValue = v => { const s = String(v == null ? '' : v).trim(); return !s || /^[-–—_.]+$/.test(s) || /^(unknown|u|n\/a|none)$/i.test(s); };
  const last4 = v => { const s = String(v || '').replace(/\s+/g, ''); return s ? (s.length > 4 ? '••••' + s.slice(-4) : '••••') : ''; };
  return { validateOperaUrl, FORBIDDEN, isForbiddenControl, fold, nameWords, nameMatches, isEmptyValue, last4 };
});

// ═══════════════════════════════════════════════════════════
//  security.js  —  🔐 new-device sign-in alerts + backup reminder
//
//  Each browser gets its own random device id (kept on this device only).
//  Signing in from a browser the account never used before writes one line
//  to securityLog. Then:
//   • the owner and managers see "Sam signed in on a new device (Chrome on
//     Android, 10:42)" in Ops Brain;
//   • the person's own other devices see "Your account signed in on a new
//     device. Not you? Change your password and tell your manager".
//  The device list is saved under users/{uid}/devices/{id} = { ua, first, last }.
//  Owners also get a weekly "download a backup" reminder.
//  Load after auth.js and db.js.
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';

const DEV_KEY = 'ho_dev_id', SEEN_KEY = 'ho_sec_seen_v1', BK_KEY = 'ho_last_backup';
const ls = { get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} } };

function devId() {
  let id = ls.get(DEV_KEY);
  if (!id || !/^[a-z0-9]{8,24}$/.test(id)) { id = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).slice(0, 18); ls.set(DEV_KEY, id); }
  return id;
}
/** "Chrome on Android" from the browser's user agent */
function secDevName(ua) {
  ua = ua || navigator.userAgent || '';
  const b = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'a browser';
  const o = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : '';
  return o ? `${b} on ${o}` : b;
}
window.secDevName = secDevName;

const isBoss = () => typeof currentProfile !== 'undefined' && currentProfile && ['owner', 'manager'].includes(currentProfile.role);
const fmt = iso => { try { const d = new Date(iso); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };

// ── Record this device at sign-in ─────────────────────────
let _done = false;
async function secCheckDevice() {
  if (_done || typeof currentUser === 'undefined' || !currentUser || typeof currentProfile === 'undefined' || !currentProfile) return;
  if (typeof firebase === 'undefined' || !firebase.database || typeof HOTEL_ID === 'undefined') return;
  if (navigator.onLine === false) return;
  _done = true;
  const uid = currentUser.uid, id = devId(), now = new Date().toISOString(), ua = secDevName();
  const base = firebase.database().ref(`hotels/${HOTEL_ID}/users/${uid}/devices`);
  try {
    const list = (await Promise.race([base.once('value'), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 10000))])).val() || {};
    const known = !!list[id], others = Object.keys(list).filter(k => k !== id).length;
    if (known) { await base.child(id).update({ last: now, ua }); return; }
    // keep the 12 most recent devices; drop older ones so the list doesn't grow forever
    const patch = { [id]: { ua, first: now, last: now } };
    Object.entries(list).sort((a, b) => String(b[1] && b[1].last || '').localeCompare(String(a[1] && a[1].last || ''))).slice(11).forEach(([k]) => { patch[k] = null; });
    await base.update(patch);
    if (others > 0 && typeof fbPushLog === 'function')
      fbPushLog('securityLog', { type: 'newDevice', uid, name: currentProfile.name || currentUser.email || '', dev: id, ua, at: now }, 200);
  } catch (e) { _done = false; console.warn('[security] device check:', e && e.message); }
}

// ── Alerts (Ops Brain) ────────────────────────────────────
let LOG = [];
function seenAt() { return ls.get(SEEN_KEY) || ''; }
function secMarkSeen() { ls.set(SEEN_KEY, new Date().toISOString()); }
window.secMarkSeen = secMarkSeen;
function secListen() {
  if (typeof fbListen !== 'function') return;
  fbListen('securityLog', v => { LOG = Array.isArray(v) ? v.filter(Boolean) : (v && typeof v === 'object') ? Object.values(v).filter(Boolean) : []; });
}
(window.BL_THINKERS = window.BL_THINKERS || []).push(add => {
  try {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    const me = currentUser.uid, mine = devId(), since = seenAt() || new Date(Date.now() - 3 * 864e5).toISOString();
    const fresh = LOG.filter(e => e && e.type === 'newDevice' && e.at > since && Date.now() - new Date(e.at) < 7 * 864e5);
    // my own account on a device that isn't this one
    fresh.filter(e => e.uid === me && e.dev !== mine).slice(0, 1).forEach(e => add({ id: 'sec:me:' + e.at, type: 'security', icon: '🔐', tone: 'bad',
      text: `Your account signed in on a new device: ${e.ua} (${fmt(e.at)})`,
      why: 'If that was you, all good. If not: change your password now and tell your manager, who can sign you out everywhere (Team → Disconnect).',
      acts: [['It was me', secMarkSeen]] }));
    if (!isBoss()) return;
    const others = fresh.filter(e => e.uid !== me);
    if (!others.length) return;
    const t = others.length === 1 ? `${others[0].name || 'Someone'} signed in on a new device: ${others[0].ua} (${fmt(others[0].at)})`
      : `${others.length} sign-ins on new devices: ${[...new Set(others.map(e => e.name || '?'))].slice(0, 4).join(', ')}`;
    add({ id: 'sec:team:' + others[0].at, type: 'security', icon: '🔐', tone: 'warn', text: t,
      why: 'Usually a new phone or a cleared browser. If it looks wrong, Team → Disconnect signs that person out on every device.',
      acts: [['OK, seen', secMarkSeen], ...(typeof openAdminPanel === 'function' && typeof roleDef === 'function' && roleDef(currentProfile.role).canManageUsers ? [['Open Team', () => { secMarkSeen(); openAdminPanel(); }]] : [])] });
  } catch (_) {}
});

// ── Backup reminder (owner, once a week) ──────────────────
function wrapExport() {
  if (typeof window.exportAllData !== 'function' || window.exportAllData._sec) return;
  const orig = window.exportAllData;
  window.exportAllData = async function () { const r = await orig.apply(this, arguments); ls.set(BK_KEY, new Date().toISOString()); return r; };
  window.exportAllData._sec = true;
}
(window.BL_THINKERS = window.BL_THINKERS || []).push(add => {
  try {
    if (typeof currentProfile === 'undefined' || !currentProfile || currentProfile.role !== 'owner' || typeof exportAllData !== 'function') return;
    const last = ls.get(BK_KEY), days = last ? Math.floor((Date.now() - new Date(last)) / 864e5) : null;
    if (days !== null && days < 7) return;
    const wk = new Date(); wk.setHours(0, 0, 0, 0); wk.setDate(wk.getDate() - wk.getDay());
    add({ id: 'sec:backup:' + wk.toISOString().slice(0, 10), type: 'backup', icon: '💾', tone: 'idle',
      text: days === null ? 'No backup saved from this device yet' : `Last backup from this device: ${days} days ago`,
      why: 'One file with everything the team saved, kept on your own computer, in case anything is ever deleted by mistake. Takes a few seconds.',
      acts: [['Download a backup', () => exportAllData()]] });
  } catch (_) {}
});

// ── Start ─────────────────────────────────────────────────
function start() {
  wrapExport();
  secListen();
  const t = setInterval(() => { if (_done) { clearInterval(t); return; } secCheckDevice(); }, 4000);
  window.addEventListener('online', () => { if (!_done) secCheckDevice(); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

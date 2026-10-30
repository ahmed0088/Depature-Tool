// ═══════════════════════════════════════════════════════════
//  wa-helper.js — the one-click WhatsApp helper (a tiny browser extension)
//  Instead of pasting the reader in the WhatsApp Web console every time,
//  HotelOps builds a small Chrome / Edge extension for you (a .zip, made
//  right here in the browser) and you add it once:
//    • on web.whatsapp.com it starts the reader by itself (no F12, no paste)
//    • on HotelOps it listens, and a little relay in the middle carries the
//      messages between the two tabs — so they link on their own, whichever
//      opened first, with no "Connect" button and no extra tab.
//  "🟢 Open WhatsApp Web" then is the only click. When HotelOps updates, it
//  hands the helper the new reader by itself (Chrome's "Allow User Scripts"
//  switch for the helper lets it run) — no new download.
//  The helper reads nothing else and talks to nobody but these two sites.
//  The same helper (downloaded once more) also runs the Opera Cloud reader
//  (tools/hotelops-opera.console.js) on Opera Cloud (*.oraclecloud.com,
//  *.oracleindustry.com, *.oraclehospitality.com): it only reads the screen
//  and hands it to HotelOps (opera-bridge.js), and updates itself the same way.
// ═══════════════════════════════════════════════════════════

(function (W) {
  const doc = W.document;
  const WA = 'https://web.whatsapp.com/';
  // Opera Cloud lives on Oracle's hosts (xxx.oraclehospitality.<region>.ocs.oraclecloud.com, …oracleindustry.com)
  const OP_MATCHES = ['https://*.oraclecloud.com/*', 'https://*.oracleindustry.com/*', 'https://*.oraclehospitality.com/*'];
  const ver = () => (typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'v0').replace(/^v/, '');
  const installed = () => doc.documentElement.dataset.hoWaHelper || '';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ── a .zip without any library (stored, no compression) ──
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {   // files: [[name, text]]
    const enc = new TextEncoder(), parts = [], dir = []; let off = 0;
    const u16 = v => [v & 255, (v >>> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    files.forEach(([name, text]) => {
      const nm = enc.encode(name), data = enc.encode(text), c = crc32(data);
      const head = [0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(data.length), ...u32(data.length), ...u16(nm.length), ...u16(0)];
      parts.push(new Uint8Array(head), nm, data);
      dir.push([new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(data.length), ...u32(data.length), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nm]);
      off += head.length + nm.length + data.length;
    });
    let size = 0; dir.forEach(([h, n]) => { parts.push(h, n); size += h.length + n.length; });
    parts.push(new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(size), ...u32(off), ...u16(0)]));
    return new Blob(parts, { type: 'application/zip' });
  }

  // ── the shared lock screen: one block (<ho-lock>) in both readers; the Opera reader's copy is baked into the WhatsApp one ──
  const LOCK_A = '  // ══ <ho-lock>', LOCK_Z = '// ══ </ho-lock>';
  /** the <ho-lock> block of a reader's source ('' when it has none) */
  function lockOf(src) {
    src = String(src || ''); const a = src.indexOf(LOCK_A), z = a < 0 ? -1 : src.indexOf(LOCK_Z, a);
    if (z < 0) return '';
    const e = src.indexOf('\n', z); return src.slice(a, e < 0 ? src.length : e);
  }
  /** the WhatsApp reader with the Opera reader's lock block (so the two can never drift apart) */
  function bakeLock(wa, op) { const from = lockOf(op), to = lockOf(wa); return from && to ? String(wa).replace(to, () => from) : String(wa); }

  // ── the extension's files ──
  // The WhatsApp side: the link to the relay, then the reader. The helper keeps a copy of this inside it, and
  // (from v425) HotelOps hands it a fresh one whenever HotelOps itself updates — so the helper never needs
  // downloading again. The fresh copy runs as a "user script"; the copy in the zip is only the fallback.
  function waSide(reader, appOrigin, v, fresh) {
    const lock = lockOf(reader);
    return `// HotelOps WhatsApp helper · reader ${v}${fresh ? ' (updated by itself)' : ''} · starts the reader on WhatsApp Web
${fresh ? `try { document.documentElement.dataset.hoWaUs = ${JSON.stringify(v)}; } catch (_) {}` : `if (!document.documentElement.dataset.hoWaUs) {   // a newer reader (updated by itself) is running instead`}
(function () {
  if (window.__hoWaExt) return;
  const ORIGIN = ${JSON.stringify(appOrigin)};
  let port = null, act = Date.now(), again = null;
  ['keydown', 'mousedown', 'touchstart'].forEach(t => addEventListener(t, () => { act = Date.now(); }, true));
  // a newer reader arrived: restart WhatsApp Web into it when nobody is using this window (hidden, or 2 min untouched)
  const restart = () => { if (document.hidden || Date.now() - act > 120000) location.reload(); else again = setTimeout(restart, 30000); };
  const open = () => {
    port = chrome.runtime.connect({ name: 'wa' });
    port.onMessage.addListener(m => {
      if (m && m.source === 'ho-wa-ext-new') { if (!again) again = setTimeout(restart, 5000); return; }
      window.dispatchEvent(new MessageEvent('message', { data: m, origin: ORIGIN }));
    });
    port.onDisconnect.addListener(() => { port = null; setTimeout(open, 1000); });   // the relay sleeps now and then: wake it
  };
  open();
  window.__hoWaExt = { v: ${JSON.stringify(v)}, post: o => { try { (port || (open(), port)).postMessage(o); } catch (_) {} } };
})();${lock ? `
// 🔒 the Away lock screen starts at once, before WhatsApp has loaded (the reader adopts it): the helper's relay says whether you're
// away, even with HotelOps closed. The same lock screen and PIN as Opera's.
(function () {
  if (window.__hoWaLock) return;
${lock}
  try {
    var ORIGIN = ${JSON.stringify(appOrigin)};
    var L = hoLock({ what: 'WhatsApp', from: 'wa', attr: 'wa-guard', ss: 'ho_wa_lock', top: window.top === window, auto: false,
      send: function (g) { window.__hoWaExt.post({ source: 'ho-wa', lock: g }); }, relay: function (m) { window.__hoWaExt.post(m); } });
    window.__hoWaLock = L;
    addEventListener('message', function (e) {
      var d = e.data; if (e.origin !== ORIGIN || !d || typeof d !== 'object') return;
      if (d.source === 'ho-away' && d.away) L.take(d.away);
      else if ((d.source === 'ho-wa' || d.source === 'ho-wa-pong') && d.guard && d.guard.lock) L.take(d.guard.lock);
      else if (d.source === 'ho-wa-gack' && Array.isArray(d.ids)) L.ack(d.ids);
    });
    L.ask();
  } catch (_) {}
})();` : ''}
// wait for WhatsApp to finish loading, then start the reader once
(function wait(n) {
  if (window.__hoWa || n > 240) return;
  if (!document.getElementById('pane-side') && !document.querySelector('#app [data-icon]')) return setTimeout(() => wait(n + 1), 1000);
  setTimeout(() => { if (!window.__hoWa) {
${reader}
  } }, 1500);
})(0);${fresh ? '' : '\n}'}`;
  }
  // The Opera side: the link to the relay (port "opera"), then the Opera reader. Runs in every frame of Opera Cloud
  // (its lists can sit in a frame); the reader itself stays quiet on Oracle pages that aren't Opera. Like the WhatsApp
  // side, HotelOps hands it a fresh reader when it updates (a second user script); the copy in the zip is the fallback.
  // It never reloads Opera (a form being filled must not be lost): a newer reader starts the next time Opera is opened.
  function opSide(reader, appOrigin, v, fresh) {
    return `// HotelOps helper · Opera reader ${v}${fresh ? ' (updated by itself)' : ''} · reads Opera Cloud, never changes it
${fresh ? `// the self-updated copy runs as a user script: it takes over only where it can talk to the helper (Chrome's user-script messaging);
// elsewhere the copy inside the helper runs instead (an older reader that links, rather than a newer one that never does)
const hoOpMsg = (() => { try { return typeof chrome !== 'undefined' && !!chrome.runtime && typeof chrome.runtime.connect === 'function'; } catch (_) { return false; } })();
try { document.documentElement.dataset.hoOpUsMsg = hoOpMsg ? '1' : '0'; if (hoOpMsg) document.documentElement.dataset.hoOpUs = ${JSON.stringify(v)}; } catch (_) {}
if (hoOpMsg) {` : `if (!document.documentElement.dataset.hoOpUs) {   // a newer reader (updated by itself) is running instead`}
(function () {
  if (window.__hoOpExt) return;
  let port = null;
  const L = [];
  const open = () => {
    try { port = chrome.runtime.connect({ name: 'opera' }); } catch (e) { port = null; if (window.__hoOpExt) window.__hoOpExt.err = String(e && e.message || e).slice(0, 80); return; }
    if (window.__hoOpExt) window.__hoOpExt.err = '';
    port.onMessage.addListener(m => {
      if (m && m.source === 'ho-op-ext-new') { window.__hoOpExt.newer = String(m.v); return; }
      L.forEach(f => { try { f(m); } catch (_) {} });
    });
    port.onDisconnect.addListener(() => { port = null; setTimeout(open, 1500); });   // the relay sleeps now and then: wake it
  };
  window.__hoOpExt = { v: ${JSON.stringify(v)}, us: ${fresh ? 'true' : 'false'}, err: '', on: f => { L.push(f); if (!port) open(); }, post: o => { try { if (!port) open(); port.postMessage(o); } catch (_) {} },
    retry: () => { try { if (port) port.disconnect(); } catch (_) {} port = null; open(); } };
})();
// wait for the page to have a body, then start the reader once
(function wait(n) {
  if (window.__hoOp || n > 600) return;
  if (!document.body) return setTimeout(() => wait(n + 1), 500);
  setTimeout(() => { if (!window.__hoOp) {
${reader}
  } }, 800);
})(0);
}`;
  }
  function files(reader, appOrigin, opReader) {
    const v = ver();
    const manifest = {
      manifest_version: 3, name: 'HotelOps WhatsApp helper', version: String(v).replace(/[^\d.]/g, '') || '1',
      description: 'Starts the HotelOps WhatsApp reader on WhatsApp Web and the Opera reader on Opera Cloud (read only), and links them to HotelOps. Updates itself from HotelOps. Nothing else.',
      background: { service_worker: 'relay.js' },
      permissions: ['storage', 'userScripts'],
      content_scripts: [
        { matches: ['https://web.whatsapp.com/*'], js: ['whatsapp.js'], run_at: 'document_idle' },
        { matches: [appOrigin + '/*'], js: ['hotelops.js'], run_at: 'document_start' },
      ].concat(opReader ? [{ matches: OP_MATCHES, js: ['opera.js'], run_at: 'document_idle', all_frames: true }] : []),
    };
    // the relay: every WhatsApp tab ↔ every HotelOps tab, and it keeps the newest reader HotelOps hands it
    const relay = `// HotelOps WhatsApp helper · relay between the WhatsApp Web tab, the Opera Cloud tab and the HotelOps tab
const ports = { wa: new Set(), app: new Set(), opera: new Set() };
const BUILT = chrome.runtime.getManifest().version, ID = 'hotelops-wa';
// the two readers HotelOps can hand over: WhatsApp (as before) and Opera (a second user script, every frame of Opera Cloud)
const KIND = { wa: { id: ID, key: 'reader', on: 'on', matches: ['https://web.whatsapp.com/*'], side: 'wa', fresh: 'ho-wa-ext-new' },
  op: { id: 'hotelops-op', key: 'opReader', on: 'opOn', matches: ${JSON.stringify(OP_MATCHES)}, all: true, side: 'opera', fresh: 'ho-op-ext-new' } };
const num = v => parseFloat(String(v || '').replace(/[^\\d.]/g, '')) || 0;
// "Allow User Scripts" is on for this helper (chrome://extensions → Details): only then can a newer reader run
const canRun = () => { try { chrome.userScripts.getScripts().catch(() => {}); return true; } catch (_) { return false; } };   // Chrome's own test: the call throws while it is off
async function newest(k) { const K = KIND[k || 'wa'], s = await chrome.storage.local.get(K.key), r = s[K.key]; return r && num(r.v) > num(BUILT) ? r : null; }
async function info() { const r = await newest('wa'), o = await newest('op'); return { source: 'ho-wa-ext-info', v: r ? r.v : BUILT, op: o ? o.v : BUILT, us: canRun() }; }
let busy = Promise.resolve();
async function ensureOne(k) {
  const K = KIND[k], r = await newest(k), have = await chrome.userScripts.getScripts({ ids: [K.id] }), st = await chrome.storage.local.get(K.on), on = st[K.on];
  if (!r) { if (have.length) await chrome.userScripts.unregister({ ids: [K.id] }); await chrome.storage.local.remove(K.on); return; }
  if (have.length && on === r.v) return;
  try { await chrome.userScripts.configureWorld({ messaging: true }); } catch (_) {}
  const def = { id: K.id, matches: K.matches, js: [{ code: r.code }], runAt: 'document_start' };
  if (K.all) def.allFrames = true;
  if (have.length) await chrome.userScripts.update([def]); else await chrome.userScripts.register([def]);
  await chrome.storage.local.set({ [K.on]: r.v });
}
function ensure() {
  return busy = busy.then(async () => {
    if (!canRun()) return false;
    await ensureOne('wa');
    await ensureOne('op').catch(() => {});
    return true;
  }).catch(() => false);
}
const tell = async () => { const i = await info(); ports.app.forEach(q => { try { q.postMessage(i); } catch (_) {} }); };
// 🛡 Away, remembered by the helper itself (chrome.storage.local "away"): HotelOps sets it whenever Away or the Opera lock changes
// (on, since, the PIN's salted hash — never the PIN) and clears it on "I'm back". A WhatsApp or Opera tab asks on start, so one opened
// while HotelOps is closed locks at once. A PIN typed in a tab disarms here, the other tabs are told, and HotelOps hears it ("awayPin")
// when it (re)connects. WhatsApp locks for Away only; Opera for Away or its own lock.
const okPin = p => (p && /^[0-9a-f]{64}$/.test(String(p.h || '')) && /^[0-9a-f]{8,64}$/.test(String(p.s || '')) ? { h: String(p.h), s: String(p.s) } : null);
const toSide = (side, m) => ports[side].forEach(q => { try { q.postMessage(m); } catch (_) {} });
function awayFor(side, a) {
  if (!a) return null;
  return { armed: !!a.armed && (side !== 'wa' || !!a.wa), rev: +a.rev || 0, since: +a.since || 0, by: side === 'wa' ? 'away' : String(a.by || 'away'), pin: a.pin || null };
}
const awayTell = a => { toSide('wa', { source: 'ho-away', away: awayFor('wa', a) }); toSide('opera', { source: 'ho-away', away: awayFor('opera', a) }); };
async function awayGet() { const s = await chrome.storage.local.get(['away', 'awayPin']); return { away: s.away || null, pin: s.awayPin || null }; }
let awayQ = Promise.resolve();
const awayDo = f => (awayQ = awayQ.then(f).catch(() => {}));
function awaySet(a) {
  return awayDo(async () => {
    if (!a || typeof a !== 'object') return;
    const { away, pin } = await awayGet();
    if (a.armed) {
      const since = +a.since || Date.now();
      if (pin && since <= +pin.at) return;   // older than a PIN typed at the desk: HotelOps hasn't heard of it yet
      const v = { armed: true, wa: !!a.wa, since, rev: since, by: String(a.by || 'away').slice(0, 8), pin: okPin(a.pin), at: away && away.armed ? +away.at || Date.now() : Date.now() };
      if (away && JSON.stringify([away.wa, away.since, away.by, away.pin]) === JSON.stringify([v.wa, v.since, v.by, v.pin])) return;
      await chrome.storage.local.set({ away: v }); awayTell(v);
    } else if (away) { await chrome.storage.local.remove('away'); awayTell({ armed: false, rev: Date.now() }); }
  });
}
function awayOff(side, m) {
  return awayDo(async () => {
    const at = Math.min(Date.now(), +(m && m.at) || Date.now()), rev = Math.max(+(m && m.rev) || 0, at), p = { at, from: side === 'wa' ? 'wa' : 'opera' };
    await chrome.storage.local.remove('away'); await chrome.storage.local.set({ awayPin: p });
    awayTell({ armed: false, rev });
    toSide('app', { source: 'ho-away-state', away: null, pin: p });
  });
}
const awayHello = q => awayDo(async () => { const s = await awayGet(); try { q.postMessage({ source: 'ho-away-state', away: s.away, pin: s.pin }); } catch (_) {} });
// removed from Chrome → Chrome opens HotelOps with ?helperRemoved=1 (no secret in it), so HotelOps can tell your phone
const goneUrl = u => u + (u.indexOf('?') < 0 ? '?' : '&') + 'helperRemoved=1&t=' + Date.now();
function uninstallAt(u) { try { const r = chrome.runtime.setUninstallURL(goneUrl(u)); if (r && r.catch) r.catch(() => {}); } catch (_) {} }
async function setApp(u) {
  u = String(u || '');
  try { const x = new URL(u); if (!/^https?:$/.test(x.protocol) || x.search || x.hash || u.length > 900) return; } catch (_) { return; }
  await chrome.storage.local.set({ appUrl: u });
  uninstallAt(u);
}
chrome.storage.local.get('appUrl').then(s => { if (s && s.appUrl) uninstallAt(s.appUrl); }).catch(() => {});
function link(p) {
  const side = p.name === 'wa' ? 'wa' : p.name === 'opera' ? 'opera' : 'app';
  ports[side].add(p);
  if (side === 'app') ensure().then(tell).then(() => awayHello(p));   // the helper's info first, then what it keeps about Away
  p.onMessage.addListener(async m => {
    const k = m && (m.source === 'ho-wa-ext-code' ? 'wa' : m.source === 'ho-op-ext-code' ? 'op' : '');
    if (k) {   // HotelOps updated: keep its reader and run it from now on (only HotelOps can hand one over)
      const K = KIND[k], cur = (await info())[k === 'wa' ? 'v' : 'op'];
      if (side !== 'app' || typeof m.code !== 'string' || num(m.v) <= num(cur)) return tell();
      await chrome.storage.local.set({ [K.key]: { v: String(m.v), code: m.code, at: Date.now() } });
      const ok = await ensure(); await tell();
      if (ok && canRun()) ports[K.side].forEach(q => { try { q.postMessage({ source: K.fresh, v: m.v }); } catch (_) {} });
      return;
    }
    // 🛡 Away (kept here) and the helper's heartbeat: answered by the relay itself, never passed on
    const src = m && typeof m.source === 'string' ? m.source : '';
    if (src === 'ho-helper-ping') { try { p.postMessage({ source: 'ho-helper-beat', at: Date.now(), v: BUILT }); } catch (_) {} return; }
    if (side === 'app' && src === 'ho-away-set') { awaySet(m.away); return; }
    if (side === 'app' && src === 'ho-away-pinack') { awayDo(async () => { const s = await awayGet(); if (s.pin && +s.pin.at === +m.at) await chrome.storage.local.remove('awayPin'); }); return; }
    if (side === 'app' && src === 'ho-app-url') { await setApp(m.url); return; }
    if (side !== 'app' && src === 'ho-away-ask') { const s = await awayGet(); try { p.postMessage({ source: 'ho-away', away: awayFor(side, s.away) }); } catch (_) {} return; }
    if (side !== 'app' && src === 'ho-away-off') { awayOff(side, m); return; }
    if (/^ho-away/.test(src) || src === 'ho-app-url') return;
    // an Opera reader's ping: say at once whether a HotelOps tab is linked (its "linking…" checklist tells the user which it is)
    if (side === 'opera' && m && m.ping) { try { p.postMessage({ source: 'ho-op-relay', apps: ports.app.size, v: BUILT }); } catch (_) {} }
    // WhatsApp and Opera talk to HotelOps; HotelOps' answers go to the reader they are for (Opera's start with "ho-op")
    const to = side !== 'app' ? 'app' : (m && typeof m.source === 'string' && m.source.indexOf('ho-op') === 0 ? 'opera' : 'wa');
    ports[to].forEach(q => { try { q.postMessage(m); } catch (_) {} });
  });
  p.onDisconnect.addListener(() => ports[side].delete(p));
}
chrome.runtime.onConnect.addListener(link);
if (chrome.runtime.onUserScriptConnect) chrome.runtime.onUserScriptConnect.addListener(link);
// the self-updated readers talk through user-script messaging: switched on each time the relay starts, not only when a reader is registered
try { if (canRun()) chrome.userScripts.configureWorld({ messaging: true }).catch(() => {}); } catch (_) {}
ensure();`;
    const wa = waSide(reader, appOrigin, v, false);
    // HotelOps side: show that the helper is here, and carry the messages
    const app = `// HotelOps WhatsApp helper ${v} · links HotelOps to WhatsApp Web${opReader ? ' and Opera Cloud' : ''}
(function () {
  const D = document.documentElement.dataset;
  D.hoWaHelper = ${JSON.stringify(v)}; D.hoWaAuto = '1'; D.hoAwayRelay = '1';${opReader ? ` D.hoOpHelper = ${JSON.stringify(v)};` : ''}
  let port = null;
  const BACK = d => d && typeof d === 'object' && (d.source === 'ho-wa-pong' || d.source === 'ho-wa-ack' || d.source === 'ho-wa-gack' || d.source === 'ho-wa-ext-code'
    || d.source === 'ho-op-ack' || d.source === 'ho-op-guard' || d.source === 'ho-op-ext-code' || d.source === 'ho-away-set' || d.source === 'ho-away-pinack'
    || (d.source === 'ho-wa' && (d.send || d.words || (d.guard && !d.guard.events && !d.guard.arm))));
  const open = () => {
    // switched off / removed: Chrome won't connect any more → HotelOps is told at once (and the heartbeat stops)
    try { port = chrome.runtime.connect({ name: 'app' }); } catch (_) { port = null; if (!D.hoHelperOff) { D.hoHelperOff = String(Date.now()); window.postMessage({ source: 'ho-helper-off' }, location.origin); } return; }
    delete D.hoHelperOff;
    port.onMessage.addListener(m => {
      if (m && m.source === 'ho-wa-ext-info') { D.hoWaUs = m.us ? '1' : '0'; D.hoWaCode = String(m.v); if (m.op) D.hoOpCode = String(m.op); }
      if (m && m.source === 'ho-helper-beat') D.hoHelperBeat = String(Date.now());
      window.postMessage(m, location.origin);
    });
    port.onDisconnect.addListener(() => { port = null; setTimeout(open, 1000); });
    // where HotelOps is (no query, no hash): if the helper is removed, Chrome opens it with ?helperRemoved=1
    try { port.postMessage({ source: 'ho-app-url', url: location.origin + location.pathname }); } catch (_) {}
  };
  open();
  // the heartbeat: HotelOps sees the helper is on (and notices within 30 s when it is switched off or removed)
  const beat = () => { try { (port || (open(), port)).postMessage({ source: 'ho-helper-ping' }); } catch (_) {} };
  beat(); setInterval(beat, 10000);
  // what HotelOps answers or sends to WhatsApp goes back through the relay
  window.addEventListener('message', e => { if (e.source === window && BACK(e.data)) { try { (port || (open(), port)).postMessage(e.data); } catch (_) {} } });
})();`;
    const readme = `HotelOps WhatsApp helper ${v}

Add it once (Chrome or Edge on the desk PC):
1. Unzip this file into a folder you keep (for example Documents\\HotelOps helper).
2. Open chrome://extensions  (Edge: edge://extensions)
3. Turn on "Developer mode" (top right in Chrome, left in Edge).
4. Click "Load unpacked" and pick the folder.
5. For automatic updates: click "Details" on HotelOps WhatsApp helper and turn on "Allow User Scripts".
6. Optional, stronger: on the same Details page turn on "Allow in Incognito" (the lock screens work there too).
That's it. Open WhatsApp Web: the HotelOps window starts by itself and links to HotelOps.${opReader ? `
Open Opera Cloud: a small "HotelOps" pill shows bottom right. It reads the screens you open
(Arrivals, Departures, In House, a reservation) and HotelOps updates its lists by itself.
It only reads Opera; it never clicks, types or changes anything there.` : ''}

Updates: nothing to do. When HotelOps updates, it hands the helper the new reader, and WhatsApp Web
restarts into it the next time nobody is using that window. (Only if step 5 is off you would need to
download again.)
It only runs on web.whatsapp.com${opReader ? ', Opera Cloud (Oracle hosts)' : ''} and ${appOrigin}.`;
    return [['manifest.json', JSON.stringify(manifest, null, 2)], ['relay.js', relay], ['whatsapp.js', wa], ['hotelops.js', app]]
      .concat(opReader ? [['opera.js', opSide(opReader, appOrigin, v, false)]] : []).concat([['README.txt', readme]]);
  }

  // the reader as it is in this version of HotelOps (the WhatsApp side of the helper)
  async function reader() {
    let raw = await fetch('tools/hotelops-whatsapp.console.js', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); });
    try { raw = bakeLock(raw, await fetch('tools/hotelops-opera.console.js', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })); } catch (_) {}
    return W.hoWaPure.snippet(raw, location.origin + location.pathname);
  }
  // the Opera reader as it is in this version of HotelOps, with this app's address filled in (the console copy too)
  async function opReader() {
    const raw = await fetch('tools/hotelops-opera.console.js', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); });
    return opSnippet(raw, location.origin + location.pathname);
  }
  function opSnippet(raw, appUrl) { return String(raw).replace("'__HO_APP_URL__'", () => JSON.stringify(appUrl)).replace("var VERSION = '1';", () => 'var VERSION = ' + JSON.stringify(ver()) + ';'); }

  // ── 🛡 knowing when the helper is removed or switched off (pure parts: tests/run-tests.js "Helper away") ──
  const HR_Q = 'ho_helper_removed_q', HR_SEEN = 'ho_helper_removed_seen', HELPER_QUIET = 30000;
  const clock = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  /** "?helperRemoved=1&t=…" (what Chrome opens when the helper is removed) → {t} (when the helper last set it), else null */
  function removedParam(search) {
    let p; try { p = new URLSearchParams(String(search || '')); } catch (_) { return null; }
    return p.get('helperRemoved') === '1' ? { t: Math.max(0, Math.round(+p.get('t') || 0)) } : null;
  }
  /** the address without those two (the rest of the query and the hash stay) */
  function removedClean(search) {
    const p = new URLSearchParams(String(search || '')); p.delete('helperRemoved'); p.delete('t');
    const q = p.toString(); return q ? '?' + q : '';
  }
  /** the phone alert for it */
  function removedAlert(at, id) {
    return { cat: 'guard', title: '🛡 The HotelOps helper was REMOVED from this PC (' + clock(at) + ')', prio: 5, key: 'helperRemoved_' + String(id || at).replace(/[^\w]/g, '').slice(0, 30),
      body: 'Chrome / Edge on the desk PC no longer has the HotelOps helper: the WhatsApp and Opera lock screens and readers stop there. Get it again: HotelOps → 📡 Opera → Get the helper.',
      instant: true, ignoreQuiet: true, claimed: true, toast: false, url: '#opera-guard', tags: ['rotating_light'] };
  }
  /** the page was opened with the parameter: kept in localStorage (once per t), so it is sent once someone is signed in. → queued? */
  function removedNote(ls, r, now) {
    if (!r) return false;
    const id = String(r.t || now), seen = ls.get(HR_SEEN, []) || [];
    if (seen.indexOf(id) >= 0) return false;
    ls.set(HR_SEEN, seen.concat(id).slice(-20));
    ls.set(HR_Q, (ls.get(HR_Q, []) || []).concat({ id, at: now }).slice(-5));
    return true;
  }
  /** signed in: what is queued goes to the phone, once → how many were sent */
  function removedFlush(ls, uid, send) {
    if (!uid) return 0;
    const q = ls.get(HR_Q, []) || []; if (!q.length) return 0;
    ls.set(HR_Q, []);
    q.forEach(x => { try { send(removedAlert(x.at, x.id)); } catch (_) {} });
    return q.length;
  }
  /** the helper's state on this page: 'none' (not added) · 'on' · 'off' (it beat before and has been quiet for 30 s).
   *  o: {installed, gone (it can't connect), capable (a helper with the heartbeat), beat (last heard), start (this page), now,
   *  timersOk (this page's own timer ran on time: a hidden tab's run late, and so do the beats)} */
  function helperStatus(o) {
    if (!o.installed) return 'none';
    if (o.gone) return 'off';   // Chrome refused to connect to it: switched off or removed
    if (!o.capable || o.timersOk === false) return 'on';   // an older helper has no heartbeat; a hidden tab's timers run late: no guessing
    return o.now - Math.max(+o.beat || 0, +o.start || 0) > HELPER_QUIET ? 'off' : 'on';
  }
  /** the helper went quiet while you're away → one alert per quiet spell. st: what was said; → {alert, st} */
  function beatCheck(st, o) {
    st = st || {};
    if (o.status === 'on') return { alert: false, st: {} };
    if (!o.armed || o.status !== 'off') return { alert: false, st };
    if (st.said && st.beat === o.beat) return { alert: false, st };
    return { alert: true, st: { said: true, beat: o.beat } };
  }
  function beatAlert(beat, since, now) {
    return { cat: 'guard', title: '🛡 The HotelOps helper stopped while you\'re away — check the desk PC', prio: 5, key: 'helperOff_' + Math.round((+since || 0) / 1000).toString(36) + '_' + Math.round((+beat || now) / 60000).toString(36),
      body: 'Last heard ' + clock(beat || now) + '. It was switched off or removed in chrome://extensions: the WhatsApp and Opera lock screens may be gone.',
      instant: true, ignoreQuiet: true, claimed: true, toast: false, url: '#opera-guard', tags: ['rotating_light'] };
  }
  W.hoHelperPure = { removedParam, removedClean, removedAlert, removedNote, removedFlush, helperStatus, beatCheck, beatAlert, lockOf, bakeLock, HELPER_QUIET };
  if (!doc || typeof doc.createElement !== 'function') { W.hoWaHelper = { files, zip, waSide, opSide, opSnippet, lockOf, bakeLock, OP_MATCHES }; return; }

  // HotelOps updated and the helper still runs an older reader: hand it this one (once per open)
  let handed = '', opHanded = '';
  async function autoUpdate() {
    const d = doc.documentElement.dataset, v = ver();
    if (d.hoWaAuto && d.hoWaCode && handed !== v && W.hoWaPure && parseFloat(v) > parseFloat(d.hoWaCode)) {
      handed = v;
      try { W.postMessage({ source: 'ho-wa-ext-code', v, code: waSide(await reader(), location.origin, v, true) }, location.origin); }
      catch (_) { handed = ''; }
    }
    // the Opera reader: only a helper that has it (downloaded since the Opera reader came) says which one it runs
    if (d.hoWaAuto && d.hoOpCode && opHanded !== v && parseFloat(v) > parseFloat(d.hoOpCode)) {
      opHanded = v;
      try { W.postMessage({ source: 'ho-op-ext-code', v, code: opSide(await opReader(), location.origin, v, true) }, location.origin); }
      catch (_) { opHanded = ''; }
    }
  }
  W.addEventListener('message', e => { if (e.source === W && e.data && e.data.source === 'ho-wa-ext-info') { setTimeout(autoUpdate, 1000); tick(); } });

  async function download() {
    try {
      let op = ''; try { op = await opReader(); } catch (_) {}   // the Opera reader is a bonus: the helper is still built without it
      const blob = zip(files(await reader(), location.origin, op));
      const a = doc.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'HotelOps-WhatsApp-helper.zip';
      doc.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      try { localStorage.setItem('ho_wa_helper_dl', ver()); } catch (_) {}
      if (typeof showToast === 'function') showToast('Helper downloaded — follow the 4 steps to add it', 'ok');
      steps(true);
    } catch (e) { if (typeof showToast === 'function') showToast('Could not build the helper (offline?) — try again', 'err'); }
  }
  function openWa() {
    const w = W.open(WA, 'hotelops-whatsapp-web');
    if (!w && typeof showToast === 'function') showToast('Allow pop-ups for HotelOps, or open web.whatsapp.com yourself', 'warn');
    else if (!installed() && typeof showToast === 'function') showToast('WhatsApp Web opened — add the one-click helper so it links by itself', 'info');
  }
  function steps(open) { const d = doc.getElementById('waHelperSteps'); if (d) d.open = open !== false; }

  // ── in the WhatsApp window: the helper card ──
  function card() {
    const host = doc.querySelector('#waCard .wa-body'); if (!host) return;
    let el = doc.getElementById('waHelper');
    if (!el) { el = doc.createElement('section'); el.id = 'waHelper'; el.className = 'wa-sec wa-helper'; host.insertBefore(el, host.firstChild); }
    const d = doc.documentElement.dataset, auto = !!d.hoWaAuto, us = d.hoWaUs === '1';
    const have = installed() && (auto && d.hoWaCode || installed()), old = have && parseFloat(have) < parseFloat(ver());
    const linked = W.hoWaBridge && W.hoWaBridge.link && (W.hoWaBridge.link() || {}).linked;
    el.innerHTML = `<div class="wa-hp-row">
        <button type="button" class="wa-hp-go" onclick="hoWaHelper.openWa()">${linked ? '✓ Linked · open WhatsApp Web' : '🟢 Open WhatsApp Web'}</button>
        <div class="wa-hp-st">${have ? (!auto ? `<b class="wa-hp-warn">Get the new helper once — then it updates by itself</b><button type="button" class="wa-hp-lnk" onclick="hoWaHelper.download()">⬇ Get v${esc(ver())} (last download)</button>`
          : !us ? `<b class="wa-hp-${old ? 'warn' : 'ok'}">⚡ One-click helper on${old ? ' · reader ' + esc(have) + ' (older)' : ''}</b><span>Automatic updates: in <code>chrome://extensions</code> click <b>Details</b> on the HotelOps helper and turn on <b>Allow User Scripts</b>, then reload this page.</span>`
          : old ? `<b class="wa-hp-ok">⚡ Updating the helper to ${esc(ver())}…</b><span>WhatsApp Web restarts into it when nobody is using it</span>`
          : `<b class="wa-hp-ok">⚡ One-click helper on</b><span>Links by itself · updates by itself</span>`)
          : `<b>Link with one click</b><button type="button" class="wa-hp-lnk" onclick="hoWaHelper.download()">⬇ Get the helper</button>`}</div></div>
      ${!have ? `<details class="wa-hp-steps" id="waHelperSteps"><summary>How to add it (once, 1 minute)</summary><ol>
        <li><button type="button" class="wa-hp-lnk" onclick="hoWaHelper.download()">⬇ Download the helper</button> and unzip it into a folder you keep.</li>
        <li>Open <code>chrome://extensions</code> (Edge: <code>edge://extensions</code>) and turn on <b>Developer mode</b>.</li>
        <li>Click <b>Load unpacked</b> and pick the folder.</li>
        <li>Click <b>Details</b> on the helper and turn on <b>Allow User Scripts</b> — then it updates by itself, you never download it again.</li>
        <li>Reload this page, then press <b>🟢 Open WhatsApp Web</b>. It starts and links by itself — no F12, no paste, no Connect button.</li></ol>
        <small>Works on Chrome and Edge on the desk PC (not on phones). It runs only on WhatsApp Web and HotelOps.</small></details>` : ''}`;
  }
  const css = doc.createElement('style');
  css.textContent = `
#waCard .wa-helper{padding:12px 14px !important;border-radius:16px;background:linear-gradient(135deg,color-mix(in srgb,#25d366 14%,var(--card)),var(--card));border:1px solid color-mix(in srgb,#25d366 40%,transparent)}
#waCard .wa-hp-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
#waCard .wa-hp-go{flex:0 0 auto;padding:11px 16px;border-radius:12px;border:0;background:linear-gradient(135deg,#25d366,#128c7e);color:#fff;font:700 14px var(--font);cursor:pointer;box-shadow:0 8px 20px -10px #128c7e}
#waCard .wa-hp-go:active{transform:scale(.97)}
#waCard .wa-hp-st{display:flex;flex-direction:column;gap:2px;font-size:12.5px;color:var(--text2);min-width:0}#waCard .wa-hp-st b{color:var(--text);font-size:13.5px}
#waCard .wa-hp-ok{color:#128c7e !important}#waCard .wa-hp-warn{color:var(--amber) !important}
#waCard .wa-hp-lnk{align-self:flex-start;padding:0;border:0;background:none;color:var(--accent);font:600 13px var(--font);cursor:pointer;text-decoration:underline;text-underline-offset:2px}
#waCard .wa-hp-steps{margin-top:10px;font-size:13px;color:var(--text2)}#waCard .wa-hp-steps summary{cursor:pointer;font-weight:600;color:var(--text)}
#waCard .wa-hp-steps ol{margin:8px 0 6px;padding-left:20px;display:flex;flex-direction:column;gap:5px}#waCard .wa-hp-steps code{background:var(--bg2);padding:1px 5px;border-radius:5px}
.hg-ov{position:fixed;inset:0;z-index:9997;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
.hg-sheet{width:min(520px,100%);max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;background:var(--bg);color:var(--text);border:1px solid var(--border2);border-radius:20px;padding:20px;display:flex;flex-direction:column;gap:10px;box-shadow:0 30px 80px rgba(0,0,0,.45);font-size:14px;line-height:1.5}
.hg-ic{width:48px;height:48px;border-radius:14px;display:grid;place-items:center;font-size:24px;background:color-mix(in srgb,var(--rose,#e11d48) 18%,transparent)}
.hg-sheet>b{font-size:17px;color:var(--rose,#e11d48)}.hg-sheet p{margin:0;color:var(--text2)}.hg-sheet ol{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:5px;color:var(--text2)}
.hg-sheet code{background:var(--bg2);padding:1px 5px;border-radius:5px}.hg-sheet small{color:var(--text3)}.hg-acts{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.hg-lnk{padding:0;border:0;background:none;color:var(--accent);font:600 14px var(--font);cursor:pointer;text-decoration:underline}`;
  doc.head.appendChild(css);

  // draw it when the WhatsApp window is there, and again when the helper or the link changes
  const tick = () => { try { card(); } catch (_) {} };
  setTimeout(tick, 1500); setInterval(() => { if (doc.getElementById('waCard')) tick(); }, 5000);
  new MutationObserver(tick).observe(doc.documentElement, { attributes: true, attributeFilter: ['data-ho-wa-helper', 'data-ho-wa-code', 'data-ho-wa-us'] });


  // ── 🛡 the helper's heartbeat and removal, on this HotelOps page ──
  const LSX = { get: (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
  const uidNow = () => { try { return (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || ''; } catch (_) { return ''; } };
  const T0 = Date.now();
  let beatMsg = 0, beatSt = LSX.get('ho_helper_off_st', {}) || {};
  W.addEventListener('message', e => { if (e.source === W && e.data && (e.data.source === 'ho-helper-beat' || e.data.source === 'ho-wa-ext-info' || e.data.source === 'ho-away-state')) beatMsg = Date.now(); });
  /** 'none' · 'on' · 'off' (switched off / removed / stopped: no heartbeat for 30 s) */
  let lastRun = Date.now(), runGap = 0;
  function status() {
    const d = doc.documentElement.dataset;
    return helperStatus({ installed: !!installed(), gone: !!d.hoHelperOff, capable: d.hoAwayRelay === '1', beat: Math.max(+d.hoHelperBeat || 0, beatMsg), start: T0, now: Date.now(), timersOk: runGap < 12000 });
  }
  const lastBeat = () => Math.max(+doc.documentElement.dataset.hoHelperBeat || 0, beatMsg) || T0;
  const awayNow = () => {
    try { const g = W.hoWaGuard && W.hoWaGuard.basic ? W.hoWaGuard.basic() : null; if (g && g.on) return { on: true, since: g.since }; } catch (_) {}
    try { const o = W.hoOpera && W.hoOpera.guard ? W.hoOpera.guard.state() : null; if (o && o.armed) return { on: true, since: o.since }; } catch (_) {}
    return { on: false, since: 0 };
  };
  function guardSend(o) {
    const H = W.hoNotify;
    if (H && typeof H.send === 'function') return Promise.resolve(H.send(o)).catch(() => false);
    if (W.hoWaGuard && typeof W.hoWaGuard.notify === 'function') return W.hoWaGuard.notify(o.title, o.body, o.prio, o.tags);
    return Promise.resolve(false);
  }
  function beatWatch() {
    const t = Date.now(); runGap = t - lastRun; lastRun = t;
    const a = awayNow(), st = status(), b = lastBeat();
    const r = beatCheck(beatSt, { armed: a.on, status: st, beat: b });
    beatSt = r.st;
    if (r.alert) {
      // another HotelOps tab on this PC may have said it already (the same quiet spell)
      const o = LSX.get('ho_helper_off_said', null);
      if (!(o && o.since === a.since && Date.now() - o.at < 5 * 60e3)) {
        LSX.set('ho_helper_off_said', { since: a.since, at: Date.now() });
        guardSend(beatAlert(b, a.since, Date.now()));
        if (typeof showToast === 'function') showToast('🛡 The HotelOps helper stopped while you\'re away — the lock screens may be gone', 'err');
      }
    }
    LSX.set('ho_helper_off_st', beatSt);
  }
  setInterval(beatWatch, 5000);
  // removed: Chrome opened HotelOps with ?helperRemoved=1 → one alert (now, or once someone signs in), a notice, a clean address
  (function removedStart() {
    const r = removedParam(location.search);
    if (!r) return;
    const fresh = removedNote(LSX, r, Date.now());   // the same address opened again: no second alert, no second notice
    try { history.replaceState(null, '', location.pathname + removedClean(location.search) + location.hash); } catch (_) {}
    if (fresh) setTimeout(removedNotice, 1200);
  })();
  let readyAt = 0;
  setInterval(() => {
    const q = LSX.get(HR_Q, []) || []; if (!q.length || !uidNow()) return;
    const H = W.hoNotify, ready = H && typeof H.ready === 'function' ? H.ready() : !!W.hoWaGuard;
    if (!ready) return;
    if (!readyAt) readyAt = Date.now();
    const conn = H && typeof H.connected === 'function' ? H.connected() : true;
    if (!conn && Date.now() - readyAt < 15000) return;   // the phone setup is still loading
    removedFlush(LSX, uidNow(), guardSend);
  }, 2000);
  function removedNotice() {
    if (doc.getElementById('hoHelperGone')) return;
    const d = doc.createElement('div'); d.id = 'hoHelperGone'; d.className = 'hg-ov'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'hgT');
    d.innerHTML = `<div class="hg-sheet"><span class="hg-ic" aria-hidden="true">🛡</span><b id="hgT">The HotelOps helper was removed from this browser</b>
      <p>Until it is back, WhatsApp Web and Opera on this PC are <b>not locked</b> while you're away, and the readers stop. ${uidNow() ? 'Your phone has been told.' : 'Your phone will be told when you sign in.'}</p>
      <ol><li><button type="button" class="hg-lnk" data-hg="get">⬇ Get the helper</button> and unzip it into a folder you keep.</li>
        <li>Open <code>chrome://extensions</code> (Edge: <code>edge://extensions</code>) and turn on <b>Developer mode</b>.</li>
        <li>Click <b>Load unpacked</b> and pick the folder.</li>
        <li>Click <b>Details</b> on the helper: turn on <b>Allow User Scripts</b> (and <b>Allow in Incognito</b>).</li>
        <li>Reload WhatsApp Web, Opera and this page.</li></ol>
      <small>If you didn't remove it, someone at the desk PC did.</small>
      <div class="hg-acts"><button type="button" class="btn gold" data-hg="get">⬇ Get the helper</button><button type="button" class="btn ghost" data-hg="x">Close</button></div></div>`;
    d.addEventListener('click', e => { const k = e.target && e.target.dataset && e.target.dataset.hg; if (k === 'get') download(); if (k === 'x' || e.target === d) d.remove(); });
    doc.body.appendChild(d);
  }

  W.hoWaHelper = { download, openWa, installed, files, zip, card, waSide, opSide, opReader, opSnippet, autoUpdate, OP_MATCHES, status, lockOf, bakeLock, removedNotice };
})(window);

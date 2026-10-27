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
// ═══════════════════════════════════════════════════════════

(function (W) {
  const doc = W.document;
  const WA = 'https://web.whatsapp.com/';
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

  // ── the extension's files ──
  // The WhatsApp side: the link to the relay, then the reader. The helper keeps a copy of this inside it, and
  // (from v425) HotelOps hands it a fresh one whenever HotelOps itself updates — so the helper never needs
  // downloading again. The fresh copy runs as a "user script"; the copy in the zip is only the fallback.
  function waSide(reader, appOrigin, v, fresh) {
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
})();
// wait for WhatsApp to finish loading, then start the reader once
(function wait(n) {
  if (window.__hoWa || n > 240) return;
  if (!document.getElementById('pane-side') && !document.querySelector('#app [data-icon]')) return setTimeout(() => wait(n + 1), 1000);
  setTimeout(() => { if (!window.__hoWa) {
${reader}
  } }, 1500);
})(0);${fresh ? '' : '\n}'}`;
  }
  function files(reader, appOrigin) {
    const v = ver();
    const manifest = {
      manifest_version: 3, name: 'HotelOps WhatsApp helper', version: String(v).replace(/[^\d.]/g, '') || '1',
      description: 'Starts the HotelOps WhatsApp reader on WhatsApp Web and links it to HotelOps. Updates itself from HotelOps. Nothing else.',
      background: { service_worker: 'relay.js' },
      permissions: ['storage', 'userScripts'],
      content_scripts: [
        { matches: ['https://web.whatsapp.com/*'], js: ['whatsapp.js'], run_at: 'document_idle' },
        { matches: [appOrigin + '/*'], js: ['hotelops.js'], run_at: 'document_start' },
      ],
    };
    // the relay: every WhatsApp tab ↔ every HotelOps tab, and it keeps the newest reader HotelOps hands it
    const relay = `// HotelOps WhatsApp helper · relay between the WhatsApp Web tab and the HotelOps tab
const ports = { wa: new Set(), app: new Set() };
const BUILT = chrome.runtime.getManifest().version, ID = 'hotelops-wa';
const num = v => parseFloat(String(v || '').replace(/[^\\d.]/g, '')) || 0;
// "Allow User Scripts" is on for this helper (chrome://extensions → Details): only then can a newer reader run
const canRun = () => { try { chrome.userScripts.getScripts().catch(() => {}); return true; } catch (_) { return false; } };   // Chrome's own test: the call throws while it is off
async function newest() { const s = await chrome.storage.local.get('reader'); return s.reader && num(s.reader.v) > num(BUILT) ? s.reader : null; }
async function info() { const r = await newest(); return { source: 'ho-wa-ext-info', v: r ? r.v : BUILT, us: canRun() }; }
let busy = Promise.resolve();
function ensure() {
  return busy = busy.then(async () => {
    if (!canRun()) return false;
    const r = await newest(), have = await chrome.userScripts.getScripts({ ids: [ID] }), { on } = await chrome.storage.local.get('on');
    if (!r) { if (have.length) await chrome.userScripts.unregister({ ids: [ID] }); await chrome.storage.local.remove('on'); return true; }
    if (have.length && on === r.v) return true;
    try { await chrome.userScripts.configureWorld({ messaging: true }); } catch (_) {}
    const def = { id: ID, matches: ['https://web.whatsapp.com/*'], js: [{ code: r.code }], runAt: 'document_start' };
    if (have.length) await chrome.userScripts.update([def]); else await chrome.userScripts.register([def]);
    await chrome.storage.local.set({ on: r.v });
    return true;
  }).catch(() => false);
}
const tell = async () => { const i = await info(); ports.app.forEach(q => { try { q.postMessage(i); } catch (_) {} }); };
function link(p) {
  const side = p.name === 'wa' ? 'wa' : 'app', other = side === 'wa' ? 'app' : 'wa';
  ports[side].add(p);
  if (side === 'app') ensure().then(tell);
  p.onMessage.addListener(async m => {
    if (m && m.source === 'ho-wa-ext-code') {   // HotelOps updated: keep its reader and run it from now on
      if (side !== 'app' || typeof m.code !== 'string' || num(m.v) <= num((await info()).v)) return tell();
      await chrome.storage.local.set({ reader: { v: String(m.v), code: m.code, at: Date.now() } });
      const ok = await ensure(); await tell();
      if (ok && canRun()) ports.wa.forEach(q => { try { q.postMessage({ source: 'ho-wa-ext-new', v: m.v }); } catch (_) {} });
      return;
    }
    ports[other].forEach(q => { try { q.postMessage(m); } catch (_) {} });
  });
  p.onDisconnect.addListener(() => ports[side].delete(p));
}
chrome.runtime.onConnect.addListener(link);
if (chrome.runtime.onUserScriptConnect) chrome.runtime.onUserScriptConnect.addListener(link);
ensure();`;
    const wa = waSide(reader, appOrigin, v, false);
    // HotelOps side: show that the helper is here, and carry the messages
    const app = `// HotelOps WhatsApp helper ${v} · links HotelOps to WhatsApp Web
(function () {
  const D = document.documentElement.dataset;
  D.hoWaHelper = ${JSON.stringify(v)}; D.hoWaAuto = '1';
  let port = null;
  const BACK = d => d && typeof d === 'object' && (d.source === 'ho-wa-pong' || d.source === 'ho-wa-ack' || d.source === 'ho-wa-gack' || d.source === 'ho-wa-ext-code'
    || (d.source === 'ho-wa' && (d.send || d.words || (d.guard && !d.guard.events && !d.guard.arm))));
  const open = () => {
    port = chrome.runtime.connect({ name: 'app' });
    port.onMessage.addListener(m => {
      if (m && m.source === 'ho-wa-ext-info') { D.hoWaUs = m.us ? '1' : '0'; D.hoWaCode = String(m.v); }
      window.postMessage(m, location.origin);
    });
    port.onDisconnect.addListener(() => { port = null; setTimeout(open, 1000); });
  };
  open();
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
That's it. Open WhatsApp Web: the HotelOps window starts by itself and links to HotelOps.

Updates: nothing to do. When HotelOps updates, it hands the helper the new reader, and WhatsApp Web
restarts into it the next time nobody is using that window. (Only if step 5 is off you would need to
download again.)
It only runs on web.whatsapp.com and ${appOrigin}.`;
    return [['manifest.json', JSON.stringify(manifest, null, 2)], ['relay.js', relay], ['whatsapp.js', wa], ['hotelops.js', app], ['README.txt', readme]];
  }

  // the reader as it is in this version of HotelOps (the WhatsApp side of the helper)
  async function reader() {
    const raw = await fetch('tools/hotelops-whatsapp.console.js', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); });
    return W.hoWaPure.snippet(raw, location.origin + location.pathname);
  }
  // HotelOps updated and the helper still runs an older reader: hand it this one (once per open)
  let handed = '';
  async function autoUpdate() {
    const d = doc.documentElement.dataset, v = ver();
    if (!d.hoWaAuto || !d.hoWaCode || handed === v || !W.hoWaPure) return;
    if (!(parseFloat(v) > parseFloat(d.hoWaCode))) return;
    handed = v;
    try { W.postMessage({ source: 'ho-wa-ext-code', v, code: waSide(await reader(), location.origin, v, true) }, location.origin); }
    catch (_) { handed = ''; }
  }
  W.addEventListener('message', e => { if (e.source === W && e.data && e.data.source === 'ho-wa-ext-info') { setTimeout(autoUpdate, 1000); tick(); } });

  async function download() {
    try {
      const blob = zip(files(await reader(), location.origin));
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
#waCard .wa-hp-steps ol{margin:8px 0 6px;padding-left:20px;display:flex;flex-direction:column;gap:5px}#waCard .wa-hp-steps code{background:var(--bg2);padding:1px 5px;border-radius:5px}`;
  doc.head.appendChild(css);

  // draw it when the WhatsApp window is there, and again when the helper or the link changes
  const tick = () => { try { card(); } catch (_) {} };
  setTimeout(tick, 1500); setInterval(() => { if (doc.getElementById('waCard')) tick(); }, 5000);
  new MutationObserver(tick).observe(doc.documentElement, { attributes: true, attributeFilter: ['data-ho-wa-helper', 'data-ho-wa-code', 'data-ho-wa-us'] });

  W.hoWaHelper = { download, openWa, installed, files, zip, card, waSide, autoUpdate };
})(window);

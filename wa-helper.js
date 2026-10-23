// ═══════════════════════════════════════════════════════════
//  wa-helper.js — the one-click WhatsApp helper (a tiny browser extension)
//  Instead of pasting the reader in the WhatsApp Web console every time,
//  HotelOps builds a small Chrome / Edge extension for you (a .zip, made
//  right here in the browser) and you add it once:
//    • on web.whatsapp.com it starts the reader by itself (no F12, no paste)
//    • on HotelOps it listens, and a little relay in the middle carries the
//      messages between the two tabs — so they link on their own, whichever
//      opened first, with no "Connect" button and no extra tab.
//  "🟢 Open WhatsApp Web" then is the only click. When HotelOps changes the
//  reader, the WhatsApp window says so and offers the new helper.
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
  function files(reader, appOrigin) {
    const v = ver();
    const manifest = {
      manifest_version: 3, name: 'HotelOps WhatsApp helper', version: String(v).replace(/[^\d.]/g, '') || '1',
      description: 'Starts the HotelOps WhatsApp reader on WhatsApp Web and links it to HotelOps. Nothing else.',
      background: { service_worker: 'relay.js' },
      content_scripts: [
        { matches: ['https://web.whatsapp.com/*'], js: ['whatsapp.js'], run_at: 'document_idle' },
        { matches: [appOrigin + '/*'], js: ['hotelops.js'], run_at: 'document_start' },
      ],
    };
    // the relay: every WhatsApp tab ↔ every HotelOps tab
    const relay = `// HotelOps WhatsApp helper · relay between the WhatsApp Web tab and the HotelOps tab
const ports = { wa: new Set(), app: new Set() };
chrome.runtime.onConnect.addListener(p => {
  const side = p.name === 'wa' ? 'wa' : 'app', other = side === 'wa' ? 'app' : 'wa';
  ports[side].add(p);
  p.onMessage.addListener(m => ports[other].forEach(q => { try { q.postMessage(m); } catch (_) {} }));
  p.onDisconnect.addListener(() => ports[side].delete(p));
});`;
    // WhatsApp side: the link, then the reader itself
    const wa = `// HotelOps WhatsApp helper ${v} · starts the reader on WhatsApp Web
(function () {
  if (window.__hoWaExt) return;
  const ORIGIN = ${JSON.stringify(appOrigin)};
  let port = null;
  const open = () => {
    port = chrome.runtime.connect({ name: 'wa' });
    port.onMessage.addListener(m => window.dispatchEvent(new MessageEvent('message', { data: m, origin: ORIGIN })));
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
})(0);`;
    // HotelOps side: show that the helper is here, and carry the messages
    const app = `// HotelOps WhatsApp helper ${v} · links HotelOps to WhatsApp Web
(function () {
  document.documentElement.dataset.hoWaHelper = ${JSON.stringify(v)};
  let port = null;
  const BACK = d => d && typeof d === 'object' && (d.source === 'ho-wa-pong' || d.source === 'ho-wa-ack' || d.source === 'ho-wa-gack'
    || (d.source === 'ho-wa' && (d.send || d.words || (d.guard && !d.guard.events && !d.guard.arm))));
  const open = () => {
    port = chrome.runtime.connect({ name: 'app' });
    port.onMessage.addListener(m => window.postMessage(m, location.origin));
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
That's it. Open WhatsApp Web: the HotelOps window starts by itself and links to HotelOps.

New version? Download it again in HotelOps, unzip over the same folder, then press ↻ on the helper in chrome://extensions.
It only runs on web.whatsapp.com and ${appOrigin}.`;
    return [['manifest.json', JSON.stringify(manifest, null, 2)], ['relay.js', relay], ['whatsapp.js', wa], ['hotelops.js', app], ['README.txt', readme]];
  }

  async function download() {
    try {
      const raw = await fetch('tools/hotelops-whatsapp.console.js', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); });
      const app = location.origin + location.pathname;
      const reader = W.hoWaPure.snippet(raw, app);
      const blob = zip(files(reader, location.origin));
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
    const have = installed(), old = have && have !== ver();
    const linked = W.hoWaBridge && W.hoWaBridge.link && (W.hoWaBridge.link() || {}).linked;
    el.innerHTML = `<div class="wa-hp-row">
        <button type="button" class="wa-hp-go" onclick="hoWaHelper.openWa()">${linked ? '✓ Linked · open WhatsApp Web' : '🟢 Open WhatsApp Web'}</button>
        <div class="wa-hp-st">${have ? (old ? `<b class="wa-hp-warn">Helper ${esc(have)} · a new version is ready</b><button type="button" class="wa-hp-lnk" onclick="hoWaHelper.download()">Get v${esc(ver())}</button>` : `<b class="wa-hp-ok">⚡ One-click helper on</b><span>WhatsApp links by itself</span>`)
          : `<b>Link with one click</b><button type="button" class="wa-hp-lnk" onclick="hoWaHelper.download()">⬇ Get the helper</button>`}</div></div>
      ${!have ? `<details class="wa-hp-steps" id="waHelperSteps"><summary>How to add it (once, 1 minute)</summary><ol>
        <li><button type="button" class="wa-hp-lnk" onclick="hoWaHelper.download()">⬇ Download the helper</button> and unzip it into a folder you keep.</li>
        <li>Open <code>chrome://extensions</code> (Edge: <code>edge://extensions</code>) and turn on <b>Developer mode</b>.</li>
        <li>Click <b>Load unpacked</b> and pick the folder.</li>
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
  new MutationObserver(tick).observe(doc.documentElement, { attributes: true, attributeFilter: ['data-ho-wa-helper'] });

  W.hoWaHelper = { download, openWa, installed, files, zip, card };
})(window);

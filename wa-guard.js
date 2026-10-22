// ═══════════════════════════════════════════════════════════
//  wa-guard.js — WhatsApp Away guard
//  You leave the desk with WhatsApp Web open. Tap "I'm away" (phone or
//  PC) and the WhatsApp reader starts watching: if someone uses that
//  WhatsApp — opens a chat, scrolls through it, searches, types, or
//  closes the reader — your phone gets an alert with the chat name and
//  what was on the screen.
//
//  • Only real hands on the mouse / keyboard count; the reader's own
//    clicks never do (tools/hotelops-whatsapp.console.js).
//  • 45 seconds to walk away after you switch it on.
//  • If the reader or the HotelOps tab on that PC is closed while you're
//    away, that is reported too (the PC stops checking in).
//  • Saved under your own account: waGuard/{your uid} = { on, since, by,
//    beat: {at, linked}, log: {id: {at, kind, chat, detail, lines}} }.
// ═══════════════════════════════════════════════════════════

(function (W) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || '';
  const P = (sub) => 'waGuard/' + uid() + (sub ? '/' + sub : '');
  const KIND = {
    chat: ['💬', 'Opened a chat'], read: ['👀', 'Reading'], search: ['🔎', 'Searched'], type: ['⌨️', 'Typing'],
    touch: ['🖱', 'Clicking'], focus: ['🪟', 'Came to WhatsApp'], reader: ['⚙️', 'Touched the reader'], stop: ['⛔', 'Closed the reader'], link: ['🔌', 'Reader went offline'],
  };
  let NTFY = null;   // { topic } — lock-screen alerts through the free ntfy app
  let ST = { on: false, since: 0 }, LOG = {}, BEAT = null, started = false, seenIds = null, lastLinked = 0, lostSaid = false;

  function state() { return { on: !!ST.on, since: +ST.since || 0 }; }
  function bridge() { return W.hoWaBridge || null; }
  function linkedHere() { const b = bridge(); try { return !!(b && b.linked && b.linked()); } catch (_) { return false; } }

  // ── switch on / off (from any device signed in as you) ──
  function set(on) {
    if (!uid()) return toast('Sign in first', 'err');
    const v = { on: !!on, since: Date.now(), by: (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || '' };
    ST = v;
    if (typeof fbSet === 'function') fbSet(P('on'), v.on), fbSet(P('since'), v.since), fbSet(P('by'), v.by);
    pushToReader();
    toast(on ? '🛡 Away guard on — your phone will be told if someone uses your WhatsApp (starts in 45 s)' : '🛡 Away guard off — welcome back', on ? 'ok' : '');
    render();
  }
  function pushToReader() { const b = bridge(); if (b && b.post) try { b.post({ source: 'ho-wa', guard: state() }); } catch (_) {} }

  // ── the PC with the reader: save what it saw ──
  function fromReader(events) {
    if (!uid() || typeof fbSet !== 'function') return [];
    const ids = [];
    (events || []).slice(0, 40).forEach(e => {
      if (!e || typeof e !== 'object' || !/^g[a-z0-9]{4,20}$/.test(String(e.id || ''))) return;
      const rec = { at: +e.at || Date.now(), kind: KIND[e.kind] ? e.kind : 'touch', chat: String(e.chat || '').slice(0, 80), detail: String(e.detail || '').slice(0, 140),
        lines: (Array.isArray(e.lines) ? e.lines : []).slice(0, 4).map(l => String(l).slice(0, 110)) };
      try { fbSet(P('log/' + e.id), rec); } catch (_) {}
      if (!sentIds.has(e.id)) { sentIds.add(e.id); pushAlert(rec); }
      ids.push(e.id);
    });
    return ids;
  }
  // this PC tab checks in while you're away; the phone can then tell when the PC went quiet
  function beat() {
    if (!ST.on || !uid() || typeof fbSet !== 'function') return;
    const l = linkedHere();
    if (l) { lastLinked = Date.now(); lostSaid = false; }
    if (bridge() && (l || lastLinked)) fbSet(P('beat'), { at: Date.now(), linked: l });
    // the reader was linked here and stopped answering (WhatsApp reloaded / tab closed / reader stopped)
    if (!l && lastLinked && !lostSaid && Date.now() - lastLinked > 40000 && Date.now() - ST.since > 45000) {
      lostSaid = true;
      const id = 'g' + Date.now().toString(36) + 'lk';
      const rec = { at: Date.now(), kind: 'link', chat: '', detail: 'The WhatsApp reader stopped answering — WhatsApp Web was reloaded or closed, or the reader was stopped', lines: [] };
      fbSet(P('log/' + id), rec); pushAlert(rec);
    }
  }

  // ── every device: listen, alert, show ──
  function start() {
    if (started || !uid() || typeof fbListen !== 'function') return;
    started = true;
    fbListen(P(), v => {
      v = v && typeof v === 'object' ? v : {};
      const wasOn = ST.on;
      ST = { on: !!v.on, since: +v.since || 0, by: v.by || '' };
      BEAT = v.beat || null;
      NTFY = v.ntfy && /^hotelops-[a-z0-9]{12,40}$/.test(v.ntfy.topic || '') ? { topic: v.ntfy.topic } : null;
      LOG = v.log && typeof v.log === 'object' ? v.log : {};
      const ids = Object.keys(LOG);
      if (seenIds) {
        const fresh = ids.filter(k => !seenIds.has(k)).map(k => LOG[k]).filter(e => e && Date.now() - (e.at || 0) < 10 * 60e3);
        if (fresh.length) alarm(fresh.sort((a, b) => a.at - b.at));
      }
      seenIds = new Set(ids);
      if (wasOn !== ST.on) pushToReader();
      render(); badge();
    });
  }
  function alarm(list) {
    const e = list[list.length - 1], k = KIND[e.kind] || KIND.touch;
    const msg = `🚨 Someone is using your WhatsApp: ${k[1].toLowerCase()}${e.chat ? ' in "' + e.chat + '"' : ''}${e.detail && e.kind === 'search' ? ' — ' + e.detail : ''}`;
    toast(msg, 'err');
    try { if (navigator.vibrate) navigator.vibrate([300, 120, 300]); } catch (_) {}
    try { if (typeof hoAlert === 'function') hoAlert(msg, true); } catch (_) {}
    try { if ('Notification' in W && Notification.permission === 'granted' && document.hidden) new Notification('HotelOps · WhatsApp', { body: msg.replace(/^🚨 /, ''), tag: 'ho-wa-guard', renotify: true }); } catch (_) {}
  }
  // ── lock-screen alerts: the desk PC that saw it sends them through ntfy.sh (free, no account) to the
  // ntfy app on your phone, subscribed to your own secret topic. Only what happened and the chat name are
  // sent — never the messages that were on the screen (those stay in HotelOps).
  const sentIds = new Set();
  let pushQ = [], pushT = 0, pushLast = 0;
  function ntfy(title, message, priority, tags) {
    if (!NTFY) return Promise.resolve(false);
    const body = JSON.stringify({ topic: NTFY.topic, title, message, priority: priority || 5, tags: tags || ['rotating_light'],
      click: location.origin + location.pathname + '#wa-guard' });
    return fetch('https://ntfy.sh/', { method: 'POST', body }).then(r => r.ok).catch(() => false);   // plain-text body: no pre-flight check
  }
  function pushAlert(rec) {
    if (!NTFY || !ST.on || (rec.at || 0) < (ST.since || 0)) return;
    pushQ.push(rec);
    // several things at once (chat + scroll + search) become one alert; never more than one every 12 s
    if (!pushT) pushT = setTimeout(() => {
      pushT = 0; const q = pushQ.splice(0); if (!q.length) return;
      const first = q[0];
      const lines = q.slice(0, 5).map(e => (KIND[e.kind] || KIND.touch)[0] + ' ' + (e.kind === 'search' ? e.detail : (KIND[e.kind] || KIND.touch)[1] + (e.chat ? ' · ' + e.chat : '')));
      ntfy(first.kind === 'link' ? 'WhatsApp reader stopped on the desk PC' : 'Someone is using your WhatsApp',
        lines.join('\n') + (q.length > 5 ? `\n+${q.length - 5} more` : '') + '\n' + clock(first.at), 5, [first.kind === 'link' ? 'warning' : 'rotating_light']);
      pushLast = Date.now();
    }, Math.max(1500, 12000 - (Date.now() - pushLast)));
  }
  function pushSetup() {
    if (!uid() || typeof fbSet !== 'function') return toast('Sign in first', 'err');
    const r = crypto.getRandomValues(new Uint8Array(16)), topic = 'hotelops-' + [...r].map(b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
    NTFY = { topic }; fbSet(P('ntfy'), { topic, at: Date.now() }); render();
  }
  function pushOff() { if (!confirm('Stop lock-screen alerts?')) return; NTFY = null; if (typeof fbSet === 'function') fbSet(P('ntfy'), null); render(); }
  function pushCopy() { if (!NTFY) return; try { navigator.clipboard.writeText(NTFY.topic).then(() => toast('Copied ✓ — paste it in ntfy'), () => prompt('Copy this', NTFY.topic)); } catch (_) { prompt('Copy this', NTFY.topic); } }
  function pushTest() {
    ntfy('✅ HotelOps Away guard', 'Lock-screen alerts work. You\'ll get one here if someone uses your WhatsApp while you\'re away.', 4, ['shield'])
      .then(ok => toast(ok ? 'Test sent — it should pop up on your phone in a few seconds' : 'Could not reach ntfy.sh — check the internet and try again', ok ? 'ok' : 'err'));
  }
  function pushHtml() {
    if (!NTFY) return `<div class="wg-push"><b>📲 Alerts on your lock screen</b><small>Get the alert even when your phone is locked and HotelOps is closed. Free, uses the ntfy app, about 1 minute to set up.</small><button class="btn primary" onclick="hoWaGuard.pushSetup()">Set up phone alerts</button></div>`;
    return `<div class="wg-push on"><b>📲 Alerts on your lock screen</b>
      <ol><li>Install <b>ntfy</b> from the App Store: <a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noopener">open App Store</a></li>
      <li>In ntfy tap <b>+</b>, paste this code as the topic, tap <b>Subscribe</b>, and allow notifications:</li></ol>
      <div class="wg-topic"><code>${esc(NTFY.topic)}</code><button class="btn sm" onclick="hoWaGuard.pushCopy()">Copy</button></div>
      <small>Keep this code private — anyone with it gets your alerts. Alerts say what happened and which chat, never the messages.</small>
      <div class="wg-push-act"><button class="btn sm primary" onclick="hoWaGuard.pushTest()">Send a test</button><button class="btn sm ghost" onclick="hoWaGuard.pushOff()">Turn off</button></div></div>`;
  }
  function clearLog() {
    if (!confirm('Clear the Away guard history?')) return;
    if (typeof fbSet === 'function') fbSet(P('log'), null);
  }

  // ── the window ──
  function open() {
    start();
    let ov = document.getElementById('wgOv');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'wgOv'; ov.className = 'wg-ov';
      ov.addEventListener('click', e => { if (e.target === ov) close(); });
      document.body.appendChild(ov);
    }
    ov.hidden = false; render();
  }
  function close() { const ov = document.getElementById('wgOv'); if (ov) ov.hidden = true; }
  const ago = t => { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; };
  const clock = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  function pcLine() {
    if (!ST.on) return '';
    if (linkedHere()) return '<span class="wg-ok">● This PC\'s WhatsApp reader is linked and watching</span>';
    if (!BEAT) return '<span class="wg-warn">● No PC with the WhatsApp reader has checked in yet. Keep HotelOps and WhatsApp Web (with the reader) open on the desk PC.</span>';
    const old = Date.now() - BEAT.at > 3 * 60e3;
    if (old) return `<span class="wg-bad">● The desk PC stopped checking in ${ago(BEAT.at)} — HotelOps or WhatsApp may have been closed</span>`;
    return BEAT.linked ? `<span class="wg-ok">● Desk PC watching · checked in ${ago(BEAT.at)}</span>` : `<span class="wg-warn">● Desk PC online but the WhatsApp reader isn't linked</span>`;
  }
  function render() {
    const ov = document.getElementById('wgOv'); if (!ov || ov.hidden) return;
    const since = ST.on && ST.since ? ST.since : 0;
    const all = Object.keys(LOG).map(k => Object.assign({ id: k }, LOG[k])).filter(e => e && e.at).sort((a, b) => b.at - a.at);
    const now = since ? all.filter(e => e.at >= since) : [];
    const earlier = all.filter(e => !since || e.at < since).slice(0, 40);
    const row = e => { const k = KIND[e.kind] || KIND.touch; return `<div class="wg-ev wg-${esc(e.kind)}"><span class="wg-ic">${k[0]}</span><div class="wg-tx">
      <b>${esc(k[1])}${e.chat ? ` · <span class="wg-chat">${esc(e.chat)}</span>` : ''}</b><small>${esc(clock(e.at))} · ${esc(e.detail || '')}</small>
      ${(e.lines || []).length ? `<div class="wg-lines" title="What was on the screen">${e.lines.map(l => `<div>${esc(l)}</div>`).join('')}</div>` : ''}</div></div>`; };
    ov.innerHTML = `<div class="wg-sheet" role="dialog" aria-label="WhatsApp Away guard">
      <div class="wg-hd"><span class="wg-shield ${ST.on ? 'on' : ''}">🛡</span><div><b>WhatsApp Away guard</b><small>Tells you if someone uses your WhatsApp while you're away</small></div><button class="wg-x" onclick="hoWaGuard.close()" aria-label="Close">✕</button></div>
      <button class="wg-big ${ST.on ? 'on' : ''}" onclick="hoWaGuard.set(${!ST.on})">${ST.on ? `<b>I'm back</b><small>Watching since ${esc(clock(since))} · tap to stop</small>` : `<b>I'm away</b><small>Going on a break / DND? Tap and walk away (starts in 45 s)</small>`}</button>
      <div class="wg-pc">${pcLine()}</div>
      ${pushHtml()}
      ${ST.on ? `<div class="wg-sec">While you're away <span>${now.length}</span></div>${now.length ? now.map(row).join('') : '<div class="wg-empty">✓ Nobody has touched your WhatsApp.</div>'}` : ''}
      ${earlier.length ? `<div class="wg-sec">Earlier <button class="wg-clear" onclick="hoWaGuard.clearLog()">Clear</button></div>${earlier.map(row).join('')}` : ''}
      <div class="wg-how"><b>How it works</b> The WhatsApp reader on the desk PC watches only real mouse and keyboard use, never its own. You see the chat they opened, what was on the screen while they scrolled, what they searched, and if they typed or closed the reader. Set up 📲 lock-screen alerts above to get them even when your phone is locked. Messages shown here are saved under your account only.</div>
    </div>`;
  }
  function badge() {
    const n = ST.on ? Object.values(LOG).filter(e => e && e.at >= ST.since).length : 0;
    document.querySelectorAll('[data-wg-badge]').forEach(el => { el.textContent = n || ''; el.hidden = !n; });
    document.documentElement.classList.toggle('wg-away', !!ST.on);
  }
  function toast(m, t) { if (typeof showToast === 'function') showToast(m, t); }

  // start once someone is signed in; the PC tab checks in every 30 s while you're away
  const boot = setInterval(() => { if (uid()) { clearInterval(boot); start(); } }, 1500);
  setInterval(beat, 30000);
  setInterval(() => { if (ST.on) pushToReader(); }, 15000);   // a reader pasted again (or reloaded) learns it at once
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  // Ops Brain: "I'm going for DND", "is someone using my WhatsApp"
  (W.BR_EXTRA = W.BR_EXTRA || []).push(() => [{ id: 'waguard', kind: '🛡 WhatsApp Away guard',
    title: ST.on ? 'Away guard is on — watching your WhatsApp' : 'Going away from the desk? Turn on the WhatsApp Away guard',
    body: `Tells your phone if someone uses your WhatsApp on the desk PC while you're away: the chat they open, what they read, what they search.<div class="br-acts"><button class="btn gold" onclick="brClose();hoWaGuard.open()">🛡 Open Away guard</button></div>`,
    text: 'whatsapp away guard dnd break lunch leaving desk away someone using my whatsapp spy reading my chats watch pc left open guard', boost: 2 }]);

  const css = document.createElement('style');
  css.textContent = `
.wg-ov{position:fixed;inset:0;z-index:9996;background:rgba(0,0,0,.5);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:max(16px,var(--sat,env(safe-area-inset-top))) 12px max(16px,env(safe-area-inset-bottom));backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
.wg-ov[hidden]{display:none}
.wg-sheet{width:min(560px,100%);background:var(--bg);border:1px solid var(--border2);border-radius:22px;padding:18px;box-shadow:0 30px 80px rgba(0,0,0,.45);display:flex;flex-direction:column;gap:10px}
.wg-hd{display:flex;align-items:center;gap:12px}.wg-hd>div{flex:1;min-width:0;display:flex;flex-direction:column}.wg-hd b{font-size:17px}.wg-hd small{color:var(--text3);font-size:12.5px}
.wg-shield{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;font-size:22px;background:var(--card2,var(--card))}.wg-shield.on{background:color-mix(in srgb,var(--mint,#22c55e) 22%,transparent);box-shadow:0 0 0 3px color-mix(in srgb,var(--mint,#22c55e) 30%,transparent)}
.wg-x{width:40px;height:40px;border-radius:12px;border:1px solid var(--border2);background:transparent;color:var(--text2);font-size:16px;cursor:pointer}
.wg-big{width:100%;min-height:72px;border-radius:18px;border:0;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:12px;color:#fff;background:linear-gradient(135deg,#6366f1,#8b5cf6);box-shadow:0 12px 30px -12px #6366f1}
.wg-big b{font-size:19px}.wg-big small{font-size:12.5px;opacity:.9}.wg-big.on{background:linear-gradient(135deg,#16a34a,#22c55e);box-shadow:0 12px 30px -12px #16a34a}.wg-big:active{transform:scale(.98)}
.wg-pc{font-size:12.5px;line-height:1.45}.wg-ok{color:var(--mint,#16a34a)}.wg-warn{color:var(--amber,#d97706)}.wg-bad{color:var(--rose,#e11d48);font-weight:700}
.wg-sec{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:11.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text3)}.wg-sec span{background:var(--rose,#e11d48);color:#fff;border-radius:99px;padding:1px 8px;letter-spacing:0}
.wg-clear{margin-left:auto;background:none;border:0;color:var(--accent);font:inherit;text-transform:none;letter-spacing:0;cursor:pointer}
.wg-ev{display:flex;gap:10px;padding:10px 12px;border-radius:14px;background:var(--card);border:1px solid var(--border)}.wg-ev.wg-stop,.wg-ev.wg-link,.wg-ev.wg-chat,.wg-ev.wg-read{border-color:color-mix(in srgb,var(--rose,#e11d48) 45%,transparent)}
.wg-ic{font-size:19px;line-height:1.2}.wg-tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.wg-tx b{font-size:14px;overflow-wrap:anywhere}.wg-chat{color:var(--accent)}.wg-tx small{color:var(--text3);font-size:12px;overflow-wrap:anywhere}
.wg-lines{margin-top:5px;padding:7px 9px;border-radius:10px;background:var(--bg2);font-size:12px;line-height:1.45;color:var(--text2)}.wg-lines div{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wg-push{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border-radius:16px;background:var(--card);border:1px solid var(--border);font-size:13px;line-height:1.45}.wg-push>b{font-size:14.5px}.wg-push small{color:var(--text3);font-size:12px}.wg-push .btn{align-self:flex-start}
.wg-push ol{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px}.wg-push a{color:var(--accent)}
.wg-topic{display:flex;align-items:center;gap:8px}.wg-topic code{flex:1;min-width:0;overflow-wrap:anywhere;padding:8px 10px;border-radius:10px;background:var(--bg2);font:600 13px var(--mono,monospace);user-select:all}
.wg-push-act{display:flex;gap:8px;flex-wrap:wrap}
.wg-empty{padding:14px;text-align:center;color:var(--mint,#16a34a);font-weight:600;font-size:13.5px}
.wg-how{margin-top:6px;font-size:12px;line-height:1.5;color:var(--text3)}.wg-how b{display:block;color:var(--text2);margin-bottom:2px}
html.wg-away .topbar .logo::after{content:'🛡';margin-left:4px;font-size:13px}`;
  document.head.appendChild(css);

  if (/wa-guard/.test(location.hash)) setTimeout(() => { open(); try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {} }, 1800);   // tapped a lock-screen alert

  W.hoWaGuard = { open, close, set, state, fromReader, clearLog, render, pushSetup, pushOff, pushCopy, pushTest, _st: () => ({ ST, LOG, BEAT }) };
})(window);

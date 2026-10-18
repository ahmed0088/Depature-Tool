/* HotelOps · WhatsApp HK reader (console snippet)
 *
 * Paste into the Console of WhatsApp Web (F12 → Console) once per WhatsApp session.
 * HotelOps makes the ready-to-paste copy (Departures → WhatsApp → How to set up), with
 * its own address filled in below. Read only: it never clicks, types or sends anything
 * in WhatsApp. It reads the messages of ONE group (the HK group) that are on screen today
 * and hands them to HotelOps, which checks rooms out, sets late check-outs and adds notes.
 *
 *  · Link:  click the badge once → a HotelOps tab opens; messages go to it by postMessage.
 *  · Copy:  "📋 Copy today's chat" copies today's messages in WhatsApp's own copy format
 *           ([9:01 AM, 18/10/2026] Sam: 324 CO) for the "Paste from WhatsApp" box.
 *  · Stop:  ✕ on the badge (or reload WhatsApp).
 */
(function () {
  'use strict';
  var APP_URL = '__HO_APP_URL__';
  var MARK = '#hotelops-wa';

  // ── pure helpers (tested in Node) ────────────────────────
  var sp = function (s) { return String(s == null ? '' : s).replace(/[   ]/g, ' ').replace(/[‎‏]/g, ''); };
  /** "[9:35 AM, 10/18/2026] Sam: " → {time, date, sender} */
  function parsePre(pre) {
    var m = sp(pre).match(/^\s*\[([^,\]]+),\s*([^\]]+)\]\s*([\s\S]*?):\s*$/);
    if (!m) return null;
    return { time: m[1].trim(), date: m[2].trim(), sender: m[3].trim() };
  }
  /** a WhatsApp date "18/10/2026", "10/18/2026", "18.10.26" or "2026-10-18" → ISO day, or '' */
  function dateIso(date, now) {
    var p = sp(date).trim().split(/[\/.\-]/).map(function (x) { return parseInt(x, 10); });
    if (p.length !== 3 || p.some(isNaN)) return '';
    now = now || new Date();
    var iso = function (y, m, d) { if (y < 100) y += 2000; if (m < 1 || m > 12 || d < 1 || d > 31) return ''; return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); };
    if (p[0] > 31) return iso(p[0], p[1], p[2]);
    var dm = iso(p[2], p[1], p[0]), md = iso(p[2], p[0], p[1]), today = todayIso(now);
    if (dm === today || md === today) return today;     // either way round, it is today
    if (p[0] > 12) return dm;
    if (p[1] > 12) return md;
    return dm;
  }
  function todayIso(now) { now = now || new Date(); return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0'); }
  function isToday(date, now) { return !!date && dateIso(date, now) === todayIso(now); }
  /** one message → WhatsApp's own copy format */
  function copyLine(m) { return '[' + m.time + ', ' + m.date + '] ' + m.sender + ': ' + String(m.text || '').trim(); }
  function copyText(list) { return [MARK].concat(list.map(copyLine)).join('\n'); }
  /** "true_1203…@g.us_3EB0…" → sent by me? */
  function isMineId(id) { return /^true_/.test(String(id || '')); }

  var H = { parsePre: parsePre, dateIso: dateIso, isToday: isToday, todayIso: todayIso, copyLine: copyLine, copyText: copyText, isMineId: isMineId, MARK: MARK };
  if (typeof module !== 'undefined' && module.exports) { module.exports = H; return; }
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  if (location.hostname !== 'web.whatsapp.com') { alert('HotelOps: paste this in the WhatsApp Web tab (web.whatsapp.com), not here.'); return; }
  if (/__HO_APP_URL__/.test(APP_URL)) { alert('HotelOps: copy this from HotelOps (Departures → WhatsApp → How to set up), so it knows where to send messages.'); return; }
  if (window.__hoWa && window.__hoWa.stop) window.__hoWa.stop();

  var APP_ORIGIN = new URL(APP_URL).origin;
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
  };
  var group = LS.get('ho_wa_group', '');
  if (!group) { group = (prompt('HotelOps: what is the exact name of the HK WhatsApp group?', '') || '').trim(); if (group) LS.set('ho_wa_group', group); }
  var seen = LS.get('ho_wa_seen', {});          // data-id → text already handed over
  var queue = LS.get('ho_wa_q', []);            // waiting for HotelOps to say "got it"
  var win = null, openedAt = 0, lastPong = 0, mode = 'idle', sent = 0, firstScan = true, timers = [], obs = null, note = '';

  var norm = function (s) { return sp(s).replace(/\s+/g, ' ').trim().toLowerCase(); };
  function save() {
    var ks = Object.keys(seen); if (ks.length > 500) ks.slice(0, ks.length - 500).forEach(function (k) { delete seen[k]; });
    if (queue.length > 200) queue = queue.slice(-200);
    LS.set('ho_wa_seen', seen); LS.set('ho_wa_q', queue);
  }

  // ── reading WhatsApp (several fallbacks; any miss just reads nothing) ──
  function chatTitle() {
    var h = document.querySelector('#main header'); if (!h) return '';
    var el = h.querySelector('span[dir="auto"][title]') || h.querySelector('[title]') || h.querySelector('span[dir="auto"]');
    return el ? (el.getAttribute('title') || el.textContent || '') : '';
  }
  function inGroup() { return !!group && norm(chatTitle()) === norm(group); }
  function textOf(el) {
    var out = '';
    (function walk(n) {
      n.childNodes.forEach(function (c) {
        if (c.nodeType === 3) out += c.nodeValue;
        else if (c.nodeType === 1) { if (c.tagName === 'IMG') out += c.getAttribute('alt') || ''; else if (c.tagName === 'BR') out += '\n'; else walk(c); }
      });
    })(el);
    return out.trim();
  }
  function rows() { var m = document.getElementById('main'); return m ? Array.prototype.slice.call(m.querySelectorAll('[data-id]')) : []; }
  function readRow(row) {
    try {
      var id = row.getAttribute('data-id'); if (!id) return null;
      var c = row.querySelector('.copyable-text[data-pre-plain-text]') || row.querySelector('[data-pre-plain-text]');
      var pre = c ? parsePre(c.getAttribute('data-pre-plain-text')) : null;
      var t = (c && (c.querySelector('span.selectable-text') || c.querySelector('.selectable-text'))) || row.querySelector('span.selectable-text') || row.querySelector('.copyable-text');
      var text = t ? textOf(t) : '';
      if (!text) return null;
      var mine = isMineId(id) || !!row.querySelector('.message-out') || (row.classList && row.classList.contains('message-out'));
      return { id: id, text: text, sender: pre ? pre.sender : (mine ? 'Me' : ''), mine: mine, time: pre ? pre.time : '', date: pre ? pre.date : '', edited: false };
    } catch (_) { return null; }
  }
  function scan() {
    if (!inGroup()) { firstScan = true; badge(); return; }
    var now = new Date();
    rows().forEach(function (row) {
      var m = readRow(row); if (!m) return;
      // first look at the group: only today's messages already on screen; later, new ones (a row with no date counts as today)
      if (m.date ? !isToday(m.date, now) : firstScan) return;
      if (!m.date) { m.date = todayIso(now).split('-').reverse().join('/'); m.time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
      var had = seen[m.id];
      if (had === m.text) return;
      if (had !== undefined) m.edited = true;
      seen[m.id] = m.text;
      queue = queue.filter(function (q) { return q.id !== m.id; });
      m.at = Date.now(); queue.push(m);
    });
    firstScan = false; save(); flush(); badge();
  }

  // ── talking to HotelOps ───────────────────────────────────
  function post(o) { try { if (win && !win.closed) { win.postMessage(o, APP_ORIGIN); return true; } } catch (_) {} return false; }
  function flush() {
    if (mode !== 'linked') return;
    var t = Date.now();
    queue.forEach(function (m) { if (!m.sentAt || t - m.sentAt > 4000) { m.sentAt = t; post({ source: 'ho-wa', msg: { id: m.id, text: m.text, sender: m.sender, mine: m.mine, time: m.time, date: m.date, edited: m.edited } }); } });
  }
  function connect() {
    if (!win || win.closed) win = window.open(APP_URL + '#wa-bridge', 'hotelops-wa');
    openedAt = Date.now(); if (mode !== 'linked') mode = 'waiting'; badge();
  }
  function onMsg(e) {
    if (e.origin !== APP_ORIGIN || !e.data || typeof e.data !== 'object') return;
    if (e.data.source === 'ho-wa-pong') { lastPong = Date.now(); if (mode !== 'linked') { mode = 'linked'; } if (e.data.ready) flush(); badge(); }
    if (e.data.source === 'ho-wa-ack' && e.data.id) { var n = queue.length; queue = queue.filter(function (q) { return q.id !== e.data.id; }); if (queue.length < n) sent++; save(); badge(); }
  }
  function tick() {
    var t = Date.now();
    if (win && !win.closed) post({ source: 'ho-wa', ping: true });
    if (mode === 'waiting' && !lastPong && t - openedAt > 8000) mode = 'copy';     // WhatsApp cut the link to the tab (or it never loaded)
    if (mode === 'linked' && (!win || win.closed || t - lastPong > 15000)) mode = win && !win.closed ? 'waiting' : 'idle';
    if (mode === 'waiting' && lastPong && t - lastPong < 15000) mode = 'linked';
    flush(); badge();
  }

  // ── copying ───────────────────────────────────────────────
  function toClipboard(text) {
    var fallback = function () {
      var ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (_) {} ta.remove(); return ok;
    };
    try { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { return true; }, fallback); } catch (_) {}
    return Promise.resolve(fallback());
  }
  function scroller() {
    var r = rows()[0]; var el = r && r.parentElement;
    while (el && el !== document.body) { var s = getComputedStyle(el); if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight) return el; el = el.parentElement; }
    return null;
  }
  function todaysMessages() {
    var now = new Date(), list = [], olderOnScreen = false;
    rows().forEach(function (row) { var m = readRow(row); if (!m || !m.date) return; if (isToday(m.date, now)) list.push(m); else olderOnScreen = true; });
    return { list: list, complete: olderOnScreen };
  }
  var loading = false;
  function copyToday() {
    if (!inGroup()) { note = 'Open the ' + (group || 'HK') + ' group first'; badge(); return; }
    var r = todaysMessages();
    if (!r.complete && !loading) {
      // the first message of today may not be loaded yet: scroll the chat up a few times (read only), then ask for one more click
      loading = true; note = 'Loading earlier messages…'; badge();
      var sc = scroller(), n = 0;
      var step = function () {
        if (sc) sc.scrollTop = 0;
        n++;
        if (todaysMessages().complete || n >= 6) { loading = false; note = 'Ready · click 📋 again to copy ' + todaysMessages().list.length + ' messages'; badge(); return; }
        timers.push(setTimeout(step, 1200));
      };
      step(); return;
    }
    if (!r.list.length) { note = 'No messages from today on screen'; badge(); return; }
    toClipboard(copyText(r.list)).then(function (ok) {
      note = ok ? '✓ Copied ' + r.list.length + ' messages · paste them in HotelOps' : 'Could not copy · select the messages and press Ctrl+C';
      if (ok && mode === 'copy') { queue = []; save(); }
      badge();
    });
  }
  function copyNew() {
    if (!queue.length) { copyToday(); return; }
    var list = queue.slice();
    toClipboard(copyText(list)).then(function (ok) { if (ok) { queue = []; save(); note = '✓ Copied ' + list.length + ' new · paste them in HotelOps'; } badge(); });
  }

  // ── the badge (built with DOM calls only: WhatsApp blocks innerHTML strings) ──
  var B = document.createElement('div'), main = document.createElement('button'), cp = document.createElement('button'), gear = document.createElement('button'), x = document.createElement('button');
  B.id = 'hoWaBadge';
  B.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483646;display:flex;gap:2px;align-items:center;font:600 11px/1.2 system-ui,sans-serif;border-radius:8px;padding:3px;box-shadow:0 2px 10px rgba(0,0,0,.3);max-width:calc(100vw - 16px)';
  [main, cp, gear, x].forEach(function (b) { b.type = 'button'; b.style.cssText = 'all:unset;cursor:pointer;padding:4px 7px;border-radius:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'; B.appendChild(b); });
  main.style.maxWidth = '300px';
  cp.textContent = '📋 Copy today\'s chat';
  cp.title = 'Copies all of today\'s messages in this group, for HotelOps → Departures → Paste from WhatsApp. If some are missing, scroll up to the first message of today and click again.';
  gear.textContent = '⚙'; gear.title = 'Change the HK group name';
  x.textContent = '✕'; x.title = 'Stop reading (HotelOps)';
  var COL = { ok: ['#0f5132', '#d1f7e1'], wait: ['#1e3a5f', '#dbeafe'], warn: ['#7a4b00', '#ffe8b3'], off: ['#333', '#eee'] };
  function badge() {
    var label, tone, tip;
    if (!group) { label = 'HotelOps · click ⚙ to set the HK group'; tone = 'off'; }
    else if (!inGroup()) { label = 'HotelOps · open the "' + group + '" group'; tone = 'off'; }
    else if (mode === 'linked') { label = 'HotelOps ✓ reading ' + group + (sent ? ' · ' + sent + ' sent' : '') + (queue.length ? ' · ' + queue.length + ' waiting' : ''); tone = 'ok'; tip = 'Linked to HotelOps. Keep the HotelOps tab open.'; }
    else if (mode === 'waiting') { label = 'HotelOps · connecting…' + (queue.length ? ' (' + queue.length + ' waiting)' : ''); tone = 'wait'; tip = 'Waiting for the HotelOps tab. Log in there if it asks.'; }
    else if (mode === 'copy') { label = 'Can\'t reach HotelOps directly · click to copy ' + (queue.length || 'new') + ' messages'; tone = 'warn'; tip = 'Click, then paste in HotelOps → Departures → Paste from WhatsApp → Read messages.'; }
    else { label = 'HotelOps · click to connect' + (queue.length ? ' (' + queue.length + ' waiting)' : ''); tone = 'wait'; tip = 'Opens a HotelOps tab and sends it the new HK messages.'; }
    if (note) label += ' — ' + note;
    main.textContent = label; main.title = tip || label;
    B.style.background = COL[tone][0]; B.style.color = COL[tone][1];
  }
  main.onclick = function () { note = ''; if (mode === 'copy') copyNew(); else connect(); };
  cp.onclick = function () { note = ''; copyToday(); };
  gear.onclick = function () { var g = (prompt('HotelOps: the exact name of the HK WhatsApp group', group) || '').trim(); if (g) { group = g; LS.set('ho_wa_group', g); firstScan = true; scan(); } };
  x.onclick = function () { stop(); };
  document.body.appendChild(B);

  var deb = null;
  function stop() { try { obs && obs.disconnect(); } catch (_) {} timers.forEach(clearTimeout); clearInterval(iv1); clearInterval(iv2); clearTimeout(deb); window.removeEventListener('message', onMsg); B.remove(); window.__hoWa = null; }
  obs = new MutationObserver(function () { clearTimeout(deb); deb = setTimeout(scan, 700); });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener('message', onMsg);
  var iv1 = setInterval(tick, 2000), iv2 = setInterval(scan, 5000);
  window.__hoWa = { stop: stop, scan: scan, state: function () { return { mode: mode, group: group, queue: queue.length, sent: sent }; } };
  scan(); badge();
})();

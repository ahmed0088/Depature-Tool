/* HotelOps · WhatsApp HK reader (console snippet)
 *
 * Paste into the Console of WhatsApp Web (F12 → Console) once per WhatsApp session.
 * HotelOps makes the ready-to-paste copy (Departures → WhatsApp → How to set up), with
 * its own address and its message reader filled in below. Read only: it never clicks, types
 * or sends anything in WhatsApp. It reads the messages of ONE group (the HK group) that are
 * on screen today and hands them to HotelOps, which checks rooms out, sets late check-outs,
 * marks extensions and adds notes.
 *
 * A small HotelOps window shows at the bottom left (drag it by its top bar):
 *  · Connect HotelOps:  a HotelOps tab opens; messages go to it by postMessage.
 *  · 📋 Copy today's chat: copies today's messages in WhatsApp's own copy format
 *           ([9:01 AM, 18/10/2026] Sam: 324 CO) for the "Paste from WhatsApp" box.
 *  · ⚙ Group: the HK group's name.   – : make it small.   ✕ : stop (or reload WhatsApp).
 * Built with DOM calls and inline styles only (WhatsApp blocks innerHTML strings and may
 * block <style> tags); animations use element.animate().
 */
(function () {
  'use strict';
  var APP_URL = '__HO_APP_URL__';
  var MARK = '#hotelops-wa';
  // HotelOps puts its own message reader here (the same one the app uses), so the window can show what each line means
  var HP = /*__HO_PARSER__*/null;

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
  /** what a message means, as coloured chips: [{tone:'co'|'lco'|'ext'|'note'|'off', label}] */
  function chips(text) {
    if (!HP) return [{ tone: 'off', label: '→ HotelOps' }];
    var r = HP.hoWaParse(text);
    if (r.kind === 'ignore') return [{ tone: 'off', label: '— ignored (HotelOps post)' }];
    if (!r.actions.length) return [{ tone: 'off', label: '— ignored' }];
    return r.actions.map(function (a) { return { tone: a.act, label: HP.chip(a) }; });
  }

  var H = { parsePre: parsePre, dateIso: dateIso, isToday: isToday, todayIso: todayIso, copyLine: copyLine, copyText: copyText, isMineId: isMineId, chips: chips, parser: HP, MARK: MARK };
  if (typeof module !== 'undefined' && module.exports) { module.exports = H; return; }
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  if (location.hostname !== 'web.whatsapp.com') { alert('HotelOps: paste this in the WhatsApp Web tab (web.whatsapp.com), not here.'); return; }
  if (/__HO_APP_URL__/.test(APP_URL)) { alert('HotelOps: copy this from HotelOps (Departures → WhatsApp → How to set up), so it knows where to send messages.'); return; }
  if (window.__hoWa && window.__hoWa.stop) window.__hoWa.stop(true);

  var APP_ORIGIN = new URL(APP_URL).origin;
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
  };
  var group = LS.get('ho_wa_group', '');
  if (!group) { group = (prompt('HotelOps: the name of the HK WhatsApp group (open the group first and it is filled in for you)', chatTitle()) || '').trim(); if (group) LS.set('ho_wa_group', group); }
  var seen = LS.get('ho_wa_seen', {});          // data-id → text already handed over
  var queue = LS.get('ho_wa_q', []);            // waiting for HotelOps to say "got it"
  var day = LS.get('ho_wa_day', null);          // today's counters {date, read, sent}
  if (!day || day.date !== todayIso()) day = { date: todayIso(), read: 0, sent: 0 };
  var win = null, openedAt = 0, lastPong = 0, mode = 'idle', firstScan = true, timers = [], obs = null, note = '', stopped = false;
  var feed = [];                                // newest first, at most 8 shown

  var norm = function (s) { return sp(s).replace(/\s+/g, ' ').trim().toLowerCase(); };
  function save() {
    var ks = Object.keys(seen); if (ks.length > 500) ks.slice(0, ks.length - 500).forEach(function (k) { delete seen[k]; });
    if (queue.length > 200) queue = queue.slice(-200);
    if (day.date !== todayIso()) day = { date: todayIso(), read: 0, sent: 0 };
    LS.set('ho_wa_seen', seen); LS.set('ho_wa_q', queue); LS.set('ho_wa_day', day);
  }

  // ── reading WhatsApp (several fallbacks; any miss just reads nothing) ──
  function chatTitle() {
    var h = document.querySelector('#main header'); if (!h) return '';
    var el = h.querySelector('span[dir="auto"][title]') || h.querySelector('span[dir="auto"]') || h.querySelector('[title]');
    var t = el ? (el.getAttribute('title') || el.textContent || '') : '';
    return t || String(h.textContent || '').split('\n')[0];
  }
  // the same group even if WhatsApp shows the name a bit differently (emoji, extra words, spacing)
  function inGroup() {
    if (!group) return false;
    var g = norm(group).replace(/[^\p{L}\p{N} ]/gu, '').trim();
    var a = norm(chatTitle()).replace(/[^\p{L}\p{N} ]/gu, '').trim();
    var h = document.querySelector('#main header'), all = h ? norm(h.textContent || '').replace(/[^\p{L}\p{N} ]/gu, '') : '';
    return !!g && (a === g || (!!a && (a.indexOf(g) >= 0 || g.indexOf(a) >= 0)) || all.indexOf(g) >= 0);
  }
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
    if (stopped) return;
    if (!inGroup()) { firstScan = true; render(); return; }
    var now = new Date(), added = [];
    rows().forEach(function (row) {
      var m = readRow(row); if (!m) return;
      // first look at the group: only today's messages already on screen; later, new ones (a row with no date counts as today)
      if (m.date ? !isToday(m.date, now) : firstScan) return;
      if (!m.date) { m.date = todayIso(now).split('-').reverse().join('/'); m.time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
      var had = seen[m.id];
      if (had === m.text) return;
      if (had !== undefined) m.edited = true; else day.read++;
      seen[m.id] = m.text;
      queue = queue.filter(function (q) { return q.id !== m.id; });
      m.at = Date.now(); queue.push(m); added.push(m);
    });
    firstScan = false;
    added.forEach(addFeed);
    save(); flush(); render();
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
    else try { win.focus(); } catch (_) {}
    openedAt = Date.now(); if (mode !== 'linked') mode = 'waiting'; render();
  }
  function onMsg(e) {
    if (e.origin !== APP_ORIGIN || !e.data || typeof e.data !== 'object') return;
    if (e.data.source === 'ho-wa-pong') { lastPong = Date.now(); if (mode !== 'linked') { mode = 'linked'; } if (e.data.ready) flush(); render(); }
    if (e.data.source === 'ho-wa-ack' && e.data.id) {
      var n = queue.length; queue = queue.filter(function (q) { return q.id !== e.data.id; });
      if (queue.length < n) { day.sent++; markFeed(e.data.id, 'sent'); }
      save(); render();
    }
  }
  function tick() {
    var t = Date.now();
    if (win && !win.closed) post({ source: 'ho-wa', ping: true });
    if (mode === 'waiting' && !lastPong && t - openedAt > 8000) mode = 'copy';     // WhatsApp cut the link to the tab (or it never loaded)
    if (mode === 'linked' && (!win || win.closed || t - lastPong > 15000)) mode = win && !win.closed ? 'waiting' : 'idle';
    if (mode === 'waiting' && lastPong && t - lastPong < 15000) mode = 'linked';
    flush(); render();
  }

  // ── copying ───────────────────────────────────────────────
  function toClipboard(text) {
    // WhatsApp listens to "copy" itself and can replace what we copy, so we answer the copy event first
    var fallback = function () {
      var ok = false;
      var grab = function (e) { try { e.clipboardData.setData('text/plain', text); e.preventDefault(); e.stopImmediatePropagation(); ok = true; } catch (_) {} };
      window.addEventListener('copy', grab, true);
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { if (document.execCommand('copy')) ok = true; } catch (_) {}
      window.removeEventListener('copy', grab, true); ta.remove();
      if (!ok) manualCopy(text);
      return ok;
    };
    try { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { return true; }, fallback); } catch (_) {}
    return Promise.resolve(fallback());
  }
  // last resort: the text selected in a box, press Ctrl+C yourself
  function manualCopy(text) {
    var old = document.getElementById('ho-wa-manual'); if (old) old.remove();
    var box = document.createElement('div'); box.id = 'ho-wa-manual';
    box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font:13px/1.4 system-ui,sans-serif';
    var card = document.createElement('div'); card.style.cssText = 'width:min(560px,92vw);background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:14px;padding:16px;box-shadow:0 20px 60px rgba(0,0,0,.6)';
    var h = document.createElement('div'); h.textContent = 'Press Ctrl+C now, then paste in HotelOps'; h.style.cssText = 'font-weight:700;font-size:14px;margin-bottom:8px;color:#e0b24f';
    var ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'width:100%;height:220px;box-sizing:border-box;background:#0b1220;color:#e5e7eb;border:1px solid #374151;border-radius:8px;padding:8px;font:12px/1.4 ui-monospace,monospace';
    var b = document.createElement('button'); b.textContent = 'Done'; b.type = 'button'; b.style.cssText = 'margin-top:10px;padding:8px 16px;border-radius:8px;border:0;background:#e0b24f;color:#111;font-weight:700;cursor:pointer';
    b.onclick = function () { box.remove(); };
    ta.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && /c/i.test(e.key)) setTimeout(function () { box.remove(); say('✓ Copied · paste them in HotelOps', 'ok'); }, 150); });
    card.appendChild(h); card.appendChild(ta); card.appendChild(b); box.appendChild(card); document.body.appendChild(box);
    ta.focus(); ta.select();
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
    if (!inGroup()) { say('Open the ' + (group || 'HK') + ' group first'); return; }
    var r = todaysMessages();
    if (!r.complete && !loading) {
      // the first message of today may not be loaded yet: scroll the chat up a few times (read only), then ask for one more click
      loading = true; say('Loading earlier messages…');
      var sc = scroller(), n = 0;
      var step = function () {
        if (stopped) return;
        if (sc) sc.scrollTop = 0;
        n++;
        if (todaysMessages().complete || n >= 6) { loading = false; say('Ready · click 📋 again to copy ' + todaysMessages().list.length + ' messages'); return; }
        timers.push(setTimeout(step, 1200));
      };
      step(); return;
    }
    if (!r.list.length) { say('No messages from today on screen'); return; }
    toClipboard(copyText(r.list)).then(function (ok) {
      if (ok && mode === 'copy') { queue.forEach(function (q) { markFeed(q.id, 'copied'); }); queue = []; save(); }
      say(ok ? '✓ Copied ' + r.list.length + ' messages · paste them in HotelOps' : 'Could not copy · select the messages and press Ctrl+C', ok ? 'ok' : 'warn');
    });
  }
  function copyNew() {
    if (!queue.length) { copyToday(); return; }
    var list = queue.slice();
    toClipboard(copyText(list)).then(function (ok) {
      if (ok) { list.forEach(function (q) { markFeed(q.id, 'copied'); }); queue = []; save(); say('✓ Copied ' + list.length + ' new · paste them in HotelOps', 'ok'); }
      else say('Could not copy · select the messages and press Ctrl+C', 'warn');
    });
  }

  // ══ The window (DOM calls + inline styles only) ═════════════
  var RM = false; try { RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}
  var FONT = '12.5px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif';
  var GOLD = '#e0b24f';
  var TONE = {            // dot, text, background
    green: ['#22c55e', '#86efac', 'rgba(34,197,94,.14)'],
    amber: ['#f59e0b', '#fcd34d', 'rgba(245,158,11,.14)'],
    blue:  ['#3b82f6', '#93c5fd', 'rgba(59,130,246,.15)'],
    red:   ['#ef4444', '#fca5a5', 'rgba(239,68,68,.15)']
  };
  var CHIP = { co: ['#86efac', 'rgba(34,197,94,.16)'], lco: ['#fcd34d', 'rgba(245,158,11,.16)'], ext: ['#7dd3fc', 'rgba(56,189,248,.16)'], note: ['#c4b5fd', 'rgba(139,92,246,.16)'], off: ['#9aa3b2', 'rgba(255,255,255,.06)'] };
  function el(tag, css, text, parent) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function anim(e, frames, opt) { try { if (e && e.animate) return e.animate(frames, opt); } catch (_) {} return null; }
  function hover(b, on, off) { b.addEventListener('mouseenter', function () { b.style.cssText += on; }); b.addEventListener('mouseleave', function () { b.style.cssText += off; }); }
  var BTN = 'all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:9px;font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;padding:8px 10px;white-space:nowrap;transition:background .15s,border-color .15s,transform .1s;';
  var BTN2 = BTN + 'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#e8ecf3;';
  var ICONB = 'all:unset;box-sizing:border-box;cursor:pointer;width:24px;height:24px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;color:#aab3c2;font:600 13px/1 system-ui,sans-serif;';

  var pos = LS.get('ho_wa_pos', null);
  var root = el('div', 'position:fixed;left:16px;bottom:16px;z-index:2147483646;width:320px;max-width:calc(100vw - 32px);box-sizing:border-box;color:#e8ecf3;font:' + FONT + ';text-align:left;letter-spacing:0;' +
    'background:rgba(16,19,27,.82);-webkit-backdrop-filter:blur(16px) saturate(1.4);backdrop-filter:blur(16px) saturate(1.4);border:1px solid rgba(255,255,255,.12);border-radius:16px;' +
    'box-shadow:0 22px 60px -12px rgba(0,0,0,.6),0 0 0 1px rgba(0,0,0,.25),inset 0 1px 0 rgba(255,255,255,.06);overflow:hidden;user-select:none;-webkit-user-select:none');
  root.id = 'hoWaWin'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'HotelOps HK reader');
  if (pos && pos.left >= 0 && pos.top >= 0) { root.style.left = Math.min(pos.left, innerWidth - 120) + 'px'; root.style.top = Math.min(pos.top, innerHeight - 60) + 'px'; root.style.bottom = 'auto'; }

  // header (drag handle)
  var head = el('div', 'display:flex;align-items:center;gap:10px;padding:12px 10px 10px 12px;cursor:grab;background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,0))', null, root);
  var logo = el('div', 'flex:none;width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;font:800 15px/1 Georgia,"Times New Roman",serif;color:#1a1408;background:linear-gradient(135deg,#f6d27a,' + GOLD + ' 55%,#a97a22);box-shadow:0 4px 12px -3px rgba(224,178,79,.55),inset 0 1px 0 rgba(255,255,255,.45)', 'H', head);
  var titles = el('div', 'flex:1;min-width:0', null, head);
  el('div', 'font:700 13.5px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;color:#f4f6fa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', 'HotelOps · HK reader', titles);
  var sub = el('div', 'font-size:11px;color:#8b94a5;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', 'Read only · never sends anything', titles);
  var minB = el('button', ICONB, '–', head); minB.type = 'button'; minB.title = 'Make it small'; minB.setAttribute('aria-label', 'Minimize');
  var xB = el('button', ICONB, '✕', head); xB.type = 'button'; xB.title = 'Stop reading (HotelOps)'; xB.setAttribute('aria-label', 'Stop');
  [minB, xB].forEach(function (b) { hover(b, 'background:rgba(255,255,255,.1);color:#fff;', 'background:transparent;color:#aab3c2;'); });

  var body = el('div', 'padding:0 12px 12px', null, root);
  // status pill + scanning line
  var pillRow = el('div', 'display:flex;align-items:center;gap:8px', null, body);
  var pill = el('div', 'display:inline-flex;align-items:center;gap:7px;max-width:100%;box-sizing:border-box;padding:5px 10px 5px 8px;border-radius:99px;font:600 12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif', null, pillRow);
  var dotWrap = el('span', 'position:relative;flex:none;width:8px;height:8px', null, pill);
  var dot = el('span', 'position:absolute;inset:0;border-radius:50%', null, dotWrap);
  var ring = el('span', 'position:absolute;inset:0;border-radius:50%;opacity:0', null, dotWrap);
  var pillTxt = el('span', 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0', '', pill);
  var track = el('div', 'position:relative;height:2px;margin:10px 0 12px;border-radius:2px;background:rgba(255,255,255,.07);overflow:hidden', null, body);
  var beam = el('div', 'position:absolute;top:0;bottom:0;left:0;width:34%;border-radius:2px;background:linear-gradient(90deg,transparent,rgba(224,178,79,.95),transparent)', null, track);

  // counters
  var stats = el('div', 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px', null, body);
  function stat(label) {
    var b = el('div', 'background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:8px 8px 7px;min-width:0', null, stats);
    var n = el('div', 'font:700 18px/1.1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#f4f6fa;font-variant-numeric:tabular-nums', '0', b);
    el('div', 'font-size:10.5px;line-height:1.25;color:#8b94a5;margin-top:3px', label, b);
    return n;
  }
  var nRead = stat('Messages read today'), nSent = stat('Sent to HotelOps'), nWait = stat('Waiting');

  // live feed
  var fhead = el('div', 'display:flex;align-items:center;justify-content:space-between;margin:12px 0 6px;font:700 10.5px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#8b94a5', null, body);
  el('span', '', 'Live feed', fhead);
  var fcount = el('span', 'letter-spacing:0;text-transform:none;font-weight:500', '', fhead);
  var list = el('div', 'display:flex;flex-direction:column;gap:5px;max-height:236px;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin', null, body);
  list.setAttribute('aria-live', 'polite');
  var empty = el('div', 'padding:14px 10px;text-align:center;color:#7d8696;font-size:12px;border:1px dashed rgba(255,255,255,.1);border-radius:10px', '', list);

  var noteEl = el('div', 'display:none;margin-top:8px;padding:7px 9px;border-radius:9px;font-size:11.5px;line-height:1.35', '', body);

  // buttons
  var connB = el('button', BTN + 'width:100%;margin-top:10px;padding:10px;font-size:12.5px;color:#1a1408;background:linear-gradient(135deg,#f6d27a,' + GOLD + ');border:1px solid rgba(255,255,255,.18);box-shadow:0 6px 16px -6px rgba(224,178,79,.6)', 'Connect HotelOps', body);
  connB.type = 'button';
  var row2 = el('div', 'display:flex;gap:6px;margin-top:6px', null, body);
  var cpB = el('button', BTN2 + 'flex:1', '📋 Copy today\'s chat', row2); cpB.type = 'button';
  cpB.title = 'Copies all of today\'s messages in this group, for HotelOps → Departures → Paste from WhatsApp. If some are missing, scroll up to the first message of today and click again.';
  var gearB = el('button', BTN2, '⚙ Group', row2); gearB.type = 'button'; gearB.title = 'Change the HK group name';
  [cpB, gearB].forEach(function (b) { hover(b, 'background:rgba(255,255,255,.11);border-color:rgba(255,255,255,.22);', 'background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.12);'); });
  hover(connB, 'filter:brightness(1.07);', 'filter:none;');

  // the small pill when minimized
  var mini = el('button', BTN + 'position:fixed;left:16px;bottom:16px;z-index:2147483646;display:none;max-width:calc(100vw - 32px);padding:6px 12px 6px 6px;border-radius:99px;color:#e8ecf3;background:rgba(16,19,27,.88);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.14);box-shadow:0 12px 34px -10px rgba(0,0,0,.6)');
  mini.type = 'button'; mini.id = 'hoWaMini'; mini.title = 'Open the HotelOps window';
  el('span', 'flex:none;width:20px;height:20px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;font:800 11px/1 Georgia,serif;color:#1a1408;background:linear-gradient(135deg,#f6d27a,' + GOLD + ')', 'H', mini);
  var mDotWrap = el('span', 'position:relative;flex:none;width:8px;height:8px', null, mini);
  var mDot = el('span', 'position:absolute;inset:0;border-radius:50%', null, mDotWrap);
  var mRing = el('span', 'position:absolute;inset:0;border-radius:50%;opacity:0', null, mDotWrap);
  var mTxt = el('span', 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0', '', mini);

  // ── feed rows ─────────────────────────────────────────────
  var FEED_MAX = 8;
  function shortTime(t) { var m = String(t || '').match(/(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\s*([ap])?/i); return m ? m[1] + ':' + m[2] + (m[3] ? ' ' + m[3].toUpperCase() + 'M' : '') : ''; }
  function addFeed(m) {
    var old = feed.filter(function (f) { return f.id === m.id; })[0];
    if (old) { feed = feed.filter(function (f) { return f !== old; }); if (old.node) old.node.remove(); }
    var f = { id: m.id, time: shortTime(m.time), sender: m.sender || (m.mine ? 'Me' : ''), text: m.text, edited: m.edited, chips: chips(m.text), state: 'wait' };
    feed.unshift(f);
    if (empty.parentNode) empty.remove();
    var r = el('div', 'flex:none;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:7px 9px');
    var top = el('div', 'display:flex;align-items:baseline;gap:6px;min-width:0', null, r);
    el('span', 'flex:none;font:500 10.5px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#7d8696', f.time, top);
    el('span', 'flex:none;max-width:110px;font-weight:700;font-size:12px;color:#cfd6e2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', f.sender + (f.edited ? ' ✎' : ''), top);
    el('span', 'flex:1;min-width:0;font-size:12px;color:#e8ecf3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', f.text.replace(/\s*\n\s*/g, ' · '), top).title = f.text;
    var cw = el('div', 'display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:5px', null, r);
    f.chips.forEach(function (c) { var k = CHIP[c.tone] || CHIP.off; el('span', 'font:600 11px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;padding:3px 7px;border-radius:99px;color:' + k[0] + ';background:' + k[1], c.label, cw); });
    f.stEl = el('span', 'margin-left:auto;font-size:10.5px;color:#7d8696', '', cw);
    f.node = r;
    list.insertBefore(r, list.firstChild);
    while (feed.length > FEED_MAX) { var x = feed.pop(); if (x.node) x.node.remove(); }
    stateText(f);
    if (!RM) anim(r, [{ opacity: 0, transform: 'translateY(-8px) scale(.98)', background: 'rgba(224,178,79,.22)' }, { opacity: 1, transform: 'none', background: 'rgba(255,255,255,.04)' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  function stateText(f) { if (f.stEl) { f.stEl.textContent = f.state === 'sent' ? '✓ sent' : f.state === 'copied' ? '✓ copied' : 'waiting…'; f.stEl.style.color = f.state === 'wait' ? '#7d8696' : '#86efac'; } }
  function markFeed(id, st) { feed.forEach(function (f) { if (f.id === id) { f.state = st; stateText(f); } }); }

  // ── status / render ───────────────────────────────────────
  var noteTone = '';
  function say(t, tone) { note = t; noteTone = tone || ''; render(); }
  function status() {
    if (stopped) return ['red', 'Stopped'];
    if (!group) return ['amber', 'Set the HK group (⚙ Group)'];
    if (!inGroup()) return ['amber', 'Open the HK group · ' + group];
    if (mode === 'linked') return ['green', 'Reading ' + group];
    if (mode === 'waiting') return ['blue', 'Connecting…'];
    if (mode === 'copy') return ['amber', 'Can\'t reach HotelOps · use copy'];
    return ['blue', 'Ready · click Connect HotelOps'];
  }
  var pulses = [], beamAnim = null, lastTone = '';
  function setPulse(tone) {
    if (tone === lastTone) return; lastTone = tone;
    var c = TONE[tone];
    pill.style.background = c[2]; pill.style.color = c[1]; pill.style.border = '1px solid ' + c[2].replace(/[\d.]+\)$/, '.35)');
    [dot, mDot].forEach(function (d) { d.style.background = c[0]; d.style.boxShadow = '0 0 8px ' + c[0]; });
    [ring, mRing].forEach(function (d) { d.style.background = c[0]; });
    pulses.forEach(function (a) { try { a.cancel(); } catch (_) {} }); pulses = [];
    if (!RM && tone !== 'red') [ring, mRing].forEach(function (r) { var a = anim(r, [{ transform: 'scale(1)', opacity: 0.7 }, { transform: 'scale(2.8)', opacity: 0 }], { duration: tone === 'green' ? 1400 : 1000, iterations: Infinity, easing: 'ease-out' }); if (a) pulses.push(a); });
  }
  function setBeam(on) {
    track.style.opacity = on ? '1' : '.35';
    if (on && !beamAnim && !RM) beamAnim = anim(beam, [{ transform: 'translateX(-110%)' }, { transform: 'translateX(310%)' }], { duration: 1800, iterations: Infinity, easing: 'ease-in-out' });
    if (!on && beamAnim) { try { beamAnim.cancel(); } catch (_) {} beamAnim = null; }
    beam.style.opacity = on ? '1' : '0';
    if (RM && on) { beam.style.left = '33%'; }
  }
  function render() {
    var s = status();
    setPulse(s[0]); pillTxt.textContent = s[1]; pill.title = s[1];
    setBeam(!stopped && inGroup());
    nRead.textContent = day.read; nSent.textContent = day.sent; nWait.textContent = queue.length;
    nWait.style.color = queue.length && mode !== 'linked' ? '#fcd34d' : '#f4f6fa';
    fcount.textContent = feed.length ? 'last ' + feed.length : '';
    empty.textContent = !group ? 'Click ⚙ Group to set the HK group name.' : !inGroup() ? 'Open the "' + group + '" chat. New messages show here.' : 'Watching… new messages show here.';
    if (mode === 'linked') { connB.textContent = '✓ Connected · show HotelOps'; connB.title = 'Linked to HotelOps. Keep the HotelOps tab open.'; }
    else if (mode === 'waiting') { connB.textContent = 'Connecting… (log in there if it asks)'; connB.title = 'Waiting for the HotelOps tab.'; }
    else if (mode === 'copy') { connB.textContent = '📋 Copy ' + (queue.length || 'new') + ' message' + (queue.length === 1 ? '' : 's') + ' for HotelOps'; connB.title = 'WhatsApp blocked the link. Click, then paste in HotelOps → Departures → Paste from WhatsApp → Read messages.'; }
    else { connB.textContent = 'Connect HotelOps'; connB.title = 'Opens a HotelOps tab and sends it the new HK messages.'; }
    sub.textContent = mode === 'linked' ? 'Linked · keep the HotelOps tab open' : 'Read only · never sends anything';
    noteEl.style.display = note ? 'block' : 'none'; noteEl.textContent = note;
    var nt = noteTone === 'ok' ? TONE.green : noteTone === 'warn' ? TONE.amber : [0, '#cfd6e2', 'rgba(255,255,255,.06)'];
    noteEl.style.color = nt[1]; noteEl.style.background = nt[2];
    mTxt.textContent = 'HotelOps · ' + s[1] + (queue.length ? ' · ' + queue.length + ' waiting' : '');
  }

  // ── minimize / drag / stop ────────────────────────────────
  function setMin(on) {
    LS.set('ho_wa_min', !!on);
    root.style.display = on ? 'none' : 'block'; mini.style.display = on ? 'inline-flex' : 'none';
    if (!RM) anim(on ? mini : root, [{ opacity: 0, transform: 'translateY(8px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
  }
  minB.onclick = function () { setMin(true); };
  mini.onclick = function () { setMin(false); };
  var drag = null;
  head.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 || e.target.closest('button')) return;
    var r = root.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    head.style.cursor = 'grabbing'; try { head.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  head.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var w = root.offsetWidth, h = root.offsetHeight;
    var x = Math.max(4, Math.min(innerWidth - w - 4, e.clientX - drag.dx)), y = Math.max(4, Math.min(innerHeight - Math.min(h, 80), e.clientY - drag.dy));
    root.style.left = x + 'px'; root.style.top = y + 'px'; root.style.bottom = 'auto';
  });
  function endDrag() { if (!drag) return; drag = null; head.style.cursor = 'grab'; var r = root.getBoundingClientRect(); LS.set('ho_wa_pos', { left: Math.round(r.left), top: Math.round(r.top) }); }
  head.addEventListener('pointerup', endDrag); head.addEventListener('pointercancel', endDrag);
  head.addEventListener('dblclick', function (e) { if (e.target.closest('button')) return; root.style.left = '16px'; root.style.top = 'auto'; root.style.bottom = '16px'; LS.set('ho_wa_pos', null); });

  connB.onclick = function () { note = ''; if (mode === 'copy') copyNew(); else connect(); };
  cpB.onclick = function () { note = ''; copyToday(); };
  gearB.onclick = function () { var g = (prompt('HotelOps: the name of the HK WhatsApp group (the open chat is filled in)', chatTitle() || group) || '').trim(); if (g) { group = g; LS.set('ho_wa_group', g); firstScan = true; scan(); } };
  xB.onclick = function () { stop(); };

  document.body.appendChild(root); document.body.appendChild(mini);

  var deb = null, iv1 = 0, iv2 = 0;
  function stop(now) {
    if (stopped) return; stopped = true;
    try { obs && obs.disconnect(); } catch (_) {}
    timers.forEach(clearTimeout); clearInterval(iv1); clearInterval(iv2); clearTimeout(deb);
    window.removeEventListener('message', onMsg);
    window.__hoWa = null;
    if (now === true || RM) { root.remove(); mini.remove(); return; }
    render(); mini.remove();
    var a = anim(root, [{ opacity: 1, transform: 'none' }, { opacity: 1, transform: 'none', offset: .6 }, { opacity: 0, transform: 'translateY(10px) scale(.96)' }], { duration: 700, easing: 'ease-in', fill: 'forwards' });
    if (a) a.onfinish = function () { root.remove(); }; else root.remove();
    setTimeout(function () { root.remove(); }, 900);
  }
  obs = new MutationObserver(function (recs) {
    // our own window changing is not news
    if (recs.every(function (r) { return root.contains(r.target) || mini.contains(r.target); })) return;
    clearTimeout(deb); deb = setTimeout(scan, 700);
  });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener('message', onMsg);
  iv1 = setInterval(tick, 2000); iv2 = setInterval(scan, 5000);
  window.__hoWa = { stop: stop, scan: scan, state: function () { return { mode: mode, group: group, queue: queue.length, sent: day.sent, read: day.read, feed: feed.map(function (f) { return f.sender + ': ' + f.text + ' → ' + f.chips.map(function (c) { return c.label; }).join(' / '); }) }; } };

  // ── hello ─────────────────────────────────────────────────
  try {
    console.log('%c H %c HotelOps HK reader is running ✓ ', 'background:linear-gradient(135deg,#f6d27a,#e0b24f);color:#1a1408;font:800 14px Georgia,serif;padding:4px 7px;border-radius:6px 0 0 6px', 'background:#10131b;color:#86efac;font:700 13px system-ui,sans-serif;padding:5px 10px;border-radius:0 6px 6px 0');
    console.log('%c1. Open the HK group in WhatsApp, then click "Connect HotelOps" in the window at the bottom left.\n2. Keep the HotelOps tab open. To stop, click ✕ in the window (or reload WhatsApp).', 'color:#9aa3b2;font:12px system-ui,sans-serif;line-height:1.6');
  } catch (_) {}
  render(); scan();
  if (LS.get('ho_wa_min', false)) setMin(true);
  else if (!RM) {
    anim(root, [{ opacity: 0, transform: 'translateY(24px) scale(.92)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'none' }], { duration: 520, easing: 'cubic-bezier(.2,.9,.25,1.15)' });
    anim(root, [{ boxShadow: '0 0 0 0 rgba(224,178,79,.0), 0 22px 60px -12px rgba(0,0,0,.6)' }, { boxShadow: '0 0 0 3px rgba(224,178,79,.75), 0 0 40px 4px rgba(224,178,79,.35)', offset: .35 }, { boxShadow: '0 0 0 0 rgba(224,178,79,0), 0 22px 60px -12px rgba(0,0,0,.6)' }], { duration: 1600, delay: 250, easing: 'ease-out' });
    anim(logo, [{ transform: 'rotate(-12deg) scale(.6)' }, { transform: 'rotate(4deg) scale(1.12)', offset: .6 }, { transform: 'none' }], { duration: 700, delay: 120, easing: 'ease-out' });
  }
})();

/* HotelOps · WhatsApp reader (console snippet)
 *
 * Paste into the Console of WhatsApp Web (F12 → Console) once per WhatsApp session.
 * HotelOps makes the ready-to-paste copy (Departures → WhatsApp → How to set up), with
 * its own address and its message reader filled in below.
 *
 * It reads your groups and only sends what you send from HotelOps:
 *  · The OPEN group (one of your listed groups) is read fully: today's messages on screen, then each new one.
 *  · Other listed groups: WhatsApp only shows their latest message in the chat list, so that preview is
 *    watched. Short complete commands ("324 CO") in a preview are passed on; anything longer waits until the
 *    group is opened, when today's messages are caught up (nothing is done twice).
 *  · Messages typed in HotelOps → "Send to WhatsApp" are put in the message box of the open group and,
 *    unless "Send automatically" is on (Settings tab), YOU press Enter. It never opens other chats.
 *
 * The window (bottom left, drag it by its top bar, double-click to put it back) has tabs:
 *  Feed (search + filter chips) · Send · Groups · Settings, and a small pill when minimized (– or Alt+H;
 *  the pill can be dragged too and keeps its place). Click the activity graph to switch 2 h / 12 h.
 *  ✕ stops it (or reload WhatsApp).
 * 🔒 While you're away (HotelOps → 🛡 Away) an opaque lock screen covers WhatsApp Web: the same one as Opera's (the shared
 * <ho-lock> block below), unlocked with the same PIN, or "I'm back" in HotelOps. The Away guard keeps reporting as before.
 * Built with DOM calls and inline styles only (WhatsApp blocks innerHTML strings and may block <style>
 * tags); animations use element.animate() and respect "reduce motion".
 */
(function () {
  'use strict';
  var APP_URL = '__HO_APP_URL__';
  var MARK = '#hotelops-wa';
  // HotelOps puts its own message reader here (the same one the app uses), so the window can show what each line means
  var HP = /*__HO_PARSER__*/null;

  // ── pure helpers (tested in Node) ────────────────────────
  var sp = function (s) { return String(s == null ? '' : s).replace(/[   ]/g, ' ').replace(/[‎‏⁦-⁩]/g, ''); };
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
  var normName = function (s) { return sp(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim(); };
  /** is this chat title one of our groups? (emoji, spacing and extra words do not matter) */
  function groupMatch(name, title) {
    var g = normName(name), a = normName(title);
    return !!g && !!a && (a === g || a.indexOf(g) >= 0 || (g.indexOf(a) >= 0 && a.length >= 4));
  }
  /** the hotel's words sent by HotelOps [{w, m, label}] → lookup(word) */
  function wordsLookup(list) {
    var map = {};
    (list || []).forEach(function (e) { if (e && e.w && e.m) map[String(e.w).toLowerCase()] = { m: e.m, label: e.label || '' }; });
    return function (w) { return map[String(w || '').toLowerCase()] || null; };
  }
  /** what a message means, as coloured chips: [{tone:'co'|'lco'|'ext'|'note'|'ask'|'off', label}] */
  function chips(text, words, quote) {
    if (!HP) return [{ tone: 'off', label: '→ HotelOps' }];
    var r = HP.hoWaParse(text, { words: words || undefined, quote: quote || '' });
    if (r.kind === 'ignore') return [{ tone: 'off', label: r.ho ? '↗ sent from HotelOps' : '— ignored (HotelOps post)' }];
    var out = r.actions.map(function (a) { return { tone: a.act, label: HP.chip(a) }; });
    if (r.ask) out.push({ tone: 'ask', label: '❓ what is "' + r.ask.word + '"?', ask: r.ask });
    if (!out.length) return [{ tone: 'off', label: '— ignored' }];
    return out;
  }
  /** a handover group ("HO - Ibis Styles", "Shift handover"): HotelOps saves it to the Handover Book, rooms are not changed */
  var HO_GRP = /\bHO\b|hand\s*-?\s*over/i;
  function isHoGroup(name) { return HO_GRP.test(sp(name || '')); }
  /** "HO - 512 to twin tomorrow", "HO: …", "H/O …", "Handover: …" (not "HOTEL…", "HOLD…"): a note for the next shift in any group */
  var HO_MARK = /^\s*(?:\*\s*)?(?:HO|H\/O|hand\s*-?\s*over)(?![A-Za-z0-9])\s*\*?\s*[-–—:.,|>]*\s*/i;
  function hoAtStart(text) { var s = sp(text), m = s.match(HO_MARK), rest = m ? s.slice(m[0].length).trim() : ''; return !!rest && !(/^(?:\*\s*)?(?:ho|Ho|hO)$/.test(m[0].trim()) && !/^(?:\d|r(?:oo)?ms?\b)/i.test(rest)); }   // "Ho gaya" is not a mark
  /** "… #ho", "(HO) …", "… waiting HO", "512 refund - handover" anywhere too (same rule as hoMark in HotelOps' handover-book.js) */
  var HO_NEXT_CHAT = /^(?:gaya|gayi|gaye|gya|gyi|gye|jayega|jaega|jayegi|jaegi|jaye|jaaye|jaa|ja|jao|jata|jaata|jati|raha|rahi|rahe|rha|rhi|rhe|sakta|sakti|sakte|skta|skte|sake|chuka|chuki|chuke|na|naa|ga|gi|ge|to|tha|thi|the|kya|ki|hai|hain|he|kar|kr|ke|lo|le|po|kayo|ba|lang|naman)$/i;
  var HO_PREV_CHAT = /^(?:kya|kaise|kese|kaisa|kahan|kaha|kidhar|jo|bhi|nahi|nahin|nhi|mat|tum|aap|ap|ready|free|busy|theek|thik|ok|okay|khush|salamat|po|opo|oo|sige|na|lang|ba|naman|kayo|ito|yan|yun|dito|diyan|saan|ano|paano)$/i;
  function hoMarked(text) {
    if (hoAtStart(text)) return true;
    var s = sp(text), re = /(^|[^A-Za-z0-9\/#])(#\s?)?(hand\s*-?\s*over|h\/o|ho)(?![A-Za-z0-9])/gi, m;
    while ((m = re.exec(s))) {
      var start = m.index + m[1].length, w = m[3], end = start + (m[2] || '').length + w.length, after = s.slice(end), before = s.slice(0, start);
      var punct = /^\s*[:\-–—|>]/.test(after), br = /^\s*[)\]]/.test(after) && /[(\[]\s*$/.test(before), atEnd = !/[A-Za-z0-9]/.test(after);
      var next = (after.match(/^\s*([A-Za-z']+)/) || [])[1] || '', prev = (before.match(/([A-Za-z']+)[\s,]*$/) || [])[1] || '';
      var ok = m[2] || br ? true : !/^ho$/i.test(w) ? true : w === 'HO' ? punct || !HO_NEXT_CHAT.test(next) : punct || (atEnd && !!prev && !HO_PREV_CHAT.test(prev));
      if (ok) return /[A-Za-z0-9]/.test(before + after.replace(/^\s*[)\]]/, ''));
    }
    return false;
  }
  /** a handover message's chips: one "📋 Handover" chip and its rooms (never CO / LCO / EXT) */
  function hoChips(text) {
    var rooms = [], m, re = /(?:^|[^\d:\/.,])(\d{3,4})(?![\d:\/]|\s*(?:aed|dhs?|am|pm|%))/gi, s = sp(hoMarked(text) ? String(text).replace(HO_MARK, '') : text);
    while ((m = re.exec(s)) && rooms.length < 4) { if (rooms.indexOf(m[1]) < 0) rooms.push(m[1]); }
    return [{ tone: 'ho', label: '📋 Handover' + (rooms.length ? ' · ' + rooms.join(', ') : '') }];
  }
  /** a chat-list preview "Sam: 324 CO" → {sender, text, mine} */
  function splitPreview(s, sender) {
    s = sp(s).replace(/\s+/g, ' ').trim();
    if (sender != null && sender !== '') { sender = sp(sender).replace(/[:\s]+$/, '').trim(); return { sender: /^you$/i.test(sender) ? 'Me' : sender, text: s, mine: /^you$/i.test(sender) }; }
    var m = s.match(/^([^:]{1,40}?):\s+([\s\S]+)$/);
    if (m && !/^\d{1,2}$/.test(m[1])) return { sender: /^you$/i.test(m[1]) ? 'Me' : m[1].trim(), text: m[2].trim(), mine: /^you$/i.test(m[1].trim()) };
    return { sender: '', text: s, mine: false };
  }
  /** "10:31", "10:31 AM", "9.05 pm" → a time of today; "Yesterday", "Mon", "17/10/2026" → '' */
  function listTime(s) { s = sp(s).trim(); return /^\d{1,2}[:.]\d{2}(?:\s?[ap]\.?\s?m\.?)?$/i.test(s) ? s : ''; }
  /** a time "9:01 AM" today → ms (or now) */
  function msgTs(time, now) {
    now = now || new Date();
    var m = sp(time).toLowerCase().match(/(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\s*([ap])?/); if (!m) return now.getTime();
    var h = +m[1]; if (m[3] === 'p' && h < 12) h += 12; if (m[3] === 'a' && h === 12) h = 0;
    var d = new Date(now); d.setHours(h, +m[2], 0, 0); return Math.min(d.getTime(), now.getTime());
  }
  /** "just now", "2 min ago", "1 h ago" */
  function relTime(ms, now) {
    var s = Math.max(0, Math.round(((now == null ? Date.now() : now) - ms) / 1000));
    if (s < 45) return 'just now'; if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago';
    var h = Math.floor(s / 3600); return h + ' h ago';
  }
  /** messages per 10 minutes over the last n slots (oldest first) */
  function bins(times, now, n, size) {
    n = n || 12; size = size || 600000; now = now == null ? Date.now() : now;
    var out = []; for (var i = 0; i < n; i++) out.push(0);
    (times || []).forEach(function (t) { var k = Math.floor((now - t) / size); if (k >= 0 && k < n) out[n - 1 - k]++; });
    return out;
  }
  /** a short id for a preview: the group, time, sender and text */
  function hashId(s) { s = String(s); var h = 5381, g = 7; for (var i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) | 0; g = (g * 31 + s.charCodeAt(i)) | 0; } return (h >>> 0).toString(36) + (g >>> 0).toString(36); }
  /** the text in WhatsApp's box is what we typed? (spaces, line breaks and the invisible mark do not matter) */
  function sameText(a, b) { var n = function (s) { return sp(s).replace(/[⁣​]/g, '').replace(/\s+/g, ' ').trim(); }; return n(a) === n(b); }
  var isHo = function (t) { return HP ? HP.isHoText(t) : /⁣|^\s*✅\s*HotelOps\b/.test(String(t || '')); };

  // ══ <ho-lock> the Away lock screen (shared) ═════════════════
  // This block is the SAME in tools/hotelops-opera.console.js and tools/hotelops-whatsapp.console.js (tests/run-tests.js checks it;
  // the helper bakes the Opera reader's copy into the WhatsApp one). While you're away an opaque screen (a closed Shadow DOM on
  // <html>, the highest z-index) covers the page, and every mouse, touch and key outside it is stopped in the capture phase before
  // the site sees it. Nothing on the site is clicked, typed or changed: input is only kept away from it. It unlocks with your PIN
  // (only a salted SHA-256 of it comes here, never the PIN; 3 wrong → a 60 s wait) or from HotelOps. Kept per tab in sessionStorage
  // (a reload stays locked). What someone does at the lock screen goes to HotelOps, which tells your phone. Built with DOM calls and
  // inline styles only.
  var PIN_RE = /^\d{4,6}$/, LOCK_TRIES = 3, LOCK_MS = 60000;
  function hexOf(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16); return s; }
  /** sha-256(salt + ':' + pin) as hex (a Promise) */
  function pinHash(pin, salt) {
    var C = typeof crypto !== 'undefined' && crypto && crypto.subtle ? crypto : null;
    if (!C) return Promise.reject(new Error('no crypto.subtle'));
    return C.subtle.digest('SHA-256', new TextEncoder().encode(String(salt) + ':' + String(pin))).then(hexOf);
  }
  /** is this the PIN? pin0 = {h, s} (a Promise of true / false) */
  function pinVerify(pin, pin0) {
    pin = String(pin == null ? '' : pin).trim();
    if (!PIN_RE.test(pin) || !pin0 || !pin0.h || !pin0.s) return Promise.resolve(false);
    return pinHash(pin, pin0.s).then(function (h) { return h === pin0.h; }, function () { return false; });
  }
  /** one PIN try → the new counts: {fails (in a row), wrong (since locked), until (cool-down end), ok, lockout, blocked} */
  function pinStep(st, ok, now) {
    st = st || {};
    var o = { fails: +st.fails || 0, wrong: +st.wrong || 0, until: +st.until || 0 };
    if (now < o.until) { o.blocked = true; return o; }   // still cooling down: not even checked
    if (ok) { o.fails = 0; o.until = 0; o.ok = true; return o; }
    o.fails++; o.wrong++;
    if (o.fails >= LOCK_TRIES) { o.fails = 0; o.until = now + LOCK_MS; o.lockout = true; }
    return o;
  }
  /** a guard message (from HotelOps, or the helper's relay) → this tab's new guard state (the config is always taken; armed /
   *  disarmed only when it is newer than what this tab did itself, e.g. unlocked with the PIN a moment before HotelOps heard of it).
   *  null = not a message */
  function guardTake(cur, m) {
    if (!m || typeof m !== 'object') return null;
    cur = cur || {};
    var n = {}; Object.keys(cur).forEach(function (k) { n[k] = cur[k]; });
    n.pin = m.pin && /^[0-9a-f]{64}$/.test(String(m.pin.h || '')) && /^[0-9a-f]{8,64}$/.test(String(m.pin.s || '')) ? { h: String(m.pin.h), s: String(m.pin.s) } : null;
    n.auto = m.auto == null ? Math.max(0, Math.min(240, Math.round(+cur.auto || 0))) : Math.max(0, Math.min(240, Math.round(+m.auto || 0)));   // the relay's message has no minutes: kept
    var rev = +m.rev || 0, armed = !!m.armed;
    if (rev && rev < (+cur.rev || 0)) return n;   // older than this tab's own lock / unlock
    if (armed === !!cur.armed) { n.rev = Math.max(rev, +cur.rev || 0); if (armed && m.by) n.by = String(m.by).slice(0, 12); return n; }
    n.armed = armed; n.rev = rev || Date.now(); n.since = armed ? (+m.since || Date.now()) : 0; n.by = armed ? String(m.by || '').slice(0, 12) : '';
    n.fails = 0; n.wrong = 0; n.until = 0;
    return n;
  }
  /** the lock screen of one tab. o = { what: 'Opera' | 'WhatsApp', from: 'opera' | 'wa', attr: its data-hotelops name, ss: its
   *  sessionStorage key, top: the top frame (the PIN box is there), auto: idle auto-lock here, send(payload): to HotelOps,
   *  relay(msg): to the helper's relay (null in a console paste), tl(icon, text), render(), hint, hintNoPin }.
   *  payload: {events} · {unlocked, at} · {arm: 'auto', since, idle} */
  function hoLock(o) {
    o = o || {};
    var what = o.what || 'This page', SANS = 'system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
    var C = { txt: '#eef2f8', txt2: '#b9c3d2', txt3: '#8e9bb0', bad: '#f87171' };
    var send = typeof o.send === 'function' ? o.send : function () {};
    var relay = function (m) { try { if (typeof o.relay === 'function') o.relay(m); } catch (_) {} };
    var tl = function (i, t) { try { if (typeof o.tl === 'function') o.tl(i, t); } catch (_) {} };
    var redraw = function () { try { if (typeof o.render === 'function') o.render(); } catch (_) {} };
    var pad2 = function (n) { return String(n).padStart(2, '0'); };
    var hhmm = function (t) { var d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
    var RM = false; try { RM = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) {}
    var SS = { get: function (k, d) { try { var v = sessionStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } }, set: function (k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
    var G0 = SS.get(o.ss, null) || {};
    var G = guardTake({}, { pin: G0.pin, auto: G0.auto, armed: !!G0.armed, rev: +G0.rev || 0, since: G0.since, by: G0.by }) || {};
    G.fails = +G0.fails || 0; G.wrong = +G0.wrong || 0; G.until = +G0.until || 0;
    var GRACE = 15000, css = '', host = null, root = null, ui = {}, mo = null, iv = 0, Q = [], last = {}, human = Date.now(), humanSent = 0, busy = false, msg = '', msgAt = 0, sig = '', stopped = false;
    var save = function () { SS.set(o.ss, G); };
    var HOST_CSS = ['all:initial', 'position:fixed', 'inset:0', 'top:0', 'left:0', 'width:100vw', 'height:100vh', 'z-index:2147483647', 'display:block', 'margin:0', 'padding:0', 'border:0',
      'background:#070a12', 'opacity:1', 'visibility:visible', 'pointer-events:auto', 'transform:none', 'filter:none', 'clip-path:none', 'overflow:hidden'].map(function (d) { return d + ' !important'; }).join(';');
    function el(tag, cssText, text, parent) { var e = document.createElement(tag); if (cssText) e.style.cssText = cssText; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; }
    var lgN = 0;
    function logo(px) {   // the HotelOps logo: a white H on a glowing indigo tile
      var NS = 'http://www.w3.org/2000/svg', id = 'holkG' + Math.random().toString(36).slice(2, 7) + (++lgN);
      var mk = function (tag, at, parent) { var e = document.createElementNS(NS, tag); Object.keys(at).forEach(function (k) { e.setAttribute(k, at[k]); }); if (parent) parent.appendChild(e); return e; };
      var svg = mk('svg', { viewBox: '0 0 64 64', width: px, height: px, 'aria-hidden': 'true', style: 'display:block' }), defs = mk('defs', {}, svg);
      var rg = mk('radialGradient', { id: id, cx: '.3', cy: '.25', r: '.9' }, defs);
      [['0', '#7c8cff'], ['.55', '#4f46e5'], ['1', '#1e1b4b']].forEach(function (s) { mk('stop', { offset: s[0], 'stop-color': s[1] }, rg); });
      var lg = mk('linearGradient', { id: id + 'h', x1: '0', y1: '0', x2: '0', y2: '1' }, defs);
      mk('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '.22' }, lg); mk('stop', { offset: '.5', 'stop-color': '#fff', 'stop-opacity': '0' }, lg);
      mk('rect', { width: 64, height: 64, rx: 14.5, fill: 'url(#' + id + ')' }, svg); mk('rect', { width: 64, height: 64, rx: 14.5, fill: 'url(#' + id + 'h)' }, svg);
      var g = mk('g', { fill: '#fff' }, svg);
      mk('rect', { x: 18, y: 16, width: 8.5, height: 32, rx: 4.25 }, g); mk('rect', { x: 37.5, y: 16, width: 8.5, height: 32, rx: 4.25 }, g); mk('rect', { x: 22, y: 28.5, width: 20, height: 7, rx: 3.5 }, g);
      mk('circle', { cx: 47, cy: 14, r: 3.2, fill: '#c7d2fe' }, svg);
      return svg;
    }
    /** something happened at the lock screen → HotelOps (then your phone). A tap / a key once per 5 s, none in the first 15 s (you
     *  walking away). Those soft ones wait 5 s: the owner coming back and typing the right PIN at once is not "someone at your desk".
     *  A wrong PIN, the wait, tampering go at once (and take the waiting ones with them). */
    var soft = [], softT = 0, SOFT = { touch: 1, key: 1, try: 1 };
    function ev(kind, detail, n) {
      var t = Date.now();
      if (SOFT[kind]) { if (t - (G.since || 0) < GRACE || (last[kind] && t - last[kind] < 5000)) return; last[kind] = t; }
      var e = { id: 'o' + t.toString(36) + Math.random().toString(36).slice(2, 6), at: t, kind: kind, detail: String(detail || '').slice(0, 120), n: n || 0 };
      tl(kind === 'unlock' ? '🔓' : '🛡', String(detail || kind).slice(0, 100));
      if (SOFT[kind]) { soft.push(e); if (!softT) softT = setTimeout(softGo, 5000); return; }
      if (kind === 'unlock') { clearTimeout(softT); softT = 0; soft = []; } else softGo(true);
      Q.push(e); if (Q.length > 40) Q = Q.slice(-40);
      flush();
    }
    function softGo(noFlush) { clearTimeout(softT); softT = 0; if (!soft.length) return; Q = Q.concat(soft).slice(-40); soft = []; if (noFlush !== true) flush(); }
    function flush() { if (Q.length) send({ events: Q.slice(0, 20) }); }
    function say(t) { msg = t; msgAt = Date.now(); paint(); }
    function input() {   // a fresh, empty PIN box (the reader never sets a value, not even its own)
      if (!ui.row) return null;
      var old = ui.inp, inp = el('input', 'all:unset;box-sizing:border-box;flex:1;min-width:0;height:46px;padding:0 14px;border-radius:12px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.18);color:#fff;font:600 20px/46px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.35em;text-align:center;caret-color:#f1d184');
      inp.type = 'password'; inp.inputMode = 'numeric'; inp.maxLength = 6; inp.autocomplete = 'off'; inp.placeholder = '••••';
      inp.setAttribute('aria-label', 'PIN'); inp.setAttribute('data-ho', 'pin'); inp.spellcheck = false;
      if (old && old.parentNode) ui.row.replaceChild(inp, old); else ui.row.insertBefore(inp, ui.row.firstChild);
      ui.inp = inp;
      return inp;
    }
    function focus() { try { if (ui.inp && !ui.inp.disabled) ui.inp.focus({ preventScroll: true }); else if (ui.card) ui.card.focus({ preventScroll: true }); } catch (_) {} }
    function build() {
      if (host) return;
      host = document.createElement('div');
      host.setAttribute('data-hotelops', o.attr || 'ho-lock');
      host.style.cssText = HOST_CSS; css = host.getAttribute('style');   // as the browser writes it back
      root = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host;
      var bg = el('div', 'all:initial;position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;overflow:auto;cursor:default;user-select:none;-webkit-user-select:none;'
        + 'background:radial-gradient(900px 600px at 50% 30%,rgba(79,70,229,.22),transparent 70%),radial-gradient(700px 500px at 80% 90%,rgba(201,161,74,.10),transparent 70%),#070a12;'
        + 'font:14px/1.5 ' + SANS + ';color:' + C.txt + ';-webkit-font-smoothing:antialiased', null, root);
      var card = el('div', 'box-sizing:border-box;width:min(420px,100%);padding:28px 24px 22px;border-radius:22px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;outline:none;'
        + 'background:linear-gradient(180deg,rgba(24,30,43,.96),rgba(14,18,27,.98));border:1px solid rgba(255,255,255,.12);box-shadow:0 40px 90px -30px rgba(0,0,0,.8),0 0 0 1px rgba(0,0,0,.4)', null, bg);
      card.tabIndex = -1; card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-label', what + ' is locked');
      el('div', 'width:72px;height:72px;border-radius:19px;overflow:hidden;box-shadow:0 14px 36px -10px rgba(79,70,229,.75)', null, card).appendChild(logo(72));
      el('div', 'margin-top:6px;font:700 20px/1.25 ' + SANS + ';color:#fff;letter-spacing:-.015em', '🔒 ' + what + ' is locked — the owner is away', card);
      ui.sub = el('div', 'color:' + C.txt2 + ';font-size:13px', '', card);
      ui.row = el('div', 'display:flex;gap:8px;width:100%;margin-top:8px', null, card);
      ui.btn = el('button', 'all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;height:46px;padding:0 18px;border-radius:12px;font:600 14.5px/1.2 ' + SANS + ';'
        + 'color:#1a1408;background:linear-gradient(135deg,#f1d184,#c9a14a 60%,#a8842f);box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 6px 14px -8px rgba(201,161,74,.9)', 'Unlock', ui.row);
      ui.btn.type = 'button'; ui.btn.setAttribute('data-ho', 'unlock'); ui.btn.setAttribute('data-act', 'unlock');
      input();
      ui.msg = el('div', 'min-height:20px;font:600 13px/1.4 ' + SANS + ';color:' + C.bad, '', card);
      ui.hint = el('div', 'box-sizing:border-box;width:100%;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:' + C.txt2 + ';font-size:12.5px', '', card);
      el('div', 'margin-top:4px;color:' + C.txt3 + ';font-size:11.5px', 'What happens here is sent to the owner\'s phone.', card);
      ui.card = card;
      if (!o.top) { ui.row.style.display = 'none'; }   // a frame inside the page: the top frame's screen has the PIN box
      // inside the lock screen: nothing leaves it (the site never sees a key or a click), and the PIN box / Unlock button work
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'wheel', 'touchstart', 'touchmove', 'touchend', 'keydown', 'keyup', 'keypress',
        'beforeinput', 'input', 'paste', 'cut', 'copy', 'drop', 'dragstart', 'dragover', 'focusin', 'focusout', 'select', 'submit', 'pointermove', 'mousemove'].forEach(function (t) { root.addEventListener(t, inside, { capture: false, passive: false }); });
      document.documentElement.appendChild(host);
      mo = new MutationObserver(function () { keep(true); });
      mo.observe(document.documentElement, { childList: true });
      mo.observe(host, { attributes: true });
      paint(true);
    }
    /** keep the screen there, on top and untouched; someone took it away or hid it → back at once, and HotelOps is told */
    function keep(fromObs) {
      if (!G.armed || !host || stopped) return;
      var de = document.documentElement, gone = !host.isConnected || host.parentNode !== de, hid = host.getAttribute('style') !== css;
      if (gone || hid || host.attributes.length > 2 || (!fromObs && de.lastElementChild !== host)) {
        if (hid) host.setAttribute('style', css);
        if (host.attributes.length > 2) { for (var i = host.attributes.length - 1; i >= 0; i--) { var a = host.attributes[i].name; if (a !== 'style' && a !== 'data-hotelops') host.removeAttribute(a); } hid = true; }
        de.appendChild(host);
        if (gone || hid) ev('tamper', gone ? 'removed the lock screen (it came back)' : 'tried to hide the lock screen (it came back)');
        focus();
      }
    }
    var KEEP_KEYS = /^(?:[0-9]|Backspace|Delete|ArrowLeft|ArrowRight|Home|End|Enter|Tab|Shift)$/;
    function inside(e) {
      if (!G.armed) return;
      e.stopPropagation();   // never out to the site
      var t = e.target, onInp = t === ui.inp, onBtn = t === ui.btn || (ui.btn && ui.btn.contains && ui.btn.contains(t));
      var ty = e.type;
      if (ty === 'pointerdown' || ty === 'mousedown' || ty === 'touchstart') {
        if (!onInp && !onBtn && e.cancelable) e.preventDefault();   // the focus stays in the PIN box
        if (ty === 'pointerdown' && e.isTrusted) ev('touch', 'touched the locked screen');
        if (!onInp) setTimeout(focus, 0);
        return;
      }
      if (ty === 'wheel' || ty === 'touchmove' || ty === 'contextmenu' || ty === 'dragstart' || ty === 'drop' || ty === 'dragover') { if (e.cancelable) e.preventDefault(); return; }
      if (ty === 'click') { if (onBtn) tryPin(); return; }
      if (ty === 'keydown') {
        if (e.key === 'Enter') { if (e.cancelable) e.preventDefault(); tryPin(); return; }
        if (e.key === 'Tab') { if (e.cancelable) e.preventDefault(); focus(); return; }
        if (!onInp || e.ctrlKey || e.metaKey || e.altKey || !KEEP_KEYS.test(e.key)) { if (e.cancelable) e.preventDefault(); if (e.isTrusted) ev('key', 'pressed keys on the locked screen'); return; }
        if (/^[0-9]$/.test(e.key) && e.isTrusted) ev('try', 'is typing a PIN');
        return;
      }
      if ((ty === 'paste' || ty === 'drop' || ty === 'cut' || ty === 'copy') && e.cancelable) e.preventDefault();
    }
    /** outside the lock screen (a key with the focus somewhere on the site, a click that got past it): stopped before the site sees it */
    var EVS = ['pointerdown', 'pointerup', 'pointermove', 'pointerover', 'mousedown', 'mouseup', 'mousemove', 'mouseover', 'click', 'dblclick', 'auxclick', 'contextmenu',
      'keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'paste', 'cut', 'copy', 'drop', 'dragstart', 'dragover', 'submit', 'focusin'];
    function outside(e) {
      if (!G.armed || !host) return;
      var p = e.composedPath ? e.composedPath() : [];
      if (p.indexOf(host) >= 0 || e.target === host) return;   // ours: handled inside
      if (e.type === 'focusin') { setTimeout(focus, 0); return; }
      e.stopImmediatePropagation();
      if (e.cancelable) e.preventDefault();
      if (e.isTrusted && e.type === 'keydown') { ev('key', 'pressed keys on the locked screen'); setTimeout(focus, 0); }
      else if (e.isTrusted && e.type === 'pointerdown') ev('touch', 'touched the locked screen');
    }
    /** a real hand on this tab (auto-lock counts from the last one); a frame tells the top frame */
    function humanNow() {
      human = Date.now();
      if (!o.top && human - humanSent > 10000) { humanSent = human; try { window.top.postMessage({ __hoLockHuman: 1 }, '*'); } catch (_) {} }
    }
    // the clicks and keys are watched all the time (they do nothing while not armed); wheel and touch only while locked, so the
    // site's scrolling never waits for this; a real hand on the page (passive) is what auto-lock counts from
    var SCROLL = ['wheel', 'touchstart', 'touchmove', 'touchend'];
    EVS.forEach(function (t) { window.addEventListener(t, outside, { capture: true, passive: false }); document.addEventListener(t, outside, { capture: true, passive: false }); });
    function scroll(on) { SCROLL.forEach(function (t) { [window, document].forEach(function (w) { if (on) w.addEventListener(t, outside, { capture: true, passive: false }); else w.removeEventListener(t, outside, { capture: true }); }); }); }
    function hand(e) { if (e.isTrusted && (e.type !== 'pointermove' || Date.now() - human > 2000)) humanNow(); }
    var HANDS = ['pointerdown', 'keydown', 'wheel', 'pointermove', 'touchstart'];
    HANDS.forEach(function (t) { window.addEventListener(t, hand, { capture: true, passive: true }); });
    function onBlur() { if (G.armed) setTimeout(focus, 0); }
    window.addEventListener('blur', onBlur);
    function tryPin() {
      if (!o.top || !ui.inp || busy || !G.armed) return;
      var pin = String(ui.inp.value || '').trim();
      input(); focus();
      if (Date.now() < (G.until || 0)) { paint(); return; }
      if (!G.pin) { say('No PIN is set: unlock it from HotelOps.'); return; }
      if (!PIN_RE.test(pin)) { say('The PIN is 4 to 6 digits.'); return; }
      busy = true;
      pinVerify(pin, G.pin).then(function (ok) {
        busy = false;
        if (!G.armed) return;
        var st = pinStep(G, ok, Date.now());
        G.fails = st.fails; G.wrong = st.wrong; G.until = st.until; save();
        if (st.blocked) { paint(); return; }
        if (ok) {
          G.armed = false; G.rev = Date.now(); G.wrong = 0; G.fails = 0; G.until = 0; save();
          send({ unlocked: true, at: G.rev });
          relay({ source: 'ho-away-off', rev: G.rev, at: G.rev, from: o.from || '' });   // the helper unlocks the other tabs, even with HotelOps closed
          ev('unlock', 'unlocked with the PIN');
          unlock();
          return;
        }
        if (st.lockout) { ev('lockout', LOCK_TRIES + ' wrong PINs: locked for ' + Math.round(LOCK_MS / 1000) + ' s', st.wrong); say(''); }
        else { ev('fail', 'tried to unlock (wrong PIN ×' + st.wrong + ')', st.wrong); say('Wrong PIN' + (LOCK_TRIES - st.fails > 0 ? ' · ' + (LOCK_TRIES - st.fails) + ' more tr' + (LOCK_TRIES - st.fails === 1 ? 'y' : 'ies') + ' before a 1-minute wait' : '')); }
        if (!RM && ui.card && ui.card.animate) try { ui.card.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(0)' }], { duration: 320 }); } catch (_) {}
      });
    }
    function paint(force) {
      if (!host) return;
      var now = Date.now(), wait = Math.max(0, Math.ceil(((G.until || 0) - now) / 1000)), byTxt = G.by === 'auto' ? 'nobody used it for ' + (G.auto || '') + ' min' : G.by === 'now' ? 'locked from HotelOps' : 'the owner is away';
      var m = wait ? 'Too many wrong PINs — wait ' + wait + ' s' : msg && now - msgAt < 8000 ? msg : '';
      var s = [wait, m, !!G.pin, G.since, G.by].join('|'); if (!force && s === sig) return; sig = s;
      ui.sub.textContent = 'Locked at ' + hhmm(G.since || now) + ' · ' + byTxt;
      ui.msg.textContent = m;
      if (o.top) {
        ui.row.style.display = G.pin ? 'flex' : 'none';
        if (ui.inp) ui.inp.disabled = !!wait; ui.btn.style.opacity = wait ? '.45' : '1';
        ui.hint.textContent = G.pin ? (o.hint || 'Type your PIN and press Enter. Or unlock from HotelOps: “I\'m back” in the 🛡 Away guard.')
          : (o.hintNoPin || 'No PIN set: unlock from HotelOps (“I\'m back” in the 🛡 Away guard).');
        if (!wait && ui.inp && document.activeElement !== host) focus();
      } else ui.hint.textContent = 'Unlock from HotelOps.';
    }
    function lock() {
      build(); scroll(true); keep(); paint(true); focus();
      try { if (document.activeElement && document.activeElement !== host && document.activeElement.blur) document.activeElement.blur(); } catch (_) {}
      focus();
      tl('🔒', what + ' locked: ' + (G.by === 'auto' ? 'nobody used it for ' + G.auto + ' min' : 'you are away'));
      redraw();
    }
    function unlock() {
      var h = host; host = null; root = null; ui = {}; sig = ''; scroll(false);
      try { if (mo) mo.disconnect(); } catch (_) {} mo = null;
      try { if (h) h.remove(); } catch (_) {}
      human = Date.now();
      tl('🔓', what + ' unlocked');
      redraw();
    }
    /** HotelOps (or the helper's relay) says armed / disarmed (and the PIN's hash, the auto-lock minutes) */
    function take(m) {
      if (stopped) return;
      var n = guardTake(G, m); if (!n) return;
      var was = !!G.armed; G = n; save();
      if (G.armed && !was) lock();
      else if (!G.armed && was) unlock();
      else if (G.armed && document.documentElement) { build(); paint(true); }
    }
    /** every second while armed: on top, the cool-down count; while not: lock by itself after N idle minutes (needs a PIN) */
    iv = setInterval(function () {
      if (stopped) return;
      if (G.armed) {
        if (!document.documentElement) return;
        if (!host) lock();
        keep(); paint();
        if (o.top && ui.inp && !ui.inp.disabled && document.activeElement !== host) { try { if (document.hasFocus()) focus(); } catch (_) {} }
        if (Q.length && Date.now() % 10000 < 1000) flush();   // HotelOps hasn't said it got them yet: again every 10 s
        return;
      }
      if (o.auto && o.top && G.auto > 0 && G.pin && Date.now() - human > G.auto * 60e3) {
        var now = Date.now();
        G.armed = true; G.rev = now; G.since = now; G.by = 'auto'; G.fails = 0; G.wrong = 0; G.until = 0; save();
        send({ arm: 'auto', since: now, idle: now - human });
        lock();
      }
    }, 1000);
    function stop(silent) {
      if (stopped) return;
      if (G.armed && !silent) { try { ev('tamper', 'stopped the ' + what + ' reader (the lock screen went with it)'); } catch (_) {} }
      clearTimeout(softT);
      try { clearInterval(iv); if (mo) mo.disconnect(); if (host) host.remove(); } catch (_) {}
      EVS.forEach(function (t) { window.removeEventListener(t, outside, { capture: true }); document.removeEventListener(t, outside, { capture: true }); });
      scroll(false); HANDS.forEach(function (t) { window.removeEventListener(t, hand, { capture: true }); });
      window.removeEventListener('blur', onBlur);
      stopped = true;
    }
    if (G.armed && document.documentElement) lock();   // reloaded while locked: locked again at once
    return {
      take: take, stop: stop, flush: flush, lock: function () { if (G.armed && !host) lock(); },
      /** HotelOps got these events (they are not sent again) */
      ack: function (ids) { if (Array.isArray(ids)) Q = Q.filter(function (q) { return ids.indexOf(q.id) < 0; }); },
      /** ask the helper's relay whether you're away (a tab opened while HotelOps is closed locks at once) */
      ask: function () { relay({ source: 'ho-away-ask', from: o.from || '' }); },
      sink: function (f) { if (typeof f === 'function') send = f; },
      human: humanNow, idle: function (ms) { human -= Math.max(0, +ms || 0); },
      armed: function () { return !!G.armed; }, host: function () { return host; },
      state: function () { return { armed: !!G.armed, since: G.since || 0, by: G.by || '', pin: !!G.pin, auto: G.auto || 0, fails: G.fails || 0, wrong: G.wrong || 0, until: G.until || 0, queued: Q.length, shown: !!host && host.isConnected, top: !!host && document.documentElement.lastElementChild === host }; }
    };
  }
  // ══ </ho-lock> ═══════════════════════════════════════════════

  var H = { parsePre: parsePre, dateIso: dateIso, isToday: isToday, todayIso: todayIso, copyLine: copyLine, copyText: copyText, isMineId: isMineId, chips: chips, parser: HP, MARK: MARK,
    groupMatch: groupMatch, isHoGroup: isHoGroup, hoMarked: hoMarked, hoChips: hoChips, wordsLookup: wordsLookup, splitPreview: splitPreview, listTime: listTime, msgTs: msgTs, relTime: relTime, bins: bins, hashId: hashId, sameText: sameText,
    pinHash: pinHash, pinVerify: pinVerify, pinStep: pinStep, guardTake: guardTake };
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
  // the groups: [{name, act}] (act false = "log only": messages are kept in HotelOps, no room is changed)
  var groups = LS.get('ho_wa_groups', null);
  if (!Array.isArray(groups)) { var old = LS.get('ho_wa_group', ''); groups = old ? [{ name: old, act: true }] : []; }
  // run by the HotelOps helper (browser extension): no questions; groups are picked in the window (✎ Groups) or the first open group is offered
  var EXT = window.__hoWaExt || null;
  if (!groups.length && !EXT) { var g0 = (prompt('HotelOps: the name of the WhatsApp group to read (open the group first and it is filled in for you)', chatTitle()) || '').trim(); if (g0) groups.push({ name: g0, act: true }); }
  function saveGroups() { LS.set('ho_wa_groups', groups); }
  saveGroups();
  var seen = LS.get('ho_wa_seen', {});          // data-id → text already handed over
  var queue = LS.get('ho_wa_q', []);            // waiting for HotelOps to say "got it"
  var day = LS.get('ho_wa_day', null);          // today's counters {date, read, sent, acts, times}
  if (!day || day.date !== todayIso()) day = { date: todayIso(), read: 0, sent: 0, acts: 0, times: [] };
  if (!Array.isArray(day.times)) day.times = [];
  var out = LS.get('ho_wa_out', []);            // messages HotelOps asked us to send [{id, group, text, st, at}]
  if (!Array.isArray(out)) out = [];
  var auto = LS.get('ho_wa_auto', false) === true;
  var wordList = LS.get('ho_wa_words', []), words = wordsLookup(wordList);
  var answers = LS.get('ho_wa_ans', []);        // answers to send when HotelOps is linked again
  var asks = {};                                // word → {word, text, sender, room}
  var win = null, openedAt = 0, lastPong = 0, rtt = 0, mode = 'idle', firstScan = true, timers = [], obs = null, stopped = false, curKey = '';
  var watch = {};                               // chat-list watch: group → {k, unread}
  var feed = [];                                // newest first
  var minimized = false, unread = 0;

  var norm = function (s) { return sp(s).replace(/\s+/g, ' ').trim().toLowerCase(); };
  function save() {
    var ks = Object.keys(seen); if (ks.length > 800) ks.slice(0, ks.length - 800).forEach(function (k) { delete seen[k]; });
    if (queue.length > 200) queue = queue.slice(-200);
    if (day.date !== todayIso()) day = { date: todayIso(), read: 0, sent: 0, acts: 0, times: [] };
    if (day.times.length > 600) day.times = day.times.slice(-600);
    out = out.filter(function (o) { return Date.now() - o.at < 864e5; }).slice(-40);
    // written only when it changed (writing the browser's storage on every look was part of what slowed WhatsApp)
    [['ho_wa_seen', seen], ['ho_wa_q', queue], ['ho_wa_day', day], ['ho_wa_out', out], ['ho_wa_ans', answers]].forEach(function (x) {
      var j; try { j = JSON.stringify(x[1]); } catch (_) { return; }
      if (savedJ[x[0]] === j) return; savedJ[x[0]] = j;
      try { localStorage.setItem(x[0], j); } catch (_) {}
    });
  }
  var savedJ = {};

  // ── reading WhatsApp (several fallbacks; any miss just reads nothing) ──
  function chatTitle() {
    var h = document.querySelector('#main header'); if (!h) return '';
    var el = h.querySelector('span[dir="auto"][title]') || h.querySelector('span[dir="auto"]') || h.querySelector('[title]');
    var t = el ? (el.getAttribute('title') || el.textContent || '') : '';
    return t || String(h.textContent || '').split('\n')[0];
  }
  /** the listed group that is open now, or null */
  function openGroup() {
    var t = chatTitle(); if (!t) return null;
    var h = document.querySelector('#main header'), all = h ? normName(h.textContent || '') : '';
    for (var i = 0; i < groups.length; i++) { var g = groups[i]; if (groupMatch(g.name, t) || (normName(g.name).length >= 4 && all.indexOf(normName(g.name)) >= 0)) return g; }
    return null;
  }
  function textOf(el) {
    var o = '';
    (function walk(n) {
      n.childNodes.forEach(function (c) {
        if (c.nodeType === 3) o += c.nodeValue;
        else if (c.nodeType === 1) { if (c.tagName === 'IMG') o += c.getAttribute('alt') || ''; else if (c.tagName === 'BR') o += '\n'; else walk(c); }
      });
    })(el);
    return o.trim();
  }
  function rows() { var m = document.getElementById('main'); return m ? Array.prototype.slice.call(m.querySelectorAll('[data-id]')) : []; }
  // a reply shows the quoted message first: that block is never the message's own text
  var QUOTE_SEL = '[data-testid="quoted-message"],[aria-label*="uoted" i],.quoted-mention,[data-testid*="quoted"]';
  function quoteBox(e, row) {
    for (var n = e; n && n !== row; n = n.parentElement) {
      if (n.matches && n.matches(QUOTE_SEL)) return n;
      if (n.getAttribute && n.getAttribute('role') === 'button' && n.querySelector && n.querySelector('.quoted-mention')) return n;
    }
    return null;
  }
  function readRow(row) {
    try {
      var id = row.getAttribute('data-id'); if (!id) return null;
      var pres = Array.prototype.slice.call(row.querySelectorAll('[data-pre-plain-text]')).filter(function (e) { return !quoteBox(e, row); });
      var c = pres.filter(function (e) { return e.classList && e.classList.contains('copyable-text'); })[0] || pres[0] || null;
      var pre = c ? parsePre(c.getAttribute('data-pre-plain-text')) : null;
      // its own text: the last selectable text in the row that is not inside the quote
      var own = Array.prototype.slice.call(row.querySelectorAll('span.selectable-text, .selectable-text')).filter(function (e) { return !quoteBox(e, row) && !(e.parentElement && e.parentElement.closest('.selectable-text')); });
      var t = own[own.length - 1] || (c && !quoteBox(c, row) ? c : null);
      var text = t ? textOf(t) : '';
      if (!text) return null;
      var qe = row.querySelector(QUOTE_SEL), qb = qe ? (quoteBox(qe, row) || qe) : null, quote = '';
      if (qb) { var qt = qb.querySelector('.quoted-mention') || qb; quote = sp(textOf(qt)).replace(/\s+\n/g, '\n').trim().slice(0, 400); }
      var mine = isMineId(id) || !!row.querySelector('.message-out') || (row.classList && row.classList.contains('message-out'));
      var m = { id: id, text: text, sender: pre ? pre.sender : (mine ? 'Me' : ''), mine: mine, time: pre ? pre.time : '', date: pre ? pre.date : '', edited: false };
      if (quote) m.quote = quote;
      return m;
    } catch (_) { return null; }
  }
  var dmyToday = function () { return todayIso().split('-').reverse().join('/'); };
  var nowTime = function () { return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
  function take(m, opt) {
    var had = seen[m.id];
    if (had === m.text) return false;
    if (had !== undefined) m.edited = true; else { day.read++; day.times.push(msgTs(m.time)); }
    seen[m.id] = m.text;
    if (isHo(m.text)) m.ho = true;
    queue = queue.filter(function (q) { return q.id !== m.id; });
    m.at = Date.now(); queue.push(m);
    addFeed(m, opt);
    return true;
  }
  // "This message was deleted" / "You deleted this message": the same data-id, its text gone
  var DEL_RX = /^(?:this message was deleted|you deleted this message|تم حذف هذه الرسالة|لقد حذفت هذه الرسالة|se eliminó este mensaje|eliminaste este mensaje|ce message a été supprimé|vous avez supprimé ce message|diese nachricht wurde gelöscht|du hast diese nachricht gelöscht)\.?$/i;
  var delWait = {};
  function isDeleted(row) {
    if (row.querySelector('span[data-icon="recalled"], [data-icon*="recalled"], [data-testid*="recalled"]')) return 2;
    if (DEL_RX.test(sp(row.textContent || '').replace(/\s*\d{1,2}[:.]\d{2}\s*(?:[ap]\.?\s?m\.?)?\s*$/i, '').trim())) return 2;
    if (!row.querySelector('.selectable-text, [data-pre-plain-text], img, video, audio, canvas')) return 1;   // text gone, same row: wait for a second look
    return 0;
  }
  function checkDeleted(row) {
    var id = row.getAttribute('data-id'); if (!id || seen[id] === undefined || seen[id] === '\u0000del') return false;
    var d = isDeleted(row); if (!d) { delete delWait[id]; return false; }
    if (d === 1 && !delWait[id]) { delWait[id] = 1; return true; }
    delete delWait[id];
    seen[id] = '\u0000del';
    queue = queue.filter(function (q) { return q.id !== id; });
    var m = { id: id, deleted: true, text: '', at: Date.now() };
    queue.push(m);
    feed.forEach(function (f) { if (f.id === id && f.node) { f.deleted = true; f.node.style.opacity = '.55'; var t = f.node.querySelector('[data-t]'); if (t) { t.style.textDecoration = 'line-through'; } setT(f.stEl, '🗑 deleted'); f.stEl.style.color = '#fca5a5'; } });
    toast('🗑 A message was deleted in WhatsApp · HotelOps undoes it', 'warn');
    return true;
  }
  // a message row already read, unchanged since: nothing to do (an edit or a delete changes its text, so it is looked at again)
  var rowSig = typeof WeakMap === 'function' ? new WeakMap() : null;
  function readOpen(g) {
    var now = new Date();
    rows().forEach(function (row) {
      var id = row.getAttribute('data-id'), sig = id + '|' + row.childElementCount + '|' + (row.textContent || '');   // the whole text: an edit of the same length is still seen
      if (rowSig && seen[id] !== undefined && !delWait[id] && rowSig.get(row) === sig) return;
      if (rowSig) rowSig.set(row, sig);
      if (checkDeleted(row)) return;
      var m = readRow(row); if (!m) return;
      // first look at the group: today's messages on screen (the catch-up); later, new ones (a row with no date counts as today)
      if (m.date ? !isToday(m.date, now) : firstScan) return;
      if (!m.date) { m.date = dmyToday(); m.time = nowTime(); }
      m.group = g.name; m.act = g.act !== false;
      take(m);
    });
    firstScan = false;
  }
  // ── the chat list (left pane): the latest message of groups that are not open ──
  function chatRows() {
    var pane = document.getElementById('pane-side'); if (!pane) return [];
    var list = pane.querySelectorAll('[role="listitem"]'); if (!list.length) list = pane.querySelectorAll('[role="row"]');
    return Array.prototype.slice.call(list, 0, 80).map(function (row) {
      try {
        var titled = Array.prototype.slice.call(row.querySelectorAll('[title]'));
        var nameEl = row.querySelector('span[dir="auto"][title]') || titled[0]; if (!nameEl) return null;
        var name = nameEl.getAttribute('title') || '';
        var pv = titled.filter(function (e) { return e !== nameEl && !nameEl.contains(e) && e.getAttribute('title') !== name; }).pop();
        var preview = '', sender = null;
        if (pv) {
          preview = pv.getAttribute('title') || pv.textContent || '';
          var box = pv.parentElement, full = box ? sp(box.textContent || '').replace(/\s+/g, ' ').trim() : '', pt = sp(preview).replace(/\s+/g, ' ').trim();
          if (full.length > pt.length && full.slice(-pt.length) === pt) { var pre = full.slice(0, -pt.length).replace(/[:\s]+$/, '').trim(); if (pre && pre.length <= 40) sender = pre; }
        }
        var time = '', un = 0;
        Array.prototype.slice.call(row.querySelectorAll('div,span')).some(function (e) { if (e.children.length) return false; var tt = listTime(e.textContent); if (tt) { time = tt; return true; } return false; });
        var ue = row.querySelector('[aria-label*="unread" i]'); if (ue) un = parseInt(ue.textContent, 10) || 1;
        return { name: name, preview: preview, sender: sender, time: time, unread: un };
      } catch (_) { return null; }
    }).filter(Boolean);
  }
  // WhatsApp search is open: the side list shows search results (old messages), not the chats — read nothing
  function searching() {
    var side = document.getElementById('side'); if (!side) return false;   // the left column only, never the message box
    var box = side.querySelector('[contenteditable="true"], input[type="text"], input[type="search"], input:not([type])');
    var t = box ? (box.value !== undefined && box.tagName === 'INPUT' ? box.value : box.textContent) : '';
    return !!String(t || '').trim();
  }
  var wasSearching = false;
  function watchList() {
    if (searching()) { wasSearching = true; return; }
    if (wasSearching) { wasSearching = false; watch = {}; }       // back from a search: look again first, act only on what is new after
    var list = chatRows(); if (!list.length) return;
    groups.forEach(function (g) {
      if (curKey && groupMatch(g.name, curKey)) return;           // open: read fully
      var r = list.filter(function (x) { return groupMatch(g.name, x.name); })[0]; if (!r) return;
      var gk = normName(g.name), k = r.time + '|' + (r.sender || '') + '|' + r.preview, st = watch[gk];
      watch[gk] = { k: k, unread: r.unread };
      if (!st) return;                                             // the first look: just remember it
      if (st.k === k || !r.preview || !r.time) return;             // nothing new (or not from today)
      var p = splitPreview(r.preview, r.sender);
      if (!p.text) return;
      var m = { id: 'pv_' + hashId(gk + '|' + r.time + '|' + p.sender + '|' + p.text), text: p.text, sender: p.sender, mine: p.mine, time: r.time, date: dmyToday(), edited: false,
        group: g.name, act: g.act !== false, preview: true, truncated: /(?:…|\.\.\.)$/.test(p.text) };
      if (seen[m.id] !== undefined) return;
      var missed = Math.max(0, r.unread - (st.unread || 0) - 1);
      take(m, { missed: missed });
    });
  }
  var lastScan = 0;
  // what changed since the last look (set by the page watcher): only that is read again; everything once every 30 s anyway
  var dirtyMain = true, dirtyList = true, fullAt = 0;
  function scan() {
    if (stopped) return;
    var t0 = Date.now(), full = t0 - fullAt > 30000;
    lastScan = t0; if (full) fullAt = t0;
    var g = openGroup(), key = g ? g.name : '';
    if (key !== curKey) { firstScan = true; curKey = key; dirtyMain = true; }
    if (g && (dirtyMain || firstScan || full)) { dirtyMain = false; readOpen(g); }
    if (dirtyList || full) { dirtyList = false; watchList(); }
    trySend(); checkTyped();
    save(); flush(); render();
  }

  // ── Away guard ────────────────────────────────────────────
  // While you've marked yourself away in HotelOps (phone or PC), anyone using this WhatsApp is reported:
  // which chat they open, what was on the screen while they scrolled, what they searched, if they typed.
  // Only real hands on the mouse / keyboard count (event.isTrusted) — what this reader does itself never does.
  var guard = LS.get('ho_wa_guard', { on: false, since: 0, auto: 0 }), gq = LS.get('ho_wa_gq', []), gChat = '', gInput = 0, gBurst = {}, gSearchT = 0;
  var gHuman = Date.now(), gArmAsked = 0, gTypeT = 0;   // the last real mouse / keyboard use on this page (auto-away)
  var GUARD_GRACE = 45000;   // time to walk away after switching it on
  function guardOn() { return !!guard.on && Date.now() - (guard.since || 0) > GUARD_GRACE; }
  function setGuard(g) {
    lockFrom(g);
    var on = !!(g && g.on), since = (g && +g.since) || 0;
    if (g && typeof g.auto === 'number' && g.auto !== guard.auto) { guard.auto = g.auto; LS.set('ho_wa_guard', guard); }
    if (on === !!guard.on && since === (guard.since || 0)) return;
    guard = { on: on, since: since || Date.now(), auto: guard.auto || 0 }; LS.set('ho_wa_guard', guard);
    gChat = sp(chatTitle()); gBurst = {};
  }
  function visibleLines() {
    var vh = window.innerHeight || 800;
    return rows().filter(function (r) { var b = r.getBoundingClientRect(); return b.bottom > 0 && b.top < vh; }).map(readRow).filter(Boolean).slice(-4)
      .map(function (m) { return (m.sender ? m.sender + ': ' : '') + sp(m.text).replace(/\s+/g, ' ').slice(0, 100); });
  }
  function searchText() {
    var side = document.getElementById('side'); if (!side) return '';
    var box = side.querySelector('[contenteditable="true"], input[type="text"], input[type="search"], input:not([type])');
    return sp(box ? (box.tagName === 'INPUT' ? box.value : box.textContent) : '').trim().slice(0, 60);
  }
  function gEvent(kind, detail, withLines) {
    var chat = sp(chatTitle()).slice(0, 80), t = Date.now(), k = kind + '|' + chat + (kind === 'search' ? '|' + detail : '');
    var win = (kind === 'type' || kind === 'search' || kind === 'chat') ? 6000 : 20000;   // the things that matter update sooner; noisy ones (scroll/click/focus) stay calm
    if (gBurst[k] && t - gBurst[k] < win) return;
    gBurst[k] = t;
    var work = !!chat && groups.some(function (g) { return groupMatch(g.name, chat); });   // one of your work groups: less serious
    gq.push({ id: 'g' + t.toString(36) + Math.random().toString(36).slice(2, 6), at: t, kind: kind, chat: chat, work: work, detail: String(detail || '').slice(0, 140), lines: withLines === false ? [] : visibleLines() });
    if (gq.length > 80) gq = gq.slice(-80);
    LS.set('ho_wa_gq', gq); gFlush();
  }
  function gFlush() { if (gq.length) post({ source: 'ho-wa', guard: { events: gq.slice(0, 25) } }); }
  function gInputEv(e) {
    if (e.isTrusted) gHuman = Date.now();
    if (!e.isTrusted || !guardOn()) return;
    gInput = Date.now();
    var tg = e.target && e.target.nodeType === 1 ? e.target : null;
    if (tg && ((typeof root !== 'undefined' && root && root.contains(tg)) || (typeof mini !== 'undefined' && mini && mini.contains(tg)))) { gEvent('reader', 'used the HotelOps reader window', false); return; }
    var side = document.getElementById('side'), foot = document.querySelector('#main footer');
    if (e.type === 'keydown' || e.type === 'input') {
      if (side && tg && side.contains(tg)) { clearTimeout(gSearchT); gSearchT = setTimeout(function () { var q = searchText(); if (q) gEvent('search', 'searched for "' + q + '"', false); }, 1500); return; }
      if (foot && tg && foot.contains(tg)) {
        // read what is being typed on 'input' (the character is in the box by then), and wait a beat so the
        // snapshot is what they've written so far, not the first letter; the newest text replaces an older line
        clearTimeout(gTypeT); gTypeT = setTimeout(function () {
          var cb = composeBox(), typed = cb ? sp(cb.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) : '';
          delete gBurst['type|' + sp(chatTitle()).slice(0, 80)];   // let the fuller text through, not stuck on the first keystroke
          gEvent('type', typed ? 'typing: “' + typed + '”' : 'typing a message in this chat');
        }, 500);
        return;
      }
    }
    if (e.type === 'wheel' || (e.type === 'keydown' && /^(?:PageUp|PageDown|ArrowUp|ArrowDown|Home|End)$/.test(e.key))) { setTimeout(function () { gEvent('read', 'scrolling and reading'); }, 600); return; }
    if (e.type === 'pointerdown') gEvent('touch', 'clicking in WhatsApp', false);
  }
  function gFocus(e) { if (e.isTrusted && guardOn()) gEvent('focus', 'came to the WhatsApp tab', false); }
  var G_EVS = ['pointerdown', 'keydown', 'wheel', 'input'];
  G_EVS.forEach(function (t) { document.addEventListener(t, gInputEv, { capture: true, passive: true }); });
  window.addEventListener('focus', gFocus, true);
  function guardTick() {
    var c = sp(chatTitle());
    if (c !== gChat) { var was = gChat; gChat = c; if (c && guardOn() && Date.now() - gInput < 6000) setTimeout(function () { gEvent('chat', was ? 'opened this chat (was on "' + was.slice(0, 40) + '")' : 'opened this chat'); }, 900); }
    if (guard.on) gFlush();
    // auto-away: nobody has touched this PC for the minutes you chose → ask HotelOps to switch the guard on
    if (!guard.on && guard.auto > 0 && Date.now() - gHuman > guard.auto * 60e3 && Date.now() - gArmAsked > 60e3) {
      gArmAsked = Date.now(); post({ source: 'ho-wa', guard: { arm: 'auto', idle: Date.now() - gHuman } });
    }
  }

  // ── 🔒 the lock screen while you're away (the shared <ho-lock> block above: the same as Opera's, the same PIN) ──
  // With the helper it is already running (it starts before WhatsApp has loaded, window.__hoWaLock): this reader adopts it.
  var LOCK_OWN = !(window.__hoWaLock && typeof window.__hoWaLock.take === 'function');
  var LOCK = LOCK_OWN ? hoLock({ what: 'WhatsApp', from: 'wa', attr: 'wa-guard', ss: 'ho_wa_lock', top: true, auto: false,
    relay: EXT && typeof EXT.post === 'function' ? function (m) { EXT.post(m); } : null }) : window.__hoWaLock;
  LOCK.sink(function (g) { post({ source: 'ho-wa', lock: g }); });
  if (LOCK_OWN) { window.__hoWaLock = LOCK; LOCK.ask(); }
  /** HotelOps' guard message may carry the lock ({armed, rev, since, by, pin}) */
  function lockFrom(g) { if (g && g.lock && typeof g.lock === 'object') LOCK.take(g.lock); }

  // ── talking to HotelOps ───────────────────────────────────
  function post(o) { try { if (win && !win.closed) { win.postMessage(o, APP_ORIGIN); return true; } } catch (_) {} return false; }
  function flush() {
    if (mode !== 'linked') return;
    var t = Date.now();
    queue.forEach(function (m) {
      if (!m.sentAt || t - m.sentAt > 4000) {
        m.sentAt = t;
        if (m.deleted) { post({ source: 'ho-wa', msg: { id: m.id, deleted: true } }); return; }
        var o = { id: m.id, text: m.text, sender: m.sender, mine: m.mine, time: m.time, date: m.date, edited: m.edited };
        if (m.group) { o.group = m.group; o.act = m.act !== false; }
        if (m.quote) o.quote = m.quote;
        if (m.preview) { o.preview = true; o.truncated = !!m.truncated; }
        post({ source: 'ho-wa', msg: o });
      }
    });
    if (answers.length) { answers.forEach(function (a) { post({ source: 'ho-wa', answer: a }); }); answers = []; save(); }
  }
  function connect() {
    if (!win || win.closed) win = window.open(APP_URL + '#wa-bridge', 'hotelops-wa');
    else try { win.focus(); } catch (_) {}
    openedAt = Date.now(); if (mode !== 'linked') mode = 'waiting'; render();
  }
  function report(o, status, why) {
    o.st = status; o.why = why || '';
    post({ source: 'ho-wa-sent', id: o.id, status: status, group: o.group, why: why || '' });
    save(); renderOut();
  }
  function onMsg(e) {
    if (e.origin !== APP_ORIGIN || !e.data || typeof e.data !== 'object') return;
    var d = e.data;
    if (d.source === 'ho-wa-pong') {
      if (d.guard && typeof d.guard === 'object') setGuard(d.guard);
      lastPong = Date.now(); if (typeof d.t === 'number' && d.t > 0) rtt = Math.max(1, Date.now() - d.t);
      if (mode !== 'linked') { mode = 'linked'; toast('✓ Linked to HotelOps', 'ok'); }
      if (d.ready) flush(); render();
    }
    if (d.source === 'ho-wa-gack' && Array.isArray(d.ids)) { gq = gq.filter(function (g) { return d.ids.indexOf(g.id) < 0; }); LS.set('ho_wa_gq', gq); LOCK.ack(d.ids); return; }
    if (d.source === 'ho-away') { if (d.away && typeof d.away === 'object') LOCK.take(d.away); return; }   // the helper's relay: you're away / a PIN unlocked another tab
    if (d.source === 'ho-wa' && d.guard && typeof d.guard === 'object') { setGuard(d.guard); return; }
    if (d.source === 'ho-wa-ack' && d.id) {
      var n = queue.length, it = queue.filter(function (q) { return q.id === d.id; })[0]; queue = queue.filter(function (q) { return q.id !== d.id; });
      if (queue.length < n && it && !it.deleted) {
        day.sent++; markFeed(d.id, 'sent');
        var f = feed.filter(function (x) { return x.id === d.id; })[0];
        var nf = Array.isArray(d.res) ? d.res.filter(function (r) { return r && r.st === 'notlist'; }).map(function (r) { return String(r.room); }) : [];
        var okL = f ? f.chips.filter(function (c) { return /^(?:co|lco|ext|extending)$/.test(c.tone) && !nf.some(function (rm) { return rm && (' ' + c.label + ' ').indexOf(' ' + rm + ' ') >= 0; }); }).map(function (c) { return c.label.replace(/ · .*$/, ''); }) : [];
        if (f && f.acts) { day.acts += f.acts; if (okL.length) toast(okL.join(', ') + ' → HotelOps', 'ok'); }
        else if (it && it.preview && f && f.state === 'sent') { /* quiet */ }
      }
      if (Array.isArray(d.res)) gotRes(d.id, d.res);
      save(); render();
    }
    if (d.source === 'ho-wa' && d.words && Array.isArray(d.words)) {
      wordList = d.words.slice(0, 500); words = wordsLookup(wordList); LS.set('ho_wa_words', wordList);
      Object.keys(asks).forEach(function (w) { if (words(w)) delete asks[w]; });
      renderAsks();
    }
    if (d.source === 'ho-wa' && d.send && typeof d.send === 'object' && d.send.id) onSend(d.send);
  }
  function tick() {
    var t = Date.now();
    if (win && !win.closed) post({ source: 'ho-wa', ping: true, t: t, groups: groups.map(function (g) { return { name: g.name, act: g.act !== false }; }), open: curKey, auto: auto });
    if (mode === 'waiting' && !lastPong && t - openedAt > 8000) mode = 'copy';     // WhatsApp cut the link to the tab (or it never loaded)
    if (mode === 'linked' && (!win || win.closed || t - lastPong > 15000)) mode = win && !win.closed ? 'waiting' : 'idle';
    if (mode === 'waiting' && lastPong && t - lastPong < 15000) mode = 'linked';
    if (typing()) flush();                                   // ⌨ your fingers are on the keyboard: nothing heavy now
    else if (t - lastScan > 4500) scan(); else { flush(); render(); }
    try { guardTick(); } catch (_) {}
  }

  // ── sending what HotelOps asked for (only that) ───────────
  function composeBox() {
    var f = document.querySelector('#main footer');
    return (f && (f.querySelector('div[contenteditable="true"][data-tab]') || f.querySelector('[contenteditable="true"][role="textbox"]') || f.querySelector('[contenteditable="true"]'))) ||
      document.querySelector('#main div[contenteditable="true"][data-tab]') || null;
  }
  function sendButton() {
    // WhatsApp renames this often: "send", "wds-ic-send-filled", data-testid "compose-btn-send", aria-label "Send"
    var roots = [document.querySelector('#main footer'), document.querySelector('#main'), document].filter(Boolean);
    for (var i = 0; i < roots.length; i++) {
      var f = roots[i];
      var b = f.querySelector('button[aria-label="Send"]') || f.querySelector('[role="button"][aria-label="Send"]') || f.querySelector('[data-testid="compose-btn-send"]') || f.querySelector('[data-testid*="send"]');
      if (!b) { var ic = f.querySelector('[data-icon="send"]') || f.querySelector('[data-icon="wds-ic-send-filled"]') || f.querySelector('[data-icon*="send"]'); if (ic) b = ic.closest('button') || ic.closest('[role="button"]') || ic.parentElement || ic; }
      if (b) return b;
    }
    return null;
  }
  /** press it the way a finger does (some WhatsApp buttons only listen to pointer/mouse events), else Enter in the box */
  function pressSend(box) {
    var b = sendButton();
    if (b) {
      try {
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(function (t) { b.dispatchEvent(new (t.indexOf('pointer') === 0 && window.PointerEvent ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true, view: window })); });
        b.click(); return true;
      } catch (_) {}
    }
    try {
      box = box || composeBox(); if (!box) return false; box.focus();
      ['keydown', 'keypress', 'keyup'].forEach(function (t) { box.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })); });
      return true;
    } catch (_) { return false; }
  }
  var boxText = function (b) { return b ? String(b.innerText || b.textContent || '').replace(/[⁣​]/g, '').trim() : ''; };
  function clearBox(b) { try { b.focus(); document.execCommand('selectAll', false, null); document.execCommand('delete', false, null); } catch (_) {} }
  /** put the text in WhatsApp's box the way a person would (so WhatsApp sees it): paste for several lines, else insertText */
  function insert(b, text) {
    b.focus();
    try { var sel = window.getSelection(), r = document.createRange(); r.selectNodeContents(b); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); } catch (_) {}
    var lines = text.split('\n');
    if (lines.length > 1) {
      try { var dt = new DataTransfer(); dt.setData('text/plain', text); b.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); } catch (_) {}
      if (sameText(boxText(b), text)) return true;
      if (boxText(b)) clearBox(b);
    }
    try { document.execCommand('insertText', false, text); } catch (_) {}
    if (sameText(boxText(b), text)) return true;
    if (lines.length > 1) {
      if (boxText(b)) clearBox(b);
      lines.forEach(function (l, i) {
        if (i) { try { b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, shiftKey: true, bubbles: true, cancelable: true })); } catch (_) {} }
        if (l) try { document.execCommand('insertText', false, l); } catch (_) {}
      });
      if (sameText(boxText(b), text)) return true;
    }
    return false;
  }
  function mineIds() { return rows().filter(function (r) { return isMineId(r.getAttribute('data-id')) || !!r.querySelector('.message-out'); }).map(function (r) { return r.getAttribute('data-id'); }); }
  function onSend(s) {
    var have = out.filter(function (o) { return o.id === s.id; })[0];
    if (s.cancel) { if (have && (have.st === 'queued' || have.st === 'new')) report(have, 'cancelled'); return; }
    if (have) { report(have, have.st === 'new' ? 'queued' : have.st, have.why); return; }   // never typed twice
    var text = String(s.text || '').slice(0, 3000);
    if (!text.replace(/[⁣\s]/g, '')) return;
    var g = s.group ? groups.filter(function (x) { return groupMatch(x.name, s.group); })[0] : null;
    var o = { id: String(s.id).slice(0, 60), group: g ? g.name : (s.group || curKey || (groups[0] && groups[0].name) || ''), text: text, st: 'new', at: Date.now(), auto: !!s.auto };
    out.push(o); save();
    trySend();
    if (o.st === 'new') report(o, 'queued', 'Open ' + (o.group || 'the group') + ' to send');
    if (curTab !== 'send') { sendBadge++; }
    render();
  }
  function trySend() {
    if (out.some(function (o) { return o.st === 'typed'; })) return;      // one at a time: the last one is still in the box
    var o = out.filter(function (x) { return (x.st === 'new' || x.st === 'queued') && curKey && (!x.group || groupMatch(x.group, curKey)); })[0];
    if (!o) return;
    var b = composeBox();
    if (!b) { if (o.why !== 'nobox') report(o, 'queued', 'Could not find the message box · click in it once'); o.why = 'nobox'; return; }
    if (boxText(b)) { if (o.why !== 'busy') { report(o, 'queued', 'The message box is not empty'); o.why = 'busy'; } return; }
    o.mine0 = mineIds();
    if (!insert(b, o.text)) { report(o, 'failed', 'WhatsApp did not take the text · check the message box'); return; }
    o.typedAt = Date.now();
    var go = auto || o.auto;   // the WhatsApp window's switch, or "Send automatically" ticked in HotelOps for this message
    report(o, 'typed', go ? '' : 'Press Enter in WhatsApp to send');
    toast(go ? '✉ Sending to ' + o.group + '…' : '⌨ Typed in ' + o.group + ' · press Enter to send', 'info');
    if (go) timers.push(setTimeout(function () { if (stopped || o.st !== 'typed') return; if (!pressSend(b)) report(o, 'failed', 'Could not press Send · press Enter'); timers.push(setTimeout(checkTyped, 700)); timers.push(setTimeout(function () { if (!stopped && o.st === 'typed' && boxText(composeBox())) { pressSend(composeBox()); timers.push(setTimeout(checkTyped, 700)); } }, 1500)); }, 350));
  }
  function checkTyped() {
    out.forEach(function (o) {
      if (o.st !== 'typed') return;
      var b = composeBox();
      if (!b || !curKey || !groupMatch(o.group, curKey)) return;      // another chat is open: it waits in WhatsApp's draft
      if (boxText(b)) return;                                         // still in the box
      var before = o.mine0 || [], fresh = rows().filter(function (r) { var id = r.getAttribute('data-id'); return (isMineId(id) || !!r.querySelector('.message-out')) && before.indexOf(id) < 0; });
      var hit = fresh.filter(function (r) { var m = readRow(r); return m && sameText(m.text, o.text); })[0] || fresh[0];
      if (hit) { report(o, 'sent'); toast('✓ Sent to ' + o.group, 'ok'); }
      else if (Date.now() - (o.typedAt || 0) > 2500) report(o, 'failed', 'The text was removed before it was sent');
    });
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
    var o = document.getElementById('ho-wa-manual'); if (o) o.remove();
    var box = document.createElement('div'); box.id = 'ho-wa-manual';
    box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font:13px/1.4 system-ui,sans-serif';
    var card = document.createElement('div'); card.style.cssText = 'width:min(560px,92vw);background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:14px;padding:16px;box-shadow:0 20px 60px rgba(0,0,0,.6)';
    var h = document.createElement('div'); h.textContent = 'Press Ctrl+C now, then paste in HotelOps'; h.style.cssText = 'font-weight:700;font-size:14px;margin-bottom:8px;color:#25d366';
    var ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'width:100%;height:220px;box-sizing:border-box;background:#0b1220;color:#e5e7eb;border:1px solid #374151;border-radius:8px;padding:8px;font:12px/1.4 ui-monospace,monospace';
    var b = document.createElement('button'); b.textContent = 'Done'; b.type = 'button'; b.style.cssText = 'margin-top:10px;padding:8px 16px;border-radius:8px;border:0;background:#25d366;color:#04210f;font-weight:700;cursor:pointer';
    b.onclick = function () { box.remove(); };
    ta.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && /c/i.test(e.key)) setTimeout(function () { box.remove(); toast('✓ Copied · paste them in HotelOps', 'ok'); }, 150); });
    card.appendChild(h); card.appendChild(ta); card.appendChild(b); box.appendChild(card); document.body.appendChild(box);
    ta.focus(); ta.select();
  }
  function scroller() {
    var r = rows()[0]; var e = r && r.parentElement;
    while (e && e !== document.body) { var s = getComputedStyle(e); if (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight) return e; e = e.parentElement; }
    return null;
  }
  function todaysMessages() {
    var now = new Date(), list = [], olderOnScreen = false;
    rows().forEach(function (row) { var m = readRow(row); if (!m || !m.date) return; if (isToday(m.date, now)) list.push(m); else olderOnScreen = true; });
    return { list: list, complete: olderOnScreen };
  }
  var loading = false;
  function copyToday() {
    if (!openGroup()) { toast('Open one of your groups first', 'warn'); return; }
    var r = todaysMessages();
    if (!r.complete && !loading) {
      // the first message of today may not be loaded yet: scroll the chat up a few times (read only), then ask for one more click
      loading = true; toast('Loading earlier messages…');
      var sc = scroller(), n = 0;
      var step = function () {
        if (stopped) return;
        if (sc) sc.scrollTop = 0;
        n++;
        if (todaysMessages().complete || n >= 6) { loading = false; toast('Ready · click Copy again for ' + todaysMessages().list.length + ' messages'); return; }
        timers.push(setTimeout(step, 1200));
      };
      step(); return;
    }
    if (!r.list.length) { toast('No messages from today on screen', 'warn'); return; }
    toClipboard(copyText(r.list)).then(function (ok) {
      if (ok && mode === 'copy') { queue.forEach(function (q) { markFeed(q.id, 'copied'); }); queue = []; save(); }
      toast(ok ? '✓ Copied ' + r.list.length + ' messages · paste them in HotelOps' : 'Could not copy · select the messages and press Ctrl+C', ok ? 'ok' : 'warn');
    });
  }
  function copyNew() {
    if (!queue.length) { copyToday(); return; }
    var list = queue.slice();
    toClipboard(copyText(list)).then(function (ok) {
      if (ok) { list.forEach(function (q) { markFeed(q.id, 'copied'); }); queue = []; save(); toast('✓ Copied ' + list.length + ' new · paste them in HotelOps', 'ok'); render(); }
      else toast('Could not copy · select the messages and press Ctrl+C', 'warn');
    });
  }

  // ══ The window (DOM calls + inline styles only) ═════════════
  // Everything is styled inline on our own elements (ids start with "hoWa"), so WhatsApp's page is never touched.
  var RM = false; try { RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}
  var SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif', MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
  var ACC = '#25d366', ACC_D = '#00a884', ACC_L = '#8af0b4', ACC_RGB = '37,211,102';   // WhatsApp green
  var INK = '#04210f';                                                                 // text on green
  var TXT = '#e9edef', TXT2 = '#aebac1', TXT3 = '#8696a0', LINE = 'rgba(255,255,255,.08)', CARD = 'rgba(255,255,255,.045)';
  var TONE = {            // dot, text, background
    green: [ACC, ACC_L, 'rgba(' + ACC_RGB + ',.14)'],
    amber: ['#f59e0b', '#fcd34d', 'rgba(245,158,11,.14)'],
    blue:  ['#53bdeb', '#b6e3f7', 'rgba(83,189,235,.14)'],
    red:   ['#ef4444', '#fca5a5', 'rgba(239,68,68,.15)']
  };
  // per action: bar/icon colour, chip text, chip background, icon
  var ACT = { maybe: ['#a78bfa', '#ddd6fe', 'rgba(139,92,246,.12)', '🤔'], co: [ACC, ACC_L, 'rgba(' + ACC_RGB + ',.14)', '✓'], findone: [ACC, ACC_L, 'rgba(' + ACC_RGB + ',.12)', '✓'],
    lco: ['#f59e0b', '#fcd34d', 'rgba(245,158,11,.14)', '⏰'], ext: ['#2dd4bf', '#99f6e4', 'rgba(45,212,191,.14)', '↪'], extending: ['#2dd4bf', '#99f6e4', 'rgba(45,212,191,.10)', '⏳'],
    fin: ['#fb923c', '#fed7aa', 'rgba(251,146,60,.14)', '🧾'], note: ['#a78bfa', '#ddd6fe', 'rgba(139,92,246,.16)', '✎'],
    ho: ['#818cf8', '#c7d2fe', 'rgba(129,140,248,.14)', '📋'], ask: ['#fbbf24', '#fde68a', 'rgba(251,191,36,.12)', '?'], req: ['#53bdeb', '#b6e3f7', 'rgba(83,189,235,.14)', '📝'], bad: ['#ef4444', '#fca5a5', 'rgba(239,68,68,.15)', '⚠'], off: ['#6b7280', '#9aa3b2', 'rgba(255,255,255,.05)', '·'] };
  var ROOM_TONES = /^(?:co|lco|ext|extending|maybe|fin|findone|bad)$/;
  function el(tag, css, text, parent) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function setT(e, t) { t = String(t); if (e.textContent !== t) e.textContent = t; }
  function anim(e, frames, opt) { if (RM && !(opt && opt.always)) return null; try { if (e && e.animate) return e.animate(frames, opt); } catch (_) {} return null; }
  function hover(b, on, off) { b.addEventListener('mouseenter', function () { b.style.cssText += on; }); b.addEventListener('mouseleave', function () { b.style.cssText += off; }); }
  /** a visible ring for keyboard users (all:unset removes the browser's own) */
  function ring2(b) {
    b.addEventListener('focus', function () { var v = false; try { v = b.matches(':focus-visible'); } catch (_) {} if (v) b.style.outline = '2px solid ' + ACC; b.style.outlineOffset = '1px'; });
    b.addEventListener('blur', function () { b.style.outline = 'none'; });
    return b;
  }
  /** keys typed in our inputs stay ours (WhatsApp moves stray typing into its message box) */
  function keepKeys(i) { ['keydown', 'keypress', 'keyup', 'input', 'paste'].forEach(function (t) { i.addEventListener(t, function (e) { e.stopPropagation(); }); }); }
  var BTN = 'all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:10px;font:600 12px/1 ' + SANS + ';padding:8px 10px;white-space:nowrap;transition:background .15s,border-color .15s,transform .1s,filter .15s;';
  var BTN2 = BTN + 'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:' + TXT + ';';
  var ICONB = 'all:unset;box-sizing:border-box;cursor:pointer;width:26px;height:26px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;color:' + TXT2 + ';font:600 13px/1 ' + SANS + ';transition:background .15s,color .15s;';
  function btn2(label, parent, css) { var b = el('button', BTN2 + (css || ''), label, parent); b.type = 'button'; hover(b, 'background:rgba(255,255,255,.11);border-color:rgba(255,255,255,.22);', 'background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.12);'); return ring2(b); }
  /** an on/off switch */
  function toggle(on, parent, onChange) {
    var b = el('button', 'all:unset;box-sizing:border-box;cursor:pointer;flex:none;position:relative;width:34px;height:20px;border-radius:99px;transition:background .2s', null, parent);
    b.type = 'button'; b.setAttribute('role', 'switch'); ring2(b);
    var k = el('span', 'position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.4);transition:transform .2s', null, b);
    var set = function (v) { on = !!v; b.setAttribute('aria-checked', on ? 'true' : 'false'); b.style.background = on ? ACC_D : 'rgba(255,255,255,.18)'; k.style.transform = on ? 'translateX(14px)' : 'none'; };
    set(on);
    b.onclick = function () { set(!on); onChange(on); };
    b.set = set;
    return b;
  }

  var pos = LS.get('ho_wa_pos', null);
  var W0 = 368;
  var root = el('div', 'position:fixed;left:16px;bottom:16px;z-index:2147483646;width:' + W0 + 'px;max-width:calc(100vw - 32px);box-sizing:border-box;padding:1px;border-radius:20px;color:' + TXT + ';font:12.5px/1.4 ' + SANS + ';text-align:left;letter-spacing:0;' +
    'box-shadow:0 30px 80px -18px rgba(0,0,0,.75),0 0 0 1px rgba(0,0,0,.35),0 0 40px -12px rgba(' + ACC_RGB + ',.35);overflow:hidden;user-select:none;-webkit-user-select:none;contain:layout paint');
  root.id = 'hoWaWin'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'HotelOps WhatsApp reader (Alt+H to hide)');
  if (pos && pos.left >= 0 && pos.top >= 0) { root.style.left = Math.min(pos.left, innerWidth - 120) + 'px'; root.style.top = Math.min(pos.top, innerHeight - 60) + 'px'; root.style.bottom = 'auto'; }
  // the animated border glow
  var glow = el('div', 'position:absolute;inset:0;border-radius:20px;background:linear-gradient(115deg,rgba(' + ACC_RGB + ',.95),rgba(83,189,235,.45),rgba(0,168,132,.75),rgba(45,212,191,.4),rgba(' + ACC_RGB + ',.95));background-size:300% 300%;opacity:.55', null, root);
  var panel = el('div', 'position:relative;border-radius:19px;overflow:hidden;background:radial-gradient(120% 70% at 0% 0%,rgba(' + ACC_RGB + ',.12),transparent 55%),radial-gradient(90% 60% at 100% 100%,rgba(83,189,235,.07),transparent 60%),linear-gradient(180deg,rgba(17,27,33,.93),rgba(11,20,26,.97));-webkit-backdrop-filter:blur(20px) saturate(1.5);backdrop-filter:blur(20px) saturate(1.5)', null, root);
  // a faint top sheen: the "glass"
  el('div', 'position:absolute;left:0;right:0;top:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.28),transparent);pointer-events:none', null, panel);

  // header (drag handle)
  var head = el('div', 'display:flex;align-items:center;gap:10px;padding:12px 10px 9px 12px;cursor:grab', null, panel);
  head.title = 'Drag to move · double-click to put it back · Alt+H to hide';
  var logo = el('div', 'flex:none;position:relative;width:34px;height:34px;border-radius:11px;display:flex;align-items:center;justify-content:center;font:800 17px/1 Georgia,"Times New Roman",serif;color:' + INK + ';background:linear-gradient(135deg,#6af59b,' + ACC + ' 50%,' + ACC_D + ');box-shadow:0 6px 16px -4px rgba(' + ACC_RGB + ',.6),inset 0 1px 0 rgba(255,255,255,.5)', 'H', head);
  var titles = el('div', 'flex:1;min-width:0', null, head);
  var tRow = el('div', 'display:flex;align-items:center;gap:6px;min-width:0', null, titles);
  el('div', 'font:700 13.5px/1.2 ' + SANS + ';color:#f4f6fa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.01em;min-width:0', 'HotelOps · WhatsApp', tRow);
  var live = el('span', 'flex:none;display:none;font:800 8.5px/1 ' + SANS + ';letter-spacing:.12em;padding:3px 5px 3px 6px;border-radius:5px;color:' + INK + ';background:' + ACC, 'LIVE', tRow);
  var subRow = el('div', 'display:flex;align-items:center;gap:6px;margin-top:4px;min-width:0', null, titles);
  var dotWrap = el('span', 'position:relative;flex:none;width:7px;height:7px', null, subRow);
  var dot = el('span', 'position:absolute;inset:0;border-radius:50%', null, dotWrap);
  var ring = el('span', 'position:absolute;inset:0;border-radius:50%;opacity:0', null, dotWrap);
  var sub = el('span', 'font:500 11px/1.2 ' + MONO + ';color:' + TXT3 + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0', '', subRow);
  var minB = el('button', ICONB, '–', head); minB.type = 'button'; minB.title = 'Make it small (Alt+H)'; minB.setAttribute('aria-label', 'Minimize');
  var xB = el('button', ICONB, '✕', head); xB.type = 'button'; xB.title = 'Stop the reader'; xB.setAttribute('aria-label', 'Stop');
  [minB, xB].forEach(function (b) { ring2(b); hover(b, 'background:rgba(255,255,255,.1);color:#fff;', 'background:transparent;color:' + TXT2 + ';'); });
  hover(xB, 'background:rgba(239,68,68,.18);color:#fca5a5;', '');

  var body = el('div', 'padding:0 12px 12px', null, panel);
  // status line
  var stLine = el('div', 'display:flex;align-items:center;gap:8px;min-width:0', null, body);
  var pill = el('div', 'display:inline-flex;align-items:center;gap:6px;max-width:100%;min-width:0;box-sizing:border-box;padding:4px 10px;border-radius:99px;font:600 11.5px/1.3 ' + SANS + ';transition:background .3s,color .3s', null, stLine);
  var pillTxt = el('span', 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0', '', pill);
  var lastEl = el('span', 'margin-left:auto;flex:none;font:500 10px/1 ' + MONO + ';color:' + TXT3, '', stLine);

  // counters
  var stats = el('div', 'display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:10px', null, body);
  function stat(label, color, icon) {
    var b = el('div', 'position:relative;background:' + CARD + ';border:1px solid rgba(255,255,255,.075);border-radius:12px;padding:7px 8px 6px;min-width:0;overflow:hidden', null, stats);
    el('div', 'position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,' + color + ',transparent);opacity:.85', null, b);
    el('div', 'position:absolute;right:6px;top:6px;font:600 10px/1 ' + SANS + ';color:' + color + ';opacity:.7', icon, b);
    var n = el('div', 'font:700 18px/1.1 ' + MONO + ';color:#f4f6fa;font-variant-numeric:tabular-nums', '0', b);
    el('div', 'font-size:10px;line-height:1.2;color:' + TXT3 + ';margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', label, b);
    n.v = 0; return n;
  }
  var nRead = stat('Read today', '#53bdeb', '◉'), nActs = stat('Acted', ACC, '⚡'), nSent = stat('Sent in', '#2dd4bf', '↗'), nWait = stat('Waiting', '#f59e0b', '⏳');
  nRead.parentNode.title = 'Messages read today'; nSent.parentNode.title = 'Messages HotelOps has received'; nActs.parentNode.title = 'Check-outs, late check-outs and extensions passed on'; nWait.parentNode.title = 'Waiting for HotelOps to say "got it" (and answers to send)';

  // the signal: messages per 10 minutes (last 2 h) or per hour (last 12 h) + a sweeping heartbeat; click to switch
  var sigV = LS.get('ho_wa_sigv', '2h') === '12h' ? '12h' : '2h';
  var sig = el('div', 'position:relative;height:42px;margin:8px 0 0;border-radius:11px;background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.012));border:1px solid rgba(255,255,255,.07);overflow:hidden;cursor:pointer', null, body);
  var cv = el('canvas', 'position:absolute;inset:0;width:100%;height:100%', null, sig);
  var sweep = el('div', 'position:absolute;top:0;bottom:0;left:0;width:60px;background:linear-gradient(90deg,transparent,rgba(' + ACC_RGB + ',.18),transparent);opacity:0;pointer-events:none', null, sig);
  var sigLbl = el('div', 'position:absolute;right:8px;top:5px;z-index:1;font:600 9.5px/1 ' + MONO + ';letter-spacing:.06em;color:' + TXT3 + ';text-transform:uppercase;pointer-events:none', '', sig);
  sig.setAttribute('role', 'button'); sig.tabIndex = 0; ring2(sig);
  function sigTitle() { sig.title = (sigV === '2h' ? 'Messages per 10 minutes, last 2 hours' : 'Messages per hour, last 12 hours') + ' · click to switch'; }
  sigTitle();
  var flipSig = function () { sigV = sigV === '2h' ? '12h' : '2h'; LS.set('ho_wa_sigv', sigV); sigTitle(); sigKey = ''; drawSignal(); anim(cv, [{ opacity: 0.2 }, { opacity: 1 }], { duration: 220 }); };
  sig.addEventListener('click', flipSig);
  sig.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); flipSig(); } });

  // tabs
  var tabsBar = el('div', 'position:relative;display:grid;grid-template-columns:repeat(4,1fr);margin:10px 0 8px;padding:3px;border-radius:12px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.06)', null, body);
  tabsBar.setAttribute('role', 'tablist');
  var tabInd = el('div', 'position:absolute;top:3px;bottom:3px;left:3px;width:calc((100% - 6px) / 4);border-radius:9px;background:linear-gradient(180deg,rgba(' + ACC_RGB + ',.22),rgba(' + ACC_RGB + ',.10));box-shadow:0 0 0 1px rgba(' + ACC_RGB + ',.28) inset,0 4px 12px -4px rgba(0,0,0,.5);transition:transform .28s cubic-bezier(.2,.8,.2,1)', null, tabsBar);
  if (RM) tabInd.style.transition = 'none';
  var TABS = [['feed', 'Feed'], ['send', 'Send'], ['groups', 'Groups'], ['settings', 'Settings']], tabBtn = {}, tabBadge = {}, panes = {};
  var curTab = 'feed', sendBadge = 0;
  TABS.forEach(function (t, i) {
    var b = el('button', 'all:unset;box-sizing:border-box;position:relative;z-index:1;cursor:pointer;text-align:center;padding:6px 2px;border-radius:9px;font:600 11.5px/1.2 ' + SANS + ';color:' + TXT3 + ';display:flex;align-items:center;justify-content:center;gap:5px;transition:color .2s', null, tabsBar);
    b.type = 'button'; b.setAttribute('role', 'tab'); el('span', '', t[1], b); ring2(b);
    tabBadge[t[0]] = el('span', 'display:none;min-width:15px;height:15px;padding:0 4px;box-sizing:border-box;border-radius:99px;background:' + ACC + ';color:' + INK + ';font:700 9.5px/15px ' + SANS + ';text-align:center', '', b);
    b.onclick = function () { setTab(t[0]); };
    tabBtn[t[0]] = b; b.idx = i;
  });
  var paneWrap = el('div', 'position:relative;max-height:300px;min-height:120px;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.18) transparent;margin-right:-4px;padding-right:4px;overscroll-behavior:contain', null, body);
  TABS.forEach(function (t) { panes[t[0]] = el('div', 'display:none;flex-direction:column;gap:6px', null, paneWrap); });
  function setTab(k) {
    var from = tabBtn[curTab] ? tabBtn[curTab].idx : 0;
    curTab = k;
    TABS.forEach(function (t) { var on = t[0] === k; panes[t[0]].style.display = on ? 'flex' : 'none'; tabBtn[t[0]].style.color = on ? '#f4f6fa' : TXT3; tabBtn[t[0]].setAttribute('aria-selected', on ? 'true' : 'false'); });
    tabInd.style.transform = 'translateX(' + (tabBtn[k].idx * 100) + '%)';
    if (k === 'send') sendBadge = 0;
    var dx = tabBtn[k].idx === from ? 0 : tabBtn[k].idx > from ? 14 : -14;
    anim(panes[k], [{ opacity: 0, transform: 'translate(' + dx + 'px,4px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
    LS.set('ho_wa_tab', k); render();
  }

  // Feed pane: search + filter chips, then the questions and the messages
  var FILTERS = [['all', 'All'], ['rooms', 'Rooms'], ['notes', 'Notes'], ['asks', 'Asks'], ['other', 'Other']];
  var fKind = LS.get('ho_wa_filter', 'all'); if (!FILTERS.some(function (f) { return f[0] === fKind; })) fKind = 'all';
  var fQuery = '';
  var tools = el('div', 'position:sticky;top:0;z-index:2;display:flex;flex-direction:column;gap:6px;padding:0 0 6px;background:linear-gradient(180deg,rgba(13,22,28,.98) 80%,rgba(13,22,28,0))', null, panes.feed);
  var sWrap = el('div', 'position:relative;display:flex;align-items:center', null, tools);
  el('span', 'position:absolute;left:9px;top:50%;transform:translateY(-50%);font:600 12px/1 ' + SANS + ';color:' + TXT3 + ';pointer-events:none', '⌕', sWrap);
  var sIn = el('input', 'all:unset;box-sizing:border-box;width:100%;padding:7px 28px 7px 26px;border-radius:10px;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.1);color:' + TXT + ';font:12px/1.2 ' + SANS + ';user-select:text;-webkit-user-select:text;transition:border-color .15s,background .15s', null, sWrap);
  sIn.type = 'search'; sIn.placeholder = 'Search room, name or word…'; sIn.setAttribute('aria-label', 'Search the feed'); sIn.maxLength = 60; sIn.spellcheck = false; sIn.autocomplete = 'off';
  keepKeys(sIn);
  sIn.addEventListener('focus', function () { sIn.style.borderColor = 'rgba(' + ACC_RGB + ',.55)'; sIn.style.background = 'rgba(0,0,0,.4)'; });
  sIn.addEventListener('blur', function () { sIn.style.borderColor = 'rgba(255,255,255,.1)'; sIn.style.background = 'rgba(0,0,0,.28)'; });
  var sClr = el('button', ICONB + 'position:absolute;right:3px;top:50%;transform:translateY(-50%);width:22px;height:22px;font-size:10px;display:none', '✕', sWrap);
  sClr.type = 'button'; sClr.setAttribute('aria-label', 'Clear the search'); ring2(sClr);
  sIn.addEventListener('input', function () { fQuery = sIn.value; sClr.style.display = fQuery ? 'inline-flex' : 'none'; applyFilter(); });
  sIn.addEventListener('keydown', function (e) { if (e.key === 'Escape') { sIn.value = ''; fQuery = ''; sClr.style.display = 'none'; applyFilter(); sIn.blur(); } });
  sClr.onclick = function () { sIn.value = ''; fQuery = ''; sClr.style.display = 'none'; applyFilter(); sIn.focus(); };
  var fRow = el('div', 'display:flex;gap:4px;flex-wrap:wrap', null, tools);
  fRow.setAttribute('role', 'radiogroup'); fRow.setAttribute('aria-label', 'Show');
  var fBtn = {};
  FILTERS.forEach(function (f) {
    var b = el('button', 'all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:4px 9px;border-radius:99px;font:600 10.5px/1.2 ' + SANS + ';border:1px solid rgba(255,255,255,.1);transition:background .15s,color .15s,border-color .15s', null, fRow);
    b.type = 'button'; b.setAttribute('role', 'radio'); ring2(b);
    el('span', '', f[1], b); b.n = el('span', 'font:600 9.5px/1 ' + MONO + ';opacity:.75', '', b);
    b.onclick = function () { fKind = f[0]; LS.set('ho_wa_filter', fKind); applyFilter(); };
    fBtn[f[0]] = b;
  });
  var asksBox = el('div', 'display:flex;flex-direction:column;gap:6px', null, panes.feed);
  var list = el('div', 'display:flex;flex-direction:column;gap:6px', null, panes.feed);
  list.setAttribute('aria-live', 'polite');
  var empty = el('div', 'padding:16px 10px;text-align:center;color:' + TXT3 + ';font-size:12px;border:1px dashed rgba(255,255,255,.1);border-radius:12px', '', list);
  var noMatch = el('div', 'display:none;padding:14px 10px;text-align:center;color:' + TXT3 + ';font-size:12px;border:1px dashed rgba(255,255,255,.1);border-radius:12px', 'Nothing matches · try another word or "All"', panes.feed);

  // Send pane
  var sendHint = el('div', 'padding:8px 10px;border-radius:10px;background:' + CARD + ';border:1px solid rgba(255,255,255,.07);color:' + TXT2 + ';font-size:11.5px;line-height:1.45', '', panes.send);
  var outList = el('div', 'display:flex;flex-direction:column;gap:6px', null, panes.send);

  // Groups pane
  el('div', 'padding:8px 10px;border-radius:10px;background:rgba(83,189,235,.08);border:1px solid rgba(83,189,235,.2);color:#b6e3f7;font-size:11.5px;line-height:1.45',
    'Open groups are read fully. Closed groups: only the latest message is seen; open the group now and then to catch up. To read a second group fully all day, link WhatsApp Web in a second browser (for example Edge) as another device and run this reader there too.', panes.groups);
  var gList = el('div', 'display:flex;flex-direction:column;gap:6px', null, panes.groups);
  var gBtns = el('div', 'display:flex;gap:6px', null, panes.groups);
  var addOpenB = btn2('＋ Add the open chat', gBtns, 'flex:1');
  var addNameB = btn2('＋ By name', gBtns);

  // Settings pane
  function setRow(parent) { return el('div', 'display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;background:' + CARD + ';border:1px solid rgba(255,255,255,.07)', null, parent); }
  var sr1 = setRow(panes.settings);
  var sr1t = el('div', 'flex:1;min-width:0', null, sr1);
  el('div', 'font-weight:600;font-size:12px;color:' + TXT, 'Send automatically (no Enter needed)', sr1t);
  el('div', 'font-size:11px;color:#fcd34d;margin-top:2px;line-height:1.35', '⚠ WhatsApp may flag automated sending; use at your own risk. Off: HotelOps types the message and you press Enter.', sr1t);
  var autoT = toggle(auto, sr1, function (v) { auto = v; LS.set('ho_wa_auto', v); toast(v ? 'Automatic sending is on' : 'Automatic sending is off · you press Enter', v ? 'warn' : 'ok'); render(); });
  autoT.setAttribute('aria-label', 'Send automatically');
  var sr2 = el('div', 'display:flex;gap:6px', null, panes.settings);
  var cpB = btn2('📋 Copy today\'s chat', sr2, 'flex:1');
  cpB.title = 'Copies all of today\'s messages in the open group, for HotelOps → WhatsApp → Paste or upload.';
  var posB = btn2('⤢ Reset place', sr2);
  var keysRow = el('div', 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:2px 2px 0;font-size:11px;color:' + TXT3, null, panes.settings);
  var kbd = function (t) { return el('span', 'font:600 10px/1 ' + MONO + ';padding:3px 6px;border-radius:5px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-bottom-width:2px;color:' + TXT, t, keysRow); };
  kbd('Alt'); el('span', '', '+', keysRow); kbd('H'); el('span', 'flex:1 1 180px;min-width:0', 'show / hide · double-click the top bar to put it back · Esc clears the search', keysRow);
  el('div', 'font-size:11px;color:' + TXT3 + ';line-height:1.45;padding:2px 2px 0', 'This reader reads your groups and only sends what you send from HotelOps. It never opens other chats. Stop it with ✕ or by reloading WhatsApp.', panes.settings);

  // the main button
  var connB = el('button', BTN + 'position:relative;overflow:hidden;width:100%;margin-top:10px;padding:10px;font-size:12.5px;color:' + INK + ';background:linear-gradient(135deg,#5ef08f,' + ACC + ' 45%,' + ACC_D + ');border:1px solid rgba(255,255,255,.18);box-shadow:0 10px 22px -10px rgba(' + ACC_RGB + ',.8),inset 0 1px 0 rgba(255,255,255,.35)', 'Connect HotelOps', body);
  connB.type = 'button'; ring2(connB); hover(connB, 'filter:brightness(1.08);', 'filter:none;');
  connB.addEventListener('pointerdown', function () { connB.style.transform = 'scale(.985)'; });
  ['pointerup', 'pointerleave'].forEach(function (t) { connB.addEventListener(t, function () { connB.style.transform = 'none'; }); });

  // toasts: a small stack beside whichever is showing (the window or the pill)
  var toastHost = el('div', 'position:fixed;z-index:2147483647;display:flex;flex-direction:column;gap:6px;width:300px;max-width:calc(100vw - 24px);pointer-events:none;font:600 12px/1.35 ' + SANS);
  toastHost.id = 'hoWaToasts'; toastHost.setAttribute('role', 'status'); toastHost.setAttribute('aria-live', 'polite');

  // the small pill when minimized
  var mini = el('button', BTN + 'position:fixed;left:16px;bottom:16px;z-index:2147483646;display:none;max-width:calc(100vw - 32px);padding:6px 12px 6px 6px;border-radius:99px;color:' + TXT + ';background:rgba(17,27,33,.92);-webkit-backdrop-filter:blur(14px) saturate(1.4);backdrop-filter:blur(14px) saturate(1.4);border:1px solid rgba(' + ACC_RGB + ',.4);box-shadow:0 12px 34px -10px rgba(0,0,0,.7),0 0 0 4px rgba(' + ACC_RGB + ',.07);touch-action:none;cursor:grab');
  mini.type = 'button'; mini.id = 'hoWaMini'; mini.title = 'Open the HotelOps window (Alt+H) · drag to move'; ring2(mini);
  var mLogo = el('span', 'flex:none;width:22px;height:22px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;font:800 12px/1 Georgia,serif;color:' + INK + ';background:linear-gradient(135deg,#6af59b,' + ACC + ')', 'H', mini);
  var mDotWrap = el('span', 'position:relative;flex:none;width:8px;height:8px', null, mini);
  var mDot = el('span', 'position:absolute;inset:0;border-radius:50%', null, mDotWrap);
  var mRing = el('span', 'position:absolute;inset:0;border-radius:50%;opacity:0', null, mDotWrap);
  var mTxt = el('span', 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0', '', mini);
  var mStats = el('span', 'flex:none;font:600 10.5px/1 ' + MONO + ';color:' + TXT3, '', mini);
  var mBadge = el('span', 'display:none;min-width:18px;height:18px;padding:0 5px;box-sizing:border-box;border-radius:99px;background:' + ACC + ';color:' + INK + ';font:800 10.5px/18px ' + SANS + ';text-align:center', '', mini);

  // ── feed rows ─────────────────────────────────────────────
  var FEED_MAX = 40;
  function shortTime(t) { var m = String(t || '').match(/(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\s*([ap])?/i); return m ? m[1] + ':' + m[2] + (m[3] ? ' ' + m[3].toUpperCase() + 'M' : '') : ''; }
  /** which filter chips a row belongs to */
  function kindsOf(ch) {
    var k = { all: true };
    ch.forEach(function (c) { if (ROOM_TONES.test(c.tone)) k.rooms = true; else if (c.tone === 'note' || c.tone === 'req' || c.tone === 'ho') k.notes = true; else if (c.tone === 'ask') k.asks = true; });
    if (!k.rooms && !k.notes && !k.asks) k.other = true;
    return k;
  }
  function qWords(q) { return norm(q).split(' ').filter(Boolean); }
  /** a room "324" also finds "0324" */
  function hayHas(hay, w) { return /^\d{3,4}$/.test(w) ? new RegExp('(?:^|\\D)0*' + w.replace(/^0+/, '') + '(?:\\D|$)').test(hay) : hay.indexOf(w) >= 0; }
  /** the text with the searched words marked (DOM nodes, never HTML strings) */
  function hiText(e, text, ws) {
    while (e.firstChild) e.removeChild(e.firstChild);
    if (!ws.length) { e.textContent = text; return; }
    var rx = new RegExp('(' + ws.map(function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')', 'gi'), last = 0, m;
    while ((m = rx.exec(text))) {
      if (!m[0]) { rx.lastIndex++; continue; }
      if (m.index > last) e.appendChild(document.createTextNode(text.slice(last, m.index)));
      el('mark', 'background:rgba(' + ACC_RGB + ',.3);color:#fff;border-radius:3px;padding:0 1px', m[0], e);
      last = m.index + m[0].length;
    }
    if (last < text.length) e.appendChild(document.createTextNode(text.slice(last)));
  }
  function applyFilter() {
    var ws = qWords(fQuery), shown = 0, cnt = { all: 0, rooms: 0, notes: 0, asks: 0, other: 0 }, hk = ws.join(' ');
    feed.forEach(function (f) {
      Object.keys(f.kinds).forEach(function (k) { if (cnt[k] != null) cnt[k]++; });
      var ok = !!f.kinds[fKind] && ws.every(function (w) { return hayHas(f.hay, w); });
      if (f.node) f.node.style.display = ok ? 'flex' : 'none';
      if (ok) shown++;
      if (f.txEl && f.hk !== hk) { f.hk = hk; hiText(f.txEl, f.disp, ws); }
    });
    FILTERS.forEach(function (x) {
      var b = fBtn[x[0]], on = x[0] === fKind;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.style.background = on ? 'rgba(' + ACC_RGB + ',.18)' : 'rgba(255,255,255,.035)';
      b.style.borderColor = on ? 'rgba(' + ACC_RGB + ',.5)' : 'rgba(255,255,255,.1)';
      b.style.color = on ? ACC_L : TXT2;
      setT(b.n, cnt[x[0]] ? cnt[x[0]] : '');
    });
    noMatch.style.display = feed.length && !shown ? 'block' : 'none';
  }
  function addFeed(m, opt) {
    opt = opt || {};
    var old = feed.filter(function (f) { return f.id === m.id || (!m.preview && f.preview && f.group === m.group && sameText(f.text, m.text) && Math.abs(msgTs(f.rawTime) - msgTs(m.time)) < 60000); });
    old.forEach(function (o) { feed = feed.filter(function (f) { return f !== o; }); if (o.node) o.node.remove(); });
    var ch = isHoGroup(m.group) || hoMarked(m.text) ? hoChips(m.text) : chips(m.text, words, m.quote);
    var f = { id: m.id, rawTime: m.time, at: msgTs(m.time), time: shortTime(m.time), sender: m.sender || (m.mine ? 'Me' : ''), text: m.text, edited: m.edited, chips: ch, state: 'wait', group: m.group || '', preview: !!m.preview, truncated: !!m.truncated, missed: opt.missed || 0,
      acts: ch.filter(function (c) { return /^(?:co|lco|ext|extending)$/.test(c.tone); }).length };
    f.kinds = kindsOf(ch);
    f.disp = f.text.replace(/\s*\n\s*/g, ' · ');
    f.hay = norm([f.sender, f.text, f.group].concat(ch.map(function (c) { return c.label; })).join(' '));
    ch.forEach(function (c) { if (c.ask && !words(c.ask.word)) { asks[c.ask.word] = { word: c.ask.word, text: m.text, sender: f.sender, room: c.ask.room, guess: c.ask.guess || '' }; } });
    feed.unshift(f);
    if (empty.parentNode) empty.remove();
    var tone = ch[0] ? ch[0].tone : 'off'; var A = ACT[tone] || ACT.off;
    if (f.preview && f.truncated) A = ACT.off;
    var r = el('div', 'flex:none;position:relative;display:flex;gap:9px;background:linear-gradient(90deg,' + A[2] + ',rgba(255,255,255,.028) 45%);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:8px 9px 8px 12px;overflow:hidden;transition:border-color .15s,background-color .15s');
    hover(r, 'border-color:rgba(255,255,255,.16);background-color:rgba(255,255,255,.03);', 'border-color:rgba(255,255,255,.07);background-color:transparent;');
    el('div', 'position:absolute;left:0;top:0;bottom:0;width:3px;background:' + A[0] + ';box-shadow:0 0 12px ' + A[0], null, r);
    el('div', 'flex:none;width:24px;height:24px;border-radius:8px;display:flex;align-items:center;justify-content:center;font:700 12px/1 ' + SANS + ';color:' + A[0] + ';background:' + A[2] + ';border:1px solid ' + A[0] + '44', A[3], r);
    var bd = el('div', 'flex:1;min-width:0', null, r);
    var top = el('div', 'display:flex;align-items:baseline;gap:6px;min-width:0', null, bd);
    el('span', 'flex:0 1 auto;min-width:0;font-weight:700;font-size:12px;color:' + TXT + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis', f.sender + (f.edited ? ' ✎' : ''), top);
    if (isHoGroup(f.group)) el('span', 'flex:none;font:600 9.5px/1.4 ' + SANS + ';padding:0 6px;border-radius:99px;color:#c7d2fe;background:rgba(129,140,248,.16)', '📋 Handover', top);
    if (f.group && groups.length > 1) el('span', 'flex:0 1 auto;min-width:0;max-width:96px;font:600 9.5px/1.4 ' + SANS + ';padding:0 6px;border-radius:99px;color:#b6e3f7;background:rgba(83,189,235,.14);white-space:nowrap;overflow:hidden;text-overflow:ellipsis', f.group, top);
    if (f.preview) el('span', 'flex:none;font:600 9.5px/1.4 ' + SANS + ';padding:0 6px;border-radius:99px;color:#fcd34d;background:rgba(245,158,11,.14)', 'preview', top);
    f.relEl = el('span', 'margin-left:auto;flex:none;font:500 10px/1 ' + MONO + ';color:' + TXT3, relTime(f.at), top);
    f.relEl.title = f.time;
    var tx = el('div', 'margin-top:2px;font-size:12px;color:#d1d7db;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', f.disp, bd); tx.title = f.text; tx.setAttribute('data-t', '');
    f.txEl = tx; f.hk = '';
    var cw = el('div', 'display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:5px', null, bd);
    ch.forEach(function (c) { var k = ACT[c.tone] || ACT.off; el('span', 'font:600 10.5px/1.3 ' + SANS + ';padding:2px 7px;border-radius:99px;color:' + k[1] + ';background:' + k[2] + ';border:1px ' + (c.tone === 'ask' ? 'dashed ' + k[0] + '88' : 'solid ' + k[0] + '2e'), c.label, cw); });
    if (f.preview && (f.truncated || f.missed)) el('span', 'font-size:10.5px;color:#9aa3b2', f.truncated ? 'open the group to read in full' : '+' + f.missed + ' more · open the group to read all', cw);
    f.cwEl = cw;
    f.stEl = el('span', 'margin-left:auto;font:600 10px/1 ' + SANS + ';color:' + TXT3, '', cw);
    f.node = r;
    list.insertBefore(r, list.firstChild);
    while (feed.length > FEED_MAX) { var x = feed.pop(); if (x.node) x.node.remove(); }
    stateText(f);
    if (minimized) { unread++; anim(mini, [{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 360, easing: 'ease-out' }); }
    applyFilter();
    if (r.style.display !== 'none') anim(r, [{ opacity: 0, transform: 'translateY(-8px) scale(.98)', filter: 'brightness(1.6)' }, { opacity: 1, transform: 'none', filter: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
    renderAsks();
  }
  function stateText(f) { if (f.stEl && !f.deleted) { setT(f.stEl, f.state === 'sent' ? '✓ in HotelOps' : f.state === 'copied' ? '✓ copied' : 'waiting…'); f.stEl.style.color = f.state === 'wait' ? TXT3 : ACC_L; } }
  // what HotelOps did with a message: a request for an in-house room, a room that is not there…
  function chipEl(c, f) { var k = ACT[c.tone] || ACT.off; var e = el('span', 'font:600 10.5px/1.3 ' + SANS + ';padding:2px 7px;border-radius:99px;color:' + k[1] + ';background:' + k[2] + ';border:1px ' + (c.tone === 'ask' ? 'dashed ' + k[0] + '88' : 'solid ' + k[0] + '2e'), c.label); if (f.stEl) f.cwEl.insertBefore(e, f.stEl); else f.cwEl.appendChild(e); return e; }
  function gotRes(id, res) {
    var f = feed.filter(function (x) { return x.id === id; })[0];
    if (!f || f.gotRes || !f.cwEl) return; f.gotRes = true;
    var add = [], bad = [];
    res.slice(0, 12).forEach(function (r) {
      if (!r || typeof r !== 'object') return;
      var room = String(r.room || '').slice(0, 8), t = String(r.text || '');
      if (r.st === 'req') add.push({ tone: 'req', label: '📝 Request · ' + room });
      else if (r.st === 'ho') add.push({ tone: 'ho', label: /team chat/i.test(t) ? '💬 team chat · not added' : /also in/i.test(t) ? '📋 also in the handover' : '📋 saved to handover' });
      else if (r.st === 'wait') add.push({ tone: 'req', label: '⏳ ' + room + ' waits for today\'s list' });
      else if (r.st === 'notlist') { bad.push(room); add.push({ tone: 'bad', label: '⚠ ' + room + (/not found/.test(t) ? ' not found' : ' not on list') }); }
      else if (/ · added from /.test(t)) add.push({ tone: 'req', label: '＋ ' + room + ' added from ' + t.split(' · added from ')[1] });
    });
    if (!add.length) return;
    add.forEach(function (c) { f.chips.push(c); var e = chipEl(c, f); anim(e, [{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'ease-out' }); });
    f.hay = norm([f.hay].concat(add.map(function (c) { return c.label; })).join(' '));
    f.kinds = kindsOf(f.chips);
    if (bad.length) {
      day.acts = Math.max(0, (day.acts || 0) - Math.min(bad.length, f.acts || 0));
      if (f.node) { f.node.firstChild.style.background = ACT.bad[0]; f.node.firstChild.style.boxShadow = '0 0 12px ' + ACT.bad[0]; }
      toast('⚠ Room ' + bad.join(', ') + ' is not there', 'warn');
    }
    save(); applyFilter(); render();
  }
  function markFeed(id, st) { feed.forEach(function (f) { if (f.id === id) { f.state = st; stateText(f); } }); }
  // question cards: "what does 'ckd' mean?" (answered here or in HotelOps)
  var MEAN = [['co', '✓ Checked out'], ['ext', '↪ Extension'], ['lco', '⏰ Late CO'], ['note', '📝 Note / request'], ['hk', '🧹 HK status (note)'], ['ignore', 'Ignore this word']];
  var askSig = '';
  function renderAsks() {
    var ws = Object.keys(asks).filter(function (w) { return !words(w); }).slice(0, 3), sig2 = ws.join('|');
    if (sig2 === askSig) return; askSig = sig2;
    while (asksBox.firstChild) asksBox.removeChild(asksBox.firstChild);
    ws.forEach(function (w) {
      var q = asks[w];
      var c = el('div', 'padding:9px 10px;border-radius:12px;background:rgba(251,191,36,.08);border:1px dashed rgba(251,191,36,.45);display:flex;flex-direction:column;gap:7px', null, asksBox);
      var p = el('div', 'font-size:12px;line-height:1.4;color:#fde68a', null, c);
      el('b', '', q.sender || 'Someone', p); p.appendChild(document.createTextNode(' wrote "' + String(q.text).slice(0, 60) + '". What does "' + w + '" mean?'));
      var gm = q.guess && MEAN.filter(function (mn) { return mn[0] === q.guess; })[0];
      if (gm) el('div', 'font-size:11.5px;color:#fde68a', '🤔 My guess: ' + gm[1].replace(/^\S+\s/, '') + '. Did I get it?', c);
      var bs = el('div', 'display:flex;flex-wrap:wrap;gap:4px', null, c);
      var noteIn = el('input', 'all:unset;box-sizing:border-box;width:100%;padding:6px 9px;border-radius:8px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.12);color:' + TXT + ';font:12px ' + SANS + ';user-select:text;-webkit-user-select:text');
      noteIn.placeholder = 'What it stands for (optional), e.g. Vacant Dirty'; noteIn.maxLength = 60; keepKeys(noteIn);
      (gm ? [gm].concat(MEAN.filter(function (mn) { return mn !== gm; })) : MEAN).forEach(function (mn) {
        var b = btn2(mn === gm ? '✓ Yes, ' + mn[1].replace(/^\S+\s/, '') : mn[1], bs, 'padding:5px 8px;font-size:11px;border-radius:99px' + (mn === gm ? ';font-weight:800;border-color:' + ACC + ';color:' + ACC_L : ''));
        b.onclick = function () {
          var a = { word: w, meaning: mn[0], note: noteIn.value.trim() };
          if (!post({ source: 'ho-wa', answer: a })) { answers.push(a); save(); toast('Saved · sent to HotelOps when linked', 'info'); } else toast('✓ "' + w + '" = ' + mn[1].replace(/^\S+\s/, ''), 'ok');
          wordList.push({ w: w, m: mn[0], label: a.note }); words = wordsLookup(wordList); LS.set('ho_wa_words', wordList);
          delete asks[w]; renderAsks(); render();
        };
      });
      c.appendChild(noteIn);
      anim(c, [{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'ease-out' });
    });
  }

  // ── Send pane rows ────────────────────────────────────────
  var OUT_ST = { new: ['…', '#9aa3b2', 'Waiting…'], queued: ['⏳', '#fcd34d', 'Waiting'], typed: ['⌨', '#fcd34d', 'Typed — press Enter in WhatsApp'], sent: ['✓', ACC_L, 'Sent'], failed: ['✗', '#fca5a5', 'Not sent'], cancelled: ['—', TXT3, 'Cancelled'] };
  var outSig = '';
  function renderOut() {
    var sig2 = out.map(function (o) { return o.id + o.st + o.why; }).join('|') + curKey + auto;
    if (sig2 === outSig) return; outSig = sig2;
    while (outList.firstChild) outList.removeChild(outList.firstChild);
    var ls = out.slice().reverse().slice(0, 8);
    if (!ls.length) el('div', 'padding:14px 10px;text-align:center;color:' + TXT3 + ';font-size:12px;border:1px dashed rgba(255,255,255,.1);border-radius:12px', 'Nothing to send. Type a message in HotelOps → WhatsApp → Send to WhatsApp.', outList);
    ls.forEach(function (o) {
      var s = OUT_ST[o.st] || OUT_ST.new;
      var r = el('div', 'position:relative;display:flex;gap:9px;align-items:flex-start;padding:8px 10px 8px 12px;border-radius:12px;background:' + CARD + ';border:1px solid rgba(255,255,255,.07);overflow:hidden', null, outList);
      el('div', 'position:absolute;left:0;top:0;bottom:0;width:3px;background:' + s[1] + ';opacity:.8', null, r);
      el('div', 'flex:none;width:22px;height:22px;border-radius:7px;display:flex;align-items:center;justify-content:center;font:700 11px/1 ' + SANS + ';color:' + s[1] + ';background:rgba(255,255,255,.06)', s[0], r);
      var bd = el('div', 'flex:1;min-width:0', null, r);
      el('div', 'font-size:12px;color:' + TXT + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis', o.text.replace(/[⁣]/g, '').replace(/\s*\n\s*/g, ' · '), bd).title = o.text.replace(/[⁣]/g, '');
      var lbl = o.st === 'queued' ? (o.why && !/^Open /.test(o.why) ? o.why : 'Open ' + (o.group || 'the group') + ' to send') : o.st === 'failed' && o.why ? 'Not sent · ' + o.why : s[2];
      el('div', 'font-size:10.5px;color:' + s[1] + ';margin-top:2px', lbl + (o.group && groups.length > 1 ? ' · ' + o.group : ''), bd);
    });
    sendHint.textContent = auto ? '⚡ Automatic sending is ON: messages from HotelOps are sent in the open group straight away.' : 'Messages you send from HotelOps are typed in the open group\'s message box. Press Enter in WhatsApp to send them. Nothing is sent on its own.';
    sendHint.style.color = auto ? '#fcd34d' : TXT2;
  }

  // ── Groups pane rows ──────────────────────────────────────
  var gSig = '';
  function renderGroups() {
    var sig2 = JSON.stringify(groups) + curKey;
    if (sig2 === gSig) return; gSig = sig2;
    while (gList.firstChild) gList.removeChild(gList.firstChild);
    if (!groups.length) el('div', 'padding:12px;text-align:center;color:' + TXT3 + ';font-size:12px;border:1px dashed rgba(255,255,255,.1);border-radius:12px', 'No groups yet. Open your group in WhatsApp, then click "Add the open chat".', gList);
    groups.forEach(function (g, i) {
      var isOpen = curKey && groupMatch(g.name, curKey);
      var r = el('div', 'display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:12px;background:' + (isOpen ? 'rgba(' + ACC_RGB + ',.06)' : CARD) + ';border:1px solid ' + (isOpen ? 'rgba(' + ACC_RGB + ',.38)' : 'rgba(255,255,255,.07)'), null, gList);
      var t1 = el('div', 'display:flex;align-items:center;gap:7px;min-width:0', null, r);
      el('span', 'flex:none;width:7px;height:7px;border-radius:50%;background:' + (isOpen ? ACC : '#6b7280') + (isOpen ? ';box-shadow:0 0 8px ' + ACC : ''), null, t1);
      el('span', 'flex:1;min-width:0;font-weight:700;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', g.name, t1).title = g.name;
      if (isHoGroup(g.name)) el('span', 'flex:none;font:600 9.5px/1.4 ' + SANS + ';padding:1px 7px;border-radius:99px;color:#c7d2fe;background:rgba(129,140,248,.16)', '📋 Handover', t1).title = 'Saved to the Handover Book in HotelOps · rooms are not changed';
      el('span', 'flex:none;font-size:10px;color:' + (isOpen ? ACC_L : '#9aa3b2'), isOpen ? 'open · read fully' : 'closed · latest message', t1);
      var rm = el('button', ICONB + 'width:22px;height:22px;font-size:11px', '✕', t1); rm.type = 'button'; rm.title = 'Remove this group'; rm.setAttribute('aria-label', 'Remove ' + g.name); ring2(rm);
      hover(rm, 'background:rgba(239,68,68,.18);color:#fca5a5;', 'background:transparent;color:' + TXT2 + ';');
      rm.onclick = function () { if (confirm('Stop reading "' + g.name + '"?')) { groups.splice(i, 1); saveGroups(); render(); } };
      var t2 = el('div', 'display:flex;align-items:center;gap:8px;font-size:11.5px;color:' + TXT2, null, r);
      var tg = toggle(g.act !== false, t2, function (v) { g.act = v; saveGroups(); toast(g.name + ': ' + (v ? 'can change rooms' : 'log only'), 'info'); gSig = ''; render(); });
      tg.setAttribute('aria-label', 'Can change rooms in ' + g.name);
      el('span', '', g.act !== false ? 'Can change rooms (CO / LCO / EXT)' : 'Log only · rooms are not changed', t2);
    });
  }
  function addGroup(name) {
    name = String(name || '').trim(); if (!name) return;
    if (groups.some(function (g) { return groupMatch(g.name, name) && groupMatch(name, g.name); })) { toast('Already in the list', 'warn'); return; }
    groups.push({ name: name, act: true }); saveGroups(); toast('✓ Reading ' + name, 'ok'); firstScan = true; scan();
  }
  addOpenB.onclick = function () { var t = chatTitle(); if (!t) { toast('Open the group in WhatsApp first', 'warn'); return; } addGroup(t); };
  addNameB.onclick = function () { addGroup(prompt('HotelOps: the name of the WhatsApp group', '') || ''); };

  // ── toasts ────────────────────────────────────────────────
  function placeToasts() {
    var t = minimized ? mini : root; if (!t.isConnected || t.style.display === 'none') return;
    var r = { left: t.offsetLeft, top: t.offsetTop, bottom: t.offsetTop + t.offsetHeight }, w = Math.min(300, innerWidth - 24);   // offsets: not thrown off by a running animation
    toastHost.style.left = Math.max(12, Math.min(r.left, innerWidth - w - 12)) + 'px';
    if (r.top > 150) { toastHost.style.top = 'auto'; toastHost.style.bottom = (innerHeight - r.top + 8) + 'px'; toastHost.style.flexDirection = 'column-reverse'; }
    else { toastHost.style.bottom = 'auto'; toastHost.style.top = (r.bottom + 8) + 'px'; toastHost.style.flexDirection = 'column'; }
  }
  function toast(t, tone) {
    var c = tone === 'ok' ? TONE.green : tone === 'warn' ? TONE.amber : TONE.blue;
    if (!toastHost.isConnected) return;
    placeToasts();
    while (toastHost.children.length >= 3) toastHost.removeChild(toastHost.firstChild);
    var e = el('div', 'pointer-events:auto;cursor:pointer;display:flex;align-items:flex-start;gap:8px;padding:9px 12px;border-radius:12px;color:' + c[1] + ';background:rgba(17,27,33,.95);border:1px solid ' + c[0] + '66;box-shadow:0 12px 30px -8px rgba(0,0,0,.75),0 0 18px -8px ' + c[0] + ';-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)', null, toastHost);
    el('span', 'flex:none;width:7px;height:7px;margin-top:5px;border-radius:50%;background:' + c[0] + ';box-shadow:0 0 8px ' + c[0], null, e);
    el('span', 'flex:1;min-width:0', t, e);
    var gone = false, done = function () {
      if (gone) return; gone = true;
      var a = anim(e, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(6px) scale(.98)' }], { duration: 200, easing: 'ease-in' });
      if (a) a.onfinish = function () { e.remove(); }; else e.remove();
    };
    e.onclick = done;
    anim(e, [{ opacity: 0, transform: 'translateY(10px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
    timers.push(setTimeout(done, tone === 'warn' ? 4500 : 3200));
  }

  // ── status / render ───────────────────────────────────────
  function status() {
    if (stopped) return ['red', 'Stopped'];
    if (!groups.length) return ['amber', 'Add a group (Groups tab)'];
    if (!curKey) return ['amber', 'Open ' + (groups.length === 1 ? groups[0].name : 'one of your groups') + (groups.length > 1 ? ' · watching ' + groups.length + ' in the list' : '')];
    if (mode === 'linked') return ['green', 'Reading ' + curKey];
    if (mode === 'waiting') return ['blue', 'Connecting…'];
    if (mode === 'copy') return ['amber', 'Can\'t reach HotelOps · use copy'];
    return ['blue', 'Ready · click Connect HotelOps'];
  }
  var pulses = [], lastTone = '', logoPulse = null, glowAnim = null, sweepAnim = null;
  function setPulse(tone) {
    if (tone === lastTone) return; lastTone = tone;
    var c = TONE[tone];
    pill.style.background = c[2]; pill.style.color = c[1]; pill.style.border = '1px solid ' + c[2].replace(/[\d.]+\)$/, '.35)');
    [dot, mDot].forEach(function (d) { d.style.background = c[0]; d.style.boxShadow = '0 0 8px ' + c[0]; });
    [ring, mRing].forEach(function (d) { d.style.background = c[0]; });
    live.style.display = tone === 'green' ? 'inline-block' : 'none';
    pulses.forEach(function (a) { try { a.cancel(); } catch (_) {} }); pulses = [];
    if (tone !== 'red') [ring, mRing].forEach(function (r) { var a = anim(r, [{ transform: 'scale(1)', opacity: 0.7 }, { transform: 'scale(2.8)', opacity: 0 }], { duration: tone === 'green' ? 1400 : 1000, iterations: Infinity, easing: 'ease-out' }); if (a) pulses.push(a); });
    // the green H breathes while linked
    if (logoPulse) { try { logoPulse.cancel(); } catch (_) {} logoPulse = null; }
    if (tone === 'green') logoPulse = anim(logo, [{ boxShadow: '0 6px 16px -4px rgba(' + ACC_RGB + ',.6),0 0 0 0 rgba(' + ACC_RGB + ',0)' }, { boxShadow: '0 6px 20px -2px rgba(' + ACC_RGB + ',.85),0 0 0 6px rgba(' + ACC_RGB + ',.13)' }, { boxShadow: '0 6px 16px -4px rgba(' + ACC_RGB + ',.6),0 0 0 0 rgba(' + ACC_RGB + ',0)' }], { duration: 2400, iterations: Infinity, easing: 'ease-in-out' });
    glow.style.opacity = tone === 'green' ? '.8' : tone === 'red' ? '.2' : '.45';
    mini.style.borderColor = tone === 'green' ? 'rgba(' + ACC_RGB + ',.5)' : c[0] + '66';
    if (sweepAnim) { try { sweepAnim.cancel(); } catch (_) {} sweepAnim = null; }
    sweep.style.opacity = tone === 'green' || tone === 'blue' ? '1' : '0';
    if (tone === 'green' || tone === 'blue') sweepAnim = anim(sweep, [{ transform: 'translateX(-70px)' }, { transform: 'translateX(' + (W0 + 10) + 'px)' }], { duration: tone === 'green' ? 2600 : 1600, iterations: Infinity, easing: 'ease-in-out' });
  }
  // counters count up (and glow for a moment when they grow)
  function countTo(e, n) {
    if (e.v === n) return; var from = e.v; e.v = n;
    if (n > from && !minimized) anim(e.parentNode, [{ boxShadow: '0 0 0 0 rgba(' + ACC_RGB + ',0)' }, { boxShadow: '0 0 0 1px rgba(' + ACC_RGB + ',.45),0 0 16px -4px rgba(' + ACC_RGB + ',.6)' }, { boxShadow: '0 0 0 0 rgba(' + ACC_RGB + ',0)' }], { duration: 700, easing: 'ease-out' });
    if (RM || minimized || Math.abs(n - from) > 400) { setT(e, n); return; }
    var t0 = performance.now();
    (function step(t) { var k = Math.min(1, (t - t0) / 450), v = Math.round(from + (n - from) * (1 - Math.pow(1 - k, 3))); setT(e, v); if (k < 1 && e.v === n) requestAnimationFrame(step); })(t0);
  }
  var sigKey = '';
  function drawSignal() {
    var now = Date.now(), hourly = sigV === '12h', b = hourly ? bins(day.times, now, 12, 3600000) : bins(day.times, now), k = sigV + b.join(',') + '|' + Math.floor(now / 60000);
    if (k === sigKey || minimized) return; sigKey = k;
    var w = sig.clientWidth || (W0 - 26), h = 42, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    var c = cv.getContext && cv.getContext('2d'); if (!c) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    var max = Math.max(3, Math.max.apply(null, b)), n = b.length, gap = 3, bw = (w - 16 - gap * (n - 1)) / n;
    var pts = [];
    b.forEach(function (v, i) {
      var x = 8 + i * (bw + gap), bh = v ? Math.max(3, (h - 20) * v / max) : 2, y = h - 5 - bh;
      var gr = c.createLinearGradient(0, y, 0, h); gr.addColorStop(0, i === n - 1 ? 'rgba(106,245,155,.95)' : 'rgba(' + ACC_RGB + ',.55)'); gr.addColorStop(1, 'rgba(' + ACC_RGB + ',.04)');
      c.fillStyle = v ? gr : 'rgba(255,255,255,.07)';
      var r = Math.min(3, bw / 2); c.beginPath(); c.moveTo(x, h - 5); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.lineTo(x + bw - r, y); c.quadraticCurveTo(x + bw, y, x + bw, y + r); c.lineTo(x + bw, h - 5); c.closePath(); c.fill();
      pts.push([x + bw / 2, y]);
    });
    // a smooth line over the bars, with a soft fill under it
    c.beginPath();
    pts.forEach(function (p, i) { if (!i) { c.moveTo(p[0], p[1]); return; } var q = pts[i - 1], mx = (q[0] + p[0]) / 2; c.bezierCurveTo(mx, q[1], mx, p[1], p[0], p[1]); });
    c.strokeStyle = 'rgba(83,189,235,.8)'; c.lineWidth = 1.4; c.stroke();
    if (pts.length) { var last = pts[pts.length - 1]; c.fillStyle = '#b6e3f7'; c.beginPath(); c.arc(last[0], last[1], 2.2, 0, Math.PI * 2); c.fill(); }
    var total = b.reduce(function (s, v) { return s + v; }, 0);
    setT(sigLbl, total + ' msg · ' + (hourly ? '12 h' : '2 h') + ' ⇄');
  }
  function render() {
    if (stopped && !root.isConnected) return;
    var s = status();
    setPulse(s[0]); setT(pillTxt, s[1]); pill.title = s[1];
    setT(sub, stopped ? 'stopped' : mode === 'linked' ? 'linked · ' + (rtt ? rtt + ' ms' : '…') : mode === 'waiting' ? 'connecting…' : mode === 'copy' ? 'no link · copy mode' : 'not linked');
    sub.style.color = mode === 'linked' ? ACC_L : TXT3;
    setT(lastEl, feed.length ? 'last ' + relTime(feed[0].at) : '');
    var waitN = queue.length + answers.length;
    countTo(nRead, day.read); countTo(nSent, day.sent); countTo(nActs, day.acts || 0); countTo(nWait, waitN);
    nWait.style.color = waitN && mode !== 'linked' ? '#fcd34d' : '#f4f6fa';
    setT(empty, !groups.length ? 'Open your group in WhatsApp, then Groups → Add the open chat.' : !curKey ? 'Open "' + groups[0].name + '"' + (groups.length > 1 ? ' (or another listed group)' : '') + '. New messages show here.' : 'Watching… new messages show here.');
    if (mode === 'linked') { setT(connB, '✓ Connected · show HotelOps'); connB.title = 'Linked to HotelOps. Keep the HotelOps tab open.'; }
    else if (mode === 'waiting') { setT(connB, 'Connecting… (log in there if it asks)'); connB.title = 'Waiting for the HotelOps tab.'; }
    else if (mode === 'copy') { setT(connB, '📋 Copy ' + (queue.length || 'new') + ' message' + (queue.length === 1 ? '' : 's') + ' for HotelOps'); connB.title = 'WhatsApp blocked the link. Click, then paste in HotelOps → WhatsApp → Paste or upload → Read messages.'; }
    else { setT(connB, 'Connect HotelOps'); connB.title = 'Opens a HotelOps tab and sends it the new messages.'; }
    var nAsk = Object.keys(asks).filter(function (w) { return !words(w); }).length;
    var badge = function (k, n) { var b = tabBadge[k]; b.style.display = n ? 'inline-block' : 'none'; setT(b, n > 99 ? '99+' : n); };
    badge('feed', nAsk); badge('send', out.filter(function (o) { return o.st === 'typed' || o.st === 'queued'; }).length || (sendBadge ? sendBadge : 0)); badge('groups', 0); badge('settings', 0);
    var mb = unread + nAsk; mBadge.style.display = mb ? 'inline-block' : 'none'; setT(mBadge, mb > 99 ? '99+' : mb);
    setT(mTxt, 'HotelOps · ' + (mode === 'linked' ? 'linked' : s[1].split(' · ')[0]) + (queue.length && mode !== 'linked' ? ' · ' + queue.length + ' waiting' : ''));
    setT(mStats, '◉' + day.read + ' ⚡' + (day.acts || 0));
    renderOut(); renderGroups(); drawSignal();
  }
  function relTick() { var n = Date.now(); feed.forEach(function (f) { if (f.relEl) setT(f.relEl, relTime(f.at, n)); }); }

  // ── minimize / drag / stop ────────────────────────────────
  function place(e) { var p = LS.get('ho_wa_pos', null); if (p && p.left >= 0 && p.top >= 0) { var w = e.offsetWidth || 120, h = e.offsetHeight || 50; e.style.left = Math.max(4, Math.min(p.left, innerWidth - w - 4)) + 'px'; e.style.top = Math.max(4, Math.min(p.top, innerHeight - h - 4)) + 'px'; e.style.bottom = 'auto'; } else { e.style.left = '16px'; e.style.top = 'auto'; e.style.bottom = '16px'; } }
  function setMin(on, quick) {
    minimized = !!on; LS.set('ho_wa_min', minimized);
    if (!on) unread = 0;
    var show = function () {
      root.style.display = on ? 'none' : 'block'; mini.style.display = on ? 'inline-flex' : 'none';
      place(on ? mini : root);
      if (!quick) anim(on ? mini : root, [{ opacity: 0, transform: 'translateY(8px) scale(' + (on ? '.8' : '.94') + ')' }, { opacity: 1, transform: 'none' }], { duration: on ? 260 : 300, easing: 'cubic-bezier(.2,.9,.25,1.15)' });
      sigKey = ''; render(); placeToasts();
    };
    var a = quick ? null : anim(on ? root : mini, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(6px) scale(.94)' }], { duration: 150, easing: 'ease-in' });
    if (a) a.onfinish = show; else show();
  }
  minB.onclick = function () { setMin(true); };
  function dragger(handle, target, onClick) {
    var d = null;
    handle.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || (handle !== target && e.target.closest('button'))) return;
      var r = target.getBoundingClientRect(); d = { dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, moved: false };
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      if (handle !== target) e.preventDefault();
      handle.style.cursor = 'grabbing';
    });
    handle.addEventListener('pointermove', function (e) {
      if (!d) return;
      if (!d.moved && Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) < 5) return;
      d.moved = true;
      var w = target.offsetWidth, h = target.offsetHeight;
      var x = Math.max(4, Math.min(innerWidth - w - 4, e.clientX - d.dx)), y = Math.max(4, Math.min(innerHeight - Math.min(h, 80), e.clientY - d.dy));
      target.style.left = x + 'px'; target.style.top = y + 'px'; target.style.bottom = 'auto';
      placeToasts();
    });
    var end = function () {
      if (!d) return; var moved = d.moved; d = null; handle.style.cursor = 'grab';
      if (moved) { var r = target.getBoundingClientRect(); LS.set('ho_wa_pos', { left: Math.round(r.left), top: Math.round(r.top) }); }
      else if (onClick) onClick();
    };
    handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', function () { d = null; handle.style.cursor = 'grab'; });
  }
  dragger(head, root, null);
  dragger(mini, mini, function () { setMin(false); });
  mini.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setMin(false); } });
  function resetPos() { LS.set('ho_wa_pos', null); place(root); place(mini); placeToasts(); }
  head.addEventListener('dblclick', function (e) { if (e.target.closest('button')) return; resetPos(); });
  posB.onclick = resetPos;
  // Alt+H: show / hide (only with Alt alone, so WhatsApp's own shortcuts keep working)
  function onKey(e) {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return;
    if (e.code !== 'KeyH' && !/^[hH˙]$/.test(e.key || '')) return;
    e.preventDefault(); e.stopPropagation();
    setMin(!minimized);
    if (!minimized) { try { root.focus({ preventScroll: true }); } catch (_) {} }
  }
  root.tabIndex = -1; root.style.outline = 'none';
  window.addEventListener('keydown', onKey, true);
  var onResize = function () { placeToasts(); };
  window.addEventListener('resize', onResize);

  connB.onclick = function () { if (mode === 'copy') copyNew(); else connect(); };
  cpB.onclick = function () { copyToday(); };
  xB.onclick = function () { stop(); };

  document.body.appendChild(root); document.body.appendChild(mini); document.body.appendChild(toastHost);

  var deb = null, iv1 = 0, iv2 = 0, iv3 = 0;
  function stop(now) {
    if (stopped) return;
    if (guard.on && now !== true) try { gEvent('stop', 'closed the HotelOps reader', false); gFlush(); } catch (_) {}
    stopped = true;
    if (LOCK_OWN) { LOCK.stop(now === true); window.__hoWaLock = null; }   // the helper's own lock screen stays (it isn't this reader's)
    G_EVS.forEach(function (t) { document.removeEventListener(t, gInputEv, true); }); window.removeEventListener('focus', gFocus, true);
    try { obs && obs.disconnect(); } catch (_) {}
    timers.forEach(clearTimeout); clearInterval(iv1); clearInterval(iv2); clearInterval(iv3); clearTimeout(deb);
    window.removeEventListener('message', onMsg);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    window.__hoWa = null;
    [glowAnim, logoPulse, sweepAnim].concat(pulses).forEach(function (a) { try { a && a.cancel(); } catch (_) {} });
    toastHost.remove();
    if (now === true || RM) { root.remove(); mini.remove(); return; }
    render(); mini.remove();
    var a = anim(root, [{ opacity: 1, transform: 'none' }, { opacity: 1, transform: 'none', offset: .6 }, { opacity: 0, transform: 'translateY(10px) scale(.96)' }], { duration: 700, easing: 'ease-in', fill: 'forwards' });
    if (a) a.onfinish = function () { root.remove(); }; else root.remove();
    setTimeout(function () { root.remove(); }, 900);
  }
  // ⌨ while you type, WhatsApp changes the box you type in at every letter: that is not news, and reading the
  // whole chat each time made typing heavy. The box (and the search box) are ignored, and while your fingers are
  // on the keyboard the reader waits until you pause (at most 4 s), then reads once.
  var typedAt = 0;
  document.addEventListener('keydown', function (e) { if (e.isTrusted) typedAt = Date.now(); }, { capture: true, passive: true });
  function typing() { return Date.now() - typedAt < 900; }
  function laterScan(ms) { if (deb) return; deb = setTimeout(function () { deb = 0; if (typing() && Date.now() - lastScan < 4000) { laterScan(500); return; } scan(); }, ms); }
  obs = new MutationObserver(function (recs) {
    // our own window changing is not news; only the open chat and the chat list matter — not the box you type in
    var hit = false;
    for (var i = 0; i < recs.length; i++) {
      var t = recs[i].target; if (!t || root.contains(t) || mini.contains(t) || toastHost.contains(t)) continue;
      var e = t.nodeType === 1 ? t : t.parentElement; if (!e || !e.closest) continue;
      if (e.closest('#main footer, [contenteditable="true"], #side header, #side [role="textbox"]')) continue;
      if (e.closest('#main')) { dirtyMain = true; hit = true; } else if (e.closest('#pane-side')) { dirtyList = true; hit = true; }
      if (dirtyMain && dirtyList) break;
    }
    if (!hit) return;
    laterScan(250);                                   // already planned: read within 250 ms (later while you type)
  });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener('message', onMsg);
  iv1 = setInterval(tick, 2000); iv2 = setInterval(function () { if (typing()) laterScan(500); else scan(); }, 5000); iv3 = setInterval(relTick, 30000);
  // the HotelOps helper carries the messages between this tab and HotelOps: linked at once, no button, no new tab
  if (EXT && typeof EXT.post === 'function') {
    win = { closed: false, focus: function () {}, postMessage: function (o) { try { EXT.post(o); } catch (_) {} } };
    openedAt = Date.now(); mode = 'waiting'; tick();
  }
  window.__hoWa = { stop: stop, scan: scan, tab: setTab, min: setMin, toast: toast, lock: { state: LOCK.state, own: LOCK_OWN },
    state: function () { return { mode: mode, group: curKey, groups: groups.map(function (g) { return g.name + (g.act === false ? ' (log only)' : ''); }), queue: queue.length, sent: day.sent, read: day.read, rtt: rtt, auto: auto,
      out: out.map(function (o) { return o.id + ':' + o.st; }), asks: Object.keys(asks), unread: unread,
      feed: feed.map(function (f) { return (f.deleted ? '(deleted) ' : '') + (f.group && groups.length > 1 ? '[' + f.group + '] ' : '') + (f.preview ? '(preview) ' : '') + f.sender + ': ' + f.text + ' → ' + f.chips.map(function (c) { return c.label; }).join(' / '); }) }; } };

  // ── hello ─────────────────────────────────────────────────
  try {
    console.log('%c H %c HotelOps WhatsApp reader is running ✓ ', 'background:linear-gradient(135deg,#6af59b,#25d366);color:#04210f;font:800 14px Georgia,serif;padding:4px 7px;border-radius:6px 0 0 6px', 'background:#111b21;color:#8af0b4;font:700 13px system-ui,sans-serif;padding:5px 10px;border-radius:0 6px 6px 0');
    console.log('%c1. Open your group in WhatsApp, then click "Connect HotelOps" in the window at the bottom left.\n2. Keep the HotelOps tab open. It reads your groups and only sends what you send from HotelOps. To stop, click ✕ in the window (or reload WhatsApp).\n3. Alt+H shows or hides the window.', 'color:#9aa3b2;font:12px system-ui,sans-serif;line-height:1.6');
  } catch (_) {}
  setTab(LS.get('ho_wa_tab', 'feed') || 'feed');
  applyFilter();
  render(); scan();
  glowAnim = anim(glow, [{ backgroundPosition: '0% 50%' }, { backgroundPosition: '100% 50%' }, { backgroundPosition: '0% 50%' }], { duration: 9000, iterations: Infinity, easing: 'linear' });
  if (LS.get('ho_wa_min', false)) setMin(true, true);
  else {
    anim(root, [{ opacity: 0, transform: 'translateY(24px) scale(.92)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'none' }], { duration: 520, easing: 'cubic-bezier(.2,.9,.25,1.15)' });
    anim(logo, [{ transform: 'rotate(-12deg) scale(.6)' }, { transform: 'rotate(4deg) scale(1.12)', offset: .6 }, { transform: 'none' }], { duration: 700, delay: 120, easing: 'ease-out' });
  }
})();

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
 *  Feed · Send · Groups · Settings, and a small pill when minimized (–). ✕ stops it (or reload WhatsApp).
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

  var H = { parsePre: parsePre, dateIso: dateIso, isToday: isToday, todayIso: todayIso, copyLine: copyLine, copyText: copyText, isMineId: isMineId, chips: chips, parser: HP, MARK: MARK,
    groupMatch: groupMatch, wordsLookup: wordsLookup, splitPreview: splitPreview, listTime: listTime, msgTs: msgTs, relTime: relTime, bins: bins, hashId: hashId, sameText: sameText };
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
  if (!groups.length) { var g0 = (prompt('HotelOps: the name of the WhatsApp group to read (open the group first and it is filled in for you)', chatTitle()) || '').trim(); if (g0) groups.push({ name: g0, act: true }); }
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
    LS.set('ho_wa_seen', seen); LS.set('ho_wa_q', queue); LS.set('ho_wa_day', day); LS.set('ho_wa_out', out); LS.set('ho_wa_ans', answers);
  }

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
  function readOpen(g) {
    var now = new Date();
    rows().forEach(function (row) {
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
  function watchList() {
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
  function scan() {
    if (stopped) return;
    lastScan = Date.now();
    var g = openGroup(), key = g ? g.name : '';
    if (key !== curKey) { firstScan = true; curKey = key; }
    if (g) readOpen(g);
    watchList();
    trySend(); checkTyped();
    save(); flush(); render();
  }

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
      lastPong = Date.now(); if (typeof d.t === 'number' && d.t > 0) rtt = Math.max(1, Date.now() - d.t);
      if (mode !== 'linked') { mode = 'linked'; toast('✓ Linked to HotelOps', 'ok'); }
      if (d.ready) flush(); render();
    }
    if (d.source === 'ho-wa-ack' && d.id) {
      var n = queue.length, it = queue.filter(function (q) { return q.id === d.id; })[0]; queue = queue.filter(function (q) { return q.id !== d.id; });
      if (queue.length < n && it && !it.deleted) {
        day.sent++; markFeed(d.id, 'sent');
        var f = feed.filter(function (x) { return x.id === d.id; })[0];
        if (f && f.acts) { day.acts += f.acts; toast(f.chips.filter(function (c) { return /^(?:co|lco|ext|extending)$/.test(c.tone); }).map(function (c) { return c.label.replace(/ · .*$/, ''); }).join(', ') + ' → HotelOps', 'ok'); }
        else if (it && it.preview && f && f.state === 'sent') { /* quiet */ }
      }
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
    if (t - lastScan > 4500) scan(); else { flush(); render(); }
  }

  // ── sending what HotelOps asked for (only that) ───────────
  function composeBox() {
    var f = document.querySelector('#main footer');
    return (f && (f.querySelector('div[contenteditable="true"][data-tab]') || f.querySelector('[contenteditable="true"][role="textbox"]') || f.querySelector('[contenteditable="true"]'))) ||
      document.querySelector('#main div[contenteditable="true"][data-tab]') || null;
  }
  function sendButton() {
    var f = document.querySelector('#main footer'); if (!f) return null;
    var b = f.querySelector('button[aria-label="Send"]') || f.querySelector('[role="button"][aria-label="Send"]') || f.querySelector('[data-testid="compose-btn-send"]');
    if (!b) { var ic = f.querySelector('span[data-icon="send"]') || f.querySelector('[data-icon*="send"]'); if (ic) b = ic.closest('button') || ic.closest('[role="button"]') || ic; }
    return b || null;
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
    var o = { id: String(s.id).slice(0, 60), group: g ? g.name : (s.group || curKey || (groups[0] && groups[0].name) || ''), text: text, st: 'new', at: Date.now() };
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
    report(o, 'typed', auto ? '' : 'Press Enter in WhatsApp to send');
    toast(auto ? '✉ Sending to ' + o.group + '…' : '⌨ Typed in ' + o.group + ' · press Enter to send', 'info');
    if (auto) timers.push(setTimeout(function () { if (stopped || o.st !== 'typed') return; var sb = sendButton(); if (sb) { try { sb.click(); } catch (_) {} } else report(o, 'failed', 'No send button found · press Enter'); timers.push(setTimeout(checkTyped, 600)); }, 350));
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
    var h = document.createElement('div'); h.textContent = 'Press Ctrl+C now, then paste in HotelOps'; h.style.cssText = 'font-weight:700;font-size:14px;margin-bottom:8px;color:#e0b24f';
    var ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'width:100%;height:220px;box-sizing:border-box;background:#0b1220;color:#e5e7eb;border:1px solid #374151;border-radius:8px;padding:8px;font:12px/1.4 ui-monospace,monospace';
    var b = document.createElement('button'); b.textContent = 'Done'; b.type = 'button'; b.style.cssText = 'margin-top:10px;padding:8px 16px;border-radius:8px;border:0;background:#e0b24f;color:#111;font-weight:700;cursor:pointer';
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
  var RM = false; try { RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}
  var SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif', MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
  var GOLD = '#e0b24f';
  var TONE = {            // dot, text, background
    green: ['#22c55e', '#86efac', 'rgba(34,197,94,.14)'],
    amber: ['#f59e0b', '#fcd34d', 'rgba(245,158,11,.14)'],
    blue:  ['#60a5fa', '#bfdbfe', 'rgba(59,130,246,.15)'],
    red:   ['#ef4444', '#fca5a5', 'rgba(239,68,68,.15)']
  };
  // per action: bar/icon colour, chip text, chip background, icon
  var ACT = { co: ['#22c55e', '#86efac', 'rgba(34,197,94,.14)', '✓'], lco: ['#f59e0b', '#fcd34d', 'rgba(245,158,11,.14)', '⏰'], ext: ['#2dd4bf', '#99f6e4', 'rgba(45,212,191,.14)', '↪'], extending: ['#2dd4bf', '#99f6e4', 'rgba(45,212,191,.10)', '⏳'],
    note: ['#a78bfa', '#ddd6fe', 'rgba(139,92,246,.16)', '✎'], ask: ['#fbbf24', '#fde68a', 'rgba(251,191,36,.12)', '?'], off: ['#6b7280', '#9aa3b2', 'rgba(255,255,255,.05)', '·'] };
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
  var BTN = 'all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:10px;font:600 12px/1 ' + SANS + ';padding:8px 10px;white-space:nowrap;transition:background .15s,border-color .15s,transform .1s;';
  var BTN2 = BTN + 'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#e8ecf3;';
  var ICONB = 'all:unset;box-sizing:border-box;cursor:pointer;width:26px;height:26px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;color:#aab3c2;font:600 13px/1 ' + SANS + ';';
  function btn2(label, parent, css) { var b = el('button', BTN2 + (css || ''), label, parent); b.type = 'button'; hover(b, 'background:rgba(255,255,255,.11);border-color:rgba(255,255,255,.22);', 'background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.12);'); return b; }
  /** an on/off switch */
  function toggle(on, parent, onChange) {
    var b = el('button', 'all:unset;box-sizing:border-box;cursor:pointer;flex:none;position:relative;width:34px;height:20px;border-radius:99px;transition:background .2s', null, parent);
    b.type = 'button'; b.setAttribute('role', 'switch');
    var k = el('span', 'position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.4);transition:transform .2s', null, b);
    var set = function (v) { on = !!v; b.setAttribute('aria-checked', on ? 'true' : 'false'); b.style.background = on ? '#22c55e' : 'rgba(255,255,255,.18)'; k.style.transform = on ? 'translateX(14px)' : 'none'; };
    set(on);
    b.onclick = function () { set(!on); onChange(on); };
    b.set = set;
    return b;
  }

  var pos = LS.get('ho_wa_pos', null);
  var W0 = 352;
  var root = el('div', 'position:fixed;left:16px;bottom:16px;z-index:2147483646;width:' + W0 + 'px;max-width:calc(100vw - 32px);box-sizing:border-box;padding:1px;border-radius:19px;color:#e8ecf3;font:12.5px/1.4 ' + SANS + ';text-align:left;letter-spacing:0;' +
    'box-shadow:0 26px 70px -14px rgba(0,0,0,.7),0 0 0 1px rgba(0,0,0,.3);overflow:hidden;user-select:none;-webkit-user-select:none;contain:layout paint');
  root.id = 'hoWaWin'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'HotelOps WhatsApp reader');
  if (pos && pos.left >= 0 && pos.top >= 0) { root.style.left = Math.min(pos.left, innerWidth - 120) + 'px'; root.style.top = Math.min(pos.top, innerHeight - 60) + 'px'; root.style.bottom = 'auto'; }
  // the animated border glow
  var glow = el('div', 'position:absolute;inset:0;border-radius:19px;background:linear-gradient(115deg,rgba(224,178,79,.95),rgba(45,212,191,.55),rgba(139,92,246,.6),rgba(224,178,79,.95));background-size:300% 300%;opacity:.55', null, root);
  var panel = el('div', 'position:relative;border-radius:18px;overflow:hidden;background:radial-gradient(120% 70% at 0% 0%,rgba(224,178,79,.13),transparent 55%),radial-gradient(90% 60% at 100% 100%,rgba(45,212,191,.08),transparent 60%),linear-gradient(180deg,rgba(19,23,33,.95),rgba(10,13,20,.97));-webkit-backdrop-filter:blur(18px) saturate(1.4);backdrop-filter:blur(18px) saturate(1.4)', null, root);

  // header (drag handle)
  var head = el('div', 'display:flex;align-items:center;gap:10px;padding:12px 10px 8px 12px;cursor:grab', null, panel);
  var logo = el('div', 'flex:none;width:32px;height:32px;border-radius:10px;display:flex;align-items:center;justify-content:center;font:800 17px/1 Georgia,"Times New Roman",serif;color:#1a1408;background:linear-gradient(135deg,#f6d27a,' + GOLD + ' 55%,#a97a22);box-shadow:0 4px 14px -3px rgba(224,178,79,.6),inset 0 1px 0 rgba(255,255,255,.45)', 'H', head);
  var titles = el('div', 'flex:1;min-width:0', null, head);
  el('div', 'font:700 13.5px/1.2 ' + SANS + ';color:#f4f6fa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.01em', 'HotelOps · WhatsApp', titles);
  var subRow = el('div', 'display:flex;align-items:center;gap:6px;margin-top:3px;min-width:0', null, titles);
  var dotWrap = el('span', 'position:relative;flex:none;width:7px;height:7px', null, subRow);
  var dot = el('span', 'position:absolute;inset:0;border-radius:50%', null, dotWrap);
  var ring = el('span', 'position:absolute;inset:0;border-radius:50%;opacity:0', null, dotWrap);
  var sub = el('span', 'font:500 11px/1.2 ' + MONO + ';color:#8b94a5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0', '', subRow);
  var minB = el('button', ICONB, '–', head); minB.type = 'button'; minB.title = 'Make it small'; minB.setAttribute('aria-label', 'Minimize');
  var xB = el('button', ICONB, '✕', head); xB.type = 'button'; xB.title = 'Stop the reader'; xB.setAttribute('aria-label', 'Stop');
  [minB, xB].forEach(function (b) { hover(b, 'background:rgba(255,255,255,.1);color:#fff;', 'background:transparent;color:#aab3c2;'); });

  var body = el('div', 'padding:0 12px 12px', null, panel);
  // status line
  var stLine = el('div', 'display:flex;align-items:center;gap:8px;min-width:0', null, body);
  var pill = el('div', 'display:inline-flex;align-items:center;gap:6px;max-width:100%;min-width:0;box-sizing:border-box;padding:4px 10px;border-radius:99px;font:600 11.5px/1.3 ' + SANS, null, stLine);
  var pillTxt = el('span', 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0', '', pill);

  // the signal: messages per 10 minutes (last 2 hours) + a sweeping heartbeat
  var sig = el('div', 'position:relative;height:40px;margin:10px 0 10px;border-radius:10px;background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.015));border:1px solid rgba(255,255,255,.07);overflow:hidden', null, body);
  var cv = el('canvas', 'position:absolute;inset:0;width:100%;height:100%', null, sig);
  var sweep = el('div', 'position:absolute;top:0;bottom:0;left:0;width:60px;background:linear-gradient(90deg,transparent,rgba(224,178,79,.22),transparent);opacity:0', null, sig);
  var sigLbl = el('div', 'position:absolute;right:8px;top:4px;z-index:1;font:600 9.5px/1 ' + MONO + ';letter-spacing:.06em;color:#7d8696;text-transform:uppercase', '', sig);
  sig.title = 'Messages per 10 minutes, last 2 hours';

  // counters
  var stats = el('div', 'display:grid;grid-template-columns:repeat(4,1fr);gap:6px', null, body);
  function stat(label, color) {
    var b = el('div', 'position:relative;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.075);border-radius:11px;padding:7px 8px 6px;min-width:0;overflow:hidden', null, stats);
    el('div', 'position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,' + color + ',transparent);opacity:.8', null, b);
    var n = el('div', 'font:700 17px/1.1 ' + MONO + ';color:#f4f6fa;font-variant-numeric:tabular-nums', '0', b);
    el('div', 'font-size:10px;line-height:1.2;color:#8b94a5;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', label, b);
    n.v = 0; return n;
  }
  var nRead = stat('Read today', '#60a5fa'), nSent = stat('Sent in', '#22c55e'), nActs = stat('Rooms', GOLD), nWait = stat('Waiting', '#f59e0b');
  nRead.parentNode.title = 'Messages read today'; nSent.parentNode.title = 'Messages HotelOps has received'; nActs.parentNode.title = 'Check-outs, late check-outs and extensions passed on'; nWait.parentNode.title = 'Waiting for HotelOps';

  // tabs
  var tabsBar = el('div', 'position:relative;display:grid;grid-template-columns:repeat(4,1fr);margin:10px 0 8px;padding:3px;border-radius:11px;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.06)', null, body);
  tabsBar.setAttribute('role', 'tablist');
  var tabInd = el('div', 'position:absolute;top:3px;bottom:3px;left:3px;width:calc((100% - 6px) / 4);border-radius:8px;background:linear-gradient(180deg,rgba(255,255,255,.13),rgba(255,255,255,.07));box-shadow:0 1px 0 rgba(255,255,255,.08) inset,0 4px 10px -4px rgba(0,0,0,.5);transition:transform .25s cubic-bezier(.2,.8,.2,1)', null, tabsBar);
  var TABS = [['feed', 'Feed'], ['send', 'Send'], ['groups', 'Groups'], ['settings', 'Settings']], tabBtn = {}, tabBadge = {}, panes = {};
  var curTab = 'feed', sendBadge = 0;
  TABS.forEach(function (t, i) {
    var b = el('button', 'all:unset;box-sizing:border-box;position:relative;z-index:1;cursor:pointer;text-align:center;padding:6px 2px;border-radius:8px;font:600 11.5px/1.2 ' + SANS + ';color:#8b94a5;display:flex;align-items:center;justify-content:center;gap:5px', null, tabsBar);
    b.type = 'button'; b.setAttribute('role', 'tab'); el('span', '', t[1], b);
    tabBadge[t[0]] = el('span', 'display:none;min-width:15px;height:15px;padding:0 4px;box-sizing:border-box;border-radius:99px;background:' + GOLD + ';color:#1a1408;font:700 9.5px/15px ' + SANS + ';text-align:center', '', b);
    b.onclick = function () { setTab(t[0]); };
    tabBtn[t[0]] = b; b.idx = i;
  });
  var paneWrap = el('div', 'position:relative;max-height:300px;min-height:120px;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;margin-right:-4px;padding-right:4px', null, body);
  TABS.forEach(function (t) { panes[t[0]] = el('div', 'display:none;flex-direction:column;gap:6px', null, paneWrap); });
  function setTab(k) {
    curTab = k;
    TABS.forEach(function (t) { var on = t[0] === k; panes[t[0]].style.display = on ? 'flex' : 'none'; tabBtn[t[0]].style.color = on ? '#f4f6fa' : '#8b94a5'; tabBtn[t[0]].setAttribute('aria-selected', on ? 'true' : 'false'); });
    tabInd.style.transform = 'translateX(' + (tabBtn[k].idx * 100) + '%)';
    if (k === 'send') sendBadge = 0;
    anim(panes[k], [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' });
    LS.set('ho_wa_tab', k); render();
  }

  // Feed pane
  var asksBox = el('div', 'display:flex;flex-direction:column;gap:6px', null, panes.feed);
  var list = el('div', 'display:flex;flex-direction:column;gap:6px', null, panes.feed);
  list.setAttribute('aria-live', 'polite');
  var empty = el('div', 'padding:16px 10px;text-align:center;color:#7d8696;font-size:12px;border:1px dashed rgba(255,255,255,.1);border-radius:12px', '', list);

  // Send pane
  var sendHint = el('div', 'padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);color:#aab3c2;font-size:11.5px;line-height:1.45', '', panes.send);
  var outList = el('div', 'display:flex;flex-direction:column;gap:6px', null, panes.send);

  // Groups pane
  el('div', 'padding:8px 10px;border-radius:10px;background:rgba(96,165,250,.08);border:1px solid rgba(96,165,250,.18);color:#bfdbfe;font-size:11.5px;line-height:1.45',
    'Open groups are read fully. Closed groups: only the latest message is seen; open the group now and then to catch up. To read a second group fully all day, link WhatsApp Web in a second browser (for example Edge) as another device and run this reader there too.', panes.groups);
  var gList = el('div', 'display:flex;flex-direction:column;gap:6px', null, panes.groups);
  var gBtns = el('div', 'display:flex;gap:6px', null, panes.groups);
  var addOpenB = btn2('＋ Add the open chat', gBtns, 'flex:1');
  var addNameB = btn2('＋ By name', gBtns);

  // Settings pane
  function setRow(parent) { return el('div', 'display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07)', null, parent); }
  var sr1 = setRow(panes.settings);
  var sr1t = el('div', 'flex:1;min-width:0', null, sr1);
  el('div', 'font-weight:600;font-size:12px;color:#e8ecf3', 'Send automatically (no Enter needed)', sr1t);
  el('div', 'font-size:11px;color:#fcd34d;margin-top:2px;line-height:1.35', '⚠ WhatsApp may flag automated sending; use at your own risk. Off: HotelOps types the message and you press Enter.', sr1t);
  var autoT = toggle(auto, sr1, function (v) { auto = v; LS.set('ho_wa_auto', v); toast(v ? 'Automatic sending is on' : 'Automatic sending is off · you press Enter', v ? 'warn' : 'ok'); render(); });
  autoT.setAttribute('aria-label', 'Send automatically');
  var sr2 = el('div', 'display:flex;gap:6px', null, panes.settings);
  var cpB = btn2('📋 Copy today\'s chat', sr2, 'flex:1');
  cpB.title = 'Copies all of today\'s messages in the open group, for HotelOps → WhatsApp → Paste or upload.';
  var posB = btn2('⤢ Reset place', sr2);
  el('div', 'font-size:11px;color:#7d8696;line-height:1.45;padding:2px 2px 0', 'This reader reads your groups and only sends what you send from HotelOps. It never opens other chats. Stop it with ✕ or by reloading WhatsApp.', panes.settings);

  // the main button + the toast
  var connB = el('button', BTN + 'width:100%;margin-top:10px;padding:10px;font-size:12.5px;color:#1a1408;background:linear-gradient(135deg,#f6d27a,' + GOLD + ');border:1px solid rgba(255,255,255,.18);box-shadow:0 8px 18px -8px rgba(224,178,79,.7)', 'Connect HotelOps', body);
  connB.type = 'button'; hover(connB, 'filter:brightness(1.07);', 'filter:none;');
  var toastEl = el('div', 'position:absolute;left:12px;right:12px;bottom:12px;z-index:3;display:none;padding:9px 12px;border-radius:11px;font:600 12px/1.35 ' + SANS + ';box-shadow:0 10px 30px -8px rgba(0,0,0,.7);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)', '', panel);
  toastEl.setAttribute('role', 'status');

  // the small pill when minimized
  var mini = el('button', BTN + 'position:fixed;left:16px;bottom:16px;z-index:2147483646;display:none;max-width:calc(100vw - 32px);padding:6px 12px 6px 6px;border-radius:99px;color:#e8ecf3;background:rgba(16,19,27,.9);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border:1px solid rgba(224,178,79,.35);box-shadow:0 12px 34px -10px rgba(0,0,0,.7),0 0 0 4px rgba(224,178,79,.06);touch-action:none');
  mini.type = 'button'; mini.id = 'hoWaMini'; mini.title = 'Open the HotelOps window';
  var mLogo = el('span', 'flex:none;width:22px;height:22px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;font:800 12px/1 Georgia,serif;color:#1a1408;background:linear-gradient(135deg,#f6d27a,' + GOLD + ')', 'H', mini);
  var mDotWrap = el('span', 'position:relative;flex:none;width:8px;height:8px', null, mini);
  var mDot = el('span', 'position:absolute;inset:0;border-radius:50%', null, mDotWrap);
  var mRing = el('span', 'position:absolute;inset:0;border-radius:50%;opacity:0', null, mDotWrap);
  var mTxt = el('span', 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0', '', mini);
  var mBadge = el('span', 'display:none;min-width:18px;height:18px;padding:0 5px;box-sizing:border-box;border-radius:99px;background:' + GOLD + ';color:#1a1408;font:800 10.5px/18px ' + SANS + ';text-align:center', '', mini);

  // ── feed rows ─────────────────────────────────────────────
  var FEED_MAX = 12;
  function shortTime(t) { var m = String(t || '').match(/(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\s*([ap])?/i); return m ? m[1] + ':' + m[2] + (m[3] ? ' ' + m[3].toUpperCase() + 'M' : '') : ''; }
  function addFeed(m, opt) {
    opt = opt || {};
    var old = feed.filter(function (f) { return f.id === m.id || (!m.preview && f.preview && f.group === m.group && sameText(f.text, m.text) && Math.abs(msgTs(f.rawTime) - msgTs(m.time)) < 60000); });
    old.forEach(function (o) { feed = feed.filter(function (f) { return f !== o; }); if (o.node) o.node.remove(); });
    var ch = chips(m.text, words, m.quote);
    var f = { id: m.id, rawTime: m.time, at: msgTs(m.time), time: shortTime(m.time), sender: m.sender || (m.mine ? 'Me' : ''), text: m.text, edited: m.edited, chips: ch, state: 'wait', group: m.group || '', preview: !!m.preview, truncated: !!m.truncated, missed: opt.missed || 0,
      acts: ch.filter(function (c) { return /^(?:co|lco|ext|extending)$/.test(c.tone); }).length };
    ch.forEach(function (c) { if (c.ask && !words(c.ask.word)) { asks[c.ask.word] = { word: c.ask.word, text: m.text, sender: f.sender, room: c.ask.room }; } });
    feed.unshift(f);
    if (empty.parentNode) empty.remove();
    var tone = ch[0] ? ch[0].tone : 'off'; var A = ACT[tone] || ACT.off;
    if (f.preview && f.truncated) A = ACT.off;
    var r = el('div', 'flex:none;position:relative;display:flex;gap:9px;background:linear-gradient(90deg,' + A[2] + ',rgba(255,255,255,.03) 45%);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:8px 9px 8px 12px;overflow:hidden');
    el('div', 'position:absolute;left:0;top:0;bottom:0;width:3px;background:' + A[0] + ';box-shadow:0 0 12px ' + A[0], null, r);
    el('div', 'flex:none;width:24px;height:24px;border-radius:8px;display:flex;align-items:center;justify-content:center;font:700 12px/1 ' + SANS + ';color:' + A[0] + ';background:' + A[2] + ';border:1px solid ' + A[0] + '44', A[3], r);
    var bd = el('div', 'flex:1;min-width:0', null, r);
    var top = el('div', 'display:flex;align-items:baseline;gap:6px;min-width:0', null, bd);
    el('span', 'flex:0 1 auto;min-width:0;font-weight:700;font-size:12px;color:#e8ecf3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', f.sender + (f.edited ? ' ✎' : ''), top);
    if (f.group && groups.length > 1) el('span', 'flex:0 1 auto;min-width:0;max-width:96px;font:600 9.5px/1.4 ' + SANS + ';padding:0 6px;border-radius:99px;color:#bfdbfe;background:rgba(96,165,250,.14);white-space:nowrap;overflow:hidden;text-overflow:ellipsis', f.group, top);
    if (f.preview) el('span', 'flex:none;font:600 9.5px/1.4 ' + SANS + ';padding:0 6px;border-radius:99px;color:#fcd34d;background:rgba(245,158,11,.14)', 'preview', top);
    f.relEl = el('span', 'margin-left:auto;flex:none;font:500 10px/1 ' + MONO + ';color:#7d8696', relTime(f.at), top);
    f.relEl.title = f.time;
    var tx = el('div', 'margin-top:2px;font-size:12px;color:#cfd6e2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', f.text.replace(/\s*\n\s*/g, ' · '), bd); tx.title = f.text; tx.setAttribute('data-t', '');
    var cw = el('div', 'display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:5px', null, bd);
    ch.forEach(function (c) { var k = ACT[c.tone] || ACT.off; el('span', 'font:600 10.5px/1.3 ' + SANS + ';padding:2px 7px;border-radius:99px;color:' + k[1] + ';background:' + k[2] + (c.tone === 'ask' ? ';border:1px dashed ' + k[0] + '88' : ''), c.label, cw); });
    if (f.preview && (f.truncated || f.missed)) el('span', 'font-size:10.5px;color:#9aa3b2', f.truncated ? 'open the group to read in full' : '+' + f.missed + ' more · open the group to read all', cw);
    f.stEl = el('span', 'margin-left:auto;font:600 10px/1 ' + SANS + ';color:#7d8696', '', cw);
    f.node = r;
    list.insertBefore(r, list.firstChild);
    while (feed.length > FEED_MAX) { var x = feed.pop(); if (x.node) x.node.remove(); }
    stateText(f);
    if (minimized) unread++;
    anim(r, [{ opacity: 0, transform: 'translateY(-8px) scale(.98)', filter: 'brightness(1.6)' }, { opacity: 1, transform: 'none', filter: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
    renderAsks();
  }
  function stateText(f) { if (f.stEl && !f.deleted) { setT(f.stEl, f.state === 'sent' ? '✓ in HotelOps' : f.state === 'copied' ? '✓ copied' : 'waiting…'); f.stEl.style.color = f.state === 'wait' ? '#7d8696' : '#86efac'; } }
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
      var bs = el('div', 'display:flex;flex-wrap:wrap;gap:4px', null, c);
      var noteIn = el('input', 'all:unset;box-sizing:border-box;width:100%;padding:6px 9px;border-radius:8px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.12);color:#e8ecf3;font:12px ' + SANS + ';user-select:text;-webkit-user-select:text');
      noteIn.placeholder = 'What it stands for (optional), e.g. Vacant Dirty'; noteIn.maxLength = 60;
      MEAN.forEach(function (mn) {
        var b = btn2(mn[1], bs, 'padding:5px 8px;font-size:11px;border-radius:99px');
        b.onclick = function () {
          var a = { word: w, meaning: mn[0], note: noteIn.value.trim() };
          if (!post({ source: 'ho-wa', answer: a })) { answers.push(a); save(); toast('Saved · sent to HotelOps when linked', 'info'); } else toast('✓ "' + w + '" = ' + mn[1].replace(/^\S+\s/, ''), 'ok');
          wordList.push({ w: w, m: mn[0], label: a.note }); words = wordsLookup(wordList); LS.set('ho_wa_words', wordList);
          delete asks[w]; renderAsks(); render();
        };
      });
      c.appendChild(noteIn);
    });
  }

  // ── Send pane rows ────────────────────────────────────────
  var OUT_ST = { new: ['…', '#9aa3b2', 'Waiting…'], queued: ['⏳', '#fcd34d', 'Waiting'], typed: ['⌨', '#fcd34d', 'Typed — press Enter in WhatsApp'], sent: ['✓', '#86efac', 'Sent'], failed: ['✗', '#fca5a5', 'Not sent'], cancelled: ['—', '#7d8696', 'Cancelled'] };
  var outSig = '';
  function renderOut() {
    var sig2 = out.map(function (o) { return o.id + o.st + o.why; }).join('|') + curKey + auto;
    if (sig2 === outSig) return; outSig = sig2;
    while (outList.firstChild) outList.removeChild(outList.firstChild);
    var ls = out.slice().reverse().slice(0, 8);
    if (!ls.length) el('div', 'padding:14px 10px;text-align:center;color:#7d8696;font-size:12px;border:1px dashed rgba(255,255,255,.1);border-radius:12px', 'Nothing to send. Type a message in HotelOps → WhatsApp → Send to WhatsApp.', outList);
    ls.forEach(function (o) {
      var s = OUT_ST[o.st] || OUT_ST.new;
      var r = el('div', 'display:flex;gap:9px;align-items:flex-start;padding:8px 10px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07)', null, outList);
      el('div', 'flex:none;width:22px;height:22px;border-radius:7px;display:flex;align-items:center;justify-content:center;font:700 11px/1 ' + SANS + ';color:' + s[1] + ';background:rgba(255,255,255,.06)', s[0], r);
      var bd = el('div', 'flex:1;min-width:0', null, r);
      el('div', 'font-size:12px;color:#e8ecf3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', o.text.replace(/[⁣]/g, '').replace(/\s*\n\s*/g, ' · '), bd).title = o.text.replace(/[⁣]/g, '');
      var lbl = o.st === 'queued' ? (o.why && !/^Open /.test(o.why) ? o.why : 'Open ' + (o.group || 'the group') + ' to send') : o.st === 'failed' && o.why ? 'Not sent · ' + o.why : s[2];
      el('div', 'font-size:10.5px;color:' + s[1] + ';margin-top:2px', lbl + (o.group && groups.length > 1 ? ' · ' + o.group : ''), bd);
    });
    sendHint.textContent = auto ? 'Automatic sending is ON: messages from HotelOps are sent in the open group straight away.' : 'Messages you send from HotelOps are typed in the open group\'s message box. Press Enter in WhatsApp to send them. Nothing is sent on its own.';
  }

  // ── Groups pane rows ──────────────────────────────────────
  var gSig = '';
  function renderGroups() {
    var sig2 = JSON.stringify(groups) + curKey;
    if (sig2 === gSig) return; gSig = sig2;
    while (gList.firstChild) gList.removeChild(gList.firstChild);
    if (!groups.length) el('div', 'padding:12px;text-align:center;color:#7d8696;font-size:12px;border:1px dashed rgba(255,255,255,.1);border-radius:12px', 'No groups yet. Open your group in WhatsApp, then click "Add the open chat".', gList);
    groups.forEach(function (g, i) {
      var isOpen = curKey && groupMatch(g.name, curKey);
      var r = el('div', 'display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid ' + (isOpen ? 'rgba(34,197,94,.35)' : 'rgba(255,255,255,.07)'), null, gList);
      var t1 = el('div', 'display:flex;align-items:center;gap:7px;min-width:0', null, r);
      el('span', 'flex:none;width:7px;height:7px;border-radius:50%;background:' + (isOpen ? '#22c55e' : '#6b7280') + (isOpen ? ';box-shadow:0 0 8px #22c55e' : ''), null, t1);
      el('span', 'flex:1;min-width:0;font-weight:700;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', g.name, t1).title = g.name;
      el('span', 'flex:none;font-size:10px;color:' + (isOpen ? '#86efac' : '#9aa3b2'), isOpen ? 'open · read fully' : 'closed · latest message', t1);
      var rm = el('button', ICONB + 'width:22px;height:22px;font-size:11px', '✕', t1); rm.type = 'button'; rm.title = 'Remove this group'; rm.setAttribute('aria-label', 'Remove ' + g.name);
      rm.onclick = function () { if (confirm('Stop reading "' + g.name + '"?')) { groups.splice(i, 1); saveGroups(); render(); } };
      var t2 = el('div', 'display:flex;align-items:center;gap:8px;font-size:11.5px;color:#aab3c2', null, r);
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

  // ── toast inside the window ───────────────────────────────
  var toastT = null;
  function toast(t, tone) {
    var c = tone === 'ok' ? TONE.green : tone === 'warn' ? TONE.amber : TONE.blue;
    toastEl.textContent = t; toastEl.style.display = 'block';
    toastEl.style.color = c[1]; toastEl.style.background = 'rgba(14,17,25,.94)'; toastEl.style.border = '1px solid ' + c[0] + '66';
    anim(toastEl, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
    clearTimeout(toastT); toastT = setTimeout(function () { var a = anim(toastEl, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(6px)' }], { duration: 200 }); if (a) a.onfinish = function () { toastEl.style.display = 'none'; }; else toastEl.style.display = 'none'; }, 3200);
    timers.push(toastT);
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
    pulses.forEach(function (a) { try { a.cancel(); } catch (_) {} }); pulses = [];
    if (tone !== 'red') [ring, mRing].forEach(function (r) { var a = anim(r, [{ transform: 'scale(1)', opacity: 0.7 }, { transform: 'scale(2.8)', opacity: 0 }], { duration: tone === 'green' ? 1400 : 1000, iterations: Infinity, easing: 'ease-out' }); if (a) pulses.push(a); });
    // the gold H breathes while linked
    if (logoPulse) { try { logoPulse.cancel(); } catch (_) {} logoPulse = null; }
    if (tone === 'green') logoPulse = anim(logo, [{ boxShadow: '0 4px 14px -3px rgba(224,178,79,.6),0 0 0 0 rgba(224,178,79,.0)' }, { boxShadow: '0 4px 18px -2px rgba(224,178,79,.85),0 0 0 6px rgba(224,178,79,.12)' }, { boxShadow: '0 4px 14px -3px rgba(224,178,79,.6),0 0 0 0 rgba(224,178,79,.0)' }], { duration: 2400, iterations: Infinity, easing: 'ease-in-out' });
    glow.style.opacity = tone === 'green' ? '.75' : tone === 'red' ? '.25' : '.5';
    if (sweepAnim) { try { sweepAnim.cancel(); } catch (_) {} sweepAnim = null; }
    sweep.style.opacity = tone === 'green' || tone === 'blue' ? '1' : '0';
    if (tone === 'green' || tone === 'blue') sweepAnim = anim(sweep, [{ transform: 'translateX(-70px)' }, { transform: 'translateX(' + (W0 + 10) + 'px)' }], { duration: tone === 'green' ? 2600 : 1600, iterations: Infinity, easing: 'ease-in-out' });
  }
  // counters count up
  function countTo(e, n) {
    if (e.v === n) return; var from = e.v; e.v = n;
    if (RM || minimized || Math.abs(n - from) > 400) { setT(e, n); return; }
    var t0 = performance.now();
    (function step(t) { var k = Math.min(1, (t - t0) / 450), v = Math.round(from + (n - from) * (1 - Math.pow(1 - k, 3))); setT(e, v); if (k < 1 && e.v === n) requestAnimationFrame(step); })(t0);
  }
  var sigKey = '';
  function drawSignal() {
    var now = Date.now(), b = bins(day.times, now), k = b.join(',') + '|' + Math.floor(now / 60000);
    if (k === sigKey || minimized) return; sigKey = k;
    var w = sig.clientWidth || (W0 - 26), h = 40, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    var c = cv.getContext && cv.getContext('2d'); if (!c) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    var max = Math.max(3, Math.max.apply(null, b)), n = b.length, gap = 3, bw = (w - 16 - gap * (n - 1)) / n;
    var pts = [];
    b.forEach(function (v, i) {
      var x = 8 + i * (bw + gap), bh = v ? Math.max(3, (h - 20) * v / max) : 2, y = h - 5 - bh;
      var gr = c.createLinearGradient(0, y, 0, h); gr.addColorStop(0, i === n - 1 ? 'rgba(246,210,122,.95)' : 'rgba(224,178,79,.55)'); gr.addColorStop(1, 'rgba(224,178,79,.05)');
      c.fillStyle = v ? gr : 'rgba(255,255,255,.07)';
      var r = Math.min(3, bw / 2); c.beginPath(); c.moveTo(x, h - 5); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.lineTo(x + bw - r, y); c.quadraticCurveTo(x + bw, y, x + bw, y + r); c.lineTo(x + bw, h - 5); c.closePath(); c.fill();
      pts.push([x + bw / 2, y]);
    });
    c.strokeStyle = 'rgba(45,212,191,.75)'; c.lineWidth = 1.4; c.beginPath();
    pts.forEach(function (p, i) { if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); }); c.stroke();
    var total = b.reduce(function (s, v) { return s + v; }, 0);
    setT(sigLbl, total + ' msg · 2 h');
  }
  function render() {
    if (stopped && !root.isConnected) return;
    var s = status();
    setPulse(s[0]); setT(pillTxt, s[1]); pill.title = s[1];
    setT(sub, stopped ? 'stopped' : mode === 'linked' ? 'linked · ' + (rtt ? rtt + ' ms' : '…') : mode === 'waiting' ? 'connecting…' : mode === 'copy' ? 'no link · copy mode' : 'not linked');
    sub.style.color = mode === 'linked' ? '#86efac' : '#8b94a5';
    countTo(nRead, day.read); countTo(nSent, day.sent); countTo(nActs, day.acts || 0); countTo(nWait, queue.length);
    nWait.style.color = queue.length && mode !== 'linked' ? '#fcd34d' : '#f4f6fa';
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
    renderOut(); renderGroups(); drawSignal();
  }
  function relTick() { var n = Date.now(); feed.forEach(function (f) { if (f.relEl) setT(f.relEl, relTime(f.at, n)); }); }

  // ── minimize / drag / stop ────────────────────────────────
  function place(e) { var p = LS.get('ho_wa_pos', null); if (p && p.left >= 0 && p.top >= 0) { e.style.left = Math.max(4, Math.min(p.left, innerWidth - 120)) + 'px'; e.style.top = Math.max(4, Math.min(p.top, innerHeight - 50)) + 'px'; e.style.bottom = 'auto'; } else { e.style.left = '16px'; e.style.top = 'auto'; e.style.bottom = '16px'; } }
  function setMin(on, quick) {
    minimized = !!on; LS.set('ho_wa_min', minimized);
    if (!on) unread = 0;
    var show = function () {
      root.style.display = on ? 'none' : 'block'; mini.style.display = on ? 'inline-flex' : 'none';
      place(on ? mini : root);
      if (!quick) anim(on ? mini : root, [{ opacity: 0, transform: 'translateY(8px) scale(' + (on ? '.8' : '.94') + ')' }, { opacity: 1, transform: 'none' }], { duration: on ? 260 : 300, easing: 'cubic-bezier(.2,.9,.25,1.15)' });
      sigKey = ''; render();
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
      if (handle !== target) { handle.style.cursor = 'grabbing'; e.preventDefault(); }
    });
    handle.addEventListener('pointermove', function (e) {
      if (!d) return;
      if (!d.moved && Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) < 5) return;
      d.moved = true;
      var w = target.offsetWidth, h = target.offsetHeight;
      var x = Math.max(4, Math.min(innerWidth - w - 4, e.clientX - d.dx)), y = Math.max(4, Math.min(innerHeight - Math.min(h, 80), e.clientY - d.dy));
      target.style.left = x + 'px'; target.style.top = y + 'px'; target.style.bottom = 'auto';
    });
    var end = function () {
      if (!d) return; var moved = d.moved; d = null; handle.style.cursor = handle === target ? 'pointer' : 'grab';
      if (moved) { var r = target.getBoundingClientRect(); LS.set('ho_wa_pos', { left: Math.round(r.left), top: Math.round(r.top) }); }
      else if (onClick) onClick();
    };
    handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', function () { d = null; });
  }
  dragger(head, root, null);
  dragger(mini, mini, function () { setMin(false); });
  function resetPos() { LS.set('ho_wa_pos', null); place(root); place(mini); }
  head.addEventListener('dblclick', function (e) { if (e.target.closest('button')) return; resetPos(); });
  posB.onclick = resetPos;

  connB.onclick = function () { if (mode === 'copy') copyNew(); else connect(); };
  cpB.onclick = function () { copyToday(); };
  xB.onclick = function () { stop(); };

  document.body.appendChild(root); document.body.appendChild(mini);

  var deb = null, iv1 = 0, iv2 = 0, iv3 = 0;
  function stop(now) {
    if (stopped) return; stopped = true;
    try { obs && obs.disconnect(); } catch (_) {}
    timers.forEach(clearTimeout); clearInterval(iv1); clearInterval(iv2); clearInterval(iv3); clearTimeout(deb);
    window.removeEventListener('message', onMsg);
    window.__hoWa = null;
    [glowAnim, logoPulse, sweepAnim].concat(pulses).forEach(function (a) { try { a && a.cancel(); } catch (_) {} });
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
  iv1 = setInterval(tick, 2000); iv2 = setInterval(scan, 5000); iv3 = setInterval(relTick, 30000);
  window.__hoWa = { stop: stop, scan: scan, tab: setTab, min: setMin, toast: toast,
    state: function () { return { mode: mode, group: curKey, groups: groups.map(function (g) { return g.name + (g.act === false ? ' (log only)' : ''); }), queue: queue.length, sent: day.sent, read: day.read, rtt: rtt, auto: auto,
      out: out.map(function (o) { return o.id + ':' + o.st; }), asks: Object.keys(asks), unread: unread,
      feed: feed.map(function (f) { return (f.deleted ? '(deleted) ' : '') + (f.group && groups.length > 1 ? '[' + f.group + '] ' : '') + (f.preview ? '(preview) ' : '') + f.sender + ': ' + f.text + ' → ' + f.chips.map(function (c) { return c.label; }).join(' / '); }) }; } };

  // ── hello ─────────────────────────────────────────────────
  try {
    console.log('%c H %c HotelOps WhatsApp reader is running ✓ ', 'background:linear-gradient(135deg,#f6d27a,#e0b24f);color:#1a1408;font:800 14px Georgia,serif;padding:4px 7px;border-radius:6px 0 0 6px', 'background:#10131b;color:#86efac;font:700 13px system-ui,sans-serif;padding:5px 10px;border-radius:0 6px 6px 0');
    console.log('%c1. Open your group in WhatsApp, then click "Connect HotelOps" in the window at the bottom left.\n2. Keep the HotelOps tab open. It reads your groups and only sends what you send from HotelOps. To stop, click ✕ in the window (or reload WhatsApp).', 'color:#9aa3b2;font:12px system-ui,sans-serif;line-height:1.6');
  } catch (_) {}
  setTab(LS.get('ho_wa_tab', 'feed') || 'feed');
  render(); scan();
  glowAnim = anim(glow, [{ backgroundPosition: '0% 50%' }, { backgroundPosition: '100% 50%' }, { backgroundPosition: '0% 50%' }], { duration: 9000, iterations: Infinity, easing: 'linear' });
  if (LS.get('ho_wa_min', false)) setMin(true, true);
  else {
    anim(root, [{ opacity: 0, transform: 'translateY(24px) scale(.92)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'none' }], { duration: 520, easing: 'cubic-bezier(.2,.9,.25,1.15)' });
    anim(logo, [{ transform: 'rotate(-12deg) scale(.6)' }, { transform: 'rotate(4deg) scale(1.12)', offset: .6 }, { transform: 'none' }], { duration: 700, delay: 120, easing: 'ease-out' });
  }
})();

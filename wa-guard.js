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
//  • Smart alerts: every event gets a severity (a private chat, a search,
//    typing or closing the reader is urgent; your work groups are low), a
//    visit is one story — "someone is on it" → "still going" → "stopped,
//    here's what they did" — and you choose what reaches the phone.
//  • Auto-away: the guard switches itself on when the WhatsApp PC has had
//    no mouse / keyboard for N minutes (you choose, or off).
//  • The 📲 phone setup here (ntfy / Telegram) is the one every HotelOps alert
//    uses: notify-hub.js sends through it, and the guard's own alerts go
//    through the hub too (instant, even in quiet hours) when it is loaded.
//  • One Away for both: while you're away Opera at the desk is locked too (📡 Opera → 🛡 Away guard,
//    opera-bridge.js listens for the 'ho-away' event), and "I'm back" here unlocks it. WhatsApp Web
//    gets the same lock screen (the same PIN); this guard's reporting goes on as before under it.
//  • Saved under your own account: waGuard/{your uid} = { on, since, by, auto,
//    cfg: {level, auto}, beat: {at, linked}, ntfy: {topic},
//    log: {id: {at, kind, chat, detail, lines, work}} }.
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
  let TG = null;     // { token, bot, chat } — or through your own Telegram bot (most reliable on iPhone)
  let CFG = { level: 'important', auto: 0 };   // level: urgent | important | all · auto: minutes idle before auto-away (0 = off)
  const LEVELS = { urgent: 3, important: 2, all: 1 };
  const SESSION_GAP = 3 * 60e3;   // quiet this long = the visit is over
  /** how serious one thing is: 3 urgent · 2 worth knowing · 1 minor (also: anything in your work groups) */
  function sev(e) {
    if (!e) return 1;
    if (e.kind === 'stop' || e.kind === 'link' || e.kind === 'type' || e.kind === 'search') return 3;
    if (e.kind === 'chat' || e.kind === 'read') return e.work ? 1 : 3;
    if (e.kind === 'reader') return 2;
    return 1;   // a click, coming to the tab: could be someone moving the mouse aside
  }
  /** the log as visits: events less than 3 min apart belong together, newest visit first */
  function visits(list) {
    const out = []; let cur = null;
    list.slice().sort((a, b) => a.at - b.at).forEach(e => {
      if (!cur || e.at - cur.end > SESSION_GAP) { cur = { start: e.at, end: e.at, ev: [] }; out.push(cur); }
      cur.ev.push(e); cur.end = e.at;
    });
    out.forEach(v => {
      v.sev = Math.max(...v.ev.map(sev));
      v.chats = [...new Set(v.ev.filter(e => (e.kind === 'chat' || e.kind === 'read' || e.kind === 'type') && e.chat).map(e => e.chat))];
      v.priv = [...new Set(v.ev.filter(e => (e.kind === 'chat' || e.kind === 'read' || e.kind === 'type') && e.chat && !e.work).map(e => e.chat))];
      v.searches = v.ev.filter(e => e.kind === 'search').map(e => (e.detail.match(/"(.*)"/) || [])[1] || e.detail);
      v.typed = v.ev.some(e => e.kind === 'type'); v.stopped = v.ev.some(e => e.kind === 'stop' || e.kind === 'link');
    });
    return out.reverse();
  }
  const mins = ms => { const m = Math.round(ms / 60e3); return m < 1 ? 'under a minute' : m + ' min'; };
  function storyOf(v) {
    const bits = [];
    if (v.priv.length) bits.push('💬 ' + v.priv.slice(0, 3).join(', ') + (v.priv.length > 3 ? ` +${v.priv.length - 3}` : ''));
    else if (v.chats.length) bits.push('💬 work chats: ' + v.chats.slice(0, 2).join(', '));
    if (v.searches.length) bits.push('🔎 searched ' + v.searches.slice(0, 3).map(q => '"' + q + '"').join(', '));
    const typedTxt = v.ev.filter(e => e.kind === 'type' && /typing:/.test(e.detail || '')).map(e => e.detail.replace(/^.*?typing:\s*/, '')).slice(-2);
    if (typedTxt.length) bits.push('⌨️ typed ' + typedTxt.join(' · '));
    else if (v.typed) bits.push('⌨️ typed a message');
    if (v.stopped) bits.push('⛔ closed the reader / WhatsApp');
    return bits;
  }
  let ST = { on: false, since: 0 }, LOG = {}, BEAT = null, started = false, seenIds = null, lastLinked = 0, lostSaid = false, loaded = false;

  /** on / since / auto, and whether it has been read from the database yet (loaded) */
  function basic() { return { on: !!ST.on, since: +ST.since || 0, auto: +CFG.auto || 0, loaded }; }
  /** what the WhatsApp reader gets: the guard, and the lock screen (opera-bridge.js: the same PIN, armed while you're away) */
  function state() {
    const s = { on: !!ST.on, since: +ST.since || 0, auto: +CFG.auto || 0 };
    try { const l = W.hoOpera && W.hoOpera.guard && typeof W.hoOpera.guard.waLock === 'function' ? W.hoOpera.guard.waLock() : null; if (l) s.lock = l; } catch (_) {}
    return s;
  }
  function bridge() { return W.hoWaBridge || null; }
  function linkedHere() { const b = bridge(); try { return !!(b && b.linked && b.linked()); } catch (_) { return false; } }

  // ── switch on / off (from any device signed in as you) ──
  function set(on, how) {
    if (!uid()) return toast('Sign in first', 'err');
    const auto = how === 'auto';
    // auto-away: the PC has been idle for minutes already, so it watches at once (no 45 s to walk away)
    const v = { on: !!on, since: auto ? Date.now() - 46000 : Date.now(), by: auto ? 'auto' : ((typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || '') };
    ST = v;
    if (typeof fbSet === 'function') fbSet(P('on'), v.on), fbSet(P('since'), v.since), fbSet(P('by'), v.by);
    pushToReader(); told();
    if (auto) notify('🛡 Auto-away on', `Nobody touched the WhatsApp PC for ${CFG.auto} min, so the Away guard is now watching it. Tap "I'm back" in HotelOps when you return.`, 2, ['shield']);
    else toast(on ? '🛡 Away guard on — your phone will be told if someone uses your WhatsApp (starts in 45 s)' : '🛡 Away guard off — welcome back', on ? 'ok' : '');
    if (!on) endVisit(true);
    render(); try { renderAway(); } catch (_) {}
  }
  let cfgOpen = false;
  function setCfg(k, v) {
    cfgOpen = 'force';
    CFG = Object.assign({}, CFG, { [k]: v });
    if (typeof fbSet === 'function' && uid()) fbSet(P('cfg'), CFG);
    pushToReader(); render(); cfgOpen = true;
  }
  /** Away switched: other guards on this PC follow it (the Opera lock screen, opera-bridge.js) */
  function told() { try { W.dispatchEvent(new CustomEvent('ho-away', { detail: state() })); } catch (_) {} }
  function pushToReader() { const b = bridge(); if (b && b.post) try { b.post({ source: 'ho-wa', guard: state() }); } catch (_) {} }

  // ── the PC with the reader: save what it saw ──
  function fromReader(events, msg) {
    if (!uid() || typeof fbSet !== 'function') return [];
    if (msg && msg.arm === 'auto' && CFG.auto > 0 && !ST.on) set(true, 'auto');
    const ids = [];
    (events || []).slice(0, 40).forEach(e => {
      if (!e || typeof e !== 'object' || !/^g[a-z0-9]{4,20}$/.test(String(e.id || ''))) return;
      const rec = { at: +e.at || Date.now(), kind: KIND[e.kind] ? e.kind : 'touch', chat: String(e.chat || '').slice(0, 80), detail: String(e.detail || '').slice(0, 140),
        lines: (Array.isArray(e.lines) ? e.lines : []).slice(0, 4).map(l => String(l).slice(0, 110)) };
      if (e.work) rec.work = true;
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
      CFG = Object.assign({ level: 'important', auto: 0 }, v.cfg && typeof v.cfg === 'object' ? v.cfg : {});
      if (!LEVELS[CFG.level]) CFG.level = 'important';
      TG = v.tg && /^\d+:[\w-]{30,}$/.test(v.tg.token || '') ? { token: v.tg.token, bot: v.tg.bot || '', chat: v.tg.chat || 0 } : null;
      NTFY = v.ntfy && /^hotelops-[a-z0-9]{12,40}$/.test(v.ntfy.topic || '') ? { topic: v.ntfy.topic } : null;
      LOG = v.log && typeof v.log === 'object' ? v.log : {};
      const ids = Object.keys(LOG);
      if (seenIds) {
        const fresh = ids.filter(k => !seenIds.has(k)).map(k => LOG[k]).filter(e => e && Date.now() - (e.at || 0) < 10 * 60e3);
        if (fresh.length) alarm(fresh.sort((a, b) => a.at - b.at));
      }
      seenIds = new Set(ids);
      loaded = true;
      if (wasOn !== ST.on) { pushToReader(); told(); }
      render(); badge();
    });
  }
  function alarm(list) {
    list = list.filter(e => sev(e) >= LEVELS[CFG.level]); if (!list.length) return;
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
  // one visit = one story on the phone: the first alert, "still going" updates (at most one a minute),
  // and a summary when it has been quiet for 3 minutes. Minor things wait until something serious happens.
  let V = null, vUpd = 0, vEndT = 0, vQ = [];
  function ntfy(title, message, priority, tags) {
    if (!NTFY) return Promise.resolve(false);
    const url = location.origin + location.pathname + '#wa-guard';
    const body = JSON.stringify({ topic: NTFY.topic, title, message, priority: priority || 5, tags: tags || ['rotating_light'], click: url,
      actions: [{ action: 'view', label: 'Open HotelOps', url }] });
    return fetch('https://ntfy.sh/', { method: 'POST', body }).then(r => r.ok).catch(() => false);   // plain-text body: no pre-flight check
  }
  const evLine = e => (KIND[e.kind] || KIND.touch)[0] + ' ' + ((e.kind === 'search' || e.kind === 'type') && e.detail ? e.detail + (e.chat ? ' · ' + e.chat + (e.work ? ' (work)' : '') : '') : (KIND[e.kind] || KIND.touch)[1] + (e.chat ? ' · ' + e.chat + (e.work ? ' (work)' : '') : ''));
  function pushAlert(rec) {
    if (!ST.on || (rec.at || 0) < (ST.since || 0)) return;
    const t = rec.at || Date.now(), need = LEVELS[CFG.level];
    if (!V || t - V.end > SESSION_GAP) { if (V) endVisit(); V = { start: t, end: t, ev: [], told: false, top: 0 }; vQ = []; }
    V.ev.push(rec); V.end = t; V.top = Math.max(V.top, sev(rec)); vQ.push(rec);
    clearTimeout(vEndT); vEndT = setTimeout(() => endVisit(), SESSION_GAP);
    if (!V.told) {
      if (V.top < need) return;   // only minor things so far: wait
      setTimeout(() => {   // urgent: almost instant · lower: a moment to gather what happens together
        if (!V || V.told) return;
        V.told = true; vUpd = Date.now();
        const q = vQ.splice(0);
        notify(V.top >= 3 ? '🚨 Someone is on your WhatsApp' : '⚠️ Someone touched your WhatsApp PC',
          q.slice(-5).map(evLine).join('\n') + (q.length > 5 ? `\n+${q.length - 5} more` : '') + '\n' + clock(V.start), V.top >= 3 ? 5 : 4, ['rotating_light']);
      }, V.top >= 3 ? 400 : 1800);
      return;
    }
    // already told: an update at most once a minute, louder after 3 minutes
    if (Date.now() - vUpd < (sev(rec) >= 3 ? 20e3 : 60e3) || sev(rec) < need) return;
    setTimeout(() => {
      if (!V || !vQ.length) return;
      vUpd = Date.now();
      const q = vQ.splice(0).filter(e => sev(e) >= need);
      if (!q.length) return;
      const long = V.end - V.start > 3 * 60e3;
      notify(`⏱ Still on your WhatsApp · ${mins(Date.now() - V.start)}`, q.slice(-5).map(evLine).join('\n'), long ? 5 : 4, ['hourglass']);
    }, 400);
  }
  /** the visit is over (quiet 3 min, or you're back): one summary of what they did */
  function endVisit(back) {
    clearTimeout(vEndT);
    const v = V; V = null; vQ = [];
    if (!v || !v.told) return;
    const sum = visits(v.ev)[0]; if (!sum) return;
    notify(back ? '✅ You\'re back — here\'s what happened' : '✅ Activity on your WhatsApp stopped',
      [`${clock(v.start)}${clock(v.end) !== clock(v.start) ? '–' + clock(v.end) : ''} · ${mins(v.end - v.start)} · ${v.ev.length} action${v.ev.length === 1 ? '' : 's'}`].concat(storyOf(sum)).join('\n'), 3, ['white_check_mark']);
  }
  // ── Telegram: your own bot (made in 1 minute with @BotFather) sends the alerts to your Telegram ──
  const TGAPI = (tok, m) => 'https://api.telegram.org/bot' + tok + '/' + m;
  function tgCall(tok, m, params) {   // a form body: no pre-flight check
    return fetch(TGAPI(tok, m), { method: 'POST', body: new URLSearchParams(params || {}) }).then(r => r.json()).catch(() => ({ ok: false }));
  }
  function tgSend(title, message, priority) {
    if (!TG || !TG.chat) return Promise.resolve(false);
    const url = location.origin + location.pathname + '#wa-guard', p = { chat_id: TG.chat, parse_mode: 'HTML',
      text: `<b>${esc(title)}</b>\n${esc(message)}`, disable_notification: (priority || 5) <= 2 ? 'true' : 'false' };
    if (/^https:/.test(url)) p.reply_markup = JSON.stringify({ inline_keyboard: [[{ text: '🛡 Open HotelOps', url }]] });
    return tgCall(TG.token, 'sendMessage', p).then(j => !!(j && j.ok));
  }
  /** every alert goes to every way you set up — through the 📲 notification hub when it's loaded (category
   *  "guard": instant, never batched, never held by quiet hours; its log and switch), else straight out.
   *  opt.force: a test / a manual send (ignores the hub's switches) */
  function notify(title, message, priority, tags, opt) {
    const H = W.hoNotify;
    if (H && typeof H.send === 'function' && H.ready && H.ready()) {
      try {
        return Promise.resolve(H.send({ cat: 'guard', title, body: message, prio: priority || 5, tags: tags || ['rotating_light'], url: '#wa-guard',
          instant: true, ignoreQuiet: true, claimed: true, toast: false, force: !!(opt && opt.force) })).then(Boolean, () => false);
      } catch (_) {}
    }
    return Promise.all([ntfy(title, message, priority, tags), tgSend(title, message, priority)]).then(r => r.some(Boolean));
  }
  let tgWiz = null, tgPoll = 0;   // { step, token, bot, code, err }
  function tgStart() { tgWiz = { step: 1 }; render(); }
  async function tgToken() {
    const inp = document.getElementById('wgTok'), tok = String(inp && inp.value || '').trim().replace(/\s+/g, '');
    if (!/^\d+:[\w-]{30,}$/.test(tok)) { tgWiz.err = 'That doesn\'t look like a bot token. It looks like 123456789:AAH… — copy the whole line BotFather sent.'; return render(); }
    tgWiz.err = ''; tgWiz.busy = true; render();
    const j = await tgCall(tok, 'getMe');
    tgWiz.busy = false;
    if (!j || !j.ok) { tgWiz.err = 'Telegram didn\'t accept that token. Check you copied all of it, and that you\'re online.'; return render(); }
    const r = crypto.getRandomValues(new Uint8Array(6));
    Object.assign(tgWiz, { step: 3, token: tok, bot: j.result.username, code: 'ho' + [...r].map(x => x.toString(16).padStart(2, '0')).join('') });
    render(); tgWait();
  }
  /** wait for you to press Start in Telegram: that message tells us your chat */
  function tgWait() {
    clearTimeout(tgPoll);
    const w = tgWiz; if (!w || w.step !== 3) return;
    const t0 = w.t0 || (w.t0 = Date.now());
    tgCall(w.token, 'getUpdates', { offset: w.off || 0, timeout: 0, allowed_updates: '["message"]' }).then(j => {
      if (tgWiz !== w) return;
      (j && j.ok ? j.result : []).forEach(u => {
        w.off = u.update_id + 1;
        const m = u.message; if (!m || !m.chat) return;
        if (String(m.text || '').trim() === '/start ' + w.code) tgDone(m.chat.id, m.from && m.from.first_name);
      });
      if (tgWiz === w && w.step === 3) { if (Date.now() - t0 < 5 * 60e3) tgPoll = setTimeout(tgWait, 2000); else { w.err = 'No Start seen yet — tap "Open my bot" and press Start.'; w.t0 = 0; render(); } }
    });
  }
  function tgDone(chat, name) {
    const w = tgWiz; tgWiz = { step: 4 };
    TG = { token: w.token, bot: w.bot, chat };
    if (typeof fbSet === 'function' && uid()) fbSet(P('tg'), { token: w.token, bot: w.bot, chat, at: Date.now() });
    tgSend('✅ Connected to HotelOps', `Hi ${name || ''}! Away guard alerts will come here — even when your phone is locked.`, 4);
    render(); setTimeout(() => { if (tgWiz && tgWiz.step === 4) { tgWiz = null; render(); } }, 6000);
  }
  function tgCancel() { clearTimeout(tgPoll); tgWiz = null; render(); }
  function tgOff() { if (!confirm('Stop Telegram alerts?')) return; TG = null; if (typeof fbSet === 'function') fbSet(P('tg'), null); render(); }
  function tgPaste() { try { navigator.clipboard.readText().then(t => { const i = document.getElementById('wgTok'); if (i) { i.value = t.trim(); tgToken(); } }, () => {}); } catch (_) {} }

  function pushSetup() {
    if (!uid() || typeof fbSet !== 'function') return toast('Sign in first', 'err');
    const r = crypto.getRandomValues(new Uint8Array(16)), topic = 'hotelops-' + [...r].map(b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
    NTFY = { topic }; fbSet(P('ntfy'), { topic, at: Date.now() }); render();
  }
  function pushOff() { if (!confirm('Stop ntfy alerts?')) return; NTFY = null; if (typeof fbSet === 'function') fbSet(P('ntfy'), null); render(); }
  function pushCopy() { if (!NTFY) return; try { navigator.clipboard.writeText(NTFY.topic).then(() => toast('Copied ✓ — paste it in ntfy'), () => prompt('Copy this', NTFY.topic)); } catch (_) { prompt('Copy this', NTFY.topic); } }
  function pushTest() {
    notify('🧪 Test from HotelOps', 'Alerts work ✓ You\'ll get one here if someone uses your WhatsApp while you\'re away.', 4, ['shield'], { force: true })
      .then(ok => toast(ok ? 'Test sent — check your phone' : 'Could not send — check the internet and try again', ok ? 'ok' : 'err'));
  }
  const TG_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#29a9eb"/><path d="M5.4 11.8l11.3-4.4c.5-.2 1 .1.8.9l-1.9 9c-.1.6-.5.8-1 .5l-2.9-2.1-1.4 1.3c-.2.2-.3.3-.6.3l.2-3 5.4-4.9c.2-.2 0-.3-.3-.1l-6.7 4.2-2.9-.9c-.6-.2-.6-.6.1-.9z" fill="#fff"/></svg>';
  function pushHtml() {
    const w = tgWiz;
    if (w) {
      const dots = `<div class="wg-steps">${[1, 2, 3].map(i => `<i class="${(w.step >= i ? 'on' : '') + (w.step === i ? ' cur' : '')}"></i>`).join('')}</div>`;
      const err = w.err ? `<div class="wg-err">${esc(w.err)}</div>` : '';
      let body = '';
      if (w.step === 1) body = `<h4>Make your alert bot</h4><p>In Telegram, open <b>BotFather</b> and send <code>/newbot</code>. Give it any name, e.g. <i>My HotelOps Guard</i>, and a username ending in <i>bot</i>. BotFather replies with a <b>token</b> — copy it.</p>
        <a class="wg-tgbtn" href="https://t.me/BotFather" target="_blank" rel="noopener">${TG_SVG}Open BotFather</a>
        <button class="wg-next" onclick="hoWaGuard.tgStep(2)">I copied the token →</button>`;
      else if (w.step === 2) body = `<h4>Paste the token</h4><p>The long line from BotFather, like <code>123456789:AAH…</code></p>
        <div class="wg-tokrow"><input id="wgTok" class="input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="123456789:AAH…" value="${esc(w.token || '')}"><button class="btn sm" onclick="hoWaGuard.tgPaste()">Paste</button></div>
        ${err}<button class="wg-next" onclick="hoWaGuard.tgToken()" ${w.busy ? 'disabled' : ''}>${w.busy ? 'Checking…' : 'Check it →'}</button>`;
      else if (w.step === 3) body = `<h4>Say hi to your bot</h4><p>Tap the button, then press <b>Start</b> in Telegram. HotelOps connects by itself.</p>
        <a class="wg-tgbtn" href="https://t.me/${esc(w.bot)}?start=${esc(w.code)}" target="_blank" rel="noopener">${TG_SVG}Open @${esc(w.bot)}</a>
        <div class="wg-wait"><span class="wg-spin"></span>Waiting for you to press Start…</div>${err}`;
      else body = `<div class="wg-done"><span>✓</span><h4>Connected!</h4><p>Check Telegram — your bot just said hi. Alerts will pop up there, even when your phone is locked.</p></div>`;
      return `<div class="wg-push wg-wiz">${w.step < 4 ? dots : ''}${body}${w.step < 4 ? '<button class="wg-cancel" onclick="hoWaGuard.tgCancel()">Cancel</button>' : ''}</div>`;
    }
    const on = [];
    if (TG && TG.chat) on.push(`<div class="wg-ch on">${TG_SVG}<div><b>Telegram</b><small>@${esc(TG.bot)} · connected</small></div><button class="wg-chx" onclick="hoWaGuard.tgOff()" title="Turn off">✕</button></div>`);
    if (NTFY) on.push(`<div class="wg-ch on"><span class="wg-chi">📳</span><div><b>ntfy</b><small><code>${esc(NTFY.topic)}</code> <button class="wg-link" onclick="hoWaGuard.pushCopy()">copy</button></small></div><button class="wg-chx" onclick="hoWaGuard.pushOff()" title="Turn off">✕</button></div>`);
    const add = [];
    if (!(TG && TG.chat)) add.push(`<button class="wg-ch add best" onclick="hoWaGuard.tgStart()">${TG_SVG}<div><b>Telegram <em>best</em></b><small>Always pops up on iPhone · 1 minute</small></div><span class="wg-arrow">›</span></button>`);
    if (!NTFY) add.push(`<button class="wg-ch add" onclick="hoWaGuard.pushSetup()"><span class="wg-chi">📳</span><div><b>ntfy</b><small>No account · needs Background App Refresh</small></div><span class="wg-arrow">›</span></button>`);
    return `<div class="wg-push"><b>📲 Alerts on your phone</b>
      ${on.length ? on.join('') + `<button class="wg-test" onclick="hoWaGuard.pushTest()">🧪 Send a test</button>` : '<small>Get told even when your phone is locked and HotelOps is closed.</small>'}
      ${add.length ? `<div class="wg-add">${on.length ? '<small>Add another</small>' : ''}${add.join('')}</div>` : ''}
      ${NTFY && !(TG && TG.chat) ? '<small>ntfy: install it from the <a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noopener">App Store</a>, tap +, paste the code. Alerts only in the list? Turn on Background App Refresh for ntfy and don\'t swipe it closed — or use Telegram.</small>' : ''}
      <small class="wg-fine">Alerts say what happened and which chat — never the messages.</small></div>`;
  }
  /** someone is on it right now (something in the last 3 min while you're away) */
  function live() {
    if (!ST.on) return '';
    const recent = Object.values(LOG).filter(e => e && e.at >= ST.since && Date.now() - e.at < SESSION_GAP);
    if (!recent.length) return '';
    const v = visits(recent)[0];
    return `<div class="wg-live"><span class="wg-dot"></span><div><b>Someone is on your WhatsApp now</b><small>${esc(mins(Date.now() - v.start))} · ${esc(storyOf(v).join(' · ') || v.ev.length + ' actions')}</small></div></div>`;
  }
  function cfgHtml() {
    const seg = (k, opts) => `<div class="wg-seg">${opts.map(([v, l]) => `<button class="${String(CFG[k]) === String(v) ? 'on' : ''}" onclick="hoWaGuard.setCfg('${k}', ${typeof v === 'number' ? v : `'${v}'`})">${l}</button>`).join('')}</div>`;
    return `<details class="wg-cfg"${cfgOpen ? ' open' : ''}><summary>⚙️ Smart alerts</summary>
      <div class="wg-cfg-row"><b>What reaches your phone</b>${seg('level', [['urgent', '🚨 Urgent only'], ['important', '⚠️ Important'], ['all', 'Everything']])}
        <small>${CFG.level === 'urgent' ? 'Only a private chat opened or read, a search, typing, or the reader closed.' : CFG.level === 'important' ? 'Urgent things, plus someone touching the reader window. A click or your work groups alone don\'t buzz you.' : 'Every touch, including your work groups and a moved mouse.'} One visit = one story: the first alert, "still going" (at most once a minute), and a summary when they stop.</small></div>
      <div class="wg-cfg-row"><b>Auto-away</b>${seg('auto', [[0, 'Off'], [5, '5 min'], [10, '10 min'], [15, '15 min'], [30, '30 min']])}
        <small>Turns the guard on by itself when nobody has touched the WhatsApp PC for this long — for when you forget. Needs the reader pasted again once.</small></div>
    </details>`;
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
  /** the helper on this PC (wa-helper.js): it locks WhatsApp Web and Opera while you're away */
  function helperLine() {
    let st = 'none'; try { if (W.hoWaHelper && typeof W.hoWaHelper.status === 'function') st = W.hoWaHelper.status(); } catch (_) {}
    if (st === 'on') return '<div class="wg-ok">● Helper: on ✓ — WhatsApp Web and Opera lock while you\'re away</div>';
    if (st === 'off') return '<div class="wg-bad">● Helper: switched off ⚠ — no lock screens on this PC; your phone is told while you\'re away</div>';
    return '<div class="wg-warn">● Helper: not added on this browser — WhatsApp is still watched, but it can\'t be locked (📡 Opera → Get the helper)</div>';
  }
  function render() {
    const ov = document.getElementById('wgOv'); if (!ov || ov.hidden) return;
    cfgOpen = !!ov.querySelector('details.wg-cfg[open]') || cfgOpen === 'force';
    const since = ST.on && ST.since ? ST.since : 0;
    const all = Object.keys(LOG).map(k => Object.assign({ id: k }, LOG[k])).filter(e => e && e.at).sort((a, b) => b.at - a.at);
    const now = since ? all.filter(e => e.at >= since) : [];
    const earlier = all.filter(e => !since || e.at < since).slice(0, 40);
    const visitHtml = v => `<div class="wg-visit s${v.sev}"><div class="wg-vh"><b>${v.sev >= 3 ? '🚨' : v.sev === 2 ? '⚠️' : 'ℹ️'} ${esc(clock(v.start))}${v.end - v.start > 60e3 ? '–' + esc(clock(v.end)) : ''}</b><span>${esc(mins(v.end - v.start))} · ${v.ev.length} action${v.ev.length === 1 ? '' : 's'}</span></div>
      ${storyOf(v).length ? `<div class="wg-story">${storyOf(v).map(x => `<div>${esc(x)}</div>`).join('')}</div>` : ''}
      <details${v.sev >= 3 && Date.now() - v.end < 30 * 60e3 ? ' open' : ''}><summary>Step by step</summary>${v.ev.slice().reverse().map(row).join('')}</details></div>`;
    const row = e => { const k = KIND[e.kind] || KIND.touch; return `<div class="wg-ev wg-${esc(e.kind)}"><span class="wg-ic">${k[0]}</span><div class="wg-tx">
      <b>${esc(k[1])}${e.chat ? ` · <span class="wg-chat">${esc(e.chat)}</span>` : ''}</b><small>${esc(clock(e.at))} · ${esc(e.detail || '')}</small>
      ${(e.lines || []).length ? `<div class="wg-lines" title="What was on the screen">${e.lines.map(l => `<div>${esc(l)}</div>`).join('')}</div>` : ''}</div></div>`; };
    ov.innerHTML = `<div class="wg-sheet" role="dialog" aria-label="WhatsApp Away guard">
      <div class="wg-hd"><span class="wg-shield ${ST.on ? 'on' : ''}">🛡</span><div><b>WhatsApp Away guard</b><small>Tells you if someone uses your WhatsApp while you're away</small></div><button class="wg-x" onclick="hoWaGuard.close()" aria-label="Close">✕</button></div>
      <button class="wg-big ${ST.on ? 'on' : ''}" onclick="hoWaGuard.set(${!ST.on})">${ST.on ? `<b>I'm back</b><small>Watching since ${esc(clock(since))} · tap to stop</small>` : `<b>I'm away</b><small>Going on a break / DND? Tap and walk away (starts in 45 s)</small>`}</button>
      <div class="wg-pc">${pcLine()}${helperLine()}</div>
      ${live()}
      ${pushHtml()}
      ${cfgHtml()}
      ${ST.on ? `<div class="wg-sec">While you're away <span>${now.length}</span></div>${now.length ? visits(now).map(visitHtml).join('') : '<div class="wg-empty">✓ Nobody has touched your WhatsApp.</div>'}` : ''}
      ${earlier.length ? `<div class="wg-sec">Earlier <button class="wg-clear" onclick="hoWaGuard.clearLog()">Clear</button></div>${visits(earlier).slice(0, 15).map(visitHtml).join('')}` : ''}
      <div class="wg-how"><b>How it works</b> The WhatsApp reader on the desk PC watches only real mouse and keyboard use, never its own. You see the chat they opened, what was on the screen while they scrolled, what they searched, and if they typed or closed the reader. Set up 📲 lock-screen alerts above to get them even when your phone is locked. Messages shown here are saved under your account only.</div>
    </div>`;
  }
  function badge() {
    const n = ST.on ? Object.values(LOG).filter(e => e && e.at >= ST.since).length : 0;
    document.querySelectorAll('[data-wg-badge]').forEach(el => { el.textContent = n || ''; el.hidden = !n; });
    document.documentElement.classList.toggle('wg-away', !!ST.on);
    try { renderAway(); } catch (_) {}
  }
  function toast(m, t) { if (typeof showToast === 'function') showToast(m, t); }


  // ── 🛡 "I'm away" for everything, one click: a button in the top bar (on phones a shield there, and the first thing in
  // More), Ctrl+Alt+L, and the voice command. Away = this guard + Opera's lock screen + WhatsApp's lock screen (the shared
  // 'ho-away'); "I'm back" ends all three. No PIN yet → it asks for one first (it unlocks both lock screens at the desk).
  /** what the button shows: off "🛡 I'm away" · on "🔒 Away · tap when back" (a pulsing dot) */
  function awayView(on) {
    return on ? { on: true, icon: '🔒', label: 'Away · tap when back', title: 'You\'re away: WhatsApp is watched, Opera and WhatsApp Web are locked at the desk. Tap when you\'re back (Ctrl+Alt+L)' }
      : { on: false, icon: '🛡', label: 'I\'m away', title: 'I\'m away: watch WhatsApp and lock Opera + WhatsApp Web at the desk, one tap (Ctrl+Alt+L)' };
  }
  const isPhone = () => { try { return W.matchMedia && W.matchMedia('(pointer: coarse)').matches; } catch (_) { return false; } };
  /** one tap: on (or off) for all. on == null → the other way round */
  function awayAll(on, how) {
    if (!uid()) { toast('Sign in first', 'err'); return false; }
    on = on == null ? !ST.on : !!on;
    const O = W.hoOpera && W.hoOpera.guard;
    if (!on) {
      if (O && typeof O.unlock === 'function') O.unlock(); else set(false);   // Opera's Unlock ends Away too: all three
      renderAway(); return true;
    }
    if (ST.on) { renderAway(); return true; }
    const st = O && typeof O.state === 'function' ? O.state() : null;
    if (st && !st.pin && typeof O.pinDialog === 'function') {   // the first time: a PIN, then Away
      toast('Set your PIN first (4–6 digits): it unlocks Opera and WhatsApp Web at the desk', 'info');
      O.pinDialog(() => awayAll(true, how));
      return false;
    }
    set(true);
    if (O && typeof O.sync === 'function') O.sync();
    const hs = W.hoWaHelper && typeof W.hoWaHelper.status === 'function' ? W.hoWaHelper.status() : 'none';
    if (hs !== 'on' && !isPhone()) setTimeout(() => toast('Opera/WhatsApp tabs can\'t lock without the helper — get it on the 📡 Opera page', 'warn'), 60);
    renderAway(); return true;
  }
  function renderAway() {
    const v = awayView(!!ST.on), bar = document.querySelector('.topbar .topbar-right');
    let b = document.getElementById('tbAway');
    if (!b && bar) {
      b = document.createElement('button'); b.type = 'button'; b.id = 'tbAway'; b.className = 'tb-away';
      b.addEventListener('click', () => awayAll(null, 'bar'));
      bar.insertBefore(b, document.getElementById('tbWhatsApp') || bar.firstChild);
    }
    if (b) fitAway(b, bar);
    if (b) {
      const sig = v.on ? 'on' : 'off';
      if (b.dataset.st !== sig) {
        b.dataset.st = sig; b.classList.toggle('on', v.on); b.title = v.title; b.setAttribute('aria-pressed', String(v.on));
        b.setAttribute('aria-label', v.on ? 'Away is on — tap when you are back' : 'I\'m away');
        b.innerHTML = `${v.on ? '<i class="tba-dot" aria-hidden="true"></i>' : ''}<span class="tba-ic" aria-hidden="true">${v.icon}</span><span class="tba-l">${esc(v.label)}</span>`;
      }
    }
    // phones: the first thing in More, too
    const drawer = document.getElementById('mobMoreDrawer'), grid = drawer && drawer.querySelector('.mob-more-grid');
    let m = document.getElementById('mobAway');
    if (!m && grid) {
      m = document.createElement('button'); m.type = 'button'; m.id = 'mobAway'; m.className = 'mob-away';
      m.addEventListener('click', () => { awayAll(null, 'more'); try { if (typeof closeMobMore === 'function') closeMobMore(); } catch (_) {} });
      grid.parentNode.insertBefore(m, grid.parentNode.querySelector('.mob-more-search') || grid);
    }
    if (m && m.dataset.st !== (v.on ? 'on' : 'off')) {
      m.dataset.st = v.on ? 'on' : 'off'; m.classList.toggle('on', v.on);
      m.innerHTML = `${v.on ? '<i class="tba-dot" aria-hidden="true"></i>' : ''}<span class="tba-ic" aria-hidden="true">${v.icon}</span><span><b>${esc(v.on ? 'Away · tap when you\'re back' : 'I\'m away')}</b><small>${v.on ? 'WhatsApp watched · Opera and WhatsApp Web locked' : 'One tap: watch WhatsApp, lock Opera + WhatsApp Web'}</small></span>`;
    }
  }
  /** a narrow desktop: the bar's icons would be pushed off the edge → just the shield (and the dot when on), as on phones */
  function fitAway(b, bar) {
    try {
      if (!bar || !b.isConnected || !bar.lastElementChild || !b.getBoundingClientRect) return;
      const tb = bar.closest ? bar.closest('.topbar') : null;
      b.classList.remove('compact'); if (tb) tb.classList.remove('tb-crowded');
      const vw = W.innerWidth || document.documentElement.clientWidth;
      const over = () => { const last = [...bar.children].filter(c => c.offsetWidth).pop(); return !!last && last.getBoundingClientRect().right > vw + 1; };
      if (over()) b.classList.add('compact');
      if (over() && tb) tb.classList.add('tb-crowded');   // still too full: the database pill shows only its dot (its words are in its title)
    } catch (_) {}
  }
  W.addEventListener && W.addEventListener('resize', () => { const b = document.getElementById('tbAway'); if (b) fitAway(b, document.querySelector('.topbar .topbar-right')); });
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey && !e.repeat && (e.code === 'KeyL' || /^[lL¬]$/.test(e.key || ''))) { e.preventDefault(); awayAll(null, 'key'); }
  });
  setTimeout(renderAway, 600); setInterval(renderAway, 5000);

  // start once someone is signed in; the PC tab checks in every 30 s while you're away
  const boot = setInterval(() => { if (uid()) { clearInterval(boot); start(); } }, 1500);
  setInterval(beat, 30000);
  setInterval(() => { if (ST.on && document.getElementById('wgOv') && !document.getElementById('wgOv').hidden && !document.querySelector('#wgOv details.wg-cfg[open]') && !tgWiz) render(); }, 20000);   // live banner and times
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
.wg-live{display:flex;gap:12px;align-items:center;padding:12px 14px;border-radius:16px;background:color-mix(in srgb,var(--rose,#e11d48) 14%,transparent);border:1px solid color-mix(in srgb,var(--rose,#e11d48) 45%,transparent)}.wg-live>div{display:flex;flex-direction:column;min-width:0}.wg-live b{color:var(--rose,#e11d48);font-size:14.5px}.wg-live small{font-size:12.5px;color:var(--text2);overflow-wrap:anywhere}
.wg-dot{width:12px;height:12px;flex:none;border-radius:50%;background:var(--rose,#e11d48);box-shadow:0 0 0 0 var(--rose,#e11d48);animation:wgPulse 1.4s infinite}@keyframes wgPulse{70%{box-shadow:0 0 0 10px transparent}100%{box-shadow:0 0 0 0 transparent}}
.wg-visit{display:flex;flex-direction:column;gap:6px;padding:12px;border-radius:16px;background:var(--card);border:1px solid var(--border);border-left:4px solid var(--border2)}.wg-visit.s3{border-left-color:var(--rose,#e11d48)}.wg-visit.s2{border-left-color:var(--amber,#d97706)}
.wg-vh{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.wg-vh b{font-size:14.5px}.wg-vh span{color:var(--text3);font-size:12.5px}
.wg-story{display:flex;flex-direction:column;gap:2px;font-size:13px;color:var(--text);overflow-wrap:anywhere}
.wg-visit details summary,.wg-cfg summary{cursor:pointer;color:var(--accent);font-size:12.5px;font-weight:600}.wg-visit details[open]{display:flex;flex-direction:column;gap:6px}
.wg-cfg{padding:12px 14px;border-radius:16px;background:var(--card);border:1px solid var(--border)}.wg-cfg summary{font-size:14px;color:var(--text);font-weight:700}
.wg-cfg-row{display:flex;flex-direction:column;gap:6px;margin-top:12px;font-size:13px}.wg-cfg-row small{color:var(--text3);font-size:12px;line-height:1.45}
.wg-seg{display:flex;gap:4px;padding:3px;border-radius:12px;background:var(--bg2);flex-wrap:wrap}.wg-seg button{flex:1 1 auto;min-width:0;padding:7px 8px;border:0;border-radius:9px;background:transparent;color:var(--text2);font:600 12.5px var(--font);cursor:pointer}.wg-seg button.on{background:var(--card);color:var(--accent);box-shadow:0 1px 4px rgba(0,0,0,.12)}
.wg-ch{display:flex;align-items:center;gap:12px;width:100%;padding:11px 12px;border-radius:14px;border:1px solid var(--border);background:var(--bg2);color:var(--text);text-align:left;font:inherit;cursor:pointer;box-sizing:border-box}
.wg-ch svg,.wg-chi{width:34px;height:34px;flex:none;display:grid;place-items:center;font-size:24px}.wg-ch>div{flex:1;min-width:0;display:flex;flex-direction:column}.wg-ch b{font-size:14.5px}.wg-ch em{font-style:normal;font-size:10.5px;font-weight:800;color:#fff;background:#29a9eb;border-radius:99px;padding:1px 7px;margin-left:6px;vertical-align:2px}
.wg-ch small{overflow-wrap:anywhere}.wg-ch.on{background:color-mix(in srgb,var(--mint,#22c55e) 10%,var(--card));border-color:color-mix(in srgb,var(--mint,#22c55e) 40%,transparent)}.wg-ch.add.best{border-color:#29a9eb;box-shadow:0 6px 18px -10px #29a9eb}
.wg-ch.add:active{transform:scale(.985)}.wg-arrow{font-size:24px;color:var(--text3)}.wg-chx{width:32px;height:32px;border-radius:10px;border:0;background:transparent;color:var(--text3);cursor:pointer;font-size:14px}
.wg-add{display:flex;flex-direction:column;gap:8px}.wg-link{border:0;background:none;color:var(--accent);font:inherit;cursor:pointer;padding:0}.wg-fine{opacity:.8}
.wg-test{align-self:stretch;padding:11px;border-radius:12px;border:1px dashed var(--border2);background:transparent;color:var(--accent);font:700 14px var(--font);cursor:pointer}
.wg-wiz{align-items:stretch;gap:10px;padding:16px}.wg-wiz h4{margin:0;font-size:17px}.wg-wiz p{margin:0;color:var(--text2);font-size:13.5px;line-height:1.5}.wg-wiz code{background:var(--bg2);padding:1px 5px;border-radius:6px;font-size:12.5px}
.wg-steps{display:flex;gap:6px}.wg-steps i{flex:1;height:5px;border-radius:99px;background:var(--border)}.wg-steps i.on{background:#29a9eb}.wg-steps i.cur{box-shadow:0 0 0 3px color-mix(in srgb,#29a9eb 25%,transparent)}
.wg-tgbtn{display:flex;align-items:center;justify-content:center;gap:10px;padding:13px;border-radius:14px;background:#29a9eb;color:#fff !important;font:700 15px var(--font);text-decoration:none;box-shadow:0 10px 24px -12px #29a9eb}.wg-tgbtn svg{width:24px;height:24px}.wg-tgbtn svg circle{fill:#fff}.wg-tgbtn svg path{fill:#29a9eb}
.wg-next{padding:13px;border-radius:14px;border:0;background:var(--accent);color:#fff;font:700 15px var(--font);cursor:pointer}.wg-next:disabled{opacity:.6}
.wg-cancel{align-self:center;border:0;background:none;color:var(--text3);font:600 13px var(--font);cursor:pointer}
.wg-tokrow{display:flex;gap:8px}.wg-tokrow input{flex:1;min-width:0;font:500 15px var(--mono,monospace)}
.wg-err{color:var(--rose,#e11d48);font-size:13px;line-height:1.4}
.wg-wait{display:flex;align-items:center;gap:10px;justify-content:center;color:var(--text2);font-size:13.5px}.wg-spin{width:16px;height:16px;border-radius:50%;border:2.5px solid var(--border2);border-top-color:#29a9eb;animation:wgSpin .8s linear infinite}@keyframes wgSpin{to{transform:rotate(360deg)}}
.wg-done{display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;padding:8px 0}.wg-done span{width:56px;height:56px;border-radius:50%;display:grid;place-items:center;font-size:28px;color:#fff;background:linear-gradient(135deg,#22c55e,#16a34a);animation:wgPop .5s cubic-bezier(.34,1.56,.64,1)}@keyframes wgPop{from{transform:scale(.3)}}
.wg-empty{padding:14px;text-align:center;color:var(--mint,#16a34a);font-weight:600;font-size:13.5px}
.wg-how{margin-top:6px;font-size:12px;line-height:1.5;color:var(--text3)}.wg-how b{display:block;color:var(--text2);margin-bottom:2px}

.tb-away{touch-action:manipulation;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px 0 9px;border-radius:99px;border:1px solid color-mix(in srgb,var(--accent,#6366f1) 45%,var(--border2));background:color-mix(in srgb,var(--accent,#6366f1) 10%,var(--surface,transparent));color:var(--text);font:700 12px var(--font,system-ui);white-space:nowrap;flex-shrink:0;cursor:pointer;position:relative;transition:background .15s,border-color .15s,transform .1s}
.tb-away:hover{background:color-mix(in srgb,var(--accent,#6366f1) 18%,var(--surface,transparent))}.tb-away:active{transform:scale(.96)}
.tb-away:focus-visible{outline:2px solid var(--accent,#6366f1);outline-offset:2px}
.tb-away .tba-ic{font-size:13px;line-height:1}
.tb-away.on{color:#fff;border-color:transparent;background:linear-gradient(135deg,#e11d48,#f59e0b);box-shadow:0 6px 16px -8px #e11d48}
.tba-dot{width:8px;height:8px;flex:none;border-radius:50%;background:#fff;box-shadow:0 0 0 0 rgba(255,255,255,.8);animation:tbaPulse 1.6s infinite}
@keyframes tbaPulse{70%{box-shadow:0 0 0 7px rgba(255,255,255,0)}100%{box-shadow:0 0 0 0 rgba(255,255,255,0)}}
[data-theme="opera"] .tb-away:not(.on){color:#fff;border-color:rgba(255,255,255,.3);background:rgba(255,255,255,.12)}
.mob-away{display:flex;align-items:center;gap:12px;width:calc(100% - 24px);margin:4px 12px 10px;padding:12px 14px;border-radius:16px;border:1px solid color-mix(in srgb,var(--accent,#6366f1) 40%,var(--border2));background:color-mix(in srgb,var(--accent,#6366f1) 10%,var(--card));color:var(--text);text-align:left;font:inherit;cursor:pointer;box-sizing:border-box}
.mob-away .tba-ic{font-size:22px}.mob-away>span:last-child{display:flex;flex-direction:column;min-width:0}.mob-away b{font-size:14.5px}.mob-away small{font-size:12px;color:var(--text3)}
.mob-away.on{color:#fff;border-color:transparent;background:linear-gradient(135deg,#e11d48,#f59e0b)}.mob-away.on small{color:rgba(255,255,255,.88)}
.topbar.tb-crowded #fbLabel{display:none}.topbar.tb-crowded .fb-status{padding:3px 6px}
@media (max-width:768px){.topbar.tb-crowded #topbarTime{display:none !important}}
.tb-away.compact{width:30px;padding:0;justify-content:center;gap:0}.tb-away.compact .tba-l{display:none}.tb-away.compact.on .tba-dot{position:absolute;top:-2px;right:-2px;width:9px;height:9px;background:#fff;border:2px solid #e11d48;box-sizing:border-box}
@media (max-width:768px){.tb-away{width:44px;height:44px;min-width:44px;padding:0;justify-content:center;gap:0;font-size:17px;border-radius:14px;z-index:5}.tb-away .tba-ic{font-size:18px}.tb-away .tba-l{display:none}.tb-away.on .tba-dot{position:absolute;top:2px;right:2px;width:10px;height:10px;background:#fff;border:2px solid #e11d48;box-sizing:border-box}}
@media (prefers-reduced-motion:reduce){.tba-dot{animation:none}}`;
  document.head.appendChild(css);

  if (/wa-guard/.test(location.hash)) setTimeout(() => { open(); try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {} }, 1800);   // tapped a lock-screen alert

  W.hoWaGuard = { basic, awayAll, awayView, renderAway, tgStart, tgToken, tgPaste, tgCancel, tgOff, tgStep: n => { if (tgWiz) { tgWiz.step = n; tgWiz.err = ''; render(); setTimeout(() => document.getElementById('wgTok')?.focus(), 50); } }, notify, open, close, set, setCfg, state, fromReader, clearLog, render, sev, visits, pushSetup, pushOff, pushCopy, pushTest, _st: () => ({ ST, LOG, BEAT }),
    /** the ways to the phone you set up here (the notification hub sends through the same ones) */
    channels: () => ({ tg: TG && TG.chat ? Object.assign({}, TG) : null, ntfy: NTFY ? Object.assign({}, NTFY) : null }) };
})(window);

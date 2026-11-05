// ═══════════════════════════════════════════════════════════
//  team-chat.js — 💬 Team chat, the WhatsApp way
//  Chats list (search · All / Unread / Groups / Direct · unread counts · last message · typing… · muted · pinned),
//  the whole-team group, your own groups (create in two taps: pick people → name + emoji; info, admins, add / remove, leave)
//  and direct chats. In a chat: ✓ sent · ✓✓ delivered · blue ✓✓ seen (Message info: who read it), "typing…", online /
//  last seen, reply (swipe right on the phone), emoji reactions, edit (15 min), delete for everyone, forward, copy, star,
//  pin, search, @mentions, emoji, photos and voice notes. Two panes on PC (like WhatsApp Web), one screen at a time on the phone.
//  Stored per hotel: hotels/<hotel>/chat/{convs, msgs/<chat>, reads, dlv, typing, presence, files}. The last 500 messages of a chat are kept.
// ═══════════════════════════════════════════════════════════
(function () {
  'use strict';
  const W = window, D = document, KEEP = 500, EDIT_MIN = 15;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safe = (f, d) => { try { return f(); } catch (_) { return d; } };
  const toast = (m, k) => safe(() => showToast(m, k || 'ok'));
  const hid = () => safe(() => String(HOTEL_ID || ''), '');
  const me = () => safe(() => ({ uid: (currentUser && currentUser.uid) || 'me', name: (currentProfile && currentProfile.name) || 'Me', role: (currentProfile && currentProfile.role) || '' }), { uid: 'me', name: 'Me', role: '' });
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const LSg = (k, d) => safe(() => { const v = JSON.parse(localStorage.getItem(k + '_' + hid()) || 'null'); return v == null ? d : v; }, d);
  const LSs = (k, v) => safe(() => localStorage.setItem(k + '_' + hid(), JSON.stringify(v)));
  const EMO = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
  const PICK = '😀😁😂🤣😊😍😘😎🤔😴😅😉🙂🙃😇🥳😢😭😡🤯👍👎👏🙌🙏💪👌✌️🤝👋🔥⭐✅❌⚠️❗❓💯🎉💡📌🛏️🧳🚕💳🧾🔑☕🍽️🧹🔧📞⏰✈️🏨'.match(/\p{Extended_Pictographic}(️)?(‍\p{Extended_Pictographic}️?)*/gu);
  const GEMO = ['👥', '🛎️', '🌙', '☀️', '🧹', '🔧', '💳', '🍽️', '🏨', '⭐', '🚕', '📣'];
  const S = { convs: {}, msgs: {}, reads: {}, dlv: {}, typing: {}, pres: {}, users: {}, cur: '', reply: null, edit: null, filter: 'all', q: '', open: false, files: {}, loading: {}, started: 0, seenMsg: {} };

  // ── pure helpers (tested) ──
  /** the members of a chat: the whole team for the team group (every active user), else its own list (pure) */
  function membersOf(c, users) { if (!c) return []; if (c.all) return Object.keys(users || {}).filter(u => users[u] && users[u].active !== false); return Object.keys(c.members || {}).filter(u => c.members[u]); }
  /** the ticks of my message: 'read' (blue ✓✓) when everyone else read it, 'dlv' (✓✓) when everyone has it, else 'sent' (✓) (pure) */
  function ticks(m, others, reads, dlv) {
    if (!others.length) return 'read';
    if (others.every(u => (+(reads || {})[u] || 0) >= m.at)) return 'read';
    if (others.every(u => Math.max(+(dlv || {})[u] || 0, +(reads || {})[u] || 0) >= m.at)) return 'dlv';
    return 'sent';
  }
  /** unread in a chat: messages from others after my read (pure) */
  function unreadIn(list, myUid, readAt) { return (list || []).filter(m => m && !m.del && m.uid !== myUid && m.at > (readAt || 0)).length; }
  /** a direct chat's id: the same for both people (pure) */
  const dmId = (a, b) => 'dm_' + [a, b].sort().join('_').replace(/[.#$[\]/]/g, '');
  /** text → safe HTML: room numbers and links clickable, @mentions highlighted, *bold* (pure) */
  function richText(t) {
    return esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, '$1<b>$2</b>')
      .replace(/(^|[^\w/@])@([A-Za-z؀-ۿ][\w؀-ۿ.-]{1,30})/g, '$1<span class="wc-at">@$2</span>')
      .replace(/(^|[^\w#/:.])(\d{3,4})(?![\w:./])/g, '$1<button type="button" class="tc-room" data-room="$2">$2</button>').replace(/\n/g, '<br>');
  }
  /** "online", "last seen today at 10:42", "last seen yesterday at 22:10" (pure) */
  function lastSeen(at, now) {
    if (!at) return ''; now = now || Date.now(); if (now - at < 60000) return 'online';
    const d = new Date(at), n = new Date(now), y = new Date(now); y.setDate(n.getDate() - 1);
    const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return 'last seen ' + (d.toDateString() === n.toDateString() ? 'today at ' + t : d.toDateString() === y.toDateString() ? 'yesterday at ' + t : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' at ' + t);
  }
  /** who is typing in a chat, besides me (pure) */
  function typers(tp, myUid, users, now) { return Object.keys(tp || {}).filter(u => u !== myUid && (now || Date.now()) - (+tp[u] || 0) < 6000).map(u => ((users[u] && users[u].name) || 'Someone').split(' ')[0]); }

  // ── data ──
  const P = p => 'chat/' + p;
  const hm = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const dayLbl = t => { const d = new Date(t), n = new Date(), y = new Date(); y.setDate(n.getDate() - 1); return d.toDateString() === n.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }); };
  const listTime = t => { const d = new Date(t), n = new Date(), y = new Date(); y.setDate(n.getDate() - 1); return d.toDateString() === n.toDateString() ? hm(t) : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric' }); };
  const nameOf = u => (S.users[u] && S.users[u].name) || (u === me().uid ? me().name : 'Someone');
  const COLORS = ['#e65100', '#6a1b9a', '#00838f', '#c2185b', '#2e7d32', '#1565c0', '#ad1457', '#5d4037', '#00695c', '#4527a0'];
  const colorOf = u => COLORS[[...String(u)].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
  const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const convs = () => {
    const my = me().uid, out = [];
    out.push(Object.assign({ id: 'team', type: 'group', all: true, name: 'Whole team', icon: '🏨', desc: 'Everyone in the hotel' }, S.convs.team || {}, { id: 'team', all: true }));
    Object.entries(S.convs).forEach(([id, c]) => { if (id === 'team' || !c || c.gone) return; if ((c.members || {})[my]) out.push(Object.assign({ id }, c)); });
    return out;
  };
  const convOf = id => convs().find(c => c.id === id) || null;
  const msgsOf = id => S.msgs[id] || [];
  const lastOf = id => { const L = msgsOf(id); return L[L.length - 1] || null; };
  const titleOf = c => c.type === 'dm' ? nameOf(Object.keys(c.members || {}).find(u => u !== me().uid) || '') : (c.name || 'Group');
  const avatar = (c, size) => {
    const s = size || 46;
    if (c.type === 'dm') { const o = Object.keys(c.members || {}).find(u => u !== me().uid) || ''; return `<span class="wc-av" style="--s:${s}px;background:${colorOf(o)}">${esc(initials(nameOf(o)))}</span>`; }
    return `<span class="wc-av wc-av-g" style="--s:${s}px">${esc(c.icon || '👥')}</span>`;
  };
  const muted = id => !!LSg('ho_wc_mute', {})[id];
  const starred = () => LSg('ho_wc_star', {});
  const myRead = id => +((S.reads[id] || {})[me().uid]) || 0;
  const unread = id => unreadIn(msgsOf(id), me().uid, myRead(id));

  // ── writing ──
  async function ensureConv(c) { if (!S.convs[c.id] && c.id !== 'team') { const o = Object.assign({}, c); delete o.id; S.convs[c.id] = o; await safe(() => fbSet(P('convs/' + c.id), o)); } }
  async function send(text, extra) {
    const c = convOf(S.cur || 'team'); if (!c) return;
    text = String(text || '').replace(/\s+$/, '').slice(0, 2000);
    if (!text.trim() && !(extra && extra.file)) return;
    if (S.edit) { const m = S.edit; S.edit = null; bar(); if (text !== m.text) await safe(() => fbUpdate(P(`msgs/${c.id}/${m.k}`), { text, edited: Date.now() })); return; }
    const u = me(), at = Date.now(), k = at.toString(36) + Math.random().toString(36).slice(2, 6);
    const msg = Object.assign({ at, uid: u.uid, name: String(u.name).slice(0, 40), text }, extra || {});
    if (S.reply) { msg.reply = { k: S.reply.k, name: S.reply.name, text: (S.reply.text || (S.reply.file ? (S.reply.file.kind === 'img' ? '📷 Photo' : '🎤 Voice message') : '')).slice(0, 140) }; S.reply = null; bar(); }
    const mention = {}; (text.match(/@([\w؀-ۿ.-]{2,30})/g) || []).forEach(w => { const n = w.slice(1).toLowerCase(); Object.keys(S.users).forEach(uid => { if (String(nameOf(uid)).toLowerCase().split(' ')[0] === n) mention[uid] = true; }); });
    if (Object.keys(mention).length) msg.at_ = mention;
    await ensureConv(c);
    (S.msgs[c.id] = S.msgs[c.id] || []).push(Object.assign({ k }, msg)); markRead(c.id); render();
    try { await fbSet(P(`msgs/${c.id}/${k}`), msg); await fbUpdate(P('convs/' + c.id), { last: { at, uid: u.uid, name: msg.name, text: text ? text.slice(0, 120) : (msg.file.kind === 'img' ? '📷 Photo' : '🎤 Voice message') } }); } catch (_) { toast('Message not sent — check the connection', 'err'); }
    safe(() => fbSet(P(`typing/${c.id}/${u.uid}`), null));
    const L = msgsOf(c.id); if (L.length > KEEP) L.slice(0, L.length - KEEP).forEach(m => { safe(() => fbSet(P(`msgs/${c.id}/${m.k}`), null)); if (m.file && m.file.fid) safe(() => fbSet(P('files/' + m.file.fid), null)); });
  }
  function markRead(id) { const L = msgsOf(id), t = L.length ? L[L.length - 1].at : 0; if (t > myRead(id)) { (S.reads[id] = S.reads[id] || {})[me().uid] = t; safe(() => fbSet(P(`reads/${id}/${me().uid}`), t)); } badge(); }
  function markDelivered() { const my = me().uid; Object.keys(S.msgs).forEach(id => { if (!convOf(id)) return; /* only the chats I am in */ const L = S.msgs[id], t = L.length ? L[L.length - 1].at : 0; if (t && t > (+((S.dlv[id] || {})[my]) || 0)) { (S.dlv[id] = S.dlv[id] || {})[my] = t; safe(() => fbSet(P(`dlv/${id}/${my}`), t)); } }); }
  let typingAt = 0;
  function typing() { if (!S.cur || Date.now() - typingAt < 2500) return; typingAt = Date.now(); safe(() => fbSet(P(`typing/${S.cur}/${me().uid}`), Date.now())); }
  function presence() { if (D.visibilityState === 'hidden') return; safe(() => fbSet(P('presence/' + me().uid), Date.now())); }

  // ── the window ──
  function shell() {
    let w = D.getElementById('tcPanel'); if (w) return w;
    css(); w = D.createElement('div'); w.id = 'tcPanel'; w.className = 'tc wc';
    w.innerHTML = `<div class="tc-bg" data-wc="close"></div><section class="wc-win" role="dialog" aria-label="Team chat">
      <div class="wc-side"><header class="wc-sh"><b>Chats</b><span><button type="button" class="wc-ib" data-wc="newgroup" title="New group" aria-label="New group">👥＋</button><button type="button" class="wc-ib" data-wc="newchat" title="New chat" aria-label="New chat">✏️</button><button type="button" class="wc-ib wc-x" data-wc="close" title="Close" aria-label="Close">✕</button></span></header>
        <label class="wc-search"><span>🔎</span><input type="search" id="wcQ" placeholder="Search or start a new chat" autocomplete="off"></label>
        <div class="wc-filters">${[['all', 'All'], ['unread', 'Unread'], ['groups', 'Groups'], ['dm', 'Direct']].map(([k, l]) => `<button type="button" data-wcf="${k}">${l}</button>`).join('')}</div>
        <div class="wc-list" id="wcList"></div></div>
      <div class="wc-main" id="wcMain"><div class="wc-empty"><div>💬</div><b>HotelOps Team chat</b><span>Messages for your hotel's team — groups, direct chats, ticks, replies and reactions, live on every PC and phone.</span></div></div>
    </section><div class="wc-pop-layer" id="wcLayer"></div>`;
    D.body.appendChild(w);
    w.addEventListener('click', onClick);
    w.querySelector('#wcQ').addEventListener('input', e => { S.q = e.target.value; renderList(); });
    w.addEventListener('contextmenu', e => { const b = e.target.closest('.wc-msg'); if (b && !e.target.closest('a')) { e.preventDefault(); msgMenu(b.dataset.k, b); } });
    // phone: long-press a message for its menu, swipe it right to reply
    let lp = 0, sx = 0, sy = 0, sw = null;
    w.addEventListener('touchstart', e => { const b = e.target.closest('.wc-msg'); if (!b) return; sx = e.touches[0].clientX; sy = e.touches[0].clientY; sw = b; lp = setTimeout(() => { lp = 0; sw = null; msgMenu(b.dataset.k, b); safe(() => navigator.vibrate(15)); }, 480); }, { passive: true });
    w.addEventListener('touchmove', e => { if (!sw) return; const dx = e.touches[0].clientX - sx, dy = Math.abs(e.touches[0].clientY - sy); if (dy > 12 || Math.abs(dx) > 12) { clearTimeout(lp); lp = 0; } if (dx > 0 && dy < 30) sw.style.transform = `translateX(${Math.min(70, dx)}px)`; }, { passive: true });
    w.addEventListener('touchend', e => { clearTimeout(lp); if (!sw) return; const dx = (e.changedTouches[0].clientX - sx); sw.style.transform = ''; if (dx > 60) startReply(sw.dataset.k); sw = null; });
    D.addEventListener('keydown', e => { if (e.key === 'Escape' && S.open) { if (D.querySelector('#wcLayer > *')) { closeLayer(); return; } if (S.reply || S.edit) { S.reply = S.edit = null; bar(); return; } close(); } });
    return w;
  }
  function open(id) {
    const w = shell(); D.getElementById('tcPop')?.remove();
    w.classList.add('on'); S.open = true; w.classList.toggle('wc-dark', isDark()); D.documentElement.classList.add('wc-lock'); fitViewport();
    if (id) openChat(id); else if (!S.cur && matchMedia('(min-width: 769px)').matches) openChat('team'); else render();
  }
  // iPhone Safari: when the keyboard opens it scrolls the page and a full-screen window slides up (its top goes under the notch, the
  // page shows below it). The window is sized to the part of the screen you can see, and the page is put back when the keyboard closes.
  function fitViewport() {
    const w = D.getElementById('tcPanel'), vv = W.visualViewport; if (!w) return;
    if (vv) { w.style.setProperty('--vvh', Math.round(vv.height) + 'px'); w.style.setProperty('--vvt', Math.round(vv.offsetTop) + 'px'); }
  }
  if (W.visualViewport) { W.visualViewport.addEventListener('resize', () => S.open && fitViewport()); W.visualViewport.addEventListener('scroll', () => S.open && fitViewport()); }
  D.addEventListener('focusout', e => { if (S.open && e.target && e.target.closest && e.target.closest('#tcPanel')) setTimeout(() => { if (!D.activeElement || !D.activeElement.closest || !D.activeElement.closest('#tcPanel textarea, #tcPanel input')) { W.scrollTo(0, 0); fitViewport(); } }, 60); });
  function close() { const w = D.getElementById('tcPanel'); D.documentElement.classList.remove('wc-lock'); W.scrollTo(0, 0); if (w) w.classList.remove('on'); S.open = false; badge(); }
  const isDark = () => { const t = D.documentElement.dataset.theme; return t && t !== 'opera'; };
  function openChat(id) {
    S.cur = id; S.reply = S.edit = null; S.search = '';
    const w = shell(); w.classList.add('wc-in');
    const c = convOf(id); if (!c) return;
    D.getElementById('wcMain').innerHTML = `<header class="wc-ch"><button type="button" class="wc-ib wc-back" data-wc="back" aria-label="Back">←</button><button type="button" class="wc-chid" data-wc="info">${avatar(c, 40)}<span><b>${esc(titleOf(c))}</b><small id="wcSub"></small></span></button>
        <span class="wc-cha"><button type="button" class="wc-ib" data-wc="search" title="Search" aria-label="Search in this chat">🔎</button><button type="button" class="wc-ib" data-wc="menu" title="Menu" aria-label="Chat menu">⋮</button></span></header>
      <div class="wc-find" id="wcFind" hidden><input type="search" id="wcFindQ" placeholder="Search in this chat…"><span id="wcFindN"></span><button type="button" class="wc-ib" data-wc="findup" aria-label="Previous">↑</button><button type="button" class="wc-ib" data-wc="finddn" aria-label="Next">↓</button><button type="button" class="wc-ib" data-wc="findx" aria-label="Close search">✕</button></div>
      <div class="wc-pin" id="wcPin" hidden></div>
      <div class="wc-msgs" id="wcMsgs"></div>
      <button type="button" class="wc-down" id="wcDown" data-wc="down" hidden aria-label="Newest messages">⌄</button>
      <div class="wc-bar" id="wcBar" hidden></div>
      <div class="wc-at-list" id="wcAt" hidden></div>
      <form class="wc-comp" id="wcForm"><button type="button" class="wc-ib" data-wc="emoji" aria-label="Emoji">😊</button><button type="button" class="wc-ib" data-wc="attach" aria-label="Send a photo">📎</button>
        <textarea id="wcIn" rows="1" maxlength="2000" placeholder="Type a message"></textarea><input type="file" id="wcFile" accept="image/*" hidden>
        <button type="submit" class="wc-send" id="wcSend" aria-label="Send">🎤</button></form>`;
    const inp = D.getElementById('wcIn');
    inp.addEventListener('input', () => { inp.style.height = 'auto'; inp.style.height = Math.min(140, inp.scrollHeight) + 'px'; sendBtn(); typing(); atList(); });
    inp.addEventListener('keydown', e => { const L = D.getElementById('wcAt'); if (L && !L.hidden && (e.key === 'Enter' || e.key === 'Tab')) { const f = L.querySelector('button'); if (f) { e.preventDefault(); f.click(); return; } }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); D.getElementById('wcForm').requestSubmit(); } });
    D.getElementById('wcForm').addEventListener('submit', e => { e.preventDefault(); const v = inp.value; if (!v.trim() && !S.edit) { voice(); return; } send(v); inp.value = ''; inp.style.height = ''; sendBtn(); inp.focus(); });
    D.getElementById('wcFile').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) photo(f); });
    D.getElementById('wcFindQ').addEventListener('input', () => { S.find = 0; findGo(0); });
    D.getElementById('wcMsgs').addEventListener('scroll', () => { const b = D.getElementById('wcMsgs'); D.getElementById('wcDown').hidden = b.scrollHeight - b.scrollTop - b.clientHeight < 200; });
    render(true); markRead(id);
    if (matchMedia('(hover: hover)').matches) setTimeout(() => inp.focus(), 50);
  }
  const sendBtn = () => { const b = D.getElementById('wcSend'), i = D.getElementById('wcIn'); if (b && i) { const t = !!i.value.trim() || !!S.edit; b.textContent = t ? '➤' : '🎤'; b.setAttribute('aria-label', t ? 'Send' : 'Record a voice message'); } };

  // ── drawing ──
  function render(jump) { renderList(); renderChat(jump); badge(); }
  function renderList() {
    const box = D.getElementById('wcList'); if (!box) return;
    D.querySelectorAll('[data-wcf]').forEach(b => b.classList.toggle('on', b.dataset.wcf === S.filter));
    const my = me().uid, q = S.q.trim().toLowerCase(), pins = LSg('ho_wc_pin', {});
    let L = convs().filter(c => S.filter === 'all' || (S.filter === 'unread' && unread(c.id)) || (S.filter === 'groups' && c.type !== 'dm') || (S.filter === 'dm' && c.type === 'dm'))
      .filter(c => !q || titleOf(c).toLowerCase().includes(q) || msgsOf(c.id).some(m => !m.del && String(m.text || '').toLowerCase().includes(q)));
    L.sort((a, b) => (!!pins[b.id] - !!pins[a.id]) || ((lastOf(b.id) || {}).at || b.at || 0) - ((lastOf(a.id) || {}).at || a.at || 0));
    const people = q ? Object.keys(S.users).filter(u => u !== my && S.users[u].active !== false && nameOf(u).toLowerCase().includes(q) && !L.some(c => c.type === 'dm' && (c.members || {})[u])) : [];
    box.innerHTML = L.map(c => {
      const m = lastOf(c.id), n = unread(c.id), tp = typers(S.typing[c.id], my, S.users), mine = m && m.uid === my;
      const prev = tp.length ? `<i class="wc-typing">${esc(tp.length > 1 ? tp.length + ' people are typing…' : (c.type === 'dm' ? 'typing…' : tp[0] + ' is typing…'))}</i>`
        : m ? `${mine ? tickHtml(c, m) : ''}${c.type !== 'dm' && !mine ? esc(String(m.name || '').split(' ')[0]) + ': ' : ''}${m.del ? '<i>🚫 This message was deleted</i>' : esc(m.text || (m.file ? (m.file.kind === 'img' ? '📷 Photo' : '🎤 Voice message') : ''))}` : `<i>${esc(c.desc || (c.type === 'dm' ? 'Tap to say hello' : 'No messages yet'))}</i>`;
      const atMe = n && msgsOf(c.id).some(x => x.at > myRead(c.id) && x.at_ && x.at_[my]);
      return `<button type="button" class="wc-row${c.id === S.cur ? ' on' : ''}" data-chat="${esc(c.id)}">${avatar(c)}<span class="wc-rt"><span class="wc-r1"><b>${esc(titleOf(c))}</b><small class="${n ? 'wc-new' : ''}">${m ? listTime(m.at) : ''}</small></span>
        <span class="wc-r2"><span class="wc-prev">${prev}</span>${pins[c.id] ? '<i class="wc-ic">📌</i>' : ''}${muted(c.id) ? '<i class="wc-ic">🔕</i>' : ''}${atMe ? '<i class="wc-atb">@</i>' : ''}${n ? `<i class="wc-cnt${muted(c.id) ? ' mute' : ''}">${n > 99 ? '99+' : n}</i>` : ''}</span></span></button>`;
    }).join('') + (people.length ? `<div class="wc-lhd">People</div>` + people.map(u => `<button type="button" class="wc-row" data-dm="${esc(u)}"><span class="wc-av" style="--s:46px;background:${colorOf(u)}">${esc(initials(nameOf(u)))}</span><span class="wc-rt"><span class="wc-r1"><b>${esc(nameOf(u))}</b></span><span class="wc-r2"><span class="wc-prev">${esc((S.users[u] || {}).role || '')} · ${esc(lastSeen(+S.pres[u] || 0) || 'start a chat')}</span></span></span></button>`).join('') : '')
      + (!L.length && !people.length ? '<div class="wc-none">No chats found</div>' : '');
  }
  function tickHtml(c, m) {
    if (m.del) return '';
    const t = ticks(m, membersOf(c, S.users).filter(u => u !== me().uid), S.reads[c.id], S.dlv[c.id]);
    return `<i class="wc-tk ${t}" aria-label="${t === 'read' ? 'Seen' : t === 'dlv' ? 'Delivered' : 'Sent'}">${t === 'sent' ? '✓' : '✓✓'}</i>`;
  }
  function renderChat(jump) {
    const box = D.getElementById('wcMsgs'); if (!box || !S.cur) return;
    const c = convOf(S.cur); if (!c) return;
    const my = me().uid, nearBottom = jump || box.scrollHeight - box.scrollTop - box.clientHeight < 120, stars = starred();
    // subtitle: typing… / online / last seen / the members
    const sub = D.getElementById('wcSub'), tp = typers(S.typing[c.id], my, S.users);
    if (sub) { const other = c.type === 'dm' ? Object.keys(c.members || {}).find(u => u !== my) : '';
      sub.innerHTML = tp.length ? `<i class="wc-typing">${esc(c.type === 'dm' ? 'typing…' : tp.join(', ') + (tp.length > 1 ? ' are' : ' is') + ' typing…')}</i>` : esc(c.type === 'dm' ? lastSeen(+S.pres[other] || 0) : membersOf(c, S.users).map(u => u === my ? 'You' : nameOf(u).split(' ')[0]).slice(0, 8).join(', ')); }
    const pinK = (S.convs[c.id] || {}).pin, pinM = pinK && msgsOf(c.id).find(m => m.k === pinK), pb = D.getElementById('wcPin');
    if (pb) { pb.hidden = !pinM; if (pinM) pb.innerHTML = `<button type="button" data-goto="${esc(pinM.k)}"><span>📌</span><span><b>Pinned</b>${esc((pinM.text || '📷 Photo').slice(0, 90))}</span></button><button type="button" class="wc-ib" data-wc="unpin" aria-label="Unpin">✕</button>`; }
    let day = '', prev = null;
    const html = msgsOf(c.id).map(m => {
      const d = dayLbl(m.at), sep = d !== day ? `<div class="wc-day"><span>${esc(d)}</span></div>` : ''; if (sep) { day = d; prev = null; }
      if (m.sys) { prev = null; return `${sep}<div class="wc-day wc-sys" data-k="${esc(m.k)}"><span>${esc(m.text)}</span></div>`; }
      const mine = m.uid === my, first = !prev || prev.uid !== m.uid || m.at - prev.at > 5 * 60e3; prev = m;
      const reacts = Object.entries(m.re || {}).filter(([, e]) => e); const rc = {}; reacts.forEach(([, e]) => { rc[e] = (rc[e] || 0) + 1; });
      const body = m.del ? `<i class="wc-del">🚫 ${mine ? 'You deleted this message' : 'This message was deleted'}</i>`
        : `${m.fwd ? '<i class="wc-fwd">↪ Forwarded</i>' : ''}${m.reply ? `<button type="button" class="wc-quote" data-goto="${esc(m.reply.k)}"><b style="color:${colorOf(m.reply.name)}">${esc(m.reply.name)}</b><span>${esc(m.reply.text)}</span></button>` : ''}${m.file ? fileHtml(m) : ''}${m.text ? `<div class="wc-text">${richText(m.text)}</div>` : ''}`;
      return `${sep}<div class="wc-msg${mine ? ' mine' : ''}${first ? ' first' : ''}${reacts.length ? ' has-re' : ''}" data-k="${esc(m.k)}"><div class="wc-bub">
        ${!mine && c.type !== 'dm' && first ? `<b class="wc-who" style="color:${colorOf(m.uid)}">${esc(m.name || nameOf(m.uid))}</b>` : ''}${body}
        <span class="wc-meta">${stars[c.id + '/' + m.k] ? '⭐ ' : ''}${m.edited && !m.del ? 'edited · ' : ''}${hm(m.at)}${mine ? tickHtml(c, m) : ''}</span>
        <button type="button" class="wc-chev" data-mm="${esc(m.k)}" aria-label="Message menu">⌄</button>
        ${reacts.length ? `<button type="button" class="wc-re" data-who="${esc(m.k)}">${Object.keys(rc).map(e => esc(e)).join('')}${reacts.length > 1 ? `<small>${reacts.length}</small>` : ''}</button>` : ''}</div></div>`;
    }).join('');
    box.innerHTML = html || `<div class="wc-hello">🔒 ${c.type === 'dm' ? 'A chat between you and ' + esc(titleOf(c)) + '.' : 'Messages here go to everyone in ' + esc(titleOf(c)) + '.'} Say hello 👋</div>`;
    loadFiles(c.id);
    if (nearBottom) box.scrollTop = box.scrollHeight;
    if (S.open && D.visibilityState !== 'hidden') markRead(c.id);
  }
  const realFile = v => typeof v === 'string' && /^data:(image|audio)\/[\w.+-]+(;[^,]*)?,./.test(v);
  const mmss = t => { t = Math.max(0, Math.round(+t || 0)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  function fileHtml(m) {
    const f = m.file, src = realFile(S.files[f.fid]) ? S.files[f.fid] : '';
    if (f.kind === 'img') return `<button type="button" class="wc-img" data-img="${esc(f.fid)}" style="aspect-ratio:${+f.w || 4}/${+f.h || 3}">${src ? `<img src="${esc(src)}" alt="Photo" loading="lazy">` : '<span class="wc-load">📷</span>'}</button>`;
    // a voice note: WhatsApp's player (▶, a line that fills, the time) — the sound plays from a blob, which iPhone Safari plays (a data: link it often refuses)
    const on = PLAY.fid === f.fid;
    return `<span class="wc-voice"><button type="button" class="wc-play${on && PLAY.playing ? ' on' : ''}" data-play="${esc(f.fid)}" ${src ? '' : 'disabled'} aria-label="${on && PLAY.playing ? 'Pause' : 'Play'} voice message">${src ? (on && PLAY.playing ? '❚❚' : '▶') : '…'}</button>
      <span class="wc-wave"><i style="width:${on ? Math.round(PLAY.pct * 100) : 0}%"></i></span><small class="wc-vt" data-vt="${esc(f.fid)}">${on && PLAY.t ? mmss(PLAY.t) : mmss(f.dur)}</small><span class="wc-mic" aria-hidden="true">🎤</span></span>`;
  }
  // ── playing a voice note ──
  const PLAY = { fid: '', audio: null, playing: false, pct: 0, t: 0, urls: {} };
  async function blobUrl(fid) {
    if (PLAY.urls[fid]) return PLAY.urls[fid];
    const d = S.files[fid]; if (!realFile(d)) return '';
    const [head, b64] = d.split(','), type = (head.match(/^data:([^;,]+)/) || [])[1] || 'audio/mp4';
    const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return (PLAY.urls[fid] = URL.createObjectURL(new Blob([u8], { type })));
  }
  function playPaint() {
    D.querySelectorAll('#wcMsgs .wc-play').forEach(b => { const on = b.dataset.play === PLAY.fid && PLAY.playing; b.classList.toggle('on', on); if (!b.disabled) b.textContent = on ? '❚❚' : '▶'; });
    D.querySelectorAll('#wcMsgs .wc-voice').forEach(v => { const b = v.querySelector('.wc-play'), i = v.querySelector('.wc-wave i'), t = v.querySelector('.wc-vt'); if (!b) return;
      const on = b.dataset.play === PLAY.fid; if (i) i.style.width = (on ? Math.round(PLAY.pct * 100) : 0) + '%'; if (t && on && PLAY.t) t.textContent = mmss(PLAY.t); });
  }
  async function play(fid) {
    if (PLAY.fid === fid && PLAY.audio) { if (PLAY.playing) PLAY.audio.pause(); else PLAY.audio.play().catch(() => {}); return; }
    if (PLAY.audio) { PLAY.audio.pause(); PLAY.audio = null; }
    const url = await blobUrl(fid); if (!url) { toast('Still loading — try again in a second', 'info'); return; }
    const a = new Audio(); a.preload = 'auto'; a.src = url; PLAY.fid = fid; PLAY.audio = a; PLAY.pct = 0; PLAY.t = 0;
    a.onplay = () => { PLAY.playing = true; playPaint(); }; a.onpause = () => { PLAY.playing = false; playPaint(); };
    a.ontimeupdate = () => { PLAY.t = a.currentTime; PLAY.pct = a.duration && isFinite(a.duration) ? a.currentTime / a.duration : 0; playPaint(); };
    a.onended = () => { PLAY.playing = false; PLAY.pct = 0; PLAY.t = 0; playPaint(); };
    a.onerror = () => { PLAY.playing = false; playPaint(); toast('This voice message can\'t play on this device (recorded in a format it does not support)', 'err'); };
    a.play().catch(() => {});
  }
  async function loadFiles(id) {
    const need = msgsOf(id).filter(m => m.file && m.file.fid && !realFile(S.files[m.file.fid]) && !S.loading[m.file.fid] && !m.del).slice(-30);
    for (const m of need) { if (S.loading[m.file.fid]) continue; S.loading[m.file.fid] = 1; const v = await safe(() => fbGet(P('files/' + m.file.fid)), null); delete S.loading[m.file.fid]; if (realFile(v)) S.files[m.file.fid] = v; }
    if (need.length && S.cur === id) renderChat();
  }
  function bar() {
    const b = D.getElementById('wcBar'); if (!b) return;
    const x = S.edit || S.reply; b.hidden = !x;
    if (x) b.innerHTML = `<span class="wc-bq"><b>${S.edit ? '✏️ Edit message' : '↩ ' + esc(x.name)}</b><span>${esc((x.text || (x.file ? '📷 Photo' : '')).slice(0, 120))}</span></span><button type="button" class="wc-ib" data-wc="unbar" aria-label="Cancel">✕</button>`;
    const i = D.getElementById('wcIn'); if (S.edit && i) { i.value = S.edit.text; i.dispatchEvent(new Event('input')); } sendBtn(); if (i) i.focus();
  }
  function badge() {
    const my = me().uid, n = convs().filter(c => !muted(c.id)).reduce((a, c) => a + unread(c.id), 0);
    D.querySelectorAll('.tc-badge').forEach(b => { b.textContent = n > 99 ? '99+' : String(n); b.hidden = !n; });
  }
  // ── clicks ──
  function onClick(e) {
    const t = e.target, a = t.closest('[data-wc]'), k = a && a.dataset.wc;
    const row = t.closest('[data-chat]'); if (row) { openChat(row.dataset.chat); return; }
    const dm = t.closest('[data-dm]'); if (dm) { startDm(dm.dataset.dm); return; }
    const f = t.closest('[data-wcf]'); if (f) { S.filter = f.dataset.wcf; renderList(); return; }
    const room = t.closest('.tc-room'); if (room) { const r = room.dataset.room; close(); if (W.hoRoom && W.hoRoom.open) W.hoRoom.open(r); return; }
    const go = t.closest('[data-goto]'); if (go) { jumpTo(go.dataset.goto); return; }
    const mm = t.closest('[data-mm]'); if (mm) { msgMenu(mm.dataset.mm, mm.closest('.wc-msg')); return; }
    const pl = t.closest('[data-play]'); if (pl) { play(pl.dataset.play); return; }
    const im = t.closest('[data-img]'); if (im && realFile(S.files[im.dataset.img])) { layer(`<div class="wc-lb" data-wc="layerx"><img src="${esc(S.files[im.dataset.img])}" alt="Photo"></div>`); return; }
    const who = t.closest('[data-who]'); if (who) { reactWho(who.dataset.who); return; }
    if (t.closest('[data-wc="layerx"]') && t.classList.contains('wc-lb')) { closeLayer(); return; }
    if (t.classList.contains('wc-layer-bg')) { closeLayer(); return; }
    switch (k) {
      case 'close': close(); break;
      case 'back': S.cur = ''; shell().classList.remove('wc-in'); renderList(); break;
      case 'newgroup': newGroup(); break;
      case 'newchat': newChat(); break;
      case 'info': info(); break;
      case 'menu': chatMenu(a); break;
      case 'search': { const f2 = D.getElementById('wcFind'); f2.hidden = false; D.getElementById('wcFindQ').focus(); break; }
      case 'findx': D.getElementById('wcFind').hidden = true; D.getElementById('wcFindQ').value = ''; D.querySelectorAll('.wc-hit').forEach(x => x.classList.remove('wc-hit')); break;
      case 'findup': findGo(-1); break;
      case 'finddn': findGo(1); break;
      case 'down': { const b = D.getElementById('wcMsgs'); b.scrollTop = b.scrollHeight; break; }
      case 'unbar': S.reply = S.edit = null; bar(); { const i = D.getElementById('wcIn'); if (i) { i.value = ''; sendBtn(); } } break;
      case 'unpin': safe(() => fbUpdate(P('convs/' + S.cur), { pin: null })); if (S.convs[S.cur]) delete S.convs[S.cur].pin; renderChat(); break;
      case 'emoji': emojiPick(a); break;
      case 'attach': D.getElementById('wcFile').click(); break;
      case 'layerx': closeLayer(); break;
    }
  }
  function jumpTo(k) { const el = D.querySelector(`#wcMsgs .wc-msg[data-k="${CSS.escape(k)}"]`); if (!el) { toast('That message is no longer here', 'info'); return; } el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('wc-flash'); setTimeout(() => el.classList.remove('wc-flash'), 1400); }
  function findGo(dir) {
    const q = (D.getElementById('wcFindQ').value || '').trim().toLowerCase(); D.querySelectorAll('.wc-hit').forEach(x => x.classList.remove('wc-hit'));
    const hits = msgsOf(S.cur).filter(m => q && !m.del && String(m.text || '').toLowerCase().includes(q)).reverse();
    const n = D.getElementById('wcFindN'); if (!hits.length) { if (n) n.textContent = q ? '0' : ''; return; }
    S.find = ((S.find || 0) + (dir || 0) + hits.length) % hits.length; if (dir === -1) S.find = Math.min(hits.length - 1, (S.find)); if (n) n.textContent = (S.find + 1) + '/' + hits.length;
    hits.forEach(m => { const el = D.querySelector(`#wcMsgs .wc-msg[data-k="${CSS.escape(m.k)}"]`); if (el) el.classList.add('wc-hit'); });
    const el = D.querySelector(`#wcMsgs .wc-msg[data-k="${CSS.escape(hits[S.find].k)}"]`); if (el) el.scrollIntoView({ block: 'center' });
  }
  // ── layers: menus, pickers, dialogs ──
  function layer(html, anchor) {
    const L = D.getElementById('wcLayer'); L.innerHTML = `<div class="wc-layer-bg"></div>${html}`; L.classList.add('on');
    const box = L.lastElementChild;
    if (anchor && box && matchMedia('(min-width: 769px)').matches && box.classList.contains('wc-menu')) {
      const r = anchor.getBoundingClientRect(), bw = box.offsetWidth, bh = box.offsetHeight;
      box.style.position = 'fixed'; box.style.left = Math.max(8, Math.min(innerWidth - bw - 8, r.right - bw)) + 'px'; box.style.top = Math.max(8, Math.min(innerHeight - bh - 8, r.bottom + 4)) + 'px';
    }
    return box;
  }
  function closeLayer() { const L = D.getElementById('wcLayer'); if (L) { L.innerHTML = ''; L.classList.remove('on'); } }
  function msgMenu(k, el) {
    const m = msgsOf(S.cur).find(x => x.k === k); if (!m) return;
    const mine = m.uid === me().uid, canEdit = mine && !m.del && !m.file && Date.now() - m.at < EDIT_MIN * 60e3, isStar = !!starred()[S.cur + '/' + k];
    const box = layer(`<div class="wc-menu wc-mmenu">${m.del ? '' : `<div class="wc-reacts">${EMO.map(e => `<button type="button" data-re="${e}" class="${(m.re || {})[me().uid] === e ? 'on' : ''}">${e}</button>`).join('')}<button type="button" data-re="+" aria-label="More emoji">＋</button></div>`}
      ${m.del ? '' : '<button type="button" data-a="reply">↩ Reply</button>'}${m.text && !m.del ? '<button type="button" data-a="copy">📋 Copy</button>' : ''}${m.del ? '' : '<button type="button" data-a="fwd">↪ Forward</button>'}
      ${m.del ? '' : `<button type="button" data-a="star">${isStar ? '☆ Unstar' : '⭐ Star'}</button><button type="button" data-a="pin">📌 Pin</button>`}${canEdit ? '<button type="button" data-a="edit">✏️ Edit</button>' : ''}
      ${mine ? '<button type="button" data-a="info">ℹ️ Message info</button>' : ''}${mine && !m.del ? '<button type="button" data-a="delall" class="bad">🗑 Delete for everyone</button>' : ''}<button type="button" data-a="delme" class="bad">🗑 Delete for me</button></div>`, el);
    box.addEventListener('click', e => {
      const r = e.target.closest('[data-re]'); if (r) { if (r.dataset.re === '+') { emojiPick(null, em => react(m, em)); return; } react(m, r.dataset.re); closeLayer(); return; }
      const b = e.target.closest('[data-a]'); if (!b) return; closeLayer();
      ({ reply: () => startReply(k), copy: () => { safe(() => navigator.clipboard.writeText(m.text)); toast('Copied'); }, fwd: () => forward(m),
        star: () => { const s = starred(); if (s[S.cur + '/' + k]) delete s[S.cur + '/' + k]; else s[S.cur + '/' + k] = { at: m.at, text: (m.text || '📷').slice(0, 140), chat: S.cur }; LSs('ho_wc_star', s); renderChat(); },
        pin: () => { (S.convs[S.cur] = S.convs[S.cur] || {}).pin = k; safe(() => fbUpdate(P('convs/' + S.cur), { pin: k })); renderChat(); },
        edit: () => { S.edit = m; S.reply = null; bar(); },
        info: () => msgInfo(m), delall: () => { if (confirm('Delete this message for everyone?')) safe(() => fbUpdate(P(`msgs/${S.cur}/${k}`), { del: true, text: '', file: null, reply: null, re: null })); },
        delme: () => { const h = LSg('ho_wc_hide', {}); h[S.cur + '/' + k] = 1; LSs('ho_wc_hide', h); S.msgs[S.cur] = msgsOf(S.cur).filter(x => x.k !== k); renderChat(); } })[b.dataset.a]();
    });
  }
  function react(m, e) { const my = me().uid, cur = (m.re || {})[my]; safe(() => fbSet(P(`msgs/${S.cur}/${m.k}/re/${my}`), cur === e ? null : e)); (m.re = m.re || {})[my] = cur === e ? null : e; renderChat(); }
  function reactWho(k) { const m = msgsOf(S.cur).find(x => x.k === k); if (!m) return; layer(`<div class="wc-dlg"><header><b>Reactions</b><button type="button" class="wc-ib" data-wc="layerx">✕</button></header>${Object.entries(m.re || {}).filter(([, e]) => e).map(([u, e]) => `<div class="wc-pr"><span class="wc-av" style="--s:34px;background:${colorOf(u)}">${esc(initials(nameOf(u)))}</span><b>${esc(u === me().uid ? 'You' : nameOf(u))}</b><span class="wc-pe">${esc(e)}</span></div>`).join('')}</div>`); }
  function startReply(k) { const m = msgsOf(S.cur).find(x => x.k === k); if (!m || m.del) return; S.reply = { k, name: m.uid === me().uid ? 'You' : (m.name || nameOf(m.uid)), text: m.text || '', file: m.file }; S.edit = null; bar(); }
  function msgInfo(m) {
    const c = convOf(S.cur), others = membersOf(c, S.users).filter(u => u !== me().uid), R = S.reads[c.id] || {}, Dl = S.dlv[c.id] || {};
    const read = others.filter(u => +R[u] >= m.at), dlv = others.filter(u => !read.includes(u) && Math.max(+Dl[u] || 0, +R[u] || 0) >= m.at), wait = others.filter(u => !read.includes(u) && !dlv.includes(u));
    const row = u => `<div class="wc-pr"><span class="wc-av" style="--s:34px;background:${colorOf(u)}">${esc(initials(nameOf(u)))}</span><b>${esc(nameOf(u))}</b></div>`;
    layer(`<div class="wc-dlg"><header><b>Message info</b><button type="button" class="wc-ib" data-wc="layerx">✕</button></header><div class="wc-quote">${esc((m.text || '📷 Photo').slice(0, 200))}</div>
      <h5><i class="wc-tk read">✓✓</i> Read by ${read.length}</h5>${read.map(row).join('') || '<small>—</small>'}<h5><i class="wc-tk dlv">✓✓</i> Delivered to ${dlv.length}</h5>${dlv.map(row).join('') || '<small>—</small>'}${wait.length ? `<h5><i class="wc-tk sent">✓</i> Not delivered yet · ${wait.length}</h5>${wait.map(row).join('')}` : ''}</div>`);
  }
  function forward(m) {
    const box = layer(`<div class="wc-dlg"><header><b>Forward to…</b><button type="button" class="wc-ib" data-wc="layerx">✕</button></header>${convs().map(c => `<button type="button" class="wc-pr wc-pick" data-to="${esc(c.id)}">${avatar(c, 34)}<b>${esc(titleOf(c))}</b></button>`).join('')}</div>`);
    box.addEventListener('click', async e => { const b = e.target.closest('[data-to]'); if (!b) return; closeLayer(); const was = S.cur; S.cur = b.dataset.to; await send(m.text || '', Object.assign({ fwd: true }, m.file ? { file: m.file } : {})); if (S.cur !== was) openChat(S.cur); toast('Forwarded'); });
  }
  function emojiPick(anchor, cb) {
    const box = layer(`<div class="wc-menu wc-emo">${PICK.map(e => `<button type="button" data-e="${e}">${e}</button>`).join('')}</div>`, anchor);
    box.addEventListener('click', e => { const b = e.target.closest('[data-e]'); if (!b) return; if (cb) { cb(b.dataset.e); closeLayer(); return; } const i = D.getElementById('wcIn'); if (i) { const p = i.selectionStart || i.value.length; i.value = i.value.slice(0, p) + b.dataset.e + i.value.slice(p); i.dispatchEvent(new Event('input')); i.focus(); } });
  }
  function atList() {
    const i = D.getElementById('wcIn'), L = D.getElementById('wcAt'); if (!i || !L) return;
    const m = i.value.slice(0, i.selectionStart).match(/@([\w؀-ۿ]{0,20})$/); const c = convOf(S.cur);
    if (!m || !c) { L.hidden = true; return; }
    const ppl = membersOf(c, S.users).filter(u => u !== me().uid && nameOf(u).toLowerCase().startsWith(m[1].toLowerCase())).slice(0, 6);
    L.hidden = !ppl.length; L.innerHTML = ppl.map(u => `<button type="button" data-atu="${esc(u)}"><span class="wc-av" style="--s:28px;background:${colorOf(u)}">${esc(initials(nameOf(u)))}</span>${esc(nameOf(u))}</button>`).join('');
    L.onclick = e => { const b = e.target.closest('[data-atu]'); if (!b) return; const first = nameOf(b.dataset.atu).split(' ')[0]; const p = i.selectionStart; i.value = i.value.slice(0, p).replace(/@[\w؀-ۿ]*$/, '@' + first + ' ') + i.value.slice(p); L.hidden = true; i.focus(); };
  }
  function chatMenu(anchor) {
    const c = convOf(S.cur), pins = LSg('ho_wc_pin', {});
    const box = layer(`<div class="wc-menu"><button type="button" data-a="info">${c.type === 'dm' ? '👤 Contact info' : '👥 Group info'}</button><button type="button" data-a="search">🔎 Search</button><button type="button" data-a="stars">⭐ Starred messages</button>
      <button type="button" data-a="mute">${muted(c.id) ? '🔔 Unmute' : '🔕 Mute notifications'}</button><button type="button" data-a="pinchat">${pins[c.id] ? '📌 Unpin chat' : '📌 Pin chat'}</button>
      <button type="button" data-a="media">🖼 Photos</button>${c.type !== 'dm' && c.id !== 'team' ? '<button type="button" data-a="leave" class="bad">🚪 Exit group</button>' : ''}</div>`, anchor);
    box.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (!b) return; closeLayer();
      ({ info, search: () => { D.getElementById('wcFind').hidden = false; D.getElementById('wcFindQ').focus(); },
        stars: () => { const s = Object.entries(starred()).filter(([k]) => k.startsWith(c.id + '/')); layer(`<div class="wc-dlg"><header><b>⭐ Starred</b><button type="button" class="wc-ib" data-wc="layerx">✕</button></header>${s.map(([k, v]) => `<button type="button" class="wc-pr wc-pick" data-goto="${esc(k.split('/')[1])}"><b>${esc(v.text)}</b><small>${listTime(v.at)}</small></button>`).join('') || '<small class="wc-none">No starred messages — long-press or right-click a message → ⭐ Star.</small>'}</div>`); },
        mute: () => { const mu = LSg('ho_wc_mute', {}); if (mu[c.id]) delete mu[c.id]; else mu[c.id] = 1; LSs('ho_wc_mute', mu); toast(mu[c.id] ? '🔕 Muted — no pop-ups from this chat (except @mentions)' : '🔔 Unmuted'); render(); },
        pinchat: () => { const p = LSg('ho_wc_pin', {}); if (p[c.id]) delete p[c.id]; else p[c.id] = 1; LSs('ho_wc_pin', p); renderList(); },
        media: () => { const imgs = msgsOf(c.id).filter(m => m.file && m.file.kind === 'img' && !m.del); layer(`<div class="wc-dlg"><header><b>🖼 Photos</b><button type="button" class="wc-ib" data-wc="layerx">✕</button></header><div class="wc-grid">${imgs.map(m => realFile(S.files[m.file.fid]) ? `<button type="button" data-img="${esc(m.file.fid)}"><img src="${esc(S.files[m.file.fid])}" alt=""></button>` : '').join('') || '<small class="wc-none">No photos yet</small>'}</div></div>`); },
        leave: () => leaveGroup(c) })[b.dataset.a]();
    });
  }
  // ── groups & direct chats ──
  function peoplePicker(title, preset, next, nextLbl) {
    const my = me().uid, sel = new Set(preset || []);
    const ppl = Object.keys(S.users).filter(u => u !== my && S.users[u] && S.users[u].active !== false).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    const box = layer(`<div class="wc-dlg wc-big"><header><button type="button" class="wc-ib" data-wc="layerx">←</button><b>${esc(title)}</b><small id="wcSelN"></small></header>
      <div class="wc-chips" id="wcChips"></div><label class="wc-search"><span>🔎</span><input type="search" id="wcPQ" placeholder="Search name or role"></label>
      <div class="wc-plist">${ppl.map(u => `<label class="wc-pr wc-pick" data-n="${esc((nameOf(u) + ' ' + ((S.users[u] || {}).role || '')).toLowerCase())}"><span class="wc-av" style="--s:40px;background:${colorOf(u)}">${esc(initials(nameOf(u)))}</span><span class="wc-pt"><b>${esc(nameOf(u))}</b><small>${esc((S.users[u] || {}).role || '')} · ${esc(lastSeen(+S.pres[u] || 0) || '')}</small></span><input type="checkbox" value="${esc(u)}"${sel.has(u) ? ' checked' : ''}></label>`).join('') || '<small class="wc-none">No colleagues yet — add the team in Team → Users.</small>'}</div>
      <button type="button" class="wc-fab" id="wcNext" aria-label="${esc(nextLbl || 'Next')}">${nextLbl ? '✓' : '→'}</button></div>`);
    const paint = () => { const n = D.getElementById('wcSelN'); if (n) n.textContent = sel.size ? sel.size + ' selected' : ''; D.getElementById('wcChips').innerHTML = [...sel].map(u => `<button type="button" data-un="${esc(u)}"><span class="wc-av" style="--s:24px;background:${colorOf(u)}">${esc(initials(nameOf(u)))}</span>${esc(nameOf(u).split(' ')[0])} ✕</button>`).join(''); };
    box.addEventListener('change', e => { const c = e.target.closest('input[type=checkbox]'); if (!c) return; if (c.checked) sel.add(c.value); else sel.delete(c.value); paint(); });
    box.addEventListener('click', e => { const u = e.target.closest('[data-un]'); if (u) { sel.delete(u.dataset.un); const cb = box.querySelector(`input[value="${CSS.escape(u.dataset.un)}"]`); if (cb) cb.checked = false; paint(); } });
    box.querySelector('#wcPQ').addEventListener('input', e => { const q = e.target.value.toLowerCase(); box.querySelectorAll('[data-n]').forEach(r => { r.style.display = r.dataset.n.includes(q) ? '' : 'none'; }); });
    box.querySelector('#wcNext').onclick = () => { if (!sel.size) { toast('Pick at least one person', 'err'); return; } next([...sel]); };
    paint();
  }
  function newGroup() {
    peoplePicker('Add group members', [], picked => {
      let icon = GEMO[0];
      const box = layer(`<div class="wc-dlg wc-big"><header><button type="button" class="wc-ib" data-wc="layerx">←</button><b>New group</b></header>
        <div class="wc-gnew"><button type="button" class="wc-av wc-av-g wc-gicon" id="wcGI" style="--s:72px">${icon}</button><div class="wc-gemo">${GEMO.map(e => `<button type="button" data-ge="${e}">${e}</button>`).join('')}</div>
        <input id="wcGN" maxlength="40" placeholder="Group name (e.g. Night team)" autocomplete="off"><input id="wcGD" maxlength="120" placeholder="Description (optional)" autocomplete="off">
        <small>${picked.length + 1} members: You, ${esc(picked.map(u => nameOf(u).split(' ')[0]).join(', '))}</small></div>
        <button type="button" class="wc-fab" id="wcMake" aria-label="Create group">✓</button></div>`);
      box.addEventListener('click', e => { const b = e.target.closest('[data-ge]'); if (b) { icon = b.dataset.ge; D.getElementById('wcGI').textContent = icon; } });
      setTimeout(() => D.getElementById('wcGN').focus(), 50);
      box.querySelector('#wcMake').onclick = async () => {
        const name = D.getElementById('wcGN').value.trim(); if (!name) { toast('Give the group a name', 'err'); D.getElementById('wcGN').focus(); return; }
        const my = me().uid, id = 'g_' + newId(), members = { [my]: true }; picked.forEach(u => { members[u] = true; });
        const c = { type: 'group', name: name.slice(0, 40), icon, desc: D.getElementById('wcGD').value.trim().slice(0, 120), members, admins: { [my]: true }, by: my, at: Date.now() };
        S.convs[id] = c; await safe(() => fbSet(P('convs/' + id), c)); closeLayer(); openChat(id);
        await send(`👥 ${me().name} created the group "${c.name}"`, { sys: true }); toast('Group created');
      };
    }, '');
  }
  function newChat() { peoplePicker('New chat', [], picked => { closeLayer(); if (picked.length === 1) startDm(picked[0]); else { toast('Pick one person — or make a group with 👥＋', 'info'); } }, 'Chat'); }
  async function startDm(u) {
    const my = me().uid, id = dmId(my, u);
    if (!S.convs[id]) { S.convs[id] = { type: 'dm', members: { [my]: true, [u]: true }, at: Date.now() }; await safe(() => fbSet(P('convs/' + id), S.convs[id])); }
    S.q = ''; const q = D.getElementById('wcQ'); if (q) q.value = ''; closeLayer(); openChat(id);
  }
  function info() {
    const c = convOf(S.cur); if (!c) return;
    const my = me().uid, admin = c.all ? safe(() => ['owner', 'manager'].includes(currentProfile.role), false) : !!(c.admins || {})[my], mem = membersOf(c, S.users);
    if (c.type === 'dm') { const o = Object.keys(c.members || {}).find(u => u !== my) || '';
      layer(`<div class="wc-dlg wc-big"><header><button type="button" class="wc-ib" data-wc="layerx">←</button><b>Contact info</b></header><div class="wc-prof"><span class="wc-av" style="--s:96px;background:${colorOf(o)}">${esc(initials(nameOf(o)))}</span><b>${esc(nameOf(o))}</b><small>${esc((S.users[o] || {}).role || '')}</small><small>${esc(lastSeen(+S.pres[o] || 0))}</small></div></div>`); return; }
    const box = layer(`<div class="wc-dlg wc-big"><header><button type="button" class="wc-ib" data-wc="layerx">←</button><b>Group info</b></header>
      <div class="wc-prof">${avatar(c, 96)}${admin && !c.all ? `<input id="wcIN" value="${esc(c.name || '')}" maxlength="40" aria-label="Group name">` : `<b>${esc(titleOf(c))}</b>`}<small>Group · ${mem.length} members</small>${admin && !c.all ? `<input id="wcID" value="${esc(c.desc || '')}" maxlength="120" placeholder="Add a description" aria-label="Description">` : c.desc ? `<small>${esc(c.desc)}</small>` : ''}</div>
      ${admin && !c.all ? '<button type="button" class="wc-pr wc-pick" data-a="add"><span class="wc-av wc-av-g" style="--s:40px">＋</span><b>Add members</b></button>' : ''}
      <div class="wc-lhd">${mem.length} members</div>${mem.sort((a, b) => (b === my) - (a === my) || nameOf(a).localeCompare(nameOf(b))).map(u => `<div class="wc-pr" data-u="${esc(u)}"><span class="wc-av" style="--s:40px;background:${colorOf(u)}">${esc(initials(nameOf(u)))}</span><span class="wc-pt"><b>${esc(u === my ? 'You' : nameOf(u))}</b><small>${esc((S.users[u] || {}).role || '')} · ${esc(lastSeen(+S.pres[u] || 0))}</small></span>${(c.admins || {})[u] ? '<i class="wc-adm">Group admin</i>' : ''}${admin && !c.all && u !== my ? `<button type="button" class="wc-ib" data-mk="${esc(u)}" title="Make / remove admin">👑</button><button type="button" class="wc-ib" data-rm="${esc(u)}" title="Remove">✕</button>` : ''}</div>`).join('')}
      ${!c.all ? '<button type="button" class="wc-pr wc-pick bad" data-a="leave">🚪 Exit group</button>' : ''}</div>`);
    const save = () => { const n = D.getElementById('wcIN'), d = D.getElementById('wcID'); if (!n) return; const patch = { name: n.value.trim().slice(0, 40) || c.name, desc: d ? d.value.trim().slice(0, 120) : c.desc || '' }; Object.assign(S.convs[c.id], patch); safe(() => fbUpdate(P('convs/' + c.id), patch)); render(); };
    box.addEventListener('change', save);
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-a]'); if (b && b.dataset.a === 'add') { peoplePicker('Add members', mem.filter(u => u !== my), picked => { const members = { [my]: true }; picked.forEach(u => { members[u] = true; }); S.convs[c.id].members = members; safe(() => fbUpdate(P('convs/' + c.id), { members })); closeLayer(); render(); toast('Members updated'); }, 'Save'); return; }
      if (b && b.dataset.a === 'leave') { closeLayer(); leaveGroup(c); return; }
      const rm = e.target.closest('[data-rm]'); if (rm && confirm(`Remove ${nameOf(rm.dataset.rm)} from the group?`)) { delete S.convs[c.id].members[rm.dataset.rm]; safe(() => fbSet(P(`convs/${c.id}/members/${rm.dataset.rm}`), null)); info(); render(); return; }
      const mk = e.target.closest('[data-mk]'); if (mk) { const on = !(c.admins || {})[mk.dataset.mk]; (S.convs[c.id].admins = S.convs[c.id].admins || {})[mk.dataset.mk] = on || null; safe(() => fbSet(P(`convs/${c.id}/admins/${mk.dataset.mk}`), on || null)); info(); }
    });
  }
  async function leaveGroup(c) { if (!confirm(`Exit "${titleOf(c)}"?`)) return; const my = me().uid; await send(`🚪 ${me().name} left`, { sys: true }); delete (S.convs[c.id].members || {})[my]; safe(() => fbSet(P(`convs/${c.id}/members/${my}`), null)); S.cur = ''; shell().classList.remove('wc-in'); D.getElementById('wcMain').innerHTML = ''; render(); }
  // ── photos & voice notes (kept small: a photo ≤ ~200 KB, a voice note ≤ 90 s) ──
  async function photo(file) {
    if (!/^image\//.test(file.type)) { toast('Only photos can be sent here', 'err'); return; }
    const url = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
    const img = await new Promise((r, no) => { const i = new Image(); i.onload = () => r(i); i.onerror = no; i.src = url; }).catch(() => null); if (!img) { toast('That photo could not be read', 'err'); return; }
    const k = Math.min(1, 1280 / Math.max(img.width, img.height)), cv = D.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    let q = .72, out = cv.toDataURL('image/jpeg', q); while (out.length > 270000 && q > .3) { q -= .12; out = cv.toDataURL('image/jpeg', q); }
    const fid = newId(); S.files[fid] = out; await safe(() => fbSet(P('files/' + fid), out));
    const cap = (D.getElementById('wcIn') || {}).value || ''; if (cap) { D.getElementById('wcIn').value = ''; sendBtn(); }
    send(cap, { file: { kind: 'img', fid, w: cv.width, h: cv.height } });
  }
  let REC = null;
  async function voice() {
    if (REC) { REC.stop(); return; }
    if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') { toast('Voice messages need a microphone and a newer browser', 'err'); return; }
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (_) { toast('Allow the microphone to send a voice message', 'err'); return; }
    const type = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm'].find(t => safe(() => MediaRecorder.isTypeSupported(t), false)) || '';
    const chunks = [], t0 = Date.now(), rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : {});
    REC = rec; const btn = D.getElementById('wcSend'); if (btn) { btn.classList.add('rec'); btn.textContent = '■'; btn.setAttribute('aria-label', 'Stop and send'); }
    const cap = setTimeout(() => rec.state === 'recording' && rec.stop(), 90000);
    rec.ondataavailable = e => e.data && chunks.push(e.data);
    rec.onstop = async () => { clearTimeout(cap); REC = null; stream.getTracks().forEach(t => t.stop()); if (btn) btn.classList.remove('rec'); sendBtn();
      const dur = (Date.now() - t0) / 1000; if (dur < 1) return; const blob = new Blob(chunks, { type: (rec.mimeType || type || 'audio/mp4').split(';')[0] });
      const url = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
      if (url.length > 700000) { toast('Too long — keep voice messages under a minute and a half', 'err'); return; }
      const fid = newId(); S.files[fid] = url; await safe(() => fbSet(P('files/' + fid), url)); send('', { file: { kind: 'audio', fid, dur } }); };
    rec.start(); toast('🎤 Recording… tap ■ to send', 'info');
  }
  // ── live data ──
  function onMsgs(v) {
    const hide = LSg('ho_wc_hide', {}), my = me().uid, before = {};
    Object.keys(S.msgs).forEach(id => { const L = S.msgs[id]; before[id] = L.length ? L[L.length - 1].at : 0; });
    S.msgs = {};
    Object.entries(v || {}).forEach(([cid, box]) => {
      S.msgs[cid] = Object.entries(box || {}).filter(([k, m]) => m && typeof m === 'object' && !hide[cid + '/' + k]).map(([k, m]) => ({ k, at: +m.at || 0, uid: String(m.uid || ''), name: String(m.name || ''), text: String(m.text || '').slice(0, 2000), reply: m.reply || null, re: m.re || null, file: m.file || null, edited: m.edited || 0, del: !!m.del, fwd: !!m.fwd, sys: !!m.sys, at_: m.at_ || null }))
        .sort((a, b) => a.at - b.at);
    });
    markDelivered();
    // a new message from a colleague: a short pop-up (not muted chats, unless it @mentions you; not the open chat; not the history at start)
    if (S.started && Date.now() - S.started > 3000) Object.keys(S.msgs).forEach(id => {
      const fresh = msgsOf(id).filter(m => m.at > (before[id] || 0) && m.uid !== my && !m.del && Date.now() - m.at < 120000 && !S.seenMsg[id + m.k]);
      fresh.forEach(m => { S.seenMsg[id + m.k] = 1; });
      const m = fresh[fresh.length - 1]; if (!m) return;
      if ((S.open && S.cur === id && D.visibilityState !== 'hidden') || (muted(id) && !(m.at_ && m.at_[my]))) return;
      const c = convOf(id); if (!c) return; popMsg(c, m);
    });
    render();
  }
  function popMsg(c, m) {
    css(); D.getElementById('tcPop')?.remove();
    const p = D.createElement('button'); p.id = 'tcPop'; p.type = 'button'; p.className = 'tc-pop';
    p.innerHTML = `${avatar(c, 36)}<span><b>${esc(titleOf(c))}</b>${c.type !== 'dm' ? esc(String(m.name).split(' ')[0]) + ': ' : ''}${esc((m.text || (m.file ? (m.file.kind === 'img' ? '📷 Photo' : '🎤 Voice message') : '')).slice(0, 90))}</span>`;
    p.onclick = () => { p.remove(); open(c.id); }; D.body.appendChild(p); setTimeout(() => p.remove(), 7000);
    beep();
  }
  let AC = null; function beep() { if (!safe(() => hoPref('soundAlerts'), false)) return; safe(() => { AC = AC || new (W.AudioContext || W.webkitAudioContext)(); const o = AC.createOscillator(), g = AC.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(.06, AC.currentTime); g.gain.exponentialRampToValueAtTime(.0001, AC.currentTime + .25); o.connect(g); g.connect(AC.destination); o.start(); o.stop(AC.currentTime + .26); }); }
  // the old simple chat (v542): its messages move into the Whole team chat once
  async function migrate(v) {
    if (!v || typeof v !== 'object' || LSg('ho_wc_migrated', false)) return; LSs('ho_wc_migrated', true);
    const have = msgsOf('team').length; if (have) return;
    for (const [k, m] of Object.entries(v)) if (m && m.text) await safe(() => fbSet(P('msgs/team/' + k), { at: +m.at || Date.now(), uid: String(m.uid || ''), name: String(m.name || ''), text: String(m.text).slice(0, 2000) }));
  }
  function mountButtons() {
    const right = D.querySelector('.topbar-right');
    if (right && !D.getElementById('tcBtn')) { const b = D.createElement('button'); b.id = 'tcBtn'; b.type = 'button'; b.className = 'icon-round tc-btn'; b.title = 'Team chat'; b.setAttribute('aria-label', 'Team chat'); b.innerHTML = '<span aria-hidden="true">💬</span><b class="tc-badge" hidden>0</b>'; b.onclick = () => (S.open ? close() : open()); right.insertBefore(b, right.firstChild); }
    const grid = D.querySelector('#mobMoreDrawer .mob-more-grid');
    if (grid && !grid.querySelector('[data-tc]')) { const m = D.createElement('button'); m.className = 'mob-more-item'; m.dataset.tc = '1'; m.type = 'button'; m.innerHTML = '<span class="mob-item-icon">💬</span><b class="tc-badge mob-more-badge" hidden>0</b>Team chat'; m.onclick = () => { safe(() => closeMobMore()); open(); }; grid.insertBefore(m, grid.firstChild); }
    badge();
  }
  (function listen(tries) {
    tries = +tries || 0;
    if ((typeof fbListen !== 'function' || typeof _ref === 'undefined' || !_ref) && tries < 400) return setTimeout(() => listen(tries + 1), 1500);
    if (typeof fbListen !== 'function') return;
    S.started = Date.now();
    fbListen('users', v => { const u = {}; Object.entries(v || {}).forEach(([k, x]) => { if (x && typeof x === 'object') u[k] = { name: String(x.name || x.email || 'Someone').slice(0, 40), role: String(x.role || ''), active: x.active !== false }; }); S.users = u; render(); });
    fbListen(P('convs'), v => { S.convs = v && typeof v === 'object' ? v : {}; render(); });
    fbListen(P('msgs'), onMsgs);
    fbListen(P('reads'), v => { S.reads = v || {}; render(); });
    fbListen(P('dlv'), v => { S.dlv = v || {}; render(); });
    fbListen(P('typing'), v => { S.typing = v || {}; render(); clearTimeout(listen.t); listen.t = setTimeout(render, 6500); });
    fbListen(P('presence'), v => { S.pres = v || {}; if (S.open) render(); });
    safe(() => fbGet('teamChat').then(migrate));
    presence(); setInterval(presence, 30000); D.addEventListener('visibilitychange', () => { presence(); if (S.open && S.cur && D.visibilityState === 'visible') markRead(S.cur); });
  })();
  function css() {
    if (D.getElementById('wcCss')) return;
    const s = D.createElement('style'); s.id = 'wcCss';
    s.textContent = `.tc-btn{position:relative}.tc-badge{position:absolute;top:-5px;right:-6px;min-width:18px;height:18px;padding:0 5px;border-radius:99px;background:#25d366;color:#fff;font:700 10.5px/18px var(--font);text-align:center;box-shadow:0 0 0 2px var(--bg)}.tc-badge[hidden]{display:none}.mob-more-item .tc-badge{top:6px;right:10px}
.wc{--wa-bg:#efeae2;--wa-panel:#fff;--wa-side:#fff;--wa-hd:#f0f2f5;--wa-in:#fff;--wa-out:#d9fdd3;--wa-tx:#111b21;--wa-tx2:#667781;--wa-line:#e9edef;--wa-green:#008069;--wa-acc:#25d366;--wa-blue:#53bdeb;--wa-row:#f5f6f6;--wa-chip:#e7fce3;--wa-dot:rgba(0,0,0,.035);position:fixed;inset:0;z-index:10020;pointer-events:none;font-family:var(--font)}
.wc.wc-dark{--wa-bg:#0b141a;--wa-panel:#111b21;--wa-side:#111b21;--wa-hd:#202c33;--wa-in:#202c33;--wa-out:#005c4b;--wa-tx:#e9edef;--wa-tx2:#8696a0;--wa-line:#222d34;--wa-green:#00a884;--wa-row:#202c33;--wa-chip:#0a332c;--wa-dot:rgba(255,255,255,.025)}
.wc.on{pointer-events:auto}.wc .tc-bg{position:absolute;inset:0;background:rgba(0,0,0,.45);opacity:0;transition:opacity .2s}.wc.on .tc-bg{opacity:1}
.wc-win{position:absolute;left:50%;top:50%;width:min(1180px,96vw);height:min(820px,92vh);transform:translate(-50%,-48%) scale(.98);opacity:0;transition:transform .22s cubic-bezier(.2,.8,.2,1),opacity .18s;display:grid;grid-template-columns:minmax(300px,30%) 1fr;background:var(--wa-panel);color:var(--wa-tx);border-radius:14px;overflow:hidden;box-shadow:0 30px 80px -20px rgba(0,0,0,.6)}
.wc.on .wc-win{transform:translate(-50%,-50%);opacity:1}
.wc-side{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--wa-line);background:var(--wa-side)}
.wc-sh{display:flex;align-items:center;justify-content:space-between;padding:12px 14px 8px}.wc-sh b{font-size:1.35rem;font-weight:700}.wc-sh span{display:flex;gap:2px}
.wc-ib{width:38px;height:38px;border-radius:50%;border:0;background:transparent;color:var(--wa-tx2);cursor:pointer;font-size:16px;display:inline-grid;place-items:center;flex:none}.wc-ib:hover{background:var(--wa-row)}
.wc-search{display:flex;align-items:center;gap:8px;margin:2px 12px 8px;padding:0 12px;height:38px;border-radius:9px;background:var(--wa-hd);color:var(--wa-tx2)}
.wc-search input{flex:1;min-width:0;border:0!important;outline:0;background:transparent!important;color:var(--wa-tx)!important;font:14px var(--font);box-shadow:none!important;padding:0!important}
.wc-filters{display:flex;gap:6px;padding:0 12px 8px;overflow-x:auto;scrollbar-width:none}
.wc-filters button{flex:none;height:32px;padding:0 13px;border-radius:99px;border:0;background:var(--wa-hd);color:var(--wa-tx2);font:600 13px var(--font);cursor:pointer}.wc-filters button.on{background:var(--wa-chip);color:var(--wa-green)}
.wc-list{flex:1;overflow-y:auto;overscroll-behavior:contain}
.wc-row{display:flex;align-items:center;gap:12px;width:100%;padding:9px 14px;border:0;background:transparent;color:var(--wa-tx);cursor:pointer;text-align:left}.wc-row:hover{background:var(--wa-row)}.wc-row.on{background:var(--wa-hd)}
.wc-rt{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;padding:3px 0 9px;border-bottom:1px solid var(--wa-line)}
.wc-r1,.wc-r2{display:flex;align-items:center;gap:6px;min-width:0}.wc-r1 b{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:15.5px;font-weight:500}
.wc-r1 small{font-size:12px;color:var(--wa-tx2)}.wc-r1 small.wc-new{color:var(--wa-acc);font-weight:600}
.wc-prev{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13.5px;color:var(--wa-tx2)}.wc-prev i{font-style:normal}
.wc-cnt{font-style:normal;min-width:20px;height:20px;padding:0 6px;border-radius:99px;background:var(--wa-acc);color:#fff;font:700 11.5px/20px var(--font);text-align:center}.wc-cnt.mute{background:var(--wa-tx2)}
.wc-atb{font-style:normal;width:20px;height:20px;border-radius:50%;background:var(--wa-acc);color:#fff;font:700 12px/20px var(--font);text-align:center}.wc-ic{font-style:normal;font-size:12px;opacity:.75}
.wc-typing{color:var(--wa-acc)!important;font-style:normal}.wc-lhd{padding:14px 16px 6px;font:600 13px var(--font);color:var(--wa-green)}.wc-none{display:block;padding:24px;text-align:center;color:var(--wa-tx2)}
.wc-av{width:var(--s);height:var(--s);border-radius:50%;flex:none;display:inline-grid;place-items:center;color:#fff;font:600 calc(var(--s)*.38) var(--font);user-select:none}.wc-av-g{background:var(--wa-hd);color:var(--wa-tx);font-size:calc(var(--s)*.5)}
.wc-main{position:relative;display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--wa-bg)!important}
#tcPanel .wc-side{background:var(--wa-side)!important}
.wc-main::before{content:'';position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(var(--wa-dot) 1.2px,transparent 1.4px),radial-gradient(var(--wa-dot) 1.2px,transparent 1.4px);background-size:28px 28px;background-position:0 0,14px 14px}
.wc-empty{margin:auto;max-width:420px;text-align:center;color:var(--wa-tx2);display:flex;flex-direction:column;gap:10px;align-items:center;position:relative}.wc-empty div{font-size:64px;opacity:.6}.wc-empty b{font-size:1.6rem;font-weight:300;color:var(--wa-tx)}
.wc-ch{position:relative;z-index:1;display:flex;align-items:center;gap:6px;padding:8px 10px;background:var(--wa-hd);min-height:60px}
.wc-chid{flex:1;min-width:0;display:flex;align-items:center;gap:12px;border:0;background:transparent;color:var(--wa-tx);cursor:pointer;text-align:left;padding:0 4px}
.wc-chid span{display:flex;flex-direction:column;min-width:0}.wc-chid b{font-size:15.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wc-chid small{font-size:12.5px;color:var(--wa-tx2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wc-cha{display:flex}.wc-back{display:none}
.wc-find{position:relative;z-index:1;display:flex;align-items:center;gap:4px;padding:6px 10px;background:var(--wa-hd);border-top:1px solid var(--wa-line)}.wc-find[hidden],.wc-pin[hidden],.wc-bar[hidden],.wc-at-list[hidden]{display:none}
.wc-find input{flex:1;height:34px;border-radius:8px;border:0!important;padding:0 10px!important;background:var(--wa-panel)!important;color:var(--wa-tx)!important}.wc-find span{font-size:12px;color:var(--wa-tx2);min-width:34px;text-align:center}
.wc-pin{position:relative;z-index:1;display:flex;align-items:center;background:var(--wa-panel);border-bottom:1px solid var(--wa-line)}.wc-pin>button:first-child{flex:1;display:flex;gap:10px;align-items:center;border:0;background:transparent;color:var(--wa-tx);padding:8px 14px;cursor:pointer;text-align:left;min-width:0}
.wc-pin span:last-child{display:flex;flex-direction:column;min-width:0;font-size:13px;color:var(--wa-tx2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wc-pin b{color:var(--wa-green);font-size:12px}
.wc-msgs{position:relative;flex:1;overflow-y:auto;overscroll-behavior:contain;padding:12px 6% 16px;display:flex;flex-direction:column;gap:2px}
.wc-day{text-align:center;margin:10px 0 6px;position:sticky;top:4px;z-index:2}.wc-day span{display:inline-block;font:500 12px var(--font);color:var(--wa-tx2);padding:5px 12px;border-radius:8px;background:var(--wa-panel);box-shadow:0 1px .5px rgba(0,0,0,.13)}
.wc-sys{position:static}.wc-sys span{background:#ffeecd;color:#54656f}.wc-dark .wc-sys span{background:#182229;color:#8696a0}
.wc-hello{margin:12px auto;max-width:440px;text-align:center;font-size:12.5px;color:#54656f;background:#ffeecd;padding:7px 12px;border-radius:8px;box-shadow:0 1px .5px rgba(0,0,0,.13)}.wc-dark .wc-hello{background:#182229;color:#ffd279}
.wc-msg{display:flex;transition:transform .15s}.wc-msg.first{margin-top:8px}.wc-msg.mine{justify-content:flex-end}.wc-msg.has-re{margin-bottom:16px}
.wc-bub{position:relative;max-width:min(78%,560px);min-width:84px;padding:6px 8px 8px 9px;border-radius:8px;background:var(--wa-in);color:var(--wa-tx);box-shadow:0 1px .5px rgba(0,0,0,.13);font-size:14.2px;line-height:1.38}
.wc-msg.mine .wc-bub{background:var(--wa-out)}
.wc-msg.first .wc-bub{border-top-left-radius:0}.wc-msg.mine.first .wc-bub{border-top-left-radius:8px;border-top-right-radius:0}
.wc-msg.first .wc-bub::before{content:'';position:absolute;top:0;left:-8px;border:8px solid transparent;border-top-color:var(--wa-in);border-right-color:var(--wa-in);border-width:0 8px 10px 0;border-style:solid;border-color:transparent var(--wa-in) transparent transparent}
.wc-msg.mine.first .wc-bub::before{left:auto;right:-8px;border-width:0 0 10px 8px;border-color:transparent transparent transparent var(--wa-out)}
.wc-who{display:block;font-size:12.8px;font-weight:600;margin-bottom:2px}
.wc-text{white-space:normal;overflow-wrap:anywhere;padding-right:62px}.wc-msg.mine .wc-text{padding-right:78px}
.wc-text a{color:#027eb5}.wc-at{color:var(--wa-green);font-weight:600}
.tc-room{border:0;background:rgba(0,128,105,.12);color:inherit;font:700 14px var(--font);border-radius:5px;padding:0 4px;cursor:pointer}
.wc-meta{position:absolute;right:8px;bottom:4px;display:inline-flex;gap:3px;align-items:center;font-size:11px;color:var(--wa-tx2);white-space:nowrap}
.wc-tk{font-style:normal;letter-spacing:-3px;font-size:13px;color:var(--wa-tx2);margin-left:3px}.wc-tk.read{color:var(--wa-blue)}.wc-tk.sent{letter-spacing:0}
.wc-chev{position:absolute;top:2px;right:4px;width:26px;height:22px;border:0;border-radius:6px;background:linear-gradient(90deg,transparent,var(--wa-in) 40%);color:var(--wa-tx2);cursor:pointer;opacity:0;transition:opacity .12s;font-size:15px}
.wc-msg.mine .wc-chev{background:linear-gradient(90deg,transparent,var(--wa-out) 40%)}.wc-bub:hover .wc-chev{opacity:1}@media (hover:none){.wc-chev{display:none}}
.wc-re{position:absolute;bottom:-15px;left:8px;display:inline-flex;align-items:center;gap:2px;height:24px;padding:0 7px;border-radius:99px;border:1px solid var(--wa-line);background:var(--wa-panel);color:var(--wa-tx);font-size:13px;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.15)}.wc-msg.mine .wc-re{left:auto;right:8px}.wc-re small{font-size:11px;color:var(--wa-tx2);margin-left:2px}
.wc-quote{display:flex;flex-direction:column;align-items:flex-start;width:100%;margin:0 0 4px;padding:5px 8px;border:0;border-left:4px solid var(--wa-green);border-radius:6px;background:rgba(0,0,0,.05);color:var(--wa-tx2);cursor:pointer;text-align:left;font-size:13px}.wc-dark .wc-quote{background:rgba(255,255,255,.06)}.wc-quote b{font-size:12.5px}.wc-quote span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.wc-fwd{display:block;font-size:12px;color:var(--wa-tx2);font-style:italic;margin-bottom:2px}.wc-del{color:var(--wa-tx2);font-size:13.5px;padding-right:56px;display:block}
.wc-img{display:block;width:min(300px,62vw);max-height:340px;border:0;padding:0;border-radius:6px;overflow:hidden;background:rgba(0,0,0,.08);cursor:zoom-in;margin-bottom:2px}.wc-img img{width:100%;height:100%;object-fit:cover;display:block}
.wc-load{display:grid;place-items:center;height:100%;min-height:80px;color:var(--wa-tx2)}
.wc-voice{display:flex;align-items:center;gap:9px;min-width:min(250px,60vw);padding:4px 52px 12px 2px}
.wc-play{flex:none;width:40px;height:40px;border-radius:50%;border:0;background:var(--wa-green);color:#fff;font-size:14px;cursor:pointer;display:grid;place-items:center}.wc-play:disabled{opacity:.5;cursor:default}.wc-play.on{font-size:12px}
.wc-wave{flex:1;height:4px;border-radius:2px;background:rgba(0,0,0,.18);overflow:hidden;position:relative}.wc-dark .wc-wave{background:rgba(255,255,255,.22)}.wc-wave i{position:absolute;left:0;top:0;bottom:0;background:var(--wa-green);border-radius:2px;transition:width .2s linear}.wc-msg.mine .wc-wave i{background:#53bdeb}
.wc-vt{position:absolute;left:58px;bottom:4px;font-size:11px;color:var(--wa-tx2)}.wc-voice{position:relative}.wc-mic{flex:none;font-size:16px;opacity:.7}
.wc-flash .wc-bub{animation:wcFlash 1.3s ease}@keyframes wcFlash{30%{box-shadow:0 0 0 4px rgba(37,211,102,.45)}}.wc-hit .wc-bub{outline:2px solid #ffd279;outline-offset:1px}
.wc-down{position:absolute;right:18px;bottom:78px;z-index:2;width:42px;height:42px;border-radius:50%;border:0;background:var(--wa-panel);color:var(--wa-tx2);box-shadow:0 2px 6px rgba(0,0,0,.25);cursor:pointer;font-size:20px}.wc-down[hidden]{display:none}
.wc-bar{position:relative;z-index:1;display:flex;align-items:center;gap:8px;padding:8px 10px 0;background:var(--wa-hd)}
.wc-bq{flex:1;min-width:0;display:flex;flex-direction:column;padding:6px 10px;border-left:4px solid var(--wa-green);border-radius:6px;background:var(--wa-panel);font-size:13px;color:var(--wa-tx2)}.wc-bq b{color:var(--wa-green);font-size:12.5px}.wc-bq span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wc-at-list{position:absolute;left:60px;bottom:64px;z-index:3;min-width:220px;max-width:320px;padding:4px;border-radius:10px;background:var(--wa-panel);box-shadow:0 6px 20px rgba(0,0,0,.25)}
.wc-at-list button{display:flex;align-items:center;gap:10px;width:100%;padding:7px 10px;border:0;border-radius:7px;background:transparent;color:var(--wa-tx);font:500 14px var(--font);cursor:pointer;text-align:left}.wc-at-list button:hover,.wc-at-list button:first-child{background:var(--wa-row)}
.wc-comp{position:relative;z-index:1;display:flex;align-items:flex-end;gap:4px;padding:8px 10px calc(8px + env(safe-area-inset-bottom));background:var(--wa-hd)}
.wc-comp textarea{flex:1;height:42px;min-height:42px!important;max-height:140px;resize:none;border:0!important;border-radius:9px!important;padding:11px 12px!important;font:15px/1.35 var(--font)!important;background:var(--wa-panel)!important;color:var(--wa-tx)!important;box-shadow:none!important;outline:0}
.wc-send{width:44px;height:44px;border-radius:50%;border:0;background:var(--wa-green);color:#fff;font-size:17px;cursor:pointer;flex:none;transition:transform .12s}.wc-send:active{transform:scale(.92)}.wc-send.rec{background:#e53935;animation:wcRec 1s infinite}@keyframes wcRec{50%{box-shadow:0 0 0 6px rgba(229,57,53,.25)}}
.wc-pop-layer{position:fixed;inset:0;z-index:10030;display:none;pointer-events:auto}.wc-pop-layer.on{display:block}.wc-layer-bg{position:absolute;inset:0;background:rgba(0,0,0,.25)}
.wc-menu{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);min-width:220px;max-width:min(320px,92vw);max-height:80vh;overflow:auto;padding:6px;border-radius:12px;background:var(--wa-panel);color:var(--wa-tx);box-shadow:0 12px 40px rgba(0,0,0,.35);animation:wcPop .14s ease}
.wc-menu[style*="fixed"]{transform:none}@keyframes wcPop{from{opacity:0;transform:translate(-50%,-50%) scale(.96)}}.wc-menu[style*="fixed"]{animation:none}
.wc-menu>button{display:block;width:100%;padding:10px 14px;border:0;border-radius:8px;background:transparent;color:var(--wa-tx);font:14px var(--font);cursor:pointer;text-align:left}.wc-menu>button:hover{background:var(--wa-row)}.wc-menu .bad,.wc-dlg .bad{color:#ea0038}
.wc-reacts{display:flex;gap:2px;padding:4px 4px 8px;border-bottom:1px solid var(--wa-line);margin-bottom:4px}.wc-reacts button{width:38px;height:38px;border:0;border-radius:50%;background:transparent;font-size:22px;cursor:pointer;transition:transform .1s}.wc-reacts button:hover{transform:scale(1.18);background:var(--wa-row)}.wc-reacts button.on{background:var(--wa-chip)}
.wc-emo{display:grid;grid-template-columns:repeat(8,1fr);gap:2px;width:min(360px,92vw)}.wc-emo button{height:40px;border:0;border-radius:8px;background:transparent;font-size:22px;cursor:pointer}.wc-emo button:hover{background:var(--wa-row)}
.wc-dlg{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(420px,94vw);max-height:84vh;overflow:auto;border-radius:14px;background:var(--wa-panel);color:var(--wa-tx);box-shadow:0 20px 60px rgba(0,0,0,.4);padding-bottom:12px}
.wc-dlg.wc-big{height:min(680px,88vh);display:flex;flex-direction:column}.wc-dlg header{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--wa-green);color:#fff}.wc-dlg header b{flex:1;font-size:16px;font-weight:600}.wc-dlg header small{opacity:.85}.wc-dlg header .wc-ib{color:#fff}
.wc-dlg h5{margin:14px 16px 4px;font:600 13px var(--font);color:var(--wa-tx2)}.wc-dlg>small,.wc-dlg>.wc-quote{margin:10px 16px;width:auto}
.wc-pr{display:flex;align-items:center;gap:12px;width:100%;padding:9px 16px;border:0;background:transparent;color:var(--wa-tx);text-align:left;font:15px var(--font)}.wc-pick{cursor:pointer}.wc-pick:hover{background:var(--wa-row)}.wc-pr b{font-weight:500}.wc-pe{margin-left:auto;font-size:20px}
.wc-pt{flex:1;min-width:0;display:flex;flex-direction:column}.wc-pt small{color:var(--wa-tx2);font-size:12.5px}.wc-pr input[type=checkbox]{width:20px;height:20px;accent-color:var(--wa-green);margin-left:auto}
.wc-plist{flex:1;overflow:auto}.wc-chips{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px 0}.wc-chips:empty{display:none}.wc-chips button{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px 0 3px;border-radius:99px;border:0;background:var(--wa-hd);color:var(--wa-tx);font:13px var(--font);cursor:pointer}
.wc-fab{position:absolute;right:20px;bottom:20px;width:56px;height:56px;border-radius:16px;border:0;background:var(--wa-acc);color:#fff;font-size:22px;cursor:pointer;box-shadow:0 6px 16px rgba(0,0,0,.25);transition:transform .12s}.wc-fab:active{transform:scale(.94)}
.wc-gnew{display:flex;flex-direction:column;align-items:center;gap:12px;padding:20px}.wc-gicon{border:0;cursor:default}.wc-gemo{display:flex;flex-wrap:wrap;gap:4px;justify-content:center}.wc-gemo button{width:38px;height:38px;border:0;border-radius:10px;background:var(--wa-hd);font-size:19px;cursor:pointer}
.wc-gnew input,.wc-prof input{width:100%;height:42px;border:0!important;border-bottom:2px solid var(--wa-green)!important;border-radius:0!important;background:transparent!important;color:var(--wa-tx)!important;font:16px var(--font)!important;padding:0 4px!important;box-shadow:none!important}.wc-gnew small{color:var(--wa-tx2);text-align:center}
.wc-prof{display:flex;flex-direction:column;align-items:center;gap:6px;padding:22px 20px 14px;border-bottom:8px solid var(--wa-hd)}.wc-prof b{font-size:20px;font-weight:500}.wc-prof small{color:var(--wa-tx2)}
.wc-adm{font-style:normal;font-size:11px;color:var(--wa-green);border:1px solid var(--wa-green);border-radius:5px;padding:1px 5px;margin-left:auto}
.wc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:10px}.wc-grid button{aspect-ratio:1;border:0;padding:0;border-radius:6px;overflow:hidden;cursor:zoom-in}.wc-grid img{width:100%;height:100%;object-fit:cover}
.wc-lb{position:absolute;inset:0;display:grid;place-items:center;background:rgba(0,0,0,.88);cursor:zoom-out}.wc-lb img{max-width:94vw;max-height:90vh;border-radius:6px}
.tc-pop{position:fixed;right:16px;bottom:92px;z-index:10025;display:flex;gap:10px;align-items:center;max-width:min(360px,calc(100vw - 32px));padding:10px 14px;border-radius:14px;border:1px solid var(--border2);background:var(--card2,#111827);color:var(--text);box-shadow:0 18px 40px -16px rgba(0,0,0,.6);cursor:pointer;text-align:left;font:13px/1.4 var(--font);animation:wcIn .3s ease}
.tc-pop span:last-child{min-width:0}.tc-pop b{display:block;font-size:13px}@keyframes wcIn{from{opacity:0;transform:translateY(10px)}}
@media (max-width:768px){.wc-win{inset:auto;left:0;top:var(--vvt,0px);width:100vw;height:var(--vvh,100dvh);border-radius:0;transform:none;grid-template-columns:100% 100%;transition:none;opacity:1}.wc.on .wc-win{transform:none}
  .wc-win{grid-template-columns:1fr}.wc-main{position:absolute;inset:0;transform:translateX(100%);transition:transform .22s cubic-bezier(.2,.8,.2,1)}.wc.wc-in .wc-main{transform:none}
  .wc-back{display:inline-grid}.wc-msgs{padding:10px 10px 14px}.wc-comp textarea{font-size:16px!important}.wc-bub{max-width:86%}.tc-pop{bottom:calc(150px + env(safe-area-inset-bottom))}
  .wc-menu,.wc-dlg{left:0;right:0;top:auto;bottom:0;transform:none;width:100%;max-width:none;border-radius:16px 16px 0 0;animation:wcUp .2s ease}.wc-dlg.wc-big{height:94dvh}@keyframes wcUp{from{transform:translateY(30px);opacity:0}}
  .wc-at-list{left:10px}}
@media (prefers-reduced-motion:reduce){.wc-win,.wc-main,.wc .tc-bg,.wc-msg{transition:none}.wc-menu,.wc-dlg,.tc-pop{animation:none}}`;
    // the chat's own text boxes: no theme's input style (white "booking bar" boxes, borders, square corners) inside them
    s.textContent += `#tcPanel .wc-search input[type=search],#tcPanel .wc-find input[type=search]{border:0!important;background:transparent!important;color:var(--wa-tx)!important;box-shadow:none!important;border-radius:0!important;height:100%!important;padding:0!important;clip-path:none!important;outline:0}
#tcPanel .wc-find input[type=search]{background:var(--wa-panel)!important;border-radius:8px!important;height:34px!important;padding:0 10px!important}
#tcPanel .wc-comp textarea#wcIn{border:0!important;border-radius:9px!important;background:var(--wa-panel)!important;color:var(--wa-tx)!important;box-shadow:none!important;clip-path:none!important;padding:11px 12px!important;font:15px/1.35 var(--font)!important;height:42px;min-height:42px!important}
#tcPanel input::placeholder,#tcPanel textarea::placeholder{color:var(--wa-tx2)!important;opacity:1}
#tcPanel .wc-gnew input,#tcPanel .wc-prof input{background:transparent!important;color:var(--wa-tx)!important;border:0!important;border-bottom:2px solid var(--wa-green)!important;border-radius:0!important;box-shadow:none!important;clip-path:none!important}
#tcPanel .wc-search{background:var(--wa-hd)!important}
#tcPanel textarea:focus-visible,#tcPanel input:focus-visible{outline:0!important;box-shadow:none!important}
html.wc-lock,html.wc-lock body{overflow:hidden!important;overscroll-behavior:none}
@media (max-width:768px){#tcPanel .wc-comp textarea#wcIn{font-size:16px!important}}`;
    D.head.appendChild(s);
  }
  function start() { css(); mountButtons(); setTimeout(mountButtons, 2500); }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', start); else start();
  W.hoTeamChat = { open, close, send, openChat, _pure: { unreadOf: unreadIn, richText, ticks, membersOf, dmId, lastSeen, typers } };
})();

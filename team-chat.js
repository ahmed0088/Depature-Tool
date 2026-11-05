// ═══════════════════════════════════════════════════════════
//  team-chat.js — 💬 Team chat
//  One chat for the hotel's team, live on every PC and phone (hotels/<hotel>/teamChat). The 💬 in the top bar (and More on the
//  phone) opens it; a number shows what you have not read; a new message from a colleague pops up for a few seconds.
//  Room numbers in a message open that room's card. Your own messages can be deleted. The last 300 messages are kept.
// ═══════════════════════════════════════════════════════════
(function () {
  'use strict';
  const W = window, D = document, KEEP = 300;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safe = (f, d) => { try { return f(); } catch (_) { return d; } };
  let MSGS = [], OPEN = false, FIRST = true, LAST_SEEN_TOAST = 0;
  const me = () => safe(() => ({ uid: (currentUser && currentUser.uid) || '', name: (currentProfile && currentProfile.name) || 'Me', role: (currentProfile && currentProfile.role) || '' }), { uid: '', name: 'Me', role: '' });
  const hid = () => safe(() => String(HOTEL_ID || ''), '');
  const READ_KEY = () => 'ho_tc_read_' + hid();
  const lastRead = () => safe(() => +localStorage.getItem(READ_KEY()) || 0, 0);
  const markRead = () => { const t = MSGS.length ? MSGS[MSGS.length - 1].at : Date.now(); safe(() => localStorage.setItem(READ_KEY(), String(Math.max(t, lastRead())))); badge(); };
  /** unread: messages from others after the last read (pure) */
  function unreadOf(msgs, myUid, readAt) { return (msgs || []).filter(m => m && m.uid !== myUid && m.at > readAt).length; }
  /** a message's text → safe HTML with room numbers as buttons (pure) */
  function richText(t) { return esc(t).replace(/\b(\d{3,4})\b/g, '<button type="button" class="tc-room" data-room="$1">$1</button>').replace(/\n/g, '<br>'); }
  const hm = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const dayLbl = t => { const d = new Date(t), n = new Date(); const y = new Date(n); y.setDate(n.getDate() - 1); return d.toDateString() === n.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); };

  function badge() {
    const n = unreadOf(MSGS, me().uid, lastRead());
    D.querySelectorAll('.tc-badge').forEach(b => { b.textContent = n > 99 ? '99+' : String(n); b.hidden = !n || OPEN; });
  }
  function mountButtons() {
    const right = D.querySelector('.topbar-right');
    if (right && !D.getElementById('tcBtn')) {
      const b = D.createElement('button'); b.id = 'tcBtn'; b.type = 'button'; b.className = 'icon-round tc-btn'; b.title = 'Team chat'; b.setAttribute('aria-label', 'Team chat');
      b.innerHTML = '<span aria-hidden="true">💬</span><b class="tc-badge" hidden>0</b>'; b.onclick = () => toggle();
      right.insertBefore(b, right.firstChild);
    }
    const grid = D.querySelector('#mobMoreDrawer .mob-more-grid');
    if (grid && !grid.querySelector('[data-tc]')) {
      const m = D.createElement('button'); m.className = 'mob-more-item'; m.dataset.tc = '1'; m.type = 'button';
      m.innerHTML = '<span class="mob-item-icon">💬</span><b class="tc-badge mob-more-badge" hidden>0</b>Team chat';
      m.onclick = () => { safe(() => closeMobMore()); open(); };
      grid.insertBefore(m, grid.firstChild);
    }
    badge();
  }
  function render() {
    const box = D.getElementById('tcList'); if (!box) return;
    const my = me().uid; let day = '';
    box.innerHTML = MSGS.length ? MSGS.map(m => {
      const d = dayLbl(m.at), sep = d !== day ? `<div class="tc-day"><span>${esc(d)}</span></div>` : ''; day = d;
      const mine = m.uid && m.uid === my;
      return `${sep}<div class="tc-msg${mine ? ' mine' : ''}" data-k="${esc(m.k)}"><div class="tc-bub">${mine ? '' : `<b class="tc-who">${esc(m.name || '—')}${m.role ? ` <i>${esc(m.role)}</i>` : ''}</b>`}<div class="tc-text">${richText(m.text)}</div>
        <span class="tc-meta">${hm(m.at)}${mine ? `<button type="button" class="tc-del" data-del="${esc(m.k)}" title="Delete this message" aria-label="Delete this message">✕</button>` : ''}</span></div></div>`;
    }).join('') : '<div class="tc-empty">💬 No messages yet. Say hello to the team — everyone on shift sees it live, on PC and phone.</div>';
    box.scrollTop = box.scrollHeight;
  }
  function open() {
    css(); let w = D.getElementById('tcPanel');
    if (!w) {
      w = D.createElement('div'); w.id = 'tcPanel'; w.className = 'tc';
      const hotel = safe(() => (D.getElementById('hotelName') || {}).textContent.trim(), '');
      w.innerHTML = `<div class="tc-bg" data-tc-x="1"></div><section class="tc-card" role="dialog" aria-label="Team chat">
        <header class="tc-h"><span aria-hidden="true">💬</span><div><b>Team chat</b><small>${esc(hotel || 'Your hotel')} · everyone on the team sees it live</small></div><button type="button" class="tc-x" data-tc-x="1" aria-label="Close">✕</button></header>
        <div class="tc-list" id="tcList" aria-live="polite"></div>
        <form class="tc-form" id="tcForm"><textarea id="tcIn" rows="1" maxlength="1000" placeholder="Message the team…" title="Room numbers become links" aria-label="Message"></textarea><button type="submit" class="btn gold tc-send" aria-label="Send">➤</button></form></section>`;
      D.body.appendChild(w);
      const inp = w.querySelector('#tcIn');
      w.addEventListener('click', e => {
        if (e.target.closest('[data-tc-x]')) { close(); return; }
        const del = e.target.closest('[data-del]'); if (del) { if (confirm('Delete this message for everyone?')) safe(() => fbSet('teamChat/' + del.dataset.del, null)); return; }
        const r = e.target.closest('.tc-room'); if (r) { if (W.hoRoom && typeof W.hoRoom.open === 'function') W.hoRoom.open(r.dataset.room); else safe(() => { showPanel('departures'); const s = D.getElementById('depSearch'); if (s) { s.value = r.dataset.room; s.dispatchEvent(new Event('input', { bubbles: true })); } }); close(); }
      });
      w.querySelector('#tcForm').addEventListener('submit', e => { e.preventDefault(); send(inp.value); inp.value = ''; inp.style.height = ''; inp.focus(); });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); w.querySelector('#tcForm').requestSubmit(); } if (e.key === 'Escape') close(); });
      inp.addEventListener('input', () => { inp.style.height = 'auto'; inp.style.height = Math.min(120, inp.scrollHeight) + 'px'; });
    }
    D.getElementById('tcPop')?.remove();   // the pop-up's message is on screen now
    w.classList.add('on'); OPEN = true; render(); markRead();
    setTimeout(() => { const i = D.getElementById('tcIn'); if (i && matchMedia('(hover: hover)').matches) i.focus(); }, 50);
  }
  function close() { const w = D.getElementById('tcPanel'); if (w) w.classList.remove('on'); OPEN = false; badge(); }
  function toggle() { if (OPEN) close(); else open(); }
  async function send(text) {
    text = String(text || '').replace(/\s+$/, '').slice(0, 1000); if (!text.trim()) return;
    if (typeof fbSet !== 'function') { safe(() => showToast('Not connected — try again in a moment', 'err')); return; }
    const u = me(), at = Date.now(), k = at.toString(36) + Math.random().toString(36).slice(2, 6);
    const msg = { at, uid: u.uid, name: String(u.name).slice(0, 40), role: String(u.role).slice(0, 20), text };
    MSGS = MSGS.concat(Object.assign({ k }, msg)); render(); markRead();
    try { await fbSet('teamChat/' + k, msg); } catch (_) { safe(() => showToast('Message not sent — check the connection', 'err')); }
    if (MSGS.length > KEEP) MSGS.slice(0, MSGS.length - KEEP).forEach(m => safe(() => fbSet('teamChat/' + m.k, null)));   // keep the last 300
  }
  function onData(v) {
    const before = MSGS.length ? MSGS[MSGS.length - 1].at : 0;
    MSGS = Object.entries(v || {}).filter(([, m]) => m && typeof m === 'object' && m.text).map(([k, m]) => ({ k, at: +m.at || 0, uid: String(m.uid || ''), name: String(m.name || ''), role: String(m.role || ''), text: String(m.text).slice(0, 1000) }))
      .sort((a, b) => a.at - b.at);
    if (OPEN) { render(); markRead(); } else badge();
    // a new message from a colleague while the chat is closed: a short pop-up (not for the history loading at start)
    const my = me().uid, fresh = MSGS.filter(m => m.at > before && m.uid !== my && Date.now() - m.at < 120000);
    if (!FIRST && !OPEN && fresh.length && Date.now() - LAST_SEEN_TOAST > 4000) { LAST_SEEN_TOAST = Date.now(); const m = fresh[fresh.length - 1]; toastMsg(m); }
    FIRST = false;
  }
  function toastMsg(m) {
    css(); D.getElementById('tcPop')?.remove();
    const p = D.createElement('button'); p.id = 'tcPop'; p.type = 'button'; p.className = 'tc-pop';
    p.innerHTML = `<span>💬</span><span><b>${esc(m.name || 'Team')}</b>${esc(m.text.slice(0, 90))}${m.text.length > 90 ? '…' : ''}</span>`;
    p.onclick = () => { p.remove(); open(); }; D.body.appendChild(p); setTimeout(() => p.remove(), 7000);
  }
  function css() {
    if (D.getElementById('tcCss')) return;
    const s = D.createElement('style'); s.id = 'tcCss';
    s.textContent = `.tc-btn{position:relative}.tc-badge{position:absolute;top:-5px;right:-6px;min-width:18px;height:18px;padding:0 5px;border-radius:99px;background:var(--red,#ef4444);color:#fff;font:700 10.5px/18px var(--font);text-align:center;box-shadow:0 0 0 2px var(--bg)}.tc-badge[hidden]{display:none}
.mob-more-item .tc-badge{top:6px;right:10px}
.tc{position:fixed;inset:0;z-index:10020;pointer-events:none}.tc.on{pointer-events:auto}.tc-bg{position:absolute;inset:0;background:rgba(0,0,0,.35);opacity:0;transition:opacity .2s}.tc.on .tc-bg{opacity:1}
.tc-card{position:absolute;top:0;right:0;bottom:0;width:min(400px,100vw);display:flex;flex-direction:column;background:var(--card2,#111827);color:var(--text);border-left:1px solid var(--border2);box-shadow:-20px 0 50px -20px rgba(0,0,0,.5);transform:translateX(105%);transition:transform .25s cubic-bezier(.2,.8,.2,1)}
.tc.on .tc-card{transform:none}
.tc-h{display:flex;gap:12px;align-items:center;padding:14px 16px;border-bottom:1px solid var(--border)}.tc-h>span{font-size:22px}.tc-h div{flex:1;display:flex;flex-direction:column;gap:2px;min-width:0}.tc-h small{color:var(--text2);font-size:.76rem}
.tc-x{width:38px;height:38px;border-radius:50%;border:1px solid var(--border2);background:transparent;color:var(--text);cursor:pointer}
.tc-list{flex:1;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:6px;overscroll-behavior:contain}
.tc-day{text-align:center;margin:8px 0 4px}.tc-day span{font:700 .68rem var(--font);letter-spacing:.06em;text-transform:uppercase;color:var(--text3);padding:3px 10px;border-radius:99px;background:color-mix(in srgb,var(--text) 6%,transparent)}
.tc-msg{display:flex}.tc-msg.mine{justify-content:flex-end}
.tc-bub{max-width:82%;padding:8px 11px 6px;border-radius:14px 14px 14px 4px;background:var(--card);border:1px solid var(--border)}
.tc-msg.mine .tc-bub{border-radius:14px 14px 4px 14px;background:var(--accent-bg);border-color:var(--accent-border)}
.tc-who{display:block;font-size:.76rem;color:var(--accent);margin-bottom:2px}.tc-who i{font-style:normal;color:var(--text3);font-weight:500}
.tc-text{font-size:.9rem;line-height:1.45;overflow-wrap:anywhere}
.tc-room{border:0;background:color-mix(in srgb,var(--accent) 16%,transparent);color:inherit;font:700 .88rem var(--font);border-radius:6px;padding:0 4px;cursor:pointer}
.tc-meta{display:flex;justify-content:flex-end;gap:6px;align-items:center;margin-top:2px;font-size:.68rem;color:var(--text3)}
.tc-del{border:0;background:none;color:var(--text3);cursor:pointer;font-size:.7rem;padding:0 2px}.tc-del:hover{color:var(--red,#ef4444)}
.tc-empty{margin:auto;max-width:260px;text-align:center;color:var(--text2);font-size:.88rem;line-height:1.5}
.tc-form{display:flex;gap:8px;align-items:flex-end;padding:10px 12px calc(12px + env(safe-area-inset-bottom));border-top:1px solid var(--border)}
.tc-form textarea{flex:1;min-height:42px;max-height:120px;resize:none;border-radius:12px;padding:10px 12px;font:14px/1.4 var(--font);background:var(--bg2);color:var(--text);border:1px solid var(--border2)}
.tc-send{width:46px;height:42px;padding:0;justify-content:center;font-size:16px;border-radius:12px}
.tc-pop{position:fixed;right:16px;bottom:92px;z-index:10025;display:flex;gap:10px;align-items:flex-start;max-width:min(340px,calc(100vw - 32px));padding:11px 14px;border-radius:14px;border:1px solid var(--border2);background:var(--card2,#111827);color:var(--text);box-shadow:0 18px 40px -16px rgba(0,0,0,.6);cursor:pointer;text-align:left;font:13px/1.4 var(--font);animation:tcIn .3s ease}
.tc-pop b{display:block;font-size:12.5px}@keyframes tcIn{from{opacity:0;transform:translateY(10px)}}
@media (max-width:600px){.tc-card{width:100vw;border-left:0}.tc-form textarea{font-size:16px}.tc-pop{bottom:calc(150px + env(safe-area-inset-bottom))}}
@media (prefers-reduced-motion:reduce){.tc-card,.tc-bg{transition:none}.tc-pop{animation:none}}`;
    D.head.appendChild(s);
  }
  (function listen(tries) {
    tries = +tries || 0;
    if ((typeof fbListen !== 'function' || typeof _ref === 'undefined' || !_ref) && tries < 400) return setTimeout(() => listen(tries + 1), 1500);
    if (typeof fbListen === 'function') fbListen('teamChat', onData);
  })();
  function start() { css(); mountButtons(); setTimeout(mountButtons, 2500); }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', start); else start();
  W.hoTeamChat = { open, close, send, _pure: { unreadOf, richText } };
})();

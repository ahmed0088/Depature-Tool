// ═══════════════════════════════════════════════════════════
//  roster-swap.js — shift swaps between colleagues, and "My week" picture
//
//  Swaps, the way a front office agrees them:
//    1. from My shifts: 🔁 Ask to swap → a day, a colleague; you see both
//       shifts and whether the rest rules still hold for both of you;
//    2. the colleague taps Agree (or Decline) on their phone;
//    3. a supervisor or manager taps Approve: the posted roster changes
//       and both get the usual "roster changed" message.
//  Pending swaps show on the Roster page and in Ops Brain for whoever has
//  to answer. Firebase: roster/swaps/{id} = { from, to, date, a, b, note,
//  by, at, status: asked | agreed | approved | declined, ... }
//
//  📷 My week: your next 7 days as a picture, to keep or send.
// ═══════════════════════════════════════════════════════════

let rsSwaps = {};
const _rsMe = () => (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || ((roStaff[roMeKey] || {}).name) || 'Someone';
const _rsName = k => (roStaff[k] || {}).name || k;
const _rsFirst = k => String(_rsName(k)).split(' ')[0];
const _rsQ = s => JSON.stringify(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The rest rules for one person if their shift on date became code: [] when fine, else what breaks. */
function rsRestCheck(k, date, code) {
  const R = typeof rbRules === 'function' ? rbRules() : { minRest: 11 };
  const info = roInfo(code), sp = roSpan(date, info), out = [];
  if (!sp) return out;   // a day off or leave never breaks rest
  const isNight = i => i && i.from && (+i.from.slice(0, 2) >= 19 || i.from === '00:00');
  const isDay = i => i && i.from && !isNight(i);
  [-1, 1].forEach(dir => {
    const d2 = roAdd(date, dir), i2 = roInfo(roCode(k, d2)), sp2 = roSpan(d2, i2);
    if (!sp2) return;
    const gap = dir < 0 ? (sp.start - sp2.end) / 3600e3 : (sp2.start - sp.end) / 3600e3;
    if (gap < (R.minRest || 11)) out.push(`only ${Math.max(0, Math.round(gap))} h rest ${dir < 0 ? 'after the day before' : 'before the next day'}`);
    if ((isNight(info) && isDay(i2)) || (isDay(info) && isNight(i2))) out.push(`a ${isNight(info) ? 'night' : 'day shift'} next to a ${isNight(i2) ? 'night' : 'day shift'} with no day off`);
  });
  return [...new Set(out)];
}

// ── A supervisor or manager swaps two people straight away ─
// (most of the team never opens the app: no asking, no approving)
function rsSwapOpen(day, a) {
  if (!roCanEdit()) { rsAskOpen(); return; }
  const days = Array.from({ length: 28 }, (_, i) => roAdd(roToday(), i)).filter(d => Object.keys(roDays[d] || {}).length);
  if (!days.length) { showToast('No posted roster for the coming days yet', 'warn'); return; }
  const people = Object.keys(roStaff).filter(k => !(typeof rbPeople !== 'undefined' && (rbPeople[k] || {}).deleted)).sort((x, y) => (roStaff[x].group || '').localeCompare(roStaff[y].group || '') || _rsName(x).localeCompare(_rsName(y)));
  const opt = (k, sel) => `<option value="${escapeHtml(k)}"${k === sel ? ' selected' : ''}>${escapeHtml(_rsName(k))}${roStaff[k].group ? ' · ' + escapeHtml(roStaff[k].group) : ''}</option>`;
  a = a || roMeKey || people[0];
  document.getElementById('rsDlg')?.remove();
  const d = document.createElement('div');
  d.id = 'rsDlg'; d.className = 'ri-viewer';
  d.innerHTML = `<div class="card rs-dlg">
    <div class="ro-card-hd"><b>🔁 Swap shifts</b><button class="ro-x" onclick="document.getElementById('rsDlg').remove()">✕</button></div>
    <div class="rs-form">
      <label class="rs-wide">Day<select id="rsDay" onchange="rsSwapPreview()">${days.map(x => `<option value="${x}"${x === day ? ' selected' : ''}>${escapeHtml(roDayLbl(x, true))}${x === roToday() ? ' · today' : ''}</option>`).join('')}</select></label>
      <label>Person<select id="rsA" onchange="rsSwapPreview()">${people.map(k => opt(k, a)).join('')}</select></label>
      <label>With<select id="rsB" onchange="rsSwapPreview()">${people.filter(k => k !== a).map(k => opt(k)).join('')}</select></label>
    </div>
    <div id="rsPrev" class="rs-prev"></div>
    <div class="ro-acts"><button class="btn gold" id="rsSend" onclick="rsSwapNow()">Swap now</button><small>Changes the posted roster straight away; both are told if they use the app.</small></div>
  </div>`;
  d.addEventListener('click', e => { if (e.target === d) d.remove(); });
  document.body.appendChild(d);
  rsSwapPreview();
}
function rsSwapPreview() {
  const day = document.getElementById('rsDay').value, A = document.getElementById('rsA').value, Bs = document.getElementById('rsB');
  // "With": people who have something different that day first
  if (Bs.value === A || !Bs.dataset.day || Bs.dataset.day !== day || Bs.dataset.a !== A) {
    const keep = Bs.value, a = roCode(A, day);
    const list = Object.keys(roStaff).filter(k => k !== A && !(typeof rbPeople !== 'undefined' && (rbPeople[k] || {}).deleted))
      .sort((x, y) => ((roStaff[y].group || '') === (roStaff[A].group || '')) - ((roStaff[x].group || '') === (roStaff[A].group || '')) || ((roCode(y, day) !== a) - (roCode(x, day) !== a)) || _rsName(x).localeCompare(_rsName(y)));
    Bs.innerHTML = list.map(k => `<option value="${escapeHtml(k)}"${k === keep ? ' selected' : ''}>${escapeHtml(_rsName(k))} · ${escapeHtml(roCellTxt(roInfo(roCode(k, day))) || '—')}</option>`).join('');
    Bs.dataset.day = day; Bs.dataset.a = A;
  }
  const B = Bs.value, box = document.getElementById('rsPrev');
  const a = roCode(A, day) || '', b = roCode(B, day) || '';
  const probs = [...rsRestCheck(A, day, b).map(x => `${_rsFirst(A)}: ${x}`), ...rsRestCheck(B, day, a).map(x => `${_rsFirst(B)}: ${x}`)];
  const same = a === b;
  const started = typeof rbShiftStarted === 'function' && ((a && roInfo(a) && roInfo(a).from && rbShiftStarted(day, a)) || (b && roInfo(b) && roInfo(b).from && rbShiftStarted(day, b)));
  box.innerHTML = `<div class="rs-swap"><div><small>${escapeHtml(_rsFirst(A))} works</small>${_rsCell(b)}<small>instead of</small>${_rsCell(a)}</div><span class="rs-arrow">⇄</span><div><small>${escapeHtml(_rsFirst(B))} works</small>${_rsCell(a)}<small>instead of</small>${_rsCell(b)}</div></div>
    ${same ? '<div class="rs-warn">Both have the same that day: nothing would change.</div>' : `${started ? '<div class="rs-warn">⚠ One of these shifts has already started.</div>' : ''}${probs.length ? `<div class="rs-warn">⚠ ${probs.map(escapeHtml).join(' · ')}</div>` : '<div class="rs-ok">✓ Rest rules hold for both.</div>'}`}`;
  document.getElementById('rsSend').disabled = same;
}
function _rsApply(A, B, day, why) {
  const a = roCode(A, day) || '', b = roCode(B, day) || '';
  const week = roMonday(roDate(day)), cells = rtPublished(week);
  cells[A] = cells[A] || {}; cells[B] = cells[B] || {};
  if (b) cells[A][day] = b; else delete cells[A][day];
  if (a) cells[B][day] = a; else delete cells[B][day];
  const n = rtApplyPublished(week, cells, why);
  if (typeof rbDrafts !== 'undefined' && rbDrafts[week] && rbDrafts[week].fromPublished) { rbDrafts[week].cells = cells; if (typeof rbPutDraft === 'function') rbPutDraft(week); }
  return n;
}
function rsSwapNow() {
  const day = document.getElementById('rsDay').value, A = document.getElementById('rsA').value, B = document.getElementById('rsB').value;
  const a = roCode(A, day) || '', b = roCode(B, day) || '';
  _rsApply(A, B, day, `swap: ${_rsFirst(A)} ↔ ${_rsFirst(B)}`);
  const id = 's' + Date.now().toString(36);
  rsSwaps[id] = { from: A, to: B, date: day, a, b, by: _rsMe(), at: Date.now(), status: 'approved', closedBy: _rsMe(), closedAt: Date.now(), direct: true };
  if (typeof fbSet === 'function') fbSet('roster/swaps/' + id, rsSwaps[id]);
  if (typeof logActivity === 'function') try { logActivity('swap_done', `${_rsName(A)} ↔ ${_rsName(B)} · ${day}`); } catch (_) {}
  document.getElementById('rsDlg')?.remove();
  showToast(`🔁 Swapped: ${_rsFirst(A)} now ${roCellTxt(roInfo(b)) || '—'}, ${_rsFirst(B)} now ${roCellTxt(roInfo(a)) || '—'} on ${roDayLbl(day)}`, 'ok');
  rsRender();
}

// ── Asking ────────────────────────────────────────────────
function rsAskOpen() {
  if (roCanEdit()) { rsSwapOpen(); return; }   // a supervisor or manager just swaps
  if (!roMeKey) { showToast('Choose your name in My shifts first', 'warn'); return; }
  const days = Array.from({ length: 21 }, (_, i) => roAdd(roToday(), i + 1)).filter(d => Object.keys(roDays[d] || {}).length);
  if (!days.length) { showToast('No posted roster for the coming days yet', 'warn'); return; }
  const g = (roStaff[roMeKey] || {}).group || '';
  const mates = Object.keys(roStaff).filter(k => k !== roMeKey && !(typeof rbPeople !== 'undefined' && (rbPeople[k] || {}).deleted))
    .sort((a, b) => ((roStaff[b].group || '') === g) - ((roStaff[a].group || '') === g) || _rsName(a).localeCompare(_rsName(b)));
  document.getElementById('rsDlg')?.remove();
  const d = document.createElement('div');
  d.id = 'rsDlg'; d.className = 'ri-viewer';
  d.innerHTML = `<div class="card rs-dlg">
    <div class="ro-card-hd"><b>🔁 Ask to swap a shift</b><button class="ro-x" onclick="document.getElementById('rsDlg').remove()">✕</button></div>
    <div class="rs-form">
      <label>Day<select id="rsDay" onchange="rsAskPreview()">${days.map(x => `<option value="${x}">${escapeHtml(roDayLbl(x, true))} · ${escapeHtml(roCellTxt(roInfo(roCode(roMeKey, x))) || '—')}</option>`).join('')}</select></label>
      <label>With<select id="rsWho" onchange="rsAskPreview()">${mates.map(k => `<option value="${escapeHtml(k)}">${escapeHtml(_rsName(k))}${roStaff[k].group && roStaff[k].group !== g ? ' · ' + escapeHtml(roStaff[k].group) : ''}</option>`).join('')}</select></label>
      <label class="rs-wide">Note <small>(optional)</small><input id="rsNote" maxlength="120" placeholder="e.g. family visit, I'll take your Friday instead"></label>
    </div>
    <div id="rsPrev" class="rs-prev"></div>
    <div class="ro-acts"><button class="btn gold" id="rsSend" onclick="rsAskSend()">Send the request</button><small>They agree on their phone, then a supervisor approves it.</small></div>
  </div>`;
  d.addEventListener('click', e => { if (e.target === d) d.remove(); });
  document.body.appendChild(d);
  rsAskPreview();
}
function _rsCell(code) { const i = roInfo(code); return `<span class="rs-cell ro-t-${i ? i.type : 'none'}">${escapeHtml(i ? (i.from ? roTime(i) : i.label || roCellTxt(i)) : 'nothing')}</span>`; }
function rsAskPreview() {
  const day = document.getElementById('rsDay').value, who = document.getElementById('rsWho').value, box = document.getElementById('rsPrev');
  const a = roCode(roMeKey, day) || '', b = roCode(who, day) || '';
  const probs = [...rsRestCheck(roMeKey, day, b).map(x => `You: ${x}`), ...rsRestCheck(who, day, a).map(x => `${_rsFirst(who)}: ${x}`)];
  const same = (roInfo(a) || {}).code === (roInfo(b) || {}).code || a === b;
  box.innerHTML = `<div class="rs-swap"><div><small>You work</small>${_rsCell(b)}<small>instead of</small>${_rsCell(a)}</div><span class="rs-arrow">⇄</span><div><small>${escapeHtml(_rsFirst(who))} works</small>${_rsCell(a)}<small>instead of</small>${_rsCell(b)}</div></div>
    ${same ? '<div class="rs-warn">You both have the same on that day: nothing would change.</div>' : probs.length ? `<div class="rs-warn">⚠ ${probs.map(escapeHtml).join(' · ')}. You can still ask; the supervisor sees this.</div>` : '<div class="rs-ok">✓ Rest rules hold for both of you.</div>'}`;
  document.getElementById('rsSend').disabled = same;
}
function rsAskSend() {
  const day = document.getElementById('rsDay').value, who = document.getElementById('rsWho').value;
  const a = roCode(roMeKey, day) || '', b = roCode(who, day) || '';
  const id = 's' + Date.now().toString(36);
  rsSwaps[id] = { from: roMeKey, to: who, date: day, a, b, note: document.getElementById('rsNote').value.trim(), by: _rsMe(), at: Date.now(), status: 'asked',
    warn: [...rsRestCheck(roMeKey, day, b), ...rsRestCheck(who, day, a)].join('; ') };
  if (typeof fbSet === 'function') fbSet('roster/swaps/' + id, rsSwaps[id]);
  if (typeof logActivity === 'function') try { logActivity('swap_asked', `${_rsName(roMeKey)} ↔ ${_rsName(who)} · ${day}`); } catch (_) {}
  document.getElementById('rsDlg')?.remove();
  showToast(`Asked ${_rsFirst(who)}. You'll see here when they answer.`, 'ok');
  rsRender();
}

// ── Answering ─────────────────────────────────────────────
function _rsSet(id, patch) { const s = rsSwaps[id]; if (!s) return; Object.assign(s, patch); if (typeof fbUpdate === 'function') fbUpdate('roster/swaps/' + id, patch); else fbSet('roster/swaps/' + id, s); rsRender(); }
function rsAgree(id) { _rsSet(id, { status: 'agreed', agreedAt: Date.now() }); showToast('Agreed. A supervisor approves it next.', 'ok'); }
function rsDecline(id) { const s = rsSwaps[id]; if (!s) return; _rsSet(id, { status: 'declined', closedBy: _rsMe(), closedAt: Date.now() }); showToast(s.from === roMeKey ? 'Request withdrawn' : 'Declined', 'ok'); }
function rsApprove(id) {
  const s = rsSwaps[id]; if (!s) return;
  if (!roCanEdit()) { showToast('A supervisor or manager approves swaps', 'err'); return; }
  const a = roCode(s.from, s.date) || '', b = roCode(s.to, s.date) || '';
  if (a !== s.a || b !== s.b) { if (!confirm(`The roster for ${roDayLbl(s.date)} changed since this was asked (${_rsFirst(s.from)}: ${a || '—'}, ${_rsFirst(s.to)}: ${b || '—'}). Swap what they have now?`)) return; }
  if (s.status !== 'agreed' && !confirm(`${_rsFirst(s.to)} hasn't agreed yet. Approve anyway?`)) return;
  const n = _rsApply(s.from, s.to, s.date, `swap: ${_rsFirst(s.from)} ↔ ${_rsFirst(s.to)}`);
  _rsSet(id, { status: 'approved', closedBy: _rsMe(), closedAt: Date.now() });
  showToast(`Swap approved: ${n} cell${n === 1 ? '' : 's'} changed in the posted roster. Both are told.`, 'ok');
}

// ── The list on the Roster page ───────────────────────────
function _rsOpen() { return Object.entries(rsSwaps || {}).filter(([, s]) => s && (s.status === 'asked' || s.status === 'agreed') && s.date >= roToday()).map(([id, s]) => Object.assign({ id }, s)).sort((a, b) => a.date.localeCompare(b.date)); }
function rsRender() {
  const box = document.getElementById('roSwaps'); if (!box) return;
  const ed = typeof roCanEdit === 'function' && roCanEdit();
  const list = _rsOpen().filter(s => ed || s.from === roMeKey || s.to === roMeKey);
  const recent = Object.entries(rsSwaps || {}).map(([id, s]) => Object.assign({ id }, s)).filter(s => s && (s.status === 'approved' || s.status === 'declined') && s.closedAt > Date.now() - 3 * 864e5 && (ed || s.from === roMeKey || s.to === roMeKey)).sort((a, b) => b.closedAt - a.closedAt).slice(0, 4);
  box.hidden = !list.length && !recent.length;
  if (box.hidden) { box.innerHTML = ''; return; }
  const row = s => {
    const mineTo = s.to === roMeKey, mineFrom = s.from === roMeKey, done = s.status === 'approved' || s.status === 'declined';
    const st = { asked: `waiting for ${escapeHtml(_rsFirst(s.to))}`, agreed: `${escapeHtml(_rsFirst(s.to))} agreed · waiting for approval`, approved: '✓ approved', declined: 'declined' }[s.status];
    return `<div class="rs-row${done ? ' rs-done' : ''}">
      <div class="rs-when"><b>${escapeHtml(roDayLbl(s.date))}</b><small>${escapeHtml(st)}</small></div>
      <div class="rs-who"><span><b>${escapeHtml(_rsFirst(s.from))}</b> ${_rsCell(s.a)}</span><span class="rs-arrow">⇄</span><span><b>${escapeHtml(_rsFirst(s.to))}</b> ${_rsCell(s.b)}</span>${s.note ? `<small>“${escapeHtml(s.note)}”</small>` : ''}${s.warn ? `<small class="rs-w">⚠ ${escapeHtml(s.warn)}</small>` : ''}</div>
      <div class="rs-acts">${done ? '' : `${mineTo && s.status === 'asked' ? `<button class="btn sm gold" onclick="rsAgree('${s.id}')">Agree</button><button class="btn sm" onclick="rsDecline('${s.id}')">Decline</button>` : ''}${ed ? `<button class="btn sm${s.status === 'agreed' ? ' gold' : ''}" onclick="rsApprove('${s.id}')">Approve</button>${!mineTo ? `<button class="btn sm ghost" onclick="rsDecline('${s.id}')">Decline</button>` : ''}` : ''}${mineFrom && !ed ? `<button class="btn sm ghost" onclick="rsDecline('${s.id}')">Withdraw</button>` : ''}`}</div>
    </div>`;
  };
  box.innerHTML = `<div class="ro-card-hd"><b>🔁 Shift swaps</b><span>${list.length ? `${list.length} open` : 'recent'}</span></div>${list.map(row).join('')}${recent.length ? `<details class="rs-recent"><summary>Recent</summary>${recent.map(row).join('')}</details>` : ''}`;
}

// ── 📷 My week picture ────────────────────────────────────
/** A person's week as one big, simple picture: days down the page, each shift in its colour. */
function rsWeekCanvas(name, group, days) {
  const W = 1080, H = 1420, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const cs = getComputedStyle(document.documentElement), v = n => (cs.getPropertyValue(n) || '').trim();
  const accent = v('--accent') || '#eab94a';
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0f1420'); g.addColorStop(1, '#070a10');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const font = (w, sz) => `${w} ${sz}px Inter, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif`;
  x.fillStyle = accent; x.font = font(700, 30); x.fillText('MY WEEK', 80, 120);
  x.fillStyle = '#ffffff'; x.font = font(800, 66); x.fillText(String(name).slice(0, 26), 80, 200);
  x.fillStyle = '#9aa6b8'; x.font = font(500, 32);
  x.fillText(`${group ? group + ' · ' : ''}${roDate(days[0].date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${roDate(days[days.length - 1].date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`, 80, 252);
  const COL = { morning: '#f5b84a', afternoon: '#5ab4e8', night: '#a78bfa', other: '#8fa3b8', leave: '#f06b7a', off: '#3a4352' };
  const round = (X, Y, w, h, r) => { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); };
  let y = 310;
  days.slice(0, 7).forEach(dd => {
    const i = roInfo(dd.code), t = i ? i.type : 'off', col = COL[t] || COL.other, today = dd.date === roToday();
    round(60, y, W - 120, 132, 26); x.fillStyle = today ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.045)'; x.fill();
    if (today) { x.strokeStyle = accent; x.lineWidth = 3; x.stroke(); }
    round(60, y, 14, 132, 7); x.fillStyle = col; x.fill();
    x.fillStyle = '#ffffff'; x.font = font(700, 40); x.fillText(roDate(dd.date).toLocaleDateString('en-GB', { weekday: 'long' }), 110, y + 62);
    x.fillStyle = '#8b96a8'; x.font = font(500, 28); x.fillText(roDate(dd.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) + (today ? ' · today' : ''), 110, y + 104);
    const main = i ? (i.from ? roTime(i) : (i.label || roCellTxt(i))) : '—', sub = i ? (i.from ? (RO_TYPES[t] || '') + (i.note ? ' · ' + i.note : '') : '') : 'Not in the roster';
    x.textAlign = 'right'; x.fillStyle = t === 'off' ? '#c5ccd6' : col; x.font = font(800, 46); x.fillText(String(main).slice(0, 18), W - 100, y + 66);
    x.fillStyle = '#8b96a8'; x.font = font(500, 26); x.fillText(String(sub).slice(0, 34), W - 100, y + 104); x.textAlign = 'left';
    y += 148;
  });
  x.fillStyle = '#5f6b7d'; x.font = font(600, 24); x.fillText('HotelOps · ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }), 80, H - 30);
  return c;
}
async function rsMyWeekPic() {
  if (!roMeKey) { showToast('Choose your name in My shifts first', 'warn'); return; }
  const st = roStaff[roMeKey] || {}, days = roMine(7).map(d => ({ date: d.date, code: roCode(roMeKey, d.date) }));
  const c = rsWeekCanvas(st.name || roMeKey, st.group || '', days);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], `My week ${days[0].date}.png`, { type: 'image/png' });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'My week' }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  showToast('📷 Saved your week as a picture', 'ok');
}

// ── Start ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => { if (typeof fbListen === 'function') fbListen('roster/swaps', v => { rsSwaps = v || {}; rsRender(); }); }, 1700);
  // the buttons on My shifts, and the swaps list, every time the side of the Roster page is drawn
  if (typeof roRenderSide === 'function') {
    const orig = roRenderSide;
    window.roRenderSide = roRenderSide = function () {
      orig.apply(this, arguments);
      const me = document.getElementById('roMine');
      if (me && roMeKey && !me.querySelector('.rs-mine-acts')) me.insertAdjacentHTML('beforeend', `<div class="rs-mine-acts"><button class="btn sm" onclick="rsAskOpen()">🔁 ${roCanEdit() ? 'Swap shifts' : 'Ask to swap'}</button><button class="btn sm" onclick="rsMyWeekPic()">📷 My week picture</button></div>`);
      rsRender();
    };
  }
  if (typeof BR_FAQ !== 'undefined') {
    BR_FAQ.push({ q: 'swap shift exchange change shift with colleague trade day', t: 'Swap a shift with a colleague', a: 'Roster → My shifts → <b>🔁 Ask to swap</b>: pick the day and the colleague. You see both shifts and whether the rest rules still hold. They tap <b>Agree</b> on their phone, then a supervisor taps <b>Approve</b> and the posted roster changes.', go: 'roster', kind: '💡 How the app works' });
    BR_FAQ.push({ q: 'my week picture image share my shifts photo send', t: 'My week as a picture', a: 'Roster → My shifts → <b>📷 My week picture</b>: your next 7 days as one picture, to keep or send.', go: 'roster', kind: '💡 How the app works' });
  }
  // Ops Brain: a swap waiting for you
  (window.BL_THINKERS = window.BL_THINKERS || []).push(add => {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    const ed = roCanEdit();
    _rsOpen().forEach(s => {
      if (s.to === roMeKey && s.status === 'asked') add({ id: 'swapAsk:' + s.id, type: 'swap', icon: '🔁', tone: 'warn', text: `${_rsFirst(s.from)} asks to swap ${roDayLbl(s.date)}: you'd work ${roCellTxt(roInfo(s.a)) || '—'} instead of ${roCellTxt(roInfo(s.b)) || '—'}.`, why: s.note || 'Agree or decline on the Roster page.', acts: [['Agree', () => rsAgree(s.id)], ['Open', () => showPanel('roster')]] });
      else if (ed && s.status === 'agreed') add({ id: 'swapOk:' + s.id, type: 'swap', icon: '🔁', tone: 'idle', text: `Swap to approve: ${_rsFirst(s.from)} ⇄ ${_rsFirst(s.to)} on ${roDayLbl(s.date)}.`, why: s.warn ? '⚠ ' + s.warn : 'Both agreed. Approve and the roster changes.', acts: [['Approve', () => rsApprove(s.id)], ['Open', () => showPanel('roster')]] });
    });
  });
});

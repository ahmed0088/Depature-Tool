// ═══════════════════════════════════════════════════════════
//  roster-events.js — 📅 meetings & training on the roster
//  Add a meeting or training by hand, or from Outlook: a saved email
//  (.msg / .eml), a calendar invite (.ics) or the email text pasted in.
//  The app reads the subject, date, time, place and the team members
//  named in it; you check it and save.
//  The roster builder keeps it in mind:
//    • "On shift"  → not their day off, on a shift that covers the time
//    • "Away"      → the whole day is TRN (off the desk)
//    • "Just remind me"
//  Ops Brain reminds you the day before and an hour before.
//  Firebase: roster/builder/events/{id}
// ═══════════════════════════════════════════════════════════

let evAll = {};
const EV_KINDS = { meeting: '👥 Meeting', training: '🎓 Training', other: '📌 Other' };
const EV_PLANS = { cover: 'On shift at that time', away: 'Away all day (TRN)', note: 'Just remind me' };

function evList() { return Object.entries(evAll || {}).filter(([, e]) => e && e.date).map(([id, e]) => Object.assign({ id }, e)).sort((a, b) => a.date.localeCompare(b.date) || (a.from || '').localeCompare(b.from || '')); }
function evDays(e) { const out = [], end = e.until && e.until >= e.date ? e.until : e.date; for (let d = e.date, i = 0; d <= end && i < 31; d = roAdd(d, 1), i++) out.push(d); return out; }
function evOn(k, dt) { return evList().filter(e => (e.keys || []).includes(k) && evDays(e).includes(dt)); }
function evTime(e) { return e.from ? e.from + (e.to ? '–' + e.to : '') : 'all day'; }
function evWho(e) { const ks = e.keys || []; return ks.length ? ks.map(k => ((roStaff[k] || {}).name || k).split(' ')[0]).join(', ') : 'everyone'; }
function _evQ(s) { return escapeHtml(JSON.stringify(String(s))); }
function _evMin(t) { const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; }

/** The shifts that cover the time (fully if any does, else the most of it). */
function evCoverShifts(shifts, from, to) {
  const a = _evMin(from); if (a == null) return shifts.slice();
  let b = _evMin(to); if (b == null) b = a + 60; if (b <= a) b += 1440;
  const ov = shifts.map(s => { const x = rbParse(s); if (!x) return 0; let best = 0; [0, -1440, 1440].forEach(sh => { best = Math.max(best, Math.min(b, x.e + sh) - Math.max(a, x.s + sh)); }); return best; });
  const full = shifts.filter((s, i) => ov[i] >= b - a);
  if (full.length) return full;
  const top = Math.max(0, ...ov);
  return top > 0 ? shifts.filter((s, i) => ov[i] === top) : [];
}
/** For the builder: fills pre (away days), miss (shifts that miss the time) and busy (not a day off). */
function evPre(dates, pre, soft, busy) {
  evList().forEach(e => (e.keys || []).forEach(k => evDays(e).filter(dt => dates.includes(dt)).forEach(dt => {
    if (e.plan === 'note') return;
    if ((pre[k] || {})[dt]) return;                      // leave, sick, a request: that stands
    if (e.plan === 'away') { (pre[k] = pre[k] || {})[dt] = 'TRN'; return; }
    (busy[k] = busy[k] || {})[dt] = true;
    if (!e.from) return;
    const shifts = rbGroupCfg(rbPGroup(k)).shifts, ok = evCoverShifts(shifts, e.from, e.to);
    if (ok.length && ok.length < shifts.length) (soft[k] = soft[k] || {})[dt] = ((soft[k] || {})[dt] || []).concat(shifts.filter(s => !ok.includes(s)));
  })));
}
/** A little 📅 on the roster cell. */
function evMark(k, dt) { const L = evOn(k, dt); return L.length ? `<i class="ev-mark" title="${escapeHtml(L.map(e => `${e.title} · ${evTime(e)}`).join('\n'))}">📅</i>` : ''; }

/** Does the roster fit the event? (posted roster, or the draft for the week being built) */
function evCheck(e) {
  const out = [];
  (e.keys || []).forEach(k => evDays(e).forEach(dt => {
    const w = roMonday(roDate(dt)), D = (typeof rbDrafts !== 'undefined' && rbDrafts[w] && rbDrafts[w].cells) || null;
    const v = (D && (D[k] || {})[dt]) || (roDays[dt] || {})[k] || '';
    if (!v) return;
    const n = ((roStaff[k] || {}).name || k).split(' ')[0], i = roInfo(v), x = rbParse(v);
    if (e.plan === 'note') return;
    if (!x && e.plan === 'cover') out.push(`${n} is ${i && i.label ? i.label.toLowerCase() : v} on ${roDayLbl(dt)}`);
    else if (x && e.plan === 'away') out.push(`${n} works ${rbNorm(v)} on ${roDayLbl(dt)} (training is all day)`);
    else if (x && e.from && !evCoverShifts([v], e.from, e.to).length) out.push(`${n} works ${rbNorm(v)} on ${roDayLbl(dt)}: the ${e.kind === 'training' ? 'training' : 'meeting'} at ${e.from} is outside it`);
  }));
  return out;
}

// ── Builder card ──────────────────────────────────────────
function evBuilderHtml(dates) {
  const today = roToday(), all = evList(), week = all.filter(e => evDays(e).some(d => dates.includes(d))), next = all.filter(e => (e.until || e.date) >= today && !week.includes(e)).slice(0, 6);
  const row = e => { const warn = evCheck(e); return `<div class="ev-row${(e.until || e.date) < today ? ' past' : ''}"><span class="ev-k">${(EV_KINDS[e.kind] || EV_KINDS.other).split(' ')[0]}</span>
    <div class="ev-m"><b>${escapeHtml(e.title || 'Meeting')}</b><span>${escapeHtml(roDayLbl(e.date, true))}${e.until && e.until > e.date ? ' → ' + escapeHtml(roDayLbl(e.until, true)) : ''} · ${escapeHtml(evTime(e))} · ${escapeHtml(evWho(e))}${e.where ? ' · 📍 ' + escapeHtml(e.where) : ''}</span>
    <small>${escapeHtml(EV_PLANS[e.plan] || EV_PLANS.cover)}${warn.length ? '' : (e.keys || []).length && e.plan !== 'note' ? ' · ✓ fits the roster' : ''}</small>${warn.map(w => `<em>⚠ ${escapeHtml(w)}</em>`).join('')}${warn.length && evDays(e).some(d => dates.includes(d)) && typeof rbDrafts !== 'undefined' && rbDrafts[rbWeek] ? '<button class="btn sm ghost ev-fix" onclick="rbBuild()">🔨 Build the week again to fit it</button>' : ''}</div>
    <button class="btn sm ghost" onclick="evEdit(${_evQ(e.id)})">✏️</button><button class="ro-x" title="Delete" onclick="evDel(${_evQ(e.id)})">✕</button></div>`; };
  const n = week.length;
  return `<details class="card rb-card"${typeof rbSec === 'function' ? rbSec('ev', n > 0) : ''}>
    <summary class="ro-card-hd"><b>📅 Meetings & training</b><span>${n ? `<i class="rb-count">${n}</i> this week` : next.length ? next.length + ' coming up' : 'none yet'}</span></summary>
    <div class="ev-acts"><button class="btn sm gold" onclick="evEdit()">＋ Add</button><label class="btn sm">📥 From Outlook<input type="file" accept=".msg,.eml,.ics,.vcs,.txt,message/rfc822,text/calendar" multiple hidden onchange="evImportFiles(this)"></label><button class="btn sm" onclick="evPasteDialog()">📋 Paste the email</button></div>
    <small class="ro-hint">Outlook: drag the email to your desktop (or File → Save as) and pick it here. The builder keeps them in mind and I remind you the day before and an hour before.</small>
    ${n ? `<div class="rb-sub">This week</div>${week.map(row).join('')}` : ''}
    ${next.length ? `<div class="rb-sub">Coming up</div>${next.map(row).join('')}` : ''}
  </details>`;
}
function evPersonHtml(k) {
  const L = evList().filter(e => (e.keys || []).includes(k) && (e.until || e.date) >= roToday()).slice(0, 4);
  return L.length ? `<div class="ev-person">${L.map(e => `<span>📅 <b>${escapeHtml(e.title)}</b> ${escapeHtml(roDayLbl(e.date))} · ${escapeHtml(evTime(e))}</span>`).join('')}</div>` : '';
}

// ── Add / edit ────────────────────────────────────────────
let _evDraft = null;
function evEdit(id, pre) {
  const e = _evDraft = Object.assign({ kind: 'meeting', plan: 'cover', date: roAdd(roToday(), 1), from: '10:00', to: '11:00', keys: [] }, id ? evAll[id] : {}, pre || {}, { id: id || (pre && pre.id) || null });
  document.getElementById('evDlg')?.remove();
  const d = document.createElement('div'); d.id = 'evDlg'; d.className = 'ri-viewer';
  const staff = Object.keys(roStaff).filter(k => !((rbPeople[k] || {}).deleted)).sort((a, b) => roStaff[a].name.localeCompare(roStaff[b].name));
  d.innerHTML = `<div class="card rt-sheet ev-dlg">
    <div class="ro-card-hd"><b>${id ? '✏️ Meeting / training' : '📅 New meeting or training'}</b><button class="ro-x" onclick="evClose()">✕</button></div>
    ${e.src ? `<div class="ev-src">📥 Read from ${escapeHtml(e.src)}: check it and save</div>` : ''}
    <div class="ev-kinds">${Object.entries(EV_KINDS).map(([k, l]) => `<button class="rb-opt${e.kind === k ? ' on' : ''}" onclick="_evSet('kind','${k}',this)">${l}</button>`).join('')}</div>
    <div class="rt-form">
      <label class="ev-wide">What<input id="evT" value="${escapeHtml(e.title || '')}" placeholder="e.g. Fire safety training"></label>
      <label>Day<input type="date" id="evD" value="${escapeHtml(e.date)}"></label>
      <label>Until (more days)<input type="date" id="evU" value="${escapeHtml(e.until || '')}"></label>
      <label>From<input type="time" id="evF" value="${escapeHtml(e.from || '')}"></label>
      <label>To<input type="time" id="evTo" value="${escapeHtml(e.to || '')}"></label>
      <label class="ev-wide">Where<input id="evW" value="${escapeHtml(e.where || '')}" placeholder="e.g. Meeting room, Teams"></label>
    </div>
    <div class="rb-sub">Who <small>tap to pick · none = a reminder for you</small></div>
    <input id="evS" class="ev-search" placeholder="Search the team…" oninput="_evFilter(this.value)">
    <div class="ev-people" id="evP">${staff.map(k => `<button class="rb-opt${(e.keys || []).includes(k) ? ' on' : ''}" data-k="${escapeHtml(k)}" data-n="${escapeHtml(roStaff[k].name.toLowerCase())}" onclick="_evTog(this)">${escapeHtml(roStaff[k].name)}</button>`).join('')}</div>
    <div class="rb-sub">On the roster</div>
    <div class="ev-kinds">${Object.entries(EV_PLANS).map(([k, l]) => `<button class="rb-opt${e.plan === k ? ' on' : ''}" onclick="_evSet('plan','${k}',this)">${l}</button>`).join('')}</div>
    <small class="ro-hint">On shift: not their day off, and on a shift that covers the time (if it can be done). Away: the day is TRN and they don't count on the desk.</small>
    <label class="ev-note">Note<input id="evN" value="${escapeHtml(e.note || '')}" placeholder="optional"></label>
    <div class="ro-acts"><button class="btn gold" onclick="evSave()">Save</button>${id ? `<button class="btn" onclick="evDel(${_evQ(id)});document.getElementById('evDlg').remove()">🗑 Delete</button>` : ''}</div>
  </div>`;
  d.addEventListener('click', ev => { if (ev.target === d) evClose(); });
  document.body.appendChild(d);
}
function _evSet(f, v, btn) { _evDraft[f] = v; btn.parentNode.querySelectorAll('.rb-opt').forEach(b => b.classList.toggle('on', b === btn)); }
function _evTog(btn) { btn.classList.toggle('on'); }
function _evFilter(q) { q = String(q || '').toLowerCase().trim(); document.querySelectorAll('#evP .rb-opt').forEach(b => { b.style.display = !q || b.dataset.n.includes(q) || b.classList.contains('on') ? '' : 'none'; }); }
function evSave() {
  const g = id => (document.getElementById(id) || {}).value || '';
  const e = Object.assign({}, _evDraft, { title: g('evT').trim() || EV_KINDS[_evDraft.kind].slice(3), date: g('evD'), until: g('evU') > g('evD') ? g('evU') : '', from: g('evF'), to: g('evTo'), where: g('evW').trim(), note: g('evN').trim(),
    keys: [...document.querySelectorAll('#evP .rb-opt.on')].map(b => b.dataset.k) });
  if (!e.date) { showToast('Pick the day', 'warn'); return; }
  const id = e.id || 'e' + Date.now().toString(36);
  delete e.id;
  e.by = e.by || ((typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || '');
  e.at = e.at || Date.now();
  Object.keys(e).forEach(k => { if (e[k] === undefined || e[k] === null) delete e[k]; });
  evAll[id] = e; fbSet('roster/builder/events/' + id, e);
  document.getElementById('evDlg')?.remove();
  const warn = evCheck(e);
  showToast(warn.length ? `Saved. ⚠ ${warn[0]}${warn.length > 1 ? ` (+${warn.length - 1})` : ''}` : `Saved: ${e.title} · ${roDayLbl(e.date)}`, warn.length ? 'warn' : 'ok');
  evRefresh();
}
function evDel(id) { if (!evAll[id] || !confirm(`Delete "${evAll[id].title}"?`)) return; delete evAll[id]; fbSet('roster/builder/events/' + id, null); evRefresh(); }
function evClose() { document.getElementById('evDlg')?.remove(); if (typeof rbStale !== 'undefined' && rbStale) evRefresh(); }
function evRefresh() { if (typeof rbRender === 'function' && document.getElementById('panel-roster-build')?.classList.contains('active')) rbRender(); }

// ── Reading Outlook ───────────────────────────────────────
function evPasteDialog() {
  document.getElementById('evDlg')?.remove();
  const d = document.createElement('div'); d.id = 'evDlg'; d.className = 'ri-viewer';
  d.innerHTML = `<div class="card rt-sheet ev-dlg"><div class="ro-card-hd"><b>📋 Paste the email</b><button class="ro-x" onclick="evClose()">✕</button></div>
    <textarea id="evTxt" rows="9" placeholder="Paste the invitation or email here (subject, When:, who is invited)…"></textarea>
    <div class="ro-acts"><button class="btn gold" onclick="evFromText(document.getElementById('evTxt').value,'the pasted email')">Read it</button></div></div>`;
  d.addEventListener('click', ev => { if (ev.target === d) evClose(); });
  document.body.appendChild(d);
  setTimeout(() => document.getElementById('evTxt')?.focus(), 50);
}
function evFromText(text, src) {
  const r = evParse(text);
  if (!r.date) { showToast('I couldn\'t find a date in it: fill it in', 'warn'); }
  if (r.cancel) { const m = evFindSame(r); if (m && confirm(`This cancels "${evAll[m].title}" on ${roDayLbl(evAll[m].date)}. Delete it?`)) { delete evAll[m]; fbSet('roster/builder/events/' + m, null); document.getElementById('evDlg')?.remove(); evRefresh(); return; } }
  const same = evFindSame(r);
  evEdit(same || null, Object.assign({}, r.date ? {} : { date: roAdd(roToday(), 1) }, stripEmpty(r), { src }));
  function stripEmpty(o) { const x = {}; Object.keys(o).forEach(k => { if (o[k] != null && o[k] !== '' && k !== 'cancel' && !(Array.isArray(o[k]) && !o[k].length)) x[k] = o[k]; }); return x; }
}
/** The same meeting already saved (the invite came twice, or was updated). */
function evFindSame(r) {
  return Object.keys(evAll).find(id => { const e = evAll[id]; return e && ((r.uid && e.uid === r.uid) || (r.date && e.date === r.date && r.title && e.title && e.title.toLowerCase() === r.title.toLowerCase())); }) || null;
}
async function evImportFiles(input) {
  const files = [...(input.files || [])]; input.value = '';
  for (const f of files) {
    try {
      const buf = await f.arrayBuffer(), name = f.name.toLowerCase();
      const text = name.endsWith('.msg') || evIsCfb(buf) ? evMsgText(buf) : new TextDecoder('utf-8').decode(buf);
      evFromText(text, f.name);
    } catch (e) { showToast(`Couldn't read ${f.name}: ${e.message}`, 'warn'); }
    if (files.length > 1) await new Promise(res => { const t = setInterval(() => { if (!document.getElementById('evDlg')) { clearInterval(t); res(); } }, 300); });
  }
}

/** Reads subject, date, time, place and team names from an invite (.ics), an email (.eml) or plain text. */
function evParse(raw) {
  let text = String(raw || '').replace(/\r\n?/g, '\n');
  const out = { title: '', date: '', until: '', from: '', to: '', where: '', keys: [], uid: '', cancel: false };
  // an email: decode its parts, keep any calendar part
  if (/^(from|subject|to|date|mime-version|received|content-type):/im.test(text.slice(0, 4000)) && /\n\n/.test(text)) {
    const em = evEml(text); text = em.text;
    out.title = em.subject;
    if (em.ics) { const ic = evIcs(em.ics); Object.keys(ic).forEach(k => { if (ic[k] && !(Array.isArray(ic[k]) && !ic[k].length)) out[k] = ic[k]; }); }
    text = em.people + '\n' + text;
  }
  if (/BEGIN:VEVENT/i.test(text)) { const ic = evIcs(text); Object.keys(ic).forEach(k => { if (ic[k] && !(Array.isArray(ic[k]) && !ic[k].length)) out[k] = ic[k]; }); }
  if (!out.title) { const m = text.match(/^\s*(?:subject|topic|title)\s*:\s*(.+)$/im); if (m) out.title = m[1].trim(); }
  out.title = String(out.title || '').replace(/^\s*((re|fw|fwd|invitation|updated invitation|new time proposed|accepted|tentative|declined|canceled|cancelled)\s*:\s*)+/i, m => { if (/cancel/i.test(m)) out.cancel = true; return ''; }).replace(/\s*@\s*\w{3}.*\d{4}.*$/, '').trim().slice(0, 120);
  if (/\b(cancel+ed|cancellation)\b/i.test(text.slice(0, 400)) || /METHOD:CANCEL/i.test(raw)) out.cancel = true;
  if (!out.date) {
    const when = (text.match(/^\s*(?:when|date|date & time|time)\s*:\s*(.+)$/im) || [])[1] || '';
    const body = text.replace(/^\s*(?:sent|date|received|from|to|cc)\s*:.*$/gim, ' ');   // a forwarded email's "Sent:" date is not the meeting
    const dt = evDateIn(when) || evDateIn(body);
    if (dt) { out.date = dt.date; if (dt.until) out.until = dt.until; }
    const tm = evTimeIn(evStripDates(when)) || evTimeIn(evStripDates(body));
    if (tm) { out.from = tm.from; out.to = tm.to || ''; }
  }
  if (!out.where) { const m = text.match(/^\s*(?:where|location|venue|room)\s*:\s*(.+)$/im); if (m) out.where = m[1].trim().slice(0, 80); }
  if (/microsoft teams|teams meeting|join the meeting now/i.test(text) && !out.where) out.where = 'Teams';
  if (!out.kind) out.kind = /train|course|workshop|session|induction|orientation|certif|first aid|fire|safety|class/i.test(out.title + ' ' + text.slice(0, 600)) ? 'training' : 'meeting';
  out.keys = [...new Set((out.keys || []).concat(evNamesIn(text + '\n' + out.title)))];
  return out;
}
function evIcs(t) {
  const L = String(t).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const ev = L.slice(Math.max(0, L.findIndex(l => /^BEGIN:VEVENT/i.test(l)))), get = k => { const l = ev.find(x => new RegExp('^' + k + '[;:]', 'i').test(x)); return l ? l.slice(l.indexOf(':') + 1).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim() : ''; };
  const at = k => { const l = ev.find(x => new RegExp('^' + k + '[;:]', 'i').test(x)); if (!l) return null; const v = l.slice(l.indexOf(':') + 1).trim(), m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/); if (!m) return null;
    if (!m[4]) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: '' };
    let d = m[7] ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    return { date: roIso(d), time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }; };
  const s = at('DTSTART'), e = at('DTEND'), out = { title: get('SUMMARY'), where: get('LOCATION').slice(0, 80), uid: get('UID').slice(0, 200), keys: [] };
  if (s) { out.date = s.date; out.from = s.time; }
  if (e && s) { out.to = e.time; let last = e.date; if (!e.time && last > s.date) last = roAdd(last, -1); if (last > s.date) out.until = last; }
  const names = ev.filter(l => /^(ATTENDEE|ORGANIZER)/i.test(l)).map(l => (l.match(/CN="?([^";:]+)/i) || [])[1] || (l.match(/mailto:([^@\s]+)/i) || [])[1] || '').join('\n');
  out.keys = evNamesIn(names.replace(/[._]/g, ' ') + '\n' + get('DESCRIPTION'));
  if (/^STATUS:CANCELLED/im.test(ev.join('\n'))) out.cancel = true;
  return out;
}
/** A MIME email → subject, readable text, people in To/Cc, and any calendar part. */
function evEml(t) {
  const split = s => { const i = s.indexOf('\n\n'); return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 2)]; };
  const hdrs = h => { const o = {}; h.replace(/\n[ \t]+/g, ' ').split('\n').forEach(l => { const i = l.indexOf(':'); if (i > 0) o[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim(); }); return o; };
  const [h0, b0] = split(t), H = hdrs(h0), out = { subject: evMimeWord(H.subject || ''), text: '', ics: '', people: [H.to, H.cc, H.from].filter(Boolean).map(evMimeWord).join('\n').replace(/<[^>]*>/g, ' ').replace(/[._]/g, ' ') };
  const walk = (headers, body, depth) => {
    const ct = headers['content-type'] || 'text/plain', bnd = (ct.match(/boundary="?([^";]+)"?/i) || [])[1];
    if (/multipart\//i.test(ct) && bnd && depth < 6) { body.split('--' + bnd).slice(1).forEach(part => { if (/^--/.test(part)) return; const [ph, pb] = split(part.replace(/^\n/, '')); walk(hdrs(ph), pb, depth + 1); }); return; }
    let data = body; const enc = (headers['content-transfer-encoding'] || '').toLowerCase();
    if (enc === 'base64') { try { data = new TextDecoder((ct.match(/charset="?([\w-]+)/i) || [])[1] || 'utf-8').decode(Uint8Array.from(atob(body.replace(/\s+/g, '')), c => c.charCodeAt(0))); } catch (_) { data = ''; } }
    else if (enc === 'quoted-printable') data = evQP(body);
    if (/text\/calendar|application\/ics/i.test(ct) || /BEGIN:VCALENDAR/.test(data)) out.ics = out.ics || data;
    else if (/text\/plain/i.test(ct)) out.text += data + '\n';
    else if (/text\/html/i.test(ct) && !out.text) out.text += data.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&') + '\n';
  };
  walk(H, b0, 0);
  return out;
}
function evQP(s) { const bytes = []; s.replace(/=\n/g, '').replace(/=([0-9A-F]{2})|[\s\S]/gi, (m, h) => { if (h) bytes.push(parseInt(h, 16)); else for (const b of new TextEncoder().encode(m)) bytes.push(b); return ''; }); return new TextDecoder().decode(new Uint8Array(bytes)); }
function evMimeWord(s) { return String(s).replace(/=\?([\w-]+)\?([BQ])\?([^?]*)\?=/gi, (m, cs, e, d) => { try { if (e.toUpperCase() === 'B') return new TextDecoder(cs).decode(Uint8Array.from(atob(d), c => c.charCodeAt(0))); return evQP(d.replace(/_/g, ' ')); } catch (_) { return d; } }); }

const EV_MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const EV_WD = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const EV_DATE_RE = [
  /\b(?:(?:mon|tue|wed|thu|fri|sat|sun)\w*,?\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?\b/gi,
  /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*(\d{4})?\b/gi,
  /\b(\d{4})-(\d{2})-(\d{2})\b/g,
  /\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/g,
];
/** The first date in a text (and a second one right after it, for "13 – 15 Oct" style ranges). */
function evDateIn(s) {
  s = String(s || ''); if (!s) return null;
  const today = roToday(), Y = +today.slice(0, 4), found = [];
  const iso = (y, m, d) => { if (!(m >= 0 && m < 12 && d >= 1 && d <= 31)) return null; const x = new Date(y, m, d); return x.getMonth() === m ? roIso(x) : null; };
  const guessY = (m, d) => { const t = iso(Y, m, d); return t && t < roAdd(today, -60) ? iso(Y + 1, m, d) : t; };
  EV_DATE_RE.forEach((re, i) => { re.lastIndex = 0; let m; while ((m = re.exec(s))) {
    let v = null;
    if (i === 0) v = m[3] ? iso(+m[3], EV_MON.indexOf(m[1].toLowerCase().slice(0, 3)), +m[2]) : guessY(EV_MON.indexOf(m[1].toLowerCase().slice(0, 3)), +m[2]);
    else if (i === 1) v = m[3] ? iso(+m[3], EV_MON.indexOf(m[2].toLowerCase().slice(0, 3)), +m[1]) : guessY(EV_MON.indexOf(m[2].toLowerCase().slice(0, 3)), +m[1]);
    else if (i === 2) v = iso(+m[1], +m[2] - 1, +m[3]);
    else { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; v = iso(y, +m[2] - 1, +m[1]); }   // day/month/year, as in the UAE
    if (v) found.push({ at: m.index, v });
  } });
  if (!found.length) {
    const t = s.toLowerCase();
    if (/\btomorrow\b/.test(t)) return { date: roAdd(today, 1) };
    if (/\btoday\b/.test(t)) return { date: today };
    const w = EV_WD.findIndex(d => new RegExp('\\b(next\\s+)?' + d + '\\b').test(t));
    if (w >= 0) { const now = roDate(today).getDay(); return { date: roAdd(today, ((w - now + 7) % 7) || 7) }; }
    return null;
  }
  found.sort((a, b) => a.at - b.at);
  const out = { date: found[0].v };
  const second = found.find(f => f.at > found[0].at && f.at - found[0].at < 40 && f.v > found[0].v && f.v <= roAdd(found[0].v, 14));
  if (second) out.until = second.v;
  return out;
}
function evStripDates(s) { let t = String(s || ''); EV_DATE_RE.forEach(re => { t = t.replace(re, ' '); }); return t; }
/** "10:00 AM - 11:30 AM", "14:00–16:00", "from 9am to 1pm", "at 3 pm". */
function evTimeIn(s) {
  s = String(s || ''); if (!s) return null;
  const hm = (h, m, ap, apNext) => { h = +h; m = +(m || 0); ap = (ap || apNext || '').toLowerCase(); if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; return h < 24 && m < 60 ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` : null; };
  let m = s.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*([ap]\.?m\.?)?\s*(?:-|–|—|to|until|till)\s*(\d{1,2})(?:[:.](\d{2}))?\s*([ap]\.?m\.?)?/i);
  const ok = x => x && (x[2] || x[3] || x[5] || x[6]);
  if (ok(m)) { const a = (m[3] || '').replace(/\./g, ''), b = (m[6] || '').replace(/\./g, ''); const from = hm(m[1], m[2], a, b), to = hm(m[4], m[5], b); if (from && to) return { from, to }; }
  m = s.match(/\b(\d{1,2})[:.](\d{2})\s*([ap]\.?m\.?)?/i) || s.match(/\b(\d{1,2})\s*([ap])\.?m\.?\b/i);
  if (m) { const from = m.length === 3 ? hm(m[1], 0, m[2] + 'm') : hm(m[1], m[2], (m[3] || '').replace(/\./g, '')); if (from) return { from, to: '' }; }
  return null;
}
/** Team members named in a text: full name, or first + last, or a first name only one person has. */
function evNamesIn(text) {
  const t = ' ' + String(text || '').toLowerCase().replace(/[^a-z؀-ۿ\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const keys = Object.keys(roStaff || {}).filter(k => !((rbPeople[k] || {}).deleted));
  const first = {}; keys.forEach(k => { const f = String(roStaff[k].name || '').toLowerCase().split(/\s+/)[0]; if (f) first[f] = (first[f] || 0) + 1; });
  return keys.filter(k => {
    const parts = String(roStaff[k].name || '').toLowerCase().split(/\s+/).filter(x => x.length > 1); if (!parts.length) return false;
    if (t.includes(' ' + parts.join(' ') + ' ')) return true;
    if (parts.length > 1 && t.includes(' ' + parts[0] + ' ' + parts[parts.length - 1] + ' ')) return true;
    if (parts.length > 1 && parts.slice(1).some(p => p.length > 2 && t.includes(' ' + parts[0] + ' ') && t.includes(' ' + p + ' '))) return true;
    return parts[0].length > 2 && first[parts[0]] === 1 && t.includes(' ' + parts[0] + ' ');
  });
}

// ── Outlook .msg (a Compound File): subject, body, recipients ──
function evIsCfb(buf) { const b = new Uint8Array(buf, 0, 8); return b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0; }
function evCfb(buf) {
  const dv = new DataView(buf), u32 = o => dv.getUint32(o, true);
  const ss = 1 << dv.getUint16(30, true), ms = 1 << dv.getUint16(32, true), cutoff = u32(56) || 4096;
  const nSec = Math.floor((buf.byteLength - ss) / ss);
  const difat = []; for (let i = 0; i < 109; i++) { const v = u32(76 + i * 4); if (v < 0xFFFFFFFA) difat.push(v); }
  let dsec = u32(68), guard = 0; while (dsec < 0xFFFFFFFA && guard++ < 1000) { const o = ss + dsec * ss; for (let i = 0; i < ss / 4 - 1; i++) { const v = u32(o + i * 4); if (v < 0xFFFFFFFA) difat.push(v); } dsec = u32(o + ss - 4); }
  const fat = []; difat.forEach(s => { const o = ss + s * ss; for (let i = 0; i < ss / 4; i++) fat.push(u32(o + i * 4)); });
  const chain = (start, max) => { const out = []; let s = start, n = 0; while (s < 0xFFFFFFFA && s <= nSec && n++ < (max || 1e6)) { out.push(s); s = fat[s]; } return out; };
  const read = start => { const c = chain(start), b = new Uint8Array(c.length * ss); c.forEach((s, i) => b.set(new Uint8Array(buf, ss + s * ss, Math.min(ss, buf.byteLength - ss - s * ss)), i * ss)); return b; };
  const dir = read(u32(48)), ents = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const e = new DataView(dir.buffer, o, 128), nl = e.getUint16(64, true), type = e.getUint8(66);
    if (!type) continue;
    let name = ''; for (let i = 0; i + 1 < nl - 2; i += 2) name += String.fromCharCode(e.getUint16(i, true));
    ents.push({ name, type, start: e.getUint32(116, true), size: e.getUint32(120, true) });
  }
  const root = ents.find(e => e.type === 5), mini = root ? read(root.start) : new Uint8Array(0);
  const mfat = []; { const mf = u32(60) < 0xFFFFFFFA ? read(u32(60)) : new Uint8Array(0), v = new DataView(mf.buffer); for (let i = 0; i + 4 <= mf.length; i += 4) mfat.push(v.getUint32(i, true)); }
  const data = e => {
    if (e.size >= cutoff) return read(e.start).slice(0, e.size);
    const out = new Uint8Array(e.size); let s = e.start, p = 0, n = 0;
    while (s < 0xFFFFFFFA && p < e.size && n++ < 1e5) { const len = Math.min(ms, e.size - p); out.set(mini.subarray(s * ms, s * ms + len), p); p += len; s = mfat[s]; }
    return out;
  };
  return { ents: ents.filter(e => e.type === 2), data };
}
function evMsgText(buf) {
  const C = evCfb(buf), out = { subject: '', body: '', people: [] };
  const str = e => /001F$/i.test(e.name) ? new TextDecoder('utf-16le').decode(C.data(e)) : new TextDecoder('windows-1252').decode(C.data(e));
  C.ents.forEach(e => {
    const m = e.name.match(/^__substg1\.0_([0-9A-F]{4})(001F|001E)$/i); if (!m) return;
    const tag = m[1].toUpperCase();
    try {
      if (tag === '0037' && !out.subject) out.subject = str(e).replace(/\0+$/, '');
      else if (tag === '1000' && !out.body) out.body = str(e);
      else if (['3001', '0E04', '0E03', '0C1A', '0042', '8000'].includes(tag)) out.people.push(str(e));
    } catch (_) {}
  });
  const ics = C.ents.find(e => /^__substg1\.0_37010102$/i.test(e.name) && /BEGIN:VCALENDAR/.test(new TextDecoder().decode(C.data(e).slice(0, 200))));
  return `Subject: ${out.subject}\n${ics ? new TextDecoder().decode(C.data(ics)) + '\n' : ''}${out.people.join('\n').replace(/[._;]/g, ' ')}\n${out.body}`.replace(/\0/g, '');
}

// ── Reminders ─────────────────────────────────────────────
function _evAlerted() { try { return JSON.parse(localStorage.getItem('ev_alerted_v1') || '{}'); } catch (_) { return {}; } }
function evTick() {
  if (typeof roCanEdit !== 'function' || !roCanEdit()) return;
  const now = Date.now(), A = _evAlerted(); let changed = false;
  evList().forEach(e => evDays(e).forEach(dt => {
    const st = roDate(dt); const m = _evMin(e.from); st.setHours(m == null ? 8 : Math.floor(m / 60), m == null ? 0 : m % 60, 0, 0);
    const key = e.id + ':' + dt, lead = m == null ? 0 : 60 * 60e3;
    if (A[key] || now < st.getTime() - lead || now > st.getTime() + 30 * 60e3) return;
    A[key] = now; changed = true;
    const msg = `${(EV_KINDS[e.kind] || '📌').split(' ')[0]} ${m == null ? 'Today' : 'At ' + e.from}: ${e.title} · ${evWho(e)}${e.where ? ' · ' + e.where : ''}`;
    if (typeof bxAlert === 'function') bxAlert('📅', msg, 'Meetings & training'); else showToast(msg, 'ok');
  }));
  if (changed) try { localStorage.setItem('ev_alerted_v1', JSON.stringify(A)); } catch (_) {}
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => { if (typeof fbListen === 'function') fbListen('roster/builder/events', v => { evAll = v || {}; if (!document.getElementById('evDlg')) evRefresh(); }); }, 1700);
  setInterval(evTick, 60000); setTimeout(evTick, 8000);
  (window.BL_THINKERS = window.BL_THINKERS || []).push(add => {
    if (typeof roCanEdit !== 'function' || !roCanEdit()) return;
    const t = roToday(), tm = roAdd(t, 1);
    evList().filter(e => evDays(e).some(d => d === t || d === tm)).slice(0, 3).forEach(e => {
      const isToday = evDays(e).includes(t), warn = evCheck(e);
      add({ id: 'event:' + e.id + ':' + (isToday ? t : tm), type: 'roster', icon: '📅', tone: warn.length ? 'warn' : 'idle', silent: !warn.length,
        text: `${isToday ? 'Today' : 'Tomorrow'} ${evTime(e)}: ${e.title} · ${evWho(e)}${warn.length ? ' · ⚠ ' + warn[0] : ''}`,
        why: (EV_KINDS[e.kind] || '') + (e.where ? ' · ' + e.where : '') });
    });
  });
});

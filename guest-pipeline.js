// ═══════════════════════════════════════════════════════════
//  guest-pipeline.js — Guest Pipeline
//  Neorcha → clean guest list → Purpose of Stay / ALL enrollment
//  → enrollment tracker (shared with the team).
//
//  The two console scripts live in /scripts as plain files, so the page
//  copies the current version with one click and they stay cached offline.
// ═══════════════════════════════════════════════════════════

const GP_SCRIPTS = {
  neorcha: { file: 'scripts/neorcha-extractor.js', name: 'Neorcha Extractor', version: 'v10.0' },
  enroll:  { file: 'scripts/all-enroll.js',        name: 'ALL Enroll',        version: 'v19' }
};

const GP_OTA_RE = /(^|@|\.)(guest\.)?(trip\.com|booking\.com|expedia(partnercentral)?\.com|airbnb\.com|hotels\.com|agoda\.com)$/i;
const GP_EMAIL_FIXES = {
  'gmai.com': 'gmail.com', 'gmial.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmail.co': 'gmail.com',
  'hotmai.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'homail.com': 'hotmail.com',
  'yaho.com': 'yahoo.com', 'yahho.com': 'yahoo.com', 'outlok.com': 'outlook.com',
  'iclould.com': 'icloud.com', 'iclod.com': 'icloud.com'
};

let gpRows = [];          // parsed guests in the workbench
let gpLog = {};           // enrollment tracker: key → { email, status, date, name }
const GP_DRAFT_KEY = 'gp_draft_v1';

// ── Scripts ───────────────────────────────────────────────
async function gpCopyScript(id, btn) {
  const s = GP_SCRIPTS[id];
  try {
    const res = await fetch(s.file, { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    await navigator.clipboard.writeText(await res.text());
    showToast(`${s.name} ${s.version} copied — paste it into the browser console (F12 → Console)`, 'ok');
    if (btn) { const t = btn.textContent; btn.textContent = '✓ Copied'; setTimeout(() => btn.textContent = t, 2000); }
  } catch (e) {
    showToast('Could not copy the script — check your connection and try again', 'err');
  }
}

// ── Workbench: parse the Neorcha TSV ──────────────────────
function gpNormEmail(raw) {
  let e = String(raw || '').trim().toLowerCase();
  if (!e || /^no\s*email/.test(e) || e === 'no@email.com') return { email: '', flag: 'no-email' };
  const p = e.split('@');
  if (p.length !== 2 || !p[0] || !/\.\w{2,}$/.test(p[1])) return { email: e, flag: 'invalid' };
  if (GP_OTA_RE.test('@' + p[1])) return { email: '', flag: 'ota' };
  const fix = GP_EMAIL_FIXES[p[1]];
  if (fix) return { email: p[0] + '@' + fix, flag: 'fixed', was: e };
  return { email: e, flag: '' };
}

function gpLogKey(email) { return String(email || '').toLowerCase().replace(/[.#$\[\]\/@]/g, '_'); }

function gpParse(text) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  let header = null;
  const out = [], seen = new Set();
  for (const line of lines) {
    const c = line.split('\t').map(x => x.trim());
    if (/^confirmation/i.test(c[0])) { header = c.map(x => x.toLowerCase()); continue; }
    const at = re => header ? header.findIndex(h => re.test(h)) : -1;
    const iName = header ? at(/^name/) : 1, iEmail = header ? at(/mail/) : 2;
    const iPhone = header ? at(/phone/) : (c.length >= 5 ? 3 : -1);
    const iNat = header ? at(/national|country/) : (c.length >= 5 ? 4 : 3);
    const conf = c[0];
    if (!conf) continue;
    const dup = seen.has(conf); seen.add(conf);
    const e = gpNormEmail(c[iEmail]);
    const phone = iPhone >= 0 ? (c[iPhone] || '') : '';
    out.push({
      conf, name: c[iName] || '', email: e.email, emailWas: e.was || '', flag: dup ? 'dup' : e.flag,
      phone: /^no\s*phone/i.test(phone) ? '' : phone, nat: iNat >= 0 ? (c[iNat] || '') : '',
      civility: '', consent: false
    });
  }
  return out;
}

function gpLoadText(text) {
  gpRows = gpParse(text);
  // keep ticks / civility from an earlier draft of the same guests
  try {
    const d = JSON.parse(localStorage.getItem(GP_DRAFT_KEY) || '{}');
    gpRows.forEach(r => { const o = d[r.conf]; if (o) { r.civility = o.civility || ''; r.consent = !!o.consent; } });
  } catch (_) {}
  gpRender();
  if (!gpRows.length) showToast('No guests found — paste the Neorcha output (with its header line)', 'err');
}

function gpLoad() { gpLoadText(document.getElementById('gpInput').value); }

async function gpPasteClipboard() {
  try {
    const t = await navigator.clipboard.readText();
    document.getElementById('gpInput').value = t;
    gpLoadText(t);
  } catch (_) { showToast('Clipboard blocked — paste into the box with Ctrl+V', 'err'); }
}

function gpClear() {
  gpRows = []; document.getElementById('gpInput').value = '';
  try { localStorage.removeItem(GP_DRAFT_KEY); } catch (_) {}
  gpRender();
}

function gpSaveDraft() {
  try {
    const d = {};
    gpRows.forEach(r => { if (r.civility || r.consent) d[r.conf] = { civility: r.civility, consent: r.consent }; });
    localStorage.setItem(GP_DRAFT_KEY, JSON.stringify(d));
  } catch (_) {}
}

function gpSet(i, field, val) {
  if (!gpRows[i]) return;
  gpRows[i][field] = val;
  gpSaveDraft();
  gpRenderSummary();
}

// Bulk: tick / untick every usable guest, or set one civility for every usable guest without one.
function gpCanEnroll(r) { const t = gpTracked(r); return gpEligible(r) && !(t && /submitted|already/.test(t.status)); }
function gpSelectAll(on) {
  gpRows.forEach(r => { if (gpCanEnroll(r)) r.consent = on; });
  gpSaveDraft(); gpRender();
}
function gpSetAllCiv(v, overwrite) {
  if (!v) return;
  gpRows.forEach(r => { if (gpCanEnroll(r) && (overwrite || !r.civility)) r.civility = v; });
  gpSaveDraft(); gpRender();
}

const GP_FLAG = {
  'no-email': ['No email', 'warn', 'Neorcha has no email for this guest.'],
  ota:        ['OTA relay', 'warn', 'Booking.com / Expedia / Agoda relay address — it is not the guest\'s own email, so it cannot be used.'],
  invalid:    ['Invalid', 'bad', 'This does not look like a real email address — check it in Opera.'],
  fixed:      ['Typo fixed', 'info', 'The email domain had a common typo and was corrected.'],
  dup:        ['Duplicate', 'bad', 'Same confirmation number appears twice — only the first one is used.']
};

function gpTracked(r) { return r.email ? gpLog[gpLogKey(r.email)] : null; }

function gpEligible(r) { return r.email && r.flag !== 'dup' && r.flag !== 'invalid'; }

function gpRenderSummary() {
  const box = document.getElementById('gpSummary');
  if (!box) return;
  if (!gpRows.length) { box.innerHTML = ''; return; }
  const n = f => gpRows.filter(f).length;
  const ready = n(r => gpEligible(r) && r.consent && r.civility && !(gpTracked(r) && /submitted|already/.test(gpTracked(r).status)));
  box.innerHTML = `
    <span class="gp-stat"><b>${gpRows.length}</b> guests</span>
    <span class="gp-stat ok"><b>${n(r => gpEligible(r))}</b> usable emails</span>
    <span class="gp-stat warn"><b>${n(r => !r.email)}</b> no email / OTA</span>
    <span class="gp-stat info"><b>${n(r => gpTracked(r))}</b> already in the tracker</span>
    <span class="gp-stat ${ready ? 'ok' : ''}"><b>${ready}</b> ready to enroll (agreed + civility)</span>`;
  const all = document.getElementById('gpAllConsent');
  if (all) { const can = gpRows.filter(gpCanEnroll); all.checked = can.length > 0 && can.every(r => r.consent); }
  const btn = document.getElementById('gpCopyEnroll');
  if (btn) btn.disabled = !ready;
  ['gpCloudGo', 'gpCloudTest'].forEach(id => { const b = document.getElementById(id); if (b) b.disabled = !ready; });
}

function gpRender() {
  const body = document.getElementById('gpTable');
  const wrap = document.getElementById('gpTableWrap');
  if (!body || !wrap) return;
  wrap.style.display = gpRows.length ? '' : 'none';
  document.getElementById('gpActions').style.display = gpRows.length ? '' : 'none';
  body.innerHTML = gpRows.map((r, i) => {
    const f = GP_FLAG[r.flag];
    const t = gpTracked(r);
    const tracked = t ? `<span class="gp-flag ${/submitted|already/.test(t.status) ? 'ok' : 'info'}" title="Logged ${escapeHtml(t.date || '')}">${escapeHtml(t.status)}</span>` : '';
    const can = gpEligible(r) && !(t && /submitted|already/.test(t.status));
    return `<tr class="${can ? '' : 'gp-dim'}">
      <td style="font-family:var(--mono);font-size:.7rem;">${escapeHtml(r.conf)}</td>
      <td>${escapeHtml(r.name)}</td>
      <td style="font-size:.74rem;">${escapeHtml(r.email || '—')}${r.emailWas ? `<div style="font-size:.64rem;color:var(--text3);">was ${escapeHtml(r.emailWas)}</div>` : ''}</td>
      <td style="font-size:.72rem;">${escapeHtml(r.phone || '—')}</td>
      <td style="font-size:.72rem;">${escapeHtml(r.nat || '—')}</td>
      <td>${f ? `<span class="gp-flag ${f[1]}" title="${escapeHtml(f[2])}">${f[0]}</span>` : ''} ${tracked}</td>
      <td><select class="gp-civ" onchange="gpSet(${i},'civility',this.value)" ${can ? '' : 'disabled'}>
        ${['', 'Mr', 'Ms', 'Mrs', 'Miss'].map(c => `<option value="${c}"${r.civility === c ? ' selected' : ''}>${c || '—'}</option>`).join('')}
      </select></td>
      <td style="text-align:center;"><input type="checkbox" class="gp-consent" ${r.consent ? 'checked' : ''} ${can ? '' : 'disabled'} onchange="gpSet(${i},'consent',this.checked)" title="Tick only if the guest agreed to join ALL"></td>
    </tr>`;
  }).join('');
  gpRenderSummary();
}

// ── Workbench outputs ─────────────────────────────────────
function gpCleanTsv(rows) {
  return 'Confirmation_Number\tName\tEmail\tPhone\tNationality\n' +
    rows.filter(r => r.flag !== 'dup').map(r => `${r.conf}\t${r.name}\t${r.email || 'No email'}\t${r.phone || 'No phone'}\t${r.nat}`).join('\n');
}

function gpSendToPurpose() {
  if (!gpRows.length) return;
  if (typeof openImportEmailsModal !== 'function' || typeof processImportEmails !== 'function') {
    showToast('Purpose of Stay is not loaded', 'err'); return;
  }
  showPanel('purpose');
  openImportEmailsModal();
  const ta = document.getElementById('importEmailsInput');
  if (ta) ta.value = gpCleanTsv(gpRows);
  processImportEmails();
}

async function gpCopyClean() {
  try { await navigator.clipboard.writeText(gpCleanTsv(gpRows)); showToast('Clean list copied', 'ok'); }
  catch (_) { showToast('Copy blocked', 'err'); }
}

// the guests to enroll: agreed (Consent ticked), a civility, an e-mail, not already submitted / a member
function gpEnrollRows() { return gpRows.filter(r => gpEligible(r) && r.consent && r.civility && !(gpTracked(r) && /submitted|already/.test(gpTracked(r).status))); }
function gpEnrollTsv(rows) { return 'Confirmation_Number\tName\tEmail\tNationality\tCivility\tConsent\n' + rows.map(r => `${r.conf}\t${r.name}\t${r.email}\t${r.nat}\t${r.civility}\tY`).join('\n'); }
async function gpCopyEnroll() {
  const rows = gpEnrollRows();
  if (!rows.length) { showToast('Tick "Agreed" and pick Mr/Ms for the guests who said yes first', 'err'); return; }
  const tsv = gpEnrollTsv(rows);
  try { await navigator.clipboard.writeText(tsv); showToast(`${rows.length} guest(s) copied — paste into the ALL Enroll panel on fc.accor.net`, 'ok'); }
  catch (_) { showToast('Copy blocked', 'err'); }
}

// ── ☁️ Enroll from anywhere, done by the duty PC: fc.accor.net only opens inside Accor's network, so the PC that switched on
// "This PC runs the enrollments" (Chrome + HotelOps + the helper) picks the job up from HotelOps' database (enrollJob), the helper runs
// ALL Enroll v19 on fc.accor.net in a background tab for the guests who AGREED, and the results go to the tracker (enrollLog).
// enrollLive = what the phone sees; enrollAgent = the duty PC saying it is there (every minute).
let gpCloudTag = '', gpAgentBusy = '';
const GP_AGENT_KEY = 'ho_en_agent_v1';
const gpIsAgent = () => { try { return localStorage.getItem(GP_AGENT_KEY) === '1'; } catch (_) { return false; } };
const gpHasHelper = () => !!document.documentElement.dataset.hoEnHelper;
const gpMask = t => String(t || '').replace(/\S+@\S+/g, '•@•').slice(0, 180);
async function gpCloudEnroll(test) {
  const rows = gpEnrollRows();
  if (!rows.length) { showToast('Tick "Agreed" and pick Mr/Ms for the guests who said yes first', 'err'); return; }
  if (!test && !confirm(`Enroll ${rows.length} guest(s) in ALL?\n\nYou confirm each of them agreed at the desk — the form records that you presented ALL and the guest asked for the invitation. Only these ${rows.length} are sent. The duty PC does it.`)) return;
  gpCloudTag = 'en' + Date.now().toString(36);
  const by = (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || '';
  try {
    await fbSet('enrollJob', { tsv: gpEnrollTsv(rows), n: rows.length, at: Date.now(), by, test: !!test, tag: gpCloudTag, state: 'queued' });
    await fbSet('enrollLive', { at: Date.now(), started: Date.now(), state: 'run', step: 'queued', tag: gpCloudTag, test: !!test, n: rows.length, done: 0, note: 'Waiting for the duty PC to pick it up…', con: [] });
  } catch (_) { showToast('Could not save the list', 'err'); return; }
  showToast(test ? '🧪 Test run queued for the duty PC — nothing will be sent' : '☁️ ' + rows.length + ' guest(s) queued — the duty PC enrolls them', 'ok');
}
function gpAgentPaint(a) {
  const el = document.getElementById('gpAgentSt'); if (!el) return;
  const on = a && Date.now() - (+a.at || 0) < 3 * 60000;
  el.innerHTML = on ? `🟢 Duty PC ready${a.name ? ' · ' + escapeHtml(a.name) : ''}` : a ? `⚪ Duty PC offline — last seen ${new Date(+a.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : '⚪ No duty PC yet — switch it on there (below)';
  el.className = 'gp-agent-st ' + (on ? 'on' : 'off');
}
function gpCloudPaint(v) {
  const box = document.getElementById('gpCloudLive'); if (!box || !v) return;
  box.hidden = false;
  const hh = t => { const d = new Date(+t); return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':'); };
  const pct = v.state === 'done' ? 100 : v.n ? Math.round(((+v.done || 0) / v.n) * 85) + ({ queued: 2, open: 6, login: 8, page: 12, enroll: 15 }[v.step] || 4) : 4;
  box.className = 'gp-cloud-live ' + (v.state || '');
  box.innerHTML = `<div class="gp-cl-top"><b>${v.state === 'done' ? '✅' : v.state === 'error' ? '⛔' : '⏳'} ${v.test ? '🧪 Test run · ' : ''}${escapeHtml(v.note || '')}</b></div>
    <div class="gp-cl-bar"><i style="width:${Math.min(100, pct)}%"></i></div>
    ${Array.isArray(v.con) && v.con.length ? `<div class="gp-cl-con">${v.con.slice(-10).map(l => `<div><span>${hh(l.t)}</span><em>${escapeHtml(l.g)}</em>${escapeHtml(l.m)}</div>`).join('')}</div>` : ''}`;
  if (v.state === 'done' && !v.test) setTimeout(gpLoadLog, 800);
}
// ── the duty PC side ──
let gpCon = [];
const gpLive = (p, line) => { if (line) { gpCon.push({ t: Date.now(), g: line[0], m: gpMask(line[1]) }); gpCon = gpCon.slice(-60); } try { return fbUpdate('enrollLive', Object.assign({ at: Date.now(), con: gpCon }, p)); } catch (_) {} };
async function gpAgentTake(job) {
  if (!job || job.state !== 'queued' || gpAgentBusy || !gpIsAgent() || !gpHasHelper()) return;
  gpAgentBusy = job.tag || 'job'; gpCon = [];
  try { await fbUpdate('enrollJob', { state: 'running', takenAt: Date.now() }); } catch (_) {}
  gpLive({ state: 'run', step: 'open', tag: job.tag, test: !!job.test, n: job.n, note: 'The duty PC is opening fc.accor.net (background tab)…' }, ['SYS', 'Duty PC took the job · ' + job.n + ' guest(s) who agreed' + (job.test ? ' · TEST (nothing is sent)' : '')]);
  window.postMessage({ source: 'ho-en-job', tsv: job.tsv, test: !!job.test, tag: job.tag }, location.origin);
  clearTimeout(gpAgentTake.t); gpAgentTake.t = setTimeout(() => { if (gpAgentBusy) { gpLive({ state: 'error', note: 'No answer from fc.accor.net on the duty PC for 60 minutes' }, ['ERR', 'timed out']); gpAgentBusy = ''; fbUpdate('enrollJob', { state: 'error' }); } }, 3600e3);
}
window.addEventListener('message', async e => {
  const m = e.data; if (e.source !== window || !m || typeof m !== 'object' || !gpAgentBusy) return;
  if (m.source === 'ho-en-progress') {
    const login = /log in/i.test(m.note || '');
    if (m.note) gpLive({ step: login ? 'login' : m.n ? 'enroll' : 'page', note: m.note, n: m.n || undefined }, [login ? 'AUTH' : 'BOT', m.note]);
    if (Array.isArray(m.lines)) { m.lines.forEach(l => { const t = String(l).replace(/^\[[^\]]*\]\s*/, ''); if (t.trim()) gpCon.push({ t: Date.now(), g: /SUBMITTED|✅/.test(t) ? 'CARD' : /SKIPPED|ERROR|✗/.test(t) ? 'WARN' : 'BOT', m: gpMask(t) }); });
      gpLive({ step: 'enroll', done: Math.max(0, (+m.k || 1) - 1), note: 'Enrolling guest ' + (m.k || 1) + ' of ' + (m.n || '?') + '…' }); }
    return;
  }
  if (m.source === 'ho-en-done') {
    clearTimeout(gpAgentTake.t); gpAgentBusy = '';
    if (m.error) { gpLive({ state: 'error', note: 'Stopped: ' + m.error }, ['ERR', m.error]); try { await fbUpdate('enrollJob', { state: 'error' }); } catch (_) {} return; }
    if (m.test) { gpLive({ state: 'done', step: 'done', note: 'Test run OK — logged in, enroll page open, ' + m.n + ' guest(s) would be enrolled. Nothing was sent.' }, ['SAVE', 'test OK · nothing sent']); try { await fbUpdate('enrollJob', { state: 'done' }); } catch (_) {} return; }
    const res = Array.isArray(m.results) ? m.results : [], today = hoLocalISO(), patch = {};
    res.forEach(r => { if (r && /@/.test(r.email || '')) { const g = gpRows.find(x => x.email === String(r.email).toLowerCase()); patch[gpLogKey(r.email)] = { email: String(r.email).toLowerCase(), status: String(r.status || 'unknown'), date: today, name: g ? g.name : '', by: 'duty PC' }; } });
    try { if (Object.keys(patch).length) await fbUpdate('enrollLog', patch); } catch (_) {}
    const c = st => res.filter(r => r.status === st).length;
    gpLive({ state: 'done', step: 'done', done: res.length, note: c('submitted') + ' enrolled, ' + c('already-member') + ' already members, ' + c('pending-account') + ' pending — saved in the tracker' }, ['SAVE', res.length + ' results saved']);
    try { await fbUpdate('enrollJob', { state: 'done', doneAt: Date.now() }); } catch (_) {}
  }
});
function gpAgentToggle(on) {
  try { localStorage.setItem(GP_AGENT_KEY, on ? '1' : '0'); } catch (_) {}
  if (on && !gpHasHelper()) showToast('This PC needs the HotelOps helper downloaded again (Settings → WhatsApp helper) so it may open fc.accor.net', 'err');
  else showToast(on ? '🖥️ This PC now runs the enrollments — keep Chrome with HotelOps open, and stay logged in to fc.accor.net' : 'This PC no longer runs the enrollments', 'ok');
  gpAgentBeat();
}
function gpAgentBeat() {
  if (!gpIsAgent() || !gpHasHelper() || typeof fbSet !== 'function') return;
  const name = (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name ? currentProfile.name + "'s " : '') + (navigator.userAgentData && navigator.userAgentData.platform || 'PC');
  try { fbSet('enrollAgent', { at: Date.now(), name }); } catch (_) {}
}
(function gpCloudListen() {
  if (typeof fbListen !== 'function') return setTimeout(gpCloudListen, 1500);
  const t = document.getElementById('gpAgentOn'); if (t) t.checked = gpIsAgent();
  fbListen('enrollLive', v => { if (v && (Date.now() - (+v.at || 0) < 24 * 3600e3)) gpCloudPaint(v); });
  fbListen('enrollAgent', gpAgentPaint);
  fbListen('enrollJob', job => { if (job && job.state === 'queued') gpAgentTake(job); });
  gpAgentBeat(); setInterval(gpAgentBeat, 60000);
})();

// ── Enrollment tracker (shared via Firebase) ──────────────
async function gpLoadLog() {
  try { gpLog = (typeof fbGet === 'function' ? await fbGet('enrollLog') : null) || {}; } catch (_) { gpLog = {}; }
  gpRenderTracker(); gpRender();
}

async function gpImportResults() {
  const raw = (document.getElementById('gpResultsInput').value || '').trim();
  if (!raw) { showToast('Paste the results from the ALL Enroll panel first', 'err'); return; }
  const today = hoLocalISO();
  let added = 0;
  const patch = {};
  raw.split(/\r?\n/).forEach(line => {
    const [email, status, date] = line.split('\t').map(x => (x || '').trim());
    if (!email || /^email$/i.test(email) || !email.includes('@')) return;
    const g = gpRows.find(r => r.email === email.toLowerCase());
    patch[gpLogKey(email)] = gpLog[gpLogKey(email)] = { email: email.toLowerCase(), status: status || 'unknown', date: date || today, name: g ? g.name : '' };
    added++;
  });
  if (!added) { showToast('No result lines found', 'err'); return; }
  // only these rows: colleagues' entries in the shared log stay as they are
  if (typeof fbUpdate === 'function') await fbUpdate('enrollLog', patch);
  else if (typeof fbSet === 'function') await fbSet('enrollLog', gpLog);
  document.getElementById('gpResultsInput').value = '';
  showToast(`${added} result(s) saved to the tracker`, 'ok');
  gpRenderTracker(); gpRender();
}

function gpRenderTracker() {
  const box = document.getElementById('gpTracker');
  if (!box) return;
  const all = Object.values(gpLog);
  const month = (typeof hoLocalISO === 'function' ? hoLocalISO() : new Date().toISOString()).slice(0, 7);   // local month (UTC is still last month until 04:00 on the 1st)
  const m = all.filter(x => String(x.date || '').startsWith(month));
  const c = s => m.filter(x => x.status === s).length;
  const recent = all.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 15);
  box.innerHTML = `
    <div class="gp-kpis">
      <div class="gp-kpi"><div class="gp-kpi-n">${c('submitted')}</div><div class="gp-kpi-l">Invitations sent this month</div></div>
      <div class="gp-kpi"><div class="gp-kpi-n">${c('already-member')}</div><div class="gp-kpi-l">Already members</div></div>
      <div class="gp-kpi"><div class="gp-kpi-n">${c('pending-account')}</div><div class="gp-kpi-l">Pending accounts</div></div>
      <div class="gp-kpi"><div class="gp-kpi-n">${m.length - c('submitted') - c('already-member') - c('pending-account')}</div><div class="gp-kpi-l">Not sent (no consent / error)</div></div>
    </div>
    ${recent.length ? `<table class="gp-table" style="margin-top:10px;"><thead><tr><th>Date</th><th>Guest</th><th>Email</th><th>Result</th></tr></thead><tbody>
      ${recent.map(x => `<tr><td style="font-family:var(--mono);font-size:.7rem;">${escapeHtml(x.date || '')}</td><td>${escapeHtml(x.name || '')}</td><td style="font-size:.74rem;">${escapeHtml(x.email)}</td><td>${escapeHtml(x.status)}</td></tr>`).join('')}
    </tbody></table>` : '<div style="font-size:.76rem;color:var(--text3);margin-top:8px;">Nothing logged yet.</div>'}`;
  const badge = document.getElementById('badge-pipeline');
  if (badge) badge.textContent = c('submitted') || '—';
}

document.addEventListener('DOMContentLoaded', () => { setTimeout(gpLoadLog, 1500); });

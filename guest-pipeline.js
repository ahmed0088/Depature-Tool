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

async function gpCopyEnroll() {
  const rows = gpRows.filter(r => gpEligible(r) && r.consent && r.civility &&
    !(gpTracked(r) && /submitted|already/.test(gpTracked(r).status)));
  if (!rows.length) { showToast('Tick "Agreed" and pick Mr/Ms for the guests who said yes first', 'err'); return; }
  const tsv = 'Confirmation_Number\tName\tEmail\tNationality\tCivility\tConsent\n' +
    rows.map(r => `${r.conf}\t${r.name}\t${r.email}\t${r.nat}\t${r.civility}\tY`).join('\n');
  try { await navigator.clipboard.writeText(tsv); showToast(`${rows.length} guest(s) copied — paste into the ALL Enroll panel on fc.accor.net`, 'ok'); }
  catch (_) { showToast('Copy blocked', 'err'); }
}

// ── Enrollment tracker (shared via Firebase) ──────────────
async function gpLoadLog() {
  try { gpLog = (typeof fbGet === 'function' ? await fbGet('enrollLog') : null) || {}; } catch (_) { gpLog = {}; }
  gpRenderTracker(); gpRender();
}

async function gpImportResults() {
  const raw = (document.getElementById('gpResultsInput').value || '').trim();
  if (!raw) { showToast('Paste the results from the ALL Enroll panel first', 'err'); return; }
  const today = new Date().toISOString().slice(0, 10);
  let added = 0;
  raw.split(/\r?\n/).forEach(line => {
    const [email, status, date] = line.split('\t').map(x => (x || '').trim());
    if (!email || /^email$/i.test(email) || !email.includes('@')) return;
    const g = gpRows.find(r => r.email === email.toLowerCase());
    gpLog[gpLogKey(email)] = { email: email.toLowerCase(), status: status || 'unknown', date: date || today, name: g ? g.name : '' };
    added++;
  });
  if (!added) { showToast('No result lines found', 'err'); return; }
  if (typeof fbSet === 'function') await fbSet('enrollLog', gpLog);
  document.getElementById('gpResultsInput').value = '';
  showToast(`${added} result(s) saved to the tracker`, 'ok');
  gpRenderTracker(); gpRender();
}

function gpRenderTracker() {
  const box = document.getElementById('gpTracker');
  if (!box) return;
  const all = Object.values(gpLog);
  const month = new Date().toISOString().slice(0, 7);
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

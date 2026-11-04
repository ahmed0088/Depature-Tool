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
    const iTitle = header ? at(/^(title|salutation|civility|gender|sex)$/) : -1;
    const conf = c[0];
    if (!conf) continue;
    const dup = seen.has(conf); seen.add(conf);
    const e = gpNormEmail(c[iEmail]);
    const phone = iPhone >= 0 ? (c[iPhone] || '') : '';
    out.push({
      conf, name: c[iName] || '', email: e.email, emailWas: e.was || '', flag: dup ? 'dup' : e.flag,
      phone: /^no\s*phone/i.test(phone) ? '' : phone, nat: iNat >= 0 ? (c[iNat] || '') : '',
      civility: '', consent: false, given: iTitle >= 0 ? (c[iTitle] || '') : ''
    });
  }
  return out;
}

// ── 🪪 The title (Mr / Ms / Mrs) fills itself — nobody has to pick it ──
// 1) the card's own title or gender field  2) the first name, only when it is clearly a man's or a woman's name
// 3) otherwise a pick seeded by the confirmation number (the same guest always gets the same one), marked "guessed"
//    so the desk can tap it once to correct it. The "Agreed" tick is NEVER filled by itself: it is the guest's consent.
const GP_NAMES_M = 'mohammed mohamed muhammad mohammad ahmed ahmad ali omar umar khalid khaled hassan hasan hussein husain ibrahim youssef yousef yusuf abdullah abdallah abdul abdulla abdulrahman abdelrahman mahmoud mustafa mostafa tariq tarek karim kareem faisal fahad fahd saeed said sultan salem saleh nasser rashid rashed hamad hamdan majid walid waleed yasser yasir ziad zaid zayed amr hazem hisham sami samir sameer adel adil ayman imran irfan rizwan bilal hamza usman osman zubair junaid raju rahul rohit amit sumit ankit vikas vikram vijay ajay sanjay rajesh ramesh suresh mahesh ganesh dinesh manoj arjun aditya karan krishna sachin pradeep deepak naveen praveen anil sunil kiran rakesh harish srinivas venkat john james robert michael william david richard joseph thomas charles christopher daniel matthew anthony mark donald steven paul andrew joshua kevin brian george edward ronald timothy jason jeffrey ryan jacob gary nicholas eric jonathan stephen larry justin scott brandon benjamin samuel gregory frank raymond patrick jack dennis jerry tyler aaron henry peter adam nathan douglas zachary kyle walter harold jeremy ethan carl keith roger gerald christian terry arthur sean austin noah lawrence jesse dylan bryan joe bruce albert willie gabriel logan oliver harry charlie liam lucas luke max leo hans klaus jurgen stefan sebastian tobias florian lukas jan pierre francois jacques philippe nicolas olivier antoine julien marco giuseppe giovanni francesco luca matteo alessandro paolo carlos juan jose luis miguel javier pablo diego sergio pedro ivan dmitry dmitri sergey sergei alexey alexei andrey andrei mikhail nikolai vladimir igor oleg yuri pavel artem maxim boris ahmet mehmet mustafa emre burak murat kemal cem saud saoud moosa musa nadeem naeem hatim hatem jasper jasim jassim mansour mansoor marwan anas amjad ammar badr bader fawaz ghassan haitham jamal jaber mazen mohannad munir nabil nizar osama qasim radwan rami raed shadi taha waleed wael zakaria zakariya abbas aziz habib idris ismail ishaq jafar kamal latif malik nasir rafiq salim shakeel shahid tahir wasim yaqub arif asif faisal farhan feroz javed kashif nadir sajid shoaib tanveer zeeshan dieter wolfgang uwe jens jorg ralf rainer thomas markus matthias andreas christoph frank gunter horst manfred werner helmut bernd dirk holger kai oliver patrick sven torsten volker'.split(' ');
const GP_NAMES_F = 'fatima fatma aisha ayesha aysha maryam mariam mariya khadija zainab zeinab noura nora nour hanan hana huda layla leila laila salma sara sarah reem rim amal amira ameera yasmin yasmine jasmine dina dana rana rania lina lana hiba heba mona muna nadia samira sana shaima shaimaa asma alia aliya latifa mai maha manal najla nawal rasha ruba suha wafa iman eman abeer priya pooja puja anjali neha sneha divya kavya shreya swati deepa deepika sunita anita kavita lakshmi meena meera radha rekha seema shilpa sonia sonal nisha asha usha geeta gita sita rani jyoti ritu preeti mary patricia jennifer linda elizabeth barbara susan jessica karen nancy lisa betty margaret sandra ashley kimberly emily donna michelle carol amanda melissa deborah stephanie rebecca laura sharon cynthia kathleen amy angela shirley anna brenda pamela emma nicole helen samantha katherine christine debra rachel catherine carolyn janet ruth maria heather diane virginia julie joyce victoria olivia kelly christina lauren joan evelyn judith megan cheryl martha andrea hannah jacqueline frances gloria ann teresa kathryn sara janice jean alice madison doris abigail julia judy grace denise amber marilyn beverly danielle theresa sophia sophie marie diana brittany natalie isabella charlotte rose alexis kayla chloe mia ella lily zoe emilia anja katja petra sabine claudia monika ursula ingrid birgit nathalie camille chloe manon giulia francesca chiara elena valentina alessia martina carmen lucia isabel ana paula natalia olga tatiana tatyana svetlana irina ekaterina yekaterina anastasia elena oksana yulia julia ksenia daria marina ayse elif zeynep merve tanja tanya anke antje bettina britta carola daniela doris elke gabriele heike ines jana jutta karin katrin kerstin manuela martina melanie nadine nina regina sabrina silke simone stefanie steffi susanne ulrike verena yvonne hessa mouza mozah moza shamsa maitha mahra alya afra hind sheikha ghada lubna mariam marwa nada nesrin rawan reham samar sawsan wafaa yara zahra zahraa farah fatemeh nazia saba sadia shazia uzma rabia ayesha bushra'.split(' ');
const GP_AMBIG = new Set('andrea jean nicola alex sam kim jordan noor nur sasha dana'.split(' '));
const GP_NAME_G = (() => { const m = {}; GP_NAMES_M.forEach(n => { m[n] = 'm'; }); GP_NAMES_F.forEach(n => { m[n] = m[n] === 'm' ? '?' : 'f'; }); return m; })();
/** the title for one guest (pure): { title: 'Mr'|'Ms'|'Mrs', src: 'card'|'name'|'guess' } */
function gpResolveTitle(r) {
  const t = String(r.given || r.title || '').trim().toLowerCase().replace(/\./g, '');
  const T = { mr: 'Mr', mister: 'Mr', m: 'Mr', male: 'Mr', ms: 'Ms', miss: 'Ms', mrs: 'Mrs', f: 'Ms', female: 'Ms', madam: 'Mrs', mme: 'Mrs', mlle: 'Ms' };
  if (T[t]) return { title: T[t], src: 'card' };
  // every part of the name: cards often have the family name first ("Wagner Tanja"); one clear answer wins, mixed = unknown
  const parts = String(r.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[\s,\-]+/).map(w => w.replace(/[^a-z]/g, '')).filter(w => w.length > 1);
  const gs = new Set(parts.map(w => !GP_AMBIG.has(w) && GP_NAME_G[w]).filter(x => x === 'm' || x === 'f'));
  if (gs.size === 1) return gs.has('m') ? { title: 'Mr', src: 'name' } : { title: 'Ms', src: 'name' };
  let h = 2166136261; for (const ch of String(r.conf || r.email || r.name || '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return { title: (h >>> 0) % 2 ? 'Ms' : 'Mr', src: 'guess' };
}
/** fill every empty title (a title someone set by hand is kept) */
function gpAutoTitles() { gpRows.forEach(r => { if (!r.civility) { const x = gpResolveTitle(r); r.civility = x.title; r.civSrc = x.src; } }); }
/** one tap on the title chip: Mr → Ms → Mrs → Mr (for the rare wrong guess) */
function gpCycleTitle(i) { const r = gpRows[i]; if (!r) return; const o = ['Mr', 'Ms', 'Mrs']; r.civility = o[(o.indexOf(r.civility) + 1) % 3]; r.civSrc = 'you'; gpSaveDraft(); gpRenderSummary(); if (document.getElementById('gqBody')) gpQuickPaint(); }

function gpLoadText(text) {
  gpRows = gpParse(text);
  // keep ticks / civility from an earlier draft of the same guests
  try {
    const d = JSON.parse(localStorage.getItem(GP_DRAFT_KEY) || '{}');
    gpRows.forEach(r => { const o = d[r.conf]; if (o) { r.civility = o.civility || ''; r.consent = !!o.consent; if (o.civility) r.civSrc = o.civSrc || 'you'; } });
  } catch (_) {}
  gpAutoTitles();
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
    gpRows.forEach(r => { if (r.civility || r.consent) d[r.conf] = { civility: r.civility, consent: r.consent, civSrc: r.civSrc || '' }; });
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
  ['gpCloudGo', 'gpCloudTest', 'gpAccCloudGo', 'gpAccCloudTest'].forEach(id => { const b = document.getElementById(id); if (b) b.disabled = !ready; });
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
      <td><select class="gp-civ" onchange="gpRows[${i}].civSrc='you';gpSet(${i},'civility',this.value)" ${can ? '' : 'disabled'}>
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
// withPhone: the cloud robot's list also carries the phone (the Accor Loop form has a phone box); the copied ALL Enroll list stays as it was
function gpEnrollTsv(rows, withPhone) {
  const c = v => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ').trim();
  if (withPhone) return 'Confirmation_Number\tName\tEmail\tPhone\tNationality\tCivility\tConsent\n' + rows.map(r => [r.conf, r.name, r.email, r.phone, r.nat, r.civility, 'Y'].map(c).join('\t')).join('\n');
  return 'Confirmation_Number\tName\tEmail\tNationality\tCivility\tConsent\n' + rows.map(r => `${r.conf}\t${r.name}\t${r.email}\t${r.nat}\t${r.civility}\tY`).join('\n');
}
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
// GitHub-hosted Accor Loop runner. This is the normal web cloud path: GitHub creates a temporary
// hosted computer, runs the browser there, reports progress through Firebase, then destroys it.
const GP_ACC_GH = { api: 'https://api.github.com/repos/ahmed0088/Depature-Tool/actions/workflows/accor-loop.yml', key: 'ho_gh_start_key_v1' };
const gpAccKey = () => { try { return localStorage.getItem(GP_ACC_GH.key) || ''; } catch (_) { return ''; } };
async function gpAccGh(path, opt) {
  const token = gpAccKey(); if (!token) throw new Error('Set up the GitHub start key first in Neorcha → Run in the cloud.');
  const r = await fetch(GP_ACC_GH.api + (path || ''), Object.assign({ headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' } }, opt || {}));
  if (r.status === 401) throw new Error('The GitHub start key was refused. Create a new one.');
  if (r.status === 403 || r.status === 404) throw new Error('The start key needs Actions: Read and write for Depature-Tool.');
  if (!r.ok) throw new Error('GitHub answered ' + r.status);
  return r.status === 204 ? null : r.json();
}
async function gpAccControl(action) {
  const live = { at: Date.now(), control: action === 'stop' ? 'stop' : 'run', stopRequested: action === 'stop' };
  try {
    if (action === 'stop' && !confirm('Stop the Accor Loop cloud run? It will finish the current browser action, then stop before the next guest.')) return;
    await fbUpdate('enrollLive', live);
    if (action === 'stop') {
      if (GP_ACC.live) gpCloudPaint(Object.assign({}, GP_ACC.live, { note: 'Stop requested — finishing the current guest, then stopping…' }));
      showToast('Stop requested — the cloud runner will stop safely', 'ok');
    } else {
      showToast('Start requested', 'ok');
    }
  } catch (e) { showToast('Could not send control command: ' + e.message, 'err'); }
}
async function gpAccCloudRestart() {
  const url = (document.getElementById('gpAccorUrl')?.value || '').trim();
  const hid = typeof HOTEL_ID !== 'undefined' ? String(HOTEL_ID || '') : '';
  if (!url || !gpEnrollRows().length) { showToast('Review the selected guests and Accor Loop URL first', 'err'); return; }
  if (!confirm('Start Accor Loop again for the selected guests?')) return;
  gpCloudTag = 'acc' + Date.now().toString(36);
  try {
    await fbUpdate('enrollLive', { at: Date.now(), control: 'run', stopRequested: false, state: 'run', step: 'queued', tag: gpCloudTag, test: false, n: gpEnrollRows().length, done: 0, note: 'Restart requested — waiting for GitHub…', con: [{ t: Date.now(), g: 'SYS', m: 'Run again requested' }] });
    await fbSet('enrollJob', { tsv: gpEnrollTsv(gpEnrollRows(), true), n: gpEnrollRows().length, at: Date.now(), test: false, tag: gpCloudTag, state: 'queued', accorLoop: true, portalUrl: url });
    await gpAccGh('/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { test: '', tag: gpCloudTag, hid, portal_url: url } }) });
    GP_ACC.at = Date.now();
    gpAccorRunWin(true);
    gpAccPoll(gpCloudTag);
    showToast('☁️ Accor Loop started again', 'ok');
  } catch (e) { showToast(e.message, 'err'); }
}
async function gpAccCloudEnroll(test) {
  const rows = gpEnrollRows(); if (!rows.length) { showToast('Tick Agreed and choose a civility first', 'err'); return; }
  const url = (document.getElementById('gpAccorUrl')?.value || '').trim();
  if (!/^https:\/\/secure\.guestinternet\.com\//i.test(url)) { showToast('Enter the Accor Loop enrollment URL first', 'err'); return; }
  if (!test && !confirm(`Run Accor Loop enrollment for ${rows.length} selected guest(s)? Only guests marked Agreed will be sent.`)) return;
  gpCloudTag = 'acc' + Date.now().toString(36); const hid = typeof HOTEL_ID !== 'undefined' ? String(HOTEL_ID || '') : '';
  try { localStorage.setItem('gp_accor_url_v1', url); } catch (_) {}
  try {
    await fbSet('enrollJob', { tsv: gpEnrollTsv(rows, true), n: rows.length, at: Date.now(), by: (currentProfile && currentProfile.name) || '', test: !!test, tag: gpCloudTag, state: 'queued', accorLoop: true, portalUrl: url });
    await fbSet('enrollLive', { at: Date.now(), started: Date.now(), state: 'run', step: 'queued', tag: gpCloudTag, test: !!test, n: rows.length, done: 0, note: 'Starting Accor Loop cloud computer…', con: [] });
    await gpAccGh('/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { test: test ? '1' : '', tag: gpCloudTag, hid, portal_url: url } }) });
    GP_ACC.at = Date.now();
    gpCloudPaint({ at: Date.now(), started: Date.now(), state: 'run', step: 'queued', tag: gpCloudTag, test: !!test, n: rows.length, done: 0, note: 'GitHub accepted the run · waiting for a cloud computer…', con: [{ t: Date.now(), g: 'GH', m: 'Run requested from HotelOps · ' + rows.length + ' guest(s) who agreed' }] });
    gpAccorRunWin(true);
    gpAccPoll(gpCloudTag);
    showToast(test ? '🧪 Accor Loop test started — nothing will be submitted' : '☁️ Accor Loop enrollment started', 'ok');
  } catch (e) { showToast(e.message, 'err'); gpCloudPaint({ at: Date.now(), started: Date.now(), state: 'error', step: 'error', note: e.message, con: [{ t: Date.now(), g: 'ERR', m: e.message }] }); }
}
// GitHub's side of the run (queued / running / failed): kept apart from the robot's own report (enrollLive),
// so a GitHub status never wipes the robot's console. Both are merged by gpCloudPaint.
const GP_ACC = { gh: null, at: 0, tag: '', live: null, timer: 0 };
let gpAccPollTimer = 0;
function gpAccPoll(tag) {
  GP_ACC.tag = tag || GP_ACC.tag; GP_ACC.at = GP_ACC.at || Date.now(); GP_ACC.gh = null;
  clearInterval(gpAccPollTimer);
  const tick = async () => {
    try {
      const j = await gpAccGh('/runs?per_page=10&event=workflow_dispatch');
      const r = (j.workflow_runs || []).filter(x => Date.parse(x.created_at) >= GP_ACC.at - 60000)
        .sort((x, y) => Date.parse(x.created_at) - Date.parse(y.created_at))[0];
      if (r) { GP_ACC.gh = { status: r.status, conclusion: r.conclusion, url: r.html_url }; gpCloudPaint(); }
      if (r && r.status === 'completed') clearInterval(gpAccPollTimer);
    } catch (_) {}
  };
  tick(); gpAccPollTimer = setInterval(tick, 5000);
  setTimeout(() => clearInterval(gpAccPollTimer), 90 * 60000);
}
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
// ── ✍️ Enroll in one place: Neorcha's "Enroll these guests" opens this sheet ──
// The cards come straight from Neorcha. You tick only the guests who said YES and pick Mr/Ms; the Accor Loop
// link is remembered; one button starts the cloud robot and the live window follows. Same rules as the full
// Guest Pipeline page (it is the same list): no e-mail / duplicate / already enrolled / ALL member → can't be ticked.
function gpQuickEnroll(cards) {
  const c = v => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ').trim();
  const list = (cards || []).filter(r => r && r.conf);
  const text = 'Confirmation_Number\tName\tEmail\tPhone\tNationality\tTitle\n' + list.map(r => [r.conf, r.name, r.email || 'No email', r.phone || 'No phone', r.nat, r.title || ''].map(c).join('\t')).join('\n');
  try { const box = document.getElementById('gpInput'); if (box) box.value = text; } catch (_) {}
  gpLoadText(text);
  const info = {}; list.forEach(r => { info[c(r.conf)] = { member: !!r.member, room: c(r.room) }; });
  gpRows.forEach(r => { const x = info[r.conf]; if (x) { r.member = x.member; r.room = x.room; if (r.member) r.consent = false; } });
  gpQuickShow();
}
/** the same sheet for the list already loaded here (the ✍️ button on this page) */
function gpQuickShow() {
  if (!gpRows.length) { showToast('Load the guests first (Neorcha → ✍️ Enroll these guests, or paste the list above)', 'err'); return; }
  let w = document.getElementById('gpQuick');
  if (!w) {
    w = document.createElement('div'); w.id = 'gpQuick'; w.className = 'gp-accor-modal';
    w.innerHTML = '<div class="gp-accor-modal-bg" data-gq-close="1"></div><section class="gp-accor-modal-card gq-card" role="dialog" aria-modal="true" aria-label="Enroll guests in ALL"><header class="gp-accor-modal-h"><span class="gp-accor-modal-ic">✍️</span><div><b>Enroll guests in ALL</b><small id="gqSub"></small></div><button type="button" class="gp-accor-modal-x" data-gq-close="1" aria-label="Close">✕</button></header><div class="gp-accor-modal-b" id="gqBody"></div><footer class="gq-foot" id="gqFoot"></footer></section>';
    document.body.appendChild(w);
    w.addEventListener('click', e => { if (e.target.closest('[data-gq-close]')) w.classList.remove('on'); });
  }
  w.classList.add('on'); gpQuickPaint();
}
function gpQuickCan(r) { return gpCanEnroll(r) && !r.member; }
function gpQuickPaint() {
  const body = document.getElementById('gqBody'), foot = document.getElementById('gqFoot'); if (!body) return;
  const can = gpRows.map((r, i) => [r, i]).filter(([r]) => gpQuickCan(r)), off = gpRows.filter(r => !gpQuickCan(r));
  const why = r => r.member ? '💎 already an ALL member' : !r.email ? 'no e-mail' : r.flag === 'dup' ? 'listed twice' : r.flag === 'invalid' ? 'e-mail looks wrong' : gpTracked(r) ? 'already enrolled (' + gpTracked(r).status + ')' : 'can\'t be enrolled';
  let url = ''; try { url = (document.getElementById('gpAccorUrl') || {}).value || localStorage.getItem('gp_accor_url_v1') || ''; } catch (_) {}
  gpAutoTitles();
  const sub = document.getElementById('gqSub'); if (sub) sub.textContent = can.length + ' guest' + (can.length === 1 ? '' : 's') + ' can be enrolled · tick only the ones who said YES · titles fill themselves';
  body.innerHTML = `<label class="gq-url"><span>🔗 Accor Loop link</span><input id="gqUrl" type="url" value="${escapeHtml(url)}" placeholder="https://secure.guestinternet.com/…" autocomplete="url"></label>
    ${can.length ? `<div class="gq-bar"><span>Tap a guest to tick them</span><button type="button" class="btn sm" onclick="gpQuickAll(${can.every(([r]) => r.consent) ? 'false' : 'true'})">${can.every(([r]) => r.consent) ? '✕ Untick all' : '✓ Tick all'}</button></div><div class="gq-list">${can.map(([r, i]) => `<div class="gq-row${r.consent ? ' on' : ''}" onclick="if(!event.target.closest('.gq-title,input,label'))gpQuickTick(${i})">
      <label class="gq-yes"><input type="checkbox" ${r.consent ? 'checked' : ''} onchange="gpSet(${i},'consent',this.checked);gpQuickPaint()"><span>Agreed</span></label>
      <div class="gq-who"><b>${escapeHtml(r.name || '—')}</b><small>${r.room ? 'Room ' + escapeHtml(r.room) + ' · ' : ''}${escapeHtml(r.email)}${r.phone ? ' · 📞' : ''}${r.nat ? ' · ' + escapeHtml(r.nat) : ''}</small></div>
      <button type="button" class="gq-title ${escapeHtml(r.civSrc || 'guess')}" onclick="gpCycleTitle(${i})" title="Filled by itself — tap to change">${escapeHtml(r.civility || 'Mr')}<small>${{ card: 'from card', name: 'from name', you: 'set by you' }[r.civSrc] || 'guessed · tap'}</small></button></div>`).join('')}</div>`
      : '<div class="acr-empty">None of these guests can be enrolled (no e-mail, already members or already enrolled).</div>'}
    ${off.length ? `<details class="gq-off"><summary>${off.length} guest${off.length === 1 ? '' : 's'} left out</summary>${off.map(r => `<div><b>${escapeHtml(r.name || r.conf)}</b> · ${escapeHtml(why(r))}</div>`).join('')}</details>` : ''}`;
  const ready = gpEnrollRows().filter(r => !r.member), ticked = can.filter(([r]) => r.consent).length, noCiv = can.filter(([r]) => r.consent && !r.civility).length;
  if (foot) foot.innerHTML = `<div class="gq-count"><b>${ready.length}</b> ready${noCiv ? ` · <span class="gq-warn">${noCiv} ticked without Mr/Ms</span>` : ''}${!ticked ? ' · tick who said yes' : ''}</div>
    <button type="button" class="btn" onclick="gpQuickGo(true)"${ready.length ? '' : ' disabled'}>🧪 Test</button><button type="button" class="btn gold" onclick="gpQuickGo(false)"${ready.length ? '' : ' disabled'}>☁️ Enroll ${ready.length || ''} guest${ready.length === 1 ? '' : 's'}</button>`;
}
function gpQuickTick(i) { const r = gpRows[i]; if (!r || !gpQuickCan(r)) return; gpSet(i, 'consent', !r.consent); gpQuickPaint(); }
/** tick / untick every guest in the sheet — ticking all asks first: each tick means that guest said yes */
function gpQuickAll(on) {
  const can = gpRows.filter(gpQuickCan);
  if (on && !confirm(`Tick all ${can.length} guests?\n\nOnly do this if every one of them agreed to join ALL. Untick anyone who did not.`)) return;
  can.forEach(r => { r.consent = !!on; }); gpSaveDraft(); gpRenderSummary(); gpQuickPaint();
}
async function gpQuickGo(test) {
  const u = document.getElementById('gqUrl'), main = document.getElementById('gpAccorUrl');
  if (u && main) main.value = u.value.trim();
  if (gpRows.some(r => r.member && r.consent)) gpRows.forEach(r => { if (r.member) r.consent = false; });
  const w = document.getElementById('gpQuick');
  const before = GP_ACC.at; await gpAccCloudEnroll(test);
  if (GP_ACC.at !== before && w) w.classList.remove('on');
}
// ── 📡 the live window (same look and feel as the Neorcha cloud run) ──
const GP_ACC_STEPS = [['gh', '🖥️', 'Start a GitHub computer'], ['open', '🌐', 'Open the Accor Loop portal'], ['worker', '🤖', 'Start the enrollment robot'], ['enroll', '✍️', 'Enroll the guests who agreed'], ['save', '💾', 'Save the results in HotelOps']];
/** where an Accor Loop run is (pure): step index, state, message, GitHub link */
function gpAccState(live, gh) {
  let k = 0, state = 'run', note = '';
  if (live) {
    const con = Array.isArray(live.con) ? live.con : [];
    const worker = live.worker || con.some(l => /worker started|worker resumed|content loaded/i.test(l.m || ''));
    k = live.state === 'done' ? 5 : live.step === 'queued' ? 0 : (live.current || +live.done > 0) ? 3 : worker ? 2 : 1;
    if (live.step === 'partial') k = 4;
    state = live.state === 'done' ? 'done' : live.state === 'error' ? 'error' : live.state === 'stopped' || live.step === 'stopped' ? 'stopped' : 'run';
    note = live.note || '';
  }
  if (gh && (!live || live.step === 'queued')) {
    if (gh.status === 'completed' && gh.conclusion !== 'success') { state = 'error'; note = 'The GitHub computer stopped (' + gh.conclusion + ') before it reached the portal. Open the run on GitHub to see why.'; }
    else if (gh.status === 'completed') { state = 'error'; note = 'The GitHub run finished without reporting back. Check the HotelOps secrets on GitHub (Settings → Secrets → Actions).'; }
    else note = gh.status === 'queued' ? 'Waiting for a free GitHub computer…' : 'The GitHub computer is getting ready (about a minute)…';
  }
  if (live && gh && gh.status === 'completed' && gh.conclusion !== 'success' && state === 'run') { state = 'error'; note = 'The GitHub run stopped (' + gh.conclusion + '). The last steps are in the console.'; }
  return { k, state, note, url: (gh && gh.url) || (live && live.run) || '' };
}
function gpAccorRunWin(open) {
  let w = document.getElementById('gpAccorRunModal');
  if (!w) {
    w = document.createElement('div'); w.id = 'gpAccorRunModal'; w.className = 'gp-accor-modal';
    w.innerHTML = '<div class="gp-accor-modal-bg" data-gp-close="1"></div><section class="gp-accor-modal-card" role="dialog" aria-modal="true" aria-label="Accor Loop cloud enrollment"><header class="gp-accor-modal-h"><span class="gp-accor-modal-ic">☁️</span><div><b>Accor Loop · cloud enrollment</b><small id="gpAccorModalSub">Live run</small></div><button type="button" class="gp-accor-modal-x" data-gp-close="1" aria-label="Close">✕</button></header><div class="gp-accor-modal-b"><div id="gpAccorModalBody"></div><div class="acr-con" id="gpAccCon"><div class="acr-con-h"><i></i><i></i><i></i><span>accor-loop-cloud · live console</span><button type="button" data-acr-con="1">Hide</button></div><div class="acr-term" id="gpAccTerm"></div></div></div></section>';
    document.body.appendChild(w);
    w.addEventListener('click', e => {
      if (e.target.closest('[data-gp-close]')) gpAccorRunWin(false);
      const t = e.target.closest('[data-acr-con]'); if (t) { const c = document.getElementById('gpAccCon'); c.classList.toggle('off'); t.textContent = c.classList.contains('off') ? 'Show' : 'Hide'; }
    });
  }
  const on = open !== false; w.classList.toggle('on', on);
  clearInterval(GP_ACC.timer); if (on) { GP_ACC.timer = setInterval(() => gpCloudPaint(), 1000); gpCloudPaint(); }
}
function gpCloudPaint(v) {
  if (v) GP_ACC.live = v;
  const live = GP_ACC.live, st = gpAccState(live, GP_ACC.gh);
  const hh = t => { const d = new Date(+t); return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':'); };
  const n = +(live && live.n) || 0, done = Math.min(+(live && live.done) || 0, n || Infinity);
  const pct = st.state === 'done' ? 100 : Math.round(Math.min(97, st.k / 5 * 100 * (st.k === 3 ? 1 : 1) + (st.k === 3 && n ? done / n * 20 : 0)));
  const ty = live && live.tally || null, test = !!(live && live.test);
  const icon = { done: '✅', error: '⛔', stopped: '⏹' }[st.state] || '⏳';
  const active = st.state === 'run' && !!live && live.step !== 'queued';
  // 1) the compact card under the buttons
  const box = document.getElementById('gpCloudLive');
  if (box && live) {
    box.hidden = false; box.className = 'gp-cloud-live ' + st.state;
    box.innerHTML = `<div class="gp-cl-top"><b>${icon} ${test ? '🧪 Test · ' : ''}${escapeHtml(st.note || '…')}</b><span class="gp-cl-actions">${active ? `<button type="button" class="gp-cl-stop" onclick="gpAccControl('stop')">■ Stop</button>` : ''}<button type="button" class="gp-cl-start" onclick="gpAccorRunWin(true)">📡 Live window</button></span></div>
      <div class="gp-cl-bar"><i style="width:${pct}%"></i></div><div class="gp-cl-meta"><span>${done} / ${n} guests</span>${ty ? `<span>✅ ${+ty.enrolled || 0} · 👤 ${+ty.already || 0} · ⏭ ${+ty.skipped || 0} · ⚠️ ${+ty.errors || 0}</span>` : ''}${st.url ? `<a class="gp-cl-run" href="${escapeHtml(st.url)}" target="_blank" rel="noopener">GitHub ↗</a>` : ''}</div>`;
  }
  // 2) the live window
  const body = document.getElementById('gpAccorModalBody'); if (!body) return;
  const sub = document.getElementById('gpAccorModalSub');
  const t0 = (live && +live.started) || GP_ACC.at || Date.now(), sec = Math.max(0, Math.round(((st.state === 'run' ? Date.now() : (live && +live.at) || Date.now()) - t0) / 1000));
  if (sub) sub.textContent = (test ? '🧪 Test run · nothing is submitted · ' : '') + (live ? Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') : 'No run yet');
  if (!live && !GP_ACC.gh) { body.innerHTML = '<div class="acr-empty">No Accor Loop run yet. Tick <b>Agreed</b> for the guests who said yes, paste the Accor Loop link, then press <b>☁️ Start cloud computer</b> (or 🧪 Test first).</div>'; gpAccPaintCon([], st); return; }
  const cg = live && live.current;
  const tile = (ic, lb, val, cls) => `<div class="acr-tile ${cls}"><b>${val}</b><span>${ic} ${lb}</span></div>`;
  body.innerHTML = `<div class="acr-bar ${st.state}"><i style="width:${pct}%"></i></div>
    <ol class="acr-steps">${GP_ACC_STEPS.map(([id, ic, lb], i) => { const s2 = st.state === 'done' || i < st.k ? 'ok' : i === st.k ? (st.state === 'error' ? 'bad' : st.state === 'stopped' ? 'stop' : 'now') : '';
      return `<li class="${s2}"><span class="d">${s2 === 'ok' ? '✓' : s2 === 'bad' ? '!' : s2 === 'stop' ? '■' : ic}</span><span class="l">${escapeHtml(lb)}${id === 'enroll' && n ? ` <em>${done} / ${n}</em>` : ''}</span>${s2 === 'now' ? '<span class="sp"></span>' : ''}</li>`; }).join('')}</ol>
    ${cg && st.state === 'run' ? `<div class="acr-guest"><span>👤</span><div><b>Guest ${escapeHtml(String(cg.index || '?'))} of ${escapeHtml(String(cg.total || n || '?'))}: ${escapeHtml(cg.title || '')} ${escapeHtml(cg.name || '')}</b><small>Confirmation ${escapeHtml(String(cg.conf || '—'))} · ${escapeHtml(String(cg.country || '—'))} · phone ${escapeHtml(String(cg.phone || '—'))}</small></div></div>` : ''}
    ${ty ? `<div class="acr-tiles">${tile('✅', test ? 'Checked' : 'Enrolled', test ? done : +ty.enrolled || 0, 'ok')}${tile('👤', 'Already members', +ty.already || 0, 'info')}${tile('⏭', 'Skipped', +ty.skipped || 0, 'warn')}${tile('⚠️', 'Errors', +ty.errors || 0, 'bad')}</div>` : ''}
    <div class="acr-note ${st.state}">${icon} ${escapeHtml(st.note || '…')}</div>
    <div class="acr-act">${active ? `<button type="button" class="btn" onclick="gpAccControl('stop')">■ Stop after this guest</button>` : ''}${!active && live && live.step !== 'queued' ? `<button type="button" class="btn" onclick="gpAccCloudRestart()">▶ Run again</button>` : ''}${st.url ? `<a class="btn" href="${escapeHtml(st.url)}" target="_blank" rel="noopener">Open on GitHub ↗</a>` : ''}${st.state === 'run' ? '<span class="acr-hint">You can close this — the cloud computer keeps going and the results land in the tracker.</span>' : ''}</div>`;
  const lines = (live && Array.isArray(live.con) ? live.con : []).slice();
  if (GP_ACC.gh && (!live || live.step === 'queued')) lines.push({ t: Date.now(), g: 'GH', m: 'GitHub Actions: ' + GP_ACC.gh.status + (GP_ACC.gh.conclusion ? ' · ' + GP_ACC.gh.conclusion : '') });
  gpAccPaintCon(lines, st);
  if (st.state === 'done' && !test && !GP_ACC.logged) { GP_ACC.logged = true; setTimeout(gpLoadLog, 800); }
  if (st.state === 'run') GP_ACC.logged = false;
}
function gpAccPaintCon(lines, st) {
  const box = document.getElementById('gpAccTerm'); if (!box) return;
  const hh = t => { const d = new Date(+t); return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':'); };
  const key = lines.length + ':' + (lines.length ? lines[lines.length - 1].t + lines[lines.length - 1].m : '') + st.state;
  if (box.dataset.k === key) return; box.dataset.k = key;
  const down = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
  box.innerHTML = (lines.length ? lines : [{ t: Date.now(), g: 'SYS', m: 'Waiting for the run…' }]).map(l => `<div class="acl"><span class="ats">${hh(l.t)}</span><span class="atg a-${escapeHtml(String(l.g || 'BOT').toLowerCase())}">${escapeHtml(l.g || 'BOT')}</span><span class="am">${escapeHtml(l.m)}</span></div>`).join('')
    + (st.state === 'run' ? '<div class="acl"><span class="ats"></span><span class="acur">▌</span></div>' : `<div class="acl"><span class="ats">${hh(Date.now())}</span><span class="atg a-${st.state === 'done' ? 'save' : 'err'}">EXIT</span><span class="am">${st.state === 'done' ? 'process finished · code 0' : st.state === 'stopped' ? 'stopped by you · code 0' : 'process stopped · code 1'}</span></div>`);
  if (down || !box.dataset.seen) { box.scrollTop = box.scrollHeight; box.dataset.seen = '1'; }
}
function gpCloudToggleMin() { gpAccorRunWin(true); }
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
  const au = document.getElementById('gpAccorUrl'); if (au) { try { au.value = localStorage.getItem('gp_accor_url_v1') || ''; } catch (_) {} }
  fbListen('enrollLive', v => { if (v && (Date.now() - (+v.at || 0) < 24 * 3600e3)) gpCloudPaint(v); });
  fbListen('enrollAgent', gpAgentPaint);
  fbListen('enrollJob', job => { if (job && job.state === 'queued' && !job.accorLoop) gpAgentTake(job); });
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

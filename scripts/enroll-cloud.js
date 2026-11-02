// ═══════════════════════════════════════════════════════════
//  scripts/enroll-cloud.js — ALL enrollment, run by GitHub (.github/workflows/enroll.yml)
//  HotelOps → Guest Pipeline → "☁️ Enroll in the cloud" saves the list of guests who AGREED at the desk
//  (Consent ticked + civility, hotels/<hotel>/enrollJob) and starts this. It logs in to fc.accor.net (A.C.D.C)
//  with the TARS login kept in the repository's Secrets, opens the enroll page, runs the same ALL Enroll v19
//  script staff paste by hand (scripts/all-enroll.js — consent-only: a guest without Consent = Y is never sent),
//  and writes each guest's result into the Enrollment tracker (hotels/<hotel>/enrollLog).
//
//  Never printed: names, e-mails, passwords — the log shows steps and counts only (the repo is public).
//  Secrets: ACDC_USER, ACDC_PASS (the TARS login), HOTELOPS_EMAIL, HOTELOPS_PASS (to read the list and save results)
//  Inputs (env): HID (the hotel), TAG (HotelOps' run label), TEST=1 (log in, open the page, check the list — send nothing)
// ═══════════════════════════════════════════════════════════
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), E = process.env;
const ACDC = String(E.ACDC_URL || '').trim() || 'https://fc.accor.net/index.html';
const CON = [];
const mask = m => String(m).replace(/\S+@\S+/g, '•@•').replace(/\d{6,}/g, d => '••••' + d.slice(-4)).slice(0, 180);
const tlog = (g, m) => { CON.push({ t: Date.now(), g, m: mask(m) }); if (CON.length > 80) CON.splice(0, CON.length - 80); };
const say = m => { console.log(new Date().toISOString().slice(11, 19) + '  ' + mask(m)); tlog('SYS', m); };
let LIVE = null;
const fail = async (m, code) => { console.log('::error::' + mask(m)); tlog('ERR', m); try { if (LIVE) await LIVE({ state: 'error', note: mask(m) }); } catch (_) {} process.exit(code == null ? 1 : code); };

/** the tracker's key for an e-mail — the same as Guest Pipeline's gpLogKey (pure) */
const logKey = e => String(e || '').toLowerCase().replace(/[.#$\[\]\/@]/g, '_');
/** the list HotelOps saved → only rows with Consent = Y, a civility and an e-mail (pure; the v19 script checks again) */
function consenting(tsv) {
  const L = String(tsv || '').split(/\r?\n/).filter(l => l.trim()); if (!L.length) return { head: '', rows: [] };
  const head = L[0], h = head.split('\t').map(x => x.trim().toLowerCase()), ci = h.indexOf('consent'), cv = h.indexOf('civility'), em = h.findIndex(x => /mail/.test(x));
  if (ci < 0 || em < 0) return { head, rows: [] };
  return { head, rows: L.slice(1).filter(l => { const c = l.split('\t'); return /^(y|yes|1|✓|true)$/i.test((c[ci] || '').trim()) && (cv < 0 || (c[cv] || '').trim()) && /@/.test(c[em] || ''); }) };
}

// ── HotelOps (Firebase REST) ──
function fbConfig() {
  const src = fs.readFileSync(path.join(ROOT, 'firebase-config.js'), 'utf8'), g = k => { const m = src.match(new RegExp(k + '\\s*:\\s*"([^"]+)"')); return m ? m[1] : ''; };
  return { apiKey: g('apiKey'), databaseURL: g('databaseURL') };
}
async function fbOpen() {
  const C = fbConfig(), db = (E.FB_DB_URL || C.databaseURL).replace(/\/$/, '');
  const r = await fetch((E.FB_AUTH_URL || 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword') + '?key=' + encodeURIComponent(C.apiKey), { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: String(E.HOTELOPS_EMAIL).trim(), password: E.HOTELOPS_PASS, returnSecureToken: true }) });
  const a = await r.json().catch(() => ({}));
  if (!r.ok || !a.idToken) await fail('HotelOps sign-in refused (' + ((a.error && a.error.message) || r.status) + ') — check HOTELOPS_EMAIL / HOTELOPS_PASS');
  let hid = String(E.HID || E.HOTELOPS_HOTEL || '').trim();
  if (!hid) { const u = await (await fetch(db + '/userHotels/' + a.localId + '.json?auth=' + a.idToken)).json().catch(() => null); hid = typeof u === 'string' ? u : u && typeof u === 'object' ? String(Object.keys(u)[0] || '') : ''; }
  if (!/^[\w-]{1,80}$/.test(hid)) await fail('No hotel found for that HotelOps account');
  const at = p => db + '/hotels/' + hid + '/' + p + '.json?auth=' + a.idToken;
  const req = async (p, method, body) => { const w = await fetch(at(p), { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); if (!w.ok) throw new Error('HotelOps ' + method + ' ' + p + ' ' + w.status); return w.json(); };
  return { get: p => req(p, 'GET'), put: (p, v) => req(p, 'PUT', v), patch: (p, v) => req(p, 'PATCH', v) };
}

async function main() {
  const miss = ['ACDC_USER', 'ACDC_PASS', 'HOTELOPS_EMAIL', 'HOTELOPS_PASS'].filter(k => !String(E[k] || '').trim());
  if (miss.length) await fail('ALL enrollment in the cloud is not set up yet — add the secrets ' + miss.join(', ') + ' (Settings → Secrets and variables → Actions).');
  const test = /^(1|true|yes)$/i.test(String(E.TEST || ''));
  const FB = await fbOpen();
  const live = p => FB.patch('enrollLive', Object.assign({ at: Date.now(), con: CON.slice(-60) }, p)).catch(() => {});
  LIVE = live;
  const runUrl = E.GITHUB_RUN_ID ? (E.GITHUB_SERVER_URL || 'https://github.com') + '/' + E.GITHUB_REPOSITORY + '/actions/runs/' + E.GITHUB_RUN_ID : '';
  await FB.put('enrollLive', { at: Date.now(), started: Date.now(), state: 'run', step: 'list', tag: String(E.TAG || '').slice(0, 40), test, run: runUrl, n: 0, done: 0, note: 'Reading the list…', con: [] }).catch(() => {});
  const job = await FB.get('enrollJob').catch(() => null);
  const L = consenting(job && job.tsv);
  if (!L.rows.length) await fail('No guest to enroll: tick "Agreed" and Mr/Ms in Guest Pipeline for the guests who said yes, then press ☁️ Enroll in the cloud again.');
  say((test ? 'TEST RUN (nothing is sent) · ' : '') + L.rows.length + ' guest(s) who agreed at the desk');
  await live({ n: L.rows.length, step: 'login', note: 'Logging in to A.C.D.C…' });

  let chromium; try { ({ chromium } = require('playwright')); } catch (_) { try { ({ chromium } = require('playwright-core')); } catch (_e) { await fail('Playwright is not installed'); } }
  const browser = await chromium.launch(E.CHROME_PATH ? { executablePath: E.CHROME_PATH } : {});
  tlog('SYS', 'Chromium ' + browser.version() + ' headless');
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-GB', timezoneId: 'Asia/Dubai' })).newPage();
  page.setDefaultTimeout(30000);
  try {
    say('Opening A.C.D.C…');
    await page.goto(ACDC, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // the TARS login form ("TARS login" / "TARS password" / Connection) — never the Microsoft button
    const user = page.getByLabel(/TARS login/i).or(page.locator('input[type="text"], input[name*="login" i], input[id*="login" i]')).first();
    const pass = page.getByLabel(/TARS password/i).or(page.locator('input[type="password"]')).first();
    await pass.waitFor({ state: 'visible', timeout: 60000 }).catch(() => fail('The A.C.D.C login page did not open'));
    say('Logging in…'); tlog('AUTH', 'TARS login (' + String(E.ACDC_USER).trim().length + ' chars) · password ●●●●●●●● → Connection');
    await user.fill(String(E.ACDC_USER).trim()); await pass.fill(String(E.ACDC_PASS));
    await page.getByRole('button', { name: /connection|connexion|log ?in|sign ?in/i }).first().click();
    const out = await Promise.race([
      page.locator('input[type="password"]').first().waitFor({ state: 'hidden', timeout: 45000 }).then(() => 'in'),
      page.getByText(/invalid|incorrect|wrong|erreur|error|failed|locked|expired/i).first().waitFor({ state: 'visible', timeout: 45000 }).then(() => 'said'),
      page.getByText(/verification code|one-time|authenticator|approve/i).first().waitFor({ state: 'visible', timeout: 45000 }).then(() => 'code'),
    ]).catch(() => 'stuck');
    if (out === 'code') await fail('A.C.D.C asks for a verification code — the cloud can\'t type it.');
    if (out === 'said') { const t = await page.getByText(/invalid|incorrect|wrong|erreur|error|failed|locked|expired/i).first().innerText().catch(() => ''); await fail('A.C.D.C said: "' + mask(t).slice(0, 140) + '" — check the ACDC_USER / ACDC_PASS secrets.'); }
    if (out === 'stuck') await fail('A.C.D.C did not log in (no answer) — check the ACDC_USER / ACDC_PASS secrets.');
    tlog('AUTH', '✓ Session open'); say('Logged in. Opening the enroll page…'); await live({ step: 'page', note: 'Opening the enroll page…' });
    // the enroll page: the hash route the v19 script expects (/enroll), else the menu link that says enrol
    const emailBox = 'input[name="customerEmail"], input[type="email"]';
    let ok = await page.locator(emailBox).first().isVisible().catch(() => false);
    if (!ok) { await page.evaluate(() => { if (!/\/enroll/.test(location.hash)) location.hash = '#/enroll'; }); ok = await page.locator(emailBox).first().waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false); }
    if (!ok) { const lk = page.getByText(/enrol/i).first(); if (await lk.isVisible().catch(() => false)) { await lk.click(); ok = await page.locator(emailBox).first().waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false); } }
    if (!ok) await fail('Logged in, but the enroll page (the guest e-mail box) was not found — page: ' + (await page.evaluate(() => location.hash || location.pathname)));
    tlog('NAV', 'Enroll page ' + (await page.evaluate(() => location.hash)));
    // the same script staff paste by hand; the list goes into its panel; it checks consent again
    await page.evaluate(fs.readFileSync(path.join(ROOT, 'scripts/all-enroll.js'), 'utf8'));
    await page.locator('#__acdc_input').fill(L.head + '\n' + L.rows.join('\n'));
    await page.click('#__acdc_parse');
    const pv = await page.locator('#__acdc_preview').innerText().catch(() => '');
    const nOk = +((pv.match(/(\d+)\s+guest\(s\) who agreed/) || [])[1] || 0);
    tlog('SCAN', 'ALL Enroll v19 ready · ' + nOk + ' guest(s) who agreed' + (/not enrolled/.test(pv) ? ' · ' + mask(pv.split('\n').filter(l => /not enrolled/.test(l)).join(' ')) : ''));
    if (!nOk) await fail('ALL Enroll found no guest with Consent = Y and a civility in the list.');
    if (test) {
      say('✅ Test run: login, enroll page and list all OK — ' + nOk + ' guest(s) would be enrolled. Nothing was sent.');
      await live({ state: 'done', step: 'done', done: 0, n: nOk, note: 'Test run OK — ' + nOk + ' guest(s) would be enrolled. Nothing was sent.' });
      return;
    }
    say('Enrolling ' + nOk + ' guest(s)…'); await live({ step: 'enroll', n: nOk, note: 'Enrolling ' + nOk + ' guest(s)…' });
    await page.click('#__acdc_start');
    let seen = 0, lastLive = 0;
    for (let i = 0; i < 3 * 60 * 50; i++) {   // up to 50 minutes
      await page.waitForTimeout(1000);
      const s = await page.evaluate(() => ({ st: (document.getElementById('__acdc_state') || {}).textContent || '', log: Array.from(document.querySelectorAll('#__acdc_log > div')).map(d => d.textContent), done: !!window.__enrollmentResults }));
      s.log.slice(seen).forEach(l => { const t = l.replace(/^\[[^\]]*\]\s*/, ''); if (t.trim()) tlog(/SUBMITTED|✅/.test(t) ? 'CARD' : /SKIPPED|ERROR|✗/.test(t) ? 'WARN' : /^\[\d+\/\d+\]/.test(t) ? 'PAGE' : 'BOT', t); }); seen = s.log.length;
      const k = s.log.filter(l => /^\[[^\]]*\]\s*\[\d+\/\d+\]/.test(l)).length;
      if (Date.now() - lastLive > 2500) { lastLive = Date.now(); await live({ step: 'enroll', done: Math.max(0, k - 1), note: 'Enrolling guest ' + k + ' of ' + nOk + '…' }); }
      if (s.done || /^(done|stopped)$/.test(s.st.trim())) break;
    }
    const res = await page.evaluate(() => window.__enrollmentResults || []);
    const today = new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10), patch = {};
    res.forEach(r => { if (r && /@/.test(r.email || '')) patch[logKey(r.email)] = { email: String(r.email).toLowerCase(), status: String(r.status || 'unknown'), date: today, name: '', by: 'cloud' }; });
    const c = st => res.filter(r => r.status === st).length;
    tlog('SAVE', 'Results: ' + c('submitted') + ' submitted · ' + c('already-member') + ' already members · ' + c('pending-account') + ' pending · ' + (res.length - c('submitted') - c('already-member') - c('pending-account')) + ' other');
    if (Object.keys(patch).length) await FB.patch('enrollLog', patch);
    await FB.patch('enrollJob', { doneAt: Date.now() }).catch(() => {});
    say('✅ ' + c('submitted') + ' enrolled · results saved in the Enrollment tracker');
    await live({ state: 'done', step: 'done', done: res.length, note: c('submitted') + ' enrolled, ' + c('already-member') + ' already members, ' + c('pending-account') + ' pending — saved in the Enrollment tracker' });
  } finally { await browser.close().catch(() => {}); }
}
if (require.main === module) main().catch(e => fail('Stopped: ' + String(e && e.message || e).split('\n')[0]));
module.exports = { consenting, logKey };

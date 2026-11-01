// ═══════════════════════════════════════════════════════════
//  scripts/neorcha-cloud.js — the Neorcha collector, run by GitHub (no PC, no phone needed)
//  .github/workflows/neorcha.yml starts it every night and whenever "Run workflow" is pressed
//  (github.com or the GitHub app). It opens Neorcha in a browser on GitHub's machine, logs in with
//  the account kept in the repository's Secrets, runs the same collector as the HotelOps helper
//  (neorcha.js → COLLECTOR: Guest Documents, the dates, every confirmation's card, every page) and
//  saves the cards in HotelOps' database (hotels/<hotel>/neorcha), so every device sees them.
//
//  Never read: passport, ID number, birth date, e-mail, phone (the collector skips them).
//  Never printed: guest data or passwords — the log shows counts and steps only (the repo is public).
//
//  Secrets (Settings → Secrets and variables → Actions):
//    NEORCHA_USER, NEORCHA_PASS   the Neorcha login (2-step verification must be off for it)
//    NEORCHA_URL                  optional, the hotel's Neorcha link (default: the ibis one)
//    HOTELOPS_EMAIL, HOTELOPS_PASS  a HotelOps account (active) that saves the cards
//    HOTELOPS_HOTEL               optional, the hotel id (default: the account's own hotel)
//  Inputs (env): FROM, TO (YYYY-MM-DD; empty = the 1st of the month of yesterday → today, Dubai time)
//  Test hooks: DRY=1 (no database: writes neorcha-cloud.json), FB_AUTH_URL / FB_DB_URL (a stand-in server)
// ═══════════════════════════════════════════════════════════
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const E = process.env;
const say = m => console.log(new Date().toISOString().slice(11, 19) + '  ' + m);
const fail = (m, code) => { console.log('::error::' + m); process.exit(code == null ? 1 : code); };

// ── the dates (Dubai) ──
function dubaiToday() { return new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10); }
function datesOf(from, to, today) {
  const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim());
  const t = ok(today) ? today : dubaiToday();
  const y = new Date(Date.parse(t + 'T00:00:00Z') - 864e5).toISOString().slice(0, 10);   // yesterday
  const f = ok(from) ? from.trim() : y.slice(0, 8) + '01', e = ok(to) ? to.trim() : t;
  return f <= e ? { from: f, to: e } : { from: e, to: f };
}

// ── the collector, exactly as HotelOps has it ──
function collectorSrc() {
  const ctx = vm.createContext({ window: {}, document: { readyState: 'loading', addEventListener() {} }, localStorage: { getItem() { return null; }, setItem() {} }, console, Intl });
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'neorcha.js'), 'utf8'), ctx);
  return ctx.hoNeorcha.collectorSrc();
}

// ── Firebase (REST): sign in as the HotelOps account, find its hotel, save the cards ──
function fbConfig() {
  const src = fs.readFileSync(path.join(ROOT, 'firebase-config.js'), 'utf8');
  const g = k => { const m = src.match(new RegExp(k + '\\s*:\\s*"([^"]+)"')); return m ? m[1] : ''; };
  return { apiKey: g('apiKey'), databaseURL: g('databaseURL') };
}
async function fbSave(card) {
  const C = fbConfig(), authUrl = E.FB_AUTH_URL || 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword', db = (E.FB_DB_URL || C.databaseURL).replace(/\/$/, '');
  const r = await fetch(authUrl + '?key=' + encodeURIComponent(C.apiKey), { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: E.HOTELOPS_EMAIL, password: E.HOTELOPS_PASS, returnSecureToken: true }) });
  const a = await r.json().catch(() => ({}));
  if (!r.ok || !a.idToken) fail('HotelOps sign-in refused (' + ((a.error && a.error.message) || r.status) + ') — check HOTELOPS_EMAIL / HOTELOPS_PASS');
  let hid = String(E.HOTELOPS_HOTEL || '').trim();
  if (!hid) {
    const u = await (await fetch(db + '/userHotels/' + a.localId + '.json?auth=' + a.idToken)).json().catch(() => null);
    hid = typeof u === 'string' ? u : u && typeof u === 'object' ? String(u.hotelId || u.id || Object.keys(u)[0] || '') : '';
  }
  if (!/^[\w-]{1,80}$/.test(hid)) fail('No hotel found for that HotelOps account — set the HOTELOPS_HOTEL secret');
  const w = await fetch(db + '/hotels/' + hid + '/neorcha.json?auth=' + a.idToken, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(card) });
  if (!w.ok) fail('HotelOps did not accept the cards (' + w.status + ') — is that HotelOps account active at the hotel?');
}

// ── the run ──
async function main() {
  const need = ['NEORCHA_USER', 'NEORCHA_PASS'].concat(E.DRY ? [] : ['HOTELOPS_EMAIL', 'HOTELOPS_PASS']);
  const miss = need.filter(k => !String(E[k] || '').trim());
  if (miss.length) { console.log('::notice::Neorcha cloud is not set up yet (missing secrets: ' + miss.join(', ') + '). Nothing to do.'); return; }
  const { from, to } = datesOf(E.FROM, E.TO);
  const url = String(E.NEORCHA_URL || '').trim() || 'https://ibis.myneorcha.com/neorchaWEBPlatform/#/login';
  say('Neorcha cloud · arrivals ' + from + ' → ' + to);
  let chromium; try { ({ chromium } = require('playwright')); } catch (_) { fail('Playwright is not installed'); }
  const browser = await chromium.launch(E.CHROME_PATH ? { executablePath: E.CHROME_PATH } : {});
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-GB', timezoneId: 'Asia/Dubai' })).newPage();
  page.setDefaultTimeout(30000);
  try {
    say('Opening Neorcha…');
    await page.goto(url.replace(/#.*$/, '') + '#/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[ng-model="account.username"], #userPassword', { timeout: 60000 });
    say('Logging in…');
    await page.fill('[ng-model="account.username"]', E.NEORCHA_USER);
    await page.fill('#userPassword', E.NEORCHA_PASS);
    await page.click('input[ng-click="login()"], button[ng-click="login()"], [type=submit]');
    const outcome = await Promise.race([
      page.waitForFunction(() => !/login/i.test(location.hash), null, { timeout: 60000 }).then(() => 'in'),
      page.waitForSelector('#authenticateBtn', { state: 'visible', timeout: 60000 }).then(() => '2fa'),
    ]).catch(() => 'stuck');
    if (outcome === '2fa') fail('Neorcha asks for a 2-step code for this account — the cloud run can only work with 2-step verification off.');
    if (outcome === 'stuck') fail('Neorcha did not log in (wrong NEORCHA_USER / NEORCHA_PASS, or the login page changed).');
    say('Logged in. Collecting…');
    await page.evaluate(`window.__nxDone = null; window.__nxNote = ''; (${collectorSrc()})({ from: ${JSON.stringify(from)}, to: ${JSON.stringify(to)}, auto: true,
      progress: function (p) { window.__nxNote = String(p && p.note || ''); },
      send: function (rows, f, t) { window.__nxDone = { rows: rows, from: f, to: t }; } });`);
    let last = '', done = null;
    for (let i = 0; i < 3300 && !done; i++) {   // up to 55 minutes
      await page.waitForTimeout(1000);
      const s = await page.evaluate(() => ({ note: window.__nxNote, done: !!window.__nxDone }));
      if (s.note && s.note !== last && (i % 15 === 0 || /✅|⚠️|⛔/.test(s.note))) { say(s.note.replace(/\d{6,}/g, '#')); last = s.note; }
      if (/^\s*(⚠️|⛔)/.test(s.note) && !s.done) fail('The collector stopped: ' + s.note.replace(/\d{6,}/g, '#'));
      if (s.done) done = await page.evaluate(() => window.__nxDone);
    }
    if (!done) fail('Timed out after 55 minutes');
    const rows = (done.rows || []).slice(0, 5000);
    say('Collected ' + rows.length + ' registration cards');
    const card = { at: Date.now(), from, to, by: 'cloud', n: rows.length, rows };
    if (E.DRY) { fs.writeFileSync(E.DRY_OUT || 'neorcha-cloud.json', JSON.stringify(card)); say('DRY run: saved to ' + (E.DRY_OUT || 'neorcha-cloud.json')); }
    else { await fbSave(card); say('✅ Saved in HotelOps — open Neorcha Registrations on any device.'); }
  } finally { await browser.close().catch(() => {}); }
}
if (require.main === module) main().catch(e => fail('Stopped: ' + String(e && e.message || e).split('\n')[0].replace(/\d{6,}/g, '#')));
module.exports = { datesOf, fbConfig };

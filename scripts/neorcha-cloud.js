// ═══════════════════════════════════════════════════════════
//  scripts/neorcha-cloud.js — the Neorcha collector, run by GitHub (no PC, no phone needed)
//  .github/workflows/neorcha.yml starts it every night and whenever "Run workflow" is pressed
//  (github.com or the GitHub app). It opens Neorcha in a browser on GitHub's machine, logs in with
//  the account kept in the repository's Secrets, runs the same collector as the HotelOps helper
//  (neorcha.js → COLLECTOR: Guest Documents, the dates, every confirmation's card, every page) and
//  saves the cards in HotelOps' database (hotels/<hotel>/neorcha), so every device sees them.
//
//  Retains selected registration/contact fields; never exports passport, ID or birth details.
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
// the console in HotelOps' live window (saved with the live note in HotelOps' own database, never in GitHub's public log):
// what the robot does, step by step — confirmation numbers as ••••1234, never a name, e-mail or phone
const CON = [];
const tlog = (g, m) => { CON.push({ t: Date.now(), g, m: String(m).replace(/\S+@\S+/g, '•@•').replace(/\d{6,}/g, d => '••••' + d.slice(-4)).slice(0, 180) }); if (CON.length > 80) CON.splice(0, CON.length - 80); };
const say = m => { console.log(new Date().toISOString().slice(11, 19) + '  ' + m); tlog('SYS', m); };
let LIVE = null;   // set once signed in to HotelOps: the live window there follows each step
const fail = async (m, code) => { console.log('::error::' + m); try { tlog('ERR', m); } catch (_) {} try { if (LIVE) await LIVE({ state: 'error', note: m }); } catch (_) {} process.exit(code == null ? 1 : code); };

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

// ── Firebase (REST): sign in as the HotelOps account, find its hotel ──
function fbConfig() {
  const src = fs.readFileSync(path.join(ROOT, 'firebase-config.js'), 'utf8');
  const g = k => { const m = src.match(new RegExp(k + '\\s*:\\s*"([^"]+)"')); return m ? m[1] : ''; };
  return { apiKey: g('apiKey'), databaseURL: g('databaseURL') };
}
async function fbOpen() {
  const C = fbConfig(), authUrl = E.FB_AUTH_URL || 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword', db = (E.FB_DB_URL || C.databaseURL).replace(/\/$/, '');
  const r = await fetch(authUrl + '?key=' + encodeURIComponent(C.apiKey), { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: String(E.HOTELOPS_EMAIL).trim(), password: E.HOTELOPS_PASS, returnSecureToken: true }) });
  const a = await r.json().catch(() => ({}));
  if (!r.ok || !a.idToken) await fail('HotelOps sign-in refused (' + ((a.error && a.error.message) || r.status) + ') — check the HOTELOPS_EMAIL / HOTELOPS_PASS secrets');
  let hid = String(E.HOTELOPS_HOTEL || '').trim();
  if (!hid) {
    const u = await (await fetch(db + '/userHotels/' + a.localId + '.json?auth=' + a.idToken)).json().catch(() => null);
    hid = typeof u === 'string' ? u : u && typeof u === 'object' ? String(u.hotelId || u.id || Object.keys(u)[0] || '') : '';
  }
  if (!/^[\w-]{1,80}$/.test(hid)) await fail('No hotel found for that HotelOps account — add the HOTELOPS_HOTEL secret');
  const at = p => db + '/hotels/' + hid + '/' + p + '.json?auth=' + a.idToken;
  return {
    live: async patch => { patch = Object.assign({ con: CON.slice(-60) }, patch); try { await fetch(at('neorchaLive'), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ at: Date.now() }, patch)) }); } catch (_) {} },
    start: async o => { try { await fetch(at('neorchaLive'), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ at: Date.now(), started: Date.now() }, o)) }); } catch (_) {} },
    save: async card => {
      const previous = await (await fetch(at('neorcha'))).json().catch(()=>null);
      const archive = async value => {
        const key='nx'+Number(value.at), payload={at:value.at,from:value.from||'',to:value.to||'',n:+value.n||0,reader:value.reader||'legacy',hotelName:value.hotelName||'',fields:value.fields||[]};
        for(const [node,data] of [['neorchaCollections/'+key,value],['neorchaCollectionIndex/'+key,payload]]){
          const response=await fetch(at(node),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
          if(!response.ok)await fail('HotelOps could not save the collection archive ('+response.status+').');
        }
      };
      if(previous&&Number.isSafeInteger(previous.at)&&Array.isArray(previous.rows))await archive(previous);
      await archive(card);
      const w = await fetch(at('neorcha'), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(card) });
      if (!w.ok) await fail('HotelOps did not accept the cards (' + w.status + ') — is that HotelOps account active at the hotel?'); },
  };
}

// ── logging in to Neorcha: typed like a person, and if it doesn't work, what Neorcha showed (never the password) ──
const U = '[ng-model="account.username"]', P = '#userPassword', BTN = 'input[ng-click="login()"], button[ng-click="login()"]';
async function tryLogin(page, user, pass) {
  await page.fill(U, ''); await page.type(U, user, { delay: 20 });
  await page.fill(P, ''); await page.type(P, pass, { delay: 20 });
  await page.evaluate(([u, p]) => [u, p].forEach(sel => { const e = document.querySelector(sel); if (e) ['input', 'change', 'blur'].forEach(t => e.dispatchEvent(new Event(t, { bubbles: true }))); }), [U, P]);
  await page.waitForTimeout(300);
  const b = await page.$(BTN);
  if (b && await b.isEnabled().catch(() => false)) await b.click(); else await page.press(P, 'Enter');
  for (let i = 0; i < 90; i++) {   // up to 45 s
    await page.waitForTimeout(500);
    const st = await page.evaluate(() => {
      const vis = e => !!(e && (e.offsetParent || e.getClientRects().length));
      const txt = sel => Array.prototype.slice.call(document.querySelectorAll(sel)).filter(vis).map(e => e.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
      return { hash: location.hash, code: vis(document.querySelector('#authenticateBtn')), newpw: vis(document.querySelector('#saveFirstLoginbtn')) || vis(document.querySelector('#savebtn')),
        said: txt('#toast-container .toast, .toast-message, .alert, .text-danger, .error, .help-block, [ng-show*="rror"], [ng-if*="rror"]').concat(txt('.modal.in h2, .modal.in .modal-title, .modal.in .modal-body > p')).slice(0, 4) };
    });
    if (!/login/i.test(st.hash)) return { ok: true };
    if (st.code) return { why: 'code' };
    if (st.newpw) return { why: 'newpw' };
    if (st.said.length && i > 4) return { why: 'said', said: st.said.filter((t, k, a) => a.indexOf(t) === k) };
  }
  return { why: 'nothing' };
}
async function login(page, user, pass) {
  const mask = t => String(t).split(user).join('•••').split(user.trim()).join('•••').replace(/\d{5,}/g, '#').slice(0, 200);
  let r = await tryLogin(page, user, pass);
  if (!r.ok && !r.why.match(/code|newpw/) && (user !== user.trim() || pass !== pass.trim())) {   // a space a phone keyboard added: try without it
    say('Trying again without the spaces at the start / end of the login…');
    r = await tryLogin(page, user.trim(), pass.trim());
  } else if (!r.ok && r.why === 'nothing') { say('No answer from Neorcha — trying once more…'); r = await tryLogin(page, user, pass); }
  if (r.ok) return;
  const hints = [];
  if (user !== user.trim() || pass !== pass.trim()) hints.push('the saved username or password has a space at the start or end');
  if (!/@/.test(user) && /^[A-Z][a-z0-9._-]+$/.test(user.trim())) hints.push('the username starts with a capital letter — phone keyboards do that by themselves');
  const H = hints.length ? ' Check: ' + hints.join('; ') + '.' : '';
  if (r.why === 'code') await fail('Neorcha asks GitHub\'s computer for a verification code (it does that for a new device). The cloud run can\'t type it.' + H);
  if (r.why === 'newpw') await fail('Neorcha asks to set a new password for this account. Log in once on your PC, set it, then update NEORCHA_PASS on GitHub.');
  if (r.why === 'said') await fail('Neorcha said: "' + r.said.map(mask).join(' · ') + '".' + H);
  await fail('Neorcha did not log in and showed no message (it may block logins from outside the hotel).' + H);
}

// what the collector did on Neorcha (its own notes: dates typed, rows per page, cards that did not open) — no guest detail:
// the per-guest lines are left out, long numbers and e-mails are masked
async function steps(page) {
  try {
    const log = await page.evaluate(() => (window.__hoNxLog || []).slice(-60));
    const out = log.filter(l => !/^✓/.test(l)).map(l => String(l).replace(/\S+@\S+/g, '•@•').replace(/\d{6,}/g, '#'));
    if (out.length) { console.log('── What happened on Neorcha ──'); out.forEach(l => console.log('   ' + l)); }
  } catch (_) {}
}

/** whose Neorcha login and link (pure): the account's own secrets; the main ones for no account or the main hotel's brand
 *  (the brand = the first part of the main link, ibis when there is none); anything else must have its own */
function resolveLogin(acct, env) {
  const DEF = 'https://ibis.myneorcha.com/tweak/', t = v => String(v || '').trim();
  const sub = u => { try { return new URL(u).hostname.split('.')[0].toUpperCase(); } catch (_) { return ''; } };
  const mainUrl = t(env.NEORCHA_URL) || DEF, mainBrand = sub(mainUrl), urlIn = t(env.URL_IN);
  if (acct && t(env.NEORCHA_USER_ACC) && t(env.NEORCHA_PASS_ACC))
    return { user: env.NEORCHA_USER_ACC, pass: env.NEORCHA_PASS_ACC, url: urlIn || t(env.NEORCHA_URL_ACC) || 'https://' + acct.toLowerCase().replace(/_.*$/, '') + '.myneorcha.com/' + (acct.replace(/_.*$/, '') === 'IBIS' ? 'tweak/' : 'neorchaWEBPlatform/#/login'), who: acct };
  if (!acct || acct === mainBrand) return { user: env.NEORCHA_USER || '', pass: env.NEORCHA_PASS || '', url: urlIn || mainUrl, who: 'main' };
  return { err: 'The ' + acct + ' hotel is not set up on GitHub yet — add the secrets NEORCHA_USER_' + acct + ' and NEORCHA_PASS_' + acct + ' (Settings → Secrets and variables → Actions → New repository secret).' };
}

function readerFor(value) {
  const u = new URL(value);
  if(u.protocol !== 'https:' || u.username || u.password || !/(^|\.)myneorcha\.com$/i.test(u.hostname)) throw Error('Use a Neorcha HTTPS link.');
  if(/^\/tweak(?:\/|$)/i.test(u.pathname)) return 'tweak';
  if(/^\/neorchaWEBPlatform(?:\/|$)/i.test(u.pathname)) return 'legacy';
  throw Error('Use the portal link containing /tweak/ or /neorchaWEBPlatform/.');
}

// ── the run ──
async function main() {
  const acct = String(E.ACCOUNT || '').trim();
  if (acct && !/^[A-Z0-9_]{1,30}$/.test(acct)) await fail('The Neorcha account name "' + acct.slice(0, 30) + '" can only use capital letters, digits and _ (for example MERCURE).');
  // whose Neorcha login: the hotel's own secrets (NEORCHA_USER_MERCURE …); the main login only for the main hotel's brand
  const R = resolveLogin(acct, E);
  if (R.err) await fail(R.err);
  E.NEORCHA_USER = R.user; E.NEORCHA_PASS = R.pass; E.NEORCHA_URL = R.url;
  const need = ['NEORCHA_USER', 'NEORCHA_PASS'].concat(E.DRY ? [] : ['HOTELOPS_EMAIL', 'HOTELOPS_PASS']);
  const miss = need.filter(k => !String(E[k] || '').trim());
  if (miss.length) { console.log('::notice::Neorcha cloud is not set up yet (missing secrets: ' + miss.join(', ') + '). Nothing to do.'); return; }
  const { from, to } = datesOf(E.FROM, E.TO);
  const url0 = String(E.NEORCHA_URL || '').trim(), okUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' && /(^|\.)myneorcha\.com$/i.test(x.hostname) || (!!E.FB_DB_URL && x.hostname === 'localhost'); } catch (_) { return false; } };
  if (url0 && !okUrl(url0)) await fail('That Neorcha link is not a myneorcha.com address.');
  const url = url0 || 'https://ibis.myneorcha.com/tweak/';
  const mode=readerFor(url),tweak=mode==='tweak';
  const fields=E.FIELDS?JSON.parse(E.FIELDS):undefined;
  if(fields!==undefined&&(!Array.isArray(fields)||fields.length>30||fields.some(f=>typeof f!=='string'||f.length>60)))await fail('Choose a valid collection field list.');
  const hotelName=String(E.HOTEL_NAME||'').trim().slice(0,100);
  say('Neorcha account: ' + (R.who === 'main' ? 'main' + (acct ? ' (' + acct + ')' : '') : acct) + ' · ' + new URL(url).hostname);
  const runUrl = E.GITHUB_RUN_ID ? (E.GITHUB_SERVER_URL || 'https://github.com') + '/' + E.GITHUB_REPOSITORY + '/actions/runs/' + E.GITHUB_RUN_ID : '';
  const nice = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  say('Neorcha cloud · searching arrivals from ' + nice(from) + ' to ' + nice(to) + ' (' + from + ' → ' + to + ')');
  const FB = E.DRY && !E.FB_DB_URL ? null : await fbOpen();
  if (FB) { LIVE = FB.live; await FB.start({ state: 'run', step: 'open', from, to, n: 0, prog: 0, run: runUrl, tag: String(E.TAG || '').slice(0, 40), note: 'Opening Neorcha…' }); }
  const live = p => (LIVE ? LIVE(p) : Promise.resolve());
  let chromium; try { ({ chromium } = require('playwright')); } catch (_) { try { ({ chromium } = require('playwright-core')); } catch (_e) { await fail('Playwright is not installed'); } }
  const browser = await chromium.launch(E.CHROME_PATH ? { executablePath: E.CHROME_PATH } : {});
  tlog('SYS', 'Chromium ' + browser.version() + ' headless · ' + (E.RUNNER_OS ? 'GitHub runner (' + E.RUNNER_OS + ')' : 'local') + ' · Dubai time');
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-GB', timezoneId: 'Asia/Dubai' })).newPage();
  // the network, as the console shows it: the page and Neorcha's own data calls (no query strings, long numbers masked)
  let netN = 0;
  page.on('response', r => { try { const q = r.request(), ty = q.resourceType(); if (!/document|xhr|fetch/.test(ty)) return; const u = new URL(r.url());
    if (!/myneorcha\.com$|localhost/.test(u.hostname)) return; netN++; tlog('NET', r.status() + ' ' + q.method() + ' ' + u.hostname + u.pathname.replace(/\/neorchaWEBPlatform/, '').slice(0, 70) + (ty === 'document' ? '' : ' · ' + ty)); } catch (_) {} });
  page.setDefaultTimeout(30000);
  try {
    say('Opening Neorcha…');
    if (tweak) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const user = page.locator('input[formcontrolname=username]:visible');
      await user.waitFor({ state: 'visible', timeout: 60000 });
      await live({ step: 'login', note: 'Signing in to the Ibis Tweak portal…' });
      try {
        await user.fill(String(E.NEORCHA_USER).trim());
        await page.locator('#userPassword').fill(String(E.NEORCHA_PASS));
        await page.locator('button.login-btn[type=submit]').click();
        await page.waitForURL(u => /^\/tweak\/dashboard(?:\/|$)/.test(u.pathname), { timeout: 45000 });
      } catch (_) { throw Error('The Ibis Tweak sign-in did not complete. Check the Neorcha account or any verification prompt.'); }
    } else {
    // the login box can be slow or Neorcha can be down: try twice, and say what the page showed (no guessing)
    const openLogin = async n => {
      let st = 0; const resp = await (n ? page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }) : page.goto(url.replace(/#.*$/, '') + '#/login', { waitUntil: 'domcontentloaded', timeout: 60000 })).catch(e => { tlog('NET', 'Opening Neorcha failed: ' + String(e && e.message || e).split('\n')[0].slice(0, 140)); return null; });
      if (resp) st = resp.status();
      const ok = await page.waitForSelector(U + ', ' + P, { timeout: n ? 45000 : 60000 }).then(() => true, () => false);
      if (ok) return { ok };
      const seen = await page.evaluate(() => ({ title: document.title, text: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').trim().slice(0, 220) })).catch(() => ({ title: '', text: '' }));
      let where = ''; try { const u = new URL(page.url()); where = u.hostname + u.pathname; } catch (_) {}
      const why = (st ? 'HTTP ' + st : 'no answer') + ' · ' + (where || 'no page') + ' · title "' + (seen.title || '') + '" · page says: "' + (seen.text || '(empty page)').replace(/\S+@\S+/g, '•@•') + '"';
      tlog('WARN', 'Login box not found (try ' + (n + 1) + '/2): ' + why); console.log('::warning::Neorcha login page, try ' + (n + 1) + '/2: ' + why);
      return { ok, st, why };
    };
    let lg = await openLogin(0);
    if (!lg.ok) { const first = lg; say('Neorcha did not show its login page — trying once more…'); await page.waitForTimeout(5000); lg = await openLogin(1); if (!lg.ok && !lg.st) lg.st = first.st; }
    if (!lg.ok) await fail(lg.st >= 500 || !lg.st ? 'Neorcha is not answering right now (' + (lg.st ? 'HTTP ' + lg.st : 'no answer') + ') — the site looks down or busy. Try again in a few minutes.'
      : 'Neorcha\'s login page did not open. What it showed: ' + lg.why);
    say('Logging in…'); tlog('AUTH', 'Login form found · typing username (' + String(E.NEORCHA_USER).trim().length + ' chars) · password ●●●●●●●● → Login'); await live({ step: 'login', note: 'Logging in to Neorcha…' });
    await login(page, String(E.NEORCHA_USER), String(E.NEORCHA_PASS));
    }
    tlog('AUTH', '✓ Session open · ' + (await page.evaluate(() => location.hash)).slice(0, 40));
    say('Logged in. Collecting…'); tlog('BOT', 'Collector injected (HotelOps ' + (fs.readFileSync(path.join(ROOT, 'utils.js'), 'utf8').match(/APP_VERSION = '([^']+)'/) || [, '?'])[1] + ') · arrivals ' + from + ' → ' + to);
    await live({ step: 'search', note: 'Logged in — searching the dates…' });
    await page.evaluate(`window.__nxDone = null; window.__nxP = {}; (${collectorSrc()})({ from: ${JSON.stringify(from)}, to: ${JSON.stringify(to)}, auto: true, fields: ${JSON.stringify(fields)||'undefined'}, hotelName: ${JSON.stringify(hotelName)},
      progress: function (p) { window.__nxP = { note: String(p && p.note || ''), n: +(p && p.n) || 0, prog: +(p && p.prog) || 0 }; },
      send: function (rows, f, t) { window.__nxDone = { rows: rows, from: f, to: t }; } });`);
    let last = '', lastLive = 0, done = null, seenLog = 0;
    const tagOf = l => /^✓/.test(l) ? 'CARD' : /dates|Search|page size|per page|hotel/i.test(l) ? 'SCAN' : /page|next|last page/i.test(l) ? 'PAGE' : /did not|could not|not found|⚠|⛔/.test(l) ? 'WARN' : 'BOT';
    for (let i = 0; i < 6600 && !done; i++) {   // up to 55 minutes, checked twice a second
      await page.waitForTimeout(500);
      const s = await page.evaluate(() => ({ p: window.__nxP || {}, done: !!window.__nxDone, log: (window.__hoNxLog || []).slice(-80), ln: (window.__hoNxLog || []).length }));
      if (s.ln < seenLog) seenLog = 0;
      s.log.slice(Math.max(0, s.log.length - (s.ln - seenLog))).forEach(l => tlog(tagOf(l), l.replace(/^✓ /, ''))); seenLog = s.ln;
      const note = String(s.p.note || '').replace(/\d{6,}/g, '#');
      if (note && note !== last && (i % 30 === 0 || /✅|⚠️|⛔/.test(note))) { say(note); last = note; }
      if (note && Date.now() - lastLive > 2500) { lastLive = Date.now(); await live({ step: /Reading/.test(note) ? 'read' : 'search', note, n: s.p.n || 0, prog: s.p.prog || 0 }); }
      if (/^\s*(⚠️|⛔)/.test(note) && !s.done) { await steps(page); await fail('The collector stopped: ' + note); }
      if (s.done) done = await page.evaluate(() => window.__nxDone);
    }
    await steps(page);
    if (!done) await fail('Timed out after 55 minutes');
    const rows = (done.rows || []).slice(0, 5000);
    tlog('SAVE', rows.length + ' cards · ' + rows.filter(r => r.Email).length + ' emails · ' + rows.filter(r => r.Phone).length + ' phones · ' + netN + ' network calls');
    say('Collected ' + rows.length + ' registration cards'); await live({ step: 'save', note: 'Saving ' + rows.length + ' cards in HotelOps…', n: rows.length, prog: 98 });
    const card = { at: Date.now(), from, to, by: 'cloud', n: rows.length, rows, reader: mode, fields: fields||Object.keys(rows[0]||{}), hotelName, account: R.who === 'main' ? '' : acct };
    if (E.DRY) { fs.writeFileSync(E.DRY_OUT || 'neorcha-cloud.json', JSON.stringify(card)); say('DRY run: saved to ' + (E.DRY_OUT || 'neorcha-cloud.json')); }
    if (FB) { await FB.save(card); say('✅ Saved in HotelOps — open Neorcha Registrations on any device.'); }
    tlog('SAVE', '✓ Written to HotelOps · hotels/…/neorcha'); tlog('SYS', 'Done · browser closed');
    await live({ state: 'done', step: 'done', note: rows.length + ' registration cards saved in HotelOps', n: rows.length, prog: 100 });
  } finally { await browser.close().catch(() => {}); }
}
if (require.main === module) main().catch(e => fail('Stopped: ' + String(e && e.message || e).split('\n')[0].replace(/\d{6,}/g, '#')));
module.exports = { datesOf, fbConfig, resolveLogin, readerFor };

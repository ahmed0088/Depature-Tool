// ═══════════════════════════════════════════════════════════
//  scripts/opera-cloud.js — the Opera profile fixer, run by GitHub (no PC, no extension)
//  .github/workflows/opera-cloud.yml starts it. It opens Opera Cloud in Chrome on GitHub's machine,
//  signs in through Microsoft (password + a 6-digit code made from the authenticator key), then runs
//  the SAME fixer as the HotelOps helper (tools/hotelops-opera-fixer.console.js) inside the Opera page.
//
//  Read-only by default (MODE=audit: it opens each guest, reads, logs what it WOULD fill, types and saves nothing).
//  MODE=signin only signs in and opens In House. MODE=save fills empty fields and presses Save (only when asked).
//  The repo is public: the log shows steps and counts only. Never printed: names, passwords, codes, ID numbers (last 4 at most).
//
//  Secrets: OPERA_URL (the hotel's Opera Cloud link), OPERA_USER, OPERA_PASS, HOTELOPS_EMAIL, HOTELOPS_PASS (already used by Neorcha).
//  The 6-digit authenticator code is typed by him in HotelOps each run (private path hotels/<hotel>/operaCloudCode, used once, deleted at once).
//  OPERA_TOTP (an authenticator key) is optional: when it exists the code is made here and nobody types it.
//  Plan: PLAN_FILE (a plan code from HotelOps, tests only) or the private HotelOps path (USE_JOB=1, with HOTELOPS_EMAIL/PASS).
// ═══════════════════════════════════════════════════════════
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..'), E = process.env;
const mask = s => String(s || '').replace(/\S+@\S+/g, '•@•').replace(/\d{6,}/g, d => '••••' + d.slice(-4)).slice(0, 200);
const say = m => console.log(new Date().toISOString().slice(11, 19) + '  ' + mask(m));
const fail = (m, code) => { console.log('::error::' + mask(m)); process.exit(code == null ? 1 : code); };

// ── authenticator code (RFC 6238, 30 s, 6 digits, SHA-1) ──
function b32(s) { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '', out = []; String(s).toUpperCase().replace(/[\s=-]/g, '').split('').forEach(c => { const v = A.indexOf(c); if (v < 0) throw new Error('bad key'); bits += v.toString(2).padStart(5, '0'); }); for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
function totp(key, nowMs) {
  const ctr = Math.floor((nowMs == null ? Date.now() : nowMs) / 30000), b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(ctr / 2 ** 32), 0); b.writeUInt32BE(ctr >>> 0, 4);
  const h = crypto.createHmac('sha1', b32(key)).update(b).digest(), o = h[h.length - 1] & 15;
  return String(((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6).padStart(6, '0');
}
const okUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' && /(^|\.)oraclecloud\.com$/i.test(x.hostname); } catch (_) { return false; } };

// ── Microsoft sign-in, step by step; on a surprise it logs only the page's title and button labels ──
async function msSignIn(page, user, pass, getCode) {
  const seen = async () => { const t = await page.title().catch(() => ''); const b = await page.$$eval('button,input[type=submit],a[role=button],[role=button]', n => n.map(x => (x.value || x.textContent || '').trim()).filter(Boolean).slice(0, 8)).catch(() => []); return 'title "' + t.slice(0, 60) + '"; buttons: ' + b.join(' | ').slice(0, 160); };
  let usedCode = '';
  for (let step = 0; step < 24; step++) {
    await page.waitForTimeout(1500);
    const url = page.url();
    if (/oraclecloud\.com/i.test(new URL(url).hostname) && !/login|signin|sso|idcs/i.test(url) && await page.$('a[id*="ode_pg_sdbr_"], [id*="pt1:"]').catch(() => null)) { say('signed in to Opera'); return true; }
    const vis = async s => { const e = await page.$(s); return e && await e.isVisible().catch(() => false) ? e : null; };
    let e;
    if ((e = await vis('input[name="loginfmt"]'))) { say('step: Microsoft email'); await e.fill(user); await (await vis('#idSIButton9') || e).press('Enter').catch(() => {}); continue; }
    if ((e = await vis('input[name="passwd"]'))) { say('step: Microsoft password'); await e.fill(pass); await (await vis('#idSIButton9') || e).press('Enter').catch(() => {}); continue; }
    if ((e = await vis('input[name="otc"]'))) {
      say('step: authenticator code needed'); const code = await getCode(usedCode); if (!code) fail('No authenticator code arrived within 3 minutes. Run again and type the code in HotelOps when asked.'); usedCode = code; say('step: typing the code'); await e.fill(code); await (await vis('#idSubmit_SAOTCC_Continue') || await vis('#idSIButton9') || e).press('Enter').catch(() => {}); continue;
    }
    const other = await vis('#signInAnotherWay, a:has-text("Sign in another way"), a:has-text("I can\'t use my Microsoft Authenticator app right now")');
    if (other) { say('step: choose another sign-in way'); await other.click(); continue; }
    const codeOpt = await vis('div[data-value="PhoneAppOTP"], [data-value="PhoneAppOTP"], div:has-text("Use a verification code")');
    if (codeOpt) { say('step: pick verification code'); await codeOpt.click(); continue; }
    if ((e = await vis('#idBtn_Back'))) { say('step: stay signed in? No'); await e.click(); continue; }
    if ((e = await vis('button:has-text("Sign in with Microsoft"), a:has-text("Sign in with Microsoft"), button:has-text("Microsoft")'))) { say('step: choose Microsoft'); await e.click(); continue; }
    if (step > 3 && step % 4 === 0) say('waiting; ' + await seen());
  }
  fail('Microsoft sign-in did not finish. Last page: ' + await seen());
}

// ── the code path: HotelOps writes {code, at}; the runner reads it once and deletes it ──
function fbConfig() {
  const src = fs.readFileSync(path.join(ROOT, 'firebase-config.js'), 'utf8');
  const g = k => { const m = src.match(new RegExp(k + '\\s*:\\s*"([^"]+)"')); return m ? m[1] : ''; };
  return { apiKey: g('apiKey'), databaseURL: g('databaseURL') };
}
async function fbOpen() {
  if (!E.HOTELOPS_EMAIL || !E.HOTELOPS_PASS) fail('The HOTELOPS_EMAIL / HOTELOPS_PASS secrets are missing (needed to receive the code)');
  const C = fbConfig(), authUrl = E.FB_AUTH_URL || 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword', db = (E.FB_DB_URL || C.databaseURL).replace(/\/$/, '');
  const r = await fetch(authUrl + '?key=' + encodeURIComponent(C.apiKey), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: String(E.HOTELOPS_EMAIL).trim(), password: E.HOTELOPS_PASS, returnSecureToken: true }) });
  const a = await r.json().catch(() => ({}));
  if (!r.ok || !a.idToken) fail('HotelOps sign-in refused (' + ((a.error && a.error.message) || r.status) + ')');
  let hid = String(E.HOTELOPS_HOTEL || '').trim();
  if (!hid) { const u = await (await fetch(db + '/userHotels/' + a.localId + '.json?auth=' + a.idToken)).json().catch(() => null); hid = typeof u === 'string' ? u : u && typeof u === 'object' ? String(u.hotelId || u.id || Object.keys(u)[0] || '') : ''; }
  if (!/^[\w-]{1,80}$/.test(hid)) fail('No hotel found for the HotelOps account (add the HOTELOPS_HOTEL secret)');
  const at = p => db + '/hotels/' + hid + '/' + p + '.json?auth=' + a.idToken;
  return {
    get: async p => (await fetch(at(p))).json().catch(() => null),
    put: async (p, v) => { await fetch(at(p), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) }).catch(() => {}); },
    del: async p => { await fetch(at(p), { method: 'DELETE' }).catch(() => {}); },
  };
}
// waits up to 3 minutes for a code typed within the last 2 minutes; reads it once and deletes it at once
async function codeFromHotelOps(FB, notThis) {
  await FB.put('operaCloudWant', { at: Date.now(), state: 'waiting' });
  const t0 = Date.now();
  while (Date.now() - t0 < 180000) {
    const v = await FB.get('operaCloudCode');
    if (v && /^\d{6}$/.test(String(v.code || '')) && Date.now() - Number(v.at || 0) < 120000 && String(v.code) !== notThis) { await FB.del('operaCloudCode'); await FB.del('operaCloudWant'); return String(v.code); }
    await new Promise(r => setTimeout(r, 2000));
  }
  await FB.del('operaCloudWant'); return '';
}

async function main() {
  const MODE = String(E.MODE || 'audit').toLowerCase();
  if (MODE === 'cleanup') {   // privacy: remove any plan/code/want nobody picked up. CLEANUP_MAX_MIN = only if older than that (scheduled); empty = remove now (after a run)
    const F = await fbOpen(), max = parseFloat(E.CLEANUP_MAX_MIN || '');
    const pl = await F.get('operaCloudPlan');
    if (pl !== null && (!max || !pl || Date.now() - Number(pl.at || 0) > max * 60000)) { await F.del('operaCloudPlan'); say('cleanup: removed an unused plan'); } else say('cleanup: no stale plan');
    for (const k of ['operaCloudCode', 'operaCloudWant']) { const v = await F.get(k); if (v !== null && (!max || Date.now() - Number(v && v.at || 0) > max * 60000)) await F.del(k); }
    const r = await F.get('operaCloudResult'); if (r !== null && Date.now() - Number(r && r.at || 0) > 864e5) await F.del('operaCloudResult');
    return;
  }
  if (!['signin', 'audit', 'save'].includes(MODE)) fail('MODE must be signin, audit or save');
  const url = String(E.OPERA_URL || '').trim();
  if (!okUrl(url)) fail('OPERA_URL is missing or is not an https oraclecloud.com link');
  for (const k of ['OPERA_USER', 'OPERA_PASS']) if (!E[k]) fail('The ' + k + ' secret is missing');
  const FB = E.OPERA_TOTP && MODE === 'signin' ? null : await fbOpen();   // the private path: the code, the plan, the results
  if (FB) { await FB.del('operaCloudCode'); await FB.del('operaCloudWant'); }   // never use an old code
  const getCode = async notThis => E.OPERA_TOTP ? totp(E.OPERA_TOTP) : codeFromHotelOps(FB, notThis);
  // the plan is read and deleted at once, before anything else, so it never outlives this run (a stale result is dropped after a day)
  let job = null;
  if (MODE !== 'signin' && !E.PLAN_FILE) {
    job = await FB.get('operaCloudPlan'); await FB.del('operaCloudPlan');
    if (!job || typeof job.code !== 'string') fail('No plan found. In HotelOps press "Send plan to cloud", then run this again.');
    if (Date.now() - Number(job.at || 0) > 3 * 3600e3) fail('The plan is older than 3 hours and was deleted. Send it again from HotelOps.');
  }
  if (FB) { const old = await FB.get('operaCloudResult'); if (old && Date.now() - Number(old.at || 0) > 864e5) await FB.del('operaCloudResult'); }
  const { chromium } = require('playwright-core');
  const executablePath = [E.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && fs.existsSync(p));
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  page.setDefaultTimeout(30000);
  const limit = Math.max(0, parseInt(E.LIMIT, 10) || 0);
  try {
    say('mode ' + MODE + (limit ? ', first ' + limit + ' room(s)' : '') + ': opening Opera');
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await msSignIn(page, E.OPERA_USER, E.OPERA_PASS, getCode);
    await page.waitForTimeout(4000);
    await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'tools/hotelops-opera-fixer.console.js'), 'utf8') });
    const counts = { total: 0 }; 
    const lines = []; let lastPush = 0;
    const pushResult = async (state, extra) => { if (FB) await FB.put('operaCloudResult', Object.assign({ at: Date.now(), state, mode: MODE, lines: lines.slice(-400) }, extra || {})); };
    await page.exposeFunction('__opLog', async e => { counts.total++; if (counts.total % 20 === 0) say('progress: ' + counts.total + ' steps'); lines.push({ room: String(e.room || ''), field: String(e.field || ''), to: String(e.to || '').replace(/\d{5,}/g, d => '••••' + d.slice(-4)).slice(0, 40), result: mask(e.result).slice(0, 160), dry: !!e.dry }); if (FB && Date.now() - lastPush > 8000) { lastPush = Date.now(); await pushResult('running'); } });
    await page.evaluate(() => window.__hoFixer.setHook((k, a) => { if (k === 'log') window.__opLog(a); }));
    if (MODE === 'signin') {
      const why = await page.evaluate(() => window.__hoFixer._test.ensureInHouse());
      say(why ? 'In House did not open: ' + why : 'In House opened. Sign-in test passed.'); if (why) process.exitCode = 1;
    } else {
      let code = '';
      let wantSave = MODE === 'save';
      if (E.PLAN_FILE) code = fs.readFileSync(E.PLAN_FILE, 'utf8').trim();
      else { code = job.code; if (wantSave && job.mode !== 'save') { say('Save was not switched on in HotelOps: running read-only instead'); wantSave = false; } }
      const n = await page.evaluate(([c, dry, lim]) => { const f = window.__hoFixer; f.loadCode(c); f._test.setDry(dry); if (lim) f._test.st.plan.items = f._test.st.plan.items.slice(0, lim); return f._test.st.plan.items.length; }, [code, !wantSave, limit]);
      await page.evaluate(() => window.__hoFixer.setHook((k, a) => { if (k === 'log') window.__opLog(a); }));
      say(n + ' room(s) in the plan; ' + (wantSave ? 'WILL fill empty fields and Save' : 'read-only audit'));
      await page.evaluate(() => window.__hoFixer._test.autoRun(0));
      say('finished: ' + counts.total + ' steps (room details are only in the HotelOps card)'); await pushResult('done', { rooms: n, saved: wantSave });
    }
  } catch (e) { try { if (FB) await FB.put('operaCloudResult', { at: Date.now(), state: 'failed', mode: MODE, error: mask(e && e.message || e).slice(0, 200), lines: [] }); } catch (_) {} throw e;
  } finally { try { if (FB) { await FB.del('operaCloudCode'); await FB.del('operaCloudWant'); await FB.del('operaCloudPlan'); } } catch (_) {} await browser.close(); }
}
if (require.main === module) main().catch(e => fail(/^(audit|save)$/i.test(String(E.MODE || 'audit')) ? 'Runner stopped (details are only in the HotelOps card, not in this public log)' : 'Runner stopped: ' + (e && e.message || e)));
module.exports = { totp, b32, okUrl, codeFromHotelOps };

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
const ROOT = path.join(__dirname, '..'), E = process.env, RUN_TAG=String(E.RUN_TAG||'');
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
async function freshTotp(key,previous,{now=Date.now,delay=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  const remaining=30000-(now()%30000);
  if(remaining<=10000||totp(key,now())===previous)await delay(remaining+200);
  return totp(key,now());
}
const okUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' && /(^|\.)oraclecloud\.com$/i.test(x.hostname); } catch (_) { return false; } };

// ── Microsoft sign-in, step by step; on a surprise it logs only the page's title and button labels ──
// A cloud machine has no passkey device. Hide WebAuthn so Microsoft does not offer "Face, fingerprint, PIN or security key" and goes to the password instead.
const { NO_PASSKEY, msSignIn } = require('./opera-signin.js');

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
  const request=async(p,method,value)=>{const response=await fetch(at(p),{method,...(value===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})});if(!response.ok)throw Error('HotelOps could not '+(method==='GET'?'read':'save')+' the private automation state ('+response.status+'). Check the worker account’s database access.');return response.json().catch(()=>null);};
  return {get:p=>request(p,'GET'),put:(p,v)=>request(p,'PUT',v),del:p=>request(p,'DELETE')};
}
// HotelOps waits five minutes for a CURRENT code; this never extends the provider's code validity.
const CODE_WAIT_MS=5*60*1000;
async function codeFromHotelOps(FB,notThis,tag='',{now=Date.now,delay=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  const t0=now(),expiresAt=t0+CODE_WAIT_MS;
  await FB.put('operaCloudWant',{at:t0,expiresAt,state:'waiting',tag});
  while(now()<expiresAt){
    const v = await FB.get('operaCloudCode');
    const age=now()-Number(v?.at||0);
    if (v && (!tag||v.tag===tag) && /^\d{6}$/.test(String(v.code || '')) && age>=0 && age < 120000 && String(v.code) !== notThis) { await FB.del('operaCloudCode');const want=await FB.get('operaCloudWant');if(!tag||want?.tag===tag)await FB.del('operaCloudWant'); return String(v.code); }
    await delay(1000);
  }
  const want=await FB.get('operaCloudWant');if(!tag||want?.tag===tag)await FB.del('operaCloudWant');return '';
}

async function main() {
  const MODE = String(E.MODE || 'audit').toLowerCase();
  if (MODE === 'cleanup') {   // privacy: remove any plan/code/want nobody picked up. CLEANUP_MAX_MIN = only if older than that (scheduled); empty = remove now (after a run)
    const F = await fbOpen(), max = parseFloat(E.CLEANUP_MAX_MIN || '');
    const pl = await F.get('operaCloudPlan');
    if (pl !== null && (!RUN_TAG||pl?.tag===RUN_TAG) && (!max || !pl || Date.now() - Number(pl.at || 0) > max * 60000)) { await F.del('operaCloudPlan'); say('cleanup: removed an unused plan'); } else say('cleanup: no stale plan');
    for (const k of ['operaCloudCode', 'operaCloudWant']) { const v = await F.get(k); if (v !== null && (!RUN_TAG||v?.tag===RUN_TAG) && (!max || Date.now() - Number(v && v.at || 0) > max * 60000)) await F.del(k); }
    const r = await F.get('operaCloudResult'); if (r !== null && Date.now() - Number(r && r.at || 0) > 864e5) await F.del('operaCloudResult');
    return;
  }
  if (!['signin', 'audit', 'save'].includes(MODE)) fail('MODE must be signin, audit or save');
  for (const k of ['OPERA_USER', 'OPERA_PASS']) if (!E[k]) fail('The ' + k + ' secret is missing');
  const FB = await fbOpen();   // the private path: the code, the plan, the results
  const link=require('../opera-auto-core').validateOperaUrl(E.OPERA_URL||await FB.get('operaUrl')),url=link.ok?link.url:'';
  if(!okUrl(url)){const error='Save a valid Opera Cloud link for this hotel in Immigration Check before starting.';await FB.put('operaCloudResult',{at:Date.now(),state:'failed',mode:MODE,tag:RUN_TAG,error,lines:[]});throw Error(error);}
  if (FB) { for(const key of ['operaCloudCode','operaCloudWant']){const value=await FB.get(key);if(!RUN_TAG||value?.tag===RUN_TAG||Date.now()>(key==='operaCloudWant'?Number(value?.expiresAt)||Number(value?.at||0)+180000:Number(value?.at||0)+180000))await FB.del(key);} }   // never use an old code
  const getCode = async notThis => E.OPERA_TOTP ? freshTotp(E.OPERA_TOTP,notThis) : codeFromHotelOps(FB, notThis,RUN_TAG);
  // the plan is read and deleted at once, before anything else, so it never outlives this run (a stale result is dropped after a day)
  let target={url};
  const rejectPlan=async error=>{await FB.put('operaCloudResult',{at:Date.now(),state:'failed',mode:MODE,tag:RUN_TAG,target,error,lines:[]});throw Error(error);};
  let job = null;
  if (MODE !== 'signin' && !E.PLAN_FILE) {
    job = await FB.get('operaCloudPlan');if(RUN_TAG&&job?.tag!==RUN_TAG)await rejectPlan('This reviewed plan belongs to another cloud run. Review the current plan and start again.');await FB.del('operaCloudPlan');
    if (!job || typeof job.code !== 'string') await rejectPlan('No plan found. In HotelOps press "Send plan to cloud", then run this again.');
    if(job.target){const selected=require('../opera-auto-core').validateOperaUrl(job.target.url);if(!selected.ok||selected.url!==url)await rejectPlan('The saved hotel link differs from the reviewed plan. Choose the hotel and review its reports again.');target={url,id:String(job.target.id||''),name:String(job.target.name||'').slice(0,100)};}
    if (Date.now() - Number(job.at || 0) > 3 * 3600e3) await rejectPlan('The plan is older than 3 hours and was deleted. Send it again from HotelOps.');
  }
  if (FB) { const old = await FB.get('operaCloudResult'); if (old && Date.now() - Number(old.at || 0) > 864e5) await FB.del('operaCloudResult'); }
  const { chromium } = require('playwright-core');
  const executablePath = [E.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && fs.existsSync(p));
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }); await ctx.addInitScript(NO_PASSKEY);
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const limit = Math.max(0, parseInt(E.LIMIT, 10) || 0);
  const reportStatus=async(stage,note)=>{say(note);if(FB)await FB.put('operaCloudResult',{at:Date.now(),state:'running',mode:MODE,stage,note,lines:[],tag:RUN_TAG,target});};
  try {
    await reportStatus('starting','Cloud computer ready; opening the selected Opera link');
    say('mode ' + MODE + (limit ? ', first ' + limit + ' room(s)' : '') + ': opening Opera');
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await msSignIn(page, E.OPERA_USER, E.OPERA_PASS, getCode,{progress:reportStatus});
    await page.waitForTimeout(4000);
    await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'tools/hotelops-opera-fixer.console.js'), 'utf8') });
    const counts = { total: 0 }; 
    const lines = []; let lastPush = 0;
    const pushResult = async (state, extra) => { if (FB) await FB.put('operaCloudResult', Object.assign({ at: Date.now(), state, mode: MODE, tag:RUN_TAG, target, lines: lines.slice(-400) }, extra || {})); };
    await page.exposeFunction('__opLog', async e => { counts.total++; if (counts.total % 20 === 0) say('progress: ' + counts.total + ' steps'); lines.push({ room: String(e.room || ''), field: String(e.field || ''), to: String(e.to || '').replace(/\d{5,}/g, d => '••••' + d.slice(-4)).slice(0, 40), result: mask(e.result).slice(0, 160), dry: !!e.dry }); if (FB && Date.now() - lastPush > 8000) { lastPush = Date.now(); await pushResult('running'); } });
    await page.evaluate(() => window.__hoFixer.setHook((k, a) => { if (k === 'log') window.__opLog(a); }));
    if (MODE === 'signin') {
      const why = await page.evaluate(() => window.__hoFixer._test.ensureInHouse());
      say(why ? 'In House did not open: ' + why : 'In House opened. Sign-in test passed.'); if (why) process.exitCode = 1;await pushResult(why?'failed':'done',{stage:'signed-in',note:why?'Signed in, but the In House page could not open.':'Signed in to Opera. In House is ready; no guest records were changed.',...(why?{error:'The In House page could not open.'}:{})});
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
  } catch (e) { try { if (FB) await FB.put('operaCloudResult', { at: Date.now(), state: 'failed', mode: MODE, tag:RUN_TAG,target,error: mask(e && e.message || e).slice(0, 200), lines: [] }); } catch (_) {} throw e;
  // a sign-in test never touches a plan that was sent for a check
  } finally { try { if (FB) { for(const key of ['operaCloudCode','operaCloudWant',...(MODE==='signin'?[]:['operaCloudPlan'])]){const value=await FB.get(key);if(!RUN_TAG||value?.tag===RUN_TAG)await FB.del(key);} } } catch (_) {} await browser.close(); }
}
if (require.main === module) main().catch(e => fail(/^(audit|save)$/i.test(String(E.MODE || 'audit')) ? 'Runner stopped (details are only in the HotelOps card, not in this public log)' : 'Runner stopped: ' + (e && e.message || e)));
module.exports = { fbOpen, NO_PASSKEY, totp, freshTotp, CODE_WAIT_MS, b32, okUrl, codeFromHotelOps, msSignIn };

'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
(async()=>{const executablePath=[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p)),browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});try{
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390,serviceWorkers:'block'}),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{requests.push(r.request().method());return r.request().url()==='https://status.hotelops.test/'?r.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--card:#151b24;--bg:#0b1119;--bg2:#1c2430;--text:#edf2f7;--text2:#aab8c8;--text3:#aab8c8;--border:#334155;--border2:#4c6075;--accent:#e8bd38}*{box-sizing:border-box}body{margin:0;padding:12px;font:14px Arial;background:var(--bg);color:var(--text)}nav{display:none}.btn{min-height:44px;padding:10px 12px;border:1px solid var(--border);background:var(--card);color:var(--text);border-radius:8px;font:inherit}[hidden]{display:none!important}</style><nav class="sidenav"></nav><main class="main"></main>'}):r.abort();});
  await page.goto('https://status.hotelops.test/');
  await page.evaluate(()=>{window.HOTEL_ID='example';window.currentUser=null;window.currentProfile=null;window._meHotel=()=> 'Example Hotel';window.showToast=()=>{};});
  for(const path of ['db.js','neorcha.js'])await page.addScriptTag({content:fs.readFileSync(path,'utf8')});
  await page.evaluate(()=>{const R=hoNeorcha._run.RUN;Object.assign(R,{tag:'hosynthetic112',at:Date.now()-30000,hotelId:'example',gh:{status:'completed',conclusion:'success',run_number:112,updated_at:new Date().toISOString()}});hoNxRunOpen();});
  assert.match(await page.locator('.nxr-note').innerText(),/GitHub finished successfully/);assert.equal(await page.locator('.nxr-steps .bad,.nxr-steps .sp').count(),0);assert.doesNotMatch(await page.locator('#nxr-term').innerText(),/code 1|Secrets/);assert(await page.locator('#nxr-refresh').isVisible());
  await page.evaluate(()=>window.refreshButtonBeforeTick=document.getElementById('nxr-refresh'));await page.waitForTimeout(1100);assert(await page.evaluate(()=>refreshButtonBeforeTick===document.getElementById('nxr-refresh')),'timer updates must preserve the phone controls');
  await page.evaluate(()=>{
   const started=hoNeorcha._run.RUN.at,tag='hosynthetic112',rows=Array.from({length:39},(_,i)=>({'Confirmation Number':String(70000001+i),'First Name':'Example','Last Name':'Guest '+i,'Arrival Date':'2026-11-16'}));
   window.backend={['cloudRuns/'+tag]:{tag,kind:'neorcha',started,at:started+20000,finishedAt:started+20000,state:'done',step:'done',n:39,from:'2026-11-16',to:'2026-11-16',note:'39 registration cards saved in HotelOps'},neorchaLive:{tag:'laterjob',started:Date.now(),at:Date.now(),state:'run',step:'login'},neorcha:{tag,at:started+19000,from:'2026-11-16',to:'2026-11-16',by:'cloud',n:39,rows}};
   window.reads=[];window.subscriptions=[];
   _ref={child:path=>({on:(_event,callback)=>{subscriptions.push(path);callback({val:()=>backend[path]||null});},once:async()=>{reads.push(path);return{val:()=>backend[path]||null};}})};
   currentUser={uid:'example'};currentProfile={role:'owner',name:'Example Manager',active:true};fbSignedInNow();
  });
  assert(await page.evaluate(()=>subscriptions.includes('neorchaLive')&&subscriptions.includes('neorcha')),'startup listeners must bind after sign-in');
  await page.locator('#nxr-refresh').click();await page.waitForFunction(()=>hoNeorcha._run.RUN.saved?.state==='done');
  assert.match(await page.locator('.nxr-note').innerText(),/39 registration cards saved/);assert.equal(await page.locator('.nxr-steps li.ok').count(),6);assert.equal(await page.locator('.nxr-steps .bad,.nxr-steps .sp').count(),0);assert.match(await page.locator('#nxr-term').innerText(),/39 cards saved.*result received/);assert.doesNotMatch(await page.locator('#nxr-term').innerText(),/code 1|four Secrets/);
  assert(await page.evaluate(()=>reads.includes('cloudRuns/hosynthetic112')));assert(!requests.some(m=>!['GET','HEAD','OPTIONS'].includes(m)),'refresh must never dispatch another run');
  if(width===390)assert(await page.locator('.nxr-card').evaluate(e=>e.getBoundingClientRect().right<=innerWidth+1));assert.deepEqual(errors,[]);await page.close();
 }
 console.log('Neorcha status phone/desktop passed: startup reconnect, successful workflow without a false error, exact-run history recovery despite a newer live run, 39 saved cards, refresh without redispatch and no fabricated exit code. Synthetic data only.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});

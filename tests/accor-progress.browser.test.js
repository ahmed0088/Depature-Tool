'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
(async()=>{
 const browser=await chromium.launch({executablePath:[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p)),headless:true,args:['--no-sandbox']});
 try{
  for(const width of [390,1100]){
   const context=await browser.newContext({viewport:{width,height:844},isMobile:width===390,hasTouch:width===390}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>r.request().url()==='https://progress.test/'?r.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="hotelName">Example hotel</div><div id="gpCloudLive"></div>'}):r.abort());
   const load=async()=>{
    await page.goto('https://progress.test/');await page.addStyleTag({content:fs.readFileSync('pro.css','utf8')});await page.addStyleTag({content:':root{--card:#fff;--bg:#f8f9fc;--bg2:#f0f2f8;--text:#202535;--text2:#657086;--text3:#657086;--border:#dce0ea;--accent:#4f67e8;--font:system-ui}body{font:14px system-ui}[hidden]{display:none!important}.acr-reconnecting{display:block;margin-top:6px}'});
    await page.evaluate(()=>{window.HOTEL_ID='hotel-a';window._ref={};window.showToast=()=>{};window.escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));window.currentProfile={name:'Synthetic'};window.operations=[];window.fbSet=window.fbUpdate=async(path,value)=>operations.push({path,value});window.listeners={};window.fbListen=(path,fn)=>listeners[path]=fn;window.fbGet=async()=>null;});
    for(const f of ['guest-pipeline.js','run-dock.js'])await page.addScriptTag({content:fs.readFileSync(f,'utf8')});
   };
   await load();
   await page.evaluate(()=>{
    window.base={tag:'example-run',started:Date.now()-3600e3,at:Date.now(),n:400,done:360,state:'run',step:'enroll',note:'Working',portalName:'Example hotel',current:{index:361,total:400,name:'Example Guest',conf:'EXAMPLE',country:'Canada'},tally:{enrolled:20,already:300,skipped:20,errors:20},report:{processed:360,submitted:20,alreadyMember:300,skipped:20,errors:20,guests:[{name:'Example Guest',conf:'EXAMPLE',cat:'error',status:'bad_email',countryAudit:{requested:'Unknownland',selected:'United Arab Emirates',fallback:true,reason:'country_not_in_portal'}}]},con:[{t:1,g:'SYS',m:'Synthetic progress'}]};
    listeners.cloudRuns({'example-run':{...base,no:21,kind:'enrol',hotel:'Example hotel',url:'https://github.com/ahmed0088/Depature-Tool/actions/runs/1'}});
    gpCloudPaint(base);gpAccorRunWin(true);
   });
   await page.evaluate(()=>listeners.enrollLive({...base,at:Date.now()+1,done:0,tally:null,report:null}));assert.equal(await page.evaluate(()=>hoRuns.get('enrol','example-run').done),360,'run history retains progress across an older worker’s zero snapshot');
   assert.deepEqual(await page.locator('.acr-tile b').allTextContents(),['20','300','20','20']);assert.match(await page.locator('#gpAccorModalSub').innerText(),/Run #21/);assert.match(await page.locator('.acr-steps').innerText(),/360 \/ 400/);
   await page.locator('.acr-tile.bad').click();await page.locator('.acr-tile.bad').click();assert.equal(await page.locator('#acrCat').isVisible(),false);await page.locator('.acr-tile.bad').click();assert.match(await page.locator('#acrCat').innerText(),/Example Guest/);assert.match(await page.locator('#acrCat').innerText(),/Country fallback: United Arab Emirates.*source: Unknownland/);await page.locator('[data-acr-con]').click();
   await page.evaluate(()=>{window.saved={spinner:document.querySelector('.acr-steps .sp'),tiles:document.querySelector('.acr-tiles'),stop:document.querySelector('.acr-act button'),cat:document.querySelector('.acr-cat-row')};saved.stop.focus();window.bodyChanges=0;window.observer=new MutationObserver(changes=>{bodyChanges+=changes.filter(c=>c.type==='childList'&&c.addedNodes.length).length});observer.observe(document.getElementById('gpAccorModalBody'),{childList:true,subtree:true});document.querySelector('.gp-accor-modal-b').scrollTop=80;window.oldScroll=document.querySelector('.gp-accor-modal-b').scrollTop;});
   await page.waitForTimeout(2200);
   assert.equal(await page.evaluate(()=>bodyChanges),0,'elapsed-time ticks must not rebuild modal content');
   await page.evaluate(()=>gpCloudPaint({...base,at:Date.now()+1,done:0,tally:null,report:null,current:{...base.current,index:362},note:'Portal reloaded'}));
   assert.deepEqual(await page.locator('.acr-tile b').allTextContents(),['20','300','20','20']);assert.match(await page.locator('.acr-steps').innerText(),/360 \/ 400/);
   assert(await page.evaluate(()=>saved.spinner===document.querySelector('.acr-steps .sp')&&saved.tiles===document.querySelector('.acr-tiles')&&saved.stop===document.activeElement&&saved.cat===document.querySelector('.acr-cat-row')),'progress updates preserve animation nodes, buttons, focus and category rows');
   assert.equal(await page.locator('#acrCat').isVisible(),true);assert.equal(await page.locator('#gpAccCon').evaluate(e=>e.classList.contains('off')),true);assert.equal(await page.evaluate(()=>document.querySelector('.gp-accor-modal-b').scrollTop),await page.evaluate(()=>oldScroll));
   const cache=await page.evaluate(()=>JSON.parse(localStorage.getItem('gp_enrol_progress_v1:hotel-a')));assert.equal(cache.done,360);assert(!JSON.stringify(cache).includes('Example Guest'));assert(!JSON.stringify(cache).includes('EXAMPLE'));
   const sparse={tag:'example-run',started:Date.now()-3600e3,at:Date.now()+5,n:400,done:0,tally:null,report:null,state:'run',step:'enroll',current:{index:363,total:400},note:'Portal reload'};
   await load();await page.evaluate(v=>{gpCloudPaint(v);gpAccorRunWin(true)},sparse);
   assert.deepEqual(await page.locator('.acr-tile b').allTextContents(),['20','300','20','20'],'counts survive a full page reload while the worker is between pages');assert.match(await page.locator('.acr-steps').innerText(),/360 \/ 400/);
   await page.evaluate(v=>{HOTEL_ID='hotel-b';gpCloudPaint(v)},sparse);assert.deepEqual(await page.locator('.acr-tile b').allTextContents(),['—','—','—','—'],'another hotel cannot inherit cached figures');assert.match(await page.locator('.acr-reconnecting').innerText(),/unavailable/);
   // A history snapshot can arrive later than the live feed on a fresh device.
   await page.evaluate(v=>{HOTEL_ID='hotel-c';gpCloudPaint(v);listeners.cloudRuns({'example-run':{tag:v.tag,kind:'enrol',no:44,at:Date.now(),started:v.started,n:400,done:359,tally:{enrolled:19,already:300,skipped:20,errors:20},state:'run',hotel:'Example hotel'}})},sparse);
   assert.deepEqual(await page.locator('.acr-tile b').allTextContents(),['19','300','20','20']);assert.match(await page.locator('#gpAccorModalSub').innerText(),/Run #44/);
   await page.evaluate(()=>gpCloudPaint({tag:'new-run',started:Date.now()+10,at:Date.now()+10,state:'run',step:'queued',n:5,done:0}));assert.deepEqual(await page.locator('.acr-tile b').allTextContents(),['—','—','—','—']);assert.match(await page.locator('.acr-steps').innerText(),/0 \/ 5/);
   await page.evaluate(v=>gpCloudPaint(v),sparse);assert.match(await page.locator('.acr-steps').innerText(),/0 \/ 5/,'a delayed old-run update cannot replace the active run');
   await page.evaluate(()=>{gpCloudPaint({tag:'new-run',at:Date.now()+11,started:Date.now()+10,n:5,state:'run',step:'enroll',done:1,tally:{enrolled:1,already:0,skipped:0,errors:0},current:{index:2,total:5,name:'Example Two'}});gpAccorRunWin(false);gpAccorRunWin(true)});assert.deepEqual(await page.locator('.acr-tile b').allTextContents(),['1','0','0','0']);
   assert(await page.locator('.gp-accor-modal-card').evaluate(el=>el.getBoundingClientRect().right<=innerWidth+1),'window fits phone/desktop');assert.deepEqual(errors,[]);if(width===390)await page.screenshot({path:process.env.ACCOR_PROGRESS_SCREENSHOT||'/tmp/enrolment-progress583-phone.png'});await context.close();
  }
  console.log('Phone/desktop progress checks passed: full reload, sparse snapshots, history hydration, run/hotel isolation, stable timer DOM, focus/scroll/category preservation and live window reopen. External actions mocked.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});

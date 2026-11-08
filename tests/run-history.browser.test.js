'use strict';
// Synthetic metadata only; no real Firebase, workflow or financial operations.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
(async()=>{
 const browser=await chromium.launch({executablePath:[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p)),headless:true,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await page.setContent('<button id=opener>Open history</button><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--text:#20232b;--text2:#58616d;--card:#fff;--card2:#f5f6f8;--border:#dedfe2;--border2:#ccc;--accent:#3169cc;--accent-bg:#e4edff;--font:Arial}body{font:16px Arial}</style>');
 await page.evaluate(()=>{
  Object.defineProperty(window,'localStorage',{value:{getItem:()=>null,setItem:()=>{}}});
  window.listeners={};window.writes=[];window.opened=[];
  window._ref={child:()=>({once:async()=>({val:()=>({state:'done',at:Date.now()-10000,n:1,done:1,tally:{applied:1}})})})};
  window.fbListen=(k,fn)=>listeners[k]=fn;window.fbSet=()=>{};window.fbUpdate=(k,v)=>writes.push({k,v});window.hoNxRunOpen=()=>opened.push('neorcha');
  window.fetch=async()=>{throw Error('No external requests allowed');};
 });
 await page.addScriptTag({path:path.join(__dirname,'../run-dock.js')});
 await page.evaluate(()=>{const now=Date.now();window.sample={
 stale:{kind:'neorcha',no:14,state:'run',started:now-15*3600e3,at:now-15*3600e3,note:'Starting…',hotel:'Synthetic Hotel'},
 finished:{kind:'enrol',no:13,state:'done',started:now-16*3600e3,at:now-15.9*3600e3,n:2,done:2,note:'Finished'},
 live:{kind:'neorcha',no:15,state:'run',started:now-60000,at:now,n:1,note:'Reading cards'},
 older:{kind:'enrol',no:1,state:'done',started:now-60*864e5,at:now-60*864e5+10000,note:'Old archive'},
 };listeners.cloudRuns(sample);document.querySelector('#opener').focus();hoRuns.list();});
 assert.equal(await page.locator('.hrl-close').evaluate(el=>document.activeElement===el),true,'dialog receives focus');
 assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden','background scrolling is locked');
 await page.keyboard.press('Shift+Tab');
 assert(await page.locator('#hoRunList').evaluate(el=>el.contains(document.activeElement)),'keyboard focus stays inside the dialog');
 await page.locator('[data-filter=q]').fill('#14');assert.equal(await page.locator('.hrl-run').count(),1);
 await page.locator('[data-reset]').tap();
 await assert.equal(await page.locator('.hrl-run').count(),3);
 assert.equal(await page.locator('.hrl-run.unconfirmed').count(),1);
 assert.equal(await page.locator('[data-hrl-open]').count(),0,'history has no live action');
 assert((await page.locator('.hrl-run.unconfirmed').innerText()).includes('End time not confirmed'));
 assert(!(await page.locator('.hrl-run.unconfirmed').innerText()).includes('15 h'));
 await page.locator('[data-days="7"]').tap();assert.equal(await page.locator('.hrl-run').count(),2);
 await page.locator('[data-filter=from]').fill('2026-12-31');
 await page.locator('[data-filter=to]').fill('2026-11-01');
 assert.equal(await page.locator('[data-filter=from]').getAttribute('aria-invalid'),'true');
 assert.equal(await page.locator('.hrl-run').count(),0,'invalid date range has no misleading results');
 await page.locator('[data-days="7"]').tap();
 await page.locator('[data-filter="kind"]').selectOption('enrol');assert.equal(await page.locator('.hrl-run').count(),1);
 await page.locator('[data-filter="kind"]').selectOption('');
 await page.locator('[data-view="active"]').tap();assert.equal(await page.locator('[data-hrl-open]').count(),1);
 const input=page.locator('[data-filter="from"]');await input.focus();
 await page.evaluate(()=>listeners.neorchaLive({...sample.live,tag:'live',at:Date.now()}));
 assert.equal(await input.evaluate(el=>document.activeElement===el),true,'heartbeat preserves filter focus');
 await page.locator('[data-hrl-open]').tap();assert.deepEqual(await page.evaluate(()=>opened),['neorcha']);
 await page.evaluate(()=>{listeners.neorchaLive({tag:'live',state:'done',at:Date.now(),n:3});hoRuns.list();});
 assert.equal(await page.locator('[data-hrl-open]').count(),0);
 await page.locator('[data-view="all"]').tap();await page.locator('[data-days="0"]').tap();
 assert.equal(await page.locator('.hrl-run').count(),4,'archive is retained');
 await page.locator('[data-filter="outcome"]').selectOption('unconfirmed');assert.equal(await page.locator('.hrl-run').count(),1);
 await page.screenshot({path:process.env.HISTORY_SCREENSHOT||'/tmp/history567-mobile.png',fullPage:true});
 assert(await page.locator('.hrl-card').evaluate(el=>el.getBoundingClientRect().right<=innerWidth+1),'phone dialog fits screen');
 await page.locator('[data-filter="outcome"]').selectOption('');
 await page.evaluate(()=>listeners.cloudRuns({...sample,job:{kind:'ingauge',no:16,state:'run',started:Date.now()-3600000,at:Date.now()-3600000}}));
 // Reconciliation reads the per-tag private job, never a newer singleton.
 await page.evaluate(()=>{ const actualNow=Date.now.bind(Date); Date.now=()=>actualNow()+31000; hoRuns.list(); });
 await page.waitForFunction(()=>writes.some(x=>x.k==='cloudRuns/job'&&x.v.state==='done'));
 assert.equal(await page.locator('.hrl-run').filter({hasText:'#16'}).locator('.hrl-status').innerText(),'Finished');
 // A successful workflow alone does not prove that the business operation succeeded.
 await page.evaluate(()=>{
   window.fetch=async()=>({ok:true,json:async()=>({status:'completed',conclusion:'success',updated_at:new Date().toISOString()})});
   const last=Date.now.bind(Date);Date.now=()=>last()+31000;
   listeners.cloudRuns({gh:{kind:'neorcha',no:17,state:'run',started:Date.now()-60000,at:Date.now(),url:'https://github.com/ahmed0088/Depature-Tool/actions/runs/123'}});
   hoRuns.list();
 });
 await page.waitForFunction(()=>writes.some(x=>x.k==='cloudRuns/gh'&&x.v.workflowEnded));
 assert.equal(await page.locator('.hrl-run').filter({hasText:'#17'}).locator('.hrl-status').innerText(),'Unconfirmed');
 await page.evaluate(()=>listeners.cloudRuns(sample));
 // Terminal downgrade protection is checked independently of the refresh cooldown.
 await page.evaluate(()=>listeners.enrollLive({tag:'finished',state:'run',at:Date.now(),n:2}));
 assert.equal(await page.locator('.hrl-run').filter({hasText:'#13'}).locator('.hrl-status').innerText(),'Finished');
 // Explicit refresh feedback for offline status checks; no silent failure or data loss.
 await page.evaluate(()=>{
   const actual=Date.now.bind(Date);Date.now=()=>actual()+31000;
   window.fetch=async()=>{throw Error('offline');};
   listeners.cloudRuns({offline:{kind:'neorcha',state:'run',no:18,started:Date.now()-3600000,at:Date.now()-3600000,url:'https://github.com/ahmed0088/Depature-Tool/actions/runs/123'}});
 });
 await page.locator('[data-refresh]').tap();
 await page.waitForFunction(()=>document.querySelector('[data-history-feedback]').textContent.includes('could not be verified'));
 assert.equal(await page.locator('.hrl-run.unconfirmed').count(),1,'offline checks preserve the saved record');
 await page.locator('[data-refresh]').tap();assert((await page.locator('[data-history-feedback]').innerText()).includes('Checked just now'));
 await page.setViewportSize({width:844,height:390});
 assert(await page.locator('[data-history-results]').evaluate(el=>{const r=el.getBoundingClientRect();return r.height>=79&&r.bottom<=innerHeight;}),'landscape phone keeps results visible');
 await page.keyboard.press('Escape');
 assert.equal(await page.evaluate(()=>document.body.style.overflow),'','closing restores page scrolling');
 // Reopening through the original trigger restores keyboard focus on close.
 await page.evaluate(()=>{document.querySelector('#opener').focus();hoRuns.list();});
 await page.locator('[data-hrl-x]').last().tap();
 assert.equal(await page.locator('#opener').evaluate(el=>document.activeElement===el),true);
 assert.equal(await page.locator('#hoRunList').evaluate(el=>el.classList.contains('on')),false);
 console.log('Run history mobile browser checks passed: filters, stale records, focus stability, terminal protection, live-only controls and close.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

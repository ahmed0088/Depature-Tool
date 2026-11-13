'use strict';
// Task separation uses synthetic records only. No Firebase, GitHub or IN-Gauge calls.
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');

async function fixture(browser,phone,{linked=true}={}){
 const page=await browser.newPage({viewport:phone?{width:390,height:844}:{width:1280,height:900},isMobile:phone,hasTouch:phone});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());
 await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:14px system-ui;margin:12px;background:#080b10;--card:#11161f;--bg:#0b0e14;--bg2:#161c27;--text:#edf1f7;--text2:#a4adbc;--border:#343c4b;--accent:#eab94a;--accent-bg:#302a18;color:var(--text)}.btn{padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--text)}[hidden]{display:none!important}</style><b id="hotelName">Example Hotel</b><nav id="pkgTabs"><button data-v="audit">Audit</button><button data-v="rules">Rules</button></nav><main><div id="pkgMainView"></div></main>');
 await page.addStyleTag({content:fs.readFileSync('ingauge-workspace.css','utf8')});
 for(const name of ['ingauge-audit-core.js','monthly-tally.js'])await page.addScriptTag({content:fs.readFileSync(name,'utf8')});
 await page.evaluate(()=>{
  window.HOTEL_ID='example';window.currentProfile={role:'owner'};window._ref=null;window.showPanel=()=>{};window.showToast=()=>{};window.requests=[];
  window.fetch=async(...args)=>{requests.push(args);throw Error('No external requests allowed in the simple-interface test');};
  window.ManualUpsells={date:v=>v,state:{busy:false,error:'',data:{journal:{rows:[{TRX_NO:'1',TRX_CODE:'1062',BUSINESS_DATE:'2026-11-01',CASHIER_DEBIT:'100',CASHIER_CREDIT:'0',CURRENCY1:'AED'}]},reservations:{rows:[]}},result:{rows:[]}},useLiveSnapshot(){},run:async()=>{}};
 });
 await page.addScriptTag({content:fs.readFileSync('ingauge-workspace.js','utf8')});
 await page.evaluate(linked=>{
  const C=InGaugeAuditCore,S=InGaugeWorkspace.state,binding=C.binding({portalUrl:'https://app.fpg-ingauge.com/',tenantId:'1',propertyId:'2',departmentId:'3',property:'Example Hotel',department:'Front Desk'});
  if(linked){
   const record=C.record({id:100,confirmationNumber:'12345678',tenantLocationId:2,locationGroupId:3,locationGroupProductId:4,userId:5,pname:'Late Check Out',userName:'Jordan River',auditStatus:'APPROVED',upsellCharge:100,totalUpsellAmount:100,roomNights:1,arrivalDate:'2026-11-01',departureDate:'2026-11-03',businessDate:'2026-11-01',roomNumber:'101',memo:'Synthetic fixture',updatedOn:1});
   S.binding=binding;S.snapshot={schema:1,id:'simple-ui',hotelId:'example',binding,complete:true,pagination:{verified:true,total:1,read:1},fetchedAt:Date.now(),from:'2026-11-01',to:'2026-11-07',settings:{currency:'AED',validation:'BUSINESS_DATE',metricType:'DAILY',maxChargeCents:100000},permissions:{canAdd:true,canEdit:true,canApprove:true,canDeny:true,canDelete:true,canReassign:true},products:[{id:'4',name:'Late Check Out',code:'1062',activeStatus:'NORMAL',recurring:false}],contributors:[{id:'5',name:'Jordan River',pulseId:'JR001',activeStatus:'NORMAL'}],records:[record]};
   S.from=S.snapshot.from;S.to=S.snapshot.to;
  }
  S.scope='all';InGaugeWorkspace.open();
 },linked);
 return {page,errors};
}
(async()=>{
 const browser=await chromium.launch({executablePath:[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p)),headless:true,args:['--no-sandbox']});
 try{
  for(const phone of [false,true]){
   const {page,errors}=await fixture(browser,phone);
   try{
    assert(await page.locator('[data-ig-monthly]').isVisible(),'Monthly totals is a clear first task');
    assert.equal(await page.locator('[data-ig-monthly]').getAttribute('aria-pressed'),'true');
    assert(await page.locator('#igMonthlyTally').isVisible(),'monthly comparison is the default screen');
    assert(await page.locator('#igStepReports').isHidden());assert(await page.locator('#igStepReview').isHidden());assert(await page.locator('#igStepRun').isHidden());
    assert.equal(await page.locator('#igSetupDetails').evaluate(el=>el.open),false,'linked hotel setup stays tucked away');
    assert(await page.locator('.mt-confirm').evaluate(label=>{const box=label.querySelector('input').getBoundingClientRect(),text=label.querySelector('span').getBoundingClientRect();return text.left>=box.right&&Math.abs(text.top-box.top)<6;}),'report confirmation stays beside its checkbox');
    assert(await page.locator('.mt-upload').evaluate(el=>el.getBoundingClientRect().right<=document.querySelector('#igMonthlyTally').getBoundingClientRect().right),'upload control stays inside the card');
    if(process.env.SIMPLE_UI_SCREENSHOT_DIR){fs.mkdirSync(process.env.SIMPLE_UI_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:process.env.SIMPLE_UI_SCREENSHOT_DIR+(phone?'/monthly-start-phone.png':'/monthly-start-desktop.png'),fullPage:true});}


    await page.locator('[data-ig-task=audit]').click();
    assert(await page.locator('#igMonthlyTally').isHidden(),'the chart must not crowd report review');
    assert(await page.locator('#igStepReports').isVisible());assert(await page.locator('#igReportFiles').isVisible());assert(await page.locator('#igQuickFind').isHidden());
    assert(await page.locator('[data-ig-check]').isVisible());assert(await page.locator('#igStepRun').isHidden(),'zero selections do not show an empty Apply stage');
    assert.equal(await page.evaluate(()=>requests.length),0,'switching tasks cannot start a job');

    await page.locator('[data-ig-task=edit]').click();
    assert(await page.locator('#igMonthlyTally').isHidden());assert(await page.locator('#igQuickFind').isVisible());assert(await page.locator('#igReportFiles').isHidden());
    assert(await page.locator('#igStepReview').isVisible());assert(await page.locator('#igStepRun').isHidden());
    await page.locator('#igSearch').fill('12345678');
    await page.waitForFunction(()=>InGaugeWorkspace.state.query==='12345678'&&document.querySelector('#igProposalRows')?.getAttribute('aria-busy')!=='true');
    await page.locator('[data-ig-record="100"][data-ig-action=edit]').click();await page.locator('#igEditUnit').fill('125.00');await page.locator('[data-ig-save]').click();
    assert(await page.locator('#igEditor').isHidden());assert.equal(await page.evaluate(()=>InGaugeWorkspace.state.view),'records');
    assert.equal(await page.locator('#igSearch').inputValue(),'12345678','Save retains search instead of moving to another task');
    assert.equal(await page.evaluate(()=>InGaugeWorkspace.state.selected.size),1);assert.equal(await page.evaluate(()=>InGaugeWorkspace.state.drafts.get('r-100').values.unitCents),12500);
    assert(await page.locator('#igStepRun').isVisible(),'Apply becomes available once the user has saved a selection');
    assert(await page.locator('[data-ig-apply]').isDisabled(),'the existing explicit review gate remains enforced');
    await page.locator('#igReviewed').check();assert(await page.locator('[data-ig-apply]').isEnabled());

    await page.locator('[data-ig-monthly]').click();assert(await page.locator('#igMonthlyTally').isVisible());assert(await page.locator('#igStepReview').isHidden());assert(await page.locator('#igStepRun').isHidden());
    assert.equal(await page.evaluate(()=>InGaugeWorkspace.state.selected.size),1,'task navigation cannot discard a reviewed draft');assert(await page.locator('[data-mt-fetch]').isDisabled(),'a comparison refresh cannot silently discard saved changes');
    await page.locator('[data-ig-task=edit]').click();assert(await page.locator('#igMonthlyTally').isHidden());assert(await page.locator('#igStepRun').isVisible());
    assert.equal(await page.evaluate(()=>requests.length),0);assert.deepEqual(errors,[]);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'task controls fit the viewport without page-wide horizontal scrolling');
    if(process.env.SIMPLE_UI_SCREENSHOT_DIR){fs.mkdirSync(process.env.SIMPLE_UI_SCREENSHOT_DIR,{recursive:true});await page.locator('[data-ig-monthly]').click();await page.screenshot({path:process.env.SIMPLE_UI_SCREENSHOT_DIR+(phone?'/simple-monthly-phone.png':'/simple-monthly-desktop.png'),fullPage:true});}
   }finally{await page.close();}
  }
  const {page,errors}=await fixture(browser,true,{linked:false});
  try{assert.equal(await page.locator('#igSetupDetails').evaluate(el=>el.open),true,'an unlinked hotel exposes its required setup');assert(await page.locator('[data-ig-discover]').isVisible());assert.equal(await page.evaluate(()=>requests.length),0);assert.deepEqual(errors,[]);}finally{await page.close();}
  console.log('Simple-interface browser checks passed on desktop and phone: monthly/report/search task separation, contextual Apply, linked setup, draft/search retention, unchanged review gate and no external calls.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});

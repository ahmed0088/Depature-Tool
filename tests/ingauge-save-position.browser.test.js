'use strict';
// Synthetic records only: no Firebase, GitHub or IN-Gauge writes are available.
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');

async function fixture(browser,phone,nested){
 const page=await browser.newPage({viewport:phone?{width:390,height:844}:{width:1280,height:900},isMobile:phone,hasTouch:phone});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());
 await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>
 html{scroll-behavior:auto}body{font:14px system-ui;margin:12px;--card:#11161f;--bg:#0b0e14;--bg2:#161c27;--text:#edf1f7;--text2:#a4adbc;--border:#343c4b;--accent:#eab94a;--accent-bg:#302a18;color:var(--text);background:var(--bg)}
 .btn{padding:10px;border:1px solid var(--border);background:var(--card);color:var(--text);border-radius:8px}[hidden]{display:none!important}
 ${nested?'#scrollShell{height:560px;overflow:auto;overscroll-behavior:contain}.before{height:250px}.after{height:1500px}':'.before{height:120px}.after{height:1200px}'}
 </style><div class="before"></div><b id="hotelName">Example Hotel</b><nav id="pkgTabs"><button data-v="audit">Audit</button><button data-v="rules">Rules</button></nav><main id="scrollShell"><div id="pkgMainView"></div></main><div class="after"></div>`);
 await page.addStyleTag({content:fs.readFileSync('ingauge-workspace.css','utf8')});
 await page.addScriptTag({content:fs.readFileSync('ingauge-audit-core.js','utf8')});
 await page.evaluate(()=>{
  window.HOTEL_ID='example';window.currentProfile={role:'owner'};window._ref=null;window.showPanel=()=>{};window.showToast=()=>{};window.requests=[];
  window.fetch=async(...args)=>{requests.push(args);throw Error('No external calls allowed in a save-position test');};
 });
 await page.addScriptTag({content:fs.readFileSync('ingauge-workspace.js','utf8')});
 await page.evaluate(()=>{
  const C=InGaugeAuditCore,S=InGaugeWorkspace.state,binding=C.binding({portalUrl:'https://app.fpg-ingauge.com/',tenantId:'1',propertyId:'2',departmentId:'3',property:'Example Hotel',department:'Front Desk'});
  const records=Array.from({length:20},(_,i)=>C.record({id:100+i,confirmationNumber:String(12345600+i),tenantLocationId:2,locationGroupId:3,locationGroupProductId:4,userId:5,pname:'Late Check Out',userName:'Jordan River',auditStatus:i%2?'APPROVED':'PENDING',upsellCharge:100,totalUpsellAmount:100,roomNights:1,arrivalDate:'2026-11-01',departureDate:'2026-11-03',businessDate:'2026-11-01',roomNumber:String(100+i),memo:'Synthetic fixture',updatedOn:1}));
  S.binding=binding;S.snapshot={schema:1,id:'save-position',hotelId:'example',binding,complete:true,pagination:{verified:true,total:records.length,read:records.length},fetchedAt:Date.now(),from:'2026-11-01',to:'2026-11-07',settings:{currency:'AED',validation:'BUSINESS_DATE',metricType:'DAILY',maxChargeCents:100000},permissions:{canAdd:true,canEdit:true,canApprove:true,canDeny:true,canDelete:true,canReassign:true},products:[{id:'4',name:'Late Check Out',code:'1062',activeStatus:'NORMAL',recurring:false}],contributors:[{id:'5',name:'Jordan River',pulseId:'JR001',activeStatus:'NORMAL'}],records};S.scope='all';
  InGaugeWorkspace.open();InGaugeWorkspace.setTask('edit');
 });
 return {page,errors};
}
async function saveAtPosition(page,{view,id,amount,expectedSelected,nested}){
 await page.locator(`[data-ig-view="${view}"]`).click();
 await page.locator('#igSearch').fill('Late');
 await page.waitForFunction(()=>InGaugeWorkspace.state.query==='Late'&&document.querySelector('#igProposalRows')?.getAttribute('aria-busy')!=='true');
 const selector=view==='proposals'?`[data-ig-edit="r-${id}"]`:`[data-ig-record="${id}"][data-ig-action="edit"]`;
 const opener=page.locator(selector);await opener.scrollIntoViewIfNeeded();
 const before=await page.evaluate(()=>({windowY:window.scrollY,shellTop:document.querySelector('#scrollShell').scrollTop,view:InGaugeWorkspace.state.view,query:InGaugeWorkspace.state.query,limit:InGaugeWorkspace.state.limit}));
 assert(before.windowY>100||before.shellTop>100,'fixture must actually be scrolled before editing');
 if(nested)assert(before.shellTop>100,'nested fixture must exercise its own scrolling container');
 await opener.click();await page.locator('#igEditUnit').fill(amount);await page.locator('[data-ig-save]').click();
 await page.waitForFunction(()=>document.querySelector('#igEditor')?.hidden);
 // Wait through a former smooth-scroll animation, so an initial unchanged frame
 // cannot conceal a delayed jump to the Apply section.
 await page.waitForTimeout(350);
 const after=await page.evaluate(id=>({windowY:window.scrollY,shellTop:document.querySelector('#scrollShell').scrollTop,view:InGaugeWorkspace.state.view,query:InGaugeWorkspace.state.query,limit:InGaugeWorkspace.state.limit,selected:InGaugeWorkspace.state.selected.size,unit:InGaugeWorkspace.state.drafts.get('r-'+id)?.values.unitCents,queryInput:document.querySelector('#igSearch').value}),id);
 assert.equal(after.view,before.view,'Save must not switch the active records/pending/proposals tab');
 assert.equal(after.query,before.query,'Save must preserve the search');assert.equal(after.queryInput,before.query);assert.equal(after.limit,before.limit);
 assert.equal(after.selected,expectedSelected,'Save still selects the reviewed draft');assert.equal(after.unit,Math.round(Number(amount)*100),'the edited amount is saved');
 assert(Math.abs(after.windowY-before.windowY)<=2,`page moved after Save: ${before.windowY} → ${after.windowY}`);
 assert(Math.abs(after.shellTop-before.shellTop)<=2,`list container moved after Save: ${before.shellTop} → ${after.shellTop}`);
}
(async()=>{
 const browser=await chromium.launch({executablePath:[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p)),headless:true,args:['--no-sandbox']});
 try{
  for(const phone of [false,true])for(const nested of [false,true]){
   const {page,errors}=await fixture(browser,phone,nested);
   try{
    await saveAtPosition(page,{view:'records',id:'105',amount:'135.45',expectedSelected:1,nested});
    await saveAtPosition(page,{view:'pending',id:'110',amount:'140.25',expectedSelected:2,nested});
    if(!nested)await saveAtPosition(page,{view:'proposals',id:'105',amount:'145.00',expectedSelected:2,nested});
    assert.equal(await page.evaluate(()=>requests.length),0);assert.deepEqual(errors,[]);
   }finally{await page.close();}
  }
  console.log('Save-position browser checks passed on desktop and phone: records, pending and proposals keep tab/search/selection and scroll; nested scrolling stays put; no financial or network calls.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});

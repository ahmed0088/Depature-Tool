'use strict';
// Entirely synthetic; tests cannot contact Firebase, GitHub or IN-Gauge.
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
(async()=>{const b=await chromium.launch({executablePath:[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p)),headless:true,args:['--no-sandbox']});try{
 const page=await b.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:14px system-ui;--card:#11161f;--bg:#0b0e14;--bg2:#161c27;--text:#edf1f7;--text2:#a4adbc;--border:#343c4b;--accent:#eab94a;--accent-bg:#302a18;color:var(--text);background:var(--bg);margin:12px}.btn{padding:10px;border:1px solid var(--border);background:var(--card);color:var(--text);border-radius:8px}[hidden]{display:none!important}</style><b id="hotelName">Example Hotel</b><nav id="pkgTabs"><button data-v="audit">Audit</button><button data-v="rules">Rules</button></nav><main><div id="pkgMainView"></div></main>');
 await page.addStyleTag({content:fs.readFileSync('ingauge-workspace.css','utf8')});
 for(const name of ['ingauge-audit-core.js','manual-upsells.js'])await page.addScriptTag({content:fs.readFileSync(name,'utf8')});
 await page.evaluate(()=>{window.HOTEL_ID='example';window.currentProfile={role:'owner'};window._ref=null;window.showPanel=()=>{};window.showToast=()=>{};window.requests=[];window.fetch=async(...args)=>{requests.push(args);throw Error('No external requests allowed');};});
 await page.addScriptTag({content:fs.readFileSync('ingauge-workspace.js','utf8')});
 await page.evaluate(()=>{
 const C=InGaugeAuditCore,S=InGaugeWorkspace.state,binding=C.binding({portalUrl:'https://app.fpg-ingauge.com/',tenantId:'1',propertyId:'2',departmentId:'3',property:'Example Hotel',department:'Front Desk'});
 S.binding=binding;S.snapshot={schema:1,id:'test',hotelId:'example',binding,complete:true,pagination:{verified:true,total:0,read:0},fetchedAt:Date.now(),from:'2026-11-01',to:'2026-11-07',settings:{currency:'AED',validation:'BUSINESS_DATE'},permissions:{canAdd:true,canEdit:true,canApprove:true,canReassign:true},products:[{id:'4',name:'Late Check Out',code:'1062',activeStatus:'NORMAL',recurring:false}],contributors:[{id:'5',name:'Jordan River',activeStatus:'NORMAL'},{id:'9',name:'Other Poster',activeStatus:'NORMAL'}],records:[]};S.scope='manual';
 window.post={TRX_NO:'1',TRX_CODE:'1062',CURRENCY1:'AED',CASHIER_DEBIT:'100',CASHIER_CREDIT:'0',BUSINESS_DATE:'01-NOV-26',REFERENCE:'Upsell ** Jordan River',ROOM:'101',GUEST_FULL_NAME:'Example Guest',CASHIER_NAME:'Other Poster',USER_NAME:'CHAIN-OPOSTER',line:2};
 window.reservation={CONFIRMATION_NO:'12345678',TRUNC_BEGIN:'01-NOV-26',TRUNC_END:'03-NOV-26',SHORT_RESV_STATUS:'CKIN',ROOM_NO:'101',FULL_NAME:'Example Guest'};
 ManualUpsells.state.result=ManualUpsells.reconcile([post],[reservation],[],{contributors:S.snapshot.contributors,coverage:{complete:true,from:'2026-11-01',to:'2026-11-07'}});
 InGaugeWorkspace.open();InGaugeWorkspace.buildProposals();
 });
 assert.equal(await page.evaluate(()=>ManualUpsells.state.result.rows[0].bucket),'review');
 assert.equal(await page.evaluate(()=>InGaugeWorkspace.state.drafts.get('t-1').contributorId),'5','note seller stays primary despite another posting cashier');
 assert.equal(await page.evaluate(()=>InGaugeWorkspace.state.drafts.get('t-1').requireAssignment),true);
 assert(await page.locator('[data-ig-select-ready]').isDisabled());assert.equal(await page.evaluate(()=>InGaugeWorkspace.state.selected.size),0,'bulk ready selection cannot bypass attribution review');
 await page.locator('[data-ig-edit="t-1"]').tap();
 assert((await page.locator('#igSellerCredit').innerText()).includes('Jordan River'));assert((await page.locator('#igSellerCredit').innerText()).includes('Other Poster'));
 await page.locator('[data-ig-save]').tap();assert((await page.locator('#igEditError').innerText()).includes('explicitly assign'));assert.equal(await page.evaluate(()=>InGaugeWorkspace.state.selected.size),0);
 await page.locator('#igAssignmentConfirmed').check();
 await page.locator('#igEditPerson + .iga-choice').tap();await page.locator('[data-ig-pick-value="9"]').tap();assert.equal(await page.locator('#igAssignmentConfirmed').isChecked(),false,'changing the selected contributor clears prior confirmation');
 await page.locator('#igAssignmentConfirmed').check();await page.locator('[data-ig-save]').tap();assert((await page.locator('#igEditError').innerText()).includes('differ from the seller'));
 await page.locator('#igEditPerson + .iga-choice').tap();await page.locator('[data-ig-pick-value="5"]').tap();await page.locator('#igAssignmentConfirmed').check();
 await page.screenshot({path:process.env.SELLER_SCREENSHOT||'/tmp/hotelops-seller-credit.png',fullPage:true});
 await page.locator('[data-ig-save]').tap();assert.equal(await page.evaluate(()=>InGaugeWorkspace.state.selected.size),1);
 assert.equal(await page.evaluate(()=>InGaugeWorkspace.state.drafts.get('t-1').assignmentContributorId),'5');
 // A bare Opera INSERT_USER must never be interpreted as an IN-Gauge contributor ID.
 await page.evaluate(()=>{ManualUpsells.state.result=ManualUpsells.reconcile([{...post,TRX_NO:'2',REFERENCE:'',CASHIER_NAME:'',USER_NAME:'',INSERT_USER:'5'}],[reservation],[],{contributors:InGaugeWorkspace.state.snapshot.contributors,coverage:{complete:true,from:'2026-11-01',to:'2026-11-07'}});InGaugeWorkspace.buildProposals();});
 assert.equal(await page.evaluate(()=>InGaugeWorkspace.state.drafts.get('t-2').contributorId),'');
 assert.equal(await page.evaluate(()=>InGaugeWorkspace.state.drafts.get('t-2').requireAssignment),true);
 // Even a clear name shared by note and posting cashier remains a suggestion until reviewed.
 await page.evaluate(()=>{ManualUpsells.state.result=ManualUpsells.reconcile([{...post,TRX_NO:'3',CASHIER_NAME:'Jordan River',USER_NAME:'JORDAN'}],[reservation],[],{contributors:InGaugeWorkspace.state.snapshot.contributors,coverage:{complete:true,from:'2026-11-01',to:'2026-11-07'}});InGaugeWorkspace.buildProposals();});
 assert.equal(await page.evaluate(()=>InGaugeWorkspace.state.drafts.get('t-3').requireAssignment),true);
 assert(await page.locator('[data-ig-select-ready]').isDisabled());assert.equal(await page.evaluate(()=>InGaugeWorkspace.state.selected.size),0);
 // Extension/memory/pinned seller decisions must survive importing into automation.
 await page.evaluate(()=>{
  const S=InGaugeWorkspace.state,C=InGaugeAuditCore;S.scope='automatic';S.snapshot.records=[C.record({id:100,confirmationNumber:'12345678',tenantLocationId:2,locationGroupId:3,locationGroupProductId:4,userId:9,pname:'Late Check Out',userName:'Other Poster',auditStatus:'APPROVED',upsellCharge:100,totalUpsellAmount:100,roomNights:1,arrivalDate:'2026-11-01',departureDate:'2026-11-03',businessDate:'2026-11-01',roomNumber:'101',memo:'Original',updatedOn:1})];
  window.pkgResults=[{recordId:'100',conf:'12345678',verdict:'credit',user:'Jordan River',originEvent:{user:'Other Poster'},reassign:true,needsEmployee:false,needsProduct:false,alreadyComplete:false,extendedFrom:'11111111',memoryNote:'The same stay retains its original package seller.'}];
  InGaugeWorkspace.buildProposals();
 });
 assert.equal(await page.evaluate(()=>InGaugeWorkspace.state.drafts.get('r-100').contributorId),'5','final audit seller outranks the extension event actor');
 assert.equal(await page.evaluate(()=>InGaugeWorkspace.state.drafts.get('r-100').operaLogin),'Jordan River','the editor actor cannot be aliased as the original seller');
 assert((await page.evaluate(()=>InGaugeWorkspace.state.drafts.get('r-100').evidence)).includes('Per-booking Opera event user: Other Poster'));
 await page.evaluate(()=>{pkgResults[0].pinSkip=true;InGaugeWorkspace.buildProposals();});
 assert.equal(await page.evaluate(()=>InGaugeWorkspace.state.drafts.size),0,'explicit Skip decisions are never imported as proposed financial changes');
 await page.evaluate(()=>{pkgResults[0].pinSkip=false;pkgResults[0].user='';InGaugeWorkspace.buildProposals();});
 assert.equal(await page.evaluate(()=>InGaugeWorkspace.state.drafts.get('r-100').contributorId),'','an explicitly unresolved final seller must not fall back to the event actor');
 await page.evaluate(()=>{pkgResults[0].user=undefined;InGaugeWorkspace.buildProposals();});
 assert.equal(await page.evaluate(()=>InGaugeWorkspace.state.drafts.get('r-100').contributorId),'','an owned unresolved user field must not become the event actor');
 assert.equal(await page.evaluate(()=>requests.length),0);assert.deepEqual(errors,[]);
 console.log('Seller-credit phone flow passed: notes first, posting evidence visible, conflicts held, checkbox bound to selected ID, reason for note override, numeric Opera ID not assigned, no network or financial requests.');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exit(1)});

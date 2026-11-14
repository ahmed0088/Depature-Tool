'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
const read=f=>fs.readFileSync(f,'utf8'),PIN='12345678|Late Check Out';
async function fixture(browser,width,seed={}){
 const page=await browser.newPage({viewport:{width,height:900},isMobile:width<769,hasTouch:width<769}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());await page.route('https://pins.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto('https://pins.test/');
 await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:12px;font:14px system-ui;color:#edf1f7;background:#090b10;--card:#11151d;--bg:#090b10;--bg2:#171c25;--text:#edf1f7;--text2:#b3bdcb;--border:#3a4555;--accent:#ff647c;--accent-bg:#28151f;--accent-border:#814053}.btn{background:var(--bg2);color:var(--text);border:1px solid var(--border);padding:10px;border-radius:6px}[hidden]{display:none!important}</style><b id="hotelName">Example Hotel</b><nav id="pkgTabs"><button data-v="audit">Audit</button></nav><main><div id="pkgMainView"></div></main>');
 await page.addStyleTag({content:read('ingauge-workspace.css')});
 await page.evaluate(seed=>{
  window.HOTEL_ID='example';window.currentProfile={role:'owner',name:'Manager'};window.currentUser={uid:'synthetic'};window._ref=null;window.showPanel=()=>{};window.showToast=(...v)=>(window.toasts||=[]).push(v);window.logActivity=(...v)=>(window.activities||=[]).push(v);window.fetch=async()=>{throw Error('External requests prohibited')};window.store=seed;window.writes=[];window.listeners={};
  window.readPath=path=>path.split('/').filter(Boolean).reduce((v,k)=>v?.[k],store)??null;
  window.writePath=(path,value)=>{const bits=path.split('/'),last=bits.pop();let out=store;for(const k of bits)out=out[k]??={};if(value===null)delete out[last];else out[last]=JSON.parse(JSON.stringify(value));for(const [prefix,list] of Object.entries(listeners))if(path===prefix||path.startsWith(prefix+'/'))for(const fn of list)fn(readPath(prefix));};
  window.fbListen=(path,fn)=>{(listeners[path]||=[]).push(fn);fn(readPath(path))};window.fbSet=async(path,value)=>writePath(path,value);window.fbUpdate=async(path,value)=>{for(const [k,v] of Object.entries(value))writePath(path+'/'+k,v)};
  window.mockRef={child(path){return {
   child:k=>mockRef.child(path+'/'+k),on(){},off(){},
   once:async()=>{if(window.holdRead)await new Promise(resolve=>window.releaseRead=resolve);return {val:()=>JSON.parse(JSON.stringify(readPath(path)))}} ,
   set:async value=>{writes.push({path,value});writePath(path,value)},
   transaction:async (update,complete,applyLocally)=>{
    window.lastApplyLocally=applyLocally;
    if(window.failTransaction)throw Error('Synthetic connection failure');
    if(window.changeBeforeTransaction){writePath(path,window.changeBeforeTransaction);window.changeBeforeTransaction=null;}
    const value=update(readPath(path));if(value===undefined)return {committed:false,snapshot:{val:()=>readPath(path)}};
    writes.push({path,value});writePath(path,value);return {committed:true,snapshot:{val:()=>value}};
   }
  }}};
 },seed);
 for(const file of ['ingauge-audit-core.js','ingauge-seller-pins.js','package-audit.js','ingauge-workspace.js'])await page.addScriptTag({content:read(file)});
 await page.evaluate(async()=>{
  window.configure=async property=>{
   const C=InGaugeAuditCore,S=InGaugeWorkspace.state,b=C.binding({portalUrl:'https://app.fpg-ingauge.com/',tenantId:'1',propertyId:String(property),departmentId:'3',property:'Example Hotel '+property,department:'Front Desk'}),legacy=C.binding({...b,propertyId:'2',property:'Example Hotel 2'});
   const ref=_ref;_ref=null;S.drafts.clear();S.selected.clear();S.editing=null;S.binding=b;S.legacyBinding=legacy;S.independent=String(property)!=='2';S.targetKey='t'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(C.stable(InGaugeSellerPins.identity(b)))))).map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,40);S.targetContext=readPath('ingauge/targets/'+S.targetKey+'/auditContext')||{};
   const r=C.record({id:100,confirmationNumber:'12345678',tenantLocationId:property,locationGroupId:3,locationGroupProductId:4,userId:5,pname:'Late Check Out',userName:'Same Seller',auditStatus:'APPROVED',upsellCharge:100,totalUpsellAmount:100,roomNights:1,arrivalDate:'2026-11-01',departureDate:'2026-11-03',businessDate:'2026-11-01',roomNumber:'101',memo:'',updatedOn:1});
   S.snapshot={schema:1,id:'pins-'+property,hotelId:'example',binding:b,complete:true,pagination:{verified:true,total:1,read:1},fetchedAt:Date.now(),from:'2026-11-01',to:'2026-11-07',settings:{currency:'AED',validation:'BUSINESS_DATE',metricType:'DAILY',industryId:1,maxChargeCents:100000},permissions:{canAdd:true,canEdit:true,canApprove:true,canDeny:true,canDelete:true,canReassign:true},products:[{id:'4',name:'Late Check Out',code:'1062',activeStatus:'NORMAL',recurring:false}],contributors:[{id:'5',name:'Same Seller',pulseId:'A5',activeStatus:'NORMAL'},{id:'6',name:'Same Seller',pulseId:'B6',activeStatus:'NORMAL'}],records:[r]};S.scope='all';pkgPins=readPath('pkgPins')||{};InGaugeWorkspace.open();InGaugeWorkspace.setTask('edit');_ref=ref||mockRef;
  };
  await configure('2');
 });
 return {page,errors};
}
async function edit(page){await page.locator('[data-ig-record="100"][data-ig-action="edit"]').click();await page.waitForFunction(()=>!document.getElementById('igEditor').hidden);}
async function person(page,id){await page.locator('#igEditPerson + .iga-choice').click();await page.locator('[data-ig-pick-value="'+id+'"]').click();}
const save=async page=>{await page.locator('[data-ig-save]').click();await page.waitForFunction(()=>document.getElementById('igEditor').hidden||!!document.getElementById('igEditError').textContent)};
(async()=>{const browser=await chromium.launch({executablePath:[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p)),headless:true,args:['--no-sandbox']});try{
 for(const width of [390,1280]){
  let {page,errors}=await fixture(browser,width);
  await edit(page);assert.equal(await page.locator('.iga-freeze-choice').evaluate(e=>getComputedStyle(e).display),'flex','phone checkbox and label remain one row');await page.locator('#igFreezeSeller').check();await page.locator('[data-ig-cancel]').first().click();assert.equal(await page.evaluate(()=>writes.length),0,'Cancel cannot save a seller rule');
  await edit(page);await person(page,'6');await page.locator('#igFreezeSeller').check();await save(page);
  assert.equal(await page.locator('#igEditor').evaluate(e=>e.hidden),true);let result=await page.evaluate(pin=>({saved:readPath('pkgPins/'+pin),draft:InGaugeWorkspace.state.drafts.get('r-100'),selected:InGaugeWorkspace.state.selected.size,writes,store}),PIN);assert.equal(await page.evaluate(()=>lastApplyLocally),false,'no speculative ownership event may update audit memory before commit');assert.equal(result.saved.contributorId,'6');assert.equal(result.saved.seller,'Same Seller');assert.equal(result.selected,1);assert.equal(result.draft.contributorId,'6');assert.equal(result.draft.sellerFreeze.key,PIN);assert(result.writes.every(w=>w.path==='pkgPins/'+PIN));assert(!result.store.packageAudit?.staff,'one sale must not create a global Opera-login alias');
  const savedStore=result.store;assert.deepEqual(errors,[]);await page.close();({page,errors}=await fixture(browser,width,savedStore));
  await edit(page);assert.equal(await page.locator('#igEditPerson').inputValue(),'6','a fresh view restores the exact contributor ID');assert.equal(await page.locator('#igFreezeSeller').isChecked(),true);assert.match(await page.locator('#igSellerFreeze').innerText(),/ID 6/);
  if(width===390)await page.screenshot({path:process.env.SELLER_PIN_SCREENSHOT||'/tmp/ingauge-seller-pin586-phone.png'});
  // A second editor cannot silently overwrite a colleague's newer fixed choice.
  await page.evaluate(pin=>{window.changeBeforeTransaction={...readPath('pkgPins/'+pin),contributorId:'5',by:'Colleague',at:'2026-11-14T11:00:00Z'}},PIN);await page.locator('#igFreezeSeller').uncheck();await save(page);assert.match(await page.locator('#igEditError').innerText(),/changed while saving/);assert.equal(await page.evaluate(pin=>readPath('pkgPins/'+pin).contributorId,PIN),'5');assert.equal(await page.evaluate(()=>InGaugeWorkspace.state.selected.size),0);
  await page.locator('[data-ig-cancel]').first().click();await edit(page);assert.equal(await page.locator('#igEditPerson').inputValue(),'5');await page.locator('#igFreezeSeller').uncheck();await save(page);assert.equal(await page.evaluate(pin=>readPath('pkgPins/'+pin),PIN),null);assert.equal(await page.evaluate(()=>InGaugeWorkspace.state.selected.size),0,'unfreezing an otherwise unchanged sale does not queue a financial edit');
  await edit(page);await page.locator('#igFreezeSeller').check();await save(page);assert.equal(await page.evaluate(pin=>readPath('pkgPins/'+pin).contributorId,PIN),'5');assert.equal(await page.evaluate(()=>InGaugeWorkspace.state.selected.size),0,'fixing the already-correct owner only saves the rule');
  // Another property in the same HotelOps space gets a separate pin map, even for the same confirmation and IDs.
  await page.evaluate(()=>configure('9'));await edit(page);assert.equal(await page.locator('#igFreezeSeller').isChecked(),false);await person(page,'6');await page.locator('#igFreezeSeller').check();await save(page);result=await page.evaluate(pin=>({host:readPath('pkgPins/'+pin),target:readPath('ingauge/targets/'+InGaugeWorkspace.state.targetKey+'/auditContext/pins/'+pin),legacy:pkgPins[pin]}),PIN);assert.equal(result.host.contributorId,'5');assert.equal(result.legacy.contributorId,'5');assert.equal(result.target.contributorId,'6');assert.equal(result.target.binding.propertyId,'9');
  await edit(page);await page.locator('#igFreezeSeller').uncheck();await page.evaluate(()=>window.failTransaction=true);await save(page);assert.match(await page.locator('#igEditError').innerText(),/connection failure/);assert.equal(await page.locator('[data-ig-save]').isEnabled(),true);assert.equal(await page.evaluate(pin=>readPath('ingauge/targets/'+InGaugeWorkspace.state.targetKey+'/auditContext/pins/'+pin).contributorId,PIN),'6');await page.evaluate(()=>window.failTransaction=false);await page.locator('[data-ig-cancel]').first().click();
  await page.evaluate(()=>{const S=InGaugeWorkspace.state;S.snapshot.records=[];S.snapshot.pagination={verified:true,total:0,read:0};S.scope='manual';S.manualResult={rows:[{transaction:'TX1',bucket:'add',conf:'12345678',candidates:[{}],matches:[],code:'1062',product:'Late Check Out',cents:10000,day:'2026-11-01',room:'101',note:'Note names another seller',seller:{name:'Same Seller',employeeId:'5',basis:'Opera note',mapped:true,explanation:'Opera note names seller ID 5'},line:1,reason:'Missing manual sale'}]};InGaugeWorkspace.buildProposals();});
  const manual=await page.evaluate(()=>InGaugeWorkspace.state.drafts.get('t-TX1'));assert.equal(manual.contributorId,'6','an explicit fixed choice outranks the note for this package only');assert.equal(manual.statusAfter,'PENDING','a fixed owner cannot auto-approve a new request');assert.equal(manual.requireAssignment,true);assert.equal(manual.assignmentReviewed,false);assert.match(manual.reason,/Previously fixed/);assert.equal(await page.evaluate(()=>InGaugeWorkspace.state.selected.size),0,'a future suggestion still needs review and selection');
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('Seller pin phone/desktop passed: actual contributor picker, exact duplicate-name IDs, cancel, per-entry persistence/reopen, conflict rejection, unfreeze, no-op rule saves, target isolation and no global aliases or financial calls.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});

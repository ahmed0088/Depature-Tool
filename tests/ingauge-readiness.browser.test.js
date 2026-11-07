'use strict';
// Complete synthetic readiness/apply jobs through the real UI. All network and database activity is mocked.
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
(async()=>{
 const executablePath=process.env.CHROME_PATH||['/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>fs.existsSync(p));
 const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
 try{
 const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url()==='https://hotelops.test/'?route.fulfill({contentType:'text/html',body:'<!doctype html><style>[hidden]{display:none!important}.iga-overlay{position:fixed;inset:0;background:white;overflow:auto;z-index:10}button,input,select{margin:6px}</style><b id="hotelName">Example Hotel</b><nav id="pkgTabs"><button data-v="audit">Audit</button><button data-v="rules">Rules</button></nav><main><div id="pkgMainView"></div></main>'}):route.abort());
 await page.goto('https://hotelops.test/');
 await page.addScriptTag({content:fs.readFileSync('ingauge-audit-core.js','utf8')});
 await page.addScriptTag({content:`
 var currentProfile={role:'owner'},HOTEL_ID='example';window.showPanel=()=>{};window.showToast=()=>{};
 const C=InGaugeAuditCore,binding=C.binding({portalUrl:'https://app.fpg-ingauge.com/',tenantId:'1',propertyId:'2',departmentId:'3',property:'Example Hotel',department:'Front Desk'});
 const record=C.record({id:100,confirmationNumber:'12345678',tenantLocationId:2,locationGroupId:3,locationGroupProductId:4,userId:5,pname:'Late Checkout',userName:'Example Seller',auditStatus:'PENDING',upsellCharge:100,totalUpsellAmount:100,roomNights:1,arrivalDate:'2026-11-04',departureDate:'2026-11-04',businessDate:'2026-11-04',roomNumber:'101',memo:'Fixture',updatedOn:1});
 const snapshot={schema:1,id:'igfixture',hotelId:'example',binding,complete:true,pagination:{verified:true,total:1,read:1,sort:'id'},fetchedAt:Date.now(),from:'2026-11-01',to:'2026-11-07',settings:{currency:'AED',metricType:'DAILY',validation:'BUSINESS_DATE',maxChargeCents:100000},permissions:{canAdd:true,canEdit:true,canApprove:true,canDeny:true,canDelete:true,canReassign:true},products:[{id:'4',name:'Late Checkout',code:'1062',activeStatus:'NORMAL',recurring:false}],contributors:[{id:'5',name:'Example Seller',pulseId:'EX001',activeStatus:'NORMAL'}],records:[record]};
 window.data={'ingauge/binding':binding,'ingauge/latestSnapshot':'igfixture','ingauge/snapshots/igfixture':snapshot,'ingauge/jobs':{}};window.reads=[];window.listeners=new Map();window.dispatches=[];
 const clone=v=>v==null?null:JSON.parse(JSON.stringify(v));
 function ref(key=''){const emit=async()=>{await Promise.all([...listeners.get(key)||[]].map(fn=>fn({val:()=>clone(data[key])})));};return {child:p=>ref(key?key+'/'+p:p),once:async()=>{reads.push(key);return {val:()=>clone(data[key])};},set:async value=>{data[key]=clone(value);await emit();},update:async value=>{data[key]={...data[key],...clone(value)};await emit();},on:(event,fn)=>{if(!listeners.has(key))listeners.set(key,new Set());listeners.get(key).add(fn);fn({val:()=>clone(data[key])});},off:(event,fn)=>listeners.get(key)?.delete(fn),orderByChild:()=>ref(key),limitToLast:()=>ref(key)};}
 var _ref=ref();window.firebase={auth:()=>({currentUser:{uid:'fixture-user'}})};localStorage.setItem('ho_gh_start_key_v1','synthetic-key');
 window.fetch=async(url,options={})=>{if(!String(url).startsWith('https://api.github.com/repos/ahmed0088/Depature-Tool/actions/workflows/ingauge-audit.yml'))throw Error('Unexpected network destination');if(options.method==='POST'){dispatches.push(JSON.parse(options.body));return {ok:true,status:204};}return {ok:true,status:200,json:async()=>({})};};
 `});
 await page.addScriptTag({content:fs.readFileSync('ingauge-workspace.js','utf8')});
 await page.click('[data-v=ingauge]');await page.waitForFunction(()=>InGaugeWorkspace.state.snapshot?.id==='igfixture');
 await page.click('[data-ig-view=pending]');await page.click('[data-ig-action=edit]');await page.fill('#igEditUnit','140.00');await page.click('[data-ig-save]');await page.check('[data-ig-select]');await page.check('#igReviewed');
 assert(await page.locator('[data-ig-apply]').isDisabled());await page.click('[data-ig-test]');await page.waitForFunction(()=>dispatches.length===1);
 const checked=await page.evaluate(async()=>{const S=InGaugeWorkspace.state,j=data['ingauge/jobs/'+S.tag];data['ingauge/tests/'+j.hash]={ready:true,at:Date.now()};await _ref.child('ingauge/jobs/'+S.tag).update({state:'done',note:'Readiness checks passed',results:[{key:JSON.parse(j.planJson).operations[0].key,state:'tested'}]});return {test:j.test,hash:j.hash,readyHash:S.readyHash,error:S.error,paths:reads.slice(),input:dispatches[0].inputs.test};});
 assert.equal(checked.test,true);assert.equal(checked.input,'1');assert.equal(checked.error,'');assert.equal(checked.readyHash,checked.hash);assert(checked.paths.includes('ingauge/tests/'+checked.hash));
 await page.click('#igRunWindow [aria-label="Close progress"]');assert(await page.locator('[data-ig-apply]').isEnabled());
 await page.click('[data-ig-apply]');await page.waitForFunction(()=>dispatches.length===2);
 const applied=await page.evaluate(async()=>{const S=InGaugeWorkspace.state,j=data['ingauge/jobs/'+S.tag],op=JSON.parse(j.planJson).operations[0];await _ref.child('ingauge/jobs/'+S.tag).update({state:'done',note:'Synthetic apply complete',results:[{key:op.key,state:'applied',recordId:'100'}]});return {test:j.test,hash:j.hash,input:dispatches[1].inputs.test,error:S.error,readyHash:S.readyHash,selected:S.selected.size,completed:S.drafts.get(op.key).completed};});
 assert.equal(applied.test,false);assert.equal(applied.input,'0');assert.equal(applied.hash,checked.hash);assert.equal(applied.error,'');assert.equal(applied.readyHash,'');assert.equal(applied.selected,0);assert.equal(applied.completed,true);assert.deepEqual(errors,[]);
 console.log('Readiness completion passed: correct job mode/hash, Apply enabled after passing checks, and synthetic apply completion cleared selection. No real financial requests.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

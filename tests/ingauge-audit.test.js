'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../ingauge-audit-core.js'),{execute}=require('../scripts/ingauge-audit-cloud.js'),{InGaugeAccount,readAllowed,readQuery}=require('../scripts/ingauge-account.js');
function snapshot(){
  const binding=C.binding({portalUrl:'https://app.fpg-ingauge.com',tenantId:'1',propertyId:'2',departmentId:'3',property:'Example Hotel',department:'Front Desk'});
  const r=C.record({id:100,confirmationNumber:'12345678',tenantLocationId:2,locationGroupId:3,locationGroupProductId:4,userId:5,pname:'Breakfast',userName:'Ada Middle Family',auditStatus:'PENDING',upsellCharge:100,totalUpsellAmount:100,roomNights:1,arrivalDate:'2026-11-01',departureDate:'2026-11-03',businessDate:'2026-11-02',roomNumber:'101',memo:'Original note',updatedOn:123});
  return {schema:1,id:'igTestSnapshot',hotelId:'example',binding,complete:true,pagination:{verified:true,total:1,read:1,sort:'id'},from:'2026-11-01',to:'2026-11-07',fetchedAt:Date.now(),settings:{industryId:1,currency:'AED',metricType:'DAILY',validation:'BUSINESS_DATE',maxChargeCents:20000},permissions:{canAdd:true,canEdit:true,canApprove:true,canDeny:true,canDelete:true,canReassign:true},products:[{id:'4',name:'Breakfast',code:'',sku:'',recurring:false,activeStatus:'NORMAL'},{id:'6',name:'Standard Room with King bed',code:'',sku:'KG',recurring:true,activeStatus:'NORMAL'},{id:'7',name:'Early Arrival',code:'1061',sku:'',recurring:false,activeStatus:'NORMAL'},{id:'8',name:'Unknown Product',code:'UNKNOWN_PRODUCT',sku:'',recurring:true,activeStatus:'NORMAL'}],contributors:[{id:'5',name:'Ada Middle Family',pulseId:'AM001',activeStatus:'NORMAL'},{id:'9',name:'Other Person',pulseId:'OP002',activeStatus:'NORMAL'}],records:[r]};
}
function edit(s,extra={}){const r=s.records[0];return {key:'r-100',action:'edit',recordId:r.id,confirmation:r.confirmation,expected:C.fingerprint(r),productId:r.productId,contributorId:r.contributorId,values:C.values(r),statusAfter:'PENDING',reason:'',...extra};}
function plan(s,operations){return {schema:2,mode:'apply',hotelId:s.hotelId,binding:s.binding,snapshotId:s.id,operations};}
test('provider URLs reject credentials, foreign hosts, plaintext and query tokens',()=>{
  assert.equal(C.portalUrl('https://app.fpg-ingauge.com'),'https://app.fpg-ingauge.com/');
  for(const s of ['https://app.fpg-ingauge.com.evil.test/','https://evil.test/','http://app.fpg-ingauge.com/','https://x:y@app.fpg-ingauge.com/','https://app.fpg-ingauge.com/?token=secret'])assert.throws(()=>C.portalUrl(s));
});
test('binding preserves numeric identity and rejects mismatched hotel or department',()=>{
  const s=snapshot();assert(C.sameBinding(s.binding,{...s.binding,linkedBy:'someone'}));assert(!C.sameBinding(s.binding,{...s.binding,propertyId:'20'}));assert(!C.sameBinding(s.binding,{...s.binding,departmentId:'30'}));assert.throws(()=>C.binding({...s.binding,propertyId:'90071992547409999'}));
});
test('unique first or middle login matches use the actual contributor ID',()=>{
  const people=snapshot().contributors;
  assert.equal(C.resolveSeller('CHAIN-AMIDDLE@CHAIN',people).person.id,'5');
  assert.equal(C.resolveSeller('AM001',people).person.id,'5');
  assert.equal(C.resolveSeller('5',people).person.id,'5');
  assert.equal(C.resolveSeller('CHAIN-OMIDDLE',people).state,'unmatched');
  assert.equal(C.resolveSeller('Other Family',people).state,'unmatched');
});
test('same display name on active and inactive accounts stays ambiguous',()=>{
  const people=[{id:'1',name:'Ada Family',activeStatus:'NORMAL'},{id:'2',name:'Ada Family',activeStatus:'DEACTIVATED'}];assert.equal(C.resolveSeller('Ada Family',people).state,'ambiguous');
});
test('repeated-letter spellings need confirmation and saved aliases are exact, scoped identities',()=>{
  const people=[{id:'5',name:'Ada Rruben Family',activeStatus:'NORMAL'},{id:'9',name:'Other Person',activeStatus:'NORMAL'}];
  assert.equal(C.resolveSeller('CHAIN-ARUBEN',people).state,'suggested');
  const aliases=[{name:'Ada Rruben Family',contributorId:'5',logins:['ARUBEN']}];assert.equal(C.resolveSeller('CHAIN-ARUBEN',people,aliases).person.id,'5');assert.notEqual(C.resolveSeller('CHAIN-XARUBEN',people,aliases).state,'matched');
});
test('product labels, transaction codes and SKUs map within one hotel and never guess among room types',()=>{
  const s=snapshot();assert.equal(C.resolveProduct({code:'1061'},s.products).product.id,'7');assert.equal(C.kind('Late Checkout'),'LC');assert.equal(C.kind('Late Check Out'),'LC');assert.equal(C.resolveProduct({code:'2090'},s.products).product.id,'4');
  const products=[...s.products,{id:'10',name:'Standard Room with Twin beds',sku:'TW',code:'',recurring:true,activeStatus:'NORMAL'}];assert.equal(C.resolveProduct({kind:'ROOM'},products).state,'ambiguous');assert.equal(C.resolveProduct({sku:'TW'},products).product.id,'10');assert.equal(C.resolveProduct({productId:'8'},products).state,'unmatched');
});
test('daily business-date totals do not multiply breakfast or room charges by nights',()=>{
  const s=snapshot(),v={unitCents:12245,chargeDays:4};assert.equal(C.amountTotal(v,s.products[0],s.settings),12245);assert.equal(C.amountTotal(v,s.products[1],s.settings),12245);assert.equal(C.amountTotal(v,s.products[1],{...s.settings,validation:'DEPARTURE_DATE'}),48980);
});
test('money accepts cents exactly and rejects malformed separators and extra decimals',()=>{
  assert.equal(C.cents('1,234.56'),123456);for(const x of ['1,23.45','122.455','AED 122.45','Infinity',''])assert.equal(C.cents(x),null);assert.equal(C.cents(122.45),12245);assert.equal(C.day('2026-02-31'),'');
});
test('plans bind the exact source snapshot and reject duplicate record or transaction selections',()=>{
  const s=snapshot(),op=edit(s);assert.equal(C.validatePlan(plan(s,[op]),s).operations.length,1);assert.throws(()=>C.validatePlan({...plan(s,[op]),hotelId:'another'},s));assert.throws(()=>C.validatePlan(plan(s,[op,op]),s));assert.throws(()=>C.validatePlan(plan(s,[op]),{...s,complete:false}));
});
test('record state and financial fields invalidate an old review, metadata shape does not',()=>{
  const s=snapshot(),r=s.records[0];assert.notEqual(C.fingerprint(r),C.fingerprint({...r,unitCents:10001}));assert.notEqual(C.fingerprint(r),C.fingerprint({...r,status:'APPROVED'}));assert.equal(C.fingerprint(r),C.fingerprint({...r,raw:{...r.raw,extraDisplayColumn:'label'}}));
});
test('locked and post-lock records cannot use ordinary edit, approval, denial or removal',()=>{
  for(const status of ['LOCKED','INVOICED_POST_LOCK','APPROVED_POST_LOCK','ADJUSTED_POST_LOCK','PURGED']){const s=snapshot();s.records[0].status=status;for(const action of ['edit','approve','deny','delete'])assert.match(C.operationError(edit(s,{action,reason:'Duplicate entry'}),s),/Locked|Only/);}
});
test('historical inactive seller is preserved; new credit to inactive or another hotel is blocked',()=>{
  const s=snapshot();s.contributors[0].activeStatus='DEACTIVATED';assert.equal(C.operationError(edit(s),s),'');assert.match(C.operationError(edit(s,{contributorId:'999'}),s),/active contributor/);s.permissions.canReassign=false;assert.match(C.operationError(edit(s,{contributorId:'9'}),s),/reassign/);
});
test('reopening a denied request and denying or removing records require an explicit reason',()=>{
  const s=snapshot();for(const action of ['deny','delete'])assert.match(C.operationError(edit(s,{action}),s),/reason/);s.records[0].status='DENIED';assert.match(C.operationError(edit(s),s),/reopened/);assert.equal(C.operationError(edit(s,{reason:'The original denial was incorrect.'}),s),'');
});
test('payload uses reviewed fields and keeps unrelated existing financial/context fields',()=>{
  const s=snapshot();s.records[0].raw.originalRate=300;s.records[0].raw.newRate=350;const op=edit(s,{productId:'6'}),p=C.payload(op,s,s.records[0]);assert.equal(p.id,100);assert.equal(p.tenantLocationId,2);assert.equal(p.locationGroupProductId,6);assert.equal(p.originalRate,300);assert.equal(p.newRate,350);assert.equal(p.memo,'Original note');assert.equal(p.auditStatus,'PENDING');assert(!('userEmail' in p));
});
test('audit actions use distinct exact flags; replacement does not delete and recreate',()=>{
  assert.equal(C.auditParams({action:'approve',recordId:'100'}).isDeny,'false');assert.equal(C.auditParams({action:'deny',recordId:'100',reason:'Duplicate'}).isDeny,'true');assert.equal(C.auditParams({action:'delete',recordId:'100',reason:'Duplicate'}).isDelete,'true');assert.throws(()=>C.auditParams({action:'edit',recordId:'100'}));
});
test('duplicates include Pending, Approved, denied and unidentified products before addition',()=>{
  const s=snapshot(),op={...edit(s),action:'add',productId:'7',values:{...C.values(s.records[0]),businessDate:'2026-11-05'}};
  for(const status of ['PENDING','APPROVED','DENIED'])assert.equal(C.duplicates(op,[{...s.records[0],productId:'7',status}],s.products).length,1);
  assert.equal(C.duplicates(op,[{...s.records[0],productId:'8',product:'Unknown Product',businessDate:'2026-11-05'}],s.products).length,1);
});
test('the current official authentication discovery endpoint is permitted',()=>assert(readAllowed('GET','https://app.fpg-ingauge.com/m-api/login-service/v1/get-auth0-universal-page','https://app.fpg-ingauge.com')));
test('browser guard blocks mutations, disguised GraphQL writes and unrelated POSTs',()=>{
  const origin='https://app.fpg-ingauge.com';assert(readAllowed('GET',origin+'/pulse/api/user/secure/getByToken',origin));assert(readQuery(JSON.stringify({query:'query{alias:findUserTenantRoleWithOpenRoutes{intId}}'})));
  for(const query of ['mutation{createUser{intId}}','query{updateSignedInTimeForIdpUser(userId:1)}','query{x:updateUser{intId}}','query{getUser{intId} deleteUser(id:1)}'])assert(!readQuery(JSON.stringify({query})));
  for(const [method,path] of [['PUT','/pulse/api/productMetric/secure'],['POST','/pulse/api/auditTrail/secure'],['GET','/pulse/api/productMetric/secure/processDenyRequest'],['GET','/pulse/api/productMetric/secure/deleteAdjustedMetric']])assert(!readAllowed(method,origin+path,origin));
});
function deps(s,options={}){const store={},calls={sent:0,tests:0},portal={sent:false,testOperation:async()=>{calls.tests++;if(options.changed)throw Error('Record changed');return {current:s.records[0]};},apply:async(op)=>{calls.sent++;portal.sent=true;if(options.uncertain){const e=Error('Outcome uncertain');e.uncertain=true;throw e;}return {recordId:'100',after:{...s.records[0],status:'APPROVED'}};}};return {portal,db:{get:async k=>store[k],put:async(k,v)=>{store[k]=v;},patch:async(k,v)=>{store[k]={...store[k],...v};}},test:false,publish:async()=>{},stop:async()=>false,store,calls};}
test('readiness sends no financial writes and creates no intent ledger',async()=>{
  const s=snapshot(),op=edit(s,{action:'approve'}),d=deps(s);d.test=true;const result=await execute(plan(s,[op]),s,d);assert.equal(result.results[0].state,'tested');assert.equal(d.calls.sent,0);assert.equal(Object.keys(d.store).length,0);
});
test('changed records are held before sending and uncertain operations stop subsequent writes and retries',async()=>{
  const s=snapshot(),p=plan(s,[edit(s,{action:'approve'})]),changed=deps(s,{changed:true});assert.equal((await execute(p,s,changed)).results[0].state,'held');assert.equal(changed.calls.sent,0);
  const d=deps(s,{uncertain:true});const result=await execute(p,s,d);assert(result.uncertain);assert.equal(d.calls.sent,1);assert.equal((await execute(p,s,d)).results[0].state,'held');assert.equal(d.calls.sent,1);
});
test('stop requests do not send a next operation',async()=>{const s=snapshot(),d=deps(s);d.stop=async()=>true;const r=await execute(plan(s,[edit(s,{action:'approve'})]),s,d);assert(r.stopped);assert.equal(d.calls.sent,0);});
test('Package Audit resolves a middle-name login and refuses duplicate contributor identities in live scope',()=>{
  const noop=()=>{},sb={InGaugeAuditCore:C,console,setTimeout:()=>0,clearTimeout:noop,setInterval:()=>0,localStorage:{getItem:()=>null,setItem:noop},document:{readyState:'loading',addEventListener:noop,getElementById:()=>null,querySelectorAll:()=>[]},addEventListener:noop};sb.window=sb;vm.createContext(sb);vm.runInContext(fs.readFileSync(require.resolve('../package-audit.js'),'utf8'),sb);
  sb.InGaugeWorkspace={state:{snapshot:snapshot()}};
  assert.equal(vm.runInContext("_pkgUserLabel('CHAIN-AMIDDLE@CHAIN')",sb),'Ada Middle Family');assert.equal(vm.runInContext("_pkgSameUser('Ada Middle Family','CHAIN-AMIDDLE@CHAIN')",sb),true);
  assert.equal(vm.runInContext("_pkgSameUser('Ada Middle Family','Other Family')",sb),false);
  sb.InGaugeWorkspace.state.snapshot.contributors.push({id:'20',name:'Ada Middle Family',activeStatus:'DEACTIVATED'});assert.equal(vm.runInContext("_pkgStaffFor('CHAIN-AMIDDLE')",sb),null);
});

test('browser authentication calls without an industry header cannot erase the verified context',async()=>{
 let handler;const context={route:async(pattern,fn)=>handler=fn},portal=new InGaugeAccount({context:()=>context},'https://app.fpg-ingauge.com');await portal.installGuard();
 const route=headers=>({request:()=>({url:()=>portal.origin+'/pulse/api/user/secure/getByToken',method:()=>'GET',postData:()=>'',headers:()=>headers}),continue:()=>{},abort:()=>{throw Error('Unexpected abort');}});
 await handler(route({authorization:'Bearer synthetic',tenantid:'14',industryid:'1'}));await handler(route({authorization:'Bearer synthetic'}));assert.equal(portal.headers.industryid,'1');assert.equal(portal.headers.tenantid,'14');
});
test('an approval readback must preserve the reviewed seller, product and amounts',()=>{
 const s=snapshot(),op=edit(s,{action:'approve'}),after={...s.records[0],status:'APPROVED'};assert(C.matches(op,after));assert(!C.matches(op,{...after,contributorId:'9'}));assert(!C.matches(op,{...after,totalCents:999}));
});
test('explicit false manual flags remain false in live records',()=>{
 const raw=snapshot().records[0].raw;assert.equal(C.record({...raw,isManuallyAddedRecord:'false'}).isManuallyAddedRecord,false);assert.equal(C.record({...raw,isManuallyAddedRecord:true}).isManuallyAddedRecord,true);
});

test('Pending approval holds unidentified products, missing sellers and inconsistent amounts',()=>{
 const s=snapshot(),op=edit(s,{action:'approve'});assert.equal(C.operationError(op,s),'');
 for(const change of [{productId:'8'},{contributorId:''},{totalCents:1}]){const current=snapshot();Object.assign(current.records[0],change);const action=edit(current,{action:'approve'});assert(C.operationError(action,current));}
});

test('hotel discovery reports its stage and counts without exposing account identities',async()=>{
 const events=[],portal=new InGaugeAccount({context:()=>({})},'https://app.fpg-ingauge.com',{progress:async(stage,note)=>events.push({stage,note})});
 portal.read=async path=>path.includes('getAccessibleTenants')?{data:[{tenantId:1}]}:path.includes('getLocationsForUser')?{status:'SUCCESS',data:[{id:2,tenantId:1,name:'Example Hotel'}]}:{status:'SUCCESS',data:[{id:3,name:'Front Desk',activeStatus:'NORMAL'}]};
 const result=await portal.discover();assert.equal(result.hotels.length,1);assert(events.some(e=>e.note.includes('hotel 1 of 1')));assert(events.every(e=>!e.note.includes('Example Hotel')));
});

test('page-size metadata cannot certify an old partial snapshot as complete',()=>{
 const s=snapshot(),p=plan(s,[edit(s)]);delete s.pagination;assert.throws(()=>C.validatePlan(p,s),/every page/);s.pagination={verified:true,total:200,read:200};assert.throws(()=>C.validatePlan(p,s),/every page/);
});
test('record search uses total records, not the page row count, and reads beyond 200',async()=>{
 const s=snapshot(),events=[],portal=new InGaugeAccount({context:()=>({})},'https://app.fpg-ingauge.com',{progress:async(stage,note)=>events.push(note)});portal.actor={id:'5'};portal.headers={industryid:'1'};
 portal.read=async(path,body)=>{if(path.includes('/isOperator/'))return {status:'SUCCESS',data:true};assert(path.includes('sortBy=id'));const n=body.first===0?200:50;return {status:'SUCCESS',data:{first:body.first,total:250,totalInList:n,data:Array.from({length:n},(_,i)=>({...s.records[0].raw,id:1000+body.first+i}))}};};
 const records=await portal.search(s.binding,'2026-11-01','2026-11-07');assert.equal(records.length,250);assert(events.includes('Read 200 of 250 IN-Gauge records'));assert(events.includes('Read 250 of 250 IN-Gauge records'));
});

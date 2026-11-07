'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ReferenceCache,TTL}=require('../scripts/ingauge-reference-cache'),{InGaugeAccount}=require('../scripts/ingauge-account'),C=require('../ingauge-audit-core');
const binding=C.binding({portalUrl:'https://app.fpg-ingauge.com/',tenantId:'1',propertyId:'2',departmentId:'3',property:'Example Hotel',department:'Front Desk'}),scope={binding,actorId:'5',industryId:'1'};
const product={id:'4',name:'Breakfast',code:'2090',sku:'',recurring:false,activeStatus:'NORMAL',departmentId:'3'},seller={id:'5',name:'Example Seller',pulseId:'EX001',activeStatus:'NORMAL'};
function harness(){const data=new Map(),store={get:async k=>data.get(k),put:async(k,v)=>{v===null?data.delete(k):data.set(k,JSON.parse(JSON.stringify(v)));}};return {data,store};}
test('reference lists persist across cloud runs, exclude extra fields and return isolated copies',async()=>{
 const {store,data}=harness();let calls=0;const load=async()=>{calls++;return [{...product,authorization:'never store',records:[{id:99}]}];};
 const a=new ReferenceCache({store});const first=await a.load(scope,'products',load);first[0].name='Local edit';
 const b=new ReferenceCache({store});assert.equal((await b.load(scope,'products',load))[0].name,'Breakfast');assert.equal(calls,1);assert.equal(b.meta.products.cached,true);assert(!JSON.stringify([...data]).includes('authorization'));assert(!JSON.stringify([...data]).includes('records'));
});
test('cache keys separate hotel, tenant, department, actor, portal and industry',async()=>{
 const {store,data}=harness(),cache=new ReferenceCache({store});let calls=0;const load=async()=>{calls++;return [seller];};
 for(const s of [scope,{...scope,actorId:'6'},{...scope,industryId:'2'},{...scope,binding:{...binding,tenantId:'9'}},{...scope,binding:{...binding,propertyId:'22',property:'Other Hotel'}},{...scope,binding:{...binding,departmentId:'33'}},{...scope,binding:{...binding,portalUrl:'https://app.fpg-ingauge.com/other/'}}])await cache.load(s,'contributors',load);
 assert.equal(calls,7);assert.equal(data.size,7);
});
test('24-hour expiry, future timestamps and manual refresh force live reads',async()=>{
 const {store,data}=harness();let now=1000,calls=0;const cache=new ReferenceCache({store,now:()=>now}),load=async()=>{calls++;return [seller];};
 await cache.load(scope,'contributors',load);now+=TTL-1;await cache.load(scope,'contributors',load);assert.equal(calls,1);now++;await cache.load(scope,'contributors',load);assert.equal(calls,2);await cache.load(scope,'contributors',load,{force:true});assert.equal(calls,3);
 const key=[...data.keys()][0],entry=data.get(key);entry.fetchedAt=now+1;await new ReferenceCache({store,now:()=>now}).load(scope,'contributors',load);assert.equal(calls,4);
});
test('expired cache and refresh errors never fall back to stale data',async()=>{
 const {store}=harness();let now=1000;const cache=new ReferenceCache({store,now:()=>now});await cache.load(scope,'products',async()=>[product]);now+=TTL;
 await assert.rejects(cache.load(scope,'products',async()=>{throw Error('Offline');}),/Offline/);await assert.rejects(cache.load(scope,'products',async()=>{throw Error('Refresh failed');},{force:true}),/Refresh failed/);
});
test('malformed, duplicated and cross-department cached entries are discarded',async()=>{
 for(const bad of [[{...product,departmentId:'99'}],[product,product],[{...product,recurring:'false'}]]){
  const {store,data}=harness(),cache=new ReferenceCache({store});let calls=0;const load=async()=>{calls++;return [product];};await cache.load(scope,'products',load);[...data.values()][0].data=bad;
  await new ReferenceCache({store}).load(scope,'products',load);assert.equal(calls,2);
 }
});
test('storage failures still permit a verified live read and empty lists round-trip through Firebase',async()=>{
 const failing=new ReferenceCache({store:{get:async()=>{throw Error('No cache');},put:async()=>{throw Error('No cache');}}});assert.equal((await failing.load(scope,'products',async()=>[product])).length,1);
 const {store,data}=harness();await new ReferenceCache({store}).load(scope,'contributors',async()=>[]);delete [...data.values()][0].data;
 assert.deepEqual(await new ReferenceCache({store}).load(scope,'contributors',async()=>{throw Error('Should use verified empty cache');}),[]);
});
test('concurrent readers share one load; explicit refresh waits then replaces an older load',async()=>{
 const {store}=harness(),cache=new ReferenceCache({store});let calls=0,release;const loader=async()=>{calls++;await new Promise(r=>release=r);return [seller];};
 const a=cache.load(scope,'contributors',loader),b=cache.load(scope,'contributors',loader);await new Promise(r=>setImmediate(r));release();await Promise.all([a,b]);assert.equal(calls,1);
 let finish;const older=cache.load(scope,'products',async()=>{await new Promise(r=>finish=r);return [product];});await new Promise(r=>setImmediate(r));const fresh=cache.load(scope,'products',async()=>[{...product,name:'New package'}],{force:true});finish();await older;await fresh;assert.equal((await cache.load(scope,'products',async()=>{throw Error('Should be cached');}))[0].name,'New package');
});
test('preflight checks only the reviewed product live and invalidates changed charge rules',async()=>{
 const {store,data}=harness(),cache=new ReferenceCache({store}),portal=new InGaugeAccount({context:()=>({})},binding.portalUrl,{referenceCache:cache});portal.actor={id:'5'};portal.headers={industryid:'1'};await cache.load(scope,'products',async()=>[product]);
 const op={action:'edit',productId:'4'},snapshot={binding,products:[product]};let reads=0;portal.read=async path=>{assert.equal(path,'/pulse/api/locationGroupProduct/secure/4');reads++;return {status:'SUCCESS',data:{id:4,name:'Breakfast',locationGroupId:3,isRecurring:false,activeStatus:'NORMAL',productCode:'2090'}};};
 await portal.verifyReviewedProduct(op,snapshot);assert.equal(reads,1);
 portal.read=async()=>({status:'SUCCESS',data:{id:4,name:'Breakfast',locationGroupId:3,isRecurring:true,activeStatus:'NORMAL'}});await assert.rejects(portal.verifyReviewedProduct(op,snapshot),/package changed/);assert.equal(data.size,0);
});
test('financial preflight forces current sellers rather than trusting a cached active seller',async()=>{
 const {store}=harness(),cache=new ReferenceCache({store}),portal=new InGaugeAccount({context:()=>({})},binding.portalUrl,{referenceCache:cache});portal.actor={id:'5'};portal.headers={industryid:'1'};await cache.load(scope,'contributors',async()=>[seller]);let reads=0;
 portal.readContributors=async()=>{reads++;return [{...seller,activeStatus:'DEACTIVATED'}];};
 const rows=await portal.contributors(binding,{refresh:true});assert.equal(reads,1);assert.equal(rows[0].activeStatus,'DEACTIVATED');
});
test('financial preflight rejects a newly inactive seller despite a cached active assignment',async()=>{
 const {store}=harness(),referenceCache=new ReferenceCache({store}),portal=new InGaugeAccount({context:()=>({})},binding.portalUrl,{referenceCache});portal.actor={id:'5'};portal.headers={industryid:'1'};await referenceCache.load(scope,'contributors',async()=>[seller]);
 const snapshot={binding,products:[product],contributors:[seller],records:[],from:'2026-11-01',to:'2026-11-07',settings:{currency:'AED',validation:'BUSINESS_DATE',maxChargeCents:100000},permissions:{canAdd:true,canApprove:true}},op={action:'add',transaction:'J1',confirmation:'12345678',productId:'4',contributorId:'5',statusAfter:'PENDING',values:{unitCents:10000,totalCents:10000,chargeDays:1,arrival:'2026-11-04',departure:'2026-11-04',businessDate:'2026-11-04',room:'101',memo:''}};
 portal.scope=async()=>({binding,settings:snapshot.settings,permissions:snapshot.permissions});portal.read=async path=>{assert(path.includes('locationGroupProduct'));return {status:'SUCCESS',data:{id:4,name:'Breakfast',locationGroupId:3,isRecurring:false,activeStatus:'NORMAL',productCode:'2090'}};};portal.readContributors=async()=>[{...seller,activeStatus:'DEACTIVATED'}];
 await assert.rejects(portal.testOperation(op,snapshot),/active contributor/);assert.equal(portal.sent,false);assert.equal(portal.preflight,undefined);
});

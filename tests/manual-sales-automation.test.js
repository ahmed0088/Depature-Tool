'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Core=require('../manual-sales-core.js');const {execute}=require('../scripts/manual-sales-cloud.js');
function source(){return {transaction:'123',conf:'12345678',code:'1061',product:'Early Check In',day:'2026-11-01',cents:12245,currency:'AED',room:'0318',guest:'Test Guest',note:'Early Check-In Upsell ** Lina',bucket:'add',seller:{mapped:true,basis:'Opera note',warning:'',name:'Lina RIVERA',employeeId:'1'},candidates:[{CONFIRMATION_NO:'12345678'}]};}
const plan=()=>Core.buildPlan([source()],['123'],{hotelId:'ibis-test',property:'Test Hotel'});
function record(extra={}){return {id:100,confirmationNumber:'12345678',pname:'Early Check In',userName:'Lina RIVERA',upsellCharge:122.45,metricDate:Date.UTC(2026,10,1),auditStatus:'PENDING',...extra};}
function deps(options={}){
 const store={},calls={search:0,fill:0,submit:0,publish:[]};
 const db={get:async p=>store[p]||null,put:async(p,v)=>{store[p]=v;},patch:async(p,v)=>{store[p]={...store[p],...v};}};
 const portal={sent:false,search:async()=>{calls.search++;return options.search?options.search(calls.search):[];},fill:async()=>{calls.fill++;if(options.fillError)throw new Error('Form requires review');},closeForm:async()=>{},submit:async()=>{calls.submit++;portal.sent=true;if(options.unclear)throw new Error('Unknown result');return {id:'100',status:'PENDING'};}};
 return {db,portal,store,calls,publish:async v=>{calls.publish.push(v.slice());},shouldStop:async()=>false,tag:'msTest123',test:false};
}
test('only uniquely matched note-credited one-off additions are eligible',()=>{
 assert.equal(Core.eligibility(source()),'');
 for(const edit of [{bucket:'review'},{conf:''},{cents:-1},{currency:'USD'},{code:'2090'},{seller:{mapped:false}},{candidates:[]}])assert.notEqual(Core.eligibility({...source(),...edit}),'');
});
test('selection is explicit and cannot include hidden review cases',()=>{
 assert.throws(()=>Core.buildPlan([source()],[],{hotelId:'h',property:'Hotel'}),/Select/);
 assert.throws(()=>Core.buildPlan([{...source(),bucket:'existing'}],['123'],{hotelId:'h',property:'Hotel'}));
 assert.equal(plan().sales.length,1);assert.equal(plan().sales[0].chargeDays,1);
});
test('duplicate events or journal transactions cannot be submitted twice in one plan',()=>{
 const p=plan();p.sales.push({...p.sales[0],transaction:'124'});assert.throws(()=>Core.validatePlan(p),/duplicate/);
});
test('review digest changes when a financial entry or seller changes',()=>{
 const p=plan(),before=Core.canonical(p);p.sales[0].cents++;assert.notEqual(Core.canonical(p),before);p.sales[0].seller='Other Seller';assert.notEqual(Core.canonical(p),before);
});
test('search requires a recognized complete response shape and record identities',()=>{
 assert.throws(()=>Core.inspectSearch({status:'SUCCESS',data:[]},'12345678'));
 assert.throws(()=>Core.inspectSearch({status:'SUCCESS',data:{data:[{}],totalInList:1}},'12345678'));
 assert.equal(Core.inspectSearch({status:'SUCCESS',data:{data:[record()],totalInList:1}},'12345678').rows.length,1);
});
test('pending, approved, denied and unknown-product existing records block another sale',()=>{
 for(const auditStatus of ['PENDING','APPROVED','DENIED','REVIEWED'])assert.equal(Core.existingFor(plan().sales[0],[record({auditStatus})]).length,1);
 assert.equal(Core.existingFor(plan().sales[0],[record({pname:'Unknown Product'})]).length,1);
});
test('outgoing write guard permits only the exact reviewed Pending body',()=>{
 const sale=plan().sales[0],mapping={location:'1',group:'2',user:'3',product:'4'},day=Date.UTC(2026,10,1);
 const body={auditStatus:'PENDING',confirmationNumber:sale.conf,tenantLocationId:'1',locationGroupId:'2',userId:'3',locationGroupProductId:'4',upsellCharge:'122.45',totalUpsellAmount:'122.45',roomNights:1,metricDate:day,departureDate:day,businessDate:day};
 assert.equal(Core.allowCreate(sale,body,mapping),true);
 for(const edit of [{auditStatus:'APPROVED'},{confirmationNumber:'999'},{userId:'9'},{tenantLocationId:'9'},{upsellCharge:'200'},{totalUpsellAmount:'244.90'},{roomNights:2},{metricDate:day+86400000}])assert.equal(Core.allowCreate(sale,{...body,...edit},mapping),false);
});
test('test run checks form and live records without submission or ledger intent',async()=>{
 const d=deps();d.test=true;const out=await execute(plan(),d);assert.equal(out.results[0].state,'tested');assert.equal(d.calls.submit,0);assert.equal(Object.keys(d.store).length,0);assert.equal(d.calls.search,2);
});
test('one successful submission is verified and recorded in the ledger',async()=>{
 const d=deps(),out=await execute(plan(),d);assert.equal(out.results[0].state,'submitted');assert.equal(d.calls.submit,1);assert.equal(d.store['manualSalesLedger/123'].state,'submitted');
});
test('an existing Pending or Approved request skips the submission entirely',async()=>{
 for(const auditStatus of ['PENDING','APPROVED']){
  const d=deps({search:()=>[record({auditStatus})]}),out=await execute(plan(),d);assert.equal(out.results[0].state,'already_exists');assert.equal(d.calls.submit,0);
 }
});
test('a denied or wrong-seller existing request remains review',async()=>{
 for(const rec of [record({auditStatus:'DENIED'}),record({userName:'Other Seller'}),record({upsellCharge:99})]){
  const d=deps({search:()=>[rec]}),out=await execute(plan(),d);assert.equal(out.results[0].state,'needs_review');assert.equal(d.calls.submit,0);
 }
});
test('a new request appearing between test and commit is never duplicated',async()=>{
 const d=deps({search:n=>n===1?[]:[record()]}),out=await execute(plan(),d);assert.equal(out.results[0].state,'needs_review');assert.equal(d.calls.submit,0);
});
test('uncertain submission is retained and blocks any subsequent automatic retry',async()=>{
 const d=deps({unclear:true}),out=await execute(plan(),d);assert.equal(out.unclear,true);assert.equal(d.store['manualSalesLedger/123'].state,'unclear');
 const retry=await execute(plan(),d);assert.equal(retry.results[0].state,'needs_review');assert.equal(d.calls.submit,1);
});
test('stopping before the next sale never starts a submission',async()=>{
 const d=deps();d.shouldStop=async()=>true;const out=await execute(plan(),d);assert.equal(out.stopped,true);assert.equal(d.calls.submit,0);
});
test('form mapping failures never become financial writes',async()=>{
 const d=deps({fillError:true}),out=await execute(plan(),d);assert.equal(out.results[0].state,'needs_review');assert.equal(d.calls.submit,0);
});
test('the browser request guard blocks unreviewed, changed, duplicate and approval writes',async()=>{
 const {InGaugePortal,ORIGIN}=require('../scripts/ingauge-portal.js');let handler;
 const page={on(){},route:async(_,fn)=>{handler=fn;}};const portal=new InGaugePortal(page);await portal.installGuard();
 const sale=plan().sales[0],day=Date.UTC(2026,10,1);portal.mapping={location:'1',group:'2',user:'3',product:'4'};
 const body={auditStatus:'PENDING',confirmationNumber:sale.conf,tenantLocationId:'1',locationGroupId:'2',userId:'3',locationGroupProductId:'4',upsellCharge:'122.45',totalUpsellAmount:'122.45',roomNights:1,metricDate:day,departureDate:day};
 async function request(path,data=body){let result;await handler({request:()=>({url:()=>ORIGIN+path,method:()=> 'POST',postDataJSON:()=>data}),continue:async()=>{result='sent';},abort:async()=>{result='blocked';}});return result;}
 assert.equal(await request('/m-api/api/productMetric/secure'),'blocked');
 portal.guard=sale;assert.equal(await request('/m-api/api/productMetric/secure',{...body,auditStatus:'APPROVED'}),'blocked');
 assert.equal(await request('/m-api/api/productMetric/secure'),'sent');
 assert.equal(await request('/m-api/api/productMetric/secure'),'blocked');
 assert.equal(await request('/m-api/api/auditTrail/secure'),'blocked');
});
test('portal errors redact configured credentials before saving a private run report',()=>{
 const {privateError}=require('../scripts/manual-sales-cloud.js'),old=process.env.INGAUGE_PASS;
 try{process.env.INGAUGE_PASS='synthetic-test-password';assert.equal(privateError(new Error('fill synthetic-test-password failed')),'fill [redacted] failed');}
 finally{if(old===undefined)delete process.env.INGAUGE_PASS;else process.env.INGAUGE_PASS=old;}
});

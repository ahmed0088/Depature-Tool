'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test'),T=require('../monthly-tally'),C=require('../ingauge-audit-core');
const binding={portalUrl:'https://app.fpg-ingauge.com/',tenantId:'1',propertyId:'2',departmentId:'3'};
const post=(id,amount,extra={})=>({TRX_NO:String(id),TRX_CODE:'1062',BUSINESS_DATE:'2026-10-05',CASHIER_DEBIT:amount,CASHIER_CREDIT:'0',CURRENCY1:'AED',...extra});
const record=(id,total,status='APPROVED',extra={})=>({id:String(id),propertyId:'2',departmentId:'3',product:'Late Check Out',totalCents:total,unitCents:1000,businessDate:'2026-10-05',status,...extra});
function run(journal,records,extra={}){return T.compare({journal,snapshot:{hotelId:'test',binding,complete:true,pagination:{verified:true,total:records.length,read:records.length},from:'2026-10-01',to:'2026-10-31',records,settings:{currency:'AED'}},month:'2026-10',binding,hotelId:'test',kind:C.kind,...extra});}
test('monthly totals use actual IN-Gauge total, separate pending and include Opera credits',()=>{const r=run([post(1,'100'),post(2,'0',{CASHIER_CREDIT:'20'})],[record(1,5000),record(2,2000,'PENDING'),record(3,8000,'DENIED')]);assert.equal(r.opera,8000);assert.equal(r.approved,5000);assert.equal(r.pending,2000);assert.equal(r.gap,3000);assert.equal(r.afterPending,1000);assert(r.snapshotReady);});
test('negative gaps and reversals are preserved',()=>{const r=run([post(1,'0',{CASHIER_CREDIT:'50'})],[record(1,1000)]);assert.equal(r.gap,-6000);});
test('unmapped codes need mapping; explicit exclusions do not invent revenue',()=>{const j=[post(1,'100',{TRX_CODE:'9999'})];const r=run(j,[]);assert.equal(r.opera,0);assert.equal(r.unmapped.length,1);assert.equal(run(j,[],{mapping:{9999:'ROOM'}}).opera,10000);assert.equal(run(j,[],{mapping:{9999:'exclude'}}).excluded,1);});
test('foreign currencies, invalid dates and unsupported statuses stay out',()=>{const r=run([post(1,'10',{CURRENCY1:'USD'}),post(2,'20',{BUSINESS_DATE:'bad'})],[record(1,2000,'UNKNOWN')]);assert.equal(r.opera,0);assert.equal(r.approved,0);assert.equal(r.warnings.length,3);});
test('month boundaries and different hotel data are guarded',()=>{assert.equal(run([post(1,'5',{BUSINESS_DATE:'2026-11-01'})],[]).opera,0);assert.throws(()=>run([],[],{hotelId:'another'}),/different hotel/);assert.throws(()=>run([],[record(1,2000,'APPROVED',{departmentId:'99'})]),/another hotel/);});
test('incomplete and invalidated snapshots are provisional',()=>{const r=run([],[]);assert(r.snapshotReady);for(const patch of [{complete:false},{invalidatedAt:1},{to:'2026-10-15'},{pagination:{verified:false,total:0,read:0}}]){const r=run([],[],{snapshot:{hotelId:'test',binding,records:[],complete:true,pagination:{verified:true,total:0,read:0},from:'2026-10-01',to:'2026-10-31',settings:{currency:'AED'},...patch}});assert(!r.snapshotReady);}});
test('duplicate IDs do not double count and conflicting values stop the comparison',()=>{const j=post(1,'10'),r=record(1,1000);assert.equal(run([j,{...j,line:20}],[r,r]).opera,1000);assert.equal(run([j,j],[r,r]).approved,1000);assert.throws(()=>run([j,{...j,CASHIER_DEBIT:'11'}],[]),/Conflicting duplicate/);assert.throws(()=>run([],[r,{...r,totalCents:2000}]),/Conflicting duplicate/);});
test('scope separates explicit package marker and pending manual requests',()=>{const j=[post(1,'10'),post(2,'20',{REFERENCE:'[NA Pkgs. 1062]'})],g=[record(1,1000,'APPROVED',{isManuallyAddedRecord:true}),record(2,2000),record(3,3000,'PENDING')];assert.equal(run(j,g,{scope:'manual'}).opera,1000);assert.equal(run(j,g,{scope:'automatic'}).opera,2000);assert.equal(run(j,g,{scope:'manual'}).pending,3000);assert.equal(run(j,g,{scope:'automatic'}).approved,2000);});
test('month to date uses explicit as-of and never calls a future month complete',()=>{const r=run([post(1,'10')],[],{asOf:'2026-10-08'});assert.equal(r.to,'2026-10-08');assert.equal(run([],[],{asOf:'2026-09-30'}).snapshotReady,false);assert.equal(T.period('2028-02').to,'2028-02-29');assert.throws(()=>T.period('2026-13'),/valid month/);});
test('missing amounts cannot silently become an IN-Gauge zero',()=>{assert.throws(()=>run([],[record(1,null)]),/valid total/);assert.throws(()=>run([post(1,'abc')],[]),/invalid amount/);});

test('IN-Gauge total includes unclassified and room products and flags unmapped scope',()=>{const r=run([],[record(1,3000,'APPROVED',{product:'Standard Room'}),record(2,2000,'APPROVED',{product:'Unknown'})]);assert.equal(r.approved,5000);assert.equal(r.products.length,2);assert(r.warnings.some(w=>w.key==='ingauge-product'));});

test('excluded denied, purged and deleted products do not demand a code mapping',()=>{
  const records=['DENIED','PURGED','DELETED'].map((status,i)=>record(i+1,null,status,{product:'Unknown product'}));
  const r=run([],records);
  assert.equal(r.excluded,3);
  assert.equal(r.approved,0);
  assert.equal(r.pending,0);
  assert.deepEqual(r.warnings,[],'excluded records must not keep a completed comparison in scope review');
});
test('unsupported statuses report a status problem without a misleading product mapping request',()=>{
  const r=run([],[record(1,1000,'UNKNOWN',{product:'Unknown product'}),record(2,2000,'DRAFT',{product:'Unknown product'})]);
  assert.equal(r.approved,0);
  assert.equal(r.pending,0);
  assert.deepEqual(r.warnings.map(w=>w.key),['status']);
  assert.equal(r.warnings[0].count,2);
});
test('catalog code resolves an unrecognized product name and retains all approved and pending totals',()=>{
  const records=[record(1,1234,'APPROVED',{product:'Hotel-specific display name',productId:'71'}),record(2,567,'PENDING',{product:'Hotel-specific display name',productId:'71'})];
  const snapshot={hotelId:'test',binding,complete:true,pagination:{verified:true,total:2,read:2},from:'2026-10-01',to:'2026-10-31',records,products:[{id:'70',code:'1061'},{id:'71',code:'1062'}],settings:{currency:'AED'}};
  const r=run([],records,{snapshot});
  assert.equal(r.approved,1234);
  assert.equal(r.pending,567);
  assert.equal(r.products.length,1);
  assert.equal(r.products[0].family,'LC');
  assert.deepEqual(r.warnings,[]);
});

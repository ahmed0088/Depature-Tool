'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');
const T=require('../monthly-tally'),C=require('../ingauge-audit-core');
const binding={portalUrl:'https://app.fpg-ingauge.com/',tenantId:'1',propertyId:'2',departmentId:'3'};
const post=(id,amount,extra={})=>({TRX_NO:String(id),TRX_CODE:'1062',BUSINESS_DATE:'2026-10-05',CASHIER_DEBIT:amount,CASHIER_CREDIT:'0',CURRENCY1:'AED',ROOM:'0102',GUEST_FULL_NAME:'EXAMPLE, ALEX, Mr.',...extra});
const record=(id,total,status='APPROVED',extra={})=>({id:String(id),confirmation:'12345',propertyId:'2',departmentId:'3',product:'Late Check Out',seller:'Example Seller',totalCents:total,businessDate:'2026-10-05',status,...extra});
const reservation=(conf='12345',extra={})=>({CONFIRMATION_NO:conf,FULL_NAME:'Alex Example',ROOM_NO:'102',TRUNC_BEGIN:'2026-10-01',TRUNC_END:'2026-10-06',SHORT_RESV_STATUS:'CKIN',...extra});
function run(journal,records,extra={}){return T.compare({journal,snapshot:{hotelId:'test',binding,complete:true,pagination:{verified:true,total:records.length,read:records.length},from:'2026-10-01',to:'2026-10-31',records,settings:{currency:'AED'}},month:'2026-10',binding,hotelId:'test',kind:C.kind,reservations:[reservation()],...extra});}
function balanced(result){for(const key of ['opera','approved','pending','gap'])assert.equal(result.evidence.reduce((n,r)=>n+r[key],0),result[key],key+' evidence must exactly sum to headline');}
test('evidence follows exactly the included money, currencies, mappings, dates and statuses',()=>{
 const journal=[post(1,'100'),post(2,'0',{CASHIER_CREDIT:'20'}),post(3,'900',{CURRENCY1:'USD'}),post(4,'800',{BUSINESS_DATE:'2026-11-01'}),post(5,'40',{TRX_CODE:'9090'}),post(6,'30',{TRX_CODE:'9999'})];
 const records=[record(1,6000),record(2,2000,'PENDING'),record(3,8000,'DENIED'),record(4,9000,'APPROVED',{businessDate:'2026-11-01'}),record(5,1000,'APPROVED',{product:'Standard Room'})];
 const r=run(journal,records,{mapping:{9090:'ROOM',9999:'exclude'}});balanced(r);assert.equal(r.opera,12000);assert.equal(r.approved,7000);assert.equal(r.pending,2000);assert.equal(r.gap,5000);assert.equal(r.excluded,2);
 assert.equal(r.evidence.find(x=>x.family==='LC').transactions.length,2);
});
test('confirmation matching requires full guest, room, active stay dates and unique confirmation',()=>{
 const matched=run([post(1,'100')],[record(1,10000)]);balanced(matched);assert.equal(matched.evidence.length,1);assert.equal(matched.evidence[0].gap,0);assert.equal(matched.evidence[0].confirmation,'12345');
 for(const extra of [{FULL_NAME:'Someone Else'},{ROOM_NO:'103'},{TRUNC_BEGIN:'2026-10-06'},{TRUNC_END:'2026-10-04'},{SHORT_RESV_STATUS:'CXL'}]){const r=run([post(1,'100')],[],{reservations:[reservation('12345',extra)]});assert.equal(r.unresolvedPostings,1);assert.equal(r.evidence[0].confirmation,'');balanced(r);}
});
test('overlapping extensions and reused rooms cannot silently select another booking',()=>{
 const r=run([post(1,'100')],[record(1,10000)],{reservations:[reservation(),reservation('45678',{TRUNC_BEGIN:'2026-10-05',TRUNC_END:'2026-10-10'})]});balanced(r);assert.equal(r.gap,0);assert.equal(r.evidence.length,2);const unknown=r.evidence.find(x=>x.unresolved);assert.deepEqual(unknown.candidates,['12345','45678']);assert.match(unknown.reason,/More than one/);
 const duplicates=run([post(1,'100')],[],{reservations:[reservation(),reservation()]});assert.equal(duplicates.unresolvedPostings,0);
});
test('explicit journal confirmation is preserved without a reservation guess',()=>{
 const r=run([post(1,'50',{CONFIRMATION_NO:'98765'})],[record(1,5000,'APPROVED',{confirmation:'98765'})],{reservations:[]});assert.equal(r.unresolvedPostings,0);assert.equal(r.evidence.length,1);balanced(r);
});
test('net zero reversal retains both source IDs and explains the remaining approved amount',()=>{
 const r=run([post(1,'100'),post(2,'0',{CASHIER_CREDIT:'100'})],[record(7,10000)]);balanced(r);assert.equal(r.gap,-10000);assert.match(r.evidence[0].reason,/debits and credits net to zero/);assert.deepEqual(r.evidence[0].transactions.map(x=>x.id),['1','2']);assert.deepEqual(r.evidence[0].records.map(x=>x.id),['7']);
});
test('pending stays separate and existing requests are shown before a sale is considered missing',()=>{
 const r=run([post(1,'100')],[record(1,10000,'PENDING')]);balanced(r);assert.equal(r.approved,0);assert.equal(r.pending,10000);assert.match(r.evidence[0].reason,/existing request is pending/i);
});
test('multiple approved records keep source identities without declaring them duplicates',()=>{
 const r=run([post(1,'100')],[record(1,6000),record(2,4000)]);balanced(r);assert.equal(r.evidence[0].approvedCount,2);assert.match(r.evidence[0].reason,/split charges/);assert.equal(r.evidence[0].gap,0);
});
test('different business dates are explained rather than moved to force a match',()=>{
 const r=run([post(1,'100')],[record(1,10000,'APPROVED',{businessDate:'2026-10-06'})]);balanced(r);assert.equal(r.gap,0);assert.equal(r.evidence.length,2);assert(r.evidence.every(x=>x.gap!==0&&/business-date allocation/.test(x.reason)));
});
test('missing Reservation Detail keeps opposing unmatched amounts and does not assert missing sales',()=>{
 const r=run([post(1,'100')],[record(1,10000)],{reservations:[]});balanced(r);assert.equal(r.gap,0);assert.equal(r.unresolvedPostings,1);assert.equal(r.evidence.length,2);assert.match(r.evidence.find(x=>x.transactions.length).reason,/No unique reservation match/);assert.match(r.evidence.find(x=>x.records.length).reason,/does not prove a duplicate/);
});
test('manual and automatic evidence use the same existing scope rules',()=>{
 const journal=[post(1,'100'),post(2,'50',{REFERENCE:'[NA Pkgs. 1062]'})],records=[record(1,10000,'APPROVED',{isManuallyAddedRecord:true}),record(2,5000)];
 for(const scope of ['all','manual','automatic']){const r=run(journal,records,{scope});balanced(r);assert.equal(r.gap,0);assert.equal(r.evidence[0].transactions.length,scope==='all'?2:1);}
});
test('observed posting range does not invent full-month coverage',()=>{
 const r=run([post(1,'100'),post(2,'50',{BUSINESS_DATE:'2026-10-07'})],[],{asOf:'2026-10-13'});assert.deepEqual(r.journalRange,{first:'2026-10-05',last:'2026-10-07',days:2});assert.equal(r.to,'2026-10-13');
});
test('CSV exports every evidence row, actual negative numbers, source details and safe text',()=>{
 const journal=Array.from({length:25},(_,i)=>post(i+1,'10',{CONFIRMATION_NO:'C'+i,GUEST_FULL_NAME:i===0?'=HYPERLINK("bad")':'Example'}));
 const r=run(journal,[record(1,40000,'APPROVED',{seller:'Example "Quoted" Seller'})]);const csv=T.differenceCsv(r);assert(csv.startsWith('\ufeff'));assert.equal(csv.split('\r\n').length,r.evidence.length+1);assert(csv.includes('"-400"'));assert(csv.includes("'=HYPERLINK("));assert(csv.includes('Example ""Quoted"" Seller'));assert(csv.includes('IN-Gauge entries'));balanced(r);
});

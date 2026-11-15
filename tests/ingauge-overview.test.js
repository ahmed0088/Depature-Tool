'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),C=require('../ingauge-audit-core'),O=require('../ingauge-overview'),{InGaugeAccount,readAllowed}=require('../scripts/ingauge-account');
const now=Date.parse('2026-11-15T08:00:00Z'),binding=C.binding({portalUrl:'https://app.fpg-ingauge.com/',tenantId:'1',propertyId:'2',departmentId:'3',property:'Example Hotel',department:'Front Desk'});
const row=(id,extra={})=>({id:String(id),propertyId:'2',departmentId:'3',contributorId:'5',seller:'Same Seller',productId:'8',product:'Breakfast',status:'APPROVED',totalCents:4082,unitCents:4082,chargeDays:30,businessDate:'2026-11-15',...extra});
function snapshot(rows=[row(1)]){return {id:'igoverview',binding,settings:{currency:'AED'},fetchedAt:now,complete:true,from:'2026-11-01',to:'2026-11-15',pagination:{verified:true,total:rows.length,read:rows.length},records:rows,contributors:[{id:'5',name:'Same Seller',activeStatus:'NORMAL'},{id:'6',name:'Same Seller',activeStatus:'NORMAL'},{id:'7',name:'No Sales',activeStatus:'NORMAL'},{id:'9',name:'Historical',activeStatus:'DEACTIVATED'}]};}
const summarize=s=>O.summarize(s,binding,'2026-11',now);
test('Dubai business calendar handles month boundaries, leap years and month-to-date',()=>{
 assert.equal(O.today(Date.parse('2026-11-14T21:00:00Z')),'2026-11-15');
 assert.deepEqual(O.period('2026-11',now),{month:'2026-11',from:'2026-11-01',to:'2026-11-15',days:30,elapsed:15,future:false});
 assert.equal(O.period('2024-02',now).days,29);assert.equal(O.period('2026-10',now).to,'2026-10-31');assert(O.period('2026-12',now).future);assert.throws(()=>O.period('2026-13',now));
});
test('team totals use recorded daily totals once and separate pending from approved',()=>{
 const r=summarize(snapshot([row(1),row(2,{contributorId:'6',status:'PENDING',totalCents:2857}),row(3,{totalCents:-82})]));
 assert.equal(r.approved,4000);assert.equal(r.pending,2857);assert.equal(r.todayCents,4000);assert.equal(r.approvedCount,2);assert.equal(r.pendingCount,1);assert(r.verified&&r.fresh);
 assert.equal(r.team.reduce((n,p)=>n+p.approved,0),r.approved);assert.equal(r.products.reduce((n,p)=>n+p.pending,0),r.pending);assert.equal(r.daily.reduce((n,p)=>n+p.approved,0),r.approved);
});
test('identical names remain distinct by contributor ID and zero-sale active staff remain visible',()=>{
 const r=summarize(snapshot([row(1),row(2,{contributorId:'6',totalCents:2000}),row(3,{contributorId:'9',totalCents:1000})]));
 assert.equal(r.team.length,4);assert.equal(r.team.find(p=>p.id==='5').approved,4082);assert.equal(r.team.find(p=>p.id==='6').approved,2000);assert.equal(r.team.find(p=>p.id==='7').approved,0);assert.equal(r.team.find(p=>p.id==='9').active,false);
});
test('historical or unassigned sellers keep their sales instead of crediting the posting user',()=>{
 const r=summarize(snapshot([row(1,{contributorId:'44',seller:'Past Seller',raw:{createdBy:{id:5}}}),row(2,{contributorId:'',seller:''})]));
 assert.equal(r.unassigned,1);assert.equal(r.team.find(p=>p.id==='44').approved,4082);assert.equal(r.team.find(p=>p.id==='5').approved,0);assert.equal(r.team.find(p=>p.id==='unassigned').approved,4082);
});
test('dates, denied/removed entries and post-lock statuses are explicit and do not inflate approved revenue',()=>{
 const r=summarize(snapshot([row(1),row(2,{businessDate:'2026-10-31'}),row(3,{businessDate:'2026-11-16'}),row(4,{status:'DENIED'}),row(5,{status:'PURGED'}),row(6,{status:'APPROVED_POST_LOCK'})]));
 assert.equal(r.approved,4082);assert.equal(r.excluded,2);assert.equal(r.otherCount,1);assert.equal(r.records.length,1);assert(r.issues.some(x=>x.includes('other statuses')));
});
test('cross-hotel reads never appear as the selected hotel’s amounts',()=>{
 const s=snapshot();assert.equal(O.summarize(s,{...binding,propertyId:'20'},'2026-11',now).available,false);
 s.records.push(row(2,{departmentId:'30'}));s.pagination={verified:true,total:2,read:2};const r=summarize(s);assert.equal(r.approved,4082);assert(!r.verified);assert(r.issues.some(x=>x.includes('another hotel')));
});
test('invalid dates, duplicate rows and unreadable totals make observed totals provisional',()=>{
 for(const bad of [row(1),row(2,{businessDate:'bad'}),row(2,{totalCents:null})]){const r=summarize(snapshot([row(1),bad]));assert.equal(r.approved,4082);assert(!r.verified);}
});
test('coverage, pagination, invalidation and freshness are separate checks',()=>{
 for(const patch of [{from:'2026-11-02'},{to:'2026-11-14'},{complete:false},{invalidatedAt:now},{pagination:{verified:true,total:200,read:200}}]){const r=summarize({...snapshot(),...patch});assert(!r.verified);assert(!r.fresh);}
 const old=summarize({...snapshot(),fetchedAt:now-7*3600000});assert(old.verified);assert(!old.fresh);
});
test('goals bind source, hotel, department, month and currency; zero and fractional cents are rejected',()=>{
 const g={schema:1,source:'HotelOps manager goal',binding,month:'2026-11',currency:'AED',cents:100000};assert(O.goal(g,binding,'2026-11','AED'));
 for(const patch of [{source:'IN-Gauge ARPD'},{binding:{...binding,departmentId:'30'}},{month:'2026-10'},{currency:'USD'},{cents:0},{cents:100.5}])assert.equal(O.goal({...g,...patch},binding,'2026-11','AED'),null);
});
test('goal progress needs a verified month; daily pace excludes elapsed days and handles finished months',()=>{
 const r=summarize(snapshot([row(1,{totalCents:40000})])),g={cents:100000},p=O.pacing(r,g);assert.equal(p.percent,40);assert.equal(p.remaining,60000);assert.equal(p.expected,50000);assert.equal(p.behind,10000);assert.equal(p.daily,4000);assert.equal(p.daysLeft,15);
 assert.equal(O.pacing({...r,verified:false},g),null);assert.equal(O.pacing(r,null),null);assert.equal(O.pacing({...r,elapsed:30},g).daily,null);assert(O.pacing(r,{cents:100}).met);
});
test('Firebase empty collections are normalized for a verified zero-sales month',()=>{
 const r=summarize({...snapshot([]),records:{},contributors:{}});assert(r.verified);assert.equal(r.approved,0);assert.equal(r.team.length,0);
});
test('a source read is chosen by hotel and month without changing the audit period or staged edits',()=>{
 const s=snapshot(),S={binding,overviewMonth:'2026-11',snapshot:s,overviewSnapshot:{...s,fetchedAt:now+1000},from:'2026-11-07',to:'2026-11-08',selected:new Set(['reviewed'])};assert.equal(O.source(S),S.overviewSnapshot);assert.equal(S.from,'2026-11-07');assert.equal(S.selected.size,1);assert.equal(O.source({...S,binding:{...binding,propertyId:'22'}}),null);
});
test('goal-read allowlist permits only the source-verified null-body location query',()=>{
 const origin='https://app.fpg-ingauge.com',url=origin+'/pulse/api/goal/secure/getRevenueGoal?isLocationGoal=true&isMultiple=false';
 assert(readAllowed('POST',url,origin,'null'));assert(!readAllowed('POST',url,origin,'{}'));assert(!readAllowed('PUT',url,origin,'null'));assert(!readAllowed('POST',url.replace('getRevenueGoal','saveGoals'),origin,'null'));assert(!readAllowed('POST',url.replace('isLocationGoal=true','isLocationGoal=false'),origin,'null'));
});
test('monthly goal read uses the exact hotel and 1-based month, never ARPD as cash or raw user data',async()=>{
 const p=Object.create(InGaugeAccount.prototype);p.headers={industryid:'1'};p.progress=async()=>{};let call;p.read=async(path,data)=>{call={path,data};return {status:'SUCCESS',data:{goalsExist:false,totalUpsellGoal:12345,secretUserObject:{private:true}}};};
 const g=await p.monthlyGoal(binding,'2026-11');assert.equal(g.status,'not-set');assert.equal(call.data,null);assert(call.path.includes('month=11'));assert(call.path.includes('tenantLocationId=2'));assert(!('cents' in g));assert(!JSON.stringify(g).includes('secretUserObject'));
 p.read=async()=>({status:'SUCCESS',data:{goalsExist:true,totalUpsellGoal:100}});assert.equal((await p.monthlyGoal(binding,'2026-11')).status,'requires-review');
 p.read=async()=>{throw Error('Network unavailable');};assert.equal((await p.monthlyGoal(binding,'2026-11')).status,'unavailable');
 p.read=async()=>{throw Object.assign(Error('Cancelled'),{cancelled:true});};await assert.rejects(p.monthlyGoal(binding,'2026-11'),/Cancelled/);
});

test('verified writes mark only affected hotel/month overview reads stale; held checks do not',async()=>{
 const {overviewPath,invalidateOverviewReads}=require('../scripts/ingauge-audit-cloud'),s=snapshot(),writes=[],db={put:async(path,value)=>writes.push({path,value})},plan={binding,operations:[{key:'edit',recordId:'1',values:{businessDate:'2026-10-31'}},{key:'held',recordId:'1',values:{businessDate:'2026-09-01'}}]};
 await invalidateOverviewReads(db,plan,s,[{key:'held',state:'held'}],now);assert.equal(writes.length,0);
 await invalidateOverviewReads(db,plan,s,[{key:'edit',state:'uncertain'},{key:'held',state:'held'}],now);assert.equal(writes.length,2);assert(writes.some(w=>w.path===overviewPath(binding,'2026-11')+'/changedAt'));assert(writes.some(w=>w.path===overviewPath(binding,'2026-10')+'/changedAt'));assert(!writes.some(w=>w.path.includes('2026-09')));assert.notEqual(overviewPath(binding,'2026-11'),overviewPath({...binding,propertyId:'22'},'2026-11'));
});

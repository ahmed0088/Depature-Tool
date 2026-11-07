'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),C=require('../ingauge-audit-core.js');
function fixture(){
 const binding=C.binding({portalUrl:'https://app.fpg-ingauge.com',tenantId:'1',propertyId:'2',departmentId:'3',property:'Example Hotel',department:'Front Desk'});
 const raw={confirmationNumber:'12345678',tenantLocationId:2,locationGroupId:3,locationGroupProductId:4,userId:5,pname:'Late Checkout',upsellCharge:100,totalUpsellAmount:100,roomNights:1,arrivalDate:'2026-11-04',departureDate:'2026-11-04',businessDate:'2026-11-04',updatedOn:1};
 const records=[C.record({...raw,id:100,auditStatus:'PENDING',isManuallyAddedRecord:false}),C.record({...raw,id:101,auditStatus:'APPROVED',isManuallyAddedRecord:false}),C.record({...raw,id:102,auditStatus:'APPROVED',isManuallyAddedRecord:true})];
 return {schema:1,id:'igfixture',hotelId:'example',binding,complete:true,pagination:{verified:true,total:3,read:3,sort:'id'},from:'2026-11-01',to:'2026-11-07',fetchedAt:Date.now(),records,products:[{id:'4',name:'Late Checkout',code:'1062',recurring:false,activeStatus:'NORMAL'}],contributors:[{id:'5',name:'Example Seller',activeStatus:'NORMAL'}],settings:{currency:'AED',metricType:'DAILY',validation:'BUSINESS_DATE',maxChargeCents:100000},permissions:{canAdd:true,canEdit:true,canApprove:true,canDeny:true,canDelete:true,canReassign:true}};
}
function op(r){return {key:'r-'+r.id,action:'edit',recordId:r.id,expected:C.fingerprint(r),confirmation:r.confirmation,productId:r.productId,contributorId:r.contributorId,statusAfter:r.status,values:C.values(r)};}
function plan(s,scope,records=s.records){return {schema:2,mode:'apply',hotelId:s.hotelId,binding:s.binding,snapshotId:s.id,scope,operations:records.map(op)};}
test('Pending and explicitly manual records stay in Manual; other imported records stay in Automatic',()=>{
 const s=fixture();assert.deepEqual(s.records.map(C.saleCategory),['manual','automatic','manual']);C.validatePlan(plan(s,'manual',[s.records[0],s.records[2]]),s);C.validatePlan(plan(s,'automatic',[s.records[1]]),s);C.validatePlan(plan(s,'all'),s);
});
test('worker plan validation rejects hidden operations outside the selected mode',()=>{
 const s=fixture();assert.throws(()=>C.validatePlan(plan(s,'manual',[s.records[1]]),s),/outside/);assert.throws(()=>C.validatePlan(plan(s,'automatic',[s.records[0]]),s),/outside/);assert.throws(()=>C.validatePlan(plan(s,'automatic',[s.records[2]]),s),/outside/);
 const add={...op(s.records[0]),key:'journal1',recordId:'',action:'add',transaction:'J1'};assert.throws(()=>C.validatePlan({...plan(s,'automatic'),operations:[add]},s),/outside/);C.validatePlan({...plan(s,'manual'),operations:[add]},s);assert.throws(()=>C.validatePlan(plan(s,'invalid'),s),/Choose/);
});
function ui(){
 const calls={manual:0,automatic:0},ctx={console,Intl,Date,Map,Set,URL,InGaugeAuditCore:C,document:{readyState:'loading',addEventListener(){},getElementById(){return null;}},pkgEvents:{12345678:[{}]},pkgPdfFiles:['new-reservation.pdf','update-reservation.pdf'],pkgUnknowns:[{}],pkgResults:[]};ctx.window=ctx;
 ctx.ManualUpsells={state:{busy:false,error:'',data:{journal:{rows:[]},reservations:{rows:[]}},result:{rows:[]}},useLiveSnapshot(){},run:async()=>{calls.manual++;}};ctx.pkgRun=async()=>{calls.automatic++;};vm.createContext(ctx);vm.runInContext(fs.readFileSync('ingauge-workspace.js','utf8'),ctx);const s=fixture();Object.assign(ctx.InGaugeWorkspace.state,{snapshot:s,binding:s.binding,from:s.from,to:s.to});return {ctx,calls,ui:ctx.InGaugeWorkspace};
}
test('each mode runs only its required audit engines even when other reports are cached',async()=>{
 for(const [mode,expected]of [['manual',{manual:1,automatic:0}],['automatic',{manual:0,automatic:1}],['all',{manual:1,automatic:1}]]){const h=ui();h.ui.setScope(mode);await h.ui.checkReports();assert.deepEqual(h.calls,expected);assert.equal(h.ui.state.analysisScope,mode);}
});
test('changing mode discards selected changes and previous readiness approval',()=>{
 const h=ui(),s=h.ui.state;s.drafts.set('old',{});s.selected.add('old');s.reviewed=true;s.readyHash='old-hash';h.ui.setScope('automatic');assert.equal(s.selected.size,0);assert.equal(s.drafts.size,0);assert.equal(s.readyHash,'');assert.equal(s.reviewed,false);s.busy=true;assert.throws(()=>h.ui.setScope('all'),/finish/);
});
test('required reports follow the chosen mode and missing reports cannot produce an audit',async()=>{
 const h=ui();delete h.ctx.ManualUpsells.state.data.journal;await assert.rejects(h.ui.checkReports(),/Opera Journal/);h.ui.setScope('automatic');delete h.ctx.ManualUpsells.state.data.reservations;await h.ui.checkReports();assert.equal(h.calls.manual,0);assert.equal(h.calls.automatic,1);h.ui.setScope('all');await assert.rejects(h.ui.checkReports(),/Opera Journal.*Reservation Detail/);
});

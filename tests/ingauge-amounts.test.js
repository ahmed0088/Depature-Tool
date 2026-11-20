'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../ingauge-audit-core'),T=require('../monthly-tally'),O=require('../ingauge-overview'),R=require('../ingauge-reconciliation'),{execute}=require('../scripts/ingauge-audit-cloud');
const binding=C.binding({portalUrl:'https://app.fpg-ingauge.com/',tenantId:'1',propertyId:'2',departmentId:'3',property:'Example Hotel',department:'Front Desk'}),period={from:'2026-11-01',to:'2026-11-16'};
const rec=(extra={})=>C.record({id:100,confirmationNumber:'12345678',tenantLocationId:2,locationGroupId:3,locationGroupProductId:4,userId:5,pname:'Breakfast',userName:'Example Seller',auditStatus:'APPROVED',upsellCharge:36.865,totalUpsellAmount:36.865,commissionableRevenue:36.87,roomNights:20,arrivalDate:'2026-10-20',departureDate:'2026-11-19',businessDate:'2026-11-05',roomNumber:'101',memo:'Original note',updatedOn:1,...extra});
const snap=(records=[rec()])=>({schema:1,id:'igamounts123',hotelId:'example',binding,complete:true,from:period.from,to:period.to,fetchedAt:Date.now(),pagination:{verified:true,total:records.length,read:records.length},settings:{industryId:1,currency:'AED',validation:'BUSINESS_DATE',metricType:'DAILY',maxChargeCents:100000},permissions:{canAdd:true,canEdit:true,canApprove:true,canDeny:true,canDelete:true,canReassign:true},products:[{id:'4',name:'Breakfast',code:'2090',recurring:true,activeStatus:'NORMAL'}],contributors:[{id:'5',name:'Example Seller',activeStatus:'NORMAL'}],records});
const post=(extra={})=>({TRX_NO:'901',TRX_CODE:'2090',BUSINESS_DATE:'2026-11-05',CASHIER_DEBIT:'36.87',CASHIER_CREDIT:'0',CURRENCY1:'AED',CONFIRMATION_NO:'12345678',ROOM:'0101',GUEST_FULL_NAME:'EXAMPLE, GUEST',REFERENCE:'[NA Pkgs.BB]',...extra});
const reservations=[{CONFIRMATION_NO:'12345678',FULL_NAME:'Guest Example',ROOM_NO:'101',TRUNC_BEGIN:'20-OCT-26',TRUNC_END:'19-NOV-26',SHORT_RESV_STATUS:'CKIN'}];
const compare=(s,extra={})=>T.compare({snapshot:s,binding,hotelId:s.hotelId,journal:[],month:'2026-11',asOf:period.to,kind:C.kind,...extra});
test('reporting rounds provider decimals with HALF_UP while financial input remains exact',()=>{
 for(const [value,want] of [[36.865,3687],['36.865',3687],['1,234.565',123457],[2.675,268],['-36.865',-3687],['0.005',1],['-0.005',-1],['36.864999',3686],['36.8700000001',3687]])assert.equal(C.reportingCents(value),want,String(value));
 assert.equal(C.cents(36.865),null);assert.equal(C.cents('36.865'),null);assert.equal(C.cents('36.87'),3687);
});
test('missing, malformed and unsafe source values cannot become a reported zero',()=>{
 for(const value of [null,undefined,false,{},NaN,Infinity,'',' ','AED 36.865','1,23.45','1e3','36.8abc','90071992547409.915'])assert.equal(C.reportingCents(value),null,String(value));
 assert.equal(C.reportingCents(0),0);assert.equal(C.reportingCents('0.00'),0);
});
test('a source-bound reporting view preserves the original fractional fee and fingerprint',()=>{
 const r=rec(),before=C.stable(r),fingerprint=C.fingerprint(r),shown=C.reportingRecord(r);assert.equal(r.totalCents,null);assert.equal(shown.totalCents,3687);assert.equal(shown.unitCents,3687);assert.equal(shown.reportingOnly,true);assert.equal(shown.amountRounding.totalCents.source,'36.865');assert.equal(C.stable(r),before);assert.equal(C.fingerprint(r),fingerprint);assert.equal(r.raw.totalUpsellAmount,36.865);
});
test('Firebase-omitted null fields recover for reporting without rewriting a cached snapshot',()=>{
 const r=rec();delete r.totalCents;delete r.unitCents;const before=C.stable(r),shown=C.reportingRecord(r);assert.equal(shown.totalCents,3687);assert.equal(C.stable(r),before);assert.equal(r.totalCents,undefined);
});
test('report recovery requires the same hotel, record, booking, seller, product, status and date',()=>{
 const changes={id:101,confirmationNumber:'87654321',tenantLocationId:22,locationGroupId:33,locationGroupProductId:44,userId:55,auditStatus:'PENDING',businessDate:'2026-11-06',updatedOn:2};
 for(const [key,value] of Object.entries(changes)){const r=rec();r.raw={...r.raw,[key]:value};assert.equal(C.reportingRecord(r).totalCents,null,key);}
 const r=rec();r.unitCents=10000;assert.equal(C.reportingRecord(r).totalCents,null,'a changed normalized fee cannot be mixed with old raw data');
});
test('an absent total is never inferred from daily charge, nights or commissionable revenue',()=>{
 const r=rec({totalUpsellAmount:null}),shown=C.reportingRecord(r);assert.equal(shown.totalCents,null);assert.equal(shown.unitCents,3687);assert.throws(()=>compare(snap([r])),/#100.*12345678.*no valid total amount/);
 const pending=rec({auditStatus:'PENDING',totalUpsellAmount:null}),result=R.analyse({snapshot:snap([pending]),period,journal:[post()],reservations});assert.equal(result.ready,false);assert.equal(result.cases.length,0);assert.match(result.reason,/#100/);
});
test('month, team, daily and product totals use the same rounded fee and keep Pending separate',()=>{
 const rows=[rec(),rec({id:101,auditStatus:'REVIEWED',upsellCharge:10,totalUpsellAmount:10}),rec({id:102,auditStatus:'PENDING',upsellCharge:5,totalUpsellAmount:5})],s={...snap(rows),fetchedAt:Date.parse('2026-11-16T08:00:00Z')},before=C.stable(s),r=compare(s),o=O.summarize(s,binding,'2026-11',Date.parse('2026-11-16T08:00:00Z'));
 assert.equal(r.approved,4687);assert.equal(r.pending,500);assert.equal(r.amountRounding.length,1);assert.equal(r.amountRounding[0].source,'36.865');assert.equal(o.approved,4687);assert.equal(o.pending,500);assert(o.verified);assert.equal(o.team[0].approved,4687);assert.equal(o.daily.reduce((n,x)=>n+x.approved,0),4687);assert.equal(o.products[0].approved,4687);assert.equal(C.stable(s),before);
});
test('existing valid cents and a genuine zero retain their prior reporting semantics',()=>{
 const r=rec({upsellCharge:0,totalUpsellAmount:0});assert.equal(C.reportingRecord(r),r);const s=snap([r]),rpt=compare(s);assert.equal(rpt.approved,0);assert.equal(rpt.amountRounding.length,0);
});
test('matching report amounts do not create corrections or reapprove settled sales',()=>{
 for(const status of ['APPROVED','REVIEWED']){const s=snap([rec({auditStatus:status})]),r=R.analyse({snapshot:s,period,journal:[post()],reservations});assert(r.ready);assert.deepEqual(r.cases,[]);}
});
test('a different bill amount or Pending source stays held until its exact fee is reviewed',()=>{
 for(const status of ['APPROVED','PENDING']){const s=snap([rec({auditStatus:status})]),r=R.analyse({snapshot:s,period,journal:[post({CASHIER_DEBIT:'40'})],reservations}),item=r.cases[0];assert(item);assert.equal(item.canReview,false);assert.equal(item.approvedCents,status==='APPROVED'?3687:0);assert.equal(item.pendingCents,status==='PENDING'?3687:0);assert.throws(()=>R.proposal(item,s,period),/original charge/);}
});
test('a reporting view cannot reach a financial write or change the source amount',async()=>{
 const original=rec({auditStatus:'PENDING'}),shown=C.reportingRecord(original),s=snap([shown]),op={key:'r-100',action:'approve',recordId:shown.id,confirmation:shown.confirmation,expected:C.fingerprint(shown),productId:shown.productId,contributorId:shown.contributorId,values:C.values(shown),statusAfter:'APPROVED',reason:''},plan={schema:2,mode:'apply',hotelId:s.hotelId,binding,snapshotId:s.id,period,operations:[op]};let calls=0;
 assert.match(C.operationError(op,s,period),/rounded reporting view/);await assert.rejects(execute(plan,s,{portal:{testOperation:async()=>{calls++;},apply:async()=>{calls++;}},db:{put:async()=>{calls++;}},test:false,publish:async()=>{},stop:async()=>false}),/rounded reporting view/);assert.equal(calls,0);assert.equal(original.raw.totalUpsellAmount,36.865);assert.equal(original.totalCents,null);
});
test('read-only table exports format the provider amount without modifying the financial snapshot',()=>{
 const sb={console,InGaugeAuditCore:C,document:{readyState:'loading',getElementById:()=>null,addEventListener(){}},Intl,Date,Map,Set,URL,setTimeout,clearTimeout};sb.window=sb;vm.createContext(sb);vm.runInContext(fs.readFileSync('ingauge-workspace.js','utf8'),sb);const s=snap(),before=C.stable(s),rows=sb.InGaugeWorkspace.tableRows(s);assert.equal(rows[1][7],36.87);assert.equal(rows[1][8],20);assert.equal(C.stable(s),before);
});

test('financial fingerprints retain fractional source changes and normalize Firebase-omitted nulls',()=>{
 const a=rec(),b=rec({upsellCharge:36.875,totalUpsellAmount:36.875});assert.notEqual(C.fingerprint(a),C.fingerprint(b));const cached={...a};delete cached.unitCents;delete cached.totalCents;assert.equal(C.fingerprint(cached),C.fingerprint(a));
});

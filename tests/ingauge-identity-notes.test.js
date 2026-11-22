'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),T=require('../monthly-tally');
const example=()=>({kind:'identity',canReview:false,gapCents:0,journalCents:2448,approvedCents:2448,pendingCents:0,records:[{id:'1',status:'APPROVED'}]});
test('matching settled amounts with an unverified identity are informational, not a money correction',()=>{assert(T.bookingCheckOnly(example()));const r=example();r.records[0].status='REVIEWED';assert(T.bookingCheckOnly(r));});
test('pending requests, zero charges, split records and genuine correction types are never hidden as booking notes',()=>{for(const change of [r=>r.pendingCents=2448,r=>r.gapCents=1,r=>r.approvedCents=2400,r=>r.journalCents=0,r=>r.canReview=true,r=>r.records.push({id:'2',status:'APPROVED'}),r=>r.records[0].status='PENDING',r=>r.kind='duplicate',r=>r.kind='amount',r=>r.kind='reversed',r=>r.kind='held']){const r=example();change(r);assert.equal(T.bookingCheckOnly(r),false);}});

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {enrollmentProgress}=require('../scripts/accor-loop-cloud');
const source=fs.readFileSync('guest-pipeline.js','utf8'),context=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function gpAccMerge('),source.indexOf('const gpAccScope')),context);
const merge=(a,b)=>JSON.parse(JSON.stringify(context.gpAccMerge(a,b)));
const report={processed:360,total:400,submitted:20,alreadyMember:300,skipped:15,pending:5,other:0,errors:20};
const first={tag:'run-a',at:100,n:400,done:360,state:'run',report};
test('a missing portal context cannot erase confirmed worker results',()=>{
 const p=enrollmentProgress(4),rows=[{status:'success'},{status:'already_member'},{status:'bad_email'}];
 assert.deepEqual(p.read({loop:null,state:null}),{});
 const before=p.read({loop:{results:rows}});assert.equal(before.done,3);assert.deepEqual(before.tally,{enrolled:1,already:1,skipped:0,errors:1});
 assert.deepEqual(p.read({enabled:true,loop:null,state:null}),before);assert.deepEqual(p.read({loop:{results:[]}}),before);
 assert.deepEqual(p.read({state:{results:rows.slice(0,1)},loop:{results:rows}}),before);
 assert.equal(p.read({loop:{results:[...rows,{status:'skipped: no consent'}]}}).done,4);
 assert.equal(p.read(null).report.complete,true);assert.equal(p.results().length,4);
 const other=enrollmentProgress(2);assert.deepEqual(other.read(null),{},'a new run cannot inherit prior metrics');
});
test('sparse/regressed same-run reports retain coherent verified totals',()=>{
 const valid=merge(null,first);assert.deepEqual(valid.tally,{enrolled:20,already:300,skipped:20,errors:20});
 for(const patch of [{done:0,tally:null,report:null},{done:0,tally:{enrolled:0,already:0,skipped:0,errors:0}},{note:'Portal reloaded'}]){
  const recovered=merge(valid,{tag:'run-a',at:101,...patch});assert.equal(recovered.done,360);assert.deepEqual(recovered.tally,valid.tally);assert.deepEqual(recovered.report,report);
 }
 const next=merge(valid,{tag:'run-a',at:102,report:{...report,processed:361,errors:21}});assert.equal(next.done,361);assert.equal(next.tally.errors,21);
 assert.equal(merge(next,{tag:'run-a',at:99,done:1}).done,361);
 assert.equal(merge({...next,state:'done'},{tag:'run-a',at:103,state:'run'}).state,'done');
});
test('a retained history tally repairs an older worker’s reset processed field',()=>{
 const restored=merge({tag:'run-a',done:0,n:400,tally:{enrolled:20,already:300,skipped:20,errors:20}},{tag:'run-a',at:101,done:0,tally:null});assert.equal(restored.done,360);
});
test('an explicitly different run resets metrics and absent outcomes stay unknown',()=>{
 const next=merge(merge(null,first),{tag:'run-b',at:200,n:10,done:0,state:'run'});assert.equal(next.done,0);assert.equal(next.tally,undefined);assert.equal(next.report,undefined);
 const unknown=merge(null,{tag:'run-c',n:400,done:0,current:{index:361}});assert.equal(unknown.tally,undefined);assert.equal(unknown.done,0,'a guest position is not evidence of an outcome');
});

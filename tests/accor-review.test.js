'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('guest-pipeline.js','utf8');
const tracker=new Function(source.slice(source.indexOf('function gpTrackerSummary('),source.indexOf('function gpRenderTracker('))+';return gpTrackerSummary;')();
test('tracker counts cloud successes and already-member responses alongside legacy PC results',()=>{
 const records=['success','success_stuck','submitted','already_member','already-member','pending-account','bad_email','submission_uncertain','skipped: country_missing'].map(status=>({status,date:'2026-11-14'}));
 records.push({status:'success',date:'2026-10-31'});assert.deepEqual(tracker(records,'2026-11'),{submitted:3,already:2,pending:1,review:3,total:9});
});
test('country preflight keeps Namibia code and holds missing data without admitting known members',()=>{
 let selected=[];const preflight=new Function('gpEnrollRows',source.slice(source.indexOf('function gpCountryMissing('),source.indexOf('function gpParse('))+';return {gpCountryMissing,gpCloudSelection};')(()=>selected);
 selected=[{conf:'1',nat:'NA'},{conf:'2',nat:''},{conf:'3',nat:'unknown'},{conf:'4',nat:'N/A'},{conf:'5',nat:'Turkey',member:true}];
 assert.deepEqual(preflight.gpCloudSelection().rows.map(r=>r.conf),['1']);assert.deepEqual(preflight.gpCloudSelection().held.map(r=>r.conf),['2','3','4']);assert.equal(selected[1].nat,'');
});

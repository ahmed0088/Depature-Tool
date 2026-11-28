'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('../tools/hotelops-opera.console'),sb={console,URL};sb.globalThis=sb;vm.createContext(sb);vm.runInContext(fs.readFileSync(__dirname+'/../opera-bridge.js','utf8'),sb);const O=sb.hoOperaPure;
test('only an explicit, unique email or unique primary email is taken from profile communication rows',()=>{
 const head=['Primary','Type','Communication Value','','Seq'];
 assert.equal(R.communicationEmail([{head,rows:[['Y','EMAIL','ann@example.test'],['N','EMAIL','other@example.test'],['Y','PHONE','123456789']]}]),'ann@example.test');
 assert.equal(R.communicationEmail([{head,rows:[['','EMAIL','ann@example.test'],['','EMAIL','other@example.test']]}]),'');
 assert.equal(R.communicationEmail([{head,rows:[['Y','EMAIL','ann@example.test'],['Y','EMAIL','other@example.test']]}]),'');
 assert.equal(R.communicationEmail([{head,rows:[['Y','PHONE','ann@example.test'],['Y','PASSPORT','AA1234567']]}]),'');
 assert.equal(R.communicationEmail([{head,rows:[['','E-mail','ann@example.test'],['','EMAIL','ANN@example.test']]}]).toLowerCase(),'ann@example.test');
 assert.equal(R.communicationEmail([{head:['Type','Value'],rows:[['EMAIL','ann@example.test']]}]),'');
});
test('individual profile family and given names are combined without duplicating an existing full name',()=>{
 const pairs=[['Name','Example'],['First Name','Ann'],['Country','Oman']];
 assert.equal(R.pairsToRow(R.profilePairs(pairs),'dmy',true).name,'Example, Ann');
 for(const name of ['Ann Example','Example, Ann'])assert.equal(R.pairsToRow(R.profilePairs([['Name',name],['First Name','Ann'],['Country','Oman']]),'dmy',true).name,name);
 assert(R.companyProfile([['Profile Type','Company'],['Company Name','Synthetic Group']]));
 assert(!R.companyProfile([['Name','Example'],['First Name','Ann'],['Company Name','Synthetic Group']]));
});
test('room-maintenance and report-filter layouts are recognized without inventing a guest reservation',()=>{
 const head=['Select All','Reason Code','Reason','Room','Room Type','From Date','Through Date','Return Status','Remarks'];assert(R.isRoomBlockTable(head));
 assert(!R.isRoomBlockTable([...head,'Confirmation Number']));
 assert(R.isReportForm({pairs:[['Property','Example'],['Action Type','All'],['Start Date','20-Nov-2026'],['End Date','28-Nov-2026'],['User','All']]}));
 const p=O.plan({snap:{kind:'rooms',date:'2026-11-28',rows:[],tables:[]},today:'2026-11-28',board:{day:'2026-11-28',rooms:[{roomStr:'0102',conf:'700000002',name:'Ann Example',status:'due'}]},arr:[],pur:[],ih:null});assert.equal(p.n,0);
});
test('loading shells are removed from new learning and from old saved events',()=>{
 const noise=['Hello','OPERA Cloud','Oracle JET VDOM Starter Template','Initializing Application','Other screen','Loading complete'];
 for(const text of noise){assert(R.learningNoise(text));assert(O.learningNoise(text));}
 const t=Date.UTC(2026,10,28),raw=[];
 for(let i=0;i<5;i++){const base=t+i*86400000;raw.push({t:base,k:'s',s:'inhouse'},{t:base+1000,k:'s',s:'other',l:'Hello'},{t:base+2000,k:'s',s:'billing'},{t:base+3000,k:'c',l:'Settle'},{t:base+4000,k:'c',l:'Check Out'});}
 const clean=O.learnClean(raw,new Set());assert.equal(clean.length,20);
 const old=[...clean,...noise.map((l,i)=>({t:t+1500+i,k:'s',v:'other:'+l.toLowerCase(),l}))];
 const model=O.learnModel(old);assert.equal(model.events,20);assert(!JSON.stringify(model).includes('Starter Template'));assert(!JSON.stringify(model).includes('Hello'));
 assert.equal(O.learnNext(model,['s:inhouse','s:billing']),'Settle');
});

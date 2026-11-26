'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),C=require('../immig-fixer-core.js');
test('country names become exact Opera codes, unknown names stay empty',()=>{
 assert.equal(C.countryCode('Ethiopia'),'ET');assert.equal(C.countryCode('Russian Federation'),'RU');assert.equal(C.countryCode("Côte d'Ivoire"),'CI');assert.equal(C.countryCode('United Kingdom'),'GB');assert.equal(C.countryCode('Atlantis'),'');assert.equal(C.countryCode('et'),'ET');});
test('matching is by room then name; ties and wrong rooms are never guessed',()=>{
 const list=[{room:'102',name:'Ann Fakeone',nat:'Oman',doc:'AA1111111'},{room:'102',name:'Bob Fakeone',nat:'India',doc:'BB2222222'},{room:'103',name:'Cy Faketwo',nat:'Chad',doc:'CC3333333'}];
 assert.equal(C.matchInhouse({room:'0102',name:'Ann Fakeone'},list).guest.doc,'AA1111111');
 assert.equal(C.matchInhouse({room:'102',name:'Zed Fakeone'},list).guest,null,'two guests share the family name: tie');
 assert.equal(C.matchInhouse({room:'104',name:'Ann Fakeone'},list).guest,null);
 assert.equal(C.matchInhouse({room:'103',name:'Ann Fakeone'},list).guest,null,'right name, wrong room');});
test('only EMPTY fields are proposed; guesses and ID numbers need a tap',()=>{
 const rows=[{room:'102',name:'Ann Fakeone',arrival:'11/23/2026',noNat:true,noSex:true,noPass:true,guessedSex:'F'},{room:'105',name:'Dee Fakethree',arrival:'11/23/2026',noNat:false,noSex:true,noPass:false}];
 const list=[{room:'102',name:'Ann Fakeone',nat:'Oman',doc:'784199012345678'}];
 const p=C.buildPlan(rows,list,{hotel:'T'}),f=Object.fromEntries(p.items[0].fields.map(x=>[x.field,x]));
 assert.equal(f.nationality.value,'OM');assert.equal(f.nationality.needsTap,false);assert.equal(f.gender.needsTap,true);
 assert.equal(f.idType.value,'EID');assert.equal(f.idNumber.needsTap,true);assert.equal(f.idNumber.display,'••••5678');
 assert.deepEqual(p.items[1].fields.map(x=>x.field),['gender'],'row 2 only lacks gender');assert.equal(p.items[1].fields[0].value,'','nothing to suggest: blank for him to choose');});
test('the copied plan holds only approved fields and survives a round trip; tampering is refused',()=>{
 const rows=[{room:'102',name:'Ann Fakeone',arrival:'11/23/2026',noNat:true,noSex:false,noPass:true}],list=[{room:'102',name:'Ann Fakeone',nat:'Oman',doc:'AA1111111'}];
 const p=C.buildPlan(rows,list,{}),id=p.items[0].id,ok={};ok[id]={nationality:true,idType:true};
 let plan=C.decodePlan(C.encodePlan(p,ok));assert.deepEqual(plan.items[0].fields.map(x=>x.field),['nationality'],'an ID type never travels without its number');
 ok[id]={idType:true,idNumber:true};plan=C.decodePlan(C.encodePlan(p,ok));assert.deepEqual(plan.items[0].fields.map(x=>x.field),['idType','idNumber']);
 const code=C.encodePlan(p,ok);assert.throws(()=>C.decodePlan(code.replace(/.$/,'A').slice(0,-2)+'=='));assert.throws(()=>C.decodePlan('hello'));
 const bad=Buffer.from(JSON.stringify({v:1,items:[{room:'1',name:'x',fields:[{field:'save',value:'1'}]}]})).toString('base64');assert.throws(()=>C.decodePlan('HOFIX1.zz.'+bad));});
test('log rows keep ID numbers as last 4 and never carry names',()=>{
 const e=C.logEntry({room:'0102',field:'idNumber',value:'AA1111111',result:'filled',name:'Ann Fakeone'});assert.equal(e.to,'••••1111');assert.equal(e.room,'102');assert(!JSON.stringify(e).includes('Ann'));});
test('empty value rules match the Immigration Check page',()=>{assert(C.isEmptyValue('—'));assert(C.isEmptyValue(''));assert(!C.isEmptyValue('XXXXXXX69'));assert(C.isMasked('XXXXXXX69'));});

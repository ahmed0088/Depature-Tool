'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{reconcile}=require('../reconcile-core.js');
test('matches by room and name, in any word order and with titles',()=>{
  const r=reconcile([{room:'0101',name:'Mr Fake Guest'},{room:'0102',name:'Ann Fakeone'}],[{room:'101',name:'GUEST, Fake'},{room:'102',name:'Ann Fakeone'}]);
  assert.equal(r.matched,2);assert.equal(r.onlyOpera.length+r.onlyVicas.length+r.nameDiff.length,0);
});
test('reports who is in one list only and who differs in the same room',()=>{
  const r=reconcile([{room:'201',name:'Ann Fakeone'},{room:'202',name:'Bob Faketwo'},{room:'203',name:'Dee Fakefour'}],[{room:'201',name:'Ann Fakeone'},{room:'203',name:'Eve Fakefive'},{room:'204',name:'Cy Fakethree'}]);
  assert.equal(r.matched,1);assert.deepEqual(r.onlyOpera.map(x=>x.room),['202']);assert.deepEqual(r.onlyVicas.map(x=>x.room),['204']);assert.deepEqual(r.nameDiff,[{room:'203',opera:'Dee Fakefour',vicas:'Eve Fakefive'}]);
});
test('two guests in one room are paired by name, a third is flagged',()=>{
  const r=reconcile([{room:'301',name:'Ann Fakeone'},{room:'301',name:'Bob Fakeone'}],[{room:'301',name:'Bob Fakeone'},{room:'301',name:'Ann Fakeone'},{room:'301',name:'Kid Fakeone Jr'}]);
  assert.equal(r.matched,2);assert.equal(r.onlyVicas.length,1);
});
test('house and POS rooms (8000 and up) and empty rooms are left out',()=>{
  const r=reconcile([{room:'8001',name:'POS Visa'},{room:'',name:'Nobody'}],[{room:'8001',name:'POS Cash'}]);
  assert.equal(r.checked,0);assert.equal(r.matched,0);assert.equal(r.onlyOpera.length,0);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),A=require('../opera-auto-core.js');
test('Opera links: only https Opera Cloud hosts, never a login',()=>{
  const ok=A.validateOperaUrl('https://fake.oraclehospitality.eu-frankfurt-1.ocs.oraclecloud.com/FAKE/operacloud/faces/opera-cloud-index/OperaCloud?x=1#y');
  assert.equal(ok.ok,true);assert.equal(ok.url,'https://fake.oraclehospitality.eu-frankfurt-1.ocs.oraclecloud.com/FAKE/operacloud/faces/opera-cloud-index/OperaCloud');
  for(const bad of ['','not a url','http://a.oraclecloud.com/x','https://u:p@a.oraclecloud.com/x','https://evil.example/oraclecloud.com','https://a.oraclecloud.com.evil.example/x','https://a.oraclecloud.com/x?password=1'])assert.equal(A.validateOperaUrl(bad).ok,false,bad);
});
test('buttons automation may never press',()=>{
  for(const t of ['Save','Save and Close','Delete','New','Cancel','Enroll Guest','Create Guest Profile','Check In','Check Out','OK','Post','Merge'])assert.equal(A.isForbiddenControl(t),true,t);
  for(const t of ['Edit','Show Masked Information','Identification','Manage Profile','Overview'])assert.equal(A.isForbiddenControl(t),false,t);
});
test('names, empties and last 4',()=>{
  assert.equal(A.nameMatches('Mr Fake Guest','GUEST, Fake'),true);assert.equal(A.nameMatches('Fake Guest','Fake Other'),false);assert.equal(A.nameMatches('','x'),false);
  assert.equal(A.isEmptyValue('-'),true);assert.equal(A.isEmptyValue('M'),false);assert.equal(A.last4('ZZ1234567'),'••••4567');
});
test('the pasted fixer script follows the same rules',()=>{
  const src=fs.readFileSync(__dirname+'/../tools/hotelops-opera-fixer.console.js','utf8');
  const m=/const FORBIDDEN = (\/.*\/i);/.exec(src);assert(m,'fixer has a FORBIDDEN list');
  const re=eval(m[1]);
  for(const t of ['Save','Save and Close','Delete','New','Cancel','Enroll Guest','Create Guest Profile','Check In','Check Out','OK','Post','Merge','Edit','Show Masked Information','Identification'])assert.equal(re.test(t),A.isForbiddenControl(t),'rule differs for '+t);
  assert(/plan\.origin !== location\.origin/.test(src),'fixer refuses a plan made for another Opera link');
});

test('a reader-saved Opera link object keeps the same URL and credential checks',()=>{const url='https://fake.oraclecloud.com/OperaCloud';assert.equal(A.validateOperaUrl({url,src:'reader'}).url,url);assert.equal(A.validateOperaUrl({url:'https://u:p@fake.oraclecloud.com/OperaCloud'}).ok,false);assert.equal(A.validateOperaUrl({url:'https://fake.oraclecloud.com/OperaCloud?token=secret'}).ok,false);});

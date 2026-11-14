'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test'),L=require('../enrolment-links');
test('saved portal links retain all hotel-specific query and fragment data',()=>{
 for(const url of ['https://secure.guestinternet.com/portal-system/portal/?hotel=mercure&return=%2Fwelcome#enrol','https://secure.guestinternet.com/another/portal?code=a%2Bb&hotel=2','https://secure.guestinternet.com:443/portal?hotel=3','https://secure.guestinternet.com'])assert.equal(L.portalUrl(' '+url+' '),url);
});
test('wrong hosts, credentials and non-HTTPS links cannot be saved as enrolment destinations',()=>{
 for(const url of ['http://secure.guestinternet.com/portal','https://secure.guestinternet.com.evil.test/portal','https://example.test/portal','https://user:password@secure.guestinternet.com/portal','javascript:alert(1)','https://secure.guestinternet.com:8443/portal','nonsense'])assert.throws(()=>L.portalUrl(url));
});
test('shared profiles are validated before they appear in the hotel menu',()=>{
 const valid={name:'Mercure Dubai Deira',url:'https://secure.guestinternet.com/portal/?hotel=2',updatedAt:1};
 assert.equal(L.profile(valid,'pmercure').name,valid.name);assert.equal(L.profile({...valid,name:''},'pmercure'),null);assert.equal(L.profile(valid,'../enrollJob'),null);assert.equal(L.profile({...valid,url:'https://example.test/'},'pmercure'),null);
 assert.deepEqual(Object.keys(L.profiles({pmercure:valid,pinvalid:{...valid,url:'https://example.test/'},'../enrollJob':valid})),['pmercure']);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('neorcha.js','utf8'),start=source.indexOf('async function TWEAK_COLLECT('),end=source.indexOf('\nfunction COLLECTOR(',start),collector=source.slice(start,end);
function fixture(change={}){
 const calls=[],hotel='1001',row={id:'1',hotel_id:hotel,enum_id:200,arrival_date:'2026-11-06',departure_date:'2026-11-08',email:'guest@example.test',first_name:'Example',last_name:'Guest',confirmation_number:'12345678',passport_number:'MUST_NOT_EXPORT',document_number:'MUST_NOT_EXPORT',birthdate:'MUST_NOT_EXPORT',purpose_of_visit:'Business'};
 let version='v1';const sandbox={location:{protocol:'https:',hostname:'ibis.myneorcha.com',pathname:'/tweak/dashboard'},sessionStorage:{getItem:()=>version},document:{cookie:'XSRF-TOKEN=test%20token'},fetch:async(path,options)=>{
 calls.push({path,options});let data;
 if(path.endsWith('screens/my'))data={menu:[{screenId:1,label:'Device Registration',href:'device-registration'},{screenId:2,label:'Guest Documents',href:'guest-documents'}]};
 else if(path.endsWith('/definition'))data={filters:{filters:['hotel_id','arrival_date','enum_id'].map(key=>({key}))}};
 else if(path.includes('/lookup-values'))data={options:[{label:'Ibis Styles Dubai Deira',value:hotel}]};
 else if(path.endsWith('/execute'))data={meta:{totalCount:1},rows:[{...row,...change.row}]};
 else throw Error('Unexpected endpoint '+path);
 if(change.respond)data=change.respond(path,data,options);
 return {ok:change.http!==409,status:change.http||200,json:async()=>data};
 }};
 Object.assign(sandbox.location,change.location);vm.createContext(sandbox);vm.runInContext(collector+';globalThis.collect=TWEAK_COLLECT;',sandbox);
 return {calls,run:(options={})=>sandbox.collect({from:'2026-11-06',to:'2026-11-07',...options}),switchContext:()=>version='v2'};
}
test('Tweak discovers Guest Documents and uses exact hotel/date/type filters and CSRF',async()=>{
 const f=fixture(),rows=await f.run();assert.equal(rows.length,1);assert.equal(rows[0].Email,'guest@example.test');assert.equal(rows[0]['Purpose Of Visit'],'Business');assert(!JSON.stringify(rows).includes('MUST_NOT_EXPORT'));
 const post=f.calls.find(c=>c.options.method==='POST'),body=JSON.parse(post.options.body);assert(post.path.includes('/screens/2/'));assert.equal(post.options.headers['X-XSRF-TOKEN'],'test token');assert.equal(post.options.headers['X-Tweak-Context-Version'],'v1');assert.deepEqual(body.filters.map(f=>f.key),['hotel_id','arrival_date__from','arrival_date__to','enum_id']);assert.equal(body.filters[0].value,'1001');assert.equal(body.filters[3].value,200);
 assert(f.calls.every(c=>c.options.method==='GET'||c.path.endsWith('/datasets/execute')));
});
test('Tweak uses the link brand and does not request a different hotel',async()=>{
 for(const change of [{location:{hostname:'mercure.myneorcha.com'}},{respond:(p,d)=>p.includes('lookup-values')?{options:[{label:'Mercure Dubai Deira',value:'2'}]}:d}]){const f=fixture(change);await assert.rejects(f.run());assert(!f.calls.some(c=>c.options.method==='POST'));}
});
test('mixed hotel, wrong document, wrong dates, duplicate cards and unreadable email stop collection',async()=>{
 for(const row of [{hotel_id:'2'},{enum_id:201},{arrival_date:'2026-11-08'},{email:'encrypted-text'}])await assert.rejects(fixture({row}).run());
 await assert.rejects(fixture({respond:(p,d)=>p.endsWith('/execute')?{meta:{totalCount:2},rows:[d.rows[0],d.rows[0]]}:d}).run(),/repeated/);
});
test('pagination reads every card, rejects missing pages and handles a verified empty range',async()=>{
 let n=0;const f=fixture({respond:(p,d)=>{if(!p.endsWith('/execute'))return d;return {meta:{totalCount:2},rows:[{...d.rows[0],id:String(++n)}]};}});assert.equal((await f.run()).length,2);assert.equal(JSON.parse(f.calls.at(-1).options.body).offset,1);
 await assert.rejects(fixture({respond:(p,d)=>p.endsWith('/execute')?{meta:{totalCount:2},rows:[]}:d}).run(),/incomplete/);
 assert.equal((await fixture({respond:(p,d)=>p.endsWith('/execute')?{meta:{totalCount:0},rows:[]}:d}).run()).length,0);
});
test('changed context fails before saving; unexpected filter layouts are held',async()=>{
 await assert.rejects(fixture({http:409}).run(),/context changed/);
 await assert.rejects(fixture({respond:(p,d)=>p.endsWith('/definition')?{filters:[]}:d}).run(),/filters changed/);
});
test('serialized collector carries both implementations for cloud, console and helper',()=>{
 const a=source.indexOf('const collectorSrc = '),b=source.indexOf('//',a);assert(source.slice(a,b).includes('TWEAK_COLLECT.toString()'));assert(source.includes('sessionStorage.getItem(\'tweak.tenantContextVersion\')&&!document.querySelector'));
 const cloud=fs.readFileSync('scripts/neorcha-cloud.js','utf8');assert(cloud.includes('input[formcontrolname=username]:visible'));assert(cloud.includes('await login(page, String(E.NEORCHA_USER)'));assert(cloud.includes("'neorchaWEBPlatform/#/login'"));
});

test('selection keeps reservation identity and excludes unselected data',async()=>{
 const result=await fixture().run({fields:['Email']});assert(result[0].Email);assert(result[0]['Confirmation Number']);assert(result[0]['Arrival Date']);assert(!('Nationality' in result[0]));assert(!('Purpose Of Visit' in result[0]));
 const empty=await fixture().run({fields:[]});assert(!('Email' in empty[0]));assert.equal(Object.keys(empty[0]).length,6);
 await assert.rejects(fixture().run({fields:['passport_number']}),/not supported/);
});
test('explicit hotel names resolve within the linked portal and ambiguous hotels are held',async()=>{
 const good=fixture({location:{hostname:'mercure.myneorcha.com'},respond:(p,d)=>p.includes('/lookup-values')?{options:[{label:'Mercure Dubai Deira',value:'1001'}]}:d});assert.equal((await good.run({hotelName:'Mercure Dubai Deira'})).length,1);
 await assert.rejects(fixture().run({hotelName:'Other Ibis Hotel'}),/exact hotel/);
});
test('cloud URL selection preserves explicit legacy links and recognizes Tweak links',()=>{
 const cloud=require('../scripts/neorcha-cloud.js');assert.equal(cloud.readerFor('https://ibis.myneorcha.com/neorchaWEBPlatform/#/login'),'legacy');assert.equal(cloud.readerFor('https://mercure.myneorcha.com/tweak/'),'tweak');assert.throws(()=>cloud.readerFor('https://evil.test/tweak/'));assert.throws(()=>cloud.readerFor('https://ibis.myneorcha.com/unknown'));
});

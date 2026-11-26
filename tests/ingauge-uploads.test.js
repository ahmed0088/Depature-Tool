'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness(){
 const labels={'igFile-changes':{textContent:''}},ctx={console,Intl,Date,Map,Set,URL,InGaugeAuditCore:require('../ingauge-audit-core.js'),document:{readyState:'loading',addEventListener(){},getElementById:id=>labels[id]||null},pkgEvents:{},pkgPdfFiles:[],calls:[]};ctx.window=ctx;vm.createContext(ctx);
 const audit=fs.readFileSync('package-audit.js','utf8'),a=audit.indexOf('function _pkgMergeEvents('),b=audit.indexOf('\n//',a);vm.runInContext(audit.slice(a,b),ctx);
 ctx.pkgLoadPdf=async input=>{ctx.calls.push(input.files.map(f=>f.name));for(const f of input.files){if(f.bad)return;ctx._pkgMergeEvents(ctx.pkgEvents,f.events);if(!ctx.pkgPdfFiles.includes(f.name))ctx.pkgPdfFiles.push(f.name);}};
 vm.runInContext(fs.readFileSync('ingauge-workspace.js','utf8'),ctx);return {ctx,labels,upload:ctx.InGaugeWorkspace.upload};
}
const file=(name,action,ts)=>({name,events:{12345678:[{ts,code:'BB',action,user:'EXAMPLE',price:'100'}]}});
test('automation passes both selected PDFs to the existing Package Audit loader',async()=>{
 const h=harness(),a=file('new-reservation.pdf','NEW',1),b=file('update-reservation.pdf','UPDATE',2);await h.upload('changes',[a,b]);assert.deepEqual(Array.from(h.ctx.calls[0]),['new-reservation.pdf','update-reservation.pdf']);assert.equal(h.ctx.pkgEvents['12345678'].length,2);assert.match(h.labels['igFile-changes'].textContent,/2 logs loaded/);assert(h.labels['igFile-changes'].textContent.includes(a.name));assert(h.labels['igFile-changes'].textContent.includes(b.name));
});
test('separate uploads retain both logs and the existing merger excludes duplicate events',async()=>{
 const h=harness(),a=file('new-reservation.pdf','NEW',1),b=file('update-reservation.pdf','UPDATE',2);await h.upload('changes',a);await h.upload('changes',[b]);await h.upload('changes',[a,b]);assert.equal(h.ctx.pkgPdfFiles.length,2);assert.equal(h.ctx.pkgEvents['12345678'].length,2);
});
test('an unsuccessful second PDF remains an error rather than claiming both are loaded',async()=>{
 const h=harness(),a=file('new-reservation.pdf','NEW',1);await assert.rejects(h.upload('changes',[a,{name:'unreadable.pdf',bad:true}]),/unreadable.pdf/);assert.equal(h.ctx.pkgEvents['12345678'].length,1);assert.match(h.labels['igFile-changes'].textContent,/1 log loaded/);assert(!h.labels['igFile-changes'].textContent.includes('unreadable.pdf'));
});

const OPERA_JOURNAL='/home/ubuntu/upload/finjrnlbytrans_1916245210.txt',OPERA_RESERVATIONS='/home/ubuntu/upload/res_detail_1916245048.txt';
// The supplied reports live only on the dev machine; CI and clones skip this check.
test('the supplied Opera reports parse without unsupported values',{skip:!fs.existsSync(OPERA_JOURNAL)||!fs.existsSync(OPERA_RESERVATIONS)},()=>{
 const manual=require('../manual-upsells.js');
 const journal=manual.parseJournal(fs.readFileSync(OPERA_JOURNAL,'utf8'));
 const reservations=manual.parseReservations(fs.readFileSync(OPERA_RESERVATIONS,'utf8'));
 assert.equal(journal.rows.length,801);
 assert.equal(reservations.rows.length,2074);
 assert.equal(reservations.warnings.length,0);
 for(const row of [...journal.rows,...reservations.rows]) for(const value of Object.values(row)) assert.notEqual(value,undefined);
});

test('review serializer handles optional undefined array members like JSON',()=>{
 const stable=require('../ingauge-audit-core.js').stable;
 assert.equal(stable(['transaction',undefined,'seller']),'["transaction",null,"seller"]');
 assert.equal(stable({optional:undefined,items:[undefined]}),'{"items":[null]}');
});

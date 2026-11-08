'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function sandbox(){
 const noop=()=>{},element=()=>({style:{},classList:{add:noop,remove:noop,toggle:noop},addEventListener:noop,appendChild:noop,querySelector:()=>null,querySelectorAll:()=>[]});
 const sb={console,Date,JSON,Math,setTimeout:()=>0,clearTimeout:noop,setInterval:()=>0,localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},document:{getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:noop,createElement:element,body:element(),readyState:'complete'},addEventListener:noop,navigator:{onLine:true}};
 sb.window=sb;sb.globalThis=sb;sb.InGaugeWorkspace={state:{snapshot:{contributors:[{id:'1',name:'Alice Original'},{id:'2',name:'Bob Editor'},{id:'3',name:'Turab Shah'},{id:'4',name:'Turab Khan'}]}}};
 vm.createContext(sb);for(const name of ['ingauge-audit-core.js','package-audit.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',name),'utf8'),sb);return sb;
}
const row=(extra={})=>({user:'Alice Original',originEvent:{user:'Bob Editor'},verdict:'credit',reassign:true,alreadyComplete:true,...extra});
test('automatic seller review checks the final extension/memory decision rather than the editor',()=>{
 const sb=sandbox(),r=row({user:'Turab',extendedFrom:'12345677'});sb.rows=[r];vm.runInContext('_pkgReviewFinalSellerIdentity(rows)',sb);
 assert.equal(r.user,'Turab');assert.equal(r.verdict,'review');assert.equal(r.identityReview,true);assert.equal(r.alreadyComplete,false);assert.match(r.note,/Turab Shah/);assert.match(r.note,/Turab Khan/);
});
test('an ambiguous per-booking editor cannot replace a resolved final seller',()=>{
 const sb=sandbox(),r=row({originEvent:{user:'Turab'},memoryUsed:true});sb.rows=[r];vm.runInContext('_pkgReviewFinalSellerIdentity(rows)',sb);
 assert.equal(r.user,'Alice Original');assert.equal(r.verdict,'credit');assert.equal(r.identityReview,undefined);
});
test('repeated-letter suggestions for the final seller remain held',()=>{
 const sb=sandbox(),r=row({user:'Turaab',originEvent:{user:'Bob Editor'}});sb.rows=[r];vm.runInContext('_pkgReviewFinalSellerIdentity(rows)',sb);
 assert.equal(r.verdict,'review');assert.equal(r.identityReview,true);assert.match(r.note,/repeated-letter/);
});
test('pending and explicitly requested sales keep the requested seller when package logs are absent',()=>{
 const sb=sandbox(),r={status:'PENDING',employee:'Alice Original',product:'Late Check Out',charge:100,arr:'01-Nov-2026',dep:'02-Nov-2026',user:'Turab',reassign:true,originEvent:{user:'Bob Editor'}};sb.rows=[r];vm.runInContext('_pkgApplyRequestedSales(rows);_pkgReviewFinalSellerIdentity(rows)',sb);
 assert.equal(r.requestedSale,true);assert.equal(r.pendingRequest,true);assert.equal(r.user,'Alice Original');assert.equal(r.reassign,false);assert.equal(r.originEvent,null);assert.equal(r.verdict,'review');assert.equal(r.identityReview,undefined);assert.match(r.note,/awaiting approval/);
});
test('explicit pins retain their precedence over inferred attribution',()=>{
 const sb=sandbox(),r=row({user:'Turab',pin:{seller:'Turab'}});sb.rows=[r];vm.runInContext('_pkgReviewFinalSellerIdentity(rows)',sb);assert.equal(r.user,'Turab');assert.equal(r.verdict,'credit');assert.equal(r.identityReview,undefined);
});


test('empty and unresolved final identities do not fall back to a resolved editor',()=>{
 for(const user of ['',null,undefined,'Unknown Seller']) {
   const sb=sandbox(),r=row({user,originEvent:{user:'Bob Editor'}});sb.rows=[r];vm.runInContext('_pkgReviewFinalSellerIdentity(rows)',sb);
   assert.equal(r.user,user);assert.equal(r.verdict,'review');assert.equal(r.identityReview,true);assert.equal(r.alreadyComplete,false);assert.doesNotMatch(r.note,/Bob Editor/);
 }
});
test('legacy rows without a final user may use their origin event',()=>{
 const sb=sandbox(),r=row();delete r.user;sb.rows=[r];vm.runInContext('_pkgReviewFinalSellerIdentity(rows)',sb);assert.equal(r.verdict,'credit');assert.equal(r.identityReview,undefined);
});
test('no live contributor catalog and no shared resolver retain legacy attribution behavior',()=>{
 for(const mode of ['no live catalog','no resolver']) {
   const sb=sandbox(),r=row({user:'Unmapped Legacy Seller'});
   if(mode==='no live catalog')delete sb.InGaugeWorkspace;else sb.InGaugeAuditCore=undefined;
   sb.rows=[r];vm.runInContext('_pkgReviewFinalSellerIdentity(rows)',sb);assert.equal(r.verdict,'credit',mode);assert.equal(r.identityReview,undefined);
 }
});

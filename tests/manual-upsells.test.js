'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const M = require('../manual-upsells.js');
const rawHeaders = ['Product','Employee','Employee ID','Confirmation no','Daily Date( Other Data )','Product Charge','Status','Currency','ID','Manually Added Record'];
function fixtures() {
  const j = { TRX_NO:'123', TRX_CODE:'1061', CURRENCY1:'AED', CASHIER_DEBIT:'122.45', CASHIER_CREDIT:'0', BUSINESS_DATE:'01-NOV-26', REFERENCE:'Early Check-In Upsell ** Lina', ROOM:'0318', GUEST_FULL_NAME:'TEST,GUEST,Mr.', CASHIER_NAME:'RIVERA Lina', USER_NAME:'LINA', INSERT_USER:'5', line:2 };
  const r = { CONFIRMATION_NO:'12345678', TRUNC_BEGIN:'01-NOV-26', TRUNC_END:'03-NOV-26', SHORT_RESV_STATUS:'CKIN', ROOM_NO:'318', FULL_NAME:'Guest Test' };
  const g = M.parseIngauge([rawHeaders,['Early Check In','Lina RIVERA',1,87654321,'01-Nov-2026',100,'APPROVED','AED',100,'No']]).rows[0];
  return { j, r, g };
}
const run = (f, extra = {}) => M.reconcile(extra.journal || [f.j], extra.reservations || [f.r], extra.ig || [f.g]);
test('unique missing sale links confirmation, room, note seller and cents', () => {
  const f=fixtures(), out=run(f); assert.equal(out.summary.add,1); assert.equal(out.rows[0].conf,'12345678'); assert.equal(out.rows[0].cents,12245); assert.equal(out.rows[0].seller.name,'Lina RIVERA');
});
test('notes outrank another cashier; mismatch and unmapped employee remain visible', () => {
  const f=fixtures(); f.j.REFERENCE='Early C/In Upsell**Jordan'; f.j.CASHIER_NAME='RIVERA Lina';
  const row=run(f).rows[0]; assert.equal(row.seller.name,'Jordan'); assert.match(row.seller.explanation,/Credit Jordan.*posted by RIVERA Lina/); assert.match(row.seller.warning,/differs/); assert.equal(row.bucket,'review');
});
test('duplicate note text and dated note endings are parsed without inventing sellers', () => {
  const f=fixtures(); f.j.REFERENCE='Breakfast Upsell - 2 pax**Lina - 01/11 Morning'; f.j.REMARK=f.j.REFERENCE;
  assert.equal(run(f).rows[0].seller.name,'Lina RIVERA');
  f.j.REMARK='Upsell**Another Person'; assert.equal(run(f).rows[0].seller.basis,'Conflicting notes'); assert.equal(run(f).rows[0].bucket,'review');
});
test('posting-user fallback and system account never become ready additions', () => {
  const f=fixtures(); f.j.REFERENCE=''; assert.equal(run(f).rows[0].bucket,'review'); assert.equal(run(f).rows[0].seller.basis,'Posting user fallback');
  f.j.CASHIER_NAME='HA7N5 - Night Audit'; assert.equal(run(f).rows[0].seller.basis,'Unresolved posting user');
});
test('pending is already requested; fresh approved export updates the result without adding', () => {
  const f=fixtures(); f.g.conf=f.r.CONFIRMATION_NO; f.g.cents=12245; f.g.status='PENDING'; f.g['Manually Added Record']='Yes';
  assert.equal(run(f).rows[0].bucket,'existing'); assert.match(run(f).rows[0].action,/Approve or reject/);
  f.g.status='APPROVED'; assert.equal(run(f).summary.add,0); assert.equal(run(f).rows[0].action,'Nothing to add.');
});
test('manual flag Yes/No both prevent duplicates; reviewed counts as existing', () => {
  const f=fixtures(); f.g.conf=f.r.CONFIRMATION_NO; f.g.cents=12245;
  for (const flag of ['Yes','No']) { f.g['Manually Added Record']=flag; assert.equal(run(f).rows[0].bucket,'existing'); }
  f.g.status='REVIEWED'; assert.equal(run(f).rows[0].bucket,'existing');
});
test('denied, other seller, different amount and different currency require review', () => {
  for (const edit of [{status:'DENIED'},{employee:'Other Seller'},{cents:15000},{currency:'USD'},{status:''}]) {
    const f=fixtures(); Object.assign(f.g,{conf:f.r.CONFIRMATION_NO},edit); assert.equal(run(f).rows[0].bucket,'review'); assert.equal(run(f).summary.add,0);
  }
});
test('one-off on another daily date and unknown product block duplicate suggestions', () => {
  const f=fixtures();f.g.conf=f.r.CONFIRMATION_NO;
  let other={...f.g,conf:'87654321'};f.g.day='2026-11-02';assert.equal(run(f,{ig:[f.g,other]}).rows[0].bucket,'review');
  f.g.day='2026-11-01';f.g.product='Unknown Product';assert.equal(run(f).rows[0].bucket,'review');
});
test('outside coverage and gaps inside observed range are never missing', () => {
  const f=fixtures();f.j.BUSINESS_DATE='06-NOV-26';assert.equal(run(f).rows[0].bucket,'coverage');
  f.j.BUSINESS_DATE='02-NOV-26';assert.equal(run(f,{ig:[f.g,{...f.g,day:'2026-11-03'}]}).rows[0].bucket,'coverage');
});
test('automatic packages are excluded; unsupported codes, unmarked breakfast and reversals need review', () => {
  const f=fixtures(); f.j.REFERENCE='[NA Pkgs.UPS40BB]';assert.equal(run(f).rows[0].bucket,'package');
  f.j.REFERENCE=''; f.j.TRX_CODE='2090';assert.equal(run(f).rows[0].bucket,'review');
  f.j.TRX_CODE='9999';assert.equal(run(f).rows[0].bucket,'review');
  f.j.TRX_CODE='1061';f.j.CASHIER_CREDIT='122.45';assert.equal(run(f).rows[0].bucket,'review');
});
test('shared rows deduplicate by confirmation; extension ambiguity remains review', () => {
  const f=fixtures();assert.equal(run(f,{reservations:[f.r,f.r]}).rows[0].bucket,'add');
  assert.equal(run(f,{reservations:[f.r,{...f.r,CONFIRMATION_NO:'12345679'}]}).rows[0].bucket,'review');
});
test('weak match to a pending request without a reservation is surfaced, not duplicated', () => {
  const f=fixtures(); f.g.status='PENDING';f.g.cents=12245;const row=run(f,{reservations:[]}).rows[0];assert.equal(row.bucket,'review');assert.equal(row.matches.length,1);assert.match(row.reason,/PENDING.*Do not add/);
});
test('weak match on another confirmation requires review even with unique reservation', () => {
  const f=fixtures();f.g.cents=12245;assert.equal(run(f).rows[0].bucket,'review');
});
test('multiple postings/reversals and multiple IN-Gauge requests cannot clear each other', () => {
  const f=fixtures();const second={...f.j,TRX_NO:'124',CASHIER_DEBIT:'0',CASHIER_CREDIT:'122.45'};
  assert.ok(run(f,{journal:[f.j,second]}).rows.every(r=>r.bucket==='review'));
  f.g.conf=f.r.CONFIRMATION_NO;assert.equal(run(f,{ig:[f.g,{...f.g,ID:101,cents:0}]}).rows[0].bucket,'review');
});
test('strict amounts and calendar dates, including Excel serials', () => {
  assert.equal(M.amount('1,234.56'),123456);assert.equal(M.amount('(122.45)'),-12245);assert.equal(M.amount('122.45 AED'),null);
  assert.equal(M.date('31-FEB-26'),'');assert.equal(M.date('06-NOV-26'),'2026-11-06');assert.equal(M.date(46332),'2026-11-06');
});
test('journal totals are ignored, identical IDs deduplicated and conflicting IDs rejected', () => {
  const headers=['TRX_NO','TRX_CODE','BUSINESS_DATE','CASHIER_DEBIT','CASHIER_CREDIT','GUEST_FULL_NAME','ROOM','CURRENCY1'];
  const line='123\t1061\t01-NOV-26\t100\t0\tTest Guest\t0318\tAED';
  const report=headers.join('\t')+'\n'+line+'\n'+line+'\nTotal\t100';
  assert.equal(M.parseJournal(report).rows.length,1);assert.equal(M.parseJournal(report).warnings.length,1);
  assert.throws(()=>M.parseJournal(report+'\n'+line.replace('100','200')),/Conflicting/);
  assert.throws(()=>M.parseJournal('Not a journal'),/Wrong report/);
  assert.throws(()=>M.parseJournal(headers.join('\t')+'\n123\t1061'),/truncated/);
});
test('reservation parser retains identity across multiline address fields', () => {
  const headers=['SORT_DATE','ADDRESS','CONFIRMATION_NO','FULL_NAME','TRUNC_BEGIN','TRUNC_END','ROOM_NO','SHORT_RESV_STATUS'];
  const report=headers.join('\t')+'\n20261101\tFirst line\nSecond line\t12345678\tTest Guest\t01-NOV-26\t03-NOV-26\t0318\tCKIN\n20261102\tOther address\t12345679\tOther Guest\t02-NOV-26\t04-NOV-26\t0319\tCKOT';
  const out=M.parseReservations(report);assert.equal(out.rows.length,2);assert.equal(out.rows[0].CONFIRMATION_NO,'12345678');assert.match(out.rows[0].ADDRESS,/Second line/);
});
test('wrong, empty and broken IN-Gauge reports fail rather than implying all sales missing', () => {
  assert.throws(()=>M.parseIngauge([['Product'],['Breakfast']]),/not the IN-Gauge/);assert.throws(()=>M.parseIngauge([rawHeaders]),/empty/);
  assert.throws(()=>M.parseIngauge([rawHeaders,['Breakfast','Lina',1,123,'bad',10,'APPROVED','AED',1,'No']]),/invalid/);
});
function auditSandbox() {
  const noop=()=>{}, element=()=>({style:{},classList:{add:noop,remove:noop,toggle:noop},addEventListener:noop,appendChild:noop,querySelector:()=>null,querySelectorAll:()=>[]});
  const sb={console,Date,JSON,Math,setTimeout:()=>0,clearTimeout:noop,setInterval:()=>0,localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},document:{getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:noop,createElement:element,body:element(),readyState:'complete'},addEventListener:noop,navigator:{onLine:true}};
  sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(fs.readFileSync(path.join(__dirname,'../package-audit.js'),'utf8'),sb);return sb;
}
function audit(sb,status,manual='Yes',extra='') {
  return vm.runInContext(`(()=>{pkgUnknowns=_pkgParseExcelUnknowns([['Product','Employee','Confirmation no','Daily Date','Product Charge','Status','Manually Added Record','Created By','ID'],['Late Check Out','Lina RIVERA','12345678','04-Nov-2026',122.45,'${status}','${manual}','Lina RIVERA','100']]);pkgEvents={};${extra};return _pkgCompute();})()`,sb);
}
test('Package Audit: pending seller request is not denied or reassigned with no Opera event',()=>{
  const sb=auditSandbox(),row=audit(sb,'PENDING')[0];assert.equal(row.verdict,'review');assert.equal(row.pendingRequest,true);assert.equal(row.user,'Lina RIVERA');assert.equal(row.reassign,false);assert.match(row.note,/awaiting approval/);
  assert.equal(vm.runInContext('_pkgActionText(_pkgCompute()[0])',sb),'Awaiting approval in IN-Gauge');
});
test('Package Audit: approval clears pending and preserves approved manual seller',()=>{
  const sb=auditSandbox();audit(sb,'PENDING');const row=audit(sb,'APPROVED')[0];assert.equal(row.pendingRequest,false);assert.equal(row.alreadyComplete,true);assert.equal(row.verdict,'credit');assert.equal(row.user,'Lina RIVERA');
  assert.equal(audit(sb,'DENIED')[0].verdict,'settled');
});
test('Package Audit: regular automatic records keep the previous missing-log behavior',()=>{
  const sb=auditSandbox();assert.equal(audit(sb,'APPROVED','No')[0].verdict,'outside');
  assert.equal(audit(sb,'PENDING','No')[0].pendingRequest,true);
});
test('Package Audit: missing manual product/seller still needs review',()=>{
  const sb=auditSandbox();const out=audit(sb,'APPROVED','Yes',"pkgUnknowns[0].employee='';pkgUnknowns[0].needsEmployee=true;");assert.equal(out[0].verdict,'review');assert.equal(out[0].alreadyComplete,false);
});
test('Package Audit: pending requests never enter earned-sale history or memory',()=>{
  const sb=auditSandbox();audit(sb,'PENDING');sb.calls=[];sb.saveHistory=(...a)=>sb.calls.push(a);vm.runInContext('_pkgArchive(_pkgCompute())',sb);assert.equal(sb.calls.length,0);
  assert.equal(vm.runInContext('Object.keys(_pkgMemoryBuild(_pkgCompute(),{}).patch).length',sb),0);
});
test('Package Audit: pending request overlapping another entry is review, not auto-approval',()=>{
  const sb=auditSandbox();const out=audit(sb,'PENDING','Yes',"pkgUnknowns.push({...pkgUnknowns[0],status:'APPROVED',manualAdded:false,recordId:'101'});");assert.ok(out.every(r=>r.verdict==='review'));assert.ok(out.every(r=>r.requestedCollision));
});
test('release includes the manual UI, styles and offline files',()=>{
  const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  assert.match(html,/src="manual-upsells.js"/);assert.match(html,/href="manual-upsells.css"/);assert.match(sw,/'\.\/manual-upsells.js'/);assert.match(sw,/'\.\/manual-upsells.css'/);
});
test('Package Audit: pending cannot be marked fixed or hidden by an old fixed marker',()=>{
  const sb=auditSandbox();audit(sb,'PENDING');sb.showToast=()=>{};
  const result=vm.runInContext(`(()=>{pkgResults=_pkgCompute();const row=pkgResults[0],key=_pkgPinKey(row);pkgDone[key]={at:'2026-11-06T00:00:00Z'};const before=JSON.stringify(pkgDone);pkgMarkFixed(null,key);return [_pkgInView({key,rows:[row]},'action'),pkgNightDone(row),before===JSON.stringify(pkgDone)];})()`,sb);
  assert.deepEqual(Array.from(result),[true,false,true]);
});
test('ambiguous employees with the same name do not get a guessed employee ID',()=>{
  const f=fixtures(),out=run(f,{ig:[f.g,{...f.g,'Employee ID':'99',ID:101}]});
  assert.equal(out.rows[0].seller.mapped,false);assert.equal(out.rows[0].bucket,'review');
});
// DOM API double exercises the real upload/render/copy/export handlers without a browser dependency.
function uiSandbox() {
  const nodes=new Map();
  class Element {
    constructor(tag='div') {this.tagName=tag.toUpperCase();this.dataset={};this.attrs={};this.listeners={};this.style={};this.hidden=false;this.disabled=false;this.value='';this._html='';this.classList={add(){},remove(){},toggle(){}};}
    set id(v){this._id=v;nodes.set(v,this);} get id(){return this._id;}
    set innerHTML(v){this._html=v;for(const m of v.matchAll(/<([a-z]+)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)){const e=nodes.get(m[3])||new Element(m[1]);e.id=m[3];for(const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g)){e.attrs[a[1]]=a[2];if(a[1].startsWith('data-'))e.dataset[a[1].slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=a[2];}if(e.attrs.value)e.value=e.attrs.value;}}
    get innerHTML(){return this._html;}
    setAttribute(k,v){this.attrs[k]=v;if(k==='id')this.id=v;}
    addEventListener(k,f){(this.listeners[k]??=[]).push(f);}
    appendChild(e){e.parentNode=this;return e;}
    insertBefore(e){e.parentNode=this;return e;}
    querySelector(q){if(q==='.msu-file-status')return this.status??=new Element('span');if(q==='input')return nodes.get(this.id.replace('msuFile-','msuInput-'));if(q==='[data-v="rules"]')return nodes.get('rules');return null;}
    querySelectorAll(q){if(q==='.msu-file')return ['journal','reservations','ingauge'].map(k=>nodes.get('msuFile-'+k));if(q==='input[type="file"]')return ['journal','reservations','ingauge'].map(k=>nodes.get('msuInput-'+k));return [];}
    hasAttribute(k){return k in this.attrs;}
    closest(){return this;}
    focus(){} setSelectionRange(){}
  }
  const body=new Element(),tabs=new Element();tabs.id='pkgTabs';
  for(const name of ['pkgMainView','pkgRulesView','pkgClearReports','rules','pkgExcelFileInput','pkgGuestFileInput']){const e=new Element();e.id=name;e.parentNode=body;}
  const sb={console,setTimeout,clearTimeout,Date,JSON,Math,document:{readyState:'loading',getElementById:k=>nodes.get(k)||null,createElement:t=>new Element(t),querySelectorAll:()=>[],addEventListener(){}},copied:[],exports:[],showPanel(){},hoPanelAllowed:()=>true};
  sb.copyToClipboard=(text)=>sb.copied.push(text);
  sb.XLSX={utils:{book_new:()=>({sheets:[]}),aoa_to_sheet:rows=>({rows}),book_append_sheet:(wb,ws,name)=>wb.sheets.push({ws,name})},writeFile:(wb,name)=>sb.exports.push({wb,name})};
  sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(fs.readFileSync(path.join(__dirname,'../manual-upsells.js'),'utf8'),sb);sb.ManualUpsells.mount();return {sb,nodes,Element};
}
test('UI: upload, analyze, numeric search, evidence, copy and export use the real handlers',async()=>{
  const {sb,nodes,Element}=uiSandbox(),M=sb.ManualUpsells,f=fixtures();
  M.state.data={journal:{rows:[f.j],warnings:[]},reservations:{rows:[f.r],warnings:[]},ingauge:{rows:[f.g],warnings:[]}};
  for(const k of Object.keys(M.state.data))M.state.files[k]={name:k+' report'};
  M.show();assert.equal(nodes.get('manualUpsellView').hidden,false);assert.equal(nodes.get('pkgMainView').hidden,true);assert.equal(nodes.get('msuRun').disabled,false);
  await M.run();assert.match(nodes.get('msuResults').innerHTML,/AED 122\.45/);assert.match(nodes.get('msuResults').innerHTML,/12345678/);
  const view=nodes.get('manualUpsellView'),click=b=>view.listeners.click.forEach(fn=>fn({target:b}));
  const search=nodes.get('msuSearch');search.value='9999';view.listeners.input[0]({target:search});assert.match(nodes.get('msuResults').innerHTML,/No matching sales/);
  nodes.get('msuSearch').value='0318';view.listeners.input[0]({target:nodes.get('msuSearch')});assert.match(nodes.get('msuResults').innerHTML,/12345678/);
  const evidence=new Element('button');evidence.dataset.msEvidence='123';click(evidence);assert.match(nodes.get('msuResults').innerHTML,/What Opera posted/);
  const copy=new Element('button');copy.attrs['data-ms-entry']='0';copy.dataset.msEntry='0';click(copy);assert.match(sb.copied[0],/Seller explanation: Credit Lina/);
  M.exportWorkbook();assert.equal(sb.exports.length,1);assert.ok(sb.exports[0].wb.sheets.some(s=>s.name==='What to add'));
  M.hide();assert.equal(nodes.get('manualUpsellView').hidden,true);assert.equal(nodes.get('pkgClearReports').hidden,false);
});
test('UI: a failed replacement clears stale results and blocks analysis',async()=>{
  const {sb,nodes}=uiSandbox(),M=sb.ManualUpsells,f=fixtures();
  M.state.data={journal:{rows:[f.j],warnings:[]},reservations:{rows:[f.r],warnings:[]},ingauge:{rows:[f.g],warnings:[]}};
  M.state.files={journal:{name:'old'},reservations:{name:'old'},ingauge:{name:'old'}};
  await M.run();assert.ok(M.state.result);
  await M.load('journal',{name:'wrong.txt',text:async()=> 'wrong report'});
  assert.equal(M.state.result,null);assert.equal(M.state.data.journal,undefined);assert.equal(nodes.get('msuRun').disabled,true);assert.match(nodes.get('msuError').textContent,/Wrong report/);
});
test('cards lead with a copyable confirmation and separate entry values from reservation dates',()=>{
 const f=fixtures(),row=run(f).rows[0],html=M.card(row,0);
 assert.ok(html.indexOf('Confirmation number')<html.indexOf('Room 0318'));
 assert.match(html,/Copy number/);assert.match(html,/How to add this sale/);assert.match(html,/Why this sale/);
 const fields=Object.fromEntries(M.additionFields(row));assert.equal(fields['Daily date'],'2026-11-01');assert.equal(fields['Charge days'],'1');assert.equal(fields['Product charge · net'],'122.45');
 assert.ok(!('Reservation arrival' in fields));assert.match(M.additionText(row),/Confirmation number: 12345678/);
});
test('unresolved cards never present a possible confirmation as a confirmed entry',()=>{
 const f=fixtures(),row=run(f,{reservations:[]}).rows[0],html=M.card(row,0);assert.match(html,/Confirmation not resolved/);assert.doesNotMatch(html,/Copy IN-Gauge details/);
});
test('the evidence explains note priority and safely displays guest-entered markup',()=>{
 const f=fixtures();f.j.REFERENCE='Upsell ** Jordan';const row=run(f).rows[0];row.note='<img src=x onerror=alert(1)>';
 const html=M.evidenceHtml(row);assert.match(html,/posted by RIVERA Lina/);assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));
});


function sellerSandbox(withCore) {
  const sb={console};vm.createContext(sb);
  if(withCore)vm.runInContext(fs.readFileSync(path.join(__dirname,'../ingauge-audit-core.js'),'utf8'),sb);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../manual-upsells.js'),'utf8'),sb);
  return sb.ManualUpsells;
}
for(const withCore of [false,true]) {
  const mode=withCore?'with shared identity resolver':'standalone report';
  test('seller identity rejects full-name subsets '+mode,()=>{
    const api=sellerSandbox(withCore),people=[{id:'1',name:'John Paul Smith',activeStatus:'NORMAL'}];
    const seller=api.sellerOf({REFERENCE:'Upsell ** John Smith',CASHIER_NAME:'John Smith'},people);
    assert.equal(seller.name,'John Smith');assert.equal(seller.mapped,false);assert.equal(seller.employeeId,'');assert.match(seller.warning,/not uniquely mapped/);
    const f=fixtures();f.j.REFERENCE='Upsell ** John Smith';f.j.CASHIER_NAME='John Smith';
    const row=api.reconcile([f.j],[f.r],[f.g],{contributors:people}).rows[0];
    assert.equal(row.bucket,'review');assert.equal(row.seller.mapped,false);
  });
  test('ambiguous and repeated-letter note names stay unresolved '+mode,()=>{
    const api=sellerSandbox(withCore),people=[{id:'1',name:'John Smith'},{id:'2',name:'John Jones'}];
    for(const name of ['John','Jonn']) {
      const seller=api.sellerOf({REFERENCE:'Upsell ** '+name,CASHIER_NAME:name},people);
      assert.equal(seller.mapped,false);assert.equal(seller.employeeId,'');
    }
    const suggested=api.sellerOf({REFERENCE:'Upsell ** Turaab',CASHIER_NAME:'Turaab'},[{id:'3',name:'Turab Shah'}]);
    assert.equal(suggested.mapped,false);assert.equal(suggested.employeeId,'');
  });
  test('notes keep priority and expose the distinct posting contributor '+mode,()=>{
    const api=sellerSandbox(withCore),people=[{id:'1',name:'John Smith'},{id:'2',name:'John Paul Smith'}];
    const seller=api.sellerOf({REFERENCE:'Upsell ** John Smith',CASHIER_NAME:'John Paul Smith'},people);
    assert.equal(seller.mapped,true);assert.equal(seller.employeeId,'1');assert.equal(seller.name,'John Smith');
    assert.match(seller.warning,/differs from the posting user/);assert.match(seller.explanation,/Credit John Smith.*posted by John Paul Smith/);
  });
  test('exact full names and unique note names retain the correct contributor '+mode,()=>{
    const api=sellerSandbox(withCore),people=[{id:'1',name:'Lina RIVERA'}];
    for(const name of ['Lina','RIVERA Lina']) {
      const seller=api.sellerOf({REFERENCE:'Upsell ** '+name,CASHIER_NAME:'RIVERA Lina'},people);
      assert.equal(seller.mapped,true);assert.equal(seller.employeeId,'1');assert.equal(seller.warning,'');
      const f=fixtures();f.j.REFERENCE='Upsell ** '+name;f.j.CASHIER_NAME='RIVERA Lina';
      const row=api.reconcile([f.j],[f.r],[f.g],{contributors:people}).rows[0];
      assert.equal(row.bucket,'add','a uniquely resolved note/posting identity stays ready');
    }
    const duplicates=api.sellerOf({REFERENCE:'Upsell ** Lina',CASHIER_NAME:'Lina'},[{id:'1',name:'Lina RIVERA'},{id:'2',name:'Lina RIVERA'}]);
    assert.equal(duplicates.mapped,false);assert.equal(duplicates.employeeId,'');
  });
}

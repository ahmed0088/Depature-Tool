'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('scripts/accor-loop-content.js','utf8');
const segment=source.slice(source.indexOf('  const COUNTRY_ALIASES'),source.indexOf('  function sanitizePhone'));
const C=new Function(segment+';return {mapCountry,countryKey,sameCountry};')();
const A=require('../scripts/accor-loop-cloud.js');

test('reported alternate country names match the same real portal country',()=>{
 for(const [input,option] of [['Türkiye','Turkey'],['TURKIYE','Turkey'],['TÜRKİYE','Turkey'],['Libyan Arab Jamahiriya','Libya'],['Eswatini','Swaziland'],['Burkina Fasa','Burkina-Faso'],['Cape Verde','Cabo Verde'],['Czech Republic','Czechia'],['Republic of Korea','South Korea'],['Russian Federation','Russia'],['United States of America','United States']])assert(C.sameCountry(input,option),input+' → '+option);
});
test('blank or ambiguous country names cannot select a different country by fuzzy overlap',()=>{
 for(const pair of [['','United Arab Emirates'],['Congo','Congo, the Democratic Republic of the'],['Guinea','Guinea-Bissau'],['Niger','Nigeria'],['Dominica','Dominican Republic'],['United','United Kingdom']])assert.equal(C.sameCountry(...pair),false,pair.join(' / '));
});
test('known ISO country codes expand without confusing missing markers with Namibia',()=>{
 for(const [code,country] of [['AE','United Arab Emirates'],['IN','India'],['DE','Germany'],['TR','Turkey'],['NA','Namibia']])assert(C.sameCountry(code,country),code+' → '+country);
 for(const missing of ['', 'unknown','N/A','No Nationality','not provided','--'])assert.equal(C.mapCountry(missing),'');
 assert.equal(C.sameCountry('ZZ','United Arab Emirates'),false);
});
test('consent and title requirements remain enforced and pipe rows retain reviewed country',()=>{
 const rows=A.consenting('Consent\tCivility\tName\tEmail\tCountry\tConfirmation\nY\tMr\tSample Person\tp@example.test\tTürkiye\t1\nN\tMr\tNo Consent\tn@example.test\tTurkey\t2\nY\t\tNo Title\tt@example.test\tTurkey\t3');
 assert.equal(rows.length,1);assert.equal(rows[0].country,'Türkiye');assert(A.pipeRows(rows).includes('|Türkiye'));
});
test('each outcome belongs to exactly one summary bucket including skipped errors',()=>{
 const statuses=['success','already_member','pending-account','skipped: country_missing','skipped: country_not_found: Türkiye','skipped: error: signup button not found','bad_email','test: form_ready'];
 const r=A.resultReport(statuses.map((status,i)=>({status,name:'Sample '+i,conf:String(i),email:'private@example.test'})),statuses.length);
 assert.deepEqual([r.submitted,r.alreadyMember,r.pending,r.skipped,r.errors,r.other],[1,1,1,2,2,1]);
 assert.equal(r.submitted+r.alreadyMember+r.pending+r.skipped+r.errors+r.other,r.processed);
 assert.equal(r.guests[5].cat,'error');assert.equal(r.guests[3].cat,'skipped');assert(!JSON.stringify(r).includes('private@example.test'));
 assert.equal(r.complete,true);assert.equal(A.resultReport([],1).complete,false);
});
function processFixture(diagnosticOnly){
 const results=[],calls=[],sandbox={window:{},receipts:{recover:async()=>null},diagnosticOnly,results,cset:async()=>{},log:()=>{},CURRENT_KEY:'current',persist:async index=>calls.push(['persist',index]),goHome:async()=>calls.push(['navigate']),openSignupForm:async()=>calls.push(['form']),clearReactSelect:async()=>{},inputByLabel:()=>({value:'',dispatchEvent(){}}),setReactInput:()=>{},pickTitle:async()=>true,pickReactSelectByLabel:async()=>{calls.push(['country']);return true;},sleep:async()=>{},humanType:async()=>{throw Error('Guest fields must not be entered in a diagnostic');},DEFAULT_TITLE:'Mr.'};
 vm.createContext(sandbox);const fn=source.slice(source.indexOf('  async function processOne('),source.indexOf('  for (let i = startIndex;'));
 vm.runInContext(segment+'\n'+fn+';this.process=processOne;',sandbox);return {sandbox,results,calls};
}
const guest={conf:'1',first_name:'Sample',last_name:'Guest',nameOk:true,title:'Mr.',email:'sample@example.test',phone:'',country:'Turkey'};
test('missing country uses the authorized UAE fallback without changing the source record',async()=>{
 const {sandbox,results}=processFixture(true),rec={...guest,country:''};const out=await sandbox.process(rec,0,1);
 assert.equal(out.status,'diagnostic_form_ready');assert.equal(rec.country,'');assert.equal(results[0].countryAudit.selected,'United Arab Emirates');assert.equal(results[0].countryAudit.fallback,true);assert.equal(results[0].countryAudit.reason,'country_missing');
});
test('read-only diagnostic validates title and country without typing guest data or submitting',async()=>{
 const {sandbox,results,calls}=processFixture(true);const out=await sandbox.process(guest,0,1);
 assert.equal(out.status,'diagnostic_form_ready');assert.equal(results[0].status,'test: form_ready');assert(calls.some(x=>x[0]==='country'));
});

test('unusable guest names are held under the original name, without placeholder enrolments',async()=>{
 const {sandbox,results,calls}=processFixture(false);const out=await sandbox.process({...guest,originalName:'示例 客人',first_name:'Test',last_name:'User',nameOk:false},0,1);
 assert.equal(out.status,'skipped: name_not_latin');assert.equal(results[0].name,'示例 客人');assert.deepEqual(calls,[['persist',1]]);
});


test('live country fallback submits once with audit details; unavailable UAE never submits',async()=>{
 for(const [country,allowed,expected] of [['Turkey',['Turkey'],'Turkey'],['Unknownland',['United Arab Emirates'],'United Arab Emirates'],['',['United Arab Emirates'],'United Arab Emirates'],['Unknownland',['Canada'],null]]){
  const {sandbox,results,calls}=processFixture(false),fields={},rec={...guest,country},beforeCountry=rec.country;let submissions=0;
  Object.assign(sandbox,{pickReactSelectByLabel:async(label,value)=>{calls.push(['country',value]);return allowed.includes(value)},humanType:async(el,value)=>{el.value=value},inputByLabel:label=>fields[label]||(fields[label]={value:''}),setReactInput:(el,value)=>{el.value=value},waitFor:async fn=>fn(),document:{querySelector:()=>({disabled:false,scrollIntoView(){},click(){submissions++}})},findByText:()=>null,reactSelectInputByLabel:()=>null,waitForOutcome:async()=>{},dismissModalIfPresent:async()=>{},detectResult:()=> 'success',POST_SUBMIT_MAX:1,chrome:{runtime:{sendMessage(){}}},portalUrl:'https://portal.example.test',receipts:{recover:async()=>null,begin:async()=>{},clear:async()=>{}}});
  const result=await sandbox.process(rec,0,1);assert.equal(submissions,expected?1:0);assert.equal(rec.country,beforeCountry,'source country stays intact');assert.equal(results.length,1);
  if(expected){assert.equal(result.status,'success');assert.equal(results[0].countryAudit.selected,expected);assert.equal(results[0].countryAudit.fallback,country!=='Turkey');}
  else {assert.match(result.status,/UAE fallback unavailable/);assert.equal(fields['First name'].value,'','no guest details are entered when neither country is available');}
 }
});
test('fallback details stay visible in reports and saved tracker checkpoints without email leakage',async()=>{
 const countryAudit={requested:'Unknownland',selected:'United Arab Emirates',fallback:true,reason:'country_not_in_portal'},row={...guest,name:'Sample Guest',status:'success',countryAudit};
 const report=A.resultReport([row],1);assert.deepEqual(report.guests[0].countryAudit,countryAudit);assert.equal(report.submitted,1);assert.equal(report.countryFallbacks,1);assert.match(A.reportNote(report,false),/1 used UAE country fallback/);assert(!JSON.stringify(report).includes(guest.email));
 const changes=[],save=A.enrollmentCheckpoint({test:false,patch:async(path,value)=>changes.push({path,value})});await save([row]);assert.deepEqual(Object.values(changes[0].value)[0].countryAudit,countryAudit);
});

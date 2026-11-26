'use strict';
// Mock Opera profile page (fake guest only): the fixer must fill EMPTY fields, never touch filled ones,
// never press Save, refuse the wrong guest, and do nothing in dry run.
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core'),C=require('../immig-fixer-core.js');
const fixer=fs.readFileSync(__dirname+'/../tools/hotelops-opera-fixer.console.js','utf8');
const page_html=(name,filled)=>`<!doctype html><body style="font:14px sans-serif"><h2>${name}</h2><div class="f"><span class="l">Nationality</span><span id="hn">${filled.nat||'—'}</span></div>
<section id="pd"><h3>Personal Details</h3><a href="#" id="edit" onclick="return false">Edit</a>
 <div class="f"><label class="l" for="gin">Gender</label><span class="v" id="gv">${filled.gender||'—'}</span></div>
 <div class="f"><label class="l" for="nin">Nationality</label><span class="v" id="nv">${filled.nat||'—'}</span></div></section>
<section id="id"><h3>Identification</h3>
 <div class="f"><label class="l" for="tin">ID Type</label><span class="v" id="tv">${filled.type||'—'}</span></div>
 <div class="f"><label class="l" for="iin">ID Number</label><span class="v" id="iv">${filled.num||'—'}</span></div></section>
<a href="#" id="cancel" onclick="return false">Cancel</a> <button id="save">Save</button><ul id="opts" style="display:none"></ul>
<script>window.__saved=false;window.__clicks=[];
document.getElementById('save').onclick=()=>{window.__saved=true};
document.addEventListener('click',e=>window.__clicks.push((e.target.textContent||'').trim().slice(0,12)),true);
const countries={ET:'ET Ethiopia',OM:'OM Oman'};
document.getElementById('edit').onclick=()=>{
 const mk=(id,html)=>{const s=document.getElementById(id);if(s.textContent.trim()==='—')s.innerHTML=html;};
 mk('gv','<select id="gin"><option value=""></option><option value="M">M</option><option value="F">F</option></select>');
 mk('nv','<input id="nin">');mk('tv','<input id="tin">');mk('iv','<input id="iin">');
 const n=document.getElementById('nin');if(n)n.addEventListener('input',()=>{const o=document.getElementById('opts');o.innerHTML='';Object.values(countries).filter(c=>n.value&&c.toLowerCase().startsWith(n.value.toLowerCase())).forEach(c=>{const li=document.createElement('li');li.setAttribute('role','option');li.textContent=c;li.onclick=()=>{n.value=c;o.style.display='none'};o.appendChild(li)});o.style.display='block'});
};</script></body>`;
const plan=()=>{const rows=[{room:'0415',name:'Zed Fakeperson',arrival:'11/24/2026',noNat:true,noSex:true,noPass:true,suggestedSex:'F'}],list=[{room:'415',name:'Zed Fakeperson',nat:'Ethiopia',doc:'784199012345678'}];const p=C.buildPlan(rows,list,{hotel:'Test Hotel',uaeIdType:'RES'}),a={};a[p.items[0].id]={gender:true,nationality:true,idType:true,idNumber:true};return C.encodePlan(p,a);};
(async()=>{const executablePath=[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p)),browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
try{
 const run=async(name,filled,dry,body)=>{const page=await browser.newPage({viewport:{width:1200,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent(page_html(name,filled));await page.addScriptTag({content:fixer});
  const T=()=>page.evaluate(()=>window.__hoFixer._test);
  await page.evaluate(([code,dry])=>{const t=window.__hoFixer._test;t.setPlan(t.decode(code));t.setDry(dry);t.st.cur=t.st.plan.items[0]},[plan(),dry]);
  const out=await body(page);assert.deepEqual(errors,[]);await page.close();return out;};
 // 1 dry run: nothing typed, nothing clicked
 await run('Mr. Zed Fakeperson',{},true,async page=>{await page.evaluate(()=>window.__hoFixer._test.fill(window.__hoFixer._test.st.cur));
  assert.equal(await page.evaluate(()=>window.__clicks.length),0,'dry run must not click');assert.equal(await page.locator('#nin').count(),0);
  assert((await page.evaluate(()=>window.__hoFixer._test.st.log.map(e=>e.result))).every(r=>/dry run/.test(r)));});
 // 2 real fill: Edit pressed, empty fields filled, Save never pressed
 await run('Mr. Zed Fakeperson',{},false,async page=>{await page.evaluate(()=>window.__hoFixer._test.fill(window.__hoFixer._test.st.cur));
  assert.equal(await page.locator('#gv select').inputValue(),'F');assert.equal(await page.locator('#nin').inputValue(),'ET Ethiopia');
  assert.equal(await page.locator('#tin').inputValue(),'RES');assert.equal(await page.locator('#iin').inputValue(),'784199012345678');
  assert.equal(await page.evaluate(()=>window.__saved),false,'Save must never be pressed');
  const clicks=await page.evaluate(()=>window.__clicks);assert(!clicks.includes('Save')&&!clicks.includes('Cancel'));assert.equal(await page.locator('#hn').textContent(),'—','the header copy of Nationality is never edited');
  const log=await page.evaluate(()=>JSON.stringify(window.__hoFixer._test.st.log));assert(!/784199012345678/.test(log),'log must keep ID numbers as last 4 only');assert(/••••5678/.test(log));assert(!/Fakeperson/.test(log),'log must not hold names');});
 // 3 already filled fields are never touched
 await run('Mr. Zed Fakeperson',{gender:'M',nat:'OM Oman',type:'PAS',num:'XXXXXXX69'},false,async page=>{await page.evaluate(()=>window.__hoFixer._test.fill(window.__hoFixer._test.st.cur));
  assert.equal(await page.locator('#gv').textContent(),'M');assert.equal(await page.locator('#nv').textContent(),'OM Oman');assert.equal(await page.locator('#iv').textContent(),'XXXXXXX69');assert.equal(await page.locator('#nin').count(),0);assert.equal(await page.evaluate(()=>window.__saved),false);});
 // 4 wrong guest on screen: refused, nothing changed
 await run('Mr. Someone Else',{},false,async page=>{await page.evaluate(()=>window.__hoFixer._test.fill(window.__hoFixer._test.st.cur));
  assert.equal(await page.evaluate(()=>window.__clicks.length),0);assert.equal(await page.locator('#nin').count(),0);assert((await page.evaluate(()=>window.__hoFixer._test.st.log.map(e=>e.result))).every(r=>/refused/.test(r)));});
 // 5 the hard click refusal
 await run('Mr. Zed Fakeperson',{},false,async page=>{const r=await page.evaluate(()=>{try{window.__hoFixer._test.safeClick(document.getElementById('save'));return 'clicked'}catch(e){return e.message}});assert(/Refused/.test(r));assert.equal(await page.evaluate(()=>window.__saved),false);});
 console.log('Opera fixer passed on a mock profile: dry run types nothing, fills only empty gender/nationality/ID, keeps filled fields, refuses the wrong guest, never presses Save, logs last 4 only and no names.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});

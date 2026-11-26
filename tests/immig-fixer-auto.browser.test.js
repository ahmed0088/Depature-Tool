'use strict';
// Mock Opera (FAKE guests only): In House list -> reservation -> guest name -> Manage Profile -> Identification.
// The auto fixer must open each guest itself, fill only the empty gender, never press Save, and never touch another room.
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core'),C=require('../immig-fixer-core.js');
const fixer=fs.readFileSync(__dirname+'/../tools/hotelops-opera-fixer.console.js','utf8');
const html=`<!doctype html><body style="font:14px sans-serif"><div id="crumb"><a href="#" id="bc" onclick="go('list');return false">In House</a></div><div id="app"></div>
<script>
window.__saved=false;window.__clicks=[];window.__opened=[];
const guests={ '0301':{conf:'1234567',name:'Zed Fakeperson',title:'Mr',gender:''}, '0302':{conf:'7654321',name:'Amy Notreal',title:'Ms',gender:'F'} };
let cur=null;
function go(v,room){const a=document.getElementById('app');
 if(v==='list'){a.innerHTML='<div id="sp"><label for="rin">Room</label><input id="rin"><button id="sb">Search</button></div><table id="t"><thead><tr><th>Confirmation Number</th><th>Room</th><th>Name</th></tr></thead><tbody id="tb"></tbody></table>';
  document.getElementById('sb').onclick=()=>{const q=document.getElementById('rin').value.replace(/^0+/,'');document.getElementById('tb').innerHTML=Object.keys(guests).filter(r=>!q||r.replace(/^0+/,'')===q).map(r=>'<tr><td><a href="#" class="cf" data-r="'+r+'">'+guests[r].conf+'</a></td><td>'+r+'</td><td>'+guests[r].name+'</td></tr>').join('');
   document.querySelectorAll('.cf').forEach(l=>l.onclick=e=>{e.preventDefault();go('res',l.dataset.r)});};}
 if(v==='res'){cur=room;window.__opened.push(room);a.innerHTML='<h3>Manage Reservation</h3><a href="#" id="gn">'+guests[room].title+' '+guests[room].name+'</a>';document.getElementById('gn').onclick=e=>{e.preventDefault();go('prof',room)};}
 if(v==='prof'){a.innerHTML='<h3>Manage Profile</h3><ul><li><a href="#" id="ov">Overview</a></li><li><a href="#" id="idm">Identification</a></li></ul><h2>'+guests[room].title+' '+guests[room].name+'</h2><div id="pg"></div>';document.getElementById('idm').onclick=e=>{e.preventDefault();go('id',room)};}
 if(v==='id'){const g=guests[room];a.innerHTML='<h3>Manage Profile</h3><h2>'+g.title+' '+g.name+'</h2><section><h3>Personal Details</h3><a href="#" id="edit">Edit</a><div><label for="gin">Gender</label><span id="gv">'+(g.gender||'—')+'</span></div><div><label for="nin">Nationality</label><span>GH Ghana</span></div></section><button id="save">Save</button>';
  document.getElementById('save').onclick=()=>{window.__saved=true};
  document.getElementById('edit').onclick=e=>{e.preventDefault();const s=document.getElementById('gv');if(s.textContent.trim()==='—')s.innerHTML='<select id="gin"><option value=""></option><option value="M">M</option><option value="F">F</option></select>';};}
}
document.addEventListener('click',e=>window.__clicks.push((e.target.textContent||'').trim().slice(0,14)),true);
go('list');
</script></body>`;
const plan=()=>{const rows=[{room:'0301',name:'Zed Fakeperson',arrival:'11/23/2026',noSex:true,suggestedSex:'M'},{room:'0302',name:'Amy Notreal',arrival:'11/23/2026',noSex:true,suggestedSex:'F'}];const p=C.buildPlan(rows,[],{hotel:'Test'});const ok={};p.items.forEach(i=>{ok[i.id]={gender:true}});return C.encodePlan(p,ok,{origin:''});};
(async()=>{const executablePath=[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p)),browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
try{
 const run=async(dry,body)=>{const page=await browser.newPage({viewport:{width:1100,height:700}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent(html);await page.addScriptTag({content:fixer});
  await page.evaluate(([code,dry])=>{const t=window.__hoFixer._test;t.setPlan(t.decode(code));t.setDry(dry)},[plan(),dry]);
  await body(page);assert.deepEqual(errors,[]);await page.close();};
 // dry run: visits both guests, types nothing, saves nothing
 await run(true,async page=>{await page.evaluate(()=>window.__hoFixer._test.autoRun(0));
  assert.deepEqual(await page.evaluate(()=>window.__opened),['0301','0302']);
  assert.equal(await page.locator('#gin').count(),0,'dry run types nothing');assert.equal(await page.evaluate(()=>window.__saved),false);});
 // real: opens 0301 by itself, fills gender M, pauses, never Save
 await run(false,async page=>{await page.evaluate(()=>window.__hoFixer._test.autoRun(0));
  assert.deepEqual(await page.evaluate(()=>window.__opened),['0301'],'pauses after the first guest');
  assert.equal(await page.locator('#gin').inputValue(),'M');assert.equal(await page.evaluate(()=>window.__saved),false,'Save must never be pressed');
  assert(!(await page.evaluate(()=>window.__clicks)).some(c=>/^save$/i.test(c)));
  assert.equal(await page.evaluate(()=>window.__hoFixer._test.st.paused),true);});
 // wrong guest in the plan: nothing opens
 const page=await browser.newPage();await page.setContent(html);await page.addScriptTag({content:fixer});
 const why=await page.evaluate(()=>window.__hoFixer._test.goToGuest({room:'0301',name:'Somebody Else'}));
 assert(/no row with this guest/.test(why),why);assert.deepEqual(await page.evaluate(()=>window.__opened),[]);await page.close();
 console.log('Auto fixer passed on a mock Opera: opens guests itself, fills only empty gender, never saves, refuses a wrong name.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});

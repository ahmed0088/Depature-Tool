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
   document.querySelectorAll('.cf').forEach(l=>l.onclick=e=>{e.preventDefault();window.__clicks.push('CONF');setTimeout(()=>go('res',l.dataset.r),900)});};}
 if(v==='res'){cur=room;window.__opened.push(room);a.innerHTML='<h3>Manage Reservation</h3><a href="#" id="bk" onclick="go(&quot;list&quot;);return false">Back to In House</a><div>Reservation Overview</div><a href="#" id="gn">'+guests[room].title+' '+guests[room].name+'</a>';document.getElementById('gn').onclick=e=>{e.preventDefault();window.__clicks.push('NAME');setTimeout(()=>go('prof',room),700)};}
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
 // real: opens 0301 by itself, fills gender M, presses Save once, goes on by itself (no Next guest click)
 await run(false,async page=>{await page.evaluate(()=>window.__hoFixer._test.autoRun(0));
  assert.deepEqual(await page.evaluate(()=>window.__opened),['0301','0302'],'continues to the next guest by itself');
  assert.equal(await page.evaluate(()=>window.__saved),true,'Save pressed after filling');
  assert.equal((await page.evaluate(()=>window.__clicks)).filter(c=>/^save$/i.test(c)).length,1,'Save pressed once, for the filled guest only');
  assert.equal(await page.evaluate(()=>window.__hoFixer._test.st.paused),false);});
 // wrong guest in the plan: nothing opens
 const page=await browser.newPage();await page.setContent(html);await page.addScriptTag({content:fixer});
 const why=await page.evaluate(()=>window.__hoFixer._test.goToGuest({room:'0301',name:'Somebody Else'}));
 assert(/name was not found/.test(why),why);assert.deepEqual(await page.evaluate(()=>window.__clicks.filter(c=>c==='NAME')),[],'never opens a profile for the wrong name');await page.close();
 // room not in the In House list: skipped with a clear message, not a failure of the whole run
 {const page=await browser.newPage();await page.setContent(html);await page.addScriptTag({content:fixer});
 const why=await page.evaluate(()=>window.__hoFixer._test.goToGuest({room:'0106',name:'Nobody Here'}));
 assert(/not found in the In House list/.test(why)&&!/In House list did not open/.test(why),why);await page.close();}
 // the guest name is clicked only after the reservation page loaded (the reservation renders 900 ms after the click), and the way back is Back to In House
 {const page=await browser.newPage();await page.setContent(html);await page.addScriptTag({content:fixer});
 const why=await page.evaluate(()=>window.__hoFixer._test.goToGuest({room:'0301',name:'Zed Fakeperson'}));assert.equal(why,'',why);
 const cl=await page.evaluate(()=>window.__clicks);assert(cl.indexOf('CONF')>=0&&cl.indexOf('NAME')>cl.indexOf('CONF'),JSON.stringify(cl));
 assert.deepEqual(await page.evaluate(()=>window.__opened),['0301']);await page.close();}
 // Opera collapses the Search panel after a search: a room with no row must expand it again for the 2nd try, and the run goes on
 {const page=await browser.newPage();await page.setContent(html.replace("document.getElementById('sb').onclick=()=>{","document.getElementById('sb').onclick=()=>{setTimeout(()=>{const sp=document.getElementById('sp');if(sp){sp.style.display='none';if(!document.getElementById('mod')){const b=document.createElement('button');b.id='mod';b.textContent='Modify Search Criteria';b.onclick=()=>{sp.style.display='';b.remove()};document.body.prepend(b)}}},50);"));await page.addScriptTag({content:fixer});
 const why=await page.evaluate(()=>window.__hoFixer._test.goToGuest({room:'0106',name:'Nobody Here'}));
 assert(/not found in the In House list/.test(why),why);
 const logs=await page.evaluate(()=>window.__hoFixer._test.st.log.map(e=>e.result).join('\n'));assert(/expanding/.test(logs)&&/no row; filters:/.test(logs),logs);await page.close();}
 // from the dashboard (no In House breadcrumb): opens the Front Desk menu, then In House, by itself
 {const page=await browser.newPage();await page.setContent(html.replace('<div id="crumb"><a href="#" id="bc" onclick="go(\'list\');return false">In House</a></div>','<nav><a href="#" id="fd" role="button" onclick="document.getElementById(\'dd\').style.display=\'block\';return false">Front Desk</a><ul id="dd" style="display:none"><li><a href="#" role="menuitem" onclick="setTimeout(()=>go(\'list\'),600);return false">Arrivals</a></li><li><a href="#" role="menuitem" onclick="setTimeout(()=>go(\'list\'),600);return false">In House</a></li></ul></nav>').replace("go('list');\n</script>","document.getElementById('app').innerHTML='<h2>Dashboard</h2>';\n</script>"));
 await page.addScriptTag({content:fixer});
 const why=await page.evaluate(()=>window.__hoFixer._test.goToGuest({room:'0301',name:'Zed Fakeperson'}));
 assert.equal(why,'','menu navigation should open the guest: '+why);assert.deepEqual(await page.evaluate(()=>window.__opened),['0301']);assert.equal(await page.evaluate(()=>window.__saved),false);await page.close();}
 // nowhere to go: the message names the failed step
 {const page=await browser.newPage();await page.setContent('<body><h2>Dashboard</h2></body>');await page.addScriptTag({content:fixer});
 const why=await page.evaluate(()=>window.__hoFixer._test.goToGuest({room:'0301',name:'Zed Fakeperson'}));
 assert(/In House list did not open \(step: /.test(why),why);await page.close();}
 // nav hidden behind a hamburger "Show Menu" (the real Ibis layout). The dashboard has its own Search / Clear Search / Go box, which must be ignored.
 // The menu search gives a result that does not respond; Site Map shows In House as a link.
 {const page=await browser.newPage();await page.setContent(html.replace('<div id="crumb"><a href="#" id="bc" onclick="go(\'list\');return false">In House</a></div>','<div id="dash"><input id="dsearch" placeholder="Search"><a href="#" onclick="return false">Clear Search</a> <button>Go</button></div><a href="#" id="pt1:oc_pg_pt:ode_pg_sdbr_" aria-label="Show Menu" style="position:absolute;left:4px;top:4px;width:40px;height:30px" onclick="document.getElementById(\'pn\').style.display=\'block\';return false">=</a><div id="pn" style="display:none;margin-top:60px"><input id="ms" placeholder="Search"><ul id="rs"></ul><a href="#" id="smap" onclick="setTimeout(function(){document.getElementById(\'sml\').style.display=\'block\'},400);return false">Site Map</a><ul id="sml" style="display:none"><li><a href="#" onclick="go(&quot;list&quot;);return false">In House</a></li></ul></div>').replace("go('list');\n</script>","document.getElementById('app').innerHTML='<h2>Dashboard</h2>';\n</script>"));
 await page.addScriptTag({content:fixer});
 const why=await page.evaluate(()=>window.__hoFixer._test.goToGuest({room:'0301',name:'Zed Fakeperson'}));
 assert.equal(why,'','hamburger navigation should open the guest: '+why);assert.deepEqual(await page.evaluate(()=>window.__opened),['0301']);assert.equal(await page.evaluate(()=>window.__saved),false);
 assert.equal(await page.inputValue('#dsearch'),'','must not type into the dashboard search box');
 const lg=await page.evaluate(()=>window.__hoFixer._test.st.log.map(e=>e.result).join('\n'));assert(/hamburger <a#/.test(lg)&&/Site Map/.test(lg),lg);
 // second guest, from the profile page of the first: a dead In House breadcrumb sits on the page, it must use the menu search instead
 await page.evaluate(()=>{const b=document.createElement('div');b.innerHTML='<a href="#" id="deadcrumb" onclick="return false">In House</a>';document.body.prepend(b)});
 const why2=await page.evaluate(()=>window.__hoFixer._test.goToGuest({room:'0302',name:'Amy Notreal'}));
 assert.equal(why2,'','second guest from a profile page: '+why2);assert.deepEqual(await page.evaluate(()=>window.__opened),['0301','0302']);
 const logs=await page.evaluate(()=>window.__hoFixer._test.st.log.map(e=>e.result).join('\n'));assert(/rows found: 1/.test(logs)&&/clicking guest name/.test(logs)&&/profile opened/.test(logs),logs);
 await page.close();}
 // regression (v642): a result row with role=row wrappers inside must still be found as the real <tr> that holds the confirmation link
 {const page=await browser.newPage();await page.setContent('<table><tbody><tr role="row"><td><a href="#" id="cl">1234567</a></td><td><div role="row">0111</div></td><td>Zed Fakeperson</td></tr></tbody></table>');await page.addScriptTag({content:fixer});
  const r=await page.evaluate(()=>{const t=window.__hoFixer._test;const a=t.roomRows({room:'0111',name:'Zed Fakeperson'}),b=t.roomRows({room:'0111',name:'Other Person'},true);return [a.length,!!a[0].querySelector('a'),b.length]});
  assert.deepEqual(r,[1,true,1],'row detection must match the v640 behaviour: '+r);await page.close();}
 console.log('Auto fixer passed on a mock Opera: opens guests itself, fills only empty gender, never saves, refuses a wrong name.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});

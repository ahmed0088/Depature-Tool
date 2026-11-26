'use strict';
// The "Enrol guests" list with its open Review details panel (fake guest) must fit at every window width:
// the name stays readable, the panel sits under the row and nothing is cut off on the right.
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
const css=['styles.css','pro.css'].map(n=>fs.readFileSync(__dirname+'/../'+n,'utf8')).join('\n');
const row=`<div class="gq-row on"><label class="gq-yes"><input type="checkbox" checked><span>Agreed</span></label><div class="gq-who"><b>Fake Guestone Examplename</b><small>Room 101 · fake.guest@example.com · 📞 · Kenya</small></div><button type="button" class="gq-title name">Mr<small>from name</small></button>
<details class="gq-edit" open><summary>Review details</summary><p>Use the actual guest details. Changing the name or email clears Agreed for rechecking.</p><div class="gq-edit-fields"><label><span>Guest name</span><input value="Fake Guestone Examplename"></label><label><span>Personal email</span><input value="fake.guest.with.a.long.address@example.com"></label><label><span>Country</span><input value="Kenya"></label><label><span>Phone</span><input value="971500000000"></label></div><button class="btn">Save details</button></details></div>`;
const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="gpQuick" class="gp-accor-modal on"><div class="gp-accor-modal-bg"></div><section class="gp-accor-modal-card gq-card"><header class="gp-accor-modal-h"><b>Enrol guests</b></header><div class="gp-accor-modal-b" id="gqBody"><div class="gq-list">${row}${row.replace('Fake Guestone','Fake Guesttwo').replace(' open','')}</div></div></section></div>`;
(async()=>{const executablePath=[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p)),browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
try{for(const w of [360,390,480,566,600,601,640,700,820,1024,1280]){
  const page=await browser.newPage({viewport:{width:w,height:900},serviceWorkers:'block'});await page.setContent(html);await page.waitForTimeout(150);
  const m=await page.evaluate(()=>{const q=s=>document.querySelector(s),r=e=>e.getBoundingClientRect(),card=r(q('.gq-card')),body=q('.gp-accor-modal-b'),rows=[...document.querySelectorAll('.gq-row')];
    return rows.map(row=>{const rr=r(row),who=r(row.querySelector('.gq-who')),yes=r(row.querySelector('.gq-yes')),ed=r(row.querySelector('.gq-edit')),sum=r(row.querySelector('.gq-edit summary'));
      const inputs=[...row.querySelectorAll('.gq-edit input')].map(r);
      return {card:card.right,rowRight:rr.right,rowTop:rr.top,rowH:rr.height,whoW:who.width,whoRight:who.right,yesBottom:yes.bottom,edTop:ed.top,edRight:ed.right,sumTop:sum.top,inputsRight:Math.max(0,...inputs.map(i=>i.right)),sw:body.scrollWidth,cw:body.clientWidth};});});
  const label='width '+w;if(process.env.SHOT&&w===+process.env.SHOT)await page.screenshot({path:process.env.SHOTFILE||'/tmp/shot.png'});
  m.forEach((x,i)=>{assert(x.whoW>=60,label+': guest name squeezed to '+x.whoW+'px');assert(x.edRight<=x.rowRight+1,label+': details panel sticks out of the row');assert(x.inputsRight<=x.card+0.5,label+': fields cut off at the right');assert(x.sw<=x.cw+1,label+': sideways scroll '+x.sw+'>'+x.cw);assert(x.sumTop>=Math.min(x.yesBottom,x.rowTop+60)-1&&x.sumTop>x.rowTop+30,label+': details are not on their own line under the guest');});
  await page.close();}
 console.log('Enrol guests rows fit from 360px to 1280px: name readable, Review details under the row, nothing clipped.');
}finally{await browser.close();}})().catch(e=>{console.error(e.message);process.exit(1)});

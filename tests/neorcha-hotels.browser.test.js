'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
(async()=>{
 const browser=await chromium.launch({executablePath:[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p)),headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--card:#fff;--bg:#f7f8fc;--bg2:#f0f2f8;--text:#202535;--text2:#657086;--text3:#657086;--border:#dce0ea;--border2:#c5cddd;--accent:#4f67e8}*{box-sizing:border-box}body{margin:0;padding:12px;font:14px Arial;background:var(--bg);color:var(--text)}nav{display:none}.btn{padding:10px 12px;border:1px solid var(--border);background:var(--card);color:var(--text);border-radius:8px;font:inherit}[hidden]{display:none!important}input,select{min-width:0}</style><nav class="sidenav"></nav><main class="main"></main>');
  await page.evaluate(()=>{
   const store={ho_neorcha_hotels_v1:JSON.stringify([{name:'Mercure',url:'https://mercure.myneorcha.com/neorchaWEBPlatform/#/login',acct:'MERCURE'}]),'ho_neorcha_sel_v1:ibis styles dubai deira':'0'};
   Object.defineProperty(window,'localStorage',{value:{getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=String(v),removeItem:k=>delete store[k]}});
   window._meHotel=()=> 'Ibis Styles Dubai Deira';window.fbListen=(p,fn)=>{(window.listeners||={})[p]=fn};window.fbSet=()=>{};window.showToast=()=>{};window.HOTEL_ID='example';
  });
  await page.addScriptTag({content:fs.readFileSync('neorcha.js','utf8')});
  assert.equal(await page.locator('#nx-url').inputValue(),'https://mercure.myneorcha.com/tweak/');assert.match(await page.locator('#nx-reader').innerText(),/Tweak/);
  let cfg=await page.evaluate(()=>__hoNxCloud());assert.equal(cfg.account,'MERCURE');assert.equal(cfg.hotel_name,'Mercure');assert.equal(cfg.url,'https://mercure.myneorcha.com/tweak/');assert.equal(cfg.hid,'example');
  // An explicit legacy link for a hotel that has not migrated remains available.
  await page.locator('#nx-h-ed').click();await page.locator('#nx-url').fill('https://adagio.myneorcha.com/neorchaWEBPlatform/#/login');
  // Native blur saves the edited link during the next button's pointer-down.
  await page.locator('[data-hadd]').click();assert.deepEqual(errors,[]);assert.equal(await page.locator('#nx-hadd').evaluate(el=>el.hidden),false,'saving a link must not swallow Add hotel');assert.match(await page.locator('#nx-reader').innerText(),/Legacy/);cfg=await page.evaluate(()=>__hoNxCloud());assert.equal(cfg.account,'ADAGIO');assert(cfg.url.includes('neorchaWEBPlatform'));
  await page.locator('#nx-hb').selectOption('mercure');assert.equal(await page.locator('#nx-hurl').inputValue(),'https://mercure.myneorcha.com/tweak/');await page.locator('#nx-hname').fill('Mercure Dubai Deira');await page.locator('#nx-hok').click();cfg=await page.evaluate(()=>__hoNxCloud());assert.equal(cfg.hotel_name,'Mercure Dubai Deira');assert.equal(cfg.account,'MERCURE');assert.equal(cfg.url,'https://mercure.myneorcha.com/tweak/');
  await page.locator('#nx-contacts').click();cfg=await page.evaluate(()=>__hoNxCloud());assert(JSON.parse(cfg.fields).includes('Email'));assert(!JSON.parse(cfg.fields).includes('Purpose Of Visit'));
  await page.locator('#nx-today').click();assert.equal(await page.locator('#nx-from').inputValue(),await page.locator('#nx-to').inputValue());
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'hotel controls fit phone');assert.deepEqual(errors,[]);
  console.log('Neorcha hotel phone checks passed: saved Mercure migration, scoped cloud account, new Mercure link, exact property name, legacy Adagio, selected fields and day filter. No external calls.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});

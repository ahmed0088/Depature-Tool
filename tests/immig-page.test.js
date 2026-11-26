'use strict';
// Immigration Check page: two inputs only (Vicas Inhouse XML and Opera Immigration XML), steps visible, styles loaded.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const panel=html.slice(html.indexOf('<div class="panel" id="panel-immig">'),html.indexOf('<!-- ═',html.indexOf('id="panel-immig"')+10));
test('only the two report inputs are on the page',()=>{
  const files=[...panel.matchAll(/type="file" id="([^"]+)"/g)].map(m=>m[1]).sort();
  assert.deepEqual(files,['immigFileInput2','immigInhouseXmlInput']);
  assert(!/Arrivals Export|Res\. Detail|immigArrivals|immigResDetail/.test(panel),'no wording or ids for the removed inputs');
  assert(/imm-steps/.test(panel)&&/Vicas Inhouse XML/.test(panel)&&/Opera Immigration XML/.test(panel));
});
test('page styles are linked and cached',()=>{
  assert(/<link rel="stylesheet" href="immig-page\.css"\/>/.test(html));assert(/'\.\/immig-page\.css'/.test(fs.readFileSync(__dirname+'/../sw.js','utf8')));
  assert(!/immigArr|immigRes\b/.test(fs.readFileSync(__dirname+'/../file-router.js','utf8')),'file router no longer routes the removed inputs');
});

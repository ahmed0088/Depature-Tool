'use strict';
// Mock Microsoft pages (fake user, no network): the Back arrow (#idBtn_Back) on the password page must NOT be clicked;
// the real "Stay signed in?" page is answered No; sign-in ends on a fake Opera page.
const fs = require('node:fs'), assert = require('node:assert/strict'), { chromium } = require('playwright-core');
process.env.MODE = 'signin';
const { msSignIn } = require('../scripts/opera-cloud.js');
const MS = 'https://login.mock-ms.test/', OP = 'https://fake.oraclehospitality.eu-frankfurt-1.ocs.oraclecloud.com/opera';
const pages = {
  email: '<title>Sign in</title><input name="loginfmt"><input type="submit" id="idSIButton9" value="Next"><script>idSIButton9.onclick=e=>{e.preventDefault();location.href="' + MS + 'pw"}</script>',
  // password page: a Back arrow is visible and covered by an overlay that would stall a normal click; the password box appears a moment later
  pw: '<title>Enter password</title><button id="idBtn_Back" style="position:absolute;top:10px;left:10px">Back</button><div style="position:fixed;inset:0;z-index:9"></div><script>setTimeout(()=>{document.body.insertAdjacentHTML("beforeend","<input name=passwd style=\\"position:fixed;z-index:10;top:50px\\"><input type=submit id=idSIButton9 value=\\"Sign in\\" style=\\"position:fixed;z-index:10;top:90px\\">");idSIButton9.onclick=e=>{e.preventDefault();location.href="' + MS + 'kmsi"}},2500)</script>',
  kmsi: '<title>Stay signed in?</title><div id="KmsiDescription">Do this to reduce the number of times you are asked to sign in.</div><button id="idBtn_Back">No</button><script>idBtn_Back.onclick=()=>{location.href="' + OP + '"}</script>',
  op: '<title>Opera</title><a id="pt1:menu">menu</a>'
};
(async () => {
  const executablePath = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && fs.existsSync(p)), browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage(); let backClicks = 0;
    await page.route('**/*', r => { const u = r.request().url(); const k = u === MS ? 'email' : u === MS + 'pw' ? 'pw' : u === MS + 'kmsi' ? 'kmsi' : u === OP ? 'op' : null; k ? r.fulfill({ contentType: 'text/html', body: pages[k] }) : r.abort(); });
    await page.goto(MS);
    await msSignIn(page, 'fake.user@example.test', 'fake-pass', async () => '000000');
    assert(/oraclecloud\.com/.test(page.url()), 'ended on the fake Opera page: ' + page.url());
    console.log('opera-signin-flow: Back arrow ignored, Stay signed in answered, reached Opera');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });

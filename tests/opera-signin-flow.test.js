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
const pages2 = Object.assign({}, pages, {
  // after the email, Microsoft shows the passkey prompt: only "Cancel" and a "Sign-in options" link; the picker then offers the password
  pw: '<title>Face, fingerprint, PIN or security key</title><p>Follow the instructions on your device</p><button id="idBtn_Back">Cancel</button><a href="#" id="so">Sign-in options</a><script>so.onclick=e=>{e.preventDefault();location.href="' + MS + 'pick"}</script>',
  pick: '<title>Sign in</title><h1>How do you want to sign in?</h1><div role="button" id="pwopt">Use your password</div><div role="button">Use a passkey</div><script>pwopt.onclick=()=>{location.href="' + MS + 'pw2"}</script>',
  pw2: pages.pw
});
(async () => {
  const executablePath = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && fs.existsSync(p)), browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage(); let backClicks = 0;
    await page.route('**/*', r => { const u = r.request().url(); const k = u === MS ? 'email' : u === MS + 'pw' ? 'pw' : u === MS + 'kmsi' ? 'kmsi' : u === OP ? 'op' : null; k ? r.fulfill({ contentType: 'text/html', body: pages[k] }) : r.abort(); });
    await page.goto(MS);
    await msSignIn(page, 'fake.user@example.test', 'fake-pass', async () => '000000');
    assert(/oraclecloud\.com/.test(page.url()), 'ended on the fake Opera page: ' + page.url());
    // scenario 2: the passkey prompt appears after the email
    const p2 = await browser.newPage();
    await p2.route('**/*', r => { const u = r.request().url(); const k = u === MS ? 'email' : u === MS + 'pw' ? 'pw' : u === MS + 'pick' ? 'pick' : u === MS + 'pw2' ? 'pw2' : u === MS + 'kmsi' ? 'kmsi' : u === OP ? 'op' : null; k ? r.fulfill({ contentType: 'text/html', body: pages2[k] }) : r.abort(); });
    await p2.goto(MS);
    await msSignIn(p2, 'fake.user@example.test', 'fake-pass', async () => '000000');
    assert(/oraclecloud\.com/.test(p2.url()), 'passkey prompt handled, ended on the fake Opera page: ' + p2.url());
    // scenario 3: a page nobody planned for: the run must THROW with the page labels (so HotelOps can show the reason), not exit silently
    const p3 = await browser.newPage(); await p3.route('**/*', r => r.fulfill({ contentType: 'text/html', body: '<title>Something new</title><button id="zz">Mystery</button>' }));
    await p3.goto(MS); const saved = process.exit; let exited = false; process.exit = () => { exited = true; };
    let err = null; try { await msSignIn(p3, 'x@example.test', 'y', async () => '000000'); } catch (e) { err = e; }
    process.exit = saved; assert(!exited, 'does not exit the process silently'); assert(err && /did not finish.*Something new.*Mystery/.test(err.message), 'throws with the page labels: ' + (err && err.message));
    console.log('opera-signin-flow: Back arrow ignored, Stay signed in answered, reached Opera');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });

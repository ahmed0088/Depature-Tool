// Synthetic microphone tests: no device permissions, Firebase or guest data.
// Run with: node tests/chat-mobile.test.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'team-chat.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(mode = '') {
  let now = 10000, stopped = 0, requests = 0, grant, reject, recorder;
  const writes = [], timers = [], notices = [];
  const stream = { getTracks: () => [{ stop: () => stopped++ }] };
  const sb = {
    console, Blob, Date: class extends Date { static now() { return now; } },
    currentUser: { uid: 'synthetic-user' }, currentProfile: { name: 'Synthetic', role: 'agent' }, HOTEL_ID: 'synthetic-hotel',
    document: { readyState: 'loading', addEventListener() {}, getElementById: () => null, querySelectorAll: () => [], documentElement: { classList: { remove() {} } } },
    addEventListener() {}, scrollTo() {},
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    showToast: m => notices.push(m),
    fbSet: async (p, v) => { writes.push({ p, v }); }, fbUpdate: async () => {},
    navigator: { mediaDevices: { getUserMedia() { requests++; return new Promise((ok, no) => { grant = () => ok(stream); reject = no; }); } } },
    FileReader: class { readAsDataURL(blob) { blob.arrayBuffer().then(buffer => { this.result = 'data:' + blob.type + ';base64,' + Buffer.from(buffer).toString('base64'); this.onload(); }); } },
    MediaRecorder: class {
      static isTypeSupported(t) { return t === 'audio/mp4'; }
      constructor(s, options) { if (mode === 'constructor-error') throw Error('unsupported'); this.mimeType = options.mimeType; this.state = 'inactive'; recorder = this; }
      start() { if (mode === 'start-error') throw Error('busy'); this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['synthetic sound'], { type: this.mimeType }) }); this.onstop(); }
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  // Expose only inside the test VM; production keeps its existing public API.
  vm.runInContext(source.replace('W.hoTeamChat = {', 'W.chatTest = { voice, cancelVoice, close, state: S, recording: () => REC }; W.hoTeamChat = {'), sb);
  const api = sb.chatTest; api.state.open = true; api.state.cur = 'team';
  return { api, writes, notices, timers, grant: () => grant(), reject: () => reject(Error('denied')), advance: () => { now += 2000; }, stopped: () => stopped, requests: () => requests, recorder: () => recorder };
}
(async () => {
  let h = harness(), pending = h.api.voice();
  await h.api.voice(); assert.equal(h.requests(), 1, 'double tap must not request two streams');
  h.api.close(); h.grant(); await pending;
  assert.equal(h.stopped(), 1, 'close while permission is pending releases the eventual stream');
  assert.equal(h.writes.length, 0, 'closing never sends the pending recording');

  h = harness(); pending = h.api.voice(); h.reject(); await pending;
  assert.equal(h.api.recording(), null, 'permission failure restores the composer');

  for (const mode of ['constructor-error', 'start-error']) {
    h = harness(mode); pending = h.api.voice(); h.grant(); await pending;
    assert.equal(h.stopped(), 1, mode + ' releases microphone'); assert.equal(h.api.recording(), null);
  }

  h = harness(); pending = h.api.voice(); h.grant(); await pending; h.advance();
  h.api.cancelVoice(); await flush();
  assert.equal(h.writes.length, 0, 'cancel discards voice'); assert.equal(h.api.recording(), null);

  h = harness(); pending = h.api.voice(); h.grant(); await pending; h.advance();
  h.api.close(); await flush();
  assert.equal(h.writes.length, 0, 'close discards voice'); assert(h.stopped() > 0);

  h = harness(); pending = h.api.voice(); h.grant(); await pending; h.advance();
  await h.api.voice(); await flush(); await flush();
  assert(h.writes.some(w => w.p.startsWith('chat/files/')), 'stopping stores the audio');
  assert(h.writes.some(w => w.p.startsWith('chat/msgs/team/') && w.v.file.kind === 'audio'), 'stopping sends to the original chat');

  h = harness(); pending = h.api.voice(); h.grant(); await pending; h.advance();
  await h.api.voice(); h.api.close(); h.api.state.open = true; h.api.state.cur = 'team'; await flush(); await flush();
  assert(!h.writes.some(w => w.p.startsWith('chat/msgs/')), 'close and reopen cannot send an encoding recording');

  h = harness(); pending = h.api.voice(); h.grant(); await pending;
  await h.api.voice(); await flush(); assert.equal(h.writes.length, 0, 'subsecond recording is not sent');

  h = harness(); pending = h.api.voice(); h.grant(); await pending; h.recorder().onerror(); await flush();
  assert.equal(h.api.recording(), null, 'recorder error restores controls'); assert.equal(h.writes.length, 0);

  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /media-src 'self' blob:;/, 'CSP must allow voice blob playback');
  const header = source.slice(source.indexOf('<header class="wc-ch">'), source.indexOf('</header>', source.indexOf('<header class="wc-ch">')));
  assert.match(header, /data-wc="close"/, 'conversation must have its own close button');
  assert.match(source, /#tcPanel\{visibility:hidden\}#tcPanel.on\{visibility:visible\}/, 'closed mobile chat must be hidden');
  console.log('Mobile chat checks passed: close, permission races, recording errors/cancel/send, audio policy and close control.');
})().catch(error => { console.error(error); process.exitCode = 1; });

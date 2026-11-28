'use strict';
const assert = require('node:assert/strict'), { totp, okUrl } = require('../scripts/opera-cloud.js');
// RFC 6238 test vector (SHA-1, key "12345678901234567890" = base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ), 8 digits there, last 6 of them here
assert.equal(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000), '287082');
assert.equal(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1111111109000), '081804');
assert.equal(totp('gezd gnbv gy3t qojq gezd gnbv gy3t qojq', 59000), '287082');
assert(okUrl('https://x.hospitality.oracleindustry.com'.replace('oracleindustry', 'oraclecloud')) && !okUrl('http://a.oraclecloud.com') && !okUrl('https://evil.example/oraclecloud.com'));
console.log('opera-cloud: authenticator code and link checks passed');
// the code path: a fake database; a fresh code is used once and deleted, an old or wrong one is ignored
(async () => {
  const { codeFromHotelOps } = require('../scripts/opera-cloud.js');
  const db = {}; const FB = { get: async p => db[p] || null, put: async (p, v) => { db[p] = v; }, del: async p => { delete db[p]; } };
  db.operaCloudCode = { code: '123456', at: Date.now() - 600000 };   // too old
  setTimeout(() => { db.operaCloudCode = { code: '654321', at: Date.now() }; }, 300);
  const c = await codeFromHotelOps(FB, '');
  assert.equal(c, '654321'); assert.equal(db.operaCloudCode, undefined, 'deleted after use'); assert.equal(db.operaCloudWant, undefined);
  console.log('opera-cloud: code-per-run path passed');
  db.operaCloudCode={code:'123456',at:Date.now(),tag:'other-run'};
  setTimeout(()=>{db.operaCloudCode={code:'234567',at:Date.now(),tag:'this-run'};},300);
  assert.equal(await codeFromHotelOps(FB,'','this-run'),'234567','never consumes another run’s code');
  console.log('opera-cloud: matching run challenge passed');
})();
// privacy cleanup: a fake database + sign-in server; an unused plan is removed, a fresh one is kept when a max age is set, and the public log says nothing about guests
(async () => {
  const http = require('node:http'), { spawnSync } = require('node:child_process'), { once } = require('node:events');
  const store = { 'hotels/h1/operaCloudPlan': { code: 'SYNTHETIC', at: Date.now() - 3600e3, mode: 'audit' }, 'hotels/h1/operaCloudResult': { at: Date.now() - 2 * 864e5, lines: [{ room: '0101' }] } };
  const srv = http.createServer((q, r) => {
    if (q.method === 'POST') { r.setHeader('content-type', 'application/json'); return r.end(JSON.stringify({ idToken: 't', localId: 'u' })); }
    const k = decodeURIComponent(q.url.split('?')[0].replace(/^\//, '').replace(/\.json$/, ''));
    if (q.method === 'DELETE') { delete store[k]; return r.end('null'); }
    if(q.method==='PUT'){let body='';q.on('data',s=>body+=s);q.on('end',()=>{store[k]=JSON.parse(body);r.end(body);});return;}
    r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(store[k] === undefined ? null : store[k]));
  }).listen(0); await once(srv, 'listening');
  const base = 'http://127.0.0.1:' + srv.address().port, env = Object.assign({}, process.env, { MODE: 'cleanup', HOTELOPS_EMAIL: 'a@b.c', HOTELOPS_PASS: 'x', HOTELOPS_HOTEL: 'h1', FB_AUTH_URL: base + '/auth', FB_DB_URL: base });
  const run = extra => new Promise(res => { const c = require('node:child_process').spawn(process.execPath, [require.resolve('../scripts/opera-cloud.js')], { env: Object.assign({}, env, extra) }); let o = ''; c.stdout.on('data', d => o += d); c.on('close', () => res(o)); });
  store['hotels/h1/operaCloudPlan'].at = Date.now();
  let out = await run({ CLEANUP_MAX_MIN: '30' }); assert(store['hotels/h1/operaCloudPlan'], 'a fresh plan is kept by the scheduled cleanup'); assert.equal(store['hotels/h1/operaCloudResult'], undefined, 'old result dropped');
  store['hotels/h1/operaCloudPlan'].at = Date.now() - 3600e3;
  out = await run({ CLEANUP_MAX_MIN: '30' }); assert.equal(store['hotels/h1/operaCloudPlan'], undefined, 'a stale plan is removed');
  store['hotels/h1/operaCloudPlan'] = { code: 'SYNTHETIC', at: Date.now() };
  out = await run({}); assert.equal(store['hotels/h1/operaCloudPlan'], undefined, 'after a run the plan is removed at once');
  for(const key of ['operaCloudPlan','operaCloudCode','operaCloudWant'])store['hotels/h1/'+key]={code:'SYNTHETIC',at:Date.now(),tag:'new-run'};
  out=await run({RUN_TAG:'old-run'});
  for(const key of ['operaCloudPlan','operaCloudCode','operaCloudWant'])assert(store['hotels/h1/'+key],'old cleanup cannot remove another run’s '+key);
  out=await run({RUN_TAG:'new-run'});
  for(const key of ['operaCloudPlan','operaCloudCode','operaCloudWant'])assert.equal(store['hotels/h1/'+key],undefined,'own data is removed: '+key);
  store['hotels/h1/operaCloudPlan']={code:'SYNTHETIC',at:Date.now(),tag:'new-run',mode:'save'};
  out=await run({MODE:'save',RUN_TAG:'old-run',OPERA_URL:'https://fake.oraclecloud.com/opera',OPERA_USER:'synthetic',OPERA_PASS:'synthetic'});
  assert.equal(store['hotels/h1/operaCloudPlan'].tag,'new-run','worker refuses another run’s plan before deleting or opening Opera');
  assert.equal(store['hotels/h1/operaCloudResult'].state,'failed','plan failure is reported privately');
  assert(!/0101|SYNTHETIC/.test(out)); srv.close();
  console.log('opera-cloud: privacy cleanup passed');
})().catch(e => { console.error(e); process.exit(1); });

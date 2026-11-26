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
})();

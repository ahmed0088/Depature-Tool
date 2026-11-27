'use strict';
// The HotelOps start buttons for "Opera fixer (cloud)": signin and audit start from the small buttons; save only from the big button (plan in save mode).
const fs = require('node:fs'), assert = require('node:assert/strict');
const src = fs.readFileSync(__dirname + '/../immig-fixer.js', 'utf8');
const fn = src.slice(src.indexOf('async function startCloud'), src.indexOf('// the authenticator code for the GitHub cloud run'));
assert(fn.includes("if (mode !== 'signin' && mode !== 'audit' && mode !== 'save') return;"), 'other modes are refused');
const calls = [...src.matchAll(/startCloud\('([a-z]+)'\)/g)].map(m => m[1]);
assert.deepEqual(calls.sort(), ['audit', 'save', 'signin'], 'only these starts exist: ' + calls);
const one = src.slice(src.indexOf('async function oneButton'), src.indexOf('// the authenticator code for the GitHub cloud run'));
assert(/sendCloudPlan\(true\)/.test(one) && /startCloud\('save'\)/.test(one), 'the big button sends a save plan and starts save');
assert.equal((src.match(/startCloud\('save'\)/g) || []).length, 1, 'save is started from the big button only');
assert(/Fix in Opera now \(fills empty fields and SAVES\)/.test(src), 'the label says it saves');
assert(/never overwrites a value and never touches folios, postings or cashiering/.test(src), 'the card says what it never does');
assert(/plan\.mode !== 'save'/.test(fn), 'save starts only when the plan was sent in save mode');
assert(/opera-cloud\.yml\/dispatches/.test(src), 'dispatches the Opera fixer workflow');
assert(/limit: mode === 'signin' \? '2' : '0'/.test(src), 'signin touches at most 2 rooms');
assert(/Authorization: 'Bearer ' \+ key/.test(fn) && !/console\.|toast\([^)]*key/.test(fn), 'key only goes to the GitHub header');
console.log('immig-cloud-start: signin/audit small buttons, save only from the big button');

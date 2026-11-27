'use strict';
// The HotelOps start buttons for "Opera fixer (cloud)": only signin or audit can be started, never save.
const fs = require('node:fs'), assert = require('node:assert/strict');
const src = fs.readFileSync(__dirname + '/../immig-fixer.js', 'utf8');
const fn = src.slice(src.indexOf('async function startCloud'), src.indexOf('// the authenticator code for the GitHub cloud run'));
assert(fn.includes("if (mode !== 'signin' && mode !== 'audit') return;"), 'other modes are refused');
const calls = [...src.matchAll(/startCloud\('([a-z]+)'\)/g)].map(m => m[1]);
assert.deepEqual(calls.sort(), ['audit', 'signin'], 'buttons start only signin and audit: ' + calls);
assert(!/startCloud\('save'\)/.test(src), 'no save button');
assert(/opera-cloud\.yml\/dispatches/.test(src), 'dispatches the Opera fixer workflow');
assert(/limit: mode === 'signin' \? '2' : '0'/.test(src), 'signin touches at most 2 rooms');
assert(/Authorization: 'Bearer ' \+ key/.test(fn) && !/console\.|toast\([^)]*key/.test(fn), 'key only goes to the GitHub header');
console.log('immig-cloud-start: only signin and audit can be started from HotelOps');

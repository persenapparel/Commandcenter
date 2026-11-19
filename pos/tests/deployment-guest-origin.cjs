'use strict';
/* Staging-only build assertion. No network, accounts, or live checkout. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'pos-dist/deployment.json'),'utf8'));
const handoff=fs.readFileSync(path.join(root,'pos-dist/handoff-config.js'),'utf8');
assert.equal(manifest.environment,'staging');
assert.equal(typeof manifest.guestEntryUrl,'string');
assert.equal(typeof manifest.guestOrigin,'string');
const guest=new URL(manifest.guestEntryUrl);
assert.equal(guest.protocol,'https:');
assert.equal(guest.pathname,'/pos-guest/');
assert.ok(guest.hostname==='commandcenter-4yg.pages.dev'||guest.hostname.endsWith('.commandcenter-4yg.pages.dev'));
assert.equal(manifest.guestOrigin,guest.origin);
assert.ok(handoff.includes(JSON.stringify(manifest.guestEntryUrl)),'cashier runtime must use manifest guest entry');
assert.doesNotMatch(JSON.stringify(manifest),/sb_secret_|service_role|password|access_token/i);
assert.doesNotMatch(JSON.stringify(manifest),/icxeuhkqxxhdkfdappio/);
console.log('PASS staging deploy manifest and secure cashier-to-guest origin match.');

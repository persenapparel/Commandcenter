'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('cashier staging preview defaults to the PR159 guest preview carrying the CORS fix',()=>{
 const source=fs.readFileSync('pos/build-pages.mjs','utf8');
 assert.match(source,/guestFallback='https:\/\/6ceeb2ad\.commandcenter-4yg\.pages\.dev\/pos-guest\/';/);
 assert.match(source,/secureGuestEntry\(process\.env\.POS_GUEST_ENTRY_URL\|\|guestFallback\)/);
 assert.doesNotMatch(source,/codex-pos-guest-edge-staging\.commandcenter-4yg\.pages\.dev/);
 assert.match(source,/host==='commandcenter-4yg\.pages\.dev'\|\|host\.endsWith\('\.commandcenter-4yg\.pages\.dev'\)/);
});

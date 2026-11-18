'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('cashier staging preview defaults to the verified guest preview carrying framing and CORS fixes',()=>{
 const source=fs.readFileSync('pos/build-pages.mjs','utf8');
 assert.match(source,/guestFallback='https:\/\/7d86da09\.commandcenter-4yg\.pages\.dev\/pos-guest\/';/);
 assert.match(source,/secureGuestEntry\(process\.env\.POS_GUEST_ENTRY_URL\|\|guestFallback\)/);
 assert.doesNotMatch(source,/codex-pos-guest-edge-staging\.commandcenter-4yg\.pages\.dev/);
 assert.match(source,/host==='commandcenter-4yg\.pages\.dev'\|\|host\.endsWith\('\.commandcenter-4yg\.pages\.dev'\)/);
});

/* Static safety regression: one-iPad checkout remains unavailable until
 * a separately authorized, server-backed guest handoff is verified.
 * The owner-practice page is intentionally a zero-write simulator.
 * This is NOT a browser E2E security test.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
const html=read('register.html'),swivel=read('swivel-mode.js');
assert.doesNotMatch(html,/name=["']checkout-device-mode["']|value=["']dual["']/,'Obsolete two-iPad mode selector must be absent');
assert.match(html,/swivel-customer-frame/,'Dormant customer frame placeholder must exist');
assert.match(swivel,/start\.onclick=deny/,'Cashier must not open unverified customer handoff');
assert.match(swivel,/resume\.onclick=deny/,'Cashier resume must deny insecure re-entry');
assert.match(swivel,/frame\.removeAttribute\('src'\)/,'Customer frame must not retain owner-origin content');
assert.doesNotMatch(swivel,/pos_issue_display_pairing/,'Legacy pairing token must not be resurrected');
assert.doesNotMatch(swivel,/\.inert\s*=\s*false/,'Old same-origin handoff must not re-enable owner UI');
const practice=read('practice-checkout.html');
assert.match(practice,/Safe practice version/,'Practice page must advertise simulation only');
assert.match(practice,/DEMO-TEE-L/,'Practice scans accept fake SKU only');
assert.doesNotMatch(practice,/window\.PERSEN_CONFIG|\.from\(|\.rpc\(|fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage/,'Practice UI must not access network, data API or persistent browser storage');
const build=read('build-pages.mjs');
assert.match(build,/'practice-checkout.html'/,'Practice route must be copied to staging build');
console.log('PASS: fail-closed cashier + safe zero-write practice checkout');

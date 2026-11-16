/* Regression guard: single-swivel customer handoff must use a staged
 * server-authorized checkout capability and a distinct customer origin.
 * Source-only assertions, not a substitute for hosted E2E authorization.
 */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname);
const html=fs.readFileSync(path.join(root,'register.html'),'utf8');
const swivel=fs.readFileSync(path.join(root,'swivel-mode.js'),'utf8');
const frame=fs.readFileSync(path.join(root,'isolated-guest-frame.cjs'),'utf8');
assert.doesNotMatch(html,/name=["']checkout-device-mode["']|value=["']dual["']/,'Obsolete two-iPad selector must be absent');
assert.ok(!html.includes('swivel-customer-frame')&&!html.includes('swivel-password'),
 'Retired same-origin frame and password return must stay absent');
for(const id of ['swivel-shift-dialog','swivel-badge','swivel-pin','swivel-guest-host','swivel-return-badge'])
 assert.match(html,new RegExp('id=["\\']'+id+'["\\']'),'Missing secured handoff control: '+id);
assert.match(swivel,/secure\.createIsolatedGuestFrame/,'Customer frame must be created by isolated origin helper');
assert.match(swivel,/api\.secureHandoffClient/,'Handoff must use an approved RPC-only cashier client');
assert.match(swivel,/active\.handToCustomer\(\)/,'Customer flow must begin through server-backed coordinator');
assert.match(swivel,/active\.confirmCustomerCompleted\(\)/,'Customer completion must be server-confirmed');
assert.match(swivel,/bridge\.resumeWithBadge\(badge\)/,'Cashier return must require original badge');
assert.match(swivel,/ownsCheckout:checkoutId=>state\(\)\?\.checkoutId===checkoutId&&state\(\)\?\.phase==='payment'/,
 'Finish Order must stay bound to the secured handoff phase');
assert.match(frame,/event\.origin!==guest\.origin/);
assert.match(frame,/event\.source!==frame\.contentWindow/);
assert.doesNotMatch(frame,/allow-top-navigation|allow-popups|allow-modals/);
assert.doesNotMatch(swivel,/pos_issue_display_pairing|display\.html\?pair=/,
 'Never revive register-wide pairing');
assert.doesNotMatch(swivel,/\.inert\s*=\s*false/,'Do not unlock cashier UI through legacy inert toggles');
console.log('PASS: single-swivel handoff uses staged badge gate, server-backed coordinator and isolated customer origin (source guard only)');

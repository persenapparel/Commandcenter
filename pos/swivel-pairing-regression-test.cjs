/* Regression guard: single-swivel checkout must fail closed until the
 * server-authorized, checkout-bound guest gateway is verified. This is a
 * source-level check; it does NOT certify real iPad checkout or deployment.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname);
const html=fs.readFileSync(path.join(root,'register.html'),'utf8');
const swivel=fs.readFileSync(path.join(root,'swivel-mode.js'),'utf8');
assert.doesNotMatch(html,/name=["']checkout-device-mode["']|value=["']dual["']/,'Obsolete two-iPad selector must be absent');
assert.match(html,/id="swivel-overlay"[^>]*hidden/,'Unused customer overlay must remain hidden');
assert.match(html,/sandbox="allow-scripts allow-forms"/,'Guest iframe must not have same-origin permission');
assert.match(swivel,/start\.onclick=deny/,'Unverified handoff must be denied');
assert.match(swivel,/overlay\.hidden=true/,'Handoff overlay must never be exposed in blocked mode');
assert.match(swivel,/frame\.removeAttribute\('src'\)/,'Guest iframe source must be removed');
assert.doesNotMatch(swivel,/pos_issue_display_pairing|db\.rpc\(/,'Retired register-wide pairing must stay removed');
assert.doesNotMatch(html,/id="swivel-(lock|password|unlock-form|unlock-submit|keep-customer)"/,'Retired cashier password unlock markup must not ship');
console.log('PASS: single-swivel handoff remains gated with no legacy pairing or cashier password unlock');

/* Security regression for the staged customer origin. This test does not
   perform a sale: it proves the deployed guest source cannot inherit the
   cashier browser session and that the cashier bootstraps only an isolated,
   checkout-scoped frame. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const guest=fs.readFileSync('pos-guest/guest.js','utf8');
const headers=fs.readFileSync('pos-guest/_headers','utf8');
const frame=fs.readFileSync('pos/isolated-guest-frame.cjs','utf8');
const register=fs.readFileSync('pos/register.html','utf8');
const swivel=fs.readFileSync('pos/swivel-mode.js','utf8');
assert.match(guest,/const BASE='https:\/\/naaqcspvbntzdtwuchrr\.supabase\.co\/functions\/v1\/pos-guest-checkout'/);
assert.match(guest,/credentials:'omit'/);
assert.match(guest,/referrerPolicy:'no-referrer'/);
assert.match(guest,/event\.source!==window\.parent/);
assert.match(guest,/cashierOrigin\(event\.origin\)/);
assert.match(guest,/window\.parent\.postMessage\(\{type:'persen:checkout-ready:v1'\}/);
assert.doesNotMatch(guest,/localStorage|sessionStorage|document\.cookie|service_role|sb_secret_|SUPABASE_SERVICE_ROLE_KEY/i,
 'Guest source must not persist or contain cashier/server credentials');
assert.match(headers,/Cache-Control: no-store/);
assert.match(headers,/Referrer-Policy: no-referrer/);
assert.match(headers,/connect-src https:\/\/naaqcspvbntzdtwuchrr\.supabase\.co/);
assert.match(headers,/frame-ancestors https:\/\/persen-pos-staging\.pages\.dev https:\/\/\*\.persen-pos-staging\.pages\.dev/);
assert.match(frame,/sandbox','allow-scripts allow-forms allow-same-origin'/);
assert.match(frame,/referrerpolicy','no-referrer'/);
assert.match(frame,/event\.origin!==guest\.origin/);
assert.match(frame,/event\.source!==frame\.contentWindow/);
assert.doesNotMatch(frame,/allow-top-navigation|allow-popups|allow-modals/,
 'Guest frame must not navigate or control its signed-in cashier parent');
assert.ok(!register.includes('id="swivel-customer-frame"')&&!register.includes('display.html?pair='),
 'Retired same-origin customer frame must stay absent');
assert.match(register,/secure-handoff-browser\.js/);
assert.match(register,/handoff-config\.js/);
assert.match(swivel,/secure\.createIsolatedGuestFrame/);
assert.match(swivel,/api\.secureHandoffClient/);
console.log('PASS: isolated customer source has no cashier credentials or storage, CSP restricts framing, and the cashier uses a sandboxed cross-origin bootstrap.');

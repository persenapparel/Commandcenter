/* Regression guard: the single-swivel customer handoff must fail closed until
 * server-authorized checkout-scoped guest isolation is verified.
 * Source-only assertions, NOT browser or PostgreSQL authorization proof.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname);
const html = fs.readFileSync(path.join(root, 'register.html'), 'utf8');
const swivel = fs.readFileSync(path.join(root, 'swivel-mode.js'), 'utf8');
assert.doesNotMatch(html, /name=["']checkout-device-mode["']|value=["']dual["']/, 'Obsolete two-iPad selector must be absent');
assert.match(html, /swivel-customer-frame/, 'Legacy frame must remain identifiable for clearing until removed from markup');
assert.match(swivel, /const blocked=/, 'Handoff must explain why it is unavailable');
assert.match(swivel, /start\.onclick=deny/, 'Customer handoff must be denied');
assert.match(swivel, /resume\.onclick=deny/, 'Cashier resume must be denied');
assert.match(swivel, /overlay\.hidden=true/, 'Customer overlay must stay hidden');
assert.match(swivel, /frame\.removeAttribute\('src'\)/, 'Legacy customer frame source must be removed');
assert.match(swivel, /active:\(\)=>false/, 'Customer mode must remain inactive');
assert.doesNotMatch(swivel, /\.rpc\(['"]pos_issue_display_pairing['"]/, 'Never invoke register-wide pairing');
assert.doesNotMatch(swivel, /\.inert\s*=\s*false/, 'Do not unlock cashier UI through legacy inert toggles');
console.log('PASS: single-swivel handoff fails closed; no pairing or customer frame activation (source guard only)');

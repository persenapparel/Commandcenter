/* Regression guard: one-swivel checkout must not expose legacy pairing UI.
 * This is a focused source/build guard, NOT an end-to-end checkout or security test.
 * Run: node pos/swivel-pairing-regression-test.cjs
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname);
const html = fs.readFileSync(path.join(root, 'register.html'), 'utf8');
const swivel = fs.readFileSync(path.join(root, 'swivel-mode.js'), 'utf8');
assert.doesNotMatch(html, /name=["']checkout-device-mode["']|value=["']dual["']/, 'Obsolete two-iPad mode selector must be absent');
assert.match(html, /swivel-customer-frame/, 'Register must contain the customer iframe');
assert.match(swivel, /swivel-overlay/, 'Swivel mode must manage the customer overlay');
assert.match(swivel, /inert/, 'Swivel mode must lock owner UI during handoff');
assert.match(swivel, /pos_issue_display_pairing/, 'Internal swivel token handoff must remain until a secure replacement is verified');
console.log('PASS: swivel mode and owner-lock wiring present (static guard only)');

'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const page = fs.readFileSync('pos/index.html', 'utf8');
assert.doesNotMatch(page, /const\s+PIN\s*=|sessionStorage\.setItem\([^)]*pin|id="pin-input"/i, 'No hardcoded browser PIN gate');
assert.match(page, /Cloudflare Access/, 'Staging security requirement must be visible');
assert.match(page, /href="register\.html"/, 'Cashier route must remain available');
assert.match(page, /href="admin\.html"/, 'Owner route must remain available');
// The customer checkout route is used by the controlled one-iPad handoff, not
// exposed as a standalone dashboard link. A direct link bypasses the handoff UX.
assert.ok(fs.existsSync('pos/display.html'), 'Customer checkout route must remain available');
assert.doesNotMatch(page, /href=["']display\\.html["']/, 'Do not expose a standalone customer display link from the staging dashboard');
// This is a static route check only. It does NOT certify customer-session isolation,
// iframe origin boundaries, RLS, or a safe checkout. Those need separate tests.
assert.match(page, /href="admin\.html#print-center"/, 'Epson Print Center must be reachable from the POS dashboard');
assert.match(fs.readFileSync('pos/print-station.html', 'utf8'), /old NELKO browser print worker is disabled/, 'Retired print route must be inert');
console.log('Staging access guard passed (static only; Cloudflare Access must still be verified separately)');

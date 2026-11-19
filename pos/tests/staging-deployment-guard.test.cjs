'use strict';
/* Release candidate guard: verify external deployment configuration is not
   silently replaced by a stale guest preview. No credentials/network needed. */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const build=fs.readFileSync('pos/build-pages.mjs','utf8');
const guest=fs.readFileSync('pos/build-guest-pages.mjs','utf8');

test('real cashier Pages deployment must name an explicit guest origin',()=>{
 assert.match(build,/if\(!ciDryRun&&!process\.env\.POS_GUEST_ENTRY_URL\)/);
 assert.match(build,/Staging deployment blocked: set POS_GUEST_ENTRY_URL/);
 assert.match(build,/secureGuestEntry\(process\.env\.POS_GUEST_ENTRY_URL\|\|guestFallback\)/);
 assert.match(build,/guestOrigin:new URL\(guestEntry\)\.origin/);
});
test('cashier build is locked to isolated staging Supabase and publishable keys',()=>{
 assert.match(build,/parsed\.hostname!=='naaqcspvbntzdtwuchrr\.supabase\.co'/);
 assert.match(build,/key\.startsWith\('sb_publishable_'\)/);
 assert.match(build,/Refusing to build POS against production Supabase/);
});
test('customer project must use three distinct explicit HTTPS origins',()=>{
 assert.match(guest,/POS_GUEST_ORIGIN/);
 assert.match(guest,/POS_CASHIER_ORIGIN/);
 assert.match(guest,/POS_GUEST_API_ORIGIN/);
 assert.match(guest,/new Set\(\[g,c,a\]\)\.size!==3/);
 assert.match(guest,/frame-ancestors \$\{c\}/);
 assert.match(guest,/connect-src \$\{a\}/);
});

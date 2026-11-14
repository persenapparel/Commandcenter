'use strict';
// Staging checkout integration regression: verify that no customer-facing
// execution path can silently inherit the cashier's browser credentials.
// These are source-contract tests, not substitutes for browser/PostgreSQL tests.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {test}=require('node:test');
const read=file=>fs.readFileSync(path.join(__dirname,file),'utf8');
const swivel=read('swivel-mode.js');
const guest=read('customer-guest-client.js');
const capability=read('guest-checkout-capability-staging.sql');
const progress=read('guest-checkout-progress-staging.sql');

test('cashier-to-customer transition stays fail closed until guest transport is reviewed',()=>{
 assert.match(swivel,/start\.onclick=deny/);
 assert.match(swivel,/overlay\.hidden=true/);
 assert.match(swivel,/frame\.removeAttribute\('src'\)/);
 assert.doesNotMatch(swivel,/frame\.src\s*=/);
 assert.doesNotMatch(swivel,/pos_issue_display_pairing\s*['"`]/);
 assert.doesNotMatch(swivel,/auth\.signOut\s*\(/);
 assert.doesNotMatch(swivel,/auth\.signInWithPassword\s*\(/);
});

test('customer client never persists or recovers the cashier session',()=>{
 for(const required of ['persistSession:false','autoRefreshToken:false','detectSessionInUrl:false'])
   assert.ok(guest.includes(required),required);
 assert.doesNotMatch(guest,/localStorage|sessionStorage|\bgetSession\s*\(|\bsetSession\s*\(/);
 assert.doesNotMatch(guest,/service_role|SUPABASE_SERVICE_ROLE|secretKey/);
});

test('checkout capability cannot be used after completion or register deactivation',()=>{
 assert.match(capability,/c\.status in \('awaiting_customer','contact_received'\)/);
 assert.doesNotMatch(capability,/c\.status in \([^\n]*'completed'/);
 assert.match(capability,/r\.id=c\.register_id and r\.owner_id=c\.owner_id and r\.active=true/);
 assert.match(capability,/t\.revoked_at is null and t\.expires_at>now\(\)/);
 assert.match(capability,/t\.owner_id=c\.owner_id/);
});

test('guest progress cannot change tender, cart, checkout status or cashier data',()=>{
 const m=progress.match(/update public\.pos_checkouts c\s+set ([\s\S]*?)\s+where c\.id=v_checkout/i);
 assert.ok(m,'expected narrowly scoped progress UPDATE');
 const assigned=[...m[1].matchAll(/\b([a-z_]+)\s*=/g)].map(x=>x[1]);
 assert.deepEqual(assigned,['customer_step','help_requested','progress_updated_at','updated_at']);
 assert.match(progress,/c\.status='awaiting_customer'/);
 assert.match(progress,/for update of t/);
 assert.match(progress,/revoke all on function public\.pos_guest_checkout_set_progress/);
 assert.doesNotMatch(progress,/grant execute/i);
});

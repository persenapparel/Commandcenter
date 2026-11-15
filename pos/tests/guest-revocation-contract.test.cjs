'use strict';
/* Independent static regression gate for staging-only guest-token revocation.
 * This is NOT a substitute for disposable PostgreSQL tests or iPad E2E.
 * Run: node --test pos/tests/guest-revocation-contract.test.cjs
 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const sql=fs.readFileSync(path.join(__dirname,'..','guest-checkout-capability-staging.sql'),'utf8');
function functionBody(name){
 const marker='create or replace function public.'+name+'(';
 const pos=sql.toLowerCase().indexOf(marker);
 assert.notEqual(pos,-1,'missing '+name);
 const tail=sql.slice(pos);
 const match=tail.match(/as\s+\$\$([\s\S]*?)\$\$/i);
 assert.ok(match,'missing PL/pgSQL body for '+name);
 return match[1];
}
test('revocation checks authenticated owner, checkout owner, and active register owner',()=>{
 const body=functionBody('pos_revoke_guest_checkout_capability');
 assert.match(body,/v_owner\s+is\s+null\s+or\s+not\s+public\.is_persen_admin\(\)/i);
 assert.match(body,/x\.checkout_id\s*=\s*p_checkout\s+and\s+x\.owner_id\s*=\s*v_owner/i);
 assert.match(body,/c\.id\s*=\s*x\.checkout_id\s+and\s+c\.owner_id\s*=\s*v_owner/i);
 assert.match(body,/r\.owner_id\s*=\s*v_owner\s+and\s+r\.active\s*=\s*true/i);
 assert.match(body,/set revoked_at\s*=\s*now\(\)/i);
});
test('revocation function and private table cannot be invoked/read by anonymous clients',()=>{
 assert.match(sql,/revoke all on function public\.pos_revoke_guest_checkout_capability\(uuid\)\s+from public, anon, authenticated/i);
 assert.match(sql,/grant execute on function public\.pos_revoke_guest_checkout_capability\(uuid\)\s+to authenticated/i);
 assert.match(sql,/alter table public\.pos_guest_checkout_capabilities enable row level security/i);
 assert.match(sql,/revoke all on public\.pos_guest_checkout_capabilities\s+from public, anon, authenticated/i);
});
test('rotation invalidates old digest and snapshot rejects revoked/expired tokens',()=>{
 const issue=functionBody('pos_issue_guest_checkout_capability');
 const snapshot=functionBody('pos_guest_checkout_snapshot');
 assert.match(issue,/gen_random_bytes\(32\)/i);
 assert.match(issue,/on conflict\s*\(checkout_id\)\s*do update/i);
 assert.match(issue,/token_sha256\s*=\s*excluded\.token_sha256/i);
 assert.match(snapshot,/t\.revoked_at\s+is\s+null\s+and\s+t\.expires_at\s*>\s*now\(\)/i);
 assert.match(snapshot,/c\.status\s*=\s*'awaiting_customer'/i);
});

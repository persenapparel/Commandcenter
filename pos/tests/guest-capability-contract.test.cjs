'use strict';
/* Static SQL contracts only. Run: node --test pos/tests/guest-capability-contract.test.cjs
 * Must still execute disposable PostgreSQL RLS tests and browser E2E.
 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const sql=readFileSync(join(__dirname,'..','guest-checkout-capability-staging.sql'),'utf8');
function body(name){
 const start=sql.toLowerCase().indexOf('create or replace function public.'+name.toLowerCase()+'(');
 assert.notEqual(start,-1,'missing function '+name);
 const rest=sql.slice(start);
 const match=rest.match(/as\s+\$\$([\s\S]*?)\$\$/i);
 assert.ok(match,'missing function body '+name);
 return match[1];
}
test('capability storage has RLS and no API table access',()=>{
 assert.match(sql,/alter table public\.pos_guest_checkout_capabilities enable row level security/i);
 assert.match(sql,/revoke all on public\.pos_guest_checkout_capabilities\s+from public, anon, authenticated/i);
 assert.match(sql,/token_sha256 text not null unique/i);
 assert.match(sql,/checkout_id uuid primary key/i);
});
test('issuance is owner-only, checkout-bound, and rotates on reissue',()=>{
 const s=body('pos_issue_guest_checkout_capability');
 assert.match(s,/auth\.uid\(\)/);
 assert.match(s,/is_persen_admin\(\)/);
 assert.match(s,/c\.id=p_checkout and c\.owner_id=v_owner/i);
 assert.match(s,/r\.owner_id=v_owner and r\.active=true/i);
 assert.match(s,/c\.status='awaiting_customer'/i);
 assert.match(s,/for update of c/i);
 assert.match(s,/gen_random_bytes\(32\)/i);
 assert.match(s,/on conflict\(checkout_id\) do update/i);
 assert.match(s,/expires_at=excluded\.expires_at/i);
 assert.match(s,/revoked_at=null/i);
 assert.match(sql,/now\(\)\+interval '20 minutes'/i);
});
test('snapshot fails closed on invalid, expired, revoked, mismatched or inactive checkout',()=>{
 const s=body('pos_guest_checkout_snapshot');
 assert.match(s,/p_capability !~ '\^\[0-9a-f\]\{64\}\$'/);
 assert.match(s,/t\.revoked_at is null and t\.expires_at>now\(\)/i);
 assert.match(s,/c\.owner_id=t\.owner_id/i);
 assert.match(s,/r\.owner_id=t\.owner_id and r\.active=true/i);
 assert.match(s,/c\.status='awaiting_customer'/i);
 assert.match(s,/if not found then\s+return jsonb_build_object\('status','unavailable'\)/i);
 for(const secret of ['email','phone','signature','display_secret','owner_id','staff_id','auth_token']){
  assert.doesNotMatch(s,new RegExp("'"+secret+"'\\s*,",'i'),'guest snapshot exposes '+secret);
 }
});
test('guest RPC is not directly executable by anon or authenticated',()=>{
 assert.match(sql,/revoke all on function public\.pos_guest_checkout_snapshot\(text\)\s+from public, anon, authenticated/i);
 assert.doesNotMatch(sql,/grant execute on function public\.pos_guest_checkout_snapshot\(text\)\s+to (?:anon|authenticated)/i);
 assert.match(sql,/grant execute on function public\.pos_issue_guest_checkout_capability\(uuid\)\s+to authenticated/i);
});

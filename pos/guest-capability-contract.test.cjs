/* Source-contract tests for the unapplied, fail-closed guest capability migration.
 * These are NOT a substitute for PostgreSQL RLS, expiry/replay or browser tests.
 * No real customer, checkout, database or hardware is accessed.
 */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=n=>fs.readFileSync(path.join(__dirname,n),'utf8');
const sql=read('guest-checkout-capability-staging.sql');
const swivel=read('swivel-mode.js');
const section=(start,end)=>{
 const i=sql.indexOf(start),j=end?sql.indexOf(end,i+start.length):sql.length;
 assert.ok(i>=0&&j>i,'missing SQL section '+start);
 return sql.slice(i,j);
};
test('capability is bound to checkout, not shared register, and stores a digest only',()=>{
 const ddl=section('create table if not exists public.pos_guest_checkout_capabilities','create index if not exists');
 assert.match(ddl,/checkout_id uuid primary key references public\.pos_checkouts\(id\)/i);
 assert.match(ddl,/token_sha256 text not null unique/i);
 assert.doesNotMatch(ddl,/display_secret|token_plaintext|token_value/i);
 const issue=section('create or replace function public.pos_issue_guest_checkout_capability','create or replace function public.pos_revoke_guest_checkout_capability');
 assert.match(issue,/extensions\.gen_random_bytes\(32\)/i);
 assert.match(issue,/extensions\.digest\(v_token,'sha256'\)/i);
 assert.match(issue,/on conflict\(checkout_id\) do update/i);
 assert.match(issue,/c\.status='awaiting_customer'/i);
 assert.match(issue,/c\.created_at > now\(\)-interval '30 minutes'/i);
 assert.match(issue,/expires_at=excluded\.expires_at/i);
 assert.match(issue,/now\(\)\+interval '20 minutes'/i);
 assert.match(issue,/auth\.uid\(\)/i);
 assert.match(issue,/public\.is_persen_admin\(\)/i);
});
test('direct table access and guest RPC are denied until gateway is reviewed',()=>{
 assert.match(sql,/alter table public\.pos_guest_checkout_capabilities enable row level security/i);
 assert.match(sql,/revoke all on public\.pos_guest_checkout_capabilities\s+from public, anon, authenticated/i);
 assert.match(sql,/revoke all on function public\.pos_guest_checkout_snapshot\(text\)\s+from public, anon, authenticated/i);
 assert.doesNotMatch(sql,/grant execute on function public\.pos_guest_checkout_snapshot\(text\)/i);
});
test('snapshot never exposes PII, staff auth, or finished transactions',()=>{
 const snap=section('create or replace function public.pos_guest_checkout_snapshot','-- Required follow-up');
 assert.match(snap,/p_capability !~ '\^\[0-9a-f\]\{64\}\$'/i);
 assert.match(snap,/extensions\.digest\(p_capability,'sha256'\)/i);
 assert.match(snap,/t\.revoked_at is null and t\.expires_at>now\(\)/i);
 assert.match(snap,/c\.status in \('awaiting_customer','contact_received'\)/i);
 assert.match(snap,/r\.active=true/i);
 for(const forbidden of ['phone','email','signature','owner_id','display_secret','marketing_opt_in','payment_token']){
  assert.doesNotMatch(snap,new RegExp("'"+forbidden+"'\\s*,\\s*v_checkout\\.",'i'),'guest response leaks '+forbidden);
 }
 assert.doesNotMatch(snap,/c\.status in \([^)]*'completed'/i);
});
test('revoke requires owner authorization and binds owner checkout',()=>{
 const revoke=section('create or replace function public.pos_revoke_guest_checkout_capability','-- A narrow read-only RPC');
 assert.match(revoke,/public\.is_persen_admin\(\)/i);
 assert.match(revoke,/x\.owner_id=v_owner/i);
 assert.match(revoke,/r\.owner_id=v_owner/i);
 assert.match(revoke,/set revoked_at=now\(\)/i);
});
test('customer handoff remains blocked before any pairing or checkout begins',()=>{
 const handler=swivel.indexOf("$('start').onclick=async()=>{");
 const guard=swivel.indexOf('secure customer isolation is required',handler);
 const stop=swivel.indexOf('return;',guard);
 const pair=swivel.indexOf('await pairing()',handler);
 assert.ok(handler>=0&&guard>handler&&stop>guard&&pair>stop);
});

test('checkout changes revoke active guest capability in the same transaction',()=>{
 const trigger=section('create or replace function public.pos_revoke_guest_capability_on_checkout_change','-- Required follow-up');
 assert.match(trigger,/returns trigger/i);
 assert.match(trigger,/after update of status, items, subtotal_cents, discount_cents, total_cents,/i);
 for(const field of ['status','items','subtotal_cents','discount_cents','total_cents','register_id','owner_id']){
  assert.match(trigger,new RegExp('old\\.'+field+' is distinct from new\\.'+field,'i'));
 }
 assert.match(trigger,/update public\\.pos_guest_checkout_capabilities\\s+set revoked_at=now\\(\\)/i);
 assert.match(trigger,/where checkout_id=old\\.id and revoked_at is null/i);
 assert.match(trigger,/for each row execute function public\\.pos_revoke_guest_capability_on_checkout_change\\(\\)/i);
});

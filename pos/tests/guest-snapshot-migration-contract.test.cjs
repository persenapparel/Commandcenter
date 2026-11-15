'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sql = fs.readFileSync(path.join(__dirname, '..', 'guest-checkout-capability-staging.sql'), 'utf8');
test('guest capability table enforces RLS and denies API roles', () => {
 assert.match(sql,/alter table public\.pos_guest_checkout_capabilities enable row level security/i);
 assert.match(sql,/revoke all on public\.pos_guest_checkout_capabilities\s+from public, anon, authenticated/i);
 assert.doesNotMatch(sql,/grant\s+(?:all|select|insert|update|delete)\s+on\s+public\.pos_guest_checkout_capabilities/i);
});
test('guest snapshot RPC is not granted to anonymous or authenticated roles', () => {
 assert.match(sql,/revoke all on function public\.pos_guest_checkout_snapshot\(text\)\s+from public, anon, authenticated/i);
 assert.doesNotMatch(sql,/grant execute on function public\.pos_guest_checkout_snapshot\(text\)/i);
});
test('snapshot validates token digest, revocation, expiry and checkout state', () => {
 const fn=sql.split('create or replace function public.pos_guest_checkout_snapshot(')[1];
 assert.ok(fn,'snapshot function missing');
 const body=fn.split('$$;')[0];
 for(const pattern of [/digest\(p_capability,'sha256'\)/i,/revoked_at is null/i,/expires_at>now\(\)/i,/c\.status in/i,/p_capability !~/i]) assert.match(body,pattern);
});
test('snapshot response excludes private staff and payment fields', () => {
 const fn=sql.split('create or replace function public.pos_guest_checkout_snapshot(')[1];
 assert.ok(fn,'snapshot function missing');
 const body=fn.split('$$;')[0];
 const response=body.split("return jsonb_build_object(\n    'status'")[1];
 assert.ok(response,'response construction missing');
 for(const key of ['owner_id','access_token','refresh_token','display_secret','payment_method','cash_tendered_cents','change_cents','customer_email','customer_phone','marketing_consent','signature']) {
  assert.ok(!response.includes("'"+key+"'"),'forbidden guest field: '+key);
 }
});
test('issuer requires owner identity and checkout scope with 20-minute expiry', () => {
 const fn=sql.split('create or replace function public.pos_issue_guest_checkout_capability(')[1];
 assert.ok(fn,'issuer missing');
 const body=fn.split('$$;')[0];
 for(const pattern of [/auth\.uid\(\)/i,/is_persen_admin\(\)/i,/c\.owner_id=v_owner/i,/interval '20 minutes'/i,/on conflict\(checkout_id\) do update/i]) assert.match(body,pattern);
});

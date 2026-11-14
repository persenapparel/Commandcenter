'use strict';
// Source-level safety contracts, NOT a substitute for isolated PostgreSQL tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sql = fs.readFileSync(path.join(__dirname,'guest-checkout-submit-staging.sql'),'utf8');
test('guest submission remains unreachable to API roles',()=>{
  assert.match(sql,/revoke all on function public\.pos_guest_checkout_submit\(text,jsonb\)\s+from public, anon, authenticated/i);
  assert.doesNotMatch(sql,/grant execute on function public\.pos_guest_checkout_submit/i);
  assert.match(sql,/alter table public\.pos_guest_checkout_signatures enable row level security/i);
  assert.match(sql,/revoke all on public\.pos_guest_checkout_signatures from public, anon, authenticated/i);
});
test('guest token is checkout-bound, expires, serializes and revokes',()=>{
  for(const required of [
    't.token_sha256=encode(extensions.digest(p_capability',
    't.revoked_at is null and t.expires_at>v_now',
    "c.status='awaiting_customer'",
    'c.id=t.checkout_id and c.owner_id=t.owner_id',
    'for update of t',
    "status='contact_received'",
    'set revoked_at=v_now'
  ]) assert.ok(sql.includes(required),required);
});
test('guest answer whitelist excludes sale, prices, staff and drawer fields',()=>{
  assert.match(sql,/jsonb_object_keys\(p_answers\)/);
  assert.match(sql,/where k not in \('phone','email','marketing_choice','rating'/);
  assert.doesNotMatch(sql,/\bset\s+(?:total_cents|discount_bps|owner_id|cash_received_cents)\s*=/i);
  assert.match(sql,/v_consent not in \('yes','no','not_answered'\)/);
  assert.match(sql,/v_email_receipt and v_email is null/);
});
test('signature required and submit rate limit is bounded',()=>{
  assert.match(sql,/v_signature is null/);
  assert.match(sql,/data:image\/png;base64/);
  assert.match(sql,/request_count<5/);
  assert.match(sql,/on conflict\(checkout_id\) do nothing/);
});

// A PL/pgSQL RETURN false does not undo prior writes. Enforce rollback on
// post-write failures so stale signature/limit rows cannot be committed.
test('post-write conflicts abort transaction instead of returning false',()=>{
  assert.match(sql,/if not found then\s+raise exception 'guest checkout submission conflict'/i);
  assert.match(sql,/if not found then\s+raise exception 'guest checkout changed during submission'/i);
  assert.match(sql,/errcode='40001'/);
});

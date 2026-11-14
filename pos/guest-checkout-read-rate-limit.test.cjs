'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sql = fs.readFileSync(path.join(__dirname, 'guest-checkout-read-rate-limit-staging.sql'), 'utf8');
test('guest read gateway stays ungranted and uses checkout-scoped token', () => {
  assert.match(sql, /revoke all on function public\.pos_guest_checkout_rate_limited_snapshot\(text\)[\s\S]*?from public, anon, authenticated;/i);
  assert.doesNotMatch(sql, /grant execute on function public\.pos_guest_checkout_rate_limited_snapshot/i);
  assert.match(sql, /t\.token_sha256\s*=\s*encode\(extensions\.digest\(p_capability,'sha256'\),'hex'\)/i);
  assert.match(sql, /t\.revoked_at is null and t\.expires_at>v_now/i);
  assert.match(sql, /c\.status in \('awaiting_customer','contact_received'\)/i);
  assert.match(sql, /for update of t;/i);
});
test('guest read limiter has RLS and atomic capped one-minute window', () => {
  assert.match(sql, /alter table public\.pos_guest_checkout_read_limits enable row level security;/i);
  assert.match(sql, /revoke all on public\.pos_guest_checkout_read_limits\s+from public, anon, authenticated;/i);
  assert.match(sql, /request_count between 0 and 30/i);
  assert.match(sql, /v_now-interval '60 seconds'/i);
  assert.match(sql, /request_count < 30/i);
  assert.match(sql, /return public\.pos_guest_checkout_snapshot\(p_capability\)/i);
  assert.doesNotMatch(sql, /insert into public\.pos_(sales|payments|checkouts)/i);
});

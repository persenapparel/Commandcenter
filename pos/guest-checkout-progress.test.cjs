'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {test}=require('node:test');
const sql=fs.readFileSync(require('node:path').join(__dirname,'guest-checkout-progress-staging.sql'),'utf8');
test('guest progress requires checkout-scoped hashed token, owner and active checkout',()=>{
  for(const s of [
    't.token_sha256=encode(extensions.digest(p_capability,\'sha256\'),\'hex\')',
    'c.id=t.checkout_id and c.owner_id=t.owner_id',
    'r.id=c.register_id and r.owner_id=c.owner_id and r.active=true',
    't.revoked_at is null and t.expires_at>v_now',
    "c.status='awaiting_customer'",
    'for update of t'
  ])assert.ok(sql.includes(s),s);
});
test('guest progress has per-token limits and no public API access',()=>{
  assert.match(sql,/request_count integer not null default 0\s+check \(request_count between 0 and 20\)/);
  assert.match(sql,/request_count<20/);
  assert.match(sql,/window_started_at<=v_now-interval '60 seconds'/);
  assert.match(sql,/alter table public\.pos_guest_checkout_progress_limits enable row level security/);
  assert.match(sql,/revoke all on public\.pos_guest_checkout_progress_limits\s+from public, anon, authenticated/);
  assert.match(sql,/revoke all on function public\.pos_guest_checkout_set_progress\(text,text,boolean\)\s+from public, anon, authenticated/);
  assert.doesNotMatch(sql,/grant execute/i);
});
test('progress updates only step/help timestamps, never order, auth or tender',()=>{
  assert.match(sql,/update public\.pos_checkouts c\s+set customer_step=p_step,\s+help_requested=p_need_help,\s+progress_updated_at=v_now,\s+updated_at=v_now/);
  assert.match(sql,/p_step not in\s*\('phone','receipt','email','payment','promos','rating','custom','review'\)/);
  assert.match(sql,/p_need_help is null/);
  assert.doesNotMatch(sql,/update public\.pos_sales|update public\.pos_registers|insert into public\.pos_sales/i);
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const sql=fs.readFileSync(path.join(__dirname,'guest-checkout-capability-staging.sql'),'utf8');
test('guest capability trigger has valid PL/pgSQL dollar-quoted body',()=>{
 const start=sql.indexOf('create or replace function public.pos_revoke_guest_capability_on_checkout_change()');
 const end=sql.indexOf('drop trigger if exists pos_guest_capability_checkout_changed',start);
 assert.ok(start>=0&&end>start,'trigger declaration missing');
 const body=sql.slice(start,end);
 assert.match(body,/\bas \$\$\s*begin\b/i);
 assert.match(body,/\bend;\s*\$\$;/i);
 assert.doesNotMatch(body,/\bas \$\s*begin\b/i);
 assert.doesNotMatch(body,/\bend;\s*\$;/i);
});
test('trigger invalidates on status, item, price, owner and register changes',()=>{
 const trigger=sql.slice(sql.indexOf('create or replace function public.pos_revoke_guest_capability_on_checkout_change()'),sql.indexOf('-- Required follow-up'));
 for(const field of ['status','items','subtotal_cents','discount_cents','total_cents','register_id','owner_id'])
  assert.match(trigger,new RegExp('old\\.'+field+' is distinct from new\\.'+field,'i'));
 assert.match(trigger,/update public\.pos_guest_checkout_capabilities\s+set revoked_at=now\(\)/i);
 assert.match(trigger,/for each row execute function public\.pos_revoke_guest_capability_on_checkout_change\(\)/i);
});

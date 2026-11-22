'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const audit=fs.readFileSync('pos/sql/live_sales_release_audit_20261122.sql','utf8');
test('live-sales release audit is strictly read-only',()=>{
 const sql=audit.split('\n').filter(line=>!/^\s*--/.test(line)).join('\n');
 assert.match(sql,/^\s*with\s+required_rpcs\(/i);
 assert.match(sql,/select check_name,status,detail from/i);
 assert.doesNotMatch(sql,/^\s*(?:insert|update|delete|alter|drop|truncate|create|grant|revoke|copy|execute)\b/im);
 const quotedReplaced=sql.replace(/'(?:''|[^'])*'/g,"''");
 assert.equal((quotedReplaced.match(/;/g)||[]).length,1);
});
test('core sales and guest capability boundaries are checked independently',()=>{
 for(const x of ['pos_staff_start_shift','pos_staff_begin_checkout','pos_staff_complete_cash',
 'pos_staff_finish_order','pos_owner_confirm_external_payment','pos_handoff_guest_view',
 'pos_handoff_guest_submit','pos_sales','pos_checkout_handoffs','pos_staff_credentials'])
  assert.ok(audit.includes(x),x);
 assert.match(audit,/has_function_privilege\('anon'/);
 assert.match(audit,/has_function_privilege\('service_role'/);
 assert.match(audit,/relrowsecurity/);
});
test('unverified adjustment functions remain on manual hold, not silently enabled',()=>{
 for(const item of ['refunds-returns-exchanges','HOLD_MANUAL',
 'pos_customer_view','pos_submit_customer_v2','BLOCKED'])
  assert.ok(audit.includes(item),item);
});

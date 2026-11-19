'use strict';
/* Read-only staged deployment gate. It may be run against reviewed staging
   PostgreSQL only; never apply as a database migration. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const sql=fs.readFileSync('pos/sql/staging_release_readiness_audit.sql','utf8');
const statement=sql.split('\n').filter(line=>!/^\s*--/.test(line)).join('\n');
test('release audit is read-only and contains one SELECT result query',()=>{
 assert.match(statement,/^\s*with expected\(/i);
 assert.match(statement,/select check_name,status,detail/i);
 assert.match(statement,/order by case status/i);
 assert.equal((statement.match(/;/g)||[]).length,1);
 assert.doesNotMatch(statement,/^\s*(?:create|replace|alter|truncate|drop|insert|update|delete|revoke|grant|execute)\b/im);
});
test('all credential and legacy function readiness gates are included',()=>{
 for(const name of [
  'pos_owner_enroll_badge(integer,text,text,text,text,text,uuid)',
  'pos_owner_badge_slot_status(integer,uuid)',
  'pos_owner_set_badge_register_access(uuid,uuid,boolean)',
  'pos_owner_recover_unpaid_staging_checkout(uuid,text,text)',
  'pos_owner_enroll_badge(integer,text,text,text,text,text)',
  'pos_staff_set_register_access(uuid,uuid,boolean)'
 ])assert.ok(sql.includes(name),name);
 assert.match(sql,/has_function_privilege\('anon'/);
 assert.match(sql,/has_function_privilege\('authenticated'/);
});
test('staging RLS gate includes staff credentials, grants, shifts and handoffs',()=>{
 for(const name of ['pos_staff_credentials','pos_staff_register_grants','pos_staff_shifts','pos_checkout_handoffs'])
  assert.ok(sql.includes(name),name);
 assert.match(sql,/relrowsecurity/);
 assert.match(sql,/BLOCKED/);
 assert.doesNotMatch(sql,/auth\.users\s*\b|select\s+\*\s+from\s+public\.pos_staff_credentials/i);
});

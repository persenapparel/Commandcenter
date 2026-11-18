'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const read=path=>fs.readFileSync(path,'utf8');
test('staging accepts 8-character badge identifier end to end',()=>{
 for(const path of ['pos/sql/staging_owner_badge_enrollment_draft.sql','pos/sql/staging_staff_shift_auth_draft.sql','pos/sql/staging_scoped_badge_rpc_alignment_20261118.sql','pos/sql/staging_eight_digit_staff_badges_20261118.sql']){
   const sql=read(path);
   assert.ok(sql.includes('between 8 and 256'),path);
   assert.ok(!sql.includes('between 16 and 256'),path);
 }
 assert.ok(read('pos/register.html').includes('name="badge" minlength="8"'));
 assert.ok(read('pos/register.js').includes('badge.length<8||pin.length<6'));
 assert.ok(read('pos/staging-handoff-bridge.cjs').includes('badge.length<8 || badge.length>256'));
});
test('PIN, server roles, rate limit and grants remain on staging badge enrollment and sign-in',()=>{
 const enroll=read('pos/sql/staging_owner_badge_enrollment_draft.sql');
 const migration=read('pos/sql/staging_eight_digit_staff_badges_20261118.sql');
 assert.ok(enroll.includes('length(v_pin) not between 6 and 128'));
 assert.ok(migration.includes("extensions.crypt(v_pin,extensions.gen_salt('bf',12))"));
 assert.ok(migration.includes('auth.uid()'));
 assert.ok(migration.includes('pos_staff_auth_attempts'));
 assert.ok(migration.includes('pos_staff_register_grants'));
 assert.equal(migration.split('$function$;').length-1,3);
 assert.ok(migration.includes('REVOKE ALL ON FUNCTION public.pos_staff_start_shift'));
 assert.ok(migration.includes('REVOKE ALL ON FUNCTION public.pos_staff_resume_shift'));
});

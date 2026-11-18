'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const read=p=>fs.readFileSync(p,'utf8');
const source=read('pos/register.js');
const markup=read('pos/register.html');
const badgeSQL=read('pos/sql/staging_badge_pin_only_supervised_20261118.sql');
const staff=read('pos/staff-test.js');
test('badge-only owner enrollment never requires an employee email',()=>{
 assert.match(markup,/No employee emails or accounts needed/);
 assert.match(markup,/id="staff-setup-readiness"/);
 assert.match(markup,/id="test-staff-badge-pin"[^>]*disabled/);
 assert.doesNotMatch(markup,/name="email"|id="activate-staff-badge"|href="staff-test.html"/);
 assert.match(source,/pos_owner_badge_slot_status/);
 assert.match(source,/pos_owner_enroll_badge/);
 assert.match(source,/pos_staff_test_badge_pin/);
});
test('owner-only badge slots protect data and grant only cashier role',()=>{
 assert.match(badgeSQL,/not public\.is_persen_admin\(\)/);
 assert.match(badgeSQL,/where slot\.owner_id=v_uid and slot\.slot=p_slot/);
 assert.match(badgeSQL,/auth_user_id=v_uid/);
 assert.match(badgeSQL,/\'cashier\'/);
 assert.match(badgeSQL,/revoke all on public\.pos_owner_badge_slots from public,anon,authenticated/);
 assert.match(badgeSQL,/v_attempt\.blocked_until>now\(\)/);
 assert.doesNotMatch(badgeSQL,/employee_email|p_email|email_confirmed_at/);
});
test('standalone employee badge PIN test page does not ask for email',()=>{
 assert.match(read('pos/staff-test.html'),/id="test-pin"/);
 assert.doesNotMatch(read('pos/staff-test.html'),/id="sign-up"|id="sign-in"|id="resend-confirmation"/);
 assert.match(staff,/pos_staff_test_badge_pin/);
 assert.doesNotMatch(staff,/auth\.signUp|auth\.resend|auth\.signInWithPassword/);
 assert.doesNotThrow(()=>new vm.Script(staff));
 assert.doesNotThrow(()=>new vm.Script(source));
});

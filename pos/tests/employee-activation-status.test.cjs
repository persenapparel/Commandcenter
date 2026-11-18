'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const read=p=>fs.readFileSync(p,'utf8');
const source=read('pos/register.js');
const markup=read('pos/register.html');
const statusSQL=read('pos/sql/staging_owner_employee_slot_status_20261118.sql');
const staff=read('pos/staff-test.js');
test('employee owner setup shows step order and disables activation before server readiness',()=>{
 assert.match(markup,/Reserve badge.*Test badge.*Employee confirms their email.*Activate with owner approval/);
 assert.match(markup,/id="staff-setup-readiness"/);
 assert.match(markup,/id="activate-staff-badge"[^>]*disabled/);
 assert.match(source,/pos_owner_employee_slot_status/);
 assert.match(source,/!response\.reserved/);
 assert.match(source,/!response\.emailConfirmed/);
 assert.match(source,/employeeSlotStatus\.emailConfirmed/);
 assert.match(source,/await refreshEmployeeSlotStatus\(\)/);
});
test('owner slot status leaks no badge or email and checks the server',()=>{
 assert.match(statusSQL,/not public\.is_persen_admin\(\)/);
 assert.match(statusSQL,/where owner_id=v_uid and slot=p_slot/);
 assert.match(statusSQL,/and id<>v_uid/);
 assert.match(statusSQL,/v_reserved:=found/);
 assert.match(statusSQL,/'reserved',v_reserved/);
 assert.match(statusSQL,/'emailConfirmed',v_confirmed/);
 assert.doesNotMatch(statusSQL,/'badge'|'pin'|'email',v_pending/);
});
test('employees can resend unconfirmed email without gaining owner permissions',()=>{
 assert.match(read('pos/staff-test.html'),/id="resend-confirmation"/);
 assert.match(staff,/db\.auth\.resend\(\{type:'signup',email/);
 assert.doesNotMatch(staff,/pos_owner_activate_pending_employee_badge/);
 assert.doesNotThrow(()=>new vm.Script(staff));
 assert.doesNotThrow(()=>new vm.Script(source));
});

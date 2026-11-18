'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=f=>fs.readFileSync('pos/'+f,'utf8');
const guest=read('customer-checkout-screen.cjs');
const published=fs.readFileSync('pos-guest/guest.js','utf8');
const register=read('register.js'),html=read('register.html');
const ownerSQL=read('sql/staging_owner_verified_external_payments_20261118.sql');
const badgeSQL=read('sql/staging_pending_employee_badge_slots_20261118.sql');
test('customer phone uses read-only on-screen number pad; sales focuses the product scanner',()=>{
 assert.match(guest,/phone\.readOnly = true/);
 assert.match(guest,/phone\.inputMode = 'none'/);
 assert.match(published,/guest-dialpad-popup/);
 assert.match(register,/const scanner=by\('scan-code'\);scanner\.value='';scanner\.focus\(\{preventScroll:true\}\)/);
 assert.match(html,/id="scan-code"[^>]*inputmode="none"/);
 assert.match(html,/id="show-product-search"/);
 assert.doesNotMatch(read('cashier-focus.css'),/window\.print\(/);
});
test('Venmo and Apple Cash choices are informational until owner badge/PIN approval',()=>{
 assert.match(guest,/paymentPreference: answers\.payment==='venmo'/);
 assert.match(published,/paymentPreference:\['cash','venmo_info','apple_cash_info'\]/);
 assert.match(register,/pos_owner_confirm_external_payment/);
 assert.match(register,/p_owner_badge:badge,p_owner_pin:pin/);
 assert.match(register,/p_cashier_confirmed:checked,p_owner_verified:ownerVerified/);
 assert.match(html,/id="external-cashier-confirmed"/);
 assert.match(html,/id="external-owner-verified"/);
 assert.match(html,/id="external-owner-pin"/);
 assert.doesNotMatch(guest,/pos_owner_confirm_external_payment|pos_staff_complete_cash/);
});
test('server requires independent owner verification, original cashier, atomic sale and audit',()=>{
 assert.match(ownerSQL,/p_owner_verified boolean/);
 assert.match(ownerSQL,/p_cashier_confirmed is distinct from true/);
 assert.match(ownerSQL,/staff_role='owner'/);
 assert.match(ownerSQL,/extensions\.crypt\(p_owner_pin,pin_hash\)=pin_hash/);
 assert.match(ownerSQL,/h\.phase='cashier'/);
 assert.match(ownerSQL,/approved_by/);
 assert.match(ownerSQL,/alter table public\.pos_external_payment_approvals enable row level security/);
 assert.match(ownerSQL,/revoke all on public\.pos_external_payment_approvals from public,anon,authenticated/);
 assert.match(ownerSQL,/receipt_print',false/);
 assert.match(ownerSQL,/pos_handoff_guest_submit/);
 assert.match(ownerSQL,/payment_preference=v_payment/);
 assert.match(ownerSQL,/grant execute on function public\.pos_handoff_guest_submit\(uuid,text,jsonb\) to service_role/);
});
test('owner-only two badge setup never grants active cashier access',()=>{
 assert.match(html,/id="staff-badge-setup-dialog"/);
 assert.match(html,/id="open-employee-badges"/);
 assert.match(register,/pos_owner_prepare_employee_badge/);
 assert.match(badgeSQL,/pos_pending_employee_badges/);
 assert.match(badgeSQL,/activated',false/);
 assert.match(badgeSQL,/staff_role='owner'/);
 assert.doesNotMatch(badgeSQL,/insert into public\.pos_staff_register_grants/);
});
test('browser scripts parse and published guest stays a restricted token client',()=>{
 assert.doesNotThrow(()=>new vm.Script(register,{filename:'pos/register.js'}));
 assert.doesNotThrow(()=>new vm.Script(published,{filename:'pos-guest/guest.js'}));
 assert.match(published,/credentials:'omit'/);
 assert.doesNotMatch(published,/pos_staff_complete_cash|pos_owner_confirm_external_payment/);
});

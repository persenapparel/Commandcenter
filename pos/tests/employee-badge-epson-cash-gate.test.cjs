'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const read=filename=>fs.readFileSync('pos/'+filename,'utf8');
const drawerSQL=read('epson-t20iv-staging.sql');
const badgeSQL=read('sql/staging_badge_pin_only_supervised_20261118.sql');
const ownerUI=read('register.js');
const enrollment=read('register.html');
const portal=read('staff-test.html'),portalScript=read('staff-test.js');
const build=read('build-pages.mjs');
const agent=read('epson-station/agent.cjs');
const printMonitor=read('epson-center.js');

test('drawer trigger is unique, cash only and requires completed guest details with exact change',()=>{
 assert.match(drawerSQL,/new\.payment_method <> 'cash' then return new/);
 assert.match(drawerSQL,/c\.status='contact_received'/);
 assert.match(drawerSQL,/new\.change_cents <> new\.tendered_cents-new\.total_cents/);
 assert.match(drawerSQL,/sale\.payment_method='cash' and c\.payment_preference='cash'/);
 assert.match(drawerSQL,/c\.status='completed'/);
 assert.match(drawerSQL,/create unique index if not exists pos_drawer_open_cash_once/);
 assert.match(drawerSQL,/after insert on public\.pos_sales/);
 assert.doesNotMatch(drawerSQL,/after update on public\.pos_sales/);
});
test('receipt spool, browser reprint and Venmo/Apple Cash never transmit drawer kick',()=>{
 assert.match(agent,/async function drawer\(\)/);
 assert.match(agent,/pos_claim_drawer_open_job/);
 assert.match(agent,/async function receipt\(\)/);
 assert.match(agent,/escposReceipt\(sale\)/);
 assert.match(agent,/const processor=createProcessor/);
 assert.match(agent,/PERSEN_DRAWER_ARMED/);
 assert.match(agent,/PERSEN_RECEIPTS_ARMED/);
 assert.match(printMonitor,/read-only Epson queue monitor/i);
 assert.doesNotMatch(printMonitor,/drawerKick\(|sendRawWindows\(/);
 assert.match(drawerSQL,/kind in \('cash-sale','owner-manual'\)/);
});
test('staff badges need only badge and PIN on an owner-paired staging kiosk',()=>{
 assert.match(badgeSQL,/slot in \(1,2\)/);
 assert.match(badgeSQL,/pos_owner_enroll_badge/);
 assert.match(badgeSQL,/staff_role='owner'/);
 assert.match(badgeSQL,/extensions\.digest\(v_badge,'sha256'\)/);
 assert.match(badgeSQL,/extensions\.crypt\(v_pin,extensions\.gen_salt\('bf',12\)\)/);
 assert.match(badgeSQL,/insert into public\.pos_staff_register_grants/);
 assert.match(badgeSQL,/pos_owner_badge_slot_status/);
 assert.match(badgeSQL,/staff_role='cashier'/);
 assert.match(enrollment,/id="test-staff-badge-pin"/);
 assert.doesNotMatch(enrollment,/Employee's email|confirm their email|activate-staff-badge/);
 assert.match(ownerUI,/pos_owner_enroll_badge/);
 assert.match(ownerUI,/pos_staff_test_badge_pin/);
 assert.doesNotMatch(ownerUI,/pos_owner_activate_pending_employee_badge/);
});
test('staging badge PIN test page has no employee signup or email login',()=>{
 assert.match(build,/'staff-test\.html'/);
 assert.match(build,/'staff-test\.js'/);
 assert.match(portal,/id="test-pin"/);
 assert.match(portal,/No employee email/i);
 assert.match(portalScript,/pos_staff_test_badge_pin/);
 assert.doesNotMatch(portalScript,/db\.auth\.signUp|db\.auth\.signInWithPassword|db\.auth\.resend/);
 assert.doesNotMatch(portalScript,/pos_owner_confirm_external_payment|pos_staff_complete_cash|pos_authorize_manual_drawer/);
 assert.doesNotThrow(()=>new vm.Script(portalScript));
});
test('Epson receipt test can run with cash drawer explicitly disarmed',()=>{
 assert.match(agent,/const drawerArmed=process\.env\.PERSEN_DRAWER_ARMED==='YES'/);
 assert.match(agent,/const receiptsArmed=process\.env\.PERSEN_RECEIPTS_ARMED==='YES'/);
 assert.match(agent,/drawerArmed\?await processor\.drawer\(\):null/);
 assert.match(agent,/receiptsArmed\?await processor\.receipt\(\):null/);
 assert.doesNotMatch(agent,/PERSEN_DRAWER_ARMED!=='YES'\|\|process\.env\.PERSEN_RECEIPTS_ARMED!=='YES'/);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),
 fs=require('node:fs'),vm=require('node:vm');
const file=n=>fs.readFileSync('pos/'+n,'utf8');
const register=file('register.js'),swivel=file('swivel-mode.js'),
 markup=file('register.html'),css=file('cashier-focus.css'),
 sql=file('sql/staging_owner_recover_unpaid_checkout_20261118.sql');

test('Employee Home closes Sales layout before showing menu without clearing active shift',()=>{
 assert.match(register,/function closeEmployeeSalesViewForHome\(\)/);
 assert.match(register,/if\(checkout\|\|pendingCash\)throw Error/);
 assert.match(register,/if\(cart\.length\)throw Error/);
 assert.match(register,/setRegisterOpen\(false,true\)/);
 assert.match(register,/closeEmployeeSalesViewForHome,/);
 assert.match(swivel,/api\.closeEmployeeSalesViewForHome\(\)/);
 assert.match(swivel,/api\.openEmployeeMode\('sales'\);hideEmployeeHome\(\)/);
 assert.match(css,/#workspace>:not\(\.quick-toolbar\):not\(\.layout\)\{display:none!important\}/);
});
test('polling never silently opens a locked register for a pending checkout',()=>{
 assert.doesNotMatch(register,/if\(checkout\)document\.body\.classList\.remove\('pos-register-closed'\)/);
 assert.match(register,/Employee access stays locked/);
});
test('only owner-confirmed, unpaid staging checkouts can be recovered and guest token destroyed',()=>{
 assert.match(sql,/public\.is_persen_admin\(\)/);
 assert.match(sql,/staff_role='owner'/);
 assert.match(sql,/extensions\.crypt\(p_owner_pin,pin_hash\)=pin_hash/);
 assert.match(sql,/v_attempt\.blocked_until>now\(\)/);
 assert.match(sql,/not between 8 and 256/);
 assert.match(sql,/not between 6 and 128/);
 assert.match(sql,/status in \('awaiting_customer','contact_received'\)/);
 assert.match(sql,/if exists\(select 1 from public\.pos_sales/);
 assert.match(sql,/capability_digest=null/);
 assert.match(sql,/phase='closed'/);
 assert.match(sql,/status='cancelled'/);
 assert.doesNotMatch(sql,/delete from public\.pos_sales|payment_method\s*=\s*'cash'/);
 assert.match(sql,/revoke all on function public\.pos_owner_recover_unpaid_staging_checkout/);
});
test('Employee Home only exposes owner recovery after verified owner shift',()=>{
 assert.match(swivel,/id="employee-home-recover"/);
 assert.match(swivel,/home\.querySelector\('#employee-home-recover'\)\.hidden=employee\.role!=='owner'/);
 assert.match(swivel,/openUnpaidRecoveryDialog\?\.\(\)/);
 assert.match(register,/openUnpaidRecoveryDialog:\(\)=>openUnpaidRecoveryDialog\(\)/);
 assert.match(register,/window\.PersenPOSSwivel\.employee\?\.\(\)\?\.role!=='owner'/);
});

test('owner recovery needs explicit acknowledgement and refreshes browser after success',()=>{
 assert.match(markup,/id="recover-unpaid-dialog"/);
 assert.match(markup,/id="open-checkout-recovery"/);
 assert.match(markup,/id="open-checkout-recovery-toolbar"/);
 assert.match(markup,/name="confirm_unpaid".*required/);
 assert.match(register,/window\.confirm\('Cancel unfinished, UNPAID test checkouts/);
 assert.match(register,/pos_owner_recover_unpaid_staging_checkout/);
 assert.match(register,/window\.location\.reload\(\)/);
 assert.doesNotThrow(()=>new vm.Script(register));
 assert.doesNotThrow(()=>new vm.Script(swivel));
});

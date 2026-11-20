'use strict';
// Targeted regression checks for staging-only SHIFT-HOME recovery.
// Run: node --test pos/shift-home-recovery.test.cjs
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const reg=fs.readFileSync(path.join(__dirname,'register.js'),'utf8');
const swivel=fs.readFileSync(path.join(__dirname,'swivel-mode.js'),'utf8');
const match=reg.match(/function employeeHomeBlocker\(\)\{[\s\S]*?\n\}/);
assert.ok(match,'employeeHomeBlocker source must exist');
function checkHomeBlocker(checkout,pendingCash=null){
 const ctx={checkout,pendingCash};
 vm.runInNewContext(match[0]+'\nresult=employeeHomeBlocker();',ctx);
 return ctx.result;
}
test('no outstanding checkout permits fresh staff shift',()=>{
 assert.equal(checkHomeBlocker(null),null);
});
test('unpaid customer checkout requires owner recovery',()=>{
 for(const status of ['awaiting_customer','contact_received']){
  assert.equal(checkHomeBlocker({status}),'unpaid_checkout');
 }
});
test('paid but unfinished checkout is not treated as unpaid',()=>{
 assert.equal(checkHomeBlocker({status:'completed'}),'paid_checkout');
 assert.equal(checkHomeBlocker(null,'pending-id'),'pending_payment');
});
test('guard runs before showing badge dialog and before staff RPC',()=>{
 const open=swivel.slice(swivel.indexOf('function openShiftDialog()'),swivel.indexOf('async function handToCustomer()'));
 assert.ok(open.indexOf('const blocker=api.employeeHomeBlocker()')>=0);
 assert.ok(open.indexOf('const blocker=api.employeeHomeBlocker()')<open.indexOf('shiftDialog.showModal()'));
 const login=swivel.slice(swivel.indexOf("shiftForm.addEventListener('submit'"),swivel.indexOf("$('swivel-shift-cancel')"));
 assert.ok(login.indexOf('const blocker=api.employeeHomeBlocker()')>=0);
 assert.ok(login.indexOf('const blocker=api.employeeHomeBlocker()')<login.indexOf('active.startShift({badge,pin})'));
});
test('server verified shift never bypasses a newly appearing checkout',()=>{
 const login=swivel.slice(swivel.indexOf("shiftForm.addEventListener('submit'"),swivel.indexOf("$('swivel-shift-cancel')"));
 assert.ok(login.indexOf('const pending=api.employeeHomeBlocker()')>login.indexOf('active.startShift({badge,pin})'));
 assert.ok(login.indexOf('if(pending)')<login.indexOf('if(!showEmployeeHome(employee))'));
});
test('recovery still requires owner approval and user confirmation',()=>{
 assert.match(swivel,/blocker==='unpaid_checkout'&&\(!employee\|\|employee\.role==='owner'\)/);
 assert.match(swivel,/api\.openUnpaidRecoveryDialog\(\)/);
 assert.match(reg,/if\(!data\.get\('confirm_unpaid'\)\)/);
 assert.match(reg,/window\.confirm\('Cancel unfinished, UNPAID test checkouts/);
 assert.match(reg,/pos_owner_recover_unpaid_staging_checkout/);
});
test('existing checkout still blocks normal register and new sales',()=>{
 assert.match(reg,/if\(checkout\|\|pendingCash\)throw Error\('Finish or recover the open checkout/);
 assert.match(reg,/if\(checkout\|\|pendingCash\)throw Error\('Finish or cancel the current checkout first'/);
 assert.match(swivel,/if\(blocker\)return showBlockedCheckout\(blocker\)/);
});

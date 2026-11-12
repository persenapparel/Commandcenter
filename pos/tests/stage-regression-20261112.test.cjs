'use strict';
// Staging-only, offline regression checks for the authoritative checkout stages.
// Run: node --test pos/tests/stage-regression-20261112.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Wizard=require('../checkout-flow.js');

test('cashier shows catalog with no checkout',()=>{
 assert.equal(Wizard.cashierStage(null),'catalog');
});
test('customer questions cannot accidentally become a cash confirmation',()=>{
 assert.equal(Wizard.cashierStage({status:'awaiting_customer'}),'customer');
});
test('completed customer questionnaire enters cash payment stage',()=>{
 assert.equal(Wizard.cashierStage({status:'contact_received',payment_preference:'cash'}),'payment');
});
test('external payment instructions never look like confirmed cash',()=>{
 for(const payment_preference of ['venmo_info','apple_cash_info'])
  assert.equal(Wizard.cashierStage({status:'contact_received',payment_preference}),'external');
});
test('recorded cash requires a separate finish-order handoff',()=>{
 assert.equal(Wizard.cashierStage({status:'completed',cash_handoff_complete:false}),'handoff');
 assert.equal(Wizard.cashierStage({status:'completed',cash_handoff_complete:true}),'catalog');
});
test('customer display returns to welcome after completed order',()=>{
 assert.equal(Wizard.customerStage('completed',0),'checkout');
 assert.equal(Wizard.customerStage('completed',3999),'checkout');
 assert.equal(Wizard.customerStage('completed',4000),'welcome');
 for(const status of ['idle','cancelled','unpaired','expired'])
  assert.equal(Wizard.customerStage(status),'welcome');
});
test('receipt and email validation are independent of payment stage',()=>{
 assert.equal(Wizard.checkStep('receipt',{receipt:'print'}),'');
 assert.equal(Wizard.checkStep('email',{receipt:'email',email:''}).length>0,true);
 assert.equal(Wizard.checkStep('email',{receipt:'email',email:'test@example.com'}),'');
});
test('customer progress is monotonic through all eight steps',()=>{
 assert.equal(Wizard.steps.length,8);
 const values=Wizard.steps.map(s=>Wizard.monitor(s.id));
 assert.deepEqual(values.map(v=>v.step_number),[1,2,3,4,5,6,7,8]);
 assert.equal(values.at(-1).percentage,100);
});

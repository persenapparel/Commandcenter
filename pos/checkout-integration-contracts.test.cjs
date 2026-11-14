'use strict';
/* Independent, side-effect-free checkout contracts.
 * Run: node --test pos/checkout-integration-contracts.test.cjs
 * Does NOT establish server authorization, hosted RLS, or device readiness.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const wizard=require('./checkout-flow.js');
const cash=require('./pos-cash.js');
const policy=require('./employee-policy.js');

test('phone/email optional except when email receipt explicitly selected',()=>{
 for(const mode of ['print','none']){
  const v={phone:'',email:'',receipt:mode,payment:'cash'};
  assert.equal(wizard.checkStep('phone',v),'');
  assert.equal(wizard.checkStep('receipt',v),'');
  assert.equal(wizard.checkStep('email',v),'');
 }
 assert.match(wizard.checkStep('email',{receipt:'email',email:''}),/required/);
 assert.match(wizard.checkStep('email',{receipt:'both',email:''}),/required/);
 assert.equal(wizard.checkStep('email',{receipt:'email',email:'buyer@example.com'}),'');
 assert.notEqual(wizard.checkStep('email',{receipt:'print',email:'bad-address'}),'');
 assert.notEqual(wizard.checkStep('phone',{phone:'555-123'}),'');
});
test('receipt selection cannot accidentally enable SMS or email',()=>{
 for(const mode of wizard.receiptModes){
  const r=wizard.receipt(mode);
  assert.equal(r.sms,false);
  assert.equal(r.email,mode==='email'||mode==='both');
  assert.equal(r.print,mode==='print'||mode==='both');
 }
});
test('marketing consent is opt-in, not inferred from contact details',()=>{
 for(const answer of [undefined,null,'','no','skip','decline']){
  assert.equal(wizard.summary({phone:'5551234567',email:'buyer@example.com',marketing:answer}).promo,false);
 }
 assert.equal(wizard.summary({marketing:'yes'}).promo,true);
});
test('customer status reset does not reveal completed order after grace interval',()=>{
 for(const s of ['idle','cancelled','unpaired','expired'])assert.equal(wizard.customerStage(s),'welcome');
 assert.equal(wizard.customerStage('completed',3999),'checkout');
 assert.equal(wizard.customerStage('completed',4000),'welcome');
 assert.equal(wizard.cashierStage({status:'awaiting_customer'}),'customer');
 assert.equal(wizard.cashierStage({status:'contact_received',payment_preference:'cash'}),'payment');
 assert.equal(wizard.cashierStage({status:'contact_received',payment_preference:'venmo_info'}),'external');
 assert.equal(wizard.cashierStage({status:'completed',cash_handoff_complete:false}),'handoff');
});
test('cash tender and change are integer cents and cannot finish short',()=>{
 assert.deepEqual(cash.calcChange(2500,3000),{due_cents:2500,paid_cents:3000,short_cents:0,change_cents:500});
 assert.equal(cash.plan(2500,2000,{},false).status,'short');
 assert.throws(()=>cash.calcChange(1000,NaN));
 assert.throws(()=>cash.calcChange(1000,10.5));
 assert.throws(()=>cash.plan(2500,3000,{},true,{'2000':1}),/do not match/);
 assert.equal(policy.canCompleteSale({serverConfirmed:true,receiptQueued:false}),false);
});
test('exact change never invents bills not counted in drawer',()=>{
 assert.equal(cash.makeChange(500,{}),null);
 assert.deepEqual(cash.makeChange(500,{'500':1}),{'500':1});
 assert.equal(cash.plan(2500,3000,{},true).status,'insufficient');
 assert.equal(cash.plan(2500,3000,{'500':1},true).status,'ready');
});
test('client permission predicates deny unauthorized refund and inventory mutation',()=>{
 assert.equal(policy.allowed('employee','refunds'),false);
 assert.equal(policy.allowed('manager','refunds'),true);
 assert.equal(policy.allowed('employee','inventory_adjust'),false);
 assert.equal(policy.allowed('manager','inventory_adjust'),true);
 assert.equal(policy.allowed('manager','return_exception'),false);
 assert.equal(policy.allowed('owner','return_exception'),true);
});

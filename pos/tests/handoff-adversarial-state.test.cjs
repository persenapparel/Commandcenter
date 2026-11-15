'use strict';
// Adversarial model tests: no UI wiring, no hosted database or hardware changes.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {STATES:S,transition:t}=require('../handoff-state-policy.cjs');
const validGuest={guestCapabilityVerified:true,cashierSessionSuspended:true,checkoutBound:true};
const validBadge={serverVerified:true,sameValidShift:true,checkoutBound:true};
const validPayment={paymentVerified:true,orderCommitted:true};
test('guest cannot reach payment or idle by replay, history, idle or forged evidence',()=>{
  const customer=t(S.CASHIER,'HAND_TO_CUSTOMER',validGuest);
  assert.equal(customer,S.CUSTOMER);
  const done=t(customer,'CUSTOMER_SUBMITTED',{serverSubmissionAccepted:true});
  assert.equal(done,S.CUSTOMER_DONE);
  for(const start of [customer,done,S.CASHIER_LOCKED]){
    for(const event of ['FINISH_ORDER','BADGE_VERIFIED','HAND_TO_CUSTOMER','CUSTOMER_SUBMITTED','BACK','REFRESH','IDLE_TIMEOUT','UNKNOWN']){
      const next=t(start,event,{...validGuest,...validPayment,serverSubmissionAccepted:true,serverVerified:false,sameValidShift:false});
      assert.notEqual(next,S.PAYMENT,'unverified badge advanced '+start+' '+event);
      assert.notEqual(next,S.IDLE,'guest completed sale '+start+' '+event);
    }
  }
});
test('cashier resume requires every server-verified, same-shift, checkout-bound condition',()=>{
  const locked=t(S.CUSTOMER_DONE,'CASHIER_CHECKOUT');
  assert.equal(locked,S.CASHIER_LOCKED);
  for(const key of Object.keys(validBadge)){
    assert.equal(t(locked,'BADGE_VERIFIED',{...validBadge,[key]:false}),locked,'missing '+key);
  }
  assert.equal(t(locked,'BADGE_VERIFIED',validBadge),S.PAYMENT);
});
test('finish cannot occur without independently verified payment and committed order',()=>{
  assert.equal(t(S.PAYMENT,'FINISH_ORDER',{paymentVerified:true}),S.PAYMENT);
  assert.equal(t(S.PAYMENT,'FINISH_ORDER',{orderCommitted:true}),S.PAYMENT);
  assert.equal(t(S.PAYMENT,'FINISH_ORDER',validPayment),S.IDLE);
});
test('all non-verified event sequences keep cashier privilege inaccessible',()=>{
  const events=['BACK','REFRESH','IDLE_TIMEOUT','HAND_TO_CUSTOMER','CUSTOMER_SUBMITTED','CASHIER_CHECKOUT','BADGE_VERIFIED','FINISH_ORDER'];
  let seed=20261114;
  const next=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)%events.length);
  for(let run=0;run<200;run++){
    let state=S.CUSTOMER;
    for(let i=0;i<50;i++){
      const event=events[next()];
      state=t(state,event,{guestCapabilityVerified:false,cashierSessionSuspended:false,checkoutBound:false,serverSubmissionAccepted:false,serverVerified:false,sameValidShift:false,paymentVerified:false,orderCommitted:false});
      assert.notEqual(state,S.PAYMENT);
      assert.notEqual(state,S.IDLE);
    }
  }
});

'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {STATES:S,transition:t}=require('../handoff-state-policy.cjs');
const guest={guestCapabilityVerified:true,cashierSessionSuspended:true,checkoutBound:true};
const badge={serverVerified:true,sameValidShift:true,checkoutBound:true};
test('cashier -> guest -> completion -> locked cashier -> payment -> idle',()=>{
 let s=t(S.CASHIER,'HAND_TO_CUSTOMER',guest);
 assert.equal(s,S.CUSTOMER);
 s=t(s,'CUSTOMER_SUBMITTED',{serverSubmissionAccepted:true});
 assert.equal(s,S.CUSTOMER_DONE);
 assert.equal(t(s,'FINISH_ORDER',{paymentVerified:true,orderCommitted:true}),S.CUSTOMER_DONE);
 s=t(s,'CASHIER_CHECKOUT'); assert.equal(s,S.CASHIER_LOCKED);
 assert.equal(t(s,'BADGE_VERIFIED',{serverVerified:false}),S.CASHIER_LOCKED);
 s=t(s,'BADGE_VERIFIED',badge); assert.equal(s,S.PAYMENT);
 assert.equal(t(s,'FINISH_ORDER',{paymentVerified:true}),S.PAYMENT);
 assert.equal(t(s,'FINISH_ORDER',{paymentVerified:true,orderCommitted:true}),S.IDLE);
});
test('no handoff without verified checkout scope and cashier suspension',()=>{
 for(const key of Object.keys(guest)){
  const evidence={...guest,[key]:false};
  assert.equal(t(S.CASHIER,'HAND_TO_CUSTOMER',evidence),S.CASHIER);
 }
});
test('guest cannot submit twice or enter payment through navigation',()=>{
 assert.equal(t(S.CUSTOMER,'CUSTOMER_SUBMITTED',{}),S.CUSTOMER);
 assert.equal(t(S.CUSTOMER_DONE,'CUSTOMER_SUBMITTED',{serverSubmissionAccepted:true}),S.CUSTOMER_DONE);
 for(const state of [S.CUSTOMER,S.CUSTOMER_DONE,S.CASHIER_LOCKED]){
  for(const event of ['BACK','REFRESH','FINISH_ORDER','BADGE_VERIFIED']){
   assert.notEqual(t(state,event,{...badge,paymentVerified:true,orderCommitted:true}),S.PAYMENT);
  }
 }
});
test('cashier resume requires server-verified badge and same shift',()=>{
 for(const key of Object.keys(badge)){
  assert.equal(t(S.CASHIER_LOCKED,'BADGE_VERIFIED',{...badge,[key]:false}),S.CASHIER_LOCKED);
 }
 assert.equal(t(S.CASHIER_LOCKED,'BADGE_VERIFIED',badge),S.PAYMENT);
});
test('back/refresh/timeout lock privileged cashier screens',()=>{
 for(const state of [S.CASHIER,S.PAYMENT])
  for(const event of ['BACK','REFRESH','IDLE_TIMEOUT'])
   assert.equal(t(state,event),S.CASHIER_LOCKED);
});

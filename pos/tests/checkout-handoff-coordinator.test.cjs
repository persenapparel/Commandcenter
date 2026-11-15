'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHandoffCoordinator}=require('../checkout-handoff-coordinator.cjs');
test('one checkout stays locked until verified customer response and shift badge',async()=>{
 const calls=[];
 let status='awaiting_customer';
 const c=createHandoffCoordinator({
  beginCheckout:async()=>({checkoutId:'order1'}),
  issueCheckoutCapability:async id=>({checkoutId:id,capability:'secret',revoke:async()=>calls.push('revoke')}),
  lockCashier:async()=>{calls.push('lock');return true},
  openIsolatedGuest:async()=>calls.push('guest'),
  verifyShiftBadge:async({badge,checkoutId})=>({verified:badge==='valid',checkoutId}),
  getCheckoutStatus:async()=>status,
  resumeCashier:async()=>calls.push('resume'),
  finishVerifiedSale:async()=>({completed:true,checkoutId:'order1'}),
  clearGuestContext:async()=>calls.push('clear'),
  showBrandedHome:async()=>calls.push('home')
 });
 await assert.rejects(c.badgeResume('valid'));
 await c.handToCustomer();
 assert.deepEqual(calls,['lock','guest']);
 await assert.rejects(c.customerCompleted());
 status='contact_received';
 await c.customerCompleted();
 c.showCashierLock();
 await assert.rejects(c.badgeResume('invalid'));
 assert.equal(c.state().phase,'locked');
 await c.badgeResume('valid');
 assert.equal(c.state().phase,'payment');
 await c.finishSale({cashCents:2000});
 assert.deepEqual(calls,['lock','guest','resume','revoke','clear','home']);
 assert.equal(c.state().phase,'home');
 await assert.rejects(c.finishSale({}));
});
test('failed credential lock never exposes customer',async()=>{
 let opened=false,revoked=false;
 const c=createHandoffCoordinator({
  beginCheckout:async()=>({checkoutId:'order2'}),
  issueCheckoutCapability:async id=>({checkoutId:id,capability:'secret',revoke:async()=>{revoked=true}}),
  lockCashier:async()=>false,
  openIsolatedGuest:async()=>{opened=true},
  verifyShiftBadge:async()=>null,
  getCheckoutStatus:async()=>null,
  resumeCashier:async()=>{},
  finishVerifiedSale:async()=>null,
  clearGuestContext:async()=>{},
  showBrandedHome:async()=>{}
 });
 await assert.rejects(c.handToCustomer());
 assert.equal(opened,false);
 assert.equal(revoked,true);
 assert.equal(c.state().phase,'locked');
});

test('completed sale cannot be submitted again if guest revocation fails',async()=>{
 let finishes=0;
 const c=createHandoffCoordinator({
  beginCheckout:async()=>({checkoutId:'once'}),
  issueCheckoutCapability:async id=>({checkoutId:id,capability:'scoped',revoke:async()=>{throw Error('revocation unavailable')}}),
  lockCashier:async()=>true,
  openIsolatedGuest:async()=>{},
  verifyShiftBadge:async({checkoutId})=>({verified:true,checkoutId}),
  getCheckoutStatus:async()=> 'contact_received',
  resumeCashier:async()=>{},
  finishVerifiedSale:async()=>{finishes++;return {completed:true,checkoutId:'once'}},
  clearGuestContext:async()=>{},
  showBrandedHome:async()=>{}
 });
 await c.handToCustomer();
 await c.customerCompleted();
 c.showCashierLock();
 await c.badgeResume('verified-badge');
 await assert.rejects(c.finishSale({cashCents:1000}),/revocation unavailable/);
 assert.equal(c.state().phase,'finalizing');
 await assert.rejects(c.finishSale({cashCents:1000}),/not in payment state/);
 assert.equal(finishes,1);
});

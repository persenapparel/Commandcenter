'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const d=require('../receipt-delivery-policy.js');
const base={saleId:'sale_12345',saleStatus:'completed',receiptRequested:true};
test('receipt methods include explicit text delivery',()=>{
 assert.deepEqual([...d.METHODS],['print','email','text','none']);
 assert.throws(()=>d.method('card'),/Choose/);
});
test('email normalization and invalid input rejection',()=>{
 assert.equal(d.email('  Customer@Example.COM '),'Customer@example.com');
 for(const v of ['not-email','x@','a b@site.com','x@site..com','<script>@example.com'])assert.throws(()=>d.email(v));
});
test('US phone normalizes to E.164 and rejects unsupported contacts',()=>{
 assert.equal(d.phone('(631) 555-0123'),'+16315550123');
 assert.equal(d.phone('+1 631-555-0123'),'+16315550123');
 for(const v of ['555-0123','+44 20 7946 0000','911','abc6315550123'])assert.throws(()=>d.phone(v));
});
test('never send receipts before completed sale or without request',()=>{
 assert.throws(()=>d.intent({...base,saleStatus:'pending',method:'email',recipient:'x@example.com'}),/completed/);
 assert.throws(()=>d.intent({...base,receiptRequested:false,method:'text',recipient:'6315550123'}),/request/);
});
test('none and print never require contact information',()=>{
 assert.equal(d.intent({...base,method:'none'}).deliveryStatus,'not_requested');
 assert.equal(d.intent({...base,method:'print'}).deliveryStatus,'pending_local_print');
});
test('email and text requests are queued, never falsely marked sent',()=>{
 assert.equal(d.intent({...base,method:'email',recipient:'x@example.com'}).deliveryStatus,'queued');
 assert.equal(d.intent({...base,method:'text',recipient:'6315550123'}).recipient,'+16315550123');
});
test('dedupe key is stable across recipient corrections',()=>{
 assert.equal(d.dedupeKey({...base,method:'email',recipient:'first@example.com'}),d.dedupeKey({...base,method:'email',recipient:'second@example.com'}));
 assert.notEqual(d.dedupeKey({...base,method:'email',recipient:'first@example.com'}),d.dedupeKey({...base,method:'text',recipient:'6315550123'}));
});
test('provider evidence is required to claim sent and delivered',()=>{
 assert.equal(d.transition('queued','sending'),'sending');
 assert.throws(()=>d.transition('sending','sent'),/evidence/);
 assert.equal(d.transition('sending','sent',{providerMessageId:'test-provider-id'}),'sent');
 assert.throws(()=>d.transition('sent','delivered',{providerMessageId:'test-provider-id'}),/confirmation/);
 assert.equal(d.transition('sent','delivered',{providerMessageId:'test-provider-id',providerDeliveryConfirmed:true}),'delivered');
 assert.throws(()=>d.transition('delivered','queued'),/Invalid/);
});
test('business contact is separate from customer delivery contact',()=>{
 assert.deepEqual(d.businessContact({email:'Support@PersenApparel.com',phone:'6315550123'}),{email:'Support@persenapparel.com',phone:'+16315550123'});
});

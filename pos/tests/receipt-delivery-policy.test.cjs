'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const r=require('../receipt-delivery-policy.js');
test('email and SMS normalize valid contact details',()=>{
 assert.equal(r.emailAddress('  Person@Example.COM  '),'person@example.com');
 assert.equal(r.usPhone('(631) 555-0123'),'+16315550123');
 assert.equal(r.usPhone('+1 631-555-0123'),'+16315550123');
});
test('reject malformed email and phone without leaking',()=>{
 for(const s of ['bad','x@','x @example.com','<x>@example.com'])assert.throws(()=>r.emailAddress(s));
 for(const s of ['555-1234','1234567890','+44 20 1234 5678','1234567890<script>'])assert.throws(()=>r.usPhone(s));
});
test('never send receipt for unpaid or unsaved transaction',()=>{
 assert.throws(()=>r.request({saleId:'order-1',method:'sms',phone:'6315550123',customerRequested:true}),/Complete/);
 assert.throws(()=>r.request({saleId:'order-1',saleCommitted:true,method:'sms',phone:'6315550123'}),/request/);
});
test('receipt selector supports print, email, text, none',()=>{
 const base={saleId:'order-1',saleCommitted:true};
 assert.deepEqual(r.request({...base,method:'none'}),{method:'none',send:false});
 assert.equal(r.request({...base,method:'print'}).requiresOperatorPrintConfirmation,true);
 const e=r.request({...base,method:'email',email:'person@example.com',customerRequested:true});
 const s=r.request({...base,method:'sms',phone:'6315550123',customerRequested:true});
 assert.equal(e.status,'queued');assert.equal(s.destination,'+16315550123');
 assert.equal(s.idempotencyKey,'receipt:order-1:sms');
 assert.equal(r.request({...base,method:'sms',phone:'6315550123',customerRequested:true}).idempotencyKey,s.idempotencyKey);
});
test('delivery cannot claim sent/delivered without provider evidence',()=>{
 assert.equal(r.transition('queued','sending'),'sending');
 assert.throws(()=>r.transition('sending','sent'),/Provider/);
 assert.equal(r.transition('sending','sent',true),'sent');
 assert.throws(()=>r.transition('sent','delivered'),/Provider/);
 assert.equal(r.transition('sent','delivered',true),'delivered');
 assert.throws(()=>r.transition('delivered','queued'),/Invalid/);
});

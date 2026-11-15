const test=require('node:test');
const assert=require('node:assert/strict');
const D=require('../receipt-delivery-guards.js');
const base={orderId:'sale_1234',committed:true};
test('normalizes valid receipt addresses',()=>{
 assert.equal(D.emailAddress(' Person+tag@EXAMPLE.COM '),'Person+tag@example.com');
 assert.equal(D.usPhone('(631) 555-0199'),'+16315550199');
 assert.equal(D.usPhone('+1 631-555-0199'),'+16315550199');
});
test('rejects invalid or dangerous contact values',()=>{
 for(const x of ['not-an-email','a@localhost','a@@b.com','a@b.com\nBcc:x','<a@b.com>'])assert.throws(()=>D.emailAddress(x));
 for(const x of ['123','555-0199','+44 123 456 7890','(111) 555-0199','6315550199 ext 1'])assert.throws(()=>D.usPhone(x));
});
test('requires committed sale and explicit receipt request',()=>{
 assert.throws(()=>D.request({orderId:'sale_1234',channel:'sms',address:'6315550199',consent:true}));
 assert.throws(()=>D.request({...base,channel:'sms',address:'6315550199'}));
 assert.throws(()=>D.request({...base,channel:'email',address:'a@b.com'}));
 assert.throws(()=>D.request({...base,channel:'fax',consent:true}));
 assert.throws(()=>D.request({...base,channel:'none',orderId:'invalid id'}));
});
test('stable per-order per-channel deduplication keys',()=>{
 assert.throws(()=>D.request({...base,channel:'sms',address:'6315550199',consent:true}),/Unsupported/);
 assert.equal(D.request({...base,channel:'email',address:'a@b.com',consent:true}).idempotency_key,'receipt:sale_1234:email');
 assert.equal(D.request({...base,channel:'none'}).status,'not_requested');
});
test('cannot claim provider success without provider confirmation',()=>{
 assert.throws(()=>D.transition('sending','sent'));
 assert.throws(()=>D.transition('sent','delivered'));
 assert.equal(D.transition('queued','sending'),'sending');
 assert.equal(D.transition('sending','sent',{providerConfirmed:true}),'sent');
 assert.equal(D.transition('sent','delivered',{providerConfirmed:true}),'delivered');
 assert.throws(()=>D.transition('delivered','sending'));
 assert.equal(D.transition('failed','queued'),'queued');
});
test('delivery requires provider readiness and customer choice',()=>{
 assert.equal(D.canSend({channel:'sms',providerReady:true,customerRequested:true,committed:true}),false);
 assert.equal(D.canSend({channel:'email',providerReady:true,customerRequested:true,committed:true}),true);
 assert.equal(D.canSend({channel:'print',providerReady:true,customerRequested:true,committed:true}),false);
 assert.deepEqual(D.safeBusinessContact({}),{email:'',phone:''});
});

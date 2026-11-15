'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeGuestSubmission:validate}=require('../guest-submission-validation.cjs');
const sig='data:image/png;base64,aGVsbG8=';
test('optional contact and explicit decline with signature',()=>assert.deepEqual(validate({marketing_consent:false,signature:sig}),{email:null,phone:null,marketing_consent:false,signature:sig,signature_exception:false}));
test('accessible exception permits skipping signature',()=>assert.equal(validate({marketing_consent:false,signature_exception:true}).signature,null));
test('consent requires a contact route',()=>assert.throws(()=>validate({marketing_consent:true,signature:sig}),/contact/));
test('unknown fields cannot alter checkout totals, ownership, or payment',()=>{
 for(const field of ['total_cents','change_cents','owner_id','checkout_id','status','paid','register_id','token'])assert.throws(()=>validate({marketing_consent:false,signature:sig,[field]:'attacker'}),/Forbidden/);
});
test('reject missing consent, malformed contact, signature bypass and conflicting exception',()=>{
 for(const p of [{signature:sig},{marketing_consent:false,email:'wrong',signature:sig},{marketing_consent:false,signature:''},{marketing_consent:false,signature_exception:true,signature:sig},{marketing_consent:'false',signature:sig},{marketing_consent:false,signature_exception:'true'}])assert.throws(()=>validate(p));
});
test('valid contact is trimmed and cannot smuggle keys',()=>{
 const result=validate({email:' a@example.com ',phone:' +1 (631) 555-0100 ',marketing_consent:true,signature:sig});
 assert.equal(result.email,'a@example.com');assert.equal(result.phone,'+1 (631) 555-0100');
 assert.equal(Object.isFrozen(result),true);
});

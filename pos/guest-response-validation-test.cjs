'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {validateGuestResponse}=require('./guest-response-validation.cjs');
test('email and phone independently optional; consent is explicit',()=>{
 for (const [email,phone] of [['',''],['a@example.com',''],['','555-555-5555']]) {
  const result=validateGuestResponse({email,phone,marketingConsent:false});
  assert.equal(result.email,email); assert.equal(result.phone,phone);
 }
 assert.equal(validateGuestResponse({marketingConsent:true}).marketingConsent,true);
});
test('guest cannot inject price, discount, sale completion, or staff identity',()=>{
 for (const field of ['total','price','discount','approvedBy','cashierId','checkoutId','status','paymentMethod','finishOrder','drawerOpen'])
  assert.throws(()=>validateGuestResponse({marketingConsent:false,[field]:1}),/Unsupported/);
});
test('reject malformed fields and implicit marketing opt-in',()=>{
 for (const input of [null,[],{}, {marketingConsent:'false'}, {marketingConsent:false,email:'not-an-email'}, {marketingConsent:false,phone:'abc'}, {marketingConsent:false,signature:'<svg/>'}])
  assert.throws(()=>validateGuestResponse(input));
});

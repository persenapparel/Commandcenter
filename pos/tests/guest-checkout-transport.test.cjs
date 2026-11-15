'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createGuestTransport} = require('../guest-checkout-transport.cjs');
const checkoutId = '123e4567-e89b-42d3-a456-426614174000';
const args = {customerOrigin:'https://customer.example.test',cashierOrigin:'https://cashier.example.test',apiOrigin:'https://guest-api.example.test',checkoutId,capability:'a'.repeat(64)};
test('guest request never sends cashier cookies, URLs with token, or referrer',async()=>{
 const calls=[];
 const guest=createGuestTransport({...args,fetchImpl:async(url,opts)=>{
  calls.push({url,opts});return {ok:true,json:async()=>({checkoutId,items:[],total:'$0'})};
 }});
 await guest.view();
 assert.equal(calls.length,1);
 assert.equal(calls[0].opts.credentials,'omit');
 assert.equal(calls[0].opts.redirect,'error');
 assert.equal(calls[0].opts.referrerPolicy,'no-referrer');
 assert.equal(calls[0].opts.cache,'no-store');
 assert.ok(!calls[0].url.includes('a'.repeat(64)));
 assert.equal(calls[0].opts.headers.Authorization,'Bearer '+'a'.repeat(64));
});
test('submit is one-shot even when network fails',async()=>{
 let count=0;
 const guest=createGuestTransport({...args,fetchImpl:async()=>{count++;throw Error('offline');}});
 await assert.rejects(guest.submit({marketingConsent:false}));
 await assert.rejects(guest.submit({marketingConsent:true}));
 await assert.rejects(guest.view());
 assert.equal(count,1);
});
test('successful submission cannot be replayed and returns only accepted',async()=>{
 let count=0;
 const guest=createGuestTransport({...args,fetchImpl:async()=>{count++;return {ok:true,json:async()=>({accepted:true,ownerSecret:'must-not-return'})};}});
 assert.deepEqual(await guest.submit({signatureException:true}),{accepted:true});
 await assert.rejects(guest.submit({}));
 assert.equal(count,1);
});
test('local revocation disables view and submit',async()=>{
 const guest=createGuestTransport({...args,fetchImpl:async()=>({ok:true,json:async()=>({})})});
 guest.revokeLocal();
 await assert.rejects(guest.view());
 await assert.rejects(guest.submit({}));
});
for(const overrides of [
 {customerOrigin:args.cashierOrigin},
 {apiOrigin:args.cashierOrigin},
 {customerOrigin:'http://customer.example.test'},
 {apiOrigin:'https://guest-api.example.test/?token=bad'},
 {capability:'short'}
]){
 test('rejects unsafe transport configuration '+JSON.stringify(overrides),()=>{
  assert.throws(()=>createGuestTransport({...args,...overrides,fetchImpl:async()=>({ok:true})}));
 });
}

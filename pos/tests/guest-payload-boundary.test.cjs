'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {validateGuestView} = require('../guest-payload-boundary.cjs');
const id='123e4567-e89b-42d3-a456-426614174000';
const good=()=>({checkoutId:id,items:[{name:'Winter Long Island',quantity:2,lineTotal:'$50.00'}],total:'$50.00'});
test('allows only minimal checkout review and freezes returned snapshot',()=>{
 const result=validateGuestView(good(),id);
 assert.deepEqual(Object.keys(result),['checkoutId','items','total']);
 assert.ok(Object.isFrozen(result.items[0]));
});
test('rejects cross-checkout view',()=>assert.throws(()=>validateGuestView(good(),'123e4567-e89b-42d3-a456-426614174001')));
for(const key of ['owner_id','cashierSession','paymentDetails','changeAmount','service_role','token','costBasis','employeeName']){
 test('rejects guest response containing '+key,()=>{
  const value=good();value[key]='sensitive';assert.throws(()=>validateGuestView(value,id));
 });
}
test('rejects nested item secrets',()=>{const value=good();value.items[0].ownerToken='x';assert.throws(()=>validateGuestView(value,id));});
test('rejects invalid quantity',()=>{const value=good();value.items[0].quantity=-1;assert.throws(()=>validateGuestView(value,id));});
test('rejects excessive items',()=>{const value=good();value.items=Array.from({length:101},()=>good().items[0]);assert.throws(()=>validateGuestView(value,id));});
test('rejects prototype pollution fields',()=>{const value=good();value.items[0]['__proto__']='x';value.items[0].constructor='x';assert.throws(()=>validateGuestView(value,id));});

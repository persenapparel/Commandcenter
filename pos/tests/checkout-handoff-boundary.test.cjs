'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateGuestHandoff}=require('../checkout-handoff-boundary.js');
const now=Date.now();
const valid=()=>({cashierOrigin:'https://cashier.example.test',guestUrl:'https://guest.example.test/checkout',checkoutId:'sale-1',now,capability:{checkoutId:'sale-1',scope:'customer:checkout',issuer:'server',issuedAt:now-1000,expiresAt:now+60000}});
test('valid independent origin and bounded capability',()=>assert.equal(validateGuestHandoff(valid()).checkoutId,'sale-1'));
for(const [label,mutate] of [
 ['same origin',v=>v.guestUrl='https://cashier.example.test/checkout'],
 ['insecure guest',v=>v.guestUrl='http://guest.example.test/checkout'],
 ['query token',v=>v.guestUrl+='?token=secret'],
 ['fragment',v=>v.guestUrl+='#secret'],
 ['embedded user info',v=>v.guestUrl='https://user:pass@guest.example.test/checkout'],
 ['other checkout',v=>v.capability.checkoutId='sale-2'],
 ['wrong scope',v=>v.capability.scope='register:display'],
 ['client issued',v=>v.capability.issuer='client'],
 ['revoked',v=>v.capability.revoked=true],
 ['expired',v=>v.capability.expiresAt=now-1],
 ['overlong',v=>v.capability.expiresAt=now+600000],
 ['future issue',v=>v.capability.issuedAt=now+100],
 ['missing capability',v=>v.capability=null],
])test('reject '+label,()=>{const v=valid();mutate(v);assert.throws(()=>validateGuestHandoff(v));});

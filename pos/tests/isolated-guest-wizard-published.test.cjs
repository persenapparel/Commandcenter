'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const guest=fs.readFileSync(path.join(__dirname,'..','..','pos-guest','guest.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'..','..','pos-guest','guest.css'),'utf8');

test('deployed isolated guest page is the same tested five-step customer wizard',()=>{
 assert.doesNotThrow(()=>new vm.Script(guest,{filename:'pos-guest/guest.js'}));
 assert.match(guest,/function createCustomerCheckout/);
 assert.match(guest,/Here is your total\./);
 assert.match(guest,/What's your phone number\?/);
 assert.match(guest,/What's your email address\?/);
 assert.match(guest,/How would you like to pay\?/);
 assert.match(guest,/Apple Cash/);
 assert.doesNotMatch(guest,/function review\(snapshot\)/,'old one-page form must not ship');
 assert.match(css,/guest-payment-option/);
 assert.match(css,/guest-progress-track/);
});
test('published customer page retains isolated guest token transport, not cashier authority',()=>{
 assert.match(guest,/naaqcspvbntzdtwuchrr\.supabase\.co\/functions\/v1\/pos-guest-checkout/);
 assert.match(guest,/event\.source!==window\.parent/);
 assert.match(guest,/cashierOrigin\(event\.origin\)/);
 assert.match(guest,/fetch\(BASE\+'\/guest-checkout\/'\+action/);
 assert.match(guest,/credentials:'omit'/);
 assert.match(guest,/result\.accepted!==true/);
 assert.match(guest,/finally\{token='';\}/);
 assert.doesNotMatch(guest,/pos_staff_complete_cash|pos_finish_order|localStorage|sessionStorage/);
});

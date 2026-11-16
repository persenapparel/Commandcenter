'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {mountCustomerCheckout}=require('../customer-checkout-entry.cjs');
test('guest iframe only announces readiness to the approved cashier origin, without staff credentials',()=>{
 const sent=[],listeners=new Map();
 const parent={postMessage:(message,target)=>sent.push({message,target})};
 const window={
  location:{href:'https://customer.example.test/'},
  opener:null,parent,
  addEventListener:(name,fn)=>listeners.set(name,fn),
  removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name)}
 };
 const mounted=mountCustomerCheckout({window,root:{},
  cashierOrigin:'https://cashier.example.test',
  apiOrigin:'https://api.example.test',
  fetchImpl:async()=>{throw Error('Guest API must not run during ready ping')}});
 assert.deepEqual(sent,[{message:{type:'persen:checkout-ready:v1'},
  target:'https://cashier.example.test'}]);
 assert.equal(listeners.has('message'),true);
 assert.equal(JSON.stringify(sent).includes('Bearer'),false);
 mounted.dispose();
 assert.equal(listeners.has('message'),false);
});
test('a standalone or same-origin guest page cannot emit a readiness signal',()=>{
 const parent={postMessage:()=>{throw Error('Unexpected readiness leak')}};
 const guest={location:{href:'https://cashier.example.test/'},opener:null,parent,
  addEventListener(){},removeEventListener(){}};
 assert.throws(()=>mountCustomerCheckout({window:guest,root:{},
  cashierOrigin:'https://cashier.example.test',
  apiOrigin:'https://api.example.test',
  fetchImpl:async()=>{}}),/Unsafe customer browsing context/);
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createGate}=require('../drawer-open-gate.js');
const saleId='sale-12345678';
const ready={saleId,serverSaved:true,paymentMethod:'cash'};
test('no drawer kick before saved cash payment or for non-cash payments',async()=>{
 let calls=0;
 const bridge={openForSale:async()=>{calls++;return {accepted:true};}};
 for(const opts of [
  {...ready,serverSaved:false,bridge},
  {...ready,paymentMethod:'venmo',bridge},
  {...ready,saleId:'',bridge}
 ])assert.equal((await createGate().requestCashOpen(opts)).status,'blocked');
 assert.equal(calls,0);
});
test('unconfigured drawer is honest and can be handled manually',async()=>{
 const result=await createGate().requestCashOpen(ready);
 assert.equal(result.status,'not-configured');
 assert.match(result.message,/not configured/i);
});
test('one saved sale requests at most one open command',async()=>{
 const gate=createGate();let calls=0;
 const bridge={openForSale:async({saleId,purpose})=>{
  calls++;assert.equal(saleId,ready.saleId);
  assert.equal(purpose,'completed-cash-sale');
  return {accepted:true};
 }};
 const first=await gate.requestCashOpen({...ready,bridge});
 const second=await gate.requestCashOpen({...ready,bridge});
 assert.equal(first.status,'command-accepted');
 assert.equal(second.status,'already-attempted');
 assert.equal(calls,1);
});
test('concurrent requests do not double-open',async()=>{
 const gate=createGate();let calls=0;
 const bridge={openForSale:async()=>{calls++;await Promise.resolve();return {accepted:true};}};
 const [a,b]=await Promise.all([
  gate.requestCashOpen({...ready,bridge}),
  gate.requestCashOpen({...ready,bridge})
 ]);
 assert.equal(calls,1);
 assert.deepEqual(new Set([a.status,b.status]),new Set(['command-accepted','already-attempted']));
});
test('unacknowledged or failed transport never falsely claims drawer opened',async()=>{
 const a=createGate(),b=createGate();
 assert.equal((await a.requestCashOpen({...ready,bridge:{openForSale:async()=>({accepted:false})}})).status,'unconfirmed');
 const bridge={openForSale:async()=>{throw Error('simulated controller failure')}};
 assert.equal((await b.requestCashOpen({...ready,bridge})).status,'unconfirmed');
 assert.equal((await b.requestCashOpen({...ready,bridge})).status,'already-attempted');
});

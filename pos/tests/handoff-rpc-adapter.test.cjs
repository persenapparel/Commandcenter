'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHandoffRpcAdapter}=require('../handoff-rpc-adapter.cjs');
const id='22222222-2222-4222-8222-222222222222';
const wrong='33333333-3333-4333-8333-333333333333';
const shift='44444444-4444-4444-8444-444444444444';
const secret='a'.repeat(64);
test('checkout claim -> guest issue -> original badge resume -> revoke',async()=>{
 const names=[];
 const client={rpc:async(name,args)=>{
  names.push(name);
  assert.equal(args.p_shift_id,shift);
  assert.equal(args.p_shift_secret,secret);
  if(name==='pos_handoff_claim') return {data:{ok:true,checkoutId:id,phase:'claimed'}};
  if(name==='pos_handoff_issue_guest')return {data:{checkoutId:id,capability:'b'.repeat(64)}};
  if(name==='pos_handoff_resume') return {data:{verified:true,checkoutId:id}};
  if(name==='pos_handoff_revoke') return {data:true};
  throw Error('Unexpected RPC');
 }};
 const a=createHandoffRpcAdapter({client,shiftId:shift,shiftSecret:secret});
 await assert.rejects(a.issue(id));
 await a.claim(id);
 await assert.rejects(a.claim(wrong),/Another checkout/);
 await assert.rejects(a.issue(wrong),/not claimed/);
 const grant=await a.issue(id);
 assert.equal(grant.checkoutId,id);
 assert.equal(grant.capability,'b'.repeat(64));
 await assert.rejects(a.resume({checkoutId:wrong,badge:'c'.repeat(32)}));
 assert.deepEqual(await a.resume({checkoutId:id,badge:'c'.repeat(32)}),{verified:true,checkoutId:id});
 await grant.revoke();
 assert.equal(a.current(),null);
 assert.deepEqual(names,['pos_handoff_claim','pos_handoff_issue_guest',
  'pos_handoff_resume','pos_handoff_revoke']);
});
test('failed revocation leaves checkout claimed and rejects new checkout',async()=>{
 const client={rpc:async(name)=>{
  if(name==='pos_handoff_claim')return {data:{ok:true,checkoutId:id,phase:'claimed'}};
  return {error:{message:'server unavailable'},data:null};
 }};
 const a=createHandoffRpcAdapter({client,shiftId:shift,shiftSecret:secret});
 await a.claim(id);
 await assert.rejects(a.revoke(id),/unverified/);
 assert.equal(a.current(),id);
 await assert.rejects(a.claim(wrong));
});
test('invalid shift and forged result cannot unlock cashier',async()=>{
 assert.throws(()=>createHandoffRpcAdapter({client:{rpc:()=>{}},shiftId:shift,shiftSecret:'bad'}));
 const a=createHandoffRpcAdapter({client:{rpc:async name=>
  ({data:name==='pos_handoff_claim'?{ok:true,checkoutId:id,phase:'claimed'}
  :{verified:true,checkoutId:wrong}})},shiftId:shift,shiftSecret:secret});
 await a.claim(id);
 await assert.rejects(a.resume({checkoutId:id,badge:'e'.repeat(32)}),/not authorized/);
});

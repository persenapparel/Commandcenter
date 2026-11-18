'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHandoffRpcAdapter}=require('../handoff-rpc-adapter.cjs');
const id='22222222-2222-4222-8222-222222222222';
const wrong='33333333-3333-4333-8333-333333333333';
const shift='44444444-4444-4444-8444-444444444444';
const secret='a'.repeat(64);
const register='55555555-5555-4555-8555-555555555555';
const adapter=options=>createHandoffRpcAdapter({registerId:register,...options});
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
 const a=adapter({client,shiftId:shift,shiftSecret:secret});
 await assert.rejects(a.issue(id));
 await a.claim(id);
 await assert.rejects(a.claim(wrong),/Another checkout/);
 await assert.rejects(a.issue(wrong),/not claimed/);
 const grant=await a.issue(id);
 assert.equal(grant.checkoutId,id);
 assert.equal(grant.capability,'b'.repeat(64));
 await assert.rejects(a.resume({checkoutId:wrong,badge:'c'.repeat(32)}));
 await assert.rejects(a.resume({checkoutId:id,badge:'1234567'}),/Invalid badge/);
 assert.deepEqual(await a.resume({checkoutId:id,badge:'20010485'}),{verified:true,checkoutId:id});
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
 const a=adapter({client,shiftId:shift,shiftSecret:secret});
 await a.claim(id);
 await assert.rejects(a.revoke(id),/unverified/);
 assert.equal(a.current(),id);
 await assert.rejects(a.claim(wrong));
});
test('invalid shift and forged result cannot unlock cashier',async()=>{
 assert.throws(()=>adapter({client:{rpc:()=>{}},shiftId:shift,shiftSecret:'bad'}));
 assert.throws(()=>createHandoffRpcAdapter({client:{rpc:()=>{}},shiftId:shift,shiftSecret:secret}),/Invalid staff register/);
 const a=adapter({client:{rpc:async name=>
  ({data:name==='pos_handoff_claim'?{ok:true,checkoutId:id,phase:'claimed'}
  :{verified:true,checkoutId:wrong}})},shiftId:shift,shiftSecret:secret});
 await a.claim(id);
 await assert.rejects(a.resume({checkoutId:id,badge:'e'.repeat(32)}),/not authorized/);
});

test('staff checkout uses original shift and rejects forged checkout response',async()=>{
 const calls=[];
 const client={rpc:async(name,args)=>{
  calls.push({name,args});
  return {data:id};
 }};
 const a=adapter({client,shiftId:shift,shiftSecret:secret});
 await assert.rejects(a.beginStaffCheckout({registerId:register,items:[],discountBps:0}),/Invalid/);
 await assert.rejects(a.beginStaffCheckout({registerId:register,items:[{qty:1}],discountBps:100}),/zero discount/);
 await assert.rejects(a.beginStaffCheckout({registerId:wrong,items:[{qty:1}]}),/this register/);
 assert.deepEqual(await a.beginStaffCheckout({registerId:register,items:[{qty:1}]}),{checkoutId:id});
 assert.equal(calls.length,1);
 assert.equal(calls[0].name,'pos_staff_begin_checkout');
 assert.equal(calls[0].args.p_shift_id,shift);
 assert.equal(calls[0].args.p_shift_secret,secret);
 assert.equal(calls[0].args.p_discount_bps,0);
 assert.equal(calls[0].args.p_tax_milli,0);
 const forged=adapter({client:{rpc:async()=>({data:wrong.slice(0,12)})},shiftId:shift,shiftSecret:secret});
 await assert.rejects(forged.beginStaffCheckout({registerId:register,items:[{qty:1}]}),/unavailable/);
});
test('staff checkout blocked during claimed customer handoff',async()=>{
 const client={rpc:async(name)=>name==='pos_handoff_claim'?
  {data:{ok:true,checkoutId:id,phase:'claimed'}}:{data:wrong}};
 const a=adapter({client,shiftId:shift,shiftSecret:secret});
 await a.claim(id);
 await assert.rejects(a.beginStaffCheckout({registerId:register,items:[{qty:1}]}),/Another checkout/);
});


test('staff cash and Finish Order require original claimed checkout and shift-bound RPCs',async()=>{
 const calls=[],saleId='55555555-5555-4555-8555-555555555555';
 const client={rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='pos_handoff_claim')return {data:{ok:true,checkoutId:id,phase:'claimed'}};
  if(name==='pos_staff_complete_cash')return {data:saleId};
  if(name==='pos_staff_finish_order')return {data:true};
  throw Error('Unexpected RPC: '+name);
 }};
 const a=adapter({client,shiftId:shift,shiftSecret:secret});
 await assert.rejects(a.completeCash(id,{tenderCents:2500}),/not claimed/);
 await a.claim(id);
 await assert.rejects(a.completeCash(wrong,{tenderCents:2500}),/not claimed/);
 await assert.rejects(a.completeCash(id,{tenderCents:2499.5}),/Invalid/);
 await assert.rejects(a.completeCash(id,{tenderCents:2500,changeBreakdown:[]}),/Invalid/);
 assert.deepEqual(await a.completeCash(id,{tenderCents:2500,receivedBreakdown:{},changeBreakdown:{}}),
   {checkoutId:id,saleId});
 assert.equal(await a.finishOrder(id),true);
 await assert.rejects(a.finishOrder(wrong),/not claimed/);
 assert.deepEqual(calls.map(x=>x.name),['pos_handoff_claim','pos_staff_complete_cash','pos_staff_finish_order']);
 for(const {args} of calls){
  assert.equal(args.p_shift_id,shift);
  assert.equal(args.p_shift_secret,secret);
 }
 assert.equal(calls[1].args.p_tender_cents,2500);
 assert.equal(calls[1].args.p_checkout,id);
 assert.equal(calls[2].args.p_checkout,id);
});
test('staff payment fails closed on server denial and forged sale result',async()=>{
 const a=adapter({client:{rpc:async name=>(
  name==='pos_handoff_claim'?{data:{ok:true,checkoutId:id,phase:'claimed'}}:
  name==='pos_staff_complete_cash'?{data:wrong.slice(0,10)}:{error:{message:'denied'}}
 )},shiftId:shift,shiftSecret:secret});
 await a.claim(id);
 await assert.rejects(a.completeCash(id,{tenderCents:2500}),/not verified/);
 await assert.rejects(a.finishOrder(id),/not verified/);
 assert.equal(a.current(),id);
});


test('post-sale badge-only unlock verifies original active shift and never creates a second shift',async()=>{
 const calls=[];
 const client={rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='pos_staff_resume_shift')return {data:{ok:['correct-owner-badge-1234567890','20010485'].includes(args.p_badge),first_name:'Alex',role:'owner'}};
  if(name==='pos_handoff_claim')return {data:{ok:true,checkoutId:id,phase:'claimed'}};
  throw Error('Unexpected RPC '+name);
 }};
 const a=adapter({client,shiftId:shift,shiftSecret:secret});
 await assert.rejects(a.verifyIdleBadge('short'),/Invalid employee badge/);
 await assert.rejects(a.verifyIdleBadge('wrong-owner-badge-123456789'),/not verified/);
 await assert.rejects(a.verifyIdleBadge('1234567'),/Invalid employee badge/);
 const eightDigitProof=await a.verifyIdleBadge('20010485');
 assert.deepEqual(eightDigitProof,{verified:true,firstName:'Alex'});
 const unlocked=await a.verifyIdleBadge('correct-owner-badge-1234567890');
 assert.deepEqual(unlocked,{verified:true,firstName:'Alex'});
 const last=calls.at(-1);
 assert.equal(last.name,'pos_staff_resume_shift');
 assert.equal(last.args.p_shift_id,shift);
 assert.equal(last.args.p_shift_secret,secret);
 assert.equal(last.args.p_register,register);
 assert.ok(!calls.some(c=>c.name==='pos_staff_start_shift'));
 await a.claim(id);
 await assert.rejects(a.verifyIdleBadge('correct-owner-badge-1234567890'),/Guest checkout must be closed/);
});
test('network failure and forged idle resume responses never unlock',async()=>{
 for(const response of [{error:{message:'offline'}},{data:{ok:false,first_name:'Alex'}},{data:{ok:true,first_name:''}}]){
  const a=adapter({client:{rpc:async()=>response},shiftId:shift,shiftSecret:secret});
  await assert.rejects(a.verifyIdleBadge('correct-owner-badge-1234567890'));
 }
});

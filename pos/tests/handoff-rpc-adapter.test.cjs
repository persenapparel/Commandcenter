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
  if(name==='pos_handoff_status') return {data:{ok:true,checkoutId:id,status:'contact_received'}};
  if(name==='pos_handoff_verify_paid') return {data:{checkoutId:id,completed:true}};
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
 assert.equal(await a.getStatus(id),'contact_received');
 assert.deepEqual(await a.verifyPaid(id),{completed:true,checkoutId:id});
 await grant.revoke();
 assert.equal(a.current(),null);
 assert.deepEqual(names,['pos_handoff_claim','pos_handoff_issue_guest',
  'pos_handoff_resume','pos_handoff_status','pos_handoff_verify_paid',
  'pos_handoff_revoke']);
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

test('browser cannot invent completed status or paid sale',async()=>{
 const client={rpc:async(name)=>{
  if(name==='pos_handoff_claim')return {data:{ok:true,checkoutId:id,phase:'claimed'}};
  if(name==='pos_handoff_status')return {data:{ok:true,checkoutId:wrong,status:'contact_received'}};
  if(name==='pos_handoff_verify_paid')return {data:{checkoutId:id,completed:false}};
  return {error:{message:'blocked'}};
 }};
 const a=createHandoffRpcAdapter({client,shiftId:shift,shiftSecret:secret});
 await a.claim(id);
 await assert.rejects(a.getStatus(id),/not verified/);
 await assert.rejects(a.verifyPaid(id),/not verified/);
});

test('new cashier checkout uses shift-bound owner-granted register RPC, never owner login',async()=>{
 const register='77777777-7777-4777-8777-777777777777';
 const args=[];
 const client={rpc:async(name,payload)=>{
  args.push({name,payload});
  if(name==='pos_staff_begin_checkout')return {data:id,error:null};
  throw Error('Owner-only RPC must not be used');
 }};
 const a=createHandoffRpcAdapter({client,shiftId:shift,shiftSecret:secret});
 const items=[{stock_id:wrong,qty:1,unit_cents:2500,taxable:true}];
 assert.deepEqual(await a.beginStaffCheckout({
  registerId:register,items,discountBps:0,taxMilli:0,eventId:null
 }),{checkoutId:id});
 assert.deepEqual(args,[{name:'pos_staff_begin_checkout',payload:{
  p_shift_id:shift,p_shift_secret:secret,p_register:register,
  p_items:items,p_discount_bps:0,p_tax_milli:0,p_event:null
 }}]);
});
test('failed staff checkout never claims the cashier or exposes a token',async()=>{
 const a=createHandoffRpcAdapter({
  client:{rpc:async()=>({data:null,error:{message:'Unauthorized'}})},
  shiftId:shift,shiftSecret:secret
 });
 await assert.rejects(a.beginStaffCheckout({
  registerId:wrong,items:[{qty:1}]
 }),/Employee checkout unavailable/);
 assert.equal(a.current(),null);
});

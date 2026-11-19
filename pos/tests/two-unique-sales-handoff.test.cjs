'use strict';
/* Offline two-sale acceptance model using the REAL staging bridge+RPC adapter.
 * No real Supabase requests, payment processing, stock mutation or Epson IO.
 * Each checkout gets a unique server ID/capability to reveal stale-state bugs.
 */
const test=require('node:test'),assert=require('node:assert/strict');
const {createStagingHandoffBridge}=require('../staging-handoff-bridge.cjs');
const SHIFT='44444444-4444-4444-8444-444444444444';
const REGISTER='11111111-1111-4111-8111-111111111111';
const ORDERS=[
 {id:'22222222-2222-4222-8222-222222222221',sale:'55555555-5555-4555-8555-555555555551',capability:'a'.repeat(64),price:2500},
 {id:'22222222-2222-4222-8222-222222222222',sale:'55555555-5555-4555-8555-555555555552',capability:'b'.repeat(64),price:3000}
];
const BADGE='CORRECT-EMPLOYEE-BADGE';
function harness(){
 const logs=[],records=new Map(),guestOpened=[],products=[];
 let issued=0,cleared=0,homes=0,opens=0,shiftStarts=0;
 const client={rpc:async(name,args)=>{
  logs.push({name,args});
  const o=records.get(args?.p_checkout);
  if(name==='pos_staff_start_shift'){
   shiftStarts++;
   if(args.p_badge!==BADGE||args.p_pin!=='654321'||args.p_register!==REGISTER)
    return {data:{ok:false}};
   return {data:{ok:true,shift_id:SHIFT,shift_secret:'c'.repeat(64),first_name:'Test',
    role:'cashier',expires_at:'2099-01-01T00:00:00Z'}};
  }
  if(name==='pos_staff_begin_checkout'){
   assert.equal(args.p_shift_id,SHIFT);
   assert.equal(args.p_register,REGISTER);
   assert.equal(args.p_discount_bps,0);
   const row=ORDERS[issued++];
   if(!row)return {data:null,error:{message:'only two test orders'}};
   assert.equal(args.p_items[0].unit_cents,row.price);
   records.set(row.id,{...row,status:'awaiting_customer',paid:false,finished:false,revoked:false,cashCalls:0});
   products.push(args.p_items[0]);
   return {data:row.id};
  }
  if(name==='pos_staff_resume_shift'){
   return {data:{ok:args.p_badge===BADGE,first_name:'Test'}};
  }
  if(!o)return {data:null,error:{message:'unclaimed or stale checkout'}};
  if(name==='pos_handoff_claim')return {data:{ok:true,phase:'claimed',checkoutId:o.id}};
  if(name==='pos_handoff_issue_guest'){
   assert.equal(o.status,'awaiting_customer');
   return {data:{checkoutId:o.id,capability:o.capability}};
  }
  if(name==='pos_handoff_status')return {data:{ok:true,checkoutId:o.id,status:o.status}};
  if(name==='pos_handoff_resume')return {data:{verified:args.p_badge===BADGE,checkoutId:o.id}};
  if(name==='pos_staff_complete_cash'){
   assert.equal(o.status,'contact_received');
   assert.equal(args.p_tender_cents,o.price);
   if(o.paid)return {data:null,error:{message:'sale already recorded'}};
   o.cashCalls++;o.paid=true;
   return {data:o.sale};
  }
  if(name==='pos_staff_finish_order'){
   if(!o.paid||o.finished)return {data:false};
   o.finished=true;o.status='completed';
   return {data:true};
  }
  if(name==='pos_handoff_verify_paid'){
   return {data:{checkoutId:o.id,completed:o.paid&&o.finished}};
  }
  if(name==='pos_handoff_revoke'){
   if(!o.finished)return {data:false};
   o.revoked=true;
   return {data:true};
  }
  throw Error('Unknown RPC '+name);
 }};
 const bridge=createStagingHandoffBridge({
  client,
  getRegisterId:()=>REGISTER,
  getStaffCheckoutRequest:()=>{
   const row=ORDERS[issued];
   if(!row)throw Error('No test cart');
   return {registerId:REGISTER,items:[{stock_id:REGISTER,name:'Christmas Hoodie',qty:1,unit_cents:row.price}],
    discountBps:0,taxMilli:0};
  },
  lockAndVerifyCashier:async checkoutId=>{assert.ok(records.has(checkoutId));return true},
  openGuest:async({checkoutId,capability})=>{
   const record=records.get(checkoutId);
   assert.equal(capability,record.capability);
   assert.equal(record.revoked,false);
   guestOpened.push(checkoutId);
  },
  restoreCashier:async({checkoutId})=>{
   assert.equal(records.get(checkoutId).status,'contact_received');
  },
  unlockRegisterForNextSale:async()=>{opens++;return true},
  finishAuthoritativeSale:async({checkoutId})=>{
   const o=records.get(checkoutId);
   assert.ok(o.finished&&o.paid,'server payment and Finish Order must be confirmed');
  },
  clearGuest:async()=>{cleared++},
  showHome:async()=>{homes++}
 });
 return {bridge,logs,records,products,guestOpened,completeGuest:id=>{
  const o=records.get(id);assert.equal(o.status,'awaiting_customer');
  o.status='contact_received';
 },summary:()=>({issued,cleared,homes,opens,shiftStarts})};
}
test('two distinct sales: single PIN, fresh guest token, verified cash, Finish Order, badge-only next sale',async()=>{
 const h=harness(),b=h.bridge;
 await b.startShift({badge:BADGE,pin:'654321'});
 for(let i=0;i<2;i++){
  const row=ORDERS[i];
  assert.equal(b.state().checkout.phase,'cashier');
  await b.handToCustomer();
  assert.equal(b.state().checkout.checkoutId,row.id);
  assert.equal(b.state().checkout.phase,'guest');
  await assert.rejects(b.recordCash({checkoutId:row.id,payment:{tenderCents:row.price}}),/not authorized/);
  h.completeGuest(row.id);
  await b.confirmCustomerCompleted();b.requireBadge();
  await assert.rejects(b.resumeWithBadge('UNAUTHORIZED-BADGE'),/not authorized/);
  await b.resumeWithBadge(BADGE);
  const receipt=await b.recordCash({checkoutId:row.id,payment:{tenderCents:row.price}});
  assert.deepEqual(receipt,{checkoutId:row.id,saleId:row.sale});
  await b.finishSale({cashCents:row.price});
  assert.equal(b.state().checkout.phase,'home');
  assert.equal(b.state().locked,true);
  assert.equal(h.records.get(row.id).revoked,true);
  assert.equal(h.records.get(row.id).cashCalls,1);
  await assert.rejects(b.handToCustomer(),/badge/);
  if(i===0){
   await assert.rejects(b.unlockNextSale('WRONG-BADGE-1234'),/not verified/);
   const proof=await b.unlockNextSale(BADGE);
   assert.equal(proof.firstName,'Test');
  }
 }
 assert.equal(h.guestOpened.length,2);
 assert.notEqual(h.guestOpened[0],h.guestOpened[1]);
 assert.notEqual(h.records.get(ORDERS[0].id).capability,h.records.get(ORDERS[1].id).capability);
 assert.deepEqual(h.products.map(x=>x.unit_cents),[2500,3000]);
 assert.deepEqual(h.summary(),{issued:2,cleared:2,homes:2,opens:1,shiftStarts:1});
 for(const name of ['pos_staff_begin_checkout','pos_staff_complete_cash','pos_staff_finish_order','pos_handoff_revoke'])
  assert.equal(h.logs.filter(x=>x.name===name).length,2,name+' must run only once per sale');
 assert.equal(h.logs.filter(x=>x.name==='pos_staff_start_shift').length,1,'PIN must be required only once');
});

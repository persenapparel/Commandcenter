'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const registerSource=fs.readFileSync('pos/register.js','utf8');
const restrictedClientSource=registerSource.slice(
 registerSource.indexOf('const secureHandoffRpcNames='),
 registerSource.indexOf('window.PersenPOSRegister=')
);
function registerClient(db){
 return vm.runInNewContext(restrictedClientSource+'\nsecureHandoffClient;', {db});
}
const {createStagingHandoffBridge}=require('../staging-handoff-bridge.cjs');
const ORDER='22222222-2222-4222-8222-222222222222';
const SHIFT='44444444-4444-4444-8444-444444444444';
const TOKEN='b'.repeat(64);
const SECRET='a'.repeat(64);
function fake(overrides={}) {
 let paid=false;
 const calls=[],rpcArgs=[],shift=()=>({ok:true,shift_id:SHIFT,shift_secret:SECRET,
  first_name:'Alex',role:'owner',expires_at:'2099-01-01T00:00:00Z'});
 const client={rpc:async(name,args)=>{
  calls.push(name);rpcArgs.push({name,args});
  if(name==='pos_staff_begin_checkout')return {data:ORDER};
  if(name==='pos_staff_start_shift')return {data:shift()};
  if(name==='pos_handoff_claim')return {data:{ok:true,phase:'claimed',checkoutId:ORDER}};
  if(name==='pos_handoff_issue_guest')return {data:{checkoutId:ORDER,capability:TOKEN}};
  if(name==='pos_handoff_resume')return {data:{verified:args.p_badge==='correct-badge-value-123456',checkoutId:ORDER}};
  if(name==='pos_handoff_status')return {data:{ok:true,checkoutId:ORDER,status}};
  if(name==='pos_staff_complete_cash')return {data:'55555555-5555-4555-8555-555555555555'};
  if(name==='pos_staff_finish_order')return {data:true};
  if(name==='pos_staff_resume_shift')return {data:{ok:args.p_badge==='correct-badge-value-123456',first_name:'Alex',role:'owner'}};
  if(name==='pos_handoff_verify_paid')return {data:{checkoutId:ORDER,completed:paid}};
  if(name==='pos_handoff_revoke')return {data:true};
  throw Error('Unexpected RPC '+name);
 }};
 let status='awaiting_customer';
 let locked=true;
 const bridge=createStagingHandoffBridge({
  client:registerClient(client),
  getStaffCheckoutRequest:async()=>{calls.push('checkout request');return {
   registerId:ORDER,items:[{stock_id:ORDER,qty:1,unit_cents:2500}],
   discountBps:0,taxMilli:0
  }}, 
  lockAndVerifyCashier:async()=>{calls.push('lock');return locked},
  openGuest:async({checkoutId,capability})=>{
   assert.equal(checkoutId,ORDER);assert.equal(capability,TOKEN);
   calls.push('guest');
  },
  restoreCashier:async()=>calls.push('restore'),
  unlockRegisterForNextSale:async()=>{calls.push('reopen');return true},
  finishAuthoritativeSale:async({checkoutId})=>{paid=true;return {checkoutId,completed:true}}, 
  clearGuest:async()=>calls.push('clear'),
  showHome:async()=>calls.push('home'),
  ...overrides
 });
 return {bridge,calls,rpcArgs,setStatus:value=>status=value,setLock:value=>locked=value};
}
test('single iPad secure sequence is shift -> claim -> lock -> guest -> badge -> verified sale -> home',async()=>{
 const {bridge,calls,rpcArgs,setStatus}=fake();
 await assert.rejects(bridge.handToCustomer(),/shift/);
 const shift=await bridge.startShift({badge:'12345678901234567890',pin:'123456'});
 assert.deepEqual(shift,{firstName:'Alex',role:'owner',expiresAt:'2099-01-01T00:00:00Z'});
 assert.doesNotMatch(JSON.stringify(shift),new RegExp(SECRET));
 await bridge.handToCustomer();
 assert.deepEqual(calls.slice(0,6),['pos_staff_start_shift','checkout request',
  'pos_staff_begin_checkout','pos_handoff_claim','lock','pos_handoff_issue_guest']);
 assert.equal(calls[6],'guest');
 const begin=rpcArgs.find(x=>x.name==='pos_staff_begin_checkout').args;
 assert.equal(begin.p_shift_id,SHIFT);
 assert.equal(begin.p_shift_secret,SECRET);
 assert.equal(begin.p_register,ORDER);
 assert.equal(begin.p_discount_bps,0);
 assert.equal(begin.p_tax_milli,0);
 assert.equal(bridge.state().checkout.phase,'guest');
 await assert.rejects(bridge.confirmCustomerCompleted(),/not verified/);
 setStatus('contact_received');
 await bridge.confirmCustomerCompleted();
 bridge.requireBadge();
 await assert.rejects(bridge.resumeWithBadge('wrong-badge-value-123456'));
 assert.equal(bridge.state().checkout.phase,'locked');
 await bridge.resumeWithBadge('correct-badge-value-123456');
 assert.equal(bridge.state().checkout.phase,'payment');
 await bridge.finishSale({cashCents:2500});
 assert.equal(bridge.state().checkout.phase,'home');
 assert.deepEqual(calls.slice(-4),['pos_handoff_verify_paid','pos_handoff_revoke','clear','home']);
 assert.equal(rpcArgs.find(x=>x.name==='pos_handoff_verify_paid').args.p_shift_id,SHIFT);
 await assert.rejects(bridge.finishSale({}),/badge locked/);
});
test('lock failure never issues guest capability or opens guest screen',async()=>{
 const {bridge,calls,setLock}=fake();setLock(false);
 await bridge.startShift({badge:'12345678901234567890',pin:'123456'});
 await assert.rejects(bridge.handToCustomer(),/credentials not cleared/);
 assert.equal(calls.includes('pos_handoff_issue_guest'),false);
 assert.equal(calls.includes('guest'),false);
 assert.equal(bridge.state().checkout.phase,'locked');
});
test('invalid employee credentials cannot start checkout and are not retained',async()=>{
 const {bridge,calls}=fake();
 await assert.rejects(bridge.startShift({badge:'bad',pin:'12'}));
 assert.equal(calls.length,0);
 assert.equal(bridge.state().employee,null);
});
test('failed authoritative sale never revokes guest or shows home',async()=>{
 const {bridge,calls,setStatus}=fake({
  finishAuthoritativeSale:async()=>({completed:false,checkoutId:ORDER})
 });
 await bridge.startShift({badge:'12345678901234567890',pin:'123456'});
 await bridge.handToCustomer();setStatus('contact_received');
 await bridge.confirmCustomerCompleted();bridge.requireBadge();
 await bridge.resumeWithBadge('correct-badge-value-123456');
 await assert.rejects(bridge.finishSale({cashCents:0}),/not verified/);
 assert.equal(bridge.state().checkout.phase,'payment');
 assert.equal(calls.includes('home'),false);
 assert.equal(calls.includes('pos_handoff_revoke'),false);
});

test('staff handoff refuses a forged discount before checkout creation and stays locked',async()=>{
 const {bridge,calls}=fake({
  getStaffCheckoutRequest:async()=>({registerId:ORDER,items:[{qty:1}],discountBps:500,taxMilli:0})
 });
 await bridge.startShift({badge:'12345678901234567890',pin:'123456'});
 await assert.rejects(bridge.handToCustomer(),/zero discount and tax/);
 assert.equal(calls.includes('pos_staff_begin_checkout'),false);
 assert.equal(calls.includes('pos_handoff_issue_guest'),false);
 assert.equal(calls.includes('guest'),false);
 assert.equal(bridge.state().checkout.phase,'locked');
});
test('missing staff checkout request prevents any owner-account fallback',()=>{
 assert.throws(()=>fake({getStaffCheckoutRequest:null}),/Missing staging handoff dependency: getStaffCheckoutRequest/);
});

test('a fake successful UI response cannot finish an unpaid order',async()=>{
 const {bridge,calls,setStatus}=fake({
  finishAuthoritativeSale:async({checkoutId})=>({checkoutId,completed:true})
 });
 await bridge.startShift({badge:'12345678901234567890',pin:'123456'});
 await bridge.handToCustomer();
 setStatus('contact_received');
 await bridge.confirmCustomerCompleted();
 bridge.requireBadge();
 await bridge.resumeWithBadge('correct-badge-value-123456');
 await assert.rejects(bridge.finishSale({cashCents:2500}),/not verified/);
 assert.equal(calls.includes('pos_handoff_verify_paid'),true);
 assert.equal(calls.includes('pos_handoff_revoke'),false);
 assert.equal(calls.includes('home'),false);
 assert.equal(bridge.state().checkout.phase,'payment');
});
test('browser-supplied completion status cannot skip authoritative staff RPC',async()=>{
 const {bridge,setStatus,calls}=fake({
  getAuthoritativeCheckoutStatus:async()=> 'contact_received'
 });
 await bridge.startShift({badge:'12345678901234567890',pin:'123456'});
 await bridge.handToCustomer();
 await assert.rejects(bridge.confirmCustomerCompleted(),/not verified/);
 assert.equal(bridge.state().checkout.phase,'guest');
 assert.ok(calls.includes('pos_handoff_status'));
 setStatus('contact_received');
 await bridge.confirmCustomerCompleted();
 assert.equal(bridge.state().checkout.phase,'customer_complete');
});

test('cash recording stays locked until original employee resumes checkout',async()=>{
 const {bridge,calls,rpcArgs,setStatus}=fake();
 await bridge.startShift({badge:'12345678901234567890',pin:'123456'});
 await bridge.handToCustomer();
 await assert.rejects(bridge.recordCash({checkoutId:ORDER,payment:{tenderCents:2500}}),/not authorized/);
 setStatus('contact_received');
 await bridge.confirmCustomerCompleted();bridge.requireBadge();
 await bridge.resumeWithBadge('correct-badge-value-123456');
 await assert.rejects(bridge.recordCash({checkoutId:'33333333-3333-4333-8333-333333333333',
   payment:{tenderCents:2500}}),/not authorized/);
 const proof=await bridge.recordCash({checkoutId:ORDER,payment:{tenderCents:2500}});
 assert.equal(proof.checkoutId,ORDER);
 assert.equal(proof.saleId,'55555555-5555-4555-8555-555555555555');
 const call=rpcArgs.find(x=>x.name==='pos_staff_complete_cash');
 assert.equal(call.args.p_checkout,ORDER);
 assert.equal(call.args.p_shift_id,SHIFT);
 assert.equal(call.args.p_shift_secret,SECRET);
 assert.equal(call.args.p_tender_cents,2500);
 assert.ok(calls.includes('pos_staff_complete_cash'));
});


test('one PIN per shift and original badge required before second order',async()=>{
 const {bridge,calls,setStatus}=fake();
 await bridge.startShift({badge:'12345678901234567890',pin:'123456'});
 await bridge.handToCustomer();
 setStatus('contact_received');
 await bridge.confirmCustomerCompleted();bridge.requireBadge();
 await bridge.resumeWithBadge('correct-badge-value-123456');
 await bridge.recordCash({checkoutId:ORDER,payment:{tenderCents:2500}});
 await bridge.finishSale({cashCents:2500});
 assert.equal(bridge.state().checkout.phase,'home');
 assert.equal(bridge.state().locked,true);
 await assert.rejects(bridge.handToCustomer(),/badge/);
 await assert.rejects(bridge.unlockNextSale('wrong-badge-value-123456'),/not verified/);
 assert.equal(bridge.state().locked,true);
 const greeting=await bridge.unlockNextSale('correct-badge-value-123456');
 assert.deepEqual(greeting,{firstName:'Alex'});
 assert.equal(calls.filter(name=>name==='reopen').length,1);
 assert.equal(bridge.state().checkout.phase,'cashier');
 assert.equal(bridge.state().locked,false);
 assert.equal(calls.filter(name=>name==='pos_staff_start_shift').length,1);
 assert.equal(calls.filter(name=>name==='pos_staff_resume_shift').length,2);
 await bridge.handToCustomer();
 assert.equal(calls.filter(name=>name==='pos_staff_start_shift').length,1);
 assert.equal(calls.filter(name=>name==='pos_staff_begin_checkout').length,2);
 await bridge.confirmCustomerCompleted();bridge.requireBadge();
 await bridge.resumeWithBadge('correct-badge-value-123456');
 await bridge.recordCash({checkoutId:ORDER,payment:{tenderCents:3000}});
 await bridge.finishSale({cashCents:3000});
 assert.equal(bridge.state().locked,true);
 assert.equal(bridge.state().checkout.phase,'home');
 assert.equal(calls.filter(name=>name==='pos_staff_complete_cash').length,2);
 assert.equal(calls.filter(name=>name==='pos_staff_finish_order').length,2);
 assert.equal(calls.filter(name=>name==='pos_staff_start_shift').length,1);
});
test('idle unlock is denied without a completed sale',async()=>{
 const {bridge}=fake();
 await bridge.startShift({badge:'12345678901234567890',pin:'123456'});
 await assert.rejects(bridge.unlockNextSale('correct-badge-value-123456'),/No locked completed sale/);
});


test('if register cannot reopen after correct badge, next sale remains locked',async()=>{
 const {bridge,setStatus,calls}=fake({unlockRegisterForNextSale:async()=>false});
 await bridge.startShift({badge:'12345678901234567890',pin:'123456'});
 await bridge.handToCustomer();setStatus('contact_received');
 await bridge.confirmCustomerCompleted();bridge.requireBadge();
 await bridge.resumeWithBadge('correct-badge-value-123456');
 await bridge.recordCash({checkoutId:ORDER,payment:{tenderCents:2500}});
 await bridge.finishSale({cashCents:2500});
 await assert.rejects(bridge.unlockNextSale('correct-badge-value-123456'),/reopening failed/);
 assert.equal(bridge.state().locked,true);
 assert.equal(bridge.state().checkout.phase,'home');
 await assert.rejects(bridge.handToCustomer(),/badge/);
 assert.equal(calls.filter(name=>name==='pos_staff_begin_checkout').length,1);
});

test('register boundary rejects unrelated RPCs and missing authenticated client',()=>{
 let calls=0;
 const client=registerClient({rpc:()=>{calls++;}});
 assert.throws(()=>client.rpc('pos_complete_cash',{}),/unavailable/);
 assert.throws(()=>client.rpc('unrelated_admin_rpc',{}),/unavailable/);
 assert.equal(calls,0);
 assert.throws(()=>registerClient(null).rpc('pos_staff_resume_shift',{}),/unavailable/);
});

test('idle lock preserves cart phase and verifies original badge without restarting shift',async()=>{
 const {bridge,calls}=fake();
 assert.equal(bridge.lockForIdle(),false);
 await bridge.startShift({badge:'12345678901234567890',pin:'123456'});
 assert.equal(bridge.lockForIdle(),true);
 await assert.rejects(bridge.handToCustomer(),/badge/);
 await assert.rejects(bridge.unlockIdle('wrong-badge-value-123456'),/not verified/);
 assert.equal(bridge.state().idleLocked,true);
 await bridge.unlockIdle('correct-badge-value-123456');
 assert.equal(bridge.state().locked,false);
 assert.equal(bridge.state().checkout.phase,'cashier');
 assert.equal(calls.includes('reopen'),false);
 assert.equal(calls.filter(x=>x==='pos_staff_start_shift').length,1);
 await bridge.handToCustomer();
 assert.equal(bridge.lockForIdle(),false,'customer screen must not be interrupted');
});
test('idle payment lock blocks cash and finish and resumes the exact checkout',async()=>{
 const {bridge,calls,setStatus}=fake();
 await bridge.startShift({badge:'12345678901234567890',pin:'123456'});
 await bridge.handToCustomer();setStatus('contact_received');
 await bridge.confirmCustomerCompleted();bridge.requireBadge();
 await bridge.resumeWithBadge('correct-badge-value-123456');
 assert.equal(bridge.lockForIdle(),true);
 await assert.rejects(bridge.recordCash({checkoutId:ORDER,payment:{tenderCents:2500}}),/badge locked/);
 await assert.rejects(bridge.finishSale({}),/badge locked/);
 await assert.rejects(bridge.unlockIdle('wrong-badge-value-123456'));
 assert.equal(bridge.state().locked,true);
 setStatus('cancelled');
 await assert.rejects(bridge.unlockIdle('correct-badge-value-123456'),/no longer available/);
 assert.equal(bridge.state().locked,true);
 setStatus('completed'); // Cash may already have been recorded before idle.
 await bridge.unlockIdle('correct-badge-value-123456');
 assert.equal(bridge.state().checkout.phase,'payment');
 assert.equal(bridge.state().checkout.checkoutId,ORDER);
 assert.equal(calls.filter(x=>x==='pos_handoff_resume').length,1);
 assert.equal(calls.includes('pos_staff_complete_cash'),false);
});
test('idle lock waits for a pending cash request and rejects duplicate cash submissions',async()=>{
 let release;
 // Use the real register client boundary with a delayed cash response.
 let cashCalls=0;
 const client={rpc:async(name)=>{
  if(name==='pos_staff_start_shift')return {data:{ok:true,shift_id:SHIFT,shift_secret:SECRET,first_name:'Alex',role:'owner',expires_at:'2099-01-01'}};
  if(name==='pos_staff_begin_checkout')return {data:ORDER};
  if(name==='pos_handoff_claim')return {data:{ok:true,phase:'claimed',checkoutId:ORDER}};
  if(name==='pos_handoff_issue_guest')return {data:{checkoutId:ORDER,capability:TOKEN}};
  if(name==='pos_handoff_status')return {data:{ok:true,checkoutId:ORDER,status:'contact_received'}};
  if(name==='pos_handoff_resume')return {data:{verified:true,checkoutId:ORDER}};
  if(name==='pos_staff_complete_cash'){cashCalls++;return new Promise(resolve=>{release=()=>resolve({data:ORDER})});}
  throw Error(name);
 }};
 const {bridge}=fake({client:registerClient(client)});
 await bridge.startShift({badge:'12345678901234567890',pin:'123456'});
 await bridge.handToCustomer();await bridge.confirmCustomerCompleted();bridge.requireBadge();
 await bridge.resumeWithBadge('correct-badge-value-123456');
 const pending=bridge.recordCash({checkoutId:ORDER,payment:{tenderCents:2500}});
 assert.equal(bridge.lockForIdle(),false);
 await assert.rejects(bridge.recordCash({checkoutId:ORDER,payment:{tenderCents:2500}}),/already pending/);
 await assert.rejects(bridge.finishSale({}),/already pending/);
 release();await pending;
 assert.equal(cashCalls,1);
 assert.equal(bridge.lockForIdle(),true);
});

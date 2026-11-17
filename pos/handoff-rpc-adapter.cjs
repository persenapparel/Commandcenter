'use strict';
/**
 * STAGING ONLY. Cashier-origin adapter for the unapplied checkout-handoff RPCs.
 * Intentionally not imported into register.js or built for the guest origin.
 * The caller must hold a valid server-verified shift in MEMORY ONLY and
 * independently enforce the UI lock and isolated browsing-context lifecycle.
 */
function createHandoffRpcAdapter({client,shiftId,shiftSecret}) {
 if (!client || typeof client.rpc!=='function') throw Error('Supabase RPC client required');
 if (typeof shiftId!=='string' || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(shiftId))
  throw Error('Invalid staff shift id');
 if (typeof shiftSecret!=='string' || !/^[a-f0-9]{64}$/.test(shiftSecret))
  throw Error('Invalid staff shift secret');
 let active=null;
 async function rpc(name,args) {
  const {data,error}=await client.rpc(name,args);
  // Never show server SQL errors on a customer display.
  if (error) throw Error('Checkout authorization unavailable');
  if (!data || typeof data!=='object' || Array.isArray(data))
   throw Error('Invalid checkout authorization response');
  return data;
 }
 function same(id) {
  if (typeof id!=='string' || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id))
   throw Error('Invalid checkout id');
  if (active!==id) throw Error('Checkout is not claimed for this cashier');
 }
 async function beginStaffCheckout({registerId,items,discountBps=0,taxMilli=0,eventId=null}) {
  if(active) throw Error('Another checkout is already claimed');
  if(typeof registerId!=='string' || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(registerId) ||
     !Array.isArray(items) || items.length<1 || items.length>80)
   throw Error('Invalid employee checkout request');
  if(!Number.isInteger(discountBps) || discountBps!==0 ||
     !Number.isInteger(taxMilli) || taxMilli!==0)
   throw Error('Employee checkout requires approved zero discount and tax');
  const {data,error}=await client.rpc('pos_staff_begin_checkout',{
   p_shift_id:shiftId,p_shift_secret:shiftSecret,p_register:registerId,
   p_items:items,p_discount_bps:discountBps,p_tax_milli:taxMilli,p_event:eventId
  });
  if(error || typeof data!=='string' || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(data))
   throw Error('Employee checkout unavailable');
  return {checkoutId:data};
 }
 async function claim(checkoutId) {
  if (active) throw Error('Another checkout is already claimed');
  const result=await rpc('pos_handoff_claim',{
   p_checkout:checkoutId,p_shift_id:shiftId,p_shift_secret:shiftSecret
  });
  if(result.ok!==true || result.checkoutId!==checkoutId || result.phase!=='claimed')
   throw Error('Checkout claim was rejected');
  active=checkoutId;
  return {checkoutId};
 }
 async function issue(checkoutId) {
  same(checkoutId);
  const result=await rpc('pos_handoff_issue_guest',{
   p_checkout:checkoutId,p_shift_id:shiftId,p_shift_secret:shiftSecret
  });
  if(result.checkoutId!==checkoutId || typeof result.capability!=='string' ||
     !/^[a-f0-9]{64}$/.test(result.capability))
   throw Error('Invalid guest authorization');
  return Object.freeze({
   checkoutId,capability:result.capability,
   revoke:async()=>{await revoke(checkoutId)}
  });
 }
 async function resume({checkoutId,badge}) {
  same(checkoutId);
  if(typeof badge!=='string' || badge.length<16 || badge.length>256)
   throw Error('Invalid badge');
  const result=await rpc('pos_handoff_resume',{
   p_checkout:checkoutId,p_shift_id:shiftId,p_shift_secret:shiftSecret,
   p_badge:badge
  });
  if(result.verified!==true || result.checkoutId!==checkoutId)
   throw Error('Badge is not authorized for checkout');
  return {verified:true,checkoutId};
 }
 async function getStatus(checkoutId) {
  same(checkoutId);
  const result=await rpc('pos_handoff_status',{
   p_checkout:checkoutId,p_shift_id:shiftId,p_shift_secret:shiftSecret
  });
  if(result.ok!==true || result.checkoutId!==checkoutId ||
     !['awaiting_customer','contact_received','completed','cancelled'].includes(result.status))
   throw Error('Checkout status not verified');
  return result.status;
 }
 async function verifyPaid(checkoutId) {
  same(checkoutId);
  const result=await rpc('pos_handoff_verify_paid',{
   p_checkout:checkoutId,p_shift_id:shiftId,p_shift_secret:shiftSecret
  });
  if(result.checkoutId!==checkoutId || result.completed!==true)
   throw Error('Cash payment or finish order not verified');
  return {completed:true,checkoutId};
 }
 async function revoke(checkoutId) {
  same(checkoutId);
  const result=await client.rpc('pos_handoff_revoke',{
   p_checkout:checkoutId,p_shift_id:shiftId,p_shift_secret:shiftSecret
  });
  if(result.error || result.data!==true)
   throw Error('Guest authorization revocation unverified');
  active=null;
 }
 // A resumed cashier may record cash and finish only for its exact claimed checkout.
 // Never fall back to the owner-only payment RPCs.
 async function completeCash(checkoutId,{tenderCents,receivedBreakdown={},changeBreakdown={},expectedDrawerVersion=null}={}) {
  same(checkoutId);
  if(!Number.isInteger(tenderCents)||tenderCents<0||tenderCents>1000000 ||
     !receivedBreakdown||typeof receivedBreakdown!=='object'||Array.isArray(receivedBreakdown)||
     !changeBreakdown||typeof changeBreakdown!=='object'||Array.isArray(changeBreakdown)||
     (expectedDrawerVersion!==null&&(!Number.isInteger(expectedDrawerVersion)||expectedDrawerVersion<0)))
   throw Error('Invalid staff cash request');
  const {data,error}=await client.rpc('pos_staff_complete_cash',{
   p_shift_id:shiftId,p_shift_secret:shiftSecret,p_checkout:checkoutId,
   p_tender_cents:tenderCents,p_received_breakdown:receivedBreakdown,
   p_change_breakdown:changeBreakdown,p_expected_drawer_version:expectedDrawerVersion
  });
  if(error||typeof data!=='string'||! /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(data))
   throw Error('Staff cash payment not verified');
  return Object.freeze({checkoutId,saleId:data});
 }
 async function finishOrder(checkoutId) {
  same(checkoutId);
  const {data,error}=await client.rpc('pos_staff_finish_order',{
   p_shift_id:shiftId,p_shift_secret:shiftSecret,p_checkout:checkoutId
  });
  if(error||data!==true)throw Error('Staff Finish Order not verified');
  return true;
 }
 // After a verified completed sale, unlock the next sale by re-scanning the
 // original employee badge. No second PIN and no new shift is created.
 async function verifyIdleBadge(badge) {
  if(active)throw Error('Guest checkout must be closed before register unlock');
  return verifyShiftBadge(badge);
 }
 async function verifyShiftBadge(badge) {
  if(typeof badge!=='string'||badge.length<16||badge.length>256)
   throw Error('Invalid employee badge');
  const result=await rpc('pos_staff_resume_shift',{
   p_shift_id:shiftId,p_shift_secret:shiftSecret,p_badge:badge
  });
  if(result.ok!==true||typeof result.first_name!=='string'||
     result.first_name.length<1||result.first_name.length>80)
   throw Error('Original employee badge not verified');
  return Object.freeze({verified:true,firstName:result.first_name});
 }
 return Object.freeze({beginStaffCheckout,claim,issue,resume,getStatus,verifyPaid,
  completeCash,finishOrder,verifyIdleBadge,verifyShiftBadge,revoke,current:()=>active});
}
module.exports={createHandoffRpcAdapter};

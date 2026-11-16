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
 async function revoke(checkoutId) {
  same(checkoutId);
  const result=await client.rpc('pos_handoff_revoke',{
   p_checkout:checkoutId,p_shift_id:shiftId,p_shift_secret:shiftSecret
  });
  if(result.error || result.data!==true)
   throw Error('Guest authorization revocation unverified');
  active=null;
 }
 return Object.freeze({claim,issue,resume,revoke,current:()=>active});
}
module.exports={createHandoffRpcAdapter};

'use strict';
// Staging-only orchestration contract. Not included in production build.
// This binds the existing POS cart creator and cash verifier to the
// checkout-specific RPC adapter. A real browser adapter must prove that
// the guest origin has no cashier credentials before returning true from lock.
// Never store a staff secret in storage, URL, logs, or a DOM attribute.
const {createHandoffRpcAdapter}=require('./handoff-rpc-adapter.cjs');
const {createHandoffCoordinator}=require('./checkout-handoff-coordinator.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const SECRET=/^[0-9a-f]{64}$/i;
function createStagingHandoffBridge({
 client, getStaffCheckoutRequest, lockAndVerifyCashier, openGuest,
 restoreCashier,
 finishAuthoritativeSale, clearGuest, showHome
}) {
 if(!client || typeof client.rpc!=='function')throw Error('Authenticated RPC client required');
 const tasks={getStaffCheckoutRequest,lockAndVerifyCashier,openGuest,
  restoreCashier,finishAuthoritativeSale,
  clearGuest,showHome};
 for(const [name,fn] of Object.entries(tasks))if(typeof fn!=='function')
  throw Error('Missing staging handoff dependency: '+name);
 let cashier=null,adapter=null,coordinator=null,starting=false;
 const call=async(name,args)=>{
  const result=await client.rpc(name,args);
  if(result?.error || !result || !result.data || typeof result.data!=='object')
   throw Error('Employee authorization unavailable');
  return result.data;
 };
 async function startShift({badge,pin}) {
  if(cashier || starting)throw Error('Shift already active');
  if(typeof badge!=='string' || badge.length<16 || badge.length>256 ||
     typeof pin!=='string' || pin.length<4 || pin.length>128)
   throw Error('Invalid employee credentials');
  starting=true;
  try{
   const auth=await call('pos_staff_start_shift',{p_badge:badge,p_pin:pin});
   if(auth.ok!==true || !UUID.test(auth.shift_id||'') ||
      !SECRET.test(auth.shift_secret||'') ||
      typeof auth.first_name!=='string' || !auth.first_name ||
      !['owner','cashier'].includes(auth.role) ||
      !(Date.parse(auth.expires_at)>Date.now()))
    throw Error('Employee authorization denied');
   adapter=createHandoffRpcAdapter({client,shiftId:auth.shift_id,shiftSecret:auth.shift_secret});
   cashier=Object.freeze({firstName:auth.first_name.slice(0,80),
     role:auth.role,expiresAt:auth.expires_at});
   coordinator=createHandoffCoordinator({
    beginCheckout:async()=>{
     // The owner-only checkout RPC must never be used for employee handoff.
     // The adapter binds this creation to the authenticated original shift.
     const request=await getStaffCheckoutRequest();
     const opened=await adapter.beginStaffCheckout(request);
     const checkoutId=opened.checkoutId;
     if(!UUID.test(checkoutId||''))throw Error('Invalid checkout creation result');
     return adapter.claim(checkoutId);
    },
    lockCashier:lockAndVerifyCashier,
    issueCheckoutCapability:checkoutId=>adapter.issue(checkoutId),
    openIsolatedGuest:openGuest,
    // Status must be checked against the original shift on the server;
    // a browser callback cannot declare that the guest completed checkout.
    getCheckoutStatus:checkoutId=>adapter.getStatus(checkoutId),
    verifyShiftBadge:({checkoutId,badge})=>adapter.resume({checkoutId,badge}),
    resumeCashier:restoreCashier,
    // The UI may initiate simulated payment, but cannot declare success.
    // Always ask the server to verify this exact checkout is paid AND
    // explicitly finished before revoking the guest and going home.
    finishVerifiedSale:async({checkoutId,payment})=>{
     await finishAuthoritativeSale({checkoutId,payment});
     return adapter.verifyPaid(checkoutId);
    },
    clearGuestContext:clearGuest,
    showBrandedHome:showHome
   });
   return cashier; // NEVER returns shift secret, ID, or guest bearer
  }finally{starting=false}
 }
 function assertReady(){
  if(!cashier || !coordinator || Date.parse(cashier.expiresAt)<=Date.now())
   throw Error('Employee shift is not active');
 }
 async function handToCustomer(){assertReady();return coordinator.handToCustomer()}
 async function confirmCustomerCompleted(){assertReady();return coordinator.customerCompleted()}
 function requireBadge(){assertReady();return coordinator.showCashierLock()}
 async function resumeWithBadge(badge){assertReady();return coordinator.badgeResume(badge)}
 async function finishSale(payment){assertReady();return coordinator.finishSale(payment)}
 function state(){return Object.freeze({employee:cashier,
  checkout:coordinator?coordinator.state():null})}
 return Object.freeze({startShift,handToCustomer,confirmCustomerCompleted,
  requireBadge,resumeWithBadge,finishSale,state});
}
module.exports={createStagingHandoffBridge};

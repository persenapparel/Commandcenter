'use strict';
/* Single-swivel-iPad idle decision policy. Pure, fail-closed and independent of
 * browser timers. The caller MUST enforce server-side session revocation.
 * This module alone does not lock a register or authorize a badge.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PersenPOSIdlePolicy=api;
})(typeof window!=='undefined'?window:globalThis,function(){
 const IDLE_MS=30_000;
 const BLOCKING_STATES=new Set([
  'awaiting_customer','contact_received','payment','cash_entry','signature',
  'processing','saving','pending_network','printing','editing','recovery'
 ]);
 function safeBetweenTransactions(s){
  if(!s||typeof s!=='object')return false;
  if(s.authPending||s.checkout||s.pendingCash||s.pendingNetwork||s.pendingPrint||
     s.unsavedChanges||s.signatureActive||s.editing||s.processing||s.recovery) return false;
  if(!Array.isArray(s.cart)||s.cart.length!==0)return false;
  if(typeof s.stage!=='string'||BLOCKING_STATES.has(s.stage))return false;
  return s.stage==='catalog'||s.stage==='idle'||s.stage==='completed';
 }
 function shouldLock(s,nowMs,lastActivityMs){
  if(!Number.isFinite(nowMs)||!Number.isFinite(lastActivityMs))return false;
  if(nowMs<lastActivityMs)return false;
  return nowMs-lastActivityMs>=IDLE_MS&&safeBetweenTransactions(s);
 }
 function afterAuthoritativeFinish(result){
  // Never reset the customer-facing screen on an optimistic or failed finish.
  return Boolean(result&&result.serverCommitted===true&&result.saleId&&
    result.receiptJobsPersisted===true);
 }
 return Object.freeze({IDLE_MS,safeBetweenTransactions,shouldLock,afterAuthoritativeFinish});
});

'use strict';
/* Pure, dependency-free policy predicates. These are UI guards only; every
 * protected operation MUST repeat checks on the server with authenticated
 * identity, current roles, RLS, and audit logging.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.PersenPOSEmployeePolicy=api;
})(typeof window==='object'?window:globalThis,function(){
 const ROLES=Object.freeze(['employee','manager','owner']);
 const PERMISSIONS=Object.freeze({
  sales:['employee','manager','owner'],
  inventory_read:['employee','manager','owner'],
  inventory_adjust:['manager','owner'],
  refunds:['manager','owner'],
  returns:['employee','manager','owner'],
  return_exception:['owner']
 });
 function allowed(role,action){
  return typeof role==='string'&&Object.hasOwn(PERMISSIONS,action)&&PERMISSIONS[action].includes(role);
 }
 function shouldLock(lastActivityMs,nowMs,_checkoutActive){
  if(!Number.isFinite(lastActivityMs)||!Number.isFinite(nowMs)||nowMs<lastActivityMs)return true;
  // An active cart is NOT an exception to the 30-second privacy lock. The
  // lock UI must conceal it without deleting it; the server must separately
  // revoke privileged actions until verified reauthentication.
  return nowMs-lastActivityMs>=30000;
 }
 function scanSku(value){
  if(typeof value!=='string')return null;
  const sku=value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/.test(sku)?sku:null;
 }
 function canCompleteSale({serverConfirmed,receiptQueued}={}){
  return serverConfirmed===true&&receiptQueued===true;
 }
 return Object.freeze({ROLES,PERMISSIONS,allowed,shouldLock,scanSku,canCompleteSale});
});

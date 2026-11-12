'use strict';
/** Staging-only cash drawer accounting. Pure calculations, NOT owner authentication or persistence. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PersenDrawerPolicy=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const valid=n=>Number.isSafeInteger(n)&&n>=0&&n<=100000000;
 const requireCents=(n,label)=>{if(!valid(n))throw Error('Invalid '+label);return n;};
 const denominations=Object.freeze([10000,5000,2000,1000,500,100,25,10,5,1]);
 function countDenominations(counts){
  if(!counts||typeof counts!=='object'||Array.isArray(counts))throw Error('Invalid denominations');
  let sum=0;
  for(const [key,value] of Object.entries(counts)){
   const denomination=Number(key);
   if(!denominations.includes(denomination)||!Number.isSafeInteger(value)||value<0||value>100000)throw Error('Invalid denomination count');
   sum+=denomination*value;
   if(!valid(sum))throw Error('Cash count overflow');
  }
  return sum;
 }
 function drawerSummary({openingCents,cashTenders=[],cashChange=[],cashRefunds=[],countedCents,countedDenominations}){
  let expected=requireCents(openingCents,'opening amount');
  const add=(items,sign,label)=>{
   if(!Array.isArray(items))throw Error('Invalid '+label);
   for(const n of items){requireCents(n,label);expected+=sign*n;if(!Number.isSafeInteger(expected)||Math.abs(expected)>100000000)throw Error('Drawer overflow');}
  };
  add(cashTenders,1,'cash tender');add(cashChange,-1,'cash change');add(cashRefunds,-1,'cash refund');
  if(expected<0)throw Error('Negative expected drawer');
  if(countedCents!==undefined&&countedDenominations!==undefined)throw Error('Select one counting method');
  const counted=countedDenominations!==undefined?countDenominations(countedDenominations):countedCents;
  if(counted!==undefined)requireCents(counted,'counted cash');
  return {expectedCents:expected,countedCents:counted??null,varianceCents:counted===undefined?null:counted-expected};
 }
 /**
  * Fail-closed policy gate. A browser object claiming "serverVerified" is NEVER
  * proof of approval. Only the authenticated backend can supply trustedContext
  * after verifying and atomically consuming a fresh single-action approval.
  * This helper is NOT a substitute for backend authorization.
  */
 function authorizeAction({actorRole,action,approval,trustedContext}={}){
  const ownerActions=['open-register','close-register','refund','discount','price-override','receipt-reprint','venmo-partial'];
  if(!ownerActions.includes(action)||!['owner','staff'].includes(actorRole))return false;
  if(!trustedContext||trustedContext.source!=='authenticated-server'||trustedContext.approvalConsumed!==true||trustedContext.actorAuthenticated!==true)return false;
  if(!approval||approval.action!==action||typeof approval.ownerId!=='string'||!approval.ownerId||typeof approval.actorId!=='string'||!approval.actorId)return false;
  if(approval.actorId!==trustedContext.actorId||approval.ownerId!==trustedContext.ownerId)return false;
  if(!Number.isSafeInteger(approval.verifiedAt)||!Number.isSafeInteger(approval.expiresAt)||!Number.isSafeInteger(trustedContext.now))return false;
  if(approval.expiresAt<=approval.verifiedAt||trustedContext.now<approval.verifiedAt||trustedContext.now>=approval.expiresAt)return false;
  if(approval.id!==trustedContext.consumedApprovalId||typeof approval.id!=='string'||!approval.id)return false;
  return true;
 }

 return Object.freeze({denominations,countDenominations,drawerSummary,authorizeAction});
});

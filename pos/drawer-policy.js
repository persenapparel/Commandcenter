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
 function authorizeAction({actorRole,action,approval}){
  const ownerActions=['open-register','close-register','refund','discount','price-override','receipt-reprint','venmo-partial'];
  if(!ownerActions.includes(action))throw Error('Unsupported action');
  // This is a fail-closed contract for a backend; never trust client-supplied approval.
  if(!approval||approval.serverVerified!==true||approval.action!==action||typeof approval.ownerId!=='string'||!approval.ownerId||typeof approval.actorId!=='string'||!approval.actorId||!Number.isSafeInteger(approval.expiresAt)||!Number.isSafeInteger(approval.verifiedAt)||approval.expiresAt<=approval.verifiedAt) return false;
  return actorRole==='owner'||actorRole==='staff';
 }
 return Object.freeze({denominations,countDenominations,drawerSummary,authorizeAction});
});

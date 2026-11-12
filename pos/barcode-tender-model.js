'use strict';
/**
 * Persen POS staging-only barcode and tender policy.
 * Pure business logic; NEVER authorization, payment verification, inventory
 * reservation, or server-side order commitment. Server must enforce all three.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PersenPOSBarcodeTender=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const MAX_CENTS=100000000;
 const cents=n=>Number.isSafeInteger(n)&&n>=0&&n<=MAX_CENTS;
 const text=x=>typeof x==='string'&&x.length>0&&x.length<=120&&/^[\x20-\x7e]+$/.test(x);
 const normalizeCode=x=>{if(!text(x))throw Error('Invalid barcode');const code=x.trim().toUpperCase();if(!/^[A-Z0-9_-]{3,64}$/.test(code))throw Error('Unsupported barcode characters');return code;};
 const skuFor=(productId,variantId)=>{const p=normalizeCode(productId),v=normalizeCode(variantId);return 'PA-'+p+'-'+v;};
 function buildBarcodeIndex(variants){
  if(!Array.isArray(variants))throw Error('Invalid variants');
  const index=new Map();
  for(const v of variants){
   if(!v||!text(v.productId)||!text(v.variantId)||!text(v.label)||!cents(v.unitCents)||!Number.isSafeInteger(v.available)||v.available<0)throw Error('Invalid variant');
   const code=normalizeCode(v.barcode||skuFor(v.productId,v.variantId));
   if(index.has(code))throw Error('Duplicate barcode');
   index.set(code,{productId:v.productId,variantId:v.variantId,label:v.label,unitCents:v.unitCents,available:v.available,barcode:code});
  }
  return index;
 }
 function scanCart(index,cart,raw){
  if(!(index instanceof Map)||!Array.isArray(cart))throw Error('Invalid cart/index');
  const code=normalizeCode(raw),variant=index.get(code);
  if(!variant)return {status:'not-found',code,action:'search',cart:cart.slice()};
  const current=cart.find(x=>x.variantId===variant.variantId);
  const next=(current?.quantity||0)+1;
  if(next>variant.available)return {status:'sold-out',code,variantId:variant.variantId,alternatives:[...index.values()].filter(v=>v.productId===variant.productId&&v.variantId!==variant.variantId&&v.available>0).map(v=>({variantId:v.variantId,label:v.label})),cart:cart.slice()};
  const line={productId:variant.productId,variantId:variant.variantId,label:variant.label,unitCents:variant.unitCents,quantity:next};
  return {status:'added',code,cart:current?cart.map(x=>x.variantId===line.variantId?line:x):[...cart,line]};
 }
 const METHODS=Object.freeze({CASH:'cash',VENMO:'venmo'});
 function totalWithTip(subtotal,tip){if(!cents(subtotal)||!cents(tip)||!cents(subtotal+tip))throw Error('Invalid total');return subtotal+tip;}
 function tenderSummary(total,tenders){
  if(!cents(total)||!Array.isArray(tenders))throw Error('Invalid tender summary');
  let received=0,verified=0,cash=0;
  for(const t of tenders){
   if(!t||!Object.values(METHODS).includes(t.method)||!cents(t.amountCents)||t.amountCents===0)throw Error('Invalid tender');
   if(t.method===METHODS.VENMO&&!['pending','verified'].includes(t.status))throw Error('Venmo requires explicit verification status');
   if(t.method===METHODS.CASH&&t.status!=='received')throw Error('Cash must be received');
   received+=t.amountCents;
   if(t.method===METHODS.CASH){verified+=t.amountCents;cash+=t.amountCents;}
   if(t.method===METHODS.VENMO&&t.status==='verified')verified+=t.amountCents;
   if(!Number.isSafeInteger(received)||received>MAX_CENTS)throw Error('Tender overflow');
  }
  const pending=received-verified;
  const remaining=Math.max(0,total-verified);
  const change=Math.max(0,verified-total);
  // A Venmo overpayment is NOT cash change owed.
  const cashChange=Math.min(change,cash);
  return {totalCents:total,receivedCents:received,verifiedCents:verified,pendingCents:pending,remainingCents:remaining,changeCents:change,cashChangeCents:cashChange,readyToFinish:pending===0&&verified>=total};
 }
 function addTender(tenders,tender){
  const result=tenderSummary(0,[...tenders,tender]);
  return {tenders:[...tenders,{...tender}],summary:result};
 }
 function verifyVenmo(tenders,index,{actualReceivedCents,confirmedByCashier}){
  if(!Array.isArray(tenders)||!Number.isInteger(index)||index<0||index>=tenders.length)throw Error('Unknown tender');
  const t=tenders[index];
  if(t.method!==METHODS.VENMO||t.status!=='pending'||actualReceivedCents!==t.amountCents||confirmedByCashier!==true)throw Error('Venmo payment not independently verified');
  return tenders.map((x,i)=>i===index?{...x,status:'verified'}:{...x});
 }
 function receiptChoice(choice){if(!['print','email','none'].includes(choice))throw Error('Invalid receipt choice');return choice;}
 return {METHODS,normalizeCode,skuFor,buildBarcodeIndex,scanCart,totalWithTip,tenderSummary,addTender,verifyVenmo,receiptChoice};
});

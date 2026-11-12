'use strict';
/**
 * Persen POS landscape presentation and cash-handoff guards.
 * Pure state machine: NOT an authorization, payment, stock reservation, or sync layer.
 * Caller must verify server-side register/employee permissions and persist completed
 * orders idempotently BEFORE invoking finishOrder. Never trust client totals.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.PersenPOSLandscape=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const WELCOME='Welcome to Persen Apparel';
 const STAGES=Object.freeze({HOME:'home',CATALOG:'catalog',TENDER:'tender',RECEIPT:'receipt'});
 const safeCents=n=>Number.isSafeInteger(n)&&n>=0&&n<=100000000;
 function assertMoney(n){if(!safeCents(n))throw Error('Invalid cents amount');return n;}
 function initial(){return {stage:STAGES.HOME,employeeId:null,registerOpen:false,cart:[],tenderCents:null,completedId:null};}
 function startSale(state,{employeeId,registerOpen}){
  if(state.stage!==STAGES.HOME||!registerOpen||typeof employeeId!=='string'||!employeeId.trim())throw Error('Register must be open and cashier authenticated');
  return {...state,stage:STAGES.CATALOG,employeeId,registerOpen:true,cart:[],tenderCents:null,completedId:null};
 }
 function addVariant(state,{productId,variantId,label,unitCents,quantity,available}){
  if(state.stage!==STAGES.CATALOG)throw Error('Not in catalog');
  if(!productId||!variantId||typeof label!=='string'||!label.trim()||!Number.isSafeInteger(quantity)||quantity<=0||!safeCents(unitCents)||!Number.isSafeInteger(available)||available<0)throw Error('Invalid product variant');
  const existing=state.cart.find(x=>x.variantId===variantId);
  const next=(existing?.quantity||0)+quantity;
  if(next>available)throw Error('Sold Out: selected size unavailable');
  const item={productId,variantId,label,unitCents,quantity:next};
  return {...state,cart:existing?state.cart.map(x=>x.variantId===variantId?item:x):[...state.cart,item],tenderCents:null};
 }
 function totalCents(state){
  const sum=state.cart.reduce((n,x)=>n+x.unitCents*x.quantity,0);
  return assertMoney(sum);
 }
 function toTender(state){
  if(state.stage!==STAGES.CATALOG||!state.cart.length)throw Error('Cart is empty');
  return {...state,stage:STAGES.TENDER,tenderCents:null};
 }
 function enterCash(state,tenderCents){
  if(state.stage!==STAGES.TENDER)throw Error('Not on payment screen');
  assertMoney(tenderCents);
  if(tenderCents<totalCents(state))throw Error('Insufficient cash tender');
  return {...state,tenderCents};
 }
 function customerView(state){
  if(state.stage===STAGES.HOME||state.stage===STAGES.RECEIPT)return {mode:state.stage===STAGES.HOME?'idle':'thank-you',welcome:WELCOME,items:[],totalCents:null,receivedCents:null,changeCents:null};
  return {mode:'checkout',items:state.cart.map(x=>({label:x.label,quantity:x.quantity,unitCents:x.unitCents})),totalCents:totalCents(state),receivedCents:state.tenderCents,changeCents:state.tenderCents===null?null:state.tenderCents-totalCents(state),status:state.tenderCents===null?'Awaiting cash':'Awaiting Finish Order'};
 }
 function finishOrder(state,{committedOrderId}){
  if(state.stage!==STAGES.TENDER||state.tenderCents===null||!committedOrderId||typeof committedOrderId!=='string')throw Error('Order must be paid and durably committed before finishing');
  return {...state,stage:STAGES.RECEIPT,completedId:committedOrderId};
 }
 function returnHome(state){
  if(state.stage!==STAGES.RECEIPT)throw Error('Finish Order first');
  return {...initial(),registerOpen:state.registerOpen,employeeId:state.employeeId};
 }
 function soldOutLabel(available){if(!Number.isSafeInteger(available)||available<0)throw Error('Invalid stock');return available===0?'Sold Out':null;}
 function slideAt(slides,elapsedMs,intervalMs=6000){
  if(!Array.isArray(slides)||!slides.length)return null;
  if(!Number.isFinite(elapsedMs)||elapsedMs<0||!Number.isInteger(intervalMs)||intervalMs<1000||intervalMs>60000)throw Error('Invalid slideshow timing');
  return slides[Math.floor(elapsedMs/intervalMs)%slides.length];
 }
 return {STAGES,WELCOME,initial,startSale,addVariant,totalCents,toTender,enterCash,customerView,finishOrder,returnHome,soldOutLabel,slideAt};
});

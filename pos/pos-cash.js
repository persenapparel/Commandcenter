/* Cash tender and register change planner (draft POS; server authoritatively recomputes).
 * All amounts are integer cents, not floating point dollars.
 * Drawer counts are conservative: unknown tender denominations are not credited.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.PersenPOSCash=api;})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
const DENOMS=Object.freeze([
  {value:10000,label:'$100',kind:'bill'}, {value:5000,label:'$50',kind:'bill'},
  {value:2000,label:'$20',kind:'bill'},{value:1000,label:'$10',kind:'bill'},
  {value:500,label:'$5',kind:'bill'}, {value:100,label:'$1',kind:'bill'},
  {value:25,label:'25¢',kind:'coin'},{value:10,label:'10¢',kind:'coin'},
  {value:5,label:'5¢',kind:'coin'},{value:1,label:'1¢',kind:'coin'}
]);
function cleanCounts(raw){
  const result={};
  if(raw===null||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid cash drawer');
  for(const d of DENOMS){
    const rawVal=raw[d.value]??0;
    const n=Number(rawVal);
    if(!Number.isSafeInteger(n)||n<0||n>999)throw Error('Drawer counts must be 0–999');
    result[String(d.value)]=n;
  }
  if(Object.keys(raw).some(k=>!DENOMS.some(d=>String(d.value)===k)))throw Error('Unrecognized denomination');
  return result;
}
const drawerValue=counts=>DENOMS.reduce((total,d)=>total+d.value*(Number(counts[d.value])||0),0);
function calcChange(totalCents,paidCents){
 const due=Number(totalCents),paid=Number(paidCents);
 if(!Number.isSafeInteger(due)||due<0||!Number.isSafeInteger(paid)||paid<0||paid>1000000)throw Error('Invalid cash amount');
 return {due_cents:due,paid_cents:paid,short_cents:Math.max(0,due-paid),change_cents:Math.max(0,paid-due)};
}
// Find exact change with a bounded set of real denominations.
// Prefer higher denominations but backtrack when greedy fails.
function makeChange(amountCents,counts){
 const amount=Number(amountCents);
 if(!Number.isSafeInteger(amount)||amount<0||amount>50000)throw Error('Change out of supported range');
 const available=cleanCounts(counts);
 if(amount===0)return {};
 if(drawerValue(available)<amount)return null;
 const memo=new Set();
 let visits=0;
 function visit(i,remaining){
  if(remaining===0)return {};
  if(i===DENOMS.length)return null;
  const memoKey=i+':'+remaining;
  if(memo.has(memoKey))return null;
  if(++visits>150000)throw Error('Change planning needs drawer recount');
  const d=DENOMS[i],max=Math.min(available[d.value],Math.floor(remaining/d.value));
  for(let qty=max;qty>=0;qty--){
   const rest=visit(i+1,remaining-qty*d.value);
   if(rest!==null)return qty?{[String(d.value)]:qty,...rest}:rest;
  }
  memo.add(memoKey);
  return null;
 }
 return visit(0,amount);
}
function plan(totalCents,paidCents,counts,configured,received={}){
 const info=calcChange(totalCents,paidCents);
 const tender=cleanCounts(received);
 const tenderValue=drawerValue(tender);
 if(tenderValue&&tenderValue!==info.paid_cents)throw Error('Cash bills do not match amount received');
 if(info.short_cents)return {...info,status:'short',breakdown:null};
 if(!configured)return {...info,status:info.change_cents===0?'exact_unconfigured':'unconfigured',breakdown:info.change_cents===0?{}:null};
 const base=cleanCounts(counts);
 // A known tender can supply change immediately; unknown tender does not inflate counts.
 for(const d of DENOMS)base[d.value]+=tender[d.value];
 const breakdown=makeChange(info.change_cents,base);
 return {...info,status:breakdown===null?'insufficient':info.change_cents===0?'exact':'ready',breakdown};
}
function updateDrawer(counts,received,returned){
 const result=cleanCounts(counts),incoming=cleanCounts(received),change=cleanCounts(returned);
 for(const d of DENOMS){
  const n=result[d.value]+incoming[d.value]-change[d.value];
  if(n<0)throw Error('Not enough '+d.label+' in drawer');
  result[d.value]=n;
 }
 return result;
}
return {DENOMS,cleanCounts,drawerValue,calcChange,makeChange,plan,updateDrawer};
});
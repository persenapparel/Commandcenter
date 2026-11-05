/* Persen POS shared calculations. Database remains the source of truth for final sales. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.PersenPOSCore=api;})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
const cents=x=>{const n=Number(x);if(!Number.isFinite(n)||n<0||n>1000000)throw Error('Invalid price');return Math.round(n*100)};
const money=n=>(Number(n)/100).toLocaleString('en-US',{style:'currency',currency:'USD'});
const phone=s=>{const v=String(s||'').trim();const digits=v.replace(/\D/g,'');if(!/^\+?[\d ()-]{10,24}$/.test(v)||digits.length<10||digits.length>15)throw Error('Enter a valid phone number');return v};
const percent=s=>{const n=Number(s);if(!Number.isFinite(n)||n<0||n>100)throw Error('Discount must be between 0 and 100%');return n};
const taxMilli=s=>{const n=Number(s);if(!Number.isFinite(n)||n<0||n>20||Math.round(n*1000)!==n*1000)throw Error('Tax must be 0–20% with at most 3 decimals');return Math.round(n*1000)};
function totals(items,discountPct=0,taxRateMilli=0){
 const sub=items.reduce((n,x)=>{const q=Number(x.qty),p=Number(x.unit_cents);if(!Number.isSafeInteger(q)||q<1||q>999||!Number.isSafeInteger(p)||p<0||p>10000000)throw Error('Invalid item');return n+q*p},0);
 if(sub>100000000)throw Error('Cart total too large');
 const discount=Math.min(sub,Math.round(sub*percent(discountPct)/100));
 const taxable=items.reduce((n,x)=>n+(x.taxable===false?0:x.qty*x.unit_cents),0);
 const afterDiscount=sub-discount;
 const taxableAfter=sub===0?0:Math.round(taxable*afterDiscount/sub);
 const milli=Number(taxRateMilli);
 if(!Number.isInteger(milli)||milli<0||milli>20000)throw Error('Invalid tax rate');
 const tax=Math.round(taxableAfter*milli/100000);
 return {subtotal_cents:sub,discount_cents:discount,tax_cents:tax,total_cents:afterDiscount+tax};
}
function season(raw,now=new Date()){
 try{
  const list=typeof raw==='string'?JSON.parse(raw):raw;
  if(!Array.isArray(list))return null;
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  return list.filter(c=>c&&c.published===true&&(!c.start||c.start<=day)&&(!c.end||c.end>=day))
    .sort((a,b)=>String(b.start||'').localeCompare(String(a.start||'')))[0]||null;
 }catch{return null}
}
const safeHex=(s,fallback='#215dd8')=>/^#[0-9a-f]{6}$/i.test(String(s||''))?s:fallback;
return {cents,money,phone,percent,taxMilli,totals,season,safeHex};
});
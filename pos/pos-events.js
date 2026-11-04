/* Persen POS event reporting calculations.
   Sales amounts are immutable server snapshots; figures are calculated from saved sales only.
   "Service sales" means pre-discount, pre-tax merchandise value, not collected net. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PersenPOSEvents=api;
})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const services=['Apparel','Custom Printing','Personalization','Accessories','Other'];
 const serviceName=x=>services.includes(String(x||''))?String(x):'Other';
 const interestValues=['yes','maybe','no','not_answered'];
 const normalizeInterest=x=>interestValues.includes(x)?x:'not_answered';
 const validRating=x=>x===null||x===undefined||x===''?null:(Number.isInteger(Number(x))&&Number(x)>=1&&Number(x)<=5?Number(x):null);
 function report(sales,eventId){
  const selected=(Array.isArray(sales)?sales:[]).filter(s=>String(s.event_id||'')===String(eventId||''));
  const summary={transactions:0,units:0,gross_cents:0,discount_cents:0,tax_cents:0,collected_cents:0,rating_count:0,rating_total:0,promo_opt_ins:0,custom_leads:0,services:{}};
  for(const name of services)summary.services[name]={units:0,gross_cents:0};
  for(const sale of selected){
   summary.transactions++;
   const snap=sale.snapshot||{};
   const items=Array.isArray(snap.items)?snap.items:[];
   for(const line of items){
    const qty=Number(line.qty),unit=Number(line.unit_cents);
    if(!Number.isSafeInteger(qty)||!Number.isSafeInteger(unit)||qty<=0||qty>999||unit<0)continue;
    const name=serviceName(line.service);
    summary.units+=qty;summary.gross_cents+=qty*unit;
    summary.services[name].units+=qty;summary.services[name].gross_cents+=qty*unit;
   }
   const nonnegative=n=>Number.isFinite(Number(n))?Math.max(0,Number(n)):0;
   summary.discount_cents+=nonnegative(sale.discount_cents);
   summary.tax_cents+=nonnegative(sale.tax_cents);
   summary.collected_cents+=nonnegative(sale.total_cents);
   const rating=validRating(snap.rating);
   if(rating!==null){summary.rating_count++;summary.rating_total+=rating;}
   if(snap.marketing_opt_in===true)summary.promo_opt_ins++;
   if(snap.custom_interest==='yes'||snap.custom_interest==='maybe')summary.custom_leads++;
  }
  summary.rating_average=summary.rating_count?summary.rating_total/summary.rating_count:null;
  return summary;
 }
 return {services,serviceName,normalizeInterest,validRating,report};
});

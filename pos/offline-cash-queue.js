/* Persen POS offline cash queue — staging library, not wired to live checkout.
 * No customer contact data, PINs or credentials may be stored here.
 * Caller must implement authenticated server-side idempotency and stock reconciliation.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PersenPOSOfflineCash=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const KEY='persen-pos-staging-offline-cash-v1';
 const STATES=Object.freeze({PENDING:'pending',SYNCING:'syncing',CONFLICT:'conflict',SYNCED:'synced'});
 const allowedFields=['sku','stock_id','quantity','unit_cents'];
 function integer(value,min,max){return Number.isSafeInteger(value)&&value>=min&&value<=max;}
 function sanitizeSale(sale){
   if(!sale||typeof sale!=='object')throw Error('Invalid sale');
   if(!Array.isArray(sale.items)||!sale.items.length||sale.items.length>100)throw Error('Invalid items');
   const items=sale.items.map(item=>{
     if(!item||typeof item!=='object'||!integer(item.quantity,1,10000)||!integer(item.unit_cents,0,10000000)||typeof item.sku!=='string'||!/^[-A-Za-z0-9_.]{2,100}$/.test(item.sku))throw Error('Invalid item');
     return Object.fromEntries(allowedFields.filter(k=>k in item).map(k=>[k,item[k]]));
   });
   if(!integer(sale.tender_cents,0,100000000)||!integer(sale.total_cents,0,100000000)||sale.tender_cents<sale.total_cents)throw Error('Invalid cash tender');
   if(typeof sale.cashier_id!=='string'||!/^[-A-Za-z0-9_]{1,80}$/.test(sale.cashier_id))throw Error('Invalid cashier');
   if(sale.event_id!=null&&(typeof sale.event_id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(sale.event_id)))throw Error('Invalid event');
   return {items,total_cents:sale.total_cents,tender_cents:sale.tender_cents,change_cents:sale.tender_cents-sale.total_cents,cashier_id:sale.cashier_id,event_id:sale.event_id||null};
 }
 function createQueue(storage,makeId=()=>globalThis.crypto.randomUUID(),clock=()=>new Date().toISOString()){
   if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')throw Error('Storage required');
   function read(){
     const raw=storage.getItem(KEY);
     if(!raw)return [];
     const parsed=JSON.parse(raw);
     if(!Array.isArray(parsed)||parsed.length>1000)throw Error('Offline queue corrupt or over capacity');
     return parsed;
   }
   function save(items){storage.setItem(KEY,JSON.stringify(items));}
   function list(){return read().map(x=>({...x, sale:{...x.sale,items:x.sale.items.map(i=>({...i}))}}));}
   function enqueue(sale){
     const safe=sanitizeSale(sale);
     const entries=read();
     if(entries.length>=1000)throw Error('Offline queue full; reconnect before accepting more cash');
     const id=makeId();
     if(typeof id!=='string'||!/^[-A-Za-z0-9_]{12,100}$/.test(id)||entries.some(x=>x.id===id))throw Error('Invalid or duplicate transaction ID');
     const record={id,state:STATES.PENDING,created_at:clock(),attempts:0,sale:safe};
     save([...entries,record]);return {...record};
   }
   // Send only via a trusted authenticated server API with UNIQUE idempotency key.
   // Server must return {status:'accepted'|'already_recorded'|'conflict'}.
   async function sync(send){
     if(typeof send!=='function')throw Error('Authenticated sender required');
     const report={synced:0,conflicts:0,failed:0};
     for(const item of read()){
       if(item.state===STATES.SYNCED||item.state===STATES.CONFLICT)continue;
       let all=read(),current=all.find(x=>x.id===item.id);
       if(!current)continue;
       current.state=STATES.SYNCING;current.attempts=(current.attempts||0)+1;save(all);
       try{
         const result=await send({idempotency_key:item.id,...item.sale});
         if(!result||!['accepted','already_recorded','conflict'].includes(result.status))throw Error('Server did not confirm transaction');
         all=read();current=all.find(x=>x.id===item.id);if(!current)continue;
         current.state=result.status==='conflict'?STATES.CONFLICT:STATES.SYNCED;
         if(current.state===STATES.CONFLICT)report.conflicts++;else report.synced++;
         save(all);
       }catch(err){
         all=read();current=all.find(x=>x.id===item.id);
         if(current){current.state=STATES.PENDING;save(all);}
         report.failed++;
       }
     }
     return report;
   }
   function acknowledgeSynced(id){
     const all=read(),found=all.find(x=>x.id===id);
     if(!found||found.state!==STATES.SYNCED)throw Error('Only confirmed synced transactions can be removed');
     save(all.filter(x=>x.id!==id));
   }
   return {list,enqueue,sync,acknowledgeSynced};
 }
 return {KEY,STATES,sanitizeSale,createQueue};
});

/* Owner-only POS staging promotion controls. No customer messages, no marketing subscription. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const PROMOS=Object.freeze({
 seasonal:'Discover our newest seasonal styles at persenapparel.com.',
 custom:'Need custom shirts for a business, team or event? Get a quote at persenapparel.com.',
 online:'Find our newest collections at persenapparel.com.',
 none:''
});
let attached=false;
function attach({db,owner}){
 if(attached||!db||!owner?.id||!$('epson-promo-form'))return;
 attached=true;
 const message=$('epson-promo-status'),form=$('epson-promo-form'),button=$('epson-promo-save');
 const input=$('epson-promo-message'),picker=$('epson-promo-preset');
 const say=text=>{message.textContent=text;};
 picker.addEventListener('change',()=>{const v=picker.value;if(Object.prototype.hasOwnProperty.call(PROMOS,v))input.value=PROMOS[v];});
 async function active(){
  const {data,error}=await db.from('pos_receipt_templates').select('id,name,promotion').eq('owner_id',owner.id).eq('active',true).maybeSingle();
  if(error)throw error;return data;
 }
 async function init(){
  try{
   const row=await active();
   input.value=row?.promotion||'';
   say(row?'Editing the active Epson promotion. Save before the next sale to apply changes.':'No promotion is active. Save a new one for your next sale.');
  }catch(e){say('Cannot load receipt promotions. Check staging setup and account permissions.');}
 }
 form.addEventListener('submit',async e=>{
  e.preventDefault();
  const promotion=input.value.trim();
  if(promotion.length>300){say('Promotion is too long (300 character maximum).');return}
  button.disabled=true;
  try{
   const row=await active();
   let id=row?.id;
   if(id){
    const {error}=await db.from('pos_receipt_templates').update({promotion,updated_at:new Date().toISOString()}).eq('owner_id',owner.id).eq('id',id);
    if(error)throw error;
   }else{
    const {data,error}=await db.from('pos_receipt_templates').insert({
     owner_id:owner.id,name:'Event promotion',headline:'THANK YOU FOR YOUR PURCHASE!',
     promotion,footer:'Made with care on Long Island',
     review_message:'Enjoyed your purchase? Leave us an honest Google review.',
     show_review:false,show_seasonal:false,active:false,updated_at:new Date().toISOString()
    }).select('id').single();
    if(error)throw error;
    id=data.id;
    const reply=await db.rpc('pos_activate_receipt_template',{p_template:id});
    if(reply.error||reply.data!==true)throw reply.error||Error('Cannot activate new promotion');
   }
   say('Saved for NEW Epson cash receipts (customer and merchant). Older saved sales will not change.');
  }catch(err){say('Promotion was not activated: '+String(err?.message||'Check staging permissions.').slice(0,160));}
  finally{button.disabled=false}
 });
 void init();
}
window.PersenEpsonPromotions={attach};
})();

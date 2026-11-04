/* Persen POS — transactional digital receipt formatting. No sending occurs here. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.PersenPOSDigital=api;})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
const escape=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const money=c=>(Number(c)/100).toLocaleString('en-US',{style:'currency',currency:'USD'});
function validateSale(s){
 if(!s||typeof s!=='object'||!Array.isArray(s.items)||!Number.isSafeInteger(s.total_cents)||s.total_cents<0)throw Error('Saved sale snapshot required');
 return s;
}
function email(s,extras={}){
 validateSale(s);
 const short=escape(String(s.id||'').slice(0,8).toUpperCase()),lines=s.items.slice(0,90).map(item=>{
  const name=escape(String(item.name||'Item').slice(0,120)),qty=Number(item.qty),unit=Number(item.unit_cents);
  if(!Number.isSafeInteger(qty)||qty<1||qty>999||!Number.isSafeInteger(unit)||unit<0)throw Error('Invalid receipt item');
  return '<tr><td style="padding:9px 4px;border-bottom:1px solid #e8eef7">'+qty+' × '+name+'</td><td style="padding:9px 4px;border-bottom:1px solid #e8eef7;text-align:right">'+escape(money(qty*unit))+'</td></tr>';
 }).join('');
 const brand='#123466';
 const holiday=extras.seasonal?'<p style="color:#365e94">'+escape(String(extras.seasonal).slice(0,180))+'</p>':'';
 const reviewLink=String(extras.review_url||'');
 let review='';
 if(reviewLink.startsWith('https://g.page/')||reviewLink.startsWith('https://www.google.com/')||reviewLink.startsWith('https://maps.app.goo.gl/')){
   review='<p><a href="'+escape(reviewLink)+'">Leave an honest Google review</a></p>';
 }
 const html='<html><body style="margin:0;padding:22px;background:#f3f7fc;font:15px Arial,sans-serif;color:#1b3354"><div style="max-width:580px;margin:auto;background:#fff;padding:25px;border-radius:15px"><h2 style="color:'+brand+';margin-top:0">PERSEN APPAREL</h2><h3>Thank you for your order!</h3><p>Receipt #'+short+'</p>'+holiday+'<table style="width:100%;border-collapse:collapse">'+lines+'</table><p>Subtotal: '+escape(money(s.subtotal_cents))+' | Discount: '+escape(money(s.discount_cents))+' | Tax: '+escape(money(s.tax_cents))+'</p><h2>Total paid: '+escape(money(s.total_cents))+'</h2>'+review+'<p>Need custom apparel? Visit <a href="https://persenapparel.com">persenapparel.com</a>.</p><p>Thank you for supporting a Long Island business!</p></div></body></html>';
 return {subject:'Your Persen Apparel receipt #'+String(s.id||'').slice(0,8).toUpperCase(),html};
}
function sms(s){
 validateSale(s);
 const id=String(s.id||'').slice(0,8).toUpperCase();
 return 'Persen Apparel: Thank you for your order! Receipt #'+id+', total '+money(s.total_cents)+'. Questions or custom apparel? persenapparel.com. This is a one-time purchase receipt.';
}
return {escape,validateSale,email,sms};
});
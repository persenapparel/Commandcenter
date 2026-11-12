/* Persen POS: safe business-contact receipt footer. No delivery or printing side effects.
 * Never pass the shopper's private delivery email/phone as businessContact.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PersenPOSReceiptContact=api;
})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const clean=(s,max)=>String(s??'').trim().slice(0,max);
 const escape=s=>String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 function normalize(input={}){
  if(!input||typeof input!=='object')throw Error('Business contact settings required');
  const email=clean(input.email,255),phone=clean(input.phone,30);
  if(email&&(!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)||email.length>254))throw Error('Invalid business support email');
  if(phone&&!/^\+?[0-9][0-9 ()+.-]{6,28}$/.test(phone))throw Error('Invalid business support phone');
  const website='https://persenapparel.com';
  return Object.freeze({email,phone,website});
 }
 function cashierFirstName(value){
  const name=clean(value,40).split(/\s+/)[0]||'';
  if(!name)return '';
  if(!/^[\p{L}\p{M}'-]{1,40}$/u.test(name))throw Error('Invalid cashier first name');
  return name;
 }
 function lines(settings={},cashier=''){
  const s=normalize(settings),out=['Persen Apparel'];
  if(s.email)out.push('Email: '+s.email);
  if(s.phone)out.push('Phone: '+s.phone);
  out.push('Website: persenapparel.com');
  const first=cashierFirstName(cashier);
  if(first)out.push('Cashier: '+first);
  return Object.freeze(out);
 }
 function html(settings={},cashier=''){
  return '<p style="font:13px Arial,sans-serif;line-height:1.6">'+lines(settings,cashier).map(escape).join('<br>')+'</p>';
 }
 function text(settings={},cashier=''){return lines(settings,cashier).join('\n');}
 return {normalize,cashierFirstName,lines,html,text};
});
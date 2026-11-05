/* Persen POS — kiosk checkout wizard helpers.
   Entirely offline and side-effect free; browser/client handles the UI only.
   Phone entry defaults to a US 10-digit keypad, without the iOS keyboard.
*/
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PersenPOSWizard=api;
})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const steps=Object.freeze([
  {id:'phone',title:'Your phone number',kicker:'Step 1 of 8'},
  {id:'receipt',title:'Choose your receipt',kicker:'Step 2 of 8'},
  {id:'email',title:'Your email address',kicker:'Step 3 of 8'},
  {id:'payment',title:'Choose a payment option',kicker:'Step 4 of 8'},
  {id:'promos',title:'Stay in the loop?',kicker:'Step 5 of 8'},
  {id:'rating',title:'How was your experience?',kicker:'Step 6 of 8'},
  {id:'custom',title:'Need custom apparel?',kicker:'Step 7 of 8'},
  {id:'review',title:'Review and continue',kicker:'Step 8 of 8'}
 ]);
 const digits=v=>String(v||'').replace(/\D/g,'').slice(0,10);
 function dial(digitString,key){
  const original=digits(digitString);
  const value=String(key);
  if(value==='back')return original.slice(0,-1);
  if(value==='clear')return '';
  if(/^[0-9]$/.test(value))return (original+value).slice(0,10);
  return original;
 }
 function formatPhone(value){
  const d=digits(value);
  if(!d)return '';
  if(d.length<=3)return '('+d;
  if(d.length<=6)return '('+d.slice(0,3)+') '+d.slice(3);
  return '('+d.slice(0,3)+') '+d.slice(3,6)+'-'+d.slice(6);
 }
 function validPhone(v){return digits(v).length===10&&String(v||'').replace(/\D/g,'').length===10}
 const receiptModes=Object.freeze(['print','email','both']);
 function receipt(mode){
  const choice=receiptModes.includes(mode)?mode:'print';
  return {mode:choice,print:choice==='print'||choice==='both',email:choice==='email'||choice==='both',sms:false};
 }
 function validEmail(v){
  const s=String(v||'').trim();
  return s.length<=250&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
 }
 function checkStep(stepId,values){
  const phone=values?.phone||'';
  const email=String(values?.email||'').trim();
  const choice=receipt(values?.receipt);
  switch(stepId){
   case 'phone':return validPhone(phone)?'':'Please enter all 10 digits of your phone number.';
   case 'receipt':return receiptModes.includes(values?.receipt)?'':'Choose Printed, Email, or Both.';
   case 'email':return choice.email&&!email?'An email address is required for an emailed receipt.':
       email&&!validEmail(email)?'Please enter a valid email address, or leave this blank for a printed receipt.':'';
   case 'payment':return ['cash','venmo_info','apple_cash_info'].includes(values?.payment)?'':'Select a payment option.';
   default:return '';
  }
 }
 function summary(values){
  return {phone:formatPhone(values.phone),email:String(values.email||'').trim(),
   receipt:receipt(values.receipt),payment:values.payment||'cash',
   promo:values.marketing==='yes',rating:values.rating||null,interest:values.interest||'not_answered'};
 }
 function monitor(stepId,needsHelp=false){
  const i=steps.findIndex(s=>s.id===stepId);
  const current=i>=0?i:0;
  return {step_id:steps[current].id,step_label:steps[current].title,
    step_number:current+1,total_steps:steps.length,
    percentage:Math.round((current+1)/steps.length*100),
    needs_help:needsHelp===true};
 }
 return {steps,digits,dial,formatPhone,validPhone,checkStep,receiptModes,receipt,validEmail,summary,monitor};
});
/* Persen POS — receipt delivery validation and idempotent intent policy.
 * Pure helpers only. This module NEVER sends SMS/email or stores customer PII.
 * Delivery requires a secure authenticated backend and verified provider.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PersenPOSReceiptDelivery=api;
})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const METHODS=Object.freeze(['print','email','text','none']);
 const STATES=Object.freeze(['queued','sending','sent','delivered','failed']);
 function method(value){
   const v=String(value??'').trim().toLowerCase();
   if(!METHODS.includes(v))throw Error('Choose Print, Email, Text, or No Receipt');
   return v;
 }
 function email(value){
   const v=String(value??'').trim();
   if(v.length>254||v.length<5||/[\u0000-\u0020\u007f]/.test(v)||!(/^[^@]+@[^@]+\.[^@]+$/.test(v)))throw Error('Enter a valid receipt email address');
   const parts=v.split('@');
   if(parts[0].length>64||parts[1].length>253||parts[1].split('.').some(x=>!x||x.length>63)||!(/^[A-Za-z0-9._%+\-]+$/.test(parts[0]))||!(/^[A-Za-z0-9.\-]+$/.test(parts[1])))throw Error('Enter a valid receipt email address');
   return parts[0]+'@'+parts[1].toLowerCase();
 }
 function phone(value){
   const raw=String(value??'').trim();
   if(!raw||/[A-Za-z]/.test(raw)||/[^\d\s()+.\-]/.test(raw))throw Error('Enter a valid US phone number');
   let digits=raw.replace(/\D/g,'');
   if(digits.length===11&&digits.startsWith('1'))digits=digits.slice(1);
   if(digits.length!==10||!/[2-9]/.test(digits[0])||digits[0]==='0'||digits[0]==='1'||digits[3]==='0'||digits[3]==='1')throw Error('Enter a valid US phone number');
   return '+1'+digits;
 }
 function intent(input){
   if(!input||typeof input!=='object')throw Error('Receipt request required');
   const channel=method(input.method);
   if(typeof input.saleId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{3,127}$/.test(input.saleId))throw Error('Saved sale ID required');
   if(input.saleStatus!=='completed')throw Error('Receipts require a completed saved sale');
   if(channel==='none')return Object.freeze({saleId:input.saleId,method:channel,deliveryStatus:'not_requested'});
   if(channel==='print')return Object.freeze({saleId:input.saleId,method:channel,deliveryStatus:'pending_local_print'});
   if(input.receiptRequested!==true)throw Error('Customer must request this receipt delivery');
   const recipient=channel==='email'?email(input.recipient):phone(input.recipient);
   return Object.freeze({saleId:input.saleId,method:channel,recipient,deliveryStatus:'queued'});
 }
 function dedupeKey(value){
   const i=intent(value);
   // Recipient is intentionally not included: do not permit accidental duplicate sends
   // by editing an address. Explicit audited resend is a separate backend operation.
   return i.saleId+':'+i.method;
 }
 function transition(previous,next,proof={}){
   const transitions={queued:['sending','failed'],sending:['sent','failed'],sent:['delivered','failed'],delivered:[],failed:['queued']};
   if(!STATES.includes(previous)||!STATES.includes(next)||!transitions[previous].includes(next))throw Error('Invalid receipt delivery transition');
   if((next==='sent'||next==='delivered')&&(!proof.providerMessageId||typeof proof.providerMessageId!=='string'))throw Error('Provider evidence required before marking sent/delivered');
   if(next==='delivered'&&proof.providerDeliveryConfirmed!==true)throw Error('Provider delivery confirmation required');
   return next;
 }
 function businessContact(input={}){
   const output={};
   if(input.email!==undefined&&String(input.email).trim())output.email=email(input.email);
   if(input.phone!==undefined&&String(input.phone).trim())output.phone=phone(input.phone);
   return Object.freeze(output);
 }
 return {METHODS,STATES,method,email,phone,intent,dedupeKey,transition,businessContact};
});

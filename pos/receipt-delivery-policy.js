/* Persen POS — receipt delivery validation and safe outbox model.
 * Pure logic only: NO email/SMS is sent here. Backend authorization, provider
 * integration, durable dedupe and delivery callbacks are required before enabling.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else if(root)root.PersenPOSReceiptDelivery=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const METHODS=Object.freeze(['print','email','sms','none']);
 const STATES=Object.freeze(['queued','sending','sent','delivered','failed']);
 function emailAddress(value){
   const s=String(value??'').trim().toLowerCase();
   if(s.length>254||!(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))||/[<>]/.test(s))throw Error('Enter a valid email address');
   return s;
 }
 function usPhone(value){
   const s=String(value??'').trim();
   if(!/^[+\d\s().-]+$/.test(s))throw Error('Enter a valid US phone number');
   let digits=s.replace(/\D/g,'');
   if(digits.length===11&&digits.startsWith('1'))digits=digits.slice(1);
   if(digits.length!==10||!/[2-9]/.test(digits[0])||!/[2-9]/.test(digits[3]))throw Error('Enter a valid 10-digit US phone number');
   return '+1'+digits;
 }
 function request(opts){
   if(!opts||!METHODS.includes(opts.method))throw Error('Choose a receipt delivery method');
   if(typeof opts.saleId!=='string'||!/^[-a-zA-Z0-9_]{4,100}$/.test(opts.saleId))throw Error('Saved sale ID required');
   if(opts.saleCommitted!==true)throw Error('Complete and save sale before receipt delivery');
   const method=opts.method;
   if(method==='none')return {method,send:false};
   if(method==='print')return {method,send:false,requiresOperatorPrintConfirmation:true};
   if(opts.customerRequested!==true)throw Error('Customer must request this transactional receipt');
   const destination=method==='email'?emailAddress(opts.email):usPhone(opts.phone);
   // Stable key scoped to sale/channel: retries must not create new sends.
   // A real backend MUST enforce uniqueness and claim atomically.
   return {method,destination,send:true,status:'queued',idempotencyKey:'receipt:'+opts.saleId+':'+method};
 }
 function transition(current,next,providerEvidence){
   if(!STATES.includes(current)||!STATES.includes(next))throw Error('Unknown delivery state');
   const allowed={queued:['sending','failed'],sending:['sent','failed'],sent:['delivered','failed'],failed:['queued'],delivered:[]};
   if(!allowed[current].includes(next))throw Error('Invalid receipt delivery transition');
   if((next==='sent'||next==='delivered')&&providerEvidence!==true)throw Error('Provider confirmation required');
   return next;
 }
 return {METHODS,STATES,emailAddress,usPhone,request,transition};
});

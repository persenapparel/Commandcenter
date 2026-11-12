/* Persen POS receipt delivery preparation. NO network sending, production writes or SMS integration. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else if(root)root.PersenPOSReceiptDelivery=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const CHANNELS=Object.freeze(['print','email','sms','none']);
const STATUSES=Object.freeze(['not_requested','queued','sending','sent','delivered','failed','unavailable']);
function emailAddress(value){
 const s=String(value??'').trim();
 if(s.length>254||s.length<3||/\s|[<>]/.test(s))throw Error('Invalid email address');
 const parts=s.split('@');
 if(parts.length!==2||!parts[0]||parts[0].length>64||!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(parts[1])||parts[0].startsWith('.')||parts[0].endsWith('.')||parts[0].includes('..'))throw Error('Invalid email address');
 return parts[0]+'@'+parts[1].toLowerCase();
}
function usPhone(value){
 const s=String(value??'').trim();
 if(!/^[+\d\s().-]+$/.test(s))throw Error('Invalid phone number');
 let digits=s.replace(/\D/g,'');
 if(digits.length===11&&digits[0]==='1')digits=digits.slice(1);
 if(digits.length!==10||/[01]/.test(digits[0])||/[01]/.test(digits[3]))throw Error('Invalid US phone number');
 return '+1'+digits;
}
function request({orderId,channel,address,consent=false,committed=false}={}){
 const id=String(orderId??'').trim();
 if(!/^[a-z0-9][a-z0-9_-]{3,99}$/i.test(id))throw Error('Saved order ID required');
 if(!committed)throw Error('Receipt delivery requires a committed sale');
 if(!CHANNELS.includes(channel))throw Error('Unsupported receipt channel');
 if((channel==='email'||channel==='sms')&&consent!==true)throw Error('Customer must request this receipt');
 const recipient=channel==='email'?emailAddress(address):channel==='sms'?usPhone(address):null;
 // Key identifies the ONE delivery request for this order and channel. Backend must
 // enforce unique(order_id, channel) and authenticated authorization atomically.
 return Object.freeze({order_id:id,channel,recipient,idempotency_key:'receipt:'+id+':'+channel,status:channel==='none'?'not_requested':'queued'});
}
const transitions=Object.freeze({
 not_requested:[],queued:['sending','unavailable','failed'],sending:['sent','failed'],sent:['delivered','failed'],delivered:[],failed:['queued'],unavailable:['queued']
});
function transition(previous,next,{providerConfirmed=false}={}){
 if(!STATUSES.includes(previous)||!STATUSES.includes(next)||!transitions[previous].includes(next))throw Error('Invalid receipt status transition');
 if((next==='sent'||next==='delivered')&&!providerConfirmed)throw Error('Provider confirmation required');
 return next;
}
function safeBusinessContact({email,phone}={}){
 return Object.freeze({email:email?emailAddress(email):'',phone:phone?usPhone(phone):''});
}
function canSend({channel,providerReady=false,customerRequested=false,committed=false}={}){
 return (channel==='email'||channel==='sms')&&providerReady===true&&customerRequested===true&&committed===true;
}
return {CHANNELS,STATUSES,emailAddress,usPhone,request,transition,safeBusinessContact,canSend};
});

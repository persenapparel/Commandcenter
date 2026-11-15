'use strict';
// Staging-only pure validation boundary. NOT a substitute for server-side
// checkout ownership, atomic token consumption, rate limiting or RLS.
const MAX_SIGNATURE=120000;
function plain(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;}
function normalizeGuestSubmission(payload){
 if(!plain(payload))throw Error('Invalid customer submission');
 const allowed=new Set(['email','phone','marketing_consent','signature','signature_exception']);
 if(Object.keys(payload).some(k=>!allowed.has(k)))throw Error('Forbidden customer field');
 const email=payload.email==null?'':String(payload.email).trim();
 const phone=payload.phone==null?'':String(payload.phone).trim();
 if(email.length>254||(email&&!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)))throw Error('Invalid email');
 if(phone.length>30||(phone&&!/^[+0-9(). -]{7,30}$/.test(phone)))throw Error('Invalid phone');
 if(typeof payload.marketing_consent!=='boolean')throw Error('Explicit marketing choice required');
 if(payload.marketing_consent&&!email&&!phone)throw Error('Marketing consent requires contact');
 const exception=payload.signature_exception===true;
 if(payload.signature_exception!==undefined&&typeof payload.signature_exception!=='boolean')throw Error('Invalid signature exception');
 const signature=payload.signature==null?'':String(payload.signature);
 if(signature.length>MAX_SIGNATURE)throw Error('Signature too large');
 if(exception&&signature)throw Error('Choose signature or accessibility exception');
 if(!exception&&!/^data:image\\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(signature))throw Error('Signature required');
 return Object.freeze({email:email||null,phone:phone||null,marketing_consent:payload.marketing_consent,signature:exception?null:signature,signature_exception:exception});
}
module.exports={normalizeGuestSubmission};

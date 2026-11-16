'use strict';
// FUTURE staging UI adapter. Intentionally not loaded by register.html.
// Never override the existing fail-closed swivel buttons unless a verified
// staging deployment has the backend schema, separate guest origin, trusted
// guest API, CSP, and browser-security preflight. Client flag alone is not
// authorization: all checkout RPCs must independently enforce actor and ID.
const {createStagingHandoffBridge}=require('./staging-handoff-bridge.cjs');
const {createIsolatedGuestFrame}=require('./isolated-guest-frame.cjs');
function createStagingSwivelRuntime({
 window,client,cashierOrigin,guestOrigin,beginAuthorizedCheckout,
 showCompletedSale,serverAndBrowserPreflight
}) {
 if(!window || typeof client?.rpc!=='function' ||
    typeof beginAuthorizedCheckout!=='function' ||
    typeof showCompletedSale!=='function' ||
    typeof serverAndBrowserPreflight!=='function')
  throw Error('Staging swivel runtime dependencies missing');
 const doc=window.document,$=id=>doc.getElementById(id);
 const start=$('start'),overlay=$('swivel-overlay'),workspace=$('workspace'),
  legacyFrame=$('swivel-customer-frame'),lock=$('swivel-lock'),
  unlock=$('swivel-unlock-form'),badgeInput=$('swivel-password'),
  unlockButton=$('swivel-unlock-submit'),keep=$('swivel-keep-customer');
 if([start,overlay,workspace,legacyFrame,lock,unlock,badgeInput,unlockButton,keep].some(x=>!x))
  throw Error('Swivel elements missing');
 const frame=createIsolatedGuestFrame({window,container:overlay,cashierOrigin,guestOrigin});
 let active=false,finishedSnapshot=null,firstName='';
 function message(s){const n=$('swivel-unlock-message');if(n)n.textContent=s}
 // On an error, remain locked. Never offer a browser-side method that can
 // restore cashier access without a server-verified original-shift badge.
 function failClosed(){
  overlay.hidden=false;unlock.hidden=false;frame.dispose();
  legacyFrame.removeAttribute('src');legacyFrame.hidden=true;
  workspace.inert=true;doc.body.classList.add('swivel-customer-active');
 }
 // Locking the PARENT UI alone is not a security boundary: the customer is
 // served on a different origin and never sees the authenticated Supabase SDK.
 async function lockCashier(){
  overlay.hidden=false;unlock.hidden=true;legacyFrame.hidden=true;
  legacyFrame.removeAttribute('src');workspace.inert=true;
  doc.body.classList.add('swivel-customer-active');
  if(typeof doc.activeElement?.blur==='function')doc.activeElement.blur();
  return overlay.hidden===false && workspace.inert===true;
 }
 const bridge=createStagingHandoffBridge({
  client,beginAuthorizedCheckout,lockAndVerifyCashier:lockCashier,
  openGuest:payload=>frame.open(payload),
  restoreCashier:async()=>{
   frame.dispose();unlock.hidden=true;overlay.hidden=true;
   badgeInput.value='';workspace.inert=false;
   doc.body.classList.remove('swivel-customer-active');
  },
  clearGuest:async()=>frame.dispose(),
  showHome:async()=>{
   if(!finishedSnapshot)throw Error('Completed sale snapshot missing');
   await showCompletedSale(finishedSnapshot);
  }
 });
 function beginLoginForm() {
  const host=$('register-launch');
  if(!host)throw Error('Staging register launch unavailable');
  const form=doc.createElement('form');form.id='pos-staff-shift-login';
  const heading=doc.createElement('strong');
  heading.textContent='Cashier shift: scan your employee badge and enter your PIN';
  const badge=doc.createElement('input');badge.name='staffBadge';badge.type='password';
  badge.required=true;badge.autocomplete='off';badge.minLength=16;badge.maxLength=256;
  badge.setAttribute('aria-label','Employee badge barcode');
  const pin=doc.createElement('input');pin.name='staffPin';pin.type='password';
  pin.required=true;pin.autocomplete='off';pin.minLength=4;pin.maxLength=128;
  pin.setAttribute('aria-label','Employee shift PIN');
  const action=doc.createElement('button');action.type='submit';
  action.textContent='Start authenticated shift';
  const notice=doc.createElement('p');notice.setAttribute('role','status');
  form.append(heading,badge,pin,action,notice);
  form.addEventListener('submit',async event=>{
   event.preventDefault();
   if(action.disabled)return;
   action.disabled=true;
   try{
    const who=await bridge.startShift({badge:badge.value,pin:pin.value});
    firstName=who.firstName;
    notice.textContent='Hello, '+firstName+'! Your shift is active.';
    form.hidden=true;
   }catch(_){notice.textContent='Employee sign-in could not be verified.'}
   finally{badge.value='';pin.value='';action.disabled=false}
  });
  host.append(form);
 }
 async function enable(){
  if(active)return true;
  let verified=false;
  try{verified=await serverAndBrowserPreflight()}catch(_){}
  if(verified!==true)return false;
  active=true;
  legacyFrame.hidden=true;legacyFrame.removeAttribute('src');
  const resume=$('swivel-resume');
  if(resume)resume.onclick=null;
  start.onclick=async()=>{
   try{await bridge.handToCustomer()}
   catch(_){message('Checkout was not authorized. Keep the iPad with the cashier.')}
  };
  lock.onclick=async()=>{
   try{
    await bridge.confirmCustomerCompleted();
    bridge.requireBadge();unlock.hidden=false;badgeInput.value='';
    const label=unlock.querySelector('label[for="swivel-password"]');
    if(label)label.textContent='Scan your employee badge to return';
    const p=unlock.querySelector('p');
    if(p)p.textContent='Cashier only: scan the SAME employee badge used for this checkout.';
    badgeInput.placeholder='Scan employee badge';badgeInput.autocomplete='off';
    message('');badgeInput.focus();
   }catch(_){message('Customer questions are not confirmed yet. Keep this checkout open.')}
  };
  unlock.addEventListener('submit',async event=>{
   event.preventDefault();if(unlockButton.disabled)return;
   unlockButton.disabled=true;
   try{
    await bridge.resumeWithBadge(badgeInput.value);
    message('');
   }catch(_){message('Badge could not be verified for this checkout.')}
   finally{badgeInput.value='';unlockButton.disabled=false}
  });
  keep.onclick=()=>{if(bridge.state().checkout?.phase==='locked')return;
   unlock.hidden=true;message('')};
  beginLoginForm();
  return true;
 }
 async function finishAfterAuthoritativeOrder(saved){
  if(!active)throw Error('Secure handoff runtime is not enabled');
  if(!saved || typeof saved.id!=='string')throw Error('Completed receipt missing');
  finishedSnapshot=saved;
  try{return await bridge.finishSale({})}
  finally{finishedSnapshot=null}
 }
 return Object.freeze({enable,finishAfterAuthoritativeOrder,
  active:()=>active,stage:()=>bridge.state()});
}
module.exports={createStagingSwivelRuntime};

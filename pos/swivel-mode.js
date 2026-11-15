'use strict';
/* Staging only. No guest gateway is deployed or verified. Keep handoff
   unavailable; never create a legacy register-wide pairing credential. */
(()=>{
 const $=id=>document.getElementById(id);
 const start=$('start');
 const overlay=$('swivel-overlay');
 const frame=$('swivel-customer-frame');
 if(!start||!overlay||!frame)throw Error('Single-iPad POS requires the cashier checkout layout.');
 function failClosed(){
  overlay.hidden=true;
  frame.removeAttribute('src');
  frame.src='about:blank';
  document.body.classList.remove('swivel-customer-active');
  document.body.dataset.checkoutDeviceMode='swivel';
  for(const element of [document.querySelector('body > header'),document.querySelector('body > main')]){
   if(element)element.inert=false;
  }
  document.querySelector('.pos-device-mode')?.remove();
  for(const id of ['pair','pair-quick','pair-setup']){
   const element=$(id);if(element)element.hidden=true;
  }
  const hint=document.querySelector('.live-cart-hint');
  if(hint)hint.textContent='Customer handoff is disabled pending secure checkout isolation. Keep the iPad facing the cashier.';
  start.textContent='Hand to Customer (unavailable)';
  const resume=$('swivel-resume');if(resume)resume.hidden=true;
  const form=$('swivel-unlock-form');if(form)form.hidden=true;
  const password=$('swivel-password');if(password)password.value='';
 }
 function blocked(){
  failClosed();
  notice('Customer handoff is unavailable until checkout-scoped guest authorization, isolated origin, and cashier reauthentication pass security tests. Do not turn this signed-in iPad toward a customer.');
 }
 start.onclick=blocked;
 const resume=$('swivel-resume');if(resume)resume.onclick=blocked;
 const lock=$('swivel-lock');if(lock)lock.onclick=blocked;
 const keep=$('swivel-keep-customer');if(keep)keep.onclick=blocked;
 const unlockSubmit=$('swivel-unlock-submit');
 if(unlockSubmit)unlockSubmit.onclick=event=>{event.preventDefault();blocked();};
 const form=$('swivel-unlock-form');
 if(form)form.addEventListener('submit',event=>{event.preventDefault();blocked();});
 failClosed();
 window.PersenPOSSwivel={mode:()=> 'swivel',active:()=>false};
})();
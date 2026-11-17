'use strict';
/* Staging-only one-swivel customer handoff. The customer runs only in a
 * sandboxed, credential-free frame on the separate commandcenter Pages
 * origin; the authenticated cashier session stays inaccessible at its own
 * origin and is covered by a badge/PIN gate before and after customer use.
 */
(()=>{
 const $=id=>document.getElementById(id);
 const start=$('start'),overlay=$('swivel-overlay'),host=$('swivel-guest-host');
 const shiftDialog=$('swivel-shift-dialog'),shiftForm=$('swivel-shift-form');
 const shiftBadge=$('swivel-badge'),shiftPin=$('swivel-pin'),shiftMessage=$('swivel-shift-message');
 const returnForm=$('swivel-return-form'),returnBadge=$('swivel-return-badge');
 const returnMessage=$('swivel-return-message'),lock=$('swivel-lock');
 const keepCustomer=$('swivel-keep-customer'),resume=$('swivel-resume');
 const api=window.PersenPOSRegister,secure=window.PersenPOSSecureHandoff;
 const config=window.PersenPOSHandoffConfig;
 const blocked='Customer handoff is unavailable until the isolated staging connection is verified. Do not turn this signed-in iPad toward a customer.';
 if(!start||!overlay||!host||!shiftDialog||!shiftForm||!shiftBadge||!shiftPin||
    !returnForm||!returnBadge||!lock||!api||!secure||!config)
  throw Error('Single-iPad POS needs the secured handoff layout.');
 function message(value){api.notice(value)}
 function cashierOrigin(){
  const url=new URL(location.origin),host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
     url.pathname!=='/'||
     !(host==='persen-pos-staging.pages.dev'||host.endsWith('.persen-pos-staging.pages.dev')))
   throw Error('Cashier must run on the protected staging Pages origin');
  return url.origin;
 }
 function guestEntry(value){
  const url=new URL(value),host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
     !['/pos-guest/','/pos-guest/index.html'].includes(url.pathname)||
     !(host==='commandcenter-4yg.pages.dev'||host.endsWith('.commandcenter-4yg.pages.dev')))
   throw Error('Customer frame must use the approved isolated staging origin');
  return url;
 }
 let cashier=null,entry=null,bridge=null,guestFrame=null,transition=false;
 let lastActivity=Date.now();
 const cashierSurfaces=Array.from(document.querySelectorAll('body > main, body > header'));
 function coverCashier(covered){
  for(const surface of cashierSurfaces)surface.inert=covered;
 }
 function state(){return bridge?.state?.().checkout||null}
 function resetOverlay(){
  returnForm.hidden=true;
  overlay.hidden=true;
  document.body.classList.remove('swivel-customer-active');
  coverCashier(false);
  lastActivity=Date.now();
 }
 function clearGuest({keepLocked=false}={}){
  try{guestFrame?.dispose?.()}catch(_){}
  guestFrame=null;
  host.replaceChildren();
  if(!keepLocked)resetOverlay();
  else{
   overlay.hidden=false;
   lock.hidden=true;
   returnForm.hidden=true;
   document.body.classList.add('swivel-customer-active');
  }
 }
 function renderCustomerLock(){
  coverCashier(true);
  keepCustomer.hidden=false;
  lock.hidden=false;
  returnForm.querySelector('h2').textContent='Cashier access';
  returnForm.querySelector('p').textContent='Turn the iPad back toward the cashier and scan the original staff badge to continue to payment.';
  $('swivel-return-submit').textContent='Resume cashier';
  overlay.hidden=false;
  document.body.classList.add('swivel-customer-active');
  returnForm.hidden=true;
  returnMessage.textContent='';
 }
 function renderNextSaleLock(){
  coverCashier(true);
  keepCustomer.hidden=true;
  clearGuest({keepLocked:true});
  overlay.hidden=false;
  lock.hidden=true;
  document.body.classList.add('swivel-customer-active');
  returnForm.hidden=false;
  returnForm.querySelector('h2').textContent='Persen Apparel · Register locked';
  returnForm.querySelector('p').textContent='Thank you! Sale completed. Scan your staff badge to unlock the next order. No PIN required again this shift.';
  $('swivel-return-submit').textContent='Unlock register';
  returnMessage.textContent='Your checkout is finished. Employee badge required for the next sale.';
  returnBadge.value='';
  returnBadge.focus();
 }
 function renderIdleLock(){
  // Close top-layer cashier dialogs before covering the page; a modal
  // dialog otherwise remains above even the highest z-index overlay.
  for(const dialog of document.querySelectorAll('main dialog[open]'))dialog.close();
  coverCashier(true);
  overlay.hidden=false;
  lock.hidden=true;
  returnForm.hidden=false;
  keepCustomer.hidden=true;
  document.body.classList.add('swivel-customer-active');
  returnForm.querySelector('h2').textContent='Persen Apparel · Register locked';
  returnForm.querySelector('p').textContent='The register locked after 30 seconds without activity. Your current order is still here. Scan your staff badge to continue.';
  $('swivel-return-submit').textContent='Unlock register';
  returnMessage.textContent='Employee badge required. No PIN required again this shift.';
  returnBadge.value='';returnBadge.focus();
 }
 function checkIdle(force=false){
  if(transition||(!force&&Date.now()-lastActivity<30000))return false;
  if(!bridge?.lockForIdle())return false;
  renderIdleLock();
  return true;
 }
 // Check elapsed wall time before accepting a tap/scan: Safari can suspend
 // timers in the background. The first returning event must not edit a cart.
 for(const type of ['pointerdown','keydown','input','click']){
  document.addEventListener(type,event=>{
   if(checkIdle()){
    event.preventDefault();event.stopImmediatePropagation();return;
   }
   if(!bridge?.state?.().locked)lastActivity=Date.now();
  },true);
 }
 document.addEventListener('visibilitychange',()=>{
  if(document.hidden)checkIdle(true);else checkIdle();
 });
 window.addEventListener('pageshow',()=>checkIdle());
 setInterval(()=>checkIdle(),1000);
 function ensureFreshGuestFrame(){
  if(guestFrame)return guestFrame;
  cashier=cashierOrigin();
  entry=guestEntry(config.guestEntryUrl);
  guestFrame=secure.createIsolatedGuestFrame({
   window,container:host,cashierOrigin:cashier,guestOrigin:entry.origin,guestEntryUrl:entry.href
  });
  return guestFrame;
 }
 function ensureBridge(){
  if(bridge)return bridge;
  ensureFreshGuestFrame();
  bridge=secure.createStagingHandoffBridge({
   client:api.secureHandoffClient,
   getStaffCheckoutRequest:()=>api.getStaffCheckoutRequest(),
   lockAndVerifyCashier:async checkoutId=>{
    api.lockHandoffCheckout(checkoutId);
    renderCustomerLock();
    return guestFrame&&entry.origin!==cashier;
   },
   openGuest:async payload=>{
    if(!guestFrame)throw Error('Customer frame is unavailable');
    await guestFrame.open(payload);
   },
   restoreCashier:async payload=>{
    await api.restoreHandoffCheckout(payload);
    resetOverlay();
   },
   unlockRegisterForNextSale:()=>api.reopenRegisterAfterVerifiedBadge(),
   finishAuthoritativeSale:payload=>api.finishHandoffSale(payload),
   clearGuest:async()=>{clearGuest({keepLocked:true});},
   showHome:async()=>{
    await api.showHandoffHome();
    renderNextSaleLock();
   }
  });
  return bridge;
 }
 function canUseRegister(){
  const current=bridge?.state?.();
  return !!current?.employee&&!current.locked&&current.checkout?.phase==='cashier'&&
   !current.checkout.pending&&Date.parse(current.employee.expiresAt)>Date.now();
 }
 function openShiftDialog(){
  if(!api.ready())return message('Sign in as the staging owner before starting your employee shift.');
  if(bridge?.state?.().employee)return message('Register is locked. Use the original badge at the lock screen.');
  shiftMessage.textContent='';
  shiftBadge.value='';shiftPin.value='';
  if(typeof shiftDialog.showModal!=='function')return message(blocked);
  if(!shiftDialog.open)shiftDialog.showModal();
  shiftBadge.focus();
 }
 async function handToCustomer(){
  if(transition)return;
  transition=true;start.disabled=true;
  try{
   // The previous customer's frame was destroyed after the verified sale.
   // Always prepare a fresh, credential-free frame for each next order.
   ensureFreshGuestFrame();
   const active=ensureBridge();
   await active.handToCustomer();
   message('Customer checkout is ready. Turn the iPad toward the customer.');
  }catch(_){
   const phase=state()?.phase;
   if(phase!=='locked')clearGuest();
   else{
    overlay.hidden=false;
    document.body.classList.add('swivel-customer-active');
    returnForm.hidden=false;
    returnMessage.textContent='Secure handoff stopped before it could open. Keep this iPad with the cashier and do not start another order.';
   }
   message(phase==='cashier'
    ?'Check your cart and use 0% discount, then retry Hand to Customer.'
    :'Secure customer handoff could not start. The cashier screen remains locked.');
  }finally{
   transition=false;start.disabled=false;
  }
 }
 start.onclick=()=>{
  if(!bridge?.state?.().employee)return openShiftDialog();
  void handToCustomer();
 };
 shiftForm.addEventListener('submit',async event=>{
  event.preventDefault();
  if(transition)return;
  const badge=shiftBadge.value.trim(),pin=shiftPin.value;
  if(!badge||!pin){shiftMessage.textContent='Scan a badge and enter the staff PIN.';return}
  transition=true;shiftMessage.textContent='Verifying staff access…';
  try{
   const active=ensureBridge();
   const employee=await active.startShift({badge,pin});
   shiftBadge.value='';shiftPin.value='';
   shiftMessage.textContent='';
   shiftDialog.close();
   api.reopenRegisterAfterVerifiedBadge();
   lastActivity=Date.now();
   message('Hello, '+employee.firstName+'! Scan products to start your sale.');
   transition=false;
  }catch(_){
   shiftBadge.value='';shiftPin.value='';
   shiftMessage.textContent='Staff access was not verified. Check the badge and PIN.';
   transition=false;
  }
 });
 $('swivel-shift-cancel').onclick=()=>{shiftBadge.value='';shiftPin.value='';shiftMessage.textContent='';shiftDialog.close();};
 lock.onclick=async()=>{
  const active=bridge;
  if(!active)return message(blocked);
  try{
   const phase=state()?.phase;
   if(phase==='guest')await active.confirmCustomerCompleted();
   if(state()?.phase==='customer_complete')active.requireBadge();
   if(state()?.phase!=='locked')throw Error('Customer checkout is not ready to return');
   returnForm.hidden=false;
   returnMessage.textContent='Customer information is saved. Scan the original staff badge to continue.';
   returnBadge.value='';returnBadge.focus();
  }catch(_){
   returnMessage.textContent='The customer has not finished yet. Leave the iPad with the customer, or check the customer screen.';
  }
 };
 returnForm.addEventListener('submit',async event=>{
  event.preventDefault();
  if(transition)return;
  const badge=returnBadge.value.trim();
  if(!badge){returnMessage.textContent='Scan the original staff badge to continue.';return}
  transition=true;returnMessage.textContent='Verifying badge…';
  try{
   if(bridge?.state?.().idleLocked){
    const verified=await bridge.unlockIdle(badge);
    returnBadge.value='';
    resetOverlay();
    message('Hello, '+verified.firstName+'! Continue your current order.');
   }else if(state()?.phase==='home'&&bridge?.state?.().locked){
    const verified=await bridge.unlockNextSale(badge);
    returnBadge.value='';
    resetOverlay();
    message('Hello, '+verified.firstName+'! Register unlocked for the next sale.');
   }else{
    await bridge.resumeWithBadge(badge);
    returnBadge.value='';
    message('Cashier resumed. Confirm cash only after you receive it.');
   }
  }catch(_){
   returnBadge.value='';
   returnMessage.textContent='Badge was not authorized for this checkout.';
  }finally{transition=false}
 });
 keepCustomer.onclick=()=>{returnForm.hidden=true;returnMessage.textContent='';};
 if(resume)resume.hidden=true;
 document.body.dataset.checkoutDeviceMode='swivel';
 const hint=document.querySelector('.live-cart-hint');
 if(hint)hint.textContent='Sign in with your staff badge and PIN, scan products, then select Hand to Customer.';
 resetOverlay();
 window.PersenPOSSwivel=Object.freeze({
  mode:()=> 'swivel',
  canUseRegister,
  requestRegisterOpen:openShiftDialog,
  active:()=>!!state(),
  ownsCheckout:checkoutId=>state()?.checkoutId===checkoutId&&state()?.phase==='payment',
  recordCash:payment=>{
   const pending=state();
   if(!bridge||!pending||pending.phase!=='payment'||!pending.checkoutId)
    throw Error('Secure cashier payment is unavailable');
   return bridge.recordCash({checkoutId:pending.checkoutId,payment});
  },
  finishSale:payment=>bridge?.finishSale(payment)
 });
})();

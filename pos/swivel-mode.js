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
 const manualLock=$('lock-register');
 const keepCustomer=$('swivel-keep-customer'),resume=$('swivel-resume');
 const workspace=$('workspace'),launch=$('register-launch');
 const api=window.PersenPOSRegister,secure=window.PersenPOSSecureHandoff;
 const config=window.PersenPOSHandoffConfig;
 const blocked='Customer handoff is unavailable until the isolated staging connection is verified. Do not turn this signed-in iPad toward a customer.';
 if(!start||!overlay||!host||!shiftDialog||!shiftForm||!shiftBadge||!shiftPin||
    !returnForm||!returnBadge||!lock||!manualLock||!api||!secure||!config)
  throw Error('Single-iPad POS needs the secured handoff layout.');
 function message(value){api.notice(value)}
 function cashierOrigin(){
  const url=new URL(location.origin),host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
     url.pathname!=='/'||
     !(host==='pos.persenapparel.com'||host==='persen-pos-staging.pages.dev'||host.endsWith('.persen-pos-staging.pages.dev')))
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
 let employeeHome=null,employeeHomeClock=null;
 const cashierSurfaces=Array.from(document.querySelectorAll('body > main, body > header'));
 function coverCashier(covered){
  for(const surface of cashierSurfaces)surface.inert=covered;
 }
 function state(){return bridge?.state?.().checkout||null}
 function updateEmployeeHomeClock(){
  if(!employeeHomeClock)return;
  employeeHomeClock.textContent=new Intl.DateTimeFormat('en-US',{
   hour:'numeric',minute:'2-digit',weekday:'long'
  }).format(new Date());
 }
 function ensureEmployeeHome(){
  if(employeeHome)return employeeHome;
  if(!workspace||!launch||typeof document.createElement!=='function')return null;
  const home=document.createElement('section');
  home.id='employee-home';home.className='employee-home panel';home.hidden=true;
  home.setAttribute('aria-label','Employee home');
  home.innerHTML='<div class="employee-home-brand"><img src="assets/persen-logo.png" alt="Persen Apparel logo" onerror="this.hidden=true"><div><span class="eyebrow">PERSEN APPAREL · EMPLOYEE HOME</span><h2 id="employee-home-greeting">Welcome to Persen Apparel</h2><p id="employee-home-role" class="employee-home-role"></p></div></div><div class="employee-home-idle"><span aria-hidden="true">❄</span><time id="employee-home-clock"></time><span aria-hidden="true">✦</span></div><p class="employee-home-intro">Choose what you need to do. The register stays locked until you select Sales or Inventory Check.</p><div class="employee-home-actions"><button id="employee-home-sales" type="button"><span aria-hidden="true">🛍️</span><strong>Sales</strong><small>Start a customer order</small></button><button id="employee-home-returns" type="button"><span aria-hidden="true">↩</span><strong>Returns / Refunds</strong><small>Look up an original sale</small></button><button id="employee-home-exchange" type="button"><span aria-hidden="true">↺</span><strong>Exchange</strong><small>Swap an equal-value item</small></button><button id="employee-home-inventory" type="button"><span aria-hidden="true">⌁</span><strong>Inventory Check</strong><small>Scan without adding to a sale</small></button></div><button id="employee-home-badge-setup" class="employee-home-badge-setup" type="button">Manage two employee badge slots (owner only)</button><button id="employee-home-recover" class="employee-home-recover" type="button" hidden>Recover unfinished staging test checkout (owner only)</button><p id="employee-home-status" class="employee-home-status" role="status" aria-live="polite"></p>';
  if(typeof launch.insertAdjacentElement==='function')launch.insertAdjacentElement('afterend',home);
  else workspace.append(home);
  const status=home.querySelector('#employee-home-status');
  async function openExchange(){
   if(bridge?.state().employee?.role!=='owner'){status.textContent='Owner approval is required.';return}
   home.querySelector('.manual-adjustment')?.remove();
   const form=document.createElement('form');form.className='manual-adjustment panel';
   form.innerHTML='<h3>Exchange one item</h3><label>Original sale <select name="sale" required></select></label><label>Item received <select name="original" required></select></label><label>Replacement <select name="replacement" required></select></label><label><input name="confirmed" type="checkbox" required> I received the original item in sellable condition and handed over the replacement.</label><button type="submit" disabled>Record exchange</button><button type="button">Cancel</button><p role="status"></p>';
   home.append(form);
   const fields=form.elements, submit=form.querySelector('[type=submit]'), feedback=form.querySelector('[role=status]');
   form.querySelector('[type=button]').onclick=()=>form.remove();
   const request=crypto.randomUUID();let revision=0;
   async function selectSale(){
    const version=++revision;submit.disabled=true;fields.confirmed.checked=false;
    fields.original.replaceChildren();fields.replacement.replaceChildren();
    try{
     const {originals,choices}=await bridge.manualAdjustment({p_action:'exchange_options',p_sale:fields.sale.value});
     if(version!==revision)return;
     for(const o of originals)fields.original.add(new Option([o.name,o.color,o.size,(o.unit_cents/100).toFixed(2)].join(' · '),o.stock_id));
     const selectOriginal=()=>{
      fields.replacement.replaceChildren();fields.confirmed.checked=false;
      const o=originals.find(i=>i.stock_id===fields.original.value);
      for(const v of choices.filter(v=>o&&v.id!==o.stock_id&&v.price===o.unit_cents&&v.taxable===o.taxable))fields.replacement.add(new Option([v.name,v.color,v.size,(v.price/100).toFixed(2)].join(' · '),v.id));
      submit.disabled=!fields.replacement.length;feedback.textContent=submit.disabled?'No eligible equal-value replacement.':'';
     };
     fields.original.onchange=selectOriginal;selectOriginal();
    }catch{if(version===revision)feedback.textContent='This sale needs manual review.'}
   }
   try{
    const {sales}=await bridge.manualAdjustment({p_action:'list'});
    for(const s of sales.filter(s=>!s.returned&&s.available===s.total_cents))fields.sale.add(new Option(new Date(s.created_at).toLocaleString()+' · '+(s.total_cents/100).toFixed(2)+' · '+s.id.slice(-8),s.id));
    fields.sale.onchange=selectSale;fields.replacement.onchange=()=>{fields.confirmed.checked=false};
    if(fields.sale.length)await selectSale();else feedback.textContent='No eligible recent sales.';
   }catch{feedback.textContent='Unable to load sales.'}
   form.onsubmit=async event=>{
    event.preventDefault();if(submit.disabled||!fields.confirmed.checked)return;submit.disabled=true;
    try{
     const result=await bridge.manualAdjustment({p_action:'exchange',p_sale:fields.sale.value,p_original:fields.original.value,p_replacement:fields.replacement.value,p_request:request,p_confirmed:true});
     if(!result.ok)throw Error();
     form.remove();status.textContent='Exchange recorded. Both stock quantities were updated.';
    }catch{feedback.textContent='Exchange could not be confirmed. Check stock and retry the same swap.';submit.disabled=false}
   };
  }
  async function openAdjustment(action){
   if(bridge?.state().employee?.role!=='owner'){status.textContent='An owner shift is required.';return}
   const refund=action==='refund';
   home.querySelector('.manual-adjustment')?.remove();
   const form=document.createElement('form');
   form.className='manual-adjustment panel';
   form.innerHTML='<h3></h3><label>Original sale <select name="sale" required></select></label><div class="refund-fields"><label>Refund amount ($) <input name="amount" type="number" step="0.01" min="0.01"></label><label>How was the customer repaid? <select name="method"><option value="cash">Cash</option><option value="venmo">Venmo</option><option value="apple_pay">Apple Pay</option></select></label></div><label>Reason <input name="reason" required maxlength="250"></label><label><input name="confirmed" type="checkbox" required> <span></span></label><button type="submit">Record</button> <button type="button">Cancel</button><p role="status"></p>';
   home.append(form);
   const toggle=document.createElement('button');toggle.type='button';toggle.textContent=refund?'Switch to merchandise return':'Switch to manual refund';toggle.onclick=()=>openAdjustment(refund?'return':'refund');form.prepend(toggle);
   const fields=form.elements, feedback=form.querySelector('[role=status]');
   const money=cents=>(cents/100).toFixed(2);
   form.querySelector('h3').textContent=refund?'Record a manual refund':'Record a full-order merchandise return';
   form.querySelector('.refund-fields').hidden=!refund;
   fields.amount.required=refund;
   const confirmLabel=()=>{fields.confirmed.checked=false;form.querySelector('span').textContent=!refund?'I received all merchandise from this sale.':fields.method.value==='cash'?'I took this amount from the cash drawer and handed it to the customer.':'I already sent this amount back via '+fields.method.selectedOptions[0].textContent+'.'};
   confirmLabel();fields.method.onchange=confirmLabel;fields.amount.oninput=confirmLabel;
   form.querySelector('[type=button]').onclick=()=>form.remove();
   const submit=form.querySelector('[type=submit]');submit.disabled=true;
   try{
    const {sales}=await bridge.manualAdjustment({p_action:'list'});
    for(const sale of sales.filter(s=>refund?s.available>0:!s.returned)){
     const label=new Date(sale.created_at).toLocaleString()+' · $'+money(sale.total_cents)+' · '+sale.payment_method+' · '+sale.id.slice(-8);
     const option=new Option(label,sale.id);option.dataset.available=sale.available;fields.sale.add(option);
    }
    if(!fields.sale.length){feedback.textContent='No eligible recent sales.';return}
    const selectSale=()=>{const amount=money(Number(fields.sale.selectedOptions[0].dataset.available));fields.amount.value=amount;fields.amount.max=amount;confirmLabel();};
    selectSale();fields.sale.onchange=selectSale;submit.disabled=false;
   }catch{feedback.textContent='Unable to load sales for this register.';return}
   let request=crypto.randomUUID();
   form.onsubmit=async event=>{
    event.preventDefault();if(submit.disabled||!fields.confirmed.checked)return;
    submit.disabled=true;
    try{
     const result=await bridge.manualAdjustment({p_action:action,p_sale:fields.sale.value,p_request:request,p_amount:refund?Math.round(Number(fields.amount.value)*100):null,p_method:refund?fields.method.value:null,p_reason:fields.reason.value.trim(),p_confirmed:true});
     if(!result.ok)throw Error();
     form.remove();status.textContent=refund?'Manual refund recorded.':'Full-order return recorded. Review stock before restocking.';
    }catch{feedback.textContent='Could not confirm the record. Retry with the same details before issuing any money.';submit.disabled=false}
   };
  }
  home.querySelector('#employee-home-sales').addEventListener('click',()=>{
   try{api.openEmployeeMode('sales');hideEmployeeHome();message('Sales register ready. Scan products to start a sale.')}catch(error){status.textContent=error.message}
  });
  const staffSetup=home.querySelector('#employee-home-badge-setup');
  staffSetup.addEventListener('click',()=>{window.PersenPOSRegister.openEmployeeBadgeSetup?.()});
  home.querySelector('#employee-home-recover').addEventListener('click',()=>{window.PersenPOSRegister.openUnpaidRecoveryDialog?.()});
  home.querySelector('#employee-home-inventory').addEventListener('click',()=>{
   try{api.openEmployeeMode('inventory');hideEmployeeHome();message('Inventory Check is ready. Scan a product barcode; nothing will be added to a sale.')}catch(error){status.textContent=error.message}
  });
  home.querySelector('#employee-home-returns').addEventListener('click',()=>unavailable('Returns'));
  home.querySelector('#employee-home-exchange').addEventListener('click',()=>unavailable('Refunds'));
  employeeHome=home;employeeHomeClock=home.querySelector('#employee-home-clock');
  updateEmployeeHomeClock();
  return home;
 }
 function hideEmployeeHome(){
  if(employeeHome)employeeHome.hidden=true;
  delete document.body.dataset.employeeHome;
 }
 function showEmployeeHome(employee=bridge?.state?.().employee){
  if(!employee||bridge?.state?.().locked||state()?.phase!=='cashier')return false;
  // Clear the compact Sales layout only after a verified shift, without
  // clearing the cart or bypassing the authorization boundary.
  try{api.closeEmployeeSalesViewForHome()}catch(error){
   message(error.message||'Unable to return to Employee Home.');
   return false;
  }
  const home=ensureEmployeeHome();
  if(!home)return false;
  home.hidden=false;
  home.querySelector('#employee-home-greeting').textContent='Hello, '+employee.firstName+'!';
  home.querySelector('#employee-home-badge-setup').hidden=employee.role!=='owner';
  home.querySelector('#employee-home-recover').hidden=employee.role!=='owner';
  home.querySelector('#employee-home-role').textContent=employee.role==='owner'
   ? 'Owner access · select an action to continue'
   : 'Cashier access · sales and read-only inventory are ready';
  home.querySelector('#employee-home-status').textContent='Ready for your next action.';
  document.body.dataset.employeeHome='true';
  document.body.dataset.staffRole=employee.role||'cashier';
  updateEmployeeHomeClock();lastActivity=Date.now();
  return true;
 }
 setInterval(updateEmployeeHomeClock,30000);
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
 function renderIdleLock(reason='idle'){
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
  returnForm.querySelector('p').textContent=reason==='manual'
   ?'You locked the register. Your current cart and checkout are preserved. Scan your staff badge to continue.'
   :'The register locked after 30 seconds without activity. Your current order is still here. Scan your staff badge to continue.';
  $('swivel-return-submit').textContent='Unlock register';
  returnMessage.textContent=reason==='manual'
   ?'Register locked by employee. Original badge required to unlock; no PIN needed again this shift.'
   :'Employee badge required. No PIN required again this shift.';
  returnBadge.value='';returnBadge.focus();
 }
 manualLock.addEventListener('click',()=>{
  // Use the same verified gate as the 30-second lock; never merely hide the UI.
  // Preserve the cart and original employee shift, including a resumed payment.
  if(transition||!bridge?.state?.().employee||document.body.classList.contains('pos-register-closed')){
   message('Open an authorized employee register before locking it.');
   return;
  }
  if(!bridge.lockForIdle()){
   message('The register cannot lock while a checkout or payment transition is in progress.');
   return;
  }
  renderIdleLock('manual');
 });
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
  // Employee authentication must not depend on guest iframe availability.
  // Guest origin validation still runs before any customer handoff.
  cashier=cashierOrigin();
  bridge=secure.createStagingHandoffBridge({
   client:api.secureHandoffClient,
   getRegisterId:()=>api.getRegisterId(),
   getStaffCheckoutRequest:()=>api.getStaffCheckoutRequest(),
   lockAndVerifyCashier:async checkoutId=>{
    ensureFreshGuestFrame(); // Validate customer isolation before locking the cashier.
    api.lockHandoffCheckout(checkoutId);
    renderCustomerLock();
    return guestFrame&&entry.origin!==cashier;
   },
   openGuest:async payload=>{
    ensureFreshGuestFrame();
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
  let step='setup';
  try{
   const active=ensureBridge();
   step='verification';
   const employee=await active.startShift({badge,pin});
   step='home';
   shiftBadge.value='';shiftPin.value='';
   shiftMessage.textContent='';
   if(!showEmployeeHome(employee))throw Error('Employee home is unavailable');
   shiftDialog.close();
   lastActivity=Date.now();
   message('Hello, '+employee.firstName+'! Choose Sales, Returns / Refunds, Exchange, or Inventory Check.');
   transition=false;
  }catch(error){
   shiftBadge.value='';shiftPin.value='';
   // Never display or log badge/PIN values or raw server errors.
   // Distinct codes let the owner report a failure without revealing secrets.
   const reason=String(error?.message||'');
   shiftMessage.textContent=step==='setup'
    ?'SHIFT-SETUP: Secure POS sign-in could not initialize. Your badge was not checked.'
    :step==='home'
     ?'SHIFT-HOME: Badge sign-in succeeded, but the employee home did not open. Refresh the register.'
     :reason.includes('Register is not ready')
      ?'SHIFT-REGISTER: The staging register is not ready for employee sign-in.'
      :reason==='Invalid employee credentials'
       ?'SHIFT-FORMAT: Scanned badge or PIN format was not accepted. Do not re-enroll your badge.'
       :reason.includes('Staff access was not verified')
        ?'SHIFT-DENIED: The sign-in server rejected the badge/PIN. Do not re-enroll your badge.'
        :'SHIFT-CONNECTION: The staff sign-in service could not finish the request. Your credentials were not changed.';
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
    api.refreshExternalApprovalUI?.();
    message('Hello, '+verified.firstName+'! Continue your current order.');
   }else if(state()?.phase==='home'&&bridge?.state?.().locked){
    const verified=await bridge.unlockNextSale(badge);
    if(!showEmployeeHome(bridge?.state?.().employee))
     throw Error('Employee home is unavailable');
    returnBadge.value='';
    resetOverlay();
    message('Hello, '+verified.firstName+'! Choose your next action.');
   }else{
    await bridge.resumeWithBadge(badge);
    api.refreshExternalApprovalUI?.();
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
  employee:()=>bridge?.state?.().employee||null,
  showEmployeeHome:()=>showEmployeeHome(),
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

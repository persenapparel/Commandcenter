'use strict';
/* Single-iPad handoff remains fail-closed until the checkout-scoped guest
 * gateway is deployed and independently verified. Do not revive legacy
 * register-wide pairing tokens or same-origin customer iframes.
 */
(()=>{
 const $=id=>document.getElementById(id);
 const start=$('start'),overlay=$('swivel-overlay'),frame=$('swivel-customer-frame');
 if(!start||!overlay||!frame)throw Error('Single-iPad POS needs the cashier checkout layout.');
 const blocked='Customer handoff is temporarily unavailable: secure customer isolation is required. Do not turn this signed-in iPad toward a customer.';
 function update(){
  document.body.dataset.checkoutDeviceMode='swivel';
  const hint=document.querySelector('.live-cart-hint');
  if(hint)hint.textContent='Scan everything first. Customer handoff is unavailable until secure checkout is verified.';
  start.textContent='Hand to Customer →';
  const resume=$('swivel-resume');
  if(resume)resume.hidden=true;
  overlay.hidden=true;
  frame.removeAttribute('src');
  document.body.classList.remove('swivel-customer-active');
 }
 function deny(){
  update();
  notice(blocked);
 }
 start.onclick=deny;
 const resume=$('swivel-resume');
 if(resume)resume.onclick=deny;
 // The legacy customer iframe, register-wide pairing RPC, and in-page
 // password reauthentication were intentionally removed. The replacement
 // must issue a per-checkout server capability and use an isolated guest
 // execution context with a separate authenticated cashier return path.
 update();
 window.PersenPOSSwivel={mode:()=> 'swivel',active:()=>false};
})();

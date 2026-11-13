'use strict';
/* Staging-only, single-iPad cashier/customer handoff. Does not change any sale,
   cash tender, receipt, inventory, or pairing RPC semantics. */
(()=>{
 const key='persen-pos-checkout-device-mode';
 const $=id=>document.getElementById(id);
 const choose=()=>localStorage.getItem(key)==='dual'?'dual':'swivel';
 let mode=choose(),swivelStarting=false,privatePairingUrl='',issuedAt=0;
 const originalBegin=$('start').onclick;
 const overlay=$('swivel-overlay'),frame=$('swivel-customer-frame');
 if(!originalBegin||!overlay||!frame)throw Error('Single-iPad POS needs the cashier checkout layout.');
 function update(){
  document.body.dataset.checkoutDeviceMode=mode;
  for(const input of document.querySelectorAll('input[name="checkout-device-mode"]'))input.checked=input.value===mode;
  for(const id of ['pair','pair-quick','pair-setup']){
   const el=$(id);if(el)el.hidden=mode==='swivel';
  }
  const hint=document.querySelector('.live-cart-hint');
  if(hint)hint.textContent=mode==='swivel'
   ?'Scan everything first. Hand this iPad to the customer to enter their details and review the total.'
   :'The paired second iPad automatically displays the live cart.';
  $('start').textContent=mode==='swivel'?'Hand to Customer →':'Continue to customer questions →';
  $('swivel-resume').hidden=mode!=='swivel'||!checkout||checkout.status!=='awaiting_customer'||!overlay.hidden;
 }
 async function pairing(){
  // Private token stays in memory; issue a fresh token before its 2-hour expiry.
  if(privatePairingUrl&&Date.now()-issuedAt<105*60*1000)return privatePairingUrl;
  if(!register||!db||!user)throw Error('Sign in and open the register first.');
  const token=await check(db.rpc('pos_issue_display_pairing',{p_register:register.id}));
  if(!/^[0-9a-f-]{36}$/i.test(String(token)))throw Error('Could not create customer checkout link.');
  const url=new URL('display.html',location.href);
  url.searchParams.set('pair',token);
  privatePairingUrl=url.href;issuedAt=Date.now();
  // Preserve the existing private-pairing controls for the optional second iPad.
  showPairingUrl(privatePairingUrl);
  return privatePairingUrl;
 }
 function open(url){
  const target=new URL(url,location.href);
  if(target.origin!==location.origin||!target.pathname.endsWith('/display.html')||!target.searchParams.get('pair'))throw Error('Invalid display address.');
  $('swivel-unlock-form').hidden=true;
  $('swivel-password').value='';
  $('swivel-unlock-message').textContent='';
  frame.src=target.href;
  overlay.hidden=false;
  document.body.classList.add('swivel-customer-active');
  for(const element of [document.querySelector('body > header'),document.querySelector('body > main')])if(element)element.inert=true;
  update();
 }
 function close(){
  overlay.hidden=true;frame.src='about:blank';
  $('swivel-password').value='';$('swivel-unlock-message').textContent='';
  document.body.classList.remove('swivel-customer-active');
  for(const element of [document.querySelector('body > header'),document.querySelector('body > main')])if(element)element.inert=false;
  update();
  notice('Cashier mode restored. Complete payment or let the customer continue.');
 }
 $('start').onclick=async()=>{
  if(mode!=='swivel')return originalBegin();
  if(swivelStarting||busy||checkout||pendingCash)return;
  swivelStarting=true;
  $('start').disabled=true;
  try{
   const url=await pairing(); // Do not begin if customer screen cannot pair.
   await originalBegin();
   if(checkout?.status==='awaiting_customer'){
    open(url);notice('Customer checkout opened on this iPad. Turn the swivel stand toward the customer.');
   }
  }catch(e){notice('Customer screen unavailable. Checkout not started: '+e.message)}
  finally{swivelStarting=false;update();$('start').disabled=!!checkout||!!pendingCash||!cart.length}
 };
 for(const input of document.querySelectorAll('input[name="checkout-device-mode"]')){
  input.addEventListener('change',()=>{
   if(!input.checked)return;
   if(checkout||pendingCash){
    update();notice('Finish or cancel the current checkout before changing device mode.');return;
   }
   mode=input.value==='dual'?'dual':'swivel';
   localStorage.setItem(key,mode);
   update();notice(mode==='swivel'?'Single swivel iPad mode selected.':'Two-iPad customer display mode selected.');
  });
 }
 $('swivel-resume').onclick=async()=>{
  if(!checkout||checkout.status!=='awaiting_customer')return;
  const button=$('swivel-resume');button.disabled=true;
  try{open(await pairing())}
  catch(e){notice('Unable to resume customer checkout: '+e.message)}
  finally{button.disabled=false;update()}
 };
 $('swivel-lock').onclick=()=>{
  $('swivel-unlock-form').hidden=false;
  $('swivel-password').focus();
 };
 $('swivel-keep-customer').onclick=()=>{
  $('swivel-password').value='';$('swivel-unlock-message').textContent='';
  $('swivel-unlock-form').hidden=true;
 };
 $('swivel-unlock-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const button=$('swivel-unlock-submit'),password=$('swivel-password').value;
  if(!password||!user?.email)return;
  button.disabled=true;$('swivel-unlock-message').textContent='Verifying cashier account…';
  try{
   // An on-screen exit button alone would expose the signed-in cashier app.
   const {data,error}=await db.auth.signInWithPassword({email:user.email,password});
   if(error)throw error;
   if(data?.user?.id!==user.id||!await PA.isAdmin(user))throw Error('Owner authentication required.');
   close();await status();
  }catch(e){
   $('swivel-unlock-message').textContent='Cannot unlock: '+(e.message||'Check password and internet connection.');
   $('swivel-password').value='';
  }finally{button.disabled=false}
 });
 update();
 // Keep the resume action accurate when another page updates checkout state.
 setInterval(update,1800);
 window.PersenPOSSwivel={mode:()=>mode,active:()=>!overlay.hidden};
})();
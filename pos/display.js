'use strict';

/* Persen POS customer iPad — one page/question at a time.
   No browser keypad is used for phone entry. Receipt choices: print/email/both.
   Payments other than cash show INFORMATION ONLY, never a paid confirmation.
 */
const $=id=>document.getElementById(id);
const C=window.PersenPOSCore;
const Wizard=window.PersenPOSWizard;
const Experience=window.PersenPOSExperience;
const PAYMENT_INFO={
 cash:{label:'Cash',message:'Please pay the cashier. Your order is only recorded as paid once the cashier confirms the money received.'},
 venmo_info:{label:'Venmo instructions only',message:'Business account: @persenapparel. Ask the cashier to confirm this is an approved account before sending anything. This screen cannot verify funds or complete the payment.'},
 apple_cash_info:{label:'Apple Cash via Messages — not Apple Pay',message:'Contact: (631) 644-0633. Ask the cashier to confirm the number is registered for Apple Cash before sending. This screen cannot verify or complete a payment.'}
};
const form=$('contact');
const stepSections=[...document.querySelectorAll('.wizard-step')];
const checked=async query=>{
 const {data,error}=await query;
 if(error)throw error;
 return data;
};
let token=new URL(location.href).searchParams.get('pair');
let db=null,checkoutId=null,activeId=null,phoneDigits='',stepIndex=0,submitting=false,waiting=false;
let lastStatus=null;
const show=text=>$('state').textContent=text;
function chosen(name){return form.querySelector('input[name="'+name+'"]:checked')?.value||''}
function values(){
 return {
  phone:phoneDigits,
  email:$('email-address').value.trim(),
  receipt:chosen('receipt_mode')||'print',
  payment:chosen('payment_preference')||'cash',
  marketing:chosen('marketing'),
  rating:chosen('rating'),
  interest:chosen('interest')
 };
}
function error(message=''){
 const box=$('step-error');
 box.textContent=message;
 box.hidden=!message;
}
function showPaymentInfo(value){
 const info=PAYMENT_INFO[value]||PAYMENT_INFO.cash;
 const target=$('payment-instructions');
 target.replaceChildren();
 const title=document.createElement('strong');
 title.textContent=info.label;
 const p=document.createElement('p');
 p.textContent=info.message;
 target.append(title,p);
 target.dataset.method=value;
}
function phoneDisplay(){
 $('phone-display').value=Wizard.formatPhone(phoneDigits);
 $('phone-helper').textContent=phoneDigits.length+' of 10 digits';
}
function emailContext(){
 const needsEmail=Wizard.receipt(chosen('receipt_mode')).email;
 $('email-explanation').textContent=needsEmail
  ?'Enter your email address for your selected receipt. Email delivery will be available after setup is complete.'
  :'You can leave an email for order contact, or skip this step. This does not subscribe you to promotions.';
 $('email-helper').textContent=needsEmail?'Required for Email or Both receipt preferences.':'Optional — skip if you prefer not to share an email.';
}
function reviewSummary(){
 const target=$('wizard-review-summary');
 target.replaceChildren();
 const v=Wizard.summary(values());
 const receipt={print:'Printed',email:'Email',both:'Printed + Email'}[v.receipt.mode]||'Printed';
 const payment=PAYMENT_INFO[v.payment]?.label||'Cash';
 const rows=[
  ['Phone',v.phone],
  ['Receipt',receipt],
  ['Email',v.email||'Not provided'],
  ['Payment',payment],
  ['Promotions',v.promo?'Opted in':'Not subscribed'],
  ['Rating',v.rating?v.rating+' / 5 stars':'Skipped'],
  ['Custom apparel',v.interest==='yes'?'Interested':v.interest==='maybe'?'Maybe later':v.interest==='no'?'Not right now':'Skipped']
 ];
 for(const [label,value] of rows){
  const row=document.createElement('div');
  row.className='wizard-review-row';
  const left=document.createElement('span'),right=document.createElement('strong');
  left.textContent=label;right.textContent=value;
  row.append(left,right);target.append(row);
 }
}
function showStep(next,focus=false){
 stepIndex=Math.max(0,Math.min(Wizard.steps.length-1,next));
 const selected=Wizard.steps[stepIndex];
 for(const el of stepSections){
  el.hidden=el.dataset.step!==selected.id;
 }
 $('progress-label').textContent='Step '+(stepIndex+1)+' of '+Wizard.steps.length;
 const pct=Math.round((stepIndex+1)/Wizard.steps.length*100);
 $('progress-percent').textContent=pct+'%';
 $('progress-fill').style.width=pct+'%';
 $('progress-track').setAttribute('aria-valuenow',String(stepIndex+1));
 $('wizard-back').hidden=stepIndex===0;
 $('wizard-next').hidden=stepIndex===Wizard.steps.length-1;
 $('wizard-finish').hidden=stepIndex!==Wizard.steps.length-1;
 $('wizard-skip-optional').hidden=!['promos','rating','custom'].includes(selected.id);
 $('wizard-next').textContent=selected.id==='rating'||selected.id==='custom'||selected.id==='promos'
  ?'Continue or skip →':'Continue →';
 error();
 if(selected.id==='email')emailContext();
 if(selected.id==='review')reviewSummary();
 if(focus){
  const heading=stepSections[stepIndex].querySelector('h1');
  if(heading)heading.focus({preventScroll:true});
  form.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
 }
}
function resetWizard(){
 form.reset();
 phoneDigits='';
 stepIndex=0;submitting=false;
 phoneDisplay();
 showPaymentInfo('cash');
 $('waiting-payment').hidden=true;
 $('thanks').hidden=true;
 $('wizard-next').disabled=false;
 $('wizard-finish').disabled=false;
 showStep(0,false);
}
function navigateNext(){
 if(submitting||!checkoutId)return;
 const issue=Wizard.checkStep(Wizard.steps[stepIndex].id,values());
 if(issue){error(issue);return}
 if(stepIndex<Wizard.steps.length-1)showStep(stepIndex+1,true);
}
function navigateBack(){if(!submitting&&stepIndex>0)showStep(stepIndex-1,true)}
function ensureValidWholeWizard(){
 const all=values();
 for(let i=0;i<Wizard.steps.length;i++){
  const issue=Wizard.checkStep(Wizard.steps[i].id,all);
  if(issue){showStep(i,true);error(issue);return false}
 }
 return true;
}
function render(session){
 const status=session?.status||'unpaired';
 if(status==='unpaired'||status==='expired'){
  checkoutId=null;
  form.hidden=true;
  $('waiting-payment').hidden=true;
  $('thanks').hidden=true;
  show('This iPad is not paired. Please ask the cashier to connect it.');
  return;
 }
 const newId=session.checkout_id||null;
 if(newId!==activeId){
  activeId=newId;
  checkoutId=newId;
  resetWizard();
 }else checkoutId=newId;
 const orderItems=$('items');
 orderItems.replaceChildren();
 for(const item of session.items||[]){
  const row=document.createElement('div');
  row.className='cart-row';
  const name=document.createElement('span'),price=document.createElement('strong');
  name.textContent=String(item.qty||0)+' × '+String(item.name||'Item')+' '+[item.color,item.size].filter(Boolean).join(' / ');
  price.textContent=C.money((item.qty||0)*(item.unit_cents||0));
  row.append(name,price);orderItems.append(row);
 }
 $('total').textContent=C.money(session.total_cents||0);
 form.hidden=status!=='awaiting_customer'||submitting;
 $('waiting-payment').hidden=status!=='contact_received';
 $('thanks').hidden=status!=='completed';
 if(!session.checkout_id){
  form.hidden=true;$('waiting-payment').hidden=true;$('thanks').hidden=true;
 }
 const messages={
  idle:'Your next order will appear here.',
  awaiting_customer:'Complete the steps below',
  contact_received:'Choices saved — please finish with your cashier.',
  completed:'Payment confirmed — thank you!',
  cancelled:'This checkout was cancelled. Please see your cashier.'
 };
 show(messages[status]||status);
 if(lastStatus!==status){
  lastStatus=status;
  if(status==='contact_received'||status==='completed'){
   // Do not leave a customer's phone and email visible for the next person.
   phoneDigits='';
   $('phone-display').value='';
   $('email-address').value='';
   $('wizard-review-summary').replaceChildren();
  }
 }
}
async function refresh(){
 if(waiting||!db||!token)return;
 waiting=true;
 try{
  const session=await checked(db.rpc('pos_customer_view',{p_secret:token}));
  render(session);
 }catch(err){show('Connection interrupted. Please ask the cashier if it does not reconnect.')}
 finally{waiting=false}
}
async function finish(){
 if(submitting||!checkoutId)return;
 if(!ensureValidWholeWizard())return;
 const v=values();
 const receipts=Wizard.receipt(v.receipt);
 const id=checkoutId;
 submitting=true;
 $('wizard-finish').disabled=true;
 $('wizard-next').disabled=true;
 error();
 try{
  await checked(db.rpc('pos_submit_customer',{
   p_secret:token,
   p_checkout:id,
   p_phone:C.phone(Wizard.formatPhone(v.phone)),
   p_email:v.email||null,
   p_marketing_opt_in:v.marketing==='yes',
   p_rating:v.rating?Number(v.rating):null,
   p_interest:v.interest||'not_answered',
   p_payment_preference:v.payment,
   p_print_receipt:receipts.print,
   p_email_receipt:receipts.email
  }));
  form.hidden=true;
  $('waiting-payment').hidden=false;
  show('Thanks! Your choices were saved. Please see the cashier.');
  await refresh();
 }catch(err){
  error(err?.message||'Checkout could not be submitted. Please try again.');
  show('Please confirm your details and try again.');
 }finally{
  submitting=false;
  $('wizard-finish').disabled=false;
  $('wizard-next').disabled=false;
 }
}
$('phone-keypad').addEventListener('click',event=>{
 const button=event.target.closest('button[data-digit]');
 if(!button||submitting)return;
 phoneDigits=Wizard.dial(phoneDigits,button.dataset.digit);
 phoneDisplay();
 error();
});
for(const input of form.querySelectorAll('input[name="payment_preference"]')){
 input.addEventListener('change',()=>{
  if(input.checked)showPaymentInfo(input.value);
 });
}
for(const input of form.querySelectorAll('input[name="receipt_mode"]')){
 input.addEventListener('change',emailContext);
}
$('wizard-next').addEventListener('click',navigateNext);
$('wizard-back').addEventListener('click',navigateBack);
$('wizard-skip-optional').addEventListener('click',()=>{if(!submitting)showStep(Wizard.steps.findIndex(x=>x.id==='review'),true)});
$('wizard-finish').addEventListener('click',finish);
form.addEventListener('submit',event=>event.preventDefault());
form.addEventListener('keydown',event=>{
 if(event.key==='Enter'&&event.target.tagName==='INPUT'){
  event.preventDefault();
  if(stepIndex===Wizard.steps.length-1)void finish();
  else navigateNext();
 }
});
async function start(){
 resetWizard();
 if(!window.PA?.ready){show('Register connection unavailable.');return}
 if(!token||!/^[0-9a-f-]{36}$/i.test(token)){
  show('Open the private pairing link provided by the cashier.');return;
 }
 db=PA.db;
 history.replaceState(null,'',location.pathname);
 try{
  const result=await checked(db.from('site_content').select('value').eq('key','seasonal_campaigns_v1').maybeSingle());
  const campaign=C.season(result?.value);
  if(campaign){
   Experience.apply(document,campaign);
   const banner=$('seasonal-banner');
   $('seasonal-banner-title').textContent=String(campaign.title||'Seasonal Collection').slice(0,100);
   $('seasonal-banner-description').textContent=String(campaign.announcement||campaign.subtitle||'See the seasonal collection at persenapparel.com').slice(0,180);
   banner.hidden=false;
  }
 }catch{/* Seasonal Studio is optional; checkout remains usable. */}
 await refresh();
 setInterval(refresh,1500);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh()});
}
void start();

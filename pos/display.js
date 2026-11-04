'use strict';const $=id=>document.getElementById(id),C=window.PersenPOSCore,Experience=window.PersenPOSExperience;let token=new URL(location.href).searchParams.get('pair'),checkoutId=null,db=null,lastStatus=null,waiting=false;const show=s=>$('state').textContent=s;const checked=async q=>{const {data,error}=await q;if(error)throw error;return data};
const PAYMENT_INFO={
cash:{label:'Cash',message:'Pay the cashier when they are ready. This checkout is not completed until the cashier records the cash received.'},
venmo_info:{label:'Venmo · payment instructions only',message:'Business account: @persenapparel. Only use it if the cashier confirms it is an eligible, approved account. This screen cannot verify any payment or mark your order paid.'},
apple_cash_info:{label:'Apple Cash via Messages · not Apple Pay',message:'Contact: (631) 644-0633. Ask the cashier to confirm that this number is registered and authorized for Apple Cash before sending anything. This screen cannot verify funds or finish checkout.'}
};
function showPaymentInfo(value){
 const info=PAYMENT_INFO[value]||PAYMENT_INFO.cash,div=$('payment-instructions');
 div.replaceChildren();
 const heading=document.createElement('strong');heading.textContent=info.label;
 const p=document.createElement('p');p.textContent=info.message;
 div.append(heading,p);div.dataset.method=value;
}
for(const radio of document.querySelectorAll('input[name="payment_preference"]')){
 radio.addEventListener('change',()=>{if(radio.checked)showPaymentInfo(radio.value)});
}
showPaymentInfo('cash');
function render(s){const status=s.status||'unpaired';if(status==='unpaired'||status==='expired'){show('This register is not paired. Ask your cashier to pair the iPad.');$('contact').hidden=true;return}checkoutId=s.checkout_id||null;$('items').replaceChildren();for(const item of s.items||[]){const row=document.createElement('div');row.className='cart-row';const title=document.createElement('span');title.textContent=item.qty+' × '+item.name+' '+[item.color,item.size].filter(Boolean).join(' / ');const price=document.createElement('strong');price.textContent=C.money(item.qty*item.unit_cents);row.append(title,price);$('items').append(row)}$('total').textContent=C.money(s.total_cents||0);
$('contact').hidden=status!=='awaiting_customer';$('thanks').hidden=status!=='completed';show({idle:'Ready for your next customer',awaiting_customer:'Please enter your contact information',contact_received:'Please ask the cashier to verify your selected payment method.',completed:'Payment confirmed by cashier — thank you!',cancelled:'This checkout was cancelled.'}[status]||status);
if(lastStatus!==status){lastStatus=status;}
}
async function refresh(){if(waiting||!db||!token)return;waiting=true;try{const s=await checked(db.rpc('pos_customer_view',{p_secret:token}));render(s)}catch(e){show('Connection interrupted. Retrying automatically.')}finally{waiting=false}}
$('contact').onsubmit=async e=>{e.preventDefault();if(!checkoutId)return;const f=new FormData(e.target);try{const phone=C.phone(f.get('phone'));const email=String(f.get('email')||'').trim();if(f.has('receipt_email')&&!email)throw Error('Please enter an email address for an emailed receipt.');await checked(db.rpc('pos_submit_customer',{p_secret:token,p_checkout:checkoutId,p_phone:phone,p_email:email||null,p_marketing_opt_in:f.get('marketing')==='yes',p_rating:f.get('rating')?Number(f.get('rating')):null,p_interest:f.get('interest')||'not_answered',p_payment_preference:f.get('payment_preference')||'cash',p_print_receipt:f.has('receipt_print'),p_email_receipt:f.has('receipt_email'),p_sms_receipt:f.has('receipt_sms')}));show('Contact saved. Please pay your cashier.');$('contact').hidden=true;await refresh()}catch(err){show(err.message)}};
async function start(){if(!window.PA?.ready){show('Unable to connect to the register');return}if(!token||!/^[0-9a-f-]{36}$/i.test(token)){show('Open the secure pairing link from the cashier');return}db=PA.db;history.replaceState(null,'',location.pathname);
try{
 const result=await checked(db.from('site_content').select('value').eq('key','seasonal_campaigns_v1').maybeSingle());
 const campaign=C.season(result?.value);
 if(campaign){
 Experience.apply(document,campaign);const banner=$('seasonal-banner');
 $('seasonal-banner-title').textContent=String(campaign.title||'Seasonal Collection').slice(0,100);
 $('seasonal-banner-description').textContent=String(campaign.announcement||campaign.subtitle||'Explore our seasonal collection at persenapparel.com').slice(0,200);
 const hex=C.safeHex(campaign.accent);
 banner.style.borderColor=hex;banner.hidden=false;
 }
}catch{/* Optional seasonal banner only; checkout remains usable. */}
await refresh();setInterval(refresh,1500);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});}start();
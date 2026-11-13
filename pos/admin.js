'use strict';
const $=id=>document.getElementById(id);
let db=null,owner=null,stock=[],meta=new Map(),events=[],liveTimer=null;
const formatPrice=n=>'$'+(Number(n||0)/100).toFixed(2);
const say=m=>{$('notice').textContent=String(m)};
async function checked(q){const {data,error}=await q;if(error)throw error;return data}
const elem=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=String(text);if(cls)e.className=cls;return e};
const sizes=['XS','S','M','L','XL','2XL','3XL','4XL','One Size'];
for(const size of sizes){const label=elem('label',size);const input=elem('input');input.type='number';input.min='0';input.max='1000000';input.step='1';input.value='0';input.name=size;input.inputMode='numeric';input.setAttribute('aria-label','Quantity for '+size);label.append(input);$('size-grid').append(label)}
function moneyToCents(value){if(!/^\d+(\.\d{1,2})?$/.test(String(value).trim()))throw Error('Enter a valid price with up to two decimals');const n=Math.round(Number(value)*100);if(!Number.isSafeInteger(n)||n>10000000)throw Error('Price is too large');if(n<=0)throw Error('Enter a selling price above $0.00');return n}
async function loadInventory(){
 stock=await checked(db.from('stock_items').select('id,sku,product_name,color,size,quantity,reorder_at').order('product_name').limit(1000));
 const details=await checked(db.from('pos_variant_details').select('stock_id,price_cents,taxable,category,product_type').limit(1000));
 meta=new Map(details.map(x=>[x.stock_id,x]));
 $('stat-variants').textContent=stock.length; $('stat-pieces').textContent=stock.reduce((n,x)=>n+x.quantity,0);$('stat-low').textContent=stock.filter(x=>x.quantity<=x.reorder_at).length;
 drawInventory();
}
function inputField(label,value,name,type){
 const box=elem('label',label);const input=elem('input');input.type=type||'text';input.value=value??'';input.name=name;
 if(type==='number'){input.min='0';input.max=name==='price'?'100000':'1000000';input.step=name==='price'?'.01':'1';input.inputMode='decimal'}
 box.append(input);return box
}
function drawInventory(){
 const host=$('inventory-list');host.replaceChildren();
 const link=elem('a','Open shared inventory editor →');link.href='inventory.html';host.append(link);
 const note=elem('p','Use Sales Products to edit a product with all its sizes together. Register stock comes from these same tables.');host.append(note);
}
$('inventory-search').oninput=drawInventory;
$('refresh').onclick=async()=>{try{await loadInventory();say('Inventory refreshed from staging database.')}catch(e){say('Inventory refresh failed: '+e.message)}};
$('create-products').onsubmit=async e=>{
 e.preventDefault();const button=$('save-products');button.disabled=true;
 try{
  const form=e.currentTarget;const f=new FormData(form);const q={};
  for(const size of sizes){const value=String(f.get(size)||'0');if(!/^\d+$/.test(value)||Number(value)>1000000)throw Error('Check the stock number for '+size);q[size]=Number(value)}
  if(!Object.values(q).some(n=>n>0))throw Error('Enter a quantity above 0 for at least one size');
  const cents=moneyToCents(f.get('price'));
  const count=await checked(db.rpc('pos_create_product_group',{p_name:String(f.get('name')||'').trim(),p_color:String(f.get('color')||'').trim(),p_category:String(f.get('category')||'Apparel').trim(),p_type:String(f.get('type')||'other'),p_supplier:String(f.get('supplier')||''),p_price_cents:cents,p_taxable:f.has('taxable'),p_sizes:q}));
  form.reset();say('Saved '+count+' size variant'+(count===1?'':'s')+'! Stock and prices are now stored in staging.');await loadInventory();
 }catch(err){say('Product was not saved: '+err.message)}finally{button.disabled=false}
};
async function loadEvents(){events=await checked(db.from('pos_events').select('id,name,event_date,venue,status').order('event_date',{ascending:false}).limit(15));const host=$('event-list');host.replaceChildren();if(!events.length){host.append(elem('p','No events created yet.','muted'));return}for(const event of events){host.append(elem('div',event.name+' · '+event.event_date+' · '+event.status,'event-pill'))}}
$('event-form').onsubmit=async e=>{
 e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;
 try{const form=e.currentTarget,f=new FormData(form);await checked(db.from('pos_events').insert({owner_id:owner.id,name:String(f.get('name')||'').trim(),event_date:String(f.get('event_date')),venue:String(f.get('venue')||'').trim(),status:'open'}));form.reset();await loadEvents();say('Event saved. Select it on the cashier when starting the event.')}
 catch(err){say('Event save failed: '+err.message)}finally{button.disabled=false}
};
async function live(){
 try{
  const rows=await checked(db.from('pos_checkouts').select('id,status,customer_step,help_requested,total_cents,updated_at').in('status',['awaiting_customer','contact_received']).order('created_at',{ascending:false}).limit(8));
  $('stat-active').textContent=rows.length;$('monitor-indicator').textContent=rows.length?'Live':'Ready';
  const host=$('live-list');host.replaceChildren();
  if(!rows.length){host.append(elem('div','No active checkout · Ready for the next customer','live-item'));return}
  for(const row of rows){const card=elem('div',null,'live-item');const top=elem('div',null,'live-top');top.append(elem('span',row.status==='contact_received'?'Ready for payment':'Customer is checking out'),elem('span',formatPrice(row.total_cents)));card.append(top,elem('small',row.status==='contact_received'?'Customer completed their steps':'Current step: '+(row.customer_step||'phone')));if(row.help_requested)card.append(elem('small','Customer requested help','help'));host.append(card)}
 }catch(err){$('monitor-indicator').textContent='Offline';$('live-list').textContent='Monitor unavailable: '+err.message}
}
/* Protected checkout insights. Responses come from the POS staging checkout table:
 * - Saved only after explicit customer submission
 * - Unsubmitted draft answers are not available to the cashier/back office
 * - RLS allows owner/admin read, never anonymous customer access.
 * Marketing opt-in requires a recorded 'yes', never receipt/email alone.
 */
let customerResponses=[],responseSales=new Map(),selectedResponseId=null;
const showDate=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString():'Unknown date'};
const maskPhone=value=>{const v=String(value||'').replace(/\D/g,'');return v.length>=4?'•••-••'+v.slice(-4):'No phone'};
const responseEvent=row=>events.find(e=>e.id===row.event_id)?.name||(row.event_id?'Event '+String(row.event_id).slice(0,8):'Walk-in');
const marketingText=row=>row.marketing_response==='yes'?'Yes — explicitly opted in':row.marketing_response==='no'?'No — declined':'Not answered (not subscribed)';
const interestText=row=>({yes:'Yes — wants custom apparel information',maybe:'Maybe in the future',no:'Not right now',not_answered:'Skipped / no answer'})[row.custom_interest]||'Skipped / no answer';
const paymentText=row=>({cash:'Cash',venmo_info:'Venmo details shown (not processed)',apple_cash_info:'Apple Cash details shown (not processed)'})[row.payment_preference]||'Not selected';
const receiptText=row=>[row.receipt_print?'Printed':null,row.receipt_email?'Email requested':null].filter(Boolean).join(' + ')||'No receipt requested';
const responseStatus=row=>responseSales.has(row.id)?'Paid · '+(row.cash_handoff_complete?'Finished':'Handoff pending'):row.status==='contact_received'?'Customer finished · awaiting payment':row.status==='cancelled'?'Cancelled after answers':row.status==='completed'?'Completed':'In progress';
const responseItems=row=>Array.isArray(row.items)?row.items.map(i=>String(i.qty||0)+' × '+String(i.name||'Item')+' '+[i.color,i.size].filter(Boolean).join(' / ')).join('; '):'';
const hasResponses=row=>Boolean(String(row.phone||'').trim())&&['contact_received','completed','cancelled'].includes(row.status);
const matchingResponses=()=>{
 const search=$('response-search').value.trim().toLowerCase();
 const filter=$('response-status').value;
 return customerResponses.filter(row=>
  (filter==='all'||row.status===filter)&&
  (!search||[row.phone,row.email,responseEvent(row),responseItems(row)].filter(Boolean).join(' ').toLowerCase().includes(search)));
};
function responseField(grid,label,value){
 const node=elem('div',null,'response-field');
 node.append(elem('small',label),elem('strong',value??'—'));
 grid.append(node);
}
function renderResponseDetail(){
 const root=$('response-detail');root.replaceChildren();
 const row=customerResponses.find(x=>x.id===selectedResponseId);
 root.hidden=!row;if(!row)return;
 const header=elem('div',null,'response-detail-head');
 const h=elem('div');h.append(elem('h3','Checkout responses'),elem('div',showDate(row.created_at)+' · '+responseStatus(row),'muted'));
 const close=elem('button','Close details');close.type='button';close.onclick=()=>{selectedResponseId=null;renderResponseDetail()};
 header.append(h,close);root.append(header);
 const grid=elem('div',null,'response-grid');
 responseField(grid,'Customer phone',row.phone||'Not provided');
 responseField(grid,'Customer email',row.email||'Not provided');
 responseField(grid,'Receipt choice',receiptText(row));
 responseField(grid,'Payment selected',paymentText(row));
 responseField(grid,'Promotional messages',marketingText(row));
 responseField(grid,'Private rating',row.rating!=null?row.rating+' / 5 stars':'Skipped / no answer');
 responseField(grid,'Need custom apparel?',interestText(row));
 responseField(grid,'Event / location',responseEvent(row));
 responseField(grid,'Sale amount',formatPrice(row.total_cents));
 const sale=responseSales.get(row.id);
 responseField(grid,'Payment actually recorded',sale?'Cash · '+formatPrice(sale.tendered_cents)+' received':'Not paid in this POS');
 responseField(grid,'Change owed',sale?formatPrice(sale.change_cents):'Not applicable');
 responseField(grid,'Order ID',sale?.id||row.id);
 root.append(grid,elem('p','Items: '+(responseItems(row)||'None'),'response-items'));
 const foot=elem('p','This information is for order service and internal reporting. A printed receipt or collected phone/email does not authorize promotional messages.','muted');
 root.append(foot);
}
function renderResponses(){
 const rows=matchingResponses(),host=$('response-list');host.replaceChildren();
 const answered=customerResponses;
 $('response-count').textContent=String(answered.length);
 $('response-optins').textContent=String(answered.filter(r=>r.marketing_response==='yes').length);
 $('response-leads').textContent=String(answered.filter(r=>['yes','maybe'].includes(r.custom_interest)).length);
 const rated=answered.map(r=>Number(r.rating)).filter(v=>Number.isInteger(v)&&v>=1&&v<=5);
 $('response-rating').textContent=rated.length?(rated.reduce((a,b)=>a+b,0)/rated.length).toFixed(1)+' / 5':'—';
 $('responses-export').disabled=rows.length===0;
 $('response-message').textContent=rows.length+' matching saved response'+(rows.length===1?'':'s')+' (latest 500 checkout records).';
 if(!rows.length){host.append(elem('p','No saved responses match your filters. Answers appear after a customer submits the final checkout screen.','muted'));renderResponseDetail();return}
 for(const row of rows){
  const card=elem('button',null,'response-card');card.type='button';
  const left=elem('div');const title=row.email||maskPhone(row.phone);
  left.append(elem('strong',title),elem('small',showDate(row.created_at)+' · '+responseEvent(row)),elem('div',responseStatus(row)+' · '+(row.rating?row.rating+'/5 stars':'No rating')+' · '+(row.marketing_response==='yes'?'Opted in':'No marketing opt-in'),'response-summary'));
  const amount=elem('span',formatPrice(row.total_cents),'response-total');
  card.append(left,amount);
  card.setAttribute('aria-label','View customer responses for '+(row.email||maskPhone(row.phone)));
  card.onclick=()=>{selectedResponseId=row.id;renderResponseDetail();$('response-detail').scrollIntoView({block:'nearest',behavior:'smooth'})};
  host.append(card);
 }
 renderResponseDetail();
}
async function loadResponses(){
 if(!owner)return;
 $('responses-refresh').disabled=true;
 try{
  const [checkouts,sales]=await Promise.all([
   checked(db.from('pos_checkouts').select('id,status,cash_handoff_complete,customer_step,created_at,phone,email,marketing_opt_in,marketing_response,rating,custom_interest,receipt_print,receipt_email,payment_preference,event_id,total_cents,items').order('created_at',{ascending:false}).limit(500)),
   checked(db.from('pos_sales').select('id,checkout_id,total_cents,tendered_cents,change_cents,created_at').order('created_at',{ascending:false}).limit(500))
  ]);
  customerResponses=(checkouts||[]).filter(hasResponses);
  responseSales=new Map((sales||[]).map(x=>[x.checkout_id,x]));
  renderResponses();
 }catch(err){
  $('response-message').textContent='Could not load saved responses: '+err.message;
  $('responses-export').disabled=true;
  $('response-list').replaceChildren();
 }finally{$('responses-refresh').disabled=false}
}
function csvSafe(value){
 let str=String(value??'');
 // Prevent spreadsheet formula execution in locally exported contact/answer data.
 if(/^[\s]*[=+\-@\t\r]/.test(str))str="'"+str;
 return '"'+str.replace(/"/g,'""')+'"';
}
function exportResponses(){
 const rows=matchingResponses();
 if(!rows.length)return;
 const heads=['Date','Status','Event','Phone','Email','Receipt','Payment selected','Marketing answer','Marketing opt-in','Private rating','Custom apparel interest','Amount due','Paid status','Cash received','Change owed','Items','Checkout ID'];
 const values=rows.map(r=>[showDate(r.created_at),responseStatus(r),responseEvent(r),r.phone||'',r.email||'',receiptText(r),paymentText(r),r.marketing_response||'not_answered',r.marketing_response==='yes'?'yes':'no',r.rating??'',r.custom_interest||'not_answered',(Number(r.total_cents||0)/100).toFixed(2),responseSales.has(r.id)?'paid':'not_paid',responseSales.get(r.id)?(responseSales.get(r.id).tendered_cents/100).toFixed(2):'',responseSales.get(r.id)?(responseSales.get(r.id).change_cents/100).toFixed(2):'',responseItems(r),r.id]);
 const csv=[heads.map(csvSafe).join(','),...values.map(row=>row.map(csvSafe).join(','))].join('\r\n');
 const objectUrl=URL.createObjectURL(new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8;'}));
 const a=document.createElement('a');a.href=objectUrl;a.download='persen-pos-customer-responses.csv';
 document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),1500);
 say('Downloaded '+rows.length+' saved checkout response'+(rows.length===1?'':'s')+'. Keep contact exports private.');
}
$('responses-refresh').onclick=loadResponses;
$('response-search').addEventListener('input',renderResponses);
$('response-status').addEventListener('change',renderResponses);
$('responses-export').onclick=exportResponses;

async function boot(){
 try{
  if(!window.PA?.ready)throw Error('Staging database connection unavailable');
  db=PA.db;owner=await PA.me();
  if(!owner){say('Sign in with your staging POS account.');return}
  if(!await PA.isAdmin(owner))throw Error('This account is not authorized to manage the POS');
  $('auth').hidden=true;$('workspace').hidden=false;
  await Promise.all([loadInventory(),loadEvents(),live()]);
  await loadResponses();
   window.PersenEpsonCenter?.attach({db,owner});
  if(liveTimer)clearInterval(liveTimer);liveTimer=setInterval(live,4000);
  say('Back office connected to staging. Add products, edit your inventory, and watch live checkouts here.');
 }catch(err){say('Cannot open back office: '+err.message)}
}
$('login').onsubmit=async e=>{e.preventDefault();try{const f=new FormData(e.target);await PA.signIn(String(f.get('email')),String(f.get('password')));await boot()}catch(err){say('Sign in failed: '+err.message)}};
boot();

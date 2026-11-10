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
 const host=$('inventory-list');host.replaceChildren();const q=$('inventory-search').value.trim().toLowerCase();
 const matches=stock.filter(x=>[x.product_name,x.sku,x.size,x.color,meta.get(x.id)?.category].join(' ').toLowerCase().includes(q));
 if(!matches.length){host.append(elem('p',stock.length?'No matching products.':'No products yet. Add your first item above.','inventory-empty'));return}
 const grid=elem('div',null,'inventory-grid');
 for(const item of matches){
  const d=meta.get(item.id)||{};
  const card=elem('article',null,'inventory-card');
  card.append(elem('h3',item.product_name||'Unnamed item'),elem('p',item.sku+' · '+(item.color||'No color')+' · '+(item.size||'One Size'),'sku'));
  const fields=elem('div',null,'edit-fields');
  for(const f of [
   ['Name',item.product_name,'name'],['Color',item.color,'color'],['Size',item.size,'size'],
   ['In stock',item.quantity,'quantity','number'],['Price ($)',d.price_cents>0?(d.price_cents/100).toFixed(2):'','price','number'],
   ['Category',d.category||'Apparel','category'],['Type',d.product_type||'other','type']
  ])fields.append(inputField(...f));
  const taxable=elem('label',null,'check');const check=elem('input');check.type='checkbox';check.checked=d.taxable!==false;taxable.append(check,document.createTextNode(' Taxable'));
  const button=elem('button','Save changes');button.type='button';
  button.onclick=async()=>{
   button.disabled=true;try{
    const obj=Object.fromEntries([...fields.querySelectorAll('input')].map(x=>[x.name,x.value]));
    const qty=Number(obj.quantity);if(!Number.isInteger(qty)||qty<0||qty>1000000)throw Error('Enter a whole-number stock quantity');
    const cents=moneyToCents(obj.price);
    await checked(db.rpc('pos_update_product_variant',{p_stock:item.id,p_name:obj.name,p_color:obj.color,p_size:obj.size,p_quantity:qty,p_price_cents:cents,p_taxable:check.checked,p_category:obj.category,p_type:obj.type}));
    say('Saved '+obj.name+' · '+obj.size+' — price and stock updated.');await loadInventory();
   }catch(err){say('Could not update product: '+err.message);button.disabled=false}
  };
  card.append(fields,taxable,button);grid.append(card)
 }host.append(grid)
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
async function boot(){
 try{
  if(!window.PA?.ready)throw Error('Staging database connection unavailable');
  db=PA.db;owner=await PA.me();
  if(!owner){say('Sign in with your staging POS account.');return}
  if(!await PA.isAdmin(owner))throw Error('This account is not authorized to manage the POS');
  $('auth').hidden=true;$('workspace').hidden=false;
  await Promise.all([loadInventory(),loadEvents(),live()]);
  if(liveTimer)clearInterval(liveTimer);liveTimer=setInterval(live,4000);
  say('Back office connected to staging. Add products, edit your inventory, and watch live checkouts here.');
 }catch(err){say('Cannot open back office: '+err.message)}
}
$('login').onsubmit=async e=>{e.preventDefault();try{const f=new FormData(e.target);await PA.signIn(String(f.get('email')),String(f.get('password')));await boot()}catch(err){say('Sign in failed: '+err.message)}};
boot();

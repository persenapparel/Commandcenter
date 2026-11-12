'use strict';
const C=window.PersenPOSCore,R=window.PersenPOSReceipt,by=id=>document.getElementById(id);let db,user,register,checkout=null,stock=[],cart=[],templates=[],lastSale=null,season=null;let busy=false,poll;let events=[],sales=[],variantMeta=new Map(),inventoryCatalog=new Map(),eventProfiles=[],eventQuickTiles=[];let reviewLink='';const EV=window.PersenPOSEvents,CASH=window.PersenPOSCash,Experience=window.PersenPOSExperience;const Wizard=window.PersenPOSWizard;const drawerKickGate=window.PersenDrawerOpenGate?.createGate();let drawer={},drawerConfigured=false,drawerVersion=0,tenderBills={},manualTender=false;
const notice=s=>by('notice').textContent=s;
const check=async q=>{const {data,error}=await q;if(error)throw error;return data};
let pendingCash=null,statusRunning=false,checkoutVersion=0,handoffCheckoutId=null;
let lastCashierStage='catalog';
function syncCashierStage(){
 const stage=Wizard.cashierStage(checkout);
 if(lastCashierStage===stage)return;
 lastCashierStage=stage;
 document.body.dataset.cashierStage=stage;
 if(typeof window.scrollTo==='function')window.scrollTo({top:0,behavior:'auto'});
 const headings={
  customer:['Customer is checking out','Their iPad shows each question. You can see their progress here without viewing their answers.'],
  payment:['Collect the payment','The customer finished their details. Enter the amount received or tap the bills they handed you.'],
  external:['Payment instructions only','The customer selected an external payment method. This POS cannot verify or record that payment as paid.'],
  handoff:['Give change & finish the order','Cash was recorded. Give the customer their change and receipt before finishing.']
 };
 const copy=headings[stage];
 by('cashier-stage-header').hidden=!copy;
 if(copy){
  by('cashier-stage-title').textContent=copy[0];
  by('cashier-stage-description').textContent=copy[1];
 }
 by('checkout-cancel-quick').hidden=stage==='handoff'||stage==='catalog';
}
let selectedEventId=sessionStorage.getItem('pos-event')||'';
const pendingCashKey=()=>`pos-pending-cash:${register.id}`;
function rememberCash(id){
 pendingCash=id;
 if(id)sessionStorage.setItem(pendingCashKey(),id);
 else sessionStorage.removeItem(pendingCashKey());
}
const row=(name,price,action,meta)=>{const div=document.createElement('div');div.className='product';const left=document.createElement('div');left.textContent=name;const sm=document.createElement('small');sm.textContent=meta||'';left.append(sm);const btn=document.createElement('button');btn.textContent=price;btn.onclick=action;div.append(left,btn);return div};
function current(){return C.totals(cart,Number(by('discount').value),C.taxMilli(by('tax').value));}
/* Quick cashier catalog: one tile per product, explicit size/color chooser. */
const TYPE_ICONS={hoodie:'🧥',tee:'👕',crew:'👚',hat:'🧢',other:'🛍️'};
const ORDER_SIZES=['XS','S','M','L','XL','2XL','3XL','4XL','One Size'];let chosenCategory='All';
const catalogEntry=item=>inventoryCatalog.get(String(item.product_name||'').trim().toLowerCase());
const isSalesStock=item=>{
 const cfg=catalogEntry(item);
 return cfg?.inventory_type==='sales'&&cfg.is_active===true;
};
const hasPrice=item=>{
 const price=catalogEntry(item)?.price_cents;
 return Number.isSafeInteger(price)&&price>0&&price<=10000000;
};
const readyToSell=item=>isSalesStock(item)&&hasPrice(item)&&item.quantity>0;
function addVariant(x){
 if(checkout)return notice('Finish or cancel the current checkout first');
 const meta=variantMeta.get(x.id),line=cart.find(c=>c.stock_id===x.id);
 if(!isSalesStock(x)||!hasPrice(x))return notice('This item needs an active Sales Product and a selling price.');
 if(x.quantity-(line?.qty||0)<=0)return notice('No more stock available for '+(x.size||x.sku));
 if(line)line.qty++;else cart.push({stock_id:x.id,name:x.product_name||x.sku,color:x.color,size:x.size,qty:1,unit_cents:meta.price_cents,service:'Apparel',taxable:meta.taxable!==false});
 notice((x.product_name||'Product')+' · '+(x.size||'One Size')+' added to cart.');draw();
}
function pickVariant(title,options){
 const dialog=by('variant-dialog');by('variant-title').textContent=title;
 const host=by('variant-options');host.replaceChildren();
 const rank=x=>{const v=ORDER_SIZES.indexOf(x.size);return v<0?99:v};
 for(const x of options.slice().sort((a,b)=>String(a.color||'').localeCompare(String(b.color||''))||rank(a)-rank(b))){
  const m=variantMeta.get(x.id),priced=hasPrice(x),item=cart.find(c=>c.stock_id===x.id),remaining=x.quantity-(item?.qty||0);
  const button=document.createElement('button');button.type='button';
  const label=document.createElement('strong');label.textContent=(x.size||'One Size')+' · '+(x.color||'Default');
  const price=document.createElement('span');price.className='variant-price';price.textContent=priced?C.money(m.price_cents):'Set price on laptop';
  const count=document.createElement('small');count.textContent=remaining>0?remaining+' available':'Out of stock';
  button.disabled=remaining<=0||!priced;
  button.append(label,price,count);button.onclick=()=>{addVariant(x);if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open')};host.append(button);
 }
 if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
}
function renderQuickCatalog(){
 const host=by('catalog'),filters=by('category-filters');host.replaceChildren();filters.replaceChildren();
 const q=by('search').value.trim().toLowerCase();
 const groups=new Map();for(const x of stock){
  if(!isSalesStock(x))continue;
  const m=variantMeta.get(x.id),category=m?.category||'Apparel';
  const key=(x.product_name||x.sku).trim()+'|'+category;
  if(!groups.has(key))groups.set(key,{name:x.product_name||x.sku,category,variants:[],type:m?.product_type||'other'});
  groups.get(key).variants.push(x);
 }
 const all=[...groups.values()].sort((a,b)=>a.name.localeCompare(b.name));
 const categories=['All',...new Set(all.map(x=>x.category))];
 if(!categories.includes(chosenCategory))chosenCategory='All';
 for(const category of categories){const button=document.createElement('button');button.type='button';button.textContent=category;button.setAttribute('aria-pressed',String(chosenCategory===category));button.onclick=()=>{chosenCategory=category;renderQuickCatalog()};filters.append(button)}
 const selectedEvent=events.find(e=>e.id===by('event-select').value);
 const profile=eventProfiles.find(p=>p.id===selectedEvent?.inventory_profile_id);
 const pinned=profile?eventQuickTiles.filter(x=>x.event_id===profile.id).sort((a,b)=>a.sort_order-b.sort_order).map(x=>x.product_name.toLowerCase()):[];
 const matching=all.filter(g=>(chosenCategory==='All'||g.category===chosenCategory)&&
   [g.name,g.category,...g.variants.flatMap(v=>[v.color,v.size,v.sku])].join(' ').toLowerCase().includes(q)&&
   (!selectedEvent||pinned.includes(g.name.toLowerCase())))
   .sort((a,b)=>{
     const ar=pinned.indexOf(a.name.toLowerCase()),br=pinned.indexOf(b.name.toLowerCase());
     return (ar<0?999:ar)-(br<0?999:br)||a.name.localeCompare(b.name);
   });
 for(const g of matching){
  const ready=g.variants.filter(readyToSell);
  const total=g.variants.reduce((n,x)=>n+x.quantity,0);
  const price=ready.length?Math.min(...ready.map(x=>variantMeta.get(x.id).price_cents)):null;
  const tile=document.createElement('button');tile.type='button';tile.className='quick-product'+(pinned.includes(g.name.toLowerCase())?' event-featured':'');
  tile.disabled=!ready.length;tile.setAttribute('aria-label','Choose size and color for '+g.name);
  const icon=document.createElement('span');icon.className='quick-symbol';icon.textContent=TYPE_ICONS[g.type]||TYPE_ICONS.other;
  const badge=document.createElement('span');badge.className='quick-count';badge.textContent=total+' in stock';
  const title=document.createElement('span');title.className='quick-name';title.textContent=g.name;
  const detail=document.createElement('span');detail.className='quick-detail';
  detail.textContent=(pinned.includes(g.name.toLowerCase())?'★ EVENT PICK · ':'')+([...new Set(g.variants.map(v=>v.color).filter(Boolean))].join(' / ')||g.category);
  const amount=document.createElement('span');amount.className='quick-price';amount.textContent=price===null?'Set price':('$'+(price/100).toFixed(2)+(g.variants.length>1?' +':''));
  tile.append(icon,badge,title,detail,amount);
  tile.onclick=()=>pickVariant(g.name,g.variants);
  host.append(tile);
 }
 if(!matching.length){const empty=document.createElement('div');empty.className='quick-empty';empty.textContent=stock.length?'No matching sales products. Search for more or change the event.':'No sales products yet. Add them under Sales Products first.';host.append(empty)}
 if(pinned.length&&!q&&chosenCategory==='All'){const hint=document.createElement('p');hint.className='quick-event-hint';hint.textContent='Showing '+pinned.length+' event products. Use Add products to change your selection.';host.append(hint)}
 const readyCount=stock.filter(readyToSell).length;
 by('launch-product-count').textContent=readyCount+' ready-to-sell size'+(readyCount===1?'':'s')+' available';
 by('open-register').disabled=readyCount===0;
}
function setRegisterOpen(open){
 if(!open&&checkout)return notice('Finish or cancel the open checkout before closing the register.');
 if(open&&!stock.some(readyToSell))return notice('First add at least one priced Sales Product.');
 document.body.classList.toggle('pos-register-closed',!open);
 sessionStorage.setItem('pos-register-open',open?'1':'0');
 if(open)notice('Register open. Tap a product, pick the size/color and send checkout to the customer iPad.');
}
by('open-register').onclick=()=>setRegisterOpen(true);
by('close-register').onclick=()=>setRegisterOpen(false);
by('refresh-products').onclick=async()=>{if(checkout)return notice('Finish or cancel the current checkout first');try{await loadStock();notice('Sale products and event tiles refreshed.')}catch(e){notice('Could not refresh products: '+e.message)}};
by('event-select').addEventListener('change',()=>{if(checkout||cart.length){by('event-select').value=selectedEventId;return notice('Finish or clear the cart before switching events.')}selectedEventId=by('event-select').value;sessionStorage.setItem('pos-event',selectedEventId);renderQuickCatalog()});
by('pair-quick').onclick=()=>by('pair').click();
by('pair-setup').onclick=()=>by('pair').click();
window.addEventListener('focus',()=>{if(user&&!checkout&&!cart.length)loadStock().catch(()=>{});});

by('close-variant').onclick=()=>{const dlg=by('variant-dialog');if(typeof dlg.close==='function')dlg.close();else dlg.removeAttribute('open')};
by('variant-dialog').addEventListener('click',e=>{if(e.target===by('variant-dialog')){const dlg=by('variant-dialog');if(typeof dlg.close==='function')dlg.close();else dlg.removeAttribute('open')}});
function draw(){
 renderQuickCatalog();
 by('cart').replaceChildren();
 for(const [i,x] of cart.entries()){
 const r=document.createElement('div');r.className='cart-row';const title=document.createElement('div');title.textContent=x.name+' '+[x.color,x.size].filter(Boolean).join(' / ');
 const available=x.stock_id?stock.find(item=>item.id===x.stock_id)?.quantity:999;
 const maxQty=Math.min(999,available??0);
 const qty=document.createElement('input');qty.type='number';qty.min=1;qty.max=maxQty;qty.value=x.qty;qty.style.width='65px';qty.setAttribute('aria-label','Quantity for '+x.name);qty.disabled=!!checkout||maxQty<1;
 qty.onchange=()=>{const value=qty.valueAsNumber;if(!Number.isInteger(value)||value<1||value>maxQty){qty.value=x.qty;notice('Enter a whole quantity from 1 to '+maxQty+'.');return;}x.qty=value;draw()};
 const price=document.createElement('input');price.type='number';price.min=0;price.max=100000;price.step='.01';price.value=(x.unit_cents/100).toFixed(2);price.style.width='100px';price.setAttribute('aria-label','Unit price for '+x.name);price.disabled=!!checkout;price.readOnly=!!x.stock_id;price.onchange=()=>{try{x.unit_cents=C.cents(price.value);draw()}catch(e){price.value=(x.unit_cents/100).toFixed(2);notice(e.message)}};
 const service=document.createElement('select');service.className='service-picker';service.setAttribute('aria-label','Service category for '+x.name);service.disabled=!!checkout;for(const v of EV.services){const option=document.createElement('option');option.value=v;option.textContent=v;service.append(option);}service.value=x.service||'Other';service.onchange=()=>{x.service=service.value;};
 const remove=document.createElement('button');remove.textContent='×';remove.disabled=!!checkout;remove.onclick=()=>{cart.splice(i,1);draw()};r.append(title,qty,price,service,remove);by('cart').append(r);
 }
 try{by('total').textContent=C.money(current().total_cents)}catch(e){notice(e.message)}
 syncCheckoutUI();renderCash();
}
// Lightweight status refresh: never rebuild the cart while the cashier types.
function syncCheckoutUI(){
 by('start').disabled=!!checkout||!!pendingCash||!cart.length;
 by('cancel').disabled=!checkout||checkout.status==='completed';
 by('discount').disabled=!!checkout;
 by('tax').disabled=!!checkout;
 by('event-select').disabled=!!checkout||!!cart.length;
}
async function loadStock(){
 // Inventory and quick tiles must come from the POS database. Staging remains isolated.
 const [items,catalog,details]=await Promise.all([
  check(db.from('stock_items').select('id,sku,product_name,color,size,quantity,reorder_at').order('sku').limit(1000)),
  check(db.from('inventory_catalog').select('name,inventory_type,price_cents,is_active').limit(1000)),
  check(db.from('pos_variant_details').select('stock_id,price_cents,taxable,category,description,product_type').limit(1000))
 ]);
 stock=items;
 inventoryCatalog=new Map(catalog.map(x=>[x.name.trim().toLowerCase(),x]));
 variantMeta=new Map(details.map(x=>[x.stock_id,x]));
 for(const item of stock){
  const cfg=catalogEntry(item);
  if(cfg?.inventory_type==='sales'&&cfg.is_active!==false&&Number.isSafeInteger(cfg.price_cents)&&cfg.price_cents>0)
    variantMeta.set(item.id,{...variantMeta.get(item.id),price_cents:cfg.price_cents,taxable:variantMeta.get(item.id)?.taxable!==false,category:variantMeta.get(item.id)?.category||'Apparel',product_type:variantMeta.get(item.id)?.product_type||'other'});
 }
 try{
  [eventProfiles,eventQuickTiles]=await Promise.all([
   check(db.from('inventory_event_profiles').select('id,name,event_date,active').limit(150)),
   check(db.from('inventory_event_quick_products').select('event_id,product_name,sort_order').limit(1200))
  ]);
 }catch(e){eventProfiles=[];eventQuickTiles=[];notice('Inventory event presets unavailable: '+e.message)}
 draw();renderProductList();
}
async function loadTemplates(){templates=await check(db.from('pos_receipt_templates').select('*').eq('owner_id',user.id).order('updated_at',{ascending:false}));by('templates').replaceChildren();for(const t of templates){const opt=document.createElement('option');opt.value=t.id;opt.textContent=t.name;by('templates').append(opt)}const t=templates.find(x=>x.active)||templates[0];if(t){by('templates').value=t.id;showTemplate(t)}}
function showTemplate(t){by('template-name').value=t.name;by('headline').value=t.headline;by('promotion').value=t.promotion;by('footer').value=t.footer;by('review-message').value=t.review_message||R.DEFAULTS.review;by('receipt-seasonal').checked=t.show_seasonal!==false;by('receipt-review').checked=t.show_review!==false}
async function ensureRegister(){const regs=await check(db.from('pos_registers').select('*').eq('owner_id',user.id).eq('active',true).order('created_at').limit(1));register=regs[0]||await check(db.from('pos_registers').insert({owner_id:user.id,label:'Persen POS register'}).select('*').single());pendingCash=sessionStorage.getItem(pendingCashKey());syncCheckoutUI();}
const saleForCheckout=id=>check(db.from('pos_sales').select('id,snapshot,subtotal_cents,discount_cents,tax_cents,total_cents,tendered_cents,change_cents,change_breakdown,created_at').eq('checkout_id',id).maybeSingle());
function showPaidAwaitingHandoff(saved,record){
 const id=record.id;
 lastSale={id:saved.id,cart:saved.snapshot.items,totals:saved,time:new Date(saved.created_at)};
 if(!cart.length&&Array.isArray(saved.snapshot.items)){
  cart=saved.snapshot.items.map(item=>({...item}));
 }
 checkout={...record,status:'completed',cash_handoff_complete:false};
 handoffCheckoutId=id;rememberCash(null);
 document.body.classList.add('checkout-active');
 document.body.classList.remove('pos-register-closed');
 by('cash-handoff').hidden=false;by('finish-order').disabled=false;
 by('cash-handoff-change').textContent=C.money(saved.change_cents);
 draw();
 syncCashierStage();
 notice('Cash payment saved. Hand back '+C.money(saved.change_cents)+' in change, then tap Finish Order.');
}
async function showCompletedSale(saved){
 lastSale={id:saved.id,cart:saved.snapshot.items,totals:saved,time:new Date(saved.created_at)};
 handoffCheckoutId=null;checkout=null;cart=[];rememberCash(null);
 by('cash-handoff').hidden=true;by('finish-order').disabled=true;
 document.body.classList.remove('checkout-active');
 syncCashierStage();
 resetTender();receipt();draw();
 const result=await Promise.allSettled([loadStock(),loadSales(),reloadDrawer()]);
 if(result.some(x=>x.status==='rejected'))return notice('Order finished. Refresh inventory and cash drawer counts before next sale.');
 notice('Order finished. Ready for the next customer.');
}
async function finishOrder(){
 if(busy||!checkout||checkout.status!=='completed'||checkout.cash_handoff_complete===true)return;
 busy=true;checkoutVersion++;by('finish-order').disabled=true;
 try{
  const id=checkout.id;
  const result=await check(db.rpc('pos_finish_order',{p_checkout:id}));
  if(result!==true)throw Error('Could not confirm customer handoff');
  const saved=await saleForCheckout(id);
  if(!saved)throw Error('Order was finished but receipt details are unavailable. Refresh to recover.');
  await showCompletedSale(saved);
 }catch(e){
  by('finish-order').disabled=false;
  notice('Could not finish order: '+e.message+'. Do not start another checkout until this is resolved.');
 }finally{busy=false;await status()}
}
async function status(){
 if(!register||busy||statusRunning)return;
 statusRunning=true;const version=checkoutVersion;
 try{
  const list=await check(db.from('pos_checkouts').select('id,status,cash_handoff_complete,created_at,total_cents,payment_preference,receipt_print,receipt_email,customer_step,help_requested,progress_updated_at').eq('register_id',register.id).order('created_at',{ascending:false}).limit(1));
  if(version!==checkoutVersion)return;
  let c=list[0];const awaitingHandoff=c?.status==='completed'&&c.cash_handoff_complete===false;
  if(awaitingHandoff){
   const saved=await saleForCheckout(c.id);
   if(version!==checkoutVersion)return;
   if(!saved){notice('Payment recorded but sale details are not available. Refresh before continuing.');return}
   if(handoffCheckoutId!==c.id||by('cash-handoff').hidden)showPaidAwaitingHandoff(saved,c);
   else checkout=c;
  }else{
   const recoveryId=pendingCash||(checkout&&(c?.id!==checkout.id||c.status==='completed')?checkout.id:null);
   if(recoveryId){
    const saved=await saleForCheckout(recoveryId);
    if(version!==checkoutVersion)return;
    if(saved){await showCompletedSale(saved);if(c?.id===recoveryId)c={...c,status:'completed'};}
    else if(pendingCash&&(c?.id!==recoveryId||['contact_received','cancelled','awaiting_customer'].includes(c.status))){
     rememberCash(null);notice('Cash was not recorded. Check the tender amount and try again.');
    }
    if(version!==checkoutVersion)return;
   }
   checkout=c&&['awaiting_customer','contact_received'].includes(c.status)?c:null;
   document.body.classList.toggle('checkout-active',!!checkout);
   if(checkout)document.body.classList.remove('pos-register-closed');
  }
  const progressing=!!checkout;
  const progress=Wizard.monitor(checkout?.customer_step||'phone',checkout?.help_requested===true);
  const stage=checkout?.status==='contact_received'?{...progress,step_number:8,percentage:100,step_label:'Questions finished · ready for cashier'}:progress;
  by('cashier-progress-count').textContent=progressing?'Step '+stage.step_number+' of 8':'Waiting for checkout';
  by('cashier-current-step').textContent=progressing?(awaitingHandoff?'Cash recorded · hand over change and finish order':stage.step_label):'Start a sale to see which step the customer is on.';
  by('cashier-progress-fill').style.width=progressing?stage.percentage+'%':'0%';
  by('cashier-progress-bar').setAttribute('aria-valuenow',String(progressing?stage.step_number:0));
  const needHelp=progressing&&checkout?.status==='awaiting_customer'&&checkout.help_requested===true;
  by('customer-help-alert').hidden=!needHelp;
  const method=checkout?.payment_preference||'cash';
  by('payment-preference-badge').textContent=method==='venmo_info'?'Venmo instructions':method==='apple_cash_info'?'Apple Cash instructions':'Cash checkout';
  by('external-payment-notice').hidden=!checkout||method==='cash';
  if(checkout&&method!=='cash')document.querySelector('.cashier-payment-help').open=true;
  const receiptChannels=checkout?[checkout.receipt_print?'Print':null,checkout.receipt_email?'Email (delivery pending)':null].filter(Boolean):[];
  by('receipt-request-status').textContent=receiptChannels.length?'Requested receipt: '+receiptChannels.join(' · '):'No receipt selected yet.';
  by('status').textContent=awaitingHandoff?'Cash recorded · give change, then tap Finish Order':c?({awaiting_customer:'Customer completing checkout screens',contact_received:'Customer choices saved · ready for cashier',completed:'Order finished · ready for next customer',cancelled:'Checkout cancelled'}[c.status]||c.status):'Ready for next customer';
  syncCashierStage();
  syncCheckoutUI();renderCash();
 }catch(e){notice('Connection lost: '+e.message)}finally{statusRunning=false}
}
async function begin(){if(busy||checkout||pendingCash)return;busy=true;checkoutVersion++;try{const payload=cart.map(x=>({stock_id:x.stock_id||null,name:x.name,qty:x.qty,unit_cents:x.unit_cents,service:EV.serviceName(x.service),taxable:x.taxable}));const bps=C.discountBps(by('discount').value),tax=C.taxMilli(by('tax').value);const id=await check(db.rpc('pos_begin_checkout',{p_register:register.id,p_items:payload,p_discount_bps:bps,p_tax_milli:tax,p_event:by('event-select').value||null}));checkout={id,status:'awaiting_customer'};syncCashierStage();notice('Checkout sent to customer display.');}catch(e){notice(e.message)}finally{busy=false;draw();await status()}}
async function cancel(){if(!checkout||busy)return;busy=true;checkoutVersion++;try{await check(db.rpc('pos_cancel_checkout',{p_checkout:checkout.id}));checkout=null;rememberCash(null);resetTender();syncCashierStage();draw();notice('Checkout cancelled')}catch(e){notice(e.message)}finally{busy=false;await status()}}
async function cash(){
 if(!checkout||checkout.status!=='contact_received'||busy)return;
 if(checkout.payment_preference&&checkout.payment_preference!=='cash')return notice('This payment method only displays instructions. Do not record it as cash.');
 busy=true;checkoutVersion++;
 try{
  const tendered=cashCents();if(tendered===null)throw Error('Enter the cash you physically received.');
  const plan=CASH.plan(checkout.total_cents,tendered,drawer,drawerConfigured,manualTender?tenderBills:{});
  if(!['ready','exact','exact_unconfigured'].includes(plan.status))throw Error('Cannot confirm: '+plan.status+'. Check your cash drawer.');
  const id=checkout.id;
  rememberCash(id);
  await check(db.rpc('pos_complete_cash',{p_checkout:id,p_tender_cents:tendered,p_received_breakdown:manualTender?tenderBills:{},p_change_breakdown:plan.breakdown||{},p_expected_drawer_version:drawerVersion}));
  const saved=await saleForCheckout(id);
  if(!saved)throw Error('Checking whether this sale was recorded. Keep this checkout open.');
  showPaidAwaitingHandoff(saved,{...checkout,status:'completed',cash_handoff_complete:false});
  // Electronic drawer request is staging-only; no physical adapter is configured.
  // Never request on a cash entry, cancelled sale or after Finish Order/reload.
  void requestCashDrawerAfterSavedSale(saved);
 }catch(e){
  notice('Cash payment could not be confirmed: '+e.message+'. Do not start another order until status is checked.');
 }finally{busy=false;await status()}
}
async function requestCashDrawerAfterSavedSale(saved){
 const status=by('drawer-open-status');
 if(!status)return;
 status.textContent='Checking electronic cash drawer setup…';
 if(!drawerKickGate){
  status.textContent='Electronic drawer unavailable; use the drawer key.';
  return;
 }
 const result=await drawerKickGate.requestCashOpen({
  saleId:saved.id,serverSaved:true,paymentMethod:'cash',
  bridge:window.PersenPOSDrawerBridge
 });
 const messages={
  'not-configured':'Electronic drawer not connected. Use its key; your cash sale is saved.',
  'command-accepted':'Drawer-open command accepted. Physically check the drawer before giving change.',
  'unconfirmed':'Drawer command outcome unknown. Check the drawer before using its key; do not retry automatically.',
  'already-attempted':'Drawer command already attempted for this sale; check the drawer.',
  'blocked':'Drawer command blocked; use the key if necessary.'
 };
 status.textContent=messages[result.status]||'Drawer state could not be verified; check it physically.';
}
function receipt(){if(!lastSale)return;by('receipt').hidden=false;by('receipt-id').textContent='CASH SALE '+lastSale.id.slice(0,8).toUpperCase()+' · '+lastSale.time.toLocaleString();by('receipt-items').replaceChildren();for(const x of lastSale.cart){const line=document.createElement('div');line.className='receipt-line';const a=document.createElement('span');a.textContent=x.qty+' × '+x.name+' '+x.size;const b=document.createElement('span');b.textContent=C.money(x.qty*x.unit_cents);line.append(a,b);by('receipt-items').append(line)}by('receipt-subtotal').textContent=C.money(lastSale.totals.subtotal_cents);by('receipt-discount').textContent='−'+C.money(lastSale.totals.discount_cents);by('receipt-tax').textContent=C.money(lastSale.totals.tax_cents);by('receipt-total').textContent=C.money(lastSale.totals.total_cents);by('receipt-cash-tendered').textContent=C.money(lastSale.totals.tendered_cents);by('receipt-cash-change').textContent=C.money(lastSale.totals.change_cents);const cfg=R.presentation({headline:by('headline').value,promotion:by('promotion').value,footer:by('footer').value,review:by('review-message').value,reviewLink:reviewLink,showReview:by('receipt-review').checked,showSeason:by('receipt-seasonal').checked,season});by('receipt-headline').textContent=cfg.headline;by('receipt-season-heading').textContent=cfg.season_style.icon+'  '+cfg.season_style.label+'  '+cfg.season_style.icon;by('receipt-season-heading').hidden=!cfg.season_style.label;by('receipt-season-message').textContent=cfg.seasonal;by('receipt-season-message').hidden=!cfg.seasonal;by('receipt-promo').textContent=cfg.promotion;by('receipt-footer').textContent=cfg.footer;by('receipt-review-message').textContent=cfg.review_url?cfg.review:'';by('receipt-review-message').hidden=!cfg.review_url;const a=by('receipt-review-url');a.hidden=!cfg.review_url;if(cfg.review_url){a.href=cfg.review_url;a.textContent=cfg.review_url.split('://').slice(1).join('://')}else{a.removeAttribute('href');a.textContent=''};}
async function saveTemplate(){try{const id=by('templates').value;const payload={owner_id:user.id,name:by('template-name').value.trim(),headline:by('headline').value,promotion:by('promotion').value,footer:by('footer').value,review_message:by('review-message').value,show_seasonal:by('receipt-seasonal').checked,show_review:by('receipt-review').checked,active:false,updated_at:new Date().toISOString()};if(!payload.name)throw Error('Template name required');if(id)await check(db.from('pos_receipt_templates').update(payload).eq('id',id));else await check(db.from('pos_receipt_templates').insert(payload));await loadTemplates();notice('Receipt template saved. Historical sale amounts are unchanged.')}catch(e){notice(e.message)}}
async function boot(){try{if(!window.PA?.ready)throw Error('Supabase connection unavailable');db=PA.db;user=await PA.me();if(!user){notice('Sign in with your Command Center account');return}if(!await PA.isAdmin(user))throw Error('This account is not authorized for Persen POS');by('auth').hidden=true;by('workspace').hidden=false;await ensureRegister();await Promise.all([loadStock(),loadTemplates(),loadEvents(),loadSales(),reloadDrawer()]);if(sessionStorage.getItem('pos-register-open')==='1'&&stock.some(x=>x.quantity>0&&variantMeta.has(x.id)))setRegisterOpen(true);try{const contents=await check(db.from('site_content').select('key,value').in('key',['seasonal_campaigns_v1','v54_google_reviews']));const dict=Object.fromEntries((contents||[]).map(x=>[x.key,x.value]));season=C.season(dict.seasonal_campaigns_v1);reviewLink=R.reviewUrl(dict.v54_google_reviews);if(season){Experience.apply(document,season);by('seasonal-status').textContent='Active: '+season.title+' — receipt and display promotions';notice('Seasonal Studio connected: '+season.title)}else{by('seasonal-status').textContent='No published active campaign — classic receipt and customer display'}if(!reviewLink)notice('Google review link not configured in Command Center Site Studio; review invitation hidden until configured.')}catch(err){by('seasonal-status').textContent='Seasonal Studio temporarily unavailable';}by('pairing').textContent='Use Create temporary iPad link to pair the customer display. A new link expires after 2 hours and replaces the previous link.';await status();poll=setInterval(status,1800);db.channel('pos-owner-'+register.id).on('postgres_changes',{event:'*',schema:'public',table:'pos_checkouts',filter:'register_id=eq.'+register.id},status).subscribe();}catch(e){notice(e.message)}}

/* Event manager: owner/admin-only RLS queries and historical immutable sale snapshots. */
const eventOption=(id,label)=>{const o=document.createElement('option');o.value=id;o.textContent=label;return o};
function fillEventSelectors(){
 const sale=by('event-select'),report=by('report-event');
 const prev=sale.value,prevReport=report.value;
 sale.replaceChildren(eventOption('','Walk-in / no event'));
 report.replaceChildren(eventOption('','Walk-in / no event'));
 for(const e of events){
  const label=e.name+' · '+e.event_date+(e.status==='closed'?' (closed)':'');
  report.append(eventOption(e.id,label));
  if(e.status==='open')sale.append(eventOption(e.id,label));
 }
 if([...sale.options].some(x=>x.value===prev))sale.value=prev;
 if([...report.options].some(x=>x.value===prevReport))report.value=prevReport;
 drawReport();fillEventEditor();
}
async function loadEvents(){
 events=await check(db.from('pos_events').select('id,name,event_date,venue,status,created_at,inventory_profile_id').order('event_date',{ascending:false}).limit(300));
 fillEventSelectors();
 if(events.some(e=>e.id===selectedEventId&&e.status==='open'))by('event-select').value=selectedEventId;
 else selectedEventId=by('event-select').value;
 renderQuickCatalog();
}
async function loadSales(){
 sales=await check(db.from('pos_sales').select('id,event_id,snapshot,subtotal_cents,discount_cents,tax_cents,total_cents,created_at').order('created_at',{ascending:false}).limit(2000));
 drawReport();
}
function drawReport(){
 const host=by('report-stats'),list=by('service-summary');
 if(!host||!list)return;
 const eventId=by('report-event').value;
 const filtered=sales.filter(x=>String(x.event_id||'')===eventId);
 const summary=EV.report(filtered,eventId);
 host.replaceChildren();list.replaceChildren();
 const fmt=n=>window.PersenPOSCore.money(n);
 const stat=(title,value)=>{const d=document.createElement('div');d.className='event-stat';const val=document.createElement('strong');val.textContent=String(value);const label=document.createElement('small');label.textContent=title;d.append(val,label);host.append(d)};
 stat('Completed sales',summary.transactions);
 stat('Items sold',summary.units);
 stat('Collected',fmt(summary.collected_cents));
 stat('Gross merchandise',fmt(summary.gross_cents));
 stat('Discounts',fmt(summary.discount_cents));
 stat('Sales tax',fmt(summary.tax_cents));
 stat('Average rating',summary.rating_average===null?'—':summary.rating_average.toFixed(1)+'/5');
 stat('Promo opt-ins',summary.promo_opt_ins);
 stat('Custom apparel leads',summary.custom_leads);
 const table=document.createElement('table');table.className='service-table';
 const head=document.createElement('thead');const tr=document.createElement('tr');
 for(const k of ['Service category','Units','Gross sales']){const th=document.createElement('th');th.textContent=k;tr.append(th)}head.append(tr);table.append(head);
 const body=document.createElement('tbody');
 for(const k of EV.services){const v=summary.services[k],tr=document.createElement('tr');for(const value of [k,String(v.units),fmt(v.gross_cents)]){const td=document.createElement('td');td.textContent=value;tr.append(td)}body.append(tr)}
 table.append(body);list.append(table);
 const note=document.createElement('p');note.className='hint';note.textContent=filtered.length===2000?'Showing recent sales only. Export/report pagination needed for larger history.':'Sale records remain linked to their original events.';list.append(note);
}
async function createEvent(e){
 e.preventDefault();
 const btn=e.currentTarget.querySelector('[type=submit]');btn.disabled=true;
 try{
  if(!user)throw Error('Sign in first');
  const f=new FormData(e.currentTarget),name=String(f.get('name')||'').trim(),date=String(f.get('event_date')||''),venue=String(f.get('venue')||'').trim();
  if(!name||name.length>100||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Enter an event name and valid date');
  const result=await check(db.from('pos_events').insert({owner_id:user.id,name,event_date:date,venue,status:'open'}).select('id').single());
  await loadEvents();
  by('event-select').value=result.id;by('report-event').value=result.id;drawReport();e.currentTarget.reset();notice('Event created. New checkouts will count toward '+name+'.');
 }catch(err){notice('Unable to create event: '+err.message)}finally{btn.disabled=false}
}

// Admin product setup: each color/size has its own SKU, stock and explicit price.
// This form is only usable after pos_variant_details passes the staged migration review.
function renderProductList(){
 const host=by('product-variants');if(!host)return;host.replaceChildren();
 const listed=[...stock].sort((a,b)=>Number(variantMeta.has(a.id))-Number(variantMeta.has(b.id))).slice(0,150);
 for(const x of listed){
  const m=variantMeta.get(x.id);
  const div=document.createElement('div');div.className='product-variant-row';
  const info=document.createElement('div');info.className='variant-info';
  const title=document.createElement('strong');title.textContent=x.product_name||x.sku;
  const details=document.createElement('small');details.textContent=[x.color,x.size,x.sku,x.quantity+' in stock'].filter(Boolean).join(' · ');
  info.append(title,details);
  const form=document.createElement('div');form.className='variant-quick-price';
  const price=document.createElement('input');price.type='number';price.step='0.01';price.min='0';price.max='100000';price.inputMode='decimal';
  price.placeholder='Price $';price.value=m?String((m.price_cents/100).toFixed(2)):'';
  price.setAttribute('aria-label','Selling price for '+(x.product_name||x.sku));
  const taxable=document.createElement('label');taxable.className='variant-tax-check';
  const flag=document.createElement('input');flag.type='checkbox';flag.checked=m?.taxable??true;
  taxable.append(flag,document.createTextNode('Taxable'));
  const save=document.createElement('button');save.type='button';save.textContent=m?'Update price':'Set price';
  save.onclick=async()=>{
   if(checkout)return notice('Finish the current checkout before changing prices.');
   save.disabled=true;
   try{
    if(!price.value.trim())throw Error('Enter a selling price.');
    const cents=C.cents(price.value);
    const metadata={stock_id:x.id,price_cents:cents,taxable:flag.checked,
      category:m?.category||'Apparel',product_type:m?.product_type||'other',description:m?.description||''};
    await check(db.from('pos_variant_details').upsert(metadata,{onConflict:'stock_id'}));
    variantMeta.set(x.id,metadata);
    draw();renderProductList();
    notice('Saved selling price for '+(x.sku||x.product_name)+'.');
   }catch(e){notice('Could not save price: '+e.message)}
   finally{save.disabled=false}
  };
  form.append(price,taxable,save);div.append(info,form);host.append(div);
 }
 if(stock.length>150){
   const more=document.createElement('p');more.className='hint';more.textContent='Showing 150 product variants, with unpriced items first. Use inventory search for the remaining items.';host.append(more);
 }
}
async function createVariant(e){
 e.preventDefault();const btn=e.currentTarget.querySelector('button[type=submit]');btn.disabled=true;
 let createdId=null;
 try{
  if(checkout)throw Error('Finish the current checkout first');
  const f=new FormData(e.currentTarget);
  const name=String(f.get('name')||'').trim(),sku=String(f.get('sku')||'').trim();
  const color=String(f.get('color')||'').trim(),size=String(f.get('size')||'').trim();
  const quantity=Number(f.get('quantity')),reorder=Number(f.get('reorder'));
  const price=C.cents(f.get('price'));
  if(!name||name.length>120||sku.length<2||sku.length>100)throw Error('Product name and unique SKU required');
  if(!Number.isInteger(quantity)||quantity<0||quantity>1000000||!Number.isInteger(reorder)||reorder<0)throw Error('Enter valid stock and reorder quantities');
  const details={category:String(f.get('category')||'Apparel').slice(0,90),product_type:String(f.get('type')||'other'),description:String(f.get('description')||'').slice(0,500),price_cents:price,taxable:f.has('taxable')};
  const row=await check(db.from('stock_items').insert({sku,product_name:name,color,size,quantity,reorder_at:reorder,supplier:String(f.get('supplier')||'').slice(0,120)}).select('id').single());
  createdId=row.id;
  try{await check(db.from('pos_variant_details').insert({stock_id:createdId,...details}));}
  catch(err){
   // Best-effort rollback, never silently leave an unpriced product.
   try{await check(db.from('stock_items').delete().eq('id',createdId));createdId=null}catch{}
   throw Error('Product pricing save failed: '+err.message+(createdId?' — check inventory for an unpriced SKU':''));
  }
  e.currentTarget.reset();await loadStock();notice('Product variant saved: '+name+' / '+sku+'. Add other colors and sizes as separate SKUs.');
 }catch(err){notice('Unable to add product: '+err.message)}finally{btn.disabled=false}
}
async function updateEvent(e){
 e.preventDefault();const form=e.currentTarget,btn=form.querySelector('button[type=submit]');btn.disabled=true;
 try{
  const id=by('report-event').value;if(!id)throw Error('Select an event to edit');
  const f=new FormData(form),name=String(f.get('name')||'').trim(),event_date=String(f.get('event_date')||''),venue=String(f.get('venue')||'').trim(),status=String(f.get('status'));
  if(!name||name.length>100||!/^\d{4}-\d{2}-\d{2}$/.test(event_date)||!['open','closed'].includes(status))throw Error('Check event details');
  await check(db.from('pos_events').update({name,event_date,venue,status}).eq('id',id).eq('owner_id',user.id));
  await loadEvents();by('report-event').value=id;drawReport();notice('Event updated. Past sales remain attached.');
 }catch(err){notice('Unable to update event: '+err.message)}finally{btn.disabled=false}
}
function fillEventEditor(){
 const id=by('report-event').value,e=events.find(x=>x.id===id),form=by('edit-event');
 form.hidden=!e;if(!e)return;
 form.elements.name.value=e.name;form.elements.event_date.value=e.event_date;
 form.elements.venue.value=e.venue||'';form.elements.status.value=e.status;
}

by('new-event').addEventListener('submit',createEvent);
by('new-product').addEventListener('submit',createVariant);
by('edit-event').addEventListener('submit',updateEvent);
by('report-event').addEventListener('change',()=>{drawReport();fillEventEditor()});


/* Fast cash terminal — local preview; server validates actual change at settlement. */
function cashCents(){
 const value=by('cash-received').value.trim();
 if(value==='')return null;
 try{return C.cents(value)}catch{return null}
}
function resetTender(){
 tenderBills={};manualTender=false;by('cash-received').value='';renderCash();
}
function fillDrawerInputs(){
 const inputs=by('drawer-grid');inputs.replaceChildren();
 for(const d of CASH.DENOMS){
  const cell=document.createElement('div');cell.className='drawer-denom';
  const label=document.createElement('label');label.textContent=d.label+' in drawer';
  const input=document.createElement('input');input.type='number';input.min=0;input.max=999;input.step=1;input.inputMode='numeric';input.value=String(drawer[d.value]||0);
  input.dataset.denom=d.value;input.setAttribute('aria-label',d.label+' count');
  input.addEventListener('input',showDrawerPreview);cell.append(label,input);inputs.append(cell);
 }
 showDrawerPreview();
 by('drawer-status').textContent=drawerConfigured?'Saved float is verified against bills and coins.':'Set your starting cash drawer counts before taking a payment that needs change.';
}
function drawerInputs(){
 const values={};
 for(const input of by('drawer-grid').querySelectorAll('input[data-denom]'))values[input.dataset.denom]=Number(input.value);
 return CASH.cleanCounts(values);
}
function showDrawerPreview(){
 try{by('drawer-value').textContent=C.money(CASH.drawerValue(drawerInputs()))}
 catch{by('drawer-value').textContent='Check counts'}
}
async function reloadDrawer(){
 const r=await check(db.from('pos_registers').select('id,cash_drawer,drawer_configured,drawer_version').eq('id',register.id).single());
 drawer=CASH.cleanCounts(r.cash_drawer||{});drawerConfigured=r.drawer_configured===true;drawerVersion=r.drawer_version||0;
 fillDrawerInputs();renderCash();
}
async function saveDrawer(){
 if(busy)return;
 by('save-drawer').disabled=true;
 try{
  const counts=drawerInputs();
  const result=await check(db.rpc('pos_set_cash_drawer',{p_register:register.id,p_counts:counts,p_expected_version:drawerVersion}));
  drawer=CASH.cleanCounts(result.cash_drawer);drawerVersion=Number(result.drawer_version);drawerConfigured=true;
  by('drawer-status').textContent='Saved cash float. Change availability now reflects these counted bills and coins.';
  by('drawer-config').open=false;
  notice('Cash drawer saved. Change checks are ready.');
  renderCash();
 }catch(e){
  by('drawer-status').textContent='Could not save: '+e.message+'. Recount and reload if someone else used this register.';
 }finally{by('save-drawer').disabled=false}
}
function renderCash(){
 const due=checkout?.total_cents??current().total_cents;
 by('cash-due').textContent=C.money(due);
 const paid=cashCents(),indicator=by('change-indicator'),change=by('change-amount'),
       message=by('change-message'),breakdown=by('change-breakdown');
 const inputAllowed=!!checkout&&!busy&&['awaiting_customer','contact_received'].includes(checkout.status)&&(!checkout.payment_preference||checkout.payment_preference==='cash');
 const allowed=inputAllowed&&checkout.status==='contact_received';
 for(const b of by('cash-bills').querySelectorAll('button'))b.disabled=!inputAllowed;
 by('cash-exact').disabled=!inputAllowed;by('cash-clear').disabled=!inputAllowed;
 by('cash-received').disabled=!inputAllowed;
 indicator.className='change-indicator';breakdown.textContent='';
 by('cash').disabled=true;
 if(paid===null){change.textContent='$0.00';indicator.textContent='Enter cash';message.textContent=inputAllowed?'Tap bills now; checkout confirms when the customer finishes on the iPad.':'Start a checkout to enter the cash received.';return}
 try{
  const result=CASH.plan(due,paid,drawer,drawerConfigured,manualTender?tenderBills:{});
  change.textContent=C.money(result.change_cents);
  if(result.status==='short'){
   indicator.textContent='More cash needed';indicator.classList.add('blocked');
   message.textContent=C.money(result.short_cents)+' still due.';
  }else if(result.status==='unconfigured'){
   indicator.textContent='Count drawer';indicator.classList.add('warning');
   message.textContent='Cash received is enough, but your drawer float is not set. Enter the bills and coins you have to verify change.';
  }else if(result.status==='insufficient'){
   indicator.textContent='Not enough change';indicator.classList.add('blocked');
   message.textContent='Your counted drawer cannot make this exact change. Ask for a different bill, take an exact amount or replenish the drawer.';
  }else{
   indicator.textContent=result.change_cents===0?'Exact payment':'Change available';indicator.classList.add('ready');
   message.textContent=!allowed?'Cash counted. Waiting for customer confirmation on the iPad.':result.change_cents===0?'No change to return.':'Count and hand back this change before confirming payment.';
   if(allowed)by('cash').disabled=false;
   const steps=Object.entries(result.breakdown||{}).filter(([_,n])=>n>0)
      .map(([v,n])=>n+' × '+(CASH.DENOMS.find(d=>d.value===Number(v))?.label||v));
   breakdown.textContent=steps.length?'Suggested change: '+steps.join('  ·  '):'No coins or bills to return';
  }
  by('cash').textContent=result.status==='ready'||result.status==='exact'||result.status==='exact_unconfigured'?
    'Confirm '+C.money(paid)+' cash · Save & print':'Confirm cash · Record sale';
 }catch(e){
  change.textContent='$0.00';indicator.textContent='Check amount';indicator.classList.add('blocked');message.textContent=e.message;
 }
}
function createBillButtons(){
 const host=by('cash-bills');
 for(const d of CASH.DENOMS.filter(x=>x.kind==='bill').slice().reverse()){
  const b=document.createElement('button');b.type='button';b.textContent='+'+d.label;
  b.setAttribute('aria-label','Add one '+d.label+' bill received');
  b.addEventListener('click',()=>{
   const paid=cashCents()||0;
   if(!manualTender&&paid!==0){tenderBills={};by('cash-received').value='0.00'}
   const next=(cashCents()||0)+d.value;
   if(next>1000000)return notice('Cash received exceeds supported amount.');
   tenderBills[d.value]=(tenderBills[d.value]||0)+1;
   manualTender=true;by('cash-received').value=(next/100).toFixed(2);
   renderCash();
  });
  host.append(b);
 }
 renderCash();
}
by('cash-received').addEventListener('input',()=>{tenderBills={};manualTender=false;renderCash()});
by('cash-exact').addEventListener('click',()=>{tenderBills={};manualTender=false;const due=checkout?.total_cents??current().total_cents;by('cash-received').value=(due/100).toFixed(2);renderCash()});
by('cash-clear').addEventListener('click',resetTender);
by('save-drawer').addEventListener('click',saveDrawer);

by('login').onsubmit=async e=>{e.preventDefault();try{const f=new FormData(e.target);await PA.signIn(String(f.get('email')),String(f.get('password')));await boot()}catch(err){notice(err.message)}};
by('search').oninput=draw;by('custom').onsubmit=e=>{e.preventDefault();if(checkout)return notice('Close current checkout first');try{const f=new FormData(e.target);cart.push({stock_id:null,name:String(f.get('name')).trim(),size:'',color:'',qty:1,unit_cents:C.cents(f.get('price')),service:'Other',taxable:f.has('taxable')});e.target.reset();draw()}catch(err){notice(err.message)}};
for(const x of ['discount','tax'])by(x).oninput=draw;
document.querySelectorAll('[data-discount]').forEach(b=>b.onclick=()=>{if(checkout)return;by('discount').value=b.dataset.discount;draw()});
by('start').onclick=begin;by('cancel').onclick=cancel;by('checkout-cancel-quick').onclick=cancel;by('cash').onclick=cash;by('finish-order').onclick=finishOrder;
for(const [buttonId,value,label] of [['copy-venmo','@persenapparel','Venmo username'],['copy-apple-cash','6316440633','Apple Cash contact']]){
 by(buttonId).onclick=async()=>{try{
  await navigator.clipboard.writeText(value);
  notice(label+' copied. Verify the customer is sending to an approved account.');
 }catch{notice('Unable to copy. The payment details are shown in the reference panel.');}};
}
/* Pairing links are sensitive. Show a local-only selectable fallback when iOS blocks clipboard.
   Do not submit them to analytics, third-party QR services or persistent storage. */
let activePairingUrl='';
function showPairingUrl(url){
 activePairingUrl=url;
 by('pair-link-field').value=url;
 by('pair-open').href=url;
 by('pair-link-panel').hidden=false;
 by('pair-share').hidden=typeof navigator.share!=='function';
 by('pairing').textContent='A temporary pairing link was generated for 2 hours. The previous pairing, if any, is no longer valid.';
}
function pairingFeedback(message){by('pair-feedback').textContent=message}
async function copyPairingUrl(){
 if(!activePairingUrl)return pairingFeedback('Create a private pairing link first.');
 try{
  if(typeof navigator.clipboard?.writeText!=='function')throw Error('Clipboard API unavailable');
  await navigator.clipboard.writeText(activePairingUrl);
  pairingFeedback('Private link copied. Open it on your customer iPad.');
 }catch{
  const input=by('pair-link-field');
  input.focus();input.select();
  pairingFeedback('Safari blocked automatic copying. The link is selected: use Copy from the selection menu, or tap Share with customer iPad.');
 }
}
by('pair-copy').onclick=copyPairingUrl;
by('pair-share').onclick=async()=>{
 if(!activePairingUrl)return pairingFeedback('Create a pairing link first.');
 if(typeof navigator.share!=='function')return pairingFeedback('Sharing is unavailable here. Select and copy the link instead.');
 try{
  await navigator.share({title:'Persen POS — Private customer iPad',url:activePairingUrl});
  pairingFeedback('Sharing menu completed. Check that the customer iPad received the private link.');
 }catch(e){
  if(e?.name!=='AbortError')pairingFeedback('Sharing did not complete. Select and copy the private link instead.');
 }
};
by('pair-link-field').onclick=e=>e.currentTarget.select();
by('pair').onclick=async()=>{
 if(!register||busy)return notice('Sign in to the register before pairing the customer iPad.');
 const button=by('pair');button.disabled=true;
 by('pair-link-panel').hidden=true;
 activePairingUrl='';
 try{
  const token=await check(db.rpc('pos_issue_display_pairing',{p_register:register.id}));
  if(!/^[0-9a-f-]{36}$/i.test(String(token)))throw Error('Pairing service did not return a valid link.');
  const link=new URL('display.html',location.href);link.searchParams.set('pair',token);
  showPairingUrl(link.href);
  notice('Pairing link created. Use the Copy or Share button below to send it privately to the customer iPad.');
  pairingFeedback('Select Copy or Share. If Safari prevents copying, tap the link field and select Copy manually.');
 }catch(e){
  notice('Could not create a private pairing link: '+e.message+'. Check the POS connection and owner access.');
 }finally{button.disabled=false}
};
by('templates').onchange=()=>{const t=templates.find(x=>x.id===by('templates').value);if(t)showTemplate(t)};
by('save-template').onclick=saveTemplate;by('print').onclick=()=>{if(!lastSale)return notice('No completed sale to print');receipt();window.print()};
createBillButtons();boot();

// Event setup writes the same selections read by Command Center Inventory Hub.
let eventDraft=new Set(),editingEvent=null;
function drawEventProducts(){
 const host=by('event-product-options');host.replaceChildren();
 const query=by('event-product-search').value.trim().toLowerCase();
 const products=[...inventoryCatalog.values()].filter(c=>c.inventory_type==='sales'&&c.is_active&&Number.isSafeInteger(c.price_cents)&&c.price_cents>0&&c.price_cents<=10000000);
 for(const product of products.filter(c=>c.name.toLowerCase().includes(query))){
  const label=document.createElement('label');label.className='event-product-choice';
  const input=document.createElement('input');input.type='checkbox';input.checked=eventDraft.has(product.name);input.setAttribute('aria-label','Include '+product.name);
  input.onchange=()=>{if(input.checked)eventDraft.add(product.name);else eventDraft.delete(product.name);by('event-selection-count').textContent=eventDraft.size+' of 12 products selected'};
  const text=document.createElement('span');const count=stock.filter(x=>x.product_name.trim().toLowerCase()===product.name.toLowerCase()).reduce((n,x)=>n+x.quantity,0);
  text.textContent=product.name+' · '+C.money(product.price_cents)+' · '+count+' pieces';label.append(input,text);host.append(label);
 }
 if(!products.length)host.textContent='No priced Sales Products yet. Add them in Command Center → Inventory → Sales Products.';
 by('event-selection-count').textContent=eventDraft.size+' of 12 products selected';
}
async function openEventSetup(){
 if(checkout||cart.length)return notice('Finish or clear the current cart before changing event products.');
 try{
  await Promise.all([loadStock(),loadEvents()]);
  const select=by('setup-event');select.replaceChildren(eventOption('','New event'));
  for(const e of events.filter(e=>e.status==='open'))select.append(eventOption(e.id,e.name+' · '+e.event_date));
  for(const p of eventProfiles.filter(p=>!events.some(e=>e.inventory_profile_id===p.id)))select.append(eventOption('profile:'+p.id,p.name+' · Command Center'));
  select.value=by('event-select').value;by('event-setup-message').textContent='';chooseSetupEvent();by('event-setup-dialog').showModal();
 }catch(e){notice('Could not load event products: '+e.message)}
}
function chooseSetupEvent(){
 editingEvent=events.find(e=>e.id===by('setup-event').value)||null;
 const profile=eventProfiles.find(p=>'profile:'+p.id===by('setup-event').value);
 if(profile)editingEvent={name:profile.name,event_date:profile.event_date,inventory_profile_id:profile.id};
 by('setup-name').value=editingEvent?.name||'';by('setup-date').value=editingEvent?.event_date||new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'});
 eventDraft=new Set(eventQuickTiles.filter(t=>t.event_id===editingEvent?.inventory_profile_id).map(t=>t.product_name));
 by('event-product-search').value='';drawEventProducts();
}
by('setup-event').onchange=chooseSetupEvent;
by('event-product-search').oninput=drawEventProducts;
by('setup-event-launch').onclick=openEventSetup;by('add-event-products').onclick=openEventSetup;
by('close-event-setup').onclick=()=>by('event-setup-dialog').close();
by('event-setup-form').onsubmit=async e=>{
 e.preventDefault();const button=by('save-event-selection');button.disabled=true;
 try{
  if(checkout||cart.length)throw Error('Finish or clear the cart first');
  const id=await check(db.rpc('pos_save_event_selection',{p_event:editingEvent?.id||null,p_name:by('setup-name').value.trim(),p_date:by('setup-date').value,p_names:[...eventDraft]}));
  selectedEventId=id;sessionStorage.setItem('pos-event',id);
  await Promise.all([loadStock(),loadEvents()]);by('event-select').value=id;renderQuickCatalog();
  by('event-setup-dialog').close();setRegisterOpen(true);notice('Event saved. Your selected Sales Products are ready.');
 }catch(err){by('event-setup-message').textContent=err.message}finally{button.disabled=false}
};
// Refresh on-hand counts without rebuilding an in-progress cart or dialog.
setInterval(()=>{if(user&&!busy&&!checkout&&!cart.length&&!by('event-setup-dialog').open&&document.visibilityState==='visible')loadStock().catch(e=>notice('Inventory refresh failed: '+e.message));},15000);

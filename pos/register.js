'use strict';
const C=window.PersenPOSCore,R=window.PersenPOSReceipt,by=id=>document.getElementById(id);let db,user,register,checkout=null,stock=[],cart=[],templates=[],lastSale=null,season=null;let busy=false,poll;let events=[],sales=[],variantMeta=new Map(),inventoryCatalog=new Map(),eventProfiles=[],eventQuickTiles=[];let reviewLink='';const EV=window.PersenPOSEvents,CASH=window.PersenPOSCash,Experience=window.PersenPOSExperience;const Wizard=window.PersenPOSWizard;let drawer={},drawerConfigured=false,drawerVersion=0,tenderBills={},manualTender=false;
const notice=s=>by('notice').textContent=s;
const check=async q=>{const {data,error}=await q;if(error)throw error;return data};
let pendingCash=null,statusRunning=false,checkoutVersion=0,handoffCheckoutId=null;
// Staff arrive through Employee Home. Inventory Check is deliberately
// read-only until the employee returns home and selects Sales.
let employeeMode='sales';
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
  external:['Payment needs owner approval','The customer chose Venmo or Apple Cash. Check the recipient account, then have the owner scan their badge and enter their PIN.'],
  handoff:['Payment verified · finish order','Payment saved. Give change only for a cash sale, then tap Finish Order.']
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
function current(){return C.totals(cart,Number(by('discount').value),0);}
/* Paired iPad shows a read-only draft as the cashier builds the cart.
   This is presentation only: the checkout RPC still validates prices and stock. */
let draftTimer=null,draftDirty=false,draftSending=false,draftFailureShown=false;
function queueCustomerPreview(){
 if(!db||!user||!register)return;
 draftDirty=true;
 clearTimeout(draftTimer);
 draftTimer=setTimeout(()=>{void flushCustomerPreview()},160);
}
async function flushCustomerPreview(){
 if(draftSending||!draftDirty||!db||!register||!user)return;
 draftSending=true;
 try{
  while(draftDirty){
   draftDirty=false;
   const t=!checkout&&!document.body.classList.contains('pos-register-closed')?current():null;
   const snapshot=t?{
    items:cart.map(x=>({name:x.name,color:x.color,size:x.size,qty:x.qty,unit_cents:x.unit_cents})),
    subtotal_cents:t.subtotal_cents,discount_cents:t.discount_cents,
    tax_cents:t.tax_cents,total_cents:t.total_cents
   }:{items:[]};
   const {error}=await db.from('pos_registers').update({
    draft_snapshot:snapshot,draft_updated_at:new Date().toISOString()
   }).eq('id',register.id).eq('owner_id',user.id);
   if(error)throw error;
   draftFailureShown=false;
  }
 }catch(e){
  draftDirty=true;
  // A disconnected display must never stop cashier checkout.
  if(!draftFailureShown){draftFailureShown=true;notice('Customer live cart connection interrupted; retrying automatically. '+e.message)}
 }finally{
  draftSending=false;
  if(draftDirty){clearTimeout(draftTimer);draftTimer=setTimeout(()=>{void flushCustomerPreview()},2000)}
 }
}
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
 if(!window.PersenPOSSwivel?.canUseRegister?.())return notice('Scan your employee badge and PIN before adding products.');
 if(employeeMode==='inventory')return notice('Inventory Check is read-only. Return to Employee Home and choose Sales to add products.');
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
  button.disabled=remaining<=0||!priced||employeeMode==='inventory';
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
  tile.disabled=!ready.length||employeeMode==='inventory';tile.setAttribute('aria-label','Choose size and color for '+g.name);
  const icon=document.createElement('span');icon.className='quick-symbol';icon.textContent=TYPE_ICONS[g.type]||TYPE_ICONS.other;
  const badge=document.createElement('span');badge.className='quick-count';badge.textContent=total+' in stock';
  const title=document.createElement('span');title.className='quick-name';title.textContent=g.name;
  const detail=document.createElement('span');detail.className='quick-detail';
  detail.textContent=(pinned.includes(g.name.toLowerCase())?'★ EVENT PICK · ':'')+([...new Set(g.variants.map(v=>v.color).filter(Boolean))].join(' / ')||g.category);
  const amount=document.createElement('span');amount.className='quick-price';amount.textContent=price===null?'Set price':('$'+(price/100).toFixed(2)+(g.variants.length>1?' +':''));
  tile.append(icon,badge,title,detail,amount);
  tile.onclick=()=>{if(ready.length===1)addVariant(ready[0]);else pickVariant(g.name,g.variants)};
  host.append(tile);
 }
 if(!matching.length){const empty=document.createElement('div');empty.className='quick-empty';empty.textContent=stock.length?'No matching sales products. Search for more or change the event.':'No sales products yet. Add them under Sales Products first.';host.append(empty)}
 if(pinned.length&&!q&&chosenCategory==='All'){const hint=document.createElement('p');hint.className='quick-event-hint';hint.textContent='Showing '+pinned.length+' event products. Use Add products to change your selection.';host.append(hint)}
 const readyCount=stock.filter(readyToSell).length;
 by('launch-product-count').textContent=readyCount+' ready-to-sell size'+(readyCount===1?'':'s')+' available';
 by('open-register').disabled=readyCount===0;
}
function setRegisterOpen(open,verifiedBadge=false){
 if(!open&&checkout)return notice('Finish or cancel the open checkout before closing the register.');
 if(open&&!stock.some(readyToSell))return notice('First add at least one priced Sales Product.');
 if(open&&!verifiedBadge&&!window.PersenPOSSwivel?.canUseRegister?.()){
  window.PersenPOSSwivel?.requestRegisterOpen?.();
  return;
 }
 document.body.classList.toggle('pos-register-closed',!open);
 if(open)document.body.dataset.employeeHome='false';
 if(!open){employeeMode='sales';delete document.body.dataset.employeeMode;}
 sessionStorage.setItem('pos-register-open',open?'1':'0');
 queueCustomerPreview();
 if(open)notice('Register open. Tap a product, pick the size/color and send checkout to the customer iPad.');
}
by('open-register').onclick=()=>setRegisterOpen(true);
by('close-register').onclick=()=>{
 if(window.PersenPOSSwivel?.active?.()){
  if(cart.length)return notice('Clear the current cart before returning to the employee home.');
  return window.PersenPOSSwivel.showEmployeeHome?.();
 }
 setRegisterOpen(false);
};
by('refresh-products').onclick=async()=>{if(checkout)return notice('Finish or cancel the current checkout first');try{await loadStock();notice('Sale products and event tiles refreshed.')}catch(e){notice('Could not refresh products: '+e.message)}};
by('event-select').addEventListener('change',()=>{if(checkout||cart.length){by('event-select').value=selectedEventId;return notice('Finish or clear the cart before switching events.')}selectedEventId=by('event-select').value;sessionStorage.setItem('pos-event',selectedEventId);renderQuickCatalog()});
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
  const qty=document.createElement('input');qty.type='number';qty.min=1;qty.max=maxQty;qty.value=x.qty;qty.style.width='65px';qty.setAttribute('aria-label','Quantity for '+x.name);qty.disabled=!!checkout||maxQty<1||employeeMode==='inventory';
 qty.onchange=()=>{const value=qty.valueAsNumber;if(!Number.isInteger(value)||value<1||value>maxQty){qty.value=x.qty;notice('Enter a whole quantity from 1 to '+maxQty+'.');return;}x.qty=value;draw()};
  const price=document.createElement('input');price.type='number';price.min=0;price.max=100000;price.step='.01';price.value=(x.unit_cents/100).toFixed(2);price.style.width='100px';price.setAttribute('aria-label','Unit price for '+x.name);price.disabled=!!checkout||employeeMode==='inventory';price.readOnly=!!x.stock_id;price.onchange=()=>{try{x.unit_cents=C.cents(price.value);draw()}catch(e){price.value=(x.unit_cents/100).toFixed(2);notice(e.message)}};
  const service=document.createElement('select');service.className='service-picker';service.setAttribute('aria-label','Service category for '+x.name);service.disabled=!!checkout||employeeMode==='inventory';for(const v of EV.services){const option=document.createElement('option');option.value=v;option.textContent=v;service.append(option);}service.value=x.service||'Other';service.onchange=()=>{x.service=service.value;};
  const remove=document.createElement('button');remove.textContent='×';remove.disabled=!!checkout||employeeMode==='inventory';remove.onclick=()=>{cart.splice(i,1);draw()};r.append(title,qty,price,service,remove);by('cart').append(r);
 }
 try{by('total').textContent=C.money(current().total_cents)}catch(e){notice(e.message)}
 syncCheckoutUI();renderCash();queueCustomerPreview();
}
// Lightweight status refresh: never rebuild the cart while the cashier types.
function syncCheckoutUI(){
 const inventoryOnly=employeeMode==='inventory';
 by('start').disabled=!!checkout||!!pendingCash||!cart.length||inventoryOnly;
 by('cancel').disabled=!checkout||checkout.status==='completed';
 const cashier=activeStaffRole()==='cashier';
 by('discount').disabled=!!checkout||cashier||inventoryOnly;
 document.querySelectorAll('[data-discount]').forEach(button=>{button.disabled=!!checkout||cashier||inventoryOnly});
 by('event-select').disabled=!!checkout||!!cart.length||inventoryOnly;
 updateExternalApprovalPanel();
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
const saleForCheckout=id=>check(db.from('pos_sales').select('id,snapshot,subtotal_cents,discount_cents,tax_cents,total_cents,payment_method,tendered_cents,change_cents,change_breakdown,created_at').eq('checkout_id',id).maybeSingle());
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
 const external=['venmo','apple_cash'].includes(saved.payment_method);
 by('cash-handoff').hidden=false;by('finish-order').disabled=false;
 by('cash-handoff-eyebrow').textContent=external?'OWNER-VERIFIED TRANSFER':'CASH PAYMENT RECORDED';
 by('cash-handoff-heading').textContent=external?'Payment approved by owner':'Hand the customer their change';
 by('cash-handoff-change').hidden=external;
 by('cash-handoff-change').textContent=C.money(saved.change_cents);
 by('cash-handoff-description').textContent=external
  ?'Your independent owner approval was recorded. Tap Finish Order.'
  :'After handing back any change, tap Finish Order.';
 by('epson-drawer-status').hidden=external;
 if(!external)void updateEpsonDrawerStatus(saved.id);
 draw();syncCashierStage();updateExternalApprovalPanel();
 notice(external?'Owner verified this transfer. Tap Finish Order.':
  'Cash payment saved. Return '+C.money(saved.change_cents)+' in change, then Finish Order.');
}
async function showCompletedSale(saved){
 lastSale={id:saved.id,cart:saved.snapshot.items,totals:saved,time:new Date(saved.created_at)};
 handoffCheckoutId=null;checkout=null;cart=[];rememberCash(null);
 by('cash-handoff').hidden=true;by('finish-order').disabled=true;
 document.body.classList.remove('checkout-active');
 syncCashierStage();
 resetTender();receipt();draw();
 // A sale returns to the home/launch view ONLY after the authoritative Finish Order RPC succeeds.
 // Do not reopen a cashier automatically on refresh; a staff badge gate will replace owner-only launch later.
 setRegisterOpen(false);
 by('receipt').hidden=true;
 by('receipt-items').replaceChildren();
 const result=await Promise.allSettled([loadStock(),loadSales(),reloadDrawer()]);
 if(result.some(x=>x.status==='rejected'))return notice('Order finished. Refresh inventory and cash drawer counts before next sale.');
 notice('Order finished. Ready for the next customer.');
}
async function finishOrder(){
 if(busy||!checkout||checkout.status!=='completed'||checkout.cash_handoff_complete===true)return;
 busy=true;checkoutVersion++;by('finish-order').disabled=true;
 try{
  const id=checkout.id;
  const secure=window.PersenPOSSwivel;
  if(secure&&typeof secure.active==='function'&&secure.active()){
   if(!secure.ownsCheckout?.(id))throw Error('Checkout remains locked to original employee');
   await secure.finishSale({cashCents:cashCents()});
   return;
  }
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
// The secure handoff runtime gets a deliberately small adapter rather than the
// cashier Supabase client, user object, or live cart globals. It may create a
// checkout and coordinate the locked screen, but cannot read or expose staff
// secrets from the surrounding owner session.
let secureHandoffSavedSale=null;
function secureHandoffRequest(){
 if(!db||!user||!register||busy||checkout||pendingCash||!Array.isArray(cart)||!cart.length)
  throw Error('Register is not ready for a secure customer handoff');
 if(employeeMode==='inventory')
  throw Error('Inventory Check cannot start a sale. Return to Employee Home and choose Sales.');
 const discountBps=C.discountBps(by('discount').value);
 if(discountBps!==0)throw Error('Secure customer handoff requires a 0% discount in this staging build.');
 return {
  registerId:register.id,
  items:cart.map(x=>({stock_id:x.stock_id||null,name:x.name,qty:x.qty,
   unit_cents:x.unit_cents,service:EV.serviceName(x.service),taxable:x.taxable})),
  discountBps:0,taxMilli:0,eventId:by('event-select').value||null
 };
}
function lockSecureHandoffCheckout(checkoutId){
 if(typeof checkoutId!=='string'||!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(checkoutId))
  throw Error('Invalid secure checkout');
 if(checkout&&checkout.id!==checkoutId)throw Error('Another checkout is already open');
 checkout={id:checkoutId,status:'awaiting_customer'};
 checkoutVersion++;
 document.body.classList.add('checkout-active');
 syncCashierStage();syncCheckoutUI();draw();
}
async function restoreSecureHandoffCheckout({checkoutId}){
 if(typeof checkoutId!=='string'||!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(checkoutId))
  throw Error('Invalid secure checkout');
 const rows=await check(db.from('pos_checkouts').select(
  'id,status,cash_handoff_complete,created_at,total_cents,payment_preference,receipt_print,receipt_email,customer_step,help_requested,progress_updated_at'
 ).eq('id',checkoutId).limit(1));
 const current=rows?.[0];
 if(!current||current.id!==checkoutId||current.status!=='contact_received')
  throw Error('Customer checkout is not ready for cashier payment');
 checkout=current;
 checkoutVersion++;
 document.body.classList.remove('swivel-customer-active');
 syncCashierStage();syncCheckoutUI();draw();updateExternalApprovalPanel();
}

function updateExternalApprovalPanel(){
 const panel=by('external-approval-panel'),method=checkout?.payment_preference;
 const ready=checkout?.status==='contact_received' &&
  ['venmo_info','apple_cash_info'].includes(method) &&
  window.PersenPOSSwivel?.ownsCheckout?.(checkout.id)===true;
 panel.hidden=!ready;
 if(!ready)return;
 by('external-approval-title').textContent=method==='venmo_info'?'Venmo transfer':'Apple Cash transfer';
 by('external-approval-amount').textContent=C.money(checkout.total_cents);
}
async function ownerApproveExternalPayment(){
 if(busy||!checkout||checkout.status!=='contact_received')return;
 if(!['venmo_info','apple_cash_info'].includes(checkout.payment_preference))
  return notice('External transfer selection not verified.');
 if(!window.PersenPOSSwivel?.ownsCheckout?.(checkout.id))
  return notice('The original cashier badge must resume this checkout.');
 const checked=by('external-cashier-confirmed').checked===true;
 const ownerVerified=by('external-owner-verified').checked===true;
 const badge=by('external-owner-badge').value.trim(),pin=by('external-owner-pin').value;
 if(!checked||!ownerVerified||badge.length<8||pin.length<6){
  by('external-approval-status').textContent='Verify the funds independently, check both boxes and enter owner badge and PIN.';
  return;
 }
 busy=true;by('external-owner-approve').disabled=true;
 const checkoutId=checkout.id;
 by('external-approval-status').textContent='Checking owner authorization on server…';
 try{
  const result=await check(db.rpc('pos_owner_confirm_external_payment',{
   p_checkout:checkoutId,p_owner_badge:badge,p_owner_pin:pin,
   p_cashier_confirmed:checked,p_owner_verified:ownerVerified
  }));
  if(result?.approved!==true||result.checkoutId!==checkoutId||
     !['venmo','apple_cash'].includes(result.method)||
     typeof result.saleId!=='string')
   throw Error('Owner payment approval not verified');
  const saved=await saleForCheckout(checkoutId);
  if(!saved||saved.id!==result.saleId||saved.payment_method!==result.method)
   throw Error('Owner-verified sale record unavailable');
  showPaidAwaitingHandoff(saved,{...checkout,status:'completed',cash_handoff_complete:false});
  by('external-approval-status').textContent='Owner approved payment. Finish Order required.';
 }catch(_){
  // Never mark paid based on a network response that cannot be checked.
  by('external-approval-status').textContent='Approval cannot be verified. Check the sale record before retrying. Do not record it as cash.';
 }finally{
  by('external-owner-pin').value='';by('external-owner-badge').value='';
  busy=false;by('external-owner-approve').disabled=false;
 }
}
by('external-owner-approve').onclick=()=>void ownerApproveExternalPayment();

async function finishSecureHandoffSale({checkoutId}){
 if(!checkout||checkout.id!==checkoutId||checkout.status!=='completed')
  throw Error('Secure checkout is not ready to finish');
 // The bridge has already used the authorized staff Finish Order RPC.
 // Server verification still happens before guest revocation and home.
 const saved=await saleForCheckout(checkoutId);
 if(!saved)throw Error('Order was finished but receipt details are unavailable. Refresh to recover.');
 secureHandoffSavedSale=saved;
 return {checkoutId,completed:true};
}
function reopenRegisterAfterVerifiedBadge(){
 // The secure bridge calls this only after server validation of the
 // original shift badge. Verify catalog readiness while the opaque cashier
 // lock stays visible, then return to the employee home menu instead of
 // dropping straight into a new cart.
 if(!db||!user||!register||busy||checkout||pendingCash)
  throw Error('Next-sale register is not ready');
 if(!stock.some(readyToSell))
  throw Error('No ready-to-sell products available for the next sale');
 setRegisterOpen(false,true);
 if(!document.body.classList.contains('pos-register-closed'))
  throw Error('Register did not return to the employee home after badge verification');
 return true;
}
function closeEmployeeSalesViewForHome(){
 // Preserve the verified employee shift while closing the Sales-only viewport.
 // Never discard an active cart or sensitive checkout to reveal employee controls.
 if(checkout||pendingCash)throw Error('Finish or cancel the open checkout before returning to Employee Home.');
 if(cart.length)throw Error('Clear the current cart before returning to Employee Home.');
 setRegisterOpen(false,true);
 if(!document.body.classList.contains('pos-register-closed'))
  throw Error('The register could not close safely');
 delete document.body.dataset.employeeMode;
 return true;
}
function activeStaffRole(){
 return window.PersenPOSSwivel?.employee?.()?.role||'';
}
function openEmployeeMode(mode){
 if(!window.PersenPOSSwivel?.canUseRegister?.())
  throw Error('Employee shift is not active');
 if(checkout||pendingCash)throw Error('Finish or cancel the current checkout first');
 if(mode!=='sales'&&mode!=='inventory')throw Error('Unknown employee action');
 const previousMode=employeeMode;
 employeeMode=mode;
 document.body.dataset.employeeHome='false';
 document.body.dataset.employeeMode=mode;
 document.body.dataset.staffRole=activeStaffRole();
 setRegisterOpen(true,true);
 if(document.body.classList.contains('pos-register-closed')){
  employeeMode=previousMode;
  document.body.dataset.employeeMode=previousMode;
  throw Error('Register did not open after employee authorization');
 }
 if(mode==='inventory')setScanMode('inventory');
 else setScanMode('sell');
 draw();
 // Keep the scanner input focused in both Sales and Inventory Check.
 // On iPad a Bluetooth HID scanner can type into this field immediately.
 const scanner=by('scan-code');scanner.value='';scanner.focus({preventScroll:true});
 return true;
}
async function showSecureHandoffHome(){
 if(!secureHandoffSavedSale)throw Error('Finished checkout receipt is unavailable');
 const saved=secureHandoffSavedSale;
 await showCompletedSale(saved);
 secureHandoffSavedSale=null;
}
const secureHandoffRpcNames=new Set([
 'pos_staff_start_shift','pos_staff_resume_shift','pos_staff_begin_checkout','pos_handoff_claim',
 'pos_handoff_issue_guest','pos_handoff_status','pos_handoff_resume',
 'pos_handoff_verify_paid','pos_handoff_revoke',
  'pos_staff_complete_cash','pos_staff_finish_order'
]);
const secureHandoffClient=Object.freeze({
 rpc:(name,args)=>{
  if(!secureHandoffRpcNames.has(name)||!db)throw Error('Secure handoff RPC unavailable');
  return db.rpc(name,args);
 }
});
window.PersenPOSRegister=Object.freeze({
 ready:()=>!!db&&!!user&&!!register,
 getRegisterId:()=>register?.id||null,
 secureHandoffClient,
 getStaffCheckoutRequest:secureHandoffRequest,
 lockHandoffCheckout:lockSecureHandoffCheckout,
 restoreHandoffCheckout:restoreSecureHandoffCheckout,
 finishHandoffSale:finishSecureHandoffSale,
 showHandoffHome:showSecureHandoffHome,
 reopenRegisterAfterVerifiedBadge,
 openEmployeeMode,
 closeEmployeeSalesViewForHome,
 openUnpaidRecoveryDialog:()=>openUnpaidRecoveryDialog(),
 openEmployeeBadgeSetup:ownerOpenEmployeeBadgeSetup,
 refreshExternalApprovalUI:updateExternalApprovalPanel,
 notice:message=>notice(String(message||'').slice(0,240))
});
async function status(){
 // Secure swivel owns checkout state while a staff shift is active.
 // Never let legacy owner polling overwrite or expose a locked checkout.
 if(window.PersenPOSSwivel?.active?.())return;
 if(!register||busy||statusRunning)return;
 statusRunning=true;const version=checkoutVersion;
 try{
  const list=await check(db.from('pos_checkouts').select('id,status,cash_handoff_complete,created_at,total_cents,payment_preference,receipt_print,receipt_email,customer_step,help_requested,progress_updated_at').eq('register_id',register.id).order('created_at',{ascending:false}).limit(1));
  if(version!==checkoutVersion||window.PersenPOSSwivel?.active?.())return;
  let c=list[0];const awaitingHandoff=c?.status==='completed'&&c.cash_handoff_complete===false;
  if(awaitingHandoff){
   const saved=await saleForCheckout(c.id);
   if(version!==checkoutVersion||window.PersenPOSSwivel?.active?.())return;
   if(!saved){notice('Payment recorded but sale details are not available. Refresh before continuing.');return}
   if(handoffCheckoutId!==c.id||by('cash-handoff').hidden)showPaidAwaitingHandoff(saved,c);
   else checkout=c;
  }else{
   const recoveryId=pendingCash||(checkout&&(c?.id!==checkout.id||c.status==='completed')?checkout.id:null);
   if(recoveryId){
    const saved=await saleForCheckout(recoveryId);
    if(version!==checkoutVersion||window.PersenPOSSwivel?.active?.())return;
    if(saved){await showCompletedSale(saved);if(c?.id===recoveryId)c={...c,status:'completed'};}
    else if(pendingCash&&(c?.id!==recoveryId||['contact_received','cancelled','awaiting_customer'].includes(c.status))){
     rememberCash(null);notice('Cash was not recorded. Check the tender amount and try again.');
    }
    if(version!==checkoutVersion||window.PersenPOSSwivel?.active?.())return;
   }
   checkout=c&&['awaiting_customer','contact_received'].includes(c.status)?c:null;
   document.body.classList.toggle('checkout-active',!!checkout);
   if(checkout&&document.body.classList.contains('pos-register-closed'))
    notice('Unfinished staging checkout detected. Owner: use Recover Unfinished Test Checkout. Employee access stays locked.');
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
 }catch(e){if(!window.PersenPOSSwivel?.active?.())notice('Connection lost: '+e.message)}finally{statusRunning=false}
}
async function begin(){if(window.PersenPOSSwivel?.active?.())return notice('Use the secure employee handoff. Owner-only checkout cannot bypass an active employee shift.');if(employeeMode==='inventory')return notice('Inventory Check cannot start a sale. Return to Employee Home and choose Sales.');if(busy||checkout||pendingCash)return;busy=true;checkoutVersion++;try{const payload=cart.map(x=>({stock_id:x.stock_id||null,name:x.name,qty:x.qty,unit_cents:x.unit_cents,service:EV.serviceName(x.service),taxable:x.taxable}));const bps=C.discountBps(by('discount').value),tax=0;const id=await check(db.rpc('pos_begin_checkout',{p_register:register.id,p_items:payload,p_discount_bps:bps,p_tax_milli:tax,p_event:by('event-select').value||null}));checkout={id,status:'awaiting_customer'};syncCashierStage();notice('Checkout sent to customer display.');}catch(e){notice(e.message)}finally{busy=false;draw();await status()}}
async function cancel(){if(window.PersenPOSSwivel?.active?.())return notice('Secure customer checkout stays locked to the original employee.');if(!checkout||busy)return;busy=true;checkoutVersion++;try{await check(db.rpc('pos_cancel_checkout',{p_checkout:checkout.id}));checkout=null;rememberCash(null);resetTender();syncCashierStage();draw();notice('Checkout cancelled')}catch(e){notice(e.message)}finally{busy=false;await status()}}
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
  const secure=window.PersenPOSSwivel;
   let expectedSaleId=null;
   if(secure&&typeof secure.active==='function'&&secure.active()){
    if(!secure.ownsCheckout?.(id))throw Error('Checkout remains locked to original employee');
    const proof=await secure.recordCash({tenderCents:tendered,
     receivedBreakdown:manualTender?tenderBills:{},
     changeBreakdown:plan.breakdown||{},expectedDrawerVersion:drawerVersion});
    if(!proof||proof.checkoutId!==id||typeof proof.saleId!=='string')
     throw Error('Staff cash authorization unavailable');
    expectedSaleId=proof.saleId;
   }else{
    await check(db.rpc('pos_complete_cash',{p_checkout:id,p_tender_cents:tendered,
     p_received_breakdown:manualTender?tenderBills:{},p_change_breakdown:plan.breakdown||{},
     p_expected_drawer_version:drawerVersion}));
   }
  const saved=await saleForCheckout(id);
  if(!saved||(expectedSaleId&&saved.id!==expectedSaleId))throw Error('Checking whether this sale was recorded. Keep this checkout open.');
  showPaidAwaitingHandoff(saved,{...checkout,status:'completed',cash_handoff_complete:false});
 }catch(e){
  notice('Cash payment could not be confirmed: '+e.message+'. Do not start another order until status is checked.');
 }finally{busy=false;await status()}
}
function receipt(){if(!lastSale)return;by('receipt').hidden=false;by('receipt-id').textContent=(lastSale.totals.payment_method==='venmo'?'VENMO':lastSale.totals.payment_method==='apple_cash'?'APPLE CASH':'CASH')+' SALE '+lastSale.id.slice(0,8).toUpperCase()+' · '+lastSale.time.toLocaleString();by('receipt-items').replaceChildren();for(const x of lastSale.cart){const line=document.createElement('div');line.className='receipt-line';const a=document.createElement('span');a.textContent=x.qty+' × '+x.name+' '+x.size;const b=document.createElement('span');b.textContent=C.money(x.qty*x.unit_cents);line.append(a,b);by('receipt-items').append(line)}by('receipt-subtotal').textContent=C.money(lastSale.totals.subtotal_cents);by('receipt-discount').textContent='−'+C.money(lastSale.totals.discount_cents);by('receipt-total').textContent=C.money(lastSale.totals.total_cents);by('receipt-tender-label').textContent=lastSale.totals.payment_method==='cash'?'Cash received':'Owner-verified transfer';by('receipt-change-label').textContent=lastSale.totals.payment_method==='cash'?'Change returned':'Change';by('receipt-cash-tendered').textContent=C.money(lastSale.totals.tendered_cents);by('receipt-cash-change').textContent=C.money(lastSale.totals.change_cents);const cfg=R.presentation({headline:by('headline').value,promotion:by('promotion').value,footer:by('footer').value,review:by('review-message').value,reviewLink:reviewLink,showReview:by('receipt-review').checked,showSeason:by('receipt-seasonal').checked,season});by('receipt-headline').textContent=cfg.headline;by('receipt-season-heading').textContent=cfg.season_style.icon+'  '+cfg.season_style.label+'  '+cfg.season_style.icon;by('receipt-season-heading').hidden=!cfg.season_style.label;by('receipt-season-message').textContent=cfg.seasonal;by('receipt-season-message').hidden=!cfg.seasonal;by('receipt-promo').textContent=cfg.promotion;by('receipt-footer').textContent=cfg.footer;by('receipt-review-message').textContent=cfg.review_url?cfg.review:'';by('receipt-review-message').hidden=!cfg.review_url;const a=by('receipt-review-url');a.hidden=!cfg.review_url;if(cfg.review_url){a.href=cfg.review_url;a.textContent=cfg.review_url.split('://').slice(1).join('://')}else{a.removeAttribute('href');a.textContent=''};}
async function saveTemplate(){try{const id=by('templates').value;const payload={owner_id:user.id,name:by('template-name').value.trim(),headline:by('headline').value,promotion:by('promotion').value,footer:by('footer').value,review_message:by('review-message').value,show_seasonal:by('receipt-seasonal').checked,show_review:by('receipt-review').checked,active:false,updated_at:new Date().toISOString()};if(!payload.name)throw Error('Template name required');if(id)await check(db.from('pos_receipt_templates').update(payload).eq('id',id));else await check(db.from('pos_receipt_templates').insert(payload));await loadTemplates();notice('Receipt template saved. Historical sale amounts are unchanged.')}catch(e){notice(e.message)}}
async function boot(){try{if(!window.PA?.ready)throw Error('Supabase connection unavailable');db=PA.db;user=await PA.me();if(!user){notice('Sign in with your Command Center account');return}if(!await PA.isAdmin(user))throw Error('This account is not authorized for Persen POS');by('auth').hidden=true;by('workspace').hidden=false;await ensureRegister();await Promise.all([loadStock(),loadTemplates(),loadEvents(),loadSales(),reloadDrawer()]);if(sessionStorage.getItem('pos-register-open')==='1'&&stock.some(x=>x.quantity>0&&variantMeta.has(x.id)))setRegisterOpen(true);try{const contents=await check(db.from('site_content').select('key,value').in('key',['seasonal_campaigns_v1','v54_google_reviews']));const dict=Object.fromEntries((contents||[]).map(x=>[x.key,x.value]));season=C.season(dict.seasonal_campaigns_v1);reviewLink=R.reviewUrl(dict.v54_google_reviews);if(season){Experience.apply(document,season);by('seasonal-status').textContent='Active: '+season.title+' — receipt and display promotions';notice('Seasonal Studio connected: '+season.title)}else{by('seasonal-status').textContent='No published active campaign — classic receipt and customer display'}if(!reviewLink)notice('Google review link not configured in Command Center Site Studio; review invitation hidden until configured.')}catch(err){by('seasonal-status').textContent='Seasonal Studio temporarily unavailable';}await status();poll=setInterval(status,1800);db.channel('pos-owner-'+register.id).on('postgres_changes',{event:'*',schema:'public',table:'pos_checkouts',filter:'register_id=eq.'+register.id},status).subscribe();}catch(e){notice(e.message)}}

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
 // Historical tax amounts are preserved in saved records, but POS does not compute or display new tax.
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
  const save=document.createElement('button');save.type='button';save.textContent=m?'Update price':'Set price';
  save.onclick=async()=>{
   if(checkout)return notice('Finish the current checkout before changing prices.');
   save.disabled=true;
   try{
    if(!price.value.trim())throw Error('Enter a selling price.');
    const cents=C.cents(price.value);
    const metadata={stock_id:x.id,price_cents:cents,taxable:false,
      category:m?.category||'Apparel',product_type:m?.product_type||'other',description:m?.description||''};
    await check(db.from('pos_variant_details').upsert(metadata,{onConflict:'stock_id'}));
    variantMeta.set(x.id,metadata);
    draw();renderProductList();
    notice('Saved selling price for '+(x.sku||x.product_name)+'.');
   }catch(e){notice('Could not save price: '+e.message)}
   finally{save.disabled=false}
  };
  form.append(price,save);div.append(info,form);host.append(div);
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
  const details={category:String(f.get('category')||'Apparel').slice(0,90),product_type:String(f.get('type')||'other'),description:String(f.get('description')||'').slice(0,500),price_cents:price,taxable:false};
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

async function updateEpsonDrawerStatus(saleId){
 const field=by('epson-drawer-status');if(!field)return;
 field.textContent='Epson drawer queue not yet confirmed. Use the key if the drawer stays shut.';
 try{
  const job=await check(db.from('pos_drawer_open_jobs').select('id,state').eq('sale_id',saleId).maybeSingle());
  field.textContent=job
   ? 'Cash drawer command '+(job.state==='queued'?'queued for Windows Epson station':job.state.replaceAll('-',' '))+'. Check the drawer physically.'
   : 'No Epson drawer command exists for this sale. Use the key and check the station.';
 }catch(_){
  field.textContent='Epson drawer station has not been installed/configured. Use the key.';
 }
}
async function requestOwnerDrawer(){
 const btn=by('epson-owner-open'),feedback=by('epson-owner-message');
 if(btn.disabled||!user||!register)return;
 const value=by('epson-owner-value').value.trim();
 const method=by('epson-owner-method').value;
 by('epson-owner-value').value=''; // Never retain a scanned badge or owner PIN.
 if(!value){feedback.textContent='Enter the owner PIN or scan the enrolled owner badge.';return;}
 btn.disabled=true;
 try{
  const id=await check(db.rpc('pos_authorize_manual_drawer',{
   p_register:register.id,p_reason:by('epson-owner-reason').value,
   p_method:method,p_value:value
  }));
  feedback.textContent=id
   ? 'Owner verified. Opening request queued to your Windows Epson station. Check the drawer physically.'
   : 'Owner verification failed or temporarily locked. Drawer stays closed.';
 }catch(_){
  feedback.textContent='Owner drawer authorization unavailable. This staging integration may not be installed. Use the key.';
 }finally{btn.disabled=false;}
}
async function saveOwnerDrawerCredential(){
 const btn=by('epson-enroll-save'),field=by('epson-enroll-value'),status=by('epson-enroll-result');
 const value=field.value.trim(),method=by('epson-enroll-method').value;
 field.value='';
 if(!value){status.textContent='Enter a new PIN or generate a random badge code first.';return;}
 btn.disabled=true;
 try{
  const ok=await check(db.rpc('pos_set_owner_drawer_credential',{p_method:method,p_value:value}));
  status.textContent=ok?'Owner credential saved as a protected server-side hash. Keep the original badge code secure.':'Credential not saved.';
 }catch(_){
  status.textContent='Could not save owner credential. Confirm signed-in owner account and staging migration.';
 }finally{btn.disabled=false;}
}

by('save-drawer').addEventListener('click',saveDrawer);

by('epson-owner-open').addEventListener('click',()=>void requestOwnerDrawer());
by('epson-owner-value').addEventListener('keydown',e=>{
 if(e.key==='Enter'){e.preventDefault();void requestOwnerDrawer();}
});
by('epson-enroll-save').addEventListener('click',()=>void saveOwnerDrawerCredential());
by('epson-enroll-random').addEventListener('click',()=>{
 if(by('epson-enroll-method').value!=='badge'){
  by('epson-enroll-result').textContent='Select Private owner badge first.';return;
 }
 if(!globalThis.crypto?.getRandomValues){
  by('epson-enroll-result').textContent='Secure random generator unavailable; do not create a guessable barcode.';return;
 }
 const bytes=new Uint8Array(20);crypto.getRandomValues(bytes);
 const value=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
 const input=by('epson-enroll-value');input.type='text';input.value=value;input.focus();input.select();
 by('epson-enroll-result').textContent='Copy this private code and print as Code 128 before saving; the POS cannot reveal it later. Treat this badge as a secret.';
});
by('epson-enroll-method').addEventListener('change',()=>{
 by('epson-enroll-value').value='';by('epson-enroll-value').type='password';
});


by('generate-owner-badge').addEventListener('click',()=>{
 const out=by('owner-badge-message');
 if(!db||!user){out.textContent='Owner sign-in is required before badge setup.';return}
 if(!globalThis.crypto||typeof crypto.getRandomValues!=='function'){
  out.textContent='Secure badge generation is unavailable on this device.';return;
 }
 // A 128-bit random Code 128-compatible badge value; no local storage,
 // query-string, telemetry, or server write happens until owner submits.
 const bytes=new Uint8Array(16);
 crypto.getRandomValues(bytes);
 const code=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
 const field=by('owner-badge-enrollment').querySelector('[name=badge]');
 field.value=code;field.focus();field.select();
 out.textContent='Private badge code generated. Copy or print it as Code 128 before saving. The POS cannot reveal it later.';
});

by('owner-badge-enrollment').addEventListener('submit',async event=>{
 event.preventDefault();
 const form=event.currentTarget,out=by('owner-badge-message'),button=by('enroll-owner-badge');
 if(!db||!user){out.textContent='Sign in as the owner before setting up a staging badge.';return}
 const fields=new FormData(form);
 const firstName=String(fields.get('first_name')||'').trim();
 const badge=String(fields.get('badge')||'').trim();
 const pin=String(fields.get('pin')||'');
 const confirm=String(fields.get('pin_confirm')||'');
 if(badge.length<8||pin.length<6||pin!==confirm||!firstName){
  out.textContent='Use an 8+ character badge code and matching 6+ digit PIN.';return;
 }
 button.disabled=true;out.textContent='Saving protected owner badge…';
 try{
  const result=await check(db.rpc('pos_owner_enroll_staff_self',{
   p_badge:badge,p_pin:pin,p_first_name:firstName
  }));
  if(result?.enrolled!==true)throw Error('Owner badge was not enrolled');
  form.reset();
  out.textContent='Owner badge saved for staging. You can now use Hand to Customer.';
 }catch(_){
  form.querySelector('[name=pin]').value='';
  form.querySelector('[name=pin_confirm]').value='';
  out.textContent='Owner badge was not saved. Confirm this is your staging owner account and try a different badge code.';
 }finally{button.disabled=false}
});



/* Owner-only reservation of two separate future employee badge identities.
 * Never treat pending reservations as an active cashier login. The server
 * protects this action with the already enrolled owner's badge and PIN.
 */
const unpaidRecoveryDialog=by('recover-unpaid-dialog');
function openUnpaidRecoveryDialog(){
 if(!db||!user)return notice('Owner must sign in before recovering staging checkout.');
 if(window.PersenPOSSwivel?.active?.() &&
   window.PersenPOSSwivel.employee?.()?.role!=='owner')
  return notice('Only the owner can recover a staging checkout.');
 if(!unpaidRecoveryDialog.open)unpaidRecoveryDialog.showModal();
}
by('open-checkout-recovery').onclick=openUnpaidRecoveryDialog;
by('open-checkout-recovery-toolbar').onclick=openUnpaidRecoveryDialog;
by('recover-unpaid-close').onclick=()=>unpaidRecoveryDialog.close();
by('recover-unpaid-form').addEventListener('submit',async event=>{
 event.preventDefault();
 const form=event.currentTarget,button=by('recover-unpaid-submit'),
  output=by('recover-unpaid-status'),data=new FormData(form);
 if(!data.get('confirm_unpaid')){
  output.textContent='Explicit confirmation is required. Nothing was cancelled.';return;
 }
 if(!db||!user||!register){output.textContent='Owner staging connection is unavailable.';return;}
 if(!window.confirm('Cancel unfinished, UNPAID test checkouts and revoke customer links? This cannot be undone.'))
  return;
 button.disabled=true;
 output.textContent='Checking owner approval and verifying checkout is unpaid…';
 try{
  const result=await check(db.rpc('pos_owner_recover_unpaid_staging_checkout',{
   p_register:register.id,
   p_owner_badge:String(data.get('owner_badge')||'').trim(),
   p_owner_pin:String(data.get('owner_pin')||'')
  }));
  if(result?.recovered!==true){
   output.textContent=result?.reason==='owner_auth'
    ?'Owner badge/PIN did not match; no orders were cancelled.'
    :result?.reason==='locked'
     ?'Owner PIN verification is temporarily locked. No orders were cancelled.'
     :'Recovery not authorized. No orders were cancelled.';
   return;
  }
  output.textContent='Recovered '+Number(result.cancelledUnpaidCheckouts||0)+' unfinished unpaid staging checkout(s). Reloading the locked register…';
  // A prior employee/customer frame may still hold obsolete local tokens.
  // Force a fresh secure employee shift on this device.
  window.location.reload();
 }catch(_){
  output.textContent='Recovery was not verified. No completed sale is affected. Check staging status before retrying.';
 }finally{
  form.querySelector('[name=owner_pin]').value='';
  form.querySelector('[name=owner_badge]').value='';
  button.disabled=false;
 }
});

const badgeSetupDialog=by('staff-badge-setup-dialog');
by('open-employee-badges').onclick=()=>window.PersenPOSRegister.openEmployeeBadgeSetup();
by('close-staff-badge-setup').onclick=()=>badgeSetupDialog.close();
let employeeSlotStatus=null,permissionUpdatePending=false;
function showEmployeeRegisterAccess(status){
 const section=by('staff-register-access'),allow=by('staff-grant-register'),
  revoke=by('staff-revoke-register'),display=by('staff-register-access-status');
 const active=status?.activated===true;
 section.hidden=!active;
 allow.disabled=true;revoke.disabled=true;
 if(!active)return;
 const ready=typeof status?.staffId==='string'&&
  /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(status.staffId)&&
  typeof status.registerAllowed==='boolean'&&!!register?.id;
 if(!ready){
  display.textContent='Register permission controls need the reviewed staging database update. No permissions were changed.';
  return;
 }
 const granted=status.registerAllowed===true;
 display.textContent=granted
  ?'This employee badge is allowed on this staging register.'
  :'This employee badge is NOT allowed on this staging register.';
 allow.disabled=granted;revoke.disabled=!granted;
}
async function refreshEmployeeSlotStatus(){
 const form=by('staff-badge-setup-form'),slot=Number(form.querySelector('[name=slot]').value),
  out=by('staff-setup-readiness'),save=by('save-staff-badge'),test=by('test-staff-badge-pin');
 employeeSlotStatus=null;save.disabled=true;test.disabled=true;
 out.textContent='Checking Employee '+slot+'…';
 try{
  if(!register?.id)throw Error('Active staging register required');
  let status;
  try{
   status=await check(db.rpc('pos_owner_badge_slot_status',{p_slot:slot,p_register:register.id}));
  }catch(error){
   // Read-only legacy status is safe for displaying badges. Never use its
   // user-ID permissions or the legacy six-argument enrollment RPC.
   if(error?.code!=='PGRST202'&&
      !/Could not find the function\s+(?:public\.)?pos_owner_badge_slot_status/i.test(String(error?.message||'')))
    throw error;
   status=await check(db.rpc('pos_owner_badge_slot_status',{p_slot:slot}));
  }
  if(slot!==Number(form.querySelector('[name=slot]').value))return;
  if(!status||status.slot!==slot)throw Error('Employee setup status unavailable');
  employeeSlotStatus=status;
  showEmployeeRegisterAccess(status);
  if(status.activated){
   out.textContent='Employee '+slot+' is active: '+status.firstName+'. Have them scan their badge and enter their PIN at Start Shift. No email is required.';
  }else{
   out.textContent='Employee '+slot+' is available. Enter a name, generate a badge, choose a PIN, then confirm with your owner badge and PIN.';
  }
  save.disabled=!!status.reserved;
  test.disabled=!status.activated;
 }catch(_){
  showEmployeeRegisterAccess(null);
  out.textContent='Cannot verify the employee badge slots. Saving is disabled until staging responds.';
 }
}
async function changeEmployeeRegisterAccess(allowed){
 const form=by('staff-badge-setup-form'),slot=Number(form.querySelector('[name=slot]').value);
 const snapshot=employeeSlotStatus;
 const result=by('staff-register-access-status');
 const allow=by('staff-grant-register'),revoke=by('staff-revoke-register');
 if(permissionUpdatePending||!db||!user||!register?.id||snapshot?.slot!==slot||
    snapshot?.activated!==true||typeof snapshot?.registerAllowed!=='boolean'||
    !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(snapshot?.staffId||'')){
  result.textContent='Employee register permission is unavailable. No access was changed.';
  return;
 }
 if(snapshot.registerAllowed===allowed)return;
 if(!allowed&&!window.confirm('Revoke this employee badge from the current register? All active shifts for this badge, including customer handoffs, will be ended.'))return;
 permissionUpdatePending=true;
 allow.disabled=true;revoke.disabled=true;
 result.textContent='Verifying owner permission and updating this register…';
 try{
  const updated=await check(db.rpc('pos_owner_set_badge_register_access',{
   p_register:register.id,p_staff_id:snapshot.staffId,p_allowed:allowed
  }));
  if(updated!==true)throw Error('Register permission change was not verified');
  // Only refresh the selected employee. A slot change during the RPC must
  // never apply the previous person's stale screen state to a new employee.
  if(slot===Number(form.querySelector('[name=slot]').value)){
   await refreshEmployeeSlotStatus();
   by('staff-badge-setup-message').textContent=allowed
    ?'Employee register access granted for this staging register only.'
    :'Employee access revoked and active shifts invalidated. A new owner approval is required before future shifts.';
  }
 }catch(error){
  result.textContent=error?.code==='PGRST202'
   ?'The credential-scoped permission RPC needs the staging database update. No access was changed.'
   :'Could not verify the owner permission update. No success was confirmed. Refresh before retrying.';
  // Never restore stale enable/disable controls after a failed or ambiguous RPC.
  employeeSlotStatus=null;
  allow.disabled=true;revoke.disabled=true;
 }finally{
  permissionUpdatePending=false;
  if(employeeSlotStatus&&slot===Number(form.querySelector('[name=slot]').value))
   showEmployeeRegisterAccess(employeeSlotStatus);
 }
}
by('staff-grant-register').addEventListener('click',()=>void changeEmployeeRegisterAccess(true));
by('staff-revoke-register').addEventListener('click',()=>void changeEmployeeRegisterAccess(false));
by('staff-badge-setup-form').querySelector('[name=slot]').addEventListener('change',()=>{
 const form=by('staff-badge-setup-form');
 for(const field of ['first_name','badge','pin','pin_confirm','owner_badge','owner_pin'])
  form.querySelector('[name='+field+']').value='';
 employeeSlotStatus=null;
 showEmployeeRegisterAccess(null);
 by('staff-badge-setup-message').textContent='New employee slot selected. Generate a fresh badge and PIN.';
 void refreshEmployeeSlotStatus();
});
function ownerOpenEmployeeBadgeSetup(){
 if(!db||!user)return notice('Owner sign-in is required to set up cashier badges.');
 if(badgeSetupDialog.open)return;
 badgeSetupDialog.showModal();
 void refreshEmployeeSlotStatus();
}
function validEan8(data){
 const sum=[...data].reduce((total,digit,i)=>total+Number(digit)*(i%2===0?3:1),0);
 return data+String((10-sum%10)%10);
}
by('generate-staff-badge').onclick=()=>{
 const output=by('staff-badge-setup-message');
 if(employeeSlotStatus?.reserved)return output.textContent='Employee slot already has an active badge. Choose the other slot.';
 if(!window.crypto?.getRandomValues)return output.textContent='Secure badge generation is unavailable.';
 const numbers=new Uint32Array(2);crypto.getRandomValues(numbers);
 const firstSeven=String(((numbers[0]^numbers[1])>>>0)%10000000).padStart(7,'0');
 const code=validEan8(firstSeven);
 const field=by('staff-badge-setup-form').querySelector('[name=badge]');
 field.value=code;field.select();
 output.textContent='Generated EAN-8 badge '+code+'. Print the code or prepare a barcode tag before leaving this screen.';
};
by('staff-badge-setup-form').addEventListener('submit',async event=>{
 event.preventDefault();
 const form=event.currentTarget,f=new FormData(form),output=by('staff-badge-setup-message'),button=by('save-staff-badge');
 const slot=Number(f.get('slot')),name=String(f.get('first_name')||'').trim(),
 badge=String(f.get('badge')||'').trim(),pin=String(f.get('pin')||''),
 confirm=String(f.get('pin_confirm')||'');
 if(!employeeSlotStatus||employeeSlotStatus.slot!==slot||employeeSlotStatus.reserved){
  output.textContent='This employee slot is not available. Check the status before saving.';return;
 }
 if(!name||!/^[0-9]{8}$/.test(badge)||pin.length<6||pin!==confirm){
  output.textContent='Enter the employee name, valid 8-digit barcode, and matching 6+ character PIN.';return;
 }
 const ownerBadge=String(f.get('owner_badge')||'').trim(),ownerPIN=String(f.get('owner_pin')||'');
 if(ownerBadge.length<8||ownerPIN.length<6){
  output.textContent='Scan your owner badge and enter your owner PIN to authorize creating this cashier badge.';return;
 }
 if(!register?.id){output.textContent='Open an authorized staging register before enrolling an employee.';return;}
 button.disabled=true;output.textContent='Securely verifying owner and activating the employee badge…';
 try{
  const result=await check(db.rpc('pos_owner_enroll_badge',{
   p_slot:slot,p_first_name:name,p_badge:badge,p_pin:pin,
   p_owner_badge:ownerBadge,p_owner_pin:ownerPIN,p_register_id:register.id
  }));
  if(result?.saved!==true||result?.activated!==true){
   const reasons={
    owner_auth:'Owner badge or owner PIN not recognized. Nothing was saved.',
    locked:'Too many failed owner PIN attempts. Try after the lockout.',
    badge_taken:'That barcode is already assigned. Generate another.',
    slot_taken:'This employee slot already has a badge. Select the other slot.',
    enrollment_conflict:'The employee badge could not be saved because of a database conflict. No employee was activated; contact the owner to review staging.'
   };
   output.textContent=reasons[result?.reason]||'Badge was not saved. Check your owner credentials and retry.';
   return;
  }
  output.textContent='SUCCESS: '+name+' is active as Employee '+slot+'. Save the barcode '+badge+
    ' now; re-enter their PIN and tap Test, or close this screen and have them scan their badge at Start Shift.';
  await refreshEmployeeSlotStatus();
 }catch(err){
  const text=String(err?.message||'');
  // PostgREST PGRST202 signals that the reviewed register-scoped enrollment
  // function is not installed in staging. Do not mislabel this as a duplicate
  // badge, and never fall back to the legacy owner-wide six-argument RPC.
  const migrationMissing=err?.code==='PGRST202'||
    /Could not find the function\s+(?:public\.)?pos_owner_enroll_badge/i.test(text);
  output.textContent=migrationMissing
   ?'Employee badge enrollment needs a staging database update. No badge was activated. Owner: install the reviewed register-scoped enrollment migration first.'
   :text.includes('No active staging register')
    ?'No active staging register was found. Open the staging register first.'
    :'Unable to save the employee badge. No permissions were changed. Check your owner badge and PIN.';
  await refreshEmployeeSlotStatus();
 }finally{
  for(const field of ['pin','pin_confirm','owner_badge','owner_pin'])
   form.querySelector('[name='+field+']').value='';
  if(employeeSlotStatus?.reserved)button.disabled=true;
  else if(employeeSlotStatus)button.disabled=false;
 }
});
by('test-staff-badge-pin').onclick=async()=>{
 const form=by('staff-badge-setup-form'),f=new FormData(form),
 button=by('test-staff-badge-pin'),output=by('staff-badge-setup-message');
 const badge=String(f.get('badge')||'').trim(),pin=String(f.get('pin')||'');
 if(!employeeSlotStatus?.activated){
  output.textContent='Create and activate the employee badge first.';return;
 }
 if(!/^[0-9]{8}$/.test(badge)||pin.length<6){
  output.textContent='Scan the employee badge and enter their PIN to verify it.';return;
 }
 button.disabled=true;output.textContent='Checking employee badge and PIN…';
 try{
  const result=await check(db.rpc('pos_staff_test_badge_pin',{p_badge:badge,p_pin:pin}));
  output.textContent=result?.verified===true&&result?.role==='cashier'
    ?'SUCCESS: Employee badge and PIN verified. Close this panel; employee can scan to start a shift.'
    :'Badge or PIN did not match. Check the chosen employee slot and try again.';
 }catch(_){output.textContent='Employee PIN test unavailable; no access was granted.'}
 finally{
  form.querySelector('[name=pin]').value='';
  if(employeeSlotStatus?.activated)button.disabled=false;
 }
};

by('login').onsubmit=async e=>{e.preventDefault();try{const f=new FormData(e.target);await PA.signIn(String(f.get('email')),String(f.get('password')));await boot()}catch(err){notice(err.message)}};
// A non-blocking, accessible one-second scan confirmation. It never captures scanner focus.
let scanConfirmationTimer;
function showScanConfirmation(variant,quantity){
 let panel=document.getElementById('scan-confirmation');
 if(!panel){
  panel=document.createElement('aside');
  panel.id='scan-confirmation';
  panel.setAttribute('role','status');
  panel.setAttribute('aria-live','polite');
  panel.setAttribute('aria-atomic','true');
  panel.style.cssText='position:fixed;z-index:1100;left:50%;top:12%;transform:translateX(-50%);width:min(90vw,440px);padding:22px 26px;border:3px solid #1e7357;border-radius:20px;background:#fff;color:#123044;box-shadow:0 18px 50px #0004;pointer-events:none;text-align:center;font:inherit';
  document.body.append(panel);
 }
 clearTimeout(scanConfirmationTimer);
 panel.replaceChildren();
 const check=document.createElement('div');check.textContent='✓ ADDED TO CART';check.style.cssText='font-size:22px;font-weight:800;color:#146547';
 const name=document.createElement('div');name.textContent=variant.product_name||'Product';name.style.cssText='font-size:28px;font-weight:800;margin:8px 0';
 const details=document.createElement('div');details.textContent=[variant.color,variant.size&&'Size '+variant.size].filter(Boolean).join(' · ');details.style.cssText='font-size:20px';
 const price=document.createElement('div');price.textContent=C.money(variantMeta.get(variant.id).price_cents);price.style.cssText='font-size:24px;font-weight:700;margin-top:8px';
 const count=document.createElement('div');count.textContent='Quantity in cart: '+quantity;count.style.cssText='font-size:15px;margin-top:6px';
 panel.append(check,name,details,price,count);
 panel.hidden=false;
 scanConfirmationTimer=setTimeout(()=>{panel.hidden=true;},1000);
}
// Keyboard-wedge barcode input. One inventory SKU per color/size variant;
// no background keystroke listener so employee typing/password fields are safe.
function scanSku(input){
 const out=by('scan-status'),search=by('scan-search');
 search.hidden=true;
 if(!user||!register||document.body.classList.contains('pos-register-closed')){
  out.textContent='Open and unlock the register before scanning.';return;
 }
 if(busy||checkout||pendingCash){out.textContent='Finish or cancel the current checkout first.';return;}
 const model=window.PersenPOSBarcodeTender;
 let code;
 try{code=model.resolveProductCode(input)}catch{
  out.textContent='This barcode is not a supported internal SKU. Use product search.';search.hidden=false;return;
 }
 let index;
 try{
  index=model.buildBarcodeIndex(stock.filter(x=>isSalesStock(x)&&hasPrice(x)&&
    /^[A-Z0-9_-]{3,64}$/.test(String(x.sku||'').trim().toUpperCase()))
    .map(x=>({productId:String(x.id),variantId:x.id,
      label:[x.product_name,x.color,x.size].filter(Boolean).join(' · '),
      unitCents:variantMeta.get(x.id).price_cents,available:x.quantity,barcode:x.sku})));
 }catch(e){
  out.textContent='Barcode configuration issue: '+e.message+'. Please check unique size SKUs in inventory.';
  return;
 }
 const match=index.get(code);
 if(!match){
  out.textContent='Product Not Found: '+code+'. Try product search.';search.hidden=false;return;
 }
 const variant=stock.find(x=>x.id===match.variantId);
 const event=events.find(e=>e.id===by('event-select').value);
 if(event){
  const profile=eventProfiles.find(p=>p.id===event.inventory_profile_id);
  const allowed=profile&&eventQuickTiles.some(t=>t.event_id===profile.id&&
    t.product_name.toLowerCase()===String(variant.product_name).toLowerCase());
  if(!allowed){out.textContent='This size is not assigned to the selected event. Change event or search its products.';return;}
 }
 const scanCart=cart.filter(x=>x.stock_id).map(x=>({productId:String(x.stock_id),variantId:x.stock_id,quantity:x.qty}));
 let result;
 try{result=model.scanCart(index,scanCart,code)}catch(e){
  out.textContent='Could not scan: '+e.message;return;
 }
 if(result.status==='sold-out'){
  const alternatives=stock.filter(x=>x.product_name===variant.product_name&&isSalesStock(x)&&hasPrice(x));
  out.textContent='Sold Out: '+match.label+'. Choose an available size.';
  pickVariant(variant.product_name,alternatives);return;
 }
 if(result.status!=='added'){out.textContent='Product Not Found. Use search.';search.hidden=false;return;}
 addVariant(variant);
 const inCart=cart.find(x=>x.stock_id===variant.id);
 if(inCart)showScanConfirmation(variant,inCart.qty);
 out.textContent=match.label+' added. '+(inCart?.qty||1)+' in cart.';
}
let scanMode='sell';
function setScanMode(mode){
 scanMode=mode==='inventory'?'inventory':'sell';
 by('scan-mode-sell').setAttribute('aria-pressed',String(scanMode==='sell'));
 by('scan-mode-inventory').setAttribute('aria-pressed',String(scanMode==='inventory'));
 by('scan-mode-sell').classList.toggle('active',scanMode==='sell');
 by('scan-mode-inventory').classList.toggle('active',scanMode==='inventory');
 by('scan-mode-sell').disabled=employeeMode==='inventory';
 by('scan-label').textContent=scanMode==='inventory'?'Scan a barcode to check inventory':'Scan product barcode to add to cart';
 by('scan-submit').textContent=scanMode==='inventory'?'Check inventory':'Add scanned item';
 by('scan-status').textContent=scanMode==='inventory'?'Inventory check mode — scans do not add products to the cart.':'Add-to-cart mode — scans add products to the sale.';
 by('scan-inventory-result').hidden=true;
 by('scan-search').hidden=true;
 document.body.dataset.salesSearch='false';
 by('scan-code').value='';
 by('scan-code').focus();
}
function checkInventorySku(input){
 const out=by('scan-status'),panel=by('scan-inventory-result');
 panel.replaceChildren();panel.hidden=true;
 by('scan-search').hidden=true;
 if(!user||!register){out.textContent='Sign in before checking inventory.';return;}
 let result;
 try{result=window.PersenPOSBarcodeTender.lookupInventory(stock,input)}
 catch(e){out.textContent='Unable to check barcode: '+e.message;return;}
 if(result.status==='not-found'){
  out.textContent='No inventory found for '+result.code+'. Check the SKU or refresh products.';
  return;
 }
 const v=result.variant,meta=variantMeta.get(v.id);
 const reserved=cart.find(x=>x.stock_id===v.id)?.qty||0;
 const available=Number(v.quantity)||0;
 const price=isSalesStock(v)&&hasPrice(v)&&meta&&Number.isSafeInteger(meta.price_cents)?C.money(meta.price_cents):'Not priced for sale';
 const heading=document.createElement('strong');
 heading.className='pos-inventory-name';heading.textContent=v.product_name||'Unnamed item';
 const details=document.createElement('dl');
 for(const [name,value] of [
  ['Color',v.color||'Not specified'],['Size',v.size||'One Size'],
  ['In stock',String(available)],['Already in cart',String(reserved)],
  ['Available for this sale',String(Math.max(0,available-reserved))],
  ['Selling price',price],['Barcode / SKU',v.sku]
 ]){
  const dt=document.createElement('dt'),dd=document.createElement('dd');
  dt.textContent=name;dd.textContent=value;details.append(dt,dd);
 }
 const state=document.createElement('p');state.className='pos-inventory-availability';
 state.textContent=available>0?'In stock — read-only lookup':'Out of stock — read-only lookup';
 panel.append(heading,details,state);panel.hidden=false;
 out.textContent='Inventory checked. Nothing was added to the cart.';
}
by('scan-mode-sell').addEventListener('click',()=>setScanMode('sell'));
by('scan-mode-inventory').addEventListener('click',()=>setScanMode('inventory'));
by('show-product-search').addEventListener('click',()=>{
 const opening=document.body.dataset.salesSearch!=='true';
 document.body.dataset.salesSearch=opening?'true':'false';
 by('show-product-search').textContent=opening?'Hide product search':'Search products';
 if(opening)by('search').focus({preventScroll:true});
 else by('scan-code').focus({preventScroll:true});
});
by('scan-search').addEventListener('click',()=>{
 document.body.dataset.salesSearch='true';
 by('show-product-search').textContent='Hide product search';
 by('search').focus({preventScroll:true});
});
by('scan-form').addEventListener('submit',e=>{
 e.preventDefault();
 const field=by('scan-code');
 if(scanMode==='inventory')checkInventorySku(field.value);
 else scanSku(field.value);
 field.value='';field.focus();
});
/* HID Bluetooth/USB scanners: capture rapid characters only when
   focus is outside text fields; staff PIN/password typing stays untouched. */
let wedgeBuffer='',wedgeStart=0,wedgeLast=0;
window.addEventListener('keydown',e=>{
 if(e.ctrlKey||e.metaKey||e.altKey||e.isComposing)return;
 if(document.body.classList.contains('pos-register-closed')||checkout||busy||pendingCash)return;
 const focused=document.activeElement;
 if(focused&&(focused.matches('input,textarea,select')||focused.isContentEditable))return;
 const now=performance.now();
 if(e.key==='Enter'){
  if(wedgeBuffer.length>=3&&now-wedgeStart<=2300&&now-wedgeLast<=300){
   e.preventDefault();if(scanMode==='inventory')checkInventorySku(wedgeBuffer);else scanSku(wedgeBuffer);
  }
  wedgeBuffer='';wedgeStart=0;wedgeLast=0;return;
 }
 if(!/^[a-zA-Z0-9_-]$/.test(e.key)){wedgeBuffer='';return;}
 if(!wedgeBuffer||now-wedgeLast>95){wedgeBuffer='';wedgeStart=now;}
 wedgeBuffer+=e.key;wedgeLast=now;
 if(wedgeBuffer.length>64){wedgeBuffer='';wedgeStart=0;}
});
function labelCsvCell(value){
 const source=String(value??'').slice(0,160);
 const safe=/^[=+@\-\t\r]/.test(source)?"'"+source:source;
 return '"'+safe.replace(/"/g,'""')+'"';
}
function exportBarcodeLabels(){
 // This is a CSV import for DYMO Connect on the owner's computer, NOT direct printer control.
 try{
  if(!user||!register||!stock.length)throw Error('Sign in and load products first.');
  const used=new Set(),rows=[['Barcode Code128','Product','Color','Size']];
  for(const item of stock.filter(isSalesStock)){
   const code=window.PersenPOSBarcodeTender.tagCodeForSku(item.sku);
   if(!/^[A-Z0-9]/.test(code))throw Error('Barcode must start with a letter or number: '+code);
   if(used.has(code))throw Error('Duplicate size/variant barcode: '+code);
   used.add(code);
   rows.push([code,item.product_name,item.color||'',item.size||'One Size']);
  }
  if(rows.length<2)throw Error('No sales inventory variants to export.');
  const csv=rows.map(row=>row.map(labelCsvCell).join(',')).join('\r\n')+'\r\n';
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
  const a=document.createElement('a');a.href=url;a.download='persen-variant-barcodes.csv';
  a.hidden=true;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
  notice((rows.length-1)+' unique product-size codes exported. Print as Code128 using DYMO desktop, then scan a physical test label.');
 }catch(e){notice('Barcode CSV export unavailable: '+e.message)}
}
by('barcode-csv').addEventListener('click',exportBarcodeLabels);
by('scan-search').addEventListener('click',()=>{
 const field=by('search');field.focus();by('scan-search').hidden=true;
});
by('search').oninput=draw;by('custom').onsubmit=e=>{e.preventDefault();if(!window.PersenPOSSwivel?.canUseRegister?.())return notice('Employee shift required.');if(employeeMode==='inventory')return notice('Inventory Check is read-only.');if(activeStaffRole()!=='owner')return notice('Custom items require owner approval.');if(checkout)return notice('Close current checkout first');try{const f=new FormData(e.target);cart.push({stock_id:null,name:String(f.get('name')).trim(),size:'',color:'',qty:1,unit_cents:C.cents(f.get('price')),service:'Other',taxable:false});e.target.reset();draw()}catch(err){notice(err.message)}};
by('discount').oninput=draw;
document.querySelectorAll('[data-discount]').forEach(b=>b.onclick=()=>{if(checkout||employeeMode==='inventory'||activeStaffRole()==='cashier')return notice('Discount changes require owner Sales access.');by('discount').value=b.dataset.discount;draw()});
by('clear-cart').onclick=()=>{if(employeeMode==='inventory')return notice('Inventory Check is read-only.');if(checkout||pendingCash)return notice('Finish the current order first.');if(!cart.length)return;if(!window.confirm('Clear all items from this cart?'))return;cart=[];draw();notice('Cart cleared. Customer display will reset.')};
by('start').onclick=begin;by('cancel').onclick=cancel;by('checkout-cancel-quick').onclick=cancel;by('cash').onclick=cash;by('finish-order').onclick=finishOrder;
for(const [buttonId,value,label] of [['copy-venmo','@persenapparel','Venmo username']]){
 by(buttonId).onclick=async()=>{try{
  await navigator.clipboard.writeText(value);
  notice(label+' copied. Verify the customer is sending to an approved account.');
 }catch{notice('Unable to copy. The payment details are shown in the reference panel.');}};
}
by('templates').onchange=()=>{const t=templates.find(x=>x.id===by('templates').value);if(t)showTemplate(t)};
by('save-template').onclick=saveTemplate;by('print').onclick=()=>{if(!lastSale)return notice('No completed sale to print');if(!window.confirm('The Epson station may already have printed this receipt. After checking the printer and queue, print a browser BACKUP copy?'))return;receipt();window.print()};
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

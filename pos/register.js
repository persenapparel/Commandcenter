'use strict';
const C=window.PersenPOSCore,R=window.PersenPOSReceipt,by=id=>document.getElementById(id);let db,user,register,checkout=null,stock=[],cart=[],templates=[],lastSale=null,season=null;let busy=false,poll;let events=[],sales=[];let reviewLink='';const EV=window.PersenPOSEvents,CASH=window.PersenPOSCash;let drawer={},drawerConfigured=false,drawerVersion=0,tenderBills={},manualTender=false;
const notice=s=>by('notice').textContent=s;
const check=async q=>{const {data,error}=await q;if(error)throw error;return data};
const row=(name,price,action,meta)=>{const div=document.createElement('div');div.className='product';const left=document.createElement('div');left.textContent=name;const sm=document.createElement('small');sm.textContent=meta||'';left.append(sm);const btn=document.createElement('button');btn.textContent=price;btn.onclick=action;div.append(left,btn);return div};
function current(){return C.totals(cart,Number(by('discount').value),C.taxMilli(by('tax').value));}
function draw(){
 by('catalog').replaceChildren();const q=by('search').value.toLowerCase();
 stock.filter(x=>[x.product_name,x.sku,x.color,x.size].join(' ').toLowerCase().includes(q)).forEach(x=>{
 const item=cart.find(c=>c.stock_id===x.id);const remaining=x.quantity-(item?.qty||0);
 const r=row(x.product_name||x.sku,'Add',()=>{if(checkout)return notice('Finish or cancel the open checkout first');if(remaining<=0)return notice('No stock available');if(item)item.qty++;else cart.push({stock_id:x.id,name:x.product_name||x.sku,color:x.color,size:x.size,qty:1,unit_cents:0,service:'Apparel',taxable:true});draw();},[x.sku,x.color,x.size,'Available: '+remaining].join(' · '));
 const btn=r.querySelector('button');btn.disabled=remaining<=0;by('catalog').append(r);
 });
 by('cart').replaceChildren();
 for(const [i,x] of cart.entries()){
 const r=document.createElement('div');r.className='cart-row';const title=document.createElement('div');title.textContent=x.name+' '+[x.color,x.size].filter(Boolean).join(' / ');
 const qty=document.createElement('input');qty.type='number';qty.min=1;qty.max=999;qty.value=x.qty;qty.style.width='65px';qty.setAttribute('aria-label','Quantity for '+x.name);qty.disabled=!!checkout;qty.onchange=()=>{x.qty=Math.max(1,Math.min(999,Number(qty.value)||1));draw()};
 const price=document.createElement('input');price.type='number';price.min=0;price.max=100000;price.step='.01';price.value=(x.unit_cents/100).toFixed(2);price.style.width='100px';price.setAttribute('aria-label','Unit price for '+x.name);price.disabled=!!checkout;price.onchange=()=>{try{x.unit_cents=C.cents(price.value);draw()}catch(e){notice(e.message)}};
 const service=document.createElement('select');service.className='service-picker';service.setAttribute('aria-label','Service category for '+x.name);service.disabled=!!checkout;for(const v of EV.services){const option=document.createElement('option');option.value=v;option.textContent=v;service.append(option);}service.value=x.service||'Other';service.onchange=()=>{x.service=service.value;};
 const remove=document.createElement('button');remove.textContent='×';remove.disabled=!!checkout;remove.onclick=()=>{cart.splice(i,1);draw()};r.append(title,qty,price,service,remove);by('cart').append(r);
 }
 try{by('total').textContent=C.money(current().total_cents)}catch(e){notice(e.message)}
 by('start').disabled=!!checkout||!cart.length;by('cancel').disabled=!checkout;
 by('discount').disabled=!!checkout;by('tax').disabled=!!checkout;renderCash();
}
async function loadStock(){stock=await check(db.from('stock_items').select('id,sku,product_name,color,size,quantity,reorder_at').order('sku').limit(1000));draw()}
async function loadTemplates(){templates=await check(db.from('pos_receipt_templates').select('*').eq('owner_id',user.id).order('updated_at',{ascending:false}));by('templates').replaceChildren();for(const t of templates){const opt=document.createElement('option');opt.value=t.id;opt.textContent=t.name;by('templates').append(opt)}const t=templates.find(x=>x.active)||templates[0];if(t){by('templates').value=t.id;showTemplate(t)}}
function showTemplate(t){by('template-name').value=t.name;by('headline').value=t.headline;by('promotion').value=t.promotion;by('footer').value=t.footer;by('review-message').value=t.review_message||R.DEFAULTS.review;by('receipt-seasonal').checked=t.show_seasonal!==false;by('receipt-review').checked=t.show_review!==false}
async function ensureRegister(){const regs=await check(db.from('pos_registers').select('*').eq('owner_id',user.id).eq('active',true).order('created_at').limit(1));register=regs[0]||await check(db.from('pos_registers').insert({owner_id:user.id,label:'Persen POS register'}).select('*').single());}
async function status(){if(!register||busy)return;try{const list=await check(db.from('pos_checkouts').select('id,status,created_at,total_cents').eq('register_id',register.id).order('created_at',{ascending:false}).limit(1));const c=list[0];checkout=c&&['awaiting_customer','contact_received'].includes(c.status)?c:null;
 by('status').textContent=c?({awaiting_customer:'Waiting for customer phone number',contact_received:'Customer ready · waiting for cashier cash confirmation',completed:'Sale complete · receipt ready',cancelled:'Checkout cancelled'}[c.status]||c.status):'Ready for next customer';
 draw();
 }catch(e){notice('Connection lost: '+e.message)}}
async function begin(){if(busy||checkout)return;busy=true;try{const payload=cart.map(x=>({stock_id:x.stock_id||null,name:x.name,qty:x.qty,unit_cents:x.unit_cents,service:EV.serviceName(x.service),taxable:x.taxable}));const bps=Math.round(C.percent(by('discount').value)*100),tax=C.taxMilli(by('tax').value);const id=await check(db.rpc('pos_begin_checkout',{p_register:register.id,p_items:payload,p_discount_bps:bps,p_tax_milli:tax,p_event:by('event-select').value||null}));checkout={id,status:'awaiting_customer'};notice('Checkout sent to customer display.');}catch(e){notice(e.message)}finally{busy=false;draw();await status()}}
async function cancel(){if(!checkout||busy)return;busy=true;try{await check(db.rpc('pos_cancel_checkout',{p_checkout:checkout.id}));checkout=null;resetTender();notice('Checkout cancelled')}catch(e){notice(e.message)}finally{busy=false;await status()}}
async function cash(){if(!checkout||checkout.status!=='contact_received'||busy)return;busy=true;try{const tendered=cashCents();if(tendered===null)throw Error('Enter the money you physically received.');const plan=CASH.plan(checkout.total_cents,tendered,drawer,drawerConfigured,manualTender?tenderBills:{});
if(!['ready','exact','exact_unconfigured'].includes(plan.status))throw Error('Cannot confirm: '+plan.status+'. Check your cash drawer.');
const id=await check(db.rpc('pos_complete_cash',{p_checkout:checkout.id,p_tender_cents:tendered,p_received_breakdown:manualTender?tenderBills:{}}));const saved=await check(db.from('pos_sales').select('id,snapshot,subtotal_cents,discount_cents,tax_cents,total_cents,tendered_cents,change_cents,change_breakdown,created_at').eq('id',id).single());lastSale={id:saved.id,cart:saved.snapshot.items,totals:saved,time:new Date(saved.created_at)};receipt();checkout=null;cart=[];resetTender();await Promise.all([loadStock(),loadSales(),reloadDrawer()]);notice('Cash sale recorded. Receipt queued for your Windows print station; manual reprint also available.')}catch(e){notice(e.message)}finally{busy=false;await status()}}
function receipt(){if(!lastSale)return;by('receipt').hidden=false;by('receipt-id').textContent='CASH SALE '+lastSale.id.slice(0,8).toUpperCase()+' · '+lastSale.time.toLocaleString();by('receipt-items').replaceChildren();for(const x of lastSale.cart){const line=document.createElement('div');line.className='receipt-line';const a=document.createElement('span');a.textContent=x.qty+' × '+x.name+' '+x.size;const b=document.createElement('span');b.textContent=C.money(x.qty*x.unit_cents);line.append(a,b);by('receipt-items').append(line)}by('receipt-subtotal').textContent=C.money(lastSale.totals.subtotal_cents);by('receipt-discount').textContent='−'+C.money(lastSale.totals.discount_cents);by('receipt-tax').textContent=C.money(lastSale.totals.tax_cents);by('receipt-total').textContent=C.money(lastSale.totals.total_cents);by('receipt-cash-tendered').textContent=C.money(lastSale.totals.tendered_cents);by('receipt-cash-change').textContent=C.money(lastSale.totals.change_cents);const cfg=R.presentation({headline:by('headline').value,promotion:by('promotion').value,footer:by('footer').value,review:by('review-message').value,reviewLink:reviewLink,showReview:by('receipt-review').checked,showSeason:by('receipt-seasonal').checked,season});by('receipt-headline').textContent=cfg.headline;by('receipt-season-message').textContent=cfg.seasonal;by('receipt-season-message').hidden=!cfg.seasonal;by('receipt-promo').textContent=cfg.promotion;by('receipt-footer').textContent=cfg.footer;by('receipt-review-message').textContent=cfg.review_url?cfg.review:'';by('receipt-review-message').hidden=!cfg.review_url;const a=by('receipt-review-url');a.hidden=!cfg.review_url;if(cfg.review_url){a.href=cfg.review_url;a.textContent=cfg.review_url.split('://').slice(1).join('://')}else{a.removeAttribute('href');a.textContent=''};}
async function saveTemplate(){try{const id=by('templates').value;const payload={owner_id:user.id,name:by('template-name').value.trim(),headline:by('headline').value,promotion:by('promotion').value,footer:by('footer').value,review_message:by('review-message').value,show_seasonal:by('receipt-seasonal').checked,show_review:by('receipt-review').checked,active:false,updated_at:new Date().toISOString()};if(!payload.name)throw Error('Template name required');if(id)await check(db.from('pos_receipt_templates').update(payload).eq('id',id));else await check(db.from('pos_receipt_templates').insert(payload));await loadTemplates();notice('Receipt template saved. Historical sale amounts are unchanged.')}catch(e){notice(e.message)}}
async function boot(){try{if(!window.PA?.ready)throw Error('Supabase connection unavailable');db=PA.db;user=await PA.me();if(!user){notice('Sign in with your Command Center account');return}if(!await PA.isAdmin(user))throw Error('This account is not authorized for Persen POS');by('auth').hidden=true;by('workspace').hidden=false;await ensureRegister();await Promise.all([loadStock(),loadTemplates(),loadEvents(),loadSales(),reloadDrawer()]);try{const contents=await check(db.from('site_content').select('key,value').in('key',['seasonal_campaigns_v1','v54_google_reviews']));const dict=Object.fromEntries((contents||[]).map(x=>[x.key,x.value]));season=C.season(dict.seasonal_campaigns_v1);reviewLink=R.reviewUrl(dict.v54_google_reviews);if(season){document.documentElement.style.setProperty('--pos-season',C.safeHex(season.accent));by('seasonal-status').textContent='Active: '+season.title+' — receipt and display promotions';notice('Seasonal Studio connected: '+season.title)}else{by('seasonal-status').textContent='No published active campaign — classic receipt and customer display'}if(!reviewLink)notice('Google review link not configured in Command Center Site Studio; review invitation hidden until configured.')}catch(err){by('seasonal-status').textContent='Seasonal Studio temporarily unavailable';}by('pairing').textContent='Customer display link ready (treat as a private device credential).';await status();poll=setInterval(status,1800);db.channel('pos-owner-'+register.id).on('postgres_changes',{event:'*',schema:'public',table:'pos_checkouts',filter:'register_id=eq.'+register.id},status).subscribe();}catch(e){notice(e.message)}}

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
 drawReport();
}
async function loadEvents(){
 events=await check(db.from('pos_events').select('id,name,event_date,venue,status,created_at').order('event_date',{ascending:false}).limit(300));
 fillEventSelectors();
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
  if(!name||name.length>100||!/^\\d{4}-\\d{2}-\\d{2}$/.test(date))throw Error('Enter an event name and valid date');
  const result=await check(db.from('pos_events').insert({owner_id:user.id,name,event_date:date,venue,status:'open'}).select('id').single());
  await loadEvents();
  by('event-select').value=result.id;by('report-event').value=result.id;drawReport();e.currentTarget.reset();notice('Event created. New checkouts will count toward '+name+'.');
 }catch(err){notice('Unable to create event: '+err.message)}finally{btn.disabled=false}
}
by('new-event').addEventListener('submit',createEvent);
by('report-event').addEventListener('change',drawReport);


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
 const inputAllowed=!!checkout&&!busy;
 const allowed=!!checkout&&checkout.status==='contact_received'&&!busy;
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
by('start').onclick=begin;by('cancel').onclick=cancel;by('cash').onclick=cash;
by('pair').onclick=async()=>{if(!register)return;const link=new URL('display.html',location.href);link.searchParams.set('pair',register.display_secret);try{await navigator.clipboard.writeText(link.href);notice('Private iPad display link copied. Open it in Safari on the customer iPad.')}catch{notice('Unable to copy link; use a secure pairing workflow before launch.')}};
by('templates').onchange=()=>{const t=templates.find(x=>x.id===by('templates').value);if(t)showTemplate(t)};
by('save-template').onclick=saveTemplate;by('print').onclick=()=>{if(!lastSale)return notice('No completed sale to print');receipt();window.print()};
createBillButtons();boot();
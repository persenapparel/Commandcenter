/* Offline, deterministic fake Supabase transport for interactive browser E2E only.
   Never deployed to Cloudflare, never uses production customer data. */
(function(){
'use strict';
const KEY='PERSEN_POS_E2E_DB_V1',USER='11111111-1111-4111-8111-111111111111';
const PAIR='22222222-2222-4222-8222-222222222222';
const REG='33333333-3333-4333-8333-333333333333';
const today=new Date().toISOString(),clone=x=>structuredClone(x);
const seed=()=>({
 seq:1,
 tables:{
 admin_users:[{user_id:USER}],
 stock_items:[{id:'44444444-4444-4444-8444-444444444444',sku:'XMAS-RED-M',product_name:'Christmas Hoodie',color:'Red',size:'M',quantity:3,reorder_at:1},{id:'55555555-5555-4555-8555-555555555555',sku:'XMAS-RED-L',product_name:'Christmas Hoodie',color:'Red',size:'L',quantity:2,reorder_at:1}],
 pos_variant_details:[{stock_id:'44444444-4444-4444-8444-444444444444',price_cents:4000,taxable:true,category:'Apparel',product_type:'hoodie',description:''},{stock_id:'55555555-5555-4555-8555-555555555555',price_cents:4000,taxable:true,category:'Apparel',product_type:'hoodie',description:''}],
 pos_registers:[{id:REG,owner_id:USER,active:true,display_secret:PAIR,display_expires_at:null,label:'Front register',cash_drawer:{},drawer_version:0,drawer_configured:false,created_at:today}],
 pos_checkouts:[],pos_sales:[],pos_print_jobs:[],pos_events:[],
 inventory_catalog:[{name:'Christmas Hoodie',inventory_type:'sales',price_cents:4000,is_active:true}],inventory_event_profiles:[],inventory_event_quick_products:[],
 pos_receipt_templates:[{id:'66666666-6666-4666-8666-666666666666',owner_id:USER,name:'Default',headline:'THANK YOU!',promotion:'persenapparel.com',footer:'Shop local',active:true,updated_at:today}],
 site_content:[],pos_drawer_recounts:[]
 }});
function get(){try{return JSON.parse(localStorage.getItem(KEY))||seed()}catch{return seed()}}
function save(x){localStorage.setItem(KEY,JSON.stringify(x))}
function newid(x){x.seq++;return '77777777-7777-4777-8777-'+String(x.seq).padStart(12,'0')}
function result(data){return Promise.resolve({data:clone(data),error:null})}
function fail(s){return Promise.resolve({data:null,error:{message:String(s)}})}
function query(table){
 const filters=[],orders=[];let action='read',payload=null,single=null,max=null;
 const q={
 select(){return q},eq(col,val){filters.push(x=>String(x[col])===String(val));return q},
 in(col,vals){filters.push(x=>vals.includes(x[col]));return q},
 gte(col,val){filters.push(x=>String(x[col])>=String(val));return q},
 order(col,opts={}){orders.push({col,asc:opts.ascending!==false});return q},
 limit(n){max=n;return q},
 single(){single='one';return q},maybeSingle(){single='maybe';return q},
 insert(row){action='insert';payload=row;return q},
 update(row){action='update';payload=row;return q},
 upsert(row){action='upsert';payload=row;return q},
 delete(){action='delete';return q},
 then(resolve,reject){return (async()=>{
  const state=get();let rows=state.tables[table];
  if(!rows)return {data:null,error:{message:'Mock unknown table '+table}};
  let selected=rows.filter(x=>filters.every(fn=>fn(x)));
  if(action==='read'){
   for(const ord of orders)selected.sort((a,b)=>ord.asc?String(a[ord.col]||'').localeCompare(String(b[ord.col]||'')):String(b[ord.col]||'').localeCompare(String(a[ord.col]||'')));
   if(max!=null)selected=selected.slice(0,max);
  }else if(action==='insert'){
   selected=(Array.isArray(payload)?payload:[payload]).map(row=>({...clone(row),id:row.id||newid(state),created_at:row.created_at||new Date().toISOString()}));
   rows.push(...selected);save(state);
  }else if(action==='update'){
   for(const row of selected)Object.assign(row,clone(payload));save(state);
  }else if(action==='delete'){
   const set=new Set(selected);
   state.tables[table]=rows.filter(x=>!set.has(x));save(state);
  }else if(action==='upsert'){
   let key=table==='pos_variant_details'?'stock_id':'id';
   const match=rows.find(x=>x[key]===payload[key]);
   if(match){Object.assign(match,clone(payload));selected=[match];}
   else{const row={...clone(payload),id:payload.id||newid(state)};rows.push(row);selected=[row]}
   save(state);
  }
  if(single){if(!selected.length)return {data:null,error:single==='one'?{message:'Mock expected one row'}:null};
   return {data:clone(selected[0]),error:null}
  }
  return {data:clone(selected),error:null};
 })().then(resolve,reject)}
 };
 return q;
}
function rpc(name,p={}){
 const state=get(),t=state.tables,reg=t.pos_registers[0];
 const match=t.pos_checkouts.find(x=>x.id===p.p_checkout);
 const write=x=>{save(state);return result(x)};
 switch(name){
 case 'pos_create_product_group':{
  const sizes=p.p_sizes||{};let n=0;
  for(const [size,quantity] of Object.entries(sizes)){if(Number(quantity)<=0)continue;const id=newid(state);
   t.stock_items.push({id,sku:'E2E-'+id.slice(-8),product_name:p.p_name,color:p.p_color,size,quantity:Number(quantity),reorder_at:5,supplier:p.p_supplier});
   t.pos_variant_details.push({stock_id:id,price_cents:p.p_price_cents,taxable:p.p_taxable,category:p.p_category,product_type:p.p_type,description:''});n++}
  if(!t.inventory_catalog.some(x=>x.name.toLowerCase()===String(p.p_name).toLowerCase()))t.inventory_catalog.push({name:p.p_name,inventory_type:'sales',price_cents:p.p_price_cents,is_active:true});
  return write(n);
 }
 case 'inventory_save_size_grid':{
  const name=String(p.p_name||'').trim();
  if(!name)return fail('Product name required');
  let catalog=t.inventory_catalog.find(x=>x.name.toLowerCase()===name.toLowerCase());
  if(!catalog){catalog={name,inventory_type:p.p_type,price_cents:p.p_price_cents,is_active:true};t.inventory_catalog.push(catalog)}
  else Object.assign(catalog,{inventory_type:p.p_type,price_cents:p.p_price_cents,is_active:true});
  for(const row of p.p_items||[]){
   let item=t.stock_items.find(x=>x.product_name.toLowerCase()===name.toLowerCase()&&String(x.color||'').toLowerCase()===String(row.color||'').toLowerCase()&&String(x.size||'').toUpperCase()===String(row.size||'').toUpperCase());
   if(item){item.quantity=Number(row.quantity)}
   else if(Number(row.quantity)>0){const id=newid(state);item={id,sku:'GRID-'+id.slice(-8),product_name:name,color:row.color,size:row.size,quantity:Number(row.quantity),reorder_at:5};t.stock_items.push(item)}
   if(item){let detail=t.pos_variant_details.find(x=>x.stock_id===item.id);if(detail)detail.price_cents=p.p_price_cents;else t.pos_variant_details.push({stock_id:item.id,price_cents:p.p_price_cents,taxable:true,category:'Apparel',product_type:p.p_type})}
  }
  return write(true);
 }
 case 'pos_update_product_variant':{
  const item=t.stock_items.find(x=>x.id===p.p_stock),detail=t.pos_variant_details.find(x=>x.stock_id===p.p_stock);
  if(!item||!detail)return fail('Product not found');
  Object.assign(item,{product_name:p.p_name,color:p.p_color,size:p.p_size,quantity:p.p_quantity});
  Object.assign(detail,{price_cents:p.p_price_cents,taxable:p.p_taxable,category:p.p_category,product_type:p.p_type});
  return write(true);
 }
 case 'pos_save_event_selection':{
  const existing=t.pos_events.find(x=>x.id===p.p_event);
  const name=String(p.p_name||existing?.name||'').trim();
  if(!name||(p.p_names||[]).length===0)return fail('Event and products required');
  const event=existing||{id:newid(state),owner_id:USER,name,event_date:p.p_date,venue:'',status:'open'};
  if(!existing)t.pos_events.push(event);
  event.name=name;event.event_date=p.p_date;
  let profile=t.inventory_event_profiles.find(x=>x.id===event.inventory_profile_id);
  if(!profile){profile={id:newid(state),name,event_date:p.p_date,active:true};t.inventory_event_profiles.push(profile)}
  profile.name=name;profile.event_date=p.p_date;event.inventory_profile_id=profile.id;
  t.inventory_event_quick_products=t.inventory_event_quick_products.filter(x=>x.event_id!==profile.id);
  (p.p_names||[]).forEach((name,i)=>t.inventory_event_quick_products.push({event_id:profile.id,product_name:name,sort_order:i}));
  return write(event.id);
 }
 case 'pos_issue_display_pairing':reg.display_secret=PAIR;reg.display_expires_at=new Date(Date.now()+7200000).toISOString();return write(PAIR);
 case 'pos_begin_checkout':{
  if(t.pos_checkouts.some(x=>['awaiting_customer','contact_received'].includes(x.status)||(x.status==='completed'&&!x.cash_handoff_complete)))return fail('Finish the current order first');
  const subtotal=p.p_items.reduce((n,i)=>n+i.qty*i.unit_cents,0);
  const discount=Math.round(subtotal*(p.p_discount_bps||0)/10000);
  const tax=Math.round((subtotal-discount)*(p.p_tax_milli||0)/100000);
  const checkout={id:newid(state),register_id:p.p_register,owner_id:USER,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),status:'awaiting_customer',cash_handoff_complete:false,customer_step:'phone',help_requested:false,items:clone(p.p_items),subtotal_cents:subtotal,discount_cents:discount,tax_cents:tax,total_cents:subtotal-discount+tax,payment_preference:'cash',receipt_print:true,receipt_email:false,event_id:p.p_event||null};
  t.pos_checkouts.push(checkout);return write(checkout.id);
 }
 case 'pos_cancel_checkout':if(!match)return fail('Missing checkout');match.status='cancelled';return write(true);
 case 'pos_customer_view':{
  if(p.p_secret!==reg.display_secret||!reg.display_expires_at||Date.parse(reg.display_expires_at)<Date.now())return result({status:'expired'});
  const c=t.pos_checkouts.at(-1);
  const sale=c&&c.status==='completed'?t.pos_sales.find(x=>x.checkout_id===c.id):null;
   const visibleStatus=c?.status==='completed'&&!c.cash_handoff_complete?'paid_awaiting_change':c?.status;
   return result(c?{status:visibleStatus,checkout_id:c.id,items:c.items,total_cents:c.total_cents,change_cents:sale?.change_cents||0}:{status:'idle',checkout_id:null,items:[],total_cents:0});
 }
 case 'pos_set_customer_progress':if(!match)return fail('Checkout missing');match.customer_step=p.p_step;match.help_requested=p.p_need_help;return write(true);
 case 'pos_submit_customer':if(!match)return fail('Checkout missing');Object.assign(match,{status:'contact_received',phone:p.p_phone,email:p.p_email,marketing_opt_in:p.p_marketing_opt_in,rating:p.p_rating,interest:p.p_interest,payment_preference:p.p_payment_preference,receipt_print:p.p_print_receipt,receipt_email:p.p_email_receipt});return write(true);
 case 'pos_set_cash_drawer':reg.cash_drawer=p.p_counts;reg.drawer_configured=true;reg.drawer_version++;return write({cash_drawer:reg.cash_drawer,drawer_version:reg.drawer_version});
 case 'pos_complete_cash':{
  if(!match||match.status!=='contact_received')return fail('Checkout not ready');
  if(match.payment_preference!=='cash')return fail('Only cash accepted in mock');
  if(p.p_tender_cents<match.total_cents)return fail('Underpaid');
  match.status='completed';match.cash_handoff_complete=false;
  for(const item of match.items){if(item.stock_id){const row=t.stock_items.find(x=>x.id===item.stock_id);if(row)row.quantity-=item.qty}}
  const sale={id:newid(state),checkout_id:match.id,owner_id:USER,event_id:match.event_id,snapshot:{items:match.items,receipt_print:match.receipt_print},subtotal_cents:match.subtotal_cents,discount_cents:match.discount_cents,tax_cents:match.tax_cents,total_cents:match.total_cents,tendered_cents:p.p_tender_cents,change_cents:p.p_tender_cents-match.total_cents,change_breakdown:p.p_change_breakdown||{},created_at:new Date().toISOString()};
  t.pos_sales.push(sale);
  if(match.receipt_print)t.pos_print_jobs.push({id:newid(state),sale_id:sale.id,owner_id:USER,register_id:REG,state:'queued',created_at:new Date().toISOString(),attempts:0});
  if(sessionStorage.getItem('mock-lose-cash-response')){
   sessionStorage.removeItem('mock-lose-cash-response');
   save(state);
   return fail('Lost the response after recording cash');
  }
  return write(sale.id);
 }
 case 'pos_finish_order':{
  if(!match||match.status!=='completed'||!t.pos_sales.some(x=>x.checkout_id===match.id))return fail('Paid checkout not found');
  match.cash_handoff_complete=true;return write(true);
 }
 case 'pos_claim_print_job':{
  const job=t.pos_print_jobs.find(j=>j.id===p.p_job);
  if(!job||job.state!=='queued')return result(null);
  job.state='printing';job.attempts++;save(state);
  const sale=t.pos_sales.find(s=>s.id===job.sale_id);
  return result({...clone(sale),sale_id:sale.id,items:sale.snapshot.items});
 }
 case 'pos_finish_print_job':{
  const job=t.pos_print_jobs.find(j=>j.id===p.p_job);if(!job)return fail('Job missing');
  job.state=p.p_error?'failed':'submitted_to_browser';return write(true);
 }
 case 'pos_retry_print_job':{
  const job=t.pos_print_jobs.find(j=>j.id===p.p_job);if(!job)return fail('Job missing');
  job.state='queued';return write(true);
 }
 default:return fail('Mock RPC not implemented: '+name);
 }
}
const db={auth:{
 getUser:()=>result({user:get().signedOut?null:{id:USER,email:'service@persenapparel.com'}}),
 signInWithPassword:()=>{const s=get();s.signedOut=false;save(s);return result({user:{id:USER}})},
 signOut:()=>{const s=get();s.signedOut=true;save(s);return result(null)}
},from:query,rpc,channel:()=>({on(){return this},subscribe(){return this}})};
window.supabase={createClient:()=>db};
window.__POS_TEST_DB={get,set:save,reset:()=>save(seed()),USER,PAIR};
})();

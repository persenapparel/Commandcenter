/* Persen Command Center — simple owner-only inventory hub */
(()=>{'use strict';
 const SIZES=['XS','S','M','L','XL','2XL','3XL','4XL','5XL','OS'];
 let tab='blanks',search='',state=null,working=false;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const dollars=n=>'$'+(Number(n||0)/100).toFixed(2);
 const nameKey=s=>String(s||'').trim().toLowerCase();
 const $=(parent,selector)=>parent.querySelector(selector);
 const $$=(parent,selector)=>[...parent.querySelectorAll(selector)];
 const node=(tag,cls,txt)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(txt!==undefined)el.textContent=txt;return el};
 async function checked(query){const r=await query;if(r.error)throw r.error;return r.data}
 function note(text){const e=document.querySelector('#inventory-hub-message');if(e)e.textContent=text}
 function sum(list){return list.reduce((n,x)=>n+(Number(x.quantity)||0),0)}
 async function load(host){
  if(!window.PA?.ready||!window.PA?.db){host.textContent='Connect to your Command Center to edit inventory.';return;}
  const db=PA.db;
  const [stock,catalog,events,tiles]=await Promise.all([
   checked(db.from('stock_items').select('id,sku,product_name,color,size,quantity,reorder_at').order('product_name').limit(2500)),
   checked(db.from('inventory_catalog').select('name,inventory_type,price_cents,is_active').order('name').limit(1000)),
   checked(db.from('inventory_event_profiles').select('id,name,event_date,active').order('event_date',{ascending:false}).limit(150)),
   checked(db.from('inventory_event_quick_products').select('event_id,product_name,sort_order').order('sort_order').limit(1200))
  ]);
  state={stock,catalog,events,tiles};draw(host);
 }
 function groups(){
  const map=new Map();
  for(const c of state.catalog){map.set(nameKey(c.name),{name:c.name,meta:c,rows:[]})}
  for(const s of state.stock){const key=nameKey(s.product_name||s.sku);if(!map.has(key))map.set(key,{name:s.product_name||s.sku,meta:{inventory_type:'blanks',price_cents:null},rows:[]});map.get(key).rows.push(s)}
  return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name));
 }
 function draw(host){
  host.replaceChildren();host.className='inventory-hub';
  const header=node('header','hub-header');header.innerHTML='<div><span class="hub-eyebrow">PERSEN INVENTORY</span><h2>Everything in its place.</h2><p>One product, every size. Tap the pencil to edit quantities.</p></div>';
  const tabs=node('div','hub-tabs');for(const [id,label] of [['blanks','Blanks'],['sales','Sales Products'],['events','Event Quick Tiles']]){
   const b=node('button','hub-tab'+(tab===id?' selected':''),label);b.type='button';b.setAttribute('aria-pressed',String(tab===id));b.onclick=()=>{tab=id;draw(host)};tabs.append(b)
  }header.append(tabs);host.append(header);
  const status=node('p','hub-status');status.id='inventory-hub-message';status.setAttribute('role','status');status.setAttribute('aria-live','polite');host.append(status);
  if(tab==='events'){showEvents(host);return}
  const items=groups().filter(x=>(x.meta.inventory_type||'blanks')===tab);
  const total=sum(items.flatMap(x=>x.rows));
  const summary=node('div','hub-summary');summary.innerHTML='<span><strong>'+items.length+'</strong><small>Products</small></span><span><strong>'+total+'</strong><small>Units on hand</small></span><span><strong>'+items.reduce((n,x)=>n+x.rows.filter(r=>r.quantity>0).length,0)+'</strong><small>Sizes in stock</small></span>';host.append(summary);
  const tools=node('div','hub-toolbar');
  const searchInput=node('input','field');searchInput.type='search';searchInput.placeholder='Find a product';searchInput.value=search;searchInput.setAttribute('aria-label','Search inventory products');searchInput.oninput=()=>{search=searchInput.value;showCards(host)};tools.append(searchInput);
  const add=node('button','btn primary sm','+ Add Product');add.type='button';add.onclick=()=>editor(host,null);tools.append(add);
  host.append(tools);
  const list=node('div','hub-cards');list.id='hub-card-list';host.append(list);showCards(host);
 }
 function showCards(host){
  const list=$(host,'#hub-card-list');if(!list)return;list.replaceChildren();
  const items=groups().filter(x=>(x.meta.inventory_type||'blanks')===tab&&x.name.toLowerCase().includes(search.trim().toLowerCase()));
  if(!items.length){list.append(node('p','hub-empty',search?'No products matched your search.':'Nothing here yet. Use + Add Product to begin.'));return}
  for(const g of items){
   const card=node('article','hub-product');
   const top=node('div','hub-product-top');
   const info=node('div');const title=node('h3','',g.name);info.append(title);
   const units=sum(g.rows),colors=[...new Set(g.rows.map(x=>x.color).filter(Boolean))];
   info.append(node('p','',units+' total · '+(colors.length?colors.join(' / '):'No color set')+(tab==='sales'?' · '+(g.meta.price_cents!=null?dollars(g.meta.price_cents):'Set selling price'):'')));
   const button=node('button','hub-pencil','✎ Edit');button.type='button';button.setAttribute('aria-label','Edit '+g.name+' stock and sizes');button.onclick=()=>editor(host,g);top.append(info,button);card.append(top);
   const bySize=new Map(SIZES.map(x=>[x,0]));for(const r of g.rows)bySize.set(r.size.toUpperCase(),(bySize.get(r.size.toUpperCase())||0)+r.quantity);
   const pills=node('div','hub-size-pills');for(const size of SIZES){const count=bySize.get(size)||0;if(!count)continue;const el=node('span','hub-size-chip',size+'  '+count);pills.append(el)}
   if(!pills.childElementCount)pills.append(node('span','hub-size-chip','No stock on hand'));
   card.append(pills);list.append(card)
  }
 }
 function editor(host,group){
  if(working)return;
  const old=$(host,'.hub-editor');if(old)old.remove();
  const wrap=node('section','hub-editor');wrap.setAttribute('aria-label','Edit product and size quantities');
  const heading=node('div','hub-editor-heading');heading.append(node('h3','',group?'Edit '+group.name:'New '+(tab==='sales'?'sales product':'blank product')));
  const cancel=node('button','btn ghost sm','Cancel');cancel.type='button';cancel.onclick=()=>wrap.remove();heading.append(cancel);wrap.append(heading);
  const form=node('form','hub-edit-form');
  const nameLabel=node('label','hub-field');nameLabel.append(node('span','', 'Product name'));
  const nameInput=node('input','field');nameInput.name='name';nameInput.required=true;nameInput.maxLength=140;nameInput.value=group?.name||'';nameInput.readOnly=!!group;nameInput.placeholder='e.g. Christmas Hoodie';nameLabel.append(nameInput);form.append(nameLabel);
  const categoryLabel=node('label','hub-field');categoryLabel.append(node('span','','Inventory type'));
  const category=node('select','select');category.name='inventory_type';
  for(const [value,label] of [['blanks','Blank apparel / supplies'],['sales','Finished products for sale']]){const option=node('option','',label);option.value=value;category.append(option)}
  category.value=group?.meta.inventory_type||tab;categoryLabel.append(category);form.append(categoryLabel);
  const priceLabel=node('label','hub-field');priceLabel.append(node('span','','Selling price ($)'));
  const price=node('input','field');price.type='number';price.min=0;price.max=1000000;price.step='0.01';price.inputMode='decimal';price.value=group?.meta.price_cents!=null?(group.meta.price_cents/100).toFixed(2):'';price.placeholder='e.g. 25.00';priceLabel.append(price);form.append(priceLabel);
  const togglePrice=()=>{priceLabel.hidden=category.value!=='sales';price.required=category.value==='sales'};category.onchange=togglePrice;togglePrice();
  const editColors=node('div','hub-colors');form.append(editColors);
  const colorList=[...new Set((group?.rows||[]).map(x=>x.color||'Unspecified'))];if(!colorList.length)colorList.push('Unspecified');
  const showColor=color=>{
   const colorRows=(group?.rows||[]).filter(x=>nameKey(x.color||'Unspecified')===nameKey(color));
   if($$(editColors,'.hub-color').some(el=>nameKey(el.dataset.color)===nameKey(color))){note('That color is already included.');return}
   const fieldset=node('fieldset','hub-color');fieldset.dataset.color=color;fieldset.append(node('legend','',color));
   const sizeGrid=node('div','hub-size-grid');
   for(const size of SIZES){const cell=node('label','hub-size-input');cell.append(node('span','',size));const inp=node('input','field');inp.type='number';inp.min=0;inp.max=1000000;inp.step='1';inp.inputMode='numeric';inp.required=true;inp.dataset.size=size;inp.value=String(colorRows.find(x=>x.size.toUpperCase()===size)?.quantity??0);inp.setAttribute('aria-label',color+' '+size+' quantity');cell.append(inp);sizeGrid.append(cell)}
   fieldset.append(sizeGrid);editColors.append(fieldset)
  };
  colorList.forEach(showColor);
  const addColorRow=node('div','hub-add-color');const newColor=node('input','field');newColor.placeholder='Add another color (e.g. Navy)';newColor.maxLength=60;addColorRow.append(newColor);
  const addColor=node('button','btn ghost sm','+ Add Color');addColor.type='button';addColor.onclick=()=>{const val=newColor.value.trim();if(!val){note('Enter a color first.');return}if($$(editColors,'.hub-color').length>=18){note('Maximum 18 colors per edit.');return}showColor(val);newColor.value='';updatePreview()};addColorRow.append(addColor);form.append(addColorRow);
  const preview=node('div','hub-edit-total');form.append(preview);
  const updatePreview=()=>{const n=$$(editColors,'input[data-size]').reduce((a,x)=>a+(Number(x.value)||0),0);preview.textContent='TOTAL IN THIS PRODUCT: '+n+' items';};
  form.addEventListener('input',updatePreview);updatePreview();
  const save=node('button','btn primary','Save Product & Quantities');save.type='submit';form.append(save);
  form.onsubmit=async e=>{e.preventDefault();if(working)return;
   const name=nameInput.value.trim(),type=category.value;
   const cents=type==='sales'?Math.round(Number(price.value)*100):null;
   if(!name||name.length>140||type==='sales'&&(!price.value||!Number.isSafeInteger(cents)||cents<0)){note('Check the product name and price.');return}
   const rows=[];for(const fset of $$(editColors,'.hub-color'))for(const inp of $$(fset,'input[data-size]')){
    const q=Number(inp.value);if(!Number.isSafeInteger(q)||q<0||q>1000000){note('Quantities must be whole numbers between 0 and 1,000,000.');return}
    rows.push({color:fset.dataset.color,size:inp.dataset.size,quantity:q})
   }
   working=true;save.disabled=true;
   try{await checked(PA.db.rpc('inventory_save_size_grid',{p_name:name,p_type:type,p_price_cents:cents,p_items:rows}));
    await load(host);note(name+' saved. Size totals updated successfully.');
   }catch(error){note('Could not save: '+error.message);save.disabled=false}finally{working=false}
  };
  wrap.append(form);
  const target=$(host,'.hub-toolbar')||$(host,'.hub-header');target.insertAdjacentElement('afterend',wrap);wrap.scrollIntoView({behavior:'smooth',block:'nearest'});
 }
 async function showEvents(host){
  const summary=node('div','hub-event-intro');summary.innerHTML='<h3>Pick what you are selling today.</h3><p>Choose your event, check the sales products you want on the cashier quick tiles, and save. You do not need to create duplicates or move inventory.</p>';host.append(summary);
  const eventForm=node('form','hub-event-new');const name=node('input','field');name.placeholder='New event name (e.g. Rocky Point Holiday Boutique)';name.maxLength=100;name.required=true;const date=node('input','field');date.type='date';date.setAttribute('aria-label','Event date');const add=node('button','btn primary sm','+ Add Event');add.type='submit';eventForm.append(name,date,add);host.append(eventForm);
  eventForm.onsubmit=async e=>{e.preventDefault();if(working)return;working=true;add.disabled=true;try{
    const res=await checked(PA.db.from('inventory_event_profiles').insert({name:name.value.trim(),event_date:date.value||null}).select('id').single());
    await checked(PA.db.rpc('inventory_activate_event',{p_event:res.id}));await load(host);note('Event added and selected. Choose the products below.');
  }catch(err){note('Could not create event: '+err.message);add.disabled=false}finally{working=false}};
  const eventSelect=node('select','select hub-event-select');eventSelect.setAttribute('aria-label','Choose event');
  if(!state.events.length){host.append(node('p','hub-empty','Create an event above to choose its products.'));return}
  for(const ev of state.events){const opt=node('option','',ev.name+(ev.active?' · ACTIVE':''));opt.value=ev.id;eventSelect.append(opt)}
  eventSelect.value=state.events.find(x=>x.active)?.id||state.events[0].id;
  const eventBar=node('div','hub-event-bar');eventBar.append(eventSelect);
  const activate=node('button','btn ghost sm','Set as Active Event');activate.type='button';
  activate.onclick=async()=>{activate.disabled=true;try{await checked(PA.db.rpc('inventory_activate_event',{p_event:eventSelect.value}));await load(host);note('Active POS event selected.');}catch(err){note(err.message);activate.disabled=false}};
  eventBar.append(activate);host.append(eventBar);
  const pick=node('div','hub-event-products');host.append(pick);
  const save=node('button','btn primary','Save POS Quick Tiles');save.type='button';host.append(save);
  const show=()=>{
    pick.replaceChildren();const ev=eventSelect.value,selected=state.tiles.filter(x=>x.event_id===ev).sort((a,b)=>a.sort_order-b.sort_order).map(x=>x.product_name);
    const products=groups().filter(x=>x.meta.inventory_type==='sales');
    if(!products.length){pick.append(node('p','hub-empty','Add at least one Sales Product with a price first.'));save.disabled=true;return}
    save.disabled=false;
    const sortProducts=[...products].sort((a,b)=>Number(selected.includes(b.name))-Number(selected.includes(a.name))||a.name.localeCompare(b.name));
    for(const p of sortProducts){
      const label=node('label','hub-event-pick');const input=node('input');input.type='checkbox';input.value=p.name;input.name='event_product';input.checked=selected.includes(p.name);input.disabled=!(p.meta.is_active!==false&&Number(p.meta.price_cents)>0);
      const info=node('span');info.append(node('strong','',p.name));
      info.append(node('small','',sum(p.rows)+' available · '+(p.meta.price_cents!=null?dollars(p.meta.price_cents):'No price set')));
      label.append(input,info);pick.append(label);
    }
  };
  eventSelect.onchange=show;show();
  save.onclick=async()=>{if(working)return;const names=$$(pick,'input:checked').map(x=>x.value);if(!names.length){note('Select at least one product for the event.');return}if(names.length>12){note('Choose at most 12 quick-tile products.');return}
   working=true;save.disabled=true;try{await checked(PA.db.rpc('inventory_save_event_tiles',{p_event:eventSelect.value,p_names:names}));await load(host);note(names.length+' event quick tiles saved. Reload the POS register to see changes when it shares this database.');}catch(e){note('Could not save event products: '+e.message);save.disabled=false}finally{working=false}
  };
 }
 function mount(){const host=document.getElementById('inventory-hub-root');if(!host||host.dataset.hubStarted)return;host.dataset.hubStarted='true';load(host).catch(e=>{host.textContent='Inventory could not load: '+e.message})}
 function start(){new MutationObserver(mount).observe(document.getElementById('owner-app')||document.body,{childList:true,subtree:true});mount()}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();

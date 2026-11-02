/* Persen Inventory V2: owner-only product, color and size grid. */
(()=>{'use strict';
const SIZES=['XS','S','M','L','XL','2XL','3XL','4XL','5XL','OS'];
const clean=x=>String(x||'').trim();
let busy=false;
function node(tag,opts={},parent){const el=document.createElement(tag);for(const [k,v] of Object.entries(opts)){if(k==='text')el.textContent=v;else if(k==='class')el.className=v;else if(k==='style')el.style.cssText=v;else el.setAttribute(k,v);}if(parent)parent.append(el);return el;}
function field(parent,label,placeholder='',value=''){const wrap=node('label',{class:'variant-field'},parent);node('span',{text:label},wrap);const input=node('input',{class:'field',placeholder},wrap);input.value=value;return input;}
function dropdown(parent,label,options){const wrap=node('label',{class:'variant-field'},parent);node('span',{text:label},wrap);const sel=node('select',{class:'select'},wrap);for(const [value,title] of options)node('option',{value,text:title},sel);return sel;}
function btn(parent,text,fn){const b=node('button',{type:'button',class:'btn primary sm',text},parent);b.addEventListener('click',fn);return b;}
function notify(text){const e=document.querySelector('#inventory-grid-status');if(e)e.textContent=text;}
const qty=n=>Number.isSafeInteger(Number(n))&&Number(n)>=0&&Number(n)<=1000000;
const sku=()=> 'PA-'+crypto.randomUUID().slice(0,18).toUpperCase();
async function fetchRows(){const {data,error}=await PA.db.from('stock_items').select('id,sku,product_id,product_name,color,size,quantity,reorder_at').order('product_name').limit(2000);if(error)throw error;return data||[];}
function mount(){const heading=[...document.querySelectorAll('#owner-app h2')].find(x=>x.textContent.trim()==='Inventory & stock alerts');const section=heading?.closest('section');if(!section||section.dataset.variantsReady)return;section.dataset.variantsReady='yes';const host=node('section',{class:'variant-manager'},section);section.insertBefore(host,section.querySelector('form[data-form="new-stock"]'));render(host).catch(e=>notify(e.message));}
async function render(host){if(!window.PA?.db)return;const rows=await fetchRows();host.replaceChildren();
node('h3',{text:'Size & Color Inventory Manager'},host);
node('p',{text:'Manage different colors and sizes under one product. Saving replaces the quantities shown for each selected size, not quantities from another color. Existing stock remains available below.'},host);
const controls=node('div',{class:'variant-controls'},host);
const product=field(controls,'PRODUCT / STYLE','e.g. Christmas Long Island Embroidered Hoodie');
const catalog=dropdown(controls,'CATALOG TYPE',[['','General inventory'],...[...document.querySelectorAll('form[data-form="new-stock"] select[name="product_id"] option')].filter(x=>x.value).map(x=>[x.value,x.textContent])]);
const colors=field(controls,'COLORS (COMMA OR NEW LINE SEPARATED)','Red, Forest Green, Black');
const threshold=field(controls,'REORDER ALERT AT','5','5');threshold.type='number';threshold.min='0';
const existing=[...new Set(rows.map(x=>clean(x.product_name)).filter(Boolean))].sort();
if(existing.length){const pick=dropdown(controls,'LOAD EXISTING PRODUCT',[['','New product'],...existing.map(x=>[x,x])]);pick.addEventListener('change',()=>{product.value=pick.value;const samples=rows.filter(x=>x.product_name===pick.value);colors.value=[...new Set(samples.map(x=>x.color).filter(Boolean))].join(', ');catalog.value=samples.find(x=>x.product_id)?.product_id||'';threshold.value=String(samples[0]?.reorder_at??5);fill();});}
const grid=node('div',{class:'variant-matrix'},host);
const summary=node('div',{class:'owner-mini'},host);
const save=btn(host,'Save All Color & Size Quantities',async()=>{
 if(busy)return;const name=clean(product.value).slice(0,140);if(!name){notify('Enter a product name.');return;}
 const entries=[...grid.querySelectorAll('input[data-size]')].map(i=>({color:i.dataset.color,size:i.dataset.size,quantity:Number(i.value)}));
 if(!entries.length||entries.some(x=>!qty(x.quantity))||!qty(threshold.value)){notify('Check all colors, sizes and quantities.');return;}
 const current=await fetchRows();const changes=[];for(const item of entries){const match=current.find(r=>r.product_name.toLowerCase()===name.toLowerCase()&&r.color.toLowerCase()===item.color.toLowerCase()&&r.size.toLowerCase()===item.size.toLowerCase());if(match){if(match.quantity!==item.quantity||match.reorder_at!==Number(threshold.value)||match.product_id!==(catalog.value||null))changes.push({match,item});}else if(item.quantity>0)changes.push({match:null,item});}
 if(!changes.length){notify('Nothing to update.');return;}busy=true;save.disabled=true;let completed=0;
 try{for(const {match,item} of changes){const payload={product_name:name,color:item.color,size:item.size,quantity:item.quantity,reorder_at:Number(threshold.value),product_id:catalog.value||null,updated_at:new Date().toISOString()};const query=match?PA.db.from('stock_items').update(payload).eq('id',match.id):PA.db.from('stock_items').insert({...payload,sku:sku()});const {error}=await query;if(error)throw error;completed++;}notify('Saved '+completed+' variants. Refresh Inventory to update stock alerts.');}
 catch(e){notify('Saved '+completed+' variants; stopped due to: '+e.message+' . Reopen this product before retrying.');}
 finally{busy=false;save.disabled=false;}
 });
function fill(){grid.replaceChildren();const name=clean(product.value).toLowerCase();const list=[...new Set(colors.value.split(/[,\n]+/).map(clean).filter(Boolean))];if(list.length>25){notify('Maximum 25 colors at once.');return;}if(!list.length){node('p',{text:'Enter one or more colors to show the size grid.'},grid);return;}
 const table=node('table',{class:'variant-table'},grid);const head=node('tr',{},node('thead',{},table));node('th',{text:'COLOR'},head);for(const size of SIZES)node('th',{text:size},head);node('th',{text:'TOTAL'},head);
 const body=node('tbody',{},table);
 for(const color of list){const tr=node('tr',{},body);node('th',{text:color},tr);for(const size of SIZES){const td=node('td',{},tr);const i=node('input',{type:'number',min:'0',max:'1000000',class:'field', 'data-size':size,'data-color':color,'aria-label':color+' '+size},td);i.value=String(rows.find(r=>clean(r.product_name).toLowerCase()===name&&clean(r.color).toLowerCase()===color.toLowerCase()&&clean(r.size).toUpperCase()===size)?.quantity??0);i.addEventListener('input',total);}node('td',{text:'0',class:'variant-total'},tr);}
 total();}
function total(){let overall=0;for(const tr of grid.querySelectorAll('tbody tr')){let n=0;for(const el of tr.querySelectorAll('input'))n+=Number(el.value)||0;tr.querySelector('.variant-total').textContent=String(n);overall+=n;}summary.textContent='Total quantity in grid: '+overall;}
product.addEventListener('change',fill);colors.addEventListener('change',fill);btn(controls,'Build / Refresh Size Grid',fill);fill();
}
const observer=new MutationObserver(()=>{if(document.querySelector('#owner-app h2')?.textContent)mount()});
function start(){observer.observe(document.getElementById('owner-app')||document.body,{childList:true,subtree:true});mount();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
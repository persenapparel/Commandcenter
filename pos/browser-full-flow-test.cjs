/* Single-iPad cashier smoke + fail-closed security regression. LOCAL MOCK DATA ONLY. Customer payment flow is not yet enabled. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),{chromium}=require('playwright');
const root=path.resolve('pos-dist'),types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png'};
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}fs.readFile(file,(e,buf)=>e?res.writeHead(404).end():res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'}).end(buf))});
const failures=[],opened=[];
const step=async(name,fn)=>{try{await fn();console.log('PASS',name)}catch(e){console.error('FAIL',name,e.stack||e);failures.push(name+': '+e.message);throw e}};
const txt=async(p,s,t,timeout=11000)=>p.waitForFunction(({s,t})=>String(document.querySelector(s)?.textContent||'').includes(t),{s,t},{timeout});
const visible=async(p,s,timeout=11000)=>p.waitForFunction(s=>{const e=document.querySelector(s);return e&&!e.hidden&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden'},s,{timeout});
const state=p=>p.evaluate(()=>__POS_TEST_DB.get());
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port+'/';
 const browser=await chromium.launch({headless:true}),ctx=await browser.newContext({viewport:{width:1280,height:800}});
 ctx.setDefaultTimeout(6000);
 await ctx.addInitScript({path:'pos/test-fake-supabase.js'});
 await ctx.addInitScript({content:"Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async s=>localStorage.setItem('__clip',s),readText:async()=>localStorage.getItem('__clip')}});Object.defineProperty(window,'print',{configurable:true,value:()=>localStorage.setItem('__prints',String(Number(localStorage.getItem('__prints')||0)+1))});window.confirm=()=>true;"});
 await ctx.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.fulfill({status:200,contentType:'application/javascript',body:''}));
 let admin,cashier,printer;
 try{
 await step('Device dashboard routes without unsafe browser-stored PIN',async()=>{
  const p=await ctx.newPage();opened.push(p);assert.equal((await p.goto(url)).status(),200);
  await visible(p,'#device-dashboard');
  assert.equal(await p.locator('#pin-gate').count(),0);
  assert.equal(await p.locator('#pin-input').count(),0);
  assert.match(await p.locator('.test').innerText(),/Cloudflare Access/);
  for(const file of ['admin.html','register.html'])
   assert.equal(await p.locator('a[href="'+file+'"]').count(),1);
  // Do not advertise the customer-only route on the signed-in owner dashboard.
  assert.equal(await p.locator('a[href="display.html"]').count(),0);
  assert.equal((await p.request.get(url+'display.html')).status(),200,'Controlled customer route must remain bundled');
   assert.equal(await p.locator('a[href="admin.html#print-center"]').count(),1,'Epson Print Center must be on the dashboard');
  await p.reload();await visible(p,'#device-dashboard');
 });
 await step('Laptop owner authentication and inventory loaded',async()=>{admin=await ctx.newPage();opened.push(admin);await admin.goto(url+'admin.html');await visible(admin,'#workspace');await txt(admin,'#stat-variants','2');assert.ok(await admin.locator('a[href="inventory.html"]').count()>=1)});
 await step('Shared Sales Products grid adds multiple sizes',async()=>{
  const inventory=await ctx.newPage();opened.push(inventory);await inventory.goto(url+'inventory.html');
  await visible(inventory,'.hub-tabs');
  await inventory.getByRole('button',{name:'Sales Products'}).click();
  await inventory.getByRole('button',{name:'+ Add Product'}).click();
  await visible(inventory,'.hub-editor');
  await inventory.locator('.hub-edit-form input[name=name]').fill('Winter Crewneck');
  await inventory.locator('.hub-editor input[placeholder="e.g. 25.00"]').fill('29.99');
  await inventory.locator('.hub-editor input[placeholder="Add another color (e.g. Navy)"]').fill('Forest Green');
  await inventory.getByRole('button',{name:'+ Add Color'}).click();
  await inventory.locator('.hub-editor input[aria-label="Forest Green S quantity"]').fill('3');
  await inventory.locator('.hub-editor input[aria-label="Forest Green M quantity"]').fill('2');
  await inventory.getByRole('button',{name:'Save Product & Quantities'}).click();
  await txt(inventory,'#inventory-hub-message','saved. Size totals updated');
  assert.equal((await state(inventory)).tables.stock_items.length,4);
  await admin.locator('#refresh').click();await txt(admin,'#stat-variants','4');
 });
 await step('Shared Sales Products grid edits quantity and price',async()=>{
  const inventory=await ctx.newPage();opened.push(inventory);await inventory.goto(url+'inventory.html');
  await visible(inventory,'#inventory-hub-root');await visible(inventory,'.hub-tabs');
  await inventory.getByRole('button',{name:'Sales Products'}).click();
  await visible(inventory,'.hub-product');
  await inventory.getByRole('button',{name:'Edit Winter Crewneck stock and sizes'}).click();
  await visible(inventory,'.hub-editor');
  await inventory.locator('.hub-editor input[placeholder="e.g. 25.00"]').fill('33.50');
  await inventory.locator('.hub-editor input[aria-label="Forest Green S quantity"]').fill('9');
  await inventory.getByRole('button',{name:'Save Product & Quantities'}).click();
  await txt(inventory,'#inventory-hub-message','saved. Size totals updated');
  const s=await state(inventory);
  assert.ok(s.tables.stock_items.some(x=>x.product_name==='Winter Crewneck'&&x.size==='S'&&x.quantity===9));
  assert.ok(s.tables.inventory_catalog.some(x=>x.name==='Winter Crewneck'&&x.price_cents===3350));
  await admin.locator('#refresh').click();await txt(admin,'#notice','Inventory refreshed');
 });
 await step('Laptop event setup',async()=>{const f=admin.locator('#event-form');await f.locator('[name=name]').fill('Holiday Boutique E2E');await f.locator('[name=event_date]').fill('2026-12-12');await f.locator('[name=venue]').fill('Rocky Point');await f.getByRole('button',{name:'Create event'}).click();await txt(admin,'#event-list','Holiday Boutique E2E')});
 await step('Cashier starts closed, opens, and selects event',async()=>{
  cashier=await ctx.newPage();opened.push(cashier);await cashier.goto(url+'register.html');await visible(cashier,'#workspace');assert.equal(await cashier.locator('input[name="checkout-device-mode"][value="dual"]').count(),0,'Legacy dual-iPad control must be absent');assert.equal(await cashier.locator('body').getAttribute('data-checkout-device-mode'),'swivel','One swivel iPad must be active');await visible(cashier,'#register-launch');await txt(cashier,'#launch-product-count','ready-to-sell');
  await cashier.locator('#setup-event-launch').click();await visible(cashier,'#event-setup-dialog');
  await cashier.locator('#setup-event').selectOption({label:'Holiday Boutique E2E · 2026-12-12'});
  await cashier.locator('input[aria-label="Include Christmas Hoodie"]').check();
  await cashier.locator('input[aria-label="Include Winter Crewneck"]').check();
  await cashier.locator('#save-event-selection').click();await txt(cashier,'#notice','Event saved. Your selected Sales Products are ready.');
  await visible(cashier,'.quick-toolbar');
  await visible(cashier,'#catalog .quick-product');assert.ok(await cashier.locator('.quick-product').count()>=2);
  assert.equal(await cashier.locator('.product-manager:visible').count(),0);
  assert.equal(await cashier.locator('#event-select').inputValue(),(await state(cashier)).tables.pos_events[0].id);
 });
 await step('Barcode keyboard scanner increments sizes, rejects unknown and sold-out codes',async()=>{
  const field=cashier.locator('#scan-code');
  for(const count of [1,2,3]){
   await field.fill('XMAS-RED-M');await field.press('Enter');
   await txt(cashier,'#scan-status','added');
   assert.equal(await cashier.locator('#cart .cart-row input[aria-label^="Quantity"]').first().inputValue(),String(count));
  }
  await field.fill('XMAS-RED-M');await field.press('Enter');
  await txt(cashier,'#scan-status','Sold Out');
  await visible(cashier,'#variant-dialog');
  assert.equal(await cashier.getByRole('button',{name:/M · Red/i}).isDisabled(),true);
  await cashier.locator('#close-variant').click();
  await field.fill('PERSEN-NOT-FOUND');await field.press('Enter');
  await txt(cashier,'#scan-status','Product Not Found');
  assert.equal(await cashier.locator('#scan-search').isVisible(),true);
  await cashier.locator('#cart .cart-row button').last().click();
  assert.equal(await cashier.locator('#cart .cart-row').count(),0);
 });
 await step('Inventory scanner lookup does not create a sale or add cart items',async()=>{
  await cashier.locator('#scan-mode-inventory').click();
  await cashier.locator('#scan-code').fill('XMAS-RED-M');await cashier.locator('#scan-code').press('Enter');
  await txt(cashier,'#scan-status','Nothing was added');await txt(cashier,'#scan-inventory-result','Christmas Hoodie');
  assert.equal(await cashier.locator('#cart .cart-row').count(),0);
  assert.equal((await state(cashier)).tables.pos_sales.length,0);
  await cashier.locator('#scan-mode-sell').click();
 });
 await step('Cashier big tiles → size/color picker → cart',async()=>{
  await cashier.locator('#search').fill('Christmas Hoodie');await cashier.locator('.quick-product').first().click();await visible(cashier,'#variant-dialog');
  await cashier.getByRole('button',{name:/M · Red/i}).click();await txt(cashier,'#cart','Christmas Hoodie');
  await cashier.locator('#search').fill('');await cashier.locator('.quick-product').filter({hasText:'Winter Crewneck'}).click();
  await cashier.getByRole('button',{name:/S · Forest Green/i}).click();assert.equal(await cashier.locator('#cart .cart-row').count(),2);
 });
 await step('Cashier quantity, discount, no-tax UI, close/reopen',async()=>{
  const row=cashier.locator('#cart .cart-row').first(),quantity=row.locator('input[type=number]').first();
  assert.equal(await row.locator('input[aria-label^="Unit price for "]').getAttribute('readonly'),'');
  await quantity.fill('4');await quantity.dispatchEvent('change');assert.equal(await quantity.inputValue(),'1');
  await quantity.fill('2');await quantity.dispatchEvent('change');
  await cashier.locator('button[data-discount="10"]').click();assert.equal(await cashier.locator('#discount').inputValue(),'10');
  assert.equal(await cashier.locator('#tax').count(),0,'No tax input must appear for new sales');assert.equal(await cashier.locator('#start').isDisabled(),false);
  await cashier.locator('#close-register').click();await visible(cashier,'#register-launch');await cashier.locator('#open-register').click();assert.equal(await cashier.locator('#cart .cart-row').count(),2)
 });
 await step('Legacy two-iPad controls are no longer presented',async()=>{
  for(const id of ['pair','pair-quick','pair-setup','pair-link-panel','pair-copy','pair-share']){
   assert.equal(await cashier.locator('#'+id).count(),0,'Obsolete pairing UI must be removed: '+id);
  }
  assert.equal(await cashier.locator('input[name="checkout-device-mode"][value="dual"]').count(),0);
 });
 await step('Single-iPad handoff fails closed until secure isolation is implemented',async()=>{
  const before=await state(cashier);
  const original={checkouts:before.tables.pos_checkouts.length,sales:before.tables.pos_sales.length,printJobs:before.tables.pos_print_jobs.length};
  assert.equal(await cashier.locator('#start').innerText(),'Hand to Customer →');
  assert.equal(await cashier.locator('#start').isDisabled(),false);
  await cashier.locator('#start').click();
  await txt(cashier,'#notice','Customer handoff is temporarily unavailable: secure customer isolation is required.');
  assert.equal(await cashier.locator('#swivel-overlay').isVisible(),false,'Customer overlay must remain closed');
  assert.equal(await cashier.locator('#swivel-customer-frame').getAttribute('src'),'about:blank','No customer session may be opened');
  assert.equal(await cashier.locator('#workspace').isVisible(),true,'Cashier still controls the iPad');
  assert.equal(await cashier.locator('#cart .cart-row').count(),2,'Cart must survive a blocked handoff');
  const after=await state(cashier);
  assert.equal(after.tables.pos_checkouts.length,original.checkouts,'Blocked handoff must not create checkout');
  assert.equal(after.tables.pos_sales.length,original.sales,'Blocked handoff must not create sale');
  assert.equal(after.tables.pos_print_jobs.length,original.printJobs,'Blocked handoff must not queue receipt');
 });
 await step('Epson Center remains read-only and legacy NELKO browser worker stays disabled',async()=>{
  await visible(admin,'#print-center');
  await txt(admin,'#epson-monitor-status','Showing staging queue history');
  assert.ok(await admin.locator('#epson-refresh').isEnabled());
  printer=await ctx.newPage();opened.push(printer);await printer.goto(url+'print-station.html');
  await txt(printer,'main','old NELKO browser print worker is disabled');
  assert.equal(await printer.locator('#arm').count(),0);
  const snapshot=await state(admin);
  assert.equal(snapshot.tables.pos_print_jobs.length,0);
  assert.equal(snapshot.tables.pos_drawer_open_jobs.length,0);
 });
 }finally{for(const p of opened)try{await p.close()}catch{}await ctx.close();await browser.close();await new Promise(r=>server.close(r))}
 if(failures.length){console.error('POS functional failures:',JSON.stringify(failures,null,2));process.exitCode=1}
 else console.log('PASS: Laptop Epson queue monitor, cashier, customer iPad and shared mocked checkout exercised interactively. No physical hardware commands or email delivery.');
})().catch(e=>{console.error(e);try{server.close()}catch{}process.exitCode=1});

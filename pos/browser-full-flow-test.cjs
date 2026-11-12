/* Cross-device interactive browser test. LOCAL MOCK DATA ONLY. */
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
 let admin,cashier,customer,printer;
 try{
 await step('Device dashboard routes without unsafe browser-stored PIN',async()=>{
  const p=await ctx.newPage();opened.push(p);assert.equal((await p.goto(url)).status(),200);
  await visible(p,'#device-dashboard');
  assert.equal(await p.locator('#pin-gate').count(),0);
  assert.equal(await p.locator('#pin-input').count(),0);
  assert.match(await p.locator('.test').innerText(),/Cloudflare Access/);
  for(const file of ['admin.html','register.html','display.html','print-station.html'])
   assert.equal(await p.locator('a[href="'+file+'"]').count(),1);
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
  cashier=await ctx.newPage();opened.push(cashier);await cashier.goto(url+'register.html');await visible(cashier,'#workspace');await visible(cashier,'#register-launch');await txt(cashier,'#launch-product-count','ready-to-sell');
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
 await step('Cashier big tiles → size/color picker → cart',async()=>{
  await cashier.locator('#search').fill('Christmas Hoodie');await cashier.locator('.quick-product').first().click();await visible(cashier,'#variant-dialog');
  await cashier.getByRole('button',{name:/M · Red/i}).click();await txt(cashier,'#cart','Christmas Hoodie');
  await cashier.locator('#search').fill('');await cashier.locator('.quick-product').filter({hasText:'Winter Crewneck'}).click();
  await cashier.getByRole('button',{name:/S · Forest Green/i}).click();assert.equal(await cashier.locator('#cart .cart-row').count(),2);
 });
 await step('Cashier quantity, discount, tax, close/reopen',async()=>{
  const row=cashier.locator('#cart .cart-row').first(),quantity=row.locator('input[type=number]').first();
  assert.equal(await row.locator('input[aria-label^="Unit price for "]').getAttribute('readonly'),'');
  await quantity.fill('4');await quantity.dispatchEvent('change');assert.equal(await quantity.inputValue(),'1');
  await quantity.fill('2');await quantity.dispatchEvent('change');
  await cashier.locator('button[data-discount="10"]').click();assert.equal(await cashier.locator('#discount').inputValue(),'10');
  await cashier.locator('#tax').fill('0');await cashier.locator('#tax').dispatchEvent('input');assert.equal(await cashier.locator('#start').isDisabled(),false);
  await cashier.locator('#close-register').click();await visible(cashier,'#register-launch');await cashier.locator('#open-register').click();assert.equal(await cashier.locator('#cart .cart-row').count(),2)
 });
 await step('Cashier pairing on iPad with blocked clipboard, manual link and retry',async()=>{
  await cashier.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw Error('Clipboard not permitted')}});
  await cashier.locator('#pair-quick').click();await txt(cashier,'#notice','Pairing link created');
  await visible(cashier,'#pair-link-panel');
  const link=await cashier.locator('#pair-link-field').inputValue();assert.match(link,/display\.html\?pair=[0-9a-f-]{36}/);
  assert.equal(await cashier.locator('#pair-link-field').getAttribute('readonly'),'');
  await cashier.locator('#pair-copy').click();await txt(cashier,'#pair-feedback','Safari blocked automatic copying');
  assert.equal(await cashier.evaluate(()=>document.activeElement.id),'pair-link-field');
  await cashier.evaluate(()=>{navigator.clipboard.writeText=async s=>localStorage.setItem('__clip',s)});
  await cashier.locator('#pair-copy').click();await txt(cashier,'#pair-feedback','Private link copied');
  assert.equal(link,await cashier.evaluate(()=>navigator.clipboard.readText()));
  customer=await ctx.newPage();opened.push(customer);await customer.goto(link);await visible(customer,'#customer-welcome');await txt(customer,'#welcome-status','Your cashier will start your order shortly')
 });
 await step('Print station test print, paper selection, arm',async()=>{
  printer=await ctx.newPage();opened.push(printer);await printer.goto(url+'print-station.html');await visible(printer,'#station-panel');
  await printer.locator('#paper').selectOption('continuous-100');await printer.locator('#test-print').click();await txt(printer,'#station-message','Test sent to Chrome');
  assert.ok(Number(await printer.evaluate(()=>localStorage.getItem('__prints')))>0);
  assert.equal(await printer.locator('#arm').isDisabled(),true,'Physical confirmation must gate automatic printing');
  await printer.locator('#test-printed').check();
  assert.equal(await printer.locator('#arm').isEnabled(),true,'Operator-confirmed paper test can arm station');
  await printer.locator('#arm').click();await txt(printer,'#station-state','Listening for paid sales');
 });
 await step('Send checkout and laptop live monitor',async()=>{
  await cashier.locator('#start').click();await txt(cashier,'#notice','Checkout sent');
  await cashier.waitForFunction(()=>document.body.dataset.cashierStage==='customer');
  await visible(customer,'#contact');await txt(admin,'#live-list','Customer is checking out',11000);
  const s=await state(admin);assert.equal(s.tables.pos_checkouts.at(-1).event_id,s.tables.pos_events[0].id)
 });
 await step('Customer keypad, validation, back, email and payment options',async()=>{
  await customer.locator('#wizard-next').click();await visible(customer,'#step-error');
  for(const digit of '6315550199')await customer.locator('[data-digit="'+digit+'"]').click();
  await customer.locator('#wizard-next').click();await txt(customer,'#step-receipt-title','receipt');await customer.locator('#wizard-back').click();await customer.locator('#wizard-next').click();
  await customer.locator('input[name=receipt_mode][value=both]').check();await customer.locator('#wizard-next').click();
  await customer.locator('#wizard-next').click();await visible(customer,'#step-error');
  await customer.locator('#email-address').fill('test-pos@example.com');await customer.locator('#wizard-next').click();
  await customer.locator('input[name=payment_preference][value=venmo_info]').check();await txt(customer,'#payment-instructions','@persenapparel');
  assert.equal(await customer.locator('input[name=payment_preference][value=apple_cash_info]').count(),0);
  await customer.locator('input[name=payment_preference][value=cash]').check();await customer.locator('#wizard-next').click();await txt(customer,'#step-promos-title','offers');
 });
 await step('Live help request reaches cashier and laptop',async()=>{
  await customer.locator('#wizard-help').click();await visible(cashier,'#customer-help-alert',12000);await txt(admin,'#live-list','Customer requested help',12000);
  await customer.locator('#wizard-help').click()
 });
 await step('Optional questionnaire and final checkout screen',async()=>{
  await customer.locator('input[name=marketing][value=no]').check();await customer.locator('input[name=marketing][value=yes]').check();
  await customer.locator('#wizard-next').click();await customer.locator('input[name=rating][value="5"]').check();await customer.locator('#wizard-next').click();
  await customer.locator('input[name=interest][value=maybe]').check();await customer.locator('#wizard-next').click();
  await txt(customer,'#step-review-title','Almost done');await customer.locator('#wizard-finish').click();await customer.waitForFunction(()=>window.__POS_TEST_DB.get().tables.pos_checkouts.at(-1)?.status==='contact_received',null,{timeout:11000});await visible(customer,'#waiting-payment');assert.match(await customer.locator('#waiting-payment h2').innerText(),/Waiting for your cashier/);assert.equal(await customer.locator('#thanks').isVisible(),false);
  const s=await state(customer);assert.equal(s.tables.pos_checkouts.at(-1).status,'contact_received');assert.equal(s.tables.pos_checkouts.at(-1).receipt_email,true)
 });
 await step('Submitted questions appear in the private laptop back office',async()=>{
  await admin.locator('#responses-refresh').click();
  await txt(admin,'#response-message','1 matching saved response');
  await txt(admin,'#response-count','1');
  await txt(admin,'#response-optins','1');
  await txt(admin,'#response-leads','1');
  await txt(admin,'#response-rating','5.0 / 5');
  await admin.locator('.response-card').first().click();
  await txt(admin,'#response-detail','test-pos@example.com');
  await txt(admin,'#response-detail','Yes — explicitly opted in');
  await txt(admin,'#response-detail','Maybe in the future');
  await txt(admin,'#response-detail','Printed + Email requested');
  const saved=(await state(admin)).tables.pos_checkouts.at(-1);
  assert.equal(saved.marketing_response,'yes');
  assert.equal(saved.marketing_opt_in,true);
  assert.equal(saved.custom_interest,'maybe');
  assert.equal(saved.rating,5);
  assert.equal(saved.receipt_print,true);
  assert.equal(saved.receipt_email,true);
 });
 await step('Cash changes, no early customer success, recovery and Finish Order gate',async()=>{
  await cashier.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('ready for cashier'),null,{timeout:9000});
  assert.equal(await customer.locator('#thanks').isVisible(),false);
  assert.equal(await cashier.locator('#cash').isDisabled(),true);
  await cashier.locator('#drawer-config').evaluate(x=>x.open=true);
  for(const [denom,count] of [['2000','3'],['1000','2'],['500','2'],['100','5'],['25','10'],['10','10'],['5','10'],['1','20']])
    await cashier.locator('#drawer-grid [data-denom="'+denom+'"]').fill(count);
  await cashier.locator('#save-drawer').click();await txt(cashier,'#notice','Cash drawer saved');
  await cashier.locator('#cash-received').fill('120.00');
  await cashier.locator('#cash-received').dispatchEvent('input');
  await txt(cashier,'#change-amount','$17.85');
  await cashier.waitForFunction(()=>document.querySelector('#cash')?.disabled===false,null,{timeout:6000});
  await cashier.evaluate(()=>sessionStorage.setItem('mock-lose-cash-response','1'));
  await cashier.locator('#cash').click();
  await visible(cashier,'#cash-handoff');
  await txt(cashier,'#cash-handoff-change','$17.85');
  await visible(customer,'#waiting-change',11000);
  await txt(customer,'#customer-change','$17.85');
  assert.equal(await customer.locator('#thanks').isVisible(),false);
  assert.equal(await cashier.locator('#start').isDisabled(),true);
  assert.equal((await state(cashier)).tables.pos_sales.length,1);
  assert.equal((await state(cashier)).tables.pos_checkouts.at(-1).cash_handoff_complete,false);
  // Customer cannot see final success until cashier consciously finishes the handoff.
  await cashier.locator('#finish-order').click();
  await txt(cashier,'#notice','Ready for the next customer.');
  await visible(cashier,'#receipt');assert.equal(await cashier.locator('#cart .cart-row').count(),0);
  assert.equal((await state(cashier)).tables.pos_checkouts.at(-1).cash_handoff_complete,true);
  await visible(customer,'#thanks',11000);
 });
 await step('Print queue receives sale only after payment',async()=>{
  await printer.waitForFunction(()=>__POS_TEST_DB.get().tables.pos_print_jobs[0]?.state==='submitted_to_browser',null,{timeout:11000});
  assert.equal((await state(printer)).tables.pos_print_jobs.length,1);assert.ok(Number(await printer.evaluate(()=>localStorage.getItem('__prints')))>=2)
 });
 await step('Print station pause and manual retry',async()=>{
  await printer.locator('#disarm').click();await txt(printer,'#station-state','Paused');const prior=Number(await printer.evaluate(()=>localStorage.getItem('__prints')));
  await printer.locator('#job-list button').first().click();await txt(printer,'#station-message','queued again');
  assert.equal(Number(await printer.evaluate(()=>localStorage.getItem('__prints'))),prior);await printer.locator('#arm').click();
  await printer.waitForFunction(n=>Number(localStorage.getItem('__prints'))>n,prior,{timeout:9000})
 });
 await step('Inventory reflects sale and customer completion',async()=>{
  await visible(customer,'#customer-welcome',11000);
  assert.equal(await customer.locator('#kiosk-shell').isVisible(),false);
  assert.equal(await customer.locator('#items .cart-row').count(),0);
  assert.equal(await customer.locator('#total').innerText(),'$0.00');
  await cashier.locator('#refresh-products').click();await txt(cashier,'#notice','refreshed');
  await admin.locator('#refresh').click();
  assert.ok((await state(admin)).tables.stock_items.find(x=>x.sku==='XMAS-RED-M').quantity<3)
 });
 await step('Cancel checkout leaves sales and receipts unchanged',async()=>{
  await cashier.locator('#search').fill('Christmas Hoodie');await cashier.locator('.quick-product').first().click();await cashier.getByRole('button',{name:/L · Red/i}).click();
  await cashier.locator('#start').click();await txt(cashier,'#notice','Checkout sent');await cashier.locator('#checkout-cancel-quick').click();await txt(cashier,'#notice','Checkout cancelled');
  assert.equal((await state(cashier)).tables.pos_sales.length,1);assert.equal((await state(cashier)).tables.pos_print_jobs.length,1)
 });
 }finally{for(const p of opened)try{await p.close()}catch{}await ctx.close();await browser.close();await new Promise(r=>server.close(r))}
 if(failures.length){console.error('POS functional failures:',JSON.stringify(failures,null,2));process.exitCode=1}
 else console.log('PASS: Laptop, cashier, customer iPad, printer and shared mocked checkout exercised interactively. Not physical hardware/live-email validation.');
})().catch(e=>{console.error(e);try{server.close()}catch{}process.exitCode=1});

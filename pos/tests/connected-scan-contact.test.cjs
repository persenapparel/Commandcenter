'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const read=p=>fs.readFileSync('pos/'+p,'utf8');
const barcode=require('../barcode-tender-model.js');
const receipt=require('../receipt-delivery-guards.js');
test('cashier scanner is truly connected to variant stock guards',()=>{
 const h=read('register.html'),s=read('register.js'),build=read('build-pages.mjs');
 for(const id of ['scan-form','scan-code','scan-status','scan-search'])
  assert.match(h,new RegExp('id="'+id+'"'));
 assert.match(h,/src="barcode-tender-model\.js"/);
 assert.match(build,/'barcode-tender-model\.js'/);
 assert.match(s,/model\.buildBarcodeIndex/);
 assert.match(s,/model\.scanCart/);
 assert.match(s,/addVariant\(variant\)/);
 assert.match(s,/pickVariant\(variant\.product_name,alternatives\)/);
 assert.match(s,/by\('event-select'\)/);
});
test('Code128-safe variant barcode doubles and respects stock',()=>{
 const index=barcode.buildBarcodeIndex([
  {productId:'abc-1',variantId:'id-size-s',label:'Hoodie S',unitCents:4000,available:2,barcode:'PERSEN-HOOD-S'},
  {productId:'abc-1',variantId:'id-size-m',label:'Hoodie M',unitCents:4000,available:0,barcode:'PERSEN-HOOD-M'}]);
 let cart=[];for(let i=0;i<2;i++){const r=barcode.scanCart(index,cart,'PERSEN-HOOD-S');assert.equal(r.status,'added');cart=r.cart;}
 assert.equal(cart.length,1);assert.equal(cart[0].quantity,2);
 assert.equal(barcode.scanCart(index,cart,'PERSEN-HOOD-S').status,'sold-out');
 assert.equal(barcode.scanCart(index,cart,'PERSEN-HOOD-M').status,'sold-out');
 assert.equal(barcode.scanCart(index,cart,'PERSEN-UNKNOWN').status,'not-found');
 assert.throws(()=>barcode.buildBarcodeIndex([...index.values(),...index.values()]),/Duplicate barcode/);
});
test('phones remain order data, with NO SMS receipt path',()=>{
 const h=read('display.html'),d=read('display.js'),sql=read('pos-schema-review.sql');
 assert.match(h,/name="phone"/);
 assert.match(d,/p_phone:C\.phone\(/);
 assert.match(sql,/update public\.pos_checkouts set phone=/);
 assert.deepEqual(receipt.CHANNELS,['print','email','none']);
 assert.throws(()=>receipt.request({orderId:'sale_1234',channel:'sms',address:'6315550199',consent:true,committed:true}),/Unsupported/);
 assert.equal(receipt.canSend({channel:'sms',providerReady:true,customerRequested:true,committed:true}),false);
 assert.equal(receipt.usPhone('(631) 555-0199'),'+16315550199');
 assert.doesNotMatch(h,/name="receipt_mode" value="sms"/i);
});
test('commercial Apple Cash P2P remains hidden from customer and cashier',()=>{
 const h=read('display.html'),js=read('display.js');
 assert.doesNotMatch(h,/name="payment_preference" value="apple_cash_info"/);
 assert.doesNotMatch(js,/apple_cash_info/);
});

test('inventory checking is a distinct read-only scan mode',()=>{
 const html=read('register.html'),js=read('register.js');
 for(const id of ['scan-mode-sell','scan-mode-inventory','scan-inventory-result','scan-submit'])
   assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(js,/function checkInventorySku\(input\)/);
 assert.match(js,/PersenPOSBarcodeTender\.lookupInventory\(stock,input\)/);
 assert.match(js,/if\(scanMode==='inventory'\)checkInventorySku\(field.value\)/);
 const start=js.indexOf('function checkInventorySku(input)');
 const end=js.indexOf("by('scan-mode-sell').addEventListener",start);
 const lookupOnly=js.slice(start,end);
 assert.doesNotMatch(lookupOnly,/addVariant\(|cart.push\(|pos_complete_cash|\.insert\(|\.update\(/);
});

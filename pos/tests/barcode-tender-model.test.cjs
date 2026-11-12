'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const m=require('../barcode-tender-model.js');
const variants=[
 {productId:'RED',variantId:'S',label:'Red Hoodie Small',unitCents:4000,available:2},
 {productId:'RED',variantId:'M',label:'Red Hoodie Medium',unitCents:4000,available:0},
 {productId:'RED',variantId:'L',label:'Red Hoodie Large',unitCents:4000,available:5}
];
test('unique internal Code128-safe codes per size',()=>{
 assert.equal(m.skuFor('RED','S'),'PA-RED-S');
 const index=m.buildBarcodeIndex(variants);
 assert.equal(index.size,3);
 assert.throws(()=>m.buildBarcodeIndex([...variants,variants[0]]),/Duplicate/);
});
test('scan increments same size and prevents oversell',()=>{
 const index=m.buildBarcodeIndex(variants);
 const a=m.scanCart(index,[],'pa-red-s');
 assert.equal(a.status,'added');assert.equal(a.cart[0].quantity,1);
 const b=m.scanCart(index,a.cart,'PA-RED-S');
 assert.equal(b.cart.length,1);assert.equal(b.cart[0].quantity,2);
 const c=m.scanCart(index,b.cart,'PA-RED-S');
 assert.equal(c.status,'sold-out');assert.equal(c.cart[0].quantity,2);
});
test('unknown barcode offers search; sold-out size shows alternatives',()=>{
 const index=m.buildBarcodeIndex(variants);
 assert.equal(m.scanCart(index,[],'PA-UNKNOWN-XL').action,'search');
 const r=m.scanCart(index,[],'PA-RED-M');
 assert.equal(r.status,'sold-out');assert.deepEqual(r.alternatives.map(x=>x.variantId),['S','L']);
});
test('split cash and Venmo stays pending until independently verified',()=>{
 const ts=[{method:'cash',amountCents:1500,status:'received'},{method:'venmo',amountCents:2500,status:'pending'}];
 const before=m.tenderSummary(4000,ts);
 assert.equal(before.remainingCents,2500);assert.equal(before.pendingCents,2500);assert.equal(before.readyToFinish,false);
 assert.throws(()=>m.verifyVenmo(ts,1,{actualReceivedCents:2500,confirmedByCashier:false}),/not independently verified/);
 assert.throws(()=>m.verifyVenmo(ts,1,{actualReceivedCents:2400,confirmedByCashier:true}),/not independently verified/);
 const after=m.tenderSummary(4000,m.verifyVenmo(ts,1,{actualReceivedCents:2500,confirmedByCashier:true}));
 assert.equal(after.remainingCents,0);assert.equal(after.readyToFinish,true);
});
test('cash change, optional tips, and receipts',()=>{
 assert.equal(m.totalWithTip(4000,200),4200);
 const r=m.tenderSummary(4200,[{method:'cash',amountCents:5000,status:'received'}]);
 assert.equal(r.changeCents,800);assert.equal(r.cashChangeCents,800);
 assert.equal(m.receiptChoice('email'),'email');
 assert.throws(()=>m.receiptChoice('automatic'),/Invalid/);
});
test('rejects unverified tender statuses, negative cents and overflow',()=>{
 assert.throws(()=>m.tenderSummary(100,[{method:'venmo',amountCents:100,status:'received'}]),/verification/);
 assert.throws(()=>m.totalWithTip(100,-1),/Invalid/);
 assert.throws(()=>m.tenderSummary(100,[{method:'cash',amountCents:100000001,status:'received'}]),/Invalid/);
});

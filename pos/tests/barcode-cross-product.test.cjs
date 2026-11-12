'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildBarcodeIndex,scanCart}=require('../barcode-tender-model.js');
const index=buildBarcodeIndex([
 {productId:'TEE',variantId:'L',label:'Tee Large',unitCents:2000,available:2,barcode:'TEE-L'},
 {productId:'HOODIE',variantId:'L',label:'Hoodie Large',unitCents:4000,available:1,barcode:'HOODIE-L'},
 {productId:'TEE',variantId:'M',label:'Tee Medium',unitCents:2000,available:3,barcode:'TEE-M'}
]);
test('identical size identifiers on different products remain distinct cart lines',()=>{
 let result=scanCart(index,[],'TEE-L');
 result=scanCart(index,result.cart,'HOODIE-L');
 assert.equal(result.status,'added');
 assert.deepEqual(result.cart.map(x=>[x.productId,x.variantId,x.quantity]),[['TEE','L',1],['HOODIE','L',1]]);
 result=scanCart(index,result.cart,'TEE-L');
 assert.deepEqual(result.cart.map(x=>[x.productId,x.quantity]),[['TEE',2],['HOODIE',1]]);
});
test('sold-out duplicate does not mutate another product or exceed variant stock',()=>{
 let cart=scanCart(index,[],'HOODIE-L').cart;
 const result=scanCart(index,cart,'HOODIE-L');
 assert.equal(result.status,'sold-out');
 assert.deepEqual(result.cart,cart);
 assert.deepEqual(result.alternatives,[]);
});
test('unknown code does not alter cart',()=>{
 const cart=scanCart(index,[],'TEE-M').cart;
 const result=scanCart(index,cart,'MISSING-123');
 assert.equal(result.status,'not-found');
 assert.deepEqual(result.cart,cart);
});

// Reproduce the cashier's stock_id/qty cart representation for repeated scans.
test('cashier stock shape enforces existing quantities',()=>{
 const fs=require('node:fs');
 const source=fs.readFileSync('pos/register.js','utf8');
 assert.ok(source.includes('productId:String(x.stock_id),variantId:x.stock_id,quantity:x.qty'));
 const cashierCart=[{stock_id:'hoodie-red-l',qty:2}];
 const normalized=cashierCart.map(x=>({productId:String(x.stock_id),variantId:x.stock_id,quantity:x.qty}));
 const testIndex=buildBarcodeIndex([{productId:'hoodie-red-l',variantId:'hoodie-red-l',label:'Red Hoodie Large',unitCents:4000,available:2,barcode:'PA-HOODIE-RED-L'}]);
 const result=scanCart(testIndex,normalized,'PA-HOODIE-RED-L');
 assert.equal(result.status,'sold-out');
 assert.deepEqual(result.cart,normalized);
});

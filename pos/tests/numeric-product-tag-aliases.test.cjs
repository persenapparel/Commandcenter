'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const m=require('../barcode-tender-model.js');
const pairs=[["21011009","PA-XMAS26-HOODIE-RED-S"],["21011016","PA-XMAS26-HOODIE-RED-M"],["21011023","PA-XMAS26-HOODIE-RED-L"],["21011030","PA-XMAS26-HOODIE-RED-XL"],["21012006","PA-XMAS26-HOODIE-GREEN-S"],["21012013","PA-XMAS26-HOODIE-GREEN-M"],["21012020","PA-XMAS26-HOODIE-GREEN-L"],["21012037","PA-XMAS26-HOODIE-GREEN-XL"],["21021008","PA-XMAS26-CREWNECK-RED-S"],["21021015","PA-XMAS26-CREWNECK-RED-M"],["21021022","PA-XMAS26-CREWNECK-RED-L"],["21021039","PA-XMAS26-CREWNECK-RED-XL"],["21022005","PA-XMAS26-CREWNECK-GREEN-S"],["21022012","PA-XMAS26-CREWNECK-GREEN-M"],["21022029","PA-XMAS26-CREWNECK-GREEN-L"],["21022036","PA-XMAS26-CREWNECK-GREEN-XL"]];
const validEAN8=code=>/^[0-9]{8}$/.test(code)&&(
 code.slice(0,7).split('').reduce((sum,c,i)=>sum+Number(c)*(i%2===0?3:1),0)+Number(code[7]))%10===0;
test('16 EAN-8 tag values map one-to-one to canonical Christmas size SKUs',()=>{
 assert.equal(pairs.length,16);
 assert.equal(new Set(pairs.map(x=>x[0])).size,16);
 assert.equal(new Set(pairs.map(x=>x[1])).size,16);
 for(const [barcode,sku] of pairs){
  assert.ok(validEAN8(barcode),barcode);
  assert.equal(m.resolveProductCode(barcode),sku);
  assert.equal(m.resolveProductCode(sku),sku);
  assert.equal(m.tagCodeForSku(sku),barcode);
 }
});
test('numeric tags add the correct sale variant and work in inventory check',()=>{
 const variants=pairs.map(([code,sku],i)=>({productId:String(i+1),variantId:'V'+i,label:sku,unitCents:4000,available:2,barcode:sku}));
 const index=m.buildBarcodeIndex(variants);
 const [barcode,sku]=pairs[1];
 const first=m.scanCart(index,[],barcode);
 assert.equal(first.status,'added');assert.equal(first.cart[0].label,sku);
 const second=m.scanCart(index,first.cart,barcode);
 assert.equal(second.status,'added');assert.equal(second.cart[0].quantity,2);
 assert.equal(m.scanCart(index,second.cart,barcode).status,'sold-out');
 const items=pairs.map(([code,sku],i)=>({id:'V'+i,sku,quantity:2}));
 assert.equal(m.lookupInventory(items,barcode).variant.sku,sku);
 assert.equal(m.lookupInventory(items,'20010485').status,'not-found');
 assert.equal(m.scanCart(index,[],'20010485').status,'not-found');
});

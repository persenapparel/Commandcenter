'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const p=require('../landscape-experience.js');
const cash=()=>p.startSale(p.initial(),{employeeId:'staff-2',registerOpen:true});
const shirt={productId:'tee',variantId:'tee-m',label:'Tee / M',unitCents:2500,quantity:1,available:2};
test('register stays on homepage until authenticated and opened',()=>{
 assert.equal(p.initial().stage,'home');
 assert.throws(()=>p.startSale(p.initial(),{employeeId:'',registerOpen:true}));
 assert.throws(()=>p.startSale(p.initial(),{employeeId:'staff-2',registerOpen:false}));
 assert.equal(cash().stage,'catalog');
});
test('sold-out variant stays displayable but cannot enter cart',()=>{
 assert.equal(p.soldOutLabel(0),'Sold Out');
 assert.equal(p.soldOutLabel(1),null);
 assert.throws(()=>p.addVariant(cash(),{...shirt,available:0}),/Sold Out/);
 let s=p.addVariant(cash(),shirt);
 assert.throws(()=>p.addVariant(s,{...shirt,quantity:2}),/Sold Out/);
});
test('cash must be entered before Finish Order and show accurate change',()=>{
 let s=p.toTender(p.addVariant(cash(),shirt));
 assert.throws(()=>p.finishOrder(s,{committedOrderId:'order-1'}));
 assert.throws(()=>p.enterCash(s,2000),/Insufficient/);
 s=p.enterCash(s,3000);
 assert.deepEqual([p.customerView(s).totalCents,p.customerView(s).receivedCents,p.customerView(s).changeCents],[2500,3000,500]);
 assert.equal(p.customerView(s).status,'Awaiting Finish Order');
 s=p.finishOrder(s,{committedOrderId:'order-1'});
 assert.equal(p.customerView(s).mode,'thank-you');
 s=p.returnHome(s);
 assert.equal(p.customerView(s).mode,'idle');
 assert.equal(s.cart.length,0);
 assert.equal(s.tenderCents,null);
});
test('one large slide at a time rotates on interval',()=>{
 const slides=['one','two','three'];
 assert.equal(p.slideAt(slides,0),'one');
 assert.equal(p.slideAt(slides,6000),'two');
 assert.equal(p.slideAt(slides,12000),'three');
 assert.equal(p.slideAt(slides,18000),'one');
 assert.equal(p.slideAt([],0),null);
});
test('no client-side finish without durable committed order id',()=>{
 let s=p.enterCash(p.toTender(p.addVariant(cash(),shirt)),2500);
 assert.throws(()=>p.finishOrder(s,{committedOrderId:''}));
 assert.throws(()=>p.returnHome(s));
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../home-layout-model.js');
test('three distinct layouts, required tiles, exact customer headline',()=>{
 const owner=M.defaults('owner'),cashier=M.defaults('register'),customer=M.defaults('customer');
 assert.equal(owner.tiles.length,10);assert.equal(cashier.tiles.length,7);
 assert.equal(customer.title,'Welcome to Persen Apparel');assert.equal(customer.tiles.length,0);
 for(const x of [owner,cashier,customer])assert.deepEqual(M.validate(x),x);
});
test('required navigation cannot be deleted, replaced or linked to unsafe destinations',()=>{
 const x=M.defaults('register');x.tiles.pop();assert.throws(()=>M.validate(x),/Required navigation/);
 const y=M.defaults('owner');y.tiles[0].route='javascript:alert(1)';assert.throws(()=>M.validate(y),/Invalid tile/);
});
test('reordering preserves mandatory navigation',()=>{
 const x=M.defaults('register'),y=M.reorder(x,0,6);assert.equal(y.tiles[6].label,'New Sale');assert.equal(x.tiles[0].label,'New Sale');
});
test('customer idle screen cannot be made interactive',()=>{
 const x=M.defaults('customer');x.tiles.push({id:'unsafe',label:'Checkout',route:'register.html'});assert.throws(()=>M.validate(x),/display-only/);
});
test('uploaded assets and links must be constrained',()=>{
 const x=M.defaults('customer');x.logo='/assets/pos-home/logo.png';x.slides=[{image:'/assets/pos-home/holiday.webp',alt:'Holiday hoodies',href:'https://persenapparel.com'}];assert.doesNotThrow(()=>M.validate(x));
 x.slides[0].href='javascript:alert(1)';assert.throws(()=>M.validate(x),/Invalid slideshow/);
 x.slides[0].href='https://persenapparel.com';x.logo='https://untrusted.example/logo.png';assert.throws(()=>M.validate(x),/Logo/);
});
test('reject invalid duration and untrusted text',()=>{
 const x=M.defaults('customer');x.thankYouSeconds=0;assert.throws(()=>M.validate(x),/duration/);
 x.thankYouSeconds=5;x.title='<script>';assert.throws(()=>M.validate(x),/visual settings/);
});

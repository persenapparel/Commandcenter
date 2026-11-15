'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),p=require('../receipt-paper-layout.js');
test('fixed pages preserve exact physical dimensions',()=>{
 const a=p.layoutFor({paper:'50.8x101.6',contentPx:150});
 assert.equal(a.widthMm,50.8);assert.equal(a.heightMm,101.6);assert.equal(a.fits,true);
 assert.match(p.printCss(a),/@page\{size:50\.8mm 101\.6mm;margin:0\}/);
});
test('continuous receipt adapts length and does not inherit 4-inch blank tail',()=>{
 const short=p.layoutFor({paper:'continuous-100',contentPx:180});
 const long=p.layoutFor({paper:'continuous-100',contentPx:580});
 assert.equal(short.widthMm,100);assert.equal(short.kind,'continuous');
 assert.ok(short.heightMm<long.heightMm);
 assert.ok(short.heightMm<101.6);
 assert.ok(long.heightMm>101.6);
});
test('fixed sheet overflow fails closed instead of printing multiple labels',()=>{
 const a=p.layoutFor({paper:'50.8x101.6',contentPx:800});
 assert.equal(a.fits,false);assert.match(a.reason,/exceeds/);
 assert.throws(()=>p.printCss(a),/does not fit/);
});
test('untrusted or invalid dimensions cannot inject print CSS',()=>{
 assert.throws(()=>p.layoutFor({paper:'100x150;body{display:none}'}),/Unrecognized/);
 assert.throws(()=>p.layoutFor({paper:'continuous-100',marginMm:-5}),/Invalid/);
 assert.throws(()=>p.layoutFor({paper:'continuous-100',contentPx:1e12}),/Invalid/);
 assert.throws(()=>p.printCss(p.layoutFor({paper:'100x150'}),{fontPx:1000}),/Invalid/);
});
test('continuous mode hard-stops pathological long receipts',()=>{
 const p1=p.layoutFor({paper:'continuous-100',contentPx:1200});
 assert.equal(p1.fits,false);
 assert.match(p1.reason,/too long/);
});

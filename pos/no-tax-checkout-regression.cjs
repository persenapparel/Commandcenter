'use strict';
// Static guard for new-sale UI only. Not a substitute for backend/ESC-POS/browser tests.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const js=fs.readFileSync('pos/register.js','utf8');
const html=fs.readFileSync('pos/register.html','utf8');
assert.match(js,/function current\(\)\{return C\.totals\(cart,Number\(by\('discount'\)\.value\),0\);\}/,'new cart totals have zero tax');
assert.match(js,/const bps=C\.discountBps\(by\('discount'\)\.value\),tax=0;/,'checkout RPC receives zero tax');
assert.doesNotMatch(js,/by\('tax'\)|taxMilli\(/,'no active tax rate read');
assert.doesNotMatch(js,/variant-tax-check|document\.createTextNode\('Taxable'\)|taxable:flag\.checked|taxable:f\.has\('taxable'\)/,'no active per-product tax controls or inherited taxable flags');
assert.match(js,/price_cents:price,taxable:false/,'newly created POS products explicitly disable tax');
assert.doesNotMatch(html,/id="tax"|Tax rate \(%\)|name="taxable"|> Taxable<\/label>/,'no tax controls in cashier or custom quick-add view');
assert.doesNotMatch(html,/id="receipt-tax"/,'no active tax line in the new-sale receipt DOM');
assert.doesNotMatch(js,/by\('receipt-tax'\)/,'receipt rendering must not access the removed tax element');
assert.match(js,/by\('discount'\)\.oninput=draw;/,'cashier controls initialize without a removed tax input');
assert.match(js,/select\('id,snapshot,subtotal_cents,discount_cents,tax_cents,total_cents/,'historical sales still retain legacy tax fields for accounting compatibility');
console.log('PASS: staged new-sale POS UI has no tax input and sends zero tax (static only)');

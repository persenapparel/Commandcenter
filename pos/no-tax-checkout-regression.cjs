'use strict';
// Static guard for new-sale UI only. Not a substitute for backend/ESC-POS/browser tests.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const js=fs.readFileSync('pos/register.js','utf8');
const html=fs.readFileSync('pos/register.html','utf8');
assert.match(js,/function current\(\)\{return C\.totals\(cart,Number\(by\('discount'\)\.value\),0\);\}/,'new cart totals have zero tax');
assert.match(js,/const bps=C\.discountBps\(by\('discount'\)\.value\),tax=0;/,'checkout RPC receives zero tax');
assert.doesNotMatch(js,/by\('tax'\)|taxMilli\(/,'no active tax rate read');
assert.doesNotMatch(html,/id="tax"|Tax rate \(%\)|name="taxable"|> Taxable<\/label>/,'no tax controls in cashier or custom quick-add view');
assert.match(html,/<div hidden aria-hidden="true">Tax <span id="receipt-tax"><\/span><\/div>/,'legacy tax element hidden while retained for historical receipts');
console.log('PASS: staged new-sale POS UI has no tax input and sends zero tax (static only)');

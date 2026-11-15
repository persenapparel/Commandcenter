// Run: node --test pos/tests/focused-cashier.test.cjs
// Guards the actual staging stylesheet and Cloudflare build packaging.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root,name),'utf8');
const html = read('register.html');
const focus = read('cashier-focus.css');
const build = read('build-pages.mjs');
test('register loads cashier focus stylesheet after base stylesheet',()=>{
 assert.match(html, /href="pos\.css"[^>]*>\s*<link[^>]*href="cashier-focus\.css"/);
});
test('staging build copies focused stylesheet',()=>{
 assert.match(build, /'cashier-focus\.css'/);
});
test('catalog focuses products and cart without exposing setup and checkout',()=>{
 for(const selector of ['.hero','.event-manager','#cashier-checkout-panel','.product-manager']){
  assert.ok(focus.includes('body:not(.pos-register-closed)[data-cashier-stage="catalog"] '+selector),selector);
 }
 assert.match(focus,/\.layout\s*\{display:grid/);
});
test('focus styling does not hide non-catalog checkout stages',()=>{
 assert.doesNotMatch(focus,/data-cashier-stage="(?:customer|payment|external|handoff)"/);
});
test('small screens use one column',()=>{
 assert.match(focus,/@media\(max-width:850px\)/);
 assert.match(focus,/grid-template-columns:minmax\(0,1fr\)/);
});

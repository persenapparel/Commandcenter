'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=path=>fs.readFileSync(path,'utf8');
test('Staging Epson migration snapshots sale-time promotion and exposes private contacts only to owner print claim',()=>{
 const sql=read('pos/epson-contact-promotion-staging.sql');
 assert.match(sql,/receipt_design/);
 assert.match(sql,/where t\.owner_id=\(select auth\.uid\(\)\) and t\.active=true/i);
 assert.match(sql,/'phone',sale\.snapshot->>'phone'/);
 assert.match(sql,/'email',sale\.snapshot->>'email'/);
 assert.match(sql,/if \(select auth\.uid\(\)\) is null or not public\.is_persen_admin\(\)/i);
 assert.match(sql,/create or replace function public\.pos_activate_receipt_template/);
 assert.match(sql,/pg_catalog\.pg_advisory_xact_lock/);
 assert.match(sql,/where id=p_template and owner_id=\(select auth\.uid\(\)\)/);
 assert.doesNotMatch(sql,/create or replace function public\.pos_customer_view/i,'Never expose customer info via public pairing RPC');
});
test('Laptop Back Office offers message, presets and authenticated activation',()=>{
 const html=read('pos/admin.html'),code=read('pos/epson-promotions.js'),build=read('pos/build-pages.mjs');
 assert.match(html,/id="epson-promo-form"/);
 assert.match(html,/id="epson-promo-message" maxlength="300"/);
 assert.match(html,/id="epson-promo-preset"/);
 assert.match(code,/pos_receipt_templates/);
 assert.match(code,/pos_activate_receipt_template/);
 assert.match(code,/\.eq\('owner_id',owner\.id\)/);
 assert.match(build,/'epson-promotions\.js'/);
});
test('Register Receipt Studio can save and activate promo independently of checkout',()=>{
 const html=read('pos/register.html'),js=read('pos/register.js');
 for(const id of ['promotion-preset','promotion','activate-template','template-active-status'])
  assert.ok(html.includes('id="'+id+'"'));
 assert.match(js,/saveTemplate\(true\)/);
 assert.match(js,/pos_activate_receipt_template/);
 assert.match(js,/active:selected\?\.active===true/);
});
test('Paper contact disclosure remains visible on customer iPad and contact is not marketing consent',()=>{
 const html=read('pos/display.html'),display=read('pos/display.js');
 assert.match(html,/phone number will appear on both printed receipts/i);
 assert.match(html,/email will appear on both printed receipts/i);
 assert.match(display,/marketing:'not_answered'/);
 assert.doesNotMatch(html,/name="marketing"/);
});

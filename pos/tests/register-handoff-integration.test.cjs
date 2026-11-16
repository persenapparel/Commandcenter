'use strict';
// Static staging guard only; browser/Supabase E2E is additionally required.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('pos/register.js','utf8');
test('register passes newly created exact checkout ID into secure orchestration, without automatically enabling handoff',()=>{
 assert.match(source,/async function beginAuthorizedCheckout\(/);
 assert.match(source,/db\.rpc\('pos_begin_checkout'/);
 assert.match(source,/window\.PersenPOSSecureRegister=Object\.freeze\(/);
 const swivel=fs.readFileSync('pos/swivel-mode.js','utf8');
 assert.match(swivel,/start\.onclick=deny/);
 assert.match(swivel,/resume\.onclick=deny/);
});
test('Finish Order does not bypass an active handoff server verification',()=>{
 const begin=source.indexOf('async function finishOrder()');
 const end=source.indexOf('async function status()',begin);
 const body=source.slice(begin,end);
 const order=[body.indexOf("db.rpc('pos_finish_order'"),body.indexOf('saleForCheckout(id)'),
  body.indexOf('secure.finishAfterAuthoritativeOrder(saved)')];
 assert.ok(order.every(v=>v>=0),'missing server completion or handoff guard');
 assert.ok(order[0]<order[1]&&order[1]<order[2],
  'server finish must happen before handoff proof and home');
 assert.match(body,/if\(secure\?\.active\(\)===true\)await secure\.finishAfterAuthoritativeOrder\(saved\);/);
 assert.match(body,/else await showCompletedSale\(saved\);/);
});

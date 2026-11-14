/* Security acceptance gate for owner-only swivel staging.
 * This is deliberately NOT a successful checkout test. The current customer
 * handoff must fail closed until an audited server-side capability gateway
 * and isolated database authorization are available.
 */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=name=>fs.readFileSync(require('node:path').join(__dirname,name),'utf8');

test('customer handoff is fail-closed before issuing pairing tokens or starting checkout',()=>{
 const src=read('swivel-mode.js');
 const handler=src.indexOf("$('start').onclick=async()=>{");
 assert.ok(handler>=0,'single-iPad handoff handler must exist');
 const guard=src.indexOf('secure customer isolation is required',handler);
 const stop=src.indexOf('return;',guard);
 const issue=src.indexOf('await pairing()',handler);
 const begin=src.indexOf('await originalBegin()',handler);
 assert.ok(guard>handler&&stop>guard&&issue>stop&&begin>stop,
   'disabled handoff must return before pairing, checkout creation or owner sign-out');
});
test('resume handoff also fails closed',()=>{
 const src=read('swivel-mode.js');
 const handler=src.indexOf("$('swivel-resume').onclick=async()=>{");
 const guard=src.indexOf('Customer handoff is disabled',handler);
 const stop=src.indexOf('return;',guard);
 const issue=src.indexOf('await pairing()',handler);
 assert.ok(handler>=0&&guard>handler&&stop>guard&&issue>stop);
});
test('guest transport never persists or restores owner session',()=>{
 const src=read('customer-guest-client.js');
 for(const setting of ['persistSession:false','autoRefreshToken:false','detectSessionInUrl:false'])
  assert.ok(src.includes(setting),'guest auth isolation missing: '+setting);
 assert.doesNotMatch(src,/localStorage\s*\.|sessionStorage\s*\./);
});
test('the customer iframe must remain opaque-origin sandboxed',()=>{
 const src=read('register.html');
 const tag=src.match(/<iframe\b[^>]*id=["']swivel-customer-frame["'][^>]*>/i)?.[0]
  ||src.match(/<iframe\b[^>]*id=["']swivel-customer-frame["'][\s\S]*?>/i)?.[0];
 assert.ok(tag,'swivel customer frame missing');
 assert.match(tag,/\bsandbox=/i);
 assert.doesNotMatch(tag,/allow-same-origin/i,'same-origin iframe exposes cashier window');
});
test('legacy two-device pairing cannot be offered to the cashier',()=>{
 const src=read('swivel-mode.js');
 for(const id of ['pair','pair-quick','pair-setup'])
  assert.ok(src.includes("'"+id+"'"),'missing legacy pairing hide: '+id);
 assert.match(src,/document\.querySelector\('\.pos-device-mode'\)\?\.remove\(\)/);
});

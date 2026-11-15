'use strict';
// Independent, staging-only regression gate for the single-swivel handoff.
// This intentionally verifies the existing fail-closed behavior until an
// independently tested checkout-scoped cross-origin gateway replaces it.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../swivel-mode.js'),'utf8');

function handlerBetween(start,end){
 const a=source.indexOf(start);
 const b=source.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'expected swivel handler markers');
 return source.slice(a,b);
}
test('customer handoff remains fail-closed before legacy pairing and cashier checkout',()=>{
 const handler=handlerBetween("$('start').onclick=async()=>{","$('swivel-resume').onclick");
 const guard=handler.indexOf('return;\n  swivelStarting=true');
 assert.ok(guard>=0,'do not remove fail-closed guard without isolated capability and tests');
 assert.ok(handler.indexOf('await pairing()')>guard);
 assert.ok(handler.indexOf('await originalBegin()')>guard);
});
test('customer resume remains fail-closed before legacy display pairing',()=>{
 const handler=handlerBetween("$('swivel-resume').onclick=async()=>{","$('swivel-lock').onclick");
 assert.match(handler,/secure customer isolation is implemented/);
 assert.match(handler,/return;\s*const button=/);
});
test('legacy display is same-origin and therefore must never become an active handoff',()=>{
 assert.match(source,/target\.origin!==location\.origin/);
 assert.match(source,/new URL\('display\.html',location\.href\)/);
 assert.match(source,/SECURITY: A same-origin customer iframe/);
});
test('customer handoff must not be enabled by merely deleting its early return',()=>{
 const handoff=handlerBetween("$('start').onclick=async()=>{","$('swivel-resume').onclick");
 assert.match(handoff,/db\.auth\.signOut\(\{scope:'local'\}\)/);
 assert.match(handoff,/db\.auth\.getSession\(\)/);
 // The sign-out calls alone are NOT a sufficient cross-origin security boundary.
 assert.ok(handoff.indexOf('return;\n  swivelStarting=true')>=0);
});

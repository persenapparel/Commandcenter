'use strict';
// Staging structural guard only, NOT proof of badge auth/RLS or browser security.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('pos/register.js','utf8');
const done=source.match(/async function showCompletedSale\(saved\)\{([\s\S]*?)\n\}/);
assert.ok(done, 'completed sale handler exists');
assert.match(done[1],/checkout=null;cart=\[\]/,'cart and checkout cleared');
assert.match(done[1],/setRegisterOpen\(false\)/,'return to home after sale completion');
assert.match(done[1],/by\('receipt'\)\.hidden=true/,'hide prior receipt on home');
const finish=source.match(/async function finishOrder\(\)\{([\s\S]*?)\n\}/);
assert.ok(finish, 'Finish Order exists');
assert.match(finish[1],/await check\(db\.rpc\('pos_finish_order'/,'authoritative server closeout');
assert.match(finish[1],/await showCompletedSale\(saved\)/,'return home only after server closeout');
assert.ok(finish[1].indexOf('await check(db.rpc(\'pos_finish_order\'')<finish[1].indexOf('await showCompletedSale(saved)'),'finish RPC precedes home');
console.log('PASS: successful finish transitions to home (static only; browser/DB not tested)');

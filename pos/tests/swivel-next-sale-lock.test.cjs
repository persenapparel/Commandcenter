'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const ui=fs.readFileSync('pos/swivel-mode.js','utf8');
const register=fs.readFileSync('pos/register.js','utf8');
const bridge=fs.readFileSync('pos/staging-handoff-bridge.cjs','utf8');
const adapter=fs.readFileSync('pos/handoff-rpc-adapter.cjs','utf8');

test('guest cleanup keeps opaque cashier cover until branded badge lock',()=>{
 assert.match(ui,/clearGuest:async\(\)=>\{clearGuest\(\{keepLocked:true\}\);\}/);
 assert.match(ui,/renderNextSaleLock\(\)/);
 assert.match(ui,/overlay\.hidden=false/);
 assert.match(ui,/lock\.hidden=true/);
 assert.match(ui,/Register locked/);
 assert.match(ui,/bridge\.unlockNextSale\(badge\)/);
 assert.match(ui,/unlockRegisterForNextSale:\(\)=>api\.reopenRegisterAfterVerifiedBadge\(\)/);
 assert.match(bridge,/const reopened=await unlockRegisterForNextSale\(\)/);
 assert.match(bridge,/if\(reopened!==true\)throw Error\('Verified register reopening failed'\)/);
 assert.match(register,/function reopenRegisterAfterVerifiedBadge\(\)/);
 assert.match(register,/setRegisterOpen\(false,true\);/);
 assert.match(ui,/showEmployeeHome\(bridge\?\.state\?\.\(\)\.employee\)/);
 assert.doesNotMatch(ui,/bridge=null;/);
 assert.match(ui,/function ensureFreshGuestFrame\(\)/);
 assert.match(ui,/ensureFreshGuestFrame\(\);\s*const active=ensureBridge\(\)/);
 assert.match(ui,/guestFrame=null;\s*host\.replaceChildren\(\)/);
});
test('employee badge unlock is server-bound to original shift and not PIN reset',()=>{
 assert.match(adapter,/rpc\('pos_staff_resume_shift'/);
 assert.match(adapter,/p_shift_id:shiftId,p_shift_secret:shiftSecret,p_badge:badge,p_register:registerId/);
 assert.match(adapter,/if\(active\)throw Error\('Guest checkout must be closed/);
 assert.match(bridge,/const proof=await adapter\.verifyIdleBadge\(badge\)/);
 assert.match(bridge,/if\(locked\)throw Error\('Scan staff badge to unlock register/);
 assert.match(bridge,/locked=true; \/\/ Keep shift in memory/);
 assert.doesNotMatch(bridge,/async function unlockNextSale[\s\S]*pos_staff_start_shift/);
});
test('active employee shift blocks any legacy owner checkout bypass',()=>{
 assert.match(register,/async function begin\(\)\{if\(window\.PersenPOSSwivel\?\.active\?\.\(\)\)/);
 assert.match(register,/async function cancel\(\)\{if\(window\.PersenPOSSwivel\?\.active\?\.\(\)\)/);
});

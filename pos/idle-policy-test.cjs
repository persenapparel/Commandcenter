'use strict';
const assert=require('node:assert/strict');
const p=require('./idle-policy.js');
const empty=()=>({stage:'catalog',cart:[],checkout:null,pendingCash:null,
 pendingNetwork:false,pendingPrint:false,unsavedChanges:false,
 signatureActive:false,editing:false,processing:false,recovery:false,authPending:false});
assert.equal(p.IDLE_MS,30000);
assert.equal(p.shouldLock(empty(),29999,0),false);
assert.equal(p.shouldLock(empty(),30000,0),true);
assert.equal(p.shouldLock(empty(),30001,1),true);
assert.equal(p.shouldLock(empty(),30000,1),false,'genuine interaction resets timer');
assert.equal(p.shouldLock(empty(),100,101),false,'clock anomalies fail closed');
for(const key of ['checkout','pendingCash','pendingNetwork','pendingPrint','unsavedChanges','signatureActive','editing','processing','recovery','authPending']){
 const s=empty();s[key]=key==='checkout'?{id:'active'}:true;
 assert.equal(p.shouldLock(s,30001,0),false,key+' must prevent idle reset');
}
for(const stage of ['awaiting_customer','contact_received','payment','cash_entry','signature','processing','saving','pending_network','printing','editing','recovery']){
 const s=empty();s.stage=stage;assert.equal(p.shouldLock(s,30001,0),false,stage);
}
const active=empty();active.cart=[{qty:1}];assert.equal(p.shouldLock(active,30001,0),false);
assert.equal(p.shouldLock(null,30001,0),false);
assert.equal(p.afterAuthoritativeFinish({serverCommitted:true,saleId:'sale-1',receiptJobsPersisted:true}),true);
for(const x of [{serverCommitted:false,saleId:'sale-1',receiptJobsPersisted:true},
 {serverCommitted:true,saleId:'sale-1',receiptJobsPersisted:false},
 {serverCommitted:true,receiptJobsPersisted:true},null]){
 assert.equal(p.afterAuthoritativeFinish(x),false);
}
console.log('PASS: pure 30-second idle and committed-sale safety policy (not wired to UI/auth)');

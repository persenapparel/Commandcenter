'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const p=require('./employee-policy.js');
test('only owner or manager can refund; only owner approves exceptions',()=>{
 for(const role of ['employee','manager','owner'])assert.equal(p.allowed(role,'sales'),true);
 assert.equal(p.allowed('employee','refunds'),false);
 assert.equal(p.allowed('manager','refunds'),true);
 assert.equal(p.allowed('owner','refunds'),true);
 assert.equal(p.allowed('manager','return_exception'),false);
 assert.equal(p.allowed('owner','return_exception'),true);
 assert.equal(p.allowed('employee','inventory_adjust'),false);
 assert.equal(p.allowed('manager','inventory_adjust'),true);
 assert.equal(p.allowed('administrator','refunds'),false);
 assert.equal(p.allowed('owner','unlisted'),false);
});
test('30-second idle threshold is fail-closed on invalid time',()=>{
 assert.equal(p.shouldLock(0,29999,false),false);
 assert.equal(p.shouldLock(0,30000,false),true);
 assert.equal(p.shouldLock(NaN,30000,false),true);
 assert.equal(p.shouldLock(31000,30000,false),true);
 assert.equal(p.shouldLock(0,31000,true),false);
});
test('scan accepts safe SKU, not secrets or multi-line input',()=>{
 assert.equal(p.scanSku(' XMAS-RED-M '),'XMAS-RED-M');
 for(const x of ['','A','a\nb','<script>','foo bar',null,'a'.repeat(65)])assert.equal(p.scanSku(x),null);
});
test('completion requires durable server and receipt queue confirmation',()=>{
 assert.equal(p.canCompleteSale({serverConfirmed:true,receiptQueued:true}),true);
 assert.equal(p.canCompleteSale({serverConfirmed:true,receiptQueued:false}),false);
 assert.equal(p.canCompleteSale({serverConfirmed:false,receiptQueued:true}),false);
 assert.equal(p.canCompleteSale(),false);
});

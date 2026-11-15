'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createQueue,sanitizeSale}=require('../offline-cash-queue.js');
const sample={items:[{sku:'XMAS-HOOD-M',quantity:2,unit_cents:4000,customer_email:'private@example.com'}],total_cents:8000,tender_cents:10000,cashier_id:'cashier_logan',customer_phone:'5551234567'};
function store(){const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v)};}
let seq=0;
const queue=s=>createQueue(s,()=>('offline_sale_'+String(++seq).padStart(12,'0')),()=> '2026-11-12T12:00:00Z');
test('only minimum non-PII fields persist',()=>{const q=queue(store());const x=q.enqueue(sample);assert.equal(x.sale.change_cents,2000);assert.equal(JSON.stringify(q.list()).includes('private@example.com'),false);assert.equal(JSON.stringify(q.list()).includes('5551234567'),false);});
test('reject underpayment and invalid line items',()=>{assert.throws(()=>sanitizeSale({...sample,tender_cents:7000}));assert.throws(()=>sanitizeSale({...sample,items:[{sku:'x',quantity:-1,unit_cents:4000}]}));});
test('sync retries unknown responses and accepts confirmed idempotent duplicate',async()=>{const q=queue(store());q.enqueue(sample);let calls=0;let r=await q.sync(async()=>{calls++;throw Error('network');});assert.equal(r.failed,1);assert.equal(q.list()[0].state,'pending');r=await q.sync(async()=>({status:'already_recorded'}));assert.equal(r.synced,1);assert.equal(q.list()[0].state,'synced');await q.sync(async()=>{throw Error('should not retry');});assert.equal(calls,1);q.acknowledgeSynced(q.list()[0].id);assert.equal(q.list().length,0);});
test('conflicting inventory remains queued for human resolution',async()=>{const q=queue(store());q.enqueue(sample);const r=await q.sync(async()=>({status:'conflict'}));assert.equal(r.conflicts,1);assert.equal(q.list()[0].state,'conflict');assert.throws(()=>q.acknowledgeSynced(q.list()[0].id));});
test('never purge pending transaction',()=>{const q=queue(store());q.enqueue(sample);assert.throws(()=>q.acknowledgeSynced(q.list()[0].id));});
test('storage failures propagate before claiming a saved sale',()=>{const q=queue({getItem:()=>null,setItem:()=>{throw Error('storage full');}});assert.throws(()=>q.enqueue(sample),/storage full/);});

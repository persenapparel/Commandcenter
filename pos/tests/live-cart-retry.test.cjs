'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('pos/register.js','utf8');
const block=source.slice(source.indexOf('let draftTimer='),source.indexOf('/* Quick cashier catalog:'));
function setup(){
 const writes=[],timers=[];let fail=true;
 const db={from:()=>({update:payload=>({eq:()=>({eq:async()=>{
  writes.push(payload);return {error:fail?Error('offline'):null};
 }})})})};
 const ctx=vm.createContext({db,user:{id:'owner'},register:{id:'register'},checkout:null,document:{body:{classList:{contains:()=>false}}},cart:[{name:'Hoodie',size:'M',qty:1,unit_cents:4000}],current:()=>({subtotal_cents:4000,discount_cents:0,tax_cents:0,total_cents:4000}),notice:()=>{},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearTimeout:()=>{}});
 vm.runInContext(block,ctx);return {ctx,writes,timers,reconnect:()=>{fail=false}};
}
test('failed draft delivery retries without another scan and sends newest cart',async()=>{
 const x=setup();vm.runInContext('queueCustomerPreview()',x.ctx);await vm.runInContext('flushCustomerPreview()',x.ctx);
 assert.equal(x.writes.length,1);assert.equal(x.timers.at(-1).ms,2000);
 x.ctx.cart[0].qty=2;x.reconnect();await vm.runInContext('flushCustomerPreview()',x.ctx);
 assert.equal(x.writes.length,2);assert.equal(x.writes[1].draft_snapshot.items[0].qty,2);
 assert.equal(vm.runInContext('draftDirty || draftSending || draftFailureShown',x.ctx),false);
});
test('retry after checkout begins clears draft instead of republishing old cart',async()=>{
 const x=setup();vm.runInContext('queueCustomerPreview()',x.ctx);await vm.runInContext('flushCustomerPreview()',x.ctx);
 x.ctx.checkout={id:'checkout'};x.reconnect();await vm.runInContext('flushCustomerPreview()',x.ctx);
 assert.equal(x.writes[1].draft_snapshot.items.length,0);
});

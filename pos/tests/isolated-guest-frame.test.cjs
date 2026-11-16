'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createIsolatedGuestFrame}=require('../isolated-guest-frame.cjs');
const checkout='22222222-2222-4222-8222-222222222222';
const cap='a'.repeat(64);
function mock(){
 const sent=[];let frame=null;
 const window={location:{origin:'https://cashier.example.test'},document:{
  createElement:tag=>{
   assert.equal(tag,'iframe');
   const attrs={};
   const listeners=new Map();
   frame={
    attrs,contentWindow:{postMessage:(data,origin)=>sent.push({data,origin})},
    setAttribute:(k,v)=>attrs[k]=v,
    removeAttribute:k=>delete attrs[k],
    addEventListener:(k,fn)=>listeners.set(k,fn),
    removeEventListener:k=>listeners.delete(k),
    remove:()=>{frame.removed=true},
    emit:k=>listeners.get(k)?.()
   };
   return frame;
  }
 }};
 const container={appendChild:()=>{frame.emit('load')}};
 return {window,container,sent,getFrame:()=>frame};
}
test('exactly one checkout token is transferred to known separate guest origin, never navigation or storage',async()=>{
 const t=mock();
 const session=createIsolatedGuestFrame({window:t.window,container:t.container,
  cashierOrigin:'https://cashier.example.test',
  guestOrigin:'https://customer.example.test'});
 assert.equal(session.active(),false);
 await session.open({checkoutId:checkout,capability:cap});
 assert.equal(session.active(),true);
 assert.deepEqual(t.sent,[{data:{type:'persen:checkout-bootstrap:v1',
  checkoutId:checkout,capability:cap},origin:'https://customer.example.test'}]);
 assert.equal(t.getFrame().src,'https://customer.example.test/');
 assert.equal(t.getFrame().attrs.sandbox,'allow-scripts allow-forms allow-same-origin');
 assert.equal(t.getFrame().attrs.referrerpolicy,'no-referrer');
 assert.ok(!Object.values(t.getFrame().attrs).join(' ').includes(cap));
 assert.ok(!t.getFrame().src.includes(cap));
 await assert.rejects(session.open({checkoutId:checkout,capability:cap}),/already open/);
 session.dispose();
 assert.equal(session.active(),false);
 assert.equal(t.getFrame().removed,true);
});
test('reject same-origin, HTTP and wrong cashier contexts',()=>{
 const t=mock(),base={window:t.window,container:t.container,cashierOrigin:'https://cashier.example.test'};
 assert.throws(()=>createIsolatedGuestFrame({...base,guestOrigin:'https://cashier.example.test'}),/Isolated/);
 assert.throws(()=>createIsolatedGuestFrame({...base,guestOrigin:'http://customer.example.test'}),/Isolated/);
 assert.throws(()=>createIsolatedGuestFrame({...base,cashierOrigin:'https://different.example.test',guestOrigin:'https://customer.example.test'}),/Isolated/);
});
test('reject invalid token before iframe is created',async()=>{
 const t=mock();
 const session=createIsolatedGuestFrame({window:t.window,container:t.container,
  cashierOrigin:'https://cashier.example.test',guestOrigin:'https://customer.example.test'});
 await assert.rejects(session.open({checkoutId:checkout,capability:'wrong'}),/Invalid checkout-specific/);
 assert.equal(t.getFrame(),null);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createIsolatedGuestFrame}=require('../isolated-guest-frame.cjs');
const checkout='22222222-2222-4222-8222-222222222222';
const cap='a'.repeat(64);
function mock(){
 const sent=[];let frame=null;
 const listeners=new Map();
 const window={
  location:{origin:'https://cashier.example.test'},
  addEventListener:(k,fn)=>listeners.set(k,fn),
  removeEventListener:(k,fn)=>{if(listeners.get(k)===fn)listeners.delete(k)},
  setTimeout:()=>123,clearTimeout:()=>{},
  deliver:(origin,source,data)=>listeners.get('message')?.({origin,source,data}),
  document:{createElement:tag=>{
   assert.equal(tag,'iframe');
   const attrs={};
   frame={
    attrs,contentWindow:{postMessage:(data,origin)=>sent.push({data,origin})},
    setAttribute:(k,v)=>attrs[k]=v,
    removeAttribute:k=>delete attrs[k],
    remove:()=>{frame.removed=true}
   };
   return frame;
  }}
 };
 const container={appendChild:()=>{}};
 return {window,container,sent,getFrame:()=>frame};
}
function create(t) {
 return createIsolatedGuestFrame({window:t.window,container:t.container,
  cashierOrigin:'https://cashier.example.test',
  guestOrigin:'https://customer.example.test'});
}
test('exact guest origin + exact iframe must identify itself BEFORE token transfer',async()=>{
 const t=mock(),session=create(t);
 const ready=session.open({checkoutId:checkout,capability:cap});
 assert.equal(session.active(),true);
 assert.equal(t.sent.length,0,'frame loading does not transmit the guest bearer');
 t.window.deliver('https://evil.example.test',t.getFrame().contentWindow,{type:'persen:checkout-ready:v1'});
 t.window.deliver('https://customer.example.test',{}, {type:'persen:checkout-ready:v1'});
 assert.equal(t.sent.length,0,'forged origin and forged source are ignored');
 t.window.deliver('https://customer.example.test',t.getFrame().contentWindow,{type:'persen:checkout-ready:v1'});
 await ready;
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
 const t=mock(),session=create(t);
 await assert.rejects(session.open({checkoutId:checkout,capability:'wrong'}),/Invalid checkout-specific/);
 assert.equal(t.getFrame(),null);
});
test('closing while awaiting ready rejects and never sends a token',async()=>{
 const t=mock(),session=create(t);
 const waiting=session.open({checkoutId:checkout,capability:cap});
 session.dispose();
 await assert.rejects(waiting,/disposed before ready/);
 assert.equal(t.sent.length,0);
 assert.equal(session.active(),false);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createIsolatedGuestFrame}=require('../isolated-guest-frame.cjs');
const checkout='22222222-2222-4222-8222-222222222222';
const cap='a'.repeat(64);
function mock(){
 const sent=[];let frame=null;let onMessage=null;let timer=null;
 const window={location:{origin:'https://cashier.example.test'},
  addEventListener:(type,fn)=>{if(type==='message')onMessage=fn},
  removeEventListener:(type,fn)=>{if(type==='message'&&onMessage===fn)onMessage=null},
  setTimeout:fn=>{timer=fn;return 1},
  clearTimeout:()=>{timer=null},
  document:{
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
 const container={appendChild:()=>{}};
 return {window,container,sent,getFrame:()=>frame,
  ready:(origin='https://customer.example.test',source=frame.contentWindow)=>
   onMessage?.({origin,source,data:{type:'persen:checkout-ready:v1'}})};
}
test('exactly one checkout token is transferred to known separate guest origin, never navigation or storage',async()=>{
 const t=mock();
 const session=createIsolatedGuestFrame({window:t.window,container:t.container,
  cashierOrigin:'https://cashier.example.test',
  guestOrigin:'https://customer.example.test',
  guestEntryUrl:'https://customer.example.test/pos-guest/'});
 assert.equal(session.active(),false);
 const opening=session.open({checkoutId:checkout,capability:cap});
 t.ready('https://untrusted.example.test');
 assert.equal(t.sent.length,0);
 t.ready('https://customer.example.test',{});
 assert.equal(t.sent.length,0);
 t.ready();
 await opening;
 assert.equal(session.active(),true);
 assert.deepEqual(t.sent,[{data:{type:'persen:checkout-bootstrap:v1',
  checkoutId:checkout,capability:cap},origin:'https://customer.example.test'}]);
 assert.equal(t.getFrame().src,'https://customer.example.test/pos-guest/');
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
 assert.throws(()=>createIsolatedGuestFrame({...base,guestOrigin:'https://customer.example.test',guestEntryUrl:'https://customer.example.test/not-a-guest-page'}),/Isolated/);
 assert.throws(()=>createIsolatedGuestFrame({...base,guestOrigin:'https://customer.example.test',guestEntryUrl:'https://cashier.example.test/pos-guest/'}),/Isolated/);
});
test('reject invalid token before iframe is created',async()=>{
 const t=mock();
 const session=createIsolatedGuestFrame({window:t.window,container:t.container,
  cashierOrigin:'https://cashier.example.test',guestOrigin:'https://customer.example.test'});
 await assert.rejects(session.open({checkoutId:checkout,capability:'wrong'}),/Invalid checkout-specific/);
 assert.equal(t.getFrame(),null);
});

const {mountCustomerCheckout}=require('../customer-checkout-entry.cjs');
function guestFrameHarness({href='https://customer.example.test/',topLevel=false,sendFails=false}={}) {
 const sent=[],listeners=new Set();
 const parent={postMessage:(message,origin)=>{
  if(sendFails)throw Error('Parent unavailable');
  sent.push({message,origin});
 }};
 const window={
  location:{href},opener:null,parent,
  addEventListener:(type,handler)=>{if(type==='message')listeners.add(handler)},
  removeEventListener:(type,handler)=>{if(type==='message')listeners.delete(handler)}
 };
 if(topLevel)window.parent=window;
 return {window,sent,listeners};
}
test('guest entry emits credential-free READY to exact cashier origin after listener registration',()=>{
 const h=guestFrameHarness();
 const root={};
 const mounted=mountCustomerCheckout({
  window:h.window,root,cashierOrigin:'https://cashier.example.test/',
  apiOrigin:'https://api.example.test/',fetchImpl:async()=>{}
 });
 assert.equal(h.listeners.size,1);
 assert.deepEqual(h.sent,[{
  message:{type:'persen:checkout-ready:v1'},
  origin:'https://cashier.example.test'
 }]);
 assert.equal(h.sent[0].message.capability,undefined);
 mounted.dispose();
 assert.equal(h.listeners.size,0);
});
test('guest entry never emits READY from unsafe same-origin or top-level context',()=>{
 for(const config of [
  {href:'https://cashier.example.test/'},
  {topLevel:true},
  {href:'http://customer.example.test/'},
  {href:'https://customer.example.test/?token=should-not-appear'}
 ]) {
  const h=guestFrameHarness(config);
  assert.throws(()=>mountCustomerCheckout({
   window:h.window,root:{},cashierOrigin:'https://cashier.example.test/',
   apiOrigin:'https://api.example.test/',fetchImpl:async()=>{}
  }));
  assert.equal(h.sent.length,0);
  assert.equal(h.listeners.size,0);
 }
});
test('guest READY send failure removes bootstrap listener and fails closed',()=>{
 const h=guestFrameHarness({sendFails:true});
 assert.throws(()=>mountCustomerCheckout({
  window:h.window,root:{},cashierOrigin:'https://cashier.example.test/',
  apiOrigin:'https://api.example.test/',fetchImpl:async()=>{}
 }),/READY handshake unavailable/);
 assert.equal(h.listeners.size,0);
});

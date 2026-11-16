'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createIsolatedGuestFrame} = require('../isolated-guest-frame.cjs');
const checkoutId = '22222222-2222-4222-8222-222222222222';
const capability = 'b'.repeat(64);
function harness() {
  const messages = [];
  const listeners = new Set();
  let frame;
  const window = {
    location: {origin:'https://cashier.example.test'},
    addEventListener(type,fn) { if(type==='message') listeners.add(fn); },
    removeEventListener(type,fn) { if(type==='message') listeners.delete(fn); },
    setTimeout() { return 1; },
    clearTimeout() {},
    document: {createElement() {
      frame = {
        contentWindow: {postMessage(data,origin) { messages.push({data,origin}); }},
        setAttribute() {}, removeAttribute() {}, remove() { this.removed=true; }
      };
      return frame;
    }}
  };
  const session=createIsolatedGuestFrame({
    window,container:{appendChild(){}},
    cashierOrigin:'https://cashier.example.test',
    guestOrigin:'https://customer.example.test'
  });
  const emit=(source,data,origin='https://customer.example.test')=>{
    for(const fn of [...listeners]) fn({source,origin,data});
  };
  return {session,messages,emit,getFrame:()=>frame,listeners};
}
test('guest capability is never delivered on forged READY payload or duplicate READY replay',async()=>{
  const h=harness();
  const pending=h.session.open({checkoutId,capability});
  const frame=h.getFrame();
  h.emit(frame.contentWindow,{type:'persen:checkout-bootstrap:v1'});
  h.emit(frame.contentWindow,{type:'persen:checkout-ready:v1'},'https://evil.example.test');
  h.emit({}, {type:'persen:checkout-ready:v1'});
  assert.equal(h.messages.length,0);
  h.emit(frame.contentWindow,{type:'persen:checkout-ready:v1'});
  await pending;
  h.emit(frame.contentWindow,{type:'persen:checkout-ready:v1'});
  assert.equal(h.messages.length,1);
  assert.equal(h.messages[0].origin,'https://customer.example.test');
  h.session.dispose();
  assert.equal(h.listeners.size,0);
});
test('disposed pending frame rejects and cannot receive capability from stale READY',async()=>{
  const h=harness();
  const pending=h.session.open({checkoutId,capability});
  const old=h.getFrame();
  h.session.dispose();
  await assert.rejects(pending,/disposed/);
  h.emit(old.contentWindow,{type:'persen:checkout-ready:v1'});
  assert.equal(h.messages.length,0);
  assert.equal(h.session.active(),false);
  assert.equal(h.listeners.size,0);
});

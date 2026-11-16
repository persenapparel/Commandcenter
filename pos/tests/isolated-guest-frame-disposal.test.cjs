'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {createIsolatedGuestFrame}=require('../isolated-guest-frame.cjs');
const uuid='12345678-1234-4234-8234-123456789abc';
const capability='a'.repeat(64);
function harness(){
 let listener=null,removed=false,posts=[],timeout=null;
 const frame={
  setAttribute(){},removeAttribute(){},remove(){removed=true},
  contentWindow:{postMessage:(data,target)=>posts.push({data,target})}
 };
 const window={
  location:{origin:'https://cashier.example.test'},
  document:{createElement:()=>frame},
  addEventListener:(type,fn)=>{if(type==='message')listener=fn},
  removeEventListener:(type,fn)=>{if(type==='message'&&listener===fn)listener=null},
  setTimeout:fn=>{timeout=fn;return 1},
  clearTimeout:()=>{timeout=null}
 };
 const container={appendChild(){}};
 return {
  api:createIsolatedGuestFrame({window,container,cashierOrigin:'https://cashier.example.test',guestOrigin:'https://guest.example.test'}),
  ready:(origin='https://guest.example.test',source=frame.contentWindow)=>listener?.({origin,source,data:{type:'persen:checkout-ready:v1'}}),
  timeout:()=>timeout?.(),posts,wasRemoved:()=>removed,hasListener:()=>!!listener
 };
}
test('disposing before READY rejects pending open and clears listener',async()=>{
 const h=harness();const pending=h.api.open({checkoutId:uuid,capability});
 h.api.dispose();
 await assert.rejects(pending,/disposed before ready/);
 assert.equal(h.hasListener(),false);
 assert.equal(h.wasRemoved(),true);
 assert.equal(h.posts.length,0);
 assert.equal(h.api.active(),false);
});
test('READY from wrong origin or window never receives bearer',async()=>{
 const h=harness();const pending=h.api.open({checkoutId:uuid,capability});
 h.ready('https://attacker.example.test');
 h.ready('https://guest.example.test',{});
 assert.equal(h.posts.length,0);
 h.ready();await pending;
 assert.equal(h.posts.length,1);
 assert.equal(h.posts[0].target,'https://guest.example.test');
 assert.equal(h.posts[0].data.capability,capability);
 h.api.dispose();assert.equal(h.api.active(),false);
});
test('missing verified READY times out fail-closed',async()=>{
 const h=harness();const pending=h.api.open({checkoutId:uuid,capability});
 h.timeout();
 await assert.rejects(pending,/ready timeout/);
 assert.equal(h.posts.length,0);
 assert.equal(h.api.active(),false);
 assert.equal(h.hasListener(),false);
});

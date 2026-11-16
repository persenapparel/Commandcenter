'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {createIsolatedGuestFrame}=require('../isolated-guest-frame.cjs');
const uuid='12345678-1234-4234-8234-123456789abc';
const capability='a'.repeat(64);
function harness(){
 let listener=null,removed=false,posts=[];
 const frame={
  setAttribute(){},removeAttribute(){},remove(){removed=true},
  addEventListener(type,fn){if(type==='load')listener=fn},
  removeEventListener(type,fn){if(type==='load'&&listener===fn)listener=null},
  contentWindow:{postMessage:(data,target)=>posts.push({data,target})}
 };
 const window={location:{origin:'https://cashier.example.test'},document:{createElement:()=>frame}};
 const container={appendChild(){}};
 return {api:createIsolatedGuestFrame({window,container,cashierOrigin:'https://cashier.example.test',guestOrigin:'https://guest.example.test'}),load:()=>listener?.(),posts,wasRemoved:()=>removed,hasListener:()=>!!listener};
}
test('disposing before iframe load rejects pending open and clears listener',async()=>{
 const h=harness();const pending=h.api.open({checkoutId:uuid,capability});
 h.api.dispose();
 await assert.rejects(pending,/disposed before bootstrap/);
 assert.equal(h.hasListener(),false);
 assert.equal(h.wasRemoved(),true);
 assert.equal(h.posts.length,0);
 assert.equal(h.api.active(),false);
});
test('successful load posts only to exact guest origin',async()=>{
 const h=harness();const pending=h.api.open({checkoutId:uuid,capability});
 h.load();await pending;
 assert.equal(h.posts.length,1);
 assert.equal(h.posts[0].target,'https://guest.example.test');
 h.api.dispose();assert.equal(h.api.active(),false);
});

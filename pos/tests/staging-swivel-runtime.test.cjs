'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createStagingSwivelRuntime}=require('../staging-swivel-runtime.cjs');
function env(){
 const denied=()=>{},ids={},forms=[];
 const el=()=>({
  hidden:false,inert:false,onclick:denied,value:'',
  addEventListener(){},removeAttribute(){},
  setAttribute(){},append(...nodes){this.children=(this.children||[]).concat(nodes)},
  focus(){},blur(){},querySelector(){return null}
 });
 for(const id of ['start','swivel-overlay','workspace','swivel-customer-frame',
  'swivel-lock','swivel-unlock-form','swivel-password',
  'swivel-unlock-submit','swivel-keep-customer','register-launch','swivel-unlock-message'])
  ids[id]=el();
 const doc={
  getElementById:id=>ids[id]||null,
  createElement:()=>{const x=el();forms.push(x);return x},
  body:{classList:{add(){},remove(){}}},
  activeElement:{blur(){}}
 };
 const window={location:{origin:'https://cashier.staging.example'},
  document:doc};
 return {ids,forms,doc,window,denied};
}
function setup(e,preflight) {
 return createStagingSwivelRuntime({
  window:e.window,client:{rpc:async()=>({data:null,error:{message:'not installed'}})},
  cashierOrigin:'https://cashier.staging.example',
  guestOrigin:'https://guest.staging.example',
  beginAuthorizedCheckout:async()=>{throw Error('No staging checkout')},
  showCompletedSale:async()=>{},
  serverAndBrowserPreflight:preflight
 });
}
test('unverified deploy never replaces disabled checkout handlers or loads customer frame',async()=>{
 const e=env();const original=e.ids.start.onclick;
 const stage=setup(e,async()=>false);
 assert.equal(await stage.enable(),false);
 assert.equal(stage.active(),false);
 assert.equal(e.ids.start.onclick,original);
 assert.equal(e.forms.length,0);
});
test('missing server preflight fails closed before binding controls',async()=>{
 const e=env(),original=e.ids.start.onclick;
 const stage=setup(e,async()=>{throw Error('RPC not deployed')});
 assert.equal(await stage.enable(),false);
 assert.equal(e.ids.start.onclick,original);
 await assert.rejects(stage.finishAfterAuthoritativeOrder({id:'fake'}));
});
test('verified TEST adapter installs badge login without opening guest checkout',async()=>{
 const e=env();
 const stage=setup(e,async()=>true);
 assert.equal(await stage.enable(),true);
 assert.equal(stage.active(),true);
 assert.notEqual(e.ids.start.onclick,e.denied);
 assert.equal(e.ids['swivel-customer-frame'].hidden,true);
 assert.ok(e.forms.length>=5,'badge, PIN and sign-in form are created');
 assert.equal(e.ids['register-launch'].children.length,1);
});

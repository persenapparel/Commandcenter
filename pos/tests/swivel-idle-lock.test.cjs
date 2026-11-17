'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function harness(){
 let now=0,tick,phase='cashier',locked=false,idleLocked=false;
 const elements=new Map(),events={};
 function element(id){
  if(!elements.has(id))elements.set(id,{value:'',hidden:false,inert:false,textContent:'',open:false,
   listeners:{},addEventListener(type,fn){this.listeners[type]=fn},
   querySelector(selector){return element(id+selector)},replaceChildren(){},focus(){},
   close(){this.open=false},showModal(){this.open=true}});
  return elements.get(id);
 }
 const main=element('main'),header=element('header'),dialog=element('main-dialog');
 const document={hidden:false,getElementById:element,
  querySelector:()=>null,querySelectorAll:selector=>selector==='body > main, body > header'?[main,header]:dialog.open?[dialog]:[],
  addEventListener(type,fn){events[type]=fn},
  body:{dataset:{},classList:{add(){},remove(){}}}};
 const bridge={
  state:()=>({employee:{firstName:'Alex'},locked,idleLocked,checkout:{phase}}),
  startShift:async()=>({firstName:'Alex'}),handToCustomer:async()=>{phase='guest'},
  lockForIdle(){if(locked||!['cashier','payment'].includes(phase))return false;locked=true;idleLocked=true;return true},
  async unlockIdle(badge){if(badge!=='correct')throw Error('denied');locked=false;idleLocked=false;return {firstName:'Alex'}}
 };
 const window={addEventListener(type,fn){events[type]=fn},
  PersenPOSRegister:{ready:()=>true,notice(){}},
  PersenPOSHandoffConfig:{guestEntryUrl:'https://commandcenter-4yg.pages.dev/pos-guest/'},
  PersenPOSSecureHandoff:{createStagingHandoffBridge:()=>bridge,createIsolatedGuestFrame:()=>({})}};
 vm.runInNewContext(fs.readFileSync('pos/swivel-mode.js','utf8'),{
  document,window,location:{origin:'https://persen-pos-staging.pages.dev'},URL,
  Date:{now:()=>now},setInterval(fn,ms){assert.equal(ms,1000);tick=fn}
 });
 const submit=()=>element('swivel-return-form').listeners.submit({preventDefault(){}});
 return {element,main,header,dialog,document,bridge,submit,
  async start(){element('swivel-badge').value='badge';element('swivel-pin').value='1234';await element('swivel-shift-form').listeners.submit({preventDefault(){}});phase='cashier'},
  time:value=>{now=value},tick:()=>tick(),phase:value=>{phase=value},
  event(type){let prevented=false,stopped=false;events[type]({preventDefault(){prevented=true},stopImmediatePropagation(){stopped=true}});return {prevented,stopped}}
 };
}
test('30-second idle gate closes top-layer dialogs and makes underlying cashier inert',async()=>{
 const h=harness();await h.start();h.dialog.open=true;
 h.time(29999);h.tick();assert.equal(h.bridge.state().locked,false);
 h.time(30000);h.tick();assert.equal(h.bridge.state().locked,true);
 assert.equal(h.main.inert,true);assert.equal(h.header.inert,true);assert.equal(h.dialog.open,false);
 assert.equal(h.element('swivel-overlay').hidden,false);
 assert.equal(h.element('swivel-keep-customer').hidden,true);
 h.element('swivel-return-badge').value='wrong';await h.submit();assert.equal(h.main.inert,true);
 h.element('swivel-return-badge').value='correct';await h.submit();
 assert.equal(h.main.inert,false);assert.equal(h.element('swivel-overlay').hidden,true);
 h.time(59999);h.tick();assert.equal(h.bridge.state().locked,false);
 h.time(60000);h.tick();assert.equal(h.bridge.state().locked,true);
});
test('activity resets idle deadline but an event after suspended timers is blocked before cart mutation',async()=>{
 const h=harness();await h.start();h.time(20000);h.event('pointerdown');
 h.time(49000);h.tick();assert.equal(h.bridge.state().locked,false);
 h.time(50001);assert.deepEqual(h.event('keydown'),{prevented:true,stopped:true});
 assert.equal(h.bridge.state().locked,true);
});
test('backgrounding locks cashier immediately and never interrupts customer entry',async()=>{
 const h=harness();await h.start();h.phase('guest');h.time(31000);h.tick();
 assert.equal(h.bridge.state().locked,false);
 h.document.hidden=true;h.event('visibilitychange');assert.equal(h.bridge.state().locked,false);
 h.phase('payment');h.event('visibilitychange');assert.equal(h.bridge.state().locked,true);
});

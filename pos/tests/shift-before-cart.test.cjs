'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness(){
 const elements=new Map();let employee=null,opens=0,handoffs=0,resolveLogin;
 const element=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:false,open:false,textContent:'',listeners:{},addEventListener(t,f){this.listeners[t]=f},querySelector:s=>element(String(s).replace(/^#/,'')),focus(){},append(){},insertAdjacentElement(){},setAttribute(){},replaceChildren(){},showModal(){this.open=true},close(){this.open=false}});return elements.get(id)};
 const bridge={state:()=>({employee,locked:false,checkout:employee?{phase:'cashier',pending:false}:null}),
  startShift:()=>new Promise(resolve=>{resolveLogin=()=>{employee={firstName:'Luke',expiresAt:new Date(Date.now()+3600000).toISOString()};resolve(employee)}}),
  handToCustomer:async()=>{handoffs++},lockForIdle:()=>false};
 const window={addEventListener(){},PersenPOSRegister:{ready:()=>true,notice(){},openEmployeeMode(){assert.ok(employee);opens++;return true},closeEmployeeSalesViewForHome(){assert.ok(employee);return true},reopenRegisterAfterVerifiedBadge(){assert.ok(employee);opens++;return true}},
  PersenPOSHandoffConfig:{guestEntryUrl:'https://a76dbeb5.commandcenter-4yg.pages.dev/pos-guest/'},
  PersenPOSSecureHandoff:{createStagingHandoffBridge:()=>bridge,createIsolatedGuestFrame:()=>({})}};
 const document={getElementById:element,createElement:()=>element('dynamic-'+elements.size),querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},body:{dataset:{},classList:{add(){},remove(){}}}};
 vm.runInNewContext(fs.readFileSync('pos/swivel-mode.js','utf8'),{window,document,location:{origin:'https://persen-pos-staging.pages.dev'},URL,Date,setInterval(){}});
 return {window,element,bridge,counts:()=>({opens,handoffs}),finish:()=>resolveLogin(),expire:()=>{employee.expiresAt=new Date(0).toISOString()},submit:()=>element('swivel-shift-form').listeners.submit({preventDefault(){}})};
}
test('initial shift gate awaits authorization, shows employee choices before a cart, clears credentials',async()=>{
 const h=harness(),api=h.window.PersenPOSSwivel;
 assert.equal(api.canUseRegister(),false);api.requestRegisterOpen();assert.equal(h.element('swivel-shift-dialog').open,true);
 h.element('swivel-badge').value='private-badge-value';h.element('swivel-pin').value='123456';
 const pending=h.submit();assert.deepEqual(h.counts(),{opens:0,handoffs:0});assert.equal(api.canUseRegister(),false);
 await h.submit();assert.deepEqual(h.counts(),{opens:0,handoffs:0});
 h.finish();await pending;
 assert.deepEqual(h.counts(),{opens:0,handoffs:0});assert.equal(api.canUseRegister(),true);
 assert.equal(h.element('employee-home-greeting').textContent,'Hello, Luke!');
 assert.ok(h.element('employee-home-sales').listeners.click);
 h.element('employee-home-sales').listeners.click();
 assert.deepEqual(h.counts(),{opens:1,handoffs:0});
 assert.equal(h.element('swivel-badge').value,'');assert.equal(h.element('swivel-pin').value,'');
 assert.equal(h.element('swivel-shift-dialog').open,false);
 h.expire();assert.equal(api.canUseRegister(),false);
});
test('cancelled and rejected sign-in never open cart or guest',async()=>{
 const h=harness();h.window.PersenPOSSwivel.requestRegisterOpen();h.element('swivel-pin').value='123456';
 h.element('swivel-shift-cancel').onclick();assert.equal(h.element('swivel-pin').value,'');assert.equal(h.element('swivel-shift-dialog').open,false);
 h.bridge.startShift=async()=>{throw Error('denied')};h.element('swivel-badge').value='wrong';h.element('swivel-pin').value='wrong';
 await h.submit();assert.deepEqual(h.counts(),{opens:0,handoffs:0});assert.equal(h.window.PersenPOSSwivel.canUseRegister(),false);
});
test('register opening fails closed without runtime and routes event opening through same shift gate',()=>{
 const src=fs.readFileSync('pos/register.js','utf8');
 const fn=src.slice(src.indexOf('function setRegisterOpen('),src.indexOf("by('open-register').onclick"));
 const effects=[];const runtime={canUseRegister:()=>false,requestRegisterOpen:()=>effects.push('gate')};
 const context=vm.createContext({window:{PersenPOSSwivel:runtime},checkout:null,stock:[{}],employeeMode:'sales',readyToSell:()=>true,notice(){},document:{body:{dataset:{},classList:{toggle:()=>effects.push('open')}}},sessionStorage:{setItem(){}},queueCustomerPreview(){}});
 vm.runInContext(fn,context);context.setRegisterOpen(true);assert.deepEqual(effects,['gate']);
 context.window.PersenPOSSwivel=undefined;context.setRegisterOpen(true);assert.deepEqual(effects,['gate']);
 context.window.PersenPOSSwivel={canUseRegister:()=>true};context.setRegisterOpen(true);assert.deepEqual(effects,['gate','open']);
 assert.match(src,/event-setup-dialog'\)\.close\(\);setRegisterOpen\(true\)/);
});

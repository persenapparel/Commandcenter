'use strict';
// Isolated, dependency-free regression for iPad guest Next and no-signature checkout.
// Run from repository root: node --test pos/guest-next-touch.test.cjs
const test=require('node:test');
const assert=require('node:assert/strict');
const {createCustomerCheckout}=require('./customer-checkout-screen.cjs');
class Element {
 constructor(tag,doc){
  this.tagName=tag;this.ownerDocument=doc;this.children=[];this.listeners={};
  this.style={};this.attrs={};this.className='';this.value='';this.checked=false;
  this.type='';this._text='';
  this.classList={toggle:(name,on)=>{
   const parts=new Set(this.className.split(' ').filter(Boolean));
   if(on)parts.add(name);else parts.delete(name);
   this.className=[...parts].join(' ');
  }};
 }
 set textContent(v){this._text=v;this.children=[]}
 get textContent(){return this._text||this.children.map(child=>child.textContent).join('')}
 append(...children){this.children.push(...children)}
 replaceChildren(...children){this.children=[];this.append(...children)}
 setAttribute(name,value){this.attrs[name]=value}
 addEventListener(name,callback){(this.listeners[name]??=[]).push(callback)}
 emit(name,options={}){for(const callback of this.listeners[name]||[])
  callback({type:name,target:this,cancelable:true,preventDefault(){},...options});}
 click(){this.emit('click')}
 all(selector){
  const found=[];
  function visit(node){for(const child of node.children){
   if(selector.startsWith('.')?child.className.split(' ').includes(selector.slice(1)):child.tagName===selector)found.push(child);
   visit(child);
  }}
  visit(this);return found;
 }
 querySelector(selector){return this.all(selector)[0]||null}
 querySelectorAll(selector){return this.all(selector)}
}
test('iPad tap advances total once, skipped contact steps and no-signature final submit',async()=>{
 const doc={createElement:tag=>new Element(tag,doc)};
 const root=new Element('div',doc);
 let submitted=null;
 const checkout=createCustomerCheckout({
  root,origin:'https://commandcenter-4yg.pages.dev',
  cashierOrigin:'https://pos.persenapparel.com',
  guestApi:{
   view:async()=>({
    checkoutId:'00000000-0000-4000-8000-000000000001',
    total:'$25.00',items:[{name:'Shirt',quantity:1,lineTotal:'$25.00'}]
   }),
   submit:async data=>{submitted=data;return {accepted:true}}
  }
 });
 await checkout.start();
 assert.match(root.textContent,/Here is your total/);
 const first=root.querySelector('.guest-next');
 assert.ok(first);
 first.emit('pointerdown',{pointerType:'touch',clientX:60,clientY:70});
 first.emit('pointerup',{pointerType:'touch',clientX:61,clientY:69});
 first.click(); // synthetic click must not advance a second time
 assert.match(root.textContent,/Step 2 of 5/);
 root.querySelector('.guest-skip').click();
 assert.match(root.textContent,/Step 3 of 5/);
 root.querySelector('.guest-skip').click();
 assert.match(root.textContent,/Step 4 of 5/);
 const cash=root.all('input').find(input=>input.value==='cash');
 assert.ok(cash);cash.checked=true;cash.emit('change');
 root.querySelector('.guest-next').click();
 assert.match(root.textContent,/Step 5 of 5/);
 assert.equal(root.all('input').some(input=>input.type==='text'),false,
  'No typed signature should remain');
 root.querySelector('.guest-next').click();
 for(let i=0;i<8;i++)await Promise.resolve();
 assert.ok(submitted);
 assert.equal(submitted.paymentPreference,'cash');
 assert.equal(Object.hasOwn(submitted,'signature'),false);
 assert.equal(Object.hasOwn(submitted,'signatureException'),false);
});
test('touch scrolling does not activate Next',async()=>{
 const doc={createElement:tag=>new Element(tag,doc)};
 const root=new Element('div',doc);
 await createCustomerCheckout({
  root,origin:'https://commandcenter-4yg.pages.dev',
  cashierOrigin:'https://pos.persenapparel.com',
  guestApi:{view:async()=>({checkoutId:'00000000-0000-4000-8000-000000000001',total:'$10.00',items:[{name:'Tee',quantity:1,lineTotal:'$10.00'}]}),submit:async()=>({accepted:true})}
 }).start();
 const next=root.querySelector('.guest-next');
 next.emit('pointerdown',{pointerType:'touch',clientX:1,clientY:1});
 next.emit('pointerup',{pointerType:'touch',clientX:1,clientY:40});
 assert.match(root.textContent,/Step 1 of 5/);
});

test('iPad Touch Events advance Next when Pointer Events and synthesized click are missing',async()=>{
 const doc={createElement:tag=>new Element(tag,doc)};
 const root=new Element('div',doc);
 await createCustomerCheckout({
  root,origin:'https://commandcenter-4yg.pages.dev',
  cashierOrigin:'https://pos.persenapparel.com',
  guestApi:{view:async()=>({checkoutId:'00000000-0000-4000-8000-000000000001',total:'$10.00',items:[{name:'Tee',quantity:1,lineTotal:'$10.00'}]}),submit:async()=>({accepted:true})}
 }).start();
 const next=root.querySelector('.guest-next');
 next.emit('touchstart',{touches:[{identifier:4,clientX:50,clientY:30}]});
 next.emit('touchend',{changedTouches:[{identifier:4,clientX:51,clientY:31}]});
 next.click(); // iPad may still send a compatibility click; never advance twice
 assert.match(root.textContent,/Step 2 of 5/);
});
test('iPad scrolling touch gesture never activates Next',async()=>{
 const doc={createElement:tag=>new Element(tag,doc)};
 const root=new Element('div',doc);
 await createCustomerCheckout({
  root,origin:'https://commandcenter-4yg.pages.dev',
  cashierOrigin:'https://pos.persenapparel.com',
  guestApi:{view:async()=>({checkoutId:'00000000-0000-4000-8000-000000000001',total:'$10.00',items:[{name:'Tee',quantity:1,lineTotal:'$10.00'}]}),submit:async()=>({accepted:true})}
 }).start();
 const next=root.querySelector('.guest-next');
 next.emit('touchstart',{touches:[{identifier:5,clientX:50,clientY:30}]});
 next.emit('touchend',{changedTouches:[{identifier:5,clientX:50,clientY:100}]});
 assert.match(root.textContent,/Step 1 of 5/);
});

test('iPad compatibility click retargeted onto next screen never skips its question',async()=>{
 const doc={createElement:tag=>new Element(tag,doc)};
 const root=new Element('div',doc);
 await createCustomerCheckout({
  root,origin:'https://commandcenter-4yg.pages.dev',
  cashierOrigin:'https://pos.persenapparel.com',
  guestApi:{view:async()=>({checkoutId:'00000000-0000-4000-8000-000000000001',total:'$10.00',items:[{name:'Tee',quantity:1,lineTotal:'$10.00'}]}),submit:async()=>({accepted:true})}
 }).start();
 const next=root.querySelector('.guest-next');
 next.emit('pointerdown',{pointerType:'touch',clientX:50,clientY:50});
 next.emit('pointerup',{pointerType:'touch',clientX:51,clientY:50});
 // Safari may retarget the compatibility click to the new Skip button
 // because the touched Next button was removed by the navigation redraw.
 root.querySelector('.guest-skip').click();
 assert.match(root.textContent,/Step 2 of 5/,'one finger tap must advance only to phone');
 // A second, genuinely independent finger tap must be accepted immediately.
 const skip=root.querySelector('.guest-skip');
 skip.emit('pointerdown',{pointerType:'touch',clientX:49,clientY:50});
 skip.emit('pointerup',{pointerType:'touch',clientX:49,clientY:50});
 assert.match(root.textContent,/Step 3 of 5/,'the next finger tap still works quickly');
});

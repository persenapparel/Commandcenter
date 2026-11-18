'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createCustomerCheckout} = require('../customer-checkout-screen.cjs');

function fakeDom() {
  const document = {createElement: tag => new Node(tag)};
  class Node {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.events = {};
      this.textContent = ''; this.className = ''; this.value = '';
      this.type = ''; this.checked = false; this.style = {};
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = [...children]; }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, handler) { (this.events[name] ||= []).push(handler); }
    trigger(name) { for (const handler of (this.events[name] || [])) handler({preventDefault(){}}); }
    get classList() {
      return {toggle: (name, on) => {
        const classes = this.className.split(/\s+/).filter(Boolean).filter(x => x !== name);
        if (on) classes.push(name);
        this.className = classes.join(' ');
      }};
    }
    querySelectorAll(selector) {
      const output = [];
      const visit = node => {
        for (const child of node.children) {
          const matches = selector.startsWith('.')
            ? child.className.split(/\s+/).includes(selector.slice(1))
            : child.tagName === selector;
          if (matches) output.push(child);
          visit(child);
        }
      };
      visit(this);
      return output;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  const root = new Node('div');
  root.ownerDocument = document;
  return root;
}
function screen(root) {
  const heading = root.querySelector('h1');
  return heading && heading.textContent;
}
function press(root, className = 'guest-next') {
  const button = root.querySelector('.' + className);
  assert.ok(button, 'expected ' + className);
  button.trigger('click');
}
function create(root, overrides = {}) {
  const calls = [];
  const guestApi = {
    async view() { return {checkoutId:'00000000-0000-4000-8000-000000000001',
      items:[{name:'Christmas Hoodie · Large',quantity:1,lineTotal:'$25.00'}],total:'$25.00'}; },
    async submit(answers) { calls.push(answers); return {accepted:true}; },
    ...overrides
  };
  return {
    calls,
    controller:createCustomerCheckout({
      root, guestApi,
      origin:'https://guest-staging.example',
      cashierOrigin:'https://cashier-staging.example'
    })
  };
}

test('customer wizard shows total, phone, email, payment and confirmation on separate screens', async () => {
  const root = fakeDom();
  const {controller,calls} = create(root);
  await controller.start();
  assert.equal(screen(root),'Here is your total.');
  assert.equal(root.querySelector('.guest-grand-total').textContent,'$25.00');
  assert.equal(root.querySelectorAll('.guest-item').length,1);
  assert.equal(calls.length,0);
  press(root);
  assert.equal(screen(root),"What's your phone number?");
  press(root,'guest-skip');
  assert.equal(screen(root),"What's your email address?");
  press(root,'guest-skip');
  assert.equal(screen(root),'How would you like to pay?');
  const choices=root.querySelectorAll('input').filter(x=>x.type==='radio');
  assert.deepEqual(choices.map(x=>x.value),['cash','venmo','applecash']);
  press(root);
  assert.equal(screen(root),'How would you like to pay?');
  assert.ok(root.querySelector('.guest-error').textContent.includes('Please select'));
  const selected=choices.find(x=>x.value==='applecash');
  selected.checked=true;
  selected.trigger('change');
  press(root);
  assert.equal(screen(root),'One last thing.');
  assert.equal(calls.length,0,'customer payment choice never charges or submits');
  const name=root.querySelectorAll('input').find(x=>x.type==='text');
  name.value='Customer Name'; name.trigger('input');
  press(root);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(screen(root),'Thank you!');
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0],{
    checkoutId:'00000000-0000-4000-8000-000000000001',
    phone:'',email:'',marketingConsent:false,
    signature:'Customer Name',signatureException:false,
    paymentPreference:'apple_cash_info'
  });
  assert.equal(calls[0].paymentPreference,'apple_cash_info',
    'guest records the preference, never any payment authorization');
  assert.equal(Object.hasOwn(calls[0],'paymentVerified'),false);
  assert.ok(root.querySelector('.guest-selected-payment').textContent.includes('Apple Cash'));
  assert.ok(root.querySelector('.guest-notice').textContent.includes('does not mean you have paid'));
});

test('skipping invalid partial contact does not send stale answers', async () => {
  const root=fakeDom(), {controller,calls}=create(root);
  await controller.start();
  press(root);
  const phone=root.querySelectorAll('input').find(x=>x.type==='tel');
  assert.equal(phone.readOnly,true);
  assert.equal(phone.inputMode,'none');
  for(const digit of '631'){
   const key=root.querySelectorAll('.guest-dialkey').find(x=>x.textContent===digit);
   assert.ok(key);key.trigger('click');
  }
  assert.equal(phone.value,'631');
  press(root);
  assert.equal(screen(root),"What's your phone number?",'invalid partial phone is blocked');
  press(root,'guest-skip');
  const email=root.querySelectorAll('input').find(x=>x.type==='email');
  email.value='invalid'; email.trigger('input');
  press(root);
  assert.equal(screen(root),"What's your email address?",'invalid email is blocked');
  press(root,'guest-skip');
  const cash=root.querySelectorAll('input').find(x=>x.type==='radio'&&x.value==='cash');
  cash.checked=true; cash.trigger('change');
  press(root);
  const name=root.querySelectorAll('input').find(x=>x.type==='text');
  name.value='Taylor Example'; name.trigger('input');
  press(root);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,1);
  assert.equal(calls[0].phone,'');
  assert.equal(calls[0].email,'');
});

test('guest submission failure fails closed without a paid confirmation', async () => {
  const root=fakeDom(), {controller}=create(root,{
    async submit() { throw Error('network ambiguous'); }
  });
  await controller.start();
  press(root);press(root,'guest-skip');press(root,'guest-skip');
  const cash=root.querySelectorAll('input').find(x=>x.type==='radio'&&x.value==='cash');
  cash.checked=true; cash.trigger('change'); press(root);
  const name=root.querySelectorAll('input').find(x=>x.type==='text');
  name.value='Jordan Example'; name.trigger('input'); press(root);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(screen(root),'Checkout unavailable');
  assert.match(root.querySelector('p').textContent,/return the iPad/i);
});

test('iPad dialpad enters numeric values with delete and clear, without a keyboard',async()=>{
 const root=fakeDom(),{controller}=create(root);
 await controller.start();press(root);
 const phone=root.querySelectorAll('input').find(x=>x.type==='tel');
 assert.equal(phone.readOnly,true);
 assert.equal(phone.inputMode,'none');
 function hit(text){const button=root.querySelectorAll('.guest-dialkey').find(x=>x.textContent===text);assert.ok(button);button.trigger('click')}
 assert.equal(root.querySelectorAll('.guest-dialkey').length,12);
 for(const digit of '63155501234')hit(digit);
 assert.equal(phone.value,'63155501234');
 hit('⌫');assert.equal(phone.value,'6315550123');
 hit('Clear');assert.equal(phone.value,'');
 press(root,'guest-skip');
 assert.equal(screen(root),"What's your email address?");
});

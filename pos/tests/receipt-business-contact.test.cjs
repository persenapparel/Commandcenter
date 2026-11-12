'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const c=require('../receipt-business-contact.js');
test('only configured business contacts appear, not customer delivery data',()=>{
 const contact={email:'service@persenapparel.com',phone:'(631) 555-0123'};
 const output=c.text(contact,'Mother');
 assert.match(output,/service@persenapparel.com/);
 assert.match(output,/Cashier: Mother/);
 assert.doesNotMatch(output,/customer/i);
});
test('never invent an owner phone or email',()=>{
 const output=c.text({},'');
 assert.match(output,/persenapparel.com/);
 assert.doesNotMatch(output,/@/);
 assert.doesNotMatch(output,/Phone:/);
});
test('HTML escaping prevents injected tags',()=>{
 assert.throws(()=>c.html({email:'<img src=x>'}),/Invalid business support email/);
 assert.throws(()=>c.html({},'<script>'),/Invalid cashier/);
 assert.equal(c.cashierFirstName('Logan Persen'),'Logan');
});
test('reject malformed business contacts',()=>{
 for(const email of ['not-an-email','a@b','a@b..com'])assert.throws(()=>c.normalize({email}),/email/);
 assert.throws(()=>c.normalize({phone:'call me'}),/phone/);
});
test('same footer can be used for print, email and SMS without sending',()=>{
 assert.deepEqual(c.lines({email:'service@persenapparel.com'},'Logan'),[
  'Persen Apparel','Email: service@persenapparel.com','Website: persenapparel.com','Cashier: Logan'
 ]);
 assert.match(c.html({},'Owner'),/Cashier: Owner/);
});
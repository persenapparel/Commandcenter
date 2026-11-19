'use strict';
// Post-build staging brand/holiday contract, running on CI placeholders only.
// This must never contact production, process payments, or load credentials.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p));
const txt=p=>read(p).toString('utf8');
function png(p){
 const bytes=read(p);
 assert.ok(bytes.length>1024,p+' must contain the actual brand artwork, not a placeholder');
 assert.ok(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),p+' must be PNG');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 assert.ok(width>=64&&height>=64,p+' artwork unexpectedly too small');
 return crypto.createHash('sha256').update(bytes).digest('hex');
}
test('staging cashier/customer builds ship identical official Persen logo bytes',()=>{
 const original=png('assets/persen-logo.png');
 assert.equal(png('pos-dist/assets/persen-logo.png'),original);
 assert.equal(png('pos-guest-dist/persen-logo.png'),original);
});
test('employee dashboard, cashier, inventory, staff test and back office reference the official logo',()=>{
 for(const file of ['index.html','register.html','inventory.html','staff-test.html','admin.html']){
  const html=txt('pos-dist/'+file);
  assert.match(html,/src="assets\/persen-logo\.png"/,'Missing logo in '+file);
  assert.match(html,/(?:alt="Persen Apparel logo"|class="brand")/,'Missing brand identifier in '+file);
 }
 const register=txt('pos-dist/register.html');
 assert.match(register,/christmas-premium\.css/);
 const home=txt('pos-dist/swivel-mode.js');
 assert.match(home,/employee-home-brand/);
 assert.match(home,/assets\/persen-logo\.png/);
});
test('guest displays logo on its credential-free origin and keeps CSP isolation',()=>{
 const html=txt('pos-guest-dist/index.html');
 assert.match(html,/<img class="guest-brand-logo" src="\/persen-logo\.png" alt="Persen Apparel logo"/);
 assert.match(html,/href="\/holiday-premium\.css"/);
 assert.match(txt('pos-guest-dist/_headers'),/img-src 'self'/);
 for(const forbidden of ['config.js','backend.js','register.js','pos.js','staff-test.js','persen-staff-credentials.json'])
  assert.ok(!fs.existsSync(path.join(root,'pos-guest-dist',forbidden)), 'Guest build must never contain '+forbidden);
});
test('premium artwork is local to the authorized staging bundles',()=>{
 for(const name of ['christmas-premium-santa.svg','christmas-premium-reindeer.svg','christmas-premium-village.svg']){
  assert.ok(read('pos-dist/'+name).length>1000,name+' missing');
 }
 for(const name of ['christmas-premium-reindeer.svg','christmas-premium-village.svg']){
  assert.equal(crypto.createHash('sha256').update(read('pos-dist/'+name)).digest('hex'),
   crypto.createHash('sha256').update(read('pos-guest-dist/'+name)).digest('hex'),
   'Guest art must match protected cashier art: '+name);
 }
 assert.ok(!fs.existsSync(path.join(root,'pos-guest-dist','christmas-premium-santa.svg')),
  'Customer origin only needs its own reindeer + landscape art');
});

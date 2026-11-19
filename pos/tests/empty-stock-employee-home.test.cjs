'use strict';
/* Staging-only isolated unit tests: do not connect to Supabase, create
   checkouts, mutate inventory, or weaken the employee badge gate. */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('pos/register.js','utf8');
const section=(a,b)=>{
 const start=src.indexOf(a),end=src.indexOf(b,start);
 assert.ok(start>=0&&end>start,'Could not locate scoped register function: '+a);
 return src.slice(start,end);
};
const script=[
 section('function setRegisterOpen(open,verifiedBadge=false){',"by('open-register').onclick"),
 section('function reopenRegisterAfterVerifiedBadge(){','function closeEmployeeSalesViewForHome(){'),
 section('function openEmployeeMode(mode){','async function showSecureHandoffHome(){')
].join('\n');
function harness({hasSaleable=false,authorized=true}={}){
 const state={notices:[],requests:[],modes:[],draws:0,preview:0,scans:0};
 const flags=new Set(['pos-register-closed']);
 const classes={contains:x=>flags.has(x),toggle:(x,on)=>{if(on)flags.add(x);else flags.delete(x);}};
 const scan={value:'old',focus(){state.scans++}};
 const ready=hasSaleable?[{saleable:true}]:[];
 const context={
  window:{PersenPOSSwivel:{canUseRegister:()=>authorized,requestRegisterOpen:()=>state.requests.push('badge')}},
  db:{},user:{},register:{id:'test-register'},
  stock:ready,cart:[],checkout:null,pendingCash:null,busy:false,employeeMode:'sales',
  readyToSell:x=>x.saleable===true,
  notice:x=>state.notices.push(x),
  document:{body:{classList:classes,dataset:{}}},
  sessionStorage:{setItem(){}},
  queueCustomerPreview:()=>state.preview++,
  activeStaffRole:()=>'cashier',
  setScanMode:x=>state.modes.push(x),
  draw:()=>state.draws++,
  by:id=>id==='scan-code'?scan:null
 };
 vm.runInNewContext(script,context);
 return {context,state,classes,scan};
}
test('empty stock still permits next-sale badge return to employee Home',()=>{
 const h=harness();
 assert.equal(h.context.reopenRegisterAfterVerifiedBadge(),true);
 assert.equal(h.classes.contains('pos-register-closed'),true);
 assert.deepEqual(h.state.requests,[]);
});
test('Inventory Check opens with zero available products',()=>{
 const h=harness();
 assert.equal(h.context.openEmployeeMode('inventory'),true);
 assert.equal(h.classes.contains('pos-register-closed'),false);
 assert.deepEqual(h.state.modes,['inventory']);
 assert.equal(h.state.scans,1);
});
test('Sales refuses empty stock, with a useful employee-facing message',()=>{
 const h=harness();
 assert.throws(()=>h.context.openEmployeeMode('sales'),/No priced, in-stock Sales Products/);
 assert.equal(h.classes.contains('pos-register-closed'),true);
 assert.equal(h.state.draws,0);
});
test('Sales opens when products are available and badge is authorized',()=>{
 const h=harness({hasSaleable:true});
 assert.equal(h.context.openEmployeeMode('sales'),true);
 assert.equal(h.classes.contains('pos-register-closed'),false);
 assert.deepEqual(h.state.modes,['sell']);
});
test('Initial Open Register requests employee badge even if inventory is empty',()=>{
 const h=harness({hasSaleable:false,authorized:false});
 h.context.setRegisterOpen(true);
 assert.equal(h.classes.contains('pos-register-closed'),true);
 assert.deepEqual(h.state.requests,['badge']);
 assert.deepEqual(h.state.notices,[]);
});
test('Signed-in Sales remains blocked with empty stock',()=>{
 const h=harness({hasSaleable:false,authorized:true});
 h.context.setRegisterOpen(true);
 assert.equal(h.classes.contains('pos-register-closed'),true);
 assert.match(h.state.notices[0],/First add at least one priced Sales Product/);
});

test('No employee may bypass the badge gate to open a register',()=>{
 const h=harness({hasSaleable:true,authorized:false});
 h.context.setRegisterOpen(true);
 assert.equal(h.classes.contains('pos-register-closed'),true);
 assert.deepEqual(h.state.requests,['badge']);
});
test('Inventory Check also requires verified employee authorization',()=>{
 const h=harness({authorized:false});
 assert.throws(()=>h.context.openEmployeeMode('inventory'),/Employee shift is not active/);
 assert.equal(h.classes.contains('pos-register-closed'),true);
});

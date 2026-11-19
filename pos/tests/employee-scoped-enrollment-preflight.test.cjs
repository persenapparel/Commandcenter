'use strict';
/* Staging-only badge setup preflight tests. No credentials, DB or network. */
const test=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('pos/register.js','utf8');
const from=source.indexOf('let employeeSlotStatus=null');
const to=source.indexOf('async function changeEmployeeRegisterAccess(allowed)',from);
assert.ok(from>=0&&to>from,'badge setup status source section exists');
const body=source.slice(from,to);
const uuid='12345678-1234-4234-8234-123456789abc';
function harness(result){
 const calls=[],access=[];
 const fields=new Map();
 const field=id=>{
  if(!fields.has(id))fields.set(id,{disabled:false,textContent:'',value:'',hidden:false});
  return fields.get(id);
 };
 const form={querySelector(selector){
  if(selector==="[name=slot]")return {value:'1'};
  throw Error('Unexpected secret or form field read: '+selector);
 }};
 const db={rpc(name,args){
  calls.push({name,args});
  if(name!=='pos_owner_badge_slot_status')throw Error('Unexpected mutation RPC');
  if('p_register' in args&&result.legacy)return Promise.resolve({data:null,error:{code:'PGRST202',message:'Could not find the function public.pos_owner_badge_slot_status'}});
  return Promise.resolve({data:result.status,error:null});
 }};
 const ctx={
  db,register:{id:uuid},
  by:id=>id==='staff-badge-setup-form'?form:field(id),
  showEmployeeRegisterAccess:s=>access.push(s),
  check:async p=>{const {data,error}=await p;if(error)throw error;return data}
 };
 vm.runInNewContext(body,ctx,{filename:'badge-setup-status-preflight'});
 return {ctx,calls,access,field};
}
test('legacy slot-status response disables new badge enrollment before PIN is entered',async()=>{
 const h=harness({legacy:true,status:{slot:1,reserved:false,activated:false}});
 await h.ctx.refreshEmployeeSlotStatus();
 assert.equal(h.field('save-staff-badge').disabled,true);
 assert.match(h.field('staff-setup-readiness').textContent,/reviewed register-scoped database update/);
 assert.deepEqual(h.calls.map(x=>x.name),['pos_owner_badge_slot_status','pos_owner_badge_slot_status']);
 assert.equal(h.calls.some(x=>'p_badge' in x.args||'p_pin' in x.args),false);
});
test('reviewed scoped status enables enrollment for available employee slot',async()=>{
 const h=harness({status:{slot:1,reserved:false,activated:false,staffId:null,registerAllowed:false}});
 await h.ctx.refreshEmployeeSlotStatus();
 assert.equal(h.field('save-staff-badge').disabled,false);
 assert.match(h.field('staff-setup-readiness').textContent,/Employee 1 is available/);
 assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].args.p_register,uuid);
});
test('activated cashier slot stays reserved but can test existing badge',async()=>{
 const h=harness({status:{slot:1,reserved:true,activated:true,firstName:'Test',staffId:uuid,registerAllowed:true}});
 await h.ctx.refreshEmployeeSlotStatus();
 assert.equal(h.field('save-staff-badge').disabled,true);
 assert.equal(h.field('test-staff-badge-pin').disabled,false);
 assert.equal(h.access.length,1);
});
test('malformed or incomplete scoped response cannot enable enrollment',async()=>{
 const h=harness({status:{slot:1,reserved:false,activated:false,staffId:'not-a-uuid',registerAllowed:false}});
 await h.ctx.refreshEmployeeSlotStatus();
 assert.equal(h.field('save-staff-badge').disabled,true);
 assert.match(h.field('staff-setup-readiness').textContent,/database update/);
});
console.log('Employee badge enrollment staging capability preflight tests completed.');

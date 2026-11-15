'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {escposReceipt,escposTwoCopies,drawerKick,createProcessor}=require('../epson-station/agent.cjs');
const UUID1='00000000-0000-4000-8000-000000000001';
const UUID2='00000000-0000-4000-8000-000000000002';
const sample={sale_id:UUID1,cashier_name:'Colleen',items:[{name:'Hoodie',qty:1,unit_cents:4000,color:'Red',size:'M'}],subtotal_cents:4000,discount_cents:0,tax_cents:0,total_cents:4000,tendered_cents:5000,change_cents:1000};
const queued=(id=UUID1)=>({id,state:'queued',created_at:new Date().toISOString()});
test('Epson receipt prints totals and cuts, without a drawer-open command',()=>{
 const buf=escposReceipt(sample),str=buf.toString('latin1');
 assert.match(str,/PERSEN APPAREL/);
 assert.match(str,/Change[\s]+\$10.00/);
 assert.ok(buf.subarray(-3).equals(Buffer.from([0x1d,0x56,0])));
 assert.equal(buf.includes(drawerKick()),false);
 assert.doesNotMatch(str,/\nTax\s/,'No tax line on staging receipt');
 assert.match(str,/CUSTOMER COPY/);
 assert.match(str,/Cashier: Colleen/);
});
test('One claimed receipt job contains two copies and two cuts, never a drawer pulse',()=>{
 const buf=escposTwoCopies(sample),str=buf.toString('latin1');
 const cut=Buffer.from([0x1d,0x56,0]);
 assert.equal(str.split('CUSTOMER COPY').length-1,1);
 assert.equal(str.split('MERCHANT COPY').length-1,1);
 assert.equal(str.split('Cashier: Colleen').length-1,2);
 assert.equal(buf.toString('hex').split(cut.toString('hex')).length-1,2);
 assert.equal(buf.includes(drawerKick()),false);
 assert.doesNotMatch(str,/\nTax\s/);
});
test('Epson cash kick is a separate validated ESC/POS pulse',()=>{
 assert.deepEqual([...drawerKick()],[0x1b,0x70,0,50,250]);
 assert.throws(()=>drawerKick({on:100,off:20}),/pulse/i);
});
test('Reject malformed receipt totals and invalid items',()=>{
 assert.throws(()=>escposReceipt({...sample,sale_id:'spoof'}),/verified/);
 assert.throws(()=>escposReceipt({...sample,items:[{name:'Bad',qty:-2}]}),/Invalid item/);
 assert.throws(()=>escposReceipt({...sample,tax_cents:120}),/Tax-bearing sale/);
 assert.throws(()=>escposReceipt(sample,'UNVERIFIED COPY'),/Invalid receipt copy/);
 assert.throws(()=>escposTwoCopies({...sample,cashier_name:undefined}),/cashier identity/i);
});
test('Cash job must be server claimed, only then one command is queued',async()=>{
 const writes=[],calls=[];
 const rpc=async(name,payload)=>{
  calls.push([name,payload]);
  if(name==='pos_claim_drawer_open_job')return {id:UUID1,kind:'cash-sale'};
  return true;
 };
 const processor=createProcessor({rpc,raw:async bytes=>writes.push(bytes),fetchJobs:async()=>[queued()]});
 await processor.drawer();
 await processor.drawer();
 assert.equal(writes.length,1);
 assert.deepEqual([...writes[0]],[0x1b,0x70,0,50,250]);
 assert.equal(calls.filter(x=>x[0]==='pos_claim_drawer_open_job').length,1);
 assert.equal(calls.filter(x=>x[0]==='pos_finish_drawer_open_job').length,1);
});
test('Spoofed or declined server claim cannot cause an open',async()=>{
 let writes=0;
 const processor=createProcessor({rpc:async()=>null,raw:async()=>writes++,fetchJobs:async()=>[queued()]});
 assert.equal(await processor.drawer(),null);
 assert.equal(writes,0);
});
test('Expired queued jobs do not automatically issue old drawer opens',async()=>{
 let count=0;
 const job={id:UUID1,state:'queued',created_at:'2020-01-01T00:00:00.000Z'};
 const processor=createProcessor({rpc:async()=>{count++;},raw:async()=>count++,fetchJobs:async()=>[job]});
 assert.equal(await processor.drawer(),null);assert.equal(count,0);
});
test('Printer failure is acknowledged unconfirmed and never retried automatically',async()=>{
 const calls=[],rpc=async(name,args)=>{calls.push({name,args});return name==='pos_claim_drawer_open_job'?{id:UUID1,kind:'owner-manual'}:true};
 const processor=createProcessor({rpc,raw:async()=>{throw Error('simulated offline');},fetchJobs:async()=>[queued()]});
 const a=await processor.drawer();await processor.drawer();
 assert.equal(a.spooled,false);
 const statuses=calls.filter(x=>x.name==='pos_finish_drawer_open_job');
 assert.equal(statuses.length,1);
 assert.equal(statuses[0].args.p_command_sent,false);
});
test('Receipt claim produces a raw print and does not open drawer',async()=>{
 const writes=[],calls=[],rpc=async(name,arg)=>{calls.push(name);return name==='pos_claim_print_job'?sample:true};
 const processor=createProcessor({rpc,raw:async buf=>writes.push(buf),fetchJobs:async()=>[queued(UUID2)]});
 await processor.receipt();await processor.receipt();
 assert.equal(writes.length,1);
 assert.equal(writes[0].includes(drawerKick()),false);
 assert.match(writes[0].toString('latin1'),/CUSTOMER COPY/);
 assert.match(writes[0].toString('latin1'),/MERCHANT COPY/);
 assert.equal(writes[0].toString('hex').split('1d5600').length-1,2);
 assert.equal(calls.filter(n=>n==='pos_finish_print_job').length,1);
});
test('Never print without authenticated claim',async()=>{
 const processor=createProcessor({rpc:async()=>null,raw:async()=>{throw Error('must not run');},fetchJobs:async()=>[queued()]});
 assert.equal(await processor.receipt(),null);
});

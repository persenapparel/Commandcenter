'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {escposReceipt,drawerKick,createProcessor,testPrinterRaw}=require('../epson-station/agent.cjs');
const UUID1='00000000-0000-4000-8000-000000000001';
const UUID2='00000000-0000-4000-8000-000000000002';
const sample={sale_id:UUID1,items:[{name:'Hoodie',qty:1,unit_cents:4000,color:'Red',size:'M'}],subtotal_cents:4000,discount_cents:0,tax_cents:0,total_cents:4000,tendered_cents:5000,change_cents:1000};
const queued=(id=UUID1)=>({id,state:'queued',created_at:new Date().toISOString()});
test('Epson receipt prints totals and cuts, without a drawer-open command',()=>{
 const buf=escposReceipt(sample),str=buf.toString('latin1');
 assert.match(str,/PERSEN APPAREL/);
 assert.match(str,/Change[\s]+\$10.00/);
 assert.ok(buf.subarray(-3).equals(Buffer.from([0x1d,0x56,0])));
 assert.equal(buf.includes(drawerKick()),false);
});
test('Epson cash kick is a separate validated ESC/POS pulse',()=>{
 assert.deepEqual([...drawerKick()],[0x1b,0x70,0,50,250]);
 assert.throws(()=>drawerKick({on:100,off:20}),/pulse/i);
});
test('Reject malformed receipt totals and invalid items',()=>{
 assert.throws(()=>escposReceipt({...sample,sale_id:'spoof'}),/verified/);
 assert.throws(()=>escposReceipt({...sample,items:[{name:'Bad',qty:-2}]}),/Invalid item/);
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
 assert.equal(calls.filter(n=>n==='pos_finish_print_job').length,1);
});
test('Never print without authenticated claim',async()=>{
 const processor=createProcessor({rpc:async()=>null,raw:async()=>{throw Error('must not run');},fetchJobs:async()=>[queued()]});
 assert.equal(await processor.receipt(),null);
});


test('Receipt validation failures are distinguished from Windows printer failures',async()=>{
 const logs=[],calls=[];let rawCalls=0;
 const invalidSale={...sample,items:[{name:'Hoodie',qty:'1',unit_cents:4000}]};
 const processor=createProcessor({
  rpc:async(name,args)=>{
   calls.push({name,args});
   return name==='pos_claim_print_job'?invalidSale:true;
  },
  raw:async()=>{rawCalls++;},
  fetchJobs:async()=>[queued(UUID2)],
  logger:message=>logs.push(message)
 });
 const result=await processor.receipt();
 await processor.receipt();
 assert.equal(result.spooled,false);
 assert.equal(rawCalls,0);
 assert.equal(calls.filter(c=>c.name==='pos_claim_print_job').length,1);
 assert.equal(calls.find(c=>c.name==='pos_finish_print_job').args.p_error,'Receipt payload rejected');
 assert.match(logs[0],/payload rejected/i);
});
test('Windows RAW errors are visible only on local console, not in queue or retried',async()=>{
 const calls=[],logs=[];let rawCalls=0;
 const processor=createProcessor({
  rpc:async(name,args)=>{
   calls.push({name,args});
   return name==='pos_claim_print_job'?sample:true;
  },
  raw:async()=>{rawCalls++;throw Error('Windows spooler failed (5): printer queue unavailable');},
  fetchJobs:async()=>[queued(UUID2)],
  logger:message=>logs.push(message)
 });
 const result=await processor.receipt();
 await processor.receipt();
 assert.equal(result.spooled,false);
 assert.equal(rawCalls,1);
 assert.equal(calls.filter(c=>c.name==='pos_claim_print_job').length,1);
 assert.equal(calls.find(c=>c.name==='pos_finish_print_job').args.p_error,'RAW receipt spooler failed');
 assert.match(logs[0],/printer queue unavailable/);
 assert.ok(!JSON.stringify(calls).includes('printer queue unavailable'));
});


test('Direct Epson RAW receipt diagnostic bypasses the sale queue and never pulses the drawer',async()=>{
 let sent=0,actualPrinter='',payload=null;
 const length=await testPrinterRaw({
  printer:'Epson staging simulated queue',
  send:async(bytes,options)=>{sent++;payload=bytes;actualPrinter=options.printer;}
 });
 assert.equal(sent,1);
 assert.equal(actualPrinter,'Epson staging simulated queue');
 assert.equal(length,payload.length);
 assert.match(payload.toString('latin1'),/RAW test \(no sale\)/);
 assert.equal(payload.includes(drawerKick()),false);
 assert.ok(payload.subarray(-3).equals(Buffer.from([0x1d,0x56,0])));
});
test('A failed direct RAW diagnostic never claims or retries any server receipt job',async()=>{
 let calls=0;
 await assert.rejects(()=>testPrinterRaw({
  printer:'Missing queue',
  send:async()=>{calls++;throw Error('Windows printer unavailable');}
 }),/Windows printer unavailable/);
 assert.equal(calls,1);
});

test('owner-released receipt may be claimed once at the next attempt on the same station',async()=>{
 const job={...queued(UUID2),attempts:0};
 let writes=0;
 const processor=createProcessor({fetchJobs:async()=>[job],rpc:async name=>name==='pos_claim_print_job'?sample:true,
  raw:async()=>{writes++;if(writes===1)throw Error('offline')}});
 assert.equal((await processor.receipt()).spooled,false);
 assert.equal(await processor.receipt(),null);
 job.attempts=1;
 assert.equal((await processor.receipt()).spooled,true);
 assert.equal(await processor.receipt(),null);
 assert.equal(writes,2);
});

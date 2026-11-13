'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {escposReceipt,drawerKick,createProcessor}=require('../epson-station/agent.cjs');
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
test('Every Epson job contains exactly two cut receipts with distinct roles',()=>{
 const buf=escposReceipt(sample),raw=buf.toString('latin1');
 assert.equal((raw.match(/CUSTOMER COPY/g)||[]).length,1);
 assert.equal((raw.match(/MERCHANT COPY/g)||[]).length,1);
 assert.equal((raw.match(/PERSEN APPAREL/g)||[]).length,2);
 assert.equal((raw.match(/SALE 00000000/g)||[]).length,2);
 let cuts=0;for(let i=0;i<buf.length-2;i++)if(buf[i]===0x1d&&buf[i+1]===0x56&&buf[i+2]===0x00)cuts++;
 assert.equal(cuts,2,'Customer and merchant copy must be individually cut');
 assert.equal(buf.includes(drawerKick()),false,'Copies must never open the drawer');
});
test('Both Epson receipts print saved customer phone, email and show promotion',()=>{
 const sale={...sample,phone:'(631) 555-0199',email:'customer@example.com',
  headline:'Thanks for shopping with us',promotion:'See winter shirts at persenapparel.com',
  footer:'Visit our next event',review_message:'Leave us a Google review'};
 const buf=escposReceipt(sale),raw=buf.toString('latin1');
 const copies=raw.split(Buffer.from([0x1d,0x56,0]).toString('latin1'));
 assert.equal(copies.length,3,'One spool payload must cut customer and merchant copies');
 for(const copy of copies.slice(0,2)){
  assert.match(copy,/Phone: \(631\) 555-0199/);
  assert.match(copy,/Email: customer@example\.com/);
  assert.match(copy,/PROMO: See winter shirts at/);
  assert.match(copy,/persenapparel\.com/);
  assert.match(copy,/Visit our next event/);
  assert.match(copy,/Leave us a Google review/);
 }
 assert.match(copies[0],/Thanks for shopping with us/);
 assert.match(copies[1],/MERCHANT RECORD - RETAIN/);
 assert.equal(buf.includes(drawerKick()),false);
});
test('Long emails and promotions are wrapped rather than clipped',()=>{
 const email='customer.'+'x'.repeat(150)+'@example.com',promotion='Sale promotion '+('longtext '.repeat(30));
 const str=escposReceipt({...sample,email,promotion,phone:'6315550199'}).toString('latin1');
 assert.equal((str.match(/@example\.com/g)||[]).length,2,'Email tail remains on both copies');
 assert.equal((str.match(/longtext/g)||[]).length,60,'Both copies retain the whole promotion');
});
test('Untrusted receipt contact and promotion text cannot inject ESC/POS instructions',()=>{
 const raw=escposReceipt({...sample,phone:'6315550199\x1bp',email:'a@example.com\x1bV',
  promotion:'Special\x1bp\x00 offer'}).toString('latin1');
 assert.equal(raw.includes('Special\x1bp'),false);
 assert.equal(raw.includes('6315550199\x1bp'),false);
 assert.equal((raw.match(/Special p  offer/g)||[]).length,2);
});
test('Bad sale payload never produces two copies',()=>{
 assert.throws(()=>escposReceipt({...sample,items:[{name:'Invalid',qty:0,unit_cents:300}]}),/Invalid item/);
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

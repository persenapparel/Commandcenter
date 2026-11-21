'use strict';
// Staging Epson Print Center: no real receipts, sales, or drawer commands.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function harness(){
 const elements=new Map(),rpcs=[],queries=[],confirmed={value:false};
 function node(tag='div'){
  return {tagName:tag,textContent:'',className:'',disabled:false,children:[],listeners:{},
   append(...items){this.children.push(...items)},
   replaceChildren(...items){this.children=[...items]},
   addEventListener(type,listener){(this.listeners[type]??=[]).push(listener)},
   click(){for(const f of this.listeners.click||[])f({})}};
 }
 const $=id=>elements.get(id)||elements.set(id,node('div')).get(id);
 const document={hidden:false,getElementById:$,createElement:node};
 const job=(id,state,attempts,daysOld)=>({
  id, state,attempts,created_at:new Date(Date.now()-daysOld*86400000).toISOString()
 });
 const receipts=[
  job('11111111-1111-4111-8111-111111111111','failed',1,1),
  job('22222222-2222-4222-8222-222222222222','queued',0,4),
  job('33333333-3333-4333-8333-333333333333','submitted_to_browser',1,1),
  job('44444444-4444-4444-8444-444444444444','printing',1,1),
  job('55555555-5555-4555-8555-555555555555','failed',5,1),
  job('66666666-6666-4666-8666-666666666666','queued',1,4)
 ];
 const drawers=[job('77777777-7777-4777-8777-777777777777','unconfirmed',0,1)];
 const db={
  from(table){
   queries.push(table);
   return {select(){return this},eq(){return this},order(){return this},limit(){return Promise.resolve({
     data:table==='pos_print_jobs'?receipts:drawers,error:null
   });}};
  },
  async rpc(name,params){
   rpcs.push({name,params});
   return {data:true,error:null};
  }
 };
 const window={confirm(){return confirmed.value}};
 const context={document,window,setInterval:()=>1,clearInterval:()=>{},Date,Promise};
 const script=fs.readFileSync(path.join(__dirname,'epson-center.js'),'utf8');
 vm.runInNewContext(script,context,{filename:'epson-center.js'});
 window.PersenEpsonCenter.attach({db,owner:{id:'99999999-9999-4999-8999-999999999999'}});
 async function settle(){for(let i=0;i<15;i++)await Promise.resolve()}
 return {$,rpcs,queries,confirmed,settle,receipts,drawers,db};
}
test('refresh is read-only; failed and unclaimed held receipt can only be explicitly selected',async()=>{
 const h=harness();await h.settle();
 assert.equal(h.rpcs.length,0);
 assert.match(h.$('epson-monitor-status').textContent,/Refresh only updates statuses/);
 const receiptButtons=h.$('epson-receipt-list').children.flatMap(n=>n.children)
  .filter(n=>n.className==='epson-retry');
 assert.equal(receiptButtons.length,2,'only failed under attempt cap and held never-claimed queued receipts');
 const drawerButtons=h.$('epson-drawer-list').children.flatMap(n=>n.children)
  .filter(n=>n.className==='epson-retry');
 assert.equal(drawerButtons.length,0,'cash drawer never gets retry');
 h.$('epson-refresh').click();await h.settle();
 assert.equal(h.rpcs.length,0,'refresh button must never send RPC');
 receiptButtons[0].click();await h.settle();
 assert.equal(h.rpcs.length,0,'cancelling physical-paper verification must not retry');
 h.confirmed.value=true;
 receiptButtons[0].click();await h.settle();
 assert.equal(h.rpcs.length,1);
 assert.equal(h.rpcs[0].name,'pos_retry_print_job');
 assert.equal(h.rpcs[0].params.p_job,h.receipts[0].id);
 assert.match(h.$('epson-action-result').textContent,/Receipt requeued once/);
 receiptButtons[1].click();await h.settle();
 assert.equal(h.rpcs.length,2);
 assert.equal(h.rpcs[1].params.p_job,h.receipts[1].id);
 assert.ok(h.rpcs.every(x=>x.name==='pos_retry_print_job'));
});
test('receipt-only retry SQL refreshes 24-hour cutoff and never requeues uncertain submissions or drawer',()=>{
 const sql=fs.readFileSync(path.join(__dirname,'sql','staging_epson_manual_receipt_retry_20261121.sql'),'utf8');
 assert.match(sql,/set state = 'queued'/);
 assert.match(sql,/created_at = now\(\)/);
 assert.match(sql,/j\.state = 'failed'/);
 assert.match(sql,/j\.state = 'queued' and j\.attempts = 0/);
 assert.match(sql,/j\.attempts < 5/);
 assert.doesNotMatch(sql,/update public\.pos_drawer_open_jobs/);
 assert.doesNotMatch(sql,/state in \('failed',\s*'printing'/);
 assert.match(sql,/is_persen_admin\(\)/);
});

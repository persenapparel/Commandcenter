/* Isolated POS Dell print-station smoke test.
   Stubs the DOM and Supabase queue to prove a claimed paid-sale job reaches window.print().
   NO actual printer is connected; browser acceptance != physical paper output. */
'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=fs.readFileSync('pos/print-station.js','utf8');
const nodes=new Map();
function node(id=''){
 if(nodes.has(id))return nodes.get(id);
 const x={
  id,hidden:false,disabled:false,value:({paper:'50.8x101.6','receipt-margin':'2','receipt-font':'10','receipt-feed':'2'}[id]||'1'),scrollHeight:220,
  className:'',style:{},textContent:'',innerText:'',children:[],onclick:null,onsubmit:null,
  classList:{toggle(){}},
  append(...xs){this.children.push(...xs)},
  replaceChildren(...xs){this.children=xs},
  addEventListener(){},
  setAttribute(){},
  querySelector(){return node('other')},
 };
 nodes.set(id,x);return x;
}
const document={
 head:node('head'),getElementById:id=>node(id),createElement:tag=>node('new-'+tag+'-'+String(nodes.size)),
 addEventListener(){},
};
const events=[],printCalls=[];
let claimed=false,jobState='queued';
const sale={
 sale_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 created_at:'2026-11-04T16:00:00Z',
 items:[{name:'Sample hoodie',qty:1,unit_cents:2500,color:'Green',size:'M'}],
 subtotal_cents:2500,discount_cents:0,tax_cents:0,total_cents:2500,
 tendered_cents:3000,change_cents:500
};
const templates=[],content=[];
const job={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',sale_id:sale.sale_id,state:jobState,attempts:0,created_at:'2026-11-04T16:00:00Z'};
function query(table){
 const q={select(){return this},eq(){return this},gte(){return this},in(){return this},order(){return this},limit(){return this},
   then(resolve,reject){let result=[];
    if(table==='pos_receipt_templates')result=templates;
    if(table==='site_content')result=content;
    if(table==='pos_print_jobs')result=[{...job,state:jobState}];
    return Promise.resolve({data:result,error:null}).then(resolve,reject);
   }};
 return q;
}
const db={
 from:query,
 rpc(method,payload){
  events.push(method);
  if(method==='pos_claim_print_job'){if(claimed)return Promise.resolve({data:null,error:null});claimed=true;jobState='printing';return Promise.resolve({data:sale,error:null})}
  if(method==='pos_finish_print_job'){jobState=payload?.p_error?'failed':'submitted_to_browser';return Promise.resolve({data:true,error:null})}
  return Promise.resolve({data:null,error:null});
 }
};
const window={
 PersenPOSPaperLayout:require('./receipt-paper-layout.js'),
 PersenPOSCore:{money:raw=>(Number(raw)/100).toFixed(2)},
 PersenPOSReceipt:{reviewUrl:()=>'',presentation:()=>({
  headline:'Thank you',promotion:'',footer:'',review_message:'',review:'',review_url:'',
  seasonal:'',season_style:{icon:'',label:''}
 })},
 PersenSeasonal:{active:()=>null},
 addEventListener(){},
 print(){events.push('window.print');printCalls.push(true)}
};
const PA={
 ready:true,db,
 me:async()=>({id:'11111111-1111-4111-8111-111111111111'}),
 isAdmin:async()=>true
};
window.PA=PA;
const timers=[];
const context={document,window,PA,console,
 setInterval(fn,ms){timers.push({fn,ms});return timers.length},
 clearInterval(){},
 Date,Number,String,Math,Array,Object,Promise,Error,
};
vm.runInNewContext(source,context,{filename:'print-station.js',timeout:1200});
async function flush(){for(let i=0;i<24;i++)await Promise.resolve();await new Promise(resolve=>setTimeout(resolve,10))}
(async()=>{
 await flush();
 assert.equal(typeof node('arm').onclick,'function','Print station must load and offer arming');
 assert.equal(printCalls.length,0,'Must not print before arming');
 assert.equal(node('arm').disabled,true,'Automatic printing must remain disabled until physical printer test');
 node('arm').onclick();await flush();
 assert.equal(printCalls.length,0,'Unverified printer must never automatically print a sale');
 assert.equal(jobState,'queued','Unverified printer must leave existing receipt job untouched');
 node('test-print').onclick();await flush();
 assert.equal(printCalls.length,1,'Test receipt should be sent to browser exactly once');
 assert.equal(node('test-printed').disabled,false,'Confirmation becomes available after test command');
 assert.equal(node('arm').disabled,true,'Test command alone must not mark physical paper as printed');
 node('test-printed').checked=true;node('test-printed').onchange();
 assert.equal(node('arm').disabled,false,'Operator can arm after confirming physical paper');
 node('arm').onclick();await flush();
 assert.equal(printCalls.length,2,'Armed print station must invoke window.print for queued sale exactly once');
 assert.equal(jobState,'submitted_to_browser','Must never falsely mark the paper as physically printed');
 assert.deepEqual(events.filter(s=>s==='pos_claim_print_job'||s==='window.print'||s==='pos_finish_print_job').slice(1),
  ['pos_claim_print_job','window.print','pos_finish_print_job'],'Print queue processing order');
 for(const t of timers)await t.fn();
 await flush();
 assert.equal(printCalls.length,2,'Completed receipt job must not print twice');
 assert.match(node('station-message').textContent,/Confirm paper printed/,'Operator must verify actual paper');
 console.log('Dell print-station mocked sale → claim → window.print → browser acknowledgement PASS; hardware NOT tested.');
})().catch(e=>{console.error(e);process.exitCode=1});

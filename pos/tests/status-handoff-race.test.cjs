'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('pos/register.js','utf8');
const statusSource=source.slice(source.indexOf('async function status(){'),source.indexOf('\nasync function begin(){'));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};}
function harness({active=false,pendingCash=null}={}){
 const read=deferred(),sale=deferred(),saleStarted=deferred();
 const effects=[];
 const query={};
 for(const name of ['select','eq','order'])query[name]=()=>query;
 query.limit=()=>read.promise;
 const state={active};
 const context=vm.createContext({
  window:{PersenPOSSwivel:{active:()=>state.active}},register:{id:'register'},
  busy:false,statusRunning:false,checkoutVersion:0,checkout:null,pendingCash,
  db:{from:()=>{effects.push('query');return query}},check:value=>value,
  saleForCheckout:()=>{saleStarted.resolve();return sale.promise},
  notice:message=>effects.push(message),
  showPaidAwaitingHandoff:()=>effects.push('paid screen'),
  showCompletedSale:async()=>effects.push('completed screen'),
  rememberCash:()=>effects.push('cash reset'),
  document:{body:{classList:{toggle:()=>effects.push('toggle'),remove:()=>effects.push('unlock')}}},
  by:()=>{effects.push('DOM access');return {hidden:true}},
  Wizard:{monitor:()=>{effects.push('progress update');throw Error('Unexpected stale UI update')}},
 });
 vm.runInContext(statusSource,context);
 return {state,context,read,sale,saleStarted,effects,run:()=>context.status()};
}
test('active handoff prevents legacy status query entirely',async()=>{
 const h=harness({active:true});await h.run();assert.deepEqual(h.effects,[]);
});
test('handoff beginning during checkout query discards stale checkout and releases poll lock',async()=>{
 const h=harness();const pending=h.run();h.state.active=true;
 h.read.resolve([{id:'legacy',status:'contact_received'}]);await pending;
 assert.deepEqual(h.effects,['query']);assert.equal(h.context.checkout,null);
 assert.equal(h.context.statusRunning,false);
});
for(const recovery of [false,true])test(`handoff beginning during ${recovery?'cash recovery':'paid sale'} lookup cannot render legacy screen`,async()=>{
 const h=harness({pendingCash:recovery?'legacy':null});const pending=h.run();
 h.read.resolve([{id:'legacy',status:'completed',cash_handoff_complete:recovery}]);
 await h.saleStarted.promise;h.state.active=true;h.sale.resolve({id:'sale'});await pending;
 assert.deepEqual(h.effects,['query']);assert.equal(h.context.checkout,null);
 assert.equal(h.context.statusRunning,false);
});
test('rejected in-flight legacy query does not overwrite secure handoff notice',async()=>{
 const h=harness();const pending=h.run();h.state.active=true;
 h.read.reject(Error('offline'));await pending;
 assert.deepEqual(h.effects,['query']);assert.equal(h.context.statusRunning,false);
});
test('legacy connection errors remain visible outside secure handoff',async()=>{
 const h=harness();const pending=h.run();h.read.reject(Error('offline'));await pending;
 assert.deepEqual(h.effects,['query','Connection lost: offline']);
 assert.equal(h.context.statusRunning,false);
});

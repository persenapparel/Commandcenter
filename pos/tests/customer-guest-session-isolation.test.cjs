'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../customer-guest-client.js'),'utf8');
const config={supabaseUrl:'https://naaqcspvbntzdtwuchrr.supabase.co',supabasePublishableKey:'sb_publishable_STAGING_TEST'};
function boot(overrides={}){
 const calls=[];
 const guestClient={tag:'guest'};
 const createClient=(...args)=>{calls.push(args);return guestClient;};
 const window={PERSEN_CONFIG:config,supabase:{createClient},...overrides};
 vm.runInNewContext(script,{window},{timeout:1000});
 return {window,calls,guestClient};
}
test('customer client uses a fresh non-persistent, non-refreshing auth context',()=>{
 const {window,calls,guestClient}=boot();
 assert.equal(window.PA.ready,true);
 assert.equal(window.PA.db,guestClient);
 assert.equal(calls.length,1);
 assert.equal(calls[0][0],config.supabaseUrl);
 assert.equal(calls[0][1],config.supabasePublishableKey);
 assert.equal(calls[0][2].auth.persistSession,false);
 assert.equal(calls[0][2].auth.autoRefreshToken,false);
 assert.equal(calls[0][2].auth.detectSessionInUrl,false);
 assert.equal(Object.keys(calls[0][2]).join(','),'auth');
});
test('customer transport never reuses an existing cashier db object',()=>{
 const cashier={auth:{getSession:()=>{throw Error('cashier session accessed');}}};
 const {window,calls}=boot({PA:{db:cashier,ready:true}});
 assert.notEqual(window.PA.db,cashier);
 assert.equal(calls.length,1);
});
test('missing configuration or SDK fails closed without attempting a client',()=>{
 for(const override of [{PERSEN_CONFIG:{}},{supabase:null},{PERSEN_CONFIG:{supabaseUrl:config.supabaseUrl}}]){
  const {window,calls}=boot(override);
  assert.equal(window.PA.ready,false);
  assert.equal(window.PA.db,null);
  assert.equal(calls.length,0);
 }
});
test('customer initialization does not read browser storage or navigate',()=>{
 const storage={getItem(){throw Error('storage accessed');},setItem(){throw Error('storage written');}};
 const {window}=boot({localStorage:storage,sessionStorage:storage,location:{get search(){throw Error('URL inspected');}}});
 assert.equal(window.PA.ready,true);
});
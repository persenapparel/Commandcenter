/* Security regression: the future customer iframe is an opaque, guest-only
   browser context. This does not enable customer handoff or exercise payments. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve('pos-dist');
const server=http.createServer((req,res)=>{
  const requestPath=new URL(req.url,'http://localhost').pathname;
  const target=path.resolve(root,'.'+(requestPath==='/'?'/index.html':requestPath));
  if(!target.startsWith(root+path.sep)){res.writeHead(403).end();return}
  fs.readFile(target,(err,data)=>{
    if(err){res.writeHead(404).end();return}
    const type=target.endsWith('.js')?'text/javascript':target.endsWith('.html')?'text/html':'text/plain';
    res.writeHead(200,{'Content-Type':type}).end(data);
  });
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port+'/';
  const browser=await chromium.launch({headless:true});
  try{
    const ctx=await browser.newContext();
    await ctx.addInitScript({content:`window.__CLIENT_AUTH_OPTIONS=[];
window.supabase={createClient:(url,key,options)=>{
 window.__CLIENT_AUTH_OPTIONS.push(options?.auth||{});
 return {auth:{getUser:async()=>({data:{user:null},error:null})},
 rpc:async()=>({data:{status:'idle',items:[],checkout_id:null},error:null}),
 from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:null,error:null})})};
}};`});
    await ctx.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.fulfill({status:200,contentType:'text/javascript',body:''}));
    const page=await ctx.newPage();
    await page.goto(base+'register.html');
    await page.evaluate(()=>{
      window.localStorage.setItem('pos-test-owner-secret','private-canary');
      const iframe=document.querySelector('#swivel-customer-frame');
      if(!iframe)throw Error('Customer iframe missing');
      iframe.src='display.html?pair=22222222-2222-4222-8222-222222222222';
    });
    const iframe=page.frameLocator('#swivel-customer-frame');
    await iframe.locator('body').waitFor();
    await iframe.locator('#customer-welcome').waitFor();
    const isolation=await iframe.locator('body').evaluate(()=>{
      let parentAccessible=false,storageAccessible=false;
      try{void window.parent.document.body;parentAccessible=true}catch{}
      try{window.localStorage.getItem('pos-test-owner-secret');storageAccessible=true}catch{}
      const authConfig=window.__CLIENT_AUTH_OPTIONS?.at(-1)||{};
      return {parentAccessible,storageAccessible,guestReady:window.PA?.ready===true,authConfig};
    });
    assert.equal(isolation.parentAccessible,false,'Customer must not read cashier parent');
    assert.equal(isolation.storageAccessible,false,'Customer sandbox must have no access to cashier origin storage');
    assert.equal(isolation.guestReady,true,'Customer guest transport must initialize');
    assert.equal(isolation.authConfig.persistSession,false,'Guest must not save an auth session');
    assert.equal(isolation.authConfig.autoRefreshToken,false,'Guest must not refresh cashier login');
    assert.equal(isolation.authConfig.detectSessionInUrl,false,'Guest must not inherit auth URL');
    await ctx.close();
    console.log('PASS: opaque-origin customer iframe cannot read cashier DOM or browser storage; guest auth is nonpersistent. Handoff still disabled.');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e);process.exitCode=1});

/* Staging dashboard configuration audit. Read-only; not proof of network,
   payment, employee badge or customer checkout operation. */
(function(root){
 'use strict';
 function verify(manifest,client){
  if(!manifest||manifest.environment!=='staging')
   return {configured:false,detail:'Not a verified staging deployment manifest.'};
  const url=manifest.guestEntryUrl;
  if(typeof url!=='string'||typeof client?.guestEntryUrl!=='string'||
     client.guestEntryUrl!==url)
   return {configured:false,detail:'Cashier and guest URLs do not match. Do not start a customer checkout.'};
  let u;
  try{u=new URL(url)}catch(_){
   return {configured:false,detail:'Customer checkout URL is invalid.'};
  }
  const host=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||
     u.pathname!=='/pos-guest/'||
     !(host==='commandcenter-4yg.pages.dev'||host.endsWith('.commandcenter-4yg.pages.dev'))||
     manifest.guestOrigin!==u.origin){
   return {configured:false,detail:'Customer origin is not an approved isolated staging origin.'};
  }
  const revision=typeof manifest.commit==='string'&&/^[a-f0-9]{40}$/i.test(manifest.commit)
   ?manifest.commit.slice(0,12):'not available';
  return {
   configured:true,revision,guestHost:host,
   detail:'Configured pairing matches. This does NOT confirm the guest URL is reachable or checkout is working.'
  };
 }
 async function mount(doc,fetcher){
  const status=doc.getElementById('staging-readiness-status');
  const revision=doc.getElementById('staging-readiness-commit');
  const customer=doc.getElementById('staging-readiness-guest');
  if(!status||!revision||!customer)return;
  status.textContent='Checking this staging build’s configuration…';
  try{
   const response=await fetcher('./deployment.json',{cache:'no-store',credentials:'same-origin'});
   if(!response?.ok)throw Error('manifest unavailable');
   const manifest=await response.json();
   const checked=verify(manifest,root?.PersenPOSHandoffConfig);
   status.textContent=checked.detail;
   revision.textContent=checked.configured?'Cashier commit: '+checked.revision:'Cashier commit: unavailable';
   customer.textContent=checked.configured?'Configured customer host: '+checked.guestHost:'Customer pairing: unverified';
  }catch(_){
   status.textContent='Deployment details unavailable. Do not assume cashier and guest builds match.';
   revision.textContent='Cashier commit: unavailable';
   customer.textContent='Customer pairing: unverified';
  }
 }
 if(typeof module==='object'&&module.exports)module.exports={verify,mount};
 if(typeof document!=='undefined'&&typeof fetch==='function'){
  const run=()=>void mount(document,fetch);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});
  else run();
 }
})(typeof window!=='undefined'?window:globalThis);

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('both guest page transports stay within staging CORS preflight allowlist',()=>{
 const edge=fs.readFileSync('supabase/functions/pos-guest-checkout/index.ts','utf8');
 const guest=fs.readFileSync('pos-guest/guest.js','utf8');
 // The isolated Pages guest and Edge-served fallback both use the same
 // bearer request shape. A manually set Cache-Control request header is
 // NOT in the guest Edge API's Access-Control-Allow-Headers allowlist.
 // It makes real cross-origin Safari checkout fail at the preflight.
 for(const [name,source] of [['Pages guest',guest],['Edge-served guest',edge]]){
  const start=source.indexOf('async function request(action,body)');
  const end=source.indexOf('function validSnapshot',start);
  assert.ok(start>=0&&end>start,name+' request source must remain available');
  const request=source.slice(start,end);
  assert.match(request,/credentials:'omit'/,name+' must never send cashier cookies');
  assert.match(request,/cache:'no-store'/,name+' must bypass browser caching');
  assert.match(request,/referrerPolicy:'no-referrer'/);
  assert.match(request,/'Authorization':'Bearer '\+token/);
  assert.match(request,/'Content-Type':'application\/json'/);
  assert.doesNotMatch(request,/['"]Cache-Control['"]\s*:/,
   name+' must not add a header rejected by staging guest CORS preflight');
 }
 assert.match(edge,/Access-Control-Allow-Headers','Authorization, Content-Type'/,
  'CORS still allows only the two required credential-free guest headers');
 assert.match(edge,/headers\.set\('Cache-Control','no-store/,
  'Server response still disables caching of customer information');
});

'use strict';
// Read-only staging deployment check. Never sends credentials, grants, payment,
// drawer commands, receipt jobs, or customer answers.
// Usage:
//   node pos/verify-published-guest.cjs https://PREVIEW.commandcenter-4yg.pages.dev/pos-guest/
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

async function main(urlString){
 const url=new URL(urlString);
 const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||
   !(host==='commandcenter-4yg.pages.dev'||host.endsWith('.commandcenter-4yg.pages.dev'))||
   url.pathname!=='/pos-guest/'||url.username||url.password||url.search||url.hash)
   throw Error('Use only the exact isolated staging guest /pos-guest/ URL, with no query or credentials.');
 const headers={Accept:'text/html,application/javascript;q=0.9'};
 async function checkedGet(target){
  const response=await fetch(target,{method:'GET',redirect:'error',cache:'no-store',
    headers,signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Guest deployment returned HTTP '+response.status+' at '+target.pathname);
  return response;
 }
 const html=await checkedGet(url);
 const csp=html.headers.get('content-security-policy')||'';
 if(!csp.includes('frame-ancestors https://pos.persenapparel.com'))
  throw Error('Guest iframe CSP does not authorize the staging cashier custom domain.');
 if(/\bDENY\b/i.test(html.headers.get('x-frame-options')||''))
  throw Error('Guest is blocked by X-Frame-Options: DENY.');
 if(!csp.includes('connect-src https://naaqcspvbntzdtwuchrr.supabase.co'))
  throw Error('Guest CSP does not restrict API requests to the isolated staging project.');
 const htmlText=await html.text();
 if(!htmlText.includes('guest.js'))throw Error('Guest HTML does not load its customer script.');
 const jsUrl=new URL('guest.js',url);
 const script=await checkedGet(jsUrl);
 const deployed=await script.text();
 const local=fs.readFileSync(path.resolve(__dirname,'..','pos-guest','guest.js'),'utf8');
 const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
 if(hash(deployed)!==hash(local))throw Error(
  'Published guest.js does not match the reviewed, fixed staging checkout bundle. Redeploy the corrected guest asset before iPad testing.');
 assert.match(deployed,/control\.addEventListener\('touchend'/);
 assert.doesNotMatch(deployed,/signatureException|signature:answers\./);
 console.log('PASS: Customer guest page is deployed at the approved HTTPS origin.');
 console.log('PASS: Guest response permits only approved staging cashier framing and API calls.');
 console.log('PASS: Published Next-touch bundle exactly matches local reviewed checkout JS.');
 console.log('PASS: No obsolete customer signature fields.');
 console.log('READY FOR SUPERVISED IPAD GUEST NAVIGATION TEST (not a completed payment).');
}
if(require.main===module){
 main(process.argv[2]||'').catch(error=>{console.error('NOT READY: '+error.message);process.exitCode=1;});
}
module.exports={main};

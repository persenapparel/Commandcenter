'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const ID='22222222-2222-4222-8222-222222222222';
const token='a'.repeat(64);
const base={
 SUPABASE_URL:'https://naaqcspvbntzdtwuchrr.supabase.co',
 SUPABASE_SERVICE_ROLE_KEY:'service-role-TEST-should-never-leak-to-customer',
 POS_GUEST_ORIGIN:'https://customer.staging.example',
 GUEST_RATE_LIMIT:{limit:async()=>({success:true})}
};
const req=(route='view',origin=base.POS_GUEST_ORIGIN,bearer=token,answers)=>new Request(
 'https://api.staging.example/guest-checkout/'+route,{
 method:'POST',
 headers:{Origin:origin,Authorization:'Bearer '+bearer,'Content-Type':'application/json'},
 body:JSON.stringify({checkoutId:ID,...(answers?{answers}:{})})
});
test('isolated guest gateway sends only scoped token to trusted staging RPC',async()=>{
 const worker=(await import('../guest-checkout-worker.mjs')).default;
 const original=globalThis.fetch;
 const received=[];
 globalThis.fetch=async(url,opts)=>{
  received.push({url,opts});
  return new Response(JSON.stringify({checkoutId:ID,items:[{
    name:'CI Test Hoodie',quantity:1,lineTotal:'$25.00'}],total:'$25.00'}),{status:200});
 };
 try{
  const out=await worker.fetch(req(),base);
  assert.equal(out.status,200);
  const data=await out.json();
  assert.equal(data.checkoutId,ID);
  assert.equal(out.headers.get('Access-Control-Allow-Origin'),base.POS_GUEST_ORIGIN);
  assert.equal(out.headers.get('Cache-Control'),'no-store');
  assert.equal(received.length,1);
  assert.match(received[0].url,/pos_handoff_guest_view$/);
  assert.equal(JSON.parse(received[0].opts.body).p_capability,token);
  assert.equal(received[0].opts.headers.apikey,base.SUPABASE_SERVICE_ROLE_KEY);
  assert.ok(!JSON.stringify(data).includes(base.SUPABASE_SERVICE_ROLE_KEY));
  assert.ok(!JSON.stringify(data).includes(token));
 }finally{globalThis.fetch=original}
});
test('gateway denies wrong origin, invalid bearer, and missing rate limit binding',async()=>{
 const worker=(await import('../guest-checkout-worker.mjs')).default;
 assert.equal((await worker.fetch(req('view','https://evil.example'),base)).status,403);
 assert.equal((await worker.fetch(req('view',base.POS_GUEST_ORIGIN,'bad'),base)).status,401);
 assert.equal((await worker.fetch(req(),{...base,GUEST_RATE_LIMIT:null})).status,503);
 assert.equal((await worker.fetch(req(),{...base,SUPABASE_URL:'https://wrong.supabase.co'})).status,503);
 assert.equal((await worker.fetch(req(),{...base,GUEST_RATE_LIMIT:{limit:async()=>({success:false})}})).status,429);
});
test('guest submit forwards bounded acknowledgment without returning secrets',async()=>{
 const worker=(await import('../guest-checkout-worker.mjs')).default;
 const original=globalThis.fetch;let payload;
 globalThis.fetch=async(url,opts)=>{
  payload={url,opts};
  return new Response(JSON.stringify({accepted:true}),{status:200});
 };
 try {
  const answers={phone:'(631) 555-0100',signature:'CI Test',
   marketingConsent:false,signatureException:false};
  const response=await worker.fetch(req('submit',base.POS_GUEST_ORIGIN,token,answers),base);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{accepted:true});
  assert.match(payload.url,/pos_handoff_guest_submit$/);
  assert.deepEqual(JSON.parse(payload.opts.body).p_answers,answers);
 } finally {globalThis.fetch=original}
});

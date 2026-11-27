// This endpoint lives in the event register's project. Customer identities are verified by the storefront project.
const opens = Date.parse('2026-12-01T05:00:00Z');
const prod = 'https://icxeuhkqxxhdkfdappio.supabase.co';
const prodKey = 'sb_publishable_c1AgR8hkmf4eTVq8uPVy3Q_6DeuExsS';
const db = Deno.env.get('SUPABASE_URL');
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const headers = {'apikey':service,'Authorization':'Bearer '+service,'Content-Type':'application/json'};
const mediaBucket='holiday-campaign';
const getEnv=(key)=>Deno.env.get(key)||'';
const error=(code,message)=>Object.assign(new Error(message),{code});
async function rpc(name,args={}) {
  const res=await fetch(db+'/rest/v1/rpc/holiday_'+name,{method:'POST',headers,body:JSON.stringify(args)});
  if(!res.ok){const e=await res.json().catch(()=>({}));throw error(e.code==='P0001'?409:503,e.code==='P0001'?e.message:'Store service temporarily unavailable.');}
  const text=await res.text();return text?JSON.parse(text):null;
}
async function identity(request,owner=false,optional=false) {
  const token=request.headers.get('authorization');
  if(!token&&optional)return null;
  if(!token?.startsWith('Bearer '))throw error(401,'Please sign in.');
  const h={apikey:prodKey,Authorization:token};
  const response=await fetch(prod+'/auth/v1/user',{headers:h});
  if(!response.ok)throw error(401,'Please sign in again.');
  const user=await response.json();
  if(!user.id||!user.email||!user.email_confirmed_at||user.is_anonymous)throw error(403,'Verify your account email first.');
  if(owner){
    const r=await fetch(prod+'/rest/v1/admin_users?select=user_id&user_id=eq.'+encodeURIComponent(user.id),{headers:h});
    if(!r.ok || !(await r.json()).some(row=>row.user_id===user.id))throw error(403,'Owner access required.');
  }
  return user;
}
const reply=(body,status=200,extra={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',...extra}});
async function readBody(req){
  if(!req.headers.get('content-type')?.includes('application/json'))throw error(415,'Send JSON.');
  const reader=req.body?.getReader();let size=0,parts=[];
  if(!reader)throw error(400,'Empty request.');
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16000){await reader.cancel();throw error(413,'Request too large.');}parts.push(value);}
  try{return JSON.parse(await new Blob(parts).text());}catch{throw error(400,'Invalid request.');}
}
async function digest(value){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');}
function storageUrl(path){return db+'/storage/v1'+path;}
function signedUrl(value){if(typeof value!=='string')throw error(503,'Media unavailable.');return new URL(value.startsWith('/storage/v1/')?value:'/storage/v1'+value,db).href;}
function validPath(path,kind){return typeof path==='string'&&new RegExp('^'+kind+'-[0-9a-f-]{36}\\.'+(kind==='video'?'mp4':'(webp|jpg|png)')+'$').test(path);}
async function signRead(path){
  const r=await fetch(storageUrl('/object/sign/'+mediaBucket+'/'+path),{method:'POST',headers,body:JSON.stringify({expiresIn:3600})});
  if(!r.ok)throw error(503,'Media unavailable.');return signedUrl((await r.json()).signedURL);
}
async function sendMail(){
  const key=getEnv('RESEND_TRANSACTIONAL_API_KEY'),from=getEnv('RESEND_RECEIPTS_FROM');
  if(!key||!from)return;
  const jobs=await rpc('mail_claim');
  for(const job of jobs){
    const reference=job.id.slice(0,8).toUpperCase();const studio=job.kind==='studio';
    const amount=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(job.total/100);
    const formatMoney=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
    const items=(job.items||[]).map(item=>item.name+' · '+item.color+' · '+item.size+' × '+item.qty+' — '+formatMoney(item.unit_price*item.qty)).join('\n');
    const payment=job.method==='venmo'
      ?'Payment status: Awaiting verification. Send '+amount+' to @persenapparel on Venmo and include order reference '+job.id+'.'
      :'Payment status: Awaiting cash at pickup.';
    const destination=job.fulfillment==='shipping'?'Shipping address: '+job.address:job.fulfillment==='delivery'?'Historical delivery address: '+job.address:'Fulfillment: Free local pickup';
    const plain=(studio?'A new Christmas order is ready to review in Command Center.':'Thank you, '+job.name+'! We received your order.')+'\n\n'+items+'\n\nMerchandise subtotal: '+formatMoney(job.subtotal??job.total)+'\nDiscount: '+formatMoney(job.discount??0)+'\nShipping: '+formatMoney(job.shipping??0)+'\nTotal before applicable tax: '+amount+'\n'+destination+'\n'+payment+'\nWe will contact you to arrange fulfillment.';
    const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':'holiday-'+job.kind+'-'+job.id},body:JSON.stringify({from,to:[studio?'service@persenapparel.com':job.email],reply_to:'service@persenapparel.com',subject:(studio?'New Christmas order ':'Your Persen Apparel order ')+reference,text:plain+'\n\nOrder reference '+job.id+'\nPersen Apparel · Long Island, NY'})});
    if(r.ok)await rpc('mail_sent',{p_order:job.id,p_kind:job.kind});
  }
}
async function execute(req) {
  const path=new URL(req.url).pathname.split('/holiday-store').pop().replace(/^\/+|\/+$/g,'');
  const get=req.method==='GET',post=req.method==='POST';
  if ((get && path === 'health') || ['catalog','order','film','quote','options'].includes(path) || path.startsWith('media/')) {
    const status = await rpc('release_status');
    if (!status || !['countdown','open'].includes(status.phase) || Date.parse(status.release_at)!==opens) throw error(503,'Store service temporarily unavailable.');
    if (get && path === 'health') return reply({phase:status.phase, releaseAt:status.release_at, emailConfigured:!!(getEnv('RESEND_TRANSACTIONAL_API_KEY')&&getEnv('RESEND_RECEIPTS_FROM'))});
    if (status.phase !== 'open') return reply({error:'The collection is not yet available.'},423);
  }
  if(get&&path==='options')return reply({shipping:getEnv('HOLIDAY_SHIPPING_APPROVED')==='true'&&getEnv('HOLIDAY_MERCHANT_PAYMENT_APPROVED')==='true',venmo:getEnv('HOLIDAY_MERCHANT_PAYMENT_APPROVED')==='true'});
  if(get&&path==='catalog')return reply(await rpc('catalog'));
  if(get&&path.startsWith('media/')){
    const key=path.slice(6);if(!/^[a-z0-9-]{1,70}$/.test(key))return reply({error:'Image unavailable.'},404);
    const data=await rpc('photo',{p_key:key});if(!data)return reply({error:'Image unavailable.'},404);
    return new Response(Uint8Array.from(atob(data),c=>c.charCodeAt(0)),{headers:{'content-type':'image/webp','cache-control':'private, no-store, max-age=0','x-content-type-options':'nosniff'}});
  }
  if(get&&path==='film'){
    const paths=await rpc('film');if(!paths)return reply(null);
    return reply({video:await signRead(paths.video),poster:await signRead(paths.poster)});
  }
  if(post&&path==='quote'){const user=await identity(req),b=await readBody(req);if(!Array.isArray(b.lines)||typeof b.code!=='string'||b.code.length>32||!['shipping','pickup'].includes(b.fulfillment))throw error(400,'Check your discount code and bag.');const bucket=await digest(service+'|quote|'+user.id);if(!await rpc('rate',{p_bucket:bucket}))throw error(429,'Too many attempts. Try again in 15 minutes.');return reply(await rpc('quote',{p_customer:user.id,p_code:b.code,p_lines:b.lines,p_fulfillment:b.fulfillment}));}
  if(post&&path==='order'){
    const user=await identity(req), b=await readBody(req);
    if(!b.details||!Array.isArray(b.lines)||!b.request)throw error(400,'Check your bag and contact details.');
    if(b.details.fulfillment==='shipping'&&getEnv('HOLIDAY_SHIPPING_APPROVED')!=='true')throw error(409,'Shipping is not yet available. Please choose local pickup.');
    if(b.details.method==='venmo'&&getEnv('HOLIDAY_MERCHANT_PAYMENT_APPROVED')!=='true')throw error(409,'This payment method is not yet available.');
    b.details.email=user.email;
    const ip=(req.headers.get('x-forwarded-for')||'direct').split(',').at(-1).trim();
    const bucket=await digest(service+ip+'|'+String(b.details.email??'').trim().toLowerCase());
    if(!await rpc('rate',{p_bucket:bucket}))throw error(429,'Too many attempts. Try again in 15 minutes.');
    const placed=await rpc('order',{p_request:b.request,p_customer:user.id,p_details:b.details,p_lines:b.lines});
    EdgeRuntime.waitUntil(sendMail().catch(()=>{}));
    return reply(placed,201);
  }
  if(post&&path==='dispatch'){
    const token=req.headers.get('x-holiday-job')||'';
    if(token.length<32||!await rpc('job_allowed',{p_token:token}))throw error(403,'Worker access required.');
    await sendMail();return reply({ok:true});
  }
  if(get&&path==='account'){const u=await identity(req);return reply(await rpc('account',{p_customer:u.id}));}
  if(!['manage','dashboard','upload','discounts'].includes(path))throw error(404,'Page unavailable.');
  const owner=await identity(req,true);
  if(get&&path==='discounts')return reply(await rpc('discounts'));
  if(get&&path==='dashboard'){const dashboard=await rpc('dashboard');return reply({...dashboard,discounts:await rpc('discounts')});}
  if(!post)throw error(405,'Method unavailable.');
  const b=await readBody(req);
  if(path==='upload'){
    const kind=b.kind,types={video:{'video/mp4':'mp4'},poster:{'image/webp':'webp','image/jpeg':'jpg','image/png':'png'}};
    const ext=types[kind]?.[b.type];if(!ext||!(b.size>0&&b.size<=(kind==='video'?50:5)*1024*1024))throw error(400,'Choose an MP4 up to 50 MB and a poster up to 5 MB.');
    const key=kind+'-'+crypto.randomUUID()+'.'+ext;
    const res=await fetch(storageUrl('/object/upload/sign/'+mediaBucket+'/'+key),{method:'POST',headers,body:'{}'});
    if(!res.ok)throw error(503,'Private upload unavailable.');
    const data=await res.json();return reply({key,url:signedUrl(data.url)});
  }
  if(path==='manage'){
    if(b.change?.action==='film'&&(b.change.video||b.change.poster)){
      for(const kind of ['video','poster']){
        const key=b.change[kind];if(!validPath(key,kind))throw error(400,'Upload both the film and its poster.');
        const check=await fetch(storageUrl('/object/info/'+mediaBucket+'/'+key),{method:'GET',headers});if(!check.ok)throw error(400,'Finish uploading both files first.');
      }
    }
    await rpc('manage',{p_actor:owner.id,p_request:b.request,p_change:b.change});return reply({ok:true});
  }
  throw error(405,'Method unavailable.');
}
Deno.serve(async req=>{
  const origin=req.headers.get('origin')||'';
  const cors={'Vary':'Origin','Access-Control-Allow-Headers':'authorization,content-type,apikey','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
  if(/^https:\/\/(?:[a-z0-9-]+\.)*persenapparel\.com$/.test(origin))cors['Access-Control-Allow-Origin']=origin;
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  let response;try{response=await execute(req);}catch(e){response=reply({error:e.code?e.message:'The store is temporarily unavailable.'},e.code||503);}
  for(const [name,value] of Object.entries(cors))response.headers.set(name,value);
  return response;
});

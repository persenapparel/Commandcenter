// Staging-only Cloudflare Worker draft. NOT DEPLOYED. Never bundle in POS Pages.
// Route /guest-checkout/{view|submit} on an independently isolated HTTPS API origin.
// Bind the service-role key ONLY as a Worker secret, never in browser JS.
// Required bindings: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// POS_GUEST_ORIGIN, GUEST_RATE_LIMIT (Cloudflare Rate Limiting API).
const STAGING = 'https://naaqcspvbntzdtwuchrr.supabase.co';
const noStore = {'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff'};
const reply = (status, body, origin='') => new Response(JSON.stringify(body),{
  status,headers:{...noStore,'Content-Type':'application/json; charset=utf-8',
    ...(origin ? {'Access-Control-Allow-Origin':origin,'Vary':'Origin'} : {})}
});
const isId = s => typeof s==='string' && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(s);
const isToken = s => typeof s==='string' && /^[a-f0-9]{64}$/.test(s);
function configured(env) {
  try {
    const guest = new URL(env.POS_GUEST_ORIGIN);
    return env.SUPABASE_URL===STAGING && guest.protocol==='https:' &&
      guest.origin===env.POS_GUEST_ORIGIN && guest.origin!==STAGING &&
      typeof env.SUPABASE_SERVICE_ROLE_KEY==='string' &&
      env.SUPABASE_SERVICE_ROLE_KEY.length>20 &&
      typeof env.GUEST_RATE_LIMIT?.limit==='function';
  } catch { return false; }
}
async function safeBody(req) {
  const length=Number(req.headers.get('content-length')||'0');
  if (!Number.isFinite(length) || length>8192 || length<0) throw Error('Invalid request');
  const body=await req.text();
  if (body.length>8192) throw Error('Invalid request');
  const data=JSON.parse(body);
  if (!data || Array.isArray(data) || typeof data!=='object' || !isId(data.checkoutId))
    throw Error('Invalid request');
  return data;
}
export default {
  async fetch(request, env) {
    if (!configured(env)) return reply(503,{error:'Checkout unavailable'});
    const origin=request.headers.get('origin')||'';
    if (origin!==env.POS_GUEST_ORIGIN) return reply(403,{error:'Checkout unavailable'});
    if (request.method==='OPTIONS') return new Response(null,{status:204,headers:{
      ...noStore,'Access-Control-Allow-Origin':origin,'Vary':'Origin',
      'Access-Control-Allow-Methods':'POST, OPTIONS',
      'Access-Control-Allow-Headers':'Authorization, Content-Type',
      'Access-Control-Max-Age':'60'}});
    if (request.method!=='POST' || !['/guest-checkout/view','/guest-checkout/submit'].includes(new URL(request.url).pathname))
      return reply(404,{error:'Checkout unavailable'},origin);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))
      return reply(415,{error:'Checkout unavailable'},origin);
    const auth=request.headers.get('authorization')||'';
    const token=auth.startsWith('Bearer ')?auth.slice(7):'';
    if (!isToken(token)) return reply(401,{error:'Checkout unavailable'},origin);
    let data;
    try { data=await safeBody(request); }
    catch { return reply(400,{error:'Checkout unavailable'},origin); }
    const submit=new URL(request.url).pathname.endsWith('/submit');
    if (submit && (!data.answers || typeof data.answers!=='object' || Array.isArray(data.answers)))
      return reply(400,{error:'Checkout unavailable'},origin);
    // Rate limiting is defense in depth; server-side token entropy, TTL, exact
    // checkout binding, and atomic consumption are the authorization boundary.
    try {
      const rate=await env.GUEST_RATE_LIMIT.limit({key:data.checkoutId});
      if (!rate?.success) return reply(429,{error:'Checkout unavailable'},origin);
    } catch { return reply(503,{error:'Checkout unavailable'},origin); }
    const rpc=submit?'pos_handoff_guest_submit':'pos_handoff_guest_view';
    const body=submit
      ? {p_checkout:data.checkoutId,p_capability:token,p_answers:data.answers}
      : {p_checkout:data.checkoutId,p_capability:token};
    try {
      const res=await fetch(STAGING+'/rest/v1/rpc/'+rpc,{
        method:'POST',redirect:'error',credentials:'omit',
        headers:{'apikey':env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization':'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,
          'Content-Type':'application/json','Cache-Control':'no-store'},
        body:JSON.stringify(body)
      });
      if (!res.ok) return reply(403,{error:'Checkout unavailable'},origin);
      const result=await res.json();
      if (submit) return result?.accepted===true
        ? reply(200,{accepted:true},origin) : reply(403,{error:'Checkout unavailable'},origin);
      if (!result || result.checkoutId!==data.checkoutId ||
          !Array.isArray(result.items) || typeof result.total!=='string')
        return reply(502,{error:'Checkout unavailable'},origin);
      // Return only the explicit customer-facing snapshot fields.
      return reply(200,{checkoutId:result.checkoutId,items:result.items.map(item=>({
        name:String(item.name||'').slice(0,120),
        quantity:item.quantity,lineTotal:String(item.lineTotal||'').slice(0,40)
      })),total:result.total},origin);
    } catch { return reply(503,{error:'Checkout unavailable'},origin); }
  }
};

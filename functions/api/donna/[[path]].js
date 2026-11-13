/* Optional same-origin Cloudflare Pages read-only gateway. No privileged key. */
import { createDonnaAPI, TOOLS } from '../../../donna/api.js';
export async function onRequest(context) {
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
  const reply=(status,payload)=>new Response(JSON.stringify(payload),{status,headers});
  if(context.request.method!=='GET') return reply(405,{error:'Read-only business endpoint. Only GET is supported.'});
  const path=(Array.isArray(context.params.path)?context.params.path.join('/'):context.params.path||'').replace(/^\/+|\/+$/g,'');
  if(path!=='status'&&path!=='memories'&&!Object.hasOwn(TOOLS,path)) return reply(404,{error:'Unknown or disabled tool.'});
  const authorization=context.request.headers.get('Authorization')||'';
  if(!/^Bearer [A-Za-z0-9._-]+$/.test(authorization)) return reply(401,{error:'Sign in to Command Center first.'});
  const api=createDonnaAPI({supabaseUrl:context.env.SUPABASE_URL,supabasePublishableKey:context.env.SUPABASE_PUBLISHABLE_KEY},{storage:null});
  api.setAccessToken(authorization.slice(7));
  try {
    const status=await api.status();
    if(!status.configured) return reply(503,{error:'Configure the existing Supabase URL and publishable key on this staging deployment.'});
    if(!status.authenticated||!status.admin) return reply(403,{error:status.error||'Authorized owner account required.'});
    if(path==='status')return reply(200,status);
    if(path==='memories') { const result=await api.memories.list();return reply(200,{...result,rows:result.rows.filter(m=>m.status==='confirmed').map(({history,...memory})=>memory)}); }
    return reply(200,await api.load(path));
  } catch(error) { return reply(error.status===401?401:error.status===403?403:error.status===429?429:502,{error:error.message||'Data unavailable. No business writes were performed.'}); }
}

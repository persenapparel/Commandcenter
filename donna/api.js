import { COST_POLICY } from './core.js';
export const TOOLS = Object.freeze({
  tasks: [{table:'business_tasks',select:'id,title,customer_name,priority,status,due_date,created_at,updated_at'}],
  orders: [{table:'customer_orders',select:'id,title,status,fulfillment,payment_status,created_at,updated_at'},{table:'manual_business_orders',select:'id,title,customer_name,quantity,status,due_date,created_at,updated_at'}],
  inventory:[{table:'stock_items',select:'id,sku,product_name,color,size,quantity,reorder_at,updated_at'}],
  invoices:[{table:'business_invoices',select:'id,invoice_number,customer_name,total,status,due_date,document_type,created_at,updated_at'}],
  payments:[{table:'invoice_payments',select:'id,invoice_id,amount,received_on,created_at'}],
  contacts:[{table:'customer_contacts',select:'id,full_name,organization,email,phone,updated_at'}],
  agreements:[{table:'invoice_agreements',select:'id,invoice_id,status,owner_signed_at,customer_signed_at,created_at'}],
  events:[{table:'inventory_event_profiles',select:'id,name,event_date,active,created_at,updated_at'}]
});
const categories = ['Business information','Product information','Pricing','Production procedures','Suppliers','Customer service','Business goals','Owner preferences','Event plans','Important decisions','Active projects'];
export const MEMORY_CATEGORIES = Object.freeze(categories);
const validID = id => { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id))) throw Error('Invalid record ID.'); return id; };
const bounded = (value, max, label) => { const text=String(value??'').trim(); if (!text || text.length>max) throw Error(`${label} must contain 1–${max} characters.`); return text; };
export function createDonnaAPI(config = {}, options = {}) {
  const fetcher = options.fetchImpl || globalThis.fetch;
  let storage=options.storage;
  if(storage===undefined) try {storage=globalThis.sessionStorage;} catch {storage=null;}
  const base = String(config.supabaseUrl || '').replace(/\/$/,'');
  const key = config.supabasePublishableKey || '';
  let configured = false;
  try { const url=new URL(base); configured = url.protocol==='https:' && /^[a-z0-9]+\.supabase\.co$/.test(url.hostname) && url.pathname==='/' && !url.username && !url.password && !url.search && !url.hash && /^sb_publishable_[A-Za-z0-9_-]+$/.test(key); } catch {}
  const storageKey = `donna.session.${base}`;
  let session = null, sessionRevision=0, refreshPromise=null;
  const usage={scope:'this tab since page load',networkRequests:0,readRequests:0,authRequests:0,storageWrites:0,rateLimitResponses:0,failedRequests:0,providerTotalsAvailable:false};
  try { session=JSON.parse(storage?.getItem(storageKey)||'null'); } catch {}
  const persist = next => { sessionRevision++; session=next; try { next?storage?.setItem(storageKey,JSON.stringify(next)):storage?.removeItem(storageKey); } catch {} };
  const assertConfigured = () => { if (!configured) throw Error('Donna needs the existing Supabase HTTPS URL and publishable key. Secret/service-role keys are never accepted.'); };
  async function request(path, {method='GET',body,headers={},token=session?.access_token} = {}) {
    assertConfigured();
    usage.networkRequests++; if(path.startsWith('/auth/'))usage.authRequests++; else if(method==='GET')usage.readRequests++; else usage.storageWrites++;
    let response; try {response = await fetcher(base+path,{ method, headers:{apikey:key,...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),cache:'no-store',signal:AbortSignal.timeout(20000)});} catch(error) {usage.failedRequests++;throw error;}
    let result; const raw=await response.text();
    if(raw.length>2000000) {usage.failedRequests++;throw Error('This response exceeds the safe Donna read size. Narrow the source records or use a database-owner export.');}
    try { result=raw?JSON.parse(raw):null; } catch { result=null; }
    if (!response.ok) {
      usage.failedRequests++;if(response.status===429)usage.rateLimitResponses++;
      const error=Error(response.status===429 ? 'Free-tier request limit reached. Wait before trying again; there is no paid fallback.' : response.status===401 ? 'Your session expired. Please sign in again.' : response.status===404 || result?.code==='42P01' || result?.code==='PGRST205' ? 'This Donna feature needs its reviewed database setup before it can be used.' : path.startsWith('/auth/v1/token') && response.status===400 ? 'Sign-in failed. Check your email and password, or sign in again if your session expired.' : `The authenticated data request failed (${response.status}). Refresh records before retrying a storage change.`);
      error.status=response.status; error.code=result?.code; throw error;
    }
    return {data:result,headers:response.headers};
  }
  async function refresh() {
    if (!session?.access_token) throw Error('Sign in to Command Center first.');
    if (session.expires_at && session.expires_at*1000<=Date.now()+30000 && session.refresh_token) {
      if(!refreshPromise) {
        const revision=sessionRevision, refreshToken=session.refresh_token;
        refreshPromise=(async()=>{
          try {
            const {data}=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',token:null,body:{refresh_token:refreshToken}});
            if(sessionRevision!==revision) throw Error('Your session changed. Please retry after signing in.');
            persist({...data,expires_at:data.expires_at||Math.floor(Date.now()/1000)+(data.expires_in||3600)});
          } catch(error) {if(sessionRevision===revision)persist(null);throw error;}
          finally {refreshPromise=null;}
        })();
      }
      await refreshPromise;
    }
    if(!session?.access_token)throw Error('Sign in to Command Center first.');
  }
  async function authorize() {
    await refresh();
    const {data:user}=await request('/auth/v1/user');
    if (!user?.id || user.is_anonymous) throw Error('An authenticated owner account is required.');
    const query=new URLSearchParams({select:'user_id',user_id:`eq.${user.id}`,limit:'1'});
    const {data:admins}=await request('/rest/v1/admin_users?'+query);
    if (!Array.isArray(admins) || !admins.some(a=>a.user_id===user.id)) { const e=Error('This account is not an authorized Persen Apparel administrator.'); e.status=403; throw e; }
    return user;
  }
  async function readTable(table, select, filters = {}, max=COST_POLICY.maximumRowsPerTool, pageSize=COST_POLICY.requestPageSize) {
    let all=[],total=null,complete=false,readBytes=0;
    for (let offset=0;offset<max;offset+=pageSize) {
      const query=new URLSearchParams({select,order:'id.asc',...filters,offset:String(offset),limit:String(Math.min(pageSize,max-offset))});
      const {data,headers}=await request(`/rest/v1/${table}?${query}`,{headers:{Prefer:'count=exact'}});
      if (!Array.isArray(data)) throw Error('The data service returned an unexpected response.');
      const count=headers.get('content-range')?.split('/')[1]; if (count && /^\d+$/.test(count)) total=Number(count);
      readBytes+=JSON.stringify(data).length;
      if(readBytes>8000000)throw Error('This Donna read exceeds the safe 8 MB bound. Use a database-owner export for the complete archive.');
      all.push(...data);
      if (total!==null && all.length>=total) {complete=true;break;}
      if (data.length<pageSize) {complete=true;break;}
    }
    return {rows:all,complete,total,source:table,asOf:new Date().toISOString()};
  }
  async function mutate(table,method,body,filters={}) {
    const user=await authorize();
    const query=new URLSearchParams({...filters,owner_id:`eq.${user.id}`});
    const {data}=await request(`/rest/v1/${table}?${query}`,{method,body,headers:{Prefer:'return=representation'}});
    if (!Array.isArray(data)) throw Error('Unexpected storage response.');
    if (method!=='DELETE' && !data[0]) throw Error('The record changed or access was denied. Refresh and try again.');
    return method==='DELETE'?data:data[0];
  }
  async function load(tool) {
    if (!Object.hasOwn(TOOLS,tool)) throw Error('Unknown or disabled business tool.');
    await authorize();
    const parts=await Promise.all(TOOLS[tool].map(x=>readTable(x.table,x.select)));
    return {rows:parts.flatMap(p=>p.rows.map(row=>({...row,source_table:p.source}))),complete:parts.every(p=>p.complete),total:parts.every(p=>p.total!==null)?parts.reduce((n,p)=>n+p.total,0):null,source:parts.map(p=>p.source).join(' + '),asOf:new Date().toISOString()};
  }
  async function ownRead(table, filters={},select='*',pageSize=table==='donna_conversations'?10:COST_POLICY.requestPageSize) {const user=await authorize();return readTable(table,select,{owner_id:`eq.${user.id}`,...filters},COST_POLICY.maximumRowsPerTool,pageSize);}
  function memoryDraft(input) {
    return {title:bounded(input.title,160,'Memory title'),content:bounded(input.content,6000,'Memory content'),category:categories.includes(input.category)?input.category:'Business information',source:bounded(input.source||'Owner teaching session',500,'Source')};
  }
  const api = {
    diagnostics() {return {...usage};},
    async status() { if (!configured) return {configured:false,authenticated:false,admin:false}; if (!session?.access_token) return {configured:true,authenticated:false,admin:false}; try {const user=await authorize();return {configured:true,authenticated:true,admin:true,user:{id:user.id,email:user.email}};} catch(error) { if(error.status===401) persist(null);return {configured:true,authenticated:false,admin:false,error:error.message};} },
    async signIn(email,password) { const {data}=await request('/auth/v1/token?grant_type=password',{method:'POST',token:null,body:{email:String(email).trim(),password}}); if(!data.access_token) throw Error('Sign-in did not return a session.'); persist({...data,expires_at:data.expires_at||Math.floor(Date.now()/1000)+(data.expires_in||3600)}); try {return await authorize();} catch(error) {persist(null);throw error;} },
    async signOut() {try {if(session?.access_token) await request('/auth/v1/logout',{method:'POST'});} finally {persist(null);} },
    setAccessToken(token) {persist(token?{access_token:token}:null);},
    load,
    memories: {
      async list() {return ownRead('donna_memories',{},'id,owner_id,title,content,category,source,status,version,created_at,updated_at');},
      async create(input) {const user=await authorize();return mutate('donna_memories','POST',{...memoryDraft(input),owner_id:user.id,status:'pending'});},
      async update(id,patch) {
        validID(id); const next={};
        for (const [field,max] of [['title',160],['content',6000],['source',500]]) if(Object.hasOwn(patch,field)) next[field]=bounded(patch[field],max,field);
        if(Object.hasOwn(patch,'category')) {if(!categories.includes(patch.category)) throw Error('Choose a supported knowledge category.');next.category=patch.category;}
        if(Object.hasOwn(patch,'status')) {if(!['pending','confirmed','suggestion','outdated'].includes(patch.status)) throw Error('Unsupported memory status.'); if(patch.status==='confirmed'&&patch.approved!==true) throw Error('Review and explicitly approve this memory before confirming it.'); next.status=patch.status;}
        if(!Object.keys(next).length) throw Error('No memory changes supplied.');
        const filters={id:`eq.${id}`}; if(patch.version!==undefined) {if(!Number.isSafeInteger(patch.version)||patch.version<1)throw Error('Invalid memory version.');filters.version=`eq.${patch.version}`;}
        return mutate('donna_memories','PATCH',next,filters);
      },
      async delete(id) {return mutate('donna_memories','DELETE',undefined,{id:`eq.${validID(id)}`});},
      async history(id) {const result=await ownRead('donna_memories',{id:`eq.${validID(id)}`},'id,history');return result.rows[0]?.history||[];}
    },
    conversations: {
      async list() {return ownRead('donna_conversations');},
      async save(input) {
        const title=bounded(input.title||'Conversation',160,'Conversation title');
        if(!Array.isArray(input.messages)||input.messages.length>200) throw Error('A conversation may contain at most 200 messages. Export or start a new conversation.');
        const messages=input.messages.map(m=>({role:['user','assistant'].includes(m.role)?m.role:'user',text:bounded(m.text,6000,'Message'),at:new Date(m.at||Date.now()).toISOString()}));
        if(JSON.stringify(messages).length>100000) throw Error('This conversation exceeds the 100 KB storage limit. Export it and start a new one.');
        if(input.id) return mutate('donna_conversations','PATCH',{title,messages},{id:`eq.${validID(input.id)}`});
        const user=await authorize(); return mutate('donna_conversations','POST',{owner_id:user.id,title,messages});
      },
      async delete(id) {return mutate('donna_conversations','DELETE',undefined,{id:`eq.${validID(id)}`});}
    },
    async exportData() {const [memories,conversations]=await Promise.all([ownRead('donna_memories',{},'*',1),ownRead('donna_conversations')]); if(!memories.complete||!conversations.complete) throw Error('Export exceeds the bounded reader; use the database owner export to include all Donna records.');return {format:'donna-export-v1',exported_at:new Date().toISOString(),memories:memories.rows,conversations:conversations.rows};},
    async deleteData(confirmation) {if(confirmation!=='DELETE MY DONNA DATA') throw Error('Type DELETE MY DONNA DATA to confirm.');await mutate('donna_conversations','DELETE');await mutate('donna_memories','DELETE');return {deleted:true};}
  };
  return api;
}

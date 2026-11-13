#!/usr/bin/env node
/* Disposable local integration test. No hosted endpoints, real accounts, or customer data. */
import {spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createDonnaAPI} from '../../donna/api.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const suffix=randomUUID().slice(0,8), network=`donna-qa-${suffix}`;
const names={db:`${network}-db`,auth:`${network}-auth`,rest:`${network}-rest`};
const password=randomBytes(24).toString('hex'),jwt=randomBytes(36).toString('hex');
const dockerEnv={...process.env};for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete dockerEnv[key];
const docker=(...args)=>{const r=spawnSync('docker',['--host=unix:///var/run/docker.sock',...args],{encoding:'utf8',env:dockerEnv,maxBuffer:8_000_000});if(r.status!==0)throw Error(`Local Docker operation failed: ${args[0]} ${args[1]||''}. Inspect the local container logs without publishing credentials.`);return r.stdout.trim();};
const images={db:'postgres:17.7-alpine@sha256:bb377b7239d2774ac8cc76f481596ce96c5a6b5e9d141f6d0a0ee371a6e7c0f2',auth:'supabase/gotrue:v2.197.0@sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b',rest:'postgrest/postgrest:v14.12@sha256:54000f24847d01a2c2302e0041cf0618b875c57fb48507d743cfa9aaa50bf43c'};
const pause=()=>new Promise(r=>setTimeout(r,400));
const sql=body=>{const r=spawnSync('docker',['--host=unix:///var/run/docker.sock','exec','-i',names.db,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:body,encoding:'utf8',env:dockerEnv,maxBuffer:2_000_000});if(r.status!==0)throw Error('Local SQL failed: '+r.stderr.replaceAll(password,'[test-password]'));return r.stdout;};
async function ready(url){for(let n=0;n<60;n++){try{const r=await fetch(url,{signal:AbortSignal.timeout(1000)});if(r.ok)return;}catch{}await pause();}throw Error('Local service readiness timed out: '+new URL(url).pathname);}
const port=name=>JSON.parse(docker('inspect',name))[0].NetworkSettings.Ports[`${name===names.auth?9999:3000}/tcp`][0].HostPort;
const request=async(url,{method='GET',body,token}={})=>{const r=await fetch(url,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
const checks=[];const check=(name,fn)=>{fn();checks.push(name);};
let createdNetwork=false;
try{
 docker('info','--format','{{.ServerVersion}}');docker('network','create',network);createdNetwork=true;
 docker('run','-d','--name',names.db,'--network',network,'--tmpfs','/var/lib/postgresql/data','-e',`POSTGRES_PASSWORD=${password}`,images.db);
 for(let n=0;n<60;n++){const result=spawnSync('docker',['--host=unix:///var/run/docker.sock','exec',names.db,'pg_isready','-U','postgres'],{env:dockerEnv,stdio:'ignore'});if(result.status===0)break;if(n===59)throw Error('Local Postgres readiness timed out.');await pause();}
 sql(`create extension if not exists pgcrypto; create extension if not exists "uuid-ossp";
 create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
 create role authenticator login noinherit password '${password}'; grant anon,authenticated,service_role to authenticator;
 create role supabase_auth_admin login noinherit createrole password '${password}';
 create schema auth authorization supabase_auth_admin; alter role supabase_auth_admin set search_path to auth;
 grant usage on schema public to anon,authenticated; grant usage on schema auth to authenticated;`);
 docker('run','-d','--name',names.auth,'--network',network,'-p','127.0.0.1::9999',
 '-e','GOTRUE_API_HOST=0.0.0.0','-e','GOTRUE_API_PORT=9999','-e','API_EXTERNAL_URL=http://127.0.0.1/auth/v1',
 '-e','GOTRUE_DB_DRIVER=postgres','-e',`GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:${password}@${names.db}:5432/postgres`,
 '-e','GOTRUE_SITE_URL=http://localhost','-e',`GOTRUE_JWT_SECRET=${jwt}`,'-e','GOTRUE_JWT_AUD=authenticated',
 '-e','GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated','-e','GOTRUE_JWT_EXP=3600','-e','GOTRUE_EXTERNAL_EMAIL_ENABLED=true',
 '-e','GOTRUE_MAILER_AUTOCONFIRM=true','-e','GOTRUE_EXTERNAL_PHONE_ENABLED=false','-e','GOTRUE_DISABLE_SIGNUP=false',images.auth);
 const authOrigin=`http://127.0.0.1:${port(names.auth)}`;await ready(authOrigin+'/health');
 const users={};for(const name of ['owner','secondadmin','nonadmin']){const response=await request(authOrigin+'/signup',{method:'POST',body:{email:`donna-${name}-${suffix}@example.invalid`,password}});assert.equal(response.status,200,'Local fake-account signup');users[name]=response.body.user||response.body;assert.ok(users[name].id);}
 sql(`create or replace function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid $$;
 create table public.admin_users(user_id uuid primary key references auth.users(id));alter table public.admin_users enable row level security;
 create policy own_admin on public.admin_users for select to authenticated using(user_id=(select auth.uid()));grant select on public.admin_users to authenticated;
 insert into public.admin_users values('${users.owner.id}'),('${users.secondadmin.id}');
 create table public.business_tasks(id uuid primary key default gen_random_uuid(),title text,customer_name text,priority text,status text,due_date date,created_at timestamptz default now(),updated_at timestamptz default now());
 alter table public.business_tasks enable row level security;create policy admin_tasks on public.business_tasks for select to authenticated using(exists(select 1 from public.admin_users where user_id=(select auth.uid())));grant select on public.business_tasks to authenticated;
 insert into public.business_tasks(title,customer_name,priority,status,due_date)values('Local QA only','Fictitious fixture','High','Open','2026-11-12');`);
 sql(await readFile(path.join(root,'donna/setup.sql'),'utf8'));
 docker('run','-d','--name',names.rest,'--network',network,'-p','127.0.0.1::3000',
 '-e',`PGRST_DB_URI=postgres://authenticator:${password}@${names.db}:5432/postgres`,'-e','PGRST_DB_SCHEMAS=public',
 '-e','PGRST_DB_ANON_ROLE=anon','-e',`PGRST_JWT_SECRET=${jwt}`,'-e','PGRST_DB_MAX_ROWS=1000',images.rest);
 const restOrigin=`http://127.0.0.1:${port(names.rest)}`;await ready(restOrigin+'/');
 let actualRequests=0;
 const config={supabaseUrl:'https://localqatest.supabase.co',supabasePublishableKey:'sb_publishable_local_qa_only'};
 const make=()=>{const map=new Map();const storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const api=createDonnaAPI(config,{storage,fetchImpl:(input,options)=>{actualRequests++;const u=new URL(input);assert.equal(u.origin,config.supabaseUrl,'No external transport allowed');const auth=u.pathname.startsWith('/auth/v1/');const local=(auth?authOrigin:restOrigin)+u.pathname.replace(auth?'/auth/v1':'/rest/v1','')+u.search;return fetch(local,options);}});return {api,storage,token:()=>JSON.parse(storage.getItem('donna.session.'+config.supabaseUrl)||'null')?.access_token};};
 const owner=make(),second=make(),nonadmin=make();
 await owner.api.signIn(users.owner.email,password);const ownerStatus=await owner.api.status();check('real GoTrue login and live owner allowlist',()=>{assert.equal(ownerStatus.authenticated,true);assert.equal(ownerStatus.admin,true);assert.equal(ownerStatus.user.id,users.owner.id);});
 const tasks=await owner.api.load('tasks');check('real authenticated PostgREST task read',()=>{assert.equal(tasks.complete,true);assert.equal(tasks.rows.length,1);assert.equal(tasks.rows[0].title,'Local QA only');});
 await assert.rejects(nonadmin.api.signIn(users.nonadmin.email,password),/not an authorized/);checks.push('non-admin denied after real login');
 await second.api.signIn(users.secondadmin.email,password);
 let memory=await owner.api.memories.create({title:'Local test procedure',content:'Use only fictitious test data.',category:'Production procedures',source:'Local QA fixture'});
 check('actual SQL trigger makes initial memory pending',()=>{assert.equal(memory.status,'pending');assert.equal(memory.version,1);});
 await assert.rejects(owner.api.memories.update(memory.id,{status:'confirmed'}),/explicitly approve/);checks.push('explicit approval required before storage mutation');
 memory=await owner.api.memories.update(memory.id,{status:'confirmed',approved:true,version:1});check('approved memory persisted through PostgREST',()=>{assert.equal(memory.status,'confirmed');assert.equal(memory.version,2);});
 const own=await owner.api.memories.list(),other=await second.api.memories.list();check('second admin cannot read first owner memory',()=>{assert.equal(own.rows.length,1);assert.equal(other.rows.length,0);});
 await assert.rejects(second.api.memories.update(memory.id,{content:'Cross-owner edit'}),/record changed|access was denied/);checks.push('second admin cannot update another owner memory');
 const forged=await request(restOrigin+'/donna_memories',{method:'POST',token:second.token(),body:{owner_id:users.owner.id,title:'Forged',content:'Rejected',category:'Business information',source:'Local hostile fixture'}});check('direct forged owner insert rejected by actual RLS',()=>assert.equal(forged.status,403));
 memory=await owner.api.memories.update(memory.id,{content:'Corrected fictitious test procedure.',version:2});check('actual trigger resets edited confirmed fact to pending',()=>{assert.equal(memory.status,'pending');assert.equal(memory.version,3);});
 const history=await owner.api.memories.history(memory.id);check('actual PostgreSQL version history retained',()=>assert.equal(history.length,2));
 await assert.rejects(owner.api.memories.update(memory.id,{content:'Stale',version:1}),/record changed|access was denied/);checks.push('stale-version update rejected');
 const conversation=await owner.api.conversations.save({title:'Local QA conversation',messages:[{role:'user',text:'Fictitious prompt',at:new Date().toISOString()}]});
 check('conversation stored under authenticated owner',()=>assert.equal(conversation.owner_id,users.owner.id));
 const ownConversations=await owner.api.conversations.list();check('conversation library lists metadata without transcript bodies',()=>{assert.equal(ownConversations.rows.length,1);assert.equal(Object.hasOwn(ownConversations.rows[0],'messages'),false);});
 const loaded=await owner.api.conversations.get(conversation.id);check('owner retrieves exact stored transcript through real REST',()=>assert.equal(loaded.messages[0].text,'Fictitious prompt'));
 await assert.rejects(second.api.conversations.get(conversation.id),/not found|access|available|conversation|record/i);checks.push('cross-owner single transcript retrieval denied');
 const otherConversations=await second.api.conversations.list();check('second admin cannot list owner conversation',()=>assert.equal(otherConversations.rows.length,0));
 const archive=await owner.api.exportData();check('real database export contains owner data',()=>{assert.equal(archive.memories.length,1);assert.equal(archive.conversations.length,1);});
 const anon=await request(restOrigin+'/donna_memories?select=id');check('anonymous direct REST read denied',()=>assert.ok([401,403].includes(anon.status)));
 await owner.api.deleteData('DELETE MY DONNA DATA');
 const remainingMemory=await owner.api.memories.list(),remainingChat=await owner.api.conversations.list(),remainingTasks=await owner.api.load('tasks');check('explicit deletion clears only Donna-owned data',()=>{assert.equal(remainingMemory.rows.length,0);assert.equal(remainingChat.rows.length,0);assert.equal(remainingTasks.rows.length,1);});
 await owner.api.signOut();check('real Auth logout clears the client session',()=>assert.equal(owner.token(),undefined));
 console.log(JSON.stringify({result:'PASS',checks:checks.length,passed:checks,actualLocalHttpRequests:actualRequests,postgres:'17.7',auth:'GoTrue2.197.0',postgrest:'14.12',hostedSystemsTouched:false,customerDataUsed:false},null,2));
}finally{
 for(const name of [names.rest,names.auth,names.db])spawnSync('docker',['--host=unix:///var/run/docker.sock','rm','-f','-v',name],{env:dockerEnv,stdio:'ignore'});
 if(createdNetwork)spawnSync('docker',['--host=unix:///var/run/docker.sock','network','rm',network],{env:dockerEnv,stdio:'ignore'});
}

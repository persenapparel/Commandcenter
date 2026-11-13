/* Persen POS Epson TM-T20IV Windows station, STAGING ONLY.
 * Uses authenticated Supabase POS queues, not a public HTTP/USB endpoint.
 * Do not connect live hardware until Epson/Volcora wiring and printer RAW
 * transport have been physically approved.
 * Node 22+, Windows + Epson driver. No third-party dependencies.
 */
'use strict';
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const readline=require('node:readline/promises');

const STAGING_PROJECT='naaqcspvbntzdtwuchrr';
const BASE='https://'+STAGING_PROJECT+'.supabase.co';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ESC=0x1b,GS=0x1d;
const MAX_ERRORS=4;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const ascii=value=>String(value??'').normalize('NFKD')
 .replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e]/g,'?').slice(0,180);
const cents=n=>Number.isSafeInteger(n)&&n>=0&&n<=100000000?n:0;
const money=n=>'$'+(cents(n)/100).toFixed(2);
const printColumns=42;
function padAmount(label,amount){
 const a=ascii(label).slice(0,printColumns-12),b=ascii(amount).slice(0,11);
 return a.padEnd(Math.max(a.length,printColumns-b.length),' ')+b;
}
function escposReceipt(sale){
 if(!sale||!UUID.test(String(sale.sale_id||''))||!Array.isArray(sale.items)||sale.items.length>80)throw Error('Invalid verified receipt payload');
 const items=[];
 for(const item of sale.items){
  if(!item||typeof item!=='object'||!Number.isSafeInteger(item.qty)||item.qty<1||item.qty>999)throw Error('Invalid item');
  const price=cents(item.unit_cents);
  items.push(padAmount(String(item.qty)+' x '+ascii(item.name||'Item'),money(price*item.qty)));
  const variation=[item.color,item.size].filter(Boolean).map(ascii).join(' / ');
  if(variation)items.push('  '+variation.slice(0,printColumns-2));
 }
 const hr='-'.repeat(printColumns);
 const date=typeof sale.created_at==='string'&&Number.isFinite(Date.parse(sale.created_at))
  ?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'2-digit',day:'2-digit',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(sale.created_at))+' ET'
  :'';
 const id=String(sale.sale_id).slice(0,8).toUpperCase();
 const line=value=>Buffer.from(ascii(value).slice(0,printColumns)+'\n','ascii');
 const cmd=(...bytes)=>Buffer.from(bytes);
 // Each copy has a separate, complete ESC/POS paper cut. One server-claimed
 // queue job contains both copies and requires just ONE Windows RAW spool call.
 // No cash-drawer pulse is ever part of a receipt payload.
 function copy(kind){
  const merchant=kind==='MERCHANT COPY';
  const chunks=[
   cmd(ESC,0x40),               // Reset before each copy.
   cmd(ESC,0x61,0x01),          // Center.
   cmd(ESC,0x45,0x01,GS,0x21,0x11), // Bold 2x logo-style title.
   line('PERSEN APPAREL'),
   cmd(GS,0x21,0x00,ESC,0x45,0x00),
   line('CUSTOM APPAREL'),
   line('persenapparel.com'),
   line('@persenapparel'),
   line(''),
   cmd(ESC,0x45,0x01),line(kind),cmd(ESC,0x45,0x00),
   cmd(ESC,0x61,0x00),line(hr),
   line('SALE '+id),
   ...(date?[line(date)]:[]),
   ...(sale.event_name?[line('Event: '+ascii(sale.event_name).slice(0,34))]:[]),
   line(hr),
   ...items.map(line),
   line(hr),
   line(padAmount('Subtotal',money(sale.subtotal_cents))),
   line(padAmount('Discount','-'+money(sale.discount_cents))),
   line(padAmount('Tax',money(sale.tax_cents))),
   cmd(ESC,0x45,0x01,GS,0x21,0x01),
   line(padAmount('TOTAL',money(sale.total_cents))),
   cmd(GS,0x21,0x00,ESC,0x45,0x00),
   line(padAmount('Cash received',money(sale.tendered_cents))),
   line(padAmount('Change',money(sale.change_cents))),
   line(hr),
   cmd(ESC,0x61,0x01),
   line(merchant?'MERCHANT RECORD - RETAIN':'THANK YOU FOR YOUR PURCHASE!'),
   ...(!merchant?[line('Thanks for shopping small!'),line('Hope to see you again!')]:[line('Owner copy - same sale, not a new charge')]),
   line(''),
   // Print a centered, high-contrast monochrome logo on BOTH copies by
   // configuring Epson receipt enhancement / NV graphics once per printer.
   // This payload uses text branding as a safe default until that device
   // setting is physically verified. Never assume the logo is installed.
   cmd(ESC,0x61,0x00,0x0a,0x0a,GS,0x56,0x00) // Feed + full cut.
  ];
  return Buffer.concat(chunks);
 }
 return Buffer.concat([copy('CUSTOMER COPY'),copy('MERCHANT COPY')]);
}
function drawerKick(opts={}){
 const pin=opts.pin??0, on=opts.on??50, off=opts.off??250;
 if(![0,1].includes(pin)||!Number.isInteger(on)||on<1||on>250||!Number.isInteger(off)||off<on*4||off>255)
  throw Error('Invalid drawer pulse configuration');
 // ESC p m t1 t2; on=50 => 100ms pulse; off=250 => 500ms rest.
 return Buffer.from([ESC,0x70,pin,on,off]);
}
// RAW output via Windows print spooler (not browser print or a direct USB open).
async function sendRawWindows(data,{printer,helper=path.join(__dirname,'send-raw.ps1'),spawn=cp.spawn}={}){
 if(process.platform!=='win32')throw Error('RAW printer bridge requires Windows');
 if(!printer||typeof printer!=='string'||printer.length>128||/[\r\n]/.test(printer))
  throw Error('Select a Windows printer queue');
 if(!Buffer.isBuffer(data)||data.length<3||data.length>1024*128)throw Error('Invalid RAW payload');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'persen-epson-'));
 const filename=path.join(directory,'payload.bin');
 try{
  await fs.writeFile(filename,data,{mode:0o600});
  await new Promise((resolve,reject)=>{
   const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',helper,'-PrinterName',printer,'-RawPath',filename],{windowsHide:true,stdio:['ignore','ignore','pipe']});
   let err='';
   child.stderr.on('data',d=>{err+=d.toString().slice(0,1000);});
   child.on('error',reject);
   child.on('exit',code=>code===0?resolve():reject(Error('Windows spooler failed ('+code+'): '+err.slice(0,150))));
  });
 }finally{
  await fs.rm(directory,{recursive:true,force:true});
 }
}
function createProcessor({rpc,raw,fetchJobs,logger=()=>{},now=()=>Date.now()}){
 if(typeof rpc!=='function'||typeof raw!=='function'||typeof fetchJobs!=='function')throw Error('Missing printer dependencies');
 const attempted=new Set();
 async function drawer(){
  const jobs=await fetchJobs('drawer');
  const cutoff=now()-24*60*60*1000;
  for(const job of (jobs||[]).slice(0,5)){
   if(!UUID.test(job.id)||job.state!=='queued'||new Date(job.created_at).getTime()<cutoff||attempted.has(job.id))continue;
   const claim=await rpc('pos_claim_drawer_open_job',{p_job:job.id});
   if(!claim)continue;
   if(claim.id!==job.id||!['cash-sale','owner-manual'].includes(claim.kind))throw Error('Invalid drawer claim');
   attempted.add(job.id);
   let sent=false,error=null;
   try{await raw(drawerKick());sent=true;}catch(err){error='RAW spooler unconfirmed';logger(error);}
   // Never retry a claimed drawer job automatically, including when ACK was lost.
   const acknowledged=await rpc('pos_finish_drawer_open_job',{p_job:job.id,p_command_sent:sent,p_error:error});
   if(!acknowledged)logger('Drawer acknowledgement unavailable: reconcile manually');
   return {kind:'drawer',id:job.id,spooled:sent};
  }
  return null;
 }
 async function receipt(){
  const jobs=await fetchJobs('receipt');
  const cutoff=now()-24*60*60*1000;
  for(const job of (jobs||[]).slice(0,5)){
   if(!UUID.test(job.id)||job.state!=='queued'||new Date(job.created_at).getTime()<cutoff||attempted.has(job.id))continue;
   const sale=await rpc('pos_claim_print_job',{p_job:job.id});
   if(!sale)continue;
   attempted.add(job.id);
   let error=null;
   try{await raw(escposReceipt(sale));}catch(err){error='RAW receipt spooler failed';logger(error);}
   await rpc('pos_finish_print_job',{p_job:job.id,p_error:error});
   return {kind:'receipt',id:job.id,spooled:!error};
  }
  return null;
 }
 return Object.freeze({drawer,receipt});
}
function makeClient({key,email,password,fetchImpl=fetch}){
 if(typeof key!=='string'||!key.startsWith('sb_publishable_'))throw Error('Staging publishable key required');
 const headers={apikey:key,'Content-Type':'application/json'};
 let session;
 async function authenticate(grant,body){
  const reply=await fetchImpl(BASE+'/auth/v1/token?grant_type='+grant,{method:'POST',headers,body:JSON.stringify(body)});
  if(!reply.ok)throw Error('Staging login failed ('+reply.status+').');
  session=await reply.json();
  if(!session.access_token||!session.refresh_token)throw Error('Invalid auth response');
 }
 async function authorized(endpoint,method='GET',body){
  if(!session)await authenticate('password',{email,password});
  // Supabase token expiry checked conservatively; refreshed in RAM only.
  if(session.expires_at&&session.expires_at<Math.floor(Date.now()/1000)+90)
   await authenticate('refresh_token',{refresh_token:session.refresh_token});
  const response=await fetchImpl(BASE+'/rest/v1/'+endpoint,{
   method,
   headers:{...headers,Authorization:'Bearer '+session.access_token,...(method==='POST'?{Prefer:'return=representation'}:{})},
   ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  if(!response.ok)throw Error('POS staging API error '+response.status+' at '+endpoint.split('?')[0]);
  const value=await response.json().catch(()=>null);
  return value;
 }
 return {
  rpc:async(name,data)=>authorized('rpc/'+name,'POST',data),
  fetchJobs:async kind=>{
   const table=kind==='drawer'?'pos_drawer_open_jobs':'pos_print_jobs';
   return authorized(table+'?select=id,state,created_at&state=eq.queued&created_at=gte.'+encodeURIComponent(new Date(Date.now()-86400000).toISOString())+'&order=created_at.asc&limit=5');
  }
 };
}
async function hiddenPrompt(question){
 if(!process.stdin.isTTY)throw Error('Use an interactive Windows console to sign in');
 process.stdout.write(question);
 let answer='';
 return new Promise((resolve,reject)=>{
  const onData=chunk=>{
   for(const key of chunk.toString()){
    if(key==='\r'||key==='\n'){process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdout.write('\n');resolve(answer);return;}
    if(key==='\u0003'){process.stdin.setRawMode(false);reject(Error('Cancelled'));return;}
    if(key==='\b'||key==='\u007f'){answer=answer.slice(0,-1);continue;}
    if(answer.length<256)answer+=key;
   }
  };
  process.stdin.setRawMode(true);process.stdin.resume();process.stdin.on('data',onData);
 });
}
async function main(){
 const isDry=process.argv.includes('--self-test');
 if(isDry){
  const sample='00000000-0000-4000-8000-000000000001';
  const s={sale_id:sample,items:[{name:'Christmas Hoodie',qty:1,unit_cents:4000,size:'M'}],subtotal_cents:4000,discount_cents:0,tax_cents:0,total_cents:4000,tendered_cents:5000,change_cents:1000};
  console.log('Epson receipt bytes:',escposReceipt(s).length,'Drawer pulse:',drawerKick().toString('hex'),'No hardware command issued');
  return;
 }
 if(process.platform!=='win32')throw Error('Hardware station only runs on Windows');
 if(process.env.PERSEN_STAGING_PROJECT&&process.env.PERSEN_STAGING_PROJECT!==STAGING_PROJECT)throw Error('Only isolated POS staging allowed');
 const key=process.env.PERSEN_POS_PUBLISHABLE_KEY;
 const printer=process.env.PERSEN_WINDOWS_PRINTER;
 if(!printer)throw Error('Set PERSEN_WINDOWS_PRINTER to the installed Epson queue name');
 if(!key)throw Error('Set PERSEN_POS_PUBLISHABLE_KEY to the staging public key');
 if(process.env.PERSEN_DRAWER_ARMED!=='YES'||process.env.PERSEN_RECEIPTS_ARMED!=='YES')
  throw Error('Drawer and receipt printing must be separately operator-armed after physical tests');
 const rl=readline.createInterface({input:process.stdin,output:process.stdout});
 const email=(await rl.question('Staging owner email: ')).trim();
 rl.close();
 const password=await hiddenPrompt('Staging owner password (hidden): ');
 const api=makeClient({key,email,password});
 const processor=createProcessor({
  rpc:api.rpc,fetchJobs:api.fetchJobs,
  raw:data=>sendRawWindows(data,{printer}),
  logger:message=>console.error('[station]',message)
 });
 console.log('Persen POS Epson station started (staging only). Printer:',printer);
 console.log('The printer must NOT be configured to auto-open the drawer on every print.');
 let failures=0;
 for(;;){
  try{
   // Drawer jobs run first for responsive cash checkout; print jobs follow.
   const a=await processor.drawer();
   const b=await processor.receipt();
   if(a)console.log('Drawer job',a.id,a.spooled?'sent to Windows':'unconfirmed; check physically');
   if(b)console.log('Receipt job',b.id,b.spooled?'sent to Windows':'unconfirmed; check physically');
   failures=0;
  }catch(err){
   failures++;
   console.error('[station]',err.message,'No automatic job retry');
   if(failures>=MAX_ERRORS)throw Error('Station paused after repeated failures. Resolve the issue before restarting.');
  }
  await delay(350);
 }
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={escposReceipt,drawerKick,createProcessor,makeClient,sendRawWindows,ascii};

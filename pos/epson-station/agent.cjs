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
const logoRaster=require('node:zlib').inflateSync(Buffer.from('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','base64'));
// Website QR, error correction Q with a four-module quiet zone.
const websiteQr=require('node:zlib').inflateSync(Buffer.from('eJztltGOQkEIQ/n/n8bsUgoza/b5JvdUM45w9IG0aARCCD1XWdL156inq0AF6axivU4VaKBqRh01y6kCXVDabcdHgW5oAvnPMN8M6XRF/osA2lB6fe1HDxboUoZX/p8ekDsaojd97GwCRScxa81np1Q/jkAnlD3LMd7hPaBretPe+x8oZLZynoA0BrSoZtbVSw3Iswzl0W9roR3OBPoNpNrdcEqBDtPpof8Q2d47w/lyqO3mqs23vwfIe72NlvLdlWCgsNWKKf8d8wSKzP7z2RNdNaC41b1OK9AJeW5lM7nt+kEA0tX57GTGucSAqljQupxbDGhBKurcDNBA+zohBRrI/SY1yvyS4BdDHUWhoVmO44AQQuip+gA3sXNE','base64'));
// Three monochrome snowflakes for the thermal receipt header.
const snowflakeStamp=Buffer.from('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGAAAAABgAAAAAYAAAAAAmAAAAAJgAAAACYAAAAAB2QAAAAdkAAAAHZAAAAAA+4AAAAPuAAAAD7gAAAAMfwAAADH8AAAAx/AAAABMPjAAATD4wAAEw+MAAAD8HDAAA/BwwAAPwcMAAAA+GDEAAPhgxAAD4YMQAAAeGGcAAHhhnAAB4YZwAAB/GHwAAfxh8AAH8YfAAABD2HAAAQ9hwAAEPYcAAAAA+P8AAAPj/AAAD4/wAAAAe4EAAAHuBAAAB7gQAAAAPgAAAAD4AAAAA+AAAAAA7gAAAAO4AAAADuAAAABBj4AAAQY+AAAEGPgAAAB+DMEAAfgzBAAH4MwQAAAfDD8AAHww/AAB8MPwAABzDDwAAcww8AAHMMPAAABDDDcAAQww3AAEMMNwAAAGHBkAABhwZAAAYcGQAAAGPhgAABj4YAAAY+GAAAAGfxgAABn8YAAAZ/GAAAAA74AAAAO+AAAADvgAAAAATcAAAAE3AAAABNwAAAAADIAAAAAyAAAAAMgAAAAADAAAAAAwAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA','base64');
// ESC * uses three vertical bytes per column for each 24-dot strip.
const hoodieIcon=Buffer.from('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAADAAADAAAHAAAGAAAOAAAcAAAYAAA4AABwAAHwAA/4AD/8Af78AfCeA8GOB4EPBwIHDwYDHgQDHAwBHAgBHBgAHBgAHBgAHBgAHBgAHBgBHBgBHhgDHwwDD4YGB8YOA+MMAfGcAP2YAH/4AA/wAAHwAABwAAA4AAAYAAAcAAAMAAAOAAAGAAAHAAADAAADAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAA/AAP/AD/8A//AP/wA/8AA/AAAwAAAAAAAAAAAAAAAAAAHAAA/AAD/AAD/AAD/AAAAAAAAAAAAAAAAAAAAAAAAgAAAgAeAx/+A//gA+AAA8AAAcAAAYAAA4AAA8AAA/wAAj/AAgP4AAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AAD/AAD/AAA/AAAHAAAAAAAAAAAAAAAAwAAA/gAA/+AAP/8AAf/4AB//AAD/AAAHAAAAAAAAAAAAAAAAAAAAA4AAP8AA/8AA/MAAwOAAAGAAAGAAAGAAAHAAADAAADAAAfgAD/AA/8AA/gAA8//g///w///w+ABwAABwAABwAABwAYBwB4BwP4Bw8YBwwYBwwYBwwYBwwYBwwYBwwYBwwYBwwYBwwYBwwYBwwYBwwYBwwYBw4YBwOYBwD4BwA4BwAIBwAABwAABw+ABw///w///w8//g/gAA/8AAD/AAAfgAADAAADAAAHAAAGAAAGAAAGAAgOAA/MAA/8AAf8AAA4AAAAAA','base64');
const tagIcon=Buffer.from('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAADAAAHAAAPAAAfAAA+AAB8AAD4AAHwAAPgAAfAAA+AAB8AAD4AAHwAAHgAAHAAAHAAAHAAAHAAAHAAAHAAAHAAAHAAAHAAAHAAAHAAAHAAAHAAAHAcAHA+AHBjAHBjAHBjAHA+AHAcAHgAAHwAAD4AAB8AAA+AAAfAAAPgAAH/AAD/AAB/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKAAAfAAA/gAB/wAD74AHx8APg+AfAeA+APB8AHD4AHHwADPgABfAAA+AAA8AAA4AAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAADAAAHAAAPAAAfAAA+AAB8AAD4AAHwAAPgAAfA//+A//8A//4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAwAAA4AAA8AAA+AAAfAAAPgAAHwAAD4AAB8AAA+AAAfAAAPAAAHgAADwAAD4AAB8AAA+AAAfAAAPgAAHAAAPgAAfAAA+AAB8AAD4AAHwAAPgAAfAAA+AAB8AAD4AAHwAAHgAAPAAAeAAA8AAA8AAA4AAAwAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA','base64');
function productTag(item){
 const name=ascii(item.name||'Item');
 const icon=/hood(?:ie|y|ed)/i.test(name)?hoodieIcon:tagIcon;
 const wrap=value=>value.match(/.{1,29}(?:\s|$)|.{1,29}/g)?.map(part=>part.trim())||[];
 const details=[...wrap(name)];
 const variation=[item.color,item.size].filter(Boolean).map(ascii).join(' / ');
 if(variation)details.push(...wrap(variation));
 details.push(item.qty+' x '+money(item.unit_cents));
 const parts=[];
 const text=value=>parts.push(Buffer.from(value,'ascii'));
 const command=(...bytes)=>parts.push(Buffer.from(bytes));
 const seam='+'+'- '.repeat(20)+'+\n';
 text(seam);command(ESC,0x33,24);
 for(let row=0;row<Math.max(3,details.length);row++){
  text('| ');
  if(row<3){
   command(ESC,0x2a,33,68,0);
   parts.push(icon.subarray(row*204,(row+1)*204));
  }
  // Dot positions align the item copy and stitched edge across all strips.
  command(ESC,0x24,104,0);command(ESC,0x45,row===0?1:0);
  text(details[row]||'');command(ESC,0x45,0);
  command(ESC,0x24,236,1);text('|\n');
 }
 command(ESC,0x32);text(seam);
 return Buffer.concat(parts);
}
// Code 128 set C stores the full sale UUID as 20 decimal pairs.
const code128Widths='212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112'.split(' ');
function returnBarcode(id){
 const digits=BigInt('0x'+id.replace(/-/g,'')).toString().padStart(40,'0');
 const pairs=digits.match(/../g).map(Number);
 const checksum=pairs.reduce((sum,value,index)=>sum+value*(index+1),105)%103;
 const symbols=[105,...pairs,checksum,106];
 const row=Buffer.alloc(69); // two dots per module, including quiet zones
 let x=20;
 for(const symbol of symbols){
  let black=true;
  for(const width of code128Widths[symbol]){
   for(let dot=0;dot<Number(width)*2;dot++,x++){
    if(black)row[x>>3]|=128>>(x%8);
   }
   black=!black;
  }
 }
 return Buffer.concat([Buffer.from([GS,0x76,0x30,0,row.length,0,48,0]),...Array(48).fill(row)]);
}
// One-bit Long Island lighthouse patch, 368 by 120 printer dots.
const winterPatch=require('node:zlib').inflateSync(Buffer.from('eJzV2L9u2zgYAPCPoVFmKESPHQgpfYNOVw06K0BfJFu3wjfFwyFm0QLZnEe4Rzm5Gbylr6CiQ7ZC3VzUNY//ZNOyI33cegTi2NYPNvmZIvl9AJGNKlSrnC5xemMxwWGlpNF8g+tw2ZjHrEIOb20eb7DRsHCN7LjMzBfUKe6jZ0x3mVVXOP2M1jokROI0kToo6TMcBriaARTnWD0udOdfYfVzHY7mEqvPOEAtXaeGNWFAloDV8EHST3j9pqIf8fplxUZ4fVFzH+4pQo+bZGyfEMwtcT71mm5RWlzYJ8zddf1tlHudtQvAgL60T0rVDOuzPHdaqTVCi1ya//rWRAyTeG0WN/tGDjc8oY2OEVkLmLDbcP1oNW/XuRwUT9haa7Zxugn11OpM69pqou4W3Ghu9SoLxkOSv+Cg3zm5v1ukL/RMSJ4L+IOtRBF0fOG1BHcz5/T+80KA0SMB11qLXv3+80NuNAejH0XSrx+8rox+i9Sswelv+d9aUx2Tr7fXg/qd1WD1a6xOBSiEvsmF0YkgalUO6PuHiYnx9NzqrD/e5H4xSY1OUkGWWvf9luV3tUj1LqfnyTb7sVzxcJ7sdDtPykYlKbN6k/1cPvJwDp7QN0lq5zdrsp9S6+pYwxxzp+10DaIf/rY66YehJtX/VjO8pjJS8yg9j9EEs/HsNI/QTG88RqdQqM2E3almvi3NjGeSN/sTY6uJOtZbq8sNzOuOZoEuvVZOb0F1del2kpOaHGm/7ySQ6+u3soAZFFwa/SqjzdWh5qc0sxo4bQcZ6F/mPS6Qujad45OZ1qtDzeSxhp3+M9DmPfbPkV539HxjR6lbxv7t/DrmwLHTxaPVpdvL9RbbjWCmwOnXgfbnhOJYr905jF0H2h+1ZmzZdHTV6qnW13aU7Wc37H1Hm2Sgq4uJvURqJjs6P9BzpzN7iZ7W5o99bbQuQ80kTrv7mkvar7P9HNQBANqNSaDVxur51v/ypaLdeE+9pl9CXTlNdifLQJvlXn+pMhPkQMPTut5rWntdwmk90LxuYrS5iTFHU6dFmFQP6sZ+9mxYm5OpXo9NG1zBSWJOvT55JfWQtmfksX9V9FHYn6hdY/Ipt9OXwcuB3OFMiFCPn3JemwyG2SyADAfc5jtmgXW1iwE+ynXmNXIU9jvGE63N04hLSS6HNEcn6CZj1NkoepQXtc500aN8WeksGj3KN5XL0HGj/CDb7B/RdPYfWVmIq1rEVUTiqi1xlZy4KlFcBSquuhVZOYurysVV/OKqiXGVysgqaET7DwjEcOg=','base64'));
function escposReceipt(sale){
 if(!sale||!UUID.test(String(sale.sale_id||''))||!Array.isArray(sale.items)||sale.items.length>80)throw Error('Invalid verified receipt payload');
 const items=[];
 for(const item of sale.items){
  if(!item||typeof item!=='object'||!Number.isSafeInteger(item.qty)||item.qty<1||item.qty>999)throw Error('Invalid item');
  items.push(productTag(item));
 }
 const parts=[];
 const cmd=(...bytes)=>parts.push(Buffer.from(bytes));
 const line=value=>parts.push(Buffer.from(ascii(value)+'\n','ascii'));
 const center=on=>cmd(ESC,0x61,on?1:0);
 const bold=on=>cmd(ESC,0x45,on?1:0);
 const size=value=>cmd(GS,0x21,value);
 cmd(ESC,0x40);center(true);
 // Monochrome raster from assets/persen-logo.png, packed MSB first for the Epson.
 cmd(GS,0x76,0x30,0,34,0,15,1);
 parts.push(logoRaster);
 size(0x11);bold(true);line('PERSEN APPAREL');size(0);bold(false);
 cmd(GS,0x76,0x30,0,15,0,32,0);
 parts.push(snowflakeStamp);
 bold(true);line('Long Island');bold(false);line('');
 center(false);
 line('Receipt #'+sale.sale_id.slice(0,8).toUpperCase());
 const date=new Date(sale.created_at);
 if(sale.created_at&&Number.isFinite(date.getTime()))line(date.toLocaleString('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'})+' ET');
 if(sale.cashier_first_name)line('Helped by '+ascii(sale.cashier_first_name).slice(0,32));
 for(const tag of items)parts.push(tag);
 line(padAmount('Subtotal',money(sale.subtotal_cents)));
 if(sale.discount_cents)line(padAmount('Discount','-'+money(sale.discount_cents)));
 line(padAmount('Tax',money(sale.tax_cents)));
 bold(true);size(0x11);line('TOTAL'.padEnd(21-money(sale.total_cents).length)+money(sale.total_cents));size(0);bold(false);
 if(!sale.payment_method||sale.payment_method==='cash'){
  line(padAmount('Cash received',money(sale.tendered_cents)));
  line(padAmount('Change',money(sale.change_cents)));
 }else line('Paid with '+ascii(sale.payment_method).replace(/_/g,' '));
 center(true);line('');line('Scan for returns');parts.push(returnBarcode(sale.sale_id));line('');
 cmd(GS,0x76,0x30,0,46,0,120,0);parts.push(winterPatch);line('');bold(true);line('THANKS FOR SHOPPING SMALL!');bold(false);
 line('Tag us in your new gear: @persenapparel');line('');
 bold(true);line("Got a shirt idea? Let's make it.");bold(false);
 cmd(GS,0x76,0x30,0,37,0,40,1);
 parts.push(websiteQr);
 line('persenapparel.com');
 cmd(0x0a,0x0a,GS,0x56,0);
 // Keep both copies in one Windows job. Each cut ends one physical slip.
 cmd(ESC,0x40);cmd(ESC,0x4d,1);cmd(ESC,0x33,24);
 bold(true);line('PERSEN APPAREL  |  MERCHANT COPY');bold(false);
 line('Receipt #'+sale.sale_id.slice(0,8).toUpperCase()+
  (sale.created_at&&Number.isFinite(date.getTime())?'  '+date.toLocaleString('en-US',{timeZone:'America/New_York',dateStyle:'short',timeStyle:'short'})+' ET':''));
 if(sale.cashier_first_name)line('Cashier: '+ascii(sale.cashier_first_name).slice(0,32));
 for(const item of sale.items){
  const variant=[item.color,item.size].filter(Boolean).map(ascii).join(' / ');
  line((item.qty+' x '+ascii(item.name||'Item')).slice(0,30)+(variant?'  '+variant.slice(0,24):''));
 }
 const method=ascii(sale.payment_method||'cash').replace(/_/g,' ').toUpperCase();
 bold(true);line(padAmount(method+' TOTAL',money(sale.total_cents)));bold(false);
 cmd(0x0a,0x0a,GS,0x56,0);return Buffer.concat(parts);
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
   const dispatchKey='receipt:'+job.id+':'+(job.attempts??0);
   if(!UUID.test(job.id)||job.state!=='queued'||new Date(job.created_at).getTime()<cutoff||attempted.has(dispatchKey))continue;
   const sale=await rpc('pos_claim_print_job',{p_job:job.id});
   if(!sale)continue;
   attempted.add(dispatchKey);
   let error=null,receiptBytes=null;
   // Keep bad server-claimed data separate from Windows RAW transport failures.
   // Diagnostics stay on the local agent console: never write exception details,
   // customer data or printer paths to the shared staging job queue.
   try{receiptBytes=escposReceipt(sale);}
   catch(err){
    error='Receipt payload rejected';
    logger('Receipt job '+job.id+' payload rejected: '+String(err?.message||'Unknown validation error').slice(0,180));
   }
   if(!error){
    try{await raw(receiptBytes);}
    catch(err){
     error='RAW receipt spooler failed';
     logger('Receipt job '+job.id+' Windows RAW spool failed: '+String(err?.message||'Unknown Windows error').slice(0,240));
    }
   }
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
   const fields=kind==='receipt'?'id,state,created_at,attempts':'id,state,created_at';
   return authorized(table+'?select='+fields+'&state=eq.queued&created_at=gte.'+encodeURIComponent(new Date(Date.now()-86400000).toISOString())+'&order=created_at.asc&limit=5');
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
function testReceiptSale(){
 const saleId='00000000-0000-4000-8000-000000000001';
 return {sale_id:saleId,cashier_first_name:'Sample cashier',created_at:new Date().toISOString(),items:[{name:'Epson RAW test (no sale)',qty:1,unit_cents:0,size:'TEST'}],subtotal_cents:0,discount_cents:0,tax_cents:0,total_cents:0,tendered_cents:0,change_cents:0};
}
// Explicit, isolated Windows hardware diagnostic. This never touches Supabase,
// claims a queued sale, or sends ESC/POS drawer-pulse bytes.
async function testPrinterRaw({printer,send=sendRawWindows}={}){
 const payload=escposReceipt(testReceiptSale());
 if(payload.includes(drawerKick()))throw Error('Unsafe test receipt contains drawer command');
 await send(payload,{printer});
 return payload.length;
}
async function main(){
 const isDry=process.argv.includes('--self-test');
 const isPrinterTest=process.argv.includes('--printer-test');
 if(isDry&&isPrinterTest)throw Error('Choose one test mode');
 if(isDry){
  const sample='00000000-0000-4000-8000-000000000001';
  const s={sale_id:sample,items:[{name:'Christmas Hoodie',qty:1,unit_cents:4000,size:'M'}],subtotal_cents:4000,discount_cents:0,tax_cents:0,total_cents:4000,tendered_cents:5000,change_cents:1000};
  console.log('Epson receipt bytes:',escposReceipt(s).length,'Drawer pulse:',drawerKick().toString('hex'),'No hardware command issued');
  return;
 }
 if(isPrinterTest){
  if(process.platform!=='win32')throw Error('Epson direct printer test runs on Windows only');
  const printer=process.env.PERSEN_WINDOWS_PRINTER;
  if(!printer)throw Error('Set PERSEN_WINDOWS_PRINTER to the exact installed Windows printer queue name');
  const bytes=await testPrinterRaw({printer});
  console.log('Epson RAW sample submitted to Windows queue:',printer,'('+bytes+' bytes). Verify paper and cut physically.');
  return;
 }
 if(process.platform!=='win32')throw Error('Hardware station only runs on Windows');
 if(process.env.PERSEN_STAGING_PROJECT&&process.env.PERSEN_STAGING_PROJECT!==STAGING_PROJECT)throw Error('Only isolated POS staging allowed');
 const key=process.env.PERSEN_POS_PUBLISHABLE_KEY;
 const printer=process.env.PERSEN_WINDOWS_PRINTER;
 if(!printer)throw Error('Set PERSEN_WINDOWS_PRINTER to the installed Epson queue name');
 if(!key)throw Error('Set PERSEN_POS_PUBLISHABLE_KEY to the staging public key');
 const drawerArmed=process.env.PERSEN_DRAWER_ARMED==='YES';
 const receiptsArmed=process.env.PERSEN_RECEIPTS_ARMED==='YES';
 if(!drawerArmed&&!receiptsArmed)
  throw Error('Epson station is disarmed. Enable receipt printing and/or the cash drawer only after the relevant physical checks.');
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
 console.log('Receipts:',receiptsArmed?'ARMED':'DISARMED','· Cash drawer:',drawerArmed?'ARMED':'DISARMED');
 console.log('Disable any printer-driver option to auto-open the drawer on printing.');
 let failures=0;
 for(;;){
  try{
   // Independently armed: first test receipts with the drawer strictly OFF.
   // No drawer claim, ESC/POS pulse or retry while PERSEN_DRAWER_ARMED!=YES.
   const a=drawerArmed?await processor.drawer():null;
   const b=receiptsArmed?await processor.receipt():null;
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
module.exports={escposReceipt,drawerKick,createProcessor,makeClient,sendRawWindows,testPrinterRaw,ascii};

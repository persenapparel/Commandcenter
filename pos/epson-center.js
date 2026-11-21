/* Owner-only Epson queue monitor: the browser never prints or opens the drawer.
 * Only the trusted Windows agent can claim a sale receipt or drawer command.
 * Refresh is read-only. A failed receipt needs a separate, explicit owner retry
 * after checking that no paper was already printed. NEVER retry drawer jobs. */
(()=>{'use strict';
 const $=id=>document.getElementById(id);
 const text=(id,value)=>{const target=$(id);if(target)target.textContent=String(value);};
 const DAY=24*60*60*1000;
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 let db=null,ownerId=null,timer=null,loading=false,retrying=false;
 const stateLabel={
  queued:'Queued — waiting for Windows station',
  printing:'Claimed — check Windows before taking action',
  claimed:'Claimed — hardware result not verified',
  'command-sent':'Submitted to Windows — physically verify drawer',
  unconfirmed:'Unconfirmed — inspect drawer; never auto-retry',
  submitted_to_browser:'Submitted to Windows — physically verify receipt',
  printed:'Reported printed — verify paper',
  failed:'Receipt failed — printer needs attention'
 };
 const age=job=>Date.now()-new Date(job.created_at).getTime();
 function retryType(job){
  const attempts=Number(job.attempts);
  if(!UUID.test(String(job.id||''))||!Number.isInteger(attempts)||attempts<0||attempts>=5)return '';
  if(job.state==='failed')return 'failed';
  if(job.state==='queued'&&attempts===0&&age(job)>DAY)return 'held';
  return '';
 }
 function displayJobs(hostId,jobs,empty){
  const host=$(hostId);if(!host)return;host.replaceChildren();
  if(!jobs.length){const p=document.createElement('p');p.className='muted';p.textContent=empty;host.append(p);return;}
  const isReceipt=hostId==='epson-receipt-list';
  for(const job of jobs){
   const line=document.createElement('div');line.className='epson-job';
   const left=document.createElement('div'),right=document.createElement('span');
   const title=document.createElement('strong'),time=document.createElement('small');
   const id=String(job.id||''),held=job.state==='queued'&&age(job)>DAY;
   title.textContent=(id?'Job …'+id.slice(-8):'Job')+' · '+(held?'Held >24 hours — owner review':stateLabel[job.state]||String(job.state||'Unknown'));
   const date=new Date(job.created_at);
   time.textContent=Number.isFinite(date.getTime())?date.toLocaleString():'Unknown time';
   if(isReceipt)time.textContent+=' · Attempt '+Number(job.attempts||0)+'/5';
   left.append(title,time);
   right.textContent=held?'Held':job.state==='queued'?'Waiting':job.state==='unconfirmed'||job.state==='failed'?'Check needed':'Review';
   right.className='epson-job-state';
   line.append(left,right);
   // Only receipts have a manual requeue action. Drawer commands never do.
   const type=isReceipt?retryType(job):'';
   if(type){
    const button=document.createElement('button');button.type='button';button.className='epson-retry';
    button.textContent=type==='held'?'Release held receipt':'Retry failed receipt';
    button.title='Only after physically confirming this receipt did not print. Never opens the cash drawer.';
    button.addEventListener('click',()=>void retryReceipt(job,button));
    line.append(button);
   }
   host.append(line);
  }
 }
 async function jobs(table){
  const {data,error}=await db.from(table)
   .select(table==='pos_print_jobs'?'id,state,attempts,created_at':'id,state,created_at')
   .eq('owner_id',ownerId).order('created_at',{ascending:false}).limit(30);
  if(error)throw error;
  return data||[];
 }
 async function retryReceipt(job,button){
  if(!db||!ownerId||retrying||!retryType(job))return;
  // This is not a reprint of the sale or a cash drawer operation.
  const held=retryType(job)==='held';
  if(!window.confirm(
   (held?'This receipt is held because it is older than 24 hours. ':'This receipt previously failed. ')+
   'Check the Epson paper and Windows print queue first. Have you physically verified that THIS receipt did NOT print? '+
   'Only this receipt will be queued once; the cash drawer will NOT open.'
  ))return;
  retrying=true;button.disabled=true;
  text('epson-action-result','Requesting one receipt requeue. Refresh alone never prints.');
  try{
   const {data,error}=await db.rpc('pos_retry_print_job',{p_job:job.id});
   if(error)throw error;
   text('epson-action-result',data===true?
    'Receipt requeued once. The Windows Epson agent must be running, and paper output still needs physical confirmation. No drawer command was sent.':
    'Not requeued. The job may have changed, exceeded its attempt limit, or needs owner review.');
  }catch(_){
   text('epson-action-result','Could not requeue this receipt. Check owner access and the staging receipt-retry function. Nothing was printed from this page.');
  }finally{
   retrying=false;button.disabled=false;
   await refresh();
  }
 }
 async function refresh(){
  if(!db||!ownerId||loading)return;
  loading=true;
  const button=$('epson-refresh');
  if(button)button.disabled=true;
  try{
   const results=await Promise.allSettled([jobs('pos_print_jobs'),jobs('pos_drawer_open_jobs')]);
   const names=['epson-receipt-list','epson-drawer-list'];
   let healthy=0,failed=0,held=0;
   results.forEach((result,i)=>{
    if(result.status==='fulfilled'){
     healthy++;
     const records=result.value;
     displayJobs(names[i],records,'No recent '+(i===0?'receipt':'cash drawer')+' commands.');
     if(i===0){
      failed=records.filter(j=>j.state==='failed').length;
      held=records.filter(j=>j.state==='queued'&&age(j)>DAY).length;
     }
     text(i===0?'epson-receipt-queue':'epson-drawer-queue',
      records.filter(j=>j.state==='queued'&&age(j)<=DAY).length+' recent queued (latest 30)');
    }else{
     displayJobs(names[i],[],'Queue unavailable: check staging owner permissions and connection.');
     text(i===0?'epson-receipt-queue':'epson-drawer-queue','Unavailable');
    }
   });
   text('epson-monitor-status',healthy===2?
    'Receipt history: '+failed+' failed, '+held+' held over 24h (latest 30). Refresh only updates statuses; retry requires owner confirmation. This screen never operates the printer or drawer.':
    'One or more staging queues unavailable. Do not enable unattended printing.');
   text('epson-last-checked','Last checked '+new Date().toLocaleTimeString());
  }catch(_){
   text('epson-monitor-status','Unable to refresh staging queue. No printer or drawer command was sent.');
  }finally{loading=false;if(button)button.disabled=false;}
 }
 function attach({db:database,owner}){
  if(!database||!owner?.id||!$('print-center'))return;
  db=database;ownerId=owner.id;
  $('epson-refresh').addEventListener('click',()=>void refresh());
  if(timer)clearInterval(timer);
  timer=setInterval(()=>{if(!document.hidden)void refresh()},8000);
  void refresh();
 }
 window.PersenEpsonCenter={attach};
})();

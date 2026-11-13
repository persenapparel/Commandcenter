/* Read-only Epson queue monitor. This browser is NEVER a print/drawer driver.
 * It cannot detect hardware or claim queued jobs: the trusted Windows agent does that.
 * Owner RLS and the staging-only Supabase configuration remain the authorization boundary. */
(()=>{'use strict';
 const $=id=>document.getElementById(id);
 const text=(id,value)=>{const target=$(id);if(target)target.textContent=String(value);};
 let db=null,ownerId=null,timer=null,loading=false;
 const stateLabel={
  queued:'Queued — waiting for Windows station',
  claimed:'Claimed — hardware result not verified',
  'command-sent':'Submitted to Windows — physically verify drawer',
  unconfirmed:'Unconfirmed — inspect hardware before any retry',
  submitted_to_browser:'Submitted — physical print not verified',
  printed:'Reported printed — verify paper',
  failed:'Reported failure — investigate before any retry'
 };
 function displayJobs(hostId,jobs,empty){
  const host=$(hostId);if(!host)return;host.replaceChildren();
  if(!jobs.length){const p=document.createElement('p');p.className='muted';p.textContent=empty;host.append(p);return;}
  for(const job of jobs){
   const line=document.createElement('div');line.className='epson-job';
   const left=document.createElement('div'),right=document.createElement('span');
   const title=document.createElement('strong'),time=document.createElement('small');
   const id=String(job.id||'');
   title.textContent=(id?'Job …'+id.slice(-8):'Job')+' · '+(stateLabel[job.state]||String(job.state||'Unknown state'));
   const date=new Date(job.created_at);
   time.textContent=Number.isFinite(date.getTime())?date.toLocaleString():'Unknown time';
   left.append(title,time);
   right.textContent=job.state==='queued'?'Waiting':job.state==='unconfirmed'||job.state==='failed'?'Check needed':'Review';
   right.className='epson-job-state';
   line.append(left,right);host.append(line);
  }
 }
 async function jobs(table){
  const {data,error}=await db.from(table).select('id,state,created_at').eq('owner_id',ownerId).order('created_at',{ascending:false}).limit(10);
  if(error)throw error;
  return data||[];
 }
 async function refresh(){
  if(!db||!ownerId||loading)return;
  loading=true;
  const button=$('epson-refresh');
  if(button)button.disabled=true;
  try{
   const results=await Promise.allSettled([jobs('pos_print_jobs'),jobs('pos_drawer_open_jobs')]);
   const names=['epson-receipt-list','epson-drawer-list'];
   let healthy=0;
   results.forEach((result,i)=>{
    if(result.status==='fulfilled'){
     healthy++;
     const records=result.value;
     displayJobs(names[i],records,'No recent '+(i===0?'receipt':'cash drawer')+' commands.');
     text(i===0?'epson-receipt-queue':'epson-drawer-queue',records.filter(j=>j.state==='queued').length+' queued (latest 10)');
    }else{
     displayJobs(names[i],[],'Queue unavailable: check whether the Epson staging schema and owner permissions were installed.');
     text(i===0?'epson-receipt-queue':'epson-drawer-queue','Unavailable');
    }
   });
   text('epson-monitor-status',healthy===2
    ?'Showing staging queue history only — Windows station power and physical printing cannot be confirmed by this page.'
    :'One or more staging queues unavailable. Do not enable unattended printing.');
   text('epson-last-checked','Last checked '+new Date().toLocaleTimeString());
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

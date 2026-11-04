/* Standalone owner-only print station for NELKO PL70E testing.
   Chrome kiosk-printing MAY suppress the dialog. Browser printing cannot confirm paper output. */
'use strict';
const $=id=>document.getElementById(id);
const C=window.PersenPOSCore,R=window.PersenPOSReceipt;
let db=null,user=null,armed=false,printing=false,loadError=false,timer=null;
let reviewLink='',season=null,template=null,lastReceipt=null,seenJob=null;
const errorText=e=>String(e?.message||e||'Unknown print error').slice(0,190);
function message(s){$('station-message').textContent=s}
async function checked(q){const {data,error}=await q;if(error)throw error;return data}
function showArmed(){ $('dot').classList.toggle('on',armed);$('station-state').textContent=armed?'Listening for paid sales':'Paused';$('arm').disabled=armed;$('disarm').disabled=!armed;}
const text=(el,value)=>{$(el).textContent=String(value??'')};
function line(el,value){
 const box=document.createElement('div');box.className='print-pair';
 const label=document.createElement('span');label.textContent=String(value.name||'Item')+' ×'+Number(value.qty||0);
 const total=document.createElement('span');total.textContent=C.money((Number(value.unit_cents)||0)*(Number(value.qty)||0));
 box.append(label,total);el.append(box);
 const parts=[value.color,value.size].filter(Boolean).join(' / ');
 if(parts){const sub=document.createElement('div');sub.className='print-small';sub.style.textAlign='left';sub.textContent=parts;el.append(sub);}
}
function renderReceipt(sale){
 lastReceipt=sale;const sample=sale.is_test===true;
 text('receipt-number',sample?'PRINT TEST — NO SALE':'SALE #'+String(sale.sale_id).slice(0,8).toUpperCase()+' · '+new Date(sale.created_at).toLocaleString('en-US'));
 const parent=$('receipt-lines');parent.replaceChildren();
 for(const item of sale.items||[])line(parent,item);
 for(const k of ['subtotal','discount','tax','total'])text('receipt-'+k,(k==='discount'?'−':'')+C.money(sale[k+'_cents']||0));
 const presentation=R.presentation({headline:template?.headline,promotion:template?.promotion,footer:template?.footer,review:template?.review_message,showReview:template?.show_review,showSeason:template?.show_seasonal,reviewLink,season});
 text('receipt-headline',presentation.headline);
 text('receipt-seasonal',presentation.seasonal);
 $('receipt-seasonal').hidden=!presentation.seasonal;
 text('receipt-promotion',presentation.promotion);
 text('receipt-review-message',presentation.review_url?presentation.review:'');
 text('receipt-review-link',presentation.review_url?presentation.review_url:'');
 $('receipt-review-message').hidden=!presentation.review_url;
 $('receipt-review-link').hidden=!presentation.review_url;
 text('receipt-footer',presentation.footer);
}
function applyPaper(){
 const [width,height]=$('paper').value.split('x').map(Number);
 // @page size is also set dynamically so Chrome can match the driver.
 let el=$('receipt-paper-size');
 if(!el){el=document.createElement('style');el.id='receipt-paper-size';document.head.append(el);}
 el.textContent='@page{size:'+width+'mm '+height+'mm;margin:0}@media print{body,#receipt{width:'+width+'mm!important}}';
}
function printReceipt(sale){applyPaper();renderReceipt(sale);window.print();}
async function loadSettings(){
 const [t,content]=await Promise.all([
  checked(db.from('pos_receipt_templates').select('*').eq('owner_id',user.id).order('updated_at',{ascending:false}).limit(40)),
  checked(db.from('site_content').select('key,value').in('key',['v54_google_reviews','seasonal_campaigns_v1']))
 ]);
 template=t.find(x=>x.active)||t[0]||null;
 const cfg=Object.fromEntries(content.map(x=>[x.key,x.value]));
 reviewLink=R.reviewUrl(cfg.v54_google_reviews);
 if(window.PersenSeasonal?.active)season=window.PersenSeasonal.active(cfg.seasonal_campaigns_v1);
 else season=C.season(cfg.seasonal_campaigns_v1);
 if(season)message('Seasonal Studio synced: '+season.title+'. Receipt station ready to arm.');
}
async function recentJobs(){
 if(!db||!user)return;
 try{
 const jobs=await checked(db.from('pos_print_jobs').select('id,sale_id,state,attempts,created_at').eq('owner_id',user.id).order('created_at',{ascending:false}).limit(12));
 const parent=$('job-list');parent.replaceChildren();
 if(!jobs.length){parent.textContent='No sales queued yet.';return;}
 for(const job of jobs){
 const div=document.createElement('div');div.className='station-job';
 const details=document.createElement('div');const b=document.createElement('strong');b.textContent='#'+job.sale_id.slice(0,8).toUpperCase();
 const small=document.createElement('small');small.textContent=' · '+new Date(job.created_at).toLocaleString();details.append(b,small);
 const status=document.createElement('small');status.textContent=job.state.replaceAll('_',' ');
 const actions=document.createElement('div');
 if(job.state!=='queued'&&job.attempts<5){
 const retry=document.createElement('button');retry.textContent='Retry';
 retry.title='Only retry after checking the printer did not already print this receipt.';
 retry.onclick=async()=>{if(!confirm('Have you checked that this receipt did NOT already print? Retrying could make a duplicate.'))return;try{const ok=await checked(db.rpc('pos_retry_print_job',{p_job:job.id}));message(ok?'Receipt queued again.':'Could not requeue receipt.');await recentJobs()}catch(e){message(errorText(e))}};
 actions.append(retry);
 }
 div.append(details,status,actions);parent.append(div);
 }
 }catch(e){message('Print history unavailable: '+errorText(e))}
}
async function processQueue(){
 if(!armed||printing||!db||!user)return;
 printing=true;
 try{
 const cutoff=new Date(Date.now()-24*3600*1000).toISOString();
 const list=await checked(db.from('pos_print_jobs').select('id,sale_id,created_at,state').eq('owner_id',user.id).eq('state','queued').gte('created_at',cutoff).order('created_at',{ascending:true}).limit(1));
 if(!list.length)return;
 const job=list[0];
 const sale=await checked(db.rpc('pos_claim_print_job',{p_job:job.id}));
 if(!sale)return;
 seenJob=job.id;
 try{
   printReceipt(sale);
   // The call returning DOES NOT prove physical printing. It means Chrome accepted the request.
   await checked(db.rpc('pos_finish_print_job',{p_job:job.id,p_error:null}));
   message('Receipt '+String(sale.sale_id).slice(0,8).toUpperCase()+' sent to Chrome. Confirm paper printed on the NELKO.');
 }catch(err){
   try{await checked(db.rpc('pos_finish_print_job',{p_job:job.id,p_error:errorText(err)}))}catch{}
   message('Print request failed: '+errorText(err)+'. Resolve printer problem, then manually retry.');
 }
 await recentJobs();
 }catch(e){
   message('Print queue unavailable: '+errorText(e)+'. Pause and check connection.');
   armed=false;showArmed();
 }finally{printing=false;}
}
async function signIn(e){
 e?.preventDefault();
 if(!window.PA?.ready){message('Supabase not configured.');return;}
 try{
 db=PA.db;const f=e?new FormData(e.currentTarget):null;
 if(f)await PA.signIn(String(f.get('email')),String(f.get('password')));
 user=await PA.me();
 if(!user||!await PA.isAdmin(user))throw Error('Authorized cashier account required.');
 $('login-panel').hidden=true;$('station-panel').hidden=false;
 await loadSettings();
 await recentJobs();
 if(timer)clearInterval(timer);
 timer=setInterval(processQueue,950);
 showArmed();
 message('Print station signed in. Check driver/paper, run TEST, then click Start automatic printing.');
 }catch(e){message(errorText(e))}
}
$('print-login').onsubmit=signIn;
$('arm').onclick=()=>{armed=true;showArmed();message('Automatic print station armed. Keep Chrome open and the USB printer powered on.');void processQueue();};
$('disarm').onclick=()=>{armed=false;showArmed();message('Print station paused. Paid receipts stay queued for later printing.');};
$('test-print').onclick=()=>{const t={is_test:true,sale_id:'TEST',created_at:new Date().toISOString(),items:[{name:'Persen Apparel test item',qty:1,unit_cents:1000,color:'',size:'M'}],subtotal_cents:1000,discount_cents:0,tax_cents:0,total_cents:1000};try{printReceipt(t);message('Test sent to Chrome. Confirm paper size and whether your NELKO actually printed it.')}catch(e){message(errorText(e))}};
$('paper').onchange=applyPaper;
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&armed)void processQueue()});
window.addEventListener('beforeunload',()=>{armed=false});
showArmed();applyPaper();void signIn(null);

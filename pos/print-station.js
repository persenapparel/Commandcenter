/* Standalone owner-only print station for NELKO PL70E testing.
   Chrome kiosk-printing MAY suppress the dialog. Browser printing cannot confirm paper output. */
'use strict';
const $=id=>document.getElementById(id);
const C=window.PersenPOSCore,R=window.PersenPOSReceipt;
let db=null,user=null,armed=false,printing=false,loadError=false,timer=null;
let testPrintRequested=false,printerConfirmed=false;
let reviewLink='',season=null,template=null,lastReceipt=null,seenJob=null;
const errorText=e=>String(e?.message||e||'Unknown print error').slice(0,190);
function message(s){$('station-message').textContent=s}
async function checked(q){const {data,error}=await q;if(error)throw error;return data}
function showArmed(){
 $('dot').classList.toggle('on',armed);
 $('station-state').textContent=armed?'Listening for paid sales · paper verified':(printerConfirmed?'Paused · printer test verified':'Paused · printer not verified');
 $('arm').disabled=armed||!printerConfirmed;
 $('disarm').disabled=!armed;
}
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
 text('receipt-cash-tendered',C.money(sale.tendered_cents??sale.total_cents));text('receipt-cash-change',C.money(sale.change_cents||0));const presentation=R.presentation({headline:template?.headline,promotion:template?.promotion,footer:template?.footer,review:template?.review_message,showReview:template?.show_review,showSeason:template?.show_seasonal,reviewLink,season});
 text('receipt-headline',presentation.headline);
 text('receipt-season-heading',presentation.season_style.icon+'  '+presentation.season_style.label+'  '+presentation.season_style.icon);
 $('receipt-season-heading').hidden=!presentation.season_style.label;
 text('receipt-seasonal',presentation.seasonal);
 $('receipt-seasonal').hidden=!presentation.seasonal;
 text('receipt-promotion',presentation.promotion);
 text('receipt-review-message',presentation.review_url?presentation.review:'');
 text('receipt-review-link',presentation.review_url?presentation.review_url:'');
 $('receipt-review-message').hidden=!presentation.review_url;
 $('receipt-review-link').hidden=!presentation.review_url;
 text('receipt-footer',presentation.footer);
}
const Paper=window.PersenPOSPaperLayout;
function pageOptions(){return {paper:$('paper').value,marginMm:Number($('receipt-margin').value),fontPx:Number($('receipt-font').value),feedMm:Number($('receipt-feed').value)};}
function applyPaper(){
 const opts=pageOptions(),base=Paper.layoutFor({...opts,contentPx:0}),receipt=$('receipt');
 receipt.style.width=base.widthMm+'mm';receipt.style.minHeight='0';receipt.style.boxSizing='border-box';
 receipt.style.padding=opts.marginMm+'mm';receipt.style.fontSize=opts.fontPx+'px';receipt.style.lineHeight='1.25';
 const layout=Paper.layoutFor({...opts,contentPx:receipt.scrollHeight});
 let el=$('receipt-paper-size');if(!el){el=document.createElement('style');el.id='receipt-paper-size';document.head.append(el);}
 el.textContent=layout.fits?Paper.printCss(layout,opts):'';
 text('paper-feedback',layout.fits?'Estimated '+layout.widthMm+' × '+layout.heightMm+' mm ('+layout.kind+'). '+(layout.kind==='continuous'?'Content-sized roll page; confirm actual driver/media support.':'Fixed stock length; remaining blank space is physical label media.'):'Cannot print: '+layout.reason+'. Choose longer media or reduce receipt contents.');
 return layout;
}
function printReceipt(sale){renderReceipt(sale);const layout=applyPaper();if(!layout.fits)throw Error(layout.reason);window.print();}
function sampleReceipt(){return {is_test:true,sale_id:'TEST',created_at:new Date().toISOString(),items:[{name:'Persen Apparel test item',qty:1,unit_cents:1000,color:'',size:'M'}],subtotal_cents:1000,discount_cents:0,tax_cents:0,total_cents:1000,tendered_cents:2000,change_cents:1000};}
function resetPrinterVerification(){printerConfirmed=false;testPrintRequested=false;armed=false;$('test-printed').checked=false;$('test-printed').disabled=true;showArmed();text('printer-check-message','Paper/layout changed. Print and physically verify another test before arming.');}
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
 const status=document.createElement('small');
 const stale=job.state==='queued'&&Date.now()-new Date(job.created_at).getTime()>24*3600*1000;
 status.textContent=stale?'Queued — older than 24 hours, held for manual review':job.state.replaceAll('_',' ');
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
$('arm').onclick=()=>{
 if(!printerConfirmed){message('First print a test receipt and confirm the physical paper came out correctly.');return;}
 armed=true;showArmed();message('Automatic print station armed. Keep Chrome open and the USB printer powered on. Browser printing cannot detect paper jams.');void processQueue();
};
$('disarm').onclick=()=>{armed=false;showArmed();message('Print station paused. Paid receipts stay queued for later printing.');};
$('test-print').onclick=()=>{
 const t=sampleReceipt();
 testPrintRequested=false;printerConfirmed=false;armed=false;
 $('test-printed').checked=false;$('test-printed').disabled=true;showArmed();
 try{
  printReceipt(t);testPrintRequested=true;$('test-printed').disabled=false;
  text('printer-check-message','Chrome was asked to print. Check that real paper came out before checking the box.');
  message('Test sent to Chrome. Confirm the paper printed correctly, then check the verification box to enable automatic receipts.');
 }catch(e){text('printer-check-message','Print command failed. Fix the printer before activating automatic printing.');message(errorText(e))}
};
$('test-printed').onchange=()=>{
 printerConfirmed=testPrintRequested&&$('test-printed').checked;
 if(!printerConfirmed)armed=false;
 showArmed();
 text('printer-check-message',printerConfirmed?'Physical test confirmed by operator for this browser session.':'Printer not verified. Automatic printing disabled.');
 message(printerConfirmed?'Physical receipt test confirmed. You can start automatic printing.':'Printer not confirmed. Print a sample receipt before starting automatic printing.');
};
$('preview-test').onclick=()=>{
 try{renderReceipt(sampleReceipt());const layout=applyPaper();if(!layout.fits)throw Error(layout.reason);
 document.body.classList.toggle('preview-open');
 $('preview-test').textContent=document.body.classList.contains('preview-open')?'Hide sample preview':'Preview sample receipt (no printing)';
 message('Preview only; no paper has been printed. Test physical output separately.');
 }catch(e){message('Preview unavailable: '+errorText(e));}
};
function onReceiptPaperChange(){resetPrinterVerification();applyPaper();}
$('paper').onchange=onReceiptPaperChange;
for(const id of ['receipt-margin','receipt-font','receipt-feed'])$(id).onchange=onReceiptPaperChange;
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&armed)void processQueue()});
window.addEventListener('beforeunload',()=>{armed=false});
showArmed();applyPaper();void signIn(null);

// @ts-nocheck
// Persen POS Resend transactional receipt worker — REVIEW BEFORE DEPLOYING.
// Only trusted server-side scheduler can invoke this function with a secret header.
// Never expose service keys or this secret in the POS browser.
const env=key=>Deno.env.get(key)||"";
const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const escapeHTML=x=>String(x??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const money=v=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(v||0)/100);
function validatedGoogleReview(raw){
 try{const u=new URL(String(raw||""));const host=u.hostname.toLowerCase();
  return u.protocol==="https:"&&(host==="g.page"||host==="google.com"||host.endsWith(".google.com")||host==="maps.app.goo.gl")?u.href:"";
 }catch{return""}
}
function emailHTML(sale,reviewLink){
 const items=Array.isArray(sale.snapshot?.items)?sale.snapshot.items:[];
 const table=items.slice(0,90).map(i=>'<tr><td style="padding:8px">'+Number(i.qty||1)+' × '+escapeHTML(i.name)+'</td><td style="text-align:right">'+escapeHTML(money(Number(i.qty||1)*Number(i.unit_cents||0)))+'</td></tr>').join('');
 return '<html><body style="background:#f2f7ff;font:15px Arial,sans-serif;padding:22px;color:#16345d"><div style="background:#fff;border-radius:14px;max-width:560px;padding:22px;margin:auto"><h2>PERSEN APPAREL</h2><h3>Thank you for your order!</h3><p>Receipt #'+escapeHTML(String(sale.id).slice(0,8).toUpperCase())+'</p><table style="width:100%">'+table+'</table><hr><p>Subtotal '+money(sale.subtotal_cents)+' / Discount '+money(sale.discount_cents)+' / Tax '+money(sale.tax_cents)+'</p><h2>Total paid '+money(sale.total_cents)+'</h2><p>Thank you for shopping with Persen Apparel on Long Island!</p>'+ (reviewLink?'<p><a href="'+escapeHTML(reviewLink)+'">Enjoyed your order? Leave an honest Google review!</a></p>':'') +'<p>Visit <a href="https://persenapparel.com">persenapparel.com</a> for custom apparel.</p></div></body></html>';
}
Deno.serve(async req=>{
 if(req.method!=="POST")return respond({error:"Method not allowed"},405);
 const secret=env("POS_RECEIPT_WORKER_SECRET");
 if(secret.length<36||req.headers.get("x-pos-receipt-worker-secret")!==secret)return respond({error:"Forbidden"},403);
 const endpoint=env("SUPABASE_URL").replace(/\/$/,"")+"/rest/v1";
 const service=env("SUPABASE_SERVICE_ROLE_KEY"),api=env("RESEND_TRANSACTIONAL_API_KEY"),from=env("RESEND_RECEIPTS_FROM");
 if(!endpoint.startsWith("https://")||!service||!api||!from)return respond({error:"Worker secrets not configured"},503);
 const baseHeaders={"apikey":service,"authorization":"Bearer "+service,"content-type":"application/json"};
 async function query(path,init={}){
   const response=await fetch(endpoint+path,{...init,headers:{...baseHeaders,...(init.headers||{})},signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw Error("Database request failed: "+response.status);
   return response.json();
 }
 let attempted=0,sent=0,failed=0;
 try{
  const jobs=await query("/pos_receipt_delivery_jobs?select=id,sale_id,owner_id,status,channel,attempts&channel=eq.email&status=eq.awaiting_sender&order=created_at.asc&limit=5");
  const reviewRows=await query("/site_content?select=key,value&key=eq.v54_google_reviews&limit=1");
  const reviewLink=validatedGoogleReview(reviewRows[0]?.value);
  for(const job of jobs){
   if(job.attempts>=5)continue;
   const id=encodeURIComponent(job.id);
   const claimed=await query("/pos_receipt_delivery_jobs?id=eq."+id+"&status=eq.awaiting_sender",{
     method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({status:"sending",attempts:job.attempts+1})
   });
   if(claimed.length!==1)continue;
   attempted++;
   try{
    const records=await query("/pos_sales?select=id,owner_id,snapshot,subtotal_cents,discount_cents,tax_cents,total_cents&id=eq."+encodeURIComponent(job.sale_id)+"&limit=1");
    const sale=records[0];
    if(!sale||sale.owner_id!==job.owner_id||sale.snapshot?.receipt_email!==true)throw Error("Receipt request not authorized");
    const to=String(sale.snapshot?.email||"").trim();
    if(to.length>250||!/^\S+@\S+\.\S+$/.test(to))throw Error("Receipt email not supplied");
    const result=await fetch("https://api.resend.com/emails",{
      method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+api,"Idempotency-Key":"persen-pos-receipt-"+job.id},
      body:JSON.stringify({from,to:[to],subject:"Persen Apparel receipt #"+String(sale.id).slice(0,8).toUpperCase(),html:emailHTML(sale,reviewLink)}),
      signal:AbortSignal.timeout(12000)
    });
    const response=await result.json().catch(()=>({}));
    if(!result.ok||typeof response.id!=="string")throw Error("Email provider rejected request: "+result.status);
    await query("/pos_receipt_delivery_jobs?id=eq."+id+"&status=eq.sending",{
      method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({status:"sent",sent_at:new Date().toISOString(),provider_id:String(response.id).slice(0,150),last_error:null})
    });
    sent++;
   }catch(err){
    failed++;
    await query("/pos_receipt_delivery_jobs?id=eq."+id+"&status=eq.sending",{
      method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({status:"failed",last_error:String(err?.message||"Send failed").slice(0,180)})
    }).catch(()=>{});
   }
  }
  return respond({attempted,sent,failed});
 }catch(err){return respond({error:"Worker failed",detail:String(err?.message||"Unknown error").slice(0,140)},503)}
});

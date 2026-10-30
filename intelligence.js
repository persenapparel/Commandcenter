/* V4 rule-based business briefing. No AI, external network calls, or private storage. */
'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.PersenIntelligence=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const day=86400000;
 const at=(v)=>{const n=Date.parse(v);return Number.isFinite(n)?n:null};
 const start=(now)=>{const x=new Date(now);return Date.UTC(x.getFullYear(),x.getMonth(),x.getDate());};
 const daysSince=(v,now)=>{const n=at(v);return n===null?0:Math.max(0,Math.floor((now-n)/day));};
 const balance=(invoice,payments=[])=>Math.max(0,Math.round((Number(invoice.total||0)-payments.filter(p=>p.invoice_id===invoice.id).reduce((a,p)=>a+Number(p.amount||0),0))*100)/100);
 function brief(data,clock=new Date()){
  const now=new Date(clock).getTime(),today=start(clock),items=[];
  const add=(priority,kind,title,detail,view,id)=>items.push({priority,kind,title,detail,view,id});
  for(const m of data.messages||[])if(m.status==='New')add(2,'inbox','New customer message',`${m.name||'Customer'} · ${daysSince(m.created_at,now)} day(s) ago`,'messages',m.id);
  for(const t of data.tasks||[]){if(t.status==='Done'||!t.due_date)continue;const due=at(t.due_date+'T00:00:00Z');if(due<today)add(3,'task','Overdue follow-up',t.title,'tasks',t.id);else if(due===today)add(2,'task','Follow-up due today',t.title,'tasks',t.id);}
  for(const inv of data.invoices||[]){if(inv.document_type==='Estimate'||inv.status==='Void'||inv.status==='Draft')continue;const outstanding=balance(inv,data.payments||[]);if(outstanding<=0)continue;if(inv.due_date&&at(inv.due_date+'T00:00:00Z')<today)add(3,'invoice','Invoice overdue',`${inv.invoice_number} · $${outstanding.toFixed(2)} outstanding`,'invoices',inv.id);}
  for(const q of data.quotes||[])if(['New','Reviewing'].includes(q.status)&&daysSince(q.created_at,now)>=2)add(2,'quote','Quote needs follow-up',`${q.name||'Customer'} · ${daysSince(q.created_at,now)} day(s) waiting`,'quotes',q.id);
  for(const s of data.stock||[])if(Number(s.quantity)<=Number(s.reorder_at))add(1,'stock','Low inventory',`${s.sku} · ${s.quantity} on hand`,'stock',s.id);
  const orders=[...(data.orders||[]),...(data.manualOrders||[])];
  for(const o of orders){if(['Completed','Cancelled'].includes(o.status))continue;if(['Awaiting proof','Artwork review'].includes(o.status))add(2,'production','Artwork approval needed',o.title,'orders',o.id);if(o.due_date&&at(o.due_date+'T00:00:00Z')<today)add(3,'production','Order deadline overdue',o.title,'orders',o.id);}
  items.sort((a,b)=>b.priority-a.priority||a.title.localeCompare(b.title));
  return {items,urgent:items.filter(x=>x.priority===3).length,attention:items.filter(x=>x.priority===2).length,lowStock:items.filter(x=>x.kind==='stock').length,unpaid:(data.invoices||[]).filter(i=>i.document_type!=='Estimate'&&i.status!=='Void'&&balance(i,data.payments||[])>0).length,computedAt:new Date(clock).toISOString()};
 }
 return {brief,balance,daysSince};
});

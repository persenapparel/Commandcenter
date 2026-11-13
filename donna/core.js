/* Donna's free, deterministic tools. No model/provider or network access. */
export const COST_POLICY = Object.freeze({ monthlyBudgetCents: 0, cloudAI: false, paidAPIs: false, telephoneCalls: false, automaticMessages: false, businessWrites: false, fallbackProvider: null, provider: 'deterministic', requestPageSize: 100, maximumRowsPerTool: 1000 });
export function moneyToCents(value, label = 'Amount') {
  const s = String(value ?? '').trim().replace(/^\$/, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) throw Error(`${label}: enter a nonnegative dollar amount with at most two decimal places.`);
  const [whole, fractional = ''] = s.split('.');
  const result = Number(whole) * 100 + Number(fractional.padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result > 10000000000) throw Error(`${label} is too large.`);
  return result;
}
export function calculatePricing(input) {
  const quantity = Number(input.quantity ?? 1);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000) throw Error('Quantity must be a whole number from 1 to 100,000.');
  const priceCents = moneyToCents(input.price, 'Selling price');
  const costs = ['garment', 'transfer', 'labor', 'packaging', 'shipping', 'fees', 'overhead'];
  const fixedCosts = costs.map(key => moneyToCents(input[key], key));
  const feeBasisPoints = moneyToCents(input.feePercent ?? '0', 'Fee percentage');
  if (feeBasisPoints > 10000) throw Error('Fee percentage cannot exceed 100%.');
  const unitFeeCents = Math.round(priceCents * feeBasisPoints / 10000);
  const unitCostCents = fixedCosts.reduce((sum, amount) => sum + amount, unitFeeCents);
  const unitProfitCents = priceCents - unitCostCents;
  const revenueCents = priceCents * quantity, totalCostCents = unitCostCents * quantity;
  if (![revenueCents, totalCostCents].every(Number.isSafeInteger)) throw Error('This calculation exceeds the supported amount.');
  return { priceCents, unitCostCents, unitProfitCents, revenueCents, totalCostCents, profitCents: revenueCents - totalCostCents, marginPercent: priceCents ? unitProfitCents / priceCents * 100 : null, markupPercent: unitCostCents ? unitProfitCents / unitCostCents * 100 : null, quantity, warning: unitProfitCents < 0 ? 'This price loses money based on the costs you entered.' : 'Estimate based on your entered costs. Sales tax is not included in profit; unentered costs are not estimated.' };
}
const rows = value => Array.isArray(value) ? value : value?.rows || [];
const missing = (data, key) => { const value=data[key]; return !Array.isArray(value) && (!value || !Array.isArray(value.rows) || value.complete!==true || Boolean(value.error)); };
const usd = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const closed = value => ['done', 'completed', 'cancelled', 'canceled', 'void'].includes(String(value || '').toLowerCase());
export function easternDate(now = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year:'numeric', month:'2-digit',day:'2-digit' }).format(new Date(now)); }
export function invoiceBalanceCents(invoice, payments) {
  const total = moneyToCents(invoice.total, 'Invoice total');
  const paid = payments.filter(p => p.invoice_id === invoice.id).reduce((sum, p) => sum + moneyToCents(p.amount, 'Payment amount'), 0);
  return Math.max(0, total - paid);
}
export function buildBriefing(data = {}, now = new Date()) {
  const today = easternDate(now), items = [], incomplete = [];
  for (const key of ['tasks','orders','invoices','payments','inventory','events']) if (missing(data, key)) incomplete.push(key);
  for (const t of rows(data.tasks)) if (!closed(t.status)) {
    const overdue = t.due_date && t.due_date < today;
    const priority = String(t.priority).toLowerCase();
    if (overdue || t.due_date === today || ['high','urgent'].includes(priority)) items.push({ priority:overdue || priority==='urgent' ? 3 : 2, kind:'task', id:t.id, title:t.title, detail:overdue ? `Overdue since ${t.due_date}` : t.due_date ? `Due ${t.due_date}` : `${priority==='urgent'?'Urgent':'High priority'}; no due date recorded` });
  }
  for (const o of rows(data.orders)) if (!closed(o.status) && o.due_date && o.due_date <= today) items.push({ priority:o.due_date < today ? 3 : 2, kind:'order', id:o.id, title:o.title, detail:`Production ${o.due_date < today ? 'overdue' : 'due today'} · ${o.due_date}` });
  if (!missing(data, 'invoices') && !missing(data, 'payments')) for (const inv of rows(data.invoices)) {
    if (['Estimate'].includes(inv.document_type) || ['Draft','Void'].includes(inv.status) || !inv.due_date || inv.due_date >= today) continue;
    try { const balance = invoiceBalanceCents(inv, rows(data.payments)); if (balance > 0) items.push({ priority:3, kind:'invoice',id:inv.id,title:`Invoice ${inv.invoice_number} is overdue`,detail:`${usd(balance)} outstanding · due ${inv.due_date}` }); } catch { incomplete.push('invalid invoice or payment amount'); }
  }
  for (const item of rows(data.inventory)) if (Number.isFinite(Number(item.quantity)) && Number.isFinite(Number(item.reorder_at)) && Number(item.quantity) <= Number(item.reorder_at)) items.push({priority:1,kind:'inventory',id:item.id,title:`Low stock · ${item.sku}`,detail:`${item.quantity} on hand · reorder level ${item.reorder_at}`});
  for (const event of rows(data.events)) if (event.active!==false && event.event_date && event.event_date >= today) items.push({ priority:1,kind:'event',id:event.id,title:event.name,detail:`Event · ${event.event_date}` });
  items.sort((a,b) => b.priority-a.priority || a.title.localeCompare(b.title));
  return { items, urgent:items.filter(x => x.priority===3).length, incomplete:[...new Set(incomplete)], computedAt:new Date(now).toISOString() };
}
export function answerMessage(message, { data = {}, memories = [], now = new Date() } = {}) {
  const text = String(message || '').trim().slice(0, 6000), normalized = text.toLowerCase();
  const need = (tool, explanation) => ({ intent:tool, tool, text:missing(data,tool) ? `I'd be happy to help. ${explanation} I need a complete, current ${tool} read from Command Center first. Please sign in or refresh that section; I won't guess from missing records.` : null });
  if (/\b(teach|remember|save this|my business procedure)\b/.test(normalized)) return {intent:'teach',draft:{content:text,status:'pending'},text:"Of course. Let's review this as a memory draft in Teach Donna. I'll only use it as an approved business fact after you confirm it."};
  if (/\b(morning|briefing|priorities|when i get home|overwhelmed|so much work)\b/.test(normalized)) {
    const briefing = buildBriefing(data, now); return {intent:'briefing',tool:'overview',text:briefing.items.length ? `Let's take it one step at a time. Here are the first priorities from the records loaded:\n${briefing.items.slice(0,5).map(x=>`• ${x.title}: ${x.detail}`).join('\n')}${briefing.incomplete.length ? `\nThis briefing is incomplete: ${briefing.incomplete.join(', ')} need a complete current read.` : ''}` : `Let's get organized. ${briefing.incomplete.length ? `I need current ${briefing.incomplete.join(', ')} records before I can give a full briefing.` : 'No configured priority rules were triggered in the loaded records. Please review open tasks and orders as well.'}`};
  }
  if (/\b(profit|pricing|price|sell .*\$|margin|markup|cost)\b/.test(normalized)) return {intent:'pricing',text:"Let's check the numbers carefully. Open Pricing & profit and enter your actual garment, transfer, labor, packaging, shipping, fees, and overhead costs per item. I'll calculate the estimated profit and margin, and keep revenue separate from profit."};
  if (/\b(owes|owed|outstanding|unpaid|invoices?)\b/.test(normalized)) {
    const required = need('invoices', 'Outstanding balances require actual invoices and the full payment ledger.');
    if (required.text) return required;
    if (missing(data,'payments')) return {intent:'invoices',tool:'invoices',text:"I have invoice records, but the payment ledger is incomplete. I can't safely calculate what is owed yet."};
    let balances; try { balances = rows(data.invoices).filter(i=>i.document_type!=='Estimate'&&!['Draft','Void'].includes(i.status)).map(i=>({invoice:i,balance:invoiceBalanceCents(i,rows(data.payments))})).filter(i=>i.balance>0); } catch { return {intent:'invoices',text:'One invoice or payment has an invalid amount. Please review it in Command Center before relying on a balance.'}; }
    return {intent:'invoices',tool:'invoices',text:balances.length ? `These recorded invoices have outstanding balances:\n${balances.slice(0,15).map(({invoice:i,balance})=>`• ${i.customer_name} · ${i.invoice_number}: ${usd(balance)}`).join('\n')}${balances.length>15?'\nMore balances are listed in Invoices.':''}\nDrafts and estimates are excluded. These are balances, not profit.` : 'No outstanding balances were found among the complete loaded non-draft, non-void invoices. Estimates are excluded.'};
  }
  if (/\b(inventory|stock|hoodies|garments|blanks)\b/.test(normalized)) {
    const required = need('inventory', 'Stock quantities must come from actual inventory.'); if (required.text) return required;
    const stop = new Set(['donna','how','many','do','i','we','have','in','my','our','inventory','stock','are','there','what','is','the','can','you','check','please','size','sizes','any','left','on','hand']);
    const sizes = {small:'s',medium:'m',large:'l',xl:'xl',xxl:'xxl',xxxl:'xxxl',s:'s',m:'m',l:'l',xs:'xs',xxs:'xxs'};
    const normalizeProduct = value => String(value||'').toLowerCase().replace(/\b(?:extra[ -]?large|x-large)\b/g,'xl').replace(/\bhoodies\b/g,'hoodie').replace(/\bt-shirts\b/g,'t-shirt');
    const terms = normalizeProduct(normalized).replace(/[?.,]/g,'').split(/\s+/).filter(w=>w&&!stop.has(w));
    const matching = rows(data.inventory).filter(i=>terms.every(term=> {
      if(Object.hasOwn(sizes,term)) return String(i.size||'').toLowerCase()===sizes[term];
      const haystack = normalizeProduct(`${i.sku} ${i.product_name||''} ${i.color||''}`);
      return haystack.includes(term) || term.length>3 && term.endsWith('s') && haystack.includes(term.slice(0,-1));
    }));
    return {intent:'inventory',tool:'inventory',text:matching.length ? `Here's the current stock from the loaded Command Center records:\n${matching.slice(0,20).map(i=>`• ${i.sku} · ${i.product_name||''} ${i.color||''} ${i.size||''}: ${i.quantity} on hand`).join('\n')}${matching.length>20?'\nSee Inventory for the remaining records.':''}` : 'I did not find a matching stock record. Please check the exact product name, SKU, color, and size in Inventory. Missing stock is not proof of zero stock.'};
  }
  if (/\b(tasks?|follow.ups?|deadlines?|orders?|customers?|agreements?|events?|calendar)\b/.test(normalized)) {
    const tool = /task|follow.up/.test(normalized) ? 'tasks' : /customer/.test(normalized) ? 'contacts' : /agreement/.test(normalized) ? 'agreements' : /event|calendar/.test(normalized) ? 'events' : 'orders';
    const required = need(tool, 'I use your authorized records for business questions.'); if (required.text) return required;
    const list = rows(data[tool]).filter(x=>!closed(x.status));
    return {intent:tool,tool,text:list.length ? `Here's what the loaded ${tool} records show:\n${list.slice(0,12).map(x=>`• ${x.title||x.name||x.full_name||x.invoice_number||x.id}${x.status?` · ${x.status}`:''}${x.due_date?` · due ${x.due_date}`:''}`).join('\n')}` : `No matching open ${tool} records were found in this complete read.`};
  }
  if (/\b(memory|procedure|quote process|know about)\b/.test(normalized)) {
    const approved = memories.filter(m=>m.status==='confirmed');
    return {intent:'memory',text:approved.length ? `Here are your approved notes. These are stored knowledge, not model training:\n${approved.slice(0,8).map(m=>`• ${m.title}: ${m.content}`).join('\n')}` : "I don't have approved notes loaded yet. You can teach me a process, review the draft, and save it to Memory."};
  }
  if (/^(hi|hello|hey)( donna)?[!. ]*$/.test(normalized)) return {intent:'greeting',text:'Hey! What can I help you with today? We can organize priorities, check your records, review a pricing decision, or save a business procedure.'};
  if (/\b(call|send|email|publish|buy|purchase|update|delete|change stock)\b/.test(normalized)) return {intent:'restricted',text:"I can help you prepare a draft or organize the details. Sending, calling, purchases, and business record changes are disabled in this free first version. You'll make the final action yourself in the appropriate app."};
  return {intent:'help',text:"I'm here to help. In this free web version I use clear business rules, your approved memory, and authenticated records. Try “What are my priorities?”, “Check inventory”, “Who still owes money?”, or teach me a procedure. Open-ended AI conversation needs the native on-device app; I won't pretend this rule-based response is a model answer."};
}

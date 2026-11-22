/* Draft document editing for Persen Command Center.
   No automatic email, production payment changes, or signed-agreement mutations. */
(function(){
  'use strict';
  const rootEl=document.getElementById('owner-app');
  if(!rootEl||typeof render!=='function'||typeof PA==='undefined')return;
  function eligible(inv){
    return !!inv && inv.status==='Draft' &&
      !data.agreements.some(a=>a.invoice_id===inv.id) &&
      !data.payments.some(p=>p.invoice_id===inv.id) &&
      !(inv.document_type==='Estimate'&&data.invoices.some(x=>x.source_estimate_id===inv.id));
  }
  function field(label,name,type,max){
    return '<div><label class="form-label">'+safe(label)+'</label><input class="field" name="'+name+'" type="'+(type||'text')+'"'+(max?' maxlength="'+max+'"':'')+(name==='customer_name'?' required':'')+'></div>';
  }
  function moneyField(label,name){
    return '<div><label class="form-label">'+safe(label)+'</label><input class="field" name="'+name+'" type="number" min="0" max="999999" step="0.01" value="0"></div>';
  }
  function button(label,handler,klass){
    const el=document.createElement('button');
    el.type='button';el.className='btn '+(klass||'ghost')+' sm';el.textContent=label;
    el.addEventListener('click',handler);return el;
  }
  // Compose-only outreach. Browser account/apps handle actual sending.
  function shareable(inv){
    if(!inv||inv.status==='Void')return false;
    if(inv.document_type==='Estimate')return inv.status==='Draft'||inv.status==='Sent';
    return !!PersenAgreements?.signed(data.agreements.find(a=>a.invoice_id===inv.id));
  }
  function recipientContact(inv){
    const byId=inv.contact_id?data.contacts.find(c=>c.id===inv.contact_id):null;
    if(byId)return byId;
    const email=String(inv.customer_email||'').trim().toLowerCase();
    if(!email)return null;
    const matches=data.contacts.filter(c=>String(c.email||'').trim().toLowerCase()===email);
    return matches.length===1?matches[0]:null;
  }
  function outreachMessage(inv,method){
    const kind=inv.document_type==='Estimate'?'estimate':'invoice';
    const name=String(inv.customer_name||'').trim().split(/\s+/)[0]||'there';
    const amount=usd(inv.total);
    const paid=kind==='invoice'?data.payments.filter(p=>p.invoice_id===inv.id)
      .reduce((sum,p)=>sum+Math.round(Number(p.amount)*100),0):0;
    const balance=Math.max(0,Math.round(Number(inv.total)*100)-paid)/100;
    const payment=kind==='invoice'?(balance>0?' Balance due: '+usd(balance)+'.':' Paid in full.'):'';
    const timing=kind==='estimate'||balance>0;
    if(method==='sms')return 'Hi '+name+', this is Persen Apparel. Your '+kind+' '+inv.invoice_number+' totaling '+amount+' is ready to review.'+payment+' We can email you the PDF if needed. Please let us know if you have any questions. Thank you!';
    const dates=timing&&inv.due_date?'\n'+(kind==='estimate'?'Valid until: ':'Due date: ')+inv.due_date+'.\n':'';
    return 'Hello '+String(inv.customer_name||'there')+',\n\nPlease find your Persen Apparel '+kind+' '+inv.invoice_number+' for '+amount+'.'+payment+'\n'+dates+'\nPlease review the attached PDF for the complete itemized details, and let us know if you would like to discuss anything.\n\nThank you,\nPersen Apparel';
  }
  function cleanPhone(raw){
    const num=String(raw||'').trim().replace(/[\s().-]/g,'');
    if(!/^\+?\d{7,15}$/.test(num))throw Error('Enter a valid phone number, including area code.');
    return num;
  }
  function openOutreach(id,method){
    const inv=data.invoices.find(x=>x.id===id);
    if(!shareable(inv)){msg('Only estimates or fully signed, active invoices can be shared.');return;}
    rootEl.querySelectorAll('[data-document-outreach]').forEach(el=>el.remove());
    const statusForm=Array.from(rootEl.querySelectorAll('form[data-form="invoice-status"]')).find(x=>x.dataset.id===id);
    if(!statusForm)return;
    const contact=recipientContact(inv);
    const panel=document.createElement('section');
    panel.className='owner-section';
    panel.dataset.documentOutreach=id;
    panel.style.cssText='border:2px solid #779bc9;border-radius:12px;margin:14px 0';
    const channel=method==='copy'?'Copy Message':method==='sms'?'Text Customer':'Email via Gmail';
    const destinationLabel=method==='sms'?'CUSTOMER MOBILE NUMBER':'CUSTOMER EMAIL';
    const recipient=method==='sms'?(contact?.phone||''):(inv.customer_email||contact?.email||'');
    panel.innerHTML=[
      '<h3>'+safe(channel)+' · '+safe(inv.invoice_number)+'</h3>',
      method==='copy'?'':'<p class="owner-mini">Review the recipient and message before opening your '+(method==='sms'?'messaging app':'Gmail compose window')+'.</p>',
      inv.status==='Draft'?'<p class="owner-mini"><strong>Draft document:</strong> Confirm the document is accurate and ready for the customer before sending anything.</p>':'',
      '<div class="owner-input-grid">',
      method!=='copy'?'<div class="wide"><label class="form-label">'+destinationLabel+'</label><input class="field" data-outreach-to '+(method==='gmail'?'type="email"':'type="tel"')+' maxlength="250" value="'+safe(recipient)+'" placeholder="'+(method==='sms'?'Enter mobile number':'customer@example.com')+'"></div>':'',
      method==='gmail'?'<div class="wide"><label class="form-label">SUBJECT</label><input class="field" data-outreach-subject maxlength="200" value="'+safe('Persen Apparel '+(inv.document_type==='Estimate'?'Estimate':'Invoice')+' '+inv.invoice_number)+'"></div>':'',
      '<div class="wide"><label class="form-label">MESSAGE (EDIT BEFORE SENDING)</label><textarea class="textarea" data-outreach-body maxlength="5000" rows="7">'+safe(outreachMessage(inv,method))+'</textarea></div>',
      '<div class="wide" data-outreach-controls></div>',
      '</div>',
      '<p class="owner-mini">'+(method!=='sms'?'Use Print / PDF on the document or save the payment receipt as a PDF, then attach it manually before sending.':'Texts open in your device’s messaging application. If your browser does not support SMS links, copy the message and send it manually.')+'</p>'
    ].join('');
    statusForm.before(panel);
    const to=panel.querySelector('[data-outreach-to]'),body=panel.querySelector('[data-outreach-body]');
    const controls=panel.querySelector('[data-outreach-controls]');
    if(method!=='copy')controls.appendChild(button(method==='sms'?'Open Messages':'Open Gmail',()=>{
      const message=body.value.trim();
      if(!message){msg('Enter a message before continuing.');return;}
      if(method==='gmail'){
        const email=to.value.trim();
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){msg('Enter a valid customer email address.');return;}
        const subject=panel.querySelector('[data-outreach-subject]').value.trim();
        if(!subject){msg('Enter a subject before continuing.');return;}
        const url='https://mail.google.com/mail/?view=cm&fs=1&to='+encodeURIComponent(email)+'&su='+encodeURIComponent(subject)+'&body='+encodeURIComponent(message);
        const tab=window.open(url,'_blank');
        if(!tab){msg('Your browser blocked Gmail. Allow pop-ups or copy the message instead.');return;}
        try{tab.opener=null;}catch{}
        msg('Gmail compose opened. Attach the document PDF, review, then send it yourself.');
      }else{
        let number;
        try{number=cleanPhone(to.value)}catch(err){msg(err.message);return;}
        const separator=/iPad|iPhone|iPod/.test(navigator.userAgent)?'&':'?';
        window.location.href='sms:'+number+separator+'body='+encodeURIComponent(message);
      }
    },'primary'));
    controls.appendChild(button('Copy Message',async()=>{
      const message=body.value;
      try{
        if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');
        await navigator.clipboard.writeText(message);
        msg('Message copied. Paste it into your email or messaging app to send.');
      }catch{
        body.focus();body.select();
        msg('Select and copy the highlighted message, then paste it into your app.');
      }
    }));
    controls.appendChild(button('Cancel',()=>panel.remove()));
    if(method==='copy'){body.focus();body.select();}
    panel.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function decorate(){
    if(!owner)return;
    for(const statusForm of rootEl.querySelectorAll('form[data-form="invoice-status"]')){
      const id=statusForm.dataset.id,inv=data.invoices.find(x=>x.id===id);
      if(!inv)continue;
      if(!statusForm.querySelector('[data-document-action]')){
        if(eligible(inv)){
          const edit=button('Edit Document',()=>openEditor(id),'soft');
          edit.dataset.documentAction='edit';statusForm.appendChild(edit);
        }else if(inv.document_type==='Estimate'&&inv.status==='Sent'){
          const revise=button('Create Draft Revision',()=>reviseEstimate(id),'soft');
          revise.dataset.documentAction='revise';statusForm.appendChild(revise);
        }
      }
      if(shareable(inv)&&!statusForm.querySelector('[data-document-share]')){
        const sms=button('Text Customer',()=>openOutreach(id,'sms'));
        sms.dataset.documentShare='sms';statusForm.appendChild(sms);
        const gmail=button('Email via Gmail',()=>openOutreach(id,'gmail'));
        gmail.dataset.documentShare='gmail';statusForm.appendChild(gmail);
        const copy=button('Copy Message',()=>openOutreach(id,'copy'));
        copy.dataset.documentShare='copy';statusForm.appendChild(copy);
      }
    }
  }
  function openEditor(id){
    const inv=data.invoices.find(x=>x.id===id);
    if(!eligible(inv)){msg('This document is no longer an unsigned, unpaid draft.');return;}
    rootEl.querySelectorAll('[data-document-editor]').forEach(el=>el.remove());
    const statusForm=Array.from(rootEl.querySelectorAll('form[data-form="invoice-status"]')).find(x=>x.dataset.id===id);
    if(!statusForm)return;
    const wrapper=document.createElement('section');
    wrapper.dataset.documentEditor=id;
    wrapper.className='owner-section';
    wrapper.style.cssText='border:2px solid #779bc9;margin:14px 0;border-radius:12px';
    let contactList='<option value="">Enter manually</option>';
    for(const c of data.contacts){
      contactList+='<option value="'+safe(c.id)+'"'+(c.id===inv.contact_id?' selected':'')+'>'+safe(c.full_name)+'</option>';
    }
    wrapper.innerHTML=[
      '<h3>Edit Draft '+safe(inv.document_type||'Invoice')+' — '+safe(inv.invoice_number)+'</h3>',
      '<p class="owner-mini">Edits apply to this draft only. No emails are sent, and signed or paid documents cannot be edited here.</p>',
      '<form data-form="document-edit" class="owner-input-grid" data-id="'+safe(inv.id)+'">',
      '<div><label class="form-label">CUSTOMER RECORD</label><select class="select" name="contact_id" data-v4-contact-select>'+contactList+'</select></div>',
      field('CUSTOMER NAME *','customer_name','text',150),
      field('CUSTOMER EMAIL','customer_email','email',250),
      field('COMPANY / TEAM','customer_organization','text',160),
      field('DUE / VALID UNTIL','due_date','date'),
      '<div class="wide"><h4>Items and services</h4><div class="v56-lines"></div><button class="btn soft sm" type="button" data-editor-add>Add Another Item / Size</button></div>',
      moneyField('SHIPPING ($)','shipping'),moneyField('TAX AMOUNT ($)','tax_amount'),
      '<div><label class="form-label">DISCOUNT TYPE</label><select class="select" name="discount_type">'+options(['None','Percent','Fixed'],inv.discount_type||'None')+'</select></div>',
      moneyField('DISCOUNT AMOUNT (% OR $)','discount_value'),
      '<div class="wide v56-total-preview" role="status"></div>',
      '<div class="wide"><label class="form-label">PUBLIC NOTES</label><textarea class="textarea" name="public_notes" rows="2" maxlength="1500">'+safe(inv.public_notes||'')+'</textarea></div>',
      '<div class="wide"><button class="btn primary" type="submit">Save Draft Changes</button> <button class="btn ghost" type="button" data-editor-cancel>Cancel</button></div>',
      '</form>'
    ].join('');
    statusForm.before(wrapper);
    const form=wrapper.querySelector('form'),elements=form.elements;
    for(const key of ['customer_name','customer_email','customer_organization','due_date','shipping','tax_amount','discount_value']){
      elements[key].value=inv[key]??'';
    }
    const items=Array.isArray(inv.line_items)&&inv.line_items.length?inv.line_items:[{}];
    for(const item of items)addLine(form,item);
    updateInvoicePreview(form);
    wrapper.addEventListener('input',()=>updateInvoicePreview(form));
    wrapper.addEventListener('change',()=>updateInvoicePreview(form));
    wrapper.addEventListener('click',e=>{
      if(e.target.closest('[data-editor-add]')){
        e.preventDefault();e.stopPropagation();
        if(form.querySelectorAll('.v56-line-row').length>=50){msg('Maximum 50 items.');return;}
        addLine(form,{});updateInvoicePreview(form);
      }else if(e.target.closest('[data-click="invoice-remove-line"]')){
        e.preventDefault();e.stopPropagation();
        if(form.querySelectorAll('.v56-line-row').length<=1){msg('Keep at least one item.');return;}
        e.target.closest('.v56-line-row').remove();updateInvoicePreview(form);
      }else if(e.target.closest('[data-editor-cancel]')){
        e.preventDefault();e.stopPropagation();wrapper.remove();
      }
    });
    form.addEventListener('submit',async e=>{
      e.preventDefault();e.stopPropagation();
      const save=form.querySelector('[type="submit"]');
      save.disabled=true;
      try{const saved=await saveDraft(form,inv.id);if(saved===false)return;wrapper.remove();await refresh();msg('Draft updated. Review its PDF before sending.');}
      catch(err){msg('Could not save draft: '+err.message);}
      finally{save.disabled=false;}
    });
    wrapper.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function addLine(form,item){
    const lines=form.querySelector('.v56-lines');
    const shell=document.createElement('div');shell.innerHTML=invoiceLineRow();
    const row=shell.firstElementChild;lines.appendChild(row);
    const description=String(item.description||'');
    const name=item.name||description.slice(0,100);
    const detail=item.name?description:description.slice(100);
    const values={item_name:name,item_description:detail,item_size:item.size||'',
      item_design:item.design||'',item_qty:item.quantity??1,item_price:item.unit_price??0};
    for(const [key,value] of Object.entries(values)){
      const el=row.querySelector('[name="'+key+'"]');
      if(el)el.value=String(value);
    }
  }
  async function saveDraft(form,id){
    const fromList=data.invoices.find(x=>x.id===id);
    if(!eligible(fromList))throw Error('Only unsigned, unpaid, unconverted drafts may be edited.');
    const calc=invoiceTotalsFromForm(form),f=new FormData(form);
    const customer=String(f.get('customer_name')||'').trim();
    if(!customer||customer.length>150)throw Error('Enter a valid customer name.');
    const latest=await PA.checked(PA.db.from('business_invoices').select('id,status,document_type,updated_at').eq('id',id).single());
    if(!latest||latest.status!=='Draft'||latest.document_type!==fromList.document_type||latest.updated_at!==fromList.updated_at)
      throw Error('The document changed; refresh to review.');
    const [agreements,payments,converted]=await Promise.all([
      PA.checked(PA.db.from('invoice_agreements').select('id').eq('invoice_id',id).limit(1)),
      PA.checked(PA.db.from('invoice_payments').select('id').eq('invoice_id',id).limit(1)),
      latest.document_type==='Estimate'?PA.checked(PA.db.from('business_invoices').select('id').eq('source_estimate_id',id).limit(1)):Promise.resolve([])
    ]);
    if(agreements.length||payments.length||converted.length)throw Error('This document has an agreement, payment, or converted invoice.');
    if(!confirm('Save the changes to draft '+fromList.invoice_number+'? Nothing will be sent to the customer.'))return false;
    const changes={contact_id:f.get('contact_id')||null,customer_name:customer,
      customer_email:String(f.get('customer_email')||'').trim().slice(0,250),
      customer_organization:String(f.get('customer_organization')||'').trim().slice(0,160),
      due_date:f.get('due_date')||null,line_items:calc.items,
      subtotal:calc.subtotal,shipping:calc.shipping,tax_amount:calc.tax_amount,
      discount_type:calc.discount_type,discount_value:calc.discount_value,
      discount_amount:calc.discount_amount,total:calc.total,
      public_notes:String(f.get('public_notes')||'').slice(0,1500),updated_at:new Date().toISOString()};
    const update=PA.db.from('business_invoices').update(changes).eq('id',id)
      .eq('status','Draft').eq('document_type',latest.document_type);
    const unchanged=latest.updated_at==null?update.is('updated_at',null):update.eq('updated_at',latest.updated_at);
    const written=await PA.checked(unchanged.select('id'));
    if(!written.length)throw Error('Update denied or document status changed.');
  }
  async function reviseEstimate(id){
    const inv=data.invoices.find(x=>x.id===id);
    if(!inv||inv.document_type!=='Estimate'||inv.status!=='Sent')return;
    if(!confirm('Create an editable copy of sent estimate '+inv.invoice_number+'? The original will stay unchanged and no email will be sent.'))return;
    try{
      const original=await PA.checked(PA.db.from('business_invoices').select('*').eq('id',id).single());
      if(original.document_type!=='Estimate'||original.status!=='Sent')
        throw Error('Estimate changed; refresh first.');
      const copy={document_type:'Estimate',status:'Draft',contact_id:original.contact_id,
        invoice_number:invoiceNumber(),customer_name:original.customer_name,
        customer_email:original.customer_email,customer_organization:original.customer_organization,
        line_items:original.line_items,subtotal:original.subtotal,shipping:original.shipping,
        tax_amount:original.tax_amount,discount_type:original.discount_type||'None',
        discount_value:original.discount_value||0,discount_amount:original.discount_amount||0,
        total:original.total,due_date:original.due_date,
        public_notes:('Revision of estimate '+original.invoice_number+'.\n'+(original.public_notes||'')).slice(0,1500)};
      const created=await PA.checked(PA.db.from('business_invoices').insert(copy).select('id').single());
      await refresh();
      openEditor(created.id);
      msg('New revision draft created. The sent estimate was not modified.');
    }catch(err){msg('Could not create revision: '+err.message);}
  }
  const previousRender=render;
  render=function(){const result=previousRender.apply(this,arguments);decorate();return result;};
  decorate();
})();
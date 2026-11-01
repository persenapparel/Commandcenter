/* Persen Apparel: owner-only bulk public media uploader. Uses existing Supabase site-photos bucket. */
(()=>{
 const types={'image/jpeg':['jpg',5],'image/png':['png',5],'image/webp':['webp',5]};
 const bucket='site-photos';
 function setup(){
  const form=document.querySelector('form[data-form="upload-site-photo"]');
  if(!form||form.dataset.bulkMediaReady)return;
  form.dataset.bulkMediaReady='true';
  const input=form.querySelector('input[type="file"][name="photo"]');
  if(!input)return;
  input.multiple=true;
  input.accept=Object.keys(types).join(',');
  const heading=form.closest('section')?.querySelector('h2');
  if(heading)heading.textContent='Bulk Photo Library';
  const label=input.closest('div')?.querySelector('label');if(label)label.textContent='SELECT UP TO 20 PHOTOS';
  const btn=form.querySelector('button');if(btn)btn.textContent='Upload Selected Media';
  const status=document.getElementById('photo-upload-result');
  if(status){status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.textContent='Upload up to 20 JPG, PNG or WebP photos at a time (5 MB each). Uploaded photos are public.';}
  const listButton=document.createElement('button');listButton.type='button';listButton.className='btn ghost sm';listButton.textContent='Show All Photos';
  listButton.addEventListener('click',async()=>{
   const list=document.getElementById('site-photo-list');if(!list)return;
   list.textContent='Loading media…';
   if(!window.PA?.db){list.textContent='Storage is not connected.';return;}
   const r=await PA.db.storage.from(bucket).list('site',{limit:100,sortBy:{column:'created_at',order:'desc'}});
   if(r.error){list.textContent=r.error.message;return;}
   list.replaceChildren();
   for(const item of r.data||[]){
    const extension=item.name.split('.').pop().toLowerCase();
    if(!['jpg','jpeg','png','webp'].includes(extension))continue;
    const url=PA.db.storage.from(bucket).getPublicUrl('site/'+item.name).data.publicUrl;
    const article=document.createElement('article');
    const media=document.createElement('img');
    media.src=url;media.style.cssText='width:240px;max-width:100%;border-radius:12px';
    if(media.tagName==='VIDEO'){media.controls=true;media.preload='metadata';media.playsInline=true;}else{media.loading='lazy';media.alt='Uploaded website photo';}
    const p=document.createElement('p'),link=document.createElement('input');
    link.className='field';link.readOnly=true;link.value=url;link.setAttribute('aria-label','Media URL');p.append(link);
    article.append(media,p);list.append(article);
   }
   if(!list.children.length)list.textContent='No media uploaded yet.';
  });
  form.after(listButton);
 }
 const observer=new MutationObserver(setup);
 function start(){observer.observe(document.getElementById('owner-app')||document.body,{childList:true,subtree:true});setup();}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
 document.addEventListener('submit',async event=>{
  const form=event.target;
  if(!form.matches?.('form[data-form="upload-site-photo"]'))return;
  event.preventDefault();event.stopImmediatePropagation();
  const input=form.querySelector('input[name="photo"]'),files=Array.from(input?.files||[]);
  const status=document.getElementById('photo-upload-result'),button=form.querySelector('button');
  const show=x=>{if(status)status.textContent=x;};
  if(!files.length||files.length>20){show('Select between 1 and 20 files.');return;}
  if(!window.PA?.db){show('Supabase is not connected.');return;}
  for(const file of files){
   const rule=types[file.type];
   if(!rule||!file.size||file.size>rule[1]*1024*1024){show(file.name+' is not a supported file or is too large.');return;}
  }
  if(button)button.disabled=true;
  let good=0;const errors=[];
  try{
   for(let i=0;i<files.length;i++){
    const file=files[i],ext=types[file.type][0];
    show('Uploading '+(i+1)+' of '+files.length+': '+file.name);
    const path='site/'+crypto.randomUUID()+'.'+ext;
    try{
     const result=await PA.db.storage.from(bucket).upload(path,file,{contentType:file.type,upsert:false});
     if(result.error)throw result.error;
     const url=PA.db.storage.from(bucket).getPublicUrl(path).data.publicUrl;
     let gallery=[];
     const current=await PA.db.from('site_content').select('value').eq('key','v54_gallery').maybeSingle();
     if(current.error)throw current.error;
     try{gallery=JSON.parse(current.data?.value||'[]');if(!Array.isArray(gallery))gallery=[];}catch{gallery=[];}
     const base=file.name.replace(/\.[^.]+$/,'').replace(/[-_]+/g,' ').trim();
     gallery.push({id:crypto.randomUUID(),title:base.slice(0,120)||'Custom apparel project',caption:'',category:'Other',placement:'all',alt:base.slice(0,200)||'Persen Apparel custom work',sort:gallery.length,published:true,imageUrl:url});
     const saved=await PA.db.from('site_content').upsert({key:'v54_gallery',value:JSON.stringify(gallery),updated_at:new Date().toISOString()},{onConflict:'key'});
     if(saved.error)throw saved.error;
     good++;
    }
    catch(error){errors.push(file.name+': '+(error.message||String(error)));}
   }
   show(good+' of '+files.length+' uploaded.'+(errors.length?' Failed: '+errors.join('; '):'')+' Published photos appear in Our Work and homepage photo showcases. Refresh the customer website to see them.');
   if(good)input.value='';
  }finally{if(button)button.disabled=false;}
 },true);
})();

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM, VirtualConsole} from 'jsdom';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const owner='11111111-1111-4111-8111-111111111111';
const memoryID='22222222-2222-4222-8222-222222222222';
const base='https://exampleproject.supabase.co';
const spin=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate,label='expected DOM state') { for(let i=0;i<80;i++){if(predicate())return;await spin();}assert.ok(predicate(),label); }

async function app({view='overview',signedIn=false,failLogout=false,fixtureMemories=[]}={}) {
  let readGate=null;
  const errors=[],calls=[],downloads=[],tables={
    business_tasks:[{id:'task',title:'Verify school order',customer_name:'Test School',priority:'High',status:'Open',due_date:'2020-01-01'}],
    customer_orders:[{id:'weborder',title:'Website order',status:'In production',fulfillment:'Pickup'}],
    manual_business_orders:[{id:'manualorder',title:'School shirts',customer_name:'Test School',status:'In production',due_date:'2020-01-02'}],
    stock_items:[{id:'stock',sku:'NAVY-L',product_name:'Navy hoodie',color:'Navy',size:'L',quantity:2,reorder_at:5}],
    business_invoices:[{id:'invoice',invoice_number:'TEST-1',customer_name:'Test School',total:'100.00',status:'Sent',document_type:'Invoice',due_date:'2020-01-01'}],
    invoice_payments:[{id:'payment',invoice_id:'invoice',amount:'25.00',received_on:'2020-01-01'}],
    customer_contacts:[{id:'contact',full_name:'Test Customer',organization:'Test School',email:'test@example.invalid'}],
    invoice_agreements:[],inventory_event_profiles:[],donna_memories:structuredClone(fixtureMemories),donna_conversations:[]
  };
  const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
  const html=await readFile(path.join(project,'donna/index.html'),'utf8');
  const dom=new JSDOM(html,{url:`https://donna.example.invalid/donna/?view=${view}`,runScripts:'outside-only',virtualConsole:vc});
  const w=dom.window;
  w.PERSEN_CONFIG={supabaseUrl:base,supabasePublishableKey:'sb_publishable_test'};
  w.AbortSignal=globalThis.AbortSignal;
  w.scrollTo=()=>{};
  w.HTMLElement.prototype.scrollTo=()=>{};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.URL.createObjectURL=blob=>{downloads.push(blob);return 'blob:local-test';};
  w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=function(){downloads.push({name:this.download,href:this.href});};
  let spoken=[];
  w.speechSynthesis={getVoices:()=>[{name:'Local test voice',voiceURI:'test-voice',lang:'en-US'}],cancel(){},speak(u){spoken.push(u.text);},addEventListener(){}};
  w.SpeechSynthesisUtterance=class {constructor(text){this.text=text;}};
  w.fetch=async(url,options={})=>{
    const u=new URL(url),method=options.method||'GET';
    const body=options.body?JSON.parse(options.body):null;
    calls.push({url:u.href,path:u.pathname,search:u.search,method,body});
    if(u.pathname==='/auth/v1/logout'&&failLogout)throw Error('Simulated offline logout');
    if(u.pathname==='/auth/v1/token')return new Response(JSON.stringify({access_token:'fake-device-token',refresh_token:'fake-refresh-token',expires_at:Math.floor(Date.now()/1000)+3600}),{status:200,headers:{'Content-Type':'application/json'}});
    if(u.pathname==='/auth/v1/user')return new Response(JSON.stringify({id:owner,email:'owner@example.invalid'}),{status:200});
    if(u.pathname==='/auth/v1/logout')return new Response('{}',{status:200});
    const table=u.pathname.split('/').at(-1);
    if(table==='admin_users')return new Response(JSON.stringify([{user_id:owner}]),{status:200});
    if(!(table in tables))throw Error('Unexpected fixture request: '+url);
    if(method==='GET'&&readGate)await readGate.promise;
    if(method==='POST') {const row={...body,id:table==='donna_memories'?memoryID:'33333333-3333-4333-8333-333333333333',version:1,history:[],created_at:new Date().toISOString(),updated_at:new Date().toISOString()};tables[table].push(row);return new Response(JSON.stringify([row]),{status:201});}
    let selected=tables[table].filter(row=>!u.searchParams.get('id')||u.searchParams.get('id')===`eq.${row.id}`);
    if(method==='PATCH'){selected.forEach(row=>{const history=[...(row.history||[]),{version:row.version,content:row.content,status:row.status}];Object.assign(row,body,{version:(row.version||1)+1,history,updated_at:new Date().toISOString()});});return new Response(JSON.stringify(selected),{status:200});}
    if(method==='DELETE'){tables[table]=tables[table].filter(row=>!selected.includes(row));return new Response(JSON.stringify(selected),{status:200});}
    return new Response(JSON.stringify(selected),{status:200,headers:{'Content-Range':`0-${Math.max(0,selected.length-1)}/${selected.length}`}});
  };
  if(signedIn)w.sessionStorage.setItem(`donna.session.${base}`,JSON.stringify({access_token:'fake-device-token',expires_at:Math.floor(Date.now()/1000)+3600}));
  const context=dom.getInternalVMContext(), cache=new Map();
  async function moduleFor(filename){if(cache.has(filename))return cache.get(filename);const source=await readFile(filename,'utf8');const mod=new vm.SourceTextModule(source,{context,identifier:filename});cache.set(filename,mod);await mod.link((specifier,parent)=>moduleFor(path.resolve(path.dirname(parent.identifier),specifier)));return mod;}
  await(await moduleFor(path.join(project,'donna/app.js'))).evaluate();
  await spin();
  const q=s=>w.document.querySelector(s);
  const click=async s=>{assert.ok(q(s),'missing clickable '+s);q(s).dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true}));await spin();};
  const submit=async(s,values)=>{const form=q(s);assert.ok(form,'missing form '+s);for(const[k,v]of Object.entries(values))form.elements.namedItem(k).value=v;form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await spin();};
  const viewTo=async v=>{if(!q(`[data-view="${v}"]`)){w.history.pushState({},'',`?view=${v}`);w.dispatchEvent(new w.PopStateEvent('popstate'));await spin();}else await click(`[data-view="${v}"]`);};
  return {dom,w,q,click,submit,viewTo,calls,tables,errors,downloads,spoken,holdReads(){let release;const promise=new Promise(r=>release=r);readGate={promise};return ()=>{readGate=null;release();};},close:()=>dom.window.close()};
}

test('all views render with disconnected records and no fabricated business metrics',async()=>{
  const a=await app();try{
    assert.match(a.q('main').textContent,/Good to see you/);
    assert.equal(a.q('.stat strong').textContent,'—');
    assert.equal(a.calls.length,0);
    for(const v of ['voice','chat','teach','tasks','orders','contacts','invoices','inventory','events','memory','pricing','settings','shortcuts','briefing','overview']){await a.viewTo(v);assert.ok(a.q('main h1'),v);}
    assert.deepEqual(a.errors,[]);
  }finally{a.close();}
});

test('pricing form calculates actual explicit costs and rejects missing costs',async()=>{
  const a=await app({view:'pricing'});try{
    const costs={price:'40',quantity:'10',garment:'12',transfer:'3',labor:'5',packaging:'1',shipping:'2',fees:'0',overhead:'1',feePercent:'2.5'};
    await a.submit('#pricing-form',costs);
    assert.match(a.q('#pricing-result').textContent,/\$25\.00/);
    assert.match(a.q('#pricing-result').textContent,/\$150\.00/);
    assert.match(a.q('#pricing-result').textContent,/37\.5%/);
    await a.submit('#pricing-form',{...costs,labor:''});
    assert.match(a.q('#toast').textContent,/labor: enter/);
    assert.deepEqual(a.errors,[]);
  }finally{a.close();}
});

test('session teaching supports explicit approval, correction, version history, outdated and delete',async()=>{
  const a=await app({view:'teach'});try{
    await a.submit('#teach-form',{title:'Quote process',category:'Production procedures',source:'Owner instruction',content:'Collect product, color, sizes, quantity and artwork.'});
    assert.match(a.q('.memory-item').textContent,/pending/);
    await a.click('[data-memory="approve"]');assert.equal(a.q('#modal').open,true);
    await a.click('[data-memory-confirm="approve"]');assert.match(a.q('.memory-item').textContent,/confirmed/);
    await a.viewTo('chat');await a.submit('#chat-form',{message:'What is my quote process?'});
    assert.match(a.q('.messages').textContent,/Collect product, color, sizes, quantity and artwork/);
    await a.viewTo('memory');await a.click('[data-memory="edit"]');
    await a.submit('#edit-memory-form',{title:'Quote process revised',content:'Collect product, sizes, quantity, artwork, color and deadline.'});
    assert.match(a.q('.memory-item').textContent,/pending/);
    await a.click('[data-memory="history"]');assert.match(a.q('#modal-content').textContent,/Collect product, color/);
    await a.click('[data-action="close-modal"]');await a.click('[data-memory="outdated"]');await a.click('[data-memory-confirm="outdated"]');
    assert.match(a.q('.memory-item').textContent,/outdated/);
    await a.click('[data-memory="delete"]');await a.click('[data-memory-confirm="delete"]');
    assert.equal(a.q('.memory-item'),null);
    assert.deepEqual(a.errors,[]);
  }finally{a.close();}
});

test('personal tasks, all-day event export and keyboard microphone fallback work without service mutations',async()=>{
  const a=await app({view:'tasks'});try{
    await a.click('[data-action="add-task"]');await a.submit('#planner-form',{title:'Order supplies',date:'2027-01-02',priority:'High'});
    assert.match(a.q('main').textContent,/Order supplies/);
    const check=a.q('[data-task]');check.checked=true;check.dispatchEvent(new a.w.Event('change',{bubbles:true}));
    assert.match(a.q('.priority-row strong').getAttribute('style'),/line-through/);
    await a.click('[data-remove-task]');assert.equal(a.q('[data-task]'),null);
    await a.viewTo('events');await a.click('[data-action="add-event"]');await a.submit('#planner-form',{title:'Vendor; test, event',date:'2027-01-31',notes:'Set up early\nBring signs'});
    await a.click('[data-export-event]');assert.ok(a.downloads.length>=2);
    assert.ok(a.downloads.some(d=>d.name==='donna-event.ics'));
    await a.click('[data-remove-event]');assert.equal(a.q('[data-export-event]'),null);
    await a.viewTo('voice');await a.click('[data-action="mic"]');assert.match(a.q('#toast').textContent,/keyboard|dictate/i);
    assert.equal(a.calls.length,0);assert.deepEqual(a.errors,[]);
  }finally{a.close();}
});

test('authenticated memory envelopes render and writes use only Donna storage',async()=>{
  const now=new Date().toISOString();const m={id:memoryID,owner_id:owner,title:'Approved quote checklist',content:'Collect product and deadline.',category:'Production procedures',source:'Owner',status:'confirmed',version:1,history:[],created_at:now,updated_at:now};
  const a=await app({view:'memory',signedIn:true,fixtureMemories:[m]});try{
    assert.ok(a.q('.memory-item'),'authenticated memory envelope rows render');
    assert.match(a.q('.memory-item').textContent,/Approved quote checklist/);
    await a.viewTo('teach');await a.submit('#teach-form',{title:'New process',category:'Production procedures',source:'Owner',content:'Review artwork before approval.'});
    await until(()=>a.q('.memory-item')?.textContent.includes('New process')||a.q('#memory-list')?.textContent.includes('New process'),'new authenticated draft visible');
    assert.match(a.q('#memory-list').textContent,/New process/);
    const writes=a.calls.filter(c=>c.method!=='GET');assert.ok(writes.every(c=>c.path.endsWith('/donna_memories')));
    assert.deepEqual(a.errors,[]);
  }finally{a.close();}
});

test('owner chat reuses one conversation and never puts business replies into sandbox session storage',async()=>{
  const a=await app({view:'chat',signedIn:true});try{
    await a.submit('#chat-form',{message:'Check inventory'});
    await until(()=>a.q('.messages').textContent.includes('NAVY-L'),'authenticated inventory answer');
    await a.submit('#chat-form',{message:'What are my orders?'});
    await until(()=>a.q('.messages').textContent.includes('School shirts'),'authenticated order answer');
    const stored=a.w.sessionStorage.getItem('donna.sandbox')||'';
    assert.ok(!stored.includes('NAVY-L')&&!stored.includes('School shirts'),'business transcripts excluded from sandbox session storage');
    const conv=a.calls.filter(c=>c.path.endsWith('/donna_conversations')&&c.method!=='GET');
    assert.equal(conv.filter(c=>c.method==='POST').length,1,'one conversation is created');
    assert.equal(conv.filter(c=>c.method==='PATCH').length,1,'next message updates the same conversation');
    assert.deepEqual(a.errors,[]);
  }finally{a.close();}
});

test('offline logout still clears local owner data and tokens',async()=>{
  const a=await app({view:'settings',signedIn:true,failLogout:true});try{
    await a.click('[data-action="signout"]');
    await until(()=>a.q('[data-action="login"]'),'logged-out connection control');
    assert.equal(a.w.sessionStorage.getItem(`donna.session.${base}`),null);
    await a.viewTo('inventory');
    assert.ok(!a.q('main').textContent.includes('NAVY-L'),'records cleared after offline logout');
    assert.match(a.q('main').textContent,/not connected|Connect|connect/);
    assert.deepEqual(a.errors,[]);
  }finally{a.close();}
});

test('authenticated data deletion passes explicit confirmation and clears Donna-only records',async()=>{
  const a=await app({view:'settings',signedIn:true});try{
    await a.click('[data-action="delete-data"]');
    const confirm=a.q('[data-action="confirm-delete-data"]');
    assert.ok(confirm);
    const typed=a.q('#delete-phrase')||a.q('#delete-confirmation')||a.q('[name="confirmation"]')||a.q('input[placeholder="DELETE MY DONNA DATA"]');
    if(typed)typed.value='DELETE MY DONNA DATA';
    await a.click('[data-action="confirm-delete-data"]');
    await until(()=>a.calls.some(c=>c.method==='DELETE'),'storage delete requested');
    const writes=a.calls.filter(c=>c.method==='DELETE');assert.equal(writes.length,2);
    assert.ok(writes.every(c=>['/rest/v1/donna_conversations','/rest/v1/donna_memories'].includes(c.path)));
    assert.deepEqual(a.errors,[]);
  }finally{a.close();}
});


test('a business refresh finishing after logout cannot restore owner records',async()=>{
  const a=await app({view:'inventory',signedIn:true});try{
    const release=a.holdReads();
    await a.click('[data-action="refresh"]');
    await a.viewTo('settings');
    await a.click('[data-action="signout"]');
    release();
    for(let i=0;i<5;i++)await spin();
    await a.viewTo('inventory');
    assert.ok(!a.q('main').textContent.includes('NAVY-L'),'stale response must not repopulate signed-out records');
    assert.match(a.q('main').textContent,/not connected|Connect|connect/);
    assert.deepEqual(a.errors,[]);
  }finally{a.close();}
});

test('conversational teaching keeps the lesson pending until explicit review and approval',async()=>{
  const a=await app({view:'chat'});try{
    await a.submit('#chat-form',{message:'I want to teach you something'});
    assert.match(a.q('.messages').textContent,/Tell me the process or preference/);
    await a.submit('#chat-form',{message:'Collect garment color and print placement before preparing a quote.'});
    assert.match(a.q('.messages').textContent,/teaching draft/i);
    assert.ok(!a.q('.messages').textContent.includes('confirmed memory saved'));
    await a.click('[data-action="review-teaching"]');
    assert.equal(a.q('#lesson').value,'Collect garment color and print placement before preparing a quote.');
    await a.submit('#teach-form',{title:'Quote details',category:'Customer service',source:'Owner conversation'});
    assert.match(a.q('.memory-item').textContent,/pending/);
    await a.viewTo('chat');await a.submit('#chat-form',{message:'What is my quote process?'});
    const replies=[...a.w.document.querySelectorAll('.message.assistant')];
    assert.match(replies.at(-1).textContent,/don.t have approved notes/i);
    assert.deepEqual(a.errors,[]);
  }finally{a.close();}
});

test('owner-provided memory markup is shown as text and cannot inject elements',async()=>{
  const now=new Date().toISOString();
  const m={id:memoryID,owner_id:owner,title:'<img src=x onerror="window.injection=true">',content:'<script>window.injection=true</script>',category:'Owner preferences',source:'<b>Owner</b>',status:'confirmed',version:1,history:[],created_at:now,updated_at:now};
  const a=await app({view:'memory',signedIn:true,fixtureMemories:[m]});try{
    assert.match(a.q('.memory-item').textContent,/<script>window.injection=true<\/script>/);
    assert.equal(a.q('.memory-item script'),null);
    assert.equal(a.q('.memory-item img'),null);
    assert.equal(a.w.injection,undefined);
    assert.deepEqual(a.errors,[]);
  }finally{a.close();}
});

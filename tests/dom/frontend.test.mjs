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

async function app({view='overview',signedIn=false,failLogout=false,fixtureMemories=[],fixtureConversations=[],config={},denyStorage=false}={}) {
  let readGate=null;
  const errors=[],calls=[],downloads=[],tables={
    business_tasks:[{id:'task',title:'Verify school order',customer_name:'Test School',priority:'High',status:'Open',due_date:'2020-01-01'}],
    customer_orders:[{id:'weborder',title:'Website order',status:'In production',fulfillment:'Pickup'}],
    manual_business_orders:[{id:'manualorder',title:'School shirts',customer_name:'Test School',status:'In production',due_date:'2020-01-02'}],
    stock_items:[{id:'stock',sku:'NAVY-L',product_name:'Navy hoodie',color:'Navy',size:'L',quantity:2,reorder_at:5}],
    business_invoices:[{id:'invoice',invoice_number:'TEST-1',customer_name:'Test School',total:'100.00',status:'Sent',document_type:'Invoice',due_date:'2020-01-01'}],
    invoice_payments:[{id:'payment',invoice_id:'invoice',amount:'25.00',received_on:'2020-01-01'}],
    customer_contacts:[{id:'contact',full_name:'Test Customer',organization:'Test School',email:'test@example.invalid'}],
    invoice_agreements:[],inventory_event_profiles:[],donna_memories:structuredClone(fixtureMemories),donna_conversations:structuredClone(fixtureConversations)
  };
  const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
  const html=await readFile(path.join(project,'donna/index.html'),'utf8');
  const dom=new JSDOM(html,{url:`https://donna.example.invalid/donna/?view=${view}`,runScripts:'outside-only',virtualConsole:vc});
  const w=dom.window;
  w.PERSEN_CONFIG={supabaseUrl:base,supabasePublishableKey:'sb_publishable_test',...config};
  if(denyStorage)for(const name of ['sessionStorage','localStorage'])Object.defineProperty(w,name,{get(){throw new w.DOMException('Storage is disabled','SecurityError');}});
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


test('saved conversation library restores escaped text without replay and new conversation creates a separate transcript',async()=>{
  const id='44444444-4444-4444-8444-444444444444',now=new Date().toISOString();
  const old={id,owner_id:owner,title:'Review <img src=x onerror="window.injection=true">',created_at:now,updated_at:now,messages:[{role:'user',text:'Buy a hoodie and update stock',at:now},{role:'assistant',text:'<script>window.injection=true</script> No actions were taken.',at:now}]};
  const a=await app({view:'chat',signedIn:true,fixtureConversations:[old]});try{
    await a.click('[data-action="saved-conversations"]');
    await until(()=>a.q('[data-action="open-conversation"]'),'saved conversation title rendered');
    assert.ok(!a.q('#modal-content img'),'saved title markup escaped');
    assert.ok(!a.q('#modal-content').textContent.includes('Buy a hoodie'),'list contains metadata only');
    const listRead=a.calls.find(c=>c.path.endsWith('/donna_conversations'));
    assert.ok(!new URL(listRead.url).searchParams.get('select').includes('messages'));
    await a.click('[data-action="open-conversation"]');
    await until(()=>a.q('.messages').textContent.includes('Buy a hoodie'),'saved text restored');
    assert.equal(a.q('#modal').open,false);
    assert.equal(a.q('.messages script'),null);assert.equal(a.w.injection,undefined);
    assert.equal(a.calls.filter(c=>c.method!=='GET').length,0,'restoring a transcript cannot replay writes');
    assert.match(a.q('.messages').textContent,/<script>window.injection=true<\/script>/);
    await a.submit('#chat-form',{message:'Hello'});
    await until(()=>a.calls.some(c=>c.method==='PATCH'),'continued conversation updates original');
    assert.ok(a.calls.some(c=>c.method==='PATCH'&&new URL(c.url).searchParams.get('id')==='eq.'+id));
    await a.click('[data-action="new-conversation"]');
    assert.ok(!a.q('.messages').textContent.includes('Buy a hoodie'),'new conversation clears current transcript');
    await a.submit('#chat-form',{message:'Hi Donna'});
    await until(()=>a.calls.some(c=>c.method==='POST'),'fresh conversation saved separately');
    assert.equal(a.calls.filter(c=>c.method==='POST').length,1);
    assert.ok(!a.w.sessionStorage.getItem('donna.sandbox').includes('Buy a hoodie'));
    assert.deepEqual(a.errors,[]);
  }finally{a.close();}
});

test('cancelled or signed-out library reads cannot reopen or restore a private transcript',async()=>{
  const id='44444444-4444-4444-8444-444444444444',now=new Date().toISOString();
  const old={id,owner_id:owner,title:'Private archived subject',created_at:now,updated_at:now,messages:[{role:'user',text:'Private archived message',at:now}]};
  const a=await app({view:'chat',signedIn:true,fixtureConversations:[old]});try{
    let release=a.holdReads();await a.click('[data-action="saved-conversations"]');
    await a.click('[data-action="close-modal"]');release();for(let i=0;i<8;i++)await spin();
    assert.equal(a.q('#modal').open,false,'cancelled list read cannot reopen dialog');
    await a.click('[data-action="saved-conversations"]');await until(()=>a.q('[data-action="open-conversation"]'));
    release=a.holdReads();await a.click('[data-action="open-conversation"]');
    await a.click('[data-action="close-modal"]');await a.viewTo('settings');await a.click('[data-action="signout"]');
    release();for(let i=0;i<8;i++)await spin();
    await a.viewTo('chat');
    assert.ok(!a.q('body').textContent.includes('Private archived subject'));
    assert.ok(!a.q('body').textContent.includes('Private archived message'));
    assert.equal(a.q('#modal').open,false);assert.deepEqual(a.errors,[]);
  }finally{a.close();}
});

test('practice conversation history is labelled session-only and never queries a cloud archive',async()=>{
  const a=await app({view:'chat'});try{
    await a.submit('#chat-form',{message:'Hello Donna'});
    await a.click('[data-action="saved-conversations"]');
    assert.match(a.q('#modal-content').textContent,/no cloud conversation archive/i);
    assert.equal(a.calls.length,0);
    await a.click('[data-action="close-modal"]');await a.click('[data-action="new-conversation"]');
    assert.ok(!a.q('.message.user'));assert.deepEqual(a.errors,[]);
  }finally{a.close();}
});

test('standalone staging hides absent and unsafe Command Center URLs while allowing an explicit HTTPS link',async()=>{
  for(const commandCenterUrl of ['', 'javascript:alert(1)', 'https://owner:password@example.invalid/admin', 'http://external.example.invalid/admin']){
    const a=await app({view:'orders',config:{donnaStaging:true,commandCenterUrl}});try{
      assert.ok(![...a.w.document.querySelectorAll('a')].some(a=>a.textContent.includes('Open Command Center')));
      assert.deepEqual(a.errors,[]);
    }finally{a.close();}
  }
  const a=await app({view:'orders',config:{donnaStaging:true,commandCenterUrl:'https://admin.example.invalid/'}});try{
    assert.equal([...a.w.document.querySelectorAll('a')].find(a=>a.textContent.includes('Open Command Center')).href,'https://admin.example.invalid/');
  }finally{a.close();}
});

test('blocked browser storage still permits disconnected pricing and does not request credentials',async()=>{
  const a=await app({view:'pricing',denyStorage:true,config:{donnaStaging:true,supabaseUrl:'',supabasePublishableKey:''}});try{
    await a.submit('#pricing-form',{price:'10',quantity:'1',garment:'1',transfer:'0',labor:'0',packaging:'0',shipping:'0',fees:'0',overhead:'0',feePercent:'0'});
    assert.match(a.q('#pricing-result').textContent,/\$9\.00/);
    await a.click('[data-action="login"]');assert.match(a.q('#modal-content').textContent,/disconnected/);
    assert.equal(a.q('#login-form'),null);assert.equal(a.calls.length,0);assert.deepEqual(a.errors,[]);
  }finally{a.close();}
});


test('private-chat setup is readable in app and copies the researched prompt with manual fallback without network calls',async()=>{
  const guide=await readFile(path.join(project,'docs/donna/ON-DEVICE-SHORTCUT.md'),'utf8');
  const expected=guide.split('```text\n')[1].split('\n```')[0];
  const a=await app({view:'shortcuts'});try{
    await a.click('[data-view="private-chat"]');
    assert.match(a.q('main h1').textContent,/Set up Donna Private Chat/);
    assert.match(a.q('.notice.warning').textContent,/not been created, installed, or tested/);
    assert.match(a.q('main').textContent,/explicitly choose On-Device/);
    assert.match(a.q('main').textContent,/Ask for Input/);
    assert.match(a.q('main').textContent,/Speak Text/);
    assert.equal(a.q('#private-chat-prompt').value,expected);
    assert.equal(a.q('#private-chat-prompt').readOnly,true);
    assert.ok(a.q('a[href="https://support.apple.com/guide/shortcuts/use-apple-intelligence-in-shortcuts-tpg3vrvwmclv/ios"]'));
    const copied=[];
    Object.defineProperty(a.w.navigator,'clipboard',{configurable:true,value:{writeText:async text=>copied.push(text)}});
    await a.click('[data-action="copy-private-chat-prompt"]');
    assert.deepEqual(copied,[expected]);assert.match(a.q('#toast').textContent,/prompt copied/);
    Object.defineProperty(a.w.navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('Clipboard denied');}}});
    await a.click('[data-action="copy-private-chat-prompt"]');
    assert.equal(a.w.document.activeElement.id,'private-chat-prompt');
    assert.equal(a.q('#private-chat-prompt').selectionStart,0);
    assert.equal(a.q('#private-chat-prompt').selectionEnd,expected.length);
    assert.match(a.q('#toast').textContent,/Prompt selected/);
    await a.viewTo('settings');assert.ok(a.q('[data-view="private-chat"]'));
    await a.click('[data-view="private-chat"]');assert.equal(new URL(a.w.location.href).searchParams.get('view'),'private-chat');
    assert.equal(a.calls.length,0,'setup and clipboard actions never invoke model/provider/backend requests');
    assert.deepEqual(a.errors,[]);
  }finally{a.close();}
});


test('voice mute is accessible, persists, and suppresses automatic playback without blocking manual replay',async()=>{
  const a=await app({view:'voice'});try{
    assert.equal(a.q('[data-action="toggle-voice-mute"]').getAttribute('aria-pressed'),'false');
    await a.click('[data-action="toggle-voice-mute"]');
    assert.equal(a.q('[data-action="toggle-voice-mute"]').getAttribute('aria-pressed'),'true');
    assert.match(a.q('#voice-status').textContent,/muted/i);
    assert.equal(JSON.parse(a.w.localStorage.getItem('donna.settings')).voiceMuted,true);
    await a.submit('#chat-form',{message:'Hello Donna'});
    await until(()=>a.q('.message.assistant'),'Donna response');
    assert.equal(a.spoken.length,0,'muted automatic voice never plays');
    await a.click('[data-action="speak-last"]');
    assert.equal(a.spoken.length,1,'manual Play reply remains available');
    await a.click('[data-action="toggle-voice-mute"]');
    assert.equal(a.q('[data-action="toggle-voice-mute"]').getAttribute('aria-pressed'),'false');
    await a.submit('#chat-form',{message:'What are my priorities?'});
    await until(()=>a.spoken.length===2,'automatic voice resumed');
    assert.deepEqual(a.errors,[]);
  }finally{a.close();}
});

test('compose microphone has an accessible start label and links to voice status only in voice view',async()=>{
  for(const view of ['voice','chat']){
    const a=await app({view});try{
      const composeMic=a.q('#chat-form [data-action="mic"]');
      assert.ok(composeMic);
      assert.equal(composeMic.getAttribute('aria-label'),'Start voice input');
      assert.equal(composeMic.getAttribute('aria-controls'),view==='voice'?'voice-status':null);
      assert.deepEqual(a.errors,[]);
    }finally{a.close();}
  }
});

test('voice recognition updates microphone accessible state at start and end',async()=>{
  const source=await readFile(path.join(project,'donna/app.js'),'utf8');
  assert.match(source,/recognition\.onend=\(\)=>\{[\s\S]*?setAttribute\('aria-pressed','false'\)/);
  assert.match(source,/recognition\.onend=\(\)=>\{[\s\S]*?setAttribute\('aria-label','Start voice input'\)/);
  assert.match(source,/recognition\.start\(\);state\.listening=true;[\s\S]*?setAttribute\('aria-pressed','true'\)/);
  assert.match(source,/recognition\.start\(\);state\.listening=true;[\s\S]*?setAttribute\('aria-label','Finish voice input'\)/);
});

test('voice recognition ignores empty or malformed Safari transcripts without sending',async()=>{
  const source=await readFile(path.join(project,'donna/app.js'),'utf8');
  assert.match(source,/String\(e\.results\?\.\[0\]\?\.\[0\]\?\.transcript\|\|''\)\.trim\(\)/);
  assert.match(source,/if\(!text\)\{const label=\$\('#voice-status'\);if\(label\)label\.textContent='No words recognized\./);
  assert.match(source,/if\(!text\)[\s\S]*?return;\}const input=\$\('#chat-form textarea'\)/);
});

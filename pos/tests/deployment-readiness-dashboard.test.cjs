'use strict';
/* Read-only staging dashboard status tests. Does not contact Cloudflare or
   Supabase, and must never claim a successful live checkout. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'deployment-readiness.js'),'utf8');
const markup=fs.readFileSync(path.join(root,'index.html'),'utf8');
const build=fs.readFileSync(path.join(root,'build-pages.mjs'),'utf8');
const {verify,mount}=require('../deployment-readiness.js');
const guest='https://staging123.commandcenter-4yg.pages.dev/pos-guest/';
const client={guestEntryUrl:guest};
const valid={environment:'staging',commit:'a'.repeat(40),guestEntryUrl:guest,guestOrigin:new URL(guest).origin};
let result=verify(valid,client);
assert.equal(result.configured,true);
assert.equal(result.revision,'aaaaaaaaaaaa');
assert.match(result.detail,/does NOT confirm/);
assert.equal(verify({...valid,environment:'production'},client).configured,false);
assert.equal(verify({...valid,guestEntryUrl:'https://example.com/pos-guest/'},client).configured,false);
assert.equal(verify({...valid,guestOrigin:'https://wrong.pages.dev'},client).configured,false);
assert.equal(verify({...valid,guestEntryUrl:guest+'?token=test'},{guestEntryUrl:guest+'?token=test'}).configured,false);
assert.equal(verify({...valid,guestEntryUrl:'http://staging123.commandcenter-4yg.pages.dev/pos-guest/'},{guestEntryUrl:'http://staging123.commandcenter-4yg.pages.dev/pos-guest/'}).configured,false);
assert.equal(verify(null,client).configured,false);
assert.match(markup,/id="staging-deployment" class="staging-readiness"/);
assert.match(markup,/src="handoff-config\.js"/);
assert.match(markup,/src="deployment-readiness\.js"/);
assert.match(build,/'deployment-readiness\.js'/);
assert.doesNotMatch(source,/localStorage|sessionStorage|service_role|supabase\.auth|Authorization:/i);
assert.match(source,/u\.username\|\|u\.password/,'embedded URL credentials must be rejected');
async function fakeUI(){
 globalThis.PersenPOSHandoffConfig=client;
 const fields=new Map(['staging-readiness-status','staging-readiness-commit','staging-readiness-guest'].map(id=>[id,{textContent:''}]));
 const document={getElementById:id=>fields.get(id)||null};
 await mount(document,async()=>({ok:true,json:async()=>valid}));
 assert.match(fields.get('staging-readiness-status').textContent,/Configured pairing matches/);
 assert.equal(fields.get('staging-readiness-commit').textContent,'Cashier commit: aaaaaaaaaaaa');
 assert.equal(fields.get('staging-readiness-guest').textContent,'Configured customer host: staging123.commandcenter-4yg.pages.dev');
 await mount(document,async()=>{throw Error('offline')});
 assert.match(fields.get('staging-readiness-status').textContent,/unavailable/);
 assert.match(fields.get('staging-readiness-guest').textContent,/unverified/);
}
fakeUI().then(()=>console.log('PASS read-only cashier/guest staging dashboard config checks.')).catch(error=>{console.error(error);process.exitCode=1});

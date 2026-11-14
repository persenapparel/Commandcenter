'use strict';
// Static staging regression: customer checkout must not expose a dual-device mode.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const swivel=fs.readFileSync('pos/swivel-mode.js','utf8');
assert.doesNotMatch(swivel,/localStorage\.getItem\(key\)|mode\s*===?\s*['"]dual['"]|mode\s*!==?\s*['"]swivel['"]|showPairingUrl\(/);
assert.match(swivel,/document\.querySelector\('\.pos-device-mode'\)\?\.remove\(\)/);
assert.match(swivel,/el\.hidden=true/);
assert.match(swivel,/db\.auth\.signInWithPassword/);
assert.match(swivel,/PA\.isAdmin\(user\)/);
assert.match(swivel,/pos_issue_display_pairing/,'Existing server token still required internally until secure single-screen protocol is reviewed');
// Fail-closed guard: neither initial handoff nor resume may reach open().
assert.match(swivel,/if\(swivelStarting\|\|busy\|\|checkout\|\|pendingCash\)return;[\s\S]*?notice\('Customer handoff is temporarily unavailable:[\s\S]*?return;[\s\S]*?swivelStarting=true;/);
assert.match(swivel,/if\(!checkout\|\|checkout.status!=='awaiting_customer'\)return;[\s\S]*?notice\('Customer handoff is disabled[\s\S]*?return;[\s\S]*?const button=\$\('swivel-resume'\)/);
// Defense in depth while customer handoff is deliberately fail-closed.
const registerHtml=fs.readFileSync('pos/register.html','utf8');
const customerFrame=(registerHtml.match(/<iframe\b[^>]*\bid="swivel-customer-frame"[^>]*>/)||[])[0]||'';
assert.ok(customerFrame,'Swivel customer frame must exist');
assert.match(customerFrame,/\bsandbox="allow-scripts allow-forms"/,'Customer iframe must be sandboxed without cashier origin privileges');
assert.doesNotMatch(customerFrame,/\ballow-same-origin\b|\ballow-top-navigation\b/,'Customer frame must not access parent origin or navigate the top window');
// Verify the future customer transport never inherits the cashier login.
const vm=require('node:vm');
const customerHtml=fs.readFileSync('pos/display.html','utf8');
assert.match(customerHtml,/src="customer-guest-client\.js"/);
assert.doesNotMatch(customerHtml,/src="\.\.\/backend\.js"|src="backend\.js"/);
assert.match(fs.readFileSync('pos/build-pages.mjs','utf8'),/'customer-guest-client\.js'/);
const guestScript=fs.readFileSync('pos/customer-guest-client.js','utf8');
const calls=[];
const guestDb={guestOnly:true};
const fakeWindow={
 PERSEN_CONFIG:{supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'sb_publishable_TEST'},
 supabase:{createClient:(url,key,options)=>{calls.push({url,key,options});return guestDb;}}
};
vm.runInNewContext(guestScript,{window:fakeWindow});
assert.equal(fakeWindow.PA.ready,true);
assert.equal(fakeWindow.PA.db,guestDb);
assert.equal(calls.length,1);
assert.equal(calls[0].options.auth.persistSession,false);
assert.equal(calls[0].options.auth.autoRefreshToken,false);
assert.equal(calls[0].options.auth.detectSessionInUrl,false);
assert.match(swivel,/db\.auth\.signOut\(\{scope:'local'\}\)/);
assert.match(swivel,/db\.auth\.getSession\(\)/);
assert.match(swivel,/if\(remaining\.error\|\|remaining\.data\?\.session\)throw Error/);
// Browser checkout remains fail-closed until backend pairing tokens, throttling,
// anonymous permissions and end-to-end isolation have been reviewed.
const dashboard=fs.readFileSync('pos/index.html','utf8');
assert.doesNotMatch(dashboard,/Optional Second iPad|Open Customer Display|Two-iPad mode remains optional|The separate customer display is still available/);
assert.match(dashboard,/href="register.html"/);
assert.match(dashboard,/href="admin.html#print-center"/);
console.log('PASS: swivel-only UI static checks (not an authentication or device security test)');

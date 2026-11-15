/* Offline single-swivel POS button wiring audit; no payment calls. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const read=f=>fs.readFileSync('pos/'+f,'utf8');
const suites=[
 ['register.html','register.js',['open-register','close-register','refresh-products','start','cancel','cash','finish-order','cash-exact','cash-clear','save-drawer','copy-venmo','scan-search','barcode-csv','save-template','print','close-variant']],
 ['admin.html','admin.js',['save-products','refresh']],
 ['display.html','display.js',['wizard-back','wizard-next','wizard-help','wizard-finish','wizard-skip-optional']],
 ['admin.html','epson-center.js',['epson-refresh']],
 ['register.html','swivel-mode.js',['swivel-resume']]
];
let checked=0;
for(const [page,script,buttons] of suites){
 const html=read(page),js=read(script),ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(ids.length,new Set(ids).size,page+' contains duplicate HTML IDs');
 for(const id of buttons){
  assert.ok(ids.includes(id),page+' is missing button '+id);
  assert.ok(js.includes("'"+id+"'"),script+' lacks binding for button '+id);
  checked++;
 }
}
const expectations=[
 ['admin.js',["$('create-products').onsubmit","$('event-form').onsubmit","$('login').onsubmit","$('refresh').onclick"]],
 ['register.js',["by('new-event').addEventListener","by('new-product').addEventListener","by('edit-event').addEventListener","by('custom').onsubmit","by('login').onsubmit","[data-discount]","button.onclick="]],
 ['display.js',["[data-digit]","receipt_mode","wizard-next","wizard-finish","wizard-help"]],
 ['epson-center.js',["'epson-refresh'","pos_print_jobs","pos_drawer_open_jobs","Promise.allSettled"]]
];
for(const [file,tokens] of expectations){const code=read(file);for(const token of tokens)assert.ok(code.includes(token),file+' is missing action '+token)}
assert.ok(read('register.html').includes('id="scan-form"')&&read('register.js').includes("by('scan-form').addEventListener"),'Barcode submit requires actual input handler');
const registerHtml=read('register.html'),registerJs=read('register.js');
const swivel=read('swivel-mode.js');
// Secure staging has intentionally disabled customer handoff. Audit the
// fail-closed contract instead of requiring obsolete same-origin unlock flows.
assert.ok(swivel.includes("start.onclick=deny"),'Handoff must be explicitly denied until guest isolation is verified');
assert.ok(swivel.includes("overlay.hidden=true"),'Customer overlay must remain hidden in blocked mode');
assert.ok(swivel.includes("frame.removeAttribute('src')"),'Blocked handoff must remove any guest iframe source');
assert.ok(swivel.includes("active:()=>false"),'Blocked swivel must never claim an active customer session');
for(const obsolete of ['swivel-lock','swivel-unlock-submit','swivel-keep-customer']){
 assert.ok(!swivel.includes("'"+obsolete+"'"),'Do not restore obsolete in-page unlock handler: '+obsolete);
}
for(const id of ['pair-setup','pair-quick','pair-copy','pair-share','pair-link-panel','pair']){
 assert.ok(!registerHtml.includes('id="'+id+'"'),'Obsolete two-iPad UI must stay removed: '+id);
}
assert.ok(!registerJs.includes("by('pair')"),'Legacy pairing event handler must stay removed');
const build=read('build-pages.mjs');
assert.ok(!build.includes("'test-fake-supabase.js'")&&!build.includes("'browser-full-flow-test.cjs'"),'Mock test files must not deploy');
const epsonCenter=read('epson-center.js');
assert.ok(!/\.rpc\(|\.insert\(|\.update\(|\.delete\(/.test(epsonCenter),'Epson browser center must be read-only');
assert.ok(!build.includes("'print-station.js'")&&!build.includes("'print-station.css'"),'Legacy NELKO printing worker must not ship');
assert.ok(read('print-station.html').includes('old NELKO browser print worker is disabled'),'Legacy route must be inert');
require('./swivel-pairing-regression-test.cjs');
console.log('PASS: '+checked+' named controls, four unique-ID checks, additional forms and generated controls');

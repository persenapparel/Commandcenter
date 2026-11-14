'use strict';
/* Independent source-level fail-closed contract tests. They are NOT browser,
 * PostgreSQL, or physical device tests and cannot authorize guest handoff.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname;
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('customer swivel handoff stays denied with no iframe source',()=>{
 const src=read('swivel-mode.js');
 assert.match(src,/start\.onclick\s*=\s*deny\s*;/);
 assert.match(src,/frame\.removeAttribute\(['"]src['"]\)/);
 assert.match(src,/overlay\.hidden\s*=\s*true/);
 assert.match(src,/secure customer isolation is required/);
 assert.doesNotMatch(src,/start\.onclick\s*=\s*(?:allow|handoff|openCustomer)/);
});

test('staging build copies employee modules and scanner diagnostics',()=>{
 const src=read('build-pages.mjs');
 for(const name of ['employee-home-menu.js','employee-policy.js','scanner-diagnostic.html'])
  assert.ok(src.includes("'"+name+"'"),name+' missing from build manifest');
 assert.match(src,/Refusing to build POS against production Supabase/);
 assert.match(src,/naaqcspvbntzdtwuchrr\.supabase\.co/);
});

test('badge authentication remains disabled pending server verifier',()=>{
 const src=read('employee-home-menu.js');
 assert.match(src,/id="employee-badge-scan"[^>]*disabled/);
 assert.match(src,/Badge login is not yet enabled/);
 assert.match(src,/id="employee-refunds"[^>]*disabled/);
 assert.match(src,/id="employee-returns"[^>]*disabled/);
});

test('register loads role policy and home menu after register code',()=>{
 const src=read('register.html');
 const register=src.indexOf('src="register.js"');
 const policy=src.indexOf('src="employee-policy.js"');
 const home=src.indexOf('src="employee-home-menu.js"');
 assert.ok(register>=0&&policy>register&&home>policy);
});

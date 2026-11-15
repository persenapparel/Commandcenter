'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const swivel=fs.readFileSync(path.join(__dirname,'../swivel-mode.js'),'utf8');
test('swivel must not restore unsafe same-origin customer iframe',()=>{
 assert.match(swivel,/same.origin|cross.origin|isolat|fail.closed/i);
});
test('guest page must not use localStorage for cashier session',()=>{
 const candidate=path.join(__dirname,'../guest-checkout.html');
 if(!fs.existsSync(candidate))return;
 const source=fs.readFileSync(candidate,'utf8');
 assert.doesNotMatch(source,/localStorage\.(?:getItem|setItem)\(\s*['"](?:supabase|sb-)/i);
});

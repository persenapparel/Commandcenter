'use strict';
// Staging regression guard: unsupported person-to-person Apple Cash must never
// be presented as a business checkout option or ship a copied phone contact.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
test('cashier checkout does not offer Apple Cash P2P or hardcoded payment contact',()=>{
 const html=fs.readFileSync(path.join(root,'register.html'),'utf8');
 const js=fs.readFileSync(path.join(root,'register.js'),'utf8');
 assert.doesNotMatch(html,/id=["']copy-apple-cash["']/i);
 assert.doesNotMatch(js,/copy-apple-cash/i);
 assert.doesNotMatch(html,/Apple Cash via Messages/i);
 assert.doesNotMatch(html,/\(631\) 644-0633/);
 assert.doesNotMatch(js,/6316440633/);
 assert.match(html,/Venmo checkout instructions/);
});

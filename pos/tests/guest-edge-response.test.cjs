'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('guest bridge keeps CORS preflight empty and normalizes rejected capabilities',()=>{
 const source=fs.readFileSync('supabase/functions/pos-guest-checkout/index.ts','utf8');
 assert.match(source,/new Response\(status===204\|\|status===205\|\|status===304\?null:body/,
  '204 preflights must have a null body under Deno Fetch');
 assert.match(source,/return text\(204,'','text\/plain; charset=utf-8',false,origin\)/,
  'approved customer origin must receive an OPTIONS response');
 assert.match(source,/if\(!response\.ok\)return null;/,
  'expired, replayed, or wrong capabilities must not be elevated to an Edge error');
 assert.match(source,/snapshot\?json\(200,snapshot,origin\):json\(403,\{error:'Checkout unavailable'\},origin\)/,
  'guest views must fail closed with one generic authorization denial');
});

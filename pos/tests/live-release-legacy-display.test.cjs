'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const script=fs.readFileSync('pos/build-pages.mjs','utf8');
test('release build retires legacy display route without redirecting tokens',()=>{
 assert.match(script,/if\(f==='display\.html'\)/);
 assert.match(script,/Customer checkout has moved/);
 assert.match(script,/return the iPad to your cashier/i);
 assert.doesNotMatch(script,/window\.location.*display/i);
 assert.match(script,/s=\s*'<!doctype html>/);
});
test('release output does not publish legacy anonymous display JS',()=>{
 const bundledAssets=script.match(/for\(const f of \[([\s\S]*?)\]\)\{\s*await copyFile\(join\('pos',f\)/);
 assert.ok(bundledAssets,'Find asset list');
 assert.doesNotMatch(bundledAssets[1],/['"]display\.js['"]/);
 assert.match(bundledAssets[1],/['"]swivel-mode\.js['"]/);
 assert.match(bundledAssets[1],/['"]customer-guest-client\.js['"]/);
});

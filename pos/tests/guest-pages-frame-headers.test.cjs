'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('existing guest runtime can be framed only on preview hosts by staging cashiers',()=>{
 const source=fs.readFileSync('_headers','utf8');
 const blocks=source.replace(/^#.*$/gm,'').trim().split(/\n\s*\n/);
 assert.match(blocks[0],/^\/\*\n/);
 assert.match(blocks[0],/X-Frame-Options: DENY/);
 const scoped=blocks.filter(block=>block.includes('! X-Frame-Options'));
 assert.equal(scoped.length,1,'only one narrow framing exception');
 assert.match(scoped[0],/^https:\/\/:preview\.commandcenter-4yg\.pages\.dev\/pos-guest\/\*\n/);
 const csp=scoped[0].split('\n').find(line=>line.includes('Content-Security-Policy:'));
 assert.ok(csp);
 assert.match(csp,/default-src 'none'; script-src 'self'; style-src 'self';/);
 assert.match(csp,/img-src 'self';/,'guest decorative SVG must load only from its own origin');
 assert.match(csp,/connect-src https:\/\/naaqcspvbntzdtwuchrr\.supabase\.co;/);
 assert.match(csp,/frame-ancestors https:\/\/pos\.persenapparel\.com https:\/\/persen-pos-staging\.pages\.dev https:\/\/\*\.persen-pos-staging\.pages\.dev;/);
 assert.match(csp,/base-uri 'none'; form-action 'none'; object-src 'none'/);
 assert.match(scoped[0],/Cache-Control: no-store, no-cache, must-revalidate/);
 assert.doesNotMatch(scoped[0],/unsafe-inline|unsafe-eval|icxeuhkqxxhdkfdappio/);
});

test('isolated guest directory CSP permits only approved cashier hosts and keeps staging-only API',()=>{
 const source=fs.readFileSync('pos-guest/_headers','utf8');
 assert.match(source,/^\/pos-guest\/\*/);
 assert.match(source,/frame-ancestors https:\/\/pos\.persenapparel\.com https:\/\/persen-pos-staging\.pages\.dev https:\/\/\*\.persen-pos-staging\.pages\.dev;/);
 assert.match(source,/connect-src https:\/\/naaqcspvbntzdtwuchrr\.supabase\.co;/);
 assert.match(source,/default-src 'none'; script-src 'self'; style-src 'self'/);
 assert.match(source,/img-src 'self';/);
 assert.doesNotMatch(source,/unsafe-inline|unsafe-eval|icxeuhkqxxhdkfdappio|localhost/);
});

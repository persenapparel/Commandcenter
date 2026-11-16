// Builds ONLY a credential-free customer-origin preview. Never copies to POS Pages.
// Must be hosted on a distinct HTTPS origin with the generated CSP _headers.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
const dry=process.env.CI==='true' && !process.env.CF_PAGES &&
 !process.env.POS_GUEST_ORIGIN && !process.env.POS_GUEST_API_ORIGIN;
const guest=dry?'https://guest-ci.example.test':process.env.POS_GUEST_ORIGIN;
const cashier=dry?'https://cashier-ci.example.test':process.env.POS_CASHIER_ORIGIN;
const api=dry?'https://api-ci.example.test':process.env.POS_GUEST_API_ORIGIN;
function origin(value) {
 if(!value) throw Error('Isolated customer build requires 3 explicit origins');
 const u=new URL(value);
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')
  throw Error('Only clean HTTPS origins are permitted');
 return u.origin;
}
const g=origin(guest),c=origin(cashier),a=origin(api);
if(new Set([g,c,a]).size!==3)throw Error('Guest, cashier and API origins must be distinct');
if(!dry && g.endsWith('.example.test'))throw Error('Refusing a placeholder deployment');
const out='pos-guest-dist';
await mkdir(out,{recursive:true});
const [transport,screen,entry]=await Promise.all([
 'guest-checkout-transport.cjs','customer-checkout-screen.cjs',
 'customer-checkout-entry.cjs'
].map(x=>readFile(join('pos',x),'utf8')));
const moduleWrap=(src,bindings='')=>
 '(()=>{const module={exports:{}};'+bindings+'\n'+src+'\nreturn module.exports})()';
const js=`'use strict';\nconst transport=${moduleWrap(transport)};\nconst screen=${moduleWrap(screen)};\nconst entry=${moduleWrap(entry,`const require=p=>p==='./guest-checkout-transport.cjs'?transport:p==='./customer-checkout-screen.cjs'?screen:(()=>{throw Error('Blocked guest dependency')})();`)};\nconst config=${JSON.stringify({cashierOrigin:c,apiOrigin:a})};\ntry {entry.mountCustomerCheckout({window,root:document.getElementById('checkout'),cashierOrigin:config.cashierOrigin,apiOrigin:config.apiOrigin,fetchImpl:window.fetch.bind(window)});} catch (_) {document.getElementById('checkout').textContent='Checkout unavailable. Please return the iPad to your cashier.';}\n`;
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Persen Apparel · Customer Checkout</title><link rel="stylesheet" href="/guest.css"><script defer src="/guest.js"></script></head><body><header><strong>PERSEN APPAREL</strong><span>Customer checkout</span></header><div id="checkout" role="main">Preparing your checkout…</div></body></html>`;
const css='body{margin:0;background:#f6f8fb;color:#153252;font:17px system-ui,sans-serif}header{display:flex;justify-content:space-between;gap:1rem;padding:1rem;background:#0c2547;color:white}main{max-width:650px;margin:1rem auto;background:white;padding:1.5rem;border-radius:15px;box-shadow:0 6px 24px #142f4b12}label{display:block;margin:1rem 0}input{display:block;margin:.5rem 0;width:100%;box-sizing:border-box;padding:.8rem;font:inherit}input[type=checkbox]{width:auto;display:inline}button{padding:1rem;background:#0c2547;color:white;border:0;border-radius:8px;font:inherit}button:disabled{opacity:.5}li{margin:.5rem 0}.checkout-error{color:#a11}\n';
const headers=`/*\n  Cache-Control: no-store\n  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; connect-src ${a}; frame-ancestors ${c}; base-uri 'none'; form-action 'none'; object-src 'none'\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n`;
await Promise.all([
 writeFile(join(out,'guest.js'),js),
 writeFile(join(out,'index.html'),html),
 writeFile(join(out,'guest.css'),css),
 writeFile(join(out,'_headers'),headers)
]);
if(dry)console.warn('CI-only guest build: example.test origins, not deployable');
console.log('Credential-free isolated guest Pages build created: '+out);

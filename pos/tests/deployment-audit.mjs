#!/usr/bin/env node
// Read-only audit of the *actual* Cloudflare POS staging URL.
// Usage: node pos/tests/deployment-audit.mjs https://your-staging.pages.dev <expected-full-commit-sha>
// No authentication tokens, cookies, database writes or production endpoints.
const [url, expected] = process.argv.slice(2);
if (!url || !expected || !/^[a-f0-9]{40}$/i.test(expected)) {
  console.error('Usage: node pos/tests/deployment-audit.mjs <staging-url> <expected-40-char-sha>');
  process.exit(2);
}
const origin = new URL(url);
if (origin.protocol !== 'https:' || !/\.pages\.dev$/i.test(origin.hostname)) {
  console.error('Only an explicit Cloudflare Pages preview hostname (*.pages.dev) is allowed.');
  process.exit(2);
}
async function get(path) {
  const response = await fetch(new URL(path, origin), {redirect:'error', cache:'no-store', headers:{'Cache-Control':'no-cache'}});
  return {status:response.status, headers:response.headers, body:await response.text()};
}
let failures=0;
function verdict(label, ok, detail='') {console.log((ok?'PASS':'FAIL')+' '+label+(detail?' — '+detail:''));if(!ok)failures++;}
try {
  const meta=await get('/deployment.json');
  verdict('Deployment metadata HTTP 200',meta.status===200,String(meta.status));
  let payload={};
  try {payload=JSON.parse(meta.body);}catch{}
  verdict('Staging environment',payload.environment==='staging',String(payload.environment));
  verdict('Exact deployed commit',payload.commit===expected, 'actual='+String(payload.commit)+' expected='+expected);
  const register=await get('/register.html');
  verdict('Register HTTP 200',register.status===200,String(register.status));
  verdict('Cashier stylesheet referenced',register.body.includes('cashier-focus.css'));
  const css=await get('/cashier-focus.css');
  verdict('Cashier stylesheet HTTP 200',css.status===200,String(css.status));
  verdict('Cashier stage selectors present',css.body.includes('data-cashier-stage="catalog"'));
  const display=await get('/display.html');
  verdict('Customer display HTTP 200',display.status===200,String(display.status));
  verdict('Customer welcome screen present',display.body.includes('id="customer-welcome"'));
  console.log('Cache-Control deployment.json:',meta.headers.get('cache-control')||'(not supplied)');
  console.log('Cache-Control register.html:',register.headers.get('cache-control')||'(not supplied)');
} catch(error) {
  console.error('BLOCKED: Could not read staging preview: '+error.message);
  process.exit(3);
}
process.exitCode=failures?1:0;

'use strict';
// Staging customer checkout, in a real touch-enabled Chromium browser.
// All HTTPS origins and Edge API responses are mocked in-memory: NO live sales,
// secrets, Supabase requests, cash drawer commands, or receipt jobs.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');

const ROOT=path.resolve(__dirname,'../..');
const CASHIER='https://pos.persenapparel.com';
const GUEST='https://guest-next-preview.commandcenter-4yg.pages.dev';
const API='https://naaqcspvbntzdtwuchrr.supabase.co';
const CHECKOUT='00000000-0000-4000-8000-000000000001';
const CAPABILITY='a'.repeat(64);
const file=name=>fs.readFileSync(path.join(ROOT,'pos-guest',name),'utf8');
const guestFiles=new Map([
 ['/pos-guest/',{type:'text/html',body:file('index.html')}],
 ['/pos-guest/guest.js',{type:'application/javascript',body:file('guest.js')}],
 ['/pos-guest/guest.css',{type:'text/css',body:file('guest.css')}],
 ['/pos-guest/holiday.css',{type:'text/css',body:file('holiday.css')}],
 ['/pos-guest/holiday.js',{type:'application/javascript',body:file('holiday.js')}],
 ['/pos-guest/holiday-tree.svg',{type:'image/svg+xml',body:file('holiday-tree.svg')}]
]);

(async()=>{
 let browser=null;
 let views=0,submits=0,answers=null;
 try{
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({
    viewport:{width:1194,height:834},hasTouch:true,isMobile:true,
    deviceScaleFactor:2
  });
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===CASHIER && url.pathname==='/test-checkout'){
      const html=`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0">
<iframe id="customer" sandbox="allow-scripts allow-forms allow-same-origin" title="customer" src="${GUEST}/pos-guest/"
 style="display:block;border:0;width:100vw;height:95vh"></iframe>
<script>
window.addEventListener('message',event=>{
 if(event.origin!=='${GUEST}'||event.source!==document.getElementById('customer').contentWindow||
    event.data?.type!=='persen:checkout-ready:v1')return;
 event.source.postMessage({
  type:'persen:checkout-bootstrap:v1',
  checkoutId:'${CHECKOUT}',capability:'${CAPABILITY}'
 },'${GUEST}');
});
</script></body></html>`;
      return route.fulfill({status:200,contentType:'text/html',body:html});
    }
    if(url.origin===GUEST && guestFiles.has(url.pathname)){
      const asset=guestFiles.get(url.pathname);
      return route.fulfill({status:200,contentType:asset.type,headers:{
        'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src "+API+"; frame-ancestors "+CASHIER+"; base-uri 'none'; form-action 'none'; object-src 'none'",
        'Cache-Control':'no-store'
      },body:asset.body});
    }
    if(url.origin===API && url.pathname.startsWith('/functions/v1/pos-guest-checkout/guest-checkout/')){
      const cors={'Access-Control-Allow-Origin':GUEST,'Vary':'Origin',
        'Access-Control-Allow-Methods':'POST, OPTIONS',
        'Access-Control-Allow-Headers':'Authorization, Content-Type',
        'Cache-Control':'no-store'};
      if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:cors,body:''});
      assert.equal(request.method(),'POST');
      assert.equal(request.headers().authorization,'Bearer '+CAPABILITY);
      const data=request.postDataJSON();
      assert.equal(data.checkoutId,CHECKOUT);
      if(url.pathname.endsWith('/view')){
        views++;
        return route.fulfill({status:200,contentType:'application/json',headers:cors,
          body:JSON.stringify({checkoutId:CHECKOUT,total:'$25.00',
            items:[{name:'Test Christmas Tee',quantity:1,lineTotal:'$25.00'}]})});
      }
      if(url.pathname.endsWith('/submit')){
        submits++;
        answers=data;
        return route.fulfill({status:200,contentType:'application/json',headers:cors,
          body:JSON.stringify({accepted:true})});
      }
    }
    return route.abort();
  });

  const page=await context.newPage();
  page.on('pageerror',error=>console.log('BROWSER PAGE ERROR: '+error.message));
  page.on('console',msg=>{if(msg.type()==='error')console.log('BROWSER CONSOLE ERROR: '+msg.text())});
  await page.goto(CASHIER+'/test-checkout',{waitUntil:'domcontentloaded'});
  const guest=page.frameLocator('#customer');
  const waitStep=async step=>{
    await guest.locator('.guest-progress-label').getByText('Step '+step+' of 5').waitFor({timeout:10000});
  };
  await guest.getByRole('heading',{name:'Here is your total.'}).waitFor({timeout:15000});
  await waitStep(1);
  await guest.locator('.guest-next').tap();
  await guest.getByRole('heading',{name:"What's your phone number?"}).waitFor({timeout:10000});
  await waitStep(2);
  await guest.locator('.guest-skip').tap();

  await guest.getByRole('heading',{name:"What's your email address?"}).waitFor({timeout:10000});
  await waitStep(3);
  await guest.locator('.guest-skip').tap();
  await guest.getByRole('heading',{name:'How would you like to pay?'}).waitFor({timeout:10000});
  await waitStep(4);
  await guest.locator('input[value="cash"]').check();
  await guest.locator('.guest-next').tap();
  await guest.getByRole('heading',{name:'Review and finish.'}).waitFor({timeout:10000});
  await waitStep(5);
  assert.equal(await guest.locator('input[type="text"]').count(),0,'no signature textbox');
  await guest.locator('.guest-next').tap();
  await guest.getByRole('heading',{name:'Thank you!'}).waitFor({timeout:10000});
  assert.equal(views,1,'guest must view one checkout');
  assert.equal(submits,1,'customer must submit only once');
  assert.equal(answers.paymentPreference,'cash');
  assert.equal('signature' in answers,false);
  assert.equal('signatureException' in answers,false);
  const isolated=await page.evaluate(()=>{
    try{return !!document.getElementById('customer').contentWindow.document;}
    catch(error){return error.name==='SecurityError';}
  });
  assert.equal(isolated,true,'cashier origin must not read isolated guest document');
  console.log('PASS: isolated touch-enabled browser total -> Next -> phone -> email -> payment -> confirmation -> thank you, one submit, no signature, no live APIs.');
 }catch(error){console.error(error);process.exitCode=1}
 finally{if(browser)await browser.close()}
})();

/* Browser viewport audit for the separate static POS Pages build.
 * It validates layout without connecting to live customer data or accepting payment.
 * Run after 'node pos/build-pages.mjs' with Playwright installed.
 */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve('pos-dist');
const types = {'.html':'text/html;charset=utf-8','.css':'text/css;charset=utf-8','.js':'application/javascript;charset=utf-8','.png':'image/png'};
const server = http.createServer((req,res)=>{
  const pathname = new URL(req.url,'http://localhost').pathname;
  const pathnameSafe = pathname === '/' ? '/index.html' : pathname;
  const filename = path.resolve(root,'.'+pathnameSafe);
  if (!filename.startsWith(root+path.sep)) {res.writeHead(403).end();return;}
  fs.readFile(filename,(err,data)=>{
    if(err){res.writeHead(404).end('Not found');return;}
    res.writeHead(200,{'content-type':types[path.extname(filename)]||'application/octet-stream'}).end(data);
  });
});
const viewports = [
  {name:'phone-390',width:390,height:844,isMobile:true,hasTouch:true},
  {name:'phone-430',width:430,height:932,isMobile:true,hasTouch:true},
  {name:'ipad-portrait',width:768,height:1024,isMobile:true,hasTouch:true},
  {name:'ipad-landscape',width:1024,height:768,isMobile:true,hasTouch:true},
  {name:'laptop',width:1366,height:768,isMobile:false,hasTouch:false}
];
const routes = ['/','/register.html','/display.html','/print-station.html'];
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address = server.address();
  const browser = await chromium.launch({headless:true});
  const failures = [];
  try {
    for(const device of viewports){
      const context = await browser.newContext({viewport:{width:device.width,height:device.height},isMobile:device.isMobile,hasTouch:device.hasTouch,deviceScaleFactor:1});
      for(const route of routes){
        const page = await context.newPage();
        // The browser audit is offline: do not load remote Supabase services.
        await page.route('**/*',routeRequest=>{
          if(routeRequest.request().url().startsWith('http://127.0.0.1:'))return routeRequest.continue();
          return routeRequest.fulfill({status:200,contentType:'application/javascript',body:''});
        });
        try{
          const response = await page.goto('http://127.0.0.1:'+address.port+route,{waitUntil:'domcontentloaded',timeout:20000});
          assert.equal(response.status(),200);
          await page.waitForTimeout(125);
          const dims = await page.evaluate(()=>{
            const d=document.documentElement,b=document.body;
            const offenders=[...document.querySelectorAll('main,header,.layout,.grid,.kiosk-header,.station-grid')].filter(el=>el.getBoundingClientRect().right>innerWidth+3).map(el=>({tag:el.tagName,cls:el.className,right:Math.round(el.getBoundingClientRect().right)}));
            return {viewport:innerWidth,document:d.scrollWidth,body:b.scrollWidth,offenders};
          });
          const excess = Math.max(dims.document,dims.body)-dims.viewport;
          if(excess>3||dims.offenders.length)failures.push({device:device.name,route,excess,offenders:dims.offenders});
          console.log(device.name,route,JSON.stringify(dims));
        }catch(err){failures.push({device:device.name,route,error:String(err)});}
        finally{await page.close();}
      }
      await context.close();
    }
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
  if(failures.length){console.error('Responsive viewport failures:',JSON.stringify(failures,null,2));process.exitCode=1;}
  else console.log('PASSED: POS dashboard, cashier, customer and print station at phone, iPad portrait/landscape and laptop widths');
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});

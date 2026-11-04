/* Build an isolated Cloudflare Pages POS site from the Commandcenter monorepo.
   Build command: node pos/build-pages.mjs
   Output directory: pos-dist
   No production deployment happens by running this script locally. */
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
const url=process.env.POS_SUPABASE_URL;
const key=process.env.POS_SUPABASE_PUBLISHABLE_KEY;
if(!url||!key)throw Error('POS staging requires POS_SUPABASE_URL and POS_SUPABASE_PUBLISHABLE_KEY');
const parsed=new URL(url);
if(parsed.protocol!=='https:'||!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url))throw Error('Invalid POS Supabase URL');
if(parsed.hostname==='icxeuhkqxxhdkfdappio.supabase.co')throw Error('Refusing to build POS against production Supabase');
if(!key.startsWith('sb_publishable_'))throw Error('Use a staging publishable key, never a secret or service_role key');
const dest='pos-dist';
await mkdir(dest,{recursive:true});
await mkdir(join(dest,'assets'),{recursive:true});
await copyFile(join('assets','persen-logo.png'),join(dest,'assets','persen-logo.png'));
for(const f of ['pos.css','pos.js','pos-core.js','pos-events.js','pos-receipt.js','pos-digital-receipt.js','pos-experience.js','checkout-flow.js','pos-cash.js','register.js','display.js','print-station.js','print-station.css']){
 await copyFile(join('pos',f),join(dest,f));
}
for(const f of ['backend.js','seasonal.js'])await copyFile(f,join(dest,f));
await writeFile(join(dest,'config.js'),`window.PERSEN_CONFIG = ${JSON.stringify({supabaseUrl:url,supabasePublishableKey:key,storefrontUrl:'https://persenapparel.com'})};\n`);
for(const f of ['register.html','display.html','index.html','print-station.html']){
 let s=await readFile(join('pos',f),'utf8');
 s=s.replaceAll('../config.js','config.js').replaceAll('../backend.js','backend.js').replaceAll('../seasonal.js','seasonal.js').replaceAll('../assets/persen-logo.png','assets/persen-logo.png');
 await writeFile(join(dest,f),s);
}
await writeFile(join(dest,'_headers'),'/register.html\n  X-Robots-Tag: noindex, nofollow\n/display.html\n  X-Robots-Tag: noindex, nofollow\n/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n');
// Root route now serves index.html (device dashboard); no redirect to cashier.
console.log('Prepared isolated POS Pages output in '+dest);

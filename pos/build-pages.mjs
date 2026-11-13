/* Build an isolated Cloudflare Pages POS site from the Commandcenter monorepo.
   Build command: node pos/build-pages.mjs
   Output directory: pos-dist
   No production deployment happens by running this script locally. */
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
// CI can build a nonfunctional artifact with placeholders; real deployments require explicit staging settings.
const ciDryRun=process.env.CI==='true' && !process.env.CF_PAGES && !process.env.POS_SUPABASE_URL && !process.env.POS_SUPABASE_PUBLISHABLE_KEY;
const url=ciDryRun?'https://pos-ci-placeholder.supabase.co':process.env.POS_SUPABASE_URL;
const key=ciDryRun?'sb_publishable_CI_PLACEHOLDER_NOT_FOR_DEPLOYMENT':process.env.POS_SUPABASE_PUBLISHABLE_KEY;
if(!url||!key)throw Error('POS staging requires POS_SUPABASE_URL and POS_SUPABASE_PUBLISHABLE_KEY');
if(ciDryRun)console.warn('CI DRY RUN ONLY: generated POS artifact is intentionally not connected to a database');
const parsed=new URL(url);
if(parsed.protocol!=='https:'||!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url))throw Error('Invalid POS Supabase URL');
if(parsed.hostname==='icxeuhkqxxhdkfdappio.supabase.co')throw Error('Refusing to build POS against production Supabase');
if(!ciDryRun&&parsed.hostname!=='naaqcspvbntzdtwuchrr.supabase.co')throw Error('Refusing to build POS against an unapproved Supabase project');
if(!key.startsWith('sb_publishable_'))throw Error('Use a staging publishable key, never a secret or service_role key');
const dest='pos-dist';
await mkdir(dest,{recursive:true});
await mkdir(join(dest,'assets'),{recursive:true});
await copyFile(join('assets','persen-logo.png'),join(dest,'assets','persen-logo.png'));
for(const f of ['pos.css','cashier-focus.css','pos.js','pos-core.js','pos-events.js','pos-receipt.js','receipt-paper-layout.js','pos-digital-receipt.js','pos-experience.js','checkout-flow.js','pos-cash.js','drawer-open-gate.js','register.js','display.js','print-station.js','print-station.css','admin.css','admin.js','inventory.js']){
 await copyFile(join('pos',f),join(dest,f));
}
for(const f of ['backend.js','seasonal.js','inventory-hub.js','inventory-hub.css'])await copyFile(f,join(dest,f));
await writeFile(join(dest,'config.js'),`window.PERSEN_CONFIG = ${JSON.stringify({supabaseUrl:url,supabasePublishableKey:key,storefrontUrl:'https://persenapparel.com'})};\n`);
for(const f of ['register.html','display.html','index.html','print-station.html','admin.html','inventory.html']){
 let s=await readFile(join('pos',f),'utf8');
 s=s.replaceAll('../config.js','config.js').replaceAll('../backend.js','backend.js').replaceAll('../seasonal.js','seasonal.js').replaceAll('../assets/persen-logo.png','assets/persen-logo.png');
 await writeFile(join(dest,f),s);
}
await writeFile(join(dest,'_headers'),'/*\n  X-Robots-Tag: noindex, nofollow\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n');
const commit=process.env.CF_PAGES_COMMIT_SHA;
await writeFile(join(dest,'deployment.json'),JSON.stringify({environment:'staging',commit:/^[a-f0-9]{40}$/i.test(commit||'')?commit:null})+'\n');
// Root route now serves index.html (device dashboard); no redirect to cashier.
console.log('Prepared isolated POS Pages output in '+dest);

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
// Keep every seasonal artwork reference in the deployed cashier artifact.
// The stylesheet references all of these files; copying just the tree and
// garland leaves invisible Christmas decorations in live Pages previews.
const christmasArtwork=[
 'christmas-tree.svg','christmas-garland.svg','christmas-snowflakes.svg',
 'christmas-lights.svg','christmas-gift-ribbon.svg','christmas-sales-trim.svg',
 'christmas-winter-corner.svg','christmas-home-stars.svg'
];
const christmasCss=await readFile(join('pos','christmas-cashier.css'),'utf8');
const artworkReferences=[...christmasCss.matchAll(/url\(\s*['"]?(christmas-[a-z0-9-]+\.svg)['"]?\s*\)/g)].map(m=>m[1]);
const missingArtwork=[...new Set(artworkReferences)].filter(file=>!christmasArtwork.includes(file));
if(missingArtwork.length)throw Error('Christmas cashier CSS references artwork omitted from Pages build: '+missingArtwork.join(', '));
for(const file of christmasArtwork)await copyFile(join('pos',file),join(dest,file));
for(const f of ['pos.css','cashier-focus.css','swivel-mode.css','christmas-cashier.css','christmas-dashboard.css','christmas-dashboard.js','pos.js','pos-core.js','pos-events.js','pos-receipt.js','pos-digital-receipt.js','pos-experience.js','checkout-flow.js','pos-cash.js','barcode-tender-model.js','register.js','swivel-mode.js','display.js','customer-guest-client.js','epson-center.js','epson-center.css','admin.css','admin.js','inventory.js','staff-test.css','staff-test.js']){
 await copyFile(join('pos',f),join(dest,f));
}
for(const f of ['backend.js','seasonal.js','inventory-hub.js','inventory-hub.css'])await copyFile(f,join(dest,f));
await writeFile(join(dest,'config.js'),`window.PERSEN_CONFIG = ${JSON.stringify({supabaseUrl:url,supabasePublishableKey:key,storefrontUrl:'https://persenapparel.com'})};\n`);
// Pinned customer build verified with staging-only framing CSP and CORS.
// An explicit POS_GUEST_ENTRY_URL from Cloudflare always takes precedence.
const guestFallback='https://7d86da09.commandcenter-4yg.pages.dev/pos-guest/';
function secureGuestEntry(value){
 const entry=new URL(value),host=entry.hostname.toLowerCase();
 if(entry.protocol!=='https:'||entry.username||entry.password||entry.search||entry.hash||
    entry.pathname!=='/pos-guest/'||
    !(host==='commandcenter-4yg.pages.dev'||host.endsWith('.commandcenter-4yg.pages.dev')))
  throw Error('POS guest entry must be the approved isolated staging customer origin');
 return entry.href;
}
const guestEntry=secureGuestEntry(process.env.POS_GUEST_ENTRY_URL||guestFallback);
await writeFile(join(dest,'handoff-config.js'),
 `window.PersenPOSHandoffConfig=Object.freeze(${JSON.stringify({guestEntryUrl:guestEntry})});\n`);
function bundleModule(source,resolver=''){
 return `(function(){const module={exports:{}};const exports=module.exports;${resolver}\n${source}\nreturn module.exports;})()`;
}
const [adapterSource,coordinatorSource,bridgeSource,frameSource]=await Promise.all([
 'handoff-rpc-adapter.cjs','checkout-handoff-coordinator.cjs',
 'staging-handoff-bridge.cjs','isolated-guest-frame.cjs'
].map(file=>readFile(join('pos',file),'utf8')));
const adapterModule=bundleModule(adapterSource);
const coordinatorModule=bundleModule(coordinatorSource);
const frameModule=bundleModule(frameSource);
const bridgeModule=bundleModule(bridgeSource,
 `const require=name=>{if(name==='./handoff-rpc-adapter.cjs')return adapter;if(name==='./checkout-handoff-coordinator.cjs')return coordinator;throw Error('Unexpected secure handoff module: '+name);};`);
const secureHandoffBundle=[
 "'use strict';",
 '(()=>{',
 `const adapter=${adapterModule};`,
 `const coordinator=${coordinatorModule};`,
 `const frame=${frameModule};`,
 `const bridge=${bridgeModule};`,
 'window.PersenPOSSecureHandoff=Object.freeze({',
 ' createStagingHandoffBridge:bridge.createStagingHandoffBridge,',
 ' createIsolatedGuestFrame:frame.createIsolatedGuestFrame',
 '});',
 '})();',
 ''
].join('\n');
await writeFile(join(dest,'secure-handoff-browser.js'),secureHandoffBundle);
for(const f of ['register.html','display.html','index.html','admin.html','inventory.html','staff-test.html']){
 let s=await readFile(join('pos',f),'utf8');
 s=s.replaceAll('../config.js','config.js').replaceAll('../backend.js','backend.js').replaceAll('../seasonal.js','seasonal.js').replaceAll('../assets/persen-logo.png','assets/persen-logo.png');
 await writeFile(join(dest,f),s);
}
await writeFile(join(dest,'_headers'),'/*\n  X-Robots-Tag: noindex, nofollow\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n');
const commit=process.env.CF_PAGES_COMMIT_SHA;
await writeFile(join(dest,'deployment.json'),JSON.stringify({environment:'staging',commit:/^[a-f0-9]{40}$/i.test(commit||'')?commit:null,guestEntryUrl:guestEntry,guestOrigin:new URL(guestEntry).origin})+'\n');
// Root route now serves index.html (device dashboard); no redirect to cashier.
console.log('Prepared isolated POS Pages output in '+dest);

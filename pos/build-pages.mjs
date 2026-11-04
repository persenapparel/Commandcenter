/* Build an isolated Cloudflare Pages POS site from the Commandcenter monorepo.
   Build command: node pos/build-pages.mjs
   Output directory: pos-dist
   No production deployment happens by running this script locally. */
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
const dest='pos-dist';
await mkdir(dest,{recursive:true});
for(const f of ['pos.css','pos.js','pos-core.js','pos-events.js','pos-receipt.js','register.js','display.js','pos-schema-review.sql']){
 await copyFile(join('pos',f),join(dest,f));
}
for(const f of ['config.js','backend.js','seasonal.js'])await copyFile(f,join(dest,f));
for(const f of ['register.html','display.html','index.html']){
 let s=await readFile(join('pos',f),'utf8');
 s=s.replaceAll('../config.js','config.js').replaceAll('../backend.js','backend.js').replaceAll('../seasonal.js','seasonal.js').replaceAll('../assets/persen-logo.png','assets/persen-logo.png');
 await writeFile(join(dest,f),s);
}
await writeFile(join(dest,'_headers'),'/register.html\n  X-Robots-Tag: noindex, nofollow\n/display.html\n  X-Robots-Tag: noindex, nofollow\n/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n');
await writeFile(join(dest,'_redirects'),'/ /register.html 302\n');
console.log('Prepared isolated POS Pages output in '+dest);

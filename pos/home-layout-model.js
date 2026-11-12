'use strict';
/* Persen POS layout policy. Pure validation; storage/auth enforced by server integration.
 * Do not treat client-side role labels as authorization.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PersenPOSLayouts=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const ROUTES={
  owner:['reports.html','inventory.html','transactions.html','events.html','receipt-designer.html','home-editor.html','products.html','customers.html','marketing.html','settings.html'],
  register:['register.html','events.html','orders.html','transactions.html','receipt-reprint.html','register-settings.html','customers.html'],
  customer:[]
 };
 const INITIAL={
  owner:['Sales & Reports','Inventory','Transactions','Events','Receipt Designer','Home Screen Editor','Products','Customers','Marketing','Settings'],
  register:['New Sale','Events','Orders','Transactions','Receipt Reprint','Register Settings','Customers'],
  customer:[]
 };
 const CUSTOMER_WELCOME='Welcome to Persen Apparel';
 const MAX_TILES=24,MAX_SLIDES=20;
 const isColor=x=>typeof x==='string'&&/^#[0-9a-f]{6}$/i.test(x);
 const text=(x,max)=>typeof x==='string'&&x.trim().length>0&&x.length<=max&&/^[^<>\u0000-\u001f]*$/.test(x);
 const asset=x=>typeof x==='string'&&/^\/assets\/pos-home\/[a-z0-9][a-z0-9._-]{0,120}\.(?:png|jpg|jpeg|webp)$/i.test(x)&&!x.includes('..');
 const safeExternal=x=>{try{const u=new URL(x);return u.protocol==='https:'&&u.username===''&&u.password===''&&u.hostname.length>3&&!u.hostname.endsWith('.local');}catch{return false}};
 function defaults(screen){
  if(!Object.hasOwn(ROUTES,screen))throw Error('Unknown screen');
  return {version:1,screen,title:screen==='customer'?CUSTOMER_WELCOME:screen==='owner'?'Persen POS Dashboard':'Persen POS Register',background:'#153b2e',theme:'auto',tiles:INITIAL[screen].map((label,i)=>({id:'tile-'+i,label,route:ROUTES[screen][i]||'register.html',required:true})),slides:[],logo:null,thankYouSeconds:5};
 }
 function validate(input){
  if(!input||!Object.hasOwn(ROUTES,input.screen)||input.version!==1)throw Error('Invalid layout version or screen');
  const screen=input.screen;
  if(!text(input.title,100)||!isColor(input.background)||!['auto','christmas','simple','spring','summer','fall'].includes(input.theme))throw Error('Invalid visual settings');
  if(!Array.isArray(input.tiles)||input.tiles.length>MAX_TILES)throw Error('Too many tiles');
  if(screen==='customer'&&input.tiles.length)throw Error('Customer idle screen is display-only');
  const ids=new Set(),mandatory=new Set(ROUTES[screen]);
  for(const tile of input.tiles){
   if(!tile||!text(tile.id,60)||!text(tile.label,60)||!ROUTES[screen].includes(tile.route)||ids.has(tile.id))throw Error('Invalid tile or destination');
   ids.add(tile.id);mandatory.delete(tile.route);
  }
  if(mandatory.size)throw Error('Required navigation cannot be removed');
  if(input.logo!==null&&!asset(input.logo))throw Error('Logo must be a verified uploaded asset path');
  if(!Array.isArray(input.slides)||input.slides.length>MAX_SLIDES)throw Error('Too many slides');
  for(const slide of input.slides){
   if(!slide||!asset(slide.image)||!text(slide.alt,160)||slide.href!=null&&!safeExternal(slide.href))throw Error('Invalid slideshow asset or link');
  }
  if(!Number.isInteger(input.thankYouSeconds)||input.thankYouSeconds<1||input.thankYouSeconds>30)throw Error('Invalid thank-you duration');
  return structuredClone(input);
 }
 function reorder(layout,from,to){
  const out=validate(layout);if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<0||from>=out.tiles.length||to>=out.tiles.length)throw Error('Invalid tile position');
  out.tiles.splice(to,0,...out.tiles.splice(from,1));return validate(out);
 }
 return {defaults,validate,reorder,safeExternal};
});

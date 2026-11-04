/* Lightweight, accessible seasonal treatments shared by Persen POS screens.
   Read-only published Seasonal Studio campaign data; never interpret campaign HTML. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.PersenPOSExperience=api;})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
const presets={
 christmas:{name:'Holiday season',icon:'❄️',secondary:'🎁',accent:'#a32736',background:'#fff5f4',message:'A little Long Island holiday cheer'},
 winter:{name:'Winter collection',icon:'❄️',secondary:'☃️',accent:'#285d9a',background:'#edf5ff',message:'Warm layers, Long Island style'},
 thanksgiving:{name:'Thanksgiving',icon:'🍂',secondary:'🦃',accent:'#a35824',background:'#fff6e8',message:'Thankful for our community'},
 halloween:{name:'Halloween',icon:'🎃',secondary:'👻',accent:'#ab552a',background:'#fff5eb',message:'Made for the spooky season'},
 valentines:{name:'Valentine’s Day',icon:'💌',secondary:'💗',accent:'#b3386e',background:'#fff0f6',message:'Made with love on Long Island'},
 spring:{name:'Spring',icon:'🌷',secondary:'🌼',accent:'#428469',background:'#eff9f2',message:'Fresh ideas. Custom-made here.'},
 summer:{name:'Summer',icon:'☀️',secondary:'🏖️',accent:'#c17725',background:'#fff9ea',message:'Long Island summer ready'},
 default:{name:'Persen Apparel',icon:'✦',secondary:'✦',accent:'#2563c9',background:'#f3f7fe',message:'Custom apparel, made for you'}
};
const safeHex=(s,backup)=>/^#[0-9a-f]{6}$/i.test(String(s||''))?s:backup;
function presetFor(input){
 const theme=String(input?.theme||input?.slug||'').toLowerCase();
 return Object.keys(presets).filter(x=>x!=='default').find(x=>theme.includes(x))||'default';
}
function palette(campaign){
 const k=presetFor(campaign),base=presets[k];
 const name=campaign?.published===true?String(campaign.title||base.name).trim().slice(0,80):'Persen Apparel';
 return {key:k,name,icon:base.icon,secondary:base.secondary,
  accent:campaign?.published===true?safeHex(campaign.accent,base.accent):presets.default.accent,
  background:campaign?.published===true?safeHex(campaign.background,base.background):presets.default.background,
  message:campaign?.published===true?String(campaign.announcement||base.message).trim().slice(0,170):base.message,
  active:campaign?.published===true};
}
function apply(doc,campaign){
 const p=palette(campaign);
 const root=doc.documentElement;
 root.style.setProperty('--pos-season',p.accent);
 root.style.setProperty('--pos-season-soft',p.background);
 root.dataset.season=p.key;
 const badges=doc.querySelectorAll('[data-season-icon]');
 badges.forEach(node=>{node.textContent=p.icon});
 const titles=doc.querySelectorAll('[data-season-label]');
 titles.forEach(node=>{node.textContent=p.name});
 const extras=doc.querySelectorAll('[data-season-easter-egg]');
 extras.forEach(node=>{node.textContent=p.active?p.secondary:'';node.hidden=!p.active});
 return p;
}
return {presets,presetFor,palette,apply};
});
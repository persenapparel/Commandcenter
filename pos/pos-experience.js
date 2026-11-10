/* Lightweight, accessible seasonal treatments shared by Persen POS screens.
   Read-only published Seasonal Studio campaign data; never interpret campaign HTML. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.PersenPOSExperience=api;})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
const presets={
 christmas:{name:'Christmas',icon:'❄️',secondary:'🦌',accent:'#a32736',background:'#fff5f4',message:'A little Long Island holiday cheer'},
 newyear:{name:'New Year',icon:'🎆',secondary:'✨',accent:'#5841a1',background:'#f5f2ff',message:'Here’s to a bright new year'},
 stpatricks:{name:'St. Patrick’s Day',icon:'☘️',secondary:'🌈',accent:'#18734e',background:'#effbf3',message:'A little luck, a lot of local love'},
 easter:{name:'Easter',icon:'🐣',secondary:'🌷',accent:'#9161b6',background:'#faf1ff',message:'Spring celebrations, custom-made'},
 mothersday:{name:'Mother’s Day',icon:'🌷',secondary:'💐',accent:'#a44277',background:'#fff0f6',message:'Made with love for Mom'},
 fathersday:{name:'Father’s Day',icon:'🏆',secondary:'💙',accent:'#2c5c89',background:'#edf6ff',message:'Celebrate Dad in style'},
 memorialday:{name:'Memorial Day',icon:'🇺🇸',secondary:'⭐',accent:'#2355a0',background:'#f0f5ff',message:'Remember and honor'},
 july4:{name:'Fourth of July',icon:'🇺🇸',secondary:'🎆',accent:'#b32737',background:'#fff2f3',message:'Celebrate summer on Long Island'},
 laborday:{name:'Labor Day',icon:'🛠️',secondary:'⭐',accent:'#2d6489',background:'#edf6fa',message:'Made for the hardworking community'},
 fall:{name:'Autumn',icon:'🍁',secondary:'🍂',accent:'#a45b2b',background:'#fff6e9',message:'Cozy season, custom style'},
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
 const k=campaign?.published===true?presetFor(campaign):'default',base=presets[k];
 const name=campaign?.published===true?String(campaign.title||base.name).trim().slice(0,80):'Persen Apparel';
 return {key:k,name,icon:base.icon,secondary:base.secondary,
  accent:campaign?.published===true?safeHex(campaign.accent,base.accent):presets.default.accent,
  background:campaign?.published===true?safeHex(campaign.background,base.background):presets.default.background,
  message:campaign?.published===true?String(campaign.announcement||base.message).trim().slice(0,170):base.message,
  active:campaign?.published===true};
}
/* Date-only UTC math avoids daylight-saving errors in the holiday day count. */
function daysUntilChristmas(now=new Date()){
 const date=new Date(now);
 if(!Number.isFinite(date.getTime()))return null;
 const year=date.getFullYear();
 const today=Date.UTC(year,date.getMonth(),date.getDate());
 let christmas=Date.UTC(year,11,25);
 if(today>christmas)christmas=Date.UTC(year+1,11,25);
 return Math.round((christmas-today)/86400000);
}
const MODE_KEY='persen-pos-appearance-v1';
function mode(){try{return localStorage.getItem(MODE_KEY)||'auto'}catch(_){return 'auto'}}
function setMode(value){if(!['auto','simple','christmas','winter','thanksgiving','halloween','valentines','newyear','stpatricks','easter','mothersday','fathersday','memorialday','july4','laborday','spring','summer','fall'].includes(value))return;try{localStorage.setItem(MODE_KEY,value)}catch(_){};if(typeof document!=='undefined')apply(document,window.__persenPosCampaign||null)}
function apply(doc,campaign){
 if(typeof window!=='undefined')window.__persenPosCampaign=campaign;
 const choice=mode();
 const simple=choice==='simple';
 const selected=choice==='auto'?campaign:choice==='simple'?null:{published:true,theme:choice};
 const p=palette(selected);
 const root=doc.documentElement;
 root.style.setProperty('--pos-season',simple?'#111111':p.accent);
 root.style.setProperty('--pos-season-soft',simple?'#ffffff':p.background);
 root.dataset.season=simple?'simple':p.key;
 root.dataset.posAppearance=simple?'simple':'festive';
 const badges=doc.querySelectorAll('[data-season-icon]');
 badges.forEach(node=>{node.textContent=p.icon});
 const titles=doc.querySelectorAll('[data-season-label]');
 titles.forEach(node=>{node.textContent=p.name});
 const extras=doc.querySelectorAll('[data-season-easter-egg]');
 extras.forEach(node=>{node.textContent=p.active?p.secondary:'';node.hidden=!p.active});
 if(doc.body){doc.body.classList.toggle('pos-simple-mode',simple);}
 if(!simple && p.key==='christmas' && doc.body){const existing=doc.getElementById('pos-holiday-lights');if(!existing){const trim=doc.createElement('div');trim.id='pos-holiday-lights';trim.className='pos-holiday-lights';trim.setAttribute('aria-hidden','true');trim.innerHTML='<span>●</span><span>●</span><span>●</span><span>●</span><span>●</span><span>●</span><span>●</span><span>●</span><span>●</span><span>●</span><span>●</span><span>●</span>';doc.body.prepend(trim)}}else{doc.getElementById('pos-holiday-lights')?.remove()}
 /* Optional, unobtrusive Christmas countdown; never shown in Simple Black Mode. */
 const countdownId='pos-christmas-countdown';
 const countdownAnchor=doc.querySelector('.experience-overline');
 const priorCountdown=doc.getElementById(countdownId);
 if(!simple&&p.key==='christmas'&&countdownAnchor){
  const days=daysUntilChristmas();
  if(days!==null){
   const countdown=priorCountdown||doc.createElement('p');
   if(!priorCountdown){countdown.id=countdownId;countdown.className='pos-christmas-countdown';countdownAnchor.insertAdjacentElement('afterend',countdown)}
   countdown.textContent=days===0?'🎄 Merry Christmas!':`🎄 ${days} ${days===1?'day':'days'} until Christmas`;
  }
 }else{priorCountdown?.remove()}
 return p;
}
function mountControls(doc){if(doc.getElementById('pos-appearance-control'))return;const control=doc.createElement('label');control.id='pos-appearance-control';control.className='pos-appearance-control';const title=doc.createElement('span');title.textContent='Appearance';const select=doc.createElement('select');select.setAttribute('aria-label','POS appearance');for(const [value,label] of [['auto','Automatic holiday'],['simple','Simple black'],...Object.entries(presets).filter(([k])=>k!=='default').map(([k,v])=>[k,v.name])]){const option=doc.createElement('option');option.value=value;option.textContent=label;select.append(option)}select.value=mode();select.addEventListener('change',()=>setMode(select.value));control.append(title,select);doc.body.append(control);apply(doc,window.__persenPosCampaign||null)}
if(typeof document!=='undefined'){const init=()=>{if(!document.body)return;const customer=!!document.body.classList.contains('kiosk-body');if(customer)apply(document,window.__persenPosCampaign||null);else mountControls(document)};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init()}
return {presets,presetFor,palette,apply,mode,setMode,mountControls,daysUntilChristmas};
});
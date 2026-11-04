/* Persen POS receipt copy and trustworthy public links.
   Presentation is editable; never alter immutable server-saved transaction totals. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.PersenPOSReceipt=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const DEFAULTS={
    headline:'THANK YOU FOR YOUR ORDER!',
    promotion:'Need custom shirts for a business, team or event? We can help!',
    footer:'Made with care on Long Island',
    review:'Enjoyed your experience? Leave us an honest Google review.'
  };
  function reviewUrl(raw){
    try{
      const url=new URL(String(raw||'').trim());
      const h=url.hostname.toLowerCase();
      const okay=h==='g.page'||h==='google.com'||h.endsWith('.google.com')||h==='maps.app.goo.gl';
      return url.protocol==='https:'&&okay?url.href:'';
    }catch{return ''}
  }
  function text(value,max=220,fallback=''){
    const v=String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
    return (v||fallback).slice(0,max);
  }
  function campaignMessage(campaign,enabled=true){
    if(!enabled||!campaign||campaign.published!==true)return '';
    return text(campaign.announcement,140)||'Discover '+text(campaign.title,75)+' at persenapparel.com';
  }
  function presentation(settings={}){
    return {
      headline:text(settings.headline,100,DEFAULTS.headline),
      promotion:text(settings.promotion,260,DEFAULTS.promotion),
      footer:text(settings.footer,120,DEFAULTS.footer),
      review:text(settings.review,130,DEFAULTS.review),
      review_url:settings.showReview===false?'':reviewUrl(settings.reviewLink),
      seasonal:campaignMessage(settings.season,settings.showSeason!==false),
      site:'persenapparel.com',
      instagram:'@persenapparel'
    };
  }
  return {DEFAULTS,reviewUrl,campaignMessage,presentation};
});
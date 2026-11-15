/* Persen POS: NELKO paper/layout policy. Calculation only; browser print cannot verify hardware. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else if(root)root.PersenPOSPaperLayout=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const PRESETS=Object.freeze({
  '50.8x101.6':{widthMm:50.8,heightMm:101.6,kind:'label'},
  '58x120':{widthMm:58,heightMm:120,kind:'fixed'},
  '80x140':{widthMm:80,heightMm:140,kind:'fixed'},
  '100x150':{widthMm:100,heightMm:150,kind:'label'},
  'continuous-100':{widthMm:100,heightMm:null,kind:'continuous'}
 });
 const valid=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
 function layoutFor(opts={}){
  const paper=PRESETS[opts.paper||'50.8x101.6'];
  if(!paper)throw Error('Unrecognized paper preset');
  const contentPx=Number(opts.contentPx??0),marginMm=Number(opts.marginMm??2),feedMm=Number(opts.feedMm??2),fontPx=Number(opts.fontPx??10);
  if(!valid(contentPx,0,1500)||!valid(marginMm,1,5)||!valid(feedMm,0,10)||!valid(fontPx,9,14))throw Error('Invalid receipt dimensions');
  // CSS pixel to millimeters: standard 96 CSS pixels per inch. Treat as a conservative
  // on-screen estimate; driver settings and sensor calibration are authoritative.
  const neededMm=Math.ceil((contentPx*25.4/96+feedMm+2)*10)/10;
  const heightMm=paper.kind==='continuous'?Math.max(45,Math.ceil(neededMm)):paper.heightMm;
  const fits=neededMm<=heightMm&&heightMm<=300;
  return {paper:opts.paper||'50.8x101.6',kind:paper.kind,widthMm:paper.widthMm,heightMm,neededMm,unusedMm:Math.max(0,Math.round((heightMm-neededMm)*10)/10),fits,reason:fits?'':paper.kind==='continuous'?'Receipt too long for continuous-page safety limit':'Receipt content exceeds selected fixed page height'};
 }
 function printCss(result,opts={}){
  if(!result||!result.fits)throw Error('Receipt paper size does not fit content');
  const marginMm=Number(opts.marginMm??2),fontPx=Number(opts.fontPx??10);
  if(!valid(marginMm,1,5)||!valid(fontPx,9,14))throw Error('Invalid receipt styling');
  // A single explicitly sized page avoids the old fixed 2x4 blank-tail behavior
  // when the driver truly supports continuous roll and custom-height pages.
  return '@page{size:'+result.widthMm+'mm '+result.heightMm+'mm;margin:0}'+
   '@media print{body{width:'+result.widthMm+'mm!important;min-width:0!important;height:auto!important;margin:0!important;padding:0!important;}'+
   '#receipt{width:'+result.widthMm+'mm!important;box-sizing:border-box!important;min-height:0!important;'+
   'padding:'+marginMm+'mm!important;font-size:'+fontPx+'px!important;line-height:1.25!important;'+
   'break-inside:avoid!important;page-break-inside:avoid!important;page-break-after:avoid!important;}}';
 }
 return {PRESETS,layoutFor,printCss};
});

/* Cosmetic-only staging dashboard holiday mode. No credentials or checkout data. */
(function(){
 'use strict';
 const now=new Date();
 const onCalendar=now.getMonth()===11||(now.getMonth()===10&&now.getDate()>=15);
 let mode='auto';
 try{mode=localStorage.getItem('persen-pos-appearance-v1')||'auto';}catch(_){}
 if(mode==='christmas'||(mode==='auto'&&onCalendar)){
   document.documentElement.dataset.posSeason='christmas';
 }
})();

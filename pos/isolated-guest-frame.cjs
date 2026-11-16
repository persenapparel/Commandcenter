'use strict';
/*
 * Isolated customer iframe bootstrap for a FUTURE staging-only runtime.
 * Not included in the active POS bundle. The existing same-origin retired
 * frame remains sandboxed/disabled. A different HTTPS customer origin is
 * essential: allow-same-origin is needed for the customer's CORS Origin
 * header and exact-origin postMessage, but MUST NOT be used on a frame
 * which could run content from the cashier origin.
 */
function createIsolatedGuestFrame({window,container,cashierOrigin,guestOrigin}) {
 if(!window || !container || typeof container.appendChild!=='function')
  throw Error('Customer frame dependencies missing');
 const cashier=new URL(cashierOrigin),guest=new URL(guestOrigin);
 const clean=u=>u.protocol==='https:' && !u.username&&!u.password&&
  !u.search&&!u.hash&&u.pathname==='/';
 if(!clean(cashier)||!clean(guest)||cashier.origin===guest.origin ||
    window.location?.origin!==cashier.origin)
  throw Error('Isolated, clean HTTPS cashier and guest origins required');
 let current=null;
 let cancelPending=null;
 async function open({checkoutId,capability}) {
  if(current)throw Error('Guest frame is already open');
  if(typeof checkoutId!=='string' || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(checkoutId) ||
     typeof capability!=='string' || !/^[a-f0-9]{64}$/i.test(capability))
   throw Error('Invalid checkout-specific guest authorization');
  const frame=window.document.createElement('iframe');
  frame.setAttribute('sandbox','allow-scripts allow-forms allow-same-origin');
  frame.setAttribute('referrerpolicy','no-referrer');
  frame.setAttribute('allow','');
  frame.setAttribute('title','Persen Apparel secure customer checkout');
  frame.className='swivel-customer-frame';
  current=frame;
  // Never place the bearer in src, name, URL fragment, DOM attributes,
  // sessionStorage, localStorage, or window globals.
  const ready=new Promise((resolve,reject)=>{
   let settled=false;
   const settle=(error)=>{
    if(settled)return;
    settled=true;
    frame.removeEventListener('load',onLoad);
    if(cancelPending===cancel)cancelPending=null;
    if(error)reject(error);else resolve();
   };
   const cancel=()=>settle(Error('Guest frame disposed before bootstrap'));
   cancelPending=cancel;
   const onLoad=()=>{
    if(current!==frame){settle(Error('Guest frame replaced'));return}
    try{
     // Exact target origin avoids sending credentials to navigated frames.
     frame.contentWindow.postMessage(
      {type:'persen:checkout-bootstrap:v1',checkoutId,capability},
      guest.origin
     );
     settle();
    }catch(_){settle(Error('Guest bootstrap unavailable'))}
   };
   frame.addEventListener('load',onLoad,{once:true});
   frame.src=guest.origin+'/';
   container.appendChild(frame);
  });
  try{await ready;return frame}
  catch(error){dispose();throw error}
 }
 function dispose(){
  const old=current;current=null;
  if(cancelPending)cancelPending();
  if(old){old.removeAttribute('src');old.remove();}
 }
 return Object.freeze({open,dispose,active:()=>!!current});
}
module.exports={createIsolatedGuestFrame};

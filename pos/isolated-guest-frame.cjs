'use strict';
/*
 * Isolated customer iframe bootstrap for a FUTURE staging-only runtime.
 * Not included in the active POS bundle. The existing same-origin retired
 * frame remains sandboxed/disabled. A different HTTPS customer origin is
 * essential: allow-same-origin is needed for the customer's CORS Origin
 * header and exact-origin postMessage, but MUST NOT be used on a frame
 * which could run content from the cashier origin.
 */
function createIsolatedGuestFrame({window,container,cashierOrigin,guestOrigin,guestEntryUrl}) {
 if(!window || !container || typeof container.appendChild!=='function')
  throw Error('Customer frame dependencies missing');
 const cashier=new URL(cashierOrigin),guest=new URL(guestOrigin);
 const entry=guestEntryUrl===undefined?new URL('/',guest.origin):new URL(guestEntryUrl);
 const clean=u=>u.protocol==='https:' && !u.username&&!u.password&&
  !u.search&&!u.hash&&u.pathname==='/';
 const cleanEntry=entry.protocol==='https:' && !entry.username&&!entry.password&&
  !entry.search&&!entry.hash&&entry.origin===guest.origin &&
  ['/', '/pos-guest/', '/pos-guest/index.html'].includes(entry.pathname);
 if(!clean(cashier)||!clean(guest)||!cleanEntry||cashier.origin===guest.origin ||
    window.location?.origin!==cashier.origin)
  throw Error('Isolated, clean HTTPS cashier and guest origins required');
 let current=null,pendingReject=null;
 function closeCurrent() {
  const old=current;current=null;
  if(old){old.removeAttribute('src');old.remove()}
 }
 async function open({checkoutId,capability}) {
  if(current)throw Error('Guest frame is already open');
  if(typeof checkoutId!=='string' || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(checkoutId) ||
     typeof capability!=='string' || !/^[a-f0-9]{64}$/i.test(capability))
   throw Error('Invalid checkout-specific guest authorization');
  if(typeof window.addEventListener!=='function' ||
     typeof window.removeEventListener!=='function' ||
     typeof window.setTimeout!=='function' ||
     typeof window.clearTimeout!=='function')
   throw Error('Customer origin handshake requires supported browser APIs');
  const frame=window.document.createElement('iframe');
  frame.setAttribute('sandbox','allow-scripts allow-forms allow-same-origin');
  frame.setAttribute('referrerpolicy','no-referrer');
  frame.setAttribute('allow','');
  frame.setAttribute('title','Persen Apparel secure customer checkout');
  frame.className='swivel-customer-frame';
  current=frame;
  // Do not send the capability on iframe load: a load event is not an
  // origin-authenticated document identity. Wait for a guest-origin READY
  // message and verify both its origin and its exact frame window source.
  const ready=new Promise((resolve,reject)=>{
   let timer=null,settled=false;
   const cleanup=()=>{
    window.removeEventListener('message',onReady);
    if(timer!==null)window.clearTimeout(timer);
    pendingReject=null;
   };
   const rejectLocked=error=>{
    if(settled)return;
    settled=true;cleanup();closeCurrent();reject(error);
   };
   const onReady=event=>{
    if(settled||current!==frame||event.origin!==guest.origin||
       event.source!==frame.contentWindow||
       event.data?.type!=='persen:checkout-ready:v1')return;
    settled=true;cleanup();
    try{
     frame.contentWindow.postMessage(
      {type:'persen:checkout-bootstrap:v1',checkoutId,capability},
      guest.origin
     );
     resolve(frame);
    }catch(_){closeCurrent();reject(Error('Guest bootstrap unavailable'))}
   };
   pendingReject=rejectLocked;
   window.addEventListener('message',onReady);
   timer=window.setTimeout(()=>rejectLocked(Error('Guest checkout ready timeout')),10000);
   frame.src=entry.href;
   try{container.appendChild(frame)}
   catch(_){rejectLocked(Error('Guest frame could not be mounted'))}
  });
  return ready;
 }
 function dispose(){
  if(pendingReject)pendingReject(Error('Guest frame disposed before ready'));
  closeCurrent();
 }
 return Object.freeze({open,dispose,active:()=>!!current});
}
module.exports={createIsolatedGuestFrame};

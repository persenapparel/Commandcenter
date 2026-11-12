/* Persen POS cash drawer opening gate — STAGING ONLY.
 * This is a browser-side UX/transport interface, NOT hardware support or
 * an authorization boundary. The physical RJ11/RJ12 drawer requires a
 * separately verified printer kick port or authenticated local controller.
 * Never use this module to authorize opening a drawer or to claim it opened.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else if(root)root.PersenDrawerOpenGate=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function createGate(){
    const attempted=new Set();
    async function requestCashOpen({saleId,serverSaved,paymentMethod,bridge}={}){
      // The caller must invoke this only after the authoritative server
      // recorded a cash sale and returned its saved row. A client flag alone
      // is never sufficient to authorize a physical kick.
      if(serverSaved!==true||paymentMethod!=='cash'||typeof saleId!=='string'||
         !/^[a-zA-Z0-9_-]{8,128}$/.test(saleId)){
        return {status:'blocked',message:'No verified saved cash sale'};
      }
      if(attempted.has(saleId)){
        return {status:'already-attempted',message:'No duplicate drawer command'};
      }
      if(!bridge||typeof bridge.openForSale!=='function'){
        return {status:'not-configured',message:'Electronic drawer adapter not configured'};
      }
      // Mark before awaited I/O; retries might cause a second physical kick
      // if a controller executed a command but its acknowledgement was lost.
      attempted.add(saleId);
      try{
        const result=await bridge.openForSale({saleId,purpose:'completed-cash-sale'});
        return result&&result.accepted===true
          ? {status:'command-accepted',message:'Open command accepted; check drawer physically'}
          : {status:'unconfirmed',message:'Could not verify command acceptance; do not auto-retry'};
      }catch(_err){
        // Do not put driver errors, credentials, or sale details on-screen.
        return {status:'unconfirmed',message:'Command outcome unknown; open with key if needed'};
      }
    }
    return Object.freeze({requestCashOpen});
  }
  return Object.freeze({createGate});
});

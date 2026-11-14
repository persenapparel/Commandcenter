/* Customer-facing POS transport. Never reuse the cashier's stored Supabase auth. */
'use strict';
(function(){
  const cfg=window.PERSEN_CONFIG||{};
  const ready=Boolean(cfg.supabaseUrl&&cfg.supabasePublishableKey&&window.supabase?.createClient);
  // No persistent session, no OAuth callback/session restoration, and no shared
  // browser storage. Customer RPCs must be independently authorized on the server
  // with a short-lived checkout-specific capability and abuse controls.
  const db=ready?window.supabase.createClient(
    cfg.supabaseUrl,cfg.supabasePublishableKey,{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
    }
  ):null;
  window.PA={db,ready};
})();

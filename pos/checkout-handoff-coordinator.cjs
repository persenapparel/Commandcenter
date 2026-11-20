'use strict';

/**
 * Cashier-side staging handoff coordinator.
 * This is the ONLY permitted sequence for handing a checkout to a guest.
 * The actual POS button must be wired only after hosted SQL/RLS and browser
 * origin-isolation tests pass. Never replace the fail-closed guard merely
 * because this module exists.
 *
 * Dependencies are explicit so the employee shift implementation can supply
 * its server-verified badge resume without a second competing auth flow.
 */
function createHandoffCoordinator({
  beginCheckout, issueCheckoutCapability, lockCashier, openIsolatedGuest,
  verifyShiftBadge, getCheckoutStatus, resumeCashier, finishVerifiedSale,
  clearGuestContext, showBrandedHome
}) {
  const deps = {beginCheckout,issueCheckoutCapability,lockCashier,
    openIsolatedGuest,verifyShiftBadge,getCheckoutStatus,resumeCashier,
    finishVerifiedSale,clearGuestContext,showBrandedHome};
  for (const [name, fn] of Object.entries(deps)) {
    if (typeof fn !== 'function') throw Error('Missing secure handoff dependency: '+name);
  }
  let phase='cashier', checkoutId=null, guestRevoker=null, pending=false;
  const requirePhase = expected => {
    if (phase!==expected || pending) throw Error('Checkout handoff is not in '+expected+' state');
  };
  async function handToCustomer() {
    requirePhase('cashier');
    pending=true;
    try {
      // Server MUST atomically start checkout and issue a short-lived,
      // one-checkout capability only to the authenticated cashier.
      const started=await beginCheckout();
      if (!started || !started.checkoutId) throw Error('Checkout not started');
      checkoutId=started.checkoutId;
      // Claim/lock before minting any guest token. This is intentionally
      // ordered: an unsuccessful cashier lock must never create a credential
      // the customer can reuse. The server must verify checkout ownership.
      const locked=await lockCashier(checkoutId);
      if (locked!==true) throw Error('Cashier credentials not cleared');
      const grant=await issueCheckoutCapability(checkoutId);
      // Even a malformed grant can carry a minted capability. Retain its
      // revoker before rejecting the response so the failure path can revoke
      // it. Never accept or open a grant with the wrong checkout identity.
      if (grant && typeof grant.revoke==='function') guestRevoker=grant.revoke;
      if (!grant || grant.checkoutId!==checkoutId ||
          typeof grant.capability!=='string' || !grant.capability ||
          typeof grant.revoke!=='function') throw Error('Invalid scoped guest grant');
      phase='guest';
      await openIsolatedGuest({checkoutId,capability:grant.capability});
      return {phase};
    } catch(e) {
      // Once the cashier has locked, never silently restore cashier controls.
      // Opening the guest view can fail after receiving a capability.
      // Revoke it and clear any partially installed guest context before
      // leaving the cashier locked. Cleanup failures must not unlock it.
      try { if (guestRevoker) await guestRevoker(); } catch (_) {}
      try { await clearGuestContext(); } catch (_) {}
      phase='locked';
      throw e;
    } finally {pending=false;}
  }
  async function customerCompleted() {
    requirePhase('guest');
    // A delayed or repeated customer callback must not race a second status
    // verification or change the phase while the first request is in flight.
    pending=true;
    const originalCheckoutId=checkoutId;
    try {
      const status=await getCheckoutStatus(originalCheckoutId);
      if (phase!=='guest' || checkoutId!==originalCheckoutId)
        throw Error('Checkout changed during customer verification');
      if (status!=='contact_received') throw Error('Customer response not verified');
      phase='customer_complete';
      return {message:'Your information is all set! Please turn the iPad back to your cashier to finish checking out.'};
    } finally {pending=false;}
  }
  function showCashierLock() {
    requirePhase('customer_complete');
    phase='locked';
    return {message:'Customer step complete — Cashier, scan your badge to continue'};
  }
  async function badgeResume(badge) {
    requirePhase('locked');
    pending=true;
    try {
      // Badge must be checked by the server against the still-valid shift.
      const resumeCheckoutId=checkoutId;
      const proof=await verifyShiftBadge({badge,checkoutId:resumeCheckoutId});
      if (phase!=='locked' || checkoutId!==resumeCheckoutId)
        throw Error('Checkout changed during badge verification');
      if (!proof || proof.verified!==true || proof.checkoutId!==resumeCheckoutId)
        throw Error('Badge not authorized for pending checkout');
      const status=await getCheckoutStatus(resumeCheckoutId);
      if (phase!=='locked' || checkoutId!==resumeCheckoutId)
        throw Error('Checkout changed during status verification');
      if (status!=='contact_received') throw Error('Customer step not completed');
      await resumeCashier({checkoutId:resumeCheckoutId,proof});
      if (phase!=='locked' || checkoutId!==resumeCheckoutId)
        throw Error('Checkout changed during cashier resume');
      phase='payment';
      return {phase};
    } finally {pending=false;}
  }
  async function finishSale(payment) {
    requirePhase('payment');
    pending=true;
    try {
      // Once finalization has been submitted, a timeout, rejected request or
      // malformed response may still mean the server completed the sale.
      // Fail closed rather than allowing a second submission for this checkout.
      const finishingCheckoutId=checkoutId;
      phase='finalizing';
      const result=await finishVerifiedSale({checkoutId:finishingCheckoutId,payment});
      if (!result || result.completed!==true || result.checkoutId!==finishingCheckoutId)
        throw Error('Sale completion unconfirmed; reconcile server status before another sale');
      // Server completion is irreversible. Never submit payment twice if
      // guest revocation, cleanup, or home navigation subsequently fails.
      phase='finalizing';
      // Attempt local credential cleanup even if server revocation fails.
      // Never show the home screen or permit another sale until both succeed.
      let revokeError=null;
      try { if (guestRevoker) await guestRevoker(); }
      catch (error) { revokeError=error; }
      let cleanupError=null;
      try { await clearGuestContext(); }
      catch (error) { cleanupError=error; }
      if (revokeError || cleanupError) {
        throw new AggregateError([revokeError,cleanupError].filter(Boolean),
          'Guest cleanup incomplete; checkout remains locked');
      }
      await showBrandedHome();
      phase='home'; checkoutId=null;guestRevoker=null;
      return {phase};
    } finally {pending=false;}
  }
  return {handToCustomer,customerCompleted,showCashierLock,badgeResume,
    finishSale,state:()=>({phase,checkoutId,pending})};
}
module.exports={createHandoffCoordinator};

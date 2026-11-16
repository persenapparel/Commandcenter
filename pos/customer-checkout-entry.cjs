'use strict';

const { createGuestTransport } = require('./guest-checkout-transport.cjs');
const { createCustomerCheckout } = require('./customer-checkout-screen.cjs');

/**
 * Customer-origin integration entrypoint. Runs ONLY in the credential-free
 * customer browsing context, never on the cashier origin.
 *
 * Bootstrap is deliberately one-shot, via a MessageChannel transferred from
 * a verified cashier origin after the cashier application has locked and
 * cleared its browser credentials. The token is never in URL, storage, DOM,
 * history, or a global variable. The server must still validate all claims.
 *
 * This module is not permission to enable handoff: server RPCs, RLS, badge
 * resume, hosted migration, and browser E2E remain required.
 */
function mountCustomerCheckout({window, root, cashierOrigin, apiOrigin, fetchImpl}) {
  if (!window || !root) throw Error('Customer window/root required');
  const customer = new URL(window.location.href);
  const cashier = new URL(cashierOrigin);
  if (customer.protocol !== 'https:' || cashier.protocol !== 'https:' ||
      customer.origin === cashier.origin || customer.username || customer.password ||
      customer.search || customer.hash) throw Error('Unsafe customer browsing context');
  if (window.opener) throw Error('Customer opener must be severed');
  if (window.parent === window) throw Error('Customer must run in isolated embedded context');
  let started = false;
  let disposed = false;
  let activeGuest = null;
  const onMessage = event => {
    if (disposed || started || event.origin !== cashier.origin ||
        event.source !== window.parent || !event.data ||
        event.data.type !== 'persen:checkout-bootstrap:v1') return;
    // The parent can only bootstrap after server-side cashier lock; this
    // check is enforced by the server and cannot be trusted from a message.
    const {checkoutId, capability} = event.data;
    let guest;
    try {
      guest = createGuestTransport({
        customerOrigin: customer.origin,
        cashierOrigin: cashier.origin,
        apiOrigin,
        checkoutId,
        capability,
        fetchImpl
      });
      const controller = createCustomerCheckout({
        root, guestApi: guest, origin: customer.origin, cashierOrigin: cashier.origin
      });
      activeGuest = guest;
      started = true;
      window.removeEventListener('message', onMessage);
      // A failed guest bootstrap must not leave a reusable bearer in memory.
      // This is client-side containment, not server-side capability revocation.
      try {
        Promise.resolve(controller.start()).catch(() => {
          guest.revokeLocal();
          activeGuest = null;
        });
      } catch (_) {
        guest.revokeLocal();
        activeGuest = null;
      }
    } catch (_) {
      // Invalid bootstrap never unlocks cashier or creates a guest session.
    }
  };
  window.addEventListener('message', onMessage);
  // Tell the exact authenticated cashier origin this isolated guest document
  // is ready. No checkout ID, bearer, staff secret or customer data is sent.
  // The parent must verify BOTH event.origin and event.source before sending
  // the one-checkout bootstrap token with an exact target origin.
  if (typeof window.parent?.postMessage === 'function') {
    window.parent.postMessage({type:'persen:checkout-ready:v1'},cashier.origin);
  }
  return {
    dispose() {
      disposed = true;
      window.removeEventListener('message', onMessage);
      // A removed/locked customer context must not retain a usable bearer.
      // This is local cleanup only; the backend must also revoke the token.
      if (activeGuest) activeGuest.revokeLocal();
      activeGuest = null;
    }
  };
}
module.exports = {mountCustomerCheckout};

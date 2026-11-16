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
      started = true;
      window.removeEventListener('message', onMessage);
      void controller.start();
    } catch (_) {
      // Invalid bootstrap never unlocks cashier or creates a guest session.
    }
  };
  window.addEventListener('message', onMessage);
  return {
    dispose() {
      disposed = true;
      window.removeEventListener('message', onMessage);
    }
  };
}
module.exports = {mountCustomerCheckout};

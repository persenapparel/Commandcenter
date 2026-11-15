'use strict';

/**
 * Staging-only customer-origin policy. This module is deliberately NOT wired to
 * Hand to Customer until the backend checkout-scoped capability and browser E2E
 * isolation tests are passing. Never use the legacy register pairing secret.
 *
 * The caller supplies the approved customer origin from trusted deployment
 * configuration, never from customer input, query parameters, or postMessage.
 */
function customerCheckoutUrl({ cashierOrigin, customerOrigin, checkoutId, capability }) {
  const cashier = new URL(cashierOrigin);
  const customer = new URL(customerOrigin);
  if (cashier.protocol !== 'https:' || customer.protocol !== 'https:')
    throw new Error('HTTPS is required for both checkout origins');
  if (cashier.origin === customer.origin)
    throw new Error('Customer checkout must use an isolated origin');
  if (customer.username || customer.password || customer.search || customer.hash ||
      customer.pathname !== '/')
    throw new Error('Customer origin configuration must be an origin only');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkoutId))
    throw new Error('Invalid checkout identifier');
  if (typeof capability !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(capability))
    throw new Error('Invalid checkout-scoped capability');
  // Capability must NOT be placed in URL, browser history, referrer, or logs.
  // Transfer it through a deliberately isolated, authenticated bootstrap
  // channel designed and tested separately. This helper only constructs a
  // non-secret navigation target.
  const target = new URL('/customer-checkout/', customer.origin);
  target.searchParams.set('checkout', checkoutId);
  return target.href;
}

if (typeof module !== 'undefined') module.exports = { customerCheckoutUrl };

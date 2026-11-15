'use strict';

/**
 * Staging-only guest transport adapter. Must execute on a distinct customer
 * HTTPS origin. It does not issue capabilities or make checkout authorization
 * decisions. Server endpoints MUST enforce token TTL, checkout binding,
 * one-time submit, rate limits and RLS before this can be enabled.
 *
 * Never persist the token, include it in URLs, logs, or send cashier cookies.
 */
function createGuestTransport({customerOrigin, cashierOrigin, apiOrigin, checkoutId, capability, fetchImpl}) {
  const customer = new URL(customerOrigin);
  const cashier = new URL(cashierOrigin);
  const api = new URL(apiOrigin);
  if ([customer, cashier, api].some(u => u.protocol !== 'https:' || u.username || u.password || u.search || u.hash))
    throw Error('Clean HTTPS origins required');
  if (customer.origin === cashier.origin || api.origin === cashier.origin)
    throw Error('Cashier origin isolation required');
  if (customer.pathname !== '/' || cashier.pathname !== '/' || api.pathname !== '/')
    throw Error('Origin only required');
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(checkoutId))
    throw Error('Invalid checkout id');
  if (typeof capability !== 'string' || !/^[a-f0-9]{64}$/i.test(capability))
    throw Error('Invalid checkout capability');
  if (typeof fetchImpl !== 'function') throw Error('Fetch required');
  let token = capability;
  let submitted = false;
  let busy = false;
  async function request(method, action, body) {
    if (!token || busy) throw Error('Checkout unavailable');
    busy = true;
    try {
      const response = await fetchImpl(new URL('/guest-checkout/' + action, api.origin).href, {
        method,
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store'
        },
        ...(body === undefined ? {} : {body: JSON.stringify(body)})
      });
      if (!response || !response.ok) throw Error('Checkout unavailable');
      const result = await response.json();
      if (!result || typeof result !== 'object' || Array.isArray(result))
        throw Error('Invalid guest response');
      return result;
    } finally { busy = false; }
  }
  return Object.freeze({
    async view() {
      if (submitted) throw Error('Checkout already submitted');
      return request('POST', 'view', {checkoutId});
    },
    async submit(answers) {
      if (submitted) throw Error('Checkout already submitted');
      submitted = true; // fail closed on ambiguous network outcomes; never retry submit
      try {
        const result = await request('POST', 'submit', {checkoutId, answers});
        if (result.accepted !== true) throw Error('Checkout not accepted');
        return {accepted:true};
      } finally { token = null; }
    },
    revokeLocal() { token = null; submitted = true; }
  });
}
module.exports = {createGuestTransport};

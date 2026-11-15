'use strict';

// Guest-visible payload boundary. Apply before rendering any guest response.
// This is defense in depth, NOT a substitute for server authorization or RLS.
const forbidden = /(?:token|secret|session|authorization|password|owner|employee|cashier|tender|payment|change|refund|cost|margin|access_key|service_role)/i;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedRoot = new Set(['checkoutId', 'items', 'total']);
const allowedItem = new Set(['name', 'quantity', 'lineTotal']);
function keysAreSafe(object, allowed) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) throw Error('Invalid guest payload');
  for (const key of Object.keys(object)) {
    if (forbidden.test(key) || !allowed.has(key)) throw Error('Unexpected guest payload field');
  }
}
function text(value, max) {
  if (typeof value !== 'string' || value.length > max || !value.trim()) throw Error('Invalid guest text');
  return value;
}
function validateGuestView(raw, expectedCheckoutId) {
  keysAreSafe(raw, allowedRoot);
  if (!uuid.test(expectedCheckoutId) || raw.checkoutId !== expectedCheckoutId) throw Error('Checkout mismatch');
  if (!Array.isArray(raw.items) || raw.items.length > 100 || raw.items.length === 0) throw Error('Invalid guest items');
  const items = raw.items.map(item => {
    keysAreSafe(item, allowedItem);
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) throw Error('Invalid quantity');
    return Object.freeze({name:text(item.name, 160), quantity:item.quantity, lineTotal:text(item.lineTotal, 40)});
  });
  return Object.freeze({checkoutId:raw.checkoutId, items:Object.freeze(items), total:text(raw.total, 40)});
}
module.exports = {validateGuestView};

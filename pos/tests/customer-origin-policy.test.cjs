'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { customerCheckoutUrl } = require('../customer-origin-policy.cjs');
const good = {
  cashierOrigin: 'https://cashier.staging.example',
  customerOrigin: 'https://guest.staging.example',
  checkoutId: '123e4567-e89b-42d3-a456-426614174000',
  capability: 'a'.repeat(48)
};
test('navigation target is separate-origin and contains no guest secret', () => {
  const url = customerCheckoutUrl(good);
  assert.equal(new URL(url).origin, good.customerOrigin);
  assert.equal(new URL(url).searchParams.get('checkout'), good.checkoutId);
  assert.ok(!url.includes(good.capability));
  assert.ok(!url.includes('pair='));
});
for (const [name, changes] of [
  ['same origin', { customerOrigin: good.cashierOrigin }],
  ['HTTP customer', { customerOrigin: 'http://guest.staging.example' }],
  ['HTTP cashier', { cashierOrigin: 'http://cashier.staging.example' }],
  ['origin with path', { customerOrigin: 'https://guest.staging.example/admin' }],
  ['origin with credentials', { customerOrigin: 'https://owner:secret@guest.staging.example' }],
  ['origin with query', { customerOrigin: 'https://guest.staging.example/?token=abc' }],
  ['invalid checkout', { checkoutId: '../admin' }],
  ['short token', { capability: 'short' }],
  ['missing token', { capability: '' }]
]) {
  test('rejects ' + name, () => assert.throws(() => customerCheckoutUrl({ ...good, ...changes })));
}

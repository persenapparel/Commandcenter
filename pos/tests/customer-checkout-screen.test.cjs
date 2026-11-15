'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCustomerCheckout } = require('../customer-checkout-screen.cjs');

const root = { replaceChildren() {}, ownerDocument: { createElement() {} } };
const guestApi = { async view() {}, async submit() {} };
const valid = {
  root, guestApi,
  origin: 'https://guest-staging.example',
  cashierOrigin: 'https://cashier-staging.example'
};
test('rejects same-origin cashier/customer session', () => {
  assert.throws(() => createCustomerCheckout({
    ...valid, origin: valid.cashierOrigin
  }), /Isolated HTTPS/);
});
test('rejects HTTP guest origin', () => {
  assert.throws(() => createCustomerCheckout({
    ...valid, origin: 'http://guest-staging.example'
  }), /Isolated HTTPS/);
});
test('refuses to mount without a verified guest transport', () => {
  assert.throws(() => createCustomerCheckout({
    ...valid, guestApi: undefined
  }), /Verified guest API/);
  assert.throws(() => createCustomerCheckout({
    ...valid, guestApi: { view() {} }
  }), /Verified guest API/);
});
test('exports a controller without cashier unlock or payment methods', () => {
  const controller = createCustomerCheckout(valid);
  assert.deepEqual(Object.keys(controller), ['start']);
});

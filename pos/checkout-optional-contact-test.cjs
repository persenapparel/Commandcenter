'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const wizard = require('./checkout-flow.js');

test('phone is individually optional', () => {
  assert.equal(wizard.checkStep('phone', {phone: ''}), '');
  assert.equal(wizard.checkStep('phone', {phone: '   '}), '');
  assert.equal(wizard.checkStep('phone', {phone: '(631) 555-0101'}), '');
  assert.match(wizard.checkStep('phone', {phone: '63155'}), /10 digits/);
});

test('email is independently optional except when explicitly requested for email receipt', () => {
  assert.equal(wizard.checkStep('email', {email:'', receipt:'print'}), '');
  assert.equal(wizard.checkStep('email', {email:'', receipt:'none'}), '');
  assert.match(wizard.checkStep('email', {email:'', receipt:'email'}), /required/);
  assert.equal(wizard.checkStep('email', {email:'customer@example.com', receipt:'email'}), '');
});

test('blank phone never becomes fabricated contact data', () => {
  assert.equal(wizard.summary({phone:'', email:'', receipt:'none'}).phone, '');
});

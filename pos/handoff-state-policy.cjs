'use strict';
// Pure staging-only handoff transition policy. This does not authenticate badges,
// issue capabilities, or enable the live Hand to Customer button.
const STATES = Object.freeze({
  CASHIER: 'cashier', CUSTOMER: 'customer', CUSTOMER_DONE: 'customer_done',
  CASHIER_LOCKED: 'cashier_locked', PAYMENT: 'payment', IDLE: 'idle'
});
function transition(state, event, evidence = {}) {
  if (!Object.values(STATES).includes(state)) throw new Error('invalid state');
  switch (event) {
    case 'HAND_TO_CUSTOMER':
      if (state !== STATES.CASHIER || evidence.guestCapabilityVerified !== true ||
          evidence.cashierSessionSuspended !== true || evidence.checkoutBound !== true)
        return state;
      return STATES.CUSTOMER;
    case 'CUSTOMER_SUBMITTED':
      if (state !== STATES.CUSTOMER || evidence.serverSubmissionAccepted !== true)
        return state;
      return STATES.CUSTOMER_DONE;
    case 'CASHIER_CHECKOUT':
      return state === STATES.CUSTOMER_DONE ? STATES.CASHIER_LOCKED : state;
    case 'BADGE_VERIFIED':
      if (state !== STATES.CASHIER_LOCKED || evidence.serverVerified !== true ||
          evidence.sameValidShift !== true || evidence.checkoutBound !== true)
        return state;
      return STATES.PAYMENT;
    case 'FINISH_ORDER':
      if (state !== STATES.PAYMENT || evidence.paymentVerified !== true ||
          evidence.orderCommitted !== true) return state;
      return STATES.IDLE;
    case 'REFRESH':
    case 'BACK':
    case 'IDLE_TIMEOUT':
      // Browser history and inactivity must never recover privileged controls.
      return state === STATES.PAYMENT || state === STATES.CASHIER
        ? STATES.CASHIER_LOCKED : state;
    default:
      return state;
  }
}
module.exports = {STATES, transition};

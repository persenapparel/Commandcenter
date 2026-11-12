// Run with: node --test pos/tests/stage-layout.test.cjs
// Static regression checks: no database, live checkout, or printer involved.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'register.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'pos.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'register.js'), 'utf8');
const wizard = require('../checkout-flow.js');

test('cashier has distinct catalog, customer, payment, and handoff stages', () => {
 assert.equal(wizard.cashierStage(null), 'catalog');
 assert.equal(wizard.cashierStage({status:'awaiting_customer'}), 'customer');
 assert.equal(wizard.cashierStage({status:'contact_received',payment_preference:'cash'}), 'payment');
 assert.equal(wizard.cashierStage({status:'contact_received',payment_preference:'venmo_info'}), 'external');
 assert.equal(wizard.cashierStage({status:'completed',cash_handoff_complete:false}), 'handoff');
 assert.equal(wizard.cashierStage({status:'completed',cash_handoff_complete:true}), 'catalog');
});
test('cashier stage is connected to DOM and status refresh', () => {
 assert.match(html, /data-cashier-stage="catalog"/);
 assert.match(html, /id="cashier-checkout-panel"/);
 assert.match(html, /id="cash-handoff"/);
 assert.match(html, /id="finish-order"/);
 assert.match(js, /document\.body\.dataset\.cashierStage=stage/);
 assert.match(js, /syncCashierStage\(\)/);
 assert.match(js, /pos_finish_order/);
});
test('focused screens hide unrelated catalog and payment panels', () => {
 for(const stage of ['customer','payment','external','handoff']){
  assert.ok(css.includes('body[data-cashier-stage="'+stage+'"] .layout>.panel:not(#cashier-checkout-panel)'), stage);
 }
 assert.ok(css.includes('body[data-cashier-stage="customer"] .cash-terminal{display:none}'));
 assert.ok(css.includes('body[data-cashier-stage="handoff"] .cash-terminal>:not(#cash-handoff){display:none!important}'));
 assert.ok(css.includes('.cash-handoff[hidden]{display:none!important}'));
});
test('payment cannot be finalized without cash confirmation and finish order', () => {
 assert.match(js, /pos_complete_cash/);
 assert.match(js, /showPaidAwaitingHandoff/);
 assert.match(js, /by\('finish-order'\)\.disabled=false/);
 assert.match(js, /pos_finish_order/);
});
test('customer welcome state follows checkout completion', () => {
 assert.equal(wizard.customerStage('idle'), 'welcome');
 assert.equal(wizard.customerStage('awaiting_customer'), 'checkout');
 assert.equal(wizard.customerStage('completed', 1000), 'checkout');
 assert.equal(wizard.customerStage('completed', 4000), 'welcome');
});

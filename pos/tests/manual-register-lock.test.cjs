'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The secure bridge's actual lock/unlock and payment-transition assertions
// are covered by staging-handoff-bridge.test.cjs. This guard ensures the
// manual button cannot accidentally become a purely visual "lock".
const html = fs.readFileSync(path.join(__dirname, '..', 'register.html'), 'utf8');
const swivel = fs.readFileSync(path.join(__dirname, '..', 'swivel-mode.js'), 'utf8');
test('cashier register has a real accessible manual lock button', () => {
  assert.match(html, /id="lock-register"[^>]*type="button"/);
  assert.match(html, /Lock Register<\/button>/);
  assert.match(html, /id="close-register"/, 'existing Close Register is preserved');
});
test('manual lock uses secure bridge state rather than hiding the register', () => {
  const event = swivel.indexOf("manualLock.addEventListener('click'");
  const lock = swivel.indexOf('bridge.lockForIdle()', event);
  const overlay = swivel.indexOf("renderIdleLock('manual')", event);
  assert.ok(event > -1 && lock > event && overlay > lock);
  assert.ok(overlay - lock < 400, 'render only when bridge lock succeeds');
  const block = swivel.slice(event,overlay+30);
  assert.match(block, /!bridge\?\.state\?\.\(\)\.employee/);
  assert.match(block, /pos-register-closed/);
  assert.doesNotMatch(block, /setRegisterOpen\(|sessionStorage\.(?:clear|removeItem)|checkout\s*=\s*null|cart\s*=\s*\[\]/);
});
test('both explicit and timeout locks require a badge to resume', () => {
  assert.match(swivel, /function renderIdleLock\(reason='idle'\)/);
  assert.match(swivel, /const verified=await bridge\.unlockIdle\(badge\)/);
  assert.match(swivel, /checkIdle\(\)/);
  assert.match(swivel, /renderIdleLock\('manual'\)/);
});

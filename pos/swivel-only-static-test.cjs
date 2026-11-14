'use strict';
// Static staging regression: customer checkout must not expose a dual-device mode.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const swivel=fs.readFileSync('pos/swivel-mode.js','utf8');
assert.doesNotMatch(swivel,/localStorage\.getItem\(key\)|mode\s*===?\s*['"]dual['"]|mode\s*!==?\s*['"]swivel['"]|showPairingUrl\(/);
assert.match(swivel,/document\.querySelector\('\.pos-device-mode'\)\?\.remove\(\)/);
assert.match(swivel,/el\.hidden=true/);
assert.match(swivel,/db\.auth\.signInWithPassword/);
assert.match(swivel,/PA\.isAdmin\(user\)/);
assert.match(swivel,/pos_issue_display_pairing/,'Existing server token still required internally until secure single-screen protocol is reviewed');
// Fail-closed guard: neither initial handoff nor resume may reach open().
assert.match(swivel,/if\(swivelStarting\|\|busy\|\|checkout\|\|pendingCash\)return;[\s\S]*?notice\('Customer handoff is temporarily unavailable:[\s\S]*?return;[\s\S]*?swivelStarting=true;/);
assert.match(swivel,/if\(!checkout\|\|checkout.status!=='awaiting_customer'\)return;[\s\S]*?notice\('Customer handoff is disabled[\s\S]*?return;[\s\S]*?const button=\$\('swivel-resume'\)/);
const dashboard=fs.readFileSync('pos/index.html','utf8');
assert.doesNotMatch(dashboard,/Optional Second iPad|Open Customer Display|Two-iPad mode remains optional|The separate customer display is still available/);
assert.match(dashboard,/href="register.html"/);
assert.match(dashboard,/href="admin.html#print-center"/);
console.log('PASS: swivel-only UI static checks (not an authentication or device security test)');

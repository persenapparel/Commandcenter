'use strict';
/* Staging-only Christmas appearance regression. No network or database access. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'pos-experience.js'), 'utf8');
const build = fs.readFileSync(path.join(root, 'build-pages.mjs'), 'utf8');
const register = fs.readFileSync(path.join(root, 'register.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'christmas-cashier.css'), 'utf8');
const art = fs.readFileSync(path.join(root, 'christmas-tree.svg'), 'utf8');

assert.match(register, /href="christmas-cashier\.css"/, 'cashier page must load its holiday stylesheet');
assert.match(build, /'christmas-cashier\.css'/, 'build must copy the holiday stylesheet');
assert.match(build, /'christmas-tree\.svg'/, 'build must copy original artwork');
assert.match(css, /url\("christmas-tree\.svg"\)/, 'seasonal artwork must be referenced');
assert.match(css, /prefers-reduced-motion:reduce/, 'seasonal motion must be optional');
assert.match(css, /\[data-pos-season="christmas"\]/, 'styles must not leak into other seasonal themes');
assert.match(art, /^<svg[\s\S]*<\/svg>\s*$/, 'holiday illustration should be a standalone SVG');
assert.doesNotMatch(art, /<script|<foreignObject|(?:href|xlink:href)=["']https?:/i, 'art must not embed scripts or external content');

function checkAppearance(dateIso, appearance, campaign, expectedSeason) {
  class MockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [dateIso])); }
  }
  const sandbox = {
    module: {exports: {}}, Date: MockDate,
    localStorage: {getItem: () => appearance}
  };
  vm.runInNewContext(source, sandbox, {filename: 'pos-experience.js'});
  const dataset = {};
  const documentStub = {
    documentElement: {dataset, style: {setProperty(){}}},
    body: null, querySelectorAll: () => [], querySelector: () => null,
    getElementById: () => null
  };
  sandbox.module.exports.apply(documentStub, campaign);
  assert.equal(dataset.season, expectedSeason);
  assert.equal(dataset.posSeason, expectedSeason === 'christmas' ? 'christmas' : undefined);
}

checkAppearance('2026-11-19T12:00:00Z', 'auto', null, 'christmas');
checkAppearance('2026-12-25T12:00:00Z', 'auto', null, 'christmas');
checkAppearance('2026-11-14T12:00:00Z', 'auto', null, 'default');
checkAppearance('2027-01-01T12:00:00Z', 'auto', null, 'default');
checkAppearance('2026-11-19T12:00:00Z', 'simple', null, 'simple');
checkAppearance('2026-11-19T12:00:00Z', 'winter', null, 'winter');
checkAppearance('2026-11-19T12:00:00Z', 'auto', {published:true,theme:'winter'}, 'winter');
checkAppearance('2026-11-19T12:00:00Z', 'christmas', null, 'christmas');
console.log('Christmas cashier seasonal wiring and source contracts passed.');

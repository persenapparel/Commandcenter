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
const garland = fs.readFileSync(path.join(root, 'christmas-garland.svg'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const dashboardCss = fs.readFileSync(path.join(root, 'christmas-dashboard.css'), 'utf8');
const dashboardJs = fs.readFileSync(path.join(root, 'christmas-dashboard.js'), 'utf8');

assert.match(register, /href="christmas-cashier\.css"/, 'cashier page must load its holiday stylesheet');
assert.match(build, /'christmas-cashier\.css'/, 'build must copy the holiday stylesheet');
assert.match(build, /'christmas-tree\.svg'/, 'build must copy original artwork');
assert.match(build, /'christmas-garland\.svg'/, 'build must ship original festive garland');
assert.match(css, /url\("christmas-garland\.svg"\)/, 'garland must decorate cashier without overlaying inputs');
assert.match(garland, /^<svg[\s\S]*<\/svg>\s*$/, 'garland must be a self-contained SVG');
assert.doesNotMatch(garland, /<script|<foreignObject|(?:href|xlink:href)=["']https?:/i, 'garland must contain no script or external links');
assert.match(css, /url\("christmas-tree\.svg"\)/, 'seasonal artwork must be referenced');
assert.match(css, /prefers-reduced-motion:reduce/, 'seasonal motion must be optional');
assert.match(css, /\[data-pos-season="christmas"\]/, 'styles must not leak into other seasonal themes');
assert.match(art, /^<svg[\s\S]*<\/svg>\s*$/, 'holiday illustration should be a standalone SVG');
assert.doesNotMatch(art, /<script|<foreignObject|(?:href|xlink:href)=["']https?:/i, 'art must not embed scripts or external content');
assert.match(dashboard, /href="christmas-dashboard\.css"/, 'dashboard must load the seasonal stylesheet');
assert.match(dashboard, /src="christmas-dashboard\.js"/, 'dashboard must load the seasonal mode script');
assert.match(dashboard, /class="christmas-dashboard-scene" aria-hidden="true"/, 'dashboard artwork must be noninteractive');
assert.match(build, /'christmas-dashboard\.css','christmas-dashboard\.js'/, 'build must ship dashboard assets');
assert.match(dashboardCss, /:root\[data-pos-season="christmas"\]/, 'dashboard holiday styling must be scoped');
assert.doesNotMatch(dashboardJs, /session|auth\.uid|fetch\(|supabase|password/i, 'dashboard seasonal script cannot read auth or checkout data');
function checkDashboard(dateIso, choice, active) {
  class MockDate extends Date {constructor(...args){super(...(args.length?args:[dateIso]));}}
  const ctx={Date:MockDate,document:{documentElement:{dataset:{}}},localStorage:{getItem:()=>choice}};
  vm.runInNewContext(dashboardJs,ctx,{filename:'christmas-dashboard.js'});
  assert.equal(ctx.document.documentElement.dataset.posSeason,active?'christmas':undefined);
}
checkDashboard('2026-11-19T12:00:00Z','auto',true);
checkDashboard('2027-01-02T12:00:00Z','auto',false);
checkDashboard('2026-11-19T12:00:00Z','simple',false);
checkDashboard('2026-11-19T12:00:00Z','winter',false);
checkDashboard('2026-11-19T12:00:00Z','christmas',true);

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
const {christmasCountdownText}=require('../pos-experience.js');
assert.equal(christmasCountdownText(new Date(2026,11,24,12)), '🎄 1 day until Christmas');
assert.equal(christmasCountdownText(new Date(2026,11,25,12)), '🎄 Merry Christmas!');
assert.equal(christmasCountdownText(new Date(2026,11,26,12)), '🎄 Happy Holidays!');
assert.equal(christmasCountdownText(new Date(2026,11,31,12)), '🎄 Happy Holidays!');
console.log('Christmas cashier seasonal wiring and source contracts passed.');

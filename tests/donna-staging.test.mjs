import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const repository = resolve(fileURLToPath(new URL('..', import.meta.url)));
const script = join(repository, 'scripts/donna-stage.mjs');
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'donna-stage-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const run = (...args) => exec(process.execPath, [script, ...args], { cwd: repository });
async function files(root, base = '') {
  const entries = await readdir(join(root, base), { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? files(root, join(base, e.name)) : join(base, e.name)))).flat().sort();
}
async function configAt(dir, config) { const path = join(dir, 'public-config.json'); await writeFile(path, JSON.stringify(config)); return path; }

test('disconnected Donna-only bundle excludes site/POS/private config and has verifiable hashes', async t => {
  const dir = await fixture(t), out = join(dir, 'bundle');
  const { stdout } = await run('--out', out);
  const result = JSON.parse(stdout);
  assert.equal(result.disconnected, true);
  assert.equal(result.deployed, false);
  const shipped = await files(out);
  assert.deepEqual(shipped, [
    'README.md', 'package.json', 'public/404.html', 'public/_headers', 'public/assets/persen-logo.png',
    'public/config.js', 'public/docs/donna/ON-DEVICE-SHORTCUT.md', 'public/docs/donna/SETUP-AND-COSTS.md', 'public/donna/api.js', 'public/donna/app.js',
    'public/donna/core.js', 'public/donna/icon.svg', 'public/donna/index.html', 'public/donna/manifest.webmanifest',
    'public/donna/style.css', 'public/index.html', 'staging-manifest.json'
  ].sort());
  const config = await readFile(join(out, 'public/config.js'), 'utf8');
  assert.match(config, /"supabaseUrl": ""/);
  assert.match(config, /"supabasePublishableKey": ""/);
  assert.match(config, /"donnaStaging": true/);
  assert.doesNotMatch(config, /icxeuhkqxxhdkfdappio|naaqcspvbntzdtwuchrr|sb_publishable_c1/);
  const manifest = JSON.parse(await readFile(join(out, 'staging-manifest.json'), 'utf8'));
  for (const f of manifest.files) assert.equal(createHash('sha256').update(await readFile(join(out, f.path))).digest('hex'), f.sha256);
  for (const file of ['index.html', 'app.js', 'api.js', 'core.js', 'style.css']) assert.equal(await readFile(join(out, 'public/donna', file), 'utf8'), await readFile(join(repository, 'donna', file), 'utf8'));
  const headers = await readFile(join(out, 'public/_headers'), 'utf8');
  assert.match(headers, /connect-src 'self';/);
  assert.match(headers, /Cache-Control: no-store/);
  assert.match(headers, /\/donna\/\*\n  ! Permissions-Policy\n  Permissions-Policy: camera=\(\), microphone=\(self\)/);
});

test('existing production and POS staging backends are rejected without creating output', async t => {
  const dir = await fixture(t);
  for (const project of ['icxeuhkqxxhdkfdappio', 'naaqcspvbntzdtwuchrr']) {
    const path = await configAt(dir, { supabaseUrl: `https://${project}.supabase.co`, supabasePublishableKey: 'sb_publishable_test' });
    const out = join(dir, project);
    await assert.rejects(run('--out', out, '--config', path), error => /cannot be used in this isolated bundle/.test(error.stderr));
    await assert.rejects(readdir(out), { code: 'ENOENT' });
  }
});

test('secret/unknown fields and unsafe URLs never enter the bundle or error output', async t => {
  const dir = await fixture(t), secret = 'never-echo-this-secret';
  for (const config of [
    { serviceRoleKey: secret },
    { supabaseUrl: 'https://dedicatedtest.supabase.co', supabasePublishableKey: `sb_secret_${secret}` },
    { supabaseUrl: 'http://dedicatedtest.supabase.co', supabasePublishableKey: 'sb_publishable_test' },
    { supabaseUrl: 'https://user:pass@dedicatedtest.supabase.co', supabasePublishableKey: 'sb_publishable_test' },
    { commandCenterUrl: 'javascript:alert(1)' },
    { commandCenterUrl: `https://example.com/?token=${secret}` }
  ]) {
    const path = await configAt(dir, config);
    await assert.rejects(run('--out', join(dir, 'rejected'), '--config', path), error => !error.stderr.includes(secret));
  }
});

test('dedicated public test config sets exact CSP destination and optional gateway imports resolve', async t => {
  const dir = await fixture(t), out = join(dir, 'gateway');
  const path = await configAt(dir, { supabaseUrl: 'https://dedicatedtest.supabase.co', supabasePublishableKey: 'sb_publishable_test', commandCenterUrl: 'https://owner.example.com/' });
  const { stdout } = await run('--out', out, '--config', path, '--with-gateway');
  assert.equal(JSON.parse(stdout).gatewayIncluded, true);
  assert.equal(JSON.parse(stdout).disconnected, false);
  const header = await readFile(join(out, 'public/_headers'), 'utf8');
  assert.match(header, /connect-src 'self' https:\/\/dedicatedtest.supabase.co;/);
  assert.doesNotMatch(header, /icxeuhkqxxhdkfdappio|naaqcspvbntzdtwuchrr/);
  const gateway = await import(new URL(`file://${join(out, 'functions/api/donna/[[path]].js')}`).href);
  const response = await gateway.onRequest({ request: new Request('https://donna.example/api/donna/orders', { method: 'POST' }), params: { path: ['orders'] }, env: {} });
  assert.equal(response.status, 405);
  const shipped = await files(out);
  assert.ok(shipped.includes('donna/api.js'));
  assert.ok(shipped.includes('functions/api/donna/[[path]].js'));
  assert.ok(!shipped.some(path => /admin\.js|inventory-hub|setup\.sql|\.env|node_modules/.test(path)));
});

test('existing output is never overwritten, and source-tree destinations including symlink parents are refused', async t => {
  const dir = await fixture(t), existing = join(dir, 'existing');
  await mkdir(existing); await writeFile(join(existing, 'keep.txt'), 'keep');
  await assert.rejects(run('--out', existing), error => /already exists/.test(error.stderr));
  assert.equal(await readFile(join(existing, 'keep.txt'), 'utf8'), 'keep');
  for (const path of [join(repository, 'donna-generated-test'), join(repository, '..inside-repository')]) await assert.rejects(run('--out', path), error => /outside the repository/.test(error.stderr));
  await symlink(repository, join(dir, 'checkout-link'), 'dir');
  await assert.rejects(run('--out', join(dir, 'checkout-link', 'must-not-create')), error => /outside the repository/.test(error.stderr));
});

test('the generated web links resolve inside staging while missing admin/POS routes remain missing', async t => {
  const dir = await fixture(t), out = join(dir, 'bundle');
  await run('--out', out);
  const index = await readFile(join(out, 'public/donna/index.html'), 'utf8');
  const localLinks = [...index.matchAll(/(?:href|src)="([^"#]+)"/g)].map(match => match[1]).filter(path => !/^[a-z]+:/.test(path));
  for (const path of localLinks) await readFile(resolve(out, 'public/donna', path));
  assert.match(await readFile(join(out, 'public/index.html'), 'utf8'), /url=\/donna\//);
  await assert.rejects(readFile(join(out, 'public/admin.js')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(out, 'public/inventory-hub.js')), { code: 'ENOENT' });
});

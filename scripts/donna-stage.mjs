#!/usr/bin/env node
/* Build an isolated Donna-only staging bundle. No network, deployment, or database access. */
import { readFile, writeFile, copyFile, mkdir, lstat, realpath, rm, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, basename, resolve, relative, join, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BLOCKED_PROJECTS = new Set(['icxeuhkqxxhdkfdappio', 'naaqcspvbntzdtwuchrr']);
const WEB_FILES = ['index.html', 'app.js', 'api.js', 'core.js', 'style.css', 'icon.svg', 'manifest.webmanifest'];
const DOCUMENTS = ['SETUP-AND-COSTS.md', 'ON-DEVICE-SHORTCUT.md'];
const HELP = `Create a Donna-only staging bundle without deploying or changing any database.

Usage:
  node scripts/donna-stage.mjs --out /absolute/new-directory [--config /path/to/public-test-config.json] [--with-gateway]

The destination must not exist and must be outside this repository.
Default: disconnected, browser-session practice only. No root production config is copied.
Optional config accepts only supabaseUrl, supabasePublishableKey, and commandCenterUrl.
Known production and POS staging Supabase projects are rejected.
--with-gateway includes the optional fixed-route GET-only Pages gateway source.
Serve/deploy only <destination>/public as the web root; no deployment is performed here.
`;

function fail(message) { throw new Error(message); }
function parseArgs(args) {
  const options = { gateway: false };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help' || flag === '-h') return { help: true };
    if (flag === '--with-gateway') { options.gateway = true; continue; }
    if (!['--out', '--config'].includes(flag)) fail('Unknown option. Use --help for the staging bundle command.');
    if (!args[i + 1] || args[i + 1].startsWith('--')) fail('Each path option requires a value.');
    const field = flag === '--out' ? 'out' : 'config';
    if (options[field]) fail('Do not repeat a path option.');
    options[field] = resolve(args[++i]);
  }
  if (!options.out) fail('Specify a new output directory with --out.');
  return options;
}

async function validateOutput(out) {
  let ancestor = out;
  const suffix = [];
  while (true) {
    try { await lstat(ancestor); break; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      suffix.unshift(basename(ancestor));
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  const actual = resolve(await realpath(ancestor), ...suffix);
  const child = relative(await realpath(repository), actual);
  if (child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith('..' + sep))) fail('Staging output must be outside the repository; source files are never overwritten.');
}

async function readConfig(path) {
  const config = { supabaseUrl: '', supabasePublishableKey: '', commandCenterUrl: '', donnaStaging: true };
  if (!path) return config;
  const raw = await readFile(path, 'utf8');
  if (Buffer.byteLength(raw) > 16384) fail('The public test configuration is too large.');
  let input;
  try { input = JSON.parse(raw); } catch { fail('The public test configuration must be valid JSON.'); }
  if (!input || Array.isArray(input) || typeof input !== 'object') fail('The public test configuration must be a JSON object.');
  const allowed = new Set(['supabaseUrl', 'supabasePublishableKey', 'commandCenterUrl']);
  if (Object.keys(input).some(key => !allowed.has(key))) fail('Only public test configuration fields are accepted. Secrets and unknown fields are not copied.');
  if (Object.values(input).some(value => typeof value !== 'string')) fail('Public test configuration values must be strings.');
  if (Boolean(input.supabaseUrl) !== Boolean(input.supabasePublishableKey)) fail('A test Supabase URL and publishable key must be provided together.');
  if (input.supabaseUrl) {
    let url;
    try { url = new URL(input.supabaseUrl); } catch { fail('Use an HTTPS Supabase test-project URL.'); }
    const project = url.hostname.toLowerCase().match(/^([a-z0-9]+)\.supabase\.co$/)?.[1];
    if (url.protocol !== 'https:' || !project || url.port || url.pathname !== '/' || url.search || url.hash || url.username || url.password) fail('Use an HTTPS Supabase test-project URL with no extra path, credentials, or parameters.');
    if (BLOCKED_PROJECTS.has(project)) fail('The existing production and POS staging projects cannot be used in this isolated bundle. Use a dedicated test backend or remain disconnected.');
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(input.supabasePublishableKey)) fail('Only a Supabase publishable key is allowed. Secret, service-role, and legacy JWT keys are rejected.');
    config.supabaseUrl = url.origin;
    config.supabasePublishableKey = input.supabasePublishableKey;
  }
  if (input.commandCenterUrl) {
    let url;
    try { url = new URL(input.commandCenterUrl); } catch { fail('The optional Command Center link must be HTTPS.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail('The optional Command Center link must be HTTPS without credentials or URL parameters.');
    config.commandCenterUrl = url.href;
  }
  return config;
}

function headerText(config) {
  const endpoint = config.supabaseUrl ? ` ${config.supabaseUrl}` : '';
  return `/*
  X-Robots-Tag: noindex, nofollow
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Cache-Control: no-store
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'${endpoint}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'

/donna/*
  ! Permissions-Policy
  Permissions-Policy: camera=(), microphone=(self), geolocation=(), payment=()
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { process.stdout.write(HELP); return; }
  const config = await readConfig(options.config);
  await validateOutput(options.out);
  // Validate the destination before creating any files; never replace an existing tree.
  try { await lstat(options.out); fail('The destination already exists. Choose a new directory; nothing is overwritten.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(dirname(options.out), { recursive: true });
  const temporary = join(dirname(options.out), `.donna-staging-${randomUUID()}`);
  await mkdir(temporary);
  const copied = [];
  async function copy(source, destination) {
    const src = resolve(repository, source);
    if (!(await lstat(src)).isFile()) fail('A staged source must be a regular file, not a link or directory.');
    const target = resolve(temporary, destination);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(src, target);
    copied.push(destination);
  }
  async function write(path, text) {
    const target = join(temporary, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text);
    copied.push(path);
  }
  try {
    for (const file of WEB_FILES) await copy(`donna/${file}`, `public/donna/${file}`);
    await copy('assets/persen-logo.png', 'public/assets/persen-logo.png');
    for (const file of DOCUMENTS) await copy(`docs/donna/${file}`, `public/docs/donna/${file}`);
    // Serializing known public fields avoids executing a configuration file as code.
    await write('public/config.js', `/* Isolated Donna staging. Public test configuration only. */\nwindow.PERSEN_CONFIG = ${JSON.stringify(config, null, 2)};\n`);
    await write('public/index.html', '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta http-equiv="refresh" content="0;url=/donna/"><title>Donna staging</title></head><body><a href="/donna/">Open the isolated Donna workspace</a></body></html>\n');
    await write('public/_headers', headerText(config));
    // No SPA fallback: a missing admin/POS path must not resolve to a business app.
    await write('public/404.html', '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Donna staging · Page not found</title></head><body><p>This isolated staging host contains Donna only.</p><a href="/donna/">Return to Donna</a></body></html>\n');
    await write('package.json', '{"private":true,"type":"module"}\n');
    if (options.gateway) {
      await copy('functions/api/donna/[[path]].js', 'functions/api/donna/[[path]].js');
      await copy('functions/package.json', 'functions/package.json');
      // Preserve the gateway's source import path; these runtime modules are outside the web root.
      for (const file of ['api.js', 'core.js', 'package.json']) await copy(`donna/${file}`, `donna/${file}`);
    }
    await write('README.md', `# Isolated Donna staging bundle\n\nThis directory contains only Donna. It does not include the storefront, Command Center application, inventory/POS application, production config, credentials, or SQL setup. No deployment or database change was performed when generating it.\n\n- Web output: \`public/\`\n- Start route: \`/donna/\`\n- Backend: ${config.supabaseUrl ? 'explicit dedicated test project (not production or POS staging)' : 'disconnected; browser-session practice only'}\n- Optional native GET-only gateway: ${options.gateway ? 'source included under functions/' : 'not included'}\n\nFor local inspection, serve only \`public/\` with a static development server. A static server does not execute Pages Functions. A future Cloudflare Pages staging project must use this bundle as its project directory and \`public\` as build output. Do not connect it to the existing production Pages project or production custom domain. Confirm the free plan and capacity before deployment.\n\n${options.gateway ? 'The gateway needs host-managed SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY environment values for the dedicated test backend. Never put a secret or service-role key here. Gateway routes are fixed and GET-only; browser memory writes use the configured dedicated test backend and its RLS.\n\n' : ''}Use the six \`/donna/?view=...\` URLs in \`public/docs/donna/SETUP-AND-COSTS.md\` after an approved HTTPS staging address exists. Real Siri, Safari voice, and native iPhone tests remain required.\n`);
    let sourceCommit = null, sourceWorkingTreeDirty = null;
    try {
      const gitOptions = { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
      sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], gitOptions).trim();
      sourceWorkingTreeDirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], gitOptions).trim());
    } catch {}
    const files = [];
    for (const path of copied.sort()) files.push({ path, sha256: createHash('sha256').update(await readFile(join(temporary, path))).digest('hex') });
    await writeFile(join(temporary, 'staging-manifest.json'), JSON.stringify({ format: 'donna-isolated-staging-v1', sourceCommit, sourceWorkingTreeDirty, disconnected: !config.supabaseUrl, gatewayIncluded: options.gateway, files }, null, 2) + '\n');
    // Reserve the destination with an exclusive mkdir after building. If another
    // process created it meanwhile, fail instead of replacing even an empty tree.
    await mkdir(options.out);
    await rename(temporary, options.out);
    process.stdout.write(JSON.stringify({ output: options.out, webRoot: join(options.out, 'public'), disconnected: !config.supabaseUrl, gatewayIncluded: options.gateway, files: files.length, deployed: false }) + '\n');
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

main().catch(error => { process.stderr.write(`Donna staging bundle: ${error.message}\n`); process.exitCode = 1; });

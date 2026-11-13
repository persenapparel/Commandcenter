# Donna-only staging bundle

The existing development branch may receive a Cloudflare preview through the repository's current integration. That preview is separate from the main production branch, but it contains the full repository and uses the repository's current configuration. The packaging command below prepares a smaller, isolated Donna bundle without touching the live website, production database, or POS system.

Run from the repository root, choosing a **new** directory outside the checkout:

```sh
node scripts/donna-stage.mjs --out /workspace/work/donna-staging
```

The default bundle is disconnected. It copies only the allowlisted Donna web files, Donna logo, public setup/cost and on-device shortcut guides, and generated staging-only config/headers. It never copies the current `config.js`, root admin page, storefront screens, inventory/POS scripts, database setup SQL, native source, Git metadata, tests, dependency directories, environment files, or credentials. No deployment, subscription, provider API call, schema change, or customer-data read is performed.

The generated directory contains:

```text
donna-staging/
  README.md
  package.json
  staging-manifest.json
  public/
    index.html               # launch /donna/
    404.html                 # no fallback to admin or POS screens
    config.js                # disconnected public settings by default
    _headers                 # no-store; restricted CSP; Donna-only microphone permission
    donna/                   # Donna web assets only
    assets/persen-logo.png
    docs/donna/SETUP-AND-COSTS.md
    docs/donna/ON-DEVICE-SHORTCUT.md
```

`staging-manifest.json` records the current source commit, `sourceWorkingTreeDirty` state, and SHA-256 hashes for each shipped file. A dirty working tree means the copied snapshot includes edits beyond the named commit; the hashes identify the exact files actually shipped. The dirty flag covers tracked and untracked repository files without recording their names. Missing Git metadata is represented as `null`, not a claim of clean committed source. The script refuses an existing destination or output inside the source repository, so it cannot overwrite website files. A generated bundle is an intermediate development artifact, not a deployment.

## Optional dedicated test backend

Stay disconnected until a separate, zero-cost test backend has been selected and the account's plan/capacity verified. Do **not** reuse the active POS staging database, create a billable Supabase branch, or copy customer data.

When an appropriate backend is approved, create a public-only JSON config file outside the repository:

```json
{
  "supabaseUrl": "https://YOUR-DEDICATED-TEST-PROJECT.supabase.co",
  "supabasePublishableKey": "sb_publishable_YOUR_PUBLIC_TEST_KEY",
  "commandCenterUrl": ""
}
```

Supply its path, rather than putting values in command arguments:

```sh
node scripts/donna-stage.mjs --out /workspace/work/donna-staging-test --config /workspace/work/donna-public-test-config.json --with-gateway
```

The packager rejects the known main production and POS staging Supabase projects, unknown fields, secret/service-role/legacy JWT keys, and unsafe URLs. The optional link is for an owner-approved HTTPS Command Center address; an empty link keeps this disconnected staging workspace independent. Public configuration is serialized as data, never executed as a configuration script.

The optional gateway adds `functions/` plus the two supporting Donna runtime modules outside `public/`, preserving the original source imports. The web output remains **`public`**. For a separately approved Cloudflare Pages staging project, keep the generated bundle as project root and select `public` as its output directory. Host-managed `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` must refer to the dedicated test backend; no environment values are generated or installed by this tool. A local static server does not execute Pages Functions.

Before enabling memory on the dedicated backend, review/apply the Donna schema there and test the actual Supabase authentication, grants, and RLS with non-customer accounts. Browser memory/conversation writes must target only that approved test backend. The gateway remains fixed-route and GET-only. This packager does not establish hosting access control or verify provider billing totals; those are deployment checks.

## Validation and iPhone acceptance

```sh
node --test tests/donna-staging.test.mjs
```

These checks confirm the file allowlist, disconnected config, production/POS rejection, no-overwrite protection, optional gateway imports, and content hashes. They do not verify Cloudflare's applied headers or browser rendering. After an approved HTTPS staging host exists, test the six Siri launch URLs, microphone consent/fallbacks, voice playback, lock-screen behavior, and the owner's iPhone 16 on iOS 27.0.1. Keep production unmerged until acceptance succeeds.

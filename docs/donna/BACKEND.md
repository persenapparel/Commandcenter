# Donna free backend and business rules

Implemented without new hosted services or model dependencies. Source is staged only; this change does not deploy, mutate Supabase, start notifications, send messages, or activate billing.

## Running the web adapter

The `/donna/` web app imports `donna/api.js` and uses the existing root `PERSEN_CONFIG` public HTTPS Supabase URL and modern `sb_publishable_…` key. It uses Auth and PostgREST over HTTPS; no Supabase SDK/CDN package is added. Secret/service-role keys are rejected. Passwords are sent only to that configured Supabase Auth endpoint and never persisted. Session and refresh tokens use `sessionStorage` for this tab, not durable browser local storage. The adapter serializes refresh-token rotation across parallel reads; a late refresh response cannot restore a signed-out or replaced session. It checks the live Auth user and `admin_users` allowlist before every business read or Donna storage action. The browser stores credentials accessible to its own JavaScript, as the existing Command Center does; maintain a strict CSP, lock the device, and sign out on shared devices.

Only selected fields in `TOOLS` can be read. Donna has no business-record mutation methods. Existing owner tokens still carry their existing Command Center permissions; this code does not mint a database-level read-only token. RLS remains the database security boundary. No model gets tokens, arbitrary SQL, a database connection, or permission to choose arbitrary tables.

`createDonnaAPI(config)` provides:

- `status()`: `{configured,authenticated,admin,user?,error?}`.
- `signIn(email,password)`, `signOut()`; no signup or account creation.
- `diagnostics()` returns in-memory counts for request attempts, reads, Auth requests, Donna storage writes, failures, and rate-limit responses in this tab since page load. It contains no tokens or records and explicitly does not claim to measure provider monthly totals or remaining quota.
- `load(tool)`: `{rows,complete,total,source,asOf}` for `tasks`, `orders`, `inventory`, `invoices`, `payments`, `contacts`, `agreements`, `events`.
- `memories.list/create/update/delete/history`; list returns the same envelope. Create always saves a pending draft. Confirming requires `update(id,{status:'confirmed',approved:true,version})`. Updates can filter by expected version to reject stale edits.
- `conversations.list/save/delete`; save is opt-in from the interface, accepts at most 200 messages/100 KB.
- `exportData()` returns all bounded Donna storage with provenance; if more than 1,000 records exist, it fails explicitly rather than calling a partial export complete.
- `deleteData('DELETE MY DONNA DATA')` deletes this owner's Donna records. The two table deletions are sequential, not transactional; a network failure may require retrying. Business data is never deleted by this method.

Browser storage failure falls back to an in-memory auth session only. No customer or financial data is cached by the adapter. The local disconnected workspace in the UI is separate from remote records and must never be described as current business data.

## Optional Pages gateway for native access

`functions/api/donna/[[path]].js` is a Cloudflare Pages Function, deployable only through an owner-approved staging/production change. Set production/staging environment variables `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` to the existing project's **public** connection settings. No service-role key is needed or accepted.

`GET /api/donna/{tool}` accepts `Authorization: Bearer <existing Supabase access token>`. `GET /api/donna/status` checks the session. `GET /api/donna/memories` returns confirmed memories only, omitting revision history. The gateway does not enable cross-origin browser access and sets `Cache-Control: no-store, private`. Native URLSession can use it with its Keychain-held token. Every non-GET request returns 405; unknown tools return 404. No privileged credential is forwarded or required. A deployment without gateway environment settings returns 503 rather than falling back to an unauthenticated provider. No gateway is deployed by this change.

## Read completeness and financial reliability

Each business table read is capped at 1,000 rows, in 100-row pages, ordered by ID with an exact PostgREST count. A response over 2 MB or a tool read over 8 MB fails explicitly. Memory lists exclude revision history; history is retrieved for one owner-scoped ID on demand. Full-memory exports use one-row pages and conversations use 10-row pages to keep temporary allocations bounded. At the cap, `complete:false` is returned if records remain. The `orders` tool merges actual `customer_orders` and `manual_business_orders` and includes `source_table` in each result. Customer orders have no due date column; no deadline is invented for them. Events are inventory event profiles, not a connected calendar. POS staging is not connected to the main inventory reader.

Financial answers require complete invoice and payment envelopes. Estimates, draft invoices, and void invoices are excluded from outstanding receivables. Invoice amounts and each matching payment are validated and computed in integer cents. Invalid monetary records produce an unavailable answer. This is an outstanding-invoice tool, not a complete profit, cashflow, tax, revenue, or accounting engine. Payment rows belong to invoices by `invoice_id`; order payments are a separate ledger and not included. Concurrent changes between paged requests can affect a snapshot; refresh before consequential decisions.

`calculatePricing()` requires explicit nonnegative actual per-unit costs for garment, transfer, labor, packaging, shipping, fixed fees, and overhead; enter `0` only when that cost actually is zero. Optional fee percentage applies to selling price, with cents rounding per unit. Quantity multiplies the entered unit estimate. The result separately exposes revenue, cost, profit estimate, margin on revenue, and markup on cost. Shipping and overhead must be allocated per unit by the owner. Missing costs, negative values, more than two decimal places, nonfinite values, and invalid quantities are rejected. Sales tax and uncertain costs are not invented.

Briefing dates use `America/New_York`, including DST. An invoice is overdue only after its recorded due date, while tasks and production orders due today are visible. Missing or truncated datasets are named in the briefing. Donna's text helper is a deterministic router, not an AI language model, and cannot provide unrestricted natural conversation or evaluate arbitrary business strategy.

## Donna database setup proposal

`donna/setup.sql` is a proposed additive schema, not a generated migration or an applied production change. Supabase CLI is absent in this workspace. Before adopting it, test the SQL in an isolated project/local database, run advisors and policy tests, generate a migration with the supported current CLI flow, then obtain owner approval for production application. It intentionally fails on already-existing Donna table names rather than silently accepting an incompatible schema.

The script adds only `donna_memories`, `donna_conversations`, their indexes, scoped policies, and two invoker trigger functions. Both tables require matching `owner_id = auth.uid()` **and** membership in the existing `admin_users` allowlist for all operations. No anon or public grants exist. Update policies have both `USING` and `WITH CHECK`. No user-editable JWT metadata, new definer functions, or privileged views are introduced. The trigger preserves ID/owner/creation time, creates server timestamps, preserves prior versions, and resets modified facts to pending. Clients cannot inject initial approval or invented revision history. Confirmation is a separate explicit update after reviewing a pending draft. Revision history retains the old fact and source and counts toward storage. After 100 versions, export and archive before creating a new memory. Delete removes the memory and its history; there is no hidden long-term copy in Donna's schema. Provider backups/retention remain governed by the existing service settings.

## Tests run

`node --test tests/donna*.test.mjs` passes 28 tests for money math, missing costs, Eastern dates, actual deadlines, missing/truncated ledgers, unavailable records, memory approval, immutable cost controls, unauthenticated/nonadmin denial, allowlisted reads, bounded pagination, owner scoping, data-deletion confirmation, oversized conversation rejection, gateway write denial, concurrent refresh serialization, late refresh rejection after sign-out, bounded payloads, and privacy-preserving usage counters, configured gateway read headers, and confirmed-only native memory retrieval. API tests use controlled fetch responses; they do not certify live owner credentials or live endpoint deployment.

`npm ci --prefix tests/sql --ignore-scripts --no-audit --no-fund && npm test --prefix tests/sql` executes the entire SQL proposal in pinned PGlite 0.5.16, a local PostgreSQL runtime. It passed schema/trigger execution, anonymous denial, nonadmin denial, isolation between two admins, history generation, renewed approval after correction, immutable owner identity, conversation isolation, and deletion. These tests use synthetic accounts/data and do not touch Supabase. Hosted PostgREST exposure, actual owner login, quotas, backups, and any staging/production deployment remain unverified.

Official references reviewed: [Supabase changelog](https://supabase.com/changelog), [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), [Data API security](https://supabase.com/docs/guides/api/securing-your-api), [Auth REST architecture](https://supabase.com/docs/guides/auth/architecture). Current changelog had CLI/Flutter breaking changes; neither is used at runtime. Any later schema rollout should recheck those docs.

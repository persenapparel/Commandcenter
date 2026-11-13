# Project Donna — repository and infrastructure audit

Audit date: November 12, 2026 (America/New_York). Database metadata was observed at approximately 02:49 UTC November 13.
Repository: `persenapparel/Commandcenter`.
Audited main commit: `65a2be00d18426cf2ab14c5c18fc5dbac50c252e`.
Development branch: `codex/project-donna-free-v1`.

## What was actually inspected

- Cloned the real GitHub repository and read its existing frontend, authentication, financial logic, inventory guides, and security headers.
- Queried catalog metadata, columns, CHECK constraints, table grants, RLS policies, and two authorization function definitions through the connected Supabase account.
- Read security advisor findings for the main project.
- Confirmed the separate POS staging project's public table names, key columns, RLS state, and relevant SELECT policies.
- No customer, order, invoice, payment, contact, session, or auth-user records were read.
- No hosted database, configuration, Cloudflare deployment, GitHub main branch, or active POS checkout was changed.

This is a source and metadata audit, not a claim that owner sign-in, production integrations, hardware, or iPhone behavior passed an end-to-end test.

## Existing application

The checkout is a buildless JavaScript owner portal with a small shared Supabase wrapper; it has no package manager or server framework in main. The app already uses the main Supabase project `icxeuhkqxxhdkfdappio` and a public publishable key in `config.js`. That key is intended for public clients; it is not a service-role credential.

Relevant sources:

- [backend.js](../../backend.js): initializes Supabase, calls `auth.getUser()`, and checks membership in `admin_users` by current user ID.
- [admin.js](../../admin.js): `init` and `refresh` gate the owner portal and load bounded sets of business records.
- [intelligence.js](../../intelligence.js): existing deterministic briefing and invoice balance logic.
- [inventory/QUICK-START.md](../../inventory/QUICK-START.md): production versus staging inventory distinction.
- [_headers](../../_headers): global security headers.
- [README.txt](../../README.txt): intended separate Cloudflare Pages owner portal.

The existing `index.html` loads `@supabase/supabase-js@2` from jsDelivr without an exact patch pin. Donna's new implementation should avoid adding an unpinned third-party runtime dependency. A broader existing-app dependency update is outside this additive feature.

## Authentication and database authorization

All **29 public tables in the main project** and all **15 public tables in POS staging** had RLS enabled. They do not force RLS for their table owner; production user requests must use the end-user token and must never use a service-role credential.

Verified main-project access:

| Object | Verified rule |
| --- | --- |
| `admin_users` | Authenticated user can SELECT only their own `user_id = auth.uid()` membership row. No INSERT/UPDATE/DELETE policy was present. |
| `business_tasks`, `stock_items`, `business_invoices`, `invoice_payments`, `manual_business_orders`, `customer_contacts`, `customer_activities` | SELECT requires `is_persen_admin()`. |
| `customer_orders`, `quote_requests` | SELECT permits the record's customer or `is_persen_admin()`. Donna must additionally require administrator membership to avoid presenting a customer session as owner access. |
| `invoice_agreements` | SELECT permits `is_persen_admin()` or a verified signed-in customer matching the invoice email. Only SELECT is granted to authenticated users; signing is mediated by existing RPCs. |
| `customer_order_payments` | Authenticated SELECT and INSERT grants; matching policies require `is_persen_admin()`. |

`public.is_persen_admin()` is STABLE, SECURITY DEFINER, has an empty `search_path`, and checks an existing `public.admin_users` row against `auth.uid()`. Anonymous EXECUTE is revoked; authenticated EXECUTE is allowed. It does not trust editable user metadata.

`public.persen_verified_invoice_customer(address text)` has the same search-path and execution restrictions. It checks the authenticated user's verified email in `auth.users`. Its source was inspected without selecting any auth-user rows.

Many older tables have broad grants (including DML) to `anon` and `authenticated`; their RLS policies are the effective row access boundary. This does **not** mean anonymous users can read every row. It does mean that Donna's read-only property cannot be inferred from the existing owner's database credential: its server must implement a fixed SELECT allowlist and reject arbitrary table names, RPC names, SQL, or write verbs. Forward the user's bearer token to Supabase, independently validate it, and confirm current admin membership. Never accept a client-supplied user ID as identity.

A separate Donna memory table should grant only the necessary operations, enable RLS, require both owner membership and record ownership, and reject reassignment on UPDATE. Do not reuse public `site_content` for private memory.

Official guidance reviewed: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [securing the Data API](https://supabase.com/docs/guides/api/securing-your-api).

## Verified schema for read-only tools

Use explicit field lists and bounded, deterministically ordered pages. Return the source table, fetch timestamp, and completeness/truncation status; an unloaded or failed table is not an empty business.

| Tool | Existing source | Important verified fields and limitations |
| --- | --- | --- |
| Priorities | `business_tasks` | `id,title,customer_name,priority,status,due_date,created_at,updated_at`. Priority: Normal, High, Urgent. Status: Open, In progress, Done. `due_date` is a nullable calendar date. |
| Customer orders | `customer_orders` | `id,title,status,fulfillment,order_source,item_size,item_quantity,item_subtotal,payment_status,customer_name,created_at,updated_at`. **There is no due_date column.** Do not fabricate an order deadline. |
| Manual orders | `manual_business_orders` | `id,title,customer_name,quantity,status,due_date,created_at,updated_at`. Keep its source ID distinct from customer orders. |
| Inventory | `stock_items` | `id,sku,product_id,product_name,color,size,quantity,reorder_at,updated_at`. Product name exists in the live main schema. Main quantities are distinct from staging POS quantities. |
| Invoices | `business_invoices` | `id,invoice_number,document_type,customer_name,total,status,due_date,created_at,updated_at`. Types: Invoice or Estimate; statuses: Draft, Sent, Paid, Void. Totals are numeric USD amounts, not cents. |
| Invoice payments | `invoice_payments` | `id,invoice_id,amount,received_on,created_at`. Amount is numeric USD, strictly positive. Do not confuse invoice totals with received cash. |
| Limited-order payments | `customer_order_payments` | `id,order_id,amount,received_on,created_at`. Separate ledger covering limited merchandise subtotal. Do not combine into invoice balances. |
| Agreements | `invoice_agreements` | `id,invoice_id,status,owner_signed_at,customer_signed_at,created_at` suffices for signature status. Do not fetch snapshots or signature identity fields unnecessarily. |
| Customer list | `customer_contacts` | `id,full_name,organization,updated_at` is enough for a summary; fetch phone/email only when a specific approved workflow needs them. |
| Quotes | `quote_requests` | `id,name,category,quantity,status,created_at,updated_at`. Avoid customer-provided `details` unless required. |
| Inventory events | `inventory_event_profiles` | `id,name,event_date,active,created_at,updated_at`. These are inventory event profiles, not a full calendar integration. |

Current production order statuses for both order tables are Received, Artwork review, Awaiting proof, Approved, In production, Ready for pickup, Shipped, Completed, Cancelled. Consider only Completed and Cancelled terminal unless a specific workflow defines otherwise.

## Financial and date correctness

Existing `admin.js:166` calculates invoice line totals in integer cents, then applies discount, shipping, and tax. Existing `intelligence.js` calculates outstanding invoice balance from `invoice_payments`. Donna should calculate from verified source values with decimal-to-integer-cent parsing and reject missing/invalid values.

- Outstanding invoice balance is invoice total minus that invoice's recorded payments, bounded below at zero. Exclude estimates and void invoices from receivables. Identify drafts separately.
- A paid label is not itself a new payment record.
- Monthly payment receipts are cash received within the selected month. They are not profit, and they do not establish earned revenue.
- Costs, payroll, labor, shipping, and event expenses are not a complete accounting ledger in this audited checkout. Profit requires actual supplied costs.
- Limited-order `item_subtotal` covers merchandise; the existing UI says extra taxes/shipping may require a separate signed invoice.
- Avoid double-counting invoice and limited-order sources. An invoice may reference another business workflow.
- `due_date` and `received_on` are date-only fields. Treat them as business calendar dates in America/New_York, not midnight UTC instants.
- The existing `intelligence.js` mixes local date extraction and UTC construction; Donna should use an explicit business timezone for day boundaries and test around midnight and DST. This audit does not modify the existing briefing.

## POS staging

Main project's inventory guide explicitly says staging and production **do not share quantities**. Connected project `naaqcspvbntzdtwuchrr` is named Persen POS Staging. It contains:

`admin_users, inventory_catalog, inventory_event_profiles, inventory_event_quick_products, pos_checkouts, pos_drawer_recounts, pos_events, pos_print_jobs, pos_receipt_delivery_jobs, pos_receipt_templates, pos_registers, pos_sales, pos_variant_details, site_content, stock_items`.

Verified staging rules:

- `pos_sales` and `pos_checkouts`: SELECT requires both `owner_id = auth.uid()` and `is_persen_admin()`.
- `pos_events`: SELECT requires admin; insert/update also constrain `owner_id`.
- `stock_items`, `inventory_catalog`, and `inventory_event_profiles`: administrator-only policies.
- POS financial values use explicit integer `*_cents` columns. This differs from main-project numeric dollar amounts.
- `pos_checkouts` contains draft/customer contact and in-progress state. Donna should not read it for sales analytics or modify it.
- Completed `pos_sales` provides `id,checkout_id,subtotal_cents,discount_cents,tax_cents,total_cents,payment_method,created_at,event_id`. No sale records were read during this audit.

Numerous POS branches exist, including `feature/persen-pos-foundation` and `audit/pos-staging-access-safety-20261112`. The presence of schema and branches is not release verification. Do not change POS credentials, checkout logic, register state, stock, or staging tables as part of Donna. POS integration remains disabled pending independent release and authentication tests.

## Security advisor observations

The main-project security advisor returned:

- One anonymous SECURITY DEFINER execution warning for `marketing_track_visit`.
- Fourteen authenticated SECURITY DEFINER execution warnings, including intentionally callable owner/customer operations and the inspected authorization helpers.
- Leaked-password protection disabled.

These are existing findings, not proof that every flagged function is exploitable. Only the two authorization helpers were reviewed in full here. Donna must not expose or invoke those existing business-write RPCs. Review each intended execution grant separately before broad security changes; do not revoke existing working APIs indiscriminately.

Remediation references: [anonymous SECURITY DEFINER execution](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated SECURITY DEFINER execution](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Availability and pricing of optional password features must be checked before activation; nothing was enabled.

## Cloudflare and microphone headers

No authenticated Cloudflare account/configuration tool is connected. Pages project settings, deployed branch, production environment values, usage, DNS, and access controls could not be verified from this environment. Repository documentation alone is not proof of deployed configuration.

The original global header denies microphone access. Cloudflare's official [Headers documentation](https://developers.cloudflare.com/pages/configuration/headers/) says matching duplicate header values are joined with commas. A narrower rule should follow the broad rule and **detach** `Permissions-Policy` before setting the Donna-specific value. Preserve microphone denial everywhere else. API responses generated by Pages Functions must set their own response security headers because the static `_headers` file does not apply to Functions.

Donna must not automatically start recording from a Siri URL: open voice mode, then require a user gesture and permission. Browser support, system Dictation, and Speech recognition behavior require actual iPhone testing.

## Compatibility and release gates

The Supabase changelog was fetched and scanned before implementation. Relevant current notices include [explicit Data API grants for new tables](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically) and [retired older TLS 1.2 CBC ciphers](https://supabase.com/changelog/cbc-tls-ciphers-deprecated). Donna should use supported modern HTTPS and declare grants explicitly. CLI changes matter if a future migration operator installs CLI v3; inspect its current help rather than reusing unverified commands.

Before production enablement:

1. Review the additive source change and pending Donna-only SQL in staging; never apply it silently to production.
2. Test anonymous, customer, removed-admin, and owner identities against each API and memory policy.
3. Verify explicit column selections against a staging copy and prove that row limits cannot produce false complete totals.
4. Check absence of business-write paths and paid-provider fallback.
5. Test Siri routes, microphone permission, playback, device authentication, and memory export/delete on the actual iPhone 16.
6. Review hosting plan and actual free-tier usage in the provider dashboards.
7. Obtain the owner's explicit approval before changing live production.

The audit establishes the integration plan and schema compatibility. End-to-end owner access, deployed headers, new memory RLS, and iPhone behavior remain unverified until those tests run.

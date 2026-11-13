# Real local Auth and PostgREST integration

The Donna API and unchanged `donna/setup.sql` were tested against disposable local PostgreSQL, Supabase Auth (GoTrue), and PostgREST containers. This complements the API fixtures and PGlite policy tests with actual HTTP login, JWT validation, REST permissions, and PostgreSQL trigger behavior. No hosted project, owner account, customer record, Cloudflare configuration, or provider billing setting was used or changed.

## Reproduce

Requirements: a running **local** Docker daemon accessible at `/var/run/docker.sock`, Node.js 22+ with built-in fetch, and permission to download official container images. No npm installation, paid service, Supabase CLI, cloud account, production key, or saved test credential is needed.

From the repository root:

```sh
node tests/local-backend/run.mjs
```

The runner selects the local Unix socket explicitly, ignoring any inherited remote Docker endpoint/context/TLS selector. It creates uniquely named `donna-qa-*` containers and a network, binds HTTP ports only to `127.0.0.1` on dynamically allocated ports, uses ephemeral PostgreSQL data, and cleans up its own containers/network in `finally`. It never stops unrelated containers. Generated passwords/JWT signing material and fake accounts live only for this test and are not printed. Email signup is auto-confirmed; no email, SMS, or OAuth provider is configured.

A forced process termination can interrupt cleanup. Inspect Docker and remove only the exact `donna-qa-<run-id>` resources from the interrupted run; never run a global prune or stop existing services.

## Versions and sources

The runner pins official images by immutable SHA-256 manifest digest:

| Service | Version |
| --- | --- |
| PostgreSQL | `postgres:17.7-alpine` |
| Supabase Auth | `supabase/gotrue:v2.197.0` |
| PostgREST | `postgrest/postgrest:v14.12` |

Exact digests are in `tests/local-backend/run.mjs`. This is a deliberately minimal test harness, not the full Supabase distribution or a replacement hosted environment. Current official self-hosting configuration and the [Supabase changelog](https://supabase.com/changelog.md) were checked before setup, including the [self-hosted Auth external-URL prefix change](https://supabase.com/changelog/47093-self-hosted-supabase-api-external-url-to-include-auth-v1). GoTrue configuration follows the [official Supabase Docker compose source](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml). The selected services use compatible baseline versions; the hosted project's exact patches, gateway, Auth configuration, and Data API settings remain separate staging checks.

## Scope

The runner creates a small test-only `admin_users` allowlist and `business_tasks` table, and a standard JWT-reading `auth.uid()` helper. Real GoTrue migrations create `auth.users`. It then executes the actual Donna SQL file without altering its table, policy, trigger, or grant statements. All names and business records are fictitious fixtures.

Donna's production client deliberately accepts only HTTPS Supabase project origins and publishable-key formats. The test therefore injects `fetchImpl`: it asserts one fixed synthetic project origin, then transports `/auth/v1/*` to the local Auth port and `/rest/v1/*` to the local PostgREST port. Request methods, authorization headers, filters, JSON payloads, and responses are real HTTP traffic. It does not fabricate Auth/REST responses or contact the synthetic DNS name. This transport adapter tests backend behavior, not production TLS, Cloudflare routing, browser CORS, or a real publishable-key API gateway.

## Verified results

**21 checks passed across 79 real local HTTP requests.** The integration checks exercise:

- Real fake-account signup, password login, `/user` verification, and owner-allowlist authorization.
- Authenticated task lookup through PostgREST and rejection of a signed-in non-admin.
- Memory creation as pending, explicit approval, persisted confirmation, and timestamp/version history.
- RLS isolation between two admin accounts, including a direct hostile owner-ID insert rejected with HTTP 403.
- Cross-owner update denial and stale-version rejection.
- Editing a confirmed fact returning it to pending through the actual PostgreSQL trigger.
- Conversation creation, metadata-only library listing, owner-scoped transcript retrieval, and cross-owner denial.
- Complete owner export and explicit Donna-only deletion while existing business fixtures remain intact.
- Anonymous direct REST denial and real Auth logout with local session removal.

The runner emits only pass/fail metadata, check names, service versions, and request counts. The managed environment, test runner, and all local services are independent of the main and POS staging Supabase projects. Hosted owner sign-in, actual deployment secrets, physical-device behavior, and production readiness are still unverified.

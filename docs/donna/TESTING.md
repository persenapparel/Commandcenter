# Donna verification

Development baseline: Command Center commit `65a2be00d18426cf2ab14c5c18fc5dbac50c252e`. Live database access during development was limited to schema, policies, authorization-function definitions, grants, and provider advisor metadata. No customer rows were needed and no hosted DDL/DML was executed.

## Reproducible automated checks

Run from the repository root:

```sh
node --test tests/donna-core.test.mjs tests/donna-api.test.mjs tests/donna-staging.test.mjs
cd tests/sql
npm ci
npm test
```

In a separate shell from the repository root:

```sh
cd tests/dom
npm ci
npm test
```

Dependencies are pinned and lockfiles committed. These are local development-only dependencies; production web files have no npm build step. The DOM runner uses Node's experimental VM-module flag, which produces an expected warning.

### Results

- **36 Node core/API/gateway checks pass.** Exact cents; invalid/missing costs; negative profit; date boundaries in America/New_York; partial-ledger refusal; empty/failed queries; unauthenticated/non-admin denial; fixed read allowlist; no business writes; explicit memory approval; bounded export/delete; configured gateway reads/no-store; confirmed-only native memories; refresh-token concurrency and logout races.
- **17 DOM integration checks pass.** All documented views; calculator; missing-cost error; session teaching approval/correction/history/outdated/delete; two-turn conversational teaching; owner-scoped memory envelope; conversation create-then-update; session task completion; event calendar-file export; speech fallback; safe text rendering; explicit account-data deletion; logout cleanup despite a failed logout request and a late business response.
- **SQL policy/version checks pass locally using PGlite PostgreSQL.** Full proposed setup executed; anonymous/non-admin denial; cross-owner admin isolation; immutable ownership; pending-first insert; version history; editing resets approval; conversation isolation and deletion. PGlite is not the hosted Supabase Auth/PostgREST stack.
- **6 isolated-staging checks pass.** Only Donna assets ship; production/POS configs, secrets, existing website code, and overwrite/symlink destinations are rejected; exact file hashes recorded.
- **21 real local integration checks pass across 79 HTTP requests.** Disposable PostgreSQL17.7 + GoTrue2.197.0 + PostgREST14.12 verified actual Auth, REST, RLS, history, transcript library, owner isolation, export/delete/logout. All test containers were removed; see [LOCAL-BACKEND-QA.md](LOCAL-BACKEND-QA.md).
- **28 deployed-preview HTTP checks pass.** Document/module integrity, effective scoped microphone/CSP/no-store headers, unchanged dashboard microphone denial/config, and gateway denial/no-store behavior. No owner sign-in or customer data was used.
- **Native baseline build and Siri metadata packaging pass.** [GitHub run](https://github.com/persenapparel/Commandcenter/actions/runs/43358668136) built unsigned with Xcode26.6/iOS26.5 simulator SDK, archived English App Intents metadata, and passed the emitted-error gate. No actual Siri, speech, Apple Intelligence, signing, or iPhone execution was tested.
- JavaScript syntax, native Info.plist, and web manifest parsing pass.

Reproduce real local Auth/REST QA with `node tests/local-backend/run.mjs` (local Docker required). For a deployed version, run `python3 scripts/donna-preview-check.py --url https://YOUR-PREVIEW/donna/ --commit EXACT_40_CHARACTER_DEPLOYED_SHA`. This checks committed bytes at that exact deployment, ignoring unfinished working-tree edits. It never signs in or sends business data. Native CI evidence and free-runner guards are in [NATIVE-CI.md](NATIVE-CI.md).

See source tests for assertions. Fake fixtures exist only in tests; no fictional sales are presented by the app and no private customer data is shipped.

## Verification limits

The managed Sites environment has no `cua_repl.js` browser-control tool, so its prescribed browser QA path is unavailable. No alternative rendered browser or local preview server was used. The existing Cloudflare branch preview was checked over HTTP. DOM tests do not verify rendered layout, Safari, microphone permissions, system voice playback, or real device behavior. CSS includes responsive layouts, scrolling navigation, dark mode, and reduced-motion handling, but visual acceptance remains unverified.

The following remain required before production:

1. On an approved staging host, verify `/donna/` assets, CSP, no-store, and microphone header detachment. Check existing Command Center/storefront behavior is unaffected. Verify all non-GET gateway methods deny and missing gateway configuration returns 503.
2. With separate authorized/unauthorized **test** accounts, test the actual Supabase Auth session, admin allowlist, PostgREST grants, every relevant RLS policy, and expiry/revocation behavior. An owner access token retains its pre-existing Command Center permissions; read-only behavior is enforced by Donna's tool/gateway surface.
3. After approved staging schema setup, teach → draft → inspect source/timestamp → approve → retrieve → correct → reapprove → inspect history → export → delete. Repeat as another admin and confirm isolation. Test max-size/history limits and stale-version rejection.
4. Compare a controlled test set of invoices and complete payment ledger with known balances. Test empty, partial (>1,000 rows), unavailable, over-limit, and malformed responses. Do not label invoice totals as collected revenue or profit.
5. On the owner's iPhone 16 with iOS 27.0.1, test Safari/Home Screen at portrait/landscape, navigation, keyboard, reduced motion, light/dark theme, and screen reader focus. Test each Siri shortcut locked/unlocked and confirm no recording starts on launch.
6. Test speech consent/denial, unavailable API/local recognition, transcript review before send, speech cancellation, voice selection persistence, switching apps, and privacy settings. Browser speech can use a platform service; local-only speech requires the native availability checks.
7. On a compatible Mac with stable Xcode 27, build/sign/install the native source for the actual phone and perform the NATIVE.md tests. Record `.availability`, actual model/language readiness, offline operation, context limits, tool errors, prompt-injection examples, lock/snapshot privacy, and seven-day personal provisioning behavior.
8. Check provider billing plans and aggregate existing usage. Verify quota errors stop the feature, no paid/cloud fallback exists, no schedule/notification is active, and no call/send/write operation is available.

No production deployment, hosted schema application, automatic notifications, paid API fallback, email send, purchase, or customer call has been performed.

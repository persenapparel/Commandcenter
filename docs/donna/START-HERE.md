# Donna — first free development version

Donna is now an additive implementation in the existing Command Center repository. A working branch preview is available; this is not an installed iPhone app or a production rollout. The owner reports an iPhone 16 running iOS 27.0.1; no update is required solely for Donna's baseline APIs.

## What changed

- `donna/`: responsive web workspace, deterministic conversations, two-turn teaching drafts with explicit memory approval, private memory client, pricing, business records, morning briefing, session task/event planning, system speech controls, and all six Siri launch routes.
- `functions/api/donna/[[path]].js`: optional authenticated, fixed-route, GET-only business gateway for the native app. Web requests use existing Supabase REST with the signed-in owner token and RLS.
- `donna/setup.sql`: **unapplied** proposal for Donna-only memory/conversation tables with owner-and-admin RLS, timestamps, version history, size limits, and pending-first approval.
- `native/Donna/`: SwiftUI source for Apple's on-device model, local-only Speech when supported, Keychain login, privacy lock, and foreground Siri App Intents. Unsigned simulator compilation and Siri metadata packaging pass; physical-device signing and testing remain required.
- `tests/`, `docs/donna/`: automated checks, the metadata audit, setup, costs, and actual limitations.
- `_headers`: the only modified pre-existing file. A new `/donna/*` block detaches and resets the microphone policy for Donna, adds no-store and a restricted CSP. The existing global denial and all existing application screens are unchanged. Cloudflare documents the detach syntax in its [headers guide](https://developers.cloudflare.com/pages/configuration/headers/).

The storefront, Command Center JavaScript, inventory/POS code, production database, and external communications have not been changed. No provider plan or paid service has been activated. Nothing has been merged to main or deployed to the production website. The existing Cloudflare integration automatically publishes the isolated branch as a preview.

## Try the branch preview

Open **https://codex-project-donna-free-v1.commandcenter-4yg.pages.dev/donna/** on the iPhone. This is an automatically generated Cloudflare **branch preview**, not the production custom domain. The preview contains the repository's current public configuration; owner sign-in enables read-only business reads. No owner records were read during automated preview checks.

The preview passed document/asset integrity, effective microphone/CSP/no-store headers, unchanged dashboard microphone denial, and unauthenticated gateway-denial checks. It has not been visually accepted in Safari. See [STAGING.md](STAGING.md) to generate a disconnected Donna-only bundle that excludes the existing website and refuses the main/POS database addresses.

For a possible no-Mac on-device AI option now, open the preview’s **Settings → Donna Private Chat** guide, or read [Donna Private Chat](ON-DEVICE-SHORTCUT.md). This uses Apple's **Use Model → On-Device** action in Shortcuts and does not connect to business records or memory. It still needs to be assembled and checked on the owner's phone.

## Try the web version locally

From the repository root, serve static files using a development server, for example:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/donna/`. Do not open `index.html` directly as `file://`, because browsers restrict module loading. Stop the server with Ctrl-C. This command is a local development option, not a deployment or a step already run by this task.

Without signing in, use Pricing & profit, practice conversational teaching, review memory approval/versioning, and plan session tasks/events. These practice records stay in this browser tab. They are not a secure permanent knowledge store; avoid private customer information. Appearance/voice preferences persist locally. There is no service worker or offline business-record cache.

Selecting “Connect Command Center” signs in with the existing owner account and verifies `admin_users`. This performs live **read-only** business queries against the configured main project. No actual owner sign-in or customer-record query was performed during development. Missing tables, expired authentication, denied permissions, partial reads, and provider limits are surfaced instead of substituted with fictional data.

Persistent memory/conversations cannot work on the configured hosted project until the reviewed Donna schema has been applied with owner approval. A missing schema is reported in the interface. Signed-in conversation content is not saved in the practice-session cache. Authorized conversations are stored in the proposed private tables; export/delete are available when that backend is installed.

## Review before any hosted use

1. Review [AUDIT.md](AUDIT.md) and [BACKEND.md](BACKEND.md). Existing owner credentials retain the permissions they already have in Command Center; Donna's code/gateway restricts the exposed business actions to reads. This is not a newly scoped database read-only token.
2. Choose an isolated **staging** host and an appropriate test database without real customer data. Do not repurpose the active POS staging database or create a billable branch/project. Existing account plans and capacity must be checked first.
3. Review and test `donna/setup.sql` on that isolated database. It creates two Donna tables; it does not alter current business tables. This task already tested it locally against a PostgreSQL-compatible engine, not hosted Supabase.
4. Approve exact staging configuration and publish only that staging version. Set the existing URL/public key in `config.js`; for the optional gateway set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in the host. Never use a secret/service-role key. Preserve the `/donna/` path for all documented shortcuts.
5. Run the owner/non-owner, RLS, device, privacy, quota, and failure checks in [TESTING.md](TESTING.md). Verify Cloudflare's effective headers. Native requests need the gateway; a simple Python server does not execute Pages Functions.
6. Use [SETUP-AND-COSTS.md](SETUP-AND-COSTS.md) for the six iPhone shortcuts and the published free-tier limits. Nothing can install those shortcuts on the phone from this Linux workspace.
7. Use [NATIVE.md](NATIVE.md) and `native/Donna/README.md` on a compatible Mac to build, sign, and test the native app with the iPhone. Apple Intelligence readiness must be checked on that device.

Production rollout remains a separate owner-approved step after staging acceptance. The existing Cloudflare integration did create a preview on branch push; no GitHub/Cloudflare account or production setting was changed. Its separate Workers build check already failed on the original main commit and reports a missing Worker for Donna; the Pages preview succeeds. No replacement Worker was created.

## Actual feature status

“Implemented and tested” below means the named automated/local checks passed. It does not imply physical iPhone, hosted Supabase, or production acceptance.

| Deliverable | Actual status | Evidence / remaining limitation |
| --- | --- | --- |
| Web interface | Implemented and tested | DOM navigation, teaching, conversation library, and privacy flows pass; visual browser/iPhone layout unverified. |
| Secure business backend | Implemented and tested | API/gateway allowlist/auth/error tests; hosted endpoint undeployed. |
| Conversational Teach Donna | Implemented and tested | Two-turn draft preparation, review, approval, correction, history; no generative web model. |
| Persistent editable memory | Implemented but unverified on hosted Supabase | Local SQL tests and real disposable Auth/PostgREST/PostgreSQL integration pass. Hosted schema not applied. Disconnected practice is session-only. |
| Read-only Command Center integration | Implemented but unverified with owner records | Actual schema/permissions audited; no private business rows queried. |
| Siri setup instructions | Implemented but unverified on iPhone | Six URL routes and native intents; user must create/test shortcuts. |
| Native iPhone AI | Implemented but unverified | SwiftUI source compiles for the unsigned baseline simulator and packages Siri metadata; signing and iPhone/model evaluation remain unverified. See NATIVE-CI.md. |
| Voice input and spoken output | Implemented but unverified on iPhone | Browser APIs/fallbacks and native local-only Speech source; no continuous background listening. |
| Business dashboard and briefing | Implemented and tested | Rules use actual-field fixtures and Eastern dates; live completeness depends on authenticated reads. |
| Pricing and profit assistant | Implemented and tested | Explicit per-unit costs, integer cents, fees, margin/markup distinction, loss warning. |
| Tasks and events | Implemented and tested | Session planning, completion, `.ics` export and read-only business/profile reads; phone calendar sync not started. |
| Security controls | Implemented and tested locally | Owner/non-owner denial, cross-owner RLS, approval/versioning, escape rendering, sign-out races, bounded responses. Existing provider advisor findings documented, not changed. |
| Testing documentation | Implemented and tested | Unit, DOM, staging isolation, real local backend, preview HTTP, and native compile evidence in TESTING.md. |
| Costs and limitations | Implemented and verified against public documentation | Target $0 additional monthly costs; actual account plans, usage and remaining quotas unverified. |
| Future client calling | Plan implemented; calling not started | Calling, sending, purchases, and business writes disabled. No telephony service activated. |

The web version provides useful deterministic tools. Open-ended on-device AI is a native feature pending Mac/iPhone testing. Email/calendar account connections, autonomous marketing, POS transaction integration, scheduled delivery, and customer calls are not implemented or activated.

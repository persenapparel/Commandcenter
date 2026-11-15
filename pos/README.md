# Persen POS — separate Cloudflare Pages application in the Commandcenter repository

**Status: development branch only. Not deployed, not approved for real customer checkout.**

> **November 13, 2026 Epson staging direction:** PR #45 supplies an isolated Windows Epson TM-T20IV ESC/POS service and drawer queue. PR #46 replaces the active NELKO browser station UI with an owner-only **read-only Epson Print Center** in Laptop Back Office (`admin.html#print-center`). Legacy NELKO explanations below describe historical development, **not the Epson staging print path**. The back-office webpage cannot run the Windows service, confirm printing, or open a physical drawer. See `pos/epson-station/START-HERE.md`. Neither staging PR is production-deployed or hardware-verified.


Architecture: reuse the existing `persenapparel/Commandcenter` GitHub repository, deploy its POS module as a **separate Cloudflare Pages project**, and reuse the existing Supabase database. No new GitHub repository is necessary.

- `pos/register.html`: responsive mobile/laptop owner cashier login, actual inventory search by size/color, quick-add, service classification, discounts, tax setting, cash confirmation, receipt template editor, live customer status, and event manager.
- `pos/display.html`: customer iPad checkout display, required phone, optional email, and exactly three **optional** questions: explicit promotional-text consent, private 1–5 satisfaction rating, and need for custom apparel. 1.8-second status polling means no refresh is required.
- `pos/pos-core.js`: shared, unit-tested cart totals, discount, tax, phone and seasonal utilities.
- `pos/pos-events.js`: pure event/service sales reporting with gross merchandise totals, discounts, taxes, collected revenue, sales count, units, private average rating, opt-ins and custom-apparel leads.
- `pos/tests.cjs`: reproducible calculation, consent/reporting, and event isolation tests (`node pos/tests.cjs`).
- `pos/pos-schema-review.sql`: proposed database tables, RLS and atomic cash settlement functions, event records, private customer survey snapshots, plus an owner-authenticated receipt print queue. **NOT APPLIED**. Security review and abuse prevention required before deployment.
- `pos/index.html`: original standalone, fake-data design preview, deliberately not a live checkout.
- `pos/build-pages.mjs`: separate build target; copies the POS into `pos-dist` and rewrites shared script paths without modifying Commandcenter files.

## Separate Cloudflare Pages deployment (after review)

1. Use GitHub repository `persenapparel/Commandcenter` and a POS-specific Cloudflare Pages project.
2. Build command: `node pos/build-pages.mjs`.
3. Build output directory: `pos-dist`.
4. First deploy the `feature/persen-pos-foundation` branch to a **private/staging** preview only; no production sales.
5. After SQL/security reviews and payment testing, connect `pos.persenapparel.com` (correct spelling), enable HTTPS, and protect the cashier page with authentication.
6. Confirm that the POS site `/register.html` and `/display.html` load correctly. Root redirects to `/register.html`.
7. The database migration is not yet installed. Until then, login/register actions referencing `pos_*` tables/functions will fail; this is intentional.

## Security and business blockers before real use

- Add **short-lived, rate-limited pairing**: current proposed database register secret is long-lived and must not be exposed to arbitrary devices. Do not deploy the anonymous display functions without server-side abuse limits and token rotation.
- The POS schema needs SQL syntax, authorization, concurrency, idempotency, and database integration tests. Test customer polling/reconnect, checkout cancellation, duplicate attempts, and out-of-stock rejection with two cashiers.
- Receipt templates are editable; the transaction snapshot and financial totals are immutable. Reprints must always use the stored sale, not the current cart.
- Only cash is implemented in the proposed schema; card, Apple Pay, Venmo and payment-reader flows are disabled until an authorized processor confirms funds. A merchant account may require an adult account holder.
- Confirm the correct tax rate and product taxability with the business's responsible adult/accountant before use; the register starts at 0% as a safe, explicit unconfigured value.
- The 58 mm CSS layout is untested with physical printer hardware. The NELKO PL70 may not support continuous non-adhesive receipt rolls; verify before buying paper.
- Event manager shows a walk-in bucket and saved past events. Every sale is attributed to an event at checkout; service subtotals are **gross before discounts/tax**, while collected sales totals include discount and tax. For large history, reporting must be paginated beyond the initial 2,000 transaction query.
- Survey ratings are private operational feedback, **not public reviews**. Marketing consent is recorded as a separate optional choice, but **not yet synchronized with Resend or SMS subscribers**. Only send promotional communications after proper opt-in and verified integration; do not merge contact capture with consent.
- Seasonal Studio `site_content.seasonal_campaigns_v1` is read-only in the POS. Avoid overwriting campaigns from the POS.
- Do not store sensitive card numbers, card tokens, or merchant secrets in browser storage or public JavaScript.

## Current verification

JavaScript syntax verified for `pos-core.js`, `register.js`, `display.js` and the demo `pos.js`. Ten POS unit tests passed (discounts, tax, phone, rating validation, event/service totals, and event isolation). File presence verified on GitHub. **No end-to-end live database tests, no real payments, no Cloudflare deployment, no physical printer testing.**

## Existing integration points

`stock_items` includes `id,sku,product_name,color,size,quantity,reorder_at`; `admin_users` is the owner allowlist; `site_content.seasonal_campaigns_v1` holds Seasonal Studio campaign metadata. Current production records remain unchanged.

## Seasonal Studio, customer thanks, Google reviews, and quicker printing (current draft)

- Customer-facing iPad display loads the **published active** seasonal campaign from the existing `site_content.seasonal_campaigns_v1` record. It displays the campaign title/announcement without giving the public customer access to any owner permissions.
- Cashier uses the same active seasonal campaign to decorate its receipt promotions; unconfigured, unpublished and out-of-date campaigns are skipped.
- Printed receipts contain saved-sale totals and itemization, explicit **THANK YOU FOR YOUR ORDER**, an optional owner-edited promotion, a Google-review invitation, the website and Instagram, and the existing Google Business review URL from `site_content.v54_google_reviews`. The link is validated to be HTTPS on Google's own domains; actual QR generation is **not implemented yet**.
- Receipt templates now include `review_message`, `show_review` and `show_seasonal` in the **draft, unapplied** schema. Existing template editing UI reads and writes these options when the reviewed schema is installed.
- Cashier queues every paid sale to a single authenticated print station, avoiding a second automatic print from the cashier device. The cashier retains a manual print option. Browser-based silent printing requires testing the separately configured Chrome `--kiosk-printing` shortcut on a USB-connected Windows computer.
- Cashier CSS handles iPad **portrait** with a spacious single-column layout and **landscape** with multiple checkout panels, plus phone and laptop layouts. The Event Manager is collapsed by default for quick event checkouts.
- Full printing workflow and PL70E compatibility cautions: see `pos/PRINTING-AND-DEVICE-PLAN.md`.

**Status reminder:** all of the above is saved only to this GitHub development branch. The POS database migration is not applied, the site is not deployed, and actual live payment/auto-print reliability is not validated.

## NELKO automatic print-station work

- `pos/print-station.html`, `pos/print-station.css`, `pos/print-station.js`: separate owner-authenticated station page for an existing Windows Dell/other USB-connected computer, with arm/pause, test print, 2×4 inch label and experimental 58 mm paper profiles, print queue polling, last job status, and manual retry after checking paper.
- `pos_print_jobs` is created at the same time as a sale in the **draft** SQL migration. The print worker uses owner-authorized RPC claim/finish/retry, preventing competing workers from claiming one queued receipt. Status `submitted_to_browser` **does not mean hardware confirmed printing**.
- This model needs no recurring printing cloud service; the Chrome kiosk flag might permit silent printing on Windows with the NELKO set as the default printer. Exact hardware/driver tests are mandatory.
- Cloudflare build includes `print-station.html` and supporting assets. **No deployment or database schema changes have been made.**
- Refer to `pos/PRINTING-AND-DEVICE-PLAN.md` for setup and paper compatibility cautions. An exact model label/photo will resolve whether this is PL70 or PL70E.

## Advanced cash checkout and cash drawer (November 4, 2026 development)

- `pos/pos-cash.js` is the pure, 26-test-compatible cash planner. Counts $100, $50, $20, $10, $5, $1, quarters, dimes, nickels and pennies. Searches for a valid exact-change breakdown with backtracking instead of falsely assuming a greedy first choice always works.
- Cashier has a premium blue cash terminal with quick **+ bill** buttons, exact/change clear, direct cash received amount, real-time change due, colored status, suggested change denominations, and safe disabled confirmation for underpayment or when exact change is unavailable.
- Cash can be counted while the customer is finishing the iPad questionnaire, but the cashier cannot settle until the iPad customer contact status is complete.
- Register drawer settings are **explicit counted values**, stored with a version number and owner-only cash-drawer RPC. All manual recounts are logged in `pos_drawer_recounts` for financial traceability.
- The **unapplied draft** `pos_complete_cash` server function independently validates tendered cash, known bill breakdown, the latest register float and exact change before recording a paid sale, updating the drawer balance and queueing a receipt atomically. If a manually typed cash amount has unknown bill denominations, the system does **not** pretend to know which notes were added; the float remains conservative until a recount.
- Printed receipts now show cash tendered and change returned from the server-saved sale record.
- `.github/workflows/pos-tests.yml` runs offline Node unit tests, JavaScript syntax checks and the isolated POS static build for development branch pushes/PRs.
- **No production database changes**, payments, Cloudflare deployment, or physical cash/receipt-printer testing have been performed as part of this coding work.

### Remaining blockers
Review and integration-test the SQL carefully with staged Supabase auth/RLS, high-value cash, stale drawer version conflicts and simultaneous cashiers. Confirm price-list support and taxes before taking real money. Verify iPad portrait/landscape touch layouts on actual devices. Install printer driver and test automatic printing with the NELKO; automated browser print requests are not evidence of printed paper.

## November 4 follow-up audit — IMPORTANT DEPLOYMENT BLOCKER

The live Supabase project's public schema was inspected using a read-only information_schema query. **Only stock_items exists; no pos_* tables are deployed.** The fast cash cashier currently calls `pos_set_cash_drawer` and a three-argument `pos_complete_cash` that are **not yet present in the baseline SQL draft**. The earlier experimental SQL edits were found malformed and reverted; the baseline SQL was restored and its print-function dollar quoting corrected. Do **not** apply the baseline SQL expecting the cash terminal to work. A clean, staged and reviewed migration must add the drawer columns, audit history, tender/change sale fields, and matching transactional cash RPCs before live testing.

The POS GitHub Actions checks cover static builds and unit tests only. No real iPad, NELKO printer, checkout database writes or payment processing was performed. Keep the project private/development-only until staging integration tests and security review pass.

## November 4, 2026 — Two-iPad + digital receipt + seasonal polish

- Cashier iPad (portrait or landscape), separate customer iPad, Dell USB NELKO station and manually counted cash box are documented in `EVENT-SETUP-AND-LAUNCH.md`.
- Customer iPad now shows **cash** as the only recordable payment method. It can display Venmo **@persenapparel** and Apple Cash contact **(631) 644-0633** as *instructions only*, with clear warnings: no automatic payment, verification, or sale settlement. Apple Cash via Messages is not Apple Pay merchant checkout. Any Venmo business use must be through an eligible approved account with adult oversight where needed.
- Customer receipt options: **Printed (default)**, **Email**, or **Both (print + email)**. SMS receipts are deliberately not offered. A required phone number is entered with a large on-screen 10-digit keypad (no iPad keyboard); a separate email step collects optional contact email or requires it when an emailed receipt is chosen.
- Draft SQL `pos_receipt_delivery_jobs` stores a pending email job only for customers who requested email or both. Printed jobs queue only when selected. No text-receipt jobs can be created.
- `pos-digital-receipt.js`: sanitized HTML email receipt. Legacy SMS copy code is not reachable from the checkout.
- `supabase/functions/pos-receipt-email/index.ts`: un-deployed, server-secret-only Resend mailer draft with idempotency keys. Requires code/security review, verified sender domain, separate transactional Resend key, owner-approved schedule and end-to-end delivery tests; no messages have been sent.
- `pos-experience.js`: Seasonal Studio accent colors, small thematic icons, and subtle seasonal Easter eggs with reduced-motion support; only published, active campaigns are used.
- Customer iPad UI redesigned with touch-friendly receipt cards and payment-information tiles. POS CSS includes a more spacious portrait checkout and wide landscape layout.
- Staged SQL cash register/settlement draft was reconciled to the current cashier RPC: it now validates received cash, a change-payout breakdown, and drawer version **on the server**. No production database migration was executed; SQL still requires actual database integration testing.
- Automated CI runs an isolated static POS build, JS syntax checks and offline unit tests. This cannot verify real device pairing, electronic payments, Resend delivery, or NELKO paper printing.

## Customer iPad step-by-step checkout (newest development version)

- Customer display has **eight distinct screens**, rather than one lengthy form: **Phone → Receipt choice → Email → Payment information → Promotional opt-in → Private rating → Custom apparel interest → Final review**. Each optional question gets its own page with Back/Continue buttons, a progress bar and accessible labels.
- The phone page has an on-screen 1–9/0 dialer with Clear and Backspace. Its readonly display prevents the iPad software keyboard from appearing for phone entry. Currently designed for 10-digit U.S. phone numbers; international entry needs a future extension.
- Receipt choices are exactly **Printed**, **Email**, **Both**. There is **no SMS receipt option**. Email collection remains separate from marketing consent; a valid email is required only if the customer wants email or both. Phone remains required for the order.
- Cash is the only method the server draft can record as paid. Venmo and Apple Cash choices still show information only; selecting them does not settle an order.
- The three optional questions for promotions, experience rating and custom apparel are shown individually, can be skipped, and never turn consent on by default.
- When the next checkout appears on the paired customer display, the wizard resets, avoiding the previous customer's contact information lingering on screen.
- The SQL draft was updated to remove SMS receipt fields, parameters and jobs; this is **unapplied** and requires staged database security testing.

## Cashier live customer checkout assistance (November 2026 update)

- The customer iPad reports its **current wizard screen** (e.g., “Your email address”, Step 3/8), overall progress and a customer-triggered **Need help from your cashier?** flag. Updates are stored on the pending checkout by `pos_set_customer_progress` in the **unapplied SQL draft** and read through owner-restricted `pos_checkouts` in the cashier UI approximately every 1.8 seconds, with a Realtime subscription where enabled.
- **No typing surveillance:** number-pad digits, email drafts, individual survey answers, and customer text are never sent with interim progress updates. The cashier sees only the current step number/name and the help flag; all customer details are submitted only at final checkout and governed by owner RLS.
- Help request is a simple toggle. The customer iPad confirms they have asked for help; cashier sees a prominent amber assistance alert. Cashier may help in person and the customer can cancel the alert.
- The customer payment step displays **Venmo @persenapparel** and **Apple Cash via Messages (631) 644-0633** as reference information only. The cashier has the same details in a dedicated reference panel with copy controls. **Apple Cash is not Apple Pay merchant processing**, and neither method can be marked paid automatically without an approved, provider-verified integration. The parent/guardian or authorized merchant owner should verify account eligibility.
- The cashier includes a Dell/NELKO print-station guide. Dell stays plugged in, awake, USB-connected to the NELKO and signed into Chrome Print Station; the print queue is consumed after a verified cash sale. Browser kiosk-printing and supported paper still require physical validation.
- **Security gate:** the current customer pairing is a persistent register secret and the draft progress RPC can be accessed by possession of that secret. It must be replaced or protected with short-lived pairing, rate limiting, session authorization and abuse testing before public deployment.
- 52 pure unit tests and 19 kiosk/cashier structural checks pass in offline evaluation. Staged Supabase integration, customer iPad hardware, payment providers and printing remain untested.

## November 4, 2026 — POS admin workflow update (draft branch)

- Cashier Event Manager now has an **edit / close event** form, retaining historical sale event IDs. Corrected the event-date validation regex so valid YYYY-MM-DD dates can be created.
- Cashier Inventory now has a **new product variant** form for name, unique SKU, category, product type, color, size, per-variant quantity, price, reorder threshold, supplier, description and taxability. Each color/size is entered as its own SKU. Stock creation and POS price metadata are saved separately; best-effort rollback is attempted on metadata failure, but this is **not atomic** and requires staged concurrency/error testing.
- The draft adds owner-only **pos_variant_details** with price_cents, taxable, category, product_type and description. This avoids assuming stock_items has a selling-price column. When metadata is missing, cashier price remains editable at checkout; DO NOT treat missing metadata as a verified product price.
- The **new variant form and full POS are not operational** until the reviewed SQL is applied to a staging environment. No production Supabase migration was applied.
- Fixed a malformed SQL dollar-quoted progress function. CI includes JS syntax checks, unit tests, isolated Pages build, and the existing SQL draft validator; these are offline checks, not physical-device or database-integration certification.
- The current anonymous customer pairing secret is persistent and exposes checkout metadata. **Block public staging/production until short-lived token pairing and abuse controls are implemented**. Protect any staging site with Cloudflare Access and test accounts; do not publish real customer information.
- Print jobs are marked submitted to Chrome, **not physically printed**. Verify NELKO paper, Windows driver, Chrome printing, and recovery/retry on the actual Dell before using at an event. Printed/Email/Both are the supported receipt preferences, not SMS; email delivery needs a tested sender integration.
- Safe next step: deploy a separate access-restricted Cloudflare Pages preview with build command `node pos/build-pages.mjs`, output `pos-dist`, and a staging database. Do not map `pos.persenapparel.com` until all blocking security and hardware tests pass.


## Single swivel iPad mode (November 13, 2026 staging proposal)

**Staging PR only. Not merged, deployed or authorized for customer sales.**

The default cashier layout is now **one iPad on a swivel stand**. A two-iPad pairing mode is retained as an optional backup. The register builds and validates the cart as before; the `Hand to Customer` action creates a 2-hour pairing token via the existing staging RPC, begins the existing pending checkout, and opens the existing limited-access customer wizard in a full-screen same-origin iframe. The customer's phone, receipt preference, email and optional questions use the unchanged backend. If pairing fails, no checkout is started. The full-screen overlay makes the underlying cashier controls inert; returning to owner mode requires **online Supabase owner email/password authentication** and an admin check, not merely tapping Back.

1. On iPad: open the protected staging site, sign into the register, pick **One swivel iPad**, and open the register. Scan/select your merchandise; check sizes and totals.
2. Tap **Hand to Customer**, rotate the iPad toward the shopper, have them complete the guided questions and return the iPad to you.
3. Tap **Cashier only · Return to register**, enter the **Command Center account password** and verify. This is slower than a dedicated server-verified cashier PIN but is a safer interim test approach than an unprotected exit.
4. Confirm cash physically received, check change, save the sale, give change and receipt, then **Finish Order**. Epson print/drawer processing remains on the separate Windows agent and must be verified on the hardware.
5. If the browser is refreshed during a pending customer checkout, sign back in and use **Return to Customer Checkout** to issue a new short-lived pairing token and resume the open checkout. Do not begin a duplicate sale.

**Security boundaries:** The overlay is **not a hardened OS-level kiosk**. Browser navigation, device multitasking, same-origin access, iframe isolation, session sharing and lost/stolen iPad scenarios still require a threat model and physical testing. Use iPad Guided Access as an additional operational guard, and never leave the signed-in iPad unattended with customers. The customer iframe shares the browser origin with the cashier login. Cloudflare access controls, owner authentication, proper RLS, rate-limited pairing, access reviews and server-side totals remain necessary.

**Not included:** no physical iPad, scanner, drawer or Epson validation; no fresh deployment; no changed receipt count, signature capture, customer email delivery, tax policy or payment processor. The existing Epson station draft is still text-oriented and requires printer/dual-receipt and rich-logo acceptance tests. Don't run the retired NELKO worker alongside Epson. No production Supabase keys or schema changes are part of this swivel PR.

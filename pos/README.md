# Persen POS — separate Cloudflare Pages application in the Commandcenter repository

**Status: development branch only. Not deployed, not approved for real customer checkout.**

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

# Persen POS — research session 3: checkout architecture and staging diagnosis
Date: 2026-11-11. Scope: research only; no production changes.

## Observed source (branch feature/persen-pos-foundation)
- `pos/register.html` includes launch, event manager, toolbar, product catalog, cart, checkout, and other controls in one document. Existing `register.js` changes `body.dataset.cashierStage` through `syncCashierStage()`; screen separation depends on CSS and hidden attributes rather than distinct route/page shells.
- `pos/checkout-flow.js` defines cashier stages catalog/customer/payment/external/handoff. `cashierStage()` returns catalog if no checkout, customer for awaiting_customer, payment for cash contact_received, external for noncash, handoff for completed with cash_handoff_complete=false.
- `pos/display.js` includes welcome/reset and customer step-by-step display. `checkout-flow.js` currently requires a ten-digit phone at the first step and has eight customer steps; receipt email validation depends on selected receipt type.
- `pos/build-pages.mjs` copies HTML/CSS/JS into `pos-dist` and writes `deployment.json` with `CF_PAGES_COMMIT_SHA` if available. It rejects production Supabase URL and requires the staging project and publishable key outside CI dry-run.
- `pos/CLOUDFLARE-PAGES-STAGING-REDEPLOY.md` specifies Cloudflare project `persen-pos-staging`, branch `feature/persen-pos-foundation`, build `node pos/build-pages.mjs`, output `pos-dist`.

## Square documented patterns (research, not copied design)
- Square lets sellers configure available payment methods and their order: https://squareup.com/help/us/en/article/6389-manage-payment-types-with-the-square-app
- Receipt screen can be skipped for faster checkout, and receipt settings are device-local: https://squareup.com/help/us/en/article/8669-manage-receipt-settings-on-square-point-of-sale
- Printed/email receipts occur after a recorded payment: https://api.squareup.com/help/us/en/article/6139-print-receipts
- Product/category quick-access, itemized cart, and separate customer-facing display are described here: https://squareup.com/ca/en/point-of-sale/features

## Intended Persen flow: explicit view states
**Cashier:** Locked/Launch -> Event & products -> Catalog/cart -> Customer review (optional) -> Tender -> Cash received & change -> Finish Order -> New sale. Noncash external methods must be explicitly marked *instructions only*, never auto-confirmed as paid.
**Customer iPad:** Private paired idle welcome -> itemized order/total -> optional contact/receipt/consent -> payment waiting -> change/thank-you -> automatically sanitized welcome. Never expose previous customer contact on idle.
**Back office:** event setup, product/size stock, receipts, sales reporting, questionnaire results with consent restrictions. Do not crowd these into the cashier checkout.
**Printer:** print only after sale is completed; compact dynamic-height receipt with print preview; NELKO continuous-roll feed length requires separate driver/device validation. Do not equate successful browser rendering with paper-feed fix.

## Concrete redesign implementation sequence
1. Create a dedicated cashier application shell: one active full-screen pane per stage. Move event manager, product creation, reports and admin links to separate setup/back-office screens. Use explicit `data-cashier-stage` selectors and JS stage assertion; remove competing `hidden`/CSS rules that leave panels visible.
2. Make catalog touch-friendly: category tiles, grouped product -> color -> size picker, stock quantity, cart, checkout CTA. Preserve per-variant inventory records.
3. Create cashier payment pane with cash amount received, preset bill buttons, validated change, and explicit **Finish Order** that cannot occur until successful server record and physical handoff. Avoid auto-clearing before finish; retry must not double-record.
4. Simplify customer steps: make phone optional unless required for selected receipt; marketing opt-in explicit, default off; custom-apparel interest and rating optional/post-sale. Keep receipt delivery choice and consent separate.
5. Ensure `pos_customer_view`, `pos_submit_customer_v2`, `pos_finish_order` and related RPC contracts match deployed staging DB; test data isolation and recovery after refresh/network interruption.
6. Validate receipt and print station; add test receipt width/length preview, no automatic repeated prints, and printer error feedback.

## Deployment diagnosis: mandatory evidence before declaring success
- Read live staging `/deployment.json` and compare its commit with GitHub branch HEAD. A null commit means build metadata unavailable, *not* proof of match.
- Confirm exact Pages project, branch, build command, root and output folder; distinguish branch-preview URL from Pages production alias and from any custom `pos.persenapparel.com` DNS.
- Compare served `register.html`, `register.js`, `pos.css` against expected version (hashes or unique version marker); inspect cache headers and service worker registrations. Force refresh only after verifying deployment target.
- Run browser checks on iPad portrait and landscape, desktop cashier, and separate customer display. Verify actual visible stages, not just DOM or unit tests.
- Run test cash sale using *staging-only synthetic inventory*; assert exact change, persisted state, one-time recording, inventory decrement once, receipt output, customer screen reset, and no personal-data leak.
- Do not modify production DNS, production database, real inventory, live payments, or merge to main without explicit approval.

## Acceptance criteria
A cashier can complete a synthetic sale without encountering the event manager or admin tools in the checkout pane. Each stage has one clear primary action. Customer iPad shows only its own state and returns to a sanitized welcome. Cashier sees and confirms change before finishing. Server persists one payment and one stock decrement, and recovery does not duplicate. The deployed SHA and browser behavior are verified on the staging hostname.

## Current verification status / blockers
Source review completed; official Square documentation reviewed. **Live Cloudflare project/URL, deployed SHA, actual iPad rendering, staging DB RPC compatibility, and NELKO output are not verified in this session.** This document is a plan, not a claim of a deployed fix.

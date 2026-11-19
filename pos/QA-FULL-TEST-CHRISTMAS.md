# Persen Apparel POS — Christmas Edition full-test runbook
**Environment:** STAGING ONLY — Supabase `naaqcspvbntzdtwuchrr` / protected Cloudflare Pages cashier `persen-pos-staging` plus isolated customer origin.
**Source:** The premium theme from PR #226 plus official brand-logo PR #227.
**Status at creation (November 19, 2026):** Visual code integrated; CI must pass; staged Supabase authorization release audit has five BLOCKED checks; no hosted checkout or Epson printer/drawer test has passed. **Not yet approved for real customers.**

## Release gates (all required, in order)
- [ ] Merge/rebase the reviewed premium Christmas and logo commits into ONE **staging-only** release branch. Do not merge into production Command Center or the public customer website.
- [ ] Require green `POS draft checks` and `Persen POS development checks` on the exact final commit.
- [ ] Confirm local build has the official logo on cashier, employee Home, dashboard, Inventory, Back Office, staff-test, and customer guest. Guest logo PNG SHA-256 must match the source asset; guest must not bundle cashier credentials/config.
- [ ] Review and install the approved **staging** badge migration chain in `pos/sql/STAGING-RELEASE-MIGRATION-ORDER.md`, using a coordinated compatible cashier build. Apply to *naaqcspvbntzdtwuchrr only*. Preserve fail-closed authorization and verify every function signature, grants and rollback plan.
- [ ] Run `pos/sql/staging_release_readiness_audit.sql` read-only on staging: require **zero BLOCKED rows**. Separately review the security advisor for existing anonymous-callable SECURITY DEFINER guest RPCs and ensure each endpoint authenticates an appropriate checkout capability.
- [ ] Configure Cloudflare `persen-pos-staging` with publishable **staging** key only, exact source commit, verified isolated guest origin and secure staging access. Build cashier and customer origins independently and verify CSP, CORS, cross-origin frame isolation and no-store on protected HTML.
- [ ] Open the actual hosted iPad Pro 11-inch POS; visually inspect holiday artwork, official Persen logo, text contrast and barcode focus in landscape and portrait. No external assets, clipped UI, scrolling checkout or overlays blocking controls.
- [ ] Successfully execute the following *two different simulated cash sales*, with no actual money.

## Sale 1 — single-iPad complete customer handoff
1. As staging owner, authenticate to cashier and open the test register.
2. Employee 1 scans their unique badge and enters their own PIN **once at start of shift**. Employee Home must say `Hello, [first name]!` and display Sales, Returns, Refunds, Inventory Check. Unavailable actions must not create transactions.
3. Select Inventory Check and scan a size-specific barcode. Correct quantity/size is shown, and the cart remains unchanged. Return Home without breaking the session.
4. Select Sales and scan a real *test product* barcode twice. Quantity becomes 2. Unknown barcode shows a clear Product Not Found state; a different size barcode resolves a different stock variant.
5. Confirm accurate subtotal and cart; no manual price changes without owner authorization.
6. Tap **Hand to Customer** and turn the same iPad. The cashier session and employee details must be completely invisible to the customer; the isolated customer origin loads.
7. Customer sees their total, then individual phone-number keypad step, then email step, then payment options. Only supported and approved payment choices can proceed. For this test, select **Cash**.
8. Turn the iPad back; employee must verify with badge when requested. Enter received cash, confirm correct change. Check that the **Epson drawer open command** is queued only after authorized cash confirmation, never earlier.
9. Complete **Finish Order** once. Sale persists, stock decrements exactly once, receipt data associates the correct employee, no duplicate payment or drawer job, and the register locks.
10. The customer screen must clear its data after completion; don't expose a previous customer's phone, email or checkout.

## Sale 2 — immediately after first sale
1. Scan the **same employee badge** for the between-sale badge-only unlock, without unnecessarily requiring shift PIN again. Owner must not see a stale customer session.
2. Return to Employee Home, select Sales, and scan a *different* product/size barcode.
3. Use a different test phone/email and another simulated cash amount. Finish the entire one-iPad total → phone → email → payment → cashier verification → Finish Order sequence.
4. Confirm separate sale IDs, correct inventory movement, correct change, no reused customer capability, no duplicate drawer/print jobs. The register must lock again.

## Negative and authorization tests
- [ ] Idle 30 seconds: lock the register. Correct badge resumes; incorrect or revoked badge fails. Never display PIN or badge secrets.
- [ ] Two employees (Colleen and Logan) have unique badges/PINs, only their authorized register; no email account required for owner-paired badges.
- [ ] Refunded or returned items require owner/authorized-manager permissions; cashier cannot bypass approval. Until implemented, buttons remain explicitly disabled with no sale data changed.
- [ ] Cancel an unpaid test sale: no cash payment, drawer opening, customer data leak or stock decrement.
- [ ] Venmo/Apple Cash: drawer does **not** open. Do not claim confirmed external payment without verified owner approval. Hidden/unapproved payment options remain unavailable.
- [ ] Concurrent taps/reloads/failed network must not double-charge or reopen drawer.
- [ ] Every checkout includes a single successful authorized paid completion and a single post-sale register lock.

## Epson print and drawer (physical sign-off; Windows station only)
- [ ] Epson TM-T20IV with 80mm paper connects to Windows print service, prints correctly and cuts. **No NELKO**.
- [ ] Two intended receipt copies are produced without accidental duplicates; employee name and transaction details correct.
- [ ] Only the cash payment path opens the electronic drawer via compatible Epson connection, once and only once per eligible sale.
- [ ] Venmo/other non-cash, cancellations, incomplete payment, reprint and page refresh never pop open the drawer.
- [ ] Owner-authorized manual drawer-open functionality is restricted and logged, if enabled.
- [ ] Printer offline/error does not falsely claim physical printing or payment success.

## Christmas theme visual sign-off
- [ ] Official Persen logo PNG is visible and sharp on cashier, dashboard, employee Home, Inventory, badge test and guest checkout.
- [ ] Santa with gifts, reindeer and snowy village display from **same-origin local assets**, including iPad portrait and landscape.
- [ ] Evergreen/red/gold panels preserve sufficient contrast and tap target size; focus visibly indicates the scanner/search field.
- [ ] Reduced-motion, forced-colors and short-screen layouts remain usable; no decoration intercepts taps.
- [ ] When holiday mode is off, core checkout and authentication remain unchanged.

**Launch decision:** This runbook is not a pass certificate. Customer-ready requires the full deployment gates, real hosted two-sale demonstration and Epson drawer/receipt sign-off; otherwise mark **STAGING TEST ONLY / NOT CUSTOMER READY**.

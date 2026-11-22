# Persen Apparel POS — controlled live-customer release (November 22, 2026)

## Current decision
Prepare **sales-only live mode** for the existing one-swivel-iPad workflow.
Keep **returns, refunds and equal-value exchanges unavailable** until supervised
tests confirm stock and financial reconciliation. This is NOT permission to bypass
employee authentication, RLS, owner approval, short-lived guest capabilities,
cash accounting, limits on stock/amounts, receipt idempotency or payment verification.

**This branch is a release review, not a deployment.** No real customer
transactions, production domain settings, or Supabase rows have been changed.

## What has been verified
- Owner reports their physical sales/printing/drawer flow is working. This was
  user-tested, not independently observed from an actual iPad or Windows printer.
- The dedicated Supabase project `naaqcspvbntzdtwuchrr` is separate from the
  existing business website database `icxeuhkqxxhdkfdappio`. Do not repoint the
  POS to the website database.
- Read-only `pos/sql/live_sales_release_audit_20261122.sql` confirms the
  core staff/cash/finish/external-payment/guest-handoff function signatures
  and required RLS settings. The isolated guest worker functions are
  service-role only.
- **Blocking finding:** Five legacy customer RPCs remain anonymously executable:
  `pos_customer_cart_preview`, `pos_customer_view`,
  `pos_set_customer_progress`, `pos_submit_customer` and
  `pos_submit_customer_v2`. These legacy functions appear in the older
  `pos/display.js` two-device route. The new isolated guest worker uses
  `pos_handoff_guest_view` and `pos_handoff_guest_submit`.
- The manual adjustment ledger/function exists in the database, but real-device
  return/refund/exchange effects are not verified.

## Release steps — required before showing LIVE SALES
1. Confirm which Pages project, branch, and exact deployed revision serve
   `pos.persenapparel.com`. Verify HTTPS, Cloudflare Access on both cashier
   hostnames, and the guest origin's separate security boundary. A configured
   URL is not evidence of a safe deployment.
2. Replace the legacy `display.html` fallback in the *live build only* with
   a clear retired-route message. Check that the one-iPad guest frame still
   loads and that the older `display.js` is never used in the live workflow.
3. Revoke anonymous EXECUTE on the five old customer RPCs **only after** the
   retired-route change and isolated one-iPad checkout are tested. Keep the
   modern guest worker behind its checkout token, TTL and rate limiting.
   Rerun the read-only audit; **zero BLOCKED rows** is required.
4. Freeze/backup the dedicated POS database, preserve test sales as historical
   records, establish a clear live-sale start marker, and verify that stock,
   quantities, saved selling prices, tax settings, cash drawer starting counts
   and receipt sequences are correct. Do not delete historical test rows.
5. Recheck a no-money customer walkthrough on the actual iPad and Epson
   Windows station. Verify unlocked sale -> customer total -> contact -> cash or
   externally verified payment -> Finish Order -> one customer and one merchant
   copy -> cash drawer only when authorized -> badge lock. Verify no duplicate
   payment or receipt after a refresh/network interruption.
6. Review payment-provider account eligibility with the responsible adult
   account holder where required. Venmo/Apple Cash are **not** automatic
   provider-confirmed payments; retain explicit independent owner verification.
   The live settings must not claim an unconnected payment method is processed.
7. Use a reviewed live release deployment, turn on truthful `LIVE SALES`
   wording only after all gates pass, and confirm deployed commit/domain from
   an actual browser. Keep the Command Center and customer website untouched.

## Manual adjustments — NOT a sales-launch dependency
- Refund: locate completed sale, verify original payment and refundable balance,
  record **one** refund idempotently, ensure actual transfer/cash reimbursement
  is separately confirmed, and check cash totals.
- Return: locate sale, record accepted merchandise, confirm no automatic
  restocking without an explicit inventory decision.
- Exchange: swap only eligible equal-value items, block duplicate exchanges,
  verify original/replacement stock changes and receipt audit trail.
- Test failed, cancelled and duplicate submissions for each. Only after those
  supervised tests pass should owner-only buttons be wired/enabled.

## Important
The release is NOT live just because the branch or SQL audit exists. Do not
remove staging restrictions in `pos/build-pages.mjs` or `pos/guest-checkout-worker.mjs`
by replacing project IDs or deleting safety checks. A verified, controlled
release mode must be introduced after the preceding blockers are resolved.

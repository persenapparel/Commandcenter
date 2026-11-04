# Persen POS — foundation preview (NOT production-ready)

This branch contains a standalone cashier/iPad/receipt **UI preview** at `/pos/`. It does **not** communicate with Supabase, process payment, persist customer data, or deduct live inventory. Sample inventory is clearly marked as demo. Do not use it to collect real customer payments.

## Verified existing integration points
- `stock_items`: `id,sku,product_name,product_id,color,size,quantity,reorder_at`. Inventory has separate size/color variants.
- `admin_users` is the existing owner allowlist; maintain RLS for any future POS tables.
- `site_content.seasonal_campaigns_v1` is the existing Seasonal Studio JSON source. Read-only POS styling should use the same `PersenSeasonal.active`/theme logic; never overwrite public seasonal data.
- Existing `payment_receipts` is for invoices/customer orders. POS should use a separate immutable transaction record with adjustable *templates*, not editable historical payment facts.

## Next implementation (before public use)
1. Implement a reviewed SQL migration for `pos_sessions`, `pos_sales`, receipt templates, and atomic server-side inventory settlement; prohibit double selling/duplicate payment settlement.
2. Use short-lived, single-session pairing codes with rate limits and explicit owner approval. Do not expose customer phone/email in public Realtime payloads. Ensure a customer can see only their own session, and rotate/revoke pairing credentials.
3. Subscribe via Supabase Realtime for laptop and iPad with reconnect/resync and stale-state warnings. Do not rely on refresh.
4. Add payment integration only through a verified provider with authorized merchant onboarding. Do not treat customer-selected Apple Pay, Venmo, or card as confirmation. Cash requires owner confirmation. Keep POS cashier and customer display permissions separate.
5. Read/write live `stock_items` and test atomic stock decrement with competing concurrent checkouts, out-of-stock rejection, and idempotency. Support quick-add untracked products.
6. Receipt Studio: branded templates, rotating promotion/QR code, 58 mm print CSS, printed invoice/transaction ID, and reprint without changing sale facts. Test NELKO PL70 paper handling and print driver: continuous non-adhesive rolls are not confirmed.
7. Validate sales tax setup, discounts, refund/void flows, phone capture, optional email, explicit marketing opt-in, customer privacy and retention.
8. Cloudflare Pages: create separate project from reviewed POS build; attach `pos.persenapparel.com` custom domain (correct spelling); configure HTTPS and correct DNS. Never publish demo UI as real checkout.
9. Run automated JS/SQL tests, manual iPad+computer two-device tests, RLS penetration tests and printer test before merge.

## Current preview checks
- Sample product search, add/remove, quantity and percentage discount are client-side only.
- Customer phone is required in the demo; email is optional and marketing consent unchecked.
- Apple Pay/card/Venmo are disabled, preventing fake payment confirmation.
- 58 mm thermal receipt uses `@page`/print CSS; browser and printer support need physical testing.
- No production configuration or deployment was changed.

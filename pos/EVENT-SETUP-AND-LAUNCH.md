# Persen POS — two-iPad event setup and launch checklist

**Status: staged design and code only. This is not a live checkout. No production database migration, payment provider integration, SMS service, or NELKO hardware test has been performed.**

## Hardware you already own

- iPad 1: owner-signed-in cashier screen at `/register.html`, landscape for wider 3-panel checkout, portrait for a comfortable stacked layout.
- iPad 2: dedicated customer screen at `/display.html`, privately paired to the correct register. Never sign into the owner account on the customer iPad.
- Dell Windows laptop: leave plugged in, awake and connected to the internet. Connect NELKO by USB and open `/print-station.html` in separately configured Chrome.
- NELKO: test direct-thermal media feeding, width, driver, tear edge and any silent-print Chrome kiosk flag before actual events.
- Cash box: count your starting float and enter denomination quantities in the cashier's "Cash drawer setup" panel. Not an electronic cash drawer; no powered opening mechanism is assumed.

## Opening checklist

1. Sign in, select the event, confirm POS inventory and configured prices and verify taxes.
2. Count $100, $50, $20, $10, $5, $1, quarters, dimes, nickels, pennies in the cash box. Save the drawer count. The POS uses only counted denominations to verify exact change.
3. Pair customer iPad to the correct register; verify total and a test session without taking real money.
4. Check whether an active, published Seasonal Studio campaign is shown. The customer iPad and cashier get subtle theme colors and small holiday icons; unpublished campaigns have no effect.
5. Open the Dell print-station page, log in, confirm paper profile, test the NELKO, then arm it. Printed receipts are created only for completed transactions that request print.
6. Check receipt branding: thank-you, Persen website and Instagram, honest Google review invitation, and optional seasonal promotion.

## Fast checkout design

1. Cashier selects product, size/color, quantity; confirms discount, optional custom services and event association.
2. Customer iPad sees the total and enters phone (required) and optionally email. Receipt choice defaults to **printed**, with optional **email** and **text** preferences. The receipt choices are distinct from optional promotional opt-in.
3. Customer may choose **Cash**, **Venmo information**, or **Apple Cash information**.
   - Cash: customer gives the cashier money; the cashier taps bills or the amount received. The POS calculates change and disables completion if the counted drawer cannot provide exact change. Once verified, the server must record the sale, deduct stock, update float and enqueue a paper receipt atomically.
   - Venmo: customer screen can show **@persenapparel** as information only. No funds are verified by the POS. Do not use a teen account as an unauthorized business merchant account; confirm an eligible, approved business payment setup with a parent/guardian and provider first.
   - Apple Cash: customer screen can show **(631) 644-0633** as an Apple Cash via Messages contact, **not Apple Pay merchant checkout**. The POS cannot verify funds. The cashier must confirm eligibility and the registered recipient separately. No simulated paid status is allowed.
4. The three customer questions — separate marketing opt-in, 1–5 private feedback, custom apparel interest — remain optional and do not block purchase.
5. After a saved cash sale, the customer iPad says thank you, the print station consumes the print job, and the cashier is ready for another sale. A printed receipt may be torn off the NELKO manually.

## Digital receipts — what is implemented vs. not connected

- **Printed:** Current draft print station and server queue, not deployed or physically tested.
- **Email:** Customer choice, draft per-sale delivery job table, one-time email HTML template and un-deployed server-only Resend mailer in `supabase/functions/pos-receipt-email/index.ts`. Secret keys must be set on Supabase, never in website JavaScript. Worker needs code/security review, authorized cron invocation, a verified sending domain and an end-to-end test before email sending is enabled.
- **Text:** Customer choice, sanitized SMS receipt copy and pending server job record. There is **no SMS provider configured**. SMS delivery must not be described as active or sent until a legitimate provider, sender identity, opt-out/compliance setup and test exist. Receipt messages are transactional and independent from marketing consent.
- **Reprint:** Cashier can manually print saved sale; the operator should check paper first to avoid duplicates.
- **Marketing:** Must never be turned on simply because someone requested a receipt. Only explicit customer preference may authorize promotions.

## Seasonal Studio integration

POS reads `site_content.seasonal_campaigns_v1` and selects one active, published campaign. The new `pos-experience.js` maps common themes (Christmas, winter, Thanksgiving, Halloween, Valentine's, spring, summer) to subtle colors and decorative icons. Text is inserted with `textContent`, untrusted theme colors are validated, and optional animations respect reduced-motion settings. Never apply Seasonal Studio pricing discounts without an explicitly approved POS pricing rule.

## Remaining release blockers (do not skip)

- Database SQL draft has not been applied. Audit all checkout, cash drawer, print-queue and digital receipt schemas/functions together; verify the final RPC signatures match the browser code and that the SQL passes staging tests.
- Harden public customer pairing: short-lived rotating tokens, rate limits, device permissions and customer data isolation.
- Verify real tax rates, product prices, inventory update concurrency, duplicate submissions and cash drawer version conflicts.
- Electronic methods are information-only, not payment integrations. Any future settlement needs approved merchant accounts, provider transaction verification and refunds/reconciliation.
- Deploy only to a private staged POS Pages project until hardware, security, mail provider and full checkout tests pass.

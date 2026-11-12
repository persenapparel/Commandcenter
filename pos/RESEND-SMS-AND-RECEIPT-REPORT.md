# Persen Apparel — Receipt Branding, Existing Phone Number & Resend Expansion
**Prepared November 4, 2026. Development design only; no live sending or billing changes.**

## Recommendation
- Keep the existing Persen Apparel number for customer calls and Apple Cash contact details **only if the authorized account holder and provider confirm this use is permitted**. Apple Cash via Messages is *not* Apple Pay merchant checkout and the POS cannot confirm transfers.
- For automatic receipts by text, use a **dedicated business SMS sender** from a provider such as Twilio. For a U.S. 10-digit number, register the appropriate A2P 10DLC business and message use case; a parent/guardian or eligible adult may need to manage provider accounts.
- Do not attempt to spoof the existing business number as the sender or move a working mobile number without an explicit carrier/provider migration plan.
- Keep **Resend** for email (not SMS). Send transactional receipts from an authorized verified domain, e.g. `receipts@persenapparel.com`, using a separate server-only API key and an email-only receipt worker.
- Maintain marketing campaigns separately, with voluntary opt-in and unsubscribe handling. A purchase receipt is not consent for advertisements.

## Using your own existing phone number for automatic texts
Twilio's official Porting and Hosting documentation: https://www.twilio.com/docs/numbers-and-senders/port-host
Twilio Hosted Numbers FAQ: https://www.twilio.com/docs/phone-numbers/hosted-numbers
U.S. A2P 10DLC overview: https://www.twilio.com/docs/messaging/compliance/a2p-10dlc

- **Porting:** May work for an eligible existing number, but transfers control of voice and messaging to Twilio, which can interrupt the previous carrier relationship.
- **Hosting:** Potentially preserves voice with the original provider, but Twilio documents that mobile numbers are NOT eligible for its legacy Hosted Number product and it is not presently intended for new customers. Eligibility depends on provider and number type.
- **Recommendation:** Do not move or disconnect the existing phone. Start a separate business text number and show "Persen Apparel" in the body of every transactional receipt. If a number is eligible for hosting and the provider officially supports it, assess later.
- **Before sending:** Validate sender authorization, message consent and applicable opt-out requirements, complete carrier registration, test delivery and failure statuses.

## Resend enhancements

Official docs: https://resend.com/ and https://resend.com/changelog
Current platform uses the Emails API for transactional emails and Broadcasts for marketing. Resend handles email sending, not programmable SMS.

| Feature | Planned from POS / Command Center | Safe trigger |
| --- | --- | --- |
| Purchase receipt | Branded logo, saved sale, seasonal theme, review link | After confirmed paid sale; email requested |
| Estimate ready | Customer can access estimate in account | Estimate saved and visible to authorized customer |
| Artwork approval needed | Customer signoff link | Owner marks proof ready |
| Order confirmed | Summary and order lookup | Approved order creation |
| Order status | In production / ready for pickup | Real owner-controlled status change |
| Agreement signed | Copies and timestamp | Both signatures saved |
| Support updates | Reply instructions | Support ticket changed |
| Marketing campaign | Separate promotional list | Explicit opt-in only |

### Email sender configuration after approval

1. Keep the verified `persenapparel.com` sending domain in Resend, or verify it if not already verified.
2. Create a dedicated sending-only transactional API key and name it clearly (for example `POS Receipts`). Keep the existing marketing key isolated.
3. In the Supabase Edge Function's server-side secrets, configure:
   - `RESEND_TRANSACTIONAL_API_KEY` (private)
   - `RESEND_RECEIPTS_FROM` (authorized branded sender; e.g. `Persen Apparel <receipts@persenapparel.com>`)
   - `POS_RECEIPT_WORKER_SECRET` (private high-entropy value)
   - `POS_RECEIPT_LOGO_URL` (verified HTTPS URL to the logo image on a Persen Apparel domain)
   - Existing Supabase URL/service key managed only in Edge Function secrets.
4. Deploy the reviewed `supabase/functions/pos-receipt-email/index.ts` in a staging project, and invoke it only from a trusted scheduler/worker (never from browser code). Run dry-run tests in a non-live account, verify legitimate delivery, then enable small production volumes.
5. Add verified Resend delivery, bounce, complaint, and suppression webhook handling. Webhooks must verify signatures and avoid leaking customer contact data.
6. Show delivery state in Command Center: queued, accepted, delivered, bounced, failed, and manual resend where appropriate. Never show a message as delivered just because the API accepted it.

### Costs and limits
Consult https://resend.com/pricing for current limits and pricing. Free transactional tiers were advertised with 3,000 emails/month and a 100/day cap in November 2026; always check the account's actual plan. SMS sender numbers, campaign registration and per-message charges are **separate costs** and are not included in Resend.

## Seasonal and logo receipts
- **Printed NELKO receipt:** existing repo asset `assets/persen-logo.png` in black-and-white (grayscale) plus small monochrome Seasonal Studio heading, transaction facts, thanks, review link and website.
- **Email receipt:** same logo via a **public verified HTTPS logo URL**, season name/banner and approved accent color, full itemization, taxes, totals, honest Google review invitation and website.
- **Text receipt:** one compact transactional message with business name, amount and receipt identifier. Do not send visual logos or promotional offers in unrequested SMS.
- For tax/payment integrity, a receipt's item prices and totals come from the immutable completed sale, never from an editable marketing template.

## Current implementation status
- GitHub branch: `feature/persen-pos-foundation`; draft PR #4; separate Cloudflare Pages build target.
- Logo copied by the Pages build from the known existing Command Center repo asset.
- Printed and emailed seasonal copy prepared with safe defaults and no images downloaded from third parties.
- Email sender source is a **not-deployed draft**; SMS sending is **not connected**.
- Supabase POS schema is a reviewed **draft only** and the POS is not ready to accept live payments.
- NELKO receipt paper, image contrast, printed size and Google review QR behavior need physical tests.

Keep the original production Command Center and customer website untouched until staging tests and operator acceptance are complete.

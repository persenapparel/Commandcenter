# POS final audit — 2026-11-04

## Verified GitHub evidence
Development branch: `feature/persen-pos-foundation`; draft PR #4; audited head `79ee06d70881e2e3fe5e14e0ba868bec33ec4c16`.

- POS development checks run 41881349243: **success**, including JS syntax, unit tests, Dell print-station simulation, customer wizard/no-SMS check, SQL draft structure, disposable PostgreSQL 17 migration and cash/stock/receipt integration, and isolated Pages build.
- POS draft checks run 41881349482: **success** (syntax, unit, structural, isolated build).
- SQL log confirms cash sale $25.00, $40.00 tender, $15.00 change; stock decremented, print and email jobs queued, print job claimed only once, idempotent retry, closed-event rejection, underpayment and impossible-change rejection, anonymous sale read denied.
- This is a disposable PostgreSQL test using mocked Supabase auth context, **not a full hosted Supabase auth/RLS security test**.
- No confirmed code regression was found in these runs; do not make cosmetic changes without device-based comparison.

## Not verified / release blockers
1. No real NELKO print output, receipt roll compatibility or silent-print success; `window.print()` is not physical-print confirmation.
2. No private Cloudflare deployment, real two-iPad pairing, real owner login or actual Supabase staging test.
3. Long-lived customer display secret and public SECURITY DEFINER endpoints need short-lived pairing, throttling and independent security review.
4. Email worker is not deployed, Resend sender and delivery/webhook not tested. Venmo/Apple Cash tiles are instructions only, not payments.
5. Pricing, sales tax, concurrent cashiers, browser reconnect and printer outage/retry still require acceptance tests. Do not run real sales yet.

## Owner's short setup sequence
1. Confirm the exact NELKO model on its label. Install that model's official Windows driver on Dell, use manufacturer-supported direct-thermal media, set printer default and print a Windows test page.
2. Verify a free isolated Supabase test project is available before creating one. Do not apply the draft SQL to production or copy live customer data. Obtain a security-reviewed staging migration first.
3. Create a separate Cloudflare Pages POS staging project from this branch: build `node pos/build-pages.mjs`, output `pos-dist`. Apply Cloudflare Access to **all** staging hostnames, including root pages.dev, before sharing; verify signed-out denial.
4. Configure staging browser app with only isolated Supabase URL and publishable key, never service_role or Resend secret. Test owner sign-in.
5. Open `/register.html` on cashier iPad and `/display.html` on customer iPad. Test totals, variant stock, event, contact, optional consent, and print/email/both without real money.
6. Open `/print-station.html` on Dell, print test label, then launch dedicated Chrome `--kiosk-printing` shortcut and confirm physical print with no dialog. Only then arm queue; verify no duplicate after one simulated cash sale.
7. Verify receipt layout/size, seasonal decorations and correct customer contact handling. Separately review transactional Resend worker and verified sender before enabling email receipts.

**Do not merge PR #4, change DNS, deploy to production or collect customer payments until blockers are cleared.**

# Persen POS — Private Staging and Dell/NELKO Acceptance Checklist
**Development branch:** `feature/persen-pos-foundation` (draft PR #4). This is NOT permission to take real money.

## Verified status (November 4, 2026)
- Latest *pre-integration* GitHub POS workflows passed offline JS/syntax/build checks.
- The new `pos-tests.yml` workflow has been extended with **disposable PostgreSQL 17** migration + checkout tests. Check its latest run result before using this plan; queued is not passed.
- The production Supabase project has **no `pos_%` tables**. The SQL file is a draft; the new schema has **not** been deployed.
- Browser/Cashier, Customer Display, and Dell Print Station files are implemented in GitHub; they are not a tested live POS.
- No Cloudflare deployment access or Dell USB device access is connected in this conversation.

## Private stage (NOT a public POS release)
1. **Check for fees before provisioning Supabase:** a *separate* free Supabase project may be available if the account has a free slot. Supabase preview branches can incur compute charges. Do not create a paid branch or project without confirming pricing.
2. Create an isolated test database with **no live customer records or marketing keys**. Only after the disposable PostgreSQL test passes, audit the draft SQL, fix customer-pairing security and apply it to the isolated test database. Do not apply `sql-integration-bootstrap.sql` to any user project: it's for disposable CI only.
3. In Cloudflare Pages choose a **separate staging Pages project** connected to `persenapparel/Commandcenter` on the development branch. Build command: `node pos/build-pages.mjs`. Output: `pos-dist`. The root path `/` now shows three device cards; other pages are `/register.html`, `/display.html`, and `/print-station.html`.
4. **Restrict staging with Cloudflare Access** before making it available: Pages preview deployments are public by default; enabling preview-only Access does NOT protect the top-level `*.pages.dev` production domain or any custom domain automatically. Verify access restrictions on **every** Pages hostname, including the root hostname, with a signed-out browser.
5. Configure the POS staging page to use only the test Supabase project URL + **public/publishable** browser key (never service_role). Configure owner authentication in the test environment. Do not copy production customer information into testing.
6. Confirm both iPads can access the privately paired checkout, and that the cashier sees customer progress but not draft phone/email keystrokes. **Replace persistent `display_secret` with short-lived checkout pairing and rate limits** before involving the public.
7. Only after all tests pass and live POS launch approval, prepare the final hostname `pos.persenapparel.com`. Do not change the existing customer website and Command Center DNS during staging.

## The Dell + NELKO automatic-print acceptance test
1. Plug NELKO into Dell Windows laptop via USB. Install the correct official printer driver for the **exact model** on its label. The tear edge does not guarantee continuous receipt paper; use manufacturer-supported direct-thermal media and proper 2×4-inch label size first.
2. In Windows, set NELKO as **default printer** and configure the same paper size as the print station. Disable unnecessary scaling and verify the feed orientation.
3. In Chrome on the Dell, open your private POS `/print-station.html` URL, sign in with an authorized owner account, choose the paper profile and press **Print test receipt**. **Physically verify** a legible logo, full total, tear line and no cut-off text.
4. Enable silent printing using a dedicated, trusted Chrome shortcut with the `--kiosk-printing` flag, with the NELKO as Windows default. Restart Chrome using that shortcut, re-open the print station, and confirm the physical receipt prints **without** a confirmation dialog. Test with one printer only.
5. Click **Start automatic printing**, and keep Dell awake, plugged in and online. The station polls for paid-sale jobs, sends them to the Chrome print service and marks a job as **submitted to browser** (never as definitely printed).
6. Run a test cash transaction from cashier iPad and customer iPad in the test database. Ensure receipt choices print/email/both are correctly honored, and **no duplicate physical receipt** appears. Unplug printer for a controlled offline test, reconnect, and only retry after checking paper first to avoid duplicate printing.
7. Record exact NELKO model, paper width, driver version, default printer, Chrome printing mode, and test results before declaring it reliable.

## Cash/payment acceptance tests
- Sample products in multiple size/color variants must have **explicit saved selling prices**; unpriced products are blocked from the cart.
- A new event appears in selector; closed events reject new sales; existing historical sales retain their event.
- Test exact cash, large-bill cash with change, impossible exact change, low inventory, concurrent payment retry, and cash-drawer recount conflict.
- Test physical cash sale and electronic methods separately. **Venmo and Apple Cash are information-only**, not completed payments; verify permitted account setup with the authorized adult account holder/provider. No system can mark those transfers paid without reliable verification.
- Printed/Email/Both receipt options should not create text message jobs. Email receipts cannot be marked delivered until Resend sender + webhook configuration is complete. Customer marketing consent remains separate.

## Remaining safeguards
- Publicly callable `SECURITY DEFINER` customer endpoints behind a reusable pairing secret still need security hardening, abuse limits and session scoping.
- The backend permits authorized cashiers to override item prices and tax rates; these must be governed by approved business pricing and tax rules before real use.
- The NELKO automatic print path remains **unverified on physical hardware**.
- Never publish an unprotected POS to real customers or merge the draft to main before the checklist passes.

Reference documentation:
- Cloudflare Pages preview access: https://developers.cloudflare.com/pages/configuration/preview-deployments/
- Supabase branching usage and cost: https://supabase.com/docs/guides/platform/manage-your-usage/branching

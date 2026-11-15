# Persen POS — Release Gate & Launch Verification

> **STAGING ONLY.** This file documents the requirements before a real event or custom-domain launch. The GitHub CI and Playwright browser tests use only synthetic data, not live customers or physical hardware.

## Stations and tests
- **Laptop back office** `/admin.html`: owner-authenticated bulk size creation, inventory price/stock editing, event setup, manual refresh, and live checkout monitor.
- **Cashier iPad** `/register.html`: closed/open register, product category/search tiles, color/size selection, cart quantity, discounts, tax input, display pairing, send and cancel, drawer, cash settlement and receipt controls.
- **Customer iPad** `/display.html?pair=...`: private rotating two-hour display token, phone keypad, receipt choices, email validation, payment information, optional feedback, final submit, and cashier help.
- **Windows print station** `/print-station.html`: owner authentication, paper sizes, test print, arm/pause, queued receipts and manual retry.

Tests run in `.github/workflows/pos-tests.yml`: unit suite, SQL integration in isolated Postgres 17, payment mocks, email-provider mocks, five browser viewport sizes, static button action audit, and an interactive four-station browser test using fake Supabase.

## Security and launch restrictions
- Cloudflare Access must protect **the actual custom domain** `pos.persenapparel.com`, not merely `persen-pos-staging.pages.dev`. Confirm separately using an Incognito browser.
- The customer iPad needs a valid private pairing link and must only be opened on authorized store devices. Never place token URLs on public social posts.
- Keep staging and production Supabase credentials isolated. Never put service-role credentials into browser files.
- Confirm any rate limits and security review of anonymous token-authenticated customer RPCs before public use.
- The print queue records a request submitted to Chrome, **not** proof that the NELKO actually printed.
- Card/Apple Pay/Venmo processing is **not automatically connected**. The current recorded payment mode is cash only.
- Test on the real cashier iPad, separate customer iPad, laptop, Dell printer station and exact model/paper/driver. Verify printer behavior and recovery from offline conditions.
- Test transactional email delivery to a test inbox with a verified sender. Mock-provider tests are not live delivery proof.
- Obtain an adult account holder's help for any provider account, merchant eligibility, billing, and applicable taxes where required.

## Before attaching `pos.persenapparel.com`
1. Verify latest GitHub Actions **all green** and Cloudflare Pages production deployment displays latest commit.
2. Finish real-device checkout, customer pairing, receipt/email and physical printing tests without real money or customer information.
3. In **Cloudflare → Workers & Pages → persen-pos-staging → Custom domains**, choose **Set up a domain** and enter `pos.persenapparel.com`; Cloudflare-managed zone usually creates CNAME automatically. Check that domain only points to this dedicated POS Pages project.
4. In **Cloudflare Zero Trust → Access → Applications**, configure an appropriately limited **Allow** policy for `pos.persenapparel.com` and verify full application protection; the old `pages.dev` policy does not automatically grant protection to a new hostname.
5. Verify unauthorized Incognito access is blocked on **both** hostnames and that authorized staff devices function. Confirm production website and Command Center continue unchanged.
6. Only then consider using the site at an event, after tax and compliance review.

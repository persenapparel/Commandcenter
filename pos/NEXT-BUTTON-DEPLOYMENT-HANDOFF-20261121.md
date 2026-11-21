# Customer Next-button deployment handoff — Persen POS staging only

## What is verified in code

- Draft PR **#279**: `fix/pos-guest-next-published-20261121` into `pos-domain-hostname-20261119`.
- Reviewed checkout source: `pos/customer-checkout-screen.cjs`.
- Shipped isolated guest asset in the branch: `pos-guest/guest.js`. The published bundle embeds the exact current controller. It does **not** collect a signature.
- Guest headers `_headers` and `pos-guest/_headers`: only approved staging cashier origins may frame the guest; allow the self-hosted holiday SVG but no external images/scripts.
- Existing staging Supabase function `pos_handoff_guest_submit` was inspected read-only and accepts omitted signature fields; **do not change the database** just to remove the typed signature.
- Offline touch, step progression, cross-origin isolation, and published-bundle checks are in `.github/workflows/pos-guest-touch-focused.yml`.
- Read-only deployed asset verification tool: `pos/verify-published-guest.cjs`.

## Separate Cloudflare customer-origin deployment required

The **customer checkout** is served from an isolated `commandcenter-4yg.pages.dev/pos-guest/` preview-origin page, not the `persen-pos-staging` cashier project. A passing PR CI run does not install a new `guest.js` on the currently paired customer origin.

1. From an authorized Cloudflare browser session, **inspect the existing guest Pages project and its build/output settings**. Do not guess a new project or output folder, replace unrelated public pages, or deploy the customer site's production branch.
2. Deploy the reviewed PR #279 branch's isolated guest assets (including `pos-guest/guest.js`, `pos-guest/index.html`, CSS, holiday image, and applicable `_headers`) to an isolated **preview** URL. Keep all cashier/frontend APIs on their existing staging Supabase project. Do not expose the service-role key or owner credentials in public assets.
3. Verify the new guest page at the approved HTTPS preview URL. If public GET access is allowed, run:
   ```sh
   node pos/verify-published-guest.cjs https://<actual-preview>.commandcenter-4yg.pages.dev/pos-guest/
   ```
   This performs only read-only GET checks. It requires the reviewed branch's files on disk. If access-controlled, validate these same conditions in the authenticated browser instead.
4. Verify that the **cashier** at `pos.persenapparel.com` is actually paired with that verified isolated guest URL and the guest page can be embedded by its CSP. Changing the guest preview does not automatically change the cashier's configured `guestEntryUrl`. Change the cashier's **staging-only** build configuration only through its approved deploy path; avoid merging unrelated branches or altering DNS.
5. Only after verification, supervise one **fresh** simulated checkout on the iPad: Total -> Next -> Phone (skip allowed) -> Email (skip allowed) -> Payment preference -> Confirmation -> employee badge/owner-verified payment -> Finish Order. Check the Windows Epson print station separately. **Do not replay uncertain existing checkouts, print jobs, or cash drawer commands**.

## Stop conditions

- A missing/old `touchend` handler, a signature field, unapproved origin, iframe CSP denial, or `X-Frame-Options: DENY` means **not ready**.
- A GitHub PR merge, checkout CI pass, or agent startup message alone is **not** proof of Cloudflare deployment or of physical Epson printing.
- Broader `POS draft checks` and `Persen POS development checks` have preexisting failures in register/home test coverage; keep this fix as a **draft** until reviewed, and do not claim full register readiness from guest-specific tests.

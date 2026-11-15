# POS receipt printer: fast, dependable event workflow

## Important safety and status
This guide documents a **design target**, not a tested hardware integration. The POS is an isolated GitHub development branch; its proposed SQL has not been applied; no payments or receipts are processed live. Do not use checkout for actual customers yet.

## Automatic printing implementation now in the development branch

`pos/print-station.html` and `pos/print-station.js` implement a **browser-based print station** for an owner-signed-in Windows or Mac computer with the NELKO connected by USB. They are not yet deployed/tested on real hardware.

`pos/pos-schema-review.sql` now includes:
- `pos_print_jobs`, with a **unique sale ID** so a sale generates at most one first-print job.
- A job is inserted inside the same atomic `pos_complete_cash` sale transaction that decrements inventory; the printer can be offline and the job still queues.
- `pos_claim_print_job` atomically changes **queued → printing**, returning only receipt data and never customer contact or survey details.
- `pos_finish_print_job` changes **printing → submitted_to_browser** or **failed**. Submitted to Chrome does **not** prove physical printing.
- `pos_retry_print_job` allows **manual** recovery when the operator checks for a paper receipt first. No automatic retry of uncertain submissions, to avoid duplicate paper receipts.
- All queue tables are owner-restricted with RLS, RPC privileges are revoked from PUBLIC, and only an authenticated authorized user can claim jobs.

### Simple operator setup after staging security review and deployment

1. Connect the NELKO to the Windows Dell laptop via **USB**. Install the matching official NELKO driver and successfully print a Windows test page. Set NELKO as the **default** system printer and select paper media size in Windows printer preferences.
2. Start by testing **2 × 4 inch (50.8 × 101.6 mm) blank direct thermal labels**, already within the PL70E's documented width range. This uses peel-off adhesive label media, not the preferred traditional receipt stock. The station also offers a **58 × 120 mm** option, but continuous non-adhesive rolls remain unverified.
3. In Windows, create a **separate** Chrome desktop shortcut for the print station. Add a space followed by `--kiosk-printing` to the end of its Target field. This Chrome option often bypasses the print dialog for the browser's configured default printer. **Test it on the exact Windows/Chrome version**; it is not supported on iPad Safari. Use that browser shortcut **only** for the trusted POS print station.
4. Open `https://pos.persenapparel.com/print-station.html` **after** the site and security-checked database are deployed (not online yet). Sign in as an approved POS owner/employee, choose paper size, and click **Print test receipt**. Fix page-size or paper-feed problems before accepting sales.
5. Click **Start automatic printing** once. Leave the computer awake, signed in, connected to the internet, and Chrome open. The station polls at roughly 1-second intervals.
6. Cashier can now use **phone, laptop or iPad**. Once cash is physically received and the sale is saved successfully, the server creates a print job. The station claims it and calls Chrome's print command. The customer iPad does **not** have to connect to the printer.
7. A queue item marked `submitted_to_browser` means Chrome was asked to print, **not necessarily that paper came out**. Inspect physically and use the manual Retry button only if nothing printed. The POS cashier also retains a manual receipt-reprint option.

### Why this design is fast

- No manual PDF export, Bluetooth switching or printer selection at every sale once Chrome and the driver are correctly configured.
- No new recurring cloud-print subscription in the intended design; the Dell runs the print station through the normal Chrome browser.
- The printer remains plugged into one computer and can accept jobs from **any POS cashier device** with internet.
- Typical reaction to a paid sale is a queue poll within about **1 second**, *plus* database, browser-spooling and device print time; no full speed guarantee until physical testing.

### Remaining validation

- The existing POS schema requires security review and staging deployment first. Do **not** apply unreviewed migration to production or use with actual customers yet.
- Verify duplicate-job prevention, print-station owner authorization, offline jobs, stale jobs, browser failure/timeout, print dialog suppression, manual retry, print width, and NELKO feeding/tear-off.
- If Chrome kiosk-printing fails, a local trusted native print bridge or service may be needed; do not store printer/admin credentials in public front-end JavaScript.
- A POS receipt must remain a verifiable transaction record with correct items, tax, payment method and totals. Themes/review invitations must never alter financial figures.

## Nelko PL70 compatibility warning

NELKO's own PL70E FAQ: [Nelko PL70E FAQ](https://nelko.com/pages/faq-nelko). The PL70E is designed for direct-thermal **labels**, 40–104 mm widths, with USB recommended for computer speed and reliability. Width alone does not prove that the printer accepts **continuous non-adhesive 58 mm receipt rolls**; cutting and black-mark/gap detection differ by printer/stock.

**Do not buy receipt rolls or promise automatic receipt printing until the user's exact printer model, label feeding behavior, driver options, and a sample receipt print are verified.** If it prints only labels reliably, test a supported narrow *label* format or use a proper 58/80 mm thermal receipt printer with a cutter.

For reliable quick printing from a cashier iPad or phone, keep the printer connected to a dedicated computer as a printer station; do not rely on the customer iPad's Bluetooth connection.

## Seasonal Studio and Google reviews

POS reads the existing read-only `site_content.seasonal_campaigns_v1` for a **published, active** campaign. A seasonal promotion can appear on customer display and receipt. An owner can opt out per receipt template.

POS reads `site_content.v54_google_reviews` from the same database. That already contains an actual business review link. The receipt copy invites **honest** Google reviews, never a guaranteed five-star rating or a reward conditioned on review sentiment. QR generation remains a separate implementation/testing step; a validated link is displayed in development.

Receipt templates can edit headline, promotion and footer, plus optional review wording and seasonal/review switches. Receipt layout changes **never rewrite historical financial facts**.

## Device layouts

- Phone: touch targets >=44 px and a single-column cashier layout.
- iPad portrait: one-column cashier workflow, full-width inventory/cart, fewer side-by-side cramped controls.
- iPad landscape: three-panel cashier layout where screen size permits; drawer/event manager stays collapsed during normal checkout.
- Customer iPad: separate display route; not logged into owner account.

## Validation checklist before launch
- Verify physical iPad portrait and landscape render and touch controls.
- Verify real price list, taxes and receipt amounts; do not assume all apparel is taxable.
- Review, apply, then penetration-test Supabase SQL, RLS, ownership, concurrency, rate limits and checkout idempotency in a staging project.
- Test cash confirmation, stock updates, failed printer behavior, duplicate-print protection, reprints, network recovery, and event reporting.
- Complete an owner-approved merchant integration for card/Apple Pay/Venmo before showing these methods as available.

# POS receipt printer: fast, dependable event workflow

## Important safety and status
This guide documents a **design target**, not a tested hardware integration. The POS is an isolated GitHub development branch; its proposed SQL has not been applied; no payments or receipts are processed live. Do not use checkout for actual customers yet.

## How a fast checkout should work

1. At the start of an event, choose the POS event, verify tax settings, sign in, and leave the customer iPad paired with the cashier register.
2. Cashier scans/searches the item and confirms size/quantity; the total appears on the separate customer iPad.
3. Customer enters phone and *optional* email, then answers three optional feedback questions. Promotional consent is **not** inferred from purchase.
4. Cashier receives cash and explicitly confirms it. The **server** atomically saves the sale and deducts inventory once. The receipt is rendered from the saved sale snapshot, not from a possibly edited draft cart.
5. If the cashier opted in to `Open print dialog automatically after paid sale`, the register calls `window.print()` after successful server confirmation; the browser/OS typically still requires printer selection/confirmation. Failure to display a print dialog must never undo a recorded payment.
6. Future **silent print station**: a trusted local print service on a USB-connected computer can subscribe to a secure, authenticated print queue with idempotent job keys and send ESC/POS or printer-driver jobs. This is *not built*; it needs software/device setup and physical tests. NEVER attempt arbitrary silent printing directly from an iPad browser.
7. If print fails, allow reprint of the immutable transaction. Display a clear unknown/queued/printed status. Don't claim paper printed until the print station acknowledges device completion.

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

# Persen Apparel POS — owner-approved employee shift policy (2026-11-14)

Status: **specification, not a release authorization**. Stage only. No production merges or database changes.

## Ten decisions and acceptance criteria
1. **Badge + PIN once per shift.** HID scanner submits opaque badge credential to server; server verifies revocable badge mapping, employee status, salted/slow PIN verification, throttling and device-bound shift. Do not store plaintext badge/PIN, do not accept client-asserted employee IDs, and do not treat an already signed-in owner browser as employee proof. Subsequent unlocks require a fresh badge and a valid unexpired server shift; PIN is requested again if shift expired/revoked. Require PIN for high-risk operations as policy dictates.
2. **Greeting.** Only show server-verified employee first name after successful authentication, then Sales, Refunds, Returns, Inventory Check.
3. **30-second idle lock.** No keyboard/pointer activity for 30 seconds returns to branded lock screen, hides cashier/customer data, revokes access to privileged actions until verified unlock. Do not silently abandon or mutate an in-progress checkout; preserve cart server-side with explicit recovery and never expose it on idle screen. Require actual server authorization for each protected request.
4. **Refund permissions.** Owner and authorized managers only; verify role server-side, original transaction and refund amount, record reason and audit event, prevent duplicates and over-refunds. Do not assume POS can initiate external payment refunds.
5. **Returns.** Locate by original receipt/order OR customer lookup with authorized access. Exceptions require fresh owner approval, auditable reason, and stock disposition. Never infer a return from arbitrary SKU scan.
6. **Inventory Check.** All authorized employees can read allowed stock; quantity adjustments require explicit server-side role permission, reason, audit log and atomic update.
7. **Sales barcode.** Bluetooth HID Code128 SKU scan followed by Enter adds exactly one eligible in-stock variant instantly to active cart; ignore duplicate Enter events, prevent scan in customer mode, respect inventory/event eligibility and server-side stock validation.
8. **After completed sale.** Only after durable server confirmation and safe receipt-queue handoff, close sale and show lock screen; require another badge scan. A failed or pending completion must not be treated as success.
9. **Idle visuals.** Persen logo, local clock, seasonal decorations, accessible high-contrast UI and reduced-motion preference. No customer/employee secrets.
10. **Unknown badge.** Generic failure without employee enumeration, rate limit and retry, secure account sign-in fallback. Never expose whether badge exists.

## Release gates
- Isolated staging Supabase with explicit RLS and role enforcement, migration reviewed and applied only after approval.
- Server-side badge/shift endpoints and tests for revoked badge, brute-force, stolen/expired shift, role escalation, inactivity and logout.
- Real iPad Bluetooth HID scanner and Enter suffix test.
- Browser E2E: sign in, greeting, four options, sale, lock, badge rescan, inventory read/adjust, manager refund, owner-approved exception.
- Customer handoff guard stays fail-closed until separate checkout-scoped guest gateway and cashier isolation are independently verified.
- Epson print/receipt physical testing and cash reconciliation; no production deployment without explicit approval.

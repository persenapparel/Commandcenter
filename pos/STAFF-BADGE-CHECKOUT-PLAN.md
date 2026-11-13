# Persen POS — badge-signed cashier + owner approval design (STAGING ONLY)

**Status 2026-11-13:** Requirements and post-Finish-Order home reset are drafted. Badge login, authorization, employee sale attribution, audit/RLS and receipt printing are **NOT implemented**. Never allow staff badges to access live register until server-side checks and penetration tests pass. This document is not an approved database migration.

## Required one-iPad flow
1. With no active sale, display the Persen Apparel welcome/home screen. A new order never displays prior customer contact, cash, or receipt details.
2. Employee scans their personal, revocable badge (Code 128 or QR) to **request** a cashier session. Code128 Christmas product-size labels are entirely separate; they must never authenticate someone. Never display the raw badge.
3. Backend validates the badge securely, enforces expiry, revocation, lockout/rate limits and returns an employee-scoped **server-issued short-lived session**. Only now show `Welcome, <display name>`. No client-only or cached role inference.
4. Employee adds product variants, then hands the *same* swivel iPad to customer; customer cannot navigate to cashier/admin controls or reuse owner/session tokens.
5. Cashier validates payment, provides change, presses **Finish Order**, and only on successful authoritative server completion: clear cart, contact details, tender entry and checkout iframe; show home/welcome again. Failed/pending/ambiguous sales stay on recovery UI.
6. For *each* sale, server immutably stamps `cashier_employee_id`, `cashier_display_name_snapshot`, `cashier_session_id`, sale time and event. Receipt queue uses the saved sale snapshot, never the current kiosk name. BOTH cut Epson slips say `Cashier: <name>`. An owner-only Back Office report shows each actor and action.
7. Sensitive action request (override/discount beyond policy, void/refund, manual drawer open, inventory adjustment) is a **server-side pending approval** bound to action, parameters, amount, staff ID, workstation, and expiry. Staff screen says exactly what is being requested; owner scan opens that specific request.
8. **Owner badge alone is not an adequate approval factor:** Code 128/QR can be photographed/copied. Require existing authenticated owner identity **plus** owner badge and a short PIN or phishing-resistant device-bound step-up before server approval. Record approver ID/time, action, previous/new values, reason. A badge scan must never silently run the action.
9. Owner can issue/disable/reprint individual employee badges in Back Office. Badge contains an unpredictable secret token (at least 128 bits), not an employee name, password, PIN, or plaintext staff ID. Store only a one-way keyed digest or appropriately slow hash, never the raw badge. Do not log it in browser analytics or requests.
10. Restrict all sensitive SQL RPCs by authenticated role, scoped kiosk/staff server session, RLS and request ownership. The browser is not the source of truth for authorization or sale actor. Do not reuse an owner-authenticated Supabase browser as an employee session: customer same-origin iframe is a known blocker. Do not expose service-role keys.
11. Owner-only audit view includes cashier logins/logouts, sales, returns, discount overrides, owner approvals, stock adjustments, printer retries, and drawer openings. Personal customer data should be minimized and retained only as needed for the business.

## Server implementation / migration work (NOT PRESENT)
- Separate staff employee table and badge-credential records; hash, rotate, revoke, and rate-limit badge redemption.
- Short-lived server-side staff sessions with register binding and explicit logout/timeout on home; protect against unauthorized replay and badge cloning. A bearer barcode is not equivalent to employee Supabase Auth.
- Server-side atomic attribution of sale at checkout creation and finalized payment. Trigger/queue receipt copies from saved records, with no duplicate automatic reprints.
- One-time scoped owner approval RPC with authenticated owner step-up, explicit action type/amount and immutable audit record.
- Tight RLS plus privilege tests for staff/nonstaff/owner; receipts and owner data only to authorized roles.

## Acceptance tests (all outstanding)
- Scanning product SKU cannot unlock employee or owner privileges.
- Revoked, expired, copied/replayed/rate-limited badges fail appropriately; lockout and safe recovery.
- Staff cannot bypass login via browser storage, DevTools, URL navigation, or customer iframe; shared-origin/session isolation fixed.
- Cashier attribution is immutable across retries, partial payments, customer handoff, receipt job retries and network loss.
- Wrong employee/owner badge cannot approve; owner approval is bound to precisely the displayed operation.
- After successful Finish Order, home screen is visible, cart/customer PII are not, and previous sale receipt remains available only to authorized back office.
- Interrupted/failed Finish Order does NOT reset to home; cashier can recover without duplicate charge or prints.
- Epson Windows print agent prints both separately cut 80mm receipts with exact sale totals, event and cashier snapshot; verify physically only after hardware arrives.
- On-device iPad Safari + DYMO Code128/employee badge scanner tests, browser CI, isolated PostgreSQL security tests and staged deployment verification all required.

## Current staging progress
- `register.js`: on completed sale, calls `setRegisterOpen(false)` after the successful save/Finish Order path and hides the old receipt preview. The existing owner-authenticated `Open Register` control is **not an employee badge login** and must be replaced before staff rollout.
- Existing Epson manual owner drawer badge is unrelated to secure staff login and **must not be reused as a general owner override bypass**.
- No production data, hosted staging database, Cloudflare environment or hardware changed.

## Approved initial badge roster and NFC/print requirements (2026-11-13)
- **Luke** — owner; privileged actions still require secure step-up and explicit request confirmation.
- **Colleen** — cashier only; may complete cash sales, but cannot approve overrides, refunds, discounts outside policy, or open the drawer manually.
- **Logan** — cashier only; may complete cash sales, but cannot approve overrides, refunds, discounts outside policy, or open the drawer manually.
- The front of EACH physical employee card shows Persen Apparel logo and the employee's first name, printed clearly. Back shows THEIR OWN scannable register Code 128 or QR, distinct from all product SKUs.
- The card's NFC chip is a PUBLIC marketing link to `https://persenapparel.com/`, so a visitor tapping a compatible phone opens the store website. **Never program a login URL, staff badge credential, token, or private endpoint in NFC**. The NFC URL and the back barcode are independent functions.
- Employee badge code should be issued only after secure server-side enrollment, safely encrypted/hash-verified and revocable. Never commit or publicly print test codes as if active credentials. Use separate test-only labels, and protect against photographed/copied bearer barcodes with short server-issued sessions, rate limits, and least privileges.
- Confirm print material / NFC card antenna compatibility and scan quality physically before batch printing. Card design artifacts are NOT generated in this PR; secure badge issuance and NFC programming are NOT implemented.

## Owner-only approvals and cash-sale drawer policy — confirmed by owner (2026-11-13)

- **Luke only** has the manager/owner approval privilege. Neither Colleen nor Logan may approve their own or another staff member's override, refunds, unusual discounts, voids, inventory exceptions, or manual drawer opens.
- **Colleen and Logan MAY accept and record cash for ordinary sales** after their individual employee badge sessions have been verified on the server. Both should be able to give change and finish the sale.
- When a verified cashier confirms cash received **and the backend atomically saves exactly one successful cash sale**, the Epson Windows agent may open the attached cash drawer automatically once for that sale. This is the permitted employee drawer access; no owner scan needed for each normal cash transaction.
- Do **not** make 'Open Drawer' available as a staff button and do not open on badge login, cart changes, entering a tender amount, retrying an unknown cash save, non-cash orders, refunds or failed/rejected checkout. Manual/open-without-sale remains **Luke-only** with owner step-up and logged reason.
- Repeated payment callbacks, reloads, receipt reprints and retries cannot create another automatic drawer-open job for the same saved cash sale. Existing draft `pos_saved_sale_drawer_job` filters `payment_method='cash'` and uses `pos_drawer_open_cash_once` uniqueness, but employee session attribution and actual Windows printer/drawer behavior are NOT yet integrated/verified.
- Audit must link each cash-sale drawer job to its immutable sale ID and employee ID/name snapshot; privileged manual opens log Luke's approved action. The public customer screen never sees these privileged controls or credentials.
- Add PostgreSQL/browser tests proving Colleen and Logan can process cash only under valid cashier sessions, cannot call manual-open RPC or owner approval, no open on noncash/uncommitted payment, and exactly one cash-sale drawer job on idempotent checkout retries.
- **This is a staging requirements update only.** The draft backend currently requires owner auth for POS operations and the staff badge login/role enforcement is unfinished; do not tell Colleen or Logan they can use their badges or that the drawer is verified until server changes, CI and hardware acceptance tests pass.

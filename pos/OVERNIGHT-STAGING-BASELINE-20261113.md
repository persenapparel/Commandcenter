# Persen POS overnight staging baseline — 2026-11-13 18:00 ET

> DRAFT ONLY. This file is a coordination/checklist artifact, not a deployment, test pass, or permission to alter production. Based on current GitHub PR descriptions and #52 metadata. Other scheduled POS agents may work in parallel; do not overwrite their branches.

## Branch provenance
- Base commit: `459863b441816f7ec2c8ec377324604d45bbacef`, head of [PR #52](https://github.com/persenapparel/Commandcenter/pull/52), itself layered on #51 / #50 and Epson draft work.
- This overnight branch is deliberately separate. Do not merge or deploy until complete tests and owner approval.
- Critical distinction: #52 only implements a client-side post-Finish-Order home reset plus a **design** for badges. It does not implement badge auth, staff approvals, or hard security isolation.

## Observed PR evidence (not equivalent to deployed functionality)
| Area | Evidence | Honest status |
| --- | --- | --- |
| Swivel-only iPad | [#50](https://github.com/persenapparel/Commandcenter/pull/50), [#51](https://github.com/persenapparel/Commandcenter/pull/51) | Draft UI; legacy pairing and same-origin iframe remain a security blocker |
| Home reset after sale | [#52](https://github.com/persenapparel/Commandcenter/pull/52) | Draft client change; end-to-end server/browser verification pending |
| Staff badge and owner approvals | #52 | Design only; no secure backend/RLS implementation |
| Scan inventory mode | [#43](https://github.com/persenapparel/Commandcenter/pull/43) | Draft with local Node tests reported; physical scanner and browser CI unverified |
| Epson agent + cash drawer | [#45](https://github.com/persenapparel/Commandcenter/pull/45), [#46](https://github.com/persenapparel/Commandcenter/pull/46) | Draft; no printer/drawer hardware tests |
| Two cut receipts | [#47](https://github.com/persenapparel/Commandcenter/pull/47) | Draft ESC/POS commands; real cut and print unverified |
| Contact questions | [#48](https://github.com/persenapparel/Commandcenter/pull/48) | Draft; existing backend still requires a 10-digit phone; conflicts with new optional-phone decision |
| Receipt contacts/promos | [#49](https://github.com/persenapparel/Commandcenter/pull/49) | Draft; customer signature on both slips NOT implemented |
| Receipt lookup barcode and returns | Latest owner requirement | Not established by inspected PR descriptions; inspect source before marking implemented |
| No-tax pricing | Latest owner decision | Existing #47 PR explicitly includes a tax line; needs correction and tests before deployment |

## Latest authoritative acceptance contract
1. **NO tax computation, settings or displayed tax line** for new sales, returns and exchanges; preserve historical records and flag legal tax compliance for owner verification.
2. Same Command Center stock authority, variant-size/color SKU barcodes, atomic exact-once deductions and stage-safe test data.
3. Staff badges are revocable, authenticated server-side and require secure step-up; Luke owner-only privileged approvals/manual drawer, Colleen/Logan ordinary cashier. Verified login shows **Welcome, NAME** for about 3 seconds, then large New Sale / Refund-Return / Product Check menu.
4. Product scan in New Sale shows large picture/name/size/color/price for ~1 second and adds exactly once; rapid scans are queued and never lost. Product Check never adds to cart. Receipt PAO scan retrieves an order only after auth.
5. Cash plus recording external tender; optional phone/email and separately requested email receipt; signature required as normal store workflow with clearly disclosed owner-supervised exception; no marketing opt-in inferred.
6. Offline cart persists but server settlement waits for reconnection. Finish Order is idempotent, returns to home and clears prior customer state.
7. Epson 80mm receipt pair includes sale-time promotion, permitted contact details, captured signature on both, and bottom opaque PAO Code128 + human-readable reference; printer job claims and drawer pulses are exactly once.
8. Per-product return policies; owner-approved partial returns and exchanges; lookups by PAO/date/contact; secure adjustment of paid amount, inventory and tender with no added tax.
9. Event/shift close report records tender breakdown, opening float, counted cash, expected cash, discrepancy and audit.
10. No production merge, DNS changes, hosted DB migrations, real payment, printer or drawer operations without owner approval.

## First security and correctness gates
- [ ] Replace same-origin owner-session customer iframe with a genuinely isolated customer view or demonstrably secure sandbox and test that customer cannot read owner session, token, admin routes or PII.
- [ ] Rewrite obsolete dual-iPad browser test before claiming swivel-only mode is ready.
- [ ] Implement server-verified staff badges + step-up, RLS and owner-only refund/manual drawer privileges. Never use barcode as sole credential.
- [ ] Make phone/email individually optional end-to-end (both client and backend).
- [ ] Remove all active tax calculation and tax receipt lines from new checkout; preserve historical transaction data.
- [ ] Implement signature capture-to-storage-to-Epson both-copy path with audited exception and retention limits.
- [ ] Add opaque PAO receipt Code128 and authenticated lookup, separate from SKU and badge scan namespaces.
- [ ] Test atomic sale/stock/drawer/print idempotence under retry, network loss and concurrent use.
- [ ] Run browser + PostgreSQL/RLS + static/Node tests; capture commands, outputs and SHA.
- [ ] Validate physical iPad scanner, Epson cut/print and drawer only after equipment arrives and owner approves.

## Next concrete engineering action
Inspect `pos/register.js`, `pos/register.html`, customer display scripts, staging SQL, Epson receipt renderer, and CI workflow on the exact base commit; select a single scoped security/functional fix, add regression tests, and commit to a separate draft PR. Highest urgency is **customer iframe/session isolation** before exposing owner-authenticated iPad to shoppers. Do not enable employee badges or returns on an unprotected client-only role check.

## Session log
- **2026-11-13 18:00 ET:** Repository accessible; latest POS draft PR chain #43, #45–#52 reviewed via GitHub. #52 base/head and changed files verified. This baseline document records known conflicts and explicit verification gates. No code or hosted service/hardware changed by this entry.

- **2026-11-13 19:00 ET:** Staging-only incremental frontend no-tax patch on this draft branch. New-sale `current()` calls `C.totals(...,0)`; checkout RPC passes `p_tax_milli:0`; removed cashier tax-rate control and stale disabled-state reference; hid the legacy receipt tax line while keeping historical DB fields untouched. Added `pos/no-tax-checkout-regression.cjs` static test. **NOT COMPLETE:** backend still accepts tax parameters, older saved tax data/receipts and Windows Epson renderer still need explicit review, product 'taxable' metadata remains for compatibility, browser/DB/physical tests not run, and current patch has not been deployed. Next: ensure CI runs new test, audit Epson receipts and server RPC behavior, then address same-origin customer isolation. Do not merge/deploy.

- **2026-11-13 20:00 ET:** Added staging-only large 1-second product scan confirmation after `scanCart` accepts a variant, showing product name, size, color, price, and updated cart quantity. Uses nonblocking `pointer-events:none`, `aria-live`, and resets the timer on subsequent rapid scans without blocking cart additions. Commit `f6146ed`; added structural regression `pos/scan-confirmation-regression.cjs` (`d3a0de6`) and POS workflow step (`89fb553`). This is **not yet browser tested or CI verified**, and image/thumbnail is not yet shown because stock has no validated product image URL in this code path. Next: validate browser/iPad rapid-scans and accessibility, add actual product image if supported, and prioritize customer same-origin security isolation and server-side no-tax enforcement. All changes are draft-only; no deployment/hardware use.

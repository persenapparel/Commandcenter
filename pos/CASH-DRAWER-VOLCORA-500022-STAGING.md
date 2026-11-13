# Volcora 500022 cash drawer — STAGING ONLY

## Hardware (verified against manufacturer's specification)
- Owner's Amazon ASIN B0857KM7TN: Volcora model 500022, 13-inch, 24VDC, RJ11/RJ12 (drawer-kick), manual key backup. Not Bluetooth and not a USB drawer.
- NELKO PL70e-BT is a USB/Bluetooth label printer (USB + power ports); no verified drawer-kick output.
- Proposed path: drawer -> manufacturer's RJ11/RJ12 cable -> **compatible 24V USB cash-drawer trigger/controller** -> permanently running Windows laptop/print station. Standard USB-C adapters and passive RJ-to-USB wiring do not drive a cash drawer.
- Alternative: receipt printer with a verified compatible 24V cash-drawer kick port.
- Controller protocol, pinout, Windows drivers, bridge process, physical response and manual-open authorization are **NOT configured or verified**. Do not assume compatibility just because the connector fits. Ask owner to confirm the delivered label and photograph the supplied RJ cable and laptop connection.
- Keep the physical key as fallback. Have the manufacturer or qualified service technician confirm controller compatibility before electrically connecting or testing.

## Required checkout behavior
1. The cash register saves a cash sale via the authoritative `pos_complete_cash` RPC and then re-reads the saved sale record.
2. Only the saved, valid cash sale may request exactly one drawer kick. A pending cash entry, unpaid checkout, canceled sale, noncash payment, reloaded page, or Finish Order must not trigger a kick.
3. The physical controller service MUST authenticate the requesting register and independently confirm the saved cash sale and cash payment with Supabase, not trust browser `serverSaved:true`. A durable per-sale idempotency key and an audit log prevent duplicate kicks across devices, refreshes and restarts.
4. Customer screen stays in change-handoff state until cashier confirms change/receipt and presses **Finish Order**; then it returns to the Welcome screen.
5. If the controller is missing/offline, show **not connected / use key**, never `drawer opened`. Cash sale completion remains available.

## Owner-only manual opening
1. Display a `Request owner-only drawer opening` action with a reason (cash count, add float, reconciliation, owner access).
2. Owner signs in using the existing POS auth, then completes **server-side** approval using an owner PIN or a securely registered badge plus independent owner authentication. Owner badge barcode alone is copiable and is NOT sufficient to authorize physical opening.
3. The trusted backend verifies role, approval, freshness, request origin and rate limits; issues a short-lived, one-use authorization and writes an audit record including register/owner/reason and command outcome. Never embed PINs in JS, URLs, scanner shortcuts, browser storage or logs. Store PIN verifiers only in a server-side protected credential store using suitable hashing.
4. The local controller alone can drive the drawer. It independently validates backend approval and idempotency. Never expose an anonymous USB/browser endpoint that can actuate hardware.
5. The new browser `requestOwnerOpen` is only a **fail-closed interface**. Neither it nor its visible button implements server authentication, PIN handling, barcode enrollment, local controller transport or physical opening. Do not enable real commands until security and device acceptance pass.

## Acceptance checks before live use
- Open after one saved cash sale; display amount to return, stay at cash handoff; click Finish Order only after change is returned.
- Exact cash handled; noncash/unpaid/canceled/duplicate clicks/refresh cannot open, and sales cannot duplicate.
- Request owner opening: unauthorized cashier, replayed badge, wrong PIN, expired token, repeated command, disconnect and offline all deny access; authenticated owner flow succeeds with a reason in durable audit.
- Confirm behavior physically on the actual Volcora drawer, compatible controller and Windows laptop. Verify iPad can request through authenticated server connection but cannot directly open drawer.
- Confirm customer iPad state, physical NELKO receipt and preview security separately; do not deploy to the live site or use real customer data during staging.

Source references: Volcora official mini cash drawer product specifications, Volcora help center auto-open guide, NELKO PL70e product specifications.

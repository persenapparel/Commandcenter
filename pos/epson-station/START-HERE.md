# Epson TM-T20IV + Volcora cash drawer — staging integration

**Status: staging database queue installed November 18, 2026; Windows Epson station software is available but NOT installed or physically verified. Hardware acceptance is planned after the Epson printer arrives Saturday, November 21. Do not use for real sales until acceptance.**

## What this adds
- The newest Square-style POS staging branch, preserving live customer display, scanner and inventory-mode code.
- A PostgreSQL staging-only migration (`pos/epson-t20iv-staging.sql`) that atomically queues **one cash-drawer command per newly saved cash sale** using an AFTER INSERT trigger. No receipt required. Reopening a transaction, refreshing the browser, printing a duplicate receipt or clicking Finish Order does not create another drawer command.
- Owner-only manual drawer opening. POS authentication **plus** a credential independently hashed and verified in Postgres is required. Supports a **6–12 digit new drawer PIN** or a **private, cryptographically random 24–64 character owner badge**. A badge alone, without a signed-in owner, is not accepted. Five failed attempts impose a 15-minute lock.
- Node 22 Windows print-station agent (no external packages): polls authenticated staging queues, claims jobs atomically, sends ESC/POS RAW receipt jobs and separate drawer pulse commands, and reports spool submission or uncertainty. **No open network port/unauthenticated listener.** No automatic replay of uncertain commands.
- Text receipts on 80mm paper with sales lines, discounts, taxes, payment/change, and automatic cut. **Epson only.** Do not run any retired browser print station or arm two print services against the same queue.

## Physical connection
Cashier iPad -> internet -> **staging Supabase** -> authorized Windows laptop poller -> Epson TM-T20IV Windows print queue -> Volcora 500022 cash drawer connected to Epson drawer-kick port.

The iPad is **not wired** to the printer or drawer. No ordinary USB-C adapter is needed. The laptop must stay awake and online.

**Printer verification required:** Epson's technical manual lists an RJ12 drawer-kick output. Before connecting your Volcora, verify the specific drawer coil resistance/current, cable wiring and Epson specifications with the manufacturer/seller. Do **not** connect it to the phone network. Disable the printer's optional external buzzer and any driver's setting to kick the drawer on every print/reprint, because this integration sends **separate** authenticated drawer commands. Epson's Windows RAW spooler handling must also be physically verified with your exact driver/USB printer configuration.

References: https://support.epson.net/publist/bsmanual.php?lang=EN&model=TM-T20IV and https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/tmt20iv.html.

## Steps to configure AFTER code review
1. Staging project **naaqcspvbntzdtwuchrr ONLY**: `pos/epson-t20iv-staging.sql` was applied and verified on November 18, 2026. Never apply this to production. The receipt and drawer queue software is installed, but no physical hardware test has occurred.
2. Install Epson's official TM-T20IV Windows printer driver. Verify the exact installed printer queue name and actual 80mm receipt roll diameter. The Windows print queue must support RAW ESC/POS data. If it doesn't, the agent will not work; do not force the printer's auto-open-on-print setting as a workaround.
3. On the Windows laptop, install Node.js 22+ and obtain the POS staging repository branch. Run `node pos/epson-station/agent.cjs --self-test`. This prints a diagnostic **to terminal only**, no paper and no drawer opening.
4. With the staging owner signed in on the cashier device, use **Cash drawer setup → Owner-only drawer access → Owner setup** to choose a NEW 6+ digit PIN. To enroll an owner barcode, generate a cryptographic random code there, keep it secure, print it as a private Code 128 badge using your label workflow, and enroll it. **Do not send the PIN or badge content in chat, GitHub or screenshots.**
5. On Windows PowerShell in the repo folder, configure the public Supabase publishable key, installed printer name, and explicit arming flags for the current session:
   ```powershell
   $env:PERSEN_POS_PUBLISHABLE_KEY="sb_publishable_STAGING_KEY_HERE"
   $env:PERSEN_WINDOWS_PRINTER="EPSON TM-T20IV"
   $env:PERSEN_DRAWER_ARMED="YES"
   $env:PERSEN_RECEIPTS_ARMED="YES"
   node pos/epson-station/agent.cjs
   ```
   Enter the owner **staging account** credentials locally when prompted; passwords are not saved in repository files.
6. Use test products and test cash only. Confirm an authorized cash sale opens the drawer shortly after the payment is recorded, independently of receipt printing; check 80mm print, cut and manual owner opening; then verify cash change/Finish Order and customer iPad reset.

## Security and reliability acceptance
- Registered owner credentials stored only as `pgcrypto` bcrypt hashes. Failures are rate-limited transactionally; manual-opening jobs include owner, reason, register and timestamps. Staff/anon cannot enqueue or claim jobs through the owner RPCs. A static copied badge alone is not a secure substitute for signing in.
- Printer agent uses an in-memory owner Supabase Auth token and its publishable key, **not** a service_role key. It polls backend jobs through authenticated PostgREST; no unauthenticated local USB or LAN endpoint is exposed.
- One claim per queued command, with no automatic retries after a failed/uncertain spool command. Windows accepting the RAW print job is **not proof** that paper printed or the drawer physically opened. Manual reconciliation is needed.
- Automatic cash drawers open for **saved cash sales**, even when change is zero, so the cashier can deposit the tender. Never open for an unpaid, canceled or noncash transaction.
- Jobs older than 24 hours are excluded from automatic processing. Review previous NELKO pending jobs before enabling a new station.
- Required physical checks: Epson firmware/driver RAW compatibility, actual Volcora cable/coil compatibility, PIN/badge scanner, owner vs staff access, duplicate clicks/disconnects, 80mm thermal paper, automatic cutter, Wi‑Fi loss, and same-event multi-sale performance.
- This draft does not guarantee subsecond latency. The 350ms poll is a starting interval; network and Windows driver/print spooler determine actual responsiveness.
- This draft does **not** include full image-based/logo receipt rendering, Windows installer/service auto-start, or a verified production sync to Command Center.

## Do not confuse code readiness with deployment
**Automated tests:** Node simulation plus isolated PostgreSQL + browser CI must pass.
**Staging:** schema install + staging preview SHA + sign-in must be verified.
**Hardware:** Windows laptop, Epson, Volcora and both iPads must be physically tested. Until then, use drawer key and existing receipt backup workflow, and do not take real event payments.

When an owner completes the physical acceptance checklist, review deployment/security gates separately before production use.

## Laptop back-office Print Center (Epson staging UI)
The POS device dashboard and cashier register now link to `admin.html#print-center`, a single owner-authenticated **read-only** Epson Print Center. It displays recent receipt/drawer queue records and their known server states; it never claims jobs, sends ESC/POS commands, or promises physical device status. The monitor requires the reviewed Epson staging SQL and owner RLS permissions.

**Why a service remains necessary:** Cloudflare-hosted pages and iPad Safari cannot directly send Windows RAW spooler jobs or kick a drawer. Run `node pos/epson-station/agent.cjs` in a separate, signed-in Windows process with the settings above after hardware acceptance. Keeping the Back Office page open is not sufficient to print. Print Center cannot start, stop or detect whether that local process is alive; inspect its console on the laptop.

**Old NELKO flow:** `print-station.html` now shows a non-printing informational page, and the old `print-station.js`, `print-station.css` and `receipt-paper-layout.js` are excluded from the Epson Pages build. They remain archived in source for historical reference only. Never keep a previously deployed NELKO browser worker armed when using the Epson agent.

**Backup:** The cashier's Emergency browser reprint button requires explicit duplicate-warning confirmation and is **not** an Epson RAW print command. Confirm whether the Epson has already printed before using it.

## Saturday supervised hardware acceptance (November 21, 2026)

Before connecting the drawer, confirm the Epson TM-T20IV Windows queue, driver configuration, correct manufacturer-approved cash-drawer cable and compatibility; disable any printer-driver auto-kick-on-receipt setting. Keep the Epson print agent **disarmed** while configuring it, and keep the staging cash-drawer queue clear of stale test commands. Run `node pos/epson-station/agent.cjs --self-test` for a no-hardware syntax/receipt simulation before considering arming. Do not perform wiring or connector experimentation without manufacturer guidance.

When the hardware is connected and the owner authorizes the test, use **staging test transactions only** and verify these acceptance cases in order:

- Incomplete customer form: no sale, no receipt, no cash drawer job.
- Simulated cash transaction after customer details + cash received + exact change calculation: **one** drawer job; separate receipt (only if requested). Confirm drawer physically opens once and reports command status.
- Refresh/Finish Order/reprint: **no additional drawer job**.
- Venmo/Apple Cash payment preference: **zero automatic drawer jobs**. An owner-confirmed external transaction never triggers a kick.
- Simulate printer offline: mark a claimed drawer command uncertain and **do not automatically retry**; inspect physically before any owner decision.

A Cloudflare success or `command-sent` merely proves deployment or Windows spool acceptance, **not** physical paper feed, cutter, cash-drawer electrical compatibility, or opening.

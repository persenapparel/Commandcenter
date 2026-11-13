# Epson TM-T20IV + Volcora cash drawer — staging integration

**Status: code review and automated testing only. NOT installed, deployed, wired, or physically verified. Do not use for actual sales until acceptance.**

## What this adds
- The newest Square-style POS staging branch, preserving live customer display, scanner and inventory-mode code.
- A PostgreSQL staging-only migration (`pos/epson-t20iv-staging.sql`) that atomically queues **one cash-drawer command per newly saved cash sale** using an AFTER INSERT trigger. No receipt required. Reopening a transaction, refreshing the browser, printing a duplicate receipt or clicking Finish Order does not create another drawer command.
- Owner-only manual drawer opening. POS authentication **plus** a credential independently hashed and verified in Postgres is required. Supports a **6–12 digit new drawer PIN** or a **private, cryptographically random 24–64 character owner badge**. A badge alone, without a signed-in owner, is not accepted. Five failed attempts impose a 15-minute lock.
- Node 22 Windows print-station agent (no external packages): polls authenticated staging queues, claims jobs atomically, sends ESC/POS RAW receipt jobs and separate drawer pulse commands, and reports spool submission or uncertainty. **No open network port/unauthenticated listener.** No automatic replay of uncertain commands.
- Text receipts on 80mm paper with sales lines, discounts, taxes, payment/change, and automatic cut. Existing optional NELKO browser print station remains separate; **do not arm both for the same receipt queue**.

## Physical connection
Cashier iPad -> internet -> **staging Supabase** -> authorized Windows laptop poller -> Epson TM-T20IV Windows print queue -> Volcora 500022 cash drawer connected to Epson drawer-kick port.

The iPad is **not wired** to the printer or drawer. No ordinary USB-C adapter is needed. The laptop must stay awake and online.

**Printer verification required:** Epson's technical manual lists an RJ12 drawer-kick output. Before connecting your Volcora, verify the specific drawer coil resistance/current, cable wiring and Epson specifications with the manufacturer/seller. Do **not** connect it to the phone network. Disable the printer's optional external buzzer and any driver's setting to kick the drawer on every print/reprint, because this integration sends **separate** authenticated drawer commands. Epson's Windows RAW spooler handling must also be physically verified with your exact driver/USB printer configuration.

References: https://support.epson.net/publist/bsmanual.php?lang=EN&model=TM-T20IV and https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/tmt20iv.html.

## Steps to configure AFTER code review
1. Do not deploy production. Using staging project **naaqcspvbntzdtwuchrr ONLY**, review/apply `pos/epson-t20iv-staging.sql` (prefer a database snapshot/backup). This migration is **NOT** automatically applied by GitHub.
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

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

## Laptop back-office Print Center (Epson staging UI)
The POS device dashboard and cashier register now link to `admin.html#print-center`, a single owner-authenticated **read-only** Epson Print Center. It displays recent receipt/drawer queue records and their known server states; it never claims jobs, sends ESC/POS commands, or promises physical device status. The monitor requires the reviewed Epson staging SQL and owner RLS permissions.

**Why a service remains necessary:** Cloudflare-hosted pages and iPad Safari cannot directly send Windows RAW spooler jobs or kick a drawer. Run `node pos/epson-station/agent.cjs` in a separate, signed-in Windows process with the settings above after hardware acceptance. Keeping the Back Office page open is not sufficient to print. Print Center cannot start, stop or detect whether that local process is alive; inspect its console on the laptop.

**Old NELKO flow:** `print-station.html` now shows a non-printing informational page, and the old `print-station.js`, `print-station.css` and `receipt-paper-layout.js` are excluded from the Epson Pages build. They remain archived in source for historical reference only. Never keep a previously deployed NELKO browser worker armed when using the Epson agent.

**Backup:** The cashier's Emergency browser reprint button requires explicit duplicate-warning confirmation and is **not** an Epson RAW print command. Confirm whether the Epson has already printed before using it.

## Vendor-show automatic two-copy receipts (development)
- Every successfully saved **cash sale** queues exactly one authenticated Epson print job in the current staging SQL revision.
- The Windows agent submits a **single RAW payload** containing **CUSTOMER COPY** followed by a physical full-cut command, then **MERCHANT COPY** with a second full-cut command. One sale ID, two pieces of paper, no duplicate stock deduction/payment. Both copies show items, totals, tax, tender, change and business branding; merchant copy is labeled for retention.
- The customer iPad's paper choice is now Printed (default) or Printed + Email. Email is still pending verified Resend configuration; no SMS is sent. Older client options must be retired before launch.
- Disable Windows driver auto-reprint and browser auto-print. Both cuts/roll handling must be physically verified; a RAW spool success does not establish that **either or both pieces printed**. On uncertain partial output, never automatically replay both copies without investigating duplicates.
- The receipt currently uses clean text branding, large high-contrast title and bold totals. For the actual logo image, use Epson TM-T20IV Utility to register the *approved* monochrome logo in printer nonvolatile graphics memory and configure Epson receipt enhancement top-logo printing. Test that the logo appears on **both pieces** with this single two-cut job, then recheck paper use and cut separation. Do not upload owner-only or customer signatures to printer memory.
- A *finger-drawn* customer signature is a proposed optional, normally OFF feature. Do not treat routine cash sales as requiring a signature. If truly needed, get explicit customer permission, implement transient input on the customer iPad, retain only the minimum needed on an owner-restricted backend with retention/deletion and consent safeguards, and print it on **merchant copy only** after authorized review. No customer signature capture/storage/print has been enabled in this PR.

## Fast holiday show checkout (draft PR #48)
- Remove the customer-facing star rating, custom-apparel lead survey and marketing signup screens. This checkout must NOT infer marketing permission from a phone number or email; existing server defaults remain `not_answered` / false.
- Combine receipt preference with the email step, so current tested stages are Phone → Email + optional emailed receipt → Payment choice → Review & submit. Two paper copies (Customer + Merchant) are still automatic, independently of optional email delivery.
- **Final target adds a finger-drawn signature stage for every customer**, between contact details and cashier payment, with consent/decline, then the same actual signature bitmap printed on both separately cut receipts. This signature requirement remains **PENDING** and is not a current working feature of this draft. Do not imply the live system collects or prints signatures before the protected server-side capture/expiry/printing path is implemented and tested.
- Do not deploy production. Test two iPads with the protected staging database and Epson hardware first.

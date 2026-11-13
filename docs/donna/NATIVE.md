# Native iPhone implementation and acceptance plan

## Actual status

| Component | Status | Evidence or limit |
| --- | --- | --- |
| SwiftUI app and XcodeGen specification | Implemented and compile-tested | [Unsigned baseline simulator build](https://github.com/persenapparel/Commandcenter/actions/runs/43358668136) passes on the free macOS runner; no signed device build |
| Foundation Models conversation and fixed read-only Tool | Implemented but unverified | Runtime availability gate; no paid model fallback; model restricted to fixed read tools |
| Speech input | Implemented but unverified | Explicit permission, `supportsOnDeviceRecognition` gate and `requiresOnDeviceRecognition = true`; rejects unsupported language/device |
| Spoken replies and voice choice | Implemented but unverified | Installed AVSpeechSynthesis voices; preference stored locally; speaking defaults off |
| Supabase password sign-in and Keychain access token | Implemented but unverified | Existing public project configuration; token stored when-unlocked, this-device-only; administrator verified by backend |
| Six App Intents | Implemented and package-tested; Siri unverified | English metadata generation/archive passes; foreground-only, local-device authentication; actual Siri phrases need device testing |
| Native teaching and pricing UI | Not started | Opens the corresponding authenticated web workspace instead |
| iPhone 16, Siri phrase, microphone, model quality | Blocked | Owner reports iOS 27.0.1; still requires the owner's Mac/Xcode and unlocked iPhone for execution |
| App Store distribution and autonomous client calls | Not started | No enrollment, purchase or telephone integration activated |

## Requirements verified against official Apple documentation

The Foundation Models baseline API is available from iOS 26. It is a native Swift framework, not a browser API. The owner reports **iPhone 16 running iOS 27.0.1**. The hardware is Apple Intelligence eligible, but region/language, Apple Intelligence setting and model download readiness remain unverified. No phone OS update is required solely for Donna. The app evaluates `SystemLanguageModel.default.availability` before every request rather than inferring readiness from the hardware. See [Foundation Models](https://developer.apple.com/documentation/foundationmodels), [SystemLanguageModel availability](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/availability-swift.property), and [Apple Intelligence requirements](https://support.apple.com/en-us/121115).

For the reported iOS 27.0.1 phone, use a stable **Xcode 27.x with an iOS 27 SDK**. Apple's current [Xcode support table](https://developer.apple.com/xcode/system-requirements/) lists Xcode 27, 27.1 and 27.2 with **macOS Tahoe 26.6 or later**. Recheck the selected release's supported Mac and device software before installing. The source uses the iOS 26 API baseline and minimum deployment target, while validation should run on the actual iOS 27.0.1 model. The baseline macOS CI toolchain was verified. No personal Mac, provisioning profile, Apple account, or physical device has been verified.

The app uses a stateful [LanguageModelSession](https://developer.apple.com/documentation/foundationmodels/languagemodelsession) and a [Tool](https://developer.apple.com/documentation/foundationmodels/tool) with generated arguments. Tool arguments are still checked against a hard allowlist. Financial calculations are routed to deterministic web tools; model answers are not treated as verified ledgers. Short bounded model sessions reset after six answers, and the user is told when context resets. Long-term knowledge storage is separate from the language model.

For speech, [supportsOnDeviceRecognition](https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition) must be true before [requiresOnDeviceRecognition](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition) can enforce local transcription. Donna declines audio if that condition fails. Speech and microphone permission are requested only after a tap. Recording stops after a final result, a stop tap, scene deactivation, or 45 seconds. Permission prompts may deactivate the scene; after granting permission, unlock Donna and tap the microphone again. Startup/callback generation guards prevent stale permission completions from starting recording later. The transcript is reviewed before sending. It is not a continuous or interruptible premium voice service. Installed system voice quality and gender vary; select a preferred installed voice and preview it.

On `willDeactivate`/`willResignActive`, an opaque UIKit curtain covers each app window, including sheets. The UI locks, model context and transcripts are cleared, pending response/record tasks are cancelled, and the model's business-read gate closes. Generation checks reject late results. Backgrounding invalidates any pending device-authentication result; successful authentication grants access only after the scene becomes active again. The existing owner access token remains in the device-only, when-unlocked Keychain for later sign-in reuse. This is a source-level privacy design; actual lock-screen and app-switcher redaction has not been device-tested.

## Setup on a Mac and iPhone

1. Use the build instructions in `native/Donna/README.md`. Set your own bundle identifier and signing team. No paid developer membership is required merely to attempt Personal Team device testing.
2. With a free account, Apple's [developer account comparison](https://developer.apple.com/help/account/basics/about-your-developer-account) specifies Personal Team limits including three registered test devices per platform and seven-day profiles. Rebuild and reinstall as profiles expire. App distribution is outside this initial personal-device setup.
3. Open Donna once on the unlocked phone. Ensure Apple Intelligence is enabled and the model is ready. If unavailable, the app shows the state and does not substitute an external model.
4. Configure the **staging** HTTPS backend origin. Configure the existing Supabase public origin and public publishable key. The app rejects secret-key formats, stores no password and uses an ephemeral URLSession with redirects disabled. Sign in as an existing approved owner account. Access tokens expire; this first source version requires signing in again rather than retaining a refresh token.
5. Confirm `/api/donna/status` recognizes your administrator before enabling business read tools. The native Tool cannot choose arbitrary URLs or SQL and cannot write business records. It processes bounded samples locally and makes no claim that those samples represent all business records.
6. In Settings, choose a system voice, preview it, and optionally enable spoken replies. A greeting is spoken only after device authentication and only when spoken replies are enabled.
7. Tap the microphone, approve permissions, say a short request, stop, review and tap Send. If local recognition is unsupported, type instead.

## Siri setup

The native app declares six `AppIntent`s and `AppShortcut`s. Each uses [foreground execution](https://developer.apple.com/documentation/appintents/appintent/supportedmodes) and the stricter [requiresLocalDeviceAuthentication](https://developer.apple.com/documentation/appintents/intentauthenticationpolicy/requireslocaldeviceauthentication) policy. A separate app gate also requests device-owner authentication before showing content. Siri launches the interface; it neither bypasses business sign-in nor starts an always-listening service.

For the exact primary phrase, open **Shortcuts → + → Add Action → Apps → Donna → Donna**, then rename the shortcut **Donna**. Say **“Hey Siri, Donna.”** The declared app phrase also supports **“Open Donna.”** Phrase recognition and collisions with existing shortcuts must be tested on the actual phone.

Create five more shortcuts using the respective native action and name each exactly:

| Shortcut name | Native action | Result |
| --- | --- | --- |
| Donna Morning Briefing | Donna Morning Briefing | Opens the briefing route; tap Load records |
| Teach Donna | Teach Donna | Opens the teaching route with a link to web approval workspace |
| Donna's Tasks | Donna's Tasks | Opens authenticated current tasks |
| Donna Inventory | Donna Inventory | Opens inventory; tap Load records |
| Donna Business Overview | Donna Business Overview | Opens direct invoice record view and deterministic web Pricing link |

The current native briefing is a direct task-record view, not a complete automatically generated briefing across every integration. Use the web briefing for its implemented scope. No notifications are scheduled. A URL-scheme deep link such as `donna://tasks` only changes the route; it does not authenticate, read records or speak private data.

## Required device acceptance tests

These tests have **not been run**. Before using native Donna with confidential data:

- Build and sign for the actual iOS 27.0.1 phone with compatible Xcode, checking its diagnostics beyond the passed baseline simulator check. Run first with read tools disabled. Verify a short conversation works with network disabled when Apple's local model is ready, and verify lack of model readiness has an honest fallback message.
- Check each availability state supported by the actual OS. Test regional/language support, long requests and six-turn context reset. Compare real business-advice answers with expected answers; do not assume cloud-model reasoning quality.
- Deny microphone and speech permissions. Confirm typed chat works. Test a language without local recognition and verify recording is refused. Use network instrumentation to confirm local speech and conversation do not transmit audio/prompts. No paid-provider endpoint exists in this source.
- Test installed voices and spoken greeting. Verify audio stops on inactive/background transitions, stop tap and sign-out. Open Control Center and the app switcher while a response, read or permission prompt is pending. Confirm no stale transcript/record repopulates, no late tool request starts while locked, and no spoken response begins after deactivation.
- Against staging, test expired tokens, invalid credentials, signed-in non-admin and authorized admin. Confirm only allowlisted GET routes are reachable. Verify backend RLS independently before reading any private records.
- Teach a procedure in web mode, leave it pending, confirm it is absent from the native memory tool, approve it, then verify retrieval. Outdated and suggestion memories must remain excluded. Correct/remove it and verify no stale claim survives a new model context.
- Insert a harmless staging record containing “ignore previous instructions.” Verify it is treated as record data. Inspect tool request logs: no custom URLs, writes or unrestricted SQL should be possible.
- Test all six Siri shortcuts from locked and unlocked phone states. Confirm phone unlock and Supabase owner sign-in are still required before private data appears. Check screen lock and app-switcher snapshots, including an open Settings sheet. Device authentication should not loop when its own prompt temporarily deactivates the scene.
- Verify financial questions route to the deterministic Pricing assistant and invoice values are read directly, never calculated by the model. No customer call, send, calendar write, stock update or notification action should be available.

## Remaining work

Sign, install, and run on the owner's Mac and iPhone, measure actual response quality/latency, perform the tests above, and decide whether a native memory editor, deterministic native finance view or securely refreshing session is worthwhile. Investigate newer Apple Speech APIs only after verifying the installed OS; the current implementation uses the established local-recognition path. Public App Store distribution and paid telephony remain separate future proposals requiring explicit authorization.

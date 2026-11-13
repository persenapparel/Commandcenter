# Donna: iPhone setup, verified limits, and costs

Research checked November 12, 2026 (America/New_York). The owner confirmed an iPhone 16 running iOS 27.0.1. Public provider limits below do not establish the owner's billing plan, remaining allowances, or Apple Intelligence readiness. No paid service, deployment, notification schedule, email, or calling integration was activated.

## First launch and Siri

Donna's additive web route is `/donna/`. Before using shortcuts, deploy and validate an approved **staging** version on HTTPS, then replace `https://YOUR-STAGING-HOST` below with its actual origin. These URLs are instructions, not an existing deployment. A localhost address on this development machine will not work on the iPhone.

1. Open `https://YOUR-STAGING-HOST/donna/` in Safari and sign in through the approved Command Center authentication flow. Check that the displayed connection state is accurate.
2. Optionally use Safari's Share menu → **Add to Home Screen**. Confirm the name Donna.
3. Open Apple's **Shortcuts** app. Tap **+**, then **Add Action** (or search actions).
4. Add a **URL** action containing the desired URL below, then **Open URLs** using that URL. Avoid **Get Contents of URL**: a launch shortcut must not fetch or speak private records in the background.
5. Rename the shortcut to the exact corresponding name. Tap it once to test.
6. Say “Hey Siri, Donna” for the first shortcut, or the corresponding name for the others. If Siri resolves the wrong name, use “Run Donna” or adjust the shortcut's name on that device.

| Shortcut name | URL |
| --- | --- |
| Donna | `https://YOUR-STAGING-HOST/donna/?view=voice` |
| Donna Morning Briefing | `https://YOUR-STAGING-HOST/donna/?view=briefing` |
| Teach Donna | `https://YOUR-STAGING-HOST/donna/?view=teach` |
| Donna's Tasks | `https://YOUR-STAGING-HOST/donna/?view=tasks` |
| Donna Inventory | `https://YOUR-STAGING-HOST/donna/?view=inventory` |
| Donna Business Overview | `https://YOUR-STAGING-HOST/donna/?view=overview` |

The shortcut opens Donna. It does not replace Siri, register a permanently listening custom wake word, unlock business access, or guarantee that Safari starts the microphone or speech playback automatically. Tap the microphone or playback control when prompted. Apple documents that a shortcut opening an app on a locked device requests unlocking. Business APIs must still enforce their own authentication and owner authorization. [Apple: run shortcuts with Siri](https://support.apple.com/guide/shortcuts/run-shortcuts-with-siri-apd07c25bb38/ios)

Do not put a password, session, API key, bearer token, customer identifier, or business notes in a shortcut URL. Do not enable locked-device spoken summaries. Native App Intents should explicitly require authentication because their default policy allows locked-device execution. On iOS 26+, `supportedModes = .foreground` brings the app forward; use this instead of relying on deprecated `openAppWhenRun`. [Apple: authentication policy](https://developer.apple.com/documentation/appintents/appintent/authenticationpolicy), [foreground mode](https://developer.apple.com/documentation/appintents/intentmodes/foreground)

## Native on-device intelligence

The owner confirmed **iPhone 16, iOS 27.0.1**. Apple Intelligence readiness is **unknown**. There is no need to upgrade the phone solely for Donna's iOS 26+ baseline APIs. iPhone 16 is Apple Intelligence eligible, but eligibility alone does not make a model ready. Check Settings → Apple Intelligence & Siri. Device language, region, enabled status, downloaded models, and system conditions affect availability. [Apple Intelligence requirements](https://support.apple.com/en-us/121115)

`SystemLanguageModel.default` is Apple's on-device model, available to native apps from iOS 26. Runtime code must inspect `.availability`, including ineligible device and model-not-ready conditions, before starting a session. Current Apple documentation lists different model versions for iOS 26.0–26.3, 26.4, and 27.0; prompts must be checked again after an OS/model update. Donna's default should remain the on-device `SystemLanguageModel`, without an automatic switch to a cloud model. [SystemLanguageModel](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel), [Foundation Models updates](https://developer.apple.com/documentation/updates/foundationmodels)

The native framework supports text generation, summaries, extraction, classification, structured generation, and Swift tool calls. It does not make financial figures reliable. Apple specifically advises against depending on the baseline model for math and logical reasoning. Keep pricing, margins, totals, stock counts, and authorization decisions in deterministic code. Treat recommendations as suggestions and retrieve current records for business facts. [Apple: model capabilities](https://developer.apple.com/documentation/foundationmodels/generating-content-and-performing-tasks-with-foundation-models), [Tool protocol](https://developer.apple.com/documentation/foundationmodels/tool)

Reuse a `LanguageModelSession` for conversational context. Persist only owner-approved memories in Donna's knowledge store; this is retrieval, not retraining Apple's model. Sessions have a limited context window (the cited guide documents 4,096 tokens for the default on-device model), shared by instructions, conversation, tool schemas, and output. Bound retrieved records and recover with a new session or trimmed context when full. [Sessions](https://developer.apple.com/documentation/foundationmodels/languagemodelsession), [context-window management](https://developer.apple.com/documentation/foundationmodels/managing-the-context-window)

An ordinary browser/PWA cannot call this native Swift framework. Donna's web version therefore supplies deterministic tools and honest capability labels. No third-party free AI provider is configured. Any later provider needs a review of data-use terms and explicit approval before confidential data leaves the business infrastructure.

### Mac and signing requirements

Native iOS compilation and personal-device signing require Xcode on a compatible Mac. For this owner's iOS 27.0.1 phone, use a stable Xcode 27 release supporting iOS 27, such as Xcode 27.2 with its iOS 27.2 SDK; Apple's current compatibility table requires macOS Tahoe 26.6+ for Xcode 27, 27.1, and 27.2. Donna can keep an iOS 26 minimum deployment target while being built with a newer SDK. The older Xcode 26/macOS Sequoia 15.6 baseline is not the recommended toolchain for testing this iOS 27 phone. No Mac or physical iPhone is available in this development environment. Linux Swift does not supply Apple's iOS SDKs or establish that a SwiftUI app compiles. [Xcode system requirements](https://developer.apple.com/xcode/system-requirements/)

Sign into an Apple Account in Xcode and choose its Personal Team for personal testing. Apple's free-account limits include 10 App IDs, 3 devices, and up to 3 installed apps per device. Personal provisioning profiles expire after 7 days, requiring rebuilding and reinstalling. Public App Store/TestFlight distribution is outside this free personal-testing path. [Apple developer account overview](https://developer.apple.com/help/account/basics/about-your-developer-account)

Apple Developer Program membership is normally US$99 per year, with local pricing and applicable exceptions. Do not enroll or assume free distribution. Owning or buying a Mac is a separate hardware requirement; this project has not purchased one. [Apple enrollment and fees](https://developer.apple.com/help/account/membership/program-enrollment/)

### Voice and privacy

Native push-to-talk may use Apple Speech plus AVAudioEngine. Require microphone and Speech permissions with purpose strings. For an on-device-only path, first check `SFSpeechRecognizer.supportsOnDeviceRecognition`; only proceed when true, and set `request.requiresOnDeviceRecognition = true`. If local recognition is unavailable, offer typing instead of silently sending audio to a server. [Recognition support](https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition), [require on-device recognition](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition)

Use `AVSpeechSynthesizer` for native responses and list the device's `AVSpeechSynthesisVoice.speechVoices()` for voice selection. Save the selected identifier. Available voices vary by installed system assets; a specific warm female voice cannot be guaranteed before device testing. [Apple speech voices](https://developer.apple.com/documentation/avfaudio/avspeechsynthesisvoice/speechvoices())

The web version uses available browser speech features, subject to Safari/iOS permissions and platform behavior. Web speech recognition may use a platform service and must not be described as guaranteed on-device. Offer keyboard dictation and typing as fallbacks. No speech or microphone capability has been verified on the owner's iPhone 16 in this environment.

## Target additional monthly cost: $0

No new subscription is required by the deterministic web app or on-device model path. This is a target within existing allowances, **not unlimited hosting or a verified $0 bill**. Existing account plans, quotas, other applications sharing them, and present usage still require dashboard verification before staging deployment. Paid accounts may charge for incremental usage despite this application's lack of paid API calls.

| Component | Verified public allowance / requirement | Donna policy |
| --- | --- | --- |
| Apple on-device Foundation Models | Apple describes on-device inference as free of cost and available offline. | Use `SystemLanguageModel.default`; no paid API or cloud fallback. |
| Cloudflare Workers Free | 100,000 dynamic requests/day; 10 ms CPU/invocation. | Share existing quota; stop on failure, never upgrade automatically. |
| Cloudflare Pages Free | 500 builds/month, one concurrent build; static assets free; Functions consume Workers quota. | Use additive static UI; avoid polling and unnecessary builds. |
| Supabase Free | 500 MB database, 1 GB file storage, 50,000 monthly active users, 5 GB uncached + 5 GB cached egress; two active free projects; free projects may pause after one week inactivity. | Reuse approved infrastructure; bounded queries and retention; do not assume a new free project is available. |
| Apple Shortcuts and system speech | Existing supported iPhone/OS features; voices/recognition depend on device assets and availability. | No third-party speech subscription. |
| Personal iPhone build | Free Apple Personal Team; 7-day profile expiry. | Rebuild/reinstall; public distribution disabled. |
| Hosted cloud AI / telephony / paid speech / App Store membership | No service activated or price commitment made. | Disabled until explicit owner approval and reviewed limits. |

Sources: [Apple's free on-device inference statement](https://www.apple.com/newsroom/2025/09/apples-foundation-models-framework-unlocks-new-intelligent-app-experiences/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/), [Supabase pricing](https://supabase.com/pricing).

Check existing Cloudflare Workers & Pages metrics (dynamic requests, CPU, errors, builds) and Supabase organization Usage (database/storage, egress, Auth, functions) before approval and after initial usage. Donna's local/request counters, if shown, are not authoritative provider billing totals. Keep free plans free, do not add paid bindings or payment-enabled fallbacks, and reduce traffic or disable a feature when a quota is reached. No monitoring alert or schedule was enabled as part of this development task.

## Device acceptance checklist: still required

All items below remain **unverified on the owner's iPhone** until performed there.

- Open every shortcut from Siri and confirm the correct Donna screen; repeat from a locked device and confirm authentication protects business information.
- Test Safari and Home Screen layouts, keyboard/dictation fallback, microphone permission denial, audio stop, voice selection persistence, interrupted recognition, and returning from another app.
- On native iOS, record the owner-confirmed iOS 27.0.1 baseline, actual model version and `.availability`; test Apple Intelligence disabled/model downloading, unsupported language, offline operation, and unavailable local recognition.
- Test short factual questions, summarization, approved-memory retrieval, corrections, and source attribution; confirm financial calculations are unchanged by model prose.
- Test full context, a model refusal, permission errors, expired backend session, unavailable network, empty business data, and quota failure. No response may invent records or silently invoke paid services.
- Verify memory approval, edit/version history, export, and deletion. Confirm private data is cleared on sign-out/lock and inaccessible to another user.

## Notifications and future calling

A weekday 6:30 AM Eastern briefing is a preference, not an enabled notification. Use the `America/New_York` time zone (including daylight-saving changes), present the exact schedule, and obtain approval before scheduling delivery or notifications.

Initial free calling assistance can prepare a call script and let the owner initiate an ordinary Phone call. Automated customer calling remains disabled. A later telephony integration needs explicit service-cost approval, customer consent and applicable calling/recording review, owner approval of each recipient and script, identity disclosure, and a tested cancellation path. Do not claim an app can inject Donna's synthesized voice into an ordinary cellular call.

# Donna for iPhone — source implementation

**Status: baseline simulator compilation and Siri metadata packaging pass; physical-device behavior remains unverified.** The [free public-repository macOS check](https://github.com/persenapparel/Commandcenter/actions/runs/43358668136) built this source with Xcode 26.6/iOS 26.5 Simulator SDK and archived its English App Intents metadata without error diagnostics. No app was signed, distributed, or installed. The owner’s iOS 27.0.1 phone still requires a compatible Mac/Xcode and device acceptance testing.

The app targets **iOS 26.0+** with Swift 6 and Apple's Foundation Models SDK. The owner reports **iOS 27.0.1 on iPhone 16**; no phone OS upgrade is needed solely for this app. It provides on-device conversation, an authenticated read-only business tool, local-only push-to-talk, system speech playback, a voice selector, Keychain session storage, a local-device unlock gate, and six foreground App Intents. No cloud AI fallback, telephone service or notification scheduling is present.

See [`../../docs/donna/NATIVE.md`](../../docs/donna/NATIVE.md) for exact setup, limitations and the device acceptance checklist.

## Build on a Mac

1. For the reported iOS 27.0.1 phone, use a stable **Xcode 27.x** release with the iOS 27 SDK and a compatible Mac. Apple's current [support table](https://developer.apple.com/xcode/system-requirements/) lists Xcode 27, 27.1 and 27.2 as requiring **macOS Tahoe 26.6 or later**. Recheck that table for the release you install. The source keeps iOS 26 as its minimum deployment target; do not downgrade or upgrade the phone solely for Donna.
2. Either install XcodeGen and run `xcodegen generate` in this folder, or create an iOS **App**, SwiftUI, Swift project named **Donna** in Xcode. If creating manually, replace its generated app source with all five Swift files in `Donna/`, use `Donna/Info.plist` as the target Info.plist (disable the generated plist), and set deployment target iOS 26.0 and Swift language mode 6.
3. Open `Donna.xcodeproj`, select a unique bundle identifier and your Personal Team under Signing & Capabilities. Connect your iPhone 16, trust the Mac, and enable Developer Mode if Xcode asks.
4. Select the real iPhone as the Run destination, build and run. Foundation Models availability must be checked on the device; a simulator does not establish iPhone model readiness.
5. In Donna Settings, enter the **staging** backend HTTPS origin, existing Supabase HTTPS origin and **public** `sb_publishable_` key. Never use a service-role/secret key. Sign in using an account in the existing `admin_users` allowlist.
6. Only enable **Allow authenticated business read tools** after verifying the staging endpoint. For local-only conversation leave it off; no network access is required by the conversation model.

The app deliberately has no `DEVELOPMENT_TEAM` committed. A free Personal Team may support personal-device testing, but profiles expire after seven days and require rebuilding. Public distribution is a separate decision with separate Apple requirements.

## Backend contract

`GET https://YOUR-STAGING-ORIGIN/api/donna/{tool}` with an existing Supabase bearer token. Known tools are fixed in `BackendClient.swift`; the on-device model sees only `tasks`, `orders`, `inventory`, and `memories`. The backend independently verifies the Supabase user and administrator allowlist. Financial records can be viewed directly but are never calculated by the language model.

Teach Donna and financial calculations open the staging web app at `/donna/?view=teach` and `/donna/?view=pricing`. The native app does not yet implement its own memory editor or financial calculator.

Native transcripts are held in process memory only. There is no silent conversation upload or local durable transcript database. Scene deactivation clears transcripts, model context, input and loaded records; it also cancels pending reads/response tasks, stops audio, and places an opaque privacy curtain over all app windows before app-switcher snapshots. These lifecycle behaviors still require real-device verification. Approved business memory remains in the separate web knowledge store.

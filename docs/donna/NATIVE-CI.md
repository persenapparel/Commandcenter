# Donna native compile check

The isolated Donna branch now has a native compilation workflow at `.github/workflows/donna-native-check.yml`. It is a code check, not app distribution or a website deployment. A workflow definition alone is not proof of successful compilation; inspect the actual run for the commit being reviewed.

## Cost and isolation

GitHub's current documentation states that **standard GitHub-hosted runners in public repositories are free** and do not reduce the account's included private compute usage. Larger runners can incur charges even for public repositories. This workflow uses the standard `macos-26` label and has a job-level guard requiring both the exact `persenapparel/Commandcenter` repository and public visibility. It does not choose larger/self-hosted runners, enable billing, upload artifacts, use Actions caches, or invoke a paid service. It has a 20-minute limit and cancels older runs of the same branch. [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

Only pushes to `codex/project-donna-free-v1` that change native source or this workflow trigger the check automatically. There is no `main`, pull-request, schedule, or deployment trigger. The job has only repository-read permission, does not retain checkout credentials, references no repository secrets, and never contacts Supabase or a hosted Donna backend.

The manually invoked `workflow_dispatch` entry is included for future use. GitHub requires that a manual workflow first exist on the repository's default branch before it can be dispatched. Adding this file only to the isolated Donna branch does not satisfy that registration requirement; the branch-specific push trigger is what permits a compilation check while leaving `main` unchanged. Do not merge the app or a CI file to `main` merely to make the manual button appear. [GitHub: manually running a workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)

## Toolchain

The official `macos-26` runner inventory currently lists stable Xcode 26.6 at `/Applications/Xcode_26.6.app`, with the iOS 26.5 simulator SDK. The workflow selects that installed toolchain explicitly and fails clearly if the runner no longer contains it. Donna's baseline is iOS 26 and these source APIs must compile against that baseline. It does not download a full Xcode installation or silently choose a preview toolchain. [GitHub runner inventory](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-Readme.md)

The owner reports iOS 27.0.1. Stable Xcode 27.x with appropriate device support is still needed for physical-device installation/testing; a successful Xcode 26 baseline simulator build is not an iOS 27 device compatibility result. Apple's current Xcode table lists the supported SDK, host macOS, and device versions. There is no need to update the iPhone solely to run this compilation check. [Apple Xcode requirements](https://developer.apple.com/xcode/system-requirements/)

Project generation uses [XcodeGen 2.46.0](https://github.com/yonaskolb/XcodeGen/releases/tag/2.46.0), downloaded from the project's official release with SHA-256 `4d9e34b62172d645eed6457cac13fc222569974098ef4ee9c3368bedf0196806`. The published release digest was checked against the downloaded bytes during preparation. The checkout action is pinned to v4.2.2's immutable commit.

## What the check proves

The job generates `Donna.xcodeproj` from the checked-in specification and runs `xcodebuild` for a generic iOS Simulator destination with code signing disabled. No Apple developer credentials or distribution membership are needed for this step. Logs and the Actions result show compiler errors or success.

The first native compile run passed compilation but emitted an App Intents SSU archive error even though `xcodebuild` returned success. Donna's hand-authored Info.plist did not declare a development language or supported localization. The project now explicitly declares its English UI/shortcut language (`developmentLanguage`, `CFBundleDevelopmentRegion`, and `CFBundleLocalizations`) rather than disabling Siri phrase training. Apple's bundle guidance calls for the default localization and explicitly supported languages when an app has no localized resource folders. This configuration change still requires a subsequent runner result to establish that it resolves the observed archive failure. [Apple: determining an app's language](https://developer.apple.com/library/archive/qa/qa1828/_index.html)

The workflow also preserves the build log, checks that an App Intents metadata package exists, lists its file names/sizes, and fails if Xcode emitted any `error:` diagnostic despite a zero exit status. These logs contain only source/build metadata; no compiled app, metadata archive, or log artifact is uploaded. Successful compilation alone is not accepted as successful Siri metadata packaging.

Even a successful run does **not** prove:

- The model is ready on the owner's iPhone, or that reasoning/memory/tool behavior is reliable.
- Speech recognition stays local on an actual device, system voices sound as preferred, or Siri opens the right screen.
- Face ID/lock-screen/app-switcher privacy works as intended.
- The app can be installed without personal-device signing on a compatible Mac.
- Any hosted backend, persistent Donna schema, or business-record integration is deployed or accepted.

Continue the physical-device checklist in [NATIVE.md](NATIVE.md) and [TESTING.md](TESTING.md). Keep the distinction between a compiler result and actual iPhone testing explicit.

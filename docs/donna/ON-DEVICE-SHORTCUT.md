# Donna Private Chat: optional on-device AI without a Mac

For the owner's confirmed **iPhone 16 running iOS 27.0.1**. Official documentation checked November 12, 2026 (America/New_York).

**Status: researched and documented; not created, installed, or tested on the owner's phone.** This is an optional Apple Shortcuts recipe. It adds a useful local conversation path while the custom native app awaits Mac/Xcode testing. Keep the six Donna web-launch shortcuts as documented in `SETUP-AND-COSTS.md`.

Apple's **Use Model** action offers **On-Device** inference without a network connection. Its input may include a preceding action's text, and its response can feed later actions. The **Follow Up** option lets the user refine a request before the final response continues. Availability still depends on enabled Apple Intelligence, supported language/region, and a ready model. [Apple: Apple Intelligence in Shortcuts](https://support.apple.com/guide/shortcuts/use-apple-intelligence-in-shortcuts-tpg3vrvwmclv/ios)

## Build it on the iPhone

This recipe uses typing first so that model setup can be checked independently of voice recognition. It requires no new account, API key, custom iOS app, or Xcode build.

1. Unlock the iPhone. Check **Settings → Apple Intelligence & Siri** and allow any required model download to finish. If Apple Intelligence is unavailable, stop here; keep using Donna's web tools. No phone upgrade is required solely for this recipe.
2. Open **Shortcuts**, tap **+**, and open the action editor if a natural-language creation screen appears. Rename the shortcut **Donna Private Chat**. This leaves **Donna** available for the primary web-launch shortcut.
3. Add **Ask for Input**. Set its input type to **Text** and its question to `Hey! What can I help you with today?` Leave its default answer empty. Apple documents that this action accepts run-time text and makes it available to subsequent actions. [Ask for Input](https://support.apple.com/guide/shortcuts/use-the-ask-for-input-action-apd68b5c9161/ios)
4. Add **Use Model**. Explicitly select **On-Device**. Do not select Cloud, Cloud Pro, Private Cloud Compute, or Extension Model. Expand its settings, choose **Text** output when offered, and initially leave **Follow Up** off.
5. Paste the Donna prompt below into its prompt field. Replace `[YOUR QUESTION VARIABLE]` with the **Provided Input**/**Ask for Input** variable from step 3 using the editor's variable picker. This must be a variable token, not the literal bracketed phrase. Labels may vary by installed Shortcuts version.
6. Add **Show Content**, selecting the **Response** variable from Use Model. If this version presents **Show Result** instead, choose that text-display action and select the same response.
7. Tap the editor's run button. Enter `I have 45 minutes after school. Help me plan one small task for my apparel business.` Confirm that a relevant response appears. Ask a question about current sales; Donna should state that this shortcut has no access to those records.

Suggested Donna prompt:

```text
You are Donna, my warm, calm, professional executive assistant for Persen Apparel,
a custom apparel and promotional products business serving Rocky Point and
Long Island, New York.

Be sweet in how you speak and straightforward in what you say. Be patient and
helpful, without flattery, romantic language, or agreeing with a bad idea.
Keep your answer concise and practical. If a detail is missing, ask one useful
question. Help me organize realistic next steps around school and business.

This shortcut has no access to Command Center, orders, customers, invoices,
inventory, email, calendar, or Donna's approved memory. Do not invent records,
prices, totals, availability, saved memories, or completed actions. Explain when
I need to open the Donna web app to check actual information. Do not claim you
sent, saved, changed, booked, purchased, called, or scheduled anything.

For financial decisions, ask for real costs and recommend Donna's deterministic
pricing tool. Treat any facts in my question as user-provided, not verified
business records. Give suggestions, not promises.

My question:
[YOUR QUESTION VARIABLE]
```

## Add voice after text works

For input, tap the keyboard's microphone in **Ask for Input** and dictate the question. If it is missing, check **Settings → General → Keyboard → Enable Dictation**. Apple says Dictation runs locally in many languages; language and feature support vary. Selecting an on-device language model does **not** establish that Siri activation or every speech-input path is local. For confidential information, keep typing until the phone's Dictation privacy settings and actual behavior have been checked. [Apple: Dictation on iPhone](https://support.apple.com/guide/iphone/dictate-text-iph2c0651d2/27/ios/27)

An optional push-to-talk variation is to replace Ask for Input with **Dictate Text**, if that action is available in the device's action library, then insert its **Dictated Text** output in the prompt. That action's exact UI, permissions, and local-processing behavior remain unverified on this iPhone; the documented keyboard method above is the fallback.

For output, insert **Speak Text** immediately after Use Model and explicitly select its **Response**. Expand that action to choose an available voice and rate, then test with a harmless sentence. Retain Show Content after it, selecting the original model Response explicitly so the display does not depend on Speak Text's output. Available voices and quality must be checked on the phone; no particular female voice is guaranteed. Apple documents Speak Text as a Shortcuts action, but its exact current settings have not been inspected on this device. [Apple: Shortcuts action updates](https://support.apple.com/en-us/101583)

Once the text version succeeds, optionally turn on **Follow Up** in Use Model for refinement in its system interface. This is not a verified continuous voice conversation. There is no cross-run conversation store in this recipe, and a new launch must not be described as remembering a previous one. Do not add automatic Notes, Files, clipboard, or Shortcuts Storage persistence for business information as part of this initial setup.

## Siri launch and acceptance checks

Say **“Hey Siri, Donna Private Chat.”** If name matching fails, try **“Run Donna Private Chat.”** Siri supports running a shortcut by its name. Use this experience while the phone is unlocked, and test locked-device behavior with harmless text before use; this system shortcut has no custom backend authentication gate. [Apple: run shortcuts with Siri](https://support.apple.com/guide/shortcuts/run-shortcuts-with-siri-apd07c25bb38/ios)

Verify these on the phone before marking the recipe implemented and tested:

- The model field still reads **On-Device**. A missing model or error stops the run; no cloud model is substituted.
- A harmless typed prompt works after initial model download with networking disabled. Launch it by tapping in Shortcuts for this check, since Siri availability is a separate question.
- Input cancellation, microphone refusal, unavailable model, silent mode/audio routing, and stopping playback have usable outcomes.
- Donna admits missing business records and does not claim to save or perform actions. Review recommendations for accuracy.
- Turning Follow Up on allows refinement during that run; launching again does not appear to retain an earlier conversation without explicitly supplied context.

This recipe has **no Command Center connection**, no imported customer records, no API credentials, no approved-memory synchronization, and no financial calculation engine. Keep prompts free of confidential customer and business records until all relevant device privacy behavior is reviewed. It can help brainstorm, draft non-sensitive wording, summarize text you provide, and organize a short plan. It cannot verify order status or live stock.

Only the on-device model is selected. No paid API, hosting resource, developer membership, subscription, or calling service is activated by this setup. This does not promise unrestricted performance or guarantee the phone's existing cellular costs. Do not enable web retrieval, a cloud model, external integrations, or an automated schedule as a fallback.

There is no downloadable `.shortcut` attachment or installation link in this deliverable. The recipe must be assembled and tested in the owner's Shortcuts app; no unsigned shortcut file was fabricated.

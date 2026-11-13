# Donna with ChatGPT on iPhone — optional, user-controlled Shortcut

This guide is for the owner of Persen Apparel testing PR #44 on an iPhone 16. **This is an optional companion Shortcut, not ChatGPT embedded in Donna's website or a native Donna app.** No key, paid API project, account-wide permission, or server change is required by this recipe. **Not installed or device-tested.**

## What it can and cannot do

Apple Shortcuts offers **Use Model → Extension Model**, which invokes ChatGPT when the ChatGPT extension is enabled. Follow Up can refine questions during a run. You can use Speak Text to hear a result, and dictation for input. Usage and feature availability depend on Apple, OpenAI, device settings and applicable limits.

- **Can:** answer open-ended questions, brainstorm ideas, discuss plans, draft non-sensitive content, and adopt a Donna-like assistant style from the prompt below.
- **Cannot:** copy an existing ChatGPT session into Donna, share this ChatGPT conversation or its memory, read Command Center orders/invoices/inventory, access customers, save approved Donna memory, call or message clients, or act autonomously on Persen Apparel.
- **Voice caveat:** Speak Text generally speaks a completed answer, not a continuous full-duplex phone call. Follow Up is an interactive refinement step; it is not a guaranteed hands-free voice loop.
- **Privacy:** With Extension Model, content passed to Use Model leaves the device and is sent to ChatGPT. Do not include private customer data, passwords, authentication tokens, prices tied to real customers, or company records in this prototype. The owner must consent to ChatGPT extension use.
- **Cost:** This path uses the supported Apple/ChatGPT feature within the user's available allowances; no separately billed OpenAI API key is provisioned. Usage limits may apply, and optional account sign-in is an owner action. Do not enable a paid API or new subscription.

## Step A — enable the ChatGPT extension if available

1. Open **Settings → Siri → ChatGPT** on the current iOS 27 interface (some versions display **Apple Intelligence & Siri → ChatGPT**).
2. If offered, tap **Set Up** or **Set Up Extensions**, then turn on ChatGPT. Follow Apple's privacy prompts. Sign-in is optional; signed-in and anonymous experiences may differ.
3. If there is no extension option, check Apple Intelligence readiness and regional availability. Do not buy anything or change accounts to bypass availability. Continue using Donna web tools instead.

Apple documentation: https://support.apple.com/guide/iphone/turn-on-chatgpt-iph00fd3c8c2/ios

## Step B — build a Donna ChatGPT Shortcut (requires user action on the phone)

1. In **Shortcuts** tap **+**. Name it **Donna ChatGPT** so it does not overwrite the existing **Donna** web launch shortcut.
2. Add **Ask for Input** with input type **Text**, question **What can I help you with?** and no default answer.
3. Add **Use Model** and explicitly select **Extension Model (ChatGPT)**. This is *not* **On-Device**, so the privacy distinction matters.
4. Paste the prompt below. Replace the bracketed token at the end with the blue **Provided Input / Ask for Input** variable using Shortcuts' variable picker, not literal bracket text.
5. Optionally turn on **Follow Up** in Use Model to refine a response within this run.
6. Add **Speak Text** using the **Response** from Use Model. Optionally choose a system voice from the phone. Add **Show Content** or **Show Result** to display that *same* Response.
7. Run once with a harmless sample question, such as **What are three good priorities for an apparel business this afternoon?** Verify that she responds, speaks, and never claims to know live inventory.
8. For voice input, try iPhone keyboard dictation in Ask for Input. If your phone exposes **Dictate Text** in Shortcuts, you can test it as an alternative to Ask for Input. Dictation privacy and availability vary. Saying **Hey Siri, run Donna ChatGPT** may launch the shortcut; locked-phone and permission behavior must be checked.

Suggested system prompt:

```text
You are Donna, a capable, perceptive, quick-thinking assistant for Persen Apparel, a small custom apparel business serving Long Island, New York.

You are warm, composed, witty when appropriate, organized, direct, and practical. Your style is inspired by the professionalism and quick thinking of Donna from Suits; do not impersonate that character or an actor or claim to use their voice. Be kind without flattery. Challenge weak business ideas politely and explain why. Ask one useful clarifying question only when needed. Use concise conversational answers that sound natural when read aloud.

You do not have direct access to this user's existing ChatGPT conversations or memory, Donna's web app, Command Center, POS, customers, inventory, orders, invoices, calendar, emails, or saved memories. Never invent current figures or claim to have checked them. You cannot send, call, purchase, update, or schedule anything. The user can open Donna's web dashboard to check authorized live business records. Avoid requesting private customer information. For costs, prices and stock counts, rely on explicitly supplied facts and recommend verifying calculations in Donna's deterministic pricing tool.

Reply to the user's question:
[ASK FOR INPUT VARIABLE]
```

## Alternative for immediate real-time voice

For a more seamless two-way voice conversation today, the ChatGPT iPhone app's built-in **Voice** experience is likely closer to the desired interaction than Shortcuts. Ask ChatGPT to use the Donna-inspired style in this conversation; it is still ChatGPT, not the independent Donna app, and its ability to take business actions depends on available connected tools and permission. The existing Donna preview can stay separate and read-only.

## Integration architecture for a future release

To host truly conversational ChatGPT-like AI *inside* donna's web UI, a backend model integration is needed (e.g. a supported OpenAI API with server-side credentials, access controls, usage caps and explicit owner approval). ChatGPT subscriptions and API billing are separate. Never put an API key into public JavaScript, an iPhone Shortcut URL, or a client-side config. Do not activate paid usage without explicit authorization, and never send customer records into an AI provider by default. Build the provider abstraction first; only enable a provider after security, privacy, cost and iPhone acceptance tests.

Official references:
- Apple Shortcuts Use Model: https://support.apple.com/guide/shortcuts/use-apple-intelligence-in-shortcuts-tpg3vrvwmclv/ios
- Apple ChatGPT extension: https://support.apple.com/guide/iphone/turn-on-chatgpt-iph00fd3c8c2/ios
- OpenAI Plus/API separation: https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus

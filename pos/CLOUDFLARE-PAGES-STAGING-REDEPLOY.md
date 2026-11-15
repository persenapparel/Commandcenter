# Persen POS staging — Cloudflare Pages redeploy note

This document records a new GitHub commit on the dedicated POS staging branch so Cloudflare Pages Git integration can pick up the latest branch state after configuring its environment variables.

Project: persen-pos-staging
Repository: persenapparel/Commandcenter
Branch: feature/persen-pos-foundation
Framework preset: None
Build command: node pos/build-pages.mjs
Build output directory: pos-dist
Root directory: repository root (leave blank)

Cloudflare Pages > Settings > Environment variables (Production):
- POS_SUPABASE_URL = https://naaqcspvbntzdtwuchrr.supabase.co
- POS_SUPABASE_PUBLISHABLE_KEY = the **staging** sb_publishable_... key from Supabase Project Settings > API Keys

Do not commit keys, passwords, Resend keys, or service-role secrets. The publishable key must be supplied through Cloudflare settings, not entered into GitHub.

Before any customer or owner data is entered on the staging site:
- Protect the exact pages.dev production hostname and branch preview URLs with Cloudflare Access.
- Verify signed-out access is denied.
- Create and authorize a separate staging owner account.
- Check email/receipt and real device printing before accepting real transactions.

This note does not deploy production, modify DNS, or merge the draft POS PR.

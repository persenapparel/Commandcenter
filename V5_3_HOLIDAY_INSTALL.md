# Persen Apparel V5.3 — Full Holiday Homepage Studio

## What changed
- 17 pre-designed seasonal homepage presets with decorative border artwork and matching illustrative clothing scenes.
- Included: Christmas, Winter, Thanksgiving, Halloween, Valentine's Day, New Year's, St. Patrick's Day, Easter, Mother's Day, Father's Day, Memorial Day, Fourth of July, Labor Day, Spring, Summer, Fall, and Custom.
- Holiday Studio in Persen Command Center: select a preset, edit the large homepage headline, banner text and style, colors, animation, apparel scene toggle, gallery image override, call-to-action copy, schedule, and draft/publish state.
- Existing V5.2 business features and database data are preserved. The update does not add any new database tables or require a migration.
- The campaign header banner directs customers to quote requests or collections. Quote requests remain directed to Persen Command Center when signed in.

## What the artwork is
All included garment scenes are illustrated/sample mockups derived from the project's built-in garment imagery. They are not photographs of completed Persen Apparel orders. Replace with your own high-resolution approved photos when available. Do not imply these are finished customer orders.

## How to preview without deploying anything
1. Download and extract `Persen_Apparel_V5_3_Holiday_Preview.zip`.
2. Double-click `holiday-theme-preview.html`.
3. Use the dropdown at the top to compare all 17 seasonal presets.
No account, database, internet connection, or GitHub change is needed for this local preview.

## Recommended installation — do not overwrite `config.js`
1. Save copies of both existing GitHub repositories before changing anything.
2. Extract `Persen_Apparel_V5_3_Storefront_Deploy.zip` and replace matching files in the **website** repository. Keep the existing `config.js` unchanged. Commit, and wait for Cloudflare Pages to deploy the preview build.
3. Extract `Persen_Apparel_V5_3_Command_Center_Deploy.zip` and replace matching files in the **command-center** repository. Keep its existing `config.js` unchanged. Commit, and deploy its Pages preview build.
4. Test Command Center → Seasonal Studio: choose Halloween or Christmas, customize details, **save a draft**; check preview; then test a published campaign with a short future date window on your preview domain.
5. Verify the matching website homepage appears, banner links open the correct destination, seasonal collection detail opens, and normal homepage returns outside campaign dates.
6. Check desktop and mobile; confirm accessible animations stop with reduced-motion preference. Use two test accounts to validate quotes and customer privacy. Do not switch your actual domain DNS until all production tests and backups are complete.

## Notes
- No new Supabase migration is required. Existing seasonal_campaigns_v1 JSON is normalized backward compatibly, so existing campaigns are not wiped.
- Gallery photo uploads require the existing `site-photos` storage configuration and owner permissions.
- Campaign dates use the America/New_York timezone. If two live homepage campaigns overlap, the latest start date takes precedence.
- This package does not include `config.js` or sensitive credentials.
- Security, backups, invoice legal review and real quote submission still require deployment testing before receiving real customer data.

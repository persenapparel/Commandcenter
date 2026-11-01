# Persen Apparel V5.4 — Website & Business Experience

## Overview
This release builds on **V5.3** and includes all 17 holiday presets plus the V5.4 public gallery, carousel, events, reviews, account promotion, About Us expansion, limited-product pricing and purchase-request workflow, and the owner **Site Studio**.

### V5.4 features
- Public **Our Work** photo gallery with owner-published real images, descriptive captions, categories, and display order.
- Photo carousel sections and editable photo placements for Home, Apparel, Design Lab, Sports, Businesses, Our Work, About, Events, Limited Collections, Quotes, Account, Help, Privacy, and Quote List.
- Editable promotional banners for selected pages (photo, text, button destination, scheduled start and end).
- **Upcoming Events** page (event date, time, location, optional photo and external event information link); automatically hides past events.
- **Google reviews**: owner may paste a genuine Google Business Profile “Ask for reviews” link, then select and attribute authentic customer review excerpts with links to their originals. **Not an automatic Google API review sync.** Use actual reviews only and confirm your right to display them.
- Expanded **About Us** page with business values, photos, Instagram and TikTok @persenapparel.
- Account sign-up promotion on the homepage and About page. Saved designs and quote tracking use existing Supabase Auth.
- Individual **Limited Collection** products: photo, title, description, visible USD price, selected seasonal campaign, draft or publish. This is the ONLY public apparel pricing feature; custom apparel remains by private quote.
- **Request to Buy** opens a signed-in customer form for item/size/quantity/name/phone/fulfillment/notes. This inserts a normal `quote_requests` record, category “Limited collection purchase request”, visible in Persen Command Center → **Quotes**. There is no payment checkout, purchase confirmation, inventory reservation, or automatic invoice. Owner confirms all details manually. Customers must log in to submit.
- More powerful **Command Center → Site Studio**, with editable entries, photo uploads into existing `site-photos` storage bucket, per-page placement, draft/publish, and deletion.

## Installation: KEEP YOUR EXISTING CONFIGURATION
1. Create a backup/copy of both GitHub repositories and your current Supabase business data first.
2. Extract **Persen_Apparel_V5_4_Storefront_Deploy.zip** and upload its contents to your private GitHub repository `persenapparel/website`, replacing matching files. **Do not remove or replace your existing `config.js`.** This ZIP intentionally excludes it.
3. Extract **Persen_Apparel_V5_4_Command_Center_Deploy.zip** and upload its contents to `persenapparel/command-center`, replacing matching files. Keep its existing `config.js`.
4. Wait for the two Cloudflare Pages preview deployments. Verify the storefrontUrl in your Command Center config.js points to the *preview* website for testing; do not switch live DNS yet.
5. Open Command Center → **Site Studio**. Start with Photo Portfolio & Carousels. Upload ONE photo of a completed project you have rights to display, assign it to the homepage, save as **Draft**, then edit it and click **Publish**. Reload the preview storefront; check that the carousel works.
6. Add a test event and a sample draft banner. Only publish real event announcements after verifying dates.
7. Paste your actual Google review link. For published on-site review excerpts, include the original review link and correct reviewer attribution; do not fabricate or rewrite reviews.
8. Create a draft Christmas or winter campaign in **Seasonal Studio**. Under **Site Studio → Limited Collection Items**, add a test product with a test price, choose that campaign, set Publish. Publish the campaign with a staging date range to view the item.
9. Use a test customer Auth account (not the owner account) to click **Request to Buy**. Confirm the data appears in **Command Center → Quotes**, including item, price, size, quantity, contact, and fulfillment; ensure there is no charge or automatically confirmed purchase.
10. Test mobile navigation, images, reviews, events, banner links, login, customer records and direct API/RLS security with at least two separate customer accounts. Test automatic return to the normal homepage after a holiday ends.
11. Only after all legal, security, backup, email, privacy, and accessibility tests pass should you point persenapparel.com to the replacement site.

## Storage, safety, and limitations
- **No new Supabase SQL migration is required** for V5.4. The additional content is stored in JSON text values in your existing `public.site_content`, which existing owner RLS permissions must allow writing. Public users need read access to the published content as already configured in V5.
- Photo upload requires the pre-existing **site-photos** Storage bucket and owner upload policies. JPG, PNG, or WebP images must be under **5 MB**. Uploaded assets are PUBLIC and need customer permissions where appropriate.
- Leaving “Publish” unchecked keeps an entry hidden. Saving a published entry makes it public immediately. Website changes may need a refresh because there is no realtime subscription.
- Limited product entries only appear if both the item and corresponding seasonal campaign are published and the campaign date range is active. Prices are advertised per item, with availability and any additional charges confirmed manually.
- Review excerpts are manually curated. There is **no live Google review syncing**, automatic Google rating, or unverified review feed. For a true live Google Places API integration, additional setup, billing where applicable, attribution, policies and legal review are necessary.
- Removing a photo listing does not remove the uploaded photo file from storage. The existing Photo Library lets owners manage stored assets; do not delete any photo that other pages or campaigns still use.
- The Command Center Site Studio preview buttons open the configured storefrontUrl, not an internal simulated preview. Always verify with a staging domain before publishing changes.
- These packages include NO `config.js`, database passwords, API secrets or Supabase service-role keys. Existing security policy tests still require independent live verification. Supabase RLS is NOT proven safe by browser display tests.
- Electronic signature terms and business sale obligations need authorized adult/legal review before taking live orders. This release does not change the existing signature workflow.

## Testing performed (local only)
- Node.js JavaScript syntax checks of both storefront and Command Center.
- Local browser mock tests of Site Studio saving photos, events, review link and excerpt, and priced limited collection product; storefront displays home carousel, Google review CTA, reviews, events, About page, limited-item price and purchase request; verifies request details reach mocked quote submission; checks mobile width and browser exceptions.
- The V5.3 holiday seasonal date/publish logic test passed.
- **Not tested:** real Cloudflare deployments, Supabase Storage authorization and uploads, live RLS/API security, real Google reviews API, actual customers, production domain or payment workflows (not offered).

## Recommendation
Keep using Cloudflare Pages for the public site and Command Center. Keep your existing Supabase database and credentials. Do not put the public website on a personal Windows laptop server just to use this feature update.

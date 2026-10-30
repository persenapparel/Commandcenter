DEPLOY THIS FOLDER AS A SEPARATE WEBSITE
This folder contains a self-contained copy of the Persen Apparel owner dashboard.
You can deploy it as a SECOND Cloudflare Pages project, with build output "admin-portal".
Then add custom domain admin.persenapparel.com in Cloudflare Pages.
The public storefront is located at the parent folder's index.html.
Both sites must have the SAME Supabase URL and publishable key in config.js.
Admin access is enforced by Supabase RLS with an admin_users allowlist.
Never put a Supabase service_role/secret key into config.js.
See the top-level SETUP.md for step-by-step instructions.

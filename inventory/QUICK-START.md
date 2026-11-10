# Persen Inventory Hub — quick guide

## Command Center → Inventory
- **Blanks:** garments and supplies that are not ready to sell. They do not appear as POS products.
- **Sales Products:** finished stock you can sell. Select **+ Add Product** or a product's **✎ Edit**, enter its selling price, colors, and quantities by size. The screen sums the total and saves all size edits in one database transaction.
- **Event Quick Tiles:** create/select an event, check 3 or more Sales Products, and click **Save POS Quick Tiles**. Activate the correct event before a show. This chooses what appears first on POS; it does not reserve or deduct inventory.

## Important about POS staging
The current customer storefront and Command Center use Supabase project `icxeuhkqxxhdkfdappio`.
The POS developer branch currently uses its separate staging project `naaqcspvbntzdtwuchrr`.
Both databases now have matching inventory tables and owner-only operations, but **they do NOT share quantities**. Adding a Sales Product to production Command Center will not appear in the staging POS until the POS has been safely reviewed, pointed to the shared production database, deployed, and verified. Do not swap POS credentials to production merely to make a tile appear.

## POS after release
The POS event tile feature lives on `feature/persen-pos-foundation` and must pass its security checks, customer iPad pairing tests, cash settlement and hardware printing tests before being used for real sales. When released against the same database, it will:
- display only Sales Products, never blanks;
- use the price and stock saved in Inventory Hub;
- put the selected event's chosen products first as quick tiles;
- let a cashier search other Sales Products and choose size/color;
- deduct stock only after a valid completed cash transaction (not on quote requests or draft checkouts).

Nothing in this upgrade authorizes charging cards, auto-confirming Venmo/Apple Cash payments, or real receipt printing without separate testing.

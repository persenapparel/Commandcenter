-- Persen Inventory Hub: two stock categories and event-specific POS quick-tile selections.
-- Non-destructive; existing stock_items remain the source of on-hand quantities.
create table if not exists public.inventory_catalog (
  name text primary key,
  inventory_type text not null default 'blanks'
    check (inventory_type in ('blanks','sales')),
  price_cents integer check (price_cents between 0 and 100000000),
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint inventory_catalog_name_len check (length(btrim(name)) between 1 and 140)
);
create unique index if not exists inventory_catalog_name_ci on public.inventory_catalog (lower(name));
alter table public.inventory_catalog enable row level security;
drop policy if exists "persen owners manage inventory catalog" on public.inventory_catalog;
create policy "persen owners manage inventory catalog" on public.inventory_catalog
  for all to authenticated using (public.is_persen_admin())
  with check (public.is_persen_admin());

create table if not exists public.inventory_event_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  event_date date,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_event_profiles_name_len check (length(btrim(name)) between 1 and 100)
);
create unique index if not exists inventory_event_profiles_name_ci
  on public.inventory_event_profiles(lower(name));
create unique index if not exists inventory_one_active_event
  on public.inventory_event_profiles(active) where active;
alter table public.inventory_event_profiles enable row level security;
drop policy if exists "persen owners manage inventory event profiles" on public.inventory_event_profiles;
create policy "persen owners manage inventory event profiles" on public.inventory_event_profiles
  for all to authenticated using (public.is_persen_admin())
  with check (public.is_persen_admin());

create table if not exists public.inventory_event_quick_products (
  event_id uuid not null references public.inventory_event_profiles(id) on delete cascade,
  product_name text not null references public.inventory_catalog(name) on delete cascade,
  sort_order integer not null default 0 check(sort_order between 0 and 100),
  primary key(event_id,product_name)
);
create index if not exists inventory_event_quick_products_name_idx
  on public.inventory_event_quick_products(product_name);
alter table public.inventory_event_quick_products enable row level security;
drop policy if exists "persen owners manage event quick products" on public.inventory_event_quick_products;
create policy "persen owners manage event quick products" on public.inventory_event_quick_products
  for all to authenticated using (public.is_persen_admin())
  with check (public.is_persen_admin());

grant select,insert,update,delete on
  public.inventory_catalog,public.inventory_event_profiles,public.inventory_event_quick_products
  to authenticated;
revoke all on public.inventory_catalog,public.inventory_event_profiles,public.inventory_event_quick_products from anon;

comment on table public.inventory_catalog is
 'Owner-only classification and pricing of existing stock groups. Quantities stay in stock_items.';
comment on table public.inventory_event_quick_products is
 'Owner-only event-specific POS quick tiles; a selection does not move or reserve stock.';

-- Ephemeral PostgreSQL 17 test-only fixtures. NEVER run in Supabase production.
create schema auth;
create role anon nologin;
create role authenticated nologin;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create function public.is_persen_admin() returns boolean language sql stable as $$
 select coalesce(auth.uid()='11111111-1111-4111-8111-111111111111'::uuid,false)
$$;
create table public.stock_items(
 id uuid primary key default gen_random_uuid(),
 sku text not null unique,
 product_name text not null,
 color text not null default '',
 size text not null default '',
 quantity integer not null default 0,
 updated_at timestamptz not null default now()
);
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111');
insert into public.stock_items(id,sku,product_name,color,size,quantity)
values ('22222222-2222-4222-8222-222222222222','POS-TEST-M','POS Integration Hoodie','Green','M',5);
grant select on public.stock_items to authenticated;

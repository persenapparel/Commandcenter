-- Persen POS v1: REVIEW BEFORE APPLYING. No live changes were made by committing this file.
-- Only cash is supported. Never mark electronic payments as paid without provider verification.
-- Financial snapshots are append-only; editable receipt designs live in separate table.
create table if not exists public.pos_registers(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 display_secret uuid not null unique default gen_random_uuid(),
 label text not null default 'Front register' check(length(label) between 1 and 80),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists public.pos_checkouts(
 id uuid primary key default gen_random_uuid(),
 register_id uuid not null references public.pos_registers(id),
 owner_id uuid not null references auth.users(id),
 status text not null default 'awaiting_customer' check(status in ('awaiting_customer','contact_received','completed','cancelled')),
 items jsonb not null,
 discount_bps integer not null default 0 check(discount_bps between 0 and 10000),
 tax_milli integer not null default 0 check(tax_milli between 0 and 20000),
 subtotal_cents integer not null default 0 check(subtotal_cents>=0),
 discount_cents integer not null default 0 check(discount_cents>=0),
 tax_cents integer not null default 0 check(tax_cents>=0),
 total_cents integer not null default 0 check(total_cents>=0),
 phone text,
 email text,
 marketing_opt_in boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists pos_one_open_checkout on public.pos_checkouts(register_id) where status in ('awaiting_customer','contact_received');
create table if not exists public.pos_sales(
 id uuid primary key default gen_random_uuid(),
 checkout_id uuid not null unique references public.pos_checkouts(id),
 owner_id uuid not null references auth.users(id),
 snapshot jsonb not null,
 subtotal_cents integer not null,
 discount_cents integer not null,
 tax_cents integer not null,
 total_cents integer not null,
 payment_method text not null check(payment_method='cash'),
 created_at timestamptz not null default now()
);
create table if not exists public.pos_receipt_templates(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 name text not null check(length(name) between 1 and 80),
 headline text not null default 'YOU LOOK GOOD IN PERSEN!',
 promotion text not null default 'See new drops at persenapparel.com',
 footer text not null default 'Made with care on Long Island',
 active boolean not null default false,
 updated_at timestamptz not null default now()
);
create unique index if not exists pos_one_active_receipt on public.pos_receipt_templates(owner_id) where active;
alter table public.pos_registers enable row level security;
alter table public.pos_checkouts enable row level security;
alter table public.pos_sales enable row level security;
alter table public.pos_receipt_templates enable row level security;
revoke all on public.pos_registers,public.pos_checkouts,public.pos_sales,public.pos_receipt_templates from anon,authenticated;
grant select,insert,update on public.pos_registers to authenticated;
grant select on public.pos_checkouts,public.pos_sales to authenticated;
grant select,insert,update,delete on public.pos_receipt_templates to authenticated;
create policy pos_register_owner_select on public.pos_registers for select to authenticated using(owner_id=(select auth.uid()) and public.is_persen_admin());
create policy pos_register_owner_insert on public.pos_registers for insert to authenticated with check(owner_id=(select auth.uid()) and public.is_persen_admin());
create policy pos_register_owner_update on public.pos_registers for update to authenticated using(owner_id=(select auth.uid()) and public.is_persen_admin()) with check(owner_id=(select auth.uid()) and public.is_persen_admin());
create policy pos_checkout_owner_select on public.pos_checkouts for select to authenticated using(owner_id=(select auth.uid()) and public.is_persen_admin());
create policy pos_sale_owner_select on public.pos_sales for select to authenticated using(owner_id=(select auth.uid()) and public.is_persen_admin());
create policy pos_template_owner on public.pos_receipt_templates for all to authenticated using(owner_id=(select auth.uid()) and public.is_persen_admin()) with check(owner_id=(select auth.uid()) and public.is_persen_admin());
-- All sensitive mutations run in carefully scoped RPCs; clients cannot edit checkout totals, status, or sales directly.
create or replace function public.pos_begin_checkout(p_register uuid,p_items jsonb,p_discount_bps integer default 0,p_tax_milli integer default 0)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.pos_registers; line jsonb; sid uuid; qty integer; unit integer; subtotal bigint:=0; taxable bigint:=0; discount bigint; tax bigint; total bigint; stock_id uuid; canonical jsonb:='[]'::jsonb; stockrow public.stock_items; seen uuid[]:='{}';
begin
 if (select auth.uid()) is null or not public.is_persen_admin() then raise exception 'Unauthorized'; end if;
 select * into r from public.pos_registers where id=p_register and owner_id=(select auth.uid()) and active for update;
 if not found then raise exception 'Register unavailable'; end if;
 if p_discount_bps not between 0 and 10000 or p_tax_milli not between 0 and 20000 then raise exception 'Invalid discount or tax'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 80 then raise exception 'Invalid cart'; end if;
 if exists(select 1 from public.pos_checkouts where register_id=p_register and status in ('awaiting_customer','contact_received')) then raise exception 'Close current checkout first'; end if;
 for line in select value from jsonb_array_elements(p_items) loop
   if jsonb_typeof(line)<>'object' or coalesce(line->>'qty','') !~ '^[0-9]{1,3}$' then raise exception 'Invalid item quantity'; end if;
   qty:=(line->>'qty')::integer;
   if qty not between 1 and 999 then raise exception 'Invalid quantity'; end if;
   if nullif(line->>'stock_id','') is not null then
     stock_id:=(line->>'stock_id')::uuid;
     if stock_id=any(seen) then raise exception 'Duplicate stock line'; end if;
     seen:=array_append(seen,stock_id);
     select * into stockrow from public.stock_items where id=stock_id;
     if not found or stockrow.quantity<qty then raise exception 'Insufficient stock'; end if;
     -- Cashier chooses the sale price; actual inventory identity is taken from the database.
     if coalesce(line->>'unit_cents','') !~ '^[0-9]{1,8}$' then raise exception 'Invalid price'; end if;
     unit:=(line->>'unit_cents')::integer;
     canonical:=canonical||jsonb_build_array(jsonb_build_object('stock_id',stock_id,'name',stockrow.product_name,'sku',stockrow.sku,'color',stockrow.color,'size',stockrow.size,'qty',qty,'unit_cents',unit,'taxable',coalesce((line->>'taxable')::boolean,true)));
   else
     if length(trim(coalesce(line->>'name',''))) not between 1 and 120 or coalesce(line->>'unit_cents','') !~ '^[0-9]{1,8}$' then raise exception 'Invalid custom item'; end if;
     unit:=(line->>'unit_cents')::integer;
     canonical:=canonical||jsonb_build_array(jsonb_build_object('stock_id',null,'name',left(trim(line->>'name'),120),'sku','','color','','size','','qty',qty,'unit_cents',unit,'taxable',coalesce((line->>'taxable')::boolean,true)));
   end if;
   if unit>10000000 then raise exception 'Item price too high'; end if;
   subtotal:=subtotal+qty::bigint*unit::bigint;
   if coalesce((line->>'taxable')::boolean,true) then taxable:=taxable+qty::bigint*unit::bigint; end if;
   if subtotal>100000000 then raise exception 'Cart too large'; end if;
 end loop;
 discount:=round(subtotal*p_discount_bps/10000.0);
 tax:=case when subtotal=0 then 0 else round((taxable*(subtotal-discount)/subtotal)*p_tax_milli/100000.0) end;
 total:=subtotal-discount+tax;
 insert into public.pos_checkouts(register_id,owner_id,items,discount_bps,tax_milli,subtotal_cents,discount_cents,tax_cents,total_cents)
 values(p_register,(select auth.uid()),canonical,p_discount_bps,p_tax_milli,subtotal::integer,discount::integer,tax::integer,total::integer)
 returning id into sid;
 return sid;
end $$;
create or replace function public.pos_customer_view(p_secret uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.pos_registers; c public.pos_checkouts;
begin
 select * into r from public.pos_registers where display_secret=p_secret and active;
 if not found then return jsonb_build_object('status','unpaired'); end if;
 select * into c from public.pos_checkouts where register_id=r.id order by created_at desc limit 1;
 if not found then return jsonb_build_object('status','idle','register',r.label); end if;
 if c.created_at<now()-interval '12 hours' then return jsonb_build_object('status','idle','register',r.label); end if;
 return jsonb_build_object('status',c.status,'register',r.label,'checkout_id',c.id,'items',c.items,'subtotal_cents',c.subtotal_cents,'discount_cents',c.discount_cents,'tax_cents',c.tax_cents,'total_cents',c.total_cents,'updated_at',c.updated_at);
end $$;
create or replace function public.pos_submit_customer(p_secret uuid,p_checkout uuid,p_phone text,p_email text default null,p_marketing_opt_in boolean default false)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.pos_registers; c public.pos_checkouts; digits text;
begin
 digits:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
 if length(digits) not between 10 and 15 or length(coalesce(p_phone,''))>24 then raise exception 'Valid phone required'; end if;
 if p_email is not null and length(trim(p_email))>0 and (length(p_email)>250 or p_email !~ '^[^ @]+@[^ @]+\\.[^ @]+$') then raise exception 'Invalid email'; end if;
 select * into r from public.pos_registers where display_secret=p_secret and active;
 if not found then raise exception 'Register unavailable'; end if;
 select * into c from public.pos_checkouts where id=p_checkout and register_id=r.id for update;
 if not found or c.status not in ('awaiting_customer','contact_received') or c.created_at<now()-interval '30 minutes' then raise exception 'Checkout unavailable'; end if;
 update public.pos_checkouts set phone=left(trim(p_phone),24),email=nullif(left(trim(p_email),250),''),marketing_opt_in=coalesce(p_marketing_opt_in,false),status='contact_received',updated_at=now() where id=c.id;
 return true;
end $$;
create or replace function public.pos_cancel_checkout(p_checkout uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.pos_checkouts;
begin
 if (select auth.uid()) is null or not public.is_persen_admin() then raise exception 'Unauthorized'; end if;
 select * into c from public.pos_checkouts where id=p_checkout and owner_id=(select auth.uid()) for update;
 if not found or c.status not in ('awaiting_customer','contact_received') then raise exception 'Checkout unavailable'; end if;
 update public.pos_checkouts set status='cancelled',updated_at=now() where id=c.id;
 return true;
end $$;
create or replace function public.pos_complete_cash(p_checkout uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.pos_checkouts; line jsonb; sid uuid; updated integer;
begin
 if (select auth.uid()) is null or not public.is_persen_admin() then raise exception 'Unauthorized'; end if;
 select * into c from public.pos_checkouts where id=p_checkout and owner_id=(select auth.uid()) for update;
 if not found or c.status<>'contact_received' then raise exception 'Customer contact required or checkout already closed'; end if;
 if length(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'))<10 then raise exception 'Customer phone required'; end if;
 -- Lock and decrement each row atomically. Any insufficient stock rolls back the entire transaction.
 for line in select value from jsonb_array_elements(c.items) order by (value->>'stock_id') nulls last loop
  if line->>'stock_id' is not null and line->>'stock_id'<>'null' then
    update public.stock_items set quantity=quantity-(line->>'qty')::integer,updated_at=now()
      where id=(line->>'stock_id')::uuid and quantity>=(line->>'qty')::integer;
    get diagnostics updated=row_count;
    if updated<>1 then raise exception 'Stock changed; cancel and rebuild checkout'; end if;
  end if;
 end loop;
 insert into public.pos_sales(checkout_id,owner_id,snapshot,subtotal_cents,discount_cents,tax_cents,total_cents,payment_method)
 values(c.id,(select auth.uid()),jsonb_build_object('items',c.items,'phone',c.phone,'email',c.email,'marketing_opt_in',c.marketing_opt_in),
 c.subtotal_cents,c.discount_cents,c.tax_cents,c.total_cents,'cash') returning id into sid;
 update public.pos_checkouts set status='completed',updated_at=now() where id=c.id;
 return sid;
end $$;
revoke all on function public.pos_begin_checkout(uuid,jsonb,integer,integer),public.pos_customer_view(uuid),public.pos_submit_customer(uuid,uuid,text,text,boolean),public.pos_cancel_checkout(uuid),public.pos_complete_cash(uuid) from public;
grant execute on function public.pos_begin_checkout(uuid,jsonb,integer,integer),public.pos_cancel_checkout(uuid),public.pos_complete_cash(uuid) to authenticated;
grant execute on function public.pos_customer_view(uuid),public.pos_submit_customer(uuid,uuid,text,text,boolean) to anon,authenticated;
-- For production: put anonymous display RPCs behind an Edge Function with rate limits, short-lived tokens, and rotation.
-- Do not activate these RPCs for untrusted public traffic until security review and abuse controls.

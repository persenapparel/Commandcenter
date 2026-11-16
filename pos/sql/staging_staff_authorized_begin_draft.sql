-- UNAPPLIED STAGING SQL DRAFT. Never apply to production.
-- Depends on the existing POS, staff shift and handoff schema drafts.
-- Existing owner-only checkout remains unchanged.
create table if not exists public.pos_staff_register_grants(
 register_id uuid not null references public.pos_registers(id),
 staff_id uuid not null references public.pos_staff_credentials(id),
 owner_id uuid not null references auth.users(id),
 granted_by uuid not null references auth.users(id),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 primary key(register_id,staff_id)
);
alter table public.pos_staff_register_grants enable row level security;
revoke all on public.pos_staff_register_grants from public,anon,authenticated;

create or replace function public.pos_staff_set_register_access(
 p_register uuid,p_staff_user uuid,p_allowed boolean
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid(); v_reg public.pos_registers%rowtype;
 v_staff public.pos_staff_credentials%rowtype;
begin
 if v_owner is null or not public.is_persen_admin() or p_allowed is null
 then raise exception 'Unauthorized'; end if;
 select * into v_reg from public.pos_registers
 where id=p_register and owner_id=v_owner and active for update;
 if not found then raise exception 'Register unavailable'; end if;
 select * into v_staff from public.pos_staff_credentials
 where auth_user_id=p_staff_user and enabled=true for update;
 if not found then raise exception 'Employee unavailable'; end if;
 insert into public.pos_staff_register_grants(
  register_id,staff_id,owner_id,granted_by,active
 ) values(v_reg.id,v_staff.id,v_reg.owner_id,v_owner,p_allowed)
 on conflict(register_id,staff_id) do update
 set active=excluded.active,granted_by=excluded.granted_by;
 if not p_allowed then
  -- Revoking register permission also invalidates outstanding guest access
  -- for this employee on this register. A cashier may not regain access
  -- simply because a previously issued capability has not timed out.
  update public.pos_checkout_handoffs h
  set phase='closed',capability_digest=null,capability_expires_at=null,
      closed_at=now(),updated_at=now()
  where h.register_id=v_reg.id and h.phase<>'closed'
    and h.shift_id in (select id from public.pos_staff_shifts
                      where staff_id=v_staff.id);
 end if;
 return true;
end $$;
revoke all on function public.pos_staff_set_register_access(uuid,uuid,boolean)
 from public,anon;
grant execute on function public.pos_staff_set_register_access(uuid,uuid,boolean)
 to authenticated;

-- Reuse canonical catalog price, stock, event and math validation from the
-- owner POS function; shift and owner-granted register scope are independent.
create or replace function public.pos_staff_begin_checkout(p_shift_id uuid,p_shift_secret text,p_register uuid,p_items jsonb,p_discount_bps integer default 0,p_tax_milli integer default 0,p_event uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 r public.pos_registers; line jsonb; sid uuid; qty integer; unit integer;
 subtotal bigint:=0; taxable bigint:=0; discount bigint; tax bigint; total bigint;
 stock_id uuid; canonical jsonb:='[]'::jsonb; stockrow public.stock_items; seen uuid[]:='{}';
 catalog_configured boolean; catalog_item public.inventory_catalog;
 variant_price integer; item_taxable boolean;
 v_uid uuid := auth.uid();
 v_staff public.pos_staff_credentials%rowtype;
begin
 if v_uid is null or p_shift_secret is null or
    p_shift_secret !~ '^[a-f0-9]{64}$' then raise exception 'Employee checkout denied'; end if;
 select c.* into v_staff from public.pos_staff_shifts s
 join public.pos_staff_credentials c on c.id=s.staff_id
 where s.id=p_shift_id and s.auth_user_id=v_uid
   and s.revoked_at is null and s.expires_at>now()
   and c.auth_user_id=v_uid and c.enabled=true
   and c.credential_version=s.credential_version
   and s.secret_digest=extensions.digest(p_shift_secret,'sha256')
 for update of s,c;
 if not found then raise exception 'Employee checkout denied'; end if;
 select * into r from public.pos_registers
 where id=p_register and active=true for update;
 if not found or not exists(
   select 1 from public.pos_staff_register_grants g
   where g.register_id=r.id and g.owner_id=r.owner_id
     and g.staff_id=v_staff.id and g.active=true
 ) then raise exception 'Employee checkout denied'; end if;
 if p_event is not null and not exists(select 1 from public.pos_events where id=p_event and owner_id=r.owner_id and status='open') then raise exception 'Choose an open event'; end if;
 if p_discount_bps is null or p_tax_milli is null or p_discount_bps not between 0 and 10000 or p_tax_milli not between 0 and 20000 then raise exception 'Invalid discount or tax'; end if;
 if p_tax_milli<>0 then raise exception 'Tax setup unavailable'; end if;
 if v_staff.staff_role<>'owner' and p_discount_bps<>0 then
  raise exception 'Cashier discount requires owner approval'; end if;
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Invalid cart'; end if;
 if jsonb_array_length(p_items) not between 1 and 80 then raise exception 'Invalid cart'; end if;
 if exists(select 1 from public.pos_checkouts where register_id=p_register and status in ('awaiting_customer','contact_received')) then raise exception 'Close current checkout first'; end if;
 select exists(select 1 from public.inventory_catalog) into catalog_configured;
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
     select * into catalog_item from public.inventory_catalog
       where lower(name)=lower(btrim(stockrow.product_name));
     if not found or catalog_item.inventory_type<>'sales' or not catalog_item.is_active then
       raise exception 'This item is not an active Sales Product';
     end if;
     if p_event is not null and not exists(select 1 from public.pos_events e join public.inventory_event_quick_products t on t.event_id=e.inventory_profile_id where e.id=p_event and t.product_name=catalog_item.name) then raise exception 'Add this Sales Product to your event first'; end if;
     select v.price_cents,v.taxable into variant_price,item_taxable
       from public.pos_variant_details v where v.stock_id=stockrow.id;
     -- Keep legacy explicitly priced variants usable until the inventory catalog is configured.
     unit:=catalog_item.price_cents;
     if unit is null or unit<=0 then raise exception 'Set a selling price for this product before checkout'; end if;
     item_taxable:=coalesce(item_taxable,true);
     if (line->>'unit_cents') is distinct from unit::text
        or coalesce((line->>'taxable')::boolean,true) is distinct from item_taxable then
       raise exception 'Product price or tax status changed. Refresh products and re-add the item.';
     end if;
     canonical:=canonical||jsonb_build_array(jsonb_build_object('stock_id',stock_id,'name',stockrow.product_name,'sku',stockrow.sku,'color',stockrow.color,'size',stockrow.size,'qty',qty,'unit_cents',unit,'service',case when (line->>'service') in ('Apparel','Custom Printing','Personalization','Accessories','Other') then line->>'service' else 'Other' end,'taxable',item_taxable));
   else
     if v_staff.staff_role<>'owner' then raise exception 'Custom item needs owner approval'; end if;
     if length(trim(coalesce(line->>'name',''))) not between 1 and 120 or coalesce(line->>'unit_cents','') !~ '^[0-9]{1,8}$' then raise exception 'Invalid custom item'; end if;
     unit:=(line->>'unit_cents')::integer;
     item_taxable:=coalesce((line->>'taxable')::boolean,true);
     canonical:=canonical||jsonb_build_array(jsonb_build_object('stock_id',null,'name',left(trim(line->>'name'),120),'sku','','color','','size','','qty',qty,'unit_cents',unit,'service',case when (line->>'service') in ('Apparel','Custom Printing','Personalization','Accessories','Other') then line->>'service' else 'Other' end,'taxable',item_taxable));
   end if;
   if unit>10000000 then raise exception 'Item price too high'; end if;
   subtotal:=subtotal+qty::bigint*unit::bigint;
   if item_taxable then taxable:=taxable+qty::bigint*unit::bigint; end if;
   if subtotal>100000000 then raise exception 'Cart too large'; end if;
 end loop;
 discount:=round(subtotal*p_discount_bps/10000.0);
 tax:=case when subtotal=0 then 0 else div(
   2*taxable::numeric*(subtotal-discount)*p_tax_milli+subtotal*100000.0,
   subtotal*200000.0
 ) end;
 total:=subtotal-discount+tax;
 insert into public.pos_checkouts(register_id,owner_id,event_id,items,discount_bps,tax_milli,subtotal_cents,discount_cents,tax_cents,total_cents)
 values(p_register,r.owner_id,p_event,canonical,p_discount_bps,p_tax_milli,subtotal::integer,discount::integer,tax::integer,total::integer)
 returning id into sid;
 return sid;
end $$;

revoke all on function public.pos_staff_begin_checkout(uuid,text,uuid,jsonb,integer,integer,uuid) from public,anon;
grant execute on function public.pos_staff_begin_checkout(uuid,text,uuid,jsonb,integer,integer,uuid) to authenticated;

-- Rewrite only the claim/issue RPCs, preserving the original owner path.
-- Staff always requires an active shift and explicit register authorization.
create or replace function public.pos_handoff_claim(
 p_checkout uuid, p_shift_id uuid, p_shift_secret text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
 v_uid uuid := auth.uid();
 v_shift public.pos_staff_shifts%rowtype;
 v_checkout public.pos_checkouts%rowtype;
begin
 if v_uid is null or p_shift_secret is null or
    p_shift_secret !~ '^[0-9a-f]{64}$' then
  raise exception 'Checkout authorization denied';
 end if;
 select s.* into v_shift
 from public.pos_staff_shifts s
 join public.pos_staff_credentials c on c.id=s.staff_id
 where s.id=p_shift_id and s.auth_user_id=v_uid
   and s.revoked_at is null and s.expires_at > now()
   and c.enabled and c.auth_user_id=v_uid
   and c.credential_version=s.credential_version
   and s.secret_digest=extensions.digest(p_shift_secret,'sha256')
 for update of s,c;
 if not found then raise exception 'Checkout authorization denied'; end if;
 select * into v_checkout
 from public.pos_checkouts
 where id=p_checkout
   and status='awaiting_customer'
   and created_at > now()-interval '30 minutes'
 for update;
 if not found or not exists (
   select 1 from public.pos_registers r
   where r.id=v_checkout.register_id
     and r.owner_id=v_checkout.owner_id and r.active
     and (
       (v_checkout.owner_id=v_uid and public.is_persen_admin())
       or exists (
         select 1 from public.pos_staff_register_grants g
         where g.register_id=r.id and g.owner_id=r.owner_id
           and g.staff_id=v_shift.staff_id and g.active=true
       )
     )
 ) then raise exception 'Checkout authorization denied'; end if;
 insert into public.pos_checkout_handoffs
   (checkout_id,register_id,shift_id,auth_user_id,phase)
 values (v_checkout.id,v_checkout.register_id,v_shift.id,v_uid,'claimed');
 return jsonb_build_object('ok',true,'checkoutId',v_checkout.id,'phase','claimed');
end $$;

create or replace function public.pos_handoff_issue_guest(
 p_checkout uuid, p_shift_id uuid, p_shift_secret text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
 v_uid uuid := auth.uid();
 v_shift public.pos_staff_shifts%rowtype;
 v_handoff public.pos_checkout_handoffs%rowtype;
 v_checkout public.pos_checkouts%rowtype;
 v_capability text;
 v_expiry timestamptz := now()+interval '15 minutes';
begin
 if v_uid is null or p_shift_secret is null or
    p_shift_secret !~ '^[0-9a-f]{64}$' then
  raise exception 'Checkout authorization denied';
 end if;
 select s.* into v_shift
 from public.pos_staff_shifts s
 join public.pos_staff_credentials c on c.id=s.staff_id
 where s.id=p_shift_id and s.auth_user_id=v_uid
   and s.revoked_at is null and s.expires_at>now()
   and c.enabled and c.auth_user_id=v_uid
   and c.credential_version=s.credential_version
   and s.secret_digest=extensions.digest(p_shift_secret,'sha256')
 for update of s,c;
 if not found then raise exception 'Checkout authorization denied'; end if;
 select * into v_checkout from public.pos_checkouts
 where id=p_checkout and status='awaiting_customer'
 and created_at>now()-interval '30 minutes' for update;
 if not found then raise exception 'Checkout authorization denied'; end if;
 select * into v_handoff from public.pos_checkout_handoffs
 where checkout_id=p_checkout and shift_id=p_shift_id and auth_user_id=v_uid
 and phase='claimed' for update;
 if not found or not exists(
   select 1 from public.pos_registers r
   where r.id=v_checkout.register_id
     and r.owner_id=v_checkout.owner_id and r.active
     and (
       (v_checkout.owner_id=v_uid and public.is_persen_admin())
       or exists(
         select 1 from public.pos_staff_register_grants g
         where g.register_id=r.id and g.owner_id=r.owner_id
         and g.staff_id=v_shift.staff_id and g.active=true
       )
     )
 ) then raise exception 'Checkout authorization denied'; end if;
 v_capability:=encode(extensions.gen_random_bytes(32),'hex');
 update public.pos_checkout_handoffs
 set phase='guest',capability_digest=extensions.digest(v_capability,'sha256'),
     capability_expires_at=v_expiry,guest_issued_at=now(),updated_at=now()
 where checkout_id=p_checkout;
 return jsonb_build_object('checkoutId',p_checkout,'capability',v_capability,
                           'expiresAt',v_expiry);
end $$;


-- Apply after inventory/inventory-hub-2026.sql and pos/pos-schema-review.sql.
-- Uses the Command Center catalog, stock and event selections in the SAME database.
alter table public.pos_events add column if not exists inventory_profile_id uuid references public.inventory_event_profiles(id);
create unique index if not exists pos_events_owner_profile on public.pos_events(owner_id,inventory_profile_id);
create or replace function public.pos_save_event_selection(p_event uuid,p_name text,p_date date,p_names text[])
returns uuid language plpgsql security invoker set search_path='' as $$
declare eid uuid; profile uuid; nm text:=btrim(p_name); item text; i integer:=0;
begin
 if auth.uid() is null or not public.is_persen_admin() then raise exception 'Owner access required'; end if;
 if p_date is null or nm is null or length(nm) not between 1 and 100 then raise exception 'Enter an event name and date'; end if;
 if coalesce(cardinality(p_names),0) not between 1 and 12 then raise exception 'Select 1 to 12 Sales Products'; end if;
 if exists(select 1 from unnest(p_names) n group by n having count(*)>1) then raise exception 'Duplicate products'; end if;
 -- Same lock for competing saves, including creation on two devices.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(lower(nm)));
 foreach item in array p_names loop
  if not exists(select 1 from public.inventory_catalog c where c.name=item and c.inventory_type='sales' and c.is_active and c.price_cents between 1 and 10000000) then raise exception 'Choose priced, active Sales Products only'; end if;
 end loop;
 if p_event is not null then
  select id,inventory_profile_id into eid,profile from public.pos_events where id=p_event and owner_id=auth.uid() and status='open' for update;
  if not found then raise exception 'Choose your open event'; end if;
 end if;
 if profile is null then
  insert into public.inventory_event_profiles(name,event_date) values(nm,p_date)
   on conflict (lower(name)) do update set updated_at=now() returning id into profile;
 end if;
 if exists(select 1 from public.pos_events where inventory_profile_id=profile and owner_id<>auth.uid()) then raise exception 'Event belongs to another register owner'; end if;
 if eid is null then
  insert into public.pos_events(owner_id,name,event_date,status,inventory_profile_id)
   values(auth.uid(),nm,p_date,'open',profile)
   on conflict(owner_id,inventory_profile_id) do update set name=excluded.name,event_date=excluded.event_date
   returning id into eid;
 end if;
 if exists(select 1 from public.pos_checkouts where event_id=eid and status in ('awaiting_customer','contact_received')) then raise exception 'Finish current event checkouts first'; end if;
 if exists(select 1 from public.pos_events where id=eid and status<>'open') then raise exception 'Event is closed'; end if;
 update public.inventory_event_profiles set name=nm,event_date=p_date,updated_at=now() where id=profile;
 update public.pos_events set name=nm,event_date=p_date,inventory_profile_id=profile where id=eid;
 delete from public.inventory_event_quick_products where event_id=profile;
 foreach item in array p_names loop
  insert into public.inventory_event_quick_products(event_id,product_name,sort_order) values(profile,item,i);i:=i+1;
 end loop;
 return eid;
end $$;
revoke all on function public.pos_save_event_selection(uuid,text,date,text[]) from public,anon;
grant execute on function public.pos_save_event_selection(uuid,text,date,text[]) to authenticated;

create or replace function public.pos_begin_checkout(p_register uuid,p_items jsonb,p_discount_bps integer default 0,p_tax_milli integer default 0,p_event uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 r public.pos_registers; line jsonb; sid uuid; qty integer; unit integer;
 subtotal bigint:=0; taxable bigint:=0; discount bigint; tax bigint; total bigint;
 stock_id uuid; canonical jsonb:='[]'::jsonb; stockrow public.stock_items; seen uuid[]:='{}';
 catalog_configured boolean; catalog_item public.inventory_catalog;
 variant_price integer; item_taxable boolean;
begin
 if (select auth.uid()) is null or not public.is_persen_admin() then raise exception 'Unauthorized'; end if;
 select * into r from public.pos_registers where id=p_register and owner_id=(select auth.uid()) and active for update;
 if not found then raise exception 'Register unavailable'; end if;
 if p_event is not null and not exists(select 1 from public.pos_events where id=p_event and owner_id=(select auth.uid()) and status='open') then raise exception 'Choose an open event'; end if;
 if p_discount_bps is null or p_tax_milli is null or p_discount_bps not between 0 and 10000 or p_tax_milli not between 0 and 20000 then raise exception 'Invalid discount or tax'; end if;
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
 values(p_register,(select auth.uid()),p_event,canonical,p_discount_bps,p_tax_milli,subtotal::integer,discount::integer,tax::integer,total::integer)
 returning id into sid;
 return sid;
end $$;

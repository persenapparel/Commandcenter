-- Atomic inventory edits and event-quick-tile updates for the Persen owner dashboard.
create or replace function public.inventory_save_size_grid(
  p_name text,p_type text,p_price_cents integer,p_items jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_name text:=btrim(coalesce(p_name,''));
  v_row jsonb;
  v_color text;
  v_size text;
  v_quantity integer;
  v_count integer;
  v_existing uuid;
  v_n integer:=0;
  v_total bigint:=0;
begin
  if auth.uid() is null or not public.is_persen_admin() then raise exception 'Owner access required';end if;
  if char_length(v_name) not between 1 and 140 or p_type not in ('blanks','sales') then raise exception 'Invalid product details';end if;
  if p_type='sales' and (p_price_cents is null or p_price_cents<0 or p_price_cents>100000000) then
    raise exception 'Set a valid sale price';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>200 then
    raise exception 'Choose between 1 and 200 color/size quantities';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(lower(v_name)));
  if exists(select 1 from public.inventory_catalog where lower(name)=lower(v_name) and name<>v_name) then
    raise exception 'This product already exists with different capitalization';
  end if;
  insert into public.inventory_catalog(name,inventory_type,price_cents,updated_at)
    values(v_name,p_type,case when p_type='sales' then p_price_cents else null end,now())
    on conflict(name) do update set inventory_type=excluded.inventory_type,price_cents=excluded.price_cents,updated_at=now();
  for v_row in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_row) is distinct from 'object' then raise exception 'Invalid size row';end if;
    v_color:=btrim(coalesce(v_row->>'color',''));
    v_size:=upper(btrim(coalesce(v_row->>'size','')));
    if v_color='' or length(v_color)>60 or v_size not in
      ('XS','S','M','L','XL','2XL','3XL','4XL','5XL','OS')
      or (v_row->>'quantity') !~ '^(0|[1-9][0-9]{0,6})$' then raise exception 'Invalid color, size or quantity';end if;
    v_quantity:=(v_row->>'quantity')::integer;
    if v_quantity>1000000 then raise exception 'Quantity cannot exceed one million';end if;
    if exists(select 1 from jsonb_array_elements(p_items) i
      where lower(btrim(i->>'color'))=lower(v_color) and upper(btrim(i->>'size'))=v_size
      group by lower(btrim(i->>'color')),upper(btrim(i->>'size')) having count(*)>1) then
      raise exception 'Duplicate color and size row';
    end if;
    select count(*),(array_agg(id))[1] into v_count,v_existing from public.stock_items
    where lower(product_name)=lower(v_name) and lower(color)=lower(v_color) and upper(size)=v_size;
    if v_count>1 then raise exception 'Multiple inventory rows for % / %; resolve duplicates before editing',v_color,v_size;end if;
    if v_count=1 then
      update public.stock_items set quantity=v_quantity,updated_at=now() where id=v_existing;
    elsif v_quantity>0 then
      insert into public.stock_items(sku,product_name,color,size,quantity,reorder_at)
      values('PAH-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,20)),v_name,v_color,v_size,v_quantity,5);
    end if;
    v_total:=v_total+v_quantity;
    v_n:=v_n+1;
  end loop;
  return jsonb_build_object('updated',v_n,'total_in_submitted_grid',v_total);
end
$function$;
revoke all on function public.inventory_save_size_grid(text,text,integer,jsonb) from public,anon;
grant execute on function public.inventory_save_size_grid(text,text,integer,jsonb) to authenticated;

create or replace function public.inventory_save_event_tiles(p_event uuid,p_names text[])
returns integer language plpgsql security definer set search_path = ''
as $function$
declare v_name text; v_i integer:=0;
begin
  if auth.uid() is null or not public.is_persen_admin() then raise exception 'Owner access required';end if;
  if not exists(select 1 from public.inventory_event_profiles where id=p_event) then raise exception 'Unknown event';end if;
  if p_names is null or array_length(p_names,1) is null or array_length(p_names,1)>12 then
    raise exception 'Select between 1 and 12 products';
  end if;
  if exists(select 1 from unnest(p_names) x group by x having count(*)>1) then raise exception 'Duplicate product selection';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_event::text));
  foreach v_name in array p_names loop
    if not exists(select 1 from public.inventory_catalog
      where name=v_name and inventory_type='sales' and is_active=true and price_cents>0) then
      raise exception 'Product % must be a priced active Sales product',v_name;
    end if;
  end loop;
  delete from public.inventory_event_quick_products where event_id=p_event;
  foreach v_name in array p_names loop
    v_i:=v_i+1;
    insert into public.inventory_event_quick_products(event_id,product_name,sort_order)
    values(p_event,v_name,v_i);
  end loop;
  return v_i;
end
$function$;
revoke all on function public.inventory_save_event_tiles(uuid,text[]) from public,anon;
grant execute on function public.inventory_save_event_tiles(uuid,text[]) to authenticated;

create or replace function public.inventory_activate_event(p_event uuid)
returns void language plpgsql security definer set search_path=''
as $function$
begin
  if auth.uid() is null or not public.is_persen_admin() then raise exception 'Owner access required';end if;
  if not exists(select 1 from public.inventory_event_profiles where id=p_event) then raise exception 'Unknown event';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('persen_inventory_active_event'));
  update public.inventory_event_profiles set active=false,updated_at=now() where active;
  update public.inventory_event_profiles set active=true,updated_at=now() where id=p_event;
end
$function$;
revoke all on function public.inventory_activate_event(uuid) from public,anon;
grant execute on function public.inventory_activate_event(uuid) to authenticated;

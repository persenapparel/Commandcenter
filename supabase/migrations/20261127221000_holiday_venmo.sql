-- The existing release checks and cash order fingerprints are preserved.
ALTER TABLE holiday_shop.orders ADD COLUMN method text NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','venmo'));
ALTER TABLE holiday_shop.orders ADD COLUMN shipping_cents integer NOT NULL DEFAULT 0 CHECK (shipping_cents IN (0,895) AND shipping_cents <= total);
ALTER TABLE holiday_shop.orders ADD COLUMN gift_message text NOT NULL DEFAULT '' CHECK (length(gift_message)<=250);
ALTER TABLE holiday_shop.orders ADD COLUMN carrier text CHECK (carrier IN ('USPS','UPS','FedEx','Other'));
ALTER TABLE holiday_shop.orders ADD COLUMN tracking_number text CHECK (tracking_number ~ '^[A-Za-z0-9-]{5,64}$');
ALTER TABLE holiday_shop.orders ADD COLUMN shipped_at timestamptz;
ALTER TABLE holiday_shop.orders DROP CONSTRAINT orders_fulfillment_check;
-- Historical delivery rows remain readable; new orders accept pickup or shipping only.
ALTER TABLE holiday_shop.orders ADD CONSTRAINT orders_fulfillment_check CHECK (fulfillment IN ('pickup','delivery','shipping'));
CREATE OR REPLACE FUNCTION holiday_shop.shipping_fee(p_subtotal integer,p_fulfillment text)
RETURNS integer LANGUAGE sql IMMUTABLE STRICT SET search_path TO ''
AS $fee$ SELECT CASE WHEN p_fulfillment='pickup' OR p_subtotal>=8500 THEN 0 ELSE 895 END $fee$;
REVOKE ALL ON FUNCTION holiday_shop.shipping_fee(integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION holiday_shop.shipping_fee(integer,text) TO service_role;

CREATE OR REPLACE FUNCTION public.holiday_order(p_request uuid, p_customer uuid, p_details jsonb, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare o holiday_shop.orders%rowtype; l record; v record; fingerprint text;
 n text:=trim(p_details->>'name');e text:=lower(trim(p_details->>'email'));ph text:=trim(p_details->>'phone'); f text:=p_details->>'fulfillment';payment_method text:=p_details->>'method';addr text:=''; street text:=trim(coalesce(p_details->>'street','')); city text:=trim(coalesce(p_details->>'city','')); st text:=upper(trim(coalesce(p_details->>'state',''))); zip text:=trim(coalesce(p_details->>'zip','')); country text:=p_details->>'country'; expected integer; gift text:=trim(coalesce(p_details->>'gift_message',''));
begin
 if now()<holiday_shop.online_opens() then raise exception 'Collection opens December 1 at midnight Eastern';end if;
 if p_customer is null then raise exception 'A verified customer account is required';end if;
 if p_request is null or n is null or length(n) not between 2 and 100 or e is null or length(e)>254 or e !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or ph is null or length(ph) not between 7 and 32 or ph !~ '^[0-9+(). -]+$' or f is null or f not in ('pickup','shipping') or length(gift)>250 or (payment_method is null or payment_method not in ('cash','venmo')) then raise exception 'Check your contact information and fulfillment details';end if;
 if f='shipping' then
  if payment_method='cash' or country is distinct from 'US' or st not in ('AL','AZ','AR','CA','CO','CT','DE','FL','GA','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC') or zip !~ '^[0-9]{5}(-[0-9]{4})?$' or length(street) not between 5 and 200 or length(city) not between 2 and 100 then raise exception 'Check your US shipping address and payment method';end if;
  addr:=street||', '||city||', '||st||' '||zip||', US';
 end if;
 if coalesce(p_details->>'expected_subtotal','') !~ '^[0-9]{1,9}$' then raise exception 'Refresh checkout to confirm pricing';end if;
 expected:=(p_details->>'expected_subtotal')::integer;
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 24 then raise exception 'Check the items in your bag';end if;
 if exists(select from jsonb_array_elements(p_lines) j where (j->>'qty') is null or (j->>'qty') !~ '^[1-9][0-9]{0,2}$' or (j->>'id') is null or (j->>'id') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') or (select count(distinct lower(j->>'id')) from jsonb_array_elements(p_lines) j)<>jsonb_array_length(p_lines) then raise exception 'Check the sizes and quantities in your bag';end if;
 select encode(sha256(convert_to((jsonb_build_array(p_customer,n,e,ph,f,addr,(select jsonb_agg(jsonb_build_array((j->>'id')::uuid,(j->>'qty')::int) order by j->>'id') from jsonb_array_elements(p_lines) j)) || case when payment_method='venmo' then jsonb_build_array(payment_method) else '[]'::jsonb end || case when gift<>'' then jsonb_build_array(gift) else '[]'::jsonb end)::text,'UTF8')),'hex') into fingerprint;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,3));
 perform holiday_shop.expire();
 select * into o from holiday_shop.orders where request_id=p_request;
 if found then
  if o.fingerprint<>fingerprint then raise exception 'This checkout reference belongs to a different request';end if;
  if o.status in ('expired','cancelled') then raise exception 'This order is no longer active. Contact service@persenapparel.com before placing a new order';end if;
 else
  insert into holiday_shop.orders(request_id,fingerprint,customer_id,contact_name,email,phone,fulfillment,address,total,expires_at,method,gift_message)
  values(p_request,fingerprint,p_customer,n,e,ph,f,addr,0,now()+interval '24 hours',payment_method,gift) returning * into o;
  for l in select (j->>'id')::uuid id,(j->>'qty')::int qty from jsonb_array_elements(p_lines) j order by 1 loop
   select s.product_name,s.color,s.size,c.price_cents,vv.unit_cost into v from holiday_shop.variants vv join public.stock_items s on s.id=vv.stock_id join public.pos_variant_details d on d.stock_id=s.id join public.inventory_catalog c on c.name=s.product_name and c.is_active and c.inventory_type='sales' and c.price_cents>0 where s.id=l.id;
   if not found then raise exception 'An item is unavailable';end if;
   update public.stock_items set quantity=quantity-l.qty,updated_at=now() where id=l.id and quantity>=l.qty;
   if not found then raise exception 'A selected size has sold out or has fewer units left';end if;
   insert into holiday_shop.lines(order_id,stock_id,name,color,size,qty,unit_price,unit_cost) values(o.id,l.id,v.product_name,v.color,v.size,l.qty,v.price_cents,v.unit_cost);
   o.total:=o.total+l.qty*v.price_cents;
  end loop;
  if o.total<>expected then raise exception 'Price changed. Review your bag before continuing';end if;
  o.shipping_cents:=holiday_shop.shipping_fee(o.total,f);
  o.total:=o.total+o.shipping_cents;
  update holiday_shop.orders set total=o.total, shipping_cents=o.shipping_cents where id=o.id;
  insert into holiday_shop.mail(order_id,kind) values(o.id,'customer'),(o.id,'studio');
 end if;
 return jsonb_build_object('id',o.id,'total',o.total,'subtotal',o.total-o.shipping_cents,'shipping',o.shipping_cents,'fulfillment',o.fulfillment,'status',o.status,'payment',case when o.paid=0 then 'unpaid' else 'paid' end,'expires',o.expires_at,'method',o.method);
end$function$;

CREATE OR REPLACE FUNCTION public.holiday_manage(p_actor uuid, p_request uuid, p_change jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare o holiday_shop.orders%rowtype;l holiday_shop.lines%rowtype; action text:=p_change->>'action'; n int; old holiday_shop.actions%rowtype; v_id uuid; v_price int;
begin
 if p_actor is null or p_request is null then raise exception 'Owner verification required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,7));
 select * into old from holiday_shop.actions where id=p_request;
 if found then if old.request=p_change and old.actor=p_actor then return true;end if; raise exception 'Conflicting request';end if;
 insert into holiday_shop.actions values(p_request,p_actor,p_change,now());perform holiday_shop.expire();
 if action in ('stock','cost') then
  v_id:=(p_change->>'variant')::uuid;n:=(p_change->>'value')::int;
  if not exists(select from holiday_shop.variants where stock_id=v_id) or n is null or n not between 0 and 100000 then raise exception 'Check the variant and amount';end if;
  if action='stock' then
   update public.stock_items set quantity=n,updated_at=now() where id=v_id and quantity=(p_change->>'expected')::int;
   if not found then raise exception 'Inventory changed. Refresh before editing the count';end if;
  else update holiday_shop.variants set unit_cost=n where stock_id=v_id;end if;
 elsif action='film' then
  update holiday_shop.settings set video_path=nullif(p_change->>'video',''),poster_path=nullif(p_change->>'poster','');
 else
  select * into strict o from holiday_shop.orders where id=(p_change->>'order')::uuid for update;
  case action
  when 'estimate' then update holiday_shop.orders set estimated_date=nullif(p_change->>'date','')::date where id=o.id;
  when 'ship' then
   if o.fulfillment<>'shipping' or o.status<>'ready' or o.paid<>o.total or o.refunded<>0 or coalesce(p_change->>'carrier','') not in ('USPS','UPS','FedEx','Other') or coalesce(p_change->>'tracking','') !~ '^[A-Za-z0-9-]{5,64}$' then raise exception 'Verify full payment, carrier, tracking and readiness before recording shipment';end if;
   update holiday_shop.orders set carrier=p_change->>'carrier',tracking_number=p_change->>'tracking',shipped_at=now(),status='fulfilled',expires_at=null where id=o.id;
  when 'confirm','ready','fulfill' then
   if action='fulfill' and o.fulfillment='shipping' then raise exception 'Record carrier and tracking to mark shipped';end if;
   if o.status not in ('reserved','confirmed','ready') or (action='confirm' and o.status='ready') or (action='fulfill' and o.paid<>o.total) then raise exception 'Check order and payment status first';end if;
   if o.method='venmo' and o.paid<>o.total then raise exception 'Verify the Venmo payment first';end if;
   update holiday_shop.orders set status=case action when 'confirm' then 'confirmed' when 'ready' then 'ready' else 'fulfilled' end,expires_at=case when o.paid=o.total then null else o.expires_at end where id=o.id;
  when 'paid' then
   if (p_change->>'method') is distinct from o.method or (p_change->>'cents')::int is distinct from o.total then raise exception 'Enter the exact payment received';end if;
   if o.status not in ('reserved','confirmed','ready') or o.paid<>0 then raise exception 'This order cannot accept this payment';end if;
   update holiday_shop.orders set paid=total,expires_at=null,status=case when status='reserved' then 'confirmed' else status end where id=o.id;
  when 'cancel' then
   if o.status not in ('reserved','confirmed','ready') or o.paid<>o.refunded then raise exception 'Only unpaid or fully refunded active orders can be cancelled';end if;
   perform holiday_shop.release_order(o.id);update holiday_shop.orders set status='cancelled',expires_at=null where id=o.id;
  when 'refund' then
   n:=(p_change->>'cents')::int;if n is null or n<=0 or n>o.paid-o.refunded then raise exception 'Refund exceeds payment received';end if;
   update holiday_shop.orders set refunded=refunded+n where id=o.id;
  when 'return' then
   if o.status<>'fulfilled' then raise exception 'Only fulfilled items can be returned';end if;
   select * into strict l from holiday_shop.lines where order_id=o.id and stock_id=(p_change->>'variant')::uuid for update;
   n:=(p_change->>'qty')::int;if n is null or n<=0 or n>l.qty-l.returned then raise exception 'Return exceeds remaining units';end if;
   update holiday_shop.lines set returned=returned+n where order_id=o.id and stock_id=l.stock_id;
   if p_change->>'restock'='true' then update public.stock_items set quantity=quantity+n,updated_at=now() where id=l.stock_id;end if;
  else raise exception 'Unknown order action';end case;
 end if;
 return true;
end$function$;

CREATE OR REPLACE FUNCTION public.holiday_mail_claim()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 with candidates as (select order_id,kind from holiday_shop.mail where sent_at is null and retry_at<=now() and attempts<20 order by retry_at limit 8 for update skip locked),
 claimed as (update holiday_shop.mail m set attempts=attempts+1,retry_at=now()+interval '5 minutes' from candidates c where m.order_id=c.order_id and m.kind=c.kind returning m.order_id,m.kind)
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'email',o.email,'kind',m.kind,'total',o.total,'subtotal',o.total-o.shipping_cents,'shipping',o.shipping_cents,'fulfillment',o.fulfillment,'status',o.status,'method',o.method,'name',o.contact_name,'address',o.address,'items',(select coalesce(jsonb_agg(jsonb_build_object('name',l.name,'color',l.color,'size',l.size,'qty',l.qty,'unit_price',l.unit_price) order by l.name,l.color,l.size),'[]'::jsonb) from holiday_shop.lines l where l.order_id=o.id))),'[]') from claimed m join holiday_shop.orders o on o.id=m.order_id
$function$;


-- Keep unpaid reservations bounded even when staff confirm or prepare the order.
UPDATE holiday_shop.orders
SET expires_at = now() + interval '24 hours'
WHERE status IN ('reserved', 'confirmed', 'ready') AND paid = 0 AND expires_at IS NULL;

CREATE OR REPLACE FUNCTION holiday_shop.expire()
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE o record;
BEGIN
  FOR o IN SELECT id FROM holiday_shop.orders
    WHERE status IN ('reserved', 'confirmed', 'ready') AND paid = 0 AND expires_at <= now()
    ORDER BY expires_at FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM holiday_shop.release_order(o.id);
    UPDATE holiday_shop.orders SET status = 'expired', expires_at = null WHERE id = o.id;
  END LOOP;
  DELETE FROM holiday_shop.traffic WHERE resets_at < now() - interval '1 day';
END
$function$;

-- Customer account returns only orders belonging to the verified identity supplied by the edge function.
CREATE OR REPLACE FUNCTION public.holiday_account(p_customer uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO ''
AS $account$
 select coalesce(jsonb_agg(to_jsonb(q) order by created_at desc),'[]') from
 (select o.id,o.created_at,o.status,o.total,o.shipping_cents,o.paid,o.refunded,o.fulfillment,o.estimated_date,o.carrier,o.tracking_number,o.shipped_at
  from holiday_shop.orders o where o.customer_id=p_customer order by o.created_at desc limit 100) q
$account$;
REVOKE ALL ON FUNCTION public.holiday_account(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.holiday_account(uuid) TO service_role;

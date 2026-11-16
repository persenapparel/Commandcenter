-- STAGING ONLY, UNAPPLIED DRAFT. Original owner-only RPCs unchanged.
-- Derived from deployed staging cash and finish functions on Nov 16, 2026.
-- Cash requires a server-confirmed guest step, but guest contact is optional.
-- Review grant revocation races and run SQL, RLS, and iPad E2E tests before applying.
CREATE OR REPLACE FUNCTION public.pos_staff_complete_cash(p_shift_id uuid,p_shift_secret text,p_checkout uuid, p_tender_cents integer, p_received_breakdown jsonb DEFAULT '{}'::jsonb, p_change_breakdown jsonb DEFAULT '{}'::jsonb, p_expected_drawer_version integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_uid uuid:=auth.uid();v_owner uuid;
 c public.pos_checkouts;
 r public.pos_registers;
 line jsonb; sid uuid; regid uuid;
 received jsonb; payout jsonb; counted jsonb; available jsonb; adjusted jsonb;
 denom integer; qty integer; affected integer;
 incoming_total bigint:=0; payout_total bigint:=0; change_due integer;
 denominations integer[]:=array[10000,5000,2000,1000,500,100,25,10,5,1];
begin
 if v_uid is null or p_shift_secret is null or p_shift_secret !~ '^[a-f0-9]{64}
 select * into r from public.pos_registers where id=regid and owner_id=v_owner and active for update;
 if not found then raise exception 'Register unavailable'; end if;
 if not exists(select 1  from public.pos_checkouts sc
 join public.pos_checkout_handoffs h on h.checkout_id=sc.id
 join public.pos_staff_shifts s on s.id=h.shift_id
 join public.pos_staff_credentials staff on staff.id=s.staff_id
 join public.pos_registers reg on reg.id=sc.register_id and reg.owner_id=sc.owner_id
 join public.pos_staff_register_grants g on g.register_id=reg.id and g.owner_id=reg.owner_id and g.staff_id=staff.id
 where sc.id=p_checkout and h.shift_id=p_shift_id and h.auth_user_id=v_uid
 and h.phase='cashier' and s.auth_user_id=v_uid and s.revoked_at is null and s.expires_at>now()
 and staff.auth_user_id=v_uid and staff.enabled=true and staff.credential_version=s.credential_version
 and s.secret_digest=extensions.digest(p_shift_secret,'sha256') and reg.active and g.active) then raise exception 'Staff cash denied'; end if;
 select * into c from public.pos_checkouts where id=p_checkout and owner_id=v_owner for update;
 if c.status='completed' then
  select id into sid from public.pos_sales where checkout_id=c.id and owner_id=v_owner
   and tendered_cents=p_tender_cents;
  if found then return sid; end if;
  raise exception 'Checkout already completed';
 end if;
 if c.status<>'contact_received' then raise exception 'Customer contact required'; end if;
 if c.payment_preference<>'cash' then raise exception 'Information-only payment selection cannot be recorded as paid cash'; end if;
 if p_tender_cents is null or p_tender_cents<c.total_cents or p_tender_cents>1000000 then
  raise exception 'Invalid or insufficient cash amount'; end if;
 change_due:=p_tender_cents-c.total_cents;
 if change_due>50000 then raise exception 'Change limit exceeded'; end if;
 received:=pos_internal.valid_counts(coalesce(p_received_breakdown,'{}'::jsonb));
 payout:=pos_internal.valid_counts(coalesce(p_change_breakdown,'{}'::jsonb));
 counted:=pos_internal.valid_counts(coalesce(r.cash_drawer,'{}'::jsonb));
 available:=counted;
 foreach denom in array denominations loop
  qty:=(received->>denom::text)::integer;
  incoming_total:=incoming_total+denom::bigint*qty;
  available:=jsonb_set(available,array[denom::text],to_jsonb((available->>denom::text)::integer+qty));
 end loop;
 if incoming_total<>0 and incoming_total<>p_tender_cents then raise exception 'Received bill totals do not match tender'; end if;
 if not r.drawer_configured and change_due>0 then raise exception 'Count cash drawer to verify change'; end if;
 if r.drawer_configured and (p_expected_drawer_version is null or p_expected_drawer_version<>r.drawer_version) then
  raise exception 'Drawer changed on another device; reload counts'; end if;
 adjusted:=available;
 foreach denom in array denominations loop
  qty:=(payout->>denom::text)::integer;
  payout_total:=payout_total+denom::bigint*qty;
  if qty>(adjusted->>denom::text)::integer then raise exception 'Insufficient counted change denominations'; end if;
  adjusted:=jsonb_set(adjusted,array[denom::text],to_jsonb((adjusted->>denom::text)::integer-qty));
 end loop;
 if payout_total<>change_due then raise exception 'Change payout must equal amount due'; end if;
 if r.drawer_configured then
  update public.pos_registers set cash_drawer=adjusted,drawer_version=drawer_version+1 where id=r.id;
 end if;
 -- The stock adjustment, sale, paper job and digital jobs all commit atomically.
 for line in select value from jsonb_array_elements(c.items) order by (value->>'stock_id') nulls last loop
  if line->>'stock_id' is not null and line->>'stock_id'<>'null' then
   update public.stock_items set quantity=quantity-(line->>'qty')::integer,updated_at=now()
    where id=(line->>'stock_id')::uuid and quantity>=(line->>'qty')::integer;
   get diagnostics affected=row_count;
   if affected<>1 then raise exception 'Stock changed; cancel and rebuild checkout'; end if;
  end if;
 end loop;
 insert into public.pos_sales(
  checkout_id,owner_id,event_id,snapshot,subtotal_cents,discount_cents,tax_cents,total_cents,
  payment_method,tendered_cents,change_cents,change_breakdown
 ) values(c.id,v_owner,c.event_id,
  jsonb_build_object('items',c.items,'phone',c.phone,'email',c.email,
   'marketing_opt_in',c.marketing_opt_in,'consent_updated_at',c.consent_updated_at,
   'rating',c.rating,'custom_interest',c.custom_interest,
   'receipt_print',c.receipt_print,'receipt_email',c.receipt_email,
   'payment_preference',c.payment_preference),
  c.subtotal_cents,c.discount_cents,c.tax_cents,c.total_cents,
  'cash',p_tender_cents,change_due,payout
 ) returning id into sid;
 if c.receipt_print then
  insert into public.pos_print_jobs(sale_id,owner_id,register_id)
  values(sid,v_owner,c.register_id);
 end if;
 if c.receipt_email and nullif(trim(coalesce(c.email,'')),'') is not null then
  insert into public.pos_receipt_delivery_jobs(sale_id,owner_id,channel)
  values(sid,v_owner,'email');
 end if;
 update public.pos_checkouts set status='completed',updated_at=now() where id=c.id;
 return sid;
end $function$
 then raise exception 'Staff cash denied'; end if;
 select sc.register_id,sc.owner_id into regid,v_owner  from public.pos_checkouts sc
 join public.pos_checkout_handoffs h on h.checkout_id=sc.id
 join public.pos_staff_shifts s on s.id=h.shift_id
 join public.pos_staff_credentials staff on staff.id=s.staff_id
 join public.pos_registers reg on reg.id=sc.register_id and reg.owner_id=sc.owner_id
 join public.pos_staff_register_grants g on g.register_id=reg.id and g.owner_id=reg.owner_id and g.staff_id=staff.id
 where sc.id=p_checkout and h.shift_id=p_shift_id and h.auth_user_id=v_uid
 and h.phase='cashier' and s.auth_user_id=v_uid and s.revoked_at is null and s.expires_at>now()
 and staff.auth_user_id=v_uid and staff.enabled=true and staff.credential_version=s.credential_version
 and s.secret_digest=extensions.digest(p_shift_secret,'sha256') and reg.active and g.active;
 if regid is null then raise exception 'Staff cash denied'; end if;
 select * into r from public.pos_registers where id=regid and owner_id=v_owner and active for update;
 if not found then raise exception 'Register unavailable'; end if;
 select * into c from public.pos_checkouts where id=p_checkout and owner_id=v_owner for update;
 if c.status='completed' then
  select id into sid from public.pos_sales where checkout_id=c.id and owner_id=v_owner
   and tendered_cents=p_tender_cents;
  if found then return sid; end if;
  raise exception 'Checkout already completed';
 end if;
 if c.status<>'contact_received' then raise exception 'Customer contact required'; end if;
 if c.payment_preference<>'cash' then raise exception 'Information-only payment selection cannot be recorded as paid cash'; end if;
 if p_tender_cents is null or p_tender_cents<c.total_cents or p_tender_cents>1000000 then
  raise exception 'Invalid or insufficient cash amount'; end if;
 change_due:=p_tender_cents-c.total_cents;
 if change_due>50000 then raise exception 'Change limit exceeded'; end if;
 received:=pos_internal.valid_counts(coalesce(p_received_breakdown,'{}'::jsonb));
 payout:=pos_internal.valid_counts(coalesce(p_change_breakdown,'{}'::jsonb));
 counted:=pos_internal.valid_counts(coalesce(r.cash_drawer,'{}'::jsonb));
 available:=counted;
 foreach denom in array denominations loop
  qty:=(received->>denom::text)::integer;
  incoming_total:=incoming_total+denom::bigint*qty;
  available:=jsonb_set(available,array[denom::text],to_jsonb((available->>denom::text)::integer+qty));
 end loop;
 if incoming_total<>0 and incoming_total<>p_tender_cents then raise exception 'Received bill totals do not match tender'; end if;
 if not r.drawer_configured and change_due>0 then raise exception 'Count cash drawer to verify change'; end if;
 if r.drawer_configured and (p_expected_drawer_version is null or p_expected_drawer_version<>r.drawer_version) then
  raise exception 'Drawer changed on another device; reload counts'; end if;
 adjusted:=available;
 foreach denom in array denominations loop
  qty:=(payout->>denom::text)::integer;
  payout_total:=payout_total+denom::bigint*qty;
  if qty>(adjusted->>denom::text)::integer then raise exception 'Insufficient counted change denominations'; end if;
  adjusted:=jsonb_set(adjusted,array[denom::text],to_jsonb((adjusted->>denom::text)::integer-qty));
 end loop;
 if payout_total<>change_due then raise exception 'Change payout must equal amount due'; end if;
 if r.drawer_configured then
  update public.pos_registers set cash_drawer=adjusted,drawer_version=drawer_version+1 where id=r.id;
 end if;
 -- The stock adjustment, sale, paper job and digital jobs all commit atomically.
 for line in select value from jsonb_array_elements(c.items) order by (value->>'stock_id') nulls last loop
  if line->>'stock_id' is not null and line->>'stock_id'<>'null' then
   update public.stock_items set quantity=quantity-(line->>'qty')::integer,updated_at=now()
    where id=(line->>'stock_id')::uuid and quantity>=(line->>'qty')::integer;
   get diagnostics affected=row_count;
   if affected<>1 then raise exception 'Stock changed; cancel and rebuild checkout'; end if;
  end if;
 end loop;
 insert into public.pos_sales(
  checkout_id,owner_id,event_id,snapshot,subtotal_cents,discount_cents,tax_cents,total_cents,
  payment_method,tendered_cents,change_cents,change_breakdown
 ) values(c.id,v_owner,c.event_id,
  jsonb_build_object('items',c.items,'phone',c.phone,'email',c.email,
   'marketing_opt_in',c.marketing_opt_in,'consent_updated_at',c.consent_updated_at,
   'rating',c.rating,'custom_interest',c.custom_interest,
   'receipt_print',c.receipt_print,'receipt_email',c.receipt_email,
   'payment_preference',c.payment_preference),
  c.subtotal_cents,c.discount_cents,c.tax_cents,c.total_cents,
  'cash',p_tender_cents,change_due,payout
 ) returning id into sid;
 if c.receipt_print then
  insert into public.pos_print_jobs(sale_id,owner_id,register_id)
  values(sid,v_owner,c.register_id);
 end if;
 if c.receipt_email and nullif(trim(coalesce(c.email,'')),'') is not null then
  insert into public.pos_receipt_delivery_jobs(sale_id,owner_id,channel)
  values(sid,v_owner,'email');
 end if;
 update public.pos_checkouts set status='completed',updated_at=now() where id=c.id;
 return sid;
end $function$

CREATE OR REPLACE FUNCTION public.pos_staff_finish_order(p_shift_id uuid,p_shift_secret text,p_checkout uuid
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.pos_checkouts;v_uid uuid:=auth.uid();v_owner uuid;
begin
 if v_uid is null or p_shift_secret is null or p_shift_secret !~ '^[a-f0-9]{64}
 if not found or c.status<>'completed' or
    not exists(select 1 from public.pos_sales where checkout_id=c.id and owner_id=v_owner) then
  raise exception 'Paid checkout not found';
 end if;
 if c.cash_handoff_complete then return true; end if;
 update public.pos_checkouts set cash_handoff_complete=true,updated_at=now() where id=c.id;
 return true;
end $function$
 then raise exception 'Staff finish denied'; end if;
 select sc.owner_id into v_owner  from public.pos_checkouts sc
 join public.pos_checkout_handoffs h on h.checkout_id=sc.id
 join public.pos_staff_shifts s on s.id=h.shift_id
 join public.pos_staff_credentials staff on staff.id=s.staff_id
 join public.pos_registers reg on reg.id=sc.register_id and reg.owner_id=sc.owner_id
 join public.pos_staff_register_grants g on g.register_id=reg.id and g.owner_id=reg.owner_id and g.staff_id=staff.id
 where sc.id=p_checkout and h.shift_id=p_shift_id and h.auth_user_id=v_uid
 and h.phase='cashier' and s.auth_user_id=v_uid and s.revoked_at is null and s.expires_at>now()
 and staff.auth_user_id=v_uid and staff.enabled=true and staff.credential_version=s.credential_version
 and s.secret_digest=extensions.digest(p_shift_secret,'sha256') and reg.active and g.active;
 if v_owner is null then raise exception 'Staff finish denied'; end if;
 select * into c from public.pos_checkouts where id=p_checkout and owner_id=v_owner for update;
 if not exists(select 1  from public.pos_checkouts sc
 join public.pos_checkout_handoffs h on h.checkout_id=sc.id
 join public.pos_staff_shifts s on s.id=h.shift_id
 join public.pos_staff_credentials staff on staff.id=s.staff_id
 join public.pos_registers reg on reg.id=sc.register_id and reg.owner_id=sc.owner_id
 join public.pos_staff_register_grants g on g.register_id=reg.id and g.owner_id=reg.owner_id and g.staff_id=staff.id
 where sc.id=p_checkout and h.shift_id=p_shift_id and h.auth_user_id=v_uid
 and h.phase='cashier' and s.auth_user_id=v_uid and s.revoked_at is null and s.expires_at>now()
 and staff.auth_user_id=v_uid and staff.enabled=true and staff.credential_version=s.credential_version
 and s.secret_digest=extensions.digest(p_shift_secret,'sha256') and reg.active and g.active) then raise exception 'Staff finish denied'; end if;
 if not found or c.status<>'completed' or
    not exists(select 1 from public.pos_sales where checkout_id=c.id and owner_id=v_owner) then
  raise exception 'Paid checkout not found';
 end if;
 if c.cash_handoff_complete then return true; end if;
 update public.pos_checkouts set cash_handoff_complete=true,updated_at=now() where id=c.id;
 return true;
end $function$

revoke all on function public.pos_staff_complete_cash(uuid,text,uuid,integer,jsonb,jsonb,integer) from public,anon;
grant execute on function public.pos_staff_complete_cash(uuid,text,uuid,integer,jsonb,jsonb,integer) to authenticated;
revoke all on function public.pos_staff_finish_order(uuid,text,uuid) from public,anon;
grant execute on function public.pos_staff_finish_order(uuid,text,uuid) to authenticated;

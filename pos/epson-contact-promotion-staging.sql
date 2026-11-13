-- PERSEN POS STAGING ONLY. Apply after pos/pos-schema-review.sql, pos/epson-t20iv-staging.sql,
-- and pos/pos-customer-answers-v2.sql are reviewed and installed.
-- Preserve previous sales; no production changes and no customer messages.
-- Contact details are returned ONLY in owner-authorized print RPC, NOT public display/queue.

create or replace function public.pos_complete_cash(
 p_checkout uuid,p_tender_cents integer,
 p_received_breakdown jsonb default '{}'::jsonb,
 p_change_breakdown jsonb default '{}'::jsonb,
 p_expected_drawer_version integer default null
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 c public.pos_checkouts;
 r public.pos_registers;
 line jsonb; sid uuid; regid uuid; receipt_design jsonb:='{}'::jsonb;
 received jsonb; payout jsonb; counted jsonb; available jsonb; adjusted jsonb;
 denom integer; qty integer; affected integer;
 incoming_total bigint:=0; payout_total bigint:=0; change_due integer;
 denominations integer[]:=array[10000,5000,2000,1000,500,100,25,10,5,1];
begin
 if (select auth.uid()) is null or not public.is_persen_admin() then raise exception 'Unauthorized'; end if;
 -- Acquire the register lock before checkout lock to match begin-checkout ordering.
 select register_id into regid from public.pos_checkouts where id=p_checkout and owner_id=(select auth.uid());
 if regid is null then raise exception 'Checkout unavailable'; end if;
 select * into r from public.pos_registers where id=regid and owner_id=(select auth.uid()) and active for update;
 if not found then raise exception 'Register unavailable'; end if;
 select * into c from public.pos_checkouts where id=p_checkout and owner_id=(select auth.uid()) for update;
 if c.status='completed' then
  select id into sid from public.pos_sales where checkout_id=c.id and owner_id=(select auth.uid())
   and tendered_cents=p_tender_cents;
  if found then return sid; end if;
  raise exception 'Checkout already completed';
 end if;
 if c.status<>'contact_received' then raise exception 'Customer contact required'; end if;
 if c.payment_preference<>'cash' then raise exception 'Information-only payment selection cannot be recorded as paid cash'; end if;
 if length(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'))<10 then raise exception 'Customer phone required'; end if;
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
 -- Freeze current promotion at sale completion, not when the queued print is sent.
 select jsonb_build_object(
  'headline',left(t.headline,100),'promotion',left(t.promotion,300),
  'footer',left(t.footer,120),'review_message',left(t.review_message,130),
  'show_review',t.show_review
 ) into receipt_design
 from public.pos_receipt_templates t
 where t.owner_id=(select auth.uid()) and t.active=true
 limit 1;
 insert into public.pos_sales(
  checkout_id,owner_id,event_id,snapshot,subtotal_cents,discount_cents,tax_cents,total_cents,
  payment_method,tendered_cents,change_cents,change_breakdown
 ) values(c.id,(select auth.uid()),c.event_id,
  jsonb_build_object('items',c.items,'phone',c.phone,'email',c.email,
   'marketing_opt_in',c.marketing_opt_in,'consent_updated_at',c.consent_updated_at,
   'rating',c.rating,'custom_interest',c.custom_interest,
   'receipt_print',true,'receipt_email',c.receipt_email,
    'receipt_design',coalesce(receipt_design,'{}'::jsonb),
   'payment_preference',c.payment_preference),
  c.subtotal_cents,c.discount_cents,c.tax_cents,c.total_cents,
  'cash',p_tender_cents,change_due,payout
 ) returning id into sid;
 -- Epson vendor-show policy: one print job (two cut copies) for each saved cash sale.
 insert into public.pos_print_jobs(sale_id,owner_id,register_id)
 values(sid,(select auth.uid()),c.register_id);
 if c.receipt_email and nullif(trim(coalesce(c.email,'')),'') is not null then
  insert into public.pos_receipt_delivery_jobs(sale_id,owner_id,channel)
  values(sid,(select auth.uid()),'email');
 end if;
 update public.pos_checkouts set status='completed',cash_handoff_complete=false,updated_at=now() where id=c.id;
 return sid;
end $$;

create or replace function public.pos_claim_print_job(p_job uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.pos_print_jobs; sale public.pos_sales; event_name text;
begin
 if (select auth.uid()) is null or not public.is_persen_admin() then
   raise exception 'Unauthorized';
 end if;
 update public.pos_print_jobs
 set state='printing', attempts=attempts+1, claimed_at=now(), last_error=null
 where id=p_job and owner_id=(select auth.uid())
   and state='queued' and attempts<5
 returning * into j;
 if not found then return null; end if;
 select * into sale from public.pos_sales where id=j.sale_id and owner_id=(select auth.uid());
 if not found then raise exception 'Sale no longer available'; end if;
 select name into event_name from public.pos_events where id=sale.event_id and owner_id=(select auth.uid());
 return jsonb_build_object(
    'job_id',j.id,'sale_id',sale.id,'event_name',event_name,
    'items',sale.snapshot->'items',
    'phone',sale.snapshot->>'phone',
    'email',sale.snapshot->>'email',
    'headline',sale.snapshot->'receipt_design'->>'headline',
    'promotion',sale.snapshot->'receipt_design'->>'promotion',
    'footer',sale.snapshot->'receipt_design'->>'footer',
    'review_message',case when coalesce((sale.snapshot->'receipt_design'->>'show_review')::boolean,false) then sale.snapshot->'receipt_design'->>'review_message' else null end,
    'subtotal_cents',sale.subtotal_cents,
    'discount_cents',sale.discount_cents,
    'tax_cents',sale.tax_cents,
    'total_cents',sale.total_cents,
    'tendered_cents',sale.tendered_cents,
    'change_cents',sale.change_cents,
    'payment_method',sale.payment_method,
    'created_at',sale.created_at
 );
end $$;

-- Activate a saved receipt campaign for this owner; only one may be active.
-- Atomic owner-scoped switch prevents two cashier tabs from producing a unique-index conflict.
create or replace function public.pos_activate_receipt_template(p_template uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null or not public.is_persen_admin() then raise exception 'Unauthorized'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('pos.receipt.'||(select auth.uid())::text));
 if not exists (
   select 1 from public.pos_receipt_templates
   where id=p_template and owner_id=(select auth.uid())
 ) then raise exception 'Saved receipt template not found'; end if;
 update public.pos_receipt_templates set active=false where owner_id=(select auth.uid()) and active;
 update public.pos_receipt_templates set active=true,updated_at=now() where id=p_template and owner_id=(select auth.uid());
 return found;
end $$;
revoke all on function public.pos_activate_receipt_template(uuid) from public,anon;
grant execute on function public.pos_activate_receipt_template(uuid) to authenticated;

-- Original RPC grant permissions remain in place; explicitly pin owner-only RPC access.
revoke all on function public.pos_complete_cash(uuid,integer,jsonb,jsonb,integer) from public,anon;
grant execute on function public.pos_complete_cash(uuid,integer,jsonb,jsonb,integer) to authenticated;
revoke all on function public.pos_claim_print_job(uuid) from public,anon;
grant execute on function public.pos_claim_print_job(uuid) to authenticated;

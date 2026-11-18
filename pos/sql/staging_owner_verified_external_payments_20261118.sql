-- STAGING ONLY — external transfer records require independent owner
-- verification. Customer/employee selections never authorize payment.
-- Apple Cash and Apple Pay are different payment rails. This flow records
-- manually verified Apple Cash, NOT merchant Apple Pay processing.
alter table public.pos_sales drop constraint if exists pos_sales_payment_method_check;
alter table public.pos_sales add constraint pos_sales_payment_method_check
 check(payment_method in ('cash','venmo','apple_cash'));

create table if not exists public.pos_external_payment_approvals (
 checkout_id uuid primary key references public.pos_checkouts(id),
 sale_id uuid not null unique references public.pos_sales(id),
 owner_id uuid not null references auth.users(id),
 method text not null check(method in ('venmo','apple_cash')),
 total_cents integer not null check(total_cents>0),
 approved_by uuid not null references auth.users(id),
 approved_at timestamptz not null default now()
);
alter table public.pos_external_payment_approvals enable row level security;
revoke all on public.pos_external_payment_approvals from public,anon,authenticated;

-- The existing one-use guest capability remains the ONLY guest route
-- to set the informational preference; it cannot settle payment.
CREATE OR REPLACE FUNCTION public.pos_handoff_guest_submit(p_checkout uuid, p_capability text, p_answers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_handoff public.pos_checkout_handoffs%rowtype;
 v_checkout public.pos_checkouts%rowtype;
 v_phone text; v_email text; v_signature text; v_exception boolean;
 v_marketing boolean; v_payment text;
begin
 if p_capability is null or p_capability !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_answers) is distinct from 'object' then
   raise exception 'Checkout unavailable';
 end if;
 select * into v_handoff from public.pos_checkout_handoffs
 where checkout_id=p_checkout and phase='guest'
   and capability_expires_at>now()
   and capability_digest=extensions.digest(p_capability,'sha256')
 for update;
 if not found then raise exception 'Checkout unavailable'; end if;
 select * into v_checkout from public.pos_checkouts
 where id=p_checkout and status='awaiting_customer'
   and created_at>now()-interval '30 minutes'
 for update;
 if not found then raise exception 'Checkout unavailable'; end if;
 v_phone:=btrim(coalesce(p_answers->>'phone',''));
 v_email:=btrim(coalesce(p_answers->>'email',''));
 v_signature:=btrim(coalesce(p_answers->>'signature',''));
 if jsonb_typeof(p_answers->'marketingConsent') not in ('boolean','null')
    and p_answers ? 'marketingConsent' then
  raise exception 'Invalid customer answer';
 end if;
 if jsonb_typeof(p_answers->'signatureException') not in ('boolean','null')
    and p_answers ? 'signatureException' then
  raise exception 'Invalid customer answer';
 end if;
 if p_answers ? 'paymentPreference' and
    jsonb_typeof(p_answers->'paymentPreference') <> 'string' then
  raise exception 'Invalid payment preference';
 end if;
 v_payment:=coalesce(p_answers->>'paymentPreference','cash');
 if v_payment not in ('cash','venmo_info','apple_cash_info') then
  raise exception 'Invalid payment preference';
 end if;
 v_marketing:=coalesce((p_answers->>'marketingConsent')::boolean,false);
 v_exception:=coalesce((p_answers->>'signatureException')::boolean,false);
 if length(v_phone)>24 or (length(v_phone)>0 and
    length(regexp_replace(v_phone,'[^0-9]','','g')) not between 10 and 15)
   or length(v_email)>250
   or (v_email<>'' and v_email !~ '^[^ @]+@[^ @]+[.][^ @]+$')
   or (not v_exception and length(v_signature) not between 1 and 160)
   or (v_exception and v_signature<>'') then
  raise exception 'Invalid customer answer';
 end if;
 update public.pos_checkouts
 set phone=nullif(v_phone,''),email=nullif(v_email,''),
     payment_preference=v_payment,
     marketing_opt_in=v_marketing,
     consent_updated_at=case when v_marketing then now() else null end,
     customer_step='review',progress_updated_at=now(),
     status='contact_received',updated_at=now()
 where id=p_checkout;
 -- Only the protected signature table stores the limited typed acknowledgment.
 insert into public.pos_checkout_signatures(checkout_id,typed_name,accessibility_exception)
 values(p_checkout,case when v_exception then null else v_signature end,v_exception);
 update public.pos_checkout_handoffs
 set phase='customer_complete',capability_digest=null,capability_expires_at=null,
     updated_at=now()
 where checkout_id=p_checkout;
 return jsonb_build_object('accepted',true);
end $function$
;
revoke all on function public.pos_handoff_guest_submit(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.pos_handoff_guest_submit(uuid,text,jsonb) to service_role;
-- Called internally by the restricted Edge Function service role.

-- Manual owner approval is a separate authenticated cashier-side operation,
-- requiring actual owner badge/PIN in addition to a signed-in admin session.
create or replace function public.pos_owner_confirm_external_payment(
 p_checkout uuid,p_owner_badge text,p_owner_pin text,
 p_cashier_confirmed boolean,p_owner_verified boolean
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
 v_uid uuid:=auth.uid();
 v_attempt public.pos_staff_auth_attempts%rowtype;
 v_owner public.pos_staff_credentials%rowtype;
 v_c public.pos_checkouts%rowtype;
 v_r public.pos_registers%rowtype;
 v_method text;
 v_sid uuid;
 v_item jsonb;
 v_affected integer;
begin
 if v_uid is null or not public.is_persen_admin()
    or p_checkout is null or p_cashier_confirmed is distinct from true
    or p_owner_verified is distinct from true then
   raise exception 'Owner authorization and independent payment verification required';
 end if;
 if length(coalesce(p_owner_badge,'')) not between 8 and 256
    or length(coalesce(p_owner_pin,'')) not between 6 and 128 then
   raise exception 'Owner badge and PIN required';
 end if;
 insert into public.pos_staff_auth_attempts(auth_user_id)
 values(v_uid) on conflict(auth_user_id) do nothing;
 select * into v_attempt from public.pos_staff_auth_attempts
 where auth_user_id=v_uid for update;
 if v_attempt.blocked_until>now() then
   raise exception 'Owner verification temporarily unavailable';
 end if;
 if v_attempt.window_started<now()-interval '15 minutes' then
   update public.pos_staff_auth_attempts
   set attempts=0,window_started=now(),blocked_until=null
   where auth_user_id=v_uid;
 end if;
 select * into v_owner from public.pos_staff_credentials
 where auth_user_id=v_uid and staff_role='owner' and enabled=true
   and badge_digest=extensions.digest(btrim(p_owner_badge),'sha256')
   and extensions.crypt(p_owner_pin,pin_hash)=pin_hash
 for update;
 if not found then
   update public.pos_staff_auth_attempts
   set attempts=attempts+1,
      blocked_until=case when attempts+1>=5 then now()+interval '15 minutes' else null end
   where auth_user_id=v_uid;
   return jsonb_build_object('approved',false);
 end if;
 select * into v_c from public.pos_checkouts
 where id=p_checkout and owner_id=v_uid for update;
 if not found or v_c.status<>'contact_received' or
    v_c.payment_preference not in ('venmo_info','apple_cash_info')
    or v_c.total_cents not between 1 and 1000000 then
   raise exception 'Unpaid external checkout unavailable';
 end if;
 select * into v_r from public.pos_registers
 where id=v_c.register_id and owner_id=v_uid and active=true for update;
 if not found then raise exception 'Register is unavailable'; end if;
 if not exists(
   select 1 from public.pos_checkout_handoffs h
   join public.pos_staff_shifts shift on shift.id=h.shift_id
   join public.pos_staff_credentials staff on staff.id=shift.staff_id
   join public.pos_staff_register_grants grant_row on
      grant_row.staff_id=staff.id and grant_row.register_id=v_r.id
      and grant_row.owner_id=v_uid and grant_row.active=true
   where h.checkout_id=v_c.id and h.register_id=v_r.id
     and h.phase='cashier' and h.auth_user_id=shift.auth_user_id
     and shift.revoked_at is null and shift.expires_at>now()
     and staff.enabled=true and staff.credential_version=shift.credential_version
 ) then raise exception 'Current cashier handoff not verified'; end if;
 if exists(select 1 from public.pos_sales where checkout_id=v_c.id) or
    exists(select 1 from public.pos_external_payment_approvals where checkout_id=v_c.id) then
   raise exception 'Checkout already settled';
 end if;
 v_method:=case v_c.payment_preference
   when 'venmo_info' then 'venmo' else 'apple_cash' end;
 -- Atomic inventory decrement; no drawer movement for an external payment.
 for v_item in select value from jsonb_array_elements(v_c.items)
   order by (value->>'stock_id') nulls last loop
   if v_item->>'stock_id' is not null and v_item->>'stock_id'<>'null' then
     update public.stock_items
       set quantity=quantity-(v_item->>'qty')::integer,updated_at=now()
     where id=(v_item->>'stock_id')::uuid
       and quantity>=(v_item->>'qty')::integer;
     get diagnostics v_affected=row_count;
     if v_affected<>1 then
       raise exception 'Inventory changed; do not record payment as settled';
     end if;
   end if;
 end loop;
 insert into public.pos_sales (
   checkout_id,owner_id,event_id,snapshot,subtotal_cents,discount_cents,
   tax_cents,total_cents,payment_method,tendered_cents,change_cents,change_breakdown
 ) values (
   v_c.id,v_uid,v_c.event_id,
   jsonb_build_object('items',v_c.items,'phone',v_c.phone,'email',v_c.email,
     'marketing_opt_in',v_c.marketing_opt_in,'consent_updated_at',v_c.consent_updated_at,
     'rating',v_c.rating,'custom_interest',v_c.custom_interest,
     'receipt_print',false,'receipt_email',v_c.receipt_email,
     'payment_preference',v_c.payment_preference,'owner_verified_external',true),
   v_c.subtotal_cents,v_c.discount_cents,v_c.tax_cents,v_c.total_cents,
   v_method,v_c.total_cents,0,'{}'::jsonb
 ) returning id into v_sid;
 insert into public.pos_external_payment_approvals(
   checkout_id,sale_id,owner_id,method,total_cents,approved_by
 ) values(v_c.id,v_sid,v_uid,v_method,v_c.total_cents,v_uid);
 -- Receipt emails can still be queued, but no automatic Epson cash-drawer
 -- print job is created for a transfer. Owner can print from back office.
 if v_c.receipt_email and nullif(btrim(coalesce(v_c.email,'')),'') is not null then
   insert into public.pos_receipt_delivery_jobs(sale_id,owner_id,channel)
   values(v_sid,v_uid,'email');
 end if;
 update public.pos_checkouts set status='completed',updated_at=now()
 where id=v_c.id;
 update public.pos_staff_auth_attempts
   set attempts=0,window_started=now(),blocked_until=null
 where auth_user_id=v_uid;
 return jsonb_build_object('approved',true,'checkoutId',v_c.id,
    'saleId',v_sid,'method',v_method);
end;
$$;
revoke all on function public.pos_owner_confirm_external_payment(uuid,text,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.pos_owner_confirm_external_payment(uuid,text,text,boolean,boolean) to authenticated;

-- Untrusted client payment choices are never enough for this paid verification.
CREATE OR REPLACE FUNCTION public.pos_handoff_verify_paid(p_checkout uuid, p_shift_id uuid, p_shift_secret text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid:=auth.uid();v_saved uuid;
begin
 if v_uid is null or p_shift_secret is null or
    p_shift_secret !~ '^[a-f0-9]{64}$' then
  raise exception 'Checkout authorization denied';
 end if;
 select sale.id into v_saved
 from public.pos_checkout_handoffs h
 join public.pos_checkouts c on c.id=h.checkout_id
 join public.pos_staff_shifts s on s.id=h.shift_id
 join public.pos_staff_credentials staff on staff.id=s.staff_id
 join public.pos_registers r on r.id=c.register_id and r.owner_id=c.owner_id
 join public.pos_sales sale on sale.checkout_id=c.id
 where h.checkout_id=p_checkout and h.shift_id=p_shift_id
   and h.auth_user_id=v_uid and r.active
    and ((c.owner_id=v_uid and public.is_persen_admin())
      or exists (select 1 from public.pos_staff_register_grants g
                 where g.register_id=r.id and g.owner_id=r.owner_id
                   and g.staff_id=s.staff_id and g.active=true))
   and h.phase='cashier' and c.status='completed'
   and c.cash_handoff_complete=true
   and sale.owner_id=c.owner_id
   and (
     (sale.payment_method='cash' and c.payment_preference='cash') or
     (sale.payment_method='venmo' and c.payment_preference='venmo_info'
       and exists(select 1 from public.pos_external_payment_approvals a
         where a.sale_id=sale.id and a.checkout_id=c.id and a.owner_id=c.owner_id
           and a.method='venmo')) or
     (sale.payment_method='apple_cash' and c.payment_preference='apple_cash_info'
       and exists(select 1 from public.pos_external_payment_approvals a
         where a.sale_id=sale.id and a.checkout_id=c.id and a.owner_id=c.owner_id
           and a.method='apple_cash'))
   )
   and s.auth_user_id=v_uid and s.revoked_at is null and s.expires_at>now()
   and staff.enabled=true and staff.auth_user_id=v_uid
    and staff.credential_version=s.credential_version
   and s.secret_digest=extensions.digest(p_shift_secret,'sha256');
 return jsonb_build_object('checkoutId',p_checkout,
    'completed',v_saved is not null);
end $function$
;
revoke all on function public.pos_handoff_verify_paid(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.pos_handoff_verify_paid(uuid,uuid,text) to authenticated;

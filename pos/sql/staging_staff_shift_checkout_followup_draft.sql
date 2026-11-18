-- STAGING ONLY: use AFTER staging_staff_authorized_begin_draft.sql.
-- Owner-granted employee checkout follow-up, with original shift and register grants.
-- Not permission to enable UI handoff without verified browser isolation.

create or replace function public.pos_handoff_resume(
 p_checkout uuid,p_shift_id uuid,p_shift_secret text,p_badge text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid:=auth.uid();
 v_checkout public.pos_checkouts%rowtype;
 v_handoff public.pos_checkout_handoffs%rowtype;
 v_proof jsonb;
begin
 if v_uid is null then raise exception 'Checkout authorization denied'; end if;
 select * into v_checkout from public.pos_checkouts
 where id=p_checkout and status='contact_received'
 for update;
 if not found then raise exception 'Checkout authorization denied'; end if;
 select * into v_handoff from public.pos_checkout_handoffs
 where checkout_id=p_checkout and shift_id=p_shift_id and auth_user_id=v_uid
 and phase='customer_complete' and capability_digest is null
 for update;
 if not found then raise exception 'Checkout authorization denied'; end if;

 -- Original-shift authorization: the checkout belongs to the register owner,
 -- but the staff auth UID must match the shift AND an active owner grant.
 if not exists (
  select 1 from public.pos_staff_shifts s
  join public.pos_staff_credentials staff on staff.id=s.staff_id
  join public.pos_registers r on r.id=v_checkout.register_id
  where s.id=p_shift_id and s.auth_user_id=v_uid
    and s.revoked_at is null and s.expires_at>now()
    and staff.auth_user_id=v_uid and staff.enabled=true
    and staff.credential_version=s.credential_version
    and s.secret_digest=extensions.digest(p_shift_secret,'sha256')
    and r.owner_id=v_checkout.owner_id and r.active
    and ((v_checkout.owner_id=v_uid and public.is_persen_admin())
      or exists (
        select 1 from public.pos_staff_register_grants g
        where g.register_id=r.id and g.owner_id=r.owner_id
          and g.staff_id=s.staff_id and g.active=true
      ))
 ) then raise exception 'Checkout authorization denied'; end if;
 v_proof:=public.pos_staff_resume_shift(
  p_shift_id,p_shift_secret,p_badge,v_checkout.register_id
 );
 if coalesce((v_proof->>'ok')::boolean,false) is not true then
  -- Return failure instead of raising; otherwise PostgreSQL rolls back the
  -- nested badge attempt counter and defeats the PIN/badge throttle.
  return jsonb_build_object('verified',false,'error','Checkout authorization denied');
 end if;
 update public.pos_checkout_handoffs
 set phase='cashier',resumed_at=now(),updated_at=now()
 where checkout_id=p_checkout;
 return jsonb_build_object('verified',true,'checkoutId',p_checkout);
end $$;
revoke all on function public.pos_handoff_resume(uuid,uuid,text,text) from public,anon;
grant execute on function public.pos_handoff_resume(uuid,uuid,text,text) to authenticated;

-- Cashier-controlled emergency cleanup. This does not undo an already
-- completed payment or delete customer data; it only destroys guest access.

create or replace function public.pos_handoff_status(
 p_checkout uuid,p_shift_id uuid,p_shift_secret text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid();v_status text;
begin
 if v_uid is null or p_shift_secret is null or
    p_shift_secret !~ '^[a-f0-9]{64}$' then
  raise exception 'Checkout authorization denied';
 end if;
 select c.status into v_status
 from public.pos_checkout_handoffs h
 join public.pos_checkouts c on c.id=h.checkout_id
 join public.pos_staff_shifts s on s.id=h.shift_id
 join public.pos_staff_credentials staff on staff.id=s.staff_id
 join public.pos_registers r on r.id=c.register_id and r.owner_id=c.owner_id
 where h.checkout_id=p_checkout and h.shift_id=p_shift_id
   and h.auth_user_id=v_uid and r.active
    and ((c.owner_id=v_uid and public.is_persen_admin())
      or exists (select 1 from public.pos_staff_register_grants g
                 where g.register_id=r.id and g.owner_id=r.owner_id
                   and g.staff_id=s.staff_id and g.active=true))
   and h.phase in ('guest','customer_complete','cashier')
   and s.auth_user_id=v_uid and s.revoked_at is null and s.expires_at>now()
   and staff.enabled=true and staff.auth_user_id=v_uid
    and staff.credential_version=s.credential_version
   and s.secret_digest=extensions.digest(p_shift_secret,'sha256');
 if not found then raise exception 'Checkout authorization denied'; end if;
 return jsonb_build_object('ok',true,'checkoutId',p_checkout,'status',v_status);
end $$;
revoke all on function public.pos_handoff_status(uuid,uuid,text) from public,anon;
grant execute on function public.pos_handoff_status(uuid,uuid,text) to authenticated;

-- The POS retains its explicit cash-recording and Finish Order steps.
-- This RPC proves that those steps actually completed in the database
-- BEFORE the guest token is revoked and the iPad returns home.

create or replace function public.pos_handoff_verify_paid(
 p_checkout uuid,p_shift_id uuid,p_shift_secret text
) returns jsonb
language plpgsql security definer set search_path='' as $$
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
   and sale.owner_id=c.owner_id and sale.payment_method='cash'
   and s.auth_user_id=v_uid and s.revoked_at is null and s.expires_at>now()
   and staff.enabled=true and staff.auth_user_id=v_uid
    and staff.credential_version=s.credential_version
   and s.secret_digest=extensions.digest(p_shift_secret,'sha256');
 return jsonb_build_object('checkoutId',p_checkout,
    'completed',v_saved is not null);
end $$;
revoke all on function public.pos_handoff_verify_paid(uuid,uuid,text) from public,anon;
grant execute on function public.pos_handoff_verify_paid(uuid,uuid,text) to authenticated;

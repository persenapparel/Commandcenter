-- STAGING ONLY. Fix verified badge resume for active, register-scoped employee shifts.
-- Retains same owner/account, shift secret, badge, checkout phase, grant and revocation checks.
-- Does not modify real orders, inventory, credentials, or production database.

CREATE OR REPLACE FUNCTION public.pos_handoff_resume(p_checkout uuid, p_shift_id uuid, p_shift_secret text, p_badge text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 v_proof:=public.pos_staff_resume_shift(p_shift_id,p_shift_secret,p_badge,v_checkout.register_id);
 if coalesce((v_proof->>'ok')::boolean,false) is not true then
  -- Return failure instead of raising; otherwise PostgreSQL rolls back the
  -- nested badge attempt counter and defeats the PIN/badge throttle.
  return jsonb_build_object('verified',false,'error','Checkout authorization denied');
 end if;
 update public.pos_checkout_handoffs
 set phase='cashier',resumed_at=now(),updated_at=now()
 where checkout_id=p_checkout;
 return jsonb_build_object('verified',true,'checkoutId',p_checkout);
end; $function$;

REVOKE ALL ON FUNCTION public.pos_handoff_resume(uuid,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_handoff_resume(uuid,uuid,text,text) TO authenticated;

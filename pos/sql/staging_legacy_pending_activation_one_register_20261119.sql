-- STAGING ONLY. Install after owner UI migrates to the register-aware overload.
-- Forward-only: preserve the original signature but revoke its EXECUTE privilege.
-- Rollback: replace this overload with the reviewed prior definition in a NEW
-- migration, keeping the unsafe three-argument overload non-executable.
CREATE OR REPLACE FUNCTION public.pos_owner_activate_pending_employee_badge(
 p_slot integer, p_owner_badge text, p_owner_pin text, p_register uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare
 v_uid uuid := auth.uid();
 v_pending public.pos_pending_employee_badges%rowtype;
 v_owner public.pos_staff_credentials%rowtype;
 v_user uuid;
 v_staff_id uuid;
 v_fail public.pos_staff_auth_attempts%rowtype;
begin
 if v_uid is null or not public.is_persen_admin()
   or p_slot not in (1,2) or p_register is null
   or length(coalesce(p_owner_badge,'')) not between 8 and 256
   or length(coalesce(p_owner_pin,'')) not between 6 and 128 then
  raise exception 'Owner verification required';
 end if;
 -- Validate the selected register before any credential changes.
 perform 1 from public.pos_registers
 where id=p_register and owner_id=v_uid and active=true
 for update;
 if not found then raise exception 'Active owned register required'; end if;

 insert into public.pos_staff_auth_attempts(auth_user_id)
 values(v_uid) on conflict(auth_user_id) do nothing;
 select * into v_fail from public.pos_staff_auth_attempts
 where auth_user_id=v_uid for update;
 if v_fail.blocked_until>now() then
  return jsonb_build_object('activated',false,'reason','locked');
 end if;
 if v_fail.window_started<now()-interval '15 minutes' then
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
  return jsonb_build_object('activated',false,'reason','owner_auth');
 end if;
 select * into v_pending from public.pos_pending_employee_badges
 where owner_id=v_uid and slot=p_slot for update;
 if not found then raise exception 'Employee badge slot not found'; end if;
 select u.id into v_user from auth.users u
 where lower(u.email)=v_pending.employee_email
  and u.email_confirmed_at is not null and u.id<>v_uid;
 if v_user is null then
  return jsonb_build_object('activated',false,'reason','employee_account_missing');
 end if;
 if exists(select 1 from public.pos_staff_credentials
  where auth_user_id=v_user or badge_digest=v_pending.badge_digest) then
  raise exception 'Employee badge or account already assigned';
 end if;
 insert into public.pos_staff_credentials(
  auth_user_id,first_name,staff_role,badge_digest,pin_hash,enabled,credential_version
 ) values(v_user,v_pending.first_name,'cashier',
  v_pending.badge_digest,v_pending.pin_hash,true,1)
 returning id into v_staff_id;
 -- Exactly one active register, never all registers.
 insert into public.pos_staff_register_grants(
  register_id,staff_id,owner_id,granted_by,active
 ) values(p_register,v_staff_id,v_uid,v_uid,true);
 delete from public.pos_pending_employee_badges
 where owner_id=v_uid and slot=p_slot;
 delete from public.pos_pending_employee_pin_checks
 where owner_id=v_uid and slot=p_slot;
 update public.pos_staff_auth_attempts
 set attempts=0,window_started=now(),blocked_until=null
 where auth_user_id=v_uid;
 return jsonb_build_object('activated',true,'slot',p_slot,
  'role','cashier','firstName',v_pending.first_name);
end;
$function$;

REVOKE ALL ON FUNCTION public.pos_owner_activate_pending_employee_badge(integer,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_owner_activate_pending_employee_badge(integer,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_owner_activate_pending_employee_badge(integer,text,text,uuid) TO authenticated;

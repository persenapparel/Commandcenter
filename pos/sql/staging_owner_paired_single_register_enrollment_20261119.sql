-- STAGING ONLY: deploy after credential-scoped grant RPC and caller update.
-- Forward-only replacement overload; legacy six-argument entry point disabled.
-- Rollback: new forward migration restoring prior six-arg EXECUTE only after
-- ensuring the old all-register grant behavior has been removed. Never restore
-- unsafe broad enrollment grants.
CREATE OR REPLACE FUNCTION public.pos_owner_enroll_badge(p_slot integer, p_first_name text, p_badge text, p_pin text, p_owner_badge text, p_owner_pin text, p_register_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid:=auth.uid();
 v_attempt public.pos_staff_auth_attempts%rowtype;
 v_owner public.pos_staff_credentials%rowtype;
 v_staff uuid;v_count integer;
 v_first text:=btrim(coalesce(p_first_name,''));
 v_badge text:=btrim(coalesce(p_badge,''));
 v_pin text:=coalesce(p_pin,'');
 v_owner_badge text:=btrim(coalesce(p_owner_badge,''));
 v_owner_pin text:=coalesce(p_owner_pin,'');
begin
 if v_uid is null or not public.is_persen_admin() then
  raise exception 'Owner authorization required';
 end if;
 if p_register_id is null or p_slot not in (1,2) or length(v_first) not between 1 and 80
   or v_badge !~ '^[0-9]{8}$'
   or length(v_pin) not between 6 and 128
   or length(v_owner_badge) not between 8 and 256
   or length(v_owner_pin) not between 6 and 128 then
  raise exception 'Missing first name, valid badge, PIN or owner approval';
 end if;
 -- Owner authentication, with the same throttling used for their login.
 insert into public.pos_staff_auth_attempts(auth_user_id)
 values(v_uid) on conflict(auth_user_id) do nothing;
 select * into v_attempt from public.pos_staff_auth_attempts
 where auth_user_id=v_uid for update;
 if v_attempt.blocked_until>now() then
  return jsonb_build_object('saved',false,'reason','locked');
 end if;
 if v_attempt.window_started<now()-interval '15 minutes' then
  update public.pos_staff_auth_attempts
  set attempts=0,window_started=now(),blocked_until=null
  where auth_user_id=v_uid;
 end if;
 select * into v_owner from public.pos_staff_credentials
 where auth_user_id=v_uid and staff_role='owner' and enabled=true
   and badge_digest=extensions.digest(v_owner_badge,'sha256')
   and extensions.crypt(v_owner_pin,pin_hash)=pin_hash
 for update;
 if not found then
  update public.pos_staff_auth_attempts
  set attempts=least(attempts+1,5),
    blocked_until=case when attempts+1>=5 then now()+interval '15 minutes' else null end
  where auth_user_id=v_uid;
  return jsonb_build_object('saved',false,'reason','owner_auth');
 end if;
 if exists(select 1 from public.pos_owner_badge_slots
       where owner_id=v_uid and slot=p_slot) then
  return jsonb_build_object('saved',false,'reason','slot_taken');
 end if;
 if exists(select 1 from public.pos_staff_credentials
      where badge_digest=extensions.digest(v_badge,'sha256'))
    or exists(select 1 from public.pos_pending_employee_badges
      where badge_digest=extensions.digest(v_badge,'sha256')) then
  return jsonb_build_object('saved',false,'reason','badge_taken');
 end if;
 select count(*) into v_count from public.pos_registers
 where owner_id=v_uid and active=true and id=p_register_id;
 if v_count=0 then raise exception 'No active staging register'; end if;
 insert into public.pos_staff_credentials
   (auth_user_id,first_name,staff_role,badge_digest,pin_hash,enabled,credential_version)
 values (v_uid,v_first,'cashier',
   extensions.digest(v_badge,'sha256'),
   extensions.crypt(v_pin,extensions.gen_salt('bf',12)),true,1)
 returning id into v_staff;
 insert into public.pos_staff_register_grants
   (register_id,staff_id,owner_id,granted_by,active)
 select id,v_staff,v_uid,v_uid,true from public.pos_registers
 where owner_id=v_uid and active=true and id=p_register_id;
 insert into public.pos_owner_badge_slots(owner_id,slot,staff_id)
 values(v_uid,p_slot,v_staff);
 update public.pos_staff_auth_attempts
 set attempts=0,window_started=now(),blocked_until=null
 where auth_user_id=v_uid;
 return jsonb_build_object('saved',true,'activated',true,
    'slot',p_slot,'firstName',v_first,'requiresEmployeeEmail',false,
    'mode','supervised-owner-paired-kiosk');
exception when unique_violation then
 return jsonb_build_object('saved',false,'reason','enrollment_conflict');
end;
$function$

REVOKE ALL ON FUNCTION public.pos_owner_enroll_badge(integer,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_owner_enroll_badge(integer,text,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_owner_enroll_badge(integer,text,text,text,text,text,uuid) TO authenticated;

-- STAGING ONLY: accept existing 8-digit staff badge identifiers.
-- The badge is not standalone authentication. Preserve the authenticated account,
-- PIN hash and verification, rate limits, scoped register grants and revocation.
-- Production is untouched; this migration does not create credentials or sales.

CREATE OR REPLACE FUNCTION public.pos_owner_enroll_staff_self(p_badge text, p_pin text, p_first_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_uid uuid:=auth.uid();
 v_badge text:=btrim(coalesce(p_badge,''));
 v_pin text:=coalesce(p_pin,'');
 v_name text:=btrim(coalesce(p_first_name,''));
 v_staff_id uuid;
begin
 if v_uid is null or not public.is_persen_admin() then
  raise exception 'Owner authorization required';
 end if;
 if length(v_badge) not between 8 and 256
    or length(v_pin) not between 6 and 128
    or length(v_name) not between 1 and 80 then
  raise exception 'Invalid owner badge setup';
 end if;
 -- Enroll only an owner who has an active staging register. This is not an
 -- employee invitation or a general-purpose account provisioning RPC.
 if not exists(select 1 from public.pos_registers
   where owner_id=v_uid and active=true) then
  raise exception 'Active register required';
 end if;
 insert into public.pos_staff_credentials(
  auth_user_id,first_name,staff_role,badge_digest,pin_hash,enabled,credential_version
 ) values(
  v_uid,v_name,'owner',extensions.digest(v_badge,'sha256'),
  extensions.crypt(v_pin,extensions.gen_salt('bf',12)),true,1
 )
 on conflict(auth_user_id) do update set
  first_name=excluded.first_name,
  staff_role='owner',
  badge_digest=excluded.badge_digest,
  pin_hash=excluded.pin_hash,
  enabled=true,
  credential_version=public.pos_staff_credentials.credential_version+1
 returning id into v_staff_id;
 -- A badge for the signed-in owner receives only that owner's active
 -- register grant; it never grants another employee or a different owner.
 insert into public.pos_staff_register_grants(
  register_id,staff_id,owner_id,granted_by,active
 )
 select r.id,v_staff_id,v_uid,v_uid,true
 from public.pos_registers r
 where r.owner_id=v_uid and r.active=true
 on conflict(register_id,staff_id) do update
 set active=true,granted_by=excluded.granted_by
 where public.pos_staff_register_grants.owner_id=excluded.owner_id
   and public.pos_staff_register_grants.staff_id=excluded.staff_id;
 -- Rotating credentials also burns any outstanding checkout capabilities.
 update public.pos_checkout_handoffs h
 set phase='closed',capability_digest=null,capability_expires_at=null,
     closed_at=now(),updated_at=now()
 where h.shift_id in(select id from public.pos_staff_shifts where staff_id=v_staff_id)
   and h.phase<>'closed';
 update public.pos_staff_shifts
 set revoked_at=now()
 where staff_id=v_staff_id and revoked_at is null;
 insert into public.pos_staff_auth_attempts(auth_user_id,attempts,window_started,blocked_until)
 values(v_uid,0,now(),null)
 on conflict(auth_user_id) do update
 set attempts=0,window_started=now(),blocked_until=null;
 return jsonb_build_object('enrolled',true,'firstName',v_name,'role','owner');
exception when unique_violation then
 raise exception 'Badge unavailable';
end;
$function$;


CREATE OR REPLACE FUNCTION public.pos_staff_resume_shift(p_shift_id uuid, p_shift_secret text, p_badge text, p_register uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_uid uuid := auth.uid();
 v_staff public.pos_staff_credentials%rowtype;
 v_attempt public.pos_staff_auth_attempts%rowtype;
begin
 if v_uid is null then
  return jsonb_build_object('ok',false,'error','Invalid employee credentials');
 end if;
 insert into public.pos_staff_auth_attempts(auth_user_id)
 values(v_uid) on conflict(auth_user_id) do nothing;
 select * into v_attempt from public.pos_staff_auth_attempts
 where auth_user_id=v_uid for update;
 if v_attempt.blocked_until > now() then
  return jsonb_build_object('ok',false,'error','Invalid employee credentials');
 end if;
 if v_attempt.window_started < now()-interval '15 minutes' then
  update public.pos_staff_auth_attempts
  set attempts=0,window_started=now(),blocked_until=null
  where auth_user_id=v_uid;
 end if;
 -- Reject invalid sizes before hashing untrusted badge or shift secrets.
 if p_register is null or p_shift_secret is null or length(p_shift_secret) <> 64
    or p_badge is null or length(p_badge) not between 8 and 256 then
  update public.pos_staff_auth_attempts
  set attempts=attempts+1,
      blocked_until=case when attempts+1>=5 then now()+interval '15 minutes' else null end
  where auth_user_id=v_uid;
  return jsonb_build_object('ok',false,'error','Invalid employee credentials');
 end if;
 select c.* into v_staff
 from public.pos_staff_shifts s
 join public.pos_staff_credentials c on c.id=s.staff_id
 where s.id=p_shift_id and s.auth_user_id=v_uid
 and s.revoked_at is null and s.expires_at>now()
 and c.enabled=true and c.credential_version=s.credential_version
 and s.secret_digest=extensions.digest(coalesce(p_shift_secret,''),'sha256')
 and c.badge_digest=extensions.digest(coalesce(p_badge,''),'sha256')
 -- A badge alone cannot restore a register after its staff grant is revoked.
 -- Owner/admin bypass matches the existing server-side checkout grant policy.
 and exists (
  select 1 from public.pos_registers r
  where r.id=p_register and r.active=true
  and (
   (c.staff_role='owner' and r.owner_id=v_uid and public.is_persen_admin())
   or exists (
    select 1 from public.pos_staff_register_grants g
    where g.register_id=r.id and g.staff_id=c.id and g.active=true
      and g.owner_id=r.owner_id
   )
  )
 )
 -- Serialize successful resume against concurrent shift revocation and
 -- credential disable/rotation. No guest checkout authorization is implied.
 for update of s,c;
 if not found or p_register is null or p_shift_secret is null or length(p_shift_secret) <> 64
    or p_badge is null or length(p_badge) not between 8 and 256 then
  -- Do not RAISE here: an exception would roll back the throttle update.
  update public.pos_staff_auth_attempts
  set attempts=attempts+1,
      blocked_until=case when attempts+1>=5 then now()+interval '15 minutes' else null end
  where auth_user_id=v_uid;
  return jsonb_build_object('ok',false,'error','Invalid employee credentials');
 end if;
 -- A successful badge-only resume must not erase failed PIN attempts.
 -- Otherwise an existing shift could reset the PIN brute-force counter.
 return jsonb_build_object('ok',true,'staff_id',v_staff.id,
  'first_name',v_staff.first_name,'role',v_staff.staff_role);
end;
$function$;


CREATE OR REPLACE FUNCTION public.pos_staff_start_shift(p_badge text, p_pin text, p_register uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_uid uuid := auth.uid();
 v_attempt public.pos_staff_auth_attempts%rowtype;
 v_staff public.pos_staff_credentials%rowtype;
 v_secret text;
 v_expiry timestamptz := now() + interval '8 hours';
begin
 if v_uid is null then raise exception 'Authentication required' using errcode='28000'; end if;
 insert into public.pos_staff_auth_attempts(auth_user_id)
 values(v_uid) on conflict(auth_user_id) do nothing;
 select * into v_attempt from public.pos_staff_auth_attempts
 where auth_user_id=v_uid for update;
 if v_attempt.blocked_until > now() then
  return jsonb_build_object('ok',false,'error','Invalid employee credentials');
 end if;
 if v_attempt.window_started < now()-interval '15 minutes' then
  update public.pos_staff_auth_attempts set attempts=0,window_started=now(),blocked_until=null
  where auth_user_id=v_uid;
  v_attempt.attempts:=0;
 end if;
 -- Reject invalid sizes before digest/crypt to bound credential processing cost.
 if p_register is null or p_badge is null or length(p_badge) not between 8 and 256
    or p_pin is null or length(p_pin) not between 4 and 128 then
  update public.pos_staff_auth_attempts
  set attempts=attempts+1,
      blocked_until=case when attempts+1>=5 then now()+interval '15 minutes' else null end
  where auth_user_id=v_uid;
  return jsonb_build_object('ok',false,'error','Invalid employee credentials');
 end if;
 select c.* into v_staff from public.pos_staff_credentials c
 where c.auth_user_id=v_uid and c.badge_digest=extensions.digest(p_badge,'sha256')
 and c.enabled=true
 and exists (
  select 1 from public.pos_registers r
  where r.id=p_register and r.active=true
  and (
   (c.staff_role='owner' and r.owner_id=v_uid and public.is_persen_admin())
   or exists (
    select 1 from public.pos_staff_register_grants g
    where g.register_id=r.id and g.owner_id=r.owner_id
      and g.staff_id=c.id and g.active=true
   )
  )
 );
 if not found or p_register is null or p_badge is null or length(p_badge) not between 8 and 256
    or p_pin is null or length(p_pin) not between 4 and 128 or
    v_staff.pin_hash is null or
    extensions.crypt(p_pin,v_staff.pin_hash) is distinct from v_staff.pin_hash then
  update public.pos_staff_auth_attempts
  set attempts=attempts+1,
      blocked_until=case when attempts+1>=5 then now()+interval '15 minutes' else null end
  where auth_user_id=v_uid;
  return jsonb_build_object('ok',false,'error','Invalid employee credentials');
 end if;
 update public.pos_staff_auth_attempts set attempts=0,blocked_until=null
 where auth_user_id=v_uid;
 -- A new successful PIN authentication rotates prior shifts for this employee.
 -- This prevents an older stolen shift token from remaining valid after re-login.
 update public.pos_staff_shifts
 set revoked_at=now()
 where staff_id=v_staff.id and revoked_at is null;
 v_secret:=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.pos_staff_shifts(staff_id,auth_user_id,secret_digest,credential_version,expires_at)
 values(v_staff.id,v_uid,extensions.digest(v_secret,'sha256'),v_staff.credential_version,v_expiry);
 return jsonb_build_object('ok',true,'shift_id',(select id from public.pos_staff_shifts
  where secret_digest=extensions.digest(v_secret,'sha256')),
  'shift_secret',v_secret,'first_name',v_staff.first_name,
  'role',v_staff.staff_role,'expires_at',v_expiry);
end;
$function$;


REVOKE ALL ON FUNCTION public.pos_owner_enroll_staff_self(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_owner_enroll_staff_self(text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.pos_staff_start_shift(text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_staff_start_shift(text,text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.pos_staff_resume_shift(uuid,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_staff_resume_shift(uuid,text,text,uuid) TO authenticated;

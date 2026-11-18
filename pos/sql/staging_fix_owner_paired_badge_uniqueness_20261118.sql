-- Isolated Persen POS staging fix: old one-staff-per-auth-user index
-- caused legitimate owner-paired cashier badges to fail as 'badge taken'.
-- Allow one OWNER identity per account plus separately scanned cashier IDs.
-- Uniqueness of each barcode itself is preserved (badge_digest UNIQUE).
-- Do NOT merge into production until role-scoped kiosk authentication review.
drop index if exists public.pos_staff_credentials_user_unique;
create unique index if not exists pos_staff_credentials_owner_auth_unique
  on public.pos_staff_credentials(auth_user_id) where staff_role='owner';

-- The owner self-enrollment UPSERT must target the OWNER-only partial index;
-- otherwise employee rows could be incorrectly changed into owners.
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
 on conflict(auth_user_id) where staff_role='owner' do update set
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
$function$
;
-- Multiple cashiers may share the supervised kiosk owner session. A badge
-- lookup must include the supplied UNIQUE badge_digest, never an arbitrary
-- 'first cashier for this auth user'.
CREATE OR REPLACE FUNCTION public.pos_staff_test_badge_pin(p_badge text, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid:=auth.uid();v_staff public.pos_staff_credentials%rowtype;
 v_auth public.pos_staff_auth_attempts%rowtype;v_success boolean:=false;
begin
 if v_uid is null then
  return jsonb_build_object('verified',false);
 end if;
 insert into public.pos_staff_auth_attempts(auth_user_id)
 values(v_uid) on conflict(auth_user_id) do nothing;
 select * into v_auth from public.pos_staff_auth_attempts
 where auth_user_id=v_uid for update;
 if v_auth.blocked_until>now() then
  return jsonb_build_object('verified',false,'locked',true);
 end if;
 if v_auth.window_started<now()-interval '15 minutes' then
  update public.pos_staff_auth_attempts set attempts=0,window_started=now(),
   blocked_until=null where auth_user_id=v_uid;
 end if;
 select * into v_staff from public.pos_staff_credentials
 where auth_user_id=v_uid and enabled=true and staff_role='cashier'
  and p_badge is not null and length(p_badge) between 8 and 256
  and badge_digest=extensions.digest(p_badge,'sha256')
  and exists(select 1 from public.pos_staff_register_grants g
    join public.pos_registers r on r.id=g.register_id
    where g.staff_id=public.pos_staff_credentials.id
     and g.owner_id=r.owner_id and g.active and r.active)
 for update;
 if found and p_badge is not null and length(p_badge) between 8 and 256
   and p_pin is not null and length(p_pin) between 6 and 128 then
  v_success:=v_staff.badge_digest=extensions.digest(p_badge,'sha256')
    and extensions.crypt(p_pin,v_staff.pin_hash)=v_staff.pin_hash;
 end if;
 if not v_success then
  update public.pos_staff_auth_attempts set attempts=least(attempts+1,5),
    blocked_until=case when attempts+1>=5 then now()+interval '15 minutes' else null end
  where auth_user_id=v_uid;
  return jsonb_build_object('verified',false);
 end if;
 update public.pos_staff_auth_attempts
 set attempts=0,window_started=now(),blocked_until=null
 where auth_user_id=v_uid;
 return jsonb_build_object('verified',true,'role','cashier',
  'firstName',v_staff.first_name,'salesEnabled',false);
end;
$function$
;
-- Old API identifies staff by auth user, which becomes ambiguous for a
-- paired kiosk; reject rather than granting/revoking the wrong employee.
CREATE OR REPLACE FUNCTION public.pos_staff_set_register_access(p_register uuid, p_staff_user uuid, p_allowed boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid:=auth.uid(); v_reg public.pos_registers%rowtype;
 v_staff public.pos_staff_credentials%rowtype;
begin
 if v_owner is null or not public.is_persen_admin() or p_allowed is null
 then raise exception 'Unauthorized'; end if;
 select * into v_reg from public.pos_registers
 where id=p_register and owner_id=v_owner and active for update;
 if not found then raise exception 'Register unavailable'; end if;
 select * into v_staff from public.pos_staff_credentials
 where auth_user_id=p_staff_user and enabled=true
   and (select count(*) from public.pos_staff_credentials
        where auth_user_id=p_staff_user and enabled=true)=1
 for update;
 if not found then raise exception 'Employee unavailable'; end if;
 insert into public.pos_staff_register_grants(
  register_id,staff_id,owner_id,granted_by,active
 ) values(v_reg.id,v_staff.id,v_reg.owner_id,v_owner,p_allowed)
 on conflict(register_id,staff_id) do update
 set active=excluded.active,granted_by=excluded.granted_by;
 if not p_allowed then
  -- Revoking register permission also invalidates outstanding guest access
  -- for this employee on this register. A cashier may not regain access
  -- simply because a previously issued capability has not timed out.
  update public.pos_checkout_handoffs h
  set phase='closed',capability_digest=null,capability_expires_at=null,
      closed_at=now(),updated_at=now()
  where h.register_id=v_reg.id and h.phase<>'closed'
    and h.shift_id in (select id from public.pos_staff_shifts
                      where staff_id=v_staff.id);
 end if;
 return true;
end $function$
;
-- A future DB uniqueness error must not be falsely labelled as a reused
-- badge or PIN. Actual badge duplicates are detected separately before INSERT.
CREATE OR REPLACE FUNCTION public.pos_owner_enroll_badge(p_slot integer, p_first_name text, p_badge text, p_pin text, p_owner_badge text, p_owner_pin text)
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
 if p_slot not in (1,2) or length(v_first) not between 1 and 80
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
 where owner_id=v_uid and active=true;
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
 where owner_id=v_uid and active=true;
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
;

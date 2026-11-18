-- Persen Apparel POS staging — independent employee badges/PIN tests.
-- Never grants owner access or attaches staff to the owner's auth session.
create table if not exists public.pos_pending_employee_pin_checks (
 owner_id uuid not null references auth.users(id) on delete cascade,
 slot integer not null check(slot in (1,2)),
 attempts integer not null default 0 check(attempts between 0 and 5),
 window_started timestamptz not null default now(),
 blocked_until timestamptz,
 primary key(owner_id,slot)
);
alter table public.pos_pending_employee_pin_checks enable row level security;
revoke all on public.pos_pending_employee_pin_checks from public,anon,authenticated;

-- Lets owner hand the device to each employee to try *their* badge/PIN
-- while the badge is still pending activation. Never starts a shift.
create or replace function public.pos_owner_test_pending_employee_badge(
 p_slot integer,p_badge text,p_pin text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid();v_pending public.pos_pending_employee_badges%rowtype;
 v_attempt public.pos_pending_employee_pin_checks%rowtype;v_ok boolean:=false;
begin
 if v_uid is null or not public.is_persen_admin()
   or p_slot not in (1,2) then
  raise exception 'Owner authorization required';
 end if;
 insert into public.pos_pending_employee_pin_checks(owner_id,slot)
 values(v_uid,p_slot) on conflict(owner_id,slot) do nothing;
 select * into v_attempt from public.pos_pending_employee_pin_checks
 where owner_id=v_uid and slot=p_slot for update;
 if v_attempt.blocked_until>now() then
  return jsonb_build_object('verified',false,'locked',true);
 end if;
 if v_attempt.window_started<now()-interval '15 minutes' then
  update public.pos_pending_employee_pin_checks
  set attempts=0,window_started=now(),blocked_until=null
  where owner_id=v_uid and slot=p_slot;
 end if;
 select * into v_pending from public.pos_pending_employee_badges
 where owner_id=v_uid and slot=p_slot;
 if found and p_badge is not null and p_badge ~ '^[0-9]{8}$'
    and p_pin is not null and length(p_pin) between 6 and 128 then
  v_ok:=v_pending.badge_digest=extensions.digest(p_badge,'sha256')
    and extensions.crypt(p_pin,v_pending.pin_hash)=v_pending.pin_hash;
 end if;
 if not v_ok then
  update public.pos_pending_employee_pin_checks
  set attempts=least(attempts+1,5),
    blocked_until=case when attempts+1>=5 then now()+interval '15 minutes' else null end
  where owner_id=v_uid and slot=p_slot;
  return jsonb_build_object('verified',false,'locked',false);
 end if;
 update public.pos_pending_employee_pin_checks
 set attempts=0,window_started=now(),blocked_until=null
 where owner_id=v_uid and slot=p_slot;
 return jsonb_build_object('verified',true,'activated',false,'slot',p_slot);
end;
$$;
revoke all on function public.pos_owner_test_pending_employee_badge(integer,text,text)
 from public,anon,authenticated;
grant execute on function public.pos_owner_test_pending_employee_badge(integer,text,text)
 to authenticated;

-- The pending badge can activate ONLY if employee owns a *different*,
-- email-confirmed staging auth account. Owner's private badge+PIN required.
create or replace function public.pos_owner_activate_pending_employee_badge(
 p_slot integer,p_owner_badge text,p_owner_pin text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid();v_pending public.pos_pending_employee_badges%rowtype;
 v_owner public.pos_staff_credentials%rowtype;v_user uuid;v_staff_id uuid;
 v_fail public.pos_staff_auth_attempts%rowtype;v_affected integer;
begin
 if v_uid is null or not public.is_persen_admin()
   or p_slot not in (1,2) or
   length(coalesce(p_owner_badge,'')) not between 8 and 256 or
   length(coalesce(p_owner_pin,'')) not between 6 and 128 then
  raise exception 'Owner verification required';
 end if;
 insert into public.pos_staff_auth_attempts(auth_user_id)
 values(v_uid) on conflict(auth_user_id) do nothing;
 select * into v_fail from public.pos_staff_auth_attempts
 where auth_user_id=v_uid for update;
 if v_fail.blocked_until>now() then
  raise exception 'Owner verification temporarily unavailable';
 end if;
 if v_fail.window_started<now()-interval '15 minutes' then
  update public.pos_staff_auth_attempts set
   attempts=0,window_started=now(),blocked_until=null
  where auth_user_id=v_uid;
 end if;
 select * into v_owner from public.pos_staff_credentials
 where auth_user_id=v_uid and staff_role='owner' and enabled=true
  and badge_digest=extensions.digest(btrim(p_owner_badge),'sha256')
  and extensions.crypt(p_owner_pin,pin_hash)=pin_hash
 for update;
 if not found then
  update public.pos_staff_auth_attempts set attempts=attempts+1,
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
 insert into public.pos_staff_register_grants(
   register_id,staff_id,owner_id,granted_by,active)
 select id,v_staff_id,v_uid,v_uid,true from public.pos_registers
 where owner_id=v_uid and active=true;
 get diagnostics v_affected=row_count;
 if v_affected<1 then raise exception 'Active staging register required'; end if;
 delete from public.pos_pending_employee_badges
 where owner_id=v_uid and slot=p_slot;
 delete from public.pos_pending_employee_pin_checks
 where owner_id=v_uid and slot=p_slot;
 update public.pos_staff_auth_attempts set
   attempts=0,window_started=now(),blocked_until=null where auth_user_id=v_uid;
 return jsonb_build_object('activated',true,'slot',p_slot,
  'role','cashier','firstName',v_pending.first_name);
end;
$$;
revoke all on function public.pos_owner_activate_pending_employee_badge(integer,text,text)
 from public,anon,authenticated;
grant execute on function public.pos_owner_activate_pending_employee_badge(integer,text,text)
 to authenticated;

-- Employees test their credentials with their *own* staging auth JWT.
-- A passed test never creates a sale or grants owner dashboard access.
create or replace function public.pos_staff_test_badge_pin(
 p_badge text,p_pin text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
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
$$;
revoke all on function public.pos_staff_test_badge_pin(text,text)
 from public,anon,authenticated;
grant execute on function public.pos_staff_test_badge_pin(text,text)
 to authenticated;

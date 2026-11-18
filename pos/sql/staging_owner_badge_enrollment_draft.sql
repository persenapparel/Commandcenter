-- STAGING ONLY. Never apply to production without independent review.
-- Lets the already authenticated Persen POS owner enroll or rotate only their
-- own badge/PIN. It never accepts a client-selected role or grants table access.

create or replace function public.pos_owner_enroll_staff_self(
 p_badge text,p_pin text,p_first_name text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
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
$$;
revoke all on function public.pos_owner_enroll_staff_self(text,text,text)
 from public,anon;
grant execute on function public.pos_owner_enroll_staff_self(text,text,text)
 to authenticated;

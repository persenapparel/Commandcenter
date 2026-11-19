-- STAGING ONLY; after staging_owner_grant_revocation_credential_version_20261119.sql.
-- Make repeated deny idempotent while retaining live-shift invalidation.
-- Rollback via a new forward migration restoring the reviewed #221 function;
-- never decrement credential_version.
create or replace function public.pos_owner_set_badge_register_access(
 p_register uuid, p_staff_id uuid, p_allowed boolean
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare
 v_owner uuid := auth.uid();
 v_staff public.pos_staff_credentials%rowtype;
 v_rows integer;
 v_was_active boolean := false;
 v_has_live_shift boolean := false;
begin
 if v_owner is null or not public.is_persen_admin()
    or p_register is null or p_staff_id is null or p_allowed is null then
  raise exception 'Unauthorized';
 end if;
 perform 1 from public.pos_registers
 where id=p_register and owner_id=v_owner and active=true for update;
 if not found then raise exception 'Register unavailable'; end if;
 select * into v_staff from public.pos_staff_credentials
 where id=p_staff_id and staff_role='cashier' and enabled=true
 for update;
 if not found then raise exception 'Employee unavailable'; end if;
 if not (
   (v_staff.auth_user_id=v_owner and exists (
      select 1 from public.pos_owner_badge_slots s
      where s.owner_id=v_owner and s.staff_id=v_staff.id
   ))
   or exists (
      select 1 from public.pos_staff_register_grants g
      join public.pos_registers r on r.id=g.register_id
      where g.staff_id=v_staff.id and g.owner_id=v_owner
        and r.owner_id=v_owner
   )
 ) then
  raise exception 'Employee unavailable';
 end if;
 -- Lock the existing grant before deciding whether revocation is a transition.
 -- The credential row lock above serializes concurrent owner operations.
 select coalesce(g.active,false) into v_was_active
 from public.pos_staff_register_grants g
 where g.register_id=p_register and g.staff_id=v_staff.id
 for update;
 v_was_active := coalesce(v_was_active,false);
 select exists(select 1 from public.pos_staff_shifts s
               where s.staff_id=v_staff.id and s.revoked_at is null)
 into v_has_live_shift;
 insert into public.pos_staff_register_grants(
  register_id,staff_id,owner_id,granted_by,active
 ) values(p_register,v_staff.id,v_owner,v_owner,p_allowed)
 on conflict(register_id,staff_id) do update
 set active=excluded.active,granted_by=excluded.granted_by
 where public.pos_staff_register_grants.owner_id=excluded.owner_id;
 get diagnostics v_rows = row_count;
 if v_rows <> 1 then
  raise exception 'Register grant ownership mismatch';
 end if;
 if not p_allowed then
  -- Version bump is transactional with the grant change and invalidates
  -- any outstanding shift token, including concurrent resume attempts.
  -- Repeated denial without an active grant or live shift is idempotent;
  -- a live shift is always invalidated, even if the grant was already denied.
  if v_was_active or v_has_live_shift then
   update public.pos_staff_credentials
   set credential_version=credential_version+1
   where id=v_staff.id;
  end if;
  update public.pos_staff_shifts
  set revoked_at=now()
  where staff_id=v_staff.id and revoked_at is null;
  update public.pos_checkout_handoffs h
  set phase='closed',capability_digest=null,capability_expires_at=null,
      closed_at=now(),updated_at=now()
  where h.phase<>'closed' and exists (
    select 1 from public.pos_staff_shifts s
    where s.id=h.shift_id and s.staff_id=v_staff.id
      and s.revoked_at is not null
  );
 end if;
 return true;
end;
$$;
revoke all on function public.pos_owner_set_badge_register_access(uuid,uuid,boolean)
 from public,anon,authenticated;
grant execute on function public.pos_owner_set_badge_register_access(uuid,uuid,boolean)
 to authenticated;

-- STAGING ONLY; stacked after staging_credential_scoped_register_access_20261119.sql.
-- Credential-level revocation must invalidate existing shift secrets as well as
-- guest capabilities. pos_staff_shifts has no register_id: revoke all shifts
-- for this credential (fail closed), not shifts belonging to other employees.
-- Rollback: REVOKE EXECUTE on this function; restore the previous function
-- definition from the immediately preceding reviewed migration in a NEW migration.
-- Do not restore legacy user-ID-based register grants.
create or replace function public.pos_owner_set_badge_register_access(
 p_register uuid, p_staff_id uuid, p_allowed boolean
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare
 v_owner uuid := auth.uid();
 v_reg public.pos_registers%rowtype;
 v_staff public.pos_staff_credentials%rowtype;
begin
 if v_owner is null or not public.is_persen_admin() or p_allowed is null
    or p_staff_id is null or p_register is null then
  raise exception 'Unauthorized';
 end if;
 select * into v_reg from public.pos_registers
 where id=p_register and owner_id=v_owner and active=true for update;
 if not found then raise exception 'Register unavailable'; end if;
 select * into v_staff from public.pos_staff_credentials
 where id=p_staff_id and auth_user_id=v_owner
   and staff_role='cashier' and enabled=true for update;
 if not found then raise exception 'Employee unavailable'; end if;
 insert into public.pos_staff_register_grants(
  register_id,staff_id,owner_id,granted_by,active
 ) values(v_reg.id,v_staff.id,v_owner,v_owner,p_allowed)
 on conflict(register_id,staff_id) do update
 set active=excluded.active,granted_by=excluded.granted_by;
 if not p_allowed then
  -- Revoke before closing handoffs; a resumed shift must not remain valid.
  update public.pos_staff_shifts s
  set revoked_at=now()
  where s.staff_id=v_staff.id and s.revoked_at is null;
  update public.pos_checkout_handoffs h
  set phase='closed',capability_digest=null,capability_expires_at=null,
      closed_at=now(),updated_at=now()
  where h.register_id=v_reg.id and h.phase<>'closed'
    and h.shift_id in (select s.id from public.pos_staff_shifts s
                       where s.staff_id=v_staff.id);
 end if;
 return true;
end;
$$;
revoke all on function public.pos_owner_set_badge_register_access(uuid,uuid,boolean)
 from public,anon,authenticated;
grant execute on function public.pos_owner_set_badge_register_access(uuid,uuid,boolean)
 to authenticated;

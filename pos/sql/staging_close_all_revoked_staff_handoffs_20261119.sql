-- STAGING ONLY. Stack after #187/#193; do not apply to production.
-- A staff shift has no register_id. Revoking a credential invalidates ALL of
-- its shifts, so guest capabilities for ALL those shifts must close as well,
-- not just capabilities on the register whose grant was revoked.
-- Rollback: restore the reviewed #187 function definition in a NEW migration;
-- do not re-enable the legacy user-ID grant RPC.
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
  update public.pos_staff_shifts s
  set revoked_at=now()
  where s.staff_id=v_staff.id and s.revoked_at is null;
  -- Every handoff belonging to this credential's now-revoked shifts is
  -- invalid, including a capability created on another owned register.
  update public.pos_checkout_handoffs h
  set phase='closed',capability_digest=null,capability_expires_at=null,
      closed_at=now(),updated_at=now()
  where h.phase<>'closed'
    and exists (
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

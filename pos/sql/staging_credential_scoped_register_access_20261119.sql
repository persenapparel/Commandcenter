-- STAGING ONLY. Forward migration; do not edit previously installed SQL.
-- Prerequisite: deploy credential-ID caller before revoking legacy user-ID access.
-- Rollback: REVOKE new function from authenticated; restore EXECUTE to legacy
-- ONLY after reviewing its ambiguous owner-paired behavior (not recommended).
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
 -- The credential primary key is unambiguous even when owner and cashier
 -- badges intentionally share an authenticated kiosk session.
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
  -- End active shifts for this credential/register, preventing a previously
  -- issued shift token from authorizing another checkout after revocation.
  -- Preserve audit rows and close guest capabilities before returning.
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
-- The old user-ID API is unsafe for shared owner/cashier auth identities.
-- Do not apply this final revocation until every caller uses the new API.
revoke all on function public.pos_staff_set_register_access(uuid,uuid,boolean)
 from public,anon,authenticated;

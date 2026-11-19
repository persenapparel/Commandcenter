-- STAGING ONLY. Stack after credential-scoped grant and revocation migrations (#183/#187).
-- Owner-facing read companion: returns credential IDs, never auth user IDs, badges,
-- PIN hashes, register secrets, or guest capabilities.
-- Rollback (new migration): REVOKE EXECUTE on this exact function; DROP FUNCTION
-- after callers have stopped using it. No data changes are made by this migration.
create or replace function public.pos_owner_list_badge_register_access(p_register uuid)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
 v_owner uuid := auth.uid();
 v_result jsonb;
begin
 if v_owner is null or not public.is_persen_admin() or p_register is null then
  raise exception 'Unauthorized';
 end if;
 if not exists (
  select 1 from public.pos_registers r
  where r.id=p_register and r.owner_id=v_owner and r.active=true
 ) then
  raise exception 'Register unavailable';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
    'slot',slots.slot,
    'staffId',staff.id,
    'firstName',staff.first_name,
    'enabled',staff.enabled,
    'registerAllowed',coalesce(grants.active,false)
  ) order by slots.slot),'[]'::jsonb)
 into v_result
 from public.pos_owner_badge_slots slots
 join public.pos_staff_credentials staff
   on staff.id=slots.staff_id and staff.auth_user_id=v_owner
   and staff.staff_role='cashier'
 left join public.pos_staff_register_grants grants
   on grants.register_id=p_register and grants.staff_id=staff.id
   and grants.owner_id=v_owner
 where slots.owner_id=v_owner;
 return v_result;
end;
$$;
revoke all on function public.pos_owner_list_badge_register_access(uuid)
 from public,anon,authenticated;
grant execute on function public.pos_owner_list_badge_register_access(uuid)
 to authenticated;

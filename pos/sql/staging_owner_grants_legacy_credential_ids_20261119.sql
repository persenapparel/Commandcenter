-- STAGING ONLY; after #210. Reconcile owner-paired and separately authenticated
-- pending-badge employees without identifying staff by ambiguous auth_user_id.
-- The latter may be managed only if an existing grant proves this owner's
-- relationship to that exact credential. Never adopt an arbitrary staff UUID.
-- Rollback: in a NEW migration restore the reviewed #204 setter and #193
-- listing definitions; retain the legacy auth-user-ID RPC revocation.
create or replace function public.pos_owner_set_badge_register_access(
 p_register uuid, p_staff_id uuid, p_allowed boolean
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare
 v_owner uuid := auth.uid();
 v_staff public.pos_staff_credentials%rowtype;
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
 insert into public.pos_staff_register_grants(
  register_id,staff_id,owner_id,granted_by,active
 ) values(p_register,v_staff.id,v_owner,v_owner,p_allowed)
 on conflict(register_id,staff_id) do update
 set active=excluded.active,granted_by=excluded.granted_by;
 if not p_allowed then
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

-- Include legacy separately authenticated staff, which have grants but
-- are not represented in pos_owner_badge_slots.
create or replace function public.pos_owner_list_badge_register_access(
 p_register uuid
) returns jsonb
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
 ) then raise exception 'Register unavailable'; end if;
 with eligible as (
  select s.staff_id, s.slot
  from public.pos_owner_badge_slots s
  join public.pos_staff_credentials c on c.id=s.staff_id
  where s.owner_id=v_owner and c.auth_user_id=v_owner
    and c.staff_role='cashier'
  union
  select g.staff_id, null::integer as slot
  from public.pos_staff_register_grants g
  join public.pos_registers r on r.id=g.register_id
  join public.pos_staff_credentials c on c.id=g.staff_id
  where g.owner_id=v_owner and r.owner_id=v_owner
    and c.staff_role='cashier'
 ), unique_staff as (
  select staff_id,min(slot) slot from eligible group by staff_id
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'slot',e.slot,'staffId',c.id,'firstName',c.first_name,
  'enabled',c.enabled,'registerAllowed',coalesce(g.active,false)
 ) order by e.slot nulls last,c.first_name,c.id),'[]'::jsonb)
 into v_result
 from unique_staff e
 join public.pos_staff_credentials c on c.id=e.staff_id
 left join public.pos_staff_register_grants g
 on g.register_id=p_register and g.staff_id=c.id and g.owner_id=v_owner;
 return v_result;
end;
$$;
revoke all on function public.pos_owner_list_badge_register_access(uuid)
 from public,anon,authenticated;
grant execute on function public.pos_owner_list_badge_register_access(uuid)
 to authenticated;

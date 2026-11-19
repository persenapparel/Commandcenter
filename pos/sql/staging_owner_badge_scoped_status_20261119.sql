-- Staging-only source. Apply only after independent security review, alongside
-- the reviewed register-scoped enrollment and credential-scoped grant RPCs.
-- Provides an authenticated owner with the unambiguous credential UUID and
-- current permission for ONE owned active register, never badge or PIN hashes.
-- The six-argument owner enroll RPC must be revoked before cashier enrollment.
create or replace function public.pos_owner_badge_slot_status(
 p_slot integer,p_register uuid
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
 v_owner uuid:=auth.uid();
 v_staff public.pos_staff_credentials%rowtype;
 v_allowed boolean:=false;
begin
 if v_owner is null or not public.is_persen_admin() or p_slot not in (1,2)
   or p_register is null then
  raise exception 'Owner authorization required';
 end if;
 if not exists (select 1 from public.pos_registers r
                where r.id=p_register and r.owner_id=v_owner and r.active=true)
 then
  raise exception 'Authorized active staging register required';
 end if;
 select c.* into v_staff
 from public.pos_owner_badge_slots s
 join public.pos_staff_credentials c on c.id=s.staff_id
 where s.owner_id=v_owner and s.slot=p_slot
   and c.auth_user_id=v_owner and c.staff_role='cashier';
 if found then
  select coalesce(g.active,false) into v_allowed
  from public.pos_staff_register_grants g
  where g.register_id=p_register and g.staff_id=v_staff.id
    and g.owner_id=v_owner;
  if not found then v_allowed:=false; end if;
 end if;
 return jsonb_build_object(
   'slot',p_slot,
   'reserved',v_staff.id is not null,
   'activated',coalesce(v_staff.enabled,false),
   'firstName',v_staff.first_name,
   'staffId',v_staff.id,
   'registerAllowed',v_allowed,
   'requiresEmployeeEmail',false
 );
end;
$$;
revoke all on function public.pos_owner_badge_slot_status(integer,uuid)
 from public,anon,authenticated;
grant execute on function public.pos_owner_badge_slot_status(integer,uuid)
 to authenticated;

-- Legacy owner-paired auth IDs cannot identify one of two cashier badges.
-- Do not restore the broad user-ID based grant API.
revoke all on function public.pos_staff_set_register_access(uuid,uuid,boolean)
 from public,anon,authenticated;

-- STAGING ONLY. Explain employee setup blockers without returning any PIN,
-- badge digest, raw email address, auth user ID, or owner secrets.
create or replace function public.pos_owner_employee_slot_status(p_slot integer)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid();
 v_pending public.pos_pending_employee_badges%rowtype;
 v_exists boolean:=false;v_confirmed boolean:=false;
 v_activated boolean:=false;v_reserved boolean:=false;
begin
 if v_uid is null or not public.is_persen_admin() or p_slot not in (1,2)
   or not exists(select 1 from public.pos_registers
     where owner_id=v_uid and active=true) then
  raise exception 'Owner authorization required';
 end if;
 select * into v_pending from public.pos_pending_employee_badges
 where owner_id=v_uid and slot=p_slot;
 v_reserved:=found;
 if v_reserved then
  select exists(select 1 from auth.users
    where lower(email)=v_pending.employee_email and id<>v_uid),
    exists(select 1 from auth.users
    where lower(email)=v_pending.employee_email
      and id<>v_uid and email_confirmed_at is not null)
  into v_exists,v_confirmed;
  select exists(select 1 from public.pos_staff_credentials staff
    join auth.users u on u.id=staff.auth_user_id
    where lower(u.email)=v_pending.employee_email
      and staff.staff_role='cashier' and staff.enabled)
  into v_activated;
 end if;
 return jsonb_build_object(
  'slot',p_slot,'reserved',v_reserved,
  'accountExists',v_exists,'emailConfirmed',v_confirmed,
  'alreadyAssigned',v_activated);
end;
$$;
revoke all on function public.pos_owner_employee_slot_status(integer)
 from public,anon,authenticated;
grant execute on function public.pos_owner_employee_slot_status(integer) to authenticated;

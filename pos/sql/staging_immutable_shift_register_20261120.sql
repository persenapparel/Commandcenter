-- STAGING ONLY. Install after staging_legacy_revoked_shift_constraint_20261120.sql
-- and before register-bound shift resume. No production deployment.
-- A shift's original register is an immutable authentication boundary.
-- Rollback (staging only): DROP TRIGGER pos_staff_shifts_register_immutable ON
-- public.pos_staff_shifts; DROP FUNCTION public.pos_guard_shift_register_immutable();
begin;
do $guard$
begin
  if to_regclass('public.pos_staff_shifts') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'pos_staff_shifts'
         and column_name = 'register_id'
     ) then
    raise exception 'Missing prerequisite shift register binding';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pos_staff_shifts'::regclass
      and conname = 'pos_staff_shifts_register_required'
      and contype = 'c'
  ) then
    raise exception 'Missing register-required constraint; install prerequisite chain first';
  end if;
  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.pos_staff_shifts'::regclass
      and tgname = 'pos_staff_shifts_register_immutable'
      and not tgisinternal
  ) then
    raise exception 'Existing shift register guard requires review before replacement';
  end if;
end;
$guard$;

create function public.pos_guard_shift_register_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog
as $body$
begin
  if old.register_id is distinct from new.register_id then
    raise exception 'Shift register binding cannot be changed'
      using errcode = '42501';
  end if;
  return new;
end;
$body$;

revoke all on function public.pos_guard_shift_register_immutable() from public, anon, authenticated;

create trigger pos_staff_shifts_register_immutable
before update of register_id on public.pos_staff_shifts
for each row execute function public.pos_guard_shift_register_immutable();

-- No existing rows are modified. Revoked legacy null-register shifts stay revoked.
commit;

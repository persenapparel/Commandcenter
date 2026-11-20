-- STAGING ONLY. Install after staging_immutable_shift_register_20261120.sql.
-- Never apply to production. Revoked cashier shifts must never become active again.
-- Rollback: reviewed forward migration dropping the trigger and function;
-- never clear revoked_at or restore previously revoked sessions.
begin;
do $guard$
begin
  if to_regclass('public.pos_staff_shifts') is null then
    raise exception 'Missing prerequisite public.pos_staff_shifts';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.pos_staff_shifts'::regclass
      and tgname = 'pos_staff_shifts_register_immutable' and not tgisinternal
  ) then
    raise exception 'Missing immutable-register prerequisite; install #261 first';
  end if;
  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.pos_staff_shifts'::regclass
      and tgname = 'pos_staff_shifts_revocation_monotonic' and not tgisinternal
  ) then
    raise exception 'Revocation trigger already exists; review before installing';
  end if;
end;
$guard$;

create function public.pos_guard_shift_revocation_monotonic()
returns trigger
language plpgsql
set search_path = pg_catalog
as $body$
begin
  -- Revocation is a one-way transition, including for historical null-register shifts.
  if old.revoked_at is not null
     and new.revoked_at is distinct from old.revoked_at then
    raise exception 'Revoked cashier shift cannot be reactivated or rewritten'
      using errcode = '42501';
  end if;
  return new;
end;
$body$;

revoke all on function public.pos_guard_shift_revocation_monotonic()
  from public, anon, authenticated;
create trigger pos_staff_shifts_revocation_monotonic
before update of revoked_at on public.pos_staff_shifts
for each row execute function public.pos_guard_shift_revocation_monotonic();

-- No shift rows, credentials, register grants, or sales are modified.
commit;

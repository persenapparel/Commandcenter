-- STAGING ONLY. Apply immediately after staging_shift_register_binding_prerequisite_20261120.sql
-- and before staging_resume_shift_original_register_binding_20261119.sql.
-- The prerequisite's NOT VALID CHECK (register_id IS NOT NULL) still rejects UPDATEs
-- to grandfathered, revoked, register-less shifts. Those rows must remain manageable
-- for cleanup/retention without assigning a guessed register.
-- Rollback: restore original NOT VALID check only after auditing all null-register rows;
-- never reactivate legacy shifts or infer their register.
begin;
do $guard$
declare
  v_constraint text;
  v_missing bigint;
begin
  if to_regclass('public.pos_staff_shifts') is null then
    raise exception 'Missing staging shift table';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='pos_staff_shifts'
      and column_name='register_id'
  ) then
    raise exception 'Shift register binding prerequisite not installed';
  end if;
  select pg_get_constraintdef(c.oid) into v_constraint
  from pg_constraint c
  where c.conrelid='public.pos_staff_shifts'::regclass
    and c.conname='pos_staff_shifts_register_required'
    and c.contype='c';
  if v_constraint is null then
    raise exception 'Expected shift register constraint missing';
  end if;
  if v_constraint not ilike '%register_id IS NOT NULL%' then
    raise exception 'Unexpected shift register constraint: %', v_constraint;
  end if;
  select count(*) into v_missing
  from public.pos_staff_shifts
  where register_id is null and revoked_at is null;
  if v_missing <> 0 then
    raise exception '% active shifts have no register binding', v_missing;
  end if;
end;
$guard$;
alter table public.pos_staff_shifts
  drop constraint pos_staff_shifts_register_required;
-- NOT VALID leaves historical revoked rows in place, but all new/updated active
-- shifts require register_id. A revoked legacy row may be updated for cleanup.
alter table public.pos_staff_shifts
  add constraint pos_staff_shifts_register_required
  check (register_id is not null or revoked_at is not null) not valid;
-- Never expose shift rows or RPCs through this migration.
commit;

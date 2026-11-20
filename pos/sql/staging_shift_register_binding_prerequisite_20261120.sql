-- STAGING ONLY: prerequisite to staging_resume_shift_original_register.
-- Apply AFTER credential/auth binding and BEFORE any resume RPC referencing s.register_id.
-- Existing unbound shifts are invalidated; users must badge+PIN sign in again.
-- Rollback requires reviewed forward migration. Never restore revoked shifts.
begin;
alter table public.pos_staff_shifts
  add column if not exists register_id uuid references public.pos_registers(id);
-- Do not guess a register for an existing shift, even if only one is currently active.
update public.pos_staff_shifts
set revoked_at = now()
where register_id is null and revoked_at is null;
do $guard$
declare
  v_oid oid;
  v_ddl text;
  v_old text := 'insert into public.pos_staff_shifts(staff_id,auth_user_id,secret_digest,credential_version,expires_at)' || chr(10) ||
                ' values(v_staff.id,v_uid,extensions.digest(v_secret,''sha256''),v_staff.credential_version,v_expiry);';
  v_new text := 'insert into public.pos_staff_shifts(staff_id,auth_user_id,secret_digest,credential_version,expires_at,register_id)' || chr(10) ||
                ' values(v_staff.id,v_uid,extensions.digest(v_secret,''sha256''),v_staff.credential_version,v_expiry,p_register);';
begin
  v_oid := to_regprocedure('public.pos_staff_start_shift(text,text,uuid)');
  if v_oid is null then
    raise exception 'Missing expected badge/PIN start-shift signature';
  end if;
  select pg_get_functiondef(v_oid) into v_ddl;
  if position(v_old in v_ddl) = 0 then
    raise exception 'Start-shift implementation changed; review before register binding';
  end if;
  if position('security definer' in lower(v_ddl)) = 0 then
    raise exception 'Unexpected start-shift function security context';
  end if;
  v_ddl := replace(v_ddl,v_old,v_new);
  execute v_ddl;
end;
$guard$;
-- New shifts must always carry their original register. Legacy shifts stay revoked.
alter table public.pos_staff_shifts
  add constraint pos_staff_shifts_register_required
  check (register_id is not null) not valid;
-- NOT VALID permits legacy null rows, but enforces register binding on new inserts/updates.
-- Ensure the RPC remains authenticated-only, including PUBLIC default EXECUTE.
revoke all on function public.pos_staff_start_shift(text,text,uuid) from public,anon,authenticated;
grant execute on function public.pos_staff_start_shift(text,text,uuid) to authenticated;
commit;

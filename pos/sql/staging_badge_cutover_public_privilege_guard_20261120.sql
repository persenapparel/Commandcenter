-- STAGING ONLY: credential-scoped badge cutover, privilege and schema guard.
-- Run AFTER consolidated badge migrations and legacy permission retirement.
-- Read-only checks; transaction rolls back even on success.
BEGIN;
DO $guard$
DECLARE
  v_sig text;
  v_oid oid;
  v_owner text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.pos_owner_set_badge_register_access(uuid,uuid,boolean)',
    'public.pos_owner_enroll_badge(integer,text,text,text,text,text,uuid)',
    'public.pos_owner_activate_pending_employee_badge(integer,text,text,uuid)'
  ] LOOP
    v_oid := to_regprocedure(v_sig);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Badge cutover blocked: scoped RPC missing: %', v_sig;
    END IF;
    SELECT pg_get_userbyid(p.proowner) INTO v_owner FROM pg_proc p WHERE p.oid = v_oid;
    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('PUBLIC', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Badge cutover blocked: public/anon execution: %', v_sig;
    END IF;
    IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Badge cutover blocked: authenticated caller lacks execution: %', v_sig;
    END IF;
  END LOOP;

  FOREACH v_sig IN ARRAY ARRAY[
    'public.pos_staff_set_register_access(uuid,uuid,boolean)',
    'public.pos_owner_enroll_badge(integer,text,text,text,text,text)',
    'public.pos_owner_activate_pending_employee_badge(integer,text,text)'
  ] LOOP
    v_oid := to_regprocedure(v_sig);
    IF v_oid IS NOT NULL AND (
       has_function_privilege('PUBLIC', v_oid, 'EXECUTE')
       OR has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'Badge cutover blocked: legacy function executable: %', v_sig;
    END IF;
  END LOOP;

  -- Verify register and credential relationships without reading customer records.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='pos_staff_shifts'
      AND column_name='register_id'
  ) THEN
    RAISE EXCEPTION 'Badge cutover blocked: shift register binding column missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='pos_staff_credentials'
      AND column_name='credential_version'
  ) THEN
    RAISE EXCEPTION 'Badge cutover blocked: credential version column missing';
  END IF;
END
$guard$;
ROLLBACK;

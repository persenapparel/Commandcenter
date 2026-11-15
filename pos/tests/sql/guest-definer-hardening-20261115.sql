-- Staging-only, read-only negative assertions for privileged guest RPC definitions.
-- Run only after independently confirming the connection is to isolated staging.
-- This is a code-review gate, NOT evidence of live database security or checkout readiness.
-- psql -X -v ON_ERROR_STOP=1 -f pos/tests/sql/guest-definer-hardening-20261115.sql
BEGIN TRANSACTION READ ONLY;
DO $audit$
DECLARE
  bad_public text;
  bad_path text;
  missing_gateway boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    RAISE EXCEPTION 'FAIL: anon role unavailable; cannot evaluate effective privileges';
  END IF;

  -- Effective privilege includes grants inherited through PUBLIC and role membership.
  SELECT string_agg(format('%I.%I(%s)',n.nspname,p.proname,
                          pg_get_function_identity_arguments(p.oid)), ', ')
    INTO bad_public
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname LIKE 'pos_%guest%'
    AND has_function_privilege('anon',p.oid,'EXECUTE');
  IF bad_public IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: anon can directly EXECUTE guest gateway RPC(s): %', bad_public;
  END IF;

  -- SECURITY DEFINER functions must explicitly pin a safe search_path.
  -- pg_catalog is implicit; pg_temp and public are not permitted in this gate.
  SELECT string_agg(format('%I.%I(%s)',n.nspname,p.proname,
                          pg_get_function_identity_arguments(p.oid)), ', ')
    INTO bad_path
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname LIKE 'pos_%guest%'
    AND p.prosecdef
    AND NOT EXISTS (
      SELECT 1 FROM unnest(COALESCE(p.proconfig,ARRAY[]::text[])) cfg
      WHERE cfg = 'search_path=pg_catalog'
    );
  IF bad_path IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: SECURITY DEFINER guest RPC lacks pinned pg_catalog search_path: %', bad_path;
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'pos_%guest%'
  ) INTO missing_gateway;
  IF missing_gateway THEN
    RAISE EXCEPTION 'FAIL: no hosted guest RPC; customer handoff must remain disabled';
  END IF;

  RAISE NOTICE 'PASS: guest RPC effective anon EXECUTE and SECURITY DEFINER search_path gates';
END $audit$;
ROLLBACK;
-- Still requires role-level RLS tests, capability expiry/replay, and real-browser E2E.

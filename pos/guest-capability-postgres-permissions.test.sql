-- READ-ONLY PostgreSQL integration assertions for the isolated POS staging
-- migration pos/guest-checkout-capability-staging.sql.
-- Run ONLY against an ephemeral test database with the draft migration already
-- applied. This file does not create fixtures, change roles, or modify data.
-- Expected result: NOTICE with PASS; any failed invariant raises an exception.
-- Never point automated tests at production or a live customer database.
DO $guest_permission_checks$
DECLARE
  t oid := to_regclass('public.pos_guest_checkout_capabilities');
  snap oid := to_regprocedure('public.pos_guest_checkout_snapshot(text)');
  issue oid := to_regprocedure('public.pos_issue_guest_checkout_capability(uuid)');
  revoke_token oid := to_regprocedure('public.pos_revoke_guest_checkout_capability(uuid)');
  trg oid := to_regprocedure('public.pos_revoke_guest_capability_on_checkout_change()');
  role_name text;
  func oid;
  trigger_count integer;
BEGIN
  IF t IS NULL OR snap IS NULL OR issue IS NULL OR revoke_token IS NULL OR trg IS NULL THEN
    RAISE EXCEPTION 'Guest capability migration is not fully installed in ephemeral test DB';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=t) THEN
    RAISE EXCEPTION 'Guest capability table must have RLS enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname='public' AND tablename='pos_guest_checkout_capabilities') THEN
    RAISE EXCEPTION 'Guest capability table unexpectedly exposes a row policy';
  END IF;
  FOR role_name IN SELECT unnest(ARRAY['anon','authenticated']) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      RAISE EXCEPTION 'Missing expected Supabase role %', role_name;
    END IF;
    IF has_table_privilege(role_name,t,'SELECT')
       OR has_table_privilege(role_name,t,'INSERT')
       OR has_table_privilege(role_name,t,'UPDATE')
       OR has_table_privilege(role_name,t,'DELETE') THEN
      RAISE EXCEPTION '% can directly access private guest tokens',role_name;
    END IF;
    IF has_function_privilege(role_name,snap,'EXECUTE')
       OR has_function_privilege(role_name,trg,'EXECUTE') THEN
      RAISE EXCEPTION '% can execute internal guest RPC/trigger',role_name;
    END IF;
  END LOOP;
  IF has_function_privilege('anon',issue,'EXECUTE')
     OR has_function_privilege('anon',revoke_token,'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous user can issue or revoke a guest token';
  END IF;
  IF NOT has_function_privilege('authenticated',issue,'EXECUTE')
     OR NOT has_function_privilege('authenticated',revoke_token,'EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated owner gateway cannot issue/revoke token';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid IN (snap,issue,revoke_token,trg)
      AND (NOT p.prosecdef OR p.proconfig IS NULL
        OR NOT ('search_path=""'=ANY(p.proconfig)
                OR 'search_path='=ANY(p.proconfig)))
  ) THEN
    RAISE EXCEPTION 'Guest RPC lacks SECURITY DEFINER or fixed empty search_path';
  END IF;
  SELECT count(*) INTO trigger_count
  FROM pg_trigger
  WHERE tgrelid='public.pos_checkouts'::regclass
    AND tgname='pos_guest_capability_checkout_changed'
    AND tgenabled<>'D' AND NOT tgisinternal;
  IF trigger_count<>1 THEN
    RAISE EXCEPTION 'Guest token invalidation trigger missing or disabled';
  END IF;
  RAISE NOTICE 'PASS: guest capability RLS, API grants, owner-only issuance, and revocation trigger';
END
$guest_permission_checks$;

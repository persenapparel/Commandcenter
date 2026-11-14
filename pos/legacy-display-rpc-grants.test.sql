-- Disposable PostgreSQL security acceptance gate, NOT a migration.
-- Legacy two-device RPCs must not be callable by untrusted API roles before
-- single-iPad customer handoff is enabled. This intentionally fails on the
-- previously observed staging grants; do not run against hosted databases.
-- Run with psql -v ON_ERROR_STOP=1 after applying reviewed revocation migration.
BEGIN;
DO $gate$
DECLARE
  name text;
  role_name text;
  matched integer;
  f record;
BEGIN
  FOREACH name IN ARRAY ARRAY[
    'pos_issue_display_pairing',
    'pos_customer_view',
    'pos_customer_cart_preview',
    'pos_set_customer_progress',
    'pos_submit_customer_v2'
  ] LOOP
    SELECT count(*) INTO matched FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=name;
    IF matched=0 THEN
      RAISE NOTICE 'Legacy function % absent (safe)', name;
      CONTINUE;
    END IF;
    FOR f IN
      SELECT p.oid, p.oid::regprocedure AS signature
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=name
    LOOP
      FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
          RAISE EXCEPTION 'Missing test role %', role_name;
        END IF;
        IF has_function_privilege(role_name,f.oid,'EXECUTE') THEN
          RAISE EXCEPTION 'Legacy RPC % still executable by %',f.signature,role_name;
        END IF;
      END LOOP;
      IF EXISTS (
        SELECT 1 FROM pg_proc p,
          LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=f.oid AND a.grantee=0 AND a.privilege_type='EXECUTE'
      ) THEN
        RAISE EXCEPTION 'Legacy RPC % still executable by PUBLIC',f.signature;
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'PASS: legacy display RPCs unavailable to API roles';
END
$gate$;
ROLLBACK;

-- Disposable PostgreSQL ONLY: verify no overloaded legacy RPC signature
-- remains callable through PUBLIC, anon, authenticated or inherited grants.
-- Apply reviewed staging revocation SQL first; do not run against hosted DB.
-- psql -v ON_ERROR_STOP=1 -f pos/legacy-display-overload-negative.test.sql
BEGIN;
DO $test$
DECLARE
  fn record;
  role_name text;
  checked integer := 0;
BEGIN
  FOR role_name IN SELECT unnest(ARRAY['anon','authenticated']) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      RAISE EXCEPTION 'Required isolated test role missing: %', role_name;
    END IF;
  END LOOP;
  FOR fn IN
    SELECT p.oid, p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=ANY(ARRAY[
      'pos_issue_display_pairing','pos_customer_view',
      'pos_customer_cart_preview','pos_set_customer_progress',
      'pos_submit_customer_v2'])
  LOOP
    checked := checked + 1;
    IF EXISTS (
      SELECT 1 FROM pg_proc p,
      LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      WHERE p.oid=fn.oid AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
    ) THEN
      RAISE EXCEPTION 'PUBLIC EXECUTE grant on legacy overload %', fn.signature;
    END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF has_function_privilege(role_name,fn.oid,'EXECUTE') THEN
        RAISE EXCEPTION 'Inherited or direct EXECUTE grant: % on %',role_name,fn.signature;
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'PASS: checked % legacy RPC overload(s), including inherited role grants', checked;
END
$test$;
ROLLBACK;

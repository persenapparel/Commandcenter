-- STAGING-ONLY DRAFT. Do not apply to hosted staging until reviewed and
-- disposable-PostgreSQL integration tests pass. Never apply to production.
-- This disables the old register-wide two-hour pairing/customer RPC surface.
-- It does NOT enable or implement the new single-checkout customer gateway.
-- Rollback: restore ONLY reviewed prior EXECUTE grants from a recorded
-- pre-migration ACL snapshot; do not grant PUBLIC or broad API access.
BEGIN;
DO $revoke$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'pos_issue_display_pairing',
        'pos_customer_view',
        'pos_customer_cart_preview',
        'pos_set_customer_progress',
        'pos_submit_customer_v2'
      ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.signature);
  END LOOP;
END
$revoke$;
-- Fail the migration atomically if any inherited or direct API grant remains.
DO $verify$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid, p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname = ANY (ARRAY[
        'pos_issue_display_pairing','pos_customer_view',
        'pos_customer_cart_preview','pos_set_customer_progress',
        'pos_submit_customer_v2'
      ])
  LOOP
    IF has_function_privilege('anon', f.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Legacy display RPC still exposed: %', f.signature;
    END IF;
  END LOOP;
END
$verify$;
COMMIT;

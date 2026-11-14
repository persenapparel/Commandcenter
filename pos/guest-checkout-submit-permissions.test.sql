-- READ-ONLY security assertions for disposable PostgreSQL only.
-- Apply the guest capability, checkout trigger and guest submit draft migrations
-- to an isolated disposable database first. Never run against hosted staging or production.
-- psql -v ON_ERROR_STOP=1 -f pos/guest-checkout-submit-permissions.test.sql
BEGIN;
DO $check$
DECLARE
  f oid := to_regprocedure('public.pos_guest_checkout_submit(text,jsonb)');
  signatures oid := to_regclass('public.pos_guest_checkout_signatures');
  limits oid := to_regclass('public.pos_guest_checkout_submit_limits');
  role_name text;
  tab oid;
BEGIN
  IF f IS NULL OR signatures IS NULL OR limits IS NULL THEN
    RAISE EXCEPTION 'Guest submit draft migration missing from disposable test database';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid=f AND prosecdef
      AND proconfig @> ARRAY['search_path=']::text[]
  ) THEN
    RAISE EXCEPTION 'Guest submit must be SECURITY DEFINER with empty search_path';
  END IF;
  FOR role_name IN SELECT unnest(ARRAY['PUBLIC','anon','authenticated']) LOOP
    IF role_name <> 'PUBLIC' AND NOT EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname=role_name
    ) THEN
      RAISE EXCEPTION 'Missing expected role %',role_name;
    END IF;
    IF has_function_privilege(role_name,f,'EXECUTE') THEN
      RAISE EXCEPTION '% can execute unexposed guest submission RPC',role_name;
    END IF;
    FOREACH tab IN ARRAY ARRAY[signatures,limits] LOOP
      IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=tab) THEN
        RAISE EXCEPTION 'Private guest table % has no RLS',tab::regclass;
      END IF;
      IF has_table_privilege(role_name,tab,'SELECT')
        OR has_table_privilege(role_name,tab,'INSERT')
        OR has_table_privilege(role_name,tab,'UPDATE')
        OR has_table_privilege(role_name,tab,'DELETE') THEN
        RAISE EXCEPTION '% can access private guest table %',role_name,tab::regclass;
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename IN ('pos_guest_checkout_signatures','pos_guest_checkout_submit_limits')
  ) THEN
    RAISE EXCEPTION 'Guest submit tables must not expose row policies';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid=limits AND contype='f'
      AND confrelid='public.pos_guest_checkout_capabilities'::regclass
  ) THEN
    RAISE EXCEPTION 'Submit limiter not bound to checkout capability';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid=signatures AND contype='f'
      AND confrelid='public.pos_checkouts'::regclass
  ) THEN
    RAISE EXCEPTION 'Signature table not bound to checkout';
  END IF;
  RAISE NOTICE 'PASS: submit RPC and both private tables deny PUBLIC/anon/authenticated access';
END
$check$;
ROLLBACK;

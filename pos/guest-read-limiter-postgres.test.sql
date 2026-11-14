-- READ-ONLY PostgreSQL assertions, for a disposable database with proposed
-- guest capability and read limiter migrations applied. NOT for hosted staging.
-- psql -v ON_ERROR_STOP=1 -f pos/guest-read-limiter-postgres.test.sql
DO $read_limiter_security$
DECLARE
  limit_table oid := to_regclass('public.pos_guest_checkout_read_limits');
  cap_table oid := to_regclass('public.pos_guest_checkout_capabilities');
  gateway oid := to_regprocedure('public.pos_guest_checkout_rate_limited_snapshot(text)');
  snap oid := to_regprocedure('public.pos_guest_checkout_snapshot(text)');
  fn record;
BEGIN
  IF limit_table IS NULL OR cap_table IS NULL OR gateway IS NULL OR snap IS NULL THEN
    RAISE EXCEPTION 'Apply guest migrations to disposable PostgreSQL first';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=limit_table) THEN
    RAISE EXCEPTION 'Read limiter table RLS is disabled';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=limit_table) THEN
    RAISE EXCEPTION 'Read limiter must not have API-facing RLS policies';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c,
      LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
    WHERE c.oid=limit_table AND acl.grantee=0
      AND acl.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
  ) THEN
    RAISE EXCEPTION 'PUBLIC has read limiter table privileges';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated')
      AND (has_table_privilege(r.rolname,limit_table,'SELECT')
        OR has_table_privilege(r.rolname,limit_table,'INSERT')
        OR has_table_privilege(r.rolname,limit_table,'UPDATE')
        OR has_table_privilege(r.rolname,limit_table,'DELETE'))
  ) THEN
    RAISE EXCEPTION 'API roles have private limiter table access';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid=limit_table AND c.contype='f'
      AND c.confrelid=cap_table AND c.confdeltype='c'
  ) THEN
    RAISE EXCEPTION 'Read limiter must cascade-delete with checkout capability';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c WHERE c.conrelid=limit_table
      AND c.contype='c' AND pg_get_constraintdef(c.oid) LIKE '%30%'
  ) THEN
    RAISE EXCEPTION 'Read limiter lacks database-enforced cap';
  END IF;
  SELECT p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) AS source
    INTO fn FROM pg_proc p WHERE p.oid=gateway;
  IF NOT fn.prosecdef OR NOT ('search_path='=ANY(fn.proconfig)) THEN
    RAISE EXCEPTION 'Gateway requires SECURITY DEFINER and empty search_path';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p,
      LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    WHERE p.oid=gateway AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC can execute unapproved guest gateway';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated')
      AND has_function_privilege(r.rolname,gateway,'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'API role can execute unapproved guest gateway';
  END IF;
  IF position('FOR UPDATE OF t' IN upper(fn.source))=0
     OR position('pos_guest_checkout_snapshot' IN fn.source)=0
     OR position('request_count < 30' IN fn.source)=0 THEN
    RAISE EXCEPTION 'Gateway lost row lock, capped counter or narrow snapshot';
  END IF;
  RAISE NOTICE 'PASS: guest read limiter RLS, grants, cascade and gateway contract';
END
$read_limiter_security$;

-- Opt-in STAGING-ONLY executable negative gate. No writes.
-- Verify target project identity naaqcspvbntzdtwuchrr OUTSIDE this script.
-- Run: psql -X -v ON_ERROR_STOP=1 -f pos/tests/sql/guest-enforced-security-gates-20261115.sql
-- A failed assertion aborts the transaction; never use on production.
BEGIN TRANSACTION READ ONLY;
DO $security$
DECLARE exposed text; unsafe_tables text; missing_gateway boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    RAISE EXCEPTION 'Missing anon role: cannot verify security';
  END IF;
  SELECT string_agg(format('%I(%s)',p.proname,pg_get_function_identity_arguments(p.oid)),', ')
    INTO exposed
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN ('pos_customer_view','pos_customer_cart_preview',
      'pos_set_customer_progress','pos_submit_customer_v2','pos_issue_display_pairing')
    AND (has_function_privilege('anon',p.oid,'EXECUTE')
      OR has_function_privilege('PUBLIC',p.oid,'EXECUTE'));
  IF exposed IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: anonymous legacy RPC EXECUTE: %', exposed;
  END IF;
  SELECT string_agg(c.relname,', ') INTO unsafe_tables
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p')
    AND c.relname LIKE 'pos_%guest%'
    AND (NOT c.relrowsecurity
      OR has_table_privilege('anon',c.oid,'SELECT')
      OR has_table_privilege('anon',c.oid,'INSERT')
      OR has_table_privilege('anon',c.oid,'UPDATE')
      OR has_table_privilege('anon',c.oid,'DELETE')
      OR has_table_privilege('PUBLIC',c.oid,'SELECT')
      OR has_table_privilege('PUBLIC',c.oid,'INSERT')
      OR has_table_privilege('PUBLIC',c.oid,'UPDATE')
      OR has_table_privilege('PUBLIC',c.oid,'DELETE'));
  IF unsafe_tables IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: guest table direct grants or RLS: %',unsafe_tables;
  END IF;
  SELECT NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'pos_%guest%'
  ) INTO missing_gateway;
  IF missing_gateway THEN
    RAISE EXCEPTION 'FAIL: no hosted guest gateway; handoff must stay blocked';
  END IF;
  RAISE NOTICE 'PASS: basic grant/RLS gates; gateway semantics still require independent review';
END $security$;
ROLLBACK;
-- This test does NOT prove capability scope, replay resistance, expiry,
-- throttling, owner-session isolation, or end-to-end checkout readiness.

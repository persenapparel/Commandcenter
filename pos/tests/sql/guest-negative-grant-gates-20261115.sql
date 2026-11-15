-- STAGING-ONLY read-only negative authorization gates. Never run against production.
-- Precondition: independently verify Supabase project ID naaqcspvbntzdtwuchrr.
-- This is a FAIL-CLOSED inventory, not a proof that customer handoff is safe.
-- psql -v ON_ERROR_STOP=1 -f this_file.sql (after verifying target)
BEGIN TRANSACTION READ ONLY;
WITH legacy AS (
 SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS signature,
        has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
        has_function_privilege('PUBLIC',p.oid,'EXECUTE') AS public_execute
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN
 ('pos_customer_view','pos_customer_cart_preview','pos_set_customer_progress',
  'pos_submit_customer_v2','pos_issue_display_pairing')
)
SELECT proname,signature,anon_execute,public_execute,
       CASE WHEN anon_execute OR public_execute THEN 'FAIL: legacy anonymous callable'
            ELSE 'PASS: legacy anonymous EXECUTE denied' END AS gate
FROM legacy ORDER BY proname,signature;

-- Check every overload: a single exposed overload is a failure.
WITH legacy AS (
 SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN
 ('pos_customer_view','pos_customer_cart_preview','pos_set_customer_progress',
  'pos_submit_customer_v2','pos_issue_display_pairing')
)
SELECT CASE WHEN EXISTS (
 SELECT 1 FROM legacy WHERE has_function_privilege('anon',oid,'EXECUTE')
 OR has_function_privilege('PUBLIC',oid,'EXECUTE'))
 THEN 'FAIL: at least one legacy RPC overload callable anonymously'
 ELSE 'PASS: no legacy RPC overload anonymously callable' END AS legacy_rpc_gate;

-- Anonymous access to private guest tables must be denied, and RLS enabled.
WITH guest_tables AS (
 SELECT c.oid,c.relname,c.relrowsecurity
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p')
 AND c.relname LIKE 'pos_%guest%'
)
SELECT relname,relrowsecurity,
 CASE WHEN NOT relrowsecurity
 OR has_table_privilege('anon',oid,'SELECT')
 OR has_table_privilege('anon',oid,'INSERT')
 OR has_table_privilege('anon',oid,'UPDATE')
 OR has_table_privilege('anon',oid,'DELETE')
 OR has_table_privilege('PUBLIC',oid,'SELECT')
 THEN 'FAIL: guest table not isolated' ELSE 'PASS: guest table isolated by direct privilege/RLS checks'
 END AS table_gate
FROM guest_tables ORDER BY relname;

-- A customer gateway cannot be marked ready just because a source migration exists.
-- Require actual deployed guest RPCs and review each signature/role grant.
WITH guest_rpcs AS (
 SELECT p.oid,p.proname,pg_get_function_identity_arguments(p.oid) AS signature,
        p.prosecdef,has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname LIKE 'pos_%guest%'
)
SELECT proname,signature,prosecdef,anon_execute FROM guest_rpcs ORDER BY proname,signature;
SELECT CASE WHEN EXISTS (
 SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname LIKE 'pos_%guest%')
 THEN 'REVIEW REQUIRED: deployed guest RPCs need expiry/replay/rate-limit/browser negative tests'
 ELSE 'FAIL: no deployed guest RPCs; handoff must stay blocked' END AS guest_gateway_gate;
ROLLBACK;

-- READ-ONLY staging migration preflight; run against project naaqcspvbntzdtwuchrr.
-- This script intentionally never changes grants, tables, or data.
-- STOP if project identity is not independently confirmed from Supabase project settings.
-- Execute before a separately reviewed migration, then run again after it.
begin read only;
select current_database() as database_name, current_user as executing_role,
       current_setting('server_version') as postgres_version;
-- Existing exposed legacy RPCs must be inventoried by *signature* (overloads matter).
select n.nspname as schema_name, p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
       has_function_privilege('PUBLIC',p.oid,'EXECUTE') as public_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and (p.proname like 'pos_%guest%' or p.proname in
       ('pos_customer_cart_preview','pos_customer_view','pos_set_customer_progress',
        'pos_submit_customer_v2','pos_issue_display_pairing'))
order by p.proname,pg_get_function_identity_arguments(p.oid);
-- Inventory all guest-capability tables and direct role privileges.
select c.relname as relation_name, c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced,
       has_table_privilege('anon',c.oid,'SELECT') as anon_select,
       has_table_privilege('anon',c.oid,'INSERT') as anon_insert,
       has_table_privilege('anon',c.oid,'UPDATE') as anon_update,
       has_table_privilege('anon',c.oid,'DELETE') as anon_delete,
       has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_select
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p')
  and c.relname like 'pos_%guest%'
order by c.relname;
-- Enumerate applicable policies, including permissive policies that could leak rows.
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname='public' and tablename like 'pos_%guest%'
order by tablename,policyname;
-- Required isolation invariants are FAIL-CLOSED: no anon direct table rights,
-- no guest RPCs => handoff cannot be enabled. Anon EXECUTE on legacy token-checked
-- functions alone does NOT prove leakage, but requires negative data-access tests.
select case when exists (
  select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p') and c.relname like 'pos_%guest%'
    and (has_table_privilege('anon',c.oid,'SELECT') or
         has_table_privilege('anon',c.oid,'INSERT') or
         has_table_privilege('anon',c.oid,'UPDATE') or
         has_table_privilege('anon',c.oid,'DELETE'))
) then 'FAIL: anonymous direct guest-table privileges' else 'PASS: no anonymous direct guest-table privileges' end as guest_table_privilege_gate;
rollback;

-- Run ONLY against a disposable PostgreSQL database:
-- psql -X -v ON_ERROR_STOP=1 -f pos/tests/revoke-legacy-display-rpcs-disposable.sql
-- Never run against hosted staging or production.
\set ON_ERROR_STOP on
DO $$
BEGIN
 IF current_database() NOT LIKE 'pos_disposable_%' THEN
   RAISE EXCEPTION 'Refusing to test outside pos_disposable_* database';
 END IF;
END $$;
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS public;
CREATE OR REPLACE FUNCTION public.pos_issue_display_pairing() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
CREATE OR REPLACE FUNCTION public.pos_customer_view() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
CREATE OR REPLACE FUNCTION public.pos_customer_cart_preview() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
CREATE OR REPLACE FUNCTION public.pos_set_customer_progress() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
CREATE OR REPLACE FUNCTION public.pos_submit_customer_v2() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
-- Exercise overloaded RPC signatures, not just zero-argument fixtures.
CREATE OR REPLACE FUNCTION public.pos_customer_view(p_token text) RETURNS integer LANGUAGE sql AS $ SELECT 1 $;
CREATE OR REPLACE FUNCTION public.pos_submit_customer_v2(p_token text, p_answers jsonb) RETURNS integer LANGUAGE sql AS $ SELECT 1 $;
GRANT EXECUTE ON FUNCTION public.pos_customer_view(text), public.pos_submit_customer_v2(text,jsonb) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_issue_display_pairing(), public.pos_customer_view(), public.pos_customer_cart_preview(), public.pos_set_customer_progress(), public.pos_submit_customer_v2() TO PUBLIC, anon, authenticated;
DO $$
BEGIN
 IF NOT has_function_privilege('anon','public.pos_customer_view()','EXECUTE') THEN
   RAISE EXCEPTION 'Fixture did not expose legacy RPC';
 END IF;
END $$;
\ir ../revoke-legacy-display-rpcs-staging.sql
DO $$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname = ANY(ARRAY[
 'pos_issue_display_pairing','pos_customer_view','pos_customer_cart_preview',
 'pos_set_customer_progress','pos_submit_customer_v2']) LOOP
 IF has_function_privilege('anon',f.oid,'EXECUTE') OR
    has_function_privilege('authenticated',f.oid,'EXECUTE') THEN
   RAISE EXCEPTION 'Legacy RPC still executable: %', f.proname;
 END IF;
 END LOOP;
END $$;
-- Confirm re-running the migration remains safe.
\ir ../revoke-legacy-display-rpcs-staging.sql

-- Negative execution checks must fail with permission denied, not silently return data.
DO $$
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM public.pos_customer_view('stolen-token');
    RAISE EXCEPTION 'anon unexpectedly executed legacy RPC';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
  END;
END $$;

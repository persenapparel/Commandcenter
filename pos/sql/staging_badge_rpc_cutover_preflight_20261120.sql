-- STAGING ONLY. Deployment preflight for credential-scoped badge/grant RPCs.
-- Must run after the consolidated badge migrations and before legacy RPC retirement.
-- This intentionally makes no data, permission or schema changes.
BEGIN;
DO $preflight$
DECLARE
  v_name text;
  v_sig text;
BEGIN
  -- Exact overload checks prevent accidentally accepting an auth-user-based API.
  FOREACH v_sig IN ARRAY ARRAY[
    'public.pos_owner_set_badge_register_access(integer,uuid,boolean)',
    'public.pos_owner_enroll_badge(integer,text,text,text,text,text,uuid)',
    'public.pos_owner_activate_pending_employee_badge(integer,text,text,uuid)'
  ] LOOP
    IF to_regprocedure(v_sig) IS NULL THEN
      RAISE EXCEPTION 'POS staging deployment blocked: missing scoped RPC %', v_sig;
    END IF;
  END LOOP;

  -- Never retire legacy callers if the new RPCs remain executable by anon.
  FOREACH v_sig IN ARRAY ARRAY[
    'public.pos_owner_set_badge_register_access(integer,uuid,boolean)',
    'public.pos_owner_enroll_badge(integer,text,text,text,text,text,uuid)',
    'public.pos_owner_activate_pending_employee_badge(integer,text,text,uuid)'
  ] LOOP
    IF has_function_privilege('anon', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'POS staging deployment blocked: anon can execute %', v_sig;
    END IF;
  END LOOP;

  -- Assert retired legacy entry points are no longer callable by staff.
  FOREACH v_sig IN ARRAY ARRAY[
    'public.pos_staff_set_register_access(uuid,uuid,boolean)',
    'public.pos_owner_enroll_badge(integer,text,text,text,text,text)',
    'public.pos_owner_activate_pending_employee_badge(integer,text,text)'
  ] LOOP
    IF to_regprocedure(v_sig) IS NOT NULL
       AND (has_function_privilege('anon', v_sig, 'EXECUTE')
            OR has_function_privilege('authenticated', v_sig, 'EXECUTE')) THEN
      RAISE EXCEPTION 'POS staging deployment blocked: legacy RPC still executable %', v_sig;
    END IF;
  END LOOP;
END
$preflight$;
ROLLBACK;

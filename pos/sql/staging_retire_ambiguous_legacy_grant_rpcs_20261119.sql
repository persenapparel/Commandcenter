-- STAGING ONLY. Apply AFTER the credential-ID grant and register-scoped enrollment
-- migrations, and AFTER all owner-facing callers use their new signatures.
-- Deliberately fail closed on legacy signatures that cannot identify one
-- credential or one active owner-controlled register.
-- This migration does not modify any grants, credentials, shifts or sales.
-- Rollback: reviewed forward migration only, after restoring safe callers.
BEGIN;
REVOKE ALL ON FUNCTION public.pos_staff_set_register_access(uuid,uuid,boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_owner_enroll_badge(integer,text,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_owner_activate_pending_employee_badge(integer,text,text)
  FROM PUBLIC, anon, authenticated;
-- Assert all three legacy overloads exist, so a typo cannot silently pass.
DO $$
BEGIN
 IF to_regprocedure('public.pos_staff_set_register_access(uuid,uuid,boolean)') IS NULL
 OR to_regprocedure('public.pos_owner_enroll_badge(integer,text,text,text,text,text)') IS NULL
 OR to_regprocedure('public.pos_owner_activate_pending_employee_badge(integer,text,text)') IS NULL
 THEN RAISE EXCEPTION 'Expected legacy POS RPC signature missing; review migration order';
 END IF;
END $$;
COMMIT;

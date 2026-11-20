-- STAGING ONLY. Depends on the credential-scoped grant RPC stack and #264.
-- Prevent direct or future RPC writes from rebinding an existing credential grant.
-- Rollback: reviewed forward migration dropping this trigger/function; never restore revoked grants.
BEGIN;
CREATE OR REPLACE FUNCTION public.pos_staging_guard_register_grant_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_register_owner uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND (
      NEW.register_id IS DISTINCT FROM OLD.register_id OR
      NEW.staff_id IS DISTINCT FROM OLD.staff_id OR
      NEW.owner_id IS DISTINCT FROM OLD.owner_id
  ) THEN
    RAISE EXCEPTION 'Register grant identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  SELECT r.owner_id INTO v_register_owner
  FROM public.pos_registers AS r
  WHERE r.id = NEW.register_id
  FOR KEY SHARE;

  IF v_register_owner IS NULL OR NEW.owner_id IS DISTINCT FROM v_register_owner THEN
    RAISE EXCEPTION 'Register grant owner mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pos_staff_credentials AS c WHERE c.id = NEW.staff_id
  ) THEN
    RAISE EXCEPTION 'Register grant credential unavailable'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_staging_guard_register_grant_identity()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS pos_staging_register_grant_identity_guard
  ON public.pos_staff_register_grants;
CREATE TRIGGER pos_staging_register_grant_identity_guard
BEFORE INSERT OR UPDATE ON public.pos_staff_register_grants
FOR EACH ROW
EXECUTE FUNCTION public.pos_staging_guard_register_grant_identity();
COMMIT;

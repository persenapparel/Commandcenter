-- READ-ONLY, EPHEMERAL POSTGRES ONLY. Apply the proposed guest migration
-- to an isolated disposable database before running this file.
-- Defense-in-depth negative checks: token column exposure, implicit PUBLIC
-- grants, and every mutation column that must invalidate an active guest token.
DO $guest_negative_checks$
DECLARE
  token_table oid := to_regclass('public.pos_guest_checkout_capabilities');
  checkout_table oid := to_regclass('public.pos_checkouts');
  snap oid := to_regprocedure('public.pos_guest_checkout_snapshot(text)');
  issue oid := to_regprocedure('public.pos_issue_guest_checkout_capability(uuid)');
  revoke_token oid := to_regprocedure('public.pos_revoke_guest_checkout_capability(uuid)');
  trigger_func oid := to_regprocedure('public.pos_revoke_guest_capability_on_checkout_change()');
  changed_columns text[] := ARRAY[
    'status','items','subtotal_cents','discount_cents','discount_bps',
    'tax_milli','tax_cents','event_id','total_cents',
    'cash_handoff_complete','register_id','owner_id'
  ];
  column_name text;
  trig record;
  fn oid;
BEGIN
  IF token_table IS NULL OR checkout_table IS NULL OR snap IS NULL
     OR issue IS NULL OR revoke_token IS NULL OR trigger_func IS NULL THEN
    RAISE EXCEPTION 'Apply the guest migration to an EPHEMERAL database first';
  END IF;
  -- PostgreSQL's PUBLIC pseudo-role must be denied explicitly: revoking
  -- anon/authenticated alone does not override inherited PUBLIC privileges.
  IF has_table_privilege('public',token_table,'SELECT')
     OR has_table_privilege('public',token_table,'INSERT')
     OR has_table_privilege('public',token_table,'UPDATE')
     OR has_table_privilege('public',token_table,'DELETE') THEN
    RAISE EXCEPTION 'PUBLIC can access private guest token table';
  END IF;
  FOREACH fn IN ARRAY ARRAY[snap,issue,revoke_token,trigger_func] LOOP
    IF has_function_privilege('public',fn,'EXECUTE') THEN
      RAISE EXCEPTION 'PUBLIC can execute guest capability function %',fn::regprocedure;
    END IF;
  END LOOP;
  -- Avoid accidental raw-token persistence: the capability table stores
  -- only a SHA-256 digest, never a bearer token, URL, or auth session.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='pos_guest_checkout_capabilities'
      AND column_name IN ('token','secret','capability','session','url','raw_token')
  ) THEN
    RAISE EXCEPTION 'Guest token table has a forbidden raw credential column';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='pos_guest_checkout_capabilities'
      AND column_name='token_sha256' AND data_type='text' AND is_nullable='NO'
  ) THEN
    RAISE EXCEPTION 'Missing required non-null SHA-256 token digest';
  END IF;
  SELECT t.oid,t.tgtype,t.tgenabled,t.tgattr,t.tgfoid
    INTO trig
    FROM pg_trigger t
    WHERE t.tgrelid=checkout_table
      AND t.tgname='pos_guest_capability_checkout_changed'
      AND NOT t.tgisinternal;
  IF NOT FOUND OR trig.tgenabled='D' OR trig.tgfoid<>trigger_func THEN
    RAISE EXCEPTION 'Guest invalidation trigger missing, disabled, or wrong function';
  END IF;
  -- Trigger must fire AFTER UPDATE, once per row. A statement-level or
  -- BEFORE trigger may silently break atomic revocation expectations.
  IF (trig.tgtype & 16)=0 OR (trig.tgtype & 1)=0
     OR (trig.tgtype & 2)<>0 THEN
    RAISE EXCEPTION 'Guest invalidation trigger must be AFTER UPDATE FOR EACH ROW';
  END IF;
  FOREACH column_name IN ARRAY changed_columns LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid=checkout_table AND a.attname=column_name
        AND NOT a.attisdropped AND a.attnum=ANY(trig.tgattr::int2[])
    ) THEN
      RAISE EXCEPTION 'Guest token survives changes to checkout column %',column_name;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS: PUBLIC denial, hashed-only token schema, row trigger and 12 mutation columns';
END
$guest_negative_checks$;

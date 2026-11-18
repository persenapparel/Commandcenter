-- Disposable PostgreSQL security regression: a badge valid for register A
-- must never start or resume a shift at register B. Never deploy this test.
BEGIN;

INSERT INTO auth.users(id) VALUES ('88888888-8888-4888-8888-888888888888');
INSERT INTO public.pos_registers(id,owner_id,label,active) VALUES
 ('99999999-9999-4999-8999-999999999999','11111111-1111-4111-8111-111111111111','Scoped Register A',true),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','11111111-1111-4111-8111-111111111111','Scoped Register B',true);
INSERT INTO public.pos_staff_credentials(auth_user_id,first_name,staff_role,badge_digest,pin_hash)
 VALUES ('88888888-8888-4888-8888-888888888888','Scoped Cashier','cashier',
  extensions.digest(repeat('R',32),'sha256'),
  extensions.crypt('123456',extensions.gen_salt('bf')));

DO $test$
DECLARE
 v_owner uuid:='11111111-1111-4111-8111-111111111111';
 v_staff uuid:='88888888-8888-4888-8888-888888888888';
 v_register_a uuid:='99999999-9999-4999-8999-999999999999';
 v_register_b uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
 v_login jsonb; v_resume jsonb; v_shift uuid; v_secret text;
BEGIN
 -- Only Register A is granted. B remains active but intentionally ungranted.
 PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
 IF public.pos_staff_set_register_access(v_register_a,v_staff,true) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'Owner could not grant Register A'; END IF;

 PERFORM set_config('request.jwt.claim.sub',v_staff::text,true);
 v_login:=public.pos_staff_start_shift(repeat('R',32),'123456',v_register_a);
 IF v_login->>'ok' IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'Granted cashier could not start Register A shift'; END IF;
 v_shift:=(v_login->>'shift_id')::uuid;
 v_secret:=v_login->>'shift_secret';

 v_resume:=public.pos_staff_resume_shift(v_shift,v_secret,repeat('R',32),v_register_b);
 IF v_resume->>'ok' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Register A badge resumed a shift at ungranted Register B'; END IF;
 v_login:=public.pos_staff_start_shift(repeat('R',32),'123456',v_register_b);
 IF v_login->>'ok' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Register A badge started a shift at ungranted Register B'; END IF;

 v_resume:=public.pos_staff_resume_shift(v_shift,v_secret,repeat('R',32),v_register_a);
 IF v_resume->>'ok' IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'Granted Register A badge could not resume its original shift'; END IF;

 -- A later revoke must immediately defeat the still-valid shift token too.
 PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
 IF public.pos_staff_set_register_access(v_register_a,v_staff,false) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'Owner could not revoke Register A'; END IF;
 PERFORM set_config('request.jwt.claim.sub',v_staff::text,true);
 v_resume:=public.pos_staff_resume_shift(v_shift,v_secret,repeat('R',32),v_register_a);
 IF v_resume->>'ok' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Revoked Register A badge resumed an existing shift'; END IF;
 v_login:=public.pos_staff_start_shift(repeat('R',32),'123456',v_register_a);
 IF v_login->>'ok' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Revoked Register A badge started a new shift'; END IF;

 RAISE NOTICE 'PASS: staff badge stays bound to its explicitly granted register';
END $test$;

ROLLBACK;

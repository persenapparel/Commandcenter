-- DISPOSABLE POSTGRES 17 ONLY. Never run test users or sale fixtures on hosted POS.
BEGIN;
INSERT INTO auth.users(id) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
INSERT INTO public.pos_registers(id,owner_id,label)
VALUES ('88888888-8888-4888-8888-888888888888',
 '11111111-1111-4111-8111-111111111111','Owner self-badge CI');
INSERT INTO public.stock_items(id,sku,product_name,color,size,quantity)
VALUES ('99999999-9999-4999-8999-999999999999','OWNER-BADGE-CI','Owner CI Product','Blue','L',5);
INSERT INTO public.inventory_catalog(name,inventory_type,price_cents,is_active)
VALUES ('Owner CI Product','sales',2500,true);
INSERT INTO public.pos_variant_details(stock_id,price_cents,taxable,category,product_type)
VALUES ('99999999-9999-4999-8999-999999999999',2500,true,'Apparel','shirt');
DO $test$
DECLARE
 v_owner uuid:='11111111-1111-4111-8111-111111111111';
 v_other uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 v_reg uuid:='88888888-8888-4888-8888-888888888888';
 v_stock uuid:='99999999-9999-4999-8999-999999999999';
 v_staff uuid;v_shift uuid;v_secret text;v_checkout uuid;v_token text;
 v_ans jsonb;v_login jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',v_other::text,true);
 BEGIN
  PERFORM public.pos_owner_enroll_staff_self(repeat('O',32),'123456','Not Owner');
  RAISE EXCEPTION 'Other user enrolled an owner badge';
 EXCEPTION WHEN others THEN
  IF SQLERRM='Other user enrolled an owner badge' THEN RAISE; END IF;
 END;
 PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
 v_ans:=public.pos_owner_enroll_staff_self(repeat('O',32),'123456','Owner Test');
 IF v_ans->>'enrolled' IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'Owner badge enrollment failed'; END IF;
 SELECT id INTO v_staff FROM public.pos_staff_credentials
 WHERE auth_user_id=v_owner AND staff_role='owner' AND enabled=true;
 IF v_staff IS NULL THEN RAISE EXCEPTION 'Owner credential missing'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.pos_staff_register_grants
   WHERE register_id=v_reg AND owner_id=v_owner AND staff_id=v_staff
     AND granted_by=v_owner AND active=true)
 THEN RAISE EXCEPTION 'Enrollment did not grant only own register'; END IF;
 IF EXISTS (SELECT 1 FROM public.pos_staff_register_grants
   WHERE staff_id=v_staff AND owner_id<>v_owner)
 THEN RAISE EXCEPTION 'Owner badge granted access to another owner'; END IF;
 v_login:=public.pos_staff_start_shift(repeat('O',32),'123456');
 IF v_login->>'ok' IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'New owner badge failed shift login'; END IF;
 v_shift:=(v_login->>'shift_id')::uuid;v_secret:=v_login->>'shift_secret';
 v_checkout:=public.pos_staff_begin_checkout(
  v_shift,v_secret,v_reg,
  jsonb_build_array(jsonb_build_object('stock_id',v_stock,'qty',1,
    'unit_cents',2500,'service','Apparel','taxable',true)),0,0,null);
 IF v_checkout IS NULL THEN RAISE EXCEPTION 'Owner badge did not authorize checkout'; END IF;
 v_ans:=public.pos_handoff_claim(v_checkout,v_shift,v_secret);
 IF v_ans->>'phase' IS DISTINCT FROM 'claimed' THEN
  RAISE EXCEPTION 'Owner checkout claim failed'; END IF;
 v_ans:=public.pos_handoff_issue_guest(v_checkout,v_shift,v_secret);
 v_token:=v_ans->>'capability';
 IF length(v_token)<>64 THEN RAISE EXCEPTION 'Guest token was not issued'; END IF;
 -- Rotating this owner's badge must revoke the previous shift and guest grant.
 v_ans:=public.pos_owner_enroll_staff_self(repeat('N',32),'654321','Owner Test');
 IF v_ans->>'enrolled' IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'Owner badge rotation failed'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.pos_staff_shifts
   WHERE id=v_shift AND revoked_at IS NOT NULL)
 THEN RAISE EXCEPTION 'Rotated badge left old shift active'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.pos_checkout_handoffs
   WHERE checkout_id=v_checkout AND phase='closed'
     AND capability_digest IS NULL AND capability_expires_at IS NULL)
 THEN RAISE EXCEPTION 'Rotated badge left a guest token alive'; END IF;
 BEGIN
  PERFORM public.pos_handoff_guest_view(v_checkout,v_token);
  RAISE EXCEPTION 'Old guest token still usable after rotation';
 EXCEPTION WHEN others THEN
  IF SQLERRM='Old guest token still usable after rotation' THEN RAISE; END IF;
 END;
 v_login:=public.pos_staff_start_shift(repeat('N',32),'654321');
 IF v_login->>'ok' IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'Rotated badge could not log in'; END IF;
 RAISE NOTICE 'PASS: owner self grant, shift-bound checkout, rotation revokes token';
END $test$;
ROLLBACK;

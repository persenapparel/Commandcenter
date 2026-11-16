-- Disposable PostgreSQL 17 staff authorization negative test. Never hosted.
BEGIN;
INSERT INTO auth.users(id) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

INSERT INTO public.pos_registers(id,owner_id,label) VALUES
 ('77777777-7777-4777-8777-777777777777',
 '11111111-1111-4111-8111-111111111111','CI staff permission register');
INSERT INTO public.stock_items(id,sku,product_name,color,size,quantity)
 VALUES ('66666666-6666-4666-8666-666666666666','STAFF-CI-M','Staff CI Hoodie','Navy','M',9);
INSERT INTO public.inventory_catalog(name,inventory_type,price_cents,is_active)
 VALUES ('Staff CI Hoodie','sales',2500,true);
INSERT INTO public.pos_variant_details(stock_id,price_cents,taxable,category,product_type)
 VALUES ('66666666-6666-4666-8666-666666666666',2500,true,'Apparel','hoodie');
INSERT INTO public.pos_staff_credentials(auth_user_id,first_name,staff_role,badge_digest,pin_hash)
 VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','CI Employee','cashier',
 extensions.digest(repeat('S',32),'sha256'),
 extensions.crypt('123456',extensions.gen_salt('bf')));
DO $test$
DECLARE
 v_staff uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 v_outsider uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 v_owner uuid:='11111111-1111-4111-8111-111111111111';
 v_reg uuid:='77777777-7777-4777-8777-777777777777';
 v_item uuid:='66666666-6666-4666-8666-666666666666';
 v_shift uuid; v_secret text; v_login jsonb; v_checkout uuid;
 v_grant jsonb; v_token text; v_sale uuid;
 v_items jsonb;
BEGIN
 v_items:=jsonb_build_array(jsonb_build_object(
  'stock_id',v_item,'qty',1,'unit_cents',2500,'service','Apparel','taxable',true));
 PERFORM set_config('request.jwt.claim.sub',v_staff::text,true);
 v_login:=public.pos_staff_start_shift(repeat('S',32),'123456');
 IF v_login->>'ok'<>'true' THEN RAISE EXCEPTION 'Valid employee could not sign in'; END IF;
 v_shift:=(v_login->>'shift_id')::uuid;v_secret:=v_login->>'shift_secret';
 BEGIN
  PERFORM public.pos_staff_begin_checkout(v_shift,v_secret,v_reg,v_items,0,0,null);
  RAISE EXCEPTION 'Unapproved cashier created checkout';
 EXCEPTION WHEN others THEN
  IF SQLERRM='Unapproved cashier created checkout' THEN RAISE; END IF;
 END;
 PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
 IF public.pos_staff_set_register_access(v_reg,v_staff,true) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'Owner could not grant access'; END IF;
 PERFORM set_config('request.jwt.claim.sub',v_outsider::text,true);
 BEGIN
  PERFORM public.pos_staff_set_register_access(v_reg,v_outsider,true);
  RAISE EXCEPTION 'Nonowner granted register access';
 EXCEPTION WHEN others THEN
  IF SQLERRM='Nonowner granted register access' THEN RAISE; END IF;
 END;
 PERFORM set_config('request.jwt.claim.sub',v_staff::text,true);
 BEGIN
  PERFORM public.pos_staff_begin_checkout(v_shift,'wrong',v_reg,v_items,0,0,null);
  RAISE EXCEPTION 'Invalid shift secret allowed';
 EXCEPTION WHEN others THEN
  IF SQLERRM='Invalid shift secret allowed' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.pos_staff_begin_checkout(v_shift,v_secret,v_reg,v_items,500,0,null);
  RAISE EXCEPTION 'Cashier discount bypassed owner approval';
 EXCEPTION WHEN others THEN
  IF SQLERRM='Cashier discount bypassed owner approval' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.pos_staff_begin_checkout(v_shift,v_secret,v_reg,
    '[{"name":"Unauthorized manual item","qty":1,"unit_cents":1}]'::jsonb,0,0,null);
  RAISE EXCEPTION 'Cashier custom-price item was allowed';
 EXCEPTION WHEN others THEN
  IF SQLERRM='Cashier custom-price item was allowed' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.pos_staff_begin_checkout(v_shift,v_secret,v_reg,
    jsonb_build_array(jsonb_build_object('stock_id',v_item,
    'qty',1,'unit_cents',1,'taxable',true)),0,0,null);
  RAISE EXCEPTION 'Changed catalog price was accepted';
 EXCEPTION WHEN others THEN
  IF SQLERRM='Changed catalog price was accepted' THEN RAISE; END IF;
 END;
 v_checkout:=public.pos_staff_begin_checkout(v_shift,v_secret,v_reg,v_items,0,0,null);
 IF NOT EXISTS(SELECT 1 FROM public.pos_checkouts
   WHERE id=v_checkout AND register_id=v_reg AND owner_id=v_owner
   AND total_cents=2500 AND status='awaiting_customer')
 THEN RAISE EXCEPTION 'Employee sale did not bind to owner register'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.stock_items
  WHERE id=v_item AND quantity=9)
 THEN RAISE EXCEPTION 'Checkout creation prematurely changed inventory'; END IF;
 v_grant:=public.pos_handoff_claim(v_checkout,v_shift,v_secret);
 IF v_grant->>'phase'<>'claimed' THEN
   RAISE EXCEPTION 'Employee checkout claim rejected'; END IF;
 v_grant:=public.pos_handoff_issue_guest(v_checkout,v_shift,v_secret);
 v_token:=v_grant->>'capability';
 IF length(v_token)<>64 THEN RAISE EXCEPTION 'Employee guest token not issued'; END IF;
 v_grant:=public.pos_handoff_guest_view(v_checkout,v_token);
 IF v_grant->>'checkoutId' IS DISTINCT FROM v_checkout::text
 THEN RAISE EXCEPTION 'Employee guest capability not checkout scoped'; END IF;
 -- The employee identity differs from the register owner. Authoritative
 -- status must work for the original shift only; no browser status forgery.
 v_grant:=public.pos_handoff_status(v_checkout,v_shift,v_secret);
 IF v_grant->>'status' IS DISTINCT FROM 'awaiting_customer'
 THEN RAISE EXCEPTION 'Original staff checkout status not authorized'; END IF;
 PERFORM set_config('request.jwt.claim.sub',v_outsider::text,true);
 BEGIN
  PERFORM public.pos_handoff_status(v_checkout,v_shift,v_secret);
  RAISE EXCEPTION 'Other employee could read original checkout';
 EXCEPTION WHEN others THEN
  IF SQLERRM='Other employee could read original checkout' THEN RAISE; END IF;
 END;
 PERFORM set_config('request.jwt.claim.sub',v_staff::text,true);
 -- Submit a scoped fake-data guest answer and atomically burn guest token.
 v_grant:=public.pos_handoff_guest_submit(v_checkout,v_token,
   '{"signature":"CI Guest","signatureException":false,
     "marketingConsent":false,"email":"","phone":""}'::jsonb);
 IF v_grant->>'accepted' IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'Scoped guest submit failed'; END IF;
 BEGIN
  PERFORM public.pos_handoff_guest_view(v_checkout,v_token);
  RAISE EXCEPTION 'Submitted guest token remained reusable';
 EXCEPTION WHEN others THEN
  IF SQLERRM='Submitted guest token remained reusable' THEN RAISE; END IF;
 END;
 v_grant:=public.pos_handoff_status(v_checkout,v_shift,v_secret);
 IF v_grant->>'status' IS DISTINCT FROM 'contact_received'
 THEN RAISE EXCEPTION 'Original staff could not read customer completion'; END IF;
 PERFORM set_config('request.jwt.claim.sub',v_outsider::text,true);
 BEGIN
  PERFORM public.pos_handoff_resume(v_checkout,v_shift,v_secret,repeat('S',32));
  RAISE EXCEPTION 'Another employee resumed original checkout';
 EXCEPTION WHEN others THEN
  IF SQLERRM='Another employee resumed original checkout' THEN RAISE; END IF;
 END;
 PERFORM set_config('request.jwt.claim.sub',v_staff::text,true);
 v_grant:=public.pos_handoff_resume(v_checkout,v_shift,v_secret,repeat('S',32));
 IF v_grant->>'verified' IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'Original employee badge resume rejected'; END IF;
 v_grant:=public.pos_handoff_verify_paid(v_checkout,v_shift,v_secret);
 IF v_grant->>'completed' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Payment verification accepted an unpaid order'; END IF;

 -- This customer supplied no phone number; isolated guest contact is optional.
 -- Payment must still be tied to the original authenticated employee shift.
 PERFORM set_config('request.jwt.claim.sub',v_outsider::text,true);
 BEGIN
  PERFORM public.pos_staff_complete_cash(v_shift,v_secret,v_checkout,2500,'{}','{}',null);
  RAISE EXCEPTION 'Other employee completed original sale';
 EXCEPTION WHEN others THEN
  IF SQLERRM='Other employee completed original sale' THEN RAISE; END IF;
 END;
 PERFORM set_config('request.jwt.claim.sub',v_staff::text,true);
 BEGIN
  PERFORM public.pos_staff_complete_cash(v_shift,'invalid',v_checkout,2500,'{}','{}',null);
  RAISE EXCEPTION 'Invalid shift secret completed sale';
 EXCEPTION WHEN others THEN
  IF SQLERRM='Invalid shift secret completed sale' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.pos_staff_complete_cash(v_shift,v_secret,v_checkout,2499,'{}','{}',null);
  RAISE EXCEPTION 'Underpayment was recorded';
 EXCEPTION WHEN others THEN
  IF SQLERRM='Underpayment was recorded' THEN RAISE; END IF;
 END;
 v_sale:=public.pos_staff_complete_cash(v_shift,v_secret,v_checkout,2500,'{}','{}',null);
 IF NOT EXISTS(select 1 from public.pos_sales
  where id=v_sale and checkout_id=v_checkout and owner_id=v_owner
    and total_cents=2500 and tendered_cents=2500 and change_cents=0)
 THEN RAISE EXCEPTION 'Staff cash sale not saved against register owner'; END IF;
 IF NOT EXISTS(select 1 from public.stock_items where id=v_item and quantity=8)
 THEN RAISE EXCEPTION 'Staff cash did not decrement exact stock once'; END IF;
 IF public.pos_staff_complete_cash(v_shift,v_secret,v_checkout,2500,'{}','{}',null) IS DISTINCT FROM v_sale
 THEN RAISE EXCEPTION 'Same-tender repeat did not preserve idempotent sale'; END IF;
 BEGIN
  PERFORM public.pos_staff_complete_cash(v_shift,v_secret,v_checkout,3000,'{}','{}',null);
  RAISE EXCEPTION 'Different tender caused duplicate sale';
 EXCEPTION WHEN others THEN
  IF SQLERRM='Different tender caused duplicate sale' THEN RAISE; END IF;
 END;
 v_grant:=public.pos_handoff_verify_paid(v_checkout,v_shift,v_secret);
 IF v_grant->>'completed' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Cash alone was treated as finished order'; END IF;
 PERFORM set_config('request.jwt.claim.sub',v_outsider::text,true);
 BEGIN
  PERFORM public.pos_staff_finish_order(v_shift,v_secret,v_checkout);
  RAISE EXCEPTION 'Other employee finished original sale';
 EXCEPTION WHEN others THEN
  IF SQLERRM='Other employee finished original sale' THEN RAISE; END IF;
 END;
 PERFORM set_config('request.jwt.claim.sub',v_staff::text,true);
 IF public.pos_staff_finish_order(v_shift,v_secret,v_checkout) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'Authorized staff could not finish sale'; END IF;
 IF public.pos_staff_finish_order(v_shift,v_secret,v_checkout) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'Repeated Finish Order not idempotent'; END IF;
 v_grant:=public.pos_handoff_verify_paid(v_checkout,v_shift,v_secret);
 IF v_grant->>'completed' IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'Completed staff cash sale not server verified'; END IF;

 PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
 IF public.pos_staff_set_register_access(v_reg,v_staff,false) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'Owner failed to revoke cashier access'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.pos_checkout_handoffs
  WHERE checkout_id=v_checkout AND phase='closed' AND capability_digest IS NULL)
 THEN RAISE EXCEPTION 'Owner grant revocation did not destroy active guest token'; END IF;
 BEGIN
  PERFORM public.pos_handoff_guest_view(v_checkout,v_token);
  RAISE EXCEPTION 'Revoked guest token remained valid';
 EXCEPTION WHEN others THEN
  IF SQLERRM='Revoked guest token remained valid' THEN RAISE; END IF;
 END;
 PERFORM set_config('request.jwt.claim.sub',v_staff::text,true);
 BEGIN
  PERFORM public.pos_staff_begin_checkout(v_shift,v_secret,v_reg,v_items,0,0,null);
  RAISE EXCEPTION 'Revoked cashier created another checkout';
 EXCEPTION WHEN others THEN
  IF SQLERRM='Revoked cashier created another checkout' THEN RAISE; END IF;
 END;
 RAISE NOTICE 'PASS: independent staff checkout, guest submit, original badge, shift-bound staff cash, stock, idempotent finish, revocation';
END $test$;
ROLLBACK;

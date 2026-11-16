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
 PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
 IF public.pos_staff_set_register_access(v_reg,v_staff,false) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'Owner failed to revoke cashier access'; END IF;
 PERFORM set_config('request.jwt.claim.sub',v_staff::text,true);
 BEGIN
  PERFORM public.pos_staff_begin_checkout(v_shift,v_secret,v_reg,v_items,0,0,null);
  RAISE EXCEPTION 'Revoked cashier created another checkout';
 EXCEPTION WHEN others THEN
  IF SQLERRM='Revoked cashier created another checkout' THEN RAISE; END IF;
 END;
 RAISE NOTICE 'PASS: independent cashier account, owner grant, pricing, discount, revocation';
END $test$;
ROLLBACK;

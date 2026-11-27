\set ON_ERROR_STOP on
-- Run ONLY against a fresh disposable PostgreSQL database, never production.
-- The assertions deliberately use artificial stock, customers and order IDs.
BEGIN;
DO $guard$ BEGIN IF current_database() <> 'holiday_checkout_test' OR to_regnamespace('holiday_shop') IS NOT NULL THEN RAISE EXCEPTION 'Use a fresh disposable holiday_checkout_test database only'; END IF; END $guard$;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA holiday_shop;
CREATE TABLE holiday_shop.orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid UNIQUE NOT NULL, fingerprint text NOT NULL, customer_id uuid, contact_name text, email text, phone text, fulfillment text CONSTRAINT orders_fulfillment_check CHECK(fulfillment IN ('pickup','delivery')), address text, total int NOT NULL DEFAULT 0, paid int NOT NULL DEFAULT 0, refunded int NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'reserved', created_at timestamptz DEFAULT now(), expires_at timestamptz, estimated_date date
);
CREATE TABLE public.stock_items(id uuid PRIMARY KEY, product_name text, color text, size text, quantity int CHECK(quantity>=0), updated_at timestamptz DEFAULT now());
CREATE TABLE public.pos_variant_details(stock_id uuid PRIMARY KEY);
CREATE TABLE public.inventory_catalog(name text PRIMARY KEY,is_active bool,inventory_type text,price_cents int);
CREATE TABLE holiday_shop.variants(stock_id uuid PRIMARY KEY,unit_cost int);
CREATE TABLE holiday_shop.lines(order_id uuid,stock_id uuid,name text,color text,size text,qty int,unit_price int,unit_cost int,returned int DEFAULT 0,PRIMARY KEY(order_id,stock_id));
CREATE TABLE holiday_shop.mail(order_id uuid,kind text,sent_at timestamptz,retry_at timestamptz DEFAULT now(),attempts int DEFAULT 0,PRIMARY KEY(order_id,kind));
CREATE TABLE holiday_shop.actions(id uuid PRIMARY KEY,actor uuid,request jsonb,created_at timestamptz);
CREATE TABLE holiday_shop.settings(video_path text,poster_path text);
CREATE TABLE holiday_shop.traffic(resets_at timestamptz);
CREATE FUNCTION holiday_shop.online_opens() RETURNS timestamptz LANGUAGE sql AS 'SELECT now() - interval ''1 hour''';
CREATE FUNCTION holiday_shop.release_order(p_order uuid) RETURNS void LANGUAGE sql AS 'UPDATE public.stock_items s SET quantity=s.quantity+l.qty FROM holiday_shop.lines l WHERE l.order_id=p_order AND l.stock_id=s.id';
\ir ../supabase/migrations/20261127221000_holiday_venmo.sql
INSERT INTO stock_items(id,product_name,color,size,quantity) VALUES ('00000000-0000-4000-8000-000000000001','Test Hoodie','Green','M',12);
INSERT INTO pos_variant_details VALUES('00000000-0000-4000-8000-000000000001');
INSERT INTO inventory_catalog VALUES('Test Hoodie',true,'sales',4000);
INSERT INTO holiday_shop.variants VALUES('00000000-0000-4000-8000-000000000001',1600);
DO $tests$
DECLARE customer uuid:='00000000-0000-4000-8000-000000000011'; other_customer uuid:='00000000-0000-4000-8000-000000000012'; request uuid:='00000000-0000-4000-8000-000000000021'; placed jsonb; replay jsonb; quote jsonb; details jsonb; items jsonb:='[{"id":"00000000-0000-4000-8000-000000000001","qty":3}]'; orderid uuid; rejected boolean;
BEGIN
 IF holiday_shop.shipping_fee(8499,'shipping')<>895 OR holiday_shop.shipping_fee(8500,'shipping')<>0 OR holiday_shop.shipping_fee(8501,'shipping')<>0 OR holiday_shop.shipping_fee(1,'pickup')<>0 THEN RAISE EXCEPTION 'Shipping boundary failed'; END IF;
 IF has_table_privilege('anon','holiday_shop.discount_codes','SELECT') OR has_function_privilege('authenticated','public.holiday_quote(uuid,text,jsonb,text)','EXECUTE') THEN RAISE EXCEPTION 'Direct discount access allowed'; END IF;
 INSERT INTO holiday_shop.discount_codes(code,kind,value,max_uses,per_customer,starts_at,ends_at,active) VALUES ('TEST40','fixed',4000,1,1,now()-interval '1 day',now()+interval '1 day',true);
 quote:=public.holiday_quote(customer,'TEST40',items,'shipping');
 IF quote->>'subtotal'<>'12000' OR quote->>'discount'<>'4000' OR quote->>'shipping'<>'895' OR quote->>'total'<>'8895' THEN RAISE EXCEPTION 'Discount quote failed: %',quote; END IF;
 details:='{"name":"Fixture Customer","email":"fixture@example.invalid","phone":"555-0100","fulfillment":"shipping","method":"venmo","street":"10 Fixture Road","city":"Fixture","state":"NY","zip":"11700","country":"US","expected_subtotal":12000,"expected_discount":4000,"discount_code":"TEST40","gift_message":"Happy holidays"}';
 rejected:=false;
 BEGIN PERFORM public.holiday_order(request,NULL,details,items); EXCEPTION WHEN raise_exception THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Anonymous order accepted'; END IF;
 rejected:=false;
 BEGIN PERFORM public.holiday_order(request,customer,details||'{"expected_discount":10000}',items); EXCEPTION WHEN raise_exception THEN rejected:=true; END;
 IF NOT rejected OR (SELECT quantity FROM stock_items LIMIT 1)<>12 THEN RAISE EXCEPTION 'Tampering not rejected or rollback failed'; END IF;
 placed:=public.holiday_order(request,customer,details,items);orderid:=(placed->>'id')::uuid;
 IF placed->>'total'<>'8895' OR placed->>'discount'<>'4000' OR placed->>'shipping'<>'895' OR (SELECT quantity FROM stock_items LIMIT 1)<>9 THEN RAISE EXCEPTION 'Order totals or stock failed'; END IF;
 replay:=public.holiday_order(request,customer,details,items);
 IF replay->>'id'<>placed->>'id' OR (SELECT quantity FROM stock_items LIMIT 1)<>9 THEN RAISE EXCEPTION 'Idempotent retry failed'; END IF;
 IF jsonb_array_length(public.holiday_account(other_customer))<>0 OR jsonb_array_length(public.holiday_account(customer))<>1 THEN RAISE EXCEPTION 'Account ownership failed'; END IF;
 rejected:=false;
 BEGIN PERFORM public.holiday_quote(other_customer,'TEST40',items,'shipping'); EXCEPTION WHEN raise_exception THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Discount max usage failed'; END IF;
 rejected:=false;
 BEGIN PERFORM public.holiday_manage(customer,gen_random_uuid(),jsonb_build_object('action','ship','order',orderid,'carrier','USPS','tracking','TEST12345')); EXCEPTION WHEN raise_exception THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Unpaid shipment accepted'; END IF;
 PERFORM public.holiday_manage(customer,gen_random_uuid(),jsonb_build_object('action','paid','order',orderid,'method','venmo','cents',8895));
 PERFORM public.holiday_manage(customer,gen_random_uuid(),jsonb_build_object('action','ready','order',orderid));
 PERFORM public.holiday_manage(customer,gen_random_uuid(),jsonb_build_object('action','ship','order',orderid,'carrier','USPS','tracking','TEST12345'));
 IF (SELECT tracking_number FROM holiday_shop.orders WHERE id=orderid)<>'TEST12345' OR (SELECT status FROM holiday_shop.orders WHERE id=orderid)<>'fulfilled' THEN RAISE EXCEPTION 'Shipment recording failed'; END IF;
 IF (SELECT gift_message FROM holiday_shop.orders WHERE id=orderid)<>'Happy holidays' OR (SELECT count(*) FROM holiday_shop.mail WHERE order_id=orderid)<>2 THEN RAISE EXCEPTION 'Gift or order email outbox failed'; END IF;
 RAISE NOTICE 'All isolated holiday checkout assertions passed';
END $tests$;
ROLLBACK;

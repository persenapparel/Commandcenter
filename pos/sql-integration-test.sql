-- End-to-end POS cash/stock/receipt integration test in disposable PostgreSQL.
-- Requires sql-integration-bootstrap.sql and pos-schema-review.sql, never production.
\set ON_ERROR_STOP on

-- Assert secure DEFAULTS before temporarily enabling customer RPCs for this isolated CI fixture.
select 1/(case when NOT has_function_privilege('anon','public.pos_begin_checkout(uuid,jsonb,integer,integer,uuid)','EXECUTE') then 1 else 0 end) as anon_cannot_begin_sale;
select 1/(case when NOT has_function_privilege('anon','public.pos_complete_cash(uuid,integer,jsonb,jsonb,integer)','EXECUTE') then 1 else 0 end) as anon_cannot_settle_cash;
select 1/(case when has_function_privilege('anon','public.pos_customer_view(uuid)','EXECUTE') then 1 else 0 end) as token_customer_rpc_enabled;
select 1/(case when NOT has_function_privilege('anon','public.pos_issue_display_pairing(uuid)','EXECUTE') then 1 else 0 end) as anonymous_cannot_issue_pairing;

set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
insert into public.pos_registers(id,owner_id,label) values
('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','SQL test register');
insert into public.pos_variant_details(stock_id,price_cents,taxable,category,product_type)
 values('22222222-2222-4222-8222-222222222222',2500,true,'Apparel','hoodie');
insert into public.pos_events(id,owner_id,name,event_date,status)
 values('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','Test fair',current_date,'open');

-- A newly created register secret must not work until owner issues a temporary pair.
select display_secret as old_secret from public.pos_registers
where id='33333333-3333-4333-8333-333333333333' \gset
select 1/(case when public.pos_customer_view(:'old_secret'::uuid)->>'status'='unpaired' then 1 else 0 end) as permanent_link_disabled;
select public.pos_issue_display_pairing('33333333-3333-4333-8333-333333333333'::uuid) as secret \gset

select public.pos_begin_checkout(
'33333333-3333-4333-8333-333333333333',
'[{"stock_id":"22222222-2222-4222-8222-222222222222","qty":1,"unit_cents":2500,"taxable":true,"service":"Apparel"}]'::jsonb,
0,0,'44444444-4444-4444-8444-444444444444') as checkout \gset

set role anon;
select set_config('request.jwt.claim.sub','',false);
select 1/(case when public.pos_customer_view(:'secret'::uuid)->>'status'='awaiting_customer' then 1 else 0 end) as paired_customer;
select 1/(case when public.pos_customer_view('00000000-0000-4000-8000-000000000000'::uuid)->>'status'='unpaired' then 1 else 0 end) as unknown_device;
select public.pos_set_customer_progress(:'secret'::uuid,:'checkout'::uuid,'email',true);
-- Owner query below verifies progress (anonymous role must not read private checkouts).
select public.pos_submit_customer(:'secret'::uuid,:'checkout'::uuid,
  '(631) 555-0137','test-buyer@example.test',false,null,'maybe','cash',true,true);

set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select 1/(case when customer_step='review' and help_requested=false and receipt_print and receipt_email and status='contact_received' then 1 else 0 end) as customer_choices
from public.pos_checkouts where id=:'checkout'::uuid;

select public.pos_set_cash_drawer(
 '33333333-3333-4333-8333-333333333333',
 '{"1000":1,"500":1}'::jsonb,0);
select 1/(case when drawer_configured and drawer_version=1 then 1 else 0 end) as drawer_ready
from public.pos_registers where id='33333333-3333-4333-8333-333333333333';

select public.pos_complete_cash(
 :'checkout'::uuid,4000,'{"2000":2}'::jsonb,
 '{"1000":1,"500":1}'::jsonb,1) as sale \gset

select 1/(case when total_cents=2500 and tendered_cents=4000 and change_cents=1500 and payment_method='cash' then 1 else 0 end) as settled
from public.pos_sales where id=:'sale'::uuid;
select 1/(case when quantity=4 then 1 else 0 end) as stock_deducted
from public.stock_items where id='22222222-2222-4222-8222-222222222222';
select 1/(case when count(*)=1 then 1 else 0 end) as print_queued
from public.pos_print_jobs where sale_id=:'sale'::uuid and state='queued';
select id as job from public.pos_print_jobs where sale_id=:'sale'::uuid \gset
select 1/(case when (public.pos_claim_print_job(:'job'::uuid)->>'sale_id')::uuid=:'sale'::uuid then 1 else 0 end) as printer_claimed;
select 1/(case when public.pos_claim_print_job(:'job'::uuid) is null then 1 else 0 end) as cannot_double_claim;
select 1/(case when public.pos_finish_print_job(:'job'::uuid,null) then 1 else 0 end) as handed_to_browser;
select 1/(case when state='submitted_to_browser' then 1 else 0 end) as browser_submitted_not_physical
from public.pos_print_jobs where id=:'job'::uuid;
select 1/(case when count(*)=1 then 1 else 0 end) as email_queued
from public.pos_receipt_delivery_jobs where sale_id=:'sale'::uuid and channel='email';
select 1/(case when drawer_version=2 then 1 else 0 end) as cash_float_reconciled
from public.pos_registers where id='33333333-3333-4333-8333-333333333333';

-- Repeated submit with same tender does not record a second transaction.
select 1/(case when public.pos_complete_cash(
 :'checkout'::uuid,4000,'{"2000":2}'::jsonb,
 '{"1000":1,"500":1}'::jsonb,1)=:'sale'::uuid then 1 else 0 end) as retry_idempotent;
select 1/(case when count(*)=1 then 1 else 0 end) as no_duplicate_sales
 from public.pos_sales where checkout_id=:'checkout'::uuid;

-- Closing an event preserves its previous sales and blocks new sales assigned to it.
update public.pos_events set status='closed' where id='44444444-4444-4444-8444-444444444444';
do $$
declare rejected boolean:=false;
begin
 begin
  perform public.pos_begin_checkout(
   '33333333-3333-4333-8333-333333333333',
   '[{"stock_id":"22222222-2222-4222-8222-222222222222","qty":1,"unit_cents":2500}]'::jsonb,
   0,0,'44444444-4444-4444-8444-444444444444');
 exception when others then rejected:=true; end;
 if not rejected then raise exception 'Closed event unexpectedly accepted a new sale'; end if;
end $$;

-- A second sale must not complete with too little cash or impossible change.
select public.pos_begin_checkout(
'33333333-3333-4333-8333-333333333333',
'[{"stock_id":"22222222-2222-4222-8222-222222222222","qty":1,"unit_cents":2500,"taxable":true,"service":"Apparel"}]'::jsonb,
0,0,null) as second_checkout \gset
set role anon;
select set_config('request.jwt.claim.sub','',false);
select public.pos_submit_customer(:'secret'::uuid,:'second_checkout'::uuid,
 '(631) 555-0188',null,false,null,'no','cash',true,false);
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $$
declare target_checkout uuid; failures integer:=0;
begin
 select c.id into target_checkout from public.pos_checkouts c
 where c.status='contact_received' and c.register_id='33333333-3333-4333-8333-333333333333' limit 1;
 begin
  perform public.pos_complete_cash(target_checkout,1000,'{"1000":1}'::jsonb,'{}'::jsonb,2);
 exception when others then failures:=failures+1; end;
 begin
  perform public.pos_complete_cash(target_checkout,10000,'{"10000":1}'::jsonb,'{}'::jsonb,2);
 exception when others then failures:=failures+1; end;
 if failures<>2 then raise exception 'Expected two cash rejections, got %',failures; end if;
end $$;
select 1/(case when quantity=4 then 1 else 0 end) as failed_checkouts_do_not_deduct_stock
 from public.stock_items where id='22222222-2222-4222-8222-222222222222';
select 1/(case when count(*)=1 then 1 else 0 end) as no_extra_sales from public.pos_sales;
select 1/(case when not has_table_privilege('anon','public.pos_sales','SELECT') then 1 else 0 end) as anon_cannot_read_sales;
-- Expiry must close even a formerly valid device link.
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
update public.pos_registers set display_expires_at=now()-interval '1 second'
where id='33333333-3333-4333-8333-333333333333';
set role anon;
select set_config('request.jwt.claim.sub','',false);
select 1/(case when public.pos_customer_view(:'secret'::uuid)->>'status'='unpaired' then 1 else 0 end) as expired_pairing_rejected;

-- Simulate stock changing after the customer has already finished checkout.
reset role;
begin;
update public.stock_items set quantity=0 where id='22222222-2222-4222-8222-222222222222';
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare target_checkout uuid;
begin
 select c.id into strict target_checkout from public.pos_checkouts c
 where c.status='contact_received' and c.register_id='33333333-3333-4333-8333-333333333333';
 begin
  perform public.pos_complete_cash(target_checkout,2500,'{}','{}',2);
  raise exception 'Sold stock that was no longer available';
 exception when raise_exception then
  if sqlerrm<>'Stock changed; cancel and rebuild checkout' then raise; end if;
 end;
end $$;
select 1/(case when drawer_version=2 then 1 else 0 end) as failed_stock_deduction_rolled_back_drawer
 from public.pos_registers where id='33333333-3333-4333-8333-333333333333';
select 1/(case when count(*)=1 then 1 else 0 end) as stock_change_did_not_create_sale from public.pos_sales;
rollback;

reset role;
begin;
insert into public.stock_items(id,sku,product_name,color,size,quantity) values
 ('22222222-2222-4222-8222-222222222223','POS-TEST-UNPRICED','Unpriced Sale Item','Red','S',5),
 ('22222222-2222-4222-8222-222222222224','POS-TEST-BLANK','Blank Garment','White','M',5),
 ('22222222-2222-4222-8222-222222222225','POS-TEST-INACTIVE','Inactive Sale Item','Red','L',5),
 ('22222222-2222-4222-8222-222222222226','POS-TEST-LEGACY','Unclassified Sale Item','Red','XL',5);
insert into public.inventory_catalog(name,inventory_type,price_cents,is_active) values
 ('POS Integration Hoodie','sales',61,true),
 ('Unpriced Sale Item','sales',null,true),
 ('Blank Garment','blanks',2500,true),
 ('Inactive Sale Item','sales',2500,false);
insert into public.pos_variant_details(stock_id,price_cents) values
 ('22222222-2222-4222-8222-222222222223',0),('22222222-2222-4222-8222-222222222226',2500);

set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
insert into public.pos_registers(id,owner_id,label) values
 ('33333333-3333-4333-8333-333333333334','11111111-1111-4111-8111-111111111111','Checkout guard fixture');

do $$
declare
 guard record;
 register_id constant uuid:='33333333-3333-4333-8333-333333333334';
 stock_id constant uuid:='22222222-2222-4222-8222-222222222222';
 checkout_id uuid;
begin
 for guard in select * from (values
  (stock_id,2500,true,'Product price or tax status changed. Refresh products and re-add the item.'),
  (stock_id,61,false,'Product price or tax status changed. Refresh products and re-add the item.'),
  ('22222222-2222-4222-8222-222222222223'::uuid,0,true,'Set a selling price for this product before checkout'),
  ('22222222-2222-4222-8222-222222222224'::uuid,2500,true,'This item is not an active Sales Product'),
  ('22222222-2222-4222-8222-222222222225'::uuid,2500,true,'This item is not an active Sales Product'),
  ('22222222-2222-4222-8222-222222222226'::uuid,2500,true,'This item is not an active Sales Product')
 ) as cases(id,price,taxable,message) loop
  begin
   perform public.pos_begin_checkout(register_id,
    jsonb_build_array(jsonb_build_object('stock_id',guard.id,'qty',1,'unit_cents',guard.price,'taxable',guard.taxable)));
   raise exception 'Checkout guard failed to reject an invalid stock line';
  exception when raise_exception then
   if sqlerrm<>guard.message then raise; end if;
  end;
 end loop;
 checkout_id:=public.pos_begin_checkout(register_id,
  jsonb_build_array(jsonb_build_object('stock_id',stock_id,'qty',1,'unit_cents',61,'taxable',true),
    jsonb_build_object('name','Tax-exempt fixture','qty',1,'unit_cents',50,'taxable',false)),1500,8750);
 if not exists(select 1 from public.pos_checkouts c where c.id=checkout_id and
  c.subtotal_cents=111 and c.discount_cents=17 and c.tax_cents=5 and c.total_cents=99) then
  raise exception 'Mixed discounted checkout disagreed with the cashier cart';
 end if;
end $$;

select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111112',true);
select 1/(case when count(*)=0 then 1 else 0 end) as non_admin_cannot_read_checkouts from public.pos_checkouts;
do $$
begin
 begin
  perform public.pos_begin_checkout('33333333-3333-4333-8333-333333333334',
   '[{"name":"Non-admin fixture","qty":1,"unit_cents":100}]'::jsonb);
  raise exception 'Non-admin started a checkout';
 exception when raise_exception then
  if sqlerrm<>'Unauthorized' then raise; end if;
 end;
end $$;
rollback;

\echo 'POS staged PostgreSQL checkout integration PASS (never connected to production)'

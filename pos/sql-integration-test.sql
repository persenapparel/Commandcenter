-- End-to-end POS cash/stock/receipt integration test in disposable PostgreSQL.
-- Requires sql-integration-bootstrap.sql and pos-schema-review.sql, never production.
\set ON_ERROR_STOP on

set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
insert into public.pos_registers(id,owner_id,label) values
('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','SQL test register');
insert into public.pos_variant_details(stock_id,price_cents,taxable,category,product_type)
 values('22222222-2222-4222-8222-222222222222',2500,true,'Apparel','hoodie');
insert into public.pos_events(id,owner_id,name,event_date,status)
 values('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','Test fair',current_date,'open');

select display_secret as secret from public.pos_registers
where id='33333333-3333-4333-8333-333333333333' \gset

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
declare id uuid; failures integer:=0;
begin
 select id into id from public.pos_checkouts
 where status='contact_received' and register_id='33333333-3333-4333-8333-333333333333' limit 1;
 begin
  perform public.pos_complete_cash(id,1000,'{"1000":1}'::jsonb,'{}'::jsonb,2);
 exception when others then failures:=failures+1; end;
 begin
  perform public.pos_complete_cash(id,10000,'{"10000":1}'::jsonb,'{}'::jsonb,2);
 exception when others then failures:=failures+1; end;
 if failures<>2 then raise exception 'Expected two cash rejections, got %',failures; end if;
end $$;
select 1/(case when quantity=4 then 1 else 0 end) as failed_checkouts_do_not_deduct_stock
 from public.stock_items where id='22222222-2222-4222-8222-222222222222';
select 1/(case when count(*)=1 then 1 else 0 end) as no_extra_sales from public.pos_sales;
select 1/(case when not has_table_privilege('anon','public.pos_sales','SELECT') then 1 else 0 end) as anon_cannot_read_sales;
\echo 'POS staged PostgreSQL checkout integration PASS (never connected to production)'

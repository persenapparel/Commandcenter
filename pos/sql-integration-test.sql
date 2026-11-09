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

\echo 'POS staged PostgreSQL checkout integration PASS (never connected to production)'

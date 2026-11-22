-- Persen POS live-sales release audit (READ ONLY).
-- Run against the DEDICATED POS database, not the Command Center production DB.
-- Never select customer, payment, employee badge or PIN records.
-- BLOCKED prevents a real-customer launch; HOLD_MANUAL means supervised tests required.
with
required_rpcs(kind,signature) as (
 values
 ('staff login','public.pos_staff_start_shift(text,text,uuid)'),
 ('staff unlock','public.pos_staff_resume_shift(uuid,text,text,uuid)'),
 ('staff checkout','public.pos_staff_begin_checkout(uuid,text,uuid,jsonb,integer,integer,uuid)'),
 ('cash settlement','public.pos_staff_complete_cash(uuid,text,uuid,integer,jsonb,jsonb,integer)'),
 ('finish sale','public.pos_staff_finish_order(uuid,text,uuid)'),
 ('guest handoff','public.pos_handoff_issue_guest(uuid,uuid,text)'),
 ('guest return','public.pos_handoff_resume(uuid,uuid,text,text)'),
 ('verify payment','public.pos_handoff_verify_paid(uuid,uuid,text)'),
 ('external verification','public.pos_owner_confirm_external_payment(uuid,text,text,boolean,boolean)')
), rpc_checks as (
 select 'rpc:'||kind as check_name,
 case
  when to_regprocedure(signature) is null then 'BLOCKED'
  when coalesce(has_function_privilege('anon',to_regprocedure(signature),'EXECUTE'),false) then 'BLOCKED'
  when not coalesce(has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE'),false) then 'BLOCKED'
  else 'PASS'
 end as status,
 case
  when to_regprocedure(signature) is null then 'Required signed-in function missing'
  when coalesce(has_function_privilege('anon',to_regprocedure(signature),'EXECUTE'),false) then 'Anonymous role can call a privileged function'
  when not coalesce(has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE'),false) then 'Authenticated call permission missing'
  else 'Expected signed-in function is available and not anonymously executable; business logic still needs review'
 end as detail from required_rpcs
), required_tables(table_name) as (
 values ('pos_sales'),('pos_checkouts'),('pos_checkout_handoffs'),
 ('pos_print_jobs'),('pos_drawer_open_jobs'),('pos_staff_credentials'),
 ('pos_staff_shifts'),('pos_staff_register_grants'),('pos_external_payment_approvals')
), table_checks as (
 select 'rls:'||t.table_name as check_name,
 case when c.oid is null or not c.relrowsecurity then 'BLOCKED' else 'PASS' end as status,
 case when c.oid is null then 'Required table absent'
      when not c.relrowsecurity then 'RLS disabled'
      else 'RLS enabled; grants, policies and RPC body checks still required' end as detail
 from required_tables t
 left join pg_class c on c.relname=t.table_name
  and c.relnamespace='public'::regnamespace and c.relkind in ('r','p')
), guest_rpcs(signature) as (
 values ('public.pos_handoff_guest_view(uuid,text)'),
        ('public.pos_handoff_guest_submit(uuid,text,jsonb)')
), guest_checks as (
 select 'guest-worker:'||signature as check_name,
 case when to_regprocedure(signature) is null then 'BLOCKED'
      when coalesce(has_function_privilege('anon',to_regprocedure(signature),'EXECUTE'),false)
        or coalesce(has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE'),false) then 'BLOCKED'
      when not coalesce(has_function_privilege('service_role',to_regprocedure(signature),'EXECUTE'),false) then 'BLOCKED'
      else 'PASS' end as status,
 'Guest capability RPC must be callable only by the protected worker service role' as detail
 from guest_rpcs
), legacy_guest_rpcs(signature) as (
 values ('public.pos_customer_cart_preview(uuid)'),
 ('public.pos_customer_view(uuid)'),
 ('public.pos_set_customer_progress(uuid,uuid,text,boolean)'),
 ('public.pos_submit_customer(uuid,uuid,text,text,boolean,integer,text,text,boolean,boolean)'),
 ('public.pos_submit_customer_v2(uuid,uuid,text,text,text,integer,text,text,boolean,boolean)')
), legacy_checks as (
 select 'legacy-guest:'||signature as check_name,
 case when to_regprocedure(signature) is null then 'PASS'
      when coalesce(has_function_privilege('anon',to_regprocedure(signature),'EXECUTE'),false)
      then 'BLOCKED' else 'PASS' end as status,
 'Legacy anonymous guest RPC must be retired or independently security reviewed before opening real sales' as detail
 from legacy_guest_rpcs
), manual_features as (
 select 'manual-adjustments:refunds-returns-exchanges'::text as check_name,
 'HOLD_MANUAL'::text as status,
 'Do not enable until supervised end-to-end refund, return and equal-value exchange tests, including stock and cash reconciliation, pass'::text as detail
)
select check_name,status,detail from (
 select * from rpc_checks
 union all select * from table_checks
 union all select * from guest_checks
 union all select * from legacy_checks
 union all select * from manual_features
) checks
order by case status when 'BLOCKED' then 0 when 'HOLD_MANUAL' then 1 else 2 end,check_name;

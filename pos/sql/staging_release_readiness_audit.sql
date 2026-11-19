-- READ-ONLY staging readiness audit (NOT a migration).
-- Run only against Supabase project naaqcspvbntzdtwuchrr.
-- Does not select employee rows, credential hashes, tokens, PINs, customer
-- data, sales, inventory or payment information.
-- Any BLOCKED result prevents employee rollout and real customer checkout.
with expected(name,signature) as (
 values
 ('owner_badge_enroll_scoped','public.pos_owner_enroll_badge(integer,text,text,text,text,text,uuid)'),
 ('owner_badge_scoped_status','public.pos_owner_badge_slot_status(integer,uuid)'),
 ('credential_register_access','public.pos_owner_set_badge_register_access(uuid,uuid,boolean)'),
 ('owner_unpaid_checkout_recovery','public.pos_owner_recover_unpaid_staging_checkout(uuid,text,text)')
), found as (
 select e.name,e.signature,to_regprocedure(e.signature) as function_oid
 from expected e
), security_checks as (
 select
  'rpc:'||name as check_name,
  case
   when function_oid is null then 'BLOCKED'
   when coalesce(has_function_privilege('anon',function_oid,'EXECUTE'),false)
     then 'BLOCKED'
   when not coalesce(has_function_privilege('authenticated',function_oid,'EXECUTE'),false)
     then 'BLOCKED'
   else 'PRESENT'
  end as status,
  case
   when function_oid is null then 'Reviewed staging function not installed'
   when coalesce(has_function_privilege('anon',function_oid,'EXECUTE'),false)
     then 'Anonymous EXECUTE must be revoked'
   when not coalesce(has_function_privilege('authenticated',function_oid,'EXECUTE'),false)
     then 'Authenticated EXECUTE grant missing'
   else 'Function present, authenticated EXECUTE only; body/owner checks require independent review'
  end as detail
 from found
), retired as (
 select 'legacy:'||old.name as check_name,
  case when to_regprocedure(old.signature) is not null
       and coalesce(has_function_privilege('authenticated',to_regprocedure(old.signature),'EXECUTE'),false)
       then 'BLOCKED' else 'PRESENT' end as status,
  case when to_regprocedure(old.signature) is not null
       and coalesce(has_function_privilege('authenticated',to_regprocedure(old.signature),'EXECUTE'),false)
       then 'Deprecated owner-wide function remains callable by authenticated role'
       else 'Deprecated function absent or authenticated EXECUTE revoked' end as detail
 from (values
  ('six_argument_owner_enroll','public.pos_owner_enroll_badge(integer,text,text,text,text,text)'),
  ('user_id_register_grants','public.pos_staff_set_register_access(uuid,uuid,boolean)')
 ) old(name,signature)
), rls as (
 select 'rls:'||requirements.table_name as check_name,
  case when c.oid is null or c.relrowsecurity is not true then 'BLOCKED' else 'PRESENT' end as status,
  case when c.oid is null then 'Required staging table not installed'
       when c.relrowsecurity is not true then 'Row-level security is disabled'
       else 'Row-level security enabled; policies require separate authorization review' end as detail
 from (values
  ('pos_staff_credentials'),
  ('pos_staff_register_grants'),
  ('pos_staff_shifts'),
  ('pos_checkout_handoffs')
 ) requirements(table_name)
 left join pg_class c on c.relname=requirements.table_name
  and c.relnamespace='public'::regnamespace and c.relkind in ('r','p')
)
select check_name,status,detail
from (
 select * from security_checks
 union all select * from retired
 union all select * from rls
) checks
order by case status when 'BLOCKED' then 0 else 1 end,check_name;

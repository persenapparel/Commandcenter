-- Postgres 17 isolated schema smoke test; no cash sales or real credentials.
do $test$
begin
 if not exists(select 1 from pg_trigger where tgname='pos_saved_sale_drawer_job' and not tgisinternal) then
  raise exception 'Cash-sale drawer trigger missing';
 end if;
 if not exists(select 1 from pg_class where oid='public.pos_drawer_open_jobs'::regclass and relrowsecurity) then
  raise exception 'Drawer jobs must enforce RLS';
 end if;
 if not exists(select 1 from pg_class where oid='public.pos_drawer_credentials'::regclass and relrowsecurity) then
  raise exception 'Owner credentials must enforce RLS';
 end if;
 if has_function_privilege('anon','public.pos_authorize_manual_drawer(uuid,text,text,text)','EXECUTE') then
  raise exception 'Anonymous manual drawer RPC access forbidden';
 end if;
 if has_function_privilege('anon','public.pos_claim_drawer_open_job(uuid)','EXECUTE') then
  raise exception 'Anonymous drawer queue claim forbidden';
 end if;
 if has_table_privilege('authenticated','public.pos_drawer_credentials','SELECT') then
  raise exception 'Credential hashes may not be exposed to clients';
 end if;
 if not exists(select 1 from pg_indexes where schemaname='public' and indexname='pos_drawer_open_cash_once') then
  raise exception 'Duplicate cash-sale kick guard missing';
 end if;
end $test$;

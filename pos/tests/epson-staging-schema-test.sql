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

-- Exercise sale-trigger -> atomic claim -> one-shot finish, and failed/successful owner verification.
begin;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $cash_drawer_test$
declare
 reg uuid;
 checkout uuid;
 sale uuid;
 auto_job uuid;
 manual_job uuid;
 claim jsonb;
begin
 insert into public.pos_registers(owner_id,label)
 values('11111111-1111-4111-8111-111111111111','Epson isolated test')
 returning id into reg;
 insert into public.pos_checkouts(register_id,owner_id,status,items,total_cents,phone,payment_preference)
 values(reg,'11111111-1111-4111-8111-111111111111','completed','[]'::jsonb,1000,'6315550100','cash')
 returning id into checkout;
 insert into public.pos_sales(checkout_id,owner_id,snapshot,subtotal_cents,discount_cents,tax_cents,total_cents,payment_method,tendered_cents,change_cents)
 values(checkout,'11111111-1111-4111-8111-111111111111',jsonb_build_object('items','[]'::jsonb),1000,0,0,1000,'cash',2000,1000)
 returning id into sale;
 select id into auto_job from public.pos_drawer_open_jobs where sale_id=sale;
 if auto_job is null then raise exception 'Saved cash sale did not queue a drawer command'; end if;
 if (select count(*) from public.pos_drawer_open_jobs where sale_id=sale) <> 1 then
  raise exception 'Duplicate auto-open drawer command';
 end if;
 claim:=public.pos_claim_drawer_open_job(auto_job);
 if claim->>'kind' <> 'cash-sale' then raise exception 'Cash job claim failed'; end if;
 if public.pos_claim_drawer_open_job(auto_job) is not null then raise exception 'Repeat drawer claim allowed'; end if;
 if not public.pos_finish_drawer_open_job(auto_job,true) then raise exception 'Drawer job acknowledgement failed'; end if;
 if public.pos_finish_drawer_open_job(auto_job,true) then raise exception 'Repeated finish succeeded'; end if;
 if public.pos_set_owner_drawer_credential('pin','12345678') is distinct from true then
  raise exception 'Owner PIN enrollment failed';
 end if;
 if public.pos_authorize_manual_drawer(reg,'cash-count','pin','000000') is not null then
  raise exception 'Wrong owner PIN unlocked drawer';
 end if;
 manual_job:=public.pos_authorize_manual_drawer(reg,'cash-count','pin','12345678');
 if manual_job is null then raise exception 'Correct owner PIN failed'; end if;
 if (select kind from public.pos_drawer_open_jobs where id=manual_job) <> 'owner-manual' then
  raise exception 'Manual opening was not properly audited';
 end if;
end $cash_drawer_test$;
rollback;

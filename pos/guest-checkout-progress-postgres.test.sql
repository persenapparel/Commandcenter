-- READ-ONLY ASSERTIONS. Execute only in disposable isolated PostgreSQL after
-- applying the full guest capability + progress migration stack.
-- psql -v ON_ERROR_STOP=1 -f pos/guest-checkout-progress-postgres.test.sql
begin;
do $$
declare v_oid oid;
begin
 select 'public.pos_guest_checkout_set_progress(text,text,boolean)'::regprocedure::oid into v_oid;
 if not exists (
  select 1 from pg_proc p where p.oid=v_oid and p.prosecdef
    and p.proconfig @> array['search_path=']
 ) then raise exception 'Guest progress must be SECURITY DEFINER with empty search_path'; end if;
 if has_function_privilege('anon',v_oid,'EXECUTE')
    or has_function_privilege('authenticated',v_oid,'EXECUTE')
    or exists (select 1 from pg_proc p where p.oid=v_oid and has_function_privilege(v_oid,'EXECUTE') and (select bool_or(x.grantee=0 and (x.privilege_type='EXECUTE')) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x)) then
   raise exception 'Guest progress is publicly executable'; end if;
 if not exists (
  select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='pos_guest_checkout_progress_limits'
    and c.relrowsecurity
 ) then raise exception 'Guest progress limits lack RLS'; end if;
 if has_table_privilege('anon','public.pos_guest_checkout_progress_limits','SELECT')
    or has_table_privilege('authenticated','public.pos_guest_checkout_progress_limits','INSERT')
    or has_table_privilege('authenticated','public.pos_guest_checkout_progress_limits','UPDATE') then
   raise exception 'Guest progress limits exposed'; end if;
 if exists (
  select 1 from pg_policies
  where schemaname='public' and tablename='pos_guest_checkout_progress_limits'
 ) then raise exception 'Guest progress limits must not expose row policies'; end if;
 if not exists (
  select 1 from pg_constraint con
  where con.conrelid='public.pos_guest_checkout_progress_limits'::regclass
    and con.contype='f' and con.confrelid='public.pos_guest_checkout_capabilities'::regclass
 ) then raise exception 'Guest progress limiter not bound to capability'; end if;
end $$;
rollback;

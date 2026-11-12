-- STAGING ONLY: temporary rotating pairing credentials for a customer iPad.
-- Never run against production; do not publish without Cloudflare Access.
-- Every pair click rotates the previous credential; links expire after two hours.
alter table public.pos_registers
  add column if not exists display_expires_at timestamptz;

-- Invalidates any old permanent pair links before enabling customer access.
update public.pos_registers
  set display_secret = gen_random_uuid(), display_expires_at = null;

create or replace function public.pos_issue_display_pairing(p_register uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare v_id uuid; v_secret uuid;
begin
  if (select auth.uid()) is null or not public.is_persen_admin() then
    raise exception 'Authorized owner required';
  end if;
  select id into v_id
    from public.pos_registers
   where id = p_register and owner_id = (select auth.uid()) and active
   for update;
  if not found then raise exception 'Register unavailable'; end if;
  v_secret := gen_random_uuid();
  update public.pos_registers
     set display_secret = v_secret,
         display_expires_at = now() + interval '2 hours'
   where id = v_id;
  return v_secret;
end;
$$;

-- Enforce expiration inside every privilege-escalating customer endpoint.
-- Preserve the existing audited checkout validation logic.
do $$
declare f record; ddl text; needle text := 'where display_secret=p_secret and active';
begin
  for f in
    select p.oid, p.proname from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in
        ('pos_customer_view','pos_set_customer_progress','pos_submit_customer')
  loop
    ddl := pg_get_functiondef(f.oid);
    if position('display_expires_at > now()' in ddl) > 0 then continue; end if;
    if position(needle in ddl) = 0 then
      raise exception 'Pairing guard not found in %. Review SQL manually.', f.proname;
    end if;
    execute replace(ddl, needle,
      'where display_secret=p_secret and active and display_expires_at > now()');
  end loop;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in
      ('pos_customer_view','pos_set_customer_progress','pos_submit_customer')) <> 3
  then raise exception 'Customer endpoint set incomplete'; end if;
end;
$$;

-- No ambient PUBLIC function EXECUTE. Anon gets only possession-token APIs.
revoke all on function public.pos_issue_display_pairing(uuid) from public,anon,authenticated;
grant execute on function public.pos_issue_display_pairing(uuid) to authenticated;
revoke all on function public.pos_customer_view(uuid) from public,anon,authenticated;
revoke all on function public.pos_set_customer_progress(uuid,uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.pos_submit_customer(uuid,uuid,text,text,boolean,integer,text,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.pos_customer_view(uuid) to anon,authenticated;
grant execute on function public.pos_set_customer_progress(uuid,uuid,text,boolean) to anon,authenticated;
grant execute on function public.pos_submit_customer(uuid,uuid,text,text,boolean,integer,text,text,boolean,boolean) to anon,authenticated;

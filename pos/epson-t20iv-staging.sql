-- Epson TM-T20IV / Volcora drawer queue. DRAFT: apply to the isolated POS staging project ONLY.
-- Prerequisite: existing POS schema + Supabase pgcrypto. No customer data or production changes.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.pos_drawer_credentials(
 owner_id uuid primary key references auth.users(id),
 pin_hash text,
 badge_hash text,
 failures integer not null default 0 check(failures between 0 and 5),
 locked_until timestamptz,
 updated_at timestamptz not null default now()
);
alter table public.pos_drawer_credentials enable row level security;
revoke all on public.pos_drawer_credentials from public,anon,authenticated;

create table if not exists public.pos_drawer_open_jobs(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 sale_id uuid references public.pos_sales(id),
 register_id uuid not null references public.pos_registers(id),
 kind text not null check(kind in ('cash-sale','owner-manual')),
 reason text not null check(reason in ('completed-cash-sale','cash-count','change-float','drawer-reconcile','supervisor-access')),
 state text not null default 'queued' check(state in ('queued','claimed','command-sent','unconfirmed')),
 created_at timestamptz not null default now(),
 claimed_at timestamptz,
 finished_at timestamptz,
 last_error text,
 check((kind='cash-sale' and sale_id is not null and reason='completed-cash-sale') or (kind='owner-manual' and sale_id is null and reason<>'completed-cash-sale'))
);
create unique index if not exists pos_drawer_open_cash_once on public.pos_drawer_open_jobs(sale_id) where sale_id is not null;
create index if not exists pos_drawer_open_owner_queue on public.pos_drawer_open_jobs(owner_id,state,created_at);
alter table public.pos_drawer_open_jobs enable row level security;
revoke all on public.pos_drawer_open_jobs from public,anon,authenticated;
grant select on public.pos_drawer_open_jobs to authenticated;
drop policy if exists pos_drawer_open_owner_read on public.pos_drawer_open_jobs;
create policy pos_drawer_open_owner_read on public.pos_drawer_open_jobs
 for select to authenticated using(owner_id=(select auth.uid()) and public.is_persen_admin());

-- Trigger runs within the same DB transaction as the authoritative saved cash sale.
-- It does NOT depend on a receipt preference, browser tab, reload or client request.
create or replace function pos_internal.enqueue_cash_drawer_job()
returns trigger language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 if new.payment_method <> 'cash' then return new; end if;
 select register_id into rid from public.pos_checkouts where id=new.checkout_id and owner_id=new.owner_id;
 if rid is null then raise exception 'Cash sale has no valid register'; end if;
 insert into public.pos_drawer_open_jobs(owner_id,sale_id,register_id,kind,reason)
 values(new.owner_id,new.id,rid,'cash-sale','completed-cash-sale')
 on conflict do nothing;
 return new;
end $$;
drop trigger if exists pos_saved_sale_drawer_job on public.pos_sales;
create trigger pos_saved_sale_drawer_job after insert on public.pos_sales
 for each row execute function pos_internal.enqueue_cash_drawer_job();

-- Setup must be initiated by the signed-in owner; never store the PIN or barcode plaintext.
-- The scanner badge MUST be a random 24-64-character credential, not the staff ID or PIN.
create or replace function public.pos_set_owner_drawer_credential(p_method text,p_value text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v text;
begin
 if (select auth.uid()) is null or not public.is_persen_admin() then raise exception 'Unauthorized'; end if;
 v:=trim(coalesce(p_value,''));
 if p_method='pin' and v !~ '^[0-9]{6,12}$' then raise exception 'Use a 6-12 digit owner PIN'; end if;
 if p_method='badge' and v !~ '^[A-Za-z0-9_-]{24,64}$' then raise exception 'Badge must be a random 24-64 character code'; end if;
 if p_method not in ('pin','badge') then raise exception 'Unsupported credential type'; end if;
 insert into public.pos_drawer_credentials(owner_id,pin_hash,badge_hash)
 values((select auth.uid()),
        case when p_method='pin' then extensions.crypt(v,extensions.gen_salt('bf',11)) else null end,
        case when p_method='badge' then extensions.crypt(v,extensions.gen_salt('bf',11)) else null end)
 on conflict(owner_id) do update set
 pin_hash=case when p_method='pin' then excluded.pin_hash else public.pos_drawer_credentials.pin_hash end,
 badge_hash=case when p_method='badge' then excluded.badge_hash else public.pos_drawer_credentials.badge_hash end,
 failures=0,locked_until=null,updated_at=now();
 return true;
end $$;

-- Owner login PLUS a valid PIN or registered high-entropy badge is required.
-- Lock the credential row to make rate limiting safe across concurrent devices.
create or replace function public.pos_authorize_manual_drawer(
 p_register uuid,p_reason text,p_method text,p_value text)
returns uuid language plpgsql security definer set search_path='' as $$
declare creds public.pos_drawer_credentials; result_id uuid; hash text; valid boolean:=false;
begin
 if (select auth.uid()) is null or not public.is_persen_admin() then raise exception 'Unauthorized'; end if;
 if p_reason not in ('cash-count','change-float','drawer-reconcile','supervisor-access') then raise exception 'Invalid opening reason'; end if;
 if p_method not in ('pin','badge') or length(coalesce(p_value,''))>128 then raise exception 'Invalid owner verification'; end if;
 if not exists(select 1 from public.pos_registers where id=p_register and owner_id=(select auth.uid()) and active)
 then raise exception 'Register not available'; end if;
 select * into creds from public.pos_drawer_credentials where owner_id=(select auth.uid()) for update;
 if not found or (creds.locked_until is not null and creds.locked_until>now()) then raise exception 'Owner verification unavailable'; end if;
 hash:=case when p_method='pin' then creds.pin_hash else creds.badge_hash end;
 if p_method='pin' and coalesce(p_value,'') ~ '^[0-9]{6,12}$' and hash is not null then
  valid:=extensions.crypt(p_value,hash)=hash;
 elsif p_method='badge' and coalesce(p_value,'') ~ '^[A-Za-z0-9_-]{24,64}$' and hash is not null then
  valid:=extensions.crypt(p_value,hash)=hash;
 end if;
 if not valid then
  update public.pos_drawer_credentials set failures=least(failures+1,5),
   locked_until=case when failures>=4 then now()+interval '15 minutes' else null end where owner_id=(select auth.uid());
  -- Do not raise: a database exception would roll back the rate-limit update.
  return null;
 end if;
 update public.pos_drawer_credentials set failures=0,locked_until=null where owner_id=(select auth.uid());
 insert into public.pos_drawer_open_jobs(owner_id,register_id,kind,reason)
 values((select auth.uid()),p_register,'owner-manual',p_reason) returning id into result_id;
 return result_id;
end $$;

-- Authenticated print station atomically claims one job. A claimed job never auto-retries:
-- uncertain transport must be manually reconciled, not kicked twice.
create or replace function public.pos_claim_drawer_open_job(p_job uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.pos_drawer_open_jobs;
begin
 if (select auth.uid()) is null or not public.is_persen_admin() then raise exception 'Unauthorized'; end if;
 update public.pos_drawer_open_jobs set state='claimed',claimed_at=now()
 where id=p_job and owner_id=(select auth.uid()) and state='queued'
   and created_at > now()-interval '24 hours'
 returning * into j;
 if not found then return null; end if;
 if j.kind='cash-sale' and not exists(
   select 1 from public.pos_sales where id=j.sale_id and owner_id=j.owner_id and payment_method='cash'
 ) then raise exception 'Unverified cash sale'; end if;
 return jsonb_build_object('id',j.id,'kind',j.kind,'reason',j.reason,'sale_id',j.sale_id);
end $$;

create or replace function public.pos_finish_drawer_open_job(p_job uuid,p_command_sent boolean,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
 if (select auth.uid()) is null or not public.is_persen_admin() then raise exception 'Unauthorized'; end if;
 update public.pos_drawer_open_jobs set
 state=case when p_command_sent=true then 'command-sent' else 'unconfirmed' end,
 finished_at=now(),
 last_error=nullif(left(trim(coalesce(p_error,'')),160),'')
 where id=p_job and owner_id=(select auth.uid()) and state='claimed';
 get diagnostics affected=row_count;
 return affected=1;
end $$;

revoke execute on function pos_internal.enqueue_cash_drawer_job() from public,anon,authenticated;
revoke execute on function public.pos_set_owner_drawer_credential(text,text),
 public.pos_authorize_manual_drawer(uuid,text,text,text),
 public.pos_claim_drawer_open_job(uuid),public.pos_finish_drawer_open_job(uuid,boolean,text)
 from public,anon;
grant execute on function public.pos_set_owner_drawer_credential(text,text),
 public.pos_authorize_manual_drawer(uuid,text,text,text),
 public.pos_claim_drawer_open_job(uuid),public.pos_finish_drawer_open_job(uuid,boolean,text)
 to authenticated;

-- Persen POS v1: REVIEW BEFORE APPLYING. No live changes were made by committing this file.
-- Only cash is supported. Never mark electronic payments as paid without provider verification.
-- Financial snapshots are append-only; editable receipt designs live in separate table.
create table if not exists public.pos_registers(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 display_secret uuid not null unique default gen_random_uuid(),
 label text not null default 'Front register' check(length(label) between 1 and 80),
 cash_drawer jsonb not null default '{}'::jsonb,
 drawer_configured boolean not null default false,
 drawer_version integer not null default 0 check(drawer_version>=0),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists public.pos_checkouts(
 id uuid primary key default gen_random_uuid(),
 register_id uuid not null references public.pos_registers(id),
 owner_id uuid not null references auth.users(id),
 status text not null default 'awaiting_customer' check(status in ('awaiting_customer','contact_received','completed','cancelled')),
 items jsonb not null,
 discount_bps integer not null default 0 check(discount_bps between 0 and 10000),
 tax_milli integer not null default 0 check(tax_milli between 0 and 20000),
 subtotal_cents integer not null default 0 check(subtotal_cents>=0),
 discount_cents integer not null default 0 check(discount_cents>=0),
 tax_cents integer not null default 0 check(tax_cents>=0),
 total_cents integer not null default 0 check(total_cents>=0),
 phone text,
 email text,
 marketing_opt_in boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists pos_one_open_checkout on public.pos_checkouts(register_id) where status in ('awaiting_customer','contact_received');
create table if not exists public.pos_sales(
 id uuid primary key default gen_random_uuid(),
 checkout_id uuid not null unique references public.pos_checkouts(id),
 owner_id uuid not null references auth.users(id),
 snapshot jsonb not null,
 subtotal_cents integer not null,
 discount_cents integer not null,
 tax_cents integer not null,
 total_cents integer not null,
 payment_method text not null check(payment_method='cash'),
 tendered_cents integer not null default 0,
 change_cents integer not null default 0,
 change_breakdown jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
-- Pending print jobs are created transactionally with sales.
-- A print station marks jobs as submitted to the local browser, NOT confirmed on paper.
-- Clients cannot directly insert, change sale associations, or change state.
create table if not exists public.pos_print_jobs(
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null unique references public.pos_sales(id),
  owner_id uuid not null references auth.users(id),
  register_id uuid not null references public.pos_registers(id),
  state text not null default 'queued'
    check(state in ('queued','printing','submitted_to_browser','failed')),
  attempts integer not null default 0 check(attempts between 0 and 10),
  claimed_at timestamptz,
  submitted_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists pos_print_jobs_owner_state_created
on public.pos_print_jobs(owner_id,state,created_at);
alter table public.pos_print_jobs enable row level security;
revoke all on public.pos_print_jobs from anon,authenticated;
grant select on public.pos_print_jobs to authenticated;
create policy pos_print_jobs_owner_read on public.pos_print_jobs
for select to authenticated
using(owner_id=(select auth.uid()) and public.is_persen_admin());

-- Events are administrative records. Prior sales retain the event they were recorded under.
create table if not exists public.pos_events(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 name text not null check(length(trim(name)) between 1 and 100),
 event_date date not null,
 venue text not null default '' check(length(venue)<=140),
 status text not null default 'open' check(status in ('open','closed')),
 created_at timestamptz not null default now()
);
alter table public.pos_events enable row level security;
revoke all on public.pos_events from anon,authenticated;
grant select,insert,update on public.pos_events to authenticated;
create policy pos_event_admin_read on public.pos_events for select to authenticated using(public.is_persen_admin());
create policy pos_event_admin_add on public.pos_events for insert to authenticated with check(owner_id=(select auth.uid()) and public.is_persen_admin());
create policy pos_event_admin_edit on public.pos_events for update to authenticated using(owner_id=(select auth.uid()) and public.is_persen_admin()) with check(owner_id=(select auth.uid()) and public.is_persen_admin());
-- POS services are restricted labels for meaningful historical reports.
alter table public.pos_checkouts add column if not exists event_id uuid references public.pos_events(id);
alter table public.pos_sales add column if not exists event_id uuid references public.pos_events(id);
create index if not exists pos_sales_event_date on public.pos_sales(event_id,created_at);
alter table public.pos_checkouts add column if not exists rating smallint check(rating between 1 and 5);
alter table public.pos_checkouts add column if not exists custom_interest text not null default 'not_answered' check(custom_interest in ('yes','maybe','no','not_answered'));
alter table public.pos_checkouts add column if not exists consent_updated_at timestamptz;
-- Event-level historical data is internal-only, never exposed on the customer display.
create table if not exists public.pos_receipt_templates(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 name text not null check(length(name) between 1 and 80),
 headline text not null default 'YOU LOOK GOOD IN PERSEN!',
 promotion text not null default 'See new drops at persenapparel.com',
 footer text not null default 'Made with care on Long Island',
 review_message text not null default 'Enjoyed your experience? Leave an honest Google review.' check(length(review_message)<=130),
 show_review boolean not null default true,
 show_seasonal boolean not null default true,
 active boolean not null default false,
 updated_at timestamptz not null default now()
);
create unique index if not exists pos_one_active_receipt on public.pos_receipt_templates(owner_id) where active;
alter table public.pos_registers enable row level security;
alter table public.pos_checkouts enable row level security;
alter table public.pos_sales enable row level security;
alter table public.pos_receipt_templates enable row level security;
revoke all on public.pos_registers,public.pos_checkouts,public.pos_sales,public.pos_receipt_templates from anon,authenticated;
grant select,insert,update on public.pos_registers to authenticated;
grant select on public.pos_checkouts,public.pos_sales to authenticated;
grant select,insert,update,delete on public.pos_receipt_templates to authenticated;
create policy pos_register_owner_select on public.pos_registers for select to authenticated using(owner_id=(select auth.uid()) and public.is_persen_admin());
create policy pos_register_owner_insert on public.pos_registers for insert to authenticated with check(owner_id=(select auth.uid()) and public.is_persen_admin());
create policy pos_register_owner_update on public.pos_registers for update to authenticated using(owner_id=(select auth.uid()) and public.is_persen_admin()) with check(owner_id=(select auth.uid()) and public.is_persen_admin());
create policy pos_checkout_owner_select on public.pos_checkouts for select to authenticated using(owner_id=(select auth.uid()) and public.is_persen_admin());
create policy pos_sale_owner_select on public.pos_sales for select to authenticated using(owner_id=(select auth.uid()) and public.is_persen_admin());
create policy pos_template_owner on public.pos_receipt_templates for all to authenticated using(owner_id=(select auth.uid()) and public.is_persen_admin()) with check(owner_id=(select auth.uid()) and public.is_persen_admin());
-- All sensitive mutations run in carefully scoped RPCs; clients cannot edit checkout totals, status, or sales directly.
create or replace function public.pos_begin_checkout(p_register uuid,p_items jsonb,p_discount_bps integer default 0,p_tax_milli integer default 0,p_event uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.pos_registers; line jsonb; sid uuid; qty integer; unit integer; subtotal bigint:=0; taxable bigint:=0; discount bigint; tax bigint; total bigint; stock_id uuid; canonical jsonb:='[]'::jsonb; stockrow public.stock_items; seen uuid[]:='{}';
begin
 if (select auth.uid()) is null or not public.is_persen_admin() then raise exception 'Unauthorized'; end if;
 select * into r from public.pos_registers where id=p_register and owner_id=(select auth.uid()) and active for update;
 if not found then raise exception 'Register unavailable'; end if;
 if p_event is not null and not exists(select 1 from public.pos_events where id=p_event and status='open') then raise exception 'Choose an open event'; end if;
 if p_discount_bps not between 0 and 10000 or p_tax_milli not between 0 and 20000 then raise exception 'Invalid discount or tax'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 80 then raise exception 'Invalid cart'; end if;
 if exists(select 1 from public.pos_checkouts where register_id=p_register and status in ('awaiting_customer','contact_received')) then raise exception 'Close current checkout first'; end if;
 for line in select value from jsonb_array_elements(p_items) loop
   if jsonb_typeof(line)<>'object' or coalesce(line->>'qty','') !~ '^[0-9]{1,3}$' then raise exception 'Invalid item quantity'; end if;
   qty:=(line->>'qty')::integer;
   if qty not between 1 and 999 then raise exception 'Invalid quantity'; end if;
   if nullif(line->>'stock_id','') is not null then
     stock_id:=(line->>'stock_id')::uuid;
     if stock_id=any(seen) then raise exception 'Duplicate stock line'; end if;
     seen:=array_append(seen,stock_id);
     select * into stockrow from public.stock_items where id=stock_id;
     if not found or stockrow.quantity<qty then raise exception 'Insufficient stock'; end if;
     -- Cashier chooses the sale price; actual inventory identity is taken from the database.
     if coalesce(line->>'unit_cents','') !~ '^[0-9]{1,8}$' then raise exception 'Invalid price'; end if;
     unit:=(line->>'unit_cents')::integer;
     canonical:=canonical||jsonb_build_array(jsonb_build_object('stock_id',stock_id,'name',stockrow.product_name,'sku',stockrow.sku,'color',stockrow.color,'size',stockrow.size,'qty',qty,'unit_cents',unit,'service',case when (line->>'service') in ('Apparel','Custom Printing','Personalization','Accessories','Other') then line->>'service' else 'Other' end,'taxable',coalesce((line->>'taxable')::boolean,true)));
   else
     if length(trim(coalesce(line->>'name',''))) not between 1 and 120 or coalesce(line->>'unit_cents','') !~ '^[0-9]{1,8}$' then raise exception 'Invalid custom item'; end if;
     unit:=(line->>'unit_cents')::integer;
     canonical:=canonical||jsonb_build_array(jsonb_build_object('stock_id',null,'name',left(trim(line->>'name'),120),'sku','','color','','size','','qty',qty,'unit_cents',unit,'service',case when (line->>'service') in ('Apparel','Custom Printing','Personalization','Accessories','Other') then line->>'service' else 'Other' end,'taxable',coalesce((line->>'taxable')::boolean,true)));
   end if;
   if unit>10000000 then raise exception 'Item price too high'; end if;
   subtotal:=subtotal+qty::bigint*unit::bigint;
   if coalesce((line->>'taxable')::boolean,true) then taxable:=taxable+qty::bigint*unit::bigint; end if;
   if subtotal>100000000 then raise exception 'Cart too large'; end if;
 end loop;
 discount:=round(subtotal*p_discount_bps/10000.0);
 tax:=case when subtotal=0 then 0 else round((taxable*(subtotal-discount)/subtotal)*p_tax_milli/100000.0) end;
 total:=subtotal-discount+tax;
 insert into public.pos_checkouts(register_id,owner_id,event_id,items,discount_bps,tax_milli,subtotal_cents,discount_cents,tax_cents,total_cents)
 values(p_register,(select auth.uid()),p_event,canonical,p_discount_bps,p_tax_milli,subtotal::integer,discount::integer,tax::integer,total::integer)
 returning id into sid;
 return sid;
end $$;
create or replace function public.pos_customer_view(p_secret uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.pos_registers; c public.pos_checkouts;
begin
 select * into r from public.pos_registers where display_secret=p_secret and active;
 if not found then return jsonb_build_object('status','unpaired'); end if;
 select * into c from public.pos_checkouts where register_id=r.id order by created_at desc limit 1;
 if not found then return jsonb_build_object('status','idle','register',r.label); end if;
 if c.created_at<now()-interval '12 hours' then return jsonb_build_object('status','idle','register',r.label); end if;
 return jsonb_build_object('status',c.status,'register',r.label,'checkout_id',c.id,'items',c.items,'subtotal_cents',c.subtotal_cents,'discount_cents',c.discount_cents,'tax_cents',c.tax_cents,'total_cents',c.total_cents,'updated_at',c.updated_at);
end $$;
create or replace function public.pos_submit_customer(p_secret uuid,p_checkout uuid,p_phone text,p_email text default null,p_marketing_opt_in boolean default false,p_rating integer default null,p_interest text default 'not_answered')
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.pos_registers; c public.pos_checkouts; digits text;
begin
 digits:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
 if length(digits) not between 10 and 15 or length(coalesce(p_phone,''))>24 then raise exception 'Valid phone required'; end if;
 if p_email is not null and length(trim(p_email))>0 and (length(p_email)>250 or p_email !~ '^[^ @]+@[^ @]+\\.[^ @]+$') then raise exception 'Invalid email'; end if;
 select * into r from public.pos_registers where display_secret=p_secret and active;
 if not found then raise exception 'Register unavailable'; end if;
 select * into c from public.pos_checkouts where id=p_checkout and register_id=r.id for update;
 if not found or c.status not in ('awaiting_customer','contact_received') or c.created_at<now()-interval '30 minutes' then raise exception 'Checkout unavailable'; end if;
 if p_rating is not null and p_rating not between 1 and 5 then raise exception 'Invalid rating'; end if;
 if coalesce(p_interest,'not_answered') not in ('yes','maybe','no','not_answered') then raise exception 'Invalid interest'; end if;
 update public.pos_checkouts set phone=left(trim(p_phone),24),email=nullif(left(trim(p_email),250),''),marketing_opt_in=coalesce(p_marketing_opt_in,false),rating=p_rating::smallint,custom_interest=coalesce(p_interest,'not_answered'),consent_updated_at=case when p_marketing_opt_in=true then now() else null end,status='contact_received',updated_at=now() where id=c.id;
 return true;
end $$;
create or replace function public.pos_cancel_checkout(p_checkout uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.pos_checkouts;
begin
 if (select auth.uid()) is null or not public.is_persen_admin() then raise exception 'Unauthorized'; end if;
 select * into c from public.pos_checkouts where id=p_checkout and owner_id=(select auth.uid()) for update;
 if not found or c.status not in ('awaiting_customer','contact_received') then raise exception 'Checkout unavailable'; end if;
 update public.pos_checkouts set status='cancelled',updated_at=now() where id=c.id;
 return true;
end $$;
-- Counted drawer and exact change: draft, not applied to production.
create schema if not exists pos_internal;
revoke all on schema pos_internal from public,anon,authenticated;
create table if not exists public.pos_drawer_recounts(
 id uuid primary key default gen_random_uuid(),
 register_id uuid not null references public.pos_registers(id),
 owner_id uuid not null references auth.users(id),
 before_counts jsonb not null, after_counts jsonb not null,
 before_version integer not null, after_version integer not null,
 created_at timestamptz not null default now()
);
alter table public.pos_drawer_recounts enable row level security;
revoke all on public.pos_drawer_recounts from anon,authenticated;
grant select on public.pos_drawer_recounts to authenticated;
create policy pos_drawer_recount_owner_read on public.pos_drawer_recounts
for select to authenticated using(owner_id=(select auth.uid()) and public.is_persen_admin());

create or replace function pos_internal.valid_counts(p_counts jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $
declare k text; v text; d integer; result jsonb:='{}'::jsonb;
begin
 if p_counts is null or jsonb_typeof(p_counts)<>'object' then raise exception 'Invalid cash drawer'; end if;
 for k,v in select key,value from jsonb_each_text(p_counts) loop
  if k<>all(array['10000','5000','2000','1000','500','100','25','10','5','1'])
    or v !~ '^(0|[1-9][0-9]{0,2})
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.pos_checkouts; r public.pos_registers; line jsonb; sid uuid; updated integer;
 v_register uuid; denomination integer; qty integer; amount_received bigint:=0; change_due integer;
 drawer jsonb; received jsonb; available jsonb; change_plan jsonb; updated_counts jsonb;
 denominations integer[]:=array[10000,5000,2000,1000,500,100,25,10,5,1];
begin
 if (select auth.uid()) is null or not public.is_persen_admin() then raise exception 'Unauthorized'; end if;
 select register_id into v_register from public.pos_checkouts where id=p_checkout and owner_id=(select auth.uid());
 if v_register is null then raise exception 'Checkout unavailable'; end if;
 select * into r from public.pos_registers where id=v_register and owner_id=(select auth.uid()) and active for update;
 if not found then raise exception 'Register unavailable'; end if;
 select * into c from public.pos_checkouts where id=p_checkout and owner_id=(select auth.uid()) for update;
 if not found or c.status<>'contact_received' then raise exception 'Customer contact required or checkout already closed'; end if;
 if length(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'))<10 then raise exception 'Customer phone required'; end if;

 if p_tender_cents is null or p_tender_cents<c.total_cents or p_tender_cents>1000000 then raise exception 'Insufficient or invalid cash'; end if;
 change_due:=p_tender_cents-c.total_cents;
 if change_due>50000 then raise exception 'Change exceeds supported amount'; end if;
 received:=pos_internal.valid_counts(coalesce(p_received_breakdown,'{}'::jsonb));
 drawer:=pos_internal.valid_counts(coalesce(r.cash_drawer,'{}'::jsonb));available:=drawer;
 foreach denomination in array denominations loop
  qty:=(received->>denomination::text)::integer;
  amount_received:=amount_received+denomination::bigint*qty::bigint;
  available:=jsonb_set(available,array[denomination::text],to_jsonb((available->>denomination::text)::integer+qty));
 end loop;
 if amount_received<>0 and amount_received<>p_tender_cents then raise exception 'Received denominations do not match tender'; end if;
 if not r.drawer_configured and change_due>0 then raise exception 'Count the drawer before giving change'; end if;
 if r.drawer_configured then
  change_plan:=pos_internal.make_change(change_due,available);
  if change_plan is null then raise exception 'Insufficient exact change in drawer'; end if;
  updated_counts:=available;
  foreach denomination in array denominations loop
   updated_counts:=jsonb_set(updated_counts,array[denomination::text],
     to_jsonb((updated_counts->>denomination::text)::integer-coalesce((change_plan->>denomination::text)::integer,0)));
  end loop;
  update public.pos_registers set cash_drawer=updated_counts,drawer_version=drawer_version+1 where id=r.id;
 else
  change_plan:='{}'::jsonb;
 end if;
 -- Lock and decrement each row atomically. Any insufficient stock rolls back the entire transaction.
 for line in select value from jsonb_array_elements(c.items) order by (value->>'stock_id') nulls last loop
  if line->>'stock_id' is not null and line->>'stock_id'<>'null' then
    update public.stock_items set quantity=quantity-(line->>'qty')::integer,updated_at=now()
      where id=(line->>'stock_id')::uuid and quantity>=(line->>'qty')::integer;
    get diagnostics updated=row_count;
    if updated<>1 then raise exception 'Stock changed; cancel and rebuild checkout'; end if;
  end if;
 end loop;
 insert into public.pos_sales(checkout_id,owner_id,event_id,snapshot,subtotal_cents,discount_cents,tax_cents,total_cents,payment_method,tendered_cents,change_cents,change_breakdown)
 values(c.id,(select auth.uid()),c.event_id,jsonb_build_object('items',c.items,'phone',c.phone,'email',c.email,'marketing_opt_in',c.marketing_opt_in,'consent_updated_at',c.consent_updated_at,'rating',c.rating,'custom_interest',c.custom_interest),
 c.subtotal_cents,c.discount_cents,c.tax_cents,c.total_cents,'cash',p_tender_cents,change_due,change_plan) returning id into sid;
 -- Printing is queued even when the physical printer is offline.
 insert into public.pos_print_jobs(sale_id,owner_id,register_id)
 values(sid,(select auth.uid()),c.register_id);
 update public.pos_checkouts set status='completed',updated_at=now() where id=c.id;
 return sid;
end $$;

-- Print station authenticated with an authorized owner account.
-- Atomic claim stops two devices printing the same queued receipt simultaneously.
-- This RPC returns only receipt data, never phone/email or survey details.
create or replace function public.pos_claim_print_job(p_job uuid)
returns jsonb language plpgsql security definer set search_path='' as $
declare j public.pos_print_jobs; sale public.pos_sales;
begin
 if (select auth.uid()) is null or not public.is_persen_admin() then
   raise exception 'Unauthorized';
 end if;
 update public.pos_print_jobs
 set state='printing', attempts=attempts+1, claimed_at=now(), last_error=null
 where id=p_job and owner_id=(select auth.uid())
   and state='queued' and attempts<5
 returning * into j;
 if not found then return null; end if;
 select * into sale from public.pos_sales where id=j.sale_id and owner_id=(select auth.uid());
 if not found then raise exception 'Sale no longer available'; end if;
 return jsonb_build_object(
    'job_id',j.id,'sale_id',sale.id,
    'items',sale.snapshot->'items',
    'subtotal_cents',sale.subtotal_cents,
    'discount_cents',sale.discount_cents,
    'tax_cents',sale.tax_cents,
    'total_cents',sale.total_cents,
    'tendered_cents',sale.tendered_cents,
    'change_cents',sale.change_cents,
    'change_breakdown',sale.change_breakdown,
    'payment_method',sale.payment_method,
    'created_at',sale.created_at
 );
end $;

create or replace function public.pos_finish_print_job(p_job uuid,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $
declare n integer;
begin
 if (select auth.uid()) is null or not public.is_persen_admin() then
   raise exception 'Unauthorized';
 end if;
 update public.pos_print_jobs
 set state=case when nullif(trim(p_error),'') is null
   then 'submitted_to_browser' else 'failed' end,
   submitted_at=case when nullif(trim(p_error),'') is null then now() else null end,
   last_error=nullif(left(trim(p_error),200),'')
 where id=p_job and owner_id=(select auth.uid()) and state='printing';
 get diagnostics n=row_count;
 return n=1;
end $;

-- Recovery is a MANUAL action: automatic retries could print duplicates after a crash.
create or replace function public.pos_retry_print_job(p_job uuid)
returns boolean language plpgsql security definer set search_path='' as $
declare n integer;
begin
 if (select auth.uid()) is null or not public.is_persen_admin() then
   raise exception 'Unauthorized';
 end if;
 update public.pos_print_jobs
 set state='queued',claimed_at=null,submitted_at=null,last_error=null
 where id=p_job and owner_id=(select auth.uid()) and attempts<5
   and state in ('failed','printing','submitted_to_browser');
 get diagnostics n=row_count;
 return n=1;
end $;

revoke all on function public.pos_claim_print_job(uuid),
public.pos_finish_print_job(uuid,text),public.pos_retry_print_job(uuid) from public;
grant execute on function public.pos_claim_print_job(uuid),
public.pos_finish_print_job(uuid,text),public.pos_retry_print_job(uuid) to authenticated;

revoke all on function public.pos_begin_checkout(uuid,jsonb,integer,integer,uuid),public.pos_customer_view(uuid),public.pos_submit_customer(uuid,uuid,text,text,boolean,integer,text),public.pos_cancel_checkout(uuid),public.pos_complete_cash(uuid,integer,jsonb) from public;
grant execute on function public.pos_begin_checkout(uuid,jsonb,integer,integer,uuid),public.pos_cancel_checkout(uuid),public.pos_complete_cash(uuid,integer,jsonb) to authenticated;
grant execute on function public.pos_customer_view(uuid),public.pos_submit_customer(uuid,uuid,text,text,boolean,integer,text) to anon,authenticated;
-- For production: put anonymous display RPCs behind an Edge Function with rate limits, short-lived tokens, and rotation.
-- Do not activate these RPCs for untrusted public traffic until security review and abuse controls.
 then raise exception 'Invalid denomination or count'; end if;
 end loop;
 foreach d in array array[10000,5000,2000,1000,500,100,25,10,5,1] loop
  result:=result||jsonb_build_object(d::text,coalesce((p_counts->>d::text)::integer,0));
 end loop;
 return result;
end $;

create or replace function pos_internal.make_change(p_target integer,p_drawer jsonb,p_index integer default 1)
returns jsonb language plpgsql stable security invoker set search_path='' as $
declare denoms integer[]:=array[10000,5000,2000,1000,500,100,25,10,5,1];
 d integer; n integer; used integer; tail jsonb;
begin
 if p_target=0 then return '{}'::jsonb; end if;
 if p_target<0 or p_target>50000 or p_index>10 then return null; end if;
 d:=denoms[p_index];n:=least(coalesce((p_drawer->>d::text)::integer,0),p_target/d);
 for used in reverse n..0 loop
  tail:=pos_internal.make_change(p_target-used*d,p_drawer,p_index+1);
  if tail is not null then
   if used>0 then return tail||jsonb_build_object(d::text,used);end if;
   return tail;
  end if;
 end loop;
 return null;
end $;
revoke all on function pos_internal.valid_counts(jsonb),pos_internal.make_change(integer,jsonb,integer) from public;

create or replace function public.pos_set_cash_drawer(p_register uuid,p_counts jsonb,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $
declare r public.pos_registers; cleaned jsonb;
begin
 if (select auth.uid()) is null or not public.is_persen_admin() then raise exception 'Unauthorized'; end if;
 select * into r from public.pos_registers where id=p_register and owner_id=(select auth.uid()) and active for update;
 if not found then raise exception 'Register unavailable'; end if;
 if r.drawer_version<>p_expected_version then raise exception 'Drawer updated elsewhere; reload first'; end if;
 cleaned:=pos_internal.valid_counts(p_counts);
 insert into public.pos_drawer_recounts(register_id,owner_id,before_counts,after_counts,before_version,after_version)
 values(r.id,(select auth.uid()),r.cash_drawer,cleaned,r.drawer_version,r.drawer_version+1);
 update public.pos_registers set cash_drawer=cleaned,drawer_configured=true,drawer_version=drawer_version+1
 where id=r.id returning * into r;
 return jsonb_build_object('cash_drawer',r.cash_drawer,'drawer_version',r.drawer_version);
end $;
revoke all on function public.pos_set_cash_drawer(uuid,jsonb,integer) from public;
grant execute on function public.pos_set_cash_drawer(uuid,jsonb,integer) to authenticated;

create or replace function public.pos_complete_cash(p_checkout uuid,p_tender_cents integer,p_received_breakdown jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.pos_checkouts; line jsonb; sid uuid; updated integer;
begin
 if (select auth.uid()) is null or not public.is_persen_admin() then raise exception 'Unauthorized'; end if;
 select * into c from public.pos_checkouts where id=p_checkout and owner_id=(select auth.uid()) for update;
 if not found or c.status<>'contact_received' then raise exception 'Customer contact required or checkout already closed'; end if;
 if length(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'))<10 then raise exception 'Customer phone required'; end if;
 -- Lock and decrement each row atomically. Any insufficient stock rolls back the entire transaction.
 for line in select value from jsonb_array_elements(c.items) order by (value->>'stock_id') nulls last loop
  if line->>'stock_id' is not null and line->>'stock_id'<>'null' then
    update public.stock_items set quantity=quantity-(line->>'qty')::integer,updated_at=now()
      where id=(line->>'stock_id')::uuid and quantity>=(line->>'qty')::integer;
    get diagnostics updated=row_count;
    if updated<>1 then raise exception 'Stock changed; cancel and rebuild checkout'; end if;
  end if;
 end loop;
 insert into public.pos_sales(checkout_id,owner_id,event_id,snapshot,subtotal_cents,discount_cents,tax_cents,total_cents,payment_method)
 values(c.id,(select auth.uid()),c.event_id,jsonb_build_object('items',c.items,'phone',c.phone,'email',c.email,'marketing_opt_in',c.marketing_opt_in,'consent_updated_at',c.consent_updated_at,'rating',c.rating,'custom_interest',c.custom_interest),
 c.subtotal_cents,c.discount_cents,c.tax_cents,c.total_cents,'cash') returning id into sid;
 -- Printing is queued even when the physical printer is offline.
 insert into public.pos_print_jobs(sale_id,owner_id,register_id)
 values(sid,(select auth.uid()),c.register_id);
 update public.pos_checkouts set status='completed',updated_at=now() where id=c.id;
 return sid;
end $$;

-- Print station authenticated with an authorized owner account.
-- Atomic claim stops two devices printing the same queued receipt simultaneously.
-- This RPC returns only receipt data, never phone/email or survey details.
create or replace function public.pos_claim_print_job(p_job uuid)
returns jsonb language plpgsql security definer set search_path='' as $
declare j public.pos_print_jobs; sale public.pos_sales;
begin
 if (select auth.uid()) is null or not public.is_persen_admin() then
   raise exception 'Unauthorized';
 end if;
 update public.pos_print_jobs
 set state='printing', attempts=attempts+1, claimed_at=now(), last_error=null
 where id=p_job and owner_id=(select auth.uid())
   and state='queued' and attempts<5
 returning * into j;
 if not found then return null; end if;
 select * into sale from public.pos_sales where id=j.sale_id and owner_id=(select auth.uid());
 if not found then raise exception 'Sale no longer available'; end if;
 return jsonb_build_object(
    'job_id',j.id,'sale_id',sale.id,
    'items',sale.snapshot->'items',
    'subtotal_cents',sale.subtotal_cents,
    'discount_cents',sale.discount_cents,
    'tax_cents',sale.tax_cents,
    'total_cents',sale.total_cents,
    'payment_method',sale.payment_method,
    'created_at',sale.created_at
 );
end $;

create or replace function public.pos_finish_print_job(p_job uuid,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $
declare n integer;
begin
 if (select auth.uid()) is null or not public.is_persen_admin() then
   raise exception 'Unauthorized';
 end if;
 update public.pos_print_jobs
 set state=case when nullif(trim(p_error),'') is null
   then 'submitted_to_browser' else 'failed' end,
   submitted_at=case when nullif(trim(p_error),'') is null then now() else null end,
   last_error=nullif(left(trim(p_error),200),'')
 where id=p_job and owner_id=(select auth.uid()) and state='printing';
 get diagnostics n=row_count;
 return n=1;
end $;

-- Recovery is a MANUAL action: automatic retries could print duplicates after a crash.
create or replace function public.pos_retry_print_job(p_job uuid)
returns boolean language plpgsql security definer set search_path='' as $
declare n integer;
begin
 if (select auth.uid()) is null or not public.is_persen_admin() then
   raise exception 'Unauthorized';
 end if;
 update public.pos_print_jobs
 set state='queued',claimed_at=null,submitted_at=null,last_error=null
 where id=p_job and owner_id=(select auth.uid()) and attempts<5
   and state in ('failed','printing','submitted_to_browser');
 get diagnostics n=row_count;
 return n=1;
end $;

revoke all on function public.pos_claim_print_job(uuid),
public.pos_finish_print_job(uuid,text),public.pos_retry_print_job(uuid) from public;
grant execute on function public.pos_claim_print_job(uuid),
public.pos_finish_print_job(uuid,text),public.pos_retry_print_job(uuid) to authenticated;

revoke all on function public.pos_begin_checkout(uuid,jsonb,integer,integer,uuid),public.pos_customer_view(uuid),public.pos_submit_customer(uuid,uuid,text,text,boolean,integer,text),public.pos_cancel_checkout(uuid),public.pos_complete_cash(uuid,integer,jsonb) from public;
grant execute on function public.pos_begin_checkout(uuid,jsonb,integer,integer,uuid),public.pos_cancel_checkout(uuid),public.pos_complete_cash(uuid,integer,jsonb) to authenticated;
grant execute on function public.pos_customer_view(uuid),public.pos_submit_customer(uuid,uuid,text,text,boolean,integer,text) to anon,authenticated;
-- For production: put anonymous display RPCs behind an Edge Function with rate limits, short-lived tokens, and rotation.
-- Do not activate these RPCs for untrusted public traffic until security review and abuse controls.

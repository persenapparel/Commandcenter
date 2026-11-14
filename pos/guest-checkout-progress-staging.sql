-- DRAFT / ISOLATED STAGING ONLY. NOT APPLIED; NO PUBLIC/ANON GRANTS.
-- Depends on guest-checkout-capability-staging.sql and checkout-change trigger.
-- This is an independently rate-limited, checkout-scoped guest PROGRESS RPC.
-- It cannot create a sale, submit contact data, change prices, change the cart,
-- issue credentials, or alter a different checkout. Do not enable handoff.
-- Add Edge IP/device throttling and complete guest submission before exposure.

create table if not exists public.pos_guest_checkout_progress_limits (
  checkout_id uuid primary key
    references public.pos_guest_checkout_capabilities(checkout_id)
    on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0
    check (request_count between 0 and 20)
);
alter table public.pos_guest_checkout_progress_limits enable row level security;
revoke all on public.pos_guest_checkout_progress_limits
  from public, anon, authenticated;

create or replace function public.pos_guest_checkout_set_progress(
  p_capability text,
  p_step text,
  p_need_help boolean default false
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_checkout uuid;
  v_count integer;
  v_now timestamptz := statement_timestamp();
begin
  -- Invalid/unknown/revoked/expired tokens are indistinguishable to caller.
  if p_capability is null or p_capability !~ '^[0-9a-f]{64}$'
     or p_step is null or p_step not in
       ('phone','receipt','email','payment','promos','rating','custom','review')
     or p_need_help is null then
    return false;
  end if;

  -- Serializes requests per token, including concurrent requests. Only the
  -- owner-matching, active, awaiting_customer checkout can be touched.
  select t.checkout_id into v_checkout
  from public.pos_guest_checkout_capabilities t
  join public.pos_checkouts c
    on c.id=t.checkout_id and c.owner_id=t.owner_id
  join public.pos_registers r
    on r.id=c.register_id and r.owner_id=c.owner_id and r.active=true
  where t.token_sha256=encode(extensions.digest(p_capability,'sha256'),'hex')
    and t.revoked_at is null and t.expires_at>v_now
    and c.created_at>v_now-interval '30 minutes'
    and c.status='awaiting_customer'
  for update of t;

  if not found then return false; end if;

  insert into public.pos_guest_checkout_progress_limits
    (checkout_id,window_started_at,request_count)
  values (v_checkout,v_now,0)
  on conflict (checkout_id) do nothing;

  update public.pos_guest_checkout_progress_limits
  set window_started_at=
        case when window_started_at<=v_now-interval '60 seconds'
          then v_now else window_started_at end,
      request_count=
        case when window_started_at<=v_now-interval '60 seconds'
          then 1 else request_count+1 end
  where checkout_id=v_checkout
    and (window_started_at<=v_now-interval '60 seconds'
      or request_count<20)
  returning request_count into v_count;

  if not found then return false; end if;

  -- The checkout update does not modify pricing, ownership, customer contact
  -- data, status or cart. Checkout-change revocation trigger remains intact.
  update public.pos_checkouts c
     set customer_step=p_step,
         help_requested=p_need_help,
         progress_updated_at=v_now,
         updated_at=v_now
   where c.id=v_checkout and c.status='awaiting_customer'
     and c.created_at>v_now-interval '30 minutes';
  return found;
end;
$$;
revoke all on function public.pos_guest_checkout_set_progress(text,text,boolean)
  from public, anon, authenticated;

-- A future authenticated guest gateway must enforce per-IP/device abuse limits
-- before any reviewed role-specific EXECUTE grant. This function intentionally
-- does not expose the cashier session, contact fields, or token hashes.
-- Separate work still needed: guest submission with signature/consent checks,
-- atomic start+capability issue, owner re-auth, full PostgreSQL/browser tests.

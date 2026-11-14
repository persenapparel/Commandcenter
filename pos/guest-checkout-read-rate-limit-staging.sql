-- DRAFT / ISOLATED STAGING ONLY. Do not apply to hosted databases or
-- grant guest execution until the complete handoff gateway is security tested.
-- Depends on guest-checkout-capability-staging.sql in PR #72 stack.
--
-- Checkout-scoped rate-limited guest READ gateway foundation.
-- A valid token permits at most 30 successful or unsuccessful snapshot
-- requests per rolling 60-second window. Revoked/expired/completed tokens
-- return the same generic response as unknown tokens.
-- Additional per-IP/device abuse controls MUST be implemented at the Edge
-- Function or WAF before granting this RPC to an untrusted caller.

create table if not exists public.pos_guest_checkout_read_limits (
  checkout_id uuid primary key
    references public.pos_guest_checkout_capabilities(checkout_id)
    on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0
    check (request_count between 0 and 30)
);
alter table public.pos_guest_checkout_read_limits enable row level security;
revoke all on public.pos_guest_checkout_read_limits
  from public, anon, authenticated;

create or replace function public.pos_guest_checkout_rate_limited_snapshot(
  p_capability text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_checkout_id uuid;
  v_count integer;
  v_now timestamptz := statement_timestamp();
begin
  if p_capability is null or
     p_capability !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status','unavailable');
  end if;

  -- Never issue a capability, change a checkout, or return a raw token.
  -- Row lock serializes concurrent requests for the same capability.
  select t.checkout_id into v_checkout_id
  from public.pos_guest_checkout_capabilities t
  join public.pos_checkouts c
    on c.id=t.checkout_id and c.owner_id=t.owner_id
  join public.pos_registers r
    on r.id=c.register_id and r.owner_id=c.owner_id and r.active=true
  where t.token_sha256 =
    encode(extensions.digest(p_capability,'sha256'),'hex')
    and t.revoked_at is null and t.expires_at>v_now
    and c.created_at>v_now-interval '30 minutes'
    and c.status in ('awaiting_customer','contact_received')
  for update of t;

  if not found then
    return jsonb_build_object('status','unavailable');
  end if;

  insert into public.pos_guest_checkout_read_limits
    (checkout_id,window_started_at,request_count)
  values(v_checkout_id,v_now,0)
  on conflict (checkout_id) do nothing;

  update public.pos_guest_checkout_read_limits
  set window_started_at =
        case when window_started_at <= v_now-interval '60 seconds'
             then v_now else window_started_at end,
      request_count =
        case when window_started_at <= v_now-interval '60 seconds'
             then 1 else request_count+1 end
  where checkout_id=v_checkout_id and
    (window_started_at <= v_now-interval '60 seconds'
      or request_count < 30)
  returning request_count into v_count;

  if not found then
    -- Intentionally do not leak token existence or checkout metadata.
    return jsonb_build_object('status','unavailable');
  end if;

  -- The underlying snapshot rechecks token/checkout validity and returns
  -- only the approved cart/amount/status fields. This is read-only.
  return public.pos_guest_checkout_snapshot(p_capability);
end;
$$;
revoke all on function public.pos_guest_checkout_rate_limited_snapshot(text)
  from public, anon, authenticated;

-- NOT IMPLEMENTED: independently rate-limited customer progress/submission,
-- signature handling, Edge abuse controls, secure owner handoff and re-auth,
-- token revocation at all lifecycle boundaries, browser + PostgreSQL tests.
-- Keep customer handoff fail-closed and leave guest EXECUTE ungranted.

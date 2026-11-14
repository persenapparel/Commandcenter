-- STAGING-ONLY PROPOSAL, NOT APPLIED. This is the first server-side building
-- block for one-swivel-iPad checkout, NOT permission to enable customer handoff.
-- Parent stack: draft #64 (Epson + fail-closed customer screen).
--
-- Prior/current register-wide display_secret (2h) MUST NOT be treated as a
-- per-checkout capability. In a later coordinated migration, replace that guest
-- transport with this scoped token and revoke anonymous access to old pairing
-- RPCs only after new guest endpoints are reviewed and ready.
--
-- Security rules:
-- * Only authenticated Persen POS owner can issue/revoke a capability.
-- * 32 random bytes of entropy, server keeps only SHA-256 digest.
-- * One capability per immutable checkout id; reissue rotates old token.
-- * 20 minute expiry, and inactive/cancelled/completed checkouts fail closed.
-- * RLS, no direct table SELECT/INSERT/UPDATE/DELETE for any API role.
-- * NO anon guest API grants here; rate limits, validation, browser negative
--   tests, contact semantics and signature checks are still P0 blockers.
-- * All role changes/hosted migrations require isolated staging review first.

create table if not exists public.pos_guest_checkout_capabilities (
  checkout_id uuid primary key references public.pos_checkouts(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  token_sha256 text not null unique check (length(token_sha256)=64),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists pos_guest_checkout_capabilities_expiry
  on public.pos_guest_checkout_capabilities(expires_at);
alter table public.pos_guest_checkout_capabilities enable row level security;
revoke all on public.pos_guest_checkout_capabilities
  from public, anon, authenticated;

create or replace function public.pos_issue_guest_checkout_capability(
  p_checkout uuid
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_token text;
  v_owner uuid := (select auth.uid());
begin
  if v_owner is null or not public.is_persen_admin() then
    raise exception 'Owner authorization required';
  end if;
  -- Lock checkout while issuing the one-checkout-only token.
  perform 1
  from public.pos_checkouts c
  join public.pos_registers r on r.id=c.register_id
  where c.id=p_checkout and c.owner_id=v_owner
    and r.owner_id=v_owner and r.active=true
    and c.status='awaiting_customer'
    and c.created_at > now()-interval '30 minutes'
  for update of c;
  if not found then
    raise exception 'Active owner checkout required';
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.pos_guest_checkout_capabilities
    (checkout_id,owner_id,token_sha256,issued_at,expires_at,revoked_at)
  values
    (p_checkout,v_owner,
     encode(extensions.digest(v_token,'sha256'),'hex'),
     now(),now()+interval '20 minutes',null)
  on conflict(checkout_id) do update
    set token_sha256=excluded.token_sha256,
        issued_at=excluded.issued_at,
        expires_at=excluded.expires_at,
        revoked_at=null;
  return v_token;
end;
$$;
revoke all on function public.pos_issue_guest_checkout_capability(uuid)
  from public, anon, authenticated;
grant execute on function public.pos_issue_guest_checkout_capability(uuid)
  to authenticated;

create or replace function public.pos_revoke_guest_checkout_capability(
  p_checkout uuid
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_owner uuid := (select auth.uid());
begin
  if v_owner is null or not public.is_persen_admin() then
    raise exception 'Owner authorization required';
  end if;
  update public.pos_guest_checkout_capabilities x
    set revoked_at=now()
  where x.checkout_id=p_checkout and x.owner_id=v_owner
    and exists (
      select 1 from public.pos_checkouts c
      join public.pos_registers r on r.id=c.register_id
      where c.id=x.checkout_id and r.owner_id=v_owner
    );
  return found;
end;
$$;
revoke all on function public.pos_revoke_guest_checkout_capability(uuid)
  from public, anon, authenticated;
grant execute on function public.pos_revoke_guest_checkout_capability(uuid)
  to authenticated;

-- A narrow read-only RPC that may be used by a FUTURE, rate-limited guest
-- gateway. It does not return owner/auth credentials, phone/email, consent,
-- receipt-address data, customer signature, or staff/admin records.
-- There is deliberately NO grant to anon or authenticated yet.
create or replace function public.pos_guest_checkout_snapshot(
  p_capability text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_checkout public.pos_checkouts;
begin
  if p_capability is null or
     p_capability !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status','unavailable');
  end if;
  select c.* into v_checkout
  from public.pos_guest_checkout_capabilities t
  join public.pos_checkouts c on c.id=t.checkout_id
  where t.token_sha256=encode(extensions.digest(p_capability,'sha256'),'hex')
    and t.revoked_at is null and t.expires_at>now()
    and c.created_at>now()-interval '30 minutes'
    and c.status in ('awaiting_customer','contact_received')
    and exists (
      select 1 from public.pos_registers r
      where r.id=c.register_id and r.owner_id=c.owner_id and r.active=true
    )
  limit 1;
  if not found then
    return jsonb_build_object('status','unavailable');
  end if;
  return jsonb_build_object(
    'status',v_checkout.status,
    'checkout_id',v_checkout.id,
    'items',v_checkout.items,
    'subtotal_cents',v_checkout.subtotal_cents,
    'discount_cents',v_checkout.discount_cents,
    'total_cents',v_checkout.total_cents,
    'cash_handoff_complete',v_checkout.cash_handoff_complete
  );
end;
$$;
revoke all on function public.pos_guest_checkout_snapshot(text)
  from public, anon, authenticated;

-- Fail closed on any checkout mutation that invalidates the guest's view.
-- Runs in the same transaction as the checkout update. This is defense in
-- depth; explicit cancellation/completion must also revoke capabilities.
create or replace function public.pos_revoke_guest_capability_on_checkout_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.status is distinct from new.status
     or old.items is distinct from new.items
     or old.subtotal_cents is distinct from new.subtotal_cents
     or old.discount_cents is distinct from new.discount_cents
     or old.total_cents is distinct from new.total_cents
     or old.register_id is distinct from new.register_id
     or old.owner_id is distinct from new.owner_id then
    update public.pos_guest_checkout_capabilities
       set revoked_at=now()
     where checkout_id=old.id and revoked_at is null;
  end if;
  return new;
end;
$$;
revoke all on function public.pos_revoke_guest_capability_on_checkout_change()
  from public, anon, authenticated;
drop trigger if exists pos_guest_capability_checkout_changed on public.pos_checkouts;
create trigger pos_guest_capability_checkout_changed
after update of status, items, subtotal_cents, discount_cents, total_cents,
                register_id, owner_id on public.pos_checkouts
for each row execute function public.pos_revoke_guest_capability_on_checkout_change();

-- Required follow-up before enabling customer handoff:
-- 1) Add an authenticated owner RPC that atomically STARTS checkout + issues
--    scoped capability before owner local-session sign-out.
-- 2) Build a rate-limited guest transport (Edge Function or reviewed RPCs)
--    with checkout-bound progress and submission, using no legacy display_secret.
-- 3) Verify guest cannot read cashier state, modify prices, access other sales,
--    replay/extend tokens, submit twice, or bypass optional phone/email,
--    consent/signature checks. Revoke on finish/cancel/idle.
-- 4) Test isolated PostgreSQL RLS/EXECUTE negatives and real iPad browser
--    sign-out, customer wizard, re-auth, cash/change/Finish Order -> HOME.
-- 5) Only after all above, remove the fail-closed return in swivel-mode.js.

-- Persen POS staging-only integration draft. DO NOT APPLY to production.
-- Depends on pos/pos-schema-review.sql and staging_staff_shift_auth_draft.sql.
-- The real register and guest HTTPS gateway are NOT wired to these RPCs yet.
-- A successful SQL compile does not authorize enabling Hand to Customer.

create table if not exists public.pos_checkout_handoffs (
 checkout_id uuid primary key references public.pos_checkouts(id),
 register_id uuid not null references public.pos_registers(id),
 shift_id uuid not null references public.pos_staff_shifts(id),
 auth_user_id uuid not null references auth.users(id),
 phase text not null check (phase in ('claimed','guest','customer_complete','cashier','closed')),
 capability_digest bytea,
 capability_expires_at timestamptz,
 guest_issued_at timestamptz,
 resumed_at timestamptz,
 closed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint pos_guest_capability_phase check
   (phase <> 'guest' or (capability_digest is not null and capability_expires_at is not null))
);
-- Customer acknowledgment is private, minimal, and inaccessible from Data API.
create table if not exists public.pos_checkout_signatures (
 checkout_id uuid primary key references public.pos_checkouts(id),
 typed_name text,
 accessibility_exception boolean not null default false,
 acknowledged_at timestamptz not null default now(),
 check ((accessibility_exception and typed_name is null) or
        (not accessibility_exception and length(typed_name) between 1 and 160))
);
alter table public.pos_checkout_signatures enable row level security;
revoke all on public.pos_checkout_signatures from public,anon,authenticated;

create unique index if not exists pos_one_active_handoff_per_register
 on public.pos_checkout_handoffs(register_id)
 where phase in ('claimed','guest','customer_complete','cashier');
alter table public.pos_checkout_handoffs enable row level security;
revoke all on public.pos_checkout_handoffs from public,anon,authenticated;

-- Existing owner-only pos_begin_checkout creates the checkout first.
-- Claiming only an existing checkout prevents a client inventing order totals.
-- Until the staff-aware begin-checkout RPC is implemented this remains
-- owner-account-only (not functional for Colleen/Logan cashier accounts).
create or replace function public.pos_handoff_claim(
 p_checkout uuid, p_shift_id uuid, p_shift_secret text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
 v_uid uuid := auth.uid();
 v_shift public.pos_staff_shifts%rowtype;
 v_checkout public.pos_checkouts%rowtype;
begin
 if v_uid is null or p_shift_secret is null or
    p_shift_secret !~ '^[0-9a-f]{64}$' then
  raise exception 'Checkout authorization denied';
 end if;
 select s.* into v_shift
 from public.pos_staff_shifts s
 join public.pos_staff_credentials c on c.id=s.staff_id
 where s.id=p_shift_id and s.auth_user_id=v_uid
   and s.revoked_at is null and s.expires_at > now()
   and c.enabled and c.auth_user_id=v_uid
   and c.credential_version=s.credential_version
   and s.secret_digest=extensions.digest(p_shift_secret,'sha256')
 for update of s,c;
 if not found then raise exception 'Checkout authorization denied'; end if;
 select * into v_checkout
 from public.pos_checkouts
 where id=p_checkout and owner_id=v_uid
   and status='awaiting_customer'
   and created_at > now()-interval '30 minutes'
 for update;
 if not found or not exists (
   select 1 from public.pos_registers
   where id=v_checkout.register_id and owner_id=v_uid and active
 ) then raise exception 'Checkout authorization denied'; end if;
 insert into public.pos_checkout_handoffs
   (checkout_id,register_id,shift_id,auth_user_id,phase)
 values (v_checkout.id,v_checkout.register_id,v_shift.id,v_uid,'claimed');
 return jsonb_build_object('ok',true,'checkoutId',v_checkout.id,'phase','claimed');
end $$;
revoke all on function public.pos_handoff_claim(uuid,uuid,text) from public,anon;
grant execute on function public.pos_handoff_claim(uuid,uuid,text) to authenticated;

-- Call only AFTER the cashier runtime verifies its own credentials are
-- removed from the guest browsing context. Backend still must be protected
-- from direct invocation by malicious clients: the guest origin is separate,
-- and the token is restricted to only this checkout, TTL and single use.
create or replace function public.pos_handoff_issue_guest(
 p_checkout uuid, p_shift_id uuid, p_shift_secret text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
 v_uid uuid := auth.uid();
 v_shift public.pos_staff_shifts%rowtype;
 v_handoff public.pos_checkout_handoffs%rowtype;
 v_checkout public.pos_checkouts%rowtype;
 v_capability text;
 v_expiry timestamptz := now()+interval '15 minutes';
begin
 if v_uid is null or p_shift_secret is null or
    p_shift_secret !~ '^[0-9a-f]{64}$' then
  raise exception 'Checkout authorization denied';
 end if;
 select s.* into v_shift
 from public.pos_staff_shifts s
 join public.pos_staff_credentials c on c.id=s.staff_id
 where s.id=p_shift_id and s.auth_user_id=v_uid
   and s.revoked_at is null and s.expires_at>now()
   and c.enabled and c.auth_user_id=v_uid
   and c.credential_version=s.credential_version
   and s.secret_digest=extensions.digest(p_shift_secret,'sha256')
 for update of s,c;
 if not found then raise exception 'Checkout authorization denied'; end if;
 select * into v_checkout from public.pos_checkouts
 where id=p_checkout and owner_id=v_uid and status='awaiting_customer'
 and created_at>now()-interval '30 minutes' for update;
 if not found then raise exception 'Checkout authorization denied'; end if;
 select * into v_handoff from public.pos_checkout_handoffs
 where checkout_id=p_checkout and shift_id=p_shift_id and auth_user_id=v_uid
 and phase='claimed' for update;
 if not found then raise exception 'Checkout authorization denied'; end if;
 v_capability:=encode(extensions.gen_random_bytes(32),'hex');
 update public.pos_checkout_handoffs
 set phase='guest',capability_digest=extensions.digest(v_capability,'sha256'),
     capability_expires_at=v_expiry,guest_issued_at=now(),updated_at=now()
 where checkout_id=p_checkout;
 return jsonb_build_object('checkoutId',p_checkout,'capability',v_capability,
                           'expiresAt',v_expiry);
end $$;
revoke all on function public.pos_handoff_issue_guest(uuid,uuid,text) from public,anon;
grant execute on function public.pos_handoff_issue_guest(uuid,uuid,text) to authenticated;

-- The isolated customer gateway (not yet implemented) must validate this
-- server-side. This is SECURITY DEFINER because guest origin has NO cashier
-- session, and is callable only by a trusted gateway's service role.
create or replace function public.pos_handoff_guest_view(
 p_checkout uuid, p_capability text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_handoff public.pos_checkout_handoffs%rowtype;
 v_checkout public.pos_checkouts%rowtype;
begin
 if p_capability is null or p_capability !~ '^[0-9a-f]{64}$' then
  raise exception 'Checkout unavailable';
 end if;
 select * into v_handoff from public.pos_checkout_handoffs
 where checkout_id=p_checkout and phase='guest'
   and capability_expires_at>now()
   and capability_digest=extensions.digest(p_capability,'sha256')
 for update;
 if not found then raise exception 'Checkout unavailable'; end if;
 select * into v_checkout from public.pos_checkouts
 where id=p_checkout and status='awaiting_customer'
 and created_at>now()-interval '30 minutes' for update;
 if not found then raise exception 'Checkout unavailable'; end if;
 return jsonb_build_object('checkoutId',v_checkout.id,
  'items',(select coalesce(jsonb_agg(jsonb_build_object(
   'name', item->>'name',
   'quantity',(item->>'qty')::integer,
   'lineTotal',to_char(((item->>'qty')::integer*(item->>'unit_cents')::integer)::numeric/100,'FM$999999990.00')
  )),'[]'::jsonb) from jsonb_array_elements(v_checkout.items) as item),
  'total',to_char(v_checkout.total_cents::numeric/100,'FM$999999990.00'));
end $$;
revoke all on function public.pos_handoff_guest_view(uuid,text) from public,anon,authenticated;
grant execute on function public.pos_handoff_guest_view(uuid,text) to service_role;

-- One-time guest submission, bound to the original checkout. The signature
-- is recorded only as a bounded audit acknowledgment: do not expose it in
-- receipts, marketing, the POS guest view, or customer-visible messages.
create or replace function public.pos_handoff_guest_submit(
 p_checkout uuid, p_capability text, p_answers jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_handoff public.pos_checkout_handoffs%rowtype;
 v_checkout public.pos_checkouts%rowtype;
 v_phone text; v_email text; v_signature text; v_exception boolean;
 v_marketing boolean;
begin
 if p_capability is null or p_capability !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_answers) is distinct from 'object' then
   raise exception 'Checkout unavailable';
 end if;
 select * into v_handoff from public.pos_checkout_handoffs
 where checkout_id=p_checkout and phase='guest'
   and capability_expires_at>now()
   and capability_digest=extensions.digest(p_capability,'sha256')
 for update;
 if not found then raise exception 'Checkout unavailable'; end if;
 select * into v_checkout from public.pos_checkouts
 where id=p_checkout and status='awaiting_customer'
   and created_at>now()-interval '30 minutes'
 for update;
 if not found then raise exception 'Checkout unavailable'; end if;
 v_phone:=btrim(coalesce(p_answers->>'phone',''));
 v_email:=btrim(coalesce(p_answers->>'email',''));
 v_signature:=btrim(coalesce(p_answers->>'signature',''));
 if jsonb_typeof(p_answers->'marketingConsent') not in ('boolean','null')
    and p_answers ? 'marketingConsent' then
  raise exception 'Invalid customer answer';
 end if;
 if jsonb_typeof(p_answers->'signatureException') not in ('boolean','null')
    and p_answers ? 'signatureException' then
  raise exception 'Invalid customer answer';
 end if;
 v_marketing:=coalesce((p_answers->>'marketingConsent')::boolean,false);
 v_exception:=coalesce((p_answers->>'signatureException')::boolean,false);
 if length(v_phone)>24 or (length(v_phone)>0 and
    length(regexp_replace(v_phone,'[^0-9]','','g')) not between 10 and 15)
   or length(v_email)>250
   or (v_email<>'' and v_email !~ '^[^ @]+@[^ @]+[.][^ @]+$')
   or (not v_exception and length(v_signature) not between 1 and 160)
   or (v_exception and v_signature<>'') then
  raise exception 'Invalid customer answer';
 end if;
 update public.pos_checkouts
 set phone=nullif(v_phone,''),email=nullif(v_email,''),
     marketing_opt_in=v_marketing,
     consent_updated_at=case when v_marketing then now() else null end,
     customer_step='review',progress_updated_at=now(),
     status='contact_received',updated_at=now()
 where id=p_checkout;
 -- Only the protected signature table stores the limited typed acknowledgment.
 insert into public.pos_checkout_signatures(checkout_id,typed_name,accessibility_exception)
 values(p_checkout,case when v_exception then null else v_signature end,v_exception);
 update public.pos_checkout_handoffs
 set phase='customer_complete',capability_digest=null,capability_expires_at=null,
     updated_at=now()
 where checkout_id=p_checkout;
 return jsonb_build_object('accepted',true);
end $$;
revoke all on function public.pos_handoff_guest_submit(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.pos_handoff_guest_submit(uuid,text,jsonb) to service_role;

-- A second submit, wrong token, expired token, or different checkout fails.
-- Badge return is scoped to the original authenticated employee and checkout.
create or replace function public.pos_handoff_resume(
 p_checkout uuid,p_shift_id uuid,p_shift_secret text,p_badge text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid:=auth.uid();
 v_checkout public.pos_checkouts%rowtype;
 v_handoff public.pos_checkout_handoffs%rowtype;
 v_proof jsonb;
begin
 if v_uid is null then raise exception 'Checkout authorization denied'; end if;
 select * into v_checkout from public.pos_checkouts
 where id=p_checkout and owner_id=v_uid and status='contact_received'
 for update;
 if not found then raise exception 'Checkout authorization denied'; end if;
 select * into v_handoff from public.pos_checkout_handoffs
 where checkout_id=p_checkout and shift_id=p_shift_id and auth_user_id=v_uid
 and phase='customer_complete' and capability_digest is null
 for update;
 if not found then raise exception 'Checkout authorization denied'; end if;
 v_proof:=public.pos_staff_resume_shift(
  p_shift_id,p_shift_secret,p_badge,v_checkout.register_id
 );
 if coalesce((v_proof->>'ok')::boolean,false) is not true then
  -- Return failure instead of raising; otherwise PostgreSQL rolls back the
  -- nested badge attempt counter and defeats the PIN/badge throttle.
  return jsonb_build_object('verified',false,'error','Checkout authorization denied');
 end if;
 update public.pos_checkout_handoffs
 set phase='cashier',resumed_at=now(),updated_at=now()
 where checkout_id=p_checkout;
 return jsonb_build_object('verified',true,'checkoutId',p_checkout);
end $$;
revoke all on function public.pos_handoff_resume(uuid,uuid,text,text) from public,anon;
grant execute on function public.pos_handoff_resume(uuid,uuid,text,text) to authenticated;

-- Cashier-controlled emergency cleanup. This does not undo an already
-- completed payment or delete customer data; it only destroys guest access.
create or replace function public.pos_handoff_revoke(
 p_checkout uuid,p_shift_id uuid,p_shift_secret text
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid:=auth.uid();
begin
 if v_uid is null or p_shift_secret is null or
    p_shift_secret !~ '^[0-9a-f]{64}$'
    or not exists (
     select 1 from public.pos_staff_shifts s
     join public.pos_staff_credentials c on c.id=s.staff_id
     where s.id=p_shift_id and s.auth_user_id=v_uid
       and s.revoked_at is null and s.expires_at>now()
       and c.enabled and c.credential_version=s.credential_version
       and s.secret_digest=extensions.digest(p_shift_secret,'sha256')
    ) then raise exception 'Checkout authorization denied'; end if;
 update public.pos_checkout_handoffs
 set phase='closed',capability_digest=null,capability_expires_at=null,
     closed_at=now(),updated_at=now()
 where checkout_id=p_checkout and shift_id=p_shift_id
 and auth_user_id=v_uid and phase<>'closed';
 if not found then raise exception 'Checkout authorization denied'; end if;
 return true;
end $$;
revoke all on function public.pos_handoff_revoke(uuid,uuid,text) from public,anon;
grant execute on function public.pos_handoff_revoke(uuid,uuid,text) to authenticated;

-- NOT DONE: cashiers need staff-aware checkout/cart/payment RPCs; protected
-- anonymous guest HTTPS gateway; isolated origin; safe signature storage;
-- hosted negative tests; and full iPad Safari browser E2E.

-- These read-only, authenticated cashier RPCs replace trusting a browser
-- callback to say that guest collection or actual payment succeeded.
-- They do NOT process a payment and never return customer personal data.
create or replace function public.pos_handoff_status(
 p_checkout uuid,p_shift_id uuid,p_shift_secret text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid();v_status text;
begin
 if v_uid is null or p_shift_secret is null or
    p_shift_secret !~ '^[a-f0-9]{64}$' then
  raise exception 'Checkout authorization denied';
 end if;
 select c.status into v_status
 from public.pos_checkout_handoffs h
 join public.pos_checkouts c on c.id=h.checkout_id
 join public.pos_staff_shifts s on s.id=h.shift_id
 join public.pos_staff_credentials staff on staff.id=s.staff_id
 where h.checkout_id=p_checkout and h.shift_id=p_shift_id
   and h.auth_user_id=v_uid and c.owner_id=v_uid
   and h.phase in ('guest','customer_complete','cashier')
   and s.auth_user_id=v_uid and s.revoked_at is null and s.expires_at>now()
   and staff.enabled=true and staff.credential_version=s.credential_version
   and s.secret_digest=extensions.digest(p_shift_secret,'sha256');
 if not found then raise exception 'Checkout authorization denied'; end if;
 return jsonb_build_object('ok',true,'checkoutId',p_checkout,'status',v_status);
end $$;
revoke all on function public.pos_handoff_status(uuid,uuid,text) from public,anon;
grant execute on function public.pos_handoff_status(uuid,uuid,text) to authenticated;

-- The POS retains its explicit cash-recording and Finish Order steps.
-- This RPC proves that those steps actually completed in the database
-- BEFORE the guest token is revoked and the iPad returns home.
create or replace function public.pos_handoff_verify_paid(
 p_checkout uuid,p_shift_id uuid,p_shift_secret text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid();v_saved uuid;
begin
 if v_uid is null or p_shift_secret is null or
    p_shift_secret !~ '^[a-f0-9]{64}$' then
  raise exception 'Checkout authorization denied';
 end if;
 select sale.id into v_saved
 from public.pos_checkout_handoffs h
 join public.pos_checkouts c on c.id=h.checkout_id
 join public.pos_staff_shifts s on s.id=h.shift_id
 join public.pos_staff_credentials staff on staff.id=s.staff_id
 join public.pos_sales sale on sale.checkout_id=c.id
 where h.checkout_id=p_checkout and h.shift_id=p_shift_id
   and h.auth_user_id=v_uid and c.owner_id=v_uid
   and h.phase='cashier' and c.status='completed'
   and c.cash_handoff_complete=true
   and sale.owner_id=v_uid and sale.payment_method='cash'
   and s.auth_user_id=v_uid and s.revoked_at is null and s.expires_at>now()
   and staff.enabled=true and staff.credential_version=s.credential_version
   and s.secret_digest=extensions.digest(p_shift_secret,'sha256');
 return jsonb_build_object('checkoutId',p_checkout,
    'completed',v_saved is not null);
end $$;
revoke all on function public.pos_handoff_verify_paid(uuid,uuid,text) from public,anon;
grant execute on function public.pos_handoff_verify_paid(uuid,uuid,text) to authenticated;

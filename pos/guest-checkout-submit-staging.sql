-- STAGING-ONLY DRAFT. DO NOT APPLY OR GRANT ANON EXECUTE YET.
-- Depends on pos/guest-checkout-capability-staging.sql and the checkout-change
-- revocation trigger. Implements one-time guest answers with no price/sale powers.
-- This is NOT an enabled customer handoff: cashier isolation, IP throttling,
-- staging SQL tests, and browser E2E remain prerequisites.

create table if not exists public.pos_guest_checkout_signatures (
  checkout_id uuid primary key references public.pos_checkouts(id) on delete cascade,
  signature_png_data_url text not null,
  captured_at timestamptz not null default now(),
  check (length(signature_png_data_url) between 200 and 180000)
);
alter table public.pos_guest_checkout_signatures enable row level security;
revoke all on public.pos_guest_checkout_signatures from public, anon, authenticated;

create table if not exists public.pos_guest_checkout_submit_limits (
  checkout_id uuid primary key references public.pos_guest_checkout_capabilities(checkout_id)
    on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check(request_count between 0 and 5)
);
alter table public.pos_guest_checkout_submit_limits enable row level security;
revoke all on public.pos_guest_checkout_submit_limits from public, anon, authenticated;

create or replace function public.pos_guest_checkout_submit(
  p_capability text,
  p_answers jsonb
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_now timestamptz := statement_timestamp();
  v_phone text;
  v_email text;
  v_consent text;
  v_payment text;
  v_interest text;
  v_signature text;
  v_rating integer;
  v_print boolean;
  v_email_receipt boolean;
  v_count integer;
begin
  -- Deliberately return the same failure for bad credentials and bad input.
  if p_capability is null or p_capability !~ '^[0-9a-f]{64}$'
    or p_answers is null or jsonb_typeof(p_answers) <> 'object'
    or (select count(*) from jsonb_object_keys(p_answers)) > 9
    or exists (
      select 1 from jsonb_object_keys(p_answers) k
      where k not in ('phone','email','marketing_choice','rating',
        'interest','payment_preference','print_receipt','email_receipt',
        'signature_png')
    )
  then return false; end if;

  -- Validate types before casting; caller cannot submit amounts, status,
  -- employee identity, discounts, cash tender, drawer commands or order IDs.
  if exists (
    select 1 from jsonb_each(p_answers) e
    where (e.key in ('phone','email','marketing_choice','interest',
                     'payment_preference','signature_png')
           and e.value <> 'null'::jsonb and jsonb_typeof(e.value)<>'string')
       or (e.key in ('print_receipt','email_receipt')
           and jsonb_typeof(e.value)<>'boolean')
       or (e.key='rating' and e.value <> 'null'::jsonb
           and jsonb_typeof(e.value)<>'number')
  ) then return false; end if;

  v_phone := nullif(btrim(coalesce(p_answers->>'phone','')),'');
  v_email := nullif(btrim(coalesce(p_answers->>'email','')),'');
  v_consent := p_answers->>'marketing_choice';
  v_payment := p_answers->>'payment_preference';
  v_interest := coalesce(p_answers->>'interest','not_answered');
  v_signature := p_answers->>'signature_png';
  v_print := coalesce((p_answers->>'print_receipt')::boolean,true);
  v_email_receipt := coalesce((p_answers->>'email_receipt')::boolean,false);

  if v_phone is not null and v_phone !~ '^[0-9]{10}$'
    or v_email is not null and
      (length(v_email)>250 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
    or v_consent is null or v_consent not in ('yes','no','not_answered')
    or v_payment is null or v_payment not in ('cash','venmo_info')
    or v_interest not in ('yes','no','not_answered')
    or (v_email_receipt and v_email is null)
    or v_signature is null or length(v_signature) not between 200 and 180000
    or v_signature !~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$'
  then return false; end if;
  -- Signature is mandatory for ordinary checkout. Owner-supervised refusal/
  -- accessibility exception must be a separate authenticated owner action.
  if p_answers ? 'rating' and p_answers->>'rating' is not null then
    if p_answers->>'rating' !~ '^[1-5]$' then return false; end if;
    v_rating := (p_answers->>'rating')::integer;
  end if;

  -- Lock the one-checkout capability first, serializing concurrent submissions
  -- and preventing replay across simultaneous browser requests.
  select t.checkout_id into v_id
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

  insert into public.pos_guest_checkout_submit_limits
    (checkout_id,window_started_at,request_count)
  values(v_id,v_now,0) on conflict(checkout_id) do nothing;
  update public.pos_guest_checkout_submit_limits
    set window_started_at=case
      when window_started_at<=v_now-interval '60 seconds'
        then v_now else window_started_at end,
        request_count=case
      when window_started_at<=v_now-interval '60 seconds'
        then 1 else request_count+1 end
  where checkout_id=v_id
    and (window_started_at<=v_now-interval '60 seconds' or request_count<5)
  returning request_count into v_count;
  if not found then return false; end if;

  insert into public.pos_guest_checkout_signatures
    (checkout_id,signature_png_data_url,captured_at)
  values(v_id,v_signature,v_now)
  on conflict(checkout_id) do nothing;
  if not found then return false; end if;

  update public.pos_checkouts c
  set phone=v_phone,email=v_email,
      marketing_opt_in=(v_consent='yes'),
      marketing_response=v_consent,
      consent_updated_at=v_now,
      rating=v_rating,
      custom_interest=v_interest,
      payment_preference=v_payment,
      receipt_print=v_print,receipt_email=v_email_receipt,
      status='contact_received',updated_at=v_now
  where c.id=v_id and c.status='awaiting_customer';
  if not found then return false; end if;

  -- Checkout-change trigger revokes the token in this transaction. Defense
  -- in depth: explicitly revoke as well; no subsequent guest call may succeed.
  update public.pos_guest_checkout_capabilities
     set revoked_at=v_now where checkout_id=v_id and revoked_at is null;
  return true;
end;
$$;
revoke all on function public.pos_guest_checkout_submit(text,jsonb)
  from public, anon, authenticated;

-- Remaining P0: disposable-DB integration tests including negative role
-- grants and two simultaneous submits; IP/device throttling at the gateway;
-- isolated customer browser context and owner re-auth; approved signature
-- exception flow; verify receipt/consent data handling before any exposure.

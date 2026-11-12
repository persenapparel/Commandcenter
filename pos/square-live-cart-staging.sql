-- Square-inspired, staging-only customer cart preview.
-- This preview is NOT a checkout, payment, reservation, or receipt.
-- Authenticated register owner writes the draft using existing pos_registers owner RLS.
alter table public.pos_registers
  add column if not exists draft_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists draft_updated_at timestamptz;
do $$
begin
 if not exists (select 1 from pg_constraint where conname='pos_registers_draft_snapshot_safe') then
  alter table public.pos_registers add constraint pos_registers_draft_snapshot_safe
  check (jsonb_typeof(draft_snapshot)='object' and octet_length(draft_snapshot::text)<=32768);
 end if;
end $$;

create or replace function public.pos_customer_cart_preview(p_secret uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.pos_registers;
begin
  select * into r
  from public.pos_registers
  where display_secret=p_secret and active and display_expires_at > now();
  if not found then
    return jsonb_build_object('status','unpaired');
  end if;
  -- Never compete with a live checkout or a paid sale awaiting change.
  if exists(
    select 1 from public.pos_checkouts c
    where c.register_id=r.id
      and (c.status in ('awaiting_customer','contact_received')
        or (c.status='completed' and c.cash_handoff_complete=false))
  ) then
    return jsonb_build_object('status','checkout_active');
  end if;
  if r.draft_updated_at is null
    or r.draft_updated_at < now()-interval '10 minutes'
    or jsonb_typeof(r.draft_snapshot->'items') is distinct from 'array'
    or jsonb_array_length(r.draft_snapshot->'items')=0 then
    return jsonb_build_object('status','idle');
  end if;
  return jsonb_build_object(
    'status','draft',
    'items',r.draft_snapshot->'items',
    'subtotal_cents',coalesce((r.draft_snapshot->>'subtotal_cents')::integer,0),
    'discount_cents',coalesce((r.draft_snapshot->>'discount_cents')::integer,0),
    'tax_cents',coalesce((r.draft_snapshot->>'tax_cents')::integer,0),
    'total_cents',coalesce((r.draft_snapshot->>'total_cents')::integer,0),
    'updated_at',r.draft_updated_at
  );
end $$;

revoke all on function public.pos_customer_cart_preview(uuid) from public,anon,authenticated;
grant execute on function public.pos_customer_cart_preview(uuid) to anon,authenticated;
comment on function public.pos_customer_cart_preview(uuid)
  is 'Read-only, short-lived pairing-token view of non-sensitive pre-checkout cart items. Never confirms payment.';

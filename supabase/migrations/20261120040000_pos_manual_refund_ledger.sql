-- Each entry records a reimbursement already issued against an original sale.
-- Only an authorized server transaction may write this ledger.
create table public.pos_manual_refunds (
  id uuid primary key,
  sale_id uuid not null references public.pos_sales(id),
  staff_id uuid not null references public.pos_staff_credentials(id),
  amount_cents integer not null check (amount_cents > 0),
  reimbursement_method text not null check (reimbursement_method in ('cash', 'venmo', 'apple_pay')),
  reason text not null check (length(trim(reason)) between 1 and 250),
  created_at timestamptz not null default now()
);
create index pos_manual_refunds_sale_idx on public.pos_manual_refunds(sale_id);
alter table public.pos_manual_refunds enable row level security;
revoke all on public.pos_manual_refunds from public, anon, authenticated;

-- Persen POS STAGING ONLY. Run after the cash-handoff schema is installed.
-- After Finish Order, show a short thank-you state without exposing the
-- previous customer's cart or total to the paired display.
-- No payment, stock, receipt, or marketing records are changed.
create or replace function public.pos_customer_view(p_secret uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.pos_registers; c public.pos_checkouts; due_change integer:=0; customer_status text;
begin
 select * into r from public.pos_registers
  where display_secret=p_secret and active and display_expires_at>now();
 if not found then return jsonb_build_object('status','unpaired'); end if;
 select * into c from public.pos_checkouts
  where register_id=r.id order by created_at desc limit 1;
 if not found or c.created_at<now()-interval '12 hours' then
  return jsonb_build_object('status','idle','register',r.label);
 end if;
 if c.status='cancelled' then
  return jsonb_build_object('status','idle','register',r.label);
 end if;
 if c.status='completed' and c.cash_handoff_complete then
  return jsonb_build_object('status','completed','register',r.label,'checkout_id',c.id);
 end if;
 customer_status:=c.status;
 if c.status='completed' and not c.cash_handoff_complete then
  select change_cents into due_change from public.pos_sales where checkout_id=c.id;
  customer_status:='paid_awaiting_change';
 end if;
 return jsonb_build_object('status',customer_status,'register',r.label,'checkout_id',c.id,
  'items',c.items,'subtotal_cents',c.subtotal_cents,'discount_cents',c.discount_cents,
  'tax_cents',c.tax_cents,'total_cents',c.total_cents,'change_cents',coalesce(due_change,0),
  'updated_at',c.updated_at);
end $$;
-- CREATE OR REPLACE retains existing function privileges.

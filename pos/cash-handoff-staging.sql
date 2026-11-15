-- Persen POS STAGING project ONLY: cashier change handoff and next-sale safety.
-- Apply before deploying the corresponding iPad code. Never run against the live Command Center.
-- Keep already-completed historical test checkouts finalized, but require Finish Order on new cash sales.
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='pos_checkouts' AND column_name='cash_handoff_complete') THEN
   ALTER TABLE public.pos_checkouts ADD COLUMN cash_handoff_complete boolean NOT NULL DEFAULT false;
   UPDATE public.pos_checkouts SET cash_handoff_complete=true WHERE status='completed';
 END IF;
END $$;
-- Only one checkout may be open or awaiting a physical cash/change handoff.
DROP INDEX IF EXISTS public.pos_one_open_checkout;
CREATE UNIQUE INDEX pos_one_open_checkout ON public.pos_checkouts(register_id)
 WHERE status IN ('awaiting_customer','contact_received')
   OR (status='completed' AND cash_handoff_complete=false);

create or replace function public.pos_customer_view(p_secret uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.pos_registers; c public.pos_checkouts; due_change integer:=0; customer_status text;
begin
 select * into r from public.pos_registers where display_secret=p_secret and active and display_expires_at > now();
 if not found then return jsonb_build_object('status','unpaired'); end if;
 select * into c from public.pos_checkouts where register_id=r.id order by created_at desc limit 1;
 if not found then return jsonb_build_object('status','idle','register',r.label); end if;
 if c.created_at<now()-interval '12 hours' then return jsonb_build_object('status','idle','register',r.label); end if;
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

-- Cash was already recorded. Finish Order means change/receipt has been handed back.
create or replace function public.pos_finish_order(p_checkout uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.pos_checkouts;
begin
 if (select auth.uid()) is null or not public.is_persen_admin() then
  raise exception 'Unauthorized';
 end if;
 select * into c from public.pos_checkouts
  where id=p_checkout and owner_id=(select auth.uid()) for update;
 if not found or c.status<>'completed' or
    not exists(select 1 from public.pos_sales where checkout_id=c.id and owner_id=(select auth.uid())) then
  raise exception 'Paid checkout not found';
 end if;
 if c.cash_handoff_complete then return true; end if;
 update public.pos_checkouts set cash_handoff_complete=true,updated_at=now() where id=c.id;
 return true;
end $$;
revoke execute on function public.pos_finish_order(uuid) from public,anon;
grant execute on function public.pos_finish_order(uuid) to authenticated;



create or replace function public.pos_claim_print_job(p_job uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
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
    'cashier_first_name',(select staff.first_name from public.pos_checkout_handoffs h
      join public.pos_staff_shifts sh on sh.id=h.shift_id and sh.auth_user_id=h.auth_user_id
      join public.pos_staff_credentials staff on staff.id=sh.staff_id and staff.auth_user_id=h.auth_user_id
      where h.checkout_id=sale.checkout_id and h.auth_user_id=sale.owner_id),
    'items',sale.snapshot->'items',
    'subtotal_cents',sale.subtotal_cents,
    'discount_cents',sale.discount_cents,
    'tax_cents',sale.tax_cents,
    'total_cents',sale.total_cents,
    'tendered_cents',sale.tendered_cents,
    'change_cents',sale.change_cents,
    'payment_method',sale.payment_method,
    'created_at',sale.created_at
 );
end $$;

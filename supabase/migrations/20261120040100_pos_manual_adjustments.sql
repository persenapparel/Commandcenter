create table public.pos_merchandise_returns (
 sale_id uuid primary key references public.pos_sales(id),
 staff_id uuid not null references public.pos_staff_credentials(id),
 reason text not null check(length(trim(reason)) between 1 and 250),
 created_at timestamptz not null default now()
);
alter table public.pos_merchandise_returns enable row level security;
revoke all on public.pos_merchandise_returns from public, anon, authenticated;

create function public.pos_manual_adjustment(p_shift uuid,p_secret text,p_register uuid,p_action text,p_sale uuid default null,p_request uuid default null,p_amount integer default null,p_method text default null,p_reason text default null,p_confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare staff uuid; sale public.pos_sales%rowtype; previous public.pos_manual_refunds%rowtype; remaining integer;
begin
 select c.id into strict staff from public.pos_staff_shifts sh
 join public.pos_staff_credentials c on c.id=sh.staff_id
 join public.pos_registers r on r.id=p_register and r.active and r.owner_id=auth.uid()
 where sh.id=p_shift and sh.auth_user_id=auth.uid() and sh.revoked_at is null and sh.expires_at>now()
 and length(p_secret)=64 and sh.secret_digest=extensions.digest(p_secret,'sha256')
 and c.enabled and c.credential_version=sh.credential_version and c.staff_role='owner' and public.is_persen_admin()
 for share of c,sh,r;
 if p_action='list' then
 return jsonb_build_object('sales',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from
 (select s.id,s.created_at,s.total_cents,s.payment_method,s.total_cents-coalesce((select sum(f.amount_cents) from public.pos_manual_refunds f where f.sale_id=s.id),0) available,
 exists(select 1 from public.pos_merchandise_returns m where m.sale_id=s.id) returned
 from public.pos_sales s join public.pos_checkouts ch on ch.id=s.checkout_id where s.owner_id=auth.uid() and ch.register_id=p_register and (p_sale is null or s.id=p_sale) order by s.created_at desc limit 100) q),'[]'::jsonb));
 end if;
 if p_confirmed is distinct from true or p_reason is null or length(trim(p_reason)) not between 1 and 250 then raise exception 'Confirmation and reason required'; end if;
 select s.* into strict sale from public.pos_sales s join public.pos_checkouts ch on ch.id=s.checkout_id where s.id=p_sale and s.owner_id=auth.uid() and ch.register_id=p_register for update of s;
 if p_action='return' then
 insert into public.pos_merchandise_returns values(sale.id,staff,trim(p_reason),now()) on conflict(sale_id) do nothing;
 elsif p_action='refund' then
 select * into previous from public.pos_manual_refunds where id=p_request;
 if found then
 if previous.sale_id=sale.id and previous.staff_id=staff and previous.amount_cents=p_amount and previous.reimbursement_method=p_method and previous.reason=trim(p_reason) then return jsonb_build_object('ok',true); end if;
 raise exception 'Conflicting request';
 end if;
 select sale.total_cents-coalesce(sum(amount_cents),0) into remaining from public.pos_manual_refunds where sale_id=sale.id;
 if p_amount is null or p_amount<=0 or p_amount>remaining then raise exception 'Amount exceeds refundable balance'; end if;
 insert into public.pos_manual_refunds(id,sale_id,staff_id,amount_cents,reimbursement_method,reason) values(p_request,sale.id,staff,p_amount,p_method,trim(p_reason));
 else raise exception 'Invalid action'; end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.pos_manual_adjustment(uuid,text,uuid,text,uuid,uuid,integer,text,text,boolean) from public,anon;
grant execute on function public.pos_manual_adjustment(uuid,text,uuid,text,uuid,uuid,integer,text,text,boolean) to authenticated;
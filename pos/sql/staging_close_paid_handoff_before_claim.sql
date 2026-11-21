-- A completed sale may outlive its browser's final close acknowledgement.
-- Release only its spent cashier handoff when another claim needs this register.
create or replace function public.pos_close_paid_handoff_before_claim()
returns trigger language plpgsql set search_path='' as $$
begin
 update public.pos_checkout_handoffs h
 set phase='closed', capability_digest=null, capability_expires_at=null,
     closed_at=now(),updated_at=now()
 from public.pos_checkouts c
 where h.register_id=new.register_id and h.auth_user_id=new.auth_user_id
   and h.phase='cashier' and c.id=h.checkout_id and c.status='completed'
   and c.register_id=h.register_id
   and exists(select 1 from public.pos_sales s where s.checkout_id=c.id and s.owner_id=c.owner_id);
 return new;
end $$;
revoke all on function public.pos_close_paid_handoff_before_claim() from public,anon,authenticated;
create or replace trigger pos_close_paid_handoff_before_claim
before insert on public.pos_checkout_handoffs for each row
execute function public.pos_close_paid_handoff_before_claim();

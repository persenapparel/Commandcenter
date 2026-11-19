-- STAGING ONLY. An owner-confirmed emergency recovery for an unfinished
-- unpaid test checkout that prevents the POS from starting the next sale.
-- Never cancel a completed sale, never decrement inventory, and never mark
-- money received. Revoke all one-time guest capabilities atomically.
create or replace function public.pos_owner_recover_unpaid_staging_checkout(
  p_register uuid,p_owner_badge text,p_owner_pin text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
 v_uid uuid:=auth.uid();
 v_attempt public.pos_staff_auth_attempts%rowtype;
 v_owner public.pos_staff_credentials%rowtype;
 v_register public.pos_registers%rowtype;
 v_checkout public.pos_checkouts%rowtype;
 v_n integer:=0;
begin
 if v_uid is null or not public.is_persen_admin() or p_register is null then
   raise exception 'Owner authorization required';
 end if;
 if length(coalesce(p_owner_badge,'')) not between 8 and 256
   or length(coalesce(p_owner_pin,'')) not between 6 and 128 then
   raise exception 'Owner badge and PIN required';
 end if;
 select * into v_register from public.pos_registers
 where id=p_register and owner_id=v_uid and active=true for update;
 if not found then raise exception 'Active staging register unavailable'; end if;

 insert into public.pos_staff_auth_attempts(auth_user_id)
 values(v_uid) on conflict(auth_user_id) do nothing;
 select * into v_attempt from public.pos_staff_auth_attempts
 where auth_user_id=v_uid for update;
 if v_attempt.blocked_until>now() then
   return jsonb_build_object('recovered',false,'reason','locked');
 end if;
 if v_attempt.window_started<now()-interval '15 minutes' then
   update public.pos_staff_auth_attempts
   set attempts=0,window_started=now(),blocked_until=null
   where auth_user_id=v_uid;
 end if;
 select * into v_owner from public.pos_staff_credentials
 where auth_user_id=v_uid and staff_role='owner' and enabled=true
   and badge_digest=extensions.digest(btrim(p_owner_badge),'sha256')
   and extensions.crypt(p_owner_pin,pin_hash)=pin_hash
 for update;
 if not found then
   update public.pos_staff_auth_attempts
   set attempts=least(attempts+1,5),
     blocked_until=case when attempts+1>=5 then now()+interval '15 minutes' else null end
   where auth_user_id=v_uid;
   return jsonb_build_object('recovered',false,'reason','owner_auth');
 end if;
 -- The owner must use the separate UI confirmation before calling this.
 -- Refuse to modify any paid or completed checkout even if its state is stale.
 for v_checkout in
   select * from public.pos_checkouts c
   where c.owner_id=v_uid and c.register_id=v_register.id
     and c.status in ('awaiting_customer','contact_received')
   order by c.created_at for update
 loop
   if exists(select 1 from public.pos_sales sale
      where sale.checkout_id=v_checkout.id) then
     raise exception 'Paid sale cannot be recovered or cancelled';
   end if;
   update public.pos_checkout_handoffs
      set phase='closed',capability_digest=null,
       capability_expires_at=null,closed_at=now(),updated_at=now()
      where checkout_id=v_checkout.id and register_id=v_register.id
        and phase<>'closed';
   update public.pos_checkouts
     set status='cancelled',updated_at=now()
     where id=v_checkout.id and owner_id=v_uid and register_id=v_register.id
       and status in ('awaiting_customer','contact_received');
   v_n:=v_n+1;
 end loop;
 update public.pos_staff_auth_attempts
 set attempts=0,window_started=now(),blocked_until=null
 where auth_user_id=v_uid;
 return jsonb_build_object('recovered',true,'cancelledUnpaidCheckouts',v_n,
   'requiresReload',true);
end;
$$;
revoke all on function public.pos_owner_recover_unpaid_staging_checkout(uuid,text,text)
 from public,anon,authenticated;
grant execute on function public.pos_owner_recover_unpaid_staging_checkout(uuid,text,text)
 to authenticated;

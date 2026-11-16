-- Disposable PostgreSQL 17 fixture, run only in GitHub CI. NO hosted writes.
begin;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
do $test$
declare
 v_uid uuid:='11111111-1111-4111-8111-111111111111';
 v_register uuid;
 v_checkout uuid;
 v_second uuid;
 v_shift uuid;
 v_secret text;
 v_token text;
 v_second_token text;
 v_login jsonb;
 v_result jsonb;
 v_before integer;
 v_after integer;
begin
 if has_function_privilege('anon','public.pos_handoff_guest_view(uuid,text)','execute')
    or has_function_privilege('authenticated','public.pos_handoff_guest_view(uuid,text)','execute')
    or has_function_privilege('anon','public.pos_handoff_guest_submit(uuid,text,jsonb)','execute')
 then raise exception 'Guest RPC was exposed to public browser roles'; end if;
 if not has_function_privilege('service_role','public.pos_handoff_guest_view(uuid,text)','execute')
 then raise exception 'Trusted gateway lacks guest execution privilege'; end if;
 insert into public.pos_staff_credentials(auth_user_id,first_name,staff_role,badge_digest,pin_hash)
 values(v_uid,'Test Cashier','owner',extensions.digest(repeat('B',32),'sha256'),
   extensions.crypt('123456',extensions.gen_salt('bf')));
 v_login:=public.pos_staff_start_shift(repeat('B',32),'123456');
 if coalesce((v_login->>'ok')::boolean,false) is not true then
  raise exception 'Shift PIN login failed'; end if;
 v_shift:=(v_login->>'shift_id')::uuid;
 v_secret:=v_login->>'shift_secret';
 insert into public.pos_registers(owner_id,label)
 values(v_uid,'Isolated CI cash register') returning id into v_register;
 insert into public.pos_checkouts(register_id,owner_id,items,total_cents)
 values(v_register,v_uid,
  '[{"name":"CI Test Hoodie","qty":1,"unit_cents":2500}]'::jsonb,2500)
 returning id into v_checkout;
 v_result:=public.pos_handoff_claim(v_checkout,v_shift,v_secret);
 if v_result->>'phase'<>'claimed' then raise exception 'Checkout claim failed'; end if;
 begin
  perform public.pos_handoff_claim(v_checkout,v_shift,v_secret);
  raise exception 'Duplicate checkout claim was allowed';
 exception when others then
  if sqlerrm='Duplicate checkout claim was allowed' then raise; end if;
 end;
 v_result:=public.pos_handoff_issue_guest(v_checkout,v_shift,v_secret);
 v_token:=v_result->>'capability';
 if length(v_token)<>64 then raise exception 'Invalid scoped guest token'; end if;
 begin
  perform public.pos_handoff_issue_guest(v_checkout,v_shift,v_secret);
  raise exception 'Token was reissued';
 exception when others then
  if sqlerrm='Token was reissued' then raise; end if;
 end;
 v_result:=public.pos_handoff_status(v_checkout,v_shift,v_secret);
 if v_result->>'status'<>'awaiting_customer' then
  raise exception 'Staff scoped status must reflect awaiting customer'; end if;
 v_result:=public.pos_handoff_verify_paid(v_checkout,v_shift,v_secret);
 if v_result->>'completed'<>'false' then
  raise exception 'Unpaid sale incorrectly verified'; end if;
 v_result:=public.pos_handoff_guest_view(v_checkout,v_token);
 if v_result->>'checkoutId' is distinct from v_checkout::text
   or jsonb_array_length(v_result->'items')<>1
 then raise exception 'Scoped guest view failed'; end if;
 begin
  perform public.pos_handoff_guest_view(gen_random_uuid(),v_token);
  raise exception 'Token worked for wrong checkout';
 exception when others then
  if sqlerrm='Token worked for wrong checkout' then raise; end if;
 end;
 begin
  perform public.pos_handoff_guest_submit(v_checkout,v_token,
   '{"phone":"555","signature":"CI Signer","signatureException":false}'::jsonb);
  raise exception 'Invalid phone was accepted';
 exception when others then
  if sqlerrm='Invalid phone was accepted' then raise; end if;
 end;
 v_result:=public.pos_handoff_guest_submit(v_checkout,v_token,
  '{"phone":"(631) 555-0100","email":"test@example.test",
    "marketingConsent":false,"signature":"CI Signer",
    "signatureException":false}'::jsonb);
 if v_result->>'accepted'<>'true' then raise exception 'Guest submit failed'; end if;
 v_result:=public.pos_handoff_status(v_checkout,v_shift,v_secret);
 if v_result->>'status'<>'contact_received' then
  raise exception 'Server customer status did not advance'; end if;
 if not exists(select 1 from public.pos_checkout_signatures
   where checkout_id=v_checkout and typed_name='CI Signer'
   and not accessibility_exception) then
  raise exception 'Private typed signature was not recorded'; end if;
 if exists(select 1 from public.pos_checkouts
   where id=v_checkout and marketing_opt_in) then
  raise exception 'Marketing consent was inferred'; end if;
 begin
  perform public.pos_handoff_guest_submit(v_checkout,v_token,
   '{"signature":"Replay"}'::jsonb);
  raise exception 'Guest capability replay succeeded';
 exception when others then
  if sqlerrm='Guest capability replay succeeded' then raise; end if;
 end;
 select attempts into v_before from public.pos_staff_auth_attempts where auth_user_id=v_uid;
 v_result:=public.pos_handoff_resume(v_checkout,v_shift,v_secret,repeat('Z',32));
 if v_result->>'verified' is distinct from 'false' then
  raise exception 'Incorrect badge resumed checkout'; end if;
 select attempts into v_after from public.pos_staff_auth_attempts where auth_user_id=v_uid;
 if v_after<=v_before then raise exception 'Bad badge throttle did not persist'; end if;
 v_result:=public.pos_handoff_resume(v_checkout,v_shift,'wrong',repeat('B',32));
 if v_result->>'verified' is distinct from 'false' then
  raise exception 'Wrong shift secret resumed checkout'; end if;
 v_result:=public.pos_handoff_resume(v_checkout,v_shift,v_secret,repeat('B',32));
 if v_result->>'verified' is distinct from 'true' then
  raise exception 'Original shift badge failed to resume'; end if;
 v_result:=public.pos_handoff_verify_paid(v_checkout,v_shift,v_secret);
 if v_result->>'completed'<>'false' then
  raise exception 'Checkout without cash/finish was verified'; end if;
 begin
  perform public.pos_handoff_resume(v_checkout,v_shift,v_secret,repeat('B',32));
  raise exception 'Badge resume replay succeeded';
 exception when others then
  if sqlerrm='Badge resume replay succeeded' then raise; end if;
 end;
 perform public.pos_handoff_revoke(v_checkout,v_shift,v_secret);
 if not exists (select 1 from public.pos_checkout_handoffs
   where checkout_id=v_checkout and phase='closed'
   and capability_digest is null) then
  raise exception 'Guest capability not revoked'; end if;

 -- Independent register avoids violating the existing one-open-checkout
 -- per-register invariant while checking capability expiry.
 insert into public.pos_registers(owner_id,label)
 values(v_uid,'Expiry fixture register') returning id into v_register;
 insert into public.pos_checkouts(register_id,owner_id,items,total_cents)
 values(v_register,v_uid,
  '[{"name":"CI Test Tee","qty":1,"unit_cents":1000}]'::jsonb,1000)
 returning id into v_second;
 perform public.pos_handoff_claim(v_second,v_shift,v_secret);
 v_result:=public.pos_handoff_issue_guest(v_second,v_shift,v_secret);
 v_second_token:=v_result->>'capability';
 update public.pos_checkout_handoffs
 set capability_expires_at=now()-interval '1 second'
 where checkout_id=v_second;
 begin
  perform public.pos_handoff_guest_view(v_second,v_second_token);
  raise exception 'Expired capability remained valid';
 exception when others then
  if sqlerrm='Expired capability remained valid' then raise; end if;
 end;
 raise notice 'PASS: checkout owner/shift, scoped guest, replay, expiry, signature, consent, badge throttle';
end
$test$;
rollback;

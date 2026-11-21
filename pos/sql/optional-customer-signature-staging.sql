-- POS STAGING ONLY: Allows customer checkout without a typed signature.
-- Keeps signed typed-name and accessibility-exception historical paths intact.
-- No unsigned receipt/payment authorization bypass: guest capability and checkout checks unchanged.
-- Apply only to isolated Supabase project naaqcspvbntzdtwuchrr.
CREATE OR REPLACE FUNCTION public.pos_handoff_guest_submit(p_checkout uuid, p_capability text, p_answers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_handoff public.pos_checkout_handoffs%rowtype;
 v_checkout public.pos_checkouts%rowtype;
 v_phone text; v_email text; v_signature text; v_exception boolean;
 v_marketing boolean; v_payment text;
begin
 if p_capability is null or p_capability !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_answers) is distinct from 'object' then
   raise exception 'Checkout unavailable';
 end if;
 select * into v_handoff from public.pos_checkout_handoffs
 where checkout_id=p_checkout and phase='guest'
   and capability_expires_at>now()
   and capability_digest=extensions.digest(p_capability,'sha256')
 for update;
 if not found then raise exception 'Checkout unavailable'; end if;
 select * into v_checkout from public.pos_checkouts
 where id=p_checkout and status='awaiting_customer'
   and created_at>now()-interval '30 minutes'
 for update;
 if not found then raise exception 'Checkout unavailable'; end if;
 v_phone:=btrim(coalesce(p_answers->>'phone',''));
 v_email:=btrim(coalesce(p_answers->>'email',''));
 v_signature:=btrim(coalesce(p_answers->>'signature',''));
 if jsonb_typeof(p_answers->'marketingConsent') not in ('boolean','null')
    and p_answers ? 'marketingConsent' then
  raise exception 'Invalid customer answer';
 end if;
 if jsonb_typeof(p_answers->'signatureException') not in ('boolean','null')
    and p_answers ? 'signatureException' then
  raise exception 'Invalid customer answer';
 end if;
 if p_answers ? 'paymentPreference' and
    jsonb_typeof(p_answers->'paymentPreference') <> 'string' then
  raise exception 'Invalid payment preference';
 end if;
 v_payment:=coalesce(p_answers->>'paymentPreference','cash');
 if v_payment not in ('cash','venmo_info','apple_cash_info') then
  raise exception 'Invalid payment preference';
 end if;
 v_marketing:=coalesce((p_answers->>'marketingConsent')::boolean,false);
 v_exception:=coalesce((p_answers->>'signatureException')::boolean,false);
 if length(v_phone)>24 or (length(v_phone)>0 and
    length(regexp_replace(v_phone,'[^0-9]','','g')) not between 10 and 15)
   or length(v_email)>250
   or (v_email<>'' and v_email !~ '^[^ @]+@[^ @]+[.][^ @]+$')
   or (not v_exception and v_signature <> '' and length(v_signature)>160)
   or (v_exception and v_signature<>'') then
  raise exception 'Invalid customer answer';
 end if;
 update public.pos_checkouts
 set phone=nullif(v_phone,''),email=nullif(v_email,''),
     payment_preference=v_payment,
     marketing_opt_in=v_marketing,
     consent_updated_at=case when v_marketing then now() else null end,
     customer_step='review',progress_updated_at=now(),
     status='contact_received',updated_at=now()
 where id=p_checkout;
 -- Only the protected signature table stores the limited typed acknowledgment.
 if v_exception or v_signature <> '' then
  insert into public.pos_checkout_signatures(checkout_id,typed_name,accessibility_exception)
  values(p_checkout,case when v_exception then null else v_signature end,v_exception);
 end if;
 update public.pos_checkout_handoffs
 set phase='customer_complete',capability_digest=null,capability_expires_at=null,
     updated_at=now()
 where checkout_id=p_checkout;
 return jsonb_build_object('accepted',true);
end $function$


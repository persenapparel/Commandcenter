-- PERSEN POS STAGING ONLY — precise customer marketing answer.
-- Leaves the original pos_submit_customer RPC intact for already-open staging clients.
-- Consent to marketing is NEVER inferred from a receipt request or email address.
ALTER TABLE public.pos_checkouts
 ADD COLUMN IF NOT EXISTS marketing_response text NOT NULL DEFAULT 'not_answered'
 CHECK (marketing_response IN ('yes','no','not_answered'));
COMMENT ON COLUMN public.pos_checkouts.marketing_response IS
 'Exact optional customer response: yes, no, or not_answered. Only yes grants marketing permission.';
CREATE OR REPLACE FUNCTION public.pos_submit_customer_v2(
 p_secret uuid,
 p_checkout uuid,
 p_phone text,
 p_email text DEFAULT NULL,
 p_marketing_choice text DEFAULT 'not_answered',
 p_rating integer DEFAULT NULL,
 p_interest text DEFAULT 'not_answered',
 p_payment_preference text DEFAULT 'cash',
 p_print_receipt boolean DEFAULT true,
 p_email_receipt boolean DEFAULT false
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE choice text := COALESCE(p_marketing_choice,'not_answered');
BEGIN
 IF choice NOT IN ('yes','no','not_answered') THEN
  RAISE EXCEPTION 'Invalid marketing choice';
 END IF;
 -- Existing RPC verifies pairing credentials, expiry, checkout ID, answers,
 -- and customer step before any row can be updated.
 PERFORM public.pos_submit_customer(
  p_secret,p_checkout,p_phone,p_email,choice='yes',p_rating,p_interest,
  p_payment_preference,p_print_receipt,p_email_receipt
 );
 UPDATE public.pos_checkouts
    SET marketing_response=choice
    WHERE id=p_checkout AND status='contact_received';
 IF NOT FOUND THEN RAISE EXCEPTION 'Checkout answer could not be saved'; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.pos_submit_customer_v2(uuid,uuid,text,text,text,integer,text,text,boolean,boolean)
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_submit_customer_v2(uuid,uuid,text,text,text,integer,text,text,boolean,boolean)
 TO anon, authenticated;

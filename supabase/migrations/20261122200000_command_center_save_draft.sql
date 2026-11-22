BEGIN;

CREATE FUNCTION public.persen_save_document_draft(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_changes jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  document public.business_invoices%ROWTYPE;
  changes public.business_invoices%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.is_persen_admin() IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Owner permission required' USING ERRCODE = '42501';
  END IF;

  -- Serialize with agreement creation and the foreign key on estimate conversions.
  SELECT * INTO document
    FROM public.business_invoices
    WHERE id = p_id
    FOR UPDATE;
  IF NOT FOUND OR document.status IS DISTINCT FROM 'Draft'
    OR document.updated_at IS DISTINCT FROM p_expected_updated_at
    OR EXISTS (SELECT 1 FROM public.invoice_agreements WHERE invoice_id = p_id)
    OR EXISTS (SELECT 1 FROM public.invoice_payments WHERE invoice_id = p_id)
    OR EXISTS (SELECT 1 FROM public.business_invoices WHERE source_estimate_id = p_id)
  THEN
    RAISE EXCEPTION 'This draft changed or is locked. Refresh to review it.';
  END IF;

  changes := jsonb_populate_record(document, p_changes);
  UPDATE public.business_invoices SET
    contact_id = changes.contact_id,
    customer_name = changes.customer_name,
    customer_email = changes.customer_email,
    customer_organization = changes.customer_organization,
    due_date = changes.due_date,
    line_items = changes.line_items,
    subtotal = changes.subtotal,
    shipping = changes.shipping,
    tax_amount = changes.tax_amount,
    discount_type = changes.discount_type,
    discount_value = changes.discount_value,
    public_notes = changes.public_notes,
    updated_at = clock_timestamp()
  WHERE id = p_id
  RETURNING id INTO p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draft update denied' USING ERRCODE = '42501';
  END IF;
  RETURN p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.persen_save_document_draft(uuid, timestamptz, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.persen_save_document_draft(uuid, timestamptz, jsonb) TO authenticated;

COMMIT;

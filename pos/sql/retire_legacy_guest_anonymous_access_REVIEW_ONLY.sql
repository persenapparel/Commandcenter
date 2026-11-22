-- REVIEW ONLY. Do NOT apply before the live build has retired /display.html
-- and the one-swivel-iPad checkout passes a real-device test afterward.
-- This changes ONLY function grants on the dedicated POS project.
-- The modern isolated customer worker uses pos_handoff_guest_view and
-- pos_handoff_guest_submit and is intentionally left untouched.
begin;
revoke execute on function public.pos_customer_cart_preview(uuid)
 from public, anon, authenticated;
revoke execute on function public.pos_customer_view(uuid)
 from public, anon, authenticated;
revoke execute on function public.pos_set_customer_progress(uuid,uuid,text,boolean)
 from public, anon, authenticated;
revoke execute on function public.pos_submit_customer(uuid,uuid,text,text,boolean,integer,text,text,boolean,boolean)
 from public, anon, authenticated;
revoke execute on function public.pos_submit_customer_v2(uuid,uuid,text,text,text,integer,text,text,boolean,boolean)
 from public, anon, authenticated;
commit;
-- After application rerun pos/sql/live_sales_release_audit_20261122.sql
-- and confirm all five legacy-guest checks PASS.
-- If the old two-device display remains in use, STOP and do not apply.

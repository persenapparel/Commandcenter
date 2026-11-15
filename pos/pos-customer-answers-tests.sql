-- Run only in isolated PostgreSQL CI after schema + pairing + customer answer v2.
SELECT 1/(CASE WHEN EXISTS (
 SELECT 1 FROM information_schema.columns
 WHERE table_schema='public' AND table_name='pos_checkouts' AND column_name='marketing_response'
) THEN 1 ELSE 0 END) AS customer_marketing_response_column;
SELECT 1/(CASE WHEN EXISTS (
 SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
 WHERE n.nspname='public' AND p.proname='pos_submit_customer_v2'
) THEN 1 ELSE 0 END) AS precise_customer_submit_function;
SELECT 1/(CASE WHEN has_function_privilege(
 'anon','public.pos_submit_customer_v2(uuid,uuid,text,text,text,integer,text,text,boolean,boolean)','EXECUTE'
) THEN 1 ELSE 0 END) AS paired_customer_can_submit_v2;
SELECT 1/(CASE WHEN NOT has_table_privilege('anon','public.pos_checkouts','UPDATE')
 THEN 1 ELSE 0 END) AS untrusted_customers_cannot_edit_response_rows;
SELECT 1/(CASE WHEN NOT has_table_privilege('anon','public.pos_sales','SELECT')
 THEN 1 ELSE 0 END) AS customer_cannot_read_sale_history;
SELECT 1/(CASE WHEN NOT has_table_privilege('anon','public.pos_checkouts','SELECT')
 THEN 1 ELSE 0 END) AS customer_cannot_read_private_answers;

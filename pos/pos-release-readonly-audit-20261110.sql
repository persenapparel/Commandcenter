-- READ ONLY. Run separately in production and POS staging. Do not execute writes.
-- Baseline reference for November 10, 2026 before any event sales.
-- This query intentionally does NOT assume the two separate Supabase databases sync.
WITH expected(product_name,color,size,qty) AS (
 VALUES
 ('Christmas Collection Hoodie','red','S',5),('Christmas Collection Hoodie','red','M',9),
 ('Christmas Collection Hoodie','red','L',8),('Christmas Collection Hoodie','red','XL',3),
 ('Christmas Collection Hoodie','green','S',5),('Christmas Collection Hoodie','green','M',9),
 ('Christmas Collection Hoodie','green','L',8),('Christmas Collection Hoodie','green','XL',3),
 ('Christmas Collection Crewneck','red','S',6),('Christmas Collection Crewneck','red','M',9),
 ('Christmas Collection Crewneck','red','L',7),('Christmas Collection Crewneck','red','XL',3),
 ('Christmas Collection Crewneck','green','S',6),('Christmas Collection Crewneck','green','M',9),
 ('Christmas Collection Crewneck','green','L',7),('Christmas Collection Crewneck','green','XL',3)
), actual AS (
 SELECT lower(trim(product_name)) AS product_key, lower(trim(color)) AS color,
 upper(trim(size)) AS size, sum(quantity)::int AS qty, count(*) AS records
 FROM public.stock_items WHERE product_name ILIKE 'Christmas%'
 GROUP BY 1,2,3
), audit AS (
 SELECT coalesce(e.product_name,a.product_key) AS product,
 coalesce(e.color,a.color) AS color,coalesce(e.size,a.size) AS size,
 e.qty AS expected_qty,a.qty AS actual_qty,a.records,
 CASE WHEN e.product_name IS NULL THEN 'UNEXPECTED_PRODUCT_OR_VARIANT'
 WHEN a.product_key IS NULL THEN 'MISSING_VARIANT'
 WHEN a.records<>1 THEN 'DUPLICATE_VARIANT'
 WHEN a.qty IS DISTINCT FROM e.qty THEN 'QUANTITY_MISMATCH'
 ELSE 'PASS' END AS status
 FROM expected e FULL JOIN actual a
 ON lower(e.product_name)=a.product_key AND e.color=a.color AND e.size=a.size
)
SELECT * FROM audit WHERE status<>'PASS' ORDER BY product,color,size;

-- Product-level catalog pricing gate: both known Christmas products must have
-- an explicit reviewed price before sale. Never use sample/demo prices.
SELECT name,inventory_type,price_cents,is_active,
 CASE WHEN inventory_type<>'sales' OR is_active IS DISTINCT FROM true
 THEN 'CATALOG_NOT_ACTIVE_SALES'
 WHEN price_cents IS NULL OR price_cents<=0 THEN 'PRICE_REVIEW_REQUIRED'
 ELSE 'PRICE_CONFIGURED_VERIFY_OWNER_APPROVAL' END AS release_gate
FROM public.inventory_catalog WHERE name ILIKE 'Christmas%'
ORDER BY name;

-- Run only on POS staging, where pos_variant_details exists:
-- SELECT s.product_name,s.color,s.size,s.quantity,v.price_cents,v.taxable
-- FROM public.stock_items s LEFT JOIN public.pos_variant_details v ON v.stock_id=s.id
-- WHERE s.product_name ILIKE 'Christmas%' ORDER BY 1,2,3;

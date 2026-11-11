-- READ ONLY: run separately in production and POS staging; never copy staging stock into production.
-- Production Christmas Collection expected: 100 units across 16 size variants; no 2XL.
-- A correct production run returns zero rows. Staging currently returns mismatches.
WITH expected(product_name,color,size,expected_quantity) AS (
 VALUES
 ('Christmas Collection Hoodie','Red','S',5),('Christmas Collection Hoodie','Red','M',9),
 ('Christmas Collection Hoodie','Red','L',8),('Christmas Collection Hoodie','Red','XL',3),
 ('Christmas Collection Hoodie','Green','S',5),('Christmas Collection Hoodie','Green','M',9),
 ('Christmas Collection Hoodie','Green','L',8),('Christmas Collection Hoodie','Green','XL',3),
 ('Christmas Collection Crewneck','Red','S',6),('Christmas Collection Crewneck','Red','M',9),
 ('Christmas Collection Crewneck','Red','L',7),('Christmas Collection Crewneck','Red','XL',3),
 ('Christmas Collection Crewneck','Green','S',6),('Christmas Collection Crewneck','Green','M',9),
 ('Christmas Collection Crewneck','Green','L',7),('Christmas Collection Crewneck','Green','XL',3)
),
actual AS (
 SELECT product_name, lower(trim(color)) AS color, upper(trim(size)) AS size,
        sum(quantity)::integer AS quantity, count(*) AS rows
 FROM public.stock_items
 WHERE product_name ILIKE 'Christmas%'
 GROUP BY product_name,lower(trim(color)),upper(trim(size))
),
comparison AS (
 SELECT coalesce(e.product_name,a.product_name) AS product_name,
        coalesce(e.color,initcap(a.color)) AS color,
        coalesce(e.size,a.size) AS size,
        e.expected_quantity, a.quantity AS actual_quantity, a.rows AS matching_rows,
        CASE WHEN e.product_name IS NULL THEN 'UNEXPECTED VARIANT'
             WHEN a.product_name IS NULL THEN 'MISSING VARIANT'
             WHEN a.quantity IS DISTINCT FROM e.expected_quantity THEN 'QUANTITY MISMATCH'
             WHEN a.rows <> 1 THEN 'DUPLICATE VARIANT'
             ELSE 'PASS' END AS result
 FROM expected e FULL OUTER JOIN actual a
   ON e.product_name=a.product_name AND lower(e.color)=a.color AND e.size=a.size
)
SELECT * FROM comparison WHERE result<>'PASS' ORDER BY product_name,color,size;

-- Read-only independent summary:
-- SELECT count(*) AS variants, sum(quantity) AS units
-- FROM public.stock_items WHERE product_name LIKE 'Christmas Collection %';
